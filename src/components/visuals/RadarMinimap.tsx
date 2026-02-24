'use client';

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Radar } from 'lucide-react';
import { useArkheStore } from '@/store';
import type { ArkheState } from '@/store/types';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

export default function RadarMinimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);
  
  // Data from store - Sentinel Sync
  const sentinelData = useArkheStore((state: ArkheState) => state.sentinelData);
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const genomeLength = useArkheStore((state: ArkheState) => state.genomeLength);
  const requestViewport = useArkheStore((state: ArkheState) => state.requestViewport);

  // Calculate viewport position as percentage
  const viewportPercent = useMemo(() => {
    if (!genomeLength || !viewport) return 0;
    return viewport.start / genomeLength;
  }, [viewport, genomeLength]);

  const viewportHeightPercent = useMemo(() => {
    if (!genomeLength) return 0;
    return (viewport?.end - viewport?.start) / genomeLength;
  }, [viewport, genomeLength]);

  // Draw the minimap canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !sentinelData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const width = 60;
    const height = rect.height;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas with dark background
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, width, height);

    const { bins } = sentinelData;
    if (!bins || bins.length === 0) return;

    const binHeight = height / bins.length;

    // Draw each bin
    bins.forEach((bin, index) => {
      const y = index * binHeight;
      
      // GC percent heatmap gradient
      const gcNormalized = bin.gcPercent / 100;
      
      // Color gradient based on GC content
      let r, g, b;
      if (gcNormalized < 0.4) {
        // Low GC (0-40%): Dark blue
        const t = gcNormalized / 0.4;
        r = Math.floor(3 + 3 * t);
        g = Math.floor(10 + 30 * t);
        b = Math.floor(20 + 60 * t);
      } else if (gcNormalized < 0.6) {
        // Mid GC (40-60%): Cyan
        const t = (gcNormalized - 0.4) / 0.2;
        r = Math.floor(6);
        g = Math.floor(40 + 142 * t);
        b = Math.floor(80 + 132 * t);
      } else {
        // High GC (60-100%): Emerald
        const t = (gcNormalized - 0.6) / 0.4;
        r = Math.floor(6 + 10 * t);
        g = Math.floor(182 + 3 * t);
        b = Math.floor(212 - 83 * t);
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
      ctx.fillRect(0, y, width, Math.ceil(binHeight) + 1);

      // Highlight hovered bin
      if (hoveredBin === index) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
        ctx.fillRect(0, y, width, Math.ceil(binHeight) + 1);
      }

      // Draw motif markers (TATA boxes, etc.)
      if (bin.motifCounts) {
        const totalMotifs = Object.values(bin.motifCounts).reduce((sum, count) => sum + count, 0);
        if (totalMotifs > 0) {
          // Draw bright cyan pip marker
          const markerSize = Math.min(width * 0.3, 3);
          const markerX = width - markerSize - 3;
          const markerY = y + binHeight / 2 - markerSize / 2;

          // Glow effect
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 6;
          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(markerX, markerY, markerSize, markerSize);
          ctx.shadowBlur = 0;
        }
      }
    });

    // Draw viewport indicator (rose overlay)
    if (viewportPercent !== null && genomeLength) {
      const viewportY = viewportPercent * height;
      const viewportH = Math.max(viewportHeightPercent * height, 3);
      
      // Rose border
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, viewportY, width - 2, viewportH);
      
      // Rose fill with transparency
      ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
      ctx.fillRect(1, viewportY, width - 2, viewportH);
    }

    // Draw outer border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

  }, [sentinelData, viewportPercent, viewportHeightPercent, genomeLength, hoveredBin]);

  // Handle clicks to navigate
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sentinelData || !genomeLength) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickPercent = y / rect.height;
    const newOffset = Math.floor(clickPercent * genomeLength);
    const viewportSize = viewport?.end - viewport?.start || 1000;
    
    requestViewport(newOffset, newOffset + viewportSize);
  };

  // Handle hover
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sentinelData) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const binIndex = Math.floor((y / rect.height) * sentinelData.bins.length);
    
    setHoveredBin(binIndex);
  };

  const handleMouseLeave = () => {
    setHoveredBin(null);
  };

  // Show "Scanning Background..." state if no data
  if (!sentinelData) {
    return (
      <div className="w-16 border-l border-white/5 bg-[#0A0A0A] flex flex-col items-center justify-center relative flex-shrink-0">
        {/* Title */}
        <div className="absolute top-6 left-0 right-0 flex justify-center">
          <div className="text-[8px] text-slate-600 uppercase tracking-[0.2em] font-black transform -rotate-90 whitespace-nowrap origin-center">
            Sentinel
          </div>
        </div>

        {/* Pulsing Scanning State */}
        <motion.div
          animate={{
            opacity: [0.3, 0.8, 0.3],
          }}
          transition={{
            repeat: Infinity,
            duration: 2,
            ease: 'easeInOut',
          }}
          className="flex flex-col items-center gap-3"
        >
          <Radar className="w-8 h-8 text-cyan-500/40" strokeWidth={1.5} />
          <div className="text-[8px] text-cyan-500/60 uppercase tracking-wider font-mono text-center px-2">
            Scanning<br/>Background
          </div>
        </motion.div>

        {/* Progress dots */}
        <div className="absolute bottom-6 flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.3, 1, 0.3],
              }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                delay: i * 0.2,
              }}
              className="w-1 h-1 rounded-full bg-cyan-500/40"
            />
          ))}
        </div>
      </div>
    );
  }

  const hoveredBinData = hoveredBin !== null ? sentinelData.bins[hoveredBin] : null;

  return (
    <div 
      ref={containerRef}
      className="w-16 border-l border-white/5 bg-[#0A0A0A] relative flex-shrink-0 flex flex-col"
    >
      {/* Title label */}
      <div className="absolute top-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <div className="text-[8px] text-slate-500 uppercase tracking-[0.2em] font-black transform -rotate-90 whitespace-nowrap origin-center">
          Sentinel
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full cursor-crosshair"
      />

      {/* Hover Tooltip */}
      {hoveredBinData && (
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-20 pointer-events-none"
        >
          <div className={cn(
            "bg-[#030303]/95 backdrop-blur-md border border-white/20 rounded px-3 py-2",
            "text-[9px] font-mono text-slate-300 whitespace-nowrap shadow-xl"
          )}>
            <div className="flex items-center gap-2 mb-1">
              <div 
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: `hsl(${(hoveredBinData.gcPercent / 100) * 120}, 70%, 50%)`,
                }}
              />
              <span className="text-cyan-400">
                GC: {hoveredBinData.gcPercent.toFixed(1)}%
              </span>
            </div>
            <div className="text-slate-600">
              {hoveredBinData.start.toLocaleString()} - {hoveredBinData.end.toLocaleString()}
            </div>
            {hoveredBinData.motifCounts && Object.keys(hoveredBinData.motifCounts).length > 0 && (
              <div className="text-emerald-400 mt-1">
                Motifs: {Object.values(hoveredBinData.motifCounts).reduce((a, b) => a + b, 0)}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Stats Footer */}
      <div className="absolute bottom-4 left-0 right-0 px-2 pointer-events-none">
        <div className={cn(
          "bg-[#030303]/90 backdrop-blur-sm border border-white/10 rounded px-2 py-1",
          "text-[8px] font-mono text-slate-500 text-center"
        )}>
          {sentinelData.bins.length} bins
        </div>
      </div>
    </div>
  );
}
