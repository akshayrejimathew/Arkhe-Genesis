/**
 * useProteinFold.ts
 * React hook for protein folding – manages loading state and integrates with store.
 */

import { useArkheStore } from './useArkheStore';
import { useEffect, useState } from 'react';
import type { ProteinFold } from '@/lib/proteinFold';

export function useProteinFold(sequence: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fold = useArkheStore((state) => state.proteinFold);
  const foldProtein = useArkheStore((state) => state.foldProtein);
  const clearProteinFold = useArkheStore((state) => state.clearProteinFold);

  useEffect(() => {
    if (!sequence) {
      clearProteinFold();
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    foldProtein(sequence)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [sequence, foldProtein, clearProteinFold]);

  return { fold, loading, error, clear: clearProteinFold };
}