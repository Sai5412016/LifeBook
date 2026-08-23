/**
 * Freigabe anlegen — zuerst die Art wählen (Fotoalbum oder Stammbaum), dann
 * Name, Gerätelimit und je nach Art entweder Fotoauswahl oder den Schalter
 * für Lebende. Erreichbar über den "Freigabe anlegen"-Knopf in Freigaben
 * (index.tsx).
 *
 * Enthält ein Textfeld (Name), daher in KeyboardSafeScreen (CLAUDE.md
 * Architekturregel 7).
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { useActiveChild } from '@/features/household/repository';
import { SharePhotoPicker } from '@/features/shares/components/photo-picker';
import {
  ALLOW_SUGGESTIONS_HINT_TEXT,
  ALLOW_SUGGESTIONS_LABEL,
  DEFAULT_DEVICE_LIMIT,
  DEVICE_LIMIT_CHOICES,
  SHOW_LIVING_DETAILS_HINT_TEXT,
  SHOW_LIVING_DETAILS_LABEL,
  TREE_SHARE_GUEST_NAME_HINT_TEXT,
} from '@/features/shares/logic';
import { createShare } from '@/features/shares/repository';
import type { ShareKind } from '@/features/shares/types';
import { toggleSelected } from '@/features/photos/selection';
import { Chip, KeyboardSafeScreen, TextField } from '@/ui';

export default function NeueFreigabeScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();

  const [kind, setKind] = useState<ShareKind>('photos');
  const [name, setName] = useState('');
  const [deviceLimit, setDeviceLimit] = useState<number>(DEFAULT_DEVICE_LIMIT);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [showLivingDetails, setShowLivingDetails] = useState(false);
  const [allowSuggestions, setAllowSuggestions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!child || !session?.user.id) {
      return;
    }
    setError(null);

    if (name.trim().length === 0) {
      setError('Bitte einen Namen eingeben.');
      return;
    }

    setSaving(true);
    try {
      const share = await createShare({
        householdId: child.householdId,
        userId: session.user.id,
        name: name.trim(),
        kind,
        showLivingDetails,
        allowSuggestions,
        deviceLimit,
        photoIds: kind === 'photos' ? selectedPhotoIds : [],
      });
      router.replace(`/freigaben/${share.id}`);
    } catch (saveError) {
      // Ehrliche Fehlermeldung statt stillem Scheitern — eine Freigabe kann
      // nur mit Internetverbindung angelegt werden (siehe repository.ts).
      console.error('[LifeBook] Freigabe konnte nicht angelegt werden', saveError);
      setError(
        saveError instanceof Error
          ? `Anlegen fehlgeschlagen: ${saveError.message}`
          : 'Anlegen fehlgeschlagen. Eine Freigabe braucht eine Internetverbindung.',
      );
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} disabled={saving}>
        <ThemedText type="link" themeColor="textSecondary">
          Abbrechen
        </ThemedText>
      </Pressable>
      <ThemedText type="smallBold">Freigabe anlegen</ThemedText>
      <Pressable onPress={handleSave} hitSlop={12} disabled={saving || !child}>
        <ThemedText type="linkPrimary">{saving ? '…' : 'Anlegen'}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen header={header} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Art der Freigabe
          </ThemedText>
          <View style={styles.chipRow}>
            <Chip label="Fotoalbum" selected={kind === 'photos'} onPress={() => setKind('photos')} />
            <Chip label="Stammbaum" selected={kind === 'tree'} onPress={() => setKind('tree')} />
          </View>
        </View>

        <TextField label="Name" value={name} onChangeText={setName} placeholder="z. B. Oma und Opa" autoCapitalize="words" />

        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Gerätelimit
          </ThemedText>
          <View style={styles.chipRow}>
            {DEVICE_LIMIT_CHOICES.map((limit) => (
              <Chip key={limit} label={String(limit)} selected={deviceLimit === limit} onPress={() => setDeviceLimit(limit)} />
            ))}
          </View>
        </View>

        {error ? (
          <ThemedText type="small" themeColor="dangerText">
            {error}
          </ThemedText>
        ) : null}

        {kind === 'photos' ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Fotos</ThemedText>
            <SharePhotoPicker
              childId={child?.childId}
              selectedIds={selectedPhotoIds}
              onToggle={(photoId) => setSelectedPhotoIds((current) => toggleSelected(current, photoId))}
            />
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.switchRow}>
              <ThemedText style={styles.switchLabel}>{SHOW_LIVING_DETAILS_LABEL}</ThemedText>
              <Switch value={showLivingDetails} onValueChange={setShowLivingDetails} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {SHOW_LIVING_DETAILS_HINT_TEXT}
            </ThemedText>

            <View style={styles.switchRow}>
              <ThemedText style={styles.switchLabel}>{ALLOW_SUGGESTIONS_LABEL}</ThemedText>
              <Switch value={allowSuggestions} onValueChange={setAllowSuggestions} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {ALLOW_SUGGESTIONS_HINT_TEXT}
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
              {TREE_SHARE_GUEST_NAME_HINT_TEXT}
            </ThemedText>
          </View>
        )}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  section: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  switchLabel: { flex: 1 },
});
