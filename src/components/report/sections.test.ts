import { describe, expect, test } from "vitest";

import { REPORT_SECTIONS, sectionFromHash, withSectionHash } from "./sections";

describe("REPORT_SECTIONS slugs", () => {
  test("every section has its own lowercase, link-safe slug", () => {
    expect(REPORT_SECTIONS.map((section) => section.slug)).toEqual([
      "sun-hours",
      "today",
      "year",
      "skyline",
      "trees",
      "about",
    ]);
    for (const { slug } of REPORT_SECTIONS) expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe("sectionFromHash", () => {
  test("finds a section by its slug, with or without the leading #", () => {
    expect(sectionFromHash("#trees")?.id).toBe("report-trees");
    expect(sectionFromHash("trees")?.id).toBe("report-trees");
    expect(sectionFromHash("#sun-hours")?.label).toBe("Sun hours");
  });

  test("ignores case and surrounding spaces, and decodes the hash", () => {
    expect(sectionFromHash("#TREES")?.slug).toBe("trees");
    expect(sectionFromHash("#Sun-Hours")?.slug).toBe("sun-hours");
    expect(sectionFromHash("  #about ")?.slug).toBe("about");
    expect(sectionFromHash("#%74rees")?.slug).toBe("trees");
  });

  test("null for nothing, an unknown name, or a section id instead of a slug", () => {
    expect(sectionFromHash("")).toBeNull();
    expect(sectionFromHash("#")).toBeNull();
    expect(sectionFromHash(null)).toBeNull();
    expect(sectionFromHash(undefined)).toBeNull();
    expect(sectionFromHash("#report")).toBeNull();
    expect(sectionFromHash("#report-trees")).toBeNull();
    expect(sectionFromHash("#trees-and-more")).toBeNull();
    expect(sectionFromHash("#%E0%A4%A")).toBeNull();
  });
});

describe("withSectionHash", () => {
  test("adds a hash to a link without one", () => {
    expect(withSectionHash("https://sun.example/?lat=1&lng=2", "trees")).toBe(
      "https://sun.example/?lat=1&lng=2#trees",
    );
  });

  test("replaces an existing hash", () => {
    expect(withSectionHash("https://sun.example/?lat=1#sun-hours", "trees")).toBe(
      "https://sun.example/?lat=1#trees",
    );
  });

  test("null (or an empty slug) removes the hash and keeps everything before it", () => {
    expect(withSectionHash("https://sun.example/p?lat=1#trees", null)).toBe(
      "https://sun.example/p?lat=1",
    );
    expect(withSectionHash("https://sun.example/#", null)).toBe("https://sun.example/");
    expect(withSectionHash("https://sun.example/?a=1", null)).toBe("https://sun.example/?a=1");
    expect(withSectionHash("/x#y", "")).toBe("/x");
  });

  test("works on relative links", () => {
    expect(withSectionHash("/?lat=1#a#b", "about")).toBe("/?lat=1#about");
    expect(withSectionHash("", "today")).toBe("#today");
  });
});
