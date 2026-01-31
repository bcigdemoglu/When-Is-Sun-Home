import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import type { BuildingGeoJSON } from "@/lib/overpass";

const SOURCE_ID = "buildings-source";
const LAYER_ID = "buildings-3d-layer";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function useBuildingLayer(
  mapRef: React.RefObject<maplibregl.Map | null>,
  buildingData: BuildingGeoJSON | null,
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

      const data = enabled && buildingData ? buildingData : EMPTY_FC;

      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource(SOURCE_ID, { type: "geojson", data });
      }

      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: "fill-extrusion",
          source: SOURCE_ID,
          paint: {
            "fill-extrusion-color": [
              "case",
              ["==", ["get", "heightSource"], "measured"],
              "#6366f1", // indigo for measured
              ["==", ["get", "heightSource"], "estimated"],
              "#a5b4fc", // lighter indigo for estimated
              "#d1d5db", // gray for unknown
            ],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.6,
          },
        });
      }

      // Toggle visibility
      map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        enabled ? "visible" : "none"
      );
    };

    setup();
  }, [mapRef, buildingData, enabled]);
}
