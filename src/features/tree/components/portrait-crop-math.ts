/**
 * tree/components/portrait-crop-math — pure geometry behind the portrait
 * cropper: how far the image may be panned/zoomed without leaving empty
 * borders around the square crop frame (clampPortraitTransform), and which
 * rectangle of the ORIGINAL image that view currently shows
 * (portraitCropRect) — exactly the input expo-image-manipulator's crop
 * step needs. Deliberately free of any Expo / React Native import so it
 * runs in plain Node under Vitest (CLAUDE.md Architekturregel 3) — the
 * gesture handling and the actual manipulate() call live in
 * portrait-cropper.tsx.
 *
 * COORDINATE MODEL
 * -----------------
 * The crop frame is a square of side `frameSize`, centered at (0, 0). The
 * image, displayed at `baseScale * zoom` (`baseScale` is the "cover" fit
 * that makes the image's SHORTER side exactly match `frameSize` at
 * zoom 1), is centered at `(offsetX, offsetY)` — the pan gesture's own
 * translation, in the same on-screen pixel unit as `frameSize`. Shared by
 * both functions below so a transform that satisfies
 * `clampPortraitTransform` always produces a crop rect that stays inside
 * the source image.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/** Keeps a pinch gesture's zoom within the range this cropper allows — never below "image just covers the frame", capped so a face can't be zoomed into an unrecognizable smear. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return MIN_ZOOM;
  }
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export type PortraitOffset = { offsetX: number; offsetY: number };

/**
 * The largest pan offset that still keeps the (already-zoomed) image
 * covering the whole square crop frame on every side — beyond this, an
 * empty border would appear. Degenerate inputs (a non-positive image
 * dimension or frame size) return `(0, 0)` rather than dividing by zero.
 */
export function clampPortraitTransform(
  imageWidth: number,
  imageHeight: number,
  frameSize: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): PortraitOffset {
  if (imageWidth <= 0 || imageHeight <= 0 || frameSize <= 0) {
    return { offsetX: 0, offsetY: 0 };
  }
  const baseScale = frameSize / Math.min(imageWidth, imageHeight);
  const scale = baseScale * clampZoom(zoom);
  const displayedWidth = imageWidth * scale;
  const displayedHeight = imageHeight * scale;
  const maxOffsetX = Math.max(0, (displayedWidth - frameSize) / 2);
  const maxOffsetY = Math.max(0, (displayedHeight - frameSize) / 2);
  return {
    offsetX: clamp(offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(offsetY, -maxOffsetY, maxOffsetY),
  };
}

export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * The rectangle of the ORIGINAL image the crop frame currently shows, in
 * source pixel coordinates. Always re-clamps `offsetX`/`offsetY` first
 * (same rule as `clampPortraitTransform`) and clamps the resulting
 * rectangle a second time against the image's own bounds — so this never
 * returns a rect outside the source image, even from an already-invalid
 * zoom/offset a caller passes in.
 */
export function portraitCropRect(
  imageWidth: number,
  imageHeight: number,
  frameSize: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): CropRect {
  if (imageWidth <= 0 || imageHeight <= 0 || frameSize <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const effectiveZoom = clampZoom(zoom);
  const { offsetX: clampedX, offsetY: clampedY } = clampPortraitTransform(
    imageWidth,
    imageHeight,
    frameSize,
    effectiveZoom,
    offsetX,
    offsetY,
  );

  const baseScale = frameSize / Math.min(imageWidth, imageHeight);
  const scale = baseScale * effectiveZoom;
  const displayedWidth = imageWidth * scale;
  const displayedHeight = imageHeight * scale;
  const cropSize = frameSize / scale;
  const cropX = (displayedWidth / 2 - frameSize / 2 - clampedX) / scale;
  const cropY = (displayedHeight / 2 - frameSize / 2 - clampedY) / scale;

  const width = clamp(cropSize, 0, imageWidth);
  const height = clamp(cropSize, 0, imageHeight);
  const x = clamp(cropX, 0, imageWidth - width);
  const y = clamp(cropY, 0, imageHeight - height);

  return { x, y, width, height };
}
