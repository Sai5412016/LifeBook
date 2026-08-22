/**
 * core/db/schema.ts — PowerSync AppSchema (Master-Spec §5).
 *
 * Notes on the PowerSync client schema model:
 * - The `id` column (TEXT PK) is IMPLICIT — PowerSync adds it to every table.
 *   We generate it client-side as UUIDv7 (see core/db + repositories).
 * - Column types are only TEXT | INTEGER | REAL. Booleans are stored as INTEGER 0/1.
 * - The client schema does NOT enforce NOT NULL, CHECK, DEFAULT or FOREIGN KEY.
 *   Those invariants are enforced at write time in each feature repository.
 * - Indexes are simple column lists (ascending). Partial indexes (WHERE …) from
 *   Spec §5.6 are not expressible here; queries always filter `deleted_at IS NULL`.
 *
 * Spec deviations (documented, not silent — see project instructions):
 * - `needs_review` (INTEGER) added to `feeds`, `sleeps`, `pumping_sessions`.
 *   Spec §6.2 requires it for the running-timer conflict resolution but §5.3 omitted it.
 * - The `timeline` UNION view (Spec §5.7) is not a Table; it is created via raw SQL
 *   after DB init (handled in core/db/queries, later step).
 *
 * WHY THE WHOLE SCHEMA IS BUILT INSIDE A FUNCTION, NOT AT MODULE SCOPE
 * ----------------------------------------------------------------------
 * `new Table(...)` / `new Schema(...)` validate their arguments and could in
 * principle throw (a bad column type, a duplicate index name). This module is
 * imported by core/db/index.ts, which `src/app/_layout.tsx` imports
 * statically — and ALL of a file's static imports finish running before that
 * file's own body does. A throw here would therefore happen before the root
 * layout has installed anything that could catch it: the app would die
 * silently, before React ever renders a single frame. `getAppSchema()` below
 * defers every one of these constructor calls to first actual use (from
 * `openDatabase()`, which wraps the call so a failure is recorded and shown
 * instead of crashing — see core/db/index.ts), and caches the result so the
 * schema is still only ever built once.
 */

import { column, Schema, Table } from '@powersync/react-native';

/**
 * Builds the schema (and every Table it's made of) and caches the result.
 * Row types for typed queries come from `Database`, below.
 */
function buildAppSchema() {
  /**
   * Standard columns present in EVERY event table (Spec §5.1), minus the
   * implicit `id`. Spread into each event table definition below.
   */
  const eventColumns = {
    household_id: column.text,
    child_id: column.text,
    occurred_at: column.text, // ISO-8601, always UTC
    tz: column.text, // IANA zone at capture time
    local_date: column.text, // YYYY-MM-DD in `tz`, DST-safe day grouping
    created_by: column.text, // user id
    created_at: column.text, // UTC
    updated_at: column.text, // UTC, Last-Write-Wins basis
    deleted_at: column.text, // soft delete (NULL = alive)
    source_device_id: column.text,
    note: column.text,
  };

  /* ────────────────────────────── Stammdaten (§5.2) ────────────────────────────── */

  const households = new Table({
    name: column.text,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  });

  const household_members = new Table({
    household_id: column.text,
    user_id: column.text,
    display_name: column.text,
    role: column.text, // owner | caregiver | viewer
    joined_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  });

  // 2026-08-12: birth_head_mm was named birth_head_circumference_mm here
  // before the Postgres migration landed under the shorter name — renamed to
  // match (PowerSync's `SELECT *` sync rule syncs by literal column name; a
  // mismatch would have meant this column silently never received data).
  // birth_place is new. birth_weight_g / birth_length_mm / avatar_photo_id
  // already matched and needed no change.
  const children = new Table({
    household_id: column.text,
    first_name: column.text,
    birth_at: column.text, // UTC
    birth_tz: column.text, // IANA, for exact age calculation
    birth_weight_g: column.integer,
    birth_length_mm: column.integer,
    birth_head_mm: column.integer,
    birth_place: column.text,
    avatar_photo_id: column.text,
    sort_index: column.integer,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  });

  /* ────────────────────────────── Event-Tabellen (§5.3) ────────────────────────────── */

  const feeds = new Table(
    {
      ...eventColumns,
      feed_type: column.text, // breast_left | breast_right | breast_both | bottle_breastmilk | bottle_formula
      amount_ml: column.integer,
      duration_left_s: column.integer,
      duration_right_s: column.integer,
      ended_at: column.text,
      is_running: column.integer, // 0 | 1
      needs_review: column.integer, // 0 | 1 — set by timer conflict resolution (§6.2)
      running_side: column.text, // left | right — which side the CURRENT live segment counts toward
      running_since: column.text, // ISO-8601 UTC — start of the current live segment, NULL while paused/stopped
    },
    { indexes: { child_time: ['child_id', 'occurred_at'], running: ['child_id', 'is_running'] } },
  );

  const sleeps = new Table(
    {
      ...eventColumns,
      ended_at: column.text,
      quality: column.integer, // 1..5
      location: column.text, // bed | stroller | arms | car | other
      is_running: column.integer,
      needs_review: column.integer,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'], running: ['child_id', 'is_running'] } },
  );

  const diapers = new Table(
    {
      ...eventColumns,
      kind: column.text, // wet | dirty | both
      consistency: column.text, // liquid | soft | formed | hard
      color: column.text, // yellow | green | brown | black | red | white
      leaked: column.integer, // 0 | 1
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const pumping_sessions = new Table(
    {
      ...eventColumns,
      side: column.text, // left | right | both
      amount_ml: column.integer,
      duration_s: column.integer,
      is_running: column.integer,
      needs_review: column.integer,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'], running: ['child_id', 'is_running'] } },
  );

  const milk_stash = new Table(
    {
      ...eventColumns,
      expressed_at: column.text,
      amount_ml: column.integer,
      storage: column.text, // fridge | freezer
      use_by_at: column.text, // purely arithmetic — NO safety statement (MDR)
      consumed_at: column.text,
      discarded_at: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const medications = new Table(
    {
      ...eventColumns,
      name: column.text,
      dose_amount: column.real,
      dose_unit: column.text, // ml | mg | drops | suppository
      route: column.text,
      reason: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const growth_measurements = new Table(
    {
      ...eventColumns,
      weight_g: column.integer,
      length_mm: column.integer,
      head_circumference_mm: column.integer,
      measured_source: column.text, // home | doctor
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const temperatures = new Table(
    {
      ...eventColumns,
      value_c: column.real,
      method: column.text, // axillary | rectal | ear | forehead | oral
      symptoms: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const vaccinations = new Table(
    {
      ...eventColumns,
      vaccine_name: column.text,
      dose_number: column.integer,
      batch_lot: column.text,
      provider: column.text,
      next_due_at: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const solid_foods = new Table(
    {
      ...eventColumns,
      food_name: column.text,
      is_first_time: column.integer, // 0 | 1
      amount_desc: column.text,
      reaction: column.text, // none | mild | strong
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  const milestones = new Table(
    {
      ...eventColumns,
      milestone_key: column.text,
      achieved_at: column.text,
      // References `photos.id` — the event's title image, always the
      // first photo of `milestone_photos` below
      // (features/events/logic.ts#planEventPhotoOrder).
      photo_id: column.text,
      // 2026-08-22: required title for the new "Ereignisse" tab
      // (features/events) — `milestone_key`/`achieved_at` predate that
      // feature and stay unused by it, see that feature's own doc comment.
      title: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  /* ────────────────────────────── Ereignisse — Fotos je Ereignis (2026-08-22) ────────────────────────────── */

  // Junction table: which photos belong to a "Ereignis" (milestones row)
  // and in what order. Unlike shares/share_photos, this DOES go through
  // PowerSync — an event and its photos are ordinary household data, not a
  // guest-facing table — so it needs REPLICA IDENTITY FULL like every other
  // synced table (CLAUDE.md Fallstrick 6; already set on the live table,
  // see the session report). No `household_id` of its own: the owning
  // milestone's `household_id` is what sync-rules.yaml filters on via a
  // JOIN, since this table has no household of its own to key on directly.
  const milestone_photos = new Table(
    {
      milestone_id: column.text,
      photo_id: column.text,
      sort_index: column.integer,
      added_at: column.text,
    },
    { indexes: { milestone: ['milestone_id'], photo: ['photo_id'] } },
  );

  const notes = new Table(
    {
      ...eventColumns,
      title: column.text,
    },
    { indexes: { child_time: ['child_id', 'occurred_at'] } },
  );

  /* ────────────────────────────── Fotos (§5.4) ────────────────────────────── */

  const photos = new Table(
    {
      ...eventColumns, // occurred_at = best-known capture time, see occurred_at_source
      source: column.text, // device_gallery | imported
      media_store_id: column.text, // Android MediaStore reference (unstable!)
      local_uri: column.text,
      content_hash: column.text, // SHA-256 of first 1 MB + file size
      captured_at: column.text, // from EXIF specifically, may be NULL
      // 2026-08-13: which fallback stage actually produced `occurred_at` —
      // exif | media_library | file_mtime | import_time | user_corrected.
      // A screenshot or messenger-saved image has no EXIF at all; before
      // this column existed, that silently fell back to "now", writing a
      // WRONG date into the chronology with nothing to show it was guessed.
      // See features/photos/media.ts#resolveOccurredAt for the fallback
      // chain and features/photos/identity.ts#isOccurredAtEstimated for
      // which of these count as "geschätzt" on screen.
      occurred_at_source: column.text,
      age_days: column.integer, // computed against children.birth_at
      width: column.integer,
      height: column.integer,
      mime: column.text,
      gps_lat: column.real, // ONLY on explicit opt-in — stripped before upload by default
      gps_lng: column.real,
      bytes: column.integer, // original file size, part of the dedupe identity
      // Storage keys in the private `photos` bucket. Path layout is
      // {household_id}/{photo_id}/… — the first segment is what the storage
      // access rules match on, so it must never change shape.
      thumb_key: column.text, // {household_id}/{photo_id}/thumb.webp
      thumb_uploaded_at: column.text,
      // 2026-08-13: a mid-size rendition for the fullscreen viewer, so it no
      // longer has to load the multi-MB original just to fill the screen.
      // NULL for every photo imported before this column existed — those
      // self-heal in the background (WLAN-only) the next time they're
      // opened, see features/photos/storage.ts#healMissingMedium.
      medium_key: column.text, // {household_id}/{photo_id}/medium.jpg
      medium_uploaded_at: column.text,
      original_key: column.text, // {household_id}/{photo_id}/orig.{ext}
      original_uploaded_at: column.text, // NULL = upload still pending
      availability: column.text, // available | missing
      tags: column.text, // JSON array, generated on-device
      ocr_text: column.text, // V2
      // 2026-08-15: user-entered caption, shown under the photo in the
      // fullscreen viewer (features/photos/identity.ts#normalizePhotoNote)
      // and already read by the guest-access viewer
      // (supabase/functions/album/index.ts) — that side existed first, this
      // column already existed in Postgres before the app could write to
      // it. `SELECT *` in sync-rules.yaml already syncs it down; this is
      // the local schema catching up so the column is actually queryable
      // here, no sync-rules or Postgres change needed.
      note: column.text,
    },
    {
      indexes: {
        child_day: ['child_id', 'local_date'],
        hash: ['content_hash'],
        // Drives the upload queue: "which photos still need pushing?"
        pending_upload: ['household_id', 'original_uploaded_at'],
      },
    },
  );

  /* ────────────────────────────── Foto-Sicherung aufs Gerät (2026-08-16) ────────────────────────────── */

  // `localOnly: true` — deliberately NEVER synced, unlike every other table
  // in this schema. "Alle Fotos sichern" (features/photos/storage.ts#
  // runPhotoBackup) copies originals into THIS device's own gallery album
  // — a fact that is only ever true for the specific phone that actually
  // wrote the file. A synced marker would tell the OTHER parent's phone
  // "already backed up" for files it never received, and that photo would
  // then silently never reach that phone's gallery on a later run. `id` is
  // the photo's own id — one row per backed-up photo on THIS device;
  // existence is the marker (see repository.ts#usePhotoBackupCandidatePhotos).
  // Being local-only also means none of CLAUDE.md's Fallstrick 6 applies:
  // there is no Postgres table to add `REPLICA IDENTITY FULL` to, nothing
  // to add to the `powersync` publication, no `sync-rules.yaml` line — this
  // table never leaves the device, so no migration was needed for it.
  const photo_backups = new Table(
    {
      backed_up_at: column.text,
    },
    { localOnly: true },
  );

  /* ────────────────────────────── Begleitende Menschen (2026-08-12) ────────────────────────────── */

  // New feature, not in the original Spec: people who accompanied the child
  // (Hebamme, Ärztin/Arzt, Familie, …). Not an `eventColumns` table — a
  // roster, not a timestamped occurrence — so it gets its own column list.
  const people = new Table(
    {
      household_id: column.text,
      child_id: column.text,
      name: column.text,
      role: column.text, // midwife | doctor | nurse | family | godparent | other
      note: column.text,
      // {household_id}/people/{person_id}.jpg in the existing `photos` bucket —
      // see features/people/identity.ts#buildPersonPhotoKey.
      photo_key: column.text,
      met_from: column.text, // ISO-8601 UTC, optional
      met_to: column.text, // ISO-8601 UTC, optional
      sort_index: column.integer,
      created_by: column.text,
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      source_device_id: column.text,
    },
    { indexes: { child_sort: ['child_id', 'sort_index'] } },
  );

  /* ────────────────────────────── Erinnerungen & Einstellungen (§5.5) ────────────────────────────── */

  const reminders = new Table({
    ...eventColumns,
    title: column.text,
    description: column.text,
    trigger_age_days: column.integer, // age-based …
    trigger_at: column.text, // … or absolute
    repeat_rule: column.text, // RRULE (RFC 5545)
    enabled: column.integer, // 0 | 1
    last_fired_at: column.text,
  });

  const user_preferences = new Table({
    user_id: column.text,
    unit_volume: column.text, // ml | oz
    unit_weight: column.text, // g | lb_oz
    unit_length: column.text, // cm | in
    unit_temp: column.text, // c | f
    theme: column.text, // system | light | dark | night
    dashboard_layout: column.text, // JSON
    updated_at: column.text,
  });

  /* ────────────────────────────── Schema ────────────────────────────── */

  return new Schema({
    households,
    household_members,
    children,
    feeds,
    sleeps,
    diapers,
    pumping_sessions,
    milk_stash,
    medications,
    growth_measurements,
    temperatures,
    vaccinations,
    solid_foods,
    milestones,
    milestone_photos,
    notes,
    photos,
    photo_backups,
    people,
    reminders,
    user_preferences,
  });
}

let appSchema: ReturnType<typeof buildAppSchema> | null = null;

/**
 * Returns the schema, building it on first call and reusing it afterwards.
 * See the module doc comment above for why this is a function, not a
 * module-level `const` like the original AppSchema was.
 */
export function getAppSchema(): ReturnType<typeof buildAppSchema> {
  if (!appSchema) {
    appSchema = buildAppSchema();
  }
  return appSchema;
}

/**
 * Row types for typed queries, e.g. `Database['feeds']`.
 * Every row additionally has the implicit `id: string`.
 */
export type Database = ReturnType<typeof getAppSchema>['types'];
