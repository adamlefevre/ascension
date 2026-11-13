import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
const systemChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: "America/New_York",
    launchOptions: existsSync(systemChromium) ? { executablePath: systemChromium } : {},
  },
  webServer: {
    // A throwaway seeded database, so tests never touch real data.
    command: `rm -rf .data/e2e && npx tsx scripts/seed.ts && npx next build && npx next start -p ${PORT}`,
    env: { NEXT_DIST_DIR: ".next-e2e", PGLITE_DIR: ".data/e2e", DEFAULT_TIMEZONE: "America/New_York", AUTH_DISABLED: "true" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
