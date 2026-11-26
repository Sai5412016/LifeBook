import { describe, expect, it } from 'vitest';

import { CAMERA_WITH_GPS, REENCODED_FROM_PIXELS } from './__fixtures__/jpeg-fixtures';
import { hasStrippableMetadata, inspectJpegMetadata, stripJpegMetadata } from './jpeg-metadata';

/**
 * Fixtures: see __fixtures__/jpeg-fixtures.ts —
 * - REENCODED_FROM_PIXELS: a JPEG written from pixels only, without any
 *   metadata: what expo-image-manipulator produces for the medium
 *   (Bitmap.compress on Android, UIImage.jpegData on iOS).
 * - CAMERA_WITH_GPS: the same image with an EXIF block like a phone camera
 *   writes: Make plus a GPS IFD (48°22'7.5"N, 10°53'51"E), independently
 *   confirmed with ImageMagick `identify -verbose`.
 */
const CLEAN = REENCODED_FROM_PIXELS;
const WITH_GPS = CAMERA_WITH_GPS;

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function indexOf(bytes: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index + needle.length <= bytes.length; index += 1) {
    for (let inner = 0; inner < needle.length; inner += 1) {
      if (bytes[index + inner] !== needle[inner]) continue outer;
    }
    return index;
  }
  return -1;
}

const containsAscii = (bytes: Uint8Array, text: string): boolean => indexOf(bytes, latin1(text)) >= 0;
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(new Uint8Array([0xff, marker, length >> 8, length & 0xff]), payload);
}

/** The clean fixture with one extra segment right after SOI. */
const withSegment = (marker: number, payload: Uint8Array): Uint8Array =>
  concat(CLEAN.subarray(0, 2), segment(marker, payload), CLEAN.subarray(2));

const withXmp = (xml: string): Uint8Array => withSegment(0xe1, concat(latin1('http://ns.adobe.com/xap/1.0/\0'), utf8(xml)));

describe('the medium as the app renders it carries no location', () => {
  it('a JPEG re-encoded from pixels has no EXIF, no GPS, nothing to strip', () => {
    const report = inspectJpegMetadata(CLEAN);
    expect(report).toEqual({ isJpeg: true, hasExif: false, hasGps: false, hasXmp: false, hasIptc: false });
    expect(hasStrippableMetadata(report)).toBe(false);
    expect(containsAscii(CLEAN, 'Exif')).toBe(false);
  });

  it('stripping a clean JPEG changes nothing (byte-identical)', () => {
    expect(sameBytes(stripJpegMetadata(CLEAN), CLEAN)).toBe(true);
  });
});

describe('a camera JPEG with GPS is detected and cleaned', () => {
  it('finds the EXIF block and its GPS pointer', () => {
    const report = inspectJpegMetadata(WITH_GPS);
    expect(report.isJpeg).toBe(true);
    expect(report.hasExif).toBe(true);
    expect(report.hasGps).toBe(true);
  });

  it('after stripping: no EXIF, no GPS, the image data untouched', () => {
    const stripped = stripJpegMetadata(WITH_GPS);
    const report = inspectJpegMetadata(stripped);
    expect(report.hasExif).toBe(false);
    expect(report.hasGps).toBe(false);
    expect(containsAscii(stripped, 'Exif')).toBe(false);
    expect(containsAscii(stripped, 'TestCam')).toBe(false);
    // Only the APP1 segment went: the result is exactly the pixel-only JPEG.
    expect(sameBytes(stripped, CLEAN)).toBe(true);
  });

  it('EXIF without a GPS pointer is still EXIF (stripped too), but not reported as GPS', () => {
    // Patch the GPS pointer tag (0x8825, little-endian 25 88) to an unrelated tag.
    const copy = new Uint8Array(WITH_GPS);
    const at = indexOf(copy, new Uint8Array([0x25, 0x88, 0x04, 0x00]));
    expect(at).toBeGreaterThan(0);
    copy[at] = 0x31;
    copy[at + 1] = 0x01;
    const report = inspectJpegMetadata(copy);
    expect(report.hasExif).toBe(true);
    expect(report.hasGps).toBe(false);
    expect(hasStrippableMetadata(report)).toBe(true);
  });

  it('XMP with GPS fields is detected and removed', () => {
    const xmp = withXmp('<x:xmpmeta><rdf:Description exif:GPSLatitude="48,22.1N" exif:GPSLongitude="10,53.8E"/></x:xmpmeta>');
    expect(inspectJpegMetadata(xmp)).toMatchObject({ hasXmp: true, hasGps: true });
    const stripped = stripJpegMetadata(xmp);
    expect(inspectJpegMetadata(stripped)).toMatchObject({ hasXmp: false, hasGps: false });
    expect(containsAscii(stripped, 'GPSLatitude')).toBe(false);
  });

  it('IPTC (APP13) is removed as well', () => {
    const withIptc = withSegment(0xed, latin1('Photoshop 3.0\0 8BIM Augsburg'));
    expect(inspectJpegMetadata(withIptc).hasIptc).toBe(true);
    expect(inspectJpegMetadata(stripJpegMetadata(withIptc)).hasIptc).toBe(false);
  });
});

describe('anything that is not a readable JPEG stops sharing', () => {
  it('rejects non-JPEG bytes and truncated headers', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectJpegMetadata(png).isJpeg).toBe(false);
    expect(() => stripJpegMetadata(png)).toThrow(/kein lesbares JPEG/);
    expect(() => stripJpegMetadata(WITH_GPS.subarray(0, 10))).toThrow(/kein lesbares JPEG/);
  });
});
