/**
 * Chart primitives — *mockup 15's four shapes, photographed*
 * ([#442](https://github.com/NobuData/ouroboros/issues/442), BK.1).
 *
 * The unit suite (`ouroboros-ui/__tests__/charts/`) holds the markup and the arithmetic; what
 * only a browser can answer is whether the result *looks* like the mockup, in both palettes
 * and at the 125 % font scale, and whether the keyboard really reaches a day's detail. The
 * fixture is the workshop's chart story (`/workshop/charts`), which draws every chart over
 * mockup 15's own data plus the cases the mockup does not show.
 *
 * Baselines live in `__screenshots__/` beside the other legs'; a first run on a new machine
 * writes them with `--update-snapshots`, and they are compared against the mockup by eye
 * before they are committed.
 */

import { expect, test } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { FONT_SCALE_ATTRIBUTE, restoreFontScale, setFontScale } from "../support/settings";
import { PANE_SELECTOR } from "../support/shell";
import { pinTheme, THEMES } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

test.describe("the chart primitives", () => {
  test.beforeEach(async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workshop/charts");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chart primitives");
  });

  for (const theme of THEMES) {
    test(`match mockup 15 in the ${theme} palette`, async ({ page }) => {
      await pinTheme(page, theme);

      for (const section of ["time-series", "bar-rows", "sparklines", "stacked-bars"]) {
        await expect(page.locator(`section[aria-labelledby="${section}"]`)).toHaveScreenshot(
          `charts-${section}-${theme}.png`,
        );
      }
    });
  }

  test("reach a day's detail from the keyboard alone", async ({ page }) => {
    const days = page.getByRole("group", { name: /^Merged PRs per day.*daily detail$/ });
    const latest = days.getByRole("button", { name: /^Aug 8 — / });

    await latest.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(days.getByRole("button", { name: /^Aug 4 — / })).toBeFocused();
    await expect(page.locator(".chart-tip").first()).toHaveText(
      "Aug 4 — 6 merged · $9.12 · 1 intervention",
    );
  });

  test("animate nothing for a reader who has asked for less motion", async ({ page }) => {
    const animated = await page
      .locator(".chart-ts__line, .chart-hbar__bar, .chart-spark__bar, .chart-vb")
      .evaluateAll(
        (elements) =>
          elements.filter((element) => getComputedStyle(element).animationName !== "none").length,
      );

    expect(animated).toBe(0);
  });

  test("scroll wide charts inside their own wrappers at the 125% font scale", async ({
    context,
    page,
  }) => {
    await setFontScale(context, "125");
    await page.setViewportSize({ width: 900, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");

    // The pane never scrolls sideways (CP.4); a chart wider than its card scrolls itself.
    const pane = page.locator(PANE_SELECTOR);
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.locator(`section[aria-labelledby="time-series"]`)).toHaveScreenshot(
      "charts-time-series-125.png",
    );
  });

  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });
});
