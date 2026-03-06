'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, RotateCw, ZoomIn, ZoomOut, Maximize2, Sparkles } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import type { ProteinFold } from '@/types/arkhe';

/**
 * PROTEIN VIEWPORT — 3D Molecular Viewer
 *
 * ── SPRINT B CHANGES ─────────────────────────────────────────────────────────
 *
 *   TASK 3 — Chou-Fasman legacy algorithm disclaimer:
 *     When proteinFold.method === 'CHOU_FASMAN_HEURISTIC', a permanently
 *     visible yellow badge now reads:
 *       "Warning: Legacy Algorithm (1974). Not for publication."
 *     This text is appended beneath the existing clinical warning so that
 *     researchers are always aware of the algorithm's limitations.
 *
 *   TASK 4 — High-Fidelity Fold button (ESM Atlas):
 *     If the current fold used Chou-Fasman AND the sequence is < 400 aa,
 *     a "High-Fidelity Fold" button appears in the top-right corner.
 *     Clicking it calls store.foldProtein(aminoAcids, true) to request
 *     a publication-grade ESM Atlas fold.  The button is hidden while
 *     folding is in progress (isFolding === true) and disappears once a
 *     successful ESM_ATLAS result is loaded.
 *
 * ── AUDIT III FIXES (2026-02-21, retained) ───────────────────────────────────
 *
 *   FIX 1 — Removed unsafe type cast (SHADOW-04):
 *     No `as ExtendedProteinFold` cast — `ProteinFold` from '@/types/arkhe'
 *     is the canonical definition and carries all required fields.
 *
 *   FIX 2 — useRef for all rotation / zoom math (Vector H):
 *     All mutable animation state is stored in refs.  React state is used
 *     only for `isLoading` and `zoom` (button labels).  The RAF loop never
 *     calls setState.
 *
 *   FIX 3 — Scientific honesty badge z-index raised to z-[99999]:
 *     The warning badge container uses z-[99999] so it can never be occluded
 *     by any Tailwind utility class (max z-50) or Radix overlay (z-[9999]).
 */
export default function ProteinViewport() {
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const rotationRef       = useRef({ x: 0, y: 0 });
  const zoomRef           = useRef(1);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const autoRotateRef     = useRef(true);
  const isDraggingRef     = useRef(false);
  const lastXRef          = useRef(0);
  const lastYRef          = useRef(0);
  const lastTimestampRef  = useRef<number | undefined>(undefined);

  // React state: only values that drive DOM output
  const [isLoading, setIsLoading] = useState(true);
  const [zoom, setZoom]           = useState(1);

  // ── Store selectors ──────────────────────────────────────────────────────
  const proteinFold = useArkheStore(
    (state: ArkheState) => state.proteinFold as ProteinFold | null,
  );
  const isFolding   = useArkheStore((state: ArkheState) => state.isFolding);
  const foldProtein = useArkheStore((state: ArkheState) => state.foldProtein);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // ── Derived flags ────────────────────────────────────────────────────────
  // Show the High-Fidelity button when:
  //   • Current fold used the legacy Chou-Fasman heuristic
  //   • Sequence is short enough for the ESM Atlas API (< 400 aa)
  //   • We are not currently running a fold
  const showHiFiButton =
    proteinFold !== null &&
    proteinFold.method === 'CHOU_FASMAN_HEURISTIC' &&
    proteinFold.aminoAcids.length < 400 &&
    !isFolding;

  // ── High-Fidelity fold trigger ───────────────────────────────────────────
  const handleHighFidelityFold = useCallback(async () => {
    if (!proteinFold || isFolding) return;
    try {
      await foldProtein(proteinFold.aminoAcids, /* consentObtained */ true);
    } catch {
      // Errors are surfaced through the store's foldError field and via
      // the system log — no local error state needed here.
    }
  }, [proteinFold, isFolding, foldProtein]);

  // ── Core RAF render loop ─────────────────────────────────────────────────
  // All mutable animation values are accessed via refs — zero re-renders.
  const startRenderLoop = useCallback(
    (
      canvas: HTMLCanvasElement,
      ctx: CanvasRenderingContext2D,
      coordinates: Array<{ x: number; y: number; z: number }>,
      secondaryStructure: Array<'alpha' | 'beta' | 'coil'>,
    ) => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      const project = (
        point: { x: number; y: number; z: number },
        rotX: number,
        rotY: number,
        z: number,
      ) => {
        const x  = point.x * Math.cos(rotY) - point.z * Math.sin(rotY);
        const z1 = point.x * Math.sin(rotY) + point.z * Math.cos(rotY);
        const y  = point.y * Math.cos(rotX) - z1 * Math.sin(rotX);
        const z2 = point.y * Math.sin(rotX) + z1 * Math.cos(rotX);
        const perspective = 400;
        const scale = (perspective / (perspective + z2)) * z;
        return {
          x: x * scale + canvas.width  / (2 * window.devicePixelRatio),
          y: y * scale + canvas.height / (2 * window.devicePixelRatio),
          z: z2,
        };
      };

      const render = (timestamp: number) => {
        const dt =
          lastTimestampRef.current === undefined
            ? 16
            : Math.min(timestamp - lastTimestampRef.current, 100);
        lastTimestampRef.current = timestamp;

        const width  = canvas.width  / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);

        if (autoRotateRef.current) {
          rotationRef.current.y += 0.005 * (dt / 16);
        }

        const rotX   = rotationRef.current.x;
        const rotY   = rotationRef.current.y;
        const zLevel = zoomRef.current;

        type ProjectedPoint = {
          x: number; y: number; z: number;
          index: number;
          secondaryStructure: 'alpha' | 'beta' | 'coil';
        };

        const projected: ProjectedPoint[] = coordinates
          .map((coord, i): ProjectedPoint => ({
            ...project(coord, rotX, rotY, zLevel),
            index: i,
            secondaryStructure: secondaryStructure[i],
          }))
          .sort((a, b) => a.z - b.z);

        // Bonds
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        for (let i = 0; i < projected.length - 1; i++) {
          const curr = projected[i];
          const next = projected[i + 1];
          const opacity = Math.max(0.2, Math.min(1, (curr.z + 200) / 400));
          let color: string;
          switch (curr.secondaryStructure) {
            case 'alpha': color = `rgba(134,239,172,${opacity})`; break;
            case 'beta':  color = `rgba(253,164,175,${opacity})`; break;
            default:      color = `rgba(148,163,184,${opacity})`; break;
          }
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth   = 2;
          ctx.moveTo(curr.x, curr.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }

        // Atoms
        projected.forEach(point => {
          const opacity = Math.max(0.3, Math.min(1, (point.z + 200) / 400));
          const size    = 3 + opacity * 2;
          let color: string;
          switch (point.secondaryStructure) {
            case 'alpha': color = `rgba(134,239,172,${opacity})`; break;
            case 'beta':  color = `rgba(253,164,175,${opacity})`; break;
            default:      color = `rgba(148,163,184,${opacity})`; break;
          }
          ctx.shadowBlur  = 8;
          ctx.shadowColor = color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // Grid reference lines
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        animationFrameRef.current = requestAnimationFrame(render);
      };

      animationFrameRef.current = requestAnimationFrame(render);
    },
    [],
  );

  // ── Main effect — fires only when proteinFold changes ────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setSize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    setSize();

    if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
    const ro = new ResizeObserver(() => setSize());
    ro.observe(canvas);
    resizeObserverRef.current = ro;

    setIsLoading(false);

    if (!proteinFold?.coordinates?.length) {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.fillStyle    = '#09090b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle    = '#71717a';
      ctx.font         = '14px var(--font-inter)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Select a gene to fold', w / 2, h / 2);
      return;
    }

    lastTimestampRef.current = undefined;
    startRenderLoop(canvas, ctx, proteinFold.coordinates, proteinFold.secondaryStructure);

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      autoRotateRef.current = false;
      lastXRef.current      = e.clientX;
      lastYRef.current      = e.clientY;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastXRef.current;
      const dy = e.clientY - lastYRef.current;
      rotationRef.current.x += dy * 0.01;
      rotationRef.current.y += dx * 0.01;
      lastXRef.current       = e.clientX;
      lastYRef.current       = e.clientY;
    };
    const handleMouseUp = () => { isDraggingRef.current = false; };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup',   handleMouseUp);

    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup',   handleMouseUp);
    };
  }, [proteinFold, startRenderLoop]);

  // ── Control handlers ─────────────────────────────────────────────────────
  const handleReset = () => {
    rotationRef.current   = { x: 0, y: 0 };
    zoomRef.current       = 1;
    setZoom(1);
    autoRotateRef.current = true;
  };
  const handleZoomIn  = () => { zoomRef.current = Math.min(zoomRef.current + 0.2, 3);   setZoom(zoomRef.current); };
  const handleZoomOut = () => { zoomRef.current = Math.max(zoomRef.current - 0.2, 0.5); setZoom(zoomRef.current); };

  // ─────────────────────────────────────────────────────────────────────────
  // § Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full bg-void rounded-lg overflow-hidden border border-razor">

      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-void z-10">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-600 mx-auto mb-3" />
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Loading structure...
            </p>
          </div>
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing crt-scanlines"
        style={{ display: isLoading ? 'none' : 'block' }}
      />

      {/*
        ══════════════════════════════════════════════════════════════════════
        TOP-LEFT — Scientific Honesty Badges  (z-[99999])
        ══════════════════════════════════════════════════════════════════════
        FIX 1:  No type cast — ProteinFold is imported from '@/types/arkhe'.
        FIX 3:  z-[99999] exceeds all Tailwind utilities (max z-50) and Radix
                overlays (z-[9999]) — this badge can never be occluded.
        SPRINT B TASK 3: "Legacy Algorithm (1974)" subtitle added beneath the
                clinical warning when method === 'CHOU_FASMAN_HEURISTIC'.
      */}
      {!isLoading && proteinFold && (
        <div className="absolute top-4 left-4 z-[99999] flex flex-col gap-2 max-w-[240px] isolate">

          {/* ── Method Badge ─────────────────────────────────────────────── */}
          {proteinFold.method && (
            <div className="bg-void-panel/95 backdrop-blur-sm border border-razor rounded-md px-3 py-2 shadow-lg">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">
                Folding Method
              </div>
              <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-mono font-semibold">
                {proteinFold.method === 'ESM_ATLAS' ? 'ESM Atlas' : 'Chou-Fasman Heuristic'}
              </div>
            </div>
          )}

          {/*
            ── Clinical Warning badge ──────────────────────────────────────
            Present whenever method === 'CHOU_FASMAN_HEURISTIC'.
            MUST remain permanently visible — never hidden or toggled off.

            SPRINT B TASK 3: Added "Legacy Algorithm (1974). Not for
            publication." as a mandatory subtitle beneath the clinical warning
            to flag that this algorithm predates modern structural biology.
          */}
          {proteinFold.method === 'CHOU_FASMAN_HEURISTIC' && (
            <div className="bg-yellow-500/15 backdrop-blur-sm border border-yellow-400/50 rounded-md px-3 py-2 shadow-lg z-[99999] isolate">
              <div className="flex items-start gap-2">
                {/* Warning triangle SVG */}
                <svg
                  className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0
                       2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732
                       0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <div>
                  {/* Clinical disclaimer from store (may vary) */}
                  {proteinFold.warning && (
                    <div className="text-[10px] text-yellow-300 font-mono font-bold leading-relaxed">
                      {proteinFold.warning}
                    </div>
                  )}
                  {/*
                    ── SPRINT B TASK 3: Mandatory legacy algorithm notice ──
                    Displayed regardless of whether proteinFold.warning is
                    populated, so it cannot be suppressed by the server.
                  */}
                  <div className="text-[9px] text-yellow-400/80 font-mono mt-1 leading-snug border-t border-yellow-400/20 pt-1">
                    ⚠ Legacy Algorithm (1974).{' '}
                    <span className="font-bold text-yellow-300">Not for publication.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/*
            ── Rate-limit / consent notice (orange) ───────────────────────
            Set when ESM Atlas returned HTTP 429 and we fell back to the
            heuristic.  Distinct from the yellow clinical warning.
          */}
          {proteinFold.rateLimitNotice && (
            <div className="bg-orange-500/10 backdrop-blur-sm border border-orange-400/40 rounded-md px-3 py-2 shadow-lg">
              <div className="text-[10px] text-orange-300 font-mono leading-relaxed">
                {proteinFold.rateLimitNotice}
              </div>
            </div>
          )}

          {/* ── GDPR Disclosure (blue) ───────────────────────────────────── */}
          {proteinFold.disclosure && (
            <div className="bg-blue-500/10 backdrop-blur-sm border border-blue-400/30 rounded-md px-3 py-2 shadow-lg">
              <div className="text-[9px] text-blue-300 font-mono leading-relaxed opacity-80">
                {proteinFold.disclosure}
              </div>
            </div>
          )}
        </div>
      )}

      {/*
        ══════════════════════════════════════════════════════════════════════
        TOP-RIGHT — High-Fidelity Fold button  (z-[99999])
        ══════════════════════════════════════════════════════════════════════
        SPRINT B TASK 4:
          Visible when:
            • proteinFold.method === 'CHOU_FASMAN_HEURISTIC'
            • proteinFold.aminoAcids.length < 400 aa
            • !isFolding
          Triggers store.foldProtein(aminoAcids, consentObtained=true) to
          request a publication-grade ESM Atlas fold.
      */}
      {!isLoading && showHiFiButton && (
        <div className="absolute top-4 right-4 z-[99999]">
          <button
            onClick={() => void handleHighFidelityFold()}
            disabled={isFolding}
            title="Request a publication-grade ESM Atlas fold (sequence < 400 aa)"
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono font-semibold',
              'bg-violet-500/15 border border-violet-400/50 text-violet-300',
              'hover:bg-violet-500/25 hover:border-violet-400/80 hover:text-violet-200',
              'transition-all duration-150 shadow-lg backdrop-blur-sm',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {isFolding ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Folding…
              </>
            ) : (
              <>
                <Sparkles size={11} />
                High-Fidelity Fold
              </>
            )}
          </button>
          <div className="text-[9px] text-zinc-600 mt-1 text-right font-mono">
            ESM Atlas · {proteinFold?.aminoAcids.length} aa
          </div>
        </div>
      )}

      {/* Folding spinner overlay when High-Fidelity fold is in progress */}
      {isFolding && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] z-[9000]">
          <div className="text-center bg-void-panel border border-razor rounded-lg px-6 py-4 shadow-2xl">
            <Loader2 className="w-8 h-8 animate-spin text-violet-400 mx-auto mb-3" />
            <p className="text-xs text-violet-300 font-mono font-semibold tracking-wider">
              ESM Atlas — High-Fidelity Fold
            </p>
            <p className="text-[10px] text-zinc-500 mt-1">
              Querying metagenomic structure database…
            </p>
          </div>
        </div>
      )}

      {/*
        ══════════════════════════════════════════════════════════════════════
        BOTTOM-RIGHT — Zoom/Reset Controls  (z-40)
        Geometric overlap with top-left badge is impossible regardless of
        viewport size — different corners, different stacking contexts.
        ══════════════════════════════════════════════════════════════════════
      */}
      {!isLoading && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-40">
          <button
            onClick={handleReset}
            className="p-2 bg-void-panel border border-razor rounded-md hover:bg-void-surface transition-colors"
            title="Reset view"
          >
            <RotateCw size={16} className="text-zinc-400" />
          </button>
          <button
            onClick={handleZoomIn}
            className="p-2 bg-void-panel border border-razor rounded-md hover:bg-void-surface transition-colors"
            title={`Zoom in (${zoom.toFixed(1)}×)`}
          >
            <ZoomIn size={16} className="text-zinc-400" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 bg-void-panel border border-razor rounded-md hover:bg-void-surface transition-colors"
            title={`Zoom out (${zoom.toFixed(1)}×)`}
          >
            <ZoomOut size={16} className="text-zinc-400" />
          </button>
          <button
            className="p-2 bg-void-panel border border-razor rounded-md hover:bg-void-surface transition-colors"
            title="Fullscreen"
          >
            <Maximize2 size={16} className="text-zinc-400" />
          </button>
        </div>
      )}

      {/* ── Info / Legend Overlay — BOTTOM LEFT, z-30 ──────────────────────── */}
      {!isLoading && (
        <div className="absolute bottom-4 left-4 right-20 z-30">
          <div className="bg-void-panel/80 backdrop-blur-sm border border-razor rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-zinc-300">
                {proteinFold ? 'Protein Structure' : 'No structure loaded'}
              </div>
              {proteinFold?.confidence && (
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider font-mono">
                  Conf:{' '}
                  {(
                    proteinFold.confidence.reduce((a, b) => a + b, 0) /
                    Math.max(proteinFold.confidence.length, 1)
                  ).toFixed(2)}
                </div>
              )}
            </div>

            {/* Color Legend */}
            <div className="grid grid-cols-3 gap-2 text-[9px]">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-zinc-600">Alpha Helix</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-rose-400" />
                <span className="text-zinc-600">Beta Sheet</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-zinc-600">Coil</span>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-razor text-[9px] text-zinc-600">
              Drag to rotate · Scroll to zoom · Controls bottom-right
              {proteinFold?.method === 'CHOU_FASMAN_HEURISTIC' && proteinFold.aminoAcids.length < 400 && (
                <span className="text-violet-500/70 ml-1">
                  · High-fidelity fold available ↗
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}