# Project Commands

Always use `pnpm` for all commands. Never use `npm`, `yarn`, or `npx`.

- **Dev server:** `pnpm dev`
- **Build:** `pnpm build`
- **All checks (lint + typecheck + unit tests):** `pnpm check`
- **Test:** `pnpm test`
- **Playwright tests:** `pnpm test:playwright`
- **Lint:** `pnpm lint`
- **Typecheck:** `pnpm typecheck`
- **Format:** `pnpm format`
- **Fetch test fixtures:** `pnpm fetch-fixture`

# Architecture notes

- `src/lib/types.ts` is the contract between layers; read it first.
- All dates and times are wall-clock values in the pinned place's time zone, never the browser's.
- The engine (`src/lib/solar`, `horizon`, `terrain`, `analysis`) is pure TypeScript: no React, DOM or network.
- Colours come from the design tokens in `src/app/globals.css`; do not use raw hex or palette utilities in components.
- Building data comes from OpenFreeMap vector tiles (Overpass is only a fallback and is blocked from most cloud hosts). Browser tests mock all map data with `tests/e2e/helpers/mockMapData.ts`.
- The map draws the buildings in view natively from the same tiles (a MapLibre `vector` source, `sun-city` in `SunMap.tsx`; MapLibre loads and drops tiles as the map moves). The analysed collection around the pin is only drawn for what is per building: the highlighted blocker and pin building, and the shadows. Rules shared by both live in `src/components/map/mapData.ts`; the tile address comes from `loadTileTemplate()` for both, so they read the same weekly build.
- The Satellite view draws USGS aerial photos under the shadows in place of the drawn buildings: two keyless raster sources (a cached base plus the slow, sharp detail), United States only, all rules in `src/components/map/imagery.ts`. The choice lives in the `mapUi` store and localStorage, never in the URL or the settings store. Do not use Esri / arcgisonline hosts (their terms need an account).
- Regional aerial photos (`REGIONAL_IMAGERY` in `imagery.ts`; so far the City of Portland's) are drawn over the two USGS layers in Satellite. Where a region's coverage table says everything in view is covered, the USGS detail is not requested. A new city is one registry entry plus its coverage table from `node scripts/imagery-coverage.mjs`. Both the USGS detail and the regional tiles go through our own loaders (`usgs-detail://`, `regional-photo://`): MapLibre never retries a tile, and one that failed stays blurry until the map moves.
- A listing link (Zillow, Redfin, Realtor.com, Trulia) pasted into the search is only READ: `src/lib/geocode/listingLink.ts` takes the address out of its text, `listingLookup.ts` geocodes it, and `listingMatch.ts` decides whether a result is clearly that house (then it opens without a tap; otherwise the list). Never request anything from a listing site, from the browser or the server.
- Git hooks: pre-commit runs `pnpm build`, pre-push runs `pnpm check`. Never bypass them with `--no-verify`; every push is deployed.
- `/dev/*` pages are development-only harnesses (404 in production).
