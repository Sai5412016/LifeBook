/**
 * components/diagnostics — the app's last line of defence. Rendered by the
 * global error handler AND the root ErrorBoundary (see
 * src/core/diagnostics), so it must work with NOTHING else available: no
 * database, no network, no signed-in session, possibly not even navigation.
 * Plain React Native primitives only — no ThemedText/ThemedView, no repository
 * calls, nothing that could itself throw and hide the very error we're trying
 * to show.
 */

import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type CrashScreenProps = {
  title?: string;
  message: string;
  stack?: string;
};

export function CrashScreen({
  title = 'Es ist ein Fehler aufgetreten',
  message,
  stack,
}: CrashScreenProps) {
  // Without this the native splash screen (hidden only by the normal startup
  // path, which never ran) would sit on top of this screen forever and the
  // app would look exactly like the silent crash we're trying to fix.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const fullText = stack ? `${message}\n\n${stack}` : message;

  const handleCopy = () => {
    // No expo-clipboard here on purpose: adding a new native module forces a
    // fresh EAS build before this fix could even run (Fallstrick 5 in
    // CLAUDE.md) — the opposite of what a crash screen needs. Share.share is
    // part of React Native itself, already in every build, and gets the text
    // off the device via any app the user has (Mail, Messages, ...). The
    // text below is also `selectable` as a fallback for manual copy.
    Share.share({ message: fullText }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message} selectable>
          {message}
        </Text>
        {stack ? (
          <ScrollView style={styles.stackBox}>
            <Text style={styles.stackText} selectable>
              {stack}
            </Text>
          </ScrollView>
        ) : null}
        <Pressable style={styles.button} onPress={handleCopy}>
          <Text style={styles.buttonText}>Fehlertext kopieren</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#1a0000' },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  message: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  stackBox: { flex: 1, backgroundColor: '#000000', borderRadius: 8, padding: 12 },
  stackText: { color: '#ff8a80', fontFamily: 'monospace', fontSize: 12 },
  button: { backgroundColor: '#ffffff', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#1a0000', fontWeight: '700', fontSize: 15 },
});
