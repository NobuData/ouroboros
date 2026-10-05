/**
 * Leg 25 — **the Needs-You inbox's MVP gate** ([#470](https://github.com/NobuData/ouroboros/issues/470),
 * BO.5, amending [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Mockup 16 against `R__dev_seed_workspace_triage_inbox.sql` (#460). The UI's suites draw every
 * card from fixtures; what only this leg can see is whether an answer pressed on the page **does
 * the thing it says** on the plane that owns it, and whether the page's states are the service's:
 *
 *   * **Parity** — the seeded page, whole, in both palettes.
 *   * **The stat card is the week's arithmetic** — `11 decisions`, *median answer time 41s · loops
 *     never waited longer than 6m*, agreeing with `GET /api/v1/inbox/stats` — and it **moves when
 *     the rows do**: after the chain below, four more answers are four more decisions.
 *   * **Answer all three**, each asserted on its effect rather than its receipt:
 *       - **Approve & merge** → the sandbox host's PR `#504` is merged, at the sha the receipt names;
 *       - **Allow once** → the simulated loop that stopped on `boot/can_bringup.c` resumes, its
 *         `implement` stage succeeds and the driver reports `completed`;
 *       - **Waive & annotate** → the host's PR conversation carries the waiver, quoting the claim and
 *         the note typed into the card.
 *   * **Inbox zero** — every answer a resolved row with its resolver's class (a person's plain, a
 *     policy's marked), the email answer tagged with its channel, the zero card drawn and the
 *     sidebar's **Needs You** badge gone.
 *   * **Snooze** — a one-minute snooze dims the card and leaves the badge's count, and its expiry
 *     brings the card back **with its age intact** (a snooze hides a decision, it never stops its
 *     clock); *Wake now* wakes one early.
 *   * **Email** — the scheduler's real tick sends the daily digest to mailpit; its **Deny** link
 *     answers loop #1844's card with one `POST` and no session, while its **Approve & merge** link —
 *     merge-class — shows the card and *Sign in to confirm*, answers a signed-out `POST` with `401`,
 *     and merges nothing.
 *   * **Race** — two answers at once make exactly one resolution and one guardrail exception; the
 *     card a third press came from says *Answered by …* rather than failing.
 *   * **A member** — the answers their role does not hold are inert on the page, and refused by the
 *     service when made past it.
 *   * **The states** — a queue that cannot be refreshed says when it last was, to the second, and
 *     **Retry** recovers.
 *   * **The shell** — fixed chrome under a pane scroll, **Needs You** lit, the 125% step.
 *
 * ## One serial chain, in an order that is the argument
 *
 * The answers cannot be undone, so the tests that only read run first, against the seed as it
 * loaded: parity, the stat card, the states, the shell and the member. Then the chain, whose order
 * is forced by what each step consumes:
 *
 *   1. **The snooze starts the clock.** The leg files its own claim-waiver card (see below) and
 *      snoozes it for one minute — the shortest the service takes — and the minute is *not* waited
 *      out: it runs under the digest's wait, which is the leg's longest, and the expiry is asserted
 *      after it. The simulated run is started at the same moment, for the same reason.
 *   2. **Email before the merge.** The merge-class refusal is only a refusal while there is a merge
 *      to refuse, so the digest is read, and its approve link pressed signed out, while PR `#504`
 *      is still open.
 *   3. **Race on the allow-once.** The simulated loop's card is the one item whose answer is real
 *      and repeatable to attempt, so the race *is* the allow-once: two `POST`s with two keys, then
 *      the stale card pressed.
 *   4. **Waive before approve.** The leg's claim is an unverified criterion of PR `#504`, and a PR
 *      with an unverified claim is not one the merge plan should be asked to land.
 *
 * ## What the seed cannot give the chain, and what the leg brings
 *
 * | The chain needs | What the seed has | What the leg brings |
 * |---|---|---|
 * | a claim-waiver card a person can answer | one, on PR `#514`'s criterion — already waived, so `DecisionSourceSweeper` closes it as *settled at its source* a minute after `rest` starts | an unverified criterion on PR `#504` and the card its emitter would file, through psql (`fileClaimWaiver`); the sweeper's closure is waited for, and becomes the policy row the zero state's resolver classes are asserted against |
 * | an allow-once whose loop really resumes | loop `#1844`'s card, which **always** answers `409 allow_once_still_blocked` — the seeded run has no driver to re-report its change-set | the simulator's `protected-path-allow-once` (#470), whose loop holds until a resume; `#1844` is answered **Deny**, from the digest |
 * | a host that merges and keeps comments | the seeded GitHub source's credential is a placeholder, so both are refused `host_refused` | `connectSeededSource`, then the sealed column put back afterwards (`holdSourceCredential`) |
 * | a merge the owner's arm may make | `#504` is a `refactor` PR, which auto-merge excludes for anyone else | the chain answers as the seeded **owner** |
 *
 * ## What this leg leaves behind, and who reads it
 *
 * **Cold-only**, for leg 15's reason: an answer is final. After it, PR `#504` is merged in the
 * database (the sandbox is reset), loop `#1844` carries a queued correction round (the deny's
 * steer), PR `#504` has a fourth, waived criterion, the workspace has one more simulated run, and
 * Ken has a digest on record — so the next twenty hours of this stack send him none, which is the
 * precondition this leg's email test names when it is run twice. The legs that sort after it were
 * checked for what they read: `test-results` decides on `#479`'s *test results* and photographs
 * nothing of its console, so the extra steer moves no baseline; `pr-verification` is about `#514`,
 * not `#504`; nothing else reads an inbox count. The font scale, the digest preference and the
 * source's credential are put back.
 *
 * ## What is not here, and where it is
 *
 * The skeleton (`main[aria-busy]`) is painted while the *server* reads, which a browser cannot slow;
 * a card that throws while drawing (`section.inbox-fault`) needs a payload the service does not
 * send; and the stat card's own fault is drawn only when the *server's* first read fails — a failed
 * poll keeps the figures it had. All three are `ouroboros-ui`'s (`inbox-skeleton`, `card-boundary`,
 * `stats-card`). A viewer's inert *Wake now* needs a viewer, and the seed has none.
 */
import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  ACTIONS,
  COPY,
  FILED_CLAIM,
  type FiledWaiver,
  INBOX_PATH,
  type InboxItem,
  QUESTIONS,
  SEEDED_ITEMS,
  SEEDED_STATS,
  answerAs,
  answerPage,
  digestLinks,
  exceptionsGrantedVia,
  fileClaimWaiver,
  holdSourceCredential,
  inboxFeed,
  inboxQueue,
  inboxResolved,
  inboxStats,
  notificationPreferences,
  snoozeItem,
  stageStatus,
  utcMinute,
} from "../support/inbox";
import { clearInbox, inboxOf, messageText } from "../support/insights";
import { connectSeededSource } from "../support/knowledge";
import { SEEDED_GITHUB_SOURCE_ID, resetTracker } from "../support/planning";
import { quietly } from "../support/rest";
import {
  SANDBOX_PR_REPO,
  SANDBOX_SEEDED_PR,
  sandboxComments,
  sandboxPull,
} from "../support/sandbox";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { mintSession, signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { PANE_SELECTOR, chromeBoxes, expectNoPaneHorizontalScroll } from "../support/shell";
import { type Simulation, startSimulation } from "../support/simulator";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * The window the parity pair is taken through: the whole page — head, two cards, the snoozed one,
 * today's resolved list and the side column — with room to spare, asserted not to scroll, for
 * `specs/routing.spec.ts`'s reason (the pane is the only scroll container, so anything below the
 * fold of a shorter window would be photographed as bare ground).
 */
const PARITY_WINDOW = { width: 1440, height: 2400 } as const;

/** The driver's scenario (`ouroboros_simulator/scenarios/protected_path_allow_once.py`). */
const SCENARIO = "protected-path-allow-once";

/** Its speed: its ~250 scripted seconds in about thirteen real ones, either side of the hold. */
const SPEED = 20;

/** The path the scenario's change-set edits, under the org policy's `boot/**`. */
const PROTECTED_PATH = "boot/can_bringup.c";

/** How long the sweeper is given to close the seed's claim-waiver card — one jittered tick. */
const SWEEP_TIMEOUT_MS = 90_000;

/** How long the channels scheduler's real tick is given to send — 60 s ± its jitter, and slack. */
const DIGEST_TIMEOUT_MS = 100_000;

/** How long a poll of the page is given to land — 15 s is the default interval, twice. */
const POLL_TIMEOUT_MS = 35_000;

/** The note the waiver carries to the host. */
const WAIVER_NOTE =
  "e2e (#470): the rig has no programmable supply; covered by the brown-out soak on the bench.";

/** How many answers the chain makes that the week counts: deny, allow once, waive, approve. */
const CHAIN_ANSWERS = 4;

/* ------------------------------------------------------------------ the chain's shared state */

/** The owner's context, for every read and write beneath the browser. */
let owner: BrowserContext;

/** The claim-waiver card the leg files. */
let filed: FiledWaiver | undefined;

/** The filed card's age when it was snoozed, and when that was read. */
let beforeSnooze: { readonly ageSeconds: number; readonly readAt: number } | undefined;

/** The simulated loop, started under the digest's wait. */
let simulation: Simulation | undefined;

/** The allow-once card the simulated loop's stop filed, once found. */
let stopItemId: string | undefined;

/** Puts the seeded source's credential back. */
let restoreCredential: (() => Promise<void>) | undefined;

/** The owner's notification preferences, as the leg found them. */
let digestBefore: { readonly enabled: boolean; readonly time: string } | undefined;

/* ------------------------------------------------------------------ helpers */

/**
 * Whether a request is the queue's poll — this origin's `/api/inbox` and nothing under it, so the
 * feed, the stats and the resolved list keep answering while the queue is made to fail or hold.
 *
 * One function rather than an arrow per call site, because `page.unroute` matches the very
 * predicate `page.route` was given: a second arrow with the same body unroutes nothing.
 *
 * @param url - The request's address.
 * @returns `true` for the queue's poll.
 */
function isQueuePoll(url: URL): boolean {
  return url.pathname === "/api/inbox";
}

/**
 * Sign a seeded person into the seeded workspace and open the inbox.
 *
 * @param context - The browser context.
 * @param page - The page.
 * @param userId - Whose session. The owner by default.
 * @returns When the head has rendered the service's sentence, which is also hydration.
 */
async function openInbox(
  context: BrowserContext,
  page: Page,
  userId: string = SEED_OWNER.id,
): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(INBOX_PATH);
  await expect(page.locator("main.inbox h1")).toHaveText(/decisions?\.|No decisions waiting\./);
}

/**
 * A decision card, by its question, narrowed by something else it says when two share one.
 *
 * @param page - The page.
 * @param question - The question — the card's accessible name.
 * @param text - Something else on the card, e.g. its path.
 * @returns The card.
 */
function card(page: Page, question: string, text?: string): Locator {
  const named = page.getByRole("article", { name: question });

  return text === undefined ? named : named.filter({ hasText: text });
}

/** The queue's region — the asking cards. */
function queue(page: Page): Locator {
  return page.getByRole("region", { name: COPY.queue });
}

/** The snoozed section. */
function snoozed(page: Page): Locator {
  return page.getByRole("region", { name: COPY.snoozed });
}

/** The sidebar's **Needs You** row. */
function needsYou(page: Page): Locator {
  return page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: /^Needs You/ });
}

/**
 * Require the sidebar's badge to draw a count — or, for zero, to draw nothing at all (§ 3.5: a
 * zero would claim nothing needs you, which `Badge` refuses to say).
 *
 * @param page - The page.
 * @param count - The count the feed reads.
 */
async function expectBadge(page: Page, count: number): Promise<void> {
  const badge = needsYou(page).locator(".ou-badge");

  if (count === 0) {
    await expect(badge, "the Needs You badge must vanish at zero, never read 0").toHaveCount(0);
  } else {
    await expect(badge).toHaveText(`${count} ${COPY.badgeLabel}`);
  }
}

/**
 * What a parity picture must not be taken of: every age, countdown and instant on the page, each
 * of which the seed wrote relative to the moment it migrated (or the sweeper chose).
 *
 * @param page - The page.
 * @returns The locators to mask.
 */
function volatile(page: Page): Locator[] {
  return [
    page.locator(".inbox-card__age"),
    page.locator(".inbox-snoozed__age"),
    page.locator(".inbox-snoozed__countdown"),
    page.locator(".inbox-snoozed__until"),
    page.locator(".inbox-resolved__when"),
  ];
}

/**
 * Wait for a promise, but not for ever — the driver's exit, which a stuck hold would never give.
 *
 * @param promise - What to wait for.
 * @param ms - How long.
 * @param what - What it is, for the failure.
 * @returns What it resolved with.
 */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ the leg */

test.describe("the Needs-You inbox (#470)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser, playwright }) => {
    test.setTimeout(SWEEP_TIMEOUT_MS + 30_000);

    owner = await browser.newContext();
    await signIn(owner, SEED_OWNER.id);
    await selectWorkspace(owner, SEED_TENANT.slug);

    const tracker = await playwright.request.newContext();
    try {
      await resetTracker(tracker);
    } finally {
      await tracker.dispose();
    }

    // The seed's claim-waiver card is closed by the sweeper's first tick after `rest` started —
    // long past on a suite run, possibly not yet on this file alone. Its closure is waited for
    // rather than raced: the parity pair photographs the page after it.
    await expect
      .poll(async () => (await inboxQueue(owner)).items.map((item) => item.id), {
        message: "the seed's claim-waiver card must be settled at its source by the sweeper",
        timeout: SWEEP_TIMEOUT_MS,
      })
      .not.toContain(SEEDED_ITEMS.sweptWaiver);
  });

  test.afterAll(async () => {
    simulation?.stop();

    if (digestBefore !== undefined) {
      const before = digestBefore;
      await quietly(async () => {
        await notificationPreferences(owner, {
          digestEnabled: before.enabled,
          digestTime: before.time,
        });
      }, "the owner's digest preference was not put back; the next run's digest test may find it on.");
    }

    if (restoreCredential !== undefined) {
      await quietly(
        restoreCredential,
        "the seeded GitHub source kept the leg's credential; later legs will sync the sandbox.",
      );
    }

    await owner.close();
  });

  test("parity: the seeded inbox, in both palettes", async ({ context, page }) => {
    // The chain's premise, checked first — and here rather than in the hook, so a pair of
    // `verify-failure-modes.sh` that runs one later test alone is not refused for a stack the
    // suite has already been through.
    const start = await inboxQueue(owner);

    expect(
      start.items.map((item) => item.id).sort(),
      "a precondition: the inbox must be the seed's — merge #504 and loop #1844 asking, nothing " +
        "answered by an earlier run of this leg (it is cold-only; see the header)",
    ).toEqual([SEEDED_ITEMS.merge, SEEDED_ITEMS.protectedPath].sort());
    expect(start.snoozed.map((item) => item.id)).toEqual([SEEDED_ITEMS.snoozedFact]);

    await page.setViewportSize(PARITY_WINDOW);
    await openInbox(context, page);

    // ---- The page the pair is of: two asking, one snoozed, the week beside them.
    await expect(queue(page).getByRole("article")).toHaveCount(2);
    await expect(card(page, QUESTIONS.merge)).toBeVisible();
    await expect(card(page, QUESTIONS.protectedPath, "boot/rollback_flag.c")).toBeVisible();
    await expect(snoozed(page).locator("article.inbox-snoozed")).toHaveCount(1);
    await expect(page.locator("main.inbox h1")).toHaveText(/^2 decisions\./);

    const pane = page.locator(PANE_SELECTOR);
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      `the inbox must fit ${PARITY_WINDOW.height}px whole, or the pair photographs bare ground`,
    ).toBe(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      // A snoozed card un-dims under the pointer; the pair is of the page at rest.
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`inbox-${theme}.png`, { mask: volatile(page) });
    }
  });

  test("the stat card is the seed's week, and the service's", async ({ context, page }) => {
    await openInbox(context, page);

    const stats = await inboxStats(owner);

    // ---- The arithmetic, as the service does it: eleven answers, the closure left out.
    expect(stats.decisions).toBe(SEEDED_STATS.decisions);
    expect(stats.display).toEqual({ decisions: "11", medianAnswer: "41s", maxLoopWait: "6m" });

    // ---- And as the page prints it.
    const week = page.getByRole("region", { name: COPY.statsTitle });

    await expect(week).toHaveClass(/inbox-stat/);
    await expect(week.locator(".ou-stat__value")).toHaveText(SEEDED_STATS.value);
    await expect(week.locator(".ou-stat__delta")).toHaveText(SEEDED_STATS.delta);

    // ---- The methodology names the week the figures cover — the service's, not the browser's.
    const method = week.getByRole("button", { name: COPY.statsMethod });

    await method.click();
    await expect(method).toHaveAttribute("aria-expanded", "true");
    await expect(week.getByRole("note")).toContainText(`Week ${stats.week}, in UTC.`);
  });

  test("states: a queue that cannot be refreshed says when it last was, and Retry recovers", async ({
    context,
    page,
  }) => {
    test.setTimeout(POLL_TIMEOUT_MS + 30_000);

    const loadedFrom = Date.now();
    await openInbox(context, page);
    const loadedBy = Date.now();

    // The queue's poll — this origin's `/api/inbox`, and only it — answers as a service that has
    // gone away. The first paint stays; the banner must say how old it is.
    await page.route(isQueuePoll, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    const banner = page.locator(".inbox__stale");

    await expect(banner).toBeVisible({ timeout: POLL_TIMEOUT_MS });
    await expect(banner).toContainText(COPY.unreadableQueue);

    const headline = (await banner.locator(".ou-retry__headline").textContent()) ?? "";
    const stamp = /^The inbox could not be refreshed\. Last refreshed (.+)\.$/.exec(
      headline.trim(),
    );

    expect(
      stamp,
      `the banner must name when the queue was last refreshed: "${headline}"`,
    ).not.toBeNull();

    // The stamp is the reader's own clock, to the second — so it is checked against every second
    // the page could have read the queue in, printed the way the page prints them.
    const candidates = await page.evaluate(
      ([from, to]) => {
        const printed: string[] = [];
        for (let at = from - 5_000; at <= to + 1_000; at += 1_000) {
          printed.push(
            new Date(at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          );
        }
        return printed;
      },
      [loadedFrom, loadedBy] as const,
    );

    expect(
      candidates,
      "the last refresh must be the page's own read, not the failed poll's",
    ).toContain(stamp?.[1]);

    // ---- The rest of the page is the last good read, still answerable.
    await expect(queue(page).getByRole("article")).toHaveCount(2);

    // ---- And the way back: the service answers again, and Retry is a fresh read.
    await page.unroute(isQueuePoll);
    await banner.getByRole("button", { name: "Retry" }).click();
    await expect(banner).toHaveCount(0);
  });

  test("shell: fixed chrome under a pane scroll, Needs You lit, and the 125% step", async ({
    context,
    page,
  }) => {
    await openInbox(context, page);

    // ---- Where the reader is: one entry claims it, and it is this one.
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(needsYou(page)).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);
    await expectBadge(page, (await inboxFeed(owner)).open);

    // ---- The chrome holds still while the pane scrolls under it.
    const pane = page.locator(PANE_SELECTOR);
    const before = await chromeBoxes(page);

    expect(before.header, "the header must be on the page to be measured").not.toBeNull();
    expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the inbox must overflow its pane at the suite's window for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await chromeBoxes(page)).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // ---- A fifth more type: nothing pushes the pane sideways, and the page is still the inbox.
    try {
      await setFontScale(context, "125");
      await page.reload();
      await expectFontScale(page, "125");
      await expectNoPaneHorizontalScroll(page);
      await expect(
        page.getByRole("region", { name: COPY.statsTitle }).locator(".ou-stat__value"),
      ).toHaveText(SEEDED_STATS.value);
      await expect(card(page, QUESTIONS.merge)).toBeVisible();
    } finally {
      await restoreFontScale(context);
    }
  });

  test("a member: the answers their role lacks are inert, and refused past the page", async ({
    browser,
  }) => {
    const member = await browser.newContext();

    try {
      const page = await member.newPage();
      await openInbox(member, page, SEED_MEMBER.id);

      // ---- On the page: approving is an approver's, and Jorge is a member.
      const merge = card(page, QUESTIONS.merge);
      const approve = merge.getByRole("button", { name: ACTIONS.approve.label });

      await expect(approve).toHaveAttribute("aria-disabled", "true");
      await expect(
        merge.getByRole("button", { name: ACTIONS.returnToLoop.label }),
      ).not.toHaveAttribute("aria-disabled", "true");

      const stop = card(page, QUESTIONS.protectedPath, "boot/rollback_flag.c");

      await expect(stop.getByRole("button", { name: ACTIONS.allowOnce.label })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await expect(stop.getByRole("button", { name: ACTIONS.deny.label })).toHaveAttribute(
        "aria-disabled",
        "true",
      );

      // ---- The service resolved that, not the page: the member's read says so too.
      const read = await inboxQueue(member);
      const approveAction = read.items
        .find((item) => item.id === SEEDED_ITEMS.merge)
        ?.actions.find((action) => action.id === ACTIONS.approve.id);

      expect(approveAction?.allowed).toBe(false);

      // ---- Past the page: the same presses, made directly, are refused by name.
      for (const [itemId, actionId] of [
        [SEEDED_ITEMS.merge, ACTIONS.approve.id],
        [SEEDED_ITEMS.protectedPath, ACTIONS.allowOnce.id],
        [SEEDED_ITEMS.protectedPath, ACTIONS.deny.id],
      ] as const) {
        const refused = await answerAs(
          member,
          itemId,
          actionId,
          `e2e-member-${actionId}-${Date.now()}`,
        );

        expect(refused.status, `${actionId} by a member`).toBe(403);
        expect(refused.body.code).toBe("decision_action_forbidden");
      }

      // ---- And nothing happened: both still ask, and the host's PR is open.
      expect((await inboxQueue(owner)).items.map((item) => item.id)).toEqual(
        expect.arrayContaining([SEEDED_ITEMS.merge, SEEDED_ITEMS.protectedPath]),
      );
      expect(
        (await sandboxPull(SANDBOX_PR_REPO.owner, SANDBOX_PR_REPO.repo, SANDBOX_SEEDED_PR)).merged,
      ).toBe(false);
    } finally {
      await member.close();
    }
  });

  test("snooze: a one-minute snooze dims the card, and the badge leaves it out", async ({
    context,
    page,
  }) => {
    filed = await fileClaimWaiver();
    const waiverId = filed.itemId;

    await openInbox(context, page);
    await expect(card(page, QUESTIONS.waiver, FILED_CLAIM.claim)).toBeVisible();

    const feedBefore = await inboxFeed(owner);
    const asking = (await inboxQueue(owner)).items.find((item) => item.id === waiverId);

    expect(asking, "the filed claim-waiver card must be asking").toBeDefined();
    await expectBadge(page, feedBefore.open);

    beforeSnooze = { ageSeconds: asking?.ageSeconds ?? 0, readAt: Date.now() };
    await snoozeItem(owner, waiverId, 1);

    // ---- The service's count leaves it out…
    const feedAfter = await inboxFeed(owner);

    expect(feedAfter.open).toBe(feedBefore.open - 1);
    expect(feedAfter.snoozed).toBe(feedBefore.snoozed + 1);

    // ---- …and so does the page: dimmed in the snoozed section, counting down, gone from the queue.
    await page.reload();

    const hidden = snoozed(page)
      .locator("article.inbox-snoozed")
      .filter({ hasText: QUESTIONS.waiver });

    await expect(snoozed(page).getByRole("heading", { level: 2 })).toHaveText(
      `${COPY.snoozed} (${feedAfter.snoozed})`,
    );
    await page.mouse.move(0, 0);
    await expect(hidden).toHaveCSS("opacity", "0.6");
    await expect(hidden.locator(".inbox-snoozed__countdown")).toHaveText(
      /^(wakes in (\d+s|1m)|waking now)$/,
    );
    await expect(hidden.locator(".inbox-snoozed__age span[aria-hidden]")).toHaveText(/^\d+m$/);
    await expect(card(page, QUESTIONS.waiver, FILED_CLAIM.claim)).toHaveCount(0);
    await expectBadge(page, feedAfter.open);
  });

  test("email: the digest's links — a deny answered by link alone, a merge that wants a session", async () => {
    test.setTimeout(DIGEST_TIMEOUT_MS + 60_000);

    // First, and before anything is written: with mailpit gone this is where the leg stops, by
    // name, leaving the stack as cold as it found it.
    await clearInbox().catch((reason: unknown) => {
      throw new Error(`mailpit is not answering: ${String(reason)}`);
    });

    // The chain's second long wait starts under this one: the simulated loop opens, files its
    // stop, and holds — all while the scheduler's tick is awaited below.
    simulation = await startSimulation(SCENARIO, SPEED);

    // A session of Ken's own, as the browser he reads his mail in would carry once signed in.
    const session = (await mintSession(SEED_OWNER.id)).token;

    const before = await notificationPreferences(owner, null);
    digestBefore = { enabled: before.digest.enabled, time: before.digest.time };

    // ---- The digest is due at its time and for six hours after: set it to now.
    const set = await notificationPreferences(owner, {
      digestEnabled: true,
      digestTime: utcMinute(new Date()),
    });

    expect(
      Date.parse(set.digest.nextSendAt ?? "") <= Date.now(),
      "a precondition: no digest went to Ken in the last 20 h on this stack (a kept stack has sent one)",
    ).toBe(true);

    await expect
      .poll(
        async () =>
          (await inboxOf(SEED_OWNER.email)).filter(
            (mail) => !mail.Subject.startsWith("[Ouroboros] Needs you"),
          ).length,
        {
          message: "the channels scheduler's tick must send the daily digest to mailpit",
          timeout: DIGEST_TIMEOUT_MS,
        },
      )
      .toBeGreaterThan(0);

    const [digest] = (await inboxOf(SEED_OWNER.email)).filter(
      (mail) => !mail.Subject.startsWith("[Ouroboros] Needs you"),
    );
    const text = await messageText(digest.ID);
    const links = digestLinks(text);

    expect(digest.Subject).toMatch(new RegExp(`decisions? waiting · ${SEED_TENANT.displayName}$`));

    const deny = links.get(SEEDED_ITEMS.protectedPath)?.get(ACTIONS.deny.label);
    const approve = links.get(SEEDED_ITEMS.merge)?.get(ACTIONS.approve.label);

    expect(deny, "the digest must carry loop #1844's Deny link").toBeDefined();
    expect(approve, "the digest must carry PR #504's Approve & merge link").toBeDefined();
    expect(deny?.asksToSignIn).toBe(false);
    expect(approve?.asksToSignIn, "a merge-class link must say it asks for a session").toBe(true);

    // ---- Merge-class: the card and a sign-in, never a merge, without a session.
    const shown = await answerPage(approve?.token ?? "", "GET");

    expect(shown.status).toBe(200);
    expect(shown.html).toContain("Sign in to confirm");
    expect(shown.html).toContain(QUESTIONS.merge);

    const refused = await answerPage(approve?.token ?? "", "POST");

    expect(refused.status, "a signed-out POST of a merge-class link must be refused").toBe(401);
    expect(refused.html).toContain("Nothing was done: you are not signed in.");

    // With the person's own session the page becomes a confirmation — and a GET still decides nothing.
    const confirm = await answerPage(approve?.token ?? "", "GET", session);

    expect(confirm.status).toBe(200);
    expect(confirm.html).toContain('<form method="post"');
    expect(confirm.html).toContain("Approve &amp; merge</button>");
    expect(
      (await sandboxPull(SANDBOX_PR_REPO.owner, SANDBOX_PR_REPO.repo, SANDBOX_SEEDED_PR)).merged,
    ).toBe(false);
    expect((await inboxQueue(owner)).items.map((item) => item.id)).toContain(SEEDED_ITEMS.merge);

    // ---- Not merge-class: the page shows the card and its button, and changes nothing…
    const page = await answerPage(deny?.token ?? "", "GET");

    expect(page.status).toBe(200);
    expect(page.html).toContain('<form method="post"');
    expect((await inboxQueue(owner)).items.map((item) => item.id)).toContain(
      SEEDED_ITEMS.protectedPath,
    );

    // …and its one POST, with no session at all, is the answer.
    const answered = await answerPage(deny?.token ?? "", "POST");

    expect(answered.status, answered.html).toBe(200);
    expect(answered.html).toContain(`✓ ${ACTIONS.deny.label}`);
    expect((await inboxQueue(owner)).items.map((item) => item.id)).not.toContain(
      SEEDED_ITEMS.protectedPath,
    );

    const row = (await inboxResolved(owner)).rows.find(
      (each) => each.itemId === SEEDED_ITEMS.protectedPath,
    );

    expect(row, "the deny must be one of today's resolutions").toBeDefined();
    expect(row?.channel).toBe("email");
    expect(row?.resolver).toBe("human");
    expect(row?.actionId).toBe(ACTIONS.deny.id);
    expect(row?.actor?.name).toBe(SEED_OWNER.displayName);

    // A link works once.
    const again = await answerPage(deny?.token ?? "", "POST");

    expect(again.status).toBe(410);
    expect(again.html).toContain("This link was already used");
  });

  test("snooze: expiry brings the card back with its age, and Wake now wakes one early", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);

    const waiverId = filed?.itemId ?? "";
    const snoozedAt = beforeSnooze;

    expect(snoozedAt, "the snooze test must have run first").toBeDefined();

    // ---- The minute ran out under the digest's wait; a read is what wakes it (V095).
    let back: InboxItem | undefined;

    await expect
      .poll(
        async () => {
          back = (await inboxQueue(owner)).items.find((item) => item.id === waiverId);
          return back !== undefined;
        },
        {
          message: "a one-minute snooze must run out and return the card to the queue",
          timeout: 75_000,
        },
      )
      .toBe(true);

    // The clock never stopped: the age now is the age then, plus every second since.
    const elapsed = Math.floor((Date.now() - (snoozedAt?.readAt ?? 0)) / 1000);

    expect(
      back?.ageSeconds ?? 0,
      "a snooze hides a decision; it never resets its age",
    ).toBeGreaterThanOrEqual((snoozedAt?.ageSeconds ?? 0) + elapsed - 2);

    await openInbox(context, page);

    const returned = card(page, QUESTIONS.waiver, FILED_CLAIM.claim);
    const minutes = Math.floor((back?.ageSeconds ?? 0) / 60);

    await expect(returned).toBeVisible();
    await expect(returned.locator(".inbox-card__age span[aria-hidden]")).toHaveText(
      new RegExp(`^(${minutes}|${minutes + 1})m$`),
    );
    await expect(
      snoozed(page).locator("article.inbox-snoozed").filter({ hasText: QUESTIONS.waiver }),
    ).toHaveCount(0);

    // ---- Wake now: snoozed for an hour, woken from the page.
    await snoozeItem(owner, waiverId, 60);
    await page.reload();

    const wake = snoozed(page).getByRole("button", {
      name: `${COPY.wakeNow}: ${QUESTIONS.waiver}`,
    });

    await wake.click();

    // The woken card says so and the page re-reads at once, which moves it out of this section —
    // so the effect is what is asserted: the service has it asking, and the queue draws it.
    await expect(card(page, QUESTIONS.waiver, FILED_CLAIM.claim)).toBeVisible({
      timeout: POLL_TIMEOUT_MS,
    });
    await expect(
      snoozed(page).locator("article.inbox-snoozed").filter({ hasText: QUESTIONS.waiver }),
    ).toHaveCount(0);
    expect((await inboxQueue(owner)).items.map((item) => item.id)).toContain(waiverId);
  });

  test("race and allow once: one resolution, the loser told who won, and the loop resumes past its stop", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);

    const run = simulation;

    expect(run, "the email test must have started the simulated loop").toBeDefined();

    // ---- The loop stopped on its protected path, and the plane filed the card.
    let stop: InboxItem | undefined;

    await expect
      .poll(
        async () => {
          stop = (await inboxQueue(owner)).items.find(
            (item) =>
              item.kindId === "protected_path_allow_once" &&
              item.refs.some((ref) => ref.type === "run" && ref.id === run?.runId),
          );
          return stop !== undefined;
        },
        {
          message: "the simulated loop's protected-path stop must file an allow-once card",
          timeout: 60_000,
        },
      )
      .toBe(true);

    const itemId = stop?.id ?? "";
    stopItemId = itemId;

    // ---- The page, open on it and held there: its queue poll answers "unchanged" until the race
    // is over, so the card stays the one a slower person was looking at.
    await page.route(isQueuePoll, (route) => route.fulfill({ status: 304 }));
    await openInbox(context, page);

    const stale = card(page, QUESTIONS.protectedPath, PROTECTED_PATH);

    await expect(stale.getByRole("button", { name: ACTIONS.allowOnce.label })).toBeVisible();

    // ---- Two presses at once, two keys.
    const answers = await Promise.all([
      answerAs(owner, itemId, ACTIONS.allowOnce.id, `e2e-race-a-${itemId}`),
      answerAs(owner, itemId, ACTIONS.allowOnce.id, `e2e-race-b-${itemId}`),
    ]);
    const [won] = answers.filter((answer) => answer.status === 200);
    const lost = answers.filter((answer) => answer.status !== 200);

    expect(
      answers.map((answer) => answer.status).sort(),
      JSON.stringify(answers.map((a) => a.body)),
    ).toEqual([200, 409]);
    expect(["decision_already_answered", "decision_action_in_progress"]).toContain(
      lost[0]?.body.code,
    );
    expect(won?.body.receipt?.effects[0]).toBe("exception granted");

    // Exactly one: one resolution in today's list, one exception granted beneath the service.
    expect((await inboxResolved(owner)).rows.filter((row) => row.itemId === itemId)).toHaveLength(
      1,
    );
    expect(await exceptionsGrantedVia(itemId), "the race must grant the exception once").toBe(1);

    // A third, after it settled, names the winner — the shape the card reads.
    const late = await answerAs(owner, itemId, ACTIONS.allowOnce.id, `e2e-race-c-${itemId}`);

    expect(late.status).toBe(409);
    expect(late.body.code).toBe("decision_already_answered");
    expect(late.body.details?.resolution?.actor?.name).toBe(SEED_OWNER.displayName);

    // ---- The stale card pressed: not an error — who answered, when, with what.
    await stale.getByRole("button", { name: ACTIONS.allowOnce.label }).click();
    await expect(stale.locator(".inbox-card__raced")).toHaveText(
      new RegExp(
        `^Answered by ${SEED_OWNER.displayName}( \\d+s ago)? — ${ACTIONS.allowOnce.label}\\.$`,
      ),
    );
    await expect(stale.getByRole("button", { name: ACTIONS.allowOnce.label })).toHaveCount(0);
    await page.unroute(isQueuePoll);

    // ---- The effect: the loop re-reported, passed its guardrails and went on to the end.
    const { code, output } = await within(
      run?.finished ?? Promise.reject(new Error("no run")),
      60_000,
      "the driver's exit",
    );

    expect(output, "the resumed loop must run on to a merge").toContain(`${SCENARIO}: completed`);
    expect(code).toBe(0);
    expect(await stageStatus(owner, run?.runId ?? "", "implement")).toBe("succeeded");
  });

  test("waive: the note travels to the PR as a public annotation", async ({ context, page }) => {
    // The host must be one this deployment can open — see the header's table.
    restoreCredential = await holdSourceCredential(SEEDED_GITHUB_SOURCE_ID);
    await connectSeededSource(owner);

    await openInbox(context, page);

    const waiver = card(page, QUESTIONS.waiver, FILED_CLAIM.claim);

    await waiver.getByRole("button", { name: ACTIONS.waive.label }).click();

    const panel = waiver.getByRole("form", { name: ACTIONS.waive.label });

    await panel.getByLabel(COPY.note).fill(WAIVER_NOTE);
    await panel.getByRole("button", { name: ACTIONS.waive.label }).click();

    await expect(waiver.locator(".inbox-card__receipt")).toHaveText(
      "claim waived · PR annotated publicly",
    );

    // ---- The effect is the host's: the conversation carries the claim, the reason and who.
    const comments = await sandboxComments(
      SANDBOX_PR_REPO.owner,
      SANDBOX_PR_REPO.repo,
      SANDBOX_SEEDED_PR,
    );
    const annotation = comments.find((comment) => comment.body.includes(`> ${FILED_CLAIM.claim}`));

    expect(annotation, "the waiver must be annotated on the host's PR").toBeDefined();
    expect(annotation?.body).toContain(`**Reason:** ${WAIVER_NOTE}`);
    expect(annotation?.body).toContain(`**Waived by:** ${SEED_OWNER.displayName}`);
    expect((await inboxQueue(owner)).items.map((item) => item.id)).not.toContain(filed?.itemId);
  });

  test("approve: the merge card merges the sandbox PR", async ({ context, page }) => {
    await openInbox(context, page);

    const merge = card(page, QUESTIONS.merge);

    await merge.getByRole("button", { name: ACTIONS.approve.label }).click();

    const receipt = merge.locator(".inbox-card__receipt");

    await expect(receipt).toHaveText(/^approval recorded · PR merged at [0-9a-f]{7}$/);

    const sha = /([0-9a-f]{7})$/.exec((await receipt.textContent()) ?? "")?.[1] ?? "";

    // ---- The effect is the host's: merged, at the commit the receipt named.
    const pull = await sandboxPull(SANDBOX_PR_REPO.owner, SANDBOX_PR_REPO.repo, SANDBOX_SEEDED_PR);

    expect(pull.merged, "approving must merge the PR on its host").toBe(true);
    expect(pull.state).toBe("closed");
    expect(pull.merge_commit_sha ?? "").toMatch(new RegExp(`^${sha}`));
  });

  test("inbox zero: resolved rows with their resolvers' classes, the zero card, no badge — and the week counted them", async ({
    context,
    page,
  }) => {
    // ---- Nothing is asking, by the service's count.
    const after = await inboxQueue(owner);

    expect(
      after.items.map((item) => `${item.kindId} ${item.id}`),
      "every open item must have been answered",
    ).toEqual([]);
    expect((await inboxFeed(owner)).open).toBe(0);

    await openInbox(context, page);

    // ---- The zero card, and no card beside it.
    const zero = page.getByRole("region", { name: COPY.zeroLabel });

    await expect(zero).toContainText(COPY.zeroLine);
    await expect(zero).toContainText(COPY.zeroNote);
    await expect(queue(page)).toHaveCount(0);
    await expectBadge(page, 0);

    // ---- Every answer is today's row, drawn with its resolver's class.
    const resolved = page.getByRole("region", { name: COPY.resolved });
    const today = await inboxResolved(owner);
    const rowOf = (itemId: string) => {
      const row = today.rows.find((each) => each.itemId === itemId);

      expect(row, `item ${itemId} must be among today's resolutions`).toBeDefined();
      return row!;
    };
    const drawn = (subject: string, verdict: string): Locator =>
      resolved
        .locator("li.inbox-resolved__row")
        .filter({ hasText: subject })
        .filter({ hasText: verdict })
        .first();

    for (const itemId of [
      SEEDED_ITEMS.merge,
      SEEDED_ITEMS.protectedPath,
      filed?.itemId ?? "",
      stopItemId ?? "",
    ]) {
      const row = rowOf(itemId);

      expect(row.resolver).toBe("human");
      expect(row.actor?.name).toBe(SEED_OWNER.displayName);

      const line = drawn(row.subject, row.verdict);

      await expect(line).toBeVisible();
      await expect(line.locator(".inbox-resolved__verdict")).not.toHaveClass(
        /inbox-resolved__verdict--policy/,
      );
    }

    // The deny came from the mail, and the row says so.
    const denied = rowOf(SEEDED_ITEMS.protectedPath);
    await expect(
      drawn(denied.subject, denied.verdict).locator(".inbox-resolved__channel"),
    ).toHaveAttribute("title", `Answered from email by ${SEED_OWNER.displayName}`);

    // The sweeper's closure is a policy's, and is drawn as one.
    const swept = rowOf(SEEDED_ITEMS.sweptWaiver);

    expect(swept.resolver).toBe("policy");
    await expect(
      drawn(swept.subject, swept.verdict).locator(".inbox-resolved__verdict"),
    ).toHaveClass(/inbox-resolved__verdict--policy/);

    // ---- The week moved with the rows: four answers are four decisions, as the card prints them.
    const stats = await inboxStats(owner);
    const week = page.getByRole("region", { name: COPY.statsTitle });

    expect(stats.decisions, "the stat card's figures must be computed from the answers").toBe(
      SEEDED_STATS.decisions + CHAIN_ANSWERS,
    );
    await expect(week.locator(".ou-stat__value")).toHaveText(`${stats.decisions} decisions`);
    await expect(week.locator(".ou-stat__delta")).toHaveText(
      `median answer time ${stats.display.medianAnswer} · loops never waited longer than ${stats.display.maxLoopWait}`,
    );
  });
});
