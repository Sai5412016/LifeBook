import { describe, expect, it } from 'vitest';

import {
  MAX_SHARE_BATCH,
  checkShareBatchSize,
  formatMobileDataWarning,
  formatShareDiagnostic,
  formatShareFailureSummary,
  formatShareProgressLabel,
  resolveShareMimeType,
  shouldWarnAboutMobileData,
} from './sharing';

describe('checkShareBatchSize', () => {
  it('rejects an empty selection', () => {
    expect(checkShareBatchSize(0)).toEqual({ ok: false, message: 'Bitte mindestens ein Foto auswählen.' });
  });

  it('accepts one photo', () => {
    expect(checkShareBatchSize(1)).toEqual({ ok: true });
  });

  it('accepts exactly the cap', () => {
    expect(checkShareBatchSize(MAX_SHARE_BATCH)).toEqual({ ok: true });
  });

  it('rejects one over the cap with a friendly message naming both numbers, instead of silently truncating', () => {
    expect(checkShareBatchSize(MAX_SHARE_BATCH + 1)).toEqual({
      ok: false,
      message: 'Bitte höchstens 20 Fotos auf einmal teilen (21 ausgewählt).',
    });
  });

  it('honours a custom cap', () => {
    expect(checkShareBatchSize(6, 5)).toEqual({
      ok: false,
      message: 'Bitte höchstens 5 Fotos auf einmal teilen (6 ausgewählt).',
    });
  });
});

describe('formatShareProgressLabel', () => {
  it('formats the current position and total', () => {
    expect(formatShareProgressLabel(3, 8)).toBe('Bild 3 von 8 wird geladen …');
  });
});

describe('shouldWarnAboutMobileData', () => {
  it('never warns on Wi-Fi', () => {
    expect(shouldWarnAboutMobileData(10, true)).toBe(false);
  });

  it('does not warn for a single photo off Wi-Fi — not worth interrupting for', () => {
    expect(shouldWarnAboutMobileData(1, false)).toBe(false);
  });

  it('warns for two or more photos off Wi-Fi', () => {
    expect(shouldWarnAboutMobileData(2, false)).toBe(true);
    expect(shouldWarnAboutMobileData(20, false)).toBe(true);
  });
});

describe('formatMobileDataWarning', () => {
  it('names the exact count', () => {
    expect(formatMobileDataWarning(5)).toBe('Kein WLAN aktiv — 5 Fotos werden über Mobilfunk geladen.');
  });
});

describe('formatShareFailureSummary', () => {
  it('returns null when nothing failed', () => {
    expect(formatShareFailureSummary(0, 8)).toBeNull();
  });

  it('names a single failure among several', () => {
    expect(formatShareFailureSummary(1, 8)).toBe('1 Foto konnte nicht geladen werden und wurde übersprungen.');
  });

  it('names several failures among more', () => {
    expect(formatShareFailureSummary(3, 8)).toBe(
      '3 Fotos konnten nicht geladen werden und wurden übersprungen.',
    );
  });

  it('has dedicated wording when the single selected photo fails', () => {
    expect(formatShareFailureSummary(1, 1)).toBe('Das Foto konnte nicht geladen werden.');
  });

  it('has dedicated wording when every photo in a larger batch fails', () => {
    expect(formatShareFailureSummary(4, 4)).toBe('Keines der ausgewählten Fotos konnte geladen werden.');
  });
});

describe('resolveShareMimeType', () => {
  it('uses the single shared mime type', () => {
    expect(resolveShareMimeType(['image/jpeg', 'image/jpeg'])).toBe('image/jpeg');
  });

  it('falls back to a wildcard for a mixed batch', () => {
    expect(resolveShareMimeType(['image/jpeg', 'image/png'])).toBe('image/*');
  });

  it('ignores missing mime types when a single real one is present', () => {
    expect(resolveShareMimeType(['image/heic', null, undefined])).toBe('image/heic');
  });

  it('falls back to a wildcard when nothing is known', () => {
    expect(resolveShareMimeType([null, undefined])).toBe('image/*');
  });

  it('falls back to a wildcard for an empty batch', () => {
    expect(resolveShareMimeType([])).toBe('image/*');
  });
});

describe('formatShareDiagnostic', () => {
  it('lists each file with its path and byte size beneath the error', () => {
    expect(
      formatShareDiagnostic(
        [
          { uri: 'file:///cache/photos-sharing/a.jpg', bytes: 204800 },
          { uri: 'file:///cache/photos-sharing/b.jpg', bytes: 512000 },
        ],
        'Activity not found',
      ),
    ).toBe(
      'Activity not found\n\n' +
        'file:///cache/photos-sharing/a.jpg (204800 Bytes)\n' +
        'file:///cache/photos-sharing/b.jpg (512000 Bytes)',
    );
  });

  it('returns just the error message when there are no files to list', () => {
    expect(formatShareDiagnostic([], 'Activity not found')).toBe('Activity not found');
  });
});
