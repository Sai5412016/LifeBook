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
  + 'manifestFor, manifestRoute, pwaHeadTags, installHint, handler };')();

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

// ---------------------------------------------------------------------------
// "Zum Startbildschirm hinzufügen"-Hinweis (task 2026-10-03, zweiter Teil)
// ---------------------------------------------------------------------------
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    (detail) => console.log('  ok   ' + name + (detail ? '  (' + detail + ')' : '')),
    (error) => { failed++; console.log('  FEHL ' + name + '  ' + error.message); });
}
function assert(cond, message) { if (!cond) throw new Error(message); }
const HINT = 'id="lbInstall"';

function fakePost(pathname, apiStatus) {
  global.fetch = async () => ({ json: async () => (apiStatus) });
  return {
    url: pathname, method: 'POST', headers: { host: 'lifebook-album-dabbly.vercel.app' },
    on(ev, cb) {
      if (ev === 'data') setImmediate(() => cb('visitor=Rosi&code=ABC'));
      if (ev === 'end') setImmediate(() => setImmediate(cb));
    },
    destroy() {},
  };
}

// Runs the hint's own inline <script> against a stub browser. Only the parts
// the script touches are stubbed; anything else it reached for would throw
// here — which is exactly the "free identifier" class of bug this file exists
// to catch.
function runHint(opts) {
  const html = internals.installHint();
  const js = html.match(/<script>([\s\S]*?)<\/script>$/)[1];
  // Markup only: the script itself also contains '[data-mode="android"]'.
  const markup = html.slice(0, html.indexOf('<script>'));
  const el = (attrs) => ({
    hidden: true, attrs: attrs || {}, listeners: {},
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    click() { (this.listeners.click || []).forEach((f) => f()); },
  });
  const parts = [...markup.matchAll(/data-mode="(\w+)"/g)].map((m) => el({ 'data-mode': m[1] }));
  assert(parts.map((p) => p.attrs['data-mode']).join() === 'prompt,android,ios,inapp', 'Varianten im Markup geändert');
  const dismiss = (markup.match(/class="install-dismiss"/g) || []).map(() => el());
  const osParts = [...markup.matchAll(/data-os="(\w+)"/g)].map((m) => el({ 'data-os': m[1] }));
  const go = el();
  const box = el();
  box.querySelectorAll = (sel) => (sel === '[data-mode]' ? parts : sel === '.install-dismiss' ? dismiss
    : sel === '[data-os]' ? osParts : []);
  box.querySelector = (sel) => {
    const m = sel.match(/data-mode="(\w+)"/);
    return m ? parts.find((p) => p.attrs['data-mode'] === m[1]) : null;
  };
  const doc = { getElementById: (id) => (id === 'lbInstall' ? box : id === 'lbInstallGo' ? go : null) };
  const store = new Map(opts.stored ? [[opts.stored, '1']] : []);
  const timers = [];
  const winListeners = {};
  const win = {
    location: { pathname: opts.path || '/a/tok-1' },
    navigator: {
      userAgent: opts.ua, platform: opts.platform || '', maxTouchPoints: opts.touch || 0,
      standalone: opts.iosStandalone === true,
    },
    matchMedia: (q) => ({ matches: !!opts.displayStandalone && q === '(display-mode: standalone)' }),
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    setTimeout(f) { timers.push(f); },
  };
  if (opts.storage === 'throws') {
    win.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  } else if (opts.storage === 'getter-throws') {
    Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else {
    win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  }
  new Function('window', 'document', js)(win, doc);
  return {
    store, go, dismiss,
    shown() { return box.hidden ? null : parts.filter((p) => !p.hidden).map((p) => p.attrs['data-mode']).join('+'); },
    osShown() { return osParts.filter((p) => !p.hidden).map((p) => p.attrs['data-os']).join('+'); },
    fire(type, ev) { (winListeners[type] || []).forEach((f) => f(ev)); },
    runTimers() { timers.splice(0).forEach((f) => f()); },
    clickDismissOf(mode) {
      // Any dismiss button calls the same handler; which one is clicked does not matter.
      assert(this.shown() && this.shown().includes(mode), 'Modus ' + mode + ' nicht sichtbar');
      dismiss[0].click();
    },
  };
}
function installEvent(outcome) {
  return { prompted: 0, preventDefault() {}, prompt() { this.prompted++; }, userChoice: Promise.resolve({ outcome }) };
}
const tick = () => new Promise((r) => setImmediate(r));

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};
const ANDROID = { ua: UA.androidChrome, platform: 'Linux armv8l', touch: 5 };
const IPHONE = { ua: UA.iphoneSafari, platform: 'iPhone', touch: 5 };

async function installHintChecks() {
  // --- where the hint is (and is not) rendered ---------------------------
  await check('Hinweis auf Codeformular, UNTER dem Formular', () => {
    const r = fakeRes(); internals.codeForm(r, 'Für Familie', null, 200, 'photos', 'tok-1');
    assert(r.out.includes(HINT), 'Hinweis fehlt');
    assert(r.out.indexOf(HINT) > r.out.indexOf('</form>'), 'Hinweis steht über dem Eingabeformular');
  });
  await check('Hinweis auf Galerie (oben)', () => {
    const r = fakeRes(); internals.gallery(r, photoData, 'tok-1');
    assert(r.out.includes(HINT) && r.out.indexOf(HINT) < r.out.indexOf('<h1>'), 'fehlt oder nicht oben');
  });
  await check('Hinweis auf Stammbaum, auch leer', () => {
    for (const data of [treeData, { ...treeData, tree: { nodes: [], unions: [] } }]) {
      const r = fakeRes(); internals.treePage(r, data, null, 'tok-1');
      assert(r.out.includes(HINT), 'fehlt');
    }
  });
  await check('Hinweis auf "Alle Plätze vergeben" (über den Router)', async () => {
    const r = fakeRes();
    await internals.handler(fakePost('/a/tok-1', { status: 'seats_full', name: 'Für Familie' }), r);
    assert(r.statusCode === 403 && r.out.includes('Alle Plätze vergeben'), 'falsche Seite: ' + r.statusCode);
    assert(r.out.includes(HINT), 'fehlt');
  });
  await check('KEIN Hinweis auf "/"', async () => {
    const r = fakeRes(); await internals.handler(fakeReq('/', {}), r);
    assert(r.statusCode === 200 && !r.out.includes(HINT), 'Hinweis auf der Startseite');
  });
  await check('KEIN Hinweis auf "Nicht verfügbar"', async () => {
    const r = fakeRes(); await internals.handler(fakeReq('/a/tok-x', { status: 'unavailable' }), r);
    assert(r.statusCode === 404 && !r.out.includes(HINT), 'Hinweis auf der Fehlerseite');
    const d = fakeRes(); internals.unavailable(d);
    assert(!d.out.includes(HINT), 'Hinweis in unavailable()');
  });

  // --- what the inline script does ---------------------------------------
  await check('Skript: Desktop zeigt nie etwas', () => {
    const h = runHint({ ua: UA.desktop, platform: 'Win32' });
    h.fire('beforeinstallprompt', installEvent('accepted')); h.runTimers();
    assert(h.shown() === null, 'sichtbar: ' + h.shown());
  });
  await check('Skript: über das Symbol geöffnet (standalone) zeigt nie etwas', () => {
    const a = runHint({ ...ANDROID, displayStandalone: true });
    a.fire('beforeinstallprompt', installEvent('accepted')); a.runTimers();
    const i = runHint({ ...IPHONE, iosStandalone: true });
    assert(a.shown() === null && i.shown() === null, 'sichtbar: ' + a.shown() + ' / ' + i.shown());
  });
  await check('Skript: Android zeigt den Knopf erst nach beforeinstallprompt', () => {
    const h = runHint(ANDROID);
    assert(h.shown() === null, 'schon vorher sichtbar');
    h.fire('beforeinstallprompt', installEvent('dismissed'));
    assert(h.shown() === 'prompt', 'nach Ereignis: ' + h.shown());
  });
  await check('Skript: Abbruch des Dialogs blendet NICHT aus', async () => {
    const h = runHint(ANDROID); const ev = installEvent('dismissed');
    h.fire('beforeinstallprompt', ev); h.go.click(); await tick();
    assert(ev.prompted === 1, 'prompt() nicht aufgerufen');
    assert(h.shown() === 'prompt' && h.store.size === 0, 'ausgeblendet/gemerkt nach Abbruch');
    h.go.click();
    assert(h.shown() === 'prompt+android', 'zweiter Tipp ohne Ereignis ist toter Knopf: ' + h.shown());
  });
  await check('Skript: angenommener Dialog blendet dauerhaft aus', async () => {
    const h = runHint(ANDROID);
    h.fire('beforeinstallprompt', installEvent('accepted')); h.go.click(); await tick();
    assert(h.shown() === null && h.store.get('lb_install_hint:/a/tok-1') === '1', 'nicht ausgeblendet/gemerkt');
  });
  await check('Skript: appinstalled blendet dauerhaft aus', () => {
    const h = runHint(ANDROID);
    h.fire('beforeinstallprompt', installEvent('dismissed')); h.fire('appinstalled', {});
    assert(h.shown() === null && h.store.size === 1, 'nicht ausgeblendet/gemerkt');
  });
  await check('Skript: Android ohne Ereignis -> Kurzanleitung, "Erledigt" merkt', () => {
    const h = runHint(ANDROID); h.runTimers();
    assert(h.shown() === 'android', 'statt Anleitung: ' + h.shown());
    h.clickDismissOf('android');
    assert(h.shown() === null && h.store.size === 1, 'nicht gemerkt');
    h.fire('beforeinstallprompt', installEvent('accepted'));
    assert(h.shown() === null, 'kam nach dem Ausblenden zurück');
  });
  await check('Skript: iPhone -> Teilen-Anleitung, "Erledigt" merkt', () => {
    const h = runHint(IPHONE);
    assert(h.shown() === 'ios', 'statt iOS-Anleitung: ' + h.shown());
    h.clickDismissOf('ios');
    assert(h.shown() === null && h.store.size === 1, 'nicht gemerkt');
  });
  await check('Skript: In-App-Browser -> "Im Browser öffnen"', () => {
    const a = runHint({ ...ANDROID, ua: UA.androidWebView }); a.runTimers();
    const i = runHint({ ...IPHONE, ua: UA.iphoneInstagram });
    assert(a.shown() === 'inapp' && i.shown() === 'inapp', a.shown() + ' / ' + i.shown());
  });
  await check('Skript: In-App-Browser zeigt nur den Satz der eigenen Plattform', () => {
    const a = runHint({ ...ANDROID, ua: UA.androidWebView });
    const i = runHint({ ...IPHONE, ua: UA.iphoneInstagram });
    assert(a.osShown() === 'android', 'Android: ' + a.osShown());
    assert(i.osShown() === 'ios', 'iPhone: ' + i.osShown());
  });
  await check('Hinweistexte je Variante (Samsung-Satz, Browser-Satz pro Plattform)', () => {
    const html = internals.installHint();
    const block = (attr) => {
      const start = html.indexOf(attr);
      assert(start !== -1, attr + ' fehlt');
      return html.slice(start, html.indexOf('</div>', start));
    };
    const where = 'Danach findest du Marina auf dem Startbildschirm oder in deiner App-Übersicht.';
    const androidFallback = 'Klappt das nicht? Tippe oben rechts auf ⋮ und dann auf „In Chrome öffnen“.';
    const iosFallback = 'Klappt das nicht? Öffne die Seite zuerst in Safari.';
    const prompt = block('data-mode="prompt"');
    assert(prompt.indexOf(where) !== -1 && prompt.indexOf(where) < prompt.indexOf('id="lbInstallGo"'),
      'Knopf-Variante: Samsung-Satz fehlt oder steht nach dem Knopf');
    const android = block('data-mode="android"');
    assert(android.indexOf('Zum Startbildschirm hinzufügen“.') < android.indexOf(where)
      && android.indexOf(where) < android.indexOf(androidFallback), 'Android-Anleitung: Reihenfolge/Text');
    const ios = block('data-mode="ios"');
    assert(ios.includes(iosFallback) && !ios.includes('⋮') && !ios.includes('Chrome'), 'iPhone-Text');
    const inapp = block('data-mode="inapp"');
    assert(inapp.includes(androidFallback) && inapp.includes(iosFallback), 'In-App-Texte');
    assert(!html.includes('bzw.'), 'noch ein "bzw." im Hinweis');
  });
  await check('Skript: gemerkt pro Album-Pfad (mit/ohne Schrägstrich gleich)', () => {
    const same = runHint({ ...IPHONE, path: '/a/tok-1/', stored: 'lb_install_hint:/a/tok-1' });
    const other = runHint({ ...IPHONE, path: '/a/tok-2', stored: 'lb_install_hint:/a/tok-1' });
    assert(same.shown() === null, 'trotz Merken sichtbar');
    assert(other.shown() === 'ios', 'anderes Album fälschlich ausgeblendet');
  });
  await check('Skript: localStorage blockiert -> kein Fehler, Hinweis erscheint', async () => {
    for (const storage of ['throws', 'getter-throws']) {
      const h = runHint({ ...ANDROID, storage });
      h.fire('beforeinstallprompt', installEvent('accepted'));
      assert(h.shown() === 'prompt', storage + ': ' + h.shown());
      h.go.click(); await tick();
      assert(h.shown() === null, storage + ': nach Annahme nicht ausgeblendet');
      const i = runHint({ ...IPHONE, storage });
      assert(i.shown() === 'ios', storage + ' iOS: ' + i.shown());
      i.clickDismissOf('ios');
    }
    return 'getItem/setItem werfen, Zugriff auf localStorage wirft';
  });
}

manifestRouteChecks().then(trailingSlashCheck).then(installHintChecks).then(() => {
  console.log(failed ? '\n' + failed + ' Rauchprobe(n) fehlgeschlagen' : '\nAlle Rauchproben bestanden');
  process.exit(failed ? 1 : 0);
});
