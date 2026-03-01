'use client';

/**
 * src/components/modals/SurgicalCommitDialog.tsx
 * ──────────────────────────────────────────────────────────────
 * SOVEREIGN ALIGNMENT — GHOST DIALOG (Fix #4)
 * MICRO-FIX — BaseCode number → string label (Phase 2 patch)
 *
 * TypeScript error fixed:
 *   `Type 'string | number' is not assignable to type 'string'`
 *
 * Root cause: pendingMutation.base is BaseCode = 0 | 1 | 2 | 3 | 4
 *   (engine numeric encoding). BaseBadge required a string label.
 *
 * Fix: BASE_CODE_TO_LABEL converts at the component boundary, before
 * any downstream usage. All consumers (BaseBadge, color map) see
 * strings only.
 *
 *   0 → 'A'  Adenine
 *   1 → 'C'  Cytosine
 *   2 → 'G'  Guanine
 *   3 → 'T'  Thymine
 *   4 → 'N'  Unknown / any
 *   _  → '?' defensive fallback
 * ──────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Scissors, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useArkheStore } from '@/store';
import type { BaseCode } from '@/types/arkhe';

// ─────────────────────────────────────────────────────────────────────────────
// § BaseCode → display label
// ─────────────────────────────────────────────────────────────────────────────

const BASE_CODE_TO_LABEL: Record<number, string> = {
  0: 'A',
  1: 'C',
  2: 'G',
  3: 'T',
  4: 'N',
};

function baseCodeToLabel(code: BaseCode): string {
  return BASE_CODE_TO_LABEL[code] ?? '?';
}

// ─────────────────────────────────────────────────────────────────────────────
// § Colour palette — keyed by string label
// ─────────────────────────────────────────────────────────────────────────────

const BASE_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  A: { bg: 'rgba(74, 222, 128, 0.12)',  text: '#4ADE80', glow: 'rgba(74, 222, 128, 0.30)'  },
  T: { bg: 'rgba(251, 113, 133, 0.12)', text: '#FB7185', glow: 'rgba(251, 113, 133, 0.30)' },
  C: { bg: 'rgba(56, 189, 248, 0.12)',  text: '#38BDF8', glow: 'rgba(56, 189, 248, 0.30)'  },
  G: { bg: 'rgba(250, 204, 21, 0.12)',  text: '#FACC15', glow: 'rgba(250, 204, 21, 0.30)'  },
  N: { bg: 'rgba(100, 116, 139, 0.12)', text: '#64748B', glow: 'rgba(100, 116, 139, 0.20)' },
};

const COLOR_FALLBACK = { bg: 'rgba(255,255,255,0.06)', text: '#94A3B8', glow: 'transparent' };

// ─────────────────────────────────────────────────────────────────────────────
// § BaseBadge — accepts `string` only; mapping done before this call
// ─────────────────────────────────────────────────────────────────────────────

function BaseBadge({ base }: { base: string }) {
  const c = BASE_COLORS[base] ?? COLOR_FALLBACK;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '28px', height: '28px', borderRadius: '4px',
      background: c.bg, border: `1px solid ${c.glow}`, color: c.text,
      fontFamily: 'var(--font-jetbrains-mono, monospace)',
      fontSize: '13px', fontWeight: 700,
      boxShadow: `0 0 8px ${c.glow}`, flexShrink: 0,
    }}>
      {base}
    </span>
  );
}

function MetaLabel({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <span style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#334155', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
        {label}
      </span>
      <span style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'var(--font-jetbrains-mono, monospace)', fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}

const MIN_REASON = 4;
const MAX_REASON = 280;

export default function SurgicalCommitDialog() {
  const showCommitDialog         = useArkheStore((s) => s.showCommitDialog);
  const pendingMutation          = useArkheStore((s) => s.pendingMutation);
  const commitMutationWithReason = useArkheStore((s) => s.commitMutationWithReason);
  const cancelPendingMutation    = useArkheStore((s) => s.cancelPendingMutation);
  const isLocked                 = useArkheStore((s) => s.isLocked);

  const [reason,       setReason]       = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [committed,    setCommitted]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── THE FIX: convert numeric BaseCode to string at the boundary ────────────
  const baseLabel: string = pendingMutation ? baseCodeToLabel(pendingMutation.base) : '?';
  const baseColor = BASE_COLORS[baseLabel] ?? COLOR_FALLBACK;

  useEffect(() => {
    if (showCommitDialog) {
      setReason(''); setError(null); setCommitted(false); setIsSubmitting(false);
      const t = setTimeout(() => textareaRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [showCommitDialog]);

  useEffect(() => {
    if (!showCommitDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleCommit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCommitDialog, reason]);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;
    cancelPendingMutation();
    setReason(''); setError(null);
  }, [cancelPendingMutation, isSubmitting]);

  const handleCommit = useCallback(async () => {
    const t = reason.trim();
    if (t.length < MIN_REASON) { setError(`Reason must be at least ${MIN_REASON} characters.`); textareaRef.current?.focus(); return; }
    if (t.length > MAX_REASON) { setError(`Reason must be at most ${MAX_REASON} characters.`); return; }
    setError(null); setIsSubmitting(true);
    try {
      await commitMutationWithReason(t);
      setCommitted(true);
      setTimeout(() => { setReason(''); setCommitted(false); }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed. Please retry.');
      setIsSubmitting(false);
    }
  }, [commitMutationWithReason, reason]);

  const charCount = reason.length;
  const isValid   = reason.trim().length >= MIN_REASON;
  const busy      = isSubmitting || committed || isLocked;

  return (
    <AnimatePresence>
      {showCommitDialog && pendingMutation && (
        <>
          {/* Backdrop */}
          <motion.div
            key="scd-bd"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={handleCancel}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', cursor: 'pointer' }}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="scd-panel"
            role="dialog" aria-modal="true" aria-labelledby="scd-title"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.94,  y: 8  }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 9999, width: 'min(480px, calc(100vw - 32px))',
              background: 'rgba(9,15,28,0.97)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px',
              backdropFilter: 'blur(48px)', WebkitBackdropFilter: 'blur(48px)',
              boxShadow: '0 24px 80px rgba(2,6,23,0.85), 0 0 0 1px rgba(56,189,248,0.07)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Top accent stripe — colour derived from the target base */}
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: '15%', right: '15%', height: '1px', background: `linear-gradient(90deg,transparent,${baseColor.glow},transparent)` }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Scissors size={13} style={{ color: '#38BDF8', flexShrink: 0 }} strokeWidth={1.5} />
                <span id="scd-title" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#94A3B8', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
                  Surgical Commit
                </span>
              </div>
              <button
                onClick={handleCancel} disabled={isSubmitting} aria-label="Cancel and close"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '4px', border: '1px solid transparent', background: 'transparent', color: '#475569', cursor: isSubmitting ? 'not-allowed' : 'pointer', transition: 'all 150ms', flexShrink: 0 }}
                className="hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.08)] hover:text-[#94A3B8] disabled:opacity-40"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>

            {/* Mutation detail card */}
            <div style={{ margin: '16px 20px 0', padding: '14px 16px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ display: 'block', fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono, monospace)', marginBottom: '12px' }}>
                Staged Mutation
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                <MetaLabel label="Slab"   value={`#${String(pendingMutation.slabIndex).padStart(2, '0')}`} />
                <MetaLabel label="Offset" value={String(pendingMutation.offset).padStart(6, '0')} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#334155', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
                    New Base
                  </span>
                  {/* ✓ baseLabel is now a string — TypeScript error resolved */}
                  <BaseBadge base={baseLabel} />
                </div>
                {pendingMutation.meta?.branch && (
                  <MetaLabel label="Branch" value={pendingMutation.meta.branch} />
                )}
              </div>
              {pendingMutation.meta?.isCheckpoint && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '4px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)' }}>
                  <CheckCircle2 size={11} style={{ color: '#38BDF8', flexShrink: 0 }} strokeWidth={2} />
                  <span style={{ fontSize: '9.5px', color: '#38BDF8', fontFamily: 'var(--font-jetbrains-mono, monospace)', letterSpacing: '0.04em' }}>
                    This commit will be marked as a restorable checkpoint.
                  </span>
                </div>
              )}
            </div>

            {/* Reason input */}
            <div style={{ padding: '16px 20px 0' }}>
              <label htmlFor="scd-reason" style={{ display: 'block', fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#334155', fontFamily: 'var(--font-jetbrains-mono, monospace)', marginBottom: '8px' }}>
                Commit Reason <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                id="scd-reason" ref={textareaRef}
                value={reason} onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
                disabled={busy} placeholder="Describe the biological rationale for this base substitution…"
                rows={3} maxLength={MAX_REASON}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.025)', border: error ? '1px solid rgba(239,68,68,0.40)' : '1px solid rgba(255,255,255,0.07)', color: '#E2E8F0', fontSize: '12px', lineHeight: '1.6', fontFamily: 'var(--font-jetbrains-mono, monospace)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms', minHeight: '72px', maxHeight: '160px', display: 'block', opacity: busy ? 0.5 : 1 }}
                className="focus:border-[rgba(56,189,248,0.45)] placeholder:text-[#1E293B]"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '6px', minHeight: '16px' }}>
                {error ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <AlertTriangle size={10} style={{ color: '#EF4444', flexShrink: 0 }} />
                    <span style={{ fontSize: '9.5px', color: '#F87171', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>{error}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: '9.5px', color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono, monospace)', letterSpacing: '0.04em' }}>
                    Ctrl+Enter to commit
                  </span>
                )}
                <span style={{ fontSize: '9.5px', color: charCount > MAX_REASON * 0.9 ? '#F59E0B' : '#334155', fontFamily: 'var(--font-jetbrains-mono, monospace)', flexShrink: 0, marginLeft: '8px' }}>
                  {charCount}/{MAX_REASON}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '16px' }}>
              <button
                onClick={handleCancel} disabled={busy}
                style={{ padding: '9px 16px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#64748B', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono, monospace)', cursor: busy ? 'not-allowed' : 'pointer', transition: 'all 150ms' }}
                className="hover:bg-[rgba(255,255,255,0.04)] hover:text-[#94A3B8] hover:border-[rgba(255,255,255,0.12)] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCommit()}
                disabled={!isValid || busy}
                style={{
                  display: 'flex', alignItems: 'center', gap: '7px',
                  padding: '9px 20px', borderRadius: '5px', border: 'none',
                  background: committed ? 'rgba(16,185,129,0.85)' : (!isValid || busy) ? 'rgba(56,189,248,0.15)' : '#38BDF8',
                  color:      committed ? '#F8FAFC' : (!isValid || busy) ? 'rgba(56,189,248,0.45)' : '#020617',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  fontFamily: 'var(--font-jetbrains-mono, monospace)',
                  cursor: (!isValid || busy) ? 'not-allowed' : 'pointer', transition: 'all 150ms',
                  boxShadow: isValid && !busy ? '0 0 16px rgba(56,189,248,0.25),0 2px 8px rgba(2,6,23,0.40)' : 'none',
                }}
              >
                {committed   ? <><CheckCircle2 size={12} strokeWidth={2} />Committed</>
                : isSubmitting ? <><Loader2 size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />Committing…</>
                :               <><Scissors size={12} strokeWidth={1.8} />Commit Mutation</>}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}