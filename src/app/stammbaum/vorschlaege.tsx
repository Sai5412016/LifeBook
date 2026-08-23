/**
 * Stammbaum → Vorschläge — Ergänzungen aus dem geteilten Stammbaum prüfen
 * und übernehmen (features/tree/repository.ts's accept/reject-Funktionen).
 * Erreichbar über den "Vorschläge"-Knopf in (tabs)/stammbaum.tsx, der die
 * Anzahl offener Vorschläge als Ausrufezeichen trägt.
 *
 * WICHTIG: Absendername, Vor-/Nachname, Geburtsname, Orte und die Notiz
 * eines Vorschlags sind Text, den ein Gast ohne App getippt hat — hier NUR
 * angezeigt, NIE ausgewertet. Die Längenbegrenzung dafür sitzt in
 * features/tree/suggestions.ts#truncateGuestText, nicht hier.
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { deviceTimeZone } from '@/core/time/device';
import { formatDayLabel, formatTimeLabel, toLocalDate } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { displayName } from '@/features/tree/logic';
import {
  acceptAddSuggestion,
  acceptEditSuggestion,
  acceptNoteSuggestion,
  rejectSuggestion,
  useRelativesOfHousehold,
  useTreeSuggestionsOfHousehold,
} from '@/features/tree/repository';
import {
  addedFields,
  changedFields,
  describeSuggestion,
  describeSuggestionKind,
  truncateGuestText,
} from '@/features/tree/suggestions';
import type { RelativeRow, TreeSuggestionRow } from '@/features/tree/types';
import { useUiColors } from '@/ui';

export default function StammbaumVorschlaegeScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { suggestions, isLoading } = useTreeSuggestionsOfHousehold(child?.householdId);
  const { relatives } = useRelativesOfHousehold(child?.householdId);
  const relativesById = new Map(relatives.map((relative) => [relative.id, relative]));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(false);

  const open = suggestions.filter((s) => s.status === 'open');
  const done = suggestions.filter((s) => s.status !== 'open');

  const handleAccept = async (s: TreeSuggestionRow) => {
    if (!session?.user.id) {
      return;
    }
    setError(null);
    setBusyId(s.id);
    try {
      if (s.kind === 'add') {
        const result = await acceptAddSuggestion(db, s, session.user.id);
        if (result.droppedMotherId || result.droppedFatherId) {
          const dropped = [result.droppedMotherId ? 'Mutter' : null, result.droppedFatherId ? 'Vater' : null]
            .filter((part): part is string => !!part)
            .join(' und ');
          Alert.alert(
            'Vorschlag übernommen',
            `${dropped} konnte nicht gesetzt werden, da die vorgeschlagene Person nicht im Stammbaum gefunden wurde.`,
          );
        }
      } else if (s.kind === 'edit') {
        await acceptEditSuggestion(db, s, session.user.id);
      } else {
        await acceptNoteSuggestion(db, s, session.user.id);
      }
    } catch (acceptError) {
      console.error('[LifeBook] Vorschlag konnte nicht übernommen werden', acceptError);
      setError(acceptError instanceof Error ? acceptError.message : 'Übernehmen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  const handleEditAndAccept = (s: TreeSuggestionRow) => {
    if (s.kind === 'add') {
      router.push({ pathname: '/stammbaum/neu', params: { suggestionId: s.id } });
    } else if (s.kind === 'edit' && s.relative_id) {
      router.push({ pathname: '/stammbaum/[id]/bearbeiten', params: { id: s.relative_id, suggestionId: s.id } });
    }
  };

  const handleReject = async (s: TreeSuggestionRow) => {
    if (!session?.user.id) {
      return;
    }
    setError(null);
    setBusyId(s.id);
    try {
      await rejectSuggestion(db, s.id, session.user.id);
    } catch (rejectError) {
      console.error('[LifeBook] Vorschlag konnte nicht abgelehnt werden', rejectError);
      setError(rejectError instanceof Error ? rejectError.message : 'Ablehnen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Vorschläge</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        {isLoading && suggestions.length === 0 ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {error ? (
              <ThemedText type="small" themeColor="dangerText">
                {error}
              </ThemedText>
            ) : null}

            {open.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Keine offenen Vorschläge.
              </ThemedText>
            ) : (
              open.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  target={s.relative_id ? relativesById.get(s.relative_id) : undefined}
                  busy={busyId === s.id}
                  onAccept={() => handleAccept(s)}
                  onEditAndAccept={() => handleEditAndAccept(s)}
                  onReject={() => handleReject(s)}
                />
              ))
            )}

            {done.length > 0 ? (
              <View style={styles.doneSection}>
                <Pressable onPress={() => setDoneExpanded((current) => !current)} style={styles.doneHeader}>
                  <ThemedText type="smallBold">Erledigt ({done.length})</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {doneExpanded ? 'einklappen' : 'anzeigen'}
                  </ThemedText>
                </Pressable>
                {doneExpanded
                  ? done.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        target={s.relative_id ? relativesById.get(s.relative_id) : undefined}
                        busy={busyId === s.id}
                        onAccept={() => handleAccept(s)}
                        onEditAndAccept={() => handleEditAndAccept(s)}
                        onReject={() => handleReject(s)}
                      />
                    ))
                  : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function SuggestionCard({
  suggestion,
  target,
  busy,
  onAccept,
  onEditAndAccept,
  onReject,
}: {
  suggestion: TreeSuggestionRow;
  /** The relatives row this 'edit' suggestion targets — undefined for 'add'/'note', or if the target was deleted since. */
  target: RelativeRow | undefined;
  busy: boolean;
  onAccept: () => void;
  onEditAndAccept: () => void;
  onReject: () => void;
}) {
  const { dangerText, accent } = useUiColors();
  const decided = suggestion.status !== 'open';
  const visitorName = suggestion.visitor_name?.trim()
    ? truncateGuestText(suggestion.visitor_name)
    : 'Unbekannter Gast';
  const tz = deviceTimeZone();
  const when = `${formatDayLabel(toLocalDate(suggestion.created_at, tz))} · ${formatTimeLabel(suggestion.created_at, tz)}`;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <ThemedText type="smallBold">{visitorName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {describeSuggestionKind(suggestion.kind)}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {when}
      </ThemedText>

      <ThemedText style={styles.summary}>{describeSuggestion(suggestion)}</ThemedText>

      {suggestion.kind === 'add' ? <FieldList entries={addedFields(suggestion).map((f) => [f.feld, f.wert])} /> : null}

      {suggestion.kind === 'edit' ? (
        target ? (
          <>
            <ThemedText type="small">Betrifft: {displayName(target)}</ThemedText>
            <FieldList
              entries={changedFields(suggestion, target).map((f) => [f.feld, `bisher ${f.bisher} → vorgeschlagen ${f.vorgeschlagen}`])}
            />
          </>
        ) : (
          <ThemedText type="small" themeColor="dangerText">
            Die betroffene Person wurde inzwischen gelöscht.
          </ThemedText>
        )
      ) : null}

      {decided ? (
        <ThemedText type="small" themeColor={suggestion.status === 'accepted' ? undefined : 'dangerText'} style={suggestion.status === 'accepted' ? { color: accent } : undefined}>
          {suggestion.status === 'accepted' ? 'Übernommen' : 'Abgelehnt'}
        </ThemedText>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable onPress={onAccept} hitSlop={8} disabled={busy || (suggestion.kind === 'edit' && !target)}>
            <ThemedText type="linkPrimary">Übernehmen</ThemedText>
          </Pressable>
          {suggestion.kind !== 'note' ? (
            <Pressable
              onPress={onEditAndAccept}
              hitSlop={8}
              disabled={busy || (suggestion.kind === 'edit' && !target)}>
              <ThemedText type="linkPrimary">Bearbeiten und übernehmen</ThemedText>
            </Pressable>
          ) : null}
          <Pressable onPress={onReject} hitSlop={8} disabled={busy}>
            <ThemedText type="linkPrimary" style={{ color: dangerText }}>
              Ablehnen
            </ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

/** Plain "Label: Wert" rows — used for both the 'add' field list and the 'edit' diff, whose lines already come pre-formatted from suggestions.ts. */
function FieldList({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <View style={styles.fieldList}>
      {entries.map(([label, value]) => (
        <ThemedText key={label} type="small" themeColor="textSecondary">
          {label}: {value}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerSpacer: { width: 48 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  spinner: { marginTop: Spacing.five },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summary: { paddingTop: Spacing.one },
  fieldList: { gap: 2, paddingTop: Spacing.one },
  actionsRow: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap', paddingTop: Spacing.two },
  doneSection: { gap: Spacing.two, marginTop: Spacing.two },
  doneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
