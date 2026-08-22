/**
 * Stammbaum — Verwandte, nach tatsächlicher Beziehung zu Marina gruppiert
 * (features/tree/logic.ts#relationLabel — NICHT nach Generation, siehe
 * dessen Dateikopf zu Fehler 2 vom 22.08.2026). Legt beim ersten Öffnen den
 * Wurzelknoten an (die eine `relatives`-Zeile mit `child_id`), ohne
 * Rückfrage — siehe features/tree/repository.ts#ensureRootRelative.
 *
 * Verstorbene werden NICHT ausgegraut (Task-Vorgabe) — "verstorben" steht
 * bereits lesbar in der Lebensdaten-Zeile (features/tree/logic.ts#lifeLine),
 * das reicht als Kennzeichnung.
 *
 * Fehler 1 vom 22.08.2026: JEDE nicht gelöschte Person des Haushalts muss
 * in dieser Liste auftauchen — eine Person, die hier fehlt, ist über die
 * Oberfläche nicht mehr erreichbar und nicht mehr korrigierbar. Dafür
 * garantiert `groupForList` per Konstruktion, dass niemand aus jeder
 * Gruppe herausfällt (siehe dessen eigenen Kommentar und den
 * "Summe aller Gruppengrößen"-Test in logic.test.ts) — diese Datei muss
 * nur `relatives` VOLLSTÄNDIG hineingeben, ohne eigene Filterung davor.
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
import {
  UNCONNECTED_GROUP_HINT,
  displayName,
  groupForList,
  lifeLine,
  relationLabel,
} from '@/features/tree/logic';
import { ensureRootRelative, useRelativesOfHousehold, useUnionsOfHousehold } from '@/features/tree/repository';
import type { RelativeRow } from '@/features/tree/types';
import { Button } from '@/ui';

export default function StammbaumScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relatives, isLoading } = useRelativesOfHousehold(child?.householdId);
  const { unions } = useUnionsOfHousehold(child?.householdId);
  const [ensuring, setEnsuring] = useState(false);

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
  // Each person's OWN precise relation ("Tante"/"Onkel"/"Cousine"/"Cousin"
  // when gender is known) — shown on the row only where it says more than
  // the section heading already does (see RelativeListRow below).
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
        </View>

        {(isLoading || ensuring) && relatives.length === 0 ? (
          <ActivityIndicator style={styles.spinner} />
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
            renderItem={({ item, section }) => (
              <RelativeListRow
                relative={item}
                sectionLabel={section.title}
                personalLabel={personalLabels.get(item.id) ?? section.title}
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
  sectionLabel,
  personalLabel,
  signedUrl,
}: {
  relative: RelativeRow;
  sectionLabel: string;
  /** Same as `sectionLabel` for every category except Tanten/Onkel and Cousins/Cousinen, where it can be the gendered form. */
  personalLabel: string;
  signedUrl: string | undefined;
}) {
  const life = lifeLine(relative);
  // Only worth repeating on the row when it says MORE than the section
  // heading already does — true only for the gendered aunt/uncle/cousin
  // case (task: "Auf der Personenkarte darf, wenn gender gesetzt ist, die
  // genaue Form stehen").
  const relationText = personalLabel !== sectionLabel ? personalLabel : '';
  const subtitle = [relationText, life].filter((part) => part.length > 0).join(' · ');

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
  actions: { paddingVertical: Spacing.three },
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
