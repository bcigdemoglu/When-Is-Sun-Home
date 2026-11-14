import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { computeHorizonProfile, horizonElevationAt } from "@/lib/horizon/profile";
import { buildingFromLocal, collectionOf, rect } from "@/lib/horizon/testing";
import { sunPositionAt } from "@/lib/solar/position";
import { SunState, type LatLng, type Observer } from "@/lib/types";

import { classifySun, isInViewCone, sunInstantAt } from "./classify";

const SF: LatLng = { lat: 37.7906, lng: -122.4294 };
const ZONE = "America/Los_Angeles";

const yard = (heightM = 0): Observer => ({ mode: "yard", heightM, facingDeg: 0, fovDeg: 360 });
const windowFacing = (facingDeg: number, fovDeg: number, heightM = 0): Observer => ({
  mode: "window",
  heightM,
  facingDeg,
  fovDeg,
});

/** A 30 m wall whose near face is 10 m due south: 71.6° high, spanning 180° ± 63°. */
const southWall = collectionOf([buildingFromLocal(SF, [[rect(-20, -12, 20, -10)]], 30)]);
const wallHorizon = computeHorizonProfile(SF, southWall, 0);
const openHorizon = computeHorizonProfile(SF, collectionOf([]), 0);

describe("isInViewCone", () => {
  test("a yard sees every direction, whatever facing / fov say", () => {
    const observer: Observer = { mode: "yard", heightM: 0, facingDeg: 90, fovDeg: 1 };
    for (const azimuth of [0, 45, 90, 180, 270, 359.9]) {
      expect(isInViewCone(azimuth, observer)).toBe(true);
    }
  });

  test("a window sees facing ± fov/2, edges included", () => {
    const south = windowFacing(180, 120);
    expect(isInViewCone(180, south)).toBe(true);
    expect(isInViewCone(120, south)).toBe(true);
    expect(isInViewCone(240, south)).toBe(true);
    expect(isInViewCone(119.9, south)).toBe(false);
    expect(isInViewCone(240.1, south)).toBe(false);
    expect(isInViewCone(0, south)).toBe(false);
  });

  test("a window cone wraps through north", () => {
    const north = windowFacing(350, 60);
    expect(isInViewCone(350, north)).toBe(true);
    expect(isInViewCone(320, north)).toBe(true);
    expect(isInViewCone(20, north)).toBe(true);
    expect(isInViewCone(0, north)).toBe(true);
    expect(isInViewCone(319, north)).toBe(false);
    expect(isInViewCone(21, north)).toBe(false);
    expect(isInViewCone(170, north)).toBe(false);
  });

  test("fov of 360 or more sees everything; un-normalised angles are fine", () => {
    for (const azimuth of [0, 90, 180, 270]) {
      expect(isInViewCone(azimuth, windowFacing(90, 360))).toBe(true);
      expect(isInViewCone(azimuth, windowFacing(90, 400))).toBe(true);
    }
    expect(isInViewCone(-170, windowFacing(540, 30))).toBe(true); // 190° vs 180°
    expect(isInViewCone(-150, windowFacing(540, 30))).toBe(false);
  });

  test("the cone is symmetric about the facing direction", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 1, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 180, noNaN: true }),
        (facing, fov, offset) => {
          const observer = windowFacing(facing, fov);
          fc.pre(Math.abs(offset - fov / 2) > 1e-6);
          expect(isInViewCone(facing + offset, observer)).toBe(offset < fov / 2 || fov >= 360);
          expect(isInViewCone(facing - offset, observer)).toBe(offset < fov / 2 || fov >= 360);
        },
      ),
    );
  });
});

describe("classifySun", () => {
  test("night when the sun is at or below the horizon, or the position is NaN", () => {
    expect(classifySun(180, 0, null, yard())).toBe(SunState.Night);
    expect(classifySun(180, -0.01, null, yard())).toBe(SunState.Night);
    expect(classifySun(180, -40, wallHorizon, yard())).toBe(SunState.Night);
    expect(classifySun(180, NaN, wallHorizon, yard())).toBe(SunState.Night);
    expect(classifySun(NaN, NaN, wallHorizon, yard())).toBe(SunState.Night);
  });

  test("night beats out-of-view and blocked", () => {
    expect(classifySun(0, -5, wallHorizon, windowFacing(180, 90))).toBe(SunState.Night);
  });

  test("out of view beats blocked", () => {
    // The sun is behind the wall AND outside a north-facing window's cone.
    expect(classifySun(180, 30, wallHorizon, windowFacing(0, 90))).toBe(SunState.OutOfView);
    // Same sun for a south-facing window: now it is the wall that hides it.
    expect(classifySun(180, 30, wallHorizon, windowFacing(180, 90))).toBe(SunState.Blocked);
  });

  test("blocked below the skyline, sun above it", () => {
    const skyline = horizonElevationAt(wallHorizon, 180);
    expect(skyline).toBeCloseTo(71.565, 2);
    expect(classifySun(180, skyline - 0.01, wallHorizon, yard())).toBe(SunState.Blocked);
    expect(classifySun(180, skyline + 0.01, wallHorizon, yard())).toBe(SunState.Sun);
    // Exactly on the skyline counts as sun.
    expect(classifySun(180, skyline, wallHorizon, yard())).toBe(SunState.Sun);
    // Directions the wall does not cover are clear down to the horizon.
    expect(classifySun(0, 0.1, wallHorizon, yard())).toBe(SunState.Sun);
    expect(classifySun(90, 5, wallHorizon, yard())).toBe(SunState.Sun);
  });

  test("no building data (null horizon): never blocked", () => {
    expect(classifySun(180, 1, null, yard())).toBe(SunState.Sun);
    expect(classifySun(180, 1, null, windowFacing(180, 90))).toBe(SunState.Sun);
    expect(classifySun(0, 1, null, windowFacing(180, 90))).toBe(SunState.OutOfView);
  });

  test("an empty horizon behaves like no horizon", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -360, max: 720, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (azimuth, altitude) => {
          expect(classifySun(azimuth, altitude, openHorizon, yard())).toBe(
            classifySun(azimuth, altitude, null, yard()),
          );
        },
      ),
    );
  });

  test("precedence holds for arbitrary inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 1, max: 360, noNaN: true }),
        fc.boolean(),
        (azimuth, altitude, facing, fov, isWindow) => {
          const observer = isWindow ? windowFacing(facing, fov) : yard();
          const state = classifySun(azimuth, altitude, wallHorizon, observer);
          if (altitude <= 0) expect(state).toBe(SunState.Night);
          else if (!isInViewCone(azimuth, observer)) expect(state).toBe(SunState.OutOfView);
          else if (altitude < horizonElevationAt(wallHorizon, azimuth))
            expect(state).toBe(SunState.Blocked);
          else expect(state).toBe(SunState.Sun);
        },
      ),
    );
  });
});

describe("sunInstantAt", () => {
  test("midday in June: sun in the south, reported with its position", () => {
    const instant = sunInstantAt(SF, "2026-06-21", 13 * 60 + 12, ZONE, null, yard());
    const expected = sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T20:12:00Z"));
    expect(instant.state).toBe(SunState.Sun);
    expect(instant.azimuthDeg).toBe(expected.azimuthDeg);
    expect(instant.altitudeDeg).toBe(expected.altitudeDeg);
    expect(instant.altitudeDeg).toBeGreaterThan(75);
    expect(Math.abs(instant.azimuthDeg - 180)).toBeLessThan(2);
    expect(instant.blocker).toBeUndefined();
  });

  test("uses the PLACE's wall clock, in winter and in summer time", () => {
    // 12:00 PST = 20:00 UTC; 12:00 PDT = 19:00 UTC.
    const winter = sunInstantAt(SF, "2026-01-15", 720, ZONE, null, yard());
    expect(winter.altitudeDeg).toBe(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-01-15T20:00:00Z")).altitudeDeg,
    );
    const summer = sunInstantAt(SF, "2026-07-15", 720, ZONE, null, yard());
    expect(summer.altitudeDeg).toBe(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-07-15T19:00:00Z")).altitudeDeg,
    );
  });

  test("night", () => {
    const instant = sunInstantAt(SF, "2026-06-21", 60, ZONE, wallHorizon, yard());
    expect(instant.state).toBe(SunState.Night);
    expect(instant.altitudeDeg).toBeLessThan(0);
    expect(instant.blocker).toBeUndefined();
  });

  test("blocked: names the obstruction", () => {
    // Midday in December the sun is only ≈ 29° up in the south, far below the 71.6° wall.
    const instant = sunInstantAt(SF, "2026-12-21", 12 * 60 + 8, ZONE, wallHorizon, yard());
    expect(instant.state).toBe(SunState.Blocked);
    expect(instant.altitudeDeg).toBeCloseTo(28.8, 0);
    expect(instant.blocker).toBeDefined();
    expect(instant.blocker!.buildingIndex).toBe(0);
    expect(instant.blocker!.distanceM).toBeCloseTo(10, 1);
    expect(instant.blocker!.elevationDeg).toBeCloseTo(71.565, 1);
    expect(instant.blocker!.elevationDeg).toBeGreaterThan(instant.altitudeDeg);

    // Without building data the same moment is sunny.
    expect(sunInstantAt(SF, "2026-12-21", 12 * 60 + 8, ZONE, null, yard()).state).toBe(SunState.Sun);
  });

  test("out of view for a window facing away", () => {
    const instant = sunInstantAt(SF, "2026-12-21", 12 * 60 + 8, ZONE, wallHorizon, windowFacing(0, 120));
    expect(instant.state).toBe(SunState.OutOfView);
    expect(instant.blocker).toBeUndefined();
  });

  test("a time inside the DST gap is read as the instant one hour later", () => {
    // 02:30 on 8 March 2026 does not exist in Los Angeles; clocks show 03:30.
    const inGap = sunInstantAt(SF, "2026-03-08", 150, ZONE, null, yard());
    const hourLater = sunInstantAt(SF, "2026-03-08", 210, ZONE, null, yard());
    expect(inGap).toEqual(hourLater);
    expect(inGap.altitudeDeg).toBe(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-03-08T10:30:00Z")).altitudeDeg,
    );
  });

  test("a gap that pushes past midnight rolls into the next day", () => {
    // Cairo skips 00:00–01:00 on 24 April 2026. Asking for 23:30 the day before
    // is fine; asking for 00:30 on the 24th means 01:30.
    const place = { lat: 30.0444, lng: 31.2357 };
    const inGap = sunInstantAt(place, "2026-04-24", 30, "Africa/Cairo", null, yard());
    const after = sunInstantAt(place, "2026-04-24", 90, "Africa/Cairo", null, yard());
    expect(inGap).toEqual(after);
    // A whole missing day (Samoa, 30 December 2011) resolves to the next real time.
    const samoa = { lat: -13.83, lng: -171.77 };
    const missing = sunInstantAt(samoa, "2011-12-30", 720, "Pacific/Apia", null, yard());
    const next = sunInstantAt(samoa, "2011-12-31", 720, "Pacific/Apia", null, yard());
    expect(missing).toEqual(next);
  });
});
