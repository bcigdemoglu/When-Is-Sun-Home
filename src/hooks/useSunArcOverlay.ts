import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Location, SunData, SunVisibility } from "@/types/sun";
import { getSunVisuals } from "@/types/sun";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

// ─── Layer / source IDs ───────────────────────────────────────────────
const SRC = "sun-overlay-src";
const ARC_LAYER = "sun-arc-line";
const BELOW_LAYER = "sun-below-line";
const SUNRISE_LAYER = "sun-rise-line";
const SUNSET_LAYER = "sun-set-line";
const SUN_DOT_LAYER = "sun-dot";
const SUN_CROSS_LAYER = "sun-cross";

// ─── State machine ────────────────────────────────────────────────────
type Phase = "idle" | "waiting" | "ready";

// ─── Pure geometry computation ────────────────────────────────────────
interface OverlayInput {
  center: [number, number]; // [lng, lat]
  sunData: SunData;
  scale: number;
  visibility: SunVisibility;
}

function projectPoint(
  center: [number, number],
  azimuthDeg: number,
  altitudeDeg: number,
  scale: number
): [number, number] {
  const distance = Math.max(0, (90 - altitudeDeg) / 90) * scale;
  const rad = (azimuthDeg * Math.PI) / 180;
  const lat = center[1] + distance * Math.cos(rad);
  const lng =
    center[0] +
    (distance * Math.sin(rad)) / Math.cos((center[1] * Math.PI) / 180);
  return [lng, lat];
}

function computeOverlayGeoJSON(input: OverlayInput): FeatureCollection {
  const { center, sunData, scale, visibility } = input;
  const visuals = getSunVisuals(visibility);
  const features: Feature[] = [];

  // ── 1. Above-horizon arc ──────────────────────────────────────────
  const abovePoints = sunData.arc.filter((p) => p.altitude > 0);
  if (abovePoints.length > 1) {
    features.push({
      type: "Feature",
      properties: { layer: "arc" },
      geometry: {
        type: "LineString",
        coordinates: abovePoints.map((p) =>
          projectPoint(center, p.azimuth, p.altitude, scale)
        ),
      } as LineString,
    });
  }

  // ── 2. Below-horizon arc ──────────────────────────────────────────
  const belowPoints = sunData.arc.filter(
    (p) => p.altitude <= 0 && p.altitude > -10
  );
  if (belowPoints.length > 1) {
    features.push({
      type: "Feature",
      properties: { layer: "below" },
      geometry: {
        type: "LineString",
        coordinates: belowPoints.map((p) =>
          projectPoint(center, p.azimuth, p.altitude, scale)
        ),
      } as LineString,
    });
  }

  // ── 3. Sunrise direction line ─────────────────────────────────────
  const sunrisePoint = sunData.arc.find((p) => p.altitude >= 0);
  if (sunrisePoint) {
    features.push({
      type: "Feature",
      properties: { layer: "sunrise" },
      geometry: {
        type: "LineString",
        coordinates: [
          center,
          projectPoint(center, sunrisePoint.azimuth, 0, scale),
        ],
      } as LineString,
    });
  }

  // ── 4. Sunset direction line ──────────────────────────────────────
  const sunsetPoint = [...sunData.arc].reverse().find((p) => p.altitude >= 0);
  if (sunsetPoint) {
    features.push({
      type: "Feature",
      properties: { layer: "sunset" },
      geometry: {
        type: "LineString",
        coordinates: [
          center,
          projectPoint(center, sunsetPoint.azimuth, 0, scale),
        ],
      } as LineString,
    });
  }

  // ── 5. Sun dot — same projection, same center, same scale ────────
  const { azimuth, altitude } = sunData.position;
  const sunCoord = projectPoint(center, azimuth, altitude, scale);

  features.push({
    type: "Feature",
    properties: {
      layer: "sun",
      visibility,
      dotColor: visuals.dotColor,
      strokeColor: visuals.strokeColor,
      opacity: visuals.opacity,
      showCross: visuals.showCross ? 1 : 0,
    },
    geometry: { type: "Point", coordinates: sunCoord } as Point,
  });

  return { type: "FeatureCollection", features };
}

// ─── Map layer setup (called once when entering "ready" phase) ───────
function setupLayers(map: maplibregl.Map) {
  if (map.getSource(SRC)) return;

  map.addSource(SRC, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Below-horizon arc (behind everything)
  map.addLayer({
    id: BELOW_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "below"],
    paint: {
      "line-color": "#6b7280",
      "line-width": 1.5,
      "line-opacity": 0.3,
      "line-dasharray": [3, 6],
    },
  });

  // Sunrise direction
  map.addLayer({
    id: SUNRISE_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "sunrise"],
    paint: { "line-color": "#f59e0b", "line-width": 2, "line-opacity": 0.5 },
  });

  // Sunset direction
  map.addLayer({
    id: SUNSET_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "sunset"],
    paint: { "line-color": "#ef4444", "line-width": 2, "line-opacity": 0.5 },
  });

  // Above-horizon arc
  map.addLayer({
    id: ARC_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "arc"],
    paint: {
      "line-color": "#f59e0b",
      "line-width": 3,
      "line-opacity": 0.7,
      "line-dasharray": [6, 4],
    },
  });

  // Sun dot — colors driven by feature properties
  map.addLayer({
    id: SUN_DOT_LAYER,
    type: "circle",
    source: SRC,
    filter: ["==", ["get", "layer"], "sun"],
    paint: {
      "circle-radius": 10,
      "circle-color": ["get", "dotColor"],
      "circle-opacity": ["get", "opacity"],
      "circle-stroke-width": 2,
      "circle-stroke-color": ["get", "strokeColor"],
    },
  });

  // Cross overlay on sun dot when blocked
  map.addLayer({
    id: SUN_CROSS_LAYER,
    type: "symbol",
    source: SRC,
    filter: [
      "all",
      ["==", ["get", "layer"], "sun"],
      ["==", ["get", "showCross"], 1],
    ],
    layout: {
      "text-field": "✕",
      "text-size": 14,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
}

// ─── Push data to map ────────────────────────────────────────────────
function pushData(map: maplibregl.Map, fc: FeatureCollection) {
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(fc);
}

function getScale(zoom: number): number {
  return 0.01 * Math.pow(2, 15 - zoom);
}

// ─── Hook ─────────────────────────────────────────────────────────────
export function useSunArcOverlay(
  mapRef: React.RefObject<maplibregl.Map | null>,
  location: Location | null,
  sunData: SunData | null,
  sunVisibility: SunVisibility
) {
  // Latest props in refs — read at render time, never stale
  const dataRef = useRef({ location, sunData, sunVisibility });
  dataRef.current = { location, sunData, sunVisibility };

  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      phaseRef.current = "idle";
      return;
    }

    // Render using latest data from refs (not closure)
    const render = () => {
      const { location: loc, sunData: sd, sunVisibility: sv } = dataRef.current;
      if (!loc || !sd) {
        pushData(map, { type: "FeatureCollection", features: [] });
        return;
      }
      const fc = computeOverlayGeoJSON({
        center: [loc.lng, loc.lat],
        sunData: sd,
        scale: getScale(map.getZoom()),
        visibility: sv,
      });
      pushData(map, fc);
    };

    // State transitions
    const enterReady = () => {
      phaseRef.current = "ready";
      setupLayers(map);
      render();
    };

    if (phaseRef.current === "idle" || phaseRef.current === "waiting") {
      if (map.isStyleLoaded()) {
        enterReady();
      } else {
        phaseRef.current = "waiting";
        map.once("load", enterReady);
        return () => {
          map.off("load", enterReady);
        };
      }
    }

    // Already ready — just push new data
    if (phaseRef.current === "ready") {
      render();
    }

    // Re-render on zoom (scale changes)
    const onZoom = () => {
      if (phaseRef.current === "ready") render();
    };
    map.on("zoomend", onZoom);

    return () => {
      map.off("zoomend", onZoom);
    };
  }, [mapRef, location, sunData, sunVisibility]);
}
