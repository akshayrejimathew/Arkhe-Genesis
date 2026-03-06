/**
 * src/store/index.ts
 *
 * ── SPRINT 2 CHANGES ─────────────────────────────────────────────────────────
 *   TASK 2: UI State Persistence
 *     • persist middleware imported from 'zustand/middleware'.
 *     • The combined StateCreator is wrapped with persist (inside
 *       subscribeWithSelector) so that the three fields below survive
 *       a page reload:
 *
 *         themeMode      — user's chosen Abyssal / Clean Room theme
 *         terminalLogs   — system log ring buffer
 *         terminalOutput — raw terminal output lines
 *
 *     • Storage key: 'arkhe-ui-storage'
 *     • partialize() strips all genome / chronos state — only the named UI
 *       fields are written to localStorage, keeping the payload tiny and
 *       avoiding non-serialisable fields (Worker, ArrayBuffer, Promises).
 *
 * ── Middleware stack (outer → inner) ──────────────────────────────────────────
 *
 *   create<ArkheState>()(
 *     subscribeWithSelector(       ← adds .subscribe(selector, callback) API
 *       persist(                   ← serialises partialised state to localStorage
 *         (...args) => ({          ← combined StateCreator
 *           ...genomeSlice,
 *           ...chronosSlice,
 *           ...uiSlice,
 *         }),
 *         { name, partialize }
 *       )
 *     )
 *   )
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Barrel that assembles the three Zustand slices into the single unified
 * `useArkheStore` hook that every component in the application imports.
 *
 * The public API of this file is IDENTICAL to the original monolithic
 * useArkheStore.ts — every hook selector is re-exported with its original
 * name so no component import needs to change.
 */

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { createGenomeSlice } from './genomeSlice';
import { createChronosSlice } from './chronosSlice';
import { createUISlice } from './uiSlice';
import type { ArkheState } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// § The Store
//
// CRITICAL: The hook is named `useArkheStore` — identical to the original
// monolithic export — so all existing component imports require no changes.
// ─────────────────────────────────────────────────────────────────────────────

export const useArkheStore = create<ArkheState>()(
  subscribeWithSelector(
    persist(
      (...args) => ({
        // Order matters for override precedence when two slices initialise the
        // same field.  The last spread wins.  See "Spread Order" in the file
        // header for the rationale behind this ordering.
        ...createGenomeSlice(...args),
        ...createChronosSlice(...args),
        ...createUISlice(...args),
      }),
      {
        // ── SPRINT 2: Persistence config ──────────────────────────────────
        name: 'arkhe-ui-storage',

        /**
         * partialize
         *
         * Only the three UI fields are written to localStorage. All genome,
         * chronos, worker, and buffer state is intentionally excluded:
         *
         *   • Non-serialisable: Worker, ArrayBuffer, SharedArrayBuffer,
         *     Promise (actionQueue), Map, Set — would throw on JSON.stringify.
         *
         *   • Stale on reload: viewport sequence, PCR results, slab metas
         *     are derived from the engine worker and must be re-fetched on
         *     every session — persisting them would serve stale data.
         *
         *   • Auth: user / userId come from Supabase's own session system
         *     and are restored by the Supabase client on boot — no need to
         *     duplicate them in Zustand persist storage.
         */
        partialize: (state) => ({
          themeMode:      state.themeMode,
          terminalLogs:   state.terminalLogs,
          terminalOutput: state.terminalOutput,
        }),
      },
    ),
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// § Type re-exports
//
// Components that need to reference store types can import them from the
// barrel rather than navigating to types.ts directly.
// ─────────────────────────────────────────────────────────────────────────────

export type { ArkheState, Viewport, PendingMutation, ProteinFold } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Genome / Worker
// ─────────────────────────────────────────────────────────────────────────────

/** Raw ArrayBuffer / SharedArrayBuffer from the latest LOAD_SLICE response. */
export const useViewportBuffer = () =>
  useArkheStore((s) => s.viewport.buffer);

/** Decoded nucleotide string from the latest LOAD_SLICE response. */
export const useViewportSequence = () =>
  useArkheStore((s) => s.viewport.sequence);

/** All six reading-frame translations from the latest LOAD_SLICE response. */
export const useViewportTranslations = () =>
  useArkheStore((s) => s.viewport.translations);

/** GC percentage of the current viewport window. */
export const useViewportGC = () =>
  useArkheStore((s) => s.viewport.gcPercent);

/** LB-11/14: Viewport version counter for React Concurrent mode safety. */
export const useViewportVersion = () =>
  useArkheStore((s) => s.viewportVersion);

export const useViewportFeatures = () =>
  useArkheStore((s) => s.viewport.features ?? []);

/** ORFs intersecting the current viewport window. */
export const useViewportORFs = () =>
  useArkheStore((s) => s.viewport.orfs);

/** Predicted splice sites in the current viewport window. */
export const useViewportSpliceSites = () =>
  useArkheStore((s) => s.viewport.spliceSites);

/** Predicted isoforms derived from splice sites in the current viewport. */
export const useViewportIsoforms = () =>
  useArkheStore((s) => s.viewport.isoforms);

/** Protein properties computed for the viewport's primary ORF. */
export const useViewportProteinProperties = () =>
  useArkheStore((s) => s.viewport.proteinProperties);

/** Total loaded genome length in base-pairs. */
export const useGenomeLength = () =>
  useArkheStore((s) => s.genomeLength);

/** True when the engine worker has completed its INIT handshake. */
export const useIsWorkerConnected = () =>
  useArkheStore((s) => s.workerConnected);

/** Last worker error message, or null when healthy. */
export const useWorkerError = () =>
  useArkheStore((s) => s.workerError);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Simulation
// ─────────────────────────────────────────────────────────────────────────────

export const usePCRResults = () =>
  useArkheStore((s) => s.pcrResults);

export const useIsRunningPCR = () =>
  useArkheStore((s) => s.isRunningPCR);

export const useRestrictionSites = () =>
  useArkheStore((s) => s.restrictionSites);

export const useRadarData = () =>
  useArkheStore((s) => s.radarData);

export const useIsExporting = () =>
  useArkheStore((s) => s.isExporting);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Sentinel
// ─────────────────────────────────────────────────────────────────────────────

export const useSentinelData = () =>
  useArkheStore((s) => s.sentinelData);

export const useIsSentinelScanning = () =>
  useArkheStore((s) => s.isSentinelScanning);

export const useSentinelHazards = () =>
  useArkheStore((s) => s.sentinelHazards);

export const useIsAuditing = () =>
  useArkheStore((s) => s.isAuditing);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — ORF Autopilot
// ─────────────────────────────────────────────────────────────────────────────

export const useORFScanResult = () =>
  useArkheStore((s) => s.orfScanResult);

export const useIsORFScanning = () =>
  useArkheStore((s) => s.isORFScanning);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Off-Target Radar
// ─────────────────────────────────────────────────────────────────────────────

export const useOffTargetResult = () =>
  useArkheStore((s) => s.offTargetResult);

export const useIsScanningOffTarget = () =>
  useArkheStore((s) => s.isScanningOffTarget);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Synteny
// ─────────────────────────────────────────────────────────────────────────────

export const useSyntenyAnchors = () =>
  useArkheStore((s) => s.syntenyAnchors);

export const useIsScanningSynteny = () =>
  useArkheStore((s) => s.isScanningSynteny);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Protein Folding
// ─────────────────────────────────────────────────────────────────────────────

export const useProteinFold = () =>
  useArkheStore((s) => s.proteinFold);

export const useIsFolding = () =>
  useArkheStore((s) => s.isFolding);

export const useFoldError = () =>
  useArkheStore((s) => s.foldError);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Chronos / Branching
// ─────────────────────────────────────────────────────────────────────────────

export const useBranches = () =>
  useArkheStore((s) => s.branches);

export const useCurrentBranch = () =>
  useArkheStore((s) => s.currentBranch);

export const useCommits = () =>
  useArkheStore((s) => s.commits);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Async Mutex (MX-01)
// ─────────────────────────────────────────────────────────────────────────────

export const useIsLocked = () =>
  useArkheStore((s) => s.isLocked);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Surgical Commit
// ─────────────────────────────────────────────────────────────────────────────

export const useShowCommitDialog = () =>
  useArkheStore((s) => s.showCommitDialog);

export const usePendingMutation = () =>
  useArkheStore((s) => s.pendingMutation);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Terminal
// ─────────────────────────────────────────────────────────────────────────────

export const useTerminalOutput = () =>
  useArkheStore((s) => s.terminalOutput);

export const useTerminalInput = () =>
  useArkheStore((s) => s.terminalInput);

export const useIsExecuting = () =>
  useArkheStore((s) => s.isExecuting);

export const useTerminalLogs = () =>
  useArkheStore((s) => s.terminalLogs);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Cloud / Persistence
// ─────────────────────────────────────────────────────────────────────────────

export const useActiveGenomeId = () =>
  useArkheStore((s) => s.activeGenomeId);

export const useIsSyncing = () =>
  useArkheStore((s) => s.isSyncing);

/** @deprecated Prefer useUser() which returns the full Supabase User object. */
export const useUserId = () =>
  useArkheStore((s) => s.userId);

export const usePublicGenomes = () =>
  useArkheStore((s) => s.publicGenomes);

export const useIsLoadingPublic = () =>
  useArkheStore((s) => s.isLoadingPublic);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Diff Mode & Off-Target Heatmap
// ─────────────────────────────────────────────────────────────────────────────

export const useComparisonSequence = () =>
  useArkheStore((s) => s.comparisonSequence);

export const useDiffMode = () =>
  useArkheStore((s) => s.diffMode);

export const useOffTargetHits = () =>
  useArkheStore((s) => s.offTargetHits);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Sentinel Threat Screening
// ─────────────────────────────────────────────────────────────────────────────

export const useSentinelLibrary = () =>
  useArkheStore((s) => s.sentinelLibrary);

export const useThreatMatches = () =>
  useArkheStore((s) => s.threatMatches);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — Sprint 3: Auth + Offline + Sovereign
// ─────────────────────────────────────────────────────────────────────────────

export const useUser = () =>
  useArkheStore((s) => s.user);

export const useIsOfflineMode = () =>
  useArkheStore((s) => s.isOfflineMode);

export const useOfflineModeReason = () =>
  useArkheStore((s) => s.offlineModeReason);

export const useSovereignModeActive = () =>
  useArkheStore((s) => s.sovereignModeActive);

// ─────────────────────────────────────────────────────────────────────────────
// § Selectors — SPRINT 2: Theme
// ─────────────────────────────────────────────────────────────────────────────

/** The active colour theme. Rehydrated from 'arkhe-ui-storage' on boot. */
export const useThemeMode = () =>
  useArkheStore((s) => s.themeMode);