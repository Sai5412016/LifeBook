import { describe, expect, it } from 'vitest';

import { amzDate, deriveSigningKey, encodePath, encodeRfc3986, objectUrl, presignUrl } from './sigv4.ts';

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('SigV4 against AWS published reference values', () => {
  it('derives the signing key of the AWS "deriving a signing key" example', async () => {
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html (example key)
    const key = await deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
    expect(toHex(key)).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  it('produces exactly the presigned GET URL of the S3 query-string example', async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html ("Example")
    const url = await presignUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
      expiresSeconds: 86400,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});

describe('SigV4 details', () => {
  it('formats the AMZ date', () => {
    expect(amzDate(new Date('2026-11-26T08:04:05.678Z'))).toEqual({ dateTime: '20261126T080405Z', date: '20261126' });
  });

  it('encodes per RFC 3986 and keeps path slashes', () => {
    expect(encodeRfc3986("a b!'()*~")).toBe('a%20b%21%27%28%29%2A~');
    expect(encodePath('h1/p 1/orig.jpg')).toBe('h1/p%201/orig.jpg');
  });

  it('builds a path-style R2 object URL', () => {
    expect(objectUrl('https://acct.eu.r2.cloudflarestorage.com/', 'lifebook-originals', 'h/p/orig.jpg')).toBe(
      'https://acct.eu.r2.cloudflarestorage.com/lifebook-originals/h/p/orig.jpg',
    );
  });

  it('binds extra signed headers (content-type) into the signature', async () => {
    const base = {
      method: 'PUT' as const,
      url: 'https://acct.eu.r2.cloudflarestorage.com/lifebook-originals/h/p/orig.jpg',
      region: 'auto',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secretexample',
      now: new Date('2026-11-26T00:00:00Z'),
      expiresSeconds: 900,
    };
    const jpeg = await presignUrl({ ...base, signedHeaders: { 'content-type': 'image/jpeg' } });
    const png = await presignUrl({ ...base, signedHeaders: { 'content-type': 'image/png' } });
    expect(jpeg).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
    expect(jpeg).not.toBe(png);
  });
});
