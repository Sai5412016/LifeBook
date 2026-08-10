/**
 * photos/hooks — React glue between the repository and the screens.
 *
 * Signed URLs are fetched in batches and cached for the lifetime of the screen.
 * They expire (see storage.ts), which is fine: the album is remounted far more
 * often than the TTL, and an expired URL simply falls back to the placeholder
 * rather than showing a broken image.
 */

import { useEffect, useRef, useState } from 'react';

import { createSignedUrls } from './storage';

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
