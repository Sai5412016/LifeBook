/**
 * ui/use-hydrate-once — THE one approved way to seed a form's editable
 * local state from an existing record (CLAUDE.md Architekturregel 9).
 *
 * THE BUG THIS EXISTS TO PREVENT
 * -------------------------------
 * `useState(initialValue)` only ever evaluates `initialValue` on a
 * component's VERY FIRST render. React never re-runs it — not when a
 * query resolves later, and not when a prop starts pointing at a
 * different record. That single fact produces two distinct failures,
 * both of which end in the same damage: the form shows values that do
 * not belong to the record it is about to overwrite.
 *
 * 1. LATE ARRIVAL. A screen reads `useActiveChild()`, which returns
 *    `null` on the first render and the real row a moment later.
 *    `useState(child?.firstName ?? '')` therefore seeds `''` and stays
 *    `''` forever. Found 2026-08-16 in src/app/kind/bearbeiten.tsx:
 *    every field empty over complete data, and "Speichern" would have
 *    written those blanks over Marinas Geburtsdaten.
 * 2. SWAPPED RECORD. A panel is rendered as `{target ? <Panel row={target}/> : null}`
 *    and the user taps a different row while it is open. The condition
 *    stays truthy, so React reuses the SAME instance — `useState` does
 *    not re-run, and the panel now shows row A's values while saving to
 *    row B. Found 2026-08-17 in the Füttern/Wickeln/Schlafen edit
 *    panels, where the write covers several columns at once.
 *
 * WHAT THIS HOOK GUARANTEES
 * --------------------------
 * `hydrate(record)` runs exactly ONCE PER RECORD IDENTITY: the first
 * moment a non-null record is available, and again if (and only if)
 * `identity` changes to a different record. It deliberately does NOT
 * re-run when the same record's contents change — a background sync
 * must never clobber an edit the user is halfway through typing.
 *
 * The returned boolean is what a caller gates "Speichern" on. Per
 * Architekturregel 9 that lock is the more important half: it prevents
 * the damage even if seeding itself goes wrong.
 *
 * WHY THIS RUNS DURING RENDER, NOT IN AN EFFECT
 * ----------------------------------------------
 * This is React's documented "adjusting state when a prop changes"
 * pattern (setState during render of the SAME component, guarded so it
 * cannot loop). An effect would commit one frame with empty fields
 * first — a visible flash for panels whose record is available
 * synchronously. Rendering the correct values immediately avoids that,
 * and costs one extra render pass that React performs before painting.
 */

import { useState } from 'react';

/**
 * The hook's entire decision, as a pure function so the exact rule that
 * caused two production bugs is verifiable without a React renderer (this
 * project has no React test setup — see vitest.config.mts). `true` means
 * "seed the form from this record now".
 */
export function shouldHydrate(
  hasRecord: boolean,
  identity: string | null | undefined,
  hydratedIdentity: string | null,
): boolean {
  return hasRecord && identity != null && identity !== hydratedIdentity;
}

/** Whether the form currently shows data that was actually seeded from the record on screen. */
export function isHydrated(identity: string | null | undefined, hydratedIdentity: string | null): boolean {
  return hydratedIdentity != null && hydratedIdentity === identity;
}

export function useHydrateOnce<T>(
  /** The record to seed from. `null`/`undefined` = not available (yet). */
  record: T | null | undefined,
  /**
   * Stable identity of that record — normally its id. Seeding re-runs
   * when this changes, so a panel switched to a different row shows the
   * right values instead of the previous row's.
   */
  identity: string | null | undefined,
  /**
   * Writes the record into this component's own form state. Must only
   * touch state of the component that calls the hook.
   */
  hydrate: (record: T) => void,
): boolean {
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null);

  if (shouldHydrate(record != null, identity, hydratedIdentity)) {
    setHydratedIdentity(identity ?? null);
    hydrate(record as T);
  }

  return isHydrated(identity, hydratedIdentity);
}
