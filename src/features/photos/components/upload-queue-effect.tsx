/**
 * photos/components/upload-queue-effect — keeps the photo upload queue going
 * on its own (task 2026-11-09). Mounted ONCE in the root layout next to the
 * other auth-level effects (CLAUDE.md Architekturregel 8: what must hold for
 * every signed-in user hangs on the auth state, not on a screen or an action).
 *
 * WHY: until 2026-11-09 the queue only ran right after an import
 * (import.ts) or on the Chronik button. Photo 01a18883… (29.10.2026) failed
 * once at its medium step and then simply never ran again — weeks of the app
 * being open on WLAN changed nothing.
 *
 * Runs the queue:
 *  - at app start, once signed in,
 *  - whenever the app comes back to the foreground,
 *  - when the network changes (e.g. the phone joins WLAN — originals wait for it),
 *  - every RETRY_TICK_MS while the app is in the foreground, so a retry whose
 *    pause has run out (./../upload-retry.ts) is picked up without a restart.
 * A tick with nothing due is a local query only: no network, no upload.
 * Concurrent triggers share one run (storage.ts#runUploadQueue), and photos in
 * their retry pause or past the attempt limit are skipped there — so this can
 * never turn into a tight retry loop on a permanent error.
 */

import { usePowerSync } from '@powersync/react-native';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/core/auth/session-store';

import { runUploadQueue } from '../storage';

const RETRY_TICK_MS = 60_000;

export function UploadQueueEffect() {
  const db = usePowerSync();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const kick = () => {
      if (AppState.currentState !== 'active') {
        return;
      }
      // Never awaited, never throws into React: the queue logs per photo.
      runUploadQueue(db).catch((error) => {
        console.error('[LifeBook] Upload-Warteschlange fehlgeschlagen', error);
      });
    };

    kick();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') kick();
    });
    let network: { remove: () => void } | null = null;
    try {
      network = Network.addNetworkStateListener(() => kick());
    } catch (error) {
      console.error('[LifeBook] Netzwerk-Beobachtung nicht verfügbar', error);
    }
    const timer = setInterval(kick, RETRY_TICK_MS);

    return () => {
      appState.remove();
      network?.remove();
      clearInterval(timer);
    };
  }, [db, signedIn]);

  return null;
}
