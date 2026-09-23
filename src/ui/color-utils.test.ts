import { describe, expect, it } from 'vitest';

import { lighten, withAlpha } from './color-utils';

describe('withAlpha', () => {
  it('converts a 6-digit hex color to rgba', () => {
    expect(withAlpha('#E9613A', 0.35)).toBe('rgba(233, 97, 58, 0.35)');
  });

  it('converts a 3-digit hex color to rgba', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('handles black and full opacity', () => {
    expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });
});

describe('lighten', () => {
  it('mixes a color toward white by the given amount, at full opacity', () => {
    expect(lighten('#E9613A', 0.55)).toBe('#f5b8a6'); // accent
    expect(lighten('#d9822b', 0.55)).toBe('#eec7a0'); // amber
  });

  it('amount 0 returns the color unchanged', () => {
    expect(lighten('#123456', 0)).toBe('#123456');
  });

  it('amount 1 returns pure white regardless of the input color', () => {
    expect(lighten('#123456', 1)).toBe('#ffffff');
    expect(lighten('#000000', 1)).toBe('#ffffff');
  });
});
