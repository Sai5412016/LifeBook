import { describe, expect, it } from 'vitest';

import {
  computeGenerations,
  describeGender,
  displayName,
  excludeSelf,
  formatGermanDate,
  groupForList,
  lifeLine,
  partnerIdFromUnion,
  type FamilyGraphPerson,
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

function graph(entries: FamilyGraphPerson[]): FamilyGraphPerson[] {
  return entries;
}

describe('computeGenerations', () => {
  it('places parents at -1, grandparents at -2, children at +1', () => {
    const people = graph([
      { id: 'child', motherId: 'mother', fatherId: 'father', partnerIds: [] },
      { id: 'mother', motherId: 'grandma', fatherId: null, partnerIds: [] },
      { id: 'father', motherId: null, fatherId: null, partnerIds: [] },
      { id: 'grandma', motherId: null, fatherId: null, partnerIds: [] },
      { id: 'grandchild', motherId: 'child', fatherId: null, partnerIds: [] },
    ]);
    const levels = computeGenerations(people, 'child');
    expect(levels.get('child')).toBe(0);
    expect(levels.get('mother')).toBe(-1);
    expect(levels.get('father')).toBe(-1);
    expect(levels.get('grandma')).toBe(-2);
    expect(levels.get('grandchild')).toBe(1);
  });

  it('puts a partner at the same level as their partner', () => {
    const people = graph([
      { id: 'root', motherId: null, fatherId: null, partnerIds: ['partner'] },
      { id: 'partner', motherId: null, fatherId: null, partnerIds: ['root'] },
    ]);
    const levels = computeGenerations(people, 'root');
    expect(levels.get('partner')).toBe(0);
  });

  it('never revisits an id, so a circular mother/child reference cannot loop forever', () => {
    // A data error: 'a' is 'b's mother, and 'b' is ALSO 'a's mother.
    const people = graph([
      { id: 'a', motherId: 'b', fatherId: null, partnerIds: [] },
      { id: 'b', motherId: 'a', fatherId: null, partnerIds: [] },
    ]);
    const levels = computeGenerations(people, 'a');
    expect(levels.size).toBe(2);
    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(-1);
  });

  it('returns an empty map when the root id is unknown', () => {
    const people = graph([{ id: 'a', motherId: null, fatherId: null, partnerIds: [] }]);
    expect(computeGenerations(people, 'missing').size).toBe(0);
  });

  it('ignores a dangling reference to an id that does not exist in the list', () => {
    const people = graph([{ id: 'a', motherId: 'ghost', fatherId: null, partnerIds: [] }]);
    const levels = computeGenerations(people, 'a');
    expect(levels.has('ghost')).toBe(false);
    expect(levels.size).toBe(1);
  });
});

describe('groupForList', () => {
  const people = [
    { id: 'root' },
    { id: 'mother' },
    { id: 'grandma' },
    { id: 'greatgrandma' },
    { id: 'sibling-of-greatgrandma' },
    { id: 'stray' },
  ];
  const generations = new Map<string, number>([
    ['root', 0],
    ['mother', -1],
    ['grandma', -2],
    ['greatgrandma', -3],
    ['sibling-of-greatgrandma', -4],
  ]);

  it('labels the root group with the given root label', () => {
    const groups = groupForList(people, generations, 'Marina');
    expect(groups[0]).toEqual({ label: 'Marina', people: [{ id: 'root' }] });
  });

  it('buckets -1/-2/-3 into Eltern/Großeltern/Urgroßeltern', () => {
    const groups = groupForList(people, generations, 'Marina');
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.people.map((p) => p.id)]));
    expect(byLabel['Eltern']).toEqual(['mother']);
    expect(byLabel['Großeltern']).toEqual(['grandma']);
    expect(byLabel['Urgroßeltern']).toEqual(['greatgrandma']);
  });

  it('puts anything beyond -3 into Weitere', () => {
    const groups = groupForList(people, generations, 'Marina');
    const weitere = groups.find((g) => g.label === 'Weitere');
    expect(weitere?.people.map((p) => p.id)).toEqual(['sibling-of-greatgrandma']);
  });

  it('puts anyone with no generation entry into Nicht verbunden', () => {
    const groups = groupForList(people, generations, 'Marina');
    const unconnected = groups.find((g) => g.label === 'Nicht verbunden');
    expect(unconnected?.people.map((p) => p.id)).toEqual(['stray']);
  });

  it('drops empty groups entirely', () => {
    const groups = groupForList([{ id: 'root' }], new Map([['root', 0]]), 'Marina');
    expect(groups.map((g) => g.label)).toEqual(['Marina']);
  });
});
