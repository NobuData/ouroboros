/**
 * Leg 20 — the PR verification page's states, and the TOCTOU assertion
 * ([#370](https://github.com/NobuData/ouroboros/issues/370), AY.8), against the AW.5 seed
 * ([#356](https://github.com/NobuData/ouroboros/issues/356)).
 *
 * Mockup 12 draws one state: a PR being verified at `5 of 7`. This leg draws that one at parity
 * and then the ones that appear after something has finished, or gone wrong.
 *
 * * **Parity** — the seeded `#514` in both palettes: the mockup's head, strip, gates, matrix,
 *   files, thread, plan and spend, with the one thing the mockup does not say — that no sync has
 *   ever asked the host about this PR, because the seed wrote it.
 * * **The states** — merged with its receipt, closed without merging, a plan a re-check disarmed
 *   (and **which** re-check), blocked, and a sync gone quiet.
 * * **Who is reading** — a member offered no arm, no waive and no approve.
 * * **The shell** — header and sidebar fixed while the content pane scrolls, the originating
 *   module's sidebar entry lit, and the page correct at the 125 % font-scale step.
 * * **TOCTOU** — the seeded PR armed for real, a gate turned red before the last one is green,
 *   and **no merge**: the plan disarmed by the executor's re-check, with the reason on the page.
 *
 * ## The TOCTOU test changes the seeded PR, and runs last
 *
 * Arming, requesting a review and declining it are writes nothing undoes: an approval slot is
 * answered once, a declined approval leaves `human_approval` required and red, and the PR ends
 * `blocked` with its plan disarmed. So the test is the last to run in this file, after every test
 * that reads the seeded `#514`, and the leg takes the planning leg's position (`support/planning.ts`):
 * **it is green from a cold volume and does not pretend to clean up.** A second run against a
 * `--keep` stack finds `#514` blocked and the parity test red by design — `docker compose down
 * -v` is the fix, and CI never meets it, because CI always starts cold. The block's `beforeAll`
 * says so once, in words, rather than leaving twelve assertions to time out on a pill.
 *
 * It runs against the seeded PR rather than a sandbox one because it can: the executor's
 * re-check reads the gates before it asks the host anything (`merge.recheck.ts`), so a gate
 * that went red after arming is refused in the database, and the seeded source's unusable
 * credential is never reached. What it cannot assert is the host's side of *no merge* — there
 * is no host — so it asserts the plan's: nothing recorded, nothing merged, disarmed and why.
 *
 * ## The live chain is parked
 *
 * The issue's second item — a sandbox branch and PR created, its sync appearing as revision 1,
 * gates evaluated, a criterion waived with the annotation read back from the host, then arm, the
 * last gate flipped, and a real squash merge with the branch deleted, the ticket closed and the
 * evidence comment asserted — is written down here as `test.fixme`, because four things it
 * stands on do not exist yet:
 *
 * 1. **Nothing triggers a PR sync.** `PrSyncService.sync` has one caller, the merge executor,
 *    after a merge. There is no poll loop, no webhook and no route, so a PR opened on a host
 *    never appears.
 * 2. **A synced PR has no run** — linking one is AZ.5
 *    ([#375](https://github.com/NobuData/ouroboros/issues/375)). Without a run every gate is
 *    required, `model_review` stays `unavailable`, and the PR can never be merge-ready; and a
 *    waive answers `409 criterion_waiver_needs_run`.
 * 3. **The sandbox host serves no pull requests.** `fixtures/tracker-stub` is a GitHub that
 *    holds issues; pulls, merges, comments and refs are not among its routes.
 * 4. **The seeded source's credential cannot be opened** — by design
 *    (`R__dev_seed_sources.sql`) — so nothing reaches a host on `#514`'s behalf.
 *
 * What the chain would prove beneath the browser is proved by `ouroboros-rest`'s suites on the
 * in-memory host: `merge.integration-spec.ts` (the squash, the branch, the ticket, the evidence
 * comment, the epic note), `criteria.integration-spec.ts` (the annotation) and
 * `pr-sync.integration-spec.ts` (revision 1). Its failure-mode pairs — sync and the gate engine
 * — are registered in `scripts/verify-failure-modes.sh` as parked, so the day the test runs the
 * script starts checking it.
 *
 * ## What is intercepted, and why that is honest
 *
 * `support/pull-requests.ts` says it in full: the seed holds one PR and it is `verifying`, so
 * the merged, closed, blocked and disarmed states are drawn by rewriting **the browser's own
 * poll** of the page on its way back. The first paint is the service's answer; what the poll
 * carries is the service's answer with a state changed.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  HOST_CONFLICT_MESSAGE,
  NO_SUCH_PR_ID,
  SEEDED_PR,
  asBlocked,
  asClosed,
  asDisarmed,
  asMerged,
  prPath,
  rewritePoll,
  syncedAt,
  withReviewWaiting,
} from "../support/pull-requests";
import { requestAs } from "../support/rest";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** A window wide enough for the head beside its actions and tall enough for the page whole. */
const PARITY_WINDOW = { width: 1920, height: 3200 };

/** The head's pill once the PR is blocked — the state, whatever the engine counts. */
const BLOCKED_PILL = /^blocked — \d+ of \d+ gates green$/;

/** The note the TOCTOU test declines with. */
const DECLINE_NOTE = "Overshoot margin is too thin to merge unattended.";

/*
 * What a test says when the layer under it broke — the "fails meaningfully" half of the gate.
 * Each is printed with the assertion that went red, so the log names the layer rather than only
 * a timeout.
 */

/** The head never drew: the page read found no seeded PR. */
const READ_MODEL_BROKE =
  "the seeded PR #514 must draw its head — the page reads the PR, its revisions and its gates out of the PR read model";

/** The PR is not as the seed left it: this stack has already run the TOCTOU test. */
const NOT_COLD =
  "the seeded PR #514 must be verifying at 5 of 7 — this leg is green from a cold volume; `docker compose down -v` a stack that has already run it";

/** The plan did not arm: the merge executor refused, or never answered. */
const ARM_BROKE =
  "the plan must arm — arming records the intent against the revision looked at, in the merge executor";

/** The gate never turned red: the engine did not re-evaluate on the answer. */
const GATE_ENGINE_BROKE =
  "human approval must turn red — the gate engine re-evaluates the gate when an approval is answered";

/** The plan was not disarmed for the gate: the re-check did not run, or did not look. */
const RECHECK_BROKE =
  "the plan must disarm naming the red gate — the merge executor re-checks the gates before it asks the host anything";

/** Something merged: the one thing this test exists to refuse. */
const MERGED_ANYWAY =
  "nothing may merge — a gate went red after arming, and the re-check must refuse the merge";

/**
 * Sign a seeded person into the seeded workspace.
 *
 * @param context The browser context.
 * @param userId Who. Defaults to the owner.
 * @returns When the session is ready.
 */
async function signInAs(context: BrowserContext, userId: string = SEED_OWNER.id): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
}

/**
 * The page's `<main>` — visible only, because while the page streams React keeps a hidden copy
 * of the segment in the DOM (leg 17's note).
 *
 * @param page The PR page.
 * @returns The landmark.
 */
function main(page: Page): Locator {
  return page.locator("main.prv").filter({ visible: true });
}

/**
 * The head's aggregate pill.
 *
 * @param page The PR page.
 * @returns The pill.
 */
function pill(page: Page): Locator {
  return main(page).locator(".prv-head__meta .ou-chip").first();
}

/**
 * The state banner.
 *
 * @param page The PR page.
 * @returns The banner.
 */
function stateBanner(page: Page): Locator {
  return main(page).getByRole("status", { name: "Pull request state" });
}

/**
 * The sync-lag banner.
 *
 * @param page The PR page.
 * @returns The banner.
 */
function lagBanner(page: Page): Locator {
  return main(page)
    .locator(".ou-retry")
    .filter({ hasText: /synced with its host/ });
}

/**
 * The head's actions.
 *
 * @param page The PR page.
 * @returns The group.
 */
function actions(page: Page): Locator {
  return main(page).getByRole("group", { name: "PR actions" });
}

/**
 * A card, by its title.
 *
 * @param page The PR page.
 * @param title The card's title.
 * @returns The region.
 */
function card(page: Page, title: string): Locator {
  return main(page).getByRole("region", { name: title });
}

/**
 * What prints a clock the seed decided: when the volume was seeded is not the design's to fix.
 *
 * @param page The PR page.
 * @returns The strip's labels and every `<time>`.
 */
function clocks(page: Page): Locator[] {
  return [main(page).locator(".prv-step__label"), main(page).locator("time")];
}

/**
 * Open the seeded PR and wait for its head.
 *
 * @param page The page.
 * @param query The query, without its `?`.
 * @returns When the head has drawn.
 */
async function openSeeded(page: Page, query = ""): Promise<void> {
  await page.goto(prPath(SEEDED_PR.id, query));
  await expect(main(page).locator(".ou-eyebrow").first(), READ_MODEL_BROKE).toHaveText(
    SEEDED_PR.eyebrow,
  );
}

test.describe("the PR verification page's states (#370)", () => {
  // Every test here reads the seeded PR as the seed left it, and the last one changes it for
  // good — see this file's header. A stack that has already run the leg is told so once, at the
  // start and in words, rather than by twelve assertions timing out on a pill. The one read
  // this leg makes beneath the browser, and it asserts nothing about the page.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();

    try {
      await signInAs(context);

      const seeded = await requestAs<{
        pullRequest: { state: string };
        plan: { armed: boolean; disarmReason: unknown; mergedResult: unknown };
        review: unknown;
      }>(
        context,
        "GET",
        `/api/v1/pull-requests/${SEEDED_PR.id}`,
        null,
        "reading the seeded PR #514",
      );

      expect(
        {
          state: seeded?.pullRequest.state,
          armed: seeded?.plan.armed,
          disarmReason: seeded?.plan.disarmReason,
          mergedResult: seeded?.plan.mergedResult,
          review: seeded?.review,
        },
        NOT_COLD,
      ).toEqual({
        state: "verifying",
        armed: false,
        disarmReason: null,
        mergedResult: null,
        review: null,
      });
    } finally {
      await context.close();
    }
  });

  test("parity: the seeded PR, mid-verification, in both palettes", async ({ context, page }) => {
    await signInAs(context);
    await page.setViewportSize(PARITY_WINDOW);
    await openSeeded(page);

    // ---- The head, as mockup 12 draws it.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED_PR.title);
    await expect(pill(page), NOT_COLD).toHaveText(SEEDED_PR.pill);
    await expect(main(page).locator(".prv-head__meta")).toContainText(SEEDED_PR.branches);
    await expect(main(page).locator(".prv-head__meta")).toContainText(SEEDED_PR.counts);

    // ---- The mockup's order, and the merge as the thing to do next.
    await expect(actions(page).getByRole("button")).toHaveText([
      "Request human review",
      "Return to loop",
      "Merge when all gates green",
    ]);
    await expect(
      actions(page).getByRole("button", { name: "Merge when all gates green" }),
    ).toHaveClass(/ou-btn--primary/);

    // ---- Seven gates, none of them emphasised: nothing blocks.
    const gates = card(page, "Verification gates");

    await expect(gates.locator(".prv-gate")).toHaveCount(7);
    await expect(gates.locator(".prv-gate--blocking")).toHaveCount(0);
    await expect(gates.locator(".prv-gate--unavailable")).toContainText(
      "arrives with the provider stack",
    );
    await expect(gates).not.toContainText("Final verdicts");

    // ---- Mid-verification states itself in the head: no state banner.
    await expect(stateBanner(page)).toHaveCount(0);

    // ---- Sync lag: no sync has written the seeded PR, so the page says so rather than
    // letting a still page imply a live one. It claims no time, because there is none.
    await expect(lagBanner(page)).toContainText("PR #514 has never been synced with its host.");
    await expect(lagBanner(page)).not.toContainText(/\d{1,2}:\d{2}/);
    await expect(lagBanner(page).getByRole("button", { name: "Check again" })).toBeVisible();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`pr-verification-${theme}.png`, {
        mask: clocks(page),
      });
    }
  });

  test("merged: the receipt, host links, and no arm affordance", async ({ context, page }) => {
    await signInAs(context);
    await rewritePoll(page, (payload) => syncedAt(asMerged(payload), null));
    await openSeeded(page);

    // ---- The receipt: which sha, as whom, when, and which actions ran.
    const banner = stateBanner(page);

    await expect(banner).toContainText("Merged — 9c4ab7f, as ken-s");
    await expect(banner.locator("time")).toHaveText("14:45:02");
    await expect(banner).toContainText(
      "Ran: closed issue #482 · commented the evidence summary · deleted the branch.",
    );
    await expect(banner).toContainText("This page is now the record");

    // ---- Host links: the PR and the ticket it closed.
    await expect(banner.getByRole("link", { name: "PR #514 on its host ↗" })).toHaveAttribute(
      "href",
      /\/helios-firmware\/pull\/514$/,
    );
    await expect(banner.getByRole("link", { name: "issue #482 on its tracker ↗" })).toHaveAttribute(
      "href",
      /\/issues\/482$/,
    );

    // ---- The page is frozen: the head, the gates at their final verdicts, no future step.
    await expect(pill(page)).toHaveText("merged — 6 of 7 gates green");
    await expect(pill(page)).toHaveClass(/ou-chip--ok/);
    await expect(card(page, "Verification gates")).toContainText(
      "Final verdicts — gates are not evaluated again once a PR has merged.",
    );
    await expect(main(page).locator(".prv-step--ghosted, .prv-step--armed")).toHaveCount(0);
    await expect(main(page).locator(".prv-step--live")).toHaveCount(0);

    // ---- No arm affordance remains, anywhere — and nothing else to decide.
    await expect(actions(page)).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: /merge/i })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Disarm" })).toHaveCount(0);
    await expect(card(page, "Merge plan").getByRole("button")).toHaveCount(0);
    await expect(card(page, "Verification gates").getByRole("button")).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: /waive|verify|claim|evidence/i }),
    ).toHaveCount(0);

    // ---- A finished PR is supposed to be quiet: no sync-lag banner, though it never synced.
    await expect(lagBanner(page)).toHaveCount(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(banner).toHaveScreenshot(`pr-verification-merged-${theme}.png`, {
        mask: [banner.locator("time")],
      });
    }
  });

  test("closed without merging: a terminal record with no verification affordances", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await rewritePoll(page, asClosed);
    await openSeeded(page);

    const banner = stateBanner(page);

    await expect(banner).toContainText("Closed without merging");
    await expect(banner).toContainText("PR #514 was closed on its host, and nothing was merged.");
    await expect(banner).not.toHaveClass(/prv-state--(ok|err)/);
    await expect(banner.getByRole("link", { name: "PR #514 on its host ↗" })).toBeVisible();

    await expect(pill(page)).toHaveText("closed — 5 of 7 gates green");
    await expect(actions(page)).toHaveCount(0);
    await expect(card(page, "Verification gates")).toContainText("Verdicts as they stood");
    await expect(card(page, "Verification gates").getByRole("button")).toHaveCount(0);
    await expect(card(page, "Merge plan").getByRole("button")).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: /waive|verify|claim|evidence/i }),
    ).toHaveCount(0);
    await expect(lagBanner(page)).toHaveCount(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(banner).toHaveScreenshot(`pr-verification-closed-${theme}.png`);
    }
  });

  test("disarmed: the banner names which re-check failed", async ({ context, page }) => {
    await signInAs(context);
    await rewritePoll(page, (payload) =>
      asDisarmed(payload, "host_conflict", HOST_CONFLICT_MESSAGE),
    );
    await openSeeded(page);

    const banner = stateBanner(page);

    await expect(banner).toContainText("Disarmed — The host reports a conflict");
    await expect(banner).toContainText(HOST_CONFLICT_MESSAGE);
    await expect(banner).toContainText(
      "Nothing was merged. Resolve it on the host, or return the PR to the loop, then arm again.",
    );
    await expect(banner).toHaveClass(/prv-state--err/);

    // ---- The banner and the card say the same thing — one plan, read by both.
    await expect(card(page, "Merge plan")).toContainText("Disarmed — The host reports a conflict");

    // ---- Disarmed is not finished: it can be armed again, and the banner leads there.
    await expect(banner.getByRole("link", { name: "Merge plan →" })).toHaveAttribute(
      "href",
      "#merge-plan",
    );
    await expect(
      card(page, "Merge plan").getByRole("button", { name: "Merge when all gates green" }),
    ).toBeVisible();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(banner).toHaveScreenshot(`pr-verification-disarmed-${theme}.png`);
    }
  });

  test("disarmed: a moved head is told apart from a conflict and from a refusal", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    const refusals = [
      ["head_moved", "Disarmed — The head moved"],
      ["host_head_moved", "Disarmed — The host has a commit that is not verified yet"],
      ["host_refused", "Disarmed — The host refused the merge"],
      ["host_not_open", "Disarmed — The PR is no longer open on its host"],
    ] as const;

    for (const [code, headline] of refusals) {
      await page.unroute("**/api/prs/*");
      await rewritePoll(page, (payload) => asDisarmed(payload, code, `The service said ${code}.`));
      await openSeeded(page);

      await expect(stateBanner(page), code).toContainText(headline);
      await expect(stateBanner(page), code).toContainText(`The service said ${code}.`);
    }
  });

  test("blocked: red gates emphasised, Return to loop promoted, merge off with its reason", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await rewritePoll(page, asBlocked);
    await openSeeded(page);

    await expect(pill(page)).toHaveText("blocked — 3 of 7 gates green");
    await expect(pill(page)).toHaveClass(/ou-chip--err/);

    // ---- Return to loop leads, and can be pressed; the merge steps back.
    await expect(actions(page).getByRole("button")).toHaveText([
      "Return to loop",
      "Request human review",
      "Merge when all gates green",
    ]);

    const back = actions(page).getByRole("button", { name: "Return to loop" });
    const merge = actions(page).getByRole("button", { name: "Merge when all gates green" });
    const reason = "2 gates are red on revision 2 — a blocked PR cannot be armed.";

    await expect(back).not.toHaveAttribute("aria-disabled", "true");
    await expect(merge).toHaveAttribute("aria-disabled", "true");
    await expect(merge).not.toHaveClass(/ou-btn--primary/);
    await expect(merge).toHaveAccessibleDescription(reason);
    await expect(actions(page)).toContainText(reason);

    // ---- The gates it is blocked by are the point of the page, and only those.
    const gates = card(page, "Verification gates");

    await expect(gates.locator(".prv-gate--blocking .prv-gate__name")).toHaveText([
      "Test suite",
      "Physical HIL",
    ]);
    await expect(gates.locator(".prv-gate--blocking")).toContainText([
      "61/63 · 2 failing after attempt 3",
      "overshoot 2.4% > 2.0% · rig helios-rig-02",
    ]);

    // ---- The dialog opens on those gates — the way back is one press from the head.
    await back.click();

    const dialog = page.getByRole("alertdialog", { name: "Return PR #514 to the loop" });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // ---- Revision 1's red gates are history: scoped there, nothing is emphasised.
    await main(page)
      .getByRole("button", { name: /^Revision 1/ })
      .click();
    await expect(gates.locator(".prv-gate--red")).toHaveCount(2);
    await expect(gates.locator(".prv-gate--blocking")).toHaveCount(0);
    await gates.getByRole("button", { name: "Follow the latest revision" }).click();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page).locator(".prv-head")).toHaveScreenshot(
        `pr-verification-blocked-head-${theme}.png`,
      );
      await expect(gates).toHaveScreenshot(`pr-verification-blocked-gates-${theme}.png`);
    }
  });

  test("sync lag: the banner names when the host was last heard, and only when it is late", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    // ---- Asked a moment ago: nothing to say.
    await rewritePoll(page, (payload) => syncedAt(payload, new Date().toISOString()));
    await openSeeded(page);
    await expect(lagBanner(page)).toHaveCount(0);

    // ---- Asked two days ago: the day as well as the time, since a time alone reads as today.
    const late = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const day = late.toISOString().slice(0, 10);
    const time = late.toISOString().slice(11, 16);

    await page.unroute("**/api/prs/*");
    await rewritePoll(page, (payload) => syncedAt(payload, late.toISOString()));
    await openSeeded(page);

    await expect(lagBanner(page)).toContainText(
      `Last synced with its host on ${day} at ${time} — PR #514's sync has gone quiet.`,
    );
    await expect(lagBanner(page)).toContainText("may be out of date");
    await expect(lagBanner(page).getByRole("button", { name: "Check again" })).toBeVisible();

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(lagBanner(page)).toHaveScreenshot(`pr-verification-sync-lag-${theme}.png`, {
        mask: [lagBanner(page).locator(".ou-retry__headline")],
      });
    }
  });

  test("a member is offered no arm, no waive and no approve", async ({ context, page }) => {
    await signInAs(context, SEED_MEMBER.id);
    await rewritePoll(page, withReviewWaiting);
    await openSeeded(page);

    // ---- The head: a member contributes, and arms nothing.
    await expect(actions(page).getByRole("button")).toHaveText([
      "review requested",
      "Return to loop",
    ]);
    await expect(main(page).getByRole("button", { name: /merge/i })).toHaveCount(0);

    // ---- A waiting approval is an owner's or admin's to answer, and the row says so.
    const gates = card(page, "Verification gates");

    await expect(gates.locator(".prv-gate--pending")).toContainText("Human approval");
    await expect(gates.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(gates.getByRole("button", { name: "Decline" })).toHaveCount(0);
    await expect(gates).toContainText("waiting for an owner or admin");

    // ---- No waive — and the rest of the matrix is a member's: claims and evidence.
    const matrix = card(page, "Does the PR do what the ticket says?");

    await expect(matrix.getByRole("button", { name: /^Waive/ })).toHaveCount(0);
    await expect(matrix.getByRole("button", { name: "+ Add claim" })).toBeVisible();
    await expect(matrix.getByRole("button", { name: "Attach evidence" }).first()).toBeVisible();

    // ---- The plan is read, not changed.
    const plan = card(page, "Merge plan");

    await expect(plan.getByRole("button")).toHaveCount(0);
    await expect(plan.getByRole("textbox")).toHaveCount(0);
    for (const toggle of await plan.getByRole("switch").all()) {
      await expect(toggle).toHaveAttribute("aria-disabled", "true");
    }

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(gates).toHaveScreenshot(`pr-verification-member-gates-${theme}.png`);
    }
  });

  test("an owner is offered the answer the member is not", async ({ context, page }) => {
    await signInAs(context);
    await rewritePoll(page, withReviewWaiting);
    await openSeeded(page);

    const gates = card(page, "Verification gates");

    await expect(gates.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(gates.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(gates).not.toContainText("waiting for an owner or admin");
  });

  test("a PR that does not exist is the page's own not-found, inside the shell", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    // No status is asserted: the segment streams behind its skeleton, so the response has
    // already begun, as `200`, by the time the read finds no PR.
    await page.goto(prPath(NO_SUCH_PR_ID));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This pull request does not exist.",
    );
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(stateBanner(page)).toHaveCount(0);
    await expect(lagBanner(page)).toHaveCount(0);
  });

  test("shell: fixed chrome, the origin lit, and the 125% step", async ({ context, page }) => {
    await signInAs(context);

    try {
      await setFontScale(context, "125");
      // Blocked and disarmed at once — the page at its tallest, with both banners and the
      // emphasised rows, is the one most likely to push the pane sideways.
      await rewritePoll(page, (payload) =>
        asDisarmed(
          asBlocked(payload),
          "gate_red",
          "Test suite and Physical HIL are red on revision 2.",
        ),
      );
      await openSeeded(page, "from=build-farm");
      await expectFontScale(page, "125");
      await expect(stateBanner(page)).toContainText("Disarmed — A gate went red");

      // ---- The module it was opened from stays lit; the page has no entry of its own.
      const sidebar = page.getByRole("navigation", { name: "Primary" });
      await expect(sidebar.getByRole("link", { name: /Build Farm/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(0);

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

  test("TOCTOU: a gate going red after arming prevents the merge, and the reason renders", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openSeeded(page);
    await expect(pill(page), NOT_COLD).toHaveText(SEEDED_PR.pill);

    const plan = card(page, "Merge plan");
    const gates = card(page, "Verification gates");

    // ---- Arm: the head hands off, the card's control opens the confirmation, and the
    // confirmation is what sends.
    await actions(page).getByRole("button", { name: "Merge when all gates green" }).click();
    await expect(plan).toContainText("Nothing has happened yet.");
    await plan.getByRole("button", { name: "Merge when all gates green" }).click();

    const confirmation = page.getByRole("alertdialog", {
      name: "Merge PR #514 when all gates are green",
    });

    await expect(confirmation).toContainText(`Revision 2 · ${SEEDED_PR.headSha}`);
    await expect(confirmation).toContainText("re-checked at merge time");
    await confirmation.getByRole("button", { name: "Arm the merge" }).click();
    await expect(confirmation).toHaveCount(0);

    await expect(pill(page), ARM_BROKE).toHaveText("armed — 5 of 7 gates green");
    await expect(plan.getByRole("button", { name: "Disarm" }), ARM_BROKE).toBeVisible();
    await expect(plan).toContainText(`against revision 2 · ${SEEDED_PR.headSha}`);
    await expect(stateBanner(page)).toHaveCount(0);

    // ---- The armed intent is stored, not merely drawn.
    await page.reload();
    await expect(pill(page), ARM_BROKE).toHaveText("armed — 5 of 7 gates green");

    // ---- A gate goes red before the last one is green: a review is asked for, and declined.
    await actions(page).getByRole("button", { name: "Request human review" }).click();
    await expect(actions(page)).toContainText("Human review requested");
    await gates.getByRole("button", { name: "Decline" }).click();

    const decline = page.getByRole("dialog", { name: "Decline the review of PR #514" });

    await decline.getByRole("textbox", { name: "Why it is declined" }).fill(DECLINE_NOTE);
    await decline.getByRole("button", { name: "Decline" }).click();
    await expect(decline).toHaveCount(0);

    const human = gates.locator(".prv-gate").filter({ hasText: "Human approval" });

    await expect(human, GATE_ENGINE_BROKE).toHaveClass(/prv-gate--red/);

    // ---- NO MERGE. The executor re-checked, found the red gate, and disarmed — with the
    // reason on the page, naming which re-check and which gate.
    const banner = stateBanner(page);

    await expect(banner, RECHECK_BROKE).toContainText("Disarmed — A gate went red", {
      timeout: 45 * 1000,
    });
    await expect(banner, RECHECK_BROKE).toContainText("Human approval is red on revision 2.");
    await expect(banner).toContainText("Nothing was merged.");
    await expect(banner, MERGED_ANYWAY).not.toContainText(/^Merged/);

    // The count is the engine's own: asking for a review re-materialises the gate set.
    await expect(pill(page), MERGED_ANYWAY).toHaveText(BLOCKED_PILL);
    await expect(pill(page)).toHaveClass(/ou-chip--err/);
    await expect(plan, RECHECK_BROKE).toContainText("Disarmed — A gate went red");
    await expect(plan.getByRole("button", { name: "Disarm" })).toHaveCount(0);
    await expect(plan.locator(".prv-merge__receipt"), MERGED_ANYWAY).toHaveCount(0);

    // ---- The gate that blocks is the point of the page, and the way back is promoted.
    await expect(gates.locator(".prv-gate--blocking .prv-gate__name")).toHaveText([
      "Human approval",
    ]);
    await expect(actions(page).getByRole("button").first()).toHaveText("Return to loop");

    // ---- It is the record, not a drawing: a fresh read says the same, and still no merge.
    await page.reload();
    await expect(stateBanner(page), RECHECK_BROKE).toContainText("Disarmed — A gate went red");
    await expect(stateBanner(page)).toContainText("Human approval is red on revision 2.");
    await expect(pill(page), MERGED_ANYWAY).toHaveText(BLOCKED_PILL);
    await expect(main(page).locator(".prv-merge__receipt"), MERGED_ANYWAY).toHaveCount(0);
    await expect(main(page).locator(".prv-state--ok"), MERGED_ANYWAY).toHaveCount(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(stateBanner(page)).toHaveScreenshot(`pr-verification-toctou-${theme}.png`);
    }
  });
});

// A block of its own, outside the cold-stack guard above: the chain will bring its own PR on the
// sandbox host and reads nothing of the seeded one, so it is parked — not red — on a stack that
// has already run the states, which is how `scripts/verify-failure-modes.sh` must find it.
test.describe("the PR plane's live chain (#370)", () => {
  test("live: sandbox PR — sync, gates, waive and annotate, arm, flip, merged", () => {
    // PARKED — see this file's header, § *The live chain is parked*.
    //
    // What it will do, on the commit that removes this line: open a branch and a PR on the
    // sandbox host; require the PR to appear here with revision 1 (the marker
    // `scripts/verify-failure-modes.sh` looks for is *the PR was mirrored*); require the gates to
    // evaluate from the run's seeded evidence (*the gates evaluated*); waive the thermal
    // criterion and read the annotation back **from the host**, not from this database; arm;
    // flip the staged last gate; and require a real squash merge — the branch deleted, the
    // ticket closed on the tracker, the evidence comment's content asserted, and the epic note
    // written when its toggle is on — before the merged state renders with its receipt.
    test.fixme(
      true,
      "nothing triggers a PR sync, a synced PR has no run (#375), and the sandbox host serves no pull requests",
    );
  });
});
