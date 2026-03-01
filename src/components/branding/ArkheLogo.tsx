'use client';

/**
 * src/components/branding/ArkheLogo.tsx
 * ──────────────────────────────────────────────────────────────
 * SOVEREIGN ALIGNMENT FIX — HYDRATION WALL (Fix #2)
 *
 * Changes from previous version:
 *   1. useHasMounted guard — returns null on the server to eliminate
 *      SSR/CSR mismatch. The logo is decorative; a one-frame skip is
 *      invisible to the user and correct for the hydration contract.
 *   2. React.useId() for filter IDs — prevents <filter id="glow">
 *      collisions when multiple instances of ArkheLogo are mounted
 *      simultaneously (e.g. sidebar + auth page).
 *   3. ALL multi-line SVG path `d` attributes flattened to single lines —
 *      the SSR serialiser can produce attribute values with stray
 *      whitespace around newlines that differ from the hydrated DOM.
 *      Flat strings are bit-identical across server and client.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useId, useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// § SSR mount guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns false during SSR and the first client render tick, then flips to
 * true.  Components that contain SVG filters or any other DOM-divergent markup
 * should gate their render on this hook to avoid hydration mismatches.
 */
function useHasMounted(): boolean {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  return hasMounted;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Props
// ─────────────────────────────────────────────────────────────────────────────

interface LogoProps {
  /** Icon pixel size (width = height for icon, scales proportionally for full/wordmark). */
  size?: number;
  /** Render mode. Defaults to 'icon'. */
  variant?: 'icon' | 'wordmark' | 'full';
  /** Additional className forwarded to the root <svg> or <div>. */
  className?: string;
  /**
   * When true a feGaussianBlur glow filter is applied to the stroke group.
   * Uses a React.useId()-scoped filter ID so multiple instances do not fight
   * over the same id="glow" in the DOM.
   */
  glow?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ArkheLogo({
  size = 32,
  variant = 'icon',
  className = '',
  glow = false,
}: LogoProps) {
  const hasMounted = useHasMounted();
  // Generate a stable, unique ID scoped to this component instance.
  // React guarantees useId() produces the same string across renders for the
  // same component position in the tree — safe for SSR when guarded by
  // hasMounted above.
  const uid = useId().replace(/:/g, '');
  const filterId = `arkhe-glow-${uid}`;

  // ── SSR / Hydration guard ──────────────────────────────────────────────────
  // Return null on the server.  The parent layout has no layout-shift because
  // the element is positioned as an icon inside a nav/header with fixed dims.
  if (!hasMounted) {
    return (
      <span
        style={{ display: 'inline-block', width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  // ── ICON variant ───────────────────────────────────────────────────────────
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
        aria-label="Arkhé Genesis"
        role="img"
      >
        {glow && (
          <defs>
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
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
          filter={glow ? `url(#${filterId})` : undefined}
        >
          {/* Outer frame */}
          <circle cx="50" cy="50" r="38" opacity="0.15" />

          {/* Left strand — forms left leg of 'A'. Flattened to single line. */}
          <path d="M 32 18 C 22 28, 18 40, 18 50 C 18 60, 22 72, 32 82" strokeWidth="1.5" />

          {/* Right strand — forms right leg of 'A'. Flattened to single line. */}
          <path d="M 68 18 C 78 28, 82 40, 82 50 C 82 60, 78 72, 68 82" strokeWidth="1.5" />

          {/* Top connection — the apex of 'A'. Flattened. */}
          <path d="M 32 18 C 42 14, 58 14, 68 18" strokeWidth="1.2" opacity="0.8" />

          {/* Bottom connection. Flattened. */}
          <path d="M 32 82 C 42 86, 58 86, 68 82" strokeWidth="1.2" opacity="0.8" />

          {/* Crossbar — makes the 'A' letterform legible */}
          <line x1="35" y1="50" x2="65" y2="50" strokeWidth="1.5" opacity="0.7" />

          {/* DNA rung hints — subtle, evoke base-pair ladder */}
          <line x1="30" y1="32" x2="40" y2="32" opacity="0.25" strokeWidth="1" />
          <line x1="60" y1="38" x2="70" y2="38" opacity="0.25" strokeWidth="1" />
          <line x1="30" y1="62" x2="40" y2="62" opacity="0.25" strokeWidth="1" />
          <line x1="60" y1="68" x2="70" y2="68" opacity="0.25" strokeWidth="1" />

          {/* Singularity node */}
          <circle cx="50" cy="50" r="1.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>
    );
  }

  // ── WORDMARK variant ───────────────────────────────────────────────────────
  if (variant === 'wordmark') {
    const wWidth = size * 3.5;
    return (
      <svg
        width={wWidth}
        height={size}
        viewBox="0 0 200 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'block' }}
        aria-label="Arkhé Genesis"
        role="img"
      >
        {/* Arkhé — sovereign white */}
        <text
          x="0"
          y="30"
          fill="currentColor"
          fontFamily="var(--font-inter), system-ui, sans-serif"
          fontSize="24"
          fontWeight="500"
          letterSpacing="-0.02em"
        >
          Arkh
        </text>
        {/* é — slight optical accent */}
        <text
          x="58"
          y="30"
          fill="currentColor"
          fontFamily="var(--font-inter), system-ui, sans-serif"
          fontSize="24"
          fontWeight="500"
          letterSpacing="-0.02em"
          opacity="0.85"
        >
          é
        </text>
        {/* Genesis — arctic-teal accent */}
        <text
          x="78"
          y="30"
          fill="#38BDF8"
          fontFamily="var(--font-inter), system-ui, sans-serif"
          fontSize="24"
          fontWeight="500"
          letterSpacing="-0.02em"
        >
          Genesis
        </text>
      </svg>
    );
  }

  // ── FULL variant (icon + wordmark horizontal) ──────────────────────────────
  const fullWidth = size + 12 + size * 3.5;
  return (
    <div
      className={className}
      style={{
        display:    'inline-flex',
        alignItems: 'center',
        gap:        '10px',
      }}
      aria-label="Arkhé Genesis"
      role="img"
    >
      {/* Re-use the icon variant without the glow to keep the full mark lightweight */}
      <ArkheLogo size={size} variant="icon" glow={glow} />
      <ArkheLogo size={size} variant="wordmark" />
    </div>
  );
}