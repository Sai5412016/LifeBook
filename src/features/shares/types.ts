/**
 * shares/types — the guest-access tables. These live in Postgres ONLY, read
 * and written directly via supabase-js, never through PowerSync (see
 * repository.ts's own doc comment for why). Field names and types mirror
 * the live schema exactly (verified against the database, not assumed —
 * see the session report).
 */

/** One row of `public.shares`. */
export type ShareRow = {
  id: string;
  household_id: string;
  name: string;
  /** The random, URL-safe secret in the link — see logic.ts#generateShareToken. */
  token: string;
  /** The 6-character human-readable code — see logic.ts#generateAccessCode. */
  access_code: string;
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
};

/** A share plus the counts the overview list needs — computed by the repository, not stored. */
export type ShareSummary = ShareRow & {
  photoCount: number;
  deviceCount: number;
};
