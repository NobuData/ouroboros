/**
 * Leg 11 — *mockup 03, and the one flow on it that crosses every service in the stack*
 * ([#121](https://github.com/NobuData/ouroboros/issues/121), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * `/issues` has thorough coverage on both sides of every boundary it crosses. `ouroboros-rest`
 * proves the listing's sorts, the queue's three refusals and the estimation pipeline against
 * a stubbed engine; `ouroboros-ui` proves every card against a payload; `ouroboros-engine`
 * proves `heuristic-v0` row by row against the mockup's own table. All of that can be green
 * while the page does the wrong thing, because the interesting behaviours here **are**
 * boundaries: a press of **Re-estimate** is UI → REST → PostgreSQL → engine → PostgreSQL →
 * a poll → a pill, and a press of **Queue** ends on a different page drawn by a different
 * read model.
 *
 * ## The two assertions this leg exists for
 *
 *   * **Queue → dashboard.** The intake roadmap's decision K9 left the dashboard's queue card
 *     read-only and handed the write to this screen. Nothing else in the repository can see
 *     both halves at once: the write is one service's transaction, the card is another
 *     read model's aggregate, and the only place they meet is a running stack. The queue leg
 *     below presses the button on `/issues`, follows the toast's own link, and reads the
 *     *dashboard page* — the tile, its summed estimate, the card's footer, and the five head
 *     rows that must **not** have moved — never the queue API.
 *   * **Re-estimate → engine → panel.** A press must produce a *new version* from the real
 *     rule engine in the real engine container, and the panel must draw it from its poll
 *     rather than from a reload. `scripts/verify-failure-modes.sh` stops the engine and
 *     requires exactly this test to go red naming `needs human`, which is what the
 *     orchestrator writes when the engine does not answer twice.
 *
 * The other legs are the same argument at lower stakes: **parity** for the head, the nine
 * rows and the `#485` panel against the seed; the **filter bar** as a query-string editor,
 * round-tripped through a reload of the address it wrote; the **guidance** path in the
 * personal workspace; **both palettes**, and the shell assertions every page leg carries.
 *
 * ## Four deliberate divergences from the ticket's own words, and why
 *
 * **The three selected issues are refused, and one is queued.** The ticket says *select
 * three → combined estimate → queue → assert the dashboard queue card gained rows*. The seed
 * cannot let three through, and says so in its own header: of the three `sized` issues no
 * queue row names, `#487` and `#489` share their numbers with issues already queued from two
 * *other* repositories, and `queue_items` is unique on `(organization_id, issue_number)` by
 * design (V009). So the press is refused with a dialog naming exactly those two — which is
 * N.4's designed outcome, exercised here for the first time against a real refusal — the
 * reader deselects them, and `#484` is queued. Every step the ticket lists is walked; the
 * queue takes what the fixture lets it take.
 *
 * **"Gained rows" is a tile, an estimate and a footer, and five rows that stayed put.** The
 * card draws the *head* of the queue (positions 1–5) and the seed already queues twelve, so
 * a thirteenth item joins the tail and is not a row on the card. What the dashboard page
 * honestly shows is the *Queued issues* count moving from 12 to 13, its summed estimate
 * moving by the queued issue's own minutes, and the footer from `+7` to `+8` — while the
 * five head rows are still the seed's, which is the assertion that a queue appends.
 *
 * **The live `estimating…` is asserted where the seed holds it still.** The ticket says
 * *trigger, observe `estimating…`, observe `sized`*. A rule engine answers in milliseconds,
 * and whether the browser sees the claim is a race between two round trips: the refresh the
 * panel asks for on the `202` against the pipeline's own context resolution and engine
 * call. It was observed landing on `estimating…` while this leg was written, and it will not
 * land there every time — and this suite runs with `retries: 0` on purpose. So the transient
 * state is asserted on `#483`, the mockup's own `estimating…` row, which the seed writes with
 * no estimate and the compose override keeps the recovery sweep away from
 * (`docker-compose.e2e.yml`); and the live flow is asserted on what it leaves behind — a
 * version the panel did not have before the press, a `sized_at` seconds old, and a page that
 * was never reloaded — inside the page's own promise of *one poll*.
 *
 * **The guidance state is *no token*, not *no repos*.** N.6's shipped note corrected the
 * ticket: the personal workspace has two enabled repositories and no token, so M.4 answers
 * `not_configured` and the honest guidance is the no-token one. That is the state asserted,
 * in both palettes.
 *
 * ## What this leg leaves behind, and what that costs
 *
 * Two writes here have **no undo on the API**: a queue row (`GET /api/v1/queue` is
 * deliberately read-only) and an estimate version (versions are append-only by K4). The
 * tenants leg set the rule for this — *this leg cannot clean up after itself and does not
 * pretend to* — and this leg follows it with two mitigations. The re-estimated issue is
 * `#487`, chosen because the rule engine reproduces its seeded row exactly, so the table's
 * parity survives the write (`support/issues.ts` § re-estimate). The queue row cannot be made
 * harmless the same way: a second run against the same volume finds `#484` already queued and
 * the dashboard's count at thirteen, and is red at parity **by design** until the volume is
 * dropped — `docker compose down -v`, which is also where the README's baseline procedure
 * begins. CI always starts cold.
 *
 * ## The classes this file names
 *
 * As the dashboard leg argues: this product has no test ids, so a figure that has no role —
 * a cell's chip, a trace line, the bar's estimate — is addressed by the class the page's own
 * stylesheet gives it, and everything that has a role is addressed by it.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import { SEEDED_QUEUE } from "../support/dashboard";
import {
  CHECK_AGAIN_LABEL,
  DASHBOARD_AFTER_QUEUE,
  EMPTY_ARRIVAL,
  ESTIMATING_ISSUE,
  FILTER_BAR_LABEL,
  GUIDANCE,
  ISSUES_EYEBROW,
  ISSUES_PATH,
  ISSUES_SUBLINE,
  LABEL_FACETS,
  NEVER_SYNCED,
  NO_MATCHES,
  ONE_POLL_MS,
  PANEL_TITLE,
  PILL,
  QUEUE_LEG,
  REESTIMATE,
  ROUND_TRIP,
  SEEDED_ARRIVAL,
  SEEDED_BACKLOG,
  SEEDED_DETAIL,
  SEEDED_HEADLINE,
  SEEDED_REPOS,
  SIZING,
  SYNC_PAUSED_NO_TOKEN,
  TABLE_CAPTION,
  TABLE_TITLE,
  UNESTIMATED,
  issuesPath,
  seededIssue,
} from "../support/issues";
import { SEED_OWNER, SEED_PERSONAL_TENANT, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { PANE_SELECTOR } from "../support/shell";
import { UI_URL } from "../support/stack";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The table's columns, by position — the checkbox first, then the mockup's five. */
const COLUMN = { issue: 1, effort: 2, workflow: 3, model: 4, status: 5 } as const;

/**
 * Wait for the issues screen to be one page, in the workspace it should be in.
 *
 * The page's `<h1>` is on the first byte, and that proves nothing about hydration: the route
 * has a `loading.tsx`, so the segment streams into a hidden `<div>` behind a Suspense boundary
 * and the document holds two `<main class="issues">` until React relocates one — the routing
 * leg found the same shape and argues it at length. Role locators ignore the hidden copy and
 * `getByText` does not, so every interactive assertion waits here for the count to reach one.
 *
 * The head is matched on its *open* count only. The sized count is the one figure on this
 * page that the leg's own writes can move — an estimate that failed under a stopped engine is
 * a `needs_human` row and one fewer *already sized* — and a barrier that pinned it would turn
 * every test after that failure red for a derived reason. The exact sentence is the parity
 * group's assertion, made once, where it means something.
 *
 * @param page - The page.
 * @param arrival - The shape the head must have once it has rendered.
 * @returns When the page is one page.
 */
async function settled(page: Page, arrival: RegExp): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(arrival);
  await expect(page.locator("main.issues")).toHaveCount(1);
}

/**
 * Sign in, enter a workspace, and land on its issues screen.
 *
 * One call because no test in this file is *about* any of the three steps — the sign-in leg
 * earns the workspace the way a person does, and repeating it here would spend the budget
 * proving the same thing eighteen more times.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param options.workspace - Which workspace to land in. The seeded demo one by default.
 * @param options.search - A query string for the address, `?` included.
 * @returns When the page has rendered and hydrated.
 */
async function enterIssues(
  context: BrowserContext,
  page: Page,
  options: { readonly workspace?: string; readonly search?: string } = {},
): Promise<void> {
  const { workspace = SEED_TENANT.slug, search = "" } = options;

  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, workspace);
  await page.goto(issuesPath(search));

  await settled(page, workspace === SEED_PERSONAL_TENANT.slug ? EMPTY_ARRIVAL : SEEDED_ARRIVAL);
}

/** The screen, as a landmark. */
function screen(page: Page): Locator {
  return page.getByRole("main");
}

/** The filter bar — a region named by its own label. */
function filterBar(page: Page): Locator {
  return page.getByRole("region", { name: FILTER_BAR_LABEL });
}

/** The table card, by its heading. */
function tableCard(page: Page): Locator {
  return page.getByRole("region", { name: TABLE_TITLE });
}

/**
 * The backlog, as a grid.
 *
 * A `grid` rather than a `table`, for the reason the routing leg gives: `app/ui/table.tsx`
 * declares the role only when it is given a selection, so asking for it is itself an assertion
 * that the rows are checkable.
 */
function grid(page: Page): Locator {
  return page.getByRole("grid", { name: TABLE_CAPTION });
}

/**
 * One row of the backlog, by its number.
 *
 * By the number's cell rather than by index, so a failure names the issue a reader would name
 * and a table that lost a row fails on that row rather than on the one that took its place.
 *
 * @param page - The page.
 * @param number - GitHub's number.
 * @returns The `<tr>`.
 */
function row(page: Page, number: number): Locator {
  return grid(page)
    .locator("tbody tr")
    .filter({ has: page.getByText(`#${String(number)}`, { exact: true }) });
}

/** The cells of a row, in column order. */
function cells(of: Locator): Locator {
  return of.locator("td");
}

/** The status pill of a row. */
function pillOf(page: Page, number: number): Locator {
  return cells(row(page, number)).nth(COLUMN.status).locator(".ou-chip");
}

/** The detail card, by its heading. */
function panel(page: Page): Locator {
  return page.getByRole("region", { name: PANEL_TITLE });
}

/** The status chip beside the detail card's title — the open issue's pill. */
function panelPill(page: Page): Locator {
  return panel(page).locator(".ou-card__head .ou-chip");
}

/** The *AI Work Breakdown* section of the panel. */
function breakdown(page: Page): Locator {
  return panel(page).getByRole("region", { name: "AI Work Breakdown" });
}

/** The trace's lines — the provenance first, the signals last. */
function traceLines(page: Page): Locator {
  return panel(page).locator(".issues-panel__trace-line");
}

/**
 * Open an issue's detail the way a reader does — a click on the row, off its checkbox — and
 * wait for the panel to name it.
 *
 * @param page - The page.
 * @param number - GitHub's number.
 * @returns When the panel's meta line carries the number, which it does from the click
 *   onward: the head is drawn from the row before the detail arrives.
 */
async function openIssue(page: Page, number: number): Promise<void> {
  await row(page, number).locator(".issues-table__title").click();
  await expect(panel(page).locator(".issues-panel__meta")).toContainText(`#${String(number)}`);
}

/**
 * Assert the grid draws exactly these rows, in this order.
 *
 * @param page - The page.
 * @param numbers - GitHub's numbers, top to bottom.
 * @returns When the count and every position agree.
 */
async function expectRows(page: Page, numbers: readonly number[]): Promise<void> {
  await expect(grid(page).locator("tbody tr .issues-table__number")).toHaveText(
    numbers.map((number) => `#${String(number)}`),
  );
}

/**
 * Assert a control is inert, and says why.
 *
 * `app/ui/button.tsx`'s only way to switch a button off: `aria-disabled` with the reason as
 * the tooltip, so the explanation stays in the tab order.
 *
 * @param control - The button.
 * @param reason - The sentence it must carry.
 * @returns When both attributes agree.
 */
async function expectInert(control: Locator, reason: string): Promise<void> {
  await expect(control).toHaveAttribute("aria-disabled", "true");
  await expect(control).toHaveAttribute("title", reason);
}

/* ------------------------------------------------------------------ parity */

test.describe("the issues screen draws the seeded backlog", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterIssues(context, page);
  });

  test("the page head is the mockup's sentence over the seed's figures", async ({ page }) => {
    const head = screen(page).locator(".issues__head");

    await expect(head).toContainText(ISSUES_EYEBROW);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED_HEADLINE);
    await expect(head).toContainText(ISSUES_SUBLINE);

    // The backlog was counted, so nothing under the headline explains that it was not.
    await expect(head.locator(".issues__unread")).toHaveCount(0);

    // The two actions, in their real positions. The owner may re-estimate — nine issues is a
    // number the confirmation can state — and the primary action reflects an empty selection
    // by saying where one is made rather than by disappearing.
    await expect(page.getByRole("button", { name: "Re-estimate all" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expectInert(
      page.getByRole("button", { name: "Queue 0 selected ⟳" }),
      GUIDANCE.queueReason,
    );
  });

  test("the table draws the nine rows in effort order, with every cell the seed implies", async ({
    page,
  }) => {
    await expect(grid(page).locator("tbody tr")).toHaveCount(SEEDED_BACKLOG.length);

    for (const [index, issue] of SEEDED_BACKLOG.entries()) {
      const where = `#${String(issue.number)} (row ${String(index + 1)})`;
      const line = cells(grid(page).locator("tbody tr").nth(index));

      // The order is M.1's `sort=effort` and the seed promises it is total, so position by
      // position is the assertion — a client that re-sorted its page would draw another.
      await expect(line.nth(COLUMN.issue).locator(".issues-table__number"), where).toHaveText(
        `#${String(issue.number)}`,
      );
      await expect(line.nth(COLUMN.issue).locator(".issues-table__title"), where).toHaveText(
        issue.title,
      );
      await expect(line.nth(COLUMN.issue).locator(".ou-tag"), where).toHaveText([...issue.labels]);

      if (issue.effort === null) {
        // The mid-flight row: the mockup's placeholder in the effort cell, and the design
        // system's em dash — never an invented tag or model — in the two cells an estimate
        // would fill. The seed's own header records the same decision from the data's side.
        await expect(line.nth(COLUMN.effort), where).toHaveText(SIZING);
        await expect(line.nth(COLUMN.workflow), where).toHaveText(UNESTIMATED);
        await expect(line.nth(COLUMN.model), where).toHaveText(UNESTIMATED);
      } else {
        await expect(line.nth(COLUMN.effort).locator(".ou-chip--effort"), where).toHaveText(
          issue.effort,
        );
        await expect(line.nth(COLUMN.effort).locator(".issues-table__conf"), where).toHaveText(
          issue.confidence ?? "",
        );
        await expect(line.nth(COLUMN.workflow).locator(".ou-tag"), where).toHaveText(
          issue.workflow ?? "",
        );
        // The model is an opaque identifier (decision K6) — drawn, never parsed.
        await expect(line.nth(COLUMN.model).locator(".ou-chip--model"), where).toHaveText(
          issue.model ?? "",
        );
      }

      await expect(line.nth(COLUMN.status).locator(".ou-chip"), where).toHaveText(issue.status);
    }

    // Every effort the design system publishes appears across the eight sized rows — the
    // criterion the CHECK on `issue_estimates.effort` exists for, asserted as a rendered
    // scale rather than as one chip.
    expect(new Set(await grid(page).locator(".ou-chip--effort").allTextContents())).toEqual(
      new Set(SEEDED_BACKLOG.flatMap((issue) => (issue.effort === null ? [] : [issue.effort]))),
    );

    // The freshness tag is a fact about the sync's own record of itself, which no seed
    // stamps — so it reads *never synced* rather than a computed age, and it is a control.
    await expect(tableCard(page).getByRole("button", { name: NEVER_SYNCED })).toBeVisible();

    // The banner over the rows: the loop is paused for a reason the service derived from a
    // table with no token in it, said once, with the way to ask again.
    const banner = tableCard(page).locator(".issues-sync");

    await expect(banner.locator(".ou-retry__headline")).toHaveText(SYNC_PAUSED_NO_TOKEN);
    await expect(banner.getByRole("button", { name: CHECK_AGAIN_LABEL })).toBeVisible();
  });

  test("the #485 panel is the mockup's, field for field", async ({ page }) => {
    await openIssue(page, SEEDED_DETAIL.number);

    const card = panel(page);

    // The row lights its number and nothing else: inspected is not checked.
    await expect(row(page, SEEDED_DETAIL.number)).toHaveClass(/issues-table__row--inspected/);
    await expect(row(page, SEEDED_DETAIL.number)).toHaveAttribute("aria-selected", "false");

    // The pill beside the title is the dashboard seed's word, not the mockup's `sized`.
    await expect(panelPill(page)).toHaveText(PILL.queued);

    await expect(card.locator(".issues-panel__meta")).toHaveText(SEEDED_DETAIL.meta);
    await expect(card.locator(".issues-panel__title")).toHaveText(
      seededIssue(SEEDED_DETAIL.number).title,
    );
    // Four tags — the panel's set, which the seed stores; the table draws the same four.
    await expect(card.locator(".issues-panel__tags .ou-tag")).toHaveText([
      ...seededIssue(SEEDED_DETAIL.number).labels,
    ]);

    // The excerpt: GitHub's text between the panel's own quotation marks, drawn whole.
    await expect(card.locator(".issues-panel__excerpt")).toHaveText(SEEDED_DETAIL.excerpt);
    await expect(card.getByRole("button", { name: "Read more" })).toHaveCount(0);

    // The breakdown, field for field: the mockup's three files, and the figures the seed
    // wrote for them.
    const work = breakdown(page);

    await expect(work.locator(".issues-panel__files li")).toHaveText([...SEEDED_DETAIL.files]);
    await expect(work.locator(".issues-panel__row").nth(0)).toContainText(SEEDED_DETAIL.tokens);
    await expect(work.locator(".issues-panel__row").nth(1)).toContainText(SEEDED_DETAIL.cycle);
    await expect(work.locator(".ou-chip--effort")).toHaveText(SEEDED_DETAIL.effort);
    await expect(work.locator(".issues-panel__conf")).toHaveText(SEEDED_DETAIL.confidence);

    // The level in words beside the meter, never in colour alone, and the reviewer's sentence.
    await expect(work.locator(".issues-panel__risk-level")).toHaveText(SEEDED_DETAIL.risk);
    await expect(work.locator(".issues-panel__risk-note")).toHaveText(SEEDED_DETAIL.riskNote);
    await expect(work.locator(".issues-panel__routing .ou-tag")).toHaveText(SEEDED_DETAIL.workflow);
    await expect(work.locator(".issues-panel__routing .ou-chip--model")).toHaveText(
      SEEDED_DETAIL.model,
    );

    // The three actions. The queue already holds this issue, and the button says so rather
    // than offering a press the service would refuse.
    await expectInert(
      card.getByRole("button", { name: "Queue for loop" }),
      SEEDED_DETAIL.queueReason,
    );
    await expect(card.getByRole("button", { name: "Re-estimate" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(card.getByRole("link", { name: "Open on GitHub ↗" })).toHaveAttribute(
      "href",
      SEEDED_DETAIL.githubUrl,
    );

    // The trace is honest or it is not drawn (decision K10): the rule engine's own name, an
    // age this suite cannot pin, no tokens because none were spent, and no signals because
    // none were consulted — never the mockup's model name or its knowledge signals.
    await expect(card.getByRole("group")).toContainText("Estimation trace");
    await expect(traceLines(page).first()).toHaveText(SEEDED_DETAIL.provenance);
    await expect(traceLines(page).last()).toHaveText(SEEDED_DETAIL.signals);
  });

  test("the filter bar draws the scope's own vocabulary at the default view", async ({ page }) => {
    const bar = filterBar(page);

    // The repository select is the enablement list: every repository the workspace enables,
    // after the option that is the absence of a choice.
    const options = bar.getByLabel("Repository").locator("option");

    await expect(options.first()).toHaveText("All repos");
    expect((await options.allTextContents()).slice(1).sort()).toEqual([...SEEDED_REPOS].sort());
    await expect(bar.getByLabel("Repository")).toHaveValue("");

    // The chip set is M.1's `labelFacets` — every label in scope, ascending by name, none of
    // them pressed. Fourteen across nine issues, which is the chip set asserting the seed's
    // labels rather than the mockup's four.
    const chips = bar.getByRole("group", { name: "Labels" }).getByRole("button");

    await expect(chips).toHaveText([...LABEL_FACETS]);
    await expect(
      bar.getByRole("group", { name: "Labels" }).locator("[aria-pressed='true']"),
    ).toHaveCount(0);

    await expect(bar.getByLabel("State")).toHaveValue("open");
    await expect(bar.getByLabel("Sort")).toHaveValue("effort");
    await expect(bar.getByRole("searchbox", { name: "Search the backlog" })).toHaveValue("");

    // Nothing to clear: the default view has one address, and the control that goes back to it
    // is not drawn while the page is already there.
    await expect(bar.getByRole("button", { name: "Clear all" })).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ both palettes */

/**
 * The window the parity pairs are photographed through.
 *
 * Taller than the suite's Desktop Chrome, for the reason the routing leg gives: the shell's
 * pane is the only scroll container, so a screenshot of a page taller than the viewport
 * records the tail as bare ground and nothing says so. Giving the window the page's own
 * height makes the pane not scroll — asserted, so a page that outgrows it turns red rather
 * than being quietly cropped. Wider than 1280, so the mockup's `c-8`/`c-4` grid holds the
 * panel beside the table rather than under it.
 */
const PARITY_WINDOW = { width: 1920, height: 1700 };

test.describe("the issues screen is drawn in both palettes", () => {
  /**
   * What a screenshot must not be taken of: the trace's first line, whose *N ago* is measured
   * from a `sized_at` two minutes before migration and is a minute older every minute. It is
   * asserted as a shape by the parity group; everything else on the page is a row that does
   * not move, or a sentence.
   */
  function volatile(page: Page): Locator[] {
    return [traceLines(page).first()];
  }

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PARITY_WINDOW);
  });

  test("light and dark are both mockup 03", async ({ context, page }) => {
    await enterIssues(context, page);

    // The mockup's composition: `#485` both checked and open, so the selection bar and the
    // panel are in the frame with the table.
    await row(page, SEEDED_DETAIL.number)
      .getByRole("checkbox", { name: `Select #${String(SEEDED_DETAIL.number)}` })
      .check();
    await openIssue(page, SEEDED_DETAIL.number);
    await expect(traceLines(page).first()).toHaveText(SEEDED_DETAIL.provenance);

    expect(
      await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollHeight - el.clientHeight),
      "the parity window must be tall enough to hold the whole screen without scrolling",
    ).toBe(0);

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("issues-light.png", { mask: volatile(page) });

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("issues-dark.png", { mask: volatile(page) });
  });

  test("the guidance state is drawn in both palettes", async ({ context, page }) => {
    await enterIssues(context, page, { workspace: SEED_PERSONAL_TENANT.slug });
    await expect(tableCard(page)).toContainText(GUIDANCE.title);

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("issues-guidance-light.png");

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("issues-guidance-dark.png");
  });
});

/* ------------------------------------------------------------------ the filter round trip */

test.describe("the filter bar is a query-string editor", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterIssues(context, page);
  });

  test("four controls become one address, and the address reproduces the view", async ({
    page,
  }) => {
    const bar = filterBar(page);
    const chip = bar.getByRole("group", { name: "Labels" }).getByRole("button", {
      name: ROUND_TRIP.label,
      exact: true,
    });

    // Each control writes the next address — `router.replace`, inside a transition — and the
    // page is rendered again from it. Asserting the address after every press is asserting
    // decision K8 from the writing side: this is the URL the reload below will read.
    await bar.getByLabel("Repository").selectOption(ROUND_TRIP.repo.id);
    await expect(page).toHaveURL(`${UI_URL}${issuesPath(`?repo=${ROUND_TRIP.repo.id}`)}`);

    await chip.click();
    await expect(page).toHaveURL(
      `${UI_URL}${issuesPath(`?repo=${ROUND_TRIP.repo.id}&labels=${ROUND_TRIP.label}`)}`,
    );

    await bar.getByLabel("Sort").selectOption(ROUND_TRIP.sort);
    await expect(page).toHaveURL(
      `${UI_URL}${issuesPath(
        `?repo=${ROUND_TRIP.repo.id}&labels=${ROUND_TRIP.label}&sort=${ROUND_TRIP.sort}`,
      )}`,
    );

    // The search box is the one control held locally, and the address follows it after a
    // pause — so the whole term is one request rather than three.
    await bar.getByRole("searchbox", { name: "Search the backlog" }).fill(ROUND_TRIP.q);
    await expect(page).toHaveURL(`${UI_URL}${issuesPath(ROUND_TRIP.search)}`);

    // The view: `bug` ANDed down to five, `CAN` over the title keeps two, `number` orders them.
    await expectRows(page, ROUND_TRIP.rows);
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(bar.getByRole("button", { name: "Clear all" })).toBeVisible();

    // The head counts the selected repository's backlog and does not move as chips are
    // pressed — the contract scopes it by `repo` and by nothing else in the bar.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED_HEADLINE);

    // The round trip. A fresh request for the address the bar wrote, and the identical view:
    // every control showing what the server was asked, and the same two rows in the same
    // order. This is the assertion a bar that kept its state in React would fail.
    await page.goto(issuesPath(ROUND_TRIP.search));
    await settled(page, SEEDED_ARRIVAL);

    await expect(bar.getByLabel("Repository")).toHaveValue(ROUND_TRIP.repo.id);
    await expect(bar.getByLabel("Repository").locator("option:checked")).toHaveText(
      ROUND_TRIP.repo.name,
    );
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(bar.getByLabel("State")).toHaveValue("open");
    await expect(bar.getByLabel("Sort")).toHaveValue(ROUND_TRIP.sort);
    await expect(bar.getByRole("searchbox", { name: "Search the backlog" })).toHaveValue(
      ROUND_TRIP.q,
    );
    await expectRows(page, ROUND_TRIP.rows);
  });

  test("a view narrowed to nothing says the filter did it, and the way out is the default view", async ({
    page,
  }) => {
    await page.goto(issuesPath(ROUND_TRIP.search));
    await settled(page, SEEDED_ARRIVAL);

    const bar = filterBar(page);

    await bar.getByLabel("State").selectOption(NO_MATCHES.state);
    await expect(page).toHaveURL(`${UI_URL}${issuesPath(NO_MATCHES.search)}`);

    // *Nothing matched* and *nothing mirrored* are different facts and must not read alike:
    // the counts are scoped by the repository alone, so the card can tell a narrowed backlog
    // from an empty one and send the reader to the bar rather than to a repository.
    await expect(tableCard(page)).toContainText(NO_MATCHES.title);
    await expect(grid(page)).toHaveCount(0);

    // **Clear filters** is the bar's own **Clear all**, asked for from the table: the store
    // cleared, the box settled, and the one address the default view has.
    await tableCard(page).getByRole("button", { name: NO_MATCHES.clearLabel }).click();
    await expect(page).toHaveURL(`${UI_URL}${ISSUES_PATH}`);

    await expectRows(
      page,
      SEEDED_BACKLOG.map((issue) => issue.number),
    );
    await expect(bar.getByLabel("Repository")).toHaveValue("");
    await expect(bar.getByLabel("State")).toHaveValue("open");
    await expect(bar.getByLabel("Sort")).toHaveValue("effort");
    await expect(bar.getByRole("searchbox", { name: "Search the backlog" })).toHaveValue("");
    await expect(
      bar.getByRole("group", { name: "Labels" }).locator("[aria-pressed='true']"),
    ).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ select → queue → dashboard */

test.describe("a selection becomes queued work, and the dashboard says so", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterIssues(context, page);
  });

  test("three are selected, two are refused by name, one is queued, and the dashboard moved", async ({
    page,
  }) => {
    for (const number of QUEUE_LEG.picked) {
      await row(page, number)
        .getByRole("checkbox", { name: `Select #${String(number)}` })
        .check();
    }

    // The selection reaches outside the table: the head's primary action counts it, the rows
    // wear it, and the bar under the table sums it — from the rows as the table last saw them,
    // which is why the figure is 50 + 60 + 110 and not a function of three chips.
    await expect(page.getByRole("button", { name: "Queue 3 selected ⟳" })).toBeVisible();
    for (const number of QUEUE_LEG.picked) {
      await expect(row(page, number)).toHaveAttribute("aria-selected", "true");
    }

    const bar = screen(page).locator(".issues-bar");

    await expect(bar.locator(".issues-bar__summary strong")).toHaveText(QUEUE_LEG.summary);
    await expect(bar.locator(".issues-bar__estimate")).toHaveText(QUEUE_LEG.estimate);
    await expect(bar.getByRole("button", { name: "Assign workflow" })).toBeVisible();

    // The three do not agree on a workflow, so the action says *suggested* rather than one tag.
    await bar.getByRole("button", { name: QUEUE_LEG.action }).click();

    // Refused, whole, and explained issue by issue — see this file's header. The dialog names
    // exactly the two issues whose numbers the workspace's queue already speaks for, in the
    // order they were sent, and says why the third was left out with them.
    const dialog = page.getByRole("dialog", { name: QUEUE_LEG.refused.title });

    await expect(dialog.locator(".issues-refusal li")).toHaveText([...QUEUE_LEG.refused.lines]);
    await expect(dialog.locator(".shell-overlay__note")).toHaveText(QUEUE_LEG.refused.note);

    // A refusal clears nothing: the write was all or nothing, so the pills have not moved and
    // the selection is still the reader's to fix.
    for (const number of QUEUE_LEG.picked) {
      await expect(pillOf(page, number)).toHaveText(seededIssue(number).status);
    }

    await dialog.getByRole("button", { name: QUEUE_LEG.refused.deselect }).click();
    await expect(dialog).toHaveCount(0);

    // Exactly the named two were dropped, and the bar re-summed what is left — one issue, one
    // suggestion, so the action now names it.
    await expect(bar.locator(".issues-bar__summary strong")).toHaveText(QUEUE_LEG.queued.summary);
    await expect(bar.locator(".issues-bar__estimate")).toHaveText(QUEUE_LEG.queued.estimate);
    await expect(row(page, QUEUE_LEG.queued.number)).toHaveAttribute("aria-selected", "true");
    for (const number of QUEUE_LEG.picked.filter((each) => each !== QUEUE_LEG.queued.number)) {
      await expect(row(page, number)).toHaveAttribute("aria-selected", "false");
    }

    await bar.getByRole("button", { name: QUEUE_LEG.queued.action }).click();

    // The press took. The toast counts and sums from the row the service created — never from
    // the preview — the selection is cleared because that issue is queued now, and the row's
    // pill follows the route's re-read.
    const toast = screen(page).locator(".issues-toast");

    await expect(toast.locator(".issues-toast__text")).toHaveText(QUEUE_LEG.queued.toast);
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Queue 0 selected ⟳" })).toBeVisible();

    // The rows are the poll's last answer rather than the route's re-read, so the pill moves
    // on the next tick — within one poll, which is the page's promise and the wait's size.
    await expect(pillOf(page, QUEUE_LEG.queued.number)).toHaveText(PILL.queued, {
      timeout: 2 * ONE_POLL_MS,
    });

    // **The assertion this leg exists for.** The toast's own link, and the dashboard *page*
    // it lands on — drawn by the read model the intake roadmap's decision K9 left read-only.
    await toast.getByRole("link", { name: QUEUE_LEG.queued.link }).click();
    await expect(page).toHaveURL(`${UI_URL}${DASHBOARD_AFTER_QUEUE.path}`);

    const tile = page.getByRole("region", { name: DASHBOARD_AFTER_QUEUE.tile.label });

    await expect(tile.locator(".dash-stat__value")).toHaveText(DASHBOARD_AFTER_QUEUE.tile.value);
    await expect(tile.locator(".dash-stat__delta")).toHaveText(DASHBOARD_AFTER_QUEUE.tile.detail);

    // The card: its footer counts what it is not showing, one more than the seed's, and the
    // five rows it does show are still the seed's five — the new item joined the tail, which
    // is what a queue does.
    const card = page.getByRole("region", { name: "Up next in queue" });

    await expect(card.getByRole("link", { name: DASHBOARD_AFTER_QUEUE.beyondHead })).toBeVisible();

    const head = card.getByRole("listitem");

    await expect(head).toHaveCount(SEEDED_QUEUE.length);
    for (const [index, item] of SEEDED_QUEUE.entries()) {
      await expect(head.nth(index), `${item.issue} (position ${String(index + 1)})`).toContainText(
        item.issue,
      );
    }
  });
});

/* ------------------------------------------------------------------ the estimation lifecycle */

test.describe("the estimation lifecycle", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterIssues(context, page);
  });

  test("the seed holds the mid-flight state still: a placeholder, two em dashes, and a panel that waits", async ({
    page,
  }) => {
    const line = cells(row(page, ESTIMATING_ISSUE.number));

    await expect(line.nth(COLUMN.effort)).toHaveText(SIZING);
    await expect(line.nth(COLUMN.workflow)).toHaveText(UNESTIMATED);
    await expect(line.nth(COLUMN.model)).toHaveText(UNESTIMATED);
    await expect(line.nth(COLUMN.status).locator(".ou-chip")).toHaveText(PILL.estimating);

    await openIssue(page, ESTIMATING_ISSUE.number);

    // The panel's `estimating` state: the pill, the sentence, and a skeleton where the
    // breakdown will land — a live region, so a reader hears the wait rather than sees it.
    await expect(panelPill(page)).toHaveText(PILL.estimating);

    const waiting = panel(page).locator(".issues-panel__sizing");

    await expect(waiting).toHaveAttribute("role", "status");
    await expect(waiting).toContainText(ESTIMATING_ISSUE.sizingNow);
    await expect(waiting).toContainText(ESTIMATING_ISSUE.sizingNote);
    await expect(traceLines(page)).toHaveCount(0);

    // Both actions inert, each with the reason: a second estimate would spend an engine call
    // to write the same answer twice, and the loop takes sized issues only.
    await expectInert(
      panel(page).getByRole("button", { name: "Re-estimate" }),
      ESTIMATING_ISSUE.reestimateReason,
    );
    await expectInert(
      panel(page).getByRole("button", { name: "Queue for loop" }),
      ESTIMATING_ISSUE.queueReason,
    );
  });

  test("a press moves the issue through the engine and back, and the panel follows without a reload", async ({
    page,
  }) => {
    await openIssue(page, REESTIMATE.number);

    const provenance = traceLines(page).first();

    // The estimate in force before the press: the seed's v2 over a superseded v1.
    await expect(provenance).toHaveText(REESTIMATE.before);

    // A mark the page loses on any full navigation — the proof, below, that what the panel
    // draws next arrived by its poll and not by a reload.
    await page.evaluate(() => {
      (window as Window & { ouroLeg?: string }).ouroLeg = "re-estimate";
    });

    await panel(page).getByRole("button", { name: "Re-estimate" }).click();

    // Wait for the pipeline to have *finished*, whichever way it finished: a trace line that
    // prints the next version, or a pill that says a person is deciding. Only the first is a
    // pass, but waiting on either is what lets the failure below name what actually happened.
    //
    // Two polls rather than one expect timeout. The refresh asked for on the `202` usually
    // finds the row still claimed — the panel draws `estimating…`, which is the transient
    // state the ticket names, caught live — and the version then lands on the *next* tick,
    // fifteen seconds later (`support/issues.ts`, `ONE_POLL_MS`). That is the page's own
    // promise, *within one poll of pipeline completion*, and the wait is sized to it.
    await expect
      .poll(
        async () => {
          const pill = await panelPill(page).textContent();
          const line = await provenance.textContent();

          if (pill === PILL.needsHuman) return pill;
          return / · v3$/.test(line ?? "") ? line : null;
        },
        {
          message: "the estimation pipeline must answer the press within one poll",
          timeout: 2 * ONE_POLL_MS,
        },
      )
      .not.toBeNull();

    // **The assertion the engine pair in verify-failure-modes.sh exists for.** An engine that
    // did not answer twice sends the issue to `needs_human` with the old version still in
    // force; an engine that answered wrote a new one.
    await expect(
      panelPill(page),
      "the re-estimate must land sized — an engine that did not answer leaves the issue needs human",
    ).toHaveText(PILL.sized);
    await expect(provenance).toHaveText(REESTIMATE.after);

    // The rule engine's own answer, in the panel: no files and the sentence that says why, the
    // `l` budget, its risk sentence, and the model routing resolved through the `default`
    // key. The workflow and the model are the seed's — that is the calibration `support/
    // issues.ts` § re-estimate argues, and it is what keeps the parity group true of a stack
    // this test has run against.
    const work = breakdown(page);

    await expect(work.locator(".issues-panel__files")).toHaveCount(0);
    await expect(work.locator(".issues-panel__note")).toHaveText(REESTIMATE.filesNote);
    await expect(work.locator(".issues-panel__row").nth(0)).toContainText(REESTIMATE.tokens);
    await expect(work.locator(".issues-panel__row").nth(1)).toContainText(REESTIMATE.cycle);
    await expect(work.locator(".ou-chip--effort")).toHaveText(REESTIMATE.effort);
    await expect(work.locator(".issues-panel__conf")).toHaveText(REESTIMATE.confidence);
    await expect(work.locator(".issues-panel__risk-level")).toHaveText(REESTIMATE.risk);
    await expect(work.locator(".issues-panel__risk-note")).toHaveText(REESTIMATE.riskNote);
    await expect(work.locator(".issues-panel__routing .ou-tag")).toHaveText(REESTIMATE.workflow);
    await expect(work.locator(".issues-panel__routing .ou-chip--model")).toHaveText(
      REESTIMATE.model,
    );

    // The table's poll redrew the row from the same version, and the row reads as the seed's
    // did — every figure the rule engine reproduces, and the pill back at `sized`.
    const line = cells(row(page, REESTIMATE.number));
    const seeded = seededIssue(REESTIMATE.number);

    await expect(line.nth(COLUMN.effort).locator(".ou-chip--effort")).toHaveText(REESTIMATE.effort);
    await expect(line.nth(COLUMN.effort).locator(".issues-table__conf")).toHaveText(
      seeded.confidence ?? "",
    );
    await expect(line.nth(COLUMN.workflow).locator(".ou-tag")).toHaveText(REESTIMATE.workflow);
    await expect(line.nth(COLUMN.model).locator(".ou-chip--model")).toHaveText(REESTIMATE.model);
    await expect(line.nth(COLUMN.status).locator(".ou-chip")).toHaveText(PILL.sized);

    // …and nothing reloaded: the mark set before the press is still on the window.
    expect(
      await page.evaluate(() => (window as Window & { ouroLeg?: string }).ouroLeg),
      "the panel must follow the pipeline by its poll, not by a navigation",
    ).toBe("re-estimate");

    // The half that matters. A fresh request, a fresh read, and the version is still there —
    // which is the assertion a panel drawing an optimistic answer would pass above and fail
    // here.
    await page.reload();
    await settled(page, SEEDED_ARRIVAL);
    await openIssue(page, REESTIMATE.number);
    await expect(traceLines(page).first()).toHaveText(/ · v3$/);
  });
});

/* ------------------------------------------------------------------ the personal workspace */

test.describe("the personal workspace is guided rather than blanked", () => {
  test.beforeEach(async ({ context, page }) => {
    // `kensuenobu` is the personal workspace #704 gives everybody at first sign-in. The intake
    // seed writes **no** issue against it on purpose, and no seed writes a token, so every
    // state below is a workspace rather than a mocked payload — N.6's guidance, end to end.
    await enterIssues(context, page, { workspace: SEED_PERSONAL_TENANT.slug });
  });

  test("the table card says which nothing this is, and what would fill it", async ({ page }) => {
    const card = tableCard(page);

    // The head counted zero and says so as a figure, not as a failure.
    await expect(screen(page).locator(".issues__unread")).toHaveCount(0);

    // The state M.4 actually reports — no token — with its sentence and, for an owner, the
    // control: inert, naming the issue that unblocks it rather than linking to a `404`.
    await expect(card.locator(".ou-empty__title")).toHaveText(GUIDANCE.title);
    await expect(card.locator(".ou-empty__note")).toHaveText(GUIDANCE.note);
    await expectInert(card.getByRole("button", { name: GUIDANCE.control }), GUIDANCE.controlReason);

    // Said once: the empty state *is* the explanation, so no banner repeats it over the seat.
    await expect(card.locator(".issues-sync")).toHaveCount(0);
    await expect(grid(page)).toHaveCount(0);
    await expect(card.getByRole("button", { name: NEVER_SYNCED })).toBeVisible();

    // The panel keeps its seat and says how a row would reach it.
    await expect(panel(page)).toContainText(GUIDANCE.noIssueOpen);

    // Neither head action is offered over nothing, and each says why.
    await expectInert(
      page.getByRole("button", { name: "Re-estimate all" }),
      GUIDANCE.reestimateReason,
    );
    await expectInert(
      page.getByRole("button", { name: "Queue 0 selected ⟳" }),
      GUIDANCE.queueReason,
    );

    // Nothing is fabricated: not one of the demo workspace's issue numbers is on this page.
    for (const issue of SEEDED_BACKLOG) {
      await expect(screen(page)).not.toContainText(`#${String(issue.number)}`);
    }
  });

  test("the filter bar lists the workspace's own repositories, and no labels", async ({ page }) => {
    const bar = filterBar(page);
    const options = bar.getByLabel("Repository").locator("option");

    // The two repositories `R__dev_seed.sql` enables for this workspace — the reason the
    // guidance is *no token* rather than *no repos*.
    expect((await options.allTextContents()).slice(1).sort()).toEqual([...GUIDANCE.repos].sort());

    // No label in scope, said in words rather than as an empty row of chips.
    await expect(bar.getByRole("group", { name: "Labels" }).getByRole("button")).toHaveCount(0);
    await expect(bar.getByRole("group", { name: "Labels" })).toContainText(GUIDANCE.noLabels);
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell holds the issues screen", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterIssues(context, page);
  });

  // The scale is a row keyed on the person and outlives this context. Restored after all
  // three tests rather than only the one that writes, for the reason the dashboard leg gives.
  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the header and the sidebar do not move when the content pane scrolls", async ({ page }) => {
    const header = page.getByRole("banner");
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const pane = page.locator(PANE_SELECTOR);

    const before = { header: await header.boundingBox(), sidebar: await sidebar.boundingBox() };

    // The premise: a page that fitted the viewport would make everything below vacuously true.
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the issues screen must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Four regions of which exactly one scrolls (design system § 1, decision S2), on a page
    // with a card grid and the page's one sticky slot inside the pane.
    expect(await header.boundingBox()).toEqual(before.header);
    expect(await sidebar.boundingBox()).toEqual(before.sidebar);

    // And the document itself never scrolls, which is what makes the pane the only scroll
    // container rather than the second one.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the sidebar knows the reader is on the issues screen", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Issues" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Exactly one entry claims it. Two would make the sidebar's answer to *where am I* a
    // matter of which one the reader looked at first.
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();
    await settled(page, SEEDED_ARRIVAL);

    const html = page.locator("html");

    // The whole round trip: the preference is the *person's* and lives on the server, so the
    // attribute proves it was read and the root size proves one of the five
    // `:root[data-font-scale]` rules in `app/globals.css` shipped and acted on it.
    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // The assertion a fifth more type is actually for, on a six-column table with tags under
    // its titles: nothing may make the pane scroll sideways — wide content scrolls inside its
    // own wrapper (§ 1.3).
    const pane = page.locator(PANE_SELECTOR);

    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // And the page is still the issues screen rather than a shell around a broken render.
    await expect(grid(page).locator("tbody tr")).toHaveCount(SEEDED_BACKLOG.length);
    await expect(panel(page)).toContainText(GUIDANCE.noIssueOpen);
  });
});
