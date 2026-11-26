/**
 * media-sign — hands out short-lived SigV4 URLs for photo ORIGINALS in
 * Cloudflare R2 (bucket lifebook-originals, EU jurisdiction), after checking
 * who is asking. Prepared 2026-11-26; the app starts using it in PR 2.
 *
 * Request:  POST, Authorization: Bearer <user JWT>,
 *           body { photo_id, op: "get" | "put" | "delete", content_type?, bytes? }
 * Response: 200 { url, method, key, headers, expires_at }
 *           401 not signed in · 400 invalid input · 404 unknown photo ·
 *           403 no right for this op · 500 not configured / internal
 *
 * Every decision lives in ./handler.ts (pure, unit-tested); this file only
 * connects it to Supabase and the environment. It uses the service role ONLY
 * to read the photo row and the caller's membership — the household always
 * comes from the photo row, never from the request.
 *
 * Secrets (Deno.env only, never logged): R2_ENDPOINT, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_ORIGINALS. See docs/r2.md.
 * Logging rule: never log a token, a key, a signed URL or a request body.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.112.2';

import { handleMediaSign } from './handler.ts';
import type { Role, SignerConfig } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function readConfig(): SignerConfig | null {
  const endpoint = Deno.env.get('R2_ENDPOINT');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET_ORIGINALS');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json().catch(() => null);
    const result = await handleMediaSign(request.headers.get('Authorization'), body, {
      userIdForToken: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        return error ? null : (data.user?.id ?? null);
      },
      loadPhoto: async (photoId) => {
        const { data, error } = await admin
          .from('photos').select('id, household_id, mime').eq('id', photoId).maybeSingle();
        if (error) throw new Error('photo lookup failed');
        return data ?? null;
      },
      loadRole: async (userId, householdId) => {
        const { data, error } = await admin
          .from('household_members').select('role')
          .eq('user_id', userId).eq('household_id', householdId).is('deleted_at', null)
          .maybeSingle();
        if (error) throw new Error('membership lookup failed');
        return (data?.role as Role | undefined) ?? null;
      },
      config: readConfig(),
      now: () => new Date(),
    });
    return json(result.body, result.status);
  } catch (error) {
    // Only the error's own message — our messages above carry no secrets.
    console.error('[media-sign] internal error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'internal' }, 500);
  }
});
