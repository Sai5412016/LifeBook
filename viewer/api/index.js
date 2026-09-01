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
 *
 * Before deploying, run `node smoke.js`. A free identifier only explodes when
 * the line RUNS, and on 2026-08-23 exactly that put the album on HTTP 500 for
 * seventeen hours. `node --check` cannot see it; the smoke test calls it.
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

async function callApi(token, payload, req) {
  // Vercel's edge geo headers, forwarded so the API can record roughly where a
  // guest device was first used and warn about anything outside Bavaria. The
  // IP itself is never forwarded or stored.
  const response = await fetch(API + '/' + encodeURIComponent(token), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viewer-agent': req.headers['user-agent'] || '',
      'x-viewer-country': req.headers['x-vercel-ip-country'] || '',
      'x-viewer-region': req.headers['x-vercel-ip-country-region'] || '',
      'x-viewer-city': req.headers['x-vercel-ip-city'] || '',
    },
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
  .fresh { background:#fff; border-left:4px solid #E9613A; border-radius:10px;
    padding:12px 14px; margin:0 0 24px; font-weight:600; }
  .foot { margin-top:48px; font-size:.82rem; color:#9A8B7E; text-align:center; }
  .music { position:fixed; right:14px; bottom:14px; z-index:5; width:auto; margin:0;
    display:inline-flex; align-items:center; gap:8px; padding:11px 17px;
    font-size:.9rem; font-weight:600; color:#3A2E26; background:#fff;
    border:1px solid #E4D9C6; border-radius:999px; cursor:pointer;
    box-shadow:0 2px 10px rgba(58,46,38,.18); }
  .music span:first-child { color:#E9613A; }
  input.plain { font-size:1.05rem; letter-spacing:normal; text-align:left;
    text-transform:none; }
  label.spaced { margin-top:18px; }
  .canvas { overflow:auto; -webkit-overflow-scrolling:touch; max-height:74vh;
    background:#fff; border-radius:16px; padding:12px 8px;
    box-shadow:0 1px 3px rgba(58,46,38,.10); }
  /* The drawing keeps its own size and the box scrolls. Fitting four
     generations into a phone width would shrink the names to nothing. */
  .canvas svg { display:block; max-width:none; }
  .legend { display:flex; gap:18px; flex-wrap:wrap; margin:16px 0 0;
    font-size:.82rem; color:#7A6A5E; }
  .legend i { display:inline-block; width:12px; height:12px; border-radius:50%;
    margin-right:6px; vertical-align:-1px; }
  .ask { background:#fff; border-left:4px solid #E9613A; border-radius:10px;
    padding:14px 16px; margin:22px 0 0; font-size:.92rem; }
  .done { background:#fff; border-left:4px solid #4E7A52; border-radius:10px;
    padding:14px 16px; margin:0 0 24px; font-weight:600; }
  details { margin-top:22px; background:#fff; border-radius:16px;
    box-shadow:0 1px 3px rgba(58,46,38,.10); }
  summary { padding:18px 20px; font-weight:600; cursor:pointer; }
  .form { padding:0 20px 22px; }
  .form label { margin-top:16px; }
  .form input, .form select, .form textarea { width:100%; font-size:1rem;
    letter-spacing:normal; text-align:left; text-transform:none; padding:12px;
    border:1px solid #E4D9C6; border-radius:10px; background:#FDFAF3;
    color:#3A2E26; font-family:inherit; }
  .form input[type=file] { padding:10px; font-size:.92rem; }
  .form textarea { min-height:90px; }
  .row { display:flex; align-items:center; gap:10px; margin-top:16px; }
  .row input { width:auto; }
  .row label { margin:0; color:#3A2E26; }
  .hint { font-size:.84rem; color:#7A6A5E; margin:8px 0 0; }
  .canvas.fit svg { width:100%; height:auto; }
  .tools { display:flex; gap:10px; margin:14px 0 0; }
  .tools button { width:auto; margin:0; padding:10px 16px; font-size:.9rem;
    background:#fff; color:#3A2E26; border:1px solid #E4D9C6; }
  .person { background:#fff; border-radius:16px; padding:22px;
    box-shadow:0 1px 3px rgba(58,46,38,.10); margin:0 0 24px; }
  .person img { width:132px; height:132px; border-radius:50%; object-fit:cover;
    object-position:top; margin:0 0 14px; }
  .person h2 { margin:0 0 2px; font-size:1.25rem; }
  .person dl { margin:14px 0 0; font-size:.95rem; }
  .person dt { color:#7A6A5E; font-size:.82rem; margin-top:12px; }
  .person dd { margin:2px 0 0; }
  .person a { color:#E9613A; text-decoration:none; }
  svg a text, svg a circle { cursor:pointer; }
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

// The first name is a NAME TAG, not a second lock: the names are printed on the
// very page it would protect, so checking them would secure nothing. It exists
// so the owner's device list reads "Rosi" instead of "Samsung, München".
function codeForm(res, name, message, status, kind) {
  const what = kind === 'tree' ? 'Stammbaum' : 'Album';
  sendPage(res, status || 200, name,
    '<h1>' + escapeHtml(name) + '</h1>'
    + '<p class="sub">Bitte gib deinen Vornamen und den Zugangscode ein.</p>'
    + '<div class="card"><form method="post">'
    + '<label for="visitor">Dein Vorname</label>'
    + '<input id="visitor" name="visitor" class="plain" type="text" '
    + 'autocomplete="given-name" maxlength="40" required autofocus>'
    + '<label for="code" class="spaced">Zugangscode</label>'
    + '<input id="code" name="code" type="text" autocomplete="one-time-code" '
    + 'autocapitalize="characters" maxlength="12" required>'
    + '<button type="submit">' + what + ' öffnen</button>'
    + (message ? '<p class="error">' + escapeHtml(message) + '</p>' : '')
    + '</form></div>'
    + '<p class="foot">Dein Vorname wird nur der Familie angezeigt, die diesen '
    + 'Zugang eingerichtet hat.</p>'
    // One tap, one seat. Without this a nervous double-tap sends the form
    // twice and claims two places.
    + '<script>(function(){var f=document.forms[0];f.addEventListener("submit",'
    + 'function(){var b=f.querySelector("button");b.disabled=true;'
    + 'b.textContent="Einen Moment...";});})();</' + 'script>');
}

// Background music, gallery page only. The file lives in a private Supabase
// Storage bucket and the API hands over a signed address per visit, exactly as
// it does for the photos. Nothing audio-related is stored in this deployment.
//
// Browsers refuse to start audio without a user gesture, so autoplay is only
// ATTEMPTED — the button is the guaranteed way in and is never hidden. A
// visitor who pauses stays paused on later visits.
function musicPlayer(url) {
  if (!url) return '';
  return '<audio id="bgm" src="' + escapeHtml(url) + '" preload="none"></audio>'
  + '<button class="music" id="music" type="button" aria-pressed="false">'
  + '<span id="musicIcon">♪</span><span id="musicText">Musik abspielen</span></button>'
  + '<script>(function(){'
  + 'var a=document.getElementById("bgm"),b=document.getElementById("music"),'
  + 'i=document.getElementById("musicIcon"),t=document.getElementById("musicText"),K="lb_music_off";'
  + 'function show(p){i.textContent=p?"❚❚":"♪";'
  + 't.textContent=p?"Musik pausieren":"Musik abspielen";'
  + 'b.setAttribute("aria-pressed",p?"true":"false");}'
  + 'function start(){a.preload="auto";return a.play().then(function(){show(true);});}'
  + 'b.addEventListener("click",function(){'
  + 'if(a.paused){try{localStorage.removeItem(K);}catch(e){}'
  + 'start().catch(function(){t.textContent="Musik nicht verfügbar";});}'
  + 'else{a.pause();show(false);try{localStorage.setItem(K,"1");}catch(e){}}});'
  + 'a.addEventListener("ended",function(){show(false);});'
  + 'var off=false;try{off=localStorage.getItem(K)==="1";}catch(e){}'
  + 'show(false);'
  + 'if(!off){start().catch(function(){});}'
  + '})();</' + 'script>';
}

function gallery(res, data) {
  const photos = data.photos || [];
  let body = '<h1>' + escapeHtml(data.name) + '</h1><p class="sub">'
    + photos.length + (photos.length === 1 ? ' Foto' : ' Fotos') + ', privat geteilt.</p>'
    + (data.announcement
      ? '<p class="fresh">' + escapeHtml(String(data.announcement)) + '</p>' : '');

  if (photos.length === 0) {
    body += '<p class="sub">Für dieses Album sind noch keine Fotos freigegeben.</p>';
  }

  // Only shown to a device that has been here before; on a first visit
  // everything is new and the line would be noise.
  if (data.newSince > 0) {
    body += '<p class="fresh">' + data.newSince
      + (data.newSince === 1 ? ' neues Foto' : ' neue Fotos')
      + ' seit deinem letzten Besuch.</p>';
  }

  // Newest first (2026-08-16, on request): the album is looked at again and
  // again, and what is new should be on top. The API delivers ascending order.
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

  // musicPlayer(), not a bare constant. A free identifier here answered HTTP 500
  // for every visitor of the album from 2026-08-23 18:11 to 2026-08-24 10:57,
  // because this line only runs once somebody actually opens the gallery.
  body += '<p class="foot">Privat geteilt. Bitte nicht weiterleiten.</p>'
    + musicPlayer(data.musicUrl);
  sendPage(res, 200, data.name, body);
}

// ---------------------------------------------------------------------------
// Family tree
//
// The API sends people and their links; the drawing happens here, because
// layout is presentation. SVG rather than fixed-size images: it stays sharp at
// any zoom on any screen, which is the whole point of sharing the tree — older
// relatives will pinch into it looking for a face they recognise.
// ---------------------------------------------------------------------------

const NODE_GAP = 168;   // minimum horizontal distance between two people
const ROW_GAP = 210;    // vertical distance between generations
const R = 46;           // portrait radius
const ROOT_R = 64;      // the child the tree belongs to, deliberately larger
// Height of the caption under a portrait: name, life line and relation.
const CAPTION_SPACE = 74;

// ---------------------------------------------------------------------------
// How each person is related to the child the tree belongs to.
//
// Computed from the common ancestor and the two distances to it — the ordinary
// genealogical method, so it stays right for cousins several times removed
// instead of giving up at "further relative". Where the gender is unknown the
// pair form is used; it is never guessed from a first name.
// ---------------------------------------------------------------------------

const REMOVED_WORDS = ['', 'einmal entfernt', 'zweimal entfernt', 'dreifach entfernt'];

function relationTo(nodes, unions, rootId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  if (!byId.has(rootId)) return out;

  const ancestors = (id) => {
    const seen = new Map();
    const queue = [[id, 0]];
    while (queue.length) {
      const [current, d] = queue.shift();
      if (!current || !byId.has(current) || seen.has(current)) continue;
      seen.set(current, d);
      const n = byId.get(current);
      queue.push([n.motherId, d + 1]);
      queue.push([n.fatherId, d + 1]);
    }
    return seen;
  };
  const rootUp = ancestors(rootId);

  // The ROLE is worked out from the family links; the gendered word is chosen
  // afterwards, from the gender of the person being labelled. Doing it the
  // other way round turns an uncle into a "Großtante".
  const roleOf = (id) => {
    const up = ancestors(id);
    if (rootUp.has(id) && id !== rootId) return { kind: 'ancestor', a: rootUp.get(id) };
    if (up.has(rootId)) return { kind: 'descendant', b: up.get(rootId) };
    let best = null;
    for (const [anc, a] of rootUp) {
      if (!up.has(anc)) continue;
      const b = up.get(anc);
      if (!best || a + b < best.a + best.b
        || (a + b === best.a + best.b && Math.max(a, b) < Math.max(best.a, best.b))) {
        best = { a, b };
      }
    }
    if (!best) return null;
    const { a, b } = best;
    if (a === 1 && b === 1) return { kind: 'sibling' };
    if (b === 1) return { kind: 'aunt', a };
    if (a === 1) return { kind: 'niece', b };
    return { kind: 'cousin', degree: Math.min(a, b) - 1, away: Math.abs(a - b) };
  };

  const pick = (n, female, male) => {
    if (n.gender === 'female') return female;
    if (n.gender === 'male') return male;
    return female + ' / ' + male;
  };

  const render = (role, n) => {
    if (!role) return null;
    if (role.kind === 'ancestor') {
      if (role.a === 1) return pick(n, 'Mutter', 'Vater');
      if (role.a === 2) return pick(n, 'Großmutter', 'Großvater');
      if (role.a === 3) return pick(n, 'Urgroßmutter', 'Urgroßvater');
      if (role.a === 4) return pick(n, 'Ururgroßmutter', 'Ururgroßvater');
      return 'Vorfahre der ' + (role.a - 2) + '. Generation';
    }
    if (role.kind === 'descendant') {
      if (role.b === 1) return pick(n, 'Tochter', 'Sohn');
      if (role.b === 2) return pick(n, 'Enkelin', 'Enkel');
      return pick(n, 'Urenkelin', 'Urenkel');
    }
    if (role.kind === 'sibling') return pick(n, 'Schwester', 'Bruder');
    if (role.kind === 'aunt') {
      if (role.a === 2) return pick(n, 'Tante', 'Onkel');
      if (role.a === 3) return pick(n, 'Großtante', 'Großonkel');
      if (role.a === 4) return pick(n, 'Urgroßtante', 'Urgroßonkel');
      return pick(n, 'entfernte Tante', 'entfernter Onkel');
    }
    if (role.kind === 'niece') {
      if (role.b === 2) return pick(n, 'Nichte', 'Neffe');
      if (role.b === 3) return pick(n, 'Großnichte', 'Großneffe');
      return pick(n, 'entfernte Nichte', 'entfernter Neffe');
    }
    const base = pick(n, 'Cousine', 'Cousin') + ' ' + role.degree + '. Grades';
    if (!role.away) return base;
    return base + ', ' + (REMOVED_WORDS[role.away] || role.away + '-fach entfernt');
  };

  const mates = new Map();
  const pair = (a, b) => {
    if (!byId.has(a) || !byId.has(b)) return;
    if (!mates.has(a)) mates.set(a, []);
    mates.get(a).push(b);
  };
  for (const u of unions || []) { pair(u.a, u.b); pair(u.b, u.a); }
  for (const n of nodes) {
    if (n.motherId && n.fatherId) { pair(n.motherId, n.fatherId); pair(n.fatherId, n.motherId); }
  }

  for (const n of nodes) {
    if (n.id === rootId) { out.set(n.id, 'Marina'); continue; }
    const own = roleOf(n.id);
    if (own) { out.set(n.id, render(own, n)); continue; }
    for (const mate of mates.get(n.id) || []) {
      if (mate === rootId) { out.set(n.id, pick(n, 'Partnerin', 'Partner')); break; }
      const theirs = roleOf(mate);
      if (!theirs) continue;
      if (theirs.kind === 'sibling') out.set(n.id, pick(n, 'Schwägerin', 'Schwager'));
      else if (theirs.kind === 'descendant' && theirs.b === 1) {
        out.set(n.id, pick(n, 'Schwiegertochter', 'Schwiegersohn'));
      } else {
        out.set(n.id, render(theirs, n) + ' (angeheiratet)');
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Family layout, unit-based.
//
// A COUPLE IS ONE NODE. Children hang from the couple's marriage line, parents
// of each partner are their own unit above, a second spouse docks beside the
// shared person on the same row. The whole chart is one recursive box
// computation with per-row contours — no placement heuristics, no repair
// passes, and therefore the same picture no matter in which order people were
// added. Lines are drawn from the data afterwards, so a missing connector is
// structurally impossible.
// ---------------------------------------------------------------------------
const SLOT = NODE_GAP;

function layoutTree(nodes, unions) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => n.isRoot) || nodes[0];
  if (!root) return null;

  // ---- couples: explicit unions plus any pair sharing a child --------------
  const coupleKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const couples = new Map(); // key -> {a,b,seq}
  const note = (a, b, seq) => {
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) return;
    const key = coupleKey(a, b);
    const prev = couples.get(key);
    if (!prev || seq < prev.seq) couples.set(key, { a, b, seq });
  };
  (unions || []).forEach((u, i) => note(u.a, u.b, u.seq != null ? u.seq : i));
  for (const n of nodes) if (n.motherId && n.fatherId) note(n.motherId, n.fatherId, 1e9);

  const childrenOfCouple = new Map(); // coupleKey -> [childId]
  const childrenOfSingle = new Map(); // personId -> [childId] (one known parent)
  for (const n of nodes) {
    const m = n.motherId && byId.has(n.motherId) ? n.motherId : null;
    const f = n.fatherId && byId.has(n.fatherId) ? n.fatherId : null;
    if (m && f) {
      const k = coupleKey(m, f);
      if (!childrenOfCouple.has(k)) childrenOfCouple.set(k, []);
      childrenOfCouple.get(k).push(n.id);
    } else if (m || f) {
      const p = m || f;
      if (!childrenOfSingle.has(p)) childrenOfSingle.set(p, []);
      childrenOfSingle.get(p).push(n.id);
    }
  }

  // Primary couple per person: the one drawn as a joint node. Most shared
  // children wins, then the OLDER union (seq), then the key — so a newly added
  // second partner never displaces the existing spouse.
  const couplesOf = new Map();
  for (const [key] of couples) {
    const { a, b } = couples.get(key);
    for (const p of [a, b]) {
      if (!couplesOf.has(p)) couplesOf.set(p, []);
      couplesOf.get(p).push(key);
    }
  }
  const primary = new Map();
  for (const [p, keys] of couplesOf) {
    keys.sort((x, y) =>
      ((childrenOfCouple.get(y) || []).length - (childrenOfCouple.get(x) || []).length)
      || (couples.get(x).seq - couples.get(y).seq)
      || (x < y ? -1 : 1));
    primary.set(p, keys[0]);
  }

  // ---- units ---------------------------------------------------------------
  const unitOf = new Map();
  const units = [];
  const sideCouples = []; // marriages that could not become a joint node
  for (const key of [...couples.keys()].sort()) {
    const { a, b } = couples.get(key);
    if (primary.get(a) === key && primary.get(b) === key) {
      const unit = { members: [a, b], key, level: null };
      units.push(unit); unitOf.set(a, unit); unitOf.set(b, unit);
    } else {
      sideCouples.push([a, b]);
    }
  }
  for (const n of [...nodes].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!unitOf.has(n.id)) {
      const unit = { members: [n.id], key: n.id, level: null };
      units.push(unit); unitOf.set(n.id, unit);
    }
  }
  for (const u of units) {
    if (u.members.length === 2) {
      u.members.sort((x, y) => {
        const gx = byId.get(x).gender, gy = byId.get(y).gender;
        if (gx !== gy) { if (gx === 'male') return -1; if (gy === 'male') return 1; }
        const nx = byId.get(x).givenName || '', ny = byId.get(y).givenName || '';
        return nx < ny ? -1 : nx > ny ? 1 : (x < y ? -1 : 1);
      });
    }
  }

  // ---- which unit a child hangs under -------------------------------------
  // Both parents in one joint unit -> that unit. Parents married but not a
  // joint node (remarriage): the single-member unit of either parent, so the
  // child hangs beside the shared spouse. One known parent -> that parent.
  const attachUnit = (n) => {
    const m = n.motherId && byId.has(n.motherId) ? n.motherId : null;
    const f = n.fatherId && byId.has(n.fatherId) ? n.fatherId : null;
    if (m && f) {
      const um = unitOf.get(m), uf = unitOf.get(f);
      if (um === uf) return um;
      if (uf.members.length === 1) return uf;
      if (um.members.length === 1) return um;
      return um;
    }
    if (m || f) return unitOf.get(m || f);
    return null;
  };
  const childIdsOf = new Map(); // unit -> [childId], deterministic order
  for (const n of nodes) {
    const u = attachUnit(n);
    if (!u) continue;
    if (!childIdsOf.has(u)) childIdsOf.set(u, []);
    childIdsOf.get(u).push(n.id);
  }
  const sortKey = (id) => {
    const n = byId.get(id);
    const ymatch = String(n.bornOn || '').match(/(\d{4})/);
    return (ymatch ? ymatch[1] : '9999') + '|' + (n.givenName || '') + '|' + id;
  };
  for (const kids of childIdsOf.values()) kids.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

  // side partners per person (for walking and for the extra marriage lines)
  const sidePartnersOf = new Map();
  for (const [a, b] of sideCouples) {
    for (const [p, q] of [[a, b], [b, a]]) {
      if (!sidePartnersOf.has(p)) sidePartnersOf.set(p, []);
      sidePartnersOf.get(p).push(q);
    }
  }
  for (const list of sidePartnersOf.values()) list.sort();

  // ---- spanning walk with levels ------------------------------------------
  const visited = new Set();
  const treeDown = new Map(), treeUp = new Map(), treeSide = new Map();
  const walk = (unit, level) => {
    if (visited.has(unit)) return;
    visited.add(unit);
    unit.level = level;
    const downs = [];
    for (const c of childIdsOf.get(unit) || []) {
      const cu = unitOf.get(c);
      if (visited.has(cu)) continue;
      downs.push(cu); walk(cu, level - 1);
    }
    treeDown.set(unit, downs);
    const ups = [];
    for (const m of unit.members) {
      const n = byId.get(m);
      const pm = n.motherId && byId.has(n.motherId) ? unitOf.get(n.motherId) : null;
      const pf = n.fatherId && byId.has(n.fatherId) ? unitOf.get(n.fatherId) : null;
      const pu = (pm && pf && pm === pf) ? pm : (pm || pf);
      if (pu && !visited.has(pu)) { ups.push({ via: m, unit: pu }); walk(pu, level + 1); }
    }
    treeUp.set(unit, ups);
    const sides = [];
    for (const m of unit.members) {
      for (const sp of sidePartnersOf.get(m) || []) {
        const su = unitOf.get(sp);
        if (visited.has(su)) continue;
        sides.push({ via: m, unit: su }); walk(su, level);
      }
    }
    treeSide.set(unit, sides);
  };
  walk(unitOf.get(root.id), 0);
  const restRoots = [];
  for (const u of [...units].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (!visited.has(u)) { restRoots.push(u); walk(u, 0); }
  }

  // ---- recursive boxes with per-row contours -------------------------------
  // Row occupancy is a LIST OF INTERVALS per row, not one envelope — a single
  // min/max would report the huge gap between two far-apart cousin blocks as
  // occupied and push the root's own line out of its rightful centre.
  // Intervals closer than 2*SLOT are merged: nothing can fit between them.
  const normalize = (list) => {
    list.sort((a, b) => a.min - b.min);
    const out = [];
    for (const iv of list) {
      const last = out[out.length - 1];
      if (last && iv.min - last.max < 2 * SLOT) last.max = Math.max(last.max, iv.max);
      else out.push({ min: iv.min, max: iv.max });
    }
    return out;
  };
  const mergeExt = (target, ext, off) => {
    for (const [l, ivs] of ext) {
      const arr = target.get(l) || [];
      for (const iv of ivs) arr.push({ min: iv.min + off, max: iv.max + off });
      target.set(l, normalize(arr));
    }
  };
  // Sequential packer: strictly right of everything already there.
  const fitOffset = (content, ext, desired) => {
    let off = desired;
    for (const [l, ivs] of ext) {
      const c = content.get(l);
      if (!c || c.length === 0) continue;
      const cMax = c[c.length - 1].max;
      const eMin = Math.min(...ivs.map((iv) => iv.min));
      off = Math.max(off, cMax + SLOT - eMin);
    }
    return off;
  };
  // Minimal displacement in ONE direction until no row overlaps. Unlike the
  // packer above this does not force the box past everything — a box that
  // already fits at its desired spot (a real gap included) stays there.
  const fitDir = (content, ext, desired, dir) => {
    let off = desired;
    for (let guard = 0; guard < 128; guard++) {
      let moved = false;
      for (const [l, ivs] of ext) {
        const c = content.get(l);
        if (!c) continue;
        for (const e of ivs) for (const ci of c) {
          if (e.min + off < ci.max + SLOT && e.max + off > ci.min - SLOT) {
            off = dir < 0 ? Math.min(off, ci.min - SLOT - e.max)
                          : Math.max(off, ci.max + SLOT - e.min);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return off;
  };

  // side: which wing of the chart this unit belongs to. 0 = the direct line
  // of the root (children bus-centred underneath), -1 = father's wing (all
  // collaterals grow LEFT of the couple), +1 = mother's wing (they grow
  // RIGHT). This is what keeps every ancestor couple exactly above its child
  // on the spine: the siblings can no longer push it aside — they are packed
  // on the side where nothing competes with them.
  const absX = new Map();
  const layoutUnit = (unit, side) => {
    // contentFit additionally holds a phantom corridor for the spine child
    // this wing will sit above (the caller's member and their spouse). The
    // corridor keeps collaterals out of that space but is NOT returned — for
    // the caller it is their own content, not ours.
    const contentFit = new Map();
    const contentOut = new Map();
    const placers = [];
    const half = unit.members.length === 2 ? SLOT / 2 : 0;
    const downs = treeDown.get(unit) || [];
    const put = (ext, off) => { mergeExt(contentFit, ext, off); mergeExt(contentOut, ext, off); };
    let cx;

    if (side === 0) {
      // descendants: children first, couple centred over their bus
      const anchors = [];
      let cursor = 0;
      downs.forEach((cu, i) => {
        const b = layoutUnit(cu, 0);
        const off = i === 0 ? 0 : fitOffset(contentFit, b.ext, cursor);
        put(b.ext, off);
        anchors.push(off + b.cx);
        cursor = off;
        placers.push((dx) => b.place(dx + off));
      });
      const wish = anchors.length ? (anchors[0] + anchors[anchors.length - 1]) / 2 : 0;
      const rowExt = new Map([[unit.level, [{ min: -half, max: half }]]]);
      cx = fitDir(contentFit, rowExt, wish, 1);
      put(rowExt, cx);
    } else {
      // ancestor wing: couple is the fixed anchor. Reserve the corridor of
      // the spine child below (at cx) and their spouse on the inner side,
      // then pack the collateral children outward.
      cx = 0;
      put(new Map([[unit.level, [{ min: -half, max: half }]]]), 0);
      const corridor = side < 0
        ? [{ min: 0, max: SLOT }]
        : [{ min: -SLOT, max: 0 }];
      mergeExt(contentFit, new Map([[unit.level - 1, corridor]]), cx);
      downs.forEach((cu) => {
        const b = layoutUnit(cu, 0);
        const off = fitDir(contentFit, b.ext, cx - b.cx, side);
        put(b.ext, off);
        placers.push((dx) => b.place(dx + off));
      });
    }
    const mxs = unit.members.length === 2 ? [cx - half, cx + half] : [cx];
    placers.push((dx) => unit.members.forEach((m, i) => absX.set(m, dx + mxs[i])));

    // parents of each partner, aligned over the partner when space allows;
    // the wing decides to which side a conflict gives way
    (treeUp.get(unit) || []).forEach(({ via, unit: pu }) => {
      const index = unit.members.indexOf(via);
      const childSide = side !== 0 ? side
        : (unit.members.length === 2 ? (index === 0 ? -1 : 1) : 0);
      const b = layoutUnit(pu, childSide);
      const desired = mxs[index] - b.cx;
      const off = fitDir(contentFit, b.ext, desired, childSide < 0 ? -1 : 1);
      put(b.ext, off);
      placers.push((dx) => b.place(dx + off));
    });

    // second spouses dock on the same row, on the outer side of the wing
    for (const { via, unit: su } of treeSide.get(unit) || []) {
      const b = layoutUnit(su, side);
      const memberX = mxs[unit.members.indexOf(via)];
      const desired = side < 0 ? memberX - SLOT - b.cx : memberX + SLOT - b.cx;
      const off = fitDir(contentFit, b.ext, desired, side < 0 ? -1 : 1);
      put(b.ext, off);
      placers.push((dx) => b.place(dx + off));
    }

    return { ext: contentOut, cx, place: (dx) => placers.forEach((p) => p(dx)) };
  };

  const mainBox = layoutUnit(unitOf.get(root.id), 0);
  mainBox.place(0);
  let globalMax = -Infinity;
  for (const ivs of mainBox.ext.values()) for (const e of ivs) globalMax = Math.max(globalMax, e.max);
  for (const ru of restRoots) {
    const b = layoutUnit(ru, 0);
    let minB = Infinity, maxB = -Infinity;
    for (const ivs of b.ext.values()) for (const e of ivs) { minB = Math.min(minB, e.min); maxB = Math.max(maxB, e.max); }
    const shift = globalMax + 2 * SLOT - minB;
    b.place(shift);
    globalMax = Math.max(globalMax, maxB + shift);
  }

  // ---- absolute coordinates ------------------------------------------------
  let minX = Infinity, maxX = -Infinity, minL = Infinity, maxL = -Infinity;
  for (const u of units) { minL = Math.min(minL, u.level); maxL = Math.max(maxL, u.level); }
  for (const x of absX.values()) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const pad = R + 40;
  const rowY = (l) => (maxL - l) * ROW_GAP + R + 40;
  const people = [];
  const posOf = new Map();
  for (const u of units) for (const m of u.members) {
    const n = byId.get(m);
    const p = { node: n, x: absX.get(m) - minX + pad, y: rowY(u.level) };
    people.push(p); posOf.set(m, p);
  }

  // ---- lines, purely from the data -----------------------------------------
  const links = [];
  const busFor = (parentIds, kids) => {
    const parents = parentIds.map((m) => posOf.get(m)).filter(Boolean);
    if (parents.length === 0) return;
    const px = parents.reduce((s, p) => s + p.x, 0) / parents.length;
    const py = Math.max(...parents.map((p) => p.y));
    for (const c of kids) {
      const cp = posOf.get(c);
      if (!cp) continue;
      const radius = cp.node.isRoot ? ROOT_R : R;
      const midY = Math.min(
        Math.max((cp.y - radius + py + R) / 2, py + R + CAPTION_SPACE),
        cp.y - radius - 14,
      );
      const topY = parentIds.length === 2 && Math.abs(parents[0].y - parents[1].y) < 1
        ? py                       // from the marriage line
        : py + R + CAPTION_SPACE;  // from below a single parent's caption
      links.push([cp.x, cp.y - radius, cp.x, midY]);
      links.push([cp.x, midY, px, midY]);
      links.push([px, midY, px, Math.min(topY, midY)]);
    }
  };
  for (const [key, { a, b }] of couples) {
    const pa = posOf.get(a), pb = posOf.get(b);
    if (pa && pb && Math.abs(pa.y - pb.y) < 1) {
      links.push([Math.min(pa.x, pb.x) + R, pa.y, Math.max(pa.x, pb.x) - R, pa.y]);
    }
    busFor([a, b], childrenOfCouple.get(key) || []);
  }
  for (const [p, kids] of childrenOfSingle) busFor([p], kids);

  return {
    people, links,
    width: maxX - minX + pad * 2,
    height: rowY(minL) + ROOT_R + 86,
    skipped: nodes.length - people.length,
    meta: {
      unitCouples: units.filter((u) => u.members.length === 2).map((u) => [...u.members]),
      sideCouples,
    },
  };
}

function lifeLine(n) {
  const born = n.bornOn ? String(n.bornOn).trim() : '';
  const died = n.diedOn ? String(n.diedOn).trim() : '';
  if (born && died) return born + ' – ' + died;
  if (died) return '† ' + died;
  if (born) return '* ' + born;
  if (n.deceased) return 'verstorben';
  return '';
}

function treeSvg(plan, relation) {
  let defs = '';
  let body = '';
  for (const [x1, y1, x2, y2] of plan.links) {
    body += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1)
      + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
  }
  plan.people.forEach((p, index) => {
    const n = p.node;
    const cid = 'c' + index;
    // Every person is a link back to this same page with ?p=<id>. No script,
    // no state — the detail card is rendered by the server like everything
    // else, so it works on any phone and survives a reload.
    body += '<a href="?p=' + escapeHtml(n.id) + '">';
    const r = n.isRoot ? ROOT_R : R;
    const fill = n.deceased ? '#6B584A' : '#EFE6D5';
    const ring = n.isRoot ? '#C8A02A' : (n.deceased ? '#6B584A' : '#C9B79A');
    if (n.isRoot) {
      // A soft golden halo, so the eye finds her before it reads a single name.
      body += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (r + 16)
        + '" fill="#F6E7B8" opacity="0.55"/>';
    }
    body += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (r + 5)
      + '" fill="' + fill + '"/>';
    if (n.photoUrl) {
      defs += '<clipPath id="' + cid + '"><circle cx="' + p.x + '" cy="' + p.y
        + '" r="' + r + '"/></clipPath>';
      body += '<image href="' + escapeHtml(n.photoUrl) + '" x="' + (p.x - r)
        + '" y="' + (p.y - r) + '" width="' + (r * 2) + '" height="' + (r * 2)
        + '" preserveAspectRatio="xMidYMin slice" clip-path="url(#' + cid + ')"/>';
    } else {
      const initials = (n.givenName || '?').trim().charAt(0)
        + (n.familyName ? n.familyName.trim().charAt(0) : '');
      body += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r
        + '" fill="' + (n.deceased ? '#54443A' : '#E4D9C6') + '"/>'
        + '<text class="ini" x="' + p.x + '" y="' + (p.y + 9) + '" fill="'
        + (n.deceased ? '#EFE6D5' : '#8A7A6C') + '">'
        + escapeHtml(initials.toUpperCase()) + '</text>';
    }
    body += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r
      + '" fill="none" stroke="' + ring + '" stroke-width="'
      + (n.isRoot ? 5 : 2.5) + '"/>';
    if (n.deceased) {
      // A mark as well as the colour: colour alone carries no information for
      // a colour-blind reader, and none at all in bright sunlight.
      body += '<text class="cross" x="' + (p.x + r - 6) + '" y="' + (p.y - r + 16)
        + '">†</text>';
    }
    const full = (n.givenName + ' ' + (n.familyName || '')).trim();
    body += '<text class="' + (n.isRoot ? 'nm root' : 'nm') + '" x="' + p.x
      + '" y="' + (p.y + r + 26) + '">' + escapeHtml(full) + '</text>';
    const life = lifeLine(n);
    if (life) {
      body += '<text class="lf" x="' + p.x + '" y="' + (p.y + r + 44) + '">'
        + escapeHtml(life) + '</text>';
    }
    const rel = relation && relation.get(n.id);
    if (rel && !n.isRoot) {
      body += '<text class="rl" x="' + p.x + '" y="' + (p.y + r + (life ? 61 : 44))
        + '">' + escapeHtml(rel) + '</text>';
    }
    body += '</a>';
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(plan.width)
    + '" height="' + Math.round(plan.height) + '" viewBox="0 0 '
    + Math.round(plan.width) + ' ' + Math.round(plan.height) + '">'
    + '<style>line{stroke:#C9B79A;stroke-width:2;fill:none}'
    + 'text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'text-anchor:middle}'
    + '.nm{font-size:15px;font-weight:600;fill:#3A2E26}'
    + '.nm.root{font-size:18px;font-weight:700}'
    + '.lf{font-size:12.5px;fill:#7A6A5E}'
    + '.rl{font-size:11.5px;fill:#A08E7E}'
    + '.ini{font-size:26px;font-weight:600}'
    + '.cross{font-size:19px;fill:#E9613A;text-anchor:middle}</style>'
    + '<defs>' + defs + '</defs>' + body + '</svg>';
}

/**
 * Sends the chosen picture straight to Supabase Storage, not through this
 * function: Vercel rejects a request body over 4.5 MB and an ordinary phone
 * photo is 5-8 MB, so the obvious route would fail on exactly the files people
 * want to send. Measured 2026-08-23.
 *
 * The picture is redrawn through a canvas first. That does three things at
 * once: it shrinks a 8 MB photo to a few hundred KB, it makes HEIC from an
 * iPhone into a JPEG every browser can show, and — the point that matters —
 * it DROPS THE EXIF BLOCK, so a guest cannot hand us the GPS coordinates of
 * their living room without noticing. If any of it fails, the untouched file
 * is sent instead; a missing picture is worse than a large one.
 *
 * Without JavaScript the rest of the form still works, only the picture is
 * skipped. That is deliberate: the suggestion matters more than the photo.
 */
function photoUploadScript() {
  return '<script>(function(){'
  + 'var f=document.getElementById("sugform");'
  + 'var inp=document.getElementById("photoFile");'
  + 'var key=document.getElementById("photo_key");'
  + 'var note=document.getElementById("photoNote");'
  + 'if(!f||!inp||!key||!note)return;'
  + 'var busy=false;'
  + 'function shrink(file){return new Promise(function(done){'
  + 'var url=URL.createObjectURL(file);var img=new Image();'
  + 'img.onload=function(){try{'
  + 'var m=2400,w=img.naturalWidth,h=img.naturalHeight;'
  + 'var s=Math.min(1,m/Math.max(w,h));'
  + 'var c=document.createElement("canvas");'
  + 'c.width=Math.round(w*s);c.height=Math.round(h*s);'
  + 'c.getContext("2d").drawImage(img,0,0,c.width,c.height);'
  + 'c.toBlob(function(b){URL.revokeObjectURL(url);done(b||null);},"image/jpeg",0.85);'
  + '}catch(e){URL.revokeObjectURL(url);done(null);}};'
  + 'img.onerror=function(){URL.revokeObjectURL(url);done(null);};'
  + 'img.src=url;});}'
  + 'f.addEventListener("submit",function(ev){'
  + 'if(busy)return;'
  + 'var file=inp.files&&inp.files[0];'
  + 'if(!file)return;'
  + 'ev.preventDefault();busy=true;'
  + 'var b=f.querySelector("button");if(b)b.disabled=true;'
  + 'note.textContent="Foto wird übertragen...";'
  + 'shrink(file).then(function(blob){'
  + 'var body=blob||file;'
  + 'var mime=blob?"image/jpeg":(file.type||"image/jpeg");'
  + 'if(body.size>8388608)throw new Error("zu groß");'
  + 'return fetch(location.pathname,{method:"POST",'
  + 'headers:{"content-type":"application/x-www-form-urlencoded"},'
  + 'body:"form=upload&mime="+encodeURIComponent(mime)+"&bytes="+body.size})'
  + '.then(function(r){return r.json();})'
  + '.then(function(d){'
  + 'if(d.status!=="upload")throw new Error("abgelehnt");'
  + 'return fetch(d.uploadUrl,{method:"PUT",headers:{"content-type":mime},body:body})'
  + '.then(function(r){if(!r.ok)throw new Error("Upload "+r.status);key.value=d.key;});'
  + '});'
  + '}).then(function(){note.textContent="Foto übertragen.";f.submit();})'
  + '.catch(function(){busy=false;if(b)b.disabled=false;inp.value="";key.value="";'
  + 'note.textContent="Das Foto ließ sich nicht übertragen. Du kannst den '
  + 'Vorschlag trotzdem ohne Foto senden.";});'
  + '});})();</' + 'script>';
}

/**
 * The suggestion form. Guests never write to the tree — this posts into a
 * review queue that the family works through in the app. Everything is
 * optional except a name (for a new person) or a message, so that someone who
 * only knows one date can still contribute it.
 */
function suggestionForm(nodes) {
  const options = nodes.slice()
    .sort((a, b) => (a.givenName + a.familyName).localeCompare(b.givenName + b.familyName))
    .map((n) => '<option value="' + escapeHtml(n.id) + '">'
      + escapeHtml((n.givenName + ' ' + (n.familyName || '')).trim()) + '</option>')
    .join('');

  const field = (id, label, extra) => '<label for="' + id + '">' + label + '</label>'
    + '<input id="' + id + '" name="' + id + '" type="text" maxlength="120"'
    + (extra || '') + '>';

  return '<details><summary>Etwas ergänzen oder berichtigen</summary>'
    + '<div class="form"><form method="post" id="sugform">'
    + '<input type="hidden" name="form" value="suggest">'
    + '<input type="hidden" name="photo_key" id="photo_key">'
    + '<label for="kind">Was möchtest du beitragen?</label>'
    + '<select id="kind" name="kind">'
    + '<option value="add">Eine Person, die noch fehlt</option>'
    + '<option value="edit">Eine Angabe zu jemandem, der schon drin ist</option>'
    + '<option value="note">Nur eine Nachricht</option>'
    + '</select>'
    + '<label for="relative_id">Falls Berichtigung: um wen geht es?</label>'
    + '<select id="relative_id" name="relative_id">'
    + '<option value="">— bitte wählen —</option>' + options + '</select>'
    + field('given_name', 'Vorname')
    + field('family_name', 'Nachname')
    + field('birth_name', 'Geburtsname')
    + field('born_on', 'Geboren am (auch „1923" oder „März 1944")')
    + field('born_place', 'Geburtsort')
    + '<div class="row"><input id="deceased" name="deceased" type="checkbox" value="1">'
    + '<label for="deceased">Diese Person ist verstorben</label></div>'
    + field('died_on', 'Gestorben am')
    + field('died_place', 'Sterbeort')
    + '<label for="message">Anmerkung</label>'
    + '<textarea id="message" name="message" maxlength="2000"></textarea>'
    // No name attribute on purpose: the file must NOT travel with the ordinary
    // form post. Vercel refuses a body over 4.5 MB and a phone photo is
    // routinely bigger, so the picture goes straight to storage instead.
    + '<label for="photoFile" class="spaced">Ein Foto dazu (freiwillig)</label>'
    + '<input id="photoFile" type="file" accept="image/*">'
    + '<p class="hint" id="photoNote">Ein altes Bild dieser Person? Gern auch '
    + 'ein Foto vom Foto. Es geht an die Familie zur Ansicht und erscheint '
    + 'nicht sofort im Baum.</p>'
    + '<button type="submit">Vorschlag senden</button>'
    + '<p class="hint">Dein Vorschlag geht an die Familie und ändert nichts von '
    + 'selbst. Was du nicht weißt, lässt du einfach leer.</p>'
    + '</form></div></details>'
    + photoUploadScript();
}

/** One person, rendered above the tree when ?p=<id> is asked for. */
function personCard(tree, id, relation) {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const n = byId.get(id);
  if (!n) return '';
  const full = (n.givenName + ' ' + (n.familyName || '')).trim();
  const nameOf = (other) => {
    const o = byId.get(other);
    if (!o) return null;
    return '<a href="?p=' + escapeHtml(o.id) + '">'
      + escapeHtml((o.givenName + ' ' + (o.familyName || '')).trim()) + '</a>';
  };
  const partners = (tree.unions || [])
    .map((u) => (u.a === id ? u.b : u.b === id ? u.a : null))
    .filter(Boolean).map(nameOf).filter(Boolean);
  const children = tree.nodes
    .filter((o) => o.motherId === id || o.fatherId === id)
    .map((o) => nameOf(o.id)).filter(Boolean);

  let rows = '';
  const row = (label, value) => {
    if (!value) return;
    rows += '<dt>' + label + '</dt><dd>' + value + '</dd>';
  };
  if (relation && relation.get(id)) {
    rows += '<dt>Verwandtschaft zu Marina</dt><dd>'
      + escapeHtml(relation.get(id)) + '</dd>';
  }
  row('Geburtsname', n.birthName ? escapeHtml(n.birthName) : null);
  row('Geboren', n.bornOn ? escapeHtml(n.bornOn) : null);
  row('Gestorben', n.diedOn ? escapeHtml(n.diedOn) : null);
  row('Mutter', n.motherId ? nameOf(n.motherId) : null);
  row('Vater', n.fatherId ? nameOf(n.fatherId) : null);
  row('Partner', partners.join(', ') || null);
  row(children.length === 1 ? 'Kind' : 'Kinder', children.join(', ') || null);

  let out = '<div class="person">';
  if (n.photoUrl) out += '<img src="' + escapeHtml(n.photoUrl) + '" alt="">';
  out += '<h2>' + escapeHtml(full) + '</h2>';
  if (n.deceased) out += '<p class="sub" style="margin:0">verstorben</p>';
  if (rows) out += '<dl>' + rows + '</dl>';
  else out += '<p class="sub" style="margin:12px 0 0">Zu dieser Person ist noch '
    + 'nichts weiter eingetragen. Wenn du etwas weißt, trag es unten ein.</p>';
  out += '<p style="margin:18px 0 0"><a href="?">Zurück zum ganzen Baum</a></p>';
  return out + '</div>';
}

/** The family's own note, plus what the tree gained since the last visit. */
function newsBanners(data) {
  let out = '';
  if (data.announcement) {
    out += '<p class="fresh">' + escapeHtml(String(data.announcement)) + '</p>';
  }
  const news = data.treeNews;
  if (news && (news.added || news.changed)) {
    const parts = [];
    if (news.added) {
      parts.push(news.added + (news.added === 1 ? ' Person neu' : ' Personen neu'));
    }
    if (news.changed) {
      parts.push(news.changed
        + (news.changed === 1 ? ' Angabe ergänzt' : ' Angaben ergänzt'));
    }
    out += '<p class="done">Seit deinem letzten Besuch: ' + parts.join(', ') + '.</p>';
  }
  return out;
}

function treePage(res, data, personId) {
  const tree = data.tree;
  if (!tree || !tree.nodes || tree.nodes.length === 0) {
    return sendPage(res, 200, data.name,
      '<h1>' + escapeHtml(data.name) + '</h1>'
      + '<p class="sub">Für diesen Stammbaum sind noch keine Personen eingetragen.</p>');
  }
  const plan = layoutTree(tree.nodes, tree.unions || []);
  if (!plan) {
    return sendPage(res, 200, data.name,
      '<h1>' + escapeHtml(data.name) + '</h1>'
      + '<p class="sub">Der Stammbaum lässt sich gerade nicht darstellen.</p>');
  }

  const rootNode = tree.nodes.find((n) => n.isRoot) || tree.nodes[0];
  const relation = relationTo(tree.nodes, tree.unions || [], rootNode.id);

  let body = '<h1>' + escapeHtml(data.name) + '</h1>';
  if (data.suggestionSaved) {
    body += '<p class="done">Danke! Dein Vorschlag ist angekommen und wird von '
      + 'der Familie geprüft.</p>';
  }
  body += newsBanners(data);
  if (personId) body += personCard(tree, personId, relation);
  body += '<p class="sub">' + plan.people.length
    + (plan.people.length === 1 ? ' Person' : ' Personen')
    + ', privat geteilt. Tippe eine Person an, um mehr zu sehen.</p>'
    + '<div class="canvas fit" id="cv">' + treeSvg(plan, relation) + '</div>'
    + '<div class="tools">'
    + '<button type="button" id="zin">Vergrößern</button>'
    + '<button type="button" id="zout">Ganzer Baum</button></div>'
    + '<script>(function(){var c=document.getElementById("cv");'
    + 'document.getElementById("zin").addEventListener("click",function(){'
    + 'c.classList.remove("fit");c.scrollLeft=(c.scrollWidth-c.clientWidth)/2;});'
    + 'document.getElementById("zout").addEventListener("click",function(){'
    + 'c.classList.add("fit");});})();</' + 'script>'
    + '<p class="legend"><span><i style="background:#C8A02A"></i>Marina</span>'
    + '<span><i style="background:#EFE6D5;border:1px solid #C9B79A"></i>lebt</span>'
    + '<span><i style="background:#6B584A"></i>verstorben †</span></p>';

  if (!tree.showLivingDetails) {
    body += '<p class="sub" style="margin-top:18px">Von lebenden Personen wird '
      + 'bewusst nur der Name gezeigt — keine Fotos, keine Geburtsdaten.</p>';
  }
  if (plan.skipped > 0) {
    body += '<p class="sub">' + plan.skipped
      + (plan.skipped === 1 ? ' Person ist' : ' Personen sind')
      + ' noch nicht eingehängt und deshalb hier nicht zu sehen.</p>';
  }

  body += '<p class="ask">Fehlt jemand, oder kennst du Namen, Daten oder alte '
    + 'Fotos, die hier noch fehlen? Der Baum wächst mit dem, was ihr '
    + 'beisteuert.</p>';
  if (data.allowSuggestions) body += suggestionForm(tree.nodes);
  body += '<p class="foot">Privat geteilt. Bitte nicht weiterleiten.</p>'
    + musicPlayer(data.musicUrl);
  sendPage(res, 200, data.name, body);
}

function render(res, data, personId) {
  if (data.kind === 'tree') return treePage(res, data, personId);
  return gallery(res, data);
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

  if (req.method === 'POST') {
    const raw = await readBody(req);
    const form = new URLSearchParams(raw);

    // The picture never passes through here — only the request for a place to
    // put it. Answering JSON keeps the page itself server-rendered.
    if (form.get('form') === 'upload') {
      const secret = readCookie(req, name);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!secret) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ status: 'unavailable' }));
      }
      const grant = await callApi(token, {
        deviceSecret: secret,
        photoUpload: { mime: form.get('mime') || '', bytes: Number(form.get('bytes') || 0) },
      }, req);
      res.statusCode = grant.status === 'upload' ? 200 : 400;
      return res.end(JSON.stringify(grant));
    }

    // Two different forms post to this same address: the access code on the
    // way in, and a suggestion once inside. The hidden field tells them apart.
    if (form.get('form') === 'suggest') {
      const secret = readCookie(req, name);
      if (!secret) return unavailable(res);
      const suggestion = { kind: form.get('kind') || 'note' };
      for (const key of ['relative_id', 'given_name', 'family_name', 'birth_name',
        'born_on', 'born_place', 'died_on', 'died_place', 'message', 'photo_key']) {
        const value = form.get(key);
        if (value) suggestion[key] = value;
      }
      if (form.get('deceased')) suggestion.deceased = true;
      const sent = await callApi(token, { deviceSecret: secret, suggestion }, req);
      if (sent.status === 'ok') return render(res, sent);
      return unavailable(res);
    }

    const code = form.get('code') || '';
    const visitorName = form.get('visitor') || '';
    const data = await callApi(token, { code, visitorName }, req);

    if (data.status === 'ok') {
      res.setHeader('Set-Cookie', name + '=' + encodeURIComponent(data.deviceSecret)
        + '; Path=/a/' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + COOKIE_MAX_AGE);
      return render(res, data);
    }
    if (data.status === 'invalid_code') {
      return codeForm(res, data.name, 'Der Code stimmt nicht.', 401, data.kind);
    }
    if (data.status === 'locked') {
      return codeForm(res, data.name,
        'Zu viele Fehlversuche. Bitte versuch es in einigen Minuten noch einmal.', 429, data.kind);
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
  const data = await callApi(token, deviceSecret ? { deviceSecret } : {}, req);

  if (data.status === 'ok') return render(res, data, url.searchParams.get('p'));
  if (data.status === 'code_required') return codeForm(res, data.name, null, 200, data.kind);
  return unavailable(res);
};
