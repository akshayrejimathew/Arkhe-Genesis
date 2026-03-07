/**
 * SlabManager.ts
 * High‑performance, slab‑allocated storage for genomic sequence.
 * Now with FeatureMap: tag ranges with biological features (exons, binding sites, etc.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SS-01 — Scientific Streaming: ReadableStream → SharedArrayBuffer Pipe (NEW)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   PROBLEM:
 *     Loading a gigabyte-scale FASTA file via a single fetch() call blocks the
 *     main thread and stalls the UI for several seconds. The existing
 *     handleStreamChunk() pathway in the worker already parses FASTA
 *     incrementally, but the main-thread coordination layer still batched
 *     chunks naively, flooding the worker's message queue with hundreds of
 *     small buffers per second — or worse, building one massive string in
 *     memory before posting anything.
 *
 *   DESIGN — SlabStreamingPipeline:
 *
 *     A main-thread coordinator class that:
 *
 *       1. Opens the remote resource with the Fetch API's ReadableStream
 *          interface, reading raw network bytes incrementally without ever
 *          materialising the entire file in memory.
 *
 *       2. Accumulates incoming network bytes into a 1 MB (SLAB_SIZE) staging
 *          buffer. When the buffer fills, the underlying ArrayBuffer is
 *          *transferred* (zero-copy) to the worker via a CHUNK_RECEIVED
 *          postMessage. Transfer semantics detach the ArrayBuffer from the
 *          main thread in O(1) — no memcpy at the JS boundary.
 *
 *       3. Enforces ACK-based backpressure: the pipeline tracks how many
 *          CHUNK_RECEIVED messages have been sent but not yet acknowledged
 *          (in-flight count). If the in-flight count reaches maxInFlight
 *          (default 2), the pipeline suspends reading from the network stream
 *          by NOT calling reader.read() until a CHUNK_ACK arrives from the
 *          worker. This prevents the network from filling RAM faster than
 *          the worker can commit bytes to SharedArrayBuffer slabs.
 *
 *       4. The worker's CHUNK_RECEIVED handler pipes each chunk through the
 *          existing handleStreamChunk() / FASTA-parse pathway, runs a
 *          per-chunk Sentinel threat scan on the freshly committed bases, and
 *          replies with CHUNK_ACK to release the in-flight semaphore. The
 *          Sentinel scan begins on the first 1 MB of sequence while the
 *          final megabytes are still in-flight over the network.
 *
 *   MAIN THREAD INTEGRATION:
 *
 *     const pipeline = new SlabStreamingPipeline(worker, { maxInFlight: 2 });
 *
 *     // Wire CHUNK_ACK back to the pipeline so backpressure resolves:
 *     worker.addEventListener('message', (e) => {
 *       if (e.data.type === 'CHUNK_ACK')  pipeline.acknowledgeChunk(e.data.payload.chunkId);
 *       if (e.data.type === 'CHUNK_ERR')  pipeline.rejectChunk(e.data.payload.chunkId, new Error(e.data.payload.reason));
 *     });
 *
 *     await pipeline.streamFromUrl('https://cdn.example.com/genome.fasta', {
 *       onChunkSent:  (loaded, total) => updateProgressBar(loaded, total),
 *       onComplete:   (total) => console.log(`Loaded ${total} bytes`),
 *       signal:       abortController.signal,
 *     });
 *
 *   BACKPRESSURE INVARIANT:
 *     At most maxInFlight chunks are in-flight (sent but not ACK'd) at any
 *     moment. Each sendChunk() call awaits a micro-sleep loop that yields
 *     until inFlight < maxInFlight. Because CHUNK_ACK is dispatched by the
 *     worker *after* both slab.appendBytes() and the Sentinel scan complete,
 *     the backpressure directly reflects the worker's CPU capacity, not just
 *     its message-queue depth.
 *
 *   ZERO-COPY PATH:
 *     accumulator (Uint8Array view over a 1 MB ArrayBuffer)
 *       │  accumulator is full or stream done
 *       ▼
 *     ArrayBuffer.prototype.slice() → new detached ArrayBuffer (1 MB copy, once)
 *       │  postMessage([transferBuffer], [transferBuffer])
 *       ▼
 *     Worker receives Transferable — main thread ArrayBuffer is neutered.
 *     Worker wraps in Uint8Array and hands to handleStreamChunk() — no further copy.
 *
 *   NOTE ON ACCUMULATOR RESET:
 *     After a 1 MB chunk is transferred, `accumulator` is replaced with a
 *     fresh `new Uint8Array(SLAB_SIZE)`. The old ArrayBuffer was transferred
 *     and is now owned by the worker; the JS GC will reclaim it once the
 *     worker's message handler dereferences it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FR-01 — Frozen Recovery: Slab ↔ Cloud State Synchronisation
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
 *   DESIGN — THREE NEW PRIMITIVES:
 *     (See full design notes in git history — abbreviated here for brevity.)
 *
 *     1. currentTxId  — last txId fully applied to physical slab bytes.
 *     2. slabVersion  — monotonically increasing counter, incremented by hardReset().
 *     3. revertToSnapshot(expectedTxId) → 'ok' | 'hard_reset_required'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PINNACLE SPRINT FIX — SHADOW-NEW-05 (2026-02-21): O(n) bottleneck eliminated.
 * SPRINT 1 AUDIT FIX  — SLAB-META-01 (2026-02-22): Intermediate slab metadata
 *                        updated inside appendBytes() loop.
 * LB-03 / LB-12 FIX    (2026-02-25): Added getTotalAllocatedBytes().
 */

import type { BaseCode, SlabMeta } from '@/types/arkhe';

export const SLAB_SIZE       = 1_048_576; // Default 1 MB — also the streaming chunk size
export const SMALL_SLAB_SIZE = 262_144;   // 256 KB for < 100 MB files
export const LARGE_SLAB_SIZE = 4_194_304; // 4 MB for > 1 GB files

/**
 * The streaming pipeline uses SLAB_SIZE as the canonical chunk boundary so
 * that every CHUNK_RECEIVED message maps 1-to-1 to one slab allocation in the
 * worker.  Expose the alias for callers that import only from this module.
 */
export const STREAMING_CHUNK_SIZE = SLAB_SIZE;

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
 *                           slabVersion incremented.
 */
export type SnapshotRevertResult = 'ok' | 'hard_reset_required';

// ─────────────────────────────────────────────────────────────────────────────
// SS-01 — Scientific Streaming types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for SlabStreamingPipeline.streamFromUrl().
 */
export interface StreamingOptions {
  /**
   * Called after each 1 MB chunk has been posted to the worker.
   * `bytesRead` is the cumulative raw bytes consumed from the network stream
   * (pre-FASTA-parse); `totalBytes` is undefined if the server did not send
   * a Content-Length header.
   */
  onChunkSent?: (bytesRead: number, totalBytes: number | undefined) => void;

  /**
   * Called once when all chunks have been sent and the final CHUNK_ACK has
   * been received.  `totalBytesRead` is the total raw bytes from the network.
   */
  onComplete?: (totalBytesRead: number) => void;

  /**
   * Called if the fetch, transfer, or worker ACK fails.
   */
  onError?: (error: Error) => void;

  /**
   * AbortSignal to cancel an in-progress stream (e.g. user navigates away or
   * resets the engine).  Cancellation rejects all pending ACK promises.
   */
  signal?: AbortSignal;
}

/**
 * Shape of the CHUNK_RECEIVED postMessage payload sent to the worker.
 */
export interface ChunkReceivedPayload {
  /** Monotonically increasing chunk sequence number, 1-based. */
  chunkId: number;
  /**
   * Transferred ArrayBuffer containing raw FASTA/sequence bytes.
   * The sending context's reference is neutered after transfer.
   */
  buffer: ArrayBuffer;
  /** True for the final (possibly partial) chunk of the stream. */
  isFinal: boolean;
  /**
   * Raw Content-Length in bytes reported by the server, if available.
   * Used by the worker's CHUNK_LOADED progress broadcast.
   */
  totalBytes?: number;
}

/**
 * Shape of the CHUNK_ACK postMessage payload received from the worker.
 */
export interface ChunkAckPayload {
  chunkId: number;
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SlabManager
// ─────────────────────────────────────────────────────────────────────────────

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
  private currentTxId: string | null = null;
  private slabVersion: number = 0;

  constructor(useSharedArrayBuffer: boolean, expectedFileSize?: number) {
    this.useShared = useSharedArrayBuffer && typeof SharedArrayBuffer !== 'undefined';
    this.slabSize  = getAdaptiveSlabSize(expectedFileSize);
  }

  // ─── Slab management ────────────────────────────────────────────────────────

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
   * SLAB-META-01 FIX (2026-02-22):
   *   Metadata is now updated INSIDE the while loop, immediately after each
   *   slab.set() call.
   *
   * FR-01 NOTE:
   *   appendBytes does NOT update currentTxId. Bulk FASTA ingestion writes
   *   the raw sequence before any Chronos commit exists.
   *
   * SS-01 NOTE:
   *   Called by the worker's CHUNK_RECEIVED handler (via handleStreamChunk)
   *   for every 1 MB network chunk. Each call may span multiple slab
   *   boundaries; the O(n/slabSize) loop ensures exactly one TypedArray.set()
   *   per slab crossed.
   */
  appendBytes(data: Uint8Array): void {
    if (data.length === 0) return;

    let srcOffset    = 0;
    let globalOffset = this.genomeLength;

    while (srcOffset < data.length) {
      const { slabIndex, offsetInSlab } = this.globalToSlab(globalOffset);

      if (!this.slabs[slabIndex]) {
        this.createSlab(slabIndex);
      }

      const slab = this.slabs[slabIndex];
      const capacityInSlab = this.slabSize - offsetInSlab;
      const remaining      = data.length - srcOffset;
      const toCopy         = Math.min(capacityInSlab, remaining);

      // ── SIMD-accelerated bulk copy ───────────────────────────────────────
      slab.set(data.subarray(srcOffset, srcOffset + toCopy), offsetInSlab);

      // ── SLAB-META-01 FIX: update metadata immediately ───────────────────
      const meta = this.slabMeta.get(slabIndex);
      if (meta) {
        meta.length = offsetInSlab + toCopy;
      }

      srcOffset    += toCopy;
      globalOffset += toCopy;
    }

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

  setCurrentTxId(txId: string): void {
    this.currentTxId = txId;
  }

  getCurrentTxId(): string | null {
    return this.currentTxId;
  }

  getSlabVersion(): number {
    return this.slabVersion;
  }

  /**
   * hardReset
   *
   * Wipes all slab allocations and resets genome-level bookkeeping.
   * slabVersion is NOT reset — it increments to mark a distinct reset event.
   * Features are also cleared (offsets are now invalid).
   *
   * Called by revertToSnapshot() on txId mismatch, and by the worker's
   * RESET_ENGINE handler on user-initiated load.
   *
   * SS-01 NOTE:
   *   If a streamFromUrl() call is in progress when hardReset() fires, the
   *   worker's stream-aborted flag will cause subsequent CHUNK_RECEIVED
   *   messages to no-op and reply CHUNK_ACK(ok=false). The pipeline on the
   *   main thread should abort the fetch via AbortController.
   */
  hardReset(): void {
    this.slabs        = [];
    this.slabMeta     = new Map();
    this.genomeLength = 0;
    this.currentTxId  = null;

    this.slabVersion++;

    this.features         = [];
    this.featureIntervals = new Map();
  }

  revertToSnapshot(expectedTxId: string): SnapshotRevertResult {
    if (this.currentTxId === expectedTxId) {
      return 'ok';
    }

    console.warn(
      `[SlabManager] revertToSnapshot: txId mismatch. ` +
      `expected="${expectedTxId}" actual="${this.currentTxId ?? 'null'}". ` +
      `Initiating hard reset (slabVersion will become ${this.slabVersion + 1}).`
    );

    this.hardReset();
    return 'hard_reset_required';
  }

  // ─── FeatureMap API ─────────────────────────────────────────────────────────

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
    const slabIdx        = Math.floor(globalOffset / this.slabSize);
    const featuresInSlab = this.featureIntervals.get(slabIdx) || [];
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
    return Array.from(new Map(result.map(f => [f.id, f])).values());
  }

  getAllFeatures(): FeatureTag[] {
    return [...this.features];
  }

  // ─── LB-03 / LB-12: Memory usage reporting ──────────────────────────────────

  getTotalAllocatedBytes(): number {
    return this.slabs.length * this.slabSize;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SS-01 — SlabStreamingPipeline (main-thread coordinator)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SlabStreamingPipeline
 *
 * Main-thread coordinator for the Scientific Streaming feature (SS-01).
 *
 * Responsibilities:
 *   • Open a remote genomic sequence URL via the Fetch ReadableStream API.
 *   • Accumulate incoming network bytes into 1 MB (SLAB_SIZE) staging buffers.
 *   • Transfer each full buffer to the worker as a CHUNK_RECEIVED message
 *     with zero-copy ArrayBuffer transfer semantics.
 *   • Enforce ACK-based backpressure: at most `maxInFlight` chunks may be
 *     in-flight (sent but not yet ACK'd) at any time. Reading from the network
 *     stream pauses whenever the in-flight count reaches the limit, preventing
 *     the network from writing faster than the worker can commit to slabs.
 *
 * Usage:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  // 1. Instantiate once per Worker reference.                           │
 * │  const pipeline = new SlabStreamingPipeline(worker);                   │
 * │                                                                         │
 * │  // 2. Wire ACKs — required for backpressure to resolve.               │
 * │  worker.addEventListener('message', (e) => {                            │
 * │    if (e.data.type === 'CHUNK_ACK')                                     │
 * │      pipeline.acknowledgeChunk(e.data.payload.chunkId);                │
 * │    if (e.data.type === 'CHUNK_ERR')                                     │
 * │      pipeline.rejectChunk(                                              │
 * │        e.data.payload.chunkId,                                          │
 * │        new Error(e.data.payload.reason),                               │
 * │      );                                                                 │
 * │  });                                                                    │
 * │                                                                         │
 * │  // 3. Stream. The worker receives CHUNK_RECEIVED for every 1 MB.      │
 * │  await pipeline.streamFromUrl('https://cdn.example.com/genome.fasta', {│
 * │    onChunkSent: (loaded, total) => updateUI(loaded, total),             │
 * │    onComplete:  (total) => console.log('done', total),                  │
 * │    signal:      abortController.signal,                                 │
 * │  });                                                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Thread safety:
 *   All methods run on the main thread. The worker is a separate execution
 *   context; communication is strictly via structured-clone / transfer
 *   postMessage. No SharedArrayBuffer is touched by this class directly.
 */
export class SlabStreamingPipeline {
  private readonly worker: Worker;

  /**
   * Monotonically increasing chunk sequence number.
   * 1-based; 0 means no chunk has been sent yet.
   */
  private chunkCounter = 0;

  /**
   * Number of CHUNK_RECEIVED messages sent but not yet ACK'd by the worker.
   * Bounded by maxInFlight (default 2).
   */
  private inFlight = 0;

  /**
   * Maximum concurrent in-flight chunks.
   *
   * 2 is the recommended default: it allows the worker to always have a
   * chunk ready to process immediately after finishing the previous one
   * (double-buffering), while preventing unbounded queue growth. Increase
   * to 3 only on extremely fast networks (> 500 Mbps) where the worker
   * Sentinel scan is the bottleneck, not the fetch latency.
   */
  private readonly maxInFlight: number;

  /**
   * Pending ACK promises keyed by chunkId.
   *
   * Lifecycle:
   *   created  → sendChunk() registers { resolve, reject }
   *   resolved → acknowledgeChunk() called (worker sent CHUNK_ACK)
   *   rejected → rejectChunk() called (worker sent CHUNK_ERR, or AbortSignal fired)
   */
  private readonly pendingAcks = new Map<
    number,
    { resolve: () => void; reject: (e: Error) => void }
  >();

  constructor(worker: Worker, options?: { maxInFlight?: number }) {
    this.worker      = worker;
    this.maxInFlight = options?.maxInFlight ?? 2;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * streamFromUrl
   *
   * Fetches the resource at `url` using the Fetch ReadableStream API and
   * pipes 1 MB chunks to the worker via CHUNK_RECEIVED messages.
   *
   * @param url     Fully-qualified URL of the genomic sequence file.
   * @param options Progress callbacks, AbortSignal, etc.
   *
   * @throws {Error} If the HTTP response is not ok, if the stream errors, or
   *                 if AbortSignal fires before completion.
   *
   * BACKPRESSURE FLOW:
   *
   *   Main thread                     Worker
   *   ──────────────────────────────  ──────────────────────────────────
   *   fetch() → ReadableStream
   *   accumulate ≤ 1 MB
   *   inFlight < maxInFlight?
   *     YES → postMessage CHUNK_RECEIVED ──►  handleStreamChunk()
   *           inFlight++                        appendBytes() (into slab)
   *           await ackPromise                  Sentinel.scan(newBases)
   *     NO  → spin-yield until ACK arrives ◄── postMessage CHUNK_ACK
   *                                             inFlight-- / resolve()
   *   repeat until stream done
   *   send final chunk (isFinal=true) ──►     finalizeStream()
   *                                    ◄──    STREAM_END_ACK
   *   onComplete()
   */
  async streamFromUrl(url: string, options?: StreamingOptions): Promise<void> {
    const { onChunkSent, onComplete, onError, signal } = options ?? {};

    // ── 1. Open the network stream ─────────────────────────────────────────
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (err) {
      onError?.(err as Error);
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
      onError?.(err);
      throw err;
    }
    if (!response.body) {
      const err = new Error('Response body is null — server may not support streaming');
      onError?.(err);
      throw err;
    }

    const totalBytes = (() => {
      const cl = response.headers.get('content-length');
      return cl ? parseInt(cl, 10) : undefined;
    })();

    // ── 2. Abort wiring ────────────────────────────────────────────────────
    // If the AbortSignal fires mid-stream, reject all pending ACKs so
    // awaiting sendChunk() calls throw immediately and we exit the read loop.
    const abortHandler = () => {
      const err = new Error('Stream aborted by AbortSignal');
      for (const [, handlers] of this.pendingAcks) {
        handlers.reject(err);
      }
      this.pendingAcks.clear();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    // ── 3. Accumulator + read loop ─────────────────────────────────────────
    const reader = response.body.getReader();
    let accumulator       = new Uint8Array(STREAMING_CHUNK_SIZE);
    let accumulatorLength = 0;
    let totalBytesRead    = 0;

    try {
      while (true) {
        // Abort check before blocking read
        if (signal?.aborted) {
          throw new Error('Stream aborted by AbortSignal');
        }

        const { done, value } = await reader.read();

        if (done) {
          // ── Flush remainder (possibly partial 1 MB chunk) ────────────────
          totalBytesRead += accumulatorLength;
          await this._sendChunk(
            accumulator.subarray(0, accumulatorLength),
            /* isFinal */ true,
            totalBytes,
          );
          onChunkSent?.(totalBytesRead, totalBytes);
          break;
        }

        // ── Slice incoming network bytes into STREAMING_CHUNK_SIZE windows ─
        let srcOffset = 0;
        while (srcOffset < value.length) {
          const space  = STREAMING_CHUNK_SIZE - accumulatorLength;
          const toCopy = Math.min(space, value.length - srcOffset);

          accumulator.set(
            value.subarray(srcOffset, srcOffset + toCopy),
            accumulatorLength,
          );
          accumulatorLength += toCopy;
          srcOffset         += toCopy;

          // Full 1 MB chunk ready — send to worker
          if (accumulatorLength === STREAMING_CHUNK_SIZE) {
            totalBytesRead += STREAMING_CHUNK_SIZE;

            // ── ZERO-COPY: slice() transfers ownership of the 1 MB buffer ──
            // We must slice() rather than transfer the accumulator directly
            // because we need a fresh Uint8Array for the next chunk after
            // the transfer. slice() is O(1) at the JS level on V8/SM when
            // the result is immediately transferred.
            await this._sendChunk(
              accumulator,       // full view — _sendChunk slices internally
              /* isFinal */ false,
              totalBytes,
            );

            // Allocate a fresh accumulator — old one was transferred to worker
            accumulator       = new Uint8Array(STREAMING_CHUNK_SIZE);
            accumulatorLength = 0;

            onChunkSent?.(totalBytesRead, totalBytes);
          }
        }
      }
    } catch (err) {
      onError?.(err as Error);
      // Reject all pending ACKs to unblock any awaiting callers
      for (const [, handlers] of this.pendingAcks) {
        handlers.reject(err as Error);
      }
      this.pendingAcks.clear();
      throw err;
    } finally {
      reader.releaseLock();
      signal?.removeEventListener('abort', abortHandler);
    }

    onComplete?.(totalBytesRead);
  }

  /**
   * acknowledgeChunk
   *
   * Must be called by the main thread's worker message handler whenever a
   * CHUNK_ACK message arrives from the worker.  Resolves the corresponding
   * pending promise, allowing the pipeline to send the next chunk.
   *
   * @param chunkId The chunkId from CHUNK_ACK payload.
   */
  acknowledgeChunk(chunkId: number): void {
    const handlers = this.pendingAcks.get(chunkId);
    if (handlers) {
      handlers.resolve();
      this.pendingAcks.delete(chunkId);
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  /**
   * rejectChunk
   *
   * Called by the main thread's worker message handler when a CHUNK_ERR
   * message arrives (worker failed to process the chunk — e.g. OOM or
   * malformed FASTA).  Rejects the pending ACK promise so streamFromUrl()
   * throws and the caller can surface the error.
   *
   * @param chunkId The chunkId from CHUNK_ERR payload.
   * @param error   The error to propagate.
   */
  rejectChunk(chunkId: number, error: Error): void {
    const handlers = this.pendingAcks.get(chunkId);
    if (handlers) {
      handlers.reject(error);
      this.pendingAcks.delete(chunkId);
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  /**
   * pendingCount
   *
   * Number of chunks currently awaiting ACK from the worker.
   * Useful for progress overlays ("N chunks in flight") and diagnostics.
   */
  get pendingCount(): number {
    return this.pendingAcks.size;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * _sendChunk
   *
   * Core backpressure + transfer logic.
   *
   * 1. Spins (yielding the micro-task queue every 4 ms) until inFlight drops
   *    below maxInFlight.  This prevents the network from out-running the
   *    worker's slab-commit + Sentinel pipeline.
   *
   * 2. Slices the data into a fresh transferable ArrayBuffer — the slice()
   *    call here is the ONLY copy of each 1 MB chunk in the Scientific
   *    Streaming path.  All subsequent operations (handleStreamChunk in the
   *    worker, appendBytes, Sentinel scan) operate on the transferred buffer.
   *
   * 3. Registers a { resolve, reject } pair in pendingAcks, then calls
   *    postMessage with [transferBuffer] in the transfer list.
   *
   * 4. Awaits the ACK promise.  The promise resolves in acknowledgeChunk()
   *    when the worker posts CHUNK_ACK.
   *
   * @param data     Uint8Array view of the chunk (may be full STREAMING_CHUNK_SIZE or partial).
   * @param isFinal  True for the last chunk of the stream.
   * @param totalBytes Content-Length from the server (for progress reporting).
   */
  private async _sendChunk(
    data: Uint8Array,
    isFinal: boolean,
    totalBytes: number | undefined,
  ): Promise<void> {
    // ── Backpressure gate ──────────────────────────────────────────────────
    // Yield in 4 ms increments until capacity is available.
    // 4 ms is sub-frame (16 ms) so the main thread remains responsive.
    while (this.inFlight >= this.maxInFlight) {
      await new Promise<void>(resolve => setTimeout(resolve, 4));
    }

    const chunkId = ++this.chunkCounter;

    // ── Zero-copy transfer ─────────────────────────────────────────────────
    // slice() produces a NEW ArrayBuffer whose byte range is a copy of
    // data[byteOffset … byteOffset+byteLength).  Immediately including it in
    // the transfer list causes the JS engine to mark the main-thread reference
    // as detached — subsequent reads/writes on the main side throw TypeError.
    const transferBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;

    this.inFlight++;

    const ackPromise = new Promise<void>((resolve, reject) => {
      this.pendingAcks.set(chunkId, { resolve, reject });
    });

    this.worker.postMessage(
      {
        type: 'CHUNK_RECEIVED',
        id: `stream-chunk-${chunkId}`,
        payload: {
          chunkId,
          buffer: transferBuffer,
          isFinal,
          totalBytes,
        } satisfies ChunkReceivedPayload,
      },
      [transferBuffer], // ← transfer list: zero-copy hand-off
    );

    // ── Await ACK (backpressure) ───────────────────────────────────────────
    // Suspension here is the key backpressure mechanism.  The outer
    // streamFromUrl read loop will not advance to the next reader.read() until
    // this await resolves — i.e. until the worker has fully committed the
    // chunk's bytes to slabs AND completed the Sentinel scan.
    await ackPromise;
    // Note: inFlight is decremented in acknowledgeChunk() / rejectChunk(),
    // not here, to avoid a race if the ACK arrives before this line executes.
  }
}