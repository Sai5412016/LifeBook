import { describe, expect, it } from 'vitest';

import { buildCsv, buildDiapersCsv, buildFeedsCsv, buildMedicationsCsv } from './csv';
import type { DiaperRow } from '@/features/diaper/types';
import type { FeedRow } from '@/features/feeding/types';
import type { MedicationRow } from '@/features/medication/types';

const BERLIN = 'Europe/Berlin';

describe('buildCsv', () => {
  it('joins headers and rows with semicolons, CRLF between lines', () => {
    expect(buildCsv(['A', 'B'], [['1', '2']])).toBe('A;B\r\n1;2');
  });

  it('quotes a field that contains the separator itself', () => {
    expect(buildCsv(['Notiz'], [['Husten; Schnupfen']])).toBe('Notiz\r\n"Husten; Schnupfen"');
  });

  it('quotes a field that contains a quote, doubling it', () => {
    expect(buildCsv(['Notiz'], [['sagt "aua"']])).toBe('Notiz\r\n"sagt ""aua"""');
  });

  it('leaves a plain field unquoted', () => {
    expect(buildCsv(['Name'], [['Vigantol']])).toBe('Name\r\nVigantol');
  });
});

describe('buildFeedsCsv', () => {
  it('uses German headers and local wall-clock time, not UTC', () => {
    const rows: FeedRow[] = [
      {
        id: '1',
        household_id: 'h',
        child_id: 'c',
        occurred_at: '2026-09-23T07:12:00.000Z', // 09:12 Berlin summer time
        tz: BERLIN,
        local_date: '2026-09-23',
        created_by: 'u',
        created_at: '2026-09-23T07:12:00.000Z',
        updated_at: '2026-09-23T07:12:00.000Z',
        deleted_at: null,
        source_device_id: null,
        note: null,
        feed_type: 'bottle_formula',
        amount_ml: 120,
        duration_left_s: null,
        duration_right_s: null,
        ended_at: '2026-09-23T07:12:00.000Z',
        is_running: 0,
        needs_review: 0,
        running_side: null,
        running_since: null,
      },
    ];

    const csv = buildFeedsCsv(rows, BERLIN);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Datum;Uhrzeit;Art;Menge (ml);Dauer links (min);Dauer rechts (min);Notiz');
    expect(lines[1]).toBe('23.09.2026;09:12;Fläschchen (Nahrung);120;;;');
  });
});

describe('buildDiapersCsv', () => {
  it('translates kind/consistency/color/leaked to German', () => {
    const rows: DiaperRow[] = [
      {
        id: '1',
        household_id: 'h',
        child_id: 'c',
        occurred_at: '2026-09-23T07:12:00.000Z',
        tz: BERLIN,
        local_date: '2026-09-23',
        created_by: 'u',
        created_at: '2026-09-23T07:12:00.000Z',
        updated_at: '2026-09-23T07:12:00.000Z',
        deleted_at: null,
        source_device_id: null,
        note: null,
        kind: 'both',
        consistency: 'soft',
        color: 'yellow',
        leaked: 1,
      },
    ];

    const csv = buildDiapersCsv(rows, BERLIN);
    expect(csv.split('\r\n')[1]).toBe('23.09.2026;09:12;Beides;Weich;Gelb;Ja;');
  });
});

describe('buildMedicationsCsv', () => {
  it('includes dose, unit and Gabeart in German', () => {
    const rows: MedicationRow[] = [
      {
        id: '1',
        household_id: 'h',
        child_id: 'c',
        occurred_at: '2026-09-23T07:12:00.000Z',
        tz: BERLIN,
        local_date: '2026-09-23',
        created_by: 'u',
        created_at: '2026-09-23T07:12:00.000Z',
        updated_at: '2026-09-23T07:12:00.000Z',
        deleted_at: null,
        source_device_id: null,
        note: null,
        name: 'Vigantol',
        dose_amount: 500,
        dose_unit: 'ie',
        route: 'oral',
        reason: null,
      },
    ];

    const csv = buildMedicationsCsv(rows, BERLIN);
    expect(csv.split('\r\n')[1]).toBe('23.09.2026;09:12;Vigantol;500;IE;oral;');
  });
});
