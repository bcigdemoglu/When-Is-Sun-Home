"use client";

import type { Marker as MapLibreMarker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import MapGL, {
  AttributionControl,
  Layer,
  Marker,
  Source,
  type ErrorEvent,
  type MapLayerMouseEvent,
  type MapRef,
  type MarkerDragEvent,
} from "react-map-gl/maplibre";
import { useIsDesktop, usePrefersDark, usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { settleAfterTwoFrames, type Settle } from "@/hooks/pacer";
import { usePacedValue } from "@/hooks/usePacedValue";
import { computeShadowPolygons } from "@/lib/analysis";
import type { BuildingCollection, LatLng, Place, SunInstant } from "@/lib/types";
import { selectLayers, selectObserver, useSettings } from "@/state";
import type { SunPathModel } from "./compassGeometry";
import { EMPTY_BUILDINGS, SHADOW_RADIUS_M, buildingsNear } from "./mapData";
import { useMapUi } from "./mapUi";
import {
  PLACE_PITCH,
  PLACE_ZOOM,
  cameraMoveFor,
  createClickGate,
  offsetByMeters,
  wrapLng,
} from "./pinMove";
import { SunCompass } from "./SunCompass";
import { useMapTheme } from "./useMapTheme";

const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** The whole world, for when no place has been chosen yet. */
const WORLD_VIEW = { longitude: 10, latitude: 28, zoom: 1.3, pitch: 0, bearing: 0 };

/**
 * The sun as the WebGL layers see it (shadows, the highlighted blocker). It
 * follows the real thing at up to ~30 updates a second, but never faster than
 * the map can draw: see `settleMap` below.
 */
const GL_SUN_PACING = { minIntervalMs: 33, loadFactor: 4, allowanceMs: 45 };
/** Give up waiting for the map to finish a redraw after this long, ms. */
const MAP_SETTLE_TIMEOUT_MS = 800;
/** Paint changes apply at once; a 300 ms cross-fade would only blur fast scrubbing. */
const NO_TRANSITION = { duration: 0, delay: 0 };
/** A WebGL context that stays lost this long is treated as gone. */
const CONTEXT_LOSS_GRACE_MS = 4000;

const EMPTY_SHADOWS = { type: "FeatureCollection" as const, features: [] };
const MAP_STYLE = { width: "100%", height: "100%" };
const COMPASS_MARKER_STYLE = { pointerEvents: "none" as const };

export interface SunMapProps {
  place: Place | null;
  /** Buildings to draw (may be a neighbouring area's while the real ones load). */
  buildings: BuildingCollection | null;
  /** Today's sun path for the compass. */
  sunPath: SunPathModel | null;
  instant: SunInstant | null;
  /** `properties.id` of the building hiding the sun right now, if any. */
  blockerBuildingId: string | null;
  /** `properties.id` of the building the pin sits in, if any. */
  pinBuildingId: string | null;
  /** The user picked a spot on the map (click, drag or keyboard nudge). */
  onPlacePin(spot: LatLng): void;
  /** The map cannot be shown at all (no WebGL, context lost for good). */
  onFatalError(error: unknown): void;
}

/** Strip the "Map marker" button semantics MapLibre gives every marker wrapper. */
function makePresentational(element: HTMLElement | undefined) {
  if (!element) return;
  element.removeAttribute("aria-label");
  element.setAttribute("role", "presentation");
}

export default function SunMap({
  place,
  buildings,
  sunPath,
  instant,
  blockerBuildingId,
  pinBuildingId,
  onPlacePin,
  onFatalError,
}: SunMapProps) {
  const observer = useSettings(selectObserver);
  const layers = useSettings(selectLayers);
  const isDark = usePrefersDark();
  const isDesktop = useIsDesktop();
  const reducedMotion = usePrefersReducedMotion();
  const theme = useMapTheme(isDark);

  const mapRef = useRef<MapRef>(null);
  const pinMarkerRef = useRef<MapLibreMarker>(null);
  const compassMarkerRef = useRef<MapLibreMarker>(null);

  const lat = place ? place.lat : null;
  const lng = place ? place.lng : null;
  const hasPlace = lat !== null && lng !== null;

  // Only the view the map OPENS with comes from React; after that the camera
  // belongs to MapLibre (uncontrolled), so panning never re-renders anything.
  const [initialViewState] = useState(() => {
    const { insets, wantsTilt } = useMapUi.getState();
    const padding = { top: insets.top, bottom: insets.bottom, left: 0, right: 0 };
    return hasPlace
      ? {
          longitude: lng,
          latitude: lat,
          zoom: PLACE_ZOOM,
          pitch: wantsTilt ? PLACE_PITCH : 0,
          bearing: 0,
          padding,
        }
      : { ...WORLD_VIEW, padding };
  });
  const [ready, setReady] = useState(false);
  // What floats over the map (search pill, sheet, time bar): the camera keeps
  // the pin centred in what is left.
  const insets = useMapUi((state) => state.insets);
  const commandSeq = useMapUi((state) => state.commandSeq);
  /** Id of the basemap's first label layer: our layers go right below it. */
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>(undefined);
  /** Where the pin is while it is being dragged. */
  const [dragSpot, setDragSpot] = useState<LatLng | null>(null);

  /** The place the camera has already been pointed at. */
  const handledPlace = useRef<LatLng | null>(hasPlace ? { lat, lng } : null);
  /** The last spot picked on the map itself: no need to fly there. */
  const placedOnMap = useRef<LatLng | null>(null);
  const lastDragEndAt = useRef(0);
  const [clickGate] = useState(() => createClickGate());
  useEffect(() => () => clickGate.cancel(), [clickGate]);

  // ── Camera: follow the place, unless the user put it there by hand ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const next = lat === null || lng === null ? null : { lat, lng };
    let inView = false;
    if (next) {
      const point = map.project([next.lng, next.lat]);
      const { clientWidth, clientHeight } = map.getContainer();
      const margin = Math.min(48, clientWidth / 6, clientHeight / 6);
      const covered = useMapUi.getState().insets;
      inView =
        point.x >= margin &&
        point.x <= clientWidth - margin &&
        point.y >= covered.top + margin &&
        point.y <= clientHeight - covered.bottom - margin;
    }
    const move = cameraMoveFor({
      next,
      handled: handledPlace.current,
      placedOnMap: placedOnMap.current,
      zoom: map.getZoom(),
      inView,
      reducedMotion,
    });
    handledPlace.current = next;
    if (!next || move.type === "none") return;

    const center: [number, number] = [next.lng, next.lat];
    const pitch = useMapUi.getState().wantsTilt ? PLACE_PITCH : 0;
    if (move.type === "ease") {
      map.easeTo({ center, duration: 500, essential: true });
    } else if (move.type === "jump") {
      map.jumpTo({ center, zoom: move.zoom, pitch });
    } else {
      map.flyTo({ center, zoom: move.zoom, pitch, duration: 1800, essential: true });
    }
  }, [ready, lat, lng, reducedMotion]);

  // ── Camera: keep clear of what covers the map ───────────────────────────
  const insetTop = insets.top;
  const insetBottom = insets.bottom;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const padding = { top: insetTop, bottom: insetBottom, left: 0, right: 0 };
    const current = map.getPadding();
    if (current.top === padding.top && current.bottom === padding.bottom) return;
    if (reducedMotion) map.jumpTo({ padding });
    else map.easeTo({ padding, duration: 250, essential: true });
  }, [ready, insetTop, insetBottom, reducedMotion]);

  // ── Commands from the buttons around the map ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const { command } = useMapUi.getState();
    if (!ready || !map || !command) return;
    const animate = !reducedMotion;
    switch (command.type) {
      case "zoom":
        map.easeTo({ zoom: map.getZoom() + command.delta, duration: animate ? 250 : 0 });
        break;
      case "north":
        map.easeTo({ bearing: 0, duration: animate ? 400 : 0 });
        break;
      case "tilt": {
        const pitch = command.tilted ? PLACE_PITCH : 0;
        map.easeTo({ pitch, duration: animate ? 500 : 0 });
        break;
      }
      case "recenter": {
        const spot = useSettings.getState().place;
        if (!spot) break;
        const options = {
          center: [spot.lng, spot.lat] as [number, number],
          zoom: Math.max(map.getZoom(), PLACE_ZOOM - 1),
        };
        if (animate) map.flyTo({ ...options, duration: 900, essential: true });
        else map.jumpTo(options);
        break;
      }
    }
    // Runs once per command: `commandSeq` changes with each one.
  }, [ready, commandSeq, reducedMotion]);

  useEffect(() => () => useMapUi.getState().report({ ready: false }), []);

  // ── Markers: accessible names ───────────────────────────────────────────
  useEffect(() => {
    if (!ready || !hasPlace) return;
    makePresentational(pinMarkerRef.current?.getElement());
    const compass = compassMarkerRef.current?.getElement();
    makePresentational(compass);
    compass?.setAttribute("aria-hidden", "true");
  }, [ready, hasPlace]);

  // ── Data for the layers ─────────────────────────────────────────────────
  const buildingData = buildings ?? EMPTY_BUILDINGS;

  const nearby = useMemo(
    () =>
      buildings && lat !== null && lng !== null
        ? buildingsNear(buildings, { lat, lng }, SHADOW_RADIUS_M)
        : null,
    [buildings, lat, lng],
  );

  // The sun moves on every tick of a drag or of the animation. The compass (plain
  // SVG) follows every tick; what needs a WebGL redraw is paced to the map.
  const sunAzimuthNow = instant ? instant.azimuthDeg : NaN;
  const sunAltitudeNow = instant ? instant.altitudeDeg : NaN;
  const glSunNow = useMemo(
    () => ({
      azimuthDeg: sunAzimuthNow,
      altitudeDeg: sunAltitudeNow,
      blockerBuildingId,
    }),
    [sunAzimuthNow, sunAltitudeNow, blockerBuildingId],
  );
  /**
   * "The map has drawn the last update": the pacer waits for this before it
   * sends the next one, so updates can never pile up — however slow the GPU
   * (software rendering, old phones) and however fast the slider moves.
   */
  const settleMap: Settle = (done) => {
    const map = mapRef.current?.getMap();
    // Nothing changed on the map, or the camera is moving and it redraws every
    // frame anyway: two frames tell how long a frame takes.
    if (!map || map.isMoving() || map.loaded()) return settleAfterTwoFrames(done);

    // Otherwise it is re-tiling in its worker and will then redraw: wait for
    // that, plus one frame for the result to reach the screen.
    let finished = false;
    let frame = 0;
    const finish = () => {
      if (finished) return;
      stop();
      done();
    };
    const onIdle = () => {
      frame = requestAnimationFrame(finish);
    };
    const timeout = setTimeout(finish, MAP_SETTLE_TIMEOUT_MS);
    const stop = () => {
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      map.off("idle", onIdle);
    };
    map.once("idle", onIdle);
    return stop;
  };
  const glSun = usePacedValue(glSunNow, { ...GL_SUN_PACING, settle: settleMap });

  const sunAzimuth = glSun.azimuthDeg;
  const sunAltitude = glSun.altitudeDeg;
  const shownBlockerId = glSun.blockerBuildingId;
  const showShadows = layers.shadows;
  const shadowData = useMemo(() => {
    if (!showShadows || !nearby || lat === null || lng === null || !(sunAltitude > 0)) {
      return EMPTY_SHADOWS;
    }
    return computeShadowPolygons({ lat, lng }, nearby, sunAzimuth, sunAltitude, {
      maxLengthM: SHADOW_RADIUS_M,
    });
  }, [showShadows, nearby, lat, lng, sunAzimuth, sunAltitude]);

  const buildingColor = useMemo(
    () => [
      "case",
      ["==", ["get", "id"], shownBlockerId ?? ""],
      theme.blocked,
      ["==", ["get", "id"], pinBuildingId ?? ""],
      theme.pinBuilding,
      ["==", ["get", "heightSource"], "default"],
      theme.buildingSoft,
      theme.building,
    ],
    [shownBlockerId, pinBuildingId, theme],
  );
  const extruded = layers.buildings3d;

  // ── Interaction ─────────────────────────────────────────────────────────
  const placePin = (spot: LatLng) => {
    const clean = { lat: Math.max(-90, Math.min(90, spot.lat)), lng: wrapLng(spot.lng) };
    placedOnMap.current = clean;
    onPlacePin(clean);
  };

  const onClick = (event: MapLayerMouseEvent) => {
    const original = event.originalEvent;
    const target = original.target;
    // Clicks on the pin, and the click the browser sends after dragging it.
    if (target instanceof Element && target.closest(".maplibregl-marker")) return;
    if (performance.now() - lastDragEndAt.current < 350) return;
    const spot = { lat: event.lngLat.lat, lng: event.lngLat.lng };
    clickGate.click(
      { x: event.point.x, y: event.point.y, timeMs: original.timeStamp, detail: original.detail },
      () => placePin(spot),
    );
  };

  const onDrag = (event: MarkerDragEvent) =>
    setDragSpot({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  const onDragEnd = (event: MarkerDragEvent) => {
    lastDragEndAt.current = performance.now();
    setDragSpot(null);
    placePin({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  };

  const onPinKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (lat === null || lng === null) return;
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation(); // the map would pan on arrow keys
    placePin(offsetByMeters({ lat, lng }, delta[0], delta[1]));
  };

  const onError = (event: ErrorEvent) => {
    // No map instance: MapLibre could not start at all (typically no WebGL).
    // Anything later (a tile that failed to load, …) is not worth a crash.
    if (!(event as { target?: unknown }).target) onFatalError(event.error);
  };

  const pin = dragSpot ?? (hasPlace ? { lat, lng } : null);
  const flatVisibility = extruded ? "none" : "visible";
  const extrudedVisibility = extruded ? "visible" : "none";

  return (
    <div className="relative h-full w-full">
      <MapGL
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        style={MAP_STYLE}
        attributionControl={false}
        maxPitch={70}
        onClick={onClick}
        onDblClick={clickGate.cancel}
        onPitchEnd={(event) => useMapUi.getState().report({ tilted: event.viewState.pitch > 5 })}
        onRotateEnd={(event) =>
          useMapUi.getState().report({ bearing: Math.round(event.viewState.bearing) })
        }
        onStyleData={(event) => {
          const map = event.target;
          setLabelLayerId(map.getLayersOrder().find((id) => map.getLayer(id)?.type === "symbol"));
        }}
        onLoad={(event) => {
          setReady(true);
          const map = event.target;
          useMapUi.getState().report({
            ready: true,
            tilted: map.getPitch() > 5,
            bearing: Math.round(map.getBearing()),
          });
          let lostTimer: ReturnType<typeof setTimeout> | undefined;
          map.on("webglcontextlost", () => {
            clearTimeout(lostTimer);
            lostTimer = setTimeout(
              () => onFatalError(new Error("WebGL context lost")),
              CONTEXT_LOSS_GRACE_MS,
            );
          });
          map.on("webglcontextrestored", () => clearTimeout(lostTimer));
          map.on("remove", () => clearTimeout(lostTimer));
        }}
        onError={onError}
      >
        {/* Phones: a compact "i" just above the sheet. Desktop: spelled out, top right. */}
        <AttributionControl
          position={isDesktop ? "top-right" : "bottom-left"}
          compact={!isDesktop}
        />

        {/*
          Both sources are cut into few, large tiles (zoom 14 / 15: 25 / 12 cm
          precision, plenty at street level) rather than the default zoom-18
          tiles. An update then re-tiles and redraws once or twice, not once
          per visible tile.
        */}
        <Source id="sun-shadows" type="geojson" data={shadowData} maxzoom={14} tolerance={0}>
          {/*
            An extrusion 5 cm tall rather than a flat fill: extrusion layers are
            composited as a group, so overlapping shadow pieces do not add up to
            darker patches.
          */}
          <Layer
            id="sun-shadows"
            type="fill-extrusion"
            beforeId={labelLayerId}
            paint={{
              "fill-extrusion-color": theme.shadow,
              "fill-extrusion-height": 0.05,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": theme.shadowOpacity,
              "fill-extrusion-vertical-gradient": false,
            }}
          />
        </Source>

        <Source id="sun-buildings" type="geojson" data={buildingData} maxzoom={15} tolerance={0}>
          <Layer
            id="sun-buildings-flat"
            type="fill"
            beforeId={labelLayerId}
            layout={{ visibility: flatVisibility }}
            paint={{
              "fill-color": buildingColor as never,
              "fill-color-transition": NO_TRANSITION,
              "fill-opacity": 0.75,
            }}
          />
          <Layer
            id="sun-buildings-outline"
            type="line"
            beforeId={labelLayerId}
            layout={{ visibility: flatVisibility }}
            paint={{ "line-color": theme.line, "line-width": 1 }}
          />
          <Layer
            id="sun-buildings-3d"
            type="fill-extrusion"
            beforeId={labelLayerId}
            layout={{ visibility: extrudedVisibility }}
            paint={{
              "fill-extrusion-color": buildingColor as never,
              "fill-extrusion-color-transition": NO_TRANSITION,
              "fill-extrusion-height": ["get", "heightM"],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.8,
            }}
          />
          <Layer
            id="sun-pin-building"
            type="line"
            beforeId={labelLayerId}
            filter={["==", ["get", "id"], pinBuildingId ?? ""]}
            paint={{ "line-color": theme.accent, "line-width": 2.5 }}
          />
        </Source>

        {pin && (
          <Marker
            ref={compassMarkerRef}
            longitude={pin.lng}
            latitude={pin.lat}
            anchor="center"
            pitchAlignment="map"
            rotationAlignment="map"
            className="sun-compass-marker"
            style={COMPASS_MARKER_STYLE}
          >
            <SunCompass
              path={sunPath}
              instant={instant}
              observer={observer}
              dimmed={dragSpot !== null}
            />
          </Marker>
        )}
        {pin && (
          <Marker
            ref={pinMarkerRef}
            longitude={pin.lng}
            latitude={pin.lat}
            anchor="bottom"
            draggable
            onDragStart={onDrag}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            onClick={(event) => event.originalEvent.stopPropagation()}
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="Pin. Drag it, or use the arrow keys, to move the spot being analysed."
              className="flex h-12 w-11 cursor-grab touch-none items-end justify-center rounded-xl active:cursor-grabbing"
              onKeyDown={onPinKeyDown}
            >
              <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
                <ellipse cx="17" cy="41.5" rx="6" ry="2" fill="var(--ink)" opacity="0.25" />
                <path
                  d="M17 41C17 41 31 26 31 15.5a14 14 0 1 0-28 0C3 26 17 41 17 41Z"
                  fill="var(--ink)"
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
                <circle cx="17" cy="15.5" r="5.5" fill="var(--accent-fill)" />
              </svg>
            </div>
          </Marker>
        )}
      </MapGL>
    </div>
  );
}
