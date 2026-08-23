/**
 * tree/layout — pure geometry for the graphical "Baum" view: which row
 * each person sits in (via logic.ts#relationLevel), left-to-right order
 * within a row, horizontal position, and the rectangular connector-line
 * segments between parent and child. Deliberately free of any Expo /
 * React Native import so it runs in plain Node under Vitest — the actual
 * drawing lives in components/tree-view.tsx.
 *
 * Classic ancestor-chart layout ("Ahnentafel"): oldest generation at the
 * top, Marina at the bottom center, each row one generation. NO SVG, NO
 * new dependency — every connector segment below is a plain rectangle
 * (x, y, width, height) meant to become a `View` with a fixed width or
 * height, per the task's own requirement.
 */

export type TreeLayoutPerson = {
  id: string;
  level: number;
  sort_index: number;
  mother_id: string | null;
  father_id: string | null;
  partnerIds: readonly string[];
};

export type TreeNodePosition = {
  id: string;
  level: number;
  /** Center x, in layout units — same units `NODE_DIAMETER`/`NODE_GAP` are given in; the renderer scales as needed. */
  x: number;
  /** Center y, derived from `level` (see `layoutTree`'s own comment). */
  y: number;
};

export type ConnectorSegment = { x: number; y: number; width: number; height: number };

export const NODE_DIAMETER = 72;
export const NODE_GAP = 28;
/** Horizontal distance between two adjacent nodes' centers in the same row — the "fester Mindestabstand" the task specifies. */
export const NODE_SLOT_WIDTH = NODE_DIAMETER + NODE_GAP;
export const LEVEL_ROW_HEIGHT = 168;
const LINE_THICKNESS = 3;
/** How many times the "center parents over children, then resolve overlaps" cycle repeats — task's own fixed count, not "until convergence". */
const REFINEMENT_ITERATIONS = 3;

/**
 * Two people "share a parent" only when the shared side is actually known
 * on both — mirrors logic.ts#sharesParentWith (not reused directly: that
 * one is scoped to comparing against `rootId`, this one compares any two
 * people at the same row).
 */
function shareParent(a: TreeLayoutPerson, b: TreeLayoutPerson): boolean {
  return (a.mother_id !== null && a.mother_id === b.mother_id) || (a.father_id !== null && a.father_id === b.father_id);
}

/**
 * Left-to-right order within one row (task step 2): siblings stay
 * together, partners sit immediately next to each other, otherwise
 * `sort_index`. Two passes — first cluster full/half-siblings (a stable
 * grouping pass over the `sort_index` order, so a sibling block itself
 * stays `sort_index`-ordered and blocks appear in the order their first
 * member would have anyway), then pull each person's partner (if also in
 * this row) to sit directly beside them.
 */
export function orderRow<T extends TreeLayoutPerson>(people: readonly T[]): T[] {
  const sorted = [...people].sort((a, b) => a.sort_index - b.sort_index || a.id.localeCompare(b.id));
  const placed = new Set<string>();
  const siblingGrouped: T[] = [];

  for (const person of sorted) {
    if (placed.has(person.id)) {
      continue;
    }
    for (const candidate of sorted) {
      if (placed.has(candidate.id)) {
        continue;
      }
      if (candidate.id === person.id || shareParent(person, candidate)) {
        siblingGrouped.push(candidate);
        placed.add(candidate.id);
      }
    }
  }

  return movePartnersAdjacent(siblingGrouped);
}

function movePartnersAdjacent<T extends TreeLayoutPerson>(order: readonly T[]): T[] {
  const result = [...order];
  const handled = new Set<string>();

  for (const person of order) {
    if (handled.has(person.id)) {
      continue;
    }
    handled.add(person.id);
    for (const partnerId of person.partnerIds) {
      if (handled.has(partnerId)) {
        continue;
      }
      const partnerIndex = result.findIndex((p) => p.id === partnerId);
      if (partnerIndex === -1) {
        continue; // partner not in this row
      }
      handled.add(partnerId);
      const personIndex = result.findIndex((p) => p.id === person.id);
      if (Math.abs(partnerIndex - personIndex) === 1) {
        continue; // already adjacent
      }
      const [partner] = result.splice(partnerIndex, 1);
      const insertAt = result.findIndex((p) => p.id === person.id) + 1;
      result.splice(insertAt, 0, partner);
    }
  }
  return result;
}

/**
 * Positions every person in `people` (task step 3): a preliminary
 * left-to-right slot per row, then `REFINEMENT_ITERATIONS` rounds of
 * "center each parent over the midpoint of their children" (row by row,
 * youngest to oldest, so a row's positions are final before the row
 * above centers over it) followed by "resolve overlaps left to right
 * with the fixed minimum spacing" (row by row, in `orderRow`'s order).
 *
 * Cycle-safe by construction: every loop below is bounded by the number
 * of rows or people, never by graph traversal — a `mother_id`/`father_id`
 * cycle (a data error) cannot make this loop longer, only make
 * `childrenOf` return a nonsensical but finite set.
 */
export function layoutTree(people: readonly TreeLayoutPerson[]): TreeNodePosition[] {
  if (people.length === 0) {
    return [];
  }

  const levels = [...new Set(people.map((p) => p.level))];
  const levelsTopDown = [...levels].sort((a, b) => b - a); // oldest (highest level number) first
  const levelsBottomUp = [...levels].sort((a, b) => a - b);
  const maxLevel = levelsTopDown[0];

  const rows = new Map<number, TreeLayoutPerson[]>();
  for (const level of levelsTopDown) {
    rows.set(level, orderRow(people.filter((p) => p.level === level)));
  }

  const x = new Map<string, number>();
  // Pass 1: preliminary left-to-right slot, per row (row order doesn't matter here — each row is independent).
  for (const level of levelsTopDown) {
    rows.get(level)!.forEach((person, index) => {
      x.set(person.id, index * NODE_SLOT_WIDTH);
    });
  }

  const childrenOf = (id: string): TreeLayoutPerson[] =>
    people.filter((p) => p.mother_id === id || p.father_id === id);

  for (let iteration = 0; iteration < REFINEMENT_ITERATIONS; iteration += 1) {
    // Pass 2: center each parent over the midpoint of their children — bottom-up, so a row's own positions are settled before the row above uses them.
    for (const level of levelsBottomUp) {
      for (const person of rows.get(level)!) {
        const childXs = childrenOf(person.id)
          .map((child) => x.get(child.id))
          .filter((value): value is number => value !== undefined);
        if (childXs.length > 0) {
          x.set(person.id, (Math.min(...childXs) + Math.max(...childXs)) / 2);
        }
      }
    }

    // Pass 3: resolve overlaps, left to right, per row, fixed minimum spacing.
    for (const level of levelsTopDown) {
      const row = rows.get(level)!;
      for (let i = 1; i < row.length; i += 1) {
        const minX = (x.get(row[i - 1].id) as number) + NODE_SLOT_WIDTH;
        if ((x.get(row[i].id) as number) < minX) {
          x.set(row[i].id, minX);
        }
      }
    }
  }

  return people.map((person) => ({
    id: person.id,
    level: person.level,
    x: x.get(person.id) as number,
    y: (maxLevel - person.level) * LEVEL_ROW_HEIGHT,
  }));
}

function verticalSegment(centerX: number, yFrom: number, yTo: number): ConnectorSegment {
  const top = Math.min(yFrom, yTo);
  const height = Math.max(Math.abs(yTo - yFrom), LINE_THICKNESS);
  return { x: centerX - LINE_THICKNESS / 2, y: top, width: LINE_THICKNESS, height };
}

function horizontalSegment(centerY: number, xFrom: number, xTo: number): ConnectorSegment {
  const left = Math.min(xFrom, xTo);
  const width = Math.max(Math.abs(xTo - xFrom), LINE_THICKNESS);
  return { x: left, y: centerY - LINE_THICKNESS / 2, width, height: LINE_THICKNESS };
}

/**
 * The right-angled connector for every person who has at least one
 * parent also present in the layout (task step 4): straight up from the
 * child's own top edge to an elbow row halfway to the parents' row,
 * across to the midpoint between the parents (or straight to the one
 * parent present), then straight up into the parents' row. Three
 * rectangles per connected child, each a fixed-width-or-height segment —
 * no SVG, no path data, just boxes a `View` can render directly.
 */
export function computeConnectors(
  positions: readonly TreeNodePosition[],
  people: readonly TreeLayoutPerson[],
): ConnectorSegment[] {
  const posById = new Map(positions.map((p) => [p.id, p]));
  const segments: ConnectorSegment[] = [];

  for (const person of people) {
    const childPos = posById.get(person.id);
    if (!childPos) {
      continue;
    }
    const parentPositions = [person.mother_id, person.father_id]
      .filter((id): id is string => id !== null)
      .map((id) => posById.get(id))
      .filter((position): position is TreeNodePosition => !!position);
    if (parentPositions.length === 0) {
      continue;
    }

    const parentX =
      parentPositions.length === 2 ? (parentPositions[0].x + parentPositions[1].x) / 2 : parentPositions[0].x;
    const parentY = parentPositions[0].y;
    const elbowY = (childPos.y + parentY) / 2;

    segments.push(verticalSegment(childPos.x, childPos.y - NODE_DIAMETER / 2, elbowY));
    segments.push(horizontalSegment(elbowY, childPos.x, parentX));
    segments.push(verticalSegment(parentX, elbowY, parentY + NODE_DIAMETER / 2));
  }

  return segments;
}
