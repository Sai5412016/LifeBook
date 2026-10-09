/**
 * Formular für ein Mittel im Medikamentenplan (Anlegen und Bearbeiten).
 *
 * Reihenfolge seit 2026-10-09: Name, Dosis, **Rhythmus** (zwei große Knöpfe
 * "Jeden Tag" / "Jeden 2. Tag"), Starttag — erst danach Einheit, Gabeart und
 * Erinnerung. Vorher war der Rhythmus das sechste Feld in einem Formular am
 * Ende einer langen Seite: unter der Tastatur und außerhalb des sichtbaren
 * Bereichs, Andi fand ihn auf dem Gerät nicht. Die Reihenfolge ist Absicht —
 * nicht "aufräumen" und den Rhythmus wieder nach unten sortieren.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { localDateToPickerDate, localTimeToPickerDate, pickerDateToLocalDate, pickerDateToLocalTime } from '@/core/time';
import { formatShortGermanDate } from '@/features/events/logic';
import { describeDoseUnit, describeMedicationRoute } from '@/features/medication/logic';
import type { MedicationDoseUnit, MedicationRoute } from '@/features/medication/types';
import { Chip, TextField, useHydrateOnce, useUiColors } from '@/ui';

import {
  DEFAULT_REMIND_TIME,
  PLAN_INTERVAL_OPTIONS,
  describeRhythmButton,
  parsePlanDoseText,
} from '../logic';
import type { PlanFormValues } from '../logic';
import type { MedicationPlan } from '../types';

const DOSE_UNIT_OPTIONS: readonly MedicationDoseUnit[] = ['ie', 'drops', 'ml', 'mg', 'spoon', 'piece'];
const ROUTE_OPTIONS: readonly MedicationRoute[] = ['oral', 'bottle', 'other'];

/**
 * "anlegen" has no record at all; "bearbeiten" has one (CLAUDE.md
 * Architekturregel 9 — the form must always know which of the two it serves,
 * never a default value that looks like "still loading").
 */
export type PlanFormMode =
  | { kind: 'create'; todayLocalDate: string }
  | { kind: 'edit'; plan: MedicationPlan | null };

export function PlanFormPanel({
  mode,
  busy,
  onSubmit,
  onCancel,
  onDelete,
}: {
  mode: PlanFormMode;
  busy: boolean;
  onSubmit: (values: PlanFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { dangerText, green } = useUiColors();

  const [name, setName] = useState('');
  const [doseText, setDoseText] = useState('');
  const [doseUnit, setDoseUnit] = useState<MedicationDoseUnit | null>(mode.kind === 'create' ? 'drops' : null);
  const [route, setRoute] = useState<MedicationRoute | null>(mode.kind === 'create' ? 'oral' : null);
  const [intervalDays, setIntervalDays] = useState(1);
  const [startLocalDate, setStartLocalDate] = useState(() => (mode.kind === 'create' ? mode.todayLocalDate : ''));
  const [remind, setRemind] = useState(true);
  const [remindTime, setRemindTime] = useState(DEFAULT_REMIND_TIME);
  const [error, setError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const hydrate = useCallback((loaded: MedicationPlan) => {
    setName(loaded.name);
    setDoseText(loaded.doseAmount !== null ? String(loaded.doseAmount) : '');
    setDoseUnit(loaded.doseUnit);
    setRoute(loaded.route);
    setIntervalDays(loaded.intervalDays);
    setStartLocalDate(loaded.startLocalDate);
    setRemind(loaded.remind);
    setRemindTime(loaded.remindTime);
    setError(null);
  }, []);
  const editPlan = mode.kind === 'edit' ? mode.plan : null;
  // Architekturregel 9: seed once per record, and keep "Speichern" locked until the form really shows that record.
  const hydrated = useHydrateOnce(editPlan, editPlan?.id, hydrate);
  const ready = mode.kind === 'create' || hydrated;

  // A plan read from the database may carry an interval the form does not offer (e.g. every 3rd day) — keep it selectable instead of silently changing it.
  const intervalOptions = PLAN_INTERVAL_OPTIONS.includes(intervalDays)
    ? PLAN_INTERVAL_OPTIONS
    : [...PLAN_INTERVAL_OPTIONS, intervalDays];

  const handleSubmit = () => {
    if (!ready) {
      return;
    }
    if (name.trim().length === 0) {
      setError('Bitte den Namen des Mittels eingeben.');
      return;
    }
    const doseAmount = parsePlanDoseText(doseText);
    if (doseAmount === 'invalid') {
      setError('Bitte eine gültige Dosis eingeben (eine Zahl größer als 0).');
      return;
    }
    // A plan is a FIXED dose that one tap later logs as it stands — so number and unit are both required here.
    if (doseAmount === null || doseUnit === null) {
      setError('Bitte die Dosis (Zahl) und die Einheit angeben.');
      return;
    }
    if (!startLocalDate) {
      setError('Bitte den Starttag wählen.');
      return;
    }
    setError(null);
    onSubmit({ name: name.trim(), doseAmount, doseUnit, route, intervalDays, startLocalDate, remind, remindTime });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />

      <TextField label="Dosis" value={doseText} onChangeText={setDoseText} keyboardType="decimal-pad" />

      <ThemedText type="smallBold">Rhythmus</ThemedText>
      <View style={styles.chipRow}>
        {intervalOptions.map((option) => (
          <Chip
            key={option}
            label={describeRhythmButton(option)}
            selected={intervalDays === option}
            size="large"
            onPress={() => setIntervalDays(option)}
          />
        ))}
      </View>

      <View style={styles.rowField}>
        <ThemedText type="small" themeColor="textSecondary">
          Starttag
        </ThemedText>
        <Pressable onPress={() => setDatePickerOpen(true)} disabled={busy}>
          <ThemedView type="backgroundElement" style={styles.valueButton}>
            <ThemedText>{startLocalDate ? formatShortGermanDate(startLocalDate) : 'Tag wählen'}</ThemedText>
          </ThemedView>
        </Pressable>
        {datePickerOpen ? (
          <DateTimePicker
            mode="date"
            presentation="dialog"
            value={localDateToPickerDate(startLocalDate || (mode.kind === 'create' ? mode.todayLocalDate : ''))}
            onValueChange={(_event, date) => {
              setDatePickerOpen(false);
              setStartLocalDate(pickerDateToLocalDate(date));
            }}
            onDismiss={() => setDatePickerOpen(false)}
          />
        ) : null}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Einheit
      </ThemedText>
      <View style={styles.chipRow}>
        {DOSE_UNIT_OPTIONS.slice(0, 3).map((option) => (
          <Chip
            key={option}
            label={describeDoseUnit(option)}
            selected={doseUnit === option}
            onPress={() => setDoseUnit(doseUnit === option ? null : option)}
          />
        ))}
      </View>
      <View style={styles.chipRow}>
        {DOSE_UNIT_OPTIONS.slice(3, 6).map((option) => (
          <Chip
            key={option}
            label={describeDoseUnit(option)}
            selected={doseUnit === option}
            onPress={() => setDoseUnit(doseUnit === option ? null : option)}
          />
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Gabeart
      </ThemedText>
      <View style={styles.chipRow}>
        {ROUTE_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={describeMedicationRoute(option)}
            selected={route === option}
            onPress={() => setRoute(route === option ? null : option)}
          />
        ))}
      </View>

      <View style={styles.switchRow}>
        <ThemedText type="small" style={styles.switchLabel}>
          Erinnerung zur Uhrzeit
        </ThemedText>
        <Switch value={remind} onValueChange={setRemind} trackColor={{ true: green }} />
      </View>

      {remind ? (
        <View style={styles.rowField}>
          <ThemedText type="small" themeColor="textSecondary">
            Uhrzeit
          </ThemedText>
          <Pressable onPress={() => setTimePickerOpen(true)} disabled={busy}>
            <ThemedView type="backgroundElement" style={styles.valueButton}>
              <ThemedText>{remindTime}</ThemedText>
            </ThemedView>
          </Pressable>
          {timePickerOpen ? (
            <DateTimePicker
              mode="time"
              presentation="dialog"
              is24Hour
              value={localTimeToPickerDate(remindTime)}
              onValueChange={(_event, date) => {
                setTimePickerOpen(false);
                setRemindTime(pickerDateToLocalTime(date));
              }}
              onDismiss={() => setTimePickerOpen(false)}
            />
          ) : null}
        </View>
      ) : null}

      {error ? (
        <ThemedText type="small" style={{ color: dangerText }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.panelActions}>
        <Pressable onPress={onCancel} hitSlop={8} disabled={busy}>
          <ThemedText type="link" themeColor="textSecondary">
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} hitSlop={8} disabled={busy || !ready}>
          <ThemedText type="linkPrimary" style={!ready || busy ? styles.disabled : undefined}>
            Speichern
          </ThemedText>
        </Pressable>
      </View>

      {onDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={busy || !ready}
          accessibilityRole="button"
          style={[styles.deleteButton, { borderColor: dangerText }, (busy || !ready) && styles.disabled]}>
          <ThemedText style={{ color: dangerText, fontWeight: '700' }}>Mittel entfernen</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  switchLabel: { flex: 1 },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  panelActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  rowField: { gap: Spacing.one },
  valueButton: { height: 52, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  deleteButton: {
    minHeight: 52,
    marginTop: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
});
