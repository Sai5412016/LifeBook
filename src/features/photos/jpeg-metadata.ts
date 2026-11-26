/**
 * photos/jpeg-metadata — finds and removes embedded metadata in a JPEG, so a
 * shared medium can be PROVEN to carry no location (PR 2, 2026-11-26). Pure
 * byte handling, no Expo import; tested in jpeg-metadata.test.ts.
 *
 * WHY THIS EXISTS ALTHOUGH THE MEDIUM SHOULD ALREADY BE CLEAN
 * ------------------------------------------------------------
 * The medium is rendered by expo-image-manipulator 57.0.8, which writes a
 * brand-new JPEG from decoded pixels — Android:
 * ImageManipulatorModule.kt `saveAsync` → `Bitmap.compress(JPEG, …)`; iOS:
 * ImageManipulatorUtils.swift → `UIImage.jpegData(…)`. Neither copies an EXIF
 * block, so the medium has no GPS. That is a property of a native library
 * version, though, not of this app — a future update could start preserving
 * metadata and nobody would notice. So every medium that is about to be
 * SHARED is checked here first, and any APP1 (EXIF, XMP) or APP13
 * (IPTC/Photoshop) segment is cut out before it reaches the share sheet.
 * Colour data (APP2 ICC), JFIF (APP0) and Adobe (APP14) stay.
 */

const MARKER_SOI = 0xd8;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;
const APP1 = 0xe1;
const APP13 = 0xed;
/** TIFF tag of the GPS sub-IFD pointer in IFD0. */
const TAG_GPS_IFD = 0x8825;

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_PREFIX = 'http://ns.adobe.com/xap/1.0/';

export type JpegMetadataReport = {
  isJpeg: boolean;
  /** An EXIF APP1 block exists. */
  hasExif: boolean;
  /** EXIF IFD0 points to a GPS IFD, or XMP names a GPS field. */
  hasGps: boolean;
  /** XMP APP1 block exists. */
  hasXmp: boolean;
  /** IPTC/Photoshop APP13 block exists (can hold place names). */
  hasIptc: boolean;
};

type Segment = { marker: number; start: number; end: number; dataStart: number };

function startsWith(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
  if (offset + prefix.length > bytes.length) return false;
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = offset; index < Math.min(bytes.length, offset + length); index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

/**
 * The marker segments before the image data (SOS). Returns null if this is
 * not a well-formed JPEG header — the caller then refuses to share rather
 * than guessing.
 */
function headerSegments(bytes: Uint8Array): { segments: Segment[]; imageDataStart: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== MARKER_SOI) return null;
  const segments: Segment[] = [];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    // Fill bytes (0xFF 0xFF …) are allowed before a marker.
    let markerOffset = offset;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= bytes.length) return null;
    const marker = bytes[markerOffset];
    if (marker === MARKER_SOS || marker === MARKER_EOI) {
      return { segments, imageDataStart: offset };
    }
    // Standalone markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1;
      continue;
    }
    if (markerOffset + 2 >= bytes.length) return null;
    const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
    if (length < 2) return null;
    const end = markerOffset + 1 + length;
    if (end > bytes.length) return null;
    segments.push({ marker, start: offset, end, dataStart: markerOffset + 3 });
    offset = end;
  }
  return null;
}

/** Whether a TIFF (EXIF payload) IFD0 contains the GPS pointer tag. */
function tiffHasGpsPointer(bytes: Uint8Array, tiffStart: number, tiffEnd: number): boolean {
  if (tiffStart + 8 > tiffEnd) return false;
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49; // "II"
  const big = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d; // "MM"
  if (!little && !big) return false;
  const u16 = (at: number) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
  const u32 = (at: number) =>
    little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const ifd0 = tiffStart + u32(tiffStart + 4);
  if (ifd0 + 2 > tiffEnd) return false;
  const count = u16(ifd0);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 12 > tiffEnd) return false;
    if (u16(entry) === TAG_GPS_IFD) return true;
  }
  return false;
}

export function inspectJpegMetadata(bytes: Uint8Array): JpegMetadataReport {
  const report: JpegMetadataReport = { isJpeg: false, hasExif: false, hasGps: false, hasXmp: false, hasIptc: false };
  const parsed = headerSegments(bytes);
  if (!parsed) return report;
  report.isJpeg = true;
  for (const segment of parsed.segments) {
    if (segment.marker === APP13) {
      report.hasIptc = true;
    }
    if (segment.marker !== APP1) continue;
    if (startsWith(bytes, segment.dataStart, EXIF_HEADER)) {
      report.hasExif = true;
      if (tiffHasGpsPointer(bytes, segment.dataStart + EXIF_HEADER.length, segment.end)) {
        report.hasGps = true;
      }
    } else if (asciiAt(bytes, segment.dataStart, XMP_PREFIX.length) === XMP_PREFIX) {
      report.hasXmp = true;
      if (/GPS(Latitude|Longitude|Altitude)/.test(asciiAt(bytes, segment.dataStart, segment.end - segment.dataStart))) {
        report.hasGps = true;
      }
    }
  }
  return report;
}

/** True when the JPEG carries anything this module strips (EXIF, XMP, IPTC). */
export function hasStrippableMetadata(report: JpegMetadataReport): boolean {
  return report.hasExif || report.hasXmp || report.hasIptc || report.hasGps;
}

/**
 * The same JPEG without its APP1 (EXIF, XMP) and APP13 (IPTC) segments.
 * Throws for anything that is not a well-formed JPEG header — sharing must
 * stop rather than send a file this check could not read.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const parsed = headerSegments(bytes);
  if (!parsed) {
    throw new Error('Medium ist kein lesbares JPEG – Teilen abgebrochen');
  }
  const keep = parsed.segments.filter((segment) => segment.marker !== APP1 && segment.marker !== APP13);
  const size =
    2 + keep.reduce((sum, segment) => sum + (segment.end - segment.start), 0) + (bytes.length - parsed.imageDataStart);
  const out = new Uint8Array(size);
  out[0] = 0xff;
  out[1] = MARKER_SOI;
  let offset = 2;
  for (const segment of keep) {
    out.set(bytes.subarray(segment.start, segment.end), offset);
    offset += segment.end - segment.start;
  }
  out.set(bytes.subarray(parsed.imageDataStart), offset);
  return out;
}
