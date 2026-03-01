/**
 * SlabManager.ts
 * High‑performance, slab‑allocated storage for genomic sequence.
 * Now with FeatureMap: tag ranges with biological features (exons, binding sites, etc.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FR-01 — Frozen Recovery: Slab ↔ Cloud State Synchronisation (NEW)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   PROBLEM (Frozen Recovery Bug):
 *     When a cloud sync restores genome metadata (COMMIT_SYNC push), the
 *     SharedArrayBuffer slabs in the worker thread may be "dirty" — carrying
 *     local, un-synced mutations that the cloud has never seen. This creates a
 *     split-brain state: the UI's chronosHead and the Supabase commit history
 *     agree on the authoritative sequence, but the SlabManager's physical bytes
 *     contain a diverged local edit.
 *
 *     Symptoms:
 *       • The viewport renders bases from the dirty local state.
 *       • Undo/redo operations produce wrong results because the engine's
 *         physical memory doesn't match the commit the DAG says is HEAD.
 *       • Any feature computed from the raw slabs (GC%, ORFs, restriction
 *         digest) is silently wrong.
 *
 *   DESIGN — THREE NEW PRIMITIVES:
 *
 *     1. currentTxId (string | null)
 *          Tracks the last transaction ID whose mutations have been fully
 *          applied to the physical slab bytes. Updated by:
 *            • setCurrentTxId()      — called by the worker after PERFORM_SURGICAL_MUTATION
 *            • hardReset()           — cleared to null (slabs wiped)
 *          Not updated by appendBytes() because bulk FASTA ingestion is
 *          pre-commit; the first commit's txId is written separately.
 *
 *     2. slabVersion (number)
 *          Monotonically increasing counter. Incremented only by hardReset().
 *          The store mirrors this value in `slabVersion`. SequenceView compares
 *          the store's `slabVersion` against the last `viewportVersion` that
 *          arrived AFTER the slab version bumped to detect the "slabs cleared,
 *          viewport stale" window and show the re-alignment overlay.
 *
 *     3. revertToSnapshot(expectedTxId) → 'ok' | 'hard_reset_required'
 *          The primary reconciliation entry point. Called by the worker in
 *          response to a `VERIFY_SLAB_STATE` message from the main thread:
 *
 *            If currentTxId === expectedTxId  → return 'ok' (no action)
 *            Otherwise                         → hardReset(), return
 *                                               'hard_reset_required'
 *
 *          A hard reset clears all slab bytes, increments slabVersion, and
 *          sets currentTxId to null. The worker returns the new slabVersion
 *          to the main thread so the store can mirror it immediately. The
 *          main thread then triggers a full genome re-load via
 *          RESET_ENGINE + STREAM + RESTORE_HISTORY.
 *
 *   WORKER INTEGRATION (ArkheEngine.worker.ts):
 *     The worker must handle a new message type: VERIFY_SLAB_STATE
 *
 *       case 'VERIFY_SLAB_STATE': {
 *         const { expectedTxId } = payload as { expectedTxId: string };
 *         const status = slabManager.revertToSnapshot(expectedTxId);
 *         reply({ status, slabVersion: slabManager.getSlabVersion() });
 *         break;
 *       }
 *
 *     And update setCurrentTxId calls:
 *
 *       case 'PERFORM_SURGICAL_MUTATION': {
 *         // ... apply mutation ...
 *         slabManager.setCurrentTxId(payload.txId);
 *         reply({ ok: true });
 *         break;
 *       }
 *
 *       case 'RESTORE_HISTORY': {
 *         // ... replay commits ...
 *         slabManager.setCurrentTxId(payload.headCommitId);
 *         reply({ ok: true });
 *         break;
 *       }
 *
 *   ATOMICITY NOTE:
 *     hardReset() is synchronous and runs entirely within the worker's single-
 *     threaded execution context. Even when SharedArrayBuffer is in use, the
 *     hard reset runs before any new postAndWait() can observe the cleared
 *     state, because JavaScript is single-threaded and the worker's message
 *     pump processes one message at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PINNACLE SPRINT FIX — SHADOW-NEW-05 (2026-02-21):
 *   O(n) bottleneck in appendBytes() — ELIMINATED.
 *
 * SPRINT 1 AUDIT FIX — SLAB-META-01 (2026-02-22):
 *   Intermediate slab metadata now updated inside appendBytes() loop.
 *
 * LB-03 / LB-12 FIX (2026-02-25):
 *   Added getTotalAllocatedBytes() to report total memory consumed by slabs.
 */

import type { BaseCode, SlabMeta } from '@/types/arkhe';

export const SLAB_SIZE       = 1_048_576; // Default 1MB
export const SMALL_SLAB_SIZE = 262_144;   // 256KB for < 100MB files
export const LARGE_SLAB_SIZE = 4_194_304; // 4MB for > 1GB files

export function getAdaptiveSlabSize(expectedFileSize?: number): number {
  if (!expectedFileSize) return SLAB_SIZE;
  const fileSizeMB = expectedFileSize / (1024 * 1024);
  if (fileSizeMB > 1024) {
    return LARGE_SLAB_SIZE;
  } else if (fileSizeMB >= 100) {
    return SLAB_SIZE;
  } else {
    return SMALL_SLAB_SIZE;
  }
}

export interface FeatureTag {
  id: string;
  name: string;
  type: 'exon' | 'intron' | 'cds' | 'promoter' | 'binding_site' | 'repeat' | 'other';
  start: number; // global offset
  end: number;   // inclusive
  strand?: '+' | '-';
  attributes?: Record<string, unknown>;
}

/**
 * The result returned by revertToSnapshot().
 *
 *   'ok'                  — currentTxId matched; slabs are consistent, no action taken.
 *   'hard_reset_required' — txId mismatch detected; slabs have been wiped and
 *                           slabVersion incremented. The caller (worker handler for
 *                           VERIFY_SLAB_STATE) must relay this back to the main thread
 *                           so it can trigger a full genome re-load.
 */
export type SnapshotRevertResult = 'ok' | 'hard_reset_required';

export class SlabManager {
  private slabs: Array<Uint8Array> = [];
  private slabMeta: Map<number, SlabMeta> = new Map();
  private useShared: boolean;
  private genomeLength = 0;
  private slabSize: number;

  // Feature Map – interval tree for fast overlap queries
  private features: FeatureTag[] = [];
  private featureIntervals: Map<number, FeatureTag[]> = new Map();

  // ── FR-01: Slab versioning & transaction tracking ───────────────────────────
  //
  // currentTxId  — the Chronos transaction ID whose mutations are fully
  //                reflected in the current physical slab bytes. null means
  //                the slabs have been cleared (post-hardReset) or no commit
  //                has been applied yet (fresh FASTA load, pre-first-commit).
  //
  // slabVersion  — monotonically increasing counter, incremented only by
  //                hardReset(). Mirrored in the Zustand store's `slabVersion`
  //                field so SequenceView can compare it against the viewport
  //                version to detect a stale-viewport window.
  private currentTxId: string | null = null;
  private slabVersion: number = 0;

  constructor(useSharedArrayBuffer: boolean, expectedFileSize?: number) {
    this.useShared = useSharedArrayBuffer && typeof SharedArrayBuffer !== 'undefined';
    this.slabSize  = getAdaptiveSlabSize(expectedFileSize);
  }

  // --- Slab management ---

  createSlab(slabIndex: number, initialData?: Uint8Array): Uint8Array {
    let buffer: ArrayBuffer | SharedArrayBuffer;
    if (this.useShared) {
      buffer = new SharedArrayBuffer(this.slabSize);
    } else {
      buffer = new ArrayBuffer(this.slabSize);
    }
    const view = new Uint8Array(buffer);
    if (initialData) {
      view.set(initialData.subarray(0, this.slabSize));
    }
    this.slabs[slabIndex] = view;
    this.slabMeta.set(slabIndex, {
      slabIndex,
      length: initialData?.length ?? 0,
    });
    return view;
  }

  getSlab(slabIndex: number): Uint8Array | undefined {
    return this.slabs[slabIndex];
  }

  globalToSlab(offset: number): { slabIndex: number; offsetInSlab: number } {
    const slabIndex    = Math.floor(offset / this.slabSize);
    const offsetInSlab = offset % this.slabSize;
    return { slabIndex, offsetInSlab };
  }

  readBase(globalOffset: number): BaseCode {
    const { slabIndex, offsetInSlab } = this.globalToSlab(globalOffset);
    const slab = this.slabs[slabIndex];
    if (!slab) throw new Error(`Slab ${slabIndex} not allocated`);
    return slab[offsetInSlab] as BaseCode;
  }

  writeBase(globalOffset: number, base: BaseCode): void {
    const { slabIndex, offsetInSlab } = this.globalToSlab(globalOffset);
    const slab = this.slabs[slabIndex];
    if (!slab) throw new Error(`Slab ${slabIndex} not allocated`);
    if (this.useShared) {
      Atomics.store(slab, offsetInSlab, base);
    } else {
      slab[offsetInSlab] = base;
    }
    const meta = this.slabMeta.get(slabIndex)!;
    if (globalOffset + 1 > this.genomeLength) {
      this.genomeLength = globalOffset + 1;
      meta.length = Math.max(meta.length, offsetInSlab + 1);
    }
  }

  readRegion(start: number, end: number): Uint8Array {
    const length = end - start + 1;
    const result = new Uint8Array(length);
    let pos     = 0;
    let current = start;
    while (current <= end) {
      const { slabIndex, offsetInSlab } = this.globalToSlab(current);
      const slab = this.slabs[slabIndex];
      if (!slab) throw new Error(`Slab ${slabIndex} missing`);
      const chunkSize = Math.min(this.slabSize - offsetInSlab, end - current + 1);
      result.set(slab.subarray(offsetInSlab, offsetInSlab + chunkSize), pos);
      pos     += chunkSize;
      current += chunkSize;
    }
    return result;
  }

  /**
   * appendBytes — SHADOW-NEW-05 FIX: O(n/slabSize) loop, not O(n).
   *
   * Each iteration copies an entire slab-aligned chunk in one Uint8Array.set()
   * call. V8 and SpiderMonkey both lower TypedArray.set() to a hardware memcpy
   * (SIMD-accelerated on x86 / ARM NEON), so the inner loop is eliminated
   * entirely and replaced with a CPU-optimal bulk transfer.
   *
   * Before:  100M iterations for a 100MB genome.
   * After:   100 iterations (at 1MB slabSize) + 100 native memcpy calls.
   *
   * SLAB-META-01 FIX (2026-02-22):
   *   Metadata is now updated INSIDE the while loop, immediately after each
   *   slab.set() call. Previously only the last slab received a metadata
   *   refresh; all intermediate slabs retained stale length = 0 values.
   *
   *   The update sets meta.length = offsetInSlab + toCopy, which is the
   *   exclusive end of valid data within that slab after this write.
   *   For a completely filled slab (toCopy === slabSize - offsetInSlab with
   *   offsetInSlab = 0) this correctly yields slabSize.
   *
   * FR-01 NOTE:
   *   appendBytes does NOT update currentTxId. Bulk FASTA ingestion writes
   *   the raw sequence before any Chronos commit exists. The txId is set
   *   separately via setCurrentTxId() once the engine's RESTORE_HISTORY or
   *   first PERFORM_SURGICAL_MUTATION resolves.
   */
  appendBytes(data: Uint8Array): void {
    if (data.length === 0) return;

    let srcOffset    = 0;
    let globalOffset = this.genomeLength;

    while (srcOffset < data.length) {
      const { slabIndex, offsetInSlab } = this.globalToSlab(globalOffset);

      // Lazily allocate the slab if this is the first write to it
      if (!this.slabs[slabIndex]) {
        this.createSlab(slabIndex);
      }

      const slab = this.slabs[slabIndex];

      // Bytes remaining in current slab vs. bytes remaining in input
      const capacityInSlab = this.slabSize - offsetInSlab;
      const remaining      = data.length - srcOffset;
      const toCopy         = Math.min(capacityInSlab, remaining);

      // ── SIMD-accelerated bulk copy (replaces the inner per-byte loop) ──────
      slab.set(data.subarray(srcOffset, srcOffset + toCopy), offsetInSlab);

      // ── SLAB-META-01 FIX: update this slab's metadata immediately ──────────
      // Every slab that is written to in this call gets an accurate `length`
      // value, not just the final slab. This prevents stale length = 0 entries
      // on intermediate slabs when a single appendBytes call spans slab
      // boundaries (e.g. a 10MB append touching 10 × 1MB slabs).
      const meta = this.slabMeta.get(slabIndex);
      if (meta) {
        meta.length = offsetInSlab + toCopy;
      }

      srcOffset    += toCopy;
      globalOffset += toCopy;
    }

    // Update genomeLength once — kept outside the hot loop
    this.genomeLength += data.length;
  }

  getGenomeLength(): number {
    return this.genomeLength;
  }

  getSlabMeta(slabIndex: number): SlabMeta | undefined {
    return this.slabMeta.get(slabIndex);
  }

  getAllSlabMetas(): SlabMeta[] {
    return Array.from(this.slabMeta.values());
  }

  computeSlabHash(slabIndex: number): string {
    const slab = this.slabs[slabIndex];
    if (!slab) return '';
    let hash = 5381;
    for (let i = 0; i < slab.length; i++) {
      hash = (hash * 33) ^ slab[i];
    }
    return (hash >>> 0).toString(16);
  }

  // ── FR-01: Transaction tracking & snapshot reconciliation ──────────────────

  /**
   * setCurrentTxId
   *
   * Records the Chronos transaction ID that is now fully reflected in the
   * physical slab bytes. Should be called by the worker immediately after:
   *
   *   • PERFORM_SURGICAL_MUTATION — with the mutation's txId
   *   • RESTORE_HISTORY           — with the restored headCommitId
   *
   * NOT called after appendBytes() — raw FASTA ingestion is pre-commit.
   */
  setCurrentTxId(txId: string): void {
    this.currentTxId = txId;
  }

  /**
   * getCurrentTxId
   *
   * Returns the txId last recorded via setCurrentTxId(), or null if the slabs
   * have been cleared (post-hardReset) or no commit has been applied yet.
   */
  getCurrentTxId(): string | null {
    return this.currentTxId;
  }

  /**
   * getSlabVersion
   *
   * Returns the current slab version number. This value is monotonically
   * increasing and only incremented by hardReset(). The Zustand store mirrors
   * it in `slabVersion`; SequenceView compares `slabVersion` against
   * `slabAcknowledgedVersion` to detect the stale-viewport window after a
   * hard reset and show the "Re-aligning Memory..." overlay.
   */
  getSlabVersion(): number {
    return this.slabVersion;
  }

  /**
   * hardReset
   *
   * Wipes all slab allocations and resets genome-level bookkeeping.
   * This is a nuclear option: after calling it the SlabManager is equivalent
   * to a freshly constructed instance (except slabVersion is NOT reset — it
   * continues incrementing so the store can detect each distinct reset event).
   *
   * Called by:
   *   • revertToSnapshot() — when a txId mismatch is detected
   *   • The worker's RESET_ENGINE handler — on user-initiated load
   *
   * Features are also cleared because they are indexed by global offsets that
   * are meaningless after the slab data is wiped.
   *
   * THREAD SAFETY:
   *   Runs synchronously inside the worker's single-threaded message pump.
   *   The worker will not process another message until hardReset() returns,
   *   so there is no window where a read races against a partially-cleared slab.
   */
  hardReset(): void {
    // Drop all slab allocations — GC will reclaim the ArrayBuffers / SABs.
    this.slabs        = [];
    this.slabMeta     = new Map();
    this.genomeLength = 0;
    this.currentTxId  = null;

    // Increment the version AFTER clearing state so the new version number
    // represents "cleared, awaiting re-fill".
    this.slabVersion++;

    // Features are indexed against now-invalid global offsets — clear them.
    this.features          = [];
    this.featureIntervals  = new Map();
  }

  /**
   * revertToSnapshot
   *
   * The primary reconciliation entry point for the Frozen Recovery fix.
   *
   * Compares `expectedTxId` against `currentTxId`:
   *
   *   Match    → returns 'ok'.  Slabs are consistent with the cloud state.
   *              No memory is touched; this path is O(1).
   *
   *   Mismatch → calls hardReset(), returns 'hard_reset_required'.
   *              The slab bytes are no longer valid. The caller (worker's
   *              VERIFY_SLAB_STATE handler) must relay the result to the
   *              main thread so it can:
   *                1. Bump `slabVersion` in the Zustand store.
   *                2. Set `isRealigning: true` to show the UI overlay.
   *                3. Trigger a full genome re-load via loadGenomeFromCloud().
   *
   * WHY NO INCREMENTAL ROLLBACK?
   *   Incremental rollback would require a full snapshot of every byte before
   *   each mutation — prohibitively expensive for multi-megabyte slabs. The
   *   Chronos commit log records WHAT changed (txId → MutationRecord[]) but
   *   not the pre-mutation byte values. Without before-images we cannot undo
   *   individual writeBase() calls at the slab level.
   *
   *   The hard reset + cloud re-load is the correct recovery strategy: it
   *   trades a single round-trip latency (< 2s for typical genomes on a CDN)
   *   for guaranteed consistency between the physical slab bytes and the
   *   authoritative cloud state.
   *
   * @param expectedTxId  The head commit ID that the slabs should reflect,
   *                      as determined by the successful cloud sync response.
   */
  revertToSnapshot(expectedTxId: string): SnapshotRevertResult {
    if (this.currentTxId === expectedTxId) {
      // Fast path: slabs already represent the correct commit.
      return 'ok';
    }

    // Mismatch detected. Log diagnostics inside the worker context.
    console.warn(
      `[SlabManager] revertToSnapshot: txId mismatch. ` +
      `expected="${expectedTxId}" actual="${this.currentTxId ?? 'null'}". ` +
      `Initiating hard reset (slabVersion will become ${this.slabVersion + 1}).`
    );

    this.hardReset();
    return 'hard_reset_required';
  }

  // --- FeatureMap API ---

  addFeature(feature: Omit<FeatureTag, 'id'>): FeatureTag {
    const id          = `feat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fullFeature: FeatureTag = { ...feature, id };
    this.features.push(fullFeature);

    const startSlab = Math.floor(feature.start / this.slabSize);
    const endSlab   = Math.floor(feature.end   / this.slabSize);
    for (let s = startSlab; s <= endSlab; s++) {
      if (!this.featureIntervals.has(s)) {
        this.featureIntervals.set(s, []);
      }
      this.featureIntervals.get(s)!.push(fullFeature);
    }
    return fullFeature;
  }

  getFeaturesAt(globalOffset: number): FeatureTag[] {
    const slabIdx         = Math.floor(globalOffset / this.slabSize);
    const featuresInSlab  = this.featureIntervals.get(slabIdx) || [];
    return featuresInSlab.filter(f => globalOffset >= f.start && globalOffset <= f.end);
  }

  getFeaturesInRange(start: number, end: number): FeatureTag[] {
    const startSlab = Math.floor(start / this.slabSize);
    const endSlab   = Math.floor(end   / this.slabSize);
    const result: FeatureTag[] = [];
    for (let s = startSlab; s <= endSlab; s++) {
      const feats = this.featureIntervals.get(s) || [];
      result.push(...feats.filter(f => f.start <= end && f.end >= start));
    }
    // Remove duplicates (features spanning multiple slabs)
    return Array.from(new Map(result.map(f => [f.id, f])).values());
  }

  getAllFeatures(): FeatureTag[] {
    return [...this.features];
  }

  // --- LB-03 / LB-12: Memory usage reporting ---

  /**
   * Returns the total number of bytes allocated by all slabs.
   * This counts the full slab size for each slab, regardless of how much
   * of it is actually used, because the ArrayBuffer is fully allocated.
   */
  getTotalAllocatedBytes(): number {
    return this.slabs.length * this.slabSize;
  }
}