/**
 * medication-plan/components/medication-plan-section — "Medikamentenplan":
 * the list of fixed medicines, "+ Mittel hinzufügen", pause, and the
 * per-device switch "Erinnerungen auf diesem Handy" (task 2026-10-09, Teil A).
 * Shown on /alltag/medikamentenplan and again under "Mehr …".
 *
 * Anlegen und Bearbeiten laufen seit 2026-10-09 auf dem eigenen Bildschirm
 * `/alltag/mittel` (features/medication-plan/components/plan-form-panel.tsx),
 * nicht mehr als Panel am Ende dieser Liste: dort lag der Rhythmus unter der
 * Tastatur und außerhalb des sichtbaren Bereichs.
 *
 * The plan is only ever defined here and shown (as "Heute fällig") in the
 * Alltag tab. Nothing on this screen computes, suggests or changes a dose
 * beyond what the person types into the form.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { nowUtcIso, toLocalDate } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';
import { useUiColors } from '@/ui';

import { describePlanListLine, describePlanStatus } from '../logic';
import { useMedicationRemindersSetting } from '../reminders-setting';
import { setMedicationPlanEnabled, useMedicationPlans } from '../repository';
import type { MedicationPlan } from '../types';

export type MedicationPlanSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
};

export function MedicationPlanSection({ child, tz }: MedicationPlanSectionProps) {
  const db = usePowerSync();
  const router = useRouter();
  const { green } = useUiColors();
  const { plans } = useMedicationPlans(child?.childId, tz);
  const { enabled: remindersOn, setEnabled: setRemindersOn } = useMedicationRemindersSetting();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);

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

  const handleTogglePause = useCallback(
    async (plan: MedicationPlan) => {
      await setMedicationPlanEnabled(db, plan.id, !plan.enabled, tz);
      showMessage(plan.enabled ? `${plan.name} pausiert.` : `${plan.name} läuft wieder.`);
    },
    [db, tz, showMessage],
  );

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
          {plans.map((plan) => {
            const status = describePlanStatus(plan, todayLocalDate);
            return (
              <View key={plan.id} style={[styles.planRow, !plan.enabled && styles.planRowPaused]}>
                <Pressable
                  style={styles.planInfo}
                  onPress={() => router.push({ pathname: '/alltag/mittel', params: { id: plan.id } })}>
                  <ThemedText type="smallBold" numberOfLines={2}>
                    {describePlanListLine(plan)}
                  </ThemedText>
                  {status ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {status}
                    </ThemedText>
                  ) : null}
                </Pressable>
                <Pressable onPress={() => handleTogglePause(plan)} hitSlop={8}>
                  <ThemedText type="link" themeColor="textSecondary">
                    {plan.enabled ? 'Pausieren' : 'Fortsetzen'}
                  </ThemedText>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Pressable onPress={() => router.push('/alltag/mittel')} disabled={!child}>
        <ThemedView type="backgroundElement" style={styles.addRow}>
          <ThemedText type="linkPrimary">+ Mittel hinzufügen</ThemedText>
        </ThemedView>
      </Pressable>

      {message ? (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  switchLabel: { flex: 1 },
  list: { gap: Spacing.two },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  planRowPaused: { opacity: 0.55 },
  planInfo: { flex: 1, gap: 2, paddingVertical: Spacing.one },
  addRow: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
});
