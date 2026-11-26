/**
 * media-sign/sigv4 — AWS Signature Version 4 query-string presigning
 * ("presigned URLs") for S3-compatible storage, here Cloudflare R2.
 *
 * Written out instead of pulling in an SDK on purpose: it is ~100 lines of
 * well-specified hashing, needs nothing but Web Crypto (present in Deno AND
 * in Node, so the same file is unit-tested under Vitest against AWS's own
 * published example values — see sigv4.test.ts), and keeps the Edge Function
 * free of a dependency that would need pinning and auditing.
 *
 * Spec: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 *
 * Pure: no Deno, no npm import, no environment access, no clock — the caller
 * passes the time in, so signatures are reproducible in tests.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(key: BufferSource, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text));
}

/** RFC 3986 encoding as SigV4 requires it: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Each path segment encoded, slashes kept. S3 paths are NOT double-encoded. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

/** "20130524T000000Z" and "20130524" from a Date. */
export function amzDate(now: Date): { dateTime: string; date: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { dateTime: iso, date: iso.slice(0, 8) };
}

/** kSigning = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request"). */
export async function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export type PresignInput = {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Full object URL WITHOUT query, e.g. https://acct.eu.r2.cloudflarestorage.com/bucket/a/b.jpg (path already encoded). */
  url: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
  expiresSeconds: number;
  /**
   * Extra headers the client MUST send exactly like this (lower-case names),
   * e.g. { 'content-type': 'image/jpeg' } to bind an upload to its type.
   * `host` is always signed and taken from `url`.
   */
  signedHeaders?: Record<string, string>;
};

/** Returns the presigned URL. */
export async function presignUrl(input: PresignInput): Promise<string> {
  const service = input.service ?? 's3';
  const target = new URL(input.url);
  const { dateTime, date } = amzDate(input.now);
  const scope = `${date}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: target.host };
  for (const [name, value] of Object.entries(input.signedHeaders ?? {})) {
    headers[name.toLowerCase()] = value.trim();
  }
  const headerNames = Object.keys(headers).sort();
  const signedHeaderList = headerNames.join(';');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaderList,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    target.pathname, // already encoded by the caller (encodePath)
    canonicalQuery,
    headerNames.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaderList,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, dateTime, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signingKey = await deriveSigningKey(input.secretAccessKey, date, input.region, service);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `${target.origin}${target.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Path-style object URL for R2: <endpoint>/<bucket>/<key>, every segment encoded. */
export function objectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${encodeRfc3986(bucket)}/${encodePath(key)}`;
}
