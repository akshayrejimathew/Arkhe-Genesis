'use client';

/**
 * src/components/layout/Workbench.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ── SPRINT B CHANGES ─────────────────────────────────────────────────────────
 *
 *   TASK 3 — "Trust Badge" Source Provenance in Header
 *
 *   Scientists need to know whether the sequence they are viewing has been
 *   validated by an external database or is locally authored.  A "Source Badge"
 *   now appears in the header, to the right of the genome pill:
 *
 *     [UNVALIDATED DRAFT]           — yellow  — local file upload or no source
 *     [NCBI VERIFIED: NC_000913.3]  — green   — fetched via fetch <ncbi_acc>
 *     [UNIPROT: P69905]             — blue    — fetched via fetch <uniprot_id>
 *     [MUTATED: was NC_000913.3]    — orange  — any sequence after a mutation
 *
 *   Implementation:
 *     • SourceTracker (from ExternalData.ts) is subscribed via useEffect.
 *     • When a local file is ingested via handleFileChange, SourceTracker is
 *       set to { type: 'file', id: file.name }.
 *     • When a mutation is committed via the scissor tool, SourceTracker
 *       .markMutated() is called.
 *     • The <SourceBadge> sub-component renders the badge with animated
 *       mount/update via framer-motion, consistent with the existing style system.
 *
 * ── SPRINT 2 CHANGES (retained) ──────────────────────────────────────────────
 *   TASK 1: Tablet Touch Targets (ColHandle/RowHandle 16 px hit zones)
 *   TASK 2: themeMode lifted to Zustand store (persist middleware)
 *
 * ── SPRINT 1 ADDITIONS (retained) ────────────────────────────────────────────
 *   TASK 1: Visual Contrast & Legibility
 *   TASK 2: Clean Room / Abyssal theme toggle
 *   TASK 3: Professional Header Refinement
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useState, useEffect, useRef, useCallback, createContext, useContext,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { SystemLog } from '@/types/SystemLog';

// ─────────────────────────────────────────────────────────────────────────────
// § Lucide icons
// ─────────────────────────────────────────────────────────────────────────────
import {
  FolderOpen, Search, Database, Shield, GitBranch,
  Terminal, Settings, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, Dna, Upload, Scissors,
  Activity, HelpCircle, X, Download, GitMerge,
  Diff, Box, Loader2, ChevronRight as ChevRight,
  AlertTriangle, CheckCircle2, Microscope,
  Radar, FileCheck, ShieldCheck, ShieldAlert,
  Sun, Moon, Stethoscope, Share2, FlaskConical,
  BookOpen,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// § Store + types
// ─────────────────────────────────────────────────────────────────────────────
import { useArkheStore, type ArkheState } from '@/store';
import type { AssemblyPrediction } from '@/types/arkhe';

// ─────────────────────────────────────────────────────────────────────────────
// § SPRINT B — Source provenance tracker
// ─────────────────────────────────────────────────────────────────────────────
import { SourceTracker, type SequenceSource } from '@/lib/ExternalData';
import { downloadFHIR } from '@/lib/ClinicalExport';
import { generateClinicalReport } from '@/lib/Reporting';

// ─────────────────────────────────────────────────────────────────────────────
// § Layout & panel components
// ─────────────────────────────────────────────────────────────────────────────
import ArkheLogo from '@/components/branding/ArkheLogo';
import SequenceView from '@/components/SequenceView';
import Explorer from '@/components/Explorer';
import InspectorPanel from '@/components/InspectorPanel';
import ChronosSidebar from '@/components/ChronosSidebar';
import SurgicalToolbar from '@/components/layout/SurgicalToolbar';
import BioTerminal from '@/components/visuals/BioTerminal';
import Sentinel from '@/components/panels/Sentinel';
import DatabasePanel from '@/components/panels/DatabasePanel';
import CommandPalette from '@/components/ui/CommandPalette';
import HelpOverlay from '@/components/ui/HelpOverlay';
import SurgicalCommitDialog from '@/components/modals/SurgicalCommitDialog';

// ─────────────────────────────────────────────────────────────────────────────
// § Visualization door imports
// ─────────────────────────────────────────────────────────────────────────────
import BioDiffMode from '@/components/visualization/BioDiffMode';
import ProteinViewport from '@/components/visuals/ProteinViewport';
import OffTargetHeatmap from '@/components/visualization/OffTargetHeatmap';
import GenesisAuditReport from '@/components/reports/GenesisAuditReport';
import { generateAuditReport } from '@/lib/reportGenerator';
import GenesisTour from '@/components/onboarding/GenesisTour';

// ─────────────────────────────────────────────────────────────────────────────
// § Panel type aliases
// ─────────────────────────────────────────────────────────────────────────────
type LeftPanel   = 'explorer' | 'search' | 'database' | 'sentinel';
type RightPanel  = 'inspector' | 'chronos';
type ActiveView  = 'default' | 'diff' | 'protein' | 'heatmap' | 'report';
type ThemeMode   = 'abyssal' | 'cleanroom';

// ─────────────────────────────────────────────────────────────────────────────
// § SPRINT 1 — Theme token system
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeTokens {
  bg:          string;
  bgPanel:     string;
  bgSurface:   string;
  bgHeader:    string;
  bgTabBar:    string;
  bgModal:     string;
  bgInput:     string;
  bgHover:     string;
  bgActive:    string;
  textPrimary:   string;
  textSecondary: string;
  textDim:       string;
  textGhost:     string;
  border:       string;
  borderPanel:  string;
  borderSubtle: string;
  accent:        string;
  accentText:    string;
  accentBg:      string;
  accentBorder:  string;
  iconDefault: string;
  iconHover:   string;
  handleBg:    string;
  handleHover: string;
  name: ThemeMode;
}

const THEMES: Record<ThemeMode, ThemeTokens> = {
  abyssal: {
    name:          'abyssal',
    bg:            '#020617',
    bgPanel:       'rgba(2,6,23,0.97)',
    bgSurface:     'rgba(9,15,28,0.82)',
    bgHeader:      'rgba(2,6,23,0.99)',
    bgTabBar:      'rgba(9,15,28,0.85)',
    bgModal:       'rgba(9,15,28,0.97)',
    bgInput:       'rgba(255,255,255,0.03)',
    bgHover:       'rgba(255,255,255,0.05)',
    bgActive:      'rgba(56,189,248,0.08)',
    textPrimary:   '#F1F5F9',
    textSecondary: '#94A3B8',
    textDim:       '#64748B',
    textGhost:     '#475569',
    border:        'rgba(255,255,255,0.07)',
    borderPanel:   'rgba(255,255,255,0.06)',
    borderSubtle:  'rgba(255,255,255,0.04)',
    accent:        '#38BDF8',
    accentText:    '#38BDF8',
    accentBg:      'rgba(56,189,248,0.08)',
    accentBorder:  'rgba(56,189,248,0.20)',
    iconDefault:   '#64748B',
    iconHover:     '#94A3B8',
    handleBg:      'rgba(255,255,255,0.04)',
    handleHover:   'rgba(56,189,248,0.55)',
  },
  cleanroom: {
    name:          'cleanroom',
    bg:            '#F1F5F9',
    bgPanel:       '#FFFFFF',
    bgSurface:     '#F8FAFC',
    bgHeader:      '#FFFFFF',
    bgTabBar:      '#F8FAFC',
    bgModal:       '#FFFFFF',
    bgInput:       'rgba(0,0,0,0.03)',
    bgHover:       'rgba(0,0,0,0.04)',
    bgActive:      'rgba(14,165,233,0.08)',
    textPrimary:   '#0F172A',
    textSecondary: '#334155',
    textDim:       '#64748B',
    textGhost:     '#94A3B8',
    border:        '#CBD5E1',
    borderPanel:   '#E2E8F0',
    borderSubtle:  '#F1F5F9',
    accent:        '#0EA5E9',
    accentText:    '#0284C7',
    accentBg:      'rgba(14,165,233,0.08)',
    accentBorder:  'rgba(14,165,233,0.25)',
    iconDefault:   '#64748B',
    iconHover:     '#334155',
    handleBg:      'rgba(0,0,0,0.06)',
    handleHover:   'rgba(14,165,233,0.60)',
  },
};

// Theme context — all child components in this file read the theme
const ThemeContext = createContext<ThemeTokens>(THEMES.abyssal);
const useTheme = () => useContext(ThemeContext);

// ─────────────────────────────────────────────────────────────────────────────
// § SPRINT B — Source Badge
//
// Displays the provenance of the currently loaded sequence.  Positioned in the
// header between the genome pill and the action strip.
//
// Badge variants:
//   ncbi     → green    [NCBI VERIFIED: <accession>]
//   uniprot  → blue     [UNIPROT: <id>]
//   file     → yellow   [UNVALIDATED DRAFT]
//   manual   → orange   [MUTATED: was <id>]
//   null     → yellow   [UNVALIDATED DRAFT]  (after any mutation without prior source)
// ─────────────────────────────────────────────────────────────────────────────

interface SourceBadgeConfig {
  bg: string;
  border: string;
  textColor: string;
  dotColor: string;
  icon: React.ReactNode;
  label: string;
}

function getSourceBadgeConfig(source: SequenceSource | null): SourceBadgeConfig {
  if (!source || source.type === 'file') {
    return {
      bg:        'rgba(234,179,8,0.08)',
      border:    'rgba(234,179,8,0.25)',
      textColor: '#FDE68A',
      dotColor:  '#EAB308',
      icon: <ShieldAlert size={9} style={{ color: '#EAB308' }} />,
      label: 'UNVALIDATED DRAFT',
    };
  }
  if (source.type === 'manual') {
    return {
      bg:        'rgba(249,115,22,0.08)',
      border:    'rgba(249,115,22,0.25)',
      textColor: '#FED7AA',
      dotColor:  '#F97316',
      icon: <ShieldAlert size={9} style={{ color: '#F97316' }} />,
      label: source.label,
    };
  }
  if (source.type === 'ncbi') {
    return {
      bg:        'rgba(16,185,129,0.08)',
      border:    'rgba(16,185,129,0.25)',
      textColor: '#6EE7B7',
      dotColor:  '#10B981',
      icon: <ShieldCheck size={9} style={{ color: '#10B981' }} />,
      label: `NCBI VERIFIED: ${source.id}`,
    };
  }
  if (source.type === 'uniprot') {
    return {
      bg:        'rgba(99,102,241,0.08)',
      border:    'rgba(99,102,241,0.25)',
      textColor: '#C7D2FE',
      dotColor:  '#818CF8',
      icon: <ShieldCheck size={9} style={{ color: '#818CF8' }} />,
      label: `UNIPROT: ${source.id}`,
    };
  }
  return {
    bg:        'rgba(234,179,8,0.08)',
    border:    'rgba(234,179,8,0.25)',
    textColor: '#FDE68A',
    dotColor:  '#EAB308',
    icon: <ShieldAlert size={9} style={{ color: '#EAB308' }} />,
    label: 'UNVALIDATED DRAFT',
  };
}

function SourceBadge({ source }: { source: SequenceSource | null }) {
  const cfg = getSourceBadgeConfig(source);
  return (
    <motion.div
      key={source?.label ?? 'draft'}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.15 }}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 4,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        flexShrink: 0, minWidth: 0,
      }}
      title={`Data provenance: ${cfg.label}`}
    >
      {cfg.icon}
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: cfg.textColor,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 200,
      }}>
        {cfg.label}
      </span>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Resize handles (theme-aware)
// SPRINT 2 — TASK 1: 16 px outer hit zone, 2 px visible line
// ─────────────────────────────────────────────────────────────────────────────

function ColHandle() {
  const T = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Separator
      style={{ width: 16, flexShrink: 0, position: 'relative', zIndex: 5, margin: '0 -6px' }}
      aria-label="Resize panel"
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute', inset: 0,
          background: hover ? (T.name === 'abyssal' ? 'rgba(56,189,248,0.07)' : 'rgba(14,165,233,0.07)') : 'transparent',
          cursor: 'col-resize', transition: 'background 100ms',
        }}
      >
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: '50%',
          transform: 'translateX(-50%)', width: 2,
          background: hover ? T.handleHover : T.handleBg,
          boxShadow: hover ? `0 0 8px ${T.accent}55` : 'none',
          transition: 'all 120ms',
        }} />
      </div>
    </Separator>
  );
}

function RowHandle() {
  const T = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Separator
      style={{ height: 16, flexShrink: 0, position: 'relative', zIndex: 5, margin: '-6px 0' }}
      aria-label="Resize terminal"
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute', inset: 0,
          background: hover ? (T.name === 'abyssal' ? 'rgba(56,189,248,0.07)' : 'rgba(14,165,233,0.07)') : 'transparent',
          cursor: 'row-resize', transition: 'background 100ms',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          transform: 'translateY(-50%)', height: 2,
          background: hover ? T.handleHover : T.handleBg,
          boxShadow: hover ? `0 0 8px ${T.accent}55` : 'none',
          transition: 'all 120ms',
        }} />
      </div>
    </Separator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § ScissorModal — point-mutation popover
// ─────────────────────────────────────────────────────────────────────────────

type BaseCode4 = 0 | 1 | 2 | 3;
interface BaseOption { code: BaseCode4; label: string; color: string; name: string; }

const BASE_OPTIONS: BaseOption[] = [
  { code: 0, label: 'A', color: '#4ADE80', name: 'Adenine'  },
  { code: 1, label: 'C', color: '#38BDF8', name: 'Cytosine' },
  { code: 2, label: 'G', color: '#FACC15', name: 'Guanine'  },
  { code: 3, label: 'T', color: '#FB7185', name: 'Thymine'  },
];

function ScissorModal({
  position, onClose, onApply,
}: {
  position: number;
  onClose: () => void;
  onApply: (base: BaseCode4) => void;
}) {
  const T = useTheme();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: T.name === 'abyssal' ? 'rgba(2,6,23,0.80)' : 'rgba(15,23,42,0.60)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
      }}
    >
      <motion.div
        initial={{ scale: 0.93, y: 10 }} animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 10 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{
          background: T.bgModal,
          border: `1px solid ${T.border}`,
          borderRadius: 10, padding: '28px 32px', minWidth: 340,
          boxShadow: T.name === 'abyssal' ? '0 32px 64px rgba(2,6,23,0.80)' : '0 32px 64px rgba(15,23,42,0.20)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Scissors size={13} style={{ color: '#FB7185' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Point Mutation
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.textGhost }}>
              Position: <span style={{ color: T.accentText, fontWeight: 600 }}>{position.toLocaleString()}</span> bp
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: T.textGhost, cursor: 'pointer', padding: 4, transition: 'color 120ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = T.textDim)}
            onMouseLeave={e => (e.currentTarget.style.color = T.textGhost)}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textGhost, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12 }}>
            Select replacement base
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {BASE_OPTIONS.map(b => (
              <button
                key={b.label}
                onClick={() => onApply(b.code)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '12px 0', borderRadius: 6,
                  background: `${b.color}10`, border: `1px solid ${b.color}30`,
                  color: b.color, cursor: 'pointer', gap: 4, transition: 'all 150ms',
                  fontFamily: 'var(--font-jetbrains-mono, monospace)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${b.color}20`; (e.currentTarget as HTMLElement).style.borderColor = `${b.color}55`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${b.color}10`; (e.currentTarget as HTMLElement).style.borderColor = `${b.color}30`; }}
              >
                <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{b.label}</span>
                <span style={{ fontSize: 9, opacity: 0.7, letterSpacing: '0.05em' }}>{b.name}</span>
              </button>
            ))}
          </div>
        </div>

        <p style={{ fontSize: 10, color: T.textGhost, textAlign: 'center', lineHeight: 1.7 }}>
          Mutation staged in Chronos. Use Surgical Commit to persist.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § AssemblyJunctionModal
// ─────────────────────────────────────────────────────────────────────────────

interface HairpinPreviewResult {
  valid: boolean;
  message: string;
  overlapLength?: number;
  scarLength?: number;
  frameshift?: boolean;
}

function AssemblyJunctionModal({ onClose }: { onClose: () => void }) {
  const T = useTheme();
  const [upstream,   setUpstream]   = useState('');
  const [downstream, setDownstream] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<HairpinPreviewResult | null>(null);

  const worker = useArkheStore((s: ArkheState) => s.worker);
  const addLog = useArkheStore((s: ArkheState) => s.addSystemLog);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handlePredict = useCallback(async () => {
    if (!upstream.trim() || !downstream.trim() || !worker) return;
    setLoading(true);
    setResult(null);

    const id = Math.random().toString(36).slice(2, 10);

    try {
      const res = await new Promise<AssemblyPrediction>((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.removeEventListener('message', handler);
          reject(new Error('Worker timeout after 15 s'));
        }, 15_000);

        const handler = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          if (e.data.type === 'ERROR') reject(new Error(e.data.payload?.message ?? 'Worker error'));
          else resolve(e.data.payload as AssemblyPrediction);
        };

        worker.addEventListener('message', handler);
        worker.postMessage({
          type: 'PREDICT_ASSEMBLY_JUNCTION',
          id,
          payload: { upstreamSeq: upstream.trim(), downstreamSeq: downstream.trim() },
        });
      });

      setResult({ ...res });
      addLog({
        level: res.valid ? 'success' : 'warning',
        category: 'SYSTEM' as any,
        message: `Assembly junction: ${res.message}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ valid: false, message: `Error: ${msg}` });
      addLog({ level: 'error', category: 'SYSTEM' as any, message: `Assembly junction error: ${msg}`, timestamp: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [upstream, downstream, worker, addLog]);

  const inputStyle: React.CSSProperties = {
    width: '100%', background: T.bgInput,
    border: `1px solid ${T.border}`, borderRadius: 5,
    padding: '8px 10px', color: T.textSecondary, fontSize: 12,
    fontFamily: 'var(--font-jetbrains-mono, monospace)',
    outline: 'none', boxSizing: 'border-box', letterSpacing: '0.04em',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: T.name === 'abyssal' ? 'rgba(2,6,23,0.82)' : 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
      }}
    >
      <motion.div
        initial={{ scale: 0.93, y: 12 }} animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 12 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{
          background: T.bgModal, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: '24px 28px', minWidth: 380, maxWidth: 440,
          boxShadow: T.name === 'abyssal' ? '0 32px 64px rgba(2,6,23,0.80)' : '0 24px 48px rgba(15,23,42,0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <GitMerge size={13} style={{ color: T.accentText }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Assembly Junction Predictor
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.textGhost }}>GG / Gibson overlap analysis</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: T.textGhost, cursor: 'pointer', padding: 4, transition: 'color 120ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = T.textDim)}
            onMouseLeave={e => (e.currentTarget.style.color = T.textGhost)}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: T.textGhost, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Upstream fragment (5′)</div>
            <textarea value={upstream} onChange={e => setUpstream(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))} placeholder="ATCGATCG…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: T.textGhost, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Downstream fragment (3′)</div>
            <textarea value={downstream} onChange={e => setDownstream(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))} placeholder="GCTAGCTA…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <button
          onClick={() => void handlePredict()}
          disabled={loading || !upstream.trim() || !downstream.trim() || !worker}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 5,
            background: T.accentBg, border: `1px solid ${T.accentBorder}`,
            color: T.accentText, fontSize: 12, fontWeight: 600,
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
            cursor: loading || !upstream.trim() || !downstream.trim() || !worker ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 150ms', opacity: !upstream.trim() || !downstream.trim() || !worker ? 0.5 : 1,
          }}
        >
          {loading ? <><Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> Predicting…</> : 'Predict Junction'}
        </button>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 6,
                background: result.valid ? 'rgba(16,185,129,0.06)' : 'rgba(251,113,133,0.06)',
                border: `1px solid ${result.valid ? 'rgba(16,185,129,0.20)' : 'rgba(251,113,133,0.20)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {result.valid
                  ? <CheckCircle2 size={13} style={{ color: '#10B981', flexShrink: 0, marginTop: 1 }} />
                  : <AlertTriangle size={13} style={{ color: '#FB7185', flexShrink: 0, marginTop: 1 }} />}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: result.valid ? '#10B981' : '#FB7185', marginBottom: 4 }}>
                    {result.valid ? 'Valid Junction' : 'Junction Issue'}
                  </div>
                  <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.6 }}>{result.message}</div>
                  {result.overlapLength !== undefined && (
                    <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>
                      Overlap: <span style={{ color: T.accentText }}>{result.overlapLength} bp</span>
                      {result.scarLength !== undefined && <> · Scar: <span style={{ color: '#FACC15' }}>{result.scarLength} bp</span></>}
                      {result.frameshift !== undefined && <> · Frameshift: <span style={{ color: result.frameshift ? '#FB7185' : '#10B981' }}>{result.frameshift ? 'Yes' : 'No'}</span></>}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § SearchPanel
// ─────────────────────────────────────────────────────────────────────────────

const IUPAC_RE = /^[ACGTURYSWKMBDHVNacgturyswkmbdhvn]+$/;

function SearchPanel() {
  const T = useTheme();
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<number[]>([]);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const worker    = useArkheStore((s: ArkheState) => s.worker);
  const hasGenome = useArkheStore((s: ArkheState) => s.genomeLength > 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((q: string) => {
    if (!q.trim() || !worker || !hasGenome) { setResults([]); return; }
    if (!IUPAC_RE.test(q)) { setError('Invalid IUPAC characters'); return; }
    setError(''); setLoading(true);
    const id = Math.random().toString(36).slice(2, 10);
    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', handler);
      setLoading(false);
      if (e.data.type === 'ERROR') { setError(e.data.payload?.message ?? 'Error'); return; }
      setResults((e.data.payload as { hits: number[] }).hits ?? []);
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'MOTIF_SEARCH', id, payload: { pattern: q.trim().toUpperCase() } });
  }, [worker, hasGenome]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(v), 400);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 10px 0' }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ position: 'relative' }}>
          <Search size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: T.textGhost, pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={handleChange}
            placeholder="IUPAC motif (e.g. ATCG)"
            style={{
              width: '100%', background: T.bgInput,
              border: `1px solid ${error ? 'rgba(251,113,133,0.40)' : T.border}`,
              borderRadius: 4, padding: '7px 10px 7px 28px',
              color: T.textSecondary, fontSize: 12, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
            }}
          />
        </div>
        {error && <div style={{ fontSize: 10, color: '#FB7185', marginTop: 5 }}>{error}</div>}
      </div>

      <div style={{ fontSize: 10, color: T.textGhost, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
        {loading ? 'Searching…' : results.length > 0 ? `${results.length} hit${results.length !== 1 ? 's' : ''}` : query.trim() ? 'No results' : 'Enter motif'}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {results.map((pos, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 6px', borderRadius: 3, marginBottom: 2, cursor: 'pointer',
            transition: 'background 80ms',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.bgHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.accent, flexShrink: 0, opacity: 0.8 }} />
            <span style={{ fontSize: 11, color: T.accentText, fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>{pos.toLocaleString()}</span>
            <span style={{ fontSize: 10, color: T.textGhost }}>bp</span>
          </div>
        ))}
        {query.trim() && !loading && results.length === 0 && !error && (
          <div style={{ textAlign: 'center', paddingTop: 24, fontSize: 11, color: T.textGhost, lineHeight: 1.8 }}>
            No matches for<br /><span style={{ color: T.accentText, fontWeight: 600 }}>&quot;{query.trim()}&quot;</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Surgical Suite Dropdown
// ─────────────────────────────────────────────────────────────────────────────

function SurgicalDropdown({
  disabled, onManualMutation, onAssemblyPredictor, chronosHead, getDiffForTx, addLog, onDiffReady,
}: {
  disabled: boolean;
  onManualMutation: () => void;
  onAssemblyPredictor: () => void;
  chronosHead: string | null;
  getDiffForTx: (txId: string) => Promise<unknown>;
  addLog: (log: SystemLog) => void;
  onDiffReady: (data: any) => void;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ddPos, setDdPos] = useState({ top: 0, left: 0 });

  const openMenu = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDdPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, [open]);

  const handleMyersDiff = useCallback(async () => {
    setOpen(false);
    if (!chronosHead) {
      addLog({ level: 'warning', category: 'CHRONOS' as any, message: 'No commit HEAD — stage a mutation first.', timestamp: Date.now() });
      return;
    }
    addLog({ level: 'info', category: 'CHRONOS' as any, message: `Extracting Myers diff for tx ${chronosHead.slice(0, 8)}…`, timestamp: Date.now() });
    try {
      const diff = await getDiffForTx(chronosHead);
      const processedDiff: { oldSeq: string; newSeq: string; changes: any[] } = { oldSeq: '', newSeq: '', changes: [] };
      if (diff && typeof diff === 'object') {
        const d = diff as any;
        processedDiff.oldSeq  = d.oldSequence || d.oldSeq  || '';
        processedDiff.newSeq  = d.newSequence || d.newSeq  || '';
        processedDiff.changes = d.mutations   || d.changes || [];
      }
      const entries = Array.isArray(diff) ? diff.length : typeof diff === 'object' && diff !== null ? Object.keys(diff).length : 1;
      addLog({ level: 'success', category: 'CHRONOS' as any, message: `Myers diff: ${entries} edit operation${entries !== 1 ? 's' : ''} extracted from ${chronosHead.slice(0, 8)}.`, timestamp: Date.now() });
      onDiffReady(processedDiff);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({ level: 'error', category: 'CHRONOS' as any, message: `Diff extraction failed: ${msg}`, timestamp: Date.now() });
    }
  }, [chronosHead, getDiffForTx, addLog, onDiffReady]);

  const ITEMS = [
    { Icon: Scissors, label: 'Manual Mutation',             sublabel: 'Point edit at cursor position',       color: '#FB7185', action: () => { setOpen(false); onManualMutation(); } },
    { Icon: Diff,     label: 'Myers Diff Extraction',       sublabel: 'Export edit operations from HEAD',    color: '#FACC15', action: () => void handleMyersDiff() },
    { Icon: Box,      label: 'Assembly Junction Predictor', sublabel: 'Predict GG / Gibson junction',        color: T.accentText, action: () => { setOpen(false); onAssemblyPredictor(); } },
  ];

  const DDStyle: React.CSSProperties = {
    position: 'fixed', top: ddPos.top, left: ddPos.left, zIndex: 9500, minWidth: 260,
    background: T.bgModal, border: `1px solid ${T.border}`, borderRadius: 8,
    boxShadow: T.name === 'abyssal' ? '0 24px 60px rgba(2,6,23,0.85)' : '0 16px 48px rgba(15,23,42,0.18)',
    backdropFilter: 'blur(20px)', padding: '4px 0',
    fontFamily: 'var(--font-jetbrains-mono, monospace)',
  };

  return (
    <>
      <button
        ref={btnRef} onClick={openMenu} disabled={disabled}
        title={disabled ? 'Load a genome first' : 'Surgical Suite'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 4,
          background: !disabled ? 'rgba(251,113,133,0.05)' : T.bgInput,
          border: !disabled ? '1px solid rgba(251,113,133,0.18)' : `1px solid ${T.borderSubtle}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: !disabled ? '#FB7185' : T.textGhost,
          fontSize: 12, fontFamily: 'var(--font-jetbrains-mono, monospace)',
          transition: 'all 150ms', opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = 'rgba(251,113,133,0.10)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(251,113,133,0.30)'; } }}
        onMouseLeave={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = 'rgba(251,113,133,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(251,113,133,0.18)'; } }}
      >
        <Scissors size={11} />
        Surgical Suite
        <ChevronDown size={9} style={{ opacity: 0.6, transition: 'transform 120ms', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.13 }}
            style={DDStyle}
          >
            <div style={{ padding: '6px 12px 6px', borderBottom: `1px solid ${T.borderSubtle}`, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: T.textGhost, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Surgical Suite</span>
            </div>
            {ITEMS.map(({ Icon, label, sublabel, color, action }) => (
              <button key={label} onClick={action}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '9px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 80ms', fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = T.bgHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, background: `${color}12`, border: `1px solid ${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={11} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: T.textPrimary, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 10, color: T.textDim, lineHeight: 1.4 }}>{sublabel}</div>
                </div>
                <ChevRight size={11} style={{ color: T.textGhost, marginLeft: 'auto', flexShrink: 0, marginTop: 6 }} />
              </button>
            ))}
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Security Shield Dropdown
// ─────────────────────────────────────────────────────────────────────────────

function SecurityDropdown({
  disabled, onHeatmap, onGenerateReport, onExportFHIR, onClinicalReport,
}: {
  disabled: boolean;
  onHeatmap: () => void;
  onGenerateReport: () => void;
  onExportFHIR: () => void;
  onClinicalReport: () => void;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ddPos, setDdPos] = useState({ top: 0, left: 0 });

  const openMenu = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDdPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, [open]);

  const ITEMS = [
    { Icon: Radar,        label: 'Off-Target Radar',              sublabel: 'CRISPR off-target heatmap analysis',      color: '#F43F5E', action: () => { setOpen(false); onHeatmap(); } },
    { Icon: FileCheck,    label: 'Generate Lab Certificate',      sublabel: 'Export signed audit report (PDF)',        color: '#10B981', action: () => { setOpen(false); setBusy(true); onGenerateReport(); setTimeout(() => setBusy(false), 3000); } },
    { Icon: Share2,       label: 'Export HL7 FHIR Record',        sublabel: 'Download MolecularSequence R4 JSON',      color: '#818CF8', action: () => { setOpen(false); onExportFHIR(); } },
    { Icon: Stethoscope,  label: 'Clinical Validation Report',    sublabel: 'Sovereign audit: MW, GOR IV, Sentinel',   color: '#06B6D4', action: () => { setOpen(false); onClinicalReport(); } },
  ];

  const DDStyle: React.CSSProperties = {
    position: 'fixed', top: ddPos.top, left: ddPos.left, zIndex: 9500, minWidth: 270,
    background: T.bgModal, border: `1px solid ${T.border}`, borderRadius: 8,
    boxShadow: T.name === 'abyssal' ? '0 24px 60px rgba(2,6,23,0.85)' : '0 16px 48px rgba(15,23,42,0.18)',
    backdropFilter: 'blur(20px)', padding: '4px 0',
    fontFamily: 'var(--font-jetbrains-mono, monospace)',
  };

  return (
    <>
      <button
        ref={btnRef} onClick={openMenu} disabled={disabled || busy}
        title={disabled ? 'Load a genome first' : 'Security & Audit'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 4,
          background: !disabled ? 'rgba(16,185,129,0.05)' : T.bgInput,
          border: !disabled ? '1px solid rgba(16,185,129,0.18)' : `1px solid ${T.borderSubtle}`,
          cursor: disabled || busy ? 'not-allowed' : 'pointer',
          color: !disabled ? '#10B981' : T.textGhost,
          fontSize: 12, fontFamily: 'var(--font-jetbrains-mono, monospace)',
          transition: 'all 150ms', opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!disabled && !busy) { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.10)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(16,185,129,0.30)'; } }}
        onMouseLeave={e => { if (!disabled && !busy) { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(16,185,129,0.18)'; } }}
      >
        {busy ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Shield size={11} />}
        Security
        <ChevronDown size={9} style={{ opacity: 0.6, transition: 'transform 120ms', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.13 }}
            style={DDStyle}
          >
            <div style={{ padding: '6px 12px 6px', borderBottom: `1px solid ${T.borderSubtle}`, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: T.textGhost, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Security &amp; Audit</span>
            </div>
            {ITEMS.map(({ Icon, label, sublabel, color, action }) => (
              <button key={label} onClick={action}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '9px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 80ms', fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = T.bgHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, background: `${color}12`, border: `1px solid ${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={11} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: T.textPrimary, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 10, color: T.textDim, lineHeight: 1.4 }}>{sublabel}</div>
                </div>
                <ChevRight size={11} style={{ color: T.textGhost, marginLeft: 'auto', flexShrink: 0, marginTop: 6 }} />
              </button>
            ))}
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § View tab bar
// ─────────────────────────────────────────────────────────────────────────────

function ViewTabBar({
  activeView, onSelect, onClose,
}: {
  activeView: ActiveView;
  onSelect: (v: ActiveView) => void;
  onClose: () => void;
}) {
  const T = useTheme();
  if (activeView === 'default') return null;

  const TABS: { id: ActiveView; label: string; Icon: React.ElementType; color: string }[] = [
    { id: 'diff',    label: 'Bio-Diff',     Icon: Diff,       color: '#FACC15' },
    { id: 'protein', label: 'Protein Fold', Icon: Microscope, color: '#A78BFA' },
    { id: 'heatmap', label: 'Heatmap',      Icon: Radar,      color: '#F43F5E' },
    { id: 'report',  label: 'Certificate',  Icon: FileCheck,  color: '#10B981' },
  ];

  return (
    <div style={{
      height: 32, minHeight: 32, flexShrink: 0,
      display: 'flex', alignItems: 'center', paddingLeft: 8, gap: 2,
      background: T.bgTabBar, borderBottom: `1px solid ${T.borderPanel}`, backdropFilter: 'blur(8px)',
    }}>
      {TABS.map(({ id, label, Icon, color }) => (
        <button key={id} onClick={() => onSelect(id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
            background: activeView === id ? `${color}12` : 'transparent',
            color: activeView === id ? color : T.textDim,
            borderBottom: activeView === id ? `2px solid ${color}` : '2px solid transparent',
            transition: 'all 100ms',
          }}
          onMouseEnter={e => { if (activeView !== id) (e.currentTarget as HTMLElement).style.color = T.textSecondary; }}
          onMouseLeave={e => { if (activeView !== id) (e.currentTarget as HTMLElement).style.color = T.textDim; }}
        >
          <Icon size={10} />{label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        onClick={onClose}
        title="Return to Sequence View"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', marginRight: 6, borderRadius: 4,
          border: `1px solid ${T.borderPanel}`, background: 'none', cursor: 'pointer', color: T.textDim,
          fontSize: 10, fontFamily: 'var(--font-jetbrains-mono, monospace)', transition: 'all 120ms',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.textSecondary; (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.textDim; (e.currentTarget as HTMLElement).style.borderColor = T.borderPanel; }}
      >
        <X size={9} />Sequence View
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Theme Toggle Button
// ─────────────────────────────────────────────────────────────────────────────

function ThemeToggleButton({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const T = useTheme();
  const isCleanroom = theme === 'cleanroom';

  return (
    <motion.button
      onClick={onToggle}
      title={isCleanroom ? 'Switch to Abyssal (Dark)' : 'Switch to Clean Room (Light)'}
      whileTap={{ scale: 0.92 }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 5,
        background: T.bgActive, border: `1px solid ${T.accentBorder}`,
        cursor: 'pointer', transition: 'all 200ms', flexShrink: 0, color: T.accentText,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isCleanroom ? 'rgba(14,165,233,0.15)' : 'rgba(56,189,248,0.15)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = T.bgActive; }}
    >
      <AnimatePresence mode="wait">
        {isCleanroom ? (
          <motion.span key="moon" initial={{ rotate: -30, opacity: 0, scale: 0.7 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 30, opacity: 0, scale: 0.7 }} transition={{ duration: 0.18 }} style={{ display: 'flex', alignItems: 'center' }}>
            <Moon size={14} />
          </motion.span>
        ) : (
          <motion.span key="sun" initial={{ rotate: 30, opacity: 0, scale: 0.7 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: -30, opacity: 0, scale: 0.7 }} transition={{ duration: 0.18 }} style={{ display: 'flex', alignItems: 'center' }}>
            <Sun size={14} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Main Workbench
// ─────────────────────────────────────────────────────────────────────────────

export default function Workbench() {
  // ── Theme ───────────────────────────────────────────────────────────────────
  const themeMode    = useArkheStore((s: ArkheState) => s.themeMode);
  const setThemeMode = useArkheStore((s: ArkheState) => s.setThemeMode);
  const onboardingActive = useArkheStore(s => s.onboardingActive);
  const T = THEMES[themeMode];
  const toggleTheme = useCallback(
    () => setThemeMode(themeMode === 'abyssal' ? 'cleanroom' : 'abyssal'),
    [themeMode, setThemeMode],
  );

  // ── Panel state ─────────────────────────────────────────────────────────────
  const [leftPanel,  setLeftPanel]  = useState<LeftPanel>('explorer');
  const [rightPanel, setRightPanel] = useState<RightPanel>('inspector');
  const [leftCollapsed,       setLeftCollapsed]       = useState(false);
  const [rightCollapsed,      setRightCollapsed]      = useState(false);
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('default');
  const [diffData,   setDiffData]   = useState<any>(null);
  const [auditReport, setAuditReport] = useState<any>(null);

  // ── Overlay flags ────────────────────────────────────────────────────────────
  const [cmdOpen,           setCmdOpen]           = useState(false);
  const [helpOpen,          setHelpOpen]          = useState(false);
  const [scissorOpen,       setScissorOpen]       = useState(false);
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [isExportingLocal,  setIsExportingLocal]  = useState(false);

  // ── SPRINT C: Clinical Mode ────────────────────────────────────────────────────
  const [clinicalMode, setClinicalMode] = useState(false);

  // ── SPRINT B: Source provenance for Trust Badge ──────────────────────────────
  const [sequenceSource, setSequenceSource] = useState<SequenceSource | null>(
    SourceTracker.get(),
  );
  useEffect(() => SourceTracker.subscribe(setSequenceSource), []);

  // ── Store selectors ──────────────────────────────────────────────────────────
  const genomeLength        = useArkheStore((s: ArkheState) => s.genomeLength);
  const workerConnected     = useArkheStore((s: ArkheState) => s.workerConnected);
  const activeGenomeId      = useArkheStore((s: ArkheState) => s.activeGenomeId);
  const isSyncing           = useArkheStore((s: ArkheState) => s.isSyncing);
  const isLocked            = useArkheStore((s: ArkheState) => s.isLocked);
  const chronosHead         = useArkheStore((s: ArkheState) => s.chronosHead);
  const loadFile            = useArkheStore((s: ArkheState) => s.loadFile);
  const initializeEngine    = useArkheStore((s: ArkheState) => s.initializeEngine);
  const setSyncing          = useArkheStore((s: ArkheState) => s.setSyncing);
  const performSurgicalEdit = useArkheStore((s: ArkheState) => s.performSurgicalEdit);
  const setShowCommitDialog = useArkheStore((s: ArkheState) => s.setShowCommitDialog);
  const exportMutantFasta   = useArkheStore((s: ArkheState) => s.exportMutantFasta);
  const getDiffForTx        = useArkheStore((s: ArkheState) => s.getDiffForTx);
  const addSystemLog        = useArkheStore((s: ArkheState) => s.addSystemLog);
  const openWiki            = useArkheStore((s: ArkheState) => s.openWiki);

  const { viewport, requestViewport, terminalLogs } = useArkheStore();
  const sentinelResults = (useArkheStore.getState() as any).sentinelScanResults || [];
  const proteinFold = useArkheStore((s: ArkheState) => s.proteinFold);

  useEffect(() => {
    if (proteinFold) setActiveView('protein');
  }, [proteinFold]);

  const hasGenome = genomeLength > 0;

  // ── File upload ──────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSyncing(true);
      await initializeEngine();
      await loadFile(file);
      // SPRINT B: Tag the sequence as a local, unvalidated file upload
      SourceTracker.set({
        type: 'file',
        id: file.name,
        label: 'UNVALIDATED DRAFT',
      });
    } catch (err) {
      console.error('[Workbench] ingestion error:', err);
    } finally {
      setSyncing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [initializeEngine, loadFile, setSyncing]);

  const triggerUpload = useCallback(() => fileInputRef.current?.click(), []);

  // ── Export FASTA ─────────────────────────────────────────────────────────────
  const handleExportFasta = useCallback(async (): Promise<void> => {
    if (!hasGenome || isExportingLocal || isLocked) return;
    setIsExportingLocal(true);
    try {
      const { filename, content } = await exportMutantFasta();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Workbench] export error:', err);
    } finally {
      setIsExportingLocal(false);
    }
  }, [hasGenome, isExportingLocal, isLocked, exportMutantFasta]);

  // ── Scissor handler ──────────────────────────────────────────────────────────
  // SPRINT B: Mark sequence as mutated after applying a point edit
  const handleMutationApply = useCallback((base: BaseCode4): void => {
    const pos = viewport.start ?? 0;
    performSurgicalEdit(Math.floor(pos / (1024 * 1024)), pos % (1024 * 1024), base);
    setShowCommitDialog(true);
    setScissorOpen(false);
    SourceTracker.markMutated();
  }, [viewport.start, performSurgicalEdit, setShowCommitDialog]);

  // ── Panel toggles ─────────────────────────────────────────────────────────────
  const toggleTerminal    = useCallback(() => setIsTerminalCollapsed(v => !v), []);
  const toggleLeftPanel   = useCallback(() => setLeftCollapsed(v => !v), []);
  const toggleRightPanel  = useCallback(() => setRightCollapsed(v => !v), []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setHelpOpen(false); setScissorOpen(false); setAssemblyModalOpen(false); setActiveView('default'); return; }
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key.toLowerCase()) {
        case 'k': e.preventDefault(); setCmdOpen(v => !v); break;
        case 'b': e.preventDefault(); toggleLeftPanel(); break;
        case 't': e.preventDefault(); toggleTerminal(); break;
        case 'g': e.preventDefault(); setRightPanel(p => p === 'chronos' ? 'inspector' : 'chronos'); setRightCollapsed(false); break;
        case 'f': e.preventDefault(); setLeftPanel('search'); setLeftCollapsed(false); break;
        case 'e': e.preventDefault(); void handleExportFasta(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleTerminal, handleExportFasta]);

  // ── Nav definitions ───────────────────────────────────────────────────────────
  type LNItem = { id: LeftPanel;  Icon: React.ElementType; label: string; shortcut: string };
  type RNItem = { id: RightPanel; Icon: React.ElementType; label: string };

  const LN: LNItem[] = [
    { id: 'explorer', Icon: FolderOpen, label: 'Explorer', shortcut: '⌘B' },
    { id: 'search',   Icon: Search,     label: 'Search',   shortcut: '⌘F' },
    { id: 'database', Icon: Database,   label: 'DB',       shortcut: '⌘D' },
    { id: 'sentinel', Icon: Shield,     label: 'Sentinel', shortcut: '⌘S' },
  ];
  const RN: RNItem[] = [
    { id: 'inspector', Icon: Activity,  label: 'Inspector' },
    { id: 'chronos',   Icon: GitBranch, label: 'Chronos'   },
  ];

  const iconBtnStyle = useCallback((active = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 5, border: 'none', cursor: 'pointer',
    background: active ? T.accentBg : 'transparent',
    color: active ? T.accentText : T.iconDefault,
    transition: 'all 120ms', flexShrink: 0,
  }), [T]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <ThemeContext.Provider value={T}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        width: '100vw', height: '100vh',
        background: T.bg, overflow: 'hidden',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
        ['--dna-font-size' as any]: '14px',
        ['--theme-bg' as any]: T.bg,
        ['--theme-panel' as any]: T.bgPanel,
        ['--theme-text' as any]: T.textPrimary,
        ['--theme-border' as any]: T.border,
        ['--theme-accent' as any]: T.accent,
        transition: 'background 250ms ease, color 250ms ease',
      }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".fasta,.fa,.fna,.fastq,.gb,.gbk,.vcf,.dna"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* ── Overlays ───────────────────────────────────────────────────── */}
        <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
        <SurgicalCommitDialog />

        <AnimatePresence>
          {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
          {scissorOpen && (
            <ScissorModal
              position={viewport.start ?? 0}
              onClose={() => setScissorOpen(false)}
              onApply={handleMutationApply}
            />
          )}
          {assemblyModalOpen && (
            <AssemblyJunctionModal onClose={() => setAssemblyModalOpen(false)} />
          )}
        </AnimatePresence>

        {/* ══════════════════════════════════════════════════════════════════
            TOPBAR
            ══════════════════════════════════════════════════════════════════ */}
        <header style={{
          height: 42, minHeight: 42,
          display: 'flex', alignItems: 'center',
          padding: '0 12px', gap: 8,
          background: T.bgHeader,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0, userSelect: 'none', zIndex: 100,
          boxShadow: T.name === 'cleanroom' ? '0 1px 4px rgba(15,23,42,0.08)' : '0 1px 0 rgba(255,255,255,0.04)',
          transition: 'background 250ms ease, border-color 250ms ease, box-shadow 250ms ease',
        }}>

          {/* ── Branding ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 14, marginRight: 4, borderRight: `1px solid ${T.border}`, flexShrink: 0 }}>
            <ArkheLogo size={20} variant="icon" glow className="text-white" />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, letterSpacing: '-0.03em' }}>
                Arkhé<span style={{ color: T.accentText }}>Genesis</span>
              </span>
              <span style={{ fontSize: 9, color: T.textGhost, letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 1 }}>
                Genomic IDE · v1.0
              </span>
            </div>
          </div>

          {/* ── Active genome pill ────────────────────────────────────────── */}
          {hasGenome && (
            <motion.div
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 5, background: T.accentBg, border: `1px solid ${T.accentBorder}`, flexShrink: 0 }}
            >
              <Dna size={10} color={T.accentText} />
              <span style={{ fontSize: 11, color: T.textSecondary }}>{activeGenomeId}</span>
              <span style={{ color: T.textGhost, fontSize: 11 }}>·</span>
              <span style={{ fontSize: 11, color: T.accentText, fontWeight: 700 }}>
                {genomeLength.toLocaleString()} bp
              </span>
            </motion.div>
          )}

          {/* ── SPRINT B: Trust Badge ──────────────────────────────────────
              Visible whenever a genome is loaded.
              Communicates sequence provenance to the scientist.
              Position: immediately right of the genome pill.
          ─────────────────────────────────────────────────────────────── */}
          {hasGenome && (
            <AnimatePresence mode="wait">
              <SourceBadge key={sequenceSource?.label ?? 'draft'} source={sequenceSource} />
            </AnimatePresence>
          )}

          <div style={{ flex: 1 }} />

          {/* ── Action strip ──────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>

            {/* INGEST */}
            <button
              onClick={triggerUpload}
              disabled={isSyncing}
              data-tour="file-upload"
              title="Ingest genome file (.fasta / .gb / .vcf)"
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 5,
                background: T.bgInput, border: `1px solid ${T.border}`,
                cursor: isSyncing ? 'wait' : 'pointer',
                color: isSyncing ? T.accentText : T.textSecondary,
                fontSize: 12, fontFamily: 'inherit', transition: 'all 150ms',
              }}
              onMouseEnter={e => { if (!isSyncing) { (e.currentTarget as HTMLElement).style.color = T.textPrimary; (e.currentTarget as HTMLElement).style.borderColor = T.accentBorder; } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isSyncing ? T.accentText : T.textSecondary; (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
            >
              <Upload size={11} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
              {isSyncing ? 'Loading…' : 'Ingest'}
            </button>

            {/* EXPORT FASTA */}
            <button
              onClick={() => void handleExportFasta()}
              disabled={!hasGenome || isExportingLocal || isLocked}
              title={!hasGenome ? 'Load a genome first' : isLocked ? 'Engine busy' : 'Export mutant genome as FASTA (⌘E)'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 5,
                background: hasGenome && !isExportingLocal && !isLocked ? T.accentBg : T.bgInput,
                border: hasGenome && !isExportingLocal && !isLocked ? `1px solid ${T.accentBorder}` : `1px solid ${T.borderSubtle}`,
                cursor: !hasGenome || isExportingLocal || isLocked ? 'not-allowed' : 'pointer',
                color: hasGenome && !isExportingLocal && !isLocked ? T.accentText : T.textGhost,
                fontSize: 12, fontFamily: 'inherit', transition: 'all 150ms', opacity: !hasGenome ? 0.45 : 1,
              }}
              onMouseEnter={e => { if (hasGenome && !isExportingLocal && !isLocked) (e.currentTarget as HTMLElement).style.background = T.name === 'abyssal' ? 'rgba(56,189,248,0.14)' : 'rgba(14,165,233,0.14)'; }}
              onMouseLeave={e => { if (hasGenome && !isExportingLocal && !isLocked) (e.currentTarget as HTMLElement).style.background = T.accentBg; }}
            >
              {isExportingLocal ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.85, ease: 'linear' }}
                  style={{ width: 11, height: 11, borderRadius: '50%', border: `1.5px solid ${T.accentText}`, borderTopColor: 'transparent', flexShrink: 0 }}
                />
              ) : <Download size={11} />}
              {isExportingLocal ? 'Exporting…' : 'Export'}
            </button>

            {/* Surgical Suite */}
            <SurgicalDropdown
              disabled={!hasGenome || isLocked}
              onManualMutation={() => setScissorOpen(true)}
              onAssemblyPredictor={() => setAssemblyModalOpen(true)}
              chronosHead={chronosHead}
              getDiffForTx={getDiffForTx}
              addLog={addSystemLog}
              onDiffReady={(data: any) => { setDiffData(data); setActiveView('diff'); }}
            />

            {/* Security */}
            <SecurityDropdown
              disabled={!hasGenome || isLocked}
              onHeatmap={() => setActiveView('heatmap')}
              onGenerateReport={() => {
                generateAuditReport().then(report => {
                  setAuditReport(report);
                  setActiveView('report');
                }).catch(err => console.error('[Workbench] audit report error:', err));
              }}
              onExportFHIR={() => {
                try {
                  downloadFHIR();
                  addSystemLog({ level: 'success', category: 'CLINICAL' as any, message: 'HL7 FHIR MolecularSequence resource exported.', timestamp: Date.now() });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  addSystemLog({ level: 'error', category: 'CLINICAL' as any, message: `FHIR export failed: ${msg}`, timestamp: Date.now() });
                }
              }}
              onClinicalReport={() => {
                try {
                  const source = SourceTracker.get();
                  generateClinicalReport({
                    labName: 'Arkhé Genesis Laboratory',
                    analystName: 'Arkhé Operator',
                  });
                  addSystemLog({ level: 'success', category: 'CLINICAL' as any, message: 'Clinical Validation Report generated.', timestamp: Date.now() });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  addSystemLog({ level: 'error', category: 'CLINICAL' as any, message: `Clinical report error: ${msg}`, timestamp: Date.now() });
                }
              }}
            />

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: T.border, margin: '0 4px' }} />

            {/* SEARCH */}
            <button onClick={() => { setLeftPanel('search'); setLeftCollapsed(false); }} title="Search (⌘F)" style={iconBtnStyle()}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; }}>
              <Search size={14} />
            </button>

            {/* HELP */}
            <button onClick={() => setHelpOpen(true)} title="Keyboard Shortcuts (?)" style={iconBtnStyle(helpOpen)}
              onMouseEnter={e => { if (!helpOpen) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
              onMouseLeave={e => { if (!helpOpen) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; } }}>
              <HelpCircle size={14} />
            </button>

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: T.border, margin: '0 4px' }} />

            {/* SIDEBAR TOGGLE */}
            <button onClick={toggleLeftPanel} title={`${leftCollapsed ? 'Show' : 'Hide'} Explorer (⌘B)`} style={iconBtnStyle(!leftCollapsed)}
              onMouseEnter={e => { if (leftCollapsed) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
              onMouseLeave={e => { if (leftCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; } }}>
              {leftCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            {/* TERMINAL TOGGLE */}
            <button onClick={toggleTerminal} title="Toggle Terminal (⌘T)" style={iconBtnStyle(!isTerminalCollapsed)}
              onMouseEnter={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
              onMouseLeave={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; } }}>
              <Terminal size={14} />
            </button>

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: T.border, margin: '0 4px' }} />

            <ThemeToggleButton theme={themeMode} onToggle={toggleTheme} />

            {/* SPRINT C — Clinical Mode Toggle */}
            <motion.button
              onClick={() => setClinicalMode(v => !v)}
              title={clinicalMode ? 'Disable Clinical Mode' : 'Enable Clinical Mode — adds compliance watermark'}
              whileTap={{ scale: 0.92 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
                fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.04em',
                background: clinicalMode ? 'rgba(6,182,212,0.12)' : T.bgInput,
                color:      clinicalMode ? '#06B6D4'              : T.textGhost,
                border: `1px solid ${clinicalMode ? 'rgba(6,182,212,0.35)' : T.borderPanel}`,
                transition: 'all 200ms', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!clinicalMode) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
              onMouseLeave={e => { if (!clinicalMode) { (e.currentTarget as HTMLElement).style.background = T.bgInput;  (e.currentTarget as HTMLElement).style.color = T.textGhost; } }}
            >
              <Stethoscope size={11} />
              {clinicalMode ? 'CLIN' : 'RES'}
            </motion.button>

            {/* Worker Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 5, border: `1px solid ${T.borderPanel}`, background: T.bgInput, flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: workerConnected ? '#10B981' : T.textGhost, boxShadow: workerConnected ? '0 0 6px rgba(16,185,129,0.55)' : 'none' }} />
              <span style={{ fontSize: 11, color: workerConnected ? T.textSecondary : T.textGhost, letterSpacing: '0.04em' }}>
                {workerConnected ? 'Ready' : 'Init'}
              </span>
            </div>

            {/* COMMAND PALETTE */}
            <button onClick={() => setCmdOpen(true)} title="Command Palette (⌘K)"
              style={{ padding: 6, borderRadius: 5, background: 'none', border: 'none', cursor: 'pointer', color: T.iconDefault, transition: 'all 120ms' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; }}>
              <Settings size={15} />
            </button>
          </div>
        </header>

        {/* ════════════════════════════════════════════════════════════════════
            BODY — Icon Rail + Resizable Panels
            ════════════════════════════════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Icon Rail */}
          <aside style={{
            width: 40, minWidth: 40, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            background: T.bgPanel, borderRight: `1px solid ${T.borderPanel}`,
            paddingTop: 8, paddingBottom: 8, gap: 2, zIndex: 10,
            transition: 'background 250ms ease',
          }}>
            {LN.map(({ id, Icon, label, shortcut }) => {
              const active = leftPanel === id && !leftCollapsed;
              return (
                <button key={id}
                  onClick={() => { if (active) toggleLeftPanel(); else { setLeftPanel(id); setLeftCollapsed(false); } }}
                  title={`${label} (${shortcut})`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, margin: '0 auto', borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: active ? T.accentBg : 'transparent',
                    color: active ? T.accentText : T.iconDefault,
                    borderLeft: active ? `2px solid ${T.accentText}` : '2px solid transparent',
                    transition: 'all 120ms',
                  }}
                  onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
                  onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.iconDefault; } }}
                >
                  <Icon size={15} style={{ opacity: active ? 1 : 0.75 }} />
                </button>
              );
            })}

            <div style={{ flex: 1 }} />

            {/* WIKI / CODEX */}
            <button onClick={openWiki} title="Command Codex (Help)"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, margin: '0 auto', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: T.textGhost, transition: 'all 120ms' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textGhost; }}
            >
              <BookOpen size={14} />
            </button>

            <button onClick={toggleTerminal} title="Toggle Terminal (⌘T)"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, margin: '0 auto', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: !isTerminalCollapsed ? T.accentBg : 'transparent',
                color: !isTerminalCollapsed ? T.accentText : T.textGhost,
                borderLeft: !isTerminalCollapsed ? `2px solid ${T.accentText}80` : '2px solid transparent',
                transition: 'all 120ms',
              }}
              onMouseEnter={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; } }}
              onMouseLeave={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textGhost; } }}
            >
              <Terminal size={14} />
            </button>

            <button onClick={() => setCmdOpen(true)} title="Settings (⌘K)"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, margin: '0 auto', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: T.textGhost, transition: 'all 120ms' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.iconHover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textGhost; }}
            >
              <Settings size={14} />
            </button>
          </aside>

          {/* Resizable area */}
          <Group orientation="vertical" style={{ flex: 1, overflow: 'hidden' }}>

            {/* Top row */}
            <Panel defaultSize={75} minSize={40}>
              <Group orientation="horizontal" style={{ height: '100%' }}>

                {/* LEFT SIDEBAR */}
                <Panel defaultSize={18} minSize={10} maxSize={35} collapsible collapsedSize={0}
                  style={{ background: T.bgPanel, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: leftCollapsed ? 'none' : `1px solid ${T.borderPanel}`, transition: 'background 250ms ease' }}>
                  {!leftCollapsed && (
                    <>
                      <div style={{ height: 34, minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 2, borderBottom: `1px solid ${T.borderPanel}`, background: T.bgSurface, flexShrink: 0 }}>
                        {LN.map(({ id, Icon, label }) => (
                          <button key={id} onClick={() => setLeftPanel(id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: leftPanel === id ? T.accentBg : 'transparent', color: leftPanel === id ? T.accentText : T.textGhost, transition: 'all 120ms' }}
                            onMouseEnter={e => { if (leftPanel !== id) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.textDim; } }}
                            onMouseLeave={e => { if (leftPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textGhost; } }}
                          >
                            <Icon size={9} />{label}
                          </button>
                        ))}
                        <div style={{ flex: 1 }} />
                        <button onClick={toggleLeftPanel}
                          style={{ padding: 2, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: T.textGhost, transition: 'color 120ms' }}
                          onMouseEnter={e => (e.currentTarget.style.color = T.iconHover)}
                          onMouseLeave={e => (e.currentTarget.style.color = T.textGhost)}>
                          <ChevronLeft size={11} />
                        </button>
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                        <AnimatePresence mode="wait">
                          <motion.div key={leftPanel} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -5 }} transition={{ duration: 0.12 }} style={{ height: '100%' }}>
                            {leftPanel === 'explorer' && <Explorer />}
                            {leftPanel === 'search'   && <SearchPanel />}
                            {leftPanel === 'database' && <DatabasePanel />}
                            {leftPanel === 'sentinel' && <Sentinel />}
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </Panel>

                {!leftCollapsed && <ColHandle />}

                {/* CENTER PANEL */}
                <Panel minSize={30} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                  <ViewTabBar activeView={activeView} onSelect={setActiveView} onClose={() => setActiveView('default')} />
                  {hasGenome && activeView === 'default' && <SurgicalToolbar />}
                  <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
                    {/* SPRINT C — Clinical Mode watermark */}
                    <AnimatePresence>
                      {clinicalMode && hasGenome && (() => {
                        const source = SourceTracker.get();
                        const isClinicalReady = source?.type === 'ncbi' || source?.type === 'uniprot';
                        const wLabel = isClinicalReady ? 'CLINICAL READY' : 'FOR RESEARCH USE ONLY';
                        const wColor = isClinicalReady ? 'rgba(16,185,129,0.13)' : 'rgba(234,179,8,0.13)';
                        const wBorder = isClinicalReady ? 'rgba(16,185,129,0.35)' : 'rgba(234,179,8,0.35)';
                        const wText  = isClinicalReady ? '#10B981' : '#EAB308';
                        return (
                          <motion.div
                            key="clinical-watermark"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            style={{
                              position: 'absolute', inset: 0, zIndex: 50,
                              pointerEvents: 'none', overflow: 'hidden',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {/* Diagonal tiled watermark text */}
                            <div style={{
                              position: 'absolute', inset: -200,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transform: 'rotate(-35deg)',
                              fontSize: 52, fontWeight: 900,
                              letterSpacing: '-0.02em',
                              color: wColor,
                              whiteSpace: 'nowrap',
                              userSelect: 'none',
                              fontFamily: 'var(--font-jetbrains-mono, monospace)',
                              textShadow: 'none',
                            }}>
                              {wLabel}
                            </div>
                            {/* Status pill in corner */}
                            <div style={{
                              position: 'absolute', bottom: 12, right: 14,
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 4,
                              background: wColor,
                              border: `1px solid ${wBorder}`,
                            }}>
                              <Stethoscope size={10} style={{ color: wText }} />
                              <span style={{
                                fontSize: 10, fontWeight: 800, color: wText,
                                letterSpacing: '0.08em',
                                fontFamily: 'var(--font-jetbrains-mono, monospace)',
                              }}>
                                {wLabel}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })()}
                    </AnimatePresence>
                    <AnimatePresence mode="wait">
                      {activeView === 'default' && (
                        <motion.div key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} style={{ height: '100%' }}>
                          <SequenceView onRequestUpload={triggerUpload} />
                        </motion.div>
                      )}
                      {activeView === 'diff' && diffData && (
                        <motion.div key="diff" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }} style={{ height: '100%' }}>
                          <BioDiffMode oldSequence={diffData.oldSeq} newSequence={diffData.newSeq} mutations={diffData.changes} />
                        </motion.div>
                      )}
                      {activeView === 'protein' && (
                        <motion.div key="protein" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }} style={{ height: '100%' }}>
                          <ProteinViewport />
                        </motion.div>
                      )}
                      {activeView === 'heatmap' && (
                        <motion.div key="heatmap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }} style={{ height: '100%' }}>
                          <OffTargetHeatmap
                            sequence={viewport.sequence || ''}
                            viewport={viewport}
                            offTargetSites={sentinelResults?.flatMap((r: any) => r.hits || []) || []}
                            onNavigate={async (pos) => {
                              await requestViewport(pos, pos + 100);
                              return { success: true, data: null } as any;
                            }}
                          />
                        </motion.div>
                      )}
                      {activeView === 'report' && (
                        <motion.div key="report" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }} style={{ height: '100%' }}>
                          <GenesisAuditReport report={auditReport} onClose={() => setActiveView('default')} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Panel>

                {!rightCollapsed && <ColHandle />}

                {/* RIGHT SIDEBAR */}
                <Panel defaultSize={22} minSize={12} maxSize={40} collapsible collapsedSize={0}
                  style={{ background: T.bgPanel, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderLeft: rightCollapsed ? 'none' : `1px solid ${T.borderPanel}`, transition: 'background 250ms ease' }}>
                  {!rightCollapsed && (
                    <>
                      <div style={{ height: 34, minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 3, borderBottom: `1px solid ${T.borderPanel}`, background: T.bgSurface, flexShrink: 0 }}>
                        <button onClick={toggleRightPanel}
                          style={{ padding: 2, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: T.textGhost, marginRight: 2, transition: 'color 120ms' }}
                          onMouseEnter={e => (e.currentTarget.style.color = T.iconHover)}
                          onMouseLeave={e => (e.currentTarget.style.color = T.textGhost)}>
                          <ChevronRight size={11} />
                        </button>
                        {RN.map(({ id, Icon, label }) => (
                          <button key={id} onClick={() => setRightPanel(id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: rightPanel === id ? T.accentBg : 'transparent', color: rightPanel === id ? T.accentText : T.textGhost, transition: 'all 120ms' }}
                            onMouseEnter={e => { if (rightPanel !== id) { (e.currentTarget as HTMLElement).style.background = T.bgHover; (e.currentTarget as HTMLElement).style.color = T.textDim; } }}
                            onMouseLeave={e => { if (rightPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.textGhost; } }}>
                            <Icon size={9} />{label}
                          </button>
                        ))}
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                        <AnimatePresence mode="wait">
                          <motion.div key={rightPanel} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.12 }} style={{ height: '100%' }}>
                            {rightPanel === 'inspector' && <InspectorPanel />}
                            {rightPanel === 'chronos'   && <ChronosSidebar isCollapsed={false} onToggle={toggleRightPanel} />}
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </Panel>
              </Group>
            </Panel>

            {!isTerminalCollapsed && <RowHandle />}

            {/* BOTTOM TERMINAL */}
            <Panel defaultSize={25} minSize={8} maxSize={60} collapsible collapsedSize={0}
              style={{ background: T.name === 'abyssal' ? 'rgba(2,6,23,0.98)' : T.bgPanel, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: `1px solid ${T.border}`, transition: 'background 250ms ease' }}>
              <div style={{ height: 32, minHeight: 32, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, borderBottom: isTerminalCollapsed ? 'none' : `1px solid ${T.borderPanel}`, background: T.bgSurface, flexShrink: 0 }}>
                <Terminal size={11} color={T.accentText} style={{ opacity: 0.85, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textDim }}>System Log</span>
                {(terminalLogs?.length ?? 0) > 0 && (
                  <span style={{ padding: '1px 6px', borderRadius: 3, background: T.accentBg, fontSize: 10, color: T.accentText, flexShrink: 0 }}>
                    {terminalLogs.length}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <button onClick={toggleTerminal} title="Toggle Terminal (⌘T)"
                  style={{ padding: 3, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: T.textDim, display: 'flex', alignItems: 'center', transition: 'color 120ms' }}
                  onMouseEnter={e => (e.currentTarget.style.color = T.textSecondary)}
                  onMouseLeave={e => (e.currentTarget.style.color = T.textDim)}>
                  {isTerminalCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>
              {!isTerminalCollapsed && (
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                  <BioTerminal />
                </div>
              )}
            </Panel>

          </Group>
        </div>
      </div>
      <AnimatePresence>
        {onboardingActive && <GenesisTour />}
      </AnimatePresence>
    </ThemeContext.Provider>
  );
}