import { describe, expect, it } from 'vitest';

import type { MedicationFavorite } from '@/features/medication/logic';

import {
  buildPlanRowValues,
  describePlanSchedule,
  describeRhythm,
  duePlansOn,
  formatPlanTitle,
  gabeFuerPlan,
  isPlanDueOn,
  isValidClockTime,
  parsePlanDoseText,
  parsePlanNote,
  permissionStepForSave,
  parseRemindersSetting,
  parseRepeatRule,
  planAsFavorite,
  planFromReminderRow,
  repeatRuleForInterval,
  serializePlanNote,
  serializeRemindersSetting,
  withoutPlanDuplicates,
} from './logic';
import type { MedicationPlan, ReminderRow } from './types';

const BERLIN = 'Europe/Berlin';

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
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
    // 2026-10-09 08:00 in Berlin (CEST, UTC+2)
    trigger_at: '2026-10-09T06:00:00.000Z',
    repeat_rule: 'FREQ=DAILY;INTERVAL=1',
    enabled: 1,
    last_fired_at: null,
    ...overrides,
  };
}

function plan(overrides: Partial<MedicationPlan> = {}): MedicationPlan {
  return {
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
    ...overrides,
  };
}

describe('parsePlanNote', () => {
  it('reads the specified JSON', () => {
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":1,"dose_unit":"drops","route":"oral"}')).toEqual({
      doseAmount: 1,
      doseUnit: 'drops',
      route: 'oral',
      remind: true,
    });
  });

  it('also reads the German unit label the task example used, in any casing', () => {
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":1,"dose_unit":"Tropfen","route":"oral"}')?.doseUnit).toBe(
      'drops',
    );
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":500,"dose_unit":"ie"}')?.doseUnit).toBe('ie');
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":500,"dose_unit":"IE"}')?.doseUnit).toBe('ie');
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":1,"dose_unit":"Messlöffel"}')?.doseUnit).toBe('spoon');
  });

  it('reads a decimal comma dose from a string', () => {
    expect(parsePlanNote('{"kind":"medication_plan","dose_amount":"2,5","dose_unit":"ml"}')?.doseAmount).toBe(2.5);
  });

  it('allows a plan without any dose, unit or route', () => {
    expect(parsePlanNote('{"kind":"medication_plan"}')).toEqual({
      doseAmount: null,
      doseUnit: null,
      route: null,
      remind: true,
    });
  });

  it('reads remind:false as "no reminder"; anything else (incl. absent) means remind', () => {
    expect(parsePlanNote('{"kind":"medication_plan","remind":false}')?.remind).toBe(false);
    expect(parsePlanNote('{"kind":"medication_plan","remind":true}')?.remind).toBe(true);
    expect(parsePlanNote('{"kind":"medication_plan"}')?.remind).toBe(true);
  });

  it('treats an unknown route as no route, not as an unreadable plan', () => {
    expect(parsePlanNote('{"kind":"medication_plan","route":"nasal"}')?.route).toBeNull();
  });

  it.each([
    ['malformed JSON', '{"kind":"medication_plan",'],
    ['plain text', 'Impftermin U4'],
    ['empty string', ''],
    ['only whitespace', '   '],
    ['a JSON string', '"medication_plan"'],
    ['a JSON array', '[{"kind":"medication_plan"}]'],
    ['JSON null', 'null'],
    ['a JSON number', '42'],
    ['another kind', '{"kind":"age_reminder","dose_amount":1}'],
    ['no kind', '{"dose_amount":1,"dose_unit":"drops"}'],
  ])('returns null instead of throwing for %s', (_label, note) => {
    expect(() => parsePlanNote(note)).not.toThrow();
    expect(parsePlanNote(note)).toBeNull();
  });

  it('returns null for a missing note', () => {
    expect(parsePlanNote(null)).toBeNull();
    expect(parsePlanNote(undefined)).toBeNull();
  });

  it.each([
    ['a non-numeric dose', '{"kind":"medication_plan","dose_amount":"viel","dose_unit":"drops"}'],
    ['a zero dose', '{"kind":"medication_plan","dose_amount":0,"dose_unit":"drops"}'],
    ['a negative dose', '{"kind":"medication_plan","dose_amount":-1,"dose_unit":"drops"}'],
    ['a dose that is an object', '{"kind":"medication_plan","dose_amount":{"a":1}}'],
    ['an unknown unit', '{"kind":"medication_plan","dose_amount":1,"dose_unit":"gtt"}'],
    ['a unit that is a number', '{"kind":"medication_plan","dose_amount":1,"dose_unit":3}'],
  ])('makes the whole entry unreadable for %s — a dose is never guessed', (_label, note) => {
    expect(parsePlanNote(note)).toBeNull();
  });
});

describe('serializePlanNote', () => {
  it('writes the enum value (not the label) and round-trips through parsePlanNote', () => {
    const written = serializePlanNote({ doseAmount: 1, doseUnit: 'drops', route: 'oral', remind: true });
    expect(JSON.parse(written)).toEqual({
      kind: 'medication_plan',
      dose_amount: 1,
      dose_unit: 'drops',
      route: 'oral',
      remind: true,
    });
    expect(parsePlanNote(written)).toEqual({ doseAmount: 1, doseUnit: 'drops', route: 'oral', remind: true });
  });

  it('round-trips an empty dose and "no reminder"', () => {
    const note = { doseAmount: null, doseUnit: null, route: null, remind: false };
    expect(parsePlanNote(serializePlanNote(note))).toEqual(note);
  });
});

describe('parseRepeatRule / repeatRuleForInterval', () => {
  it('reads the two rules the form writes', () => {
    expect(parseRepeatRule('FREQ=DAILY;INTERVAL=1')).toBe(1);
    expect(parseRepeatRule('FREQ=DAILY;INTERVAL=2')).toBe(2);
  });

  it('treats a missing INTERVAL as 1 and tolerates case and whitespace', () => {
    expect(parseRepeatRule('FREQ=DAILY')).toBe(1);
    expect(parseRepeatRule('  freq=daily;interval=3 ')).toBe(3);
  });

  it.each(['FREQ=WEEKLY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=-1', 'FREQ=DAILY;INTERVAL=2;COUNT=5', 'jeden Tag', '', 'FREQ=DAILY;INTERVAL=366'])(
    'returns null for "%s"',
    (rule) => {
      expect(parseRepeatRule(rule)).toBeNull();
    },
  );

  it('returns null for a missing rule', () => {
    expect(parseRepeatRule(null)).toBeNull();
    expect(parseRepeatRule(undefined)).toBeNull();
  });

  it('writes what it reads', () => {
    expect(repeatRuleForInterval(2)).toBe('FREQ=DAILY;INTERVAL=2');
    expect(parseRepeatRule(repeatRuleForInterval(2))).toBe(2);
  });
});

describe('describeRhythm', () => {
  it('names the two offered rhythms', () => {
    expect(describeRhythm(1)).toBe('jeden Tag');
    expect(describeRhythm(2)).toBe('jeden 2. Tag');
  });
});

describe('planFromReminderRow', () => {
  it('derives name, dose, rhythm, start day and reminder time from a valid row', () => {
    expect(planFromReminderRow(row(), 'UTC')).toEqual({
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
    });
  });

  it("reads the start day and time in the ROW's own zone, not the fallback", () => {
    // 22:30 UTC on 24.10. is 00:30 on 25.10. in Berlin.
    const read = planFromReminderRow(row({ trigger_at: '2026-10-24T22:30:00.000Z' }), 'America/New_York');
    expect(read?.startLocalDate).toBe('2026-10-25');
    expect(read?.remindTime).toBe('00:30');
  });

  it('uses the fallback zone only when the row has none', () => {
    const read = planFromReminderRow(row({ tz: null, trigger_at: '2026-10-09T06:00:00.000Z' }), BERLIN);
    expect(read?.startLocalDate).toBe('2026-10-09');
    expect(read?.remindTime).toBe('08:00');
    expect(read?.tz).toBe(BERLIN);
  });

  it('maps enabled 0 to paused', () => {
    expect(planFromReminderRow(row({ enabled: 0 }), BERLIN)?.enabled).toBe(false);
  });

  it('keeps the name trimmed', () => {
    expect(planFromReminderRow(row({ title: '  Vitamin D3 ' }), BERLIN)?.name).toBe('Vitamin D3');
  });

  it.each([
    ['soft-deleted', { deleted_at: '2026-10-10T00:00:00.000Z' }],
    ['a note that is not JSON', { note: '{kaputt' }],
    ['another kind', { note: '{"kind":"age_reminder"}' }],
    ['no note', { note: null }],
    ['an empty title', { title: '   ' }],
    ['an unreadable rule', { repeat_rule: 'FREQ=WEEKLY' }],
    ['no rule', { repeat_rule: null }],
    ['no start instant', { trigger_at: null }],
    ['an unparseable start instant', { trigger_at: 'morgen früh' }],
    ['an unknown zone id', { tz: 'Mars/Olympus' }],
  ] as const)('is not a plan when the row is %s — and never throws', (_label, overrides) => {
    expect(() => planFromReminderRow(row(overrides), BERLIN)).not.toThrow();
    expect(planFromReminderRow(row(overrides), BERLIN)).toBeNull();
  });
});

describe('isPlanDueOn — every day', () => {
  const daily = plan({ startLocalDate: '2026-09-28', intervalDays: 1 });

  it('is due on the start day and every day after it, across the month change', () => {
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-11-15']) {
      expect(isPlanDueOn(daily, day)).toBe(true);
    }
  });

  it('is never due before the start day', () => {
    expect(isPlanDueOn(daily, '2026-09-27')).toBe(false);
    expect(isPlanDueOn(daily, '2025-12-31')).toBe(false);
  });
});

describe('isPlanDueOn — every 2nd day, counted in calendar days from the start day', () => {
  const everyOther = plan({ startLocalDate: '2026-09-29', intervalDays: 2 });

  it('is due on day 0, 2, 4, … across the month change and not in between', () => {
    expect(isPlanDueOn(everyOther, '2026-09-29')).toBe(true); // day 0
    expect(isPlanDueOn(everyOther, '2026-09-30')).toBe(false); // day 1
    expect(isPlanDueOn(everyOther, '2026-10-01')).toBe(true); // day 2 (month change)
    expect(isPlanDueOn(everyOther, '2026-10-02')).toBe(false); // day 3
    expect(isPlanDueOn(everyOther, '2026-10-03')).toBe(true); // day 4
    expect(isPlanDueOn(everyOther, '2026-10-31')).toBe(true); // day 32
    expect(isPlanDueOn(everyOther, '2026-11-01')).toBe(false); // day 33
  });

  it('keeps the rhythm across the year boundary', () => {
    const p = plan({ startLocalDate: '2026-12-30', intervalDays: 2 });
    expect(isPlanDueOn(p, '2027-01-01')).toBe(true);
    expect(isPlanDueOn(p, '2026-12-31')).toBe(false);
    expect(isPlanDueOn(p, '2027-01-02')).toBe(false);
    expect(isPlanDueOn(p, '2027-01-03')).toBe(true);
  });

  it('is not due before the start day, even on a day that would fit the rhythm', () => {
    expect(isPlanDueOn(everyOther, '2026-09-27')).toBe(false); // day -2
    expect(isPlanDueOn(everyOther, '2026-09-25')).toBe(false); // day -4
  });

  it('does not shift when a day is missed: it only looks at calendar days, never at past doses', () => {
    // Same answer whether or not anybody gave anything on 29.09. / 01.10.
    expect(isPlanDueOn(everyOther, '2026-10-03')).toBe(true);
    expect(isPlanDueOn(everyOther, '2026-10-02')).toBe(false);
  });

  it('works for other intervals too', () => {
    const p = plan({ startLocalDate: '2026-10-01', intervalDays: 3 });
    expect(['2026-10-01', '2026-10-04', '2026-10-07'].every((d) => isPlanDueOn(p, d))).toBe(true);
    expect(['2026-10-02', '2026-10-03', '2026-10-05'].some((d) => isPlanDueOn(p, d))).toBe(false);
  });
});

describe('isPlanDueOn — clock change on 2026-10-25 (Europe/Berlin, 25-hour day)', () => {
  it('every day: the 25-hour day is exactly one day', () => {
    const p = plan({ startLocalDate: '2026-10-23', intervalDays: 1 });
    for (const day of ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']) {
      expect(isPlanDueOn(p, day)).toBe(true);
    }
  });

  it('every 2nd day starting 24.10.: due 24., not 25., due 26.', () => {
    const p = plan({ startLocalDate: '2026-10-24', intervalDays: 2 });
    expect(isPlanDueOn(p, '2026-10-24')).toBe(true);
    expect(isPlanDueOn(p, '2026-10-25')).toBe(false);
    expect(isPlanDueOn(p, '2026-10-26')).toBe(true);
    expect(isPlanDueOn(p, '2026-10-27')).toBe(false);
    expect(isPlanDueOn(p, '2026-10-28')).toBe(true);
  });

  it('every 2nd day starting 23.10.: due 23., due 25. (the long day), due 27.', () => {
    const p = plan({ startLocalDate: '2026-10-23', intervalDays: 2 });
    expect(isPlanDueOn(p, '2026-10-24')).toBe(false);
    expect(isPlanDueOn(p, '2026-10-25')).toBe(true);
    expect(isPlanDueOn(p, '2026-10-26')).toBe(false);
    expect(isPlanDueOn(p, '2026-10-27')).toBe(true);
  });

  it('a plan whose start instant is 00:30 on the long day starts ON 25.10. (read in its own zone)', () => {
    const read = planFromReminderRow(
      row({ trigger_at: '2026-10-24T22:30:00.000Z', repeat_rule: 'FREQ=DAILY;INTERVAL=2' }),
      BERLIN,
    );
    expect(read?.startLocalDate).toBe('2026-10-25');
    expect(isPlanDueOn(read!, '2026-10-24')).toBe(false);
    expect(isPlanDueOn(read!, '2026-10-25')).toBe(true);
    expect(isPlanDueOn(read!, '2026-10-26')).toBe(false);
    expect(isPlanDueOn(read!, '2026-10-27')).toBe(true);
  });

  it('the spring change (2026-03-29, 23-hour day) behaves the same', () => {
    const p = plan({ startLocalDate: '2026-03-28', intervalDays: 2 });
    expect(isPlanDueOn(p, '2026-03-29')).toBe(false);
    expect(isPlanDueOn(p, '2026-03-30')).toBe(true);
  });
});

describe('isPlanDueOn — paused or broken', () => {
  it('a paused plan is never due', () => {
    expect(isPlanDueOn(plan({ enabled: false }), '2026-10-09')).toBe(false);
    expect(isPlanDueOn(plan({ enabled: false }), '2026-10-10')).toBe(false);
  });

  it('a malformed day is "not due", not an exception', () => {
    expect(() => isPlanDueOn(plan(), 'heute')).not.toThrow();
    expect(isPlanDueOn(plan(), 'heute')).toBe(false);
  });
});

describe('duePlansOn ("Heute fällig" shows only what is due)', () => {
  const daily = plan({ id: 'a', name: 'Vitamin D3', startLocalDate: '2026-10-01', intervalDays: 1, remindTime: '08:00' });
  const everyOther = plan({ id: 'b', name: 'Eisen', startLocalDate: '2026-10-01', intervalDays: 2, remindTime: '07:30' });
  const paused = plan({ id: 'c', name: 'Pausiert', enabled: false });
  const later = plan({ id: 'd', name: 'Fluorid', startLocalDate: '2026-10-20', intervalDays: 1 });

  it('on a day both are due: both, earlier reminder time first', () => {
    expect(duePlansOn([daily, everyOther], '2026-10-03').map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('on an off day of the every-2nd-day plan: only the daily one', () => {
    expect(duePlansOn([daily, everyOther], '2026-10-04').map((p) => p.id)).toEqual(['a']);
  });

  it('leaves out paused plans and plans that have not started yet', () => {
    expect(duePlansOn([daily, paused, later], '2026-10-09').map((p) => p.id)).toEqual(['a']);
  });

  it('is empty when nothing is due, and for no plans at all', () => {
    expect(duePlansOn([everyOther], '2026-10-02')).toEqual([]);
    expect(duePlansOn([], '2026-10-02')).toEqual([]);
  });

  it('breaks a tie in reminder time by name, and does not mutate its input', () => {
    const x = plan({ id: 'x', name: 'Zink', remindTime: '08:00' });
    const y = plan({ id: 'y', name: 'Eisen', remindTime: '08:00' });
    const input = [x, y];
    expect(duePlansOn(input, '2026-10-09').map((p) => p.id)).toEqual(['y', 'x']);
    expect(input.map((p) => p.id)).toEqual(['x', 'y']);
  });
});

describe('gabeFuerPlan (is the plan medicine already given on that day?)', () => {
  const entry = (name: string, occurredAt: string, localDate: string, deleted: string | null = null, amount = 1) => ({
    name,
    dose_amount: amount,
    dose_unit: 'drops' as const,
    occurred_at: occurredAt,
    local_date: localDate,
    deleted_at: deleted,
  });

  it('finds a dose of the same name on that day', () => {
    const found = gabeFuerPlan([entry('Vitamin D3', '2026-10-09T07:12:00.000Z', '2026-10-09')], 'Vitamin D3', '2026-10-09');
    expect(found?.occurred_at).toBe('2026-10-09T07:12:00.000Z');
  });

  it('ignores case and surrounding blanks', () => {
    expect(gabeFuerPlan([entry(' vitamin d3 ', '2026-10-09T07:12:00.000Z', '2026-10-09')], 'Vitamin D3', '2026-10-09')).not.toBeNull();
  });

  it('counts a dose of a DIFFERENT amount as given too — the checklist is "once a day"', () => {
    expect(gabeFuerPlan([entry('Vitamin D3', '2026-10-09T07:12:00.000Z', '2026-10-09', null, 4)], 'Vitamin D3', '2026-10-09')).not.toBeNull();
  });

  it('ignores other days, other medicines and soft-deleted doses', () => {
    const list = [
      entry('Vitamin D3', '2026-10-08T07:12:00.000Z', '2026-10-08'),
      entry('Eisen', '2026-10-09T07:12:00.000Z', '2026-10-09'),
      entry('Vitamin D3', '2026-10-09T07:12:00.000Z', '2026-10-09', '2026-10-09T08:00:00.000Z'),
    ];
    expect(gabeFuerPlan(list, 'Vitamin D3', '2026-10-09')).toBeNull();
  });

  it('returns the latest of several doses of the same day', () => {
    const list = [
      entry('Vitamin D3', '2026-10-09T05:00:00.000Z', '2026-10-09'),
      entry('Vitamin D3', '2026-10-09T09:30:00.000Z', '2026-10-09'),
    ];
    expect(gabeFuerPlan(list, 'Vitamin D3', '2026-10-09')?.occurred_at).toBe('2026-10-09T09:30:00.000Z');
  });

  it('is null for no entries', () => {
    expect(gabeFuerPlan([], 'Vitamin D3', '2026-10-09')).toBeNull();
  });
});

describe('labels and favorites', () => {
  it('formatPlanTitle: name · dose, or just the name', () => {
    expect(formatPlanTitle(plan())).toBe('Vitamin D3 · 1 Tropfen');
    expect(formatPlanTitle(plan({ doseAmount: 2.5, doseUnit: 'ml' }))).toBe('Vitamin D3 · 2.5 ml');
    expect(formatPlanTitle(plan({ doseAmount: null, doseUnit: null }))).toBe('Vitamin D3');
  });

  it('planAsFavorite carries exactly the plan dose and route', () => {
    expect(planAsFavorite(plan({ doseAmount: 1, doseUnit: 'drops', route: 'bottle' }))).toEqual({
      name: 'Vitamin D3',
      doseAmount: 1,
      doseUnit: 'drops',
      route: 'bottle',
    });
  });

  it('withoutPlanDuplicates drops a favorite that is the same medicine + dose as a plan, keeps the rest', () => {
    const favorites: MedicationFavorite[] = [
      { name: 'vitamin d3 ', doseAmount: 1, doseUnit: 'drops', route: null }, // same as plan (case/blank-insensitive)
      { name: 'Vitamin D3', doseAmount: 2, doseUnit: 'drops', route: null }, // another dose: stays
      { name: 'Fieberzäpfchen', doseAmount: 1, doseUnit: 'piece', route: 'other' },
    ];
    expect(withoutPlanDuplicates(favorites, [plan()]).map((f) => `${f.name.trim()}|${f.doseAmount}`)).toEqual([
      'Vitamin D3|2',
      'Fieberzäpfchen|1',
    ]);
  });

  it('withoutPlanDuplicates is the identity without plans', () => {
    const favorites: MedicationFavorite[] = [{ name: 'A', doseAmount: null, doseUnit: null, route: null }];
    expect(withoutPlanDuplicates(favorites, [])).toEqual(favorites);
  });
});

describe('form helpers', () => {
  it('parsePlanDoseText: empty = no dose, comma = decimal, junk or <= 0 = invalid', () => {
    expect(parsePlanDoseText('')).toBeNull();
    expect(parsePlanDoseText('   ')).toBeNull();
    expect(parsePlanDoseText('1')).toBe(1);
    expect(parsePlanDoseText('2,5')).toBe(2.5);
    expect(parsePlanDoseText('abc')).toBe('invalid');
    expect(parsePlanDoseText('0')).toBe('invalid');
    expect(parsePlanDoseText('-1')).toBe('invalid');
  });

  it('isValidClockTime', () => {
    expect(isValidClockTime('08:00')).toBe(true);
    expect(isValidClockTime('23:59')).toBe(true);
    expect(isValidClockTime('24:00')).toBe(false);
    expect(isValidClockTime('8:00')).toBe(false);
    expect(isValidClockTime('08:60')).toBe(false);
    expect(isValidClockTime('')).toBe(false);
  });
});

describe('buildPlanRowValues', () => {
  const values = {
    name: ' Vitamin D3 ',
    doseAmount: 1,
    doseUnit: 'drops' as const,
    route: 'oral' as const,
    intervalDays: 1,
    startLocalDate: '2026-10-09',
    remind: true,
    remindTime: '08:00',
  };

  it('builds the columns the task specifies', () => {
    const built = buildPlanRowValues(values, BERLIN);
    expect(built).not.toBeNull();
    expect(built!.title).toBe('Vitamin D3');
    expect(JSON.parse(built!.note)).toEqual({
      kind: 'medication_plan',
      dose_amount: 1,
      dose_unit: 'drops',
      route: 'oral',
      remind: true,
    });
    expect(built!.repeat_rule).toBe('FREQ=DAILY;INTERVAL=1');
    expect(built!.trigger_at).toBe('2026-10-09T06:00:00.000Z'); // 08:00 CEST
    expect(built!.occurred_at).toBe(built!.trigger_at);
    expect(built!.local_date).toBe('2026-10-09');
  });

  it('writes "jeden 2. Tag" as INTERVAL=2', () => {
    expect(buildPlanRowValues({ ...values, intervalDays: 2 }, BERLIN)!.repeat_rule).toBe('FREQ=DAILY;INTERVAL=2');
  });

  it('what it builds is read back as the same plan (write/read round trip)', () => {
    const built = buildPlanRowValues({ ...values, intervalDays: 2, remindTime: '07:45' }, BERLIN)!;
    const read = planFromReminderRow(row({ ...built, tz: BERLIN }), 'UTC')!;
    expect(read.name).toBe('Vitamin D3');
    expect(read.intervalDays).toBe(2);
    expect(read.startLocalDate).toBe('2026-10-09');
    expect(read.remindTime).toBe('07:45');
    expect(read.doseAmount).toBe(1);
    expect(read.doseUnit).toBe('drops');
  });

  it('uses the offset that is valid on the start day: 08:00 on the clock-change day is CET', () => {
    expect(buildPlanRowValues({ ...values, startLocalDate: '2026-10-24' }, BERLIN)!.trigger_at).toBe(
      '2026-10-24T06:00:00.000Z', // CEST, UTC+2
    );
    expect(buildPlanRowValues({ ...values, startLocalDate: '2026-10-25' }, BERLIN)!.trigger_at).toBe(
      '2026-10-25T07:00:00.000Z', // CET, UTC+1
    );
  });

  it('derives local_date FROM the instant, so a time just after midnight stays on its own day', () => {
    const built = buildPlanRowValues({ ...values, startLocalDate: '2026-10-25', remindTime: '00:30' }, BERLIN)!;
    expect(built.trigger_at).toBe('2026-10-24T22:30:00.000Z');
    expect(built.local_date).toBe('2026-10-25');
  });

  it('keeps the reminder time when the reminder is switched off', () => {
    const built = buildPlanRowValues({ ...values, remind: false, remindTime: '09:15' }, BERLIN)!;
    expect(JSON.parse(built.note).remind).toBe(false);
    expect(planFromReminderRow(row({ ...built }), BERLIN)!.remindTime).toBe('09:15');
  });

  it('allows a plan without a dose', () => {
    const built = buildPlanRowValues({ ...values, doseAmount: null, doseUnit: null, route: null }, BERLIN)!;
    expect(parsePlanNote(built.note)).toEqual({ doseAmount: null, doseUnit: null, route: null, remind: true });
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['a bad start day', { startLocalDate: '09.10.2026' }],
    ['a bad time', { remindTime: '25:00' }],
    ['a zero dose', { doseAmount: 0 }],
    ['a negative dose', { doseAmount: -1 }],
    ['a NaN dose', { doseAmount: Number.NaN }],
    ['interval 0', { intervalDays: 0 }],
    ['a fractional interval', { intervalDays: 1.5 }],
  ])('refuses %s', (_label, overrides) => {
    expect(buildPlanRowValues({ ...values, ...overrides }, BERLIN)).toBeNull();
  });

  it('refuses an unknown zone', () => {
    expect(buildPlanRowValues(values, 'Mars/Olympus')).toBeNull();
  });
});

describe('per-device reminder switch', () => {
  it('defaults to ON (nothing stored, or anything but an explicit "0")', () => {
    expect(parseRemindersSetting(null)).toBe(true);
    expect(parseRemindersSetting(undefined)).toBe(true);
    expect(parseRemindersSetting('1')).toBe(true);
    expect(parseRemindersSetting('kaputt')).toBe(true);
  });

  it('is OFF only after an explicit switch-off, and round-trips', () => {
    expect(parseRemindersSetting('0')).toBe(false);
    expect(parseRemindersSetting(serializeRemindersSetting(false))).toBe(false);
    expect(parseRemindersSetting(serializeRemindersSetting(true))).toBe(true);
  });
});

describe('permissionStepForSave', () => {
  it('asks (with a reason first) only when a reminder is being created and nothing is decided yet', () => {
    expect(permissionStepForSave(true, 'undetermined')).toBe('ask');
  });

  it('does nothing when it is already granted or no reminder is wanted', () => {
    expect(permissionStepForSave(true, 'granted')).toBe('none');
    expect(permissionStepForSave(false, 'undetermined')).toBe('none');
    expect(permissionStepForSave(false, 'denied')).toBe('none');
    expect(permissionStepForSave(false, 'granted')).toBe('none');
  });

  it('points to the settings when it was refused (the system will not ask twice)', () => {
    expect(permissionStepForSave(true, 'denied')).toBe('denied');
  });
});

describe('describePlanSchedule', () => {
  it('rhythm and reminder time', () => {
    expect(describePlanSchedule(plan(), '2026-10-09')).toBe('jeden Tag · Erinnerung 08:00');
    expect(describePlanSchedule(plan({ intervalDays: 2, remind: false }), '2026-10-09')).toBe(
      'jeden 2. Tag · ohne Erinnerung',
    );
  });

  it('marks a paused plan', () => {
    expect(describePlanSchedule(plan({ enabled: false }), '2026-10-09')).toBe('Pausiert · jeden Tag · Erinnerung 08:00');
  });

  it('shows the start day only while it is still ahead', () => {
    expect(describePlanSchedule(plan({ startLocalDate: '2026-10-12' }), '2026-10-09')).toBe(
      'jeden Tag · Erinnerung 08:00 · ab 12. Oktober',
    );
    expect(describePlanSchedule(plan({ startLocalDate: '2026-10-09' }), '2026-10-09')).not.toMatch(/ab /);
  });
});
