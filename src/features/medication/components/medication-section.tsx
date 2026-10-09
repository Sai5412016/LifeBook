/**
 * Medikamente & Vitamine section of the "Heute" screen.
 *
 * No timer, no multi-device conflict — a dose is logged once, corrected or
 * soft-deleted afterwards, same interaction shape as Wickeln (see
 * features/diaper/components/diaper-section.tsx). One quick button per
 * favorite (derived from history, ./logic.ts#favoritenAusVerlauf — no
 * separate favorites table), a doppelgabe (double-dose) confirmation before
 * a repeat, a full form for anything else or for backdating ("Nachtragen"),
 * and today's list underneath. Reuses the shared BigButton-adjacent look —
 * a bespoke quick button, not BigButton itself, since BigButton only
 * supports a single line of text and this one needs up to three.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatDayMonthLabel, formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';
import { defaultLogTime } from '@/core/tracking/day-selection';
import type { ActiveChild } from '@/features/household/repository';
import { useHouseholdMemberNames } from '@/features/household/repository';
import { useUiColors } from '@/ui';

import {
  favoritenAusVerlauf,
  firstNameOf,
  formatDoseLabel,
  formatDuplicateDoseWarning,
  formatGivenTodayLabel,
  letzteGabeHeute,
} from '../logic';
import type { MedicationFavorite } from '../logic';
import { gabeEintragen, useGabenDesTages, useGabenHistorie } from '../repository';
import type { MedicationRow } from '../types';
import { MedicationFormPanel } from './medication-form-panel';
import type { MedicationFormSubmitInput } from './medication-form-panel';

export type MedicationSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
  /** The Alltag day selector's currently viewed day — task 2026-09-24. */
  selectedLocalDate: string;
};

export function MedicationSection({
  child,
  session,
  tz,
  selectedLocalDate,
}: MedicationSectionProps) {
  const db = usePowerSync();
  const router = useRouter();
  const { accent } = useUiColors();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);
  const isViewingToday = selectedLocalDate === todayLocalDate;
  const { gaben: selectedDayGaben } = useGabenDesTages(child?.childId, selectedLocalDate);
  const historie = useGabenHistorie(child?.childId);
  const memberNames = useHouseholdMemberNames(child?.householdId);
  const favorites = favoritenAusVerlauf(historie, nowUtcIso());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMessage = useCallback((text: string) => {
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
    }
    setMessage(text);
    messageTimeoutRef.current = setTimeout(() => setMessage(null), 2500);
  }, []);

  const logNow = useCallback(
    async (favorite: MedicationFavorite) => {
      if (!child || !session?.user.id) {
        return;
      }
      setBusy(true);
      try {
        await gabeEintragen(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          name: favorite.name,
          doseAmount: favorite.doseAmount,
          doseUnit: favorite.doseUnit,
          // 2026-09-24: a quick-tap re-log now carries the favorite's OWN
          // route (the most recently used one for this group — see
          // logic.ts#favoritenAusVerlauf) forward, instead of always null.
          route: favorite.route,
          // gewählter Tag = heute -> aktuelle Uhrzeit, wie bisher; ein
          // vergangener Tag trägt bei 12:00 mittags nach (task requirement).
          localDate: selectedLocalDate,
          time: defaultLogTime(selectedLocalDate, todayLocalDate, formatTimeLabel(nowUtcIso(), tz)),
          note: null,
        });
        showMessage(`${favorite.name} eingetragen.`);
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz, selectedLocalDate, todayLocalDate, showMessage],
  );

  const handleQuickTap = useCallback(
    (favorite: MedicationFavorite) => {
      // Korrektur 2026-09-25: der Doppelgabe-Schutz prüft jetzt den
      // GEWÄHLTEN Tag, nicht mehr nur heute — darf nicht wegoptimiert werden
      // (task requirement), unabhängig davon, welcher Tag gerade offen ist.
      const given = letzteGabeHeute(selectedDayGaben, favorite, selectedLocalDate);
      if (!given) {
        void logNow(favorite);
        return;
      }

      Alert.alert(
        'Schon gegeben',
        formatDuplicateDoseWarning(given.occurred_at, tz, isViewingToday, formatDayMonthLabel(selectedLocalDate)),
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Trotzdem eintragen', onPress: () => void logNow(favorite) },
        ],
      );
    },
    [isViewingToday, selectedDayGaben, selectedLocalDate, tz, logNow],
  );

  const handleCreateSubmit = useCallback(
    async (input: MedicationFormSubmitInput) => {
      if (!child || !session?.user.id) {
        return;
      }
      setBusy(true);
      try {
        const id = await gabeEintragen(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          ...input,
        });
        if (id) {
          setCreating(false);
          showMessage(`${input.name} eingetragen.`);
        }
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz, showMessage],
  );

  return (
    <View style={styles.section}>
      {favorites.length > 0 ? (
        <View style={styles.quickGrid}>
          {favorites.map((favorite) => {
            const given = letzteGabeHeute(selectedDayGaben, favorite, selectedLocalDate);
            const givenByName = given ? (memberNames.get(given.created_by) ?? '') : '';
            return (
              <MedicationQuickButton
                key={`${favorite.name.toLowerCase()}|${favorite.doseAmount ?? ''}|${favorite.doseUnit ?? ''}`}
                favorite={favorite}
                givenTodayLabel={
                  given
                    ? formatGivenTodayLabel(
                        given.occurred_at,
                        tz,
                        firstNameOf(givenByName),
                        isViewingToday,
                        formatDayMonthLabel(selectedLocalDate),
                      )
                    : null
                }
                accent={accent}
                disabled={busy || !child}
                onPress={() => handleQuickTap(favorite)}
              />
            );
          })}
        </View>
      ) : null}

      <Pressable onPress={() => setCreating(true)} disabled={busy || !child}>
        <ThemedView type="backgroundElement" style={styles.addRow}>
          <ThemedText type="linkPrimary">+ Neue Gabe</ThemedText>
        </ThemedView>
      </Pressable>

      {message ? (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}

      {creating ? (
        <MedicationFormPanel
          mode={{
            kind: 'create',
            defaultLocalDate: selectedLocalDate,
            defaultTime: defaultLogTime(selectedLocalDate, todayLocalDate, formatTimeLabel(nowUtcIso(), tz)),
          }}
          favorites={favorites}
          tz={tz}
          busy={busy}
          onSubmit={handleCreateSubmit}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {selectedDayGaben.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {isViewingToday ? 'Noch keine Gabe heute.' : `Noch keine Gabe am ${formatDayMonthLabel(selectedLocalDate)}.`}
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {[...selectedDayGaben].reverse().map((gabe) => (
            <MedicationRowItem
              key={gabe.id}
              gabe={gabe}
              firstName={firstNameOf(memberNames.get(gabe.created_by) ?? '')}
              onPress={() => router.push({ pathname: '/alltag/gabe', params: { id: gabe.id, selectedLocalDate } })}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function MedicationQuickButton({
  favorite,
  givenTodayLabel,
  accent,
  disabled,
  onPress,
}: {
  favorite: MedicationFavorite;
  givenTodayLabel: string | null;
  accent: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const doseLabel = formatDoseLabel(favorite.doseAmount, favorite.doseUnit);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.quickButton,
        { backgroundColor: accent },
        disabled && styles.quickButtonDisabled,
        pressed && !disabled && styles.quickButtonPressed,
      ]}>
      <ThemedText style={styles.quickButtonName} numberOfLines={1}>
        {favorite.name}
      </ThemedText>
      {doseLabel ? (
        <ThemedText style={styles.quickButtonDose} numberOfLines={1}>
          {doseLabel}
        </ThemedText>
      ) : null}
      {givenTodayLabel ? (
        <ThemedText style={styles.quickButtonGiven} numberOfLines={1}>
          {givenTodayLabel}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function MedicationRowItem({
  gabe,
  firstName,
  onPress,
}: {
  gabe: MedicationRow;
  firstName: string;
  onPress: () => void;
}) {
  const time = formatTimeLabel(gabe.occurred_at, gabe.tz);
  const doseLabel = formatDoseLabel(gabe.dose_amount, gabe.dose_unit);

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold" style={styles.rowTime}>
          {time}
        </ThemedText>
        <ThemedText type="small" style={styles.rowName} numberOfLines={1}>
          {gabe.name}
        </ThemedText>
        {doseLabel ? (
          <ThemedText type="small" themeColor="textSecondary">
            {doseLabel}
          </ThemedText>
        ) : null}
        {firstName ? (
          <ThemedText type="small" themeColor="textSecondary">
            {firstName}
          </ThemedText>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  quickButton: {
    minHeight: 88,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  quickButtonDisabled: { opacity: 0.4 },
  quickButtonPressed: { opacity: 0.85 },
  quickButtonName: { fontSize: 18, fontWeight: '700', color: '#ffffff', textAlign: 'center' },
  quickButtonDose: { fontSize: 14, fontWeight: '600', color: '#ffffff', textAlign: 'center' },
  quickButtonGiven: { fontSize: 12, color: '#ffffff', opacity: 0.85, textAlign: 'center' },
  addRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },

  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowTime: { width: 48 },
  rowName: { flex: 1 },
});
