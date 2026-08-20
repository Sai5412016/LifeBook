/**
 * shares/logic — pure decisions for the guest-access feature: the random
 * token/code encoding, the share link, confirmation and disclosure text,
 * and the small bits of counting/diffing the screens would otherwise do
 * inline. Deliberately free of any Expo / React Native / Supabase import
 * (except @/core/time, itself framework-free) so it runs in plain Node
 * under Vitest — the device- and network-touching side lives in
 * ./repository.
 */

import { formatDayLabel, formatTimeLabel, toLocalDate } from '@/core/time';

import type { ShareDeviceRow, ShareRow, ShareSummary } from './types';

/* ────────────────────────────── Aufgabe 1: token & access code ────────────────────────────── */

const TOKEN_MIN_BYTES = 32;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes cryptographically random bytes as a URL-safe token for the share
 * link — base64url, no padding. `randomBytes` must be the caller's OWN
 * source of randomness (device code passes `expo-crypto`'s `getRandomBytes`,
 * NEVER `Math.random` — see repository.ts), supplied as a parameter rather
 * than generated in here, so this function stays pure and its OUTPUT SHAPE
 * (length, alphabet) is what gets tested — not the randomness itself, which
 * no unit test can meaningfully assert on.
 *
 * At least 32 bytes (256 bits) — enough that guessing a live token by brute
 * force is infeasible even at a very high request rate.
 */
export function generateShareToken(randomBytes: Uint8Array): string {
  if (randomBytes.length < TOKEN_MIN_BYTES) {
    throw new Error(
      `shares: token needs at least ${TOKEN_MIN_BYTES} random bytes, got ${randomBytes.length}`,
    );
  }

  let token = '';
  for (let i = 0; i < randomBytes.length; i += 3) {
    const b0 = randomBytes[i];
    const b1 = i + 1 < randomBytes.length ? randomBytes[i + 1] : undefined;
    const b2 = i + 2 < randomBytes.length ? randomBytes[i + 2] : undefined;

    token += BASE64URL_ALPHABET[b0 >> 2];
    token += BASE64URL_ALPHABET[((b0 & 0b11) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) {
      token += BASE64URL_ALPHABET[((b1 & 0b1111) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    }
    if (b2 !== undefined) {
      token += BASE64URL_ALPHABET[b2 & 0b111111];
    }
  }
  return token;
}

export const ACCESS_CODE_LENGTH = 6;

/**
 * WHY THIS ALPHABET
 * ------------------
 * The access code is read aloud over the phone or typed by hand from a
 * sticky note, so it excludes every character pair a person could easily
 * mix up: `O` (letter) vs `0` (digit), and `I` (letter) vs `1` (digit) vs
 * lowercase `l` — the code is uppercase-only, which already removes
 * lowercase `l` from the alphabet entirely, so only the letters `I` and `O`
 * need to be dropped on top of that. Every other digit and letter (0-9,
 * A-Z minus I/O) stays — 34 characters.
 */
const ACCESS_CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * A 6-character code from `ACCESS_CODE_ALPHABET`, drawn from `randomBytes`
 * by REJECTION SAMPLING rather than `byte % alphabet.length`: 256 is not a
 * multiple of 34, so a plain modulo would make the first 256 - 238 = 18
 * characters of the alphabet very slightly more likely than the rest. For a
 * code that gates access to a child's photos, "very slightly biased" is a
 * bias worth just not having. Bytes at or above 238 (the largest multiple
 * of 34 not exceeding 256) are discarded and the next byte tried instead —
 * `randomBytes` should be generous (the caller reuses the same 32 bytes
 * fetched for the token) since a handful of bytes are expected to be
 * discarded this way.
 *
 * Same injected-randomness contract as `generateShareToken` — see its doc
 * comment for why.
 */
export function generateAccessCode(randomBytes: Uint8Array): string {
  const alphabetSize = ACCESS_CODE_ALPHABET.length;
  const rejectionCeiling = Math.floor(256 / alphabetSize) * alphabetSize;

  let code = '';
  let index = 0;
  while (code.length < ACCESS_CODE_LENGTH) {
    if (index >= randomBytes.length) {
      throw new Error('shares: ran out of random bytes while generating an access code');
    }
    const byte = randomBytes[index];
    index += 1;
    if (byte >= rejectionCeiling) {
      continue;
    }
    code += ACCESS_CODE_ALPHABET[byte % alphabetSize];
  }
  return code;
}

/* ────────────────────────────── Aufgabe 3: link, message, labels ────────────────────────────── */

/**
 * 2026-08-14: the viewing page does NOT live behind the Supabase project
 * URL — Supabase refuses to serve HTML on a `supabase.co` address and
 * sandboxes the response instead (confirmed on-device: raw source instead
 * of a rendered page, mangled umlauts, cookies blocked). The `album` Edge
 * Function now serves JSON only; the actual page is a separate Vercel
 * deployment. This constant is the ONE place that address is written down
 * — every caller in this feature builds the link through `buildShareLink`,
 * never by concatenating a URL of its own, so the day a custom domain
 * replaces this one there is exactly one line to change.
 */
const SHARE_VIEWER_BASE_URL = 'https://lifebook-album-dabbly.vercel.app';

/** The viewing link handed to a guest — the access CODE is the second factor, entered on the page itself. */
export function buildShareLink(token: string): string {
  return `${SHARE_VIEWER_BASE_URL}/a/${token}`;
}

/**
 * The single message handed to React Native's built-in `Share.share()` —
 * link and code together (task's explicit choice, see the session report
 * for the trade-off against sending them separately).
 */
export function formatShareMessage(name: string, link: string, accessCode: string): string {
  return `${name} — Fotos aus LifeBook\n\n${link}\n\nZugangscode: ${accessCode}`;
}

/** "aktiv" / "widerrufen" — the overview list's state label. */
export function describeShareState(revokedAt: string | null): 'aktiv' | 'widerrufen' {
  return revokedAt ? 'widerrufen' : 'aktiv';
}

/** "3 von 5 Geräten" — the overview list's device count, always against the CURRENT limit. */
export function formatDeviceCountLabel(deviceCount: number, deviceLimit: number): string {
  return `${deviceCount} von ${deviceLimit} Geräten`;
}

/** "12 Fotos" / "1 Foto" / "Keine Fotos" — the overview list's photo count. */
export function formatPhotoCountLabel(photoCount: number): string {
  if (photoCount === 0) {
    return 'Keine Fotos';
  }
  return photoCount === 1 ? '1 Foto' : `${photoCount} Fotos`;
}

/**
 * A photo without a medium rendition could not actually be delivered by
 * Stufe 2 (which will serve the medium, never the multi-MB original, to a
 * guest) — so it must not even be selectable here. Same field the
 * fullscreen viewer's own fallback chain already depends on
 * (photos/identity.ts#resolveFullscreenUri).
 */
export function isPhotoReadyForShare(photo: { medium_key: string | null }): boolean {
  return photo.medium_key !== null;
}

/** The revoke-confirmation dialog body — states plainly what changes and what doesn't. */
export function formatRevokeConfirmation(name: string): string {
  return `„${name}" wird widerrufen. Der Link funktioniert danach nicht mehr, die Freigabe bleibt aber in der Liste sichtbar und kann bei Bedarf gelöscht werden.`;
}

/** The delete-confirmation dialog body — states plainly that it is final. */
export function formatDeleteConfirmation(name: string): string {
  return `„${name}" wird endgültig gelöscht, mit Fotoauswahl und allen verbundenen Geräten. Das kann nicht rückgängig gemacht werden.`;
}

/**
 * Aufgabe 4 — the honest-disclosure line shown in every share's detail
 * view. Deliberately flat, factual wording: no exclamation mark, no
 * alarmist framing — just what is true, so nobody can later say they
 * weren't told.
 */
export const SHARE_DISCLOSURE_TEXT =
  'Wer Link und Zugangscode kennt, kann die freigegebenen Fotos ansehen und speichern. Die Freigabe lässt sich jederzeit widerrufen.';

/** "Erster Zugriff: … · Letzter Zugriff: …" for one device row, in the CURRENT device's own timezone (the parent reading this list, not the guest device). */
export function formatDeviceSeenLabel(firstSeenAtUtcIso: string, lastSeenAtUtcIso: string, tz: string): string {
  const format = (instant: string) => `${formatDayLabel(toLocalDate(instant, tz))} · ${formatTimeLabel(instant, tz)}`;
  return `Erster Zugriff: ${format(firstSeenAtUtcIso)}\nLetzter Zugriff: ${format(lastSeenAtUtcIso)}`;
}

/* ────────────────────────────── Gerätename aus dem User-Agent (2026-08-18) ────────────────────────────── */

/**
 * WARUM DIE REIHENFOLGE HIER ENTSCHEIDEND IST
 * --------------------------------------------
 * User-Agent-Zeichenketten enthalten aus Kompatibilitätsgründen absichtlich
 * die Namen ANDERER Systeme und Browser. Wer zuerst auf das Naheliegende
 * prüft, bekommt systematisch die falsche Antwort:
 *  - Ein iPhone meldet „like Mac OS X" — Mac zuerst geprüft, und jedes
 *    iPhone hieße „Mac".
 *  - Android meldet „Linux; Android 14" — Linux zuerst, und jedes
 *    Android-Handy hieße „Linux".
 *  - Chrome meldet „… Chrome/120 … Safari/537.36" — Safari zuerst, und
 *    jeder Chrome hieße „Safari".
 *  - Edge meldet „… Chrome/120 … Edg/120", Samsung Internet meldet
 *    „… Chrome/… SamsungBrowser/23" — Chrome zuerst, und beide hießen
 *    „Chrome".
 * Beide Listen sind deshalb bewusst geordnet, das erste Muster gewinnt.
 * Die Tests decken genau diese Verwechslungen ab.
 */
const PLATFORM_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /iPhone/i, name: 'iPhone' },
  { pattern: /iPad/i, name: 'iPad' },
  { pattern: /iPod/i, name: 'iPod' },
  { pattern: /Android/i, name: 'Android' },
  { pattern: /CrOS/i, name: 'Chromebook' },
  { pattern: /Windows/i, name: 'Windows' },
  { pattern: /Macintosh|Mac OS X/i, name: 'Mac' },
  { pattern: /Linux/i, name: 'Linux' },
];

const BROWSER_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /Edg(?:iOS|A|e)?\//i, name: 'Edge' },
  { pattern: /SamsungBrowser\//i, name: 'Samsung Internet' },
  { pattern: /OPR\/|Opera/i, name: 'Opera' },
  { pattern: /Firefox\/|FxiOS\//i, name: 'Firefox' },
  { pattern: /CriOS\/|Chrome\/|Chromium\//i, name: 'Chrome' },
  { pattern: /Safari\//i, name: 'Safari' },
];

const matchFirst = (userAgent: string, patterns: { pattern: RegExp; name: string }[]): string | null =>
  patterns.find((entry) => entry.pattern.test(userAgent))?.name ?? null;

/**
 * Ein kurzer, für Eltern lesbarer Name aus dem User-Agent eines
 * Gastgeräts — „iPhone · Safari", „Windows · Chrome". Zweck ist nur das
 * Wiedererkennen in der Geräteliste einer Freigabe („welches davon ist
 * Omas Tablet?"), nicht eine genaue Geräteerkennung: Version, Modellcode
 * und Aufbau bleiben bewusst weg. Ein Modellcode wie „SM-S911B" steht zwar
 * im Android-User-Agent, sagt aber niemandem etwas.
 *
 * Gibt `null` zurück, wenn sich weder System noch Browser erkennen lassen
 * — dann hat der Aufrufer nichts Besseres als seinen eigenen Platzhalter,
 * und eine geratene Angabe wäre schlechter als gar keine.
 */
export function describeDeviceFromUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent || userAgent.trim().length === 0) {
    return null;
  }

  const platform = matchFirst(userAgent, PLATFORM_PATTERNS);
  const browser = matchFirst(userAgent, BROWSER_PATTERNS);

  if (platform && browser) {
    return `${platform} · ${browser}`;
  }
  return platform ?? browser;
}

/**
 * Der Name, der in der Geräteliste einer Freigabe steht. Ein selbst
 * vergebenes `label` gewinnt immer — es ist das Einzige, was ein Mensch
 * bewusst gesetzt hat. Sonst der abgeleitete Kurzname, und erst wenn auch
 * der nicht zu ermitteln ist, der Platzhalter.
 */
export function formatShareDeviceName(
  label: string | null | undefined,
  userAgent: string | null | undefined,
): string {
  const trimmedLabel = label?.trim();
  if (trimmedLabel) {
    return trimmedLabel;
  }
  return describeDeviceFromUserAgent(userAgent) ?? 'Unbenanntes Gerät';
}

export const DEVICE_LIMIT_CHOICES = [1, 3, 5, 10, 20] as const;
export const DEFAULT_DEVICE_LIMIT = 5;

/* ────────────────────────────── Aufgabe 2: repository-facing pure helpers ────────────────────────────── */

/**
 * Attaches photo/device counts to each share — plain JS counting instead of
 * relying on a PostgREST count-embed (uncertain to be available/enabled)
 * or a SQL aggregate (which is exactly the kind of opaque expression that
 * already caused a swapped-count bug once in this codebase — see the
 * medium-backfill "Fehler 2" fix). `sharePhotoRows`/`shareDeviceRows` are
 * the raw `{ share_id }` rows for ALL of `shares` at once, not per-share
 * queries — one repository round trip each, counted here.
 */
export function summarizeShares(
  shares: readonly ShareRow[],
  sharePhotoRows: readonly { share_id: string }[],
  shareDeviceRows: readonly { share_id: string }[],
): ShareSummary[] {
  const photoCounts = countByShareId(sharePhotoRows);
  const deviceCounts = countByShareId(shareDeviceRows);
  return shares.map((share) => ({
    ...share,
    photoCount: photoCounts.get(share.id) ?? 0,
    deviceCount: deviceCounts.get(share.id) ?? 0,
  }));
}

function countByShareId(rows: readonly { share_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.share_id, (counts.get(row.share_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which photo ids to add and remove to turn `currentIds` into `nextIds` —
 * the editable-photo-selection screen's own save step, kept out of the
 * screen so the set-difference itself is testable without a database.
 */
export function diffPhotoSelection(
  currentIds: readonly string[],
  nextIds: readonly string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(currentIds);
  const nextSet = new Set(nextIds);
  return {
    toAdd: nextIds.filter((id) => !currentSet.has(id)),
    toRemove: currentIds.filter((id) => !nextSet.has(id)),
  };
}

/** Turns a Supabase/Postgrest error into readable, diagnostic text — same shape as core/notifications/logic.ts#describeSupabaseError, kept local so this feature has no dependency on that one. */
export function describeSupabaseError(error: { message: string; code?: string | null }): string {
  return error.code ? `${error.message} (Code ${error.code})` : error.message;
}

export type { ShareDeviceRow, ShareRow, ShareSummary };
