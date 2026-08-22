/**
 * tree/logic — pure, tested rules for the "Stammbaum" tab: display name,
 * life dates, the generation graph and its list groups. Deliberately free
 * of any Expo / React Native / PowerSync import so it runs in plain Node
 * under Vitest — the device-touching side lives in repository.ts, photo.ts
 * and the screens.
 */

import type { RelativeGender, RelativeRow, UnionKind } from './types';

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
 * The graph input `relationLabel`/`groupForList` walk — a `RelativeRow`
 * plus its resolved `partnerIds` (the repository resolves these from
 * `relative_unions` once, both directions — a union's `a_id`/`b_id` are
 * symmetric — before calling in, so this module stays pure and needs no
 * knowledge of the union table's shape).
 */
export type RelationGraphPerson = Pick<RelativeRow, 'id' | 'given_name' | 'gender' | 'mother_id' | 'father_id'> & {
  partnerIds: readonly string[];
};

/**
 * 2026-08-22, Fehler 2: the list used to group by BFS generation NUMBER
 * (`computeGenerations`, removed) — which put an aunt at "generation -1"
 * (her own parents' generation, same number as Marina's actual parents)
 * and rendered her under "Eltern". A number is not a relationship. This
 * derives the real, named relation to `rootId` directly from the
 * mother/father/partner links instead — see the task's own definitions,
 * mirrored one-for-one in the checks below, most-specific first (a person
 * can only ever match ONE of them, checked in order of closeness).
 */
type RelationCategory =
  | 'root'
  | 'parent'
  | 'sibling'
  | 'grandparent'
  | 'greatGrandparent'
  | 'auntUncle'
  | 'cousin'
  | 'unconnected'
  | 'other';

function parentIdsOf(person: RelationGraphPerson | undefined): string[] {
  if (!person) {
    return [];
  }
  return [person.mother_id, person.father_id].filter((id): id is string => id !== null);
}

/** Two people "share a parent" only when the shared side is actually known on both — two unrelated `null`s never count as a match. */
function sharesParentWith(byId: ReadonlyMap<string, RelationGraphPerson>, aId: string, bId: string): boolean {
  const a = byId.get(aId);
  const b = byId.get(bId);
  if (!a || !b) {
    return false;
  }
  return (a.mother_id !== null && a.mother_id === b.mother_id) || (a.father_id !== null && a.father_id === b.father_id);
}

function classifyRelation(
  personId: string,
  all: readonly RelationGraphPerson[],
  rootId: string,
): RelationCategory {
  const byId = new Map(all.map((person) => [person.id, person]));
  const root = byId.get(rootId);
  if (!root) {
    return 'other';
  }
  if (personId === rootId) {
    return 'root';
  }

  const rootParentIds = new Set(parentIdsOf(root));
  if (rootParentIds.has(personId)) {
    return 'parent';
  }
  if (sharesParentWith(byId, rootId, personId)) {
    return 'sibling';
  }

  const grandparentIds = new Set<string>();
  for (const parentId of rootParentIds) {
    for (const gpId of parentIdsOf(byId.get(parentId))) {
      grandparentIds.add(gpId);
    }
  }
  if (grandparentIds.has(personId)) {
    return 'grandparent';
  }

  const greatGrandparentIds = new Set<string>();
  for (const gpId of grandparentIds) {
    for (const ggpId of parentIdsOf(byId.get(gpId))) {
      greatGrandparentIds.add(ggpId);
    }
  }
  if (greatGrandparentIds.has(personId)) {
    return 'greatGrandparent';
  }

  // Tanten und Onkel: siblings of Marina's parents, plus those siblings'
  // partners ("angeheiratet" — task requirement).
  const auntUncleIds = new Set<string>();
  for (const parentId of rootParentIds) {
    for (const candidate of all) {
      if (candidate.id !== parentId && sharesParentWith(byId, parentId, candidate.id)) {
        auntUncleIds.add(candidate.id);
      }
    }
  }
  for (const id of [...auntUncleIds]) {
    for (const partnerId of byId.get(id)?.partnerIds ?? []) {
      auntUncleIds.add(partnerId);
    }
  }
  if (auntUncleIds.has(personId)) {
    return 'auntUncle';
  }

  // Cousins und Cousinen: children of anyone in `auntUncleIds`.
  const person = byId.get(personId);
  const isCousin =
    !!person &&
    ((person.mother_id !== null && auntUncleIds.has(person.mother_id)) ||
      (person.father_id !== null && auntUncleIds.has(person.father_id)));
  if (isCousin) {
    return 'cousin';
  }

  const hasNoLinksAtAll =
    !!person &&
    person.mother_id === null &&
    person.father_id === null &&
    person.partnerIds.length === 0 &&
    !all.some((candidate) => candidate.mother_id === personId || candidate.father_id === personId);
  if (hasNoLinksAtAll) {
    return 'unconnected';
  }

  return 'other';
}

/** "Tante"/"Onkel" when the gender is known, the gender-neutral group name otherwise — never guessed (task requirement). */
function describeAuntOrUncle(gender: RelativeGender | null): string {
  if (gender === 'female') {
    return 'Tante';
  }
  if (gender === 'male') {
    return 'Onkel';
  }
  return 'Tanten und Onkel';
}

/** Same idea as `describeAuntOrUncle`, for cousins. */
function describeCousin(gender: RelativeGender | null): string {
  if (gender === 'female') {
    return 'Cousine';
  }
  if (gender === 'male') {
    return 'Cousin';
  }
  return 'Cousins und Cousinen';
}

/**
 * The actual relationship of `person` to the root (Marina), derived from
 * `mother_id`/`father_id`/partnerships — never a generation number (Fehler
 * 2). For the root themselves this is "{ihr eigener Vorname} selbst" —
 * built from the real data on screen, never a literal placeholder name.
 * For "Tanten und Onkel"/"Cousins und Cousinen" specifically, the precise
 * gendered form is used ONLY when `gender` is actually set on that
 * person's own record — nothing here infers it any other way (task
 * requirement). Every other category has no gendered variant to begin
 * with ("Eltern"/"Geschwister"/"Großeltern"/… are already neutral).
 */
export function relationLabel(
  person: RelationGraphPerson,
  all: readonly RelationGraphPerson[],
  rootId: string,
): string {
  const byId = new Map(all.map((p) => [p.id, p]));
  const category = classifyRelation(person.id, all, rootId);

  switch (category) {
    case 'root':
      return `${byId.get(rootId)?.given_name ?? person.given_name} selbst`;
    case 'parent':
      return 'Eltern';
    case 'sibling':
      return 'Geschwister';
    case 'grandparent':
      return 'Großeltern';
    case 'greatGrandparent':
      return 'Urgroßeltern';
    case 'auntUncle':
      return describeAuntOrUncle(person.gender);
    case 'cousin':
      return describeCousin(person.gender);
    case 'unconnected':
      return 'Noch nicht verbunden';
    case 'other':
      return 'Weitere Verwandte';
  }
}

/** A short explanation shown under the "Noch nicht verbunden" group — task requirement, so nobody wonders how to fix it. */
export const UNCONNECTED_GROUP_HINT =
  'Über Mutter, Vater oder Partner mit dem Stammbaum verbinden, damit diese Personen einsortiert werden.';

export type FamilyGroup<T> = { label: string; people: T[] };

const CATEGORY_ORDER: { category: RelationCategory; label: string }[] = [
  { category: 'root', label: '' }, // label overridden per-tree with the root's real name, see below
  { category: 'parent', label: 'Eltern' },
  { category: 'sibling', label: 'Geschwister' },
  { category: 'grandparent', label: 'Großeltern' },
  { category: 'greatGrandparent', label: 'Urgroßeltern' },
  { category: 'auntUncle', label: 'Tanten und Onkel' },
  { category: 'cousin', label: 'Cousins und Cousinen' },
  { category: 'other', label: 'Weitere Verwandte' },
  { category: 'unconnected', label: 'Noch nicht verbunden' },
];

/**
 * Groups EVERY person in `people` by their relation to `rootId`, in the
 * fixed order the task specifies, "Noch nicht verbunden" last. Lossless by
 * construction: `classifyRelation` always returns exactly one of the nine
 * categories above for any person (checked most-specific-first, with
 * `'other'` as the unconditional catch-all), so every person lands in
 * exactly one bucket — see logic.test.ts's own "Summe aller
 * Gruppengrößen" test for the guard this replaces (Fehler 1: relatives
 * that fell out of every bucket were simply unreachable in the app, the
 * worst state this screen can be in). Empty groups are dropped so the
 * list never shows a heading with nothing under it.
 */
export function groupForList<T extends RelationGraphPerson>(
  people: readonly T[],
  rootId: string,
): FamilyGroup<T>[] {
  const byCategory = new Map<RelationCategory, T[]>();
  for (const person of people) {
    const category = classifyRelation(person.id, people, rootId);
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(person);
    } else {
      byCategory.set(category, [person]);
    }
  }

  const root = people.find((person) => person.id === rootId);
  return CATEGORY_ORDER.map(({ category, label }) => ({
    label: category === 'root' ? `${root?.given_name ?? 'Stammbaum'} selbst` : label,
    people: byCategory.get(category) ?? [],
  })).filter((group) => group.people.length > 0);
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
