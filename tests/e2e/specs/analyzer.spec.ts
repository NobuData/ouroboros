/**
 * Leg 23 — **the Build Analyzer's suggestion cards**
 * ([#518](https://github.com/NobuData/ouroboros/issues/518), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)) — **its drafted-tickets card as the
 * seed composes it** ([#519](https://github.com/NobuData/ouroboros/issues/519)), **its
 * predicted-vs-measured and how-it-works cards**
 * ([#520](https://github.com/NobuData/ouroboros/issues/520)) **and the page's states, with the
 * rest of the chain** ([#521](https://github.com/NobuData/ouroboros/issues/521) — the Build
 * Analyzer's MVP gate).
 *
 * Mockup 18's **Suggested build-process changes** and **Suggested workflow changes** against
 * `R__dev_seed_workspace_metrics_analyzer.sql`. The UI's own suites draw every state of both cards
 * from fixtures, and the service's integration suite composes, applies and dismisses against a
 * real database. What neither can see is the distance between the two — whether what the dialog
 * *says* will happen is what another plane then *holds*:
 *
 *   * **Seeded parity** — both cards as the seed composes them: titles, mono evidence lines,
 *     impact pills, confidences, the `4 open` count, and the spike row offering **Draft spike
 *     ticket** where the others have Apply.
 *   * **Apply → farm** — the pool move's consequence preview names the runner, the pool, the UTC
 *     window and the days; after the confirm, **the farm's own configuration route holds exactly
 *     that window**, and the row reads applied with its measurement pending.
 *   * **Draft → studio** — *Draft as vN →* previews the stage delta and says publishing remains
 *     human; after the confirm the browser is in the studio on `standard-fix`, and **the draft the
 *     workflow's own route answers cites the suggestion in its change note** and carries the
 *     re-wiring.
 *   * **Dismiss survives a re-analysis** — a row dismissed in the browser is still dismissed, on
 *     the page and over the API, after a real **Run analysis now** has run to its end.
 *   * **A member** reads the same preview with the confirm inert, and the service refuses their
 *     direct apply.
 *   * **The drafted tickets** (#519) — mockup 18's four rows with their keys, titles, estimator
 *     chips and evidence lines; a tick that moves the push button's count at once and the total
 *     when the service answers, and is put back; an evidence line opening references that
 *     resolve; and a member, who may tick and may not push. **The push itself is leg 24's**
 *     (`specs/tickets.spec.ts`), which has to run after the planning leg — it files canonical
 *     tickets that leg's seeded parity counts.
 *   * **Predicted vs measured, and how it works** (#520) — mockup 18's pair with the miss drawn
 *     as plainly as the delivery (three distinct hues, in both palettes), the caption's
 *     *retrains* opening the service's own formula and calibration cells, and the three steps
 *     with the tenant-locality link. Then, through the writers: **the apply's measurement is a
 *     row on the card** — `day 0 of 14`, naming its metric — which the applied row's link lands
 *     on; and after the real re-analysis **the ingest line no longer claims rig telemetry**: the
 *     live corpus has no export of it, and the card says *not read*, with the manifest's reason.
 *
 *   * **The page as a whole, and its other states** (#521, the MVP gate) — the seven regions in
 *     both themes, as screenshots on the mockup's calendar; provenance that claims no model and
 *     no `$`; the three chips on the shifts the seed plants; the shell (fixed header and sidebar,
 *     **Build Farm** lit, 125% type); a member's page; **insufficient corpus for real** on the
 *     two seeded repositories that are that thin; and — drawn by answering the page's own poll
 *     with the service's answer, changed (`support/analyzer.ts` § *What is intercepted*) —
 *     **never run**, **running**, **failed** and **stopped at its budget**. Then, through the
 *     writers: **a real analysis reproduces the seeded findings** — the chart re-drawn from the
 *     new run carries the same three chips — and a thin repository stays insufficient through a
 *     real analysis of it.
 *
 * ## What the dismissal test asserts about identity, and one honest limit
 *
 * The analyzer runs **twice** there, for real: once before the dismissal and once after it. Each
 * run assembles the corpus, dispatches it to the engine, and composes — three analyzers complete
 * (`change_point`, `log_signature`, `waiver_cite`), and the composer meets a suggestion it already
 * knows: the fixture-timeout ticket (`BA-1`, from `log_signature`), which the seed drafted. That
 * is where suggestion identity is exercised across real runs, so that is what is asserted: after
 * both runs `BA-1` is still **one** suggestion, drafted — nothing by its title is waiting under
 * *Not drafted yet*. An identity that changed between runs would compose it a second time, open.
 *
 * The limit: the analyzer behind the *dismissed* row (`workflow_outcome`) is `skipped` on a live
 * corpus until its assembler fills that analyzer's inputs, so the composer does not meet that
 * suggestion again. For it the test proves that a dismissal **holds across two real runs and a
 * reload, in the database and on the page**, and that a run which did not look for a suggestion
 * does not take it off the cards. That the composer keeps a suggestion dismissed when it *does*
 * find it again is asserted where it can be made to: `suggestions.integration-spec.ts` and
 * `actions.integration-spec.ts` in `ouroboros-rest`.
 *
 * ## Green from a cold volume only
 *
 * A resolution is final by design, so this leg cannot put its rows back (`support/analyzer.ts` §
 * *What this leg writes*). The first block's `beforeAll` says so in words; the writers sit outside
 * it and state their own preconditions, because Playwright starts a new worker after a failed test
 * and would run the guard again after one of them had written. What can be put back is: the pool
 * window is deleted and `standard-fix`'s draft is restored to the seeded document. The states
 * block needs no cold volume: it reads, and rewrites nothing but what the browser is shown.
 */
import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  ANALYZERS,
  ANALYZER_PATH,
  ATLAS,
  type AnalysisRunRow,
  BUDGET_REASON,
  CARDS,
  CHART_REGION,
  ENGINE_UNAVAILABLE,
  FIRST_RUN_ACTION,
  HELIOS,
  HOW_IT_WORKS,
  HOW_IT_WORKS_CARD,
  INSUFFICIENT_REGION,
  LIVE_ANALYZERS,
  LOCALITY,
  MEASUREMENTS,
  MEASUREMENTS_CARD,
  MOVE_PREVIEW,
  NEVER_RUN_REGION,
  NOT_COLD,
  PLANTED_SHIFTS,
  PROGRESS_REGION,
  RECALIBRATION,
  REGIONS,
  ROWS,
  SEEDED_TICKET_BATCH_ID,
  STRIP_REGION,
  TELEMETRY,
  TICKETS,
  TICKETS_CARD,
  TICKETS_NOT_COLD,
  TICKET_TOTALS,
  TITLES,
  applyStatusFor,
  asBudgetExceeded,
  asFailed,
  asNeverRun,
  asRunning,
  chipTexts,
  corpus,
  dayLabel,
  daysBetween,
  durationChart,
  focusHelios,
  focusRepo,
  latestRun,
  measurements,
  moveWindows,
  onMockupDay,
  poolWindows,
  pushSeededTickets,
  removeMoveWindows,
  retickSeededTickets,
  rewriteAnalyzerPoll,
  seededTicketBatch,
  standardFixDraft,
  suggestion,
  suggestions,
  ticketTitles,
} from "../support/analyzer";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { STANDARD_FIX, restoreStandardFixDraft } from "../support/studio";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** How long a real analysis is given to run to its end — assemble, dispatch, analyze, compose. */
const ANALYSIS_TIMEOUT_MS = 120_000;

/** The viewport the seven regions are photographed at — the mockup's own width, near enough. */
const PARITY_VIEWPORT = { width: 1680, height: 1050 };

/**
 * Sign a seeded person into the seeded workspace, with the page set to open on the seeded
 * repository.
 *
 * @param context The browser context.
 * @param userId Who. Defaults to the owner.
 */
async function signInAs(context: BrowserContext, userId: string = SEED_OWNER.id): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
  await focusHelios(context);
}

/**
 * One of the two cards.
 *
 * @param page The page.
 * @param card Which.
 * @returns Its region.
 */
function card(page: Page, card: keyof typeof CARDS): Locator {
  return page.locator("main.analyzer").getByRole("region", { name: CARDS[card] });
}

/**
 * A row, by its suggestion's title.
 *
 * @param page The page.
 * @param title The title.
 * @returns The row's article.
 */
function row(page: Page, title: string): Locator {
  return page.locator("main.analyzer").getByRole("article", { name: title });
}

/**
 * The drafted-tickets card.
 *
 * @param page The page.
 * @returns Its region.
 */
function ticketsCard(page: Page): Locator {
  return page.locator("main.analyzer").getByRole("region", { name: TICKETS_CARD });
}

/**
 * A drafted ticket's row, by its batch-local key.
 *
 * @param page The page.
 * @param key The key — `BA-3`.
 * @returns The row's list item.
 */
function ticketRow(page: Page, key: string): Locator {
  return ticketsCard(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: `Include ${key}` }) });
}

/**
 * The predicted-vs-measured card.
 *
 * @param page The page.
 * @returns Its region.
 */
function measurementsCard(page: Page): Locator {
  return page.locator("main.analyzer").getByRole("region", { name: MEASUREMENTS_CARD });
}

/**
 * A measurement's row, by its suggestion's name.
 *
 * @param page The page.
 * @param title The name.
 * @returns The row's list item.
 */
function measurementRow(page: Page, title: string): Locator {
  return measurementsCard(page).locator(".analyzer-pv__row").filter({ hasText: title });
}

/**
 * One of a row's two figures.
 *
 * @param element The row.
 * @param line Which line.
 * @returns The figure's element.
 */
function figure(element: Locator, line: "predicted" | "measured"): Locator {
  return element
    .locator(".analyzer-pv__line")
    .filter({ has: element.page().getByText(line, { exact: true }) })
    .locator(".analyzer-pv__value");
}

/**
 * The colour an element is actually painted in — what only a browser with the sheet applied knows.
 *
 * @param element The element.
 * @returns Its computed colour.
 */
function hue(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).color);
}

/**
 * The how-it-works card.
 *
 * @param page The page.
 * @returns Its region.
 */
function howItWorksCard(page: Page): Locator {
  return page.locator("main.analyzer").getByRole("region", { name: HOW_IT_WORKS_CARD });
}

/**
 * A region of the page, by its exact name.
 *
 * @param page The page.
 * @param name The region's accessible name.
 * @returns The region.
 */
function regionOf(page: Page, name: string): Locator {
  return page.locator("main.analyzer").getByRole("region", { name, exact: true });
}

/**
 * The chart's change-point chips, oldest first.
 *
 * @param page The page.
 * @returns The chips.
 */
function chips(page: Page): Locator {
  return regionOf(page, CHART_REGION).locator(".chart-marks button");
}

/**
 * What a screenshot of the seeded page must not compare: the one phrase measured against the
 * clock, and the one figure that depends on the seed's weekday.
 *
 * @param page The page.
 * @returns The locators to mask.
 */
function clocks(page: Page): Locator[] {
  return [
    regionOf(page, STRIP_REGION)
      .locator(".analyzer-strip__slot")
      .filter({ hasText: "Last run" })
      .locator(".analyzer-strip__value"),
    row(page, TITLES.move).getByRole("button", { name: /^conf \d+%$/ }),
    page.locator(".analyzer-progress__below"),
  ];
}

/**
 * Open the analyzer and wait until the page has been read — whatever state it is then in.
 *
 * @param page The page.
 */
async function openRead(page: Page): Promise<void> {
  await page.goto(ANALYZER_PATH);
  await expect(page.locator("main.analyzer h1")).not.toHaveText("Reading the analyzer…");
  await expect(regionOf(page, STRIP_REGION)).not.toHaveAttribute("aria-busy", "true");
}

/**
 * Press **Run analysis now** and wait for the analysis it starts to run to its end.
 *
 * A refused start is an alert on the page, and is reported as that — with the page's own words —
 * rather than as a wait that ran out: with the engine stopped the leg says *the analysis could not
 * be started*, not *timeout*.
 *
 * @param page The page, open on the repository.
 * @param context The signed-in context, for the reads beneath the browser.
 * @param repo The repository, `owner/name`. Defaults to `helios-firmware`.
 * @returns The run, ended.
 */
async function analyseToEnd(
  page: Page,
  context: BrowserContext,
  repo: string = HELIOS.ref,
): Promise<AnalysisRunRow> {
  const before = (await latestRun(context, repo))?.id ?? null;
  const refusal = page.locator("main.analyzer .analyzer-refusal");

  await page.getByRole("button", { name: "Run analysis now" }).click();
  await expect
    .poll(
      async () => {
        if ((await refusal.count()) > 0) return `refused: ${await refusal.innerText()}`;

        return (await latestRun(context, repo))?.id ?? null;
      },
      { timeout: ANALYSIS_TIMEOUT_MS, message: "the press starts a new analysis" },
    )
    .not.toBe(before);
  if ((await refusal.count()) > 0) {
    throw new Error(
      `the analysis could not be started — the page says: ${await refusal.innerText()}`,
    );
  }

  await expect
    .poll(async () => (await latestRun(context, repo))?.status, { timeout: ANALYSIS_TIMEOUT_MS })
    .not.toBe("running");

  const run = await latestRun(context, repo);
  if (run === null) throw new Error("the analysis left no run behind");

  expect(
    run.status,
    `the analysis ran to its end (${run.failureReason ?? "no reason given"})`,
  ).toBe("complete");

  return run;
}

/**
 * Open the analyzer and wait until both cards hold their rows.
 *
 * @param page The page.
 */
async function openAnalyzer(page: Page): Promise<void> {
  await page.goto(ANALYZER_PATH);
  await expect(card(page, "process").getByRole("article").first()).toBeVisible();
  await expect(card(page, "workflow").getByRole("article").first()).toBeVisible();
}

test.describe("analyzer suggestions — the seeded cards (#518)", () => {
  // Every test in this block reads the cards as the seed composed them. A stack that has already
  // run the writers below holds resolved rows, and is told so here, once and in words.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();

    try {
      await signInAs(context);

      const statuses = (await suggestions(context)).map((entry) => entry.status);

      expect(statuses, NOT_COLD).toEqual(["open", "open", "open", "open", "open", "open"]);
      expect(moveWindows(await poolWindows(context)), NOT_COLD).toEqual([]);

      // …and the drafted tickets as the seed drafted them: one batch, sized, four ticked, none pushed.
      const batch = await seededTicketBatch(context);

      expect(batch?.status, TICKETS_NOT_COLD).toBe("sized");
      expect(
        batch?.drafts.map((draft) => [draft.localKey, draft.selected, draft.pushState]),
        TICKETS_NOT_COLD,
      ).toEqual(TICKETS.map((ticket) => [ticket.key, true, "pending"]));
    } finally {
      await context.close();
    }
  });

  test("parity: both cards as the seed composes them, against mockup 18", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const composed = await suggestions(context);

    await expect(card(page, "process").getByText("4 open", { exact: true })).toBeVisible();
    await expect(
      card(page, "workflow").getByRole("link", { name: "Open workflow studio" }),
    ).toHaveAttribute("href", "/workflows");

    for (const kind of ["process", "workflow"] as const) {
      const expected = ROWS.filter((entry) => entry.card === kind);

      await expect(card(page, kind).getByRole("article")).toHaveCount(expected.length);
      await expect(card(page, kind).getByRole("heading", { level: 3 })).toHaveText(
        expected.map((entry) => entry.title),
      );
    }

    for (const seeded of ROWS) {
      const element = row(page, seeded.title);
      // The one day-dependent figure is the service's own; every other is the mockup's.
      const confidence =
        seeded.confidence ?? composed.find((entry) => entry.title === seeded.title)?.confidence;

      await expect(element.locator(".analyzer-sugg__evidence")).toHaveText(
        `Evidence${seeded.evidence}`,
      );
      await expect(element.getByRole("button", { name: seeded.impact, exact: true })).toBeVisible();
      await expect(
        element.getByRole("button", { name: `conf ${String(confidence)}%`, exact: true }),
      ).toBeVisible();
    }

    // The mockup's 84%, give or take the seed's weekday (see `support/analyzer.ts`).
    expect([84, 85]).toContain(composed.find((entry) => entry.title === TITLES.move)?.confidence);
  });

  test("the spike row offers Draft spike ticket where the others have Apply", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const spike = row(page, TITLES.spike);

    await expect(spike.getByText("needs a spike", { exact: true })).toBeVisible();
    await expect(spike.getByRole("button", { name: "Draft spike ticket" })).toBeVisible();
    await expect(spike.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);

    for (const title of [TITLES.gate, TITLES.ccache, TITLES.move]) {
      await expect(
        row(page, title).getByRole("button", { name: "Apply", exact: true }),
      ).toBeVisible();
      await expect(row(page, title).getByText("needs a spike")).toHaveCount(0);
    }
  });

  test("a workflow row names the version a draft would become, and Simulate is an honest soon-state", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const review = await suggestion(context, TITLES.review);
    const draft = row(page, TITLES.review).getByRole("button", {
      name: `Draft as v${String(review.workflow?.nextVersion)}`,
    });
    const simulate = row(page, TITLES.review).getByRole("button", {
      name: /Simulate on last 50 loops/,
    });

    await expect(draft).toBeVisible();
    await expect(simulate).toHaveAttribute("aria-disabled", "true");
    await expect(simulate).toHaveAttribute("title", /BX\.2/);
  });

  test("a confidence opens the scoring it was computed from", async ({ context, page }) => {
    await signInAs(context);
    await openAnalyzer(page);

    await row(page, TITLES.review).getByRole("button", { name: "conf 89%" }).click();

    const scoring = row(page, TITLES.review).getByRole("group", {
      name: "How this confidence was scored",
    });

    await expect(scoring).toContainText("Sample size: 50");
    await expect(scoring).toContainText("Effect size: 0.34 against a decisive 0.3");
    await expect(scoring).toContainText("Stability: 0.896");
    await expect(scoring).toContainText("round(100 × 0.993 × 0.896 × 1.00) = 89");
  });

  test("a member reads the preview with the confirm inert, and the service refuses their apply", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_MEMBER.id);
    await openAnalyzer(page);

    await row(page, TITLES.move).getByRole("button", { name: "Apply", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(MOVE_PREVIEW.summary);

    const confirm = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).toHaveAttribute(
      "title",
      "Only an owner or admin can apply a suggestion.",
    );

    // Past the page: the role gate is the service's.
    const move = await suggestion(context, TITLES.move);
    expect(await applyStatusFor(context, move.id)).toBe(403);
    expect((await suggestion(context, TITLES.move)).status).toBe("open");
  });

  test("drafted tickets: the card as the seed composes it, against mockup 18 (#519)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const tickets = ticketsCard(page);

    // The side column's first card, beside the chart rather than under it.
    await expect(page.locator(".analyzer__side > *").first()).toHaveAccessibleName(TICKETS_CARD);
    await expect(tickets.getByRole("checkbox", { name: /^Include BA-/ })).toHaveCount(
      TICKETS.length,
    );

    for (const seeded of TICKETS) {
      const element = ticketRow(page, seeded.key);

      await expect(element.getByRole("checkbox")).toBeChecked();
      await expect(element.locator(".analyzer-tix__key")).toHaveText(seeded.key);
      await expect(element.locator(".analyzer-tix__title")).toHaveText(seeded.title);
      // The estimator's sizing, not a figure the page made up.
      await expect(element.locator(".ou-chip--effort")).toHaveText(seeded.effort);
      await expect(
        element.getByRole("button", { name: `Evidence for ${seeded.key}: ${seeded.evidence}` }),
      ).toBeVisible();
    }

    await expect(tickets.locator(".analyzer-tix__total")).toHaveText(TICKET_TOTALS.all);
    await expect(tickets.getByRole("button", { name: "Push 4 tickets to backlog" })).toBeVisible();
    await expect(tickets.getByRole("link", { name: "Edit drafts" })).toHaveAttribute(
      "href",
      `/planning?batch=${SEEDED_TICKET_BATCH_ID}`,
    );
  });

  test("drafted tickets: an evidence line opens references that resolve into the product (#519)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const chamber = TICKETS[2];

    await ticketRow(page, chamber.key)
      .getByRole("button", { name: `Evidence for ${chamber.key}: ${chamber.evidence}` })
      .click();

    const sheet = page.getByRole("dialog");

    await expect(sheet).toContainText(chamber.evidence);
    // Three waivers, each a link onto the loop it was recorded against — read out of the draft's
    // own body, which is what a push files.
    await expect(sheet.getByRole("link")).toHaveCount(3);
    for (const link of await sheet.getByRole("link").all()) {
      await expect(link).toHaveAttribute("href", /^\/runs\/[0-9a-f-]+\/tests/);
    }
    await expect(sheet).toContainText("Read from the draft's body");

    // The link is live: it lands on that loop's test results.
    await sheet.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+\/tests/);
  });

  test("drafted tickets: a tick moves the count at once and the total with the service, and is put back (#519)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const tickets = ticketsCard(page);
    const chamber = ticketRow(page, "BA-3").getByRole("checkbox");

    await chamber.uncheck();

    await expect(tickets.getByRole("button", { name: "Push 3 tickets to backlog" })).toBeVisible();
    await expect(tickets.locator(".analyzer-tix__total")).toHaveText(TICKET_TOTALS.withoutChamber);
    // The selection is the batch's own: a reload reads it back.
    await page.reload();
    await expect(ticketRow(page, "BA-3").getByRole("checkbox")).not.toBeChecked();
    await expect(tickets.locator(".analyzer-tix__total")).toHaveText(TICKET_TOTALS.withoutChamber);
    expect(
      (await seededTicketBatch(context))?.drafts.find((draft) => draft.localKey === "BA-3"),
    ).toMatchObject({
      selected: false,
    });

    await ticketRow(page, "BA-3").getByRole("checkbox").check();

    await expect(tickets.getByRole("button", { name: "Push 4 tickets to backlog" })).toBeVisible();
    await expect(tickets.locator(".analyzer-tix__total")).toHaveText(TICKET_TOTALS.all);
  });

  test("drafted tickets: a member may tick and may not push — on the page and past it (#519)", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_MEMBER.id);
    await openAnalyzer(page);

    const push = ticketsCard(page).getByRole("button", { name: "Push 4 tickets to backlog" });

    await expect(ticketRow(page, "BA-1").getByRole("checkbox")).toBeEnabled();
    await expect(push).toHaveAttribute("aria-disabled", "true");
    await expect(push).toHaveAttribute(
      "title",
      "Pushing to a tracker is for workspace owners and admins.",
    );

    // Past the page: the role gate is the service's, and nothing was pushed.
    expect(await pushSeededTickets(context)).toEqual({ status: 403, code: "forbidden" });
    expect((await seededTicketBatch(context))?.status).toBe("sized");
  });

  // The selection test's tick is the batch's stored one, so a failure between its two presses
  // would leave leg 24 pushing three drafts instead of the four it states.
  test("predicted vs measured: the pair as the seed measured it, against mockup 18 (#520)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const measured = measurementsCard(page);
    const held = await measurements(context);

    // The side column, in the mockup's order.
    await expect(page.locator(".analyzer__side > *").nth(1)).toHaveAccessibleName(
      MEASUREMENTS_CARD,
    );
    await expect(page.locator(".analyzer__side > *").nth(2)).toHaveAccessibleName(
      HOW_IT_WORKS_CARD,
    );
    await expect(measured.getByText("applied earlier", { exact: true })).toBeVisible();

    // Oldest apply first; the dates are the seed's, the figures the mockup's.
    await expect(measured.locator(".analyzer-pv__name")).toHaveText(
      MEASUREMENTS.map((seeded) => {
        const applied = held.measurements.find((entry) => entry.title === seeded.title);

        return `${seeded.title} (applied ${dayLabel(applied?.appliedOn ?? "")})`;
      }),
    );

    for (const seeded of MEASUREMENTS) {
      const element = measurementRow(page, seeded.title);

      await expect(figure(element, "predicted")).toHaveText(seeded.predicted);
      await expect(figure(element, "measured")).toContainText(seeded.measured);
      await expect(element.locator(".analyzer-pv__note")).toHaveText(
        seeded.note === null ? [] : [seeded.note],
      );
    }

    // The miss is drawn as plainly as the delivery: same face, same size, same weight — and a hue
    // of its own, in both palettes. Only a browser with the sheet applied can say so.
    const [delivered, under] = MEASUREMENTS.map((seeded) => measurementRow(page, seeded.title));
    const face = (element: Locator) =>
      element.evaluate((node) => {
        const style = getComputedStyle(node);

        return [style.fontFamily, style.fontSize, style.fontWeight, style.opacity].join("|");
      });

    expect(await face(figure(under, "measured"))).toBe(await face(figure(delivered, "measured")));

    for (const theme of THEMES) {
      await pinTheme(page, theme);

      const hues = [
        await hue(figure(delivered, "measured")),
        await hue(figure(under, "measured")),
        await hue(figure(under, "predicted")),
      ];

      expect(new Set(hues).size, `${theme}: delivered, missed and predicted are three hues`).toBe(
        3,
      );
    }

    // The caption, and what its *retrains* means: the service's formula and the cells it moved.
    await expect(measured.locator(".analyzer-pv__caption")).toContainText(
      "Every applied suggestion is re-measured for 14 days. The analyzer's model retrains",
    );
    await measured.getByRole("button", { name: /^retrains/ }).click();

    const popover = measured.getByRole("group", { name: "How the analyzer recalibrates" });

    await expect(popover.locator(".analyzer-pv__formula")).toHaveText(held.formula);
    expect(held.formula).toMatch(/^factor = /);

    for (const [index, cell] of RECALIBRATION.entries()) {
      const drawn = popover.locator(".analyzer-pv__cell").nth(index);

      await expect(drawn).toContainText(cell.cell);
      await expect(drawn).toContainText(cell.factor);
      await expect(drawn).toContainText(cell.movedBy);
    }

    // It opens inside the card rather than off the page's edge.
    const [panel, frame] = [await popover.boundingBox(), await measured.boundingBox()];

    expect(panel!.x).toBeGreaterThanOrEqual(frame!.x);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);

    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
  });

  test("how it works: the three steps over the seeded corpus, and where the locality claim is argued (#520)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    const how = howItWorksCard(page);

    // The seeded run read all four classes, so the first line is the mockup's.
    expect((await latestRun(context))?.manifest?.absent).toEqual([]);
    await expect(how.locator(".analyzer-hiw__label")).toHaveText(
      HOW_IT_WORKS.map((step) => step.label),
    );
    await expect(how.locator(".analyzer-hiw__desc")).toHaveText(
      HOW_IT_WORKS.map((step) => step.line),
    );
    await expect(how.locator(".analyzer-hiw__absent")).toHaveCount(0);

    await expect(how.locator(".analyzer-hiw__foot")).toContainText(LOCALITY.note);
    await expect(how.getByRole("link", { name: LOCALITY.link })).toHaveAttribute(
      "href",
      LOCALITY.href,
    );
  });

  test("parity: the seven regions in both themes, on the mockup's calendar (#521)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    // Wide enough that the chart is drawn whole: at the suite's default width it scrolls inside
    // its card, and a picture of it would end mid-chip.
    await page.setViewportSize(PARITY_VIEWPORT);
    // The seed is dated from the day it ran; the pictures are taken on the mockup's day.
    await rewriteAnalyzerPoll(page, onMockupDay);
    await openAnalyzer(page);

    // Pinned: the chips read the mockup's dates, whatever today is.
    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    for (const [index, day] of ["May 18", "Jun 22", "Jul 30"].entries()) {
      await expect(chips(page).nth(index)).toHaveAttribute(
        "title",
        `${day} · ${PLANTED_SHIFTS[index].candidate} ${PLANTED_SHIFTS[index].delta}`,
      );
    }
    await expect(page.locator(".analyzer__main > *, .analyzer__side > *")).toHaveCount(
      REGIONS.length - 1,
    );

    for (const theme of THEMES) {
      await pinTheme(page, theme);

      for (const region of REGIONS) {
        await expect(regionOf(page, region.name)).toHaveScreenshot(
          `analyzer-${region.slug}-${theme}.png`,
          { mask: clocks(page) },
        );
      }
    }
  });

  test("provenance is honest, and the chips sit on the shifts the seed plants (#521)", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openAnalyzer(page);

    // ---- Decision A3: statistics are not dressed as a model, and compute is not a dollar figure.
    const strip = regionOf(page, STRIP_REGION);

    await expect(strip).toContainText("deterministic analyzers v1");
    await expect(strip.locator(".analyzer-strip__model")).toHaveCount(0);
    await expect(strip).not.toContainText("$");
    await expect(page.locator("main.analyzer")).not.toContainText(/\$\d/);

    await strip.getByRole("button", { name: /deterministic analyzers v1/ }).click();

    const analyzers = strip.getByRole("group", { name: "Analyzers in this run" });
    for (const id of ANALYZERS) {
      await expect(analyzers).toContainText(new RegExp(`${id} v1\\s+· deterministic · completed`));
    }
    await expect(analyzers).not.toContainText("llm");
    await page.keyboard.press("Escape");

    // ---- The chips: three, on the days the seed planted its shifts, with their deltas.
    const chart = await durationChart(context);

    expect(chart.changePoints.map((point) => daysBetween(point.date, chart.window!.to))).toEqual(
      PLANTED_SHIFTS.map((shift) => shift.daysBeforeWindowEnd),
    );
    expect(chart.changePoints.map((point) => point.deltaSeconds)).toEqual(
      PLANTED_SHIFTS.map((shift) => shift.deltaSeconds),
    );
    expect(chart.changePoints.map((point) => point.candidates[0]?.label)).toEqual(
      PLANTED_SHIFTS.map((shift) => shift.candidate),
    );

    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    for (const [index, text] of chipTexts(chart).entries()) {
      await expect(chips(page).nth(index)).toHaveAttribute("title", text);
    }
    // The curve is the run's own window: one point per day that timed a build.
    expect(
      (await regionOf(page, CHART_REGION).locator(".chart-ts__line").getAttribute("points"))
        ?.trim()
        .split(/\s+/),
    ).toHaveLength(chart.series.length);
  });

  test("a member reads the whole page: running and scheduling are an administrator's, dismissing is theirs (#521)", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_MEMBER.id);
    await openAnalyzer(page);

    // Every region is read.
    for (const region of REGIONS) await expect(regionOf(page, region.name)).toBeVisible();

    // Run analysis now: the same control, inert, saying why.
    const run = page.getByRole("button", { name: "Run analysis now" });
    await expect(run).toHaveAttribute("aria-disabled", "true");
    await expect(run).toHaveAttribute("title", "Only an owner or admin can run an analysis.");

    // The schedule opens to be read: its note, and no way to save.
    await page.getByRole("button", { name: /^Schedule/ }).click();
    const schedule = page.getByRole("dialog", { name: "Analysis schedule" });
    await expect(schedule).toContainText("Only an owner or admin can change the schedule.");
    await expect(schedule.getByRole("button", { name: "Save schedule" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(schedule).toBeHidden();

    // Dismissing is a member's: the confirm is live. It is not pressed — a dismissal is final.
    await row(page, TITLES.flake).getByRole("button", { name: "Dismiss", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Dismiss", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    expect((await suggestion(context, TITLES.flake)).status).toBe("open");
  });

  test("shell: fixed chrome, Build Farm lit, and the 125% step (#521)", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    try {
      await setFontScale(context, "125");
      await openAnalyzer(page);
      await expectFontScale(page, "125");

      // ---- The analyzer has no entry of its own: the module it belongs to stays lit.
      const sidebar = page.getByRole("navigation", { name: "Primary" });
      await expect(sidebar.getByRole("link", { name: /Build Farm/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(0);

      // ---- The page at the scale still draws all seven regions and every chip.
      for (const region of REGIONS) await expect(regionOf(page, region.name)).toBeVisible();
      await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);

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

  test.afterEach(async ({ browser }) => {
    const context = await browser.newContext();

    try {
      await signInAs(context);
      await retickSeededTickets(context);
    } finally {
      await context.close();
    }
  });
});

test.describe("analyzer — the states mockup 18 does not draw (#521)", () => {
  // No cold guard: these read, and change only what the browser is shown.

  test("insufficient corpus, for real: a repository with no builds, and one with three", async ({
    context,
    page,
  }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);

    // ---- No focus: the page opens on the workspace's first repository, which has no build.
    const empty = await corpus(context, ATLAS.ref);
    expect(empty).toMatchObject({
      builds: 0,
      daysWithBuilds: 0,
      sufficient: false,
      analyzed: null,
    });

    await openRead(page);

    const panel = regionOf(page, INSUFFICIENT_REGION);

    await expect(page.locator("main.analyzer h1")).toHaveText("The analyzer needs more history.");
    await expect(panel.locator(".analyzer-state__count")).toHaveText(
      `No builds in the last ${String(empty.window.days)} days.`,
    );
    await expect(panel).toContainText(
      `It needs builds on at least ${String(empty.minimumDaysWithBuilds)} days before it can tell a shift from noise.`,
    );
    await expect(panel.locator(".analyzer-state__reads")).toContainText(
      "Every build's log and test results, and every loop's transcript",
    );
    // No chart and no suggestions — and no empty frame standing in for either.
    await expect(regionOf(page, CHART_REGION)).toHaveCount(0);
    for (const kind of ["process", "workflow"] as const)
      await expect(card(page, kind)).toHaveCount(0);
    await expect(ticketsCard(page)).toHaveCount(0);
    await expect(page.locator("main.analyzer .chart-ts__line")).toHaveCount(0);
    await expect(page.locator("main.analyzer").getByRole("article")).toHaveCount(0);
    // The explainer stays beside it.
    await expect(howItWorksCard(page)).toBeVisible();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(panel).toHaveScreenshot(`analyzer-insufficient-${theme}.png`);
    }

    // ---- A repository with builds on too few days: its own count, from the service.
    const telemetry = await page.context().browser()!.newContext();

    try {
      await signIn(telemetry, SEED_OWNER.id);
      await selectWorkspace(telemetry, SEED_TENANT.slug);
      await focusRepo(telemetry, TELEMETRY);

      const thin = await corpus(telemetry, TELEMETRY.ref);
      expect(thin.builds, "the seed gives helios-telemetry a few builds").toBeGreaterThan(0);
      expect(thin.daysWithBuilds).toBeLessThan(thin.minimumDaysWithBuilds);
      expect(thin.sufficient).toBe(false);

      const view = await telemetry.newPage();
      await openRead(view);

      const plural = (count: number, noun: string) =>
        `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
      await expect(
        regionOf(view, INSUFFICIENT_REGION).locator(".analyzer-state__count"),
      ).toHaveText(
        `${plural(thin.builds, "build")} on ${plural(thin.daysWithBuilds, "day")} in the last ${String(thin.window.days)}.`,
      );
      await expect(regionOf(view, CHART_REGION)).toHaveCount(0);
      await expect(view.locator("main.analyzer .chart-ts__line")).toHaveCount(0);
    } finally {
      await telemetry.close();
    }
  });

  test("never run: the explainer and a call to action — inert, with the reason, for a member", async ({
    context,
    page,
    browser,
  }) => {
    await signInAs(context);
    await rewriteAnalyzerPoll(page, asNeverRun);
    await openRead(page);

    const panel = regionOf(page, NEVER_RUN_REGION);
    const held = await corpus(context);

    await expect(page.locator("main.analyzer h1")).toHaveText("No analysis has run here yet.");
    // The history it would read is the service's own count — this repository has plenty.
    expect(held.sufficient).toBe(true);
    await expect(panel.locator(".analyzer-state__count")).toHaveText(
      `${held.builds.toLocaleString("en-US")} builds on ${String(held.daysWithBuilds)} days in the last ${String(held.window.days)}.`,
    );
    await expect(panel).toContainText(
      "An analysis charts build duration with the shifts it detects",
    );
    await expect(panel.getByRole("button", { name: FIRST_RUN_ACTION })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // The explainer beside it; no result card, and no empty frame of one.
    await expect(howItWorksCard(page)).toBeVisible();
    await expect(regionOf(page, CHART_REGION)).toHaveCount(0);
    for (const kind of ["process", "workflow"] as const)
      await expect(card(page, kind)).toHaveCount(0);
    await expect(regionOf(page, STRIP_REGION)).toContainText("No analysis yet");

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(panel).toHaveScreenshot(`analyzer-never-run-${theme}.png`, {
        mask: [panel.locator(".analyzer-state__count")],
      });
    }

    // ---- A member is offered the same action, inert, with why.
    const member = await browser.newContext();

    try {
      await signInAs(member, SEED_MEMBER.id);
      const view = await member.newPage();
      await rewriteAnalyzerPoll(view, asNeverRun);
      await openRead(view);

      const action = regionOf(view, NEVER_RUN_REGION).getByRole("button", {
        name: FIRST_RUN_ACTION,
      });
      await expect(action).toHaveAttribute("aria-disabled", "true");
      await expect(action).toHaveAttribute("title", "Only an owner or admin can run an analysis.");
    } finally {
      await member.close();
    }
  });

  test("running: the progress of the analysis, with the last one's results readable under it", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await rewriteAnalyzerPoll(page, asRunning);
    await openAnalyzer(page);

    const progress = regionOf(page, PROGRESS_REGION);

    // The three phases, the one it is in, and a tick per analyzer.
    await expect(progress.locator(".analyzer-progress__phase")).toHaveText([
      "Assembling corpus",
      "Analyzing",
      "Composing suggestions",
    ]);
    await expect(progress.locator('[aria-current="step"]')).toHaveText("Analyzing");
    await expect(
      progress.getByRole("list", { name: "Analyzers" }).getByRole("listitem"),
    ).toHaveCount(ANALYZERS.length);
    await expect(progress.getByRole("status")).toHaveText(
      `Analyzing — 2 of ${String(ANALYZERS.length)} analyzers finished.`,
    );
    await expect(progress.locator(".analyzer-progress__below")).toHaveText(
      /^The results below are the last finished analysis's, from .+ ago — they stay until this one ends\.$/,
    );

    // Underneath, the last finished analysis is all still there.
    for (const region of REGIONS) await expect(regionOf(page, region.name)).toBeVisible();
    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    await expect(card(page, "process").getByRole("article")).toHaveCount(4);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(progress).toHaveScreenshot(`analyzer-running-${theme}.png`, {
        mask: clocks(page),
      });
    }
  });

  test("failed: why, what did not run, and the last finished analysis's results still on the page", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await rewriteAnalyzerPoll(page, asFailed);
    await openAnalyzer(page);

    const progress = regionOf(page, PROGRESS_REGION);

    await expect(progress.getByRole("status")).toHaveText(
      `The analysis failed, and nothing from it is shown. ${ENGINE_UNAVAILABLE}`,
    );
    await expect(
      progress
        .getByRole("list", { name: "Analyzers" })
        .getByRole("listitem")
        .filter({ hasText: "not run" }),
    ).toHaveCount(ANALYZERS.length - 2);
    await expect(progress.locator(".analyzer-progress__below")).toHaveText(
      /^The results below are the last finished analysis's, from .+ ago — this run changed none of them\.$/,
    );
    // The headline still speaks for the corpus that was analysed.
    await expect(page.locator("main.analyzer h1")).toContainText("builds have opinions.");
    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    await expect(card(page, "process").getByRole("article")).toHaveCount(4);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(progress).toHaveScreenshot(`analyzer-failed-${theme}.png`, {
        mask: clocks(page),
      });
    }
  });

  test("stopped at its budget: the findings that were produced, and what did not run", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await rewriteAnalyzerPoll(page, asBudgetExceeded);
    await openAnalyzer(page);

    const progress = regionOf(page, PROGRESS_REGION);
    const analyzers = progress.getByRole("list", { name: "Analyzers" });

    // What did not run is named — by the service's sentence, and analyzer by analyzer.
    await expect(progress.getByRole("status")).toHaveText(
      `Stopped at its budget. ${BUDGET_REASON}`,
    );
    await expect(analyzers).toContainText(
      "waiver_cite timed out — stopped at the run's compute ceiling",
    );
    await expect(analyzers).toContainText(
      "workflow_outcome not run — the run's compute ceiling was reached",
    );
    await expect(analyzers.getByRole("listitem").filter({ hasText: "completed" })).toHaveCount(
      ANALYZERS.length - 2,
    );
    await expect(progress.locator(".analyzer-progress__below")).toHaveText(
      "The results below include what its finished analyzers found; anything from an analyzer that did not finish is an earlier analysis's.",
    );

    // …and the findings that were produced are shown.
    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    await expect(card(page, "process").getByRole("article")).toHaveCount(4);
    await expect(card(page, "workflow").getByRole("article")).toHaveCount(2);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(progress).toHaveScreenshot(`analyzer-budget-${theme}.png`, {
        mask: clocks(page),
      });
    }
  });
});

test.describe("analyzer suggestions — the flows that write (#518)", () => {
  test("apply: the pool move's preview names the change, and the farm then holds exactly it", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    expect((await suggestion(context, TITLES.move)).status, NOT_COLD).toBe("open");

    try {
      await openAnalyzer(page);
      await row(page, TITLES.move).getByRole("button", { name: "Apply", exact: true }).click();

      // The preview: the concrete change, where it lands, and each of its facts.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(MOVE_PREVIEW.summary);
      await expect(dialog).toContainText(MOVE_PREVIEW.lands);

      for (const fact of ["forge-02", "pool-a", "14:00–16:00 UTC", "weekdays (Mon–Fri)"]) {
        await expect(dialog.locator(".analyzer-apply__facts")).toContainText(fact);
      }

      // Nothing is applied by opening it.
      expect(moveWindows(await poolWindows(context))).toEqual([]);

      await dialog.getByRole("button", { name: "Apply", exact: true }).click();

      // The row: applied, measurement pending, and a way to the measurement card.
      const applied = row(page, TITLES.move);
      await expect(dialog).toBeHidden();
      await expect(applied).toContainText(/Applied .+ — measurement pending — day \d+ of \d+/);
      await expect(applied.getByRole("link", { name: "Predicted vs measured" })).toHaveAttribute(
        "href",
        "#predicted-vs-measured",
      );
      await expect(applied.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
      await expect(card(page, "process").getByText("3 open", { exact: true })).toBeVisible();

      // …and that card now holds the measurement the apply opened (#520): a third row, last,
      // counting its days and naming the metric it is taken on — no verdict, and no check.
      const opened = (await measurements(context)).measurements.find(
        (entry) => entry.title === TITLES.move,
      );
      const pending = measurementRow(page, TITLES.move);

      expect(opened).toMatchObject({ verdict: "pending", windowDays: 14 });
      await expect(measurementsCard(page).locator(".analyzer-pv__row")).toHaveCount(3);
      await expect(measurementsCard(page).locator(".analyzer-pv__row").last()).toContainText(
        TITLES.move,
      );
      await expect(pending.locator(".analyzer-pv__name")).toContainText(
        `(applied ${dayLabel(opened!.appliedOn)})`,
      );
      await expect(figure(pending, "measured")).toContainText(
        `day ${String(opened!.day)} of ${String(opened!.windowDays)}`,
      );
      await expect(pending.locator(".analyzer-pv__note")).toHaveText(
        `measuring queue wait (p95, pool-a) until ${dayLabel(opened!.windowEndsOn)}`,
      );
      await expect(pending).not.toContainText("✓");

      // The applied row's link lands on that card.
      await applied.getByRole("link", { name: "Predicted vs measured" }).click();
      await expect(page).toHaveURL(/#predicted-vs-measured$/);
      await expect(measurementsCard(page).getByRole("heading", { level: 2 })).toBeInViewport();

      // The effect is the preview: one window, with the preview's own fields, in the farm's table.
      const made = moveWindows(await poolWindows(context));

      expect(made).toHaveLength(1);
      expect({
        runner: made[0]?.runner.name,
        pool: made[0]?.pool.name,
        daysOfWeek: made[0]?.daysOfWeek,
        startsAt: made[0]?.startsAt,
        endsAt: made[0]?.endsAt,
      }).toEqual(MOVE_PREVIEW.window);
      expect(made[0]?.enabled).toBe(true);
      expect((await suggestion(context, TITLES.move)).status).toBe("applied");

      // And it is still applied on a page that never held the press.
      await page.reload();
      await expect(row(page, TITLES.move)).toContainText(`Applied`);
      await expect(row(page, TITLES.move)).toContainText(`by ${SEED_OWNER.displayName}`);
    } finally {
      await removeMoveWindows(context);
    }
  });

  test("draft: Draft as vN opens the studio on a real draft whose change note cites the suggestion", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    const review = await suggestion(context, TITLES.review);
    expect(review.status, NOT_COLD).toBe("open");

    try {
      await openAnalyzer(page);
      await row(page, TITLES.review)
        .getByRole("button", { name: `Draft as v${String(review.workflow?.nextVersion)}` })
        .click();

      // The preview: the stage delta, the version it becomes, and who publishes.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(/moves `review` \(.+\) to run before `build`/);
      await expect(dialog).toContainText("Workflow studio · standard-fix draft");
      await expect(dialog).toContainText(
        `v${String(review.workflow?.nextVersion)} — only when a person publishes it`,
      );
      await expect(dialog.getByRole("region", { name: "Connections added" })).toContainText(
        "review → build",
      );
      await expect(dialog.getByRole("region", { name: "Connections removed" })).toContainText(
        "implement → build",
      );
      await expect(dialog).toContainText("Publishing remains human.");

      // Nothing is drafted by opening it.
      expect((await standardFixDraft(context)).changeNote).toBeNull();

      await dialog.getByRole("button", { name: "Create draft & open studio" }).click();

      // The browser is in the studio, on the workflow the suggestion names.
      await page.waitForURL(`**${STANDARD_FIX.path}`);
      await expect(page.getByRole("heading", { level: 1, name: STANDARD_FIX.title })).toBeVisible();

      // The draft is real: it cites the suggestion, and carries the preview's re-wiring.
      const draft = await standardFixDraft(context);

      expect(draft.changeNote).toContain(
        `Proposed by the Build Analyzer (suggestion ${review.id})`,
      );
      expect(draft.changeNote).toContain(TITLES.review);
      expect(draft.edges).toContain("review → build");
      expect(draft.edges).toContain("implement → review");
      expect(draft.edges).not.toContain("implement → build");

      // Nothing was published: the version in force is the one it was.
      expect((await suggestion(context, TITLES.review)).workflow?.nextVersion).toBe(
        review.workflow?.nextVersion,
      );

      // Back on the analyzer, the row says a draft was created and that publishing is a person's.
      await openAnalyzer(page);
      await expect(row(page, TITLES.review)).toContainText(
        /Draft created .+ — publishing remains a person's step/,
      );
      await expect(
        row(page, TITLES.review).getByRole("link", { name: "Open in the studio" }),
      ).toHaveAttribute("href", STANDARD_FIX.path);
    } finally {
      // The studio and code-editor legs open this document as the seed wrote it.
      await restoreStandardFixDraft(context);
    }
  });

  test("run analysis: a real run reproduces the seeded findings, and the chart is redrawn from it (#521)", async ({
    context,
    page,
  }) => {
    test.setTimeout(ANALYSIS_TIMEOUT_MS + 60_000);
    await signInAs(context);

    const seeded = await durationChart(context);
    expect(
      seeded.changePoints,
      "the seed's three change-points are what the chart starts from",
    ).toHaveLength(PLANTED_SHIFTS.length);

    await openAnalyzer(page);
    const run = await analyseToEnd(page, context);

    // ---- The page followed the real run to its end.
    await expect(regionOf(page, PROGRESS_REGION).getByRole("status")).toHaveText(
      `Analysis complete — ${String(LIVE_ANALYZERS.length)} analyzers finished.`,
      { timeout: ANALYSIS_TIMEOUT_MS },
    );

    // ---- The analyzers with their inputs ran; the others say which input a live corpus lacks.
    const ended = (status: string) =>
      run.progress.analyzers.filter((entry) => entry.status === status).map((entry) => entry.id);

    expect(ended("completed")).toEqual(LIVE_ANALYZERS);
    expect(ended("skipped")).toEqual(ANALYZERS.filter((id) => !LIVE_ANALYZERS.includes(id)));
    for (const entry of run.progress.analyzers.filter((each) => each.status === "skipped")) {
      expect(entry.reason, `${entry.id} says what it lacked`).toMatch(/^the corpus lacks /);
    }

    // ---- The chart is the new run's now — and the statistics found what the seed planted:
    // the same days, the same deltas, the same top candidates.
    const live = await durationChart(context);

    expect(live.runId, "the chart is drawn from the run that just ended").toBe(run.id);
    expect(live.runId).not.toBe(seeded.runId);
    expect(
      live.changePoints.map((point) => [
        point.date,
        point.deltaSeconds,
        point.candidates[0]?.label,
      ]),
      "the change-point analyzer reproduces the seeded findings",
    ).toEqual(
      seeded.changePoints.map((point) => [
        point.date,
        point.deltaSeconds,
        point.candidates[0]?.label,
      ]),
    );
    expect(live.changePoints.map((point) => point.deltaSeconds)).toEqual(
      PLANTED_SHIFTS.map((shift) => shift.deltaSeconds),
    );

    // ---- …and a page drawn after it carries those chips, with provenance still honest.
    await page.reload();
    await expect(chips(page)).toHaveCount(PLANTED_SHIFTS.length);
    for (const [index, text] of chipTexts(live).entries()) {
      await expect(chips(page).nth(index)).toHaveAttribute("title", text);
    }

    const strip = regionOf(page, STRIP_REGION);
    await expect(strip).toContainText("deterministic analyzers v1");
    await expect(strip.locator(".analyzer-strip__model")).toHaveCount(0);
    await expect(strip).not.toContainText("$");
  });

  test("dismiss: a dismissed row stays dismissed across two real analyses, and what they re-find keeps its identity", async ({
    context,
    page,
  }) => {
    test.setTimeout(2 * ANALYSIS_TIMEOUT_MS + 60_000);
    await signInAs(context);
    expect((await suggestion(context, TITLES.flake)).status, NOT_COLD).toBe("open");

    await openAnalyzer(page);

    // The first of the two analyses: before the dismissal.
    const first = await analyseToEnd(page, context);

    await row(page, TITLES.flake).getByRole("button", { name: "Dismiss", exact: true }).click();

    // The guarantee is stated before the dismissal is made.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("won't be suggested again");
    await confirm.getByLabel("Reason (optional)").fill("The telemetry suite is being rewritten.");
    await confirm.getByRole("button", { name: "Dismiss", exact: true }).click();

    // Resolved at once, with its guarantee and its reason.
    const dismissed = row(page, TITLES.flake);
    await expect(dismissed).toContainText(/Dismissed .+ — won't be suggested again/);
    await expect(dismissed).toContainText("The telemetry suite is being rewritten.");
    await expect(dismissed.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
    await expect
      .poll(async () => (await suggestion(context, TITLES.flake)).status)
      .toBe("dismissed");

    // The second: a real re-analysis after it, run to its end. Two runs, both complete.
    const second = await analyseToEnd(page, context);

    expect(second.id, "the analyzer genuinely ran twice").not.toBe(first.id);

    // Still dismissed: in the database, and on a page drawn after the run.
    expect((await suggestion(context, TITLES.flake)).status).toBe("dismissed");

    // Identity, where a live run exercises it: both runs met the fixture-timeout ticket again
    // (`log_signature` runs on a live corpus), and it is still the one suggestion the seed
    // drafted — an identity that changed between runs would have composed it a second time, open.
    const tickets = await ticketTitles(context);
    const refound = TICKETS[0].title;

    expect(
      tickets.drafted.filter((title) => title === refound),
      "the re-found ticket is still one drafted suggestion",
    ).toHaveLength(1);
    expect(tickets.undrafted, "nothing was composed again under a new identity").not.toContain(
      refound,
    );

    await page.reload();
    await expect(row(page, TITLES.flake)).toContainText(
      `by ${SEED_OWNER.displayName} — won't be suggested again`,
    );
    await expect(row(page, TITLES.flake).getByRole("button", { name: /Draft as/ })).toHaveCount(0);
    await expect(card(page, "workflow").getByRole("article")).toHaveCount(2);
    // …and on the page the drafted tickets are the seeded four, with no *Not drafted yet* group.
    await expect(ticketsCard(page).getByRole("checkbox", { name: /^Include BA-/ })).toHaveCount(
      TICKETS.length,
    );
    await expect(ticketsCard(page).getByText("Not drafted yet")).toHaveCount(0);

    // The run that just finished read a live corpus, and this deployment exports no rig telemetry
    // (#520): the explainer stops listing it as ingested and says it was not read, with the
    // manifest's own reason.
    const absent = (await latestRun(context))?.manifest?.absent ?? [];
    const ingest = howItWorksCard(page).getByRole("listitem").first();

    expect(absent.map((entry) => entry.source)).toEqual(["rig_telemetry"]);
    await expect(ingest.locator(".analyzer-hiw__desc")).toContainText("build logs");
    await expect(ingest.locator(".analyzer-hiw__desc")).not.toContainText("rig telemetry");
    await expect(ingest.locator(".analyzer-hiw__absent")).toHaveText(
      `not read rig telemetry — ${absent[0].reason}`,
    );
  });

  test("a thin repository stays insufficient through a real analysis of it (#521)", async ({
    context,
    page,
  }) => {
    test.setTimeout(ANALYSIS_TIMEOUT_MS + 60_000);
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await focusRepo(context, TELEMETRY);

    await openRead(page);
    await expect(regionOf(page, INSUFFICIENT_REGION)).toBeVisible();

    // An analysis may still be started on a thin corpus, and it runs to its end.
    const run = await analyseToEnd(page, context, TELEMETRY.ref);

    // It judged its corpus — as too thin — and the service does hold what it timed.
    const state = await corpus(context, TELEMETRY.ref);
    const timed = await durationChart(context, TELEMETRY.ref);

    expect(state.analyzed).toMatchObject({ runId: run.id, sufficient: false });
    expect(timed.runId).toBe(run.id);
    expect(
      timed.series.length,
      "the run timed a few days — there is something to withhold",
    ).toBeGreaterThan(0);
    expect(timed.series.length).toBeLessThan(state.minimumDaysWithBuilds);

    // The page draws none of it: the same state, now naming the analysis that read too little.
    await page.reload();
    await expect(page.locator("main.analyzer h1")).toHaveText("The analyzer needs more history.");

    const panel = regionOf(page, INSUFFICIENT_REGION);
    await expect(panel).toContainText(
      /The last analysis read \d+ builds? on \d+ days? — too little/,
    );
    await expect(regionOf(page, CHART_REGION)).toHaveCount(0);
    await expect(page.locator("main.analyzer .chart-ts__line")).toHaveCount(0);
    await expect(page.locator("main.analyzer").getByRole("article")).toHaveCount(0);
  });
});
