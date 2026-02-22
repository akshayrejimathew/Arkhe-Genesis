'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FlaskConical, Zap, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useArkheStore } from '@/hooks/useArkheStore';
import type { PCRProduct } from '@/types/arkhe';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

/**
 * IN-SILICO PCR WORKBENCH - LEGENDARY EDITION
 * Features: Neon glass DNA bands, electricity-through-water loading
 */
export default function InSilicoPCRWorkbench() {
  const [forwardPrimer, setForwardPrimer] = useState('');
  const [reversePrimer, setReversePrimer] = useState('');
  const [maxMismatches, setMaxMismatches] = useState(2);
  const [minProduct, setMinProduct] = useState(50);
  const [maxProduct, setMaxProduct] = useState(5000);
  const [showPrimerDimerWarning, setShowPrimerDimerWarning] = useState(false);

  const {
    runPCR,
    pcrResults,
    isRunningPCR,
  } = useArkheStore();

  const checkPrimerDimer = (fwd: string, rev: string): boolean => {
    if (!fwd || !rev) return false;
    const fwd3 = fwd.slice(-5).toUpperCase();
    const rev3 = rev.slice(-5).toUpperCase();
    const rev3RC = rev3.split('').reverse().map(b => {
      if (b === 'A') return 'T';
      if (b === 'T') return 'A';
      if (b === 'C') return 'G';
      if (b === 'G') return 'C';
      return 'N';
    }).join('');
    return fwd3 === rev3RC;
  };

  const handleRunPCR = async () => {
    if (!forwardPrimer || !reversePrimer) return;

    const dimerRisk = checkPrimerDimer(forwardPrimer, reversePrimer);
    setShowPrimerDimerWarning(dimerRisk);

    await runPCR(forwardPrimer, reversePrimer, {
      maxMismatches,
      minProduct,
      maxProduct,
    });
  };

  return (
    <div className="w-full h-full bg-void border border-razor rounded-lg overflow-hidden flex flex-col backdrop-blur-md">
      {/* Header */}
      <div className="h-14 border-b border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-cyan-400 drop-shadow-glow-cyan" strokeWidth={2} />
          <h2 className="text-sm font-black tracking-wider uppercase text-primary">
            In-Silico PCR Workbench
          </h2>
        </div>

        <button
          onClick={handleRunPCR}
          disabled={!forwardPrimer || !reversePrimer || isRunningPCR}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm",
            forwardPrimer && reversePrimer
              ? "bg-cyan-500 text-black hover:bg-cyan-400 shadow-glow-cyan"
              : "bg-void-surface text-zinc-600 border border-razor"
          )}
        >
          {isRunningPCR ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" fill="currentColor" />
              Simulate PCR
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 grid grid-cols-2 gap-6 bg-gradient-to-b from-void/95 to-void-black/95">
        {/* Left: Primer Input */}
        <div className="space-y-6">
          {/* Forward Primer */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">
              Forward Primer (5' → 3')
            </label>
            <textarea
              value={forwardPrimer}
              onChange={(e) => setForwardPrimer(e.target.value.toUpperCase())}
              placeholder="ATGCATGCATGCATGC..."
              className={cn(
                "w-full h-24 px-3 py-2 bg-void-panel border border-razor rounded font-mono text-sm",
                "text-emerald-400 placeholder:text-zinc-700 crt-text-glow",
                "focus:outline-none focus:border-emerald-500/50 focus:shadow-glow-emerald resize-none",
                "backdrop-blur-sm transition-all"
              )}
            />
            <div className="text-[9px] text-zinc-600 mt-1 font-mono">
              Length: {forwardPrimer.length} bp
            </div>
          </div>

          {/* Reverse Primer */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">
              Reverse Primer (5' → 3')
            </label>
            <textarea
              value={reversePrimer}
              onChange={(e) => setReversePrimer(e.target.value.toUpperCase())}
              placeholder="GCATGCATGCATGCAT..."
              className={cn(
                "w-full h-24 px-3 py-2 bg-void-panel border border-razor rounded font-mono text-sm",
                "text-rose-400 placeholder:text-zinc-700 crt-text-glow",
                "focus:outline-none focus:border-rose-500/50 focus:shadow-glow-rose resize-none",
                "backdrop-blur-sm transition-all"
              )}
            />
            <div className="text-[9px] text-zinc-600 mt-1 font-mono">
              Length: {reversePrimer.length} bp
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">
                Max Mismatches
              </label>
              <input
                type="number"
                value={maxMismatches}
                onChange={(e) => setMaxMismatches(parseInt(e.target.value) || 0)}
                min={0}
                max={5}
                className="w-full px-2 py-1 bg-void-panel border border-razor rounded font-mono text-sm text-zinc-300 focus:outline-none focus:border-cyan-500/50 backdrop-blur-sm"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">
                Min Product
              </label>
              <input
                type="number"
                value={minProduct}
                onChange={(e) => setMinProduct(parseInt(e.target.value) || 50)}
                min={10}
                step={10}
                className="w-full px-2 py-1 bg-void-panel border border-razor rounded font-mono text-sm text-zinc-300 focus:outline-none focus:border-cyan-500/50 backdrop-blur-sm"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">
                Max Product
              </label>
              <input
                type="number"
                value={maxProduct}
                onChange={(e) => setMaxProduct(parseInt(e.target.value) || 5000)}
                min={100}
                step={100}
                className="w-full px-2 py-1 bg-void-panel border border-razor rounded font-mono text-sm text-zinc-300 focus:outline-none focus:border-cyan-500/50 backdrop-blur-sm"
              />
            </div>
          </div>

          {/* Primer-Dimer Warning */}
          <AnimatePresence>
            {showPrimerDimerWarning && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg backdrop-blur-md"
              >
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5 drop-shadow-glow-amber" />
                <div>
                  <div className="text-xs font-bold text-amber-400 mb-1">
                    Primer-Dimer Risk Detected
                  </div>
                  <div className="text-[10px] text-amber-300/70">
                    Primers show significant 3' complementarity. This may lead to primer-dimer formation.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results Summary */}
          <AnimatePresence>
            {pcrResults && pcrResults.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg backdrop-blur-md"
              >
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 drop-shadow-glow-emerald" />
                  <span className="text-xs font-bold text-emerald-400">
                    PCR Complete – {pcrResults.length} product(s)
                  </span>
                </div>
                <div className="space-y-1 text-[10px] font-mono">
                  {pcrResults.map((p, i) => (
                    <div key={i} className="flex justify-between text-emerald-300/70">
                      <span>{p.productLength} bp</span>
                      <span>Fwd Tm: {p.forwardTm}°C | Rev Tm: {p.reverseTm}°C</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Virtual Gel - LEGENDARY EDITION */}
        <div className="bg-void-panel border border-razor rounded-lg p-6 backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
            Virtual Agarose Gel
          </div>

          <VirtualGelLegendary products={pcrResults || []} isRunning={isRunningPCR} />
        </div>
      </div>
    </div>
  );
}

// ============================================
// LEGENDARY VIRTUAL GEL - Neon Glass Bands
// ============================================

function VirtualGelLegendary({ products, isRunning }: { products: PCRProduct[]; isRunning: boolean }) {
  const ladder = [
    10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 
    1500, 1000, 750, 500, 250, 100
  ];

  const getYPosition = (size: number) => {
    const minSize = 100;
    const maxSize = 10000;
    const logSize = Math.log(size);
    const logMin = Math.log(minSize);
    const logMax = Math.log(maxSize);
    
    return ((logSize - logMin) / (logMax - logMin)) * 100;
  };

  return (
    <div className="relative w-full h-96 rounded-lg overflow-hidden border border-razor">
      {/* Dark lab background with UV glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#050810] to-[#000000]" />
      <div className="absolute inset-0 bg-gradient-radial from-blue-900/5 via-transparent to-transparent" />

      {/* ELECTRICITY-THROUGH-WATER Loading Animation */}
      <AnimatePresence>
        {isRunning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-blue-500/5 backdrop-blur-sm"
          >
            {/* Electric ripples */}
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.2) 0%, transparent 50%)`,
                }}
                animate={{
                  scale: [1, 2.5, 1],
                  opacity: [0.5, 0, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.7,
                  ease: "easeOut"
                }}
              />
            ))}

            {/* Lightning bolts */}
            <svg className="absolute inset-0 w-full h-full">
              <motion.path
                d="M 100 50 L 120 100 L 110 100 L 130 150"
                stroke="rgba(6, 182, 212, 0.6)"
                strokeWidth="2"
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: [0, 1, 0] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
              <motion.path
                d="M 300 80 L 280 130 L 290 130 L 270 180"
                stroke="rgba(6, 182, 212, 0.6)"
                strokeWidth="2"
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: [0, 1, 0] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: 0.5,
                  ease: "easeInOut"
                }}
              />
            </svg>

            {/* Center loader */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                >
                  <Loader2 className="w-8 h-8 text-cyan-400 drop-shadow-glow-cyan mx-auto mb-2" />
                </motion.div>
                <motion.div
                  className="text-xs text-cyan-400 font-mono"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Running electrophoresis...
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gel lanes */}
      <svg className="relative w-full h-full z-10" viewBox="0 0 400 384">
        <defs>
          {/* NEON GLASS effect for DNA bands */}
          <filter id="neon-glass" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur1" />
            <feGaussianBlur stdDeviation="8" result="blur2" />
            <feGaussianBlur stdDeviation="12" result="blur3" />
            <feMerge>
              <feMergeNode in="blur3" />
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Glass gradient */}
          <linearGradient id="glass-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.3)" />
            <stop offset="50%" stopColor="rgba(255, 255, 255, 0.1)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0.05)" />
          </linearGradient>
        </defs>

        {/* Wells */}
        <rect x="40" y="10" width="40" height="15" rx="3" fill="#000000" stroke="rgba(100,100,200,0.15)" strokeWidth="0.5" />
        <rect x="120" y="10" width="40" height="15" rx="3" fill="#000000" stroke="rgba(100,100,200,0.15)" strokeWidth="0.5" />
        <rect x="200" y="10" width="40" height="15" rx="3" fill="#000000" stroke="rgba(100,100,200,0.15)" strokeWidth="0.5" />
        <rect x="280" y="10" width="40" height="15" rx="3" fill="#000000" stroke="rgba(100,100,200,0.15)" strokeWidth="0.5" />

        {/* Lane separators */}
        <line x1="100" y1="30" x2="100" y2="370" stroke="rgba(100,100,200,0.03)" strokeDasharray="2,4" />
        <line x1="180" y1="30" x2="180" y2="370" stroke="rgba(100,100,200,0.03)" strokeDasharray="2,4" />
        <line x1="260" y1="30" x2="260" y2="370" stroke="rgba(100,100,200,0.03)" strokeDasharray="2,4" />
        <line x1="340" y1="30" x2="340" y2="370" stroke="rgba(100,100,200,0.03)" strokeDasharray="2,4" />

        {/* Ladder - Violet markers */}
        {ladder.map((size, i) => {
          const y = 30 + (getYPosition(size) / 100) * 340;
          return (
            <g key={`ladder-${i}`}>
              <rect
                x="45"
                y={y - 1.5}
                width="30"
                height="3"
                rx="1"
                fill="#8b5cf6"
                opacity="0.9"
                filter="url(#neon-glass)"
              />
              <text
                x="8"
                y={y + 2}
                fontSize="7"
                fill="rgba(139, 92, 246, 0.6)"
                fontFamily="monospace"
                fontWeight="500"
              >
                {size >= 1000 ? `${size / 1000}kb` : `${size}bp`}
              </text>
            </g>
          );
        })}

        {/* PCR Products - NEON GLASS BANDS */}
        <AnimatePresence>
          {products.map((product, i) => {
            const laneX = 125 + (i * 80);
            const y = 30 + (getYPosition(product.productLength) / 100) * 340;
            const isPerfectMatch = product.forwardMismatches === 0 && product.reverseMismatches === 0;
            const bandColor = isPerfectMatch ? '#06b6d4' : '#3b82f6';

            return (
              <motion.g
                key={`product-${i}`}
                initial={{ opacity: 0, y: y - 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ 
                  delay: 0.5 + i * 0.3,
                  duration: 1,
                  ease: "easeOut"
                }}
              >
                {/* Outer glow halo */}
                <rect
                  x={laneX - 2}
                  y={y - 4}
                  width="34"
                  height="8"
                  rx="2"
                  fill={bandColor}
                  opacity="0.1"
                  filter="url(#neon-glass)"
                />

                {/* Main glass band with gradient */}
                <rect
                  x={laneX}
                  y={y - 2}
                  width="30"
                  height="4"
                  rx="1"
                  fill="url(#glass-gradient)"
                  stroke={bandColor}
                  strokeWidth="1"
                  opacity="0.9"
                  filter="url(#neon-glass)"
                />

                {/* Inner glow */}
                <rect
                  x={laneX + 1}
                  y={y - 1}
                  width="28"
                  height="2"
                  rx="1"
                  fill={bandColor}
                  opacity="0.6"
                />

                {/* Pulsing effect */}
                <motion.rect
                  x={laneX}
                  y={y - 2}
                  width="30"
                  height="4"
                  rx="1"
                  fill={bandColor}
                  opacity="0.3"
                  animate={{
                    opacity: [0.3, 0.6, 0.3],
                    scale: [1, 1.05, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: i * 0.5,
                  }}
                />

                {/* Size label */}
                <text
                  x={laneX + 35}
                  y={y + 2}
                  fontSize="7"
                  fill={bandColor}
                  opacity="0.8"
                  fontFamily="monospace"
                  fontWeight="600"
                  filter="url(#neon-glass)"
                >
                  {product.productLength}bp
                </text>

                {/* Trailing smear */}
                <rect
                  x={laneX}
                  y={y + 2}
                  width="30"
                  height="8"
                  fill={bandColor}
                  opacity="0.05"
                />
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>

      {/* Lane labels */}
      <div className="absolute bottom-2 left-0 right-0 flex justify-around text-[8px] text-blue-400/40 font-mono px-4">
        <span>Ladder</span>
        {products.length > 0 ? (
          products.map((_, i) => <span key={i}>Sample {i + 1}</span>)
        ) : (
          <span className="text-blue-400/20">No Products</span>
        )}
      </div>

      {/* UV grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]">
        <div className="w-full h-full" style={{
          backgroundImage: `
            linear-gradient(0deg, transparent 24%, rgba(100, 100, 255, 0.05) 25%, rgba(100, 100, 255, 0.05) 26%, transparent 27%),
            linear-gradient(90deg, transparent 24%, rgba(100, 100, 255, 0.05) 25%, rgba(100, 100, 255, 0.05) 26%, transparent 27%)
          `,
          backgroundSize: '50px 50px'
        }} />
      </div>
    </div>
  );
}