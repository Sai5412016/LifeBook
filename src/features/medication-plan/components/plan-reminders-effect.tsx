/**
 * medication-plan/components/plan-reminders-effect — keeps this phone's
 * scheduled plan reminders in step with the plan, and opens the Alltag tab
 * when one is tapped. Mounted ONCE in the root layout next to
 * PushRegistrationEffect (CLAUDE.md Architekturregel 8: whatever must hold
 * for every signed-in user hangs on the auth state, not on a screen — a
 * reminder that only got scheduled while the plan screen was open would
 * never ring for the parent who just keeps using the app).
 *
 * Recomputed (never an open-ended series, ./schedule.ts#SCHEDULE_HORIZON_DAYS):
 *  - at app start (this effect mounts),
 *  - whenever a plan changes (the live query re-emits),
 *  - when today's doses change — so the reminder for today is cancelled as
 *    soon as the medicine is entered, on this phone or, once synced, on the
 *    other one — and when the day rolls over,
 *  - when the per-device switch flips, or the notification permission is
 *    decided (the push registration at app start asks for it).
 *
 * This effect NEVER asks for the permission itself: the question comes with
 * its reason when a reminder is first created (plan form).
 */

import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/core/auth/session-store';
import { usePushDiagnostics } from '@/core/notifications';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { useGabenDesTages } from '@/features/medication/repository';

import { REMINDER_DATA_TYPE, syncPlanReminders } from '../notifications';
import { useMedicationPlans } from '../repository';
import { givenPlanIds, planReminders } from '../schedule';
import { useMedicationRemindersSetting } from '../reminders-setting';

const DAY_ROLLOVER_CHECK_MS = 60_000;

/** "Today" in the device zone, re-read every minute so the plan rolls over at midnight while the app stays open. */
function useTodayLocalDate(tz: string): string {
  const [today, setToday] = useState(() => toLocalDate(nowUtcIso(), tz));
  useEffect(() => {
    const id = setInterval(() => setToday(toLocalDate(nowUtcIso(), tz)), DAY_ROLLOVER_CHECK_MS);
    return () => clearInterval(id);
  }, [tz]);
  return today;
}

export function MedicationPlanRemindersEffect() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const { child } = useActiveChild();
  const tz = deviceTimeZone();
  const today = useTodayLocalDate(tz);
  const { plans } = useMedicationPlans(child?.childId, tz);
  const { gaben } = useGabenDesTages(child?.childId, today);
  const { enabled, loaded } = useMedicationRemindersSetting();
  // Re-run once the permission has been decided (the registration at app
  // start asks), without this effect ever asking itself.
  const { permissionStatus } = usePushDiagnostics();

  // Everything the schedule depends on, as plain text: the effect below runs
  // when THIS changes, not on every re-render of the query results.
  const inputKey = useMemo(
    () =>
      JSON.stringify({
        child: child?.firstName ?? '',
        today,
        plans: plans.map((plan) => [
          plan.id,
          plan.name,
          plan.doseAmount,
          plan.doseUnit,
          plan.intervalDays,
          plan.startLocalDate,
          plan.remindTime,
          plan.remind,
          plan.enabled,
        ]),
        given: [...givenPlanIds(plans, gaben, today)].sort(),
      }),
    [child?.firstName, today, plans, gaben],
  );

  const latest = useRef({ plans, gaben, firstName: child?.firstName ?? '', today, tz });
  latest.current = { plans, gaben, firstName: child?.firstName ?? '', today, tz };

  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (!signedIn || !enabled) {
      void syncPlanReminders([]);
      return;
    }
    const { plans: currentPlans, gaben: currentGaben, firstName, today: currentToday, tz: currentTz } = latest.current;
    void syncPlanReminders(
      planReminders({
        plans: currentPlans,
        childFirstName: firstName,
        todayLocalDate: currentToday,
        nowUtcIso: nowUtcIso(),
        deviceTz: currentTz,
        givenTodayPlanIds: givenPlanIds(currentPlans, currentGaben, currentToday),
      }),
    );
  }, [inputKey, enabled, loaded, signedIn, permissionStatus]);

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
