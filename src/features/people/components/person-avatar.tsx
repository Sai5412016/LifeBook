/**
 * A round portrait, or — without a photo — a circle with the person's
 * initials. Shared by the home screen's strip, the detail screen and the
 * add/edit form's preview, so the placeholder always looks the same.
 */

import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { initialsForName } from '../logic';

export function PersonAvatar({
  uri,
  name,
  size,
}: {
  uri: string | undefined;
  name: string;
  size: number;
}) {
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.image, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {initialsForName(name)}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
