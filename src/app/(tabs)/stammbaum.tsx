/**
 * Stammbaum — Verwandte, nach Generation gruppiert. Legt beim ersten Öffnen
 * den Wurzelknoten an (die eine `relatives`-Zeile mit `child_id`), ohne
 * Rückfrage — siehe features/tree/repository.ts#ensureRootRelative.
 *
 * Verstorbene werden NICHT ausgegraut (Task-Vorgabe) — "verstorben" steht
 * bereits lesbar in der Lebensdaten-Zeile (features/tree/logic.ts#lifeLine),
 * das reicht als Kennzeichnung.
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
  computeGenerations,
  displayName,
  groupForList,
  lifeLine,
  type FamilyGraphPerson,
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

  const graphPeople: FamilyGraphPerson[] = relatives.map((relative) => ({
    id: relative.id,
    motherId: relative.mother_id,
    fatherId: relative.father_id,
    partnerIds: unions
      .filter((union) => union.a_id === relative.id || union.b_id === relative.id)
      .map((union) => (union.a_id === relative.id ? union.b_id : union.a_id)),
  }));

  const generations = rootRelative ? computeGenerations(graphPeople, rootRelative.id) : new Map<string, number>();
  const groups = groupForList(relatives, generations, child?.firstName ?? 'Stammbaum');

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
            renderItem={({ item }) => (
              <RelativeListRow
                relative={item}
                signedUrl={item.photo_key ? signedUrls.get(item.photo_key) : undefined}
              />
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function RelativeListRow({ relative, signedUrl }: { relative: RelativeRow; signedUrl: string | undefined }) {
  const life = lifeLine(relative);
  return (
    <Pressable onPress={() => router.push(`/stammbaum/${relative.id}`)}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <PersonAvatar uri={signedUrl} name={relative.given_name} size={48} />
        <View style={styles.rowText}>
          <ThemedText type="smallBold">{displayName(relative)}</ThemedText>
          {life ? (
            <ThemedText type="small" themeColor="textSecondary">
              {life}
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
});
