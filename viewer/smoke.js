/**
 * Rauchprobe fuer den Viewer. Rendert beide Seitentypen mit erfundenen Daten
 * gegen ein Attrappen-Response-Objekt.
 *
 * Warum es das gibt: am 23.08.2026 ging `MUSIC is not defined` live und das
 * Fotoalbum antwortete siebzehn Stunden lang mit HTTP 500, weil ein freier
 * Bezeichner erst beim AUFRUF knallt, nicht beim Laden. `node --check` sieht so
 * etwas nicht. Diese Datei ruft auf.  Vor jedem Deploy:  node smoke.js
 */
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/api/index.js', 'utf8');
const body = src.replace('module.exports = async function handler', 'const handler = async function handler');
const internals = new Function(body + '\n; return { gallery, treePage, codeForm, unavailable, sendPage, '
  + 'manifestFor, manifestRoute, pwaHeadTags, handler };')();

function fakeRes() {
  return {
    statusCode: 0, headers: {}, out: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(html) { this.out = html; },
  };
}

const photoData = {
  kind: 'photos', name: 'Für Familie', allowDownload: true, announcement: 'Hallo!',
  newSince: 2, musicUrl: 'https://example.test/marina.mp3',
  photos: [
    { url: 'https://example.test/a.jpg', occurredAt: '2026-08-20T09:00:00Z', ageDays: 16, note: 'Erster Tag' },
    { url: 'https://example.test/b.jpg', occurredAt: '2026-08-21T09:00:00Z', ageDays: 17, note: null },
  ],
};

const treeData = {
  kind: 'tree', name: 'Stammbaum Marina', allowSuggestions: true, suggestionSaved: false,
  musicUrl: null, treeNews: { added: 1, changed: 2 }, announcement: null,
  tree: {
    showLivingDetails: true,
    unions: [{ a: 'v', b: 'm' }],
    nodes: [
      { id: 'k', isRoot: true, givenName: 'Marina', familyName: 'Lang', gender: 'female', deceased: false, bornOn: '05.08.2026', diedOn: null, birthName: null, photoUrl: null, motherId: 'm', fatherId: 'v' },
      { id: 'v', isRoot: false, givenName: 'Andreas', familyName: 'Schilling', gender: 'male', deceased: false, bornOn: null, diedOn: null, birthName: null, photoUrl: null, motherId: null, fatherId: null },
      { id: 'm', isRoot: false, givenName: 'Tamara', familyName: 'Lang', gender: 'female', deceased: false, bornOn: null, diedOn: null, birthName: null, photoUrl: null, motherId: null, fatherId: null },
      { id: 'o', isRoot: false, givenName: 'Josefa', familyName: 'Lang', gender: 'female', deceased: true, bornOn: null, diedOn: '1998', birthName: 'Huber', photoUrl: null, motherId: null, fatherId: null },
    ],
  },
};

const checks = [
  ['Fotoalbum', () => { const r = fakeRes(); internals.gallery(r, photoData); return r; }, ['Für Familie', 'Erster Tag', 'Musik abspielen']],
  ['Fotoalbum ohne Musik', () => { const r = fakeRes(); internals.gallery(r, { ...photoData, musicUrl: null }); return r; }, ['Für Familie']],
  ['Fotoalbum leer', () => { const r = fakeRes(); internals.gallery(r, { ...photoData, photos: [], announcement: null, newSince: 0 }); return r; }, ['noch keine Fotos']],
  ['Stammbaum', () => { const r = fakeRes(); internals.treePage(r, treeData, null); return r; }, ['Stammbaum Marina', 'Marina', 'Josefa', 'Etwas ergänzen']],
  ['Stammbaum Personenkarte', () => { const r = fakeRes(); internals.treePage(r, treeData, 'o'); return r; }, ['Huber', 'Zurück zum ganzen Baum']],
  ['Stammbaum leer', () => { const r = fakeRes(); internals.treePage(r, { ...treeData, tree: { nodes: [], unions: [] } }, null); return r; }, ['noch keine Personen']],
  ['Codeformular', () => { const r = fakeRes(); internals.codeForm(r, 'Für Familie', null, 200, 'photos'); return r; }, ['Dein Vorname', 'Zugangscode']],
  ['Nicht verfügbar', () => { const r = fakeRes(); internals.unavailable(r); return r; }, ['Nicht verfügbar']],
  // PWA "Zum Startbildschirm hinzufügen" (task 2026-10-03): every page reachable
  // at /a/<token> must carry the manifest/apple-touch-icon head tags, keyed to
  // THAT token, not a page-wide constant.
  ['Codeformular mit PWA-Tags', () => { const r = fakeRes(); internals.codeForm(r, 'Für Familie', null, 200, 'photos', 'tok-abc'); return r; },
    ['rel="manifest" href="/a/tok-abc/manifest.webmanifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-title']],
  ['Fotoalbum mit PWA-Tags', () => { const r = fakeRes(); internals.gallery(r, photoData, 'tok-abc'); return r; },
    ['rel="manifest" href="/a/tok-abc/manifest.webmanifest"', 'rel="apple-touch-icon"']],
  ['Stammbaum mit PWA-Tags', () => { const r = fakeRes(); internals.treePage(r, treeData, null, 'tok-abc'); return r; },
    ['rel="manifest" href="/a/tok-abc/manifest.webmanifest"', 'rel="apple-touch-icon"']],
];

let failed = 0;
for (const [name, run, expects] of checks) {
  try {
    const res = run();
    const missing = expects.filter((t) => !res.out.includes(t));
    if (res.statusCode < 200 || res.statusCode >= 500) throw new Error('Status ' + res.statusCode);
    if (missing.length) throw new Error('fehlt im Ergebnis: ' + missing.join(', '));
    console.log('  ok   ' + name + '  (' + res.out.length + ' Zeichen)');
  } catch (error) {
    failed++;
    console.log('  FEHL ' + name + '  ' + error.message);
  }
}

// manifestFor() is pure — no network, checked like any other render function.
try {
  const m = internals.manifestFor('tok-xyz');
  if (m.start_url !== '/a/tok-xyz/' || m.scope !== '/a/tok-xyz/') {
    throw new Error('start_url liegt nicht in scope: ' + m.start_url + ' / ' + m.scope);
  }
  if (!m.icons.some((i) => i.purpose === 'maskable')) throw new Error('kein maskable Icon');
  if (m.name !== 'Marinas Album' || m.short_name !== 'Marina') throw new Error('falscher Name');
  console.log('  ok   PWA-Manifest Inhalt  (start_url in scope, maskable Icon vorhanden)');
} catch (error) {
  failed++;
  console.log('  FEHL PWA-Manifest Inhalt  ' + error.message);
}

// manifestRoute() calls the Edge Function over the network (callApi/fetch) —
// stubbed here the same way a real deploy would see 'ok' vs. anything else,
// so this still runs offline like the rest of this file.
async function withStubbedFetch(status, run) {
  const real = global.fetch;
  global.fetch = async () => ({ json: async () => ({ status }) });
  try { return await run(); } finally { global.fetch = real; }
}

async function manifestRouteChecks() {
  try {
    const r = fakeRes();
    await withStubbedFetch('ok', () => internals.manifestRoute(r, 'tok-xyz', { headers: {} }));
    if (r.statusCode !== 200) throw new Error('Status ' + r.statusCode + ' statt 200');
    if (r.headers['Content-Type'] !== 'application/manifest+json; charset=utf-8') {
      throw new Error('falscher Content-Type: ' + r.headers['Content-Type']);
    }
    if (!r.out.includes('tok-xyz')) throw new Error('Token fehlt in start_url');
    console.log('  ok   PWA-Manifest-Route: gültiger Token  (200, application/manifest+json)');
  } catch (error) {
    failed++;
    console.log('  FEHL PWA-Manifest-Route: gültiger Token  ' + error.message);
  }

  try {
    const r = fakeRes();
    await withStubbedFetch('unavailable', () => internals.manifestRoute(r, 'tok-fake', { headers: {} }));
    if (r.statusCode !== 404) throw new Error('Status ' + r.statusCode + ' statt 404');
    // The whole point: an invalid token must get back literally nothing album-related.
    if (r.out.includes('Marina') || r.out.includes('tok-fake')) {
      throw new Error('Antwort verrät Albumdaten: ' + r.out);
    }
    console.log('  ok   PWA-Manifest-Route: erfundener Token  (404, keine Albumdaten)');
  } catch (error) {
    failed++;
    console.log('  FEHL PWA-Manifest-Route: erfundener Token  ' + error.message);
  }
}

// /a/<token> and /a/<token>/ must be the SAME page (task 2026-10-03, Punkt 1):
// start_url in manifestFor() is "/a/<token>/" with a trailing slash, so a
// visitor who launches the installed app must land on a page the router
// treats identically to the un-slashed form everyone's existing links use.
// `handler()` itself does the parsing (parts = pathname.split('/').filter
// (Boolean)), so this exercises the real router, not a reimplementation of it.
function fakeReq(pathname, apiStatus) {
  global.fetch = async () => ({ json: async () => (apiStatus) });
  return { url: pathname, method: 'GET', headers: { host: 'lifebook-album-dabbly.vercel.app' } };
}

async function trailingSlashCheck() {
  try {
    const withoutSlash = fakeRes();
    await internals.handler(fakeReq('/a/tok-slash', { status: 'unavailable' }), withoutSlash);
    const withSlash = fakeRes();
    await internals.handler(fakeReq('/a/tok-slash/', { status: 'unavailable' }), withSlash);
    if (withoutSlash.statusCode !== withSlash.statusCode) {
      throw new Error('unterschiedlicher Status: ' + withoutSlash.statusCode + ' vs. ' + withSlash.statusCode);
    }
    if (withoutSlash.out !== withSlash.out) {
      throw new Error('unterschiedliche Seite ohne/mit Schrägstrich');
    }
    console.log('  ok   /a/<token> und /a/<token>/ liefern dieselbe Seite  (Status ' + withoutSlash.statusCode + ')');
  } catch (error) {
    failed++;
    console.log('  FEHL /a/<token> und /a/<token>/ liefern dieselbe Seite  ' + error.message);
  }
}

manifestRouteChecks().then(trailingSlashCheck).then(() => {
  console.log(failed ? '\n' + failed + ' Rauchprobe(n) fehlgeschlagen' : '\nAlle Rauchproben bestanden');
  process.exit(failed ? 1 : 0);
});
