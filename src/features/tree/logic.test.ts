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
  relationLevel,
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
 * The exact live constellation from the two bug reports. Fehler 2 (first
 * report, 22.08.2026): Carolin Fuchs used to render under "Eltern" because
 * the old generation-number grouping put her at the same NUMBER as
 * Marina's actual parents. Fehler (second report, 23.08.2026): the
 * two-step rule set that replaced it still couldn't name a great-aunt, a
 * cousin's child, or an in-law, so they all fell into "Weitere
 * Verwandte" — every person below is a real person from THAT report,
 * mirroring its own test list one-for-one.
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
  relative('carolin', 'Carolin Fuchs', {
    mother_id: 'barbara',
    father_id: 'ernest',
    gender: 'female',
    partnerIds: ['andreas-f'],
  }),
  relative('andreas-f', 'Andreas Fuchs', { gender: 'male', partnerIds: ['carolin'] }),
  relative('mia', 'Mia Fuchs', { mother_id: 'carolin', father_id: 'andreas-f', gender: 'female' }),
  relative('bettina', 'Bettina Schilling', { mother_id: 'ingrid', father_id: 'rudolf', gender: 'female' }),
  // Rudolf/Ingrid/Barbara deliberately have NO gender set — none of the
  // task's tests need one from them, and leaving it unset keeps the
  // "never guess from the name" rule (step 6) honest for names that
  // don't obviously read as one gender or the other.
  relative('rudolf', 'Rudolf'),
  relative('ingrid', 'Ingrid', { mother_id: 'gerlinde' }),
  relative('barbara', 'Barbara', { mother_id: 'josefa', father_id: 'joseph' }),
  relative('ernest', 'Ernest', { gender: 'male' }),
  relative('jimmy', 'Jimmy Stalter'),
  // The second bug report's own constellation:
  relative('rosi', 'Rosi Lang', { mother_id: 'josefa', father_id: 'joseph', gender: 'female', partnerIds: ['anton'] }),
  relative('anton', 'Anton Lang', { gender: 'male', partnerIds: ['rosi'] }),
  relative('jutta', 'Jutta Fink', { mother_id: 'gerlinde', gender: 'female', partnerIds: ['herbert'] }),
  relative('herbert', 'Herbert Fink', { gender: 'male', partnerIds: ['jutta'] }),
  relative('valentin', 'Valentin Fink', { mother_id: 'jutta', father_id: 'herbert', gender: 'male' }),
  relative('alexander', 'Alexander Schilling', {
    mother_id: 'ingrid',
    father_id: 'rudolf',
    gender: 'male',
    partnerIds: ['jasmin'],
  }),
  relative('jasmin', 'Jasmin Schilling', { gender: 'female', partnerIds: ['alexander'] }),
  relative('emma', 'Emma Schilling', { mother_id: 'jasmin', father_id: 'alexander', gender: 'female' }),
  relative('lisa', 'Lisa Schilling', { mother_id: 'jasmin', father_id: 'alexander', gender: 'female' }),
  relative('christian', 'Christian Lang', { mother_id: 'barbara', father_id: 'ernest', gender: 'male' }),
  relative('gerlinde', 'Gerlinde Seichter', { gender: 'female' }),
  // Josefa/Joseph are DELIBERATELY left without a gender, even though
  // their names read as clearly female/male — step 6 forbids guessing
  // from the name, and this pair is the test that actually catches a
  // violation of that rule.
  relative('josefa', 'Josefa Lang'),
  relative('joseph', 'Joseph Lang'),
];

describe('relationLabel — genealogisch: gemeinsamer Vorfahre plus zwei Abstände', () => {
  const label = (id: string) => relationLabel(FAMILY.find((p) => p.id === id) as RelationGraphPerson, FAMILY, 'marina');

  it('nennt die Wurzel selbst, mit dem echten Namen — nie ein Platzhalter', () => {
    expect(label('marina')).toBe('Marina selbst');
  });

  it('erkennt Mutter und Vater', () => {
    expect(label('tamara')).toBe('Mutter/Vater'); // Tamaras gender ist in dieser Fixture nicht gesetzt
    expect(relationLabel({ ...FAMILY.find((p) => p.id === 'tamara')!, gender: 'female' }, FAMILY, 'marina')).toBe(
      'Mutter',
    );
    expect(label('andreas-s')).toBe('Mutter/Vater');
  });

  it('erkennt eine Schwester eines Elternteils als Tante — NICHT als Eltern', () => {
    expect(label('carolin')).toBe('Tante');
  });

  it('erkennt den angeheirateten Partner einer Tante als Onkel (angeheiratet)', () => {
    expect(label('andreas-f')).toBe('Onkel (angeheiratet)');
  });

  /**
   * 2026-08-23, gegen die echten Daten gemeldet: die Bezeichnung eines
   * Angeheirateten muss die ROLLE des Partners übernehmen (Tante/Onkel,
   * Großtante/Großonkel, …), aber das Geschlechtswort richtet sich immer
   * nach dem GESCHLECHT DER PERSON SELBST — nicht dem des Partners. Ein
   * männlicher Partner einer Großtante ist "Großonkel (angeheiratet)",
   * nie "Großtante (angeheiratet)". Bereits so implementiert (relationLabel
   * übergibt an jeder Stelle `person.gender`, nie `xTie`s eigenes
   * Geschlecht) — diese drei Fälle sind die im Bericht genannten Personen,
   * als dauerhafte Regressionssicherung.
   */
  it('Herbert Fink (Partner der Großtante Jutta) ist Großonkel, nicht Großtante', () => {
    expect(label('herbert')).toBe('Großonkel (angeheiratet)');
  });

  it('Anton Lang (Partner der Großtante Rosi) ist Großonkel, nicht Großtante', () => {
    expect(label('anton')).toBe('Großonkel (angeheiratet)');
  });

  it('Jasmin Schilling (Partnerin des Onkels Alexander) ist Tante, nicht Onkel', () => {
    expect(label('jasmin')).toBe('Tante (angeheiratet)');
  });

  it('erkennt das Kind einer Tante als Cousine 1. Grades', () => {
    expect(label('mia')).toBe('Cousine 1. Grades');
  });

  it('erkennt eine zweite Tante über die andere Elternseite', () => {
    expect(label('bettina')).toBe('Tante');
  });

  it('erkennt Großeltern als Großmutter/Großvater — neutrale Paarform ohne gesetztes Geschlecht', () => {
    expect(label('rudolf')).toBe('Großmutter/Großvater');
    expect(label('ingrid')).toBe('Großmutter/Großvater');
    expect(label('barbara')).toBe('Großmutter/Großvater');
  });

  it('erkennt eine Person ganz ohne Verknüpfung als noch nicht verbunden', () => {
    expect(label('jimmy')).toBe('Noch nicht verbunden');
  });

  it('fällt auf die neutrale Sammelbezeichnung zurück, wenn das Geschlecht nicht gesetzt ist', () => {
    const unknownAunt = relative('unknown-aunt', 'X', { mother_id: 'barbara', father_id: 'ernest' });
    const withUnknown = [...FAMILY, unknownAunt];
    expect(relationLabel(unknownAunt, withUnknown, 'marina')).toBe('Tante/Onkel');
  });

  it('erkennt Geschwister — teilen mindestens einen Elternteil mit der Wurzel', () => {
    const sibling = relative('sibling', 'Geschwisterkind', { mother_id: 'tamara', father_id: 'andreas-s' });
    const withSibling = [...FAMILY, sibling];
    expect(relationLabel(sibling, withSibling, 'marina')).toBe('Schwester/Bruder');
  });

  it('erkennt eine Nichte/einen Neffen (a=1,b=2)', () => {
    const niece = relative('niece', 'Nichte', { mother_id: 'sibling-of-marina', gender: 'female' });
    const sibling = relative('sibling-of-marina', 'Geschwister', { mother_id: 'tamara', father_id: 'andreas-s' });
    const withNiece = [...FAMILY, sibling, niece];
    expect(relationLabel(niece, withNiece, 'marina')).toBe('Nichte');
  });

  it('erkennt eine Großnichte/einen Großneffen (a=1,b=3)', () => {
    const grandNiece = relative('grand-niece', 'Großnichte', { mother_id: 'niece', gender: 'female' });
    const niece = relative('niece', 'Nichte', { mother_id: 'sibling-of-marina' });
    const sibling = relative('sibling-of-marina', 'Geschwister', { mother_id: 'tamara', father_id: 'andreas-s' });
    const withGrandNiece = [...FAMILY, sibling, niece, grandNiece];
    expect(relationLabel(grandNiece, withGrandNiece, 'marina')).toBe('Großnichte');
  });

  it('erkennt den Partner eines Geschwisterteils als Schwägerin/Schwager, nicht "Geschwister (angeheiratet)"', () => {
    const sibling = relative('sibling-in-law-test', 'Geschwister', {
      mother_id: 'tamara',
      father_id: 'andreas-s',
      partnerIds: ['sibling-partner'],
    });
    const siblingPartner = relative('sibling-partner', 'Angeheiratet', { gender: 'male', partnerIds: ['sibling-in-law-test'] });
    const withInLaw = [...FAMILY, sibling, siblingPartner];
    expect(relationLabel(siblingPartner, withInLaw, 'marina')).toBe('Schwager');
  });

  it('erkennt den Partner eines Kindes der Wurzel als Schwiegertochter/Schwiegersohn', () => {
    const child = relative('child-of-marina', 'Kind', { mother_id: 'marina', partnerIds: ['child-partner'] });
    const childPartner = relative('child-partner', 'Angeheiratet', { gender: 'female', partnerIds: ['child-of-marina'] });
    const withChild = [...FAMILY, child, childPartner];
    expect(relationLabel(childPartner, withChild, 'marina')).toBe('Schwiegertochter');
  });

  it('erkennt ein Elternteil des eigenen Partners als Schwiegermutter/Schwiegervater', () => {
    const partner = relative('marinas-partner', 'Partner', { partnerIds: ['marina'] });
    const marinaWithPartner = { ...FAMILY[0], partnerIds: ['marinas-partner'] };
    const partnerParent = relative('partner-parent', 'Schwiegerelternteil', { gender: 'female' });
    const partnerWithParent = { ...partner, mother_id: 'partner-parent' };
    const withInLawParent = [...FAMILY.slice(1), marinaWithPartner, partnerWithParent, partnerParent];
    expect(relationLabel(partnerParent, withInLawParent, 'marina')).toBe('Schwiegermutter');
  });

  it('erkennt Urgroßeltern (Abstand 3) und Ururgroßeltern (Abstand 4)', () => {
    const greatGrandparent = relative('urgross', 'Urgroß', { gender: 'male' });
    const withUrgross = FAMILY.map((p) => (p.id === 'rudolf' ? { ...p, mother_id: 'urgross' } : p)).concat(
      greatGrandparent,
    );
    // root -> andreas-s(1) -> rudolf(2) -> urgross(3)
    expect(relationLabel(greatGrandparent, withUrgross, 'marina')).toBe('Urgroßvater');

    const evenFurther = relative('ururgross', 'Ururgroß');
    const withEvenFurther = withUrgross
      .map((p) => (p.id === 'urgross' ? { ...p, mother_id: 'ururgross' } : p))
      .concat(evenFurther);
    // root -> andreas-s(1) -> rudolf(2) -> urgross(3) -> ururgross(4)
    expect(relationLabel(evenFurther, withEvenFurther, 'marina')).toBe('Ururgroßmutter/Ururgroßvater');
  });

  it('fällt auf "Vorfahre der N. Generation" zurück, sobald der Abstand über Ururgroßeltern hinausgeht', () => {
    // Jede Person bekommt ihre EIGENE mother_id auf die nächstältere Person
    // gesetzt (nicht umgekehrt!) — sonst zeigt die Kette nach unten statt
    // nach oben und trifft eine ganz andere (viel nähere) Verwandtschaft.
    const level5 = relative('level5', 'Ebene 5');
    const ururgross = relative('ururgross', 'Ururgroß', { mother_id: 'level5' });
    const urgross = relative('urgross', 'Urgroß', { mother_id: 'ururgross' });
    const withChain = FAMILY.map((p) => (p.id === 'rudolf' ? { ...p, mother_id: 'urgross' } : p)).concat(
      urgross,
      ururgross,
      level5,
    );
    // root -> andreas-s(1) -> rudolf(2) -> urgross(3) -> ururgross(4) -> level5(5)
    expect(relationLabel(level5, withChain, 'marina')).toBe('Vorfahre der 3. Generation');
  });

  it('wendet die allgemeine Cousin-Formel an, wenn keines der neun benannten Paare passt (Valentin Fink, a=3,b=2)', () => {
    expect(relationLabel(FAMILY.find((p) => p.id === 'valentin')!, FAMILY, 'marina')).toBe(
      'Cousin 1. Grades, einmal entfernt',
    );
  });

  it('schreibt "zweimal entfernt" für zwei Grade Entfernung — die deutsche Form, nicht "2-fach"', () => {
    // Vier Generationen unter Barbara aufgebaut, damit b=4 wird — a (Wurzel
    // -> Tamara -> Barbara) ist bereits 2, also (a=2, b=4): degree=1, removed=2.
    const gen1 = relative('cousin-gen1', 'G1', { mother_id: 'barbara' });
    const gen2 = relative('cousin-gen2', 'G2', { mother_id: 'cousin-gen1' });
    const gen3 = relative('cousin-gen3', 'G3', { mother_id: 'cousin-gen2' });
    const gen4 = relative('cousin-gen4', 'G4', { mother_id: 'cousin-gen3', gender: 'male' });
    const withChain = [...FAMILY, gen1, gen2, gen3, gen4];
    expect(relationLabel(gen4, withChain, 'marina')).toBe('Cousin 1. Grades, zweimal entfernt');
  });

  it('schreibt "dreifach entfernt" ab drei Graden Entfernung — die Adjektivform, nicht "einmal"/"zweimal" weitergezählt', () => {
    // Fünf Generationen unter Barbara: a=2, b=5 => degree=1, removed=3.
    const gen1 = relative('far-gen1', 'F1', { mother_id: 'barbara' });
    const gen2 = relative('far-gen2', 'F2', { mother_id: 'far-gen1' });
    const gen3 = relative('far-gen3', 'F3', { mother_id: 'far-gen2' });
    const gen4 = relative('far-gen4', 'F4', { mother_id: 'far-gen3' });
    const gen5 = relative('far-gen5', 'F5', { mother_id: 'far-gen4', gender: 'female' });
    const withChain = [...FAMILY, gen1, gen2, gen3, gen4, gen5];
    expect(relationLabel(gen5, withChain, 'marina')).toBe('Cousine 1. Grades, dreifach entfernt');
  });

  it('fällt auf "Weitere Verwandte" zurück, wenn wirklich keine Regel greift (kein gemeinsamer Vorfahre, keine Heirat)', () => {
    const isolatedPartner = relative('isolated-partner', 'Isoliert', { partnerIds: ['isolated-root'] });
    const isolatedRoot = relative('isolated-root', 'Isolierte Wurzel', { partnerIds: ['isolated-partner'] });
    const anotherIsolated = relative('another-isolated', 'Noch einer', { mother_id: 'isolated-root' });
    const withIsolated = [...FAMILY, isolatedPartner, isolatedRoot, anotherIsolated];
    // anotherIsolated ist mit isolatedRoot verbunden, aber isolatedRoot hat
    // selbst KEINE Blutsverwandtschaft zu Marina — anotherIsolated bleibt
    // also unbenennbar, fällt aber NICHT unter "Noch nicht verbunden" (hat ja
    // eine mother_id).
    expect(relationLabel(anotherIsolated, withIsolated, 'marina')).toBe('Weitere Verwandte');
  });
});

describe('relationLevel — Zeilen für die grafische Baumansicht (features/tree/layout.ts)', () => {
  const level = (id: string) => relationLevel(FAMILY.find((p) => p.id === id) as RelationGraphPerson, FAMILY, 'marina');

  it('Marina selbst ist Reihe 0', () => {
    expect(level('marina')).toBe(0);
  });

  it('Eltern sind Reihe 1', () => {
    expect(level('tamara')).toBe(1);
    expect(level('andreas-s')).toBe(1);
  });

  it('Großeltern sind Reihe 2', () => {
    expect(level('rudolf')).toBe(2);
    expect(level('ingrid')).toBe(2);
    expect(level('barbara')).toBe(2);
  });

  it('Urgroßeltern sind Reihe 3', () => {
    expect(level('gerlinde')).toBe(3);
    expect(level('josefa')).toBe(3);
  });

  it('Cousins bleiben auf Marinas eigener Reihe (0)', () => {
    expect(level('mia')).toBe(0);
  });

  it('Tanten und Onkel sind Reihe 1, wie die Eltern', () => {
    expect(level('carolin')).toBe(1);
    expect(level('bettina')).toBe(1);
    expect(level('alexander')).toBe(1);
  });

  it('Großtanten und Großonkel sind Reihe 2, wie die Großeltern', () => {
    expect(level('rosi')).toBe(2);
    expect(level('jutta')).toBe(2);
  });

  it('ein Angeheirateter sitzt in derselben Reihe wie der/die Blutsverwandte', () => {
    expect(level('andreas-f')).toBe(level('carolin')); // Onkel (angeheiratet) — Reihe 1, wie Tante Carolin
    expect(level('anton')).toBe(level('rosi')); // Großonkel (angeheiratet) — Reihe 2, wie Großtante Rosi
  });

  it('ein Cousin einmal entfernt (Valentin Fink) sitzt eine Reihe über Marina, wie seine Mutter Jutta', () => {
    expect(level('valentin')).toBe(1);
  });

  it('eine Person ganz ohne Verknüpfung hat keine Reihe', () => {
    expect(level('jimmy')).toBeNull();
  });

  it('eine Person, die nur mit einer unverbundenen Person verbunden ist, hat ebenfalls keine Reihe', () => {
    const isolatedPartner = relative('level-isolated-partner', 'Isoliert', { partnerIds: ['level-isolated-root'] });
    const isolatedRoot = relative('level-isolated-root', 'Isolierte Wurzel', { partnerIds: ['level-isolated-partner'] });
    const anotherIsolated = relative('level-another-isolated', 'Noch einer', { mother_id: 'level-isolated-root' });
    const withIsolated = [...FAMILY, isolatedPartner, isolatedRoot, anotherIsolated];
    expect(relationLevel(anotherIsolated, withIsolated, 'marina')).toBeNull();
  });

  it('eine Nichte sitzt eine Reihe unter Marina', () => {
    const niece = relative('level-niece', 'Nichte', { mother_id: 'level-sibling' });
    const sibling = relative('level-sibling', 'Geschwister', { mother_id: 'tamara', father_id: 'andreas-s' });
    const withNiece = [...FAMILY, sibling, niece];
    expect(relationLevel(niece, withNiece, 'marina')).toBe(-1);
  });
});

describe('groupForList — die reale Konstellation aus dem zweiten Fehlerbericht', () => {
  it('gruppiert nach Verwandtschaft, in der vorgegebenen Reihenfolge, mit dem echten Wurzelnamen', () => {
    const groups = groupForList(FAMILY, 'marina');
    expect(groups.map((g) => g.label)).toEqual([
      'Marina selbst',
      'Eltern',
      'Großeltern',
      'Urgroßeltern',
      'Tanten und Onkel',
      'Cousins und Cousinen',
      'Grosstanten und Grossonkel',
      'Noch nicht verbunden',
    ]);
  });

  it('steckt Carolin unter "Tanten und Onkel", nicht unter "Eltern"', () => {
    const groups = groupForList(FAMILY, 'marina');
    const auntUncle = groups.find((g) => g.label === 'Tanten und Onkel');
    expect(auntUncle?.people.map((p) => p.id)).toContain('carolin');
    const parents = groups.find((g) => g.label === 'Eltern');
    expect(parents?.people.map((p) => p.id)).not.toContain('carolin');
  });

  it('"Weitere Verwandte" ist bei den echten Daten leer — jede der genannten Personen bekommt eine echte Gruppe', () => {
    const groups = groupForList(FAMILY, 'marina');
    expect(groups.find((g) => g.label === 'Weitere Verwandte')).toBeUndefined();

    const expectedGroupByName: Record<string, string> = {
      rosi: 'Grosstanten und Grossonkel',
      anton: 'Grosstanten und Grossonkel',
      jutta: 'Grosstanten und Grossonkel',
      herbert: 'Grosstanten und Grossonkel',
      valentin: 'Cousins und Cousinen',
      emma: 'Cousins und Cousinen',
      lisa: 'Cousins und Cousinen',
      alexander: 'Tanten und Onkel',
      jasmin: 'Tanten und Onkel',
      christian: 'Tanten und Onkel',
      gerlinde: 'Urgroßeltern',
      josefa: 'Urgroßeltern',
      joseph: 'Urgroßeltern',
      mia: 'Cousins und Cousinen',
    };
    for (const [id, expectedGroup] of Object.entries(expectedGroupByName)) {
      const group = groups.find((g) => g.people.some((p) => p.id === id));
      expect(group?.label, `${id} sollte in "${expectedGroup}" stehen`).toBe(expectedGroup);
    }
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
