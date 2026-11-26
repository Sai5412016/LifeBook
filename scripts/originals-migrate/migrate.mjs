/**
 * originals-migrate/migrate — every DECISION of the original migration
 * Supabase Storage → Cloudflare R2, Phase A (PR 3, 2026-11-26). Pure: no
 * network, no file system, no environment. ./run.mjs injects the real calls;
 * ./migrate.test.mjs covers every branch, including that a dry run never
 * calls a writing dependency.
 *
 * Plain JavaScript (ES module) on purpose: the app's tsconfig includes every
 * `*.ts` in the repo and has no Node types, and no new package may be added.
 *
 * PHASE A RULES (task 2026-11-26) — none of these may be loosened:
 *  - Nothing is ever deleted, in Supabase Storage or in R2.
 *  - A photo switches to 'r2' only after R2 holds an object of exactly the
 *    source size whose ETag equals the source MD5 (single-part PUT with
 *    Content-MD5, so R2's ETag IS the MD5).
 *  - The switch is a CONDITIONAL update (… AND original_store = 'supabase'):
 *    if a phone changed the row meanwhile, nothing is overwritten.
 *  - Every error leaves the photo on 'supabase' and the run goes on.
 *  - Output never contains object keys, tokens or signed URLs — photo ids
 *    are shortened to their first 8 characters.
 */

/** Same layout as the app and media-sign: <household_id>/<photo_id>/orig.<ext>. */
const KEY_PATTERN = /^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\/orig\.(jpg|jpeg|png|heic|webp)$/;

export function isSafeKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key) && !key.includes('..');
}

/** First 8 characters of a photo id — enough to find it, never a storage key. */
export function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

/**
 * The photos to migrate, oldest first: alive, original in Supabase and
 * actually uploaded. `limit` 0 (or less) means all.
 */
export function selectCandidates(rows, limit) {
  const eligible = rows
    .filter(
      (row) =>
        row.deleted_at === null &&
        row.original_store === 'supabase' &&
        row.original_uploaded_at !== null &&
        row.original_uploaded_at !== undefined &&
        isSafeKey(row.original_key),
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return limit > 0 ? eligible.slice(0, limit) : eligible;
}

/** Rows that would be candidates except for an unusable key — reported, never touched. */
export function rejectedKeys(rows) {
  return rows.filter(
    (row) =>
      row.deleted_at === null &&
      row.original_store === 'supabase' &&
      row.original_uploaded_at &&
      !isSafeKey(row.original_key),
  );
}

/** S3 ETags come quoted ("…"); compare lower-case hex without quotes. */
export function normalizeEtag(etag) {
  return String(etag ?? '').replace(/"/g, '').trim().toLowerCase();
}

/** True when the R2 object is exactly the source: same size AND ETag = MD5. */
export function r2MatchesSource(head, source) {
  return (
    !!head &&
    Number(head.size) === source.bytes &&
    normalizeEtag(head.etag) === String(source.md5Hex).toLowerCase()
  );
}

/**
 * Source size check: the downloaded byte count must equal Storage's own
 * Content-Length (if it sent one) AND the row's `bytes` (if set).
 */
export function sourceSizeProblem(source, rowBytes) {
  if (!Number.isInteger(source.bytes) || source.bytes <= 0) return 'Download leer';
  if (source.contentLength !== null && source.contentLength !== undefined && Number(source.contentLength) !== source.bytes) {
    return `Download unvollständig (${source.bytes} von ${source.contentLength} Bytes)`;
  }
  if (rowBytes !== null && rowBytes !== undefined && Number(rowBytes) !== source.bytes) {
    return `Größe weicht von photos.bytes ab (${source.bytes} statt ${rowBytes})`;
  }
  return null;
}

/** Hex MD5 → base64, for the Content-MD5 header R2 checks on upload. */
export function md5HexToBase64(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Error text safe for the job summary: no key, no URL, no token-looking
 * string, at most 200 characters.
 */
export function safeMessage(error, key) {
  let text = error instanceof Error ? error.message : String(error);
  if (key) text = text.split(key).join('<key>');
  text = text
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z0-9-]{8,}\/[A-Za-z0-9-]{8,}\/orig\.\w+/g, '<key>')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '<token>');
  return text.slice(0, 200);
}

/**
 * Migrates ONE photo. Returns what happened; throws on any failure (the
 * caller records it and goes on — the row is untouched in that case).
 *
 * deps:
 *  - download(key) → { path, bytes, md5Hex, sha256Hex, contentLength }
 *  - head(key)     → null | { size, etag }            (read)
 *  - put(key, path, contentType, md5Base64)            (WRITE to R2)
 *  - switchStore(id) → number of rows updated (0/1)    (WRITE to Postgres)
 *  - cleanup(path)                                     (local temp file)
 */
export async function migratePhoto(row, options, deps) {
  const key = row.original_key;
  const source = await deps.download(key);
  try {
    const problem = sourceSizeProblem(source, row.bytes);
    if (problem) throw new Error(problem);

    const contentType = String(row.mime ?? 'image/jpeg').toLowerCase();
    const existing = await deps.head(key);
    const alreadyThere = r2MatchesSource(existing, source);

    if (options.dryRun) {
      return {
        copy: alreadyThere ? 'would_skip' : 'would_copy',
        switched: 'would_switch',
        bytes: source.bytes,
        sha256: source.sha256Hex,
      };
    }

    if (!alreadyThere) {
      await deps.put(key, source.path, contentType, md5HexToBase64(source.md5Hex));
      const after = await deps.head(key);
      if (!r2MatchesSource(after, source)) {
        throw new Error(
          after
            ? `Prüfung nach Upload fehlgeschlagen (R2 ${after.size} Bytes, ETag ${normalizeEtag(after.etag) === source.md5Hex ? 'gleich' : 'abweichend'})`
            : 'Prüfung nach Upload fehlgeschlagen (Objekt in R2 nicht gefunden)',
        );
      }
    }

    const updated = await deps.switchStore(row.id);
    if (updated !== 1) {
      // Not an R2 problem: the row changed meanwhile (deleted for good, or
      // already switched). The object stays in R2; the orphan report shows it.
      throw new Error('Zeile inzwischen geändert – nicht umgestellt');
    }
    return { copy: alreadyThere ? 'skipped' : 'copied', switched: 'switched', bytes: source.bytes, sha256: source.sha256Hex };
  } finally {
    await deps.cleanup(source.path);
  }
}

export function emptySummary(dryRun, limit) {
  return {
    dryRun,
    limit,
    candidatesTotal: 0,
    checked: 0,
    copied: 0,
    skipped: 0,
    switched: 0,
    bytesCopied: 0,
    bytesChecked: 0,
    errors: [],
    rejectedKeys: 0,
    remainingAfter: 0,
    remainingBytesAfter: 0,
  };
}

/** Runs the batch sequentially; never throws for a single photo. */
export async function runMigration(rows, options, deps) {
  const summary = emptySummary(options.dryRun, options.limit);
  const allCandidates = selectCandidates(rows, 0);
  const batch = selectCandidates(rows, options.limit);
  summary.candidatesTotal = allCandidates.length;
  summary.rejectedKeys = rejectedKeys(rows).length;

  const switchedIds = new Set();
  for (const row of batch) {
    summary.checked += 1;
    try {
      const result = await migratePhoto(row, options, deps);
      summary.bytesChecked += result.bytes;
      if (result.copy === 'copied' || result.copy === 'would_copy') {
        summary.copied += 1;
        summary.bytesCopied += result.bytes;
      } else {
        summary.skipped += 1;
      }
      if (result.switched === 'switched') {
        summary.switched += 1;
        switchedIds.add(row.id);
      }
    } catch (error) {
      summary.errors.push({ photo: shortId(row.id), message: safeMessage(error, row.original_key) });
    }
    options.onProgress?.(summary);
  }

  const remaining = allCandidates.filter((row) => !switchedIds.has(row.id));
  summary.remainingAfter = remaining.length;
  summary.remainingBytesAfter = remaining.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0);
  return summary;
}

/**
 * Read-only consistency report (task point 4): R2 objects without a matching
 * photos row, and 'r2' rows without (or with a differently sized) R2 object.
 * Returns counts and shortened photo ids only.
 */
export function findDiscrepancies(r2Objects, photoRows) {
  const rowsByKey = new Map(photoRows.filter((row) => row.original_key).map((row) => [row.original_key, row]));
  const objectsByKey = new Map(r2Objects.map((object) => [object.key, object]));

  const orphans = r2Objects.filter((object) => !rowsByKey.has(object.key));
  const r2Rows = photoRows.filter((row) => row.original_store === 'r2');
  const missing = r2Rows.filter((row) => !objectsByKey.has(row.original_key));
  const sizeMismatch = r2Rows.filter((row) => {
    const object = objectsByKey.get(row.original_key);
    return object && row.bytes !== null && row.bytes !== undefined && Number(object.size) !== Number(row.bytes);
  });

  const idOfKey = (key) => {
    const parts = String(key).split('/');
    return parts.length >= 2 ? shortId(parts[1]) : '(unbekannt)';
  };

  return {
    r2ObjectCount: r2Objects.length,
    orphanCount: orphans.length,
    orphanIds: orphans.map((object) => idOfKey(object.key)),
    r2RowsWithoutObject: missing.map((row) => shortId(row.id)),
    r2RowsSizeMismatch: sizeMismatch.map((row) => shortId(row.id)),
  };
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} Bytes`;
}

/** Markdown for $GITHUB_STEP_SUMMARY — counts, sizes and shortened ids only. */
export function formatSummary(summary, discrepancies) {
  const mode = summary.dryRun ? 'Testlauf (dry_run) – NICHTS geschrieben' : 'Echter Lauf';
  const lines = [
    '### Originale Supabase → R2 (Phase A)',
    '',
    `- Modus: **${mode}**, limit ${summary.limit > 0 ? summary.limit : 'alle'}`,
    `- Kandidaten vor dem Lauf: ${summary.candidatesTotal}`,
    `- Geprüft: ${summary.checked} (${formatBytes(summary.bytesChecked)})`,
    `- ${summary.dryRun ? 'Würde kopieren' : 'Kopiert'}: ${summary.copied} (${formatBytes(summary.bytesCopied)})`,
    `- ${summary.dryRun ? 'Würde überspringen (schon gleich in R2)' : 'Übersprungen (schon gleich in R2)'}: ${summary.skipped}`,
    `- Umgestellt auf 'r2': ${summary.dryRun ? '0 (Testlauf)' : summary.switched}`,
    `- Fehler: ${summary.errors.length}`,
    `- Restmenge 'supabase' danach: ${summary.remainingAfter} (${formatBytes(summary.remainingBytesAfter)})`,
  ];
  if (summary.rejectedKeys > 0) {
    lines.push(`- Nicht angefasst (Schlüssel passt nicht zum Schema): ${summary.rejectedKeys}`);
  }
  if (summary.errors.length > 0) {
    lines.push('', '#### Fehler (Foto bleibt \'supabase\')');
    for (const error of summary.errors) lines.push(`- \`${error.photo}\`: ${error.message}`);
  }
  if (discrepancies) {
    lines.push(
      '',
      '#### Abgleich R2 ↔ photos (nur lesend, nichts gelöscht)',
      `- Objekte in R2: ${discrepancies.r2ObjectCount}`,
      `- R2-Objekte ohne passende photos-Zeile (Waisen): ${discrepancies.orphanCount}${discrepancies.orphanIds.length ? ` – Fotos ${discrepancies.orphanIds.map((id) => `\`${id}\``).join(', ')}` : ''}`,
      `- photos-Zeilen 'r2' ohne R2-Objekt: ${discrepancies.r2RowsWithoutObject.length}${discrepancies.r2RowsWithoutObject.length ? ` – ${discrepancies.r2RowsWithoutObject.map((id) => `\`${id}\``).join(', ')}` : ''}`,
      `- photos-Zeilen 'r2' mit abweichender Größe in R2: ${discrepancies.r2RowsSizeMismatch.length}${discrepancies.r2RowsSizeMismatch.length ? ` – ${discrepancies.r2RowsSizeMismatch.map((id) => `\`${id}\``).join(', ')}` : ''}`,
    );
  }
  return lines.join('\n') + '\n';
}
