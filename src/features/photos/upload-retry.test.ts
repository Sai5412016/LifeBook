import { describe, expect, it } from 'vitest';

import {
  MAX_AUTO_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  createSingleFlight,
  decidePendingPhoto,
  formatPendingUploadLines,
  formatUploadRunMessage,
  isSafeForAutomaticPurge,
  isSafeToDeleteStagedCopy,
  isUploadDue,
  needsUpload,
  plannedUploadSteps,
  recordUploadFailure,
  retryDelaySeconds,
  storedSizeMatches,
  summarizePendingUploads,
} from './upload-retry';

const T0 = '2026-10-29T16:35:07.000Z';

/** Exactly the stuck photo of 29.10.2026: thumb up, medium and original missing. */
const stuck = {
  thumb_key: 'h/p/thumb.jpg',
  thumb_uploaded_at: '2026-10-29T16:35:07.177Z',
  medium_key: 'h/p/medium.jpg',
  medium_uploaded_at: null,
  original_key: 'h/p/orig.jpg',
  original_uploaded_at: null,
};

describe('a stuck upload is retried', () => {
  it('a photo with no failure record is attempted at once (the 29.10. photo after the update)', () => {
    expect(decidePendingPhoto(true, undefined, '2026-11-09T10:00:00.000Z', false)).toBe('attempt');
  });

  it('after a failure it waits for the pause, then is attempted again on its own', () => {
    const state = recordUploadFailure(undefined, T0, 'HTTP 500');
    expect(state.attempts).toBe(1);
    expect(decidePendingPhoto(true, state, '2026-10-29T16:35:30.000Z', false)).toBe('waiting');
    expect(decidePendingPhoto(true, state, '2026-10-29T16:36:07.000Z', false)).toBe('attempt'); // +60 s
  });

  it('the pauses grow and are capped, never a tight loop', () => {
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(300);
    expect(retryDelaySeconds(99)).toBe(RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1]);
    let state = recordUploadFailure(undefined, T0, 'x');
    const pauses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const before = state.nextAttemptAtUtcIso;
      state = recordUploadFailure(state, before, 'x');
      pauses.push((Date.parse(state.nextAttemptAtUtcIso) - Date.parse(before)) / 1000);
    }
    expect(pauses).toEqual([300, 900, 3600, 10800, 21600]);
  });

  it('after the attempt limit only a manual retry tries again', () => {
    let state = recordUploadFailure(undefined, T0, 'x');
    for (let i = 1; i < MAX_AUTO_ATTEMPTS; i += 1) state = recordUploadFailure(state, T0, 'x');
    expect(state.attempts).toBe(MAX_AUTO_ATTEMPTS);
    const muchLater = '2027-01-01T00:00:00.000Z';
    expect(isUploadDue(state, muchLater, false)).toBe(false);
    expect(decidePendingPhoto(true, state, muchLater, true)).toBe('attempt'); // "Jetzt erneut versuchen"
  });

  it('a manual retry ignores the pause', () => {
    const state = recordUploadFailure(undefined, T0, 'x');
    expect(decidePendingPhoto(true, state, T0, true)).toBe('attempt');
  });

  it('keeps the error text short', () => {
    expect(recordUploadFailure(undefined, T0, 'e'.repeat(1000)).lastError).toHaveLength(300);
  });
});

describe('a missing source file is recognised', () => {
  it('is reported instead of attempted — with or without a failure record, even when forced', () => {
    expect(decidePendingPhoto(false, undefined, T0, false)).toBe('source_missing');
    expect(decidePendingPhoto(false, recordUploadFailure(undefined, T0, 'x'), T0, true)).toBe('source_missing');
  });

  it('is counted separately in the summary and named on the settings screen', () => {
    const states = { b: recordUploadFailure(undefined, T0, 'x') };
    const summary = summarizePendingUploads([{ id: 'a' }, { id: 'b' }, { id: 'c' }], states, new Set(['c']));
    expect(summary).toEqual({ pending: 3, retrying: 1, gaveUp: 0, sourceMissing: 1 });
    expect(formatPendingUploadLines(summary)).toEqual([
      'Ausstehende Uploads: 3',
      '1 fehlgeschlagen, neuer Versuch folgt automatisch',
      '1 Foto: Datei ist auf diesem Handy nicht mehr vorhanden',
    ]);
  });

  it('a photo past the attempt limit is listed as needing a manual retry', () => {
    let state = recordUploadFailure(undefined, T0, 'x');
    for (let i = 1; i < MAX_AUTO_ATTEMPTS; i += 1) state = recordUploadFailure(state, T0, 'x');
    const summary = summarizePendingUploads([{ id: 'a' }], { a: state }, new Set());
    expect(formatPendingUploadLines(summary)[1]).toContain('Jetzt erneut versuchen');
  });
});

describe('no double upload', () => {
  it('the stuck photo plans only its missing pieces: medium, then original — never the thumb again', () => {
    expect(plannedUploadSteps(stuck, true)).toEqual(['medium', 'original']);
    expect(plannedUploadSteps(stuck, false)).toEqual(['medium']); // original waits for Wi-Fi
    expect(needsUpload(stuck)).toBe(true);
  });

  it('a fully uploaded photo plans nothing', () => {
    const done = { ...stuck, medium_uploaded_at: T0, original_uploaded_at: T0 };
    expect(plannedUploadSteps(done, true)).toEqual([]);
    expect(needsUpload(done)).toBe(false);
  });

  it('concurrent triggers (start, foreground, network, button) share ONE run', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const flight = createSingleFlight(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return calls;
    });
    const a = flight.run();
    const b = flight.run();
    const c = flight.run();
    expect(flight.current()).not.toBeNull();
    release();
    expect(await Promise.all([a, b, c])).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
    expect(flight.current()).toBeNull();
    // A later call starts a fresh run.
    const d = flight.run();
    release();
    expect(await d).toBe(2);
  });

  it('a failed run does not block the next one', async () => {
    let calls = 0;
    const flight = createSingleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return 'ok';
    });
    await expect(flight.run()).rejects.toThrow('boom');
    expect(await flight.run()).toBe('ok');
  });
});

describe('formatUploadRunMessage', () => {
  it('reports success, renewed failures and missing files', () => {
    expect(formatUploadRunMessage({ originals: 1, mediums: 1, thumbnails: 0, failed: 0, sourceMissing: 0 })).toBe(
      '1 Foto hochgeladen.',
    );
    expect(formatUploadRunMessage({ originals: 0, mediums: 0, thumbnails: 0, failed: 1, sourceMissing: 1 })).toBe(
      '1 Foto ist erneut fehlgeschlagen. 1 Foto ist auf diesem Handy nicht mehr vorhanden.',
    );
    expect(formatUploadRunMessage({ originals: 0, mediums: 0, thumbnails: 0, failed: 0, sourceMissing: 0 })).toBe(
      'Nichts zu übertragen.',
    );
  });
});

describe('the staged copy in photos-pending is never deleted too early', () => {
  const staged = 'file:///data/user/0/com.lifebook.app/files/photos-pending/01a18883.jpg';
  const base = { local_uri: staged, medium_key: 'h/p/medium.jpg', medium_uploaded_at: null, original_uploaded_at: null };

  it('not while medium or original is missing — exactly the stuck photo', () => {
    expect(isSafeToDeleteStagedCopy(base)).toBe(false);
    expect(isSafeToDeleteStagedCopy({ ...base, medium_uploaded_at: T0 })).toBe(false);
    expect(isSafeToDeleteStagedCopy({ ...base, original_uploaded_at: T0 })).toBe(false);
  });

  it('only once BOTH are confirmed', () => {
    expect(isSafeToDeleteStagedCopy({ ...base, medium_uploaded_at: T0, original_uploaded_at: T0 })).toBe(true);
  });

  it('a row without a medium key keeps its file ("nothing to upload" is not "uploaded")', () => {
    expect(isSafeToDeleteStagedCopy({ ...base, medium_key: null, original_uploaded_at: T0 })).toBe(false);
  });

  it('the upload counts only when the server holds exactly the local size', () => {
    expect(storedSizeMatches(7116470, 7116470)).toBe(true);
    expect(storedSizeMatches(7116470, 7000000)).toBe(false); // truncated
    expect(storedSizeMatches(7116470, null)).toBe(false); // not found / lookup failed
    expect(storedSizeMatches(null, 7116470)).toBe(false); // local file unreadable
    expect(storedSizeMatches(0, 0)).toBe(false);
  });

  it('the automatic trash sweep never purges an original that never reached the server', () => {
    expect(isSafeForAutomaticPurge({ local_uri: staged, original_uploaded_at: null })).toBe(false);
    expect(isSafeForAutomaticPurge({ local_uri: staged, original_uploaded_at: T0 })).toBe(true);
    expect(isSafeForAutomaticPurge({ local_uri: null, original_uploaded_at: T0 })).toBe(true);
  });
});
