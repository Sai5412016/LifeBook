/**
 * events — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for the
 * "Ereignisse" tab: special moments with a title, an optional text and
 * photos. Backed by the pre-existing `milestones` table — originally meant
 * for a structured milestone tracker (`milestone_key`/`achieved_at`, both
 * still in the schema) that was never built. This feature reuses the table
 * for a simpler, free-form "special moment" instead and leaves those two
 * columns alone (always NULL here) — see core/db/schema.ts's own comment
 * on `milestones`.
 *
 * `milestone_photos` links photos to an event, in display order
 * (`sort_index`). Unlike `shares`/`share_photos`, this table DOES go
 * through PowerSync — see core/db/schema.ts's comment on why. Its
 * `household_id` is a plain denormalized column (not derived via a JOIN
 * against `milestones` — Sync Rules cannot express that), so every write
 * to it below carries the owning event's `household_id` explicitly.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase, Transaction } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { applyOccurredAtCorrection, combineLocalDateAndTime, nowUtcIso, toLocalDate } from '@/core/time';

import { normalizeEventNote, normalizeEventTitle, planEventPhotoOrder, sortEventsByOccurredAtDesc } from './logic';
import type { EventPhotoRow, EventRow, EventSummaryRow } from './types';

/** Columns every plain read selects, so callers always get a complete EventRow. */
const EVENT_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note, title, photo_id
`;

async function loadEventById(db: AbstractPowerSyncDatabase, eventId: string): Promise<EventRow | null> {
  const rows = await db.getAll<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM milestones WHERE id = ? AND deleted_at IS NULL`,
    [eventId],
  );
  return rows[0] ?? null;
}

/** Reactive: every event of a child, newest first — the "Ereignisse" tab's list. */
export function useEventsOfChild(childId: string | undefined): {
  events: EventSummaryRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<EventSummaryRow>(
    `SELECT m.id, m.household_id, m.child_id, m.occurred_at, m.tz, m.local_date,
            m.created_by, m.created_at, m.updated_at, m.deleted_at, m.source_device_id,
            m.note, m.title, m.photo_id,
            p.thumb_key AS title_thumb_key, p.local_uri AS title_local_uri
       FROM milestones m
       LEFT JOIN photos p ON p.id = m.photo_id AND p.deleted_at IS NULL
      WHERE m.child_id = ? AND m.deleted_at IS NULL
      ORDER BY m.occurred_at DESC`,
    [childId ?? ''],
  );

  // The SQL above already orders the same way — applying the pure,
  // separately-tested sort here too means the two can never quietly drift
  // apart if either one changes later (same idiom as people/repository.ts#usePeopleOfChild).
  return { events: sortEventsByOccurredAtDesc(data ?? []), isLoading };
}

/** Reactive single event by id, for the detail and edit screens. */
export function useEventById(eventId: string | undefined): { event: EventRow | undefined; isLoading: boolean } {
  const { data, isLoading } = useQuery<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM milestones WHERE id = ? AND deleted_at IS NULL`,
    [eventId ?? ''],
  );
  return { event: data?.[0], isLoading };
}

/** Reactive: every photo linked to one event, in display order. */
export function useEventPhotos(eventId: string | undefined): { photoIds: string[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<EventPhotoRow>(
    `SELECT id, household_id, milestone_id, photo_id, sort_index, added_at
       FROM milestone_photos
      WHERE milestone_id = ?
      ORDER BY sort_index ASC`,
    [eventId ?? ''],
  );
  return { photoIds: (data ?? []).map((row) => row.photo_id), isLoading };
}

/**
 * Replaces `milestone_photos` for one event with `photoIds` (in order) and
 * updates the event's own `photo_id` title-image column to match, all in
 * one transaction. `householdId` is always the OWNING event's own
 * `household_id` (never re-derived from anything else) — required since
 * 2026-08-22: `milestone_photos.household_id` is a plain NOT NULL column
 * now, not read via a JOIN against `milestones` any more (Sync Rules
 * cannot express that JOIN — see core/db/schema.ts's comment on this table,
 * CLAUDE.md Fallstrick 11). Omitting it here would fail the Supabase
 * upload with a NOT NULL violation.
 */
async function replaceEventPhotos(
  tx: Transaction,
  eventId: string,
  householdId: string,
  photoIds: readonly string[],
): Promise<string | null> {
  const plan = planEventPhotoOrder(photoIds);
  const now = nowUtcIso();

  await tx.execute('DELETE FROM milestone_photos WHERE milestone_id = ?', [eventId]);
  for (const entry of plan.photos) {
    await tx.execute(
      `INSERT INTO milestone_photos (id, household_id, milestone_id, photo_id, sort_index, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), householdId, eventId, entry.photoId, entry.sortIndex, now],
    );
  }
  return plan.titlePhotoId;
}

export type AddEventInput = {
  householdId: string;
  childId: string;
  userId: string;
  title: string;
  note: string | null;
  /** "YYYY-MM-DD" — the screen's date-picker field. */
  localDate: string;
  /** "HH:mm" — the screen's time-picker field. */
  time: string;
  /** The device's current IANA zone — an event is created "now", the same convention every other event table uses at insert. */
  tz: string;
  /** Ordered; the first entry becomes the title image. May be empty. */
  photoIds: readonly string[];
};

/**
 * Creates an event and its photo links. Throws for an empty title or an
 * unparseable date/time — the same "letztes Netz" the data layer keeps for
 * every other required field in this project (people/repository.ts#addPerson's
 * sibling functions), independent of whatever validation the form already did.
 *
 * WRITE ORDER (2026-08-22, Fallstrick 12): the `milestones` row is inserted
 * FIRST, `milestone_photos` SECOND — both inside the one transaction below,
 * but PowerSync uploads a device's queued operations to Supabase in the
 * order they were LOCALLY EXECUTED, not grouped by transaction. With the
 * order reversed (as this function originally had it), the very first
 * upload attempt was a `milestone_photos` insert whose `milestone_id`
 * doesn't exist in Postgres yet — a foreign-key 409 that PowerSync retries
 * forever, wedging EVERY later upload from this device behind it (photos,
 * Alltag-Einträge, everything), confirmed against the live environment.
 * `milestone_photos.milestone_id` has a real `REFERENCES milestones(id)`
 * foreign key (see core/db/schema.ts's comment on the table), so this
 * parent-before-child order is load-bearing, not stylistic.
 *
 * No automated test guards this: the project has no PowerSync/transaction
 * mock to assert generated statement ORDER against (every other repository
 * in this codebase is untested for the same reason — see the session
 * report). This comment is the documented substitute the task explicitly
 * allows for that case.
 */
export async function addEvent(db: AbstractPowerSyncDatabase, input: AddEventInput): Promise<string> {
  const title = normalizeEventTitle(input.title);
  if (title.length === 0) {
    throw new Error('events: Ereignis ohne Titel kann nicht gespeichert werden');
  }

  const occurredAtUtcIso = combineLocalDateAndTime(input.localDate, input.time, input.tz);
  if (!occurredAtUtcIso) {
    throw new Error('events: Datum/Uhrzeit konnten nicht verarbeitet werden');
  }
  const localDate = toLocalDate(occurredAtUtcIso, input.tz);
  const note = normalizeEventNote(input.note ?? '');
  const id = newId();
  const now = nowUtcIso();
  // Same title-image rule `replaceEventPhotos` applies below, computed
  // separately here so the `milestones` INSERT can carry `photo_id` right
  // away instead of a second UPDATE after it — the parent row still goes
  // first either way (see this function's own doc comment).
  const titlePhotoId = planEventPhotoOrder(input.photoIds).titlePhotoId;

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO milestones (
         id, household_id, child_id, occurred_at, tz, local_date, created_by,
         created_at, updated_at, deleted_at, source_device_id, note,
         milestone_key, achieved_at, photo_id, title
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      [id, input.householdId, input.childId, occurredAtUtcIso, input.tz, localDate, input.userId, now, now, note, titlePhotoId, title],
    );
    await replaceEventPhotos(tx, id, input.householdId, input.photoIds);
  });

  return id;
}

export type UpdateEventInput = {
  title: string;
  note: string | null;
  /** "YYYY-MM-DD" — always sent; only actually re-derives `occurred_at`/`local_date` if it (or `time`) differs from the stored event, see below. */
  localDate: string;
  time: string;
  /** Ordered; the first entry becomes the title image. May be empty. */
  photoIds: readonly string[];
};

/**
 * Applies an edit from the event form — title, text, date/time and photo
 * selection, all in one transaction.
 *
 * Architekturregel 2's one exception: an explicit date/time correction
 * re-derives `occurred_at` AND `local_date` together, via
 * `applyOccurredAtCorrection`, using the EVENT'S OWN stored `tz` — never
 * the device's current zone — exactly the pattern
 * `features/photos/repository.ts#correctPhotoOccurredAt` established
 * (CLAUDE.md names this feature as following it).
 *
 * LETZTES NETZ (Architekturregel 9): an empty title is rejected here too,
 * independent of the form's own validation — see
 * `people/repository.ts#updatePerson`'s identical guard.
 *
 * NOT SUBJECT TO addEvent's write-order hazard (Fallstrick 12): the
 * `milestone_photos` rows `replaceEventPhotos` writes below reference
 * `eventId`, an EXISTING `milestones` row whose own INSERT was already
 * queued earlier — by an earlier call to `addEvent` — so it always precedes
 * these operations in the upload queue regardless of statement order
 * inside this function. There is no new parent row for a child row to
 * outrun here.
 */
export async function updateEvent(
  db: AbstractPowerSyncDatabase,
  eventId: string,
  input: UpdateEventInput,
): Promise<void> {
  const title = normalizeEventTitle(input.title);
  if (title.length === 0) {
    throw new Error('events: Ereignis ohne Titel kann nicht gespeichert werden');
  }

  const event = await loadEventById(db, eventId);
  if (!event) {
    return;
  }

  const corrected = applyOccurredAtCorrection(input.localDate, input.time, event.tz);
  if (!corrected) {
    throw new Error('events: Datum/Uhrzeit konnten nicht verarbeitet werden');
  }
  const note = normalizeEventNote(input.note ?? '');
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    const titlePhotoId = await replaceEventPhotos(tx, eventId, event.household_id, input.photoIds);
    await tx.execute(
      `UPDATE milestones
          SET title = ?, note = ?, occurred_at = ?, local_date = ?, photo_id = ?, updated_at = ?
        WHERE id = ?`,
      [title, note, corrected.occurredAtUtcIso, corrected.localDate, titlePhotoId, now, eventId],
    );
  });
}

/** Soft-delete, mirroring the convention used by every other event table. */
export async function softDeleteEvent(db: AbstractPowerSyncDatabase, eventId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE milestones SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, eventId]);
}

/**
 * Removes a photo from every event it was ever linked to, and clears it as
 * any event's title image — the last step of a PERMANENT photo delete
 * (features/photos/storage.ts#permanentlyDeletePhoto), called AFTER the
 * photo's own row is already gone. Unlike the same cleanup for shares
 * (features/shares/repository.ts#removePhotoFromAllShares), this runs
 * against the local PowerSync database directly — `milestone_photos` is a
 * normal synced table, not a Supabase-only one.
 */
export async function removePhotoFromAllEvents(db: AbstractPowerSyncDatabase, photoId: string): Promise<void> {
  const now = nowUtcIso();
  await db.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM milestone_photos WHERE photo_id = ?', [photoId]);
    await tx.execute('UPDATE milestones SET photo_id = NULL, updated_at = ? WHERE photo_id = ?', [now, photoId]);
  });
}
