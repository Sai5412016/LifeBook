/**
 * core/diagnostics/crash-reporter — last line of defence for app start.
 *
 * React Native funnels every JS exception that happens OUTSIDE React's render
 * cycle (a rejected promise, a native callback, a timer) into the global
 * `ErrorUtils` handler. Its default implementation is what made the crash
 * this module exists to fix invisible: on a release build there is no red
 * screen and nothing in a log — the process just ends. Overriding the handler
 * here, as close to app start as this codebase can manage, replaces that with
 * a screen a parent (and we, from their description) can actually read.
 *
 * Render-phase errors are NOT funnelled through `ErrorUtils` — React catches
 * those itself, which is what ./error-boundary.tsx is for.
 */

import { useEffect, useState } from 'react';

export type CrashInfo = {
  message: string;
  stack: string;
  /** True when the platform considered this fatal (about to terminate the app). */
  fatal: boolean;
};

type Listener = (crash: CrashInfo) => void;

type RNErrorUtils = {
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let latestCrash: CrashInfo | null = null;
let installed = false;
const listeners = new Set<Listener>();

function toCrashInfo(error: unknown, fatal: boolean): CrashInfo {
  const err = error instanceof Error ? error : new Error(String(error));
  return { message: err.message || String(error), stack: err.stack ?? '', fatal };
}

function publish(crash: CrashInfo): void {
  latestCrash = crash;
  listeners.forEach((listener) => listener(crash));
}

/**
 * Installs the global handler exactly once. Safe to call repeatedly (Fast
 * Refresh re-runs module bodies) and a no-op where `ErrorUtils` does not
 * exist — e.g. under Vitest, which runs this module in plain Node.
 */
export function installGlobalErrorHandler(): void {
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!errorUtils || installed) {
    return;
  }
  installed = true;

  errorUtils.setGlobalHandler((error, isFatal) => {
    const crash = toCrashInfo(error, isFatal ?? false);
    console.error('[LifeBook] Unbehandelter Fehler', isFatal ? '(fatal)' : '', error);
    publish(crash);
  });
}

/** Reactive hook: the most recent crash caught by the global handler, if any. */
export function useGlobalCrash(): CrashInfo | null {
  const [crash, setCrash] = useState(latestCrash);

  useEffect(() => {
    listeners.add(setCrash);
    return () => {
      listeners.delete(setCrash);
    };
  }, []);

  return crash;
}
