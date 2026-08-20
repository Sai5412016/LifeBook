/**
 * LifeBook guest album viewer.
 *
 * Renders the page; every decision about access is made by the Supabase Edge
 * Function `album`, which this file calls server-side. Deliberately holds NO
 * credentials: the token in the URL and the access code typed by the visitor
 * are the only secrets, and both are forwarded, never stored here.
 *
 * Why this page is not on Supabase (2026-08-15): Supabase refuses to serve
 * HTML from a *.supabase.co address and sandboxes the response, which killed
 * styles and cookies. Data is fine, pages are not. Hence this split.
 *
 * No framework and no dependencies on purpose — nothing to build, nothing to
 * break, and the whole viewer is one readable file.
 */

const API = 'https://qjoujiyzthzwkqhildub.supabase.co/functions/v1/album';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cookieName(token) {
  return 'lb_' + token.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => resolve(raw));
    req.on('error', () => resolve(''));
  });
}

async function callApi(token, payload, userAgent) {
  const response = await fetch(API + '/' + encodeURIComponent(token), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-viewer-agent': userAgent || '' },
    body: JSON.stringify(payload),
  });
  return response.json().catch(() => ({ status: 'unavailable' }));
}

const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  timeZone: 'Europe/Berlin',
});

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#FAF3E3; color:#3A2E26; line-height:1.5;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:780px; margin:0 auto; padding:28px 16px 72px; }
  h1 { font-size:1.6rem; margin:8px 0 4px; }
  .sub { color:#7A6A5E; font-size:.95rem; margin:0 0 28px; }
  .card { background:#fff; border-radius:16px; padding:24px;
    box-shadow:0 1px 3px rgba(58,46,38,.10); }
  label { display:block; font-size:.9rem; color:#7A6A5E; margin-bottom:8px; }
  input { width:100%; font-size:1.35rem; letter-spacing:.18em; text-align:center;
    padding:14px; border:1px solid #E4D9C6; border-radius:12px;
    background:#FDFAF3; color:#3A2E26; text-transform:uppercase; }
  button { width:100%; margin-top:16px; padding:14px; font-size:1rem; font-weight:600;
    color:#fff; background:#E9613A; border:0; border-radius:12px; cursor:pointer; }
  .error { color:#B03921; font-size:.9rem; margin-top:14px; }
  .day { margin:32px 0 10px; font-size:.95rem; font-weight:600; }
  .day span { color:#7A6A5E; font-weight:400; }
  figure { margin:0 0 16px; }
  img { width:100%; height:auto; display:block; border-radius:14px; background:#EFE6D5; }
  figcaption { margin-top:8px; font-size:.8rem; }
  figcaption a { color:#E9613A; text-decoration:none; }
  .note { display:block; color:#3A2E26; font-size:.95rem; margin-bottom:4px; }
  .foot { margin-top:48px; font-size:.82rem; color:#9A8B7E; text-align:center; }
`;

function sendPage(res, status, title, body) {
  const html = '<!doctype html><html lang="de"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">'
    + '<title>' + escapeHtml(title) + '</title>'
    + '<style>' + STYLE + '</style></head>'
    + '<body><div class="wrap">' + body + '</div></body></html>';
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, noimageindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

function unavailable(res) {
  sendPage(res, 404, 'Nicht verfügbar',
    '<h1>Nicht verfügbar</h1><p class="sub">Dieser Link ist nicht (mehr) gültig. '
    + 'Bitte frag die Person, die ihn dir geschickt hat.</p>');
}

function codeForm(res, name, message, status) {
  sendPage(res, status || 200, name,
    '<h1>' + escapeHtml(name) + '</h1>'
    + '<p class="sub">Bitte gib den Zugangscode ein, den du bekommen hast.</p>'
    + '<div class="card"><form method="post">'
    + '<label for="code">Zugangscode</label>'
    + '<input id="code" name="code" type="text" autocomplete="one-time-code" '
    + 'autocapitalize="characters" maxlength="12" required autofocus>'
    + '<button type="submit">Album öffnen</button>'
    + (message ? '<p class="error">' + escapeHtml(message) + '</p>' : '')
    + '</form></div>');
}

function gallery(res, data) {
  const photos = data.photos || [];
  let body = '<h1>' + escapeHtml(data.name) + '</h1><p class="sub">'
    + photos.length + (photos.length === 1 ? ' Foto' : ' Fotos') + ', privat geteilt.</p>';

  if (photos.length === 0) {
    body += '<p class="sub">Für dieses Album sind noch keine Fotos freigegeben.</p>';
  }

  // neueste zuerst, die Schnittstelle liefert aufsteigend
  const ordered = photos.slice().reverse();

  let lastDay = '';
  for (const photo of ordered) {
    const day = dayFormatter.format(new Date(photo.occurredAt));
    if (day !== lastDay) {
      body += '<p class="day">' + escapeHtml(day)
        + (photo.ageDays ? ' <span>· Tag ' + photo.ageDays + '</span>' : '') + '</p>';
      lastDay = day;
    }
    body += '<figure><img src="' + escapeHtml(photo.url) + '" alt="'
      + escapeHtml(photo.note || 'Foto') + '" loading="lazy">';
    if (photo.note || data.allowDownload) {
      body += '<figcaption>';
      if (photo.note) body += '<span class="note">' + escapeHtml(photo.note) + '</span>';
      if (data.allowDownload) {
        body += '<a href="' + escapeHtml(photo.url)
          + '" target="_blank" rel="noreferrer">Bild speichern</a>';
      }
      body += '</figcaption>';
    }
    body += '</figure>';
  }

  body += '<p class="foot">Privat geteilt. Bitte nicht weiterleiten.</p>';
  sendPage(res, 200, data.name, body);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    return sendPage(res, 200, 'LifeBook',
      '<h1>LifeBook</h1><p class="sub">Diese Seite zeigt private Fotoalben. '
      + 'Sie lässt sich nur über einen persönlichen Link öffnen.</p>');
  }
  if (parts[0] !== 'a' || !parts[1]) return unavailable(res);

  const token = parts[1];
  const name = cookieName(token);
  const userAgent = req.headers['user-agent'] || '';

  if (req.method === 'POST') {
    const raw = await readBody(req);
    const code = new URLSearchParams(raw).get('code') || '';
    const data = await callApi(token, { code }, userAgent);

    if (data.status === 'ok') {
      res.setHeader('Set-Cookie', name + '=' + encodeURIComponent(data.deviceSecret)
        + '; Path=/a/' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + COOKIE_MAX_AGE);
      return gallery(res, data);
    }
    if (data.status === 'invalid_code') return codeForm(res, data.name, 'Der Code stimmt nicht.', 401);
    if (data.status === 'locked') {
      return codeForm(res, data.name,
        'Zu viele Fehlversuche. Bitte versuch es in einigen Minuten noch einmal.', 429);
    }
    if (data.status === 'seats_full') {
      return sendPage(res, 403, data.name,
        '<h1>Alle Plätze vergeben</h1><p class="sub">Für dieses Album sind bereits alle '
        + 'Zugänge belegt. Bitte melde dich bei der Person, die dir den Link geschickt hat — '
        + 'sie kann einen Platz freigeben.</p>');
    }
    return unavailable(res);
  }

  const deviceSecret = readCookie(req, name);
  const data = await callApi(token, deviceSecret ? { deviceSecret } : {}, userAgent);

  if (data.status === 'ok') return gallery(res, data);
  if (data.status === 'code_required') return codeForm(res, data.name, null, 200);
  return unavailable(res);
};
