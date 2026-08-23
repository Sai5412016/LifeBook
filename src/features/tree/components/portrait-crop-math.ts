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
 * WORKLETS (Fehler, 2026-08-24: froren beim Schieben/Zoomen ein)
 * -----------------------------------------------------------------
 * `clamp`, `clampZoom` and `clampPortraitTransform` run INSIDE the pan/
 * pinch gesture's `.onUpdate()` callbacks in portrait-cropper.tsx — those
 * callbacks are Reanimated worklets, executed on the UI thread on every
 * touch-move frame. A plain (non-worklet) function called from a worklet
 * is not itself compiled to run there; every call became a synchronous
 * UI-thread → JS-thread round trip, which at multiple-times-a-frame
 * frequency on a several-megapixel image is exactly what made the app
 * stop responding. The fix is the `'worklet'` directive as each affected
 * function's very first statement — Reanimated's Babel plugin then also
 * compiles it for the UI thread. Outside Reanimated (e.g. under Vitest)
 * the directive is just a string literal with no effect, so every
 * function below stays a completely ordinary, synchronously testable
 * function — see portrait-crop-math.test.ts.
 *
 * Worklets must not close over anything that is not worklet-safe, so
 * every function here takes and returns PLAIN NUMBERS (and plain object
 * literals of numbers) only — never a React value, a ref, or anything
 * from component state.
 *
 * PREVIEW VS. ORIGINAL (Fehler, dieselbe Meldung)
 * -----------------------------------------------------------------
 * The gesture pans/zooms a DOWNSCALED PREVIEW of the picked photo, never
 * the full-resolution original (portrait-cropper.tsx builds that preview
 * once, on open) — displaying and transforming a several-thousand-pixel
 * source image every frame was the second, independent cause of the same
 * freeze. `portraitCropRect` therefore takes BOTH the preview's dimensions
 * (to do the same on-screen frame/zoom/offset math the live gesture does)
 * AND the original's dimensions, and scales the resulting rectangle up to
 * original-image pixel coordinates — the crop itself still runs against
 * the original file, never the preview, so output quality is unaffected
 * by however small the on-screen preview was.
 *
 * COORDINATE MODEL
 * -----------------
 * The crop frame is a square of side `frameSize`, centered at (0, 0). The
 * image, displayed at `baseScale * zoom` (`baseScale` is the "cover" fit
 * that makes the image's SHORTER side exactly match `frameSize` at
 * zoom 1), is centered at `(offsetX, offsetY)` — the pan gesture's own
 * translation, in the same on-screen pixel unit as `frameSize`.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/** Keeps a pinch gesture's zoom within the range this cropper allows — never below "image just covers the frame", capped so a face can't be zoomed into an unrecognizable smear. */
export function clampZoom(zoom: number): number {
  'worklet';
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
 * `imageWidth`/`imageHeight` are whatever image is ACTUALLY being
 * displayed and gestured on — the preview, during a live gesture.
 */
export function clampPortraitTransform(
  imageWidth: number,
  imageHeight: number,
  frameSize: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): PortraitOffset {
  'worklet';
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

/** The frame/zoom/offset math in whatever single image-dimension space it's given — internal building block, always followed by a scale to the actual output space (see `portraitCropRect`/`scalePortraitCropRect`). Not itself a worklet: only ever called from the JS thread (handleConfirm, and this module's own functions below), never from a gesture callback. */
function cropRectInImageSpace(
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

/**
 * Scales a crop rectangle computed in PREVIEW pixel space up to ORIGINAL
 * pixel space — `scaleX`/`scaleY` handled separately rather than assuming
 * one uniform factor, since a real resize can round preview width and
 * height to integers independently, very slightly off a perfectly
 * proportional scale. Re-clamps the result against the original's own
 * bounds a second time, same defensive rule as `cropRectInImageSpace`.
 */
export function scalePortraitCropRect(
  rect: CropRect,
  previewWidth: number,
  previewHeight: number,
  originalWidth: number,
  originalHeight: number,
): CropRect {
  if (previewWidth <= 0 || previewHeight <= 0 || originalWidth <= 0 || originalHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scaleX = originalWidth / previewWidth;
  const scaleY = originalHeight / previewHeight;
  const width = clamp(rect.width * scaleX, 0, originalWidth);
  const height = clamp(rect.height * scaleY, 0, originalHeight);
  const x = clamp(rect.x * scaleX, 0, originalWidth - width);
  const y = clamp(rect.y * scaleY, 0, originalHeight - height);
  return { x, y, width, height };
}

/**
 * The rectangle of the ORIGINAL image the crop frame currently shows, in
 * source pixel coordinates — exactly what expo-image-manipulator's crop
 * step needs. The frame/zoom/offset geometry is computed against the
 * PREVIEW's dimensions (`previewWidth`/`previewHeight` — the same,
 * possibly downscaled image the gesture actually pans/zooms on screen,
 * see this file's own header), then scaled up to
 * `originalWidth`/`originalHeight`. When there is no separate preview
 * (the picked image was already small), call this with
 * `previewWidth === originalWidth` and `previewHeight === originalHeight`
 * — the scale step is then a no-op.
 */
export function portraitCropRect(
  previewWidth: number,
  previewHeight: number,
  originalWidth: number,
  originalHeight: number,
  frameSize: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): CropRect {
  const previewRect = cropRectInImageSpace(previewWidth, previewHeight, frameSize, zoom, offsetX, offsetY);
  return scalePortraitCropRect(previewRect, previewWidth, previewHeight, originalWidth, originalHeight);
}
