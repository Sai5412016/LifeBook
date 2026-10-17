/**
 * medication-plan/components/plan-reminders-effect — the TRIGGERS of the
 * reminder reconciler (./../reconcile.ts) on this phone, plus opening the
 * Alltag tab when a reminder is tapped. Mounted ONCE in the root layout next
 * to PushRegistrationEffect (CLAUDE.md Architekturregel 8: whatever must hold
 * for every signed-in user hangs on the auth state, not on a screen).
 *
 * 2026-10-17, "Tamaras Handy klingelt nicht": the reconcile now reads EVERY
 * plan row on this device (useAllMedicationPlanRows), not only the plans of
 * the child on screen, and its result no longer depends on who created a
 * plan or on which phone. It runs:
 *  - at app start (this effect mounts),
 *  - when the app returns to the foreground (AppState 'active') — Android
 *    may have dropped alarms, the day may have rolled over, the permission
 *    may have been switched on in the system settings meanwhile,
 *  - whenever a `reminders` row changes: the PowerSync live query re-emits
 *    for local writes (anlegen/bearbeiten/pausieren/löschen) AND for rows
 *    that arrive by sync from the other phone,
 *  - when today's doses change (today's reminder is dropped once given, on
 *    either phone), when the day rolls over, when the per-device switch
 *    flips, and when the permission changes.
 * Every run only applies the DIFFERENCE (idempotent), so repeated starts
 * never pile up duplicate notifications.
 *
 * Permission (task 2026-10-17, Punkt 4): asked ONCE per device, with its
 * reason, as soon as this phone holds a plan that wants a reminder — the
 * other phone never runs the plan form, so asking only there was not enough.
 * A refusal is shown as a hint on the plan screen, never asked again here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { useAuth } from '@/core/auth/session-store';
import { usePushDiagnostics } from '@/core/notifications';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useChildFirstNames } from '@/features/household/repository';
import { useGabenAllerKinderAmTag } from '@/features/medication/repository';

import { PERMISSION_REASON } from '../logic';
import {
  REMINDER_DATA_TYPE,
  getReminderPermissionDetail,
  requestReminderPermission,
  syncPlanReminders,
} from '../notifications';
import { plansFromRows, wantedReminders } from '../reconcile';
import { shouldAskForReminderPermission, useReminderStatusStore } from '../reminder-status';
import { useMedicationRemindersSetting } from '../reminders-setting';
import { useAllMedicationPlanRows } from '../repository';
import { givenPlanIds } from '../schedule';

const DAY_ROLLOVER_CHECK_MS = 60_000;
const PERMISSION_ASKED_KEY = 'lifebook_medication_reminders_permission_asked_v1';

/** "Today" in the device zone, re-read every minute and on every return to the foreground. */
function useTodayLocalDate(tz: string, foregroundTick: number): string {
  const [today, setToday] = useState(() => toLocalDate(nowUtcIso(), tz));
  useEffect(() => {
    setToday(toLocalDate(nowUtcIso(), tz));
    const id = setInterval(() => setToday(toLocalDate(nowUtcIso(), tz)), DAY_ROLLOVER_CHECK_MS);
    return () => clearInterval(id);
  }, [tz, foregroundTick]);
  return today;
}

/** Counts every return of the app to the foreground. */
function useForegroundTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setTick((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);
  return tick;
}

/** Explains, then asks the system — returns once the person has answered. Never throws. */
async function askWithReason(): Promise<void> {
  const proceed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Erinnerungen für den Medikamentenplan',
      PERMISSION_REASON,
      [
        { text: 'Nicht jetzt', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Weiter', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (proceed) {
    await requestReminderPermission();
  }
}

export function MedicationPlanRemindersEffect() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const tz = deviceTimeZone();
  const foregroundTick = useForegroundTick();
  const today = useTodayLocalDate(tz, foregroundTick);
  const rows = useAllMedicationPlanRows();
  const todaysDoses = useGabenAllerKinderAmTag(today);
  const childNames = useChildFirstNames();
  const { enabled, loaded } = useMedicationRemindersSetting();
  // The push registration at app start may decide the permission; re-run then.
  const { permissionStatus, runStatus } = usePushDiagnostics();
  // The push registration asks the system itself at app start; ours waits
  // until that has finished, so two dialogs never stack on top of each other.
  const pushRegistrationSettled = runStatus === 'done' || runStatus === 'failed';
  // Bumped after our own permission question, so the reconcile re-reads it.
  const [permissionTick, setPermissionTick] = useState(0);
  // Also changes when the plan screen's "Erlauben" button got a new answer.
  const knownPermission = useReminderStatusStore((state) => state.permission?.status ?? null);

  const plans = useMemo(() => plansFromRows(rows, tz), [rows, tz]);
  const anyPlanWantsReminder = plans.some((plan) => plan.enabled && plan.remind);

  // Everything the wanted list depends on, as plain text: the effect below
  // runs when THIS changes, not on every re-render of the query results.
  const inputKey = useMemo(
    () =>
      JSON.stringify({
        today,
        tz,
        rows: rows.map((row) => [row.id, row.title, row.note, row.repeat_rule, row.trigger_at, row.tz, row.enabled]),
        given: [...givenPlanIds(plans, todaysDoses, today)].sort(),
        children: [...childNames.entries()].sort(),
      }),
    [today, tz, rows, plans, todaysDoses, childNames],
  );

  const latest = useRef({ rows, todaysDoses, childNames, today, tz });
  latest.current = { rows, todaysDoses, childNames, today, tz };

  useEffect(() => {
    if (!loaded) {
      return;
    }
    const current = latest.current;
    void syncPlanReminders(
      signedIn
        ? wantedReminders({
            rows: current.rows,
            todaysDoses: current.todaysDoses,
            childNames: current.childNames,
            todayLocalDate: current.today,
            nowUtcIso: nowUtcIso(),
            deviceTz: current.tz,
            remindersEnabled: enabled,
          })
        : [],
    );
  }, [inputKey, enabled, loaded, signedIn, permissionStatus, permissionTick, foregroundTick, knownPermission]);

  // Punkt 4: once per device, as soon as a plan here wants a reminder.
  const askingRef = useRef(false);
  useEffect(() => {
    if (!signedIn || !loaded || !enabled || !anyPlanWantsReminder || !pushRegistrationSettled || askingRef.current) {
      return;
    }
    askingRef.current = true;
    void (async () => {
      try {
        const [permission, asked] = await Promise.all([
          getReminderPermissionDetail(),
          AsyncStorage.getItem(PERMISSION_ASKED_KEY).catch(() => null),
        ]);
        useReminderStatusStore.getState().set({ permission });
        if (
          !shouldAskForReminderPermission({
            anyPlanWantsReminder: true,
            remindersEnabled: true,
            permission,
            alreadyAskedOnThisDevice: asked === '1',
          })
        ) {
          return;
        }
        // Remembered BEFORE asking: a crash or a dismissed dialog must not turn this into a question on every start.
        await AsyncStorage.setItem(PERMISSION_ASKED_KEY, '1').catch(() => undefined);
        await askWithReason();
        setPermissionTick((value) => value + 1);
      } catch (error) {
        console.error('[LifeBook] Erinnerungs-Erlaubnis: Nachfrage fehlgeschlagen', error);
      }
    })();
  }, [signedIn, loaded, enabled, anyPlanWantsReminder, pushRegistrationSettled]);

  // Tapping a reminder (also the cold start it caused) opens the Alltag tab
  // on today. The tab reads the `heute` parameter and jumps to today even if
  // another day was selected.
  const response = Notifications.useLastNotificationResponse();
  const rootNavigation = useRootNavigationState();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn || !rootNavigation?.key || !response) {
      return;
    }
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }
    if (response.notification.request.content.data?.type !== REMINDER_DATA_TYPE) {
      return;
    }
    const handledId = `${response.notification.request.identifier}|${response.notification.date}`;
    if (handledRef.current === handledId) {
      return;
    }
    handledRef.current = handledId;
    try {
      router.navigate({ pathname: '/alltag', params: { heute: handledId } });
      // Otherwise every later cold start would replay this old tap.
      Notifications.clearLastNotificationResponse();
    } catch (error) {
      console.error('[LifeBook] Erinnerung konnte den Alltag-Tab nicht öffnen', error);
    }
  }, [response, signedIn, rootNavigation?.key]);

  return null;
}
