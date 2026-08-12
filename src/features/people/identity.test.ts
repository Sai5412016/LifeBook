import { describe, expect, it } from 'vitest';

import { buildPersonPhotoKey } from './identity';

describe('buildPersonPhotoKey', () => {
  it('builds {householdId}/people/{personId}.jpg', () => {
    expect(buildPersonPhotoKey('household-1', 'person-1')).toBe('household-1/people/person-1.jpg');
  });

  it('rejects a household id that would smuggle a path separator', () => {
    expect(() => buildPersonPhotoKey('house/hold', 'person-1')).toThrow();
  });

  it('rejects a person id that would smuggle a path separator', () => {
    expect(() => buildPersonPhotoKey('household-1', 'person/1')).toThrow();
  });

  it('rejects a traversal attempt', () => {
    expect(() => buildPersonPhotoKey('..', 'person-1')).toThrow();
    expect(() => buildPersonPhotoKey('household-1', '..')).toThrow();
  });

  it('rejects an empty id', () => {
    expect(() => buildPersonPhotoKey('', 'person-1')).toThrow();
  });
});
