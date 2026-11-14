"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/**
 * Last resort: the root layout itself failed, so this replaces the whole
 * document and cannot rely on the app's stylesheet. Inline styles only; the
 * colours follow the system scheme through the `Canvas` system colours.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const button = {
    minHeight: 40,
    padding: "0 16px",
    borderRadius: 8,
    border: "1px solid GrayText",
    background: "Canvas",
    color: "CanvasText",
    font: "inherit",
    cursor: "pointer",
  } as const;

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "Canvas",
          color: "CanvasText",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong · When is Sun Home?</title>
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
            The app couldn’t start. Reloading the page usually fixes it.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={button} onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" style={button} onClick={() => retry()}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
