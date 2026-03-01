'use client';

/**
 * src/app/login/page.tsx — "The Airlock"
 * ─────────────────────────────────────────────────────────────────────────────
 * UPDATED (Task 2): Added "Create account →" link to the Signup page.
 * All other logic unchanged from original.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ArkheLogo from '@/components/branding/ArkheLogo';
import { supabase } from '@/lib/supabase';
import { useArkheStore } from '@/store';

export default function LoginPage() {
  const router    = useRouter();
  const setUserId = useArkheStore(s => s.setUserId);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [isLoading,setIsLoading]= useState(false);
  const [authError,setAuthError]= useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('email not confirmed')) {
          setAuthError('Invalid email or password. Please try again.');
        } else {
          setAuthError(error.message);
        }
        return;
      }

      if (!data.user) {
        setAuthError('Authentication succeeded but no user was returned. Please contact support.');
        return;
      }

      setUserId(data.user.id);
      router.push('/workbench');

    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-void flex items-center justify-center p-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-void-surface/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm fade-in">
        <div className="bg-void-panel border border-razor rounded-lg overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center border-b border-razor">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-lg bg-void border border-razor mb-6">
              <ArkheLogo size={56} variant="icon" glow className="text-white" />
            </div>
            <h1 className="text-xl font-medium text-primary mb-1 tracking-tight">Arkhé Genesis</h1>
            <p className="text-sm text-tertiary tracking-tight">Genomic IDE</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {authError && (
              <div role="alert" className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="block text-xs font-medium text-quaternary uppercase tracking-wider">Email</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="scientist@lab.org" className="w-full px-3 py-2.5 bg-void border border-razor rounded-md text-sm text-primary placeholder:text-disabled focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" required disabled={isLoading} autoComplete="email" />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-xs font-medium text-quaternary uppercase tracking-wider">Password</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••••" className="w-full px-3 py-2.5 bg-void border border-razor rounded-md text-sm text-primary placeholder:text-disabled focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" required disabled={isLoading} autoComplete="current-password" />
            </div>

            <button type="submit" disabled={isLoading} className="w-full mt-6 px-4 py-2.5 bg-primary text-void rounded-md text-sm font-medium hover:bg-secondary active:bg-tertiary transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Authenticating…</span>
                </>
              ) : 'Enter Workbench'}
            </button>
          </form>

          {/* Footer — UPDATED: added Signup link (Task 2) */}
          <div className="px-8 pb-8 border-t border-razor pt-6 space-y-4">
            {/* Signup CTA */}
            <div className="flex items-center justify-center gap-2 text-xs">
              <span className="text-disabled">New to Arkhé Genesis?</span>
              <Link href="/auth/signup" className="text-primary font-medium hover:text-secondary transition-colors">
                Create account →
              </Link>
            </div>

            {/* Original footer links */}
            <div className="flex items-center justify-between text-xs">
              <a href="#" className="text-tertiary hover:text-quaternary transition-colors">Documentation</a>
              <a href="#" className="text-tertiary hover:text-quaternary transition-colors">Support</a>
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-2 text-xs text-disabled">
            <div className="relative">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-success animate-ping" />
            </div>
            <span>System Ready</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-void-surface/30 to-transparent" />
    </div>
  );
}