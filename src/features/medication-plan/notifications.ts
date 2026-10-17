/**
 * medication-plan/notifications — the device side of the plan reminders:
 * makes the phone's scheduled LOCAL notifications match what
 * ./schedule.ts#planReminders says should exist. Device code (imports
 * expo-notifications), so it has no unit tests; every decision it carries out
 * is pure and tested in ./schedule.test.ts.
 *
 * Local notifications are scheduled with the OS alarm service, so they fire
 * with the app closed and without any network. They need no new native
 * module: `expo-notifications` is already in the installed build (it is what
 * registers the household push token, core/notifications/index.ts) and
 * scheduling is part of that same module. `app.json` is unchanged, hence the
 * fingerprint is unchanged.
 *
 * Android only schedules to the exact minute when the user has allowed
 * "exact alarms"; this app does not declare that permission (adding it would
 * change the native build). Without it Android delivers inexact — in
 * practice within a few minutes, later while the phone dozes. See the
 * report; it is why the text asks "schon gegeben?" instead of stating a fact.
 *
 * NEVER throws: a reminder problem must never disturb logging a dose.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { utcIsoToEpochMillis } from '@/core/time';
import { getPushPermissionStatus } from '@/core/notifications';
import type { PushPermissionStatus } from '@/core/notifications';

import { reconcileReminders, reminderSignature } from './reconcile';
import type { ScheduledSnapshot } from './reconcile';
import { useReminderStatusStore } from './reminder-status';
import type { ReminderPermission } from './reminder-status';
import { isPlanNotificationId } from './schedule';
import type { PlannedReminder } from './schedule';

/** Own channel (not the shared "Allgemein"), so the plan reminders can be muted in the system settings without touching the "new photos" push. */
export const REMINDER_CHANNEL_ID = 'medikamentenplan';

/** `data.type` of every notification this feature schedules — the tap handler keys on it. */
export const REMINDER_DATA_TYPE = 'medication_plan';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Medikamentenplan',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export function getReminderPermission(): Promise<PushPermissionStatus> {
  return getPushPermissionStatus();
}

/**
 * Asks the system for the notification permission. Call it only right after
 * the person has been told why (the plan form does that) — never at app
 * start. Returns the resulting status; 'undetermined' if the request itself
 * failed.
 */
export async function requestReminderPermission(): Promise<PushPermissionStatus> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status;
  } catch (error) {
    console.error('[LifeBook] Benachrichtigungs-Erlaubnis konnte nicht erfragt werden', error);
    return 'undetermined';
  }
}

/** Permission plus whether Android would still show its dialog. Never throws. */
export async function getReminderPermissionDetail(): Promise<ReminderPermission> {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    return { status, canAskAgain };
  } catch (error) {
    console.error('[LifeBook] Benachrichtigungs-Erlaubnis konnte nicht gelesen werden', error);
    return { status: 'undetermined', canAskAgain: false };
  }
}

/** Our scheduled notifications with the signature they were scheduled with (see ./reconcile.ts). */
async function readScheduled(): Promise<ScheduledSnapshot[]> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  return existing
    .filter((request) => isPlanNotificationId(request.identifier))
    .map((request) => {
      const signature = request.content.data?.signature;
      return { identifier: request.identifier, signature: typeof signature === 'string' ? signature : null };
    });
}

async function applyPlanned(planned: readonly PlannedReminder[]): Promise<void> {
  const setStatus = useReminderStatusStore.getState().set;
  try {
    const permission = await getReminderPermissionDetail();
    setStatus({ permission });

    // Without the permission nothing can ring; scheduled leftovers are removed
    // so the count shown on the plan screen tells the truth.
    const wanted = permission.status === 'granted' ? planned : [];
    if (wanted.length > 0) {
      await ensureChannel();
    }

    const { cancel, schedule } = reconcileReminders(await readScheduled(), wanted);
    for (const identifier of cancel) {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    }
    for (const reminder of schedule) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: reminder.identifier,
          content: {
            title: reminder.title,
            body: reminder.body,
            sound: true,
            data: {
              type: REMINDER_DATA_TYPE,
              localDate: reminder.localDate,
              planId: reminder.planId,
              signature: reminderSignature(reminder),
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: utcIsoToEpochMillis(reminder.fireAtUtcIso),
            channelId: REMINDER_CHANNEL_ID,
          },
        });
      } catch (error) {
        // One reminder failing must not drop the ones after it.
        console.error('[LifeBook] Erinnerung konnte nicht geplant werden', reminder.identifier, error);
      }
    }

    // Read back what the phone really holds now, not what we meant to do.
    const after = await readScheduled();
    const wantedById = new Map(wanted.map((reminder) => [reminder.identifier, reminder]));
    const fireTimes = after
      .map((entry) => wantedById.get(entry.identifier)?.fireAtUtcIso)
      .filter((value): value is string => typeof value === 'string')
      .sort();
    setStatus({ scheduledCount: after.length, nextFireAtUtcIso: fireTimes[0] ?? null, lastError: null });
  } catch (error) {
    console.error('[LifeBook] Erinnerungen konnten nicht abgeglichen werden', error);
    setStatus({ lastError: error instanceof Error ? error.message : String(error) });
  }
}

// Runs one reconcile at a time; if several are requested while one is
// running, only the newest still runs (the older ones are already stale).
let chain: Promise<void> = Promise.resolve();
let latestRequest = 0;

/**
 * Makes the scheduled plan reminders on this phone exactly `planned`: only
 * the difference is cancelled/scheduled (./reconcile.ts), so calling it again
 * with the same list changes nothing. Nothing outside this feature is
 * touched. An empty list removes all of ours.
 */
export function syncPlanReminders(planned: readonly PlannedReminder[]): Promise<void> {
  latestRequest += 1;
  const mine = latestRequest;
  chain = chain.then(async () => {
    if (mine !== latestRequest) {
      return;
    }
    await applyPlanned(planned);
  });
  return chain;
}
