/**
 * Ereignisse — besondere Momente mit Titel, Datum, Text und Fotos. Dritter
 * Reiter, zwischen Chronik und Alltag (siehe components/app-tabs.tsx).
 *
 * Anders als die Chronik keine Tages-Sektionen — ein Ereignis ist selten
 * genug, dass eine flache, neueste-zuerst-Liste die eigene Zeitachse nicht
 * unnötig zerstückelt.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useActiveChild } from '@/features/household/repository';
import { formatEventAgeLabel, formatEventTextPreview, formatShortGermanDate } from '@/features/events/logic';
import { useEventsOfChild } from '@/features/events/repository';
import type { EventSummaryRow } from '@/features/events/types';
import { useSignedUrls } from '@/features/photos/hooks';
import { Button } from '@/ui';

const THUMB_SIZE = 64;

export default function EreignisseScreen() {
  const { child } = useActiveChild();
  const { events, isLoading } = useEventsOfChild(child?.childId);
  const thumbKeys = events.map((event) => event.title_thumb_key);
  const signedUrls = useSignedUrls(thumbKeys);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Ereignisse</ThemedText>
        </View>

        <View style={styles.actions}>
          <Button
            label="Ereignis hinzufügen"
            onPress={() => router.push('/ereignisse/neu')}
            disabled={!child}
          />
        </View>

        <FlatList
          data={events}
          keyExtractor={(event) => event.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.empty}>
                <ThemedText type="subtitle">Noch keine Ereignisse</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                  Halte besondere Momente fest — mit Titel, Datum, ein paar Worten und Fotos.
                </ThemedText>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <EventRow
              event={item}
              ageLabel={
                child ? formatEventAgeLabel(item.occurred_at, child.birthAtUtcIso, child.birthTz) : ''
              }
              signedUrl={item.title_thumb_key ? signedUrls.get(item.title_thumb_key) : undefined}
            />
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function EventRow({
  event,
  ageLabel,
  signedUrl,
}: {
  event: EventSummaryRow;
  ageLabel: string;
  signedUrl: string | undefined;
}) {
  const uri = event.title_local_uri ?? signedUrl;
  const preview = formatEventTextPreview(event.note);

  return (
    <Pressable onPress={() => router.push(`/ereignisse/${event.id}`)}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.thumb}>
          {uri ? (
            <Image source={{ uri, cacheKey: event.title_thumb_key ?? event.id }} style={styles.thumbImage} contentFit="cover" />
          ) : null}
        </View>
        <View style={styles.rowText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {event.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatShortGermanDate(event.local_date)}
            {ageLabel ? ` · ${ageLabel}` : ''}
          </ThemedText>
          {preview ? (
            <ThemedText type="small" numberOfLines={1}>
              {preview}
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
  listContent: { paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1, gap: 2 },
  empty: { paddingTop: Spacing.five, gap: Spacing.two, alignItems: 'center' },
  emptyHint: { textAlign: 'center' },
});
