/**
 * album — public read-only photo gallery for a share.
 *
 * Reached at  https://<project>.supabase.co/functions/v1/album/<token>
 *
 * This is the ONLY function in this project that runs without a JWT: the token
 * in the URL is the credential, and the access code is the second factor. It
 * therefore has to be defensive about everything it touches.
 *
 * Deliberate decisions:
 *  - Serves ONLY the medium rendition. Originals carry embedded capture data,
 *    including GPS coordinates of the hospital. They never leave the bucket.
 *  - Signed URLs are minted per request with a short lifetime. Nobody ever
 *    receives a permanently valid address.
 *  - A device is remembered through an HttpOnly cookie scoped to this one
 *    share's path, so one share's cookie can never unlock another.
 *  - Wrong-code attempts are counted and lock the share temporarily. Without
 *    that, a six-character code is guessable.
 *  - No analytics, no third-party scripts, no fonts from a CDN. The only cookie
 *    is the strictly necessary session one, which is why no consent banner is
 *    needed.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const MAX_CODE_ATTEMPTS = 10;
const LOCK_MINUTES = 15;
const COOKIE_NAME = 'lb_album';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- helpers

const BASE_HEADERS: HeadersInit = {
  'content-type': 'text/html; charset=utf-8',
  // Both the header and the meta tag below: search engines honour different
  // ones, and half the protection is no protection.
  'x-robots-tag': 'noindex, nofollow, noarchive, noimageindex',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Length-independent comparison, so timing cannot reveal the code. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function randomSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const GERMAN_WEEKDAYS = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
];
const GERMAN_MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  return `${GERMAN_WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()}. ${GERMAN_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function ageInDays(birthIso: string | null, photoIso: string): number | null {
  if (!birthIso) return null;
  const birth = Date.parse(birthIso);
  const taken = Date.parse(photoIso);
  if (Number.isNaN(birth) || Number.isNaN(taken)) return null;
  const days = Math.floor((taken - birth) / 86_400_000);
  return days >= 0 ? days + 1 : null;
}

// ------------------------------------------------------------------ pages

function page(title: string, body: string, status = 200, extraHeaders: HeadersInit = {}) {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    background: #FAF3E3; color: #3A2E26;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  .wrap { max-width: 780px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 8px 0 4px; font-weight: 700; }
  .sub { color: #7A6A5E; font-size: .95rem; margin: 0 0 28px; }
  .card {
    background: #fff; border-radius: 16px; padding: 24px;
    box-shadow: 0 1px 3px rgba(58,46,38,.10);
  }
  label { display: block; font-size: .9rem; color: #7A6A5E; margin-bottom: 8px; }
  input[type=text] {
    width: 100%; font-size: 1.35rem; letter-spacing: .18em; text-align: center;
    padding: 14px; border: 1px solid #E4D9C6; border-radius: 12px;
    background: #FDFAF3; color: #3A2E26; text-transform: uppercase;
  }
  button {
    width: 100%; margin-top: 16px; padding: 14px;
    font-size: 1rem; font-weight: 600; color: #fff; background: #E9613A;
    border: 0; border-radius: 12px; cursor: pointer;
  }
  .error { color: #B0392180; color: #B03921; font-size: .9rem; margin-top: 14px; }
  .day { margin: 32px 0 10px; font-size: .95rem; font-weight: 600; }
  .day span { color: #7A6A5E; font-weight: 400; }
  figure { margin: 0 0 14px; }
  img { width: 100%; height: auto; display: block; border-radius: 14px; background: #EFE6D5; }
  .foot { margin-top: 48px; font-size: .82rem; color: #9A8B7E; text-align: center; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
  return new Response(html, {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/** One neutral page for every "you may not see this" case — it must not reveal
 *  whether a token exists, is revoked or expired. */
function unavailablePage() {
  return page(
    'Nicht verfügbar',
    `<h1>Nicht verfügbar</h1>
     <p class="sub">Dieser Link ist nicht (mehr) gültig. Bitte frag die Person, die ihn dir geschickt hat.</p>`,
    404,
  );
}

function codePage(shareName: string, message: string | null, status = 200) {
  return page(
    shareName,
    `<h1>${escapeHtml(shareName)}</h1>
     <p class="sub">Bitte gib den Zugangscode ein, den du bekommen hast.</p>
     <div class="card">
       <form method="post">
         <label for="code">Zugangscode</label>
         <input id="code" name="code" type="text" autocomplete="one-time-code"
                inputmode="latin" autocapitalize="characters" maxlength="12" required autofocus>
         <button type="submit">Album öffnen</button>
         ${message ? `<p class="error">${escapeHtml(message)}</p>` : ''}
       </form>
     </div>`,
    status,
  );
}

function seatsFullPage(shareName: string) {
  return page(
    shareName,
    `<h1>Alle Plätze vergeben</h1>
     <p class="sub">Für dieses Album sind bereits alle Zugänge belegt. Bitte melde dich
     bei der Person, die dir den Link geschickt hat — sie kann einen Platz freigeben.</p>`,
    403,
  );
}

// ------------------------------------------------------------------ logic

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

async function renderGallery(share: ShareRow, deviceSecret: string): Promise<Response> {
  const { data: links } = await admin
    .from('share_photos')
    .select('photo_id')
    .eq('share_id', share.id);

  const photoIds = (links ?? []).map((row) => row.photo_id as string);

  if (photoIds.length === 0) {
    return page(
      share.name,
      `<h1>${escapeHtml(share.name)}</h1>
       <p class="sub">Für dieses Album sind noch keine Fotos freigegeben.</p>`,
    );
  }

  const { data: photos } = await admin
    .from('photos')
    .select('id, occurred_at, medium_key, note')
    .in('id', photoIds)
    .is('deleted_at', null)
    .not('medium_key', 'is', null)
    .order('occurred_at', { ascending: true });

  const rows = photos ?? [];

  const { data: children } = await admin
    .from('children')
    .select('birth_at')
    .eq('household_id', share.household_id)
    .is('deleted_at', null)
    .limit(1);
  const birthAt = children?.[0]?.birth_at ?? null;

  const keys = rows.map((row) => row.medium_key as string);
  const { data: signed } = await admin.storage
    .from('photos')
    .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);

  const urlByKey = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByKey.set(entry.path, entry.signedUrl);
  }

  let body = `<h1>${escapeHtml(share.name)}</h1>
    <p class="sub">${rows.length} ${rows.length === 1 ? 'Foto' : 'Fotos'}, privat geteilt.</p>`;

  let lastDay = '';
  for (const row of rows) {
    const occurredAt = row.occurred_at as string;
    const day = formatDayLabel(occurredAt);
    if (day !== lastDay) {
      const age = ageInDays(birthAt, occurredAt);
      body += `<p class="day">${escapeHtml(day)}${age ? ` <span>· Tag ${age}</span>` : ''}</p>`;
      lastDay = day;
    }
    const url = urlByKey.get(row.medium_key as string);
    if (!url) continue;
    const alt = row.note ? escapeHtml(row.note as string) : 'Foto';
    body += `<figure><img src="${escapeHtml(url)}" alt="${alt}" loading="lazy"></figure>`;
  }

  body += `<p class="foot">Privat geteilt. Bitte nicht weiterleiten.</p>`;

  // Housekeeping last, and failures are swallowed on purpose: a bookkeeping
  // problem must never keep a legitimate visitor out of the album.
  const now = new Date().toISOString();
  try {
    await admin
      .from('shares')
      .update({ view_count: share.view_count + 1, last_viewed_at: now })
      .eq('id', share.id);
    await admin
      .from('share_devices')
      .update({ last_seen_at: now })
      .eq('share_id', share.id)
      .eq('device_secret', deviceSecret);
  } catch {
    // intentionally ignored — see comment above
  }

  return page(share.name, body);
}

// ----------------------------------------------------------------- routing

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const token = url.pathname.split('/').filter(Boolean).pop() ?? '';

  if (!token || token === 'album') return unavailablePage();

  const share = await loadShare(token);
  if (!share) return unavailablePage();

  const cookiePath = url.pathname;
  const deviceSecret = readCookie(request, COOKIE_NAME);

  // Known device? Straight in.
  if (deviceSecret) {
    const { data: device } = await admin
      .from('share_devices')
      .select('id')
      .eq('share_id', share.id)
      .eq('device_secret', deviceSecret)
      .limit(1);

    if (device && device.length > 0) {
      return await renderGallery(share, deviceSecret);
    }
  }

  if (request.method !== 'POST') {
    return codePage(share.name, null);
  }

  // Locked out after too many wrong attempts?
  if (share.locked_until && Date.parse(share.locked_until) > Date.now()) {
    return codePage(
      share.name,
      'Zu viele Fehlversuche. Bitte versuch es in einigen Minuten noch einmal.',
      429,
    );
  }

  const form = await request.formData().catch(() => null);
  const entered = String(form?.get('code') ?? '').trim().toUpperCase();

  if (!constantTimeEquals(entered, share.access_code.trim().toUpperCase())) {
    const attempts = share.failed_code_attempts + 1;
    const locked = attempts >= MAX_CODE_ATTEMPTS;
    await admin
      .from('shares')
      .update({
        failed_code_attempts: locked ? 0 : attempts,
        locked_until: locked
          ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
          : share.locked_until,
      })
      .eq('id', share.id);

    return codePage(
      share.name,
      locked
        ? 'Zu viele Fehlversuche. Bitte versuch es in einigen Minuten noch einmal.'
        : 'Der Code stimmt nicht.',
      401,
    );
  }

  // Correct code — is there a free seat?
  const { count } = await admin
    .from('share_devices')
    .select('id', { count: 'exact', head: true })
    .eq('share_id', share.id);

  if ((count ?? 0) >= share.device_limit) {
    return seatsFullPage(share.name);
  }

  const newSecret = randomSecret();
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 200);

  const { error: insertError } = await admin.from('share_devices').insert({
    share_id: share.id,
    device_secret: newSecret,
    user_agent: userAgent,
  });
  if (insertError) return unavailablePage();

  await admin
    .from('shares')
    .update({ failed_code_attempts: 0, locked_until: null, last_viewed_at: new Date().toISOString() })
    .eq('id', share.id);

  const response = await renderGallery(share, newSecret);
  response.headers.append(
    'set-cookie',
    `${COOKIE_NAME}=${encodeURIComponent(newSecret)}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  );
  return response;
});
