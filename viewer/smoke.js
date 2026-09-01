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
const internals = new Function(body + '\n; return { gallery, treePage, codeForm, unavailable, sendPage, handler };')();

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
console.log(failed ? '\n' + failed + ' Rauchprobe(n) fehlgeschlagen' : '\nAlle Rauchproben bestanden');
process.exit(failed ? 1 : 0);
