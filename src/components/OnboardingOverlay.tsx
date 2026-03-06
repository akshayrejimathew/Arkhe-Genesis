'use client';

/**
 * src/components/OnboardingOverlay.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Onboarding Tour Overlay
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DROP-IN REPLACEMENT for the previous plain version.
 *
 * Same API — only one prop:
 *   onClose: () => void
 *
 * workbench/page.tsx needs ZERO changes. It already handles the localStorage
 * 'isFirstTimeUser' flag correctly; this component does not touch it.
 *
 * What's new vs the old version:
 *   • Framer Motion SVG spotlight mask — dims the whole screen and cuts a
 *     glowing hole over the relevant panel region each step
 *   • Ghost Sequence — Step 3 (Terminal) auto-types a 40bp demo sequence
 *     one base at a time directly into the terminal input via
 *     useArkheStore(s => s.setTerminalInput), so the researcher sees the
 *     IDE respond live during the tour
 *   • Glassmorphism step card with colour-coded glow border per feature
 *   • Step dot navigation + keyboard (←/→/Escape)
 *   • Removed the broken localStorage.setItem('seen_intro') write — the
 *     workbench/page.tsx handler already writes 'isFirstTimeUser' = 'false'
 *     via its onClose callback, so this component must not double-write
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Terminal, Shield, GitBranch, Dna, Cpu } from 'lucide-react';
import { useArkheStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// § Types
// ─────────────────────────────────────────────────────────────────────────────

interface OnboardingOverlayProps {
  onClose: () => void;
}

// Spotlight region — defined as viewport percentages so no DOM IDs are needed.
// The SVG mask clips a glowing ellipse over the target area.
interface SpotlightRegion {
  cx: number;   // centre-x  0–100 (% of viewport width)
  cy: number;   // centre-y  0–100 (% of viewport height)
  rx: number;   // x-radius  (% of viewport width)
  ry: number;   // y-radius  (% of viewport height)
}

interface Step {
  id:          string;
  icon:        React.ReactNode;
  title:       string;
  description: string;
  detail:      string;
  color:       string;          // glow / accent colour for this step
  spotlight:   SpotlightRegion | null;  // null = welcome card, no spotlight
  cardSide:    'center' | 'left' | 'right' | 'bottom';
}

// ─────────────────────────────────────────────────────────────────────────────
// § Ghost Sequence
// A short 40bp demo sequence with an EcoRI site (GAATTC) that will be typed
// into the terminal input during Step 3, demonstrating live IDE interaction.
// ─────────────────────────────────────────────────────────────────────────────

const GHOST_SEQUENCE = 'ATGAAAGAATTCGCGGCGGCGCGATCGATCGATCGTAA';

const BASE_COLORS: Record<string, string> = {
  A: '#4ADE80', T: '#FB7185', C: '#38BDF8', G: '#FACC15',
};

// ─────────────────────────────────────────────────────────────────────────────
// § Step definitions
// Spotlight regions are tuned to the Workbench layout:
//   Icon Rail:   left ~2%   of width
//   Left Panel:  left ~2–20% of width
//   Center Panel:left ~20–70% of width
//   Right Panel: left ~70–100% of width
//   Terminal:    bottom ~25% of height
// ─────────────────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id:          'welcome',
    icon:        <Dna size={24} />,
    title:       'Welcome to Arkhé Genesis',
    description: 'The sovereign bioengineering IDE.',
    detail:      'A clinical-grade environment for genome analysis, mutation engineering, and biosecurity — with zero telemetry and total data ownership. This quick tour covers the five core workspaces.',
    color:       '#38BDF8',
    spotlight:   null,
    cardSide:    'center',
  },
  {
    id:          'sidebar',
    icon:        <Shield size={24} />,
    title:       'Left Sidebar — Explorer & Sentinel',
    description: 'Files, search, database, and biosecurity.',
    detail:      'The icon rail on the far left switches between Explorer (your genome files), Search, the NCBI/UniProt database browser, and Sentinel — the full-genome Aho-Corasick biosecurity scanner that runs automatically on every load.',
    color:       '#FB7185',
    spotlight:   { cx: 11, cy: 52, rx: 12, ry: 42 },
    cardSide:    'right',
  },
  {
    id:          'center',
    icon:        <Dna size={24} />,
    title:       'Center Panel — Sequence Workbench',
    description: 'Visualise and engineer your genome.',
    detail:      'The main canvas renders your loaded sequence with base-pair colouring, position markers, and the Surgical Toolbar for precision mutations. Switch to Diff View, Protein Viewport, or Off-Target Heatmap via the tab bar at the top.',
    color:       '#4ADE80',
    spotlight:   { cx: 44, cy: 50, rx: 25, ry: 44 },
    cardSide:    'right',
  },
  {
    id:          'terminal',
    icon:        <Terminal size={24} />,
    title:       'Terminal — Command Interface',
    description: 'The fastest way to operate the IDE.',
    detail:      'Every IDE action has a terminal command: load genomes, run scans, commit mutations, export reports. Watch the demo sequence being typed below — this is the Ghost Sequence feature, which pre-fills the terminal on first launch to show you what a real session looks like.',
    color:       '#38BDF8',
    spotlight:   { cx: 50, cy: 84, rx: 42, ry: 18 },
    cardSide:    'center',
  },
  {
    id:          'chronos',
    icon:        <GitBranch size={24} />,
    title:       'Right Panel — Chronos History',
    description: 'Time-travel through every mutation.',
    detail:      'Chronos is a Merkle-style commit DAG. Every mutation is SHA-256 chained, cloud-synced via Supabase, and recoverable via the FR-01 Frozen Recovery protocol. Branch, merge, and revert to any point in your sequence\'s history.',
    color:       '#A78BFA',
    spotlight:   { cx: 86, cy: 50, rx: 15, ry: 44 },
    cardSide:    'left',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// § SVG Spotlight Mask
// ─────────────────────────────────────────────────────────────────────────────

function SpotlightMask({ region, color }: { region: SpotlightRegion; color: string }) {
  // Convert % units to SVG viewBox coordinates (0–1000 × 0–1000)
  const cx = (region.cx / 100) * 1000;
  const cy = (region.cy / 100) * 1000;
  const rx = (region.rx / 100) * 1000;
  const ry = (region.ry / 100) * 1000;

  return (
    <motion.svg
      key={`${cx}-${cy}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      <defs>
        <mask id="spotlight-mask">
          {/* White = visible (dimmed) */}
          <rect x="0" y="0" width="1000" height="1000" fill="white" />
          {/* Black = cut-out (reveals content beneath) */}
          <motion.ellipse
            cx={cx} cy={cy} rx={rx} ry={ry}
            fill="black"
            initial={{ rx: rx * 0.4, ry: ry * 0.4 }}
            animate={{ rx, ry }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          />
        </mask>
        {/* Glow filter */}
        <filter id="spotlight-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Dim layer */}
      <rect x="0" y="0" width="1000" height="1000" fill="rgba(2,6,23,0.80)" mask="url(#spotlight-mask)" />

      {/* Glowing ring around the spotlight */}
      <motion.ellipse
        cx={cx} cy={cy}
        initial={{ rx: rx * 0.4 + 4, ry: ry * 0.4 + 4, opacity: 0 }}
        animate={{ rx: rx + 4, ry: ry + 4, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="8 5"
        opacity="0.55"
        filter="url(#spotlight-glow)"
      />
    </motion.svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Ghost Sequence Typewriter (visible inside the overlay card on Step 3)
// Also writes to the store so the terminal input lights up behind the overlay
// ─────────────────────────────────────────────────────────────────────────────

function GhostSequenceDisplay({ active }: { active: boolean }) {
  const [typed,      setTyped]      = useState('');
  const setTerminalInput = useArkheStore(s => s.setTerminalInput);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef   = useRef(0);

  useEffect(() => {
    if (!active) {
      setTyped('');
      idxRef.current = 0;
      return;
    }

    const tick = () => {
      if (idxRef.current <= GHOST_SEQUENCE.length) {
        const fragment = GHOST_SEQUENCE.slice(0, idxRef.current);
        setTyped(fragment);
        // Mirror to the terminal input in the background
        if (setTerminalInput) {
          setTerminalInput(`load ${fragment}`);
        }
        idxRef.current++;
        const delay = 35 + Math.random() * 30;
        timerRef.current = setTimeout(tick, delay);
      }
    };

    timerRef.current = setTimeout(tick, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, setTerminalInput]);

  if (!active) return null;

  return (
    <div style={{
      marginTop: 14,
      padding: '10px 14px',
      background: 'rgba(2,6,23,0.85)',
      border: '1px solid rgba(56,189,248,0.18)',
      borderRadius: 6,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 0,
      lineHeight: 1,
    }}>
      <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 10.5, color: '#38BDF8', marginRight: 6 }}>
        load&nbsp;
      </span>
      {typed.split('').map((base, i) => (
        <span
          key={i}
          style={{
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
            fontSize: 10.5,
            color: BASE_COLORS[base] ?? '#94A3B8',
          }}
        >
          {base}
        </span>
      ))}
      <motion.span
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
        style={{
          display: 'inline-block', width: 6, height: 11,
          background: '#38BDF8', borderRadius: 1,
          verticalAlign: 'text-bottom', marginLeft: 1,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Step card positioning
// ─────────────────────────────────────────────────────────────────────────────

function cardPosition(side: Step['cardSide']): React.CSSProperties {
  switch (side) {
    case 'left':   return { right: 'auto', left: '2%',  top: '50%', transform: 'translateY(-50%)' };
    case 'right':  return { left: 'auto',  right: '2%', top: '50%', transform: 'translateY(-50%)' };
    case 'bottom': return { bottom: '4%',  left: '50%', top: 'auto', transform: 'translateX(-50%)' };
    case 'center':
    default:       return { top: '50%',    left: '50%', transform: 'translate(-50%, -50%)' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingOverlay({ onClose }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);

  const current   = STEPS[step];
  const isFirst   = step === 0;
  const isLast    = step === STEPS.length - 1;
  const isTerminalStep = current.id === 'terminal';

  const handleNext = useCallback(() => {
    if (!isLast) setStep(s => s + 1);
    else         onClose();
  }, [isLast, onClose]);

  const handlePrev = useCallback(() => {
    if (!isFirst) setStep(s => s - 1);
  }, [isFirst]);

  // Keyboard navigation
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     onClose();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft')  handlePrev();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [handleNext, handlePrev, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9000 }}
    >
      {/* ── Background dim (no spotlight on welcome) ── */}
      <AnimatePresence mode="wait">
        {current.spotlight ? (
          <SpotlightMask
            key={current.id}
            region={current.spotlight}
            color={current.color}
          />
        ) : (
          <motion.div
            key="plain-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(2px)' }}
          />
        )}
      </AnimatePresence>

      {/* ── Step card ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0,  scale: 1.00 }}
          exit={{   opacity: 0, y: -8,  scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'absolute',
            ...cardPosition(current.cardSide),
            width:          340,
            background:     'rgba(9,15,28,0.95)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border:         `1px solid rgba(255,255,255,0.08)`,
            borderTop:      `2px solid ${current.color}`,
            borderRadius:   12,
            boxShadow:      `0 24px 72px rgba(2,6,23,0.70), 0 0 0 1px ${current.color}18, 0 0 40px ${current.color}0d`,
            overflow:       'hidden',
            zIndex:         9001,
          }}
        >
          {/* Top accent glow */}
          <div style={{ position: 'absolute', top: -28, left: '25%', right: '25%', height: 48, background: `radial-gradient(ellipse, ${current.color}22 0%, transparent 70%)`, pointerEvents: 'none' }} />

          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px 0',
          }}>
            {/* Step dots */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setStep(i)}
                  style={{
                    width: i === step ? 18 : 6,
                    height: 6,
                    borderRadius: 3,
                    border: 'none',
                    background: i === step ? current.color : 'rgba(255,255,255,0.12)',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'all 220ms',
                  }}
                />
              ))}
              <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 9, color: '#475569', marginLeft: 4, textTransform: 'uppercase', letterSpacing: '0.10em' }}>
                {step + 1}/{STEPS.length}
              </span>
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.04)', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#94A3B8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#475569'; }}
            >
              <X size={13} />
            </button>
          </div>

          {/* ── Body ── */}
          <div style={{ padding: '16px 18px 18px' }}>

            {/* Icon + title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
              <div style={{
                width: 44, height: 44, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 10,
                background: `${current.color}12`,
                border: `1px solid ${current.color}28`,
                color: current.color,
              }}>
                {current.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 14, fontWeight: 700, color: '#F1F5F9', letterSpacing: '-0.01em', margin: 0, marginBottom: 3, lineHeight: 1.3 }}>
                  {current.title}
                </h2>
                <p style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 11.5, color: current.color, margin: 0 }}>
                  {current.description}
                </p>
              </div>
            </div>

            {/* Detail text */}
            <p style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 12.5, color: '#64748B', lineHeight: 1.72, margin: 0 }}>
              {current.detail}
            </p>

            {/* Ghost sequence (terminal step only) */}
            <GhostSequenceDisplay active={isTerminalStep} />

            {/* ── Navigation ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
              <button
                onClick={handlePrev}
                disabled={isFirst}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '7px 14px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  color: isFirst ? '#1E293B' : '#64748B',
                  cursor: isFirst ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-inter, system-ui, sans-serif)',
                  fontSize: 12, fontWeight: 500,
                  transition: 'all 150ms',
                }}
                onMouseEnter={e => { if (!isFirst) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#94A3B8'; }}}
                onMouseLeave={e => { if (!isFirst) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#64748B'; }}}
              >
                <ChevronLeft size={13} />
                Back
              </button>

              <button
                onClick={handleNext}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 18px', borderRadius: 6,
                  border: 'none',
                  background: current.color,
                  color: '#020617',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-jetbrains-mono, monospace)',
                  fontSize: 12, fontWeight: 700,
                  boxShadow: `0 0 16px ${current.color}30`,
                  transition: 'all 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.12)'; e.currentTarget.style.boxShadow = `0 0 24px ${current.color}50`; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)';    e.currentTarget.style.boxShadow = `0 0 16px ${current.color}30`; }}
              >
                {isLast ? 'Launch IDE' : 'Next'}
                <ChevronRight size={13} />
              </button>
            </div>
          </div>

          {/* Bottom keyboard hint */}
          <div style={{ padding: '8px 18px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ← → Navigate &nbsp;·&nbsp; Esc Skip tour
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}