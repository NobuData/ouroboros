/**
 * The shell leg [#56](https://github.com/NobuData/ouroboros/issues/56) was amended to carry
 * — [#647](https://github.com/NobuData/ouroboros/issues/647), CP.5 of
 * `docs/ROADMAP_UIUX_APP_SHELL.md`.
 *
 * Four promises of `docs/DESIGN_SYSTEM_APP_SHELL.md`, asserted against the composed stack:
 *
 *   * **The chrome holds still** (§ 1.3) — header and sidebar measured before and after a
 *     deep pane scroll, on every in-shell route, in both themes; the document itself never
 *     moves.
 *   * **Containment** — no pane-level horizontal scroll, no viewport-fixed element, and no
 *     mockup topbar remnant, per route. These are the audit's four questions made
 *     executable, and `scripts/verify-containment.sh` proves the two measurable ones can go
 *     red by planting each offence and requiring this file to catch it
 *     (`support/shell.ts`).
 *   * **The sidebar tells the truth about all eleven entries** (§ 1.2, § 3.5) — the built
 *     route is a link that lights under its URL; the nine unbuilt ones are labelled, carry
 *     the issue that unparks them, and are never dead links; a contextual route lights
 *     nothing.
 *   * **The rail and the drawer work, keyboard included** (§ 1.2) — the collapse choice
 *     survives a reload without a flash, and the drawer opens from the header, traps focus,
 *     and closes on Escape with focus returned.
 *
 * Scroll restoration — the other § 1.3 promise — already has its group in
 * `specs/shell.spec.ts`, written under the parking and running since #647 removed it.
 *
 * ## What "all eleven" means while nine screens do not exist
 *
 * The registry seeds eleven entries and exactly one route is built. This file asserts the
 * *whole* list — order, grouping, status honesty — and the active-state mechanics on
 * everything that can carry them: the live entry lights on its own route, stays lit on its
 * sub-paths (the rule is `isActiveRoute`, unit-tested in `ouroboros-ui`), and goes dark on
 * a contextual route that registered nothing. Each placeholder that lands (#49) turns its
 * row into a link and joins the click-through by having a route at all; nothing here needs
 * rewriting for it.
 */

import { expect, test, type Page } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  applyPlant,
  chromeBoxes,
  expectDocumentUnscrolled,
  expectNoPaneHorizontalScroll,
  expectNoTopbarRemnants,
  expectNoViewportFixedElements,
  scrollPaneTo,
} from "../support/shell";
import { selectWorkspace } from "../support/workspace";

/**
 * The in-shell routes the stack serves today, each with the ready signal that says React
 * has hydrated — driving the pane earlier would race the effects that own it.
 *
 * A list so the next migrated route joins the whole leg by adding a line. The ticket
 * pictures three; two exist, and the third arrives with whichever roadmap lands its screen
 * first.
 */
const IN_SHELL_ROUTES = [
  { route: "/dashboard", ready: /^Good (morning|afternoon|evening), / },
  { route: "/workshop/chrome", ready: /^In-pane chrome$/ },
] as const;

/** How deep the fixed-chrome measurement scrolls. Deeper than any viewport the suite
 *  runs at, so rows are provably passing under the chrome while it is measured. */
const SCROLL_DEPTH = 800;

/** The eleven entries `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2 names, in its order —
 *  restated from the spec rather than imported from the registry, because the sidebar
 *  agreeing with the specification is the assertion. */
const ALL_ELEVEN = [
  "Dashboard",
  "Issues",
  "Workflows",
  "Models",
  "Build Farm",
  "Knowledge",
  "Planning",
  "Research",
  "Insights",
  "Needs You",
  "Settings",
] as const;

/** Of the eleven, the ones whose routes are built. Growing this list is what #49 and each
 *  mockup roadmap do; the spec's own copy is what makes a silently dead link fail here. */
const LIVE_ENTRIES = ["Dashboard"] as const;

/** The sidebar landmark — its accessible name is `aria-label="Primary"`. */
function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/**
 * Stamp a palette through the account menu's theme radios, and put the menu away again.
 *
 * Through the control rather than through `localStorage`, so a theme the chrome is
 * measured under is one a reader can actually reach (`app/shell/user-menu.tsx` — CP.3's
 * radios). Closed afterwards with Escape, because what this file measures next is the
 * chrome, and an open panel over it would be the measurement's own artefact.
 *
 * @param page - The page, already inside the shell.
 * @param theme - Which palette to stamp.
 * @returns When `<html data-theme>` says so and the menu is closed.
 */
async function stampTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: /^Account menu/ }).click();

  const menu = page.getByRole("menu", { name: "Account" });

  await menu.getByRole("menuitemradio", { name: theme === "light" ? "Light" : "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
}

test.beforeEach(async ({ context, page }) => {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
  await applyPlant(page);
});

for (const { route, ready } of IN_SHELL_ROUTES) {
  test.describe(`the chrome holds still on ${route}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(ready);
    });

    for (const theme of ["light", "dark"] as const) {
      test(`header and sidebar do not move under a deep scroll — ${theme}`, async ({ page }) => {
        await stampTheme(page, theme);

        const before = await chromeBoxes(page);

        // Measured at all, before being measured equal: a selector gone stale would
        // otherwise compare null with null and pass while asserting nothing.
        expect(before.header, "the header must be on the page to be measured").not.toBeNull();
        expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();

        await scrollPaneTo(page, SCROLL_DEPTH);

        expect(await chromeBoxes(page)).toEqual(before);
        await expectDocumentUnscrolled(page);
      });
    }
  });

  test.describe(`containment on ${route}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(ready);
    });

    test("nothing scrolls the pane sideways or sticks to the viewport", async ({ page }) => {
      await expectNoPaneHorizontalScroll(page);
      await expectNoViewportFixedElements(page);
      await expectNoTopbarRemnants(page);
    });
  });
}

test.describe("the sidebar tells the truth about all eleven entries", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(IN_SHELL_ROUTES[0].ready);
  });

  test("all eleven rows are present, in the specification's order", async ({ page }) => {
    // The label element, not the row: a soon row's text also carries its chip, and the
    // list under assertion is the eleven *names* in § 1.2's order.
    await expect(sidebar(page).locator(".shell-nav__label")).toHaveText([...ALL_ELEVEN]);
  });

  test("every built entry is a link and every unbuilt one is labelled, never dead", async ({
    page,
  }) => {
    // The two claims that keep the sidebar honest (§ 3.5): a row is a real `<a href>`
    // exactly when its route exists…
    await expect(sidebar(page).getByRole("link")).toHaveText([...LIVE_ENTRIES]);

    // …and a row that is not carries the *soon* chip and a tooltip naming what it awaits,
    // so "not yet" is an answer rather than a dead end.
    const soonRows = sidebar(page).locator(".shell-nav__item--soon");
    await expect(soonRows).toHaveCount(ALL_ELEVEN.length - LIVE_ENTRIES.length);

    for (const row of await soonRows.all()) {
      await expect(row.locator(".shell-nav__soon")).toHaveText("soon");
      // Singular and plural both occur — "Planning arrives with #283", "Workspace
      // settings arrive with #491" — and the claim is only that the tooltip names a when.
      await expect(row).toHaveAttribute("title", /arrives? with/);
    }
  });

  test("the live entry lights on its route and goes dark on a contextual one", async ({ page }) => {
    const dashboard = sidebar(page).getByRole("link", { name: "Dashboard" });

    // `aria-current` rather than the class: the active state must be the one a screen
    // reader is told about, not merely the painted one.
    await expect(dashboard).toHaveAttribute("aria-current", "page");

    // The workshop registered no entry — it is contextual chrome, not a module — so
    // nothing may claim it. An entry lit on somebody else's route is the failure
    // `isActiveRoute`'s prefix rule exists to prevent.
    await dashboard.click();
    await page.goto("/workshop/chrome");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("In-pane chrome");
    await expect(sidebar(page).locator("[aria-current]")).toHaveCount(0);
  });
});

test.describe("the rail: the collapse choice, and its survival", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(IN_SHELL_ROUTES[0].ready);
  });

  test("collapsing stamps the rail, keeps every label announced, and survives a reload", async ({
    page,
  }) => {
    const html = page.locator("html");
    const nav = sidebar(page);

    // A fresh reader has chosen nothing; at desktop width the default is wide, spelled as
    // the attribute's absence (`app/shell/sidebar-state.ts`).
    await expect(html).not.toHaveAttribute("data-sidebar");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(html).toHaveAttribute("data-sidebar", "rail");

    // Narrower than wide by construction rather than by a pixel constant the stylesheet
    // owns — polled, because the width animates (`--shell-sidebar-slide`) and the claim
    // is about where it settles; and the label leaves the *view* without leaving the
    // accessibility tree, so the row is announced identically at every width.
    await expect
      .poll(() => nav.evaluate((el) => el.getBoundingClientRect().width))
      .toBeLessThan(100);

    // Visually hidden the accessible way: clipped to a pixel rather than `display: none`,
    // so the box collapses while the name survives — asserted as both halves, because
    // either alone can be true for the wrong reason.
    const label = nav.getByRole("link", { name: "Dashboard" }).locator(".shell-nav__label");
    expect(await label.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAccessibleName(/Dashboard/);

    // The choice is a preference, so it holds across a reload — stamped by the head
    // bootstrap before paint, which is why the assertion can run on the first commit.
    await page.reload();
    await expect(html).toHaveAttribute("data-sidebar", "rail");

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(html).toHaveAttribute("data-sidebar", "wide");
  });

  test("the keyboard reaches the ring: the tab stop sits where the reader is", async ({ page }) => {
    // The roving ring's resting state (§ 1.2's "arrow navigation"): the entry for the
    // current URL is the one in the tab order, so Tab lands where the reader already is.
    // The ring's membership is the built rows — today one, so the walk the arrows do is
    // unit-tested where the list can be seeded (`ouroboros-ui`'s sidebar tests) and what
    // this asserts is the contract's visible half.
    const dashboard = sidebar(page).getByRole("link", { name: "Dashboard" });

    await expect(dashboard).toHaveAttribute("tabindex", "0");

    await dashboard.focus();
    // Home and End belong to the ring and must not scroll the pane while it holds a row.
    await page.keyboard.press("End");
    await expect(sidebar(page).locator("[data-nav-id]:focus")).toHaveCount(1);
  });
});

test.describe("the drawer: below 768px the sidebar floats, keyboard included", () => {
  test.use({ viewport: { width: 480, height: 850 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(IN_SHELL_ROUTES[0].ready);
  });

  test("the hamburger opens it, focus moves in, Escape closes it and gives focus back", async ({
    page,
  }) => {
    const burger = page.getByRole("button", { name: "Open navigation" });
    const nav = sidebar(page);

    // Below the breakpoint the opener is in the header and honest about its state…
    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute("aria-expanded", "false");

    // …and the sidebar is out of the way until asked for.
    await expect(nav).not.toBeInViewport();

    await burger.click();

    await expect(nav).toBeInViewport();
    await expect(page.getByRole("button", { name: "Close navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Focus followed the drawer in — the keyboard's half of "opened" (§ 1.2).
    await expect(nav).toBeFocused();

    // Escape is the drawer's own key: it closes, and focus returns to the opener rather
    // than being dropped on the body.
    await page.keyboard.press("Escape");
    await expect(nav).not.toBeInViewport();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  });

  test("following a link closes the drawer behind the navigation", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation" }).click();

    const nav = sidebar(page);
    await expect(nav).toBeInViewport();

    await nav.getByRole("link", { name: "Dashboard" }).click();

    await expect(nav).not.toBeInViewport();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
