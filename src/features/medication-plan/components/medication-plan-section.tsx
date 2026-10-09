/**
 * medication-plan/components/medication-plan-section — "Medikamentenplan" in
 * the Medikamente & Vitamine area of /alltag/mehr (task 2026-10-09, Teil A):
 * the list of fixed medicines, "+ Mittel hinzufügen", edit, pause, remove,
 * and the per-device switch "Erinnerungen auf diesem Handy".
 *
 * The plan is only ever defined here and shown (as "Heute fällig") in the
 * Alltag tab. Nothing on this screen computes, suggests or changes a dose
 * beyond what the person types into the form.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  localDateToPickerDate,
  localTimeToPickerDate,
  nowUtcIso,
  pickerDateToLocalDate,
  pickerDateToLocalTime,
  toLocalDate,
} from '@/core/time';
import { formatShortGermanDate } from '@/features/events/logic';
import type { ActiveChild } from '@/features/household/repository';
import { describeDoseUnit, describeMedicationRoute } from '@/features/medication/logic';
import type { MedicationDoseUnit, MedicationRoute } from '@/features/medication/types';
import { Chip, TextField, useHydrateOnce, useUiColors } from '@/ui';

import {
  DEFAULT_REMIND_TIME,
  PERMISSION_DENIED_HINT,
  PERMISSION_REASON,
  PLAN_INTERVAL_OPTIONS,
  describePlanSchedule,
  describeRhythm,
  formatPlanTitle,
  parsePlanDoseText,
  permissionStepForSave,
} from '../logic';
import type { PlanFormValues } from '../logic';
import { getReminderPermission, requestReminderPermission } from '../notifications';
import { useMedicationRemindersSetting } from '../reminders-setting';
import {
  addMedicationPlan,
  deleteMedicationPlan,
  setMedicationPlanEnabled,
  updateMedicationPlan,
  useMedicationPlans,
} from '../repository';
import type { MedicationPlan } from '../types';

const DOSE_UNIT_OPTIONS: readonly MedicationDoseUnit[] = ['ie', 'drops', 'ml', 'mg', 'spoon', 'piece'];
const ROUTE_OPTIONS: readonly MedicationRoute[] = ['oral', 'bottle', 'other'];

export type MedicationPlanSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
};

/**
 * Explains the permission in one sentence and asks — only when the system has
 * never been asked. Resolves to whether reminders can ring on this phone.
 */
async function ensureReminderPermission(wantsReminder: boolean): Promise<boolean> {
  const step = permissionStepForSave(wantsReminder, await getReminderPermission());
  if (step === 'none') {
    return true;
  }
  if (step === 'denied') {
    return false;
  }
  const proceed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Erinnerung aufs Handy',
      PERMISSION_REASON,
      [
        { text: 'Nicht jetzt', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Weiter', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!proceed) {
    return false;
  }
  return (await requestReminderPermission()) === 'granted';
}

export function MedicationPlanSection({ child, session, tz }: MedicationPlanSectionProps) {
  const db = usePowerSync();
  const { green } = useUiColors();
  const { plans } = useMedicationPlans(child?.childId, tz);
  const { enabled: remindersOn, setEnabled: setRemindersOn } = useMedicationRemindersSetting();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);

  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
      }
    },
    [],
  );

  const showMessage = useCallback((text: string, ms = 3000) => {
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
    }
    setMessage(text);
    messageTimeoutRef.current = setTimeout(() => setMessage(null), ms);
  }, []);

  /** Shared tail of create and edit: asks for the permission if a reminder is wanted, then reports. */
  const finishSave = useCallback(
    async (values: PlanFormValues, write: () => Promise<boolean>) => {
      setBusy(true);
      try {
        const canRing = await ensureReminderPermission(values.remind && remindersOn);
        const saved = await write();
        if (!saved) {
          showMessage('Das ließ sich nicht speichern. Bitte Angaben prüfen.', 4000);
          return false;
        }
        if (values.remind && remindersOn && !canRing) {
          showMessage(PERMISSION_DENIED_HINT, 8000);
        } else {
          showMessage('Gespeichert.');
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [remindersOn, showMessage],
  );

  const handleCreate = useCallback(
    async (values: PlanFormValues) => {
      if (!child || !session?.user.id) {
        return;
      }
      const userId = session.user.id;
      const ok = await finishSave(
        values,
        async () => (await addMedicationPlan(db, { householdId: child.householdId, childId: child.childId, userId, tz }, values)) !== null,
      );
      if (ok) {
        setCreating(false);
      }
    },
    [child, session?.user.id, db, tz, finishSave],
  );

  const handleEdit = useCallback(
    async (planId: string, values: PlanFormValues) => {
      const ok = await finishSave(values, () => updateMedicationPlan(db, planId, values, tz));
      if (ok) {
        setEditId(null);
      }
    },
    [db, tz, finishSave],
  );

  const handleTogglePause = useCallback(
    async (plan: MedicationPlan) => {
      await setMedicationPlanEnabled(db, plan.id, !plan.enabled, tz);
      showMessage(plan.enabled ? `${plan.name} pausiert.` : `${plan.name} läuft wieder.`);
    },
    [db, tz, showMessage],
  );

  const handleRequestDelete = useCallback(
    (plan: MedicationPlan) => {
      Alert.alert(
        'Mittel entfernen?',
        `${plan.name} aus dem Medikamentenplan entfernen? Bereits eingetragene Gaben bleiben erhalten.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Entfernen',
            style: 'destructive',
            onPress: async () => {
              await deleteMedicationPlan(db, plan.id, tz);
              setEditId(null);
            },
          },
        ],
      );
    },
    [db, tz],
  );

  const editTarget = editId ? plans.find((plan) => plan.id === editId) : undefined;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Medikamentenplan</ThemedText>

      <View style={styles.switchRow}>
        <ThemedText type="small" style={styles.switchLabel}>
          Erinnerungen auf diesem Handy
        </ThemedText>
        <Switch value={remindersOn} onValueChange={setRemindersOn} trackColor={{ true: green }} />
      </View>

      {plans.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Noch kein Mittel im Plan. Mit „+ Mittel hinzufügen“ legst du z. B. Vitamin D3 für jeden Tag an — es steht dann
          im Alltag-Tab unter „Heute fällig“.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {plans.map((plan) => (
            <View key={plan.id} style={[styles.planRow, !plan.enabled && styles.planRowPaused]}>
              <Pressable style={styles.planInfo} onPress={() => setEditId(plan.id)} disabled={busy}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {formatPlanTitle(plan)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {describePlanSchedule(plan, todayLocalDate)}
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => handleTogglePause(plan)} hitSlop={8} disabled={busy}>
                <ThemedText type="link" themeColor="textSecondary">
                  {plan.enabled ? 'Pausieren' : 'Fortsetzen'}
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={() => setCreating(true)} disabled={busy || !child}>
        <ThemedView type="backgroundElement" style={styles.addRow}>
          <ThemedText type="linkPrimary">+ Mittel hinzufügen</ThemedText>
        </ThemedView>
      </Pressable>

      {message ? (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}

      {creating ? (
        <PlanFormPanel
          mode={{ kind: 'create' }}
          todayLocalDate={todayLocalDate}
          busy={busy}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editTarget ? (
        <PlanFormPanel
          mode={{ kind: 'edit', plan: editTarget }}
          todayLocalDate={todayLocalDate}
          busy={busy}
          onSubmit={(values) => handleEdit(editTarget.id, values)}
          onCancel={() => setEditId(null)}
          onDelete={() => handleRequestDelete(editTarget)}
        />
      ) : null}
    </View>
  );
}

/**
 * "anlegen" has no record at all; "bearbeiten" has one (CLAUDE.md
 * Architekturregel 9 — the form must always know which of the two it serves,
 * never a default value that looks like "still loading").
 */
type PlanFormMode = { kind: 'create' } | { kind: 'edit'; plan: MedicationPlan };

function PlanFormPanel({
  mode,
  todayLocalDate,
  busy,
  onSubmit,
  onCancel,
  onDelete,
}: {
  mode: PlanFormMode;
  todayLocalDate: string;
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
  const [startLocalDate, setStartLocalDate] = useState(() => (mode.kind === 'create' ? todayLocalDate : ''));
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
      <ThemedText type="smallBold">{mode.kind === 'create' ? 'Neues Mittel im Plan' : 'Mittel bearbeiten'}</ThemedText>

      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />

      <TextField label="Dosis" value={doseText} onChangeText={setDoseText} keyboardType="decimal-pad" />

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

      <ThemedText type="small" themeColor="textSecondary">
        Rhythmus
      </ThemedText>
      <View style={styles.chipRow}>
        {intervalOptions.map((option) => (
          <Chip
            key={option}
            label={describeRhythm(option)}
            selected={intervalDays === option}
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
            value={localDateToPickerDate(startLocalDate || todayLocalDate)}
            onValueChange={(_event, date) => {
              setDatePickerOpen(false);
              setStartLocalDate(pickerDateToLocalDate(date));
            }}
            onDismiss={() => setDatePickerOpen(false)}
          />
        ) : null}
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
        {onDelete ? (
          <Pressable onPress={onDelete} hitSlop={8} disabled={busy}>
            <ThemedText type="link" style={{ color: dangerText }}>
              Entfernen
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={handleSubmit} hitSlop={8} disabled={busy || !ready}>
          <ThemedText type="linkPrimary" style={!ready || busy ? styles.disabled : undefined}>
            Speichern
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  switchLabel: { flex: 1 },
  list: { gap: Spacing.two },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  planRowPaused: { opacity: 0.55 },
  planInfo: { flex: 1, gap: 2 },
  addRow: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  panelActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  rowField: { gap: Spacing.one },
  valueButton: { height: 52, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  disabled: { opacity: 0.4 },
});
