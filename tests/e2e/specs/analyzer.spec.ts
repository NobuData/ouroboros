/**
 * Leg 23 — **the Build Analyzer's suggestion cards**
 * ([#518](https://github.com/NobuData/ouroboros/issues/518), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)) — **its drafted-tickets card as the
 * seed composes it** ([#519](https://github.com/NobuData/ouroboros/issues/519)) **and its
 * predicted-vs-measured and how-it-works cards**
 * ([#520](https://github.com/NobuData/ouroboros/issues/520)).
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
 * ## One honest limit of the dismissal assertion
 *
 * The run the leg starts is a real one — the corpus assembled, the engine dispatched, three
 * analyzers completing and a ticket draft re-composed — but the analyzer behind the dismissed row
 * (`workflow_outcome`) is `skipped` on a live corpus until its assembler fills that analyzer's
 * inputs, so the composer does not meet this suggestion again. What this leg proves is therefore
 * that a dismissal **holds across a real run and a reload, in the database and on the page** —
 * and that a run which did not look for a suggestion does not take it off the cards. That the
 * composer keeps a suggestion dismissed when it *does* find it again is asserted where it can be
 * made to: `suggestions.integration-spec.ts` and `actions.integration-spec.ts` in `ouroboros-rest`.
 *
 * ## Green from a cold volume only
 *
 * A resolution is final by design, so this leg cannot put its rows back (`support/analyzer.ts` §
 * *What this leg writes*). The first block's `beforeAll` says so in words; the writers sit outside
 * it and state their own preconditions, because Playwright starts a new worker after a failed test
 * and would run the guard again after one of them had written. What can be put back is: the pool
 * window is deleted and `standard-fix`'s draft is restored to the seeded document.
 *
 * [#521](https://github.com/NobuData/ouroboros/issues/521) (BW.6) extends this file with the
 * page's states and the rest of the chain.
 */
import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  ANALYZER_PATH,
  CARDS,
  HOW_IT_WORKS,
  HOW_IT_WORKS_CARD,
  LOCALITY,
  MEASUREMENTS,
  MEASUREMENTS_CARD,
  MOVE_PREVIEW,
  NOT_COLD,
  RECALIBRATION,
  ROWS,
  SEEDED_TICKET_BATCH_ID,
  TICKETS,
  TICKETS_CARD,
  TICKETS_NOT_COLD,
  TICKET_TOTALS,
  TITLES,
  applyStatusFor,
  dayLabel,
  focusHelios,
  latestRun,
  measurements,
  moveWindows,
  poolWindows,
  pushSeededTickets,
  removeMoveWindows,
  retickSeededTickets,
  seededTicketBatch,
  standardFixDraft,
  suggestion,
  suggestions,
} from "../support/analyzer";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { STANDARD_FIX, restoreStandardFixDraft } from "../support/studio";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** How long a real analysis is given to run to its end — assemble, dispatch, analyze, compose. */
const ANALYSIS_TIMEOUT_MS = 120_000;

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

  test("dismiss: a dismissed row stays dismissed across a real re-analysis", async ({
    context,
    page,
  }) => {
    test.setTimeout(ANALYSIS_TIMEOUT_MS + 60_000);
    await signInAs(context);
    expect((await suggestion(context, TITLES.flake)).status, NOT_COLD).toBe("open");

    const before = await latestRun(context);

    await openAnalyzer(page);
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

    // A real re-analysis, run to its end.
    await page.getByRole("button", { name: "Run analysis now" }).click();
    await expect
      .poll(async () => (await latestRun(context))?.id, { timeout: ANALYSIS_TIMEOUT_MS })
      .not.toBe(before?.id);
    await expect
      .poll(async () => (await latestRun(context))?.status, { timeout: ANALYSIS_TIMEOUT_MS })
      .not.toBe("running");

    // Still dismissed: in the database, and on a page drawn after the run.
    expect((await suggestion(context, TITLES.flake)).status).toBe("dismissed");

    await page.reload();
    await expect(row(page, TITLES.flake)).toContainText(
      `by ${SEED_OWNER.displayName} — won't be suggested again`,
    );
    await expect(row(page, TITLES.flake).getByRole("button", { name: /Draft as/ })).toHaveCount(0);
    await expect(card(page, "workflow").getByRole("article")).toHaveCount(2);

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
});
