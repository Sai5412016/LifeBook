/**
 * photos/r2-delete-queue — R2 deletes that failed during a permanent delete,
 * remembered per device for a later retry (PR 2, 2026-11-26). Pure; the
 * AsyncStorage side is ./r2-delete-store.ts, the retry loop is
 * ./storage.ts#retryPendingR2Deletes.
 *
 * Task rule: a failed R2 delete must NOT block deleting the row — a photo
 * the person removed for good must disappear from both phones. The object
 * in R2 is then an orphan until something removes it.
 *
 * KNOWN LIMIT (reported in the PR, to be closed in PR 3): `media-sign` builds
 * the R2 key from the photo ROW and refuses with 404 `photo_not_found` once
 * the row is gone on the server — by design it never trusts a key sent by
 * the phone. A retry therefore only succeeds while the row's DELETE has not
 * reached Postgres yet (e.g. the trash was emptied offline). After that the
 * entry is kept as `unreachable` with its key, so the orphan is at least
 * known on this phone and can be cleaned up server-side later.
 */

export type PendingR2Delete = {
  photoId: string;
  /** R2 object key (<household>/<photo>/orig.<ext>), for a later server-side cleanup. */
  key: string | null;
  attempts: number;
  lastError: string;
  firstFailedAtUtcIso: string;
  /** media-sign said the row is gone: the app can no longer sign a delete for it. */
  unreachable: boolean;
};

/** After this many failed retries an entry stops being retried automatically (it stays listed). */
export const MAX_R2_DELETE_ATTEMPTS = 10;

export function recordR2DeleteFailure(
  queue: readonly PendingR2Delete[],
  entry: { photoId: string; key: string | null; error: string; nowUtcIso: string },
): PendingR2Delete[] {
  const existing = queue.find((item) => item.photoId === entry.photoId);
  const rest = queue.filter((item) => item.photoId !== entry.photoId);
  return [
    ...rest,
    {
      photoId: entry.photoId,
      key: entry.key ?? existing?.key ?? null,
      attempts: (existing?.attempts ?? 0) + 1,
      lastError: entry.error.slice(0, 300),
      firstFailedAtUtcIso: existing?.firstFailedAtUtcIso ?? entry.nowUtcIso,
      unreachable: false,
    },
  ];
}

/** Entries worth another automatic attempt. */
export function dueR2Deletes(queue: readonly PendingR2Delete[]): PendingR2Delete[] {
  return queue.filter((item) => !item.unreachable && item.attempts < MAX_R2_DELETE_ATTEMPTS);
}

export type R2DeleteRetryOutcome =
  | { kind: 'deleted' }
  /** media-sign 404 photo_not_found: the row is gone server-side. */
  | { kind: 'photo_gone' }
  | { kind: 'failed'; error: string };

/** The queue after one retry of one entry. */
export function applyR2DeleteRetry(
  queue: readonly PendingR2Delete[],
  photoId: string,
  outcome: R2DeleteRetryOutcome,
): PendingR2Delete[] {
  if (outcome.kind === 'deleted') {
    return queue.filter((item) => item.photoId !== photoId);
  }
  return queue.map((item) => {
    if (item.photoId !== photoId) return item;
    if (outcome.kind === 'photo_gone') {
      return { ...item, unreachable: true, lastError: 'Foto-Zeile auf dem Server bereits gelöscht' };
    }
    return { ...item, attempts: item.attempts + 1, lastError: outcome.error.slice(0, 300) };
  });
}

/** Maps a media-sign/R2 error to a retry outcome — only the function's own 404 means "row gone". */
export function classifyR2DeleteError(error: unknown): R2DeleteRetryOutcome {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  if (status === 404 && code === 'photo_not_found') {
    return { kind: 'photo_gone' };
  }
  return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
}
