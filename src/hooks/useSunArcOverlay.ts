import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Location, SunData, SunVisibility } from "@/types/sun";
import { getSunVisuals } from "@/types/sun";
import type { DayBlockageMap } from "@/lib/sunBlockage";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

// ─── Layer / source IDs ───────────────────────────────────────────────
const SRC = "sun-overlay-src";
const ARC_LAYER = "sun-arc-line";
const ARC_BLOCKED_LAYER = "sun-arc-blocked-line";
const BELOW_LAYER = "sun-below-line";
const SUNRISE_LAYER = "sun-rise-line";
const SUNSET_LAYER = "sun-set-line";
const SUN_DOT_LAYER = "sun-dot";
const SUN_CROSS_LAYER = "sun-cross";
const DIRECTION_LAYER = "direction-arrow";

// ─── Pure geometry computation ────────────────────────────────────────
interface OverlayInput {
  center: [number, number]; // [lng, lat]
  sunData: SunData;
  scale: number;
  visibility: SunVisibility;
  dayBlockageMap: DayBlockageMap | null;
  pinDirection?: number;
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

/** Split above-horizon arc points into contiguous segments by blocked status. */
function buildArcSegments(
  input: OverlayInput
): Feature[] {
  const { center, sunData, scale, dayBlockageMap } = input;
  const features: Feature[] = [];
  const abovePoints = sunData.arc.filter((p) => p.altitude > 0);

  if (abovePoints.length < 2) return features;

  // No blockage data — single orange arc (original behavior)
  if (!dayBlockageMap || dayBlockageMap.points.length === 0) {
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
    return features;
  }

  // Build a lookup: time (ms) → blocked
  const blockedSet = new Set<number>();
  for (const bp of dayBlockageMap.points) {
    if (bp.blocked) blockedSet.add(bp.time.getTime());
  }

  // Walk arc points, grouping into contiguous segments by blocked status
  interface Segment { blocked: boolean; coords: [number, number][] }
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const p of abovePoints) {
    const blocked = blockedSet.has(p.time.getTime());
    const coord = projectPoint(center, p.azimuth, p.altitude, scale);

    if (!current || current.blocked !== blocked) {
      // Overlap: duplicate the last coord of the previous segment as first of new
      // so the segments connect visually without gaps
      if (current && current.coords.length > 0) {
        const lastCoord: [number, number] = current.coords[current.coords.length - 1];
        current = { blocked, coords: [lastCoord, coord] };
      } else {
        current = { blocked, coords: [coord] };
      }
      segments.push(current);
    } else {
      current.coords.push(coord);
    }
  }

  for (const seg of segments) {
    if (seg.coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: { layer: seg.blocked ? "arc-blocked" : "arc" },
      geometry: { type: "LineString", coordinates: seg.coords } as LineString,
    });
  }

  return features;
}

function computeOverlayGeoJSON(input: OverlayInput): FeatureCollection {
  const { center, sunData, scale, visibility } = input;
  const visuals = getSunVisuals(visibility);
  const features: Feature[] = [];

  // ── 1. Above-horizon arc (split by blockage) ───────────────────────
  features.push(...buildArcSegments(input));

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

  // ── 6. Direction arrow ─────────────────────────────────────────────
  if (input.pinDirection !== undefined) {
    const arrowEnd = projectPoint(center, input.pinDirection, 60, scale);
    features.push({
      type: "Feature",
      properties: { layer: "direction" },
      geometry: {
        type: "LineString",
        coordinates: [center, arrowEnd],
      } as LineString,
    });
  }

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
    paint: { "line-color": "#f59e0b", "line-width": 3, "line-opacity": 0.8 },
  });

  // Sunset direction
  map.addLayer({
    id: SUNSET_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "sunset"],
    paint: { "line-color": "#ef4444", "line-width": 3, "line-opacity": 0.8 },
  });

  // Direction arrow (blue)
  map.addLayer({
    id: DIRECTION_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "direction"],
    paint: {
      "line-color": "#3b82f6",
      "line-width": 3,
      "line-opacity": 0.9,
    },
  });

  // Above-horizon arc (visible / orange)
  map.addLayer({
    id: ARC_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "arc"],
    paint: {
      "line-color": "#f59e0b",
      "line-width": 4,
      "line-opacity": 1,
    },
  });

  // Above-horizon arc (blocked / red)
  map.addLayer({
    id: ARC_BLOCKED_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "layer"], "arc-blocked"],
    paint: {
      "line-color": "#ef4444",
      "line-width": 12,
      "line-opacity": 1,
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

function getScale(zoom: number, map: maplibregl.Map): number {
  const base = 0.01 * Math.pow(2, 15 - zoom);
  // Shrink the arc on small viewports so it fits within the map area.
  // Convert the pixel size of the container to a geographic fraction:
  // at the current zoom, how many degrees does half the smallest viewport
  // dimension correspond to?  We want the arc radius (which equals `base`
  // at altitude=0) to be at most ~40% of that half-dimension.
  const container = map.getContainer();
  const minDim = Math.min(container.clientWidth, container.clientHeight);
  // degreesPerPixel approximation at current zoom & latitude
  const bounds = map.getBounds();
  const lngSpan = bounds.getEast() - bounds.getWest();
  const degreesPerPx = lngSpan / container.clientWidth;
  const maxRadius = (minDim / 2) * degreesPerPx * 0.8;
  return Math.min(base, maxRadius);
}

// ─── Hook ─────────────────────────────────────────────────────────────
export function useSunArcOverlay(
  mapRef: React.RefObject<maplibregl.Map | null>,
  location: Location | null,
  sunData: SunData | null,
  sunVisibility: SunVisibility,
  dayBlockageMap: DayBlockageMap | null,
  pinDirection?: number
) {
  // Latest props in refs — always current, never stale
  const dataRef = useRef({ location, sunData, sunVisibility, dayBlockageMap, pinDirection });
  // eslint-disable-next-line
  dataRef.current = { location, sunData, sunVisibility, dayBlockageMap, pinDirection };

  const readyRef = useRef(false);

  // Render helper reads from refs — safe to call from any callback
  const renderRef = useRef(() => {});
  // eslint-disable-next-line
  renderRef.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { location: loc, sunData: sd, sunVisibility: sv, dayBlockageMap: dbm, pinDirection: pd } = dataRef.current;
    if (!loc || !sd) {
      pushData(map, { type: "FeatureCollection", features: [] });
      return;
    }
    const fc = computeOverlayGeoJSON({
      center: [loc.lng, loc.lat],
      sunData: sd,
      scale: getScale(map.getZoom(), map),
      visibility: sv,
      dayBlockageMap: dbm,
      pinDirection: pd,
    });
    pushData(map, fc);
  };

  // One-time setup: wait for style, add layers, attach zoomend listener
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onReady = () => {
      setupLayers(map);
      readyRef.current = true;
      renderRef.current();
    };

    if (map.isStyleLoaded()) {
      onReady();
    } else {
      map.once("load", onReady);
    }

    const onZoom = () => renderRef.current();
    const onResize = () => renderRef.current();
    map.on("zoomend", onZoom);
    map.on("resize", onResize);

    return () => {
      map.off("zoomend", onZoom);
      map.off("resize", onResize);
      map.off("load", onReady);
    };
    // Only run once when mapRef is available
  }, [mapRef]);

  // Data updates — just re-render (no listener churn)
  useEffect(() => {
    renderRef.current();
  }, [location, sunData, sunVisibility, dayBlockageMap, pinDirection]);
}
