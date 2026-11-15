import { ImageResponse } from "next/og";
import { ogCardElement } from "./card";
import { OG_SIZE, type OgCard } from "./model";

/** Longest we wait for one rendering before falling back to a simpler card. */
const RENDER_TIMEOUT_MS = 4000;

async function render(card: OgCard): Promise<ArrayBuffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("og render timed out")), RENDER_TIMEOUT_MS);
  });
  try {
    // Reading the body forces the rendering, so that a failure surfaces here
    // (and not as a broken stream after the headers have been sent).
    return await Promise.race([
      new ImageResponse(ogCardElement(card), OG_SIZE).arrayBuffer(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The card as PNG bytes. If rendering fails or stalls, the brand card is
 * rendered instead, so a preview is never a broken image. (All text on a card
 * is drawable with the bundled font — see `placeLabel` — so no rendering
 * waits on the network.)
 */
export async function renderOgPng(card: OgCard): Promise<ArrayBuffer> {
  try {
    return await render(card);
  } catch {
    return render({ kind: "brand" });
  }
}

export function pngResponse(png: ArrayBuffer, cacheControl: string): Response {
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      "Cache-Control": cacheControl,
    },
  });
}
