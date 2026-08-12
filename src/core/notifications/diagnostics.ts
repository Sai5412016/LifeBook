/**
 * core/notifications/diagnostics — observable state for what actually
 * happened during the last push-registration attempt.
 *
 * Registration itself (./index.ts) must never throw or block the app — but
 * "never blocks" had quietly become "never visible either": every failure
 * was only a console.error, which is why push_tokens stayed empty with no
 * way for anyone to tell why. This store is what the settings screen reads
 * to show the real state instead.
 */

import { create } from 'zustand';

import type { PushPermissionStatus } from './logic';

export type PushDiagnostics = {
  /** null = not checked yet this session. */
  permissionStatus: PushPermissionStatus | null;
  /** null = not checked yet; true/false reflects the last actual attempt or DB read. */
  tokenPresent: boolean | null;
  /** Resolved EAS project id, or null if it couldn't be found — see ./index.ts#resolveProjectId. */
  projectId: string | null;
  /** Human-readable text of the last failure, or null once something has since succeeded. */
  lastError: string | null;
  /** ISO-8601 UTC instant of the last registration attempt, or null if none happened this session. */
  lastCheckedAt: string | null;
};

const initialDiagnostics: PushDiagnostics = {
  permissionStatus: null,
  tokenPresent: null,
  projectId: null,
  lastError: null,
  lastCheckedAt: null,
};

const usePushDiagnosticsStore = create<PushDiagnostics>(() => initialDiagnostics);

/** Reactive hook for the settings screen. */
export const usePushDiagnostics = (): PushDiagnostics => usePushDiagnosticsStore();

/** Merges a partial update into the diagnostics state — called from ./index.ts at each step of registration. */
export function setPushDiagnostics(patch: Partial<PushDiagnostics>): void {
  usePushDiagnosticsStore.setState(patch);
}
