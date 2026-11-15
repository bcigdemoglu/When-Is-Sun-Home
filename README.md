# When Is Sun Home?

How many hours of direct sunlight does this exact spot get — today, and on every day of the year?

Drop a pin on a backyard (or pick a window, floor and facing direction) and the app works out when the
sun actually reaches it, taking the surrounding buildings and hills into account. Built for comparing
houses: every view is a shareable link.

## How it works

1. **Sun position** — an in-house Meeus/NOAA solar model, validated against JPL Horizons (< 0.01°),
   evaluated on a 5-minute grid for the whole year in the place's own time zone.
2. **Surroundings** — building footprints and heights from OpenStreetMap (Overpass API) and ground
   elevation from Terrarium DEM tiles.
3. **Skyline** — from the pin, the highest obstruction in each of 720 compass directions is computed
   once. After that, "is the sun visible right now?" is a table lookup, so a full-year analysis takes
   a few milliseconds and every control stays responsive.

Results are clear-sky geometry: clouds, trees and fences are not modelled, and building heights are
estimates where OpenStreetMap has no measurement.

## Project layout

| Path                                              | What lives there                                    |
| ------------------------------------------------- | --------------------------------------------------- |
| `src/lib/types.ts`                                | Domain contracts shared by every layer              |
| `src/lib/solar`, `horizon`, `terrain`, `analysis` | The pure computation engine                         |
| `src/lib/buildings`, `geocode`                    | Data fetching, caching and address search           |
| `src/state`                                       | Settings store, persistence and share-link encoding |
| `src/hooks`                                       | Glue between state, data and engine                 |
| `src/components`                                  | Map, controls and the sun report                    |
| `tests/e2e`                                       | Playwright browser tests                            |

## Commands

Always use `pnpm`.

```bash
pnpm dev              # development server on :3000
pnpm check            # lint + typecheck + unit tests
pnpm test             # unit tests (vitest)
pnpm test:playwright  # browser tests
pnpm build            # production build
pnpm format           # prettier
pnpm fetch-fixture    # refresh the Overpass test fixture (needs network access to Overpass)
```

`/dev/report` renders the sun report from the bundled fixture for design work.
