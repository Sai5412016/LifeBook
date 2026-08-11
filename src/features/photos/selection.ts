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
 * The delete confirmation body text — names the exact count and states
 * plainly that it is final, mirroring the single-photo wording in
 * src/app/foto/[id].tsx (there is no trash/undo feature yet, so the UI must
 * never suggest recoverability it doesn't have).
 */
export function formatDeleteConfirmationMessage(count: number): string {
  const subject = count === 1 ? 'Das ausgewählte Foto wird' : `${count} ausgewählte Fotos werden`;
  const pronoun = count === 1 ? 'es' : 'sie';
  return `${subject} unwiderruflich gelöscht — auch vom Handy des anderen Elternteils. Es gibt keine Möglichkeit, ${pronoun} wiederherzustellen.`;
}
