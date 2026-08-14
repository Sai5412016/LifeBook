/**
 * photos/selection — pure logic for the Chronik's multi-select mode: which
 * tiles are marked, the header count label, and the delete confirmation
 * wording. Deliberately free of any Expo / React Native / PowerSync import
 * so it runs in plain Node under Vitest; the device- and screen-touching
 * side lives in src/app/(tabs)/chronik.tsx.
 */

/** Toggles one id in or out of a selection. Order is preserved — new picks append at the end. */
export function toggleSelected(selectedIds: readonly string[], id: string): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((selectedId) => selectedId !== id)
    : [...selectedIds, id];
}

/** "3 ausgewählt" — the selection-mode header count. */
export function formatSelectionCountLabel(count: number): string {
  return `${count} ausgewählt`;
}

/**
 * The delete confirmation body text — honest about what actually happens
 * now (2026-08-15, trash feature): the photo only disappears from the
 * chronology, on both phones; the files themselves stay in storage for 30
 * days (features/photos/identity.ts#TRASH_RETENTION_DAYS), recoverable from
 * the trash (src/app/papierkorb.tsx) or permanently removable there ahead
 * of time. Shared with the single-photo confirmation in
 * src/app/foto/[id].tsx (called with count 1) so the wording can't drift
 * between the two delete paths.
 */
export function formatDeleteConfirmationMessage(count: number): string {
  if (count === 1) {
    return 'Das ausgewählte Foto verschwindet aus der Chronik, auch vom Handy des anderen Elternteils, und liegt 30 Tage im Papierkorb — dort lässt es sich wiederherstellen oder endgültig löschen.';
  }
  return `${count} ausgewählte Fotos verschwinden aus der Chronik, auch vom Handy des anderen Elternteils, und liegen 30 Tage im Papierkorb — dort lassen sie sich wiederherstellen oder endgültig löschen.`;
}
