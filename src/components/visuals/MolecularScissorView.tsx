'use client';

import React, { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Scissors } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/hooks/useArkheStore';
import type { RestrictionSite } from '@/types/arkhe';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface MolecularScissorViewProps {
  containerWidth: number;
  containerHeight: number;
  basesPerRow: number;
  rowHeight: number;
  charWidth: number;
  isEnabled: boolean;
}

export default function MolecularScissorView({
  containerWidth,
  containerHeight,
  basesPerRow,
  rowHeight,
  charWidth = 10,
  isEnabled,
}: MolecularScissorViewProps) {
  // Get restriction sites from store
  const restrictionSites = useArkheStore((state: ArkheState) => state.restrictionSites);
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // Convert genome position to screen coordinates
  const positionToCoords = useCallback(
    (position: number) => {
      if (position < viewportStart || position > viewportEnd) return null;

      const relativePos = position - viewportStart;
      const row = Math.floor(relativePos / basesPerRow);
      const col = relativePos % basesPerRow;

      const x = col * charWidth;
      const y = row * rowHeight;

      return { x, y, row, col };
    },
    [viewportStart, viewportEnd, basesPerRow, rowHeight, charWidth]
  );

  type ScissorMarker = {
    id: string;
    site: RestrictionSite;
    coords: { x: number; y: number; row: number; col: number };
  };

  // Build scissor markers for visible sites
  const markers: ScissorMarker[] = useMemo(() => {
    if (!restrictionSites || restrictionSites.length === 0 || !isEnabled) return [];

    return restrictionSites
      .filter((site) => site.position >= viewportStart && site.position <= viewportEnd)
      .map((site, index) => {
        const coords = positionToCoords(site.position);
        if (!coords) return null;

        return {
          id: `scissor-${index}`,
          site,
          coords,
        };
      })
      .filter((m): m is ScissorMarker => m !== null);
  }, [restrictionSites, viewportStart, viewportEnd, isEnabled, positionToCoords]);

  if (!isEnabled || markers.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {markers.map((marker, index) => (
        <motion.div
          key={marker.id}
          initial={{ opacity: 0, y: -20, scale: 0 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ 
            duration: 0.4, 
            delay: index * 0.05,
            type: 'spring',
            stiffness: 200,
          }}
          className="absolute pointer-events-auto"
          style={{
            left: `${marker.coords.x}px`,
            top: `${marker.coords.y - 30}px`,
          }}
        >
          {/* Scissor marker */}
          <div className="relative flex flex-col items-center">
            {/* Enzyme name (vertical) */}
            <div 
              className="text-[9px] font-black tracking-wider text-rose-400 mb-1 whitespace-nowrap"
              style={{
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
              }}
            >
              {marker.site.enzyme}
            </div>

            {/* Scissor icon */}
            <motion.div
              animate={{
                rotate: [0, 15, -15, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center",
                "bg-rose-500/20 border border-rose-500/50",
                "shadow-lg shadow-rose-500/20"
              )}
            >
              <Scissors className="w-3 h-3 text-rose-400" strokeWidth={2.5} />
            </motion.div>

            {/* Cut line */}
            <div className="w-[2px] h-6 bg-gradient-to-b from-rose-500/80 to-transparent" />

            {/* Recognition site tooltip (on hover) */}
            <div 
              className={cn(
                "absolute top-full mt-1 left-1/2 -translate-x-1/2",
                "opacity-0 hover:opacity-100 transition-opacity pointer-events-auto",
                "bg-[#030303]/95 backdrop-blur-md border border-rose-500/30 rounded px-2 py-1",
                "text-[8px] font-mono text-rose-300 whitespace-nowrap",
                "shadow-xl z-10"
              )}
            >
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Site:</span>
                <span>{marker.site.recognitionSite}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-slate-500">Position:</span>
                <span>{marker.site.position.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-slate-500">Strand:</span>
                <span>{marker.site.strand === '+' ? 'Forward' : 'Reverse'}</span>
              </div>
            </div>
          </div>
        </motion.div>
      ))}

      {/* Summary badge */}
      {markers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-4 right-4 bg-[#030303]/90 backdrop-blur-md border border-rose-500/30 rounded-lg px-3 py-2 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-rose-400" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-400">
                Restriction Sites
              </div>
              <div className="text-[9px] text-slate-500 font-mono">
                {markers.length} site{markers.length !== 1 ? 's' : ''} visible
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Export toggle component for toolbar integration
export function RestrictionMappingToggle({ 
  isEnabled, 
  onToggle 
}: { 
  isEnabled: boolean; 
  onToggle: () => void;
}) {
  return (
    <motion.button
      onClick={onToggle}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-all",
        isEnabled
          ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-lg shadow-rose-500/20"
          : "bg-[#0A0A0A] text-slate-500 border border-white/10 hover:border-rose-500/30"
      )}
    >
      <Scissors className="w-4 h-4" strokeWidth={2} />
      <span>Restriction Map</span>
      {isEnabled && (
        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
      )}
    </motion.button>
  );
}
