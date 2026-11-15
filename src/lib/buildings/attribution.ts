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
  /**
   * The three names linked, for the map's attribution control (which takes
   * HTML). Kept short: on a phone the control opens over the map until the
   * map is first touched, next to the basemap's own credit. The map shows it
   * at every zoom: the tiles are drawn from zoom 15 on, but the sun
   * computation uses them wherever a pin is.
   */
  html:
    'Buildings: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
} as const;
