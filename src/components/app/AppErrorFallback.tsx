"use client";

import { Button } from "@/components/ui/Button";
import { settingsStorage, useSettings } from "@/state";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}

/** Clear what the app remembers (it may be what broke it), then start over. */
function resetAndReload(): void {
  try {
    useSettings.getState().reset();
    settingsStorage.flush();
  } catch {
    // Storage is best effort; the reload below still drops the URL's settings.
  }
  window.location.replace(window.location.pathname);
}

interface AppErrorFallbackProps {
  error: unknown;
  /** Try rendering again without reloading, when the host offers that. */
  onRetry?: () => void;
}

/** The app-wide "something broke" screen: says so plainly and offers a way out. */
export function AppErrorFallback({ error, onRetry }: AppErrorFallbackProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-2">
        The app hit an error it couldn’t recover from. Reloading usually fixes it. If it keeps
        happening, reset the app — that clears the saved place and settings on this device.
      </p>
      <p className="rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs break-words text-ink-2">
        {errorText(error)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        <Button variant="ghost" onClick={resetAndReload}>
          Reset and reload
        </Button>
      </div>
    </main>
  );
}
