/**
 * ui/use-hydrate-once — the one approved way to seed a form's editable
 * local state from data that loads asynchronously (a PowerSync `useQuery`,
 * a direct Supabase fetch, anything that starts out `null`/`undefined`
 * and resolves later).
 *
 * THE BUG THIS EXISTS TO PREVENT
 * -------------------------------
 * `useState(initialValue)` only ever evaluates `initialValue` on a
 * component's VERY FIRST render. React never re-runs it when props or a
 * query result change later. A component that calls
 * `useState(child?.firstName ?? '')` while `child` is still `null` (the
 * query hasn't resolved yet) therefore seeds its field with `''` — and
 * stays `''` forever, even once `child` arrives on a later render,
 * because nothing ever tells that `useState` call to run again.
 *
 * Found 2026-08-17 in src/app/kind/bearbeiten.tsx: every field pre-filled
 * empty despite complete data in the database, because the screen read
 * `useActiveChild()` and seeded its `useState`s from `child` before the
 * reactive query had resolved on first mount — and NEVER updated
 * afterwards. The actual damage isn't the empty display; it's that
 * `handleSave` still fires once `child` DOES arrive (by the time a user
 * has read the screen and tapped Speichern, the query has long since
 * resolved), silently overwriting weight/length/head-circumference/
 * birthplace with blanks. A form that can save data it never actually
 * loaded is the real defect, not just the empty fields.
 *
 * WHAT THIS HOOK GUARANTEES
 * --------------------------
 * `hydrate(value)` runs exactly ONCE — the first moment `loading` is
 * false and `value` is not null/undefined — and never again, even if
 * `value` changes afterwards (a background refetch must not silently
 * clobber an edit the user is mid-way through; only the FIRST arrival of
 * real data may seed the form). The returned boolean is what a caller
 * gates "Speichern" and the field's loading state on — false until
 * hydration has actually happened, never a brief false-positive true.
 */

import { useEffect, useRef, useState } from 'react';

export function useHydrateOnce<T>(
  value: T | null | undefined,
  loading: boolean,
  hydrate: (value: T) => void,
): boolean {
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydratedRef.current || loading || value == null) {
      return;
    }
    hydratedRef.current = true;
    hydrate(value);
    setHydrated(true);
    // `hydrate` is intentionally excluded: it is expected to be a fresh
    // closure every render (a bundle of setState calls), and re-running
    // this effect for that reason alone would defeat the "exactly once"
    // guarantee this hook exists to provide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loading]);

  return hydrated;
}
