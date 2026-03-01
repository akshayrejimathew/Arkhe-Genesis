/**
 * src/store/uiSlice.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Zustand slice that owns the entire user-facing layer of Arkhé:
 *
 *   • Auth           (setUser, clearUser, setUserId)
 *   • Sovereign Mode (activateSovereignMode, deactivateSovereignMode,
 *                     resetCircuitBreaker)  — CF-06 hardened
 *   • Circuit breaker callback registration (factory-level side-effect)
 *   • Sentinel       (getSentinelSummary, refreshSentinelScan, runSentinelAudit,
 *                     clearHazards, setSentinelLibrary, runThreatScreening,
 *                     clearThreatMatches)
 *   • Terminal       (setTerminalInput, executeTerminalCommand, clearTerminalOutput,
 *                     clearTerminalLogs)
 *   • System logging (addSystemLog — 100 ms throttle, 500-entry ring buffer)
 *   • Internal setters
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 *   CF-06 — Sovereign URL Sanitisation:
 *     activateSovereignMode() passes the raw URL through validateSovereignUrl
 *     (imported from utils.ts) before touching localStorage or
 *     PersistenceManager.  Only the sanitised `parsed.origin` — never the
 *     raw user input — is forwarded.  On validation failure the error is
 *     re-thrown so the settings panel can display an inline field error.
 *
 *   SPRINT 3 — Circuit breaker callback:
 *     PersistenceManager.onCircuitBreakerTripped is wired in the slice factory
 *     (not inside an action) so it fires regardless of whether the worker has
 *     started.  413/429 responses automatically flip isOfflineMode, surface a
 *     system-log warning, and expose the Sovereign Mode CTA.
 *
 *   SPRINT 3 — setUser syncs userId:
 *     setUser() writes both `user` and `userId` in a single set() call so
 *     components that read the legacy `userId` scalar remain consistent without
 *     needing a separate Supabase query.
 *
 * ── CROSS-SLICE CALLS ─────────────────────────────────────────────────────────
 *
 *   get().worker           — GenomeState  (sentinel / threat worker round-trips)
 *   get().viewport.sequence — GenomeState (runSentinelAudit needs current seq)
 *
 *   All cross-slice access goes through get() which returns the full ArkheState,
 *   so there are zero circular import risks.
 */

import type { StateCreator } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { PersistenceManager } from '@/lib/PersistenceManager';
import type { CircuitBreakerNotification } from '@/lib/PersistenceManager';
import { performSentinelAudit } from '@/lib/sentinelAudit';
import { executeCommand } from '@/lib/terminalParser';
import { postAndWait } from './utils';
import { validateSovereignUrl } from './utils';
import type {
  ArkheState,
  StoreMutators,
  UISlice,
  SentinelSummary,
  BioHazard,
  ThreatMatch,
  SignatureLibrary,
  SystemLog,
  CommandResult,
  ORFScanResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// System-log throttle constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum milliseconds between successive addSystemLog writes.
 *
 * The worker can emit SYSTEM_LOG at a very high rate during bulk operations
 * (streaming, large scans).  Without throttling, every emit triggers a React
 * re-render of every component subscribed to terminalLogs, causing frame drops.
 * 100 ms means at most 10 log entries per second reach the UI — still
 * informative without becoming a performance bottleneck.
 */
const SYSTEM_LOG_THROTTLE_MS = 100;

/** Maximum number of system log entries retained in the store. */
const SYSTEM_LOG_MAX_ENTRIES = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Initial UI state
// ─────────────────────────────────────────────────────────────────────────────

const initialUIState = {
  // Auth
  user: null as User | null,
  userId: null as string | null,

  // Offline / sovereign
  isOfflineMode: false,
  offlineModeReason: null as string | null,
  sovereignModeActive: false, // LB-02 & LB-0C: Initialize as false, update asynchronously

  // Sentinel
  sentinelData: null as SentinelSummary | null,
  isSentinelScanning: false,
  sentinelHazards: [] as BioHazard[],
  isAuditing: false,
  sentinelLibrary: null as SignatureLibrary | null,
  threatMatches: [] as ThreatMatch[],

  // ORF autopilot — declared in UIState; initialized here so the UISlice
  // return type is satisfied.  The genome slice also initializes these to the
  // same defaults; the combined store's value converges correctly at null / false.
  orfScanResult: null as ORFScanResult | null,
  isORFScanning: false,

  // Terminal
  terminalOutput: [] as string[],
  terminalInput: '',
  isExecuting: false,
  terminalLogs: [] as SystemLog[],
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice factory
// ─────────────────────────────────────────────────────────────────────────────

export const createUISlice: StateCreator<
  ArkheState,
  StoreMutators,
  [],
  UISlice
> = (set, get) => {
  // ── Throttle closure ────────────────────────────────────────────────────────
  // Declared here (not in an action) so the timestamp survives across calls
  // without being reset by React re-renders or store re-subscriptions.
  let lastSystemLogUpdate = 0;

  // ── SPRINT 3: Circuit breaker callback ──────────────────────────────────────
  //
  // Registered at slice-creation time (not inside initWorker) so that 413/429
  // responses trip the breaker even before the worker has been started — e.g.
  // during the initial genome upload triggered by loadFile().
  //
  // The callback:
  //   1. Flips isOfflineMode to true and records the human-readable reason.
  //   2. Reads the current sovereignModeActive flag from PersistenceManager
  //      so the Sovereignty Settings panel knows whether a CTA is appropriate.
  //   3. Surfaces a prominent warning in the system log with the suggested
  //      remediation action.
  PersistenceManager.onCircuitBreakerTripped = async (
    notification: CircuitBreakerNotification,
  ) => {
    const sovereignActive = await PersistenceManager.isSovereignModeActive();
    set({
      isOfflineMode: true,
      offlineModeReason: notification.reason,
      sovereignModeActive: sovereignActive,
    });

    // get() is safe here because the callback fires after the store is created.
    get().addSystemLog({
      timestamp: Date.now(),
      category: 'SYSTEM',
      message: `${notification.reason} — ${notification.suggestedAction}`,
      level: 'warning',
    });
  };

  // ── Slice body ──────────────────────────────────────────────────────────────
  return {
    // ── Initial state ─────────────────────────────────────────────────────
    ...initialUIState,

    // ─────────────────────────────────────────────────────────────────────────
    // § Auth
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * setUser
     *
     * Called by AuthOverlay after a successful Supabase sign-in.
     *
     * Syncs both `user` (the full Supabase User object, used by components that
     * need email / metadata) and `userId` (the legacy scalar, used by any cloud
     * action that still destructures userId from state) in a single set() call.
     *
     * Also emits a session-opened system log so the researcher can see auth
     * events in the terminal panel without opening browser devtools.
     */
    setUser: (user: User | null) => {
      set({ user, userId: user?.id ?? null });

      if (user) {
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `🔓 Session opened: ${user.email ?? user.id}`,
          level: 'success',
        });
      }
    },

    clearUser: () => {
      set({ user: null, userId: null });
      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message: '🔒 Session closed.',
        level: 'info',
      });
    },

    // Keep setUserId for backwards compatibility with existing callers that
    // only need the scalar.  New code should prefer setUser() which also
    // syncs the full User object.
    setUserId: (userId: string | null) => set({ userId }),

    // ─────────────────────────────────────────────────────────────────────────
    // § Sovereign Mode  ── CF-06 hardened
    //
    // THREAT MODEL:
    //   A malicious or misconfigured URL passed to activateSovereignMode could
    //   redirect every genome sync call to an attacker-controlled server,
    //   exfiltrating proprietary genomic data (SSRF / data exfiltration).
    //   Because PersistenceManager persists the URL to IndexedDB and uses it
    //   for every subsequent sync call, the URL must be validated BEFORE any
    //   write to IndexedDB or PersistenceManager.
    //
    // FIVE-GATE PIPELINE (implemented in validateSovereignUrl, utils.ts):
    //   Gate 1 — WHATWG URL parse (rejects non-URL strings)
    //   Gate 2 — Scheme enforcement (https always; http only for localhost)
    //   Gate 3 — Embedded credential rejection
    //   Gate 4 — Hostname allowlist regex (*.supabase.co | localhost) applied
    //             to the *parsed* hostname to defeat encoding bypasses
    //   Gate 5 — Path / search / hash stripping with console.warn
    //
    // Only the sanitised `parsed.origin` — never the raw user input — is
    // forwarded to PersistenceManager.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * activateSovereignMode
     *
     * @param url Raw Supabase project URL from the settings form.
     * @param key Supabase anon / service-role JWT.
     *
     * Throws a descriptive Error on any validation failure — the settings panel
     * should catch it and display the `.message` as an inline field error
     * adjacent to the URL input.
     */
    activateSovereignMode: async (url: string, key: string) => {
      // ── API key basic hygiene ───────────────────────────────────────────────
      // Supabase JWTs are always non-empty strings.  Reject obviously wrong
      // values before any network I/O so the error message is maximally helpful.
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        const msg = 'Sovereign Mode API key must not be empty.';
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `❌ Sovereign Mode activation failed: ${msg}`,
          level: 'error',
        });
        throw new Error(msg);
      }

      // ── URL validation  (CF-06 gate pipeline) ──────────────────────────────
      // validateSovereignUrl throws a descriptive Error on any policy violation.
      // We let the exception propagate so the settings panel can display an
      // inline error message directly adjacent to the URL input field.
      let sanitisedUrl: string;
      try {
        sanitisedUrl = validateSovereignUrl(url);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Invalid Sovereign Mode URL';
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `❌ Sovereign Mode activation failed: ${msg}`,
          level: 'error',
        });
        throw err; // re-throw for inline UI error display
      }

      // ── Delegate to PersistenceManager (sanitised origin only) ─────────────
      // Pass the sanitised origin string — never the raw user input — so no
      // unsanitised value ever reaches IndexedDB.
      try {
        await PersistenceManager.activateSovereignMode(sanitisedUrl, trimmedKey);

        set({
          isOfflineMode: false,
          offlineModeReason: null,
          sovereignModeActive: true,
        });

        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `🔐 Sovereign Mode activated — syncing to: ${sanitisedUrl}`,
          level: 'success',
        });
      } catch (err) {
        // PersistenceManager itself may throw (e.g. Supabase client init fails).
        const msg =
          err instanceof Error
            ? err.message
            : 'Invalid Sovereign Mode credentials';
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `❌ Sovereign Mode activation failed: ${msg}`,
          level: 'error',
        });
        throw err;
      }
    },

    deactivateSovereignMode: async () => {
      await PersistenceManager.deactivateSovereignMode();
      set({ sovereignModeActive: false });
      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message: '☁️ Sovereign Mode deactivated — reverted to Arkhé Central.',
        level: 'info',
      });
    },

    /**
     * resetCircuitBreaker
     *
     * Exposed as the handler for the "Reconnect" button that appears in the UI
     * banner when isOfflineMode === true.  Clears the PersistenceManager flag
     * and the store's offline state so the next COMMIT_SYNC will retry the
     * cloud sync.
     */
    resetCircuitBreaker: () => {
      PersistenceManager.resetCircuitBreaker();
      set({ isOfflineMode: false, offlineModeReason: null });
      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message:
          '✅ Circuit breaker reset — cloud sync will resume on next commit.',
        level: 'success',
      });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // § Sentinel biosequence analysis
    // ─────────────────────────────────────────────────────────────────────────

    getSentinelSummary: async (): Promise<SentinelSummary | null> => {
      const { worker } = get();
      if (!worker) throw new Error('Worker not initialised');

      const result = await postAndWait<SentinelSummary | null>(
        worker,
        'GET_SENTINEL_SUMMARY',
      );
      set({ sentinelData: result });
      return result;
    },

    refreshSentinelScan: async (): Promise<SentinelSummary | null> => {
      const { worker } = get();
      if (!worker) throw new Error('Worker not initialised');

      set({ isSentinelScanning: true });
      try {
        const result = await postAndWait<SentinelSummary | null>(
          worker,
          'REFRESH_SENTINEL_SCAN',
        );
        set({ sentinelData: result });
        return result;
      } finally {
        set({ isSentinelScanning: false });
      }
    },

    /**
     * runSentinelAudit
     *
     * Runs the local biosafety screening pipeline (performSentinelAudit) over
     * the current viewport sequence.  This is a CPU-side audit — it does not
     * use the engine worker and requires no network access, making it safe to
     * run even in offline / sovereign mode.
     *
     * @param start Optional start offset within the viewport sequence.
     * @param end   Optional end offset within the viewport sequence.
     */
    runSentinelAudit: async (
      start?: number,
      end?: number,
    ): Promise<BioHazard[]> => {
      set({ isAuditing: true });
      try {
        const seq = get().viewport.sequence;
        if (!seq) throw new Error('No sequence loaded in viewport');

        const hazards = await performSentinelAudit(seq, start, end);
        set({ sentinelHazards: hazards });
        return hazards;
      } finally {
        set({ isAuditing: false });
      }
    },

    clearHazards: () => set({ sentinelHazards: [] }),

    setSentinelLibrary: (lib: SignatureLibrary | null) =>
      set({ sentinelLibrary: lib }),

    /**
     * runThreatScreening
     *
     * Screens `sequence` against the loaded SignatureLibrary via the engine
     * worker's SCREEN_THREATS message.  Results are written to `threatMatches`.
     *
     * Prefer this over the SCREEN_THREATS_RESULT push (which fires
     * automatically on COMMIT_SYNC) for on-demand screening of arbitrary
     * sub-sequences provided by the researcher.
     */
    runThreatScreening: async (
      sequence: string,
      start?: number,
      end?: number,
    ): Promise<ThreatMatch[]> => {
      const { worker } = get();
      if (!worker) throw new Error('Worker not initialised');

      const matches = await postAndWait<ThreatMatch[]>(
        worker,
        'SCREEN_THREATS',
        { sequence, start, end },
      );
      set({ threatMatches: matches });
      return matches;
    },

    clearThreatMatches: () => set({ threatMatches: [] }),

    // ─────────────────────────────────────────────────────────────────────────
    // § Terminal
    // ─────────────────────────────────────────────────────────────────────────

    setTerminalInput: (input: string) => set({ terminalInput: input }),

    /**
     * executeTerminalCommand
     *
     * Delegates to the terminalParser's executeCommand, which dispatches to
     * the appropriate store action or system utility based on the input string.
     *
     * Output lines are appended to terminalOutput for display in the terminal
     * panel.  Both normal output and error messages are surfaced so the
     * researcher can see what happened without opening devtools.
     */
    executeTerminalCommand: async (input: string): Promise<CommandResult> => {
      set({ isExecuting: true });
      try {
        const result = await executeCommand(input, get());
        get().addTerminalOutput(`> ${input}`);
        if (result.output) get().addTerminalOutput(result.output);
        if (result.error) get().addTerminalOutput(`Error: ${result.error}`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        get().addTerminalOutput(`> ${input}`);
        get().addTerminalOutput(`Error: ${msg}`);
        throw err;
      } finally {
        // Always clear the input field and the executing flag — the researcher
        // should be able to type their next command immediately.
        set({ isExecuting: false, terminalInput: '' });
      }
    },

    clearTerminalOutput: () => set({ terminalOutput: [] }),
    clearTerminalLogs: () => set({ terminalLogs: [] }),

    // ─────────────────────────────────────────────────────────────────────────
    // § System logging
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * addSystemLog
     *
     * Appends a log entry to the terminalLogs ring buffer.
     *
     * ── Throttle ─────────────────────────────────────────────────────────────
     * The worker emits SYSTEM_LOG at very high frequency during streaming and
     * bulk scans.  Without throttling, every entry triggers a React re-render
     * of every subscribed component.  The 100 ms throttle (SYSTEM_LOG_THROTTLE_MS)
     * caps throughput at ≤10 log entries per second reaching the UI — still
     * informative without causing frame drops.
     *
     * ── Ring buffer ──────────────────────────────────────────────────────────
     * terminalLogs is capped at SYSTEM_LOG_MAX_ENTRIES (500) entries.  Older
     * entries are evicted from the front using Array.slice() — O(n) but
     * acceptable at this scale and keeps the implementation simple.
     *
     * ── Closure variable ─────────────────────────────────────────────────────
     * `lastSystemLogUpdate` is declared in the factory closure (above) so it
     * persists across renders and store re-subscriptions without being
     * inadvertently reset.
     */
    addSystemLog: (log: SystemLog) => {
      const now = Date.now();
      if (now - lastSystemLogUpdate < SYSTEM_LOG_THROTTLE_MS) return;
      lastSystemLogUpdate = now;

      set((state) => ({
        terminalLogs: [
          ...state.terminalLogs.slice(-(SYSTEM_LOG_MAX_ENTRIES - 1)),
          log,
        ],
      }));
    },

    // ─────────────────────────────────────────────────────────────────────────
    // § Internal setters
    // ─────────────────────────────────────────────────────────────────────────

    setSentinelData: (data: SentinelSummary | null) =>
      set({ sentinelData: data }),

    setSentinelScanning: (scanning: boolean) =>
      set({ isSentinelScanning: scanning }),

    setSentinelHazards: (hazards: BioHazard[]) =>
      set({ sentinelHazards: hazards }),

    setTerminalOutput: (output: string[]) => set({ terminalOutput: output }),

    addTerminalOutput: (line: string) =>
      set((state) => ({
        terminalOutput: [...state.terminalOutput, line],
      })),

    setExecuting: (executing: boolean) => set({ isExecuting: executing }),

    setThreatMatches: (matches: ThreatMatch[]) =>
      set({ threatMatches: matches }),
  };
};