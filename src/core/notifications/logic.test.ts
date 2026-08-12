import { describe, expect, it } from 'vitest';

import {
  buildNotifyHouseholdRequest,
  canRequestPushPermission,
  describePushPermissionStatus,
  describeSupabaseError,
  describeTokenPresence,
  describeUnknownError,
  shouldNotifyAfterImport,
} from './logic';

describe('describePushPermissionStatus', () => {
  it.each([
    ['granted', 'Aktiv'],
    ['undetermined', 'Nicht aktiviert'],
    [
      'denied',
      'Abgelehnt — kann in den Systemeinstellungen des Geräts wieder erlaubt werden',
    ],
  ] as const)('describes %s', (status, expected) => {
    expect(describePushPermissionStatus(status)).toBe(expected);
  });
});

describe('canRequestPushPermission', () => {
  it('is false once granted — nothing left to ask for', () => {
    expect(canRequestPushPermission('granted')).toBe(false);
  });

  it('is true when undetermined', () => {
    expect(canRequestPushPermission('undetermined')).toBe(true);
  });

  it('is true when denied — the settings screen still offers to try again', () => {
    expect(canRequestPushPermission('denied')).toBe(true);
  });
});

describe('shouldNotifyAfterImport', () => {
  it('is false for zero newly imported photos', () => {
    expect(shouldNotifyAfterImport(0)).toBe(false);
  });

  it('is true for one or more', () => {
    expect(shouldNotifyAfterImport(1)).toBe(true);
    expect(shouldNotifyAfterImport(12)).toBe(true);
  });
});

describe('buildNotifyHouseholdRequest', () => {
  it('builds the exact body the server function expects', () => {
    expect(buildNotifyHouseholdRequest('household-1', 'photos', 3)).toEqual({
      householdId: 'household-1',
      kind: 'photos',
      count: 3,
    });
  });
});

describe('describeTokenPresence', () => {
  it('describes true, false and null', () => {
    expect(describeTokenPresence(true)).toBe('Vorhanden');
    expect(describeTokenPresence(false)).toBe('Fehlt');
    expect(describeTokenPresence(null)).toBe('Noch nicht geprüft');
  });
});

describe('describeSupabaseError', () => {
  it('appends the Postgres error code when present, e.g. an RLS rejection', () => {
    expect(describeSupabaseError({ message: 'new row violates row-level security policy', code: '42501' })).toBe(
      'new row violates row-level security policy (Code 42501)',
    );
  });

  it('falls back to the bare message when there is no code', () => {
    expect(describeSupabaseError({ message: 'network request failed' })).toBe('network request failed');
  });

  it('falls back to the bare message when code is explicitly null', () => {
    expect(describeSupabaseError({ message: 'network request failed', code: null })).toBe(
      'network request failed',
    );
  });
});

describe('describeUnknownError', () => {
  it('uses the message of a real Error', () => {
    expect(describeUnknownError(new Error('boom'))).toBe('boom');
  });

  it('stringifies anything else thrown', () => {
    expect(describeUnknownError('a plain string throw')).toBe('a plain string throw');
    expect(describeUnknownError(42)).toBe('42');
  });
});
