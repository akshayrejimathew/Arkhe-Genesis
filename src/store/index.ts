/**
 * src/store/index.ts
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 * Barrel that assembles the three Zustand slices into the single unified
 * `useArkheStore` hook that every component in the application imports.
 *
 * The public API of this file is IDENTICAL to the original monolithic
 * useArkheStore.ts — every hook selector is re-exported with its original
 * name so no component import needs to change.
 *
 * ── ASSEMBLY PATTERN ─────────────────────────────────────────────────────────
 *
 *   create<ArkheState>()(
 *     subscribeWithSelector((...args) => ({
 *       ...createGenomeSlice(...args),
 *       ...createChronosSlice(...args),
 *       ...createUISlice(...args),
 *     }))
 *   )
 *
 * Each slice factory receives the same (set, get, api) triplet.  Because all
 * three factories are typed StateCreator<ArkheState, …>, set() and get() see
 * the full combined state — cross-slice calls are type-safe and have no
 * circular import paths.
 *
 * ── SPREAD ORDER ─────────────────────────────────────────────────────────────
 *
 *   1. genomeSlice  — worker, file I/O, viewport, simulation, slab management
 *   2. chronosSlice — mutations, undo/redo, branching, off-target radar,
 *                     protein folding
 *   3. uiSlice      — auth, sovereign mode, sentinel, terminal, system logging
 *
 * Fields that appear in multiple slice initial states (orfScanResult,
 * isORFScanning) initialise to the same null / false default in all slices;
 * the last spread wins at runtime, which is fine.  Action implementations are
 * NOT duplicated — each action is defined in exactly one slice.
 *
 * ── SUBSCRIBEWITSSELECTOR MIDDLEWARE ─────────────────────────────────────────
 *
 * subscribeWithSelector enables granular field subscriptions via
 * useArkheStore.subscribe((state) => state.someField, callback)
 * without triggering re-renders for unrelated state changes.
 * The StoreMutators alias in types.ts encodes this middleware so all three
 * StateCreator declarations are correctly typed.
 *
 * ── SELECTOR PATTERN ─────────────────────────────────────────────────────────
 *
 * All exported selectors are fine-grained — they extract a single primitive
 * or stable reference — which means components only re-render when their
 * specific slice of state changes.  The naming convention is:
 *
 *   use<FieldName>  → e.g. useGenomeLength, useIsSyncing
 *
 * This matches the original monolithic export surface exactly so no component
 * imports break during the refactor.
 *
 * ── MX-01 NOTE ───────────────────────────────────────────────────────────────
 *
 * `actionQueue` is a non-serialisable Promise<void>.  It is intentionally
 * excluded from the selector surface — components should never read it
 * directly.  Use `useIsLocked` to detect whether an atomic action is in
 * flight and conditionally render a loading / disabled state.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
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
  subscribeWithSelector((...args) => ({
    // Order matters for override precedence when two slices initialise the
    // same field.  The last spread wins.  See "Spread Order" in the file
    // header for the rationale behind this ordering.
    ...createGenomeSlice(...args),
    ...createChronosSlice(...args),
    ...createUISlice(...args),
  })),
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

/**
 * Feature tags visible in the current viewport window.
 *
 * NOTE: The redundant top-level `features` array was removed in the State
 * Bloat Fix.  All feature data lives exclusively in viewport.features.
 * This selector returns an empty array (not undefined) so consumers do not
 * need to null-check.
 */
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

/**
 * useIsLocked
 *
 * Returns `true` while any atomic chronos action (undo, redo,
 * applyLocalMutation) is executing inside the sequential execution queue.
 *
 * Usage:
 *
 *   const isLocked = useIsLocked();
 *
 *   <button disabled={isLocked} onClick={undo}>
 *     {isLocked ? <Spinner /> : 'Undo'}
 *   </button>
 *
 * This selector is the ONLY intended way to observe the mutex state from
 * React components.  Do NOT read `actionQueue` from the store — it is a
 * non-serialisable Promise and is not stable across renders.
 */
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

/**
 * Full Supabase User object — null when the researcher is a guest or has not
 * signed in.  Use this in components that need email or user metadata.
 */
export const useUser = () =>
  useArkheStore((s) => s.user);

/**
 * True when the circuit breaker has tripped on a 413 or 429 response.
 * Show a banner with a "Reconnect" button that calls resetCircuitBreaker().
 */
export const useIsOfflineMode = () =>
  useArkheStore((s) => s.isOfflineMode);

/**
 * Human-readable reason why offline mode was engaged.
 * Display adjacent to the offline mode banner to explain the situation.
 */
export const useOfflineModeReason = () =>
  useArkheStore((s) => s.offlineModeReason);

/**
 * True when custom Supabase URL + key are active in localStorage.
 * Controls whether the Sovereignty Settings panel shows the "Active" badge.
 */
export const useSovereignModeActive = () =>
  useArkheStore((s) => s.sovereignModeActive);