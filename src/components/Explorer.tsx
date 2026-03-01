'use client';
import React from 'react';
import { FolderOpen, Dna, ChevronRight, Search, GitBranch } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatGenomeLength(bp: number): string {
  if (bp === 0) return '—';
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mbp`;
  if (bp >= 1_000)     return `${(bp / 1_000).toFixed(1)} Kbp`;
  return `${bp} bp`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Explorer() {
  const activeGenomeId  = useArkheStore((s: ArkheState) => s.activeGenomeId);
  const genomeLength    = useArkheStore((s: ArkheState) => s.genomeLength);
  const branches        = useArkheStore((s: ArkheState) => s.branches);
  const currentBranch   = useArkheStore((s: ArkheState) => s.currentBranch);

  const genomeName  = activeGenomeId ?? 'No genome loaded';
  const lengthLabel = formatGenomeLength(genomeLength);
  const hasGenome   = genomeLength > 0;

  return (
    <div
      className="flex flex-col h-full bg-void-panel/50 backdrop-blur-md"
      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
    >
      {/* ── Header ── */}
      <div className="p-3 border-b border-razor flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-ghost font-bold">
          Explorer
        </span>
        <Search
          size={12}
          className="text-ghost hover:text-accent cursor-pointer transition-colors"
        />
      </div>

      <div className="p-2 space-y-1">
        {/* ── Active genome entry ── */}
        <div
          className={`group flex flex-col gap-0.5 px-2 py-2 rounded-md border cursor-pointer transition-all ${
            hasGenome
              ? 'bg-accent/5 border-accent/20 hover:border-accent/40'
              : 'bg-white/3 border-razor opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center gap-2">
            <Dna size={14} className={hasGenome ? 'text-accent' : 'text-ghost'} />
            <span
              className={`text-[12px] font-medium truncate ${
                hasGenome ? 'text-accent' : 'text-ghost'
              }`}
              title={genomeName}
            >
              {genomeName}
            </span>
          </div>
          {hasGenome && (
            <span className="text-[10px] text-ghost pl-[22px] font-mono">
              {lengthLabel}
            </span>
          )}
        </div>

        {/* ── Branches ── */}
        {hasGenome && branches.length > 0 && (
          <div className="mt-2 space-y-0.5">
            <span className="block px-2 text-[9px] uppercase tracking-[0.18em] text-ghost/60 mb-1">
              Branches
            </span>
            {branches.map((branch) => {
              const isActive = branch.name === currentBranch;
              return (
                <div
                  key={branch.name}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all ${
                    isActive
                      ? 'bg-accent/10 border border-accent/30 shadow-[0_0_8px_rgba(var(--color-accent-rgb),0.25)]'
                      : 'hover:bg-white/5 border border-transparent text-ghost hover:text-secondary cursor-pointer'
                  }`}
                >
                  <GitBranch
                    size={12}
                    className={isActive ? 'text-accent' : 'text-ghost'}
                  />
                  <span
                    className={`text-[11px] truncate ${
                      isActive ? 'text-accent font-semibold' : 'text-ghost'
                    }`}
                  >
                    {branch.name}
                  </span>
                  {isActive && (
                    <span className="ml-auto text-[9px] text-accent/70 tracking-wider">
                      HEAD
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Legacy archive ── */}
        <div className="flex items-center gap-2 px-2 py-1.5 text-ghost hover:text-secondary hover:bg-white/5 rounded-md cursor-not-allowed transition-all">
          <FolderOpen size={14} />
          <span className="text-[11px]">Legacy_Archive</span>
          <ChevronRight size={12} className="ml-auto" />
        </div>
      </div>
    </div>
  );
}