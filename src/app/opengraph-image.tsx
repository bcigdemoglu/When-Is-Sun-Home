import { OG_SIZE, SITE_NAME } from "./og/model";
import { pngResponse, renderOgPng } from "./og/render";

/**
 * The site's default link-preview image: the brand card, in the same style as
 * the per-place cards served by `/og`. Links that pin a place override it in
 * `page.tsx`. Rendered on the Node.js runtime (the default).
 */
export const alt = `${SITE_NAME} Hours of direct sun for any backyard or window.`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage(): Promise<Response> {
  return pngResponse(
    await renderOgPng({ kind: "brand" }),
    "public, max-age=86400, stale-while-revalidate=604800",
  );
}
