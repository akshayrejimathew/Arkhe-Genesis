'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useArkheStore, type ArkheState } from '@/hooks/useArkheStore';

const cn = (...inputs: any[]) => twMerge(clsx(inputs));

interface GhostRibbonOverlayProps {
  containerWidth: number;
  containerHeight: number;
  basesPerRow: number;
  rowHeight: number;
}

export default function GhostRibbonOverlay({
  containerWidth,
  containerHeight,
  basesPerRow,
  rowHeight,
}: GhostRibbonOverlayProps) {
  const [hoveredAnchor, setHoveredAnchor] = useState<string | null>(null);

  // Get synteny anchors from store
  const syntenyAnchors = useArkheStore((state: ArkheState) => state.syntenyAnchors);
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // Convert genome position to screen coordinates
  const positionToCoords = (position: number) => {
    if (position < viewportStart || position > viewportEnd) return null;
    
    const relativePos = position - viewportStart;
    const row = Math.floor(relativePos / basesPerRow);
    const col = relativePos % basesPerRow;
    
    // Assuming 10px per character width (monospace)
    const charWidth = 10;
    const x = col * charWidth;
    const y = row * rowHeight + rowHeight / 2;
    
    return { x, y };
  };

  // Build ribbon paths for visible anchors
  const ribbons = useMemo(() => {
    if (!syntenyAnchors || syntenyAnchors.length === 0) return [];

    return syntenyAnchors
      .filter(anchor => {
        // Only show anchors where at least one end is visible
        const aVisible = anchor.startA >= viewportStart && anchor.startA <= viewportEnd;
        const bVisible = anchor.startB >= viewportStart && anchor.startB <= viewportEnd;
        return aVisible || bVisible;
      })
      .map((anchor, index) => {
        const coordsA = positionToCoords(anchor.startA);
        const coordsB = positionToCoords(anchor.startB);

        if (!coordsA || !coordsB) return null;

        // Determine arc color based on type
        const color = {
          direct_repeat: '#06b6d4', // Cyan
          inverted_repeat: '#a855f7', // Purple
          translocation: '#f59e0b', // Amber
          inversion: '#f43f5e', // Rose
        }[anchor.type];

        // Calculate control points for smooth arc
        const midX = (coordsA.x + coordsB.x) / 2;
        const distance = Math.abs(coordsB.y - coordsA.y);
        const controlOffset = Math.min(distance * 0.3, 100);
        
        // Bezier curve path
        const path = `M ${coordsA.x} ${coordsA.y} Q ${midX} ${coordsA.y - controlOffset} ${coordsB.x} ${coordsB.y}`;

        return {
          id: `ribbon-${index}`,
          path,
          color,
          anchor,
          coordsA,
          coordsB,
        };
      })
      .filter(Boolean);
  }, [syntenyAnchors, viewportStart, viewportEnd, basesPerRow, rowHeight]);

  if (ribbons.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <svg
        width={containerWidth}
        height={containerHeight}
        className="absolute inset-0"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Glow filter for ribbons */}
          <filter id="ghost-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ribbons.map((ribbon: any) => {
          const isHovered = hoveredAnchor === ribbon.id;
          
          return (
            <g key={ribbon.id}>
              {/* Shadow arc */}
              <motion.path
                d={ribbon.path}
                fill="none"
                stroke={ribbon.color}
                strokeWidth={isHovered ? 4 : 2}
                strokeOpacity={0.15}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.15 }}
                transition={{ duration: 1, delay: 0.1 }}
              />

              {/* Main glowing arc */}
              <motion.path
                d={ribbon.path}
                fill="none"
                stroke={ribbon.color}
                strokeWidth={isHovered ? 3 : 1.5}
                strokeOpacity={isHovered ? 0.9 : 0.6}
                strokeLinecap="round"
                filter="url(#ghost-glow)"
                className="pointer-events-auto cursor-pointer"
                onMouseEnter={() => setHoveredAnchor(ribbon.id)}
                onMouseLeave={() => setHoveredAnchor(null)}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ 
                  pathLength: 1, 
                  opacity: isHovered ? 0.9 : 0.6,
                  strokeWidth: isHovered ? 3 : 1.5,
                }}
                transition={{ duration: 1 }}
                whileHover={{ strokeOpacity: 1, strokeWidth: 4 }}
              />

              {/* Endpoint markers */}
              <circle
                cx={ribbon.coordsA.x}
                cy={ribbon.coordsA.y}
                r={isHovered ? 5 : 3}
                fill={ribbon.color}
                opacity={isHovered ? 0.9 : 0.6}
                className="pointer-events-none"
              />
              <circle
                cx={ribbon.coordsB.x}
                cy={ribbon.coordsB.y}
                r={isHovered ? 5 : 3}
                fill={ribbon.color}
                opacity={isHovered ? 0.9 : 0.6}
                className="pointer-events-none"
              />

              {/* Hover tooltip */}
              {isHovered && (
                <foreignObject
                  x={ribbon.coordsA.x + 10}
                  y={ribbon.coordsA.y - 60}
                  width={250}
                  height={80}
                  className="pointer-events-none"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "bg-[#030303]/95 backdrop-blur-md border border-white/20 rounded-lg p-3",
                      "shadow-xl"
                    )}
                  >
                    <div className="text-[10px] font-black uppercase tracking-wider text-cyan-400 mb-2">
                      {ribbon.anchor.type.replace('_', ' ')}
                    </div>
                    <div className="space-y-1 text-[9px] font-mono text-slate-400">
                      <div>
                        Region A: {ribbon.anchor.startA.toLocaleString()} - {ribbon.anchor.endA.toLocaleString()}
                      </div>
                      <div>
                        Region B: {ribbon.anchor.startB.toLocaleString()} - {ribbon.anchor.endB.toLocaleString()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span>Identity:</span>
                        <span className="text-emerald-400 font-bold">
                          {(ribbon.anchor.identity * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        Length: {ribbon.anchor.length.toLocaleString()} bp
                      </div>
                    </div>
                  </motion.div>
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
