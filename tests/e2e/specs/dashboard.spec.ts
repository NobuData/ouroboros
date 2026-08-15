/**
 * Leg 6 — *mockup 02, against the rows the seed wrote; and the truth about a workspace with
 * no rows at all* ([#88](https://github.com/NobuData/ouroboros/issues/88), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * #56's dashboard assertion was *shows the seeded tenant*, and it predates the dashboard: it
 * was written when the route drew a workspace name and a placeholder grid. Every card on that
 * grid is now drawn from a read model
 * ([#80](https://github.com/NobuData/ouroboros/issues/80)–[#87](https://github.com/NobuData/ouroboros/issues/87)),
 * and the MVP claim of the dashboard roadmap is specific enough that only an end-to-end leg
 * can hold both halves of it at once:
 *
 * > the page reproduces mockup 02 against seeded data **and** tells the truth when there is
 * > no data.
 *
 * The two halves are the same page in two workspaces, which is why this file switches
 * organizations rather than users: `acme-robotics` has fifty-three runs, twelve queue items
 * and a day of token spend behind it, and `kensuenobu` — the personal workspace #704 gives
 * everybody at first sign-in — deliberately has **no row in any of the four read-model
 * tables**. Every zero state on this page is therefore a *workspace*, not a fixture.
 *
 * ## What only this leg can see
 *
 * Each card has thorough unit coverage in `ouroboros-ui`, and every one of those tests hands
 * the card a payload. What none of them can answer is whether the figure on the tile is the
 * figure in PostgreSQL — between the two sit Flyway's seed, the aggregate's arithmetic
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)), an `ETag`, a Server Component
 * render and a stylesheet that has to have shipped. This leg walks that chain once per
 * surface:
 *
 *   * the **stat row**, whose four figures are four different aggregations;
 *   * the **active-loops table**, whose *order* is the endpoint's `array_position` sort and
 *     whose meters are the only derived figure on the page;
 *   * the **pulse card**, whose bars are ratios against denominators this product chose;
 *   * the **auto-merge switch**, the one control here that writes — asserted as a round trip
 *     through `PATCH`, a re-read and a reload, because a switch that moves and does not
 *     persist is the failure mode that matters;
 *   * the **queue card**, and every effort chip the design system publishes;
 *   * the **shell** around all of it: four regions of which exactly one scrolls, the sidebar
 *     entry that knows where the reader is, and the whole page at the 125% font scale § 4
 *     gives every reader;
 *   * **both palettes**, screenshot-diffed.
 *
 * Signing in was parked until [#647](https://github.com/NobuData/ouroboros/issues/647)
 * composed the e2e override over the stack — `support/session.ts` carries that history —
 * so this file, written finished under `test.fixme`, now simply runs.
 *
 * ## The classes this file names, and why it names them
 *
 * Most of what follows is addressed the way a reader addresses it — a region by its heading,
 * a table by its caption, a bar by its accessible name. Four things on this page have no
 * role at all, because they are figures rather than controls: a stat tile's value and the
 * line under it, a stage meter's fill, an effort chip. Those are addressed by the class the
 * page's own stylesheet gives them. This product has **no test ids** by design — nothing in
 * `ouroboros-ui/app` carries one — and inventing a set for the suite that gates the release
 * would put a second, private contract beside the one the design system already publishes.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  EMPTY_STATES,
  NOT_READ_DASH,
  SEEDED_ACTIVE_LOOPS,
  SEEDED_AUTO_MERGE,
  SEEDED_FLIGHT_SENTENCE,
  SEEDED_PULSE,
  SEEDED_QUEUE,
  SEEDED_QUEUE_BEYOND_HEAD,
  SEEDED_STATS,
} from "../support/dashboard";
import { SEED_OWNER, SEED_PERSONAL_TENANT, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreAutoMerge,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { selectWorkspace } from "../support/workspace";

/**
 * The name the page head greets by — the *first* word of the display name.
 *
 * A greeting uses the name somebody is called, and the session carries the one they
 * registered with (`app/dashboard/view.ts`, `firstName`).
 */
const GREETED_NAME = SEED_OWNER.displayName.split(" ")[0] ?? SEED_OWNER.displayName;

/**
 * Sign in, enter a workspace, and land on its dashboard.
 *
 * The three steps are one call because no leg in this file is *about* any of them:
 * `specs/sign-in.spec.ts` earns the workspace the way a person does, by reading the list and
 * pressing the button, and repeating that flow here would spend the suite's budget proving
 * the same thing six more times.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param slug - Which workspace to land in.
 * @returns When the dashboard has rendered its page head, so that a test's first assertion is
 *   about the page rather than about whether it arrived.
 */
async function enterDashboard(context: BrowserContext, page: Page, slug: string): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, slug);
  await page.goto("/dashboard");

  // The greeting is client-rendered from the reader's own clock, so waiting for it to name
  // somebody is also waiting for hydration — which every interactive assertion below needs
  // and which none of them should have to wait for itself.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(GREETED_NAME);
}

/** The dashboard, as a landmark — everything a test asserts on is inside it. */
function dashboard(page: Page): Locator {
  return page.getByRole("main");
}

/**
 * One tile of the stat row, by its caption.
 *
 * The caption is the tile's accessible name (`app/dashboard/stat-card.tsx` renders a
 * `<section aria-label>` for exactly this reason), so a reader and a test find it the same
 * way.
 *
 * @param page - The page.
 * @param label - The tile's caption.
 * @returns The tile.
 */
function statTile(page: Page, label: string): Locator {
  return page.getByRole("region", { name: label });
}

/**
 * How full a meter is drawn, read off the one inline style on this page.
 *
 * `app/ui/meter.tsx` passes the width as the custom property `--ou-meter-fill` rather than as
 * a `width` declaration, so that the stylesheet still owns the property and the only thing
 * written at the call site is the datum. That makes the datum readable, which is what this
 * is: the *stage* meters are decoration beside a caption that already says `4/6` in words, so
 * unlike the pulse card's bars they carry no `progressbar` role to ask.
 *
 * @param meter - The meter's fill element.
 * @returns The percentage, as the component wrote it — `66%`.
 */
function meterFill(meter: Locator): Promise<string> {
  return meter.evaluate((element) => element.style.getPropertyValue("--ou-meter-fill").trim());
}

/**
 * How wide something actually is on screen, in CSS pixels.
 *
 * A laid-out element is the premise of every measurement this file makes, so an element that
 * has no box at all fails here — naming the thing that was not drawn — rather than three
 * lines later as a division by an absent number.
 *
 * @param element - What to measure.
 * @param what - What it is, for the failure message.
 * @returns Its width.
 */
async function widthOf(element: Locator, what: string): Promise<number> {
  const box = await element.boundingBox();

  expect(box, `${what} must be laid out to be measured`).not.toBeNull();

  return box?.width ?? 0;
}

test.describe("the dashboard renders the seeded workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterDashboard(context, page, SEED_TENANT.slug);
  });

  test("the page head greets the reader and says what the loop is doing", async ({ page }) => {
    // The daypart is the *browser's* (decision F7), so the word is the one thing here this
    // suite cannot pin — a stack driven at 09:00 and at 21:00 must both pass. What is
    // asserted is everything else: that a daypart arrived at all rather than the neutral
    // server greeting, that it named the person the *service* authenticated, and that the
    // closing clause is the one a workspace with three runs in flight earns.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      new RegExp(`^Good (morning|afternoon|evening), ${GREETED_NAME} — the loop is turning\\.$`),
    );

    // The subline's first sentence is the aggregate's `activity`, and it is the same two
    // counts the first two tiles draw arriving by a second route: a page where they disagree
    // is a page assembled from two different reads of one workspace.
    await expect(dashboard(page)).toContainText(SEEDED_FLIGHT_SENTENCE);

    // The second sentence counts what merged *since midnight UTC*, which depends on the hour
    // the stack came up — so its shape is what is asserted, and the boundary it names. The
    // page deliberately does not say "this morning": the token spend beside it is measured
    // from the same boundary, and the two must not mean different mornings.
    await expect(dashboard(page)).toContainText(/since midnight UTC\./);
  });

  test("the four stat tiles carry the seeded figures", async ({ page }) => {
    for (const stat of SEEDED_STATS) {
      const tile = statTile(page, stat.label);

      await expect(tile.locator(".dash-stat__value"), stat.label).toHaveText(stat.value);
      await expect(tile.locator(".dash-stat__delta"), stat.label).toHaveText(stat.detail);
    }

    // Four tiles and no more: a fifth would be a figure nobody has agreed on, and the row is
    // built from a fixed list precisely so a refused aggregate keeps its shape.
    await expect(dashboard(page).locator(".dash-stat")).toHaveCount(SEEDED_STATS.length);
  });

  test("the active-loops table draws the three runs in lifecycle order", async ({ page }) => {
    const table = page.getByRole("table", { name: "Loops running right now" });
    const rows = table.locator("tbody tr");

    await expect(rows).toHaveCount(SEEDED_ACTIVE_LOOPS.length);

    for (const [index, run] of SEEDED_ACTIVE_LOOPS.entries()) {
      const row = rows.nth(index);
      const where = `${run.issue} (row ${index + 1})`;

      // The order is the endpoint's — `array_position` over the active statuses, oldest first
      // within a stage — so asserting position by position is asserting that sort. A client
      // that re-sorted its rows would produce a different order from the drill-in.
      await expect(row, where).toContainText(run.issue);
      await expect(row, where).toContainText(run.title);
      await expect(row, where).toContainText(run.workflowTag);
      await expect(row, where).toContainText(run.stage);

      // The model is an opaque identifier (decision F8) — drawn, never parsed into a vendor
      // and a version — so the assertion is the whole string the row was given.
      await expect(row.getByText(run.model, { exact: true }), where).toBeVisible();

      // The status pill. `needs human` is the only status whose word differs from the
      // contract's spelling, and none of the three here is it.
      await expect(row.getByText(run.status, { exact: true }), where).toBeVisible();

      // Elapsed counts from `started_at` and is a second older every second, so its shape is
      // the assertion: a real duration, zero-padded after the leading part, rather than the
      // em dash a row with an unreadable timestamp would carry.
      await expect(row.locator(".ou-table__cell--mono"), where).toHaveText(
        /^\d+m \d{2}s$|^\d+h \d{2}m \d{2}s$/,
      );
    }

    // The head's *live* pill, which is drawn only when something is actually running — a
    // one-word summary over an empty table would contradict the six columns underneath it.
    await expect(
      page.getByRole("region", { name: "Active loops" }).getByText("live"),
    ).toBeVisible();
  });

  test("each stage meter is drawn to the stage its run has reached", async ({ page }) => {
    const rows = page.getByRole("table", { name: "Loops running right now" }).locator("tbody tr");

    for (const [index, run] of SEEDED_ACTIVE_LOOPS.entries()) {
      const fill = rows.nth(index).locator(".ou-meter__fill");

      // The datum: `stagePercent` rounds down, so `4/6` is 66% and only a run on its last
      // step reaches 100%. This is the one derived figure in the table.
      expect(await meterFill(fill), `${run.issue} fill`).toBe(run.meter);

      // And the drawing of it. A custom property with no stylesheet behind it would leave
      // three bars of identical width, which is the failure no unit test of this card can
      // see — so the *rendered* width is measured against its own track as well.
      const drawn = await widthOf(fill, `${run.issue}'s bar`);
      const track = await widthOf(rows.nth(index).locator(".ou-meter"), `${run.issue}'s track`);

      expect(drawn / track, `${run.issue} bar width`).toBeCloseTo(
        Number.parseFloat(run.meter) / 100,
        1,
      );
    }
  });

  test("the pulse card reports the three seeded rates", async ({ page }) => {
    const card = page.getByRole("region", { name: "Loop pulse" });

    for (const meter of SEEDED_PULSE) {
      // The bar is the announced one here — it carries the figure in words for a reader who
      // cannot see the number beside it — so it is addressed by its accessible name.
      const bar = card.getByRole("progressbar", { name: meter.label });

      await expect(bar, meter.label).toHaveAttribute("aria-valuenow", String(meter.fill));
      await expect(card.getByText(meter.value, { exact: true }), meter.label).toBeVisible();
    }

    // The merge rate is measured over fourteen days and the other two over seven, so each row
    // prints its own window: the head's `7 days` tag would otherwise speak for a figure it
    // does not cover, which is the one thing on this card that would be quietly wrong.
    await expect(card.getByText("14 days")).toBeVisible();
    await expect(card.getByText("7 days")).toHaveCount(3);

    // Nothing is drawn as unmeasured: this workspace has closed fifty runs.
    await expect(card).not.toContainText(EMPTY_STATES.pulse);
  });

  test("the queue card draws the head of the queue, with every effort chip", async ({ page }) => {
    const card = page.getByRole("region", { name: "Up next in queue" });
    const rows = card.getByRole("listitem");

    await expect(rows).toHaveCount(SEEDED_QUEUE.length);

    for (const [index, item] of SEEDED_QUEUE.entries()) {
      const row = rows.nth(index);
      const where = `${item.issue} (position ${index + 1})`;

      // Queue order, which is the endpoint's `order by position` — the point of the card.
      await expect(row, where).toContainText(item.issue);
      await expect(row, where).toContainText(item.title);
      await expect(row.locator(".ou-chip--effort"), where).toHaveText(item.effort);
      await expect(row, where).toContainText(item.workflowTag);
    }

    // All five sizes the design system publishes appear across the five rows. The seed is
    // built that way on purpose — it is the criterion the `CHECK` on `queue_items.effort`
    // exists for — so this asserts the whole scale renders rather than that one chip does.
    expect(new Set(await card.locator(".ou-chip--effort").allTextContents())).toEqual(
      new Set(SEEDED_QUEUE.map((item) => item.effort)),
    );

    // The card draws a slice and the tile counts the whole, so the footer is the difference
    // between two separately true figures rather than a flag on the slice.
    await expect(card.getByRole("button", { name: SEEDED_QUEUE_BEYOND_HEAD })).toBeVisible();
  });
});

/**
 * The page's one write, in a group of its own.
 *
 * Not because the assertion needs isolating but because the **teardown** does. The switch is
 * a row keyed on the workspace, so a run that fails halfway through the round trip leaves the
 * seed's position behind and the next run starts from the wrong one — which means the restore
 * has to be a hook rather than the test's own last line, and a hook belongs to a group. This
 * one, where it runs for the only test that writes.
 */
test.describe("the dashboard's one control writes", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterDashboard(context, page, SEED_TENANT.slug);
  });

  test.afterEach(async ({ context }) => {
    await restoreAutoMerge(context, SEEDED_AUTO_MERGE);
  });

  test("the auto-merge switch round-trips as the owner", async ({ page }) => {
    const control = page.getByRole("switch", {
      name: "Merge pull requests automatically when checks pass",
    });

    // The seed says this workspace has answered yes, and it is the position mockup 02 draws.
    // It is also the position the switch must be *read* from rather than defaulted to — a
    // dashboard that could not read the aggregate draws an em dash here instead.
    await expect(control).toBeChecked();
    await expect(control).not.toHaveAttribute("aria-disabled", "true");

    await control.click();

    // The switch moves optimistically and the transition holds that position until the route
    // has re-rendered from a fresh aggregate — so a switch still off *after* the refresh is
    // the server's answer rather than this browser's guess.
    await expect(control).not.toBeChecked();

    // The half that matters. An optimistic control that never persisted would look identical
    // to a working one until the page was loaded again, and this is that load: a fresh
    // request, a fresh aggregate, and the position that came out of `workspace_settings`.
    await page.reload();
    await expect(control).not.toBeChecked();

    await control.click();
    await expect(control).toBeChecked();

    await page.reload();
    await expect(control).toBeChecked();
  });
});

test.describe("the dashboard tells the truth about an empty workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterDashboard(context, page, SEED_PERSONAL_TENANT.slug);
  });

  test("the page head says what would start the loop, not that nothing is wrong", async ({
    page,
  }) => {
    // The closing clause is a fact read from the aggregate rather than a flourish: three runs
    // in flight makes the loop turning, and none makes it idle.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      EMPTY_STATES.greetingClause,
    );
    await expect(dashboard(page)).toContainText(EMPTY_STATES.subline);
  });

  test("the four tiles read zero, and say why rather than showing an em dash", async ({ page }) => {
    for (const stat of EMPTY_STATES.stats) {
      const tile = statTile(page, stat.label);

      await expect(tile.locator(".dash-stat__value"), stat.label).toHaveText(stat.value);
      await expect(tile.locator(".dash-stat__delta"), stat.label).toHaveText(stat.detail);
    }
  });

  test("every card draws its designed empty state", async ({ page }) => {
    const empties = [
      ["Active loops", EMPTY_STATES.activeLoops],
      ["Recently closed by the loop", EMPTY_STATES.recentlyClosed],
      ["Up next in queue", EMPTY_STATES.queue],
      ["Loop pulse", EMPTY_STATES.pulse],
    ] as const;

    for (const [card, sentence] of empties) {
      await expect(page.getByRole("region", { name: card }), card).toContainText(sentence);
    }

    // No table has a row and no queue item was invented: an empty state beside a row would
    // be a card drawing both of its states at once.
    await expect(dashboard(page).locator("tbody tr")).toHaveCount(0);
    await expect(dashboard(page).getByRole("listitem")).toHaveCount(0);
  });

  test("nothing on the page is fabricated", async ({ page }) => {
    // The card grid rather than the whole page, and the distinction is the assertion's own:
    // the em dash below is a *figure* on a card, and the page head two lines above the grid
    // uses one as punctuation — "Good evening, Ken — the loop is idle." A check over the
    // whole of `main` would fail on the greeting's grammar and prove nothing about the cards.
    const cards = dashboard(page).locator(".dash-grid");

    // The em dash is what a card draws when a figure **could not be read**. A workspace that
    // has simply never run anything must not draw it: *nothing has happened* and *nobody
    // could ask* are different facts, and #86's whole rule is that they may not render
    // alike. This is the assertion that keeps the two apart end to end.
    await expect(cards).not.toContainText(NOT_READ_DASH);

    // Nor any of the mockup's own issue numbers, which are the fiction this page is drawn
    // from: `#4xx` on an empty workspace would be a card falling back to the artwork.
    await expect(cards).not.toContainText(/#4\d\d/);

    // And nothing is *broken*, which is the other half of the same claim. The system card
    // reads the two probes rather than the workspace, so it reports the same thing here as
    // in the seeded workspace — an empty workspace is not a degraded one.
    await expect(page.getByRole("region", { name: "System" })).toContainText("operational");
  });
});

test.describe("the shell holds the dashboard", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterDashboard(context, page, SEED_TENANT.slug);
  });

  test("the header and the sidebar do not move when the content pane scrolls", async ({ page }) => {
    const header = page.getByRole("banner");
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    // The pane declares itself with an attribute rather than a class, precisely so a check
    // like this one keeps meaning *the scroll container* — `app/shell/regions.ts` says why.
    const pane = page.locator("[data-shell-pane]");

    const before = {
      header: await header.boundingBox(),
      sidebar: await sidebar.boundingBox(),
    };

    // The premise. A dashboard that fitted the viewport would make everything below this
    // vacuously true, so the overflow is asserted rather than assumed.
    const scrollable = await pane.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(
      scrollable,
      "the dashboard must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Four regions of which exactly one scrolls (design system § 1, decision S2). Nothing in
    // the shell is `position: fixed` — the header and the sidebar are cells of a grid that is
    // the viewport's height — so this is the assertion that the *grid* survived the page.
    expect(await header.boundingBox()).toEqual(before.header);
    expect(await sidebar.boundingBox()).toEqual(before.sidebar);

    // The document itself never scrolls: the lock in `app/globals.css` is what makes the pane
    // the only scroll container rather than the second one.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the sidebar knows the reader is on the dashboard", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const entry = sidebar.getByRole("link", { name: "Dashboard" });

    await expect(entry).toHaveAttribute("aria-current", "page");

    // Exactly one entry claims it. Two would make the sidebar's answer to *where am I* a
    // matter of which one the reader looked at first.
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const html = page.locator("html");

    // The preference is the *person's* and lives on the server, so this is the whole round
    // trip: `app/shell/font-scale-sync.tsx` reads it back when the session loads and stamps
    // the attribute, and one of the five `:root[data-font-scale]` rules turns that into a
    // root size. The attribute alone would prove only that the preference was read.
    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // The shell is what a fifth more type actually tests. Its four regions are laid out in
    // `rem`, so a header that grew into the pane or a sidebar that pushed the grid sideways
    // would show here and nowhere else.
    const pane = page.locator("[data-shell-pane]");

    // CP.5's audit, at the size that breaks it: nothing may make the pane scroll sideways.
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // And the page is still the dashboard rather than a shell around a broken render.
    await expect(statTile(page, "Loops live").locator(".dash-stat__value")).toHaveText("3");
  });

  // The scale is a row keyed on the person and outlives this context. Restored in teardown so
  // that a failed assertion above does not hand the next leg — and the next run's screenshot
  // baselines — a page a fifth larger than the one they were written against. It runs after
  // all three tests rather than only the one that writes, because putting a preference back
  // where it already is costs one request and is the version of this hook nobody has to keep
  // in step with which test does what.
  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });
});

test.describe("the dashboard is drawn in both palettes", () => {
  /**
   * What a screenshot must not be taken of.
   *
   * Two things on this page are honestly different in every render, and masking them is what
   * makes the rest of it comparable rather than what hides a failure:
   *
   *   * the **greeting**, whose daypart is the reader's own clock — a baseline recorded in
   *     the afternoon would fail every morning;
   *   * the **Elapsed** column, which counts from each run's `started_at` and is a second
   *     older by the time the shutter closes.
   *
   * Both are asserted *as text* by the seeded group above, at the precision they can honestly
   * be asserted at. What is left under the mask is what a screenshot is actually for: the
   * grid, the type, the chrome and the palette.
   */
  function volatile(page: Page): Locator[] {
    return [
      page.getByRole("heading", { level: 1 }),
      page.getByRole("table", { name: "Loops running right now" }).locator(".ou-table__cell--mono"),
    ];
  }

  test.beforeEach(async ({ context, page }) => {
    await enterDashboard(context, page, SEED_TENANT.slug);
  });

  /**
   * Pin a palette through the account menu's theme radios (`app/shell/user-menu.tsx` —
   * CP.3's control), and close the menu so the shutter sees the page rather than the
   * panel. A fresh context has stored no choice and starts at *system*; pinning is what
   * makes the two baselines a comparison of palettes rather than of whatever the
   * runner's OS happened to prefer.
   */
  async function pinTheme(page: Page, choice: "Light" | "Dark"): Promise<void> {
    await page.getByRole("button", { name: /^Account menu/ }).click();

    const menu = page.getByRole("menu", { name: "Account" });

    await menu.getByRole("menuitemradio", { name: choice }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", choice.toLowerCase());

    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
  }

  test("light and dark are both the dashboard", async ({ page }) => {
    await pinTheme(page, "Light");
    await expect(page).toHaveScreenshot("dashboard-light.png", { mask: volatile(page) });

    await pinTheme(page, "Dark");
    await expect(page).toHaveScreenshot("dashboard-dark.png", { mask: volatile(page) });
  });
});
