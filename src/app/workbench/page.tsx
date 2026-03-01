'use client';

/**
 * src/app/workbench/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ARKHÉ GENESIS — Smart Workbench Entry (Task 3)
 *
 * Conditional routing logic:
 *   1. If NOT authenticated  → redirect to /login
 *   2. If first-time user    → show OnboardingOverlay, then reveal Workbench
 *   3. If returning user     → mount Workbench directly
 *
 * Auth check is performed client-side via supabase.auth.getSession() to avoid
 * double redirect conflicts with the existing SSR middleware (middleware.ts).
 * The middleware already hard-blocks unauthenticated access; this component
 * provides the additional onboarding-layer logic.
 *
 * localStorage key: 'isFirstTimeUser'
 *   Set to 'true' by the signup page on first registration.
 *   Set to 'false' by this component once onboarding is dismissed.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useArkheStore } from '@/store';
import Workbench from '@/components/layout/Workbench';
import OnboardingOverlay from '@/components/OnboardingOverlay';

type AuthState = 'checking' | 'unauthenticated' | 'onboarding' | 'ready';

export default function WorkbenchPage() {
  const router     = useRouter();
  const setUserId  = useArkheStore(s => s.setUserId);
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;

      if (!session?.user) {
        // Unauthenticated — let middleware's hard redirect handle it, but also
        // push client-side to avoid a flash of workbench content.
        router.replace('/login');
        setAuthState('unauthenticated');
        return;
      }

      // Propagate userId into the store before any engine calls.
      setUserId(session.user.id);

      // Check first-time-user flag — only valid after client hydration.
      const isFirstTime = typeof window !== 'undefined'
        && localStorage.getItem('isFirstTimeUser') === 'true';

      setAuthState(isFirstTime ? 'onboarding' : 'ready');
    }).catch(() => {
      if (!cancelled) router.replace('/login');
    });

    return () => { cancelled = true; };
  }, [router, setUserId]);

  const handleOnboardingClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('isFirstTimeUser', 'false');
    }
    setAuthState('ready');
  };

  // While checking — render nothing (middleware already protects the route).
  if (authState === 'checking' || authState === 'unauthenticated') {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Minimal pulse indicator — avoids layout flash */}
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(56,189,248,0.50)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    );
  }

  return (
    <>
      {/* Workbench is always mounted once auth is confirmed */}
      <Workbench />

      {/* Onboarding overlay sits on top, removed after completion */}
      <AnimatePresence>
        {authState === 'onboarding' && (
          <OnboardingOverlay onClose={handleOnboardingClose} />
        )}
      </AnimatePresence>
    </>
  );
}