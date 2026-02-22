// src/lib/PersistenceManager.ts
/**
 * PersistenceManager.ts
 * Cloud sync, genome upload, session restoration, and annotation persistence.
 *
 * PINNACLE SPRINT FIXES (2026-02-21):
 *
 *   SHADOW-03 — try/finally guarantees sync lock release on network failure:
 *     Previously, `run()` released `isSyncing` and `syncPromise` only on the
 *     happy path. A single Supabase network exception left `isSyncing = true`
 *     permanently — deadlocking all future syncs for the rest of the session.
 *     Fix: the entire body of `run()` is now wrapped in try/finally. The
 *     finally block unconditionally resets both flags on success, exception,
 *     and rejection alike.
 *
 *   CIRCUIT BREAKER — 413 / 429 offline mode:
 *     `performSync()` now inspects Supabase error codes. On 413 (Payload Too
 *     Large) or 429 (Rate Limit), it calls `circuitBreaker()` which trips
 *     `isOfflineMode = true`. Subsequent `syncChronos()` calls return
 *     immediately with `status: 'offline'` — no network I/O. The circuit
 *     breaker notification includes a Sovereign Mode suggestion, prompting
 *     the user to connect their own Supabase instance to resume cloud sync.
 *
 *   SOVEREIGN MODE — bring-your-own Supabase instance:
 *     `getSovereignClient()` checks `localStorage` for:
 *       - `ARKHE_CUSTOM_SUPABASE_URL`
 *       - `ARKHE_CUSTOM_SUPABASE_KEY`
 *     If both are present, `PersistenceManager` dynamically instantiates a
 *     second Supabase client using those credentials for all sync operations.
 *     This allows enterprise researchers to point Arkhé at their own Supabase
 *     project, sidestepping any rate limits or payload size limits on the
 *     shared Anthropic instance.
 *
 *     To activate Sovereign Mode from the browser console or settings panel:
 *       localStorage.setItem('ARKHE_CUSTOM_SUPABASE_URL', 'https://xxx.supabase.co');
 *       localStorage.setItem('ARKHE_CUSTOM_SUPABASE_KEY', 'eyJhbGci...');
 *       location.reload();  // triggers getSovereignClient() on next sync
 *
 *     To revert to the shared instance:
 *       localStorage.removeItem('ARKHE_CUSTOM_SUPABASE_URL');
 *       localStorage.removeItem('ARKHE_CUSTOM_SUPABASE_KEY');
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

/** Shape of a circuit-breaker notification emitted to the store. */
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

  /** Optional callback — the store sets this to surface notifications in the UI. */
  public static onCircuitBreakerTripped: ((notification: CircuitBreakerNotification) => void) | null = null;

  /** Trip the circuit breaker and emit a notification. */
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

  /** Reset the circuit breaker (called on successful reconnect or sovereign mode activation). */
  public static resetCircuitBreaker(): void {
    PersistenceManager.isOfflineMode = false;
    PersistenceManager.offlineModeReason = null;
    PersistenceManager.offlineModeCode = null;
  }

  // --------------------------------------------------------------------------
  // SOVEREIGN MODE — bring-your-own Supabase client
  // --------------------------------------------------------------------------

  /** Cached sovereign client so we don't re-instantiate on every sync. */
  private static _sovereignClient: SupabaseClient | null = null;
  private static _sovereignUrl: string | null = null;

  /**
   * Returns the appropriate Supabase client for sync operations.
   *
   * Priority:
   *   1. Sovereign client (if ARKHE_CUSTOM_SUPABASE_URL + ARKHE_CUSTOM_SUPABASE_KEY
   *      are set in localStorage)
   *   2. Default shared Arkhé client (imported at module load)
   *
   * The sovereign client is lazily instantiated and cached. If the URL in
   * localStorage changes (e.g. user updates credentials), the cache is
   * invalidated and a new client is created.
   */
  public static getSovereignClient(): SupabaseClient {
    // Guard against server-side rendering / worker contexts without localStorage
    if (typeof localStorage === 'undefined') {
      return defaultSupabase;
    }

    const customUrl = localStorage.getItem(SOVEREIGN_URL_KEY);
    const customKey = localStorage.getItem(SOVEREIGN_KEY_KEY);

    if (!customUrl || !customKey) {
      // No sovereign config — use default
      PersistenceManager._sovereignClient = null;
      PersistenceManager._sovereignUrl = null;
      return defaultSupabase;
    }

    // Invalidate cache if the URL has changed since last call
    if (
      PersistenceManager._sovereignClient &&
      PersistenceManager._sovereignUrl === customUrl
    ) {
      return PersistenceManager._sovereignClient;
    }

    // Instantiate a new sovereign client
    try {
      PersistenceManager._sovereignClient = createClient(customUrl, customKey, {
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
      PersistenceManager._sovereignUrl = customUrl;

      console.info(
        `[PersistenceManager] Sovereign Mode active — syncing to: ${customUrl}`
      );

      // If a circuit breaker was tripped on the shared instance, reset it now
      // that we have a fresh sovereign client to try.
      if (PersistenceManager.isOfflineMode) {
        console.info('[PersistenceManager] Resetting circuit breaker for sovereign client.');
        PersistenceManager.resetCircuitBreaker();
      }

      return PersistenceManager._sovereignClient;
    } catch (err) {
      console.error('[PersistenceManager] Failed to instantiate sovereign Supabase client:', err);
      return defaultSupabase;
    }
  }

  /** True when sovereign credentials are present and the client is active. */
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
    // Invalidate the cache so the next sync call picks up the new credentials
    PersistenceManager._sovereignClient = null;
    PersistenceManager._sovereignUrl = null;
    PersistenceManager.resetCircuitBreaker();
    console.info('[PersistenceManager] Sovereign Mode activated. Next sync will use custom instance.');
  }

  /** Deactivate Sovereign Mode and revert to the shared Arkhé instance. */
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

  /**
   * Performs the actual Supabase upsert.
   * Uses `getSovereignClient()` so sovereign users automatically get their
   * own instance rather than the shared one.
   * Detects 413 / 429 and trips the circuit breaker with full notification.
   */
  private static async performSync(
    genomeId: string,
    commits: Commit[],
    branches: ArkheBranch[]
  ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> {
    // Use sovereign client if available, otherwise default
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
          // ── Circuit Breaker: 413 Payload Too Large ──────────────────────
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
          // ── Circuit Breaker: 429 Rate Limited ───────────────────────────
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

          return {
            data: null,
            error: `Commit sync failed: ${error.message}`,
            status: 'fail',
          };
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
          // ── Circuit Breaker: 429 on branch upsert ──────────────────────
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
          return {
            data: null,
            error: `Branch sync failed: ${error.message}`,
            status: 'fail',
          };
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
   * Public sync entry point with concurrency lock + try/finally.
   *
   * SHADOW-03 FIX (try/finally):
   *   `isSyncing` and `syncPromise` are reset in the finally block, which
   *   runs on success, thrown exception, AND rejected promise. Before this
   *   fix, a single network exception left `isSyncing = true` forever.
   *
   * CIRCUIT BREAKER GATE:
   *   If `isOfflineMode` is true, returns an offline response immediately
   *   with zero network I/O. The genome continues operating from local
   *   SlabManager data. Cloud sync resumes when `resetCircuitBreaker()` is
   *   called (e.g. when the user activates Sovereign Mode).
   */
  public static async syncChronos(
    genomeId: string,
    commits: Commit[],
    branches: ArkheBranch[]
  ): Promise<ArkheResponse<{ commits: SupabaseChronosCommit[]; branches: SupabaseBranch[] }>> {
    // ── Circuit Breaker gate ───────────────────────────────────────────────
    if (PersistenceManager.isOfflineMode) {
      return PersistenceManager.offlineResponse();
    }

    // ── Concurrency lock ───────────────────────────────────────────────────
    if (PersistenceManager.isSyncing) {
      PersistenceManager.pendingParams = { genomeId, commits, branches };
      return PersistenceManager.syncPromise!;
    }

    PersistenceManager.isSyncing = true;
    PersistenceManager.pendingParams = null;

    /**
     * SHADOW-03 FIX — run() is wrapped in try/finally.
     *
     * Before this fix:
     *   async run() {
     *     const result = await performSync(...); // throws → exits here
     *     while (pending) { ... }
     *     isSyncing = false;    // ← NEVER REACHED on exception
     *     syncPromise = null;   // ← NEVER REACHED on exception
     *     return result;
     *   }
     *
     * After this fix:
     *   async run() {
     *     try {
     *       const result = await performSync(...);
     *       while (pending) { ... }
     *       return result;
     *     } finally {
     *       isSyncing = false;   // ← ALWAYS RUNS: success, throw, rejection
     *       syncPromise = null;  // ← ALWAYS RUNS
     *     }
     *   }
     */
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

        // Stop draining the queue if we've gone offline mid-run
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
        // Unconditional lock release — the key fix for SHADOW-03
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
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        return {
          data: null,
          error: `Storage upload failed: ${uploadError.message}`,
          status: 'fail',
        };
      }

      const { data: urlData } = client.storage
        .from('genomes')
        .getPublicUrl(storagePath);
      const fileUrl = urlData.publicUrl;

      const newGenome: NewGenome = {
        owner_id: ownerId,
        name,
        total_length: totalLength,
        file_url: fileUrl,
      };

      const { data, error: dbError } = await client
        .from('genomes')
        .insert(newGenome)
        .select()
        .single<Genome>();

      if (dbError) {
        await client.storage.from('genomes').remove([storagePath]);
        return {
          data: null,
          error: `Database insert failed: ${dbError.message}`,
          status: 'fail',
        };
      }

      return { data: data!, error: null, status: 'success' };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unknown upload error',
        status: 'fail',
      };
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
        return {
          data: null,
          error: `Failed to clear existing features: ${deleteError.message}`,
          status: 'fail',
        };
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
        return {
          data: null,
          error: `Failed to insert features: ${insertError.message}`,
          status: 'fail',
        };
      }

      return { data: data || [], error: null, status: 'success' };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unknown annotation error',
        status: 'fail',
      };
    }
  }

  // --------------------------------------------------------------------------
  // 3. SESSION RESTORATION (TIME MACHINE)
  // --------------------------------------------------------------------------

  static async restoreSession(
    genomeId: string
  ): Promise<ArkheResponse<SessionRestore>> {
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

      const genome = genomeResult.data;
      const commits = commitsResult.data || [];
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

      return {
        data: { genome, commits, branches, headCommit },
        error: null,
        status: 'success',
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unknown restore error',
        status: 'fail',
      };
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

      const { error: deleteError } = await client
        .from('genomes')
        .delete()
        .eq('id', genomeId);

      if (deleteError) {
        return { data: null, error: `Failed to delete genome: ${deleteError.message}`, status: 'fail' };
      }

      return { data: null, error: null, status: 'success' };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Unknown delete error',
        status: 'fail',
      };
    }
  }
}