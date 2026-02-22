'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ROOT ENTRY POINT
 * Immediately redirects to /login for authentication
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <div className="w-2 h-2 rounded-full bg-primary/20 animate-pulse" />
    </div>
  );
}