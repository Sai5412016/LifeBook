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
 *
 * REWRITTEN 24.08.2026 — mirrors the share viewer's layoutTree
 * -------------------------------------------------------------
 * The previous algorithm (3 fixed rounds of "center parents over their
 * children's midpoint", each followed by "resolve overlaps by shifting
 * right") mis-placed freshly added parents: a new person gets the highest
 * sort_index, so the overlap pass — which runs LAST — shoved both parents
 * to the right of everyone already in their row, away from their child
 * (seen live: Peter+Barbara nowhere near their son Rudolf). It also
 * centered BOTH partners of a pair onto the same x (each has only that one
 * child), then spread them a full slot apart, leaving the pair's midpoint
 * half a slot off the child — which was never re-centered underneath them.
 *
 * The share viewer (Vercel project `lifebook-album`, layoutTree) lays the
 * same data out correctly; verified against the live household on
 * 24.08.2026 (Rudolf exactly on the midpoint of Peter+Barbara, zero
 * overlaps). Its approach is ported here as the same four steps, so app
 * and viewer agree by construction:
 *
 *   1. Ahnentafel first: the root's ancestors are placed recursively;
 *      every branch gets exactly the width it needs
 *      (max(slot, widthFather + widthMother)), father's branch left,
 *      mother's right.
 *   2. On the way back down, every person is set onto the exact midpoint
 *      of their two placed parents — this is what puts a child precisely
 *      under its parents, no matter when the parents were added.
 *   3. Everyone else (siblings, in-laws, nieces) then finds the nearest
 *      FREE slot beside their reference person (placed parents first,
 *      else partner, else placed children); the space between two
 *      partners is blocked for everyone else.
 *   4. A bounded settling pass pulls partners next to each other and
 *      pushes strangers out of pair gaps, repeated until stable.
 *
 * The viewer's own implementation lives outside this repo, so it cannot
 * be imported directly — this file is the app-side twin. Any change to
 * the ordering rules here must be mirrored there (and vice versa).
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
/**
 * Hard cap on the settling pass (step 4). The viewer repeats "until
 * stable"; healthy data stabilises after one or two rounds, and the cap
 * only exists so a pathological input can never loop — same bounded-loop
 * rule the rest of this module already follows.
 */
const MAX_SETTLE_ITERATIONS = 12;
/** Tolerance for comparing computed x positions — midpoints produce fractions, exact float equality would be brittle. */
const EPSILON = 1e-6;

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
 * Positions every person in `people` — the four viewer steps described in
 * the module doc comment above. `rootId` anchors the Ahnentafel (step 1);
 * the caller (tree-view.tsx) passes Marina's id. When omitted or absent
 * from `people` (older tests, defensive), the first person of the bottom
 * row anchors instead — the Ahnentafel only needs SOME anchor, everyone
 * not in it is placed by step 3 regardless.
 *
 * Cycle-safe by construction: the ancestor recursion carries a visited
 * set (a `mother_id`/`father_id` cycle — a data error — terminates as
 * "no further parent"), the slot search and the settling pass are both
 * hard-bounded, and a final repair sweep restores the minimum spacing
 * for exactly those degenerate inputs; on healthy data it never fires,
 * because steps 1–4 only ever place people onto free positions.
 */
export function layoutTree(people: readonly TreeLayoutPerson[], rootId?: string): TreeNodePosition[] {
  if (people.length === 0) {
    return [];
  }

  const byId = new Map(people.map((p) => [p.id, p]));
  const levels = [...new Set(people.map((p) => p.level))];
  const levelsTopDown = [...levels].sort((a, b) => b - a); // oldest (highest level number) first
  const levelsBottomUp = [...levels].sort((a, b) => a - b);
  const maxLevel = levelsTopDown[0];

  const rows = new Map<number, TreeLayoutPerson[]>();
  for (const level of levelsTopDown) {
    rows.set(level, orderRow(people.filter((p) => p.level === level)));
  }

  // Partner pairs per row, [leftId, rightId] by id order — the "space
  // between two partners is blocked" rule (steps 3 and 4) reads these.
  const pairsByLevel = new Map<number, [string, string][]>();
  for (const level of levelsTopDown) {
    const row = rows.get(level)!;
    const inRow = new Set(row.map((p) => p.id));
    const seen = new Set<string>();
    const pairs: [string, string][] = [];
    for (const person of row) {
      for (const partnerId of person.partnerIds) {
        if (!inRow.has(partnerId) || partnerId === person.id) {
          continue;
        }
        const key = person.id < partnerId ? `${person.id}|${partnerId}` : `${partnerId}|${person.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        pairs.push(person.id < partnerId ? [person.id, partnerId] : [partnerId, person.id]);
      }
    }
    pairsByLevel.set(level, pairs);
  }

  const x = new Map<string, number>();

  const presentParent = (id: string | null): TreeLayoutPerson | null => (id ? (byId.get(id) ?? null) : null);

  /* ── Step 1: how wide each ancestor branch needs to be ── */
  const widthMemo = new Map<string, number>();
  const widthStack = new Set<string>();
  const ancestorWidth = (person: TreeLayoutPerson): number => {
    const memo = widthMemo.get(person.id);
    if (memo !== undefined) {
      return memo;
    }
    if (widthStack.has(person.id)) {
      return NODE_SLOT_WIDTH; // parent cycle in the data — treat as a leaf, stay finite
    }
    widthStack.add(person.id);
    const father = presentParent(person.father_id);
    const mother = presentParent(person.mother_id);
    const width = Math.max(
      NODE_SLOT_WIDTH,
      (father ? ancestorWidth(father) : 0) + (mother ? ancestorWidth(mother) : 0),
    );
    widthStack.delete(person.id);
    widthMemo.set(person.id, width);
    return width;
  };

  /* ── Steps 1+2: place the anchor's ancestors, child onto its parents' exact midpoint ── */
  const ancestorPlaced = new Set<string>();
  const placeAncestors = (person: TreeLayoutPerson, centerX: number): void => {
    if (ancestorPlaced.has(person.id)) {
      return; // pedigree collapse or a data cycle — the first placement wins
    }
    ancestorPlaced.add(person.id);
    const father = presentParent(person.father_id);
    const mother = presentParent(person.mother_id);
    if (father && mother) {
      const widthFather = ancestorWidth(father);
      const widthMother = ancestorWidth(mother);
      const left = centerX - (widthFather + widthMother) / 2;
      const fatherCenter = left + widthFather / 2;
      const motherCenter = left + widthFather + widthMother / 2;
      placeAncestors(father, fatherCenter);
      placeAncestors(mother, motherCenter);
      // Step 2: the child sits on the EXACT midpoint of its parents — this
      // line is what the bug report asked for ("direkt über Rudolf").
      x.set(person.id, ((x.get(father.id) ?? fatherCenter) + (x.get(mother.id) ?? motherCenter)) / 2);
      return;
    }
    const onlyParent = father ?? mother;
    if (onlyParent) {
      placeAncestors(onlyParent, centerX);
      x.set(person.id, x.get(onlyParent.id) ?? centerX);
      return;
    }
    x.set(person.id, centerX);
  };

  const anchor =
    rootId !== undefined && byId.has(rootId) ? byId.get(rootId)! : rows.get(levelsBottomUp[0])![0];
  placeAncestors(anchor, 0);

  /* ── Step 3: everyone else finds the nearest free slot beside their reference person ── */
  const isFree = (level: number, candidate: number, ignoreId?: string): boolean => {
    for (const person of rows.get(level)!) {
      if (person.id === ignoreId) {
        continue;
      }
      const placedX = x.get(person.id);
      if (placedX !== undefined && Math.abs(placedX - candidate) < NODE_SLOT_WIDTH - EPSILON) {
        return false;
      }
    }
    for (const [a, b] of pairsByLevel.get(level)!) {
      if (a === ignoreId || b === ignoreId) {
        continue;
      }
      const xa = x.get(a);
      const xb = x.get(b);
      if (xa === undefined || xb === undefined) {
        continue;
      }
      if (candidate > Math.min(xa, xb) + EPSILON && candidate < Math.max(xa, xb) - EPSILON) {
        return false; // inside a pair gap — blocked for everyone but the two partners
      }
    }
    return true;
  };

  const rightEndOfRow = (level: number): number => {
    const placed = rows
      .get(level)!
      .map((person) => x.get(person.id))
      .filter((value): value is number => value !== undefined);
    return placed.length > 0 ? Math.max(...placed) + NODE_SLOT_WIDTH : 0;
  };

  const nearestFree = (level: number, desired: number, ignoreId?: string): number => {
    // Bounded: each occupied position can block at most two grid
    // candidates, each pair gap finitely many — 2·n+2 steps always reach
    // a free one for real data; the fallback keeps the function total.
    const maxSteps = people.length * 2 + 2;
    for (let step = 0; step <= maxSteps; step += 1) {
      const candidates =
        step === 0 ? [desired] : [desired - step * NODE_SLOT_WIDTH, desired + step * NODE_SLOT_WIDTH];
      for (const candidate of candidates) {
        if (isFree(level, candidate, ignoreId)) {
          return candidate;
        }
      }
    }
    return rightEndOfRow(level);
  };

  const childrenOf = (id: string): TreeLayoutPerson[] =>
    people.filter((p) => p.mother_id === id || p.father_id === id);

  // Reference position: placed parents first (midpoint / the one placed),
  // then the placed partner, then placed children — the same precedence
  // the viewer uses. Null = no reference placed yet, try again next pass.
  const desiredFor = (person: TreeLayoutPerson): number | null => {
    const fatherX = person.father_id ? x.get(person.father_id) : undefined;
    const motherX = person.mother_id ? x.get(person.mother_id) : undefined;
    if (fatherX !== undefined && motherX !== undefined) {
      return (fatherX + motherX) / 2;
    }
    if (fatherX !== undefined) {
      return fatherX;
    }
    if (motherX !== undefined) {
      return motherX;
    }
    for (const partnerId of person.partnerIds) {
      const partnerX = x.get(partnerId);
      if (partnerX !== undefined) {
        return partnerX; // nearestFree lands directly beside, never on top
      }
    }
    const childXs = childrenOf(person.id)
      .map((child) => x.get(child.id))
      .filter((value): value is number => value !== undefined);
    if (childXs.length > 0) {
      return (Math.min(...childXs) + Math.max(...childXs)) / 2;
    }
    return null;
  };

  // Multi-pass so chains resolve (a sibling anchors to the parents, the
  // sibling's spouse then anchors to the sibling) — bounded: every pass
  // that makes no progress ends the loop, every productive pass places at
  // least one person.
  let progress = true;
  while (progress) {
    progress = false;
    for (const level of levelsBottomUp) {
      for (const person of rows.get(level)!) {
        if (x.has(person.id)) {
          continue;
        }
        const desired = desiredFor(person);
        if (desired === null) {
          continue;
        }
        x.set(person.id, nearestFree(person.level, desired));
        progress = true;
      }
    }
  }
  // Whoever still has no reference at all (disconnected islands the level
  // computation let through) is appended at the right edge of their row —
  // visible and non-overlapping beats invisible.
  for (const level of levelsBottomUp) {
    for (const person of rows.get(level)!) {
      if (!x.has(person.id)) {
        x.set(person.id, rightEndOfRow(level));
      }
    }
  }

  /* ── Step 4: settle — pull partners together, push strangers out of pair gaps ── */
  for (let iteration = 0; iteration < MAX_SETTLE_ITERATIONS; iteration += 1) {
    let changed = false;
    for (const level of levelsTopDown) {
      for (const [a, b] of pairsByLevel.get(level)!) {
        const xa = x.get(a)!;
        const xb = x.get(b)!;
        if (Math.abs(xa - xb) <= NODE_SLOT_WIDTH + EPSILON) {
          continue; // already side by side
        }
        // Never move an Ahnentafel member: their spacing IS the layout's
        // structure (room for both parent branches above them). Only a
        // married-in partner gets pulled over.
        const mover = !ancestorPlaced.has(b) ? b : !ancestorPlaced.has(a) ? a : null;
        if (!mover) {
          continue;
        }
        const fixedX = x.get(mover === a ? b : a)!;
        const moverX = x.get(mover)!;
        const side = moverX >= fixedX ? 1 : -1;
        for (const candidate of [fixedX + side * NODE_SLOT_WIDTH, fixedX - side * NODE_SLOT_WIDTH]) {
          if (Math.abs(candidate - fixedX) < Math.abs(moverX - fixedX) - EPSILON && isFree(level, candidate, mover)) {
            x.set(mover, candidate);
            changed = true;
            break;
          }
        }
      }
      for (const [a, b] of pairsByLevel.get(level)!) {
        const lo = Math.min(x.get(a)!, x.get(b)!);
        const hi = Math.max(x.get(a)!, x.get(b)!);
        for (const person of rows.get(level)!) {
          if (person.id === a || person.id === b || ancestorPlaced.has(person.id)) {
            continue;
          }
          const px = x.get(person.id)!;
          if (px > lo + EPSILON && px < hi - EPSILON) {
            x.set(person.id, nearestFree(level, px, person.id));
            changed = true;
          }
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  // Repair sweep for degenerate data only (e.g. the parent-cycle test:
  // two mutually-parented people collapse onto one x). Healthy data never
  // triggers it — steps 1–4 only ever place onto free positions — so it
  // cannot reintroduce the old "shift the parents away from their child"
  // bug this rewrite removed.
  for (const level of levelsTopDown) {
    const row = [...rows.get(level)!].sort(
      (a, b) => x.get(a.id)! - x.get(b.id)! || a.id.localeCompare(b.id),
    );
    for (let i = 1; i < row.length; i += 1) {
      const minX = x.get(row[i - 1].id)! + NODE_SLOT_WIDTH;
      if (x.get(row[i].id)! < minX - EPSILON) {
        x.set(row[i].id, minX);
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
