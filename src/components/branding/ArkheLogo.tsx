'use client';

import React from 'react';

interface LogoProps {
  size?: number;
  variant?: 'icon' | 'wordmark' | 'full';
  className?: string;
  glow?: boolean;
}

/**
 * ARKHÉ GENESIS - The Singularity Helix (Refined)
 * 
 * The most iconic logo for a genomic IDE:
 * - Double helix forms a perfect circle
 * - Negative space creates a capital 'A'
 * - Razor-thin 1px strokes
 * - Mathematical precision
 * 
 * Variants:
 * - icon: Just the mark (square ratio)
 * - wordmark: Just the text
 * - full: Mark + text (horizontal)
 */
export default function ArkheLogo({ 
  size = 32,
  variant = 'icon',
  className = '',
  glow = false,
}: LogoProps) {
  
  if (variant === 'icon') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'block' }}
      >
        {glow && (
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        )}
        
        <g
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={glow ? "url(#glow)" : undefined}
        >
          {/* Perfect Circle Frame */}
          <circle cx="50" cy="50" r="38" opacity="0.15" />
          
          {/* Left Strand - Forms left side of 'A' */}
          <path
            d="M 32 18
               C 22 28, 18 40, 18 50
               C 18 60, 22 72, 32 82"
            strokeWidth="1.5"
          />
          
          {/* Right Strand - Forms right side of 'A' */}
          <path
            d="M 68 18
               C 78 28, 82 40, 82 50
               C 82 60, 78 72, 68 82"
            strokeWidth="1.5"
          />
          
          {/* Top Connection */}
          <path
            d="M 32 18
               C 42 14, 58 14, 68 18"
            strokeWidth="1.2"
            opacity="0.8"
          />
          
          {/* Bottom Connection */}
          <path
            d="M 32 82
               C 42 86, 58 86, 68 82"
            strokeWidth="1.2"
            opacity="0.8"
          />
          
          {/* Center Crossbar - Makes the 'A' visible */}
          <line
            x1="35"
            y1="50"
            x2="65"
            y2="50"
            strokeWidth="1.5"
            opacity="0.7"
          />
          
          {/* DNA Base Pairs (subtle rungs) */}
          <line x1="30" y1="32" x2="40" y2="32" opacity="0.25" strokeWidth="1" />
          <line x1="60" y1="38" x2="70" y2="38" opacity="0.25" strokeWidth="1" />
          <line x1="30" y1="62" x2="40" y2="62" opacity="0.25" strokeWidth="1" />
          <line x1="60" y1="68" x2="70" y2="68" opacity="0.25" strokeWidth="1" />
          
          {/* Center Point - The Singularity */}
          <circle cx="50" cy="50" r="1.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>
    );
  }

  if (variant === 'wordmark') {
    const height = size;
    const width = size * 3.5;
    
    return (
      <svg
        width={width}
        height={height}
        viewBox="0 0 200 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'block' }}
      >
        <text
          x="0"
          y="30"
          fill="currentColor"
          fontFamily="var(--font-inter), system-ui, sans-serif"
          fontSize="24"
          fontWeight="500"
          letterSpacing="-0.02em"
        >
          Arkhé Genesis
        </text>
      </svg>
    );
  }

  // Full variant (icon + wordmark)
  const height = size;
  const width = size * 5;
  
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 240 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block' }}
    >
      {glow && (
        <defs>
          <filter id="glow-full" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      
      {/* Icon */}
      <g
        transform="translate(4, 4)"
        stroke="currentColor"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        filter={glow ? "url(#glow-full)" : undefined}
      >
        <circle cx="20" cy="20" r="15" opacity="0.12" />
        
        <path d="M 12 8 C 8 11, 6 16, 6 20 C 6 24, 8 29, 12 32" strokeWidth="1" />
        <path d="M 28 8 C 32 11, 34 16, 34 20 C 34 24, 32 29, 28 32" strokeWidth="1" />
        <path d="M 12 8 C 17 6, 23 6, 28 8" strokeWidth="0.8" opacity="0.8" />
        <path d="M 12 32 C 17 34, 23 34, 28 32" strokeWidth="0.8" opacity="0.8" />
        <line x1="14" y1="20" x2="26" y2="20" strokeWidth="1" opacity="0.7" />
        
        <line x1="11" y1="13" x2="16" y2="13" opacity="0.2" />
        <line x1="24" y1="16" x2="29" y2="16" opacity="0.2" />
        <line x1="11" y1="25" x2="16" y2="25" opacity="0.2" />
        <line x1="24" y1="28" x2="29" y2="28" opacity="0.2" />
        
        <circle cx="20" cy="20" r="0.8" fill="currentColor" opacity="0.5" />
      </g>
      
      {/* Wordmark */}
      <text
        x="56"
        y="32"
        fill="currentColor"
        fontFamily="var(--font-inter), system-ui, sans-serif"
        fontSize="20"
        fontWeight="500"
        letterSpacing="-0.02em"
      >
        Arkhé Genesis
      </text>
    </svg>
  );
}

/**
 * USAGE EXAMPLES:
 * 
 * // Icon only (sidebar)
 * <ArkheLogo size={24} variant="icon" />
 * 
 * // Icon with glow
 * <ArkheLogo size={32} variant="icon" glow />
 * 
 * // Full logo (header)
 * <ArkheLogo size={32} variant="full" className="text-white" />
 * 
 * // Wordmark only
 * <ArkheLogo size={24} variant="wordmark" />
 */