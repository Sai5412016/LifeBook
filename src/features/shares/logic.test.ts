import { describe, expect, it } from 'vitest';

import {
  ACCESS_CODE_LENGTH,
  DEFAULT_DEVICE_LIMIT,
  DEVICE_LIMIT_CHOICES,
  SHARE_DISCLOSURE_TEXT,
  buildShareLink,
  describeShareState,
  describeSupabaseError,
  diffPhotoSelection,
  formatDeviceCountLabel,
  formatDeviceSeenLabel,
  formatPhotoCountLabel,
  formatShareMessage,
  formatDeleteConfirmation,
  formatRevokeConfirmation,
  generateAccessCode,
  generateShareToken,
  isPhotoReadyForShare,
  summarizeShares,
} from './logic';
import type { ShareRow } from './types';

/** 32 bytes of ascending values — deterministic fixture, no randomness involved. */
function fixtureBytes(length: number, fill: (i: number) => number = (i) => i * 7): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = fill(i) % 256;
  }
  return bytes;
}

describe('generateShareToken', () => {
  it('encodes 32 bytes into a base64url string with no padding', () => {
    const token = generateShareToken(fixtureBytes(32));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> ceil(32/3)*4 base64 chars minus the padding this encoder never adds
    expect(token.length).toBe(43);
  });

  it('is deterministic for the same input bytes', () => {
    const a = generateShareToken(fixtureBytes(32));
    const b = generateShareToken(fixtureBytes(32));
    expect(a).toBe(b);
  });

  it('produces a longer token for more bytes', () => {
    const token = generateShareToken(fixtureBytes(48));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBe(64);
  });

  it('throws when given fewer than 32 bytes', () => {
    expect(() => generateShareToken(fixtureBytes(31))).toThrow();
  });
});

describe('generateAccessCode', () => {
  it('produces exactly ACCESS_CODE_LENGTH characters from the confusable-free alphabet', () => {
    const code = generateAccessCode(fixtureBytes(32));
    expect(code).toHaveLength(ACCESS_CODE_LENGTH);
    expect(code).toMatch(/^[0-9A-HJ-NP-Z]+$/);
  });

  it('never contains the excluded confusable characters', () => {
    const code = generateAccessCode(fixtureBytes(32, (i) => (i * 37 + 5) % 256));
    expect(code).not.toMatch(/[IOl]/);
  });

  it('skips rejected bytes (>= 238) instead of using them', () => {
    // First two bytes are above the rejection ceiling (238) and must be skipped;
    // byte 238 itself is also rejected (ceiling is exclusive: floor(256/34)*34 = 238).
    const rejected = [250, 255, 238];
    const accepted = [0, 34, 68, 102, 136, 170]; // all map to alphabet index 0 -> '0'
    const bytes = Uint8Array.from([...rejected, ...accepted]);
    const code = generateAccessCode(bytes);
    expect(code).toBe('000000');
  });

  it('throws if it runs out of bytes before reaching the target length', () => {
    const allRejected = Uint8Array.from([255, 254, 253]);
    expect(() => generateAccessCode(allRejected)).toThrow();
  });
});

describe('buildShareLink', () => {
  it('joins the Supabase URL and token via the album function path', () => {
    expect(buildShareLink('https://example.supabase.co', 'abc123')).toBe(
      'https://example.supabase.co/functions/v1/album/abc123',
    );
  });
});

describe('formatShareMessage', () => {
  it('includes the name, link and access code', () => {
    const message = formatShareMessage('Sommerurlaub', 'https://example.com/x', 'AB12CD');
    expect(message).toContain('Sommerurlaub');
    expect(message).toContain('https://example.com/x');
    expect(message).toContain('AB12CD');
  });
});

describe('describeShareState', () => {
  it('is "aktiv" when revokedAt is null', () => {
    expect(describeShareState(null)).toBe('aktiv');
  });

  it('is "widerrufen" when revokedAt is set', () => {
    expect(describeShareState('2026-08-14T10:00:00.000Z')).toBe('widerrufen');
  });
});

describe('formatDeviceCountLabel', () => {
  it('formats count against the limit', () => {
    expect(formatDeviceCountLabel(2, 5)).toBe('2 von 5 Geräten');
  });
});

describe('formatPhotoCountLabel', () => {
  it('handles zero, one and many', () => {
    expect(formatPhotoCountLabel(0)).toBe('Keine Fotos');
    expect(formatPhotoCountLabel(1)).toBe('1 Foto');
    expect(formatPhotoCountLabel(4)).toBe('4 Fotos');
  });
});

describe('isPhotoReadyForShare', () => {
  it('is true only when medium_key is set', () => {
    expect(isPhotoReadyForShare({ medium_key: 'photos/a/medium.jpg' })).toBe(true);
    expect(isPhotoReadyForShare({ medium_key: null })).toBe(false);
  });
});

describe('formatRevokeConfirmation / formatDeleteConfirmation', () => {
  it('name the share and describe what happens', () => {
    expect(formatRevokeConfirmation('Sommerurlaub')).toContain('Sommerurlaub');
    expect(formatRevokeConfirmation('Sommerurlaub')).toContain('nicht mehr');
    expect(formatDeleteConfirmation('Sommerurlaub')).toContain('Sommerurlaub');
    expect(formatDeleteConfirmation('Sommerurlaub')).toContain('endgültig');
  });
});

describe('SHARE_DISCLOSURE_TEXT', () => {
  it('is a plain factual sentence without exclamation marks', () => {
    expect(SHARE_DISCLOSURE_TEXT).not.toContain('!');
    expect(SHARE_DISCLOSURE_TEXT.length).toBeGreaterThan(0);
  });
});

describe('formatDeviceSeenLabel', () => {
  it('formats both timestamps in the given timezone', () => {
    const label = formatDeviceSeenLabel(
      '2026-08-10T08:00:00.000Z',
      '2026-08-14T09:30:00.000Z',
      'Europe/Berlin',
    );
    expect(label).toContain('Erster Zugriff');
    expect(label).toContain('Letzter Zugriff');
  });
});

describe('DEVICE_LIMIT_CHOICES / DEFAULT_DEVICE_LIMIT', () => {
  it('includes the default among the choices', () => {
    expect(DEVICE_LIMIT_CHOICES).toContain(DEFAULT_DEVICE_LIMIT);
  });
});

describe('summarizeShares', () => {
  const baseShare: ShareRow = {
    id: 'share-1',
    household_id: 'household-1',
    name: 'Sommerurlaub',
    token: 'token',
    access_code: 'ABCDEF',
    device_limit: 5,
    allow_download: true,
    expires_at: null,
    revoked_at: null,
    failed_code_attempts: 0,
    locked_until: null,
    view_count: 0,
    last_viewed_at: null,
    created_by: 'user-1',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };

  it('attaches photo and device counts per share', () => {
    const shares = [baseShare, { ...baseShare, id: 'share-2' }];
    const photoRows = [{ share_id: 'share-1' }, { share_id: 'share-1' }, { share_id: 'share-2' }];
    const deviceRows = [{ share_id: 'share-1' }];

    const summaries = summarizeShares(shares, photoRows, deviceRows);

    expect(summaries.find((s) => s.id === 'share-1')).toMatchObject({ photoCount: 2, deviceCount: 1 });
    expect(summaries.find((s) => s.id === 'share-2')).toMatchObject({ photoCount: 1, deviceCount: 0 });
  });

  it('defaults to zero counts when a share has none', () => {
    const summaries = summarizeShares([baseShare], [], []);
    expect(summaries[0]).toMatchObject({ photoCount: 0, deviceCount: 0 });
  });
});

describe('diffPhotoSelection', () => {
  it('finds ids to add and remove', () => {
    const result = diffPhotoSelection(['a', 'b', 'c'], ['b', 'c', 'd']);
    expect(result.toAdd).toEqual(['d']);
    expect(result.toRemove).toEqual(['a']);
  });

  it('is empty when the selection is unchanged', () => {
    const result = diffPhotoSelection(['a', 'b'], ['a', 'b']);
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });
});

describe('describeSupabaseError', () => {
  it('appends the code when present', () => {
    expect(describeSupabaseError({ message: 'nope', code: '42501' })).toBe('nope (Code 42501)');
  });

  it('falls back to the message alone without a code', () => {
    expect(describeSupabaseError({ message: 'nope' })).toBe('nope');
  });
});
