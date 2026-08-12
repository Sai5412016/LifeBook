/**
 * core/notifications — push notification registration and the household
 * "something happened" ping. Device- and network-touching; the decisions
 * behind it (German labels, when to notify, the request shape, error
 * formatting) are pure logic in ./logic, tested there.
 *
 * NEVER BLOCKS THE APP, BUT NEVER SILENT EITHER
 * -----------------------------------------------
 * A parent who declines the permission prompt, or a device with no Google
 * Play services, must get a fully working app regardless — LifeBook's core
 * job (offline photo/event tracking) has nothing to do with push. Every
 * exported function here therefore swallows its own errors: it never
 * throws, so a caller never needs a try/catch of its own to stay safe.
 *
 * "Swallow" used to mean "console.error and nothing else" — which is
 * exactly how push_tokens ended up empty on two signed-in devices with no
 * way to tell why (see 2026-08-12 investigation). Every failure path now
 * ALSO records itself in ./diagnostics, which the settings screen reads —
 * still never blocks the start, but no longer invisible either.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { nowUtcIso } from '@/core/time';

import { setPushDiagnostics } from './diagnostics';
import { supabase } from '../supabase';
import { ENV } from '../env';
import {
  buildNotifyHouseholdRequest,
  describeSupabaseError,
  describeUnknownError,
  selectProjectId,
  type NotifyHouseholdKind,
  type ProjectIdSource,
  type PushPermissionStatus,
} from './logic';

/**
 * Last resort when NEITHER `Constants.expoConfig?.extra?.eas?.projectId` NOR
 * `Constants.easConfig?.projectId` resolve to anything (observed 2026-08-13
 * on a Bare build: the first was empty at runtime even though app.json has
 * it — see resolveProjectId below). MUST match app.json's
 * `extra.eas.projectId` — if that value ever changes, this one has to
 * change with it, or push registration silently breaks again for whichever
 * build type doesn't expose it via `Constants` at runtime.
 */
const FALLBACK_EAS_PROJECT_ID = 'fb2b4376-fcf6-41ab-98e2-99b14c9438b5';

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

/**
 * `getExpoPushTokenAsync`'s required projectId, resolved in Expo's
 * documented order. 2026-08-13: `Constants.expoConfig?.extra?.eas?.projectId`
 * alone was found empty on a Bare build even though app.json has it —
 * `Constants.easConfig?.projectId` is where EAS actually injects it for
 * that build type. Falls back to a fixed value as a last resort so a device
 * is never left with no projectId at all. The actual decision (which source
 * wins) is pure logic in ./logic.ts#selectProjectId — this is only the
 * `Constants` read.
 */
function resolveProjectId(): { projectId: string; source: ProjectIdSource } {
  return selectProjectId(
    Constants.expoConfig?.extra?.eas?.projectId,
    Constants.easConfig?.projectId,
    FALLBACK_EAS_PROJECT_ID,
  );
}

/** Current permission status, for the settings screen. Never throws — 'undetermined' on any failure. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch (error) {
    const message = describeUnknownError(error);
    console.error('[LifeBook] Push-Berechtigungsstatus konnte nicht gelesen werden', error);
    // Not a registration run (runStatus untouched) — just a read failure,
    // but still a caught error, so it still has to reach the diagnostics
    // screen rather than living only in the device log.
    setPushDiagnostics({ lastError: message });
    return 'undetermined';
  }
}

/**
 * Whether `userId` has at least one push_tokens row on file, read straight
 * from the database rather than inferred from this session's own attempts —
 * a token registered in an earlier app session is still "vorhanden" even if
 * nothing ran this session. Never throws; a read failure is reported back
 * as a diagnostic string instead, same shape everywhere in this module.
 */
export async function hasPushTokenRegistered(
  userId: string,
): Promise<{ present: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.from('push_tokens').select('id').eq('user_id', userId).limit(1);
    if (error) {
      return { present: false, error: describeSupabaseError(error) };
    }
    return { present: (data?.length ?? 0) > 0, error: null };
  } catch (error) {
    return { present: false, error: describeUnknownError(error) };
  }
}

/**
 * Inserts a push token row, or refreshes `updated_at` if this exact token is
 * already on file for this user. Returns a diagnostic string on failure —
 * the caller (registerForPushNotifications) is what actually surfaces it,
 * this function stays a plain data operation.
 *
 * SELECT-then-INSERT/UPDATE, not `.upsert()`: this project has already hit
 * an RLS/`ON CONFLICT` interaction bug once (see CLAUDE.md Fallstrick 1) —
 * `push_tokens`'s "only your own rows" rule doesn't have that exact
 * bootstrap problem, but the explicit form is what makes a genuine RLS
 * rejection show up as a plain, attributable INSERT/UPDATE error either way.
 */
async function upsertPushToken(userId: string, token: string, platform: string): Promise<string | null> {
  const now = nowUtcIso();

  const { data: existing, error: selectError } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('token', token)
    .maybeSingle();

  if (selectError) {
    return describeSupabaseError(selectError);
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('push_tokens')
      .update({ updated_at: now })
      .eq('id', existing.id);
    return updateError ? describeSupabaseError(updateError) : null;
  }

  const { error: insertError } = await supabase.from('push_tokens').insert({
    user_id: userId,
    token,
    platform,
    created_at: now,
    updated_at: now,
  });
  return insertError ? describeSupabaseError(insertError) : null;
}

/**
 * Requests the notification permission (if not already decided) and, once
 * granted, registers this device's Expo push token for `userId`. Records
 * every step in ./diagnostics — see the module doc comment.
 *
 * Called from src/app/_layout.tsx#PushRegistrationEffect on every app start
 * once a signed-in user is confirmed (cold start with a persisted session,
 * or a fresh sign-in/sign-up) — MUST be repeatable, not once-ever: the OS
 * can rotate a push token at any time, and an app that only ever registers
 * once quietly stops receiving notifications whenever that happens. Also
 * callable directly from the settings screen's "Registrierung erneut
 * versuchen" action for a fresh diagnosis without restarting the app.
 *
 * 2026-08-13: this used to run ONLY right after an interactive sign-in
 * (called directly from sign-in.tsx/sign-up.tsx) — deliberately not at cold
 * start, so a parent already using the app wouldn't suddenly see a
 * permission prompt. That meant a returning already-signed-in user (the
 * normal case after the first day) never ran this again, ever — the
 * settings screen showed "Registrierung: Nie versucht" indefinitely.
 * Moved to react to the session itself instead of one specific user action.
 */
export async function registerForPushNotifications(userId: string): Promise<void> {
  const lastCheckedAt = nowUtcIso();
  // Reset the previous run's outcome so a retry doesn't show stale
  // success/failure detail while this one is still in progress.
  setPushDiagnostics({
    runStatus: 'running',
    lastCheckedAt,
    tokenFetched: null,
    tokenWriteError: null,
    lastError: null,
  });

  try {
    if (!Device.isDevice) {
      // Simulators/emulators have no push capability — not an error, just nothing to do.
      setPushDiagnostics({
        runStatus: 'failed',
        lastError: 'Simulator/Emulator ohne Push-Fähigkeit',
        tokenPresent: false,
      });
      return;
    }

    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    const finalStatus =
      existingStatus === 'granted'
        ? existingStatus
        : (await Notifications.requestPermissionsAsync()).status;
    setPushDiagnostics({ permissionStatus: finalStatus });

    if (finalStatus !== 'granted') {
      setPushDiagnostics({ runStatus: 'failed', lastError: 'Berechtigung nicht erteilt', tokenPresent: false });
      return;
    }

    // Always recorded, success or failure — which SOURCE actually supplied
    // it is a common trip-up and was previously invisible entirely (see
    // resolveProjectId — a Bare build was found resolving it from
    // easConfig, not expoConfig, with no way to see that on the device).
    const { projectId, source } = resolveProjectId();
    setPushDiagnostics({ projectId, projectIdSource: source });

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (error) {
      // The single most common real-world cause here: Expo Go (SDK 53+) no
      // longer supports remote push at all — this throws with a message
      // naming Expo Go explicitly, which is exactly why it's shown verbatim
      // rather than replaced with a generic "failed" text. `tokenFetched:
      // false` is what lets the settings screen say "no token ever came
      // back" instead of leaving that to be inferred from the error text.
      const message = describeUnknownError(error);
      console.error('[LifeBook] Push-Schlüssel konnte nicht geholt werden', error);
      setPushDiagnostics({ runStatus: 'failed', tokenFetched: false, tokenPresent: false, lastError: message });
      return;
    }

    setPushDiagnostics({ tokenFetched: true });

    const writeError = await upsertPushToken(userId, token, Platform.OS);
    if (writeError) {
      console.error('[LifeBook] Push-Token konnte nicht gespeichert werden', writeError);
      // tokenWriteError is the SAME text as lastError here, kept separately
      // on purpose: it is what lets the settings screen say "the token DID
      // come back, only saving it failed" — a token that was fetched but
      // never stored is a completely different bug from one that never
      // arrived at all, and collapsing both into one `lastError` string is
      // exactly what made this diagnosis blind before.
      setPushDiagnostics({
        runStatus: 'failed',
        tokenPresent: false,
        tokenWriteError: writeError,
        lastError: writeError,
      });
      return;
    }

    setPushDiagnostics({ runStatus: 'done', tokenPresent: true, tokenWriteError: null, lastError: null });
  } catch (error) {
    const message = describeUnknownError(error);
    console.error('[LifeBook] Push-Registrierung fehlgeschlagen', error);
    setPushDiagnostics({ runStatus: 'failed', lastError: message });
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

    const { projectId } = resolveProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
    if (error) {
      const message = describeSupabaseError(error);
      console.error('[LifeBook] Push-Token konnte nicht entfernt werden', message);
      // Not a registration run (runStatus untouched) — but still a caught
      // error, so it still has to reach the diagnostics screen rather than
      // living only in the device log (2026-08-13: this is where the last
      // silently-console.error-only catch block in this file lived).
      setPushDiagnostics({ lastError: message });
    }
  } catch (error) {
    const message = describeUnknownError(error);
    console.error('[LifeBook] Push-Token-Entfernung fehlgeschlagen', error);
    setPushDiagnostics({ lastError: message });
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

export { usePushDiagnostics, type PushDiagnostics, type PushRegistrationRunStatus } from './diagnostics';
export {
  canRequestPushPermission,
  describeExecutionEnvironment,
  describeProjectIdSource,
  describePushPermissionStatus,
  describeRegistrationRunStatus,
  describeTokenPresence,
  shouldNotifyAfterImport,
  type ProjectIdSource,
  type PushPermissionStatus,
} from './logic';
