'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Info } from 'lucide-react';

interface CodonOptimizerToggleProps {
  sequence: string;
  onChange?: (optimized: boolean) => void;
}

/**
 * CODON OPTIMIZER TOGGLE - iOS Glass Style with Digital Rain
 * Features: Sleek glass toggle, Matrix-style digital rain transition
 */
export default function CodonOptimizerToggle({ sequence, onChange }: CodonOptimizerToggleProps) {
  const [isOptimized, setIsOptimized] = useState(false);
  const [showRain, setShowRain] = useState(false);
  const [rainChars, setRainChars] = useState<Array<{ char: string; x: number; delay: number }>>([]);

  // Generate random DNA characters for rain effect
  const generateRainChars = () => {
    const bases = ['A', 'T', 'C', 'G'];
    const chars = [];
    for (let i = 0; i < 50; i++) {
      chars.push({
        char: bases[Math.floor(Math.random() * bases.length)],
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
      });
    }
    return chars;
  };

  const handleToggle = () => {
    const newState = !isOptimized;
    
    // Trigger digital rain
    setShowRain(true);
    setRainChars(generateRainChars());
    
    // Change state after rain starts
    setTimeout(() => {
      setIsOptimized(newState);
      onChange?.(newState);
    }, 200);
    
    // Hide rain after animation
    setTimeout(() => {
      setShowRain(false);
    }, 1500);
  };

  return (
    <div className="relative">
      {/* Digital Rain Overlay */}
      <AnimatePresence>
        {showRain && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 pointer-events-none overflow-hidden bg-void/30 backdrop-blur-sm"
          >
            <svg className="absolute inset-0 w-full h-full">
              {rainChars.map((item, i) => (
                <motion.text
                  key={i}
                  x={`${item.x}%`}
                  y="-20"
                  fill={isOptimized ? '#10b981' : '#06b6d4'}
                  fontSize="20"
                  fontFamily="monospace"
                  fontWeight="bold"
                  opacity="0.8"
                  initial={{ y: -20 }}
                  animate={{ y: '110vh' }}
                  transition={{
                    duration: 1.5,
                    delay: item.delay,
                    ease: "linear"
                  }}
                  style={{
                    filter: `drop-shadow(0 0 6px ${isOptimized ? '#10b981' : '#06b6d4'})`,
                  }}
                >
                  {item.char}
                </motion.text>
              ))}
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Toggle Container */}
      <div className="flex items-center justify-between p-4 bg-void-panel border border-razor rounded-lg backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div 
            className={`p-2 rounded-lg transition-all ${
              isOptimized 
                ? 'bg-emerald-500/20 text-emerald-400' 
                : 'bg-cyan-500/20 text-cyan-400'
            }`}
          >
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Codon Optimization</div>
            <div className="text-xs text-zinc-500">
              {isOptimized ? 'Sequence optimized for expression' : 'Using original codons'}
            </div>
          </div>
        </div>

        {/* iOS-Style Glass Toggle */}
        <button
          onClick={handleToggle}
          className={`
            relative w-16 h-8 rounded-full transition-all duration-300
            ${isOptimized 
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' 
              : 'bg-zinc-700'
            }
          `}
          style={{
            boxShadow: isOptimized 
              ? '0 0 20px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
              : 'inset 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          }}
        >
          {/* Glass Ball */}
          <motion.div
            className="absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg"
            style={{
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 1), rgba(240, 240, 240, 1))',
            }}
            animate={{
              x: isOptimized ? 32 : 4,
            }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 30
            }}
          >
            {/* Glass reflection */}
            <div 
              className="absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-white opacity-40"
              style={{
                filter: 'blur(1px)',
              }}
            />
          </motion.div>

          {/* Inner glow when active */}
          {isOptimized && (
            <motion.div
              className="absolute inset-1 rounded-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.3, 0.5, 0.3] }}
              transition={{
                duration: 2,
                repeat: Infinity,
              }}
              style={{
                background: 'radial-gradient(circle, rgba(16, 185, 129, 0.4), transparent)',
              }}
            />
          )}
        </button>
      </div>

      {/* Info Panel */}
      <AnimatePresence>
        {isOptimized && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg backdrop-blur-md">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-300">
                  <p className="font-bold mb-1">Optimization Active</p>
                  <p className="text-emerald-400/80">
                    Codons replaced with high-frequency alternatives for maximum expression in 
                    <span className="font-mono"> E. coli</span>. GC content adjusted to 45-55%.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}