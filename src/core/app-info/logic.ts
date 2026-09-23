/**
 * core/app-info/logic — pure formatting for the update-status line at the
 * bottom of Einstellungen ("Version 1.0.0 · Update a1b2c3d · 23.09.2026
 * 14:12", task 2026-09-24): lets the user see for themselves whether a
 * Funkupdate has actually arrived, instead of hunting for a new feature in
 * the app. Device-facing reads (expo-updates, expo-constants) live in
 * ./device.ts — this module only formats what it's given
 * (Architekturregel 3).
 */

import { formatShortGermanDate } from '@/features/events/logic';
import { formatTimeLabel, toLocalDate } from '@/core/time';

export type UpdateStatusInfo = {
  version: string;
  /** `expo-updates`' own `Updates.updateId` — a UUID, or `null` (dev mode, or expo-updates disabled). */
  updateId: string | null;
  /** `expo-updates`' `Updates.createdAt`, already converted to ISO-UTC, or `null` (same cases as `updateId`). */
  createdAtUtcIso: string | null;
  isDevelopmentBuild: boolean;
};

/**
 * "Version 1.0.0 · Update a1b2c3d · 23.09.2026 14:12" — `updateId` cut to 7
 * characters (enough to eyeball-match against an `eas update` log line,
 * task requirement). `updateId`/`createdAtUtcIso` are populated for the
 * EMBEDDED build too, not only a downloaded Funkupdate (see
 * ./device.ts's doc comment) — so a fresh install with no Funkupdate yet
 * still shows its own build identity here, which is exactly what lets the
 * user notice when it changes.
 */
export function formatUpdateStatusLabel(info: UpdateStatusInfo, tz: string): string {
  if (info.isDevelopmentBuild) {
    return 'Entwicklungsversion';
  }

  const parts = [`Version ${info.version}`];
  if (info.updateId) {
    parts.push(`Update ${info.updateId.slice(0, 7)}`);
  }
  if (info.createdAtUtcIso) {
    const dateLabel = formatShortGermanDate(toLocalDate(info.createdAtUtcIso, tz));
    const timeLabel = formatTimeLabel(info.createdAtUtcIso, tz);
    parts.push(`${dateLabel} ${timeLabel}`);
  }
  return parts.join(' · ');
}
