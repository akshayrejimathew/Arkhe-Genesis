/**
 *
 * ── SPRINT 2 CHANGES ─────────────────────────────────────────────────────────
 *   TASK 2: UI State Persistence
 *     • `themeMode` added to UIState (default 'abyssal')
 *     • `setThemeMode` added to UIActions
 *     • StoreMutators updated to include zustand/persist so StateCreator
 *       declarations in every slice remain correctly typed after index.ts
 *       wraps the store with persist(subscribeWithSelector(...)).
 * ─────────────────────────────────────────────────────────────────────────────
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
 * The store uses subscribeWithSelector (outer) wrapping persist (inner).
 * Every StateCreator that needs access to the full store should be declared as:
 *
 *   StateCreator<ArkheState, Mutators, [], YourSlice>
 *
 * where Mutators = StoreMutators (see § 4 below).
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
  isRealigning: boolean;
  slabVersion: number;
  slabAcknowledgedVersion: number;

  /**
   * SPRINT 2 FIX (TASK 1) — Race-condition lock.
   * True while loadFile or loadGenomeFromCloud is executing.
   * Any concurrent call to either method is rejected with a SystemLog warning.
   */
  isProcessing: boolean;
}

export interface GenomeActions {
  // Worker lifecycle
  initWorker: () => Promise<void>;
  initializeEngine: (sequence?: string) => Promise<void>;

  // File I/O
  loadFile: (file: File, name?: string) => Promise<void>;
  loadGenomeFromCloud: (genomeId: string) => Promise<void>;

  // Viewport
  requestViewport: (start: number, end: number) => Promise<SliceResponse | null>;
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
  /** SPRINT 2 FIX: Manual override for the race-condition lock (testing/recovery). */
  setIsProcessing: (processing: boolean) => void;
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
  // ── SPRINT 2: Theme mode (persisted) ───────────────────────────────────────
  /** The active colour theme. Persisted to 'arkhe-ui-storage' via Zustand persist. */
  themeMode: 'abyssal' | 'cleanroom';

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

  // ── SPRINT 3 TASK 4: Interactive Guide Hook ──────────────────────────────────
  /** True on first visit / signup; drives onboarding entry. */
  userIsNew: boolean;
  /** Whether the onboarding overlay is currently active. */
  onboardingActive: boolean;
}

export interface UIActions {
  // ── SPRINT 2: Theme ─────────────────────────────────────────────────────────
  /** Persist-aware theme setter. Updates the store and is rehydrated on boot. */
  setThemeMode: (theme: 'abyssal' | 'cleanroom') => void;

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

  // ── SPRINT 3 TASK 4: Interactive Guide Hook ──────────────────────────────────
  setUserIsNew: (isNew: boolean) => void;
  startOnboarding: () => void;
  stopOnboarding: () => void;
}

/** Full UI slice type consumed by StateCreator. */
export type UISlice = UIState & UIActions;

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · ArkheState — the full merged store interface
// ─────────────────────────────────────────────────────────────────────────────

export type ArkheState = GenomeSlice & ChronosSlice & UISlice;

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · Convenience Middleware tuple alias
//
// SPRINT 2: Updated to include zustand/persist because index.ts now wraps the
// store as:  create()(subscribeWithSelector(persist(...slices, options)))
//
// The order here matches the middleware application order (outermost first):
//   subscribeWithSelector  →  outer
//   persist                →  inner (wraps the raw StateCreators directly)
//
// All three slice StateCreators are declared as:
//   StateCreator<ArkheState, StoreMutators, [], MySlice>
// ─────────────────────────────────────────────────────────────────────────────

/** Middleware mutators for a store that uses subscribeWithSelector + persist. */
export type StoreMutators = [
  ['zustand/subscribeWithSelector', never],
  ['zustand/persist', unknown],
];

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · Domain-type re-exports
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
 * TransactionSummary — lightweight summary of a Chronos transaction for
 * history views. Distinct from a full Commit — carries only the fields
 * needed to render the history panel.
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