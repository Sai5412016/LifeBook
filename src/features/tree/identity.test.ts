import { describe, expect, it } from 'vitest';

import { buildRelativePhotoKey } from './identity';

describe('buildRelativePhotoKey', () => {
  it('builds the storage key from household and relative id', () => {
    expect(buildRelativePhotoKey('hh1', 'rel1')).toBe('hh1/relatives/rel1.jpg');
  });

  it('rejects a household id that would escape its own path segment', () => {
    expect(() => buildRelativePhotoKey('../evil', 'rel1')).toThrow();
  });

  it('rejects a relative id that would escape its own path segment', () => {
    expect(() => buildRelativePhotoKey('hh1', '../evil')).toThrow();
  });
});
