'use client';

/**
 * src/components/ui/HelpOverlay.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Glassmorphism keyboard-shortcut reference modal.
 * Wired to the HelpCircle (?) button in the Workbench topbar.
 *
 * Usage:
 *   import HelpOverlay from '@/components/ui/HelpOverlay';
 *   <AnimatePresence>
 *     {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
 *   </AnimatePresence>
 */

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Keyboard, X, Zap } from 'lucide-react';

// ── Shortcut data ─────────────────────────────────────────────────────────────

interface ShortcutRow {
  keys:     string[];
  label:    string;
  category: string;
}

const SHORTCUTS: ShortcutRow[] = [
  // Layout
  { keys: ['⌘', 'B'],   label: 'Toggle Explorer sidebar',              category: 'Layout'   },
  { keys: ['⌘', 'T'],   label: 'Toggle Terminal / System Log',          category: 'Layout'   },
  { keys: ['⌘', 'G'],   label: 'Toggle Chronos history panel',          category: 'Layout'   },
  { keys: ['⌘', 'K'],   label: 'Open Command Palette',                  category: 'Layout'   },
  { keys: ['⌘', 'F'],   label: 'Focus sequence search',                 category: 'Layout'   },
  // General
  { keys: ['Esc'],       label: 'Close modal or overlay',               category: 'General'  },
  { keys: ['←', '→'],   label: 'Navigate onboarding steps',            category: 'General'  },
  // Sequence
  { keys: ['Click'],     label: 'Select base position',                 category: 'Sequence' },
  { keys: ['Drag'],      label: 'Select base range → ThermodynamicHUD', category: 'Sequence' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface HelpOverlayProps {
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HelpOverlay({ onClose }: HelpOverlayProps) {
  const categories = Array.from(new Set(SHORTCUTS.map(s => s.category)));

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         9900,
        background:     'rgba(2,6,23,0.84)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontFamily:     'var(--font-jetbrains-mono, monospace)',
      }}
    >
      <motion.div
        initial={{ scale: 0.93, y: 14, opacity: 0 }}
        animate={{ scale: 1,    y: 0,  opacity: 1 }}
        exit   ={{ scale: 0.93, y: 14, opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{
          background:     'rgba(9,15,28,0.97)',
          border:         '1px solid rgba(255,255,255,0.09)',
          borderRadius:   12,
          padding:        28,
          width:          480,
          maxHeight:      '82vh',
          overflowY:      'auto',
          boxShadow:      '0 32px 80px rgba(2,6,23,0.80), 0 0 0 1px rgba(56,189,248,0.05)',
          position:       'relative',
        }}
      >
        {/* Top-edge accent line */}
        <div
          aria-hidden="true"
          style={{
            position:   'absolute',
            top:        0,
            left:       '20%',
            right:      '20%',
            height:     1,
            background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.52), transparent)',
            borderRadius: 999,
          }}
        />

        {/* ── Header ────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 6, background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.18)' }}>
              <Keyboard size={14} style={{ color: '#38BDF8' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.02em' }}>
                Keyboard Shortcuts
              </div>
              <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 2 }}>
                Arkhé Genesis · Sovereign Reference
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts"
            style={{
              background: 'none', border: 'none', color: '#334155',
              cursor: 'pointer', padding: 6, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#64748B')}
            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Shortcut groups ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {categories.map(cat => (
            <div key={cat}>
              {/* Category label */}
              <div style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color:         '#1E293B',
                marginBottom:  8,
                paddingBottom: 5,
                borderBottom:  '1px solid rgba(255,255,255,0.04)',
              }}>
                {cat}
              </div>

              {/* Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {SHORTCUTS.filter(s => s.category === cat).map((sc, i) => (
                  <div
                    key={i}
                    style={{
                      display:         'flex',
                      alignItems:      'center',
                      justifyContent:  'space-between',
                      padding:         '7px 10px',
                      borderRadius:    6,
                      background:      'rgba(255,255,255,0.015)',
                      border:          '1px solid transparent',
                      transition:      'border-color 100ms, background 100ms',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.05)';
                      (e.currentTarget as HTMLElement).style.background  = 'rgba(255,255,255,0.028)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                      (e.currentTarget as HTMLElement).style.background  = 'rgba(255,255,255,0.015)';
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.4 }}>
                      {sc.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginLeft: 16 }}>
                      {sc.keys.map((k, ki) => (
                        <span
                          key={ki}
                          style={{
                            padding:       '2px 8px',
                            borderRadius:  4,
                            background:    'rgba(255,255,255,0.06)',
                            border:        '1px solid rgba(255,255,255,0.11)',
                            fontSize:      11,
                            fontWeight:    600,
                            color:         '#94A3B8',
                            letterSpacing: '-0.01em',
                            lineHeight:    1.6,
                            fontFamily:    'var(--font-jetbrains-mono, monospace)',
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ────────────────────────────────────────── */}
        <div style={{
          marginTop:   22,
          paddingTop:  14,
          borderTop:   '1px solid rgba(255,255,255,0.04)',
          display:     'flex',
          alignItems:  'center',
          gap:         6,
        }}>
          <Zap size={9} style={{ color: '#1E293B', flexShrink: 0 }} />
          <span style={{ fontSize: 9.5, color: '#1E293B', letterSpacing: '0.06em' }}>
            Press{' '}
            <span style={{ color: '#334155', fontWeight: 600 }}>Esc</span>
            {' '}or click outside to dismiss
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}