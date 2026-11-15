import { describe, expect, test } from "vitest";
import { BUILDING_DATA_ATTRIBUTION } from "./attribution";

describe("BUILDING_DATA_ATTRIBUTION", () => {
  const { html, links, text } = BUILDING_DATA_ATTRIBUTION;

  test("the map's credit links every source the plain credit names, in the same order", () => {
    const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
      ([, url, label]) => ({ url, label }),
    );
    expect(anchors.map((anchor) => anchor.url)).toEqual(links.map((link) => link.url));
    for (const { label } of anchors) expect(text).toContain(label.replace("© ", ""));
    // What a person reads on the map.
    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "Buildings: OpenFreeMap © OpenMapTiles © OpenStreetMap",
    );
  });

  test("links open in a new tab without handing the page over", () => {
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html.match(/target="_blank" rel="noopener"/g)).toHaveLength(3);
  });
});
