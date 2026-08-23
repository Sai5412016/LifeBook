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
 * 2026-08-23: `classifyRelation` (removed, superseded below) grouped by a
 * fixed small rule set that only went two steps out (parent/sibling/
 * grandparent/aunt-uncle/cousin) — anyone further out (a great-aunt, a
 * cousin's child, a spouse's family) fell into the catch-all "Weitere
 * Verwandte", which is not a relationship, it's an admission of not
 * having computed one. This replaces it with the actual genealogical
 * method: find the closest common ancestor of the root and the person,
 * measure the distance from each side to that ancestor, and look the
 * pair up — the same method a family-tree book uses. See `findBloodTie`
 * below for the mechanics and `TIE_LABELS` for the exact wording table
 * the task specifies.
 */

/** How far back `mother_id`/`father_id` reaches from `id`, `id` itself included at 0 — a person is their own 0th ancestor. Visited-once, so a data-entry cycle (mother_id/father_id pointing in a loop) can never spin forever, same guard the removed `computeGenerations` used. */
function ancestorDistances(id: string, byId: ReadonlyMap<string, RelationGraphPerson>): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(id, 0);
  const queue: string[] = [id];
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const distance = distances.get(currentId) as number;
    const person = byId.get(currentId);
    if (!person) {
      continue;
    }
    for (const parentId of [person.mother_id, person.father_id]) {
      if (parentId && !distances.has(parentId)) {
        distances.set(parentId, distance + 1);
        queue.push(parentId);
      }
    }
  }
  return distances;
}

/**
 * A blood tie to the root, purely from `mother_id`/`father_id` chains —
 * NOT `relative_unions` (that's step 5, layered on top separately, see
 * `findRelation` below). `ancestor`/`descendant` are the direct-line
 * cases; `shared` is everyone else, with `a` = root's distance to the
 * closest common ancestor and `b` = the person's own distance to it —
 * the two numbers `TIE_LABELS`/the cousin formula key off.
 */
type BloodTie =
  | { kind: 'root' }
  | { kind: 'ancestor'; distance: number }
  | { kind: 'descendant'; distance: number }
  | { kind: 'shared'; a: number; b: number };

/**
 * The closest common ancestor of `rootId` and `personId`, as an (a, b)
 * distance pair, or the direct-line case if one is the other's ancestor.
 * "Closest" = smallest a+b — ties (rare: e.g. full siblings share both
 * parents, each an equally-close common ancestor) don't matter here since
 * every tied candidate yields the SAME (a, b) pair for a straightforward
 * case; a mixed tie (different (a, b) pairs at the same a+b) is exotic
 * enough that any deterministic pick is defensible, and `Math.max` is
 * used as the tiebreak below (closest generation-wise) for one.
 */
function findBloodTie(personId: string, rootId: string, byId: ReadonlyMap<string, RelationGraphPerson>): BloodTie | null {
  if (personId === rootId) {
    return { kind: 'root' };
  }
  if (!byId.has(rootId) || !byId.has(personId)) {
    return null;
  }

  const rootAncestors = ancestorDistances(rootId, byId);
  const personAncestors = ancestorDistances(personId, byId);

  const asAncestor = rootAncestors.get(personId);
  if (asAncestor !== undefined && asAncestor > 0) {
    return { kind: 'ancestor', distance: asAncestor };
  }
  const asDescendant = personAncestors.get(rootId);
  if (asDescendant !== undefined && asDescendant > 0) {
    return { kind: 'descendant', distance: asDescendant };
  }

  let best: { a: number; b: number } | null = null;
  for (const [ancestorId, a] of rootAncestors) {
    if (a === 0) {
      continue;
    }
    const b = personAncestors.get(ancestorId);
    if (b === undefined || b === 0) {
      continue;
    }
    if (!best || a + b < best.a + best.b || (a + b === best.a + best.b && Math.max(a, b) < Math.max(best.a, best.b))) {
      best = { a, b };
    }
  }
  return best ? { kind: 'shared', a: best.a, b: best.b } : null;
}

function pair(gender: RelativeGender | null, female: string, male: string, neutral: string): string {
  if (gender === 'female') {
    return female;
  }
  if (gender === 'male') {
    return male;
  }
  return neutral;
}

/** The nine exact (a, b) pairs the task names, keyed as `"a,b"` — everything else falls through to the cousin-degree formula in `sharedTieLabel`. */
const NAMED_SHARED_TIES: Record<string, { female: string; male: string; neutral: string }> = {
  '1,1': { female: 'Schwester', male: 'Bruder', neutral: 'Schwester/Bruder' },
  '2,1': { female: 'Tante', male: 'Onkel', neutral: 'Tante/Onkel' },
  '3,1': { female: 'Großtante', male: 'Großonkel', neutral: 'Großtante/Großonkel' },
  '4,1': { female: 'Urgroßtante', male: 'Urgroßonkel', neutral: 'Urgroßtante/Urgroßonkel' },
  '1,2': { female: 'Nichte', male: 'Neffe', neutral: 'Nichte/Neffe' },
  '1,3': { female: 'Großnichte', male: 'Großneffe', neutral: 'Großnichte/Großneffe' },
  '2,2': { female: 'Cousine 1. Grades', male: 'Cousin 1. Grades', neutral: 'Cousine/Cousin 1. Grades' },
  '3,3': { female: 'Cousine 2. Grades', male: 'Cousin 2. Grades', neutral: 'Cousine/Cousin 2. Grades' },
  '4,4': { female: 'Cousine 3. Grades', male: 'Cousin 3. Grades', neutral: 'Cousine/Cousin 3. Grades' },
};

/**
 * 2026-08-23, korrigiert: "einmal"/"zweimal" für 1/2 Grade Entfernung —
 * die üblichen deutschen Multiplikativadverbien — "dreifach"/"vierfach"/…
 * (die Adjektivform mit -fach) erst ab drei, nicht die vorherige, rein
 * numerische "N-fach"-Schreibweise für jeden Fall ab 1. Über die Tabelle
 * hinaus (>10, in einem Stammbaum praktisch nie erreicht) bleibt "N-fach"
 * als Nur-Zahlen-Fallback, statt für jede denkbare Zahl ein eigenes Wort
 * vorzuhalten.
 */
const GERMAN_MULTIPLICATIVE_WORDS: Record<number, string> = {
  1: 'einmal',
  2: 'zweimal',
  3: 'dreifach',
  4: 'vierfach',
  5: 'fünffach',
  6: 'sechsfach',
  7: 'siebenfach',
  8: 'achtfach',
  9: 'neunfach',
  10: 'zehnfach',
};

function removedWord(removed: number): string {
  return GERMAN_MULTIPLICATIVE_WORDS[removed] ?? `${removed}-fach`;
}

/** "Cousine/Cousin N. Grades[, einmal/zweimal/dreifach… entfernt]" — the task's general fallback, for any (a, b) not in `NAMED_SHARED_TIES`. */
function cousinDegreeLabel(a: number, b: number, gender: RelativeGender | null): string {
  const degree = Math.min(a, b) - 1;
  const removed = Math.abs(a - b);
  const base = pair(gender, `Cousine ${degree}. Grades`, `Cousin ${degree}. Grades`, `Cousine/Cousin ${degree}. Grades`);
  if (removed === 0) {
    return base;
  }
  return `${base}, ${removedWord(removed)} entfernt`;
}

function sharedTieLabel(a: number, b: number, gender: RelativeGender | null): string {
  const named = NAMED_SHARED_TIES[`${a},${b}`];
  return named ? pair(gender, named.female, named.male, named.neutral) : cousinDegreeLabel(a, b, gender);
}

function ancestorTieLabel(distance: number, gender: RelativeGender | null): string {
  if (distance === 1) {
    return pair(gender, 'Mutter', 'Vater', 'Mutter/Vater');
  }
  if (distance === 2) {
    return pair(gender, 'Großmutter', 'Großvater', 'Großmutter/Großvater');
  }
  if (distance === 3) {
    return pair(gender, 'Urgroßmutter', 'Urgroßvater', 'Urgroßmutter/Urgroßvater');
  }
  if (distance === 4) {
    return pair(gender, 'Ururgroßmutter', 'Ururgroßvater', 'Ururgroßmutter/Ururgroßvater');
  }
  return `Vorfahre der ${distance - 2}. Generation`;
}

function descendantTieLabel(distance: number, gender: RelativeGender | null): string {
  if (distance === 1) {
    return pair(gender, 'Tochter', 'Sohn', 'Tochter/Sohn');
  }
  if (distance === 2) {
    return pair(gender, 'Enkelin', 'Enkel', 'Enkelin/Enkel');
  }
  if (distance === 3) {
    return pair(gender, 'Urenkelin', 'Urenkel', 'Urenkelin/Urenkel');
  }
  return `Nachfahre der ${distance - 2}. Generation`;
}

function bloodTieLabel(tie: BloodTie, gender: RelativeGender | null, rootGivenName: string): string {
  switch (tie.kind) {
    case 'root':
      return `${rootGivenName} selbst`;
    case 'ancestor':
      return ancestorTieLabel(tie.distance, gender);
    case 'descendant':
      return descendantTieLabel(tie.distance, gender);
    case 'shared':
      return sharedTieLabel(tie.a, tie.b, gender);
  }
}

/** Bucket key for the root's own group — a sentinel, not the display label: the label is the root's real given name plus " selbst" (resolved once in `groupForList`), but the BUCKET KEY must be a fixed, name-independent string so it can appear in `GROUP_ORDER` without knowing the root's name in advance. */
const ROOT_GROUP_KEY = '\0root';

/** Which list group a blood tie belongs to — a COARSER bucket than the precise label: every cousin-formula result (named degree or not) shares one "Cousins und Cousinen" heading, same idea for the great-aunt/uncle and niece/nephew tiers, since the task's fixed heading list has no separate heading per exact degree. */
function bloodTieGroup(tie: BloodTie): string {
  switch (tie.kind) {
    case 'root':
      return ROOT_GROUP_KEY;
    case 'ancestor':
      if (tie.distance === 1) {
        return 'Eltern';
      }
      if (tie.distance === 2) {
        return 'Großeltern';
      }
      if (tie.distance === 3) {
        return 'Urgroßeltern';
      }
      return 'Weitere Verwandte';
    case 'descendant':
      return 'Weitere Verwandte'; // no heading for children/grandchildren in the task's fixed list
    case 'shared':
      if (tie.a === 1 && tie.b === 1) {
        return 'Geschwister';
      }
      if (tie.b === 1 && tie.a === 2) {
        return 'Tanten und Onkel';
      }
      if (tie.b === 1 && tie.a >= 3) {
        return 'Grosstanten und Grossonkel';
      }
      if (tie.a === 1 && tie.b >= 2) {
        return 'Nichten und Neffen';
      }
      return 'Cousins und Cousinen'; // every a>=2,b>=2 case, named degree or the general formula alike
  }
}

/** Whether a blood tie is exactly "Geschwister" (a=1,b=1) — the "Partner eines Geschwisterteils" special case (step 5). */
function isSiblingTie(tie: BloodTie): boolean {
  return tie.kind === 'shared' && tie.a === 1 && tie.b === 1;
}

/** Whether a blood tie is exactly "Tochter/Sohn" (descendant, distance 1) — the "Partner eines Kindes" special case (step 5). */
function isChildTie(tie: BloodTie): boolean {
  return tie.kind === 'descendant' && tie.distance === 1;
}

/**
 * Step 5: someone with NO blood tie of their own who is a `relative_unions`
 * partner of a blood relative X, OR shares a child with X (even without a
 * formal union row — task requirement "ODER... gemeinsame Kinder hat"),
 * inherits X's tie. Root itself is never considered as X here (root has
 * no blood label to append "(angeheiratet)" to) — root's own direct
 * partner is handled separately in `findRelation`. Ties among several
 * candidate X's are broken by the closest one (smallest a+b / distance) —
 * not exercised by any given test, just a deterministic fallback.
 */
function findMarriedInTie(
  personId: string,
  rootId: string,
  byId: ReadonlyMap<string, RelationGraphPerson>,
  all: readonly RelationGraphPerson[],
): { xTie: BloodTie; special: 'sibling' | 'child' | null } | null {
  const person = byId.get(personId);
  if (!person) {
    return null;
  }

  const candidateIds = new Set<string>();
  for (const partnerId of person.partnerIds) {
    candidateIds.add(partnerId);
  }
  for (const child of all) {
    if (child.mother_id === personId && child.father_id) {
      candidateIds.add(child.father_id);
    }
    if (child.father_id === personId && child.mother_id) {
      candidateIds.add(child.mother_id);
    }
  }

  let best: { xTie: BloodTie; closeness: number } | null = null;
  for (const candidateId of candidateIds) {
    if (candidateId === personId || candidateId === rootId) {
      continue;
    }
    const xTie = findBloodTie(candidateId, rootId, byId);
    if (!xTie || xTie.kind === 'root') {
      continue;
    }
    const closeness = xTie.kind === 'shared' ? xTie.a + xTie.b : xTie.distance;
    if (!best || closeness < best.closeness) {
      best = { xTie, closeness };
    }
  }
  if (!best) {
    return null;
  }
  const special = isSiblingTie(best.xTie) ? 'sibling' : isChildTie(best.xTie) ? 'child' : null;
  return { xTie: best.xTie, special };
}

/** Whether `personId` is a parent of one of root's OWN partners — "Eltern des eigenen Partners" (step 5's third special case). */
function isInLawParent(personId: string, rootId: string, byId: ReadonlyMap<string, RelationGraphPerson>): boolean {
  const root = byId.get(rootId);
  if (!root) {
    return false;
  }
  return root.partnerIds.some((partnerId) => {
    const partner = byId.get(partnerId);
    return !!partner && (partner.mother_id === personId || partner.father_id === personId);
  });
}

/** The full relation of `personId` to `rootId` — blood tie first, then the three marriage-in shapes step 5 describes, then "Noch nicht verbunden"/"Weitere Verwandte" as the last resorts. */
type Relation =
  | { kind: 'blood'; tie: BloodTie }
  | { kind: 'inLawParent' }
  | { kind: 'inLawOf'; xTie: BloodTie; special: 'sibling' | 'child' | null }
  | { kind: 'directPartnerOfRoot' }
  | { kind: 'unconnected' }
  | { kind: 'otherUnrelated' };

function findRelation(
  personId: string,
  rootId: string,
  byId: ReadonlyMap<string, RelationGraphPerson>,
  all: readonly RelationGraphPerson[],
): Relation {
  const blood = findBloodTie(personId, rootId, byId);
  if (blood) {
    return { kind: 'blood', tie: blood };
  }

  if (isInLawParent(personId, rootId, byId)) {
    return { kind: 'inLawParent' };
  }

  const marriedIn = findMarriedInTie(personId, rootId, byId, all);
  if (marriedIn) {
    return { kind: 'inLawOf', xTie: marriedIn.xTie, special: marriedIn.special };
  }

  const person = byId.get(personId);
  const root = byId.get(rootId);
  if (person && root && (person.partnerIds.includes(rootId) || root.partnerIds.includes(personId))) {
    return { kind: 'directPartnerOfRoot' };
  }

  const hasNoLinksAtAll =
    !!person &&
    person.mother_id === null &&
    person.father_id === null &&
    person.partnerIds.length === 0 &&
    !all.some((candidate) => candidate.mother_id === personId || candidate.father_id === personId);
  if (hasNoLinksAtAll) {
    return { kind: 'unconnected' };
  }

  return { kind: 'otherUnrelated' };
}

/**
 * The actual relationship of `person` to the root (Marina), by the usual
 * genealogical method — common ancestor plus two distances (see
 * `findBloodTie`) — never a fixed two-step rule set (Fehler, 2026-08-23:
 * a great-aunt, a cousin's child, or an in-law all used to fall into the
 * meaningless "Weitere Verwandte" catch-all).
 *
 * For the root themselves this is "{ihr eigener Vorname} selbst" — built
 * from the real data on screen, never a literal placeholder name. Gender
 * is used ONLY when actually set on the relevant person's own record —
 * an unknown gender always gets the neutral paired form ("Tante/Onkel",
 * "Cousine/Cousin 1. Grades"), never guessed from a name (task
 * requirement, step 6) — even a name as conventionally gendered as
 * "Josefa" or "Joseph".
 *
 * Married-in relatives (step 5) use THEIR OWN gender against the blood
 * relative's tie they inherit, not the blood relative's gender — Jasmin
 * (female), partnered to Onkel Alexander, is "Tante (angeheiratet)", not
 * "Onkel (angeheiratet)".
 */
export function relationLabel(
  person: RelationGraphPerson,
  all: readonly RelationGraphPerson[],
  rootId: string,
): string {
  const byId = new Map(all.map((p) => [p.id, p]));
  const root = byId.get(rootId);
  const rootGivenName = root?.given_name ?? person.given_name;
  const relation = findRelation(person.id, rootId, byId, all);

  switch (relation.kind) {
    case 'blood':
      return bloodTieLabel(relation.tie, person.gender, rootGivenName);
    case 'inLawParent':
      return pair(person.gender, 'Schwiegermutter', 'Schwiegervater', 'Schwiegermutter/Schwiegervater');
    case 'inLawOf':
      if (relation.special === 'sibling') {
        return pair(person.gender, 'Schwägerin', 'Schwager', 'Schwägerin/Schwager');
      }
      if (relation.special === 'child') {
        return pair(person.gender, 'Schwiegertochter', 'Schwiegersohn', 'Schwiegertochter/Schwiegersohn');
      }
      return `${bloodTieLabel(relation.xTie, person.gender, rootGivenName)} (angeheiratet)`;
    case 'directPartnerOfRoot':
      return pair(person.gender, 'Partnerin', 'Partner', 'Partnerin/Partner');
    case 'unconnected':
      return 'Noch nicht verbunden';
    case 'otherUnrelated':
      return 'Weitere Verwandte';
  }
}

/** A short explanation shown under the "Noch nicht verbunden" group — task requirement, so nobody wonders how to fix it. */
export const UNCONNECTED_GROUP_HINT =
  'Über Mutter, Vater oder Partner mit dem Stammbaum verbinden, damit diese Personen einsortiert werden.';

export type FamilyGroup<T> = { label: string; people: T[] };

/** Fixed heading order the task specifies, keyed by bucket ("Marina" is `ROOT_GROUP_KEY`, resolved to the root's real name only when rendering — see `groupForList`). "Weitere Verwandte" stays a pure last-resort catch-all (task requirement: empty for the real data). */
const GROUP_ORDER = [
  ROOT_GROUP_KEY,
  'Eltern',
  'Geschwister',
  'Großeltern',
  'Urgroßeltern',
  'Tanten und Onkel',
  'Cousins und Cousinen',
  'Grosstanten und Grossonkel',
  'Nichten und Neffen',
  'Weitere Verwandte',
  'Noch nicht verbunden',
] as const;

/** The list group a full `Relation` belongs to — mirrors `relationLabel`'s switch, but resolves to one of the fixed `GROUP_ORDER` bucket keys instead of the precise per-person wording. */
function relationGroup(relation: Relation): string {
  switch (relation.kind) {
    case 'blood':
      return bloodTieGroup(relation.tie);
    case 'inLawParent':
      return 'Weitere Verwandte'; // no "Schwiegereltern" heading in the task's fixed list
    case 'inLawOf':
      return bloodTieGroup(relation.xTie); // groups with whichever blood tier X belongs to
    case 'directPartnerOfRoot':
      return 'Weitere Verwandte'; // not covered by the task's list either; untested, low-risk default
    case 'unconnected':
      return 'Noch nicht verbunden';
    case 'otherUnrelated':
      return 'Weitere Verwandte';
  }
}

/**
 * Groups EVERY person in `people` by their relation to `rootId`, in the
 * fixed order the task specifies, "Noch nicht verbunden" last. Lossless by
 * construction: `findRelation` always returns exactly one of its six
 * shapes for any person, and `relationGroup` maps EVERY one of those
 * (recursively, every `BloodTie` shape too) to one of the eleven fixed
 * headings — there is no path through either function that returns
 * nothing, so nobody can fall out of every bucket (Fehler 1, 2026-08-22).
 * See logic.test.ts's own "Summe aller Gruppengrößen" test for the guard
 * this keeps enforcing. Empty groups are dropped so the list never shows
 * a heading with nothing under it.
 */
export function groupForList<T extends RelationGraphPerson>(
  people: readonly T[],
  rootId: string,
): FamilyGroup<T>[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const root = byId.get(rootId);
  const rootGivenName = root?.given_name ?? 'Stammbaum';

  const byGroup = new Map<string, T[]>();
  for (const person of people) {
    const relation = findRelation(person.id, rootId, byId, people);
    const group = relationGroup(relation);
    const bucket = byGroup.get(group);
    if (bucket) {
      bucket.push(person);
    } else {
      byGroup.set(group, [person]);
    }
  }

  return GROUP_ORDER.map((heading) => ({
    label: heading === ROOT_GROUP_KEY ? `${rootGivenName} selbst` : heading,
    people: byGroup.get(heading) ?? [],
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
