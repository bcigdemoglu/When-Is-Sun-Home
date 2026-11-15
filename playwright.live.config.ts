import { defineConfig, devices } from "@playwright/test";

/**
 * Checks against a DEPLOYED site with real network data (no mocks, no local
 * server). Used after every production deployment:
 *
 *   LIVE_URL=https://when-is-sun-home.vercel.app pnpm test:live
 */
const baseURL = process.env.LIVE_URL ?? "https://when-is-sun-home.vercel.app";

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: true,
  retries: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  use: { baseURL, trace: "off", locale: "en-US" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
