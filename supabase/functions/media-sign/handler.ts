/**
 * media-sign/handler — every decision of the Edge Function `media-sign`, as a
 * pure function with injected dependencies (auth lookup, database reads,
 * configuration, clock). index.ts only wires these to Supabase and Deno;
 * this file has no Deno or npm import, so all of it runs under Vitest
 * (handler.test.ts).
 *
 * What it does: after checking who is asking and what they may do, it hands
 * out ONE short-lived SigV4 URL for ONE photo original in Cloudflare R2.
 *
 * Trust rules (task 2026-11-26) — none of these may ever be loosened:
 *  - The household is read from the photo row in the database, NEVER from the
 *    request. Any `household_id`, `key` or path in the body is ignored.
 *  - The object key is built here, from database values only:
 *    <household_id>/<photo_id>/orig.<ext>, the same layout as the Supabase
 *    bucket `photos`, and every segment is checked to contain no "/" or "..".
 *  - Reading needs membership; writing and deleting need a writer role. The
 *    roles mirror the database's own rules exactly: public.auth_household_ids()
 *    (any member) and public.auth_writable_household_ids() (role IN
 *    ('owner','caregiver')), which the `photos` table and the `photos` bucket
 *    policies use (checked against the live database on 2026-11-26).
 *  - An upload URL is bound to the photo's type AND to the exact byte size
 *    the caller declared (signed Content-Type and Content-Length).
 *  - Nothing secret leaves this module except the signed URL itself in the
 *    success response; error bodies never contain keys or URLs.
 */

import { objectUrl, presignUrl } from './sigv4.ts';

export type Op = 'get' | 'put' | 'delete';
export type Role = 'owner' | 'caregiver' | 'viewer';

/** Mirrors public.auth_writable_household_ids(): role IN ('owner','caregiver'). */
export const WRITER_ROLES: readonly Role[] = ['owner', 'caregiver'];

/** Validity of a signed URL, per operation. */
export const EXPIRES_SECONDS: Readonly<Record<Op, number>> = { get: 60 * 60, put: 15 * 60, delete: 15 * 60 };

export const MAX_PUT_BYTES = 50 * 1024 * 1024;

/**
 * Allowed originals. Mirrors the app's identity.ts#MIME_EXTENSIONS so R2 keys
 * equal today's Supabase keys (image/jpeg -> orig.jpg), restricted to the
 * extensions the task allows (jpg|jpeg|png|heic|webp). image/heif is NOT
 * allowed (the app would name it .heif); no such photo exists today.
 */
export const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp']);

export type PhotoRecord = {
  id: string;
  household_id: string;
  mime: string | null;
};

export type SignerConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type Deps = {
  /** User id behind the bearer token, or null if it is missing/invalid/expired. */
  userIdForToken: (token: string) => Promise<string | null>;
  loadPhoto: (photoId: string) => Promise<PhotoRecord | null>;
  /** The caller's role in that household, or null when not a (live) member. */
  loadRole: (userId: string, householdId: string) => Promise<Role | null>;
  /** null when any of the four secrets is missing. */
  config: SignerConfig | null;
  now: () => Date;
};

export type Result = { status: number; body: Record<string, unknown> };

const fail = (status: number, error: string): Result => ({ status, body: { error } });

/** Ids end up as path segments: letters, digits and dashes only — no "/", no "..". */
export function isSafeSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
}

export function bearerToken(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match ? match[1] : null;
}

export type ParsedRequest = { photoId: string; op: Op; contentType: string | null; bytes: number | null };

export function parseRequest(body: unknown): ParsedRequest | null {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  if (!isSafeSegment(input.photo_id)) return null;
  if (input.op !== 'get' && input.op !== 'put' && input.op !== 'delete') return null;
  if (input.op !== 'put') {
    return { photoId: input.photo_id, op: input.op, contentType: null, bytes: null };
  }
  const contentType = typeof input.content_type === 'string' ? input.content_type.toLowerCase() : null;
  const bytes = typeof input.bytes === 'number' && Number.isInteger(input.bytes) ? input.bytes : null;
  if (!contentType || !(contentType in EXTENSION_FOR_MIME) || bytes === null || bytes <= 0 || bytes > MAX_PUT_BYTES) {
    return null;
  }
  return { photoId: input.photo_id, op: 'put', contentType, bytes };
}

/** <household_id>/<photo_id>/orig.<ext> — from database values only; null if anything is off. */
export function originalKey(photo: PhotoRecord): string | null {
  if (!isSafeSegment(photo.household_id) || !isSafeSegment(photo.id)) return null;
  const ext = EXTENSION_FOR_MIME[(photo.mime ?? '').toLowerCase()];
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return null;
  return `${photo.household_id}/${photo.id}/orig.${ext}`;
}

export function mayPerform(op: Op, role: Role | null): boolean {
  if (!role) return false;
  return op === 'get' ? true : WRITER_ROLES.includes(role);
}

const METHOD: Readonly<Record<Op, 'GET' | 'PUT' | 'DELETE'>> = { get: 'GET', put: 'PUT', delete: 'DELETE' };

export async function handleMediaSign(authorization: string | null, body: unknown, deps: Deps): Promise<Result> {
  const token = bearerToken(authorization);
  const userId = token ? await deps.userIdForToken(token) : null;
  if (!userId) return fail(401, 'not_signed_in');

  const request = parseRequest(body);
  if (!request) return fail(400, 'invalid_request');

  const photo = await deps.loadPhoto(request.photoId);
  if (!photo) return fail(404, 'photo_not_found');

  const role = await deps.loadRole(userId, photo.household_id);
  if (!mayPerform(request.op, role)) return fail(403, 'forbidden');

  const key = originalKey(photo);
  if (!key) return fail(400, 'unsupported_photo');

  // The upload is bound to the photo's OWN type from the database; a client
  // claiming another type is refused rather than trusted.
  if (request.op === 'put' && EXTENSION_FOR_MIME[request.contentType ?? ''] !== EXTENSION_FOR_MIME[(photo.mime ?? '').toLowerCase()]) {
    return fail(400, 'content_type_mismatch');
  }

  if (!deps.config) return fail(500, 'not_configured');

  const now = deps.now();
  const expiresSeconds = EXPIRES_SECONDS[request.op];
  // PUT binds BOTH type and exact size into the signature (2026-11-26): R2
  // recomputes the signature from the request's own Content-Type and
  // Content-Length, so an upload of any other size or type is refused with
  // 403 — the 50 MB check above is then enforced by R2 itself, not just
  // believed from the phone. The client must send exactly these headers.
  const headers: Record<string, string> =
    request.op === 'put'
      ? { 'content-type': request.contentType as string, 'content-length': String(request.bytes) }
      : {};
  const url = await presignUrl({
    method: METHOD[request.op],
    url: objectUrl(deps.config.endpoint, deps.config.bucket, key),
    region: 'auto',
    service: 's3',
    accessKeyId: deps.config.accessKeyId,
    secretAccessKey: deps.config.secretAccessKey,
    now,
    expiresSeconds,
    signedHeaders: headers,
  });

  return {
    status: 200,
    body: {
      url,
      method: METHOD[request.op],
      key,
      headers,
      expires_at: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    },
  };
}
