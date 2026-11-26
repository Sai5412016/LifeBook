import { describe, expect, it } from 'vitest';

import {
  MediaSignError,
  R2RequestError,
  SIZE_PROBE_RANGE,
  assertPutHeadersMatch,
  buildMediaSignBody,
  isR2Success,
  parseMediaSignResponse,
  r2ErrorCode,
  storedSizeFromRangeProbe,
} from './media-sign-protocol';

const URL_PUT = 'https://acct.eu.r2.cloudflarestorage.com/lifebook-originals/hh/p/orig.jpg?X-Amz-Signature=abc';

describe('request body', () => {
  it('get/delete send only photo_id and op', () => {
    expect(buildMediaSignBody('p', 'get')).toEqual({ photo_id: 'p', op: 'get' });
    expect(buildMediaSignBody('p', 'delete')).toEqual({ photo_id: 'p', op: 'delete' });
  });

  it('put sends content_type and the real byte count', () => {
    expect(buildMediaSignBody('p', 'put', { contentType: 'IMAGE/JPEG', bytes: 7116470 })).toEqual({
      photo_id: 'p',
      op: 'put',
      content_type: 'image/jpeg',
      bytes: 7116470,
    });
  });

  it('put without a real size is refused before anything is sent', () => {
    expect(() => buildMediaSignBody('p', 'put')).toThrow();
    expect(() => buildMediaSignBody('p', 'put', { contentType: 'image/jpeg', bytes: 0 })).toThrow();
    expect(() => buildMediaSignBody('p', 'put', { contentType: 'image/jpeg', bytes: 1.5 })).toThrow();
  });
});

describe('function answer', () => {
  it('200 with url, method, headers', () => {
    const signed = parseMediaSignResponse(200, {
      url: URL_PUT,
      method: 'PUT',
      key: 'hh/p/orig.jpg',
      headers: { 'Content-Type': 'image/jpeg', 'content-length': '7116470' },
      expires_at: '2026-11-26T12:15:00.000Z',
    });
    expect(signed).toEqual({
      url: URL_PUT,
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg', 'content-length': '7116470' },
      expiresAt: '2026-11-26T12:15:00.000Z',
    });
  });

  it('every documented error code becomes MediaSignError with status and code', () => {
    for (const [status, code] of [
      [401, 'not_signed_in'],
      [400, 'invalid_request'],
      [404, 'photo_not_found'],
      [403, 'forbidden'],
      [400, 'unsupported_photo'],
      [400, 'content_type_mismatch'],
      [500, 'not_configured'],
      [500, 'internal'],
    ] as const) {
      let caught: unknown;
      try {
        parseMediaSignResponse(status, { error: code });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MediaSignError);
      expect(caught).toMatchObject({ status, code });
    }
  });

  it('the gateway\'s own 401 (no error field) and broken 200s are errors too', () => {
    expect(() => parseMediaSignResponse(401, { code: 401, message: 'Invalid JWT' })).toThrow(/401 \(gateway\)/);
    expect(() => parseMediaSignResponse(200, null)).toThrow(/malformed_response/);
    expect(() => parseMediaSignResponse(200, { url: 'http://insecure', method: 'GET' })).toThrow(/malformed_response/);
  });

  it('error messages never contain a URL', () => {
    try {
      parseMediaSignResponse(403, { error: 'forbidden', url: URL_PUT });
    } catch (error) {
      expect((error as Error).message).not.toMatch(/http/);
    }
  });
});

describe('PUT headers must bind exactly this file', () => {
  const signed = parseMediaSignResponse(200, {
    url: URL_PUT,
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', 'content-length': '100' },
  });
  it('accepts the matching length and type', () => {
    expect(() => assertPutHeadersMatch(signed, 100, 'image/jpeg')).not.toThrow();
  });
  it('refuses another length, another type, a missing length, or a non-PUT', () => {
    expect(() => assertPutHeadersMatch(signed, 101, 'image/jpeg')).toThrow(/Länge/);
    expect(() => assertPutHeadersMatch(signed, 100, 'image/png')).toThrow(/Dateityp/);
    expect(() => assertPutHeadersMatch({ ...signed, headers: { 'content-type': 'image/jpeg' } }, 100, 'image/jpeg')).toThrow(/fehlt/);
    expect(() => assertPutHeadersMatch({ ...signed, method: 'GET' }, 100, 'image/jpeg')).toThrow();
  });
});

describe('R2 answers', () => {
  it('reads the <Code> from an R2 XML error', () => {
    const xml = '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>…</Message></Error>';
    expect(r2ErrorCode(xml)).toBe('SignatureDoesNotMatch');
    expect(r2ErrorCode('<Error><Code>NoSuchKey</Code></Error>')).toBe('NoSuchKey');
    expect(r2ErrorCode('')).toBeNull();
  });

  it('2xx is success', () => {
    expect(isR2Success(200)).toBe(true);
    expect(isR2Success(204)).toBe(true);
    expect(isR2Success(403)).toBe(false);
  });
});

describe('size check by one-byte range GET', () => {
  it('asks for exactly one byte', () => {
    expect(SIZE_PROBE_RANGE).toBe('bytes=0-0');
  });
  it('206 → total from Content-Range', () => {
    expect(storedSizeFromRangeProbe(206, { contentRange: 'bytes 0-0/7116470', contentLength: '1' })).toBe(7116470);
  });
  it('200 (range ignored) → Content-Length', () => {
    expect(storedSizeFromRangeProbe(200, { contentRange: null, contentLength: '7116470' })).toBe(7116470);
  });
  it('404 → not there', () => {
    expect(storedSizeFromRangeProbe(404, { contentRange: null, contentLength: null })).toBeNull();
  });
  it('403 is never "not there" — it throws with R2\'s code', () => {
    let caught: unknown;
    try {
      storedSizeFromRangeProbe(403, { contentRange: null, contentLength: null }, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(R2RequestError);
    expect(caught).toMatchObject({ status: 403, code: 'SignatureDoesNotMatch' });
  });
  it('a 206 without a usable Content-Range is an error, not a guess', () => {
    expect(() => storedSizeFromRangeProbe(206, { contentRange: 'bytes 0-0/*', contentLength: '1' })).toThrow(R2RequestError);
  });
});
