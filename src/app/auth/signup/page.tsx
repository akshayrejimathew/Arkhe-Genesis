'use client';

/**
 * src/app/auth/signup/page.tsx   — "The Genesis Gate"
 * ─────────────────────────────────────────────────────────────────────────────
 * TASK 2: Signup Page — matches Login's Abyssal glassmorphism style.
 *
 * Flow:
 *   1. User fills email + password + confirm-password.
 *   2. supabase.auth.signUp() called.
 *   3a. If immediate session (email confirm disabled):
 *       → sets localStorage 'isFirstTimeUser' = 'true'
 *       → propagates userId to store
 *       → redirects to /workbench  (onboarding overlay renders there)
 *   3b. If email confirmation required:
 *       → shows success state asking user to check email.
 *
 * IMPORTANT: Add '/auth/signup' to middleware.ts AUTH_ROUTES so that already-
 * authenticated users are bounced to /workbench:
 *
 *   const AUTH_ROUTES = ['/login', '/auth/signup'];
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useArkheStore } from '@/store';
import ArkheLogo from '@/components/branding/ArkheLogo';

// ── Password strength indicator ───────────────────────────────────────────────

function StrengthBar({ password }: { password: string }) {
  if (!password) return null;

  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score  = checks.filter(Boolean).length;
  const colors = ['#334155', '#EF4444', '#F59E0B', '#10B981', '#38BDF8'];
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            style={{
              flex: 1, height: 2, borderRadius: 999,
              background:  i <= score ? colors[score] : 'rgba(255,255,255,0.06)',
              transition: 'background 300ms',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 9.5, color: colors[score], letterSpacing: '0.06em', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
        {labels[score]}
      </span>
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

interface FieldProps {
  id:          string;
  label:       string;
  type:        string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
  autoComplete:string;
  disabled:    boolean;
  error?:      string;
  rightSlot?:  React.ReactNode;
}

function Field({ id, label, type, value, onChange, placeholder, autoComplete, disabled, error, rightSlot }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 9.5, fontWeight: 700, color: '#334155', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id} type={type} value={value} required disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{
            width: '100%', padding: rightSlot ? '9px 38px 9px 12px' : '9px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${error ? 'rgba(239,68,68,0.40)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 6, fontSize: 12, color: '#E2E8F0',
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
            outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms',
          }}
          className="focus:border-[rgba(56,189,248,0.45)] placeholder:text-[#1E293B] disabled:opacity-50"
        />
        {rightSlot && (
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
            {rightSlot}
          </div>
        )}
      </div>
      {error && <span style={{ fontSize: 9.5, color: '#F87171', letterSpacing: '0.04em', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>{error}</span>}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const router    = useRouter();
  const setUserId = useArkheStore(s => s.setUserId);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [isLoading,setIsLoading]= useState(false);
  const [authError,setAuthError]= useState<string | null>(null);
  const [success,  setSuccess]  = useState(false);

  const confirmError = confirm && confirm !== password ? 'Passwords do not match' : '';

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setAuthError(null);

    if (password !== confirm) { setAuthError('Passwords do not match.'); return; }
    if (password.length < 8)  { setAuthError('Password must be at least 8 characters.'); return; }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists')) {
          setAuthError('An account with this email already exists. Please log in instead.');
        } else {
          setAuthError(error.message);
        }
        return;
      }

      if (!data.user) {
        // Email confirmation flow — Supabase returns no user until confirmed.
        setSuccess(true);
        return;
      }

      // Immediate session (confirmation disabled in Supabase dashboard).
      setUserId(data.user.id);
      if (typeof window !== 'undefined') {
        localStorage.setItem('isFirstTimeUser', 'true');
      }
      router.push('/workbench');

    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Success / confirmation-pending state ──────────────────────────────────
  if (success) {
    return (
      <div className="relative min-h-screen bg-[#020617] flex items-center justify-center p-6 overflow-hidden">
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 45% at 50% 50%, rgba(56,189,248,0.05) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <motion.div initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }} style={{ background: 'rgba(9,15,28,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '40px 36px', width: '100%', maxWidth: 360, textAlign: 'center', boxShadow: '0 32px 80px rgba(2,6,23,0.70)', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.50), transparent)', position: 'absolute', top: 0, left: 0, right: 0 }} />
          <CheckCircle2 size={44} style={{ color: '#10B981', marginBottom: 20 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', marginBottom: 8, fontFamily: 'var(--font-inter, system-ui, sans-serif)' }}>Check your email</p>
          <p style={{ fontSize: 11, color: '#475569', lineHeight: 1.75, marginBottom: 28 }}>
            We&apos;ve sent a confirmation link to<br />
            <span style={{ color: '#38BDF8' }}>{email}</span>
          </p>
          <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 6, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.22)', color: '#38BDF8', fontSize: 11, fontWeight: 600, textDecoration: 'none', letterSpacing: '0.06em', transition: 'all 150ms' }} className="hover:bg-[rgba(56,189,248,0.14)]">
            Back to Login <ArrowRight size={12} />
          </Link>
        </motion.div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-[#020617] flex items-center justify-center p-6 overflow-hidden">

      {/* Ambient gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 45% at 50% 50%, rgba(56,189,248,0.05) 0%, transparent 65%)', pointerEvents: 'none' }} />

      {/* Subtle grid */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(56,189,248,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.02) 1px, transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none' }} />

      {/* Corner brackets — decorative */}
      {[['top-3 left-3', 'border-t border-l'], ['top-3 right-3', 'border-t border-r'], ['bottom-3 left-3', 'border-b border-l'], ['bottom-3 right-3', 'border-b border-r']].map(([pos, borders], i) => (
        <div key={i} className={`absolute ${pos} w-4 h-4 ${borders} border-[rgba(56,189,248,0.15)] pointer-events-none`} />
      ))}

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        <div style={{ background: 'rgba(9,15,28,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 32px 80px rgba(2,6,23,0.70)' }}>

          {/* Top accent line */}
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.50), transparent)' }} />

          {/* Header */}
          <div style={{ padding: '28px 32px 22px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 66, height: 66, borderRadius: 12, background: '#020617', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 18 }}>
              <ArkheLogo size={40} variant="icon" glow className="text-white" />
            </div>
            <h1 style={{ fontSize: 17, fontWeight: 600, color: '#F8FAFC', marginBottom: 4, letterSpacing: '-0.03em', fontFamily: 'var(--font-inter, system-ui, sans-serif)' }}>
              Create your account
            </h1>
            <p style={{ fontSize: 10.5, color: '#334155', letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
              Arkhé Genesis · Sovereign IDE
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ padding: '26px 32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Error banner */}
            {authError && (
              <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#F87171', fontSize: 11.5, lineHeight: 1.5, fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
                <svg style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {authError}
              </div>
            )}

            {/* Email */}
            <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="scientist@lab.org" autoComplete="email" disabled={isLoading} />

            {/* Password */}
            <div>
              <Field
                id="password" label="Password" type={showPw ? 'text' : 'password'} value={password}
                onChange={setPassword} placeholder="••••••••••••" autoComplete="new-password"
                disabled={isLoading}
                rightSlot={
                  <button type="button" onClick={() => setShowPw(v => !v)} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 2, display: 'flex' }}>
                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                }
              />
              <StrengthBar password={password} />
            </div>

            {/* Confirm */}
            <Field
              id="confirm" label="Confirm Password" type={showPw ? 'text' : 'password'} value={confirm}
              onChange={setConfirm} placeholder="••••••••••••" autoComplete="new-password"
              disabled={isLoading} error={confirmError}
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || (!!confirm && confirm !== password)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 20px', borderRadius: 6, background: '#38BDF8', color: '#020617', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', fontFamily: 'var(--font-jetbrains-mono, monospace)', border: 'none', cursor: isLoading ? 'wait' : 'pointer', transition: 'all 150ms', marginTop: 4 }}
              className="hover:bg-[#7DD3FC] active:bg-[#0EA5E9] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <><Spinner /><span>Creating account…</span></>
              ) : (
                <><span>Create Account</span><ArrowRight size={14} /></>
              )}
            </button>
          </form>

          {/* Footer — links to Login */}
          <div style={{ padding: '0 32px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#334155', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>Already have an account?</span>
            <Link href="/login" style={{ fontSize: 11, color: '#38BDF8', fontFamily: 'var(--font-jetbrains-mono, monospace)', fontWeight: 600, textDecoration: 'none', transition: 'color 150ms' }} className="hover:text-[#7DD3FC]">
              Sign in →
            </Link>
          </div>
        </div>

        {/* Status indicator */}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#1E293B', fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
            <div style={{ position: 'relative', width: 6, height: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#10B981', animation: 'ping 1.5s ease-in-out infinite' }} />
            </div>
            System Ready
          </div>
        </div>
      </motion.div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.15), transparent)', pointerEvents: 'none' }} />
    </div>
  );
}