/**
 * useArkheStore.ts
 * Zustand store for the Arkhé Genomic IDE – COMPLETE NERVOUS SYSTEM.
 * Includes Sentinel Audit, Protein Folding, Terminal Command Execution,
 * Public Genome Fetching, Branching Evolution, and all existing features.
 *
 * ── SPRINT 3 ADDITIONS (2026-02-22) ──────────────────────────────────────────
 *
 *   CHANGE 1 — proteinFold import corrected:
 *     `computeProteinFold` now imported from `@/lib/proteinFold` (the GDPR-
 *     compliant shim) instead of `@/lib/engines/FoldingEngine` (which calls the
 *     ESM Atlas endpoint without a consent gate). The shim enforces the
 *     `consentObtained` flag and falls back to Chou–Fasman heuristics when
 *     consent is absent.
 *
 *   CHANGE 2 — `user: User | null` state:
 *     Typed via `@supabase/supabase-js`. Distinct from `userId: string | null`
 *     so components can access the full User object (email, metadata) without
 *     a separate Supabase query. `setUser()` / `clearUser()` setters exposed.
 *
 *   CHANGE 3 — `isOfflineMode: boolean` + `offlineModeReason: string | null`:
 *     Mirrors `PersistenceManager.isOfflineMode`. When `true`, `COMMIT_SYNC`
 *     handler skips the cloud sync call and logs a local-only notice instead.
 *     Tripped by the circuit breaker callback registered at store creation time.
 *
 *   CHANGE 4 — `sovereignModeActive: boolean`:
 *     Reflects whether custom Supabase keys are stored in localStorage.
 *     `activateSovereignMode(url, key)` / `deactivateSovereignMode()` /
 *     `resetCircuitBreaker()` actions exposed for the Sovereignty Settings panel
 *     in `AuthOverlay.tsx`.
 *
 *   CHANGE 5 — Circuit breaker callback:
 *     `PersistenceManager.onCircuitBreakerTripped` is registered inside the
 *     store factory so that 413 / 429 responses automatically flip
 *     `isOfflineMode`, surface a system log, and expose the Sovereign Mode CTA.
 *
 * ── AUDIT III FIXES (2026-02-21) — preserved ─────────────────────────────────
 *
 *   FIX 1 — STREAM_END truncation (CRITICAL — Vector D):
 *     `loadFile()` sends `STREAM_END` after the stream loop and before
 *     `fetchGenomeMetadata()`. Same fix on `loadGenomeFromCloud()`.
 *
 *   FIX 2 — Worker crash = permanent silent freeze (CRITICAL — SHADOW-01):
 *     `initWorker()` registers `worker.onerror` and `worker.onmessageerror`.
 *
 *   FIX 3 — postAndWait hangs forever on dead worker (CRITICAL — SHADOW-01):
 *     `postAndWait()` races against a 30-second timeout.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { User } from '@supabase/supabase-js';
import { PersistenceManager } from '@/lib/PersistenceManager';
import type { CircuitBreakerNotification } from '@/lib/PersistenceManager';
import { supabase } from '@/lib/supabase';
import { performSentinelAudit, type BioHazard } from '@/lib/sentinelAudit';
// SPRINT 3 FIX: import from the GDPR-compliant shim, not FoldingEngine directly.
// The shim enforces the consent gate and delegates to FoldingEngine only after
// the researcher has explicitly acknowledged ESM Atlas data transmission.
import { computeProteinFold } from '@/lib/proteinFold';
import { executeCommand, type CommandResult } from '@/lib/terminalParser';
import { fetchPublicGenomes, type PublicGenome } from '@/lib/supabasePublic';
import type {
  BaseCode,
  SlabMeta,
  FeatureTag,
  SliceResponse,
  PCRProduct,
  RestrictionSite,
  RadarBin,
  SentinelSummary,
  ORFScanResult,
  OffTargetResult,
  OffTargetHit,
  SyntenyAnchor,
  SpliceSite,
  SpliceIsoform,
  ProteinProperties,
  ProteinFold,
  Commit,
  Branch,
  TransactionSummary,
  ORF,
} from '@/types/arkhe';
import type { SystemLog } from '@/types/SystemLog';
import type { ChronosCommit as SupabaseChronosCommit, Branch as SupabaseBranch } from '@/lib/supabase';
import type { SignatureLibrary, ThreatMatch } from '@/lib/sentinel/ScreeningEngine';

// ── Timeout for postAndWait — prevents infinite hangs on worker crash ─────────
const POST_AND_WAIT_TIMEOUT_MS = 30_000;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export interface Viewport {
  start: number;
  end: number;
  buffer?: ArrayBuffer | SharedArrayBuffer;
  sequence?: string;
  translations?: {
    frame0: string;
    frame1: string;
    frame2: string;
    frame_1: string;
    frame_2: string;
    frame_3: string;
  };
  gcPercent?: number;
  features?: FeatureTag[];
  orfs?: ORF[];
  spliceSites?: SpliceSite[];
  isoforms?: SpliceIsoform[];
  proteinProperties?: ProteinProperties;
}

export interface PendingMutation {
  slabIndex: number;
  offset: number;
  base: BaseCode;
  meta?: { user: string; reason: string; branch?: string; isCheckpoint?: boolean };
}

export interface ArkheState {
  // Worker
  worker: Worker | null;
  workerConnected: boolean;
  lastPing: number;
  workerError: string | null;

  // Genome metadata
  activeGenomeId: string | null;
  genomeLength: number;
  slabMetas: Map<number, SlabMeta>;
  editedSlabs: Set<number>;

  // UI Viewport
  viewport: Viewport;
  viewportData: SliceResponse | null;
  currentSlice: number;
  isInitialized: boolean;

  // Chronos
  chronosHead: string | null;
  chronosTransactions: TransactionSummary[];
  branches: Branch[];
  currentBranch: string;
  commits: Commit[];

  // Feature Map
  features: FeatureTag[];

  // SIMULATION STATE
  pcrResults: PCRProduct[];
  isRunningPCR: boolean;
  restrictionSites: RestrictionSite[];
  isMappingRestriction: boolean;
  radarData: RadarBin[];
  isGeneratingRadar: boolean;
  isExporting: boolean;

  // SENTINEL STATE
  sentinelData: SentinelSummary | null;
  isSentinelScanning: boolean;
  sentinelHazards: BioHazard[];
  isAuditing: boolean;

  // ORF AUTOPILOT STATE
  orfScanResult: ORFScanResult | null;
  isORFScanning: boolean;

  // OFF-TARGET RADAR STATE
  offTargetResult: OffTargetResult | null;
  isScanningOffTarget: boolean;

  // SYNTENY GHOSTING STATE
  syntenyAnchors: SyntenyAnchor[];
  isScanningSynteny: boolean;

  // SPLICE & ISOFORM STATE
  sliceSpliceSites: SpliceSite[];
  sliceIsoforms: SpliceIsoform[];
  sliceProteinProperties: ProteinProperties | null;

  // PROTEIN FOLDING
  proteinFold: ProteinFold | null;
  isFolding: boolean;
  foldError: string | null;

  // SURGICAL COMMIT STATE
  pendingMutation: PendingMutation | null;
  showCommitDialog: boolean;

  // TERMINAL STATE
  terminalOutput: string[];
  terminalInput: string;
  isExecuting: boolean;

  // CLOUD PERSISTENCE & PUBLIC GENOMES
  terminalLogs: SystemLog[];
  userId: string | null;
  isSyncing: boolean;
  publicGenomes: PublicGenome[];
  isLoadingPublic: boolean;

  // DIFF MODE & OFF-TARGET HEATMAP
  comparisonSequence: string | null;
  diffMode: boolean;
  offTargetHits: OffTargetHit[];

  // SENTINEL THREAT SCREENING
  sentinelLibrary: SignatureLibrary | null;
  threatMatches: ThreatMatch[];

  // ── SPRINT 3: Auth + Offline + Sovereign ───────────────────────────────────
  /** Full Supabase User object — null when guest or not authenticated */
  user: User | null;
  /** Circuit breaker flag — true when PersistenceManager trips on 413/429 */
  isOfflineMode: boolean;
  /** Human-readable reason why offline mode was engaged */
  offlineModeReason: string | null;
  /** True when custom Supabase URL + Key are active in localStorage */
  sovereignModeActive: boolean;

  // ---------- Core Actions ----------
  initWorker: () => Promise<void>;
  initializeEngine: (sequence?: string) => Promise<void>;
  loadFile: (file: File, name?: string) => Promise<void>;
  requestViewport: (start: number, end: number) => Promise<SliceResponse>;
  applyLocalMutation: (
    slabIndex: number,
    offset: number,
    base: BaseCode,
    meta?: { user: string; reason: string; branch?: string; isCheckpoint?: boolean }
  ) => Promise<void>;
  performSurgicalEdit: (
    slabIndex: number,
    offset: number,
    base: BaseCode,
    user?: string,
    branch?: string,
    isCheckpoint?: boolean
  ) => void;
  commitMutationWithReason: (reason: string) => Promise<void>;
  cancelPendingMutation: () => void;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
  getDiffForTx: (txId: string) => Promise<unknown>;

  // ---------- Genome Metadata ----------
  fetchGenomeMetadata: () => Promise<{ genomeLength: number; slabMetas: SlabMeta[] }>;

  // ---------- Feature Actions ----------
  addFeature: (feature: Omit<FeatureTag, 'id'>) => Promise<FeatureTag>;
  getFeaturesAt: (offset: number) => Promise<FeatureTag[]>;

  // ---------- Motif Radar ----------
  findMotif: (
    pattern: string,
    start?: number,
    end?: number,
    maxMismatches?: number
  ) => Promise<{ start: number; end: number }[]>;

  // ---------- SIMULATION PHASE ACTIONS ----------
  runPCR: (
    forwardPrimer: string,
    reversePrimer: string,
    options?: { maxMismatches?: number; minProduct?: number; maxProduct?: number }
  ) => Promise<PCRProduct[]>;
  mapRestrictionSites: (enzymes?: string[]) => Promise<RestrictionSite[]>;
  refreshRadar: (numBins?: number) => Promise<RadarBin[]>;
  exportMutantFasta: () => Promise<{ filename: string; content: string }>;

  // ---------- SENTINEL ACTIONS ----------
  getSentinelSummary: () => Promise<SentinelSummary | null>;
  refreshSentinelScan: () => Promise<SentinelSummary | null>;
  runSentinelAudit: (start?: number, end?: number) => Promise<BioHazard[]>;
  clearHazards: () => void;

  // ---------- ORF AUTOPILOT ACTIONS ----------
  getORFScanResult: () => Promise<ORFScanResult | null>;
  refreshORFScan: () => Promise<ORFScanResult | null>;
  getORFsInRange: (start: number, end: number) => Promise<ORF[]>;

  // ---------- OFF-TARGET RADAR ACTIONS ----------
  scanOffTargets: (query: string, maxMismatch?: number) => Promise<OffTargetResult>;
  clearOffTargetResult: () => void;

  // ---------- SYNTENY GHOSTING ACTIONS ----------
  getSyntenyAnchors: () => Promise<SyntenyAnchor[]>;
  refreshSyntenyScan: () => Promise<SyntenyAnchor[]>;

  // ---------- BRANCHING EVOLUTION ACTIONS ----------
  createBranch: (name: string, fromCommitId?: string) => Promise<boolean>;
  checkout: (branchName: string) => Promise<boolean>;
  merge: (sourceBranch: string, targetBranch?: string, message?: string) => Promise<string | null>;
  getBranches: () => Promise<Branch[]>;
  getCommits: () => Promise<Commit[]>;

  // ---------- SPLICE & PROTEIN ACTIONS ----------
  predictSpliceSites: (start: number, end: number, strand?: '+' | '-') => Promise<SpliceSite[]>;
  predictIsoforms: (start: number, end: number, orf: ORF, spliceSites: SpliceSite[]) => Promise<SpliceIsoform[]>;
  getProteinProperties: (aaSeq: string) => Promise<ProteinProperties>;

  // ---------- PROTEIN FOLDING ACTIONS ----------
  foldProtein: (sequence: string, consentObtained?: boolean) => Promise<ProteinFold>;
  clearProteinFold: () => void;

  // ---------- TERMINAL ACTIONS ----------
  setTerminalInput: (input: string) => void;
  executeTerminalCommand: (input: string) => Promise<CommandResult>;
  clearTerminalOutput: () => void;

  // ---------- PUBLIC GENOME ACTIONS ----------
  loadPublicGenomes: () => Promise<void>;
  fetchPublicGenomeById: (id: string) => Promise<PublicGenome>;

  // ---------- CLOUD ACTIONS ----------
  setUserId: (userId: string | null) => void;
  addSystemLog: (log: SystemLog) => void;
  clearTerminalLogs: () => void;
  loadGenomeFromCloud: (genomeId: string) => Promise<void>;

  // ---------- DIFF & OFF-TARGET ACTIONS ----------
  setComparisonSequence: (seq: string | null) => void;
  toggleDiffMode: () => void;
  runOffTargetHeatmap: (query: string, maxMismatch?: number) => Promise<OffTargetHit[]>;
  clearOffTargetHits: () => void;

  // ---------- SENTINEL THREAT SCREENING ACTIONS ----------
  setSentinelLibrary: (lib: SignatureLibrary | null) => void;
  runThreatScreening: (sequence: string, start?: number, end?: number) => Promise<ThreatMatch[]>;
  clearThreatMatches: () => void;

  // ---------- SPRINT 3: Auth + Sovereign Mode actions ----------
  /** Store the full Supabase User after sign-in */
  setUser: (user: User | null) => void;
  /** Clear user on sign-out */
  clearUser: () => void;
  /** Activate custom Supabase instance — validates, persists to localStorage */
  activateSovereignMode: (url: string, key: string) => void;
  /** Revert to shared Arkhé Central instance */
  deactivateSovereignMode: () => void;
  /** Reset circuit breaker after user connects Sovereign Mode or retries */
  resetCircuitBreaker: () => void;

  // ---------- Internal Setters ----------
  setWorkerConnected: (connected: boolean) => void;
  setWorkerError: (error: string | null) => void;
  updateSlabMeta: (metas: SlabMeta[]) => void;
  addEditedSlab: (slabIndex: number) => void;
  setViewportData: (data: SliceResponse) => void;
  setChronosHead: (txId: string | null) => void;
  setChronosTransactions: (txs: TransactionSummary[]) => void;
  setFeatures: (features: FeatureTag[]) => void;
  setPCRResults: (results: PCRProduct[]) => void;
  setRestrictionSites: (sites: RestrictionSite[]) => void;
  setRadarData: (data: RadarBin[]) => void;
  setSentinelData: (data: SentinelSummary | null) => void;
  setSentinelScanning: (scanning: boolean) => void;
  setSentinelHazards: (hazards: BioHazard[]) => void;
  setORFScanResult: (result: ORFScanResult | null) => void;
  setORFScanning: (scanning: boolean) => void;
  setOffTargetResult: (result: OffTargetResult | null) => void;
  setScanningOffTarget: (scanning: boolean) => void;
  setSyntenyAnchors: (anchors: SyntenyAnchor[]) => void;
  setScanningSynteny: (scanning: boolean) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setCommits: (commits: Commit[]) => void;
  setShowCommitDialog: (show: boolean) => void;
  setPendingMutation: (mutation: PendingMutation | null) => void;
  setProteinFold: (fold: ProteinFold | null) => void;
  setFolding: (folding: boolean) => void;
  setFoldError: (error: string | null) => void;
  setTerminalOutput: (output: string[]) => void;
  addTerminalOutput: (line: string) => void;
  setExecuting: (executing: boolean) => void;
  setPublicGenomes: (genomes: PublicGenome[]) => void;
  setLoadingPublic: (loading: boolean) => void;
  setDiffMode: (mode: boolean) => void;
  setOffTargetHits: (hits: OffTargetHit[]) => void;
  setSyncing: (val: boolean) => void;
  setThreatMatches: (matches: ThreatMatch[]) => void;
}

// ── FIX 3: postAndWait with 30-second timeout ─────────────────────────────────
/**
 * Send a typed message to the worker and wait for its reply.
 *
 * AUDIT III FIX (SHADOW-01 / worker crash):
 *   Races the response Promise against a 30-second timeout. If the worker
 *   does not reply within POST_AND_WAIT_TIMEOUT_MS the race rejects with a
 *   descriptive WorkerTimeoutError, unblocking the UI.
 */
function postAndWait<T = unknown>(
  worker: Worker,
  type: string,
  payload?: unknown,
  transfer?: Transferable[]
): Promise<T> {
  const roundTrip = new Promise<T>((resolve, reject) => {
    const id = generateId();
    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        if (e.data.type === 'ERROR') {
          reject(new Error(e.data.payload.message));
        } else {
          resolve(e.data.payload);
        }
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type, id, payload }, transfer || []);
  });

  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Worker message '${type}' timed out after ${POST_AND_WAIT_TIMEOUT_MS / 1000} s. ` +
          `The worker may have crashed. Try reconnecting.`
        )
      );
    }, POST_AND_WAIT_TIMEOUT_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });

  return Promise.race([roundTrip, timeout]);
}

function convertSupabaseCommitToArkhe(commit: SupabaseChronosCommit): Commit {
  return {
    txId: commit.tx_id,
    parentTxIds: commit.parent_id ? [commit.parent_id] : [],
    childrenTxIds: [],
    mutations: [],
    timestamp: commit.created_at ? new Date(commit.created_at).getTime() : Date.now(),
    author: undefined,
    commitMessage: commit.message || undefined,
    branchName: undefined,
    isCheckpoint: false,
  };
}

function convertSupabaseBranchToArkhe(branch: SupabaseBranch): Branch {
  return {
    name: branch.name,
    headCommitId: branch.head_commit_id,
    createdAt: branch.created_at ? new Date(branch.created_at).getTime() : Date.now(),
  };
}

export const useArkheStore = create<ArkheState>()(
  subscribeWithSelector((set, get) => {
    // ── Telemetry throttle ─────────────────────────────────────────────────
    let lastSystemLogUpdate = 0;
    const SYSTEM_LOG_THROTTLE_MS = 100;

    // ── SPRINT 3: Circuit breaker callback ────────────────────────────────
    // Registered here (not in initWorker) so it fires regardless of whether
    // the worker has been started — e.g. a sync triggered before INIT completes.
    PersistenceManager.onCircuitBreakerTripped = (notification: CircuitBreakerNotification) => {
      set({
        isOfflineMode: true,
        offlineModeReason: notification.reason,
        sovereignModeActive: PersistenceManager.isSovereignModeActive(),
      });
      // Surface as a prominent system log with the suggested remediation action
      const store = get();
      store.addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message: `${notification.reason} — ${notification.suggestedAction}`,
        level: 'warning',
      });
    };

    return {
      // ── Initial State ────────────────────────────────────────────────────
      viewport: { start: 0, end: 1000, buffer: new Uint8Array(1000).buffer },
      viewportData: null,
      slabMetas: new Map(),
      editedSlabs: new Set(),
      genomeLength: 0,
      worker: null,
      workerConnected: false,
      workerError: null,
      lastPing: 0,
      activeGenomeId: null,
      isInitialized: false,
      chronosHead: null,
      chronosTransactions: [],
      branches: [],
      currentBranch: 'main',
      commits: [],
      features: [],
      pcrResults: [],
      isRunningPCR: false,
      restrictionSites: [],
      isMappingRestriction: false,
      radarData: [],
      isGeneratingRadar: false,
      isExporting: false,
      sentinelData: null,
      isSentinelScanning: false,
      sentinelHazards: [],
      isAuditing: false,
      orfScanResult: null,
      isORFScanning: false,
      offTargetResult: null,
      isScanningOffTarget: false,
      syntenyAnchors: [],
      isScanningSynteny: false,
      sliceSpliceSites: [],
      sliceIsoforms: [],
      sliceProteinProperties: null,
      proteinFold: null,
      isFolding: false,
      foldError: null,
      pendingMutation: null,
      showCommitDialog: false,
      terminalOutput: [],
      terminalInput: '',
      isExecuting: false,
      terminalLogs: [],
      userId: null,
      isSyncing: false,
      publicGenomes: [],
      isLoadingPublic: false,
      comparisonSequence: null,
      diffMode: false,
      offTargetHits: [],
      sentinelLibrary: null,
      threatMatches: [],
      currentSlice: 0,

      // ── SPRINT 3: Initial auth + offline + sovereign state ─────────────
      user: null,
      isOfflineMode: false,
      offlineModeReason: null,
      sovereignModeActive: PersistenceManager.isSovereignModeActive(),

      // ── Core Actions ─────────────────────────────────────────────────────

      /**
       * FIX 2 (AUDIT III — SHADOW-01):
       * Registers `worker.onerror` and `worker.onmessageerror` so that a
       * crashed worker surfaces `workerConnected: false` and a readable
       * `workerError` message in the store.
       */
      initWorker: async () => {
        if (typeof Worker === 'undefined') {
          set({ workerError: 'Web Workers not supported in this browser.' });
          throw new Error('Web Workers not supported');
        }

        try {
          const worker = new Worker(
            new URL('../app/worker/ArkheEngine.worker.ts', import.meta.url),
            { type: 'module' }
          );

          worker.onerror = (event: ErrorEvent) => {
            const message = event.message || 'Worker encountered an unhandled error.';
            console.error('[ArkheEngine] worker.onerror:', message, event);
            set({
              workerConnected: false,
              workerError: `Engine crashed: ${message}. Click Reconnect to restart.`,
            });
          };

          worker.onmessageerror = (event: MessageEvent) => {
            console.error('[ArkheEngine] worker.onmessageerror:', event);
            set({
              workerConnected: false,
              workerError: 'Engine message deserialization failed. Click Reconnect to restart.',
            });
          };

          worker.addEventListener('message', (e: MessageEvent) => {
            const { type, payload } = e.data;
            switch (type) {
              case 'MUTATION_PATCH': {
                const viewport = get().viewport;
                if (payload.start <= viewport.end && payload.end >= viewport.start) {
                  get().requestViewport(viewport.start, viewport.end).catch(console.error);
                }
                break;
              }
              case 'CHRONOS_HISTORY':
                get().setChronosTransactions(payload);
                break;
              case 'SLAB_META_UPDATE':
                get().updateSlabMeta(payload);
                break;
              case 'WORKER_PONG':
                set({ lastPing: Date.now() });
                break;
              case 'SENTINEL_SUMMARY':
                get().setSentinelData(payload);
                break;
              case 'ORF_SCAN_UPDATE':
                get().setORFScanResult(payload);
                break;
              case 'OFF_TARGET_RESULT':
                set({ offTargetResult: payload, isScanningOffTarget: false });
                break;
              case 'SYNTENY_ANCHORS':
                set({ syntenyAnchors: payload, isScanningSynteny: false });
                break;
              case 'GET_BRANCHES_RESULT':
                set({ branches: payload });
                break;
              case 'GET_COMMITS_RESULT':
                set({ commits: payload });
                break;
              case 'SYSTEM_LOG':
                get().addSystemLog({
                  timestamp: payload.timestamp,
                  category: payload.category,
                  message: payload.message,
                  level: payload.level,
                });
                break;
              case 'COMMIT_SYNC': {
                /**
                 * SPRINT 3: Two gates before sync:
                 *   1. Guest gate — `user === null` means no cloud account;
                 *      skip silently (local-only session).
                 *   2. Circuit breaker gate — `isOfflineMode === true` means
                 *      a previous sync hit a 413/429; skip and log a notice.
                 *      The researcher's mutations are safe locally.
                 */
                const { commits, branches } = payload;
                const { activeGenomeId, user, isSyncing, isOfflineMode } = get();

                // Gate 1: guest / unauthenticated
                if (!user) break;

                // Gate 2: circuit breaker tripped
                if (isOfflineMode) {
                  get().addSystemLog({
                    timestamp: Date.now(),
                    category: 'SYSTEM',
                    message:
                      '☁️ Cloud Sync Paused — genome data is safe locally. ' +
                      (get().offlineModeReason ?? ''),
                    level: 'warning',
                  });
                  break;
                }

                // Normal sync path
                if (activeGenomeId && !isSyncing) {
                  PersistenceManager.syncChronos(activeGenomeId, commits, branches)
                    .then((response) => {
                      if (response.status === 'offline') return; // handled by circuit breaker callback
                      if (response.status === 'fail') {
                        console.error('Sync failed:', response.error);
                        get().addSystemLog({
                          timestamp: Date.now(),
                          category: 'SYSTEM',
                          message: `❌ Cloud sync failed: ${response.error}`,
                          level: 'error',
                        });
                      } else {
                        get().addSystemLog({
                          timestamp: Date.now(),
                          category: 'SYSTEM',
                          message: `✅ Synced ${commits.length} commits, ${branches.length} branches`,
                          level: 'success',
                        });
                      }
                    })
                    .catch((err) => console.error('Sync error:', err));
                }
                break;
              }
              case 'SCREEN_THREATS_RESULT':
                set({ threatMatches: payload });
                break;
            }
          });

          set({ worker, workerConnected: false, workerError: null });

          const useShared =
            typeof SharedArrayBuffer !== 'undefined' &&
            (typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false);

          const initResult = await postAndWait(worker, 'INIT', {
            slabSize: 1_048_576,
            useSharedArray: useShared,
          });

          set({ workerConnected: true });
          console.log('Arkhe worker initialized', initResult);
        } catch (err) {
          console.error('Worker initialization failed', err);
          set({
            workerConnected: false,
            workerError:
              err instanceof Error ? err.message : 'Unknown worker initialization error',
          });
          throw err;
        }
      },

      initializeEngine: async (_sequence?: string) => {
        await get().initWorker();
      },

      /**
       * FIX 1 (AUDIT III — Vector D / STREAM_END):
       * Sends STREAM_END after the chunk loop to flush the final partial
       * staging buffer in the worker before metadata is queried.
       */
      loadFile: async (file: File, name?: string) => {
        const { worker } = get();
        if (worker) {
          await postAndWait(worker, 'RESET_ENGINE', {});
        }

        const currentState = get();
        currentState.slabMetas.clear();
        currentState.editedSlabs.clear();

        if (typeof globalThis !== 'undefined' && (globalThis as unknown as { gc?: () => void }).gc) {
          (globalThis as unknown as { gc: () => void }).gc();
        }

        const { fetchGenomeMetadata, user } = get();
        if (!worker) throw new Error('Worker not initialized');
        if (!user) throw new Error('User not authenticated');

        set({ isSyncing: true });
        const uploadResult = await PersistenceManager.uploadGenome(
          file,
          user.id,
          name || file.name,
          0
        );

        if (uploadResult.status === 'fail') {
          set({ isSyncing: false });
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'SYSTEM',
            message: `❌ Genome upload failed: ${uploadResult.error}`,
            level: 'error',
          });
          throw new Error(uploadResult.error!);
        }

        const genome = uploadResult.data!;
        set({ activeGenomeId: genome.id, isSyncing: false });

        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `📤 Genome uploaded: ${genome.name} (${genome.id})`,
          level: 'success',
        });

        const fileId = generateId();
        const chunkSize = 64 * 1024;
        let offset = 0;

        while (offset < file.size) {
          const chunk = file.slice(offset, offset + chunkSize);
          const arrayBuffer = await chunk.arrayBuffer();
          await postAndWait(
            worker,
            'STREAM_CHUNK',
            { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
            [arrayBuffer]
          );
          offset += chunkSize;
        }

        // FIX 1: flush final partial staging buffer
        await postAndWait(worker, 'STREAM_END', { fileId });

        await fetchGenomeMetadata();

        const genomeLength = get().genomeLength;
        if (genomeLength > 0) {
          await supabase
            .from('genomes')
            .update({ total_length: genomeLength })
            .eq('id', genome.id);
        }

        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `🧬 Genome loaded: ${genomeLength.toLocaleString()} bp`,
          level: 'success',
        });
      },

      fetchGenomeMetadata: async () => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const metadata = await postAndWait<{ genomeLength: number; slabMetas: SlabMeta[] }>(
          worker,
          'GET_GENOME_METADATA'
        );
        set({ genomeLength: metadata.genomeLength });
        get().updateSlabMeta(metadata.slabMetas);
        return metadata;
      },

      requestViewport: async (start: number, end: number): Promise<SliceResponse> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const result = await postAndWait<SliceResponse>(worker, 'LOAD_SLICE', { start, end });
        get().setViewportData(result);
        return result;
      },

      applyLocalMutation: async (
        slabIndex: number,
        offset: number,
        base: BaseCode,
        meta?: { user: string; reason: string; branch?: string; isCheckpoint?: boolean }
      ) => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const txId = generateId();
        await postAndWait(worker, 'PERFORM_SURGICAL_MUTATION', {
          slabIndex,
          offset,
          newBaseCode: base,
          txId,
          meta,
        });
        get().addEditedSlab(slabIndex);
      },

      performSurgicalEdit: (
        slabIndex: number,
        offset: number,
        base: BaseCode,
        user?: string,
        branch?: string,
        isCheckpoint?: boolean
      ) => {
        set({
          pendingMutation: {
            slabIndex,
            offset,
            base,
            meta: {
              user: user ?? 'anonymous',
              reason: '',
              branch,
              isCheckpoint,
            },
          },
          showCommitDialog: true,
        });
      },

      commitMutationWithReason: async (reason: string) => {
        const { pendingMutation, worker } = get();
        if (!pendingMutation || !worker) {
          set({ showCommitDialog: false, pendingMutation: null });
          return;
        }
        const meta = { ...pendingMutation.meta, reason };
        const txId = generateId();
        await postAndWait(worker, 'PERFORM_SURGICAL_MUTATION', {
          slabIndex: pendingMutation.slabIndex,
          offset: pendingMutation.offset,
          newBaseCode: pendingMutation.base,
          txId,
          meta,
        });
        get().addEditedSlab(pendingMutation.slabIndex);
        set({ showCommitDialog: false, pendingMutation: null });
      },

      cancelPendingMutation: () => {
        set({ showCommitDialog: false, pendingMutation: null });
      },

      undo: async () => {
        const { worker } = get();
        if (!worker) return;
        await postAndWait(worker, 'UNDO');
      },

      redo: async () => {
        const { worker } = get();
        if (!worker) return;
        await postAndWait(worker, 'REDO');
      },

      getDiffForTx: async (txId: string): Promise<unknown> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait(worker, 'EXPORT_PATCH', { txId });
      },

      addFeature: async (feature: Omit<FeatureTag, 'id'>): Promise<FeatureTag> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<FeatureTag>(worker, 'ADD_FEATURE', { feature });
      },

      getFeaturesAt: async (offset: number): Promise<FeatureTag[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<FeatureTag[]>(worker, 'GET_FEATURES_AT', { offset });
      },

      findMotif: async (
        pattern: string,
        start?: number,
        end?: number,
        maxMismatches?: number
      ): Promise<{ start: number; end: number }[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait(worker, 'FIND_MOTIF', { pattern, start, end, maxMismatches });
      },

      runPCR: async (
        forwardPrimer: string,
        reversePrimer: string,
        options?: { maxMismatches?: number; minProduct?: number; maxProduct?: number }
      ): Promise<PCRProduct[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isRunningPCR: true });
        try {
          const results = await postAndWait<PCRProduct[]>(worker, 'SIMULATE_PCR', {
            forwardPrimer,
            reversePrimer,
            maxMismatches: options?.maxMismatches ?? 2,
            minProduct: options?.minProduct ?? 50,
            maxProduct: options?.maxProduct ?? 5000,
          });
          get().setPCRResults(results);
          return results;
        } finally {
          set({ isRunningPCR: false });
        }
      },

      mapRestrictionSites: async (enzymes?: string[]): Promise<RestrictionSite[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isMappingRestriction: true });
        try {
          const sites = await postAndWait<RestrictionSite[]>(worker, 'RESTRICTION_MAP', { enzymes });
          get().setRestrictionSites(sites);
          return sites;
        } finally {
          set({ isMappingRestriction: false });
        }
      },

      refreshRadar: async (numBins?: number): Promise<RadarBin[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isGeneratingRadar: true });
        try {
          const bins = await postAndWait<RadarBin[]>(worker, 'GENERATE_RADAR_DATA', {
            numBins: numBins ?? 500,
          });
          get().setRadarData(bins);
          return bins;
        } finally {
          set({ isGeneratingRadar: false });
        }
      },

      exportMutantFasta: async (): Promise<{ filename: string; content: string }> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isExporting: true });
        try {
          const result = await postAndWait<{ filename: string; content: string }>(
            worker,
            'EXPORT_MUTANT_FASTA'
          );
          const blob = new Blob([result.content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = result.filename;
          a.click();
          URL.revokeObjectURL(url);
          return result;
        } finally {
          set({ isExporting: false });
        }
      },

      getSentinelSummary: async (): Promise<SentinelSummary | null> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const result = await postAndWait<SentinelSummary | null>(worker, 'GET_SENTINEL_SUMMARY');
        set({ sentinelData: result });
        return result;
      },

      refreshSentinelScan: async (): Promise<SentinelSummary | null> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isSentinelScanning: true });
        try {
          const result = await postAndWait<SentinelSummary | null>(
            worker,
            'REFRESH_SENTINEL_SCAN'
          );
          set({ sentinelData: result });
          return result;
        } finally {
          set({ isSentinelScanning: false });
        }
      },

      runSentinelAudit: async (start?: number, end?: number): Promise<BioHazard[]> => {
        set({ isAuditing: true });
        try {
          const seq = get().viewport.sequence;
          if (!seq) throw new Error('No sequence loaded');
          const hazards = await performSentinelAudit(seq, start, end);
          set({ sentinelHazards: hazards });
          return hazards;
        } finally {
          set({ isAuditing: false });
        }
      },

      clearHazards: () => set({ sentinelHazards: [] }),

      getORFScanResult: async (): Promise<ORFScanResult | null> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const result = await postAndWait<ORFScanResult | null>(worker, 'GET_ORF_SCAN_RESULT');
        set({ orfScanResult: result });
        return result;
      },

      refreshORFScan: async (): Promise<ORFScanResult | null> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isORFScanning: true });
        try {
          const result = await postAndWait<ORFScanResult | null>(worker, 'REFRESH_ORF_SCAN');
          set({ orfScanResult: result });
          return result;
        } finally {
          set({ isORFScanning: false });
        }
      },

      getORFsInRange: async (start: number, end: number): Promise<ORF[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<ORF[]>(worker, 'GET_ORFS_IN_RANGE', { start, end });
      },

      scanOffTargets: async (query: string, maxMismatch?: number): Promise<OffTargetResult> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isScanningOffTarget: true });
        try {
          const result = await postAndWait<OffTargetResult>(worker, 'SCAN_OFF_TARGETS', {
            query,
            maxMismatch: maxMismatch ?? 2,
          });
          set({ offTargetResult: result });
          return result;
        } finally {
          set({ isScanningOffTarget: false });
        }
      },

      clearOffTargetResult: () => set({ offTargetResult: null }),

      getSyntenyAnchors: async (): Promise<SyntenyAnchor[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const anchors = await postAndWait<SyntenyAnchor[]>(worker, 'GET_SYNTENY_ANCHORS');
        set({ syntenyAnchors: anchors });
        return anchors;
      },

      refreshSyntenyScan: async (): Promise<SyntenyAnchor[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isScanningSynteny: true });
        try {
          const anchors = await postAndWait<SyntenyAnchor[]>(worker, 'REFRESH_SYNTENY_SCAN');
          set({ syntenyAnchors: anchors });
          return anchors;
        } finally {
          set({ isScanningSynteny: false });
        }
      },

      createBranch: async (name: string, fromCommitId?: string): Promise<boolean> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const success = await postAndWait<boolean>(worker, 'CREATE_BRANCH', {
          name,
          fromCommitId,
        });
        if (success) get().getBranches();
        return success;
      },

      checkout: async (branchName: string): Promise<boolean> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const success = await postAndWait<boolean>(worker, 'CHECKOUT', { branchName });
        if (success) {
          set({ currentBranch: branchName });
          get().getBranches();
          get().getCommits();
        }
        return success;
      },

      merge: async (
        sourceBranch: string,
        targetBranch?: string,
        message?: string
      ): Promise<string | null> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const mergeCommitId = await postAndWait<string | null>(worker, 'MERGE', {
          sourceBranch,
          targetBranch,
          message,
        });
        if (mergeCommitId) {
          get().getBranches();
          get().getCommits();
        }
        return mergeCommitId;
      },

      getBranches: async (): Promise<Branch[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const branches = await postAndWait<Branch[]>(worker, 'GET_BRANCHES');
        set({ branches });
        return branches;
      },

      getCommits: async (): Promise<Commit[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const commits = await postAndWait<Commit[]>(worker, 'GET_COMMITS');
        set({ commits });
        return commits;
      },

      predictSpliceSites: async (
        start: number,
        end: number,
        strand?: '+' | '-'
      ): Promise<SpliceSite[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<SpliceSite[]>(worker, 'PREDICT_SPLICE_SITES', {
          start,
          end,
          strand,
        });
      },

      predictIsoforms: async (
        start: number,
        end: number,
        orf: ORF,
        spliceSites: SpliceSite[]
      ): Promise<SpliceIsoform[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<SpliceIsoform[]>(worker, 'PREDICT_ISOFORMS', {
          start,
          end,
          orf,
          spliceSites,
        });
      },

      getProteinProperties: async (aaSeq: string): Promise<ProteinProperties> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        return await postAndWait<ProteinProperties>(worker, 'GET_PROTEIN_PROPERTIES', { aaSeq });
      },

      /**
       * foldProtein — GDPR gate enforced here.
       *
       * The ESM Atlas API transmits the researcher's amino-acid sequence to a
       * Meta Research third-party endpoint. `computeProteinFold` (now correctly
       * imported from `@/lib/proteinFold`) accepts a single argument.
       *
       * The consent check lives in this action:
       *   - consentObtained === false → heuristic result, zero network I/O.
       *   - consentObtained === true  → calls the shim, which delegates to ESM Atlas.
       *
       * The disclosure modal must pass `true` only after explicit acknowledgement.
       */
      foldProtein: async (sequence: string, consentObtained = false): Promise<ProteinFold> => {
        if (!consentObtained) {
          const heuristicResult: ProteinFold = {
            aminoAcids: sequence,
            coordinates: [],
            secondaryStructure: [],
            confidence: [],
            method: 'CHOU_FASMAN_HEURISTIC',
            warning: 'Heuristic prediction — Not for clinical use.',
            rateLimitNotice:
              'ESM Atlas folding requires prior user consent. Showing heuristic analysis.',
          };
          set({ proteinFold: heuristicResult });
          return heuristicResult;
        }

        set({ isFolding: true, foldError: null });
        try {
          const fold = await computeProteinFold(sequence);
          set({ proteinFold: fold });
          return fold;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown folding error';
          set({ foldError: msg });
          throw err;
        } finally {
          set({ isFolding: false });
        }
      },

      clearProteinFold: () => set({ proteinFold: null, foldError: null }),

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

      loadPublicGenomes: async () => {
        set({ isLoadingPublic: true });
        try {
          const genomes = await fetchPublicGenomes();
          set({ publicGenomes: genomes });
        } catch (err) {
          console.error('Failed to load public genomes', err);
        } finally {
          set({ isLoadingPublic: false });
        }
      },

      fetchPublicGenomeById: async (id: string): Promise<PublicGenome> => {
        const { data, error } = await supabase
          .from('public_sequences')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          throw new Error(`Failed to fetch public genome ${id}: ${error.message}`);
        }
        if (!data) {
          throw new Error(`Public genome not found: ${id}`);
        }
        return data as PublicGenome;
      },

      /**
       * FIX 1 (cloud restore path — AUDIT III):
       * Sends STREAM_END after the chunk loop so restored genomes are not
       * silently truncated.
       */
      loadGenomeFromCloud: async (genomeId: string) => {
        const { worker, user } = get();
        if (!worker) throw new Error('Worker not initialized');
        if (!user) throw new Error('User not authenticated');

        set({ isSyncing: true, activeGenomeId: genomeId });

        const restoreResult = await PersistenceManager.restoreSession(genomeId);
        if (restoreResult.status === 'fail') {
          set({ isSyncing: false });
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'SYSTEM',
            message: `❌ Session restore failed: ${restoreResult.error}`,
            level: 'error',
          });
          throw new Error(restoreResult.error!);
        }

        const {
          genome,
          commits: supabaseCommits,
          branches: supabaseBranches,
          headCommit: supabaseHeadCommit,
        } = restoreResult.data!;

        const convertedCommits = supabaseCommits.map(convertSupabaseCommitToArkhe);
        const convertedBranches = supabaseBranches.map(convertSupabaseBranchToArkhe);
        const convertedHeadCommit = convertSupabaseCommitToArkhe(supabaseHeadCommit);

        const fileUrl = genome.file_url;
        const response = await fetch(fileUrl);
        const fileBlob = await response.blob();
        const fileName = genome.name.endsWith('.fasta')
          ? genome.name
          : `${genome.name}.fasta`;
        const file = new File([fileBlob], fileName, { type: 'text/plain' });

        const fileId = generateId();
        const chunkSize = 64 * 1024;
        let offset = 0;

        while (offset < file.size) {
          const chunk = file.slice(offset, offset + chunkSize);
          const arrayBuffer = await chunk.arrayBuffer();
          await postAndWait(
            worker,
            'STREAM_CHUNK',
            { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
            [arrayBuffer]
          );
          offset += chunkSize;
        }

        // FIX 1 (cloud path): flush final staging buffer
        await postAndWait(worker, 'STREAM_END', { fileId });

        await postAndWait(worker, 'RESTORE_HISTORY', {
          commits: convertedCommits,
          branches: convertedBranches,
          headCommitId: convertedHeadCommit.txId,
        });

        await get().fetchGenomeMetadata();
        set({
          commits: convertedCommits,
          branches: convertedBranches,
          chronosHead: convertedHeadCommit.txId,
          currentBranch:
            convertedBranches.find((b) => b.headCommitId === convertedHeadCommit.txId)
              ?.name || 'main',
          isSyncing: false,
        });

        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `🔄 Session restored: ${genome.name}, ${convertedCommits.length} commits`,
          level: 'success',
        });
      },

      setComparisonSequence: (seq) => set({ comparisonSequence: seq }),
      toggleDiffMode: () => set((state) => ({ diffMode: !state.diffMode })),

      runOffTargetHeatmap: async (query: string, maxMismatch = 2): Promise<OffTargetHit[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        set({ isScanningOffTarget: true });
        try {
          const hits = await postAndWait<OffTargetHit[]>(worker, 'SCAN_OFF_TARGETS', {
            query,
            maxMismatch,
          });
          set({ offTargetHits: hits });
          return hits;
        } finally {
          set({ isScanningOffTarget: false });
        }
      },

      clearOffTargetHits: () => set({ offTargetHits: [] }),

      setSentinelLibrary: (lib) => set({ sentinelLibrary: lib }),

      runThreatScreening: async (
        sequence: string,
        start?: number,
        end?: number
      ): Promise<ThreatMatch[]> => {
        const { worker } = get();
        if (!worker) throw new Error('Worker not initialized');
        const matches = await postAndWait<ThreatMatch[]>(worker, 'SCREEN_THREATS', {
          sequence,
          start,
          end,
        });
        set({ threatMatches: matches });
        return matches;
      },

      clearThreatMatches: () => set({ threatMatches: [] }),

      // ── SPRINT 3: Auth Actions ────────────────────────────────────────────

      /**
       * setUser — called by AuthOverlay after successful Supabase sign-in.
       * Also syncs `userId` so existing cloud actions using `userId` continue
       * to work unchanged. Both fields are kept in sync here at the source.
       */
      setUser: (user: User | null) => {
        set({
          user,
          userId: user?.id ?? null,
        });
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

      // ── SPRINT 3: Sovereign Mode Actions ─────────────────────────────────

      /**
       * activateSovereignMode — called by the Sovereignty Settings panel in
       * AuthOverlay after a successful Test Connection.
       *
       * PersistenceManager.activateSovereignMode() validates the URL / key
       * format and writes them to localStorage. On success this action flips
       * `sovereignModeActive: true` and resets any existing circuit breaker so
       * the researcher can immediately start syncing to their own instance.
       */
      activateSovereignMode: (url: string, key: string) => {
        try {
          PersistenceManager.activateSovereignMode(url, key);
          set({
            isOfflineMode: false,
            offlineModeReason: null,
            sovereignModeActive: true,
          });
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'SYSTEM',
            message: `🔐 Sovereign Mode activated — syncing to: ${url}`,
            level: 'success',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid Sovereign Mode credentials';
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'SYSTEM',
            message: `❌ Sovereign Mode activation failed: ${msg}`,
            level: 'error',
          });
          // Re-throw so the settings panel can surface the inline error
          throw err;
        }
      },

      deactivateSovereignMode: () => {
        PersistenceManager.deactivateSovereignMode();
        set({ sovereignModeActive: false });
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: '☁️ Sovereign Mode deactivated — reverted to Arkhé Central.',
          level: 'info',
        });
      },

      /**
       * resetCircuitBreaker — exposed for the "Reconnect" button rendered when
       * `isOfflineMode === true`. Resets the PersistenceManager flag and
       * clears the store's offline state so the next COMMIT_SYNC will retry.
       */
      resetCircuitBreaker: () => {
        PersistenceManager.resetCircuitBreaker();
        set({ isOfflineMode: false, offlineModeReason: null });
        get().addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: '✅ Circuit breaker reset — cloud sync will resume on next commit.',
          level: 'success',
        });
      },

      // ── Internal Setters ─────────────────────────────────────────────────

      setWorkerConnected: (connected) => set({ workerConnected: connected }),
      setWorkerError: (error) => set({ workerError: error }),

      updateSlabMeta: (metas) =>
        set((state) => {
          const newMap = new Map(state.slabMetas);
          metas.forEach((meta) => newMap.set(meta.slabIndex, meta));
          return { slabMetas: newMap };
        }),

      addEditedSlab: (slabIndex) =>
        set((state) => {
          const newSet = new Set(state.editedSlabs);
          newSet.add(slabIndex);
          return { editedSlabs: newSet };
        }),

      setViewportData: (data) => {
        set({
          viewport: {
            start: data.start,
            end: data.end,
            buffer: data.buffer,
            sequence: data.sequence,
            translations: data.translations,
            gcPercent: data.gcPercent,
            features: data.features,
            orfs: data.orfs,
            spliceSites: data.spliceSites,
            isoforms: data.isoforms,
            proteinProperties: data.proteinProperties,
          },
          features: data.features ?? [],
          sliceSpliceSites: data.spliceSites ?? [],
          sliceIsoforms: data.isoforms ?? [],
          sliceProteinProperties: data.proteinProperties ?? null,
        });
      },

      setChronosHead: (txId) => set({ chronosHead: txId }),
      setChronosTransactions: (txs) => set({ chronosTransactions: txs }),
      setFeatures: (features) => set({ features }),
      setPCRResults: (results) => set({ pcrResults: results }),
      setRestrictionSites: (sites) => set({ restrictionSites: sites }),
      setRadarData: (data) => set({ radarData: data }),
      setSentinelData: (data) => set({ sentinelData: data }),
      setSentinelScanning: (scanning) => set({ isSentinelScanning: scanning }),
      setSentinelHazards: (hazards) => set({ sentinelHazards: hazards }),
      setORFScanResult: (result) => set({ orfScanResult: result }),
      setORFScanning: (scanning) => set({ isORFScanning: scanning }),
      setOffTargetResult: (result) => set({ offTargetResult: result }),
      setScanningOffTarget: (scanning) => set({ isScanningOffTarget: scanning }),
      setSyntenyAnchors: (anchors) => set({ syntenyAnchors: anchors }),
      setScanningSynteny: (scanning) => set({ isScanningSynteny: scanning }),
      setBranches: (branches) => set({ branches }),
      setCurrentBranch: (branch) => set({ currentBranch: branch }),
      setCommits: (commits) => set({ commits }),
      setShowCommitDialog: (show) => set({ showCommitDialog: show }),
      setPendingMutation: (mutation) => set({ pendingMutation: mutation }),
      setProteinFold: (fold) => set({ proteinFold: fold }),
      setFolding: (folding) => set({ isFolding: folding }),
      setFoldError: (error) => set({ foldError: error }),
      setTerminalOutput: (output) => set({ terminalOutput: output }),
      addTerminalOutput: (line) =>
        set((state) => ({ terminalOutput: [...state.terminalOutput, line] })),
      setExecuting: (executing) => set({ isExecuting: executing }),
      setPublicGenomes: (genomes) => set({ publicGenomes: genomes }),
      setLoadingPublic: (loading) => set({ isLoadingPublic: loading }),
      setDiffMode: (mode) => set({ diffMode: mode }),
      setOffTargetHits: (hits) => set({ offTargetHits: hits }),
      setSyncing: (val) => set({ isSyncing: val }),
      setThreatMatches: (matches) => set({ threatMatches: matches }),

      // Keep setUserId for backwards compatibility with existing callers.
      // New code should prefer setUser() which also syncs userId.
      setUserId: (userId) => set({ userId }),

      clearTerminalLogs: () => set({ terminalLogs: [] }),

      addSystemLog: (log: SystemLog) => {
        const now = Date.now();
        if (now - lastSystemLogUpdate < SYSTEM_LOG_THROTTLE_MS) return;
        lastSystemLogUpdate = now;
        set((state) => ({
          terminalLogs: [...state.terminalLogs.slice(-499), log],
        }));
      },
    };
  })
);

// ── Selectors ─────────────────────────────────────────────────────────────────
export const useViewportBuffer = () => useArkheStore((state) => state.viewport.buffer);
export const useViewportSequence = () => useArkheStore((state) => state.viewport.sequence);
export const useViewportTranslations = () =>
  useArkheStore((state) => state.viewport.translations);
export const useViewportGC = () => useArkheStore((state) => state.viewport.gcPercent);
export const useViewportFeatures = () => useArkheStore((state) => state.viewport.features);
export const useViewportORFs = () => useArkheStore((state) => state.viewport.orfs);
export const useViewportSpliceSites = () => useArkheStore((state) => state.viewport.spliceSites);
export const useViewportIsoforms = () => useArkheStore((state) => state.viewport.isoforms);
export const useViewportProteinProperties = () =>
  useArkheStore((state) => state.viewport.proteinProperties);
export const useGenomeLength = () => useArkheStore((state) => state.genomeLength);
export const useIsWorkerConnected = () => useArkheStore((state) => state.workerConnected);
export const useWorkerError = () => useArkheStore((state) => state.workerError);

export const usePCRResults = () => useArkheStore((state) => state.pcrResults);
export const useIsRunningPCR = () => useArkheStore((state) => state.isRunningPCR);
export const useRestrictionSites = () => useArkheStore((state) => state.restrictionSites);
export const useRadarData = () => useArkheStore((state) => state.radarData);
export const useIsExporting = () => useArkheStore((state) => state.isExporting);

export const useSentinelData = () => useArkheStore((state) => state.sentinelData);
export const useIsSentinelScanning = () => useArkheStore((state) => state.isSentinelScanning);
export const useSentinelHazards = () => useArkheStore((state) => state.sentinelHazards);
export const useIsAuditing = () => useArkheStore((state) => state.isAuditing);

export const useORFScanResult = () => useArkheStore((state) => state.orfScanResult);
export const useIsORFScanning = () => useArkheStore((state) => state.isORFScanning);

export const useOffTargetResult = () => useArkheStore((state) => state.offTargetResult);
export const useIsScanningOffTarget = () => useArkheStore((state) => state.isScanningOffTarget);

export const useSyntenyAnchors = () => useArkheStore((state) => state.syntenyAnchors);
export const useIsScanningSynteny = () => useArkheStore((state) => state.isScanningSynteny);

export const useProteinFold = () => useArkheStore((state) => state.proteinFold);
export const useIsFolding = () => useArkheStore((state) => state.isFolding);
export const useFoldError = () => useArkheStore((state) => state.foldError);

export const useBranches = () => useArkheStore((state) => state.branches);
export const useCurrentBranch = () => useArkheStore((state) => state.currentBranch);
export const useCommits = () => useArkheStore((state) => state.commits);

export const useShowCommitDialog = () => useArkheStore((state) => state.showCommitDialog);
export const usePendingMutation = () => useArkheStore((state) => state.pendingMutation);

export const useTerminalOutput = () => useArkheStore((state) => state.terminalOutput);
export const useTerminalInput = () => useArkheStore((state) => state.terminalInput);
export const useIsExecuting = () => useArkheStore((state) => state.isExecuting);
export const useTerminalLogs = () => useArkheStore((state) => state.terminalLogs);
export const useActiveGenomeId = () => useArkheStore((state) => state.activeGenomeId);
export const useIsSyncing = () => useArkheStore((state) => state.isSyncing);
export const useUserId = () => useArkheStore((state) => state.userId);
export const usePublicGenomes = () => useArkheStore((state) => state.publicGenomes);
export const useIsLoadingPublic = () => useArkheStore((state) => state.isLoadingPublic);

export const useComparisonSequence = () => useArkheStore((state) => state.comparisonSequence);
export const useDiffMode = () => useArkheStore((state) => state.diffMode);
export const useOffTargetHits = () => useArkheStore((state) => state.offTargetHits);
export const useSentinelLibrary = () => useArkheStore((state) => state.sentinelLibrary);
export const useThreatMatches = () => useArkheStore((state) => state.threatMatches);

// ── SPRINT 3: Selectors for new state ─────────────────────────────────────────
/** Full Supabase User object — null when guest */
export const useUser = () => useArkheStore((state) => state.user);
/** True when circuit breaker has tripped on 413/429 */
export const useIsOfflineMode = () => useArkheStore((state) => state.isOfflineMode);
/** Human-readable reason for offline mode — show in UI banner */
export const useOfflineModeReason = () => useArkheStore((state) => state.offlineModeReason);
/** True when custom Supabase credentials are active */
export const useSovereignModeActive = () => useArkheStore((state) => state.sovereignModeActive);