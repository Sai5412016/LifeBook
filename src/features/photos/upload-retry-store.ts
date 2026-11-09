/**
 * photos/upload-retry-store — the per-DEVICE retry records of the upload
 * queue (./upload-retry.ts) plus which photos' source files are missing on
 * this phone. Device state on purpose, not a synced column: whether THIS
 * phone failed to upload, or no longer holds the file, says nothing about the
 * other parent's phone (and the task forbids a schema change).
 *
 * AsyncStorage for persistence across app starts (so the backoff survives a
 * restart instead of hammering again), zustand so the settings screen
 * re-renders when the queue records something.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { UploadRetryState } from './upload-retry';

const STORAGE_KEY = 'lifebook_upload_retry_v1';

type RetryStoreState = {
  states: Record<string, UploadRetryState>;
  missingSourceIds: string[];
  loaded: boolean;
};

export const useUploadRetryStore = create<RetryStoreState>(() => ({
  states: {},
  missingSourceIds: [],
  loaded: false,
}));

/** Reads the persisted records once per app run. Never throws. */
export async function loadUploadRetryStates(): Promise<Record<string, UploadRetryState>> {
  const current = useUploadRetryStore.getState();
  if (current.loaded) {
    return current.states;
  }
  let states: Record<string, UploadRetryState> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === 'object') {
      states = parsed as Record<string, UploadRetryState>;
    }
  } catch (error) {
    console.error('[LifeBook] Upload-Wiederholungen konnten nicht gelesen werden', error);
  }
  useUploadRetryStore.setState({ states, loaded: true });
  return states;
}

/** Replaces all records (the queue writes once per run). Never throws. */
export async function saveUploadRetryStates(
  states: Record<string, UploadRetryState>,
  missingSourceIds: readonly string[],
): Promise<void> {
  useUploadRetryStore.setState({ states, missingSourceIds: [...missingSourceIds], loaded: true });
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    console.error('[LifeBook] Upload-Wiederholungen konnten nicht gespeichert werden', error);
  }
}
