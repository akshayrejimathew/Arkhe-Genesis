/**
 * src/store/uiSlice.ts
 *
 * ── SPRINT 2 CHANGES ─────────────────────────────────────────────────────────
 *   TASK 2: UI State Persistence
 *     • `themeMode` ('abyssal' | 'cleanroom') added to initialUIState with
 *       default 'abyssal'.
 *     • `setThemeMode` action added — single set() call, picked up by the
 *       persist middleware in index.ts and rehydrated automatically on boot.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── GENESIS RECTIFICATION SPRINT — KILL-SWITCH FIXES ─────────────────────────
 *
 *   TASK 1 — Structural Biosecurity: runThreatScreening
 *     FIX: The previous implementation passed the UI `viewportSequence` string
 *     (1,000 bp) directly to the worker via the SCREEN_THREATS message, meaning
 *     a threat signature that appeared outside the visible viewport window would
 *     go entirely undetected.
 *
 *     NEW BEHAVIOUR: runThreatScreening now sends a `RUN_FULL_AUDIT` command to
 *     the worker.  The worker receives no sequence payload; it reads directly
 *     from the SlabManager's raw memory slabs, scanning every byte of the loaded
 *     genome regardless of what the user is currently viewing.  The returned
 *     ThreatMatch[] array is stored in `threatMatches` as before.
 *
 *     The `sequence`, `start`, and `end` parameters are retained in the public
 *     signature for backwards-compatibility with callers (Workbench.tsx,
 *     terminal commands) but are intentionally NOT forwarded to the worker.
 *     This makes the full-audit behaviour unconditional and un-bypassable from
 *     the UI layer.
 *
 *   TASK 4 — Memory Ring-Buffer: addTerminalOutput
 *     FIX: The previous implementation appended lines to `terminalOutput`
 *     without any size cap, allowing the array to grow without bound and
 *     eventually trigger an Out-Of-Memory (OOM) crash in long-running sessions.
 *
 *     NEW BEHAVIOUR: Every time a new line is added, `.slice(-1000)` is applied
 *     after the append, enforcing a strict 1,000-line cap.  Older lines are
 *     evicted from the front.  The sentinel constant TERMINAL_OUTPUT_MAX_LINES
 *     documents the limit and allows it to be adjusted in one place.
 *
 * ── GENESIS RECTIFICATION SPRINT 3 — ABYSSAL UX ──────────────────────────────
 *   TASK 2: State Sync Verification (already handled by postAndWait)
 *   TASK 4: Interactive Guide Hook
 *     • Added `userIsNew` and `onboardingActive` flags.
 *     • Added `setUserIsNew`, `startOnboarding`, `stopOnboarding` actions.
 * ─────────────────────────────────────────────────────────────────────────────
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

const SYSTEM_LOG_THROTTLE_MS  = 100;
const SYSTEM_LOG_MAX_ENTRIES  = 500;

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4: Terminal output ring-buffer cap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard upper bound on the number of lines retained in `terminalOutput`.
 *
 * When the cap is reached the oldest lines are evicted from the front of the
 * array via `.slice(-TERMINAL_OUTPUT_MAX_LINES)`.  This prevents the array
 * from growing without bound and triggering an OOM crash in long-running
 * sessions.
 */
const TERMINAL_OUTPUT_MAX_LINES = 1_000;

// ─────────────────────────────────────────────────────────────────────────────
// Initial UI state
// ─────────────────────────────────────────────────────────────────────────────

const initialUIState = {
  // ── SPRINT 2: Theme mode — persisted via 'arkhe-ui-storage' ───────────────
  // Default is 'abyssal'. The persist middleware rehydrates this field on boot
  // so the user's last chosen theme is automatically restored.
  themeMode: 'abyssal' as 'abyssal' | 'cleanroom',

  // Auth
  user: null as User | null,
  userId: null as string | null,

  // Offline / sovereign
  isOfflineMode: false,
  offlineModeReason: null as string | null,
  sovereignModeActive: false,

  // Sentinel
  sentinelData: null as SentinelSummary | null,
  isSentinelScanning: false,
  sentinelHazards: [] as BioHazard[],
  isAuditing: false,
  sentinelLibrary: null as SignatureLibrary | null,
  threatMatches: [] as ThreatMatch[],

  // ORF autopilot
  orfScanResult: null as ORFScanResult | null,
  isORFScanning: false,

  // Terminal
  terminalOutput: [] as string[],
  terminalInput: '',
  isExecuting: false,
  terminalLogs: [] as SystemLog[],

  // ── TASK 4: Interactive Guide Hook ─────────────────────────────────────────
  userIsNew: false,                       // set by signup / first visit
  onboardingActive: false,                 // whether the onboarding is currently shown
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
  let lastSystemLogUpdate = 0;

  // ── SPRINT 3: Circuit breaker callback ──────────────────────────────────────
  PersistenceManager.onCircuitBreakerTripped = async (
    notification: CircuitBreakerNotification,
  ) => {
    const sovereignActive = await PersistenceManager.isSovereignModeActive();
    set({
      isOfflineMode: true,
      offlineModeReason: notification.reason,
      sovereignModeActive: sovereignActive,
    });

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
    // § SPRINT 2 — Theme
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * setThemeMode
     *
     * Writes the chosen theme to the store. The persist middleware (configured
     * in index.ts with `partialize`) serialises this field to localStorage
     * under the key 'arkhe-ui-storage', so the theme survives page reloads.
     *
     * Workbench.tsx reads `themeMode` from the store and calls `setThemeMode`
     * via its toggle action — local useState for the theme has been removed.
     */
    setThemeMode: (theme: 'abyssal' | 'cleanroom') => set({ themeMode: theme }),

    // ─────────────────────────────────────────────────────────────────────────
    // § Auth
    // ─────────────────────────────────────────────────────────────────────────

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

    setUserId: (userId: string | null) => set({ userId }),

    // ─────────────────────────────────────────────────────────────────────────
    // § Sovereign Mode  ── CF-06 hardened
    // ─────────────────────────────────────────────────────────────────────────

    activateSovereignMode: async (url: string, key: string) => {
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
        throw err;
      }

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
     * ── GENESIS RECTIFICATION — TASK 1: Structural Biosecurity ───────────────
     *
     * PROBLEM (before this fix):
     *   The previous implementation forwarded the `sequence` parameter — a
     *   1,000 bp string read from the current UI viewport — directly to the
     *   worker via the SCREEN_THREATS message.  Any pathogen signature that
     *   happened to fall outside the visible window would go completely
     *   undetected, creating a trivial detection-bypass vector.
     *
     * FIX:
     *   This method now sends a `RUN_FULL_AUDIT` command to the worker instead
     *   of `SCREEN_THREATS`.  No sequence payload is attached.  The worker is
     *   responsible for iterating over the SlabManager's raw memory (all loaded
     *   slabs, not just the viewport window) and running the ScreeningEngine
     *   against every byte of the genome.
     *
     *   The public signature (`sequence`, `start`, `end`) is deliberately
     *   preserved for backwards-compatibility with Workbench.tsx and terminal
     *   command callers, but those arguments are intentionally ignored here.
     *   This makes the full-genome audit unconditional and un-bypassable from
     *   the UI layer.
     *
     * WORKER CONTRACT:
     *   The worker must handle the 'RUN_FULL_AUDIT' message type.  On receipt
     *   it scans all SlabManager slabs (including the (KMER_SIZE - 1) = 23 byte
     *   overlap at each slab boundary per SEC-04) and replies with a
     *   ThreatMatch[] payload via the standard postAndWait round-trip.
     *
     * @param sequence  Ignored. Retained for API backwards-compatibility only.
     * @param start     Ignored. Retained for API backwards-compatibility only.
     * @param end       Ignored. Retained for API backwards-compatibility only.
     * @returns         Promise resolving to the full-genome ThreatMatch array.
     */
    runThreatScreening: async (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _sequence: string,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _start?: number,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _end?: number,
    ): Promise<ThreatMatch[]> => {
      const { worker } = get();
      if (!worker) throw new Error('Worker not initialised');

      set({ isAuditing: true });          // ← TASK 2: lock UI
      try {
        // ── TASK 1 FIX ────────────────────────────────────────────────────────
        // Do NOT send sequence / start / end to the worker.
        // Send RUN_FULL_AUDIT so the worker reads directly from SlabManager's
        // raw memory, covering the entire genome regardless of the viewport.
        const matches = await postAndWait<ThreatMatch[]>(
          worker,
          'RUN_FULL_AUDIT',
          // No payload: the worker determines the scan range internally from
          // SlabManager.getAllSlabs() and the stored genome length.
        );
        set({ threatMatches: matches });
        return matches;
      } finally {
        set({ isAuditing: false });       // ← TASK 2: release only after worker reply
      }
    },

    clearThreatMatches: () => set({ threatMatches: [] }),

    // ─────────────────────────────────────────────────────────────────────────
    // § Terminal
    // ─────────────────────────────────────────────────────────────────────────

    setTerminalInput: (input: string) => set({ terminalInput: input }),

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
        set({ isExecuting: false, terminalInput: '' });
      }
    },

    clearTerminalOutput: () => set({ terminalOutput: [] }),
    clearTerminalLogs: () => set({ terminalLogs: [] }),

    // ─────────────────────────────────────────────────────────────────────────
    // § System logging
    // ─────────────────────────────────────────────────────────────────────────

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

    /**
     * addTerminalOutput
     *
     * ── GENESIS RECTIFICATION — TASK 4: Memory Ring-Buffer ───────────────────
     *
     * PROBLEM (before this fix):
     *   The array was grown with a plain spread + append:
     *     `[...state.terminalOutput, line]`
     *   With no upper bound, long-running sessions (continuous genome streaming,
     *   automated CLI scripts) would fill the array indefinitely, eventually
     *   exhausting the V8 heap and crashing the tab.
     *
     * FIX:
     *   After appending the new line, `.slice(-TERMINAL_OUTPUT_MAX_LINES)` is
     *   applied.  Array.prototype.slice with a negative start index returns the
     *   last N elements, discarding everything before them.  This is O(N) in
     *   the cap size (1,000), not in the total history, making it safe to call
     *   on every keystroke / log event.
     *
     *   The constant TERMINAL_OUTPUT_MAX_LINES (1,000) is defined at module scope
     *   so the limit is visible and adjustable without touching this method.
     */
    addTerminalOutput: (line: string) =>
      set((state) => ({
        terminalOutput: [...state.terminalOutput, line].slice(
          -TERMINAL_OUTPUT_MAX_LINES,
        ),
      })),

    setExecuting: (executing: boolean) => set({ isExecuting: executing }),

    setThreatMatches: (matches: ThreatMatch[]) =>
      set({ threatMatches: matches }),

    // ─────────────────────────────────────────────────────────────────────────
    // § TASK 4: Interactive Guide Hook
    // ─────────────────────────────────────────────────────────────────────────

    setUserIsNew: (isNew: boolean) => set({ userIsNew: isNew }),

    startOnboarding: () => set({ onboardingActive: true }),

    stopOnboarding: () => set({ onboardingActive: false }),
  };
};