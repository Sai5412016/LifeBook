/**
 * Shown instead of the app when required EXPO_PUBLIC_ variables are missing
 * or obviously broken (see src/core/env.ts checkEnv). Same isolation rule as
 * ./crash-screen: no database, no network, no session — the whole reason this
 * screen exists is that those cannot be relied on yet.
 */

import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type EnvErrorScreenProps = {
  missing: string[];
};

export function EnvErrorScreen({ missing }: EnvErrorScreenProps) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const plural = missing.length !== 1;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>App nicht konfiguriert</Text>
        <Text style={styles.message}>
          {plural
            ? 'Die folgenden Umgebungsvariablen fehlen oder sind ungültig:'
            : 'Die folgende Umgebungsvariable fehlt oder ist ungültig:'}
        </Text>
        <View style={styles.list}>
          {missing.map((name) => (
            <Text key={name} style={styles.listItem} selectable>
              • {name}
            </Text>
          ))}
        </View>
        <Text style={styles.hint}>
          Ohne diese Angaben kann sich die App nicht mit dem Server verbinden. Bitte
          im Build hinterlegen (EAS-Secret oder .env-Datei) und die App neu starten.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#1a1500' },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  message: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  list: { gap: 6 },
  listItem: { color: '#ffd54f', fontFamily: 'monospace', fontSize: 14 },
  hint: { color: '#e0d8c0', fontSize: 13, lineHeight: 19 },
});
