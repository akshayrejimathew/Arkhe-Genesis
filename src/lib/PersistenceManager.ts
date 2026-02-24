// src/lib/PersistenceManager.ts
/**
 * PersistenceManager.ts
 * Cloud sync, genome upload, session restoration, and annotation persistence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 2 SECURITY FIXES (2026-02-22)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   FIX 3A — Sovereign Credential Leak Prevention:
 *     `getSovereignClient()` wraps `createClient()` in a try/catch. If
 *     instantiation fails (e.g. the JWT is structurally invalid and the
 *     Supabase SDK throws internally), the raw key is NOT passed to
 *     `console.error` and is NOT included in the re-thrown Error message.
 *     Instead we throw `new Error('Invalid Sovereign Credentials provided')`.
 *     This prevents the JWT from appearing in browser DevTools console output,
 *     Sentry breadcrumbs, or any other error-logging pipeline.
 *
 *   FIX 3B — Cross-Tab Sovereign Credential Sync:
 *     `_installStorageListener()` attaches a `window.storage` event listener
 *     (once) that fires whenever localStorage changes in *another* browser tab.
 *     If the listener sees `ARKHE_CUSTOM_SUPABASE_URL` change, it invalidates
 *     the cached `_sovereignClient` and `_sovereignUrl`. The next sync call in
 *     this tab will then pick up the new credentials automatically, without
 *     requiring a page reload.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 1 FIXES (2026-02-21) — retained below
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   SHADOW-03 — try/finally guarantees sync lock release on network failure.
 *   CIRCUIT BREAKER — 413 / 429 offline mode.
 *   SOVEREIGN MODE — bring-your-own Supabase instance.
 */

import { supabase as defaultSupabase } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Genome,
  ChronosCommit as SupabaseChronosCommit,
  Branch as SupabaseBranch,
  UserFeature,
  NewGenome,
  NewChronosCommit,
  NewBranch,
  NewUserFeature,
} from '@/lib/supabase';
import type { Commit, Branch as ArkheBranch, FeatureTag } from '@/types/arkhe';

// --------------------------------------------------------------------------
// localStorage keys for Sovereign Mode
// --------------------------------------------------------------------------
const SOVEREIGN_URL_KEY = 'ARKHE_CUSTOM_SUPABASE_URL';
const SOVEREIGN_KEY_KEY = 'ARKHE_CUSTOM_SUPABASE_KEY';

export interface ArkheResponse<T> {
  data: T | null;
  error: string | null;
  status: 'success' | 'fail' | 'offline';
}

export interface SessionRestore {
  genome: Genome;
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

  public static circuitBreaker(reason: string, code: '413' | '429' | 'unknown' = 'unknown'): void {
    PersistenceManager.isOfflineMode = true;
    PersistenceManager.offlineModeReason = reason;
    PersistenceManager.offlineModeCode = code;

    const sovereignActive = PersistenceManager.isSovereignModeActive();

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

      const newUrl = event.newValue;
      const cachedUrl = PersistenceManager._sovereignUrl;

      if (newUrl !== cachedUrl) {
        // Invalidate the client cache — next getSovereignClient() call will
        // re-read localStorage and instantiate a fresh client.
        PersistenceManager._sovereignClient = null;
        PersistenceManager._sovereignUrl = null;

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
   *   1. Sovereign client (if ARKHE_CUSTOM_SUPABASE_URL + ARKHE_CUSTOM_SUPABASE_KEY
   *      are set in localStorage)
   *   2. Default shared Arkhé client (imported at module load)
   *
   * The sovereign client is lazily instantiated and cached. If the URL in
   * localStorage changes (e.g. user updates credentials in this tab via
   * activateSovereignMode(), or another tab changes it via the storage event
   * listener), the cache is invalidated and a new client is created.
   *
   * FIX 3A: createClient() is wrapped in try/catch. If instantiation fails,
   * we throw `new Error('Invalid Sovereign Credentials provided')` — the raw
   * URL and key are never forwarded to console.error or the Error message.
   *
   * FIX 3B: Installs the cross-tab storage listener on every call (idempotent).
   */
  public static getSovereignClient(): SupabaseClient {
    if (typeof localStorage === 'undefined') {
      return defaultSupabase;
    }

    // FIX 3B — ensure the cross-tab listener is live
    PersistenceManager._installStorageListener();

    const customUrl = localStorage.getItem(SOVEREIGN_URL_KEY);
    const customKey = localStorage.getItem(SOVEREIGN_KEY_KEY);

    if (!customUrl || !customKey) {
      PersistenceManager._sovereignClient = null;
      PersistenceManager._sovereignUrl = null;
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
    // The raw `customUrl` / `customKey` are intentionally withheld from the
    // catch block so they cannot appear in DevTools or error-monitoring tools.
    try {
      const client = createClient(customUrl, customKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
        global: {
          headers: {
            'x-arkhe-sovereign': 'true',
          },
        },
      });

      PersistenceManager._sovereignClient = client;
      PersistenceManager._sovereignUrl = customUrl;

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

  public static isSovereignModeActive(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const url = localStorage.getItem(SOVEREIGN_URL_KEY);
    const key = localStorage.getItem(SOVEREIGN_KEY_KEY);
    return Boolean(url && key);
  }

  /**
   * Activate Sovereign Mode programmatically (e.g. from the settings panel).
   * Stores credentials, invalidates the client cache, and resets the circuit
   * breaker so sync resumes immediately.
   */
  public static activateSovereignMode(supabaseUrl: string, supabaseKey: string): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available in this environment.');
    }
    if (!supabaseUrl.startsWith('https://')) {
      throw new Error('Sovereign Supabase URL must begin with https://');
    }
    if (!supabaseKey.startsWith('eyJ')) {
      throw new Error('Sovereign Supabase key does not appear to be a valid JWT.');
    }
    localStorage.setItem(SOVEREIGN_URL_KEY, supabaseUrl);
    localStorage.setItem(SOVEREIGN_KEY_KEY, supabaseKey);
    // Invalidate cache so the next sync picks up new credentials
    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl = null;
    PersistenceManager.resetCircuitBreaker();
    console.info('[PersistenceManager] Sovereign Mode activated. Next sync will use custom instance.');
  }

  public static deactivateSovereignMode(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SOVEREIGN_URL_KEY);
      localStorage.removeItem(SOVEREIGN_KEY_KEY);
    }
    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl = null;
    console.info('[PersistenceManager] Sovereign Mode deactivated. Reverting to shared instance.');
  }

  // --------------------------------------------------------------------------
  // OFFLINE RESPONSE FACTORY
  // --------------------------------------------------------------------------
  private static offlineResponse(): ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }> {
    return {
      data: { commits: [], branches: [] },
      error: PersistenceManager.offlineModeReason ?? '☁️ Cloud Sync Paused — operating in local-only mode.',
      status: 'offline',
    };
  }

  // --------------------------------------------------------------------------
  // CORE SYNC ENGINE
  // --------------------------------------------------------------------------

  private static async performSync(
    genomeId: string,
    commits: Commit[],
    branches: ArkheBranch[]
  ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> {
    const client = PersistenceManager.getSovereignClient();

    try {
      const dbCommits: NewChronosCommit[] = commits.map((c: Commit) => ({
        genome_id: genomeId,
        tx_id: c.txId,
        parent_id: c.parentTxIds?.length > 0 ? c.parentTxIds[0] : null,
        message: c.commitMessage || null,
        snapshot_meta: {},
        created_at: c.timestamp
          ? new Date(c.timestamp).toISOString()
          : new Date().toISOString(),
      }));

      const dbBranches: NewBranch[] = branches.map((b) => ({
        genome_id: genomeId,
        name: b.name,
        head_commit_id: b.headCommitId,
      }));

      let upsertedCommits: SupabaseChronosCommit[] = [];
      let upsertedBranches: SupabaseBranch[] = [];

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
        data: { commits: upsertedCommits, branches: upsertedBranches },
        error: null,
        status: 'success',
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unknown sync error',
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

    PersistenceManager.isSyncing = true;
    PersistenceManager.pendingParams = null;

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
        PersistenceManager.isSyncing = false;
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
    const client = PersistenceManager.getSovereignClient();
    try {
      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-z0-9.]/gi, '_');
      const storagePath = `${ownerId}/${safeFileName}_${timestamp}.fasta`;

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
    const client = PersistenceManager.getSovereignClient();
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
        owner_id: ownerId,
        genome_id: genomeId,
        label: f.name,
        start_pos: f.start,
        end_pos: f.end,
        color: null,
        type: f.type,
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

  static async restoreSession(genomeId: string): Promise<ArkheResponse<SessionRestore>> {
    const client = PersistenceManager.getSovereignClient();
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
      const commits  = commitsResult.data || [];
      const branches = branchesResult.data || [];

      const mainBranch = branches.find((b) => b.name === 'main');
      let headCommit: SupabaseChronosCommit | null = null;

      if (mainBranch) {
        const { data: head, error: headError } = await client
          .from('chronos_commits')
          .select('*')
          .eq('id', mainBranch.head_commit_id)
          .single<SupabaseChronosCommit>();
        if (!headError && head) headCommit = head;
      }

      if (!headCommit && commits.length > 0) {
        headCommit = commits[commits.length - 1];
      }

      if (!headCommit) {
        return { data: null, error: 'No commits found for this genome', status: 'fail' };
      }

      return { data: { genome, commits, branches, headCommit }, error: null, status: 'success' };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Unknown restore error', status: 'fail' };
    }
  }

  // --------------------------------------------------------------------------
  // 4. UTILITIES
  // --------------------------------------------------------------------------

  static async deleteGenome(genomeId: string): Promise<ArkheResponse<null>> {
    const client = PersistenceManager.getSovereignClient();
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
        const urlParts = genome.file_url.split('/');
        const genomesIndex = urlParts.indexOf('genomes');
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
}