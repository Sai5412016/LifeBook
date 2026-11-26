import { describe, expect, it } from 'vitest';

import {
  EXPIRES_SECONDS,
  MAX_PUT_BYTES,
  WRITER_ROLES,
  bearerToken,
  handleMediaSign,
  mayPerform,
  originalKey,
  parseRequest,
} from './handler.ts';
import type { Deps, PhotoRecord, Role } from './handler.ts';

const HOUSEHOLD = '019fe2a1-0c5f-799a-a45a-2f0be423178a';
const OTHER_HOUSEHOLD = '019fe2a1-0000-0000-0000-000000000000';
const PHOTO: PhotoRecord = { id: '01a18883-c27b-7ee0-9311-520f80d61fa3', household_id: HOUSEHOLD, mime: 'image/jpeg' };
const NOW = new Date('2026-11-26T12:00:00Z');

function deps(overrides: Partial<Deps> & { role?: Role | null; photo?: PhotoRecord | null } = {}): Deps {
  const role = 'role' in overrides ? overrides.role : 'owner';
  const photo = 'photo' in overrides ? overrides.photo : PHOTO;
  return {
    userIdForToken: async (token) => (token === 'valid-token' ? 'user-1' : null),
    loadPhoto: async (id) => (photo && id === photo.id ? photo : null),
    loadRole: async (userId, householdId) => (userId === 'user-1' && householdId === HOUSEHOLD ? (role ?? null) : null),
    config: {
      endpoint: 'https://acct.eu.r2.cloudflarestorage.com',
      bucket: 'lifebook-originals',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secretexample',
    },
    now: () => NOW,
    ...overrides,
  };
}

const AUTH = 'Bearer valid-token';
const get = { photo_id: PHOTO.id, op: 'get' };
const put = { photo_id: PHOTO.id, op: 'put', content_type: 'image/jpeg', bytes: 7116470 };
const del = { photo_id: PHOTO.id, op: 'delete' };

describe('error codes', () => {
  it('401 without login, with a malformed header, or an invalid token', async () => {
    expect((await handleMediaSign(null, get, deps())).status).toBe(401);
    expect((await handleMediaSign('Basic abc', get, deps())).status).toBe(401);
    expect((await handleMediaSign('Bearer wrong', get, deps())).status).toBe(401);
  });

  it('401 is decided before anything is read about the photo', async () => {
    let looked = false;
    await handleMediaSign(null, get, deps({ loadPhoto: async () => { looked = true; return PHOTO; } }));
    expect(looked).toBe(false);
  });

  it('400 on invalid input', async () => {
    for (const body of [
      null,
      'x',
      { op: 'get' },
      { photo_id: PHOTO.id, op: 'list' },
      { photo_id: '../other', op: 'get' },
      { photo_id: 'a/b', op: 'get' },
      { photo_id: PHOTO.id, op: 'put', bytes: 10 }, // no content type
      { photo_id: PHOTO.id, op: 'put', content_type: 'image/jpeg' }, // no size
      { photo_id: PHOTO.id, op: 'put', content_type: 'image/gif', bytes: 10 },
      { photo_id: PHOTO.id, op: 'put', content_type: 'image/jpeg', bytes: 0 },
      { photo_id: PHOTO.id, op: 'put', content_type: 'image/jpeg', bytes: 1.5 },
    ]) {
      expect((await handleMediaSign(AUTH, body, deps())).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('400 when an upload is larger than 50 MB', async () => {
    const tooBig = { ...put, bytes: MAX_PUT_BYTES + 1 };
    expect((await handleMediaSign(AUTH, tooBig, deps())).status).toBe(400);
    expect((await handleMediaSign(AUTH, { ...put, bytes: MAX_PUT_BYTES }, deps())).status).toBe(200);
  });

  it('400 when the upload claims another type than the photo has', async () => {
    const res = await handleMediaSign(AUTH, { ...put, content_type: 'image/png' }, deps());
    expect(res).toEqual({ status: 400, body: { error: 'content_type_mismatch' } });
  });

  it('404 for an unknown photo', async () => {
    expect((await handleMediaSign(AUTH, { ...get, photo_id: 'nope' }, deps())).status).toBe(404);
  });

  it('403 for a non-member — even for reading', async () => {
    expect((await handleMediaSign(AUTH, get, deps({ role: null }))).status).toBe(403);
  });

  it('500 (without details) when the secrets are not set', async () => {
    const res = await handleMediaSign(AUTH, get, deps({ config: null }));
    expect(res).toEqual({ status: 500, body: { error: 'not_configured' } });
  });

  it('error bodies never contain a URL, key or secret', async () => {
    for (const res of [
      await handleMediaSign(null, get, deps()),
      await handleMediaSign(AUTH, { ...get, photo_id: 'nope' }, deps()),
      await handleMediaSign(AUTH, put, deps({ role: 'viewer' })),
    ]) {
      expect(JSON.stringify(res.body)).not.toMatch(/http|secret|AKID|orig\./);
    }
  });
});

describe('roles (mirror public.auth_writable_household_ids: owner, caregiver)', () => {
  it('writer roles are exactly owner and caregiver', () => {
    expect([...WRITER_ROLES].sort()).toEqual(['caregiver', 'owner']);
  });

  it('every member may read; only writers may upload or delete', async () => {
    for (const role of ['owner', 'caregiver', 'viewer'] as const) {
      expect((await handleMediaSign(AUTH, get, deps({ role }))).status, role).toBe(200);
    }
    expect((await handleMediaSign(AUTH, put, deps({ role: 'viewer' }))).status).toBe(403);
    expect((await handleMediaSign(AUTH, del, deps({ role: 'viewer' }))).status).toBe(403);
    expect((await handleMediaSign(AUTH, put, deps({ role: 'caregiver' }))).status).toBe(200);
    expect((await handleMediaSign(AUTH, del, deps({ role: 'owner' }))).status).toBe(200);
  });

  it('mayPerform', () => {
    expect(mayPerform('get', null)).toBe(false);
    expect(mayPerform('get', 'viewer')).toBe(true);
    expect(mayPerform('delete', 'viewer')).toBe(false);
  });
});

describe('the key comes from the database, never from the request', () => {
  it('builds <household_id>/<photo_id>/orig.<ext> like the Supabase bucket', () => {
    expect(originalKey(PHOTO)).toBe(`${HOUSEHOLD}/${PHOTO.id}/orig.jpg`);
    expect(originalKey({ ...PHOTO, mime: 'image/png' })).toBe(`${HOUSEHOLD}/${PHOTO.id}/orig.png`);
    expect(originalKey({ ...PHOTO, mime: 'image/heic' })).toBe(`${HOUSEHOLD}/${PHOTO.id}/orig.heic`);
    expect(originalKey({ ...PHOTO, mime: 'image/webp' })).toBe(`${HOUSEHOLD}/${PHOTO.id}/orig.webp`);
  });

  it('refuses unknown types and unsafe ids stored in the database', () => {
    expect(originalKey({ ...PHOTO, mime: 'image/heif' })).toBeNull();
    expect(originalKey({ ...PHOTO, mime: null })).toBeNull();
    expect(originalKey({ ...PHOTO, household_id: 'a/../b' })).toBeNull();
  });

  it('ignores household_id, key and path smuggled into the request', async () => {
    const res = await handleMediaSign(
      AUTH,
      { ...get, household_id: OTHER_HOUSEHOLD, key: `${OTHER_HOUSEHOLD}/x/orig.jpg`, path: '../../x' },
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(`${HOUSEHOLD}/${PHOTO.id}/orig.jpg`);
    expect(String(res.body.url)).toContain(`/lifebook-originals/${HOUSEHOLD}/${PHOTO.id}/orig.jpg?`);
    expect(String(res.body.url)).not.toContain(OTHER_HOUSEHOLD);
  });

  it('membership is checked against the photo\'s household, not one the caller names', async () => {
    let askedFor = '';
    await handleMediaSign(AUTH, { ...get, household_id: OTHER_HOUSEHOLD }, deps({
      loadRole: async (_user, householdId) => { askedFor = householdId; return 'owner'; },
    }));
    expect(askedFor).toBe(HOUSEHOLD);
  });
});

describe('expiry and binding of the signed URLs', () => {
  const expires = (url: unknown) => new URL(String(url)).searchParams.get('X-Amz-Expires');

  it('GET 1 h, PUT 15 min, DELETE 15 min', async () => {
    const g = await handleMediaSign(AUTH, get, deps());
    const p = await handleMediaSign(AUTH, put, deps());
    const d = await handleMediaSign(AUTH, del, deps());
    expect([expires(g.body.url), expires(p.body.url), expires(d.body.url)]).toEqual(['3600', '900', '900']);
    expect(g.body.expires_at).toBe('2026-11-26T13:00:00.000Z');
    expect(p.body.expires_at).toBe('2026-11-26T12:15:00.000Z');
    expect(EXPIRES_SECONDS).toEqual({ get: 3600, put: 900, delete: 900 });
  });

  it('PUT is bound to content type and length; GET and DELETE sign only the host', async () => {
    const p = await handleMediaSign(AUTH, put, deps());
    expect(new URL(String(p.body.url)).searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(p.body.headers).toEqual({ 'content-type': 'image/jpeg', 'content-length': '7116470' });
    expect(p.body.method).toBe('PUT');
    const g = await handleMediaSign(AUTH, get, deps());
    expect(new URL(String(g.body.url)).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect((await handleMediaSign(AUTH, del, deps())).body.method).toBe('DELETE');
  });

  it('a different length gives a different signature — R2 accepts only exactly this size', async () => {
    const signature = async (bytes: number) =>
      new URL(String((await handleMediaSign(AUTH, { ...put, bytes }, deps())).body.url)).searchParams.get('X-Amz-Signature');
    const a = await signature(7116470);
    const b = await signature(7116471);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(await signature(7116470)).toBe(a); // deterministic for the same input
  });

  it('put without bytes is refused with 400 (the length is mandatory)', async () => {
    const { bytes: _omit, ...withoutBytes } = put;
    expect((await handleMediaSign(AUTH, withoutBytes, deps()))).toEqual({ status: 400, body: { error: 'invalid_request' } });
    expect((await handleMediaSign(AUTH, { ...put, bytes: '7116470' }, deps())).status).toBe(400); // string, not a number
  });

  it('signs for region auto against the configured EU endpoint', async () => {
    const g = await handleMediaSign(AUTH, get, deps());
    const url = new URL(String(g.body.url));
    expect(url.host).toBe('acct.eu.r2.cloudflarestorage.com');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20261126/auto/s3/aws4_request');
  });
});

describe('small helpers', () => {
  it('bearerToken', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('parseRequest normalises the content type and keeps only what is needed', () => {
    expect(parseRequest({ ...put, content_type: 'IMAGE/JPEG', extra: 1 })).toEqual({
      photoId: PHOTO.id,
      op: 'put',
      contentType: 'image/jpeg',
      bytes: 7116470,
    });
  });
});
