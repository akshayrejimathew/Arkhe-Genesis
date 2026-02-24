'use client';

import React, { useMemo, useState, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Dna } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import GhostRibbonOverlay from '@/components/visuals/GhostRibbonOverlay';
import MolecularScissorView from '@/components/visuals/MolecularScissorView';
import ThermodynamicHUD from '@/components/visuals/ThermodynamicHUD';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

const BASES_PER_ROW = 60;
const ROW_HEIGHT = 24;
const CHAR_WIDTH = 10;

export default function SequenceView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPosition, setHoveredPosition] = useState<number | null>(null);
  const [selectedSequence, setSelectedSequence] = useState('');
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [showThermoHUD, setShowThermoHUD] = useState(false);
  
  // Store state
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const genomeLength = useArkheStore((state: ArkheState) => state.genomeLength);
  const restrictionSites = useArkheStore((state: ArkheState) => state.restrictionSites);
  const syntenyAnchors = useArkheStore((state: ArkheState) => state.syntenyAnchors);
  const requestViewport = useArkheStore((state: ArkheState) => state.requestViewport);

  const viewportBuffer = viewport.buffer;
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // Parse viewport buffer into sequence
  const sequence = useMemo(() => {
    if (!viewportBuffer) return '';
    const buffer = new Uint8Array(viewportBuffer);
    return Array.from(buffer).map(code => ['A', 'C', 'G', 'T', 'N'][code] || 'N').join('');
  }, [viewportBuffer]);

  // Split into rows
  const rows = useMemo(() => {
    const result: { rowNumber: number; position: number; sequence: string }[] = [];
    for (let i = 0; i < sequence.length; i += BASES_PER_ROW) {
      result.push({
        rowNumber: Math.floor(i / BASES_PER_ROW),
        position: viewportStart + i,
        sequence: sequence.slice(i, i + BASES_PER_ROW),
      });
    }
    return result;
  }, [sequence, viewportStart]);

  // Load more data when scrolling
  const handleRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
    const newStart = Math.max(0, viewportStart + range.startIndex * BASES_PER_ROW - 1000);
    const newEnd = Math.min(genomeLength - 1, viewportStart + range.endIndex * BASES_PER_ROW + 1000);
    
    if (newStart < viewportStart || newEnd > viewportEnd) {
      requestViewport(newStart, newEnd);
    }
  }, [viewportStart, viewportEnd, genomeLength, requestViewport]);

  // Handle text selection for ThermodynamicHUD
  const handleTextSelect = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && selection.toString().length >= 10) {
      const selected = selection.toString().replace(/\s/g, '').toUpperCase();
      if (/^[ATCGN]+$/.test(selected)) {
        setSelectedSequence(selected);
        setCursorPos({ x: e.clientX, y: e.clientY });
        setShowThermoHUD(true);
      }
    } else {
      setShowThermoHUD(false);
    }
  }, []);

  if (genomeLength === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#030303]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <Dna className="w-16 h-16 mx-auto mb-4 text-slate-800" strokeWidth={1.5} />
          <p className="text-slate-700 text-sm uppercase tracking-wider font-mono">
            Awaiting Genome Data
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative bg-[#030303] overflow-hidden"
      onMouseUp={handleTextSelect}
    >
      {/* Sequence editor with virtual scroll */}
      <Virtuoso
        totalCount={rows.length}
        itemContent={(index) => (
          <SequenceRow
            row={rows[index]}
            onHover={setHoveredPosition}
          />
        )}
        rangeChanged={handleRangeChange}
        className="w-full h-full"
        style={{ overflowX: 'hidden' }}
      />

      {/* LAYER 1: Ghost Ribbons (synteny connections) - pointer-events-none except on ribbons */}
      {syntenyAnchors.length > 0 && (
        <GhostRibbonOverlay
          containerWidth={containerRef.current?.clientWidth || 800}
          containerHeight={containerRef.current?.clientHeight || 600}
          basesPerRow={BASES_PER_ROW}
          rowHeight={ROW_HEIGHT}
        />
      )}

      {/* LAYER 2: Molecular Scissors (restriction sites) - pointer-events-none except on scissors */}
      {restrictionSites.length > 0 && (
        <MolecularScissorView
          containerWidth={containerRef.current?.clientWidth || 800}
          containerHeight={containerRef.current?.clientHeight || 600}
          basesPerRow={BASES_PER_ROW}
          rowHeight={ROW_HEIGHT}
          charWidth={CHAR_WIDTH}
          isEnabled={true}
        />
      )}

      {/* Position indicator */}
      {hoveredPosition !== null && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 right-4 px-3 py-1.5 bg-[#0A0A0A] bg-opacity-10 backdrop-blur-md border border-white/10 rounded-lg shadow-xl pointer-events-none"
        >
          <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Position</div>
          <div className="text-sm text-cyan-400 font-mono font-black">
            {hoveredPosition.toLocaleString()}
          </div>
        </motion.div>
      )}

      {/* Thermodynamic HUD (shows on selection) */}
      <ThermodynamicHUD
        sequence={selectedSequence}
        position={cursorPos}
        isVisible={showThermoHUD}
      />
    </div>
  );
}

// Individual sequence row with bio-glow effect
function SequenceRow({ 
  row,
  onHover
}: { 
  row: { rowNumber: number; position: number; sequence: string };
  onHover: (position: number | null) => void;
}) {
  return (
    <div 
      className="flex items-center gap-4 px-6 py-1 hover:bg-[#0A0A0A]/30 transition-colors font-mono text-sm"
      onMouseEnter={() => onHover(row.position)}
      onMouseLeave={() => onHover(null)}
      style={{ height: `${ROW_HEIGHT}px` }}
    >
      {/* Position label */}
      <div className="w-24 text-right text-[10px] text-slate-600 select-none tracking-tighter">
        {row.position.toLocaleString()}
      </div>

      {/* Sequence with Bio-Glow Effect */}
      <div className="flex-1 flex gap-0.5">
        {Array.from(row.sequence).map((base, i) => (
          <span
            key={i}
            className={cn(
              "inline-block w-[10px] text-center transition-all cursor-pointer",
              "hover:scale-110 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]",
              // Base colors with glow
              base === 'A' && "text-emerald-400 drop-shadow-[0_0_4px_rgba(16,185,129,0.3)]",
              base === 'C' && "text-cyan-400 drop-shadow-[0_0_4px_rgba(6,182,212,0.3)]",
              base === 'G' && "text-amber-400 drop-shadow-[0_0_4px_rgba(245,158,11,0.3)]",
              base === 'T' && "text-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.3)]",
              base === 'N' && "text-slate-700"
            )}
            title={`${base} @ ${row.position + i}`}
          >
            {base}
          </span>
        ))}
      </div>

      {/* Row end marker */}
      <div className="w-16 text-[10px] text-slate-700 select-none tracking-tighter">
        {(row.position + row.sequence.length).toLocaleString()}
      </div>
    </div>
  );
}
