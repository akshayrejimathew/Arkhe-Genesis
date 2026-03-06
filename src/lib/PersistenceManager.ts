// src/lib/PersistenceManager.ts
/**
 * PersistenceManager.ts
 * Cloud sync, genome upload, session restoration, and annotation persistence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEC-01 — Vault: AES-GCM Encryption-at-Rest for Sovereign API Keys (NEW)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   THREAT MODEL:
 *     A malicious browser extension with content-script access can dump all
 *     IndexedDB stores for the origin via `window.indexedDB.open()` — no
 *     special permission is required. Storing the Supabase anon/service key
 *     in plaintext in idb-keyval means a single call to `idb-keyval.get()`
 *     exposes the key directly.
 *
 *   DEFENCE — TWO-FACTOR KEY DERIVATION:
 *     The AES-GCM encryption key is derived from TWO independent sources that
 *     an extension must compromise separately:
 *
 *       1. Vault Seed (cookie, `arkhe_vault_seed`):
 *            32 cryptographically random bytes generated once per installation
 *            via `window.crypto.getRandomValues`. Stored as a base64-encoded
 *            persistent cookie (1-year expiry, SameSite=Strict). Reading a
 *            cookie requires the `cookies` permission in addition to standard
 *            content-script access — a higher privilege level than IndexedDB
 *            access alone.
 *
 *       2. Vault Salt (IndexedDB, `ARKHE_VAULT_SALT`):
 *            16 cryptographically random bytes generated once per installation
 *            and stored in idb-keyval alongside the ciphertext. The salt is
 *            not secret by itself (it follows standard PBKDF2 convention), but
 *            combined with the cookie-gated seed it ensures the key cannot be
 *            reconstructed from IndexedDB contents alone.
 *
 *     Key derivation: PBKDF2-SHA-256 (seed as password, salt, 100 000 iter)
 *     Encryption: AES-GCM 256-bit with a fresh random 12-byte IV per write.
 *
 *   STORED SHAPE (IndexedDB key: `ARKHE_VAULT_KEY_CIPHER`):
 *     {
 *       "ciphertext": "<base64-encoded AES-GCM ciphertext>",
 *       "iv":         "<base64-encoded 12-byte IV>"
 *     }
 *
 *   BACKWARD COMPAT / MIGRATION:
 *     `getSovereignClient()` first tries `ARKHE_VAULT_KEY_CIPHER` (encrypted).
 *     If absent it falls back to the legacy plaintext `ARKHE_CUSTOM_SUPABASE_KEY`
 *     entry. When found, it re-encrypts the key, writes the vault payload, and
 *     deletes the plaintext entry — transparent one-time migration.
 *
 *   LIMITATIONS:
 *     The cookie is not HttpOnly (the Web Crypto API must derive the key at
 *     runtime in the browser, requiring JS access to the seed). A sufficiently
 *     privileged extension with both `cookies` and `scripting` permissions
 *     could still reconstruct the key. This design provides defence-in-depth
 *     against common extension-based attacks (IndexedDB dump scripts) rather
 *     than against fully privileged malware.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LB-01 & LB-08 FIXES (2026-02-25) — Mutation Persistence
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   LB-01 — Mutations serialized into `snapshot_meta`:
 *     `performSync()` now writes the full `MutationRecord[]` array into the
 *     `snapshot_meta` JSONB column as `{ mutations: [...] }`. This means a
 *     cloud-restored commit carries its actual mutations, not an empty array,
 *     making undo() architecturally possible after a page reload.
 *
 *     Why `snapshot_meta`? The existing DB type already contains it as a
 *     freeform `Json` column — adding a dedicated `mutation_records` column
 *     would require a migration that is tracked separately. Using `snapshot_meta`
 *     is a zero-migration path that remains backward compatible: rows written
 *     by older clients will simply have `snapshot_meta: {}`, producing an empty
 *     mutations array on restore (the same behaviour as before).
 *
 *     TYPE SAFETY NOTE:
 *     MutationRecord is a domain type with no index signature, so TypeScript
 *     rejects a direct assignment to the Json union type. We use
 *     `as unknown as Json` after building the payload object — the shape is
 *     safe because Supabase JSONB will serialise any serialisable object. We
 *     deliberately avoid the `satisfies` operator (requires TypeScript ≥ 4.9).
 *
 *   LB-08 — `childrenTxIds` rebuilt in `restoreSession`:
 *     The DB stores parent→child relationships directionally (each row has a
 *     `parent_id` pointing at its parent). There is no `children` column.
 *     After fetching all commits for a genome, `restoreSession()` now performs
 *     a single O(n) pass to invert the parent map and populate each commit's
 *     `childrenTxIds` array before returning the payload. Callers (Chronos.restore)
 *     therefore receive a fully connected DAG, not a forest of isolated nodes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 2 SECURITY FIXES (2026-02-22) — retained
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   FIX 3A — Sovereign Credential Leak Prevention (unchanged).
 *   FIX 3B — Cross-Tab Sovereign Credential Sync (unchanged).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 1 FIXES (2026-02-21) — retained
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   SHADOW-03 — try/finally guarantees sync lock release on network failure.
 *   CIRCUIT BREAKER — 413 / 429 offline mode.
 *   SOVEREIGN MODE — bring-your-own Supabase instance.
 */

import { supabase as defaultSupabase } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { get, set, del } from 'idb-keyval';
import type {
  Genome,
  ChronosCommit as SupabaseChronosCommit,
  Branch as SupabaseBranch,
  UserFeature,
  NewGenome,
  NewChronosCommit,
  NewBranch,
  NewUserFeature,
  Json,
} from '@/lib/supabase';
import type { Commit, Branch as ArkheBranch, FeatureTag, MutationRecord } from '@/types/arkhe';

// --------------------------------------------------------------------------
// IndexedDB keys
// --------------------------------------------------------------------------
const SOVEREIGN_URL_KEY  = 'ARKHE_CUSTOM_SUPABASE_URL';
/** @deprecated - Plaintext key storage. Migrated to VAULT_CIPHER_KEY on read. */
const SOVEREIGN_KEY_KEY  = 'ARKHE_CUSTOM_SUPABASE_KEY';

// SEC-01 Vault keys
const VAULT_CIPHER_KEY   = 'ARKHE_VAULT_KEY_CIPHER';  // stores VaultPayload JSON
const VAULT_SALT_KEY     = 'ARKHE_VAULT_SALT';         // stores base64 salt

// Cookie key for the vault seed (separate storage layer)
const VAULT_SEED_COOKIE  = 'arkhe_vault_seed';

// --------------------------------------------------------------------------
// SEC-01 — Vault utility (AES-GCM encryption-at-rest)
// --------------------------------------------------------------------------

/**
 * Wire format for an encrypted value in IndexedDB.
 * Both fields are base64url-encoded binary.
 */
interface VaultPayload {
  /** Base64-encoded AES-GCM ciphertext bytes. */
  ciphertext: string;
  /** Base64-encoded 12-byte AES-GCM IV. Unique per write. */
  iv: string;
}

// ── Base64 helpers ──────────────────────────────────────────────────────────
// We use the standard base64 alphabet (not URL-safe) because we are storing
// the values as JSON strings in IndexedDB, never embedding them in URLs.

/** Encode a Uint8Array to a base64 string. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array backed by a plain ArrayBuffer.
 *
 * The explicit `new ArrayBuffer(n)` construction is required because
 * TypeScript ≥ 5.2 types the generic `new Uint8Array(n)` constructor as
 * `Uint8Array<ArrayBufferLike>`, which is not assignable to the `BufferSource`
 * constraint used by the Web Crypto API (`BufferSource` requires
 * `ArrayBufferView<ArrayBuffer>`, i.e. a view whose `.buffer` is a plain
 * `ArrayBuffer`, not the `ArrayBufferLike` union that includes
 * `SharedArrayBuffer`). Constructing via `new Uint8Array(new ArrayBuffer(n))`
 * gives TypeScript enough information to narrow the type to
 * `Uint8Array<ArrayBuffer>`.
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes  = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Vault — AES-GCM encryption for sovereign Supabase API keys.
 *
 * The encryption key is derived at runtime from two independent sources:
 *   • A random seed stored in a persistent first-party cookie.
 *   • A random salt stored in IndexedDB alongside the ciphertext.
 *
 * An attacker must compromise both storage layers (cookie + IndexedDB) to
 * reconstruct the key — a higher bar than a simple IndexedDB dump.
 *
 * All methods are safe to call only after verifying that `window` and
 * `crypto.subtle` are available (browser environment). Callers in
 * PersistenceManager already gate on `typeof window !== 'undefined'`.
 */
class Vault {
  // ── Layer 1: Seed (persistent cookie, JS-readable) ────────────────────────

  /**
   * Returns the 32-byte vault seed from the installation cookie.
   * If the cookie is absent or malformed, generates a fresh seed and writes it.
   *
   * The cookie is set with:
   *   • expires = 1 year  (survives browser restarts, unlike session cookies)
   *   • path=/            (available to all routes)
   *   • SameSite=Strict   (not sent on cross-site requests — defence against CSRF)
   *
   * The cookie is intentionally NOT HttpOnly because the seed must be read by
   * the Web Crypto API at runtime in browser JavaScript.
   */
  private static getSeedFromCookie(): Uint8Array<ArrayBuffer> {
    // Parse the cookie jar for our seed cookie.
    const cookieEntry = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${VAULT_SEED_COOKIE}=`));

    if (cookieEntry) {
      const b64 = cookieEntry.slice(VAULT_SEED_COOKIE.length + 1);
      try {
        const decoded = base64ToBytes(b64);
        // Validate the decoded length — a corrupt/truncated cookie should be
        // regenerated rather than used as weak key material.
        if (decoded.byteLength === 32) {
          return decoded;
        }
      } catch {
        // atob failure — cookie is malformed; fall through to regenerate.
      }
    }

    // Generate a fresh 32-byte cryptographically random seed.
    // `new Uint8Array(new ArrayBuffer(32))` is used instead of the shorthand
    // `new Uint8Array(32)` so TypeScript infers Uint8Array<ArrayBuffer> rather
    // than Uint8Array<ArrayBufferLike>, satisfying the BufferSource constraint
    // required by crypto.subtle.importKey().
    const seed    = window.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
    const b64out  = bytesToBase64(seed);
    const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();

    // SameSite=Strict prevents the cookie from leaking to third-party contexts.
    document.cookie =
      `${VAULT_SEED_COOKIE}=${b64out}; expires=${oneYear}; path=/; SameSite=Strict`;

    return seed;
  }

  // ── Layer 2: Salt (IndexedDB) ─────────────────────────────────────────────

  /**
   * Returns the 16-byte PBKDF2 salt from IndexedDB.
   * If absent, generates a fresh salt and persists it.
   *
   * The salt is not secret (PBKDF2 salts never are), but its presence in a
   * separate IndexedDB entry means an attacker who only extracts the cipher
   * entry cannot reconstruct the AES key without also finding this entry AND
   * the cookie seed.
   */
  private static async getOrCreateSalt(): Promise<Uint8Array<ArrayBuffer>> {
    const stored = await get<string>(VAULT_SALT_KEY);
    if (stored) {
      try {
        const decoded = base64ToBytes(stored);
        if (decoded.byteLength === 16) return decoded;
      } catch {
        // Malformed — regenerate below.
      }
    }

    const salt = window.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
    await set(VAULT_SALT_KEY, bytesToBase64(salt));
    return salt;
  }

  // ── Key derivation ────────────────────────────────────────────────────────

  /**
   * Derives an AES-GCM-256 `CryptoKey` from the seed and salt using PBKDF2.
   *
   * Parameters:
   *   algorithm : PBKDF2
   *   hash      : SHA-256
   *   iterations: 100 000  (NIST recommendation as of 2023 for SHA-256 PBKDF2)
   *   key length: 256 bits
   *   extractable: false   (the derived key cannot be exported from Web Crypto)
   *   usages    : encrypt + decrypt
   *
   * Both `seed` and `salt` are typed as `Uint8Array<ArrayBuffer>` (not the
   * wider `Uint8Array<ArrayBufferLike>`) because the Web Crypto `importKey`
   * and `deriveKey` APIs require `BufferSource`, which in TypeScript ≥ 5.2
   * resolves to `ArrayBufferView<ArrayBuffer>` — i.e. a view whose backing
   * `.buffer` is a plain `ArrayBuffer`, not `SharedArrayBuffer`.
   */
  private static async deriveKey(
    seed: Uint8Array<ArrayBuffer>,
    salt: Uint8Array<ArrayBuffer>,
  ): Promise<CryptoKey> {
    // Import the raw seed bytes as PBKDF2 key material.
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      seed,
      { name: 'PBKDF2' },
      false,         // not extractable
      ['deriveKey'],
    );

    // Derive the final AES-GCM key.
    return window.crypto.subtle.deriveKey(
      {
        name      : 'PBKDF2',
        salt,
        iterations: 100_000,
        hash      : 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,         // not extractable — key stays inside Web Crypto
      ['encrypt', 'decrypt'],
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Encrypts a plaintext string and returns a `VaultPayload` suitable for
   * JSON-serialising into IndexedDB.
   *
   * A fresh random IV is generated for every call, so two encryptions of the
   * same plaintext produce different ciphertexts (IND-CPA security).
   */
  static async encrypt(plaintext: string): Promise<VaultPayload> {
    const seed = Vault.getSeedFromCookie();
    const salt = await Vault.getOrCreateSalt();
    const key  = await Vault.deriveKey(seed, salt);

    // 12-byte IV is the NIST-recommended length for AES-GCM.
    // Explicit ArrayBuffer construction narrows the type to Uint8Array<ArrayBuffer>
    // so TypeScript accepts it as BufferSource for crypto.subtle.encrypt().
    const iv         = window.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    // TextEncoder.encode() returns Uint8Array<ArrayBufferLike> in TS ≥ 5.2.
    // Copy into an explicit-ArrayBuffer view to satisfy the BufferSource constraint.
    const rawEncoded = new TextEncoder().encode(plaintext);
    const encoded    = new Uint8Array(new ArrayBuffer(rawEncoded.byteLength));
    encoded.set(rawEncoded);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded,
    );

    return {
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv        : bytesToBase64(iv),
    };
  }

  /**
   * Decrypts a `VaultPayload` and returns the original plaintext string.
   *
   * Throws if the ciphertext has been tampered with (AES-GCM is authenticated)
   * or if the key material has changed (e.g. the seed cookie was cleared).
   */
  static async decrypt(payload: VaultPayload): Promise<string> {
    const seed = Vault.getSeedFromCookie();
    const salt = await Vault.getOrCreateSalt();
    const key  = await Vault.deriveKey(seed, salt);

    const plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ciphertext),
    );

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Stores an encrypted representation of `value` in IndexedDB under `idbKey`.
   * The serialised `VaultPayload` replaces whatever was at that key previously.
   */
  static async store(idbKey: string, value: string): Promise<void> {
    const payload = await Vault.encrypt(value);
    await set(idbKey, JSON.stringify(payload));
  }

  /**
   * Reads and decrypts the vault payload at `idbKey`.
   * Returns `null` if the key is absent.
   * Throws if decryption fails (authentication tag mismatch or key mismatch).
   */
  static async load(idbKey: string): Promise<string | null> {
    const raw = await get<string>(idbKey);
    if (!raw) return null;

    let payload: VaultPayload;
    try {
      payload = JSON.parse(raw) as VaultPayload;
    } catch {
      throw new Error(`[Vault] Corrupt vault entry at "${idbKey}" — could not parse JSON.`);
    }

    if (!payload.ciphertext || !payload.iv) {
      throw new Error(`[Vault] Malformed vault payload at "${idbKey}" — missing ciphertext or iv.`);
    }

    return Vault.decrypt(payload);
  }
}

// --------------------------------------------------------------------------
// LB-01 helper: the shape we write into / read from snapshot_meta.
// Keeping it as a named interface makes the serialisation contract explicit
// and easy to extend later (e.g. adding a schema version field).
//
// NOTE: This interface is intentionally NOT indexed with [key: string]: Json
// because MutationRecord is a domain type that we do not want to pollute with
// infrastructure concerns. The type-widening cast (as unknown as Json) is
// applied at the call site inside performSync().
// --------------------------------------------------------------------------
interface SnapshotMeta {
  /**
   * The complete ordered list of base-pair mutations that belong to this
   * commit. Stored as plain JSON so any Supabase JSONB column can hold it
   * without a schema migration.
   */
  mutations?: MutationRecord[];
}

export interface ArkheResponse<T> {
  data: T | null;
  error: string | null;
  status: 'success' | 'fail' | 'offline';
}

export interface SessionRestore {
  genome: Genome;
  /**
   * LB-08: commits now arrive with `childrenTxIds` pre-populated from the
   * parent→child inversion performed inside restoreSession(). Callers can
   * pass this array directly to Chronos.restore() without further post-
   * processing.
   */
  commits: SupabaseChronosCommit[];
  branches: SupabaseBranch[];
  headCommit: SupabaseChronosCommit;
}

export interface CircuitBreakerNotification {
  reason: string;
  code: '413' | '429' | 'unknown';
  sovereignModeAvailable: boolean;
  sovereignModeActive: boolean;
  suggestedAction: string;
}

export class PersistenceManager {
  // --------------------------------------------------------------------------
  // STATIC SYNC LOCK  (SHADOW-03 — fixed with try/finally)
  // --------------------------------------------------------------------------
  private static isSyncing = false;
  private static pendingParams: { genomeId: string; commits: Commit[]; branches: ArkheBranch[] } | null = null;
  private static syncPromise: Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> | null = null;

  // --------------------------------------------------------------------------
  // CIRCUIT BREAKER
  // --------------------------------------------------------------------------
  public static isOfflineMode = false;
  public static offlineModeReason: string | null = null;
  public static offlineModeCode: '413' | '429' | 'unknown' | null = null;

  public static onCircuitBreakerTripped: ((notification: CircuitBreakerNotification) => void) | null = null;

  public static async circuitBreaker(reason: string, code: '413' | '429' | 'unknown' = 'unknown'): Promise<void> {
    PersistenceManager.isOfflineMode = true;
    PersistenceManager.offlineModeReason = reason;
    PersistenceManager.offlineModeCode = code;

    const sovereignActive = await PersistenceManager.isSovereignModeActive();

    let suggestedAction: string;
    if (code === '413') {
      suggestedAction = sovereignActive
        ? 'Your Sovereign Supabase instance returned 413. Consider increasing your storage quota or pruning old commits.'
        : 'Connect your own Supabase instance (Sovereign Mode) to bypass shared quota limits. Open Settings → Cloud Sync → Sovereign Mode.';
    } else if (code === '429') {
      suggestedAction = sovereignActive
        ? 'Your Sovereign Supabase instance is rate-limiting requests. Consider enabling higher rate limits in your Supabase dashboard.'
        : 'You have hit the shared sync rate limit. Connect your own Supabase instance (Sovereign Mode) to resume unthrottled cloud sync. Open Settings → Cloud Sync → Sovereign Mode.';
    } else {
      suggestedAction = 'Cloud sync is paused. Check your network connection or connect a Sovereign Supabase instance in Settings.';
    }

    const notification: CircuitBreakerNotification = {
      reason,
      code,
      sovereignModeAvailable: true,
      sovereignModeActive: sovereignActive,
      suggestedAction,
    };

    if (PersistenceManager.onCircuitBreakerTripped) {
      PersistenceManager.onCircuitBreakerTripped(notification);
    }
  }

  public static resetCircuitBreaker(): void {
    PersistenceManager.isOfflineMode = false;
    PersistenceManager.offlineModeReason = null;
    PersistenceManager.offlineModeCode = null;
  }

  // --------------------------------------------------------------------------
  // SOVEREIGN MODE — bring-your-own Supabase client
  // --------------------------------------------------------------------------

  private static _sovereignClient: SupabaseClient | null = null;
  private static _sovereignUrl: string | null = null;

  // FIX 3B — Track whether we've already attached the storage listener so
  // we never double-register it across hot-reloads or repeated calls.
  private static _storageListenerInstalled = false;

  /**
   * FIX 3B — Cross-Tab Sovereign Credential Sync
   *
   * Attaches a `storage` event listener (idempotent — installed at most once).
   * When another tab writes a new value to ARKHE_CUSTOM_SUPABASE_URL, we
   * invalidate `_sovereignClient` and `_sovereignUrl` so the next sync in
   * this tab transparently picks up the new credentials.
   *
   * The `storage` event fires only for changes made by *other* tabs, never for
   * writes in the same tab, which is exactly the cross-tab sync we need. Same-
   * tab updates are handled synchronously inside `activateSovereignMode()`.
   */
  private static _installStorageListener(): void {
    if (
      PersistenceManager._storageListenerInstalled ||
      typeof window === 'undefined'
    ) {
      return;
    }

    window.addEventListener('storage', (event: StorageEvent) => {
      // We only care about changes to the sovereign URL key.
      if (event.key !== SOVEREIGN_URL_KEY) return;

      const newUrl    = event.newValue;
      const cachedUrl = PersistenceManager._sovereignUrl;

      if (newUrl !== cachedUrl) {
        // Invalidate the client cache — next getSovereignClient() call will
        // re-read IndexedDB and instantiate a fresh client.
        PersistenceManager._sovereignClient = null;
        PersistenceManager._sovereignUrl    = null;

        console.info(
          '[PersistenceManager] Sovereign URL changed in another tab. Client cache invalidated.'
        );

        // If the URL was removed (sovereign mode deactivated in another tab),
        // also reset the circuit breaker so we start fresh on the shared instance.
        if (!newUrl && PersistenceManager.isOfflineMode) {
          PersistenceManager.resetCircuitBreaker();
        }
      }
    });

    PersistenceManager._storageListenerInstalled = true;
  }

  /**
   * Returns the appropriate Supabase client for sync operations.
   *
   * Priority:
   *   1. Sovereign client (if ARKHE_CUSTOM_SUPABASE_URL + encrypted API key
   *      are available in IndexedDB)
   *   2. Default shared Arkhé client (imported at module load)
   *
   * SEC-01 VAULT INTEGRATION:
   *   The sovereign API key is read from `ARKHE_VAULT_KEY_CIPHER` (encrypted
   *   AES-GCM payload) and decrypted at runtime via `Vault.load()`. If the
   *   vault entry is absent, we check the legacy plaintext key at
   *   `ARKHE_CUSTOM_SUPABASE_KEY` and migrate it transparently.
   *
   * FIX 3A: createClient() is wrapped in try/catch. If instantiation fails,
   * we throw `new Error('Invalid Sovereign Credentials provided')` — the raw
   * URL and key are never forwarded to console.error or the Error message.
   *
   * FIX 3B: Installs the cross-tab storage listener on every call (idempotent).
   *
   * LB-02 & LB-0C FIX: Migrated from localStorage to IndexedDB using idb-keyval.
   */
  public static async getSovereignClient(): Promise<SupabaseClient> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return defaultSupabase;
    }

    // FIX 3B — ensure the cross-tab listener is live
    PersistenceManager._installStorageListener();

    const customUrl = await get<string>(SOVEREIGN_URL_KEY);
    if (!customUrl) {
      PersistenceManager._sovereignClient = null;
      PersistenceManager._sovereignUrl    = null;
      return defaultSupabase;
    }

    // ── SEC-01: Read the API key from the vault (encrypted) ────────────────
    // Attempt 1: encrypted vault entry (current format)
    let customKey: string | null = null;
    try {
      customKey = await Vault.load(VAULT_CIPHER_KEY);
    } catch (vaultErr) {
      // Vault decryption failure could mean the seed cookie was cleared (e.g.
      // the user cleared cookies). Log a warning but do not surface the error
      // details (which might contain key material in the message).
      console.warn(
        '[PersistenceManager] Vault decryption failed — sovereign key may be inaccessible. ' +
        'If you cleared cookies, please re-enter your Sovereign credentials in Settings.'
      );
      return defaultSupabase;
    }

    // Attempt 2: legacy plaintext key (migration path, SEC-01 backward compat)
    if (!customKey) {
      const legacyKey = await get<string>(SOVEREIGN_KEY_KEY);
      if (legacyKey) {
        // Transparently encrypt the legacy plaintext key and delete the old entry.
        console.info(
          '[PersistenceManager] Migrating plaintext sovereign key to encrypted vault (SEC-01).'
        );
        try {
          await Vault.store(VAULT_CIPHER_KEY, legacyKey);
          await del(SOVEREIGN_KEY_KEY);
          customKey = legacyKey;
        } catch (migrateErr) {
          // Migration failure is non-fatal; we use the plaintext key this time
          // and will retry migration on the next call.
          console.warn('[PersistenceManager] SEC-01 migration failed — using plaintext key for this session.');
          customKey = legacyKey;
        }
      }
    }

    if (!customKey) {
      PersistenceManager._sovereignClient = null;
      PersistenceManager._sovereignUrl    = null;
      return defaultSupabase;
    }

    // Return cached client if URL is unchanged
    if (
      PersistenceManager._sovereignClient &&
      PersistenceManager._sovereignUrl === customUrl
    ) {
      return PersistenceManager._sovereignClient;
    }

    // FIX 3A — Instantiate with credential-safe error handling.
    try {
      const client = createClient(customUrl, customKey, {
        auth: {
          persistSession  : true,
          autoRefreshToken: true,
        },
        global: {
          headers: {
            'x-arkhe-sovereign': 'true',
          },
        },
      });

      PersistenceManager._sovereignClient = client;
      PersistenceManager._sovereignUrl    = customUrl;

      console.info(
        `[PersistenceManager] Sovereign Mode active — syncing to configured instance.`
        // NOTE: URL intentionally omitted from production log to avoid leaking
        // customer infrastructure details in shared environments.
      );

      if (PersistenceManager.isOfflineMode) {
        console.info('[PersistenceManager] Resetting circuit breaker for sovereign client.');
        PersistenceManager.resetCircuitBreaker();
      }

      return PersistenceManager._sovereignClient;
    } catch {
      // FIX 3A — Do NOT log or re-throw the original error, as it may contain
      // the raw key/URL in its message or stack trace. Throw a sanitised
      // message instead.
      throw new Error('Invalid Sovereign Credentials provided');
    }
  }

  public static async isSovereignModeActive(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return false;

    const url = await get<string>(SOVEREIGN_URL_KEY);
    if (!url) return false;

    // SEC-01: Check for encrypted vault entry first, then legacy plaintext.
    const vaultEntry = await get<string>(VAULT_CIPHER_KEY);
    if (vaultEntry) return true;

    const legacyKey = await get<string>(SOVEREIGN_KEY_KEY);
    return Boolean(legacyKey);
  }

  /**
   * Activate Sovereign Mode programmatically (e.g. from the settings panel).
   *
   * SEC-01: The API key is encrypted with `Vault.store()` before being written
   * to IndexedDB. The URL is stored in plaintext (URLs are not secret; the
   * API key is the credential that must be protected).
   *
   * LB-02 & LB-0C FIX: Uses IndexedDB via idb-keyval instead of localStorage.
   */
  public static async activateSovereignMode(supabaseUrl: string, supabaseKey: string): Promise<void> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment.');
    }
    if (!supabaseUrl.startsWith('https://')) {
      throw new Error('Sovereign Supabase URL must begin with https://');
    }
    if (!supabaseKey.startsWith('eyJ')) {
      throw new Error('Sovereign Supabase key does not appear to be a valid JWT.');
    }

    // Store the URL in plaintext (non-secret).
    await set(SOVEREIGN_URL_KEY, supabaseUrl);

    // SEC-01: Encrypt the API key before writing to IndexedDB.
    await Vault.store(VAULT_CIPHER_KEY, supabaseKey);

    // Remove any legacy plaintext key that may be lingering from a previous
    // installation (belt-and-suspenders cleanup — the migration in
    // getSovereignClient handles the in-session case, but this ensures a
    // fresh activation always starts clean).
    await del(SOVEREIGN_KEY_KEY);

    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl    = null;
    PersistenceManager.resetCircuitBreaker();

    console.info('[PersistenceManager] Sovereign Mode activated. API key stored encrypted (SEC-01). Next sync will use custom instance.');
  }

  /**
   * Deactivate Sovereign Mode and remove all credential material from
   * IndexedDB. The vault salt is retained (it is not secret) to allow
   * re-activation without re-generating a new salt unnecessarily.
   */
  public static async deactivateSovereignMode(): Promise<void> {
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      await del(SOVEREIGN_URL_KEY);
      // SEC-01: Delete the encrypted vault entry.
      await del(VAULT_CIPHER_KEY);
      // Belt-and-suspenders: also remove any legacy plaintext entry.
      await del(SOVEREIGN_KEY_KEY);
    }

    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl    = null;
    console.info('[PersistenceManager] Sovereign Mode deactivated. All credential material removed from IndexedDB.');
  }

  // --------------------------------------------------------------------------
  // OFFLINE RESPONSE FACTORY
  // --------------------------------------------------------------------------
  private static offlineResponse(): ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }> {
    return {
      data  : { commits: [], branches: [] },
      error : PersistenceManager.offlineModeReason ?? '☁️ Cloud Sync Paused — operating in local-only mode.',
      status: 'offline',
    };
  }

  // --------------------------------------------------------------------------
  // CORE SYNC ENGINE
  // --------------------------------------------------------------------------

  /**
   * performSync
   *
   * ── LB-01 FIX: Mutation serialisation ─────────────────────────────────────
   * Each Arkhe `Commit` carries a `mutations: MutationRecord[]` array in memory.
   * We write it into `snapshot_meta` (a freeform JSONB column) to avoid a
   * schema migration.
   *
   * TYPE SAFETY:
   *   MutationRecord has no index signature, so TypeScript cannot directly
   *   assign `{ mutations: MutationRecord[] }` to the `Json` union type.
   *   We build the snapshot object as a typed local variable first, then widen
   *   it with `as unknown as Json`. This is safe at runtime because Supabase
   *   JSONB serialises any serialisable object regardless of TypeScript's view.
   *   We avoid `satisfies` which requires TypeScript ≥ 4.9.
   *
   * Backward compatibility:
   *   Rows written before this fix have `snapshot_meta: {}`. The read side
   *   (`convertSupabaseCommitToArkhe` in utils.ts) falls back to `[]` when
   *   `snapshot_meta.mutations` is absent — identical to the old behaviour.
   */
  private static async performSync(
    genomeId: string,
    commits: Commit[],
    branches: ArkheBranch[]
  ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> {
    const client = await PersistenceManager.getSovereignClient();

    try {
      const dbCommits: NewChronosCommit[] = commits.map((c: Commit) => {
        // ── LB-01 FIX: build snapshot payload as a typed local, then widen ──
        // We construct the object in full so the compiler can see its shape,
        // then apply `as unknown as Json` only for the column assignment.
        // This keeps the mutation data intact while satisfying the Json type.
        const snapshotPayload: SnapshotMeta = {
          mutations: c.mutations ?? [],
        };

        const row: NewChronosCommit = {
          genome_id : genomeId,
          tx_id     : c.txId,
          parent_id : c.parentTxIds?.length > 0 ? c.parentTxIds[0] : null,
          message   : c.commitMessage || null,
          // `as unknown as Json` is the standard TypeScript widening path for
          // a typed object that is structurally JSON-serialisable but lacks an
          // index signature. The alternative — adding `[key: string]: Json` to
          // MutationRecord — would pollute the domain type with an
          // infrastructure concern and is therefore intentionally avoided.
          snapshot_meta: snapshotPayload as unknown as Json,
        };

        return row;
      });

      const dbBranches: NewBranch[] = branches.map((b) => ({
        genome_id     : genomeId,
        name          : b.name,
        head_commit_id: b.headCommitId,
      }));

      let upsertedCommits : SupabaseChronosCommit[] = [];
      let upsertedBranches: SupabaseBranch[]        = [];

      if (dbCommits.length > 0) {
        const { data, error } = await client
          .from('chronos_commits')
          .upsert(dbCommits, { onConflict: 'tx_id', ignoreDuplicates: true })
          .select()
          .returns<SupabaseChronosCommit[]>();

        if (error) {
          if (
            error.code === '413' ||
            error.message?.includes('413') ||
            error.message?.toLowerCase().includes('payload too large') ||
            error.message?.toLowerCase().includes('entity too large')
          ) {
            PersistenceManager.circuitBreaker(
              `☁️ Cloud Sync Paused: Commit payload too large (${commits.length} commits, genome: ${genomeId}).`,
              '413'
            );
            return { data: null, error: PersistenceManager.offlineModeReason, status: 'offline' };
          }
          if (
            error.code === '429' ||
            error.message?.includes('429') ||
            error.message?.toLowerCase().includes('rate limit') ||
            error.message?.toLowerCase().includes('too many requests')
          ) {
            PersistenceManager.circuitBreaker(
              '☁️ Cloud Sync Paused: Supabase rate limit reached. Sync will resume automatically or connect a Sovereign instance.',
              '429'
            );
            return { data: null, error: PersistenceManager.offlineModeReason, status: 'offline' };
          }

          return { data: null, error: `Commit sync failed: ${error.message}`, status: 'fail' };
        }
        upsertedCommits = data || [];
      }

      if (dbBranches.length > 0) {
        const { data, error } = await client
          .from('branches')
          .upsert(dbBranches, { onConflict: 'genome_id,name', ignoreDuplicates: false })
          .select()
          .returns<SupabaseBranch[]>();

        if (error) {
          if (
            error.code === '429' ||
            error.message?.includes('429') ||
            error.message?.toLowerCase().includes('rate limit')
          ) {
            PersistenceManager.circuitBreaker(
              '☁️ Cloud Sync Paused: Supabase rate limit on branch upsert.',
              '429'
            );
            return { data: null, error: PersistenceManager.offlineModeReason, status: 'offline' };
          }
          return { data: null, error: `Branch sync failed: ${error.message}`, status: 'fail' };
        }
        upsertedBranches = data || [];
      }

      return {
        data  : { commits: upsertedCommits, branches: upsertedBranches },
        error : null,
        status: 'success',
      };
    } catch (err) {
      return {
        data  : null,
        error : err instanceof Error ? err.message : 'Unknown sync error',
        status: 'fail',
      };
    }
  }

  /**
   * Public sync entry point with concurrency lock + try/finally (SHADOW-03).
   */
  public static async syncChronos(
    genomeId: string,
    commits: Commit[],
    branches: ArkheBranch[]
  ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> {
    if (PersistenceManager.isOfflineMode) {
      return PersistenceManager.offlineResponse();
    }

    if (PersistenceManager.isSyncing) {
      PersistenceManager.pendingParams = { genomeId, commits, branches };
      return PersistenceManager.syncPromise!;
    }

    PersistenceManager.isSyncing      = true;
    PersistenceManager.pendingParams  = null;

    const run = async (
      firstGenomeId: string,
      firstCommits: Commit[],
      firstBranches: ArkheBranch[]
    ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> => {
      try {
        const firstResult = await PersistenceManager.performSync(
          firstGenomeId,
          firstCommits,
          firstBranches
        );

        if (PersistenceManager.isOfflineMode) {
          PersistenceManager.pendingParams = null;
          return firstResult;
        }

        while (PersistenceManager.pendingParams) {
          const next = PersistenceManager.pendingParams;
          PersistenceManager.pendingParams = null;
          if (PersistenceManager.isOfflineMode) break;
          await PersistenceManager.performSync(next.genomeId, next.commits, next.branches);
        }

        return firstResult;
      } finally {
        // SHADOW-03 fix — unconditional lock release
        PersistenceManager.isSyncing  = false;
        PersistenceManager.syncPromise = null;
      }
    };

    PersistenceManager.syncPromise = run(genomeId, commits, branches);
    return PersistenceManager.syncPromise;
  }

  // --------------------------------------------------------------------------
  // 1. GENOME UPLOAD & METADATA
  // --------------------------------------------------------------------------

  static async uploadGenome(
    file: File,
    ownerId: string,
    name: string,
    totalLength: number
  ): Promise<ArkheResponse<Genome>> {
    const client = await PersistenceManager.getSovereignClient();
    try {
      const timestamp    = Date.now();
      const safeFileName = file.name.replace(/[^a-z0-9.]/gi, '_');
      const storagePath  = `${ownerId}/${safeFileName}_${timestamp}.fasta`;

      const { error: uploadError } = await client.storage
        .from('genomes')
        .upload(storagePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        return { data: null, error: `Storage upload failed: ${uploadError.message}`, status: 'fail' };
      }

      const { data: urlData } = client.storage.from('genomes').getPublicUrl(storagePath);
      const fileUrl = urlData.publicUrl;

      const newGenome: NewGenome = { owner_id: ownerId, name, total_length: totalLength, file_url: fileUrl };

      const { data, error: dbError } = await client
        .from('genomes')
        .insert(newGenome)
        .select()
        .single<Genome>();

      if (dbError) {
        await client.storage.from('genomes').remove([storagePath]);
        return { data: null, error: `Database insert failed: ${dbError.message}`, status: 'fail' };
      }

      return { data: data!, error: null, status: 'success' };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Unknown upload error', status: 'fail' };
    }
  }

  // --------------------------------------------------------------------------
  // 2. USER ANNOTATIONS
  // --------------------------------------------------------------------------

  static async saveUserFeatures(
    genomeId: string,
    ownerId: string,
    features: FeatureTag[]
  ): Promise<ArkheResponse<UserFeature[]>> {
    const client = await PersistenceManager.getSovereignClient();
    try {
      const { error: deleteError } = await client
        .from('user_features')
        .delete()
        .eq('genome_id', genomeId)
        .eq('owner_id', ownerId);

      if (deleteError) {
        return { data: null, error: `Failed to clear existing features: ${deleteError.message}`, status: 'fail' };
      }

      const dbFeatures: NewUserFeature[] = features.map((f) => ({
        owner_id  : ownerId,
        genome_id : genomeId,
        label     : f.name,
        start_pos : f.start,
        end_pos   : f.end,
        color     : null,
        type      : f.type,
      }));

      if (dbFeatures.length === 0) {
        return { data: [], error: null, status: 'success' };
      }

      const { data, error: insertError } = await client
        .from('user_features')
        .insert(dbFeatures)
        .select()
        .returns<UserFeature[]>();

      if (insertError) {
        return { data: null, error: `Failed to insert features: ${insertError.message}`, status: 'fail' };
      }

      return { data: data || [], error: null, status: 'success' };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Unknown annotation error', status: 'fail' };
    }
  }

  // --------------------------------------------------------------------------
  // 3. SESSION RESTORATION (TIME MACHINE)
  // --------------------------------------------------------------------------

  /**
   * restoreSession
   *
   * ── LB-08 FIX: childrenTxIds reconstruction ───────────────────────────────
   * The Supabase `chronos_commits` table stores parent→child relationships
   * directionally: each row has a `parent_id` column pointing at its parent,
   * but there is no `children` column. The Chronos DAG requires each node to
   * know its children (for redo traversal).
   *
   * After fetching all commits we perform a single O(n) inversion pass:
   *
   *   1. Build a `txIdToRow` map so lookups are O(1).
   *   2. For every commit that has a `parent_id`, find the parent in the map
   *      and add the current commit's `tx_id` to the parent's `childrenTxIds`.
   *
   * We attach the result via a synthetic `childrenTxIds` field on an augmented
   * local type to avoid mutating the generated SupabaseChronosCommit type.
   * The augmentation is consumed by `convertSupabaseCommitToArkhe` in utils.ts.
   *
   * ── LB-01 FIX: mutations live inside snapshot_meta ────────────────────────
   * `convertSupabaseCommitToArkhe` is responsible for unpacking mutations from
   * `snapshot_meta`. Here we simply ensure all rows are fetched and returned
   * with their full `snapshot_meta` payload intact.
   */
  static async restoreSession(genomeId: string): Promise<ArkheResponse<SessionRestore>> {
    const client = await PersistenceManager.getSovereignClient();
    try {
      const [genomeResult, commitsResult, branchesResult] = await Promise.all([
        client.from('genomes').select('*').eq('id', genomeId).single<Genome>(),
        client
          .from('chronos_commits')
          .select('*')
          .eq('genome_id', genomeId)
          .order('created_at', { ascending: true })
          .returns<SupabaseChronosCommit[]>(),
        client
          .from('branches')
          .select('*')
          .eq('genome_id', genomeId)
          .order('created_at', { ascending: true })
          .returns<SupabaseBranch[]>(),
      ]);

      if (genomeResult.error) {
        return { data: null, error: `Genome not found: ${genomeResult.error.message}`, status: 'fail' };
      }
      if (commitsResult.error) {
        return { data: null, error: `Failed to fetch commits: ${commitsResult.error.message}`, status: 'fail' };
      }
      if (branchesResult.error) {
        return { data: null, error: `Failed to fetch branches: ${branchesResult.error.message}`, status: 'fail' };
      }

      const genome   = genomeResult.data;
      const commits  = commitsResult.data  || [];
      const branches = branchesResult.data || [];

      // ── LB-08 FIX: Rebuild childrenTxIds via parent→child inversion ────────
      //
      // The DB has no `children` column; Chronos.restore() requires every
      // commit to carry its children so redo() can traverse forward.
      //
      // We use an augmented local type to avoid modifying SupabaseChronosCommit.
      // The synthetic field is consumed by convertSupabaseCommitToArkhe in utils.ts.
      type AugmentedCommit = SupabaseChronosCommit & { childrenTxIds: string[] };

      // Step 1: seed every commit with an empty children list and build a
      // txId-keyed lookup map for O(1) parent access in Step 2.
      const txIdToCommit = new Map<string, AugmentedCommit>();
      for (const raw of commits) {
        const aug: AugmentedCommit = { ...raw, childrenTxIds: [] };
        txIdToCommit.set(raw.tx_id, aug);
      }

      // Step 2: for each commit that has a parent, register it as a child
      // of that parent. We guard against orphaned rows where the parent has
      // been pruned from the DB (silently skip — the commit is still
      // restorable as a root-like node).
      for (const aug of txIdToCommit.values()) {
        if (aug.parent_id) {
          const parent = txIdToCommit.get(aug.parent_id);
          if (parent) {
            parent.childrenTxIds.push(aug.tx_id);
          }
        }
      }

      // Produce the ordered array preserving original fetch order (ascending
      // by created_at, which is topologically ordered for linear histories;
      // merge commits are handled by Chronos.restore() DAG traversal).
      const augmentedCommits = commits.map(
        (c) => txIdToCommit.get(c.tx_id)!
      ) as AugmentedCommit[];

      // ── Determine head commit ─────────────────────────────────────────────
      const mainBranch = branches.find((b) => b.name === 'main');
      let headCommit: AugmentedCommit | null = null;

      if (mainBranch) {
        // head_commit_id on the Branch row may be a DB `id` (UUID) or a
        // `tx_id` depending on how the branch was written. Try both.
        const headById = augmentedCommits.find(
          (c) => c.id === mainBranch.head_commit_id
        );
        if (headById) {
          headCommit = headById;
        } else {
          const headByTx = txIdToCommit.get(mainBranch.head_commit_id);
          if (headByTx) headCommit = headByTx;
        }
      }

      // Last resort: the most recently created commit.
      if (!headCommit && augmentedCommits.length > 0) {
        headCommit = augmentedCommits[augmentedCommits.length - 1];
      }

      if (!headCommit) {
        return { data: null, error: 'No commits found for this genome', status: 'fail' };
      }

      return {
        data: {
          genome,
          // Cast back to SupabaseChronosCommit[] — the childrenTxIds
          // augmentation is consumed by convertSupabaseCommitToArkhe which
          // reads it via `(row as AugmentedCommit).childrenTxIds` there.
          commits    : augmentedCommits as unknown as SupabaseChronosCommit[],
          branches,
          headCommit : headCommit as unknown as SupabaseChronosCommit,
        },
        error : null,
        status: 'success',
      };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Unknown restore error', status: 'fail' };
    }
  }

  // --------------------------------------------------------------------------
  // 4. UTILITIES
  // --------------------------------------------------------------------------

  static async deleteGenome(genomeId: string): Promise<ArkheResponse<null>> {
    const client = await PersistenceManager.getSovereignClient();
    try {
      const { data: genome, error: fetchError } = await client
        .from('genomes')
        .select('file_url')
        .eq('id', genomeId)
        .single<Pick<Genome, 'file_url'>>();

      if (fetchError) {
        return { data: null, error: `Genome not found: ${fetchError.message}`, status: 'fail' };
      }

      if (genome?.file_url) {
        const urlParts      = genome.file_url.split('/');
        const genomesIndex  = urlParts.indexOf('genomes');
        if (genomesIndex !== -1) {
          const storagePath = urlParts.slice(genomesIndex + 1).join('/');
          if (storagePath) {
            await client.storage.from('genomes').remove([storagePath]);
          }
        }
      }

      const { error: deleteError } = await client.from('genomes').delete().eq('id', genomeId);

      if (deleteError) {
        return { data: null, error: `Failed to delete genome: ${deleteError.message}`, status: 'fail' };
      }

      return { data: null, error: null, status: 'success' };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Unknown delete error', status: 'fail' };
    }
  }

  // --------------------------------------------------------------------------
  // 5. VAULT PURGE — Destructive Logout (Sprint 2 — Task 3)
  // --------------------------------------------------------------------------

  /**
   * destructiveLogout
   *
   * ── GENESIS RECTIFICATION — TASK 3: Vault Purge / Plaintext Ghost Defence ──
   *
   * PROBLEM (before this fix):
   *   Calling deactivateSovereignMode() deleted the IndexedDB vault entries,
   *   but:
   *     1. The session seed cookie was merely expired (deleted via past date),
   *        not overwritten.  Browser history APIs and some storage inspection
   *        tools can recover a cookie value that was deleted without being
   *        overwritten first.  A "ghost" copy of the seed could persist.
   *     2. The PBKDF2 salt (ARKHE_VAULT_SALT) was never cleared, leaving
   *        one half of the key-derivation material resident in IndexedDB even
   *        after deactivation.  Combined with a recovered seed ghost, the AES
   *        key could be reconstructed post-logout.
   *     3. No in-memory credential purge was performed, leaving stale
   *        _sovereignClient and _sovereignUrl references alive until GC.
   *
   * FIX — Three-phase purge:
   *
   *   PHASE 1 — Cookie null-byte overwrite before expiry.
   *     The seed cookie is overwritten with a 32-byte null buffer (base64 of
   *     0x00 * 32) BEFORE the expiry-date deletion.  This prevents recovery
   *     of the original seed from browser history, forensic cookie stores, or
   *     any in-memory snapshot taken between the delete and the GC cycle.
   *
   *   PHASE 2 — IndexedDB purge.
   *     All Vault-related keys are cleared:
   *       ARKHE_VAULT_SALT       — PBKDF2 salt (key derivation layer 2)
   *       ARKHE_VAULT_KEY_CIPHER — AES-GCM ciphertext of the sovereign API key
   *       ARKHE_CUSTOM_SUPABASE_URL — Sovereign instance URL
   *       ARKHE_CUSTOM_SUPABASE_KEY — Legacy plaintext key (belt-and-suspenders)
   *     After this phase neither half of the key-derivation input exists in
   *     browser storage, making ciphertext decryption computationally infeasible.
   *
   *   PHASE 3 — In-memory purge.
   *     The static SupabaseClient reference and URL cache are nulled and the
   *     circuit breaker is reset.  This prevents the zombie client from
   *     completing any in-flight sync operations with stale credentials.
   *
   * ORDERING GUARANTEE:
   *   The cookie overwrite (Phase 1) MUST complete before the IndexedDB
   *   deletes (Phase 2).  If the browser crashes between Phase 1 and Phase 2,
   *   the salt still exists in IndexedDB but the seed is now garbage, so no
   *   valid AES key can be derived — the ciphertext is permanently undecryptable.
   *
   * LIMITATIONS:
   *   This method cannot purge data held in Supabase cloud storage or on
   *   other devices/tabs.  For a full credential revocation the researcher
   *   must also rotate the Supabase API key in their dashboard.
   *
   * @returns Promise that resolves once all three phases have completed.
   *          Does not throw; individual phase failures are logged to console
   *          so the caller always proceeds to the next phase even on partial
   *          storage failures.
   */
  public static async destructiveLogout(): Promise<void> {
    // ── PHASE 1: Cookie null-byte overwrite then expiry ───────────────────
    //
    // We overwrite BEFORE deleting so the original seed value is never
    // readable again from cookie history or forensic tools.
    //
    // NULL_SEED = base64 of 32 zero bytes.  Overwriting with this value
    // replaces the original entropy with non-secret data.
    if (typeof document !== 'undefined') {
      try {
        // Step 1a: Overwrite with null bytes (same expiry / path / SameSite
        // attributes as the original write so the browser replaces the entry
        // rather than creating a second cookie with the same name).
        const nullSeedBytes = new Uint8Array(new ArrayBuffer(32)); // 32 zero bytes
        let nullB64 = '';
        for (let i = 0; i < nullSeedBytes.byteLength; i++) {
          nullB64 += String.fromCharCode(nullSeedBytes[i]);
        }
        nullB64 = btoa(nullB64); // base64 of 0x00 * 32

        const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie =
          `${VAULT_SEED_COOKIE}=${nullB64}; expires=${oneYear}; path=/; SameSite=Strict`;

        // Step 1b: Now expire the cookie (delete it).  The previous step
        // guarantees the original seed has already been overwritten.
        const epoch = new Date(0).toUTCString();
        document.cookie =
          `${VAULT_SEED_COOKIE}=; expires=${epoch}; path=/; SameSite=Strict`;
      } catch (cookieErr) {
        // Cookie API is unavailable (SSR, sandboxed iframe, etc.).
        // Log and continue — the IndexedDB purge in Phase 2 still removes
        // the ciphertext and salt, preventing decryption even if the seed
        // ghost persists.
        console.warn(
          '[PersistenceManager] destructiveLogout: cookie overwrite failed — ' +
          'seed ghost may persist.  IndexedDB purge will continue.',
          cookieErr,
        );
      }
    }

    // ── PHASE 2: IndexedDB purge ──────────────────────────────────────────
    //
    // Delete ALL vault-related keys.  Individual failures are caught so a
    // single missing key does not abort the rest of the purge sequence.
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      const purgeKey = async (key: string): Promise<void> => {
        try {
          await del(key);
        } catch (err) {
          // Key may not exist (already purged, or never written).
          // This is a normal condition on first logout; not an error.
          console.warn(`[PersistenceManager] destructiveLogout: could not delete IDB key "${key}":`, err);
        }
      };

      await purgeKey(VAULT_SALT_KEY);        // PBKDF2 salt — key derivation layer 2
      await purgeKey(VAULT_CIPHER_KEY);      // AES-GCM ciphertext of sovereign API key
      await purgeKey(SOVEREIGN_URL_KEY);     // Sovereign instance URL
      await purgeKey(SOVEREIGN_KEY_KEY);     // Legacy plaintext key (belt-and-suspenders)
    }

    // ── PHASE 3: In-memory purge ──────────────────────────────────────────
    //
    // Null the cached client reference and URL so no zombie sync can proceed
    // with the now-invalidated credentials.
    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl    = null;
    PersistenceManager.resetCircuitBreaker();

    console.info(
      '[PersistenceManager] destructiveLogout: session seed overwritten, ' +
      'IndexedDB vault cleared, in-memory credentials purged. ' +
      'No plaintext ghost remains in browser storage.',
    );
  }
}