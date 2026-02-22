'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Trash2, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useArkheStore, type ArkheState } from '@/hooks/useArkheStore';
import type { SystemLog } from '@/types/SystemLog';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface BioTerminalProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export default function BioTerminal({ isCollapsed = false, onToggle }: BioTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const terminalLogs = useArkheStore((state: ArkheState) => state.terminalLogs);
  const clearTerminalLogs = useArkheStore((state: ArkheState) => state.clearTerminalLogs);
  const executeCommand = useArkheStore((state) => state.executeTerminalCommand);
  const addTerminalOutput = useArkheStore((state) => state.addTerminalOutput);

  // Auto‑scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  const handleExport = () => {
    const logText = terminalLogs
      .map(log => `[${new Date(log.timestamp || Date.now()).toISOString()}] [${log.category}] ${log.level.toUpperCase()}: ${log.message}`)
      .join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arkhe-terminal-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setCommandHistory(prev => [...prev, input]);
    setHistoryIndex(-1);
    await executeCommand(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  // Safe mapping functions – now fully typed
  const getLevelColor = (level: SystemLog['level']) => {
    const colors: Record<SystemLog['level'], string> = {
      info: 'text-cyan-300/80',
      success: 'text-emerald-500/80',
      warning: 'text-amber-400/80',
      error: 'text-rose-500/80',
      debug: 'text-zinc-500/80',
    };
    return colors[level] || 'text-zinc-400/80';
  };

  const getLevelGlow = (level: SystemLog['level']) => {
    const glows: Record<SystemLog['level'], string> = {
      info: 'drop-shadow-glow-cyan',
      success: 'drop-shadow-glow-emerald',
      warning: 'drop-shadow-glow-amber',
      error: 'drop-shadow-glow-rose',
      debug: '',
    };
    return glows[level] || '';
  };

  const getCategoryColor = (category: SystemLog['category']) => {
    const colors: Record<SystemLog['category'], string> = {
      SYSTEM: 'text-amber-400/90',
      WORKER: 'text-cyan-400/90',
      MEMORY: 'text-blue-400/90',
      CHRONOS: 'text-purple-400/90',
      SENTINEL: 'text-rose-400/90',
      ORF: 'text-emerald-400/90',
      PCR: 'text-sky-400/90',
      REPORT: 'text-indigo-400/90',
    };
    return colors[category] || 'text-zinc-400/90';
  };

  return (
    <div className={cn(
      "w-full h-full flex flex-col bg-void-panel transition-all duration-300 relative overflow-hidden",
      isCollapsed && "w-0"
    )}>
      {/* CRT Scanline Overlay */}
      <div className="absolute inset-0 pointer-events-none z-50 crt-scanlines opacity-30" />
      
      {/* Subtle flicker effect */}
      <div className="absolute inset-0 pointer-events-none z-40 crt-flicker" />

      {/* Vignette overlay */}
      <div className="absolute inset-0 pointer-events-none z-30 bg-gradient-radial from-transparent via-transparent to-void-black/40" />

      {/* Header – Glassmorphism */}
      <div className="relative z-10 h-10 border-b border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400 drop-shadow-glow-cyan" />
          <h3 className="text-sm font-medium text-primary tracking-tight">BioTerminal</h3>
          <div className="flex items-center gap-1 ml-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse drop-shadow-glow-emerald" />
            <span className="text-[10px] text-emerald-400/80 font-mono uppercase tracking-wider">
              Online
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="p-1.5 hover:bg-white/5 rounded transition-colors backdrop-blur-sm"
            title="Export logs"
          >
            <Download size={14} className="text-zinc-400 hover:text-zinc-300" />
          </button>
          <button
            onClick={clearTerminalLogs}
            className="p-1.5 hover:bg-white/5 rounded transition-colors backdrop-blur-sm"
            title="Clear terminal"
          >
            <Trash2 size={14} className="text-zinc-400 hover:text-zinc-300" />
          </button>
        </div>
      </div>

      {/* Terminal output – CRT monitor effect */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 bg-gradient-to-b from-void/95 to-void-black/95 backdrop-blur-sm"
        style={{
          textShadow: '0 0 4px currentColor',
        }}
      >
        {terminalLogs.length === 0 ? (
          <div className="text-zinc-600 text-center py-8 animate-pulse">
            <div className="text-cyan-400/60 mb-2">⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯</div>
            <div>ARKHÉ GENESIS v1.0</div>
            <div className="text-[10px] mt-1">Terminal ready. Awaiting system events...</div>
            <div className="text-cyan-400/60 mt-2">⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯</div>
          </div>
        ) : (
          terminalLogs.map((log, index) => (
            <motion.div
              key={`${log.timestamp}-${index}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ 
                duration: 0.15,
                ease: "easeOut"
              }}
              className="flex items-start gap-2 hover:bg-white/[0.02] px-2 py-0.5 rounded group"
            >
              {/* Timestamp with glow */}
              <span className="text-zinc-600 text-[10px] w-20 flex-shrink-0 tracking-tighter font-mono">
                {new Date(log.timestamp || Date.now()).toLocaleTimeString()}
              </span>

              {/* Category badge */}
              <span className={cn(
                "text-[9px] uppercase tracking-wider font-black w-20 flex-shrink-0",
                getCategoryColor(log.category)
              )}>
                [{log.category}]
              </span>

              {/* Message with level‑based glow */}
              <span className={cn(
                "flex-1 leading-relaxed",
                getLevelColor(log.level),
                getLevelGlow(log.level)
              )}>
                {log.message}
              </span>

              {/* Level indicator dot */}
              <div className={cn(
                "w-1 h-1 rounded-full flex-shrink-0 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity",
                log.level === 'info' && "bg-cyan-400 shadow-glow-cyan",
                log.level === 'success' && "bg-emerald-500 shadow-glow-emerald",
                log.level === 'warning' && "bg-amber-400 shadow-glow-amber",
                log.level === 'error' && "bg-rose-500 shadow-glow-rose",
                log.level === 'debug' && "bg-zinc-500"
              )} />
            </motion.div>
          ))
        )}
      </div>

      {/* Command Input */}
      <div className="relative z-10 border-t border-razor bg-void-surface/80 backdrop-blur-md p-3 flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <span className="text-cyan-400 text-xs font-mono drop-shadow-glow-cyan">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command..."
            className="flex-1 bg-transparent text-xs font-mono text-cyan-300 placeholder:text-zinc-700 outline-none caret-cyan-400"
            style={{
              textShadow: '0 0 4px currentColor',
            }}
          />
          <div className="text-[10px] text-zinc-700 font-mono">
            {commandHistory.length > 0 && `↑↓ ${commandHistory.length} cmd`}
          </div>
        </form>
      </div>

      {/* Scan line animation – horizontal sweep */}
      <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
        <motion.div
          className="w-full h-px bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent"
          animate={{
            y: [0, 600, 0],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      </div>
    </div>
  );
}