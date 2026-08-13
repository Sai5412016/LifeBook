/**
 * photos/hooks — React glue between the repository and the screens.
 *
 * Signed URLs come from a MODULE-LEVEL cache in storage.ts
 * (`getCachedSignedUrls`), not screen-local state — see that function's own
 * doc comment (Aufgabe 4a, 2026-08-13) for why: a per-screen cache used to
 * re-sign, and therefore re-download, every photo on every remount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ShareCancelledError, ShareOpenError, sharePhotos } from './share';
import { checkShareBatchSize, formatMobileDataWarning, shouldWarnAboutMobileData } from './sharing';
import { getCachedSignedUrls, isOnWifi, type ShareableOriginal, type ShareBatchProgress } from './storage';

/**
 * Resolve display URLs for a set of object keys, backed by the shared
 * module-level cache — a key whose signed URL is still fresh resolves
 * without a network round trip, remount or not.
 */
export function useSignedUrls(keys: (string | null | undefined)[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const wanted = keys.filter((key): key is string => Boolean(key));
  const dependency = wanted.join('|');

  useEffect(() => {
    if (wanted.length === 0) {
      setUrls(new Map());
      return;
    }

    let cancelled = false;
    getCachedSignedUrls(wanted).then((fetched) => {
      if (!cancelled) {
        setUrls(fetched);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency]);

  return urls;
}

export type SharePhotosOutcome =
  /** Rejected before anything was loaded — empty selection or over the cap (see photos/sharing#checkShareBatchSize). */
  | { status: 'rejected'; message: string }
  /** The loading screen was cancelled before the share sheet opened. */
  | { status: 'cancelled' }
  /**
   * Loading failed outright (not a per-photo skip — see `failedCount` below
   * for that). `message` is the full diagnostic text when available (path,
   * byte size, underlying cause — see sharing.ts#formatShareDiagnostic) so
   * a failure the OS share sheet itself swallowed is still visible to the
   * user, not just the console.
   */
  | { status: 'error'; message: string }
  | {
      status: 'done';
      shared: number;
      failedCount: number;
      /** Advisory only, set when off Wi-Fi for a large-enough batch — never blocks the share. */
      wifiWarning: string | null;
    };

/**
 * Shared share-photos flow for the Chronik's multi-select action bar and the
 * fullscreen viewer's single-photo button — both need the same batch-size
 * check, Wi-Fi warning, cancelable loading progress and per-photo failure
 * tolerance, so it lives here once rather than twice.
 */
export function useSharePhotos(): {
  progress: ShareBatchProgress | null;
  share: (photos: readonly ShareableOriginal[]) => Promise<SharePhotosOutcome>;
  cancel: () => void;
} {
  const [progress, setProgress] = useState<ShareBatchProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const share = useCallback(async (photos: readonly ShareableOriginal[]): Promise<SharePhotosOutcome> => {
    const check = checkShareBatchSize(photos.length);
    if (!check.ok) {
      return { status: 'rejected', message: check.message };
    }

    const wifiWarning = shouldWarnAboutMobileData(photos.length, await isOnWifi())
      ? formatMobileDataWarning(photos.length)
      : null;

    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress({ current: 0, total: photos.length });

    try {
      const result = await sharePhotos(photos, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      return { status: 'done', shared: result.shared, failedCount: result.failedCount, wifiWarning };
    } catch (error) {
      if (error instanceof ShareCancelledError) {
        return { status: 'cancelled' };
      }
      console.error('[LifeBook] Teilen fehlgeschlagen', error);
      return {
        status: 'error',
        message:
          error instanceof ShareOpenError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unbekannter Fehler beim Teilen.',
      };
    } finally {
      setProgress(null);
      controllerRef.current = null;
    }
  }, []);

  return { progress, share, cancel };
}
