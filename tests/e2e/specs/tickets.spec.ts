/**
 * Leg 24 — **the Build Analyzer's drafted tickets, pushed**
 * ([#519](https://github.com/NobuData/ouroboros/issues/519), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Mockup 18's **Drafted tickets — from patterns, not people** is the analyzer's most concrete
 * output: work in the team's tracker. Leg 23 draws the card as the seed composes it. This leg is
 * the chain behind its button, in one traversal — because every link of it is a claim about a
 * *different* service, and the only honest reading of each is the one that service gives:
 *
 *   * **Edit drafts** opens the planning page's own editor on the batch — whose **Regenerate** is
 *     inert, because re-planning would replace the analyzer's drafts — and a title edited there
 *     is the title the card shows on return, **and the title of the issue the tracker then holds**;
 *   * **selection is respected exactly** — `BA-3` unticked, three drafts pushed, and the sandbox
 *     tracker holds three issues and no fourth;
 *   * **a failure is legible and retryable** — the tracker refuses one creation mid-batch, that
 *     row says why and offers **Retry**, the others carry their tracker links;
 *   * **a retry does not duplicate** — after it the tracker holds *exactly* the three, each once,
 *     and a further push is refused rather than filed again;
 *   * **the evidence travels** — each issue's body, read through the tracker's own API, carries
 *     the evidence line, the references and the suggestion it came from;
 *   * **the loop closes** — the toast links to Issues, where, after the backlog's own sync, the
 *     pushed tickets are;
 *   * and what is left on the card is a summary, not an empty box.
 *
 * ## Why it is a file of its own, and last
 *
 * A push files canonical tickets and — once the intake mirror syncs — backlog rows. The planning
 * leg's *Tracker sync* card and the intake and dashboard legs' parity all count those, so this leg
 * must run after them; Playwright runs spec files in name order with one worker, and `tickets`
 * sorts after `planning`, `issues` and `dashboard`. Leg 23 (`analyzer.spec.ts`) sorts first, which
 * is why the chain is not there.
 *
 * ## Green from a cold volume only
 *
 * A pushed batch is closed by design: it cannot be pushed, unticked or edited again. The
 * `beforeAll` says so in words on a stack that has already run this leg. What can be put back,
 * is: the sandbox tracker is reset and the workspace's GitHub token removed.
 */
import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  ANALYZER_PATH,
  SEEDED_TICKET_BATCH_ID,
  TICKETS,
  TICKETS_CARD,
  TICKETS_NOT_COLD,
  TICKET_TOTALS,
  focusHelios,
  pushSeededTickets,
  seededTicketBatch,
} from "../support/analyzer";
import { ISSUES_PATH, TABLE_CAPTION } from "../support/issues";
import { connectSeededSource } from "../support/knowledge";
import {
  type TrackerIssue,
  clearGithubToken,
  refuseOneCreate,
  resetTracker,
  setGithubToken,
  syncIntakeMirror,
  tracker,
} from "../support/planning";
import { quietly } from "../support/rest";
import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { selectWorkspace } from "../support/workspace";

/** How long a push is given — three creations, each probed for first, against the sandbox. */
const PUSH_MS = 30_000;

/** What the planning editor's title edit writes over `BA-4`'s. */
const EDITED_TITLE = "Delete the 12 dead Kconfig options (edited before the push)";

/** The three drafts the chain pushes — every seeded one but the thermal chamber. */
const PUSHED = TICKETS.filter((ticket) => ticket.key !== "BA-3");

/**
 * Sign the owner into the seeded workspace, with the page set to open on the seeded repository.
 *
 * @param context The browser context.
 */
async function signInAsOwner(context: BrowserContext): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
  await focusHelios(context);
}

/**
 * The drafted-tickets card.
 *
 * @param page The page.
 * @returns Its region.
 */
function card(page: Page): Locator {
  return page.locator("main.analyzer").getByRole("region", { name: TICKETS_CARD });
}

/**
 * A drafted ticket's row, by its batch-local key.
 *
 * @param page The page.
 * @param key The key — `BA-3`.
 * @returns The row's list item.
 */
function row(page: Page, key: string): Locator {
  return card(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: `Include ${key}` }) });
}

/**
 * Open the analyzer and wait until the card holds its rows.
 *
 * @param page The page.
 */
async function openAnalyzer(page: Page): Promise<void> {
  await page.goto(ANALYZER_PATH);
  await expect(card(page).getByRole("checkbox", { name: "Include BA-1" })).toBeVisible();
}

/**
 * The tracker's issue with one title.
 *
 * @param issues What the tracker holds.
 * @param title The draft's title.
 * @returns The issue.
 * @throws When nothing carries it — the failure a caller wants named.
 */
function issueTitled(issues: readonly TrackerIssue[], title: string): TrackerIssue {
  const found = issues.find((issue) => issue.title === title);

  if (found === undefined) throw new Error(`the tracker holds no issue titled "${title}"`);

  return found;
}

test.describe("analyzer drafted tickets — the push chain (#519)", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();

    try {
      await signInAsOwner(context);

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

  test("edits in planning, pushes what is ticked through a refusal and a retry, and finds exactly those tickets in the tracker and in intake", async ({
    context,
    page,
    request,
  }) => {
    // One traversal across four services. `slow()` triples this test's timeout rather than
    // raising the suite's budget.
    test.slow();

    const sandbox = tracker(request);

    await resetTracker(request);
    await signInAsOwner(context);
    // The seed's source credential is a placeholder the vault cannot open; a push authenticates
    // as the source, so one a person would have connected is stored first. And the intake mirror
    // authenticates as the workspace, which the seed gives no token.
    await connectSeededSource(context);
    await setGithubToken(context);
    await openAnalyzer(page);

    /* -------------------------------------------------- Edit drafts → the planning editor */

    await card(page).getByRole("link", { name: "Edit drafts" }).click();
    await expect(page).toHaveURL(new RegExp(`/planning\\?batch=${SEEDED_TICKET_BATCH_ID}$`));

    // One editor, one set of rules — and one of them is this ticket's: an analyzer batch is
    // edited, never re-planned from the line it was filed under.
    const regenerate = page.getByRole("button", { name: "Regenerate" });

    await expect(regenerate).toHaveAttribute("aria-disabled", "true");
    await expect(regenerate).toHaveAttribute("title", /The Build Analyzer drafted these/);
    await expect(page.getByRole("checkbox", { name: /^Include BA-/ })).toHaveCount(TICKETS.length);

    await page.getByRole("button", { name: "Edit BA-4" }).click();
    await page.getByLabel("Title").fill(EDITED_TITLE);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(EDITED_TITLE)).toBeVisible();

    // …and the edit is what the card shows on return.
    await page.goBack();
    await expect(row(page, "BA-4").locator(".analyzer-tix__title")).toHaveText(EDITED_TITLE);

    /* -------------------------------------------------- untick one, and refuse one creation */

    await row(page, "BA-3").getByRole("checkbox").uncheck();
    await expect(
      card(page).getByRole("button", { name: "Push 3 tickets to backlog" }),
    ).toBeVisible();
    await expect(card(page).locator(".analyzer-tix__total")).toHaveText(
      TICKET_TOTALS.withoutChamber,
    );

    // One creation goes through, the next is refused, and the walk carries on to the third.
    await refuseOneCreate(request, 1);
    await card(page).getByRole("button", { name: "Push 3 tickets to backlog" }).click();

    const toast = card(page).locator(".analyzer-toast");

    await expect(toast).toContainText("Pushed 2 tickets to GitHub; 1 ticket did not land", {
      timeout: PUSH_MS,
    });

    // Per draft: two carry the tracker's own number, linking there; one says why it failed and
    // offers the retry; the unticked one says nothing, because nothing happened to it.
    await expect(card(page).getByRole("link", { name: /^pushed ✓ #\d+$/ })).toHaveCount(2);
    await expect(card(page).getByRole("button", { name: /^Retry/ })).toHaveCount(1);
    await expect(card(page).locator(".analyzer-tix__failed")).toContainText("failed —");
    await expect(row(page, "BA-3")).not.toContainText("pushed");
    await expect(row(page, "BA-3")).not.toContainText("failed");
    await expect(card(page).getByRole("button", { name: "Resume push" })).toBeVisible();

    expect(
      await sandbox.issues(),
      "the tracker holds more or fewer than the two that landed",
    ).toHaveLength(2);

    /* -------------------------------------------------- retry: no duplicates */

    await card(page)
      .getByRole("button", { name: /^Retry/ })
      .click();

    await expect(card(page)).toContainText(
      "3 of 4 drafts were pushed to GitHub. BA-3 was left out.",
      {
        timeout: PUSH_MS,
      },
    );
    await expect(toast).toContainText("Pushed 1 ticket to GitHub.");

    const filed = await sandbox.issues();
    const titles = [TICKETS[0].title as string, TICKETS[1].title as string, EDITED_TITLE];

    // **Exactly N−1**: the three ticked drafts, each once — not four, and not a second copy of
    // the two the first push had already filed.
    expect(
      filed.map((issue) => issue.title).sort(),
      "the tracker's issues are not the three ticked drafts",
    ).toEqual([...titles].sort());
    expect(
      filed.map((issue) => issue.title),
      "the unticked draft reached the tracker",
    ).not.toContain(TICKETS[2].title);

    // **The evidence travelled.** Read from the tracker, not from the row that wrote it.
    for (const ticket of PUSHED) {
      const issue = issueTitled(
        filed,
        ticket.key === "BA-4" ? EDITED_TITLE : (ticket.title as string),
      );

      expect(issue.body, `${ticket.key}'s issue lost its evidence line`).toContain(
        `**Evidence:** ${ticket.evidence}`,
      );
      expect(issue.body, `${ticket.key}'s issue lost its references`).toMatch(
        /\*\*References:\*\*\n- [a-z_]+ `[0-9a-f-]+`/,
      );
      expect(issue.body, `${ticket.key}'s issue does not say which analysis it came from`).toMatch(
        /Drafted by the Build Analyzer from suggestion `[0-9a-f-]{36}` .* analysis run `[0-9a-f-]{36}`\./,
      );
    }

    // …and a push pressed again — past the page, which no longer offers one — files nothing.
    expect(await pushSeededTickets(context)).toEqual({ status: 409, code: "batch_not_pushable" });
    expect(await sandbox.issues(), "a further push filed another issue").toHaveLength(3);

    /* -------------------------------------------------- what is left on the card */

    // Each pushed draft links to its tracker issue by the tracker's own number.
    for (const issue of filed) {
      await expect(
        card(page).getByRole("link", { name: `#${String(issue.number)}` }),
      ).toBeVisible();
    }
    await expect(card(page).getByRole("link", { name: "Open the batch" })).toHaveAttribute(
      "href",
      `/planning?batch=${SEEDED_TICKET_BATCH_ID}`,
    );
    await expect(card(page).getByRole("checkbox")).toHaveCount(0);

    /* -------------------------------------------------- the toast → intake */

    const openIssues = toast.getByRole("link", { name: "Open Issues" });

    await expect(openIssues).toHaveAttribute("href", ISSUES_PATH);
    await expect(toast).toContainText("They appear in Issues once the backlog has synced.");

    // The backlog's own sync — the route a person's *sync now* calls — is what brings them home.
    await syncIntakeMirror(context);
    await openIssues.click();
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    // Each by the number the tracker gave it — the same one its row on the card links to.
    for (const issue of filed) {
      await page.goto(`${ISSUES_PATH}?q=${encodeURIComponent(issue.title)}`);
      await expect(
        page
          .getByRole("grid", { name: TABLE_CAPTION })
          .locator("tbody tr")
          .filter({ has: page.getByText(`#${String(issue.number)}`, { exact: true }) }),
        `intake does not list #${String(issue.number)}, "${issue.title}"`,
      ).toContainText(issue.title);
    }

    /* -------------------------------------------------- and it is still so after a reload */

    await page.goto(ANALYZER_PATH);
    await expect(card(page)).toContainText(
      "3 of 4 drafts were pushed to GitHub. BA-3 was left out.",
    );
    expect((await seededTicketBatch(context))?.status).toBe("pushed");
  });

  test.afterEach(async ({ context, request }) => {
    await quietly(
      () => clearGithubToken(context),
      "the workspace still holds this leg's GitHub token — the intake leg's *sync paused* " +
        "guidance is about a workspace that has none.",
    );
    await quietly(
      () => resetTracker(request),
      "the sandbox tracker still holds this run's issues — the next run's count would include them.",
    );
  });
});
