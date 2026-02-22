'use client';

import { useState, useEffect } from 'react';
import { X, ChevronRight } from 'lucide-react';

interface OnboardingOverlayProps {
  onClose: () => void;
}

export default function OnboardingOverlay({ onClose }: OnboardingOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Welcome to Arkhé Genesis",
      description: "The premier genomic IDE for modern bioinformatics research and analysis.",
      icon: "🧬"
    },
    {
      title: "The Editor (Center)",
      description: "View and analyze DNA sequences with our advanced visualization tools.",
      icon: "🧬"
    },
    {
      title: "Chronos (Right)",
      description: "Time travel through your genome's version history and track changes.",
      icon: "⏰"
    },
    {
      title: "Sentinel (Left)",
      description: "AI-powered safety audit system for genomic data integrity.",
      icon: "🛡️"
    }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    localStorage.setItem('seen_intro', 'true');
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'ArrowRight') {
      handleNext();
    } else if (e.key === 'ArrowLeft') {
      handlePrevious();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-void/90 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-void-panel border border-razor rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-razor">
          <div className="flex items-center gap-3">
            <div className="text-xs text-quaternary uppercase tracking-wider">
              Step {currentStep + 1} of {steps.length}
            </div>
            <div className="flex gap-1">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentStep ? 'bg-primary' : 'bg-void-surface'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-void-surface rounded transition-colors"
          >
            <X size={16} className="text-quaternary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="text-4xl mb-4">{steps[currentStep].icon}</div>
            <h2 className="text-xl font-medium text-primary mb-2">
              {steps[currentStep].title}
            </h2>
            <p className="text-sm text-secondary leading-relaxed">
              {steps[currentStep].description}
            </p>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="flex items-center gap-2 px-4 py-2 bg-void-surface border border-razor rounded-md text-sm text-quaternary hover:bg-void-elevated hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-void rounded-md text-sm font-medium hover:bg-secondary transition-colors"
            >
              {currentStep === steps.length - 1 ? 'Get Started' : 'Next'}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
