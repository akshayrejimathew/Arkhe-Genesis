'use client';

/**
 * src/components/onboarding/GenesisTour.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Interactive Step-by-Step Spotlight Tour
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This component has TWO usage modes:
 *
 *   MODE A — CONTROLLED (props-driven, original API):
 *     <GenesisTour steps={tourSteps} onComplete={fn} onSkip={fn} />
 *     Renders whenever it is mounted.  Parent controls visibility.
 *
 *   MODE B — STORE-CONNECTED (autonomous, Soul Integration):
 *     <GenesisTour />
 *     When no props are supplied, the component reads `onboardingActive`
 *     from the Zustand store.  It renders only when `onboardingActive === true`
 *     and calls `stopOnboarding()` on complete/skip.
 *
 *     Wire this in your root layout or workbench/page.tsx:
 *       const onboardingActive = useArkheStore(s => s.onboardingActive);
 *       {onboardingActive && <GenesisTour />}
 *     — or simply always mount it and let it self-gate via the store flag.
 *
 * ── SOUL INTEGRATION SPRINT — TASK 2 & TASK 3 ───────────────────────────────
 *
 *   TASK 2: Store wiring
 *     • When rendered with no props, reads `onboardingActive` from uiSlice.
 *     • `onComplete` and `onSkip` default to `stopOnboarding()`.
 *     • The default steps are the five-panel Workbench tour defined below.
 *
 *   TASK 3: Sovereign Wiki Modal
 *     • This file also exports the <WikiModal /> component.
 *     • WikiModal reads `isWikiOpen` from the store and renders the full
 *       ArkhéScript Command Codex as a full-screen modal.
 *     • Mount it once in your root layout: <WikiModal />
 *     • Open it from any sidebar icon via `useArkheStore(s => s.openWiki)()`.
 *
 * Features (existing):
 *   • Circular clip-path CSS spotlight + animated ring
 *   • Smooth transitions between steps
 *   • Progress dots with completion colouring
 *   • Keyboard navigation (← → Esc)
 *   • Tooltip arrow pointers positioned per step.position
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronLeft, X, Lightbulb,
  BookOpen, Terminal, Shield, GitBranch, Dna, Cpu,
  Command, Search, Download, FileText,
} from 'lucide-react';
import { useArkheStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// § Types
// ─────────────────────────────────────────────────────────────────────────────

interface TourStep {
  id:            string;
  title:         string;
  description:   string;
  targetElement: string; // CSS selector
  position:      'top' | 'bottom' | 'left' | 'right';
}

interface GenesisTourProps {
  steps?:      TourStep[];
  onComplete?: () => void;
  onSkip?:     () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Default tour steps (five-panel Workbench walk)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    id:            'file-upload',
    title:         'Welcome to Arkhé Genesis',
    description:   'Start by uploading your genome file (FASTA, GenBank, or AB1). Your sequence will be loaded into the editor instantly.',
    targetElement: '[data-tour="file-upload"]',
    position:      'bottom',
  },
  {
    id:            'sequence-editor',
    title:         'Sequence Editor',
    description:   'This is your main workspace. Edit bases, select regions, and perform surgical genomic operations with sub-angstrom precision.',
    targetElement: '[data-tour="sequence-editor"]',
    position:      'left',
  },
  {
    id:            'chronos-panel',
    title:         'Chronos Version Control',
    description:   'Every edit is SHA-256 chained and cloud-synced. Navigate your genome\'s history, revert changes, and create branches at any commit.',
    targetElement: '[data-tour="chronos"]',
    position:      'left',
  },
  {
    id:            'sentinel-panel',
    title:         'Sentinel Biosecurity',
    description:   'Full-genome Aho-Corasick threat scanner. Detects dual-use signatures across all SlabManager memory slabs — not just the visible viewport.',
    targetElement: '[data-tour="sentinel"]',
    position:      'right',
  },
  {
    id:            'surgical-toolbar',
    title:         'Surgical Tools',
    description:   'Cut, insert, invert, translate, find-replace, and more. Professional genome engineering at your fingertips. Type "help" in the Terminal for the full command list.',
    targetElement: '[data-tour="toolbar"]',
    position:      'bottom',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// § GenesisTour — Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function GenesisTour({
  steps:      propSteps,
  onComplete: propOnComplete,
  onSkip:     propOnSkip,
}: GenesisTourProps = {}) {

  // ── TASK 2: Store connection — MODE B (autonomous) ────────────────────────
  const onboardingActive = useArkheStore(s => s.onboardingActive);
  const stopOnboarding   = useArkheStore(s => s.stopOnboarding);

  // Resolve which steps and callbacks to use
  const steps      = propSteps      ?? DEFAULT_TOUR_STEPS;
  const onComplete = propOnComplete ?? stopOnboarding;
  const onSkip     = propOnSkip     ?? stopOnboarding;

  // In MODE B (no explicit props), the component self-gates on onboardingActive.
  // In MODE A (props provided), always render — parent controls mounting.
  const isModeB    = !propSteps && !propOnComplete && !propOnSkip;
  const shouldShow = isModeB ? onboardingActive : true;

  // ─────────────────────────────────────────────────────────────────────────
  const [currentStep,  setCurrentStep]  = useState(0);
  const [spotlightPos, setSpotlightPos] = useState({ x: 0, y: 0, radius: 150 });
  const [isVisible,    setIsVisible]    = useState(true);

  const step    = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast  = currentStep === steps.length - 1;

  // Update spotlight position when step changes
  useEffect(() => {
    if (!step || !shouldShow) return;

    const updateSpotlight = () => {
      const element = document.querySelector(step.targetElement);
      if (!element) return;

      const rect    = element.getBoundingClientRect();
      const centerX = rect.left + rect.width  / 2;
      const centerY = rect.top  + rect.height / 2;
      const radius  = Math.max(rect.width, rect.height) / 2 + 100;
      setSpotlightPos({ x: centerX, y: centerY, radius });
    };

    updateSpotlight();
    window.addEventListener('resize', updateSpotlight);
    return () => window.removeEventListener('resize', updateSpotlight);
  }, [step, shouldShow]);

  const handleNext = useCallback(() => {
    if (isLast) handleComplete();
    else        setCurrentStep(prev => prev + 1);
  }, [isLast]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrev = useCallback(() => {
    if (!isFirst) setCurrentStep(prev => prev - 1);
  }, [isFirst]);

  const handleComplete = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onComplete(), 300);
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onSkip(), 300);
  }, [onSkip]);

  // Keyboard navigation
  useEffect(() => {
    if (!shouldShow) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     handleSkip();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft')  handlePrev();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [shouldShow, handleSkip, handleNext, handlePrev]);

  // Get tooltip position relative to target element
  const getTooltipPosition = useCallback((): React.CSSProperties => {
    if (!step) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const element = document.querySelector(step.targetElement);
    if (!element) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const rect         = element.getBoundingClientRect();
    const tooltipWidth = 400;
    const tooltipHeight = 200;
    const offset       = 20;

    switch (step.position) {
      case 'top':
        return { top: `${rect.top - tooltipHeight - offset}px`, left: `${rect.left + rect.width / 2}px`, transform: 'translateX(-50%)' };
      case 'bottom':
        return { top: `${rect.bottom + offset}px`,              left: `${rect.left + rect.width / 2}px`, transform: 'translateX(-50%)' };
      case 'left':
        return { top: `${rect.top + rect.height / 2}px`,        left: `${rect.left - tooltipWidth - offset}px`, transform: 'translateY(-50%)' };
      case 'right':
        return { top: `${rect.top + rect.height / 2}px`,        left: `${rect.right + offset}px`,              transform: 'translateY(-50%)' };
      default:
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  }, [step]);

  // ─────────────────────────────────────────────────────────────────────────
  // Don't render anything if self-gated in MODE B
  // ─────────────────────────────────────────────────────────────────────────
  if (!shouldShow) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Spotlight Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] pointer-events-none"
            style={{
              background: '#000000',
              WebkitMaskImage: `radial-gradient(circle ${spotlightPos.radius}px at ${spotlightPos.x}px ${spotlightPos.y}px, transparent 0%, transparent 70%, black 100%)`,
              maskImage:       `radial-gradient(circle ${spotlightPos.radius}px at ${spotlightPos.x}px ${spotlightPos.y}px, transparent 0%, transparent 70%, black 100%)`,
              opacity: 0.92,
              transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />

          {/* Animated spotlight ring */}
          <motion.div
            className="fixed z-[10000] pointer-events-none"
            style={{
              left:       spotlightPos.x,
              top:        spotlightPos.y,
              width:      spotlightPos.radius * 2,
              height:     spotlightPos.radius * 2,
              marginLeft: -spotlightPos.radius,
              marginTop:  -spotlightPos.radius,
            }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1,   opacity: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <motion.div
              className="absolute inset-0 rounded-full border-4 border-cyan-400"
              animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ boxShadow: '0 0 40px rgba(6,182,212,0.6), inset 0 0 40px rgba(6,182,212,0.3)' }}
            />
          </motion.div>

          {/* Tooltip Card */}
          <motion.div
            key={currentStep}
            className="fixed z-[10001] pointer-events-auto"
            style={getTooltipPosition()}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1,   y: 0  }}
            exit={{   opacity: 0, scale: 0.9         }}
            transition={{ duration: 0.3 }}
          >
            <div className="w-[400px] bg-void-panel border border-razor rounded-lg overflow-hidden backdrop-blur-xl shadow-2xl">

              {/* Header */}
              <div className="p-4 border-b border-razor bg-void-surface/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-cyan-500/20 rounded">
                    <Lightbulb className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{step.title}</div>
                    <div className="text-[10px] text-zinc-600 font-mono">
                      Step {currentStep + 1} of {steps.length}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleSkip}
                  className="p-1 hover:bg-white/5 rounded transition-colors"
                  title="Skip tour"
                >
                  <X size={16} className="text-zinc-500" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4">
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {step.description}
                </p>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-razor bg-void/50 flex items-center justify-between">
                {/* Progress Dots */}
                <div className="flex items-center gap-1.5">
                  {steps.map((_, idx) => (
                    <motion.div
                      key={idx}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === currentStep
                          ? 'w-8 bg-cyan-400'
                          : idx < currentStep
                          ? 'w-1.5 bg-emerald-500'
                          : 'w-1.5 bg-zinc-700'
                      }`}
                      animate={idx === currentStep ? { opacity: [0.5, 1, 0.5] } : {}}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  ))}
                </div>

                {/* Navigation */}
                <div className="flex items-center gap-2">
                  {!isFirst && (
                    <button
                      onClick={handlePrev}
                      className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft size={14} />
                      Back
                    </button>
                  )}
                  <button
                    onClick={handleNext}
                    className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-mono uppercase tracking-wider rounded transition-all flex items-center gap-1 shadow-glow-cyan"
                  >
                    {isLast ? 'Complete Tour' : 'Next'}
                    {!isLast && <ChevronRight size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Arrow pointer */}
            <div
              className="absolute w-0 h-0 border-8"
              style={
                step.position === 'top'
                  ? { bottom: '-16px', left: '50%', transform: 'translateX(-50%)', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '8px solid rgba(39,39,42,0.95)' }
                  : step.position === 'bottom'
                  ? { top: '-16px', left: '50%', transform: 'translateX(-50%)', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid rgba(39,39,42,0.95)' }
                  : step.position === 'left'
                  ? { top: '50%', right: '-16px', transform: 'translateY(-50%)', borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '8px solid rgba(39,39,42,0.95)' }
                  : { top: '50%', left: '-16px',  transform: 'translateY(-50%)', borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid rgba(39,39,42,0.95)' }
              }
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § WikiModal — Sovereign Command Codex
// ─────────────────────────────────────────────────────────────────────────────
/**
 * WikiModal
 *
 * ── SOUL INTEGRATION — TASK 3 ────────────────────────────────────────────────
 *
 * A self-contained modal that renders the ArkhéScript Command Codex.
 * Mount it ONCE in your root layout:
 *
 *   // app/layout.tsx or workbench/page.tsx
 *   import { WikiModal } from '@/components/onboarding/GenesisTour';
 *   ...
 *   <WikiModal />
 *
 * Open it from the Sidebar BookOpen icon:
 *
 *   import { BookOpen } from 'lucide-react';
 *   const openWiki = useArkheStore(s => s.openWiki);
 *   <button onClick={openWiki} title="Command Codex">
 *     <BookOpen size={18} />
 *   </button>
 *
 * The modal reads `isWikiOpen` and calls `closeWiki()` — no prop plumbing.
 */

interface CodexSection {
  title:    string;
  icon:     React.ReactNode;
  color:    string;
  commands: { cmd: string; args?: string; desc: string }[];
}

const CODEX_SECTIONS: CodexSection[] = [
  {
    title: 'Sequence Operations',
    icon:  <Dna size={14} />,
    color: '#4ADE80',
    commands: [
      { cmd: 'fetch',   args: '<ID>',          desc: 'Load from NCBI RefSeq, UniProtKB, or Ensembl via Sovereign Bridge.' },
      { cmd: 'load',    args: '<path>',         desc: 'Load a local FASTA, GenBank, or AB1 file into the SlabManager.' },
      { cmd: 'export',  args: '[format]',       desc: 'Export current sequence as FASTA, GenBank, or raw. Default: FASTA.' },
      { cmd: 'reverse',  args: '',              desc: 'Reverse-complement the loaded sequence in-place.' },
      { cmd: 'slice',   args: '<start> <end>',  desc: 'Extract a subsequence by 1-based coordinates.' },
    ],
  },
  {
    title: 'Scanning & Analysis',
    icon:  <Shield size={14} />,
    color: '#FACC15',
    commands: [
      { cmd: 'scan',    args: '',               desc: 'Run full-genome Sentinel threat screen across all SlabManager slabs.' },
      { cmd: 'fold',    args: '<ID>',           desc: 'Predict protein secondary structure for the given ORF or accession.' },
      { cmd: 'pcr',     args: '[fwd] [rev]',    desc: 'Simulate in-silico PCR. Uses registered primers if none supplied.' },
      { cmd: 'orf',     args: '[min-len]',      desc: 'Find all open reading frames longer than min-len codons (default 30).' },
      { cmd: 'gc',      args: '[window]',       desc: 'Compute GC content. Optional: rolling window in bp (default: global).' },
    ],
  },
  {
    title: 'Chronos — Version Control',
    icon:  <GitBranch size={14} />,
    color: '#A78BFA',
    commands: [
      { cmd: 'history', args: '',               desc: 'Display the Chronos commit DAG — all chained mutations and branches.' },
      { cmd: 'commit',  args: '"<message>"',    desc: 'Commit the current sequence state with a message.' },
      { cmd: 'revert',  args: '<hash>',         desc: 'Revert to any prior commit by its SHA-256 prefix.' },
      { cmd: 'branch',  args: '<name>',         desc: 'Create a new named branch from the current commit.' },
      { cmd: 'merge',   args: '<branch>',       desc: 'Merge a named branch into HEAD. Conflicts are flagged in the Diff View.' },
    ],
  },
  {
    title: 'System & Session',
    icon:  <Cpu size={14} />,
    color: '#38BDF8',
    commands: [
      { cmd: 'status',  args: '',               desc: 'Print engine status: loaded sequence, worker health, sovereign mode.' },
      { cmd: 'clear',   args: '',               desc: 'Clear the terminal output ring-buffer (≤ 1,000 lines retained).' },
      { cmd: 'help',    args: '',               desc: 'Display the Command Matrix — all available commands at a glance.' },
      { cmd: 'wiki',    args: '',               desc: 'Open this Command Codex modal from the terminal.' },
      { cmd: 'reset',   args: '',               desc: 'Hard-reset the engine worker and flush all SlabManager memory.' },
    ],
  },
  {
    title: 'Search & Reports',
    icon:  <Search size={14} />,
    color: '#F472B6',
    commands: [
      { cmd: 'find',    args: '<pattern>',      desc: 'Search the loaded sequence for a nucleotide or amino-acid pattern.' },
      { cmd: 'report',  args: '[format]',       desc: 'Generate a full analysis report (HTML, PDF, or JSON).' },
      { cmd: 'align',   args: '<ID1> [ID2]',    desc: 'Pairwise alignment against a second accession or the current sequence.' },
    ],
  },
];

export function WikiModal() {
  const isWikiOpen = useArkheStore(s => s.isWikiOpen);
  const closeWiki  = useArkheStore(s => s.closeWiki);

  // Keyboard dismiss
  useEffect(() => {
    if (!isWikiOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWiki(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isWikiOpen, closeWiki]);

  return (
    <AnimatePresence>
      {isWikiOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{   opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={closeWiki}
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         9500,
            background:     'rgba(2,6,23,0.88)',
            backdropFilter: 'blur(6px)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            padding:        '24px',
          }}
        >
          {/* Modal panel — stop propagation so clicks inside don't close */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1.00 }}
            exit={{   opacity: 0, y: 10,  scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            onClick={e => e.stopPropagation()}
            style={{
              width:          '100%',
              maxWidth:       '780px',
              maxHeight:      '85vh',
              display:        'flex',
              flexDirection:  'column',
              background:     'rgba(9,15,28,0.97)',
              backdropFilter: 'blur(32px) saturate(180%)',
              border:         '1px solid rgba(255,255,255,0.09)',
              borderTop:      '2px solid #38BDF8',
              borderRadius:   14,
              boxShadow:      '0 32px 96px rgba(2,6,23,0.80), 0 0 0 1px rgba(56,189,248,0.10)',
              overflow:       'hidden',
            }}
          >
            {/* ── Header ── */}
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '16px 24px',
              borderBottom:   '1px solid rgba(255,255,255,0.07)',
              background:     'rgba(13,27,46,0.80)',
              flexShrink:     0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.22)', color: '#38BDF8' }}>
                  <BookOpen size={16} />
                </div>
                <div>
                  <h1 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 15, fontWeight: 700, color: '#F1F5F9', margin: 0, letterSpacing: '-0.01em' }}>
                    ArkhéScript Command Codex
                  </h1>
                  <p style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 10, color: '#475569', margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Sovereign Edition · v1.0 · Type &apos;help&apos; in the terminal for a quick reference
                  </p>
                </div>
              </div>

              <button
                onClick={closeWiki}
                style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.05)', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = '#94A3B8'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#475569'; }}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* ── Scrollable codex body ── */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', flexGrow: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {CODEX_SECTIONS.map(section => (
                  <div
                    key={section.title}
                    style={{
                      background:   'rgba(255,255,255,0.02)',
                      border:       `1px solid rgba(255,255,255,0.06)`,
                      borderLeft:   `2px solid ${section.color}`,
                      borderRadius: 8,
                      overflow:     'hidden',
                    }}
                  >
                    {/* Section header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: `${section.color}08` }}>
                      <span style={{ color: section.color }}>{section.icon}</span>
                      <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 10.5, fontWeight: 700, color: section.color, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                        {section.title}
                      </span>
                    </div>

                    {/* Commands */}
                    <div style={{ padding: '8px 0' }}>
                      {section.commands.map(({ cmd, args, desc }) => (
                        <div key={cmd} style={{ padding: '6px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 11.5, fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                              {cmd}
                            </span>
                            {args && (
                              <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 10, color: '#38BDF8', opacity: 0.75 }}>
                                {args}
                              </span>
                            )}
                          </div>
                          <span style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
                            {desc}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer note */}
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 8 }}>
                <p style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 10.5, color: '#38BDF8', margin: 0, opacity: 0.8 }}>
                  💡 All commands are available in the BioTerminal. Use ↑↓ arrow keys to browse history. Type &apos;help&apos; for a quick in-terminal Command Matrix.
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}