/**
 * Mittel im Medikamentenplan anlegen / bearbeiten — eigener Bildschirm (task
 * 2026-10-09). Ohne `id` = anlegen, mit `id` = dieses Mittel bearbeiten.
 *
 * Eigener Bildschirm statt Panel am Ende von `/alltag/mehr`: dort war der
 * Rhythmus das sechste Feld unter der Tastatur und außerhalb des sichtbaren
 * Bereichs (Gerätetest Andi: "keine Möglichkeit, 'jeden Tag' oder 'jeden 2.
 * Tag' einzustellen"). Hier steht er direkt unter Name und Dosis, siehe
 * plan-form-panel.tsx.
 */

import { usePowerSync } from '@powersync/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { PlanFormPanel } from '@/features/medication-plan/components/plan-form-panel';
import { ensureReminderPermission } from '@/features/medication-plan/components/reminder-permission';
import { PERMISSION_DENIED_HINT, PERMISSION_LATER_HINT } from '@/features/medication-plan/logic';
import type { PlanFormValues } from '@/features/medication-plan/logic';
import { useMedicationRemindersSetting } from '@/features/medication-plan/reminders-setting';
import {
  addMedicationPlan,
  deleteMedicationPlan,
  updateMedicationPlan,
  useMedicationPlans,
} from '@/features/medication-plan/repository';
import { KeyboardSafeScreen } from '@/ui';

export default function MittelScreen() {
  const db = usePowerSync();
  const router = useRouter();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const tz = deviceTimeZone();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { plans, isLoading } = useMedicationPlans(child?.childId, tz);
  const { enabled: remindersOn } = useMedicationRemindersSetting();
  const [busy, setBusy] = useState(false);

  const editing = typeof id === 'string' && id.length > 0;
  const plan = editing ? (plans.find((candidate) => candidate.id === id) ?? null) : null;
  const gone = editing && !plan && !isLoading && !!child;

  /** Asks for the notification permission if a reminder is wanted, writes, tells the person what is left to do. */
  const save = useCallback(
    async (values: PlanFormValues, write: () => Promise<boolean>) => {
      setBusy(true);
      try {
        const permission = await ensureReminderPermission(values.remind && remindersOn);
        const saved = await write();
        if (!saved) {
          Alert.alert('Nicht gespeichert', 'Das ließ sich nicht speichern. Bitte Angaben prüfen.');
          return;
        }
        if (permission === 'later') {
          Alert.alert('Gespeichert', PERMISSION_LATER_HINT);
        } else if (permission === 'denied') {
          Alert.alert('Gespeichert', PERMISSION_DENIED_HINT);
        }
        router.back();
      } finally {
        setBusy(false);
      }
    },
    [remindersOn, router],
  );

  const handleSubmit = useCallback(
    (values: PlanFormValues) => {
      if (editing) {
        if (!plan) {
          return;
        }
        void save(values, () => updateMedicationPlan(db, plan.id, values, tz));
        return;
      }
      if (!child || !session?.user.id) {
        return;
      }
      const userId = session.user.id;
      void save(
        values,
        async () =>
          (await addMedicationPlan(db, { householdId: child.householdId, childId: child.childId, userId, tz }, values)) !==
          null,
      );
    },
    [editing, plan, child, session?.user.id, db, tz, save],
  );

  const handleDelete = useCallback(() => {
    if (!plan) {
      return;
    }
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
            router.back();
          },
        },
      ],
    );
  }, [db, plan, tz, router]);

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">{editing ? 'Mittel bearbeiten' : 'Neues Mittel im Plan'}</ThemedText>
        {gone ? (
          <ThemedText>Dieses Mittel gibt es nicht mehr.</ThemedText>
        ) : (
          <PlanFormPanel
            mode={editing ? { kind: 'edit', plan } : { kind: 'create', todayLocalDate: toLocalDate(nowUtcIso(), tz) }}
            busy={busy}
            onSubmit={handleSubmit}
            onCancel={() => router.back()}
            onDelete={editing ? handleDelete : undefined}
          />
        )}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
});
