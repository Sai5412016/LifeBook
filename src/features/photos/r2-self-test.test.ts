import { describe, expect, it } from 'vitest';

import { evaluateR2SelfTest, type R2SelfTestInput } from './r2-self-test';

const PASS: R2SelfTestInput = {
  invalid: { status: 400, code: 'invalid_request' },
  oldPhoto: { signStatus: 200, signCode: null, probeStatus: 404, probeCode: 'NoSuchKey' },
  newPhoto: { rowBytes: 7116470, storedBytes: 7116470, error: null },
};

describe('R2 self-test (first acceptance of PR 2, docs/r2.md)', () => {
  it('all as expected → ok, three ✓ lines', () => {
    const result = evaluateR2SelfTest(PASS);
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([
      'Ungültige Anfrage: 400 invalid_request ✓',
      'Signatur-Probe: R2 404 NoSuchKey ✓ (Endpoint, Bucket, Schlüssel und Signatur stimmen)',
      'Neues Foto in R2: 7116470 Bytes, gleich groß wie das Original ✓',
    ]);
  });

  it('403 SignatureDoesNotMatch is a failure that names the secret to check', () => {
    const result = evaluateR2SelfTest({
      ...PASS,
      oldPhoto: { signStatus: 200, signCode: null, probeStatus: 403, probeCode: 'SignatureDoesNotMatch' },
    });
    expect(result.ok).toBe(false);
    expect(result.lines[1]).toContain('R2_SECRET_ACCESS_KEY prüfen');
  });

  it('names the right secret for each wrong R2 answer', () => {
    const line = (probeStatus: number | null, probeCode: string | null) =>
      evaluateR2SelfTest({ ...PASS, oldPhoto: { signStatus: 200, signCode: null, probeStatus, probeCode } }).lines[1];
    expect(line(403, 'InvalidAccessKeyId')).toContain('R2_ACCESS_KEY_ID');
    expect(line(404, 'NoSuchBucket')).toContain('R2_BUCKET_ORIGINALS');
    expect(line(null, null)).toContain('R2_ENDPOINT');
  });

  it('media-sign 500 not_configured says a secret is missing', () => {
    const result = evaluateR2SelfTest({
      ...PASS,
      oldPhoto: { signStatus: 500, signCode: 'not_configured', probeStatus: null, probeCode: null },
    });
    expect(result.ok).toBe(false);
    expect(result.lines[1]).toContain('mindestens ein R2-Secret fehlt');
  });

  it('an invalid request that is NOT answered with 400 fails', () => {
    expect(evaluateR2SelfTest({ ...PASS, invalid: { status: 401, code: 'not_signed_in' } }).ok).toBe(false);
  });

  it('a new photo whose R2 size differs fails; no R2 photo yet is only a note', () => {
    expect(evaluateR2SelfTest({ ...PASS, newPhoto: { rowBytes: 10, storedBytes: 9, error: null } }).ok).toBe(false);
    const none = evaluateR2SelfTest({ ...PASS, newPhoto: null });
    expect(none.ok).toBe(true);
    expect(none.lines[2]).toContain('noch keines vorhanden');
  });

  it('no line ever contains a URL', () => {
    const result = evaluateR2SelfTest({
      ...PASS,
      newPhoto: { rowBytes: 1, storedBytes: null, error: 'R2 size-check HTTP 403 (SignatureDoesNotMatch)' },
    });
    expect(result.lines.join('\n')).not.toMatch(/https?:/);
  });
});
