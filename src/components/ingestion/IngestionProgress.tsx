'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Activity, Database, Zap, HardDrive } from 'lucide-react';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface TelemetryData {
  streamingRate: number;
  estimatedComplexity: number;
  memorySlabId: string | null;
  basesIndexed: number;
  slabsAllocated: number;
  totalBytes: number;
  bytesProcessed: number;
}

interface IngestionProgressProps {
  phase: 'validating' | 'streaming' | 'indexing';
  telemetry: TelemetryData;
  progressPercent: number;
}

export default function IngestionProgress({
  phase,
  telemetry,
  progressPercent,
}: IngestionProgressProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Progress Bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400 uppercase tracking-wider font-mono">
            {phase === 'validating' && 'Validating...'}
            {phase === 'streaming' && 'Streaming...'}
            {phase === 'indexing' && 'Building Index...'}
          </span>
          <span className="text-lg text-cyan-400 font-mono font-black">
            {progressPercent.toFixed(1)}%
          </span>
        </div>

        {/* Main Progress Bar */}
        <div className="relative h-3 bg-[#030303] rounded-full overflow-hidden border border-white/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 via-cyan-400 to-emerald-500"
          >
            {/* Shimmer effect */}
            <motion.div
              animate={{
                x: ['-100%', '200%'],
              }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                ease: 'linear',
              }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
          </motion.div>
        </div>

        {/* ASCII-style loading bar */}
        <div className="font-mono text-xs text-cyan-400/60 tracking-wider">
          [{generateLoadingBar(progressPercent)}]
        </div>
      </div>

      {/* Telemetry Grid */}
      <div className="bg-[#030303]/80 backdrop-blur-sm border border-white/10 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-[10px] font-black tracking-[0.25em] text-slate-500 uppercase">
            Live Telemetry
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Streaming Rate */}
          <TelemetryCell
            icon={<Zap className="w-4 h-4" />}
            label="Streaming Rate"
            value={telemetry.streamingRate.toFixed(2)}
            unit="MB/s"
            color="cyan"
            animated={phase === 'streaming'}
          />

          {/* Bases Indexed */}
          <TelemetryCell
            icon={<Database className="w-4 h-4" />}
            label="Bases Indexed"
            value={formatLargeNumber(telemetry.basesIndexed)}
            unit="bp"
            color="emerald"
            animated={true}
          />

          {/* Complexity Score */}
          <TelemetryCell
            icon={<Activity className="w-4 h-4" />}
            label="Complexity"
            value={telemetry.estimatedComplexity.toFixed(0)}
            unit="/ 100"
            color="cyan"
            animated={false}
          />

          {/* Slabs Allocated */}
          <TelemetryCell
            icon={<HardDrive className="w-4 h-4" />}
            label="Slabs Allocated"
            value={telemetry.slabsAllocated.toString()}
            unit="chunks"
            color="slate"
            animated={phase === 'indexing'}
          />
        </div>

        {/* Memory Slab ID */}
        {telemetry.memorySlabId && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">
              Memory Slab ID
            </div>
            <div className="font-mono text-sm font-black text-slate-300 tracking-wider">
              {telemetry.memorySlabId}
            </div>
          </div>
        )}
      </div>

      {/* Status Messages */}
      <div className="flex items-start gap-3 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 animate-pulse" />
        <div className="flex-1 text-xs text-cyan-300/80 font-mono">
          {phase === 'validating' && 'Validating sequence structure and format...'}
          {phase === 'streaming' && 'Transferring data to SharedArrayBuffer memory slabs...'}
          {phase === 'indexing' && 'Building spatial indices for rapid viewport queries...'}
        </div>
      </div>
    </motion.div>
  );
}

// Telemetry Cell Component
function TelemetryCell({
  icon,
  label,
  value,
  unit,
  color,
  animated,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  color: 'cyan' | 'emerald' | 'slate';
  animated: boolean;
}) {
  const colorClasses = {
    cyan: 'text-cyan-400',
    emerald: 'text-emerald-400',
    slate: 'text-slate-400',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={cn('transition-colors', colorClasses[color])}>
          {icon}
        </div>
        <span className="text-[9px] text-slate-600 uppercase tracking-wider">
          {label}
        </span>
      </div>
      
      <div className="flex items-baseline gap-1.5">
        <motion.span
          animate={animated ? {
            opacity: [1, 0.7, 1],
          } : {}}
          transition={{
            repeat: animated ? Infinity : 0,
            duration: 1.5,
          }}
          className={cn(
            'text-2xl font-mono font-black tracking-tight',
            colorClasses[color]
          )}
        >
          {value}
        </motion.span>
        <span className="text-xs text-slate-500 font-mono">
          {unit}
        </span>
      </div>
    </div>
  );
}

// Helper: Generate ASCII loading bar
function generateLoadingBar(percent: number): string {
  const barLength = 40;
  const filled = Math.floor((percent / 100) * barLength);
  const empty = barLength - filled;
  
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// Helper: Format large numbers with K/M/G suffixes
function formatLargeNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + 'G';
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K';
  }
  return num.toString();
}
