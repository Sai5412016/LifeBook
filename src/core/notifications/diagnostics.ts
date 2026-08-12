/**
 * core/notifications/diagnostics — observable state for what actually
 * happened during the last push-registration attempt.
 *
 * Registration itself (./index.ts) must never throw or block the app — but
 * "never blocks" had quietly become "never visible either": every failure
 * was only a console.error, which is why push_tokens stayed empty with no
 * way for anyone to tell why. This store is what the settings screen reads
 * to show the real state instead.
 *
 * 2026-08-13: "Fehlt" alone turned out to still hide the cause — it
 * couldn't tell "never attempted" from "attempted and failed", didn't show
 * the resolved projectId (a common trip-up) or which build type is running
 * (a device console.log can't be read after the fact; whether push even
 * CAN work depends on it), and "Speichern fehlgeschlagen" and "kein
 * Schlüssel bekommen" both just overwrote the same `lastError` string.
 * Expanded to name each of those separately — see ./index.ts for how each
 * field gets populated during a run.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { create } from 'zustand';

import type { PushPermissionStatus } from './logic';

/**
 * 'never'   — registerForPushNotifications hasn't run this session at all
 *             (e.g. the session was already signed in before this app
 *             launch — registration only runs right after sign-in/sign-up).
 * 'running' — a run is currently in progress.
 * 'done'    — the last run ended with a token confirmed stored in push_tokens.
 * 'failed'  — the last run ended WITHOUT a stored token, for any reason —
 *             the other fields below (permissionStatus, projectId,
 *             lastError, tokenFetched, tokenWriteError) say which one.
 */
export type PushRegistrationRunStatus = 'never' | 'running' | 'done' | 'failed';

export type PushDiagnostics = {
  runStatus: PushRegistrationRunStatus;
  /** null = not checked yet this session. */
  permissionStatus: PushPermissionStatus | null;
  /**
   * Whether `Notifications.getExpoPushTokenAsync` actually returned a token
   * this run — distinct from `tokenPresent` below, which additionally
   * requires the database write to have succeeded. The gap between these
   * two is exactly "Token kam, Speichern scheiterte".
   */
  tokenFetched: boolean | null;
  /** null = not checked yet; true/false reflects the last actual attempt or DB read. */
  tokenPresent: boolean | null;
  /** Resolved EAS project id, or null if it couldn't be found — see ./index.ts#resolveProjectId. Always shown, not just when something else fails. */
  projectId: string | null;
  /**
   * Verbatim text of the last real failure — an Error's name, message and
   * `code` (when present), never replaced with our own paraphrase. Covers
   * permission/projectId/token-fetch problems; see `tokenWriteError` for
   * the database-write failure specifically.
   */
  lastError: string | null;
  /**
   * The database write's own error text, kept SEPARATE from `lastError` so
   * "no token ever came back" and "a token came back but saving it failed"
   * stay distinguishable instead of collapsing into one string.
   */
  tokenWriteError: string | null;
  /**
   * Raw `Constants.executionEnvironment` — 'standalone' (a real build),
   * 'storeClient' (Expo Go or an `expo-dev-client` build — SDK 53+ Expo Go
   * cannot receive remote push at all) or 'bare'. Computed once at module
   * load: unlike everything else here, this never changes during a running
   * app, so it doesn't need a registration run to become known.
   */
  executionEnvironment: ExecutionEnvironment | null;
  /** ISO-8601 UTC instant of the last registration attempt, or null if none happened this session. */
  lastCheckedAt: string | null;
};

const initialDiagnostics: PushDiagnostics = {
  runStatus: 'never',
  permissionStatus: null,
  tokenFetched: null,
  tokenPresent: null,
  projectId: null,
  lastError: null,
  tokenWriteError: null,
  executionEnvironment: Constants.executionEnvironment ?? null,
  lastCheckedAt: null,
};

const usePushDiagnosticsStore = create<PushDiagnostics>(() => initialDiagnostics);

/** Reactive hook for the settings screen. */
export const usePushDiagnostics = (): PushDiagnostics => usePushDiagnosticsStore();

/** Merges a partial update into the diagnostics state — called from ./index.ts at each step of registration. */
export function setPushDiagnostics(patch: Partial<PushDiagnostics>): void {
  usePushDiagnosticsStore.setState(patch);
}
