/**
 * Stammbaum-Detailansicht — Portrait, Name, Lebensdaten, Notiz, Eltern und
 * Partner als antippbare Verweise. Fotoraster und Beziehungstext kommen in
 * Stufe 2 (Task-Vorgabe) — hier bewusst schlicht, exakt das Muster von
 * src/app/menschen/[id]/index.tsx.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PersonAvatar } from '@/features/people/components/person-avatar';
import { useSignedUrls } from '@/features/photos/hooks';
import { displayName, lifeLine } from '@/features/tree/logic';
import { useRelativeById, useRelativePartnerId, useRelativesOfHousehold } from '@/features/tree/repository';
import type { RelativeRow } from '@/features/tree/types';

export default function StammbaumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { relative, isLoading } = useRelativeById(id);
  const { relatives } = useRelativesOfHousehold(relative?.household_id);
  const { partnerId } = useRelativePartnerId(id);
  const signedUrls = useSignedUrls([relative?.photo_key]);
  const uri = relative?.photo_key ? signedUrls.get(relative.photo_key) : undefined;

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!relative) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Person nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }

  const byId = new Map(relatives.map((r) => [r.id, r]));
  const mother = relative.mother_id ? byId.get(relative.mother_id) : undefined;
  const father = relative.father_id ? byId.get(relative.father_id) : undefined;
  const partner = partnerId ? byId.get(partnerId) : undefined;
  const life = lifeLine(relative);

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
          <Pressable onPress={() => router.push(`/stammbaum/${relative.id}/bearbeiten`)} hitSlop={12}>
            <ThemedText type="linkPrimary">Bearbeiten</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.avatarRow}>
            <PersonAvatar uri={uri} name={relative.given_name} size={120} />
          </View>
          <ThemedText type="subtitle" style={styles.name}>
            {displayName(relative)}
          </ThemedText>
          {life ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.life}>
              {life}
            </ThemedText>
          ) : null}

          {mother || father || partner ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Familie</ThemedText>
              {mother ? <RelativeLink label="Mutter" relative={mother} /> : null}
              {father ? <RelativeLink label="Vater" relative={father} /> : null}
              {partner ? <RelativeLink label="Partner" relative={partner} /> : null}
            </ThemedView>
          ) : null}

          {relative.note ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Notiz</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {relative.note}
              </ThemedText>
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function RelativeLink({ label, relative }: { label: string; relative: RelativeRow }) {
  return (
    <Pressable onPress={() => router.push(`/stammbaum/${relative.id}`)} style={styles.linkRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="linkPrimary">{displayName(relative)}</ThemedText>
    </Pressable>
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
  life: { textAlign: 'center' },
  card: {
    width: '100%',
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.half,
  },
});
