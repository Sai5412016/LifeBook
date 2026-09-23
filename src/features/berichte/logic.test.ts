import { describe, expect, it } from 'vitest';

import {
  berichtBerechnen,
  canGoToNextPeriod,
  formatBerichtZahl,
  formatMedicationGapLabel,
  formatMissingDaysLabel,
  formatMlProFlasche,
  formatZeitraumLabel,
  verschobenerAnker,
  zeitraumTage,
} from './logic';
import type {
  BerichtDaten,
  BerichtDiaperRow,
  BerichtFeedRow,
  BerichtGrowthRow,
  BerichtMedicationRow,
  BerichtSleepRow,
} from './logic';

const emptyDaten: BerichtDaten = {
  feeds: [],
  diapers: [],
  sleeps: [],
  medications: [],
  growthMeasurements: [],
};

describe('zeitraumTage', () => {
  it('woche: Montag bis Sonntag, unabhängig vom Wochentag des Ankers', () => {
    // 2026-09-23 ist ein Mittwoch.
    expect(zeitraumTage('woche', '2026-09-23')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('woche: funktioniert auch, wenn der Anker selbst schon Montag oder Sonntag ist', () => {
    expect(zeitraumTage('woche', '2026-09-21')[0]).toBe('2026-09-21');
    expect(zeitraumTage('woche', '2026-09-27')[6]).toBe('2026-09-27');
  });

  it('woche über einen Monatswechsel hinweg', () => {
    // 2026-09-01 ist ein Dienstag -> Woche vom 31.8. bis 6.9.
    expect(zeitraumTage('woche', '2026-09-01')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });

  it('monat: Februar 2026 (28 Tage, kein Schaltjahr)', () => {
    const tage = zeitraumTage('monat', '2026-02-15');
    expect(tage).toHaveLength(28);
    expect(tage[0]).toBe('2026-02-01');
    expect(tage[27]).toBe('2026-02-28');
  });

  it('monat: April 2026 (30 Tage)', () => {
    const tage = zeitraumTage('monat', '2026-04-10');
    expect(tage).toHaveLength(30);
    expect(tage[29]).toBe('2026-04-30');
  });

  it('monat: August 2026 (31 Tage)', () => {
    const tage = zeitraumTage('monat', '2026-08-20');
    expect(tage).toHaveLength(31);
    expect(tage[30]).toBe('2026-08-31');
  });

  it('monat: Dezember rollt korrekt ins neue Jahr', () => {
    const tage = zeitraumTage('monat', '2026-12-15');
    expect(tage[0]).toBe('2026-12-01');
    expect(tage[tage.length - 1]).toBe('2026-12-31');
  });

  it('lässt Tage vor der Geburt und nach heute NICHT weg — das ist Sache der Anzeige, nicht der Rechnung', () => {
    // Anker weit in der Zukunft oder vor der Geburt liefert trotzdem den vollen Zeitraum.
    expect(zeitraumTage('monat', '2099-01-15')).toHaveLength(31);
  });
});

describe('formatZeitraumLabel', () => {
  it('woche innerhalb desselben Monats', () => {
    expect(formatZeitraumLabel('woche', zeitraumTage('woche', '2026-09-23'))).toBe(
      '21. – 27. September 2026',
    );
  });

  it('woche über einen Monatswechsel hinweg', () => {
    expect(formatZeitraumLabel('woche', zeitraumTage('woche', '2026-09-01'))).toBe(
      '31. August – 6. September 2026',
    );
  });

  it('monat', () => {
    expect(formatZeitraumLabel('monat', zeitraumTage('monat', '2026-09-01'))).toBe('September 2026');
  });

  it('leerer Zeitraum liefert eine leere Beschriftung statt abzustürzen', () => {
    expect(formatZeitraumLabel('woche', [])).toBe('');
  });
});

describe('verschobenerAnker', () => {
  it('woche vor/zurück verschiebt um genau 7 Tage', () => {
    expect(verschobenerAnker('woche', '2026-09-23', 1)).toBe('2026-09-30');
    expect(verschobenerAnker('woche', '2026-09-23', -1)).toBe('2026-09-16');
  });

  it('monat vor/zurück wechselt den Monat, auch über einen Jahreswechsel', () => {
    expect(verschobenerAnker('monat', '2026-12-15', 1)).toBe('2027-01-01');
    expect(verschobenerAnker('monat', '2026-01-15', -1)).toBe('2025-12-01');
  });
});

describe('canGoToNextPeriod', () => {
  it('ist gesperrt, sobald der Zeitraum heute enthält', () => {
    const tage = zeitraumTage('woche', '2026-09-23');
    expect(canGoToNextPeriod(tage, '2026-09-23')).toBe(false);
  });

  it('ist offen für einen Zeitraum ganz in der Vergangenheit', () => {
    const tage = zeitraumTage('woche', '2026-09-01');
    expect(canGoToNextPeriod(tage, '2026-09-23')).toBe(true);
  });
});

describe('berichtBerechnen', () => {
  const WOCHE = zeitraumTage('woche', '2026-09-23'); // 21.–27.9.2026
  const TODAY = '2026-09-23'; // mitten in WOCHE — 21.-23. sind vergangen, 24.-27. sind Zukunft
  const TODAY_AFTER_WOCHE = '2026-09-27'; // WOCHE liegt komplett in der Vergangenheit

  it('leere Daten -> alle Zähler 0, alle Durchschnitte null bei leerem Zeitraum, kein Absturz', () => {
    const bericht = berichtBerechnen([], emptyDaten, TODAY);
    expect(bericht.tageImZeitraum).toBe(0);
    expect(bericht.feeding).toEqual({
      count: 0,
      avgPerDay: null,
      totalMl: 0,
      avgMlPerDay: null,
      avgMlPerBottle: null,
      totalBreastMinutes: 0,
      avgBreastMinutesPerDay: null,
    });
    expect(bericht.diapers).toEqual({
      count: 0,
      totalWet: 0,
      avgWetPerDay: null,
      totalDirty: 0,
      avgDirtyPerDay: null,
    });
    expect(bericht.sleep).toEqual({ count: 0, totalMinutes: 0, avgMinutesPerDay: null, longestMinutes: null });
    expect(bericht.medications).toEqual([]);
    expect(bericht.growth).toEqual({ firstWeightG: null, lastWeightG: null, diffG: null });
    expect(bericht.tageOhneEintrag).toEqual([]);
  });

  it('leere Daten über einem echten Zeitraum -> Zähler 0, Durchschnitte 0 (kein Teilen durch null nötig), kein Absturz', () => {
    const bericht = berichtBerechnen(WOCHE, emptyDaten, TODAY_AFTER_WOCHE);
    expect(bericht.tageImZeitraum).toBe(7);
    expect(bericht.feeding.avgPerDay).toBe(0);
    expect(bericht.tageOhneEintrag).toEqual(WOCHE);
  });

  it('gelöschte Zeilen zählen nirgends mit', () => {
    const feeds: BerichtFeedRow[] = [
      {
        local_date: '2026-09-22',
        deleted_at: '2026-09-22T10:00:00.000Z',
        feed_type: 'bottle_formula',
        amount_ml: 120,
        duration_left_s: null,
        duration_right_s: null,
      },
      {
        local_date: '2026-09-22',
        deleted_at: null,
        feed_type: 'bottle_formula',
        amount_ml: 100,
        duration_left_s: null,
        duration_right_s: null,
      },
    ];
    const diapers: BerichtDiaperRow[] = [
      { local_date: '2026-09-22', deleted_at: '2026-09-22T10:00:00.000Z', kind: 'wet' },
    ];
    const medications: BerichtMedicationRow[] = [
      { local_date: '2026-09-22', deleted_at: '2026-09-22T10:00:00.000Z', name: 'Vigantol' },
    ];

    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, feeds, diapers, medications }, TODAY);

    expect(bericht.feeding.count).toBe(1);
    expect(bericht.feeding.totalMl).toBe(100);
    expect(bericht.diapers.totalWet).toBe(0);
    expect(bericht.medications).toEqual([]);
  });

  it('laufender Monat: Durchschnitt nur über die Tage bis heute, nicht über den ganzen Monat', () => {
    const monat = zeitraumTage('monat', '2026-09-01'); // 30 Tage
    const feeds: BerichtFeedRow[] = Array.from({ length: 10 }, (_, index) => ({
      local_date: monat[index],
      deleted_at: null,
      feed_type: 'bottle_formula' as const,
      amount_ml: 100,
      duration_left_s: null,
      duration_right_s: null,
    }));

    // "Heute" ist der 10. Tag des Monats — nur 10 Tage sind vergangen, nicht 30.
    const bericht = berichtBerechnen(monat, { ...emptyDaten, feeds }, monat[9]);

    expect(bericht.tageImZeitraum).toBe(10);
    expect(bericht.feeding.avgPerDay).toBe(1);
  });

  it('Medikamenten-Lücken: an 5 von 7 Tagen gegeben -> genau die zwei fehlenden Tage, aufsteigend', () => {
    const givenDays = ['2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-27'];
    const medications: BerichtMedicationRow[] = givenDays.map((local_date) => ({
      local_date,
      deleted_at: null,
      name: 'Vigantol',
    }));

    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, medications }, TODAY_AFTER_WOCHE);

    expect(bericht.medications).toEqual([
      { name: 'Vigantol', countInPeriod: 5, missingDays: ['2026-09-23', '2026-09-26'] },
    ]);
  });

  it('Medikamenten-Lücken: Groß-/Kleinschreibung wird beim Gruppieren ignoriert', () => {
    const medications: BerichtMedicationRow[] = [
      { local_date: '2026-09-21', deleted_at: null, name: 'vigantol' },
      { local_date: '2026-09-22', deleted_at: null, name: 'Vigantol' },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, medications }, TODAY);
    expect(bericht.medications).toHaveLength(1);
    expect(bericht.medications[0].countInPeriod).toBe(2);
  });

  it('Gewichtsdifferenz bei nur einem Messwert im Zeitraum ist 0, nicht null', () => {
    const growthMeasurements: BerichtGrowthRow[] = [
      { local_date: '2026-09-22', deleted_at: null, occurred_at: '2026-09-22T08:00:00.000Z', weight_g: 4200 },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, growthMeasurements }, TODAY);
    expect(bericht.growth).toEqual({ firstWeightG: 4200, lastWeightG: 4200, diffG: 0 });
  });

  it('Gewichtsdifferenz über mehrere Messwerte: letzter minus erster nach occurred_at, nicht nach Einfügereihenfolge', () => {
    const growthMeasurements: BerichtGrowthRow[] = [
      { local_date: '2026-09-25', deleted_at: null, occurred_at: '2026-09-25T08:00:00.000Z', weight_g: 4300 },
      { local_date: '2026-09-21', deleted_at: null, occurred_at: '2026-09-21T08:00:00.000Z', weight_g: 4100 },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, growthMeasurements }, TODAY);
    expect(bericht.growth).toEqual({ firstWeightG: 4100, lastWeightG: 4300, diffG: 200 });
  });

  it('Schlaf: nur beendete Phasen zählen zu Dauer und längster Phase, die längste wird korrekt erkannt', () => {
    const sleeps: BerichtSleepRow[] = [
      { local_date: '2026-09-21', deleted_at: null, occurred_at: '2026-09-21T20:00:00.000Z', ended_at: '2026-09-21T22:00:00.000Z' }, // 120 min
      { local_date: '2026-09-22', deleted_at: null, occurred_at: '2026-09-22T20:00:00.000Z', ended_at: '2026-09-22T21:30:00.000Z' }, // 90 min
      { local_date: '2026-09-23', deleted_at: null, occurred_at: '2026-09-23T20:00:00.000Z', ended_at: null }, // noch offen
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, sleeps }, TODAY);
    expect(bericht.sleep.count).toBe(3);
    expect(bericht.sleep.totalMinutes).toBe(210);
    expect(bericht.sleep.longestMinutes).toBe(120);
  });

  it('Wickeln: "both" zählt zu nass UND Stuhl, wie im Alltag-Tab', () => {
    const diapers: BerichtDiaperRow[] = [
      { local_date: '2026-09-21', deleted_at: null, kind: 'both' },
      { local_date: '2026-09-22', deleted_at: null, kind: 'wet' },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, diapers }, TODAY);
    expect(bericht.diapers.totalWet).toBe(2);
    expect(bericht.diapers.totalDirty).toBe(1);
  });

  it('Erfassung: Tage ohne jeden Eintrag, aber nie ein Tag in der Zukunft', () => {
    const feeds: BerichtFeedRow[] = [
      {
        local_date: '2026-09-21',
        deleted_at: null,
        feed_type: 'bottle_formula',
        amount_ml: 100,
        duration_left_s: null,
        duration_right_s: null,
      },
    ];
    // "Heute" ist der 23.9. — der Zeitraum geht bis 27.9., aber 24.-27.9. sind Zukunft und dürfen nicht als "Lücke" erscheinen.
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, feeds }, TODAY);
    expect(bericht.tageOhneEintrag).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('Füttern: Durchschnitt je Flasche berücksichtigt nur Flaschen, nicht Stillmahlzeiten', () => {
    const feeds: BerichtFeedRow[] = [
      {
        local_date: '2026-09-21',
        deleted_at: null,
        feed_type: 'bottle_formula',
        amount_ml: 100,
        duration_left_s: null,
        duration_right_s: null,
      },
      {
        local_date: '2026-09-21',
        deleted_at: null,
        feed_type: 'bottle_formula',
        amount_ml: 150,
        duration_left_s: null,
        duration_right_s: null,
      },
      {
        local_date: '2026-09-22',
        deleted_at: null,
        feed_type: 'breast_left',
        amount_ml: null,
        duration_left_s: 600,
        duration_right_s: 0,
      },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, feeds }, TODAY);
    expect(bericht.feeding.count).toBe(3);
    expect(bericht.feeding.totalMl).toBe(250);
    expect(bericht.feeding.avgMlPerBottle).toBe(125);
    expect(bericht.feeding.totalBreastMinutes).toBe(10);
  });

  it('Füttern: "breast_both" zählt als Stillmahlzeit (beide Seiten in einer Sitzung), nicht als Flasche', () => {
    const feeds: BerichtFeedRow[] = [
      {
        local_date: '2026-09-21',
        deleted_at: null,
        feed_type: 'breast_both',
        amount_ml: null,
        duration_left_s: 300,
        duration_right_s: 300,
      },
    ];
    const bericht = berichtBerechnen(WOCHE, { ...emptyDaten, feeds }, TODAY);
    expect(bericht.feeding.count).toBe(1);
    expect(bericht.feeding.totalMl).toBe(0);
    expect(bericht.feeding.avgMlPerBottle).toBeNull();
    expect(bericht.feeding.totalBreastMinutes).toBe(10);
  });
});

describe('formatBerichtZahl', () => {
  it('rounds to a whole number', () => {
    expect(formatBerichtZahl(4.6)).toBe('5');
    expect(formatBerichtZahl(4.4)).toBe('4');
  });

  it('shows "–" for null', () => {
    expect(formatBerichtZahl(null)).toBe('–');
  });
});

describe('formatMlProFlasche', () => {
  it('keeps exactly one decimal place', () => {
    expect(formatMlProFlasche(125)).toBe('125.0');
    expect(formatMlProFlasche(123.456)).toBe('123.5');
  });

  it('shows "–" for null', () => {
    expect(formatMlProFlasche(null)).toBe('–');
  });
});

describe('formatMedicationGapLabel', () => {
  it('formats the exact wording from the task example', () => {
    expect(formatMedicationGapLabel(['2026-09-12', '2026-09-15', '2026-09-19'])).toBe(
      'Fehlt an 3 Tagen: 12., 15., 19. September',
    );
  });

  it('uses the singular "1 Tag" for exactly one gap', () => {
    expect(formatMedicationGapLabel(['2026-09-12'])).toBe('Fehlt an 1 Tag: 12. September');
  });

  it('returns an empty string for no gaps', () => {
    expect(formatMedicationGapLabel([])).toBe('');
  });

  it('groups gap days spanning a month change separately', () => {
    expect(formatMedicationGapLabel(['2026-08-31', '2026-09-03', '2026-09-05'])).toBe(
      'Fehlt an 3 Tagen: 31. August, 3., 5. September',
    );
  });
});

describe('formatMissingDaysLabel', () => {
  it('formats the count and day list for the Erfassung-Abschnitt', () => {
    expect(formatMissingDaysLabel(['2026-09-22', '2026-09-23'])).toBe('2 Tage ohne Eintrag: 22., 23. September');
  });

  it('uses the singular "1 Tag" for exactly one gap', () => {
    expect(formatMissingDaysLabel(['2026-09-22'])).toBe('1 Tag ohne Eintrag: 22. September');
  });

  it('returns an empty string when there are no gaps', () => {
    expect(formatMissingDaysLabel([])).toBe('');
  });
});
