/// <reference lib="webworker" />

/**
 * ArkheEngine.worker.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SS-01 — Scientific Streaming: CHUNK_RECEIVED handler (NEW)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   The CHUNK_RECEIVED message type is the worker-side half of the
 *   SlabStreamingPipeline defined in SlabManager.ts.
 *
 *   PROTOCOL:
 *
 *     Main thread                         Worker
 *     ─────────────────────────────────   ──────────────────────────────────
 *     SlabStreamingPipeline.streamFromUrl()
 *       accumulate 1 MB network bytes
 *       postMessage CHUNK_RECEIVED ──────►  case 'CHUNK_RECEIVED':
 *         { chunkId, buffer,                 1. record beforeLength
 *           isFinal, totalBytes }            2. handleStreamChunk()
 *                                               → FASTA parse
 *                                               → appendBytes() → slabs
 *                                               → OOM guard
 *                                            3. Per-chunk Sentinel scan
 *                                               on [beforeLength, afterLength)
 *                                            4. If isFinal → finalizeStream()
 *                                            5. postMessage CHUNK_LOADED
 *                                               (progress broadcast)
 *                                   ◄────── 6. postMessage CHUNK_ACK
 *                                               { chunkId, ok }
 *       acknowledgeChunk(chunkId)
 *       → inFlight--
 *       → next chunk unblocked
 *
 *   CHUNK_ACK is sent AFTER both appendBytes() AND the Sentinel scan are
 *   complete, so the main thread's backpressure directly reflects the
 *   worker's actual processing capacity (not just message-queue depth).
 *
 *   ERROR PATH:
 *     If handleStreamChunk() returns void (OOM abort or malformed FASTA),
 *     the handler posts CHUNK_ERR instead of CHUNK_ACK. The pipeline's
 *     rejectChunk() then throws in streamFromUrl(), surfacing the error
 *     to the caller.
 *
 *   SENTINEL INTEGRATION:
 *     Each chunk's newly committed base range [beforeLength, afterLength)
 *     is read back from the slabs, converted to a string, and passed to
 *     engine.screenThreats(). If threats are found, a SENTINEL_THREAT_FOUND
 *     message is broadcast immediately — while the rest of the genome is
 *     still downloading. This is the "scan the beginning while the end
 *     downloads" property described in the SS-01 design doc.
 *
 *   CHUNK_RECEIVED vs STREAM_CHUNK:
 *     STREAM_CHUNK is the legacy message type sent by the old main-thread
 *     streaming code. It remains supported for backwards compatibility.
 *     CHUNK_RECEIVED is the new Scientific Streaming path with:
 *       • Backpressure ACK
 *       • Per-chunk Sentinel scan
 *       • CHUNK_LOADED progress broadcast
 *       • isFinal flag that auto-calls finalizeStream()
 */

import { SlabManager, SLAB_SIZE } from '../../lib/SlabManager';
import { StreamParser } from '../../lib/StreamParser';
import { DiffEngine } from '../../lib/DiffEngine';
import { Chronos, type Commit, type Branch } from '../../lib/Chronos';
import BioLogic, {
  type Organism,
  type HairpinPrediction,
  type RestrictionCutSite,
  RESTRICTION_ENZYMES
} from '../../lib/BioLogic';
import { Persistence } from '../../lib/Persistence';
import { BASE, type BaseCode } from '../../lib/bases';
import type {
  MutationRecord,
  MutationResult,
  MutationImpact,
  ORF,
  SlabMeta,
  TransactionSummary,
  FeatureTag,
  SliceResponse,
  PCRProduct,
  RestrictionSite,
  RadarBin,
  SentinelBin,
  SentinelSummary,
  ORFScanResult,
  OffTargetHit,
  OffTargetResult,
  SyntenyAnchor,
  SpliceSite,
  SpliceIsoform,
  ProteinProperties,
  AssemblyPrediction,
} from '../../types/arkhe';
import { ScreeningEngine, type ThreatMatch, type SignatureLibrary } from '../../lib/sentinel/ScreeningEngine';

// ---------- Constants ----------
const TM_WINDOW = 10;
const SENTINEL_BIN_SIZE = 10_000;
const SENTINEL_MOTIFS = ['TATAAA', 'CCGCCC', 'GAATTC'];
const ORF_SCAN_BATCH_SIZE = 50_000;
const ORF_MIN_AA_LENGTH = 30;

const OFF_TARGET_SEED_LENGTH = 8;
const OFF_TARGET_DEFAULT_MAX_MISMATCH = 2;

const REPEAT_MIN_LENGTH = 100;
const REPEAT_HASH_BASE = 101;
const REPEAT_HASH_MOD = 2 ** 31 - 1;

const COMPLEMENT: Record<BaseCode, BaseCode> = {
  0: 3,
  1: 2,
  2: 1,
  3: 0,
  4: 4,
};

// ---------- Yielding loop constants ----------
const YIELD_INTERVAL_MS = 50;
const YIELD_ITERATION_COUNT = 5000;
const MAX_SCAN_TIME_MS = 2000;

// ---------- TASK 1: Unbounded streamBuffer Guard ----------
const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50 MB
const HARD_MEMORY_LIMIT = 512 * 1024 * 1024; // 512 MB

// ---------- TASK 2: Auto‑annotation chunk size ----------
const AUTO_ANNOTATE_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const AUTO_ANNOTATE_OVERLAP = 10 * 1024; // 10 KB overlap to catch boundary features

// ---------- TASK 2 (Sentinel): Overlap for threat scanning ----------
const KMER_SIZE = 24; // must match ScreeningEngine's constant

// ---------- SS-01: Per-chunk Sentinel scan constants ----------
/**
 * Maximum bases to Sentinel-scan per CHUNK_RECEIVED message.
 *
 * Sentinel scanning is O(n) in the chunk length.  For a 1 MB slab
 * (≈ 1M bases at 1 byte/base), a full scan takes ≈ 8 ms on a modern CPU.
 * We cap at 2 MB to prevent the scan from consuming an entire 16 ms frame
 * budget, keeping the worker responsive to other messages.
 */
const SS_SENTINEL_SCAN_MAX_BASES = 2 * 1024 * 1024; // 2 MB

/**
 * Base-code → IUPAC character lookup for converting slab bytes back to
 * the string required by ScreeningEngine.scan() and screenThreats().
 */
const BASE_CODE_TO_CHAR = ['A', 'C', 'G', 'T', 'N'] as const;

// ---------- Telemetry Logger (with Debug Mode) ----------
let DEBUG_MODE = false;

function logToUI(
  category: 'SENTINEL' | 'MEMORY' | 'CHRONOS' | 'ORF' | 'WORKER' | 'SYSTEM' | 'THERMO' | 'ASSEMBLY' | 'GHOST' | 'PRECISION' | 'PCR' | 'STRUCTURE' | 'RESTRICTION' | 'ANNOTATION',
  message: string,
  level: 'info' | 'success' | 'warning' | 'error' = 'info',
  debugOnly: boolean = false
) {
  if (debugOnly && !DEBUG_MODE) return;
  if (self.postMessage) {
    self.postMessage({
      type: 'SYSTEM_LOG',
      payload: {
        timestamp: Date.now(),
        category,
        message,
        level,
      },
    });
  }
}

/**
 * State for the incremental synteny scan (direct/inverted repeats).
 */
interface SyntenyScanState {
  step: 'direct' | 'inverted' | 'done';
  hashMap: Map<number, number[]>;
  rcRegion: Uint8Array;
  keys: number[];
  keyIndex: number;
  positions: number[];
  i: number;
  j: number;
  anchors: SyntenyAnchor[];
  startTime: number;
  lastYieldTime: number;
  iterationsSinceYield: number;
  aborted: boolean;
}

class ArkheEngine {
  public slabManager: SlabManager;
  private streamParser: StreamParser;
  public chronos: Chronos;
  public diffEngine: DiffEngine;
  private bioLogic: typeof BioLogic;
  private persistence: Persistence;
  private initialized = false;
  private editedSlabs: Set<number> = new Set();

  // SHADOW-NEW-01 FIX: track whether SharedArrayBuffer is in use
  private useSharedBuffers = false;

  // Zombie transition prevention
  private activeTaskId: string | null = null;
  private taskCounter = 0;

  // TASK: Worker Task Cancellation - currentTaskId for killing Ghost Tasks
  private currentTaskId: number = 0;

  private sentinelCache: SentinelSummary | null = null;
  private sentinelTaskId: number | null = null;
  private sentinelLastGenomeLength = 0;

  private orfCache: ORFScanResult | null = null;
  private orfTaskId: number | null = null;
  private orfScanOffset = 0;

  private offTargetCache: Map<string, OffTargetResult> = new Map();
  private pendingOffTargetScan: { query: string; maxMismatch: number; callbackId?: string } | null = null;

  private syntenyAnchors: SyntenyAnchor[] = [];
  private syntenyTaskId: number | null = null;
  private syntenyScanState: SyntenyScanState | null = null;

  // ---------- Streaming buffers (LB-03 / LB-12 fix) ----------
  private streamByteBuffer: Uint8Array = new Uint8Array(65536);
  private streamByteLength: number = 0;
  private streamAborted: boolean = false;

  private stagingBuffer: Uint8Array = new Uint8Array(65536);
  private stagingIndex: number = 0;

  // ---------- Sentinel Threat Screening ----------
  public screeningEngine: ScreeningEngine = new ScreeningEngine();

  // ---------- TASK 3: Request cancellation for viewport loads ----------
  private viewportRequestCounter: number = 0;
  private latestViewportRequestId: number = 0;

  constructor() {
    this.slabManager = new SlabManager(false);
    this.streamParser = new StreamParser();
    this.chronos = new Chronos();
    this.diffEngine = new DiffEngine();
    this.bioLogic = BioLogic;
    this.persistence = new Persistence('arkhe-db', 1);
  }

  // --- Initialization ---
  async init(config: { useSharedArray: boolean; slabSize?: number; metadata?: Record<string, unknown>; debugMode?: boolean }) {
    this.useSharedBuffers = config.useSharedArray;
    this.slabManager = new SlabManager(config.useSharedArray);
    this.diffEngine = new DiffEngine();
    await this.persistence.open();
    this.initialized = true;

    DEBUG_MODE = config.debugMode ?? false;

    const originalCreateSlab = this.slabManager.createSlab.bind(this.slabManager);
    this.slabManager.createSlab = (slabIndex: number, initialData?: Uint8Array) => {
      const slab = originalCreateSlab(slabIndex, initialData);
      logToUI('MEMORY', `Slab ${slabIndex} allocated (${SLAB_SIZE / 1_048_576} MB)`, 'success', true);
      return slab;
    };

    logToUI('WORKER', 'Worker thread initialized', 'success');
    logToUI('SYSTEM', `SharedArrayBuffer allocator: ${config.useSharedArray ? 'enabled' : 'fallback'}`, 'info');
    logToUI('SYSTEM', `Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`, 'info');

    this.scheduleSentinelScan();
    this.scheduleORFScan();
    this.scheduleSyntenyScan();

    return { ok: true, slabSize: SLAB_SIZE, useShared: config.useSharedArray, debugMode: DEBUG_MODE };
  }

  resetEngine(expectedFileSize?: number): void {
    this.taskCounter++;
    this.activeTaskId = `task-${this.taskCounter}-${Date.now()}`;
    this.currentTaskId++;

    if (this.sentinelTaskId) {
      if (typeof self.cancelIdleCallback === 'function') {
        self.cancelIdleCallback(this.sentinelTaskId);
      }
      this.sentinelTaskId = null;
    }

    if (this.orfTaskId) {
      if (typeof self.cancelIdleCallback === 'function') {
        self.cancelIdleCallback(this.orfTaskId);
      }
      this.orfTaskId = null;
    }

    if (this.syntenyTaskId) {
      if (typeof self.cancelIdleCallback === 'function') {
        self.cancelIdleCallback(this.syntenyTaskId);
      }
      this.syntenyTaskId = null;
    }

    this.syntenyScanState = null;

    this.sentinelCache = null;
    this.sentinelLastGenomeLength = 0;
    this.orfCache = null;
    this.orfScanOffset = 0;
    this.syntenyAnchors = [];
    this.offTargetCache.clear();
    this.editedSlabs.clear();

    this.streamByteBuffer = new Uint8Array(65536);
    this.streamByteLength = 0;
    this.streamAborted = false;
    this.stagingIndex = 0;

    this.slabManager = new SlabManager(this.useSharedBuffers, expectedFileSize);

    logToUI('WORKER', `Engine reset — new task ID: ${this.activeTaskId}`, 'info');
    logToUI('MEMORY', 'SlabManager recreated — all prior genome data discarded', 'info');
  }

  private getCurrentTaskId(): string {
    return this.activeTaskId || 'unknown';
  }

  public getNextRequestId(): number {
    this.viewportRequestCounter++;
    this.latestViewportRequestId = this.viewportRequestCounter;
    return this.viewportRequestCounter;
  }

  // --- Load Sentinel Library from IndexedDB ---
  async loadSentinelLibrary(lib: SignatureLibrary): Promise<void> {
    this.screeningEngine.loadLibrary(lib);
    logToUI('SENTINEL', `Threat library v${lib.version} loaded (${lib.signatures.size} signatures)`, 'success');
  }

  // --- Threat Screening with Overlap (TASK 2) ---
  screenThreats(sequence: string, start?: number, end?: number): ThreatMatch[] {
    if (!this.screeningEngine.isLoaded()) {
      logToUI('SENTINEL', 'Threat screening attempted but no library loaded', 'warning');
      return [];
    }

    const effectiveStart = Math.max(0, (start ?? 0) - (KMER_SIZE - 1));
    const effectiveEnd = end ?? sequence.length - 1;
    const extendedSeq = sequence.slice(effectiveStart, effectiveEnd + 1);

    const matches = this.screeningEngine.scan(
      extendedSeq,
      0,
      undefined,
      effectiveStart
    );

    if (matches.length > 0) {
      logToUI('SENTINEL', `Found ${matches.length} threat signatures`, 'warning');
    }
    return matches;
  }

  // --- ORF Autopilot ---
  private scheduleORFScan() {
    if (typeof self.requestIdleCallback === 'function') {
      this.orfTaskId = self.requestIdleCallback(
        (deadline) => this.performORFScan(deadline),
        { timeout: 5000 }
      );
    } else {
      setTimeout(() => this.performORFScan(), 5000);
    }
  }

  private async performORFScan(deadline?: IdleDeadline): Promise<void> {
    const currentTaskId = this.getCurrentTaskId();
    const genomeLength = this.slabManager.getGenomeLength();
    if (genomeLength === 0) {
      this.scheduleORFScan();
      return;
    }

    if (this.orfCache && this.orfCache.genomeLength === genomeLength) {
      this.scheduleORFScan();
      return;
    }

    const start = this.orfScanOffset;
    const end = Math.min(start + ORF_SCAN_BATCH_SIZE - 1, genomeLength - 1);

    if (deadline && deadline.timeRemaining() < 5) {
      this.scheduleORFScan();
      return;
    }

    if (this.activeTaskId !== currentTaskId) return;

    const region = this.slabManager.readRegion(start, end);
    const orfs = await this.bioLogic.detectORFs(region, ORF_MIN_AA_LENGTH);

    const globalORFs = orfs.map(orf => ({
      ...orf,
      start: start + orf.start,
      end: start + orf.end,
    }));

    if (!this.orfCache) {
      this.orfCache = {
        genomeLength,
        orfs: globalORFs,
        totalORFs: globalORFs.length,
        longestORF: globalORFs.length > 0
          ? globalORFs.reduce((a, b) => (a.end - a.start > b.end - b.start ? a : b))
          : null,
        timestamp: Date.now(),
        scanProgress: end / genomeLength,
      };
    } else {
      this.orfCache.orfs.push(...globalORFs);
      this.orfCache.totalORFs = this.orfCache.orfs.length;
      this.orfCache.longestORF = this.orfCache.orfs.reduce((a, b) =>
        (a.end - a.start > b.end - b.start ? a : b), this.orfCache.orfs[0]);
      this.orfCache.scanProgress = end / genomeLength;
      this.orfCache.timestamp = Date.now();
    }

    this.orfScanOffset = end + 1;
    if (this.orfScanOffset >= genomeLength) {
      this.orfCache.genomeLength = genomeLength;
      this.orfCache.scanProgress = 1.0;
      this.orfScanOffset = 0;
    }

    if (this.initialized) {
      postMessage({ type: 'ORF_SCAN_UPDATE', payload: this.orfCache });
    }
    this.scheduleORFScan();
  }

  getORFScanResult(): ORFScanResult | null {
    return this.orfCache;
  }

  refreshORFScan(): ORFScanResult | null {
    this.orfCache = null;
    this.orfScanOffset = 0;
    this.performORFScan();
    return this.orfCache;
  }

  getORFsInRange(start: number, end: number): ORF[] {
    if (!this.orfCache) return [];
    return this.orfCache.orfs.filter(orf =>
      orf.start <= end && orf.end >= start
    );
  }

  // --- Auto‑Annotator with TASK 2 chunking ---
  async autoAnnotateGenome(): Promise<FeatureTag[]> {
    const genomeLength = this.slabManager.getGenomeLength();
    if (genomeLength === 0) return [];

    if (genomeLength > 500_000_000) {
      logToUI('ANNOTATION', 'Genome exceeds 500Mb; full auto‑annotation disabled. Use on‑demand region analysis.', 'warning');
      return [];
    }

    const features: FeatureTag[] = [];
    const chunkSize = AUTO_ANNOTATE_CHUNK_SIZE;
    const overlap = AUTO_ANNOTATE_OVERLAP;

    for (let start = 0; start < genomeLength; start += chunkSize) {
      const chunkStart = Math.max(0, start - overlap);
      const chunkEnd = Math.min(genomeLength - 1, start + chunkSize + overlap - 1);
      const region = this.slabManager.readRegion(chunkStart, chunkEnd);

      const chunkFeatures = await this.bioLogic.autoAnnotate(region, ORF_MIN_AA_LENGTH);

      for (const f of chunkFeatures) {
        const globalFeat: FeatureTag = {
          id: `auto-${Date.now()}-${Math.random().toString(36)}`,
          name: f.name,
          type: f.type,
          start: chunkStart + f.start,
          end: chunkStart + f.end,
          strand: f.strand,
          attributes: f.attributes,
        };
        features.push(globalFeat);
      }

      if (genomeLength > 100_000_000) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const uniqueFeatures: FeatureTag[] = [];
    for (const f of features) {
      const duplicate = uniqueFeatures.some(existing =>
        existing.name === f.name &&
        Math.abs(existing.start - f.start) < 100 &&
        Math.abs(existing.end - f.end) < 100
      );
      if (!duplicate) {
        uniqueFeatures.push(f);
      }
    }

    for (const feat of uniqueFeatures) {
      this.slabManager.addFeature(feat);
    }

    logToUI('ANNOTATION', `Auto‑annotated ${uniqueFeatures.length} high‑confidence genes (chunked)`, uniqueFeatures.length ? 'success' : 'info');
    return uniqueFeatures;
  }

  // --- Sentinel Scan ---
  private scheduleSentinelScan() {
    logToUI('SENTINEL', 'Background density scan initiated', 'info');
    if (typeof self.requestIdleCallback === 'function') {
      this.sentinelTaskId = self.requestIdleCallback(
        (deadline) => this.performSentinelScan(deadline),
        { timeout: 2000 }
      );
    } else {
      setTimeout(() => this.performSentinelScan(), 2000);
    }
  }

  private performSentinelScan(deadline?: IdleDeadline): void {
    const currentTaskId = this.getCurrentTaskId();
    const genomeLength = this.slabManager.getGenomeLength();
    if (genomeLength === 0) {
      this.scheduleSentinelScan();
      return;
    }

    const lengthDiff = Math.abs(genomeLength - this.sentinelLastGenomeLength) / genomeLength;
    if (this.sentinelCache && lengthDiff < 0.1) {
      this.scheduleSentinelScan();
      return;
    }

    logToUI('SENTINEL', 'Scanning GC content and motifs...', 'info');

    const bins: SentinelBin[] = [];
    const numBins = Math.ceil(genomeLength / SENTINEL_BIN_SIZE);

    for (let i = 0; i < numBins; i++) {
      if (this.activeTaskId !== currentTaskId) return;

      if (deadline && deadline.timeRemaining() < 1) {
        this.scheduleSentinelScan();
        return;
      }

      const start = i * SENTINEL_BIN_SIZE;
      const end = Math.min(start + SENTINEL_BIN_SIZE - 1, genomeLength - 1);
      const region = this.slabManager.readRegion(start, end);
      const gcPercent = this.bioLogic.computeGCContent(region);

      const motifCounts: Record<string, number> = {};
      for (const motif of SENTINEL_MOTIFS) {
        const matches = this.findMotif(motif, start, end, 0);
        motifCounts[motif] = matches.length;
      }

      bins.push({
        binIndex: i,
        start,
        end,
        gcPercent,
        motifCounts,
      });
    }

    this.sentinelCache = {
      genomeLength,
      binSize: SENTINEL_BIN_SIZE,
      bins,
      timestamp: Date.now(),
    };
    this.sentinelLastGenomeLength = genomeLength;

    if (this.initialized) {
      postMessage({ type: 'SENTINEL_SUMMARY', payload: this.sentinelCache });
      logToUI('SENTINEL', `Scan complete – ${bins.length} bins generated`, 'success');
    }
    this.scheduleSentinelScan();
  }

  getSentinelSummary(): SentinelSummary | null {
    return this.sentinelCache;
  }

  refreshSentinelScan(): SentinelSummary | null {
    this.performSentinelScan();
    return this.sentinelCache;
  }

  // --- Restriction Enzyme Finder ---
  async findRestrictionSites(
    start: number,
    end: number,
    enzymeList?: string[]
  ): Promise<RestrictionCutSite[]> {
    const region = this.slabManager.readRegion(start, end);
    const seq = Array.from(region).map(b => ['A','C','G','T','N'][b]).join('');
    const sites = await this.bioLogic.findRestrictionSites(seq, enzymeList);

    const absoluteSites = sites.map(site => ({
      ...site,
      position: start + site.position,
    }));

    const counts: Record<string, number> = {};
    absoluteSites.forEach(s => { counts[s.enzyme] = (counts[s.enzyme] || 0) + 1; });
    const summary = Object.entries(counts).map(([e, c]) => `${e}:${c}`).join(', ');
    logToUI('RESTRICTION', `Found ${absoluteSites.length} restriction sites (${summary})`, 'info');

    return absoluteSites;
  }

  // --- Off‑Target Radar ---
  scanOffTargets(
    query: string,
    maxMismatch: number = OFF_TARGET_DEFAULT_MAX_MISMATCH,
    callbackId?: string
  ): void {
    const cacheKey = `${query}_${maxMismatch}`;
    if (this.offTargetCache.has(cacheKey)) {
      const result = this.offTargetCache.get(cacheKey)!;
      postMessage({ type: 'OFF_TARGET_RESULT', id: callbackId, payload: result });
      return;
    }

    this.pendingOffTargetScan = { query, maxMismatch, callbackId };
    if (typeof self.requestIdleCallback === 'function') {
      self.requestIdleCallback((deadline) => this.performOffTargetScan(deadline), { timeout: 3000 });
    } else {
      setTimeout(() => this.performOffTargetScan(), 100);
    }
  }

  private performOffTargetScan(deadline?: IdleDeadline): void {
    const currentTaskId = this.getCurrentTaskId();
    if (!this.pendingOffTargetScan) return;
    const { query, maxMismatch, callbackId } = this.pendingOffTargetScan;
    const cacheKey = `${query}_${maxMismatch}`;

    const genomeLength = this.slabManager.getGenomeLength();
    if (genomeLength === 0) return;

    const queryUpper = query.toUpperCase();
    const patternCodes: BaseCode[] = [];
    for (let i = 0; i < queryUpper.length; i++) {
      const code = BASE[queryUpper[i]];
      if (code === undefined) return;
      patternCodes.push(code);
    }

    const matches: OffTargetHit[] = [];
    const seedPattern = patternCodes.slice(0, OFF_TARGET_SEED_LENGTH);
    const region = this.slabManager.readRegion(0, genomeLength - 1);

    const seedMatches: number[] = [];
    for (let i = 0; i <= region.length - OFF_TARGET_SEED_LENGTH; i++) {
      let match = true;
      for (let j = 0; j < OFF_TARGET_SEED_LENGTH; j++) {
        if (seedPattern[j] !== null && region[i + j] !== seedPattern[j]) {
          match = false;
          break;
        }
      }
      if (match) seedMatches.push(i);
    }

    for (const seedPos of seedMatches) {
      if (this.activeTaskId !== currentTaskId) return;

      if (deadline && deadline.timeRemaining() < 1) {
        this.pendingOffTargetScan = { query, maxMismatch, callbackId };
        this.scheduleOffTargetScan();
        return;
      }

      if (seedPos + query.length > region.length) continue;
      let mismatches = 0;
      for (let i = 0; i < query.length; i++) {
        if (region[seedPos + i] !== patternCodes[i]) {
          mismatches++;
          if (mismatches > maxMismatch) break;
        }
      }
      if (mismatches <= maxMismatch) {
        matches.push({
          position: seedPos,
          strand: '+',
          mismatches,
          sequence: this.getSequence(seedPos, seedPos + query.length - 1),
        });
      }
    }

    const rcQuery = this.reverseComplementSequence(query);
    const rcPattern = rcQuery.split('').map(ch => BASE[ch]!).filter(c => c !== undefined);
    if (rcPattern.length === query.length) {
      const rcSeed = rcPattern.slice(0, OFF_TARGET_SEED_LENGTH);
      for (let i = 0; i <= region.length - rcPattern.length; i++) {
        if (this.activeTaskId !== currentTaskId) return;

        let match = true;
        for (let j = 0; j < OFF_TARGET_SEED_LENGTH; j++) {
          if (rcSeed[j] !== null && region[i + j] !== rcSeed[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          let mismatches = 0;
          for (let j = 0; j < rcPattern.length; j++) {
            if (region[i + j] !== rcPattern[j]) {
              mismatches++;
              if (mismatches > maxMismatch) break;
            }
          }
          if (mismatches <= maxMismatch) {
            matches.push({
              position: i,
              strand: '-',
              mismatches,
              sequence: this.getSequence(i, i + rcPattern.length - 1),
            });
          }
        }
      }
    }

    const result: OffTargetResult = {
      query,
      maxMismatch,
      hits: matches,
      hitCount: matches.length,
      safetyScore: Math.max(0, 100 - matches.length * 5),
      timestamp: Date.now(),
    };

    this.offTargetCache.set(cacheKey, result);
    postMessage({ type: 'OFF_TARGET_RESULT', id: callbackId, payload: result });
    this.pendingOffTargetScan = null;
  }

  private scheduleOffTargetScan(): void {
    if (typeof self.requestIdleCallback === 'function') {
      self.requestIdleCallback((deadline) => this.performOffTargetScan(deadline), { timeout: 3000 });
    } else {
      setTimeout(() => this.performOffTargetScan(), 100);
    }
  }

  // --- Synteny Ghosting ---
  private scheduleSyntenyScan(): void {
    if (this.syntenyScanState && this.syntenyScanState.step !== 'done') {
      return;
    }
    if (typeof self.requestIdleCallback === 'function') {
      this.syntenyTaskId = self.requestIdleCallback(
        (deadline) => this.scanStructuralVariants(deadline),
        { timeout: 5000 }
      );
    } else {
      setTimeout(() => this.scanStructuralVariants(), 2000);
    }
  }

  private computeRollingHash(seq: Uint8Array, start: number, length: number): number {
    let hash = 0;
    for (let i = 0; i < length; i++) {
      hash = (hash * REPEAT_HASH_BASE + seq[start + i]) % REPEAT_HASH_MOD;
    }
    return hash;
  }

  private updateRollingHash(prevHash: number, outgoing: number, incoming: number, length: number): number {
    let hash = (prevHash - outgoing * Math.pow(REPEAT_HASH_BASE, length - 1) % REPEAT_HASH_MOD + REPEAT_HASH_MOD) % REPEAT_HASH_MOD;
    hash = (hash * REPEAT_HASH_BASE + incoming) % REPEAT_HASH_MOD;
    return hash;
  }

  public scanStructuralVariants(deadline?: IdleDeadline): void {
    const currentTaskId = this.getCurrentTaskId();
    const genomeLength = this.slabManager.getGenomeLength();

    if (genomeLength < REPEAT_MIN_LENGTH * 2) {
      this.syntenyAnchors = [];
      postMessage({ type: 'SYNTENY_ANCHORS', payload: [] });
      this.syntenyScanState = null;
      return;
    }

    if (!this.syntenyScanState) {
      const region = this.slabManager.readRegion(0, genomeLength - 1);
      const rcRegion = this.reverseComplement(region);
      const windowSize = REPEAT_MIN_LENGTH;

      const hashMap = new Map<number, number[]>();
      let hash = this.computeRollingHash(region, 0, windowSize);
      hashMap.set(hash, [0]);

      for (let i = 1; i <= region.length - windowSize; i++) {
        hash = this.updateRollingHash(hash, region[i - 1], region[i + windowSize - 1], windowSize);
        const positions = hashMap.get(hash) || [];
        positions.push(i);
        hashMap.set(hash, positions);
      }

      this.syntenyScanState = {
        step: 'direct',
        hashMap,
        rcRegion,
        keys: Array.from(hashMap.keys()),
        keyIndex: 0,
        positions: [],
        i: 0,
        j: 0,
        anchors: [],
        startTime: performance.now(),
        lastYieldTime: performance.now(),
        iterationsSinceYield: 0,
        aborted: false,
      };
    }

    const state = this.syntenyScanState;
    if (state.aborted) {
      this.syntenyScanState = null;
      return;
    }

    const now = performance.now();
    const totalElapsed = now - state.startTime;
    if (totalElapsed > MAX_SCAN_TIME_MS) {
      logToUI('GHOST', `Synteny scan aborted after ${totalElapsed.toFixed(0)}ms (>${MAX_SCAN_TIME_MS}ms)`, 'error');
      state.aborted = true;
      this.syntenyScanState = null;
      return;
    }

    const shouldYield = (): boolean => {
      if (!deadline) {
        const now = performance.now();
        if (state.lastYieldTime === undefined) state.lastYieldTime = now;
        return (now - state.lastYieldTime) > 50;
      }
      if (deadline.timeRemaining() < 2) return true;
      const timeSinceLastYield = performance.now() - state.lastYieldTime;
      return timeSinceLastYield > YIELD_INTERVAL_MS || state.iterationsSinceYield > YIELD_ITERATION_COUNT;
    };

    let workDone = false;

    while (!workDone && !shouldYield()) {
      if (state.step === 'direct') {
        workDone = this.processDirectRepeatsChunk(state);
      } else if (state.step === 'inverted') {
        workDone = this.processInvertedRepeatsChunk(state);
      } else if (state.step === 'done') {
        break;
      }
      state.iterationsSinceYield++;
    }

    if (shouldYield() && !workDone) {
      state.lastYieldTime = performance.now();
      state.iterationsSinceYield = 0;
    }

    if (workDone && state.step === 'done') {
      this.syntenyAnchors = state.anchors;
      postMessage({ type: 'SYNTENY_ANCHORS', payload: state.anchors });

      const elapsed = performance.now() - state.startTime;
      const directCount = state.anchors.filter(a => a.type === 'direct_repeat').length;
      const invertedCount = state.anchors.filter(a => a.type === 'inverted_repeat').length;
      logToUI('GHOST', `Synteny scan completed in ${elapsed.toFixed(0)}ms – ${directCount} direct, ${invertedCount} inverted repeats`, 'success');
      if (directCount + invertedCount > 0) {
        const slabHits = new Set<number>();
        state.anchors.forEach(a => {
          slabHits.add(Math.floor(a.startA / SLAB_SIZE));
          slabHits.add(Math.floor(a.startB / SLAB_SIZE));
        });
        logToUI('GHOST', `Found ${slabHits.size} slabs with structural variants`, 'info');
      }

      this.syntenyScanState = null;
    } else {
      this.scheduleSyntenyScan();
    }
  }

  private processDirectRepeatsChunk(state: SyntenyScanState): boolean {
    const { hashMap, keys } = state;

    if (state.keyIndex >= keys.length) {
      state.step = 'inverted';
      state.keyIndex = 0;
      state.i = 0;
      state.j = 0;
      return false;
    }

    const key = keys[state.keyIndex];
    const positions = hashMap.get(key)!;

    if (state.positions !== positions) {
      state.positions = positions;
      state.i = 0;
      state.j = 1;
    }

    const positionsLen = positions.length;
    while (state.i < positionsLen && state.j < positionsLen) {
      state.anchors.push({
        type: 'direct_repeat',
        startA: positions[state.i],
        endA: positions[state.i] + REPEAT_MIN_LENGTH - 1,
        startB: positions[state.j],
        endB: positions[state.j] + REPEAT_MIN_LENGTH - 1,
        identity: 1.0,
        length: REPEAT_MIN_LENGTH,
      });

      state.j++;
      if (state.j >= positionsLen) {
        state.i++;
        state.j = state.i + 1;
      }
      state.iterationsSinceYield++;

      if (state.iterationsSinceYield > YIELD_ITERATION_COUNT) {
        return false;
      }
    }

    state.keyIndex++;
    return false;
  }

  private processInvertedRepeatsChunk(state: SyntenyScanState): boolean {
    const windowSize = REPEAT_MIN_LENGTH;
    const region = this.slabManager.readRegion(0, this.slabManager.getGenomeLength() - 1);
    const rcRegion = state.rcRegion;

    while (state.i <= region.length - windowSize) {
      const i = state.i;

      while (state.j <= rcRegion.length - windowSize) {
        const j = state.j;

        const fwdHash = this.computeRollingHash(region, i, windowSize);
        const rcHash = this.computeRollingHash(rcRegion, j, windowSize);

        if (fwdHash === rcHash) {
          let match = true;
          for (let k = 0; k < windowSize; k++) {
            if (region[i + k] !== rcRegion[j + k]) {
              match = false;
              break;
            }
          }
          if (match) {
            state.anchors.push({
              type: 'inverted_repeat',
              startA: i,
              endA: i + windowSize - 1,
              startB: region.length - 1 - (j + windowSize - 1),
              endB: region.length - 1 - j,
              identity: 1.0,
              length: windowSize,
            });
          }
        }

        state.j++;
        state.iterationsSinceYield++;

        if (state.iterationsSinceYield > YIELD_ITERATION_COUNT) {
          return false;
        }
      }

      state.i++;
      state.j = 0;

      if (state.iterationsSinceYield > YIELD_ITERATION_COUNT) {
        return false;
      }
    }

    if (state.i > region.length - windowSize) {
      state.step = 'done';
      return true;
    }
    return false;
  }

  getSyntenyAnchors(): SyntenyAnchor[] {
    return this.syntenyAnchors;
  }

  refreshSyntenyScan(): SyntenyAnchor[] {
    this.syntenyScanState = null;
    this.syntenyAnchors = [];
    this.scanStructuralVariants();
    return this.syntenyAnchors;
  }

  // --- Splice & Isoform Oracle ---
  async predictSpliceSites(buffer: Uint8Array, strand: '+' | '-' = '+'): Promise<SpliceSite[]> {
    return this.bioLogic.predictSpliceSites(buffer, strand);
  }

  async predictIsoforms(buffer: Uint8Array, orf: ORF, spliceSites: SpliceSite[]): Promise<SpliceIsoform[]> {
    return this.bioLogic.predictIsoforms(buffer, orf, spliceSites);
  }

  // --- Protein Properties ---
  getProteinProperties(aaSeq: string): ProteinProperties {
    return this.bioLogic.getProteinProperties(aaSeq);
  }

  // --- Thermodynamic Sentinel ---
  calculateMeltingTemp(sequence: string): number {
    const tm = this.bioLogic.calculateMeltingTemp(sequence);
    logToUI('THERMO', `Selection Tm is ${tm.toFixed(1)}°C (50mM Na⁺, 1.5mM Mg²⁺)`, 'info');
    return tm;
  }

  // --- Codon Adaptation Index ---
  calculateCAI(sequence: string, organism: Organism): number {
    const cai = this.bioLogic.calculateCAI(sequence, organism);
    logToUI('PRECISION', `CAI Score: ${cai.toFixed(4)} (${organism})`, cai >= 0.7 ? 'success' : 'warning');
    return cai;
  }

  // --- Advanced In-Silico PCR ---
  simulatePCR_Advanced(
    forwardPrimer: string,
    reversePrimer: string,
    templateStart: number,
    templateEnd: number,
    options?: {
      maxMismatches?: number;
      minProduct?: number;
      maxProduct?: number;
      Na?: number;
      Mg?: number;
      oligoConc?: number;
    }
  ): PCRProduct[] {
    const maxMismatches = options?.maxMismatches ?? 2;
    const minProduct = options?.minProduct ?? 50;
    const maxProduct = options?.maxProduct ?? 5000;
    const Na = options?.Na ?? 0.05;
    const Mg = options?.Mg ?? 1.5;
    const oligoConc = options?.oligoConc ?? 0.5e-6;

    const dimerRisk = this.checkPrimerDimer3Prime(forwardPrimer, reversePrimer);
    if (dimerRisk) {
      logToUI('PCR', `❌ HIGH RISK: Primer-Dimer (3' complementarity)`, 'error');
    }

    const fwdMatches = this.findMotif(forwardPrimer, templateStart, templateEnd, maxMismatches);
    const revCompPrimer = this.reverseComplementSequence(reversePrimer);
    const revMatches = this.findMotif(revCompPrimer, templateStart, templateEnd, maxMismatches)
      .map(m => ({ start: m.start, end: m.end }));

    const products: PCRProduct[] = [];

    const primerDimerTm = this.detectPrimerDimer(forwardPrimer, reversePrimer, Na, Mg, oligoConc);
    if (primerDimerTm > 50) {
      logToUI('PCR', `Primer-dimer Tm: ${primerDimerTm.toFixed(1)}°C`, 'warning');
    }

    for (const fwd of fwdMatches) {
      for (const rev of revMatches) {
        if (fwd.start < rev.end) {
          const productLength = rev.end - fwd.start + 1;
          if (productLength >= minProduct && productLength <= maxProduct) {
            const fwdTargetSeq = this.getSequence(fwd.start, fwd.start + forwardPrimer.length - 1);
            const revTargetSeq = this.getSequence(rev.start, rev.start + reversePrimer.length - 1);
            const revTargetRC = this.reverseComplementSequence(revTargetSeq);

            const fwdAffinity = this.bioLogic.computePrimerAffinity(forwardPrimer, fwdTargetSeq, Na, Mg);
            const revAffinity = this.bioLogic.computePrimerAffinity(reversePrimer, revTargetRC, Na, Mg);

            products.push({
              forwardStart: fwd.start,
              forwardEnd: fwd.end,
              reverseStart: rev.start,
              reverseEnd: rev.end,
              productLength,
              forwardTm: fwdAffinity.tm,
              reverseTm: revAffinity.tm,
              forwardMismatches: fwdAffinity.mismatchCount,
              reverseMismatches: revAffinity.mismatchCount,
            });
          }
        }
      }
    }

    if (products.length > 0) {
      const best = products[0];
      logToUI('PCR', `Predicted product: ${best.productLength}bp, Tm_fwd=${best.forwardTm}°C, Tm_rev=${best.reverseTm}°C`, 'success');
    } else {
      logToUI('PCR', 'No PCR products found within range', 'warning');
    }

    return products.sort((a, b) => a.productLength - b.productLength);
  }

  // --- Primer-Dimer Detection ---
  detectPrimerDimer(
    primer1: string,
    primer2: string,
    Na: number = 0.05,
    Mg: number = 1.5,
    oligoConc: number = 0.5e-6
  ): number {
    const revComp2 = this.reverseComplementSequence(primer2);
    let maxTm = 0;
    for (let offset = -5; offset <= 5; offset++) {
      const aligned = this.alignPrimers(primer1, revComp2, offset);
      if (aligned.length >= 4) {
        const tm = this.bioLogic.nearestNeighborTm(aligned, Na, Mg, oligoConc, 0.2, false).Tm;
        if (tm > maxTm) maxTm = tm;
      }
    }
    return maxTm;
  }

  private checkPrimerDimer3Prime(forward: string, reverse: string): boolean {
    const fwd3 = forward.slice(-5).toUpperCase();
    const rev3 = reverse.slice(-5).toUpperCase();
    const rev3RC = this.reverseComplementSequence(rev3);
    const fwdSelf = this.checkSelfComplementarity(fwd3);
    const revSelf = this.checkSelfComplementarity(rev3);
    return (fwd3 === rev3RC) || fwdSelf || revSelf;
  }

  private checkSelfComplementarity(seq: string): boolean {
    const rc = this.reverseComplementSequence(seq);
    return seq === rc;
  }

  private alignPrimers(seq1: string, seq2: string, offset: number): string {
    let start1 = 0, start2 = 0;
    if (offset > 0) {
      start1 = offset;
    } else {
      start2 = -offset;
    }
    const len = Math.min(seq1.length - start1, seq2.length - start2);
    if (len < 4) return '';
    let overlap = '';
    for (let i = 0; i < len; i++) {
      if (seq1[start1 + i] === seq2[start2 + i]) {
        overlap += seq1[start1 + i];
      } else {
        overlap += 'N';
      }
    }
    return overlap;
  }

  // --- Hairpin Sentinel ---
  async detectHairpins(sequence: string): Promise<HairpinPrediction[]> {
    const hairpins = await this.bioLogic.detectHairpins(sequence);
    if (hairpins.length > 0) {
      const critical = hairpins.filter(h => h.critical);
      logToUI('STRUCTURE', `Detected ${hairpins.length} hairpins, ${critical.length} critical (ΔG < -5 kcal/mol)`, critical.length ? 'error' : 'info');
      critical.forEach(h => {
        logToUI('STRUCTURE', `Critical hairpin at ${h.position}: ΔG = ${h.deltaG} kcal/mol`, 'error');
      });
    }
    return hairpins;
  }

  // --- Assembly Junction Predictor ---
  predictAssemblyJunction(
    leftStart: number,
    leftEnd: number,
    rightStart: number,
    rightEnd: number,
    method: 'Gibson' | 'GoldenGate',
    options?: Record<string, unknown>
  ): AssemblyPrediction {
    const leftRegion = this.slabManager.readRegion(leftStart, leftEnd);
    const rightRegion = this.slabManager.readRegion(rightStart, rightEnd);
    const result = this.bioLogic.predictAssemblyJunction(leftRegion, rightRegion, method, options);

    if (method === 'Gibson') {
      logToUI('ASSEMBLY', `Gibson: ${result.message}`, result.valid ? 'success' : 'warning');
    } else {
      logToUI('ASSEMBLY', `Golden Gate: ${result.message}`, result.valid ? 'success' : 'warning');
    }
    return result;
  }

  // --- Streaming ---

  private processLineBytes(lineBytes: Uint8Array): void {
    const decoder = new TextDecoder('ascii');
    const line = decoder.decode(lineBytes);
    if (line.startsWith('>')) return;
    this.processSequenceLine(line);
  }

  private processSequenceLine(line: string): void {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i].toUpperCase();
      if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'N') {
        const baseCode = BASE[ch];
        if (baseCode !== undefined) {
          this.stagingBuffer[this.stagingIndex++] = baseCode;
          if (this.stagingIndex >= this.stagingBuffer.length) {
            this.slabManager.appendBytes(this.stagingBuffer.slice(0, this.stagingIndex));
            this.stagingIndex = 0;
          }
        }
      }
    }
  }

  private ensureStreamBufferCapacity(needed: number): void {
    if (this.streamByteBuffer.length - this.streamByteLength >= needed) return;
    let newSize = this.streamByteBuffer.length;
    while (newSize - this.streamByteLength < needed) {
      newSize *= 2;
    }
    const newBuffer = new Uint8Array(newSize);
    newBuffer.set(this.streamByteBuffer.subarray(0, this.streamByteLength));
    this.streamByteBuffer = newBuffer;
  }

  handleStreamChunk(payload: { fileId: string; chunkBuffer: ArrayBuffer; byteOffset: number }): { processed: number } | void {
    if (this.streamAborted) {
      return { processed: 0 };
    }

    const totalAllocated = this.slabManager.getTotalAllocatedBytes();
    if (totalAllocated > HARD_MEMORY_LIMIT) {
      this.streamAborted = true;
      this.streamByteLength = 0;
      postMessage({
        type: 'ERROR',
        payload: { message: 'OUT_OF_MEMORY_PROTECTION: Total slab allocation exceeded 512MB' }
      });
      logToUI('WORKER', 'Stream aborted: memory limit exceeded', 'error');
      return { processed: 0 };
    }

    const bytes = new Uint8Array(payload.chunkBuffer);
    this.ensureStreamBufferCapacity(bytes.length);
    this.streamByteBuffer.set(bytes, this.streamByteLength);
    this.streamByteLength += bytes.length;

    let processedBytes = 0;
    let lineStart = 0;
    for (let i = 0; i < this.streamByteLength; i++) {
      if (this.streamByteBuffer[i] === 10) {
        const lineBytes = this.streamByteBuffer.subarray(lineStart, i);
        if (lineBytes.length > MAX_BUFFER_SIZE) {
          this.streamAborted = true;
          this.streamByteLength = 0;
          postMessage({
            type: 'ERROR',
            payload: { message: 'MALFORMED_FASTA_LINE_TOO_LONG' }
          });
          logToUI('WORKER', 'Stream aborted: line exceeds 50MB without newline', 'error');
          return { processed: 0 };
        }
        this.processLineBytes(lineBytes);
        lineStart = i + 1;
        processedBytes = i + 1;
      }
    }

    if (processedBytes > 0) {
      const remaining = this.streamByteLength - processedBytes;
      if (remaining > 0) {
        this.streamByteBuffer.copyWithin(0, processedBytes, this.streamByteLength);
      }
      this.streamByteLength = remaining;
    }

    if (lineStart === 0 && this.streamByteLength > MAX_BUFFER_SIZE) {
      this.streamAborted = true;
      this.streamByteLength = 0;
      postMessage({
        type: 'ERROR',
        payload: { message: 'MALFORMED_FASTA_LINE_TOO_LONG' }
      });
      logToUI('WORKER', 'Stream aborted: line exceeds 50MB without newline', 'error');
      return { processed: 0 };
    }

    const capacity = this.streamByteBuffer.length;
    if (this.streamByteLength > 0 && this.streamByteLength < capacity * 0.25) {
      let newSize = 64;
      while (newSize < this.streamByteLength) newSize *= 2;
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.streamByteBuffer.subarray(0, this.streamByteLength));
      this.streamByteBuffer = newBuffer;
      logToUI('MEMORY', `Stream buffer shrunk from ${capacity} to ${newSize} bytes`, 'info', true);
    }

    return { processed: bytes.byteLength };
  }

  finalizeStream(): void {
    if (this.streamAborted) {
      logToUI('WORKER', 'Finalize called on aborted stream – ignoring', 'warning');
      return;
    }
    if (this.streamByteLength > 0) {
      const lastLine = this.streamByteBuffer.subarray(0, this.streamByteLength);
      const decoder = new TextDecoder('ascii');
      const line = decoder.decode(lastLine);
      if (!line.startsWith('>')) {
        this.processSequenceLine(line);
      }
      this.streamByteLength = 0;
    }

    if (this.stagingIndex > 0) {
      this.slabManager.appendBytes(this.stagingBuffer.slice(0, this.stagingIndex));
      this.stagingIndex = 0;
    }

    logToUI('WORKER', 'Stream finalized, staging buffer flushed', 'info');
  }

  // --- Load Slice ---
  async loadSlice(payload: { start: number; end: number }, requestId: number): Promise<SliceResponse | null> {
    if (requestId !== this.latestViewportRequestId) {
      return null;
    }

    const safeEnd = Math.min(payload.end, payload.start + 200_000);
    const data = this.slabManager.readRegion(payload.start, safeEnd);

    if (requestId !== this.latestViewportRequestId) {
      return null;
    }

    const sequenceStr = Array.from(data).map(b => ['A', 'C', 'G', 'T', 'N'][b]).join('');
    const translations = this.bioLogic.sixFrameTranslations(data);
    const gcPercent = this.bioLogic.computeGCContent(data);
    const features = this.slabManager.getFeaturesInRange(payload.start, safeEnd);
    const orfs = this.getORFsInRange(payload.start, safeEnd);
    const spliceSites = await this.bioLogic.predictSpliceSites(data);
    let proteinProperties: ProteinProperties | undefined;
    let isoforms: SpliceIsoform[] | undefined;

    if (orfs.length > 0) {
      const longestORF = orfs.reduce((a, b) => (a.end - a.start > b.end - b.start ? a : b));
      const aaSeq = longestORF.aaSequence.slice(0, -1);
      proteinProperties = this.bioLogic.getProteinProperties(aaSeq);
      isoforms = await this.bioLogic.predictIsoforms(data, longestORF, spliceSites);
    }

    if (requestId !== this.latestViewportRequestId) {
      return null;
    }

    return {
      start: payload.start,
      end: safeEnd,
      buffer: data.buffer as ArrayBuffer,
      sequence: sequenceStr,
      translations,
      gcPercent,
      features,
      orfs,
      spliceSites,
      isoforms,
      proteinProperties,
    };
  }

  // --- Surgical Mutation ---
  async performSurgicalMutation(
    payload: {
      slabIndex: number;
      offset: number;
      newBaseCode: BaseCode;
      txId?: string;
      meta?: { user: string; reason: string; branch?: string; isCheckpoint?: boolean };
    },
    _transferables: Transferable[]
  ): Promise<MutationResult> {
    const globalOffset = payload.slabIndex * SLAB_SIZE + payload.offset;
    const oldBase = this.slabManager.readBase(globalOffset);
    if (oldBase === payload.newBaseCode) {
      return {
        slabIndex: payload.slabIndex,
        offset: globalOffset,
        oldBaseCode: oldBase,
        newBaseCode: payload.newBaseCode,
        impact: { classification: 'synonymous' },
        txId: payload.txId || '',
      };
    }

    const txId = payload.txId || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const mutation: MutationRecord = {
      txId,
      slabIndex: payload.slabIndex,
      offset: globalOffset,
      oldBase,
      newBase: payload.newBaseCode,
      timestamp: Date.now(),
      author: payload.meta?.user,
      commitMessage: payload.meta?.reason,
    };

    this.slabManager.writeBase(globalOffset, payload.newBaseCode);
    this.editedSlabs.add(payload.slabIndex);

    const start = Math.max(0, globalOffset - TM_WINDOW);
    const end = Math.min(this.slabManager.getGenomeLength() - 1, globalOffset + TM_WINDOW);
    const region = this.slabManager.readRegion(start, end);

    const impact = this.computeLocalImpact(region, globalOffset - start, oldBase, payload.newBaseCode);

    const baseMap = ['A', 'C', 'G', 'T', 'N'];
    logToUI(
      'CHRONOS',
      `Mutation ${txId.slice(-6)}: ${baseMap[oldBase]}→${baseMap[payload.newBaseCode]} at position ${globalOffset} | ${payload.meta?.reason || 'no reason'}`,
      'success'
    );

    const newCommit = this.chronos.commit(
      [mutation],
      payload.meta?.user,
      payload.meta?.reason,
      payload.meta?.branch,
      payload.meta?.isCheckpoint || false
    );
    const allBranches = this.chronos.getBranches();
    postMessage({
      type: 'COMMIT_SYNC',
      payload: {
        newCommits: [this.chronos.getCommit(txId)!],
        branches: allBranches,
      },
    });

    this.orfCache = null;
    this.orfScanOffset = 0;
    this.offTargetCache.clear();

    return {
      slabIndex: payload.slabIndex,
      offset: globalOffset,
      oldBaseCode: oldBase,
      newBaseCode: payload.newBaseCode,
      impact,
      txId,
    };
  }

  private computeLocalImpact(
    region: Uint8Array,
    localOffset: number,
    oldBase: BaseCode,
    newBase: BaseCode
  ): MutationImpact {
    const original = new Uint8Array(region);
    const mutated = new Uint8Array(region);
    mutated[localOffset] = newBase;
    original[localOffset] = oldBase;
    return this.bioLogic.classifyMutation(original, mutated, localOffset);
  }

  // --- Undo/Redo ---
  undo(): MutationRecord[] | null {
    const reverseOps = this.chronos.undo();
    if (!reverseOps) return null;
    for (const op of reverseOps) {
      this.slabManager.writeBase(op.offset, op.newBase);
      this.editedSlabs.add(Math.floor(op.offset / SLAB_SIZE));
    }
    this.persistence.saveTransaction(this.chronos.getAllCommits());
    this.orfCache = null;
    this.offTargetCache.clear();
    logToUI('CHRONOS', `Undo: reverted ${reverseOps.length} mutation(s)`, 'info');
    const allBranches = this.chronos.getBranches();
    postMessage({
      type: 'COMMIT_SYNC',
      payload: { newCommits: [], branches: allBranches },
    });
    return reverseOps;
  }

  redo(): MutationRecord[] | null {
    const forwardOps = this.chronos.redo();
    if (!forwardOps) return null;
    for (const op of forwardOps) {
      this.slabManager.writeBase(op.offset, op.newBase);
      this.editedSlabs.add(Math.floor(op.offset / SLAB_SIZE));
    }
    this.persistence.saveTransaction(this.chronos.getAllCommits());
    this.orfCache = null;
    this.offTargetCache.clear();
    logToUI('CHRONOS', `Redo: reapplied ${forwardOps.length} mutation(s)`, 'info');
    const allBranches = this.chronos.getBranches();
    postMessage({
      type: 'COMMIT_SYNC',
      payload: { newCommits: [], branches: allBranches },
    });
    return forwardOps;
  }

  // --- Chronos Branching API ---
  createBranch(name: string, fromCommitId?: string): boolean {
    const success = this.chronos.createBranch(name, fromCommitId);
    if (success) {
      logToUI('CHRONOS', `Branch created: ${name}`, 'success');
      const allBranches = this.chronos.getBranches();
      postMessage({
        type: 'COMMIT_SYNC',
        payload: { newCommits: [], branches: allBranches },
      });
    }
    return success;
  }

  checkout(branchName: string): boolean {
    const success = this.chronos.checkout(branchName);
    if (success) {
      logToUI('CHRONOS', `Switched to branch: ${branchName}`, 'info');
    }
    return success;
  }

  merge(sourceBranch: string, targetBranch?: string, message?: string): string | null {
    const mergeCommitId = this.chronos.merge(sourceBranch, targetBranch, message);
    if (mergeCommitId) {
      logToUI('CHRONOS', `Merged ${sourceBranch} into ${targetBranch || this.chronos.getCurrentBranch()}`, 'success');
      const newCommit = this.chronos.getCommit(mergeCommitId)!;
      const allBranches = this.chronos.getBranches();
      postMessage({
        type: 'COMMIT_SYNC',
        payload: { newCommits: [newCommit], branches: allBranches },
      });
    }
    return mergeCommitId;
  }

  getBranches(): Branch[] {
    return this.chronos.getBranches();
  }

  getCommits(): Commit[] {
    return this.chronos.getAllCommits();
  }

  // --- History ---
  getHistory(): TransactionSummary[] {
    return this.chronos.getAllCommits().map((c: Commit) => ({
      txId: c.txId,
      parentTxId: c.parentTxIds[0] || null,
      timestamp: c.timestamp,
      author: c.author,
      commitMessage: c.commitMessage,
      mutationCount: c.mutations.length,
    }));
  }

  exportPatch(txId: string) {
    return this.chronos.exportPatch(txId);
  }

  async loadHistory(): Promise<void> {
    const commits = await this.persistence.loadAllTransactions();
    for (const commit of commits) {
      this.chronos['commits'].set(commit.txId, commit);
    }
    logToUI('CHRONOS', `Loaded ${commits.length} commits from IndexedDB`, 'info');
  }

  // --- Genome Metadata ---
  getGenomeMetadata(): { genomeLength: number; slabMetas: SlabMeta[] } {
    return {
      genomeLength: this.slabManager.getGenomeLength(),
      slabMetas: this.slabManager.getAllSlabMetas(),
    };
  }

  // --- Feature Map ---
  addFeature(feature: Omit<FeatureTag, 'id'>) {
    const feat = this.slabManager.addFeature(feature);
    logToUI('MEMORY', `Feature added: ${feat.name} (${feat.start}-${feat.end})`, 'info');
    return feat;
  }

  getFeaturesAt(offset: number) {
    return this.slabManager.getFeaturesAt(offset);
  }

  // --- Motif Radar ---
  findMotif(pattern: string, start?: number, end?: number, maxMismatches = 0): { start: number; end: number }[] {
    const genomeStart = start ?? 0;
    const genomeEnd = end ?? this.slabManager.getGenomeLength() - 1;
    if (genomeStart > genomeEnd) return [];

    const patternCodes: (BaseCode | null)[] = [];
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i].toUpperCase();
      if (ch === 'N') patternCodes.push(null);
      else {
        const code = BASE[ch];
        if (code === undefined) return [];
        patternCodes.push(code);
      }
    }

    const matches: { start: number; end: number }[] = [];
    const patternLen = patternCodes.length;
    const region = this.slabManager.readRegion(genomeStart, genomeEnd);

    for (let i = 0; i <= region.length - patternLen; i++) {
      let mismatches = 0;
      for (let j = 0; j < patternLen; j++) {
        const patCode = patternCodes[j];
        if (patCode !== null && region[i + j] !== patCode) {
          mismatches++;
          if (mismatches > maxMismatches) break;
        }
      }
      if (mismatches <= maxMismatches) {
        matches.push({
          start: genomeStart + i,
          end: genomeStart + i + patternLen - 1,
        });
      }
    }
    return matches;
  }

  // --- PCR Simulation (Basic) ---
  simulatePCR(
    forwardPrimer: string,
    reversePrimer: string,
    maxMismatches = 2,
    minProduct = 50,
    maxProduct = 5000
  ): PCRProduct[] {
    const dimerRisk = this.checkPrimerDimer3Prime(forwardPrimer, reversePrimer);
    if (dimerRisk) {
      logToUI('PCR', `❌ HIGH RISK: Primer-Dimer (3' complementarity)`, 'error');
    }

    const fwdMatches = this.findMotif(forwardPrimer, undefined, undefined, maxMismatches);
    const revCompPrimer = this.reverseComplementSequence(reversePrimer);
    const revMatches = this.findMotif(revCompPrimer, undefined, undefined, maxMismatches)
      .map(m => ({ start: m.start, end: m.end }));

    const products: PCRProduct[] = [];

    for (const fwd of fwdMatches) {
      for (const rev of revMatches) {
        if (fwd.start < rev.end) {
          const productLength = rev.end - fwd.start + 1;
          if (productLength >= minProduct && productLength <= maxProduct) {
            const fwdTargetSeq = this.getSequence(fwd.start, fwd.start + forwardPrimer.length - 1);
            const revTargetSeq = this.getSequence(rev.start, rev.start + reversePrimer.length - 1);
            const revTargetRC = this.reverseComplementSequence(revTargetSeq);

            const fwdAffinity = this.bioLogic.computePrimerAffinity(forwardPrimer, fwdTargetSeq);
            const revAffinity = this.bioLogic.computePrimerAffinity(reversePrimer, revTargetRC);

            products.push({
              forwardStart: fwd.start,
              forwardEnd: fwd.end,
              reverseStart: rev.start,
              reverseEnd: rev.end,
              productLength,
              forwardTm: fwdAffinity.tm,
              reverseTm: revAffinity.tm,
              forwardMismatches: fwdAffinity.mismatchCount,
              reverseMismatches: revAffinity.mismatchCount,
            });
          }
        }
      }
    }
    return products.sort((a, b) => a.productLength - b.productLength);
  }

  private getSequence(start: number, end: number): string {
    const data = this.slabManager.readRegion(start, end);
    return Array.from(data).map(b => ['A', 'C', 'G', 'T', 'N'][b]).join('');
  }

  private reverseComplementSequence(seq: string): string {
    return seq
      .split('')
      .reverse()
      .map(ch => {
        if (ch === 'A') return 'T';
        if (ch === 'T') return 'A';
        if (ch === 'C') return 'G';
        if (ch === 'G') return 'C';
        return 'N';
      })
      .join('');
  }

  private reverseComplement(buffer: Uint8Array): Uint8Array {
    const rc = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      rc[i] = COMPLEMENT[buffer[buffer.length - 1 - i] as BaseCode];
    }
    return rc;
  }

  // --- Restriction Mapper (Legacy) ---
  restrictionMapper(enzymes?: string[]): RestrictionSite[] {
    const sites: RestrictionSite[] = [];
    const enzymeList = enzymes ?? Object.keys(RESTRICTION_ENZYMES);

    for (const name of enzymeList) {
      const info = RESTRICTION_ENZYMES[name];
      if (!info) continue;
      const matches = this.findMotif(info.site, undefined, undefined, 0);
      for (const m of matches) {
        sites.push({
          enzyme: name,
          recognitionSite: info.site,
          position: m.start + info.cut,
          strand: '+',
        });
      }
    }
    return sites;
  }

  // --- Radar Heatmap ---
  generateRadarData(numBins = 500): RadarBin[] {
    const genomeLength = this.slabManager.getGenomeLength();
    if (genomeLength === 0) return [];
    const binSize = Math.ceil(genomeLength / numBins);
    const bins: RadarBin[] = [];

    for (let i = 0; i < numBins; i++) {
      const start = i * binSize;
      const end = Math.min(start + binSize - 1, genomeLength - 1);
      if (start >= genomeLength) break;

      const region = this.slabManager.readRegion(start, end);
      const gcPercent = this.bioLogic.computeGCContent(region);

      let startCodonCount = 0;
      const seq = Array.from(region).map(b => ['A', 'C', 'G', 'T', 'N'][b]).join('');
      for (let j = 0; j + 2 < seq.length; j += 3) {
        if (seq[j] === 'A' && seq[j + 1] === 'T' && seq[j + 2] === 'G') {
          startCodonCount++;
        }
      }
      const orfDensity = (startCodonCount / region.length) * 1000;

      bins.push({
        binIndex: i,
        start,
        end,
        gcPercent,
        orfDensity,
      });
    }
    return bins;
  }

  // --- Export Mutant FASTA ---
  exportMutantFasta(): { filename: string; content: string } {
    if (this.editedSlabs.size === 0) {
      return {
        filename: 'mutant_sequence_no_edits.fasta',
        content: '>No edits have been made to the genome.',
      };
    }

    const sortedSlabs = Array.from(this.editedSlabs).sort((a, b) => a - b);
    let fastaContent = '';

    for (const slabIdx of sortedSlabs) {
      const slab = this.slabManager.getSlab(slabIdx);
      if (!slab) continue;
      const meta = this.slabManager.getSlabMeta(slabIdx);
      const slabLength = meta?.length ?? SLAB_SIZE;
      const sequence = Array.from(slab.subarray(0, slabLength))
        .map(b => ['A', 'C', 'G', 'T', 'N'][b])
        .join('');

      const start = slabIdx * SLAB_SIZE;
      const end = start + slabLength - 1;

      const sanitizeFastaHeaderField = (value: string): string =>
        value.replace(/[;|&]/g, '_');

      const safeSlabIdx = sanitizeFastaHeaderField(String(slabIdx));
      const safeStart   = sanitizeFastaHeaderField(String(start));
      const safeEnd     = sanitizeFastaHeaderField(String(end));

      fastaContent += `>edited_slab_${safeSlabIdx} | coordinates: ${safeStart}-${safeEnd}\n`;
      for (let i = 0; i < sequence.length; i += 80) {
        fastaContent += sequence.slice(i, i + 80) + '\n';
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `arkhe_mutant_edited_slabs_${timestamp}.fasta`;
    return { filename, content: fastaContent };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 1 FIX — TASK 4: Worker Bounds-Check Middleware
// ─────────────────────────────────────────────────────────────────────────────

function assertOffsetInBounds(value: number, genomeLength: number, label: string): void {
  if (genomeLength === 0) return;
  if (!Number.isFinite(value)) {
    throw new RangeError(`BOUNDS_VIOLATION: ${label}=${value} is not a finite number`);
  }
  if (value < 0 || value >= genomeLength) {
    throw new RangeError(
      `BOUNDS_VIOLATION: ${label}=${value} is outside genome range [0, ${genomeLength - 1}]`
    );
  }
}

function boundsCheckMiddleware(
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  genomeLength: number
): void {
  if (!payload || genomeLength === 0) return;

  const OFFSET_BEARING_TYPES = new Set([
    'LOAD_SLICE',
    'PERFORM_SURGICAL_MUTATION',
    'DIFF_REQUEST',
    'GET_FEATURES_AT',
    'FIND_MOTIF',
    'PREDICT_SPLICE_SITES',
    'PREDICT_ISOFORMS',
    'FIND_RESTRICTION_SITES',
    'SIMULATE_PCR_ADVANCED',
    'RUN_ISOFORM_SCAN',
    'VERIFY_SLAB_STATE',
  ]);

  if (!OFFSET_BEARING_TYPES.has(type)) return;

  if (typeof payload.offset === 'number')
    assertOffsetInBounds(payload.offset, genomeLength, 'offset');
  if (typeof payload.startOffset === 'number')
    assertOffsetInBounds(payload.startOffset, genomeLength, 'startOffset');
  if (typeof payload.templateStart === 'number')
    assertOffsetInBounds(payload.templateStart, genomeLength, 'templateStart');

  for (const field of ['start', 'end', 'endOffset', 'templateEnd'] as const) {
    const val = payload[field as keyof typeof payload];
    if (typeof val === 'number' && Number.isFinite(val) && val < 0) {
      throw new RangeError(`BOUNDS_VIOLATION: ${field}=${val} is negative`);
    }
  }
}

// ---------- Worker Message Handling ----------
const engine = new ArkheEngine();

self.onmessage = async (e: MessageEvent) => {
  const { type, id, payload } = e.data;

  boundsCheckMiddleware(type, payload, engine.slabManager.getGenomeLength());

  try {
    switch (type) {
      case 'RESET_ENGINE': {
        engine.resetEngine(payload?.expectedFileSize);
        postMessage({ type: 'RESET_ENGINE_OK', id });
        break;
      }
      case 'INIT': {
        const result = await engine.init(payload);
        postMessage({ type: 'INIT_OK', id, payload: result });
        break;
      }
      case 'LOAD_SENTINEL_LIBRARY': {
        await engine.loadSentinelLibrary(payload);
        postMessage({ type: 'LOAD_SENTINEL_LIBRARY_OK', id });
        break;
      }
      case 'SCREEN_THREATS': {
        const { sequence, start, end } = payload;
        const matches = engine.screenThreats(sequence, start, end);
        postMessage({ type: 'SCREEN_THREATS_RESULT', id, payload: matches });
        break;
      }
      case 'STREAM_CHUNK': {
        const result = engine.handleStreamChunk(payload);
        if (result) {
          postMessage({ type: 'STREAM_ACK', id, payload: result });
        }
        break;
      }
      case 'STREAM_END': {
        engine.finalizeStream();
        postMessage({ type: 'STREAM_END_ACK', id });
        break;
      }

      // ────────────────────────────────────────────────────────────────────────
      // SS-01 — Scientific Streaming: CHUNK_RECEIVED
      //
      // Worker-side handler for the SlabStreamingPipeline protocol.
      //
      // PIPELINE:
      //   1. Snapshot genomeLength BEFORE parsing — needed to determine the
      //      exact byte range that this chunk adds to the slabs.
      //
      //   2. Delegate to handleStreamChunk() — the battle-tested FASTA parser
      //      that handles: header stripping, base-code conversion, slab
      //      allocation, OOM guard (HARD_MEMORY_LIMIT), and buffer management.
      //      The transferred ArrayBuffer arrives as payload.buffer; we wrap it
      //      in the expected { fileId, chunkBuffer, byteOffset } shape.
      //
      //   3. Per-chunk Sentinel scan — read [beforeLength, afterLength) back
      //      from the slabs (already base-coded), convert to a string, and
      //      call screenThreats(). Biosecurity scanning begins on the very
      //      first megabyte while the genome tail is still downloading.
      //      Capped at SS_SENTINEL_SCAN_MAX_BASES to stay inside a single
      //      16 ms frame budget.
      //
      //   4. isFinal path — when the last chunk arrives, call finalizeStream()
      //      to flush the FASTA line-accumulation buffer and the staging
      //      base-code buffer into the slabs. Then post STREAM_END_ACK so the
      //      main thread can proceed with RESTORE_HISTORY.
      //
      //   5. CHUNK_LOADED progress broadcast — main thread progress bars listen
      //      for this message to update their UI.
      //
      //   6. CHUNK_ACK (backpressure release) — MUST be the LAST message sent.
      //      Resolving the main thread's ACK promise after all work (including
      //      the Sentinel scan) is complete ensures the backpressure reflects
      //      the worker's true throughput, not just its message-queue depth.
      //
      // ERROR PATH:
      //   If handleStreamChunk() returns void (stream aborted due to OOM or
      //   malformed FASTA), we post CHUNK_ERR to propagate the failure to the
      //   SlabStreamingPipeline's rejectChunk() handler on the main thread,
      //   which throws inside streamFromUrl() for the caller to handle.
      //   We still send CHUNK_ACK(ok=false) to release the in-flight semaphore
      //   and prevent the pipeline from hanging indefinitely.
      // ────────────────────────────────────────────────────────────────────────
      case 'CHUNK_RECEIVED': {
        const {
          chunkId,
          buffer,
          isFinal,
          totalBytes,
        } = payload as {
          chunkId: number;
          buffer: ArrayBuffer;
          isFinal: boolean;
          totalBytes?: number;
        };

        // ── 1. Snapshot genome length before parsing ───────────────────────
        const beforeLength = engine.slabManager.getGenomeLength();

        // ── 2. Parse FASTA chunk → base codes → slabs ─────────────────────
        //    Re-use the existing handleStreamChunk() pipeline so Scientific
        //    Streaming inherits all guards (OOM, malformed FASTA, buffer
        //    shrink) without duplicating logic.
        if (buffer.byteLength > 0) {
          const parseResult = engine.handleStreamChunk({
            fileId: 'scientific-stream',
            chunkBuffer: buffer,
            byteOffset: beforeLength,
          });

          if (!parseResult) {
            // handleStreamChunk() returned void → stream was aborted internally.
            // The ERROR message was already posted by handleStreamChunk().
            logToUI(
              'WORKER',
              `CHUNK_RECEIVED #${chunkId}: stream aborted during parse (OOM or malformed FASTA)`,
              'error',
            );
            postMessage({
              type: 'CHUNK_ERR',
              id,
              payload: { chunkId, reason: 'stream_parse_aborted' },
            });
            // Release backpressure even on error so the pipeline doesn't hang.
            postMessage({ type: 'CHUNK_ACK', id, payload: { chunkId, ok: false } });
            break;
          }
        }

        const afterLength = engine.slabManager.getGenomeLength();
        const newBases    = afterLength - beforeLength;

        // ── 3. Per-chunk Sentinel biosecurity scan ────────────────────────
        //    Convert newly committed base codes back to a character string
        //    and scan for threat signatures. This runs BEFORE the ACK so
        //    backpressure throttles the download to match the scan throughput.
        if (newBases > 0 && engine.screeningEngine.isLoaded()) {
          try {
            // Cap scan range to SS_SENTINEL_SCAN_MAX_BASES (2 MB) to stay
            // within a single animation frame budget (≈ 16 ms).
            const scanStart = beforeLength;
            const scanEnd   = Math.min(
              afterLength - 1,
              beforeLength + SS_SENTINEL_SCAN_MAX_BASES - 1,
            );

            const newRegion = engine.slabManager.readRegion(scanStart, scanEnd);

            // Inline base-code → char conversion avoids allocating a full
            // intermediate string array — Array.from().map() allocates O(n).
            let seqStr = '';
            for (let i = 0; i < newRegion.length; i++) {
              seqStr += BASE_CODE_TO_CHAR[newRegion[i] as 0 | 1 | 2 | 3 | 4] ?? 'N';
            }

            const threats = engine.screenThreats(seqStr, scanStart, scanEnd);

            if (threats.length > 0) {
              logToUI(
                'SENTINEL',
                `Chunk #${chunkId}: ${threats.length} threat(s) at [${scanStart.toLocaleString()}–${scanEnd.toLocaleString()}]`,
                'warning',
              );
              postMessage({
                type: 'SENTINEL_THREAT_FOUND',
                payload: {
                  chunkId,
                  threats,
                  regionStart: scanStart,
                  regionEnd:   scanEnd,
                },
              });
            } else {
              logToUI(
                'SENTINEL',
                `Chunk #${chunkId}: clean — ${newBases.toLocaleString()} bases scanned`,
                'info',
                /* debugOnly */ true,
              );
            }
          } catch (scanErr) {
            // A scan error must never block the pipeline — log and continue.
            logToUI(
              'SENTINEL',
              `Chunk #${chunkId} scan error: ${(scanErr as Error).message}`,
              'error',
            );
          }
        }

        // ── 4. Finalize stream on last chunk ──────────────────────────────
        //    finalizeStream() flushes any incomplete FASTA line and the
        //    staging base-code buffer into the slabs. Called only for the
        //    final chunk to avoid double-flushing.
        if (isFinal) {
          engine.finalizeStream();
          const finalLength = engine.slabManager.getGenomeLength();
          logToUI(
            'WORKER',
            `Scientific stream complete — ${finalLength.toLocaleString()} bp committed to slabs`,
            'success',
          );
          // Notify the main thread that streaming is fully done.
          // The main thread can now send RESTORE_HISTORY to anchor the txId.
          postMessage({
            type: 'STREAM_END_ACK',
            id,
            payload: { totalBases: finalLength },
          });
        }

        // ── 5. Progress broadcast ─────────────────────────────────────────
        //    Sent before CHUNK_ACK so that the UI can update the progress bar
        //    and loading overlay without waiting for the next chunk to start.
        postMessage({
          type: 'CHUNK_LOADED',
          id,
          payload: {
            chunkId,
            basesLoaded: afterLength,
            totalBytes,      // undefined if server omitted Content-Length
            isFinal,
          },
        });

        // ── 6. Backpressure release (CHUNK_ACK) ───────────────────────────
        //    This MUST be the final postMessage in the handler. Sending it
        //    AFTER the Sentinel scan ensures the SlabStreamingPipeline's
        //    in-flight semaphore reflects the worker's actual CPU capacity,
        //    not just the time taken to deserialise the transfer.
        postMessage({ type: 'CHUNK_ACK', id, payload: { chunkId, ok: true } });
        break;
      }

      case 'LOAD_SLICE': {
        const requestId = engine.getNextRequestId();
        const result = await engine.loadSlice(payload, requestId);
        if (result) {
          postMessage({ type: 'SLICE', id, payload: result }, { transfer: [result.buffer] });
        } else {
          postMessage({ type: 'SLICE_CANCELLED', id, payload: { reason: 'superseded' } });
        }
        break;
      }
      case 'PERFORM_SURGICAL_MUTATION': {
        postMessage({
          type: 'MUTATION_ACK',
          id,
          payload: { slabIndex: payload.slabIndex, offset: payload.offset, txId: payload.txId },
        });
        const result = await engine.performSurgicalMutation(payload, e.data.transferables || []);
        engine.slabManager.setCurrentTxId(result.txId);
        postMessage({ type: 'MUTATION_RESULT', id, payload: result });

        const regionStart = Math.max(0, result.offset - 10);
        const regionEnd = Math.min(engine.slabManager.getGenomeLength() - 1, result.offset + 10);
        const patchBuffer = engine.slabManager.readRegion(regionStart, regionEnd).buffer;
        postMessage(
          {
            type: 'MUTATION_PATCH',
            id,
            payload: { start: regionStart, end: regionEnd, buffer: patchBuffer },
          },
          { transfer: [patchBuffer as ArrayBuffer] }
        );
        break;
      }
      case 'UNDO': {
        const reverseOps = engine.undo();
        postMessage({ type: 'UNDO_RESULT', id, payload: { mutations: reverseOps } });
        break;
      }
      case 'REDO': {
        const forwardOps = engine.redo();
        postMessage({ type: 'REDO_RESULT', id, payload: { mutations: forwardOps } });
        break;
      }
      case 'GET_CHRONOS_HISTORY': {
        const history = engine.getHistory();
        postMessage({ type: 'CHRONOS_HISTORY', id, payload: history });
        break;
      }
      case 'EXPORT_PATCH': {
        const patch = engine.exportPatch(payload.txId);
        postMessage({ type: 'EXPORT_PATCH_RESULT', id, payload: patch });
        break;
      }
      case 'LOAD_HISTORY': {
        await engine.loadHistory();
        postMessage({ type: 'LOAD_HISTORY_RESULT', id });
        break;
      }
      case 'GET_GENOME_METADATA': {
        const metadata = engine.getGenomeMetadata();
        postMessage({ type: 'GET_GENOME_METADATA_RESULT', id, payload: metadata });
        break;
      }
      case 'ADD_FEATURE': {
        const feature = engine.addFeature(payload.feature);
        postMessage({ type: 'ADD_FEATURE_RESULT', id, payload: feature });
        break;
      }
      case 'GET_FEATURES_AT': {
        const features = engine.getFeaturesAt(payload.offset);
        postMessage({ type: 'GET_FEATURES_AT_RESULT', id, payload: features });
        break;
      }
      case 'FIND_MOTIF': {
        const matches = engine.findMotif(payload.pattern, payload.start, payload.end, payload.maxMismatches ?? 0);
        postMessage({ type: 'FIND_MOTIF_RESULT', id, payload: matches });
        break;
      }
      case 'SIMULATE_PCR': {
        const products = engine.simulatePCR(
          payload.forwardPrimer,
          payload.reversePrimer,
          payload.maxMismatches,
          payload.minProduct,
          payload.maxProduct
        );
        postMessage({ type: 'SIMULATE_PCR_RESULT', id, payload: products });
        break;
      }
      case 'RESTRICTION_MAP': {
        const sites = engine.restrictionMapper(payload.enzymes);
        postMessage({ type: 'RESTRICTION_MAP_RESULT', id, payload: sites });
        break;
      }
      case 'GENERATE_RADAR_DATA': {
        const bins = engine.generateRadarData(payload.numBins ?? 500);
        postMessage({ type: 'GENERATE_RADAR_DATA_RESULT', id, payload: bins });
        break;
      }
      case 'EXPORT_MUTANT_FASTA': {
        const fasta = engine.exportMutantFasta();
        postMessage({ type: 'EXPORT_MUTANT_FASTA_RESULT', id, payload: fasta });
        break;
      }
      case 'DIFF_REQUEST': {
        const diffs = engine.diffEngine.diffSlabRegion(
          payload.slabIndex,
          payload.startOffset,
          payload.endOffset
        );
        postMessage({ type: 'DIFF_RESULT', id, payload: { slabIndex: payload.slabIndex, diffs } });
        break;
      }
      case 'GET_SENTINEL_SUMMARY': {
        const summary = engine.getSentinelSummary();
        postMessage({ type: 'GET_SENTINEL_SUMMARY_RESULT', id, payload: summary });
        break;
      }
      case 'REFRESH_SENTINEL_SCAN': {
        const summary = engine.refreshSentinelScan();
        postMessage({ type: 'REFRESH_SENTINEL_SCAN_RESULT', id, payload: summary });
        break;
      }
      case 'GET_ORF_SCAN_RESULT': {
        const result = engine.getORFScanResult();
        postMessage({ type: 'GET_ORF_SCAN_RESULT_RESULT', id, payload: result });
        break;
      }
      case 'REFRESH_ORF_SCAN': {
        const result = engine.refreshORFScan();
        postMessage({ type: 'REFRESH_ORF_SCAN_RESULT', id, payload: result });
        break;
      }
      case 'GET_ORFS_IN_RANGE': {
        const orfs = engine.getORFsInRange(payload.start, payload.end);
        postMessage({ type: 'GET_ORFS_IN_RANGE_RESULT', id, payload: orfs });
        break;
      }
      case 'SCAN_OFF_TARGETS': {
        engine.scanOffTargets(payload.query, payload.maxMismatch, id);
        break;
      }
      case 'GET_SYNTENY_ANCHORS': {
        const anchors = engine.getSyntenyAnchors();
        postMessage({ type: 'GET_SYNTENY_ANCHORS_RESULT', id, payload: anchors });
        break;
      }
      case 'REFRESH_SYNTENY_SCAN': {
        const anchors = engine.refreshSyntenyScan();
        postMessage({ type: 'REFRESH_SYNTENY_SCAN_RESULT', id, payload: anchors });
        break;
      }
      case 'PREDICT_SPLICE_SITES': {
        const region = engine.slabManager.readRegion(payload.start, payload.end);
        const sites = await engine.predictSpliceSites(region, payload.strand);
        postMessage({ type: 'PREDICT_SPLICE_SITES_RESULT', id, payload: sites });
        break;
      }
      case 'PREDICT_ISOFORMS': {
        const region = engine.slabManager.readRegion(payload.start, payload.end);
        const isoforms = await engine.predictIsoforms(region, payload.orf, payload.spliceSites);
        postMessage({ type: 'PREDICT_ISOFORMS_RESULT', id, payload: isoforms });
        break;
      }
      case 'GET_PROTEIN_PROPERTIES': {
        const props = engine.getProteinProperties(payload.aaSeq);
        postMessage({ type: 'GET_PROTEIN_PROPERTIES_RESULT', id, payload: props });
        break;
      }
      case 'CALCULATE_MELTING_TEMP': {
        const tm = engine.calculateMeltingTemp(payload.sequence);
        postMessage({ type: 'CALCULATE_MELTING_TEMP_RESULT', id, payload: tm });
        break;
      }
      case 'CALCULATE_CAI': {
        const cai = engine.calculateCAI(payload.sequence, payload.organism);
        postMessage({ type: 'CALCULATE_CAI_RESULT', id, payload: cai });
        break;
      }
      case 'SIMULATE_PCR_ADVANCED': {
        const products = engine.simulatePCR_Advanced(
          payload.forwardPrimer,
          payload.reversePrimer,
          payload.templateStart,
          payload.templateEnd,
          payload.options
        );
        postMessage({ type: 'SIMULATE_PCR_ADVANCED_RESULT', id, payload: products });
        break;
      }
      case 'DETECT_HAIRPINS': {
        const hairpins = await engine.detectHairpins(payload.sequence);
        postMessage({ type: 'DETECT_HAIRPINS_RESULT', id, payload: hairpins });
        break;
      }
      case 'PREDICT_ASSEMBLY_JUNCTION': {
        const result = engine.predictAssemblyJunction(
          payload.leftStart,
          payload.leftEnd,
          payload.rightStart,
          payload.rightEnd,
          payload.method,
          payload.options
        );
        postMessage({ type: 'PREDICT_ASSEMBLY_JUNCTION_RESULT', id, payload: result });
        break;
      }
      case 'FIND_RESTRICTION_SITES': {
        const sites = await engine.findRestrictionSites(payload.start, payload.end, payload.enzymes);
        postMessage({ type: 'FIND_RESTRICTION_SITES_RESULT', id, payload: sites });
        break;
      }
      case 'AUTO_ANNOTATE': {
        const features = await engine.autoAnnotateGenome();
        postMessage({ type: 'AUTO_ANNOTATE_RESULT', id, payload: features });
        break;
      }
      case 'CREATE_BRANCH': {
        const success = engine.createBranch(payload.name, payload.fromCommitId);
        postMessage({ type: 'CREATE_BRANCH_RESULT', id, payload: success });
        break;
      }
      case 'CHECKOUT': {
        const success = engine.checkout(payload.branchName);
        postMessage({ type: 'CHECKOUT_RESULT', id, payload: success });
        break;
      }
      case 'MERGE': {
        const mergeCommitId = engine.merge(payload.sourceBranch, payload.targetBranch, payload.message);
        postMessage({ type: 'MERGE_RESULT', id, payload: mergeCommitId });
        break;
      }
      case 'GET_BRANCHES': {
        const branches = engine.getBranches();
        postMessage({ type: 'GET_BRANCHES_RESULT', id, payload: branches });
        break;
      }
      case 'GET_COMMITS': {
        const commits = engine.getCommits();
        postMessage({ type: 'GET_COMMITS_RESULT', id, payload: commits });
        break;
      }
      case 'RESTORE_HISTORY': {
        engine.chronos.restore(payload.commits, payload.branches, payload.headCommitId);
        if (payload.headCommitId) {
          engine.slabManager.setCurrentTxId(payload.headCommitId);
        }
        postMessage({ type: 'RESTORE_HISTORY_RESULT', id, payload: { ok: true } });
        break;
      }
      case 'FOLD_PROTEIN': {
        const { computeProteinFold } = await import('../../lib/proteinFold');
        const fold = await computeProteinFold(
          payload.sequence,
          payload.consentObtained ?? false
        );
        postMessage({ type: 'FOLD_PROTEIN_RESULT', id, payload: fold });
        break;
      }

      // ── VERIFY_SLAB_STATE (FR-01) ─────────────────────────────────────────
      case 'VERIFY_SLAB_STATE': {
        const { expectedTxId } = payload as { expectedTxId: string };
        const status = engine.slabManager.revertToSnapshot(expectedTxId);
        const slabVersion = engine.slabManager.getSlabVersion();
        if (status === 'hard_reset_required') {
          logToUI(
            'WORKER',
            `VERIFY_SLAB_STATE: txId mismatch — hard reset performed ` +
            `(new slabVersion=${slabVersion})`,
            'warning'
          );
        } else {
          logToUI('WORKER', `VERIFY_SLAB_STATE: slabs consistent (txId="${expectedTxId}")`, 'info');
        }
        postMessage({
          type: 'VERIFY_SLAB_STATE_RESULT',
          id,
          payload: { status, slabVersion },
        });
        break;
      }

      // ── RUN_FULL_AUDIT ────────────────────────────────────────────────────
      case 'RUN_FULL_AUDIT': {
        const genomeLength = engine.slabManager.getGenomeLength();
        logToUI('SYSTEM', `Full audit started — genome ${genomeLength} bp`, 'info');

        const sentinelSummary = engine.refreshSentinelScan();
        const orfResult = engine.refreshORFScan();
        engine.refreshSyntenyScan();
        const syntenyAnchors = engine.getSyntenyAnchors();

        const auditResult = {
          genomeLength,
          slabVersion: engine.slabManager.getSlabVersion(),
          currentTxId: engine.slabManager.getCurrentTxId(),
          sentinel: sentinelSummary,
          orf: orfResult,
          syntenyAnchors,
          timestamp: Date.now(),
        };

        postMessage({ type: 'RUN_FULL_AUDIT_RESULT', id, payload: auditResult });
        logToUI(
          'SYSTEM',
          `Full audit complete — sentinel:${sentinelSummary ? sentinelSummary.bins.length + ' bins' : 'pending'}, ` +
          `orfs:${orfResult ? orfResult.totalORFs : 'pending'}, ` +
          `anchors:${syntenyAnchors.length}`,
          'success'
        );
        break;
      }

      // ── RUN_ISOFORM_SCAN ──────────────────────────────────────────────────
      case 'RUN_ISOFORM_SCAN': {
        const scanStart: number = payload.start ?? 0;
        const scanEnd: number   = Math.min(
          payload.end ?? engine.slabManager.getGenomeLength() - 1,
          engine.slabManager.getGenomeLength() - 1
        );
        const scanStrand: '+' | '-' = payload.strand ?? '+';

        if (scanStart > scanEnd) {
          postMessage({
            type: 'RUN_ISOFORM_SCAN_RESULT',
            id,
            payload: {
              start: scanStart, end: scanEnd, strand: scanStrand,
              spliceSites: [], isoformGroups: [], totalIsoforms: 0,
              timestamp: Date.now(),
            },
          });
          break;
        }

        const scanRegion = engine.slabManager.readRegion(scanStart, scanEnd);
        const spliceSites = await engine.predictSpliceSites(scanRegion, scanStrand);
        const overlappingORFs = engine.getORFsInRange(scanStart, scanEnd);

        const isoformGroups: Array<{ orf: typeof overlappingORFs[0]; isoforms: Awaited<ReturnType<typeof engine.predictIsoforms>> }> = [];
        let totalIsoforms = 0;

        for (const orf of overlappingORFs) {
          const localORF = {
            ...orf,
            start: Math.max(0, orf.start - scanStart),
            end:   Math.min(scanRegion.length - 1, orf.end - scanStart),
          };
          const isoforms = await engine.predictIsoforms(scanRegion, localORF, spliceSites);
          if (isoforms.length > 0) {
            isoformGroups.push({ orf, isoforms });
            totalIsoforms += isoforms.length;
          }
        }

        logToUI(
          'WORKER',
          `Isoform scan [${scanStart}–${scanEnd}] (${scanStrand}): ` +
          `${spliceSites.length} splice sites, ${totalIsoforms} isoforms across ${isoformGroups.length} ORFs`,
          totalIsoforms > 0 ? 'success' : 'info'
        );

        postMessage({
          type: 'RUN_ISOFORM_SCAN_RESULT',
          id,
          payload: {
            start: scanStart,
            end:   scanEnd,
            strand: scanStrand,
            spliceSites,
            isoformGroups,
            totalIsoforms,
            timestamp: Date.now(),
          },
        });
        break;
      }

      default:
        console.warn('Unknown message type', type);
    }
  } catch (error) {
    postMessage({
      type: 'ERROR',
      id,
      payload: { message: (error as Error).message, stack: (error as Error).stack },
    });
  }
};

export {};