import { defineConfig } from "@playwright/test";

import base from "./playwright.config";
import { FARM_BUDGET_MS } from "./support/stack";

/**
 * The farm leg — leg 16, `specs/farm.spec.ts` — run separately from the smoke suite, against
 * the same stack ([#2020](https://github.com/NobuData/ouroboros/issues/2020)). Everything not
 * stated below is [`playwright.config.ts`](playwright.config.ts)'s and is spread in, as
 * [`playwright.readability.config.ts`](playwright.readability.config.ts) does, so the two runs
 * cannot drift on what they share: one browser, no retries, the pixel tolerance, the
 * `__screenshots__` directory.
 *
 * ### Why it has a budget of its own
 *
 * Inside the smoke suite this leg ran late, and its build test — submit → dispatch → live
 * log → terminal state → stats, the only proof that a real runner builds a real checkout —
 * ran later still. Every failing `expect` ahead of it waits out its fifteen seconds, so a red
 * suite spent the ten-minute `globalTimeout` before the build test reported anything. That is
 * the wrong failure for a gate: "the suite ran out of time" says nothing about the farm. Its
 * own `globalTimeout` means the farm answers for itself whatever the other legs do, and CI runs
 * it as its own step even after a red smoke suite (`.github/workflows/e2e.yml`).
 *
 * ### One worker
 *
 * Both real-machine tests drive the one `runner` container — `resetBuildMachine()` before each
 * — so two workers would be two tests enrolling the same machine. The base config's reason
 * (the shared font-scale row) applies too.
 *
 * ### Its own report and results directory
 *
 * It runs in the same CI job as the smoke suite and the readability matrix; Playwright's
 * defaults would have it overwrite their HTML report.
 */
export default defineConfig({
  ...base,

  // The one spec this config exists for, and the base config's exclusion of it undone.
  // Between the configs, every spec runs under exactly one.
  testMatch: "farm.spec.ts",
  testIgnore: [],

  // See the header: the leg's number, enforced.
  globalTimeout: FARM_BUDGET_MS,

  // See the header: one build machine, shared by both real-machine tests.
  fullyParallel: false,
  workers: 1,

  outputDir: "./test-results/farm",
  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { outputFolder: "playwright-report/farm", open: "never" }]]
      : [["github"], ["list"], ["html", { outputFolder: "playwright-report/farm", open: "never" }]],
});
