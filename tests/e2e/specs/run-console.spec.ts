/**
 * Leg 18 — the run console, certified ([#314](https://github.com/NobuData/ouroboros/issues/314),
 * AQ.6): **the MVP gate of the Run Console milestone.**
 *
 * Leg 17 (`runs.spec.ts`) proves each of the console's parts where it was built — the controls
 * (#310), the timeline (#311), the transcript (#312), the right column (#313). This leg proves
 * the whole stack moving together against a run that is genuinely moving: ingestion, guardrail
 * evaluation, control delivery, the streaming reads, and the page drawing all of it.
 *
 * * **Parity** — a *finished* seeded run (`#474`, merged) in both palettes: the outcome pill,
 *   the frozen elapsed, the pull request link, the transcript closed to steering with its reason.
 *   Mockup 10 draws only a run mid-flight, which leg 17's pairs already photograph.
 * * **The live scenario** — the simulated-run driver's `482-gate-return` (#307), watched: stepper
 *   transitions advance, transcript entries append, a steer typed mid-attempt comes back as the
 *   service's own `user` entry *acknowledged*, guardrail verdicts render, a pause reaches
 *   *acknowledged*, and the run carries on once resumed.
 * * **The abort** — a second scenario aborted through the dialog with its typed confirmation,
 *   landing in the terminal state: `canceled`, elapsed frozen, steering closed with a reason, the
 *   `streaming` pill gone, no controls left.
 * * **The export** — the *Raw JSONL ↗* file, carrying the simulated watermark on every line.
 * * **The shell** — header and sidebar fixed while the content pane scrolls, the originating
 *   module's sidebar entry lit, and the page correct at the 125 % font-scale step.
 *
 * Each of these fails where its layer breaks (`scripts/verify-failure-modes.sh`, and the README's
 * record of the three spot checks: ingestion, control delivery, guardrail evaluation).
 */

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { restoreFontScale, setFontScale, expectFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { SESSION_COOKIE, sessionTokenOf, signIn } from "../support/session";
import { type Simulation, startSimulation } from "../support/simulator";
import { REST_URL } from "../support/stack";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * The live scenario's speed: its ~830 scripted seconds in under a minute and a half, with safe
 * boundaries — where a control lands — never more than fifteen real seconds apart.
 */
const LIVE_SPEED = 10;

/** The abort leg's speed — leg 17's, whose boundaries are quick enough to abort promptly. */
const ABORT_SPEED = 5;

/** How long a control may take to be acknowledged — a boundary, a fetch, a poll, twice over. */
const ACK_TIMEOUT_MS = 30 * 1000;

/** How long the page may take to show something ingestion reported — the 15 s poll, twice. */
const POLL_TIMEOUT_MS = 45 * 1000;

/** The live scenario's budget. */
const LIVE_TIMEOUT_MS = 2 * 60 * 1000;

/** The seeded run that merged — `R__dev_seed_dashboard.sql`'s `#474`, *Loop #1839*, PR #512. */
const MERGED_RUN_ID = "5eed0009-0000-4000-8000-000000000474";

/** The seeded run mid-flight — mockup 10's `#482`. Long enough to scroll the pane. */
const SEEDED_RUN_ID = "5eed0009-0000-4000-8000-000000000482";

/** A window wide enough for the 7/5 split and tall enough to photograph the page whole. */
const PARITY_WINDOW = { width: 1920, height: 1400 };

/** What the steering box says once a run has ended (#312). */
const STEER_ENDED = "This run has ended, so there is no loop left to steer.";

/*
 * What the live scenario says when a layer under it broke — the "fails meaningfully" half of the
 * gate (#314). Each is printed with the assertion that went red, so the log names the layer
 * rather than only a timeout.
 */

/** No transcript entry arrived: the driver's events were not stored (AP.1, #303). */
const INGESTION_BROKE =
  "transcript entries must arrive and append — the ingestion contract stores what the driver reports";

/** A control never reached acknowledged: the driver was not handed it (#306). */
const DELIVERY_BROKE =
  "the control must be acknowledged — control delivery hands it to the driver at a safe boundary";

/** No verdict rendered: nothing evaluated the reported change-set (AP.3, #305). */
const GUARDRAILS_BROKE =
  "guardrail verdicts must render — the control plane evaluates every reported change-set";

/**
 * Sign the seeded owner into the seeded workspace.
 *
 * @param context The browser context.
 * @returns When the session is ready.
 */
async function signInOwner(context: BrowserContext): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
}

/**
 * A visible region of the console by its accessible name — visible only, because while the page
 * streams React keeps a hidden copy of the segment in the DOM (leg 17's note).
 *
 * @param page The run console.
 * @param name The region's name.
 * @returns The region.
 */
function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true }).filter({ visible: true });
}

/**
 * The head's meta row.
 *
 * @param page The run console.
 * @returns The row.
 */
function meta(page: Page) {
  return page.locator(".run-head__meta").filter({ visible: true });
}

/**
 * The head's control group (#310).
 *
 * @param page The run console.
 * @returns The group.
 */
function controls(page: Page) {
  return page.getByRole("group", { name: "Run controls" });
}

/**
 * The delivery chips' live region (#310).
 *
 * @param page The run console.
 * @returns The region.
 */
function chips(page: Page) {
  return page.locator(".run-controls__status").filter({ visible: true });
}

/**
 * Abort a run straight through the service — cleanup, so nothing is left moving.
 *
 * @param context A signed-in owner's context.
 * @param simulation The run.
 * @returns When the service has queued it.
 */
async function abortQuietly(context: BrowserContext, simulation: Simulation): Promise<void> {
  const token = await sessionTokenOf(context, "aborting the leg's run");
  await fetch(`${REST_URL}/api/v1/runs/${simulation.runId}/controls`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ kind: "abort", confirmation: String(simulation.loopSeq) }),
  });
}

test.describe("the run console, certified (#314)", () => {
  test("parity: a merged run, seeded, in both palettes", async ({ context, page }) => {
    await signInOwner(context);
    await page.setViewportSize(PARITY_WINDOW);
    await page.goto(`/runs/${MERGED_RUN_ID}`);

    const head = page.locator(".run-head").filter({ visible: true });
    await expect(head.locator(".ou-eyebrow")).toHaveText("Run Console · Loop #1839");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#474 — Debounce e-stop interrupt handler",
    );

    // ---- Terminal: the outcome pill, still; elapsed frozen at the cycle; the PR offered.
    const pill = meta(page).locator(".ou-chip").first();
    await expect(pill).toHaveText("merged");
    await expect(pill.locator(".ou-chip__dot--pulse")).toHaveCount(0);
    await expect(meta(page)).toContainText("elapsed 11m 00s");
    await expect(meta(page).getByRole("link", { name: /PR #512/ })).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/pull/512",
    );
    await expect(controls(page)).toHaveCount(0);

    // ---- The transcript: quiet, closed to steering, and saying why.
    const transcript = region(page, "Agent transcript");
    await expect(transcript.getByText("streaming")).toHaveCount(0);
    await expect(transcript.getByRole("textbox", { name: "Steer the loop" })).toBeDisabled();
    await expect(transcript).toContainText(STEER_ENDED);

    // ---- No lag banner on a finished run: it is supposed to be quiet.
    await expect(page.getByText(/No new activity since/)).toHaveCount(0);

    const main = page.locator("main.run").filter({ visible: true });
    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main).toHaveScreenshot(`run-console-merged-${theme}.png`);
    }
  });

  test("live: 482-gate-return — stepper, transcript, steer, guardrails, pause and resume", async ({
    context,
    page,
  }) => {
    test.setTimeout(LIVE_TIMEOUT_MS);
    const simulation = await startSimulation("482-gate-return", LIVE_SPEED);

    try {
      await signInOwner(context);
      await page.goto(`/runs/${simulation.runId}?from=dashboard`);

      await expect(
        page.locator(".run-head__main .ou-eyebrow").filter({ visible: true }),
      ).toHaveText(`Run Console · Loop #${simulation.loopSeq}`);
      // #309's watermark, at the frame.
      await expect(page.getByRole("note").filter({ hasText: "Simulated run." })).toBeVisible();

      const timeline = region(page, "Stage timeline");
      const transcript = region(page, "Agent transcript");
      const entries = transcript
        .getByRole("region", { name: "Transcript entries" })
        .getByRole("article");

      // What the page showed first — everything below is measured against it.
      await expect(entries.first(), INGESTION_BROKE).toBeVisible({ timeout: POLL_TIMEOUT_MS });
      const doneAtFirst = await timeline.locator(".run-step--done").count();
      const entriesAtFirst = await entries.count();

      // ---- Transcript entries append on the stream, without a reload.
      await expect
        .poll(() => entries.count(), { message: INGESTION_BROKE, timeout: POLL_TIMEOUT_MS })
        .toBeGreaterThan(entriesAtFirst);

      // ---- A steer typed mid-attempt: the service's own user entry, acknowledged.
      const text = `prefer a fix inside the ISR — e2e ${Date.now()}`;
      await transcript.getByRole("textbox", { name: "Steer the loop" }).fill(text);
      await transcript.getByRole("button", { name: "Send" }).click();
      const steer = transcript
        .locator(".run-entry")
        .filter({ has: page.locator(".run-entry__actor--user") })
        .filter({ hasText: text });
      await expect(steer).toHaveCount(1);
      await expect(steer, DELIVERY_BROKE).toContainText("Steer · acknowledged", {
        timeout: ACK_TIMEOUT_MS,
      });
      await expect(steer).not.toHaveClass(/run-entry--optimistic/);

      // ---- Pause reaches acknowledged; resume, and the run carries on.
      await controls(page).getByRole("button", { name: "Pause loop" }).click();
      await expect(chips(page), DELIVERY_BROKE).toContainText("Pause · acknowledged", {
        timeout: ACK_TIMEOUT_MS,
      });
      await expect(controls(page).getByRole("button", { name: "Resume" })).toBeVisible();

      await controls(page).getByRole("button", { name: "Resume" }).click();
      await expect(chips(page), DELIVERY_BROKE).toContainText("Resume · acknowledged", {
        timeout: ACK_TIMEOUT_MS,
      });
      const entriesAtResume = await entries.count();
      await expect
        .poll(() => entries.count(), { message: INGESTION_BROKE, timeout: POLL_TIMEOUT_MS })
        .toBeGreaterThan(entriesAtResume);

      // ---- Guardrail verdicts, evaluated by the control plane over the reported change-set.
      const guardrails = region(page, "Guardrails");
      await expect(guardrails.locator(".run-guard__mark").first(), GUARDRAILS_BROKE).toBeVisible({
        timeout: POLL_TIMEOUT_MS,
      });
      await expect(guardrails.locator(".run-guard__mark")).toContainText(["✓"]);
      await expect(guardrails.locator(".ou-card__head .ou-chip")).toHaveText("clean");

      // ---- The stepper advanced: more stages done than when the page opened.
      await expect
        .poll(() => timeline.locator(".run-step--done").count(), { timeout: POLL_TIMEOUT_MS })
        .toBeGreaterThan(doneAtFirst);
      await expect(page.getByText(/No new activity since/)).toHaveCount(0);
    } finally {
      await abortQuietly(context, simulation);
      simulation.stop();
    }
  });

  test("abort: typed confirmation lands the terminal state, and the export carries the watermark", async ({
    context,
    page,
  }) => {
    test.setTimeout(LIVE_TIMEOUT_MS);
    const simulation = await startSimulation("control-responsive", ABORT_SPEED);
    const { runId, loopSeq } = simulation;

    try {
      await signInOwner(context);
      await page.goto(`/runs/${runId}`);
      const transcript = region(page, "Agent transcript");
      await expect(transcript.getByText("streaming")).toBeVisible();

      // ---- Abort, confirmed by typing the loop number.
      await controls(page).getByRole("button", { name: "Abort run" }).click();
      const dialog = page.getByRole("alertdialog", { name: `Abort Loop #${loopSeq}?` });
      await dialog.getByLabel(`Type ${loopSeq} to confirm`).fill(String(loopSeq));
      await dialog.getByRole("button", { name: `Abort Loop #${loopSeq}` }).click();
      await expect(dialog).toBeHidden();

      // ---- The terminal state, without a reload.
      const pill = meta(page).locator(".ou-chip").first();
      // The abort is acked by the driver, which closes the run: delivery is under this line.
      await expect(pill, DELIVERY_BROKE).toHaveText("canceled", { timeout: ACK_TIMEOUT_MS * 2 });
      await expect(pill.locator(".ou-chip__dot--pulse")).toHaveCount(0);
      await expect(controls(page)).toHaveCount(0);
      await expect(transcript.getByRole("textbox", { name: "Steer the loop" })).toBeDisabled({
        timeout: POLL_TIMEOUT_MS,
      });
      await expect(transcript).toContainText(STEER_ENDED);
      await expect(transcript.getByText("streaming")).toHaveCount(0);
      await expect(meta(page).getByRole("link", { name: /PR #/ })).toHaveCount(0);

      // Elapsed is frozen: the same figure across more than a tick.
      const elapsed = meta(page).locator(".run-head__elapsed");
      const frozen = await elapsed.textContent();
      await page.waitForTimeout(2500);
      await expect(elapsed).toHaveText(frozen ?? "");

      expect((await simulation.finished).output).toContain("control-responsive: aborted");

      // ---- The export — the button's own file — carries the watermark, line by line.
      const link = transcript.getByRole("link", { name: "Raw JSONL ↗" });
      const href = await link.getAttribute("href");
      expect(href).toBe(`/api/runs/${runId}/transcript.jsonl`);
      const file = await page.request.get(href ?? "");
      expect(file.status()).toBe(200);
      expect(file.headers()["content-disposition"]).toContain(`loop-${loopSeq}.jsonl`);

      const lines = (await file.text()).split("\n").filter((line) => line !== "");
      expect(lines[0]).toBe("# simulated run");
      const rows = lines.filter((line) => !line.startsWith("#"));
      expect(rows.length, INGESTION_BROKE).toBeGreaterThan(0);
      for (const line of rows) {
        expect((JSON.parse(line) as { simulated?: boolean }).simulated).toBe(true);
      }
    } finally {
      simulation.stop();
    }
  });

  test("shell: fixed chrome, the origin lit, and the 125% step", async ({ context, page }) => {
    await signInOwner(context);

    try {
      await setFontScale(context, "125");
      await page.goto(`/runs/${SEEDED_RUN_ID}?from=build-farm`);
      await expectFontScale(page, "125");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // ---- The module it was opened from stays lit; the console has no entry of its own.
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

        // ---- At 125%, nothing in the console pushes the pane sideways.
        await expectNoPaneHorizontalScroll(page);
      }
    } finally {
      await restoreFontScale(context);
    }
  });
});
