"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import type { Location, SunData, SunVisibility } from "@/types/sun";
import { useSunArcOverlay } from "@/hooks/useSunArcOverlay";
import { useBuildingLayer } from "@/hooks/useBuildingLayer";
import { useShadowLayer } from "@/hooks/useShadowLayer";
import type { BuildingGeoJSON } from "@/lib/overpass";

interface MapProps {
  location: Location | null;
  sunData: SunData | null;
  onLocationChange: (loc: Location) => void;
  buildingsEnabled: boolean;
  buildingData: BuildingGeoJSON | null;
  sunVisibility: SunVisibility;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export default function Map({
  location,
  sunData,
  onLocationChange,
  buildingsEnabled,
  buildingData,
  sunVisibility,
  zoom,
  onZoomChange,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const prevLocRef = useRef<Location | null>(null);
  // Track whether zoom change is programmatic (from prop) to avoid loops
  const zoomFromPropRef = useRef(false);

  const handleLocationChange = useCallback(
    (lat: number, lng: number) => {
      onLocationChange({ lat, lng });
    },
    [onLocationChange]
  );

  // Store latest onZoomChange in ref so the map event listener stays stable
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: location ? [location.lng, location.lat] : [-74.006, 40.7128],
      zoom,
      attributionControl: {},
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("click", (e) => {
      handleLocationChange(e.lngLat.lat, e.lngLat.lng);
    });

    // Sync zoom from map → React state
    map.on("zoomend", () => {
      if (!zoomFromPropRef.current) {
        onZoomChangeRef.current(Math.round(map.getZoom() * 10) / 10);
      }
      zoomFromPropRef.current = false;
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync zoom from React state → map (e.g. slider or restored from storage)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentZoom = Math.round(map.getZoom() * 10) / 10;
    if (Math.abs(currentZoom - zoom) > 0.05) {
      zoomFromPropRef.current = true;
      map.zoomTo(zoom, { duration: 300 });
    }
  }, [zoom]);

  // Update marker and fly to location
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;

    if (markerRef.current) {
      markerRef.current.setLngLat([location.lng, location.lat]);
    } else {
      const marker = new maplibregl.Marker({ draggable: true })
        .setLngLat([location.lng, location.lat])
        .addTo(map);

      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onLocationChange({ lat: lngLat.lat, lng: lngLat.lng });
      });

      markerRef.current = marker;
    }

    if (
      !prevLocRef.current ||
      prevLocRef.current.lat !== location.lat ||
      prevLocRef.current.lng !== location.lng
    ) {
      if (prevLocRef.current) {
        map.flyTo({ center: [location.lng, location.lat], duration: 1000 });
      }
      prevLocRef.current = location;
    }
  }, [location, onLocationChange]);

  // Hook up overlays
  useSunArcOverlay(mapRef, location, sunData, sunVisibility);
  useBuildingLayer(mapRef, buildingData, buildingsEnabled);
  useShadowLayer(mapRef, buildingData, sunData, buildingsEnabled);

  return <div ref={containerRef} className="h-full w-full" />;
}
