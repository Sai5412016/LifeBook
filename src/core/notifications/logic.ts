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

/** German label for the settings screen's "Schlüssel vorhanden?" line. */
export function describeTokenPresence(present: boolean | null): string {
  if (present === null) {
    return 'Noch nicht geprüft';
  }
  return present ? 'Vorhanden' : 'Fehlt';
}

/**
 * Turns a Supabase/Postgrest error into readable, DIAGNOSTIC text — includes
 * the Postgres error code when present (e.g. "42501" = a row-level-security
 * rejection, "23505" = a unique-constraint clash), because "letzter Fehler
 * im Klartext" needs to be specific enough to actually debug, not just
 * "etwas ist schiefgegangen".
 */
export function describeSupabaseError(error: { message: string; code?: string | null }): string {
  return error.code ? `${error.message} (Code ${error.code})` : error.message;
}

/**
 * Turns an unknown thrown value into readable text, for a catch block that
 * must never itself throw. For an Error, this is its name and message
 * verbatim, plus a `code` property when the error carries one (some native
 * push/Firebase errors do) — never replaced with our own paraphrase, so a
 * diagnostics screen shows exactly what was thrown, not a guess at it.
 */
export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && error.code != null ? String((error as { code: unknown }).code) : null;
    return code ? `${error.name}: ${error.message} (code: ${code})` : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** German label for the settings screen's "Registrierung" run-status line. */
export function describeRegistrationRunStatus(status: 'never' | 'running' | 'done' | 'failed'): string {
  switch (status) {
    case 'never':
      return 'Nie versucht';
    case 'running':
      return 'Läuft …';
    case 'done':
      return 'Abgeschlossen';
    case 'failed':
      return 'Fehlgeschlagen';
  }
}

/**
 * German label for `Constants.executionEnvironment` — Expo Go (SDK 53+)
 * cannot receive remote push at all, which is exactly the kind of "the
 * whole feature can't work here" fact a push diagnostics screen must not
 * stay silent about.
 */
export function describeExecutionEnvironment(env: string | null): string {
  switch (env) {
    case 'standalone':
      return 'Eigenständiger Build';
    case 'storeClient':
      return 'Expo Go oder Dev-Client (kein Push-Empfang möglich)';
    case 'bare':
      return 'Bare (natives Projekt ohne Expo Go)';
    default:
      return 'Unbekannt';
  }
}

/** Which of the three lookups actually supplied the EAS project id — shown on the settings screen. */
export type ProjectIdSource = 'expoConfig' | 'easConfig' | 'fallback';

/**
 * Picks the EAS project id `getExpoPushTokenAsync` needs, in Expo's
 * documented order: `Constants.expoConfig?.extra?.eas?.projectId`, then
 * `Constants.easConfig?.projectId` (2026-08-13: a Bare build was observed
 * with the FIRST empty but the second populated — build type changes which
 * one Expo actually fills in). `fallbackProjectId` is the last resort so a
 * device is never left with no projectId at all; the caller supplies it
 * from a fixed value that must match app.json (see ./index.ts).
 *
 * Pure and dependency-free on purpose: this is the actual decision, kept
 * separate from reading `Constants` itself so it can run — and be tested —
 * without Expo.
 */
export function selectProjectId(
  expoConfigProjectId: string | null | undefined,
  easConfigProjectId: string | null | undefined,
  fallbackProjectId: string,
): { projectId: string; source: ProjectIdSource } {
  if (expoConfigProjectId) {
    return { projectId: expoConfigProjectId, source: 'expoConfig' };
  }
  if (easConfigProjectId) {
    return { projectId: easConfigProjectId, source: 'easConfig' };
  }
  return { projectId: fallbackProjectId, source: 'fallback' };
}

/** German label for the settings screen's "Projekt-ID stammt aus" line. */
export function describeProjectIdSource(source: ProjectIdSource): string {
  switch (source) {
    case 'expoConfig':
      return 'aus expoConfig';
    case 'easConfig':
      return 'aus easConfig';
    case 'fallback':
      return 'fester Rückfallwert';
  }
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
