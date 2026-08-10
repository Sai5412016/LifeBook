import { describe, expect, it } from 'vitest';

import { checkEnv } from './env';

describe('checkEnv', () => {
  it('is ok when both required variables look valid', () => {
    const result = checkEnv({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });

    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('reports a missing URL', () => {
    const result = checkEnv({ SUPABASE_URL: '', SUPABASE_ANON_KEY: 'anon-key' });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
  });

  it('reports a URL that is obviously not a URL', () => {
    const result = checkEnv({ SUPABASE_URL: 'not-a-url', SUPABASE_ANON_KEY: 'anon-key' });

    expect(result.missing).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
  });

  it('reports a missing anon key', () => {
    const result = checkEnv({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: '' });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('reports both names when everything is missing', () => {
    const result = checkEnv({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });

    expect(result.missing).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });

  it('accepts http, not just https, since local/dev backends may use it', () => {
    expect(checkEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'x' }).ok).toBe(
      true,
    );
  });
});
