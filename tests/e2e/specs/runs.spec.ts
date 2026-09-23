/**
 * Leg 17 — the run console's controls against a run that really answers them
 * ([#310](https://github.com/NobuData/ouroboros/issues/310), AQ.2).
 *
 * `ouroboros-ui`'s own suite drives *Pause loop*, *Take over in IDE* and *Abort run* against a
 * stubbed queue. What only a running stack can say is whether a press travels the whole way:
 * the browser, the Server Action, `ouroboros-rest`'s durable control queue (#306), the
 * simulated-run driver (#307) fetching it at a safe boundary, and its acknowledgment coming
 * back to the chip. So the run here is opened by the real driver, `control-responsive`, which
 * applies pause, resume and abort exactly as an executor will.
 *
 * In one run, in order:
 *
 * * **Pause reaches `acknowledged`** and the button becomes **Resume**; Resume comes back the
 *   same way.
 * * **A double click on Pause is one control** — counted on the queue, not on the page.
 * * **Take over in IDE** hands over the run's branch as copy-able commands and says what it
 *   does not do yet (#316).
 * * **A member** is served none of the three and refused on a direct call, a session rather
 *   than a fixture.
 * * **A forged abort** — the wrong loop number, sent straight to the service — is refused;
 *   the dialog cannot be pressed without the right one; and a real abort ends the run as
 *   `canceled`, which the page shows without a reload while the driver reports `aborted` —
 *   and the stage timeline draws the stage it died on as failed (#311).
 *
 * And the agent transcript ([#312](https://github.com/NobuData/ouroboros/issues/312)): the seeded
 * nine screenshot in both palettes, and a steer typed into a simulated run that comes back as
 * the service's own `user` entry, acknowledged — with the box closed, and saying why, once the
 * run has ended.
 *
 * And a second run, for the stage timeline ([#311](https://github.com/NobuData/ouroboros/issues/311)):
 * a stage handing over to the next on a poll, a pressed node filtering in the address and
 * surviving a reload, and — at phone width, in both palettes — a strip that scrolls in its own
 * box while the pane does not.
 */

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { expectNoPaneHorizontalScroll } from "../support/shell";
import { SESSION_COOKIE, sessionTokenOf, signIn } from "../support/session";
import { type Simulation, startSimulation } from "../support/simulator";
import { REST_URL } from "../support/stack";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** How fast the driver runs: a safe boundary every five real seconds at the most. */
const SPEED = 5;

/** How long a control may take to be acknowledged — a boundary, a fetch, a poll, twice over. */
const ACK_TIMEOUT_MS = 30 * 1000;

/** The whole leg's budget: one run, driven end to end. */
const LEG_TIMEOUT_MS = 4 * 60 * 1000;

/** The timeline test's speed: quick enough that a stage changes while the page is open. */
const TIMELINE_SPEED = 10;

/** How long one stage may take to hand over to the next, at that speed, polled at 15 s. */
const STAGE_TIMEOUT_MS = 90 * 1000;

/** The seeded run mockup 10 is drawn from — `R__dev_seed_dashboard.sql`'s #482. */
const SEEDED_RUN_ID = "5eed0009-0000-4000-8000-000000000482";

/** The branch `control-responsive` opens its run on. */
const BRANCH = "loop/482-canbus-flake-controls";

/**
 * Call the controls endpoint as the context's person.
 *
 * @param context A signed-in context.
 * @param method `GET` to read the queue, `POST` to submit.
 * @param runId The run.
 * @param body What to submit.
 * @returns The status and the parsed body.
 */
async function controlsAs(
  context: BrowserContext,
  method: "GET" | "POST",
  runId: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: { controls?: { kind: string }[]; code?: string } }> {
  const token = await sessionTokenOf(context, "calling the run controls");
  const response = await fetch(`${REST_URL}/api/v1/runs/${runId}/controls`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { status: response.status, body: (await response.json()) as never };
}

/**
 * How many pauses the queue holds for a run.
 *
 * @param context A signed-in context.
 * @param runId The run.
 * @returns The count.
 */
async function pausesOn(context: BrowserContext, runId: string): Promise<number> {
  const { body } = await controlsAs(context, "GET", runId);

  return (body.controls ?? []).filter((control) => control.kind === "pause").length;
}

/**
 * The head's action row.
 *
 * @param page The run console.
 * @returns The group.
 */
function controls(page: Page) {
  return page.getByRole("group", { name: "Run controls" });
}

/**
 * The delivery chips' live region.
 *
 * @param page The run console.
 * @returns The region.
 */
function chips(page: Page) {
  // Visible only: while the page streams, React keeps a hidden copy of the segment in the DOM.
  return page.locator(".run-controls__status").filter({ visible: true });
}

/**
 * The stage timeline card (#311).
 *
 * @param page The run console.
 * @returns The card — visible only, for the streaming copy's reason above.
 */
function timeline(page: Page) {
  return page.getByRole("region", { name: "Stage timeline" }).filter({ visible: true });
}

test.describe("the run controls, against the simulated-run driver", () => {
  test.describe.configure({ mode: "serial" });

  let simulation: Simulation | undefined;

  test.afterAll(() => {
    simulation?.stop();
  });

  test("pause, resume, take over, a member refused, and an abort that ends the run", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(LEG_TIMEOUT_MS);

    simulation = await startSimulation("control-responsive", SPEED);
    const { runId, loopSeq } = simulation;

    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.goto(`/runs/${runId}`);
    await expect(page.locator(".run-head__main .ou-eyebrow").filter({ visible: true })).toHaveText(
      `Run Console · Loop #${loopSeq}`,
    );
    await expect(page.getByRole("note").filter({ hasText: "Simulated run." })).toBeVisible();

    // ---- Pause reaches acknowledged, and the button becomes Resume.
    await controls(page).getByRole("button", { name: "Pause loop" }).click();
    await expect(chips(page)).toContainText(/Pause · (sending|sent|received|acknowledged)/);
    await expect(chips(page)).toContainText("Pause · acknowledged", { timeout: ACK_TIMEOUT_MS });
    await expect(controls(page).getByRole("button", { name: "Resume" })).toBeVisible();
    expect(await pausesOn(context, runId)).toBe(1);

    // ---- Resume comes back the same way.
    await controls(page).getByRole("button", { name: "Resume" }).click();
    await expect(chips(page)).toContainText("Resume · acknowledged", { timeout: ACK_TIMEOUT_MS });
    await expect(controls(page).getByRole("button", { name: "Pause loop" })).toBeVisible();

    // ---- A double click is one control.
    await controls(page).getByRole("button", { name: "Pause loop" }).dblclick();
    await expect(chips(page)).toContainText("Pause · acknowledged", { timeout: ACK_TIMEOUT_MS });
    expect(await pausesOn(context, runId)).toBe(2);

    // ---- Take over: the loop is already paused, so the hand-off asks for nothing more.
    await controls(page).getByRole("button", { name: "Take over in IDE" }).click();
    const handoff = page.getByRole("dialog", { name: "Take over in your editor" });
    await expect(handoff).toBeVisible();
    await expect(handoff.locator(".run-handoff__commands")).toHaveText(
      `git fetch origin ${BRANCH}\ngit switch ${BRANCH}`,
    );
    await expect(handoff.getByRole("note")).toContainText(
      "Deep IDE integration is arriving (#316)",
    );
    await expect(handoff.getByRole("link", { name: /transcript/ })).toHaveAttribute(
      "href",
      `/api/runs/${runId}/transcript.jsonl`,
    );
    const transcript = await page.request.get(`/api/runs/${runId}/transcript.jsonl`);
    expect(transcript.status()).toBe(200);
    // A simulated run's export opens with its watermark comment (R4); every other line is JSON.
    const lines = (await transcript.text()).split("\n").filter((line) => line !== "");
    expect(lines[0]).toBe("# simulated run");
    const entries = lines.filter((line) => !line.startsWith("#"));
    expect(entries.length).toBeGreaterThan(0);
    for (const line of entries) expect(() => JSON.parse(line) as unknown).not.toThrow();
    await page.keyboard.press("Escape");
    await expect(handoff).toBeHidden();
    expect(await pausesOn(context, runId)).toBe(2);

    // ---- A member sees none of it, and a direct call is refused.
    const memberContext = await browser.newContext();
    try {
      await signIn(memberContext, SEED_MEMBER.id);
      await selectWorkspace(memberContext, SEED_TENANT.slug);
      const memberPage = await memberContext.newPage();
      await memberPage.goto(`/runs/${runId}`);
      await expect(
        memberPage.locator(".run-head__main .ou-eyebrow").filter({ visible: true }),
      ).toHaveText(`Run Console · Loop #${loopSeq}`);
      await expect(controls(memberPage)).toHaveCount(0);
      await expect(
        memberPage.getByRole("button", { name: /Pause loop|Resume|Abort run|Take over/ }),
      ).toHaveCount(0);

      expect((await controlsAs(memberContext, "POST", runId, { kind: "pause" })).status).toBe(403);
      expect(
        (
          await controlsAs(memberContext, "POST", runId, {
            kind: "abort",
            confirmation: String(loopSeq),
          })
        ).status,
      ).toBe(403);
    } finally {
      await memberContext.close();
    }

    // ---- A forged confirmation is refused by the service, whatever the page did.
    const forged = await controlsAs(context, "POST", runId, {
      kind: "abort",
      confirmation: String(loopSeq + 1),
    });
    expect(forged.status).toBe(422);
    expect(forged.body.code).toBe("abort_confirmation_invalid");

    // ---- The dialog cannot be pressed without the right number.
    await controls(page).getByRole("button", { name: "Abort run" }).click();
    const abort = page.getByRole("alertdialog", { name: `Abort Loop #${loopSeq}?` });
    await expect(abort).toBeVisible();
    await expect(abort).toContainText("marked canceled");
    await expect(abort).toContainText(`${BRANCH} is preserved`);
    const confirm = abort.getByRole("button", { name: `Abort Loop #${loopSeq}` });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    const field = abort.getByLabel(`Type ${loopSeq} to confirm`);
    await expect(field).toBeFocused();
    await field.fill("1");
    // Forced: Playwright will not press an aria-disabled control, and pressing it is the point.
    await confirm.click({ force: true });
    await expect(abort).toBeVisible();
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    // ---- The real abort ends the run; the page goes terminal without a reload.
    await field.fill(String(loopSeq));
    await expect(confirm).not.toHaveAttribute("aria-disabled");
    await confirm.click();
    await expect(abort).toBeHidden();

    await expect(page.locator(".run-head__meta").filter({ visible: true })).toContainText(
      "canceled",
      {
        timeout: ACK_TIMEOUT_MS * 2,
      },
    );
    await expect(controls(page)).toHaveCount(0);

    // #311: the stage the loop died on is drawn failed, not paused.
    await expect(
      timeline(page).locator(".run-step--failed").filter({ hasText: "canceled" }),
    ).toHaveCount(1);

    const { code, output } = await simulation.finished;
    expect(code).toBe(0);
    expect(output).toContain("control-responsive: aborted");
  });
});

test.describe("the stage timeline, against the simulated-run driver (#311)", () => {
  let simulation: Simulation | undefined;

  test.afterAll(() => {
    simulation?.stop();
  });

  test("moves on the poll, filters by stage in the address, and scrolls in its own box", async ({
    context,
    page,
  }) => {
    test.setTimeout(LEG_TIMEOUT_MS);

    simulation = await startSimulation("control-responsive", TIMELINE_SPEED);
    const { runId, loopSeq } = simulation;

    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.goto(`/runs/${runId}?from=dashboard`);

    // ---- A stage transition arrives on a poll, without a reload.
    const active = timeline(page).locator(".run-step--active .run-step__name");
    await expect(active).toHaveCount(1, { timeout: ACK_TIMEOUT_MS });
    const first = (await active.textContent()) ?? "";
    await expect(active).not.toHaveText(first, { timeout: STAGE_TIMEOUT_MS });
    await expect(
      timeline(page).getByRole("button", { name: new RegExp(`^${first}, done`) }),
    ).toBeVisible();

    // ---- Pressing a node filters, and the address carries it — reloading keeps it. The labels
    // are the pinned workflow's own (the simulator's `implement` is "Code the change"), so the
    // node pressed is the first, whose key the driver's prelude fixes: `issue-queued`.
    const queued = () => timeline(page).getByRole("button", { name: /^Issue queued,/ });
    await queued().click();
    await expect(queued()).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]from=dashboard/);
    await expect(page).toHaveURL(/[?&]stage=issue-queued/);
    await page.reload();
    await expect(queued()).toHaveAttribute("aria-pressed", "true");

    // ---- Narrow, in both palettes: the strip scrolls in its own box, the pane never does.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expectNoPaneHorizontalScroll(page);

      const wrapper = timeline(page).locator(".run-timeline__scroll");
      const overflow = await wrapper.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(
        overflow,
        "eight steps are wider than a phone, so the wrapper scrolls",
      ).toBeGreaterThan(0);
    }

    // ---- End the run, so nothing is left moving.
    const aborted = await controlsAs(context, "POST", runId, {
      kind: "abort",
      confirmation: String(loopSeq),
    });
    expect(aborted.status).toBe(202);
    expect((await simulation.finished).output).toContain("control-responsive: aborted");
  });
});

/**
 * The agent transcript card (#312).
 *
 * @param page The run console.
 * @returns The card — visible only, for the streaming copy's reason above.
 */
function transcript(page: Page) {
  return page.getByRole("region", { name: "Agent transcript" }).filter({ visible: true });
}

test.describe("the agent transcript (#312)", () => {
  test("draws the seeded nine in both palettes", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.goto(`/runs/${SEEDED_RUN_ID}`);

    const card = transcript(page);
    const entries = card.getByRole("region", { name: "Transcript entries" }).getByRole("article");
    await expect(entries).toHaveCount(9);
    await expect(entries.nth(2)).toContainText("CLAUDE-FABLE-5");
    await expect(entries.nth(4)).toContainText("2 passed, 1 flaked → retrying under load profile");
    await expect(entries.nth(8)).toContainText("running… 47/63 cases");
    await expect(card).not.toContainText(/slack/i);

    // The printed times are the seed's offsets from `now()`, different on every run: masked.
    // Two shots per palette, because the well follows the tail: its head (the first entries,
    // with *Jump to latest* offered), then its tail — together, all nine.
    const mask = [card.locator(".run-entry__time")];
    const well = card.locator(".run-transcript__scroll");
    for (const theme of THEMES) {
      await pinTheme(page, theme);

      await well.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(card.getByRole("button", { name: "Jump to latest ↓" })).toBeVisible();
      await expect(card).toHaveScreenshot(`run-transcript-head-${theme}.png`, { mask });

      await card.getByRole("button", { name: "Jump to latest ↓" }).click();
      await expect(card.getByRole("button", { name: "Jump to latest ↓" })).toHaveCount(0);
      await expect(card).toHaveScreenshot(`run-transcript-tail-${theme}.png`, { mask });
    }
  });

  test("round-trips a steer, and closes the box once the run has ended", async ({
    context,
    page,
  }) => {
    test.setTimeout(LEG_TIMEOUT_MS);
    const simulation = await startSimulation("control-responsive", SPEED);

    try {
      await signIn(context, SEED_OWNER.id);
      await selectWorkspace(context, SEED_TENANT.slug);
      await page.goto(`/runs/${simulation.runId}`);

      const card = transcript(page);
      const input = card.getByRole("textbox", { name: "Steer the loop" });
      await expect(input).toBeEnabled();
      await expect(card.getByText("streaming")).toBeVisible();

      const text = `use a ring buffer — e2e ${Date.now()}`;
      await input.fill(text);
      await card.getByRole("button", { name: "Send" }).click();

      const users = card
        .locator(".run-entry")
        .filter({ has: page.locator(".run-entry__actor--user") });
      await expect(users.filter({ hasText: text })).toHaveCount(1);
      await expect(users.filter({ hasText: text })).toContainText(
        /Steer · (sending|sent|received|acknowledged)/,
      );
      await expect(users.filter({ hasText: text })).toContainText("Steer · acknowledged", {
        timeout: ACK_TIMEOUT_MS,
      });
      await expect(users.filter({ hasText: text })).not.toHaveClass(/run-entry--optimistic/);
      await expect(input).toHaveValue("");

      const aborted = await controlsAs(context, "POST", simulation.runId, {
        kind: "abort",
        confirmation: String(simulation.loopSeq),
      });
      expect(aborted.status).toBe(202);

      await expect(input).toBeDisabled({ timeout: ACK_TIMEOUT_MS * 2 });
      await expect(card).toContainText("This run has ended, so there is no loop left to steer.");
      await expect(card.getByText("streaming")).toHaveCount(0);
      expect((await simulation.finished).output).toContain("control-responsive: aborted");
    } finally {
      simulation.stop();
    }
  });
});

/**
 * A window wide enough for mockup 10's 7/5 split and tall enough that the right column is
 * photographed whole — the parity pairs' reason, in the README's *Screenshot baselines*.
 */
const RIGHT_COLUMN_WINDOW = { width: 1920, height: 1400 };

test.describe("the right column (#313)", () => {
  test("draws the seeded changes, resources and guardrails in both palettes", async ({
    context,
    page,
  }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.setViewportSize(RIGHT_COLUMN_WINDOW);
    await page.goto(`/runs/${SEEDED_RUN_ID}`);

    const side = page.locator(".run__side");
    const changes = side.getByRole("region", { name: "Changes so far" });
    const resources = side.getByRole("region", { name: "Resources" });
    const guardrails = side.getByRole("region", { name: "Guardrails" });

    // ---- Changes so far: three files with counts, two commits, the squash tag.
    await expect(changes).toContainText("3 files");
    const files = changes.getByRole("region", { name: "Changed files" }).getByRole("listitem");
    await expect(files).toHaveCount(3);
    await expect(files.nth(0)).toHaveText("drivers/can/telemetry_buf.c+38−12");
    await expect(files.nth(1)).toHaveText("drivers/can/isr_fastpath.c+9−3");
    await expect(files.nth(2)).toHaveText("tests/telemetry/test_frame_order.c+21−0");
    const commits = changes.getByRole("region", { name: "Commits" }).getByRole("listitem");
    await expect(commits).toHaveCount(2);
    await expect(commits.nth(0)).toContainText("a41c9e2");
    await expect(commits.nth(0)).toContainText(
      "can: replace telemetry k_fifo with k_msgq + frame seq",
    );
    await expect(commits.nth(1)).toContainText("7f03b8d");
    await expect(changes).toContainText("will squash on merge");

    // ---- Resources: both meters at the mockup's fills, forge-02 reserved.
    await expect(resources).toContainText("212k / 400k budget");
    await expect(resources).toContainText("$1.14 / $2.50 cap");
    await expect(resources).toContainText("forge-02 reserved");
    await expect(resources.locator(".run-resources__dot--idle")).toHaveCount(1);
    await expect(resources.locator(".ou-meter")).toHaveCount(2);

    // ---- Guardrails: the four marks, the computed pill, the disclosure, the footer.
    const rows = guardrails.getByRole("listitem");
    await expect(rows.locator(".run-guard__mark")).toHaveText(["✓", "✓", "✓", "○"]);
    await expect(rows.nth(3)).toContainText("Human review not required (auto-merge eligible)");
    await expect(guardrails.locator(".ou-card__head .ou-chip")).toHaveText("clean");
    await expect(guardrails.locator(".run-guard__info")).toHaveAttribute(
      "title",
      /not that the diff holds no secrets/,
    );
    await expect(guardrails).toContainText("Policy: standard-fix v14 · tenant acme-robotics");

    // The wall clock ticks with the head: masked.
    const mask = [
      resources.locator(".run-resources__row").last().locator(".run-resources__figure"),
    ];
    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(side).toHaveScreenshot(`run-right-column-${theme}.png`, { mask });
    }

    // ---- Narrow, in both palettes: the column drops under the transcript and nothing in it
    // pushes the pane sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expectNoPaneHorizontalScroll(page);
    }
  });
});
