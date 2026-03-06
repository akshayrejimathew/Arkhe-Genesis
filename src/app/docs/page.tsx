'use client';

/**
 * src/app/docs/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Sovereign Wiki & Transparency Page
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Professional two-column documentation layout:
 *   LEFT  — Sticky sidebar with section navigation + Sovereign feature icons
 *   RIGHT — Scrollable markdown-style content sections
 *
 * Sections:
 *   1. Introduction & Sovereign Architecture
 *   2. Aho-Corasick Biosecurity (bitmasking implementation details)
 *   3. Slab Memory Architecture
 *   4. Sovereign Features (Shield, Atom, Database)
 *   5. Privacy & Data Transparency
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Shield,
  Atom,
  Database,
  ChevronRight,
  ArrowLeft,
  Dna,
  Lock,
  Zap,
  Clock,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Code2,
  BookOpen,
} from 'lucide-react';
import { motion, useInView } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// § Types
// ─────────────────────────────────────────────────────────────────────────────

interface DocSection {
  id:       string;
  label:    string;
  icon:     React.ReactNode;
  children?: Array<{ id: string; label: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Navigation structure
// ─────────────────────────────────────────────────────────────────────────────

const NAV: DocSection[] = [
  {
    id:    'overview',
    label: 'Overview',
    icon:  <BookOpen size={14} />,
    children: [
      { id: 'introduction',   label: 'Introduction' },
      { id: 'architecture',   label: 'Sovereign Architecture' },
    ],
  },
  {
    id:    'biosecurity',
    label: 'Biosecurity',
    icon:  <Shield size={14} />,
    children: [
      { id: 'sentinel',         label: 'Sentinel Engine' },
      { id: 'aho-corasick',     label: 'Aho-Corasick & Bitmasking' },
      { id: 'threat-library',   label: 'Signature Library' },
    ],
  },
  {
    id:    'memory',
    label: 'Slab Memory',
    icon:  <Database size={14} />,
    children: [
      { id: 'slab-overview',  label: 'Architecture Overview' },
      { id: 'slab-manager',   label: 'SlabManager' },
      { id: 'frozen-recovery',label: 'Frozen Recovery' },
    ],
  },
  {
    id:    'sovereign',
    label: 'Sovereign Features',
    icon:  <Atom size={14} />,
    children: [
      { id: 'sovereign-mode', label: 'Sovereign Mode' },
      { id: 'chronos',        label: 'Chronos History DAG' },
      { id: 'privacy',        label: 'Data & Privacy' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// § Utility components
// ─────────────────────────────────────────────────────────────────────────────

function CodeBlock({ children, lang = 'text' }: { children: string; lang?: string }) {
  return (
    <div className="group relative my-6">
      <div
        style={{
          background:     'rgba(2, 6, 23, 0.80)',
          border:         '1px solid rgba(255,255,255,0.08)',
          borderTop:      '1px solid rgba(255,255,255,0.12)',
          borderRadius:   8,
          overflow:       'hidden',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '8px 16px',
            borderBottom:   '1px solid rgba(255,255,255,0.06)',
            background:     'rgba(255,255,255,0.02)',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {['#FF5F56', '#FFBD2E', '#27C93F'].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.6 }} />
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            {lang}
          </span>
        </div>

        {/* Code */}
        <pre
          style={{
            margin:      0,
            padding:     '16px 20px',
            fontFamily:  'var(--font-jetbrains-mono, monospace)',
            fontSize:    12.5,
            lineHeight:  1.8,
            color:       '#94A3B8',
            overflowX:   'auto',
            whiteSpace:  'pre',
          }}
        >
          <code>{children.trim()}</code>
        </pre>
      </div>
    </div>
  );
}

function Callout({
  type = 'info',
  title,
  children,
}: {
  type?: 'info' | 'warning' | 'success' | 'danger';
  title?: string;
  children: React.ReactNode;
}) {
  const styles: Record<string, { border: string; bg: string; icon: React.ReactNode; color: string }> = {
    info:    { border: 'rgba(56,189,248,0.35)',  bg: 'rgba(56,189,248,0.06)',  icon: <Zap size={14} />,          color: '#38BDF8' },
    warning: { border: 'rgba(245,158,11,0.35)',  bg: 'rgba(245,158,11,0.06)',  icon: <AlertTriangle size={14} />, color: '#F59E0B' },
    success: { border: 'rgba(16,185,129,0.35)',  bg: 'rgba(16,185,129,0.06)',  icon: <CheckCircle2 size={14} />, color: '#10B981' },
    danger:  { border: 'rgba(239,68,68,0.35)',   bg: 'rgba(239,68,68,0.06)',   icon: <AlertTriangle size={14} />, color: '#EF4444' },
  };

  const s = styles[type];

  return (
    <div
      style={{
        border:       `1px solid ${s.border}`,
        background:   s.bg,
        borderRadius: 8,
        padding:      '12px 16px',
        margin:       '20px 0',
        display:      'flex',
        gap:          12,
        alignItems:   'flex-start',
      }}
    >
      <div style={{ color: s.color, marginTop: 1, flexShrink: 0 }}>{s.icon}</div>
      <div>
        {title && (
          <div style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 11.5, fontWeight: 700, color: s.color, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {title}
          </div>
        )}
        <div style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 13, lineHeight: 1.65, color: '#94A3B8' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      style={{
        fontFamily:     'var(--font-jetbrains-mono, monospace)',
        fontSize:       18,
        fontWeight:     700,
        color:          '#F8FAFC',
        letterSpacing:  '-0.02em',
        marginTop:      48,
        marginBottom:   12,
        paddingBottom:  10,
        borderBottom:   '1px solid rgba(255,255,255,0.07)',
        scrollMarginTop: 80,
      }}
    >
      {children}
    </h2>
  );
}

function SubHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      style={{
        fontFamily:      'var(--font-jetbrains-mono, monospace)',
        fontSize:        14,
        fontWeight:      700,
        color:           '#38BDF8',
        letterSpacing:   '0.02em',
        textTransform:   'uppercase',
        marginTop:       32,
        marginBottom:    10,
        scrollMarginTop: 80,
      }}
    >
      {children}
    </h3>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily:  'var(--font-inter, system-ui, sans-serif)',
        fontSize:    14,
        lineHeight:  1.8,
        color:       '#94A3B8',
        margin:      '0 0 14px 0',
      }}
    >
      {children}
    </p>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily:  'var(--font-jetbrains-mono, monospace)',
        fontSize:    12,
        background:  'rgba(56,189,248,0.08)',
        border:      '1px solid rgba(56,189,248,0.18)',
        borderRadius: 4,
        padding:     '1px 6px',
        color:       '#38BDF8',
      }}
    >
      {children}
    </code>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Sovereign Feature Card
// ─────────────────────────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
  color = '#38BDF8',
  badge,
}: {
  icon:        React.ReactNode;
  title:       string;
  description: string;
  color?:      string;
  badge?:      string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      style={{
        background:     'rgba(9, 15, 28, 0.70)',
        border:         '1px solid rgba(255,255,255,0.07)',
        borderTop:      `1px solid ${color}30`,
        borderRadius:   10,
        padding:        '20px 22px',
        position:       'relative',
        overflow:       'hidden',
      }}
    >
      {/* Subtle top glow */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg, transparent, ${color}50, transparent)`,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            width:          40,
            height:         40,
            borderRadius:   8,
            background:     `${color}12`,
            border:         `1px solid ${color}30`,
            color:          color,
            flexShrink:     0,
          }}
        >
          {icon}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontFamily:   'var(--font-jetbrains-mono, monospace)',
                fontSize:     13,
                fontWeight:   700,
                color:        '#E2E8F0',
              }}
            >
              {title}
            </span>
            {badge && (
              <span
                style={{
                  fontFamily:  'var(--font-jetbrains-mono, monospace)',
                  fontSize:    9,
                  fontWeight:  700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.10em',
                  padding:     '2px 7px',
                  borderRadius: 4,
                  background:  `${color}15`,
                  border:      `1px solid ${color}40`,
                  color:       color,
                }}
              >
                {badge}
              </span>
            )}
          </div>
          <p
            style={{
              fontFamily: 'var(--font-inter, system-ui, sans-serif)',
              fontSize:   12.5,
              lineHeight: 1.65,
              color:      '#64748B',
              margin:     0,
            }}
          >
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ activeId }: { activeId: string }) {
  return (
    <aside
      style={{
        width:          240,
        flexShrink:     0,
        position:       'sticky',
        top:            80,
        maxHeight:      'calc(100vh - 100px)',
        overflowY:      'auto',
        paddingRight:   24,
      }}
    >
      {/* Back link */}
      <Link
        href="/workbench"
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            6,
          fontFamily:     'var(--font-jetbrains-mono, monospace)',
          fontSize:       11,
          color:          '#475569',
          textDecoration: 'none',
          marginBottom:   24,
          padding:        '6px 8px',
          borderRadius:   5,
          border:         '1px solid rgba(255,255,255,0.06)',
          transition:     'color 150ms, border-color 150ms',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.color = '#94A3B8';
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.color = '#475569';
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
        }}
      >
        <ArrowLeft size={11} />
        Back to Workbench
      </Link>

      {/* Nav sections */}
      {NAV.map((section) => (
        <div key={section.id} style={{ marginBottom: 24 }}>
          <div
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:           7,
              fontFamily:    'var(--font-jetbrains-mono, monospace)',
              fontSize:      10,
              fontWeight:    700,
              color:         '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom:  8,
              padding:       '0 8px',
            }}
          >
            <span style={{ color: '#334155' }}>{section.icon}</span>
            {section.label}
          </div>

          {section.children?.map((child) => {
            const isActive = activeId === child.id;
            return (
              <a
                key={child.id}
                href={`#${child.id}`}
                style={{
                  display:         'flex',
                  alignItems:      'center',
                  gap:             6,
                  padding:         '5px 8px',
                  borderRadius:    5,
                  fontFamily:      'var(--font-inter, system-ui, sans-serif)',
                  fontSize:        12.5,
                  color:           isActive ? '#38BDF8' : '#64748B',
                  textDecoration:  'none',
                  background:      isActive ? 'rgba(56,189,248,0.07)' : 'none',
                  borderLeft:      isActive ? '2px solid #38BDF8' : '2px solid transparent',
                  transition:      'all 150ms',
                  marginLeft:      4,
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = '#94A3B8';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = '#64748B';
                    (e.currentTarget as HTMLElement).style.background = 'none';
                  }
                }}
              >
                {isActive && <ChevronRight size={10} />}
                {child.label}
              </a>
            );
          })}
        </div>
      ))}

      {/* Version badge */}
      <div
        style={{
          marginTop:   32,
          padding:     '8px 10px',
          borderRadius: 6,
          background:  'rgba(56,189,248,0.05)',
          border:      '1px solid rgba(56,189,248,0.12)',
        }}
      >
        <div style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 9, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 3 }}>
          Documentation
        </div>
        <div style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 10, color: '#475569' }}>
          Arkhé Genesis v1.0
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('introduction');

  // Intersection observer — highlight active nav item as user scrolls
  useEffect(() => {
    const allIds = NAV.flatMap(s => s.children?.map(c => c.id) ?? []);
    const observers: IntersectionObserver[] = [];

    allIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { rootMargin: '-20% 0px -70% 0px' },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  '#0F172A',
        color:       '#E2E8F0',
      }}
    >
      {/* ── Top navigation bar ──────────────────────────────────────────── */}
      <header
        style={{
          position:       'sticky',
          top:            0,
          zIndex:         100,
          height:         56,
          background:     'rgba(9, 15, 28, 0.92)',
          backdropFilter: 'blur(20px)',
          borderBottom:   '1px solid rgba(255,255,255,0.07)',
          display:        'flex',
          alignItems:     'center',
          padding:        '0 32px',
          gap:            16,
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <Dna size={18} style={{ color: '#38BDF8' }} />
          <span
            style={{
              fontFamily:   'var(--font-jetbrains-mono, monospace)',
              fontSize:     13,
              fontWeight:   700,
              color:        '#F8FAFC',
              letterSpacing: '-0.02em',
            }}
          >
            Arkhé<span style={{ color: '#38BDF8' }}>Genesis</span>
          </span>
        </Link>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)' }} />
        <span
          style={{
            fontFamily:   'var(--font-jetbrains-mono, monospace)',
            fontSize:     11,
            color:        '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
          }}
        >
          Documentation
        </span>
        <div style={{ flex: 1 }} />
        <Link
          href="/workbench"
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          6,
            padding:      '6px 14px',
            background:   'rgba(56,189,248,0.10)',
            border:       '1px solid rgba(56,189,248,0.30)',
            borderRadius: 6,
            fontFamily:   'var(--font-jetbrains-mono, monospace)',
            fontSize:     11,
            fontWeight:   600,
            color:        '#38BDF8',
            textDecoration: 'none',
            transition:   'background 150ms',
          }}
        >
          Launch IDE
          <ChevronRight size={11} />
        </Link>
      </header>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth:  1200,
          margin:    '0 auto',
          padding:   '40px 32px',
          display:   'flex',
          gap:       64,
        }}
      >
        <Sidebar activeId={activeSection} />

        {/* ── Content ──────────────────────────────────────────────────── */}
        <main style={{ flex: 1, minWidth: 0 }}>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 1 — INTRODUCTION
          ═══════════════════════════════════════════════════════════════ */}
          <div id="introduction" style={{ scrollMarginTop: 80 }}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div
                style={{
                  display:     'inline-flex',
                  alignItems:  'center',
                  gap:         6,
                  padding:     '4px 10px',
                  borderRadius: 100,
                  background:  'rgba(56,189,248,0.08)',
                  border:      '1px solid rgba(56,189,248,0.20)',
                  marginBottom: 16,
                }}
              >
                <Dna size={11} style={{ color: '#38BDF8' }} />
                <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 10, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  Sovereign Documentation
                </span>
              </div>

              <h1
                style={{
                  fontFamily:    'var(--font-jetbrains-mono, monospace)',
                  fontSize:      32,
                  fontWeight:    800,
                  color:         '#F8FAFC',
                  letterSpacing: '-0.03em',
                  lineHeight:    1.25,
                  marginBottom:  16,
                }}
              >
                Arkhé Genesis
                <br />
                <span style={{ color: '#38BDF8' }}>Technical Reference</span>
              </h1>

              <Prose>
                Arkhé Genesis is a sovereign, full-stack genomic engineering IDE built for
                research-grade biosecurity, clinical-grade auditability, and sub-millisecond
                genome manipulation at any scale. This documentation covers the complete
                technical architecture, the biosecurity reasoning engine, and the sovereign
                self-hosting model.
              </Prose>
            </motion.div>
          </div>

          {/* ── Architecture overview ──────────────────────────────────── */}
          <div id="architecture" style={{ scrollMarginTop: 80 }}>
            <SectionHeading id="architecture-h">Sovereign Architecture</SectionHeading>

            <Prose>
              Arkhé Genesis is designed on three non-negotiable principles:{' '}
              <strong style={{ color: '#E2E8F0' }}>data sovereignty</strong>,{' '}
              <strong style={{ color: '#E2E8F0' }}>cryptographic auditability</strong>, and{' '}
              <strong style={{ color: '#E2E8F0' }}>zero biosecurity compromise</strong>.
              Every architectural decision flows from these constraints.
            </Prose>

            <CodeBlock lang="architecture">
{`┌─────────────────────────────────────────────────────────────────┐
│                     ARKHÉ GENESIS — LAYERS                       │
├─────────────────────────────────────────────────────────────────┤
│  UI Layer        Next.js 16 + React 19 + Framer Motion           │
│  State Layer     Zustand 5 (subscribeWithSelector)                │
│  Engine Layer    ArkheEngine.worker.ts (Web Worker)               │
│  Memory Layer    SlabManager (lock-free segmented buffers)        │
│  Persistence     Supabase (cloud) + IndexedDB (local)             │
│  Biosecurity     ScreeningEngine (Aho-Corasick + bitmasking)      │
│  History         Chronos DAG (Merkle commit graph)                │
└─────────────────────────────────────────────────────────────────┘`}
            </CodeBlock>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 2 — BIOSECURITY
          ═══════════════════════════════════════════════════════════════ */}
          <div id="sentinel" style={{ scrollMarginTop: 80 }}>
            <SectionHeading id="biosecurity-h">Biosecurity — Sentinel Engine</SectionHeading>
            <Prose>
              The Sentinel Engine is Arkhé&apos;s biosecurity subsystem. Unlike naive sequence
              scanners that only check the currently visible viewport, Sentinel operates over
              the full genome — every slab of raw memory — ensuring that no pathogen signature
              can evade detection by being positioned outside the visible window.
            </Prose>

            <Callout type="danger" title="Zero Bypass Guarantee">
              <code style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: '#EF4444' }}>runThreatScreening()</code> sends a{' '}
              <code style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: '#EF4444' }}>RUN_FULL_AUDIT</code> command
              to the Web Worker. The viewport sequence argument is intentionally ignored.
              The worker reads directly from <Mono>SlabManager.getAllSlabs()</Mono> — covering
              the entire genome, with a 23-byte cross-boundary overlap per slab edge.
            </Callout>
          </div>

          {/* ── Aho-Corasick ──────────────────────────────────────────── */}
          <div id="aho-corasick" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="aho-corasick-h">Aho-Corasick & Bitmasking</SubHeading>

            <Prose>
              The <strong style={{ color: '#E2E8F0' }}>Aho-Corasick algorithm</strong> is a
              multi-pattern string matching automaton. Given{' '}
              <em>k</em> threat signatures of total length <em>m</em>, the automaton is
              constructed in <Mono>O(m)</Mono> time and memory. Subsequent scans of a
              genome of length <em>n</em> run in <Mono>O(n + matches)</Mono> — linear in
              the genome length regardless of how many patterns are in the library.
            </Prose>

            <Prose>
              This is a significant improvement over naïve approaches such as running{' '}
              <em>k</em> separate Boyer-Moore passes, which would require{' '}
              <Mono>O(n × k)</Mono> time and would be computationally prohibitive for
              large pathogen signature libraries against whole-genome inputs.
            </Prose>

            <SubHeading id="bitmask-h">Bitmask Encoding per Alphabet</SubHeading>

            <Prose>
              The standard Aho-Corasick automaton uses a sparse character transition table.
              For a DNA alphabet of just 4 symbols — <span style={{ color: '#4ADE80' }}>A</span>,{' '}
              <span style={{ color: '#FACC15' }}>G</span>,{' '}
              <span style={{ color: '#38BDF8' }}>C</span>,{' '}
              <span style={{ color: '#FB7185' }}>T</span> — Arkhé replaces the
              transition table with a packed 2-bit encoding:
            </Prose>

            <CodeBlock lang="typescript">
{`// DNA base → 2-bit index
const BASE_INDEX: Record<string, number> = {
  A: 0,  // 0b00
  G: 1,  // 0b01
  C: 2,  // 0b10
  T: 3,  // 0b11
};

// Aho-Corasick state transition using 4-wide array (not Map)
// Each state is a Uint32Array of length 4 — one slot per base.
// Memory layout: [nextStateA, nextStateG, nextStateC, nextStateT]
//
// At search time:
const nextState = transitions[currentState][BASE_INDEX[genomeByte]];
//
// On a modern CPU, this is a single array load — no hash lookup,
// no branch on character value. The 2-bit index maps directly to
// a pre-computed transition pointer in the DFA.`}
            </CodeBlock>

            <Prose>
              At the slab-scan level, each genome byte is already stored as a numeric
              base code (<Mono>A=0, G=1, C=2, T=3</Mono> in the SlabManager).
              This means the transition lookup requires <strong style={{ color: '#E2E8F0' }}>zero decoding</strong> — the
              raw byte value is used directly as the 2-bit bitmask index, eliminating the
              ASCII-to-index conversion step entirely.
            </Prose>

            <CodeBlock lang="typescript">
{`// Inside ScreeningEngine.scan(slabBytes: Uint8Array):
let state = 0;  // start state

for (let i = 0; i < slabBytes.length; i++) {
  const base = slabBytes[i];          // already 0|1|2|3
  state = dfa[state][base];           // O(1) bitmask-indexed transition
  const matches = output[state];      // bitmask of matched pattern IDs
  if (matches !== 0) {
    // Unpack bitmask → individual pattern IDs using bit-scan intrinsics
    let m = matches;
    while (m !== 0) {
      const patternId = 31 - Math.clz32(m);  // leading-zero count
      recordHit(i, patternId);
      m &= m - 1;                            // clear lowest set bit
    }
  }
}`}
            </CodeBlock>

            <Callout type="info" title="Output Bitmask">
              Each Aho-Corasick output state stores a <strong>bitmask</strong> of matched
              pattern IDs rather than a list. For a library with ≤ 32 patterns,
              this is a single <Mono>uint32</Mono>. The inner loop uses{' '}
              <Mono>Math.clz32</Mono> (maps to a single CPU instruction on V8) to extract
              each set bit in <Mono>O(matches)</Mono> rather than scanning all 32 bits.
            </Callout>

            <SubHeading id="cross-slab-h">Cross-Slab Boundary Overlap</SubHeading>

            <Prose>
              A pathogen signature of length <em>L</em> can straddle a slab boundary — its
              first <em>j</em> bytes sit in slab <em>i</em> and its remaining{' '}
              <em>L − j</em> bytes sit in slab <em>i+1</em>. Without a mitigation, such
              signatures would go undetected.
            </Prose>

            <Prose>
              Arkhé&apos;s fix: at each slab boundary, the scanner reads a{' '}
              <Mono>KMER_SIZE − 1 = 23</Mono> byte suffix from the current slab and
              prepends it to the next slab before scanning. This overlap window guarantees
              full coverage of any cross-boundary signature up to 24 bases long — sufficient
              for all known dual-use pathogen recognition motifs in the current library.
            </Prose>
          </div>

          {/* ── Threat Library ──────────────────────────────────────────── */}
          <div id="threat-library" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="threat-lib-h">Signature Library</SubHeading>
            <Prose>
              The threat signature library is a curated JSON structure containing:
            </Prose>
            <CodeBlock lang="json">
{`{
  "version":    "2026-02-25",
  "categories": {
    "TOXIN_GENES":   [ /* 23-mer kmers from Select Agent toxin genes */ ],
    "VIRAL_CAPSID":  [ /* BSL-3/4 viral structural proteins          */ ],
    "AMR_CRITICAL":  [ /* WHO priority antimicrobial resistance genes */ ],
    "DUAL_USE":      [ /* Motifs flagged under NSABB dual-use review  */ ]
  },
  "bitmask_width": 32,
  "overlap_bytes": 23
}`}
            </CodeBlock>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 3 — SLAB MEMORY
          ═══════════════════════════════════════════════════════════════ */}
          <div id="slab-overview" style={{ scrollMarginTop: 80 }}>
            <SectionHeading id="memory-h">Slab Memory Architecture</SectionHeading>

            <Prose>
              Storing whole genomes in JavaScript strings is catastrophically inefficient:
              V8 encodes strings as UTF-16, doubling the memory footprint, and string
              concatenation creates transient copies. A 4 GB human genome would require
              roughly <strong style={{ color: '#E2E8F0' }}>8 GB of RAM</strong> in naive string form.
            </Prose>

            <Prose>
              Arkhé&apos;s <strong style={{ color: '#E2E8F0' }}>Slab Memory</strong> architecture
              stores genome bases as <strong style={{ color: '#E2E8F0' }}>packed 2-bit values</strong> in
              fixed-size{' '}
              <Mono>Uint8Array</Mono> buffers called <strong style={{ color: '#E2E8F0' }}>slabs</strong>.
              Four bases per byte reduces a 4 GB genome to 1 GB — within the limits of a
              64-bit WebAssembly heap and well within the Web Worker&apos;s memory budget.
            </Prose>
          </div>

          <div id="slab-manager" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="slab-manager-h">SlabManager</SubHeading>

            <Prose>
              The <Mono>SlabManager</Mono> class lives exclusively inside the
              ArkheEngine Web Worker and is never exposed to the main thread. The main
              thread communicates with it only through typed message payloads.
            </Prose>

            <CodeBlock lang="typescript">
{`// Key SlabManager constants
const SLAB_SIZE = 16 * 1024 * 1024;  // 16 MiB per slab

// Internal structure per slab
interface SlabMeta {
  slabIndex:  number;
  start:      number;   // genome offset of first byte
  end:        number;   // genome offset of last byte
  length:     number;   // bytes written
  checksum:   string;   // murmur-style hash for integrity
}

// Allocation: slabs are created on demand as bytes stream in.
// A genome that is 150 MB occupies ceil(150 / 16) = 10 slabs.
// Each slab is an independent Uint8Array — no contiguous allocation
// required, no risk of OOM from a single large alloc.`}
            </CodeBlock>

            <Prose>
              Surgical base mutations via <Mono>PERFORM_SURGICAL_MUTATION</Mono> write
              directly to the slab byte at the target global offset. The mutation is
              committed to the Chronos DAG before the slab write, ensuring that if the
              write fails, the uncommitted transaction is safely rolled back by the history
              engine on the next reconciliation.
            </Prose>
          </div>

          <div id="frozen-recovery" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="frozen-recovery-h">Frozen Recovery (FR-01)</SubHeading>

            <Prose>
              A split-brain condition can occur when the cloud state and the local slab
              memory diverge — for example after an undo/redo race, a browser crash mid-sync,
              or a session restore from an incomplete write. Arkhé detects and recovers
              from this automatically.
            </Prose>

            <CodeBlock lang="typescript">
{`// After every successful cloud sync, the main thread fires:
postAndWait(worker, 'VERIFY_SLAB_STATE', { expectedTxId: chronosHead })

// Inside the worker:
function revertToSnapshot(expectedTxId: string): 'ok' | 'hard_reset_required' {
  if (this.currentTxId === expectedTxId) return 'ok';   // ✓ consistent

  // Mismatch — nuke local slabs and request a full cloud re-load
  this.hardReset();
  return 'hard_reset_required';
}

// The UI shows a "Re-aligning Memory..." overlay during recovery.
// The worker streams the authoritative FASTA from the signed URL,
// replays all Chronos commits, and signals completion.`}
            </CodeBlock>

            <Callout type="success" title="Why Hard Reset?">
              Incremental rollback would require storing a full byte-image before every
              mutation — prohibitively expensive for multi-megabyte slabs. The hard reset
              + cloud re-fetch trades a single network round-trip for guaranteed byte-level
              consistency. For a typical 50 MB genome on a 100 Mbps connection, recovery
              completes in under 4 seconds.
            </Callout>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 4 — SOVEREIGN FEATURES
          ═══════════════════════════════════════════════════════════════ */}
          <div id="sovereign-mode" style={{ scrollMarginTop: 80 }}>
            <SectionHeading id="sovereign-h">Sovereign Features</SectionHeading>

            <Prose>
              Arkhé Genesis ships with a <strong style={{ color: '#E2E8F0' }}>Sovereign Mode</strong> that
              allows institutions to self-host the entire backend on their own Supabase instance.
              No genome data ever leaves the institution&apos;s infrastructure.
            </Prose>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '24px 0' }}>
              <FeatureCard
                icon={<Shield size={20} />}
                title="Sentinel Biosecurity"
                description="Full-genome Aho-Corasick scanning with bitmask-accelerated multi-pattern matching. Zero viewport bypass vectors."
                color="#FB7185"
                badge="Core"
              />
              <FeatureCard
                icon={<Atom size={20} />}
                title="Slab Memory Engine"
                description="Lock-free segmented Uint8Array buffers. 2-bit base packing. 512 MB OOM guard. Handles whole-chromosome genomes."
                color="#38BDF8"
                badge="Core"
              />
              <FeatureCard
                icon={<Database size={20} />}
                title="Chronos History DAG"
                description="Immutable Merkle-style commit graph with branch, merge, and time-travel. Cloud-synced with frozen-recovery."
                color="#A78BFA"
                badge="Pro"
              />
              <FeatureCard
                icon={<Lock size={20} />}
                title="Sovereign Self-Hosting"
                description="Connect your own Supabase instance. All genome data remains within your institutional infrastructure."
                color="#FACC15"
                badge="Enterprise"
              />
              <FeatureCard
                icon={<Zap size={20} />}
                title="Sub-ms Mutation Engine"
                description="Surgical base editing via the Web Worker's direct slab write path. No full-genome copies on mutation."
                color="#4ADE80"
                badge="Core"
              />
              <FeatureCard
                icon={<Clock size={20} />}
                title="Clinical Validation Reports"
                description="One-click audit reports with SHA-256 sequence hashes, Sentinel scan results, and GOR protein structure summary."
                color="#F59E0B"
                badge="Pro"
              />
            </div>
          </div>

          {/* ── Chronos ─────────────────────────────────────────────────── */}
          <div id="chronos" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="chronos-h">Chronos History DAG</SubHeading>

            <Prose>
              Every mutation committed through the workbench is recorded as an immutable
              node in a directed acyclic graph (DAG). Each node stores the txId (commit
              hash), parent txId, mutation record, author, and timestamp.
            </Prose>

            <CodeBlock lang="typescript">
{`interface Commit {
  txId:       string;           // SHA-256 of (parentTxId + mutations)
  parentTxId: string | null;    // null for the genesis commit
  timestamp:  number;
  author?:    string;
  message?:   string;
  mutations:  MutationRecord[];
}

// Branches are named pointers into the DAG:
interface Branch {
  name:         string;
  headCommitId: string;
}`}
            </CodeBlock>
          </div>

          {/* ── Privacy ──────────────────────────────────────────────────── */}
          <div id="privacy" style={{ scrollMarginTop: 80 }}>
            <SubHeading id="privacy-h">Data & Privacy Transparency</SubHeading>

            <Callout type="warning" title="Third-Party Data Transmission">
              The only component that transmits data outside the Arkhé infrastructure
              is the optional{' '}
              <strong>High-Fidelity Protein Folding</strong> feature, which sends
              translated amino-acid sequences to the ESM Atlas API for publication-grade
              structure prediction. This transmission is gated behind explicit user consent
              and triggers a GDPR/CCPA disclosure in the ProteinViewport panel.
            </Callout>

            <Prose>
              All other operations — genome loading, mutation, biosecurity screening,
              Chronos history, and clinical report generation — are performed entirely
              within the Arkhé stack:
            </Prose>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
              {[
                { label: 'Genome data in transit',     val: 'TLS 1.3, stored at rest with AES-256 (Supabase)' },
                { label: 'FASTA blobs',                val: 'Signed URLs with 1-hour expiry, never logged' },
                { label: 'Biosecurity scan results',   val: 'Stored locally in IndexedDB only, never uploaded' },
                { label: 'Supabase project',           val: 'Shared Arkhé Central (default) or your Sovereign instance' },
                { label: 'Protein folding (ESM Atlas)',val: 'Optional, consent-gated, GDPR disclosure displayed' },
              ].map(({ label, val }) => (
                <div
                  key={label}
                  style={{
                    display:      'grid',
                    gridTemplate: '1fr / 220px 1fr',
                    gap:          12,
                    padding:      '8px 12px',
                    borderRadius: 6,
                    background:   'rgba(255,255,255,0.02)',
                    border:       '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 11, color: '#64748B' }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)', fontSize: 12, color: '#94A3B8' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              style={{
                marginTop:   48,
                paddingTop:  24,
                borderTop:   '1px solid rgba(255,255,255,0.07)',
                display:     'flex',
                alignItems:  'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 10, color: '#334155' }}>
                Arkhé Genesis v1.0 · Docs last updated 2026-03-06
              </div>
              <Link
                href="/workbench"
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  padding:      '8px 18px',
                  background:   'rgba(56,189,248,0.10)',
                  border:       '1px solid rgba(56,189,248,0.30)',
                  borderRadius: 6,
                  fontFamily:   'var(--font-jetbrains-mono, monospace)',
                  fontSize:     12,
                  fontWeight:   600,
                  color:        '#38BDF8',
                  textDecoration: 'none',
                }}
              >
                Launch the IDE
                <ChevronRight size={12} />
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}