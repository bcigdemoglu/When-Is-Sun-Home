/**
 * GET /og?lat=…&lng=…&n=…&m=…&h=…&dir=…&fov=…&s=…
 *
 * The link-preview image for a shared place. A pure function of the query
 * string: no data is fetched and nothing is computed beyond decoding it, so
 * the response can be cached for ever. A public endpoint — every input goes
 * through the URL codec (validated, clamped, truncated) and anything
 * unusable degrades to a more generic card, never to an error.
 */
import { ogCardFromParams } from "./model";
import { pngResponse, renderOgPng } from "./render";

// `next/og` runs on the Node.js runtime here (the default); nothing to declare.

const CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Longest query string worth reading; a real one is under 250 characters. */
const MAX_QUERY_LENGTH = 2000;

export async function GET(request: Request): Promise<Response> {
  let params = new URLSearchParams();
  try {
    const { search } = new URL(request.url);
    if (search.length <= MAX_QUERY_LENGTH) params = new URLSearchParams(search);
  } catch {
    // unparseable URL: the brand card
  }
  try {
    return pngResponse(await renderOgPng(ogCardFromParams(params)), CACHE_CONTROL);
  } catch {
    // Even the brand card failed to render: nothing sensible left to send.
    return new Response("Preview unavailable", { status: 500 });
  }
}
