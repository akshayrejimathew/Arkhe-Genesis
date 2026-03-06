/**
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
 * ── NEW FIX (FR-01) — Frozen Recovery: COMMIT_SYNC Slab Verification ─────────
 *
 *   PROBLEM:
 *     When a cloud sync completes (COMMIT_SYNC), the Zustand store's
 *     `chronosHead` and the Supabase branches agree on the authoritative HEAD
 *     commit. However the worker's SlabManager may hold dirty physical bytes
 *     from local mutations that were never synced — or a race between an
 *     in-flight undo and the COMMIT_SYNC push may have left the slabs at a
 *     stale txId. The UI renders data from the slabs, not from Supabase, so
 *     the user sees incorrect sequence even though the cloud is correct.
 *
 *   FIX — THREE-PHASE RECOVERY:
 *
 *     Phase 1 — Verification (fire-and-forget after sync success):
 *       After a successful cloud sync we immediately call
 *       `postAndWait(worker, 'VERIFY_SLAB_STATE', { expectedTxId })`.
 *       The worker calls `slabManager.revertToSnapshot(expectedTxId)` and
 *       replies with `{ status, slabVersion }`.
 *
 *     Phase 2 — Detection:
 *       If status === 'hard_reset_required', the worker's SlabManager has
 *       already wiped all slab allocations and incremented its internal
 *       slabVersion. We mirror that in the Zustand store:
 *         set({ isRealigning: true, slabVersion: newSlabVersion })
 *
 *     Phase 3 — Recovery:
 *       We call `loadGenomeFromCloud(activeGenomeId)`, which re-downloads the
 *       FASTA, re-streams it to the worker, and replays the full Chronos
 *       history. When complete we set `isRealigning: false` and the
 *       `setViewportData` call inside requestViewport bumps
 *       `slabAcknowledgedVersion` to match `slabVersion`, clearing the
 *       SequenceView guard overlay.
 *
 *   TYPES.TS NOTE:
 *     This fix adds three fields to GenomeState. Update
 *     src/store/types.ts > GenomeState with:
 *
 *       isRealigning: boolean;
 *       slabVersion: number;
 *       slabAcknowledgedVersion: number;
 *
 *     And to GenomeActions:
 *       setIsRealigning: (realigning: boolean) => void;
 *
 * ── PREVIOUS FIXES (2026-02-25) ──────────────────────────────────────────────
 *
 *   LB-04 — Zombie `chronosHead` in COMMIT_SYNC: 3-tier branch fallback.
 *   LB-09 — Direct state mutation in `loadFile`: fresh Map/Set via set().
 *   SPRINT 2 FIX — Race-condition lock: `isProcessing` flag on loadFile / loadGenomeFromCloud.
 *   LB-10 — Meaningless type cast in CHRONOS_HISTORY: TransactionSummary[].
 *   LB-11 / LB-14 — Ghost Data & Detached ArrayBuffers: viewportVersion.
 *   TS COMPILER FIX — StoreMutators inlined as middleware tuple.
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 *   AUDIT III FIX 1 — STREAM_END truncation (Vector D).
 *   AUDIT III FIX 2 — Worker crash = permanent silent freeze (SHADOW-01).
 *   SPRINT 5 FIX 2 — loadGenomeFromCloud teardown safety.
 *   SPRINT 5 FIX 3 — chronosHead UI desync (COMMIT_SYNC derivation).
 *   SPRINT 5 FIX 4 — TypeScript implicit any in COMMIT_SYNC.
 *   SPRINT 5 FIX 5 — Adaptive slab sizing.
 *   CF-04 — Chronos Viewport Sync (undo/redo requestViewport call).
 *
 * ── PINNACLE RUO STATE INTEGRITY PATCH ───────────────────────────────────────
 *
 *   MEM-01 (CRITICAL) — try/finally guard on loadGenomeFromCloud
 *     The original code set isProcessing: true on entry and released it only
 *     on success.  Any failure path (Supabase RLS error, network timeout,
 *     worker stream failure) left isProcessing permanently true, silently
 *     bricking all subsequent load operations until a full-page reload.
 *     The `set({ isProcessing: false })` call is now unconditionally in a
 *     finally block on every async path that acquires the lock.
 *
 *   MEM-01b — try/finally guard on loadFile
 *     Same permanent-lock pattern existed in loadFile.  The existing finally
 *     block is preserved and supplemented with activeGenomeId reset on failure.
 *
 *   SI-01 — 45-second safety watchdog on all lock-acquiring operations
 *     A clearable setTimeout is armed whenever isProcessing is acquired.  If
 *     the worker does not respond within 45 seconds (network stall, worker
 *     crash bypass), the watchdog fires: releases isProcessing, resets
 *     activeGenomeId to null, and writes a SYSTEM ERROR to the SystemLog.
 *     The watchdog is cleared immediately on normal completion (in finally).
 *
 *   SI-02 — activeGenomeId reset to null on load failure
 *     Previously a failed loadGenomeFromCloud left activeGenomeId set to the
 *     attempted genome ID, causing the viewport and SequenceView to attempt
 *     rendering against an empty / partially-loaded worker state.  On failure
 *     activeGenomeId is now reset to null via the failure-path finally block.
 *
 *   MEM-02 (HIGH) — Atomic race guard in loadGenomeFromCloud
 *     The original isProcessing + isRealigning guard read state via two
 *     separate get() calls.  A Zustand set() between microtask boundaries
 *     could produce a torn read.  Fixed by capturing both flags from a single
 *     const { isProcessing, isRealigning } = get() snapshot.
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
  TransactionSummary,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Streaming constants
// ─────────────────────────────────────────────────────────────────────────────

/** Chunk size for the worker streaming protocol (64 KiB). */
const STREAM_CHUNK_SIZE = 64 * 1_024;

// ─────────────────────────────────────────────────────────────────────────────
// FR-01: VERIFY_SLAB_STATE response type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response payload returned by the worker for a VERIFY_SLAB_STATE message.
 * The worker calls slabManager.revertToSnapshot(expectedTxId) and returns
 * the result together with the (potentially updated) slabVersion.
 */
interface VerifySlabStateResponse {
  /** Whether the slabs matched the expected txId, or were hard-reset. */
  status: 'ok' | 'hard_reset_required';
  /**
   * The worker's slabVersion after the check. If status === 'ok' this equals
   * the existing slabVersion. If status === 'hard_reset_required' this is the
   * post-hardReset slabVersion (incremented by 1).
   */
  slabVersion: number;
}

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
  // LB-11/14: Added viewportVersion field
  viewportVersion: 0,
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

  // ── FR-01: Frozen Recovery state fields ─────────────────────────────────────
  //
  // isRealigning         — true while a slab-cloud mismatch has been detected
  //                        and the genome is being re-loaded from cloud storage.
  //                        SequenceView shows the "Re-aligning Memory..." overlay
  //                        whenever this is true OR slabVersion !== slabAcknowledgedVersion.
  //
  // slabVersion          — mirrors SlabManager.slabVersion. Incremented by 1
  //                        each time the worker's SlabManager.hardReset() fires.
  //                        Starts at 0 (no hard reset has ever occurred).
  //
  // slabAcknowledgedVersion — the slabVersion that was current the last time
  //                        setViewportData() successfully committed a fresh
  //                        viewport to the store. When this matches slabVersion
  //                        the UI is displaying data from the correct slab state.
  //                        Diverges from slabVersion in the window between a
  //                        hard reset and the first successful viewport refresh.
  //
  isProcessing: false,
  isRealigning: false,
  slabVersion: 0,
  slabAcknowledgedVersion: 0,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Slice factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TS COMPILER FIX:
 * `StoreMutators` type alias removed — the middleware tuple is inlined directly.
 * This avoids the cascade of "type used as value" errors that occur when
 * StoreMutators cannot be resolved from ./types in this file's module scope.
 * The alias remains valid in src/store/index.ts where it is actually applied.
 */
export const createGenomeSlice: StateCreator<
  ArkheState,
  [['zustand/subscribeWithSelector', never]],
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
   * The COMMIT_SYNC handler derives chronosHead from the incoming branch list.
   *
   * ── SPRINT 5 FIX 4 (TypeScript implicit any) ──────────────────────────────
   * The COMMIT_SYNC destructured payload is explicitly typed.
   *
   * ── LB-04 FIX (Zombie chronosHead) ────────────────────────────────────────
   * COMMIT_SYNC uses a 3-tier branch fallback. See inline comments.
   *
   * ── LB-10 FIX (Meaningless cast in CHRONOS_HISTORY) ──────────────────────
   * `payload as Parameters<typeof get>` → `payload as TransactionSummary[]`.
   *
   * ── FR-01 FIX (Frozen Recovery) ──────────────────────────────────────────
   * COMMIT_SYNC now fires VERIFY_SLAB_STATE after a successful cloud sync.
   * See inline comments at the verification site.
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

      // ── AUDIT III FIX 2 — crash surface ───────────────────────────────────
      worker.onerror = (event: ErrorEvent) => {
        const rawMessage = event.message || 'Worker encountered an unhandled error.';
        // Strip out any continuous strings of ACGT/N characters longer than 20 bases
        const sanitizedMessage = rawMessage.replace(/[ACGTN]{21,}/g, '[REDACTED_SEQUENCE]');
        console.error('[ArkheEngine] worker.onerror:', sanitizedMessage, event);
        set({
          workerConnected: false,
          workerError: `Engine crashed: ${sanitizedMessage}. Click Reconnect to restart.`,
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
          //
          // ── LB-10 FIX ───────────────────────────────────────────────────
          // OLD: `payload as Parameters<typeof get>`
          //   Parameters<typeof get> = [] (zero-arg tuple). TypeScript accepted
          //   `unknown as []` silently but it conveys no type information and
          //   passing [] to setChronosTransactions is wrong at runtime.
          //
          // NEW: `payload as TransactionSummary[]`
          //   Correctly types the worker's CHRONOS_HISTORY push payload and
          //   makes the handoff to setChronosTransactions type-safe.
          case 'CHRONOS_HISTORY':
            get().setChronosTransactions(payload as TransactionSummary[]);
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
              offTargetResult: payload as ArkheState['offTargetResult'],
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
              category : log.category as 'SYSTEM' | 'WORKER' | 'MEMORY' | 'CHRONOS' | 'SENTINEL' | 'ORF' | 'PCR' | 'REPORT',
              message  : log.message,
              level    : log.level as 'info' | 'success' | 'warning' | 'error' | 'debug',
            });
            break;
          }

          // ── COMMIT_SYNC ─────────────────────────────────────────────────
          //
          // ── LB-04 FIX (Zombie chronosHead) ────────────────────────────
          // OLD fallback: `?? state.chronosHead`
          //   If `currentBranch` is absent from `newBranches` (e.g. after a
          //   branch rename, deletion, or partial push), `find()` returns
          //   undefined and the nullish coalescing silently kept the old head.
          //   This meant the UI's active-commit badge was frozen at a commit
          //   ID that may already be pruned from the DAG.
          //
          // NEW — 3-tier fallback (documented on each tier below):
          //
          // ── FR-01 FIX (Frozen Recovery) ───────────────────────────────
          // After the cloud sync succeeds we fire VERIFY_SLAB_STATE.
          // See "Phase 1 — Verification" comment below.
          case 'COMMIT_SYNC': {
            // Explicit type — no implicit any in .find() (SPRINT 5 FIX 4).
            const {
              commits  : fullCommits,
              newCommits,
              branches : newBranches,
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

            // ── Update branch state + chronosHead (LB-04 fixed) ───────────
            if (newBranches) {
              set((state) => {
                // ── Tier 1: branch matching the researcher's active branch ──
                const currentBranchHead = newBranches.find(
                  (b: Branch) => b.name === state.currentBranch,
                )?.headCommitId;

                // ── Tier 2: fall back to `main` branch ────────────────────
                const mainBranchHead = newBranches.find(
                  (b: Branch) => b.name === 'main',
                )?.headCommitId;

                // ── Tier 3: first available branch ────────────────────────
                const firstBranchHead = newBranches[0]?.headCommitId;

                // ── Tier 4: retain stale head only when newBranches is empty ─
                const newHead: string | null =
                  currentBranchHead ??
                  mainBranchHead    ??
                  firstBranchHead   ??
                  state.chronosHead;

                return {
                  branches   : newBranches,
                  chronosHead: newHead,
                };
              });
            }

            // ── Gate 1: unauthenticated / guest ─────────────────────────--
            if (!user) break;

            // ── Gate 2: circuit breaker tripped ─────────────────────────--
            if (isOfflineMode) {
              get().addSystemLog({
                timestamp: Date.now(),
                category : 'SYSTEM',
                message  :
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
                      category : 'SYSTEM',
                      message  : `❌ Cloud sync failed: ${response.error}`,
                      level    : 'error',
                    });
                    // A failed sync means the cloud state is uncertain.
                    // Do NOT fire VERIFY_SLAB_STATE — we have no authoritative
                    // expected txId to verify against. The next successful sync
                    // will trigger verification.
                    return;
                  }

                  // ── Sync success log ────────────────────────────────────
                  const count = (newCommits ?? fullCommits)?.length ?? 0;
                  get().addSystemLog({
                    timestamp: Date.now(),
                    category : 'SYSTEM',
                    message  : `✅ Synced ${count} commits, ${newBranches?.length ?? 0} branches`,
                    level    : 'success',
                  });

                  // ── FR-01 Phase 1 — Verify slab state ──────────────────
                  //
                  // RATIONALE:
                  //   The cloud sync just confirmed the authoritative HEAD
                  //   commit for this genome. We now verify that the worker's
                  //   SlabManager physically reflects that same commit. If it
                  //   doesn't (local dirty mutations, undo/redo race, or any
                  //   other split-brain condition), the worker will hard-reset
                  //   its slabs and signal us to trigger a full re-load.
                  //
                  // EXPECTED TxId RESOLUTION:
                  //   We read chronosHead from the store state that was just
                  //   updated in the COMMIT_SYNC block above. The 3-tier
                  //   fallback guarantees this is non-null when any branch
                  //   data was present in the push.
                  const { worker: currentWorker, chronosHead } = get();

                  // Guard: no worker or no known head → nothing to verify.
                  if (!currentWorker || !chronosHead) return;

                  // Guard: already in the middle of a realignment — do not
                  // stack another verification on top of an in-flight reload.
                  if (get().isRealigning) return;

                  postAndWait<VerifySlabStateResponse>(
                    currentWorker,
                    'VERIFY_SLAB_STATE',
                    { expectedTxId: chronosHead },
                  )
                    .then((verifyResult) => {
                      if (verifyResult.status === 'ok') {
                        // ── Happy path: slabs consistent with cloud ────────
                        // Keep slabAcknowledgedVersion in sync with the
                        // worker's slabVersion in case it diverged.
                        set((state) => {
                          if (state.slabVersion !== verifyResult.slabVersion) {
                            return {
                              slabVersion           : verifyResult.slabVersion,
                              slabAcknowledgedVersion: verifyResult.slabVersion,
                            };
                          }
                          return {};
                        });
                        return;
                      }

                      // ── FR-01 Phase 2 — Mismatch detected ─────────────────
                      //
                      // The worker has already called hardReset() and returned
                      // the new slabVersion. We must mirror this in the store
                      // immediately so SequenceView's guard activates.
                      //
                      // isRealigning: true     → shows the "Re-aligning Memory..."
                      //                          overlay in SequenceView.
                      // slabVersion: new value → diverges from
                      //                          slabAcknowledgedVersion, which
                      //                          provides a secondary guard signal.
                      set({
                        isRealigning: true,
                        slabVersion : verifyResult.slabVersion,
                      });

                      get().addSystemLog({
                        timestamp: Date.now(),
                        category : 'MEMORY',
                        message  :
                          `⚠️ Frozen Recovery triggered: slab state diverged from ` +
                          `cloud HEAD "${chronosHead}". ` +
                          `Initiating full genome re-load (slabVersion=${verifyResult.slabVersion}).`,
                        level: 'warning',
                      });

                      // ── FR-01 Phase 3 — Recovery: full cloud re-load ───────
                      //
                      // loadGenomeFromCloud:
                      //   1. Calls RESET_ENGINE (clears worker state).
                      //   2. Downloads the FASTA blob from the signed URL.
                      //   3. Streams it to the worker in 64 KiB chunks.
                      //   4. Calls RESTORE_HISTORY (replays all Chronos commits).
                      //   5. Calls fetchGenomeMetadata → updates store.
                      //
                      // The worker's SlabManager.setCurrentTxId(headCommitId)
                      // is called inside RESTORE_HISTORY, so after the reload
                      // the next VERIFY_SLAB_STATE will return 'ok'.
                      //
                      // We read activeGenomeId fresh from the store in case it
                      // changed since the outer COMMIT_SYNC closure closed over it.
                      const genomeIdForReload = get().activeGenomeId;
                      if (!genomeIdForReload) {
                        // No active genome — cannot recover. Clear the flag so
                        // the overlay doesn't freeze indefinitely.
                        set({ isRealigning: false });
                        get().addSystemLog({
                          timestamp: Date.now(),
                          category : 'MEMORY',
                          message  : '❌ Frozen Recovery aborted: no active genome ID.',
                          level    : 'error',
                        });
                        return;
                      }

                      get()
                        .loadGenomeFromCloud(genomeIdForReload)
                        .then(() => {
                          // ── Phase 3 complete — update acknowledgment version ─
                          //
                          // setViewportData (called inside requestViewport inside
                          // loadGenomeFromCloud) will have already set
                          // slabAcknowledgedVersion = slabVersion. We clear
                          // isRealigning here as the definitive "done" signal.
                          set({ isRealigning: false });

                          get().addSystemLog({
                            timestamp: Date.now(),
                            category : 'MEMORY',
                            message  : '✅ Frozen Recovery complete: slab memory re-aligned with cloud state.',
                            level    : 'success',
                          });
                        })
                        .catch((reloadErr: unknown) => {
                          // Re-load failed — clear isRealigning so the UI
                          // doesn't freeze. The user will see an error log.
                          set({ isRealigning: false });

                          get().addSystemLog({
                            timestamp: Date.now(),
                            category : 'MEMORY',
                            message  :
                              `❌ Frozen Recovery failed: could not re-load genome from cloud. ` +
                              `${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}. ` +
                              `Manual page reload may be required.`,
                            level: 'error',
                          });
                        });
                    })
                    .catch((verifyErr: unknown) => {
                      // VERIFY_SLAB_STATE itself failed (worker error, timeout).
                      // Non-fatal — log a warning but don't block the UI.
                      console.warn(
                        '[Arkhé] VERIFY_SLAB_STATE failed:',
                        verifyErr,
                      );
                      get().addSystemLog({
                        timestamp: Date.now(),
                        category : 'MEMORY',
                        message  :
                          `⚠️ Slab verification failed (non-fatal): ` +
                          `${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}. ` +
                          `Data integrity cannot be confirmed.`,
                        level: 'warning',
                      });
                    });
                })
                .catch((err) => console.error('Sync error:', err));
            }
            break;
          }

          // ── Threat screening result ─────────────────────────────────────
          case 'SCREEN_THREATS_RESULT':
            set({
              threatMatches: payload as ArkheState['threatMatches'],
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
        slabSize     : 1_048_576,
        useSharedArray: useShared,
      });

      set({ workerConnected: true });
    } catch (err) {
      console.error('[ArkheEngine] Worker initialisation failed:', err);
      set({
        workerConnected: false,
        workerError    :
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
   * ── LB-09 FIX: Proper state replacement for slabMetas / editedSlabs ───────
   * OLD (buggy):
   *   get().slabMetas.clear();   // mutates the Map stored in Zustand state
   *   get().editedSlabs.clear(); // mutates the Set stored in Zustand state
   *
   *   Zustand's shallow-diff renderer compares object references. When you
   *   call `.clear()` on the existing Map/Set in place, the reference doesn't
   *   change, so Zustand never schedules a re-render. Subscribers (e.g. the
   *   slab viewport) continue reading the old, mutated-but-not-notified data.
   *
   * NEW (correct):
   *   set({ slabMetas: new Map(), editedSlabs: new Set() });
   *
   *   Handing Zustand fresh references guarantees a reference-change diff,
   *   triggering the correct subscriber notifications.
   *
   * ── AUDIT III FIX 1 (Vector D) — STREAM_END retained ────────────────────
   * ── SPRINT 5 FIX 5 — Adaptive slab sizing retained ───────────────────────
   */
  loadFile: async (file: File, name?: string) => {
    const { worker, user } = get();
    if (!worker) throw new Error('Worker not initialised');
    if (!user)   throw new Error('User not authenticated');

    // ── SPRINT 2 FIX (TASK 1) — Race-Condition Lock ───────────────────────
    // If a prior load is still in-flight, reject the incoming request with a
    // visible SystemLog warning instead of corrupting the worker state.
    if (get().isProcessing) {
      get().addSystemLog({
        timestamp: Date.now(),
        category : 'SYSTEM',
        message  : '⚠️ System Busy: Please wait for current sequence processing to finish.',
        level    : 'warning',
      });
      return;
    }

    set({ isProcessing: true });

    // ── SI-01: 45-second safety watchdog ─────────────────────────────────
    // If the worker stops responding (network stall, unhandled crash) after
    // acquiring the processing lock, the watchdog fires unconditionally,
    // releases the lock, and surfaces an error log.  Cleared in finally.
    let _loadFileWatchdog: ReturnType<typeof setTimeout> | null =
      setTimeout(() => {
        _loadFileWatchdog = null;
        set({ isProcessing: false, activeGenomeId: null });
        get().addSystemLog({
          timestamp: Date.now(),
          category : 'SYSTEM',
          message  : '⏱️ loadFile watchdog: worker did not respond within 45 s. ' +
                     'Processing lock force-released.  Please reload the file.',
          level    : 'error',
        });
      }, 45_000);

    try {
    // Reset engine with adaptive slab size hint (SPRINT 5 FIX 5).
    await postAndWait(worker, 'RESET_ENGINE', { expectedFileSize: file.size });

    // ── LB-09 FIX ─────────────────────────────────────────────────────────
    set({ slabMetas: new Map(), editedSlabs: new Set() });

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
        category : 'SYSTEM',
        message  : `❌ Genome upload failed: ${uploadResult.error}`,
        level    : 'error',
      });
      throw new Error(uploadResult.error!);
    }

    const genome = uploadResult.data!;
    set({ activeGenomeId: genome.id, isSyncing: false });

    get().addSystemLog({
      timestamp: Date.now(),
      category : 'SYSTEM',
      message  : `📤 Genome uploaded: ${genome.name} (${genome.id})`,
      level    : 'success',
    });

    // ── Stream to worker ──────────────────────────────────────────────────
    const fileId = generateId();
    let offset   = 0;

    while (offset < file.size) {
      const chunk       = file.slice(offset, offset + STREAM_CHUNK_SIZE);
      const arrayBuffer = await chunk.arrayBuffer();
      await postAndWait(
        worker,
        'STREAM_CHUNK',
        { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
        [arrayBuffer], // transfer — zero-copy
      );
      offset += STREAM_CHUNK_SIZE;
    }

    // AUDIT III FIX 1 — flush the final partial staging buffer.
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
      category : 'SYSTEM',
      message  : `🧬 Genome loaded: ${genomeLength.toLocaleString()} bp`,
      level    : 'success',
    });
    } catch (err) {
      // SI-02: Reset activeGenomeId to null on failure so the viewport does
      // not attempt to render against an empty / partially-loaded worker state.
      set({ activeGenomeId: null });
      throw err;
    } finally {
      // MEM-01b: Unconditionally release the processing lock and disarm the
      // safety watchdog (SI-01) regardless of success, failure, or timeout.
      if (_loadFileWatchdog !== null) clearTimeout(_loadFileWatchdog);
      set({ isProcessing: false });
    }
  },

  /**
   * loadGenomeFromCloud
   *
   * ── SPRINT 5 FIX 2 (teardown safety) ─────────────────────────────────────
   * The streaming loop is wrapped in try/finally so STREAM_END and isSyncing
   * reset are guaranteed even on network failure.
   *
   * ── AUDIT III FIX 1 (Vector D) ────────────────────────────────────────────
   * STREAM_END is sent inside the try block so the worker flushes its partial
   * staging buffer.
   *
   * ── FR-01 NOTE ─────────────────────────────────────────────────────────────
   * This method is also the recovery path for the Frozen Recovery fix.
   * When called from the COMMIT_SYNC realignment handler, `isRealigning` will
   * already be true and will be cleared by the caller upon completion.
   * This method itself does NOT touch `isRealigning` to avoid conflicting with
   * the caller's lifecycle management.
   */
  loadGenomeFromCloud: async (genomeId: string) => {
    const { worker, user } = get();
    if (!worker) throw new Error('Worker not initialised');
    if (!user)   throw new Error('User not authenticated');

    // ── SPRINT 2 FIX (TASK 1) — Race-Condition Lock ───────────────────────
    // FR-01 recovery calls loadGenomeFromCloud intentionally while
    // isRealigning is true; that path is explicitly permitted. All other
    // callers that arrive while a load is in-flight are rejected.
    //
    // MEM-02 FIX: Read both flags from a single get() snapshot.  Two separate
    // get() calls create a torn-read window: a Zustand set() from a push-
    // notification handler (worker.addEventListener) can fire between
    // microtask boundaries, causing isProcessing and isRealigning to be read
    // from different snapshots and allowing a double-load race.
    const { isProcessing: _lockCheck, isRealigning: _realignCheck } = get();
    if (_lockCheck && !_realignCheck) {
      get().addSystemLog({
        timestamp: Date.now(),
        category : 'SYSTEM',
        message  : '⚠️ System Busy: Please wait for current sequence processing to finish.',
        level    : 'warning',
      });
      return;
    }

    set({ isProcessing: true, isSyncing: true, activeGenomeId: genomeId });

    // ── SI-01: 45-second safety watchdog ─────────────────────────────────
    // Arms immediately after acquiring the lock.  Cleared in the outer
    // finally block.  If the worker never responds (Supabase timeout,
    // network drop, unhandled worker crash), the watchdog releases the lock
    // and clears activeGenomeId so the UI does not freeze indefinitely.
    let _cloudLoadWatchdog: ReturnType<typeof setTimeout> | null =
      setTimeout(() => {
        _cloudLoadWatchdog = null;
        set({ isProcessing: false, isSyncing: false, activeGenomeId: null });
        get().addSystemLog({
          timestamp: Date.now(),
          category : 'SYSTEM',
          message  : '⏱️ loadGenomeFromCloud watchdog: worker did not respond within 45 s. ' +
                     'Processing lock force-released.  Please retry.',
          level    : 'error',
        });
      }, 45_000);

    // ── MEM-01 FIX: Outer try/finally wraps ALL post-lock work ─────────────
    // Previously there was no try/finally around the Supabase restore call.
    // A failed restoreSession (RLS violation, network error, invalid genomeId)
    // would throw, leaving isProcessing permanently true.  The entire post-lock
    // body is now wrapped so the finally block unconditionally releases both
    // isProcessing and the safety watchdog regardless of which step fails.
    try {

    // ── Fetch session from Supabase ───────────────────────────────────────
    const restoreResult = await PersistenceManager.restoreSession(genomeId);
    if (restoreResult.status === 'fail') {
      set({ isSyncing: false });
      get().addSystemLog({
        timestamp: Date.now(),
        category : 'SYSTEM',
        message  : `❌ Session restore failed: ${restoreResult.error}`,
        level    : 'error',
      });
      throw new Error(restoreResult.error!);
    }

    const {
      genome,
      commits  : supabaseCommits,
      branches : supabaseBranches,
      headCommit: supabaseHeadCommit,
    } = restoreResult.data!;

    // convertSupabaseCommitToArkhe now unpacks mutations from snapshot_meta
    // (LB-01 fix) and reads childrenTxIds from the augmentation (LB-08 fix).
    const convertedCommits     = supabaseCommits.map(convertSupabaseCommitToArkhe);
    const convertedBranches    = supabaseBranches.map(convertSupabaseBranchToArkhe);
    const convertedHeadCommit  = convertSupabaseCommitToArkhe(supabaseHeadCommit);

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
    let offset   = 0;

    try {
      while (offset < file.size) {
        const chunk       = file.slice(offset, offset + STREAM_CHUNK_SIZE);
        const arrayBuffer = await chunk.arrayBuffer();
        await postAndWait(
          worker,
          'STREAM_CHUNK',
          { fileId, chunkBuffer: arrayBuffer, byteOffset: offset },
          [arrayBuffer],
        );
        offset += STREAM_CHUNK_SIZE;
      }

      // AUDIT III FIX 1 — flush the final partial staging buffer.
      await postAndWait(worker, 'STREAM_END', { fileId });
    } catch (err) {
      // Clear partial engine state so the next load attempt starts clean.
      await postAndWait(worker, 'RESET_ENGINE', {}).catch(() => {
        /* best-effort — ignore secondary failure */
      });

      get().addSystemLog({
        timestamp: Date.now(),
        category : 'SYSTEM',
        message  : `❌ Genome stream failed: ${
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
    // FR-01: After RESTORE_HISTORY the worker calls
    // slabManager.setCurrentTxId(headCommitId), so the next VERIFY_SLAB_STATE
    // will return 'ok' and confirm the recovery is clean.
    await postAndWait(worker, 'RESTORE_HISTORY', {
      commits     : convertedCommits,
      branches    : convertedBranches,
      headCommitId: convertedHeadCommit.txId,
    });

    await get().fetchGenomeMetadata();

    set({
      commits      : convertedCommits,
      branches     : convertedBranches,
      chronosHead  : convertedHeadCommit.txId,
      currentBranch:
        convertedBranches.find(
          (b) => b.headCommitId === convertedHeadCommit.txId,
        )?.name ?? 'main',
    });

    // ── FR-01: Acknowledge the current slabVersion ─────────────────────
    // We've just reloaded from the authoritative cloud state. The slabs are
    // now consistent. Stamp slabAcknowledgedVersion = slabVersion so
    // SequenceView's secondary guard (slabVersion !== slabAcknowledgedVersion)
    // resolves. The viewport has also been refreshed by fetchGenomeMetadata →
    // requestViewport → setViewportData, which stamped viewportVersion.
    set((state) => ({
      slabAcknowledgedVersion: state.slabVersion,
    }));

    get().addSystemLog({
      timestamp: Date.now(),
      category : 'SYSTEM',
      message  : `🔄 Session restored: ${genome.name}, ${convertedCommits.length} commits`,
      level    : 'success',
    });

    } catch (err) {
      // SI-02: On any failure, reset activeGenomeId to null so SequenceView
      // and the viewport do not attempt to render against an empty or
      // partially-loaded worker.  The worker was already reset in the inner
      // stream try/catch (SPRINT 5 FIX 2); this catch covers failures outside
      // the stream loop (Supabase restore, RESTORE_HISTORY, metadata fetch).
      set({ activeGenomeId: null, isSyncing: false });
      get().addSystemLog({
        timestamp: Date.now(),
        category : 'SYSTEM',
        message  : `❌ Cloud load failed: ${err instanceof Error ? err.message : String(err)}`,
        level    : 'error',
      });
      throw err;
    } finally {
      // MEM-01 FIX: Unconditionally release the processing lock and disarm
      // the safety watchdog on every exit path (success, failure, or timeout).
      if (_cloudLoadWatchdog !== null) clearTimeout(_cloudLoadWatchdog);
      set({ isProcessing: false });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Viewport
  // ─────────────────────────────────────────────────────────────────────────

  fetchGenomeMetadata: async () => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const metadata = await postAndWait<{
      genomeLength: number;
      slabMetas   : SlabMeta[];
    }>(worker, 'GET_GENOME_METADATA');
    set({ genomeLength: metadata.genomeLength });
    get().updateSlabMeta(metadata.slabMetas);
    return metadata;
  },

  requestViewport: async (start: number, end: number): Promise<SliceResponse | null> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    let result: SliceResponse;
    try {
      result = await postAndWait<SliceResponse>(worker, 'LOAD_SLICE', { start, end });
    } catch (err) {
      if (err instanceof Error && (err as any).cancelled) {
        return null; // superseded — a fresher request is in flight
      }
      throw err; // real worker error — propagate
    }

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
        minProduct   : options?.minProduct    ?? 50,
        maxProduct   : options?.maxProduct    ?? 5_000,
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
    content : string;
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
      const blob   = new Blob([result.content], { type: 'text/plain' });
      const url    = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href     = url;
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
    start     : number,
    end       : number,
    orf       : ORF,
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
    query       : string,
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

  setComparisonSequence: (seq: string | null) => set({ comparisonSequence: seq }),
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

  setWorkerConnected: (connected: boolean) => set({ workerConnected: connected }),
  setWorkerError    : (error: string | null) => set({ workerError: error }),

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
   * setViewportData – LB-11/14 atomic update with version increment.
   *
   * Writes a LOAD_SLICE response into the viewport and its denormalised
   * sibling fields (sliceSpliceSites, sliceIsoforms, sliceProteinProperties),
   * and increments viewportVersion to signal a consistent snapshot.
   *
   * FR-01: Also stamps slabAcknowledgedVersion = slabVersion at the moment
   * the viewport is committed. This ensures that a fresh viewport fetch
   * AFTER a hard reset (slabVersion++ fired) immediately resolves the
   * SequenceView's secondary guard condition
   * (slabVersion !== slabAcknowledgedVersion). The primary guard (isRealigning)
   * is cleared separately by the COMMIT_SYNC realignment handler.
   */
  setViewportData: (data: SliceResponse) => {
    set((state) => ({
      viewport: {
        start           : data.start,
        end             : data.end,
        buffer          : data.buffer,
        sequence        : data.sequence,
        translations    : data.translations,
        gcPercent       : data.gcPercent,
        features        : data.features,
        orfs            : data.orfs,
        spliceSites     : data.spliceSites,
        isoforms        : data.isoforms,
        proteinProperties: data.proteinProperties,
      },
      viewportVersion         : state.viewportVersion + 1,         // LB-11/14
      slabAcknowledgedVersion : state.slabVersion,                  // FR-01
      sliceSpliceSites        : data.spliceSites      ?? [],
      sliceIsoforms           : data.isoforms         ?? [],
      sliceProteinProperties  : data.proteinProperties ?? null,
    }));
  },

  setSyncing         : (val: boolean)            => set({ isSyncing: val }),
  setPCRResults      : (results: PCRProduct[])   => set({ pcrResults: results }),
  setRestrictionSites: (sites: RestrictionSite[]) => set({ restrictionSites: sites }),
  setRadarData       : (data: RadarBin[])        => set({ radarData: data }),
  setPublicGenomes   : (genomes: PublicGenome[]) => set({ publicGenomes: genomes }),
  setLoadingPublic   : (loading: boolean)        => set({ isLoadingPublic: loading }),
  setDiffMode        : (mode: boolean)           => set({ diffMode: mode }),
  setOffTargetHits   : (hits: OffTargetHit[])   => set({ offTargetHits: hits }),
  setSyntenyAnchors  : (anchors: SyntenyAnchor[]) => set({ syntenyAnchors: anchors }),
  setScanningSynteny : (scanning: boolean)       => set({ isScanningSynteny: scanning }),
  setORFScanResult   : (result: ArkheState['orfScanResult']) => set({ orfScanResult: result }),
  setORFScanning     : (scanning: boolean)       => set({ isORFScanning: scanning }),

  // FR-01: Setter for the realignment flag (exposed for testing / manual override)
  setIsRealigning: (realigning: boolean) => set({ isRealigning: realigning }),

  // SPRINT 2 FIX: Setter for the processing lock (exposed for testing)
  setIsProcessing: (processing: boolean) => set({ isProcessing: processing }),
});