import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { BuildingGeoJSON } from "@/lib/overpass";
import type { SunData } from "@/types/sun";
import { computeShadows } from "@/lib/shadows";

const SOURCE_ID = "shadows-source";
const LAYER_ID = "shadows-layer";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const THROTTLE_MS = 200;

export function useShadowLayer(
  mapRef: React.RefObject<maplibregl.Map | null>,
  buildingData: BuildingGeoJSON | null,
  sunData: SunData | null,
  enabled: boolean
) {
  const dataRef = useRef({ buildingData, sunData, enabled });
  // eslint-disable-next-line
  dataRef.current = { buildingData, sunData, enabled };

  const readyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push shadow data to the map
  const pushRef = useRef(() => {});
  // eslint-disable-next-line
  pushRef.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const { buildingData: bd, sunData: sd, enabled: en } = dataRef.current;

    let data: GeoJSON.FeatureCollection = EMPTY_FC;
    if (en && bd && sd && sd.position.altitude > 0) {
      data = computeShadows(bd, sd.position.azimuth, sd.position.altitude);
    }

    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    }

    if (map.getLayer(LAYER_ID)) {
      map.setLayoutProperty(LAYER_ID, "visibility", en ? "visible" : "none");
    }
  };

  // One-time setup
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setup = () => {
      if (map.getSource(SOURCE_ID)) {
        readyRef.current = true;
        pushRef.current();
        return;
      }

      map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY_FC });

      const beforeLayer = map.getLayer("buildings-3d-layer")
        ? "buildings-3d-layer"
        : undefined;
      map.addLayer(
        {
          id: LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            "fill-color": "#000000",
            "fill-opacity": 0.2,
          },
        },
        beforeLayer
      );

      readyRef.current = true;
      pushRef.current();
    };

    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.once("load", setup);
      return () => {
        map.off("load", setup);
      };
    }
  }, [mapRef]);

  // Throttled data updates
  useEffect(() => {
    if (timerRef.current) return; // already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pushRef.current();
    }, THROTTLE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [buildingData, sunData, enabled]);
}
