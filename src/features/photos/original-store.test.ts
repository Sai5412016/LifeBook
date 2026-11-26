import { describe, expect, it } from 'vitest';

import { ORIGINALS_TO_R2 } from '@/core/storage/originals-config';
import { MediaSignError, R2RequestError } from '@/core/storage/media-sign-protocol';

import {
  OriginalNotConfirmedError,
  fullscreenKeysToSign,
  mediumShareSource,
  needsR2Delete,
  originalReadSource,
  originalStoreOf,
  uploadContentType,
  uploadOriginal,
  type OriginalUploadDeps,
  type SignedRequest,
} from './original-store';
import { isSafeToDeleteStagedCopy, recordUploadFailure } from './upload-retry';

const PHOTO = {
  id: '01a1c0de-0000-7000-8000-000000000001',
  local_uri: 'file:///data/photos-pending/01a1c0de.jpg',
  original_key: 'hh/01a1c0de-0000-7000-8000-000000000001/orig.jpg',
  mime: 'image/jpeg',
};
const SIZE = 7_116_470;

type Call = [string, ...unknown[]];

/** Records every dependency call in order; each step can be overridden to fail. */
function fakeDeps(overrides: Partial<OriginalUploadDeps> = {}): { deps: OriginalUploadDeps; calls: Call[] } {
  const calls: Call[] = [];
  const signed = (method: SignedRequest['method'], headers: Record<string, string> = {}): SignedRequest => ({
    url: `https://acct.eu.r2.cloudflarestorage.com/lifebook-originals/x?sig=${method}`,
    method,
    headers,
  });
  const deps: OriginalUploadDeps = {
    localSize: (uri) => {
      calls.push(['localSize', uri]);
      return SIZE;
    },
    uploadToSupabase: async (uri, key, mime) => {
      calls.push(['uploadToSupabase', uri, key, mime]);
    },
    supabaseStoredSize: async (key) => {
      calls.push(['supabaseStoredSize', key]);
      return SIZE;
    },
    signPut: async (photoId, contentType, bytes) => {
      calls.push(['signPut', photoId, contentType, bytes]);
      return signed('PUT', { 'content-type': contentType, 'content-length': String(bytes) });
    },
    putFile: async (uri, request) => {
      calls.push(['putFile', uri, request.method, request.headers]);
    },
    signGet: async (photoId) => {
      calls.push(['signGet', photoId]);
      return signed('GET');
    },
    probeSize: async (request) => {
      calls.push(['probeSize', request.method]);
      return SIZE;
    },
    markUploaded: async (photoId, store) => {
      calls.push(['markUploaded', photoId, store]);
    },
    ...overrides,
  };
  return { deps, calls };
}

const marks = (calls: Call[]) => calls.filter((call) => call[0] === 'markUploaded');

describe('the switch', () => {
  it('is on by default (new originals go to R2)', () => {
    expect(ORIGINALS_TO_R2).toBe(true);
  });
});

describe('upload with the switch ON → R2', () => {
  it('runs sign put → PUT with exactly the signed headers → sign get → size check → one mark as r2', async () => {
    const { deps, calls } = fakeDeps();
    await expect(uploadOriginal(PHOTO, true, deps)).resolves.toBe('r2');
    expect(calls.map((call) => call[0])).toEqual([
      'localSize',
      'signPut',
      'putFile',
      'signGet',
      'probeSize',
      'markUploaded',
    ]);
    expect(calls[1]).toEqual(['signPut', PHOTO.id, 'image/jpeg', SIZE]);
    expect(calls[2]).toEqual([
      'putFile',
      PHOTO.local_uri,
      'PUT',
      { 'content-type': 'image/jpeg', 'content-length': String(SIZE) },
    ]);
    expect(marks(calls)).toEqual([['markUploaded', PHOTO.id, 'r2']]);
  });

  it('never touches Supabase Storage for the original', async () => {
    const { deps, calls } = fakeDeps();
    await uploadOriginal(PHOTO, true, deps);
    expect(calls.some((call) => call[0] === 'uploadToSupabase' || call[0] === 'supabaseStoredSize')).toBe(false);
  });

  it('the size signed is the size READ FROM THE FILE, not anything else', async () => {
    const { deps, calls } = fakeDeps({ localSize: () => 1234 });
    await expect(uploadOriginal(PHOTO, true, deps)).rejects.toThrow(OriginalNotConfirmedError); // stored is SIZE ≠ 1234
    expect(calls.find((call) => call[0] === 'signPut')).toEqual(['signPut', PHOTO.id, 'image/jpeg', 1234]);
  });
});

describe("never 'r2' without a confirmed size", () => {
  const failing: Array<[string, Partial<OriginalUploadDeps>]> = [
    ['unreadable local size', { localSize: () => null }],
    ['empty file', { localSize: () => 0 }],
    ['media-sign refuses (403 forbidden)', { signPut: async () => { throw new MediaSignError(403, 'forbidden'); } }],
    ['media-sign not configured (500)', { signPut: async () => { throw new MediaSignError(500, 'not_configured'); } }],
    [
      'signed length differs from the file',
      { signPut: async () => ({ url: 'https://x', method: 'PUT' as const, headers: { 'content-type': 'image/jpeg', 'content-length': '1' } }) },
    ],
    ['R2 403 SignatureDoesNotMatch on PUT', { putFile: async () => { throw new R2RequestError('upload', 403, 'SignatureDoesNotMatch'); } }],
    ['R2 503 on PUT', { putFile: async () => { throw new R2RequestError('upload', 503, null); } }],
    ['network error on PUT', { putFile: async () => { throw new Error('Network request failed'); } }],
    ['sign get fails', { signGet: async () => { throw new MediaSignError(502, 'gateway'); } }],
    ['object not found after PUT', { probeSize: async () => null }],
    ['stored size one byte short', { probeSize: async () => SIZE - 1 }],
    ['size check refused (403)', { probeSize: async () => { throw new R2RequestError('size-check', 403, 'SignatureDoesNotMatch'); } }],
  ];

  for (const [label, override] of failing) {
    it(`${label}: throws, and markUploaded is never called`, async () => {
      const { deps, calls } = fakeDeps(override);
      await expect(uploadOriginal(PHOTO, true, deps)).rejects.toThrow();
      expect(marks(calls)).toEqual([]);
    });
  }

  it('a failure feeds the existing retry record and keeps the staged copy', async () => {
    const { deps } = fakeDeps({ putFile: async () => { throw new R2RequestError('upload', 403, 'SignatureDoesNotMatch'); } });
    let retry;
    try {
      await uploadOriginal(PHOTO, true, deps);
    } catch (error) {
      // exactly what storage.ts#executeUploadQueue's catch does
      retry = recordUploadFailure(undefined, '2026-11-26T12:00:00.000Z', (error as Error).message);
    }
    expect(retry).toEqual({
      attempts: 1,
      nextAttemptAtUtcIso: '2026-11-26T12:01:00.000Z',
      lastError: 'R2 upload HTTP 403 (SignatureDoesNotMatch)',
    });
    // The row was not marked: original_uploaded_at stays NULL → staged copy may not be deleted.
    expect(
      isSafeToDeleteStagedCopy({
        local_uri: PHOTO.local_uri,
        medium_key: 'm',
        medium_uploaded_at: '2026-11-26T11:59:00.000Z',
        original_uploaded_at: null,
      }),
    ).toBe(false);
  });

  it('a retry after a failure uploads again and only then marks', async () => {
    let attempt = 0;
    const { deps, calls } = fakeDeps({
      putFile: async () => {
        attempt += 1;
        if (attempt === 1) throw new R2RequestError('upload', 500, 'InternalError');
      },
    });
    await expect(uploadOriginal(PHOTO, true, deps)).rejects.toThrow();
    expect(marks(calls)).toEqual([]);
    await expect(uploadOriginal(PHOTO, true, deps)).resolves.toBe('r2');
    expect(marks(calls)).toEqual([['markUploaded', PHOTO.id, 'r2']]);
  });
});

describe('upload with the switch OFF → Supabase, as before PR 2', () => {
  it('uploads to Supabase, checks the stored size, marks as supabase — no media-sign call', async () => {
    const { deps, calls } = fakeDeps();
    await expect(uploadOriginal(PHOTO, false, deps)).resolves.toBe('supabase');
    expect(calls.map((call) => call[0])).toEqual(['uploadToSupabase', 'localSize', 'supabaseStoredSize', 'markUploaded']);
    expect(calls[0]).toEqual(['uploadToSupabase', PHOTO.local_uri, PHOTO.original_key, 'image/jpeg']);
    expect(marks(calls)).toEqual([['markUploaded', PHOTO.id, 'supabase']]);
  });

  it('a size mismatch in Supabase throws and does not mark', async () => {
    const { deps, calls } = fakeDeps({ supabaseStoredSize: async () => null });
    await expect(uploadOriginal(PHOTO, false, deps)).rejects.toThrow(/Original nicht bestätigt/);
    expect(marks(calls)).toEqual([]);
  });
});

describe('reading an original', () => {
  it('store: NULL and supabase are supabase; only r2 is r2', () => {
    expect(originalStoreOf({ original_store: null })).toBe('supabase');
    expect(originalStoreOf({})).toBe('supabase');
    expect(originalStoreOf({ original_store: 'supabase' })).toBe('supabase');
    expect(originalStoreOf({ original_store: 'r2' })).toBe('r2');
  });

  it('local copy first, then the row\'s store', () => {
    expect(originalReadSource({ local_uri: 'file:///x', original_key: 'k', original_store: 'r2' })).toBe('local');
    expect(originalReadSource({ local_uri: null, original_key: 'k', original_store: 'r2' })).toBe('r2');
    expect(originalReadSource({ local_uri: null, original_key: 'k', original_store: 'supabase' })).toBe('supabase');
    expect(originalReadSource({ local_uri: null, original_key: 'k', original_store: null })).toBe('supabase');
    expect(originalReadSource({ local_uri: null, original_key: null, original_store: 'r2' })).toBe('none');
  });

  it('upload content type falls back like before', () => {
    expect(uploadContentType(null)).toBe('image/jpeg');
    expect(uploadContentType('IMAGE/HEIC')).toBe('image/heic');
  });
});

describe('sharing: medium source', () => {
  const base = { local_uri: null, medium_key: 'm', medium_uploaded_at: '2026-11-26T12:00:00Z', original_key: 'o' };
  it('staged → render locally; uploaded medium → download; legacy → render from the original', () => {
    expect(mediumShareSource({ ...base, local_uri: 'file:///x' })).toBe('render_from_local');
    expect(mediumShareSource(base)).toBe('download_medium');
    expect(mediumShareSource({ ...base, medium_key: null, medium_uploaded_at: null })).toBe('render_from_original');
    expect(mediumShareSource({ ...base, medium_uploaded_at: null })).toBe('render_from_original');
    expect(mediumShareSource({ local_uri: null, medium_key: null, medium_uploaded_at: null, original_key: null })).toBe('none');
  });
});

describe('fullscreen: no signing of an original that is not shown', () => {
  it('medium present → only the medium, never the original', () => {
    expect(fullscreenKeysToSign({ local_uri: null, medium_key: 'm', original_key: 'o', original_store: 'supabase' })).toEqual(['m']);
    expect(fullscreenKeysToSign({ local_uri: null, medium_key: 'm', original_key: 'o', original_store: 'r2' })).toEqual(['m']);
  });
  it('staged locally → nothing to sign', () => {
    expect(fullscreenKeysToSign({ local_uri: 'file:///x', medium_key: 'm', original_key: 'o' })).toEqual([]);
  });
  it('legacy photo without medium → the Supabase original; an R2 original is never sent to Supabase', () => {
    expect(fullscreenKeysToSign({ local_uri: null, medium_key: null, original_key: 'o', original_store: null })).toEqual(['o']);
    expect(fullscreenKeysToSign({ local_uri: null, medium_key: null, original_key: 'o', original_store: 'r2' })).toEqual([]);
  });
});

describe('permanent delete', () => {
  it('needs an R2 delete only for r2 originals', () => {
    expect(needsR2Delete({ original_key: 'o', original_store: 'r2' })).toBe(true);
    expect(needsR2Delete({ original_key: 'o', original_store: 'supabase' })).toBe(false);
    expect(needsR2Delete({ original_key: 'o', original_store: null })).toBe(false);
    expect(needsR2Delete({ original_key: null, original_store: 'r2' })).toBe(false);
  });
});
