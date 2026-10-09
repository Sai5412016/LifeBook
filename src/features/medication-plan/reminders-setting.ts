/**
 * medication-plan/reminders-setting — the per-DEVICE switch "Erinnerungen auf
 * diesem Handy" (task 2026-10-09). Per device on purpose: Andi's and
 * Tamara's phones share the plan through sync but each decides for itself
 * whether it should ring. Lives in AsyncStorage like the Alltag calendar
 * mode (timeline/hooks/use-calendar-view-mode.ts) — never in the synced
 * database, so switching it off on one phone cannot switch it off on the
 * other.
 *
 * A small zustand store (already a project dependency, see
 * core/notifications/diagnostics.ts) so the switch on /alltag/mehr and the
 * root-level reminders effect (./components/plan-reminders-effect.tsx) read
 * and react to ONE value.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { create } from 'zustand';

import { parseRemindersSetting, serializeRemindersSetting } from './logic';

const STORAGE_KEY = 'lifebook_medication_reminders_enabled_v1';

type RemindersSettingState = {
  /** Documented default: on. */
  enabled: boolean;
  /** False until the stored value has been read (or has failed to read). */
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
};

const useRemindersSettingStore = create<RemindersSettingState>((set, get) => ({
  enabled: true,
  loaded: false,

  load: async () => {
    if (get().loaded) {
      return;
    }
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      // A switch tapped while the read was in flight wins over the stored value.
      if (!get().loaded) {
        set({ enabled: parseRemindersSetting(stored), loaded: true });
      }
    } catch (error) {
      console.error('[LifeBook] Erinnerungs-Schalter konnte nicht gelesen werden', error);
      if (!get().loaded) {
        set({ loaded: true });
      }
    }
  },

  setEnabled: (enabled) => {
    set({ enabled, loaded: true });
    AsyncStorage.setItem(STORAGE_KEY, serializeRemindersSetting(enabled)).catch((error) => {
      console.error('[LifeBook] Erinnerungs-Schalter konnte nicht gespeichert werden', error);
    });
  },
}));

export function useMedicationRemindersSetting(): {
  enabled: boolean;
  loaded: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const enabled = useRemindersSettingStore((state) => state.enabled);
  const loaded = useRemindersSettingStore((state) => state.loaded);
  const setEnabled = useRemindersSettingStore((state) => state.setEnabled);
  const load = useRemindersSettingStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  return { enabled, loaded, setEnabled };
}
