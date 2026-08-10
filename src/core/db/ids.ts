/**
 * core/db/ids — client-generated row identifiers (Master-Spec §5.1 note).
 *
 * PowerSync's implicit `id` column is TEXT; we fill it ourselves with UUIDv7
 * (time-ordered, unlike UUIDv4) so locally-created rows sort naturally and PUT
 * upserts to Supabase are idempotent — see core/sync/connector.ts.
 */

import { uuidv7 } from 'uuidv7';

export const newId = (): string => uuidv7();
