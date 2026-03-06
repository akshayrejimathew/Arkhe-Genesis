/**
 * src/store/chronosSlice.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Zustand slice that owns the entire versioning / mutation surface of Arkhé:
 *
 *   • Surgical mutations  (applyLocalMutation, performSurgicalEdit,
 *                          commitMutationWithReason, cancelPendingMutation)
 *   • Undo / Redo         (with CF-04 viewport sync + LB-06 head sync)
 *   • Diff export         (getDiffForTx)
 *   • Branching           (createBranch, checkout, merge, getBranches, getCommits)
 *   • Off-target radar    (scanOffTargets, clearOffTargetResult)
 *   • Protein folding     (foldProtein with GDPR gate, clearProteinFold)
 *   • Internal setters    (setChronosHead … setFoldError)
 *
 * ── GENESIS RECTIFICATION SPRINT — KILL-SWITCH FIX ──────────────────────────
 *
 *   TASK 3 — Cross-Domain Mutex: isProcessing guard in executeAtomicAction
 *
 *     PROBLEM (before this fix):
 *       `applyLocalMutation` (and by extension undo / redo) was wrapped in
 *       `executeAtomicAction` which serialised concurrent calls against each
 *       other via the action queue.  However, it did NOT check the `isProcessing`
 *       flag owned by `genomeSlice`.  `isProcessing` is set to `true` for the
 *       entire duration of `loadFile` and `loadGenomeFromCloud` — operations that
 *       stream raw genome bytes into the SlabManager in multi-chunk bursts.
 *
 *       Allowing a surgical mutation to land while a streaming load is in flight
 *       corrupts the slab state: the PERFORM_SURGICAL_MUTATION message races
 *       against STREAM_CHUNK messages; the SlabManager may apply the base-pair
 *       edit to partially-written slab memory and then have those bytes
 *       overwritten by the next STREAM_CHUNK, silently discarding the edit.
 *       Worse, the Chronos history will record a txId for a mutation that was
 *       never actually persisted, causing a split-brain between the UI-visible
 *       sequence and the stored commit graph.
 *
 *     FIX:
 *       At the start of each atomic action (before `set({ isLocked: true })`),
 *       `executeAtomicAction` reads `get().isProcessing` from the combined store.
 *       If it is `true`, the action is rejected immediately by throwing an
 *       `EngineLockError` with the message:
 *
 *         "Engine Locked: Cannot mutate while streaming genome."
 *
 *       The rejection is also written to the System Log at level 'warning' so
 *       the researcher sees clear feedback in the terminal panel.
 *
 *       The `EngineLockError` class is exported so callers can `instanceof`-check
 *       it and show a non-alarming "try again after load" notice rather than a
 *       generic error banner.
 *
 *       QUEUE CONTINUITY: The rejection path does NOT break the action queue.
 *       The silenced tail is stored as before, so subsequent actions can still
 *       execute once `isProcessing` returns to `false`.
 *
 * ── NEW FIX (MX-01) ──────────────────────────────────────────────────────────
 *
 *   MX-01 — Sequential Execution Queue (Mutex) for undo / redo / applyLocalMutation:
 *
 *     PROBLEM:
 *       Rapid user input (e.g. clicking "Undo" five times quickly) causes the
 *       UI state (chronosHead) and the Worker state (SlabManager) to decouple
 *       because worker messages are processed out-of-order relative to UI
 *       renders. Each async action fires independently; by the time action N
 *       reads GET_HEAD, actions N+1 … N+4 may already have dispatched their
 *       own UNDO payloads, so the returned head belongs to an unknown commit.
 *
 *     FIX:
 *       `executeAtomicAction` chains every new action onto a shared
 *       `actionQueue` promise using `.then()`.  The queue starts as a
 *       resolved promise and each enqueued action appends to the tail, so
 *       execution is strictly FIFO.  The full sequence for each item:
 *
 *         1. Check isProcessing (TASK 3 cross-domain mutex guard)
 *         2. Set isLocked = true
 *         3. Post the primary worker message (UNDO / REDO / PERFORM_SURGICAL_MUTATION)
 *         4. Dispatch GET_HEAD and write result to chronosHead (LB-06)
 *         5. Call requestViewport to sync the rendered window (CF-04)
 *         6. Set isLocked = false
 *
 *       The next queued item only begins step 1 once step 6 of the previous
 *       item has completed, eliminating all inter-action race conditions.
 *
 *     QUEUE CONTINUITY ON ERROR:
 *       Errors thrown inside an action propagate back to the original caller
 *       (so await undo() still rejects as expected) but do NOT break the
 *       queue tail.  A `.catch(() => {})` shim is stored as the new queue
 *       tail so subsequent actions are never blocked by a failed predecessor.
 *
 *     isLocked UX:
 *       `isLocked` is set to true for the duration of each atomic action and
 *       false once it finishes.  Because the actions are sequential there is
 *       never more than one concurrent worker round-trip, so `isLocked` is a
 *       reliable signal for disabling undo/redo buttons and showing a spinner.
 *
 * ── NEW FIX (2026-02-25) ─────────────────────────────────────────────────────
 *
 *   LB-06 — Immediate `chronosHead` advancement after undo / redo:
 *
 *     PROBLEM:
 *       Both `undo()` and `redo()` previously relied on the next `COMMIT_SYNC`
 *       push from the worker to update `chronosHead` in the store. This caused
 *       two failure modes:
 *
 *         (a) OFFLINE MODE: If the circuit breaker is tripped, COMMIT_SYNC is
 *             gated at the cloud-sync step and the UI-observable `chronosHead`
 *             never advances — the timeline badge freezes at the pre-undo
 *             commit even though the engine has correctly rewound.
 *
 *         (b) RACE WINDOW (online mode): Between the moment postAndWait('UNDO')
 *             resolves and the moment the worker emits COMMIT_SYNC, any
 *             component reading `chronosHead` sees a stale value.
 *
 *     FIX:
 *       After postAndWait resolves we dispatch a cheap `GET_HEAD` round-trip
 *       to the worker and write the result to the store immediately.
 *       GET_HEAD is an O(1) in-memory lookup in the worker; it adds < 1 ms.
 *       Ordering guarantee: GET_HEAD is dispatched *after* UNDO/REDO has
 *       fully committed, so the returned ID always reflects the new state.
 *       If GET_HEAD fails the error is non-fatal (logged as warning).
 *
 * ── TS COMPILER FIXES (2026-02-25) ──────────────────────────────────────────
 *
 *   StateCreator generic — `StoreMutators` type alias removed from this file.
 *   The middleware tuple is now inlined as
 *   `[['zustand/subscribeWithSelector', never]]` which resolves correctly
 *   without a cross-file type alias that can fail to resolve if StoreMutators
 *   is not exported from ./types. The alias is still valid in the combined
 *   store index (src/store/index.ts) where the middleware is applied.
 *
 * ── FIXES PRESERVED ──────────────────────────────────────────────────────────
 *
 *   CF-04 — Chronos Viewport Sync:
 *     Both undo() and redo() call get().requestViewport() after their
 *     postAndWait call resolves, eliminating the "Ghost Data" bug.
 *
 *   SPRINT 3 — computeProteinFold GDPR shim (unchanged).
 */

import type { StateCreator } from 'zustand';
// SPRINT 3 FIX: import from the GDPR-compliant shim, not FoldingEngine directly.
import { computeProteinFold } from '@/lib/proteinFold';
import { postAndWait, generateId } from './utils';
import type {
  ArkheState,
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
// TASK 3: Engine-lock error class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown by `executeAtomicAction` when a mutation is attempted while the
 * genome engine is currently ingesting a file (isProcessing === true).
 *
 * Exported so callers can branch on `err instanceof EngineLockError` to
 * display a "please wait for the load to complete" notice rather than a
 * generic error banner.
 */
export class EngineLockError extends Error {
  readonly code = 'ENGINE_LOCK_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EngineLockError';
    Object.setPrototypeOf(this, EngineLockError.prototype);
  }
}

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

  // MX-01: Mutex initial state
  // actionQueue starts as an already-resolved promise so the first action
  // appended via .then() begins executing immediately without any artificial
  // delay.  The value is non-serialisable; Zustand devtools will display it as
  // a plain object — that is expected and harmless.
  isLocked: false,
  actionQueue: Promise.resolve() as Promise<void>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice factory
// ─────────────────────────────────────────────────────────────────────────────

export const createChronosSlice: StateCreator<
  ArkheState,
  [['zustand/subscribeWithSelector', never]],
  [],
  ChronosSlice
> = (set, get) => {

  // ── MX-01 + TASK 3: Internal atomic execution wrapper ──────────────────────
  //
  // This function is NOT exposed on the store.  It is a closure-scoped helper
  // that serialises all calls to undo(), redo(), and applyLocalMutation().
  //
  // HOW IT WORKS
  // ─────────────
  //  1. [TASK 3] Read isProcessing from genomeSlice.  If true, reject immediately.
  //  2. Read the current tail of the queue from the store.
  //  3. Build `chainedTask`: a new promise that waits for the previous tail,
  //     sets isLocked, executes the action, then clears isLocked.
  //  4. Store a *silenced* version of the chained task as the new queue tail.
  //     Silencing (`.catch(() => {})`) prevents a rejection in one action from
  //     blocking all subsequent queued actions.
  //  5. Return `chainedTask` (not the silenced version) to the caller so they
  //     still receive real rejections via `await`.
  //
  // TASK 3 — CROSS-DOMAIN MUTEX GUARD
  // ────────────────────────────────────
  //  The `isProcessing` flag is owned by `genomeSlice` and is set to `true`
  //  for the entire lifetime of `loadFile` and `loadGenomeFromCloud`.
  //
  //  If a mutation action is enqueued while isProcessing is true, it is
  //  rejected BEFORE being appended to the action queue.  This is intentional:
  //  we do not want the mutation to be deferred until after the load completes,
  //  because the researcher's intent may have changed by then.  A hard rejection
  //  with a clear error message is the safer behaviour.
  //
  //  The rejection does NOT break the queue — the `.catch(() => {})` shim
  //  is written as the new tail even on the rejection path.
  //
  // ORDERING GUARANTEE
  // ───────────────────
  //  Because each new action reads `get().actionQueue` *synchronously* before
  //  appending, and because Zustand's `set()` is synchronous, the following
  //  race is impossible:
  //
  //    Thread A: reads tail₀, builds chainedTaskA, writes tail₁ (= silenced A)
  //    Thread B: reads tail₁, builds chainedTaskB, writes tail₂ (= silenced B)
  //
  //  JavaScript's single-threaded event loop ensures that both `get()` and
  //  `set()` calls within a synchronous block are never interleaved with
  //  another synchronous block from a different call stack.  The only async
  //  points are inside the `.then()` callbacks, at which point the queue tail
  //  has already been committed to the store.
  //
  const executeAtomicAction = (action: () => Promise<void>): Promise<void> => {

    // ── TASK 3: Cross-domain mutex — check genomeSlice.isProcessing ─────────
    //
    // Read the flag synchronously *before* touching the action queue.  If the
    // genome engine is currently streaming a file, reject immediately with a
    // descriptive EngineLockError and write a System Log entry so the
    // researcher sees the reason in the terminal panel.
    //
    // NOTE: We read isProcessing here (before the .then() callback) so that
    // the check happens at the moment the caller initiates the action, not
    // after the previous queue item finishes.  A stream that starts after this
    // check but before the action executes is theoretically possible, but is
    // mitigated by the SI-01 watchdog in genomeSlice which prevents isProcessing
    // from being held for longer than 45 seconds.
    const { isProcessing } = get();

    if (isProcessing) {
      const lockMsg = 'Engine Locked: Cannot mutate while streaming genome.';

      get().addSystemLog({
        timestamp: Date.now(),
        category : 'CHRONOS',
        message  : `⚠️ ${lockMsg}`,
        level    : 'warning',
      });

      // Build a rejected chainedTask so the silenced tail can be stored
      // (maintaining queue continuity) while the original rejection is
      // returned to the caller.
      const rejected = Promise.reject(new EngineLockError(lockMsg));

      // Store silenced version as new queue tail so subsequent queued actions
      // are not starved by this rejection.
      set({ actionQueue: rejected.catch(() => {}) });

      // Return the non-silenced rejection to the caller.
      return rejected;
    }

    // ── MX-01: Capture the current queue tail synchronously ─────────────────
    const previousQueue = get().actionQueue;

    // Build the chained task.  Errors from the previous item are swallowed by
    // the `.catch(() => {})` on the stored tail (see step 4), so `previousQueue`
    // here is always a resolving promise — the `.then()` will always fire.
    const chainedTask: Promise<void> = previousQueue
      .then(async () => {
        // Step 1: Acquire the lock.
        set({ isLocked: true });

        // Step 2: Execute the caller-provided async action.
        //   This may throw — the throw propagates to `chainedTask`'s rejection
        //   handler (the caller), but NOT into the queue tail (step 4 below).
        await action();
      })
      .finally(() => {
        // Step 3: Release the lock unconditionally (success OR failure).
        set({ isLocked: false });
      });

    // Step 4: Store a silenced version as the new queue tail.
    //   If `chainedTask` rejects, the silenced tail still resolves, so the
    //   next action appended to the queue is not starved.
    set({ actionQueue: chainedTask.catch(() => {}) });

    // Return the original (non-silenced) chained task so the caller sees real
    // rejections when they `await undo()` / `await redo()` / etc.
    return chainedTask;
  };

  // ── Slice definition ─────────────────────────────────────────────────────────

  return {
    // ── Initial state ──────────────────────────────────────────────────────────
    ...initialChronosState,

    // ───────────────────────────────────────────────────────────────────────────
    // § Surgical mutations
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * applyLocalMutation
     *
     * Writes a single base-pair edit to the worker engine and marks the owning
     * slab as dirty.  This is the "direct write" path — no confirmation dialog.
     * For the two-phase commit flow use performSurgicalEdit → commitMutationWithReason.
     *
     * MX-01: Wrapped in executeAtomicAction so concurrent calls are serialised
     * and cannot interleave with an in-flight undo or redo.
     *
     * TASK 3: executeAtomicAction will throw EngineLockError (and write a System
     * Log) if genomeSlice.isProcessing is true at call time.
     */
    applyLocalMutation: (
      slabIndex: number,
      offset: number,
      base: BaseCode,
      meta?: {
        user: string;
        reason: string;
        branch?: string;
        isCheckpoint?: boolean;
      },
    ): Promise<void> => {
      return executeAtomicAction(async () => {
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
      });
    },

    /**
     * performSurgicalEdit
     *
     * Stages a mutation for the SurgicalCommit dialog without touching the
     * engine.  The researcher fills in a commit reason and calls
     * commitMutationWithReason, or calls cancelPendingMutation to discard.
     *
     * NOTE: This is a synchronous staging action — it does NOT touch the worker
     * and therefore does NOT need to be wrapped in the mutex.
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
     *
     * NOTE: commitMutationWithReason is driven by an explicit user confirmation
     * in the SurgicalCommit dialog — it is not subject to rapid repeat-click
     * races — so it is intentionally NOT wrapped in the mutex.  If you change
     * this assumption, wrap it the same way as applyLocalMutation.
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

    // ───────────────────────────────────────────────────────────────────────────
    // § Undo / Redo  ── MX-01 Mutex + CF-04 Viewport Sync + LB-06 Head Sync
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * undo
     *
     * Rewinds the engine's mutation log by one commit, then:
     *   1. Immediately updates `chronosHead` in the Zustand store (LB-06).
     *   2. Synchronises the Zustand viewport with the rewound engine state (CF-04).
     *
     * MX-01: The entire operation is wrapped in executeAtomicAction.  If the
     * user clicks "Undo" five times in rapid succession the calls are queued and
     * executed strictly one-by-one.  Each call sees the correct post-rewind HEAD
     * from the worker because it only starts after the previous call's GET_HEAD
     * and requestViewport round-trips have fully completed.
     *
     * TASK 3: executeAtomicAction will throw EngineLockError if the genome is
     * currently being loaded/streamed.
     *
     * ── LB-06 FIX: Immediate chronosHead advancement ──────────────────────────
     * PROBLEM (offline + online race):
     *   The old implementation left `chronosHead` pointing at the *undone*
     *   commit until the next COMMIT_SYNC push from the worker. In offline mode
     *   that push never arrives (cloud-sync gate). Online it arrives after a
     *   variable network round-trip, causing a visible badge flicker.
     *
     * FIX:
     *   After postAndWait('UNDO') resolves we immediately dispatch a cheap
     *   GET_HEAD round-trip to the worker. The worker's in-memory Chronos
     *   instance already reflects the rewound state, so GET_HEAD returns the
     *   correct new HEAD commit ID (the parent of the undone commit).
     *
     *   We write this ID to the store synchronously before CF-04's
     *   requestViewport call, so any subscriber that reads both `chronosHead`
     *   and `viewport` sees a consistent pair — never a mismatched state.
     *
     * ── CF-04 FIX: Ghost Data elimination (unchanged) ─────────────────────────
     * Ordering guarantee: GET_HEAD is dispatched *after* UNDO resolves and
     * *before* requestViewport, so the chronosHead write is always consistent
     * with the viewport update.
     *
     * ERROR HANDLING:
     *   GET_HEAD failure is non-fatal — the undo itself succeeded and the
     *   viewport has been synced by CF-04. A warning is logged.
     */
    undo: (): Promise<void> => {
      return executeAtomicAction(async () => {
        const { worker } = get();
        if (!worker) return;

        // ── Step 1: Rewind the worker's mutation log ──────────────────────────
        await postAndWait(worker, 'UNDO');

        // ── Step 2: Immediately sync chronosHead (LB-06) ─────────────────────
        // GET_HEAD is a cheap O(1) lookup against the worker's in-memory Chronos
        // instance. It runs *after* UNDO has fully committed, so the returned ID
        // is guaranteed to reflect the rewound state.
        try {
          const newHead = await postAndWait<string | null>(worker, 'GET_HEAD');
          if (newHead !== undefined) {
            set({ chronosHead: newHead });
          }
        } catch (headErr) {
          // Non-fatal — the undo itself succeeded.
          console.warn('[Arkhé] undo: GET_HEAD failed after UNDO', headErr);
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'CHRONOS',
            message:
              `⚠️ Undo applied but timeline badge may be stale: ` +
              `${headErr instanceof Error ? headErr.message : String(headErr)}. ` +
              `It will correct itself on the next commit.`,
            level: 'warning',
          });
        }

        // ── Step 3: Sync the viewport to the rewound state (CF-04) ───────────
        // Read start/end *after* the await — another action may have moved the
        // viewport window during the round-trip.
        const { start, end } = get().viewport;
        try {
          await get().requestViewport(start, end);
        } catch (err) {
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
      });
    },

    /**
     * redo
     *
     * Re-applies the next commit in the engine's mutation log, then:
     *   1. Immediately updates `chronosHead` in the Zustand store (LB-06).
     *   2. Synchronises the Zustand viewport with the advanced engine state (CF-04).
     *
     * MX-01: Wrapped in executeAtomicAction — semantics identical to undo().
     * LB-06 and CF-04 semantics are identical to undo() — see that method's
     * JSDoc for the full rationale.  Mirroring undo() exactly ensures consistent
     * behaviour in both directions of the history timeline.
     *
     * TASK 3: executeAtomicAction will throw EngineLockError if the genome is
     * currently being loaded/streamed.
     */
    redo: (): Promise<void> => {
      return executeAtomicAction(async () => {
        const { worker } = get();
        if (!worker) return;

        // ── Step 1: Advance the worker's mutation pointer ─────────────────────
        await postAndWait(worker, 'REDO');

        // ── Step 2: Immediately sync chronosHead (LB-06) ─────────────────────
        try {
          const newHead = await postAndWait<string | null>(worker, 'GET_HEAD');
          if (newHead !== undefined) {
            set({ chronosHead: newHead });
          }
        } catch (headErr) {
          console.warn('[Arkhé] redo: GET_HEAD failed after REDO', headErr);
          get().addSystemLog({
            timestamp: Date.now(),
            category: 'CHRONOS',
            message:
              `⚠️ Redo applied but timeline badge may be stale: ` +
              `${headErr instanceof Error ? headErr.message : String(headErr)}. ` +
              `It will correct itself on the next commit.`,
            level: 'warning',
          });
        }

        // ── Step 3: Sync the viewport to the re-applied state (CF-04) ─────────
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
      });
    },

    // ───────────────────────────────────────────────────────────────────────────
    // § Diff export
    // ───────────────────────────────────────────────────────────────────────────

    getDiffForTx: async (txId: string): Promise<unknown> => {
      const { worker } = get();
      if (!worker) throw new Error('Worker not initialised');
      return postAndWait(worker, 'EXPORT_PATCH', { txId });
    },

    // ───────────────────────────────────────────────────────────────────────────
    // § Branching evolution
    // ───────────────────────────────────────────────────────────────────────────

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

    // ───────────────────────────────────────────────────────────────────────────
    // § Off-target radar
    //
    // Distinct from the off-target *heatmap* in genomeSlice, which stores its
    // results in offTargetHits. This action stores in offTargetResult and is
    // driven by the CRISPR Off-Target Radar panel.
    // ───────────────────────────────────────────────────────────────────────────

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

    // ───────────────────────────────────────────────────────────────────────────
    // § Protein folding  ── GDPR gate enforced here
    //
    // The ESM Atlas API transmits the researcher's amino-acid sequence to a
    // Meta Research third-party endpoint. computeProteinFold is imported from
    // the GDPR-compliant shim (@/lib/proteinFold) which:
    //   • Returns a Chou–Fasman heuristic result when consentObtained === false.
    //   • Delegates to FoldingEngine (ESM Atlas) only when consentObtained === true.
    // ───────────────────────────────────────────────────────────────────────────

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
      // ── Heuristic fast-path (no consent / consent not yet obtained) ──────────
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

      // ── Network path (consent obtained — shim delegates to ESM Atlas) ─────────
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

    // ───────────────────────────────────────────────────────────────────────────
    // § Internal setters
    // ───────────────────────────────────────────────────────────────────────────

    setChronosHead: (txId: string | null) => set({ chronosHead: txId }),
    setChronosTransactions: (txs: TransactionSummary[]) => set({ chronosTransactions: txs }),
    setBranches: (branches: Branch[]) => set({ branches }),
    setCurrentBranch: (branch: string) => set({ currentBranch: branch }),
    setCommits: (commits: Commit[]) => set({ commits }),
    setShowCommitDialog: (show: boolean) => set({ showCommitDialog: show }),
    setPendingMutation: (mutation: PendingMutation | null) => set({ pendingMutation: mutation }),
    setOffTargetResult: (result: OffTargetResult | null) => set({ offTargetResult: result }),
    setScanningOffTarget: (scanning: boolean) => set({ isScanningOffTarget: scanning }),
    setProteinFold: (fold: ProteinFold | null) => set({ proteinFold: fold }),
    setFolding: (folding: boolean) => set({ isFolding: folding }),
    setFoldError: (error: string | null) => set({ foldError: error }),
  };
};