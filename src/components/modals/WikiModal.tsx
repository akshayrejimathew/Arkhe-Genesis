'use client';

/**
 * src/components/modals/WikiModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Sovereign Wiki Modal
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Renders the full ArkhéScript Command Codex from `/public/docs/codex.md`
 * using `react-markdown` with `remark-gfm` for GitHub-Flavored Markdown
 * (tables, strikethrough, task lists).
 *
 * MOUNTING:
 *   Add <WikiModal /> once in your root layout or workbench/page.tsx.
 *   The component self-gates via `isWikiOpen` from the Zustand store — no
 *   prop drilling, no visibility state in the parent required.
 *
 *     // app/layout.tsx  or  workbench/page.tsx
 *     import WikiModal from '@/components/modals/WikiModal';
 *     ...
 *     <WikiModal />
 *
 * OPENING:
 *   From any component (e.g. Sidebar BookOpen icon):
 *     const openWiki = useArkheStore(s => s.openWiki);
 *     <button onClick={openWiki}><BookOpen size={18} /></button>
 *
 *   From the BioTerminal (typing "help"):
 *     BioTerminal intercepts the command, prints "Redirecting to Codex...",
 *     and calls openWiki() — no manual wiring needed here.
 *
 * DEPENDENCIES:
 *   npm install react-markdown remark-gfm
 *   (or: pnpm add react-markdown remark-gfm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence }           from 'framer-motion';
import ReactMarkdown                          from 'react-markdown';
import remarkGfm                             from 'remark-gfm';
import { BookOpen, X, Loader2, AlertTriangle } from 'lucide-react';
import { useArkheStore }                      from '@/store';

// ─── Codex source path (relative to /public) ─────────────────────────────────
const CODEX_PATH = '/docs/codex.md';

// ─────────────────────────────────────────────────────────────────────────────
// § Markdown component overrides — Abyssal design system
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom renderers passed to <ReactMarkdown components={...}>.
 * Every element uses inline styles to stay consistent with the Abyssal palette
 * without importing external CSS that could conflict with the app's theme.
 */
const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {

  // Headings
  h1: ({ children }) => (
    <h1 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 20, fontWeight: 800, color: '#F1F5F9', borderBottom: '1px solid rgba(56,189,248,0.25)', paddingBottom: 10, marginBottom: 20, marginTop: 0, letterSpacing: '-0.02em' }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 15, fontWeight: 700, color: '#38BDF8', marginTop: 32, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 12, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.09em', marginTop: 20, marginBottom: 8 }}>
      {children}
    </h3>
  ),

  // Paragraphs & text
  p: ({ children }) => (
    <p style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 13, color: '#64748B', lineHeight: 1.75, marginBottom: 12, marginTop: 0 }}>
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong style={{ color: '#CBD5E1', fontWeight: 600 }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ color: '#94A3B8', fontStyle: 'italic' }}>{children}</em>
  ),

  // Horizontal rule
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.07)', margin: '24px 0' }} />
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: '3px solid #38BDF8', paddingLeft: 16, margin: '16px 0', background: 'rgba(56,189,248,0.04)', borderRadius: '0 6px 6px 0', padding: '10px 16px' }}>
      <span style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 12.5, color: '#38BDF8', fontStyle: 'italic' }}>{children}</span>
    </blockquote>
  ),

  // Inline code
  code: ({ children, className }) => {
    const isBlock = !!className;
    if (isBlock) {
      return (
        <code style={{ display: 'block', fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 11.5, color: '#4ADE80', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, overflowX: 'auto', whiteSpace: 'pre' }}>
          {children}
        </code>
      );
    }
    return (
      <code style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 11, color: '#38BDF8', background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: 4, padding: '1px 6px' }}>
        {children}
      </code>
    );
  },

  // Tables (GFM)
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 11.5 }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'rgba(56,189,248,0.07)', borderBottom: '1px solid rgba(56,189,248,0.20)' }}>
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#38BDF8', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  ),
  tbody: ({ children }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      {children}
    </tr>
  ),
  td: ({ children }) => (
    <td style={{ padding: '7px 12px', color: '#64748B', verticalAlign: 'top', lineHeight: 1.6 }}>
      {children}
    </td>
  ),

  // Lists
  ul: ({ children }) => (
    <ul style={{ paddingLeft: 20, marginBottom: 12, color: '#64748B', fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 13, lineHeight: 1.75 }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{ paddingLeft: 20, marginBottom: 12, color: '#64748B', fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 13, lineHeight: 1.75 }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: 4 }}>{children}</li>
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// § WikiModal — Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function WikiModal() {
  const isWikiOpen = useArkheStore(s => s.isWikiOpen);
  const closeWiki  = useArkheStore(s => s.closeWiki);

  const [markdown, setMarkdown]   = useState<string>('');
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState<string | null>(null);

  // ── Fetch codex.md when the modal opens ──────────────────────────────────
  useEffect(() => {
    if (!isWikiOpen) return;
    if (markdown)    return; // already fetched — don't re-fetch on re-open

    setLoading(true);
    setError(null);

    fetch(CODEX_PATH)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load codex (${res.status})`);
        return res.text();
      })
      .then(text  => setMarkdown(text))
      .catch(err  => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [isWikiOpen, markdown]);

  // ── Keyboard dismiss ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isWikiOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWiki(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isWikiOpen, closeWiki]);

  return (
    <AnimatePresence>
      {isWikiOpen && (
        /* ── Backdrop ── */
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
            background:     'rgba(2,6,23,0.90)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            padding:        '24px 16px',
          }}
        >
          {/* ── Modal panel — click stops propagation ── */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1.00 }}
            exit={{   opacity: 0, y: 12,  scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            onClick={e => e.stopPropagation()}
            style={{
              position:       'relative',
              width:          '100%',
              maxWidth:       '820px',
              maxHeight:      '88vh',
              display:        'flex',
              flexDirection:  'column',
              background:     'rgba(9,15,28,0.98)',
              backdropFilter: 'blur(32px) saturate(200%)',
              WebkitBackdropFilter: 'blur(32px) saturate(200%)',
              border:         '1px solid rgba(255,255,255,0.08)',
              borderTop:      '2px solid #38BDF8',
              borderRadius:   14,
              boxShadow:
                '0 40px 120px rgba(2,6,23,0.85), ' +
                '0 0 0 1px rgba(56,189,248,0.08), ' +
                '0 0 60px rgba(56,189,248,0.06)',
              overflow:       'hidden',
            }}
          >

            {/* ── Top accent glow ── */}
            <div style={{ position: 'absolute', top: -32, left: '20%', right: '20%', height: 56, background: 'radial-gradient(ellipse, rgba(56,189,248,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

            {/* ── Header ── */}
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                padding:        '14px 22px',
                borderBottom:   '1px solid rgba(255,255,255,0.07)',
                background:     'rgba(13,27,46,0.85)',
                backdropFilter: 'blur(16px)',
                flexShrink:     0,
                position:       'relative',
                zIndex:         1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Icon */}
                <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.22)', color: '#38BDF8', flexShrink: 0 }}>
                  <BookOpen size={16} />
                </div>
                {/* Titles */}
                <div>
                  <h1 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 14, fontWeight: 700, color: '#F1F5F9', margin: 0, letterSpacing: '-0.01em' }}>
                    Sovereign Research Handbook
                  </h1>
                  <p style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 9.5, color: '#334155', margin: 0, textTransform: 'uppercase', letterSpacing: '0.09em', marginTop: 1 }}>
                    ArkhéScript Command Codex · Sovereign Edition v1.0
                  </p>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={closeWiki}
                title="Close (Esc)"
                style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.05)', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,113,133,0.12)'; e.currentTarget.style.color = '#FB7185'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#475569'; }}
              >
                <X size={14} />
              </button>
            </div>

            {/* ── Body: loading / error / content ── */}
            <div
              style={{
                overflowY:  'auto',
                flexGrow:   1,
                padding:    '28px 28px 32px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(56,189,248,0.20) transparent',
              }}
            >

              {/* Loading state */}
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, gap: 14 }}>
                  <Loader2
                    size={22}
                    style={{ color: '#38BDF8', animation: 'spin 1s linear infinite' }}
                  />
                  <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 11, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                    Loading Command Codex…
                  </span>
                </div>
              )}

              {/* Error state */}
              {!loading && error && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px', background: 'rgba(251,113,133,0.06)', border: '1px solid rgba(251,113,133,0.18)', borderRadius: 8 }}>
                  <AlertTriangle size={18} style={{ color: '#FB7185', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 12, color: '#FB7185', fontWeight: 700, margin: 0, marginBottom: 4 }}>
                      Failed to load codex
                    </p>
                    <p style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 12, color: '#64748B', margin: 0 }}>
                      {error}
                    </p>
                    <p style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 11.5, color: '#475569', margin: 0, marginTop: 8 }}>
                      Ensure <code style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', color: '#38BDF8', fontSize: 11, background: 'rgba(56,189,248,0.08)', padding: '1px 5px', borderRadius: 3 }}>public/docs/codex.md</code> exists in your project root.
                    </p>
                  </div>
                </div>
              )}

              {/* Markdown content */}
              {!loading && !error && markdown && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={MD_COMPONENTS}
                >
                  {markdown}
                </ReactMarkdown>
              )}
            </div>

            {/* ── Footer ── */}
            <div style={{ padding: '10px 22px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(13,27,46,0.60)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 9.5, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                Esc to close · /docs/codex.md
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 9.5, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                Arkhé Genesis · Sovereign Edition
              </span>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}