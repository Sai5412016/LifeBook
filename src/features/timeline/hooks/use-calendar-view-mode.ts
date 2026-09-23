/**
 * timeline/hooks/use-calendar-view-mode — remembers whether the Alltag
 * calendar is showing the week strip or the full month grid (task
 * 2026-09-26: "Der Zustand wird gemerkt und beim nächsten Öffnen
 * wiederhergestellt").
 *
 * Uses `@react-native-async-storage/async-storage` directly (already a
 * project dependency — core/auth/session-store.ts persists the Supabase
 * session through it) rather than the `user_preferences` PowerSync table
 * the task suggested as a first option ("user_preferences oder was dort
 * üblich ist"). `user_preferences` exists in core/db/schema.ts but has no
 * repository anywhere in this codebase — nothing has ever written to it,
 * so its sync-rules/RLS/REPLICA IDENTITY coverage on the live database is
 * unverified (exactly the class of risk CLAUDE.md Fallstrick 1 warns
 * about: a table existing in the CLIENT schema is not proof a write to it
 * actually reaches Supabase). This is a purely per-device UI preference —
 * it does not need to sync between the two parents' phones — so
 * AsyncStorage is both lower-risk and, per the task's own "oder was dort
 * üblich ist", the already-established way this app persists something
 * locally.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CalendarViewMode = 'week' | 'month';

const STORAGE_KEY = 'lifebook_alltag_calendar_view_mode_v1';
const DEFAULT_MODE: CalendarViewMode = 'week';

function isCalendarViewMode(value: string | null): value is CalendarViewMode {
  return value === 'week' || value === 'month';
}

/**
 * `[mode, setMode]` — `setMode` updates state immediately (no flicker back
 * to the default while the write completes) and persists in the
 * background. Starts at the documented default ("Standard beim
 * allerersten Start: Wochenstreifen") and swaps to the stored value once
 * the async read resolves, if one exists.
 */
export function useCalendarViewMode(): [CalendarViewMode, (mode: CalendarViewMode) => void] {
  const [mode, setModeState] = useState<CalendarViewMode>(DEFAULT_MODE);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isCalendarViewMode(stored)) {
          setModeState(stored);
        }
      })
      .catch((error) => {
        console.error('[LifeBook] Kalender-Ansicht konnte nicht geladen werden', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: CalendarViewMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((error) => {
      console.error('[LifeBook] Kalender-Ansicht konnte nicht gespeichert werden', error);
    });
  }, []);

  return [mode, setMode];
}
