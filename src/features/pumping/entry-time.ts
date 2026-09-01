/**
 * pumping/entry-time — the "war das gestern?" heuristic for a manually
 * corrected time in the entry sheet. Pure string comparison, no Expo/React
 * Native import, no time construction — the actual instant is built in
 * core/time (combineLocalDateAndTime), this only decides WHICH calendar
 * day to build it on.
 *
 * WHY A HEURISTIC INSTEAD OF A DATE PICKER
 * -------------------------------------------
 * A pumping entry is a NACHTRAG (a backdated log of something that already
 * happened), never a plan for the future. So if the entered clock time is
 * LATER than the current one, the only sensible reading is "that was
 * yesterday" — a session at 23:40 entered at 00:20 cannot mean "23:40
 * later today". A second picker for the day would cost a fourth
 * interaction and defeat the sheet's own "under ten seconds" requirement;
 * this heuristic needs none, because there is exactly one day a later
 * clock time can plausibly mean.
 *
 * Only ever asked for MANUALLY entered times. "Jetzt" (the default, never
 * edited) is by definition today and never runs through this function.
 */

/**
 * Whether `enteredHhMm` belongs to yesterday rather than today, given the
 * current wall-clock time `nowHhMm` — true exactly when the entered time
 * is strictly later than now. Both are "HH:mm", zero-padded (as
 * core/time#formatTimeLabel always produces), so a plain string compare
 * is a correct time-of-day compare too — no parsing, nothing that could
 * disagree with how the caller got `nowHhMm` in the first place.
 *
 * An entered time equal to `nowHhMm` reads as today (not "later"), and a
 * malformed input never backdates — a broken string must not silently
 * move a session to the wrong day.
 */
function isValidHhMm(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59;
}

export function isBackdatedToYesterday(enteredHhMm: string, nowHhMm: string): boolean {
  if (!isValidHhMm(enteredHhMm) || !isValidHhMm(nowHhMm)) {
    return false;
  }
  return enteredHhMm > nowHhMm;
}
