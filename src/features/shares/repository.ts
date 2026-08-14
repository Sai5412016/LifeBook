/**
 * shares/repository — ALL database access for guest-access sharing (Spec
 * Architekturregel 1: feature code never touches the database directly).
 *
 * `shares` / `share_photos` / `share_devices` do NOT go through PowerSync —
 * they are read and written straight against Supabase via `supabase-js`,
 * the same pattern `core/notifications/index.ts` already uses for
 * `push_tokens`. Two reasons this table set stays outside PowerSync
 * entirely, not just "not synced yet":
 *
 * 1. A share's whole point is to be reachable by a device that was never
 *    part of the household's PowerSync sync — a guest's phone or browser,
 *    with no LifeBook install and no household membership. PowerSync
 *    buckets are scoped to household membership; a guest could never be
 *    given a bucket to read in the first place.
 * 2. Creating a share requires a live round trip regardless (the random
 *    token/code must be unique on the server side, and Stufe 2's viewing
 *    page reads this table directly, outside the app entirely) — so there
 *    is no offline case to preserve here the way there is for, say, a
 *    diaper change logged on a train. A link is meaningless without
 *    network anyway (see createShare's own doc comment).
 *
 * WRITE STYLE — NO `.upsert()`, NO UNNECESSARY `.select()`
 * -----------------------------------------------------------
 * CLAUDE.md Fallstrick 1: `.upsert()` always compiles to `ON CONFLICT`,
 * and appending `.select()`/`RETURNING` to a write forces Postgres to also
 * evaluate the READ policy — which failed for a household's very first row
 * in `households` before any membership existed. Verified against THIS
 * feature's actual policies before writing a line of code here (see the
 * session report for the exact queries): the `shares`/`share_photos`/
 * `share_devices` read policies are gated on ordinary household
 * membership, which already exists days before anyone creates a first
 * share, so the bootstrap trap does not actually apply here. The plain
 * INSERT/no-`.select()` style is kept anyway — every row this module
 * writes is fully known client-side already (the id is generated locally,
 * see `newId()`), so there is nothing a `.select()` would tell us that we
 * don't already have, and never reaching for it means never having to
 * re-derive this reasoning later.
 *
 * `share_devices` has no INSERT policy for `authenticated` at all — a
 * device is registered by the (not yet built) Stufe-2 viewing function,
 * not from inside the app. This module only ever lists and deletes rows
 * in that table, never inserts one.
 */

import * as Crypto from 'expo-crypto';

import { newId } from '@/core/db/ids';
import { supabase } from '@/core/supabase';
import { nowUtcIso } from '@/core/time';

import {
  describeSupabaseError,
  diffPhotoSelection,
  generateAccessCode,
  generateShareToken,
  summarizeShares,
} from './logic';
import type { ShareDeviceRow, ShareRow, ShareSummary } from './types';

/** Generous relative to the 32-byte floor `generateShareToken` requires — no margin concerns. */
const TOKEN_RANDOM_BYTES = 32;
/**
 * Comfortably more than `generateAccessCode` will ever need: rejection
 * sampling (see logic.ts) discards roughly 7% of bytes, so drawing 6
 * accepted characters from 32 bytes fails only if an implausible run of
 * rejects occurs — astronomically unlikely, but 32 (not the bare minimum)
 * costs nothing and keeps `generateAccessCode`'s "ran out of bytes" error
 * a theoretical safeguard rather than something a real user could hit.
 */
const ACCESS_CODE_RANDOM_BYTES = 32;

export type CreateShareInput = {
  householdId: string;
  userId: string;
  name: string;
  deviceLimit: number;
  photoIds: readonly string[];
};

/**
 * Creates a share, its random token/access code, and its initial photo
 * selection. Requires a network round trip — there is no offline path,
 * because a link that doesn't exist on the server yet cannot be shared or
 * later resolved by a guest (see the module doc comment). Callers MUST
 * surface a thrown error to the user rather than retrying silently, so an
 * offline attempt reads as "geht gerade nicht" instead of quietly doing
 * nothing.
 */
export async function createShare(input: CreateShareInput): Promise<ShareRow> {
  const id = newId();
  const token = generateShareToken(Crypto.getRandomBytes(TOKEN_RANDOM_BYTES));
  const accessCode = generateAccessCode(Crypto.getRandomBytes(ACCESS_CODE_RANDOM_BYTES));
  const now = nowUtcIso();

  const row: ShareRow = {
    id,
    household_id: input.householdId,
    name: input.name,
    token,
    access_code: accessCode,
    device_limit: input.deviceLimit,
    allow_download: true,
    expires_at: null,
    revoked_at: null,
    failed_code_attempts: 0,
    locked_until: null,
    view_count: 0,
    last_viewed_at: null,
    created_by: input.userId,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from('shares').insert(row);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }

  if (input.photoIds.length > 0) {
    await addPhotosToShare(id, input.photoIds);
  }

  return row;
}

/** Every share of a household, newest first — the overview screen's list, without per-share counts. */
export async function listShares(householdId: string): Promise<ShareRow[]> {
  const { data, error } = await supabase
    .from('shares')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return data ?? [];
}

/** The raw `{ share_id }` rows for every share in `shareIds`, for `logic.ts#summarizeShares` to count in JS (not a SQL aggregate — see that function's own doc comment for why). */
export async function listSharePhotoCountRows(shareIds: readonly string[]): Promise<{ share_id: string }[]> {
  if (shareIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from('share_photos').select('share_id').in('share_id', shareIds);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return data ?? [];
}

/** Same as `listSharePhotoCountRows`, for `share_devices`. */
export async function listShareDeviceCountRows(shareIds: readonly string[]): Promise<{ share_id: string }[]> {
  if (shareIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from('share_devices').select('share_id').in('share_id', shareIds);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return data ?? [];
}

/**
 * The overview screen's actual data: every share of a household plus its
 * photo/device counts, in three round trips total (one per table) rather
 * than N+1 — see `listShares`/`listSharePhotoCountRows`/
 * `listShareDeviceCountRows` for each half of this composition.
 */
export async function listShareSummaries(householdId: string): Promise<ShareSummary[]> {
  const shares = await listShares(householdId);
  const shareIds = shares.map((share) => share.id);
  const [photoRows, deviceRows] = await Promise.all([
    listSharePhotoCountRows(shareIds),
    listShareDeviceCountRows(shareIds),
  ]);
  return summarizeShares(shares, photoRows, deviceRows);
}

/** One share by id, for the detail screen. Null if it doesn't exist (or isn't visible under this household's read policy). */
export async function getShare(shareId: string): Promise<ShareRow | null> {
  const { data, error } = await supabase.from('shares').select('*').eq('id', shareId).maybeSingle();
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return data;
}

export async function renameShare(shareId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('shares')
    .update({ name, updated_at: nowUtcIso() })
    .eq('id', shareId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

export async function setShareDeviceLimit(shareId: string, deviceLimit: number): Promise<void> {
  const { error } = await supabase
    .from('shares')
    .update({ device_limit: deviceLimit, updated_at: nowUtcIso() })
    .eq('id', shareId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

/** Sets `revoked_at`, nothing else — the share stays in the list (see types.ts#ShareRow's doc comment on the field). */
export async function revokeShare(shareId: string): Promise<void> {
  const now = nowUtcIso();
  const { error } = await supabase
    .from('shares')
    .update({ revoked_at: now, updated_at: now })
    .eq('id', shareId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

/**
 * Permanently removes the share. `share_photos` and `share_devices` rows
 * are `ON DELETE CASCADE` on `share_id` (verified against the live schema
 * — see the session report), so this single statement is the entire
 * operation; no manual cleanup of the child tables is needed.
 */
export async function deleteShare(shareId: string): Promise<void> {
  const { error } = await supabase.from('shares').delete().eq('id', shareId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

export async function listSharePhotoIds(shareId: string): Promise<string[]> {
  const { data, error } = await supabase.from('share_photos').select('photo_id').eq('share_id', shareId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return (data ?? []).map((row) => row.photo_id);
}

export async function addPhotosToShare(shareId: string, photoIds: readonly string[]): Promise<void> {
  if (photoIds.length === 0) {
    return;
  }
  const now = nowUtcIso();
  const { error } = await supabase
    .from('share_photos')
    .insert(photoIds.map((photoId) => ({ share_id: shareId, photo_id: photoId, added_at: now })));
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

export async function removePhotosFromShare(shareId: string, photoIds: readonly string[]): Promise<void> {
  if (photoIds.length === 0) {
    return;
  }
  const { error } = await supabase
    .from('share_photos')
    .delete()
    .eq('share_id', shareId)
    .in('photo_id', photoIds);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}

/**
 * Turns `currentIds` into `nextIds` with the minimal add/remove calls —
 * the editable-photo-selection screen's save step. The set-difference
 * itself is `logic.ts#diffPhotoSelection`, kept pure and tested there;
 * this only carries out whatever it decided.
 */
export async function updateSharePhotoSelection(
  shareId: string,
  currentIds: readonly string[],
  nextIds: readonly string[],
): Promise<void> {
  const { toAdd, toRemove } = diffPhotoSelection(currentIds, nextIds);
  if (toRemove.length > 0) {
    await removePhotosFromShare(shareId, toRemove);
  }
  if (toAdd.length > 0) {
    await addPhotosToShare(shareId, toAdd);
  }
}

/** Every device that has redeemed this share's access code, most recently active first. */
export async function listShareDevices(shareId: string): Promise<ShareDeviceRow[]> {
  const { data, error } = await supabase
    .from('share_devices')
    .select('*')
    .eq('share_id', shareId)
    .order('last_seen_at', { ascending: false });
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
  return data ?? [];
}

/**
 * Removes one device's access, freeing a slot against `device_limit`.
 * `share_devices` has no INSERT policy for the app (see the module doc
 * comment) — this DELETE (and the SELECT above) are the only operations
 * this app is meant to run against that table.
 */
export async function removeShareDevice(deviceId: string): Promise<void> {
  const { error } = await supabase.from('share_devices').delete().eq('id', deviceId);
  if (error) {
    throw new Error(describeSupabaseError(error));
  }
}
