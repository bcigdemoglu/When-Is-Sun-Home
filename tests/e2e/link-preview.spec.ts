/**
 * Journey 11 — the link preview: a shared link's HTML carries Open Graph
 * tags with the answer, and `/og` draws the card as a PNG — also for links
 * with nothing or nonsense in them. Plain HTTP: no browser needed.
 */
import type { APIResponse } from "@playwright/test";
import { expect, test } from "./fixtures";

/** A real share link's query (a south window on the fixture pin, 4.9 h a day). */
const SHARED =
  "lat=37.79120&lng=-122.43010&n=Elm+St+backyard&d=2026-06-21&t=1500&m=w&s=1.1d14301db.00011j2q2d23282o260c0000.2p2z3a3n3x423z3q3f322s2m";

/** The `content` of a meta tag in the document's head. */
function meta(html: string, key: string): string | null {
  const head = html.slice(0, html.indexOf("</head>"));
  const tag = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(head);
  return tag ? tag[1].replace(/&amp;/g, "&") : null;
}

/** Width and height from a PNG's header, after checking that it is one. */
async function pngSize(response: APIResponse): Promise<{ width: number; height: number }> {
  const body = await response.body();
  expect(body.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

test.describe("Link preview", () => {
  test.beforeEach(({ isPhone }) => {
    test.skip(isPhone, "server responses do not depend on the device: checked once");
  });

  test("a shared link's HTML carries the answer in its Open Graph tags", async ({ request }) => {
    const response = await request.get(`/?${SHARED}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    // In the head, where crawlers look (they do not run scripts).
    expect(html.indexOf('property="og:title"')).toBeGreaterThan(0);
    expect(html.indexOf('property="og:title"')).toBeLessThan(html.indexOf("</head>"));

    expect(meta(html, "og:title")).toBe(
      "Elm St backyard: 4.9 h of direct sun a day · When Is Sun Home?",
    );
    expect(meta(html, "og:description")).toMatch(
      /^4\.9 h of direct sun on an average day \(9\.8 h in April, none in January\)\. 40% of possible daylight\./,
    );
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "twitter:title")).toBe(meta(html, "og:title"));
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "og:image:alt")).toContain("Elm St backyard: 4.9 h of direct sun");

    // The image is the `/og` card for exactly this place, viewpoint and summary.
    const image = new URL(meta(html, "og:image") ?? "");
    expect(image.pathname).toBe("/og");
    expect(image.searchParams.get("lat")).toBe("37.79120");
    expect(image.searchParams.get("n")).toBe("Elm St backyard");
    expect(image.searchParams.get("m")).toBe("w");
    expect(image.searchParams.get("s")).toBe(new URLSearchParams(SHARED).get("s"));
    expect(meta(html, "twitter:image")).toBe(image.href);

    // And that card can be fetched (from the server under test, whatever host the tag names).
    const card = await request.get(image.pathname + image.search);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect(await pngSize(card)).toEqual({ width: 1200, height: 630 });
  });

  test("/og draws a PNG card of sensible size", async ({ request }) => {
    const card = await request.get(`/og?${SHARED}`);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect(await pngSize(card)).toEqual({ width: 1200, height: 630 });
    const bytes = (await card.body()).length;
    expect(bytes).toBeGreaterThan(15_000);
    expect(bytes).toBeLessThan(600_000);
  });

  test("/og answers with a card for nothing, and for nonsense", async ({ request }) => {
    const answers: number[] = [];
    for (const query of [
      "",
      "?lat=abc&lng=999&s=%25%25%25&m=zzz",
      `?lat=37.79120&lng=-122.43010&s=${"9".repeat(3000)}&n=${"x".repeat(3000)}`,
      "?s=1.&n=%00%F0%9F%8C%9E&lat=37.7912&lng=-122.4301&m=__proto__",
    ]) {
      const card = await request.get(`/og${query}`);
      expect(card.status(), query).toBe(200);
      expect(card.headers()["content-type"], query).toBe("image/png");
      expect(await pngSize(card), query).toEqual({ width: 1200, height: 630 });
      answers.push((await card.body()).length);
    }
    for (const bytes of answers) {
      expect(bytes).toBeGreaterThan(15_000);
      expect(bytes).toBeLessThan(600_000);
    }
  });

  test("a link without a summary, and the bare site, still preview as the app", async ({
    request,
  }) => {
    for (const path of ["/", "/?lat=37.79120&lng=-122.43010", "/?lat=x&s=%%%&n=<script>"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      expect(meta(html, "og:title"), path).toMatch(/When Is Sun Home\?$/i);
      expect(meta(html, "og:image"), path).toBeTruthy();
      expect(meta(html, "twitter:card"), path).toBe("summary_large_image");
      // Nothing from the query string reaches the markup unescaped.
      expect(html, path).not.toContain('<script>"');
    }
    const html = await (await request.get("/")).text();
    const image = new URL(meta(html, "og:image") ?? "");
    const card = await request.get(image.pathname + image.search);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect(await pngSize(card)).toEqual({ width: 1200, height: 630 });
  });
});
