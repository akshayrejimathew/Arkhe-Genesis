'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Activity, Droplet, Weight } from 'lucide-react';
import { useArkheStore } from '@/hooks/useArkheStore';
import type { ArkheState } from '@/hooks/useArkheStore';
import type { ProteinProperties } from '@/types/arkhe';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

const FALLBACK_HYDROPHOBICITY: number[] = Array.from({ length: 50 }, (_, i) => {
  // Deterministic pseudo-pattern between -4 and +4
  return Math.sin(i / 5) * 4;
});

interface ProteomicHUDProps {
  isVisible: boolean;
  position?: { x: number; y: number };
  orfName?: string;
  proteinSequence?: string;
  molecularWeight?: number;
}

export default function ProteomicHUD({
  isVisible,
  position = { x: 0, y: 0 },
  orfName = 'ORF-001',
  proteinSequence,
  molecularWeight,
}: ProteomicHUDProps) {
  // Get protein properties from store
  const proteinProperties = useArkheStore((state: ArkheState) => 
    state.sliceProteinProperties
  );

  // Calculate molecular weight if not provided (approximate: avg 110 Da per amino acid)
  const calcMolecularWeight = useMemo(() => {
    if (molecularWeight) return molecularWeight;
    if (proteinSequence) {
      return (proteinSequence.length * 110) / 1000; // Convert to kDa
    }
    return proteinProperties?.isoelectricPoint ? 42.5 : null; // Fallback
  }, [molecularWeight, proteinSequence, proteinProperties]);

  // Get or generate hydrophobicity profile
  const hydrophobicityData = useMemo(() => {
    if (proteinProperties?.hydrophobicityProfile) {
      return proteinProperties.hydrophobicityProfile;
    }

    // Generate sample data if not available (for demo)
    if (proteinSequence) {
      // Simplified Kyte-Doolittle scale
      const scale: Record<string, number> = {
        I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8,
        G: -0.4, T: -0.7, S: -0.8, W: -0.9, Y: -1.3, P: -1.6,
        H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
      };

      return proteinSequence.split('').map((aa) => scale[aa] ?? 0);
    }

    return FALLBACK_HYDROPHOBICITY;
  }, [proteinSequence, proteinProperties]);

  // Isoelectric point (pI)
  const isoelectricPoint = proteinProperties?.isoelectricPoint ?? 7.0;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(
            "fixed z-50 w-80 pointer-events-none select-none"
          )}
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
        >
          {/* Glassmorphism card */}
          <div className={cn(
            "bg-[#0A0A0A]/80 backdrop-blur-md border border-white/10",
            "rounded-lg shadow-2xl shadow-black/50 overflow-hidden"
          )}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 to-emerald-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" strokeWidth={2} />
                  <span className="text-sm font-black tracking-wider text-slate-200 uppercase">
                    {orfName}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">
                  Proteomic Profile
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Hydrophobicity Profile */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Droplet className="w-3.5 h-3.5 text-cyan-400" strokeWidth={2} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Hydrophobicity Index
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-600 font-mono">
                    Kyte-Doolittle
                  </span>
                </div>
                
                {/* Sparkline chart */}
                <div className="h-16 bg-[#030303] border border-white/5 rounded p-2">
                  <HydrophobicitySparkline data={hydrophobicityData} />
                </div>
              </div>

              {/* Isoelectric Point */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-rose-500 to-emerald-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Isoelectric Point (pI)
                  </span>
                </div>
                
                {/* pH scale visual */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-2xl font-mono font-black text-cyan-400">
                      {isoelectricPoint.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-600">
                      {isoelectricPoint < 7 ? 'Acidic' : isoelectricPoint > 7 ? 'Basic' : 'Neutral'}
                    </span>
                  </div>
                  
                  {/* pH scale bar */}
                  <div className="relative h-2 bg-gradient-to-r from-rose-500 via-slate-700 to-emerald-500 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ left: '0%' }}
                      animate={{ left: `${((isoelectricPoint / 14) * 100)}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      className="absolute top-0 w-1 h-full bg-white shadow-lg shadow-white/50"
                      style={{ transform: 'translateX(-50%)' }}
                    />
                  </div>
                  
                  {/* pH labels */}
                  <div className="flex justify-between text-[8px] text-slate-600 font-mono">
                    <span>0</span>
                    <span>7</span>
                    <span>14</span>
                  </div>
                </div>
              </div>

              {/* Molecular Weight */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Weight className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Molecular Weight
                  </span>
                </div>
                
                <div className="bg-[#030303] border border-white/5 rounded p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-mono font-black text-emerald-400">
                      {calcMolecularWeight?.toFixed(1) ?? '--'}
                    </span>
                    <span className="text-sm text-slate-500 font-mono">kDa</span>
                  </div>
                  
                  {proteinSequence && (
                    <div className="mt-2 text-[9px] text-slate-600">
                      {proteinSequence.length} amino acids
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-white/5 bg-[#030303]/50">
              <div className="text-[8px] text-slate-700 uppercase tracking-wider font-mono">
                → Click to expand full analysis
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Sparkline component for hydrophobicity
function HydrophobicitySparkline({ data }: { data: number[] }) {
  const width = 100;
  const height = 100;
  
  if (!data || data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-[9px] text-slate-700">No data</span>
      </div>
    );
  }

  const minValue = Math.min(...data);
  const maxValue = Math.max(...data);
  const range = maxValue - minValue || 1;
  
  // Create path for sparkline
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - minValue) / range) * height;
    return { x, y };
  });

  const pathData = points.map((point, index) => 
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
  ).join(' ');

  // Create fill area
  const fillPathData = `${pathData} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      {/* Zero line */}
      <line
        x1={0}
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth={0.5}
        strokeDasharray="2,2"
      />

      {/* Fill area */}
      <path
        d={fillPathData}
        fill="url(#hydrophobicityGradient)"
        opacity={0.2}
      />

      {/* Line */}
      <path
        d={pathData}
        fill="none"
        stroke="#06b6d4"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Gradient definition */}
      <defs>
        <linearGradient id="hydrophobicityGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.1} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Export a hook for easy usage in the editor
export function useViewportProteinProperties() {
  return useArkheStore((state: ArkheState) => state.sliceProteinProperties);
}
