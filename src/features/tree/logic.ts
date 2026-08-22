/**
 * tree/logic — pure, tested rules for the "Stammbaum" tab: display name,
 * life dates, the generation graph and its list groups. Deliberately free
 * of any Expo / React Native / PowerSync import so it runs in plain Node
 * under Vitest — the device-touching side lives in repository.ts, photo.ts
 * and the screens.
 */

import type { RelativeGender, UnionKind } from './types';

export const GENDER_OPTIONS: { value: RelativeGender; label: string }[] = [
  { value: 'female', label: 'Weiblich' },
  { value: 'male', label: 'Männlich' },
  { value: 'other', label: 'Divers' },
];

const GENDER_LABELS: Record<RelativeGender, string> = Object.fromEntries(
  GENDER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<RelativeGender, string>;

/** German label for a gender, or `''` for "keine Angabe" (`null`). */
export function describeGender(gender: RelativeGender | null): string {
  return gender ? (GENDER_LABELS[gender] ?? '') : '';
}

export const DEFAULT_UNION_KIND: UnionKind = 'partner';

/** "DD.MM.YYYY" — same compact form as features/events/logic.ts#formatShortGermanDate, duplicated rather than cross-imported (see that function's own reasoning). Only used to seed `born_on` from a child's `birth_at` (repository.ts#ensureRootRelative); `born_on` itself is free text afterwards and never reformatted. */
export function formatGermanDate(localDate: string): string {
  const [year, month, day] = localDate.split('-');
  return `${day}.${month}.${year}`;
}

type NameParts = {
  given_name: string;
  family_name: string | null;
  birth_name: string | null;
};

/**
 * "Vorname Nachname", with the birth name in parentheses when it's known
 * AND actually differs from the family name — showing it when it's
 * identical would just repeat the same word twice for no reason.
 */
export function displayName(person: NameParts): string {
  const base = [person.given_name, person.family_name].filter((part) => part && part.trim().length > 0).join(' ');
  if (person.birth_name && person.birth_name.trim().length > 0 && person.birth_name !== person.family_name) {
    return `${base} (geb. ${person.birth_name})`;
  }
  return base;
}

type LifeDates = {
  born_on: string | null;
  died_on: string | null;
  deceased: number | boolean;
};

/**
 * "1923 – 1998", "geb. 1923", "1923 – verstorben", "" when nothing is
 * known. `born_on`/`died_on` are free text (see types.ts) — never parsed,
 * just concatenated as given.
 */
export function lifeLine(person: LifeDates): string {
  const born = person.born_on?.trim() || null;
  const died = person.died_on?.trim() || null;
  const isDeceased = Boolean(person.deceased);

  if (born && died) {
    return `${born} – ${died}`;
  }
  if (born && isDeceased) {
    return `${born} – verstorben`;
  }
  if (born) {
    return `geb. ${born}`;
  }
  if (died) {
    return `gestorben ${died}`;
  }
  if (isDeceased) {
    return 'verstorben';
  }
  return '';
}

/**
 * The graph input `computeGenerations` walks — NOT the raw `RelativeRow`.
 * The repository resolves `partnerIds` from `relative_unions` once (both
 * directions — a union's `a_id`/`b_id` are symmetric) before calling in,
 * so this function stays pure and needs no knowledge of the union table's
 * shape.
 */
export type FamilyGraphPerson = {
  id: string;
  motherId: string | null;
  fatherId: string | null;
  partnerIds: readonly string[];
};

/**
 * Breadth-first generation numbers relative to `rootId` (0): parents are
 * -1, children +1, partners share their partner's own level. A `Map` marks
 * every id the moment it is FIRST reached and never revisits it — the
 * standard BFS "visited" guard, which is also exactly what keeps a cyclic
 * (data-error) graph from looping forever, since `mother_id`/`father_id`
 * carry no real foreign key and nothing stops a bad edit from pointing a
 * person at their own descendant (see core/db/schema.ts's comment on
 * `relatives`).
 */
export function computeGenerations(
  people: readonly FamilyGraphPerson[],
  rootId: string,
): Map<string, number> {
  const byId = new Map(people.map((person) => [person.id, person]));
  const levels = new Map<string, number>();
  if (!byId.has(rootId)) {
    return levels;
  }

  const childrenOf = (id: string): string[] =>
    people.filter((p) => p.motherId === id || p.fatherId === id).map((p) => p.id);

  levels.set(rootId, 0);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const level = levels.get(id) as number;
    const person = byId.get(id);
    if (!person) {
      continue;
    }

    const neighbors: { id: string; level: number }[] = [
      ...(person.motherId ? [{ id: person.motherId, level: level - 1 }] : []),
      ...(person.fatherId ? [{ id: person.fatherId, level: level - 1 }] : []),
      ...childrenOf(id).map((childId) => ({ id: childId, level: level + 1 })),
      ...person.partnerIds.map((partnerId) => ({ id: partnerId, level })),
    ];

    for (const neighbor of neighbors) {
      if (levels.has(neighbor.id) || !byId.has(neighbor.id)) {
        continue;
      }
      levels.set(neighbor.id, neighbor.level);
      queue.push(neighbor.id);
    }
  }

  return levels;
}

export type FamilyGroup<T> = { label: string; people: T[] };

/**
 * Buckets people by generation for the list screen: the root's own group
 * (labelled with the actual child's name — "Marina", never a placeholder),
 * then Eltern/Großeltern/Urgroßeltern, then everything further out
 * ("Weitere"), then anyone `computeGenerations` never reached at all
 * ("Nicht verbunden" — no `Map` entry for their id). Empty groups are
 * dropped so the list never shows a heading with nothing under it.
 */
export function groupForList<T extends { id: string }>(
  people: readonly T[],
  generations: ReadonlyMap<string, number>,
  rootLabel: string,
): FamilyGroup<T>[] {
  const root: T[] = [];
  const parents: T[] = [];
  const grandparents: T[] = [];
  const greatGrandparents: T[] = [];
  const others: T[] = [];
  const unconnected: T[] = [];

  for (const person of people) {
    const level = generations.get(person.id);
    if (level === undefined) {
      unconnected.push(person);
    } else if (level === 0) {
      root.push(person);
    } else if (level === -1) {
      parents.push(person);
    } else if (level === -2) {
      grandparents.push(person);
    } else if (level === -3) {
      greatGrandparents.push(person);
    } else {
      others.push(person);
    }
  }

  return [
    { label: rootLabel, people: root },
    { label: 'Eltern', people: parents },
    { label: 'Großeltern', people: grandparents },
    { label: 'Urgroßeltern', people: greatGrandparents },
    { label: 'Weitere', people: others },
    { label: 'Nicht verbunden', people: unconnected },
  ].filter((group) => group.people.length > 0);
}

/** The other side of a partnership, from either direction — `relative_unions` is symmetric, `a_id`/`b_id` carry no meaning of their own. */
export function partnerIdFromUnion(union: { a_id: string; b_id: string }, relativeId: string): string {
  return union.a_id === relativeId ? union.b_id : union.a_id;
}

/** Selection lists (Mutter/Vater/Partner) must never contain the person being edited — trivial, but easy to forget ad hoc at every one of the three call sites, so it gets one tested name instead. */
export function excludeSelf<T extends { id: string }>(people: readonly T[], selfId: string | null): T[] {
  if (!selfId) {
    return [...people];
  }
  return people.filter((person) => person.id !== selfId);
}
