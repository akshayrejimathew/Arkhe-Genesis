'use client';

/**
 * BioTerminal.tsx — Sovereign Edition
 * ──────────────────────────────────────────────────────────────────────────────
 * The System Log: real-time genomic engine output stream.
 *
 * SOVEREIGN DESIGN MANDATES:
 *   • All text in `var(--font-jetbrains-mono)` — zero font fallback drift.
 *   • Abyssal background (#020617) — deeper than the Workbench chrome.
 *   • Single accent color (#38BDF8) with level-specific semantic tones.
 *   • Category badges as micro-typography chips (all-caps, 9px, letter-spacing).
 *   • Log entries enter with a minimal 80ms fade-in-right — clinical, not theatrical.
 *   • NO CRT flicker / scanlines — those were retro aesthetics, now removed.
 *   • Glass topbar with backdrop-blur for depth without heaviness.
 *
 * ── GENESIS RECTIFICATION SPRINT 3 — ABYSSAL UX ─────────────────────────────
 *   TASK 1: Virtualized log list via `react-virtuoso` — only 30 visible lines
 *           are rendered, even with 10,000 entries.
 *   TASK 3: `will-change: transform` applied to the terminal container,
 *           offloading blur/chromatic aberration effects to the GPU.
 *
 * ── SOUL INTEGRATION SPRINT ───────────────────────────────────────────────────
 *   TASK 1 (final): Help command → Wiki Modal redirect
 *     • Typing "help" is intercepted BEFORE executeCommand() is called.
 *     • Two log lines are injected:
 *         ❯ help                      (debug / muted)
 *         📖 Redirecting to Codex...  (success / green glow)
 *     • openWiki() fires 80 ms later so the log lines render first.
 *     • Placeholder updated to: "Type 'help' to begin your research..."
 *     • Esc key clears the input field.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import { Terminal, Trash2, Download, Copy, ChevronDown, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useArkheStore, type ArkheState } from '@/store';
import type { SystemLog } from '@/store/types';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

const ITEM_HEIGHT = 24; // px — height of each virtualized log row

// ─── Level color tokens ───────────────────────────────────────────────────────
const LEVEL_COLOR: Record<SystemLog['level'], string> = {
  info:    '#94A3B8',   // slate-400
  success: '#4ADE80',   // green-400
  warning: '#FACC15',   // yellow-400
  error:   '#FB7185',   // rose-400
  debug:   '#475569',   // slate-600
};

const LEVEL_GLOW: Record<SystemLog['level'], string> = {
  info:    '',
  success: 'drop-shadow-[0_0_5px_rgba(74,222,128,0.40)]',
  warning: 'drop-shadow-[0_0_5px_rgba(250,204,21,0.35)]',
  error:   'drop-shadow-[0_0_5px_rgba(251,113,133,0.45)]',
  debug:   '',
};

const LEVEL_DOT: Record<SystemLog['level'], string> = {
  info:    '#38BDF8',
  success: '#4ADE80',
  warning: '#FACC15',
  error:   '#FB7185',
  debug:   '#334155',
};

// ─── Category color tokens ────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<SystemLog['category'], string> = {
  SYSTEM:   '#38BDF8',   // sky-400
  WORKER:   '#818CF8',   // indigo-400
  MEMORY:   '#34D399',   // emerald-400
  CHRONOS:  '#A78BFA',   // violet-400
  SENTINEL: '#FACC15',   // yellow-400
  ORF:      '#F472B6',   // pink-400
  PCR:      '#4ADE80',   // green-400
  REPORT:   '#94A3B8',   // slate-400
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTs(ts: number): string {
  const d = new Date(ts);
  return (
    d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0') + ':' +
    d.getSeconds().toString().padStart(2, '0') + '.' +
    d.getMilliseconds().toString().padStart(3, '0')
  );
}

// ─── LogEntry (memoized, rendered by Virtuoso) ────────────────────────────────
const LogEntry = memo(function LogEntry({
  log,
  index,
}: {
  log:   SystemLog;
  index: number;
}) {
  const color    = LEVEL_COLOR[log.level]       ?? '#94A3B8';
  const glow     = LEVEL_GLOW[log.level]        ?? '';
  const dotColor = LEVEL_DOT[log.level]         ?? '#334155';
  const catColor = CATEGORY_COLOR[log.category] ?? '#64748B';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.08, ease: 'easeOut' }}
      className={cn(
        'flex items-start gap-2 px-3 py-[3px] group',
        'hover:bg-[rgba(255,255,255,0.025)] transition-colors duration-75 rounded-[3px]',
      )}
    >
      {/* Level dot — visible on row hover only */}
      <div
        className="w-1 h-1 rounded-full shrink-0 mt-[5px] opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: dotColor, boxShadow: `0 0 4px ${dotColor}80` }}
      />

      {/* Timestamp */}
      <span
        className="text-[10px] tabular-nums shrink-0 select-none"
        style={{ color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono), monospace', minWidth: '78px' }}
      >
        {formatTs(log.timestamp ?? Date.now())}
      </span>

      {/* Category chip */}
      <span
        className="text-[9px] font-bold uppercase tracking-[0.10em] shrink-0 select-none"
        style={{ color: catColor, fontFamily: 'var(--font-jetbrains-mono), monospace', minWidth: '60px' }}
      >
        {log.category}
      </span>

      {/* Message */}
      <span
        className={cn('text-[11.5px] flex-1 leading-[1.55]', glow)}
        style={{ color, fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        {log.message}
      </span>
    </motion.div>
  );
});

// ─── Empty state ──────────────────────────────────────────────────────────────
function TerminalEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full pb-8 select-none">
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-3"
        style={{ color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        ─────────────────────────────
      </div>
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.10em]"
        style={{ color: '#334155', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        Arkhé Genesis v1.0
      </p>
      <p className="text-[10px] mt-1.5"
        style={{ color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        Terminal ready · type{' '}
        <span style={{ color: '#38BDF8' }}>&apos;help&apos;</span>
        {' '}to begin your research…
      </p>
      <div
        className="text-[10px] uppercase tracking-[0.14em] mt-3"
        style={{ color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        ─────────────────────────────
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface BioTerminalProps {
  isCollapsed?: boolean;
  onToggle?:    () => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BioTerminal({ isCollapsed = false, onToggle }: BioTerminalProps) {
  const virtuosoRef = useRef<any>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  const [input,      setInput]      = useState('');
  const [history,    setHistory]    = useState<string[]>([]);
  const [histIdx,    setHistIdx]    = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);

  // ── Store subscriptions ───────────────────────────────────────────────────
  const terminalLogs     = useArkheStore((s: ArkheState) => s.terminalLogs);
  const clearTerminalLogs = useArkheStore((s: ArkheState) => s.clearTerminalLogs);
  const executeCommand    = useArkheStore(s => s.executeTerminalCommand);
  const addSystemLog      = useArkheStore(s => s.addSystemLog);

  // SOUL INTEGRATION TASK 1 — needed to open the Wiki Modal from "help"
  const openWiki = useArkheStore(s => s.openWiki);

  // ── Auto-scroll on new log entries ───────────────────────────────────────
  useEffect(() => {
    if (autoScroll && virtuosoRef.current && terminalLogs.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index:    terminalLogs.length - 1,
        behavior: 'smooth',
      });
    }
  }, [terminalLogs, autoScroll]);

  // ── Detect manual scroll to disable auto-scroll ──────────────────────────
  const handleScroll = useCallback((e: any) => {
    const { scrollTop, scrollHeight, viewportHeight } = e;
    setAutoScroll(scrollHeight - scrollTop - viewportHeight < 30);
  }, []);

  // ── Export log as .log file ───────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const text = terminalLogs
      .map(l =>
        `[${new Date(l.timestamp ?? Date.now()).toISOString()}] [${l.category}] ${l.level.toUpperCase()}: ${l.message}`,
      )
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `arkhe-terminal-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [terminalLogs]);

  // ── Copy all log messages to clipboard ───────────────────────────────────
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(
      terminalLogs.map(l => `${l.category} ${l.message}`).join('\n'),
    );
  }, [terminalLogs]);

  // ── Submit command ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    // Push to local history and reset the history cursor
    setHistory(prev => [...prev, trimmed]);
    setHistIdx(-1);
    setInput('');
    setAutoScroll(true);

    // ── SOUL INTEGRATION TASK 1: Intercept "help" ─────────────────────────
    //
    // Instead of forwarding to executeCommand() we:
    //   1. Echo the typed command in debug colour (muted slate).
    //   2. Print "📖 Redirecting to Codex..." in success colour (green glow).
    //   3. Call openWiki() after a short delay so the log lines paint first.
    //
    // No worker round-trip — no engine involvement at all.
    if (trimmed.toLowerCase() === 'help') {
      const now = Date.now();

      addSystemLog({
        timestamp: now,
        category:  'SYSTEM',
        message:   `❯ ${trimmed}`,
        level:     'debug',   // muted slate — echoed input
      });

      addSystemLog({
        timestamp: now + 1,
        category:  'SYSTEM',
        message:   '📖 Redirecting to Codex...',
        level:     'success', // green glow — confirmation
      });

      // 80 ms delay lets the two log lines render before the modal overlays
      setTimeout(openWiki, 80);
      return;
    }

    // ── All other commands: forward to the engine via the store ──────────
    await executeCommand(trimmed);
  }, [input, executeCommand, addSystemLog, openWiki]);

  // ── History navigation + Esc ──────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setInput('');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[history.length - 1 - next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx > 0) {
        const next = histIdx - 1;
        setHistIdx(next);
        setInput(history[history.length - 1 - next]);
      } else {
        setHistIdx(-1);
        setInput('');
      }
    }
  }, [history, histIdx]);

  // ── Scroll-to-bottom button handler ──────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index:    terminalLogs.length - 1,
      behavior: 'smooth',
    });
    setAutoScroll(true);
  }, [terminalLogs.length]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        'w-full h-full flex flex-col overflow-hidden relative',
        isCollapsed && 'w-0',
      )}
      style={{
        background: '#020617',
        willChange: 'transform', // GPU offload for backdrop-filter children
      }}
    >
      {/* ── Glass header ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height:               '38px',
          background:           'rgba(13,27,46,0.85)',
          backdropFilter:       'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom:         '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center gap-2">
          <Terminal size={13} style={{ color: '#38BDF8' }} />
          <span
            className="text-[11px] font-semibold"
            style={{ color: '#E2E8F0', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
          >
            BioTerminal
          </span>

          {/* Online pulse indicator */}
          <div className="flex items-center gap-1.5 ml-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: '#4ADE80',
                boxShadow:  '0 0 5px rgba(74,222,128,0.55)',
                animation:  'pulse 2.5s ease-in-out infinite',
              }}
            />
            <span
              className="text-[9.5px] uppercase tracking-[0.08em]"
              style={{ color: '#34D399', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
            >
              Online
            </span>
          </div>

          {/* Log entry count badge */}
          {terminalLogs.length > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-[3px] text-[9px] tabular-nums"
              style={{
                background: 'rgba(56,189,248,0.10)',
                color:      '#38BDF8',
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                border:     '1px solid rgba(56,189,248,0.20)',
              }}
            >
              {terminalLogs.length}
            </span>
          )}
        </div>

        {/* Header action buttons */}
        <div className="flex items-center gap-0.5">
          {[
            { icon: <Copy     size={12} />, fn: handleCopy,        title: 'Copy all'   },
            { icon: <Download size={12} />, fn: handleExport,      title: 'Export log' },
            { icon: <Trash2   size={12} />, fn: clearTerminalLogs, title: 'Clear'      },
            ...(onToggle
              ? [{ icon: <X size={12} />, fn: onToggle, title: 'Close' }]
              : []),
          ].map((btn, i) => (
            <button
              key={i}
              onClick={btn.fn}
              title={btn.title}
              className="p-1.5 rounded transition-colors text-[#334155] hover:text-[#64748B] hover:bg-[rgba(255,255,255,0.05)]"
            >
              {btn.icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── Virtualized log output ───────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden" style={{ background: '#020617' }}>
        {terminalLogs.length === 0 ? (
          <TerminalEmpty />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={terminalLogs}
            totalCount={terminalLogs.length}
            fixedItemHeight={ITEM_HEIGHT}
            itemContent={(index, log) => <LogEntry log={log} index={index} />}
            onScroll={handleScroll}
            overscan={200}
            style={{ height: '100%', width: '100%' }}
          />
        )}
      </div>

      {/* ── Scroll-to-bottom floating button ─────────────────────────────── */}
      <AnimatePresence>
        {!autoScroll && terminalLogs.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{   opacity: 0, y: 6 }}
            onClick={scrollToBottom}
            className="absolute bottom-14 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all"
            style={{
              background:     'rgba(56,189,248,0.15)',
              border:         '1px solid rgba(56,189,248,0.30)',
              backdropFilter: 'blur(8px)',
              boxShadow:      '0 0 12px rgba(56,189,248,0.12)',
            }}
          >
            <ChevronDown size={11} style={{ color: '#38BDF8' }} />
            <span
              className="text-[10px]"
              style={{ color: '#38BDF8', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
            >
              scroll to bottom
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Command input bar ────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{
          background:           'rgba(13,27,46,0.80)',
          borderTop:            '1px solid rgba(255,255,255,0.06)',
          backdropFilter:       'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {/* Prompt sigil */}
        <span
          className="text-[13px] shrink-0 select-none"
          style={{ color: '#38BDF8', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
        >
          ❯
        </span>

        {/* Text input — SOUL INTEGRATION: placeholder updated */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type 'help' to begin your research..."
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none placeholder:text-[#1E293B]"
          style={{
            color:      '#94A3B8',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontSize:   '12px',
            caretColor: '#38BDF8',
          }}
        />

        {/* History count hint */}
        {history.length > 0 && (
          <span
            className="text-[9.5px] tabular-nums shrink-0 select-none"
            style={{ color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
          >
            ↑↓ {history.length}
          </span>
        )}

        {/* Blinking cursor decoration (hidden when user is typing) */}
        <span
          className="text-[12px] shrink-0 select-none"
          style={{
            color:      '#38BDF8',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            animation:  'terminal-cursor 1.1s step-end infinite',
            opacity:    input ? 0 : 1,
          }}
        >
          ▌
        </span>
      </form>
    </div>
  );
}