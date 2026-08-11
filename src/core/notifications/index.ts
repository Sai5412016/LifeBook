/**
 * core/notifications — push notification registration and the household
 * "something happened" ping. Device- and network-touching; the decisions
 * behind it (German labels, when to notify, the request shape) are pure
 * logic in ./logic, tested there.
 *
 * NEVER BLOCKS THE APP
 * ---------------------
 * A parent who declines the permission prompt, or a device with no Google
 * Play services, must get a fully working app regardless — LifeBook's core
 * job (offline photo/event tracking) has nothing to do with push. Every
 * exported function here therefore swallows its own errors: it logs and
 * returns rather than throwing, so a caller never needs a try/catch of its
 * own to stay safe.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { nowUtcIso } from '@/core/time';

import { supabase } from '../supabase';
import { ENV } from '../env';
import {
  buildNotifyHouseholdRequest,
  type NotifyHouseholdKind,
  type PushPermissionStatus,
} from './logic';

/**
 * IMPORTANCE_HIGH (not the default MEDIUM) — Android only shows a
 * notification as a heads-up "Einblendung" (banner + sound) at HIGH or
 * above; anything lower lands silently in the shade, which for a "new
 * photos" ping defeats the purpose of pushing at all.
 */
const ANDROID_CHANNEL_ID = 'default';

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Allgemein',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

function resolveProjectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId ?? null;
}

/** Current permission status, for the settings screen. Never throws — 'undetermined' on any failure. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch (error) {
    console.error('[LifeBook] Push-Berechtigungsstatus konnte nicht gelesen werden', error);
    return 'undetermined';
  }
}

/** Inserts a push token row, or refreshes `updated_at` if this exact token is already on file for this user. */
async function upsertPushToken(userId: string, token: string, platform: string): Promise<void> {
  const now = nowUtcIso();

  const { data: existing, error: selectError } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('token', token)
    .maybeSingle();

  if (selectError) {
    console.error('[LifeBook] Push-Token konnte nicht geprüft werden', selectError.message);
    return;
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('push_tokens')
      .update({ updated_at: now })
      .eq('id', existing.id);
    if (updateError) {
      console.error('[LifeBook] Push-Token konnte nicht aktualisiert werden', updateError.message);
    }
    return;
  }

  const { error: insertError } = await supabase.from('push_tokens').insert({
    user_id: userId,
    token,
    platform,
    created_at: now,
    updated_at: now,
  });
  if (insertError) {
    console.error('[LifeBook] Push-Token konnte nicht gespeichert werden', insertError.message);
  }
}

/**
 * Requests the notification permission (if not already decided) and, once
 * granted, registers this device's Expo push token for `userId`.
 *
 * Called after a successful sign-in/sign-up — NOT at cold start, so a parent
 * is never asked for a permission before they've even reached the app; and
 * again from the settings screen's "Berechtigung erneut anfragen" action.
 *
 * Silent on every failure path (simulator, permission denied, no network,
 * misconfigured project id, …): logged, never thrown — see the module doc
 * comment above.
 */
export async function registerForPushNotifications(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) {
      // Simulators/emulators have no push capability — not an error, just nothing to do.
      return;
    }

    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    const finalStatus =
      existingStatus === 'granted'
        ? existingStatus
        : (await Notifications.requestPermissionsAsync()).status;

    if (finalStatus !== 'granted') {
      console.log('[LifeBook] Push-Berechtigung nicht erteilt', finalStatus);
      return;
    }

    const projectId = resolveProjectId();
    if (!projectId) {
      console.error('[LifeBook] Push-Registrierung: keine EAS projectId gefunden');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await upsertPushToken(userId, token, Platform.OS);
  } catch (error) {
    console.error('[LifeBook] Push-Registrierung fehlgeschlagen', error);
  }
}

/**
 * Removes this device's push token on sign-out. Must be called BEFORE
 * `supabase.auth.signOut()` — the delete is RLS-gated on the still-valid
 * session, and `userId` is passed in rather than read fresh because the
 * caller already has it from the session that's about to end.
 */
export async function unregisterPushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) {
      return;
    }

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      // Never registered (permission was never granted), nothing to remove.
      return;
    }

    const projectId = resolveProjectId();
    if (!projectId) {
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
    if (error) {
      console.error('[LifeBook] Push-Token konnte nicht entfernt werden', error.message);
    }
  } catch (error) {
    console.error('[LifeBook] Push-Token-Entfernung fehlgeschlagen', error);
  }
}

/**
 * Pings the household via the `notify-household` server function (already
 * deployed — see server docs). Best-effort: the caller (e.g. a photo import)
 * must succeed regardless of whether anyone actually gets notified.
 */
export async function notifyHousehold(
  householdId: string,
  kind: NotifyHouseholdKind,
  count: number,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return;
    }

    const response = await fetch(`${ENV.SUPABASE_URL}/functions/v1/notify-household`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildNotifyHouseholdRequest(householdId, kind, count)),
    });

    if (!response.ok) {
      console.error(
        '[LifeBook] Push-Benachrichtigung fehlgeschlagen',
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error('[LifeBook] Push-Benachrichtigung fehlgeschlagen', error);
  }
}

export {
  canRequestPushPermission,
  describePushPermissionStatus,
  shouldNotifyAfterImport,
  type PushPermissionStatus,
} from './logic';
