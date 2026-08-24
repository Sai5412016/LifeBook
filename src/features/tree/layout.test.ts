import { describe, expect, it } from 'vitest';

import {
  computeConnectors,
  layoutTree,
  LEVEL_ROW_HEIGHT,
  NODE_SLOT_WIDTH,
  orderRow,
  type TreeLayoutPerson,
} from './layout';

function person(
  id: string,
  level: number,
  overrides: Partial<Omit<TreeLayoutPerson, 'id' | 'level'>> = {},
): TreeLayoutPerson {
  return { id, level, sort_index: 0, mother_id: null, father_id: null, partnerIds: [], ...overrides };
}

describe('orderRow', () => {
  it('orders unrelated people by sort_index', () => {
    const row = [
      person('c', 0, { sort_index: 2 }),
      person('a', 0, { sort_index: 0 }),
      person('b', 0, { sort_index: 1 }),
    ];
    expect(orderRow(row).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps siblings together even if their sort_index would otherwise interleave them with someone else', () => {
    const row = [
      person('sibling-a', 0, { sort_index: 0, mother_id: 'm' }),
      person('other', 0, { sort_index: 1 }),
      person('sibling-b', 0, { sort_index: 2, mother_id: 'm' }),
    ];
    const ordered = orderRow(row).map((p) => p.id);
    const indexA = ordered.indexOf('sibling-a');
    const indexB = ordered.indexOf('sibling-b');
    expect(Math.abs(indexA - indexB)).toBe(1);
  });

  it('places partners immediately next to each other', () => {
    const row = [
      person('a', 0, { sort_index: 0, partnerIds: ['b'] }),
      person('x', 0, { sort_index: 1 }),
      person('b', 0, { sort_index: 2, partnerIds: ['a'] }),
    ];
    const ordered = orderRow(row).map((p) => p.id);
    const indexA = ordered.indexOf('a');
    const indexB = ordered.indexOf('b');
    expect(Math.abs(indexA - indexB)).toBe(1);
  });

  it('only clusters siblings/partners actually present in this row', () => {
    const row = [person('a', 0, { sort_index: 0, partnerIds: ['not-in-row'] })];
    expect(orderRow(row).map((p) => p.id)).toEqual(['a']);
  });
});

describe('layoutTree', () => {
  it('never overlaps two people in the same row', () => {
    const people = [
      person('root', 0, { sort_index: 0, mother_id: 'p1', father_id: 'p2' }),
      person('p1', 1, { sort_index: 0 }),
      person('p2', 1, { sort_index: 1 }),
      person('aunt', 1, { sort_index: 2 }),
      person('uncle', 1, { sort_index: 3 }),
    ];
    const positions = layoutTree(people);
    const byRow = new Map<number, number[]>();
    for (const pos of positions) {
      const xs = byRow.get(pos.level) ?? [];
      xs.push(pos.x);
      byRow.set(pos.level, xs);
    }
    for (const xs of byRow.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(NODE_SLOT_WIDTH - 0.0001);
      }
    }
  });

  it('places a parent between their children, where possible', () => {
    const people = [
      person('parent', 1, { sort_index: 0 }),
      person('child-a', 0, { sort_index: 0, mother_id: 'parent' }),
      person('child-b', 0, { sort_index: 1, mother_id: 'parent' }),
      person('child-c', 0, { sort_index: 2, mother_id: 'parent' }),
    ];
    const positions = layoutTree(people);
    const byId = new Map(positions.map((p) => [p.id, p]));
    const childXs = ['child-a', 'child-b', 'child-c'].map((id) => byId.get(id)!.x);
    const parentX = byId.get('parent')!.x;
    expect(parentX).toBeGreaterThanOrEqual(Math.min(...childXs) - 0.0001);
    expect(parentX).toBeLessThanOrEqual(Math.max(...childXs) + 0.0001);
  });

  it('gives the same input the same output every time (deterministic)', () => {
    const people = [
      person('root', 0, { sort_index: 0, mother_id: 'p1', father_id: 'p2' }),
      person('p1', 1, { sort_index: 0, mother_id: 'gp1' }),
      person('p2', 1, { sort_index: 1 }),
      person('gp1', 2, { sort_index: 0 }),
      person('sibling', 0, { sort_index: 1, mother_id: 'p1', father_id: 'p2' }),
    ];
    const first = layoutTree(people);
    const second = layoutTree(people);
    expect(second).toEqual(first);
  });

  it('places Marina at the bottom row (highest y) when the tree spans several generations, oldest at the top (y=0)', () => {
    const people = [
      person('marina', 0, { sort_index: 0, mother_id: 'parent' }),
      person('parent', 1, { sort_index: 0, mother_id: 'grandparent' }),
      person('grandparent', 2, { sort_index: 0 }),
    ];
    const positions = layoutTree(people);
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get('grandparent')!.y).toBe(0);
    expect(byId.get('parent')!.y).toBeGreaterThan(byId.get('grandparent')!.y);
    expect(byId.get('marina')!.y).toBeGreaterThan(byId.get('parent')!.y);
  });

  it('does not loop forever on a circular mother_id/father_id reference', () => {
    // A data error: 'a' is 'b's mother, and 'b' is ALSO 'a's mother — both
    // on the same row, which is nonsensical, but the layout must still
    // terminate and return a position for both.
    const people = [
      person('a', 0, { sort_index: 0, mother_id: 'b' }),
      person('b', 0, { sort_index: 1, mother_id: 'a' }),
    ];
    const positions = layoutTree(people);
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('returns an empty array for no people', () => {
    expect(layoutTree([])).toEqual([]);
  });
});

/**
 * Fehler 24.08.2026: neu angelegte Eltern (Peter+Barbara, Eltern von
 * Rudolf) standen NICHT nebeneinander direkt über ihrem Kind — der alte
 * Algorithmus schob sie beim Überlappungs-Auflösen ans rechte Ende ihrer
 * Reihe (Neuanlagen haben den höchsten sort_index). Der Viewer ordnet
 * dieselbe Konstellation korrekt an; diese Tests halten die vier
 * Eigenschaften seines Verfahrens fest. Die Konstellation entspricht den
 * Live-Daten: Marina (Wurzel) → Vater → dessen Eltern Rudolf+Ingrid →
 * Rudolfs nachträglich ergänzte Eltern, mit den echten IDs aus dem
 * Fehlerbericht.
 */
describe('layoutTree — Ahnentafel-Anordnung (Fehler 24.08.2026)', () => {
  const RUDOLF = '7dbe0c41-fdfa-4066-8375-0b3f05fc4f63';
  const PETER = '01a0359f-159b-766e-a7a1-2f47d2741de0';
  const BARBARA = '01a035a0-0478-7467-b70c-038453ce2eaf';

  const family = (): TreeLayoutPerson[] => [
    person('marina', 0, { sort_index: 0, father_id: 'gerhard', mother_id: 'petra' }),
    person('gerhard', 1, { sort_index: 0, father_id: RUDOLF, mother_id: 'ingrid', partnerIds: ['petra'] }),
    person('petra', 1, { sort_index: 1, partnerIds: ['gerhard'] }),
    person(RUDOLF, 2, { sort_index: 0, father_id: PETER, mother_id: BARBARA, partnerIds: ['ingrid'] }),
    person('ingrid', 2, { sort_index: 1, partnerIds: [RUDOLF] }),
    // Nachträglich ergänzt: höchster sort_index, genau wie bei einer
    // Neuanlage über "Person hinzufügen" — der auslösende Fall.
    person(PETER, 3, { sort_index: 98, partnerIds: [BARBARA] }),
    person(BARBARA, 3, { sort_index: 99, partnerIds: [PETER] }),
  ];

  const positionsById = (people: TreeLayoutPerson[]) =>
    new Map(layoutTree(people, 'marina').map((p) => [p.id, p]));

  it('nachträglich ergänzte Eltern stehen nebeneinander direkt über ihrem Kind', () => {
    const byId = positionsById(family());
    const rudolf = byId.get(RUDOLF)!;
    const peter = byId.get(PETER)!;
    const barbara = byId.get(BARBARA)!;

    // Nebeneinander: beide sind Blätter der Ahnentafel, also exakt ein Slot.
    expect(Math.abs(peter.x - barbara.x)).toBeCloseTo(NODE_SLOT_WIDTH, 5);
    // Direkt über dem Kind: Rudolf sitzt EXAKT auf der Mitte der beiden.
    expect((peter.x + barbara.x) / 2).toBeCloseTo(rudolf.x, 5);
    // Eine Reihe darüber, beide in derselben Reihe.
    expect(peter.y).toBe(barbara.y);
    expect(rudolf.y - peter.y).toBe(LEVEL_ROW_HEIGHT);
  });

  it('jedes Kind mit beiden Eltern im Baum sitzt mittig unter ihnen, auf jeder Ebene', () => {
    const byId = positionsById(family());
    expect(byId.get('marina')!.x).toBeCloseTo((byId.get('gerhard')!.x + byId.get('petra')!.x) / 2, 5);
    expect(byId.get('gerhard')!.x).toBeCloseTo((byId.get(RUDOLF)!.x + byId.get('ingrid')!.x) / 2, 5);
    expect(byId.get(RUDOLF)!.x).toBeCloseTo((byId.get(PETER)!.x + byId.get(BARBARA)!.x) / 2, 5);
  });

  it('wer nicht zur Ahnentafel gehört, findet einen freien Platz NEBEN seinen Bezugspersonen', () => {
    // Tante (Schwester von Gerhard, gleiche Eltern) und ihr angeheirateter
    // Partner — beide keine Vorfahren von Marina.
    const people = [
      ...family(),
      person('tante', 1, { sort_index: 5, father_id: RUDOLF, mother_id: 'ingrid', partnerIds: ['onkel'] }),
      person('onkel', 1, { sort_index: 6, partnerIds: ['tante'] }),
    ];
    const byId = positionsById(people);
    const tante = byId.get('tante')!;
    const onkel = byId.get('onkel')!;
    const gerhard = byId.get('gerhard')!;

    // Der Partner rückt direkt neben die Tante (genau ein Slot).
    expect(Math.abs(onkel.x - tante.x)).toBeCloseTo(NODE_SLOT_WIDTH, 5);
    // Die Tante bleibt in der Nähe ihrer Eltern-Mitte, ohne Gerhard zu
    // überlappen — nie ans Reihenende verbannt wie beim alten Algorithmus.
    const parentsMidpoint = (byId.get(RUDOLF)!.x + byId.get('ingrid')!.x) / 2;
    expect(Math.abs(tante.x - parentsMidpoint)).toBeLessThanOrEqual(2 * NODE_SLOT_WIDTH + 1e-6);
    expect(Math.abs(tante.x - gerhard.x)).toBeGreaterThanOrEqual(NODE_SLOT_WIDTH - 1e-6);
  });

  it('niemand steht in der Lücke zwischen zwei Partnern', () => {
    const people = [
      ...family(),
      person('tante', 1, { sort_index: 5, father_id: RUDOLF, mother_id: 'ingrid', partnerIds: ['onkel'] }),
      person('onkel', 1, { sort_index: 6, partnerIds: ['tante'] }),
    ];
    const byId = positionsById(people);
    const pairs: [string, string][] = [
      ['gerhard', 'petra'],
      [RUDOLF, 'ingrid'],
      [PETER, BARBARA],
      ['tante', 'onkel'],
    ];
    for (const [a, b] of pairs) {
      const lo = Math.min(byId.get(a)!.x, byId.get(b)!.x);
      const hi = Math.max(byId.get(a)!.x, byId.get(b)!.x);
      const level = byId.get(a)!.level;
      for (const [id, pos] of byId) {
        if (id === a || id === b || pos.level !== level) {
          continue;
        }
        const insideGap = pos.x > lo + 1e-6 && pos.x < hi - 1e-6;
        expect(insideGap, `${id} steht in der Paarlücke ${a}–${b}`).toBe(false);
      }
    }
  });

  it('auch mit Nebenpersonen in der Reihe bleiben die Eltern exakt über dem Kind (der gemeldete Fall)', () => {
    // Weitere Personen in Peters/Barbaras Reihe mit NIEDRIGEREM sort_index
    // — beim alten Algorithmus schoben genau solche Reihennachbarn die
    // frisch angelegten Eltern nach rechts, weg von Rudolf.
    const people = [
      ...family(),
      person('ingrids-vater', 3, { sort_index: 0, partnerIds: ['ingrids-mutter'] }),
      person('ingrids-mutter', 3, { sort_index: 1, partnerIds: ['ingrids-vater'] }),
    ];
    // Ingrid bekommt ihre Eltern, damit die Reihe 3 wirklich gefüllt ist.
    const ingrid = people.find((p) => p.id === 'ingrid')!;
    (ingrid as { father_id: string | null }).father_id = 'ingrids-vater';
    (ingrid as { mother_id: string | null }).mother_id = 'ingrids-mutter';

    const byId = positionsById(people);
    expect((byId.get(PETER)!.x + byId.get(BARBARA)!.x) / 2).toBeCloseTo(byId.get(RUDOLF)!.x, 5);
    expect(Math.abs(byId.get(PETER)!.x - byId.get(BARBARA)!.x)).toBeCloseTo(NODE_SLOT_WIDTH, 5);
    // Und weiterhin: keine zwei Personen einer Reihe überlappen.
    const byRow = new Map<number, number[]>();
    for (const pos of byId.values()) {
      const xs = byRow.get(pos.level) ?? [];
      xs.push(pos.x);
      byRow.set(pos.level, xs);
    }
    for (const xs of byRow.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(NODE_SLOT_WIDTH - 0.0001);
      }
    }
  });
});

describe('computeConnectors', () => {
  it('produces three segments per child with a parent present in the layout', () => {
    const people = [
      person('parent', 1, { sort_index: 0 }),
      person('child', 0, { sort_index: 0, mother_id: 'parent' }),
    ];
    const positions = layoutTree(people);
    const segments = computeConnectors(positions, people);
    expect(segments).toHaveLength(3);
  });

  it('emits no segments for a child whose parent is not part of the layout', () => {
    const people = [person('lone-child', 0, { sort_index: 0, mother_id: 'not-in-tree' })];
    const positions = layoutTree(people);
    const segments = computeConnectors(positions, people);
    expect(segments).toHaveLength(0);
  });

  it('every segment has a non-negative, finite width and height', () => {
    const people = [
      person('mother', 1, { sort_index: 0 }),
      person('father', 1, { sort_index: 1 }),
      person('child', 0, { sort_index: 0, mother_id: 'mother', father_id: 'father' }),
    ];
    const positions = layoutTree(people);
    const segments = computeConnectors(positions, people);
    for (const segment of segments) {
      expect(segment.width).toBeGreaterThanOrEqual(0);
      expect(segment.height).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(segment.x)).toBe(true);
      expect(Number.isFinite(segment.y)).toBe(true);
    }
  });
});
