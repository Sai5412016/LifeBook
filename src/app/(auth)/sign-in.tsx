import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { translateAuthError } from '@/core/auth/errors';
import { registerForPushNotifications } from '@/core/notifications';
import { supabase } from '@/core/supabase';
import { Button, TextField } from '@/ui';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }

    setSubmitting(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }

    // Fire-and-forget, right after a successful sign-in — NOT at cold start
    // (see core/notifications#registerForPushNotifications), so a parent is
    // only ever asked for the permission right after they've actively signed
    // in, never as a surprise on app launch.
    if (data.user) {
      void registerForPushNotifications(data.user.id);
    }
    // No manual navigation on success: the root layout's redirect gate
    // (src/app/_layout.tsx) reacts to the new session automatically.
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedText type="title" style={styles.title}>
            LifeBook
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Melde dich an, um weiterzumachen.
          </ThemedText>

          <ThemedView style={styles.form}>
            <TextField
              label="E-Mail"
              placeholder="du@beispiel.de"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextField
              label="Passwort"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />

            {error ? (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}

            <Button label="Anmelden" onPress={handleSignIn} loading={submitting} />

            <Link href="/sign-up" style={styles.switchLink}>
              <ThemedText type="linkPrimary">Noch kein Konto? Jetzt registrieren</ThemedText>
            </Link>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  form: { gap: Spacing.three, marginTop: Spacing.three },
  error: { color: '#e0524c' },
  switchLink: { alignSelf: 'center', marginTop: Spacing.two },
});
