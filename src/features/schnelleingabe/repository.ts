/**
 * schnelleingabe — repository (Spec §4 rule: features access data ONLY
 * through here). Thin orchestration only: every actual read/write happens
 * through the OWNING feature's own repository (feeding/diaper/medication) —
 * this file just resolves the right defaults (./logic.ts) and calls
 * through, so the same insert/update code paths — and their existing tests —
 * keep covering these writes too. Same "orchestration feature calls the
 * owning features' repositories directly" convention as
 * features/berichte/repository.ts's CSV export.
 */

import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { formatTimeLabel, nowUtcIso } from '@/core/time';
import { defaultLogTime } from '@/core/tracking/day-selection';
import type { DiaperKind } from '@/features/diaper/types';
import { logDiaper } from '@/features/diaper/repository';
import { logBottle } from '@/features/feeding/repository';
import type { BottleKind, FeedType } from '@/features/feeding/types';
import type { MedicationFavorite } from '@/features/medication/logic';
import { resolveGabeOccurredAt } from '@/features/medication/logic';
import { gabeEintragen } from '@/features/medication/repository';
import type { MedicationDoseUnit, MedicationRoute } from '@/features/medication/types';

import { letzterFlaschentyp, SCHNELL_BACKFILL_TIME } from './logic';
import type { BottleFeedLike } from './logic';

export type SchnellContext = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  selectedLocalDate: string;
  todayLocalDate: string;
};

/** `undefined` (=> "jetzt") while the selected day is today, otherwise noon of the selected day — never silently "heute" (task requirement). */
function backdateFor(ctx: SchnellContext): { localDate: string; time: string } | undefined {
  return ctx.selectedLocalDate === ctx.todayLocalDate
    ? undefined
    : { localDate: ctx.selectedLocalDate, time: SCHNELL_BACKFILL_TIME };
}

export type SchnellFlascheResult = {
  id: string;
  occurredAtUtcIso: string;
  feedType: FeedType;
  amountMl: number | null;
};

/**
 * "Flasche"-Tipp: der zuletzt benutzte Flaschentyp dieses Kindes (sonst der
 * Standardwert) mit dessen eigener zuletzt benutzten Menge (sonst null),
 * needs_review = 1 — Menge/Typ sind noch nicht geprüft (task requirement).
 * `recentFeeds` kommt vom Aufrufer (useRecentFeedsForChild), damit diese
 * Datei selbst keine eigene Abfrage gegen `feeds` hält.
 */
export async function schnellFlasche(
  db: AbstractPowerSyncDatabase,
  ctx: SchnellContext,
  recentFeeds: readonly BottleFeedLike[],
): Promise<SchnellFlascheResult> {
  const { feedType, amountMl } = letzterFlaschentyp(recentFeeds);
  const kind: BottleKind = feedType === 'bottle_formula' ? 'formula' : 'breastmilk';

  const { id, occurredAtUtcIso } = await logBottle(db, {
    householdId: ctx.householdId,
    childId: ctx.childId,
    userId: ctx.userId,
    tz: ctx.tz,
    amountMl,
    kind,
    needsReview: 1,
    ...(backdateFor(ctx) ?? {}),
  });

  return { id, occurredAtUtcIso, feedType, amountMl };
}

export type SchnellWindelResult = { id: string; occurredAtUtcIso: string; kind: DiaperKind };

/** "Windel nass"/"Windel Stuhl"-Tipp: ein Tipp erfasst die Windel vollständig — kein needs_review (die Spalte existiert bei diapers gar nicht). */
export async function schnellWindel(
  db: AbstractPowerSyncDatabase,
  ctx: SchnellContext,
  kind: DiaperKind,
): Promise<SchnellWindelResult> {
  const { id, occurredAtUtcIso } = await logDiaper(db, {
    householdId: ctx.householdId,
    childId: ctx.childId,
    userId: ctx.userId,
    tz: ctx.tz,
    kind,
    ...(backdateFor(ctx) ?? {}),
  });

  return { id, occurredAtUtcIso, kind };
}

export type SchnellMedikamentResult = {
  id: string;
  occurredAtUtcIso: string;
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
};

/**
 * Ein Tipp auf einen Favoriten im Medikament-Bottom-Sheet: speichert ihn
 * sofort mit Name, Dosis und Einheit — derselbe Favoriten-Mechanismus wie im
 * Medikamente-Bereich (favoritenAusVerlauf), kein neuer (task requirement).
 * `gabeEintragen` verlangt bereits ein aufgelöstes localDate/time-Paar (kein
 * optionales Backdating wie logBottle/logDiaper) — dieselbe Umrechnung wie
 * MedicationSection's eigener Quick-Tap (`defaultLogTime`), damit ein
 * Rückgriff auf `resolveGabeOccurredAt` danach exakt denselben Zeitpunkt
 * liefert, den `gabeEintragen` tatsächlich geschrieben hat.
 */
export async function schnellMedikament(
  db: AbstractPowerSyncDatabase,
  ctx: SchnellContext,
  favorite: MedicationFavorite,
): Promise<SchnellMedikamentResult | null> {
  const nowTimeLabel = formatTimeLabel(nowUtcIso(), ctx.tz);
  const time = defaultLogTime(ctx.selectedLocalDate, ctx.todayLocalDate, nowTimeLabel);
  const localDate = ctx.selectedLocalDate;

  const id = await gabeEintragen(db, {
    householdId: ctx.householdId,
    childId: ctx.childId,
    userId: ctx.userId,
    tz: ctx.tz,
    name: favorite.name,
    doseAmount: favorite.doseAmount,
    doseUnit: favorite.doseUnit,
    route: favorite.route,
    localDate,
    time,
    note: null,
  });
  if (!id) {
    return null;
  }

  const resolved = resolveGabeOccurredAt(localDate, time, ctx.tz);
  if (!resolved) {
    return null;
  }

  return {
    id,
    occurredAtUtcIso: resolved.occurredAtUtcIso,
    name: favorite.name,
    doseAmount: favorite.doseAmount,
    doseUnit: favorite.doseUnit,
    route: favorite.route,
  };
}
