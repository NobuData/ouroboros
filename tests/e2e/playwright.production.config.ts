import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/**
 * The production leg (DJ.4, [#1317](https://github.com/NobuData/ouroboros/issues/1317)): the
 * unseeded e2e stack with `rest` in production mode and no run-simulator secret
 * (`docker-compose.e2e-production.yml`, brought up by `scripts/run.sh --production`). Its specs
 * live in their own directory so no other run collects them.
 */
export default defineConfig({
  ...base,
  testDir: "./specs-production",
  testMatch: "*.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  outputDir: "./test-results/production",
  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { outputFolder: "playwright-report/production", open: "never" }]]
      : [
          ["github"],
          ["list"],
          ["html", { outputFolder: "playwright-report/production", open: "never" }],
        ],
});
