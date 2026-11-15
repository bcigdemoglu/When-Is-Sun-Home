/**
 * Credit that must be shown wherever building data is displayed or used.
 *
 * OpenFreeMap requires attribution for its tiles (OpenMapTiles and
 * OpenStreetMap; naming OpenFreeMap itself is optional but asked for), and
 * the fallback sources are OpenStreetMap data as well.
 */
export const BUILDING_DATA_ATTRIBUTION = {
  /** Plain text, for places that cannot hold links. */
  text: "Buildings: OpenFreeMap © OpenMapTiles, data from OpenStreetMap",
  /** The same credit as separate links, in display order. */
  links: [
    { label: "OpenFreeMap", url: "https://openfreemap.org" },
    { label: "© OpenMapTiles", url: "https://www.openmaptiles.org/" },
    { label: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
  ],
} as const;
