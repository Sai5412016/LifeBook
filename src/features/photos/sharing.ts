/**
 * photos/sharing — pure logic for sharing photos: the batch size cap, the
 * loading-progress label, the mobile-data warning, and the end-of-batch
 * failure summary. Deliberately free of any Expo / React Native / PowerSync
 * import so it runs in plain Node under Vitest; the device- and
 * network-touching side lives in ./storage (fetching originals) and
 * ./share (opening the OS share sheet).
 */

/**
 * Upper bound on how many originals one share operation loads at once.
 * Android's share intent (and the phone's memory) both degrade badly well
 * before this; a friendly message beats silently sharing only the first 20.
 */
export const MAX_SHARE_BATCH = 20;

/**
 * Below this count a missing Wi-Fi connection isn't worth interrupting the
 * flow for — one photo over mobile data is nothing. "Größere Mengen" starts
 * at the second photo.
 */
const WIFI_WARNING_MIN_COUNT = 2;

export type ShareBatchCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a selection is small enough to share in one operation.
 * Empty selections and over-the-cap selections are both rejected with a
 * German message ready to show the user — the caller never has to invent
 * its own wording or silently truncate the list.
 */
export function checkShareBatchSize(count: number, max: number = MAX_SHARE_BATCH): ShareBatchCheck {
  if (count === 0) {
    return { ok: false, message: 'Bitte mindestens ein Foto auswählen.' };
  }
  if (count > max) {
    return {
      ok: false,
      message: `Bitte höchstens ${max} Fotos auf einmal teilen (${count} ausgewählt).`,
    };
  }
  return { ok: true };
}

/** "Bild 3 von 8 wird geladen …" — shown while originals are fetched before the share sheet opens. */
export function formatShareProgressLabel(current: number, total: number): string {
  return `Bild ${current} von ${total} wird geladen …`;
}

/**
 * Whether to warn about mobile data before fetching a batch of originals.
 * Advisory only — the caller shows this and proceeds regardless, it never
 * blocks the share.
 */
export function shouldWarnAboutMobileData(count: number, isOnWifi: boolean): boolean {
  return !isOnWifi && count >= WIFI_WARNING_MIN_COUNT;
}

/** "Kein WLAN aktiv — 5 Fotos werden über Mobilfunk geladen." */
export function formatMobileDataWarning(count: number): string {
  return `Kein WLAN aktiv — ${count} Fotos werden über Mobilfunk geladen.`;
}

/**
 * End-of-batch note naming how many originals could not be loaded, or null
 * when every one succeeded. One unreadable photo must not abort the whole
 * share — this is what names the exception afterwards instead of hiding it.
 */
export function formatShareFailureSummary(failedCount: number, totalCount: number): string | null {
  if (failedCount === 0) {
    return null;
  }
  if (failedCount === totalCount) {
    return totalCount === 1
      ? 'Das Foto konnte nicht geladen werden.'
      : 'Keines der ausgewählten Fotos konnte geladen werden.';
  }
  return failedCount === 1
    ? '1 Foto konnte nicht geladen werden und wurde übersprungen.'
    : `${failedCount} Fotos konnten nicht geladen werden und wurden übersprungen.`;
}
