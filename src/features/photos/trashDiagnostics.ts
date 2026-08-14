/**
 * photos/trashDiagnostics — observable state for the last automatic
 * 30-day trash sweep (./storage.ts#runStartupTrashCleanup, fired once per
 * signed-in app start from src/app/_layout.tsx#TrashCleanupEffect).
 *
 * Same reasoning as core/notifications/diagnostics.ts: a background run
 * that only `console.error`s on failure is invisible to anyone who isn't
 * reading device logs off a USB cable. This store is what the Einstellungen
 * screen reads instead, so "a photo won't clean up" is something a parent
 * can actually see rather than something that just silently never happens.
 */

import { create } from 'zustand';

/**
 * 'never'   — the sweep hasn't run this app session at all.
 * 'running' — a run is currently in progress.
 * 'done'    — the last run completed; `removed`/`failed` describe it. A
 *             per-photo failure does NOT make the overall run 'failed' —
 *             the sweep keeps going past one bad photo (task requirement),
 *             so 'done' with `failed > 0` is the normal way to see that.
 * 'failed'  — the run could not even start or complete (e.g. the initial
 *             database query itself threw) — distinct from a per-photo
 *             failure, which is counted in `failed` under 'done' instead.
 */
export type TrashCleanupRunStatus = 'never' | 'running' | 'done' | 'failed';

export type TrashCleanupDiagnostics = {
  runStatus: TrashCleanupRunStatus;
  /** Photos permanently removed in the last completed run. */
  removed: number;
  /** Photos that failed to be removed in the last completed run — they stay in the trash and are retried on the next app start. */
  failed: number;
  /** Set only for a whole-run failure (runStatus 'failed'); null otherwise. */
  lastError: string | null;
  /** ISO-8601 UTC instant the last run (successful or not) finished. */
  lastRunAtUtcIso: string | null;
};

const initialDiagnostics: TrashCleanupDiagnostics = {
  runStatus: 'never',
  removed: 0,
  failed: 0,
  lastError: null,
  lastRunAtUtcIso: null,
};

const useTrashDiagnosticsStore = create<TrashCleanupDiagnostics>(() => initialDiagnostics);

/** Reactive hook for the settings screen. */
export const useTrashCleanupDiagnostics = (): TrashCleanupDiagnostics => useTrashDiagnosticsStore();

/** Merges a partial update into the diagnostics state — called from ./storage.ts#runStartupTrashCleanup. */
export function setTrashCleanupDiagnostics(patch: Partial<TrashCleanupDiagnostics>): void {
  useTrashDiagnosticsStore.setState(patch);
}
