/**
 * photos/hooks — React glue between the repository and the screens.
 *
 * Signed URLs are fetched in batches and cached for the lifetime of the screen.
 * They expire (see storage.ts), which is fine: the album is remounted far more
 * often than the TTL, and an expired URL simply falls back to the placeholder
 * rather than showing a broken image.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ShareCancelledError, sharePhotos } from './share';
import { checkShareBatchSize, formatMobileDataWarning, shouldWarnAboutMobileData } from './sharing';
import { createSignedUrls, isOnWifi, type ShareableOriginal, type ShareBatchProgress } from './storage';

/**
 * Resolve display URLs for a set of object keys.
 *
 * Only keys not already resolved are requested, so scrolling a long album does
 * not re-sign what is already on screen. The join of the key list is used as the
 * effect dependency because the array identity changes on every render.
 */
export function useSignedUrls(keys: (string | null | undefined)[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const resolved = useRef(new Set<string>());
  const wanted = keys.filter((key): key is string => Boolean(key));
  const dependency = wanted.join('|');

  useEffect(() => {
    const missing = wanted.filter((key) => !resolved.current.has(key));
    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    missing.forEach((key) => resolved.current.add(key));

    createSignedUrls(missing).then((fetched) => {
      if (cancelled || fetched.size === 0) {
        return;
      }
      setUrls((previous) => {
        const next = new Map(previous);
        fetched.forEach((url, key) => next.set(key, url));
        return next;
      });
    });

    return () => {
      cancelled = true;
      // Allow a retry on the next mount for keys that never resolved.
      missing.forEach((key) => {
        if (!urls.has(key)) {
          resolved.current.delete(key);
        }
      });
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
  /** Loading failed outright (not a per-photo skip — see `failedCount` below for that). */
  | { status: 'error' }
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
      return { status: 'error' };
    } finally {
      setProgress(null);
      controllerRef.current = null;
    }
  }, []);

  return { progress, share, cancel };
}
