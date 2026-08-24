/**
 * tree — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for the
 * "Stammbaum" tab: `relatives`, their partnerships (`relative_unions`), and
 * — Stufe 2, not built yet — `relative_photos`. `removePhotoFromAllRelatives`
 * is wired in already regardless (task requirement), even though nothing
 * writes a `relative_photos` row yet.
 *
 * WRITE ORDER: `relatives`/`relative_unions`/`relative_photos` carry no
 * real foreign keys to each other (CLAUDE.md Fallstrick 12 — a real FK
 * between two synced tables lets a child row outrun its parent row through
 * PowerSync's upload queue and wedge every later upload from that device,
 * exactly what `milestone_photos.milestone_id` did before that fix). No
 * constraint enforces it here, but this module still writes a relative
 * BEFORE any union that references it, by convention — see `addRelative`.
 *
 * CIRCULAR IMPORT, KNOWN AND SAFE: this module imports
 * `removeStoredObjects` from features/photos/storage.ts, which itself
 * imports `removePhotoFromAllRelatives` (below) from THIS module — a real
 * cycle. Both sides only ever call the other's export from inside an
 * async function body, never at module-evaluation time, so by the time
 * either is actually invoked (a user tapping a button, long after both
 * modules finished loading) every export is fully bound — the same
 * lazy-binding guarantee CommonJS/Metro give any circular `require`.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase, Transaction } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { nowUtcIso, toLocalDate } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';

import { removeStoredObjects } from '@/features/photos/storage';

import { DEFAULT_UNION_KIND, formatGermanDate, partnerIdFromUnion } from './logic';
import { uploadRelativePhoto } from './photo';
import { SUGGESTIBLE_RELATIVE_FIELDS, isSuggestionFieldSet } from './suggestions';
import { copySuggestionPhotoToRelative, removeSuggestionPhoto } from './suggestion-photo';
import type { RelativeGender, RelativeRow, RelativeUnionRow, TreeSuggestionRow } from './types';

const RELATIVE_COLUMNS = `
  id, household_id, child_id, given_name, family_name, birth_name, gender,
  born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
  photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
`;

const UNION_COLUMNS = `
  id, household_id, a_id, b_id, kind, since_on, until_on,
  created_by, created_at, updated_at, deleted_at, source_device_id
`;

const SUGGESTION_COLUMNS = `
  id, household_id, share_id, device_id, visitor_name, kind, relative_id,
  given_name, family_name, birth_name, gender, born_on, born_place, deceased,
  died_on, died_place, mother_id, father_id, message, photo_key, photo_bytes, photo_mime, status,
  created_at, decided_at, decided_by, updated_at, deleted_at, source_device_id
`;

async function loadRelativeById(db: AbstractPowerSyncDatabase, relativeId: string): Promise<RelativeRow | null> {
  const rows = await db.getAll<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives WHERE id = ? AND deleted_at IS NULL`,
    [relativeId],
  );
  return rows[0] ?? null;
}

/** Reactive: every relative of a household, in display order. */
export function useRelativesOfHousehold(householdId: string | undefined): {
  relatives: RelativeRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives
      WHERE household_id = ? AND deleted_at IS NULL
      ORDER BY sort_index ASC, created_at ASC`,
    [householdId ?? ''],
  );
  return { relatives: data ?? [], isLoading };
}

/** Reactive single relative by id, for the detail and edit screens. */
export function useRelativeById(relativeId: string | undefined): {
  relative: RelativeRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives WHERE id = ? AND deleted_at IS NULL`,
    [relativeId ?? ''],
  );
  return { relative: data?.[0], isLoading };
}

/** Reactive: every partnership of a household — the relation graph's other edge (see logic.ts#RelationGraphPerson). */
export function useUnionsOfHousehold(householdId: string | undefined): {
  unions: RelativeUnionRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions WHERE household_id = ? AND deleted_at IS NULL`,
    [householdId ?? ''],
  );
  return { unions: data ?? [], isLoading };
}

/** Reactive: the id of one relative's current partner, from either side of `relative_unions` — for the edit form's "Partner" field and the detail screen's link. */
export function useRelativePartnerId(relativeId: string | undefined): {
  partnerId: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions
      WHERE (a_id = ? OR b_id = ?) AND deleted_at IS NULL
      LIMIT 1`,
    [relativeId ?? '', relativeId ?? ''],
  );
  const union = data?.[0];
  return { partnerId: union && relativeId ? partnerIdFromUnion(union, relativeId) : null, isLoading };
}

/**
 * Makes `desiredPartnerId` the one active partnership `relativeId` has,
 * replacing whatever it had before — soft-deletes the old union (if any
 * and if different) before inserting the new one (if any), all inside the
 * caller's transaction. A no-op when the desired partner already matches
 * the existing one, so an unrelated field edit never touches this table.
 */
async function reconcilePartnerUnion(
  tx: Transaction,
  relativeId: string,
  householdId: string,
  userId: string,
  desiredPartnerId: string | null,
): Promise<void> {
  const existingRows = await tx.getAll<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions
      WHERE (a_id = ? OR b_id = ?) AND deleted_at IS NULL
      LIMIT 1`,
    [relativeId, relativeId],
  );
  const existingUnion = existingRows[0] ?? null;
  const existingPartnerId = existingUnion ? partnerIdFromUnion(existingUnion, relativeId) : null;

  if (existingPartnerId === desiredPartnerId) {
    return;
  }

  const now = nowUtcIso();
  if (existingUnion) {
    await tx.execute('UPDATE relative_unions SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      existingUnion.id,
    ]);
  }
  if (desiredPartnerId) {
    await tx.execute(
      `INSERT INTO relative_unions (
         id, household_id, a_id, b_id, kind, since_on, until_on,
         created_by, created_at, updated_at, deleted_at, source_device_id
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL)`,
      [newId(), householdId, relativeId, desiredPartnerId, DEFAULT_UNION_KIND, userId, now, now],
    );
  }
}

export type AddRelativeInput = {
  householdId: string;
  userId: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: RelativeGender | null;
  /** Free text, see types.ts#RelativeRow. */
  bornOn: string | null;
  bornPlace: string | null;
  deceased: boolean;
  diedOn: string | null;
  diedPlace: string | null;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  note: string | null;
};

/**
 * Creates a relative, at the end of the household's roster
 * (`sort_index` = current count, same convention as
 * people/repository.ts#addPerson). Throws for an empty given name — the
 * same "letztes Netz" every other required-name field in this project
 * keeps at the data layer, independent of the form's own validation.
 */
export async function addRelative(db: AbstractPowerSyncDatabase, input: AddRelativeInput): Promise<string> {
  const givenName = input.givenName.trim();
  if (givenName.length === 0) {
    throw new Error('tree: Person ohne Vornamen kann nicht gespeichert werden');
  }

  const countRows = await db.getAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM relatives WHERE household_id = ? AND deleted_at IS NULL',
    [input.householdId],
  );
  const sortIndex = countRows[0]?.n ?? 0;

  const id = newId();
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    // Relative row first, partnership second — see this module's own doc
    // comment on write order (Fallstrick 12).
    await tx.execute(
      `INSERT INTO relatives (
         id, household_id, child_id, given_name, family_name, birth_name, gender,
         born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
         photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        id,
        input.householdId,
        givenName,
        input.familyName,
        input.birthName,
        input.gender,
        input.bornOn,
        input.bornPlace,
        input.deceased ? 1 : 0,
        input.diedOn,
        input.diedPlace,
        input.motherId,
        input.fatherId,
        input.note,
        sortIndex,
        input.userId,
        now,
        now,
      ],
    );
    await reconcilePartnerUnion(tx, id, input.householdId, input.userId, input.partnerId);
  });

  return id;
}

export type UpdateRelativeInput = {
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: RelativeGender | null;
  bornOn: string | null;
  bornPlace: string | null;
  deceased: boolean;
  diedOn: string | null;
  diedPlace: string | null;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  note: string | null;
};

/**
 * Applies an edit from the relative form. Does not touch `photo_key` — see
 * `setRelativePhotoKey`. `userId` is only needed for a freshly-inserted
 * `relative_unions` row's `created_by` (see `reconcilePartnerUnion`) — this
 * function otherwise never creates a new row, unlike `addRelative`.
 *
 * LETZTES NETZ (Architekturregel 9): identisch zu
 * `people/repository.ts#updatePerson` — ein leerer Vorname ist nie eine
 * gültige Absicht.
 */
export async function updateRelative(
  db: AbstractPowerSyncDatabase,
  relativeId: string,
  userId: string,
  input: UpdateRelativeInput,
): Promise<void> {
  const givenName = input.givenName.trim();
  if (givenName.length === 0) {
    throw new Error('tree: Person ohne Vornamen kann nicht gespeichert werden');
  }

  const relative = await loadRelativeById(db, relativeId);
  if (!relative) {
    return;
  }
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE relatives
          SET given_name = ?, family_name = ?, birth_name = ?, gender = ?,
              born_on = ?, born_place = ?, deceased = ?, died_on = ?, died_place = ?,
              mother_id = ?, father_id = ?, note = ?, updated_at = ?
        WHERE id = ?`,
      [
        givenName,
        input.familyName,
        input.birthName,
        input.gender,
        input.bornOn,
        input.bornPlace,
        input.deceased ? 1 : 0,
        input.diedOn,
        input.diedPlace,
        input.motherId,
        input.fatherId,
        input.note,
        now,
        relativeId,
      ],
    );
    await reconcilePartnerUnion(tx, relativeId, relative.household_id, userId, input.partnerId);
  });
}

/** Records the uploaded portrait's storage key, once the upload has actually succeeded — mirrors people/repository.ts#setPersonPhotoKey. */
export async function setRelativePhotoKey(
  db: AbstractPowerSyncDatabase,
  relativeId: string,
  photoKey: string,
): Promise<void> {
  await db.execute('UPDATE relatives SET photo_key = ?, updated_at = ? WHERE id = ?', [
    photoKey,
    nowUtcIso(),
    relativeId,
  ]);
}

/** Soft-delete, mirroring the convention used by every other table (Spec §5.1). */
export async function softDeleteRelative(db: AbstractPowerSyncDatabase, relativeId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE relatives SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, relativeId]);
}

/**
 * The one relatives row that IS the tracked child (`child_id` set) —
 * created once, the first time the "Stammbaum" tab is opened, from the
 * `children` row already on screen (given name, and `born_on` seeded as
 * "TT.MM.JJJJ" from `birth_at`/`birth_tz` — free text from then on, never
 * recomputed, same as every other `born_on`). Idempotent: checked first,
 * so opening the tab twice — or on both parents' phones — never creates a
 * second root row. No confirmation prompt (task requirement); the row is
 * ordinary and editable afterwards like any other.
 */
export async function ensureRootRelative(
  db: AbstractPowerSyncDatabase,
  child: Pick<ActiveChild, 'householdId' | 'childId' | 'firstName' | 'birthAtUtcIso' | 'birthTz'>,
  userId: string,
): Promise<string> {
  const existing = await db.getAll<{ id: string }>(
    `SELECT id FROM relatives WHERE household_id = ? AND child_id = ? AND deleted_at IS NULL LIMIT 1`,
    [child.householdId, child.childId],
  );
  if (existing[0]) {
    return existing[0].id;
  }

  const id = newId();
  const now = nowUtcIso();
  const bornOn = formatGermanDate(toLocalDate(child.birthAtUtcIso, child.birthTz));

  await db.execute(
    `INSERT INTO relatives (
       id, household_id, child_id, given_name, family_name, birth_name, gender,
       born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
       photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
     ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL)`,
    [id, child.householdId, child.childId, child.firstName, bornOn, userId, now, now],
  );
  return id;
}

/**
 * Removes a photo from every relative it was ever linked to — the last
 * step of a PERMANENT photo delete
 * (features/photos/storage.ts#permanentlyDeletePhoto), called AFTER the
 * photo's own row is already gone. Wired in ahead of Stufe 2 (task
 * requirement): nothing writes a `relative_photos` row yet, so this is
 * currently always a no-op, but the cleanup path exists from the start
 * rather than being retrofitted once photos actually get linked.
 */
export async function removePhotoFromAllRelatives(db: AbstractPowerSyncDatabase, photoId: string): Promise<void> {
  await db.execute('DELETE FROM relative_photos WHERE photo_id = ?', [photoId]);
}

/* ────────────────────────────── Vorschläge aus dem geteilten Stammbaum (2026-08-24) ────────────────────────────── */

/** Reactive: every non-deleted suggestion of a household, newest first — the review screen splits this into "offen"/"erledigt" itself, and the tab button's badge just counts `status === 'open'` from the same list. */
export function useTreeSuggestionsOfHousehold(householdId: string | undefined): {
  suggestions: TreeSuggestionRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<TreeSuggestionRow>(
    `SELECT ${SUGGESTION_COLUMNS} FROM tree_suggestions
      WHERE household_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [householdId ?? ''],
  );
  return { suggestions: data ?? [], isLoading };
}

/** Reactive single suggestion by id, for the "Bearbeiten und übernehmen" prefill in neu.tsx/bearbeiten.tsx. `isLoading` — not the value itself — is what tells a caller "still loading" apart from "does not exist", same convention as `useRelativeById`. */
export function useTreeSuggestionById(suggestionId: string | undefined): {
  suggestion: TreeSuggestionRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<TreeSuggestionRow>(
    `SELECT ${SUGGESTION_COLUMNS} FROM tree_suggestions WHERE id = ? AND deleted_at IS NULL`,
    [suggestionId ?? ''],
  );
  return { suggestion: data?.[0], isLoading };
}

async function existingRelativeId(
  db: AbstractPowerSyncDatabase,
  householdId: string,
  candidateId: string | null,
): Promise<string | null> {
  if (!candidateId) {
    return null;
  }
  const rows = await db.getAll<{ id: string }>(
    'SELECT id FROM relatives WHERE id = ? AND household_id = ? AND deleted_at IS NULL',
    [candidateId, householdId],
  );
  return rows[0]?.id ?? null;
}

async function markSuggestionDecided(
  db: AbstractPowerSyncDatabase,
  suggestionId: string,
  userId: string,
  status: 'accepted' | 'rejected',
): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE tree_suggestions SET status = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ?', [
    status,
    now,
    userId,
    now,
    suggestionId,
  ]);
}

/**
 * Marks a suggestion accepted without touching `relatives` — used both by
 * this module's own direct-accept functions below AND by the "Bearbeiten
 * und übernehmen" screens (neu.tsx/bearbeiten.tsx), which write the
 * `relatives` row themselves via the normal form path (`addRelative`/
 * `updateRelative`) and then call this once that write has succeeded —
 * same write-before-decide order as the direct-accept path (Fallstrick 12).
 */
export async function markSuggestionAccepted(
  db: AbstractPowerSyncDatabase,
  suggestionId: string,
  userId: string,
): Promise<void> {
  await markSuggestionDecided(db, suggestionId, userId, 'accepted');
}

/**
 * Removes a suggestion's guest photo (if any) from the `suggestions`
 * bucket and clears its three photo columns — used whenever a suggestion
 * reaches a final state without the photo having been copied anywhere
 * (rejected, or a `kind: 'note'` that had one attached with nowhere to put
 * it): a leftover guest photo costs storage indefinitely and is not
 * privacy-defensible (task requirement). Best-effort on the bucket delete
 * — `removeSuggestionPhoto` is itself idempotent for an already-missing
 * object (two devices handling the same suggestion at once), but any
 * OTHER failure there must not stop the column update: an orphaned file a
 * caregiver can still find is a smaller problem than a suggestion stuck
 * mid-decision forever.
 */
async function discardSuggestionPhoto(db: AbstractPowerSyncDatabase, suggestion: TreeSuggestionRow): Promise<void> {
  if (!suggestion.photo_key) {
    return;
  }
  try {
    await removeSuggestionPhoto(suggestion.photo_key);
  } catch (deleteError) {
    console.error('[LifeBook] Gastfoto konnte nicht aus dem Zwischenspeicher gelöscht werden', deleteError);
  }
  await db.execute(
    'UPDATE tree_suggestions SET photo_key = NULL, photo_bytes = NULL, photo_mime = NULL, updated_at = ? WHERE id = ?',
    [nowUtcIso(), suggestion.id],
  );
}

/**
 * Attaches a suggestion's photo to `relativeId` and consumes it — either
 * the guest's ORIGINAL upload (direct "Übernehmen": `croppedLocalUri`
 * omitted, `suggestion.photo_key` copied bucket-to-bucket as-is) or an
 * already-cropped LOCAL file ("Bearbeiten und übernehmen" through
 * portrait-cropper.tsx: uploaded the same way a self-picked portrait is).
 * `previousPhotoKey` — the relative's OWN prior portrait, if any — is
 * best-effort cleaned up after the new one is set, same pattern
 * stammbaum/[id]/bearbeiten.tsx already uses for a directly-picked photo.
 *
 * Returns `'none'` when there was nothing to attach (no photo either way —
 * the overwhelmingly common case), `'applied'`, or `'failed'` — a failure
 * here is reported to the caller but must NOT stop the rest of accepting
 * a suggestion (its text fields, if any, are still worth keeping) — see
 * this function's callers below. A missing source object (the other half
 * of a concurrent accept already consumed it) surfaces as `'failed'` here
 * too, exactly as intended: "fehlende Datei = still weitermachen" means
 * the CALLER continues regardless, not that this counts as success.
 */
async function attachSuggestionPhoto(
  db: AbstractPowerSyncDatabase,
  suggestion: TreeSuggestionRow,
  relativeId: string,
  previousPhotoKey: string | null,
  croppedLocalUri?: string,
): Promise<'none' | 'applied' | 'failed'> {
  if (!suggestion.photo_key && !croppedLocalUri) {
    return 'none';
  }
  try {
    const newKey = croppedLocalUri
      ? await uploadRelativePhoto(suggestion.household_id, relativeId, croppedLocalUri)
      : await copySuggestionPhotoToRelative(
          suggestion.photo_key as string,
          suggestion.photo_mime,
          suggestion.household_id,
          relativeId,
        );
    await setRelativePhotoKey(db, relativeId, newKey);
    if (previousPhotoKey) {
      try {
        await removeStoredObjects(previousPhotoKey, null, null);
      } catch (cleanupError) {
        console.error('[LifeBook] Altes Portrait konnte nicht aufgeräumt werden', cleanupError);
      }
    }
    if (suggestion.photo_key) {
      await discardSuggestionPhoto(db, suggestion);
    }
    return 'applied';
  } catch (photoError) {
    console.error('[LifeBook] Gastfoto konnte nicht übernommen werden', photoError);
    return 'failed';
  }
}

/** "Ablehnen" — status only, nothing about `relatives` deleted (task requirement: stays readable in the collapsed "Erledigt" section). Its guest photo, if any, IS deleted — an unused suggestion's photo has nothing left to wait for. */
export async function rejectSuggestion(
  db: AbstractPowerSyncDatabase,
  suggestion: TreeSuggestionRow,
  userId: string,
): Promise<void> {
  await discardSuggestionPhoto(db, suggestion);
  await markSuggestionDecided(db, suggestion.id, userId, 'rejected');
}

export type AcceptAddSuggestionResult = {
  relativeId: string;
  /** true when the suggestion named a mother_id/father_id that is NOT a real, current relative of this household — dropped rather than written, see this function's own doc comment. */
  droppedMotherId: boolean;
  droppedFatherId: boolean;
  /** true when the suggestion (or `croppedLocalUri`) had a photo to attach and doing so failed — the relative itself was still created; see `attachSuggestionPhoto`'s own doc comment. */
  photoFailed: boolean;
};

/**
 * Direct "Übernehmen" for a `kind: 'add'` suggestion — creates the
 * `relatives` row straight from the suggested fields, no form step.
 * `mother_id`/`father_id` are carried over ONLY when that id is a REAL,
 * non-deleted relative of THIS household right now (task requirement): a
 * guest cannot be trusted to have typed a valid id, and a dangling
 * reference would silently point at nothing. Writes the relative BEFORE
 * marking the suggestion accepted (Fallstrick 12), and BEFORE attaching
 * any photo (task 3's own explicit ordering: "Bei kind = 'add' erst die
 * relatives-Zeile erzeugen, dann kopieren" — there is no `relative_id` for
 * the photo's storage path before this write happens).
 *
 * `croppedLocalUri` — provided when this is being called from the
 * "Bearbeiten und übernehmen" crop flow (stammbaum/vorschlaege.tsx) —
 * routes the photo through `uploadRelativePhoto` instead of copying
 * `suggestion.photo_key` as-is; omit it for the plain direct-accept path.
 */
export async function acceptAddSuggestion(
  db: AbstractPowerSyncDatabase,
  suggestion: TreeSuggestionRow,
  userId: string,
  croppedLocalUri?: string,
): Promise<AcceptAddSuggestionResult> {
  const [motherId, fatherId] = await Promise.all([
    existingRelativeId(db, suggestion.household_id, suggestion.mother_id),
    existingRelativeId(db, suggestion.household_id, suggestion.father_id),
  ]);

  const relativeId = await addRelative(db, {
    householdId: suggestion.household_id,
    userId,
    givenName: suggestion.given_name ?? '',
    familyName: suggestion.family_name,
    birthName: suggestion.birth_name,
    gender: suggestion.gender,
    bornOn: suggestion.born_on,
    bornPlace: suggestion.born_place,
    deceased: suggestion.deceased === 1,
    diedOn: suggestion.died_on,
    diedPlace: suggestion.died_place,
    motherId,
    fatherId,
    partnerId: null,
    note: null,
  });

  const photoOutcome = await attachSuggestionPhoto(db, suggestion, relativeId, null, croppedLocalUri);
  await markSuggestionAccepted(db, suggestion.id, userId);

  return {
    relativeId,
    droppedMotherId: !!suggestion.mother_id && !motherId,
    droppedFatherId: !!suggestion.father_id && !fatherId,
    photoFailed: photoOutcome === 'failed',
  };
}

export type AcceptEditSuggestionResult = {
  /** true when the suggestion (or `croppedLocalUri`) had a photo to attach and doing so failed — the text-field changes were still applied; see `attachSuggestionPhoto`'s own doc comment. */
  photoFailed: boolean;
};

/**
 * Direct "Übernehmen" for a `kind: 'edit'` suggestion — overwrites ONLY the
 * fields the suggestion actually proposed (task requirement), using the
 * exact same field list `suggestions.ts#changedFields` displays, so what a
 * caregiver saw on screen is exactly what this writes — never
 * `mother_id`/`father_id`, see `SUGGESTIBLE_RELATIVE_FIELDS`'s own doc
 * comment for why. Writes the relative BEFORE marking the suggestion
 * accepted (Fallstrick 12). `croppedLocalUri` — see
 * `acceptAddSuggestion`'s own doc comment, same meaning here.
 */
export async function acceptEditSuggestion(
  db: AbstractPowerSyncDatabase,
  suggestion: TreeSuggestionRow,
  userId: string,
  croppedLocalUri?: string,
): Promise<AcceptEditSuggestionResult> {
  if (!suggestion.relative_id) {
    throw new Error('tree: Änderungsvorschlag ohne Zielperson');
  }
  const relative = await loadRelativeById(db, suggestion.relative_id);
  if (!relative) {
    throw new Error('tree: Zielperson des Vorschlags existiert nicht mehr');
  }

  const setFields = SUGGESTIBLE_RELATIVE_FIELDS.filter((field) => isSuggestionFieldSet(suggestion, field));
  if (setFields.length > 0) {
    const setClause = setFields.map((field) => `${field} = ?`).join(', ');
    const values = setFields.map((field) => suggestion[field]);
    await db.execute(`UPDATE relatives SET ${setClause}, updated_at = ? WHERE id = ?`, [
      ...values,
      nowUtcIso(),
      suggestion.relative_id,
    ]);
  }

  const photoOutcome = await attachSuggestionPhoto(db, suggestion, suggestion.relative_id, relative.photo_key, croppedLocalUri);
  await markSuggestionAccepted(db, suggestion.id, userId);

  return { photoFailed: photoOutcome === 'failed' };
}

/** Direct "Übernehmen" for a `kind: 'note'` suggestion — no data change at all, just marks it done (task requirement). Its guest photo, if any, is discarded — a `kind: 'note'` has no relative to attach one to. */
export async function acceptNoteSuggestion(
  db: AbstractPowerSyncDatabase,
  suggestion: TreeSuggestionRow,
  userId: string,
): Promise<void> {
  await discardSuggestionPhoto(db, suggestion);
  await markSuggestionAccepted(db, suggestion.id, userId);
}
