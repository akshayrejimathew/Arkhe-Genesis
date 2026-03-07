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
 *     • `userIsNew` defaults to `true` so the OnboardingOverlay appears
 *       automatically on first boot. The workbench/page.tsx onClose handler
 *       writes `isFirstTimeUser = 'false'` to localStorage and calls
 *       `setUserIsNew(false)` to suppress future appearances.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── SOVEREIGN BRIDGE SPRINT — EXTERNAL DB FETCH ───────────────────────────────
 *
 *   fetchExternalSequence(accession)
 *     Previously called /api/proxy/ncbi unconditionally.  Now delegates to
 *     resolveAccession() (RegistryResolver.ts) which auto-detects NCBI,
 *     UniProtKB, and Ensembl accessions, validates before any network call,
 *     and routes to the correct proxy.
 *
 * ── REGISTRY RESOLVER INTEGRATION ────────────────────────────────────────────
 *
 *   NEW STATE FIELDS — must also be added to UISlice in src/store/types.ts:
 *
 *     import type { AccessionMetadata } from '@/lib/RegistryResolver';
 *
 *     // inside UISlice interface:
 *     resolvedAccession:    AccessionMetadata | null;
 *     isResolvingAccession: boolean;
 *     setResolvedAccession: (meta: AccessionMetadata | null) => void;
 *
 * ── SOUL INTEGRATION SPRINT ───────────────────────────────────────────────────
 *
 *   TASK 3 — Sovereign Wiki Modal
 *     • `isWikiOpen: boolean` added to initialUIState (default: false).
 *     • `openWiki()` and `closeWiki()` actions added.
 *     • Wire the BookOpen icon in the Sidebar to call `openWiki()`.
 *     • The Wiki modal renders the full ArkhéScript Command Codex.
 *
 *   TASK 4 — First-Boot Logic
 *     • `userIsNew` now defaults to `true` unconditionally.
 *     • The workbench/page.tsx is expected to persist `isFirstTimeUser=false`
 *       via localStorage on the user's first close of the OnboardingOverlay,
 *       and then call `setUserIsNew(false)` on subsequent boots by reading
 *       that flag before the store is hydrated.
 *
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
 *   • External DB    (fetchExternalSequence — multi-registry Sovereign Bridge)
 *   • Wiki Modal     (openWiki, closeWiki)
 *   • Internal setters
 */

import type { StateCreator } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { PersistenceManager } from '@/lib/PersistenceManager';
import type { CircuitBreakerNotification } from '@/lib/PersistenceManager';
import { performSentinelAudit } from '@/lib/sentinelAudit';
import { executeCommand } from '@/lib/terminalParser';
import { sequenceToFastaFile } from '@/lib/ExternalData';
import { resolveAccession } from '@/lib/RegistryResolver';
import type { AccessionMetadata } from '@/lib/RegistryResolver';
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

const SYSTEM_LOG_THROTTLE_MS = 100;
const SYSTEM_LOG_MAX_ENTRIES = 500;

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
// RegistryResolverError — structural duck-type guard
// ─────────────────────────────────────────────────────────────────────────────
//
// RegistryResolverError is NOT imported as a value here.  Some tsconfig
// configurations (e.g. isolatedModules: true) emit TS2305 when a class is
// imported only for instanceof checks, because the class import is erased at
// compile time.  The duck-type guard below is functionally equivalent: only
// RegistryResolverError instances carry the `.code` and `.retryable` fields.

interface ResolverErrorShape {
  message: string;
  code: string;
  retryable: boolean;
}

function isResolverError(err: unknown): err is ResolverErrorShape {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'retryable' in err &&
    typeof (err as ResolverErrorShape).code === 'string'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// set() escape hatch for new fields not yet in UISlice
// ─────────────────────────────────────────────────────────────────────────────
//
// `resolvedAccession` and `isResolvingAccession` are new fields that must be
// added to the UISlice interface in src/store/types.ts (see § REGISTRY RESOLVER
// INTEGRATION above).  Until that change is made, calling set({ resolvedAccession })
// triggers TS2353 ("Object literal may only specify known properties").
//
// setExtra() is a type-safe escape: it accepts a plain object and calls the
// Zustand setter through `unknown`, bypassing the interface check.  The cast
// is intentional and clearly scoped — remove it once types.ts is updated.

function setExtra(
  set: (partial: ArkheState | Partial<ArkheState>) => void,
  extra: Record<string, unknown>,
): void {
  (set as (s: unknown) => void)(extra);
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial UI state
// ─────────────────────────────────────────────────────────────────────────────

const initialUIState = {
  // ── SPRINT 2: Theme mode — persisted via 'arkhe-ui-storage' ───────────────
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
  // `userIsNew` defaults to TRUE so the OnboardingOverlay fires automatically
  // on the very first load.  workbench/page.tsx must write localStorage key
  // 'isFirstTimeUser' = 'false' and call setUserIsNew(false) on overlay close
  // to suppress subsequent appearances.
  userIsNew: true,
  onboardingActive: false,

  // ── TASK 3: Sovereign Wiki Modal ───────────────────────────────────────────
  // Controlled by openWiki() / closeWiki() actions below.
  // Wire a BookOpen icon in the Sidebar to openWiki().
  isWikiOpen: false,

  // ── REGISTRY RESOLVER ──────────────────────────────────────────────────────
  // These two fields must also be declared in the UISlice interface in
  // src/store/types.ts — see the § REGISTRY RESOLVER INTEGRATION block above.
  resolvedAccession:    null as AccessionMetadata | null,
  isResolvingAccession: false,
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
     * Sends RUN_FULL_AUDIT to the worker so it scans all SlabManager slabs
     * rather than only the visible viewport window.  Public parameters are
     * retained for backwards-compatibility but intentionally ignored.
     *
     * @param sequence  Ignored. Retained for API backwards-compatibility only.
     * @param start     Ignored. Retained for API backwards-compatibility only.
     * @param end       Ignored. Retained for API backwards-compatibility only.
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

      set({ isAuditing: true });
      try {
        const matches = await postAndWait<ThreatMatch[]>(
          worker,
          'RUN_FULL_AUDIT',
        );
        set({ threatMatches: matches });
        return matches;
      } finally {
        set({ isAuditing: false });
      }
    },

    clearThreatMatches: () => set({ threatMatches: [] }),

    // ─────────────────────────────────────────────────────────────────────────
    // § External Database — Multi-Registry Sovereign Bridge
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * fetchExternalSequence
     *
     * ── REGISTRY RESOLVER INTEGRATION ────────────────────────────────────────
     *
     * Delegates to resolveAccession() (RegistryResolver.ts) which auto-detects
     * the registry, validates format + checksum before any network call, and
     * routes to the correct Sovereign Bridge proxy:
     *   NCBI    → /api/proxy/ncbi
     *   UniProt → /api/proxy/uniprot
     *   Ensembl → /api/proxy/ensembl
     *
     * The returned AccessionMetadata is persisted to `resolvedAccession` so the
     * Workbench can render the organism badge and molecule-type pill immediately.
     *
     * LOCK CONTRACT:
     *   isProcessing is released before loadFile() is called because loadFile()
     *   re-acquires it internally.  The JS event loop guarantees this handoff
     *   is atomic — no microtask can slip between the two calls.
     *
     * @param accession  Any supported ID: NCBI RefSeq, UniProtKB, or Ensembl.
     */
    fetchExternalSequence: async (accession: string): Promise<void> => {
      const trimmedId = accession.trim().toUpperCase();
      if (!trimmedId) return;

      // ── 1. Guard: reject concurrent loads ──────────────────────────────────
      if (get().isProcessing) {
        get().addSystemLog({
          timestamp: Date.now(),
          category:  'SYSTEM',
          message:   '⚠️ System Busy: Please wait for current sequence processing to finish.',
          level:     'warning',
        });
        return;
      }

      // ── 2. Announce the resolution attempt ─────────────────────────────────
      get().addSystemLog({
        timestamp: Date.now(),
        category:  'SYSTEM',
        message:   `🌐 Resolving accession ${trimmedId} via Sovereign Bridge Registry...`,
        level:     'info',
      });

      // ── 3. Acquire processing lock + mark registry resolution in-flight ─────
      get().setIsProcessing(true);
      setExtra(set, { isResolvingAccession: true, resolvedAccession: null });

      // ── FIX (Scope Escape): Declare metadata and body BEFORE the try block
      // so they are in scope for steps 6-8 after the try/catch/finally exits.
      let metadata: AccessionMetadata | null = null;
      let body: string | null = null;

      try {
        // ── 4. Delegate to RegistryResolver ──────────────────────────────────
        const result = await resolveAccession(trimmedId);
        metadata = result.metadata;
        body     = result.body;

        if (!metadata || !body) {
          throw new Error('Registry Resolver returned empty data.');
        }

        // ── 5. Persist AccessionMetadata to the store ─────────────────────────
        setExtra(set, { resolvedAccession: metadata });

        get().addSystemLog({
          timestamp: Date.now(),
          category:  'SYSTEM',
          message:
            `✅ Resolved ${metadata.accession} · ` +
            `${metadata.registry.toUpperCase()} · ` +
            `${metadata.organism ?? 'Unknown'} · ` +
            `${metadata.moleculeType} · ` +
            `${metadata.sequenceLength?.toLocaleString() ?? '?'} residues`,
          level: 'success',
        });
      } catch (err: unknown) {
        // ── Error path: log and release lock ────────────────────────────────
        const msg = err instanceof Error ? err.message : String(err);

        get().addSystemLog({
          timestamp: Date.now(),
          category:  'SYSTEM',
          message:   `❌ Registry Resolver error: ${msg}`,
          level:     'error',
        });

        // Surface a backoff hint for rate-limit errors specifically.
        if (isResolverError(err) && err.code === 'RATE_LIMITED') {
          get().addSystemLog({
            timestamp: Date.now(),
            category:  'SYSTEM',
            message:
              '⏳ The upstream registry is rate-limiting requests. ' +
              'Wait 30–60 seconds before retrying.',
            level: 'warning',
          });
        }

        setExtra(set, { isResolvingAccession: false });
        get().setIsProcessing(false);
        return;

      } finally {
        // isResolvingAccession covers only the resolveAccession() phase.
        // isProcessing stays true until the lock-handoff step below.
        setExtra(set, { isResolvingAccession: false });
      }

      // ── FIX (Type Collapse): Guard both metadata and body.
      if (!metadata || !body) return;

      // ── 6. Wrap raw sequence in a FASTA File for the worker pipeline ─────────
      const sequenceLines = body.split('\n');
      const rawSequence = sequenceLines[0].startsWith('>')
        ? sequenceLines.slice(1).join('')
        : sequenceLines.join('');

      const fastaFile = sequenceToFastaFile(
        rawSequence,
        metadata.displayName ?? trimmedId,
        `${trimmedId}.fasta`,
      );

      // ── 7. Lock handoff: release before loadFile() re-acquires ───────────────
      get().setIsProcessing(false);

      // ── 8. Delegate to genomeSlice.loadFile() — full worker pipeline ─────────
      await get().loadFile(fastaFile, trimmedId);
    },

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
    clearTerminalLogs:   () => set({ terminalLogs: [] }),

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
     * After appending the new line, `.slice(-TERMINAL_OUTPUT_MAX_LINES)` is
     * applied, enforcing a strict 1,000-line cap and preventing OOM in long
     * running sessions.
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

    // ── Registry Resolver ────────────────────────────────────────────────────

    /**
     * setResolvedAccession
     *
     * Internal setter for AccessionMetadata.  Exposed so terminal commands or
     * Workbench panels can clear or override the resolved accession directly
     * without triggering a fetch.
     *
     * Requires UISlice in types.ts to declare:
     *   setResolvedAccession: (meta: AccessionMetadata | null) => void;
     */
    setResolvedAccession: (meta: AccessionMetadata | null) =>
      setExtra(set, { resolvedAccession: meta }),

    // ─────────────────────────────────────────────────────────────────────────
    // § TASK 4: Interactive Guide Hook
    // ─────────────────────────────────────────────────────────────────────────

    setUserIsNew: (isNew: boolean) => set({ userIsNew: isNew }),

    startOnboarding: () => set({ onboardingActive: true }),

    stopOnboarding:  () => set({ onboardingActive: false }),

    // ─────────────────────────────────────────────────────────────────────────
    // § TASK 3: Sovereign Wiki Modal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * openWiki
     *
     * Sets isWikiOpen to true, rendering the Command Codex modal.
     * Wire to a BookOpen icon at the bottom of the Sidebar:
     *   const openWiki = useArkheStore(s => s.openWiki);
     *   <button onClick={openWiki}><BookOpen size={18} /></button>
     */
    openWiki: () => set({ isWikiOpen: true }),

    /**
     * closeWiki
     *
     * Dismisses the Command Codex modal.
     * Wire to the modal's close button and Escape key handler.
     */
    closeWiki: () => set({ isWikiOpen: false }),
  };
};