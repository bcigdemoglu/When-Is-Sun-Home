import { useEffect } from "react";
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

export function useShadowLayer(
  mapRef: React.RefObject<maplibregl.Map | null>,
  buildingData: BuildingGeoJSON | null,
  sunData: SunData | null,
  enabled: boolean
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setup = () => {
      if (!map.isStyleLoaded()) {
        map.once("styledata", setup);
        return;
      }

      let data: GeoJSON.FeatureCollection = EMPTY_FC;

      if (enabled && buildingData && sunData && sunData.position.altitude > 0) {
        data = computeShadows(
          buildingData,
          sunData.position.azimuth,
          sunData.position.altitude
        );
      }

      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource(SOURCE_ID, { type: "geojson", data });
      }

      if (!map.getLayer(LAYER_ID)) {
        // Add shadow layer below buildings layer
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
      }

      map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        enabled ? "visible" : "none"
      );
    };

    setup();
  }, [mapRef, buildingData, sunData, enabled]);
}
