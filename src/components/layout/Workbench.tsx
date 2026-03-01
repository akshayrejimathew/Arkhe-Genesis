'use client';

/**
 * src/components/layout/Workbench.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * GENESIS ENGINE PHASE 6 — FINAL DOORS
 *
 * ── PHASE 5 FIX SUMMARY (retained) ──────────────────────────────────────────
 *   TASK 1: Added `const [diffData, setDiffData] = useState<any>(null)` to
 *           Workbench component. Removed the out-of-scope `setDiffResults` call
 *           from SurgicalDropdown — diff data is now forwarded via onDiffReady.
 *
 *   TASK 2: Removed `onCollapse` and `onExpand` from all <Panel /> components.
 *           Collapse state is driven purely by the leftCollapsed / rightCollapsed
 *           / isTerminalCollapsed boolean states, toggled by the existing buttons.
 *
 *   TASK 3: BioDiffMode render block uses the exact required shape:
 *           {activeView === 'diff' && diffData &&
 *             <BioDiffMode oldSequence={diffData.oldSeq}
 *                          newSequence={diffData.newSeq}
 *                          mutations={diffData.changes} />}
 *
 *   TASK 4: All addLog category values cast with `as any` to satisfy the
 *           strict union type in SystemLog.
 *
 * ── PHASE 6 ADDITIONS ────────────────────────────────────────────────────────
 *   TASK 1: Imported OffTargetHeatmap, GenesisAuditReport, generateAuditReport.
 *           Expanded ActiveView type with 'heatmap' | 'report'.
 *           Added auditReport state.
 *
 *   TASK 2: SecurityDropdown component (Shield icon) with two items:
 *           "Off-Target Radar" → setActiveView('heatmap')
 *           "Generate Lab Certificate" → generateAuditReport().then(…)
 *
 *   TASK 3: Center Panel AnimatePresence now renders heatmap + report views.
 *           ViewTabBar updated with Heatmap (#F43F5E) and Certificate (#10B981) tabs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useState, useEffect, useRef, useCallback,
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
  Radar, FileCheck,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// § Store + types
// ─────────────────────────────────────────────────────────────────────────────
import { useArkheStore, type ArkheState } from '@/store';
import type { AssemblyPrediction } from '@/types/arkhe';

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
// § Visualization door imports (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────
import BioDiffMode from '@/components/visualization/BioDiffMode';
import ProteinViewport from '@/components/visuals/ProteinViewport';

// ─────────────────────────────────────────────────────────────────────────────
// § PHASE 6 — Final Door imports
// ─────────────────────────────────────────────────────────────────────────────
import OffTargetHeatmap from '@/components/visualization/OffTargetHeatmap';
import GenesisAuditReport from '@/components/reports/GenesisAuditReport';
import { generateAuditReport } from '@/lib/reportGenerator';

// ─────────────────────────────────────────────────────────────────────────────
// § Panel type aliases
// ─────────────────────────────────────────────────────────────────────────────
type LeftPanel   = 'explorer' | 'search' | 'database' | 'sentinel';
type RightPanel  = 'inspector' | 'chronos';

/**
 * Active visualization in the center area.
 *   'default'  → SequenceView (standard genomic editor)
 *   'diff'     → BioDiffMode  (Myers diff result visualization)
 *   'protein'  → ProteinViewport (3D protein fold)
 *   'heatmap'  → OffTargetHeatmap (CRISPR off-target radar)
 *   'report'   → GenesisAuditReport (lab certificate)
 */
type ActiveView = 'default' | 'diff' | 'protein' | 'heatmap' | 'report';

// ─────────────────────────────────────────────────────────────────────────────
// § Abyssal resize handles (Arkhé teal glow)
// ─────────────────────────────────────────────────────────────────────────────

function ColHandle() {
  const [hover, setHover] = useState(false);
  return (
    <Separator
      style={{ width: 4, flexShrink: 0, position: 'relative', zIndex: 5 }}
      aria-label="Resize panel"
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute', inset: 0,
          background: hover ? 'rgba(56,189,248,0.07)' : 'transparent',
          cursor: 'col-resize', transition: 'background 100ms',
        }}
      >
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: '50%',
          transform: 'translateX(-50%)', width: 2,
          background: hover ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.04)',
          boxShadow: hover ? '0 0 8px rgba(56,189,248,0.35)' : 'none',
          transition: 'all 120ms',
        }} />
      </div>
    </Separator>
  );
}

function RowHandle() {
  const [hover, setHover] = useState(false);
  return (
    <Separator
      style={{ height: 4, flexShrink: 0, position: 'relative', zIndex: 5 }}
      aria-label="Resize terminal"
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute', inset: 0,
          background: hover ? 'rgba(56,189,248,0.07)' : 'transparent',
          cursor: 'row-resize', transition: 'background 100ms',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          transform: 'translateY(-50%)', height: 2,
          background: hover ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.04)',
          boxShadow: hover ? '0 0 8px rgba(56,189,248,0.35)' : 'none',
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
        background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(10px)',
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
          background: 'rgba(9,15,28,0.97)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10, padding: '28px 32px', minWidth: 340,
          boxShadow: '0 32px 64px rgba(2,6,23,0.80)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Scissors size={13} style={{ color: '#FB7185' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Point Mutation
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#334155' }}>
              Position: <span style={{ color: '#38BDF8', fontWeight: 600 }}>{position.toLocaleString()}</span> bp
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 4, transition: 'color 120ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: '#1E293B', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12 }}>
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
                <span style={{ fontSize: 8, opacity: 0.6, letterSpacing: '0.05em' }}>{b.name}</span>
              </button>
            ))}
          </div>
        </div>

        <p style={{ fontSize: 9.5, color: '#1E293B', textAlign: 'center', lineHeight: 1.7 }}>
          Mutation staged in Chronos. Use Surgical Commit to persist.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § AssemblyJunctionModal — in-line predictor
// ─────────────────────────────────────────────────────────────────────────────

interface HairpinPreviewResult {
  valid: boolean;
  message: string;
  overlapLength?: number;
  scarLength?: number;
  frameshift?: boolean;
}

function AssemblyJunctionModal({ onClose }: { onClose: () => void }) {
  const [upstream,   setUpstream]   = useState('');
  const [downstream, setDownstream] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<HairpinPreviewResult | null>(null);

  const worker  = useArkheStore((s: ArkheState) => s.worker);
  const addLog  = useArkheStore((s: ArkheState) => s.addSystemLog);

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
    width: '100%', background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5,
    padding: '8px 10px', color: '#94A3B8', fontSize: 11,
    fontFamily: 'var(--font-jetbrains-mono, monospace)',
    outline: 'none', boxSizing: 'border-box', letterSpacing: '0.04em',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(2,6,23,0.80)', backdropFilter: 'blur(12px)',
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
          background: 'rgba(9,15,28,0.98)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10, padding: '24px 28px', minWidth: 380, maxWidth: 440,
          boxShadow: '0 32px 64px rgba(2,6,23,0.80)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <GitMerge size={13} style={{ color: '#38BDF8' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Assembly Junction Predictor
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#334155' }}>GG / Gibson overlap analysis</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 4, transition: 'color 120ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Upstream fragment (5′)</div>
            <textarea
              value={upstream}
              onChange={e => setUpstream(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))}
              placeholder="ATCGATCG…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Downstream fragment (3′)</div>
            <textarea
              value={downstream}
              onChange={e => setDownstream(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))}
              placeholder="GCTAGCTA…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        </div>

        <button
          onClick={() => void handlePredict()}
          disabled={loading || !upstream.trim() || !downstream.trim() || !worker}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 5,
            background: loading ? 'rgba(56,189,248,0.06)' : 'rgba(56,189,248,0.10)',
            border: '1px solid rgba(56,189,248,0.25)',
            color: '#38BDF8', fontSize: 11, fontWeight: 600,
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: result.valid ? '#10B981' : '#FB7185', marginBottom: 4 }}>
                    {result.valid ? 'Valid Junction' : 'Junction Issue'}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B', lineHeight: 1.6 }}>{result.message}</div>
                  {result.overlapLength !== undefined && (
                    <div style={{ fontSize: 9.5, color: '#475569', marginTop: 4 }}>
                      Overlap: <span style={{ color: '#38BDF8' }}>{result.overlapLength} bp</span>
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
// § SearchPanel — motif search with IUPAC validation
// ─────────────────────────────────────────────────────────────────────────────

const IUPAC_RE = /^[ACGTURYSWKMBDHVNacgturyswkmbdhvn]+$/;

function SearchPanel() {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<number[]>([]);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const worker      = useArkheStore((s: ArkheState) => s.worker);
  const hasGenome   = useArkheStore((s: ArkheState) => s.genomeLength > 0);

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
          <Search size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#334155', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={handleChange}
            placeholder="IUPAC motif (e.g. ATCG)"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${error ? 'rgba(251,113,133,0.40)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 4, padding: '7px 10px 7px 28px',
              color: '#94A3B8', fontSize: 11, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
            }}
          />
        </div>
        {error && <div style={{ fontSize: 9.5, color: '#FB7185', marginTop: 5 }}>{error}</div>}
      </div>

      <div style={{ fontSize: 9, color: '#1E293B', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
        {loading ? 'Searching…' : results.length > 0 ? `${results.length} hit${results.length !== 1 ? 's' : ''}` : query.trim() ? 'No results' : 'Enter motif'}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {results.map((pos, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 6px', borderRadius: 3, marginBottom: 2, cursor: 'pointer',
            transition: 'background 80ms',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(56,189,248,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#38BDF8', flexShrink: 0, opacity: 0.7 }} />
            <span style={{ fontSize: 10, color: '#38BDF8', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
              {pos.toLocaleString()}
            </span>
            <span style={{ fontSize: 9, color: '#334155' }}>bp</span>
          </div>
        ))}
        {query.trim() && !loading && results.length === 0 && !error && (
          <div style={{ textAlign: 'center', paddingTop: 24, fontSize: 10, color: '#1E293B', lineHeight: 1.8 }}>
            No matches for<br /><span style={{ color: '#38BDF8', fontWeight: 600 }}>&quot;{query.trim()}&quot;</span>
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
  disabled,
  onManualMutation,
  onAssemblyPredictor,
  chronosHead,
  getDiffForTx,
  addLog,
  onDiffReady,
}: {
  disabled: boolean;
  onManualMutation: () => void;
  onAssemblyPredictor: () => void;
  chronosHead: string | null;
  getDiffForTx: (txId: string) => Promise<unknown>;
  addLog: (log: SystemLog) => void;
  onDiffReady: (data: any) => void;
}) {
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
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const handleMyersDiff = useCallback(async () => {
    setOpen(false);
    if (!chronosHead) {
      addLog({
        level: 'warning',
        category: 'CHRONOS' as any,
        message: 'No commit HEAD — stage a mutation first.',
        timestamp: Date.now(),
      });
      return;
    }
    addLog({
      level: 'info',
      category: 'CHRONOS' as any,
      message: `Extracting Myers diff for tx ${chronosHead.slice(0, 8)}…`,
      timestamp: Date.now(),
    });
    try {
      const diff = await getDiffForTx(chronosHead);

      const processedDiff: { oldSeq: string; newSeq: string; changes: any[] } = {
        oldSeq: '',
        newSeq: '',
        changes: [],
      };

      if (diff && typeof diff === 'object') {
        const diffObj = diff as any;
        processedDiff.oldSeq   = diffObj.oldSequence || diffObj.oldSeq   || '';
        processedDiff.newSeq   = diffObj.newSequence || diffObj.newSeq   || '';
        processedDiff.changes  = diffObj.mutations   || diffObj.changes  || [];
      }

      const entries = Array.isArray(diff)
        ? diff.length
        : typeof diff === 'object' && diff !== null
          ? Object.keys(diff).length
          : 1;

      addLog({
        level: 'success',
        category: 'CHRONOS' as any,
        message: `Myers diff: ${entries} edit operation${entries !== 1 ? 's' : ''} extracted from ${chronosHead.slice(0, 8)}.`,
        timestamp: Date.now(),
      });

      onDiffReady(processedDiff);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({
        level: 'error',
        category: 'CHRONOS' as any,
        message: `Diff extraction failed: ${msg}`,
        timestamp: Date.now(),
      });
    }
  }, [chronosHead, getDiffForTx, addLog, onDiffReady]);

  const ITEMS = [
    {
      Icon: Scissors, label: 'Manual Mutation', sublabel: 'Point edit at cursor position',
      color: '#FB7185',
      action: () => { setOpen(false); onManualMutation(); },
    },
    {
      Icon: Diff, label: 'Myers Diff Extraction', sublabel: 'Export edit operations from HEAD',
      color: '#FACC15',
      action: () => void handleMyersDiff(),
    },
    {
      Icon: Box, label: 'Assembly Junction Predictor', sublabel: 'Predict GG / Gibson junction',
      color: '#38BDF8',
      action: () => { setOpen(false); onAssemblyPredictor(); },
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        disabled={disabled}
        title={disabled ? 'Load a genome first' : 'Surgical Suite'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4,
          background: !disabled ? 'rgba(251,113,133,0.05)' : 'rgba(255,255,255,0.02)',
          border: !disabled ? '1px solid rgba(251,113,133,0.18)' : '1px solid rgba(255,255,255,0.04)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: !disabled ? '#FB7185' : '#1E293B',
          fontSize: 11, fontFamily: 'var(--font-jetbrains-mono, monospace)',
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
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            style={{
              position: 'fixed', top: ddPos.top, left: ddPos.left,
              zIndex: 9500, minWidth: 260,
              background: 'rgba(9,15,28,0.97)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
              boxShadow: '0 24px 60px rgba(2,6,23,0.85)',
              backdropFilter: 'blur(20px)',
              padding: '4px 0',
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
            }}
          >
            <div style={{ padding: '6px 12px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Surgical Suite
              </span>
            </div>
            {ITEMS.map(({ Icon, label, sublabel, color, action }) => (
              <button
                key={label}
                onClick={action}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '9px 14px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left', transition: 'background 80ms',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 5, flexShrink: 0,
                  background: `${color}12`, border: `1px solid ${color}22`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={11} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#E2E8F0', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 9.5, color: '#334155', lineHeight: 1.4 }}>{sublabel}</div>
                </div>
                <ChevRight size={11} style={{ color: '#1E293B', marginLeft: 'auto', flexShrink: 0, marginTop: 6 }} />
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
// § PHASE 6 — Security Shield Dropdown
// ─────────────────────────────────────────────────────────────────────────────

function SecurityDropdown({
  disabled,
  onHeatmap,
  onGenerateReport,
}: {
  disabled: boolean;
  onHeatmap: () => void;
  onGenerateReport: () => void;
}) {
  const [open, setOpen]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const btnRef              = useRef<HTMLButtonElement>(null);
  const [ddPos, setDdPos]   = useState({ top: 0, left: 0 });

  const openMenu = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDdPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const ITEMS = [
    {
      Icon: Radar,
      label: 'Off-Target Radar',
      sublabel: 'CRISPR off-target heatmap analysis',
      color: '#F43F5E',
      action: () => { setOpen(false); onHeatmap(); },
    },
    {
      Icon: FileCheck,
      label: 'Generate Lab Certificate',
      sublabel: 'Export signed audit report (PDF)',
      color: '#10B981',
      action: () => {
        setOpen(false);
        setBusy(true);
        onGenerateReport();
        // busy flag is reset externally once the view opens
        setTimeout(() => setBusy(false), 3000);
      },
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        disabled={disabled || busy}
        title={disabled ? 'Load a genome first' : 'Security & Audit'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4,
          background: !disabled ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)',
          border: !disabled ? '1px solid rgba(16,185,129,0.18)' : '1px solid rgba(255,255,255,0.04)',
          cursor: disabled || busy ? 'not-allowed' : 'pointer',
          color: !disabled ? '#10B981' : '#1E293B',
          fontSize: 11, fontFamily: 'var(--font-jetbrains-mono, monospace)',
          transition: 'all 150ms', opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!disabled && !busy) { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.10)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(16,185,129,0.30)'; } }}
        onMouseLeave={e => { if (!disabled && !busy) { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(16,185,129,0.18)'; } }}
      >
        {busy
          ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} />
          : <Shield size={11} />}
        Security
        <ChevronDown size={9} style={{ opacity: 0.6, transition: 'transform 120ms', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            style={{
              position: 'fixed', top: ddPos.top, left: ddPos.left,
              zIndex: 9500, minWidth: 270,
              background: 'rgba(9,15,28,0.97)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
              boxShadow: '0 24px 60px rgba(2,6,23,0.85)',
              backdropFilter: 'blur(20px)',
              padding: '4px 0',
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
            }}
          >
            <div style={{ padding: '6px 12px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Security &amp; Audit
              </span>
            </div>
            {ITEMS.map(({ Icon, label, sublabel, color, action }) => (
              <button
                key={label}
                onClick={action}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '9px 14px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left', transition: 'background 80ms',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 5, flexShrink: 0,
                  background: `${color}12`, border: `1px solid ${color}22`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={11} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#E2E8F0', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 9.5, color: '#334155', lineHeight: 1.4 }}>{sublabel}</div>
                </div>
                <ChevRight size={11} style={{ color: '#1E293B', marginLeft: 'auto', flexShrink: 0, marginTop: 6 }} />
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
// § Icon button style helper
// ─────────────────────────────────────────────────────────────────────────────

function iconBtnStyle(active = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(56,189,248,0.08)' : 'transparent',
    color: active ? '#38BDF8' : '#334155',
    transition: 'all 120ms', flexShrink: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § View tab bar rendered above the center panel
// ─────────────────────────────────────────────────────────────────────────────

function ViewTabBar({
  activeView,
  onSelect,
  onClose,
}: {
  activeView: ActiveView;
  onSelect: (v: ActiveView) => void;
  onClose: () => void;
}) {
  if (activeView === 'default') return null;

  const TABS: { id: ActiveView; label: string; Icon: React.ElementType; color: string }[] = [
    { id: 'diff',     label: 'Bio-Diff',     Icon: Diff,      color: '#FACC15' },
    { id: 'protein',  label: 'Protein Fold', Icon: Microscope, color: '#A78BFA' },
    { id: 'heatmap',  label: 'Heatmap',      Icon: Radar,     color: '#F43F5E' },
    { id: 'report',   label: 'Certificate',  Icon: FileCheck,  color: '#10B981' },
  ];

  return (
    <div style={{
      height: 30, minHeight: 30, flexShrink: 0,
      display: 'flex', alignItems: 'center', paddingLeft: 8, gap: 2,
      background: 'rgba(9,15,28,0.80)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(8px)',
    }}>
      {TABS.map(({ id, label, Icon, color }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 4, border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono, monospace)',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            background: activeView === id ? `${color}12` : 'transparent',
            color: activeView === id ? color : '#334155',
            borderBottom: activeView === id ? `2px solid ${color}` : '2px solid transparent',
            transition: 'all 100ms',
          }}
          onMouseEnter={e => { if (activeView !== id) { (e.currentTarget as HTMLElement).style.color = '#64748B'; } }}
          onMouseLeave={e => { if (activeView !== id) { (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
        >
          <Icon size={10} />
          {label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        onClick={onClose}
        title="Return to Sequence View"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', marginRight: 6, borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.07)', background: 'none',
          cursor: 'pointer', color: '#334155', fontSize: 9.5,
          fontFamily: 'var(--font-jetbrains-mono, monospace)',
          transition: 'all 120ms',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#64748B'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#334155'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
      >
        <X size={9} />
        Sequence View
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Main Workbench
// ─────────────────────────────────────────────────────────────────────────────

export default function Workbench() {
  // ── Panel active tabs ───────────────────────────────────────────────────────
  const [leftPanel,  setLeftPanel]  = useState<LeftPanel>('explorer');
  const [rightPanel, setRightPanel] = useState<RightPanel>('inspector');

  // ── Panel visibility driven by pure boolean states, no refs ────────────────
  const [leftCollapsed,       setLeftCollapsed]       = useState(false);
  const [rightCollapsed,      setRightCollapsed]      = useState(false);
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false);

  // ── Active visualization door ───────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>('default');

  // ── Diff results state — lives here in Workbench, not in child ─────────────
  const [diffData, setDiffData] = useState<any>(null);

  // ── PHASE 6: Audit report state ─────────────────────────────────────────────
  const [auditReport, setAuditReport] = useState<any>(null);

  // ── Overlay flags ───────────────────────────────────────────────────────────
  const [cmdOpen,           setCmdOpen]           = useState(false);
  const [helpOpen,          setHelpOpen]          = useState(false);
  const [scissorOpen,       setScissorOpen]       = useState(false);
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [isExportingLocal,  setIsExportingLocal]  = useState(false);

  // ── Store selectors ─────────────────────────────────────────────────────────
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

  const { 
    viewport, 
    requestViewport, 
    terminalLogs,
  } = useArkheStore();

  // Safely access results even if the type definition is lagging behind
  const sentinelResults = (useArkheStore.getState() as any).sentinelScanResults || [];

  // Watch proteinFold; when the engine produces a result, open the protein door
  const proteinFold = useArkheStore((s: ArkheState) => s.proteinFold);
  useEffect(() => {
    if (proteinFold) setActiveView('protein');
  }, [proteinFold]);

  const hasGenome = genomeLength > 0;

  // ── File upload ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSyncing(true);
      await initializeEngine();
      await loadFile(file);
    } catch (err) {
      console.error('[Workbench] ingestion error:', err);
    } finally {
      setSyncing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [initializeEngine, loadFile, setSyncing]);

  const triggerUpload = useCallback(() => fileInputRef.current?.click(), []);

  // ── Export FASTA ────────────────────────────────────────────────────────────
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

  // ── Scissor handler ─────────────────────────────────────────────────────────
  const handleMutationApply = useCallback((base: BaseCode4): void => {
    const pos = viewport.start ?? 0;
    performSurgicalEdit(Math.floor(pos / (1024 * 1024)), pos % (1024 * 1024), base);
    setShowCommitDialog(true);
    setScissorOpen(false);
  }, [viewport.start, performSurgicalEdit, setShowCommitDialog]);

  // ── Panel toggles — pure state, zero imperative refs ───────────────────────
  const toggleTerminal = useCallback(() => {
    setIsTerminalCollapsed(v => !v);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setLeftCollapsed(v => !v);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightCollapsed(v => !v);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setHelpOpen(false);
        setScissorOpen(false);
        setAssemblyModalOpen(false);
        setActiveView('default');
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key.toLowerCase()) {
        case 'k': e.preventDefault(); setCmdOpen(v => !v);           break;
        case 'b': e.preventDefault(); toggleLeftPanel();             break;
        case 't': e.preventDefault(); toggleTerminal();              break;
        case 'g':
          e.preventDefault();
          setRightPanel(p => p === 'chronos' ? 'inspector' : 'chronos');
          setRightCollapsed(false);
          break;
        case 'f':
          e.preventDefault();
          setLeftPanel('search');
          setLeftCollapsed(false);
          break;
        case 'e':
          e.preventDefault();
          void handleExportFasta();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleTerminal, handleExportFasta]);

  // ── Nav definitions ─────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100vh',
      background: '#020617', overflow: 'hidden',
      fontFamily: 'var(--font-jetbrains-mono, monospace)',
    }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".fasta,.fa,.fna,.fastq,.gb,.gbk,.vcf,.dna"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
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

      {/* ════════════════════════════════════════════════════════════════════
          TOPBAR
          ════════════════════════════════════════════════════════════════════ */}
      <header style={{
        height: 38, minHeight: 38,
        display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 8,
        background: 'rgba(2,6,23,0.99)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, userSelect: 'none', zIndex: 100,
      }}>

        {/* Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, marginRight: 4, borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <ArkheLogo size={18} variant="icon" glow className="text-white" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#F8FAFC', letterSpacing: '-0.03em' }}>
              Arkhé<span style={{ color: '#38BDF8' }}>Genesis</span>
            </span>
            <span style={{ fontSize: 8, color: '#1E293B', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
              Genomic IDE
            </span>
          </div>
        </div>

        {/* Active genome pill */}
        {hasGenome && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 4, background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', flexShrink: 0 }}>
            <Dna size={10} color="#38BDF8" />
            <span style={{ fontSize: 10.5, color: '#64748B' }}>{activeGenomeId}</span>
            <span style={{ color: '#1E293B', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10.5, color: '#38BDF8', fontWeight: 600 }}>
              {genomeLength.toLocaleString()} bp
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* ── Action strip ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>

          {/* INGEST */}
          <button
            onClick={triggerUpload}
            disabled={isSyncing}
            title="Ingest genome file (.fasta / .gb / .vcf)"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', cursor: isSyncing ? 'wait' : 'pointer', color: isSyncing ? '#38BDF8' : '#64748B', fontSize: 11, fontFamily: 'inherit', transition: 'all 150ms' }}
            onMouseEnter={e => { if (!isSyncing) { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(56,189,248,0.22)'; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isSyncing ? '#38BDF8' : '#64748B'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
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
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4,
              background: hasGenome && !isExportingLocal && !isLocked ? 'rgba(56,189,248,0.05)' : 'rgba(255,255,255,0.02)',
              border: hasGenome && !isExportingLocal && !isLocked ? '1px solid rgba(56,189,248,0.18)' : '1px solid rgba(255,255,255,0.04)',
              cursor: !hasGenome || isExportingLocal || isLocked ? 'not-allowed' : 'pointer',
              color: hasGenome && !isExportingLocal && !isLocked ? '#38BDF8' : '#1E293B',
              fontSize: 11, fontFamily: 'inherit', transition: 'all 150ms', opacity: !hasGenome ? 0.45 : 1,
            }}
            onMouseEnter={e => { if (hasGenome && !isExportingLocal && !isLocked) { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.10)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(56,189,248,0.35)'; (e.currentTarget as HTMLElement).style.color = '#7DD3FC'; } }}
            onMouseLeave={e => { if (hasGenome && !isExportingLocal && !isLocked) { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(56,189,248,0.18)'; (e.currentTarget as HTMLElement).style.color = '#38BDF8'; } }}
          >
            {isExportingLocal ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.85, ease: 'linear' }}
                style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid #38BDF8', borderTopColor: 'transparent', flexShrink: 0 }}
              />
            ) : <Download size={11} />}
            {isExportingLocal ? 'Exporting…' : 'Export'}
          </button>

          {/* Surgical Suite Dropdown */}
          <SurgicalDropdown
            disabled={!hasGenome || isLocked}
            onManualMutation={() => setScissorOpen(true)}
            onAssemblyPredictor={() => setAssemblyModalOpen(true)}
            chronosHead={chronosHead}
            getDiffForTx={getDiffForTx}
            addLog={addSystemLog}
            onDiffReady={(data: any) => {
              setDiffData(data);
              setActiveView('diff');
            }}
          />

          {/* PHASE 6 — Security Shield Dropdown */}
          <SecurityDropdown
            disabled={!hasGenome || isLocked}
            onHeatmap={() => setActiveView('heatmap')}
            onGenerateReport={() => {
              generateAuditReport().then(report => {
                setAuditReport(report);
                setActiveView('report');
              }).catch(err => {
                console.error('[Workbench] audit report error:', err);
              });
            }}
          />

          {/* SEARCH */}
          <button
            onClick={() => { setLeftPanel('search'); setLeftCollapsed(false); }}
            title="Search (⌘F)"
            style={iconBtnStyle()}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#334155'; }}
          >
            <Search size={13} />
          </button>

          {/* HELP */}
          <button
            onClick={() => setHelpOpen(true)}
            title="Keyboard Shortcuts (?)"
            style={iconBtnStyle(helpOpen)}
            onMouseEnter={e => { if (!helpOpen) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; } }}
            onMouseLeave={e => { if (!helpOpen) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
          >
            <HelpCircle size={13} />
          </button>

          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />

          {/* SIDEBAR TOGGLE */}
          <button
            onClick={toggleLeftPanel}
            title={`${leftCollapsed ? 'Show' : 'Hide'} Explorer (⌘B)`}
            style={iconBtnStyle(!leftCollapsed)}
            onMouseEnter={e => { if (leftCollapsed) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; } }}
            onMouseLeave={e => { if (leftCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
          >
            {leftCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>

          {/* TERMINAL TOGGLE */}
          <button
            onClick={toggleTerminal}
            title="Toggle Terminal (⌘T)"
            style={iconBtnStyle(!isTerminalCollapsed)}
            onMouseEnter={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; } }}
            onMouseLeave={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
          >
            <Terminal size={13} />
          </button>

          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />

          {/* WORKER STATUS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: workerConnected ? '#10B981' : '#334155',
              boxShadow: workerConnected ? '0 0 6px rgba(16,185,129,0.5)' : 'none',
            }} />
            <span style={{ fontSize: 10.5, color: '#334155' }}>
              {workerConnected ? 'Ready' : 'Init'}
            </span>
          </div>

          {/* COMMAND PALETTE */}
          <button
            onClick={() => setCmdOpen(true)}
            title="Command Palette (⌘K)"
            style={{ padding: 5, borderRadius: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#1E293B', transition: 'all 120ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#475569'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#1E293B'; }}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════
          BODY  —  Icon Rail + Resizable Panels
          ════════════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Icon Rail ──────────────────────────────────────────────────── */}
        <aside style={{
          width: 40, minWidth: 40, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(2,6,23,0.97)',
          borderRight: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 8, paddingBottom: 8, gap: 2, zIndex: 10,
        }}>
          {LN.map(({ id, Icon, label, shortcut }) => {
            const active = leftPanel === id && !leftCollapsed;
            return (
              <button
                key={id}
                onClick={() => {
                  if (active) { toggleLeftPanel(); }
                  else { setLeftPanel(id); setLeftCollapsed(false); }
                }}
                title={`${label} (${shortcut})`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, margin: '0 auto',
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: active ? 'rgba(56,189,248,0.10)' : 'transparent',
                  color: active ? '#38BDF8' : '#334155',
                  borderLeft: active ? '2px solid #38BDF8' : '2px solid transparent',
                  transition: 'all 120ms',
                }}
                onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; } }}
                onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
              >
                <Icon size={15} style={{ opacity: active ? 1 : 0.75 }} />
              </button>
            );
          })}

          <div style={{ flex: 1 }} />

          {/* Terminal toggle in rail */}
          <button
            onClick={toggleTerminal}
            title="Toggle Terminal (⌘T)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, margin: '0 auto',
              borderRadius: 4, border: 'none', cursor: 'pointer',
              background: !isTerminalCollapsed ? 'rgba(56,189,248,0.08)' : 'transparent',
              color: !isTerminalCollapsed ? '#38BDF8' : '#1E293B',
              borderLeft: !isTerminalCollapsed ? '2px solid rgba(56,189,248,0.60)' : '2px solid transparent',
              transition: 'all 120ms',
            }}
            onMouseEnter={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#475569'; } }}
            onMouseLeave={e => { if (isTerminalCollapsed) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#1E293B'; } }}
          >
            <Terminal size={14} />
          </button>

          {/* Settings */}
          <button
            onClick={() => setCmdOpen(true)}
            title="Settings (⌘K)"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, margin: '0 auto', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: '#1E293B', transition: 'all 120ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#475569'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#1E293B'; }}
          >
            <Settings size={14} />
          </button>
        </aside>

        {/* ── Resizable area ─────────────────────────────────────────────── */}
        <Group orientation="vertical" style={{ flex: 1, overflow: 'hidden' }}>

          {/* ── Top row ──────────────────────────────────────────────────── */}
          <Panel defaultSize={75} minSize={40}>
            <Group orientation="horizontal" style={{ height: '100%' }}>

              {/* LEFT SIDEBAR */}
              <Panel
                defaultSize={18} minSize={10} maxSize={35}
                collapsible collapsedSize={0}
                style={{
                  background: 'rgba(2,6,23,0.97)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  borderRight: leftCollapsed ? 'none' : '1px solid rgba(255,255,255,0.05)',
                }}
              >
                {!leftCollapsed && (
                  <>
                    {/* Left panel tab bar */}
                    <div style={{ height: 32, minHeight: 32, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)', flexShrink: 0 }}>
                      {LN.map(({ id, Icon, label }) => (
                        <button key={id} onClick={() => setLeftPanel(id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: leftPanel === id ? 'rgba(56,189,248,0.08)' : 'transparent', color: leftPanel === id ? '#38BDF8' : '#1E293B', transition: 'all 120ms' }}
                          onMouseEnter={e => { if (leftPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
                          onMouseLeave={e => { if (leftPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#1E293B'; } }}
                        >
                          <Icon size={9} />{label}
                        </button>
                      ))}
                      <div style={{ flex: 1 }} />
                      <button onClick={toggleLeftPanel} style={{ padding: 2, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#1E293B', transition: 'color 120ms' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#1E293B')}
                      >
                        <ChevronLeft size={11} />
                      </button>
                    </div>

                    <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={leftPanel}
                          initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.12 }}
                          style={{ height: '100%' }}
                        >
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
              <Panel
                minSize={30}
                style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}
              >
                {/* Visualization tab bar (only visible when a door is open) */}
                <ViewTabBar
                  activeView={activeView}
                  onSelect={setActiveView}
                  onClose={() => setActiveView('default')}
                />

                {hasGenome && activeView === 'default' && <SurgicalToolbar />}

                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                  <AnimatePresence mode="wait">
                    {activeView === 'default' && (
                      <motion.div
                        key="default"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        style={{ height: '100%' }}
                      >
                        <SequenceView onRequestUpload={triggerUpload} />
                      </motion.div>
                    )}

                    {activeView === 'diff' && diffData && (
                      <motion.div
                        key="diff"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        style={{ height: '100%' }}
                      >
                        <BioDiffMode oldSequence={diffData.oldSeq} newSequence={diffData.newSeq} mutations={diffData.changes} />
                      </motion.div>
                    )}

                    {activeView === 'protein' && (
                      <motion.div
                        key="protein"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        style={{ height: '100%' }}
                      >
                        <ProteinViewport />
                      </motion.div>
                    )}

                    {/* PHASE 6 — Off-Target Heatmap door */}
                    {activeView === 'heatmap' && (
                      <motion.div
                        key="heatmap"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        style={{ height: '100%' }}
                      >
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

                    {/* PHASE 6 — Genesis Audit Report door */}
                    {activeView === 'report' && (
                      <motion.div
                        key="report"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        style={{ height: '100%' }}
                      >
                        <GenesisAuditReport
                          report={auditReport}
                          onClose={() => setActiveView('default')}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Panel>

              {!rightCollapsed && <ColHandle />}

              {/* RIGHT SIDEBAR */}
              <Panel
                defaultSize={22} minSize={12} maxSize={40}
                collapsible collapsedSize={0}
                style={{
                  background: 'rgba(2,6,23,0.97)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  borderLeft: rightCollapsed ? 'none' : '1px solid rgba(255,255,255,0.05)',
                }}
              >
                {!rightCollapsed && (
                  <>
                    <div style={{ height: 32, minHeight: 32, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 3, borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)', flexShrink: 0 }}>
                      <button onClick={toggleRightPanel} style={{ padding: 2, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#1E293B', marginRight: 2, transition: 'color 120ms' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#1E293B')}
                      >
                        <ChevronRight size={11} />
                      </button>
                      {RN.map(({ id, Icon, label }) => (
                        <button key={id} onClick={() => setRightPanel(id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: rightPanel === id ? 'rgba(56,189,248,0.08)' : 'transparent', color: rightPanel === id ? '#38BDF8' : '#1E293B', transition: 'all 120ms' }}
                          onMouseEnter={e => { if (rightPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = '#334155'; } }}
                          onMouseLeave={e => { if (rightPanel !== id) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#1E293B'; } }}
                        >
                          <Icon size={9} />{label}
                        </button>
                      ))}
                    </div>

                    <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={rightPanel}
                          initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}
                          transition={{ duration: 0.12 }}
                          style={{ height: '100%' }}
                        >
                          {rightPanel === 'inspector' && <InspectorPanel />}
                          {rightPanel === 'chronos' && (
                            <ChronosSidebar isCollapsed={false} onToggle={toggleRightPanel} />
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </Panel>
            </Group>
          </Panel>

          {/* Row resize handle — hidden when terminal is collapsed */}
          {!isTerminalCollapsed && <RowHandle />}

          {/* BOTTOM TERMINAL */}
          <Panel
            defaultSize={25} minSize={8} maxSize={60}
            collapsible collapsedSize={0}
            style={{
              background: 'rgba(2,6,23,0.98)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{
              height: 30, minHeight: 30,
              display: 'flex', alignItems: 'center',
              padding: '0 12px', gap: 8,
              borderBottom: isTerminalCollapsed ? 'none' : '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(255,255,255,0.01)', flexShrink: 0,
            }}>
              <Terminal size={11} color="#38BDF8" style={{ opacity: 0.8, flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#334155' }}>
                System Log
              </span>
              {(terminalLogs?.length ?? 0) > 0 && (
                <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(56,189,248,0.10)', fontSize: 9, color: '#38BDF8', flexShrink: 0 }}>
                  {terminalLogs.length}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={toggleTerminal}
                title="Toggle Terminal (⌘T)"
                style={{ padding: 3, borderRadius: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#334155', display: 'flex', alignItems: 'center', transition: 'color 120ms' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
                onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
              >
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
  );
}