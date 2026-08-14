/**
 * Freigabe anlegen — Name, Gerätelimit, Fotoauswahl. Erreichbar über den
 * "Freigabe anlegen"-Knopf in Freigaben (index.tsx).
 *
 * Enthält ein Textfeld (Name), daher in KeyboardSafeScreen (CLAUDE.md
 * Architekturregel 7).
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { useActiveChild } from '@/features/household/repository';
import { SharePhotoPicker } from '@/features/shares/components/photo-picker';
import { DEFAULT_DEVICE_LIMIT, DEVICE_LIMIT_CHOICES } from '@/features/shares/logic';
import { createShare } from '@/features/shares/repository';
import { toggleSelected } from '@/features/photos/selection';
import { Chip, KeyboardSafeScreen, TextField } from '@/ui';

export default function NeueFreigabeScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();

  const [name, setName] = useState('');
  const [deviceLimit, setDeviceLimit] = useState<number>(DEFAULT_DEVICE_LIMIT);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
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
        deviceLimit,
        photoIds: selectedPhotoIds,
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

        <View style={styles.section}>
          <ThemedText type="smallBold">Fotos</ThemedText>
          <SharePhotoPicker
            childId={child?.childId}
            selectedIds={selectedPhotoIds}
            onToggle={(photoId) => setSelectedPhotoIds((current) => toggleSelected(current, photoId))}
          />
        </View>
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
});
