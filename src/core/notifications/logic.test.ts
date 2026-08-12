import { describe, expect, it } from 'vitest';

import {
  buildNotifyHouseholdRequest,
  canRequestPushPermission,
  describeExecutionEnvironment,
  describeProjectIdSource,
  describePushPermissionStatus,
  describeRegistrationRunStatus,
  describeSupabaseError,
  describeTokenPresence,
  describeUnknownError,
  selectProjectId,
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
  it('uses the name and message of a real Error, verbatim', () => {
    expect(describeUnknownError(new Error('boom'))).toBe('Error: boom');
  });

  it('preserves a subclassed Error name', () => {
    expect(describeUnknownError(new TypeError('Network request failed'))).toBe(
      'TypeError: Network request failed',
    );
  });

  it('appends a code property when the error carries one', () => {
    const error = new Error('Missing registration token');
    (error as Error & { code: string }).code = 'messaging/registration-token-not-registered';
    expect(describeUnknownError(error)).toBe(
      'Error: Missing registration token (code: messaging/registration-token-not-registered)',
    );
  });

  it('stringifies anything else thrown', () => {
    expect(describeUnknownError('a plain string throw')).toBe('a plain string throw');
    expect(describeUnknownError(42)).toBe('42');
  });
});

describe('describeRegistrationRunStatus', () => {
  it.each([
    ['never', 'Nie versucht'],
    ['running', 'Läuft …'],
    ['done', 'Abgeschlossen'],
    ['failed', 'Fehlgeschlagen'],
  ] as const)('describes %s', (status, expected) => {
    expect(describeRegistrationRunStatus(status)).toBe(expected);
  });
});

describe('describeExecutionEnvironment', () => {
  it('describes a standalone build', () => {
    expect(describeExecutionEnvironment('standalone')).toBe('Eigenständiger Build');
  });

  it('describes Expo Go / a dev client, naming the push limitation', () => {
    expect(describeExecutionEnvironment('storeClient')).toBe('Expo Go oder Dev-Client (kein Push-Empfang möglich)');
  });

  it('describes a bare project', () => {
    expect(describeExecutionEnvironment('bare')).toBe('Bare (natives Projekt ohne Expo Go)');
  });

  it('falls back to "Unbekannt" for null or an unrecognised value', () => {
    expect(describeExecutionEnvironment(null)).toBe('Unbekannt');
    expect(describeExecutionEnvironment('something-new')).toBe('Unbekannt');
  });
});

describe('selectProjectId', () => {
  it('uses expoConfig when only the first source is present', () => {
    expect(selectProjectId('expo-project-id', null, 'fallback-id')).toEqual({
      projectId: 'expo-project-id',
      source: 'expoConfig',
    });
  });

  it('uses easConfig when only the second source is present', () => {
    expect(selectProjectId(null, 'eas-project-id', 'fallback-id')).toEqual({
      projectId: 'eas-project-id',
      source: 'easConfig',
    });
  });

  it('uses the fallback when both sources are empty', () => {
    expect(selectProjectId(null, undefined, 'fallback-id')).toEqual({
      projectId: 'fallback-id',
      source: 'fallback',
    });
  });

  it('prefers expoConfig over easConfig when both are present but differ', () => {
    expect(selectProjectId('expo-project-id', 'eas-project-id', 'fallback-id')).toEqual({
      projectId: 'expo-project-id',
      source: 'expoConfig',
    });
  });

  it('treats an empty string the same as missing', () => {
    expect(selectProjectId('', 'eas-project-id', 'fallback-id')).toEqual({
      projectId: 'eas-project-id',
      source: 'easConfig',
    });
  });
});

describe('describeProjectIdSource', () => {
  it.each([
    ['expoConfig', 'aus expoConfig'],
    ['easConfig', 'aus easConfig'],
    ['fallback', 'fester Rückfallwert'],
  ] as const)('describes %s', (source, expected) => {
    expect(describeProjectIdSource(source)).toBe(expected);
  });
});
