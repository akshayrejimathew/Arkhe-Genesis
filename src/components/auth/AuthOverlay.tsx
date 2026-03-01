'use client';

/**
 * AuthOverlay.tsx
 * ============================================================================
 * Arkhé Genesis — Entry Interface
 * ============================================================================
 *
 * Displayed when `user === null`. Two primary tabs:
 *   • Research Login  — Supabase email/password authentication
 *   • Open Access     — Guest mode (local-only, no cloud sync)
 *
 * Integrated panel: Sovereignty Settings
 *   • URL + Anon Key fields for custom Supabase instance
 *   • "Test Connection" — runs `.from('profiles').select('id').limit(1)` against
 *     the user's DB to verify correct setup before activating Sovereign Mode
 *   • Status indicator: glowing blue (Sovereign), grey (Arkhé Central)
 *   • Writes credentials to localStorage via PersistenceManager.activateSovereignMode()
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 2 SECURITY FIXES (2026-02-22)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   FIX 4A — AuthOverlay Error Bounds (unhandled promise rejection):
 *     `handleActivateSovereign` is now a proper async function with a
 *     try/catch wrapper. `activateSovereignMode()` (from the store, which
 *     delegates to PersistenceManager) can throw if the URL is malformed,
 *     the key is invalid, or localStorage is unavailable. Previously any
 *     such throw would become an unhandled promise rejection, crashing the
 *     React subtree. Now errors are caught and surfaced to the user via
 *     `setSovError(err.message)` and `setSovStatus('fail')`.
 *
 *   FIX 4B — sovStatus stuck on 'fail' after user edits inputs:
 *     A `useEffect` watches `[sovUrl, sovKey]`. Whenever either field
 *     changes, it resets `sovStatus` to `'idle'` and `sovError` to `null`.
 *     This restores the "Test Connection" button and clears the red error
 *     banner as soon as the user starts correcting their credentials, rather
 *     than leaving the UI locked in a failed state.
 *
 * Design language: obsidian void, slit-scan glassmorphism, cyan surgery lines.
 */

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { PersistenceManager } from '@/lib/PersistenceManager';
import { useArkheStore } from '@/store';
import { get } from 'idb-keyval';
import { validateSovereignUrl } from '@/store/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
type PrimaryTab = 'research' | 'guest';
type SovStatus  = 'idle' | 'testing' | 'ok' | 'fail';

// ── Tiny util: check stored sovereign creds on mount (LB-02 & LB-0C fix: now async) ─────────────────
async function readSovereignCreds(): Promise<{ url: string; key: string }> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return { url: '', key: '' };
  try {
    const url = await get<string>('ARKHE_CUSTOM_SUPABASE_URL') ?? '';
    const key = await get<string>('ARKHE_CUSTOM_SUPABASE_KEY') ?? '';
    return { url, key };
  } catch {
    return { url: '', key: '' };
  }
}

// ── SVG logo ─────────────────────────────────────────────────────────────────
function ArkheGenesisMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Arkhé Genesis"
    >
      <polygon points="28,3 51,15.5 51,40.5 28,53 5,40.5 5,15.5" stroke="#22d3ee" strokeWidth="1.2" fill="none" opacity="0.5" />
      <polygon points="28,10 44,19 44,37 28,46 12,37 12,19" stroke="#06b6d4" strokeWidth="0.8" fill="none" opacity="0.3" />
      <path d="M18 14 C22 20, 22 24, 18 30 C14 36, 14 40, 18 44" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M38 14 C34 20, 34 24, 38 30 C42 36, 42 40, 38 44" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <line x1="18" y1="19" x2="38" y2="19" stroke="#67e8f9" strokeWidth="1" opacity="0.8" />
      <line x1="19" y1="24" x2="37" y2="24" stroke="#67e8f9" strokeWidth="1" opacity="0.6" />
      <line x1="21" y1="28" x2="35" y2="28" stroke="#67e8f9" strokeWidth="1" opacity="0.9" />
      <line x1="19" y1="32" x2="37" y2="32" stroke="#67e8f9" strokeWidth="1" opacity="0.6" />
      <line x1="18" y1="37" x2="38" y2="37" stroke="#67e8f9" strokeWidth="1" opacity="0.8" />
      <circle cx="28" cy="28" r="2.5" fill="#22d3ee" />
    </svg>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function SovStatusPill({ status, active }: { status: SovStatus; active: boolean }) {
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        PROBING
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 6px #22d3ee' }} />
        SOVEREIGN ACTIVE
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-rose-500/10 border border-rose-500/30 text-rose-400">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        CONNECTION FAILED
      </span>
    );
  }
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 6px #22d3ee' }} />
        SOVEREIGN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-zinc-700/40 border border-zinc-600/30 text-zinc-400">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
      ARKHÉ CENTRAL
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AuthOverlay({ onDismiss }: { onDismiss?: () => void }) {
  const setUser               = useArkheStore((s) => s.setUser);
  const activateSovereignMode = useArkheStore((s) => s.activateSovereignMode);
  const deactivateSovereignMode = useArkheStore((s) => s.deactivateSovereignMode);
  const sovereignModeActive   = useArkheStore((s) => s.sovereignModeActive);
  const addSystemLog          = useArkheStore((s) => s.addSystemLog);

  const [tab, setTab] = useState<PrimaryTab>('research');

  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [authError,   setAuthError]   = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);

  const [sovOpen,   setSovOpen]   = useState(false);
  const [sovUrl,    setSovUrl]    = useState('');
  const [sovKey,    setSovKey]    = useState('');
  const [sovStatus, setSovStatus] = useState<SovStatus>('idle');
  const [sovError,  setSovError]  = useState<string | null>(null);
  const [sovTestOk, setSovTestOk] = useState(false);

  const scanRef = useRef<HTMLDivElement>(null);

  // Hydrate sovereign fields from IndexedDB on mount (LB-02 & LB-0C fix)
  useEffect(() => {
    const loadCreds = async () => {
      const { url, key } = await readSovereignCreds();
      if (url) setSovUrl(url);
      if (key) setSovKey(key);
    };
    loadCreds();
  }, []);

  // ── FIX 4B — Reset sovStatus and sovError when user edits either field ────
  //
  // Problem: after a failed connection test, sovStatus was stuck on 'fail'.
  // The error banner stayed red and the "Activate Sovereign" button stayed
  // disabled even after the user corrected their credentials.
  //
  // Fix: watch [sovUrl, sovKey]. Any change — one keystroke — resets the
  // derived UI state back to 'idle' and clears the error message. The user
  // sees a clean slate and can re-test with their corrected credentials.
  useEffect(() => {
    setSovStatus('idle');
    setSovError(null);
    setSovTestOk(false);
  }, [sovUrl, sovKey]);

  // ── Research Login ─────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) {
        setUser(data.user);
        setAuthSuccess(true);
        addSystemLog({
          timestamp: Date.now(),
          category: 'SYSTEM',
          message: `🔓 Authenticated: ${data.user.email}`,
          level: 'success',
        });
        setTimeout(() => onDismiss?.(), 600);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setAuthError('Check your email to confirm your account.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Guest Mode ─────────────────────────────────────────────────────────────
  const handleGuestAccess = () => {
    addSystemLog({
      timestamp: Date.now(),
      category: 'SYSTEM',
      message: '📂 Guest Mode — local storage only, no cloud sync',
      level: 'info',
    });
    onDismiss?.();
  };

  // ── Sovereignty: Test Connection ───────────────────────────────────────────
  const handleTestConnection = async () => {
    setSovError(null);
    setSovTestOk(false);
    setSovStatus('testing');

    const trimUrl = sovUrl.trim();
    const trimKey = sovKey.trim();

    if (!trimUrl || !trimKey) {
      setSovStatus('fail');
      setSovError('Both Supabase URL and Anon Key are required.');
      return;
    }
    
    // LB-05 FIX: Apply validateSovereignUrl check before testing connection
    let sanitisedUrl: string;
    try {
      sanitisedUrl = validateSovereignUrl(trimUrl);
    } catch (err) {
      setSovStatus('fail');
      setSovError(err instanceof Error ? err.message : 'Invalid Sovereign Mode URL');
      return;
    }

    try {
      // LB-05 FIX: Use validated URL instead of raw user input
      const testClient = createClient(sanitisedUrl, trimKey);
      const { error } = await testClient.from('profiles').select('id').limit(1);

      if (error) {
        const isTableMissing =
          error.code === '42P01' ||
          error.message.toLowerCase().includes('relation') ||
          error.message.toLowerCase().includes('does not exist');

        if (isTableMissing) {
          setSovStatus('ok');
          setSovTestOk(true);
          setSovError('⚠️ Connected — but `profiles` table not found. Run the Arkhé schema migration first.');
        } else {
          throw error;
        }
      } else {
        setSovStatus('ok');
        setSovTestOk(true);
      }
    } catch (err) {
      setSovStatus('fail');
      setSovError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  // ── Sovereignty: Activate ──────────────────────────────────────────────────
  //
  // FIX 4A — Wrap activation in try/catch to handle errors from:
  //   • PersistenceManager.activateSovereignMode() — throws on invalid URL/key
  //   • The store's activateSovereignMode wrapper — may throw on its own guards
  //   • Any future internal error from the Supabase SDK during client init
  //
  // Before this fix, an unhandled rejection here would propagate to React's
  // error boundary, crashing the overlay. Now all errors are caught and
  // displayed to the user via sovError state.
  const handleActivateSovereign = async () => {
    if (!sovTestOk && sovStatus !== 'ok') {
      setSovError('Test the connection first before activating.');
      return;
    }
    try {
      // activateSovereignMode may be synchronous or async depending on the
      // store implementation; wrapping in async/await handles both cases.
      await activateSovereignMode(sovUrl.trim(), sovKey.trim());
      setSovStatus('ok');
      setSovError(null);
    } catch (err) {
      // FIX 4A — never let this bubble to an unhandled rejection
      setSovError(err instanceof Error ? err.message : 'Activation failed');
      setSovStatus('fail');
    }
  };

  const handleDeactivateSovereign = () => {
    deactivateSovereignMode();
    setSovUrl('');
    setSovKey('');
    setSovStatus('idle');
    setSovTestOk(false);
    setSovError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');

        @keyframes scanline {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 0.07; }
          90%  { opacity: 0.07; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,211,238,0); }
          50%       { box-shadow: 0 0 20px 4px rgba(34,211,238,0.15); }
        }
        @keyframes gridFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes hexSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .arkhe-auth-panel {
          animation: fadeUp 0.45s cubic-bezier(0.16,1,0.3,1) both;
          font-family: 'Rajdhani', sans-serif;
        }
        .arkhe-tab-active { position: relative; }
        .arkhe-tab-active::after {
          content: '';
          position: absolute;
          bottom: -1px; left: 0; right: 0;
          height: 1px;
          background: #22d3ee;
          box-shadow: 0 0 8px #22d3ee;
        }
        .arkhe-input {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px;
          padding: 9px 12px;
          width: 100%;
          color: #f4f4f5;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .arkhe-input:focus {
          border-color: #22d3ee;
          box-shadow: 0 0 0 2px rgba(34,211,238,0.1);
        }
        .arkhe-input::placeholder { color: rgba(244,244,245,0.2); }

        .arkhe-btn-primary {
          background: #22d3ee; color: #000; border: none; border-radius: 4px;
          padding: 10px 20px;
          font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase;
          cursor: pointer; width: 100%;
          transition: background 0.15s, opacity 0.15s;
          animation: glowPulse 2.5s ease-in-out infinite;
        }
        .arkhe-btn-primary:hover { background: #67e8f9; }
        .arkhe-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; animation: none; }

        .arkhe-btn-ghost {
          background: rgba(255,255,255,0.04); color: #a1a1aa;
          border: 1px solid rgba(255,255,255,0.08); border-radius: 4px;
          padding: 9px 20px;
          font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase;
          cursor: pointer; width: 100%;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .arkhe-btn-ghost:hover {
          background: rgba(255,255,255,0.07); color: #f4f4f5;
          border-color: rgba(255,255,255,0.16);
        }

        .arkhe-btn-sov-test {
          background: rgba(34,211,238,0.08); color: #22d3ee;
          border: 1px solid rgba(34,211,238,0.3); border-radius: 4px;
          padding: 8px 16px;
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500;
          letter-spacing: 0.04em;
          cursor: pointer; white-space: nowrap;
          transition: background 0.15s, border-color 0.15s;
        }
        .arkhe-btn-sov-test:hover { background: rgba(34,211,238,0.14); border-color: rgba(34,211,238,0.5); }
        .arkhe-btn-sov-test:disabled { opacity: 0.4; cursor: not-allowed; }

        .sov-section {
          overflow: hidden;
          transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s;
        }
        .sov-section.open   { max-height: 600px; opacity: 1; }
        .sov-section.closed { max-height: 0; opacity: 0; }

        .grid-bg {
          background-image:
            linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px);
          background-size: 32px 32px;
          animation: gridFade 1.2s ease both;
        }
      `}</style>

      {/* Full-screen backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(6,6,8,0.92)', backdropFilter: 'blur(16px)' }}
      >
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div
          ref={scanRef}
          className="absolute inset-x-0 h-32 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, transparent, rgba(34,211,238,0.06), transparent)',
            animation: 'scanline 8s linear infinite',
          }}
        />

        {/* Card */}
        <div
          className="arkhe-auth-panel relative w-full max-w-md mx-4"
          style={{
            background: 'rgba(12,12,16,0.92)',
            border: '1px solid rgba(34,211,238,0.18)',
            borderRadius: '8px',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 0 0 1px rgba(34,211,238,0.06), 0 32px 80px rgba(0,0,0,0.7)',
          }}
        >
          <div
            className="absolute top-0 left-8 right-8 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)', opacity: 0.6 }}
          />

          {/* Header */}
          <div className="flex flex-col items-center pt-9 pb-6 px-8">
            <div className="relative mb-4">
              <div
                className="absolute inset-0 rounded-full border border-cyan-500/20"
                style={{ animation: 'hexSpin 20s linear infinite', width: '72px', height: '72px', margin: '-8px' }}
              />
              <ArkheGenesisMark size={56} />
            </div>
            <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: '22px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f4f4f5', lineHeight: 1 }}>
              Arkhé Genesis
            </h1>
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', letterSpacing: '0.2em', color: 'rgba(34,211,238,0.6)', marginTop: '4px', textTransform: 'uppercase' }}>
              Genomic Engineering Platform
            </p>
          </div>

          {/* Tab Bar */}
          <div className="flex mx-8 mb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {(['research', 'guest'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`arkhe-tab-active flex-1 pb-3 pt-1 text-xs font-semibold tracking-widest uppercase transition-colors ${
                  tab === t ? 'text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
                } ${tab === t ? 'arkhe-tab-active' : ''}`}
                style={{ fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.12em' }}
              >
                {t === 'research' ? 'Research Login' : 'Open Access'}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="px-8 pb-6">

            {/* ── RESEARCH TAB ─────────────────────────────────────────── */}
            {tab === 'research' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(244,244,245,0.35)', fontFamily: "'Rajdhani', sans-serif" }}>
                    Email
                  </label>
                  <input
                    type="email" autoComplete="email" required
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="researcher@institution.edu"
                    className="arkhe-input"
                    disabled={authLoading || authSuccess}
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(244,244,245,0.35)', fontFamily: "'Rajdhani', sans-serif" }}>
                    Passphrase
                  </label>
                  <input
                    type="password" autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="arkhe-input"
                    disabled={authLoading || authSuccess}
                  />
                </div>

                {authError && (
                  <div
                    className="rounded px-3 py-2 text-xs"
                    style={{
                      background: authError.startsWith('Check') ? 'rgba(34,211,238,0.07)' : 'rgba(239,68,68,0.08)',
                      border: authError.startsWith('Check') ? '1px solid rgba(34,211,238,0.2)' : '1px solid rgba(239,68,68,0.2)',
                      color: authError.startsWith('Check') ? '#67e8f9' : '#fca5a5',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {authError}
                  </div>
                )}

                {authSuccess && (
                  <div
                    className="rounded px-3 py-2 text-xs text-center"
                    style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)', color: '#22d3ee', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    ✓ Authenticated — initialising engine…
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <button type="submit" className="arkhe-btn-primary" disabled={authLoading || authSuccess}>
                    {authLoading ? 'Authenticating…' : 'Enter Research Environment'}
                  </button>
                  <button type="button" className="arkhe-btn-ghost" onClick={handleSignUp} disabled={authLoading || authSuccess}>
                    Create Account
                  </button>
                </div>
              </form>
            )}

            {/* ── GUEST TAB ────────────────────────────────────────────── */}
            {tab === 'guest' && (
              <div className="space-y-5">
                <div
                  className="rounded p-4 space-y-2 text-sm"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.02em' }}
                >
                  <p className="text-zinc-300 font-medium">Local Mode — No Account Required</p>
                  <ul className="space-y-1.5 text-zinc-500 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    <li>✓ Unlimited local genome loading</li>
                    <li>✓ Full mutation engine, PCR, ORF autopilot</li>
                    <li>✓ Local Chronos history (IndexedDB)</li>
                    <li className="text-zinc-600">✗ No Chronos cloud sync</li>
                    <li className="text-zinc-600">✗ No cross-device history</li>
                  </ul>
                  <p className="text-xs pt-1" style={{ color: 'rgba(34,211,238,0.5)', fontFamily: "'JetBrains Mono', monospace" }}>
                    Connect a Sovereign instance below for cloud features without an account.
                  </p>
                </div>
                <button className="arkhe-btn-primary" onClick={handleGuestAccess}>
                  Continue as Guest
                </button>
              </div>
            )}
          </div>

          {/* ── SOVEREIGNTY SETTINGS PANEL ──────────────────────────────── */}
          <div className="mx-8 mb-8" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => setSovOpen((v) => !v)}
              className="w-full flex items-center justify-between pt-4 pb-1 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="relative flex-shrink-0">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: sovereignModeActive ? '#22d3ee' : '#52525b',
                      boxShadow: sovereignModeActive ? '0 0 8px #22d3ee' : 'none',
                      transition: 'all 0.3s',
                    }}
                  />
                  {sovereignModeActive && (
                    <div className="absolute inset-0 rounded-full animate-ping" style={{ background: '#22d3ee', opacity: 0.4 }} />
                  )}
                </div>
                <span
                  className="text-xs font-semibold uppercase tracking-widest group-hover:text-zinc-300 transition-colors"
                  style={{ fontFamily: "'Rajdhani', sans-serif", color: sovereignModeActive ? 'rgba(34,211,238,0.8)' : 'rgba(255,255,255,0.3)' }}
                >
                  Sovereignty Settings
                </span>
                <SovStatusPill status={sovStatus} active={sovereignModeActive} />
              </div>
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                style={{ color: 'rgba(255,255,255,0.2)', transition: 'transform 0.25s', transform: sovOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <div className={`sov-section ${sovOpen ? 'open' : 'closed'}`}>
              <div className="pt-4 space-y-4">

                {/* Cloud Mode Indicator */}
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className="rounded p-3 flex flex-col gap-1"
                    style={{
                      background: sovereignModeActive ? 'rgba(34,211,238,0.04)' : 'rgba(255,255,255,0.06)',
                      border: sovereignModeActive ? '1px solid rgba(34,211,238,0.15)' : '1px solid rgba(255,255,255,0.12)',
                      transition: 'all 0.3s',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        Arkhé Central
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      Shared instance, rate-limited
                    </p>
                  </div>
                  <div
                    className="rounded p-3 flex flex-col gap-1"
                    style={{
                      background: sovereignModeActive ? 'rgba(34,211,238,0.07)' : 'rgba(255,255,255,0.03)',
                      border: sovereignModeActive ? '1px solid rgba(34,211,238,0.3)' : '1px solid rgba(255,255,255,0.06)',
                      transition: 'all 0.3s',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: sovereignModeActive ? '#22d3ee' : '#52525b', boxShadow: sovereignModeActive ? '0 0 6px #22d3ee' : 'none', transition: 'all 0.3s' }}
                      />
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: sovereignModeActive ? '#22d3ee' : '#52525b', transition: 'color 0.3s' }}
                      >
                        Sovereign Cloud
                      </span>
                    </div>
                    <p
                      className="text-[10px]"
                      style={{ fontFamily: "'JetBrains Mono', monospace", color: sovereignModeActive ? 'rgba(34,211,238,0.5)' : '#3f3f46' }}
                    >
                      Your Supabase, full quota
                    </p>
                  </div>
                </div>

                {/* URL Field */}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(244,244,245,0.25)', fontFamily: "'Rajdhani', sans-serif" }}>
                    Supabase Project URL
                  </label>
                  {/* FIX 4B: onChange resets status/error via the useEffect above */}
                  <input
                    type="url"
                    value={sovUrl}
                    onChange={(e) => setSovUrl(e.target.value)}
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    className="arkhe-input"
                    style={{ fontSize: '11px' }}
                  />
                </div>

                {/* Anon Key Field */}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(244,244,245,0.25)', fontFamily: "'Rajdhani', sans-serif" }}>
                    Anon / Service Key
                  </label>
                  {/* FIX 4B: onChange resets status/error via the useEffect above */}
                  <input
                    type="password"
                    value={sovKey}
                    onChange={(e) => setSovKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                    className="arkhe-input"
                    style={{ fontSize: '11px' }}
                  />
                </div>

                {/* Error display */}
                {sovError && (
                  <div
                    className="rounded px-3 py-2 text-[10px]"
                    style={{
                      background: sovStatus === 'ok' ? 'rgba(34,211,238,0.06)' : 'rgba(239,68,68,0.07)',
                      border: sovStatus === 'ok' ? '1px solid rgba(34,211,238,0.15)' : '1px solid rgba(239,68,68,0.15)',
                      color: sovStatus === 'ok' ? '#67e8f9' : '#fca5a5',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {sovError}
                  </div>
                )}

                {/* Action row */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="arkhe-btn-sov-test"
                    onClick={handleTestConnection}
                    disabled={sovStatus === 'testing' || !sovUrl || !sovKey}
                  >
                    {sovStatus === 'testing' ? '⟳ Probing…' : '⚡ Test Connection'}
                  </button>

                  {sovereignModeActive ? (
                    <button type="button" onClick={handleDeactivateSovereign} className="flex-1 arkhe-btn-ghost" style={{ fontSize: '11px' }}>
                      Revert to Central
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleActivateSovereign}
                      disabled={!sovTestOk}
                      className="flex-1"
                      style={{
                        background: sovTestOk ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                        border: sovTestOk ? '1px solid rgba(34,211,238,0.35)' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '4px',
                        padding: '8px',
                        color: sovTestOk ? '#22d3ee' : '#52525b',
                        fontFamily: "'Rajdhani', sans-serif",
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        cursor: sovTestOk ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                      }}
                    >
                      Activate Sovereign
                    </button>
                  )}
                </div>

                {/* Info note */}
                <p
                  className="text-[10px] pb-1"
                  style={{ color: 'rgba(244,244,245,0.18)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}
                >
                  Credentials stored in localStorage. Arkhé never transmits your key externally.
                  Run the Arkhé schema migration on your Supabase project before activating.
                </p>
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-0 left-8 right-8 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.12), transparent)' }}
          />
        </div>
      </div>
    </>
  );
}