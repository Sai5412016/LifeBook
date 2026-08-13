/**
 * photos/import — the one entry point the UI calls to add photos.
 *
 * Sequence, and why it is this order:
 *   1. pick        — system picker, no permission dialog on modern Android
 *   2. hash        — content identity for every picked file
 *   3. dedupe      — against the album AND within the pick itself
 *   4. stage       — copy into persistent storage BEFORE writing any row, so a
 *                    row can never point at a file the OS cache has purged
 *   5. insert      — one transaction, so an interrupted import leaves nothing
 *                    half-written
 *   6. upload      — kicked off, not awaited: the chronology should appear
 *                    instantly and fill in as bytes travel
 */

import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { notifyHousehold, shouldNotifyAfterImport } from '@/core/notifications';

import { dedupeByHash, extensionForMime } from './identity';
import { PickCancelledError, deleteQuietly, pickPhotos, stagePickedPhoto } from './media';
import { insertPhotos, loadKnownHashes, prepareEntry } from './repository';
import { runUploadQueue } from './storage';
import type { ImportSummary } from './types';

export { PickCancelledError };

export type ImportPhotosInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  birthAtUtcIso: string | null;
  /** Upload originals only on Wi-Fi. Defaults to true. */
  wifiOnly?: boolean;
};

/**
 * Run a full import. Throws PickCancelledError when the user backs out of the
 * picker — callers should treat that as a no-op, not an error to report.
 */
export async function importPhotos(
  db: AbstractPowerSyncDatabase,
  input: ImportPhotosInput,
): Promise<ImportSummary> {
  const candidates = await pickPhotos(input.tz);
  const knownHashes = await loadKnownHashes(db, input.householdId);
  const { fresh, duplicates } = dedupeByHash(candidates, knownHashes);

  const entries: Parameters<typeof insertPhotos>[1]['entries'] = [];
  let failed = 0;

  for (const candidate of fresh) {
    try {
      const { photoId, thumbKey, mediumKey } = prepareEntry(input.householdId);
      const stagedUri = await stagePickedPhoto(
        candidate.localUri,
        photoId,
        extensionForMime(candidate.mime),
      );
      entries.push({ photoId, candidate, stagedUri, thumbKey, mediumKey });
    } catch (error) {
      failed += 1;
      console.error('[LifeBook] Foto konnte nicht übernommen werden', {
        uri: candidate.localUri,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (entries.length > 0) {
    await insertPhotos(db, {
      householdId: input.householdId,
      childId: input.childId,
      userId: input.userId,
      tz: input.tz,
      birthAtUtcIso: input.birthAtUtcIso,
      entries,
    });
  }

  // Best-effort and not awaited: the household ping matters far less than the
  // import itself, and notifyHousehold() already swallows its own failures —
  // nothing here could delay or break the import result below.
  if (shouldNotifyAfterImport(entries.length)) {
    void notifyHousehold(input.householdId, 'photos', entries.length);
  }

  // The picker's own cache copies are redundant once staged.
  for (const candidate of candidates) {
    deleteQuietly(candidate.localUri);
  }

  // Deliberately not awaited: uploading 40 photos takes minutes, and the user
  // should see their chronology now. Failures are logged and retried later.
  void runUploadQueue(db, { wifiOnly: input.wifiOnly ?? true }).catch(() => {
    // runUploadQueue already logs per-photo failures; nothing to add here.
  });

  return {
    imported: entries.length,
    duplicates: duplicates.length,
    failed,
  };
}

/** German one-liner summarising an import, for the confirmation message. */
export function describeImport(summary: ImportSummary): string {
  const parts: string[] = [];

  parts.push(
    summary.imported === 1 ? '1 Foto hinzugefügt' : `${summary.imported} Fotos hinzugefügt`,
  );
  if (summary.duplicates > 0) {
    parts.push(
      summary.duplicates === 1
        ? '1 Doppeltes übersprungen'
        : `${summary.duplicates} Doppelte übersprungen`,
    );
  }
  if (summary.failed > 0) {
    parts.push(
      summary.failed === 1
        ? '1 Foto konnte nicht gelesen werden'
        : `${summary.failed} Fotos konnten nicht gelesen werden`,
    );
  }

  return `${parts.join(' · ')}.`;
}
