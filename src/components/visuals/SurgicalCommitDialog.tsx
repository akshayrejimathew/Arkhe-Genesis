'use client';

/**
 * src/components/visuals/SurgicalCommitDialog.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * SOVEREIGN DESIGN SYSTEM v10.2 — Abyssal Glassmorphism
 *
 * Two-phase surgical commit modal.
 *
 * Store contract:
 *   showCommitDialog        boolean          — controls visibility
 *   pendingMutation         PendingMutation | null
 *   commitMutationWithReason(msg: string)    — finalises the edit
 *   cancelPendingMutation()                  — discards the staged edit
 *
 * BaseCode map:
 *   0 → A (Adenine)   green-400
 *   1 → C (Cytosine)  sky-400
 *   2 → G (Guanine)   yellow-400
 *   3 → T (Thymine)   rose-400
 *   4 → N (blank/del) slate-500
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCommit, X, AlertTriangle, CheckCircle2, Dna } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_LABELS: Record<number, { label: string; color: string; name: string }> = {
  0: { label: 'A', color: '#4ADE80', name: 'Adenine'  },
  1: { label: 'C', color: '#38BDF8', name: 'Cytosine' },
  2: { label: 'G', color: '#FACC15', name: 'Guanine'  },
  3: { label: 'T', color: '#FB7185', name: 'Thymine'  },
  4: { label: 'N', color: '#475569', name: 'Deletion' },
};

function baseInfo(code: number) {
  return BASE_LABELS[code] ?? { label: '?', color: '#475569', name: 'Unknown' };
}

/** Derive a human-readable genomic position from slab index + offset. */
function toGlobalPosition(slabIndex: number, offset: number): number {
  // SLAB_SIZE is 1 MB by default (may vary for small/large genomes but this
  // display path can safely assume 1 048 576 — same constant used in Workbench).
  const SLAB_SIZE = 1_048_576;
  return slabIndex * SLAB_SIZE + offset;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SurgicalCommitDialog() {
  // ── Store ──────────────────────────────────────────────────────────────────
  const showCommitDialog        = useArkheStore((s: ArkheState) => s.showCommitDialog);
  const pendingMutation         = useArkheStore((s: ArkheState) => s.pendingMutation);
  const commitMutationWithReason = useArkheStore((s: ArkheState) => s.commitMutationWithReason);
  const cancelPendingMutation   = useArkheStore((s: ArkheState) => s.cancelPendingMutation);

  // ── Local state ────────────────────────────────────────────────────────────
  const [reason,    setReason]    = useState('');
  const [committing, setCommitting] = useState(false);
  const [committed,  setCommitted]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset local state every time the dialog opens.
  useEffect(() => {
    if (showCommitDialog) {
      setReason('');
      setCommitting(false);
      setCommitted(false);
      // Defer focus so the AnimatePresence mount animation doesn't fight it.
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [showCommitDialog]);

  // Keyboard: Escape → cancel, Enter → commit.
  useEffect(() => {
    if (!showCommitDialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cancelPendingMutation(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCommitDialog, reason]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCommit = useCallback(async () => {
    if (committing || !reason.trim()) return;
    setCommitting(true);
    try {
      await commitMutationWithReason(reason.trim());
      setCommitted(true);
      // The dialog will close via store (showCommitDialog → false).
      // Flash the success state briefly before the exit animation kicks in.
    } catch {
      setCommitting(false);
    }
  }, [committing, reason, commitMutationWithReason]);

  const handleCancel = useCallback(() => {
    if (committing) return;
    cancelPendingMutation();
  }, [committing, cancelPendingMutation]);

  // ── Derived display values ─────────────────────────────────────────────────
  const position  = pendingMutation
    ? toGlobalPosition(pendingMutation.slabIndex, pendingMutation.offset)
    : 0;

  const newBase   = pendingMutation ? baseInfo(pendingMutation.base) : null;
  const isDeletion = pendingMutation?.base === 4;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {showCommitDialog && pendingMutation && (
        <>
          {/* Backdrop */}
          <motion.div
            key="scd-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={handleCancel}
            style={{
              position: 'fixed', inset: 0, zIndex: 9990,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          />

          {/* Dialog */}
          <motion.div
            key="scd-panel"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.94, y: 16  }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 9991,
              width: 420,
              background: 'rgba(9, 15, 28, 0.97)',
              border: '1px solid rgba(56, 189, 248, 0.18)',
              borderRadius: 12,
              boxShadow: [
                '0 32px 64px rgba(2, 6, 23, 0.85)',
                '0 0 0 1px rgba(255, 255, 255, 0.04)',
                '0 0 32px rgba(56, 189, 248, 0.06)',
              ].join(', '),
              fontFamily: 'var(--font-jetbrains-mono, monospace)',
              overflow: 'hidden',
            }}
          >
            {/* ── Accent bar ───────────────────────────────────────────────── */}
            <div style={{
              height: 2,
              background: 'linear-gradient(90deg, #38BDF8 0%, rgba(56,189,248,0.2) 100%)',
            }} />

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div style={{
              display: 'flex', alignItems: 'flex-start',
              justifyContent: 'space-between',
              padding: '20px 24px 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 6,
                  background: 'rgba(56, 189, 248, 0.10)',
                  border: '1px solid rgba(56, 189, 248, 0.22)',
                }}>
                  <GitCommit size={14} color="#38BDF8" strokeWidth={2.5} />
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>
                    Commit Surgical Edit
                  </p>
                  <p style={{ fontSize: 9.5, color: '#475569', margin: 0, marginTop: 1 }}>
                    Staged mutation — requires commit reason
                  </p>
                </div>
              </div>

              <button
                onClick={handleCancel}
                disabled={committing}
                style={{
                  background: 'none', border: 'none', cursor: committing ? 'not-allowed' : 'pointer',
                  padding: 4, borderRadius: 4, color: '#334155',
                  transition: 'color 120ms',
                  display: 'flex', alignItems: 'center',
                }}
                onMouseEnter={e => { if (!committing) (e.currentTarget as HTMLElement).style.color = '#64748B'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#334155'; }}
              >
                <X size={14} />
              </button>
            </div>

            {/* ── Mutation details card ─────────────────────────────────────── */}
            <div style={{ padding: '16px 24px 0' }}>
              <div style={{
                padding: '14px 16px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}>
                {/* Row: Position */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 9.5, color: '#475569', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                    Position
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Dna size={10} color="#38BDF8" />
                    <span style={{ fontSize: 11, color: '#38BDF8', fontWeight: 700 }}>
                      {position.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 9.5, color: '#334155' }}>bp</span>
                  </div>
                </div>

                {/* Row: Mutation arrow */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 9.5, color: '#475569', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                    Mutation
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Old base is not available from pendingMutation (not yet read) — show position */}
                    <span style={{ fontSize: 9.5, color: '#334155', fontStyle: 'italic' }}>original</span>
                    <span style={{ color: '#1E293B', fontSize: 11 }}>→</span>
                    {/* New base */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 4,
                      background: newBase ? `${newBase.color}14` : 'transparent',
                      border: newBase ? `1px solid ${newBase.color}30` : 'none',
                    }}>
                      <span style={{
                        fontSize: 14, fontWeight: 800, lineHeight: 1,
                        color: newBase?.color ?? '#475569',
                      }}>
                        {newBase?.label ?? '?'}
                      </span>
                      <span style={{ fontSize: 8.5, color: '#475569' }}>
                        {newBase?.name ?? ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row: Slab coords (debug/audit) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9.5, color: '#475569', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                    Slab
                  </span>
                  <span style={{ fontSize: 9.5, color: '#334155', fontFamily: 'inherit' }}>
                    slab[{pendingMutation.slabIndex}]+{pendingMutation.offset.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Deletion warning */}
              {isDeletion && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '10px 12px', marginTop: 10, borderRadius: 6,
                    background: 'rgba(245, 158, 11, 0.05)',
                    border: '1px solid rgba(245, 158, 11, 0.18)',
                  }}
                >
                  <AlertTriangle size={11} color="#F59E0B" style={{ marginTop: 1.5, flexShrink: 0 }} />
                  <p style={{ fontSize: 9.5, color: '#F59E0B', margin: 0, lineHeight: 1.55 }}>
                    Deletion replaces base with <strong>N</strong>. This introduces a frameshift unless compensated. Provide a clear rationale below.
                  </p>
                </motion.div>
              )}
            </div>

            {/* ── Commit reason input ──────────────────────────────────────── */}
            <div style={{ padding: '14px 24px 0' }}>
              <label style={{
                display: 'block', fontSize: 9.5, color: '#64748B',
                letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6,
              }}>
                Commit Message <span style={{ color: '#334155' }}>(required)</span>
              </label>
              <input
                ref={inputRef}
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Correct SNP rs12345 — literature evidence ClinVar 2024"
                disabled={committing}
                maxLength={200}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: reason.trim()
                    ? '1px solid rgba(56, 189, 248, 0.30)'
                    : '1px solid rgba(255, 255, 255, 0.07)',
                  color: '#E2E8F0',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 150ms',
                  boxSizing: 'border-box',
                  opacity: committing ? 0.6 : 1,
                }}
                onFocus={e => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = 'rgba(56, 189, 248, 0.45)';
                  (e.currentTarget as HTMLInputElement).style.boxShadow   = '0 0 0 3px rgba(56, 189, 248, 0.06)';
                }}
                onBlur={e => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = reason.trim()
                    ? 'rgba(56, 189, 248, 0.30)'
                    : 'rgba(255, 255, 255, 0.07)';
                  (e.currentTarget as HTMLInputElement).style.boxShadow = 'none';
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: '#1E293B' }}>
                  ⌘↵ to commit
                </span>
                <span style={{
                  fontSize: 9, color: reason.length >= 180 ? '#F59E0B' : '#1E293B',
                  transition: 'color 200ms',
                }}>
                  {reason.length}/200
                </span>
              </div>
            </div>

            {/* ── Actions ──────────────────────────────────────────────────── */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              gap: 8, padding: '16px 24px 20px',
            }}>
              {/* Cancel */}
              <button
                onClick={handleCancel}
                disabled={committing}
                style={{
                  padding: '7px 16px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#64748B', cursor: committing ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms', letterSpacing: '0.03em',
                }}
                onMouseEnter={e => { if (!committing) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#94A3B8'; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.color = '#64748B'; }}
              >
                Cancel
              </button>

              {/* Commit */}
              <button
                onClick={handleCommit}
                disabled={committing || !reason.trim()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 18px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit',
                  background: committing || !reason.trim()
                    ? 'rgba(56, 189, 248, 0.06)'
                    : committed
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(56, 189, 248, 0.10)',
                  border: committing || !reason.trim()
                    ? '1px solid rgba(56, 189, 248, 0.10)'
                    : committed
                      ? '1px solid rgba(16, 185, 129, 0.30)'
                      : '1px solid rgba(56, 189, 248, 0.30)',
                  color: committing || !reason.trim()
                    ? '#334155'
                    : committed ? '#10B981' : '#38BDF8',
                  cursor: committing || !reason.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms',
                  fontWeight: 600, letterSpacing: '0.03em',
                  boxShadow: reason.trim() && !committing
                    ? '0 0 12px rgba(56, 189, 248, 0.08)'
                    : 'none',
                }}
                onMouseEnter={e => {
                  if (!committing && reason.trim() && !committed) {
                    (e.currentTarget as HTMLElement).style.background    = 'rgba(56, 189, 248, 0.16)';
                    (e.currentTarget as HTMLElement).style.boxShadow     = '0 0 16px rgba(56, 189, 248, 0.15)';
                    (e.currentTarget as HTMLElement).style.borderColor   = 'rgba(56, 189, 248, 0.45)';
                  }
                }}
                onMouseLeave={e => {
                  if (!committing && reason.trim() && !committed) {
                    (e.currentTarget as HTMLElement).style.background    = 'rgba(56, 189, 248, 0.10)';
                    (e.currentTarget as HTMLElement).style.boxShadow     = '0 0 12px rgba(56, 189, 248, 0.08)';
                    (e.currentTarget as HTMLElement).style.borderColor   = 'rgba(56, 189, 248, 0.30)';
                  }
                }}
              >
                {committing ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                      style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid #38BDF8', borderTopColor: 'transparent' }}
                    />
                    Committing…
                  </>
                ) : committed ? (
                  <>
                    <CheckCircle2 size={12} />
                    Committed
                  </>
                ) : (
                  <>
                    <GitCommit size={12} />
                    Commit
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}