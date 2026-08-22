import { describe, expect, it } from 'vitest';

import {
  describeGender,
  displayName,
  excludeSelf,
  formatGermanDate,
  groupForList,
  lifeLine,
  partnerIdFromUnion,
  relationLabel,
  type RelationGraphPerson,
} from './logic';

describe('displayName', () => {
  it('joins given and family name', () => {
    expect(displayName({ given_name: 'Anna', family_name: 'Schmidt', birth_name: null })).toBe('Anna Schmidt');
  });

  it('shows the birth name in parentheses when it differs from the family name', () => {
    expect(displayName({ given_name: 'Anna', family_name: 'Müller', birth_name: 'Schmidt' })).toBe(
      'Anna Müller (geb. Schmidt)',
    );
  });

  it('hides the birth name when it matches the family name', () => {
    expect(displayName({ given_name: 'Anna', family_name: 'Schmidt', birth_name: 'Schmidt' })).toBe('Anna Schmidt');
  });

  it('works with no family name at all', () => {
    expect(displayName({ given_name: 'Anna', family_name: null, birth_name: null })).toBe('Anna');
  });

  it('shows the birth name even with no family name, if known', () => {
    expect(displayName({ given_name: 'Anna', family_name: null, birth_name: 'Schmidt' })).toBe(
      'Anna (geb. Schmidt)',
    );
  });
});

describe('lifeLine', () => {
  it('shows born – died when both are known', () => {
    expect(lifeLine({ born_on: '1923', died_on: '1998', deceased: 1 })).toBe('1923 – 1998');
  });

  it('shows "geb." when only the birth is known and not deceased', () => {
    expect(lifeLine({ born_on: '1923', died_on: null, deceased: 0 })).toBe('geb. 1923');
  });

  it('shows born – verstorben when deceased but no death date is known', () => {
    expect(lifeLine({ born_on: '1923', died_on: null, deceased: 1 })).toBe('1923 – verstorben');
  });

  it('returns an empty string when nothing is known', () => {
    expect(lifeLine({ born_on: null, died_on: null, deceased: 0 })).toBe('');
  });

  it('falls back to "verstorben" alone when marked deceased with no dates at all', () => {
    expect(lifeLine({ born_on: null, died_on: null, deceased: 1 })).toBe('verstorben');
  });

  it('accepts a boolean deceased flag, not just 0/1', () => {
    expect(lifeLine({ born_on: '1923', died_on: null, deceased: true })).toBe('1923 – verstorben');
  });
});

describe('describeGender / formatGermanDate', () => {
  it('labels each gender in German', () => {
    expect(describeGender('female')).toBe('Weiblich');
    expect(describeGender('male')).toBe('Männlich');
    expect(describeGender('other')).toBe('Divers');
  });

  it('returns an empty string for no gender given', () => {
    expect(describeGender(null)).toBe('');
  });

  it('formats a local date as DD.MM.YYYY', () => {
    expect(formatGermanDate('2024-03-05')).toBe('05.03.2024');
  });
});

describe('partnerIdFromUnion', () => {
  it('returns b_id when queried from a_id', () => {
    expect(partnerIdFromUnion({ a_id: 'x', b_id: 'y' }, 'x')).toBe('y');
  });

  it('returns a_id when queried from b_id', () => {
    expect(partnerIdFromUnion({ a_id: 'x', b_id: 'y' }, 'y')).toBe('x');
  });
});

describe('excludeSelf', () => {
  const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('removes the given id', () => {
    expect(excludeSelf(people, 'b').map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('returns everyone when selfId is null (create mode, nothing to exclude yet)', () => {
    expect(excludeSelf(people, null).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

/**
 * The exact live constellation from the bug report (Fehler 2): Carolin
 * Fuchs, Barbara Lang's/Ernest Schlag's daughter and Tamara's sister, used
 * to render under "Eltern" because the old generation-number grouping put
 * her at the same NUMBER as Marina's actual parents. Every person below
 * mirrors the task's own test list one-for-one.
 */
function relative(
  id: string,
  given_name: string,
  overrides: Partial<Omit<RelationGraphPerson, 'id' | 'given_name'>> = {},
): RelationGraphPerson {
  return {
    id,
    given_name,
    gender: null,
    mother_id: null,
    father_id: null,
    partnerIds: [],
    ...overrides,
  };
}

const FAMILY = [
  relative('marina', 'Marina', { mother_id: 'tamara', father_id: 'andreas-s' }),
  relative('andreas-s', 'Andreas Schilling', { mother_id: 'ingrid', father_id: 'rudolf' }),
  relative('tamara', 'Tamara Lang', { mother_id: 'barbara', father_id: 'ernest' }),
  relative('carolin', 'Carolin Fuchs', { mother_id: 'barbara', father_id: 'ernest', gender: 'female', partnerIds: ['andreas-f'] }),
  relative('andreas-f', 'Andreas Fuchs', { gender: 'male', partnerIds: ['carolin'] }),
  relative('mia', 'Mia Fuchs', { mother_id: 'carolin', father_id: 'andreas-f', gender: 'female' }),
  relative('bettina', 'Bettina Schilling', { mother_id: 'ingrid', father_id: 'rudolf', gender: 'female' }),
  relative('rudolf', 'Rudolf'),
  relative('ingrid', 'Ingrid'),
  relative('barbara', 'Barbara'),
  relative('ernest', 'Ernest'),
  relative('jimmy', 'Jimmy Stalter'),
];

describe('relationLabel — die echte Konstellation aus dem Fehlerbericht', () => {
  const label = (id: string) => relationLabel(FAMILY.find((p) => p.id === id) as RelationGraphPerson, FAMILY, 'marina');

  it('nennt die Wurzel selbst, mit dem echten Namen — nie ein Platzhalter', () => {
    expect(label('marina')).toBe('Marina selbst');
  });

  it('erkennt Mutter und Vater als Eltern', () => {
    expect(label('tamara')).toBe('Eltern');
    expect(label('andreas-s')).toBe('Eltern');
  });

  it('erkennt eine Schwester eines Elternteils als Tante — NICHT als Eltern (Fehler 2)', () => {
    expect(label('carolin')).toBe('Tante');
  });

  it('erkennt den angeheirateten Partner einer Tante als Onkel', () => {
    expect(label('andreas-f')).toBe('Onkel');
  });

  it('erkennt das Kind einer Tante als Cousine', () => {
    expect(label('mia')).toBe('Cousine');
  });

  it('erkennt eine zweite Tante über die andere Elternseite', () => {
    expect(label('bettina')).toBe('Tante');
  });

  it('erkennt die Eltern der Eltern als Großeltern, unabhängig vom Geschlecht', () => {
    expect(label('rudolf')).toBe('Großeltern');
    expect(label('ingrid')).toBe('Großeltern');
    expect(label('barbara')).toBe('Großeltern');
    expect(label('ernest')).toBe('Großeltern');
  });

  it('erkennt eine Person ganz ohne Verknüpfung als noch nicht verbunden', () => {
    expect(label('jimmy')).toBe('Noch nicht verbunden');
  });

  it('fällt auf die neutrale Sammelbezeichnung zurück, wenn das Geschlecht nicht gesetzt ist', () => {
    const unknownAunt = relative('unknown-aunt', 'X', { mother_id: 'barbara', father_id: 'ernest' });
    const withUnknown = [...FAMILY, unknownAunt];
    expect(relationLabel(unknownAunt, withUnknown, 'marina')).toBe('Tanten und Onkel');
  });

  it('erkennt Geschwister — teilen mindestens einen Elternteil mit der Wurzel', () => {
    const sibling = relative('sibling', 'Geschwisterkind', { mother_id: 'tamara', father_id: 'andreas-s' });
    const withSibling = [...FAMILY, sibling];
    expect(relationLabel(sibling, withSibling, 'marina')).toBe('Geschwister');
  });

  it('erkennt Urgroßeltern', () => {
    const greatGrandparent = relative('urgross', 'Urgroß', {});
    const withUrgross = FAMILY.map((p) => (p.id === 'rudolf' ? { ...p, mother_id: 'urgross' } : p)).concat(
      greatGrandparent,
    );
    expect(relationLabel(greatGrandparent, withUrgross, 'marina')).toBe('Urgroßeltern');
  });

  it('fällt auf "Weitere Verwandte" zurück, wenn verbunden, aber keine Regel greift', () => {
    // Ein zweites Kind von Mia (Cousine) — eine Generation zu weit, um noch als Cousine/Cousin zu gelten.
    const distant = relative('distant', 'Weit weg', { mother_id: 'mia' });
    const withDistant = [...FAMILY, distant];
    expect(relationLabel(distant, withDistant, 'marina')).toBe('Weitere Verwandte');
  });
});

describe('groupForList', () => {
  it('gruppiert nach Verwandtschaft, in der vorgegebenen Reihenfolge, mit dem echten Wurzelnamen', () => {
    const groups = groupForList(FAMILY, 'marina');
    expect(groups.map((g) => g.label)).toEqual([
      'Marina selbst',
      'Eltern',
      'Großeltern',
      'Tanten und Onkel',
      'Cousins und Cousinen',
      'Noch nicht verbunden',
    ]);
  });

  it('steckt Carolin unter "Tanten und Onkel", nicht unter "Eltern" (Fehler 2)', () => {
    const groups = groupForList(FAMILY, 'marina');
    const auntUncle = groups.find((g) => g.label === 'Tanten und Onkel');
    expect(auntUncle?.people.map((p) => p.id)).toContain('carolin');
    const parents = groups.find((g) => g.label === 'Eltern');
    expect(parents?.people.map((p) => p.id)).not.toContain('carolin');
  });

  it('lässt "Noch nicht verbunden" nie jemanden verschwinden (Fehler 1)', () => {
    const groups = groupForList(FAMILY, 'marina');
    const unconnected = groups.find((g) => g.label === 'Noch nicht verbunden');
    expect(unconnected?.people.map((p) => p.id)).toEqual(['jimmy']);
  });

  it('Summe aller Gruppengrößen == Anzahl der Personen — Fehler 1 darf nicht zurückkehren', () => {
    const groups = groupForList(FAMILY, 'marina');
    const total = groups.reduce((sum, group) => sum + group.people.length, 0);
    expect(total).toBe(FAMILY.length);
  });

  it('hält diese Summe auch bei einer isolierten, unverbundenen Person', () => {
    const withStray = [...FAMILY, relative('stray', 'Allein')];
    const groups = groupForList(withStray, 'marina');
    const total = groups.reduce((sum, group) => sum + group.people.length, 0);
    expect(total).toBe(withStray.length);
  });

  it('lässt leere Gruppen weg', () => {
    const groups = groupForList([relative('marina', 'Marina')], 'marina');
    expect(groups.map((g) => g.label)).toEqual(['Marina selbst']);
  });
});
