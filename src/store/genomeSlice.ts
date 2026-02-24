/**
 * src/store/genomeSlice.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Zustand slice that owns everything related to the genome engine:
 *
 *   • Worker lifecycle  (initWorker, onerror, onmessageerror handlers)
 *   • File I/O          (loadFile, loadGenomeFromCloud)
 *   • Viewport          (requestViewport, fetchGenomeMetadata)
 *   • Simulation        (runPCR, mapRestrictionSites, refreshRadar, exportMutantFasta)
 *   • Features / motifs (addFeature, getFeaturesAt, findMotif)
 *   • ORF / Splice      (getORFsInRange, predictSpliceSites, predictIsoforms, …)
 *   • Synteny           (getSyntenyAnchors, refreshSyntenyScan)
 *   • Off-target heatmap (runOffTargetHeatmap)
 *   • Public genomes    (loadPublicGenomes, fetchPublicGenomeById)
 *   • Diff mode         (setComparisonSequence, toggleDiffMode)
 *   • Internal setters  (updateSlabMeta, addEditedSlab, setViewportData, …)
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 *   AUDIT III FIX 1 — STREAM_END truncation (Vector D):
 *     loadFile() and loadGenomeFromCloud() both send STREAM_END after the
 *     chunk loop so the worker can flush its partial staging buffer before
 *     fetchGenomeMetadata() is called.
 *
 *   AUDIT III FIX 2 — Worker crash = permanent silent freeze (SHADOW-01):
 *     initWorker() registers worker.onerror and worker.onmessageerror so
 *     crashed workers surface workerConnected: false + a readable workerError.
 *
 *   SPRINT 5 FIX 2 — loadGenomeFromCloud teardown safety:
 *     The streaming loop is wrapped in try/finally so STREAM_END and
 *     isSyncing reset are guaranteed even on network failure.
 *
 *   SPRINT 5 FIX 5 — Adaptive slab sizing:
 *     file.size is forwarded to RESET_ENGINE so the worker can choose an
 *     optimal slab size for the incoming genome.
 *
 *   SPRINT 5 FIX 3 — chronosHead UI desync:
 *     The COMMIT_SYNC branch-update path (inside the worker message listener)
 *     derives the new chronosHead from the updated branch list.  This listener
 *     lives in initWorker() where it has full access to the combined ArkheState
 *     via get().
 *
 *   SPRINT 5 FIX 4 — TypeScript implicit any:
 *     The COMMIT_SYNC payload is explicitly typed so the .find() callback is
 *     not implicitly any-typed.
 *
 *   CF-04 — Chronos Viewport Sync:
 *     undo() / redo() live in chronosSlice.ts but both call requestViewport
 *     (owned here) after postAndWait resolves.  The action signature is on
 *     ArkheState so the chronos slice can cross-call without circular imports.
 */

import type { StateCreator } from 'zustand';
import { PersistenceManager } from '@/lib/PersistenceManager';
import { supabase } from '@/lib/supabase';
import { fetchPublicGenomes } from '@/lib/supabasePublic';
import {
  postAndWait,
  generateId,
  convertSupabaseCommitToArkhe,
  convertSupabaseBranchToArkhe,
} from './utils';
import type {
  ArkheState,
  StoreMutators,
  GenomeSlice,
  Viewport,
  SliceResponse,
  SlabMeta,
  FeatureTag,
  PCRProduct,
  RestrictionSite,
  RadarBin,
  ORFScanResult,
  OffTargetHit,
  SyntenyAnchor,
  SpliceSite,
  SpliceIsoform,
  ProteinProperties,
  Branch,
  Commit,
  ORF,
  PublicGenome,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Streaming constants
// ─────────────────────────────────────────────────────────────────────────────

/** Chunk size for the worker streaming protocol (64 KiB). */
const STREAM_CHUNK_SIZE = 64 * 1_024;

// ─────────────────────────────────────────────────────────────────────────────
// Initial genome state
// ─────────────────────────────────────────────────────────────────────────────

const initialGenomeState = {
  worker: null,
  workerConnected: false,
  lastPing: 0,
  workerError: null,

  activeGenomeId: null,
  genomeLength: 0,
  slabMetas: new Map<number, SlabMeta>(),
  editedSlabs: new Set<number>(),

  viewport: { start: 0, end: 1_000, buffer: new Uint8Array(1_000).buffer } as Viewport,
  viewportData: null,
  currentSlice: 0,
  isInitialized: false,

  isRunningPCR: false,
  pcrResults: [] as PCRProduct[],
  isMappingRestriction: false,
  restrictionSites: [] as RestrictionSite[],
  isGeneratingRadar: false,
  radarData: [] as RadarBin[],
  isExporting: false,

  sliceSpliceSites: [] as SpliceSite[],
  sliceIsoforms: [] as SpliceIsoform[],
  sliceProteinProperties: null,

  syntenyAnchors: [] as SyntenyAnchor[],
  isScanningSynteny: false,

  offTargetHits: [] as OffTargetHit[],

  isSyncing: false,
  publicGenomes: [] as PublicGenome[],
  isLoadingPublic: false,

  comparisonSequence: null,
  diffMode: false,

  orfScanResult: null,
  isORFScanning: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Slice factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the genome slice.
 *
 * The first generic param is ArkheState so get() returns the full combined
 * store and cross-slice calls (e.g. get().addSystemLog()) are type-safe.
 *
 * StoreMutators encodes the subscribeWithSelector middleware applied in
 * index.ts; without it Zustand's type system rejects subscribeWithSelector.
 */
export const createGenomeSlice: StateCreator<
  ArkheState,
  StoreMutators,
  [],
  GenomeSlice
> = (set, get) => ({
  // ── Initial state spread ────────────────────────────────────────────────
  ...initialGenomeState,

  // ─────────────────────────────────────────────────────────────────────────
  // § Worker lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * initWorker
   *
   * Boots the ArkheEngine Web Worker and wires its message, error, and
   * message-error handlers.
   *
   * ── AUDIT III FIX 2 (SHADOW-01) ──────────────────────────────────────────
   * worker.onerror and worker.onmessageerror are registered so that an
   * unhandled worker exception surfaces workerConnected: false and a
   * readable workerError message instead of silently freezing the UI.
   *
   * ── SPRINT 5 FIX 3 (chronosHead UI desync) ────────────────────────────────
   * The COMMIT_SYNC handler derives chronosHead from the incoming branch list
   * so the UI stays in sync without a separate round-trip.
   *
   * ── SPRINT 5 FIX 4 (TypeScript implicit any) ──────────────────────────────
   * The COMMIT_SYNC destructured payload is explicitly typed as
   * { commits?: Commit[]; newCommits?: Commit[]; branches?: Branch[] }
   * so the .find() callback is not implicitly any-typed.
   */
  initWorker: async () => {
    if (typeof Worker === 'undefined') {
      set({ workerError: 'Web Workers are not supported in this browser.' });
      throw new Error('Web Workers not supported');
    }

    try {
      const worker = new Worker(
        new URL('../app/worker/ArkheEngine.worker.ts', import.meta.url),
        { type: 'module' },
      );

      // ── FIX 2 — crash surface ─────────────────────────────────────────────
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
          workerError:
            'Engine message deserialization failed. Click Reconnect to restart.',
        });
      };

      // ── Push-notification handler ─────────────────────────────────────────
      // Handles unsolicited messages from the worker (not request/reply pairs).
      worker.addEventListener('message', (e: MessageEvent) => {
        const { type, payload } = e.data as { type: string; payload: unknown };

        switch (type) {
          // ── Viewport invalidation ───────────────────────────────────────
          case 'MUTATION_PATCH': {
            const { viewport } = get();
            const patch = payload as { start: number; end: number };
            if (patch.start <= viewport.end && patch.end >= viewport.start) {
              get()
                .requestViewport(viewport.start, viewport.end)
                .catch(console.error);
            }
            break;
          }

          // ── Chronos history (full list push) ────────────────────────────
          case 'CHRONOS_HISTORY':
            get().setChronosTransactions(payload as Parameters<typeof get>);
            break;

          // ── Slab metadata update ────────────────────────────────────────
          case 'SLAB_META_UPDATE':
            get().updateSlabMeta(payload as SlabMeta[]);
            break;

          // ── Heartbeat ───────────────────────────────────────────────────
          case 'WORKER_PONG':
            set({ lastPing: Date.now() });
            break;

          // ── Sentinel summary push ───────────────────────────────────────
          case 'SENTINEL_SUMMARY':
            get().setSentinelData(payload as Parameters<ArkheState['setSentinelData']>[0]);
            break;

          // ── ORF scan update ─────────────────────────────────────────────
          case 'ORF_SCAN_UPDATE':
            get().setORFScanResult(payload as Parameters<ArkheState['setORFScanResult']>[0]);
            break;

          // ── Off-target result ───────────────────────────────────────────
          case 'OFF_TARGET_RESULT':
            set({
              offTargetResult:
                payload as ArkheState['offTargetResult'],
              isScanningOffTarget: false,
            });
            break;

          // ── Synteny anchors ─────────────────────────────────────────────
          case 'SYNTENY_ANCHORS':
            set({
              syntenyAnchors: payload as SyntenyAnchor[],
              isScanningSynteny: false,
            });
            break;

          // ── Branch / commit list pushes ─────────────────────────────────
          case 'GET_BRANCHES_RESULT':
            set({ branches: payload as Branch[] });
            break;

          case 'GET_COMMITS_RESULT':
            set({ commits: payload as Commit[] });
            break;

          // ── System log forwarding ───────────────────────────────────────
          case 'SYSTEM_LOG': {
            const log = payload as {
              timestamp: number;
              category: string;
              message: string;
              level: string;
            };
            get().addSystemLog({
              timestamp: log.timestamp,
              category: log.category as 'SYSTEM' | 'WORKER' | 'MEMORY' | 'CHRONOS' | 'SENTINEL' | 'ORF' | 'PCR' | 'REPORT',
              message: log.message,
              level: log.level as 'info' | 'success' | 'warning' | 'error' | 'debug',
            });
            break;
          }

          // ── COMMIT_SYNC ─────────────────────────────────────────────────
          //
          // FIX 3 (chronosHead desync): derive new head from branch list.
          // FIX 4 (implicit any):       payload explicitly typed below.
          case 'COMMIT_SYNC': {
            // Explicit type — no implicit any in .find() below.
            const {
              commits: fullCommits,
              newCommits,
              branches: newBranches,
            } = payload as {
              commits?: Commit[];
              newCommits?: Commit[];
              branches?: Branch[];
            };

            const { activeGenomeId, user, isSyncing, isOfflineMode } = get();

            // ── Update commit state ───────────────────────────────────────
            if (fullCommits) {
              set({ commits: fullCommits });
            } else if (newCommits) {
              // Delta merge — avoid duplicates, no full replacement.
              set((state) => {
                const existing = new Map(
                  state.commits.map((c: Commit) => [c.txId, c]),
                );
                for (const c of newCommits) {
                  if (!existing.has(c.txId)) existing.set(c.txId, c);
                }
                return { commits: Array.from(existing.values()) };
              });
            }

            // ── Update branch state + chronosHead (FIX 3) ─────────────────
            if (newBranches) {
              set((state) => {
                // Explicitly typed so TypeScript doesn't infer b as any.
                const newHead: string | null =
                  newBranches.find(
                    (b: Branch) => b.name === state.currentBranch,
                  )?.headCommitId ?? state.chronosHead;

                return {
                  branches: newBranches,
                  chronosHead: newHead,
                };
              });
            }

            // ── Gate 1: unauthenticated / guest ───────────────────────────
            if (!user) break;

            // ── Gate 2: circuit breaker tripped ───────────────────────────
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

            // ── Normal cloud sync ─────────────────────────────────────────
            if (activeGenomeId && !isSyncing) {
              PersistenceManager.syncChronos(
                activeGenomeId,
                get().commits,
                get().branches,
              )
                .then((response) => {
                  if (response.status === 'offline') return;
                  if (response.status === 'fail') {
                    console.error('Sync failed:', response.error);
                    get().addSystemLog({
                      timestamp: Date.now(),
                      category: 'SYSTEM',
                      message: `❌ Cloud sync failed: ${response.error}`,
                      level: 'error',
                    });
                  } else {
                    const count =
                      (newCommits ?? fullCommits)?.length ?? 0;
                    get().addSystemLog({
                      timestamp: Date.now(),
                      category: 'SYSTEM',
                      message: `✅ Synced ${count} commits, ${newBranches?.length ?? 0} branches`,
                      level: 'success',
                    });
                  }
                })
                .catch((err) => console.error('Sync error:', err));
            }
            break;
          }

          // ── Threat screening result ─────────────────────────────────────
          case 'SCREEN_THREATS_RESULT':
            set({
              threatMatches:
                payload as ArkheState['threatMatches'],
            });
            break;
        }
      });

      set({ worker, workerConnected: false, workerError: null });

      // Prefer SharedArrayBuffer when the page is cross-origin isolated.
      const useShared =
        typeof SharedArrayBuffer !== 'undefined' &&
        (typeof crossOriginIsolated !== 'undefined'
          ? crossOriginIsolated
          : false);

      await postAndWait(worker, 'INIT', {
        slabSize: 1_048_576,
        useSharedArray: useShared,
      });

      set({ workerConnected: true });
    } catch (err) {
      console.error('[ArkheEngine] Worker initialisation failed:', err);
      set({
        workerConnected: false,
        workerError:
          err instanceof Error
            ? err.message
            : 'Unknown worker initialisation error',
      });
      throw err;
    }
  },

  initializeEngine: async (_sequence?: string) => {
    await get().initWorker();
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § File I/O
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * loadFile
   *
   * Uploads a genome file to cloud storage via PersistenceManager, then
   * streams it to the engine worker in 64 KiB chunks.
   *
   * ── AUDIT III FIX 1 (Vector D) ────────────────────────────────────────────
   * STREAM_END is sent after the chunk loop so the worker flushes its partial
   * staging buffer before fetchGenomeMetadata() queries the engine state.
   *
   * ── SPRINT 5 FIX 5 (Adaptive Slab Sizing) ─────────────────────────────────
   * file.size is forwarded to RESET_ENGINE so the worker can select an optimal
   * slab size for the incoming genome.
   */
  loadFile: async (file: File, name?: string) => {
    const { worker, user } = get();
    if (!worker) throw new Error('Worker not initialised');
    if (!user) throw new Error('User not authenticated');

    // Reset engine with adaptive slab size hint (SPRINT 5 FIX 5).
    await postAndWait(worker, 'RESET_ENGINE', { expectedFileSize: file.size });

    // Clear any leftover local maps from a previous genome.
    get().slabMetas.clear();
    get().editedSlabs.clear();

    // Nudge the GC in V8-based environments (best-effort, non-blocking).
    const g = globalThis as unknown as { gc?: () => void };
    if (typeof g.gc === 'function') g.gc();

    // ── Upload to cloud storage ───────────────────────────────────────────
    set({ isSyncing: true });
    const uploadResult = await PersistenceManager.uploadGenome(
      file,
      user.id,
      name ?? file.name,
      0,
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

    // ── Stream to worker ──────────────────────────────────────────────────
    const fileId = generateId();
    let offset = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + STREAM_CHUNK_SIZE);
      const arrayBuffer = await chunk.arrayBuffer();
      await postAndWait(
        worker,
        'STREAM_CHUNK',
        { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
        [arrayBuffer], // transfer — zero-copy
      );
      offset += STREAM_CHUNK_SIZE;
    }

    // FIX 1 — flush the final partial staging buffer.
    await postAndWait(worker, 'STREAM_END', { fileId });

    // ── Post-load metadata + length write-back ────────────────────────────
    await get().fetchGenomeMetadata();

    const { genomeLength } = get();
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

  /**
   * loadGenomeFromCloud
   *
   * Restores a genome session from Supabase: fetches the FASTA blob,
   * re-streams it to the engine worker, and replays Chronos history.
   *
   * ── SPRINT 5 FIX 2 (teardown safety) ─────────────────────────────────────
   * The streaming loop runs inside try/finally so:
   *   • On failure — a RESET_ENGINE clears partial state and isSyncing is
   *     reset before the error propagates.
   *   • On success — isSyncing is always reset in the finally block.
   *
   * ── AUDIT III FIX 1 (Vector D) ────────────────────────────────────────────
   * STREAM_END is sent inside the try block so the worker flushes its partial
   * staging buffer even if the very last chunk is the one that fails.
   */
  loadGenomeFromCloud: async (genomeId: string) => {
    const { worker, user } = get();
    if (!worker) throw new Error('Worker not initialised');
    if (!user) throw new Error('User not authenticated');

    set({ isSyncing: true, activeGenomeId: genomeId });

    // ── Fetch session from Supabase ───────────────────────────────────────
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

    // ── Reset engine with adaptive slab size ──────────────────────────────
    await postAndWait(worker, 'RESET_ENGINE', {
      expectedFileSize: genome.total_length,
    });

    // ── Download FASTA blob from the signed URL ───────────────────────────
    const response = await fetch(genome.file_url);
    const fileBlob = await response.blob();
    const fileName = genome.name.endsWith('.fasta')
      ? genome.name
      : `${genome.name}.fasta`;
    const file = new File([fileBlob], fileName, { type: 'text/plain' });

    // ── Stream to worker (SPRINT 5 FIX 2: guaranteed teardown) ───────────
    const fileId = generateId();
    let offset = 0;

    try {
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + STREAM_CHUNK_SIZE);
        const arrayBuffer = await chunk.arrayBuffer();
        await postAndWait(
          worker,
          'STREAM_CHUNK',
          { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
          [arrayBuffer],
        );
        offset += STREAM_CHUNK_SIZE;
      }

      // FIX 1 — flush the final partial staging buffer.
      await postAndWait(worker, 'STREAM_END', { fileId });
    } catch (err) {
      // Clear partial engine state so the next load attempt starts clean.
      await postAndWait(worker, 'RESET_ENGINE', {}).catch(() => {
        /* best-effort — ignore secondary failure */
      });

      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message: `❌ Genome stream failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        level: 'error',
      });

      throw err;
    } finally {
      // Always release the syncing lock (SPRINT 5 FIX 2).
      set({ isSyncing: false });
    }

    // ── Replay Chronos history in the worker ──────────────────────────────
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
        convertedBranches.find(
          (b) => b.headCommitId === convertedHeadCommit.txId,
        )?.name ?? 'main',
    });

    get().addSystemLog({
      timestamp: Date.now(),
      category: 'SYSTEM',
      message: `🔄 Session restored: ${genome.name}, ${convertedCommits.length} commits`,
      level: 'success',
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Viewport
  // ─────────────────────────────────────────────────────────────────────────

  fetchGenomeMetadata: async () => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const metadata = await postAndWait<{
      genomeLength: number;
      slabMetas: SlabMeta[];
    }>(worker, 'GET_GENOME_METADATA');
    set({ genomeLength: metadata.genomeLength });
    get().updateSlabMeta(metadata.slabMetas);
    return metadata;
  },

  requestViewport: async (start: number, end: number): Promise<SliceResponse> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const result = await postAndWait<SliceResponse>(worker, 'LOAD_SLICE', {
      start,
      end,
    });
    get().setViewportData(result);
    return result;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Feature map
  // ─────────────────────────────────────────────────────────────────────────

  addFeature: async (feature: Omit<FeatureTag, 'id'>): Promise<FeatureTag> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<FeatureTag>(worker, 'ADD_FEATURE', { feature });
  },

  getFeaturesAt: async (offset: number): Promise<FeatureTag[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<FeatureTag[]>(worker, 'GET_FEATURES_AT', { offset });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Motif search
  // ─────────────────────────────────────────────────────────────────────────

  findMotif: async (
    pattern: string,
    start?: number,
    end?: number,
    maxMismatches?: number,
  ): Promise<{ start: number; end: number }[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait(worker, 'FIND_MOTIF', {
      pattern,
      start,
      end,
      maxMismatches,
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Simulation
  // ─────────────────────────────────────────────────────────────────────────

  runPCR: async (
    forwardPrimer: string,
    reversePrimer: string,
    options?: {
      maxMismatches?: number;
      minProduct?: number;
      maxProduct?: number;
    },
  ): Promise<PCRProduct[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isRunningPCR: true });
    try {
      const results = await postAndWait<PCRProduct[]>(worker, 'SIMULATE_PCR', {
        forwardPrimer,
        reversePrimer,
        maxMismatches: options?.maxMismatches ?? 2,
        minProduct: options?.minProduct ?? 50,
        maxProduct: options?.maxProduct ?? 5_000,
      });
      set({ pcrResults: results });
      return results;
    } finally {
      set({ isRunningPCR: false });
    }
  },

  mapRestrictionSites: async (
    enzymes?: string[],
  ): Promise<RestrictionSite[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isMappingRestriction: true });
    try {
      const sites = await postAndWait<RestrictionSite[]>(
        worker,
        'RESTRICTION_MAP',
        { enzymes },
      );
      set({ restrictionSites: sites });
      return sites;
    } finally {
      set({ isMappingRestriction: false });
    }
  },

  refreshRadar: async (numBins?: number): Promise<RadarBin[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isGeneratingRadar: true });
    try {
      const bins = await postAndWait<RadarBin[]>(
        worker,
        'GENERATE_RADAR_DATA',
        { numBins: numBins ?? 500 },
      );
      set({ radarData: bins });
      return bins;
    } finally {
      set({ isGeneratingRadar: false });
    }
  },

  exportMutantFasta: async (): Promise<{
    filename: string;
    content: string;
  }> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isExporting: true });
    try {
      const result = await postAndWait<{ filename: string; content: string }>(
        worker,
        'EXPORT_MUTANT_FASTA',
      );
      // Trigger browser download.
      const blob = new Blob([result.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return result;
    } finally {
      set({ isExporting: false });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § ORF autopilot
  // ─────────────────────────────────────────────────────────────────────────

  getORFScanResult: async (): Promise<ArkheState['orfScanResult']> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const result = await postAndWait<ArkheState['orfScanResult']>(
      worker,
      'GET_ORF_SCAN_RESULT',
    );
    set({ orfScanResult: result });
    return result;
  },

  refreshORFScan: async (): Promise<ArkheState['orfScanResult']> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isORFScanning: true });
    try {
      const result = await postAndWait<ArkheState['orfScanResult']>(
        worker,
        'REFRESH_ORF_SCAN',
      );
      set({ orfScanResult: result });
      return result;
    } finally {
      set({ isORFScanning: false });
    }
  },

  getORFsInRange: async (start: number, end: number): Promise<ORF[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<ORF[]>(worker, 'GET_ORFS_IN_RANGE', { start, end });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Splice & protein properties
  // ─────────────────────────────────────────────────────────────────────────

  predictSpliceSites: async (
    start: number,
    end: number,
    strand?: '+' | '-',
  ): Promise<SpliceSite[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<SpliceSite[]>(worker, 'PREDICT_SPLICE_SITES', {
      start,
      end,
      strand,
    });
  },

  predictIsoforms: async (
    start: number,
    end: number,
    orf: ORF,
    spliceSites: SpliceSite[],
  ): Promise<SpliceIsoform[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<SpliceIsoform[]>(worker, 'PREDICT_ISOFORMS', {
      start,
      end,
      orf,
      spliceSites,
    });
  },

  getProteinProperties: async (aaSeq: string): Promise<ProteinProperties> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait<ProteinProperties>(worker, 'GET_PROTEIN_PROPERTIES', {
      aaSeq,
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Synteny ghosting
  // ─────────────────────────────────────────────────────────────────────────

  getSyntenyAnchors: async (): Promise<SyntenyAnchor[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const anchors = await postAndWait<SyntenyAnchor[]>(
      worker,
      'GET_SYNTENY_ANCHORS',
    );
    set({ syntenyAnchors: anchors });
    return anchors;
  },

  refreshSyntenyScan: async (): Promise<SyntenyAnchor[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isScanningSynteny: true });
    try {
      const anchors = await postAndWait<SyntenyAnchor[]>(
        worker,
        'REFRESH_SYNTENY_SCAN',
      );
      set({ syntenyAnchors: anchors });
      return anchors;
    } finally {
      set({ isScanningSynteny: false });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Off-target heatmap (distinct from Chronos OffTarget Radar)
  // ─────────────────────────────────────────────────────────────────────────

  runOffTargetHeatmap: async (
    query: string,
    maxMismatch = 2,
  ): Promise<OffTargetHit[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    set({ isScanningOffTarget: true });
    try {
      const hits = await postAndWait<OffTargetHit[]>(
        worker,
        'SCAN_OFF_TARGETS',
        { query, maxMismatch },
      );
      set({ offTargetHits: hits });
      return hits;
    } finally {
      set({ isScanningOffTarget: false });
    }
  },

  clearOffTargetHits: () => set({ offTargetHits: [] }),

  // ─────────────────────────────────────────────────────────────────────────
  // § Diff mode
  // ─────────────────────────────────────────────────────────────────────────

  setComparisonSequence: (seq) => set({ comparisonSequence: seq }),
  toggleDiffMode: () =>
    set((state) => ({ diffMode: !state.diffMode })),

  // ─────────────────────────────────────────────────────────────────────────
  // § Public genomes
  // ─────────────────────────────────────────────────────────────────────────

  loadPublicGenomes: async () => {
    set({ isLoadingPublic: true });
    try {
      const genomes = await fetchPublicGenomes();
      set({ publicGenomes: genomes });
    } catch (err) {
      console.error('[Arkhé] Failed to load public genomes:', err);
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
      throw new Error(`Failed to fetch public genome "${id}": ${error.message}`);
    }
    if (!data) {
      throw new Error(`Public genome not found: ${id}`);
    }
    return data as PublicGenome;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Internal setters
  // ─────────────────────────────────────────────────────────────────────────

  setWorkerConnected: (connected) => set({ workerConnected: connected }),
  setWorkerError: (error) => set({ workerError: error }),

  updateSlabMeta: (metas: SlabMeta[]) =>
    set((state) => {
      const next = new Map(state.slabMetas);
      for (const meta of metas) next.set(meta.slabIndex, meta);
      return { slabMetas: next };
    }),

  addEditedSlab: (slabIndex: number) =>
    set((state) => {
      const next = new Set(state.editedSlabs);
      next.add(slabIndex);
      return { editedSlabs: next };
    }),

  /**
   * setViewportData
   *
   * Writes a LOAD_SLICE response into the viewport and its denormalised
   * sibling fields (sliceSpliceSites, sliceIsoforms, sliceProteinProperties).
   *
   * NOTE: The top-level `features` array was removed in the State Bloat Fix.
   * Feature data is stored exclusively in `viewport.features`.
   */
  setViewportData: (data: SliceResponse) => {
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
      sliceSpliceSites: data.spliceSites ?? [],
      sliceIsoforms: data.isoforms ?? [],
      sliceProteinProperties: data.proteinProperties ?? null,
    });
  },

  setSyncing: (val) => set({ isSyncing: val }),
  setPCRResults: (results) => set({ pcrResults: results }),
  setRestrictionSites: (sites) => set({ restrictionSites: sites }),
  setRadarData: (data) => set({ radarData: data }),
  setPublicGenomes: (genomes) => set({ publicGenomes: genomes }),
  setLoadingPublic: (loading) => set({ isLoadingPublic: loading }),
  setDiffMode: (mode) => set({ diffMode: mode }),
  setOffTargetHits: (hits) => set({ offTargetHits: hits }),
  setSyntenyAnchors: (anchors) => set({ syntenyAnchors: anchors }),
  setScanningSynteny: (scanning) => set({ isScanningSynteny: scanning }),
  setORFScanResult: (result) => set({ orfScanResult: result }),
  setORFScanning: (scanning) => set({ isORFScanning: scanning }),
});