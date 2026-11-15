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
- Git hooks: pre-commit runs `pnpm build`, pre-push runs `pnpm check`. Never bypass them with `--no-verify`; every push is deployed.
- `/dev/*` pages are development-only harnesses (404 in production).
