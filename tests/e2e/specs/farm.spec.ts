/**
 * Leg 16 — *mockup 08, and the first leg that leaves the building*
 * ([#262](https://github.com/NobuData/ouroboros/issues/262), AI.7, amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Every other leg in this directory certifies a UI against services in the same compose stack,
 * written in the same language. This one certifies a chain that crosses a **language boundary
 * and a network boundary**: a Go binary, installed on a bare machine by a line copied out of
 * the browser, enrols itself with a single-use token, is issued a certificate by a farm CA that
 * did not exist a second earlier, opens an outbound mTLS socket through a TLS gateway, and
 * appears as a row. `ouroboros-runner` tests its half against an in-process fake farm and
 * `ouroboros-rest` tests its half against a fake agent; **nothing but this leg has both halves
 * be real at once.**
 *
 * ## The assertions this leg exists for
 *
 * **The row appears because a pasted line worked.** The clipboard's contents are pasted into
 * the stack's build machine *verbatim* (`support/farm-runner.ts`). For a row to come online the
 * installer has to be served with this deployment's address in it, the release has to match its
 * SHA-256, the token has to open in the vault, the CA has to sign a CSR, the gateway has to
 * forward the client certificate, and `RunnerIdentityService` has to accept it. Break any one
 * and there is no row.
 *
 * **A revoked token is refused by the control plane, in its own words.** The first line the
 * chain pastes is one whose token it has just revoked in *Manage tokens*, and the installer must
 * exit non-zero carrying `farm_enrollment_refused` — so *revoke* is a fact about the service
 * rather than about a list that stopped drawing a row.
 *
 * **Presence is real, not a remembered field.** The machine is killed with `SIGKILL` — no
 * `bye`, no closed socket — and the row must flip to `offline`, dim, and trade its telemetry for
 * em-dashes *because nothing is heartbeating*. Nothing in this suite writes that status.
 *
 * Around them: mockup 08 at parity against the seed in both palettes; the states a fresh
 * workspace passes through — no pools, then no runners with enrolment promoted as step one, then
 * a fleet whose only machine is down; a drain that round-trips through the agent's own
 * heartbeat; a member served everything and offered nothing; and the shell's promises.
 *
 * ## Three deliberate divergences from the ticket's own words, and why
 *
 * **The build → live log → stats test is parked.** `job.offer` always names a repository
 * (`ouroboros-rest`'s `dispatch/offer.ts`) and today's agent declines every offer that does —
 * source checkout was never assigned (the roadmap's AH.4 note), and is now
 * [#991](https://github.com/NobuData/ouroboros/issues/991). A build submitted to a real runner
 * therefore waits rather than runs, and there is no honest way to stream its log: the ticket's
 * own words are that the leg must fail *if streaming is faked*. So the test is written down,
 * carries `test.fixme` with this reason, and its failure-mode pair is registered as parked
 * (`scripts/verify-failure-modes.sh`). The **seeded** log is still asserted, in reading order,
 * by the parity group — which is the offset fetch and the renderer, against rows.
 *
 * **The chain runs in a workspace it creates, not in `acme-robotics`.** The seed's farm CA is a
 * placeholder envelope on purpose, so nothing can enrol there; `support/farm.ts` § *Two
 * workspaces* argues it. The fresh workspace is also the ticket's *fresh organization*, which is
 * why the states group and the chain are one traversal: the no-pools state's own **Create a
 * pool** is how the chain gets its pool.
 *
 * **Revocation comes first, not last.** The ticket lists *token revoke → a subsequent enrolment
 * attempt fails* after the kill. An agent refuses to enrol into a machine that already holds a
 * runner — before it presents any token — so on an enrolled machine a revoked token and a live
 * one fail identically, for a reason that is not revocation. On the *bare* machine the refusal
 * can only be the control plane's.
 *
 * ## What this leg writes
 *
 * A workspace, a pool, two tokens, a runner, a farm CA — all in a workspace made for the run and
 * read by nothing else; `support/farm.ts` has the table. The machine is recreated before the
 * chain and again after it, so the stack is left as it came up.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  CHAIN_POOL,
  FARM_HEAD,
  FARM_PATH,
  FIRST_RUN,
  FLEET_WARNING,
  MEMBER_PAGE,
  SEEDED_LIVE,
  SEEDED_POOLS,
  SEEDED_RUNNERS,
  SEEDED_STATS,
  enrollCommandStatusFor,
  enterFreshWorkspace,
  enterSeededFarm,
} from "../support/farm";
import {
  BUILD_MACHINE_NAME,
  killBuildMachine,
  pasteIntoBuildMachine,
  resetBuildMachine,
} from "../support/farm-runner";
import { quietly } from "../support/rest";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { PANE_SELECTOR, chromeBoxes, scrollPaneTo } from "../support/shell";
import { UI_URL } from "../support/stack";
import { pinTheme } from "../support/theme";

/**
 * The window the parity pair is photographed through.
 *
 * 1920 × 1700, and the height is the decision — `specs/routing.spec.ts` argues it in full. The
 * shell's pane is the only scroll container, so an element screenshot of a `<main>` taller than
 * the viewport records everything below the fold as bare ground; here that would be the LIVE
 * card, which is the surface the ticket most asks to be diffed. The group asserts the pane does
 * not scroll at this height, so a page that outgrows the window turns red rather than cropped.
 */
const PARITY_WINDOW = { width: 1920, height: 1700 };

/**
 * How long the row of a machine that was killed may take to say so.
 *
 * The product's own arithmetic, not a guess: a runner is `offline` after three missed ten-second
 * heartbeats plus their jitter (32 s), the sweep that notices runs every five, and the page asks
 * again every ten — forty-seven at the outside (`gateway.policy.ts`, `fleet.policy.ts`). Sixty
 * leaves a loaded CI machine some room and is still a number that fails a sweep that stopped
 * sweeping: the row would simply never change.
 */
const PRESENCE_FLIP_MS = 60_000;

/**
 * How long a fact that travels on a heartbeat may take to reach the page: one ten-second beat,
 * its jitter, and one ten-second poll.
 */
const HEARTBEAT_MS = 30_000;

/**
 * A stat tile, by its caption.
 *
 * @param page - The farm page.
 * @param label - The caption — the tile's accessible name.
 * @returns The tile's region.
 */
function tile(page: Page, label: string): Locator {
  return page.getByRole("region", { name: label });
}

/**
 * The RUNNERS card.
 *
 * Exactly, because the stat row's first tile is a region called *Runners online* and a role
 * query matches by substring unless told not to.
 *
 * @param page - The farm page.
 * @returns The card's region.
 */
function runnersCard(page: Page): Locator {
  return page.getByRole("region", { name: "Runners", exact: true });
}

/**
 * A runner's row, by the machine's name.
 *
 * By its first cell, exactly: `forge-0` would otherwise find three rows.
 *
 * @param page - The farm page.
 * @param name - The runner's name.
 * @returns The row.
 */
function runnerRow(page: Page, name: string): Locator {
  return runnersCard(page)
    .locator("tbody tr")
    .filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * Choose an item from a runner's `⋯` menu.
 *
 * The runners table is wider than its card below ~1900 px, so its last column can be off to
 * the side; Playwright scrolls the trigger into view before it presses it, as a reader would.
 *
 * @param page - The farm page.
 * @param name - The runner whose menu it is.
 * @param item - The item's label.
 * @returns When the item has been pressed.
 */
async function chooseRunnerAction(page: Page, name: string, item: string): Promise<void> {
  await page.getByRole("button", { name: `Runner actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/**
 * Press **Copy command** and read what it put on the clipboard.
 *
 * The clipboard is the *only* place the token's value goes — the card's state has no field for
 * it (`app/farm/enroll-card.tsx`) — so it is also the only place this leg can get it, which is
 * the point: what is pasted into the machine is what a person would have pasted.
 *
 * @param page - The farm page, in a context granted the clipboard.
 * @returns The command, whole.
 */
async function copyEnrollCommand(page: Page): Promise<string> {
  // Emptied first, so a second copy cannot be satisfied by what the first one left there.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(page.getByText("Copied — treat this as a secret.")).toBeVisible();

  const command = await page.evaluate(() => navigator.clipboard.readText());

  expect(command, "Copy command should put the enroll one-liner on the clipboard").toMatch(
    /^curl -fsSL 'https:\/\/farm-gateway\/install\.sh\?version=[0-9.]+' \| sh -s --/,
  );

  return command;
}

/* ------------------------------------------------------------------ parity */

test.describe("mockup 08, as the farm seed renders it", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterSeededFarm(context, page, SEED_OWNER.id, SEED_TENANT.slug);
  });

  test("draws the head and the stat row the seed computes", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FARM_HEAD.headline);

    for (const stat of SEEDED_STATS) {
      // `4/5` is two elements — the accented figure and its quiet `/5` — so the tile is read
      // as text rather than element by element.
      await expect(tile(page, stat.label)).toContainText(stat.value);
      await expect(tile(page, stat.label)).toContainText(stat.line);
    }

    // No strip: four of five connected is a healthy fleet, and a warning over the mockup's
    // own state would be a page crying wolf on its first screenshot.
    await expect(page.locator(".farm-fleet")).toHaveCount(0);
  });

  test("draws the fleet with every status archetype the mockup has", async ({ page }) => {
    const rows = runnersCard(page).locator("tbody tr");

    await expect(rows).toHaveCount(SEEDED_RUNNERS.length);

    for (const [index, runner] of SEEDED_RUNNERS.entries()) {
      const row = rows.nth(index);

      await expect(row).toContainText(runner.name);
      await expect(row).toContainText(runner.pool);
      // The column that only holds because the seed's live heartbeats are dated ahead: with
      // them in the past, the presence sweep made all five of these `offline` within a minute.
      await expect(row, `${runner.name} should still read ${runner.status}`).toContainText(
        runner.status,
      );
      await expect(row).toContainText(runner.cpu);
      await expect(row).toContainText(runner.queue);
      if (runner.job !== null) await expect(row).toContainText(runner.job);
    }

    // An age rather than `2h` — see `SEEDED_STATS` on why the hour is the stack's, not the seed's.
    await expect(runnerRow(page, "forge-03")).toContainText(/last seen \dh ago/);
  });

  test("draws the pools and streams the seeded log in reading order", async ({ page }) => {
    const pools = page.getByRole("region", { name: "Pools" });

    for (const pool of SEEDED_POOLS) {
      await expect(pools.getByText(pool.name, { exact: true })).toBeVisible();
      await expect(pools).toContainText(pool.meta);
    }

    const live = page.getByRole("region", { name: SEEDED_LIVE.heading });
    const log = live.getByRole("region", { name: "Build log" });

    await expect(log).toContainText(SEEDED_LIVE.first);
    await expect(log).toContainText(SEEDED_LIVE.last);

    // Order, not presence: the card reads by byte offset, so this is the offset fetch and the
    // seed's chunk order in one comparison.
    const printed = await log.innerText();

    expect(
      printed.indexOf(SEEDED_LIVE.first),
      "the command should be printed before the link step it produced",
    ).toBeLessThan(printed.indexOf(SEEDED_LIVE.last));
  });

  test("is the mockup in both palettes", async ({ page }) => {
    expect(
      await page.locator(PANE_SELECTOR).evaluate((pane) => pane.scrollHeight - pane.clientHeight),
      "the parity window must be tall enough to hold the whole screen without scrolling",
    ).toBe(0);

    // What moves with the clock rather than with the code, each written by the seed relative to
    // the moment it migrated: the LIVE card's elapsed time, and the two places `forge-03`'s age
    // is printed — the first tile's line and the row's *last seen*. The words around them are
    // asserted as text by the tests above; leg 10 masks its cards' *last used* for this reason.
    const mask = [
      page.locator(".farm-live__elapsed"),
      page.locator(".farm-runners__seen"),
      tile(page, "Runners online").locator(".ou-stat__delta"),
    ];

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("farm-light.png", { mask });

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("farm-dark.png", { mask });
  });
});

/* ------------------------------------------------------------------ the chain */

test.describe("a fresh workspace, and a real machine", () => {
  test.beforeEach(async () => {
    // A machine out of the box: nothing installed, nothing enrolled, whatever the last run did.
    await resetBuildMachine();
  });

  test("goes from nothing to a live runner by a pasted line, drains it, and notices it die", async ({
    context,
    page,
  }) => {
    // One traversal and a slow one by construction: it waits on a heartbeat twice and on the
    // presence threshold once, and none of those can be hurried without ceasing to be the
    // product's own clock. `slow()` triples this test's timeout and leaves the suite's alone.
    test.slow();

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: UI_URL });

    const tenant = await enterFreshWorkspace(context, page, "chain");

    // --- state: no pools ---------------------------------------------------------------
    // The first thing a new tenant sees. Not a blank table under a heading: the steps, with
    // the pool first, because a runner always enrols into one.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FARM_HEAD.emptyHeadline);

    const steps = page.getByRole("list", { name: FIRST_RUN.stepsLabel });

    await expect(steps.getByRole("listitem")).toHaveText([
      new RegExp(`^${FIRST_RUN.steps.createPool}`),
      new RegExp(`^${FIRST_RUN.steps.copyCommand}`),
      new RegExp(`^${FIRST_RUN.steps.runCommand}`),
    ]);

    const pools = page.getByRole("region", { name: "Pools" });
    const enroll = page.getByRole("region", { name: "Enroll a runner" });

    await expect(pools).toContainText(FIRST_RUN.stepOne);
    await expect(enroll).toContainText(FIRST_RUN.stepTwo);
    // The copy is inert and says why, rather than minting a token for a pool that is not there.
    await expect(enroll.getByRole("button", { name: "Copy command" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // --- the bootstrap CTA: the state's own button is how the chain gets its pool --------
    await pools.getByRole("button", { name: FIRST_RUN.createPool }).click();

    const sheet = page.getByRole("dialog", { name: "Configure pools" });

    await sheet.getByLabel("Name").fill(CHAIN_POOL);
    // A shell pool: the build machine has no container daemon, and says so in its `hello`.
    await sheet.getByLabel("Executor").selectOption("shell");
    await sheet.getByRole("button", { name: "Create pool" }).click();
    await expect(sheet.getByText("Created.")).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();

    // --- state: no runners — enrolment promoted as step one ------------------------------
    await expect(page.getByRole("heading", { level: 1 })).toContainText("1 pool.");
    await expect(steps.getByRole("listitem")).toHaveText([
      new RegExp(`^${FIRST_RUN.steps.copyCommand}`),
      new RegExp(`^${FIRST_RUN.steps.runCommand}`),
    ]);
    await expect(enroll).toContainText(FIRST_RUN.stepOne);
    await expect(enroll).toHaveClass(/farm-promoted/);

    // Promoted means *first*, not only *bordered*: the enroll card is ahead of the table.
    const enrollBox = await enroll.boundingBox();
    const runnersBox = await runnersCard(page).boundingBox();

    expect(enrollBox, "the enroll card should be on the page").not.toBeNull();
    expect(runnersBox, "the runners card should be on the page").not.toBeNull();
    expect(
      (enrollBox?.x ?? 0) < (runnersBox?.x ?? 0) || (enrollBox?.y ?? 0) < (runnersBox?.y ?? 0),
      "with nothing enrolled, the enroll card should come before the runners table",
    ).toBe(true);

    await page.getByRole("button", { name: FIRST_RUN.goToEnroll }).click();
    await expect(enroll.getByLabel("Pool")).toBeFocused();

    // --- revoke, then paste: the control plane must refuse, in its own words --------------
    const revokedLine = await copyEnrollCommand(page);

    expect(revokedLine).toContain(`--tenant '${tenant}'`);
    expect(revokedLine).toContain(`--pool '${CHAIN_POOL}'`);

    await enroll.getByRole("button", { name: "Manage tokens →" }).click();

    const tokens = page.getByRole("dialog", { name: "Enrollment tokens" });

    await tokens.getByRole("button", { name: /^Revoke/ }).click();
    await expect(tokens).toContainText(/revoked/i);
    await tokens.getByRole("button", { name: "Close" }).click();

    const refused = await pasteIntoBuildMachine(revokedLine);

    // The transcript is the message: with the gateway down it carries curl's complaint, with
    // the vault broken a 500 — so whichever layer broke is named in the failure.
    expect(
      refused.transcript,
      "pasting a command whose token was revoked should be refused by the control plane",
    ).toContain("farm_enrollment_refused");
    expect(refused.status, "a refused enrolment should fail the installer").not.toBe(0);
    await expect(runnerRow(page, BUILD_MACHINE_NAME)).toHaveCount(0);

    // --- a live token: the row appears ---------------------------------------------------
    const line = await copyEnrollCommand(page);
    const installed = await pasteIntoBuildMachine(line);

    expect(
      installed.status,
      `the enroll command did not install a runner:\n${installed.transcript}`,
    ).toBe(0);
    expect(installed.transcript).toContain(`enrolled ${BUILD_MACHINE_NAME}`);

    const row = runnerRow(page, BUILD_MACHINE_NAME);

    // No reload: the page's own ten-second poll has to bring it.
    await expect(row, "the enrolled machine should appear as a row").toBeVisible({
      timeout: HEARTBEAT_MS,
    });
    await expect(row).toContainText(CHAIN_POOL);
    await expect(row).toContainText("idle", { timeout: HEARTBEAT_MS });
    // Telemetry from a real machine: a percentage and a memory reading, neither an em-dash.
    await expect(row).toContainText(/\d+%/);
    await expect(row).toContainText(/\d(\.\d)?\/\d+(\.\d)? GB/);
    await expect(tile(page, "Runners online")).toContainText("1/1");
    // A fleet is no longer a first run: the guidance and the promotion are gone.
    await expect(steps).toHaveCount(0);
    await expect(enroll).not.toHaveClass(/farm-promoted/);

    // --- drain, and back: the pill moves on the agent's heartbeat, not on the press -------
    await chooseRunnerAction(page, BUILD_MACHINE_NAME, "Drain");
    await page
      .getByRole("dialog", { name: `Drain ${BUILD_MACHINE_NAME}?` })
      .getByRole("button", { name: `Drain ${BUILD_MACHINE_NAME}` })
      .click();
    await expect(row).toContainText("draining", { timeout: HEARTBEAT_MS });

    // Returning a machine to service asks nothing — *do you want this working again?* is a
    // question nobody needs — so the menu item is the write.
    await chooseRunnerAction(page, BUILD_MACHINE_NAME, "Undrain");
    await expect(row).toContainText("idle", { timeout: HEARTBEAT_MS });
    await expect(row).not.toContainText("draining");

    // --- pull the plug: presence is real ---------------------------------------------------
    await killBuildMachine();

    await expect(
      row,
      "the row should flip to offline because nothing is heartbeating — nothing here writes it",
    ).toContainText("offline", { timeout: PRESENCE_FLIP_MS });
    await expect(row).toContainText(/last seen \d+[sm] ago/);
    await expect(row).toHaveClass(/farm-runners__row--dim/);
    // A snapshot the fleet cannot vouch for is not a snapshot: no percentage, no memory.
    await expect(row).not.toContainText(/\d+%/);
    await expect(row).not.toContainText(/GB/);
    await expect(tile(page, "Runners online")).toContainText("0/1");

    // --- state: an offline-heavy fleet says so at the top ----------------------------------
    await expect(page.locator(".farm-fleet")).toContainText(FLEET_WARNING.onlyRunnerOffline);
  });

  test("streams a real build: submit → dispatch → live log → terminal state → stats", () => {
    // PARKED — see this file's header, § *The build → live log → stats test is parked*.
    //
    // `job.offer` always names a repository and today's agent declines every offer that does;
    // agent source checkout is #991. Until it lands a build submitted to the chain's runner
    // waits rather than runs, and a log that was not streamed by an agent is exactly what the
    // ticket says this test must not accept. What it will do, on the commit that removes this
    // line: submit a build to `pool-e2e` from the head's **Submit build**, require the LIVE card
    // to bind to it and grow by offset fetches while the job is `running` (the marker
    // `scripts/verify-failure-modes.sh` looks for is *the log streamed*), require the pill to
    // swap on the terminal state, and require **Builds today** to move by exactly one.
    test.fixme(true, "agent source checkout is #991 — a real runner cannot run a build yet");
  });

  test.afterEach(async () => {
    await quietly(
      () => resetBuildMachine(),
      "the build machine is still dead or still enrolled — a kept stack has a service down.",
    );
  });
});

/* ------------------------------------------------------------------ the error banner */

test.describe("a farm whose refresh fails", () => {
  test("keeps the page and says how old it is, under one banner with a retry", async ({
    context,
    page,
  }) => {
    await enterSeededFarm(context, page, SEED_OWNER.id, SEED_TENANT.slug);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FARM_HEAD.headline);

    // The browser's own poll, refused at the door it goes through. The first paint was the
    // server's and is already on screen — which is the state DASH-I.7's pattern is for.
    await page.route("**/api/farm", (route) => route.abort());

    const banner = page.locator(".ou-retry");

    await expect(banner).toContainText(/Showing data from .+ — the latest refresh failed\./, {
      timeout: HEARTBEAT_MS,
    });
    // Stale, not gone: the page under the banner is still the page.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FARM_HEAD.headline);
    await expect(tile(page, "Builds today")).toContainText("25");

    await page.unroute("**/api/farm");
    await banner.getByRole("button", { name: "Retry" }).click();
    await expect(banner).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ the member */

test.describe("a member's build farm", () => {
  test("is served everything and offered nothing, with the reason shown", async ({
    context,
    page,
  }) => {
    await enterSeededFarm(context, page, SEED_MEMBER.id, SEED_TENANT.slug);

    // The role, explained once, rather than a page of missing controls left to explain itself.
    await expect(page.getByRole("note").filter({ hasText: MEMBER_PAGE.noteHead })).toBeVisible();

    // The head: enrolment is drawn, inert, with its reason; submitting a build is not drawn.
    const enrollRunner = page.getByRole("button", { name: "+ Enroll runner" });

    await expect(enrollRunner).toHaveAttribute("aria-disabled", "true");
    await expect(enrollRunner).toHaveAttribute("title", MEMBER_PAGE.enrollReason);
    await expect(page.getByRole("button", { name: "Submit build" })).toHaveCount(0);

    // The table: every row is readable, and a row's menu holds **View details** alone.
    await expect(runnerRow(page, "forge-01")).toContainText("building");
    await page.getByRole("button", { name: "Runner actions for forge-01" }).click();
    await expect(page.getByRole("menuitem")).toHaveText([MEMBER_PAGE.viewDetails]);
    await page.keyboard.press("Escape");

    // The pools: each switch in its real position, switched off, with the reason.
    const pools = page.getByRole("region", { name: "Pools" });
    const switches = pools.getByRole("switch");

    await expect(switches.first()).toHaveAttribute("aria-disabled", "true");
    await expect(switches.first()).toHaveAttribute("title", MEMBER_PAGE.poolReason);

    // The enroll card: the command's shape and nothing that mints.
    const enroll = page.getByRole("region", { name: "Enroll a runner" });

    await expect(enroll).toContainText("orb_enroll_••••");
    await expect(enroll.getByRole("button", { name: "Copy command" })).toHaveCount(0);
    await expect(enroll.getByRole("button", { name: "Manage tokens →" })).toHaveCount(0);

    // …and the gate that decides is the service's: the mint itself refuses this session.
    expect(
      await enrollCommandStatusFor(context, SEEDED_POOLS[0].name),
      "the enroll-command route's answer to a member",
    ).toBe(403);
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell on the build farm", () => {
  test("holds its chrome still, lights Build Farm, and survives the 125% font scale", async ({
    context,
    page,
  }) => {
    await enterSeededFarm(context, page, SEED_OWNER.id, SEED_TENANT.slug);

    await expect(
      page.getByRole("navigation").getByRole("link", { name: FARM_HEAD.eyebrow }),
    ).toHaveAttribute("aria-current", "page");

    // The premise: a page that fitted the viewport would make everything below vacuously true.
    expect(
      await page.locator(PANE_SELECTOR).evaluate((pane) => pane.scrollHeight - pane.clientHeight),
      "the build farm must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    const before = await chromeBoxes(page);

    await scrollPaneTo(page, 400);

    const after = await chromeBoxes(page);

    expect(after.header, "the header moved when the pane scrolled").toEqual(before.header);
    expect(after.sidebar, "the sidebar moved when the pane scrolled").toEqual(before.sidebar);

    await setFontScale(context, "125");
    await page.goto(FARM_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FARM_HEAD.headline);
    await expect(page.locator("html")).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(page.locator("html")).toHaveCSS("font-size", rootFontSize("125"));
    await expect(runnersCard(page)).toBeVisible();
    await expect(page.getByRole("region", { name: SEEDED_LIVE.heading })).toBeVisible();
  });

  test.afterEach(async ({ context }: { context: BrowserContext }) => {
    await quietly(
      () => restoreFontScale(context),
      "the font scale is still 125% — every later leg photographs a page a size too large.",
    );
  });
});
