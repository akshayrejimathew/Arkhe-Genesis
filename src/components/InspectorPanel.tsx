'use client';
import React from 'react';
import { Activity, Shield, Hash, Lock, Unlock } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';

// ─── Component ───────────────────────────────────────────────────────────────

export default function InspectorPanel() {
  const viewport  = useArkheStore((s: ArkheState) => s.viewport);
  const isLocked  = useArkheStore((s: ArkheState) => s.isLocked);

  const positionLabel =
    viewport.start !== undefined && viewport.end !== undefined
      ? `${viewport.start.toLocaleString()} → ${viewport.end.toLocaleString()} bp`
      : '—';

  const gcLabel =
    viewport.gcPercent !== undefined
      ? `${viewport.gcPercent.toFixed(2)}%`
      : '—';

  const viewportSpan =
    viewport.start !== undefined && viewport.end !== undefined
      ? `${((viewport.end - viewport.start + 1) / 1_000).toFixed(1)} Kbp`
      : '—';

  const meta = [
    {
      label: 'POSITION',
      value: positionLabel,
      sub: viewportSpan,
      icon: Hash,
    },
    {
      label: 'GC CONTENT',
      value: gcLabel,
      sub: 'current viewport',
      icon: Shield,
    },
    {
      label: 'ACTIVITY',
      value: isLocked ? 'ENGINE BUSY' : 'ENGINE IDLE',
      sub: null,
      icon: Activity,
    },
  ];

  return (
    <div
      className="flex flex-col h-full bg-void-panel/50 backdrop-blur-md p-4"
      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
    >
      {/* ── Panel title ── */}
      <div className="mb-6">
        <span className="text-[10px] uppercase tracking-[0.2em] text-ghost font-bold border-b border-accent/20 pb-1">
          Contextual Inspector
        </span>
      </div>

      {/* ── Metric cards ── */}
      <div className="space-y-3">
        {meta.map((item) => (
          <div
            key={item.label}
            className="p-3 rounded-lg bg-void-surface/30 border border-razor group hover:border-accent/20 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <item.icon
                size={12}
                className="text-ghost group-hover:text-accent transition-colors"
              />
              <span className="text-[9px] tracking-widest text-ghost">
                {item.label}
              </span>
            </div>
            <div className="text-[13px] text-secondary font-mono leading-snug">
              {item.value}
            </div>
            {item.sub && (
              <div className="text-[10px] text-ghost/50 mt-0.5">{item.sub}</div>
            )}
          </div>
        ))}

        {/* ── Mutex Monitor ── */}
        <div className="p-3 rounded-lg bg-void-surface/30 border border-razor group hover:border-accent/20 transition-all">
          <div className="flex items-center gap-2 mb-2">
            {isLocked ? (
              <Lock size={12} className="text-amber-400" />
            ) : (
              <Unlock size={12} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
            )}
            <span className="text-[9px] tracking-widest text-ghost">
              MUTEX MONITOR
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Status dot */}
            <span
              className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
                isLocked
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
              style={
                isLocked
                  ? { boxShadow: '0 0 6px 2px rgba(245,158,11,0.6)' }
                  : { boxShadow: '0 0 4px 1px rgba(16,185,129,0.4)' }
              }
            />
            <span
              className={`text-[13px] font-mono ${
                isLocked ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {isLocked ? 'MUTEX ACTIVE' : 'ENGINE IDLE'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}