import { describe, expect, it } from 'vitest';

import {
  MAX_SUGGESTION_TEXT_LENGTH,
  addedFields,
  changedFields,
  describeSuggestion,
  describeSuggestionKind,
  formatSuggestionPhotoSizeMb,
  isSuggestionFieldSet,
  truncateGuestText,
} from './suggestions';
import type { RelativeRow, TreeSuggestionRow } from './types';

function suggestion(overrides: Partial<TreeSuggestionRow> = {}): TreeSuggestionRow {
  return {
    id: 'sug-1',
    household_id: 'household-1',
    share_id: 'share-1',
    device_id: 'device-1',
    visitor_name: 'Rosi',
    kind: 'add',
    relative_id: null,
    given_name: null,
    family_name: null,
    birth_name: null,
    gender: null,
    born_on: null,
    born_place: null,
    deceased: null,
    died_on: null,
    died_place: null,
    mother_id: null,
    father_id: null,
    message: null,
    photo_key: null,
    photo_bytes: null,
    photo_mime: null,
    status: 'open',
    created_at: '2026-08-24T10:00:00.000Z',
    decided_at: null,
    decided_by: null,
    updated_at: '2026-08-24T10:00:00.000Z',
    deleted_at: null,
    source_device_id: null,
    ...overrides,
  };
}

function relative(overrides: Partial<RelativeRow> = {}): RelativeRow {
  return {
    id: 'rel-1',
    household_id: 'household-1',
    child_id: null,
    given_name: 'Anna',
    family_name: 'Muster',
    birth_name: null,
    gender: 'female',
    born_on: '1950',
    born_place: null,
    deceased: 0,
    died_on: null,
    died_place: null,
    mother_id: null,
    father_id: null,
    photo_key: null,
    note: null,
    sort_index: 0,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    source_device_id: null,
    ...overrides,
  };
}

describe('formatSuggestionPhotoSizeMb', () => {
  it('formatiert auf eine Nachkommastelle', () => {
    expect(formatSuggestionPhotoSizeMb(279 * 1024)).toBe('0.3 MB');
    expect(formatSuggestionPhotoSizeMb(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('zeigt "< 0.1 MB" für sehr kleine, fehlende oder ungültige Werte', () => {
    expect(formatSuggestionPhotoSizeMb(1000)).toBe('< 0.1 MB');
    expect(formatSuggestionPhotoSizeMb(0)).toBe('< 0.1 MB');
    expect(formatSuggestionPhotoSizeMb(-5)).toBe('< 0.1 MB');
    expect(formatSuggestionPhotoSizeMb(NaN)).toBe('< 0.1 MB');
  });
});

describe('truncateGuestText', () => {
  it('lässt kurzen Text unverändert', () => {
    expect(truncateGuestText('Rosi')).toBe('Rosi');
  });

  it('schneidet am Rand getrimmten Text nicht unnötig', () => {
    expect(truncateGuestText('  Rosi  ')).toBe('Rosi');
  });

  it('kürzt langen Text auf die Höchstlänge und hängt "…" an', () => {
    const long = 'a'.repeat(MAX_SUGGESTION_TEXT_LENGTH + 50);
    const result = truncateGuestText(long);
    expect(result.length).toBe(MAX_SUGGESTION_TEXT_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('respektiert eine explizit übergebene Höchstlänge', () => {
    expect(truncateGuestText('Rosemarie', 4)).toBe('Rose…');
  });
});

describe('isSuggestionFieldSet', () => {
  it('behandelt einen leeren Text als nicht gesetzt', () => {
    expect(isSuggestionFieldSet(suggestion({ born_on: '' }), 'born_on')).toBe(false);
    expect(isSuggestionFieldSet(suggestion({ born_on: '   ' }), 'born_on')).toBe(false);
  });

  it('behandelt einen ausgefüllten Text als gesetzt', () => {
    expect(isSuggestionFieldSet(suggestion({ born_on: '1980' }), 'born_on')).toBe(true);
  });

  it('behandelt "deceased" tri-state: NULL ist nicht gesetzt, 0 und 1 sind gesetzt', () => {
    expect(isSuggestionFieldSet(suggestion({ deceased: null }), 'deceased')).toBe(false);
    expect(isSuggestionFieldSet(suggestion({ deceased: 0 }), 'deceased')).toBe(true);
    expect(isSuggestionFieldSet(suggestion({ deceased: 1 }), 'deceased')).toBe(true);
  });

  it('behandelt "gender" ebenso tri-state', () => {
    expect(isSuggestionFieldSet(suggestion({ gender: null }), 'gender')).toBe(false);
    expect(isSuggestionFieldSet(suggestion({ gender: 'female' }), 'gender')).toBe(true);
  });
});

describe('changedFields', () => {
  it('ein Vorschlag, der nur born_on setzt, ergibt genau eine Zeile', () => {
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1', born_on: '1951' });
    const result = changedFields(s, relative());
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ feld: 'geboren am', bisher: '1950', vorgeschlagen: '1951' });
  });

  it('lässt Felder ohne Vorschlag komplett weg', () => {
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1', family_name: 'Neuermann' });
    const result = changedFields(s, relative());
    expect(result).toHaveLength(1);
    expect(result[0].feld).toBe('Nachname');
  });

  it('zeigt mehrere geänderte Felder in fester Reihenfolge', () => {
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1', born_on: '1951', deceased: 1 });
    const result = changedFields(s, relative());
    expect(result.map((r) => r.feld)).toEqual(['geboren am', 'Verstorben']);
    expect(result[1]).toEqual({ feld: 'Verstorben', bisher: 'Nein', vorgeschlagen: 'Ja' });
  });

  it('zeigt "(keine Angabe)" für ein bisher leeres Feld', () => {
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1', birth_name: 'Geboren' });
    const result = changedFields(s, relative({ birth_name: null }));
    expect(result[0]).toEqual({ feld: 'Geburtsname', bisher: '(keine Angabe)', vorgeschlagen: 'Geboren' });
  });

  it('ist leer, wenn der Vorschlag kein einziges Feld setzt', () => {
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1' });
    expect(changedFields(s, relative())).toEqual([]);
  });

  it('kürzt einen sehr langen vorgeschlagenen Wert', () => {
    const long = 'x'.repeat(MAX_SUGGESTION_TEXT_LENGTH + 20);
    const s = suggestion({ kind: 'edit', relative_id: 'rel-1', born_place: long });
    const result = changedFields(s, relative());
    expect(result[0].vorgeschlagen.length).toBe(MAX_SUGGESTION_TEXT_LENGTH + 1);
  });
});

describe('addedFields', () => {
  it('listet nur gesetzte Felder einer neuen Person', () => {
    const s = suggestion({ kind: 'add', given_name: 'Peter', born_on: '1960' });
    const result = addedFields(s);
    expect(result).toEqual([
      { feld: 'Vorname', wert: 'Peter' },
      { feld: 'geboren am', wert: '1960' },
    ]);
  });

  it('ist leer, wenn nichts gesetzt ist', () => {
    expect(addedFields(suggestion({ kind: 'add' }))).toEqual([]);
  });
});

describe('describeSuggestionKind', () => {
  it('übersetzt jede Art ins Deutsche', () => {
    expect(describeSuggestionKind('add')).toBe('Neue Person');
    expect(describeSuggestionKind('edit')).toBe('Änderung');
    expect(describeSuggestionKind('note')).toBe('Notiz');
  });
});

describe('describeSuggestion', () => {
  it('nennt Vor- und Nachname bei "add"', () => {
    expect(describeSuggestion(suggestion({ kind: 'add', given_name: 'Peter', family_name: 'Muster' }))).toBe(
      'Neue Person: Peter Muster',
    );
  });

  it('fällt bei "add" ohne Namen auf einen generischen Text zurück', () => {
    expect(describeSuggestion(suggestion({ kind: 'add' }))).toBe('Neue Person vorgeschlagen');
  });

  it('bleibt bei "edit" bewusst generisch', () => {
    expect(describeSuggestion(suggestion({ kind: 'edit', relative_id: 'rel-1' }))).toBe('Änderung vorgeschlagen');
  });

  it('zeigt bei "note" den (gekürzten) Text', () => {
    expect(describeSuggestion(suggestion({ kind: 'note', message: 'Sie hieß eigentlich Rosalinde.' }))).toBe(
      'Sie hieß eigentlich Rosalinde.',
    );
  });

  it('fällt bei "note" ohne Text auf einen generischen Text zurück', () => {
    expect(describeSuggestion(suggestion({ kind: 'note', message: null }))).toBe('Notiz ohne Text');
  });
});
