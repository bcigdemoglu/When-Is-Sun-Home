"use client";

import { AppErrorFallback } from "./AppErrorFallback";
import { AppShell } from "./AppShell";
import { ErrorBoundary } from "./ErrorBoundary";
import { Providers } from "./Providers";

/** Everything interactive, behind an error boundary with a readable way out. */
export function App() {
  return (
    <ErrorBoundary fallback={(error, reset) => <AppErrorFallback error={error} onRetry={reset} />}>
      <Providers>
        <AppShell />
      </Providers>
    </ErrorBoundary>
  );
}
