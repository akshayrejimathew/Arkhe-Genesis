/**
 * src/hooks/useSentinelUpdate.ts
 * ============================================================================
 * ARKHÉ SENTINEL – Automatic Signature Update Hook
 * ============================================================================
 *
 * Fetches the latest signature library from a remote URL on app start,
 * compares versions, updates IndexedDB, and triggers a Magic Wand notification.
 */

import { useEffect } from 'react';
import { get, set } from 'idb-keyval';
import { useArkheStore } from '@/store';
import type { SignatureLibrary } from '@/lib/sentinel/ScreeningEngine';

const SIGNATURE_STORAGE_KEY = 'arkhe_sentinel_signatures';
const REMOTE_SIGNATURE_URL = process.env.NEXT_PUBLIC_SENTINEL_SIGNATURE_URL ||
  'https://raw.githubusercontent.com/arkhe-genesis/sentinel/main/signatures.json';

export function useSentinelUpdate() {
  const addSystemLog = useArkheStore((state) => state.addSystemLog);
  const setSentinelLibrary = useArkheStore((state) => state.setSentinelLibrary);

  useEffect(() => {
    let isMounted = true;

    async function updateSignatures() {
      try {
        // Fetch remote manifest
        const response = await fetch(REMOTE_SIGNATURE_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const remoteLib: SignatureLibrary = await response.json();
        // Basic validation
        if (!remoteLib.version || typeof remoteLib.signatures !== 'object') {
          throw new Error('Invalid signature format');
        }

        // Convert signatures object to Map
        const signaturesMap = new Map(Object.entries(remoteLib.signatures));
        remoteLib.signatures = signaturesMap;

        // Get stored version
        const storedLib = await get<SignatureLibrary>(SIGNATURE_STORAGE_KEY);

        if (!storedLib || storedLib.version !== remoteLib.version) {
          // New version available → store it
          await set(SIGNATURE_STORAGE_KEY, remoteLib);
          if (isMounted) {
            setSentinelLibrary(remoteLib);
            addSystemLog({
              timestamp: Date.now(),
              category: 'SENTINEL',
              message: `🧬 Sentinel signatures updated to v${remoteLib.version}`,
              level: 'success',
            });

            // Optional: show a Magic Wand notification
            // (we'll keep it as a log for now; the component can listen to logs)
          }
        } else {
          // Already up to date
          if (isMounted) {
            setSentinelLibrary(storedLib);
          }
        }
      } catch (error) {
        console.error('Sentinel update failed:', error);
        // Fallback to stored library (if any)
        const storedLib = await get<SignatureLibrary>(SIGNATURE_STORAGE_KEY);
        if (storedLib && isMounted) {
          setSentinelLibrary(storedLib);
        }
      }
    }

    updateSignatures();

    return () => {
      isMounted = false;
    };
  }, [addSystemLog, setSentinelLibrary]);
}