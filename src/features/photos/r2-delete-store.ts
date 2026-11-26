/**
 * photos/r2-delete-store — persists ./r2-delete-queue.ts per device
 * (AsyncStorage, same pattern as ./upload-retry-store.ts). Device state on
 * purpose: which delete failed on THIS phone says nothing about the other
 * phone, and the task forbids a schema change. Never throws.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { PendingR2Delete } from './r2-delete-queue';

const STORAGE_KEY = 'lifebook_r2_delete_pending_v1';

type R2DeleteStoreState = { queue: PendingR2Delete[]; loaded: boolean };

export const useR2DeleteStore = create<R2DeleteStoreState>(() => ({ queue: [], loaded: false }));

export async function loadPendingR2Deletes(): Promise<PendingR2Delete[]> {
  const current = useR2DeleteStore.getState();
  if (current.loaded) {
    return current.queue;
  }
  let queue: PendingR2Delete[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      queue = parsed as PendingR2Delete[];
    }
  } catch (error) {
    console.error('[LifeBook] Offene R2-Löschungen konnten nicht gelesen werden', error);
  }
  useR2DeleteStore.setState({ queue, loaded: true });
  return queue;
}

export async function savePendingR2Deletes(queue: readonly PendingR2Delete[]): Promise<void> {
  useR2DeleteStore.setState({ queue: [...queue], loaded: true });
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[LifeBook] Offene R2-Löschungen konnten nicht gespeichert werden', error);
  }
}
