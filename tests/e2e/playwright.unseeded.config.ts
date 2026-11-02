import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/**
 * The unseeded leg (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)): the e2e
 * stack migrated **without** the development seed (`docker-compose.e2e-unseeded.yml`, brought up
 * by `scripts/run.sh --unseeded`). Its specs live in their own directory so the seeded run never
 * collects them, and they never run against the seeded stack.
 */
export default defineConfig({
  ...base,
  testDir: "./specs-unseeded",
  testMatch: "*.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  outputDir: "./test-results/unseeded",
  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { outputFolder: "playwright-report/unseeded", open: "never" }]]
      : [
          ["github"],
          ["list"],
          ["html", { outputFolder: "playwright-report/unseeded", open: "never" }],
        ],
});
