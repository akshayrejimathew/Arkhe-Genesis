/**
 * src/app/settings/page.tsx
 * ============================================================================
 * ARKHÉ GENESIS – SETTINGS PAGE
 * ============================================================================
 *
 * FIXED (Vector B): Tier is now loaded from the Supabase `profiles` table,
 * not from localStorage. Changing tier calls a real database update.
 *
 * FIXED (Vector H): All `any` types eliminated.
 *   - `session` typed as `Session | null` from @supabase/supabase-js.
 *   - Tab icon typed as `LucideIcon`.
 *   - Auth guard added: unauthenticated users are redirected to /login.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useArkheStore } from '@/hooks/useArkheStore';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  User,
  Settings,
  CreditCard,
  Shield,
  LogOut,
  ChevronLeft,
  Save,
  Loader2,
} from 'lucide-react';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

// Must match the `tier` column constraint in the `profiles` table.
type Tier = 'free' | 'pro' | 'enterprise';
type Tab = 'general' | 'account' | 'billing' | 'security';

interface TabConfig {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

const tierNames: Record<Tier, string> = {
  free: 'Architect (Free)',
  pro: 'Demiurge ($20/mo)',
  enterprise: 'Pantheon (Enterprise)',
};

const tierDescriptions: Record<Tier, string> = {
  free: 'Local use only. No cloud sync.',
  pro: 'Enables Chronos Cloud Sync.',
  enterprise: 'Custom Sentinel rules, priority support.',
};

const VALID_TIERS: Tier[] = ['free', 'pro', 'enterprise'];

function isValidTier(value: unknown): value is Tier {
  return typeof value === 'string' && VALID_TIERS.includes(value as Tier);
}

export default function SettingsPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [session, setSession] = useState<Session | null>(null);
  const [currentTier, setCurrentTier] = useState<Tier>('free');
  const [isSaving, setIsSaving] = useState(false);
  const [tierSaveError, setTierSaveError] = useState<string | null>(null);

  // Loading state prevents a flash of unauthenticated content while we wait
  // for getSession() to resolve.
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isLoadingTier, setIsLoadingTier] = useState(false);

  const userId = useArkheStore((state) => state.userId);
  const setUserId = useArkheStore((state) => state.setUserId);

  // ── Bootstrap: resolve session and tier from Supabase ─────────────────────
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // 1. Resolve auth session.
      const {
        data: { session: activeSession },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!activeSession?.user) {
        // No valid session — middleware should have caught this, but guard
        // again to handle direct component renders in tests or Storybook.
        router.replace('/login');
        return;
      }

      setSession(activeSession);
      setUserId(activeSession.user.id);
      setIsLoadingSession(false);

      // 2. Fetch tier from the profiles table (not localStorage).
      setIsLoadingTier(true);
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', activeSession.user.id)
        .single<{ tier: string }>();

      if (cancelled) return;

      if (!profileError && profile && isValidTier(profile.tier)) {
        setCurrentTier(profile.tier);
      } else if (profileError) {
        console.error('[Settings] Failed to load profile tier:', profileError.message);
      }
      setIsLoadingTier(false);
    }

    bootstrap();

    // Also subscribe to future auth changes (e.g., token refresh, sign-out
    // from another tab).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      if (!newSession) {
        router.replace('/login');
        return;
      }
      setSession(newSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, setUserId]);

  // ── Tier change: write to Supabase profiles, not localStorage ─────────────
  const handleTierChange = async (tier: Tier) => {
    if (!session?.user.id) return;
    if (tier === currentTier) return;

    setTierSaveError(null);
    const previousTier = currentTier;
    setCurrentTier(tier); // Optimistic update for immediate UI feedback.

    const { error } = await supabase
      .from('profiles')
      .update({ tier })
      .eq('id', session.user.id);

    if (error) {
      // Rollback optimistic update on failure.
      setCurrentTier(previousTier);
      setTierSaveError(
        `Failed to update subscription: ${error.message}. Please try again or contact support.`
      );
      console.error('[Settings] Tier update failed:', error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUserId(null);
    router.push('/login');
  };

  const handleSave = async () => {
    setIsSaving(true);
    // Extend here to persist general preferences to Supabase when those fields
    // are backed by real columns. For now the save is a no-op placeholder.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    setIsSaving(false);
  };

  const tabs: TabConfig[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'account', label: 'Account', icon: User },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  // ── Loading gate ──────────────────────────────────────────────────────────
  if (isLoadingSession) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          <p className="text-xs text-quaternary uppercase tracking-wider">
            Verifying session…
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-void text-primary flex">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="absolute top-6 left-6 flex items-center gap-2 px-3 py-2 bg-void-panel border border-razor rounded-md text-xs text-quaternary hover:text-primary transition-colors z-10"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      {/* Sidebar */}
      <aside className="w-64 border-r border-razor bg-void-panel p-6 flex flex-col">
        <div className="mb-8 pt-10">
          <h1 className="text-lg font-black uppercase tracking-wider text-primary">
            Settings
          </h1>
        </div>

        <nav className="space-y-1 flex-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-void-surface text-primary'
                    : 'text-quaternary hover:text-primary hover:bg-void-surface/50'
                )}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pt-8 border-t border-razor mt-8">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {/* ── General Tab ───────────────────────────────────────────────── */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              <h2 className="text-xl font-medium">General Preferences</h2>
              <div className="bg-void-panel border border-razor rounded-lg p-6 space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-quaternary mb-2">
                    Theme
                  </label>
                  <select className="w-full bg-void border border-razor rounded-md px-3 py-2 text-sm text-primary">
                    <option value="dark">Dark (default)</option>
                    <option value="light" disabled>
                      Light (coming soon)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-quaternary mb-2">
                    Default View
                  </label>
                  <select className="w-full bg-void border border-razor rounded-md px-3 py-2 text-sm text-primary">
                    <option value="sequence">Sequence Editor</option>
                    <option value="protein">Protein Viewer</option>
                    <option value="pcr">PCR Workbench</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Account Tab ───────────────────────────────────────────────── */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <h2 className="text-xl font-medium">Account Information</h2>
              <div className="bg-void-panel border border-razor rounded-lg p-6 space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-quaternary mb-2">
                    Email
                  </label>
                  <div className="bg-void border border-razor rounded-md px-3 py-2 text-sm text-primary">
                    {session?.user.email ?? 'Not signed in'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-quaternary mb-2">
                    User ID
                  </label>
                  <div className="bg-void border border-razor rounded-md px-3 py-2 text-sm font-mono text-quaternary">
                    {userId ?? '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Billing Tab ───────────────────────────────────────────────── */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              <h2 className="text-xl font-medium">Subscription & Billing</h2>
              <div className="bg-void-panel border border-razor rounded-lg p-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-xs uppercase tracking-wider text-quaternary">
                      Current Tier
                    </label>
                    {isLoadingTier && (
                      <div className="flex items-center gap-1.5 text-xs text-quaternary">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading…
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {VALID_TIERS.map((tier) => (
                      <button
                        key={tier}
                        onClick={() => handleTierChange(tier)}
                        disabled={isLoadingTier || tier === currentTier}
                        className={cn(
                          'p-4 border rounded-lg text-left transition-all',
                          currentTier === tier
                            ? 'border-cyan-500 bg-cyan-500/10 cursor-default'
                            : 'border-razor bg-void hover:bg-void-surface disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        <div className="font-bold text-sm mb-1">
                          {tierNames[tier]}
                        </div>
                        <div className="text-[10px] text-quaternary">
                          {tierDescriptions[tier]}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Tier save error */}
                  {tierSaveError && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="text-xs text-red-400">{tierSaveError}</p>
                    </div>
                  )}
                </div>

                {/* Tier status banners */}
                {currentTier === 'pro' && !isLoadingTier && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                    <p className="text-xs text-emerald-400">
                      Chronos Cloud Sync is active.
                    </p>
                  </div>
                )}
                {currentTier === 'enterprise' && !isLoadingTier && (
                  <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                    <p className="text-xs text-purple-400">
                      Custom Sentinel rules enabled.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Security Tab ──────────────────────────────────────────────── */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <h2 className="text-xl font-medium">Security</h2>
              <div className="bg-void-panel border border-razor rounded-lg p-6 space-y-3">
                <button
                  onClick={async () => {
                    if (!session?.user.email) return;
                    await supabase.auth.resetPasswordForEmail(session.user.email);
                  }}
                  className="px-4 py-2 bg-void border border-razor rounded-md text-sm hover:bg-void-surface transition-colors"
                >
                  Send Password Reset Email
                </button>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut({ scope: 'global' });
                    setUserId(null);
                    router.push('/login');
                  }}
                  className="block px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-md text-sm text-rose-400 hover:bg-rose-500/20 transition-colors"
                >
                  Revoke All Sessions
                </button>
              </div>
            </div>
          )}

          {/* Save button */}
          <div className="mt-8 flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2 bg-cyan-500 text-black rounded-md text-sm font-medium hover:bg-cyan-400 disabled:opacity-50 transition-colors"
            >
              {isSaving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}