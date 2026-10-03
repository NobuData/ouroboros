/**
 * Leg 23 — **the Build Analyzer's suggestion cards**
 * ([#518](https://github.com/NobuData/ouroboros/issues/518), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
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
  MOVE_PREVIEW,
  NOT_COLD,
  ROWS,
  TITLES,
  applyStatusFor,
  focusHelios,
  latestRun,
  moveWindows,
  poolWindows,
  removeMoveWindows,
  standardFixDraft,
  suggestion,
  suggestions,
} from "../support/analyzer";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { STANDARD_FIX, restoreStandardFixDraft } from "../support/studio";
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
  });
});
