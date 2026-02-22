'use client';

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  Upload, 
  Dna, 
  Zap, 
  Database, 
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
  HardDrive
} from 'lucide-react';
import { useArkheStore } from '@/hooks/useArkheStore';
import type { ArkheState } from '@/hooks/useArkheStore';
import IngestionProgress from './IngestionProgress';

const cn = (...inputs: any[]) => twMerge(clsx(inputs));

interface TelemetryData {
  streamingRate: number; // MB/s
  estimatedComplexity: number; // 0-100 GC-based score
  memorySlabId: string | null;
  basesIndexed: number;
  slabsAllocated: number;
  totalBytes: number;
  bytesProcessed: number;
}

type IngestionPhase = 'idle' | 'validating' | 'streaming' | 'indexing' | 'complete' | 'error';

export default function FileIngestor() {
  const [phase, setPhase] = useState<IngestionPhase>('idle');
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    streamingRate: 0,
    estimatedComplexity: 0,
    memorySlabId: null,
    basesIndexed: 0,
    slabsAllocated: 0,
    totalBytes: 0,
    bytesProcessed: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(0);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Store methods
  const initializeEngine = useArkheStore((state: ArkheState) => state.initializeEngine);
  const loadFile = useArkheStore((state: ArkheState) => state.loadFile);
  const setSyncing = useArkheStore((state: ArkheState) => state.setSyncing);
  const isSyncing = useArkheStore((state: ArkheState) => state.isSyncing);

  // Validate and ingest file
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file) return;

    setFileName(file.name);
    setPhase('validating');
    setErrorMessage(null);

    // Validate file extension
    const validExtensions = ['.fasta', '.fa', '.fna', '.ffn', '.txt', '.dna'];
    const fileExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    
    if (!fileExtension || !validExtensions.includes(fileExtension)) {
      setErrorMessage('Invalid file type. Accepted: .fasta, .fa, .fna, .txt, .dna');
      setPhase('error');
      return;
    }

    // Check file size (warn if > 500MB but don't block)
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 500) {
      // Show warning but continue
      console.warn(`Large file detected: ${fileSizeMB.toFixed(2)}MB`);
    }

    try {
      setPhase('streaming');
      setSyncing(true);
      startTimeRef.current = Date.now();

      setTelemetry(prev => ({
        ...prev,
        totalBytes: file.size,
        bytesProcessed: 0,
        basesIndexed: 0,
      }));

      // Use store's loadFile method instead of manual streaming
      await loadFile(file);

      setPhase('complete');
      await useArkheStore.getState().runSentinelAudit();
      setSyncing(false);

      // Auto-dismiss after 2 seconds
      setTimeout(() => {
        // Parent component will handle unmounting
      }, 2000);
    } catch (error) {
      console.error('Ingestion error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Unknown ingestion error');
      setPhase('error');
      setSyncing(false);
    }
  }, [initializeEngine, setSyncing, loadFile]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      if (file instanceof File) {
        handleFileSelect(file);
      }
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleRetry = useCallback(() => {
    setPhase('idle');
    setErrorMessage(null);
    setFileName('');
    setTelemetry({
      streamingRate: 0,
      estimatedComplexity: 0,
      memorySlabId: null,
      basesIndexed: 0,
      slabsAllocated: 0,
      totalBytes: 0,
      bytesProcessed: 0,
    });
  }, []);

  const progressPercent = telemetry.totalBytes > 0 
    ? (telemetry.bytesProcessed / telemetry.totalBytes) * 100 
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Backdrop with blur */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "absolute inset-0 transition-all duration-300",
          isDragging 
            ? "bg-[#030303]/98 backdrop-blur-xl" 
            : "bg-[#030303]/95 backdrop-blur-lg"
        )}
      />

      {/* Airlock Portal Container */}
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ 
          scale: isDragging ? 1.02 : 1, 
          y: 0,
        }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-3xl px-8"
      >
        {/* Main Airlock Panel */}
        <div
          className={cn(
            "relative bg-[#0A0A0A] border rounded-xl overflow-hidden transition-all duration-300",
            "shadow-2xl shadow-black/50",
            phase === 'streaming' || phase === 'indexing'
              ? "border-cyan-500/40 shadow-cyan-500/20"
              : phase === 'error'
              ? "border-rose-500/40 shadow-rose-500/20"
              : phase === 'complete'
              ? "border-emerald-500/40 shadow-emerald-500/20"
              : isDragging
              ? "border-cyan-400/60 shadow-cyan-400/30"
              : "border-white/10"
          )}
        >
          {/* Scanning Beam Animation */}
          <AnimatePresence>
            {(phase === 'streaming' || phase === 'indexing') && (
              <motion.div
                key="scanning-beam"
                initial={{ x: '-100%' }}
                animate={{ x: '200%' }}
                exit={{ opacity: 0 }}
                transition={{
                  repeat: Infinity,
                  duration: 2.5,
                  ease: 'linear',
                }}
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(6, 182, 212, 0.4) 50%, transparent 100%)',
                  width: '40%',
                }}
              />
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="relative z-20 px-8 py-6 border-b border-white/10 bg-gradient-to-r from-cyan-500/5 via-transparent to-emerald-500/5">
            <div className="flex items-center gap-4">
              <motion.div
                animate={{
                  scale: phase === 'streaming' || phase === 'indexing' ? [1, 1.1, 1] : 1,
                }}
                transition={{
                  repeat: phase === 'streaming' || phase === 'indexing' ? Infinity : 0,
                  duration: 2,
                }}
                className={cn(
                  "w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300",
                  phase === 'complete'
                    ? "bg-emerald-500/20 text-emerald-400"
                    : phase === 'error'
                    ? "bg-rose-500/20 text-rose-400"
                    : phase === 'streaming' || phase === 'indexing'
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "bg-cyan-500/10 text-cyan-400"
                )}
              >
                {phase === 'complete' ? (
                  <CheckCircle2 className="w-7 h-7" strokeWidth={2.5} />
                ) : phase === 'error' ? (
                  <AlertCircle className="w-7 h-7" strokeWidth={2.5} />
                ) : phase === 'streaming' || phase === 'indexing' ? (
                  <Loader2 className="w-7 h-7 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Dna className="w-7 h-7" strokeWidth={2.5} />
                )}
              </motion.div>
              
              <div className="flex-1">
                <h2 className="text-2xl font-black tracking-wider text-slate-100 uppercase">
                  {phase === 'complete' ? 'Genome Indexed' : 'Genomic Airlock'}
                </h2>
                <p className="text-xs text-slate-500 uppercase tracking-[0.2em] mt-1 font-mono">
                  {phase === 'validating' && 'Validating Structure...'}
                  {phase === 'streaming' && 'Streaming to Memory Slabs...'}
                  {phase === 'indexing' && 'Building Spatial Index...'}
                  {phase === 'complete' && 'Ready for Surgical Manipulation'}
                  {phase === 'error' && 'Ingestion Failed'}
                  {phase === 'idle' && 'Awaiting Sequence Data'}
                </p>
              </div>

              {fileName && phase !== 'idle' && (
                <div className="text-right">
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider">File</div>
                  <div className="text-sm text-slate-400 font-mono truncate max-w-xs">
                    {fileName}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="relative z-20 p-8">
            {phase === 'idle' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Drop Zone */}
                <motion.div
                  animate={{
                    borderColor: isDragging ? 'rgba(6, 182, 212, 0.8)' : 'rgba(255, 255, 255, 0.2)',
                    backgroundColor: isDragging ? 'rgba(6, 182, 212, 0.1)' : 'rgba(3, 3, 3, 0.5)',
                  }}
                  className={cn(
                    "relative border-2 border-dashed rounded-xl p-16 transition-all duration-200",
                    "flex flex-col items-center justify-center text-center cursor-pointer",
                    "hover:border-cyan-500/60 hover:bg-cyan-500/5"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <motion.div
                    animate={{
                      y: isDragging ? -10 : 0,
                      scale: isDragging ? 1.1 : 1,
                    }}
                  >
                    <Upload className="w-16 h-16 text-cyan-400 mb-6" strokeWidth={1.5} />
                  </motion.div>
                  
                  <p className="text-xl font-black text-slate-200 mb-2 uppercase tracking-wide">
                    {isDragging ? 'Release to Initiate Scan' : 'Drop Genome or Click to Browse'}
                  </p>
                  <p className="text-sm text-slate-500 font-mono uppercase tracking-wider">
                    .FASTA • .FA • .FNA • .TXT • .DNA
                  </p>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".fasta,.fa,.fna,.ffn,.txt,.dna"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                </motion.div>

                {/* Capability Cards */}
                <div className="grid grid-cols-4 gap-3">
                  <CapabilityCard
                    icon={<Zap className="w-4 h-4" />}
                    label="Streaming"
                    value="Real-time"
                    color="cyan"
                  />
                  <CapabilityCard
                    icon={<HardDrive className="w-4 h-4" />}
                    label="Memory"
                    value="Slab-based"
                    color="emerald"
                  />
                  <CapabilityCard
                    icon={<Shield className="w-4 h-4" />}
                    label="Validation"
                    value="Strict"
                    color="rose"
                  />
                  <CapabilityCard
                    icon={<Database className="w-4 h-4" />}
                    label="Max Size"
                    value="Unlimited"
                    color="slate"
                  />
                </div>
              </motion.div>
            )}

            {(phase === 'validating' || phase === 'streaming' || phase === 'indexing') && (
              <IngestionProgress
                phase={phase}
                telemetry={telemetry}
                progressPercent={progressPercent}
              />
            )}

            {phase === 'complete' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-12"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', duration: 0.6 }}
                  className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-500/20 mb-6"
                >
                  <CheckCircle2 className="w-12 h-12 text-emerald-400" strokeWidth={2.5} />
                </motion.div>
                
                <h3 className="text-2xl font-black text-emerald-400 mb-3 uppercase tracking-wide">
                  Genome Successfully Indexed
                </h3>
                <p className="text-sm text-slate-500 font-mono mb-6">
                  {telemetry.basesIndexed.toLocaleString()} bases • {telemetry.slabsAllocated} slabs allocated
                </p>
                
                <div className="inline-flex items-center gap-2 text-xs text-slate-600 uppercase tracking-widest">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Transitioning to Editor...
                </div>
              </motion.div>
            )}

            {phase === 'error' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-rose-500/20 mb-6">
                    <AlertCircle className="w-12 h-12 text-rose-400" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-xl font-black text-rose-400 mb-3 uppercase">
                    Ingestion Failed
                  </h3>
                  <p className="text-sm text-slate-500 max-w-md mx-auto">
                    {errorMessage || 'An unknown error occurred during ingestion'}
                  </p>
                </div>

                <button
                  onClick={handleRetry}
                  className={cn(
                    "w-full px-6 py-4 rounded-lg font-black text-sm uppercase tracking-widest",
                    "bg-cyan-500 text-black hover:bg-cyan-400 transition-all",
                    "shadow-lg shadow-cyan-500/20"
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4" />
                    Retry Ingestion
                  </div>
                </button>
              </motion.div>
            )}
          </div>
        </div>

        {/* Ambient DNA Particles */}
        {(phase === 'streaming' || phase === 'indexing') && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
            {[...Array(30)].map((_, i) => (
              <motion.div
                key={`particle-${i}`}
                initial={{
                  x: `${Math.random() * 100}%`,
                  y: '110%',
                  opacity: 0,
                }}
                animate={{
                  y: '-10%',
                  opacity: [0, 0.8, 0],
                }}
                transition={{
                  duration: 3 + Math.random() * 3,
                  repeat: Infinity,
                  delay: Math.random() * 2,
                  ease: 'linear',
                }}
                className={cn(
                  "absolute rounded-full",
                  i % 3 === 0 ? "w-1 h-1 bg-cyan-400" :
                  i % 3 === 1 ? "w-0.5 h-0.5 bg-emerald-400" :
                  "w-1.5 h-1.5 bg-cyan-300"
                )}
              />
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Capability Card Component
function CapabilityCard({ 
  icon, 
  label, 
  value, 
  color 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string;
  color: 'cyan' | 'emerald' | 'rose' | 'slate';
}) {
  const colorClasses = {
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    slate: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  };

  return (
    <div className={cn(
      "border rounded-lg p-4 transition-all hover:scale-105",
      colorClasses[color]
    )}>
      <div className="flex items-center justify-center mb-3">
        {icon}
      </div>
      <div className="text-[9px] text-slate-600 uppercase tracking-wider text-center mb-1">
        {label}
      </div>
      <div className="text-sm font-mono font-black text-center">
        {value}
      </div>
    </div>
  );
}

// Complexity calculation (GC-based + entropy)
function calculateComplexity(sequence: string): number {
  const length = sequence.length;
  
  // For large sequences (>10MB), use optimized counting
  let gcCount: number;
  if (length > 10 * 1024 * 1024) {
    gcCount = calculateGCCountBitwise(sequence);
  } else {
    gcCount = (sequence.match(/[GC]/g) || []).length;
  }
  
  const gcPercent = (gcCount / length) * 100;

  const counts: Record<string, number> = {};
  for (const base of sequence) {
    counts[base] = (counts[base] || 0) + 1;
  }

  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / length;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  const normalizedEntropy = (entropy / 2) * 100;
  const gcDeviation = Math.abs(gcPercent - 50);
  
  return Math.min(100, Math.max(0, (normalizedEntropy * 0.7) + ((50 - gcDeviation) * 0.3)));
}

// Optimized GC counting for large sequences
function calculateGCCountBitwise(sequence: string): number {
  let gc = 0;
  let i = 0;
  
  // Process in chunks for efficiency
  const chunkSize = 64;
  while (i + chunkSize <= sequence.length) {
    const chunk = sequence.slice(i, i + chunkSize);
    // Use regex on smaller chunks for better performance
    gc += (chunk.match(/[GC]/g) || []).length;
    i += chunkSize;
  }
  
  // Handle remaining characters
  if (i < sequence.length) {
    gc += (sequence.slice(i).match(/[GC]/g) || []).length;
  }
  
  return gc;
}
