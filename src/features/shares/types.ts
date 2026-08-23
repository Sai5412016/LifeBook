/**
 * shares/types — the guest-access tables. These live in Postgres ONLY, read
 * and written directly via supabase-js, never through PowerSync (see
 * repository.ts's own doc comment for why). Field names and types mirror
 * the live schema exactly (verified against the database, not assumed —
 * see the session report).
 */

/** What a share hands a guest: the household's photo selection, or the whole family tree. */
export type ShareKind = 'photos' | 'tree';

/** One row of `public.shares`. */
export type ShareRow = {
  id: string;
  household_id: string;
  name: string;
  /** The random, URL-safe secret in the link — see logic.ts#generateShareToken. */
  token: string;
  /** The 6-character human-readable code — see logic.ts#generateAccessCode. */
  access_code: string;
  kind: ShareKind;
  /**
   * Only meaningful for `kind: 'tree'` — whether a guest also sees photos
   * and birth dates of LIVING relatives, not just deceased ones. Default
   * `false`: a tree share is safe to send by default, showing living
   * people's names only (see logic.ts#SHOW_LIVING_DETAILS_HINT_TEXT for the
   * exact wording shown next to the switch that sets this).
   */
  show_living_details: boolean;
  /**
   * Only meaningful for `kind: 'tree'` — whether a guest sees the "Ergänzung
   * vorschlagen" action at all in the viewer. Default `true`: proposals are
   * always reviewed by a household member before anything changes (see
   * features/tree/repository.ts's accept/reject functions), so leaving this
   * on by default costs nothing a caregiver didn't already control.
   */
  allow_suggestions: boolean;
  /**
   * A short message for guests, shown as a dismissible banner on the
   * shared page until they tap it away (2026-08-24) — the only channel
   * that reaches a guest, since they have no app and therefore no push
   * notifications. NULL = no active message. Set together with
   * `announcement_at` in the same write, always (see
   * repository.ts#publishShareAnnouncement/removeShareAnnouncement) — the
   * viewer decides whether to show the banner by comparing
   * `announcement_at` against the device's own last-visit time, so the two
   * columns must never disagree about whether a message is "on".
   */
  announcement: string | null;
  announcement_at: string | null;
  device_limit: number;
  allow_download: boolean;
  /** NULL = unbegrenzt. */
  expires_at: string | null;
  /** NULL = active. Set, not deleted, so a revoked share stays visible — see repository.ts#revokeShare. */
  revoked_at: string | null;
  failed_code_attempts: number;
  locked_until: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** One row of `public.share_devices` — a phone/browser that redeemed the access code. */
export type ShareDeviceRow = {
  id: string;
  share_id: string;
  device_secret: string;
  label: string | null;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string;
  /**
   * Einmalig von der Edge Function `album` aus Vercels Standort-Kopfzeilen
   * gefüllt, beim Einlösen des Zugangscodes — keine IP wird gespeichert.
   * NULL bei den zehn Geräten von vor dieser Spalte (Altbestand, kein
   * Fehler) und bei jedem Aufruf, den Vercel nicht lokalisieren konnte.
   */
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  /**
   * Vorname, den der Gast beim Einlösen des Codes eingegeben hat — von der
   * (noch nicht in dieser Sitzung gebauten) Viewer-Funktion gefüllt, aus
   * der App heraus nie geschrieben. NULL bei jedem Foto-Album-Zugriff, für
   * den kein Name abgefragt wird, und bei jedem älteren Gerät von vor
   * dieser Spalte.
   */
  visitor_name: string | null;
};

/** A share plus the counts the overview list needs — computed by the repository, not stored. */
export type ShareSummary = ShareRow & {
  photoCount: number;
  deviceCount: number;
};
