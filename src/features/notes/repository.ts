/**
 * notes — repository (Spec §4 rule: features access data ONLY through
 * here).
 *
 * Read-only so far: this app has no note-entry screen yet (out of scope for
 * the task that added this, 2026-09-26 — features/timeline's Tagesverlauf
 * only ever READS `notes`, never writes it), same situation as
 * features/growth/repository.ts.
 */

import { useQuery } from '@powersync/react-native';

import type { NoteRow } from './types';

/** Columns every read selects, so callers always get a complete NoteRow. */
const NOTE_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note, title
`;

/** Reactive: every note of one local calendar day (`local_date`, YYYY-MM-DD), oldest first — features/timeline (task 2026-09-26). */
export function useNotesOfDay(childId: string | undefined, localDate: string | undefined): NoteRow[] {
  const { data } = useQuery<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return data ?? [];
}
