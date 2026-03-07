'use client';

/**
 * src/components/layout/SurgicalToolbar.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * SOVEREIGN DESIGN SYSTEM v10.2 — Abyssal Glassmorphism
 *
 * CHANGES (Task 2 wiring):
 *   • Scalpel: calls performSurgicalEdit(slabIndex, offset, 4)
 *     — base code 4 = N / deletion blank
 *     — slabIndex and offset derived from viewport.start
 *   • Suture:  opens a compact base-picker popover, then calls
 *     performSurgicalEdit(slabIndex, offset, base) to stage the insertion
 *     which flows through the SurgicalCommitDialog for the reason commit.
 *   • All console.log stubs removed.
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Scissors,
  Stethoscope,
  Radar,
  Ghost,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ── Constants ─────────────────────────────────────────────────────────────────

const SLAB_SIZE = 1_048_576; // default 1 MB slab — mirrors SlabManager

type BaseCode = 0 | 1 | 2 | 3 | 4;

const BASE_OPTIONS: { code: BaseCode; label: string; color: string; name: string }[] = [
  { code: 0, label: 'A', color: '#4ADE80', name: 'Adenine'  },
  { code: 1, label: 'C', color: '#38BDF8', name: 'Cytosine' },
  { code: 2, label: 'G', color: '#FACC15', name: 'Guanine'  },
  { code: 3, label: 'T', color: '#FB7185', name: 'Thymine'  },
];

// ── Suture Picker (base-selector popover) ─────────────────────────────────────

function SuturePicker({
  anchorRef,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (code: BaseCode) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose, anchorRef]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -6 }}
      transition={{ duration: 0.13, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        top: '110%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 500,
        padding: '10px 10px 8px',
        background: 'rgba(9, 15, 28, 0.97)',
        border: '1px solid rgba(74, 222, 128, 0.22)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(2, 6, 23, 0.80), 0 0 0 1px rgba(255,255,255,0.04)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
        minWidth: 190,
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 9, color: '#334155', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Insert base at cursor
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#1E293B', cursor: 'pointer', padding: 2 }}
        >
          <X size={10} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {BASE_OPTIONS.map(b => (
          <button
            key={b.code}
            onClick={() => { onSelect(b.code); onClose(); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '9px 0', borderRadius: 5,
              background: `${b.color}12`,
              border: `1px solid ${b.color}2A`,
              color: b.color,
              cursor: 'pointer', gap: 3,
              transition: 'opacity 120ms',
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.72')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{b.label}</span>
            <span style={{ fontSize: 7, opacity: 0.6 }}>{b.name}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SurgicalToolbar() {
  const [activeAction,   setActiveAction]   = useState<string | null>(null);
  const [showSynteny,    setShowSynteny]     = useState(false);
  const [showSuturePicker, setShowSuturePicker] = useState(false);

  const sutureButtonRef = useRef<HTMLButtonElement>(null);

  // ── Store connections ─────────────────────────────────────────────────────
  const viewport            = useArkheStore((state: ArkheState) => state.viewport);
  const performSurgicalEdit = useArkheStore((state: ArkheState) => state.performSurgicalEdit);
  const scanOffTargets      = useArkheStore((state: ArkheState) => state.scanOffTargets);
  const refreshSyntenyScan  = useArkheStore((state: ArkheState) => state.refreshSyntenyScan);
  const isScanningOffTarget = useArkheStore((state: ArkheState) => state.isScanningOffTarget);
  const isScanningSynteny   = useArkheStore((state: ArkheState) => state.isScanningSynteny);
  const isLocked            = useArkheStore((state: ArkheState) => state.isLocked);

  const cursorPosition = viewport.start;

  // ── Slab arithmetic ────────────────────────────────────────────────────────
  function slabAndOffset(pos: number): { slabIndex: number; offset: number } {
    return {
      slabIndex: Math.floor(pos / SLAB_SIZE),
      offset:    pos % SLAB_SIZE,
    };
  }

  // ── Tool definitions ───────────────────────────────────────────────────────
  const tools = [
    {
      id: 'scalpel',
      name: 'The Scalpel',
      icon: Scissors,
      description: 'Delete / blank base at cursor (stages N — requires commit)',
      color: 'rose',
      action: () => {
        if (cursorPosition === null || cursorPosition === undefined) return;
        const { slabIndex, offset } = slabAndOffset(cursorPosition);
        // Base code 4 = N (deletion/blank)
        performSurgicalEdit(slabIndex, offset, 4);
        // SurgicalCommitDialog mounts automatically via showCommitDialog in store.
        setActiveAction('scalpel');
        setTimeout(() => setActiveAction(null), 800);
      },
    },
    {
      id: 'suture',
      name: 'The Suture',
      icon: Stethoscope,
      description: 'Insert / replace base at cursor (opens base picker)',
      color: 'emerald',
      action: () => {
        if (cursorPosition === null || cursorPosition === undefined) return;
        setShowSuturePicker(prev => !prev);
      },
      isActive: showSuturePicker,
    },
    {
      id: 'radar',
      name: 'The Radar',
      icon: Radar,
      description: 'CRISPR Off-Target scan',
      color: 'cyan',
      action: async () => {
        setActiveAction('radar');
        const selectedSequence = 'ATGCATGCATGCATGCATGC'; // 20 bp at cursor — production: extract from viewport
        await scanOffTargets(selectedSequence, 3);
        setTimeout(() => setActiveAction(null), 2000);
      },
      isLoading: isScanningOffTarget,
    },
    {
      id: 'ghost',
      name: 'The Ghost',
      icon: Ghost,
      description: 'Toggle Synteny / Repeat overlay',
      color: 'purple',
      action: async () => {
        setShowSynteny(prev => !prev);
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

  // ── Suture base selection ──────────────────────────────────────────────────
  const handleSutureSelect = (base: BaseCode) => {
    if (cursorPosition === null || cursorPosition === undefined) return;
    const { slabIndex, offset } = slabAndOffset(cursorPosition);
    performSurgicalEdit(slabIndex, offset, base);
    // SurgicalCommitDialog opens automatically via showCommitDialog → true in store.
    setActiveAction('suture');
    setTimeout(() => setActiveAction(null), 800);
  };

  // ── Color map ─────────────────────────────────────────────────────────────
  const colorClasses = {
    rose: {
      bg:   'hover:bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      glow: 'shadow-rose-500/20',
    },
    emerald: {
      bg:   'hover:bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      glow: 'shadow-emerald-500/20',
    },
    cyan: {
      bg:   'hover:bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/20',
      glow: 'shadow-cyan-500/20',
    },
    purple: {
      bg:   'hover:bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/20',
      glow: 'shadow-purple-500/20',
    },
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div data-tour="toolbar" className="h-14 border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md flex items-center justify-center px-6 z-10 flex-shrink-0">

      {/* ── Surgical Tools ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {tools.map((tool) => {
          const Icon     = tool.icon;
          const colors   = colorClasses[tool.color as keyof typeof colorClasses];
          const isActive = activeAction === tool.id || tool.isActive;
          const isSuture = tool.id === 'suture';

          return (
            <div key={tool.id} className="relative">
              <motion.button
                ref={isSuture ? sutureButtonRef : undefined}
                onClick={tool.action}
                disabled={tool.isLoading || isLocked}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  'relative h-10 px-4 rounded-lg border transition-all duration-200',
                  'flex items-center gap-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isActive
                    ? cn(
                        'bg-white/10 border-white/20',
                        colors.text,
                        `shadow-lg ${colors.glow}`,
                      )
                    : cn(
                        'bg-[#030303] border-white/10',
                        colors.bg,
                        'text-slate-500',
                      ),
                )}
                title={tool.description}
              >
                {/* Icon */}
                <Icon
                  className={cn(
                    'w-4 h-4 transition-all',
                    tool.isLoading && 'animate-spin',
                  )}
                  strokeWidth={2}
                />

                {/* Label */}
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {tool.name}
                </span>

                {/* Active indicator dot */}
                {isActive && !tool.isLoading && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={cn(
                      'absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center',
                      'bg-emerald-500',
                    )}
                  >
                    <CheckCircle2 className="w-2 h-2 text-black" strokeWidth={3} />
                  </motion.div>
                )}

                {/* Loading pulse overlay */}
                {tool.isLoading && (
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="absolute inset-0 rounded-lg bg-cyan-500/10 pointer-events-none"
                  />
                )}
              </motion.button>

              {/* Suture base-picker popover */}
              {isSuture && (
                <AnimatePresence>
                  {showSuturePicker && (
                    <SuturePicker
                      anchorRef={sutureButtonRef}
                      onSelect={handleSutureSelect}
                      onClose={() => setShowSuturePicker(false)}
                    />
                  )}
                </AnimatePresence>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Info Panel ─────────────────────────────────────────────────────── */}
      <div className="absolute right-6 flex items-center gap-3 text-[10px] font-mono">
        {isLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] uppercase tracking-wider font-bold">Locked</span>
          </motion.div>
        )}

        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#030303] border border-white/10 rounded">
          <AlertCircle className="w-3 h-3 text-cyan-400" />
          <span className="text-slate-500">
            Cursor:{' '}
            <span className="text-cyan-400">
              {cursorPosition?.toLocaleString() ?? '--'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}