'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Settings,
  HelpCircle,
  Keyboard,
  CreditCard,
  User,
  LogOut,
  FileText,
  Database,
  Shield,
  Terminal,
  Command,
} from 'lucide-react';
import { useArkheStore } from '@/store';
import { supabase } from '@/lib/supabase';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * COMMAND PALETTE - Ctrl+K Interface
 * Phase 6: handleCommandSelect is now wired to the Zustand store and Supabase auth.
 *
 *   terminal  → executeTerminalCommand('help')
 *   explorer  → no-op nav hint (expand left sidebar is driven by Workbench parent state;
 *               here we fire a custom event so Workbench can listen if desired)
 *   database  → opens the database panel (custom event)
 *   sentinel  → opens the sentinel panel (custom event)
 *   logout    → supabase.auth.signOut() then redirect to /login
 *   others    → logged via addSystemLog so they appear in the terminal
 */
export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query,    setQuery]    = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Store actions ───────────────────────────────────────────────────────────
  const executeTerminalCommand = useArkheStore.getState().executeTerminalCommand;
  const addSystemLog           = useArkheStore.getState().addSystemLog;

  const commands = [
    { id: 'settings',  icon: Settings,  label: 'Settings',               shortcut: '⌘,' },
    { id: 'help',      icon: HelpCircle, label: 'Help & Documentation',    shortcut: '?' },
    { id: 'shortcuts', icon: Keyboard,  label: 'Keyboard Shortcuts',      shortcut: '⌘K' },
    { id: 'billing',   icon: CreditCard, label: 'Subscription & Billing',  shortcut: null },
    { id: 'profile',   icon: User,       label: 'Profile Settings',        shortcut: null },
    { id: 'terminal',  icon: Terminal,   label: 'Open Terminal',           shortcut: '⌘T' },
    { id: 'explorer',  icon: FileText,   label: 'Toggle Explorer',         shortcut: '⌘E' },
    { id: 'database',  icon: Database,   label: 'Database Connections',    shortcut: '⌘D' },
    { id: 'sentinel',  icon: Shield,     label: 'Security Scan',           shortcut: '⌘S' },
    { id: 'logout',    icon: LogOut,     label: 'Sign Out',                shortcut: null },
  ];

  const filteredCommands = commands.filter(cmd =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // ── Command dispatch ────────────────────────────────────────────────────────
  const handleCommandSelect = useCallback((commandId: string) => {
    onClose();

    switch (commandId) {
      // ── Terminal: print the help tree ──────────────────────────────────────
      case 'terminal':
        executeTerminalCommand('help').catch((err: unknown) => {
          console.error('[CommandPalette] terminal command failed:', err);
        });
        break;

      // ── Sign out ───────────────────────────────────────────────────────────
      case 'logout':
        supabase.auth.signOut().finally(() => {
          window.location.href = '/login';
        });
        break;

      // ── Panel navigation — dispatch a custom DOM event that Workbench or   ─
      // ── any subscriber can intercept to update left-panel state.           ─
      case 'explorer':
        window.dispatchEvent(new CustomEvent('arkhe:openPanel', { detail: { panel: 'explorer' } }));
        addSystemLog({
          level: 'info',
          category: 'SYSTEM' as any,
          message: 'Explorer panel activated.',
          timestamp: Date.now(),
        });
        break;

      case 'database':
        window.dispatchEvent(new CustomEvent('arkhe:openPanel', { detail: { panel: 'database' } }));
        addSystemLog({
          level: 'info',
          category: 'SYSTEM' as any,
          message: 'Database panel activated.',
          timestamp: Date.now(),
        });
        break;

      case 'sentinel':
        window.dispatchEvent(new CustomEvent('arkhe:openPanel', { detail: { panel: 'sentinel' } }));
        addSystemLog({
          level: 'info',
          category: 'SENTINEL' as any,
          message: 'Sentinel security scan panel opened.',
          timestamp: Date.now(),
        });
        break;

      // ── Remaining commands: log so they surface in the terminal  ───────────
      default:
        addSystemLog({
          level: 'info',
          category: 'SYSTEM' as any,
          message: `Command palette: "${commandId}" selected.`,
          timestamp: Date.now(),
        });
        break;
    }
  }, [onClose, executeTerminalCommand, addSystemLog]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelected((prev) => (prev + 1) % filteredCommands.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelected((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selected]) {
            handleCommandSelect(filteredCommands[selected].id);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selected, filteredCommands, handleCommandSelect]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-void/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Palette */}
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-2xl mx-4 bg-void-panel border border-subtle rounded-lg shadow-xl overflow-hidden pointer-events-auto"
            >
              {/* Search Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-razor">
                <Search className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(0);
                  }}
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 outline-none"
                />
                <div className="flex items-center gap-1 text-[10px] text-zinc-600 uppercase tracking-wider">
                  <Command size={10} />
                  <span>K</span>
                </div>
              </div>

              {/* Commands List */}
              <div className="max-h-[400px] overflow-y-auto p-2">
                {filteredCommands.length === 0 ? (
                  <div className="text-center py-8 text-zinc-600">
                    <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No commands found</p>
                  </div>
                ) : (
                  filteredCommands.map((command, index) => {
                    const Icon = command.icon;
                    const isSelected = selected === index;

                    return (
                      <button
                        key={command.id}
                        onClick={() => handleCommandSelect(command.id)}
                        onMouseEnter={() => setSelected(index)}
                        className={`
                          w-full flex items-center justify-between px-3 py-2.5 rounded-md
                          transition-colors text-left
                          ${isSelected
                            ? 'bg-white/5 text-white'
                            : 'text-zinc-400 hover:text-zinc-300 hover:bg-white/[0.02]'
                          }
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <Icon size={16} className="flex-shrink-0" />
                          <span className="text-sm">{command.label}</span>
                        </div>

                        {command.shortcut && (
                          <span className="text-[11px] text-zinc-600 font-mono">
                            {command.shortcut}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2 border-t border-razor bg-void-surface">
                <div className="flex items-center justify-between text-[10px] text-zinc-600">
                  <div className="flex items-center gap-3">
                    <span>↑↓ Navigate</span>
                    <span>↵ Select</span>
                    <span>Esc Close</span>
                  </div>
                  <span className="uppercase tracking-wider">Command Palette</span>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}