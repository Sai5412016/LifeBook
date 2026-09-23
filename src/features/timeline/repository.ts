/**
 * timeline — repository (Spec §4 rule: features access data ONLY through
 * here). Pure orchestration: every actual read happens through the OWNING
 * feature's own repository — this file only calls the eight already-day-
 * (or range-)scoped hooks and hands the results to ./logic.ts's pure merge/
 * group functions. Same "orchestration feature calls the owning features'
 * repositories directly" convention as features/schnelleingabe/repository.ts.
 */

import type { BerichtDaten } from '@/features/berichte/logic';
import { dayMarkersFor } from '@/core/tracking/day-markers';
import type { DayMarkers } from '@/core/tracking/day-markers';
import { useDiapersInRange, useDiapersOfDay } from '@/features/diaper/repository';
import { useFeedsInRange, useFeedsOfDay } from '@/features/feeding/repository';
import { useGrowthOfDay } from '@/features/growth/repository';
import { useGabenDesTages, useGabenInRange } from '@/features/medication/repository';
import { useNotesOfDay } from '@/features/notes/repository';
import { usePumpingOfDay } from '@/features/pumping/repository';
import { useSleepsOfDay } from '@/features/sleep/repository';
import { useTemperaturesOfDay } from '@/features/temperature/repository';

import { buildDayTimeline } from './logic';
import type { TimelineEntry } from './types';

export type DayData = { timeline: TimelineEntry[]; berichtDaten: BerichtDaten };

/**
 * Reactive: everything the Alltag tab needs for ONE selected day — the
 * merged, sorted Tagesverlauf AND the raw per-table rows in the shape
 * features/berichte/logic.ts#berichtBerechnen expects (for
 * components/day-chips.tsx). ONE set of queries feeds both, each already
 * scoped to `localDate` by its own OWNING feature's `useXOfDay` hook — no
 * separate SQL of its own, and no second query set duplicating the first.
 */
export function useDayData(childId: string | undefined, localDate: string | undefined, jetzt: string): DayData {
  const { feeds } = useFeedsOfDay(childId, localDate);
  const { diapers } = useDiapersOfDay(childId, localDate);
  const { gaben: medications } = useGabenDesTages(childId, localDate);
  const { sleeps } = useSleepsOfDay(childId, localDate);
  const pumpingSessions = usePumpingOfDay(childId, localDate);
  const growthMeasurements = useGrowthOfDay(childId, localDate);
  const temperatures = useTemperaturesOfDay(childId, localDate);
  const notes = useNotesOfDay(childId, localDate);

  const timeline = buildDayTimeline(
    { feeds, diapers, medications, sleeps, pumpingSessions, growthMeasurements, temperatures, notes },
    jetzt,
  );
  const berichtDaten: BerichtDaten = { feeds, diapers, sleeps, medications, growthMeasurements };

  return { timeline, berichtDaten };
}

/**
 * Reactive: which of the three calendar categories (Mahlzeit/Medikament/
 * Windel) each day in `days` has at least one entry for — ONE range query
 * per table for the whole displayed week/month (task requirement: not one
 * per day), reusing each feature's own existing `useXInRange` hook.
 */
export function useDayMarkersForRange(
  childId: string | undefined,
  fromLocalDate: string | undefined,
  toLocalDate: string | undefined,
  days: readonly string[],
): Map<string, DayMarkers> {
  const feeds = useFeedsInRange(childId, fromLocalDate, toLocalDate);
  const medications = useGabenInRange(childId, fromLocalDate, toLocalDate);
  const diapers = useDiapersInRange(childId, fromLocalDate, toLocalDate);

  return dayMarkersFor(days, feeds, medications, diapers);
}
