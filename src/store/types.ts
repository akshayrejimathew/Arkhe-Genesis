/**
 * src/store/types.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Single source of truth for every type that crosses slice boundaries.
 * Nothing in this file imports from other store modules — only from the
 * application's domain type packages and third-party libraries.
 *
 * ── CONTENTS ─────────────────────────────────────────────────────────────────
 *  1. Primitive store shapes  (Viewport, PendingMutation)
 *  2. Per-slice state/action interfaces (GenomeSlice … UISlice)
 *  3. ArkheState  — the full merged interface used as StateCreator<ArkheState>
 *  4. Domain-type re-exports so slices only import from one place
 *
 * ── MIDDLEWARE TUPLE ─────────────────────────────────────────────────────────
 * The store uses subscribeWithSelector.  Every StateCreator that needs access
 * to the full store should be declared as:
 *
 *   StateCreator<ArkheState, Mutators, [], YourSlice>
 *
 * where Mutators = [['zustand/subscribeWithSelector', never]]
 */

// ── Third-party ───────────────────────────────────────────────────────────────
import type { User } from '@supabase/supabase-js';

// ── Application domain types ──────────────────────────────────────────────────
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
  ORF,
} from '@/types/arkhe';
import type { SystemLog } from '@/types/SystemLog';
import type { PublicGenome } from '@/lib/supabasePublic';
import type { BioHazard } from '@/lib/sentinelAudit';
import type { CommandResult } from '@/lib/terminalParser';
import type { SignatureLibrary, ThreatMatch } from '@/lib/sentinel/ScreeningEngine';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · Primitive store shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The rendered window of sequence data returned by LOAD_SLICE and stored in
 * Zustand.  All fields except `start`/`end` are optional because the viewport
 * is pre-initialised before the first LOAD_SLICE round-trip completes.
 */
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

/**
 * A mutation that has been staged for display in the SurgicalCommit dialog
 * but not yet written to the engine.  Cleared by commitMutationWithReason or
 * cancelPendingMutation.
 */
export interface PendingMutation {
  slabIndex: number;
  offset: number;
  base: BaseCode;
  meta?: {
    user: string;
    reason: string;
    branch?: string;
    isCheckpoint?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · Per-slice state + action interfaces
//
// Each interface covers exactly one slice file.  They are kept separate so
// StateCreator can reference only the slice it owns while still having typed
// access to the full ArkheState via the first generic parameter.
// ─────────────────────────────────────────────────────────────────────────────

// ── § 2a · Genome slice ───────────────────────────────────────────────────────

export interface GenomeState {
  // Worker process
  worker: Worker | null;
  workerConnected: boolean;
  lastPing: number;
  workerError: string | null;

  // Genome metadata
  activeGenomeId: string | null;
  genomeLength: number;
  slabMetas: Map<number, SlabMeta>;
  editedSlabs: Set<number>;

  // Rendered viewport (LOAD_SLICE result)
  viewport: Viewport;
  viewportData: SliceResponse | null;
  currentSlice: number;
  isInitialized: boolean;
  // LB-11/14: Added viewportVersion field for React Concurrent mode safety
  viewportVersion: number;

  // Simulation flags
  isRunningPCR: boolean;
  pcrResults: PCRProduct[];
  isMappingRestriction: boolean;
  restrictionSites: RestrictionSite[];
  isGeneratingRadar: boolean;
  radarData: RadarBin[];
  isExporting: boolean;

  // Splice & isoform results derived from the current viewport
  sliceSpliceSites: SpliceSite[];
  sliceIsoforms: SpliceIsoform[];
  sliceProteinProperties: ProteinProperties | null;

  // Synteny ghosting
  syntenyAnchors: SyntenyAnchor[];
  isScanningSynteny: boolean;

  // Off-target heatmap (separate from OffTarget Radar which lives in ChronosSlice)
  offTargetHits: OffTargetHit[];

  // Cloud persistence
  isSyncing: boolean;
  publicGenomes: PublicGenome[];
  isLoadingPublic: boolean;

  // Diff mode
  comparisonSequence: string | null;
  diffMode: boolean;

  // ── FR-01: Frozen Recovery — slab ↔ cloud state tracking ─────────────────
  //
  // isRealigning
  //   Set to true the moment COMMIT_SYNC detects a txId mismatch between the
  //   worker's SlabManager and the authoritative cloud HEAD. Cleared once
  //   loadGenomeFromCloud() completes the full recovery re-load.
  //   SequenceView uses this as the PRIMARY guard signal to show the
  //   "Re-aligning Memory..." overlay instead of rendering stale buffer data.
  //
  // slabVersion
  //   Mirrors SlabManager.slabVersion. Incremented by 1 on every
  //   SlabManager.hardReset() call. Starts at 0. The store reflects this value
  //   immediately when the worker reports 'hard_reset_required' from
  //   VERIFY_SLAB_STATE. Used as a SECONDARY guard signal in SequenceView
  //   (slabVersion !== slabAcknowledgedVersion).
  //
  // slabAcknowledgedVersion
  //   The slabVersion value at the time the last successful setViewportData()
  //   ran. Normally equals slabVersion. Diverges from slabVersion only in the
  //   window between a hard reset and the first successful requestViewport()
  //   call after the reset. Cleared (back to equality with slabVersion) by
  //   setViewportData() and by the end of loadGenomeFromCloud().
  //
  isRealigning: boolean;
  slabVersion: number;
  slabAcknowledgedVersion: number;
}

export interface GenomeActions {
  // Worker lifecycle
  initWorker: () => Promise<void>;
  initializeEngine: (sequence?: string) => Promise<void>;

  // File I/O
  loadFile: (file: File, name?: string) => Promise<void>;
  loadGenomeFromCloud: (genomeId: string) => Promise<void>;

  // Viewport
  requestViewport: (start: number, end: number) => Promise<SliceResponse>;
  fetchGenomeMetadata: () => Promise<{ genomeLength: number; slabMetas: SlabMeta[] }>;

  // Feature map
  addFeature: (feature: Omit<FeatureTag, 'id'>) => Promise<FeatureTag>;
  getFeaturesAt: (offset: number) => Promise<FeatureTag[]>;

  // Motif search
  findMotif: (
    pattern: string,
    start?: number,
    end?: number,
    maxMismatches?: number
  ) => Promise<{ start: number; end: number }[]>;

  // Simulation
  runPCR: (
    forwardPrimer: string,
    reversePrimer: string,
    options?: { maxMismatches?: number; minProduct?: number; maxProduct?: number }
  ) => Promise<PCRProduct[]>;
  mapRestrictionSites: (enzymes?: string[]) => Promise<RestrictionSite[]>;
  refreshRadar: (numBins?: number) => Promise<RadarBin[]>;
  exportMutantFasta: () => Promise<{ filename: string; content: string }>;

  // ORF
  getORFScanResult: () => Promise<ORFScanResult | null>;
  refreshORFScan: () => Promise<ORFScanResult | null>;
  getORFsInRange: (start: number, end: number) => Promise<ORF[]>;

  // Splice & protein
  predictSpliceSites: (start: number, end: number, strand?: '+' | '-') => Promise<SpliceSite[]>;
  predictIsoforms: (
    start: number,
    end: number,
    orf: ORF,
    spliceSites: SpliceSite[]
  ) => Promise<SpliceIsoform[]>;
  getProteinProperties: (aaSeq: string) => Promise<ProteinProperties>;

  // Synteny
  getSyntenyAnchors: () => Promise<SyntenyAnchor[]>;
  refreshSyntenyScan: () => Promise<SyntenyAnchor[]>;

  // Off-target heatmap
  runOffTargetHeatmap: (query: string, maxMismatch?: number) => Promise<OffTargetHit[]>;
  clearOffTargetHits: () => void;

  // Diff mode
  setComparisonSequence: (seq: string | null) => void;
  toggleDiffMode: () => void;

  // Public genomes
  loadPublicGenomes: () => Promise<void>;
  fetchPublicGenomeById: (id: string) => Promise<PublicGenome>;

  // Internal setters
  setWorkerConnected: (connected: boolean) => void;
  setWorkerError: (error: string | null) => void;
  updateSlabMeta: (metas: SlabMeta[]) => void;
  addEditedSlab: (slabIndex: number) => void;
  setViewportData: (data: SliceResponse) => void;
  setSyncing: (val: boolean) => void;
  setPCRResults: (results: PCRProduct[]) => void;
  setRestrictionSites: (sites: RestrictionSite[]) => void;
  setRadarData: (data: RadarBin[]) => void;
  setPublicGenomes: (genomes: PublicGenome[]) => void;
  setLoadingPublic: (loading: boolean) => void;
  setDiffMode: (mode: boolean) => void;
  setOffTargetHits: (hits: OffTargetHit[]) => void;
  setSyntenyAnchors: (anchors: SyntenyAnchor[]) => void;
  setScanningSynteny: (scanning: boolean) => void;
  setORFScanResult: (result: ORFScanResult | null) => void;
  setORFScanning: (scanning: boolean) => void;

  // FR-01: Frozen Recovery — realignment flag setter
  setIsRealigning: (realigning: boolean) => void;
}

/** Full genome slice type consumed by StateCreator. */
export type GenomeSlice = GenomeState & GenomeActions;

// ── § 2b · Chronos slice ──────────────────────────────────────────────────────

export interface ChronosState {
  // History / branching
  chronosHead: string | null;
  chronosTransactions: TransactionSummary[];
  branches: Branch[];
  currentBranch: string;
  commits: Commit[];

  // Surgical commit flow
  pendingMutation: PendingMutation | null;
  showCommitDialog: boolean;

  // Off-target radar (distinct from the heatmap in GenomeSlice)
  offTargetResult: OffTargetResult | null;
  isScanningOffTarget: boolean;

  // Protein folding
  proteinFold: ProteinFold | null;
  isFolding: boolean;
  foldError: string | null;

  // ── Async Mutex (MX-01) ────────────────────────────────────────────────────
  //
  // `isLocked` — true while any atomic action (undo, redo, applyLocalMutation)
  //   is executing. Components read this to display a loading / disabled state
  //   so the user cannot trigger a second action before the first completes.
  //
  // `actionQueue` — the tail of the currently-chained promise queue.
  //   Each new atomic action appends itself via .then() so that actions are
  //   processed strictly one-by-one in submission order.  This field is a
  //   plain Promise<void> stored in Zustand; it is intentionally excluded from
  //   devtools serialisation (it is non-serialisable).  Components should
  //   never read this field directly — use `isLocked` instead.
  //
  isLocked: boolean;
  actionQueue: Promise<void>;
}

export interface ChronosActions {
  // Mutations
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

  // Undo / Redo  (CF-04: viewport sync applied after each)
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  // Diff export
  getDiffForTx: (txId: string) => Promise<unknown>;

  // Branching
  createBranch: (name: string, fromCommitId?: string) => Promise<boolean>;
  checkout: (branchName: string) => Promise<boolean>;
  merge: (
    sourceBranch: string,
    targetBranch?: string,
    message?: string
  ) => Promise<string | null>;
  getBranches: () => Promise<Branch[]>;
  getCommits: () => Promise<Commit[]>;

  // Off-target radar
  scanOffTargets: (query: string, maxMismatch?: number) => Promise<OffTargetResult>;
  clearOffTargetResult: () => void;

  // Protein folding
  foldProtein: (sequence: string, consentObtained?: boolean) => Promise<ProteinFold>;
  clearProteinFold: () => void;

  // Internal setters
  setChronosHead: (txId: string | null) => void;
  setChronosTransactions: (txs: TransactionSummary[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setCommits: (commits: Commit[]) => void;
  setShowCommitDialog: (show: boolean) => void;
  setPendingMutation: (mutation: PendingMutation | null) => void;
  setOffTargetResult: (result: OffTargetResult | null) => void;
  setScanningOffTarget: (scanning: boolean) => void;
  setProteinFold: (fold: ProteinFold | null) => void;
  setFolding: (folding: boolean) => void;
  setFoldError: (error: string | null) => void;
}

/** Full chronos slice type consumed by StateCreator. */
export type ChronosSlice = ChronosState & ChronosActions;

// ── § 2c · UI slice ───────────────────────────────────────────────────────────

export interface UIState {
  // Auth
  user: User | null;
  userId: string | null;

  // Offline / sovereign mode
  isOfflineMode: boolean;
  offlineModeReason: string | null;
  sovereignModeActive: boolean;

  // Sentinel
  sentinelData: SentinelSummary | null;
  isSentinelScanning: boolean;
  sentinelHazards: BioHazard[];
  isAuditing: boolean;
  sentinelLibrary: SignatureLibrary | null;
  threatMatches: ThreatMatch[];

  // ORF autopilot
  orfScanResult: ORFScanResult | null;
  isORFScanning: boolean;

  // Terminal
  terminalOutput: string[];
  terminalInput: string;
  isExecuting: boolean;
  terminalLogs: SystemLog[];
}

export interface UIActions {
  // Auth
  setUser: (user: User | null) => void;
  clearUser: () => void;
  setUserId: (userId: string | null) => void;

  // Sovereign mode  (CF-06 hardened)
  activateSovereignMode: (url: string, key: string) => void;
  deactivateSovereignMode: () => void;
  resetCircuitBreaker: () => void;

  // Sentinel
  getSentinelSummary: () => Promise<SentinelSummary | null>;
  refreshSentinelScan: () => Promise<SentinelSummary | null>;
  runSentinelAudit: (start?: number, end?: number) => Promise<BioHazard[]>;
  clearHazards: () => void;
  setSentinelLibrary: (lib: SignatureLibrary | null) => void;
  runThreatScreening: (
    sequence: string,
    start?: number,
    end?: number
  ) => Promise<ThreatMatch[]>;
  clearThreatMatches: () => void;

  // Terminal
  setTerminalInput: (input: string) => void;
  executeTerminalCommand: (input: string) => Promise<CommandResult>;
  clearTerminalOutput: () => void;
  clearTerminalLogs: () => void;

  // Logging
  addSystemLog: (log: SystemLog) => void;

  // Internal setters
  setSentinelData: (data: SentinelSummary | null) => void;
  setSentinelScanning: (scanning: boolean) => void;
  setSentinelHazards: (hazards: BioHazard[]) => void;
  setTerminalOutput: (output: string[]) => void;
  addTerminalOutput: (line: string) => void;
  setExecuting: (executing: boolean) => void;
  setThreatMatches: (matches: ThreatMatch[]) => void;
}

/** Full UI slice type consumed by StateCreator. */
export type UISlice = UIState & UIActions;

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · ArkheState — the full merged store interface
//
// This is the type passed as the FIRST generic to StateCreator<ArkheState, …>
// in every slice file.  It is the intersection of all slice types so that
// get() inside any slice returns a fully-typed combined state.
// ─────────────────────────────────────────────────────────────────────────────

export type ArkheState = GenomeSlice & ChronosSlice & UISlice;

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · Convenience Middleware tuple alias
//
// Paste this alias into StateCreator declarations to avoid repeating the
// verbose subscribeWithSelector middleware tuple everywhere.
// ─────────────────────────────────────────────────────────────────────────────

/** Middleware mutators for a store that wraps subscribeWithSelector. */
export type StoreMutators = [['zustand/subscribeWithSelector', never]];

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · Domain-type re-exports
//
// Slices import domain types from here rather than from deep package paths,
// keeping import graphs shallow and refactor-friendly.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  User,
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
  ORF,
  SystemLog,
  PublicGenome,
  BioHazard,
  CommandResult,
  SignatureLibrary,
  ThreatMatch,
};

/**
 * TransactionSummary — add this to src/store/types.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This interface must be exported from src/store/types.ts so that both
 * chronosSlice.ts and genomeSlice.ts can import it. If it is already present
 * under a different name, update the import in both slice files accordingly.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Lightweight summary of a Chronos transaction pushed to the UI via the
 *   CHRONOS_HISTORY worker message. Distinct from a full Commit — it carries
 *   only the fields needed to render the history panel without transmitting
 *   the entire MutationRecord[].
 *
 * CONTEXT (LB-10 fix):
 *   The CHRONOS_HISTORY worker message handler in genomeSlice.ts was previously
 *   typed as `payload as Parameters<typeof get>`, which resolves to `[]` — a
 *   zero-arg tuple. TypeScript accepted the cast silently but it was semantically
 *   wrong. The correct type is `TransactionSummary[]`, which this interface
 *   provides. Both chronosSlice.ts and genomeSlice.ts now import it explicitly.
 */
export interface TransactionSummary {
  /** The unique transaction ID produced by Chronos.generateTxId(). */
  txId: string;
  /** Optional human-readable summary of what changed in this commit. */
  commitMessage?: string;
  /** The user or system actor that authored this commit. */
  author?: string;
  /** Unix timestamp (ms) at which the commit was created. */
  timestamp: number;
  /** The branch this commit was recorded on. */
  branchName?: string;
  /** Whether this commit was explicitly marked as a restorable checkpoint. */
  isCheckpoint?: boolean;
  /** Added for DAG integrity - parent transaction ID if this commit has a parent. */
  parentTxId?: string;
  /** Added for audit transparency - number of mutations in this commit. */
  mutationCount?: number;
}