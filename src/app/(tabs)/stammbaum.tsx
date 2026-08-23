/**
 * Stammbaum — Verwandte, nach der echten genealogischen Beziehung zu
 * Marina gruppiert: gemeinsamer Vorfahre plus zwei Abstände, nicht mehr
 * ein festes Zwei-Schritte-Regelwerk (features/tree/logic.ts#relationLabel
 * — siehe dessen Dateikopf zur Historie dieser beiden Fehler). Jede Karte
 * zeigt zusätzlich die genaue Bezeichnung dieser einen Person (Task-Vorgabe,
 * 23.08.2026), auch wenn sie gröber unter derselben Gruppenüberschrift
 * steht wie andere — "Cousins und Cousinen" etwa sammelt jeden Grad und
 * jede Entfernung unter einer Überschrift. Legt beim ersten Öffnen den
 * Wurzelknoten an (die eine `relatives`-Zeile mit `child_id`), ohne
 * Rückfrage — siehe features/tree/repository.ts#ensureRootRelative.
 *
 * Verstorbene werden NICHT ausgegraut (Task-Vorgabe) — "verstorben" steht
 * bereits lesbar in der Lebensdaten-Zeile (features/tree/logic.ts#lifeLine),
 * das reicht als Kennzeichnung.
 *
 * JEDE nicht gelöschte Person des Haushalts muss in dieser Liste
 * auftauchen — eine Person, die hier fehlt, ist über die Oberfläche nicht
 * mehr erreichbar und nicht mehr korrigierbar. Dafür garantiert
 * `groupForList` per Konstruktion, dass niemand aus jeder Gruppe
 * herausfällt (siehe dessen eigenen Kommentar und den "Summe aller
 * Gruppengrößen"-Test in logic.test.ts) — diese Datei muss nur `relatives`
 * VOLLSTÄNDIG hineingeben, ohne eigene Filterung davor.
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { useActiveChild } from '@/features/household/repository';
import { PersonAvatar } from '@/features/people/components/person-avatar';
import { useSignedUrls } from '@/features/photos/hooks';
import { TreeView } from '@/features/tree/components/tree-view';
import {
  UNCONNECTED_GROUP_HINT,
  displayName,
  groupForList,
  lifeLine,
  relationLabel,
} from '@/features/tree/logic';
import {
  ensureRootRelative,
  useRelativesOfHousehold,
  useTreeSuggestionsOfHousehold,
  useUnionsOfHousehold,
} from '@/features/tree/repository';
import type { RelativeRow } from '@/features/tree/types';
import { Button, Chip } from '@/ui';

type ViewMode = 'list' | 'tree';

export default function StammbaumScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relatives, isLoading } = useRelativesOfHousehold(child?.householdId);
  const { unions } = useUnionsOfHousehold(child?.householdId);
  const { suggestions } = useTreeSuggestionsOfHousehold(child?.householdId);
  const openSuggestionCount = suggestions.filter((suggestion) => suggestion.status === 'open').length;
  const [ensuring, setEnsuring] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    if (!child || !session?.user.id) {
      return;
    }
    setEnsuring(true);
    ensureRootRelative(db, child, session.user.id).finally(() => setEnsuring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, child?.householdId, child?.childId, session?.user.id]);

  const rootRelative = relatives.find((relative) => relative.child_id === child?.childId);

  // EVERY relative goes in here, unfiltered — see this file's own doc
  // comment on Fehler 1. Deliberately NOT typed as `RelationGraphPerson[]`
  // here — that would narrow away `family_name`/`photo_key`/etc., which
  // `RelativeListRow` still needs. Left to inference, each entry keeps its
  // full `RelativeRow` shape plus `partnerIds`, which still satisfies
  // `groupForList`'s `T extends RelationGraphPerson` constraint.
  const graphPeople = relatives.map((relative) => ({
    ...relative,
    partnerIds: unions
      .filter((union) => union.a_id === relative.id || union.b_id === relative.id)
      .map((union) => (union.a_id === relative.id ? union.b_id : union.a_id)),
  }));

  const groups = rootRelative ? groupForList(graphPeople, rootRelative.id) : [];
  // Every person's own precise relation (task requirement, 2026-08-23:
  // "Auf der Karte jeder Person steht die genaue Bezeichnung aus
  // classifyRelation" — no longer optional, unlike the previous task's
  // "darf... stehen") — the section heading is a coarser bucket (e.g.
  // "Cousins und Cousinen" covers 1st/2nd/3rd degree and removed cousins
  // alike), this is the exact wording for THIS one person.
  const personalLabels = new Map(
    rootRelative ? graphPeople.map((person) => [person.id, relationLabel(person, graphPeople, rootRelative.id)]) : [],
  );
  const showsUnconnectedHint = groups.length > 0 && groups[groups.length - 1].label === 'Noch nicht verbunden';

  const thumbKeys = relatives.map((relative) => relative.photo_key);
  const signedUrls = useSignedUrls(thumbKeys);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Stammbaum</ThemedText>
        </View>

        <View style={styles.actions}>
          <Button label="Person hinzufügen" onPress={() => router.push('/stammbaum/neu')} disabled={!child} />
          <View>
            <Button
              label="Vorschläge"
              variant="secondary"
              onPress={() => router.push('/stammbaum/vorschlaege')}
              disabled={!child}
            />
            {openSuggestionCount > 0 ? (
              <View style={styles.suggestionBadge}>
                <ThemedText style={styles.suggestionBadgeText}>{openSuggestionCount}</ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.viewModeRow}>
          <Chip label="Liste" selected={viewMode === 'list'} onPress={() => setViewMode('list')} />
          <Chip label="Baum" selected={viewMode === 'tree'} onPress={() => setViewMode('tree')} />
        </View>

        {(isLoading || ensuring) && relatives.length === 0 ? (
          <ActivityIndicator style={styles.spinner} />
        ) : viewMode === 'tree' ? (
          <TreeView relatives={relatives} unions={unions} rootId={rootRelative?.id} onJumpToList={() => setViewMode('list')} />
        ) : (
          <SectionList
            sections={groups.map((group) => ({ title: group.label, data: group.people }))}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <ThemedText type="smallBold" style={styles.sectionHeader}>
                {section.title}
              </ThemedText>
            )}
            renderItem={({ item }) => (
              <RelativeListRow
                relative={item}
                personalLabel={personalLabels.get(item.id) ?? ''}
                signedUrl={item.photo_key ? signedUrls.get(item.photo_key) : undefined}
              />
            )}
            ListFooterComponent={
              showsUnconnectedHint ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  {UNCONNECTED_GROUP_HINT}
                </ThemedText>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function RelativeListRow({
  relative,
  personalLabel,
  signedUrl,
}: {
  relative: RelativeRow;
  /** The exact `relationLabel` for this one person — always shown (task requirement), even where it repeats the section heading (only the root's own row, whose heading already says the same thing). */
  personalLabel: string;
  signedUrl: string | undefined;
}) {
  const life = lifeLine(relative);
  const subtitle = [personalLabel, life].filter((part) => part.length > 0).join(' · ');

  return (
    <Pressable onPress={() => router.push(`/stammbaum/${relative.id}`)}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <PersonAvatar uri={signedUrl} name={relative.given_name} size={48} />
        <View style={styles.rowText}>
          <ThemedText type="smallBold">{displayName(relative)}</ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  header: { paddingTop: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.three },
  suggestionBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 4,
    backgroundColor: '#C0392B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  viewModeRow: { flexDirection: 'row', gap: Spacing.two, paddingBottom: Spacing.two },
  spinner: { paddingTop: Spacing.five },
  listContent: { paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  sectionHeader: { paddingTop: Spacing.three, paddingBottom: Spacing.one },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  hint: { paddingTop: Spacing.two, paddingBottom: Spacing.three },
});
