import { describe, it, expect } from "vitest";
import { getSunPosition, getSunTimes } from "@/lib/sunPosition";
import {
  bearingToCompass,
  angularDifference,
  filterBuildingsBySunBearing,
  computeBlockage,
  detectPinBuilding,
} from "@/lib/sunBlockage";
import { deriveSunVisibility } from "@/types/sun";
import type { SunData, SunPosition, SunTimes, SunBlockageInfo, SunVisibility, Location } from "@/types/sun";
import type { BuildingGeoJSON, BuildingFeature } from "@/lib/overpass";
import pacificHeightsFixture from "./fixtures/pacific-heights.json";

// ─── Diagnostic helper ──────────────────────────────────────────────────

interface AnalysisInput {
  lat: number;
  lng: number;
  date: Date;
  floor: number;
  buildingData: BuildingGeoJSON;
}

interface AnalysisResult {
  sunPosition: SunPosition;
  sunTimes: SunTimes;
  userElevation: number;
  pinBuilding: BuildingFeature | null;
  blockage: SunBlockageInfo;
  visibility: SunVisibility;
  candidateBuildings: BuildingFeature[];
  totalBuildings: number;
}

function analyzeSunVisibility(input: AnalysisInput): AnalysisResult {
  const { lat, lng, date, floor, buildingData } = input;
  const location: Location = { lat, lng };

  const sunPosition = getSunPosition(lat, lng, date);
  const sunTimes = getSunTimes(lat, lng, date);

  // Floor 1 = ground level (0m), each additional floor adds ~3m
  const userElevation = Math.max(0, (floor - 1) * 3);

  const pinBuilding = detectPinBuilding(buildingData, location);

  const sunData: SunData = {
    position: sunPosition,
    times: sunTimes,
    arc: [], // not needed for blockage
  };

  const blockage = computeBlockage(location, sunData, buildingData, userElevation);
  const visibility = deriveSunVisibility(sunData, blockage);

  const candidateBuildings = filterBuildingsBySunBearing(
    buildingData.features,
    location,
    sunPosition.azimuth
  );

  return {
    sunPosition,
    sunTimes,
    userElevation,
    pinBuilding,
    blockage,
    visibility,
    candidateBuildings,
    totalBuildings: buildingData.features.length,
  };
}

// ─── Unit tests: angular helpers ────────────────────────────────────────

describe("bearingToCompass", () => {
  it("converts positive bearings", () => {
    expect(bearingToCompass(90)).toBe(90);
    expect(bearingToCompass(180)).toBe(180);
    expect(bearingToCompass(0)).toBe(0);
    expect(bearingToCompass(360)).toBe(0);
  });

  it("converts negative bearings", () => {
    expect(bearingToCompass(-90)).toBe(270);
    expect(bearingToCompass(-180)).toBe(180);
    expect(bearingToCompass(-1)).toBe(359);
  });

  it("handles values > 360", () => {
    expect(bearingToCompass(450)).toBe(90);
    expect(bearingToCompass(720)).toBe(0);
  });
});

describe("angularDifference", () => {
  it("computes simple differences", () => {
    expect(angularDifference(10, 20)).toBe(10);
    expect(angularDifference(90, 180)).toBe(90);
    expect(angularDifference(0, 180)).toBe(180);
  });

  it("handles wrap-around (350° vs 10° = 20°)", () => {
    expect(angularDifference(350, 10)).toBe(20);
    expect(angularDifference(10, 350)).toBe(20);
  });

  it("handles identical angles", () => {
    expect(angularDifference(45, 45)).toBe(0);
    expect(angularDifference(0, 0)).toBe(0);
  });

  it("handles opposite directions", () => {
    expect(angularDifference(0, 180)).toBe(180);
    expect(angularDifference(90, 270)).toBe(180);
  });
});

// ─── Unit tests: filterBuildingsBySunBearing ────────────────────────────

describe("filterBuildingsBySunBearing", () => {
  const buildingData = pacificHeightsFixture as BuildingGeoJSON;
  const pin: Location = { lat: 37.7906, lng: -122.4294 };

  it("filters buildings to those in the sun direction", () => {
    // Sun roughly south (azimuth ~177°)
    const candidates = filterBuildingsBySunBearing(
      buildingData.features,
      pin,
      177,
      30
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(buildingData.features.length);
  });

  it("returns no buildings for a direction with none", () => {
    // Use a very tight tolerance in a direction with no buildings
    // (This is a sanity check — exact results depend on geometry)
    const candidates = filterBuildingsBySunBearing(
      buildingData.features,
      pin,
      177,
      0.01
    );
    // With a near-zero tolerance, very few or no buildings should match
    expect(candidates.length).toBeLessThan(10);
  });
});

// ─── Unit tests: computeBlockage with known geometry ────────────────────

describe("computeBlockage", () => {
  it("detects blockage from a tall building directly in the sun path", () => {
    // Create a simple scenario: observer at origin, tall building 50m south
    const observer: Location = { lat: 37.7900, lng: -122.4294 };

    // A tall building ~50m to the south of the observer
    const tallBuilding: BuildingFeature = {
      type: "Feature",
      properties: { id: 1, height: 30, levels: 10, heightSource: "measured" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-122.4296, 37.7896],
          [-122.4292, 37.7896],
          [-122.4292, 37.7898],
          [-122.4296, 37.7898],
          [-122.4296, 37.7896],
        ]],
      },
    };

    const buildingData: BuildingGeoJSON = {
      type: "FeatureCollection",
      features: [tallBuilding],
    };

    // Sun from the south at low elevation
    const sunData: SunData = {
      position: { azimuth: 180, altitude: 20 },
      times: {} as SunTimes,
      arc: [],
    };

    const result = computeBlockage(observer, sunData, buildingData, 0);
    expect(result.isBlocked).toBe(true);
    expect(result.blockingBuildingHeight).toBe(30);
  });

  it("does not report blockage for short buildings", () => {
    const observer: Location = { lat: 37.7900, lng: -122.4294 };

    const shortBuilding: BuildingFeature = {
      type: "Feature",
      properties: { id: 2, height: 3, levels: 1, heightSource: "estimated" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-122.4296, 37.7896],
          [-122.4292, 37.7896],
          [-122.4292, 37.7898],
          [-122.4296, 37.7898],
          [-122.4296, 37.7896],
        ]],
      },
    };

    const buildingData: BuildingGeoJSON = {
      type: "FeatureCollection",
      features: [shortBuilding],
    };

    // Sun from south at moderate elevation — ray clears 3m building easily
    const sunData: SunData = {
      position: { azimuth: 180, altitude: 30 },
      times: {} as SunTimes,
      arc: [],
    };

    const result = computeBlockage(observer, sunData, buildingData, 0);
    expect(result.isBlocked).toBe(false);
  });

  it("returns not blocked when sun is below horizon", () => {
    const result = computeBlockage(
      { lat: 37.79, lng: -122.43 },
      { position: { azimuth: 180, altitude: -5 }, times: {} as SunTimes, arc: [] },
      { type: "FeatureCollection", features: [] },
      0
    );
    expect(result.isBlocked).toBe(false);
  });
});

// ─── Integration test: Pacific Heights ──────────────────────────────────

describe("Pacific Heights Towers — Dec 31 12:03 PM", () => {
  const buildingData = pacificHeightsFixture as BuildingGeoJSON;

  // Dec 31, 2025, 12:03 PM PST (UTC-8)
  const date = new Date("2025-12-31T12:03:00-08:00");
  const lat = 37.7906;
  const lng = -122.4294;

  it("computes expected sun position (~177° azimuth, ~29° altitude)", () => {
    const pos = getSunPosition(lat, lng, date);
    // Sun should be roughly south at solar noon in winter
    expect(pos.azimuth).toBeGreaterThan(170);
    expect(pos.azimuth).toBeLessThan(185);
    expect(pos.altitude).toBeGreaterThan(25);
    expect(pos.altitude).toBeLessThan(35);
  });

  it("finds the pin building at Pacific Heights Towers", () => {
    const pin = detectPinBuilding(buildingData, { lat, lng });
    expect(pin).not.toBeNull();
  });

  it("finds candidate buildings to the south", () => {
    const pos = getSunPosition(lat, lng, date);
    const candidates = filterBuildingsBySunBearing(
      buildingData.features,
      { lat, lng },
      pos.azimuth
    );
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("should detect sun blockage at floor 1", () => {
    const result = analyzeSunVisibility({
      lat,
      lng,
      date,
      floor: 1,
      buildingData,
    });

    // Diagnostic output
    console.log("=== Pacific Heights Analysis ===");
    console.log(`Sun position: azimuth=${result.sunPosition.azimuth.toFixed(1)}°, altitude=${result.sunPosition.altitude.toFixed(1)}°`);
    console.log(`User elevation: ${result.userElevation}m (floor 1)`);
    console.log(`Pin building: ${result.pinBuilding ? `id=${result.pinBuilding.properties.id}, height=${result.pinBuilding.properties.height}m` : "none"}`);
    console.log(`Total buildings: ${result.totalBuildings}`);
    console.log(`Candidate buildings (in sun direction): ${result.candidateBuildings.length}`);
    console.log(`Blockage: ${JSON.stringify(result.blockage)}`);
    console.log(`Visibility: ${result.visibility}`);

    if (result.candidateBuildings.length > 0) {
      console.log("\nTop candidate buildings:");
      for (const b of result.candidateBuildings.slice(0, 5)) {
        console.log(`  id=${b.properties.id}, height=${b.properties.height}m, name=${b.properties.name ?? "unnamed"}`);
      }
    }

    // The sun should be blocked by nearby buildings to the south
    expect(result.blockage.isBlocked).toBe(true);
    expect(result.visibility).toBe("blocked");
  });
});
