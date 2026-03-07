'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle, Shield, Activity, Loader2, Zap } from 'lucide-react';
import { useArkheStore, useSentinelHazards, useIsAuditing } from '@/store';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

const severityColors = {
  low: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  critical: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
};

const severityIcons = {
  low: Activity,
  medium: AlertTriangle,
  high: AlertTriangle,
  critical: Zap,
};

/**
 * SENTINEL PANEL - Security Scanner with Pulsing Alerts
 * Features: Pulsing red glow on hazards, animated scanning progress
 */
export default function SentinelPanel() {
  const hazards = useSentinelHazards();
  const isAuditing = useIsAuditing();
  const runSentinelAudit = useArkheStore((state) => state.runSentinelAudit);

  const hasCriticalHazards = hazards.some(h => h.severity === 'critical');
  const hasHighHazards = hazards.some(h => h.severity === 'high' || h.severity === 'critical');

  const handleRefresh = async () => {
    await runSentinelAudit();
  };

  return (
    <motion.div 
      data-tour="sentinel"
      className={cn(
        "h-full flex flex-col bg-void overflow-hidden relative",
        "border border-razor rounded-lg backdrop-blur-md",
        // Pulsing red glow when critical hazards detected
        hasCriticalHazards && "border-rose-500/50 shadow-sentinel-critical",
        hasHighHazards && !hasCriticalHazards && "border-amber-500/30 shadow-sentinel-warning",
        // Breathing animation when auditing
        isAuditing && "animate-breathe-border"
      )}
      animate={hasCriticalHazards ? {
        boxShadow: [
          "0 0 20px rgba(244, 63, 94, 0.3), 0 0 40px rgba(244, 63, 94, 0.1)",
          "0 0 40px rgba(244, 63, 94, 0.5), 0 0 60px rgba(244, 63, 94, 0.2)",
          "0 0 20px rgba(244, 63, 94, 0.3), 0 0 40px rgba(244, 63, 94, 0.1)",
        ]
      } : {}}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      style={isAuditing && !hasCriticalHazards ? {
        animation: 'breathe-border 3s ease-in-out infinite'
      } : {}}
    >
      {/* Animated border pulse for critical alerts */}
      {hasCriticalHazards && (
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(244, 63, 94, 0.1), transparent)',
          }}
          animate={{
            x: ['-100%', '200%'],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear"
          }}
        />
      )}

      {/* Header */}
      <div className="relative z-10 h-12 flex items-center justify-between px-4 border-b border-razor bg-void-surface/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Shield className={cn(
            "w-4 h-4 transition-all",
            hasCriticalHazards ? "text-rose-400 drop-shadow-glow-rose" : "text-cyan-400 drop-shadow-glow-cyan"
          )} />
          <h2 className="text-xs font-black uppercase tracking-wider text-primary">
            Sentinel Audit
          </h2>
          {hazards.length > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-black",
                hasCriticalHazards ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400"
              )}
            >
              {hazards.length} ALERT{hazards.length > 1 ? 'S' : ''}
            </motion.div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isAuditing}
          className={cn(
            "px-3 py-1 rounded bg-void-panel border border-razor",
            "text-[10px] font-mono text-zinc-400 hover:text-white",
            "disabled:opacity-50 transition-all backdrop-blur-sm",
            isAuditing && "animate-pulse"
          )}
        >
          {isAuditing ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {/* Scanning Progress Bar */}
      {isAuditing && (
        <div className="relative h-1 bg-void-surface/50 overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
            animate={{
              x: ['-100%', '200%'],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "linear"
            }}
          />
          <motion.div
            className="absolute inset-0 bg-cyan-400/20"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{
              duration: 2,
              ease: "easeInOut"
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 bg-gradient-to-b from-void/95 to-void-black/95 backdrop-blur-sm">
        {isAuditing && (
          <motion.div 
            className="flex flex-col items-center justify-center h-48"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 className="w-8 h-8 text-cyan-400 drop-shadow-glow-cyan" />
            </motion.div>
            <motion.p
              className="text-xs text-cyan-400 font-mono mt-4"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              Analyzing genome sequence...
            </motion.p>
            <div className="mt-2 text-[10px] text-zinc-600 font-mono">
              Checking for bio-hazards
            </div>
          </motion.div>
        )}

        {!isAuditing && hazards.length === 0 && (
          <motion.div 
            className="flex flex-col items-center justify-center h-48 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Shield className="w-12 h-12 text-emerald-400 mb-3 drop-shadow-glow-emerald" />
            </motion.div>
            <p className="text-sm text-emerald-400 font-mono font-bold">System Secure</p>
            <p className="text-[10px] text-zinc-600 mt-2">No bio-hazards detected</p>
            <div className="mt-4 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse drop-shadow-glow-emerald" />
              <span className="text-[9px] text-emerald-400/80 uppercase tracking-wider font-mono">
                All Clear
              </span>
            </div>
          </motion.div>
        )}

        {!isAuditing && hazards.length > 0 && (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {hazards.map((hazard, idx) => {
                const Icon = severityIcons[hazard.severity];
                return (
                  <motion.div
                    key={idx}
                    layout
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ 
                      delay: idx * 0.05,
                      layout: { duration: 0.3 }
                    }}
                    className={cn(
                      'relative p-3 rounded-lg border backdrop-blur-sm',
                      'hover:bg-white/[0.02] transition-all',
                      severityColors[hazard.severity]
                    )}
                  >
                    {/* Animated glow for critical hazards */}
                    {hazard.severity === 'critical' && (
                      <motion.div
                        className="absolute inset-0 rounded-lg opacity-20"
                        animate={{
                          boxShadow: [
                            '0 0 10px rgba(244, 63, 94, 0.3)',
                            '0 0 20px rgba(244, 63, 94, 0.5)',
                            '0 0 10px rgba(244, 63, 94, 0.3)',
                          ]
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                        }}
                      />
                    )}

                    <div className="relative flex items-start gap-2">
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {hazard.type.replace('-', ' ')}
                          </span>
                          <span className="text-[9px] font-mono opacity-70">
                            pos {hazard.position.toLocaleString()}
                          </span>
                        </div>
                        <p className="text-[10px] mt-1 opacity-80 leading-relaxed">
                          {hazard.description}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={cn(
                            'text-[8px] uppercase tracking-wider px-2 py-0.5 rounded-full font-black',
                            severityColors[hazard.severity]
                          )}>
                            {hazard.severity}
                          </span>
                          {hazard.severity === 'critical' && (
                            <motion.div
                              animate={{ opacity: [0.5, 1, 0.5] }}
                              transition={{ duration: 1, repeat: Infinity }}
                              className="text-[8px] text-rose-400 font-mono"
                            >
                              ⚠ IMMEDIATE ACTION REQUIRED
                            </motion.div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer status bar */}
      <div className="relative z-10 h-8 border-t border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-between px-4 text-[9px] font-mono">
        <div className="flex items-center gap-4">
          <span className="text-zinc-600">SENTINEL v2.1</span>
          <span className="text-zinc-700">•</span>
          <span className="text-zinc-600">
            {hazards.length} hazard{hazards.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            isAuditing && "bg-amber-400 animate-pulse",
            !isAuditing && hazards.length === 0 && "bg-emerald-400",
            !isAuditing && hazards.length > 0 && "bg-rose-400"
          )} />
          <span className={cn(
            "uppercase tracking-wider",
            isAuditing && "text-amber-400",
            !isAuditing && hazards.length === 0 && "text-emerald-400",
            !isAuditing && hazards.length > 0 && "text-rose-400"
          )}>
            {isAuditing ? 'SCANNING' : hazards.length === 0 ? 'SECURE' : 'ALERT'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}