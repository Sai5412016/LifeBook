/**
 * album — JSON API behind the guest photo gallery.
 *
 * Called SERVER-SIDE by the viewer page (hosted on Vercel), never by a browser.
 * That keeps the whole trust chain here: the token, the access code, the device
 * limit and the signed image URLs never leave this function's control, and the
 * viewer needs no Supabase credentials of its own.
 *
 * Why JSON and not HTML (2026-08-15): Supabase deliberately refuses to serve
 * HTML from a *.supabase.co address — the response is delivered sandboxed with
 * `default-src 'none'`, so no styles, no cookies, no origin. Confirmed on the
 * device: raw source, mangled umlauts, blocked cookies. Serving data is fine.
 * Do NOT move HTML rendering back in here.
 *
 * Deliberate decisions:
 *  - Only the medium rendition is ever exposed. Originals carry embedded
 *    capture data including GPS, and never leave the bucket.
 *  - Signed URLs are minted per request with a short lifetime.
 *  - Every "you may not see this" case answers `unavailable`, so the caller
 *    cannot tell a wrong token from a revoked or expired one.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_CODE_ATTEMPTS = 10;
const LOCK_MINUTES = 15;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(payload: unknown, status = 200): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(payload), { status, headers });
}

/** Length-independent comparison, so timing cannot reveal the code. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function randomSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ShareRow {
  id: string;
  household_id: string;
  name: string;
  access_code: string;
  device_limit: number;
  allow_download: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  failed_code_attempts: number;
  locked_until: string | null;
  view_count: number;
}

async function loadShare(token: string): Promise<ShareRow | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await admin
    .from('shares')
    .select(
      'id, household_id, name, access_code, device_limit, allow_download, expires_at, revoked_at, failed_code_attempts, locked_until, view_count',
    )
    .eq('token', token)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const share = data[0] as ShareRow;
  if (share.revoked_at) return null;
  if (share.expires_at && Date.parse(share.expires_at) < Date.now()) return null;
  return share;
}

async function buildPhotoList(share: ShareRow) {
  const { data: links } = await admin
    .from('share_photos').select('photo_id').eq('share_id', share.id);
  const photoIds = (links ?? []).map((row) => row.photo_id as string);
  if (photoIds.length === 0) return [];

  const { data: photos } = await admin
    .from('photos')
    .select('id, occurred_at, medium_key, note')
    .in('id', photoIds)
    .is('deleted_at', null)
    .not('medium_key', 'is', null)
    .order('occurred_at', { ascending: true });
  const rows = photos ?? [];
  if (rows.length === 0) return [];

  const { data: children } = await admin
    .from('children').select('birth_at')
    .eq('household_id', share.household_id).is('deleted_at', null).limit(1);
  const birthAt = children?.[0]?.birth_at ?? null;

  const { data: signed } = await admin.storage
    .from('photos')
    .createSignedUrls(rows.map((row) => row.medium_key as string), SIGNED_URL_TTL_SECONDS);

  const urlByKey = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByKey.set(entry.path, entry.signedUrl);
  }

  return rows.flatMap((row) => {
    const url = urlByKey.get(row.medium_key as string);
    if (!url) return [];
    const occurredAt = row.occurred_at as string;
    let ageDays: number | null = null;
    if (birthAt) {
      const days = Math.floor((Date.parse(occurredAt) - Date.parse(birthAt)) / 86_400_000);
      ageDays = days >= 0 ? days + 1 : null;
    }
    return [{ url, occurredAt, ageDays, note: (row.note as string | null) ?? null }];
  });
}

async function okResponse(share: ShareRow, deviceSecret: string) {
  const photos = await buildPhotoList(share);
  const now = new Date().toISOString();
  // Bookkeeping last and failures ignored: it must never keep a legitimate
  // visitor out of the album.
  try {
    await admin.from('shares')
      .update({ view_count: share.view_count + 1, last_viewed_at: now })
      .eq('id', share.id);
    await admin.from('share_devices')
      .update({ last_seen_at: now })
      .eq('share_id', share.id).eq('device_secret', deviceSecret);
  } catch { /* intentionally ignored */ }

  return json({
    status: 'ok',
    name: share.name,
    allowDownload: share.allow_download,
    deviceSecret,
    photos,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ status: 'unavailable' }, 405);

  const url = new URL(request.url);
  const token = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const share = await loadShare(token);
  if (!share) return json({ status: 'unavailable' }, 404);

  const body = await request.json().catch(() => ({})) as {
    deviceSecret?: string;
    code?: string;
  };

  // Known device? Straight in.
  if (body.deviceSecret) {
    const { data: device } = await admin
      .from('share_devices').select('id')
      .eq('share_id', share.id).eq('device_secret', body.deviceSecret).limit(1);
    if (device && device.length > 0) return await okResponse(share, body.deviceSecret);
  }

  if (!body.code) return json({ status: 'code_required', name: share.name });

  if (share.locked_until && Date.parse(share.locked_until) > Date.now()) {
    return json({ status: 'locked', name: share.name });
  }

  const entered = body.code.trim().toUpperCase();
  if (!constantTimeEquals(entered, share.access_code.trim().toUpperCase())) {
    const attempts = share.failed_code_attempts + 1;
    const locked = attempts >= MAX_CODE_ATTEMPTS;
    await admin.from('shares').update({
      failed_code_attempts: locked ? 0 : attempts,
      locked_until: locked
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
        : share.locked_until,
    }).eq('id', share.id);
    return json({ status: locked ? 'locked' : 'invalid_code', name: share.name });
  }

  const { count } = await admin
    .from('share_devices').select('id', { count: 'exact', head: true })
    .eq('share_id', share.id);
  if ((count ?? 0) >= share.device_limit) {
    return json({ status: 'seats_full', name: share.name });
  }

  const newSecret = randomSecret();
  const { error: insertError } = await admin.from('share_devices').insert({
    share_id: share.id,
    device_secret: newSecret,
    user_agent: (request.headers.get('x-viewer-agent') ?? '').slice(0, 200),
  });
  if (insertError) return json({ status: 'unavailable' }, 500);

  await admin.from('shares')
    .update({ failed_code_attempts: 0, locked_until: null })
    .eq('id', share.id);

  return await okResponse(share, newSecret);
});
