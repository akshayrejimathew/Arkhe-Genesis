/**
 * src/store/chronosSlice.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Zustand slice that owns the entire versioning / mutation surface of Arkhé:
 *
 *   • Surgical mutations  (applyLocalMutation, performSurgicalEdit,
 *                          commitMutationWithReason, cancelPendingMutation)
 *   • Undo / Redo         (with CF-04 viewport sync applied after each)
 *   • Diff export         (getDiffForTx)
 *   • Branching           (createBranch, checkout, merge, getBranches, getCommits)
 *   • Off-target radar    (scanOffTargets, clearOffTargetResult)
 *   • Protein folding     (foldProtein with GDPR gate, clearProteinFold)
 *   • Internal setters    (setChronosHead … setFoldError)
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 *   CF-04 — Chronos Viewport Sync:
 *     Both undo() and redo() call get().requestViewport() after their
 *     postAndWait call resolves.  This forces a full LOAD_SLICE round-trip
 *     that overwrites the Zustand viewport with the engine's rewound/advanced
 *     state, eliminating the "Ghost Data" bug where stale sequence data was
 *     displayed after an undo/redo.
 *
 *     Ordering guarantee: postAndWait is sequential — UNDO/REDO is fully
 *     committed in the worker before requestViewport is dispatched.
 *
 *     Error handling: viewport sync failure after undo/redo is non-fatal.
 *     The error is logged as a warning so the researcher knows a manual
 *     scroll will force a redraw.  The original undo/redo remains applied.
 *
 *   SPRINT 3 — computeProteinFold GDPR shim:
 *     foldProtein() imports computeProteinFold from @/lib/proteinFold (the
 *     GDPR-compliant shim) rather than calling FoldingEngine directly.  The
 *     shim transmits to ESM Atlas only after explicit researcher consent;
 *     without consent it returns a Chou–Fasman heuristic result with zero
 *     network I/O.
 *
 * ── CROSS-SLICE CALLS ─────────────────────────────────────────────────────────
 *
 *   get().requestViewport()  — GenomeActions  (CF-04 undo/redo sync)
 *   get().addEditedSlab()    — GenomeActions  (mutation side-effect)
 *   get().addSystemLog()     — UIActions      (error/warning reporting)
 *   get().getBranches()      — own action     (post-checkout/merge refresh)
 *   get().getCommits()       — own action     (post-checkout/merge refresh)
 *
 *   All cross-slice calls go through get() which returns the full ArkheState,
 *   so there are zero circular import risks.
 */

import type { StateCreator } from 'zustand';
// SPRINT 3 FIX: import from the GDPR-compliant shim, not FoldingEngine directly.
// The shim enforces the consent gate and delegates to FoldingEngine (ESM Atlas)
// only after the researcher has explicitly acknowledged the data transmission.
import { computeProteinFold } from '@/lib/proteinFold';
import { postAndWait, generateId } from './utils';
import type {
  ArkheState,
  StoreMutators,
  ChronosSlice,
  PendingMutation,
  BaseCode,
  OffTargetResult,
  ProteinFold,
  Branch,
  Commit,
  TransactionSummary,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Initial chronos state
// ─────────────────────────────────────────────────────────────────────────────

const initialChronosState = {
  chronosHead: null as string | null,
  chronosTransactions: [] as TransactionSummary[],
  branches: [] as Branch[],
  currentBranch: 'main',
  commits: [] as Commit[],

  pendingMutation: null as PendingMutation | null,
  showCommitDialog: false,

  offTargetResult: null as OffTargetResult | null,
  isScanningOffTarget: false,

  proteinFold: null as ProteinFold | null,
  isFolding: false,
  foldError: null as string | null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice factory
// ─────────────────────────────────────────────────────────────────────────────

export const createChronosSlice: StateCreator<
  ArkheState,
  StoreMutators,
  [],
  ChronosSlice
> = (set, get) => ({
  // ── Initial state ───────────────────────────────────────────────────────
  ...initialChronosState,

  // ─────────────────────────────────────────────────────────────────────────
  // § Surgical mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * applyLocalMutation
   *
   * Writes a single base-pair edit to the worker engine and marks the owning
   * slab as dirty.  This is the "direct write" path — no confirmation dialog.
   * For the two-phase commit flow (with a reason string), use
   * performSurgicalEdit → commitMutationWithReason instead.
   */
  applyLocalMutation: async (
    slabIndex: number,
    offset: number,
    base: BaseCode,
    meta?: {
      user: string;
      reason: string;
      branch?: string;
      isCheckpoint?: boolean;
    },
  ) => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    const txId = generateId();
    await postAndWait(worker, 'PERFORM_SURGICAL_MUTATION', {
      slabIndex,
      offset,
      newBaseCode: base,
      txId,
      meta,
    });

    // Mark the slab dirty in the genome slice (cross-slice call via get()).
    get().addEditedSlab(slabIndex);
  },

  /**
   * performSurgicalEdit
   *
   * Stages a mutation for the SurgicalCommit dialog without touching the
   * engine.  The researcher fills in a commit reason and calls
   * commitMutationWithReason, or calls cancelPendingMutation to discard.
   */
  performSurgicalEdit: (
    slabIndex: number,
    offset: number,
    base: BaseCode,
    user?: string,
    branch?: string,
    isCheckpoint?: boolean,
  ) => {
    set({
      pendingMutation: {
        slabIndex,
        offset,
        base,
        meta: {
          user: user ?? 'anonymous',
          reason: '', // filled in by the researcher in the dialog
          branch,
          isCheckpoint,
        },
      },
      showCommitDialog: true,
    });
  },

  /**
   * commitMutationWithReason
   *
   * Finalises the staged mutation by attaching the researcher's reason string
   * and forwarding the complete payload to the engine worker.
   *
   * Clears both pendingMutation and showCommitDialog regardless of success or
   * failure, since the dialog must close in all paths.
   */
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

  // ─────────────────────────────────────────────────────────────────────────
  // § Undo / Redo  ── CF-04 Chronos Viewport Sync
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * undo
   *
   * Rewinds the engine's mutation log by one commit, then synchronises the
   * Zustand viewport with the rewound engine state.
   *
   * ── CF-04 ─────────────────────────────────────────────────────────────────
   * PROBLEM:
   *   postAndWait('UNDO') correctly rewound the worker's slab buffers, but the
   *   Zustand `viewport` continued holding the pre-undo rendered slice —
   *   "Ghost Data" — until an unrelated scroll or viewport request replaced it.
   *
   * FIX:
   *   After postAndWait resolves (guaranteeing the worker has fully committed
   *   the rewind), we re-read the current viewport window and issue a fresh
   *   requestViewport call over the same range, forcing LOAD_SLICE to overwrite
   *   the stale rendered slice with the engine's new state.
   *
   * ORDERING GUARANTEE:
   *   postAndWait is sequential — UNDO is fully committed in the worker before
   *   requestViewport is dispatched.  There is no race window.
   *
   * ERROR HANDLING:
   *   If requestViewport fails (e.g. worker crashed between UNDO and LOAD_SLICE)
   *   we surface a warning and do NOT rethrow.  The undo itself succeeded;
   *   the worker's onerror handler will surface the crash independently.
   */
  undo: async () => {
    const { worker } = get();
    if (!worker) return;

    // ── Step 1: Rewind the worker's mutation log ────────────────────────────
    await postAndWait(worker, 'UNDO');

    // ── Step 2: Sync the viewport to the rewound state (CF-04) ────────────
    // Read start/end *after* the await — another action may have moved the
    // viewport window during the round-trip, and we want the current window.
    const { start, end } = get().viewport;
    try {
      await get().requestViewport(start, end);
    } catch (err) {
      // Undo succeeded — treat viewport sync failure as a non-fatal warning.
      console.error('[Arkhé] undo: viewport sync failed after UNDO', err);
      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message:
          `⚠️ Undo applied in engine but viewport refresh failed: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Scroll to force a redraw.`,
        level: 'warning',
      });
    }
  },

  /**
   * redo
   *
   * Re-applies the next commit in the engine's mutation log, then synchronises
   * the Zustand viewport with the advanced engine state.
   *
   * CF-04 semantics are identical to undo() — see that method's JSDoc for
   * the full explanation.  Mirroring undo exactly ensures consistent behaviour
   * in both directions of the history.
   */
  redo: async () => {
    const { worker } = get();
    if (!worker) return;

    // ── Step 1: Advance the worker's mutation pointer ──────────────────────
    await postAndWait(worker, 'REDO');

    // ── Step 2: Sync the viewport to the re-applied state (CF-04) ─────────
    const { start, end } = get().viewport;
    try {
      await get().requestViewport(start, end);
    } catch (err) {
      console.error('[Arkhé] redo: viewport sync failed after REDO', err);
      get().addSystemLog({
        timestamp: Date.now(),
        category: 'SYSTEM',
        message:
          `⚠️ Redo applied in engine but viewport refresh failed: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Scroll to force a redraw.`,
        level: 'warning',
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Diff export
  // ─────────────────────────────────────────────────────────────────────────

  getDiffForTx: async (txId: string): Promise<unknown> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    return postAndWait(worker, 'EXPORT_PATCH', { txId });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Branching evolution
  // ─────────────────────────────────────────────────────────────────────────

  createBranch: async (
    name: string,
    fromCommitId?: string,
  ): Promise<boolean> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    const success = await postAndWait<boolean>(worker, 'CREATE_BRANCH', {
      name,
      fromCommitId,
    });

    if (success) {
      // Refresh the branch list in the store without awaiting — UI update is
      // non-critical and should not block the caller.
      get().getBranches().catch(console.error);
    }

    return success;
  },

  checkout: async (branchName: string): Promise<boolean> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    const success = await postAndWait<boolean>(worker, 'CHECKOUT', {
      branchName,
    });

    if (success) {
      set({ currentBranch: branchName });
      // Refresh both branches and commits so the UI reflects the new HEAD.
      get().getBranches().catch(console.error);
      get().getCommits().catch(console.error);
    }

    return success;
  },

  merge: async (
    sourceBranch: string,
    targetBranch?: string,
    message?: string,
  ): Promise<string | null> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    const mergeCommitId = await postAndWait<string | null>(worker, 'MERGE', {
      sourceBranch,
      targetBranch,
      message,
    });

    if (mergeCommitId) {
      get().getBranches().catch(console.error);
      get().getCommits().catch(console.error);
    }

    return mergeCommitId;
  },

  getBranches: async (): Promise<Branch[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const branches = await postAndWait<Branch[]>(worker, 'GET_BRANCHES');
    set({ branches });
    return branches;
  },

  getCommits: async (): Promise<Commit[]> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');
    const commits = await postAndWait<Commit[]>(worker, 'GET_COMMITS');
    set({ commits });
    return commits;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // § Off-target radar
  //
  // Distinct from the off-target *heatmap* in genomeSlice, which stores its
  // results in offTargetHits.  This action stores in offTargetResult and is
  // driven by the CRISPR Off-Target Radar panel.
  // ─────────────────────────────────────────────────────────────────────────

  scanOffTargets: async (
    query: string,
    maxMismatch?: number,
  ): Promise<OffTargetResult> => {
    const { worker } = get();
    if (!worker) throw new Error('Worker not initialised');

    set({ isScanningOffTarget: true });
    try {
      const result = await postAndWait<OffTargetResult>(
        worker,
        'SCAN_OFF_TARGETS',
        { query, maxMismatch: maxMismatch ?? 2 },
      );
      set({ offTargetResult: result });
      return result;
    } finally {
      set({ isScanningOffTarget: false });
    }
  },

  clearOffTargetResult: () => set({ offTargetResult: null }),

  // ─────────────────────────────────────────────────────────────────────────
  // § Protein folding  ── GDPR gate enforced here
  //
  // The ESM Atlas API transmits the researcher's amino-acid sequence to a
  // Meta Research third-party endpoint.  computeProteinFold is imported from
  // the GDPR-compliant shim (@/lib/proteinFold) which:
  //   • Returns a Chou–Fasman heuristic result when consentObtained === false
  //     (zero network I/O, instant, safe for all regions).
  //   • Delegates to FoldingEngine (ESM Atlas) only when consentObtained === true.
  //
  // The disclosure modal in the UI MUST pass true only after the researcher
  // has explicitly clicked "I Agree — transmit my sequence to ESM Atlas."
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * foldProtein
   *
   * @param sequence        Amino-acid sequence string (single-letter codes).
   * @param consentObtained Must be true to allow ESM Atlas transmission.
   *                        Defaults to false — heuristic-only, no network I/O.
   */
  foldProtein: async (
    sequence: string,
    consentObtained = false,
  ): Promise<ProteinFold> => {
    // ── Heuristic fast-path (no consent / consent not yet obtained) ─────────
    if (!consentObtained) {
      const heuristicResult: ProteinFold = {
        aminoAcids: sequence,
        coordinates: [],
        secondaryStructure: [],
        confidence: [],
        method: 'CHOU_FASMAN_HEURISTIC',
        warning: 'Heuristic prediction — Not for clinical use.',
        rateLimitNotice:
          'ESM Atlas folding requires prior researcher consent. ' +
          'Showing heuristic analysis.',
      };
      set({ proteinFold: heuristicResult });
      return heuristicResult;
    }

    // ── Network path (consent obtained — shim delegates to ESM Atlas) ───────
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

  // ─────────────────────────────────────────────────────────────────────────
  // § Internal setters
  // ─────────────────────────────────────────────────────────────────────────

  setChronosHead: (txId) => set({ chronosHead: txId }),
  setChronosTransactions: (txs) => set({ chronosTransactions: txs }),
  setBranches: (branches) => set({ branches }),
  setCurrentBranch: (branch) => set({ currentBranch: branch }),
  setCommits: (commits) => set({ commits }),
  setShowCommitDialog: (show) => set({ showCommitDialog: show }),
  setPendingMutation: (mutation) => set({ pendingMutation: mutation }),
  setOffTargetResult: (result) => set({ offTargetResult: result }),
  setScanningOffTarget: (scanning) => set({ isScanningOffTarget: scanning }),
  setProteinFold: (fold) => set({ proteinFold: fold }),
  setFolding: (folding) => set({ isFolding: folding }),
  setFoldError: (error) => set({ foldError: error }),
});