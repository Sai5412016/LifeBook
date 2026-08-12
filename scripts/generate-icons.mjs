#!/usr/bin/env node
/**
 * Regenerates the app icon rasters from assets/images/icon-oktopus.svg.
 *
 * The source SVG is kept in the repo specifically so the icon can be
 * re-cropped/re-scaled later without asking for a fresh export — this
 * script is that "later": run `node scripts/generate-icons.mjs` after
 * editing the SVG (or the constants below) to regenerate all three rasters.
 *
 * Requires `sharp` (devDependency only — nothing at runtime depends on it).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = path.join(ROOT, 'assets/images/icon-oktopus.svg');
const OUT_DIR = path.join(ROOT, 'assets/images');

/** Matches src/constants/themes/oktopus.ts's `backgroundElement.light` — keep both in sync if the palette changes. */
const CREAM_BACKGROUND = '#FAF3E3';

/** Android crops an adaptive icon's edges; content must stay inside a centered "safe zone". */
const FOREGROUND_MOTIF_FRACTION = 0.66;

const rawSvg = readFileSync(SVG_PATH, 'utf8');

// The source SVG's first shape is a full-canvas rect (as a <path>) filling in
// the cream background the design tool baked in. Stripped out here so the
// foreground/splash renders are transparent everywhere except the octopus
// itself — `icon.png` re-adds the exact same color explicitly (via
// `flatten`), rather than relying on the source file happening to match.
const BACKGROUND_PATH_PATTERN =
  /<path transform="translate\(0,0\)" fill="rgb\(250, ?243, ?227\)" d="M 0 0 L 2048 0 L 2048 2048 L 0 2048 L 0 0 z"\s*\/>/;

if (!BACKGROUND_PATH_PATTERN.test(rawSvg)) {
  throw new Error(
    'generate-icons: expected background <path> not found in icon-oktopus.svg — the source file changed shape, update BACKGROUND_PATH_PATTERN.',
  );
}

const motifOnlySvg = rawSvg.replace(BACKGROUND_PATH_PATTERN, '');

/** Rasterizes `svg` to fill the whole `size`x`size` canvas, optionally flattened onto a solid background. */
async function renderFullBleed(svg, size, outFile, background) {
  const image = sharp(Buffer.from(svg)).resize(size, size);
  if (background) {
    image.flatten({ background });
  }
  await image.png().toFile(outFile);
  return sharp(outFile).metadata();
}

/** Composites `motifBuffer` (already rendered to `motifSize`) centered on a transparent `canvasSize`x`canvasSize` canvas. */
async function compositeCentered(motifBuffer, canvasSize, motifSize, outFile) {
  const offset = Math.round((canvasSize - motifSize) / 2);
  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: motifBuffer, left: offset, top: offset }])
    .png()
    .toFile(outFile);
  return sharp(outFile).metadata();
}

/** Rasterizes `svg` at `motifSize`, centered on a transparent `canvasSize`x`canvasSize` canvas. */
async function renderCentered(svg, canvasSize, motifSize, outFile) {
  const motif = await sharp(Buffer.from(svg)).resize(motifSize, motifSize).png().toBuffer();
  return compositeCentered(motif, canvasSize, motifSize, outFile);
}

/**
 * Solid-black silhouette of `svg`'s shape at `motifSize` (its exact alpha
 * mask, recolored flat) — for Android 13+'s themed-icon "monochrome" layer,
 * which the OS tints itself at render time, so the source color doesn't
 * matter beyond being opaque where the motif is.
 */
async function renderSilhouette(svg, canvasSize, motifSize, outFile) {
  const motifAlpha = await sharp(Buffer.from(svg))
    .resize(motifSize, motifSize)
    .ensureAlpha()
    .extractChannel('alpha')
    .toBuffer();
  const solidBlack = await sharp({
    create: { width: motifSize, height: motifSize, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const silhouette = await sharp(solidBlack).joinChannel(motifAlpha).png().toBuffer();
  return compositeCentered(silhouette, canvasSize, motifSize, outFile);
}

const results = {};

results['icon.png'] = await renderFullBleed(
  motifOnlySvg,
  1024,
  path.join(OUT_DIR, 'icon.png'),
  CREAM_BACKGROUND,
);

results['android-icon-foreground.png'] = await renderCentered(
  motifOnlySvg,
  1024,
  Math.round(1024 * FOREGROUND_MOTIF_FRACTION),
  path.join(OUT_DIR, 'android-icon-foreground.png'),
);

results['splash-icon.png'] = await renderFullBleed(
  motifOnlySvg,
  512,
  path.join(OUT_DIR, 'splash-icon.png'),
  null,
);

// Not one of the three rasters the rebrand asked for, but android-icon-monochrome.png
// was still the unrelated Expo-template chevron mark (never LifeBook's own branding
// to begin with) — left alone it would show that mark under Android 13+ themed
// icons once everything else here is the octopus. Regenerated from the same motif
// for consistency, same safe-zone framing as the foreground layer.
results['android-icon-monochrome.png'] = await renderSilhouette(
  motifOnlySvg,
  1024,
  Math.round(1024 * FOREGROUND_MOTIF_FRACTION),
  path.join(OUT_DIR, 'android-icon-monochrome.png'),
);

for (const [name, meta] of Object.entries(results)) {
  console.log(`${name}: ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}`);
}
