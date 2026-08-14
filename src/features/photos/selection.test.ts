import { describe, expect, it } from 'vitest';

import { formatDeleteConfirmationMessage, formatSelectionCountLabel, toggleSelected } from './selection';

describe('toggleSelected', () => {
  it('adds an id not yet selected, at the end', () => {
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an id already selected', () => {
    expect(toggleSelected(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('starts a selection from empty', () => {
    expect(toggleSelected([], 'a')).toEqual(['a']);
  });

  it('empties a selection down to zero without erroring', () => {
    expect(toggleSelected(['a'], 'a')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const original = ['a', 'b'];
    toggleSelected(original, 'a');
    toggleSelected(original, 'c');
    expect(original).toEqual(['a', 'b']);
  });
});

describe('formatSelectionCountLabel', () => {
  it('formats zero, one and many the same shape', () => {
    expect(formatSelectionCountLabel(0)).toBe('0 ausgewählt');
    expect(formatSelectionCountLabel(1)).toBe('1 ausgewählt');
    expect(formatSelectionCountLabel(12)).toBe('12 ausgewählt');
  });
});

describe('formatDeleteConfirmationMessage', () => {
  it('names a single photo in the singular and mentions the trash', () => {
    const message = formatDeleteConfirmationMessage(1);
    expect(message).toContain('Das ausgewählte Foto');
    expect(message).toContain('30 Tage im Papierkorb');
    expect(message).not.toContain('unwiderruflich');
  });

  it('names the exact count in the plural and mentions the trash', () => {
    const message = formatDeleteConfirmationMessage(5);
    expect(message).toContain('5 ausgewählte Fotos');
    expect(message).toContain('30 Tage im Papierkorb');
    expect(message).not.toContain('unwiderruflich');
  });
});
