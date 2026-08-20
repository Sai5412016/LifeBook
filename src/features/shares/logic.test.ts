import { describe, expect, it } from 'vitest';

import {
  ACCESS_CODE_LENGTH,
  DEFAULT_DEVICE_LIMIT,
  DEVICE_LIMIT_CHOICES,
  SHARE_DISCLOSURE_TEXT,
  buildShareLink,
  describeDeviceFromUserAgent,
  describeShareState,
  describeSupabaseError,
  diffPhotoSelection,
  formatShareDeviceName,
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
  it('joins the Vercel viewer base URL and token via the /a/ path', () => {
    expect(buildShareLink('abc123')).toBe('https://lifebook-album-dabbly.vercel.app/a/abc123');
  });

  it('uses only the token, never a Supabase URL', () => {
    // 2026-08-14: the viewer moved off Supabase entirely (supabase.co
    // refuses to serve HTML) — this guards against the base URL ever being
    // threaded back in as a parameter by mistake.
    expect(buildShareLink('xyz')).not.toContain('supabase');
  });
});

describe('formatShareMessage', () => {
  it('includes the name, link and access code', () => {
    const message = formatShareMessage('Sommerurlaub', 'https://example.com/x', 'AB12CD');
    expect(message).toContain('Sommerurlaub');
    expect(message).toContain('https://example.com/x');
    expect(message).toContain('AB12CD');
  });

  it('carries the actual Vercel viewer link when composed with buildShareLink', () => {
    // 2026-08-14: the "Link und Code weitergeben" message must reflect the
    // current viewer address, not a stale Supabase one.
    const message = formatShareMessage('Sommerurlaub', buildShareLink('abc123'), 'AB12CD');
    expect(message).toContain('https://lifebook-album-dabbly.vercel.app/a/abc123');
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

/**
 * Echte User-Agent-Zeichenketten, keine erfundenen — die Fallen dieser
 * Funktion stecken genau in den Kompatibilitätsangaben, die echte Browser
 * mitschicken (siehe den Kommentar über PLATFORM_PATTERNS in logic.ts).
 */
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
};

describe('describeDeviceFromUserAgent — die Verwechslungsfallen', () => {
  it('nennt ein iPhone nicht "Mac", obwohl der User-Agent "like Mac OS X" enthält', () => {
    expect(describeDeviceFromUserAgent(UA.iphoneSafari)).toBe('iPhone · Safari');
  });

  it('nennt ein Android-Handy nicht "Linux", obwohl der User-Agent mit "Linux;" beginnt', () => {
    expect(describeDeviceFromUserAgent(UA.androidChrome)).toBe('Android · Chrome');
  });

  it('nennt Chrome nicht "Safari", obwohl der User-Agent "Safari/537.36" enthält', () => {
    expect(describeDeviceFromUserAgent(UA.windowsChrome)).toBe('Windows · Chrome');
  });

  it('nennt Edge nicht "Chrome", obwohl der User-Agent "Chrome/120" enthält', () => {
    expect(describeDeviceFromUserAgent(UA.windowsEdge)).toBe('Windows · Edge');
  });

  it('nennt Samsung Internet nicht "Chrome", obwohl der User-Agent "Chrome/115" enthält', () => {
    expect(describeDeviceFromUserAgent(UA.androidSamsung)).toBe('Android · Samsung Internet');
  });
});

describe('describeDeviceFromUserAgent — die übrigen üblichen Geräte', () => {
  it('erkennt ein iPad', () => {
    expect(describeDeviceFromUserAgent(UA.ipadSafari)).toBe('iPad · Safari');
  });

  it('erkennt Chrome auf dem iPhone an "CriOS"', () => {
    expect(describeDeviceFromUserAgent(UA.iphoneChrome)).toBe('iPhone · Chrome');
  });

  it('erkennt Firefox unter Windows', () => {
    expect(describeDeviceFromUserAgent(UA.windowsFirefox)).toBe('Windows · Firefox');
  });

  it('erkennt Safari auf dem Mac', () => {
    expect(describeDeviceFromUserAgent(UA.macSafari)).toBe('Mac · Safari');
  });
});

describe('describeDeviceFromUserAgent — wenn nichts zu erkennen ist', () => {
  it('gibt null zurück statt zu raten', () => {
    expect(describeDeviceFromUserAgent('irgendein Bot ohne alles')).toBeNull();
  });

  it('gibt null für fehlende, leere und nur aus Leerzeichen bestehende Angaben zurück', () => {
    expect(describeDeviceFromUserAgent(null)).toBeNull();
    expect(describeDeviceFromUserAgent(undefined)).toBeNull();
    expect(describeDeviceFromUserAgent('')).toBeNull();
    expect(describeDeviceFromUserAgent('   ')).toBeNull();
  });

  it('nennt allein das System, wenn der Browser unbekannt ist', () => {
    expect(describeDeviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0) EigenerClient/1.0')).toBe('Windows');
  });

  it('nennt allein den Browser, wenn das System unbekannt ist', () => {
    expect(describeDeviceFromUserAgent('Firefox/121.0')).toBe('Firefox');
  });
});

describe('formatShareDeviceName', () => {
  it('nimmt ein selbst vergebenes Label immer vorrangig', () => {
    expect(formatShareDeviceName('Omas Tablet', UA.androidChrome)).toBe('Omas Tablet');
  });

  it('leitet aus dem User-Agent ab, wenn kein Label gesetzt ist', () => {
    expect(formatShareDeviceName(null, UA.iphoneSafari)).toBe('iPhone · Safari');
  });

  it('behandelt ein Label aus Leerzeichen wie keines', () => {
    expect(formatShareDeviceName('   ', UA.macSafari)).toBe('Mac · Safari');
  });

  it('fällt auf den Platzhalter zurück, wenn beides fehlt', () => {
    expect(formatShareDeviceName(null, null)).toBe('Unbenanntes Gerät');
  });

  it('fällt auf den Platzhalter zurück, wenn der User-Agent nichts hergibt', () => {
    expect(formatShareDeviceName(null, 'unlesbar')).toBe('Unbenanntes Gerät');
  });
});
