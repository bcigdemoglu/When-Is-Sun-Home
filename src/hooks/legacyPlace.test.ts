import { describe, expect, it } from "vitest";
import { parseLegacyPlace } from "./legacyPlace";

describe("parseLegacyPlace", () => {
  it("reads the old app's stored location", () => {
    const raw = JSON.stringify({
      location: { lat: 37.79, lng: -122.43, name: " 2550 Pacific Ave " },
      date: "2024-06-01",
      somethingElse: true,
    });
    expect(parseLegacyPlace(raw)).toEqual({ lat: 37.79, lng: -122.43, name: "2550 Pacific Ave" });
  });

  it("keeps a place without a usable name", () => {
    expect(parseLegacyPlace('{"location":{"lat":1,"lng":2}}')).toEqual({ lat: 1, lng: 2 });
    expect(parseLegacyPlace('{"location":{"lat":1,"lng":2,"name":"  "}}')).toEqual({
      lat: 1,
      lng: 2,
    });
    expect(parseLegacyPlace('{"location":{"lat":1,"lng":2,"name":7}}')).toEqual({ lat: 1, lng: 2 });
  });

  it("rejects anything that is not a real coordinate", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "not json",
      "null",
      "[]",
      '{"location":null}',
      '{"location":{"lat":"37","lng":-122}}',
      '{"location":{"lat":91,"lng":0}}',
      '{"location":{"lat":0,"lng":181}}',
      '{"location":{"lat":null,"lng":0}}',
      '{"lat":1,"lng":2}',
    ]) {
      expect(parseLegacyPlace(raw)).toBeNull();
    }
  });
});
