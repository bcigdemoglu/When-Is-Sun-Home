/**
 * Public API of the terrain module: ground elevation around a place.
 *
 * Everything here except `loadTerrain` / `decodeTileInBrowser` (network,
 * canvas) and `useTerrain` (React) is pure.
 */
export {
  elevationAt,
  elevationGridFrom,
  gridContains,
  terrainElevationAt,
  type GridLayout,
} from "./elevation";
export {
  decodeTileInBrowser,
  loadTerrain,
  loadTerrainForCoverage,
  TerrainError,
  type DecodeTile,
  type LoadTerrainOptions,
} from "./loadTerrain";
export { buildMosaic, resampleMosaic, type TileMosaic } from "./resample";
export { computeTerrainSkyline, CURVATURE_DROP_PER_M2, type TerrainSkyline } from "./skyline";
export {
  decodeTerrarium,
  metersToTerrarium,
  terrariumToMeters,
  type DecodedTile,
} from "./terrarium";
export {
  latToTileY,
  lngToTileX,
  TERRAIN_MAX_LAT,
  TERRAIN_SCHEMA_VERSION,
  TERRARIUM_MAX_ZOOM,
  TERRARIUM_TILE_SIZE,
  TERRARIUM_URL_TEMPLATE,
  terrainCoverageFor,
  tileGroundWidthM,
  tilesOf,
  tileUrl,
  tileXToLng,
  tileYToLat,
  type TerrainCoverage,
  type TileBlock,
  type TileId,
} from "./tiles";
export {
  TERRAIN_GC_TIME_MS,
  terrainQueryKey,
  terrainQueryOptions,
  useTerrain,
  type TerrainStatus,
  type UseTerrainResult,
} from "./useTerrain";
