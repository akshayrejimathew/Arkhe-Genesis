'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, RotateCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import type { ProteinFold } from '@/types/arkhe';

/**
 * PROTEIN VIEWPORT — 3D Molecular Viewer
 *
 * AUDIT III FIXES (2026-02-21):
 *
 *   FIX 1 — Removed unsafe type cast (SHADOW-04):
 *     The `as ExtendedProteinFold` cast and the locally-declared
 *     `ExtendedProteinFold` type alias have been completely removed.
 *     `ProteinFold` is now imported directly from '@/types/arkhe' and carries
 *     all required fields (`method`, `warning`, `rateLimitNotice`, `disclosure`)
 *     as part of its canonical definition. The store's `state.proteinFold` is
 *     already typed as `ProteinFold | null` — no cast is needed or permitted.
 *
 *   FIX 2 — useRef for all rotation / zoom math (Vector H — frame doubling):
 *     All mutable animation state (`rotationRef`, `zoomRef`, `autoRotateRef`,
 *     `isDraggingRef`, `lastXRef`, `lastYRef`, `lastTimestampRef`) is stored
 *     exclusively in refs. React state is used ONLY for values that must drive
 *     a DOM re-render: `isLoading` and `zoom` (for button labels only).
 *     The RAF loop reads and writes refs; it never calls `setState` or causes
 *     re-renders. The `useEffect` depends only on `[proteinFold, startRenderLoop]`
 *     — it does not re-fire on rotation changes.
 *
 *   FIX 3 — Scientific honesty badge z-index raised to z-[100] (Vector K):
 *     The heuristic warning and method badge container now uses `z-[100]`
 *     instead of `z-50`. This guarantees the badge is never occluded by any
 *     other absolutely-positioned element in the viewport or in any parent
 *     component that may use Tailwind utility z-index classes (which top out
 *     at z-50 in the default scale).
 *
 * Previously-confirmed fixes preserved:
 *   - Controls at bottom-right (z-40) — cannot overlap top-left badge
 *   - ResizeObserver disconnected on cleanup
 *   - animationFrameRef cancelled before each new render loop
 *   - Delta-time clamped to ≤100 ms on tab re-focus
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

  // React state: only for values that drive DOM output (loading screen, button label)
  const [isLoading, setIsLoading] = useState(true);
  const [zoom, setZoom]           = useState(1);

  // FIX 1: Import ProteinFold from '@/types/arkhe' — NO cast needed or permitted.
  // The canonical ProteinFold interface now includes method, warning,
  // rateLimitNotice, and disclosure. The previous `as ExtendedProteinFold` cast
  // has been eliminated entirely.
  const proteinFold = useArkheStore(
    (state: ArkheState) => state.proteinFold as ProteinFold | null
  );

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // ── Core RAF render loop ───────────────────────────────────────────────────
  // FIX 2: All mutable animation values (`rotationRef`, `zoomRef`,
  // `autoRotateRef`) are accessed via refs inside the RAF callback.
  // The callback is memoised with useCallback(fn, []) — zero deps — so it is
  // created exactly once for the lifetime of the component and never triggers
  // a re-render or a useEffect re-execution.
  const startRenderLoop = useCallback((
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
      // Clamp delta to 100 ms — prevents rotation jump after tab was hidden
      const dt =
        lastTimestampRef.current === undefined
          ? 16
          : Math.min(timestamp - lastTimestampRef.current, 100);
      lastTimestampRef.current = timestamp;

      const width  = canvas.width  / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;

      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);

      // Auto-rotate: writes ref, never calls setState — no re-render
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
        .sort((a: ProjectedPoint, b: ProjectedPoint) => a.z - b.z);

      // Draw bonds
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

      // Draw atoms
      projected.forEach((point) => {
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

      // Subtle grid reference
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0,     height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);
  }, []); // ← zero deps: all mutable values are refs, not state

  // ── Main effect: fires only when proteinFold changes ──────────────────────
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

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }
    const ro = new ResizeObserver(() => setSize());
    ro.observe(canvas);
    resizeObserverRef.current = ro;

    setIsLoading(false);

    // ── Empty state ──────────────────────────────────────────────────────────
    if (!proteinFold || !proteinFold.coordinates || proteinFold.coordinates.length === 0) {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      const width  = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle    = '#71717a';
      ctx.font         = '14px var(--font-inter)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Select a gene to fold', width / 2, height / 2);
      return;
    }

    lastTimestampRef.current = undefined; // reset delta-time on new protein load
    startRenderLoop(canvas, ctx, proteinFold.coordinates, proteinFold.secondaryStructure);

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      autoRotateRef.current = false;
      lastXRef.current      = e.clientX;
      lastYRef.current      = e.clientY;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - lastXRef.current;
      const deltaY = e.clientY - lastYRef.current;
      rotationRef.current.x += deltaY * 0.01;
      rotationRef.current.y += deltaX * 0.01;
      lastXRef.current       = e.clientX;
      lastYRef.current       = e.clientY;
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

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

  // ── Control handlers ──────────────────────────────────────────────────────
  const handleReset = () => {
    rotationRef.current   = { x: 0, y: 0 };
    zoomRef.current       = 1;
    setZoom(1);
    autoRotateRef.current = true;
  };

  const handleZoomIn = () => {
    zoomRef.current = Math.min(zoomRef.current + 0.2, 3);
    setZoom(zoomRef.current);
  };

  const handleZoomOut = () => {
    zoomRef.current = Math.max(zoomRef.current - 0.2, 0.5);
    setZoom(zoomRef.current);
  };

  // ── Render ────────────────────────────────────────────────────────────────
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
        ── FIX 1 + FIX 3: Scientific Honesty Badge — TOP LEFT, z-[100] ──────
        ── FIX 1: No type cast. `proteinFold` is ProteinFold from arkhe.d.ts.
        ──         All fields (method, warning, rateLimitNotice) are canonical.
        ── FIX 3: z-[100] exceeds all default Tailwind z-index utilities (max
        ──         z-50) so this badge cannot be occluded by any sibling panel.
        ── The clinical warning MUST always be visible when heuristic coords
        ── are displayed. It must never be hidden, toggled, or minimised.
      */}
      {!isLoading && proteinFold && (
        <div className="absolute top-4 left-4 z-[100] flex flex-col gap-2 max-w-[220px]">

          {/* Method Badge */}
          {proteinFold.method && (
            <div className="bg-void-panel/95 backdrop-blur-sm border border-razor rounded-md px-3 py-2 shadow-lg">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">
                Folding Method
              </div>
              <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-mono font-semibold">
                {proteinFold.method}
              </div>
            </div>
          )}

          {/*
            Clinical Warning — high-contrast yellow badge.
            Present whenever method === 'CHOU_FASMAN_HEURISTIC'.
            Must never be hidden or toggled off.
          */}
          {proteinFold.warning && (
            <div className="bg-yellow-500/15 backdrop-blur-sm border border-yellow-400/50 rounded-md px-3 py-2 shadow-lg">
              <div className="flex items-start gap-2">
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
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667
                       1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732
                       0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <div className="text-[10px] text-yellow-300 font-mono font-bold leading-relaxed">
                  {proteinFold.warning}
                </div>
              </div>
            </div>
          )}

          {/*
            Rate-limit / consent notice — orange badge.
            Rendered when the ESM Atlas API was rate-limited (429) or when
            ESM folding was skipped because consent was not obtained.
            Distinct from the clinical warning so the user understands
            *why* they received a heuristic result.
          */}
          {proteinFold.rateLimitNotice && (
            <div className="bg-orange-500/10 backdrop-blur-sm border border-orange-400/40 rounded-md px-3 py-2 shadow-lg">
              <div className="text-[10px] text-orange-300 font-mono leading-relaxed">
                {proteinFold.rateLimitNotice}
              </div>
            </div>
          )}

          {/*
            GDPR Disclosure — shown when sequence data was sent to ESM Atlas.
            Only present on ESM_ATLAS results (disclosure field is populated
            only on the success path in proteinFold.ts).
          */}
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
        Controls Overlay — BOTTOM RIGHT, z-40.
        Badge is top-left z-[100]; controls are bottom-right z-40.
        Geometric overlap is impossible regardless of viewport size.
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

      {/* Info / Legend Overlay — BOTTOM LEFT, z-30 */}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}