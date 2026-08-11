/**
 * photos/share — opens the native OS share sheet for one or more photo
 * originals, ONCE, with every path in the request (Android's `urls` share
 * intent field) rather than once per photo. Kept apart from ./storage: that
 * module only moves bytes to/from Supabase; this is the one place that
 * imports `react-native-share`, the native module this feature added.
 */

import Share from 'react-native-share';

import {
  cleanupSharedFiles,
  prepareShareBatch,
  type ShareableOriginal,
  type ShareBatchProgress,
} from './storage';

/** Raised when `options.signal` was aborted before the share sheet could open. */
export class ShareCancelledError extends Error {
  constructor() {
    super('sharing cancelled before the originals finished loading');
    this.name = 'ShareCancelledError';
  }
}

export type SharePhotosResult = {
  /** How many originals were handed to the share sheet. */
  shared: number;
  /** How many could not be loaded and were skipped — see ./storage#prepareShareBatch. */
  failedCount: number;
};

/**
 * Loads every original in `photos` (reusing a still-staged local file where
 * possible, downloading the rest) and opens the share sheet once with all of
 * them. Cache files this call downloaded are deleted again once the share
 * sheet has them — see `cleanupSharedFiles`; a still-pending upload's staged
 * file is never touched.
 *
 * Throws `ShareCancelledError` if `options.signal` fires during loading.
 * A photo that fails to load is skipped, not fatal — `failedCount` in the
 * result is how the caller reports that afterwards.
 */
export async function sharePhotos(
  photos: readonly ShareableOriginal[],
  options: { signal?: AbortSignal; onProgress?: (progress: ShareBatchProgress) => void } = {},
): Promise<SharePhotosResult> {
  const { files, failedCount, cancelled } = await prepareShareBatch(photos, options);

  if (cancelled) {
    cleanupSharedFiles(files);
    throw new ShareCancelledError();
  }

  if (files.length === 0) {
    return { shared: 0, failedCount };
  }

  try {
    await Share.open({
      urls: files.map((file) => file.uri),
      // A cancelled share sheet (the user just closed it) is a normal outcome
      // here, not an error to report — only a failed LOAD is.
      failOnCancel: false,
    });
  } finally {
    cleanupSharedFiles(files);
  }

  return { shared: files.length, failedCount };
}
