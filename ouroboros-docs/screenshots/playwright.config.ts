import { defineConfig } from "@playwright/test";

import { THEMES } from "./lib/manifest.ts";
import { AUTH_STATE_PATH, BASE_URL } from "./settings.ts";

/**
 * The capture harness (CZ.1, #1170): one Chromium project per theme, each taking every
 * selected manifest entry at 1440×900 and device scale 2 (roadmap decision D4).
 *
 * One worker, in order: every capture shares one signed-in session, and switching its
 * active workspace from two workers at once would race. Run through `yarn screenshots`,
 * never in CI — the captures need a seeded stack.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  use: {
    browserName: "chromium",
    baseURL: BASE_URL,
    storageState: AUTH_STATE_PATH,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
    // A capture that presses a copy button — the build farm's Copy command — must land as a
    // person sees it. Without the grant Chromium refuses the write, and the page shows its
    // blocked-copy refusal instead (and, for an enroll command, revokes the token it minted).
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: THEMES.map((theme) => ({ name: theme, use: { colorScheme: theme } })),
});
