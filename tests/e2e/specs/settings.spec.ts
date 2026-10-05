/**
 * Leg 26 — **the Settings MVP gate** ([#496](https://github.com/NobuData/ouroboros/issues/496),
 * BS.6, amending [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Mockup 17's hub against `R__dev_seed_workspace_settings.sql` (#484). Every card on that page
 * draws state some **other** plane owns, and `ouroboros-ui`'s suites draw each from a fixture — so
 * a green card says the layout is right and nothing about whether pressing it governs anything.
 * This leg is where that stops being a claim. The issue names nine legs; here they are, each
 * asserted on its **effect**, on the plane that owns it:
 *
 *   1. **Policy** — the protected-paths rule switched off on the card and published. A simulated
 *      loop is *already holding* on `boot/can_bringup.c` when that happens (the gate was red under
 *      the version before); a plain resume — **no allow-once** — makes the driver report the same
 *      change-set again, and it passes. The loop runs on to `completed` with zero guardrail
 *      exceptions granted, the audit log carries the publish, and the tag reads the next version.
 *   2. **Capability** — *Can approve loops* unticked for Maya, an admin. Her approver-class answer
 *      is refused `403 decision_action_forbidden` where a moment before it got as far as being
 *      asked for its note; ticked again, it does again.
 *   3. **Retention** — the card's select changed and saved. The tiers the service reads back, the
 *      rows beneath it (what the next sweep computes its cutoff from), the booked next sweep and
 *      the audit trail all carry the new figure. *The sweep itself is not waited for* — see below.
 *   4. **Webhook** — an endpoint created in the sheet, its secret read off the one-time dialog,
 *      **Test ping** pressed: the page says it succeeded, the delivery log holds the attempt, and
 *      **the fixture receiver holds the request**, signed with that secret.
 *   5. **Audit** — the log filtered on the card, and the same filter exported: the downloaded CSV
 *      is the filtered view row for row, and the export is itself the newest `audit.exported`.
 *   6. **Pause-all** — pressed while a simulated loop's stage is running. That stage **finishes**
 *      (`succeeded`, reported by the driver after the pause landed); the next is refused
 *      `409 workspace_paused` and a new loop cannot open; the banner is on the dashboard, for a
 *      member too; **Resume** on that banner clears it everywhere, and a fresh loop runs through.
 *   7. **Delete rehearsal** — on a workspace of the leg's own: the exact name typed, a step-up
 *      demanded of a session that is no longer fresh and answered with the password, the recovery
 *      screen with its countdown, every other surface frozen, a member told who can act — and
 *      **Restore**, after which the workspace is itself again.
 *   8. **The shell** — fixed chrome under a pane scroll, **Settings** lit, the 125% step.
 *   9. **Both themes** — the hub whole, the member's read-only hub, the paused banner and danger
 *      card, and the recovery screen, each diffed in both palettes.
 *
 * ## One file, in order, reads before writes
 *
 * The two parity pairs and the shell run first, against the hub as the suite left it. The five
 * tests that write to `acme-robotics` follow, each putting back what it changed in its own
 * `finally` and again, belt and braces, in `afterAll`. The delete rehearsal is last and touches
 * nothing but the workspace it made. The tests share no state but the owner's context — the
 * suite's one worker is what orders them — so one that fails does not hide the ones after it.
 *
 * ## What this leg changes in `acme-robotics`, and who reads it
 *
 * | Written | Put back | What stays, and who it reaches |
 * |---|---|---|
 * | org policy `vN+1` (rule off) | published again as `vN+2`, the document as found | two more versions and two `policy.published` events. The inbox leg (25) sorts **before** this one and needs `boot/**` protected, which it is again when this test ends; nothing after reads a version number |
 * | Maya's capability off | ticked again on the page | two `member.capability_changed` events |
 * | loop retention 30 → 14 days | `PATCH`ed back | audit events per class, both ways. No sweep runs inside the leg (they are hourly), so nothing is deleted |
 * | one webhook endpoint → the receiver | deleted | `webhook.created` / `webhook.deleted` events; the tile reads `2 active` again |
 * | the workspace paused | resumed from the banner | `workspace.paused` / `workspace.resumed` events |
 * | three simulated runs | — | one completed through the flipped gate, one stopped where the pause held it (a stage succeeded, the next never started), one completed after the resume. The runs and run-console legs (17, 18) sort before this one; the legs after it open no run list |
 * | the allow-once card the first loop filed | answered **Deny** once its loop has finished | one resolved row, and a correction round queued on a loop with no driver left to take it (it expires) |
 *
 * **Every one of those is an audit event today**, which is why the parity pair leaves the audit
 * card's rows out of the picture (`support/settings-hub.ts`'s `steadyHub` argues each region) and why the audit test
 * compares the view to the *service*, never to the mockup's five lines.
 *
 * **Re-runnable**, unlike the inbox leg: every version is read rather than assumed, every name
 * the leg writes is unique to the run, and each test restores its own writes — which is also what
 * lets `scripts/verify-settings.sh` run one test at a time, nine times, against one stack.
 *
 * ## What is not here, and where it is
 *
 * - **A retention sweep actually running with the new cutoff.** The three loop sweeps and the
 *   audit purge are hourly, their first tick a jittered hour after `rest` starts, and none has a
 *   trigger or a cadence setting. A leg cannot see one inside three minutes, or thirty. What it
 *   asserts instead is everything a sweep reads — the tier the service reports, the stored row
 *   `RetentionPolicyService.cutoffs()` computes `now − days` from, and that a sweep is booked —
 *   and the sweep's own arithmetic with a changed tier is `ouroboros-rest`'s
 *   (`transcript.retention`, `log.retention`, `audit-purge.sweeper` specs, each driving `sweep()`).
 * - **The purge.** Asserted in the BR.6 harness (#490), as the issue says.
 * - **The hub's loading skeleton and its read-failure banner.** Both are painted from *server*
 *   reads a browser cannot slow or fail against a healthy stack; they are `ouroboros-ui`'s
 *   (`settings-skeleton`, `read-banner`).
 * - **Disconnect.** It deletes the stored GitHub token and pauses every GitHub source, which no
 *   route puts back; its preview and its confirmation are `ouroboros-ui`'s and
 *   `lifecycle.integration-spec`'s. The pause dialog's in-flight count is read from the same
 *   preview, so that read *is* exercised here.
 * - **The inbox page as Maya.** The capability is asserted on the service's refusal of her
 *   answer; the page's inert approver buttons for a person without it are the inbox leg's member
 *   test (leg 25).
 *
 * ## The budget
 *
 * The issue allows three added minutes. Expected, on a warm stack: the three reads ≈ 25 s; policy
 * ≈ 30 s (a loop walked to its hold at 40×, a publish, the rest of the loop); capability ≈ 8 s;
 * retention ≈ 8 s; webhook ≈ 10 s; audit ≈ 10 s; pause ≈ 45 s (a 12-second stage to pause inside,
 * its end, two short drivers, four pictures); delete ≈ 25 s — about **2 m 40 s**.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import { ACTIONS, SEEDED_ITEMS, answerAs, inboxQueue, stageStatus } from "../support/inbox";
import { applyPlant } from "../support/plants";
import {
  DELIVERY_HEADERS,
  RECEIVER_ORIGIN,
  deliveriesTo,
  faultReceiver,
  resetReceiver,
  signatureOf,
} from "../support/receiver";
import { quietly } from "../support/rest";
import { SEED_ADMIN, SEED_MEMBER, SEED_OWNER, SEED_PASSWORD, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import {
  AUDIT,
  BANNER,
  DANGER,
  HUB,
  LOOP_CLASSES,
  MEMBERS,
  POLICY,
  READ_ONLY,
  RECOVERY,
  RECOVERY_PATH,
  type Refusal,
  SEATS,
  SETTINGS_PATH,
  WEBHOOKS,
  WORKSPACE,
  addMemberBeneath,
  ageSession,
  auditLog,
  broken,
  callAs,
  enterFixtureWorkspace,
  exceptionsGrantedTo,
  appendPolicyEventBeneath,
  forceActiveBeneath,
  grantCapabilityBeneath,
  steadyHub,
  keepProtectedBeneath,
  lifecycleOf,
  memberByEmail,
  openSettings,
  parseCsv,
  policyOf,
  removeWebhooks,
  restoreCapability,
  restoreIfPending,
  restoreLoopDays,
  restorePolicy,
  resumeIfPaused,
  resumeRun,
  retentionOf,
  runsInFlight,
  seat,
  stagesOf,
  stampOf,
  storeLoopDaysBeneath,
  storedTier,
  utcDay,
  webhooksOf,
} from "../support/settings-hub";
import {
  PANE_SELECTOR,
  chromeBoxes,
  expectNoPaneHorizontalScroll,
  expectNoViewportFixedElements,
} from "../support/shell";
import { type Simulation, startSimulation } from "../support/simulator";
import { THEMES, pinTheme, storeTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * The window the hub's parity pairs are taken through: all eight seats with room to spare,
 * asserted not to scroll — `specs/inbox.spec.ts`'s reason (the pane is the only scroll container,
 * so anything below the fold of a shorter window would be photographed as bare ground).
 */
const PARITY_WINDOW = { width: 1440, height: 3600 } as const;

/** The scenario whose loop stops on a protected path (`protected_path_allow_once.py`). */
const GATE_SCENARIO = "protected-path-allow-once";

/** Its speed: the ~275 scripted seconds to the hold in about seven real ones. */
const GATE_SPEED = 40;

/** The glob that stops it, under every published version of the seed's policy. */
const PROTECTED_GLOB = "boot/**";

/** The decision kind its stop files (`guardrails/protected-path.emitter.ts`). */
const ALLOW_ONCE_KIND = "protected_path_allow_once";

/** The scenario the pause is pressed against, and that proves flow afterwards. */
const FLOW_SCENARIO = "happy-path";

/** Its speed under the pause: `analyze`'s 72 scripted seconds are twelve real ones to press in. */
const PAUSE_SPEED = 6;

/** Its speed once nothing has to be pressed mid-stage: the whole script in a few seconds. */
const FAST_SPEED = 60;

/** The stage the pause is pressed during, and the one the driver asks to start next. */
const RUNNING_STAGE = "analyze";
const NEXT_STAGE = "effort-recheck";

/** How long a driver is given to reach a named point — spawn, open, and the walk there. */
const DRIVER_TIMEOUT_MS = 60_000;

/** The tier the retention test saves, and the one it saves when that is already in force. */
const NEW_LOOP_DAYS = 14;
const OTHER_LOOP_DAYS = 60;

/** What every webhook endpoint the leg makes is named with — and deleted by. */
const WEBHOOK_MARK = "e2e-settings-";

/** How far back the audit test's filter reaches: inside the export's default window. */
const AUDIT_DAYS = 29;

/** The CSV's columns, in order — `GET /settings/audit/export.csv`'s append-only contract. */
const CSV_COLUMNS = [
  "occurred_at",
  "actor_kind",
  "actor",
  "actor_id",
  "actor_service",
  "event",
  "action",
  "plane",
  "subject_type",
  "subject_id",
  "ip",
  "detail",
  "id",
] as const;

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ shared state */

/** The owner's context, for every read and write beneath the browser. */
let owner: BrowserContext;

/** Every driver the leg started, stopped in `afterAll` whatever happened. */
const simulations: Simulation[] = [];

/* ------------------------------------------------------------------ helpers */

/**
 * Wait for a promise, but not for ever — a driver's exit, which a stuck hold would never give.
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
        timer = setTimeout(
          () => reject(new Error(`${what} — not within ${String(ms / 1000)}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start a driver and remember it, so nothing outlives the leg.
 *
 * @param scenario - The scenario.
 * @param speed - Its speed.
 * @returns The simulation.
 */
async function simulate(scenario: string, speed: number): Promise<Simulation> {
  const simulation = await startSimulation(scenario, speed);

  simulations.push(simulation);
  return simulation;
}

/**
 * The head's **Save changes**, whatever it is counting.
 *
 * @param page - The page, on the hub.
 * @returns The button in the page head — the dirty bar draws a second.
 */
function saveButton(page: Page): Locator {
  return page.locator(".settings__actions").getByRole("button", { name: /^Save changes/ });
}

/**
 * The shell's paused banner.
 *
 * ASSUMED(#496-ui): a `<section aria-label="All loops paused">` in the shell — a named region.
 *
 * @param page - Any page inside the shell.
 * @returns The banner's region.
 */
function pausedBanner(page: Page): Locator {
  return page.getByRole("region", { name: BANNER.label });
}

/**
 * The controls a page offers that would change the workspace: every button outside the
 * Appearance seat (whose controls are the reader's own preferences) that is not a read, and
 * every switch that can be pressed.
 *
 * Two things a read-only reader *is* drawn are left out, because neither changes anything: the
 * policy version tag, which opens the history, and a switch shown in its real position with the
 * reason it cannot be moved (`aria-disabled`) — the Autonomy policies card's rules.
 *
 * @param page - The page, on the hub.
 * @returns Their seats and labels.
 */
async function workspaceControls(page: Page): Promise<string[]> {
  const labels: string[] = [];

  for (const id of SEATS) {
    if (id === "appearance") continue;

    for (const control of await seat(page, id).getByRole("button").all()) {
      const name =
        (await control.getAttribute("aria-label")) ?? (await control.textContent()) ?? "";

      if (!/open the policy history$/.test(name)) labels.push(`${id}: ${name}`);
    }
    for (const control of await seat(page, id)
      .locator("[role='switch']:not([aria-disabled='true'])")
      .all()) {
      labels.push(`${id}: switch ${(await control.textContent()) ?? ""}`);
    }
  }

  return labels;
}

test.describe("the settings hub", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    await signIn(owner, SEED_OWNER.id);
    await selectWorkspace(owner, SEED_TENANT.slug);
  });

  test.afterAll(async () => {
    for (const simulation of simulations) simulation.stop();

    // Each test restores its own writes; these catch one that died between a write and its
    // `finally`. The pause first — a workspace left paused fails every later leg's driver.
    await resumeIfPaused(owner);
    await removeWebhooks(owner, WEBHOOK_MARK);
    await restoreFontScale(owner);
    await owner.close();
  });

  /* ---------------------------------------------------------------- 9 · both themes */

  test("parity: mockup 17's hub, whole, in both palettes", async ({ context, page }) => {
    await applyPlant(page);
    await page.setViewportSize(PARITY_WINDOW);
    await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

    // ---- The page the pair is of: eight seats in the mockup's rows, each holding its card.
    await expect(page.locator(".settings__grid > .settings__seat")).toHaveCount(SEATS.length);
    expect(
      await page
        .locator(".settings__grid > .settings__seat")
        .evaluateAll((seats) => seats.map((one) => one.id)),
    ).toEqual([...SEATS]);
    await expect(page.getByText(HUB.subline)).toBeVisible();
    await expect(saveButton(page)).toBeVisible();

    // Each of the three record surfaces and the danger zone is its card, not its placeholder.
    await expect(seat(page, "audit").getByText("retained 400d")).toBeVisible();
    await expect(
      seat(page, "audit").getByRole("button", { name: AUDIT.exportButton }),
    ).toBeVisible();
    await expect(
      seat(page, "integrations").getByText("not built yet", { exact: true }),
    ).toBeVisible();
    await expect(seat(page, "notifications")).toContainText("connect PagerDuty first");
    await expect(seat(page, "danger")).toContainText(DANGER.pauseWhy);
    await expect(seat(page, "danger").getByRole("switch", { name: DANGER.pause })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(pausedBanner(page), "the workspace must be running for this pair").toHaveCount(0);
    await expect(
      seat(page, "danger").locator(".ou-empty__note"),
      "the last seat is its card, not its placeholder",
    ).toHaveCount(0);

    const pane = page.locator(PANE_SELECTOR);
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      `the hub must fit ${String(PARITY_WINDOW.height)}px whole, or the pair photographs bare ground`,
    ).toBe(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await steadyHub(page);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`settings-${theme}.png`);
    }
  });

  test("a member: the same page, legible and read-only, in both palettes", async ({
    context,
    page,
  }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await openSettings(context, page, SEED_MEMBER.id, SEED_TENANT.slug);

    // ---- Told once whose page this is to change, and offered nothing that would change it.
    const note = page.locator(".settings__readonly");

    await expect(note).toHaveText(`${READ_ONLY.head(SEED_MEMBER.role)} ${READ_ONLY.body}`);
    await expect(page.getByRole("button", { name: /^Save changes/ })).toHaveCount(0);
    expect(
      await workspaceControls(page),
      "a member is drawn no control that would change the workspace — the policy history, " +
        "which only reads, is the one button outside Appearance",
    ).toEqual([]);

    // ---- Every section is still there to be read — and says why where it cannot be.
    await expect(page.locator(".settings__grid > .settings__seat")).toHaveCount(SEATS.length);
    await expect(seat(page, "audit").getByRole("note")).toHaveText(READ_ONLY.audit);
    await expect(
      seat(page, "integrations").getByText("not built yet", { exact: true }),
    ).toBeVisible();
    await expect(seat(page, "notifications")).toContainText("connect PagerDuty first");
    await expect(seat(page, "danger")).toContainText(DANGER.pauseRole);
    await expect(seat(page, "danger")).toContainText(DANGER.ownerOnly);

    // ---- The service decided that, not the page: the writes are refused when made past it.
    const pause = await callAs<Refusal>(context, "POST", "/api/v1/settings/lifecycle/pause", {
      confirm: true,
    });

    expect(pause.status, "a member's pause must be refused by the service").toBe(403);
    expect((await lifecycleOf(owner)).state).toBe("active");

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await steadyHub(page);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`settings-member-${theme}.png`);
    }
  });

  /* ---------------------------------------------------------------- 8 · the shell */

  test("shell: fixed chrome under a pane scroll, Settings lit, and the 125% step", async ({
    context,
    page,
  }) => {
    await applyPlant(page);
    await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

    // ---- Where the reader is: one entry claims it, and it is this one.
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    // ---- The chrome holds still while the pane scrolls under it.
    const pane = page.locator(PANE_SELECTOR);
    const before = await chromeBoxes(page);

    expect(before.header, "the header must be on the page to be measured").not.toBeNull();
    expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the hub must overflow its pane at the suite's window for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await chromeBoxes(page)).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expectNoViewportFixedElements(page);
    await expectNoPaneHorizontalScroll(page);

    // ---- A fifth more type: nothing pushes the pane sideways, and the page is still the hub.
    try {
      await setFontScale(context, "125");
      await page.reload();
      await expectFontScale(page, "125");
      await expectNoPaneHorizontalScroll(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(HUB.title);
      await expect(page.locator(".settings__grid > .settings__seat")).toHaveCount(SEATS.length);
      await expect(seat(page, "danger").getByRole("switch", { name: DANGER.pause })).toBeVisible();
    } finally {
      await restoreFontScale(context);
    }
  });

  /* ---------------------------------------------------------------- 1 · policy */

  test("policy: a rule published off flips the gate a loop is held at", async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);

    const found = await policyOf(owner);
    const rule = found.document?.protected_paths;

    expect(
      found.version,
      "a precondition: the workspace has a published policy (the #484 seed's v7, or later)",
    ).not.toBeNull();
    expect(
      rule?.enabled === true && JSON.stringify(rule.conditions).includes(PROTECTED_GLOB),
      `a precondition: the policy in force protects ${PROTECTED_GLOB} — an earlier run of this ` +
        "test must have put the document back",
    ).toBe(true);

    const base = found.version ?? 0;
    let unbreak: (() => Promise<void>) | undefined;
    let stopItemId: string | undefined;
    let simulation: Simulation | undefined;

    try {
      // ---- Red, under the version in force: the loop edits boot/ and the gate stops it.
      simulation = await simulate(GATE_SCENARIO, GATE_SPEED);
      const { runId } = simulation;

      await expect
        .poll(
          async () => {
            const stop = (await inboxQueue(owner)).items.find(
              (item) =>
                item.kindId === ALLOW_ONCE_KIND &&
                item.refs.some((ref) => ref.type === "run" && ref.id === runId),
            );

            stopItemId = stop?.id;
            return stop !== undefined;
          },
          {
            message: `under policy v${String(base)} the loop's edit to ${PROTECTED_GLOB} must stop it and file an allow-once card`,
            timeout: DRIVER_TIMEOUT_MS,
          },
        )
        .toBe(true);
      expect(await stageStatus(owner, runId, "implement")).toBe("active");

      // ---- The card: the rule off, saved, confirmed as the loosening it is, published.
      await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

      const policies = seat(page, "policies");

      await expect(policies.getByRole("button", { name: POLICY.tag(base) })).toBeVisible();
      await policies
        .getByRole("switch", { name: POLICY.switchName(POLICY.protectedPaths, true) })
        .click();
      await expect(saveButton(page)).toHaveText(`${HUB.save} (1)`);
      await saveButton(page).click();

      const confirm = POLICY.confirm(base + 1);
      const dialog = page.getByRole("alertdialog", { name: confirm.title });

      await expect(dialog, "the confirmation names the change for what it is").toContainText(
        "Loosens",
      );
      await expect(dialog).toContainText(POLICY.protectedPaths);
      await dialog.getByRole("button", { name: confirm.publish }).click();

      // ---- The version tag increments, on the page and in the service.
      await expect(policies.getByText(POLICY.published(base + 1))).toBeVisible();
      await expect(policies.getByRole("button", { name: POLICY.tag(base + 1) })).toBeVisible();

      const published = await policyOf(owner);

      expect(published.version, "the publish must make exactly the next version").toBe(base + 1);
      expect(published.document?.protected_paths.enabled).toBe(false);

      if (broken("policy-gate")) {
        unbreak = await keepProtectedBeneath(SEED_TENANT.slug, PROTECTED_GLOB);
      }

      // ---- Green, against the driver: the same change-set, reported again, with no grant.
      await resumeRun(owner, runId);

      const ended = await within(
        simulation.finished,
        DRIVER_TIMEOUT_MS,
        "the gate must flip: the held loop was resumed under the new policy and never finished",
      );

      expect(
        ended.output,
        `the gate must flip: with ${POLICY.protectedPaths} published off, the loop's second ` +
          `report of the same change-set passes and it runs on to completed`,
      ).toContain(`${GATE_SCENARIO}: completed`);
      expect(await stageStatus(owner, runId, "implement")).toBe("succeeded");
      expect(
        await exceptionsGrantedTo(runId),
        "the loop passed because the policy changed, not because anyone allowed the edit once",
      ).toBe(0);

      // ---- The audit row: the newest policy event is this publish, by its publisher.
      const [newest] = await auditLog(owner, { action: "policy.published" });

      expect(Number(newest.detail.version), "the audit log's newest publish is this one").toBe(
        base + 1,
      );
      expect(newest.event).toContain(`(policy v${String(base + 1)})`);

      await page.reload();

      const audit = seat(page, "audit");

      await audit.getByRole("button", { name: AUDIT.filters }).click();
      await audit.getByLabel(AUDIT.plane).fill("policy.published");
      await audit.getByRole("button", { name: AUDIT.apply }).click();
      await expect(audit.locator(".audit-log__row").first()).toContainText(newest.event);
      await expect(audit.locator(".audit-log__row").first()).toContainText(
        stampOf(newest.occurredAt),
      );
    } finally {
      simulation?.stop();
      if (unbreak !== undefined)
        await quietly(unbreak, "the planted repository globs were not removed.");

      // The document as it was found — which protects boot/** again for every later leg.
      await restorePolicy(owner, found.document);

      // The card the stop filed. Its loop has finished, so nothing will answer it; denied, the
      // card stops asking in Needs You.
      if (stopItemId !== undefined) {
        const itemId = stopItemId;

        await quietly(async () => {
          const denied = await answerAs(owner, itemId, ACTIONS.deny.id, randomUUID());

          if (denied.status !== 200) {
            throw new Error(`answered ${String(denied.status)}: ${JSON.stringify(denied.body)}`);
          }
        }, "the allow-once card the policy test's loop filed was not answered; Needs You counts one more.");
      }
    }

    expect(
      (await inboxQueue(owner)).items.map((item) => item.id),
      "the card the loop's stop filed is not left asking in Needs You",
    ).not.toContain(stopItemId);
    expect((await policyOf(owner)).document?.protected_paths.enabled).toBe(true);
  });

  /* ---------------------------------------------------------------- 2 · capability */

  test("capability: unticking Can approve loops refuses that member's approval", async ({
    browser,
    context,
    page,
  }) => {
    const maya = await browser.newContext();
    const member = await memberByEmail(owner, SEED_ADMIN.email);

    /**
     * Maya's approver-class answer, pressed past the page: *Waive & annotate* on the seed's
     * claim-waiver card, **without its note**. The service checks who may press before it checks
     * the note, and the note before it claims the item — so a person who holds the capability is
     * refused `422 decision_note_required`, a person who does not `403
     * decision_action_forbidden`, and neither changes a row. That makes it a question the leg
     * can ask as often as it likes, on a card whether it is still asking or long settled.
     */
    const press = () => answerAs(maya, SEEDED_ITEMS.sweptWaiver, ACTIONS.waive.id, randomUUID());

    try {
      await signIn(maya, SEED_ADMIN.id);
      await selectWorkspace(maya, SEED_TENANT.slug);

      expect(member.canApproveLoops, "a precondition: Maya holds the capability").toBe(true);

      const allowed = await press();

      expect(
        [allowed.status, allowed.body.code],
        "while she holds it, her answer gets as far as being asked for its note",
      ).toEqual([422, "decision_note_required"]);

      // ---- The box, unticked by an owner. It moves at once and says what it did.
      await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

      const members = seat(page, "members");
      const box = members.getByRole("checkbox", {
        name: MEMBERS.capability(SEED_ADMIN.displayName),
      });

      await expect(box).toBeChecked();
      await box.click();
      await expect(box).not.toBeChecked();
      await expect(members.locator(".members__toast")).toHaveText(
        MEMBERS.changed(SEED_ADMIN.displayName, false),
      );

      if (broken("capability")) await grantCapabilityBeneath(SEED_TENANT.slug, SEED_ADMIN.email);

      // ---- Its effect: the same press, by the same person, is now refused for who she is.
      const refused = await press();

      expect(
        [refused.status, refused.body.code],
        `with the box unticked, ${SEED_ADMIN.displayName}'s approval must be refused — the ` +
          "capability is a control, not a column",
      ).toEqual([403, "decision_action_forbidden"]);
      expect((await memberByEmail(owner, SEED_ADMIN.email)).canApproveLoops).toBe(false);

      // ---- And back: ticked again, the service asks for the note again.
      await box.click();
      await expect(box).toBeChecked();
      await expect(members.locator(".members__toast")).toHaveText(
        MEMBERS.changed(SEED_ADMIN.displayName, true),
      );

      const again = await press();

      expect([again.status, again.body.code]).toEqual([422, "decision_note_required"]);
    } finally {
      await restoreCapability(owner, member.id, true);
      await maya.close();
    }
  });

  /* ---------------------------------------------------------------- 3 · retention */

  test("retention: the tier the card saves is the tier the next sweep reads", async ({
    context,
    page,
  }) => {
    const found = await retentionOf(owner);

    expect(
      found.loopDays,
      "a precondition: the three loop classes share one tier, as the seed wrote them",
    ).not.toBeNull();

    const before = found.loopDays ?? 30;
    const target = before === NEW_LOOP_DAYS ? OTHER_LOOP_DAYS : NEW_LOOP_DAYS;
    const started = new Date(Date.now() - 1000).toISOString();

    try {
      await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

      const workspace = seat(page, "workspace");
      const select = workspace.getByLabel(WORKSPACE.retention);

      await expect(select).toHaveValue(String(before));
      await select.selectOption(String(target));
      await expect(saveButton(page)).toHaveText(/^Save changes \(\d+\)$/);
      await saveButton(page).click();

      // Saved: the count is gone from the button, and the select holds what the service stored.
      await expect(saveButton(page)).toHaveText(HUB.save);
      await expect(select).toHaveValue(String(target));

      if (broken("retention")) await storeLoopDaysBeneath(SEED_TENANT.slug, before);

      // ---- What the service reads back: every loop class at the new tier, a sweep booked.
      const now = await retentionOf(owner);

      expect(now.loopDays, "the tier the next sweep reads is the one the card saved").toBe(target);

      for (const dataClass of LOOP_CLASSES) {
        const tier = now.classes.find((one) => one.dataClass === dataClass);

        expect(tier?.days, `${dataClass}: the tier the next sweep reads`).toBe(target);
        expect(tier?.source, `${dataClass} is a stored tier, not the default`).toBe("policy");

        // ---- And beneath it: the row `cutoffs()` computes `now − days` from.
        expect(
          await storedTier(SEED_TENANT.slug, dataClass),
          `${dataClass}: the stored row is the tier the next sweep reads`,
        ).toBe(target);
      }

      // The transcript sweep is this process's own, booked from the moment `rest` started: the
      // new cutoff has a sweep to reach, and it is ahead of now rather than behind it.
      const transcripts = now.classes.find((one) => one.dataClass === "transcripts");

      expect(
        transcripts?.nextSweepAt,
        "the transcripts sweep must be booked, or a saved tier has nothing to reach",
      ).not.toBeNull();
      expect(Date.parse(transcripts?.nextSweepAt ?? "")).toBeGreaterThan(Date.now());

      // The audit tier is a different select and did not move.
      expect(now.classes.find((one) => one.dataClass === "audit")?.days).toBe(
        found.classes.find((one) => one.dataClass === "audit")?.days,
      );

      // ---- Attributed: one event per class that changed, since this test began.
      const changes = await auditLog(owner, {
        action: "workspace.retention_changed",
        from: started,
      });

      expect(
        changes.length,
        "each changed class is recorded in the audit log",
      ).toBeGreaterThanOrEqual(LOOP_CLASSES.length);
    } finally {
      await restoreLoopDays(owner, before);
    }

    expect((await retentionOf(owner)).loopDays).toBe(before);
  });

  /* ---------------------------------------------------------------- 4 · webhook */

  test("webhook: an endpoint made in the sheet is pinged, and the receiver holds the request", async ({
    context,
    page,
  }) => {
    // First, and by name: with the fixture stopped the test ends here, before any write.
    await resetReceiver();

    const nonce = randomUUID().slice(0, 8);
    const name = `${WEBHOOK_MARK}${nonce}`;
    const path = `/hooks/${nonce}`;
    const activeBefore = (await webhooksOf(owner)).activeCount;

    try {
      await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

      // ---- The tile opens the sheet; nothing about webhooks is configured on the hub itself.
      await seat(page, "integrations").getByRole("button", { name: WEBHOOKS.manage }).click();

      const sheet = page.getByRole("dialog", { name: WEBHOOKS.sheet });

      await sheet.getByRole("button", { name: WEBHOOKS.add }).click();
      await sheet.getByLabel(WEBHOOKS.name, { exact: true }).fill(name);
      await sheet.getByLabel(WEBHOOKS.url, { exact: true }).fill(`${RECEIVER_ORIGIN}${path}`);
      await sheet.getByRole("checkbox", { name: "run.*" }).check();
      await sheet.getByRole("button", { name: WEBHOOKS.create }).click();

      // ---- The secret, once. Read here; nowhere after.
      const once = page.getByRole("alertdialog", { name: WEBHOOKS.secretTitle });
      const secret = ((await once.locator(".webhooks-secret__value").textContent()) ?? "").trim();

      expect(secret.length, "the one-time dialog must show the signing secret").toBeGreaterThan(16);
      await once.getByRole("button", { name: WEBHOOKS.secretDone }).click();
      await expect(once).toHaveCount(0);

      const row = sheet.locator(".webhooks-endpoint").filter({ hasText: name });

      await expect(row).toBeVisible();
      await expect(sheet, "the secret is shown once and then never again").not.toContainText(
        secret,
      );
      expect((await webhooksOf(owner)).activeCount).toBe(activeBefore + 1);

      if (broken("webhook")) await faultReceiver(503);

      // ---- Test ping: the result is a sentence on the page…
      await row.getByRole("button", { name: WEBHOOKS.action(WEBHOOKS.ping, name) }).click();
      await expect(
        row.locator(".webhooks-endpoint__ping"),
        "the ping's result is drawn under its endpoint: Ping succeeded",
      ).toHaveText(/^Ping succeeded · HTTP 200/);

      // ---- …a request at the receiving end, signed with the secret only that dialog showed…
      await expect
        .poll(async () => (await deliveriesTo(path)).length, {
          message: "the fixture receiver must hold the ping the page says it sent",
        })
        .toBe(1);

      const [received] = await deliveriesTo(path);
      const timestamp = received.headers[DELIVERY_HEADERS.timestamp] ?? "";

      expect(received.headers[DELIVERY_HEADERS.event]).toBe("ping");
      expect(
        received.headers[DELIVERY_HEADERS.signature],
        "the delivery is signed with the endpoint's secret over <timestamp>.<body>",
      ).toBe(signatureOf(secret, timestamp, received.body));

      // ---- …and a row in the delivery log that is that same attempt.
      const endpoint = (await webhooksOf(owner)).items.find((one) => one.name === name);
      const log = await callAs<{
        items: readonly {
          eventType: string;
          status: string;
          responseCode: number | null;
          deliveryKey: string;
        }[];
      }>(owner, "GET", `/api/v1/settings/webhooks/${endpoint?.id ?? ""}/deliveries`);

      expect(log.status).toBe(200);
      expect(log.body.items).toHaveLength(1);
      expect(log.body.items[0]).toMatchObject({
        eventType: "ping",
        status: "succeeded",
        responseCode: 200,
        deliveryKey: received.headers[DELIVERY_HEADERS.delivery],
      });

      await row.getByRole("button", { name: WEBHOOKS.action(WEBHOOKS.deliveries, name) }).click();

      const attempt = row.getByRole("row").filter({ hasText: "ping" });

      await expect(attempt).toHaveCount(1);
      await expect(attempt).toContainText("succeeded");
      await expect(attempt).toContainText("200");
    } finally {
      await removeWebhooks(owner, WEBHOOK_MARK);
      await quietly(resetReceiver, "the webhook receiver's fault was not cleared.");
    }

    expect((await webhooksOf(owner)).activeCount).toBe(activeBefore);
  });

  /* ---------------------------------------------------------------- 5 · audit */

  test("audit: the exported CSV is the filtered view, row for row", async ({ context, page }) => {
    const today = utcDay();
    const from = utcDay(new Date(Date.now() - AUDIT_DAYS * DAY_MS));
    const range = {
      from: `${from}T00:00:00.000Z`,
      to: new Date(Date.parse(`${today}T00:00:00.000Z`) + DAY_MS).toISOString(),
    };
    const started = new Date(Date.now() - 1000).toISOString();

    // What the service holds for the filter the card is about to apply.
    const expected = await auditLog(owner, { action: "policy.*", ...range });

    expect(
      expected.length,
      "a precondition: the policy plane has events in the range — the seed's v7 publish at least",
    ).toBeGreaterThan(0);

    await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

    const audit = seat(page, "audit");

    // ---- The filters: a range and a plane, applied.
    await audit.getByRole("button", { name: AUDIT.filters }).click();

    const form = audit.getByRole("form", { name: AUDIT.form });

    await form.getByLabel(AUDIT.from).fill(from);
    await form.getByLabel(AUDIT.to).fill(today);
    await form.getByLabel(AUDIT.plane).fill("policy");
    await form.getByRole("button", { name: AUDIT.apply }).click();

    // Every page of it — the list ends by saying so, never by stopping.
    const more = audit.getByRole("button", { name: "Load more" });
    const end = audit.locator(".audit-log__end");

    await expect(end.or(more)).toBeVisible();
    while (await more.isVisible()) {
      await more.click();
      await expect(end.or(more)).toBeVisible();
    }
    await expect(end).toHaveText(AUDIT.end(expected.length));

    const shown = await audit
      .locator(".audit-log__row")
      .evaluateAll((rows) =>
        rows.map((row) => [
          row.querySelector(".audit-log__time")?.textContent ?? "",
          row.querySelector(".audit-log__event")?.textContent ?? "",
        ]),
      );

    expect(shown, "the card's filtered view is the service's, newest first").toEqual(
      expected.map((event) => [stampOf(event.occurredAt), event.event]),
    );

    // ---- The export: the same filter, a bounded range, said to be recorded.
    await audit.getByRole("button", { name: AUDIT.exportButton }).click();

    const dialog = page.getByRole("dialog", { name: AUDIT.exportTitle });

    await expect(dialog).toContainText(AUDIT.logged);
    await expect(dialog.getByLabel(AUDIT.from)).toHaveValue(from);
    await expect(dialog.getByLabel(AUDIT.to)).toHaveValue(today);
    await expect(dialog).toContainText("policy");

    if (broken("audit-export")) {
      // The export's rows stop being the view's: the log gains an event the view never showed.
      await appendPolicyEventBeneath(SEED_TENANT.slug);
    }

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("link", { name: AUDIT.download }).click(),
    ]);
    const file = await download.path();
    const [header, ...records] = parseCsv(await readFile(file, "utf8"));

    expect(header, "the export's columns, in their contract's order").toEqual([...CSV_COLUMNS]);

    const column = (name: (typeof CSV_COLUMNS)[number]): number => CSV_COLUMNS.indexOf(name);

    expect(
      records.map((record) => [
        record[column("id")],
        stampOf(record[column("occurred_at")]),
        record[column("actor")],
        record[column("event")],
        record[column("action")],
      ]),
      "the downloaded file matches the filtered view, row for row, newest first",
    ).toEqual(
      expected.map((event) => [
        event.id,
        stampOf(event.occurredAt),
        event.actor,
        event.event,
        event.action,
      ]),
    );

    // ---- And the export is itself in the log, with the count it carried.
    const [exported] = await auditLog(owner, { action: "audit.exported", from: started });

    expect(exported, "exporting is itself audited").toBeDefined();
    expect(Number(exported.detail.rows)).toBe(expected.length);
  });

  /* ---------------------------------------------------------------- 6 · pause-all */

  test("pause: a running stage finishes, the next holds, the banner is everywhere, resume restores flow", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(180_000);

    expect(
      (await lifecycleOf(owner)).state,
      "a precondition: the workspace is running — an earlier run of this test must have resumed it",
    ).toBe("active");

    const member = await browser.newContext();

    try {
      // ---- A loop, mid-stage.
      const simulation = await simulate(FLOW_SCENARIO, PAUSE_SPEED);
      const { runId } = simulation;

      await expect
        .poll(() => stageStatus(owner, runId, RUNNING_STAGE), {
          message: `the simulated loop must reach ${RUNNING_STAGE} to be paused in it`,
          timeout: DRIVER_TIMEOUT_MS,
        })
        .toBe("active");

      // ---- The switch, and the confirmation that says what will happen to *this* workspace.
      await openSettings(context, page, SEED_OWNER.id, SEED_TENANT.slug);

      const danger = seat(page, "danger");
      const inFlight = await runsInFlight(owner);

      expect(inFlight, "the loop just started is in flight").toBeGreaterThan(0);
      // ASSUMED(#496-ui): the pause row is a `role="switch"` named *Pause all loops* (*Resume all
      // loops* once paused); pressing it opens an alertdialog that prints the in-flight sentence
      // and whose confirming button carries the switch's name.
      await danger.getByRole("switch", { name: DANGER.pause }).click();

      const dialog = page.getByRole("alertdialog", { name: DANGER.pauseDialog });

      await expect(dialog).toContainText(DANGER.pauseWhy);
      await expect(
        dialog,
        "the confirmation states how many runs are in flight, from live state",
      ).toContainText(DANGER.inFlight(inFlight));
      await dialog.getByRole("button", { name: DANGER.pause }).click();

      // ---- Paused: on this page, in the shell, and in the service.
      const banner = pausedBanner(page);

      await expect(banner).toContainText(BANNER.headline);
      await expect(danger.getByRole("switch", { name: DANGER.resume })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect((await lifecycleOf(owner)).state).toBe("paused");

      const atPause = await stagesOf(owner, runId);

      expect(
        atPause.find((stage) => stage.stageKey === RUNNING_STAGE)?.status,
        `${RUNNING_STAGE} must still be running when the pause lands, or nothing is shown to finish`,
      ).toBe("active");

      if (broken("pause")) await forceActiveBeneath(SEED_TENANT.slug);

      // ---- The running stage FINISHES, and the next must hold.
      const ended = await within(
        simulation.finished,
        DRIVER_TIMEOUT_MS,
        `the next stage must hold: the driver neither finished ${RUNNING_STAGE} nor was refused ${NEXT_STAGE}`,
      );
      const afterPause = await stagesOf(owner, runId);
      const statusOf = (key: string): string | undefined =>
        afterPause.find((stage) => stage.stageKey === key)?.status;

      expect(
        statusOf(RUNNING_STAGE),
        `the stage that was running when the pause landed completed — it was not killed`,
      ).toBe("succeeded");
      expect(
        ended.output,
        `the next stage must hold: ${NEXT_STAGE} is refused while the workspace is paused`,
      ).toContain("workspace_paused");
      expect(ended.output).toContain(`${FLOW_SCENARIO}: failed`);
      expect(
        ["pending", undefined],
        `the next stage must hold: ${NEXT_STAGE} never started`,
      ).toContain(statusOf(NEXT_STAGE));
      expect(afterPause.filter((stage) => stage.status === "active")).toEqual([]);

      // ---- And nothing new starts: a loop cannot open at all.
      await expect(
        startSimulation(FLOW_SCENARIO, FAST_SPEED),
        "a new loop must not open while the workspace is paused",
      ).rejects.toThrow(/workspace_paused/);

      // ---- The paused state, photographed: the banner and the danger zone, both palettes.
      for (const theme of THEMES) {
        await pinTheme(page, theme);
        await page.mouse.move(0, 0);
        await expect(banner).toHaveScreenshot(`settings-paused-banner-${theme}.png`);
        await expect(danger).toHaveScreenshot(`settings-paused-danger-${theme}.png`, {
          // *Paused since …* carries the instant.
          // ASSUMED(#496-ui): `.danger-zone__state` is the pause row's state line.
          mask: [danger.locator(".danger-zone__state")],
        });
      }

      // ---- App-wide: a different page, and a different person.
      await page.goto("/dashboard");
      await expect(pausedBanner(page)).toContainText(BANNER.headline);

      await signIn(member, SEED_MEMBER.id);
      await selectWorkspace(member, SEED_TENANT.slug);

      const memberPage = await member.newPage();

      await memberPage.goto("/dashboard");
      await expect(pausedBanner(memberPage)).toContainText(BANNER.headline);
      await expect(
        pausedBanner(memberPage).getByRole("button", { name: BANNER.resume }),
      ).toHaveCount(0);
      await expect(
        pausedBanner(memberPage).getByRole("link", { name: BANNER.whoCanResume }),
      ).toBeVisible();

      // ---- Resume, from the banner, on the dashboard: cleared there, here, and for everyone.
      await pausedBanner(page).getByRole("button", { name: BANNER.resume }).click();
      await expect(pausedBanner(page)).toHaveCount(0);
      expect((await lifecycleOf(owner)).state).toBe("active");

      await memberPage.reload();
      await expect(memberPage.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(pausedBanner(memberPage)).toHaveCount(0);

      await page.goto(SETTINGS_PATH);
      await expect(pausedBanner(page)).toHaveCount(0);
      await expect(
        seat(page, "danger").getByRole("switch", { name: DANGER.pause }),
      ).toHaveAttribute("aria-checked", "false");

      // ---- Flow restored: a fresh loop opens and walks every stage.
      const again = await simulate(FLOW_SCENARIO, FAST_SPEED);
      const flowed = await within(
        again.finished,
        DRIVER_TIMEOUT_MS,
        "after the resume a fresh loop must run through",
      );

      expect(flowed.output, "resume restores flow").toContain(`${FLOW_SCENARIO}: completed`);
    } finally {
      await resumeIfPaused(owner);
      await member.close();
    }
  });

  /* ---------------------------------------------------------------- 7 · delete rehearsal */

  test("delete: typed name and step-up, the recovery screen, and a restore", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(150_000);

    const fixture = await enterFixtureWorkspace(context, "delete");
    const member = await browser.newContext();

    try {
      await addMemberBeneath(fixture.slug, SEED_MEMBER.email);

      // A session that has simply been open a while — see `ageSession`.
      if (!broken("step-up")) await ageSession(context);

      // ---- The step-up is the service's: the right name alone is not enough.
      const bare = await callAs<Refusal>(context, "POST", "/api/v1/settings/lifecycle/delete", {
        confirmName: fixture.name,
      });

      expect(
        [bare.status, bare.body.code],
        "a delete from a session older than five minutes must demand a step-up",
      ).toEqual([401, "step_up_required"]);
      expect((await lifecycleOf(context)).state).toBe("active");

      // ---- The dialog: consequences, the exact name, then the password it asks for.
      await page.goto(`${SETTINGS_PATH}#danger`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(HUB.title);
      await seat(page, "danger")
        .getByRole("button", { name: DANGER.deleteButton(fixture.name) })
        .click();

      const labels = DANGER.deleteDialog(fixture.name);
      const dialog = page.getByRole("alertdialog", { name: labels.title });
      const confirm = dialog.getByRole("button", { name: DANGER.deleteConfirm });

      await expect(dialog).toContainText("30 days");
      await expect(confirm, "inert until the name is typed").toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await dialog.getByLabel(labels.typeName).fill(fixture.name.toLowerCase());
      await expect(confirm, "a near miss is not the name").toHaveAttribute("aria-disabled", "true");
      await dialog.getByLabel(labels.typeName).fill(fixture.name);
      await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
      await confirm.click();

      // ASSUMED(#496-ui): the password field appears only once the service has answered the
      // first submit `step_up_required`, and the same button sends again with it.
      const password = dialog.getByLabel(DANGER.password);

      await expect(password, "the dialog asks for the step-up the service demanded").toBeVisible();
      expect((await lifecycleOf(context)).state, "nothing is deleted before the step-up").toBe(
        "active",
      );
      await password.fill(SEED_PASSWORD);
      await confirm.click();

      // ---- Pending deletion: the recovery screen, its countdown, and a way back.
      // ASSUMED(#496-ui): a landed delete replaces the route with the recovery screen; the
      // countdown is `role="timer"`; a restore leaves for `/dashboard`; a frozen page's read
      // (`403 workspace_pending_delete`) is redirected to the recovery screen for any member.
      await page.waitForURL(`**${RECOVERY_PATH}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        RECOVERY.title(fixture.name),
      );

      const countdown = page.getByRole("timer", { name: RECOVERY.countdownLabel });

      await expect(countdown).toHaveText(RECOVERY.countdown);
      await expect(countdown, "a thirty-day window, on its first day").toHaveText(/^29d /);
      await expect(page.getByRole("button", { name: RECOVERY.restore })).toBeVisible();

      const pending = await lifecycleOf(context);
      const window = Date.parse(pending.purgeAfter ?? "") - Date.now();

      expect(pending.state).toBe("pending_delete");
      expect(window, "the recovery window is thirty days").toBeGreaterThan(29 * DAY_MS);
      expect(window).toBeLessThanOrEqual(30 * DAY_MS);

      // ---- Everything else is frozen behind it — the service's refusal, and the page's route.
      const frozen = await callAs<Refusal>(context, "GET", "/api/v1/settings/workspace");

      expect(
        [frozen.status, frozen.body.code],
        "every other surface of a workspace pending deletion is frozen",
      ).toEqual([403, "workspace_pending_delete"]);
      await page.goto("/dashboard");
      await page.waitForURL(`**${RECOVERY_PATH}`);

      // ---- Photographed in both palettes. The screen is outside the shell, so there is no
      // account menu to choose one in: the stored choice is written, and the screen reloaded.
      for (const theme of THEMES) {
        await storeTheme(page, theme);
        // The owner's other workspaces are a list every run of this test adds a row to, and a
        // longer list is a taller page — which no mask can hide. Out of the picture entirely.
        await page.addStyleTag({
          content: ".lifecycle-recovery__section:last-of-type { display: none; }",
        });
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          RECOVERY.title(fixture.name),
        );
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot(`settings-pending-delete-${theme}.png`, {
          fullPage: true,
          // ASSUMED(#496-ui): the three `.lifecycle-recovery__*` classes below.
          mask: [
            // The countdown, and the date the lead names.
            page.locator(".lifecycle-recovery__countdown"),
            page.locator(".lifecycle-recovery__lead"),
          ],
        });
      }

      // The stylesheet above goes with the reload; the screen is whole again for what follows.
      await page.reload();

      // ---- A member who is not an owner: an explanation of who can act, not a dead end.
      await signIn(member, SEED_MEMBER.id);
      await selectWorkspace(member, fixture.slug);

      const memberPage = await member.newPage();

      await memberPage.goto("/dashboard");
      await memberPage.waitForURL(`**${RECOVERY_PATH}`);
      await expect(memberPage.getByRole("heading", { level: 1 })).toHaveText(
        RECOVERY.title(fixture.name),
      );
      await expect(memberPage.getByRole("note")).toHaveText(RECOVERY.nonOwner);
      await expect(memberPage.getByRole("button", { name: RECOVERY.restore })).toHaveCount(0);

      const refused = await callAs<Refusal>(member, "POST", "/api/v1/settings/lifecycle/restore");

      expect(refused.status, "only an owner restores").toBe(403);
      expect((await lifecycleOf(context)).state).toBe("pending_delete");

      // ---- Restore: the workspace is itself again.
      await page.getByRole("button", { name: RECOVERY.restore }).click();
      await page.waitForURL("**/dashboard");
      expect((await lifecycleOf(context)).state).toBe("active");
      expect((await callAs(context, "GET", "/api/v1/settings/workspace")).status).toBe(200);

      await page.goto(SETTINGS_PATH);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(HUB.title);
      await expect(
        seat(page, "danger").getByRole("button", { name: DANGER.deleteButton(fixture.name) }),
      ).toBeVisible();
    } finally {
      await restoreIfPending(context);
      await member.close();
    }
  });
});
