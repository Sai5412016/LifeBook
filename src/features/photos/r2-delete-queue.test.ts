import { describe, expect, it } from 'vitest';

import { MediaSignError, R2RequestError } from '@/core/storage/media-sign-protocol';

import {
  MAX_R2_DELETE_ATTEMPTS,
  applyR2DeleteRetry,
  classifyR2DeleteError,
  dueR2Deletes,
  recordR2DeleteFailure,
} from './r2-delete-queue';

const NOW = '2026-11-26T12:00:00.000Z';

describe('remembering failed R2 deletes', () => {
  it('records a failure with key and first time; a second failure counts up', () => {
    let queue = recordR2DeleteFailure([], { photoId: 'p1', key: 'hh/p1/orig.jpg', error: 'R2 delete HTTP 503', nowUtcIso: NOW });
    expect(queue).toEqual([
      { photoId: 'p1', key: 'hh/p1/orig.jpg', attempts: 1, lastError: 'R2 delete HTTP 503', firstFailedAtUtcIso: NOW, unreachable: false },
    ]);
    queue = recordR2DeleteFailure(queue, { photoId: 'p1', key: null, error: 'again', nowUtcIso: '2026-11-27T00:00:00.000Z' });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ attempts: 2, key: 'hh/p1/orig.jpg', firstFailedAtUtcIso: NOW, lastError: 'again' });
  });

  it('a successful retry removes the entry', () => {
    const queue = recordR2DeleteFailure([], { photoId: 'p1', key: 'k', error: 'x', nowUtcIso: NOW });
    expect(applyR2DeleteRetry(queue, 'p1', { kind: 'deleted' })).toEqual([]);
  });

  it('"row gone" makes it unreachable — kept with its key, no longer retried', () => {
    const queue = applyR2DeleteRetry(
      recordR2DeleteFailure([], { photoId: 'p1', key: 'k', error: 'x', nowUtcIso: NOW }),
      'p1',
      { kind: 'photo_gone' },
    );
    expect(queue[0]).toMatchObject({ unreachable: true, key: 'k' });
    expect(dueR2Deletes(queue)).toEqual([]);
  });

  it('stops automatic retries after the limit', () => {
    let queue = recordR2DeleteFailure([], { photoId: 'p1', key: 'k', error: 'x', nowUtcIso: NOW });
    for (let index = 1; index < MAX_R2_DELETE_ATTEMPTS; index += 1) {
      expect(dueR2Deletes(queue)).toHaveLength(1);
      queue = applyR2DeleteRetry(queue, 'p1', { kind: 'failed', error: 'x' });
    }
    expect(queue[0].attempts).toBe(MAX_R2_DELETE_ATTEMPTS);
    expect(dueR2Deletes(queue)).toEqual([]);
  });

  it('only media-sign 404 photo_not_found means "row gone"', () => {
    expect(classifyR2DeleteError(new MediaSignError(404, 'photo_not_found'))).toEqual({ kind: 'photo_gone' });
    expect(classifyR2DeleteError(new MediaSignError(403, 'forbidden')).kind).toBe('failed');
    expect(classifyR2DeleteError(new R2RequestError('delete', 404, 'NoSuchKey')).kind).toBe('failed');
    expect(classifyR2DeleteError(new Error('Network request failed'))).toEqual({ kind: 'failed', error: 'Network request failed' });
  });
});
