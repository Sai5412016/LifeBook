import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  findDiscrepancies,
  formatSummary,
  isSafeKey,
  md5HexToBase64,
  migratePhoto,
  normalizeEtag,
  r2MatchesSource,
  runMigration,
  safeMessage,
  selectCandidates,
  sourceSizeProblem,
} from './migrate.mjs';

const HH = '019fe2a1-0c5f-799a-a45a-2f0be423178a';
const content = 'original-bytes-of-a-photo';
const MD5 = createHash('md5').update(content).digest('hex');
const SHA = createHash('sha256').update(content).digest('hex');
const SIZE = content.length;

const row = (n, extra = {}) => ({
  id: `0000000${n}-aaaa-7000-8000-00000000000${n}`,
  original_key: `${HH}/0000000${n}-aaaa-7000-8000-00000000000${n}/orig.jpg`,
  original_store: 'supabase',
  mime: 'image/jpeg',
  bytes: SIZE,
  deleted_at: null,
  original_uploaded_at: '2026-10-01T10:00:00Z',
  created_at: `2026-10-0${n}T10:00:00Z`,
  ...extra,
});

/**
 * Fake storage world: `supabase` holds sources, `r2` holds objects. Every
 * call is recorded; writes are marked so a dry run can be proven write-free.
 */
function world({ r2 = {}, rowsInDb, overrides = {} } = {}) {
  const calls = [];
  const writes = [];
  const objects = { ...r2 };
  const db = new Map((rowsInDb ?? []).map((r) => [r.id, { ...r }]));
  const deps = {
    download: async (key) => {
      calls.push(['download', key]);
      return { path: `/tmp/${key.split('/')[1]}`, bytes: SIZE, md5Hex: MD5, sha256Hex: SHA, contentLength: SIZE };
    },
    head: async (key) => {
      calls.push(['head', key]);
      return objects[key] ?? null;
    },
    put: async (key, path, contentType, md5Base64) => {
      calls.push(['put', key, contentType, md5Base64]);
      writes.push(['put', key]);
      objects[key] = { size: SIZE, etag: `"${MD5}"` };
    },
    switchStore: async (id) => {
      calls.push(['switchStore', id]);
      writes.push(['switchStore', id]);
      const current = db.get(id);
      // UPDATE … WHERE id = $1 AND original_store = 'supabase'
      if (current && current.original_store === 'supabase') {
        current.original_store = 'r2';
        return 1;
      }
      return 0;
    },
    cleanup: async (path) => {
      calls.push(['cleanup', path]);
    },
    ...overrides,
  };
  return { deps, calls, writes, objects, db };
}

describe('selection', () => {
  it('only alive, uploaded, supabase rows with a valid key; oldest first; limit', () => {
    const rows = [
      row(3),
      row(1),
      row(2, { original_store: 'r2' }),
      row(4, { deleted_at: '2026-11-01T00:00:00Z' }),
      row(5, { original_uploaded_at: null }),
      row(6, { original_key: '../evil/orig.jpg' }),
      row(7),
    ];
    expect(selectCandidates(rows, 0).map((r) => r.id.slice(0, 8))).toEqual(['00000001', '00000003', '00000007']);
    expect(selectCandidates(rows, 2).map((r) => r.id.slice(0, 8))).toEqual(['00000001', '00000003']);
  });

  it('key scheme <household>/<photo>/orig.<ext>, nothing else', () => {
    expect(isSafeKey(`${HH}/abc/orig.jpg`)).toBe(true);
    expect(isSafeKey(`${HH}/abc/orig.png`)).toBe(true);
    expect(isSafeKey(`${HH}/abc/medium.jpg`)).toBe(false);
    expect(isSafeKey(`${HH}/../orig.jpg`)).toBe(false);
    expect(isSafeKey(null)).toBe(false);
  });
});

describe('check: size AND ETag = MD5', () => {
  const source = { bytes: SIZE, md5Hex: MD5 };
  it('matches only with both equal', () => {
    expect(r2MatchesSource({ size: SIZE, etag: `"${MD5}"` }, source)).toBe(true);
    expect(r2MatchesSource({ size: SIZE, etag: `"${MD5.toUpperCase()}"` }, source)).toBe(true);
    expect(r2MatchesSource({ size: SIZE + 1, etag: `"${MD5}"` }, source)).toBe(false);
    expect(r2MatchesSource({ size: SIZE, etag: '"d41d8cd98f00b204e9800998ecf8427e"' }, source)).toBe(false);
    // multipart ETag ("…-2") is never equal to an MD5
    expect(r2MatchesSource({ size: SIZE, etag: `"${MD5}-2"` }, source)).toBe(false);
    expect(r2MatchesSource(null, source)).toBe(false);
  });

  it('source size against Storage Content-Length and photos.bytes', () => {
    expect(sourceSizeProblem({ bytes: SIZE, contentLength: SIZE }, SIZE)).toBeNull();
    expect(sourceSizeProblem({ bytes: SIZE, contentLength: null }, SIZE)).toBeNull();
    expect(sourceSizeProblem({ bytes: SIZE - 1, contentLength: SIZE }, SIZE)).toMatch(/unvollständig/);
    expect(sourceSizeProblem({ bytes: SIZE, contentLength: SIZE }, SIZE + 5)).toMatch(/photos\.bytes/);
    expect(sourceSizeProblem({ bytes: 0, contentLength: 0 }, null)).toMatch(/leer/);
  });

  it('Content-MD5 is the base64 of the MD5', () => {
    expect(md5HexToBase64(MD5)).toBe(createHash('md5').update(content).digest('base64'));
    expect(normalizeEtag('"ABC"')).toBe('abc');
  });
});

describe('one photo, real run', () => {
  it('copies, verifies by HEAD, then switches conditionally; content type from mime', async () => {
    const r = row(1, { mime: 'IMAGE/PNG', original_key: `${HH}/00000001-aaaa-7000-8000-000000000001/orig.png` });
    const { deps, calls, db } = world({ rowsInDb: [r] });
    const result = await migratePhoto(r, { dryRun: false }, deps);
    expect(result).toEqual({ copy: 'copied', switched: 'switched', bytes: SIZE, sha256: SHA });
    expect(calls.map((c) => c[0])).toEqual(['download', 'head', 'put', 'head', 'switchStore', 'cleanup']);
    expect(calls[2]).toEqual(['put', r.original_key, 'image/png', md5HexToBase64(MD5)]);
    expect(db.get(r.id).original_store).toBe('r2');
  });

  it('idempotent: object already in R2 with same size and MD5 → no PUT, still switched', async () => {
    const r = row(1);
    const { deps, calls } = world({ rowsInDb: [r], r2: { [r.original_key]: { size: SIZE, etag: `"${MD5}"` } } });
    const result = await migratePhoto(r, { dryRun: false }, deps);
    expect(result.copy).toBe('skipped');
    expect(result.switched).toBe('switched');
    expect(calls.some((c) => c[0] === 'put')).toBe(false);
  });

  it('an existing object with a different MD5 is overwritten (never trusted)', async () => {
    const r = row(1);
    const { deps, calls } = world({ rowsInDb: [r], r2: { [r.original_key]: { size: SIZE, etag: '"0000"' } } });
    await expect(migratePhoto(r, { dryRun: false }, deps)).resolves.toMatchObject({ copy: 'copied' });
    expect(calls.filter((c) => c[0] === 'put')).toHaveLength(1);
  });

  it('second run after a successful one changes nothing (row no longer a candidate)', async () => {
    const rows = [row(1), row(2)];
    const w = world({ rowsInDb: rows });
    await runMigration(rows, { dryRun: false, limit: 0 }, w.deps);
    const after = rows.map((r) => ({ ...r, original_store: w.db.get(r.id).original_store }));
    const before = w.writes.length;
    const second = await runMigration(after, { dryRun: false, limit: 0 }, w.deps);
    expect(second.checked).toBe(0);
    expect(w.writes.length).toBe(before);
  });
});

describe('conditional update', () => {
  it('row changed meanwhile (already r2 or gone) → 0 rows → error, nothing overwritten', async () => {
    const r = row(1);
    const { deps, db } = world({ rowsInDb: [{ ...r, original_store: 'r2' }] });
    await expect(migratePhoto(r, { dryRun: false }, deps)).rejects.toThrow(/nicht umgestellt/);
    expect(db.get(r.id).original_store).toBe('r2');

    const gone = world({ rowsInDb: [] });
    await expect(migratePhoto(r, { dryRun: false }, gone.deps)).rejects.toThrow(/nicht umgestellt/);
  });
});

describe('error path: photo stays supabase, run goes on', () => {
  const cases = [
    ['download fails', { download: async () => { throw new Error('Download aus Supabase: HTTP 500'); } }],
    ['size differs from photos.bytes', { download: async () => ({ path: '/tmp/x', bytes: SIZE - 3, md5Hex: MD5, sha256Hex: SHA, contentLength: SIZE - 3 }) }],
    ['PUT refused', { put: async () => { throw new Error('R2 PUT fehlgeschlagen (BadDigest)'); } }],
    ['HEAD after PUT: wrong ETag', { put: async () => {}, head: async () => null }],
    ['HEAD refused (403)', { head: async () => { throw new Error('R2 HEAD fehlgeschlagen (403)'); } }],
  ];
  for (const [label, overrides] of cases) {
    it(`${label}: no switch, error recorded, next photo still migrated`, async () => {
      const rows = [row(1), row(2)];
      const w = world({ rowsInDb: rows });
      let first = true;
      const wrapped = {};
      for (const [name, fn] of Object.entries(overrides)) {
        wrapped[name] = async (...args) => {
          if (first) return fn(...args);
          return w.deps[name](...args);
        };
      }
      const deps = { ...w.deps, ...wrapped, switchStore: async (id) => { first = false; return w.deps.switchStore(id); } };
      // The first photo fails before switchStore; flip to normal behaviour once photo 2 starts.
      const realDownload = deps.download;
      let started = 0;
      deps.download = async (key) => {
        started += 1;
        if (started === 2) first = false;
        return realDownload(key);
      };
      const summary = await runMigration(rows, { dryRun: false, limit: 0 }, deps);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].photo).toBe('00000001');
      expect(w.db.get(rows[0].id).original_store).toBe('supabase');
      expect(w.db.get(rows[1].id).original_store).toBe('r2');
      expect(summary.switched).toBe(1);
      expect(summary.remainingAfter).toBe(1);
    });
  }

  it('a source whose size differs from photos.bytes stops BEFORE anything touches R2', async () => {
    const r = row(1, { bytes: SIZE + 5 });
    const w = world({ rowsInDb: [r] });
    await expect(migratePhoto(r, { dryRun: false }, w.deps)).rejects.toThrow(/photos\.bytes/);
    expect(w.calls.map((c) => c[0])).toEqual(['download', 'cleanup']);
    expect(w.db.get(r.id).original_store).toBe('supabase');
  });

  it('the temp file is cleaned up after an error too', async () => {
    const r = row(1);
    const w = world({ rowsInDb: [r], overrides: { put: async () => { throw new Error('x'); } } });
    await expect(migratePhoto(r, { dryRun: false }, w.deps)).rejects.toThrow();
    expect(w.calls.at(-1)[0]).toBe('cleanup');
  });
});

describe('dry_run writes nothing', () => {
  it('no put, no switchStore — for missing, existing and mismatching R2 objects alike', async () => {
    const rows = [row(1), row(2), row(3)];
    const w = world({
      rowsInDb: rows,
      r2: {
        [rows[1].original_key]: { size: SIZE, etag: `"${MD5}"` },
        [rows[2].original_key]: { size: 1, etag: '"x"' },
      },
      overrides: {
        put: async () => { throw new Error('WRITE IN DRY RUN'); },
        switchStore: async () => { throw new Error('WRITE IN DRY RUN'); },
      },
    });
    const summary = await runMigration(rows, { dryRun: true, limit: 0 }, w.deps);
    expect(summary.errors).toEqual([]);
    expect(w.writes).toEqual([]);
    expect(summary).toMatchObject({ checked: 3, copied: 2, skipped: 1, switched: 0, remainingAfter: 3 });
    expect([...w.db.values()].every((r) => r.original_store === 'supabase')).toBe(true);
    expect(formatSummary(summary, null)).toContain('NICHTS geschrieben');
  });
});

describe('summary and consistency report never leak keys, URLs or tokens', () => {
  it('safeMessage masks keys, URLs and JWTs', () => {
    const key = row(1).original_key;
    const message = safeMessage(
      new Error(`failed ${key} at https://acct.r2.cloudflarestorage.com/x?X-Amz-Signature=1 with eyJhbGciOiJIUzI1NiJ9.abc.def`),
      key,
    );
    expect(message).not.toContain(HH);
    expect(message).not.toMatch(/https?:/);
    expect(message).not.toContain('eyJhbGci');
  });

  it('finds orphans and r2 rows without object; only shortened ids in the output', () => {
    const rows = [row(1, { original_store: 'r2' }), row(2, { original_store: 'r2' }), row(3)];
    const objects = [
      { key: rows[0].original_key, size: SIZE },
      { key: rows[1].original_key, size: SIZE + 9 },
      { key: `${HH}/99999999-bbbb-7000-8000-000000000009/orig.jpg`, size: 5 },
    ];
    const report = findDiscrepancies(objects, rows);
    expect(report).toEqual({
      r2ObjectCount: 3,
      orphanCount: 1,
      orphanIds: ['99999999'],
      r2RowsWithoutObject: [],
      r2RowsSizeMismatch: ['00000002'],
    });
    const noObject = findDiscrepancies([], [row(4, { original_store: 'r2' })]);
    expect(noObject.r2RowsWithoutObject).toEqual(['00000004']);

    const text = formatSummary({ ...runMigrationShape(), errors: [{ photo: '00000001', message: 'x' }] }, report);
    expect(text).not.toContain(HH);
    expect(text).not.toMatch(/orig\.jpg|https?:/);
  });
});

function runMigrationShape() {
  return {
    dryRun: false, limit: 20, candidatesTotal: 3, checked: 1, copied: 1, skipped: 0, switched: 1,
    bytesCopied: SIZE, bytesChecked: SIZE, errors: [], rejectedKeys: 0, remainingAfter: 2, remainingBytesAfter: 2 * SIZE,
  };
}
