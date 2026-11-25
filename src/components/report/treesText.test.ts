import { describe, expect, it } from "vitest";
import {
  NOT_IN_SUN_HOURS,
  PORTLAND_CANOPY,
  backyardUnavailableText,
  blockTitle,
  canopyDefinition,
  diversityLine,
  formatFeet,
  formatFeetDistance,
  formatInches,
  formatInventoried,
  formatOffset,
  formatShare,
  formatShareFine,
  formatSquareFeet,
  leafText,
  originText,
  sidesText,
  siteText,
  treeHeightText,
  wiresText,
} from "./treesText";

const SURVEY = { year: 2014, name: "OLC Metro" };

describe("units", () => {
  it("writes distances, heights and trunks in US units", () => {
    expect(formatFeetDistance(16)).toBe("52 ft");
    expect(formatFeetDistance(300)).toBe("984 ft");
    expect(formatFeetDistance(383)).toBe("0.2 mi");
    expect(formatFeetDistance(1000)).toBe("0.6 mi");
    expect(formatOffset(16, 275)).toBe("52 ft W");
    expect(formatOffset(1, 90)).toBe("at the pin");
    expect(formatFeet(52)).toBe("52 ft");
    expect(formatFeet(255)).toBe("255+ ft");
    expect(formatInches(27.700000762)).toBe("27.7 in");
    expect(formatSquareFeet(1220.3)).toBe("1,220 sq ft");
  });

  it("writes shares", () => {
    expect(formatShare(0.9186)).toBe("92%");
    expect(formatShare(0.001)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShareFine(0.0967)).toBe("9.7%");
    expect(formatShareFine(0.1)).toBe("10.0%");
  });

  it("writes an inventory date as month and year, whatever the time zone", () => {
    expect(formatInventoried("2024-06-25")).toBe("Jun 2024");
    expect(formatInventoried(null)).toBe("");
  });
});

describe("tree facts", () => {
  it("say what the city records, in plain words", () => {
    expect(leafText("Broadleaf deciduous")).toBe("Deciduous broadleaf");
    expect(leafText("Coniferous evergreen")).toBe("Evergreen conifer");
    expect(leafText("Coniferous deciduous")).toBe("Deciduous conifer");
    expect(leafText("")).toBe("");
    expect(originText("Acer platanoides")).toBe("Not native · on the city's nuisance list");
    expect(originText("Acer macrophyllum")).toBe("Native to the Portland area");
    expect(originText("Not a tree")).toBe("");
    expect(wiresText("High voltage")).toBe("High-voltage lines");
    expect(wiresText("High Voltage")).toBe("High-voltage lines");
    expect(wiresText("None")).toBe("None");
    expect(wiresText("Other")).toBe("Other lines");
    expect(siteText("Strip", 6.2)).toBe("Planting strip, 6 ft wide");
    expect(siteText("Cutout", null)).toBe("Sidewalk cutout");
    expect(siteText("", null)).toBe("");
  });

  it("give the laser height with its survey, honestly", () => {
    expect(treeHeightText(52, SURVEY)).toBe("About 52 ft tall (2014 survey)");
    expect(treeHeightText(0, SURVEY)).toBe("Under 10 ft tall (2014 survey)");
    expect(treeHeightText(52, null)).toBe("About 52 ft tall");
    expect(treeHeightText(null, SURVEY)).toBe("Not in the laser survey");
    expect(treeHeightText("small", SURVEY)).toMatch(/^Young tree/);
    expect(treeHeightText(undefined, SURVEY)).toBe("");
  });

  it("name the block", () => {
    expect(blockTitle({ street: "NE 36TH AVE", hundred: 2100 })).toBe("2100–2199 NE 36th Ave");
  });

  it("say where the backyard's trees are, as a fact", () => {
    expect(
      sidesText([
        { side: "east", share: 0.7 },
        { side: "north", share: 0.3 },
      ]),
    ).toBe("Mostly on the east side of the yard");
    expect(
      sidesText([
        { side: "north", share: 0.35 },
        { side: "south", share: 0.33 },
      ]),
    ).toBe("Mostly on the north and south sides of the yard");
    expect(
      sidesText([
        { side: "north", share: 0.26 },
        { side: "south", share: 0.25 },
        { side: "east", share: 0.25 },
      ]),
    ).toBe("Spread around the yard");
    expect(sidesText([])).toBe("");
  });

  it("explains a missing backyard", () => {
    expect(backyardUnavailableText("large-lot")).toMatch(/^Not available for this kind of lot/);
    expect(backyardUnavailableText("no-street")).toMatch(/faces the street/);
  });

  it("writes the 10-20-30 levels", () => {
    expect(
      diversityLine("Species", {
        top: { name: "Acer platanoides", common: "Norway maple", count: 93, share: 0.0967 },
        limit: 0.1,
        pass: true,
      }),
    ).toBe("Species: Norway maple 9.7%");
    expect(diversityLine("Genus", { top: null, limit: 0.2, pass: true })).toBe("Genus: not known");
  });
});

describe("what the section always says", () => {
  it("keeps trees out of the sun hours, and never talks about shade", () => {
    expect(NOT_IN_SUN_HOURS).toBe("Trees are not part of the sun hours in this report.");
    const all = [
      canopyDefinition(SURVEY),
      canopyDefinition(null),
      sidesText([{ side: "south", share: 1 }]),
    ];
    for (const text of all) expect(text).not.toMatch(/shade|shadow/i);
  });

  it("defines canopy cover once, with the method difference", () => {
    expect(canopyDefinition(SURVEY)).toMatch(/10 ft or taller/);
    expect(canopyDefinition(SURVEY)).toMatch(/2014 laser survey/);
    expect(canopyDefinition(SURVEY)).toMatch(/will not match exactly/);
  });

  it("cites the city-wide figure from the city's own page", () => {
    expect(PORTLAND_CANOPY.share).toBe(0.324);
    expect(new URL(PORTLAND_CANOPY.url).hostname).toBe("www.portland.gov");
  });
});
