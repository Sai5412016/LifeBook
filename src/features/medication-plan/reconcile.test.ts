import { describe, expect, it } from 'vitest';

import { plansFromRows, reconcileReminders, reminderSignature, wantedReminders } from './reconcile';
import type { ScheduledSnapshot, WantedRemindersInput } from './reconcile';
import { shouldAskForReminderPermission } from './reminder-status';
import type { PlannedReminder } from './schedule';
import type { ReminderRow } from './types';

const BERLIN = 'Europe/Berlin';
const ANDI = 'user-andi';

/**
 * Shaped like the two live plans (checked 2026-10-17): created by Andi on HIS
 * phone, source_device_id null, last_fired_at null — and read here on the
 * OTHER phone, where they only ever arrived by sync.
 */
function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'plan-d3',
    household_id: 'h1',
    child_id: 'marina',
    occurred_at: '2026-10-11T06:00:00.000Z',
    tz: BERLIN,
    local_date: '2026-10-11',
    created_by: ANDI,
    created_at: '2026-10-10T12:58:54.174Z',
    updated_at: '2026-10-10T12:58:54.174Z',
    deleted_at: null,
    source_device_id: null,
    note: '{"kind":"medication_plan","dose_amount":4,"dose_unit":"drops","route":"oral","remind":true}',
    title: 'Vitamin D3',
    description: null,
    trigger_age_days: null,
    trigger_at: '2026-10-11T06:00:00.000Z',
    repeat_rule: 'FREQ=DAILY;INTERVAL=1',
    enabled: 1,
    last_fired_at: null,
    ...overrides,
  };
}

const eisen = (overrides: Partial<ReminderRow> = {}) =>
  row({
    id: 'plan-eisen',
    title: 'Eisen',
    note: '{"kind":"medication_plan","dose_amount":2,"dose_unit":"drops","route":"oral","remind":true}',
    repeat_rule: 'FREQ=DAILY;INTERVAL=2',
    ...overrides,
  });

const base: WantedRemindersInput = {
  rows: [],
  todaysDoses: [],
  childNames: new Map([['marina', 'Marina']]),
  todayLocalDate: '2026-10-17',
  // 07:00 in Berlin — today's 08:00 reminders are still ahead
  nowUtcIso: '2026-10-17T05:00:00.000Z',
  deviceTz: BERLIN,
  remindersEnabled: true,
  horizonDays: 14,
};

/** What the phone holds after applying a reconcile result to `scheduled`. */
function apply(scheduled: readonly ScheduledSnapshot[], wanted: readonly PlannedReminder[]): ScheduledSnapshot[] {
  const { cancel, schedule } = reconcileReminders(scheduled, wanted);
  const kept = scheduled.filter((entry) => !cancel.includes(entry.identifier));
  return [...kept, ...schedule.map((r) => ({ identifier: r.identifier, signature: reminderSignature(r) }))];
}

describe('a plan that arrived by sync (created on the other phone)', () => {
  it('is scheduled — who created it, and on which device, plays no role', () => {
    const wanted = wantedReminders({ ...base, rows: [row()] });
    expect(wanted).toHaveLength(14);
    expect(wanted[0]).toMatchObject({
      identifier: 'medplan:plan-d3:2026-10-17',
      fireAtUtcIso: '2026-10-17T06:00:00.000Z', // 08:00 Berlin, the same moment as on Andi's phone
      title: 'Vitamin D3 – 4 Tropfen',
      body: 'Marina: fällig – schon gegeben? Antippen zum Abhaken.',
    });

    const { cancel, schedule } = reconcileReminders([], wanted);
    expect(cancel).toEqual([]);
    expect(schedule.map((r) => r.identifier)).toEqual(wanted.map((r) => r.identifier));
  });

  it('works the same for a row written by anyone else, or with a device id set', () => {
    const a = wantedReminders({ ...base, rows: [row()] });
    const b = wantedReminders({ ...base, rows: [row({ created_by: 'user-tamara', source_device_id: 'dev-2' })] });
    expect(b).toEqual(a);
  });

  it('does not depend on which child is on screen: every plan row of the household counts', () => {
    const wanted = wantedReminders({
      ...base,
      rows: [row(), row({ id: 'plan-bro', child_id: 'bruder' })],
      childNames: new Map([
        ['marina', 'Marina'],
        ['bruder', 'Leo'],
      ]),
      horizonDays: 1,
    });
    expect(wanted.map((r) => r.body)).toEqual([
      'Marina: fällig – schon gegeben? Antippen zum Abhaken.',
      'Leo: fällig – schon gegeben? Antippen zum Abhaken.',
    ]);
  });

  it('takes name, dose and unit only from the plan row', () => {
    const [first] = wantedReminders({ ...base, rows: [eisen()], horizonDays: 1 });
    expect(first.title).toBe('Eisen – 2 Tropfen');
    const [noDose] = wantedReminders({
      ...base,
      rows: [row({ note: '{"kind":"medication_plan","dose_amount":null,"dose_unit":null,"route":null,"remind":true}' })],
      horizonDays: 1,
    });
    expect(noDose.title).toBe('Vitamin D3');
  });
});

describe('INTERVAL=2 counts from trigger_at', () => {
  it('Eisen (start 11.10., every 2nd day) rings on 17., 19., 21. … — not on 18., 20.', () => {
    const days = wantedReminders({ ...base, rows: [eisen()] }).map((r) => r.localDate);
    expect(days).toEqual(['2026-10-17', '2026-10-19', '2026-10-21', '2026-10-23', '2026-10-25', '2026-10-27', '2026-10-29']);
  });

  it('a start one day later shifts the whole rhythm by one day', () => {
    const days = wantedReminders({
      ...base,
      rows: [eisen({ trigger_at: '2026-10-12T06:00:00.000Z' })],
      horizonDays: 4,
    }).map((r) => r.localDate);
    expect(days).toEqual(['2026-10-18', '2026-10-20']);
  });

  it('a plan starting in the future has nothing before its start day', () => {
    const days = wantedReminders({ ...base, rows: [eisen({ trigger_at: '2026-10-20T06:00:00.000Z' })], horizonDays: 6 }).map(
      (r) => r.localDate,
    );
    expect(days).toEqual(['2026-10-20', '2026-10-22']);
  });
});

describe('changes on the other phone are followed after sync', () => {
  const scheduledFor = (rows: ReminderRow[]) => apply([], wantedReminders({ ...base, rows }));

  it('paused (enabled = 0) -> all of its notifications are cancelled', () => {
    const before = scheduledFor([row(), eisen()]);
    const { cancel, schedule } = reconcileReminders(before, wantedReminders({ ...base, rows: [row({ enabled: 0 }), eisen()] }));
    expect(schedule).toEqual([]);
    expect(cancel).toHaveLength(14);
    expect(cancel.every((id) => id.startsWith('medplan:plan-d3:'))).toBe(true);
  });

  it('deleted (soft delete, or no longer in the rows) -> cancelled', () => {
    const before = scheduledFor([row(), eisen()]);
    const softDeleted = reconcileReminders(
      before,
      wantedReminders({ ...base, rows: [row({ deleted_at: '2026-10-17T04:00:00.000Z' }), eisen()] }),
    );
    expect(softDeleted.cancel).toHaveLength(14);
    const gone = reconcileReminders(before, wantedReminders({ ...base, rows: [eisen()] }));
    expect(gone.cancel).toEqual(softDeleted.cancel);
  });

  it('reminder switched off in the plan (remind = false) -> cancelled', () => {
    const before = scheduledFor([row()]);
    const silent = row({ note: '{"kind":"medication_plan","dose_amount":4,"dose_unit":"drops","route":"oral","remind":false}' });
    const { cancel, schedule } = reconcileReminders(before, wantedReminders({ ...base, rows: [silent] }));
    expect(cancel).toHaveLength(14);
    expect(schedule).toEqual([]);
  });

  it('time changed to 09:00 -> every day is replaced, at the new moment', () => {
    const before = scheduledFor([row()]);
    const later = wantedReminders({ ...base, rows: [row({ trigger_at: '2026-10-11T07:00:00.000Z' })] });
    const { cancel, schedule } = reconcileReminders(before, later);
    expect(cancel).toHaveLength(14);
    expect(schedule).toHaveLength(14);
    expect(schedule[0].fireAtUtcIso).toBe('2026-10-17T07:00:00.000Z');
  });

  it('dose corrected (4 -> 1 Tropfen) -> the texts are replaced, nothing kept with the old dose', () => {
    const before = scheduledFor([row()]);
    const corrected = wantedReminders({
      ...base,
      rows: [row({ note: '{"kind":"medication_plan","dose_amount":1,"dose_unit":"drops","route":"oral","remind":true}' })],
    });
    const after = apply(before, corrected);
    expect(after).toHaveLength(14);
    expect(after.every((entry) => entry.signature?.includes('Vitamin D3 – 1 Tropfen'))).toBe(true);
  });

  it('the per-device switch off -> everything of ours is cancelled', () => {
    const before = scheduledFor([row(), eisen()]);
    const { cancel, schedule } = reconcileReminders(before, wantedReminders({ ...base, rows: [row(), eisen()], remindersEnabled: false }));
    expect(cancel).toHaveLength(before.length);
    expect(schedule).toEqual([]);
  });

  it("today's dose entered (on either phone) -> only today's reminder of that plan goes", () => {
    const before = scheduledFor([row(), eisen()]);
    const { cancel, schedule } = reconcileReminders(
      before,
      wantedReminders({
        ...base,
        rows: [row(), eisen()],
        todaysDoses: [
          {
            name: 'Vitamin D3',
            dose_amount: 4,
            dose_unit: 'drops',
            occurred_at: '2026-10-17T04:30:00.000Z',
            local_date: '2026-10-17',
            deleted_at: null,
            child_id: 'marina',
          },
        ],
      }),
    );
    expect(cancel).toEqual(['medplan:plan-d3:2026-10-17']);
    expect(schedule).toEqual([]);
  });
});

describe('idempotent: no duplicates however often it runs', () => {
  it('a second run with the same input changes nothing', () => {
    const wanted = wantedReminders({ ...base, rows: [row(), eisen()] });
    const once = apply([], wanted);
    expect(reconcileReminders(once, wanted)).toEqual({ cancel: [], schedule: [] });
  });

  it('five app starts in a row leave exactly one notification per plan and day', () => {
    const wanted = wantedReminders({ ...base, rows: [row(), eisen()] });
    let phone: ScheduledSnapshot[] = [];
    for (let start = 0; start < 5; start += 1) {
      phone = apply(phone, wantedReminders({ ...base, rows: [row(), eisen()] }));
    }
    expect(phone).toHaveLength(wanted.length);
    expect(new Set(phone.map((entry) => entry.identifier)).size).toBe(phone.length);
  });

  it('a duplicate id found on the phone is cancelled and scheduled once more, never kept twice', () => {
    const wanted = wantedReminders({ ...base, rows: [row()], horizonDays: 1 });
    const signature = reminderSignature(wanted[0]);
    const { cancel, schedule } = reconcileReminders(
      [
        { identifier: wanted[0].identifier, signature },
        { identifier: wanted[0].identifier, signature },
      ],
      wanted,
    );
    expect(cancel).toEqual([wanted[0].identifier]);
    expect(schedule).toEqual(wanted);
  });

  it('an old notification without signature (scheduled by the previous app version) is replaced once', () => {
    const wanted = wantedReminders({ ...base, rows: [row()], horizonDays: 1 });
    const { cancel, schedule } = reconcileReminders([{ identifier: wanted[0].identifier, signature: null }], wanted);
    expect(cancel).toEqual([wanted[0].identifier]);
    expect(schedule).toEqual(wanted);
  });

  it('never touches notifications that are not ours', () => {
    const { cancel } = reconcileReminders([{ identifier: 'push:photos', signature: null }], []);
    expect(cancel).toEqual([]);
  });
});

describe('foreign rows in `reminders` are ignored (Fallstrick 17)', () => {
  it('a reminders row of another kind produces nothing', () => {
    const foreign = row({ id: 'age-reminder', note: '{"kind":"age_reminder"}', trigger_age_days: 30 });
    expect(plansFromRows([foreign], BERLIN)).toEqual([]);
    expect(wantedReminders({ ...base, rows: [foreign] })).toEqual([]);
  });
});

describe('asking for the permission once per device', () => {
  const ask = (overrides: Partial<Parameters<typeof shouldAskForReminderPermission>[0]> = {}) =>
    shouldAskForReminderPermission({
      anyPlanWantsReminder: true,
      remindersEnabled: true,
      permission: { status: 'undetermined', canAskAgain: true },
      alreadyAskedOnThisDevice: false,
      ...overrides,
    });

  it('asks when a plan here wants a reminder and the permission is missing', () => {
    expect(ask()).toBe(true);
    expect(ask({ permission: { status: 'denied', canAskAgain: true } })).toBe(true);
  });

  it('does not ask twice, nor when granted, nor when the system would not ask any more', () => {
    expect(ask({ alreadyAskedOnThisDevice: true })).toBe(false);
    expect(ask({ permission: { status: 'granted', canAskAgain: true } })).toBe(false);
    expect(ask({ permission: { status: 'denied', canAskAgain: false } })).toBe(false);
  });

  it('does not ask without a plan that wants a reminder, or with the switch off', () => {
    expect(ask({ anyPlanWantsReminder: false })).toBe(false);
    expect(ask({ remindersEnabled: false })).toBe(false);
  });
});
