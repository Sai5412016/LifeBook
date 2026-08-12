import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { translateAuthError } from '@/core/auth/errors';
import { supabase } from '@/core/supabase';
import { Button, KeyboardSafeScreen, TextField } from '@/ui';

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
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }

    // No manual navigation on success: the root layout's redirect gate
    // (src/app/_layout.tsx) reacts to the new session automatically — and so
    // does push registration (PushRegistrationEffect there), which used to
    // be triggered directly from here instead. 2026-08-13: that meant a
    // returning user who never re-does this screen (the common case) never
    // registered again either — moved to react to the session itself so it
    // also runs at every app start, not only right after this one action.
  };

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen contentContainerStyle={styles.scrollContent}>
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
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          <Button label="Anmelden" onPress={handleSignIn} loading={submitting} />

          <Link href="/sign-up" style={styles.switchLink}>
            <ThemedText type="linkPrimary">Noch kein Konto? Jetzt registrieren</ThemedText>
          </Link>
        </ThemedView>
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  switchLink: { alignSelf: 'center', marginTop: Spacing.two },
});
