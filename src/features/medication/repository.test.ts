import { describe, expect, it, vi } from 'vitest';

// The real package needs React Native. Only `useQuery` is a runtime import of
// the repository under test, and this file calls none of the hooks — it drives
// the plain async write functions with a recording stand-in database.
vi.mock('@powersync/react-native', () => ({ useQuery: vi.fn() }));

import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { dayMarkersFor } from '@/core/tracking/day-markers';
import { berichtBerechnen } from '@/features/berichte/logic';
import type { BerichtDaten } from '@/features/berichte/logic';
import { gabeFuerPlan } from '@/features/medication-plan/logic';
import { givenPlanIds, planReminders } from '@/features/medication-plan/schedule';
import type { MedicationPlan } from '@/features/medication-plan/types';
import { buildDayTimeline } from '@/features/timeline/logic';

import { gabeAendern, gabeLoeschen, gabeWiederherstellen } from './repository';
import type { MedicationRow } from './types';

const BERLIN = 'Europe/Berlin';

type Call = { sql: string; params: readonly unknown[] };

/** A recording database: `rows` is what every SELECT returns, every write is only recorded. */
function fakeDb(rows: unknown[] = []) {
  const executed: Call[] = [];
  const db = {
    execute: async (sql: string, params: readonly unknown[] = []) => {
      executed.push({ sql, params });
      return { rowsAffected: 1 };
    },
    getAll: async () => rows,
  } as unknown as AbstractPowerSyncDatabase;
  return { db, executed };
}

function dose(overrides: Partial<MedicationRow> = {}): MedicationRow {
  return {
    id: 'm1',
    household_id: 'h1',
    child_id: 'c1',
    occurred_at: '2026-10-09T07:12:00.000Z', // 09:12 Berlin
    tz: BERLIN,
    local_date: '2026-10-09',
    created_by: 'u1',
    created_at: '2026-10-09T07:12:00.000Z',
    updated_at: '2026-10-09T07:12:00.000Z',
    deleted_at: null,
    source_device_id: null,
    note: null,
    name: 'Vitamin D3',
    dose_amount: 4,
    dose_unit: 'drops',
    route: 'oral',
    reason: null,
    ...overrides,
  };
}

describe('gabeAendern — corrects exactly one row', () => {
  it('writes ONE UPDATE, scoped by that id, and nothing else', async () => {
    const { db, executed } = fakeDb([dose()]);
    await gabeAendern(db, 'm1', { doseAmount: 1 }); // the quadruple dose entered by mistake -> 1
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/UPDATE medications/);
    expect(executed[0].sql).toMatch(/WHERE id = \?/);
    expect(executed[0].params[executed[0].params.length - 1]).toBe('m1');
    expect(executed[0].sql).not.toMatch(/DELETE/i);
  });

  it('changes only the fields that were given; everything else is written back unchanged', async () => {
    const { db, executed } = fakeDb([dose({ note: 'nach dem Stillen' })]);
    await gabeAendern(db, 'm1', { doseAmount: 1 });
    const [occurredAt, localDate, name, doseAmount, doseUnit, route, note] = executed[0].params;
    expect([occurredAt, localDate, name, doseAmount, doseUnit, route, note]).toEqual([
      '2026-10-09T07:12:00.000Z',
      '2026-10-09',
      'Vitamin D3',
      1,
      'drops',
      'oral',
      'nach dem Stillen',
    ]);
  });

  it('can change name, unit, route and clear the note', async () => {
    const { db, executed } = fakeDb([dose({ note: 'x' })]);
    await gabeAendern(db, 'm1', { name: 'Vitamin K', doseUnit: 'ml', route: 'bottle', note: null });
    const [, , name, , doseUnit, route, note] = executed[0].params;
    expect([name, doseUnit, route, note]).toEqual(['Vitamin K', 'ml', 'bottle', null]);
  });

  it('a date change re-derives occurred_at AND local_date together, in the entry\'s own zone', async () => {
    const { db, executed } = fakeDb([dose()]);
    await gabeAendern(db, 'm1', { localDate: '2026-10-08', time: '21:30' });
    const [occurredAt, localDate] = executed[0].params;
    expect(localDate).toBe('2026-10-08');
    expect(occurredAt).toBe('2026-10-08T19:30:00.000Z'); // 21:30 CEST
  });

  it('00:15 Berlin keeps its local day although the UTC day is the day before', async () => {
    const { db, executed } = fakeDb([dose()]);
    await gabeAendern(db, 'm1', { localDate: '2026-10-09', time: '00:15' });
    const [occurredAt, localDate] = executed[0].params;
    expect(occurredAt).toBe('2026-10-08T22:15:00.000Z');
    expect(localDate).toBe('2026-10-09');
  });

  it('uses the row\'s stored zone, not the zone the phone is in now', async () => {
    const { db, executed } = fakeDb([dose({ tz: 'America/New_York', occurred_at: '2026-10-09T12:00:00.000Z' })]);
    await gabeAendern(db, 'm1', { localDate: '2026-10-09', time: '08:00' });
    expect(executed[0].params[0]).toBe('2026-10-09T12:00:00.000Z'); // 08:00 EDT
  });

  it('a time alone (no date) is ignored — date and time travel together', async () => {
    const { db, executed } = fakeDb([dose()]);
    await gabeAendern(db, 'm1', { time: '23:00' });
    expect(executed[0].params[0]).toBe('2026-10-09T07:12:00.000Z');
    expect(executed[0].params[1]).toBe('2026-10-09');
  });

  it('writes nothing for an unknown id', async () => {
    const { db, executed } = fakeDb([]);
    await gabeAendern(db, 'nope', { doseAmount: 1 });
    expect(executed).toEqual([]);
  });
});

describe('gabeLoeschen — soft delete', () => {
  it('sets deleted_at on that one id and never issues a DELETE', async () => {
    const { db, executed } = fakeDb();
    await gabeLoeschen(db, 'm1');
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/UPDATE medications SET deleted_at = \?/);
    expect(executed[0].sql).toMatch(/WHERE id = \?/);
    expect(executed[0].sql).not.toMatch(/DELETE FROM/i);
    expect(typeof executed[0].params[0]).toBe('string');
    expect(executed[0].params[executed[0].params.length - 1]).toBe('m1');
  });
});

describe('gabeWiederherstellen — Rückgängig', () => {
  it('clears deleted_at on a deleted row, touching only that id', async () => {
    const { db, executed } = fakeDb([{ id: 'm1' }]);
    expect(await gabeWiederherstellen(db, 'm1')).toBe(true);
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/SET deleted_at = NULL/);
    expect(executed[0].sql).toMatch(/WHERE id = \?/);
    expect(executed[0].params[executed[0].params.length - 1]).toBe('m1');
  });

  it('is a no-op for a row that is not deleted (a stale second tap rewrites nothing)', async () => {
    const { db, executed } = fakeDb([]); // the SELECT ... deleted_at IS NOT NULL finds nothing
    expect(await gabeWiederherstellen(db, 'm1')).toBe(false);
    expect(executed).toEqual([]);
  });
});

describe('a deleted dose disappears from every view — and a restored one comes back', () => {
  const live = dose();
  const deleted = dose({ deleted_at: '2026-10-09T08:00:00.000Z' });
  const restored = dose({ deleted_at: null });

  const timelineOf = (row: MedicationRow) => buildDayTimeline({ medications: [row] }, '2026-10-09T09:00:00.000Z');

  it('Tagesverlauf', () => {
    expect(timelineOf(live)).toHaveLength(1);
    expect(timelineOf(deleted)).toHaveLength(0);
    expect(timelineOf(restored)).toHaveLength(1);
  });

  it('Kalenderpunkte', () => {
    const markers = (row: MedicationRow) => dayMarkersFor(['2026-10-09'], [], [row], []).get('2026-10-09');
    expect(markers(live)?.hasMedication).toBe(true);
    expect(markers(deleted)?.hasMedication).toBe(false);
    expect(markers(restored)?.hasMedication).toBe(true);
  });

  it('Tagessummen / Bericht', () => {
    const report = (row: MedicationRow) => {
      const daten: BerichtDaten = { feeds: [], diapers: [], sleeps: [], medications: [row], growthMeasurements: [] };
      return berichtBerechnen(['2026-10-09'], daten, '2026-10-09');
    };
    expect(report(live).medications[0]?.countInPeriod).toBe(1);
    expect(report(deleted).medications).toEqual([]);
    expect(report(restored).medications[0]?.countInPeriod).toBe(1);
  });

  it('"Heute fällig": the row flips from ✓ back to ☐ and returns after Rückgängig', () => {
    expect(gabeFuerPlan([live], 'Vitamin D3', '2026-10-09')).not.toBeNull();
    expect(gabeFuerPlan([deleted], 'Vitamin D3', '2026-10-09')).toBeNull();
    expect(gabeFuerPlan([restored], 'Vitamin D3', '2026-10-09')).not.toBeNull();
  });
});

describe('Erinnerungsplanung nach dem Löschen der heutigen Gabe', () => {
  const plan: MedicationPlan = {
    id: 'plan-1',
    householdId: 'h1',
    childId: 'c1',
    name: 'Vitamin D3',
    doseAmount: 1,
    doseUnit: 'drops',
    route: 'oral',
    intervalDays: 1,
    startLocalDate: '2026-10-01',
    remindTime: '08:00',
    remind: true,
    enabled: true,
    tz: BERLIN,
  };
  // 07:00 in Berlin — today's 08:00 reminder is still ahead.
  const nowUtcIso = '2026-10-09T05:00:00.000Z';

  const todaysReminder = (row: MedicationRow) =>
    planReminders({
      plans: [plan],
      childFirstName: 'Marina',
      todayLocalDate: '2026-10-09',
      nowUtcIso,
      deviceTz: BERLIN,
      givenTodayPlanIds: givenPlanIds([plan], [row], '2026-10-09'),
    }).find((reminder) => reminder.localDate === '2026-10-09');

  it('today\'s dose entered -> today\'s reminder is off; deleted -> it is planned again; restored -> off again', () => {
    expect(todaysReminder(dose())).toBeUndefined();
    expect(todaysReminder(dose({ deleted_at: '2026-10-09T05:30:00.000Z' }))).toBeDefined();
    expect(todaysReminder(dose({ deleted_at: null }))).toBeUndefined();
  });

  it('deleting a dose does not touch tomorrow\'s reminder', () => {
    const tomorrow = planReminders({
      plans: [plan],
      childFirstName: 'Marina',
      todayLocalDate: '2026-10-09',
      nowUtcIso,
      deviceTz: BERLIN,
      givenTodayPlanIds: givenPlanIds([plan], [dose({ deleted_at: '2026-10-09T05:30:00.000Z' })], '2026-10-09'),
    }).filter((reminder) => reminder.localDate === '2026-10-10');
    expect(tomorrow).toHaveLength(1);
  });
});
