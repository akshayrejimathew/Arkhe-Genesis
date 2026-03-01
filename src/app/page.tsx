'use client';

/**
 * src/app/page.tsx
 * ──────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — SOVEREIGN ENTRY GATE
 * "The Void Before Sequence"
 *
 * SOVEREIGN ALIGNMENT FIX — AUTH PARADOX (Fix #1)
 *
 * Root cause: handleBeginSession() previously only flipped local React state
 * to reveal the Workbench. It never wrote a user object to the Zustand store.
 * Any child component that calls loadFile() (or any action that destructures
 * `user` from store state) immediately crashed because user === null.
 *
 * Fix: handleBeginSession() now calls setUser() with a synthetic guest-session
 * object that satisfies the full Supabase User interface *before* the overlay
 * begins its exit animation. The workbench mounts into an already-authenticated
 * store state.
 *
 * The synthetic user is clearly marked as a local guest session; it is not
 * transmitted to any Supabase endpoint. Production auth flows (login / signup
 * pages) call setUser() with a real Supabase User object — this mock only
 * covers the sovereign / offline session path entered from this page.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dna, ArrowRight, Zap } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import Workbench from '@/components/layout/Workbench';
import { useArkheStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// § Synthetic guest user
//
// Satisfies the Supabase User shape so every store action that reads user.id
// or user.email gets a defined value rather than crashing on null.
//
// Fields that are not relevant to local sovereign sessions are set to their
// zero/empty defaults to keep the object clearly inert.
// ─────────────────────────────────────────────────────────────────────────────

const GUEST_USER: User = {
  id:               'guest-sovereign-local',
  aud:              'authenticated',
  role:             'authenticated',
  email:            'sovereign@local.arkhe',
  email_confirmed_at: new Date(0).toISOString(),
  phone:            '',
  confirmation_sent_at: undefined,
  confirmed_at:     new Date(0).toISOString(),
  last_sign_in_at:  new Date().toISOString(),
  app_metadata:     { provider: 'sovereign', providers: ['sovereign'] },
  user_metadata:    { name: 'Sovereign Researcher', sovereign: true },
  identities:       [],
  created_at:       new Date(0).toISOString(),
  updated_at:       new Date().toISOString(),
  is_anonymous:     false,
  factors:          [],
};

// ─────────────────────────────────────────────────────────────────────────────
// § Ambient particle config
// Generated deterministically to avoid SSR / CSR mismatch.
// ─────────────────────────────────────────────────────────────────────────────

interface Particle {
  id:       number;
  x:        number;
  y:        number;
  size:     number;
  duration: number;
  delay:    number;
  opacity:  number;
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id:       i,
    x:        (i * 73 + 17) % 100,
    y:        (i * 41 + 53) % 100,
    size:     1 + ((i * 31) % 3),
    duration: 4 + ((i * 19) % 6),
    delay:    (i * 0.23) % 3,
    opacity:  0.08 + ((i * 7) % 5) * 0.04,
  }));
}

const PARTICLES = generateParticles(40);

const AMBIENT_SEQUENCE =
  'ATCGATCGATCGGCTAGCTAGCATCGATCGATCGGCTAGCTAGCATCGATCGATCGGCTAGCTAGCATCG';

const BASE_COLORS: Record<string, string> = {
  A: '#4ADE80', T: '#FB7185', C: '#38BDF8', G: '#FACC15',
};

// ─────────────────────────────────────────────────────────────────────────────
// § Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SovereignEntry() {
  const setUser       = useArkheStore((s) => s.setUser);

  const [hasInitialized,  setHasInitialized]  = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [typedSequence,   setTypedSequence]   = useState('');
  const [scanlineY,       setScanlineY]       = useState(0);
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Ambient typewriter ─────────────────────────────────────────────────────
  useEffect(() => {
    let i = 0;
    typeTimerRef.current = setInterval(() => {
      if (i <= AMBIENT_SEQUENCE.length) {
        setTypedSequence(AMBIENT_SEQUENCE.slice(0, i));
        i++;
      } else {
        i = 0;
        setTypedSequence('');
      }
    }, 55);
    return () => {
      if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    };
  }, []);

  // ── Scanline ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let frame: number;
    let startTime: number | null = null;
    const animate = (ts: number) => {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000;
      setScanlineY((elapsed % 6) / 6);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // § AUTH PARADOX FIX
  //
  // setUser() is called SYNCHRONOUSLY before the overlay's exit animation
  // begins. By the time <Workbench> receives pointer-events (800 ms later)
  // the store already carries a valid user object, so loadFile() and every
  // other action that reads `user` will never see null.
  // ─────────────────────────────────────────────────────────────────────────
  const handleBeginSession = () => {
    // 1. Write synthetic guest user to the store — MUST happen before
    //    Workbench is interactive.
    setUser(GUEST_USER);

    // 2. Begin the visual transition.
    setIsTransitioning(true);
    setTimeout(() => setHasInitialized(true), 800);
  };

  return (
    <>
      {/* ── Workstation — always mounted, hidden until session begins ── */}
      <div
        style={{
          position:      'fixed',
          inset:         0,
          visibility:    hasInitialized ? 'visible' : 'hidden',
          pointerEvents: hasInitialized ? 'auto'    : 'none',
        }}
      >
        <Workbench />
      </div>

      {/* ── Sovereign Entry Overlay ── */}
      <AnimatePresence>
        {!hasInitialized && (
          <motion.div
            key="entry-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            style={{
              position:       'fixed',
              inset:          0,
              zIndex:         9999,
              background:     '#020617',
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              overflow:       'hidden',
              fontFamily:     'var(--font-jetbrains-mono, monospace)',
            }}
          >
            {/* Ambient particle field */}
            {PARTICLES.map((p) => (
              <motion.div
                key={p.id}
                style={{
                  position:      'absolute',
                  left:          `${p.x}%`,
                  top:           `${p.y}%`,
                  width:         `${p.size}px`,
                  height:        `${p.size}px`,
                  borderRadius:  '50%',
                  background:    '#38BDF8',
                  opacity:       p.opacity,
                  pointerEvents: 'none',
                }}
                animate={{ y: [0, -24, 0], opacity: [p.opacity, p.opacity * 3.5, p.opacity] }}
                transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
              />
            ))}

            {/* Scanline */}
            <div
              style={{
                position:      'absolute',
                left:          0,
                right:         0,
                top:           `${scanlineY * 100}%`,
                height:        '1px',
                background:    'linear-gradient(90deg, transparent 0%, rgba(56,189,248,0.12) 30%, rgba(56,189,248,0.30) 50%, rgba(56,189,248,0.12) 70%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />

            {/* Grid overlay */}
            <div
              style={{
                position:       'absolute',
                inset:          0,
                background:     'linear-gradient(rgba(56,189,248,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.025) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
                pointerEvents:  'none',
              }}
            />

            {/* Radial vignette */}
            <div
              style={{
                position:      'absolute',
                inset:         0,
                background:    'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(56,189,248,0.06) 0%, transparent 65%)',
                pointerEvents: 'none',
              }}
            />

            {/* Ambient DNA type-on (bottom) */}
            <div
              style={{
                position:      'absolute',
                bottom:        '24px',
                left:          '50%',
                transform:     'translateX(-50%)',
                display:       'flex',
                gap:           '1px',
                pointerEvents: 'none',
                opacity:       0.4,
              }}
            >
              {typedSequence.split('').map((base, i) => (
                <span
                  key={i}
                  style={{ fontSize: '11px', color: BASE_COLORS[base] ?? '#334155', letterSpacing: '0.08em' }}
                >
                  {base}
                </span>
              ))}
              <span style={{ fontSize: '11px', color: '#38BDF8', animation: 'terminal-cursor 1.1s step-end infinite' }}>
                ▌
              </span>
            </div>

            {/* Central card */}
            <motion.div
              initial={{ opacity: 0, y: 32, scale: 0.95 }}
              animate={{ opacity: 1, y: 0,  scale: 1.0  }}
              transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
              style={{
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            '0',
                padding:        '52px 64px',
                borderRadius:   '12px',
                background:     'rgba(9,15,28,0.90)',
                border:         '1px solid rgba(255,255,255,0.07)',
                backdropFilter: 'blur(32px)',
                boxShadow:      '0 32px 96px rgba(2,6,23,0.70), 0 0 0 1px rgba(56,189,248,0.06)',
                position:       'relative',
                overflow:       'hidden',
                maxWidth:       '440px',
                width:          'calc(100% - 48px)',
              }}
            >
              {/* Top-edge accent line */}
              <div
                style={{
                  position:   'absolute',
                  top:        0,
                  left:       '20%',
                  right:      '20%',
                  height:     '1px',
                  background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.60), transparent)',
                }}
              />

              {/* Logo mark */}
              <motion.div
                animate={{
                  filter: [
                    'drop-shadow(0 0 8px rgba(56,189,248,0.30))',
                    'drop-shadow(0 0 20px rgba(56,189,248,0.55))',
                    'drop-shadow(0 0 8px rgba(56,189,248,0.30))',
                  ],
                }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{ marginBottom: '32px' }}
              >
                <Dna size={48} strokeWidth={1.2} style={{ color: '#38BDF8' }} />
              </motion.div>

              {/* Wordmark */}
              <div style={{ marginBottom: '8px', textAlign: 'center' }}>
                <h1
                  style={{
                    fontSize:      '28px',
                    fontWeight:    700,
                    color:         '#F8FAFC',
                    letterSpacing: '-0.04em',
                    lineHeight:    1,
                    margin:        0,
                    fontFamily:    'var(--font-inter, system-ui, sans-serif)',
                  }}
                >
                  Arkhé<span style={{ color: '#38BDF8' }}>Genesis</span>
                </h1>
              </div>

              {/* Version badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '36px' }}>
                <Zap size={9} style={{ color: '#334155' }} />
                <span
                  style={{
                    fontSize:      '9px',
                    fontWeight:    700,
                    letterSpacing: '0.20em',
                    textTransform: 'uppercase',
                    color:         '#334155',
                  }}
                >
                  Sovereign Genomic IDE · v10.0
                </span>
              </div>

              {/* Tagline */}
              <p
                style={{
                  fontSize:    '12px',
                  color:       '#475569',
                  textAlign:   'center',
                  lineHeight:  1.7,
                  marginBottom:'40px',
                  maxWidth:    '300px',
                }}
              >
                A clinical-grade environment for genome analysis,
                mutation engineering, and sovereign sequence control.
              </p>

              {/* CTA button */}
              <motion.button
                onClick={handleBeginSession}
                disabled={isTransitioning}
                whileHover={{ scale: isTransitioning ? 1 : 1.02 }}
                whileTap={{  scale: isTransitioning ? 1 : 0.97 }}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            '10px',
                  padding:        '14px 32px',
                  borderRadius:   '6px',
                  background:     isTransitioning ? 'rgba(56,189,248,0.10)' : '#38BDF8',
                  border:         isTransitioning ? '1px solid rgba(56,189,248,0.30)' : 'none',
                  color:          isTransitioning ? '#38BDF8' : '#020617',
                  cursor:         isTransitioning ? 'not-allowed' : 'pointer',
                  fontSize:       '12.5px',
                  fontWeight:     700,
                  letterSpacing:  '0.06em',
                  textTransform:  'uppercase',
                  fontFamily:     'var(--font-jetbrains-mono, monospace)',
                  transition:     'all 200ms',
                  boxShadow:      isTransitioning
                    ? 'none'
                    : '0 0 24px rgba(56,189,248,0.35), 0 4px 16px rgba(2,6,23,0.50)',
                  width:          '100%',
                  justifyContent: 'center',
                }}
              >
                {isTransitioning ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <Dna size={14} />
                    </motion.div>
                    Initializing Session…
                  </>
                ) : (
                  <>
                    Begin Session
                    <ArrowRight size={14} />
                  </>
                )}
              </motion.button>

              {/* Footer */}
              <p
                style={{
                  marginTop:     '20px',
                  fontSize:      '10px',
                  color:         '#1E293B',
                  textAlign:     'center',
                  letterSpacing: '0.04em',
                }}
              >
                All genomic data processed locally · Zero telemetry
              </p>
            </motion.div>

            {/* Corner decorators */}
            {([
              { top: '24px',    left:  '24px',  borderTop:    '1px solid', borderLeft:   '1px solid' },
              { top: '24px',    right: '24px',  borderTop:    '1px solid', borderRight:  '1px solid' },
              { bottom: '24px', left:  '24px',  borderBottom: '1px solid', borderLeft:   '1px solid' },
              { bottom: '24px', right: '24px',  borderBottom: '1px solid', borderRight:  '1px solid' },
            ] as React.CSSProperties[]).map((style, i) => (
              <div
                key={i}
                style={{
                  position:    'absolute',
                  width:       '20px',
                  height:      '20px',
                  borderColor: 'rgba(56,189,248,0.20)',
                  pointerEvents: 'none',
                  ...style,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}