'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  Scissors, 
  Stethoscope, 
  Radar, 
  Ghost,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/hooks/useArkheStore';

const cn = (...inputs: any[]) => twMerge(clsx(inputs));

export default function SurgicalToolbar() {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showSynteny, setShowSynteny] = useState(false);

  // Store connections
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const performSurgicalEdit = useArkheStore((state: ArkheState) => state.performSurgicalEdit);
  const scanOffTargets = useArkheStore((state: ArkheState) => state.scanOffTargets);
  const refreshSyntenyScan = useArkheStore((state: ArkheState) => state.refreshSyntenyScan);
  const isScanningOffTarget = useArkheStore((state: ArkheState) => state.isScanningOffTarget);
  const isScanningSynteny = useArkheStore((state: ArkheState) => state.isScanningSynteny);

  const cursorPosition = viewport.start;

  const tools = [
    {
      id: 'scalpel',
      name: 'The Scalpel',
      icon: Scissors,
      description: 'Delete base at cursor',
      color: 'rose',
      action: async () => {
        if (cursorPosition !== null && cursorPosition !== undefined) {
          setActiveAction('scalpel');
          // Trigger deletion - this would call a deletion mutation
          console.log('Scalpel: Delete at position', cursorPosition);
          // In production: await performDeletion(cursorPosition);
          setTimeout(() => setActiveAction(null), 1000);
        }
      },
    },
    {
      id: 'suture',
      name: 'The Suture',
      icon: Stethoscope,
      description: 'Insert base at cursor',
      color: 'emerald',
      action: async () => {
        if (cursorPosition !== null && cursorPosition !== undefined) {
          setActiveAction('suture');
          // Trigger insertion - this would open an insertion modal
          console.log('Suture: Insert at position', cursorPosition);
          // In production: await performInsertion(cursorPosition, 'A');
          setTimeout(() => setActiveAction(null), 1000);
        }
      },
    },
    {
      id: 'radar',
      name: 'The Radar',
      icon: Radar,
      description: 'CRISPR Off-Target scan',
      color: 'cyan',
      action: async () => {
        setActiveAction('radar');
        // Get selected sequence (demo: using 20bp at cursor)
        const selectedSequence = 'ATGCATGCATGCATGCATGC'; // In production: extract from viewport
        await scanOffTargets(selectedSequence, 3); // 3 mismatches max
        setTimeout(() => setActiveAction(null), 2000);
      },
      isLoading: isScanningOffTarget,
    },
    {
      id: 'ghost',
      name: 'The Ghost',
      icon: Ghost,
      description: 'Toggle Synteny/Repeats',
      color: 'purple',
      action: async () => {
        setShowSynteny(!showSynteny);
        if (!showSynteny) {
          setActiveAction('ghost');
          await refreshSyntenyScan();
          setTimeout(() => setActiveAction(null), 2000);
        }
      },
      isLoading: isScanningSynteny,
      isActive: showSynteny,
    },
  ];

  const colorClasses = {
    rose: {
      bg: 'hover:bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      glow: 'shadow-rose-500/20',
    },
    emerald: {
      bg: 'hover:bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      glow: 'shadow-emerald-500/20',
    },
    cyan: {
      bg: 'hover:bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/20',
      glow: 'shadow-cyan-500/20',
    },
    purple: {
      bg: 'hover:bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/20',
      glow: 'shadow-purple-500/20',
    },
  };

  return (
    <div className="h-14 border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md flex items-center justify-center px-6 z-10 flex-shrink-0">
      {/* Surgical Tools */}
      <div className="flex items-center gap-2">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const colors = colorClasses[tool.color as keyof typeof colorClasses];
          const isActive = activeAction === tool.id || tool.isActive;

          return (
            <motion.button
              key={tool.id}
              onClick={tool.action}
              disabled={tool.isLoading}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "relative h-10 px-4 rounded-lg border transition-all duration-200",
                "flex items-center gap-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                isActive 
                  ? cn(
                      "bg-white/10 border-white/20",
                      colors.text,
                      `shadow-lg ${colors.glow}`
                    )
                  : cn(
                      "bg-[#030303] border-white/10",
                      colors.bg,
                      "text-slate-500"
                    )
              )}
              title={tool.description}
            >
              {/* Icon */}
              <Icon 
                className={cn(
                  "w-4 h-4 transition-all",
                  tool.isLoading && "animate-spin"
                )} 
                strokeWidth={2}
              />

              {/* Label */}
              <span className="text-[10px] font-black uppercase tracking-widest">
                {tool.name}
              </span>

              {/* Active Indicator */}
              {isActive && !tool.isLoading && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className={cn(
                    "absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center",
                    "bg-emerald-500"
                  )}
                >
                  <CheckCircle2 className="w-2 h-2 text-black" strokeWidth={3} />
                </motion.div>
              )}

              {/* Loading Pulse */}
              {tool.isLoading && (
                <motion.div
                  animate={{
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.5,
                  }}
                  className="absolute inset-0 rounded-lg bg-cyan-500/10 pointer-events-none"
                />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Info Panel */}
      <div className="absolute right-6 flex items-center gap-3 text-[10px] font-mono">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#030303] border border-white/10 rounded">
          <AlertCircle className="w-3 h-3 text-cyan-400" />
          <span className="text-slate-500">
            Cursor: <span className="text-cyan-400">{cursorPosition?.toLocaleString() ?? '--'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
