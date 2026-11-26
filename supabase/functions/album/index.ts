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
/** Background music for the album page, in the private `assets` bucket. */
const MUSIC_KEY = 'marina.mp3';
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
  kind: string;
  show_living_details: boolean;
  allow_suggestions: boolean;
  announcement: string | null;
  announcement_at: string | null;
}

async function loadShare(token: string): Promise<ShareRow | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await admin
    .from('shares')
    .select(
      'id, household_id, name, access_code, device_limit, allow_download, expires_at, revoked_at, failed_code_attempts, locked_until, view_count, kind, show_living_details, allow_suggestions, announcement, announcement_at',
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

async function countAddedSince(shareId: string, since: string | null): Promise<number> {
  if (!since) return 0;
  const { count } = await admin
    .from('share_photos')
    .select('photo_id', { count: 'exact', head: true })
    .eq('share_id', shareId)
    .gt('added_at', since);
  return count ?? 0;
}

/**
 * The family tree as data — never as a picture. Layout and drawing belong to
 * the viewer; what belongs HERE is the decision about what a guest may see.
 *
 * Privacy rule (2026-08-23): a shared tree leaves the household, so by default
 * the living appear with their name and nothing else — no portrait, no dates.
 * The dead are shown in full; they are the ones relatives can help with. The
 * share's own switch `show_living_details` lifts this deliberately.
 */
async function buildTree(share: ShareRow) {
  const { data: rows } = await admin
    .from('relatives')
    .select('id, child_id, given_name, family_name, birth_name, gender, born_on, died_on, deceased, photo_key, sort_index')
    .eq('household_id', share.household_id)
    .is('deleted_at', null)
    .order('sort_index', { ascending: true });
  const people = rows ?? [];
  if (people.length === 0) return null;

  const { data: unionRows } = await admin
    .from('relative_unions')
    .select('a_id, b_id')
    .eq('household_id', share.household_id)
    .is('deleted_at', null);

  const { data: linkRows } = await admin
    .from('relatives')
    .select('id, mother_id, father_id')
    .eq('household_id', share.household_id)
    .is('deleted_at', null);
  const parents = new Map<string, { mother: string | null; father: string | null }>();
  for (const row of linkRows ?? []) {
    parents.set(row.id as string, {
      mother: (row.mother_id as string | null) ?? null,
      father: (row.father_id as string | null) ?? null,
    });
  }

  const showAll = share.show_living_details === true;
  const wanted = people.filter((p) => showAll || p.deceased === true)
    .map((p) => p.photo_key as string | null)
    .filter((k): k is string => typeof k === 'string' && k.length > 0);

  const urlByKey = new Map<string, string>();
  if (wanted.length > 0) {
    const { data: signed } = await admin.storage
      .from('photos').createSignedUrls(wanted, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) urlByKey.set(entry.path, entry.signedUrl);
    }
  }

  const nodes = people.map((p) => {
    const open = showAll || p.deceased === true;
    const link = parents.get(p.id as string) ?? { mother: null, father: null };
    const key = p.photo_key as string | null;
    return {
      id: p.id as string,
      isRoot: p.child_id !== null,
      givenName: p.given_name as string,
      familyName: (p.family_name as string | null) ?? null,
      gender: (p.gender as string | null) ?? null,
      birthName: open ? ((p.birth_name as string | null) ?? null) : null,
      bornOn: open ? ((p.born_on as string | null) ?? null) : null,
      diedOn: open ? ((p.died_on as string | null) ?? null) : null,
      deceased: p.deceased === true,
      photoUrl: open && key ? (urlByKey.get(key) ?? null) : null,
      motherId: link.mother,
      fatherId: link.father,
    };
  });

  return {
    nodes,
    unions: (unionRows ?? []).map((u) => ({ a: u.a_id as string, b: u.b_id as string })),
    showLivingDetails: showAll,
  };
}

/**
 * The song is signed per request like the photos are. It lives in a PRIVATE
 * bucket on purpose: a public URL would put a commercial recording on an
 * openly reachable address, which this family album has no business doing.
 * Failure is silent — no music is a blemish, not a reason to withhold photos.
 */
async function signedMusicUrl(): Promise<string | null> {
  try {
    const { data } = await admin.storage
      .from('assets').createSignedUrl(MUSIC_KEY, SIGNED_URL_TTL_SECONDS);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * What changed in the tree since this visitor was last here. Guests have no
 * app and no push, so the page itself has to say what is new — otherwise a
 * relative who already looked once has no reason to look again.
 */
async function treeNewsSince(share: ShareRow, since: string | null) {
  if (!since) return null;
  const { count: added } = await admin
    .from('relatives').select('id', { count: 'exact', head: true })
    .eq('household_id', share.household_id).is('deleted_at', null)
    .gt('created_at', since);
  const { count: touched } = await admin
    .from('relatives').select('id', { count: 'exact', head: true })
    .eq('household_id', share.household_id).is('deleted_at', null)
    .gt('updated_at', since).lte('created_at', since);
  const news = { added: added ?? 0, changed: touched ?? 0 };
  return news.added || news.changed ? news : null;
}

async function okResponse(
  share: ShareRow,
  deviceSecret: string,
  previousSeenAt: string | null,
  suggestionSaved = false,
) {
  const isTree = share.kind === 'tree';
  const photos = isTree ? [] : await buildPhotoList(share);
  const tree = isTree ? await buildTree(share) : null;
  const treeNews = isTree ? await treeNewsSince(share, previousSeenAt) : null;
  // Shown only when it was published after this visitor was last here.
  const announcement = share.announcement && share.announcement_at
    && (!previousSeenAt || Date.parse(share.announcement_at) > Date.parse(previousSeenAt))
    ? share.announcement : null;
  const musicUrl = await signedMusicUrl();
  // Counted BEFORE last_seen_at is refreshed below — afterwards it would
  // always be zero.
  const newSince = await countAddedSince(share.id, previousSeenAt);
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
    kind: share.kind,
    name: share.name,
    allowDownload: share.allow_download,
    allowSuggestions: share.allow_suggestions === true,
    suggestionSaved,
    deviceSecret,
    newSince,
    musicUrl,
    photos,
    tree,
    treeNews,
    announcement,
  });
}

const HOME_COUNTRY = 'DE';
const HOME_REGION = 'BY';

/**
 * Push an alert to BOTH parents when a guest device is redeemed from outside
 * Bavaria. Sent from here rather than through notify-household because that
 * function needs a caller JWT and deliberately skips the caller — here there is
 * no logged-in caller and everyone should be told.
 */
async function alertUnexpectedOrigin(
  share: ShareRow,
  place: { country: string; region: string; city: string },
) {
  if (place.country === HOME_COUNTRY && place.region === HOME_REGION) return;

  const where = [place.city, place.region, place.country].filter(Boolean).join(', ');
  const { data: members } = await admin
    .from('household_members').select('user_id')
    .eq('household_id', share.household_id).is('deleted_at', null);
  const userIds = (members ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return;

  const { data: tokens } = await admin
    .from('push_tokens').select('token').in('user_id', userIds);
  if (!tokens || tokens.length === 0) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokens.slice(0, 100).map((t) => ({
      to: t.token,
      title: 'Zugriff von ungewohntem Ort',
      body: `Ein neues Gerät hat "${share.name}" geöffnet — ${where || 'Ort unbekannt'}.`,
      sound: 'default',
      data: { kind: 'share_access', shareId: share.id },
    }))),
  }).catch(() => undefined);
}

/** Tell both parents something happened. Failure is never the guest's problem. */
async function notifyHousehold(householdId: string, title: string, body: string) {
  const { data: members } = await admin
    .from('household_members').select('user_id')
    .eq('household_id', householdId).is('deleted_at', null);
  const userIds = (members ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return;
  const { data: tokens } = await admin
    .from('push_tokens').select('token').in('user_id', userIds);
  if (!tokens || tokens.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokens.slice(0, 100).map((t) => ({
      to: t.token, title, body, sound: 'default', data: { kind: 'tree_suggestion' },
    }))),
  }).catch(() => undefined);
}

const MAX_OPEN_SUGGESTIONS = 100;
const SUGGESTIONS_BUCKET = 'suggestions';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** One guest device may park this many not-yet-reviewed pictures. */
const MAX_PHOTOS_PER_DEVICE = 20;
const PHOTO_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Hand out a one-time upload address for ONE picture.
 *
 * Why the browser uploads straight to Supabase and not through the viewer:
 * Vercel functions refuse a request body over 4.5 MB, and a phone photo is
 * routinely 5-8 MB. Going through the viewer would fail on exactly the files
 * people actually want to send. Measured, not assumed (2026-08-23).
 *
 * The guest never chooses the path. Share and device come from the secret they
 * already hold, so nobody can write into someone else's folder or overwrite an
 * existing picture.
 */
async function signedPhotoUpload(
  share: ShareRow,
  deviceId: string,
  mime: unknown,
  bytes: unknown,
): Promise<{ uploadUrl: string; key: string } | null> {
  if (share.kind !== 'tree' || share.allow_suggestions !== true) return null;
  const ext = PHOTO_MIME_EXT[String(mime ?? '')];
  if (!ext) return null;
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) return null;

  const dir = `${share.id}/${deviceId}`;
  const { data: existing } = await admin.storage
    .from(SUGGESTIONS_BUCKET).list(dir, { limit: MAX_PHOTOS_PER_DEVICE + 1 });
  if ((existing?.length ?? 0) >= MAX_PHOTOS_PER_DEVICE) return null;

  const key = `${dir}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage
    .from(SUGGESTIONS_BUCKET).createSignedUploadUrl(key);
  if (error || !data?.signedUrl) return null;
  return { uploadUrl: data.signedUrl, key };
}

/**
 * A key is only accepted once the file is really lying in the bucket, and only
 * inside this device's own folder. Size and type are read back from storage
 * rather than believed from the form — the browser can claim anything.
 */
async function confirmedPhoto(
  share: ShareRow,
  deviceId: string,
  key: unknown,
): Promise<{ key: string; bytes: number | null; mime: string | null } | null> {
  if (typeof key !== 'string' || !key) return null;
  const dir = `${share.id}/${deviceId}/`;
  if (!key.startsWith(dir) || key.includes('..')) return null;

  const name = key.slice(dir.length);
  if (!name || name.includes('/')) return null;

  const { data } = await admin.storage
    .from(SUGGESTIONS_BUCKET).list(`${share.id}/${deviceId}`, { search: name, limit: 2 });
  const hit = (data ?? []).find((o) => o.name === name);
  if (!hit) return null;

  const meta = (hit.metadata ?? {}) as Record<string, unknown>;
  const size = Number(meta.size);
  const mime = typeof meta.mimetype === 'string' ? meta.mimetype : null;
  if (Number.isFinite(size) && size > MAX_PHOTO_BYTES) {
    await admin.storage.from(SUGGESTIONS_BUCKET).remove([key]);
    return null;
  }
  if (mime && !PHOTO_MIME_EXT[mime]) {
    await admin.storage.from(SUGGESTIONS_BUCKET).remove([key]);
    return null;
  }
  return { key, bytes: Number.isFinite(size) ? size : null, mime };
}

const SUGGESTION_FIELDS = [
  'given_name', 'family_name', 'birth_name', 'gender',
  'born_on', 'born_place', 'died_on', 'died_place',
  'mother_id', 'father_id', 'message',
] as const;

/**
 * A guest proposes; nobody but the household ever writes to `relatives`. Every
 * value lands here as plain text, length-capped, and is reviewed in the app.
 * The device must already be known — the access code alone is not enough.
 */
async function saveSuggestion(
  share: ShareRow,
  deviceId: string,
  visitorName: string | null,
  input: Record<string, unknown>,
): Promise<boolean> {
  if (share.kind !== 'tree' || share.allow_suggestions !== true) return false;

  const { count } = await admin
    .from('tree_suggestions').select('id', { count: 'exact', head: true })
    .eq('share_id', share.id).eq('status', 'open');
  if ((count ?? 0) >= MAX_OPEN_SUGGESTIONS) return false;

  const kind = String(input.kind ?? 'note');
  if (kind !== 'add' && kind !== 'edit' && kind !== 'note') return false;

  const row: Record<string, unknown> = {
    household_id: share.household_id,
    share_id: share.id,
    device_id: deviceId,
    visitor_name: visitorName,
    kind,
    relative_id: kind === 'edit' ? (String(input.relative_id ?? '') || null) : null,
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  for (const field of SUGGESTION_FIELDS) {
    const raw = input[field];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, field === 'message' ? 2000 : 120);
    if (value) row[field] = value;
  }
  if (typeof input.deceased === 'boolean') row.deceased = input.deceased;

  const photo = await confirmedPhoto(share, deviceId, input.photo_key);
  if (photo) {
    row.photo_key = photo.key;
    row.photo_bytes = photo.bytes;
    row.photo_mime = photo.mime;
  }

  const hasContent = SUGGESTION_FIELDS.some((f) => typeof row[f] === 'string')
    || typeof row.deceased === 'boolean'
    || photo !== null;
  if (!hasContent) return false;

  const { error } = await admin.from('tree_suggestions').insert(row);
  if (error) return false;

  const who = visitorName ? visitorName : 'Jemand';
  const base = kind === 'add' ? 'schlägt eine neue Person vor'
    : kind === 'edit' ? 'schlägt eine Änderung vor'
    : 'hat eine Nachricht hinterlassen';
  const what = photo ? `${base} und hat ein Foto mitgeschickt` : base;
  await notifyHousehold(
    share.household_id,
    'Neuer Vorschlag zum Stammbaum',
    `${who} ${what} („${share.name}").`,
  ).catch(() => undefined);
  return true;
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
    visitorName?: string;
    suggestion?: Record<string, unknown>;
    photoUpload?: { mime?: unknown; bytes?: unknown };
  };

  // Known device? Straight in.
  if (body.deviceSecret) {
    const { data: device } = await admin
      .from('share_devices').select('id, last_seen_at, visitor_name')
      .eq('share_id', share.id).eq('device_secret', body.deviceSecret).limit(1);
    if (device && device.length > 0) {
      // Asking for an upload address is its own short answer — no album, no
      // tree, nothing else rebuilt for it.
      if (body.photoUpload) {
        const grant = await signedPhotoUpload(
          share, device[0].id as string, body.photoUpload.mime, body.photoUpload.bytes,
        );
        return grant
          ? json({ status: 'upload', uploadUrl: grant.uploadUrl, key: grant.key })
          : json({ status: 'upload_refused' }, 400);
      }
      let saved = false;
      if (body.suggestion) {
        saved = await saveSuggestion(
          share,
          device[0].id as string,
          (device[0].visitor_name as string | null) ?? null,
          body.suggestion,
        );
      }
      return await okResponse(
        share, body.deviceSecret, device[0].last_seen_at ?? null, saved,
      );
    }
  }

  if (!body.code) return json({ status: 'code_required', name: share.name, kind: share.kind });

  if (share.locked_until && Date.parse(share.locked_until) > Date.now()) {
    return json({ status: 'locked', name: share.name, kind: share.kind });
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
    return json({ status: locked ? 'locked' : 'invalid_code', name: share.name, kind: share.kind });
  }

  const visitor = (body.visitorName ?? '').trim().slice(0, 40);
  const agent = (request.headers.get('x-viewer-agent') ?? '').slice(0, 200);

  // Same person, same browser, code entered again? Reuse the seat instead of
  // burning a second one. Observed on 2026-08-23: a guest tapped the button
  // three times in three seconds and used up three of ten places. A seat
  // belongs to a PERSON, not to a tap.
  if (visitor) {
    const { data: known } = await admin
      .from('share_devices').select('device_secret, last_seen_at')
      .eq('share_id', share.id).eq('user_agent', agent)
      .ilike('visitor_name', visitor).limit(1);
    if (known && known.length > 0) {
      return await okResponse(
        share, known[0].device_secret as string, known[0].last_seen_at ?? null,
      );
    }
  }

  const { count } = await admin
    .from('share_devices').select('id', { count: 'exact', head: true })
    .eq('share_id', share.id);
  if ((count ?? 0) >= share.device_limit) {
    return json({ status: 'seats_full', name: share.name, kind: share.kind });
  }

  const newSecret = randomSecret();
  const place = {
    country: (request.headers.get('x-viewer-country') ?? '').slice(0, 8),
    region: (request.headers.get('x-viewer-region') ?? '').slice(0, 8),
    city: (request.headers.get('x-viewer-city') ?? '').slice(0, 64),
  };
  const { error: insertError } = await admin.from('share_devices').insert({
    share_id: share.id,
    device_secret: newSecret,
    user_agent: agent,
    // Not a second lock — the names are printed on the very page it would
    // protect. It is a name tag, so the device list reads "Rosi".
    visitor_name: visitor || null,
    geo_country: place.country || null,
    geo_region: place.region || null,
    geo_city: place.city || null,
  });
  if (insertError) return json({ status: 'unavailable' }, 500);

  // Alerting must never block the visitor.
  await alertUnexpectedOrigin(share, place).catch(() => undefined);

  await admin.from('shares')
    .update({ failed_code_attempts: 0, locked_until: null })
    .eq('id', share.id);

  // First visit of this device: everything is new, so no counter.
  return await okResponse(share, newSecret, null);
});
