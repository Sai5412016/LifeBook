import { describe, expect, it } from 'vitest';

import {
  computeConnectors,
  layoutTree,
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
