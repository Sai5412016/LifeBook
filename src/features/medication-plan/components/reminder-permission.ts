/**
 * The permission step of saving a plan with a reminder (task 2026-10-09,
 * Teil C) — shared by the plan form screen (app/alltag/mittel.tsx). Device
 * code (Alert + expo-notifications), so not under Vitest; the DECISION lives
 * in ../logic.ts#permissionStepForSave, which is.
 */

import { Alert } from 'react-native';

import { PERMISSION_REASON, permissionStepForSave } from '../logic';
import { getReminderPermission, requestReminderPermission } from '../notifications';

/**
 * Explains the permission in one sentence and asks — only when the system has
 * never been asked. 'ok' = reminders can ring on this phone; 'later' = the
 * person said "Nicht jetzt" to OUR explanation (nothing decided, the system
 * was not asked); 'denied' = the system refused (now or earlier).
 */
export async function ensureReminderPermission(wantsReminder: boolean): Promise<'ok' | 'later' | 'denied'> {
  const step = permissionStepForSave(wantsReminder, await getReminderPermission());
  if (step === 'none') {
    return 'ok';
  }
  if (step === 'denied') {
    return 'denied';
  }
  const proceed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Erinnerung aufs Handy',
      PERMISSION_REASON,
      [
        { text: 'Nicht jetzt', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Weiter', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!proceed) {
    return 'later';
  }
  return (await requestReminderPermission()) === 'granted' ? 'ok' : 'denied';
}
