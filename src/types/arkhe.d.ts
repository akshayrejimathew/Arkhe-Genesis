/**
 * arkhe.d.ts
 * Canonical TypeScript definitions for the Arkhé Genomic IDE.
 *
 * AUDIT III CHANGES (2026-02-21):
 *   - ProteinFold: Unified single source of truth. Merged fields from the
 *     diverged proteinFold.ts local interface. `method` is now a typed literal
 *     union. `rateLimitNotice`, `disclosure`, `atoms`, `energy`, `rmsd` are
 *     optional. The local interface in proteinFold.ts MUST be deleted — this
 *     type is the only canonical definition. This closes SHADOW-04 (dual-
 *     definition type divergence) and eliminates the unsafe `as
 *     ExtendedProteinFold` cast in ProteinViewport.tsx.
 *
 *   - Removed dead types: WorkerRequest and WorkerResponse (no longer used).
 */

// -------------------- Base Types --------------------
export type BaseCode = 0 | 1 | 2 | 3 | 4;

// -------------------- Feature Map --------------------
export interface FeatureTag {
  id: string;
  name: string;
  type: 'exon' | 'intron' | 'cds' | 'promoter' | 'binding_site' | 'repeat' | 'other';
  start: number;
  end: number;
  strand?: '+' | '-';
  attributes?: Record<string, unknown>;
}

// -------------------- Slab Management --------------------
export interface SlabMeta {
  slabIndex: number;
  length: number;
  hash?: string;
}

// -------------------- Mutation & Impact --------------------
export interface MutationRecord {
  txId: string;
  slabIndex: number;
  offset: number;
  oldBase: BaseCode;
  newBase: BaseCode;
  timestamp: number;
  author?: string;
  commitMessage?: string;
}

export type MutationClassification =
  | 'synonymous'
  | 'missense'
  | 'nonsense'
  | 'frameshift'
  | 'splice-site'
  | 'other';

export interface MutationImpact {
  classification: MutationClassification;
  missenseCategory?: 'conservative' | 'radical';
  chemicalShift?: {
    from: string;
    to: string;
    polarityChange:
      | 'polar->nonpolar'
      | 'nonpolar->polar'
      | 'polar->polar'
      | 'nonpolar->nonpolar'
      | 'none';
  };
  biochemicalShift?: {
    hydrophobicityDelta: number;
    chargeChange: string;
    sizeChange: number;
  };
  codonPosition?: number;
  affectedProteinRegion?: {
    proteinId?: string;
    aaStart: number;
    aaEnd: number;
    aaSequence?: string;
  };
  tmBefore?: number;
  tmAfter?: number;
  deltaG?: number;
}

export interface MutationResult {
  slabIndex: number;
  offset: number;
  oldBaseCode: BaseCode;
  newBaseCode: BaseCode;
  impact: MutationImpact;
  txId: string;
}

// -------------------- ORF --------------------
export interface ORF {
  frame: -3 | -2 | -1 | 0 | 1 | 2;
  start: number;
  end: number;
  aaSequence: string;
  strand: '+' | '-';
}

// -------------------- Chronos --------------------
// TransactionSummary moved to src/store/types.ts for type unification

export interface Commit {
  txId: string;
  parentTxIds: string[];
  childrenTxIds: string[];
  mutations: MutationRecord[];
  timestamp: number;
  author?: string;
  commitMessage?: string;
  branchName?: string;
  isCheckpoint?: boolean;
}

export interface Branch {
  name: string;
  headCommitId: string;
  createdAt: number;
}

// -------------------- Diff --------------------
export interface BaseDiff {
  offset: number;
  wildTypeBase: BaseCode;
  mutantBase: BaseCode;
}

export interface DetailedDiff extends BaseDiff {
  codonIndex?: number;
  codonBefore?: [BaseCode, BaseCode, BaseCode];
  codonAfter?: [BaseCode, BaseCode, BaseCode];
  aaBefore?: string;
  aaAfter?: string;
  classification: MutationClassification;
  chemicalShift?: MutationImpact['chemicalShift'];
}

// -------------------- Slice Response (UI-Ready) --------------------
export interface SliceResponse {
  start: number;
  end: number;
  buffer: ArrayBuffer;
  sequence: string;
  translations: {
    frame0: string;
    frame1: string;
    frame2: string;
    frame_1: string;
    frame_2: string;
    frame_3: string;
  };
  gcPercent: number;
  features: FeatureTag[];
  orfs: ORF[];
  spliceSites?: SpliceSite[];
  isoforms?: SpliceIsoform[];
  proteinProperties?: ProteinProperties;
}

// -------------------- PCR --------------------
export interface PCRProduct {
  forwardStart: number;
  forwardEnd: number;
  reverseStart: number;
  reverseEnd: number;
  productLength: number;
  forwardTm: number;
  reverseTm: number;
  forwardMismatches: number;
  reverseMismatches: number;
}

// -------------------- Restriction --------------------
export interface RestrictionSite {
  enzyme: string;
  recognitionSite: string;
  position: number;
  strand: '+' | '-';
}

// -------------------- Radar --------------------
export interface RadarBin {
  binIndex: number;
  start: number;
  end: number;
  gcPercent: number;
  orfDensity: number;
}

// -------------------- Sentinel --------------------
export interface SentinelBin {
  binIndex: number;
  start: number;
  end: number;
  gcPercent: number;
  motifCounts: Record<string, number>;
}

export interface SentinelSummary {
  genomeLength: number;
  binSize: number;
  bins: SentinelBin[];
  timestamp: number;
}

// -------------------- ORF Scan --------------------
export interface ORFScanResult {
  genomeLength: number;
  orfs: ORF[];
  totalORFs: number;
  longestORF: ORF | null;
  timestamp: number;
  scanProgress: number;
}

// -------------------- Protein --------------------
export interface ProteinProperties {
  hydrophobicityProfile: number[];
  isoelectricPoint: number;
}

// -------------------- Splice --------------------
export interface SpliceSite {
  type: 'donor' | 'acceptor' | 'branch';
  position: number;
  strand: '+' | '-';
  score: number;
}

export interface SpliceIsoform {
  donor: number;
  acceptor: number;
  splicedSequence: string;
  proteinSequence: string;
  molecularWeight: number;
}

// -------------------- Off‑Target --------------------
export interface OffTargetHit {
  position: number;
  strand: '+' | '-';
  mismatches: number;
  sequence: string;
}

export interface OffTargetResult {
  query: string;
  maxMismatch: number;
  hits: OffTargetHit[];
  hitCount: number;
  safetyScore: number;
  timestamp: number;
}

// -------------------- Synteny Ghosting --------------------
export interface SyntenyAnchor {
  type: 'direct_repeat' | 'inverted_repeat' | 'translocation' | 'inversion';
  startA: number;
  endA: number;
  startB: number;
  endB: number;
  identity: number;
  length: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// -------------------- Protein Folding — CANONICAL DEFINITION -----------------
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Single source of truth for the ProteinFold result object.
 *
 * AUDIT III FIX (SHADOW-04):
 *   The previous arkhe.d.ts and proteinFold.ts maintained two diverging
 *   interfaces for the same runtime object. All consumers — useArkheStore,
 *   ProteinViewport, and proteinFold.ts itself — must import this definition
 *   exclusively. The local `interface ProteinFold` block in proteinFold.ts has
 *   been removed. The `as ExtendedProteinFold` cast in ProteinViewport has
 *   been removed; the store's `proteinFold: ProteinFold | null` now carries
 *   all the fields the viewport needs without casting.
 *
 * Field provenance:
 *   Core fields     — present in both previous definitions
 *   method          — typed literal union (not loose `string`) for exhaustive
 *                     switch/conditional checks in the UI
 *   warning         — clinical disclaimer; must always be visible when present
 *   rateLimitNotice — set only on the 429 / ESM rate-limit path; drives the
 *                     separate orange UI notice in ProteinViewport
 *   disclosure      — GDPR/CCPA notice surfaced when sequence data is
 *                     transmitted to the ESM Atlas third-party endpoint
 *   atoms/energy/rmsd — reserved for future PDB-quality folding engines
 */
export interface ProteinFold {
  /** Translated amino-acid sequence used as folding input. */
  aminoAcids: string;

  /** Cα backbone coordinates, one entry per residue. */
  coordinates: Array<{ x: number; y: number; z: number }>;

  /** Per-residue secondary structure assignment. */
  secondaryStructure: Array<'alpha' | 'beta' | 'coil'>;

  /** Per-residue prediction confidence in [0, 1]. */
  confidence: number[];

  /**
   * Which engine produced this result.
   *   'ESM_ATLAS'             — validated structure from the ESM Atlas API
   *   'CHOU_FASMAN_HEURISTIC' — local propensity-table heuristic; NOT for
   *                             clinical use; warning field will be populated
   */
  method: 'ESM_ATLAS' | 'CHOU_FASMAN_HEURISTIC';

  /**
   * Clinical disclaimer. Present whenever method === 'CHOU_FASMAN_HEURISTIC'.
   * ProteinViewport MUST render this as a permanently visible yellow badge.
   * It must never be hidden, occluded, or toggled off.
   */
  warning?: string;

  /**
   * Set when ESM Atlas returned HTTP 429 and we fell back to the heuristic.
   * Rendered as a separate orange notice in ProteinViewport so the researcher
   * understands *why* they received heuristic output rather than ESM folding.
   */
  rateLimitNotice?: string;

  /**
   * GDPR/CCPA disclosure. Set when amino-acid sequence data was transmitted
   * to the third-party ESM Atlas endpoint. Surfaced in the transparency panel.
   */
  disclosure?: string;

  // ── Reserved — future PDB-quality deep-learning engine output ─────────────
  /** All-atom positions (Å). Populated only by future high-fidelity engines. */
  atoms?: Array<{
    x: number;
    y: number;
    z: number;
    element: string;
    type: 'alpha' | 'beta' | 'coil';
  }>;
  /** Predicted free energy (kcal/mol). */
  energy?: number;
  /** Root-mean-square deviation from reference structure (Å). */
  rmsd?: number;
}

// -------------------- Assembly Junction Prediction --------------------
export interface AssemblyPrediction {
  valid: boolean;
  message: string;
  overlapLength?: number;
  scarLength?: number;
  frameshift?: boolean;
}

export interface SystemLog {
  timestamp: number;
  category: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Summary of a transaction (commit) for history views.
 */
export interface TransactionSummary {
  txId: string;
  parentTxId: string | null;
  timestamp: number;
  author?: string;
  commitMessage?: string;
  mutationCount: number;
}