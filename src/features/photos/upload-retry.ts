/**
 * photos/upload-retry — the pure decisions behind retrying photo uploads
 * (task 2026-11-09). No Expo / React Native import, so it runs under Vitest;
 * ./storage.ts carries the decisions out and ./upload-retry-store.ts keeps the
 * per-device state.
 *
 * WHY THIS EXISTS
 * ----------------
 * Until 2026-11-09 the upload queue only ran right after an import
 * (import.ts) or when someone tapped the Chronik button. A single failed step
 * (photo 01a18883…, 29.10.2026: the medium step threw 0.9 s after its thumb
 * went up, and by design that also skips the original) therefore stayed
 * pending until the NEXT import, which never came. The Chronik even said
 * "wartet auf WLAN" while the phone was on WLAN.
 *
 * Now every pending photo has a small retry record per device: a failure
 * schedules the next attempt with growing pauses, and after MAX_AUTO_ATTEMPTS
 * the queue stops trying on its own (no endless loop on a permanent error)
 * until the person taps "Jetzt erneut versuchen". A source file that is gone
 * is reported, never retried silently.
 */

import { addSecondsToUtcIso, secondsBetween } from '@/core/time';

/** Pauses after the 1st, 2nd, … failure. The last value repeats. */
export const RETRY_DELAYS_SECONDS: readonly number[] = [60, 5 * 60, 15 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60];

/** After this many failed automatic attempts only a manual retry tries again. */
export const MAX_AUTO_ATTEMPTS = 8;

export type UploadRetryState = {
  attempts: number;
  /** Earliest moment the queue may try again on its own (ISO UTC). */
  nextAttemptAtUtcIso: string;
  /** Last error text, for the settings screen. Never contains credentials (storage errors carry status + body only). */
  lastError: string | null;
};

export function retryDelaySeconds(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_SECONDS.length) - 1;
  return RETRY_DELAYS_SECONDS[index];
}

/** The record after one more failed attempt. */
export function recordUploadFailure(
  previous: UploadRetryState | undefined,
  nowUtcIso: string,
  error: string,
): UploadRetryState {
  const attempts = (previous?.attempts ?? 0) + 1;
  return {
    attempts,
    nextAttemptAtUtcIso: addSecondsToUtcIso(nowUtcIso, retryDelaySeconds(attempts)),
    lastError: error.slice(0, 300),
  };
}

/**
 * Whether the queue should try this photo now. `force` is the manual
 * "Jetzt erneut versuchen": it ignores both the pause and the attempt limit.
 */
export function isUploadDue(state: UploadRetryState | undefined, nowUtcIso: string, force: boolean): boolean {
  if (!state || force) {
    return true;
  }
  if (state.attempts >= MAX_AUTO_ATTEMPTS) {
    return false;
  }
  return secondsBetween(state.nextAttemptAtUtcIso, nowUtcIso) >= 0;
}

export type UploadStep = 'thumb' | 'medium' | 'original';

type StepRow = {
  thumb_key: string | null;
  thumb_uploaded_at: string | null;
  medium_key: string | null;
  medium_uploaded_at: string | null;
  original_key: string | null;
  original_uploaded_at: string | null;
};

/**
 * Which uploads this photo still needs, in order. A step whose timestamp is
 * set is never planned again — the per-step markers are what make a retry
 * after a partial run upload only the missing pieces, never a second copy.
 * The original waits for Wi-Fi unless `allowOriginals`.
 */
export function plannedUploadSteps(row: StepRow, allowOriginals: boolean): UploadStep[] {
  const steps: UploadStep[] = [];
  if (!row.thumb_uploaded_at && row.thumb_key) steps.push('thumb');
  if (!row.medium_uploaded_at && row.medium_key) steps.push('medium');
  if (!row.original_uploaded_at && row.original_key && allowOriginals) steps.push('original');
  return steps;
}

/** True while any of the three uploads is still missing. */
export function needsUpload(row: StepRow): boolean {
  return (
    (!row.thumb_uploaded_at && !!row.thumb_key) ||
    (!row.medium_uploaded_at && !!row.medium_key) ||
    (!row.original_uploaded_at && !!row.original_key)
  );
}

export type PendingUploadSummary = {
  /** All photos of this person still missing an upload. */
  pending: number;
  /** Failed at least once, next automatic attempt scheduled. */
  retrying: number;
  /** Failed MAX_AUTO_ATTEMPTS times — only a manual retry tries again. */
  gaveUp: number;
  /** The local source file is gone; this phone cannot upload them any more. */
  sourceMissing: number;
};

export function summarizePendingUploads(
  photos: readonly { id: string }[],
  states: Readonly<Record<string, UploadRetryState>>,
  missingSourceIds: ReadonlySet<string>,
): PendingUploadSummary {
  let retrying = 0;
  let gaveUp = 0;
  let sourceMissing = 0;
  for (const photo of photos) {
    if (missingSourceIds.has(photo.id)) {
      sourceMissing += 1;
      continue;
    }
    const state = states[photo.id];
    if (!state) continue;
    if (state.attempts >= MAX_AUTO_ATTEMPTS) gaveUp += 1;
    else retrying += 1;
  }
  return { pending: photos.length, retrying, gaveUp, sourceMissing };
}

/** "Ausstehende Uploads: 1 · 1 fehlgeschlagen, neuer Versuch folgt" etc. */
export function formatPendingUploadLines(summary: PendingUploadSummary): string[] {
  const lines = [`Ausstehende Uploads: ${summary.pending}`];
  if (summary.retrying > 0) {
    lines.push(`${summary.retrying} fehlgeschlagen, neuer Versuch folgt automatisch`);
  }
  if (summary.gaveUp > 0) {
    lines.push(`${summary.gaveUp} mehrfach fehlgeschlagen – bitte „Jetzt erneut versuchen“`);
  }
  if (summary.sourceMissing > 0) {
    lines.push(
      summary.sourceMissing === 1
        ? '1 Foto: Datei ist auf diesem Handy nicht mehr vorhanden'
        : `${summary.sourceMissing} Fotos: Datei ist auf diesem Handy nicht mehr vorhanden`,
    );
  }
  return lines;
}

/**
 * Runs `task` at most once at a time: calls while one is running share its
 * promise instead of starting a second run (app start, foreground, network
 * change and a button can all fire together — two runs would upload the same
 * photo twice). `current()` exposes the running promise so a caller that
 * needs a FRESH run (the manual retry) can wait for it and start its own.
 */
export function createSingleFlight<T, A extends unknown[]>(
  task: (...args: A) => Promise<T>,
): { run: (...args: A) => Promise<T>; current: () => Promise<T> | null } {
  let running: Promise<T> | null = null;
  return {
    run: (...args: A) => {
      if (running) {
        return running;
      }
      running = task(...args).finally(() => {
        running = null;
      });
      return running;
    },
    current: () => running,
  };
}

/** One line after a manual retry, from a queue run's counts. */
export function formatUploadRunMessage(result: {
  originals: number;
  mediums: number;
  thumbnails: number;
  failed: number;
  sourceMissing: number;
}): string {
  const parts: string[] = [];
  const done = result.originals;
  if (done > 0) parts.push(done === 1 ? '1 Foto hochgeladen.' : `${done} Fotos hochgeladen.`);
  else if (result.mediums + result.thumbnails > 0) parts.push('Vorschauen hochgeladen.');
  if (result.failed > 0) {
    parts.push(result.failed === 1 ? '1 Foto ist erneut fehlgeschlagen.' : `${result.failed} Fotos sind erneut fehlgeschlagen.`);
  }
  if (result.sourceMissing > 0) {
    parts.push(
      result.sourceMissing === 1
        ? '1 Foto ist auf diesem Handy nicht mehr vorhanden.'
        : `${result.sourceMissing} Fotos sind auf diesem Handy nicht mehr vorhanden.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : 'Nichts zu übertragen.';
}

export type PendingPhotoDecision = 'source_missing' | 'waiting' | 'attempt';

/**
 * What the queue does with one pending photo this run. The missing source
 * file is checked FIRST: such a photo can never succeed on this phone, so it
 * is reported instead of being retried (and counted as failed) forever.
 */
export function decidePendingPhoto(
  sourceExists: boolean,
  state: UploadRetryState | undefined,
  nowUtcIso: string,
  force: boolean,
): PendingPhotoDecision {
  if (!sourceExists) return 'source_missing';
  return isUploadDue(state, nowUtcIso, force) ? 'attempt' : 'waiting';
}

/* ── Safety of the staged copy in photos-pending (2026-11-11) ──
 * For photo 01a18883… the staged copy in photos-pending is the ONLY copy left
 * (it was deleted from the gallery). These two guards are the one place that
 * decides whether a staged file may ever be removed. */

type StagedCopyRow = {
  local_uri: string | null;
  medium_key: string | null;
  medium_uploaded_at: string | null;
  original_uploaded_at: string | null;
};

/**
 * The staged original may be deleted only once BOTH the medium and the
 * original are confirmed on the server (their timestamps set). A row without
 * a medium key keeps its file too: "nothing to upload" must never read as
 * "uploaded".
 */
export function isSafeToDeleteStagedCopy(row: StagedCopyRow): boolean {
  return !!row.local_uri && !!row.original_uploaded_at && !!row.medium_key && !!row.medium_uploaded_at;
}

/**
 * Whether the AUTOMATIC 30-day trash sweep may purge this photo. Never one
 * whose original never reached the server while a staged copy exists: that
 * would silently destroy the only copy. (A person emptying the trash by hand
 * still decides for themselves.)
 */
export function isSafeForAutomaticPurge(row: { local_uri: string | null; original_uploaded_at: string | null }): boolean {
  return !(row.local_uri && !row.original_uploaded_at);
}

/** Size check after an upload: the stored object must have exactly the local file's size. */
export function storedSizeMatches(localBytes: number | null, storedBytes: number | null): boolean {
  return localBytes !== null && storedBytes !== null && localBytes > 0 && localBytes === storedBytes;
}
