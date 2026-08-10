import { describe, expect, it } from 'vitest';

import { translateAuthError } from './errors';

describe('translateAuthError', () => {
  it('translates wrong credentials', () => {
    expect(translateAuthError('Invalid login credentials')).toBe('E-Mail oder Passwort ist falsch.');
  });

  it('translates unconfirmed email', () => {
    expect(translateAuthError('Email not confirmed')).toBe(
      'Bitte bestätige zuerst deine E-Mail-Adresse (siehe Posteingang).',
    );
  });

  it('translates duplicate registration', () => {
    expect(translateAuthError('User already registered')).toBe(
      'Für diese E-Mail existiert bereits ein Konto — melde dich stattdessen an.',
    );
  });

  it('translates weak password', () => {
    expect(translateAuthError('Password should be at least 6 characters')).toBe(
      'Das Passwort muss mindestens 6 Zeichen lang sein.',
    );
  });

  it('falls back to the original message when unmapped', () => {
    expect(translateAuthError('Some unforeseen Supabase error')).toBe('Some unforeseen Supabase error');
  });
});
