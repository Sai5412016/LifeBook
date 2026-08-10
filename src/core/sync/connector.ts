/**
 * core/sync/connector — SupabaseConnector (Master-Spec §6).
 *
 * Bridges PowerSync <-> Supabase:
 * - fetchCredentials: hands PowerSync the current Supabase JWT + the PowerSync
 *   endpoint. Returns null when the user is not signed in (PowerSync stays
 *   disconnected; the app still works fully offline on the local encrypted DB).
 * - uploadData: replays the local write queue (CRUD) to Supabase. Because row ids
 *   are client-generated (UUIDv7), PUT is an idempotent upsert — safe to retry.
 *
 * Any thrown error makes PowerSync retry the whole transaction after its wait
 * period, so we throw on the first failing operation and DON'T call tx.complete().
 */

import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';

import { ENV } from '../env';
import { supabase } from '../supabase';

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }
    if (!session) {
      return null; // not signed in → do not connect
    }

    return {
      endpoint: ENV.POWERSYNC_URL,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    for (const op of transaction.crud) {
      const table = supabase.from(op.table);
      let result;

      switch (op.op) {
        case UpdateType.PUT:
          // INSERT — deliberately NOT upsert(). Verified against the live DB as
          // the `authenticated` role (2026-08-09):
          //   INSERT (plain)                  → OK
          //   INSERT .. ON CONFLICT DO UPDATE → 42501 RLS violation
          //   INSERT .. ON CONFLICT DO NOTHING→ 42501 RLS violation
          // Any ON CONFLICT clause makes Postgres consult the SELECT policy to
          // look up the conflicting row. For the FIRST household that policy
          // can't pass yet — it requires a household_members row that is only
          // created by the very next operation (chicken-and-egg at bootstrap).
          // supabase-js upsert() always emits ON CONFLICT, so it can never
          // create the first household. Plain insert has no such requirement.
          //
          // Also no .select() chained: that would add RETURNING, which hits the
          // same SELECT policy (verified: 42501).
          result = await table.insert({ id: op.id, ...op.opData });
          // Idempotent retry: PowerSync replays the WHOLE transaction after a
          // failure, so rows inserted by an earlier partially-successful attempt
          // come back as 23505 (unique violation). That means "already applied",
          // not an error — swallow it so the queue can drain instead of
          // deadlocking. Genuine edits arrive separately as PATCH.
          if (result.error?.code === '23505') {
            result = { ...result, error: null };
          }
          break;
        case UpdateType.PATCH:
          result = await table.update(op.opData ?? {}).eq('id', op.id);
          break;
        case UpdateType.DELETE:
          result = await table.delete().eq('id', op.id);
          break;
      }

      if (result?.error) {
        const { message, code, details, hint } = result.error;
        // Loud, structured log: the thrown Error alone gets truncated in the
        // PowerSync retry log, and the Postgres code/details are what actually
        // identify the cause (e.g. 42501 = RLS rejection).
        console.error('[LifeBook] Supabase upload rejected', {
          op: op.op,
          table: op.table,
          id: op.id,
          columns: Object.keys(op.opData ?? {}),
          code,
          message,
          details,
          hint,
        });
        // Throw → PowerSync retries this transaction later. tx stays uncompleted.
        throw new Error(
          `Upload failed (${op.op} on ${op.table} #${op.id}) [${code ?? 'no-code'}]: ${message}`,
        );
      }
    }

    await transaction.complete();
  }
}
