'use client';

/**
 * SequenceView.tsx — THE THRONE
 * ──────────────────────────────────────────────────────────────────────────────
 * GENESIS ENGINE PHASE 3 — TASK 2: Sequence Context Menu
 *
 * New in this version:
 *   · Right-click context menu via ReactDOM.createPortal — never clipped by
 *     panel boundaries, always renders into document.body at the correct
 *     cursor position.
 *   · Menu appears ONLY when the user has an active base-selection.
 *   · Abyssal glassmorphism style consistent with the rest of the IDE.
 *   · Three fully-wired items (zero placeholders):
 *
 *       1. "Fold Protein (ESM Atlas)"
 *          → store.foldProtein(selectedSeq)
 *          Logs SYSTEM entry; the ProteinViewport panel updates reactively.
 *
 *       2. "Detect Hairpins"
 *          → dispatches DETECT_HAIRPINS to the Web Worker via store.worker.
 *          Results are surfaced as SYSTEM log entries (critical hairpins as
 *          'error', others as 'success'). A compact results badge also renders
 *          in the view.
 *
 *       3. "In-Silico PCR Audit"
 *          → Opens an inline PCR launcher (portal) with the selected sequence
 *          pre-filled as the template reference. Calls store.runPCR() on
 *          submission with user-supplied primers.
 *
 * Preserved:
 *   FR-01 State Guard, LB-11/14 viewportVersion, range prefetch,
 *   ThermodynamicHUD on selection ≥10 bases, GhostRibbonOverlay,
 *   MolecularScissorView, useHasMounted() hydration guard.
 * ──────────────────────────────────────────────────────────────────────────────
 * Phase 5 TypeScript alignment:
 *   · Imported canonical SystemLog to explicitly type all addLog / addSystemLog
 *     locals.  This ensures `category` is always the narrow union at the call
 *     site and never widens to `string`, eliminating any --strictFunctionTypes
 *     drift if store types are regenerated.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Dna, AlertTriangle, Upload, Cpu, Activity,
  FlaskConical, Scissors, X, Loader2, AlertCircle,
  CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import type { SystemLog } from '@/types/SystemLog';
import GhostRibbonOverlay from '@/components/visuals/GhostRibbonOverlay';
import MolecularScissorView from '@/components/visuals/MolecularScissorView';
import ThermodynamicHUD from '@/components/visuals/ThermodynamicHUD';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

// ── Layout constants ─────────────────────────────────────────────────────────
const BASES_PER_ROW = 60;
const ROW_HEIGHT    = 28;
const CHAR_WIDTH    = 10;

// ── Base palette ─────────────────────────────────────────────────────────────
const BASE_COLORS: Record<string, string> = {
  A: '#4ADE80', T: '#FB7185', C: '#38BDF8', G: '#FACC15', N: '#334155',
};
const BASE_GLOW: Record<string, string> = {
  A: 'drop-shadow(0 0 4px rgba(74,222,128,0.45))',
  T: 'drop-shadow(0 0 4px rgba(251,113,133,0.45))',
  C: 'drop-shadow(0 0 4px rgba(56,189,248,0.55))',
  G: 'drop-shadow(0 0 4px rgba(250,204,21,0.45))',
  N: 'none',
};

// ── Hydration guard ───────────────────────────────────────────────────────────
function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SelectionRange { start: number; end: number; }

interface HairpinResult {
  position: number;
  length: number;
  deltaG: number;
  critical: boolean;
  stemSequence?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  sequence: string;
}

export interface SequenceViewProps {
  onRequestUpload?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Context Menu — rendered via Portal, Abyssal glassmorphism
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  ctx: ContextMenuState;
  onClose: () => void;
  onFold: (seq: string) => void;
  onHairpins: (seq: string) => void;
  onPCRAudit: (seq: string) => void;
  isFolding: boolean;
  isDetectingHairpins: boolean;
}

function SequenceContextMenu({
  ctx, onClose, onFold, onHairpins, onPCRAudit, isFolding, isDetectingHairpins,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss on click-outside or Escape
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const click = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', click);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', click);
    };
  }, [onClose]);

  // Viewport clamp so menu doesn't overflow screen edges
  const [pos, setPos] = useState({ left: ctx.x, top: ctx.y });
  useEffect(() => {
    if (!menuRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = menuRef.current;
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      left: ctx.x + w > vw ? ctx.x - w : ctx.x,
      top:  ctx.y + h > vh ? ctx.y - h : ctx.y,
    });
  }, [ctx.x, ctx.y]);

  const truncatedSeq = ctx.sequence.length > 24
    ? `${ctx.sequence.slice(0, 12)}…${ctx.sequence.slice(-6)}`
    : ctx.sequence;

  type MenuItem = {
    Icon: React.ElementType;
    label: string;
    sublabel: string;
    color: string;
    loading?: boolean;
    action: () => void;
  };

  const items: MenuItem[] = [
    {
      Icon: Cpu,
      label: 'Fold Protein (ESM Atlas)',
      sublabel: 'Predict 3D structure via AlphaFold-scale model',
      color: '#818CF8',
      loading: isFolding,
      action: () => { onFold(ctx.sequence); onClose(); },
    },
    {
      Icon: Activity,
      label: 'Detect Hairpins',
      sublabel: 'Find RNA secondary structures (ΔG threshold)',
      color: '#FACC15',
      loading: isDetectingHairpins,
      action: () => { onHairpins(ctx.sequence); onClose(); },
    },
    {
      Icon: FlaskConical,
      label: 'In-Silico PCR Audit',
      sublabel: 'Open PCR tool with selection as template',
      color: '#4ADE80',
      action: () => { onPCRAudit(ctx.sequence); onClose(); },
    },
  ];

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -6 }}
      transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 99999,
        minWidth: 270,
        background: 'rgba(6,12,26,0.96)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 10,
        boxShadow: '0 28px 70px rgba(2,6,23,0.90), 0 0 0 1px rgba(56,189,248,0.06)',
        padding: '5px 0',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
        userSelect: 'none',
      }}
    >
      {/* Header — shows selected sequence snippet */}
      <div style={{
        padding: '6px 14px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        marginBottom: 4,
      }}>
        <div style={{ fontSize: 8.5, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 3 }}>
          Selection · {ctx.sequence.length.toLocaleString()} bp
        </div>
        <div style={{
          fontSize: 10.5, color: '#38BDF8', fontWeight: 600,
          letterSpacing: '0.05em', lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {truncatedSeq}
        </div>
      </div>

      {/* Menu items */}
      {items.map(({ Icon, label, sublabel, color, loading, action }) => (
        <button
          key={label}
          onClick={action}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            width: '100%', padding: '8px 14px',
            background: 'transparent', border: 'none', cursor: loading ? 'wait' : 'pointer',
            textAlign: 'left', transition: 'background 80ms',
            fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
          }}
          onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {/* Icon badge */}
          <div style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: `${color}10`, border: `1px solid ${color}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {loading
              ? <Loader2 size={11} style={{ color, animation: 'spin 0.85s linear infinite' }} />
              : <Icon size={11} style={{ color }} />
            }
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#E2E8F0', fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </div>
            <div style={{ fontSize: 9.5, color: '#334155', lineHeight: 1.4 }}>
              {sublabel}
            </div>
          </div>

          <ChevronRight size={10} style={{ color: '#1E293B', flexShrink: 0, marginTop: 7 }} />
        </button>
      ))}

      {/* Footer hint */}
      <div style={{ padding: '5px 14px 3px', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#1E293B' }}>Esc to dismiss</span>
      </div>
    </motion.div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § PCR Audit Launcher — portal overlay with pre-filled template reference
// ─────────────────────────────────────────────────────────────────────────────

interface PCRAuditLauncherProps {
  template: string;
  onClose: () => void;
}

function PCRAuditLauncher({ template, onClose }: PCRAuditLauncherProps) {
  const [fwd, setFwd] = useState('');
  const [rev, setRev] = useState('');
  const [maxMismatch, setMaxMismatch] = useState(2);
  const [launched, setLaunched] = useState(false);

  const runPCR      = useArkheStore((s: ArkheState) => s.runPCR);
  const isRunningPCR = useArkheStore((s: ArkheState) => s.isRunningPCR);
  const pcrResults   = useArkheStore((s: ArkheState) => s.pcrResults);
  const addLog       = useArkheStore((s: ArkheState) => s.addSystemLog) as (log: SystemLog) => void;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const handleRun = useCallback(async () => {
    if (!fwd.trim() || !rev.trim()) return;
    addLog({ level: 'info', category: 'PCR', message: `PCR audit launched (${fwd.length}+${rev.length} bp primers, ${template.length} bp template)`, timestamp: Date.now() });
    try {
      await runPCR(fwd.trim(), rev.trim(), { maxMismatches: maxMismatch });
      setLaunched(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({ level: 'error', category: 'PCR', message: `PCR audit failed: ${msg}`, timestamp: Date.now() });
    }
  }, [fwd, rev, maxMismatch, template, runPCR, addLog]);

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5,
    padding: '7px 10px', color: '#94A3B8', fontSize: 11,
    fontFamily: 'var(--font-jetbrains-mono, monospace)',
    outline: 'none', boxSizing: 'border-box', letterSpacing: '0.04em',
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
      }}
    >
      <motion.div
        initial={{ scale: 0.93, y: 12 }} animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 12 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(9,15,28,0.98)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 12, padding: '24px 28px', width: 420,
          boxShadow: '0 32px 80px rgba(2,6,23,0.90)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={13} style={{ color: '#4ADE80' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              In-Silico PCR Audit
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 4, transition: 'color 120ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Template preview */}
        <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 6, background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)' }}>
          <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 5 }}>
            Template ({template.length.toLocaleString()} bp)
          </div>
          <div style={{ fontSize: 10.5, color: '#4ADE80', fontWeight: 600, wordBreak: 'break-all', letterSpacing: '0.04em', maxHeight: 40, overflow: 'hidden' }}>
            {template.length > 60 ? `${template.slice(0, 30)}…${template.slice(-10)}` : template}
          </div>
        </div>

        {/* Primer inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5 }}>Forward Primer</div>
            <input value={fwd} onChange={e => setFwd(e.target.value)} placeholder="5′ → 3′ ATCG…" style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(74,222,128,0.35)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5 }}>Reverse Primer</div>
            <input value={rev} onChange={e => setRev(e.target.value)} placeholder="5′ → 3′ ATCG…" style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(74,222,128,0.35)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5 }}>Max Mismatches</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0, 1, 2, 3].map(n => (
                <button key={n} onClick={() => setMaxMismatch(n)}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
                    fontFamily: 'inherit', fontWeight: 600,
                    background: maxMismatch === n ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.03)',
                    color: maxMismatch === n ? '#4ADE80' : '#334155',
                    outline: maxMismatch === n ? '1px solid rgba(74,222,128,0.30)' : '1px solid rgba(255,255,255,0.06)',
                    transition: 'all 120ms',
                  }}>{n}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={() => void handleRun()}
          disabled={!fwd.trim() || !rev.trim() || isRunningPCR}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 6,
            background: fwd && rev && !isRunningPCR ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.03)',
            border: fwd && rev && !isRunningPCR ? '1px solid rgba(74,222,128,0.28)' : '1px solid rgba(255,255,255,0.06)',
            color: fwd && rev && !isRunningPCR ? '#4ADE80' : '#334155',
            cursor: !fwd.trim() || !rev.trim() || isRunningPCR ? 'not-allowed' : 'pointer',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 150ms', marginBottom: 12,
          }}
        >
          {isRunningPCR
            ? <><Loader2 size={11} style={{ animation: 'spin 0.85s linear infinite' }} /> Running PCR…</>
            : <><FlaskConical size={11} /> Run PCR Audit</>
          }
        </button>

        {/* Results */}
        <AnimatePresence>
          {launched && pcrResults.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
                  {pcrResults.length} product{pcrResults.length !== 1 ? 's' : ''} detected
                </div>
                {pcrResults.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div>
                      <span style={{ fontSize: 11.5, color: '#4ADE80', fontWeight: 600 }}>{p.productLength.toLocaleString()} bp</span>
                      <span style={{ fontSize: 9.5, color: '#1E293B', marginLeft: 6 }}>{p.forwardStart.toLocaleString()}…{p.reverseEnd.toLocaleString()}</span>
                    </div>
                    <span style={{ fontSize: 9, color: '#475569' }}>Tm {Math.round(p.forwardTm)}°/{Math.round(p.reverseTm)}°C</span>
                  </div>
                ))}
                {pcrResults.length > 4 && (
                  <div style={{ fontSize: 9.5, color: '#334155', marginTop: 6, textAlign: 'center' }}>
                    +{pcrResults.length - 4} more — see PCR Workbench
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {launched && pcrResults.length === 0 && !isRunningPCR && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 5, background: 'rgba(251,113,133,0.06)', border: '1px solid rgba(251,113,133,0.15)' }}>
                <AlertCircle size={11} style={{ color: '#FB7185', flexShrink: 0 }} />
                <span style={{ fontSize: 10.5, color: '#FB7185' }}>No products found with these primers and settings.</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Hairpin Results Badge — inline notification in SequenceView
// ─────────────────────────────────────────────────────────────────────────────

function HairpinResultBadge({
  results,
  onDismiss,
}: {
  results: HairpinResult[];
  onDismiss: () => void;
}) {
  const criticalCount = results.filter(h => h.critical).length;
  const hasCritical = criticalCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute', bottom: 44, left: 12, zIndex: 22,
        background: 'rgba(9,15,28,0.96)', backdropFilter: 'blur(16px)',
        border: `1px solid ${hasCritical ? 'rgba(251,113,133,0.30)' : 'rgba(74,222,128,0.25)'}`,
        borderRadius: 8, padding: '10px 12px', minWidth: 200, maxWidth: 300,
        fontFamily: 'var(--font-jetbrains-mono, monospace)',
        boxShadow: '0 16px 40px rgba(2,6,23,0.80)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasCritical
            ? <AlertTriangle size={11} style={{ color: '#FB7185', flexShrink: 0 }} />
            : <CheckCircle2 size={11} style={{ color: '#4ADE80', flexShrink: 0 }} />
          }
          <span style={{ fontSize: 10, fontWeight: 700, color: hasCritical ? '#FB7185' : '#4ADE80', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Hairpin Analysis
          </span>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 2, lineHeight: 1, transition: 'color 80ms' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
          onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
        >
          <X size={10} />
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#E2E8F0', marginBottom: 6, lineHeight: 1.4 }}>
        {results.length} hairpin{results.length !== 1 ? 's' : ''} detected
        {criticalCount > 0 && (
          <span style={{ color: '#FB7185', marginLeft: 4, fontWeight: 600 }}>({criticalCount} critical)</span>
        )}
      </div>

      {results.slice(0, 3).map((h, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: h.critical ? '#FB7185' : '#64748B', padding: '2px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <span>@ {h.position.toLocaleString()}</span>
          <span>ΔG {h.deltaG.toFixed(1)} kcal/mol</span>
        </div>
      ))}
      {results.length > 3 && (
        <div style={{ fontSize: 9.5, color: '#334155', marginTop: 4 }}>+{results.length - 3} more</div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SequenceView({ onRequestUpload }: SequenceViewProps) {
  const hasMounted   = useHasMounted();
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Interaction state ──────────────────────────────────────────────────────
  const [hoveredPosition,  setHoveredPosition]  = useState<number | null>(null);
  const [selection,        setSelection]         = useState<SelectionRange | null>(null);
  const [selectionAnchor,  setSelectionAnchor]   = useState<number | null>(null);
  const [selectedSequence, setSelectedSequence]  = useState('');
  const [cursorPos,        setCursorPos]         = useState({ x: 0, y: 0 });
  const [showThermoHUD,    setShowThermoHUD]     = useState(false);
  const [isDragging,       setIsDragging]        = useState(false);

  // ── Context menu state ─────────────────────────────────────────────────────
  const [contextMenu,      setContextMenu]       = useState<ContextMenuState | null>(null);
  const [pcrTemplate,      setPcrTemplate]       = useState<string | null>(null);

  // ── Hairpin detection state ────────────────────────────────────────────────
  const [isDetectingHairpins, setIsDetectingHairpins] = useState(false);
  const [hairpinResults,       setHairpinResults]       = useState<HairpinResult[] | null>(null);

  // ── Store ──────────────────────────────────────────────────────────────────
  const viewport               = useArkheStore((s: ArkheState) => s.viewport);
  const viewportVersion        = useArkheStore((s: ArkheState) => s.viewportVersion);
  const genomeLength           = useArkheStore((s: ArkheState) => s.genomeLength);
  const restrictionSites       = useArkheStore((s: ArkheState) => s.restrictionSites);
  const syntenyAnchors         = useArkheStore((s: ArkheState) => s.syntenyAnchors);
  const requestViewport        = useArkheStore((s: ArkheState) => s.requestViewport);
  const isRealigning           = useArkheStore((s: ArkheState) => s.isRealigning);
  const slabVersion            = useArkheStore((s: ArkheState) => s.slabVersion);
  const slabAcknowledgedVersion = useArkheStore((s: ArkheState) => s.slabAcknowledgedVersion);
  const foldProtein            = useArkheStore((s: ArkheState) => s.foldProtein);
  const isFolding              = useArkheStore((s: ArkheState) => s.isFolding);
  const worker                 = useArkheStore((s: ArkheState) => s.worker);
  const addSystemLog           = useArkheStore((s: ArkheState) => s.addSystemLog) as (log: SystemLog) => void;

  const isSlabGuardActive = isRealigning || slabVersion !== slabAcknowledgedVersion;
  const viewportBuffer    = viewport.buffer;
  const viewportStart     = viewport.start  ?? 0;
  const viewportEnd       = viewport.end    ?? 0;
  const bufferIsValid     = !!viewportBuffer && viewportBuffer.byteLength > 0;

  // Sequence derivation
  const sequence = useMemo(() => {
    if (!bufferIsValid) return '';
    const buffer = new Uint8Array(viewportBuffer);
    const bases  = ['A', 'C', 'G', 'T', 'N'] as const;
    return Array.from(buffer).map((c) => bases[c] ?? 'N').join('');
  }, [viewportBuffer, bufferIsValid, viewportVersion]);

  const rows = useMemo(() => {
    const result: { rowNumber: number; position: number; sequence: string }[] = [];
    for (let i = 0; i < sequence.length; i += BASES_PER_ROW) {
      result.push({
        rowNumber: Math.floor(i / BASES_PER_ROW),
        position:  viewportStart + i,
        sequence:  sequence.slice(i, i + BASES_PER_ROW),
      });
    }
    return result;
  }, [sequence, viewportStart, viewportVersion]);

  // Range prefetch
  const handleRangeChange = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      const newStart = Math.max(0, viewportStart + range.startIndex * BASES_PER_ROW - 1200);
      const newEnd   = Math.min(genomeLength - 1, viewportStart + range.endIndex * BASES_PER_ROW + 1200);
      if (newStart < viewportStart || newEnd > viewportEnd) {
        requestViewport(newStart, newEnd);
      }
    },
    [viewportStart, viewportEnd, genomeLength, requestViewport],
  );

  // ── Drag selection ─────────────────────────────────────────────────────────
  const handleBaseMouseDown = useCallback((absPos: number) => {
    setIsDragging(true);
    setSelectionAnchor(absPos);
    setSelection({ start: absPos, end: absPos });
    setShowThermoHUD(false);
    setContextMenu(null);
  }, []);

  const handleBaseMouseEnter = useCallback((absPos: number) => {
    if (!isDragging || selectionAnchor === null) return;
    setSelection({ start: Math.min(selectionAnchor, absPos), end: Math.max(selectionAnchor, absPos) });
  }, [isDragging, selectionAnchor]);

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      if (selection && selection.end > selection.start && selection.end - selection.start + 1 >= 10) {
        const offsetStart = selection.start - viewportStart;
        const offsetEnd   = selection.end   - viewportStart + 1;
        if (offsetStart >= 0 && offsetEnd <= sequence.length) {
          const extracted = sequence.slice(offsetStart, offsetEnd).replace(/\s/g, '').toUpperCase();
          if (/^[ATCGN]+$/.test(extracted)) {
            setSelectedSequence(extracted);
            setCursorPos({ x: e.clientX, y: e.clientY });
            setShowThermoHUD(true);
          }
        }
      } else {
        setSelection(null);
      }
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [isDragging, selection, sequence, viewportStart]);

  // ── Right-click context menu ───────────────────────────────────────────────
  // Only fires when a selection exists; prevents the native menu.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!selection || selection.end <= selection.start || !selectedSequence) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sequence: selectedSequence });
  }, [selection, selectedSequence]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.base === undefined) {
      setSelection(null);
      setShowThermoHUD(false);
      setContextMenu(null);
    }
  }, []);

  // ── TASK 2 ACTION: Fold Protein ────────────────────────────────────────────
  const handleFoldProtein = useCallback(async (seq: string) => {
    addSystemLog({ level: 'info', category: 'SYSTEM', message: `Protein fold requested for ${seq.length} bp selection…`, timestamp: Date.now() });
    try {
      const result = await foldProtein(seq);
      addSystemLog({
        level: 'success', category: 'SYSTEM',
        message: `Fold complete (${result.method}) — ${result.aminoAcids.length} aa, ${(result.confidence.reduce((a, b) => a + b, 0) / result.confidence.length * 100).toFixed(1)}% avg confidence`,
        timestamp: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addSystemLog({ level: 'error', category: 'SYSTEM', message: `Fold failed: ${msg}`, timestamp: Date.now() });
    }
  }, [foldProtein, addSystemLog]);

  // ── TASK 2 ACTION: Detect Hairpins ────────────────────────────────────────
  // Dispatches DETECT_HAIRPINS directly to the Web Worker via store.worker.
  const handleDetectHairpins = useCallback(async (seq: string) => {
    if (!worker) {
      addSystemLog({ level: 'error', category: 'SYSTEM', message: 'Worker not connected — cannot detect hairpins.', timestamp: Date.now() });
      return;
    }
    setIsDetectingHairpins(true);
    setHairpinResults(null);
    addSystemLog({ level: 'info', category: 'SYSTEM', message: `Hairpin detection: scanning ${seq.length} bp…`, timestamp: Date.now() });

    const id = Math.random().toString(36).slice(2, 10);
    const TIMEOUT_MS = 20_000;

    try {
      const results = await new Promise<HairpinResult[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.removeEventListener('message', handler);
          reject(new Error('Hairpin detection timed out after 20 s'));
        }, TIMEOUT_MS);

        const handler = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          worker.removeEventListener('message', handler);
          clearTimeout(timer);
          if (e.data.type === 'ERROR') {
            reject(new Error(e.data.payload?.message ?? 'Worker error'));
          } else {
            resolve((e.data.payload as HairpinResult[]) ?? []);
          }
        };

        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'DETECT_HAIRPINS', id, payload: { sequence: seq } });
      });

      setHairpinResults(results);
      const critical = results.filter(h => h.critical);
      addSystemLog({
        level: critical.length > 0 ? 'warning' : 'success',
        category: 'SYSTEM',
        message: `Hairpin detection: ${results.length} structure${results.length !== 1 ? 's' : ''} found${critical.length > 0 ? `, ${critical.length} critical (ΔG < -5 kcal/mol)` : ''}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addSystemLog({ level: 'error', category: 'SYSTEM', message: `Hairpin detection failed: ${msg}`, timestamp: Date.now() });
    } finally {
      setIsDetectingHairpins(false);
    }
  }, [worker, addSystemLog]);

  // ── TASK 2 ACTION: PCR Audit ───────────────────────────────────────────────
  const handlePCRAudit = useCallback((seq: string) => {
    addSystemLog({ level: 'info', category: 'PCR', message: `PCR audit launched with ${seq.length} bp template.`, timestamp: Date.now() });
    setPcrTemplate(seq);
  }, [addSystemLog]);

  // ── Zero state ─────────────────────────────────────────────────────────────
  if (genomeLength === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#020617' }}>
        {hasMounted ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <motion.div
              animate={{
                opacity: [0.25, 0.70, 0.25], scale: [0.93, 1.07, 0.93],
                filter: [
                  'drop-shadow(0 0 6px rgba(56,189,248,0.20))',
                  'drop-shadow(0 0 18px rgba(56,189,248,0.48))',
                  'drop-shadow(0 0 6px rgba(56,189,248,0.20))',
                ],
              }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ marginBottom: '28px' }}
            >
              <Dna size={52} strokeWidth={1.1} style={{ color: 'rgba(56,189,248,0.55)' }} />
            </motion.div>

            <p style={{
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
              fontSize: '12px', fontWeight: 700, color: '#E2E8F0',
              textTransform: 'uppercase', letterSpacing: '0.22em',
              marginBottom: '10px', textAlign: 'center',
            }}>
              Awaiting Sequence Ingestion
            </p>

            <p style={{
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
              fontSize: '10.5px', color: '#334155', textAlign: 'center',
              lineHeight: 1.8, maxWidth: '320px', marginBottom: '32px',
            }}>
              Upload a{' '}
              <span style={{ color: '#475569' }}>.fasta</span>,{' '}
              <span style={{ color: '#475569' }}>.gb</span>, or{' '}
              <span style={{ color: '#475569' }}>.vcf</span>{' '}
              file to begin sovereign analysis
            </p>

            <motion.button
              onClick={onRequestUpload}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 24px', borderRadius: '6px',
                background: 'rgba(56,189,248,0.08)',
                border: '1px solid rgba(56,189,248,0.25)',
                color: '#38BDF8', cursor: 'pointer',
                fontSize: '11.5px', fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                fontFamily: 'var(--font-jetbrains-mono, monospace)',
                transition: 'all 150ms',
              }}
            >
              <Upload size={13} />
              Load Genome File
            </motion.button>

            <div style={{ marginTop: '20px', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {['.fasta', '.fa', '.fna', '.gb', '.gbk', '.vcf', '.dna'].map((ext) => (
                <span key={ext} style={{
                  padding: '2px 7px', borderRadius: '3px',
                  background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '9.5px', color: '#1E293B',
                  fontFamily: 'var(--font-jetbrains-mono, monospace)',
                }}>
                  {ext}
                </span>
              ))}
            </div>
          </motion.div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <Dna size={48} strokeWidth={1.2} style={{ color: 'rgba(56,189,248,0.35)' }} />
            <p style={{
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
              fontSize: '11px', fontWeight: 700, color: '#334155',
              textTransform: 'uppercase', letterSpacing: '0.18em',
            }}>
              Awaiting Sequence Ingestion
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── FR-01 State Guard ──────────────────────────────────────────────────────
  if (isSlabGuardActive) {
    return (
      <RealigningOverlay
        slabVersion={slabVersion}
        slabAcknowledgedVersion={slabAcknowledgedVersion}
        hasMounted={hasMounted}
      />
    );
  }

  // ── Normal render ──────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      data-tour="sequence-editor"
      className="w-full h-full relative overflow-hidden"
      style={{ background: '#020617', cursor: isDragging ? 'text' : 'default' }}
      onClick={handleContainerClick}
      onContextMenu={handleContextMenu}
    >
      <RulerStrip basesPerRow={BASES_PER_ROW} charWidth={CHAR_WIDTH} />

      <div className="absolute inset-0 top-[28px]">
        <Virtuoso
          totalCount={rows.length}
          fixedItemHeight={ROW_HEIGHT}
          itemContent={(index) => (
            <SequenceRow
              row={rows[index]}
              selection={selection}
              onBaseMouseDown={handleBaseMouseDown}
              onBaseMouseEnter={handleBaseMouseEnter}
              onRowHover={setHoveredPosition}
            />
          )}
          rangeChanged={handleRangeChange}
          className="w-full h-full"
          style={{ overflowX: 'hidden' }}
          overscan={600}
        />
      </div>

      {/* Ghost Ribbons */}
      {syntenyAnchors.length > 0 && (
        <GhostRibbonOverlay
          containerWidth={containerRef.current?.clientWidth  ?? 800}
          containerHeight={containerRef.current?.clientHeight ?? 600}
          basesPerRow={BASES_PER_ROW}
          rowHeight={ROW_HEIGHT}
        />
      )}

      {/* Molecular Scissors */}
      {restrictionSites.length > 0 && (
        <MolecularScissorView
          containerWidth={containerRef.current?.clientWidth  ?? 800}
          containerHeight={containerRef.current?.clientHeight ?? 600}
          basesPerRow={BASES_PER_ROW}
          rowHeight={ROW_HEIGHT}
          charWidth={CHAR_WIDTH}
          isEnabled
        />
      )}

      {/* Position HUD */}
      <AnimatePresence>
        {hoveredPosition !== null && (
          <motion.div
            key="pos-hud"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit  ={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="absolute top-8 right-4 pointer-events-none z-20"
          >
            <div style={{ background: 'rgba(2,6,23,0.92)', border: '1px solid rgba(255,255,255,0.10)', backdropFilter: 'blur(16px)', borderRadius: '6px', padding: '6px 10px' }}>
              <div style={{ fontSize: '9px', fontFamily: 'var(--font-jetbrains-mono, monospace)', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '2px' }}>Position</div>
              <div style={{ fontSize: '14px', fontFamily: 'var(--font-jetbrains-mono, monospace)', fontWeight: 700, color: '#38BDF8', letterSpacing: '-0.01em', lineHeight: 1 }}>
                {hoveredPosition.toLocaleString()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection badge + right-click hint */}
      <AnimatePresence>
        {selection && selection.end > selection.start && (
          <motion.div
            key="sel-badge"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit  ={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-8 right-4 pointer-events-none z-20"
          >
            <div style={{ background: 'rgba(2,6,23,0.92)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '6px', padding: '5px 10px', backdropFilter: 'blur(16px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '11px', color: '#38BDF8' }}>
                  {(selection.end - selection.start + 1).toLocaleString()} bp selected
                </span>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: '#475569' }}>
                  {selection.start.toLocaleString()} → {selection.end.toLocaleString()}
                </span>
              </div>
              {selectedSequence.length >= 10 && (
                <div style={{ fontSize: '9px', color: '#1E293B', marginTop: 2, fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
                  Right-click for analysis options
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hairpin results badge */}
      <AnimatePresence>
        {hairpinResults && hairpinResults.length >= 0 && (
          <HairpinResultBadge
            results={hairpinResults}
            onDismiss={() => setHairpinResults(null)}
          />
        )}
      </AnimatePresence>

      {/* ThermodynamicHUD */}
      <ThermodynamicHUD sequence={selectedSequence} position={cursorPos} isVisible={showThermoHUD} />

      {/* TASK 2 — Portal Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <SequenceContextMenu
            ctx={contextMenu}
            onClose={() => setContextMenu(null)}
            onFold={handleFoldProtein}
            onHairpins={handleDetectHairpins}
            onPCRAudit={handlePCRAudit}
            isFolding={isFolding}
            isDetectingHairpins={isDetectingHairpins}
          />
        )}
      </AnimatePresence>

      {/* TASK 2 — PCR Audit Launcher */}
      <AnimatePresence>
        {pcrTemplate && (
          <PCRAuditLauncher
            template={pcrTemplate}
            onClose={() => setPcrTemplate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Ruler strip ───────────────────────────────────────────────────────────────
function RulerStrip({ basesPerRow, charWidth }: { basesPerRow: number; charWidth: number }) {
  const ticks = useMemo(() => {
    const r: number[] = [];
    for (let i = 0; i <= basesPerRow; i += 10) r.push(i);
    return r;
  }, [basesPerRow]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '28px', background: 'rgba(2,6,23,0.95)', borderBottom: '1px solid rgba(255,255,255,0.04)', zIndex: 10, userSelect: 'none' }}>
      {ticks.map((tick) => (
        <div key={tick} style={{ position: 'absolute', left: `${68 + tick * charWidth}px`, bottom: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '1px', height: '4px', background: 'rgba(255,255,255,0.12)' }} />
          {tick > 0 && (
            <span style={{ fontSize: '8px', color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono, monospace)', position: 'absolute', bottom: '6px', transform: 'translateX(-50%)' }}>
              {tick}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sequence Row ──────────────────────────────────────────────────────────────
interface SequenceRowProps {
  row: { rowNumber: number; position: number; sequence: string };
  selection: SelectionRange | null;
  onBaseMouseDown:  (absPos: number) => void;
  onBaseMouseEnter: (absPos: number) => void;
  onRowHover:       (pos: number | null) => void;
}

const SequenceRow = memo(function SequenceRow({ row, selection, onBaseMouseDown, onBaseMouseEnter, onRowHover }: SequenceRowProps) {
  const rowEnd = row.position + row.sequence.length - 1;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', height: `${ROW_HEIGHT}px`, paddingLeft: '8px' }}
      onMouseLeave={() => onRowHover(null)}
    >
      <div style={{ width: '60px', textAlign: 'right', fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: '#1E293B', userSelect: 'none', flexShrink: 0, marginRight: '8px', letterSpacing: '-0.02em' }}>
        {row.position.toLocaleString()}
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        {Array.from(row.sequence).map((base, i) => {
          const absPos    = row.position + i;
          const color     = BASE_COLORS[base] ?? BASE_COLORS.N;
          const glow      = BASE_GLOW[base]   ?? 'none';
          const isSelected = selection !== null && absPos >= selection.start && absPos <= selection.end;

          return (
            <span
              key={i}
              data-base={base}
              onMouseDown={() => onBaseMouseDown(absPos)}
              onMouseEnter={() => { onBaseMouseEnter(absPos); onRowHover(absPos); }}
              style={{
                display: 'inline-block', width: `${CHAR_WIDTH}px`, textAlign: 'center',
                color, cursor: 'text', userSelect: 'none',
                fontFamily: 'var(--font-jetbrains-mono, monospace)',
                fontSize: '13px', lineHeight: `${ROW_HEIGHT}px`,
                transition: 'filter 80ms ease, transform 80ms ease',
                ...(isSelected
                  ? { background: 'rgba(56,189,248,0.10)', boxShadow: '0 0 15px rgba(56,189,248,0.30)', borderRadius: '2px', filter: glow, transform: 'scaleY(1.05)' }
                  : { filter: glow }),
              }}
              title={`${base} @ ${absPos.toLocaleString()}`}
            >
              {base}
            </span>
          );
        })}
      </div>

      <div style={{ width: '72px', textAlign: 'right', fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: '#1E293B', userSelect: 'none', flexShrink: 0, marginLeft: '12px', letterSpacing: '-0.02em' }}>
        {rowEnd.toLocaleString()}
      </div>
    </div>
  );
});

// ── FR-01 Realigning Overlay ──────────────────────────────────────────────────
function RealigningOverlay({
  slabVersion, slabAcknowledgedVersion, hasMounted,
}: {
  slabVersion: number;
  slabAcknowledgedVersion: number;
  hasMounted: boolean;
}) {
  const versionMismatch = slabVersion !== slabAcknowledgedVersion;

  return (
    <div style={{ background: '#020617', userSelect: 'none' }} className="w-full h-full flex flex-col items-center justify-center" role="status" aria-live="polite">
      {hasMounted ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center gap-6"
        >
          <motion.div
            animate={{ opacity: [0.25, 0.90, 0.25], scale: [0.92, 1.08, 0.92] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          >
            <Dna size={52} strokeWidth={1.2} style={{ color: 'rgba(56,189,248,0.60)' }} />
          </motion.div>

          <div className="text-center">
            <p style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '11px', fontWeight: 600, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: '8px' }}>
              Re-aligning Memory…
            </p>
            <p style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: '#475569', maxWidth: '280px', lineHeight: 1.7, textAlign: 'center' }}>
              Local slab diverged from cloud state. Re-fetching sequence.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '6px', background: 'rgba(15,23,42,0.80)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}>
            {[
              { label: 'Slab',     val: `v${slabVersion}`,             color: '#94A3B8' },
              { label: '→',        val: null,                           color: '#334155' },
              { label: 'Viewport', val: `v${slabAcknowledgedVersion}`, color: versionMismatch ? '#F59E0B' : '#10B981' },
            ].map((item, i) => (
              <span key={i} style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: item.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {item.label}{item.val && ` ${item.val}`}
              </span>
            ))}
          </div>

          {versionMismatch && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={11} style={{ color: '#F59E0B', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '10px', color: '#64748B' }}>
                Version mismatch — recovery in progress
              </span>
            </motion.div>
          )}
        </motion.div>
      ) : (
        <Dna size={48} strokeWidth={1.2} style={{ color: 'rgba(56,189,248,0.40)' }} />
      )}
    </div>
  );
}