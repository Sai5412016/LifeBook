import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_ID_PREFIX,
  SCHEDULE_HORIZON_DAYS,
  formatReminderBody,
  formatReminderTitle,
  givenPlanIds,
  isPlanNotificationId,
  planReminders,
} from './schedule';
import type { MedicationPlan } from './types';

const BERLIN = 'Europe/Berlin';

function plan(overrides: Partial<MedicationPlan> = {}): MedicationPlan {
  return {
    id: 'a',
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
    ...overrides,
  };
}

const base = {
  childFirstName: 'Marina',
  todayLocalDate: '2026-10-09',
  // 07:00 in Berlin (CEST) — before today's 08:00 reminder
  nowUtcIso: '2026-10-09T05:00:00.000Z',
  deviceTz: BERLIN,
  givenTodayPlanIds: new Set<string>(),
};

describe('texts', () => {
  it('title: "Marina: Vitamin D3"', () => {
    expect(formatReminderTitle('Marina', 'Vitamin D3')).toBe('Marina: Vitamin D3');
    expect(formatReminderTitle('  ', 'Vitamin D3')).toBe('Vitamin D3');
  });

  it('body: exactly the specified sentence', () => {
    expect(formatReminderBody({ doseAmount: 1, doseUnit: 'drops' })).toBe(
      '1 Tropfen fällig - schon gegeben? Antippen zum Abhaken.',
    );
    expect(formatReminderBody({ doseAmount: null, doseUnit: null })).toBe(
      'Fällig - schon gegeben? Antippen zum Abhaken.',
    );
  });

  it('never suggests catching up or a bigger dose', () => {
    const text = `${formatReminderTitle('Marina', 'Vitamin D3')} ${formatReminderBody({ doseAmount: 1, doseUnit: 'drops' })}`;
    expect(text).not.toMatch(/nachhol|doppel|zusätzlich|extra|noch einmal|verpasst/i);
  });
});

describe('planReminders — window and rhythm', () => {
  it('a daily plan gets one reminder per day for the next 14 days, starting today', () => {
    const list = planReminders({ ...base, plans: [plan()] });
    expect(list).toHaveLength(SCHEDULE_HORIZON_DAYS);
    expect(list[0].localDate).toBe('2026-10-09');
    expect(list[0].fireAtUtcIso).toBe('2026-10-09T06:00:00.000Z');
    expect(list[list.length - 1].localDate).toBe('2026-10-22');
  });

  it('an every-2nd-day plan gets a reminder only on its due days', () => {
    // start 01.10., interval 2: due on 1,3,5,7,9,11,… -> today (9.) and 11.,13.,15.,17.,19.,21.
    const list = planReminders({ ...base, plans: [plan({ intervalDays: 2 })] });
    expect(list.map((r) => r.localDate)).toEqual([
      '2026-10-09',
      '2026-10-11',
      '2026-10-13',
      '2026-10-15',
      '2026-10-17',
      '2026-10-19',
      '2026-10-21',
    ]);
  });

  it('the window is bounded: nothing beyond the horizon', () => {
    const list = planReminders({ ...base, plans: [plan()], horizonDays: 3 });
    expect(list.map((r) => r.localDate)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(planReminders({ ...base, plans: [plan()], horizonDays: 0 })).toEqual([]);
  });

  it('crosses the month change and keeps the every-2nd-day rhythm', () => {
    const list = planReminders({
      ...base,
      todayLocalDate: '2026-09-29',
      nowUtcIso: '2026-09-29T05:00:00.000Z',
      plans: [plan({ intervalDays: 2, startLocalDate: '2026-09-29' })],
      horizonDays: 6,
    });
    expect(list.map((r) => r.localDate)).toEqual(['2026-09-29', '2026-10-01', '2026-10-03']);
  });

  it('across the clock change on 2026-10-25 the wall-clock time stays 08:00 and the instant moves by one hour', () => {
    const list = planReminders({
      ...base,
      todayLocalDate: '2026-10-23',
      nowUtcIso: '2026-10-23T05:00:00.000Z',
      plans: [plan({ startLocalDate: '2026-10-23' })],
      horizonDays: 5,
    });
    expect(list.map((r) => [r.localDate, r.fireAtUtcIso])).toEqual([
      ['2026-10-23', '2026-10-23T06:00:00.000Z'],
      ['2026-10-24', '2026-10-24T06:00:00.000Z'],
      ['2026-10-25', '2026-10-25T07:00:00.000Z'], // CET: 08:00 = 07:00Z
      ['2026-10-26', '2026-10-26T07:00:00.000Z'],
      ['2026-10-27', '2026-10-27T07:00:00.000Z'],
    ]);
  });

  it('every-2nd-day over the clock change: the long day itself is skipped when the rhythm says so', () => {
    const list = planReminders({
      ...base,
      todayLocalDate: '2026-10-24',
      nowUtcIso: '2026-10-24T04:00:00.000Z',
      plans: [plan({ intervalDays: 2, startLocalDate: '2026-10-24' })],
      horizonDays: 5,
    });
    expect(list.map((r) => r.localDate)).toEqual(['2026-10-24', '2026-10-26', '2026-10-28']);
  });

  it('applies the wall-clock time in the zone the phone is in NOW', () => {
    const list = planReminders({ ...base, deviceTz: 'Europe/London', plans: [plan()], horizonDays: 1 });
    expect(list[0].fireAtUtcIso).toBe('2026-10-09T07:00:00.000Z'); // 08:00 BST
  });
});

describe('planReminders — who gets none', () => {
  it('a paused plan gets none', () => {
    expect(planReminders({ ...base, plans: [plan({ enabled: false })] })).toEqual([]);
  });

  it('a plan with the reminder switched off gets none (it is still due in the app, just silent)', () => {
    expect(planReminders({ ...base, plans: [plan({ remind: false })] })).toEqual([]);
  });

  it('a plan that has not started yet only gets reminders from its start day on', () => {
    const list = planReminders({ ...base, plans: [plan({ startLocalDate: '2026-10-12' })], horizonDays: 6 });
    expect(list.map((r) => r.localDate)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });
});

describe('planReminders — today', () => {
  it("today's reminder is cancelled once the medicine is already given today ...", () => {
    const list = planReminders({ ...base, plans: [plan()], givenTodayPlanIds: new Set(['a']), horizonDays: 3 });
    expect(list.map((r) => r.localDate)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('... but only for that plan, and only for today', () => {
    const b = plan({ id: 'b', name: 'Eisen' });
    const list = planReminders({ ...base, plans: [plan(), b], givenTodayPlanIds: new Set(['a']), horizonDays: 2 });
    expect(list.map((r) => `${r.localDate}/${r.planId}`)).toEqual(['2026-10-09/b', '2026-10-10/a', '2026-10-10/b']);
  });

  it('nothing for a reminder time that has already passed today', () => {
    const list = planReminders({ ...base, nowUtcIso: '2026-10-09T07:00:00.000Z', plans: [plan()], horizonDays: 2 }); // 09:00 Berlin
    expect(list.map((r) => r.localDate)).toEqual(['2026-10-10']);
  });

  it('nothing for a moment that is only seconds away (scheduling it would be pointless)', () => {
    const list = planReminders({ ...base, nowUtcIso: '2026-10-09T05:59:50.000Z', plans: [plan()], horizonDays: 1 });
    expect(list).toEqual([]);
  });
});

describe('planReminders — shape', () => {
  it('uses deterministic ids so a plan/day can be replaced or cancelled by id', () => {
    const [first] = planReminders({ ...base, plans: [plan()], horizonDays: 1 });
    expect(first.identifier).toBe('medplan:a:2026-10-09');
    expect(isPlanNotificationId(first.identifier)).toBe(true);
    expect(first.identifier.startsWith(NOTIFICATION_ID_PREFIX)).toBe(true);
  });

  it('isPlanNotificationId does not claim other notifications', () => {
    expect(isPlanNotificationId('e1f2a3')).toBe(false);
    expect(isPlanNotificationId('push:photos')).toBe(false);
  });

  it('is sorted by fire time across plans', () => {
    const early = plan({ id: 'e', name: 'Eisen', remindTime: '07:30' }); // 'now' is 07:00 Berlin
    const late = plan({ id: 'l', name: 'Zink', remindTime: '19:00' });
    const list = planReminders({ ...base, plans: [late, early], horizonDays: 2 });
    expect(list.map((r) => r.identifier)).toEqual([
      'medplan:e:2026-10-09',
      'medplan:l:2026-10-09',
      'medplan:e:2026-10-10',
      'medplan:l:2026-10-10',
    ]);
  });

  it('carries title and body of the plan', () => {
    const [first] = planReminders({ ...base, plans: [plan()], horizonDays: 1 });
    expect(first.title).toBe('Marina: Vitamin D3');
    expect(first.body).toBe('1 Tropfen fällig - schon gegeben? Antippen zum Abhaken.');
  });

  it('is empty for no plans', () => {
    expect(planReminders({ ...base, plans: [] })).toEqual([]);
  });
});

describe('givenPlanIds', () => {
  const entry = (name: string, localDate: string, deleted: string | null = null) => ({
    name,
    dose_amount: 1,
    dose_unit: 'drops' as const,
    occurred_at: `${localDate}T07:00:00.000Z`,
    local_date: localDate,
    deleted_at: deleted,
  });

  it('lists the plans whose medicine has an entry on that day', () => {
    const plans = [plan({ id: 'a', name: 'Vitamin D3' }), plan({ id: 'b', name: 'Eisen' })];
    expect([...givenPlanIds(plans, [entry('vitamin d3', '2026-10-09')], '2026-10-09')]).toEqual(['a']);
  });

  it('ignores entries of other days and soft-deleted entries (an undone tap re-enables the reminder)', () => {
    const plans = [plan()];
    expect(givenPlanIds(plans, [entry('Vitamin D3', '2026-10-08')], '2026-10-09').size).toBe(0);
    expect(givenPlanIds(plans, [entry('Vitamin D3', '2026-10-09', '2026-10-09T08:00:00.000Z')], '2026-10-09').size).toBe(0);
  });
});
