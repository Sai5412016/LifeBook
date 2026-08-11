/**
 * core/notifications/logic — pure decisions around push notifications: how to
 * describe a permission status in German, whether it's worth asking again,
 * whether an import is worth notifying the household about, and the shape of
 * the request sent to the `notify-household` server function. Deliberately
 * free of any Expo / React Native import so it runs in plain Node under
 * Vitest; the device- and network-touching side lives in ./index.
 */

/**
 * Mirrors `expo-modules-core`'s `PermissionStatus` string enum values
 * ('granted' | 'undetermined' | 'denied') without importing it, so this
 * module stays dependency-free. `Notifications.getPermissionsAsync()`'s
 * result is a string enum, so its value is assignable here as-is.
 */
export type PushPermissionStatus = 'granted' | 'undetermined' | 'denied';

/** German label for the settings screen — "sind Benachrichtigungen aktiv?". */
export function describePushPermissionStatus(status: PushPermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Aktiv';
    case 'denied':
      return 'Abgelehnt — kann in den Systemeinstellungen des Geräts wieder erlaubt werden';
    case 'undetermined':
      return 'Nicht aktiviert';
  }
}

/** Whether the settings screen should offer an "erneut anfragen" action. */
export function canRequestPushPermission(status: PushPermissionStatus): boolean {
  return status !== 'granted';
}

/**
 * Whether a photo import is worth notifying the household about — only when
 * it actually added something. Re-imports of already-known photos (every one
 * a duplicate) or a cancelled/failed picker run must stay silent.
 */
export function shouldNotifyAfterImport(importedCount: number): boolean {
  return importedCount > 0;
}

export type NotifyHouseholdKind = 'photos';

export type NotifyHouseholdRequest = {
  householdId: string;
  kind: NotifyHouseholdKind;
  count: number;
};

/** Body for a POST to `${SUPABASE_URL}/functions/v1/notify-household`. */
export function buildNotifyHouseholdRequest(
  householdId: string,
  kind: NotifyHouseholdKind,
  count: number,
): NotifyHouseholdRequest {
  return { householdId, kind, count };
}
