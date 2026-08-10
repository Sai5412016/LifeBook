/**
 * core/diagnostics/error-boundary — catches render-phase failures.
 *
 * The global handler in ./crash-reporter only sees errors OUTSIDE React's
 * render cycle; a throw DURING render (e.g. a component reading a field off
 * a row that turned out to be undefined) only React itself can catch, via
 * this class-component API — there is no hook equivalent.
 */

import { Component, type ReactNode } from 'react';

import { CrashScreen } from '@/components/diagnostics/crash-screen';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[LifeBook] Renderfehler abgefangen', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <CrashScreen message={this.state.error.message} stack={this.state.error.stack} />;
    }
    return this.props.children;
  }
}
