import { describe, expect, it } from 'vitest';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPortraitTransform,
  clampZoom,
  portraitCropRect,
} from './portrait-crop-math';

describe('clampZoom', () => {
  it('lässt einen gültigen Zoom unverändert', () => {
    expect(clampZoom(2)).toBe(2);
  });

  it('hebt einen zu kleinen Zoom auf MIN_ZOOM an', () => {
    expect(clampZoom(0.3)).toBe(MIN_ZOOM);
  });

  it('kappt einen zu großen Zoom auf MAX_ZOOM', () => {
    expect(clampZoom(50)).toBe(MAX_ZOOM);
  });

  it('behandelt NaN/Infinity wie MIN_ZOOM statt sie durchzureichen', () => {
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Infinity)).toBe(MIN_ZOOM);
  });
});

describe('clampPortraitTransform', () => {
  it('erzwingt (0, 0) bei Zoom 1 auf der Achse, die exakt in den Rahmen passt (Hochformat: Höhe)', () => {
    // 100x200 (Hochformat), Rahmen 100 -> Breite passt exakt, Höhe ragt raus.
    const result = clampPortraitTransform(100, 200, 100, 1, 500, 500);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBeGreaterThan(0);
  });

  it('erzwingt (0, 0) bei Zoom 1 auf der Achse, die exakt in den Rahmen passt (Querformat: Breite)', () => {
    const result = clampPortraitTransform(200, 100, 100, 1, 500, 500);
    expect(result.offsetY).toBe(0);
    expect(result.offsetX).toBeGreaterThan(0);
  });

  it('erlaubt bei einem quadratischen Bild in keiner Richtung Verschiebung', () => {
    const result = clampPortraitTransform(150, 150, 100, 1, 500, 500);
    expect(result).toEqual({ offsetX: 0, offsetY: 0 });
  });

  it('vergrößert den erlaubten Bereich mit höherem Zoom', () => {
    const atZoom1 = clampPortraitTransform(200, 100, 100, 1, 500, 500);
    const atZoom2 = clampPortraitTransform(200, 100, 100, 2, 500, 500);
    expect(atZoom2.offsetX).toBeGreaterThan(atZoom1.offsetX);
  });

  it('lässt eine Verschiebung innerhalb der Grenzen unverändert', () => {
    const result = clampPortraitTransform(200, 100, 100, 1, 10, 0);
    expect(result.offsetX).toBe(10);
  });

  it('gibt (0, 0) für ungültige Bild- oder Rahmenmaße zurück', () => {
    expect(clampPortraitTransform(0, 100, 100, 1, 50, 50)).toEqual({ offsetX: 0, offsetY: 0 });
    expect(clampPortraitTransform(100, 100, 0, 1, 50, 50)).toEqual({ offsetX: 0, offsetY: 0 });
  });
});

describe('portraitCropRect', () => {
  it('ergibt bei Zoom 1 und Verschiebung 0 den größtmöglichen zentrierten Quadratausschnitt (Querformat)', () => {
    const rect = portraitCropRect(200, 100, 100, 1, 0, 0);
    expect(rect).toEqual({ x: 50, y: 0, width: 100, height: 100 });
  });

  it('ergibt bei Zoom 1 und Verschiebung 0 den größtmöglichen zentrierten Quadratausschnitt (Hochformat)', () => {
    const rect = portraitCropRect(100, 200, 100, 1, 0, 0);
    expect(rect).toEqual({ x: 0, y: 50, width: 100, height: 100 });
  });

  it('ergibt bei einem bereits quadratischen Bild das ganze Bild', () => {
    const rect = portraitCropRect(150, 150, 100, 1, 0, 0);
    expect(rect).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('wird bei höherem Zoom kleiner', () => {
    const atZoom1 = portraitCropRect(200, 200, 100, 1, 0, 0);
    const atZoom2 = portraitCropRect(200, 200, 100, 2, 0, 0);
    expect(atZoom2.width).toBeLessThan(atZoom1.width);
    expect(atZoom2.height).toBeLessThan(atZoom1.height);
  });

  it('verschiebt den Ausschnitt mit dem Pan-Versatz — Bild nach rechts geschoben zeigt den linken Bildteil', () => {
    const centered = portraitCropRect(200, 100, 100, 1, 0, 0);
    const imageMovedRight = portraitCropRect(200, 100, 100, 1, 20, 0);
    expect(imageMovedRight.x).toBeLessThan(centered.x);
  });

  it('liegt nie außerhalb des Bildes — auch bei extremen oder ungültigen Werten', () => {
    const cases: [number, number, number, number, number, number][] = [
      [200, 100, 100, 1, 0, 0],
      [100, 200, 100, 1, 0, 0],
      [150, 150, 100, 3, 0, 0],
      [200, 100, 100, 2, 1000, 1000], // Versatz weit außerhalb des erlaubten Bereichs
      [200, 100, 100, -5, 0, 0], // ungültiger Zoom
      [50, 50, 100, 1, 0, 0], // Rahmen größer als das Bild
      [1000, 300, 300, 4, -900, 900],
    ];
    for (const [imageWidth, imageHeight, frameSize, zoom, offsetX, offsetY] of cases) {
      const rect = portraitCropRect(imageWidth, imageHeight, frameSize, zoom, offsetX, offsetY);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(imageWidth + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(imageHeight + 1e-9);
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('gibt ein leeres Rechteck für ungültige Bild- oder Rahmenmaße zurück', () => {
    expect(portraitCropRect(0, 100, 100, 1, 0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
