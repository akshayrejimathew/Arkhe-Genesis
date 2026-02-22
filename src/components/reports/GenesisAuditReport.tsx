'use client';

import { motion } from 'framer-motion';
import { Shield, Download, Check, AlertTriangle } from 'lucide-react';
import type { AuditReport } from '@/lib/reportGenerator';

interface GenesisAuditReportProps {
  report: AuditReport;
  onClose?: () => void;
}

/**
 * GENESIS AUDIT REPORT - Top-Secret Laboratory Certificate
 * Features: Typewriter font, Monolith header, Holographic Sentinel Seal
 */
export default function GenesisAuditReport({ report, onClose }: GenesisAuditReportProps) {
  const handleDownload = () => {
    const blob = new Blob([report.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `genesis-audit-${report.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getSafetyClass = (score: number) => {
    if (score >= 90) return 'safe';
    if (score >= 70) return 'moderate';
    return 'critical';
  };

  const safetyClass = getSafetyClass(report.safetyScore);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-void/90 backdrop-blur-xl"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative max-w-4xl w-full bg-void-panel border border-razor rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-Secret Classification Band */}
        <div className="h-2 bg-gradient-to-r from-rose-500 via-amber-400 to-rose-500 opacity-80" />
        
        {/* Main Certificate */}
        <div className="p-8">
          {/* Monolith Header */}
          <div className="text-center mb-8 relative">
            <motion.div
              className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-transparent blur-3xl"
              animate={{
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
              }}
            />
            <h1 
              className="relative text-5xl font-black uppercase tracking-[0.3em] mb-2"
              style={{
                fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textShadow: '0 0 40px rgba(6, 182, 212, 0.3)',
              }}
            >
              GENESIS
            </h1>
            <div className="text-xs uppercase tracking-[0.5em] text-zinc-600 font-mono">
              Genomic Integrity Certification
            </div>
            <div className="mt-4 text-[10px] text-rose-400 font-mono uppercase tracking-wider">
              ⬤ Top Secret - Laboratory Access Only ⬤
            </div>
          </div>

          {/* Classification Metadata */}
          <div className="grid grid-cols-3 gap-4 mb-8 font-mono text-xs">
            <div className="bg-void border border-razor rounded p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
                Certificate ID
              </div>
              <div className="text-cyan-400 font-bold">{report.id}</div>
            </div>
            <div className="bg-void border border-razor rounded p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
                Issued
              </div>
              <div className="text-zinc-300">
                {new Date(report.timestamp).toLocaleString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
            <div className="bg-void border border-razor rounded p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
                Clearance
              </div>
              <div className="text-amber-400 font-bold">Level 5</div>
            </div>
          </div>

          {/* Typewriter Data Section */}
          <div className="space-y-4 mb-8">
            <div className="border-t border-b border-razor py-4">
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-4 font-bold">
                Subject Genome Analysis
              </h3>
              <div 
                className="space-y-2 font-mono text-sm"
                style={{
                  fontFamily: "'Courier Prime', 'Courier New', monospace",
                  fontVariantLigatures: 'none',
                }}
              >
                <div className="flex justify-between">
                  <span className="text-zinc-500">Subject ID:</span>
                  <span className="text-zinc-300">{report.genome.id || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Genome Length:</span>
                  <span className="text-emerald-400">{report.genome.length.toLocaleString()} bp</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Mutations Detected:</span>
                  <span className="text-amber-400">{report.mutations}</span>
                </div>
                {report.proteinDelta !== null && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Protein Confidence:</span>
                    <span className="text-cyan-400">{(report.proteinDelta * 100).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Safety Score - Prominent Display */}
            <div className="relative overflow-hidden rounded-lg border border-razor bg-void p-6">
              <div className="relative z-10">
                <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3 font-bold">
                  Sentinel Safety Classification
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <svg className="w-32 h-32" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="8"
                      />
                      <motion.circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={
                          safetyClass === 'safe' ? '#10b981' :
                          safetyClass === 'moderate' ? '#f59e0b' :
                          '#ef4444'
                        }
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 45}`}
                        initial={{ strokeDashoffset: 2 * Math.PI * 45 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 45 * (1 - report.safetyScore / 100) }}
                        transition={{ duration: 2, ease: "easeOut" }}
                        style={{
                          transform: 'rotate(-90deg)',
                          transformOrigin: '50% 50%',
                          filter: `drop-shadow(0 0 10px ${
                            safetyClass === 'safe' ? '#10b981' :
                            safetyClass === 'moderate' ? '#f59e0b' :
                            '#ef4444'
                          })`,
                        }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-3xl font-black text-white">
                          {report.safetyScore}
                        </div>
                        <div className="text-[10px] text-zinc-600">/100</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {safetyClass === 'safe' ? (
                        <Check className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                      )}
                      <span className={`text-lg font-bold uppercase tracking-wider ${
                        safetyClass === 'safe' ? 'text-emerald-400' :
                        safetyClass === 'moderate' ? 'text-amber-400' :
                        'text-rose-400'
                      }`}>
                        {safetyClass === 'safe' ? 'Cleared for Synthesis' :
                         safetyClass === 'moderate' ? 'Review Required' :
                         'High Risk - DO NOT PROCEED'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 font-mono">
                      {safetyClass === 'safe' 
                        ? 'No bio-hazards detected. Sequence approved for laboratory synthesis.'
                        : safetyClass === 'moderate'
                        ? 'Minor hazards detected. Manual review recommended before synthesis.'
                        : 'Critical bio-hazards detected. Sequence REJECTED for synthesis.'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Animated background gradient */}
              <motion.div
                className="absolute inset-0 opacity-10"
                animate={{
                  background: [
                    'radial-gradient(circle at 0% 0%, #06b6d4 0%, transparent 50%)',
                    'radial-gradient(circle at 100% 100%, #8b5cf6 0%, transparent 50%)',
                    'radial-gradient(circle at 0% 0%, #06b6d4 0%, transparent 50%)',
                  ],
                }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: "linear"
                }}
              />
            </div>

            {/* Digital Signature */}
            <div className="bg-void border border-razor rounded p-4">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-2">
                Cryptographic Signature (SHA-256)
              </div>
              <div className="font-mono text-[10px] text-cyan-400 break-all leading-relaxed">
                {report.signature}
              </div>
            </div>
          </div>

          {/* Holographic Sentinel Seal */}
          <div className="relative h-32 flex items-center justify-center mb-6">
            <motion.div
              className="relative"
              animate={{
                scale: [1, 1.05, 1],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
              }}
            >
              {/* Holographic gradient mask */}
              <div 
                className="w-24 h-24 rounded-full relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                  WebkitMaskImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='50' cy='50' r='48' fill='none' stroke='white' stroke-width='4'/%3E%3Cpath d='M 50 20 L 55 35 L 70 35 L 58 45 L 63 60 L 50 50 L 37 60 L 42 45 L 30 35 L 45 35 Z' fill='white'/%3E%3C/svg%3E")`,
                  WebkitMaskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                }}
              >
                <motion.div
                  className="absolute inset-0"
                  animate={{
                    background: [
                      'linear-gradient(0deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                      'linear-gradient(120deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                      'linear-gradient(240deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                      'linear-gradient(360deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                    ],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "linear"
                  }}
                />
              </div>
              
              {/* Shield icon overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <Shield className="w-10 h-10 text-white drop-shadow-glow-cyan" />
              </div>

              {/* Glow effect */}
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{
                  boxShadow: [
                    '0 0 20px rgba(6, 182, 212, 0.4)',
                    '0 0 40px rgba(139, 92, 246, 0.6)',
                    '0 0 20px rgba(6, 182, 212, 0.4)',
                  ],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                }}
              />
            </motion.div>
            
            <div className="absolute bottom-0 text-center">
              <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.3em]">
                Certified by Sentinel AI
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-razor">
            <div className="text-[9px] font-mono text-zinc-700 uppercase tracking-wider">
              Arkhé Genesis v1.0 • Genomic IDE
            </div>
            <div className="flex gap-2">
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors"
                >
                  Close
                </button>
              )}
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded text-xs font-mono uppercase tracking-wider text-cyan-400 hover:bg-cyan-500/20 transition-colors"
              >
                <Download size={14} />
                Export Certificate
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}