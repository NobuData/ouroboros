/**
 * Leg 19 — the test-results page's states ([#342](https://github.com/NobuData/ouroboros/issues/342),
 * AU.8), against the AS.5 seed ([#328](https://github.com/NobuData/ouroboros/issues/328)).
 *
 * Mockup 11 draws one state: a mid-flight build whose results have parsed. This leg draws that
 * one at parity and then the ones a reader meets on a bad day.
 *
 * * **Parity** — the seeded `#482`, Build 3, in both palettes: the mockup's head, strip, timeline,
 *   suites and cards, with the two things the mockup does not say — the figures labelled
 *   *partial* because the build is still running, and the ingest-lag banner because the seed's
 *   build has uploaded nothing since it was written.
 * * **The states** — a run without results (`#474`), a run that does not exist, an `?attempt=`
 *   naming a build the run never made, and a report that parsed in part.
 * * **Who is reading** — a member served the re-runs and offered no waive.
 * * **The shell** — header and sidebar fixed while the content pane scrolls, the originating
 *   module's sidebar entry lit, and the page correct at the 125 % font-scale step.
 *
 * ## The live chain is parked
 *
 * The issue's second item — a real farm job uploading the `failing-HIL` fixture set, the page
 * drawing it from parsed truth, a *product bug* classification with its note verified in the run
 * console's transcript, a re-run through the farm and a green attempt — is written down here as
 * `test.fixme`, for three reasons that are each somebody else's open issue:
 *
 * 1. **The Mark & Route card is not built** ([#340](https://github.com/NobuData/ouroboros/issues/340)).
 *    The page has the slot, not the radios, the note or the dispatch, so there is nothing to
 *    classify with — and no *waive* for a member's view to be without.
 * 2. **Nothing routes a run's build to the farm** ([#265](https://github.com/NobuData/ouroboros/issues/265)).
 *    `FarmJobsService.submitForRun` is the seam, and AT.6's harness calls it directly.
 * 3. **A real runner cannot run a build** ([#991](https://github.com/NobuData/ouroboros/issues/991)),
 *    which is what parks leg 16's build test too.
 *
 * Its three failure-mode pairs — the upload path, the parser, the routing dispatch — are
 * registered in `scripts/verify-failure-modes.sh` as parked, so the day the test runs the script
 * starts checking it.
 *
 * ## What is intercepted, and why that is honest
 *
 * No seeded attempt carries a parse warning, and writing one into the seed would put a truncated
 * report on mockup 11's page. So the parse-warning test rewrites **the browser's own poll** of the
 * attempt's page on its way back, adding one warning to what the service really answered. It
 * proves the page draws the banner from the payload's typed warnings in both palettes; that the
 * parser writes them is `ouroboros-rest`'s suite (#329), and the chain between the two is the
 * parked test's.
 */

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The seeded run mockup 11 draws — `#482`, *Loop #1847*. */
const SEEDED_RUN_ID = "5eed0009-0000-4000-8000-000000000482";

/** The seeded run that merged and reported no test results — `#474`. */
const UNTESTED_RUN_ID = "5eed0009-0000-4000-8000-000000000474";

/** A well-formed id no seed writes. */
const NO_SUCH_RUN_ID = "5eed0009-0000-4000-8000-0000000fffff";

/** Build 3 of `#482` — the mockup's attempt, still running. */
const MOCKUP_ATTEMPT = 3;

/** A window wide enough for the strip's five cards and tall enough to photograph the page whole. */
const PARITY_WINDOW = { width: 1920, height: 2400 };

/** Longer than the two minutes after which a running build's silence is named. */
const PAST_THE_LAG_THRESHOLD = "03:00";

/** The warning the parse-warning test adds to the poll's answer — the issue's own story. */
const TRUNCATED = {
  code: "xml_truncated",
  file: "junit-telemetry.xml",
  message: "The document ended inside <testsuite>; 40 cases closed before it.",
  at: "line 212",
} as const;

/** What the page says a truncated file leaves missing. */
const TRUNCATED_MISSING = "The file ended early, so every case after the break is missing.";

/*
 * What a test says when the layer under it broke — the "fails meaningfully" half of the gate.
 * Each is printed with the assertion that went red, so the log names the layer rather than only
 * a timeout.
 */

/** The head never drew: the timeline read found no seeded run. */
const READ_MODEL_BROKE =
  "the seeded #482 must draw its head — the page reads the run's attempts out of the test-results read model";

/** The banner never drew: the page did not read the payload's warnings. */
const WARNINGS_BROKE =
  "the parse-warning banner must draw — the page reads the attempt's typed parse warnings";

/**
 * Sign a seeded person into the seeded workspace.
 *
 * @param context The browser context.
 * @param userId Who. Defaults to the owner.
 * @returns When the session is ready.
 */
async function signInAs(context: BrowserContext, userId: string = SEED_OWNER.id): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
}

/**
 * The page's address.
 *
 * @param runId The run.
 * @param query The query, without its `?`.
 * @returns The path.
 */
function testsPath(runId: string, query = ""): string {
  return `/runs/${runId}/tests${query === "" ? "" : `?${query}`}`;
}

/**
 * The page's `<main>` — visible only, because while the page streams React keeps a hidden copy
 * of the segment in the DOM (leg 17's note).
 *
 * @param page The test-results page.
 * @returns The landmark.
 */
function main(page: Page) {
  return page.locator("main.tests").filter({ visible: true });
}

/**
 * The head's meta row.
 *
 * @param page The test-results page.
 * @returns The row.
 */
function meta(page: Page) {
  return page.locator(".tests-head__meta").filter({ visible: true });
}

/**
 * The ingest-lag banner.
 *
 * @param page The test-results page.
 * @returns The banner.
 */
function lagBanner(page: Page) {
  return main(page)
    .locator(".ou-retry")
    .filter({ hasText: /No results received since/ });
}

test.describe("the test-results page's states (#342)", () => {
  test("parity: the seeded build, still running, in both palettes", async ({ context, page }) => {
    await signInAs(context);
    await page.setViewportSize(PARITY_WINDOW);

    // Installed before the first navigation, because the banner is driven by the shell clock's
    // `setInterval` and only a clock that was fake when that interval was created can be moved.
    await page.clock.install();
    await page.clock.resume();
    await page.goto(testsPath(SEEDED_RUN_ID, `attempt=${MOCKUP_ATTEMPT}`));

    await expect(main(page).locator(".ou-eyebrow").first(), READ_MODEL_BROKE).toHaveText(
      "Test Results · Run #1847 · Build 3",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#482 — Fix flaky CAN-bus telemetry test",
    );

    // ---- Running: the pill in the live hue, never a verdict's, and the figures labelled.
    const pill = meta(page).locator(".ou-chip").first();
    await expect(pill).toHaveText("61/63 passed · running");
    await expect(pill).toHaveClass(/ou-chip--accent/);
    await expect(pill).not.toHaveClass(/ou-chip--(err|warn)/);

    const partial = main(page).locator(".tests__partial");
    await expect(partial).toContainText("partial");
    await expect(partial).toContainText(
      "Build 3 is still running — 63 cases have been reported so far.",
    );
    await expect(partial).toContainText("not the final result");

    // ---- The live attempt card, pulsing.
    await expect(
      main(page).locator(".tests-timeline__card--live .tests-timeline__pulse"),
    ).toBeVisible();

    // ---- Parsed in full, so no parse-warning banner.
    await expect(page.getByRole("status", { name: "Parse warnings" })).toHaveCount(0);

    // ---- Ingest lag: the seeded build uploads nothing, so past the threshold the page says
    // when a report last arrived rather than letting a still strip imply a live one.
    await page.clock.fastForward(PAST_THE_LAG_THRESHOLD);
    await expect(lagBanner(page)).toContainText(
      /No results received since \d{1,2}:\d{2}.* — Build 3's uploads have gone quiet\./,
    );
    await expect(lagBanner(page).getByRole("button", { name: "Check again" })).toBeVisible();

    // The three things on the page that print a clock: when the seed was applied is not the
    // design's to fix.
    const clocks = [
      lagBanner(page).locator(".ou-retry__headline"),
      main(page).locator("time"),
      main(page).locator(".tests-timeline__loop"),
    ];

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`test-results-running-${theme}.png`, {
        mask: clocks,
      });
    }
  });

  test("a finished build is final: no partial label and no lag banner", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await page.clock.install();
    await page.clock.resume();
    await page.goto(testsPath(SEEDED_RUN_ID, "attempt=2"));

    await expect(main(page).locator(".ou-eyebrow").first(), READ_MODEL_BROKE).toHaveText(
      "Test Results · Run #1847 · Build 2",
    );
    await page.clock.fastForward(PAST_THE_LAG_THRESHOLD);

    await expect(main(page).locator(".tests__partial")).toHaveCount(0);
    await expect(lagBanner(page)).toHaveCount(0);
  });

  test("a run without results says so, and leads to its console", async ({ context, page }) => {
    await signInAs(context);
    await page.goto(testsPath(UNTESTED_RUN_ID, "from=build-farm"));

    await expect(main(page).locator(".ou-eyebrow").first(), READ_MODEL_BROKE).toHaveText(
      "Test Results · Run #1839",
    );
    await expect(main(page)).toContainText("No test results yet.");
    await expect(main(page).getByRole("link", { name: "Open the run console" })).toHaveAttribute(
      "href",
      `/runs/${UNTESTED_RUN_ID}?from=build-farm`,
    );

    // Not an empty shell: no strip, no cards, no actions.
    await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Test actions" })).toHaveCount(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`test-results-empty-${theme}.png`);
    }
  });

  test("a run that does not exist is the page's own not-found, inside the shell", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    // No status is asserted: the segment streams behind its skeleton, so the response has
    // already begun, as `200`, by the time the read finds no run.
    await page.goto(testsPath(NO_SUCH_RUN_ID));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "These test results do not exist.",
    );
    await expect(main(page).locator(".ou-eyebrow")).toHaveText("Test Results");
    await expect(main(page).getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`test-results-missing-${theme}.png`);
    }
  });

  test("a build the run never made is named, and the latest is shown", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await page.goto(testsPath(SEEDED_RUN_ID, "attempt=9"));

    await expect(main(page).locator(".tests__notice")).toHaveText(
      "Build 9 does not exist for this run — showing Build 4, the latest.",
    );
    await expect(main(page).locator(".ou-eyebrow").first()).toHaveText(
      "Test Results · Run #1847 · Build 4",
    );
  });

  test("a report that parsed in part names what failed and what is missing", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    // The browser's own poll of the attempt's page, answered by the service and then given one
    // warning — see this file's header. `if-none-match` is dropped so the answer has a body.
    await page.route("**/api/test-runs/*", async (route) => {
      const headers = { ...route.request().headers() };
      delete headers["if-none-match"];

      const response = await route.fetch({ headers });
      if (response.status() !== 200) return route.fulfill({ response });

      const body = (await response.json()) as { parseWarnings?: unknown[] };
      await route.fulfill({ response, json: { ...body, parseWarnings: [TRUNCATED] } });
    });

    await page.goto(testsPath(SEEDED_RUN_ID, "attempt=2"));

    const banner = page.getByRole("status", { name: "Parse warnings" });
    await expect(banner, WARNINGS_BROKE).toBeVisible({ timeout: 45 * 1000 });
    await expect(banner).toContainText(
      "1 report file could not be fully read — Build 2's results are incomplete",
    );
    await expect(banner).toContainText("junit-telemetry.xml · line 212");
    await expect(banner).toContainText(TRUNCATED.message);
    await expect(banner).toContainText(TRUNCATED_MISSING);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(banner).toHaveScreenshot(`test-results-parse-warning-${theme}.png`);
    }
  });

  test("a member may re-run, and is offered no waive", async ({ context, page }) => {
    await signInAs(context, SEED_MEMBER.id);
    await page.goto(testsPath(SEEDED_RUN_ID));

    await expect(main(page).locator(".ou-eyebrow").first(), READ_MODEL_BROKE).toHaveText(
      "Test Results · Run #1847 · Build 4",
    );

    const actions = page.getByRole("group", { name: "Test actions" });
    await expect(actions.getByRole("button", { name: "Re-run full suite" })).toBeVisible();
    await expect(main(page)).not.toContainText("A viewer cannot start a build");
    await expect(main(page).getByRole("button", { name: /waive/i })).toHaveCount(0);

    // The half of the member's view that is #340's: classify allowed. Until the card is built
    // the page has its slot, and no control in it.
    const slot = page.getByRole("region", { name: "Mark & Route" }).filter({ visible: true });
    await expect(slot).toContainText("Nothing is staged.");
    await expect(slot.getByRole("radio")).toHaveCount(0);
  });

  test("live: failing-HIL — upload, parse, classify, correction, re-run, green, download", () => {
    // PARKED — see this file's header, § *The live chain is parked*.
    //
    // What it will do, on the commit that removes this line: start AT.6's `failing-hil` driver
    // scenario; have a real farm job upload the fixture set (the marker
    // `scripts/verify-failure-modes.sh` looks for is *the upload arrived*); require the strip,
    // the suites and the HIL rows to draw from what the parser stored (*the results parsed*);
    // classify *product bug* with a correction note and require the routed receipt (*the
    // correction was dispatched*); open the run console and require the note's text in its
    // transcript; re-run the failed set through the farm and require a green attempt in the
    // timeline; download an artifact and compare its bytes.
    test.fixme(
      true,
      "the Mark & Route card is #340, workflow build-stage integration is #265, and agent source checkout is #991",
    );
  });

  test("shell: fixed chrome, the origin lit, and the 125% step", async ({ context, page }) => {
    await signInAs(context);

    try {
      await setFontScale(context, "125");
      await page.goto(testsPath(SEEDED_RUN_ID, `from=build-farm&attempt=${MOCKUP_ATTEMPT}`));
      await expectFontScale(page, "125");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // ---- The module it was opened from stays lit; the page has no entry of its own.
      const sidebar = page.getByRole("navigation", { name: "Primary" });
      await expect(sidebar.getByRole("link", { name: /Build Farm/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(0);

      for (const theme of THEMES) {
        await pinTheme(page, theme);

        // ---- Header and sidebar hold still while the content pane scrolls.
        await scrollPaneTo(page, 0);
        const before = await chromeBoxes(page);
        expect(before.header, "the header must be on the page to be measured").not.toBeNull();
        expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
        await scrollPaneTo(page, 400);
        expect(await chromeBoxes(page)).toEqual(before);

        // ---- At 125%, nothing on the page pushes the pane sideways.
        await expectNoPaneHorizontalScroll(page);
      }
    } finally {
      await restoreFontScale(context);
    }
  });
});
