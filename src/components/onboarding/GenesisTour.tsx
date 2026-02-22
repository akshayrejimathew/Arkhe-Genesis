'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X, Lightbulb } from 'lucide-react';

interface TourStep {
  id: string;
  title: string;
  description: string;
  targetElement: string; // CSS selector
  position: 'top' | 'bottom' | 'left' | 'right';
}

interface GenesisTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * GENESIS TOUR - Spotlight Onboarding
 * Features: Circular clip-path spotlight, smooth transitions, professional guidance
 */
export default function GenesisTour({ steps, onComplete, onSkip }: GenesisTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightPos, setSpotlightPos] = useState({ x: 0, y: 0, radius: 150 });
  const [isVisible, setIsVisible] = useState(true);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  // Update spotlight position when step changes
  useEffect(() => {
    if (!step) return;

    const updateSpotlight = () => {
      const element = document.querySelector(step.targetElement);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) / 2 + 100;

      setSpotlightPos({ x: centerX, y: centerY, radius });
    };

    updateSpotlight();
    window.addEventListener('resize', updateSpotlight);
    return () => window.removeEventListener('resize', updateSpotlight);
  }, [step]);

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    setTimeout(() => onComplete(), 300);
  };

  const handleSkip = () => {
    setIsVisible(false);
    setTimeout(() => onSkip(), 300);
  };

  // Get tooltip position
  const getTooltipPosition = () => {
    const element = document.querySelector(step.targetElement);
    if (!element) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const rect = element.getBoundingClientRect();
    const tooltipWidth = 400;
    const tooltipHeight = 200;
    const offset = 20;

    switch (step.position) {
      case 'top':
        return {
          top: `${rect.top - tooltipHeight - offset}px`,
          left: `${rect.left + rect.width / 2}px`,
          transform: 'translateX(-50%)',
        };
      case 'bottom':
        return {
          top: `${rect.bottom + offset}px`,
          left: `${rect.left + rect.width / 2}px`,
          transform: 'translateX(-50%)',
        };
      case 'left':
        return {
          top: `${rect.top + rect.height / 2}px`,
          left: `${rect.left - tooltipWidth - offset}px`,
          transform: 'translateY(-50%)',
        };
      case 'right':
        return {
          top: `${rect.top + rect.height / 2}px`,
          left: `${rect.right + offset}px`,
          transform: 'translateY(-50%)',
        };
      default:
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Spotlight Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] pointer-events-none"
            style={{
              background: '#000000',
              WebkitMaskImage: `radial-gradient(circle ${spotlightPos.radius}px at ${spotlightPos.x}px ${spotlightPos.y}px, transparent 0%, transparent 70%, black 100%)`,
              maskImage: `radial-gradient(circle ${spotlightPos.radius}px at ${spotlightPos.x}px ${spotlightPos.y}px, transparent 0%, transparent 70%, black 100%)`,
              opacity: 0.92,
              transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />

          {/* Spotlight Ring */}
          <motion.div
            className="fixed z-[10000] pointer-events-none"
            style={{
              left: spotlightPos.x,
              top: spotlightPos.y,
              width: spotlightPos.radius * 2,
              height: spotlightPos.radius * 2,
              marginLeft: -spotlightPos.radius,
              marginTop: -spotlightPos.radius,
            }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <motion.div
              className="absolute inset-0 rounded-full border-4 border-cyan-400"
              animate={{
                opacity: [0.3, 0.6, 0.3],
                scale: [1, 1.05, 1],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              style={{
                boxShadow: '0 0 40px rgba(6, 182, 212, 0.6), inset 0 0 40px rgba(6, 182, 212, 0.3)',
              }}
            />
          </motion.div>

          {/* Tooltip Card */}
          <motion.div
            key={currentStep}
            className="fixed z-[10001] pointer-events-auto"
            style={getTooltipPosition()}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
          >
            <div className="w-[400px] bg-void-panel border border-razor rounded-lg overflow-hidden backdrop-blur-xl shadow-2xl">
              {/* Header */}
              <div className="p-4 border-b border-razor bg-void-surface/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-cyan-500/20 rounded">
                    <Lightbulb className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{step.title}</div>
                    <div className="text-[10px] text-zinc-600 font-mono">
                      Step {currentStep + 1} of {steps.length}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleSkip}
                  className="p-1 hover:bg-white/5 rounded transition-colors"
                  title="Skip tour"
                >
                  <X size={16} className="text-zinc-500" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4">
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {step.description}
                </p>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-razor bg-void/50 flex items-center justify-between">
                {/* Progress Dots */}
                <div className="flex items-center gap-1.5">
                  {steps.map((_, idx) => (
                    <motion.div
                      key={idx}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === currentStep
                          ? 'w-8 bg-cyan-400'
                          : idx < currentStep
                          ? 'w-1.5 bg-emerald-500'
                          : 'w-1.5 bg-zinc-700'
                      }`}
                      animate={idx === currentStep ? {
                        opacity: [0.5, 1, 0.5],
                      } : {}}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                      }}
                    />
                  ))}
                </div>

                {/* Navigation */}
                <div className="flex items-center gap-2">
                  {!isFirst && (
                    <button
                      onClick={handlePrev}
                      className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft size={14} />
                      Back
                    </button>
                  )}
                  <button
                    onClick={handleNext}
                    className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-mono uppercase tracking-wider rounded transition-all flex items-center gap-1 shadow-glow-cyan"
                  >
                    {isLast ? 'Complete Tour' : 'Next'}
                    {!isLast && <ChevronRight size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Arrow pointer */}
            <div
              className="absolute w-0 h-0 border-8"
              style={
                step.position === 'top'
                  ? {
                      bottom: '-16px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      borderLeft: '8px solid transparent',
                      borderRight: '8px solid transparent',
                      borderTop: '8px solid rgba(39, 39, 42, 0.95)',
                    }
                  : step.position === 'bottom'
                  ? {
                      top: '-16px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      borderLeft: '8px solid transparent',
                      borderRight: '8px solid transparent',
                      borderBottom: '8px solid rgba(39, 39, 42, 0.95)',
                    }
                  : step.position === 'left'
                  ? {
                      top: '50%',
                      right: '-16px',
                      transform: 'translateY(-50%)',
                      borderTop: '8px solid transparent',
                      borderBottom: '8px solid transparent',
                      borderLeft: '8px solid rgba(39, 39, 42, 0.95)',
                    }
                  : {
                      top: '50%',
                      left: '-16px',
                      transform: 'translateY(-50%)',
                      borderTop: '8px solid transparent',
                      borderBottom: '8px solid transparent',
                      borderRight: '8px solid rgba(39, 39, 42, 0.95)',
                    }
              }
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Example usage:
/*
const tourSteps: TourStep[] = [
  {
    id: 'file-upload',
    title: 'Welcome to Arkhé Genesis',
    description: 'Start by uploading your genome file (FASTA, GenBank, or AB1). Your sequence will be loaded into the editor instantly.',
    targetElement: '[data-tour="file-upload"]',
    position: 'bottom',
  },
  {
    id: 'sequence-editor',
    title: 'Sequence Editor',
    description: 'This is your main workspace. Edit bases, select regions, and perform surgical genomic operations.',
    targetElement: '[data-tour="sequence-editor"]',
    position: 'left',
  },
  {
    id: 'chronos-panel',
    title: 'Chronos Version Control',
    description: 'Every edit is tracked. Navigate your genome\'s history, revert changes, and create branches.',
    targetElement: '[data-tour="chronos"]',
    position: 'left',
  },
  {
    id: 'sentinel-panel',
    title: 'Sentinel Security',
    description: 'AI-powered safety scanner. Detects bio-hazards and ensures your sequence is safe for synthesis.',
    targetElement: '[data-tour="sentinel"]',
    position: 'right',
  },
  {
    id: 'surgical-toolbar',
    title: 'Surgical Tools',
    description: 'Cut, copy, paste, find-replace, and more. Professional genome editing at your fingertips.',
    targetElement: '[data-tour="toolbar"]',
    position: 'bottom',
  },
];
*/