/**
 * berichte/export — writes one CSV per Datenart to the cache folder and
 * hands all five to the OS share sheet in one operation, via
 * `react-native-share` — the SAME delivery mechanism this app already uses
 * for sharing photos (features/photos/share.ts), and the cache-folder
 * staging CLAUDE.md Fallstrick 10 requires (react-native-share's bundled
 * Android FileProvider only declares the cache directory shareable, not
 * `Paths.document`).
 *
 * Deliberately NOT the app's photo "backup" mechanism
 * (features/photos/storage.ts#runPhotoBackup): that function inserts
 * PHOTOS directly into the device's Gallery via `expo-media-library`
 * (`MediaLibrary.createAssetAsync`/`createAlbumAsync`), which only ever
 * accepts image/video assets — there is no way to put an arbitrary document
 * like a CSV file into a MediaLibrary album. See the task's own Schritt 1
 * report for the full comparison.
 */

import { Directory, File, Paths } from 'expo-file-system';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import Share from 'react-native-share';

import { toLocalDate } from '@/core/time';
import { getDiapersForExport } from '@/features/diaper/repository';
import { getFeedsForExport } from '@/features/feeding/repository';
import { getGrowthForExport } from '@/features/growth/repository';
import { getGabenForExport } from '@/features/medication/repository';
import { getSleepsForExport } from '@/features/sleep/repository';

import { buildDiapersCsv, buildFeedsCsv, buildGrowthCsv, buildMedicationsCsv, buildSleepsCsv } from './csv';

/** Prepended to every CSV so Excel reads the German umlauts correctly (task requirement). */
const UTF8_BOM = '﻿';

/**
 * Directory holding every CSV handed to the OS share sheet — same idea as
 * photos/storage.ts's `getShareCacheDirectory`, a SEPARATE subdirectory so
 * an export run never collides with an in-flight photo share.
 */
let exportCacheDirectory: Directory | null = null;

function getExportCacheDirectory(): Directory {
  if (!exportCacheDirectory) {
    exportCacheDirectory = new Directory(Paths.cache, 'berichte-export');
  }
  return exportCacheDirectory;
}

function writeCsvFile(directory: Directory, name: string, csv: string): File {
  const file = new File(directory, name);
  file.create({ overwrite: true });
  file.write(UTF8_BOM + csv);
  return file;
}

function cleanupExportFiles(files: readonly File[]): void {
  for (const file of files) {
    try {
      if (file.info().exists) {
        file.delete();
      }
    } catch {
      // Best effort — a leftover temp file in the app's own cache is never user-visible.
    }
  }
}

/** Raised when `Share.open()` itself rejects — mirrors features/photos/share.ts#ShareOpenError. */
export class BerichteExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BerichteExportError';
  }
}

/**
 * Builds one CSV per Datenart for the ENTIRE history since birth (task
 * requirement — not just the currently shown Wochen-/Monatsbericht period)
 * and opens the share sheet once with all five files.
 */
export async function exportBerichte(
  db: AbstractPowerSyncDatabase,
  childId: string,
  birthAtUtcIso: string,
  birthTz: string,
  tz: string,
): Promise<void> {
  const sinceLocalDate = toLocalDate(birthAtUtcIso, birthTz);

  const [feeds, diapers, sleeps, medications, growthMeasurements] = await Promise.all([
    getFeedsForExport(db, childId, sinceLocalDate),
    getDiapersForExport(db, childId, sinceLocalDate),
    getSleepsForExport(db, childId, sinceLocalDate),
    getGabenForExport(db, childId, sinceLocalDate),
    getGrowthForExport(db, childId, sinceLocalDate),
  ]);

  const directory = getExportCacheDirectory();
  if (!directory.info().exists) {
    directory.create({ intermediates: true });
  }

  const files = [
    writeCsvFile(directory, 'fuettern.csv', buildFeedsCsv(feeds, tz)),
    writeCsvFile(directory, 'wickeln.csv', buildDiapersCsv(diapers, tz)),
    writeCsvFile(directory, 'schlafen.csv', buildSleepsCsv(sleeps, tz)),
    writeCsvFile(directory, 'medikamente.csv', buildMedicationsCsv(medications, tz)),
    writeCsvFile(directory, 'gewicht.csv', buildGrowthCsv(growthMeasurements, tz)),
  ];

  try {
    await Share.open({
      urls: files.map((file) => file.uri),
      type: 'text/csv',
      failOnCancel: false,
    });
  } catch (error) {
    throw new BerichteExportError(error instanceof Error ? error.message : String(error));
  } finally {
    cleanupExportFiles(files);
  }
}
