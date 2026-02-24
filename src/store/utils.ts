/**
 * src/store/utils.ts
 *
 * Pure, side-effect-free helpers shared across store slices.
 * No Zustand imports live here — this module is safe to import from unit tests
 * without spinning up any store infrastructure.
 *
 * ── CONTENTS ─────────────────────────────────────────────────────────────────
 *  1. generateId           — crypto-safe UUID with legacy fallback
 *  2. postAndWait          — typed worker round-trip with timeout + leak fix
 *  3. validateSovereignUrl — CF-06 URL sanitisation (5-gate pipeline)
 *  4. convertSupabaseCommitToArkhe / convertSupabaseBranchToArkhe
 */

import type { Commit, Branch } from './types';
import type {
  ChronosCommit as SupabaseChronosCommit,
  Branch as SupabaseBranch,
} from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · generateId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a crypto-safe UUID in browsers that expose `crypto.randomUUID`,
 * falling back to a timestamp + random suffix for environments that don't
 * (e.g. older iOS WebViews, some Jest configs).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · postAndWait
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long (ms) to wait for a worker reply before declaring the worker dead.
 *
 * AUDIT III FIX (SHADOW-01): races every postAndWait call against this
 * deadline so a crashed worker cannot permanently freeze the UI.
 */
export const POST_AND_WAIT_TIMEOUT_MS = 30_000;

/**
 * Send a typed message to the ArkheEngine worker and await its reply.
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 * SPRINT 5 — Memory Leak (FIX 1):
 *   The `handler` reference is declared in the outer closure so it can be
 *   removed on BOTH the success path (inside the listener itself) AND the
 *   timeout rejection path.  Before this fix the listener was anonymous and
 *   could only be removed from the success path, leading to unbounded handler
 *   accumulation on every worker crash / hang.
 *
 * AUDIT III — SHADOW-01 (FIX 3):
 *   The roundTrip Promise races against a 30-second timeout.  If the worker
 *   fails to reply, the timeout branch removes the orphaned listener and
 *   rejects with a descriptive WorkerTimeoutError.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param worker    The Worker instance to communicate with.
 * @param type      The message type string recognised by ArkheEngine.worker.ts.
 * @param payload   Optional structured payload — must be structured-cloneable.
 * @param transfer  Optional Transferable array (e.g. ArrayBuffers to move, not copy).
 * @returns         A Promise that resolves with the typed payload from the worker,
 *                  or rejects with a descriptive error on worker error / timeout.
 */
export function postAndWait<T = unknown>(
  worker: Worker,
  type: string,
  payload?: unknown,
  transfer?: Transferable[],
): Promise<T> {
  // `handler` is hoisted so the timeout branch can reference it for cleanup.
  let handler: ((e: MessageEvent) => void) | null = null;

  const roundTrip = new Promise<T>((resolve, reject) => {
    const id = generateId();

    handler = (e: MessageEvent) => {
      if (e.data.id !== id) return; // not our reply

      // Guaranteed cleanup on success — prevents the leak fixed in SPRINT 5.
      worker.removeEventListener('message', handler!);
      handler = null;

      if (e.data.type === 'ERROR') {
        reject(new Error(e.data.payload.message));
      } else {
        resolve(e.data.payload as T);
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ type, id, payload }, transfer ?? []);
  });

  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      // Remove the orphaned listener before rejecting (the SPRINT 5 leak fix
      // applies equally to the timeout path).
      if (handler) {
        worker.removeEventListener('message', handler);
        handler = null;
      }

      reject(
        new Error(
          `Worker message '${type}' timed out after ${POST_AND_WAIT_TIMEOUT_MS / 1_000} s. ` +
            `The worker may have crashed. Try reconnecting.`,
        ),
      );
    }, POST_AND_WAIT_TIMEOUT_MS);

    // Allow the Node.js process to exit even if this timer is still pending
    // (relevant for SSR / test environments).
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });

  return Promise.race([roundTrip, timeout]);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · validateSovereignUrl  (CF-06 — Sovereign URL Sanitisation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regex applied to the *parsed* hostname only — never to the raw URL string.
 *
 * Applying the allowlist to `parsed.hostname` defeats bypasses through:
 *   • Unicode normalisation (e.g. Ⅰ → I)
 *   • Percent-encoding (e.g. %73upabase.co)
 *   • Trailing dots used to force FQDN treatment (stripped separately below)
 *
 * Pattern breakdown:
 *   ^                  — start of hostname
 *   (?:                — non-capturing outer group
 *     [a-z0-9-]+       — Supabase project ref: lowercase alphanum + hyphens
 *     \.supabase\.co   — only permitted cloud TLD
 *   |                  — OR
 *     localhost        — local development / self-hosted dev via TLS terminator
 *   )
 *   $                  — end — no trailing dots, no sub-path tricks
 */
const SOVEREIGN_HOSTNAME_REGEX = /^(?:[a-z0-9-]+\.supabase\.co|localhost)$/;

/**
 * Validates `rawUrl` against the Sovereign Mode URL policy and returns the
 * sanitised `origin` string (scheme + host + port only) on success.
 *
 * Throws a descriptive `Error` — surface its `.message` directly in the UI —
 * on any policy violation.
 *
 * ── FIVE-GATE PIPELINE ───────────────────────────────────────────────────────
 *
 * Gate 1 — Structural parse (WHATWG URL constructor)
 *   Rejects anything that is not a syntactically valid URL.
 *
 * Gate 2 — Scheme enforcement
 *   • `https:` — always accepted.
 *   • `http:`  — accepted only when the target is localhost/127.0.0.1 (dev).
 *   • Everything else (ftp:, data:, javascript:, …) — rejected.
 *
 * Gate 3 — Embedded credential guard
 *   Rejects URLs of the form `https://user:pass@host` to prevent silent
 *   credential loss after origin normalisation.
 *
 * Gate 4 — Hostname allowlist
 *   The *parsed* (normalised) hostname is tested against
 *   `SOVEREIGN_HOSTNAME_REGEX`.  Only `*.supabase.co` and `localhost` pass.
 *   IP addresses and arbitrary domains are rejected to prevent SSRF.
 *
 * Gate 5 — Path / search / hash stripping
 *   PersistenceManager expects a bare origin.  Any path, query string, or
 *   fragment is stripped with a console.warn so the researcher knows their
 *   input was normalised.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Extracted as a pure helper so it can be tested in isolation without a store.
 */
export function validateSovereignUrl(rawUrl: string): string {
  // ── Gate 1: Structural parse ──────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `Invalid Sovereign Mode URL — could not parse "${rawUrl}". ` +
        `Expected format: https://<project>.supabase.co`,
    );
  }

  // ── Gate 2: Scheme enforcement ────────────────────────────────────────────
  const isLocalhostTarget =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (parsed.protocol === 'http:' && !isLocalhostTarget) {
    throw new Error(
      `Sovereign Mode URL must use HTTPS for non-localhost endpoints. ` +
        `Received: "${parsed.protocol}//${parsed.hostname}"`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Sovereign Mode URL scheme "${parsed.protocol}" is not permitted. ` +
        `Only https:// (and http://localhost for dev) are accepted.`,
    );
  }

  // ── Gate 3: Embedded credential guard ────────────────────────────────────
  if (parsed.username || parsed.password) {
    throw new Error(
      `Sovereign Mode URL must not contain embedded credentials. ` +
        `Please provide the API key via the separate key field.`,
    );
  }

  // ── Gate 4: Hostname allowlist ────────────────────────────────────────────
  // Strip a trailing dot before applying the regex so that FQDN notation
  // ("foo.supabase.co.") does not slip through.
  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();

  if (!SOVEREIGN_HOSTNAME_REGEX.test(hostname)) {
    throw new Error(
      `Sovereign Mode URL hostname "${hostname}" is not permitted. ` +
        `Allowed: *.supabase.co (cloud) or localhost (dev). ` +
        `IP addresses and other domains are not accepted to prevent data exfiltration.`,
    );
  }

  // ── Gate 5: Path / search / hash stripping ────────────────────────────────
  const normalisedUrl = parsed.origin; // scheme + host + port only

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    console.warn(
      `[Arkhé] activateSovereignMode: URL had unexpected path/query/hash — ` +
        `these have been stripped. Using: ${normalisedUrl}`,
    );
  }

  return normalisedUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · Supabase → Arkhé entity converters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a Supabase `chronos_commits` row to the internal `Commit` type used by
 * the Arkhé engine and Chronos UI components.
 *
 * Supabase uses snake_case column names and ISO-8601 timestamps; the internal
 * type uses camelCase and Unix millisecond timestamps.
 */
export function convertSupabaseCommitToArkhe(commit: SupabaseChronosCommit): Commit {
  return {
    txId: commit.tx_id,
    parentTxIds: commit.parent_id ? [commit.parent_id] : [],
    childrenTxIds: [],
    mutations: [],
    timestamp: commit.created_at ? new Date(commit.created_at).getTime() : Date.now(),
    author: undefined,
    commitMessage: commit.message ?? undefined,
    branchName: undefined,
    isCheckpoint: false,
  };
}

/**
 * Maps a Supabase `branches` row to the internal `Branch` type.
 */
export function convertSupabaseBranchToArkhe(branch: SupabaseBranch): Branch {
  return {
    name: branch.name,
    headCommitId: branch.head_commit_id,
    createdAt: branch.created_at ? new Date(branch.created_at).getTime() : Date.now(),
  };
}