/**
 * The shell's containment contract, as assertions
 * ([#647](https://github.com/NobuData/ouroboros/issues/647)).
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3 makes one promise with three visible halves: the
 * content pane is the **only** scroll container, so the chrome around it never moves, the
 * document never scrolls, and nothing pushes the pane sideways. Each half is a function here
 * rather than a paragraph in a spec file, because `specs/shell-nav.spec.ts` asserts them per
 * route and per theme and the words of a failure should be the same wherever it is caught.
 *
 * ## The planted failures
 *
 * A green containment leg is only worth something if it is provably capable of going red —
 * the same philosophy as `scripts/verify-failure-modes.sh`. The proof's hook is
 * `applyPlant` in [`support/plants.ts`](plants.ts), which
 * `scripts/verify-containment.sh` drives with `OURO_E2E_PLANT` set to each of the two
 * offences the per-route audit hunts (a viewport-fixed bar; pane-level horizontal
 * overflow), requiring the run to go red naming the matching assertion. The plants moved
 * out of this file when [#650](https://github.com/NobuData/ouroboros/issues/650)'s
 * readability audit grew two more of its own: one vocabulary, one variable, one place to
 * add the next.
 */

import { expect, type Page } from "@playwright/test";

/**
 * The pane's marker — `PANE_ATTRIBUTE` in `ouroboros-ui/app/shell/regions.ts`, restated as
 * a selector rather than imported because nothing in this suite may import service source
 * (`eslint.config.mjs`). The pane declares this attribute *as* its auditable contract; the
 * id beside it belongs to the skip link.
 */
export const PANE_SELECTOR = "[data-shell-pane]";

/** A bounding box as plain numbers — what `getBoundingClientRect` measures, minus the
 *  live object, so two measurements compare with `toEqual` and a failure prints both. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the chrome sits, measured for comparison across a scroll.
 *
 * Serialisable on purpose — `toEqual` over two of these is the "provably fixed" assertion,
 * and a failure prints both sets of numbers.
 */
export interface ChromeBoxes {
  /** The header's bounding box. */
  readonly header: Box | null;
  /** The sidebar's bounding box. */
  readonly sidebar: Box | null;
}

/**
 * Measure the header and sidebar.
 *
 * By their landmark roles' own elements — `.shell-header` and the `Primary` navigation —
 * because those are the two regions § 1.3 promises never move.
 *
 * @param page - The page, already inside the shell.
 * @returns Both boxes, as plain JSON so two measurements compare with `toEqual`.
 */
export async function chromeBoxes(page: Page): Promise<ChromeBoxes> {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (element === null) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };

    return {
      header: box(document.querySelector("header.shell-header")),
      sidebar: box(document.querySelector("nav#shell-sidebar")),
    };
  });
}

/**
 * Scroll the pane by `distance` and require the scroll to have actually happened.
 *
 * The requirement is the difference between "the chrome held still under scroll" and "the
 * chrome held still because nothing moved": a fixture too short to scroll would pass the
 * box comparison while asserting nothing at all.
 *
 * @param page - The page.
 * @param distance - How deep, in pixels. The pane must overflow by at least this much.
 * @returns When the pane reports the requested position.
 */
export async function scrollPaneTo(page: Page, distance: number): Promise<void> {
  const pane = page.locator(PANE_SELECTOR);

  expect(
    await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
    `the route must overflow its pane by at least the ${distance}px scroll under test`,
  ).toBeGreaterThanOrEqual(distance);

  await pane.evaluate((el, to) => el.scrollTo(0, to), distance);
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(distance);
}

/**
 * The pane does not scroll sideways — § 1.3's "wide content scrolls inside its own
 * wrappers, never at pane level", and one of the two assertions
 * `scripts/verify-containment.sh` proves can go red.
 *
 * @param page - The page, already inside the shell.
 * @returns When the assertion has run.
 */
export async function expectNoPaneHorizontalScroll(page: Page): Promise<void> {
  const pane = page.locator(PANE_SELECTOR);

  expect(
    await pane.evaluate((el) => el.scrollWidth - el.clientWidth),
    "pane-level horizontal scroll: something inside the pane is wider than the pane and " +
      "carries no overflow wrapper of its own",
  ).toBe(0);
}

/**
 * Nothing is stuck to the viewport — the "no viewport-sticky offenders" question of the
 * per-route audit, and the other assertion the containment script proves can go red.
 *
 * The shell's chrome holds still by construction, not by `position: fixed`: the frame is a
 * viewport-sized grid whose only scrolling cell is the pane, so at rest — desktop width, no
 * drawer, no overlay open — **no rendered element in the document is fixed**. The drawer,
 * its scrim and the overlay layer's panels are fixed while they exist, which is why the
 * containment tests run with none of them open; an element with no box is ignored for the
 * same reason.
 *
 * @param page - The page, at desktop width with nothing overlaid.
 * @returns When the assertion has run.
 */
export async function expectNoViewportFixedElements(page: Page): Promise<void> {
  const offenders = await page.evaluate(() =>
    // `Array.from` rather than iterating the live list: this project's TypeScript lib has
    // no DOM iterables, and an array is what the filter/map shape wants anyway.
    Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => getComputedStyle(element).position === "fixed")
      // Present but not rendered — a closed drawer, a display:none template — is not
      // stuck to anything.
      .filter((element) => element.getClientRects().length > 0)
      .map(
        (element) =>
          `<${element.tagName.toLowerCase()}${
            element.className === "" ? "" : ` class="${element.className}"`
          }>`,
      ),
  );

  expect(
    offenders,
    "viewport-fixed element: something is positioned against the viewport instead of " +
      "living in the shell's grid or scrolling with the pane",
  ).toEqual([]);
}

/**
 * The document itself has not scrolled — § 1.3's first sentence, asserted after every deep
 * pane scroll because a document that moved is the one failure that would drag the chrome
 * with it while both boxes still agree.
 *
 * @param page - The page.
 * @returns When the assertion has run.
 */
export async function expectDocumentUnscrolled(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => window.scrollY),
    "the document scrolled: the pane is supposed to be the only scroll container",
  ).toBe(0);
}

/**
 * No topbar survived the migration — the grep criterion of #647, standing in the suite so
 * a page pasted from a mockup turns a leg red rather than passing review.
 *
 * The class names are the mockups' own (`docs/mockups/*.html`, superseded by design-system
 * § 2): every mockup page opens with `<div class="topbar">…<nav class="nav">`, so a copied
 * frame carries them verbatim.
 *
 * @param page - Any route, in or out of the shell.
 * @returns When the assertion has run.
 */
export async function expectNoTopbarRemnants(page: Page): Promise<void> {
  await expect(
    page.locator(".topbar, .topbar-inner, nav.nav"),
    "a mockup topbar remnant is in the rendered page",
  ).toHaveCount(0);
}
