/**
 * medication-plan/components/due-today-list — "Heute fällig": the slim
 * checklist of the plan medicines due on the day selected in the Alltag tab
 * (task 2026-10-09, Teil B), directly under the day totals.
 *
 *   ☐ Vitamin D3 · 1 Tropfen        (due, not given yet)
 *   ✓ Vitamin D3 · 09:12            (given)
 *
 * One tap on ☐ writes exactly ONE `medications` row with the plan's own dose
 * through the existing quick-entry write path (schnelleingabe/repository.ts
 * #schnellMedikament — same time rule, same Nachtragen on another day), then
 * hands the result to the existing snackbar ("Ändern" / "Rückgängig") in
 * SchnellLeiste. Undoing it there soft-deletes the row, and this list flips
 * back to ☐ by itself.
 *
 * What it deliberately never does: offer to catch up a missed day (a day
 * without a dose is just visible in the calendar dots), show a medicine on a
 * day it is not due, suggest a different or larger dose, or log without a
 * tap. A medicine already entered that day shows ✓; tapping it opens that
 * dose's edit screen (/alltag/gabe: change or delete — task 2026-10-09).
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatDayMonthLabel, formatTimeLabel, nowUtcIso } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';
import { useGabenDesTages } from '@/features/medication/repository';
import { formatSnackbarLabel, isDoubleTap } from '@/features/schnelleingabe/logic';
import { schnellMedikament } from '@/features/schnelleingabe/repository';
import type { SchnellContext } from '@/features/schnelleingabe/repository';
import { useUiColors } from '@/ui';

import { duePlansOn, formatPlanTitle, gabeFuerPlan, planAsFavorite } from '../logic';
import { useMedicationPlans } from '../repository';
import type { MedicationPlan } from '../types';

/** What the Alltag tab passes on to SchnellLeiste's snackbar after a tap. */
export type PlanTickResult = { token: number; entryId: string; label: string };

export type DueTodayListProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
  selectedLocalDate: string;
  todayLocalDate: string;
  onLogged: (result: PlanTickResult) => void;
  /** Tap on an already-ticked (✓) row — opens that dose's edit screen. */
  onEditGabe: (medicationId: string) => void;
};

export function DueTodayList({ child, session, tz, selectedLocalDate, todayLocalDate, onLogged, onEditGabe }: DueTodayListProps) {
  const db = usePowerSync();
  const { green } = useUiColors();
  const { plans } = useMedicationPlans(child?.childId, tz);
  const { gaben } = useGabenDesTages(child?.childId, selectedLocalDate);
  // Per plan, the last ACCEPTED tap — same 2-second double-tap guard as the
  // quick-entry buttons (schnelleingabe/logic.ts#isDoubleTap). A local
  // PowerSync write is done in milliseconds, long before the row has flipped
  // to ✓ on screen; this is what stops a nervous double tap writing two rows.
  const lastTapRef = useRef<Record<string, string>>({});
  // Changes with every tap, so the same entry can be announced again.
  const tokenRef = useRef(0);

  const due = duePlansOn(plans, selectedLocalDate);
  const isViewingToday = selectedLocalDate === todayLocalDate;
  const userId = session?.user.id;

  const log = useCallback(
    async (plan: MedicationPlan) => {
      if (!child || !userId) {
        return;
      }
      const context: SchnellContext = {
        householdId: child.householdId,
        childId: child.childId,
        userId,
        tz,
        selectedLocalDate,
        todayLocalDate,
      };
      const result = await schnellMedikament(db, context, planAsFavorite(plan));
      if (!result) {
        return;
      }
      tokenRef.current += 1;
      onLogged({
        token: tokenRef.current,
        entryId: result.id,
        label: formatSnackbarLabel(plan.name, null, formatTimeLabel(result.occurredAtUtcIso, tz)),
      });
    },
    [child, userId, tz, selectedLocalDate, todayLocalDate, db, onLogged],
  );

  const handleTap = useCallback(
    (plan: MedicationPlan) => {
      const now = nowUtcIso();
      if (isDoubleTap(lastTapRef.current[plan.id] ?? null, now)) {
        return;
      }
      const given = gabeFuerPlan(gaben, plan.name, selectedLocalDate);

      if (!given) {
        lastTapRef.current[plan.id] = now;
        void log(plan);
        return;
      }

      // Task 2026-10-09: a ✓ row now OPENS THE ENTERED DOSE for correction or
      // deletion (a wrongly entered dose must be fixable from here — it used
      // to open a "log another one?" confirmation instead, which made the ✓
      // row a dead end for exactly the case that mattered). A deliberate
      // second dose is still possible, with its double-dose confirmation, via
      // the quick-entry bar and the list under "Mehr …".
      onEditGabe(given.id);
    },
    [gaben, selectedLocalDate, log, onEditGabe],
  );

  if (due.length === 0) {
    return null;
  }

  return (
    <ThemedView type="backgroundElement" style={styles.box}>
      <ThemedText type="smallBold">
        {isViewingToday ? 'Heute fällig' : `Fällig am ${formatDayMonthLabel(selectedLocalDate)}`}
      </ThemedText>
      <View style={styles.list}>
        {due.map((plan) => {
          const given = gabeFuerPlan(gaben, plan.name, selectedLocalDate);
          const text = given ? `${plan.name} · ${formatTimeLabel(given.occurred_at, given.tz)}` : formatPlanTitle(plan);
          return (
            <Pressable
              key={plan.id}
              onPress={() => handleTap(plan)}
              disabled={!child || !userId}
              hitSlop={4}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!given }}
              accessibilityLabel={text}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <ThemedText style={[styles.box_, given ? { color: green } : null]}>{given ? '✓' : '☐'}</ThemedText>
              <ThemedText type="small" style={styles.rowText} numberOfLines={1}>
                {text}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.one },
  list: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 36 },
  rowPressed: { opacity: 0.6 },
  box_: { fontSize: 22, lineHeight: 26, width: 26, textAlign: 'center' },
  rowText: { flex: 1 },
});
