/**
 * core/diagnostics/import-error-store — catches failures that happen WHILE
 * OTHER MODULES ARE STILL BEING IMPORTED, before anything else in the app —
 * including installGlobalErrorHandler() in ./crash-reporter — has had a
 * chance to run. A throw during module import is invisible on a release
 * build otherwise: no red screen, nothing logged, the process just ends
 * before React ever starts. That is exactly the class of bug this file
 * exists to make visible.
 *
 * Deliberately importless beyond React itself. Anything this module needed
 * from elsewhere in the app could itself throw at import time and recreate
 * exactly the bug it exists to catch — and it must stay usable no matter how
 * much of the rest of the app failed to load.
 */

import { useEffect, useState } from 'react';

export type ImportError = {
  /** Which module/expression failed, e.g. "animated-icon: Dimensions.get". */
  source: string;
  message: string;
  stack: string;
};

let errors: ImportError[] = [];
const listeners = new Set<(errors: ImportError[]) => void>();

function toImportError(source: string, error: unknown): ImportError {
  const err = error instanceof Error ? error : new Error(String(error));
  return { source, message: err.message || String(error), stack: err.stack ?? '' };
}

function publish(): void {
  listeners.forEach((listener) => listener(errors));
}

/** Records a failure without throwing further. Safe to call from anywhere. */
export function recordImportError(source: string, error: unknown): void {
  errors = [...errors, toImportError(source, error)];
  publish();
}

/**
 * Runs `fn` immediately, catching and recording anything it throws
 * synchronously. Returns `fn`'s result, or `undefined` if it threw — callers
 * supply their own fallback for that case.
 */
export function guardImport<T>(source: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    recordImportError(source, error);
    return undefined;
  }
}

/**
 * Like `guardImport`, but for a call that must fire at module-load time yet
 * returns a promise that can reject later (e.g.
 * `SplashScreen.preventAutoHideAsync()`). Catches both the synchronous throw
 * and the asynchronous rejection; does not await, so module evaluation is
 * never blocked.
 */
export function guardImportAsync(source: string, fn: () => Promise<unknown>): void {
  try {
    fn()?.catch((error: unknown) => recordImportError(source, error));
  } catch (error) {
    recordImportError(source, error);
  }
}

/** All import-time failures recorded so far, oldest first. */
export function getImportErrors(): ImportError[] {
  return errors;
}

/** Reactive hook: every import-time failure recorded so far. */
export function useImportErrors(): ImportError[] {
  const [state, setState] = useState(errors);

  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
