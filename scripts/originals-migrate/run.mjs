/**
 * originals-migrate/run — the device half of the Phase-A migration
 * (Supabase Storage → Cloudflare R2). Runs ONLY in the GitHub workflow
 * .github/workflows/originals-migrate.yml; every decision lives in
 * ./migrate.mjs (tested). Node ≥ 20 built-ins only (fetch, crypto, fs,
 * child_process) plus the aws CLI that GitHub's Ubuntu runner ships with —
 * no npm package, nothing added to the app.
 *
 * Environment (all from GitHub secrets / workflow inputs):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — read photos, download originals,
 *                                              conditional UPDATE of original_store
 *   R2_ENDPOINT, R2_BUCKET_ORIGINALS,
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — aws s3api against R2
 *   DRY_RUN ("true"/"false"), LIMIT (0 = all)
 *
 * WRITES, and only when DRY_RUN is "false": `aws s3api put-object` (R2) and
 * one PATCH per photo on /rest/v1/photos. NOTHING is ever deleted.
 *
 * LOGGING: never a key, a URL, a token or aws stderr verbatim — errors go
 * through migrate.mjs#safeMessage, photo ids are shortened.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findDiscrepancies, formatSummary, runMigration } from './migrate.mjs';

const exec = promisify(execFile);

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`::error::Umgebungsvariable ${name} fehlt`);
    process.exit(1);
  }
  return value;
};

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const R2_ENDPOINT = env('R2_ENDPOINT');
const BUCKET = env('R2_BUCKET_ORIGINALS');
env('AWS_ACCESS_KEY_ID');
env('AWS_SECRET_ACCESS_KEY');
const DRY_RUN = (process.env.DRY_RUN ?? 'true') !== 'false'; // anything but an explicit "false" is a dry run
const LIMIT = Number.parseInt(process.env.LIMIT ?? '20', 10);
if (!Number.isInteger(LIMIT) || LIMIT < 0) {
  console.error('::error::limit muss eine ganze Zahl ≥ 0 sein (0 = alle)');
  process.exit(1);
}

// The classic service_role key is a JWT and goes in both headers. A new-style
// secret key (sb_secret_…) is not a JWT: the gateway takes it from `apikey`
// alone, and a Bearer header carrying it would be rejected as a bad JWT.
const restHeaders = SERVICE_KEY.startsWith('sb_')
  ? { apikey: SERVICE_KEY }
  : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/** Every photos row the migration and the consistency report need, paged (PostgREST caps a response). */
async function loadPhotoRows() {
  const columns = 'id,original_key,original_store,mime,bytes,deleted_at,original_uploaded_at,created_at';
  const rows = [];
  const page = 500;
  for (let offset = 0; ; offset += page) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?select=${columns}&order=created_at.asc,id.asc&limit=${page}&offset=${offset}`,
      { headers: restHeaders },
    );
    if (!response.ok) throw new Error(`photos lesen: HTTP ${response.status}`);
    const chunk = await response.json();
    rows.push(...chunk);
    if (chunk.length < page) return rows;
  }
}

let workDir = null;

/** Streams one original from Supabase Storage to a temp file, hashing on the way. */
async function download(key) {
  workDir ??= await mkdtemp(join(tmpdir(), 'originals-'));
  const path = join(workDir, 'current');
  const url = `${SUPABASE_URL}/storage/v1/object/authenticated/photos/${key.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { headers: restHeaders });
  if (!response.ok || !response.body) throw new Error(`Download aus Supabase: HTTP ${response.status}`);
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      md5.update(chunk);
      sha256.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), hashing, createWriteStream(path));
  const { size } = await stat(path);
  const contentLength = response.headers.get('content-length');
  return {
    path,
    bytes: size,
    md5Hex: md5.digest('hex'),
    sha256Hex: sha256.digest('hex'),
    contentLength: contentLength === null ? null : Number(contentLength),
  };
}

async function aws(args) {
  return exec('aws', [...args, '--endpoint-url', R2_ENDPOINT, '--output', 'json'], {
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** HEAD on R2: null when the object does not exist; throws on anything else. */
async function head(key) {
  try {
    const { stdout } = await aws(['s3api', 'head-object', '--bucket', BUCKET, '--key', key]);
    const json = JSON.parse(stdout);
    return { size: Number(json.ContentLength), etag: json.ETag };
  } catch (error) {
    const stderr = String(error?.stderr ?? '');
    if (/\(404\)|Not Found|NoSuchKey/.test(stderr)) return null;
    throw new Error(`R2 HEAD fehlgeschlagen${/\(403\)|Forbidden/.test(stderr) ? ' (403)' : ''}`);
  }
}

/**
 * Single-part PUT with Content-MD5: R2 itself rejects a body whose MD5
 * differs (BadDigest), and a single-part object's ETag is its MD5 — which
 * is what migrate.mjs#r2MatchesSource checks afterwards. (`aws s3 cp` would
 * switch to multipart above 8 MB, whose ETag is NOT the MD5.)
 */
async function put(key, path, contentType, md5Base64) {
  if (DRY_RUN) throw new Error('Schreibversuch im Testlauf – abgebrochen'); // second line of defence
  try {
    await aws([
      's3api', 'put-object', '--bucket', BUCKET, '--key', key, '--body', path,
      '--content-type', contentType, '--content-md5', md5Base64,
    ]);
  } catch (error) {
    const stderr = String(error?.stderr ?? '');
    const code = /\((\w+)\)/.exec(stderr)?.[1] ?? 'unbekannt';
    throw new Error(`R2 PUT fehlgeschlagen (${code})`);
  }
}

/**
 * The conditional switch. `original_store=eq.supabase` in the filter makes
 * it `UPDATE … WHERE id = … AND original_store = 'supabase'`; only that one
 * column is sent, `updated_at` is not touched (photos has no updated_at
 * trigger — checked 26.11.2026, the only trigger is
 * photos_original_store_not_null). The change reaches the phones through
 * PowerSync's logical replication (publication `powersync` covers schema
 * public, photos has REPLICA IDENTITY FULL — checked 26.11.2026).
 * Returns how many rows changed (0 or 1).
 */
async function switchStore(id) {
  if (DRY_RUN) throw new Error('Schreibversuch im Testlauf – abgebrochen');
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/photos?id=eq.${encodeURIComponent(id)}&original_store=eq.supabase&select=id`,
    {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ original_store: 'r2' }),
    },
  );
  if (!response.ok) throw new Error(`Umstellen in photos: HTTP ${response.status}`);
  const changed = await response.json();
  return Array.isArray(changed) ? changed.length : 0;
}

async function cleanup(path) {
  await rm(path, { force: true });
}

/** Every object in the originals bucket (key + size) — read only. */
async function listR2Objects() {
  const { stdout } = await aws([
    's3api', 'list-objects-v2', '--bucket', BUCKET, '--query', 'Contents[].{key: Key, size: Size}',
  ]);
  const parsed = JSON.parse(stdout || 'null');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeSummary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
}

async function main() {
  console.log(`Modus: ${DRY_RUN ? 'Testlauf (dry_run)' : 'ECHTER LAUF'}, limit ${LIMIT > 0 ? LIMIT : 'alle'}`);
  const rows = await loadPhotoRows();
  const summary = await runMigration(
    rows,
    {
      dryRun: DRY_RUN,
      limit: LIMIT,
      onProgress: (state) => console.log(`… ${state.checked} geprüft, ${state.errors.length} Fehler`),
    },
    { download, head, put, switchStore, cleanup },
  );

  let discrepancies = null;
  try {
    discrepancies = findDiscrepancies(await listR2Objects(), await loadPhotoRows());
  } catch (error) {
    console.error('::warning::Abgleich R2 ↔ photos nicht möglich');
  }

  await writeSummary(formatSummary(summary, discrepancies));
  if (workDir) await rm(workDir, { recursive: true, force: true });
  // Red run when anything failed, so GitHub's e-mail says so; every
  // successful photo before and after a failure is already done.
  if (summary.errors.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`::error::Lauf abgebrochen: ${String(error?.message ?? error).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200)}`);
  if (workDir) await rm(workDir, { recursive: true, force: true });
  process.exit(1);
});
