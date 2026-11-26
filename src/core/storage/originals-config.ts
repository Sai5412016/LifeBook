/**
 * core/storage/originals-config — THE switch for where NEW photo originals go
 * (PR 2 of the R2 move, 2026-11-26).
 *
 * true  → new originals are uploaded to Cloudflare R2 (bucket
 *         lifebook-originals) through the Edge Function `media-sign`, and the
 *         row gets `original_store = 'r2'` once the stored size is confirmed.
 * false → new originals go to the Supabase bucket `photos`, exactly as before
 *         PR 2. Flip this and ship a Funkupdate to fall back without a build.
 *
 * Only the UPLOAD of new originals reads this. Reading always follows the
 * row's own `photos.original_store` (features/photos/original-store.ts), so
 * switching back to Supabase never makes an original that is already in R2
 * unreachable.
 */
export const ORIGINALS_TO_R2 = true;
