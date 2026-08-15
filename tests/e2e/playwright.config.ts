import { defineConfig, devices } from "@playwright/test";

import { EXPECT_TIMEOUT_MS, SUITE_BUDGET_MS, TEST_TIMEOUT_MS, UI_URL } from "./support/stack";

/**
 * The end-to-end smoke suite — issue
 * [#56](https://github.com/NobuData/ouroboros/issues/56), the MVP exit gate.
 *
 * Four decisions in this file are load-bearing.
 *
 * ### There is no `webServer`
 *
 * Playwright can start the thing under test. It must not here: what is under test is *the
 * compose stack*, cold — three images built from this checkout, a migrated database and a
 * seed, brought up in dependency order. `scripts/run.sh` and the CI workflow own that, and
 * they use `docker compose up --wait`, which blocks on the services' own healthchecks
 * rather than on a port opening or a sleep. A `webServer` here would be a second, weaker
 * definition of ready, and the run it gated would not be the deployment.
 *
 * It is also what makes `scripts/verify-failure-modes.sh` possible: that script stops a
 * service and runs one spec against the stack that is left, and a runner that insisted on
 * bringing everything up first would put it back.
 *
 * ### The budget is enforced, not documented
 *
 * `globalTimeout` is the issue's *under ten minutes wall clock* criterion. The suite is
 * scheduled to gain a dozen more legs — every mockup roadmap amends one in, each with a
 * stated budget of its own — so the number that matters is the total, and the runner is
 * the only thing that will still be checking it in six months.
 *
 * ### No retries
 *
 * The second acceptance criterion is that each leg *fails meaningfully when its service is
 * stopped*. A retry is the mechanism by which that stops being true: it converts a real
 * failure into a slow pass often enough that nobody investigates the ones it does not
 * convert. A gate that needs a retry to be green is not reporting on the system, and the
 * honest fix — waiting on the healthchecks before the first test, which `--wait` does — is
 * already in place.
 *
 * ### One browser
 *
 * Chromium. This suite answers *does the chain work*, not *does it work in Safari*; the
 * cross-browser and both-theme screenshot work belongs to the per-page legs the mockup
 * roadmaps amend in, and paying for it here would spend the ten-minute budget three times
 * over for one bit of information.
 *
 * ### Where screenshot baselines live
 *
 * Beside the spec that records them, under `specs/__screenshots__/`, rather than in
 * Playwright's default `<spec>-snapshots/` directory next to each file. One directory keeps
 * the specs listing readable as *one file per leg* — which is what `specs/` is for — as the
 * dashboard leg ([#88](https://github.com/NobuData/ouroboros/issues/88)) is joined by the
 * issues screen's, the studio's and a dozen more.
 *
 * The platform is in the name because a rendered page is a platform artefact: the same
 * checkout produces different pixels on Linux and macOS, and a baseline that did not say
 * which it came from would make every developer's first run red for a reason that is not a
 * regression. CI is Linux and the baselines committed here are Linux's.
 */
export default defineConfig({
  testDir: "./specs",

  // The issue's third acceptance criterion, enforced.
  globalTimeout: SUITE_BUDGET_MS,
  timeout: TEST_TIMEOUT_MS,
  expect: {
    timeout: EXPECT_TIMEOUT_MS,
    toHaveScreenshot: {
      // Anti-aliasing on type and on the pulse card's glyph differs by a pixel or two between
      // runs of the same build on the same machine, and by more between a laptop and a
      // runner. A zero tolerance would make every baseline a nuisance somebody re-records
      // rather than reads; a generous one would let a card go missing. Two per mille of the
      // viewport is roughly a line of text — enough to survive rasterisation, far too little
      // to hide a layout that moved.
      maxDiffPixelRatio: 0.002,
    },
  },

  // See the header. One directory per suite rather than one per spec, and the platform in
  // the name because pixels are a platform artefact.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}",

  // Files run side by side; tests within a file run in order. The tenant leg writes rows
  // the same file then reads back, and a shared stack is not a place to discover that a
  // suite depended on ordering it never declared.
  fullyParallel: false,
  workers: process.env.CI === undefined ? undefined : 2,

  // See the header: a green that needed a second attempt is not a gate.
  retries: 0,

  // A `test.only` left in a spec silently narrows the release gate to one test.
  forbidOnly: process.env.CI !== undefined,

  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { open: "never" }]]
      : [["github"], ["list"], ["html", { open: "never" }]],

  use: {
    baseURL: UI_URL,
    // Kept only for a failure, and then it is the whole diagnosis: this suite fails on a
    // machine nobody is watching, so the artefact has to answer the question by itself.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The compose stack is plain HTTP on loopback and its certificate story is nothing;
    // this is here so a future stack behind a self-signed proxy fails loudly instead.
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
