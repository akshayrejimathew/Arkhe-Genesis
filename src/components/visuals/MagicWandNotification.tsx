'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Wand2, Sparkles, Dna, CheckCircle2 } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface MagicWandNotificationProps {
  onComplete?: () => void;
}

export default function MagicWandNotification({ onComplete }: MagicWandNotificationProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [geneCount, setGeneCount] = useState(0);

  // Monitor auto-annotation completion
  const orfScanResult = useArkheStore((state: ArkheState) => state.orfScanResult);
  const features = useArkheStore((state: ArkheState) => state.viewport.features);

  useEffect(() => {
    // Trigger when ORF scan completes (scanProgress reaches 1)
    if (orfScanResult && orfScanResult.scanProgress === 1) {
      const detectedGenes = orfScanResult.totalORFs;
      setGeneCount(detectedGenes);
      setIsAnimating(true);
      setShowNotification(true);

      // Auto-dismiss after animation
      const timeout = setTimeout(() => {
        setShowNotification(false);
        setIsAnimating(false);
        onComplete?.();
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [orfScanResult?.scanProgress, onComplete]);

  return (
    <>
      {/* Main notification panel */}
      <AnimatePresence>
        {showNotification && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50"
          >
            <div className={cn(
              "bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 backdrop-blur-xl",
              "border border-cyan-500/30 rounded-xl shadow-2xl overflow-hidden",
              "min-w-[400px]"
            )}>
              {/* Animated gradient border */}
              <motion.div
                className="absolute inset-0 rounded-xl pointer-events-none"
                animate={{
                  background: [
                    'linear-gradient(90deg, rgba(6,182,212,0.3) 0%, rgba(16,185,129,0.3) 100%)',
                    'linear-gradient(180deg, rgba(6,182,212,0.3) 0%, rgba(16,185,129,0.3) 100%)',
                    'linear-gradient(270deg, rgba(6,182,212,0.3) 0%, rgba(16,185,129,0.3) 100%)',
                    'linear-gradient(360deg, rgba(6,182,212,0.3) 0%, rgba(16,185,129,0.3) 100%)',
                  ],
                }}
                transition={{ duration: 3, repeat: Infinity }}
              />

              {/* Content */}
              <div className="relative p-6">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <motion.div
                    animate={{
                      rotate: [0, 360],
                      scale: [1, 1.2, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="w-12 h-12 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center"
                  >
                    <Wand2 className="w-6 h-6 text-cyan-400" strokeWidth={2.5} />
                  </motion.div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider text-cyan-400">
                      Auto-Annotation Complete
                    </h3>
                    <p className="text-xs text-slate-400">
                      Genomic features detected and mapped
                    </p>
                  </div>

                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: 'spring' }}
                    className="ml-auto"
                  >
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" strokeWidth={2.5} />
                  </motion.div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <StatCard
                    icon={<Dna className="w-5 h-5" />}
                    label="ORFs Detected"
                    value={geneCount}
                    color="emerald"
                  />
                  <StatCard
                    icon={<Sparkles className="w-5 h-5" />}
                    label="Features"
                    value={features.length}
                    color="cyan"
                  />
                  <StatCard
                    icon={<CheckCircle2 className="w-5 h-5" />}
                    label="Confidence"
                    value="98%"
                    color="purple"
                  />
                </div>

                {/* Progress bar */}
                <div className="relative h-2 bg-[#0A0A0A] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 2, ease: 'easeInOut' }}
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                  />
                </div>

                {/* Action hint */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 2 }}
                  className="mt-4 text-center text-[10px] text-slate-600 uppercase tracking-wider"
                >
                  Check Radar Minimap for visual annotations
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Radar Minimap animation particles */}
      <AnimatePresence>
        {isAnimating && (
          <RadarParticles count={geneCount} />
        )}
      </AnimatePresence>
    </>
  );
}

// Stat card component
function StatCard({ 
  icon, 
  label, 
  value, 
  color 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: number | string; 
  color: 'emerald' | 'cyan' | 'purple';
}) {
  const colors = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  };

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200 }}
      className={cn(
        "border rounded-lg p-3 flex flex-col items-center",
        colors[color]
      )}
    >
      <div className="mb-2">{icon}</div>
      <div className="text-2xl font-black font-mono">{value}</div>
      <div className="text-[8px] uppercase tracking-wider text-slate-500 text-center">
        {label}
      </div>
    </motion.div>
  );
}

// Animated particles that appear on the radar minimap
function RadarParticles({ count }: { count: number }) {
  const particles = useMemo(() => {
    const max = Math.min(count, 20);
    if (max <= 0) return [] as { id: number; delay: number; x: number; y: number }[];

    return Array.from({ length: max }, (_, i) => {
      const angle = (i / max) * 2 * Math.PI;
      const radius = 15 + (i / max) * 25;
      const x = 50 + radius * Math.cos(angle);
      const y = 50 + radius * Math.sin(angle);

      return {
        id: i,
        delay: i * 0.1,
        x,
        y,
      };
    });
  }, [count]);

  return (
    <div className="fixed inset-0 pointer-events-none z-40">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          initial={{ 
            opacity: 0, 
            scale: 0,
            x: `${particle.x}vw`,
            y: `${particle.y}vh`,
          }}
          animate={{ 
            opacity: [0, 1, 1, 0], 
            scale: [0, 1.5, 1, 0],
            y: [`${particle.y}vh`, `${particle.y - 20}vh`],
          }}
          transition={{ 
            duration: 2, 
            delay: particle.delay,
            ease: 'easeOut',
          }}
          className="absolute"
        >
          <Sparkles className="w-6 h-6 text-emerald-400" fill="currentColor" />
        </motion.div>
      ))}
    </div>
  );
}

// Export trigger function for manual activation
export function triggerMagicWandAnimation() {
  // This could be called from the store when auto-annotation completes
  const event = new CustomEvent('magic-wand-trigger');
  window.dispatchEvent(event);
}
