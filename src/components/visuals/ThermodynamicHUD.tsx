'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Flame, Snowflake } from 'lucide-react';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface ThermodynamicData {
  Tm: number;
  deltaG: number;
  deltaH: number;
  deltaS: number;
  stabilityScore: number; // 0-100
  gcContent: number;
}

interface ThermodynamicHUDProps {
  sequence: string;
  position: { x: number; y: number };
  isVisible: boolean;
}

export default function ThermodynamicHUD({
  sequence,
  position,
  isVisible,
}: ThermodynamicHUDProps) {
  const thermoData: ThermodynamicData | null = useMemo(() => {
    if (!sequence || sequence.length < 10) {
      return null;
    }

    const gcCount = (sequence.match(/[GC]/gi) || []).length;
    const atCount = (sequence.match(/[AT]/gi) || []).length;
    const gcContent = (gcCount / sequence.length) * 100;

    // Nearest-neighbor approximation
    const Tm =
      sequence.length < 14
        ? 4 * gcCount + 2 * atCount // Wallace rule
        : 64.9 + (41 * (gcCount - 16.4)) / sequence.length; // %GC rule

    // Approximate free energy
    const deltaG = -5.0 - 0.05 * sequence.length;
    const deltaH = -100 - 5 * sequence.length;
    const deltaS = (deltaH - deltaG) / 310.15;

    // Stability score (0-100): based on GC content and length
    const lengthFactor = Math.min(sequence.length / 30, 1); // Longer = more stable
    const gcFactor = 1 - Math.abs(gcContent - 50) / 50; // Optimal at 50%
    const stabilityScore = lengthFactor * 50 + gcFactor * 50;

    return {
      Tm: Math.max(0, Math.min(100, Tm)),
      deltaG,
      deltaH,
      deltaS,
      stabilityScore,
      gcContent,
    };
  }, [sequence]);

  // Color code based on Tm (Blue = cold/unstable, Red = hot/stable)
  const getTmColor = (tm: number) => {
    if (tm < 45) return { bg: 'rgba(59, 130, 246, 0.3)', text: 'text-blue-400', border: 'border-blue-500/30' };
    if (tm < 55) return { bg: 'rgba(6, 182, 212, 0.3)', text: 'text-cyan-400', border: 'border-cyan-500/30' };
    if (tm < 65) return { bg: 'rgba(16, 185, 129, 0.3)', text: 'text-emerald-400', border: 'border-emerald-500/30' };
    if (tm < 75) return { bg: 'rgba(245, 158, 11, 0.3)', text: 'text-amber-400', border: 'border-amber-500/30' };
    return { bg: 'rgba(244, 63, 94, 0.3)', text: 'text-rose-400', border: 'border-rose-500/30' };
  };

  if (!isVisible || !thermoData) return null;

  const tmColor = getTmColor(thermoData.Tm);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.2 }}
        className="fixed z-50 pointer-events-none"
        style={{
          left: `${position.x + 20}px`,
          top: `${position.y - 150}px`,
        }}
      >
        {/* Main HUD Card */}
        <div className={cn(
          "w-80 bg-[#030303]/95 backdrop-blur-xl border rounded-lg shadow-2xl overflow-hidden",
          tmColor.border
        )}>
          {/* Header */}
          <div 
            className="px-4 py-3 border-b border-white/10 flex items-center justify-between"
            style={{ backgroundColor: tmColor.bg }}
          >
            <div className="flex items-center gap-2">
              <Flame className={cn("w-4 h-4", tmColor.text)} strokeWidth={2} />
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Thermodynamic Sentinel
              </span>
            </div>
          </div>

          {/* Main Display */}
          <div className="p-4 space-y-4">
            {/* Melting Temperature */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Melting Temperature
                </span>
                <div className="flex items-center gap-1">
                  {thermoData.Tm < 55 ? (
                    <Snowflake className="w-3 h-3 text-blue-400" />
                  ) : (
                    <Flame className="w-3 h-3 text-rose-400" />
                  )}
                </div>
              </div>
              
              <div className="flex items-baseline gap-2">
                <span className={cn("text-4xl font-mono font-black", tmColor.text)}>
                  {thermoData.Tm.toFixed(1)}
                </span>
                <span className="text-lg text-slate-500 font-mono">°C</span>
              </div>

              {/* Temperature scale */}
              <div className="mt-3 h-2 rounded-full bg-gradient-to-r from-blue-500 via-emerald-500 to-rose-500 relative overflow-hidden">
                <motion.div
                  initial={{ left: '0%' }}
                  animate={{ left: `${Math.min((thermoData.Tm / 100) * 100, 100)}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="absolute top-0 w-1 h-full bg-white shadow-lg"
                  style={{ transform: 'translateX(-50%)' }}
                />
              </div>
              <div className="flex justify-between text-[8px] text-slate-700 font-mono mt-1">
                <span>0°C</span>
                <span>50°C</span>
                <span>100°C</span>
              </div>
            </div>

            {/* Stability Score */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Stability Score
                </span>
                <span className="text-[9px] text-slate-600 font-mono">
                  {thermoData.stabilityScore.toFixed(0)}/100
                </span>
              </div>

              {/* Stability bar */}
              <div className="h-1.5 bg-[#0A0A0A] rounded-full overflow-hidden border border-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${thermoData.stabilityScore}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className={cn(
                    "h-full",
                    thermoData.stabilityScore > 70 ? "bg-emerald-500" :
                    thermoData.stabilityScore > 40 ? "bg-cyan-500" :
                    "bg-amber-500"
                  )}
                />
              </div>
            </div>

            {/* Thermodynamic Parameters */}
            <div className="grid grid-cols-2 gap-3">
              <ParamBox
                label="ΔG"
                value={thermoData.deltaG.toFixed(1)}
                unit="kcal/mol"
                color="text-cyan-400"
              />
              <ParamBox
                label="ΔH"
                value={thermoData.deltaH.toFixed(1)}
                unit="kcal/mol"
                color="text-rose-400"
              />
              <ParamBox
                label="ΔS"
                value={thermoData.deltaS.toFixed(1)}
                unit="cal/mol·K"
                color="text-emerald-400"
              />
              <ParamBox
                label="GC%"
                value={thermoData.gcContent.toFixed(1)}
                unit="%"
                color="text-purple-400"
              />
            </div>

            {/* Sequence info */}
            <div className="pt-3 border-t border-white/5">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">
                Analyzed Sequence
              </div>
              <div className="text-[10px] font-mono text-slate-400 bg-[#0A0A0A] rounded px-2 py-1 break-all">
                {sequence.substring(0, 50)}
                {sequence.length > 50 && '...'}
              </div>
              <div className="text-[8px] text-slate-700 mt-1">
                Length: {sequence.length} bp
              </div>
            </div>
          </div>
        </div>

        {/* Pointer arrow */}
        <div 
          className={cn("w-4 h-4 rotate-45 border-r border-b absolute -bottom-2 left-8", tmColor.border)}
          style={{ backgroundColor: '#030303' }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

// Parameter display component
function ParamBox({ 
  label, 
  value, 
  unit, 
  color 
}: { 
  label: string; 
  value: string; 
  unit: string; 
  color: string;
}) {
  return (
    <div className="bg-[#0A0A0A] border border-white/5 rounded p-2">
      <div className="text-[8px] text-slate-600 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-lg font-mono font-black", color)}>
          {value}
        </span>
        <span className="text-[8px] text-slate-600 font-mono">
          {unit}
        </span>
      </div>
    </div>
  );
}
