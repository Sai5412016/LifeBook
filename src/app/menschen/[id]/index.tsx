/**
 * Personen-Detailansicht — Foto, Name, Rolle, Zeitraum und Notiz. Erreichbar
 * durch Antippen einer Person in der "Menschen"-Reihe auf der Startseite;
 * "Bearbeiten" führt zu ./bearbeiten.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { toLocalDate } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { PersonAvatar } from '@/features/people/components/person-avatar';
import { describeRole, formatPeriodLabel } from '@/features/people/logic';
import { usePersonById } from '@/features/people/repository';
import { useSignedUrls } from '@/features/photos/hooks';

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useActiveChild();
  const { person, isLoading } = usePersonById(id);
  const signedUrls = useSignedUrls([person?.photo_key]);
  const uri = person?.photo_key ? signedUrls.get(person.photo_key) : undefined;

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!person) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Person nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }

  const periodLabel = child
    ? formatPeriodLabel(
        person.met_from ? toLocalDate(person.met_from, child.birthTz) : null,
        person.met_to ? toLocalDate(person.met_to, child.birthTz) : null,
      )
    : null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Person</ThemedText>
          <Pressable onPress={() => router.push(`/menschen/${person.id}/bearbeiten`)} hitSlop={12}>
            <ThemedText type="linkPrimary">Bearbeiten</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.avatarRow}>
            <PersonAvatar uri={uri} name={person.name} size={120} />
          </View>
          <ThemedText type="subtitle" style={styles.name}>
            {person.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.role}>
            {describeRole(person.role)}
          </ThemedText>

          {periodLabel ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Zeitraum</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {periodLabel}
              </ThemedText>
            </ThemedView>
          ) : null}

          {person.note ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Notiz</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {person.note}
              </ThemedText>
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    alignItems: 'center',
  },
  avatarRow: { paddingTop: Spacing.two },
  name: { textAlign: 'center', marginTop: Spacing.two },
  role: { textAlign: 'center' },
  card: {
    width: '100%',
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
});
