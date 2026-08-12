import { usePowerSync } from '@powersync/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { deviceTimeZone } from '@/core/time/device';
import { createHouseholdWithFirstChild } from '@/features/household/repository';
import { Button, KeyboardSafeScreen, TextField } from '@/ui';

// YYYY-MM-DD. A real date picker needs a native module (Master-Spec §5.2 covers
// birth_at) — deferred until the next native-dependency EAS build, see chat.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function HouseholdOnboardingScreen() {
  const { session } = useAuth();
  const db = usePowerSync();

  const [householdName, setHouseholdName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [childName, setChildName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    setError(null);

    if (!session) {
      setError('Nicht angemeldet.');
      return;
    }
    if (householdName.trim().length === 0) {
      setError('Bitte gib einen Namen für euren Haushalt ein.');
      return;
    }
    if (childName.trim().length === 0) {
      setError('Bitte gib den Vornamen deines Kindes ein.');
      return;
    }
    if (!DATE_RE.test(birthDate)) {
      setError('Geburtsdatum bitte im Format JJJJ-MM-TT eingeben, z. B. 2025-03-14.');
      return;
    }

    setSubmitting(true);
    try {
      await createHouseholdWithFirstChild(db, {
        userId: session.user.id,
        displayName: displayName.trim() || session.user.email || 'Ich',
        householdName: householdName.trim(),
        child: {
          firstName: childName.trim(),
          birthAtUtcIso: new Date(`${birthDate}T00:00:00Z`).toISOString(),
          birthTz: deviceTimeZone(),
        },
      });
      // No manual navigation: the root layout's redirect gate (src/app/_layout.tsx)
      // reacts to the new local household_members row and switches to (tabs)
      // automatically — this local write is instant, no network wait involved.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen. Bitte erneut versuchen.');
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen contentContainerStyle={styles.scrollContent}>
        <ThemedText type="title" style={styles.title}>
          Willkommen!
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Leg euren Haushalt und dein erstes Kind an — danach geht&apos;s los.
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextField
            label="Dein Name (wie andere dich sehen)"
            placeholder="z. B. Mama, Papa, Julia …"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <TextField
            label="Name eures Haushalts"
            placeholder="z. B. Familie Schmidt"
            value={householdName}
            onChangeText={setHouseholdName}
            autoCapitalize="words"
          />
          <TextField
            label="Vorname des Kindes"
            placeholder="z. B. Mia"
            value={childName}
            onChangeText={setChildName}
            autoCapitalize="words"
          />
          <TextField
            label="Geburtsdatum (JJJJ-MM-TT)"
            placeholder="2025-03-14"
            value={birthDate}
            onChangeText={setBirthDate}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />

          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          <Button label="Haushalt anlegen" onPress={handleCreate} loading={submitting} />
        </ThemedView>
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
    gap: Spacing.four,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  form: { gap: Spacing.three, marginTop: Spacing.three },
});
