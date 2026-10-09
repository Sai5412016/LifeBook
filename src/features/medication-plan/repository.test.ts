import { describe, expect, it, vi } from 'vitest';

// The real package needs React Native. Only `useQuery` is a runtime import of
// the repositories under test, and this file calls none of the hooks — it
// drives the plain async write functions with a recording stand-in database.
vi.mock('@powersync/react-native', () => ({ useQuery: vi.fn() }));

import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { schnellMedikament } from '@/features/schnelleingabe/repository';
import type { SchnellContext } from '@/features/schnelleingabe/repository';

import { planAsFavorite } from './logic';
import {
  addMedicationPlan,
  deleteMedicationPlan,
  setMedicationPlanEnabled,
  updateMedicationPlan,
} from './repository';
import type { MedicationPlan, ReminderRow } from './types';

const BERLIN = 'Europe/Berlin';

type Call = { sql: string; params: readonly unknown[] };

function fakeDb(rows: ReminderRow[] = []) {
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

function reminderRow(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'plan-1',
    household_id: 'h1',
    child_id: 'c1',
    occurred_at: '2026-10-09T06:00:00.000Z',
    tz: BERLIN,
    local_date: '2026-10-09',
    created_by: 'u1',
    created_at: '2026-10-09T05:00:00.000Z',
    updated_at: '2026-10-09T05:00:00.000Z',
    deleted_at: null,
    source_device_id: null,
    note: '{"kind":"medication_plan","dose_amount":1,"dose_unit":"drops","route":"oral"}',
    title: 'Vitamin D3',
    description: null,
    trigger_age_days: null,
    trigger_at: '2026-10-09T06:00:00.000Z',
    repeat_rule: 'FREQ=DAILY;INTERVAL=1',
    enabled: 1,
    last_fired_at: null,
    ...overrides,
  };
}

const plan: MedicationPlan = {
  id: 'plan-1',
  householdId: 'h1',
  childId: 'c1',
  name: 'Vitamin D3',
  doseAmount: 1,
  doseUnit: 'drops',
  route: 'oral',
  intervalDays: 1,
  startLocalDate: '2026-10-09',
  remindTime: '08:00',
  remind: true,
  enabled: true,
  tz: BERLIN,
};

describe('Abhaken: one tap on a "Heute fällig" row', () => {
  const ctx = (selectedLocalDate: string, todayLocalDate: string): SchnellContext => ({
    householdId: 'h1',
    childId: 'c1',
    userId: 'u1',
    tz: BERLIN,
    selectedLocalDate,
    todayLocalDate,
  });

  it('writes exactly ONE medications row, carrying the plan dose — and nothing else', async () => {
    const { db, executed } = fakeDb();
    const result = await schnellMedikament(db, ctx('2026-10-09', '2026-10-09'), planAsFavorite(plan));

    expect(result).not.toBeNull();
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/^\s*INSERT INTO medications/);
    // id, household, child, occurred_at, tz, local_date, created_by, created_at, updated_at, deleted_at,
    // source_device_id, note, name, dose_amount, dose_unit, route, reason
    const p = executed[0].params;
    expect(p[1]).toBe('h1');
    expect(p[2]).toBe('c1');
    expect(p[4]).toBe(BERLIN);
    expect(p[6]).toBe('u1');
    expect(p[12]).toBe('Vitamin D3'); // name
    expect(p[13]).toBe(1); // dose_amount — exactly the plan dose, never a multiple
    expect(p[14]).toBe('drops'); // dose_unit
    expect(p[15]).toBe('oral'); // route
    expect(result!.name).toBe('Vitamin D3');
    expect(result!.doseAmount).toBe(1);
  });

  it('files a tick on a past day under THAT day at noon (Nachtragen), still one row', async () => {
    const { db, executed } = fakeDb();
    const result = await schnellMedikament(db, ctx('2026-10-07', '2026-10-09'), planAsFavorite(plan));

    expect(executed).toHaveLength(1);
    expect(executed[0].params[5]).toBe('2026-10-07'); // local_date
    expect(result!.occurredAtUtcIso).toBe('2026-10-07T10:00:00.000Z'); // 12:00 CEST
  });

  it('a plan without a dose writes a row without a dose (nothing is invented)', async () => {
    const { db, executed } = fakeDb();
    await schnellMedikament(
      db,
      ctx('2026-10-09', '2026-10-09'),
      planAsFavorite({ ...plan, doseAmount: null, doseUnit: null }),
    );
    expect(executed[0].params[13]).toBeNull();
    expect(executed[0].params[14]).toBeNull();
  });
});

describe('addMedicationPlan', () => {
  const addCtx = { householdId: 'h1', childId: 'c1', userId: 'u1', tz: BERLIN };
  const values = {
    name: 'Vitamin D3',
    doseAmount: 1,
    doseUnit: 'drops' as const,
    route: 'oral' as const,
    intervalDays: 2,
    startLocalDate: '2026-10-09',
    remind: true,
    remindTime: '08:00',
  };

  it('inserts one reminders row with the specified column mapping and nothing into medications', async () => {
    const { db, executed } = fakeDb();
    const id = await addMedicationPlan(db, addCtx, values);

    expect(id).toEqual(expect.any(String));
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/INSERT INTO reminders/);
    expect(executed[0].sql).not.toMatch(/medications/);
    const p = executed[0].params;
    expect(p[0]).toBe(id);
    expect(p[1]).toBe('h1');
    expect(p[2]).toBe('c1');
    expect(p[3]).toBe('2026-10-09T06:00:00.000Z'); // occurred_at = trigger_at
    expect(p[4]).toBe(BERLIN); // tz = device zone
    expect(p[5]).toBe('2026-10-09'); // local_date
    expect(p[6]).toBe('u1');
    expect(JSON.parse(p[9] as string)).toEqual({
      kind: 'medication_plan',
      dose_amount: 1,
      dose_unit: 'drops',
      route: 'oral',
      remind: true,
    }); // note
    expect(p[10]).toBe('Vitamin D3'); // title
    expect(p[11]).toBe('2026-10-09T06:00:00.000Z'); // trigger_at
    expect(p[12]).toBe('FREQ=DAILY;INTERVAL=2'); // repeat_rule
    expect(executed[0].sql).toMatch(/, 1, NULL\)\s*$/); // enabled = 1, last_fired_at NULL
  });

  it('writes nothing for values that cannot form a plan', async () => {
    const { db, executed } = fakeDb();
    expect(await addMedicationPlan(db, addCtx, { ...values, name: ' ' })).toBeNull();
    expect(await addMedicationPlan(db, addCtx, { ...values, startLocalDate: 'x' })).toBeNull();
    expect(executed).toHaveLength(0);
  });
});

describe('changing a plan', () => {
  const values = {
    name: 'Vitamin D3',
    doseAmount: 2,
    doseUnit: 'drops' as const,
    route: 'oral' as const,
    intervalDays: 1,
    startLocalDate: '2026-10-24',
    remind: true,
    remindTime: '08:00',
  };

  it("an edit re-derives the instant in the ROW's stored zone, not the fallback / device zone", async () => {
    const { db, executed } = fakeDb([reminderRow()]);
    const ok = await updateMedicationPlan(db, 'plan-1', values, 'America/New_York');

    expect(ok).toBe(true);
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/^\s*UPDATE reminders/);
    const p = executed[0].params;
    expect(JSON.parse(p[1] as string).dose_amount).toBe(2);
    expect(p[3]).toBe('2026-10-24T06:00:00.000Z'); // trigger_at: 08:00 Berlin (CEST), not New York
    expect(p[4]).toBe(p[3]); // occurred_at = trigger_at
    expect(p[5]).toBe('2026-10-24'); // local_date moves WITH the instant
    expect(p[7]).toBe('plan-1');
    // enabled is never touched by an edit
    expect(executed[0].sql).not.toMatch(/enabled/);
  });

  it('pause and resume flip only `enabled`', async () => {
    const paused = fakeDb([reminderRow()]);
    expect(await setMedicationPlanEnabled(paused.db, 'plan-1', false, BERLIN)).toBe(true);
    expect(paused.executed[0].sql).toMatch(/SET enabled = \?, updated_at = \?/);
    expect(paused.executed[0].params[0]).toBe(0);

    const resumed = fakeDb([reminderRow({ enabled: 0 })]);
    expect(await setMedicationPlanEnabled(resumed.db, 'plan-1', true, BERLIN)).toBe(true);
    expect(resumed.executed[0].params[0]).toBe(1);
  });

  it('delete is a soft delete', async () => {
    const { db, executed } = fakeDb([reminderRow()]);
    expect(await deleteMedicationPlan(db, 'plan-1', BERLIN)).toBe(true);
    expect(executed[0].sql).toMatch(/SET deleted_at = \?, updated_at = \?/);
    expect(executed[0].sql).not.toMatch(/DELETE FROM/);
  });

  it.each([
    ['another feature\'s row (other kind)', reminderRow({ note: '{"kind":"age_reminder","u":"U4"}' })],
    ['a row with a broken note', reminderRow({ note: '{kaputt' })],
    ['a row with no note', reminderRow({ note: null })],
    ['an already deleted plan', reminderRow({ deleted_at: '2026-10-10T00:00:00.000Z' })],
    ['a row with an unreadable rule', reminderRow({ repeat_rule: 'FREQ=YEARLY' })],
  ])('never edits, pauses or deletes %s', async (_label, foreign) => {
    const { db, executed } = fakeDb([foreign]);
    expect(await updateMedicationPlan(db, foreign.id, values, BERLIN)).toBe(false);
    expect(await setMedicationPlanEnabled(db, foreign.id, false, BERLIN)).toBe(false);
    expect(await deleteMedicationPlan(db, foreign.id, BERLIN)).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it('does nothing for an unknown id', async () => {
    const { db, executed } = fakeDb([]);
    expect(await updateMedicationPlan(db, 'nope', values, BERLIN)).toBe(false);
    expect(await setMedicationPlanEnabled(db, 'nope', true, BERLIN)).toBe(false);
    expect(await deleteMedicationPlan(db, 'nope', BERLIN)).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it('an edit with unusable values writes nothing', async () => {
    const { db, executed } = fakeDb([reminderRow()]);
    expect(await updateMedicationPlan(db, 'plan-1', { ...values, name: '' }, BERLIN)).toBe(false);
    expect(executed).toHaveLength(0);
  });
});
