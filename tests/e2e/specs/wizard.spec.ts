/**
 * Leg 27 — the Get Started wizard's states, and the chain that certifies the onboarding roadmap
 * ([#395](https://github.com/NobuData/ouroboros/issues/395), BC.6 — the MVP gate), over the
 * frame and cards of #390–#394 and the BB seeds (#383).
 *
 * Mockup 13 draws the wizard at step 3. This leg draws what it cannot: steps 1 and 2 before they
 * are done, a step that went backwards, the wizard after *Run my first loop →* — and then proves
 * the composition works, in order, from a rail that is cold.
 *
 * * **The frame** — standalone chrome (no shell header, sidebar or pane; nothing fixed to the
 *   viewport; no mockup topbar), the head, the rail and the action bar holding still while only
 *   the step content scrolls, and the page correct at the 125 % font-scale step — on the seeded
 *   wizard, which is the page the mockup shows.
 * * **Both palettes** — the seeded wizard, whole, screenshot-diffed.
 * * **Dismissal** — a fresh workspace's dashboard offers the wizard; *Dismiss* makes it stop for
 *   good, and the wizard stays reachable by address.
 * * **The chain** — in `acme-robotics`, on a repository it has never onboarded (`support/wizard.ts`
 *   says why it is not a fresh workspace): connect GitHub through the embedded add-source dialog →
 *   switch the repository on through the embedded enablement switch → the detection card concludes
 *   the fixture repository's **real rows** → the issue the leg filed is synced, sized through the
 *   engine and picked → *Quick fixes* selected and **found in the Studio** → the pick verified → *Run
 *   my first loop →* and its receipt → on the **dashboard**, the queue one longer, and in the queue
 *   the row pinned `quick-fixes` v1 `explicit` → **dry-run really on** (Settings → Policies, and the
 *   policy API) → the simulated driver's `first-loop` opens a **watermarked** run of that issue under
 *   the wizard's workflow and walks it to *Open PR & auto-merge*, the rail reading *run started* →
 *   and the **regression leg**: the source paused in its own row, step 1 un-ticked on the poll with
 *   the service's reason and its fix path, resumed and done again.
 *
 * ## What the driver proves, and what it does not
 *
 * The issue asks for a sandbox draft PR via the simulated driver. The driver reports through the
 * ingestion contract and never touches a host; the sandbox tracker cannot create pull requests;
 * ingest writes no PR row. What the leg asserts is therefore what the stack can show: a run of the
 * queued issue, watermarked *Simulated run*, pinned to the workflow the wizard made, reaching the
 * template's terminal — and the transcript saying *draft*, because dry-run keeps it one. The user
 * settled this on the ticket (2026-10-05).
 *
 * ## The chain writes, and it runs last
 *
 * It files a sandbox issue, connects a source (sources have no delete), records a repository,
 * creates a workflow, queues an issue and flips dry-run on — so the spec is named to sort after
 * every other leg (the planning, intake and dashboard legs count what this one adds), and it
 * takes the planning leg's position: **green from a cold volume, and it does not pretend to clean
 * up.** Its guard says so once, in words, on a stack that has already run it. What *can* be put
 * back is: the sandbox issue is closed on its host, the workspace's GitHub token is removed,
 * dry-run is turned back off (the merge legs need it off), and the chain's source is paused.
 */

import { type Locator, type Page, expect, test } from "@playwright/test";

import {
  SANDBOX_GITHUB_TOKEN,
  clearGithubToken,
  setGithubToken,
  syncIntakeMirror,
} from "../support/planning";
import { quietly, requestAs } from "../support/rest";
import { SEED_OWNER } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { expectNoTopbarRemnants, expectNoViewportFixedElements } from "../support/shell";
import { type Simulation, startSimulation } from "../support/simulator";
import { THEMES, storeTheme } from "../support/theme";
import {
  CHAIN,
  CONNECT_BROKE,
  DASHBOARD,
  DASHBOARD_BROKE,
  DETECTION_ROWS,
  DRIVER_BROKE,
  DRY_RUN,
  ENABLE_BROKE,
  LAUNCH_BROKE,
  NOT_COLD,
  OFFER_BROKE,
  POLICY_BROKE,
  QUEUE_HEAD,
  REGRESSION_BROKE,
  SCAN_BROKE,
  SEEDED_WIZARD,
  SIZE_BROKE,
  TEMPLATE_BROKE,
  WIZARD,
  WIZARD_TITLE,
  bar,
  card,
  closeChainIssue,
  dryRunPolicy,
  enterFreshWorkspace,
  enterWizard,
  fileChainIssue,
  mirroredRepository,
  pauseSource,
  queueTotal,
  queuedItem,
  railStep,
  recordRepository,
  restoreDryRun,
  sourceNamed,
  syncSource,
  wizardPathFor,
} from "../support/wizard";
import { selectWorkspace } from "../support/workspace";

/** A window wide enough for the two columns and tall enough for the step content whole. */
const PARITY_WINDOW = { width: 1920, height: 2600 };

/** How deep the chrome test scrolls the step content. */
const SCROLL_PX = 400;

/** The rail re-reads on the I.8 cadence (15 s); a rail-driven wait allows two reads. */
const RAIL_MS = 35 * 1000;

/** The detection card polls every 2 s while a scan runs; a scan of the fixture is a few probes. */
const SCAN_MS = 30 * 1000;

/** How long the estimator may take to size one issue: a sync, a queue hop and an engine call. */
const ESTIMATE_MS = 90 * 1000;

/** The driver's time compression — two and a half scripted minutes in under ten real seconds. */
const DRIVER_SPEED = 20;

/** How long the run may take to reach its terminal at that speed, driver start-up included. */
const DRIVER_MS = 60 * 1000;

/** The quick-fixes template's nodes — the stepper's steps, every one done at the end. */
const QUICK_FIXES_STAGES = 7;

/**
 * The wizard's `.wizard__content` — the one region that scrolls. The route's loading state draws
 * the same frame for a moment on a reload, so the page's is the one not inside the skeleton.
 */
function content(page: Page): Locator {
  return page.locator(".wizard:not(.wizard-skeleton) > .wizard__content");
}

/** The three regions the frame promises never move. */
async function frameBoxes(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };

    const page = ".wizard:not(.wizard-skeleton) > ";

    return {
      head: box(`${page}.wizard__head`),
      rail: box(`${page}.wizard-rail`),
      bar: box(`${page}.wizard-bar`),
    };
  });
}

/** The cells that print a relative time — the estimator row's affix. */
function volatile(page: Page): Locator[] {
  return [page.locator(".defaults__affix")];
}

/* ------------------------------------------------------------------ the states */

test.describe("the Get Started wizard's states (#395)", () => {
  test("standalone: no shell chrome, nothing fixed to the viewport, and no mockup topbar", async ({
    context,
    page,
  }) => {
    await enterWizard(context, page, SEEDED_WIZARD.slug, SEEDED_WIZARD.repo);

    // The shell describes a workspace that is not set up yet, so none of it is here — not the
    // header, not the sidebar, not the pane (design system § 5 puts the wizard beside login).
    await expect(
      page.locator("header.shell-header, nav#shell-sidebar, [data-shell-pane]"),
    ).toHaveCount(0);
    await expectNoTopbarRemnants(page);
    await expectNoViewportFixedElements(page);

    // What is here is the frame: its head, its rail of four, its action bar.
    await expect(page.getByRole("navigation")).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: WIZARD.rail }).getByRole("listitem"),
    ).toHaveCount(4);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toContainText("Step 3 of 4");
  });

  test("chrome: the head, the rail and the action bar hold still while only the step content scrolls", async ({
    context,
    page,
  }) => {
    await enterWizard(context, page, SEEDED_WIZARD.slug, SEEDED_WIZARD.repo);

    for (const theme of THEMES) {
      await storeTheme(page, theme);
      // The route's loading state carries the same head, so readiness is a card having landed
      // and the skeleton gone.
      await expect(card(page, WIZARD.tiles).locator(".tile")).toHaveCount(4);
      await expect(page.locator(".wizard-skeleton")).toHaveCount(0);

      // The premise: the step content overflows by at least the scroll under test, or nothing
      // below would mean anything.
      const scrollable = await content(page).evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(
        scrollable,
        "the step content must overflow for the chrome test to mean anything",
      ).toBeGreaterThanOrEqual(SCROLL_PX);

      await content(page).evaluate((el) => el.scrollTo(0, 0));
      const before = await frameBoxes(page);
      expect(before.head, "the head must be on the page to be measured").not.toBeNull();
      expect(before.rail, "the rail must be on the page to be measured").not.toBeNull();
      expect(before.bar, "the bar must be on the page to be measured").not.toBeNull();

      await content(page).evaluate((el, to) => el.scrollTo(0, to), SCROLL_PX);
      await expect.poll(() => content(page).evaluate((el) => el.scrollTop)).toBe(SCROLL_PX);

      // Three regions of which exactly one scrolls: the frame is the viewport's height and the
      // content is its only scrolling cell, so this is the assertion that the grid survived the
      // cards (CP.4, standalone).
      expect(await frameBoxes(page)).toEqual(before);
      // And the document itself never scrolls — the lock in `app/globals.css`.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
  });

  test.describe("the font scale", () => {
    test.afterEach(async ({ context }) => {
      await restoreFontScale(context);
    });

    test("the page still holds at the 125% step", async ({ context, page }) => {
      await enterWizard(context, page, SEEDED_WIZARD.slug, SEEDED_WIZARD.repo);
      await setFontScale(context, "125");
      await page.reload();
      // The loading state and the page overlap for a moment on a reload; measure the page.
      await expect(page.locator(".wizard-skeleton")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: WIZARD.rail })).toBeVisible();

      // The preference lives on the server and the standalone frame honours it through the same
      // localStorage mirror the shell does (the onboarding roadmap's shell addendum).
      await expectFontScale(page, "125");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(WIZARD_TITLE);

      // Every length is rem, so a fifth more type grows the frame without pushing the step
      // content sideways.
      expect(await content(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      await expect(page.locator(".wizard__head")).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: WIZARD.rail }).getByRole("listitem"),
      ).toHaveCount(4);
      await expect(bar(page)).toBeVisible();
      await expect(card(page, WIZARD.detection)).toBeVisible();
      await expect(
        card(page, WIZARD.tiles).getByRole("button", { name: /Quick fixes/ }),
      ).toBeVisible();
    });
  });

  test("parity: the seeded wizard in both palettes", async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterWizard(context, page, SEEDED_WIZARD.slug, SEEDED_WIZARD.repo);

    // Every card has landed before the shutter: the detection rows, the four tiles, the pick,
    // the right column's rows.
    await expect(card(page, WIZARD.detection).locator(".detect-row")).toHaveCount(
      DETECTION_ROWS.length,
    );
    await expect(card(page, WIZARD.tiles).locator(".tile")).toHaveCount(4);
    await expect(card(page, WIZARD.pick).locator(".pick-row__key")).toHaveText("#488");
    await expect(
      page.getByRole("region", { name: "Smart defaults" }).locator(".defaults__row"),
    ).not.toHaveCount(0);

    for (const theme of THEMES) {
      // No shell, so no account menu: the choice is stored where the UI reads it and the page
      // reloaded, the path a returning reader's browser takes.
      await storeTheme(page, theme);
      await expect(card(page, WIZARD.pick).locator(".pick-row__key")).toHaveText("#488");
      await expect(page).toHaveScreenshot(`wizard-${theme}.png`, { mask: volatile(page) });
    }
  });

  test("dismissal: a fresh workspace's offer goes for good, and the wizard stays reachable", async ({
    context,
    page,
  }) => {
    const fresh = await enterFreshWorkspace(context, "offer");
    const repo = `${CHAIN.owner}/helios-console`;

    // The offer is per repository, so the workspace needs one — recorded through the tenancy
    // API, as a GitHub App installation one day will.
    await recordRepository(context, fresh.id, CHAIN.owner, "helios-console");
    await page.goto("/dashboard");

    const offer = page.getByRole("region", { name: DASHBOARD.offer });

    await expect(offer, OFFER_BROKE).toBeVisible();
    await expect(
      offer.getByRole("link", { name: DASHBOARD.offerLink }),
      OFFER_BROKE,
    ).toHaveAttribute("href", wizardPathFor(repo));

    await offer.getByRole("button", { name: DASHBOARD.dismiss }).click();
    await expect(offer, OFFER_BROKE).toHaveCount(0);

    // Dismissal is the service's fact: it sticks across a reload, and the rule says why.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: DASHBOARD.offer }), OFFER_BROKE).toHaveCount(0);

    const surfacing = await requestAs<{ offer: boolean; reason: string }>(
      context,
      "GET",
      "/api/v1/onboarding/surfacing",
      null,
      "reading the surfacing rule",
    );
    expect(surfacing, OFFER_BROKE).toEqual({ offer: false, reason: "wizard_finished" });

    // And the wizard is still there for whoever wants it.
    await page.goto(wizardPathFor(repo));
    await expect(page.getByRole("heading", { level: 1 }), OFFER_BROKE).toHaveText(WIZARD_TITLE);
    await expect(page.getByRole("navigation", { name: WIZARD.rail })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ the chain */

test.describe("the first loop, from a cold rail (#395)", () => {
  test("the chain: connect → pick → scan → template → Studio → pick → launch → dashboard → dry-run → simulated run → regression", async ({
    context,
    page,
    request,
  }) => {
    // One test that waits on the tracker, the scanner, the estimator, the engine, the queue and
    // the driver in sequence. `slow()` triples the per-test timeout rather than raising the suite's.
    test.slow();

    let simulation: Simulation | undefined;
    let issueNumber: number | undefined;
    let sourceId: string | undefined;

    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, CHAIN.slug);

    try {
      /* ------------------------------------------------ the guard: cold, or say so */

      expect(await sourceNamed(context, CHAIN.sourceName), NOT_COLD).toBeUndefined();
      expect(
        await mirroredRepository(context, CHAIN.tenantId, CHAIN.owner, CHAIN.name),
        NOT_COLD,
      ).toBeNull();

      // The intake mirror authenticates as the workspace (K.4) and the seed stores no token — the
      // honest state of a workspace nobody has connected. Arranged, as the knowledge leg does.
      await setGithubToken(context);
      const issue = await fileChainIssue(request);
      issueNumber = issue.number;

      /* ------------------------------------------------ step 1: connect, in the wizard's frame */

      await page.goto(wizardPathFor(CHAIN.repo));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(WIZARD_TITLE);
      await expect(bar(page)).toContainText("Step 1 of 4");
      await expect(railStep(page, 1)).toContainText("in progress");

      const connect = card(page, WIZARD.connect);

      await expect(connect).toContainText("step 1 · you are here");
      await connect.getByRole("button", { name: "+ Add source" }).click();

      // The sources module's own dialog: catalog, the provider's own form, done.
      const dialog = page.getByRole("dialog", { name: "Add a ticket source" });

      await dialog.getByRole("button", { name: /^GitHub/ }).click();
      await dialog.getByLabel("Name", { exact: true }).fill(CHAIN.sourceName);
      await dialog.getByLabel("GitHub account").fill(CHAIN.owner);
      await dialog.getByLabel("Repositories").fill(CHAIN.name);
      await dialog.getByLabel("Personal access token").fill(SANDBOX_GITHUB_TOKEN);
      await dialog.getByRole("button", { name: "Add source" }).click();

      await expect(
        dialog.getByRole("heading", { name: "Source added" }),
        CONNECT_BROKE,
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Done" }).click();

      // The source is real, and the rail derives step 1 from it on its next read.
      const source = await sourceNamed(context, CHAIN.sourceName);
      expect(source, CONNECT_BROKE).toBeDefined();
      sourceId = source!.id;
      // Step 1 is done, so the page moves on to step 2 of its own accord; the source's row is
      // asserted where the regression leg returns to it.
      await expect(railStep(page, 1), CONNECT_BROKE).toContainText(WIZARD.connected, {
        timeout: RAIL_MS,
      });

      /* ------------------------------------------------ step 2: pick, through the enablement switch */

      await expect(bar(page), ENABLE_BROKE).toContainText("Step 2 of 4", { timeout: RAIL_MS });

      const picker = card(page, WIZARD.picker);
      const row = picker.locator(`[data-repo="${CHAIN.repo}"]`);

      await expect(row, ENABLE_BROKE).toContainText("not recorded yet — switching on records it");
      await row.getByRole("switch", { name: `Enable Ouroboros in ${CHAIN.repo}` }).click();

      // The switch is a form: the action records, enables and starts the scan, then renders the
      // repository's wizard afresh at the same address — where the rail, derived from the mirror,
      // reads step 2 done and the page moves on to step 3 of its own accord.
      await expect(railStep(page, 2), ENABLE_BROKE).toContainText(`${CHAIN.name} ·`, {
        timeout: RAIL_MS,
      });

      const mirrored = await mirroredRepository(context, CHAIN.tenantId, CHAIN.owner, CHAIN.name);
      expect(mirrored, ENABLE_BROKE).toMatchObject({ enabled: true });

      /* ------------------------------------------------ the scan: real rows off the fixture's files */

      const detection = card(page, WIZARD.detection);

      await expect(detection.locator(".detect-row"), SCAN_BROKE).toHaveCount(
        DETECTION_ROWS.length,
        {
          timeout: SCAN_MS,
        },
      );

      for (const expected of DETECTION_ROWS) {
        const line = detection.locator(".detect-row", { hasText: expected.label });

        await expect(line, SCAN_BROKE).toHaveCount(1);
        await expect(line.locator(".detect-row__value"), SCAN_BROKE).toHaveText(expected.value);
      }

      // Step 2's result line knows the scan exists.
      await expect(railStep(page, 2), SCAN_BROKE).toContainText("auto-detected below", {
        timeout: RAIL_MS,
      });

      /* ------------------------------------------------ the backlog: synced, sized, picked */

      // Two chains with two credentials: the source's sync makes the canonical ticket the launch
      // queues and the driver opens for; the intake mirror makes the issue the picker scores and
      // hands it to the estimator.
      await syncSource(context, sourceId);
      await syncIntakeMirror(context);

      const pick = card(page, WIZARD.pick);

      await expect(pick.locator(".pick-row__key"), SIZE_BROKE).toHaveText(
        `#${String(issueNumber)}`,
        {
          timeout: ESTIMATE_MS,
        },
      );
      await expect(pick, SIZE_BROKE).toContainText(issue.title);

      /* ------------------------------------------------ step 3: the template, and the Studio */

      await expect(bar(page)).toContainText("Step 3 of 4", { timeout: RAIL_MS });

      const tiles = card(page, WIZARD.tiles);
      const tile = tiles.getByRole("button", { name: /Quick fixes/ });

      await tile.click();
      await expect(tiles.getByRole("status"), TEMPLATE_BROKE).toContainText(
        `Created ${CHAIN.workflow.name}.`,
      );
      await expect(tile, TEMPLATE_BROKE).toHaveAttribute("aria-pressed", "true");
      await expect(railStep(page, 3), TEMPLATE_BROKE).toContainText(
        `${CHAIN.workflow.slug} · from ${CHAIN.workflow.slug}@v${String(CHAIN.workflow.version)}`,
        { timeout: RAIL_MS },
      );

      // The workflow the tile created is a real one: the Studio opens it by its slug, and its
      // head is the workflow's name.
      await page.goto(`/workflows/${CHAIN.workflow.slug}`);
      await expect(page.getByRole("heading", { level: 1 }), TEMPLATE_BROKE).toHaveText(
        CHAIN.workflow.name,
      );

      /* ------------------------------------------------ step 4: the pick verified, and the launch */

      await page.goto(wizardPathFor(CHAIN.repo));
      await expect(bar(page)).toContainText("Step 4 of 4");
      // Nothing is stored yet — the wizard stores the pick when the loop is run (#393's decision),
      // so step 4's reason is the service's, the card shows the picker's suggestion, and the bar is
      // nonetheless unblocked by that suggestion.
      await expect(page.locator(".wizard-panel__line")).toContainText(
        "No first issue has been picked yet.",
      );
      await expect(card(page, WIZARD.pick).locator(".pick-row__key")).toHaveText(
        `#${String(issueNumber)}`,
      );

      const before = await queueTotal(context);
      const launch = bar(page).getByRole("button", { name: WIZARD.launch });

      await expect(launch).not.toHaveAttribute("aria-disabled", "true");
      await launch.click();

      // The receipt: what was queued, where it stands, the dry-run note, and where to go next.
      const receipt = card(page, WIZARD.receipt);

      await expect(receipt, LAUNCH_BROKE).toContainText(
        `#${String(issueNumber)} queued under ${CHAIN.workflow.slug}@v${String(CHAIN.workflow.version)} · queue position ${String(before + 1)}`,
      );
      await expect(receipt, LAUNCH_BROKE).toContainText("Dry-run is on");
      await expect(receipt.getByRole("link", { name: "Open the dashboard →" })).toHaveAttribute(
        "href",
        "/dashboard",
      );
      await expect(receipt.getByRole("link", { name: "See it in the queue →" })).toHaveAttribute(
        "href",
        "/dashboard#dash-up-next-title",
      );
      await expect(receipt.getByRole("link", { name: "Runs →" })).toHaveAttribute("href", "/runs");
      await expect(bar(page).getByRole("status"), LAUNCH_BROKE).toContainText(
        `#${String(issueNumber)} queued under ${CHAIN.workflow.slug}.`,
      );
      await expect(railStep(page, 4), LAUNCH_BROKE).toContainText(
        `#${String(issueNumber)} · queued`,
        {
          timeout: RAIL_MS,
        },
      );

      /* ------------------------------------------------ the dashboard, not the wizard's own word */

      // The receipt is the service's claim; the queue is the fact. The workspace already queues
      // more than the card's head draws, so what the dashboard can show is the count — moved by
      // exactly one — and the queue API shows the pin.
      expect(await queueTotal(context), DASHBOARD_BROKE).toBe(before + 1);

      const queued = await queuedItem(context, issueNumber);
      expect(queued, DASHBOARD_BROKE).toMatchObject({
        workflowTag: CHAIN.workflow.slug,
        workflowVersion: CHAIN.workflow.version,
        workflowPinReason: "explicit",
      });

      await page.goto("/dashboard");

      const queue = card(page, DASHBOARD.queue);
      const beyond = before + 1 - QUEUE_HEAD;

      await expect(queue, DASHBOARD_BROKE).toBeVisible();
      if (beyond > 0) {
        await expect(
          queue.getByRole("link", { name: `+${String(beyond)} queued →` }),
          DASHBOARD_BROKE,
        ).toBeVisible();
      } else {
        await expect(queue, DASHBOARD_BROKE).toContainText(`#${String(issueNumber)}`);
      }

      /* ------------------------------------------------ dry-run, where the product states it */

      // The seed never answered; completing the wizard is what turns it on (BB.5).
      expect(await dryRunPolicy(context), POLICY_BROKE).toMatchObject({
        dryRun: true,
        explicit: true,
      });

      await page.goto("/settings/policies");
      await expect(
        page.getByRole("group", { name: DRY_RUN.group }).getByRole("status"),
        POLICY_BROKE,
      ).toHaveText(DRY_RUN.on);

      /* ------------------------------------------------ the driver: a watermarked run to the terminal */

      simulation = await startSimulation("first-loop", DRIVER_SPEED, {
        ticketSource: sourceId,
        ticket: `#${String(issueNumber)}`,
        repository: mirrored!.id,
        workflow: CHAIN.workflow.slug,
        workflowVersion: CHAIN.workflow.version,
      });

      await page.goto(`/runs/${simulation.runId}`);
      await expect(page.getByRole("note"), DRIVER_BROKE).toContainText("Simulated run.");
      await expect(page.getByRole("heading", { level: 1 }), DRIVER_BROKE).toContainText(
        `#${String(issueNumber)}`,
      );
      await expect
        .poll(() => page.locator(".run-step--done").count(), {
          message: DRIVER_BROKE,
          timeout: DRIVER_MS,
        })
        .toBe(QUICK_FIXES_STAGES);

      const { code, output } = await simulation.finished;
      expect(code, DRIVER_BROKE).toBe(0);
      expect(output, DRIVER_BROKE).toContain("first-loop: completed");

      // The rail knows: the picked issue has a run.
      await page.goto(wizardPathFor(CHAIN.repo));
      await expect(railStep(page, 4), DRIVER_BROKE).toContainText(
        `#${String(issueNumber)} · run started`,
        {
          timeout: RAIL_MS,
        },
      );
      await expect(card(page, WIZARD.receipt), DRIVER_BROKE).toContainText("run started");

      /* ------------------------------------------------ the regression leg */

      // The source paused in its own row — the sources module's control, inside the wizard.
      await page.getByRole("navigation", { name: WIZARD.rail }).getByRole("button").first().click();

      const sourceRow = card(page, WIZARD.connect).locator(".sources-row", {
        hasText: CHAIN.sourceName,
      });

      await sourceRow.getByRole("button", { name: "Pause" }).click();

      const banner = card(page, WIZARD.regress);

      await expect(banner, REGRESSION_BROKE).toContainText(
        `The GitHub source "${CHAIN.sourceName}" is paused, so ${CHAIN.repo} is not being read.`,
        { timeout: RAIL_MS },
      );
      await expect(railStep(page, 1), REGRESSION_BROKE).toHaveClass(/wizard-step--regressed/);
      await expect(railStep(page, 1), REGRESSION_BROKE).toContainText("no longer done");

      // The fix path leads back to the step whose surface owns the problem — and Resume is there.
      await page.getByRole("navigation", { name: WIZARD.rail }).getByRole("button").nth(2).click();
      await expect(bar(page)).toContainText("Step 3 of 4");
      await banner.getByRole("button", { name: "Fix step 1 →" }).click();
      await expect(bar(page)).toContainText("Step 1 of 4");
      await sourceRow.getByRole("button", { name: "Resume" }).click();

      await expect(banner, REGRESSION_BROKE).toHaveCount(0, { timeout: RAIL_MS });
      await expect(railStep(page, 1), REGRESSION_BROKE).toContainText(WIZARD.connected);
    } finally {
      simulation?.stop();
      await clearGithubToken(context);
      await restoreDryRun(context);
      if (sourceId !== undefined) await pauseSource(context, sourceId);
      if (issueNumber !== undefined) {
        const number = issueNumber;
        await quietly(
          () => closeChainIssue(request, number),
          "the chain's sandbox issue was not closed — a later sync adopts it as open work.",
        );
      }
    }
  });
});
