'use client';

/**
 * src/app/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Landing Page
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REPLACES the previous "Sovereign Entry Gate" (guest-only shortcut).
 *
 * The old page mounted <Workbench /> directly behind a splash overlay, creating
 * a synthetic guest user to bypass auth. That pattern is removed. Auth now flows
 * correctly through the existing Supabase routes:
 *
 *   "Create Free Account" → /auth/signup → (sets isFirstTimeUser=true) → /workbench
 *   "Log In"              → /login                                      → /workbench
 *   "Guest mode" note     → /login  (AuthOverlay already has "Open Access" tab)
 *
 * Uses ArkheLogo from @/components/branding/ArkheLogo (the real SVG mark).
 * All design tokens mirror globals.css / tailwind.config.ts exactly.
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  Shield, Database, Dna, Terminal, Zap, Lock,
  ChevronRight, ArrowRight, CheckCircle2, Cpu,
  GitBranch, FlaskConical, Globe, UserPlus, LogIn,
  Microscope, Atom,
} from 'lucide-react';
import ArkheLogo from '@/components/branding/ArkheLogo';

// ─────────────────────────────────────────────────────────────────────────────
// § Design tokens  (mirrors globals.css @theme exactly)
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  abyss:    '#020617',
  void:     '#0F172A',
  panel:    '#0D1B2E',
  surface:  '#1E293B',
  raised:   '#334155',
  accent:   '#38BDF8',
  baseA:    '#4ADE80',
  baseT:    '#FB7185',
  baseC:    '#38BDF8',
  baseG:    '#FACC15',
  textSov:  '#F8FAFC',
  textPri:  '#E2E8F0',
  textSec:  '#94A3B8',
  textMut:  '#64748B',
  textGhost:'#334155',
  success:  '#10B981',
  warning:  '#F59E0B',
  purple:   '#A78BFA',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// § Ambient DNA helix canvas
// ─────────────────────────────────────────────────────────────────────────────
function DNAHelixCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const COLS = [T.baseA, T.baseT, T.baseC, T.baseG];
    const STRANDS = 4, RUNGS = 28, PITCH = 80, AMP = 36;
    let t = 0;

    const draw = () => {
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      for (let s = 0; s < STRANDS; s++) {
        const cx = (s + 0.5) * (W / STRANDS);
        const ph = (s / STRANDS) * Math.PI * 2;

        // backbone
        for (let side = 0; side < 2; side++) {
          ctx.beginPath();
          for (let i = 0; i <= RUNGS * 2; i++) {
            const y = (i / (RUNGS * 2)) * H;
            const a = (y / PITCH) * Math.PI * 2 + t + ph;
            const x = cx + Math.sin(a + side * Math.PI) * AMP;
            ctx.strokeStyle = `rgba(56,189,248,${0.04 + 0.04 * Math.sin(a)})`;
            ctx.lineWidth = 1;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // rungs + dots
        for (let i = 0; i < RUNGS; i++) {
          const y = ((i + 0.5) / RUNGS) * H;
          const a = (y / PITCH) * Math.PI * 2 + t + ph;
          const x1 = cx + Math.sin(a) * AMP;
          const x2 = cx + Math.sin(a + Math.PI) * AMP;
          const d  = (Math.sin(a) + 1) * 0.5;
          const col = COLS[(i + s * 4) % 4];

          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y);
          ctx.strokeStyle = col + '22'; ctx.lineWidth = 1; ctx.stroke();

          for (const bx of [x1, x2]) {
            ctx.beginPath();
            ctx.arc(bx, y, 1.5 + d * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = col + Math.round((0.08 + d * 0.28) * 255).toString(16).padStart(2, '0');
            ctx.shadowColor = col; ctx.shadowBlur = 5 * d;
            ctx.fill(); ctx.shadowBlur = 0;
          }
        }
      }

      t += 0.006;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.48, pointerEvents: 'none' }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § NavBar
// ─────────────────────────────────────────────────────────────────────────────
function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        height: 58,
        background:     scrolled ? 'rgba(9,15,28,0.95)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)'         : 'none',
        borderBottom:   scrolled ? '1px solid rgba(255,255,255,0.07)' : 'none',
        display: 'flex', alignItems: 'center', padding: '0 40px', gap: 16,
        transition: 'background 300ms, border 300ms',
      }}
    >
      {/* Logotype */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ArkheLogo size={20} variant="icon" className="text-white" />
        </div>
        <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 15, fontWeight: 800, color: T.textSov, letterSpacing: '-0.02em' }}>
          Arkhé<span style={{ color: T.accent }}>Genesis</span>
        </span>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        {[['Features','#features'],['Biosecurity','#biosecurity'],['Architecture','#architecture'],['Docs','/docs']].map(([l, h]) => (
          <a key={l} href={h}
            style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 13, color: T.textMut, textDecoration: 'none', transition: 'color 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.color = T.textSec)}
            onMouseLeave={e => (e.currentTarget.style.color = T.textMut)}>
            {l}
          </a>
        ))}
      </nav>

      {/* Auth CTAs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link href="/login"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 6, fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 12, fontWeight: 600, color: T.textSec, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', textDecoration: 'none', transition: 'all 150ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = T.textPri; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = T.textSec; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}>
          <LogIn size={12} /> Log In
        </Link>
        <Link href="/auth/signup"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 18px', borderRadius: 6, fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 12, fontWeight: 700, color: T.abyss, background: T.accent, textDecoration: 'none', boxShadow: '0 0 14px rgba(56,189,248,0.22)', transition: 'all 150ms' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#7DD3FC'; e.currentTarget.style.boxShadow = '0 0 26px rgba(56,189,248,0.42)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = T.accent;  e.currentTarget.style.boxShadow = '0 0 14px rgba(56,189,248,0.22)'; }}>
          <UserPlus size={12} /> Sign Up Free
        </Link>
      </div>
    </motion.header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Small reusable bits
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 100, background: `${color}0d`, border: `1px solid ${color}28` }}>
      <span style={{ color }}>{icon}</span>
      <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 10, color, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</span>
    </div>
  );
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      style={{ background: 'rgba(9,15,28,0.65)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.09)', borderTop: `1px solid ${color}28`, borderRadius: 10, padding: '16px 24px', textAlign: 'center', minWidth: 130 }}>
      <div style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 27, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 10, color: T.textMut, textTransform: 'uppercase', letterSpacing: '0.10em' }}>{label}</div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Feature card
// ─────────────────────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, description, color, delay = 0, bullets = [] }: {
  icon: React.ReactNode; title: string; description: string;
  color: string; delay?: number; bullets?: string[];
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }} transition={{ duration: 0.4, delay }}
      onHoverStart={() => setHovered(true)} onHoverEnd={() => setHovered(false)}
      style={{ background: 'rgba(9,15,28,0.72)', backdropFilter: 'blur(16px)', border: `1px solid ${hovered ? color + '28' : 'rgba(255,255,255,0.07)'}`, borderTop: `2px solid ${color}42`, borderRadius: 12, padding: '26px 24px 22px', position: 'relative', overflow: 'hidden', boxShadow: hovered ? `0 18px 52px rgba(2,6,23,0.50)` : 'none', transition: 'border-color 250ms, box-shadow 250ms', cursor: 'default' }}>
      <div style={{ position: 'absolute', top: -40, right: -40, width: 100, height: 100, borderRadius: '50%', background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}10`, border: `1px solid ${color}25`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>{icon}</div>
      <h3 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 14, fontWeight: 700, color: T.textSov, letterSpacing: '-0.01em', marginBottom: 9 }}>{title}</h3>
      <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 12.5, lineHeight: 1.75, color: T.textMut, marginBottom: bullets.length ? 14 : 0 }}>{description}</p>
      {bullets.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bullets.map(b => (
            <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <CheckCircle2 size={11} style={{ color, flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Terminal preview (auto-plays on mount)
// ─────────────────────────────────────────────────────────────────────────────
const TERM_LINES = [
  { type: 'prompt',  text: '> load NC_000913.3' },
  { type: 'success', text: '✓ E. coli K-12 · 4,641,652 bp · 11 slabs allocated' },
  { type: 'prompt',  text: '> sentinel scan' },
  { type: 'warning', text: '⚡ Full-genome Aho-Corasick scan (4,194 patterns)...' },
  { type: 'success', text: '✓ 0 threats detected · Genome CLEARED' },
  { type: 'prompt',  text: '> mutate 2345678 A→T' },
  { type: 'success', text: '✓ Committed · txId: a3f7c2e1 · Chronos updated' },
  { type: 'prompt',  text: '> fold protein ORF-001' },
  { type: 'info',    text: '  Chou-Fasman · 127 aa · pI 6.84 · Heuristic mode' },
];
const TERM_COLS: Record<string, string> = { prompt: T.textPri, success: T.baseA, warning: T.warning, info: T.accent };

function TerminalPreview() {
  const [lines, setLines] = useState(0);
  useEffect(() => {
    if (lines >= TERM_LINES.length) return;
    const t = setTimeout(() => setLines(v => v + 1), lines === 0 ? 700 : 480);
    return () => clearTimeout(t);
  }, [lines]);

  return (
    <div style={{ background: 'rgba(2,6,23,0.93)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 28px 72px rgba(2,6,23,0.60), 0 0 0 1px rgba(56,189,248,0.05)' }}>
      {/* chrome */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
        {['#FF5F56','#FFBD2E','#27C93F'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.65 }} />)}
        <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 10, color: T.textGhost, marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Arkhé Terminal · v1.0</span>
      </div>
      {/* output */}
      <div style={{ padding: '16px 20px', minHeight: 218 }}>
        <AnimatePresence>
          {TERM_LINES.slice(0, lines).map((ln, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16 }}
              style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 12, lineHeight: 1.95, color: TERM_COLS[ln.type] ?? T.textSec }}>
              {ln.text}
            </motion.div>
          ))}
        </AnimatePresence>
        {lines < TERM_LINES.length && (
          <motion.span animate={{ opacity: [1,0,1] }} transition={{ duration: 1, repeat: Infinity }}
            style={{ display: 'inline-block', width: 7, height: 13, background: T.accent, borderRadius: 1, verticalAlign: 'text-bottom', marginLeft: 2 }} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Sentinel scan demo
// ─────────────────────────────────────────────────────────────────────────────
function SentinelDemo() {
  const [progress, setProgress] = useState(0);
  const [status,   setStatus]   = useState<'idle'|'scanning'|'cleared'>('idle');

  useEffect(() => { const t = setTimeout(() => setStatus('scanning'), 700); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (status !== 'scanning') return;
    if (progress >= 100) { setStatus('cleared'); return; }
    const t = setTimeout(() => setProgress(p => Math.min(p + 1.6, 100)), 36);
    return () => clearTimeout(t);
  }, [status, progress]);

  const COLS = [T.baseA, T.baseT, T.baseC, T.baseG];
  const SEGS = 32;

  return (
    <div style={{ background: 'rgba(2,6,23,0.90)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 24, boxShadow: '0 20px 56px rgba(2,6,23,0.50)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={14} style={{ color: T.baseT }} />
          <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 12, fontWeight: 700, color: T.textPri }}>Sentinel Engine</span>
        </div>
        <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 9, fontWeight: 700, padding: '2px 9px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.08em', background: status === 'cleared' ? 'rgba(16,185,129,0.12)' : status === 'scanning' ? 'rgba(245,158,11,0.12)' : 'rgba(71,85,105,0.18)', border: `1px solid ${status === 'cleared' ? T.success : status === 'scanning' ? T.warning : T.raised}45`, color: status === 'cleared' ? T.success : status === 'scanning' ? T.warning : T.textMut }}>
          {status === 'cleared' ? '✓ CLEARED' : status === 'scanning' ? 'SCANNING' : 'READY'}
        </span>
      </div>

      {/* bar */}
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.05)', marginBottom: 12, overflow: 'hidden' }}>
        <motion.div style={{ height: '100%', borderRadius: 3, background: status === 'cleared' ? `linear-gradient(90deg,${T.success},${T.baseA})` : `linear-gradient(90deg,${T.baseT},${T.accent})`, width: `${progress}%` }} />
      </div>

      {/* base grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SEGS},1fr)`, gap: 2, marginBottom: 14 }}>
        {Array.from({ length: SEGS }).map((_, i) => {
          const on = progress >= (i / SEGS) * 100;
          const c  = COLS[i % 4];
          return <div key={i} style={{ height: 14, borderRadius: 2, background: on ? `${c}25` : 'rgba(255,255,255,0.04)', border: `1px solid ${on ? c + '35' : 'rgba(255,255,255,0.04)'}`, transition: 'all 180ms' }} />;
        })}
      </div>

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
        {[['Patterns','4,194',T.accent],['Scanned',`${Math.round(progress)}%`,T.warning],['Threats','0',T.success]].map(([l,v,c]) => (
          <div key={String(l)} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '7px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 15, fontWeight: 700, color: String(c) }}>{v}</div>
            <div style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 9, color: T.textMut, textTransform: 'uppercase', letterSpacing: '0.10em', marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Page
// ─────────────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.72], [1, 0]);
  const heroY       = useTransform(scrollYProgress, [0, 1], ['0%', '16%']);

  // Ambient DNA typewriter at bottom of hero
  const SEQ = 'ATGAAAGAATTCGCGGCGGCGCGCGATCGATCGATCGAAGCTTGCGCGATCGATCGCGCGCTAA';
  const [typed, setTyped] = useState('');
  useEffect(() => {
    let i = 0;
    const tick = setInterval(() => {
      if (i <= SEQ.length) { setTyped(SEQ.slice(0, i)); i++; }
      else { i = 0; setTyped(''); }
    }, 62);
    return () => clearInterval(tick);
  }, []);
  const BASE_COLS: Record<string,string> = { A: T.baseA, T: T.baseT, C: T.baseC, G: T.baseG };

  return (
    <div style={{ background: T.abyss, minHeight: '100vh', color: T.textPri, overflowX: 'hidden' }}>
      <NavBar />

      {/* ══════════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════════ */}
      <section ref={heroRef} style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>

        <DNAHelixCanvas />

        {/* radial glow */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 68% 52% at 50% 42%, rgba(56,189,248,0.055) 0%, transparent 66%), radial-gradient(ellipse 48% 65% at 16% 85%, rgba(74,222,128,0.035) 0%, transparent 55%)', pointerEvents: 'none' }} />

        {/* grid */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(56,189,248,0.020) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.020) 1px, transparent 1px)', backgroundSize: '58px 58px', pointerEvents: 'none' }} />

        {/* ambient DNA strip at bottom */}
        <div style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 1, pointerEvents: 'none', opacity: 0.32 }}>
          {typed.split('').map((b, i) => <span key={i} style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 11, color: BASE_COLS[b] ?? T.textGhost }}>{b}</span>)}
          <motion.span animate={{ opacity: [1,0,1] }} transition={{ duration: 1.1, repeat: Infinity }} style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 11, color: T.accent }}>▌</motion.span>
        </div>

        <motion.div style={{ opacity: heroOpacity, y: heroY, position: 'relative', zIndex: 10, maxWidth: 860, padding: '0 32px', textAlign: 'center' }}>

          {/* live pulse badge */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 100, background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.20)', marginBottom: 30 }}>
            <motion.div animate={{ opacity: [0.5,1,0.5] }} transition={{ duration: 2, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: '50%', background: T.accent }} />
            <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 11, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Sovereign Bioengineering IDE · v1.0</span>
          </motion.div>

          {/* headline */}
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 'clamp(36px,5.8vw,68px)', fontWeight: 800, color: T.textSov, letterSpacing: '-0.035em', lineHeight: 1.1, marginBottom: 20 }}>
            Engineer the Genome.
            <br />
            <span style={{ background: 'linear-gradient(130deg, #38BDF8 0%, #4ADE80 55%, #FACC15 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Sovereign by Design.
            </span>
          </motion.h1>

          {/* sub */}
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.33 }}
            style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 16.5, lineHeight: 1.78, color: T.textMut, maxWidth: 560, margin: '0 auto 40px' }}>
            The world's first bioengineering IDE with built-in biosecurity,
            sub-millisecond slab memory, and cryptographic genome history.
            Self-host your data. Own your sequences.
          </motion.p>

          {/* ── PRIMARY AUTH CTAs ─────────────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.48 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>

            <Link href="/auth/signup"
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '15px 36px', background: T.accent, borderRadius: 8, fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 14, fontWeight: 700, color: T.abyss, textDecoration: 'none', boxShadow: '0 0 26px rgba(56,189,248,0.28)', transition: 'all 200ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#7DD3FC'; e.currentTarget.style.boxShadow = '0 0 42px rgba(56,189,248,0.50)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.accent;  e.currentTarget.style.boxShadow = '0 0 26px rgba(56,189,248,0.28)'; }}>
              <UserPlus size={16} />
              Create Free Account
              <ArrowRight size={14} />
            </Link>

            <Link href="/login"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '15px 28px', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 14, color: T.textSec, textDecoration: 'none', transition: 'all 200ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = T.textPri; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = T.textSec; }}>
              <LogIn size={14} />
              Log In to Your IDE
            </Link>
          </motion.div>

          {/* hint */}
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.72 }}
            style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 11, color: T.textGhost, marginBottom: 52 }}>
            No credit card required · All genomic data processed locally · Zero telemetry ·{' '}
            <Link href="/login" style={{ color: '#334155', textUnderlineOffset: 3, textDecoration: 'underline' }}>Guest mode available</Link>
          </motion.p>

          {/* stat cards */}
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.62 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatCard value="4 GB+"  label="Genome Capacity" color={T.accent} />
            <StatCard value="O(n)"   label="Scan Complexity"  color={T.baseA} />
            <StatCard value="2-bit"  label="Base Encoding"    color={T.baseG} />
            <StatCard value="∞"      label="Chronos History"  color={T.purple} />
          </motion.div>
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          TERMINAL PREVIEW
      ══════════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'rgba(9,15,28,0.62)', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '88px 40px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, alignItems: 'center' }}>
          <motion.div initial={{ opacity: 0, x: -22 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.48 }}>
            <Pill icon={<Terminal size={10} />} label="Sovereign Terminal" color={T.accent} />
            <h2 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 28, fontWeight: 800, color: T.textSov, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '14px 0' }}>
              Genome engineering<br />at the speed of thought.
            </h2>
            <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 13.5, lineHeight: 1.8, color: T.textMut, marginBottom: 22 }}>
              Load any NCBI accession or raw FASTA, run a full-genome biosecurity audit, commit surgical base mutations, and generate clinical validation reports — all from a single terminal backed by a lock-free Web Worker engine.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {([
                [<Zap key="z" size={12}/>,         'Sub-millisecond mutations via Web Worker IPC'],
                [<Shield key="s" size={12}/>,      'Full-genome Sentinel scan on every genome load'],
                [<GitBranch key="g" size={12}/>,   'Chronos commit + cloud sync on every mutation'],
                [<FlaskConical key="f" size={12}/>, 'PCR simulation, ORF scan, restriction mapping'],
              ] as [React.ReactNode, string][]).map(([icon, text]) => (
                <li key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: T.accent, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 13, color: '#475569' }}>{text}</span>
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 22 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.48 }}>
            <TerminalPreview />
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          FEATURES
      ══════════════════════════════════════════════════════════════════ */}
      <section id="features" style={{ padding: '96px 40px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 56 }}>
            <Pill icon={<Atom size={11} />} label="Sovereign Features" color={T.baseA} />
            <h2 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 32, fontWeight: 800, color: T.textSov, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '14px 0 10px' }}>Every tool. Sovereign data.</h2>
            <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 14, color: T.textMut, maxWidth: 460, margin: '0 auto' }}>Research-grade capabilities built from first principles — security, auditability, total data ownership.</p>
          </motion.div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <FeatureCard icon={<Shield size={21}/>}     title="Sentinel Biosecurity"    color={T.baseT}  delay={0}    description="Full-genome Aho-Corasick scanning with 2-bit bitmask acceleration. 4,194 threat patterns. Zero viewport bypass."        bullets={['O(n) scan complexity','23-byte cross-slab overlap','Fires on every genome load']} />
            <FeatureCard icon={<Database size={21}/>}   title="Slab Memory Engine"      color={T.accent} delay={0.08} description="Lock-free segmented Uint8Array buffers. 16 MiB per slab. 512 MB OOM guard. Handles whole-chromosome genomes."           bullets={['2-bit base packing','Direct write on mutation','No string concatenation ever']} />
            <FeatureCard icon={<GitBranch size={21}/>}  title="Chronos History DAG"     color={T.purple} delay={0.16} description="Merkle-style commit graph with branch, merge, and time-travel. Cloud-synced with automatic Frozen Recovery (FR-01)."   bullets={['SHA-256 chained txIds','Cloud sync + offline fallback','Auto split-brain recovery']} />
            <FeatureCard icon={<Microscope size={21}/>} title="Protein Folding"         color={T.baseA}  delay={0.24} description="Local Chou-Fasman heuristic + optional ESM Atlas API for publication-grade 3D structure prediction."                  bullets={['ESM Atlas integration','Consent-gated transmission','GDPR/CCPA disclosure']} />
            <FeatureCard icon={<Lock size={21}/>}       title="Sovereign Self-Hosting"  color={T.baseG}  delay={0.32} description="Connect your own Supabase instance. All genome data stays within your institutional infrastructure permanently."        bullets={['Bring your own Supabase','Test connection in settings','IndexedDB local fallback']} />
            <FeatureCard icon={<Cpu size={21}/>}        title="Web Worker Engine"       color={T.warning} delay={0.40} description="ArkheEngine runs in a dedicated worker thread. Main UI never blocks. COOP/COEP headers for SharedArrayBuffer IPC."   bullets={['True off-main-thread compute','Worker crash surface + reconnect','Lock-free message bus']} />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          BIOSECURITY
      ══════════════════════════════════════════════════════════════════ */}
      <section id="biosecurity" style={{ background: 'rgba(9,15,28,0.55)', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '96px 40px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          <motion.div initial={{ opacity: 0, x: 22 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.48 }}>
            <SentinelDemo />
          </motion.div>
          <motion.div initial={{ opacity: 0, x: -22 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.48 }}>
            <Pill icon={<Shield size={10} />} label="Biosecurity First" color={T.baseT} />
            <h2 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 28, fontWeight: 800, color: T.textSov, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '16px 0' }}>
              Sentinel scans <span style={{ color: T.baseT }}>every byte</span>.<br />Not just the viewport.
            </h2>
            <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 13.5, lineHeight: 1.8, color: T.textMut, marginBottom: 18 }}>
              Previous-generation tools only scan the visible window — a trivial bypass vector. Arkhé fires{' '}
              <code style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 12, color: T.baseT }}>RUN_FULL_AUDIT</code>{' '}
              directly against SlabManager raw memory, covering every slab of the entire genome in a single linear pass.
            </p>
            <div style={{ padding: '13px 16px', background: 'rgba(251,113,133,0.05)', border: '1px solid rgba(251,113,133,0.14)', borderRadius: 8, marginBottom: 18 }}>
              <div style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 10, fontWeight: 700, color: T.baseT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Zero Bypass Guarantee</div>
              <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 12.5, color: T.textMut, margin: 0, lineHeight: 1.65 }}>
                The <code style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', color: T.textSec }}>sequence</code>, <code style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', color: T.textSec }}>start</code>, and <code style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', color: T.textSec }}>end</code> arguments to <code style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', color: T.textSec }}>runThreatScreening()</code> are intentionally ignored. Scan range is determined solely by the worker's SlabManager.
              </p>
            </div>
            <Link href="/docs#aho-corasick" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 13, color: T.accent, textDecoration: 'none' }}>
              Read the Aho-Corasick implementation <ArrowRight size={13} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          ARCHITECTURE LAYERS
      ══════════════════════════════════════════════════════════════════ */}
      <section id="architecture" style={{ padding: '96px 40px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 52 }}>
            <Pill icon={<Cpu size={11} />} label="Architecture" color={T.purple} />
            <h2 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 32, fontWeight: 800, color: T.textSov, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '14px 0 0' }}>Built for the impossible.</h2>
          </motion.div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {[
              { n:'01', title:'Slab Memory',   icon:<Database size={18}/>, color:T.accent, items:['16 MiB Uint8Array slabs','2-bit base packing (A=0 G=1 C=2 T=3)','512 MB OOM hard limit','Lock-free within Web Worker'] },
              { n:'02', title:'Aho-Corasick',  icon:<Shield size={18}/>,   color:T.baseT,  items:['4-wide transition array per state','2-bit bitmask alphabet indexing','O(n + matches) scan','23-byte cross-slab overlap'] },
              { n:'03', title:'Chronos DAG',   icon:<GitBranch size={18}/>,color:T.purple, items:['SHA-256 chained commit hashes','Branch + merge detection','FR-01 Frozen Recovery','Cloud sync via Supabase'] },
            ].map(({ n, title, icon, color, items }) => (
              <motion.div key={n} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.38 }}
                style={{ padding: '28px 24px', background: 'rgba(9,15,28,0.55)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${color}10`, borderRadius: 8, border: `1px solid ${color}20`, color }}>{icon}</div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 9, color: T.textGhost, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Layer {n}</div>
                    <div style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 13, fontWeight: 700, color: T.textPri }}>{title}</div>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {items.map(item => (
                    <li key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 }} />
                      <span style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '108px 40px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'radial-gradient(ellipse 52% 42% at 50% 50%, rgba(56,189,248,0.038) 0%, transparent 65%)', textAlign: 'center' }}>
        <motion.div initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.48 }} style={{ maxWidth: 640, margin: '0 auto' }}>

          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 66, height: 66, borderRadius: 16, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.20)', marginBottom: 26 }}>
            <ArkheLogo size={34} variant="icon" glow className="text-white" />
          </div>

          <h2 style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 36, fontWeight: 800, color: T.textSov, letterSpacing: '-0.035em', lineHeight: 1.15, marginBottom: 16 }}>
            The pinnacle of bioengineering.<br />
            <span style={{ color: T.accent }}>Start today.</span>
          </h2>

          <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 15, color: T.textMut, lineHeight: 1.78, marginBottom: 38 }}>
            Load your first genome in under 30 seconds. No credit card.
            No data collection. Your sequences belong to you — always.
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <Link href="/auth/signup"
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 40px', background: T.accent, borderRadius: 8, fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 14, fontWeight: 700, color: T.abyss, textDecoration: 'none', boxShadow: '0 0 28px rgba(56,189,248,0.28)', transition: 'all 200ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#7DD3FC'; e.currentTarget.style.boxShadow = '0 0 46px rgba(56,189,248,0.50)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.accent;  e.currentTarget.style.boxShadow = '0 0 28px rgba(56,189,248,0.28)'; }}>
              <UserPlus size={17} /> Create Free Account
            </Link>
            <Link href="/login"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 28px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 8, fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 14, color: T.textMut, textDecoration: 'none', transition: 'all 200ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = T.textPri; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = T.textMut; }}>
              <LogIn size={14} /> Already have an account? Log in
            </Link>
          </div>
          <p style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 11, color: T.textGhost }}>
            Prefer offline access?{' '}
            <Link href="/login" style={{ color: '#334155', textUnderlineOffset: 3, textDecoration: 'underline' }}>Open the IDE in guest mode →</Link>
          </p>
        </motion.div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '26px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArkheLogo size={14} variant="icon" className="text-white" />
          <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 11, color: T.textGhost }}>Arkhé Genesis v1.0 · 2026</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {[['Workbench','/workbench'],['Docs','/docs'],['Sign Up','/auth/signup'],['Log In','/login']].map(([l,h]) => (
            <Link key={l} href={h} style={{ fontFamily: 'var(--font-inter,system-ui,sans-serif)', fontSize: 12, color: T.textGhost, textDecoration: 'none', transition: 'color 150ms' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
              onMouseLeave={e => (e.currentTarget.style.color = T.textGhost)}>
              {l}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={11} style={{ color: T.textGhost }} />
          <span style={{ fontFamily: 'var(--font-jetbrains-mono,monospace)', fontSize: 11, color: T.textGhost }}>Sovereign by design</span>
        </div>
      </footer>
    </div>
  );
}