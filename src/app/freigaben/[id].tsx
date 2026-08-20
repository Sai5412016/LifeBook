/**
 * Freigabe-Detail — Link/Code, verbundene Geräte, Gerätelimit,
 * Fotoauswahl, Widerrufen/Löschen. Aufgabe 3/4 der Gastzugang-Stufe 1.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { deviceTimeZone } from '@/core/time/device';
import {
  DEVICE_LIMIT_CHOICES,
  SHARE_DISCLOSURE_TEXT,
  buildShareLink,
  describeShareState,
  formatDeviceSeenLabel,
  formatShareDeviceName,
  formatDeleteConfirmation,
  formatPhotoCountLabel,
  formatRevokeConfirmation,
  formatShareMessage,
} from '@/features/shares/logic';
import {
  deleteShare,
  getShare,
  listSharePhotoIds,
  listShareDevices,
  removeShareDevice,
  revokeShare,
  setShareDeviceLimit,
} from '@/features/shares/repository';
import type { ShareDeviceRow, ShareRow } from '@/features/shares/types';
import { Chip, useUiColors } from '@/ui';

export default function FreigabeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accent } = useUiColors();

  const [share, setShare] = useState<ShareRow | null | undefined>(undefined);
  const [devices, setDevices] = useState<ShareDeviceRow[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!id) {
      return;
    }
    setError(null);
    Promise.all([getShare(id), listShareDevices(id), listSharePhotoIds(id)])
      .then(([shareRow, deviceRows, photoIds]) => {
        setShare(shareRow);
        setDevices(deviceRows);
        setPhotoCount(photoIds.length);
      })
      .catch((loadError: unknown) => {
        console.error('[LifeBook] Freigabe konnte nicht geladen werden', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
      });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleShare = async () => {
    if (!share) {
      return;
    }
    const link = buildShareLink(share.token);
    try {
      await Share.share({ message: formatShareMessage(share.name, link, share.access_code) });
    } catch (shareError) {
      console.error('[LifeBook] Freigabe teilen fehlgeschlagen', shareError);
    }
  };

  const handleSetDeviceLimit = async (limit: number) => {
    if (!share) {
      return;
    }
    setBusy(true);
    try {
      await setShareDeviceLimit(share.id, limit);
      setShare({ ...share, device_limit: limit });
    } catch (updateError) {
      console.error('[LifeBook] Gerätelimit konnte nicht geändert werden', updateError);
      setError(updateError instanceof Error ? updateError.message : 'Ändern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveDevice = (device: ShareDeviceRow) => {
    const deviceName = formatShareDeviceName(device.label, device.user_agent);
    Alert.alert('Gerät entfernen?', `„${deviceName}" verliert damit den Zugriff.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await removeShareDevice(device.id);
            setDevices((current) => current.filter((d) => d.id !== device.id));
          } catch (removeError) {
            console.error('[LifeBook] Gerät konnte nicht entfernt werden', removeError);
            setError(removeError instanceof Error ? removeError.message : 'Entfernen fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleRevoke = () => {
    if (!share) {
      return;
    }
    Alert.alert('Freigabe widerrufen?', formatRevokeConfirmation(share.name), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Widerrufen',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await revokeShare(share.id);
            reload();
          } catch (revokeError) {
            console.error('[LifeBook] Freigabe konnte nicht widerrufen werden', revokeError);
            setError(revokeError instanceof Error ? revokeError.message : 'Widerrufen fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleDelete = () => {
    if (!share) {
      return;
    }
    Alert.alert('Freigabe löschen?', formatDeleteConfirmation(share.name), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Endgültig löschen',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteShare(share.id);
            router.back();
          } catch (deleteError) {
            console.error('[LifeBook] Freigabe konnte nicht gelöscht werden', deleteError);
            setError(deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.');
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (share === undefined) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (share === null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Freigabe nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }

  const link = buildShareLink(share.token);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">{share.name}</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText
            type="small"
            themeColor={share.revoked_at ? 'dangerText' : undefined}
            style={!share.revoked_at ? { color: accent } : undefined}>
            {describeShareState(share.revoked_at)} · {formatPhotoCountLabel(photoCount)}
          </ThemedText>

          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Link</ThemedText>
            <ThemedText type="small" selectable>
              {link}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.codeLabel}>
              Zugangscode
            </ThemedText>
            <ThemedText type="title" style={styles.code} selectable>
              {share.access_code}
            </ThemedText>
            <Pressable onPress={handleShare} hitSlop={8} disabled={!!share.revoked_at}>
              <ThemedText type="linkPrimary" themeColor={share.revoked_at ? 'textSecondary' : undefined}>
                Link und Code weitergeben
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary">
            {SHARE_DISCLOSURE_TEXT}
          </ThemedText>

          <View style={styles.section}>
            <ThemedText type="smallBold">Gerätelimit</ThemedText>
            <View style={styles.chipRow}>
              {DEVICE_LIMIT_CHOICES.map((limit) => (
                <Chip
                  key={limit}
                  label={String(limit)}
                  selected={share.device_limit === limit}
                  onPress={() => handleSetDeviceLimit(limit)}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold">Fotos</ThemedText>
              <Pressable onPress={() => router.push(`/freigaben/${share.id}/fotos`)} hitSlop={8}>
                <ThemedText type="linkPrimary">Ändern</ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {formatPhotoCountLabel(photoCount)}
            </ThemedText>
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Verbundene Geräte</ThemedText>
            {devices.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Noch kein Gerät hat den Code eingelöst.
              </ThemedText>
            ) : (
              devices.map((device) => (
                <ThemedView key={device.id} type="backgroundElement" style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <ThemedText type="small">
                      {formatShareDeviceName(device.label, device.user_agent)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDeviceSeenLabel(device.first_seen_at, device.last_seen_at, deviceTimeZone())}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => handleRemoveDevice(device)} hitSlop={8} disabled={busy}>
                    <ThemedText type="linkPrimary" themeColor="dangerText">
                      Entfernen
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              ))
            )}
          </View>

          <View style={styles.dangerSection}>
            {!share.revoked_at ? (
              <Pressable onPress={handleRevoke} hitSlop={8} disabled={busy}>
                <ThemedText type="linkPrimary" themeColor="dangerText">
                  Freigabe widerrufen
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable onPress={handleDelete} hitSlop={8} disabled={busy}>
              <ThemedText type="linkPrimary" themeColor="dangerText">
                Freigabe endgültig löschen
              </ThemedText>
            </Pressable>
          </View>
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
  headerSpacer: { width: 48 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  codeLabel: { marginTop: Spacing.two },
  code: { letterSpacing: 4 },
  section: { gap: Spacing.two },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chipRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  deviceInfo: { flex: 1, gap: 2 },
  dangerSection: { gap: Spacing.two, marginTop: Spacing.two },
});
