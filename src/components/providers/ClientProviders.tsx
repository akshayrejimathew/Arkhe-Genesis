'use client';

import { useState, useEffect } from 'react';
import OnboardingOverlay from '@/components/OnboardingOverlay';

interface ClientProvidersProps {
  children: React.ReactNode;
}

export default function ClientProviders({ children }: ClientProvidersProps) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const hasSeenIntro = localStorage.getItem('seen_intro');
    if (!hasSeenIntro) {
      setShowOnboarding(true);
    }
  }, []);

  const handleCloseOnboarding = () => {
    setShowOnboarding(false);
  };

  return (
    <>
      {showOnboarding && (
        <OnboardingOverlay onClose={handleCloseOnboarding} />
      )}
      {children}
    </>
  );
}
