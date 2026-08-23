/**
 * Leg 8 — *the readability bar, automated*
 * ([#650](https://github.com/NobuData/ouroboros/issues/650), CQ.3 of
 * `docs/ROADMAP_UIUX_APP_SHELL.md`, amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4 ends with a bar rather than a promise: *at 150% no
 * clipped labels, no overlapping chrome, tables degrade to horizontal scroll in their
 * wrappers; screenshot matrix (scale × theme × key pages) in CI.* This file is that bar,
 * and it is in three parts:
 *
 *   * **The matrix.** {100%, 125%, 150%} × {light, dark} × the roster, diffed against
 *     committed baselines. What a screenshot catches is the thing no assertion is written
 *     for — a card that reflowed, a gutter that collapsed, type that stopped fitting its
 *     line — and what it catches *per scale* is the layout that was only ever reviewed at
 *     100%.
 *   * **The 150% audit.** Four measurements a screenshot review cannot make: pane-level
 *     horizontal scroll, text clipped by its own container, sticky chrome overlapping
 *     sticky chrome, and AA contrast in both palettes. Clipping is the reason this is a
 *     probe and not a pair of eyes — text cut off by its box looks, in a screenshot, like a
 *     sentence that ended.
 *   * **The roster.** Four of the issue's five pages do not exist yet, and each is asserted
 *     *absent* rather than skipped, so the day one lands this leg goes red naming the page
 *     to photograph. `support/readability.ts` argues that choice at length.
 *
 * A fourth group holds no browser at all: the contrast arithmetic, checked against the
 * ratios `docs/DESIGN_TOKENS.md` publishes. A probe whose maths is wrong is worse than no
 * probe, and this is the cheapest possible guard against that.
 *
 * ## Why this leg has a config of its own
 *
 * [`playwright.readability.config.ts`](../playwright.readability.config.ts), and it is not
 * tidiness. The issue's first acceptance criterion is a **number** — the matrix runs in CI
 * within three minutes — and `globalTimeout` is the only thing that will still be checking
 * it in six months. The smoke suite's budget is ten minutes and is enforced the same way
 * (`support/stack.ts`), so charging this leg against it would mean one number covering two
 * gates and the first one to overrun quietly borrowing from the other.
 *
 * That config also runs this file on **one worker**. Every test here writes the font scale,
 * which is a row keyed on the *person* and shared by every context in the run; two workers
 * would be two tests photographing each other's preference.
 *
 * ## The plants
 *
 * `scripts/verify-readability.sh` runs the audit three more times with `OURO_E2E_PLANT`
 * set, requiring it to go red naming each offence — the same argument
 * `verify-failure-modes.sh` makes about services, applied to CSS. `support/plants.ts` holds
 * the four offences and the table of which assertion must catch each.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  AA_LARGE,
  AA_NORMAL,
  type ColourSample,
  measure,
  requiredRatio,
} from "../support/contrast";

import { applyPlant } from "../support/plants";
import {
  AUDIT_SCALE,
  AWAITED_PAGES,
  expectContrastMeetsAA,
  expectNoClippedText,
  expectNoOverlappingChrome,
  MATRIX_PAGES,
  MATRIX_SCALES,
  type MatrixPage,
  settleLayout,
} from "../support/readability";
import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  expectFontScale,
  type FontScale,
  restoreFontScale,
  setFontScale,
} from "../support/settings";
import { expectNoPaneHorizontalScroll } from "../support/shell";
import { pinTheme, THEMES } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * Put the reader at a scale, then land on the page and prove the scale arrived.
 *
 * The order matters and is the behaviour under test: the preference is the *person's* and
 * lives in `ouroboros-rest`, so it is written before the navigation and read back by
 * `app/shell/font-scale-sync.tsx` when the session loads. `expectFontScale` is both halves
 * of *arrived* — the root size, and the attribute that chose it — because a page carrying
 * the attribute at 16px is a page whose font-scale rules never made it into the image, and
 * every screenshot below it would be a baseline of the wrong thing.
 *
 * @param page - The page to drive.
 * @param target - Which page of the roster.
 * @param scale - The step to render at.
 * @returns When the page has rendered, hydrated, and is provably at that scale.
 */
async function enterAtScale(page: Page, target: MatrixPage, scale: FontScale): Promise<void> {
  await page.goto(target.route);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(target.heading);

  await expectFontScale(page, scale);
}

/**
 * What a screenshot of this page must not be taken of.
 *
 * The same rule `specs/dashboard.spec.ts` applies to its own pair, restated per page
 * because the matrix multiplies it by six: a value that is honestly different in every
 * render would fail every baseline, and masking it is what makes the rest of the page
 * comparable rather than what hides a failure. Both masked things are asserted *as text*,
 * at the precision they can honestly be asserted at, by that file's seeded group.
 *
 * The chrome story masks nothing: its forty-eight rows are generated from an index, on
 * purpose, so that it can be photographed.
 *
 * @param page - The page under the shutter.
 * @param target - Which page of the roster.
 * @returns The regions to paint over, which is empty for a fully deterministic page.
 */
function volatile(page: Page, target: MatrixPage): Locator[] {
  if (target.key !== "dashboard") return [];

  return [
    // The greeting, whose daypart is the reader's own clock.
    page.getByRole("heading", { level: 1 }),
    // The Elapsed column, a second older by the time the shutter closes.
    page.getByRole("table", { name: "Loops running right now" }).locator(".ou-table__cell--mono"),
  ];
}

test.beforeEach(async ({ context, page }) => {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
  await applyPlant(page);
});

/**
 * The scale is a row keyed on the person and outlives this context, so it is put back after
 * every test rather than after the ones that happen to be last. A leftover 150% would hand
 * the next leg — and the next run's dashboard baselines — a page half again as large as the
 * one they were written against.
 */
test.afterEach(async ({ context }) => {
  await restoreFontScale(context);
});

for (const target of MATRIX_PAGES) {
  test.describe(`the matrix over ${target.route}`, () => {
    for (const scale of MATRIX_SCALES) {
      test(`${scale}% is unchanged in both palettes`, async ({ context, page }) => {
        await setFontScale(context, scale);
        await enterAtScale(page, target, scale);

        for (const theme of THEMES) {
          await pinTheme(page, theme);

          // Two name segments rather than one: the matrix is a dozen files and growing,
          // and `__screenshots__/readability/` keeps them out of the two the dashboard leg
          // owns. The platform and the project are appended by `snapshotPathTemplate`.
          await expect(page).toHaveScreenshot(
            ["readability", `${target.key}-${scale}-${theme}.png`],
            { mask: volatile(page, target) },
          );
        }
      });
    }
  });

  test.describe(`the ${AUDIT_SCALE}% audit on ${target.route}`, () => {
    test.beforeEach(async ({ context, page }) => {
      await setFontScale(context, AUDIT_SCALE);
      await enterAtScale(page, target, AUDIT_SCALE);

      // One wait for the three geometric probes below, rather than one each: a page read
      // while it is still laying out answers differently every frame, and the answer it
      // gives on arrival is not the page (`support/settle.ts`).
      await settleLayout(page);
    });

    test("nothing is clipped, nothing overlaps, nothing scrolls the pane sideways", async ({
      page,
    }) => {
      // § 1.3's promise at the scale that breaks it: a table shipped without its
      // `overflow-x` wrapper fits at 100% and pushes the pane sideways at 150%, which is
      // precisely the regression a review at 100% cannot see.
      await expectNoPaneHorizontalScroll(page);

      await expectNoClippedText(page);
      await expectNoOverlappingChrome(page, target.stickyStack);
    });

    for (const theme of THEMES) {
      test(`WCAG AA holds in ${theme}`, async ({ page }) => {
        await pinTheme(page, theme);
        await expectContrastMeetsAA(page);
      });
    }
  });
}

test.describe("the contrast arithmetic agrees with the token sheet", () => {
  /**
   * These tests take no `page` fixture and open no browser: they exercise
   * `support/contrast.ts`, which is ordinary arithmetic over numbers the page hands back.
   * They live in this file because they are this leg's own foundation — a probe whose
   * maths is wrong reports failures that are not there, or worse, silence that is not
   * earned — and because Playwright is the only runner this directory has.
   *
   * The examples are `docs/DESIGN_TOKENS.md` § *Text* verbatim, which
   * `scripts/verify-tokens.sh` re-derives from `docs/design/tokens.css` with
   * `scripts/lib/contrast.awk` on every run. Two independent implementations agreeing on
   * four published pairs is what makes this module's claim to be *the same arithmetic*
   * checkable rather than asserted.
   */
  const PUBLISHED = [
    {
      what: "--ink on --ground, light",
      ink: "rgb(22, 35, 43)",
      ground: "rgb(245, 248, 250)",
      ratio: 15.04,
    },
    {
      what: "--ink on --ground, dark",
      ink: "rgb(233, 242, 246)",
      ground: "rgb(18, 24, 29)",
      ratio: 15.75,
    },
    {
      what: "--ink-faint on --surface, light",
      ink: "rgb(92, 111, 122)",
      ground: "rgb(255, 255, 255)",
      ratio: 5.24,
    },
    {
      what: "--ink-faint on --surface, dark",
      ink: "rgb(126, 144, 153)",
      ground: "rgb(23, 31, 38)",
      ratio: 5.03,
    },
  ] as const;

  /**
   * Build a sample the way the page's own walk does.
   *
   * @param colour - The computed `color`.
   * @param background - The one opaque colour behind it.
   * @param fontSizePx - The computed size. Defaults below the large-text threshold.
   * @param fontWeight - The computed weight.
   * @returns The sample.
   */
  function sample(
    colour: string,
    background: string,
    fontSizePx = 16,
    fontWeight = 400,
  ): ColourSample {
    return { what: "a sample", colour, backgrounds: [background], fontSizePx, fontWeight };
  }

  for (const { what, ink, ground, ratio } of PUBLISHED) {
    test(`${what} is ${ratio.toFixed(2)}:1, as the token sheet publishes`, () => {
      const measured = measure(sample(ink, ground));

      expect(measured.ratio, what).not.toBeNull();
      expect(
        Number.parseFloat((measured.ratio ?? 0).toFixed(2)),
        `${what}: this suite and scripts/lib/contrast.awk must agree`,
      ).toBe(ratio);
    });
  }

  test("the two ends of the scale are 1 and 21", () => {
    // The formula's own fixed points, which catch a linearisation that stopped linearising
    // long before a token pair drifts far enough to notice.
    expect(measure(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)")).ratio).toBeCloseTo(21, 2);
    expect(measure(sample("rgb(64, 64, 64)", "rgb(64, 64, 64)")).ratio).toBeCloseTo(1, 6);
  });

  test("translucent ink is judged over what is behind it, not as if it were opaque", () => {
    // Half-opacity black on white is mid-grey on white, not black on white. A probe that
    // ignored alpha would flatter every dimmed surface in the product.
    const flattered = measure(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)")).ratio ?? 0;
    const honest = measure(sample("rgba(0, 0, 0, 0.5)", "rgb(255, 255, 255)")).ratio ?? 0;

    expect(honest).toBeLessThan(flattered);
    expect(honest).toBeGreaterThan(1);
  });

  test("a colour this suite cannot read is unjudged rather than guessed", () => {
    // A wide-gamut `color()` from a future token sheet. Guessing black would invent a
    // ratio and, sooner or later, a failure nobody can reproduce.
    expect(measure(sample("color(display-p3 0.1 0.2 0.3)", "rgb(255, 255, 255)")).ratio).toBeNull();

    // And a background chain with nothing opaque in it is not a background.
    expect(
      measure({
        what: "a sample",
        colour: "rgb(0, 0, 0)",
        backgrounds: ["rgba(0, 0, 0, 0)"],
        fontSizePx: 16,
        fontWeight: 400,
      }).ratio,
    ).toBeNull();
  });

  test("the large-text thresholds are WCAG's, read off the rendered size", () => {
    // 18pt, or 14pt bold — measured on the glass, which is why the font-scale preference
    // moves a label across the boundary and the bar with it.
    expect(requiredRatio(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)", 23.9))).toBe(AA_NORMAL);
    expect(requiredRatio(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)", 24))).toBe(AA_LARGE);
    expect(requiredRatio(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)", 19, 400))).toBe(AA_NORMAL);
    expect(requiredRatio(sample("rgb(0, 0, 0)", "rgb(255, 255, 255)", 19, 700))).toBe(AA_LARGE);
  });
});

test.describe("the roster is still waiting for the same four pages", () => {
  /**
   * The issue names five dense pages and one of them is built. This is the assertion that
   * keeps that sentence true rather than letting it become a stale comment: each awaited
   * route must still answer `404`, so the run goes red on the day one of them starts
   * answering — naming the page to move into `MATRIX_PAGES` and the issue that built it.
   *
   * A signed-in request, deliberately: `/dashboard` and `/workshop/chrome` both redirect a
   * visitor with no session, so an unauthenticated probe would report `404` for a route
   * that exists and is merely gated.
   */
  test("every page the matrix is waiting for is still unbuilt", async ({ page }) => {
    const answering: string[] = [];

    for (const awaited of AWAITED_PAGES) {
      const response = await page.goto(awaited.route);
      const status = response?.status();

      if (status !== 404) {
        answering.push(
          `${awaited.route} answers ${String(status)} — ${awaited.label} is built. ` +
            `Move it into MATRIX_PAGES and record its baselines (${awaited.awaits}).`,
        );
      }
    }

    expect(
      answering,
      "the readability matrix is short of the five pages the issue names, and one of the " +
        "four it is waiting for has landed",
    ).toEqual([]);
  });
});
