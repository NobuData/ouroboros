import { defineConfig } from "@playwright/test";

import base from "./playwright.config";
import { READABILITY_BUDGET_MS } from "./support/stack";

/**
 * The readability matrix — issue
 * [#650](https://github.com/NobuData/ouroboros/issues/650), CQ.3's gate.
 *
 * One spec, run separately from the smoke suite, against the same stack. Everything that
 * is not stated below is [`playwright.config.ts`](playwright.config.ts)'s and is spread in
 * rather than repeated, so the two runs cannot drift on the things they genuinely share:
 * one browser, no retries, the same pixel tolerance, the same `__screenshots__` directory
 * with the platform in every name.
 *
 * Three things are this file's own.
 *
 * ### The budget is three minutes, and it is a different three minutes
 *
 * `globalTimeout` is the issue's first acceptance criterion — *the matrix runs in CI within
 * the ≤ 3 min budget* — enforced rather than measured. It is deliberately outside the smoke
 * suite's ten: that suite is the MVP exit gate and this leg is a QA bar, they run in
 * separate CI steps, and one number covering both is the number the first gate to overrun
 * quietly borrows from the other. `tests/e2e/README.md` § *The two budgets* is the rule.
 *
 * ### One worker
 *
 * Every test in this leg writes the reader's font scale, which is a **row keyed on the
 * person** (`support/settings.ts`) shared by every browser context in the run. Two workers
 * would be two tests photographing each other's preference, and the failure would look like
 * flake rather than like the ordering nobody declared. `fullyParallel` is off for the same
 * reason.
 *
 * ### What this config does *not* do about the cross-fade
 *
 * A palette swap in this product is a 180ms cross-fade over every colour, so for a fifth of
 * a second the page's ink and ground are both between two palettes — and `getComputedStyle`
 * reads whichever frame it lands on. The obvious fix is to run this leg as a reader who has
 * asked for less motion, which `app/globals.css` honours by not applying the transition at
 * all. It is not the fix here, for two reasons: it would make this the one leg that
 * photographs a configuration the other legs do not, and it treats one cause of a general
 * problem. The general problem is that every probe in this leg is an `evaluate`, and an
 * `evaluate` has none of the re-read-until-stable protection a screenshot assertion gets
 * for free.
 *
 * So the probes read twice and require the two readings to agree — `support/settle.ts`,
 * which carries the finding that motivated it.
 *
 * ### Its own report and results directory
 *
 * The smoke suite and this leg run one after the other in the same CI job, and Playwright's
 * defaults would have the second overwrite the first's HTML report — which is the artefact
 * somebody reads to find out why the job went red.
 */
export default defineConfig({
  ...base,

  // The one spec this config exists for, and the base config's `testIgnore` undone —
  // spreading a config spreads its exclusions too, and the file this run exists for is
  // exactly the file that one excludes. Between the two, every spec runs under exactly one
  // config.
  testMatch: "readability.spec.ts",
  testIgnore: [],

  // See the header: the issue's number, enforced.
  globalTimeout: READABILITY_BUDGET_MS,

  // See the header: the font scale is one row, shared by every context in the run.
  fullyParallel: false,
  workers: 1,

  outputDir: "./test-results/readability",
  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { outputFolder: "playwright-report/readability", open: "never" }]]
      : [
          ["github"],
          ["list"],
          ["html", { outputFolder: "playwright-report/readability", open: "never" }],
        ],
});
