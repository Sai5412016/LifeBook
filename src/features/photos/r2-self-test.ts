/**
 * photos/r2-self-test — rates the "R2-Verbindung prüfen" check in
 * Einstellungen (PR 2, 2026-11-26). Pure; ./storage.ts#runR2SelfTest makes
 * the requests, with the signed-in person's own token — the only way to run
 * the acceptance in docs/r2.md on a phone without developer tools.
 *
 * Shows status codes and R2's short error codes only — never a URL, a key or
 * a token (the same rule as media-sign itself).
 */

export type R2SelfTestInput = {
  /** media-sign with an invalid body (op "list"): expected 400 invalid_request. */
  invalid: { status: number; code: string | null };
  /** An old photo whose original is in Supabase, NOT in R2: expected R2 404 NoSuchKey. */
  oldPhoto: null | {
    signStatus: number;
    signCode: string | null;
    /** null when the request to R2 itself failed (DNS, TLS, no network). */
    probeStatus: number | null;
    probeCode: string | null;
  };
  /** The newest photo with original_store 'r2': stored size must equal the row's size. */
  newPhoto: null | { rowBytes: number | null; storedBytes: number | null; error: string | null };
};

export type R2SelfTestResult = { ok: boolean; lines: string[] };

/** What a wrong R2 answer points to — the secret names from docs/r2.md. */
function hintForR2Failure(status: number | null, code: string | null): string {
  if (status === null) return 'R2 nicht erreichbar – R2_ENDPOINT prüfen';
  if (code === 'SignatureDoesNotMatch') return 'Signatur falsch – R2_SECRET_ACCESS_KEY prüfen';
  if (code === 'InvalidAccessKeyId') return 'Schlüssel unbekannt – R2_ACCESS_KEY_ID prüfen';
  if (code === 'NoSuchBucket') return 'Bucket fehlt – R2_BUCKET_ORIGINALS prüfen';
  if (code === 'AccessDenied') return 'Zugriff verweigert – Rechte des R2-Tokens prüfen';
  return 'unerwartete Antwort';
}

export function evaluateR2SelfTest(input: R2SelfTestInput): R2SelfTestResult {
  const lines: string[] = [];
  let ok = true;

  const invalidOk = input.invalid.status === 400 && input.invalid.code === 'invalid_request';
  ok &&= invalidOk;
  lines.push(
    `Ungültige Anfrage: ${input.invalid.status} ${input.invalid.code ?? ''}`.trim() + (invalidOk ? ' ✓' : ' ✗ (erwartet 400)'),
  );

  if (!input.oldPhoto) {
    ok = false;
    lines.push('Signatur-Probe: kein altes Foto zum Prüfen gefunden');
  } else if (input.oldPhoto.signStatus !== 200) {
    ok = false;
    const notConfigured = input.oldPhoto.signCode === 'not_configured';
    lines.push(
      `Signatur-Probe: media-sign ${input.oldPhoto.signStatus} ${input.oldPhoto.signCode ?? ''} ✗` +
        (notConfigured ? ' – mindestens ein R2-Secret fehlt' : ''),
    );
  } else {
    const probeOk = input.oldPhoto.probeStatus === 404 && input.oldPhoto.probeCode === 'NoSuchKey';
    ok &&= probeOk;
    lines.push(
      probeOk
        ? 'Signatur-Probe: R2 404 NoSuchKey ✓ (Endpoint, Bucket, Schlüssel und Signatur stimmen)'
        : `Signatur-Probe: R2 ${input.oldPhoto.probeStatus ?? 'keine Antwort'} ${input.oldPhoto.probeCode ?? ''} ✗ – ${hintForR2Failure(
            input.oldPhoto.probeStatus,
            input.oldPhoto.probeCode,
          )}`,
    );
  }

  if (!input.newPhoto) {
    lines.push('Neues Foto in R2: noch keines vorhanden (erst ein Foto importieren, im WLAN hochladen lassen)');
  } else if (input.newPhoto.error) {
    ok = false;
    lines.push(`Neues Foto in R2: ✗ ${input.newPhoto.error}`);
  } else {
    const same =
      input.newPhoto.rowBytes !== null && input.newPhoto.storedBytes !== null && input.newPhoto.rowBytes === input.newPhoto.storedBytes;
    ok &&= same;
    lines.push(
      same
        ? `Neues Foto in R2: ${input.newPhoto.storedBytes} Bytes, gleich groß wie das Original ✓`
        : `Neues Foto in R2: R2 ${input.newPhoto.storedBytes ?? 'nicht gefunden'} Bytes, Original ${input.newPhoto.rowBytes ?? '?'} Bytes ✗`,
    );
  }

  return { ok, lines };
}
