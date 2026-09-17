/**
 * Leg 15 — *mockup 09, and the longest chain in the product*
 * ([#288](https://github.com/NobuData/ouroboros/issues/288), AM.6, amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Every other leg in this directory crosses two or three boundaries. This one crosses six:
 * the browser, `ouroboros-rest`, **`ouroboros-engine`** (the planner and the estimator), a
 * **tracker**, the canonical sync that reads it back, the intake mirror that reads it back
 * again, and INTAKE-M.3's queue — which lands on the **dashboard**, a different page owned by
 * a different roadmap. Each of those boundaries is a place where a change on one side can
 * quietly stop matching the other, and each is invisible to the suites on either side of it.
 *
 * ## The assertions this leg exists for
 *
 * **Sync-back proves the push was real.** An issue the push service filed is not a special
 * object: ordinary WF-Q sync has to walk the tracker, find it, and keep it as *the* canonical
 * ticket — one, not a second one beside the row the push already wrote. So the chain pushes,
 * then syncs, then asserts the canonical backlog holds **exactly one ticket per issue the
 * tracker holds**. A push that took a private shortcut and a sync that filed duplicates both
 * go red here, and nowhere else: the row is written by one service, the walk is done by
 * another part of it, and only a running stack puts the two in the same sentence.
 *
 * **Queue-small proves composition.** Decision N7 says the toggle reuses INTAKE-M.3 rather
 * than adding a queue path. The only way to check that claim is to follow a pushed small
 * ticket onto the **dashboard's** queue card and watch the count move by exactly the number
 * of small tickets — a different page, a different read model, a different roadmap.
 *
 * **Resume proves the idempotency contract.** One creation is refused in the middle of the
 * batch; the resume re-runs what failed; the tracker must then hold the intended issues and
 * **not one more**. That is a claim about what was *not* written, and it is the only kind of
 * claim a full traversal can make.
 *
 * Around them: seeded parity for all four cards and the gantt, screenshot-diffed in both
 * palettes; a bar moved and an epic round-tripped through its editor; the *Blocked* meter
 * shifting because the push wired real dependencies; a member allowed to draft and refused a
 * push; and the shell's own promises on a laid-out page.
 *
 * ## Three deliberate divergences from the ticket's own words, and why
 *
 * **The chain is one test, not two.** The ticket describes *the main chain* and *push-resume*
 * separately. They are one traversal here because decision N7 makes them one: queue-small
 * composes M.3 unchanged, M.3 will only queue an issue that is **mirrored and sized**, and an
 * issue created a moment ago is neither — the hook says so per draft, `not mirrored yet`. The
 * only push that can follow a sync is a resume. A leg that pushed cleanly and then asserted a
 * queue row would be asserting something the product does not do, and would have had to reach
 * past the UI to make it true. `support/planning.ts` § {@link PUSH_CHAIN} carries the whole
 * argument.
 *
 * **The chain generates its own batch rather than pushing the seeded one.** The seed's OTA
 * batch is what the parity group asserts, and it has **Queue XS/S** *off* — as the mockup's
 * toggles do — and there is no route that turns a stored batch's toggle on, correctly: it is
 * a property of the press that made it. So the chain makes its own batch through the card,
 * with the toggle on, which is also the ticket's own *outline → generate → sized drafts*.
 *
 * **The bar is moved with its stepper rather than with a pointer.** `roadmap-gantt.tsx` gives
 * the same edit two front doors, and they meet at one `commit`: a drag converts pixels to
 * whole months and a stepper names the months directly. The pixel arithmetic is thoroughly
 * unit-tested in `ouroboros-ui` against a known month width; what only this leg can see is
 * that the committed months reach the service and survive a reload — so the leg takes the
 * door whose outcome is not a function of how wide a column rendered.
 *
 * ## What this leg writes
 *
 * More than any leg before it, and almost none of it is undoable —
 * `support/planning.ts` § *What this leg writes* has the table and the reasons. The tracker is
 * reset, the workspace's GitHub token is removed, the lane it moved is moved back and the epic
 * it edited is put back; the batch it generated, the issues it filed, the tickets those became
 * and the one queue row stay. **So this leg is green from a cold volume**, which is its own
 * first acceptance criterion and leg 11's position for leg 11's reason.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  MEMBER_LIMITS,
  PLANNING_HEAD,
  PLANNING_PATH,
  PUSH_CHAIN,
  SEEDED_BATCH,
  SEEDED_HEALTH,
  SEEDED_ROADMAP,
  SEEDED_SYNC,
  SMALL_EFFORTS,
  clearGithubToken,
  epicParentIssue,
  planningPathFor,
  refuseOneCreate,
  resetTracker,
  setGithubToken,
  syncCanonicalBacklog,
  syncIntakeMirror,
  tracker,
  type TrackerIssue,
} from "../support/planning";
import { quietly, requestAs } from "../support/rest";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { PANE_SELECTOR, chromeBoxes, scrollPaneTo } from "../support/shell";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * The window the parity pair is photographed through.
 *
 * 1920 × 2400, and the height is the decision — `specs/routing.spec.ts` argues it in full. The
 * shell's pane is the only scroll container, so an element screenshot of a `<main>` taller than
 * the viewport records everything below the fold as bare ground. This page is the tallest in
 * the suite: a generator card with six draft rows beside two stacked cards, and a five-lane
 * gantt under both. The leg asserts the pane does not scroll at this height, so a page that
 * outgrows the window turns red rather than being quietly cropped.
 */
const PARITY_WINDOW = { width: 1920, height: 2400 };

/**
 * The chain's own outline, and the one thing about it that is not decoration.
 *
 * `outline-v0` gives a draft the lines indented under its bullet as its body, and
 * `heuristic-v0` sizes a draft with no body as `xs` — so an outline of six flat bullets
 * produces six small drafts, and *queue the small ones* would be *queue all of them*, which is
 * a toggle nobody could tell from a no-op. The fourth bullet therefore carries a long indented
 * paragraph, which is the one signal the estimator has here, and it sizes larger.
 *
 * The `blocks:` annotations name `OTA-` keys because that is the prefix the card sends
 * (`generator.ts`'s `LOCAL_KEY_PREFIX`), and outline-v0 reports an annotation naming a key
 * nobody drafted as a note rather than refusing it — so a mismatched prefix here would cost the
 * batch every edge it has, quietly.
 *
 * The leg does not hard-code which drafts come back small. It reads the effort chips off the
 * page and requires the batch to hold **some of each**, so the assertion below is about the
 * *toggle* rather than about the estimator's judgement — and a day the estimator stops
 * discriminating is reported as that, rather than as a queue count nobody can explain.
 *
 * The **dependencies** are hard-coded, and they are shaped for the two assertions worth making
 * about a push. `OTA-3` is blocked by two drafts, so *blocked by exactly these two* is a claim a
 * one-blocker graph could not make. And `OTA-5` is blocked by `OTA-3` **and** by `OTA-4` — the
 * draft with a body, which is therefore the one that is not small and the one the chain
 * deselects. `push.service.ts` says a dependency on a draft nobody is pushing *"stays in
 * `ticket_dependencies` as planned and is not sent anywhere"*, so `OTA-5`'s issue must come back
 * from the tracker blocked by one thing and not two. That is a claim about what was **not**
 * written, and it is the only kind a full traversal can make.
 */
const TITLES = {
  /** `OTA-1` — blocks the rollback. */
  partition: "Partition table & bootloader slot flag for A/B scheme",
  /** `OTA-2` — blocks the rollback too, so the rollback has *two* blockers. */
  checksum: "SHA-256 checksum verification before slot swap",
  /** `OTA-3` — blocked by both of the above, and blocks the HIL tests. */
  rollback: "Rollback state machine on failed boot confirmation",
  /** `OTA-4` — the one bullet with a body, so the one draft that is not small. */
  beacon: "BLE recovery beacon when both slots fail checksum",
  /** `OTA-5` — blocked by the rollback **and** by the beacon nobody pushes. */
  hil: "Power-loss integration tests on HIL rig (kill power mid-flash)",
  /** `OTA-6` — nothing blocks it, and nothing it blocks. */
  docs: "Operator docs: recovery procedure & beacon pairing",
} as const;

const CHAIN = {
  prompt:
    "Harden the OTA update path so a power cut mid-flash can never brick a unit, and make the " +
    "recovery procedure something a field engineer can follow.",
  outline: [
    `- ${TITLES.partition}  blocks: OTA-3  [feature-loop]`,
    `- ${TITLES.checksum}  blocks: OTA-3  [feature-loop]`,
    `- ${TITLES.rollback}  blocks: OTA-5  [feature-loop]`,
    `- ${TITLES.beacon}  blocks: OTA-5  [feature-loop]`,
    "    The beacon has to come up from the bootloader with no application image present, " +
      "advertise a service UUID the fleet console already knows, and answer a pairing " +
      "challenge without a stored key — which means the whole handshake, the advertising " +
      "interval, the power budget for a unit running on its reserve capacitor, and the " +
      "console-side discovery flow all have to be specified before any of it is written. " +
      "It also has to survive a unit whose flash is entirely unreadable, which is the case " +
      "the current recovery path does not cover at all and the reason this is not a small " +
      "change to an existing routine.",
    `- ${TITLES.hil}  [hil-verify]`,
    `- ${TITLES.docs}  [docs-loop]`,
  ].join("\n"),
  /** How many bullets the outline has, and therefore how many drafts must come back. */
  drafts: 6,
  /**
   * The milestone the batch is filed under.
   *
   * Named by the card rather than inherited: a batch generated on a page opened with no batch
   * opens on *No milestone*, so a chain that did not choose one would never reach
   * `ensureMilestone` and the tracker would end with no milestone to assert.
   */
  milestone: "Planning e2e",
} as const;

/**
 * How long a step that goes through the engine may take.
 *
 * Longer than `EXPECT_TIMEOUT_MS`, and named rather than sprinkled: planning a six-bullet
 * outline, sizing six drafts, and two sync cycles that each walk four repositories are the
 * only things in this suite that wait on more than one service. A step that needs longer than
 * this is a step that has stopped working rather than a slow one.
 */
const ENGINE_MS = 45_000;

/* ------------------------------------------------------------------ getting there */

/**
 * Sign in, enter the workspace, and land on the planning page.
 *
 * Waits for the head *and* for a single `<main>`, for the reason `specs/routing.spec.ts` sets
 * out: the segment has a `loading.tsx`, so the server streams the screen into a hidden copy
 * that React relocates on hydration, and until then the document holds two of them.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param options.as - Whose session. The seeded owner by default.
 * @param options.batch - A batch to open the generator card on, or `null` for none.
 * @returns When the page is one page.
 */
async function enterPlanning(
  context: BrowserContext,
  page: Page,
  options: { readonly as?: string; readonly batch?: string | null } = {},
): Promise<void> {
  const { as = SEED_OWNER.id, batch = null } = options;

  await signIn(context, as);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(batch === null ? PLANNING_PATH : planningPathFor(batch));

  await expect(page.getByRole("heading", { level: 1, name: PLANNING_HEAD.title })).toBeVisible();
  await expect(page.locator("main.planning")).toHaveCount(1);
}

/** The generator card — `Generate tickets`, the region its heading names. */
function generator(page: Page): Locator {
  return page.getByRole("region", { name: "Generate tickets" });
}

/** The roadmap card. Its name carries the roadmap, so it is matched by its stable prefix. */
function roadmap(page: Page): Locator {
  return page.getByRole("region", { name: /^Roadmap/ });
}

/**
 * One draft row of the generator card.
 *
 * Found by its checkbox's label — `Include OTA-3` — which is the one thing on the row that
 * names the draft and is not also somewhere else on it.
 *
 * @param page - The page.
 * @param key - The draft's local key.
 * @returns The row.
 */
function draftRow(page: Page, key: string): Locator {
  return generator(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: `Include ${key}` }) });
}

/** Every draft row's local key, in the order the card lists them. */
async function draftKeys(page: Page): Promise<string[]> {
  return generator(page).locator(".planning-draft__key").allInnerTexts();
}

/** The lines a finished push writes under the footer. */
function outcome(page: Page): Locator {
  return generator(page).locator(".planning-gen__outcome li");
}

/**
 * What the generator card is complaining about, or the empty string when it is not.
 *
 * A **string** rather than a locator, and that is the point: `scripts/verify-failure-modes.sh`
 * requires a broken layer to be *named* in the output, and a step that merely timed out waiting
 * for a heading names a locator. Asserting this is empty puts the service's own sentence — *The
 * engine is not available right now*, a tracker's refusal — into the failure message, where a
 * person reading a CI log at four in the morning needs it.
 *
 * @param page - The page.
 * @returns The card's failure line, or `""` when there is none.
 */
async function generatorFailure(page: Page): Promise<string> {
  const line = generator(page).locator(".planning-gen__failure");

  return (await line.count()) === 0 ? "" : line.innerText();
}

/** A health meter's figure, by the meter's label. */
function meter(page: Page, label: string): Locator {
  return page
    .getByRole("region", { name: SEEDED_HEALTH.title })
    .locator(".planning-health__meter")
    .filter({ hasText: label })
    .locator(".planning-health__value");
}

/* ------------------------------------------------------------------ parity */

test.describe("mockup 09, as the planning seed renders it", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterPlanning(context, page, { batch: SEEDED_BATCH.id });
  });

  test("draws the head and the generator card the seed's OTA batch fills", async ({ page }) => {
    await expect(page.locator(".planning__sub")).toHaveText(PLANNING_HEAD.subline);

    // **Import from Jira** is AN.3 and does not exist, so it is a ghost marked *soon* naming
    // the issue that builds it — the shell's rule for an unbuilt control, on a page action.
    const importJira = page.getByRole("button", { name: /^Import from Jira/ });

    await expect(importJira).toHaveAttribute("aria-disabled", "true");
    await expect(importJira).toHaveAttribute("title", "Importing from Jira arrives with #291.");

    const card = generator(page);

    // The prompt and the outline are the batch's own, read back from the row the seed wrote —
    // which is what makes `?batch=` an address a person can share rather than a local draft.
    await expect(card.getByLabel("Describe the outcome, not the tasks")).toHaveValue(
      /power loss mid-flash/,
    );
    await expect(
      card.getByRole("group", { name: "Target tracker" }).getByRole("button"),
    ).toHaveText(["GitHub Issues", "Jira", "Linear"]);
    await expect(card.getByRole("button", { name: "GitHub Issues" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(card.getByRole("switch", { name: "Auto-size with estimator" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      card.getByRole("switch", { name: "Queue XS/S tickets immediately" }),
    ).toHaveAttribute("aria-checked", "false");

    // Six rows, the mockup's, with the dependency notes the seed's four edges become and the
    // efforts its six estimate rows carry. Every draft has one, so the head pill is `✓ all sized`.
    await expect(card.getByRole("heading", { name: SEEDED_BATCH.heading })).toBeVisible();
    await expect(card.getByText(SEEDED_BATCH.allSized)).toBeVisible();
    expect(await draftKeys(page)).toEqual(SEEDED_BATCH.drafts.map((draft) => draft.key));

    for (const draft of SEEDED_BATCH.drafts) {
      const row = draftRow(page, draft.key);

      await expect(row, draft.key).toContainText(draft.title);
      await expect(row.locator(".ou-chip--effort"), draft.key).toHaveText(draft.effort);
      await expect(row.getByRole("checkbox"), draft.key).toBeChecked();
    }

    // `blocks OTA-3` twice and `blocks OTA-5` twice — the seed's edges, drawn on the blocker.
    for (const edge of SEEDED_BATCH.edges) {
      await expect(draftRow(page, edge.blocker), `${edge.blocker} blocks`).toContainText(
        edge.blocked,
      );
    }

    // Six selected, so the push button counts six, and it names the tracker rather than the kind.
    await expect(card.getByRole("button", { name: "Push 6 tickets to GitHub →" })).toBeVisible();
  });

  test("draws the tracker-sync and backlog-health cards from what the seed computes", async ({
    page,
  }) => {
    const sync = page.getByRole("region", { name: SEEDED_SYNC.title });

    await expect(sync.getByText(SEEDED_SYNC.cadence)).toBeVisible();

    const rows = sync.getByRole("listitem");

    await expect(rows).toHaveCount(SEEDED_SYNC.rows.length);
    for (const [index, row] of SEEDED_SYNC.rows.entries()) {
      await expect(rows.nth(index), row.name).toContainText(row.name);
      await expect(rows.nth(index), row.name).toContainText(row.sub);
      await expect(rows.nth(index), row.name).toContainText(row.state);
    }

    // The one row nobody connected is the one with a way to connect it.
    await expect(rows.nth(2).getByRole("link", { name: SEEDED_SYNC.connect })).toBeVisible();

    const health = page.getByRole("region", { name: SEEDED_HEALTH.title });

    await expect(health.getByText(SEEDED_HEALTH.open)).toBeVisible();
    for (const figure of SEEDED_HEALTH.meters) {
      await expect(meter(page, figure.label), figure.label).toHaveText(figure.value);
    }
    await expect(health).toContainText(SEEDED_HEALTH.footnote);
  });

  test("draws the roadmap's five lanes with the chips the link table computes", async ({
    page,
  }) => {
    const card = roadmap(page);

    await expect(card.getByRole("heading", { name: SEEDED_ROADMAP.title })).toBeVisible();
    await expect(card.locator(".ou-tag").first()).toHaveText(SEEDED_ROADMAP.windowPattern);

    const bars = card.locator(".planning-gantt__bar");

    await expect(bars).toHaveCount(SEEDED_ROADMAP.lanes.length);
    for (const [index, lane] of SEEDED_ROADMAP.lanes.entries()) {
      await expect(bars.nth(index), lane.name).toContainText(lane.name);
      await expect(bars.nth(index).locator(".planning-gantt__chip"), lane.name).toHaveText(
        lane.chip,
      );
    }

    // The fifth lane has no months, so it carries its status in its accessible name — the one
    // place `proposed` is said out loud rather than drawn as a tint.
    await expect(bars.nth(4)).toHaveAttribute("aria-label", /proposed$/);
    await expect(card).toContainText(SEEDED_ROADMAP.footnote);

    // TODAY is drawn from the clock against months the seed dated relative to `now()`, so it is
    // inside the window on any stack — which is the only stable thing to say about it.
    await expect(card.getByText("TODAY")).toBeVisible();
  });

  test("is the mockup in both palettes", async ({ page }) => {
    // The window must actually hold the page. If the pane scrolled, the shutter would record
    // the top of the screen and nothing would say so — the first thing to go would be the
    // gantt, which is the surface the ticket most asks to be diffed.
    expect(
      await page.locator(PANE_SELECTOR).evaluate((pane) => pane.scrollHeight - pane.clientHeight),
      "the parity window must be tall enough to hold the whole screen without scrolling",
    ).toBe(0);

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("planning-light.png");

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("planning-dark.png");
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell on the planning page", () => {
  test("holds its chrome still, lights Planning, and survives the 125% font scale", async ({
    context,
    page,
  }) => {
    await enterPlanning(context, page, { batch: SEEDED_BATCH.id });

    // The sidebar entry that knows where the reader is.
    await expect(
      page.getByRole("navigation").getByRole("link", { name: PLANNING_HEAD.eyebrow }),
    ).toHaveAttribute("aria-current", "page");

    // The premise: a page that fitted the viewport would make everything below vacuously true.
    expect(
      await page.locator(PANE_SELECTOR).evaluate((pane) => pane.scrollHeight - pane.clientHeight),
      "the planning screen must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    const before = await chromeBoxes(page);

    await scrollPaneTo(page, 600);

    const after = await chromeBoxes(page);

    expect(after.header, "the header moved when the pane scrolled").toEqual(before.header);
    expect(after.sidebar, "the sidebar moved when the pane scrolled").toEqual(before.sidebar);

    // The reader's own stepper, taken to 125% and put back. What it proves is that a page of
    // rem-based type still draws: the root font size really changed, and the page still has
    // its four cards.
    await setFontScale(context, "125");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: PLANNING_HEAD.title })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(page.locator("html")).toHaveCSS("font-size", rootFontSize("125"));
    await expect(page.getByRole("region", { name: SEEDED_HEALTH.title })).toBeVisible();
    await expect(roadmap(page)).toBeVisible();
  });

  test.afterEach(async ({ context }) => {
    await quietly(
      () => restoreFontScale(context),
      "the font scale is still 125% — every later leg photographs a page a size too large.",
    );
  });
});

/* ------------------------------------------------------------------ the member */

test.describe("a member's planning page", () => {
  test("may draft and may not push", async ({ context, page }) => {
    await enterPlanning(context, page, { as: SEED_MEMBER.id, batch: SEEDED_BATCH.id });

    const card = generator(page);

    // The split AM.5 exists for, and the reason it is worth a leg: both controls are in this
    // one card, so a guard that read *member* as *may not act* would take both.
    await expect(card.getByLabel("Describe the outcome, not the tasks")).toBeEditable();
    await expect(card.getByRole("button", { name: "Draft tickets ⟳" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const push = card.getByRole("button", { name: /^Push \d+ tickets? to GitHub/ });

    await expect(push).toHaveAttribute("aria-disabled", "true");
    await expect(push).toHaveAttribute("title", MEMBER_LIMITS.push);

    // The roadmap is an owner's and an admin's, and says so in two places.
    const newRoadmap = page.getByRole("button", { name: "New roadmap" });

    await expect(newRoadmap).toHaveAttribute("title", MEMBER_LIMITS.newRoadmap);

    // A member is offered no steppers at all — `mayAdminister` gates the whole toolbar — so
    // what is asserted is their absence beside a gantt that is otherwise fully drawn.
    await expect(roadmap(page).locator(".planning-gantt__bar")).toHaveCount(
      SEEDED_ROADMAP.lanes.length,
    );
    await expect(roadmap(page).getByRole("toolbar")).toHaveCount(0);

    // …and the editor still opens, because reading the plan is a member's. It says which half
    // of it is theirs rather than refusing to draw, which is the page's rule everywhere else.
    await roadmap(page).locator(".planning-gantt__bar").first().click();

    const editor = page.getByRole("dialog", { name: "Edit epic" });

    await expect(editor).toContainText(MEMBER_LIMITS.roadmap);
    await expect(editor.getByLabel("Name")).toBeDisabled();
  });
});

/* ------------------------------------------------------------------ the roadmap */

test.describe("the roadmap", () => {
  /** The lane the two edits are made on — neither the pushed batch's nor the unscoped one. */
  const LANE = "Motor control refactor";

  test("moves a bar a month and round-trips an epic through its editor", async ({
    context,
    page,
  }) => {
    await enterPlanning(context, page);

    const bar = roadmap(page).locator(".planning-gantt__bar").filter({ hasText: LANE });
    const before = await bar.getAttribute("aria-label");

    await roadmap(page)
      .getByRole("button", { name: `Move ${LANE} a month later` })
      .click();

    // The bar's accessible name is its months, so a move is readable without reading pixels.
    await expect(bar).not.toHaveAttribute("aria-label", before ?? "");

    const moved = await bar.getAttribute("aria-label");

    // The reload is the assertion: an optimistic bar that never reached the service looks
    // exactly like one that did, until the page is drawn again from the row.
    await page.reload();
    await expect(
      roadmap(page).locator(".planning-gantt__bar").filter({ hasText: LANE }),
    ).toHaveAttribute("aria-label", moved ?? "");

    // The editor, opened by the bar it belongs to.
    await roadmap(page).locator(".planning-gantt__bar").filter({ hasText: LANE }).click();

    const editor = page.getByRole("dialog", { name: "Edit epic" });

    await expect(editor.getByLabel("Name")).toHaveValue(LANE);
    await expect(editor.getByRole("heading", { name: "Linked tickets" })).toBeVisible();

    // Nothing has been pushed under this lane, so it has no mirror — which is the sentence
    // that makes the *OTA hardening* lane's mirror, after the chain below, mean something.
    await expect(editor).toContainText("Not mirrored yet");

    await editor.getByLabel("Status").selectOption("proposed");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();

    // A status is drawn as an affix on the bar's accessible name, so the round trip is
    // visible on the gantt rather than only inside the editor that wrote it.
    await expect(
      roadmap(page).locator(".planning-gantt__bar").filter({ hasText: LANE }),
    ).toHaveAttribute("aria-label", /proposed$/);

    await page.reload();
    await expect(
      roadmap(page).locator(".planning-gantt__bar").filter({ hasText: LANE }),
    ).toHaveAttribute("aria-label", /proposed$/);
  });

  test.afterEach(async ({ page }) => {
    // Put the lane back: a month earlier, and `active` again. Both are restorable, unlike
    // everything the chain below writes, so both are restored.
    await quietly(async () => {
      await page.goto(PLANNING_PATH);
      await page.getByRole("button", { name: `Move ${LANE} a month earlier` }).click();
      await page.locator(".planning-gantt__bar").filter({ hasText: LANE }).click();

      const editor = page.getByRole("dialog", { name: "Edit epic" });

      await editor.getByLabel("Status").selectOption("active");
      await editor.getByRole("button", { name: "Save" }).click();
      await expect(editor).toBeHidden();
    }, `the ${LANE} lane is still moved — the parity group's gantt is a month out.`);
  });
});

/* ------------------------------------------------------------------ the chain */

test.describe("the planning chain", () => {
  test("outlines, generates, pushes, syncs back, resumes, and queues the small ones", async ({
    context,
    page,
    request,
  }) => {
    // The one test in this directory that waits on four services in sequence. `slow()` triples
    // the per-test timeout rather than raising the suite's budget, which is the number this
    // leg's allowance is charged against and is deliberately not moved.
    test.slow();

    const sandbox = tracker(request);

    await resetTracker(request);
    await enterPlanning(context, page);
    // The intake mirror authenticates as the workspace rather than as a source, and the seed
    // gives the workspace no token — which is the honest state of a workspace nobody has
    // connected. The chain needs one, and takes it away again in teardown.
    await setGithubToken(context);

    const card = generator(page);

    /* -------------------------------------------------- outline → generate → sized drafts */

    await card.getByLabel("Describe the outcome, not the tasks").fill(CHAIN.prompt);
    await card.getByRole("button", { name: "Structured outline (optional)" }).click();
    await card.getByLabel("Structured outline").fill(CHAIN.outline);

    const queueSmall = card.getByRole("switch", { name: "Queue XS/S tickets immediately" });

    await queueSmall.click();
    await expect(queueSmall).toHaveAttribute("aria-checked", "true");

    // **New milestone…** — the field's third state, and the one that makes `ensureMilestone` run
    // against the tracker. The select's options are the *tracker's* milestones, read over the
    // network through `GET /planning/sources/{id}/milestones`; the sandbox has none until this
    // push creates one, so `New milestone…` is the only path there is, which is also the state a
    // first batch in a fresh repository is always in.
    await card.getByLabel("Milestone").selectOption("__new__");
    await card.getByLabel("New milestone name").fill(CHAIN.milestone);

    await card.getByRole("button", { name: "Draft tickets ⟳" }).click();

    const drafted = card.getByRole("heading", { name: `${String(CHAIN.drafts)} drafts` });

    // Waited for as *either outcome*, then judged: a plain wait on the heading would report a
    // dead planner as a locator that never appeared. See {@link generatorFailure}.
    await expect(drafted.or(card.locator(".planning-gen__failure"))).toBeVisible({
      timeout: ENGINE_MS,
    });
    expect(await generatorFailure(page), "the planner refused the outline").toBe("");

    // The planner is `ouroboros-engine`, reached over the compose network: one bullet, one
    // draft, and the batch's address in this page's own URL so it can be reloaded or shared.
    await expect(drafted).toBeVisible();
    await expect(page).toHaveURL(/[?&]batch=/, { timeout: ENGINE_MS });

    // Where the chain comes back to every time it has been somewhere else. Read off the page
    // rather than composed, because the id is the service's and this leg never saw it before.
    const batchUrl = page.url();

    // …and the estimator is the same engine through the same pipeline that sizes the intake
    // backlog — decision N3's *one sizer, one table*. `✓ all sized` is the card saying every
    // draft came back with an estimate.
    await expect(card.getByText(SEEDED_BATCH.allSized)).toBeVisible({ timeout: ENGINE_MS });

    const keys = await draftKeys(page);

    expect(keys, "the outline's bullets are not one draft each").toHaveLength(CHAIN.drafts);

    const efforts = await card.locator(".ou-chip--effort").allInnerTexts();
    const small = keys.filter((_key, index) => SMALL_EFFORTS.includes(efforts[index] ?? ""));

    // The guard that keeps the queue assertion from being vacuous — see CHAIN's note. Both
    // directions, because *everything is small* is as uninformative as *nothing is*.
    expect(
      small.length,
      `nothing sized xs or s; the efforts were ${efforts.join(", ")}`,
    ).toBeGreaterThan(0);
    expect(
      small.length,
      `everything sized xs or s; the efforts were ${efforts.join(", ")}`,
    ).toBeLessThan(keys.length);

    /* -------------------------------------------------- deselect one, and refuse one create */

    // The draft nobody pushes. Derived rather than named, because *which* draft is not small is
    // the estimator's judgement — and then checked against the one the outline shaped for it, so
    // that a day the estimator changes its mind is reported as that rather than as a queue count
    // nobody can explain. It is deliberately not one of the small ones: the queue assertion
    // below counts the small drafts that *were* pushed.
    const deselected = keys.filter((key) => !small.includes(key)).at(-1);

    expect(deselected, "every draft is small, so there is none to deselect").toBeDefined();
    await expect(
      draftRow(page, deselected ?? ""),
      "the draft that is not small is the one the outline gave a body",
    ).toContainText(TITLES.beacon);

    const pushing = keys.filter((key) => key !== deselected);

    await draftRow(page, deselected ?? "")
      .getByRole("checkbox")
      .uncheck();
    await expect(
      card.getByRole("button", { name: `Push ${String(pushing.length)} tickets to GitHub →` }),
    ).toBeVisible();

    // The epic's parent issue is created before any draft, so letting four creations through
    // refuses the third draft in `pushOrder`'s order and leaves the rest of the walk to run —
    // which is what gives the sync between the two pushes something small to size.
    await refuseOneCreate(request, PUSH_CHAIN.refuseAfter);

    const blockedBefore = await meter(page, "Blocked").innerText();

    await card.getByRole("button", { name: /^Push \d+ tickets? to GitHub/ }).click();

    await expect(outcome(page).first().or(card.locator(".planning-gen__failure"))).toBeVisible({
      timeout: ENGINE_MS,
    });
    // A whole push that failed is a different thing from a batch that half-landed, and only one
    // of them is what this step is about — so the card's refusal line is read before the
    // outcome, and carries the tracker's own sentence when there is one.
    expect(await generatorFailure(page), "the push was refused outright").toBe("");

    // A refusal is about one draft, so the walk carries on: the run ends `partial`, the card
    // says how many did not land, and it offers **Resume push** rather than a dead batch.
    await expect(outcome(page).first()).toContainText("did not land");
    await expect(card.getByRole("button", { name: "Resume push" })).toBeVisible();

    /* -------------------------------------------------- verified through the tracker's API */

    const afterPush = await sandbox.issues();
    const parent = epicParentIssue(afterPush);

    expect(parent, "the push created no parent issue for the batch's epic").toBeDefined();

    const pushedSoFar = afterPush.filter((issue) => issue.number !== parent?.number);

    // One issue per draft that landed, and one parent — and nothing else in the repository.
    expect(pushedSoFar, "the tracker holds an issue no draft in this batch made").toHaveLength(
      pushing.length - 1,
    );
    // The milestone the card named — created by the push, because the repository had none.
    expect(
      (await sandbox.milestones()).map((milestone) => milestone.title),
      "the push did not create the milestone the batch named",
    ).toContain(CHAIN.milestone);

    // **The dependencies are native**: a `blocked_by` relation the tracker holds, not a line of
    // prose in a body. Read from the tracker rather than from the row that wrote it, which is
    // the whole of *verified through the tracker API rather than the UI* — and asserted as the
    // exact set, because *some relation exists* is a claim a broken graph could also satisfy.
    const blockersOf = async (title: string): Promise<string[]> => {
      const issue = issueTitled(afterPush, title);
      const blockers = await sandbox.blockedBy(issue.number);

      return blockers.map((blocker) => blocker.title).sort();
    };

    expect(await blockersOf(TITLES.rollback), "the rollback's two blockers").toEqual(
      [TITLES.checksum, TITLES.partition].sort(),
    );
    expect(await blockersOf(TITLES.docs), "a draft nothing blocks").toEqual([]);

    // **The epic parent links** — AL.3's epic mapping, which on GitHub is a parent issue with
    // sub-issues rather than a milestone. Every issue the push filed is one of its children.
    const children = await sandbox.subIssues(parent?.number ?? 0);

    expect(children.map((child) => child.number).sort(ascending)).toEqual(
      pushedSoFar.map((issue) => issue.number).sort(ascending),
    );

    /* -------------------------------------------------- the dependencies reach the page */

    // The push rewrote the batch's draft edges into canonical ticket dependencies, so the
    // *Blocked* meter — open tickets with an **open** blocker — has to move. This is the
    // ticket's *add a dependency, watch the meter shift*, arrived at through the product's own
    // path rather than through a write nothing in the UI can make.
    await page.goto(batchUrl);
    await expect(meter(page, "Blocked")).not.toHaveText(blockedBefore);

    /* -------------------------------------------------- sync-back, through both mirrors */

    await syncCanonicalBacklog(context);
    await syncIntakeMirror(context);

    // **Sync-back.** Ordinary WF-Q sync walked the tracker and adopted what the push wrote: one
    // canonical ticket per issue, never two. Asked by key, because a duplicate is a second row
    // carrying the same key and a count alone would not see it.
    for (const issue of afterPush) {
      const key = `#${String(issue.number)}`;
      const found = await requestAs<{ items: { externalKey: string }[] }>(
        context,
        "GET",
        `/api/v1/planning/tickets?q=${encodeURIComponent(key)}`,
        null,
        `reading the canonical ticket for ${key}`,
      );

      expect(
        (found?.items ?? []).filter((ticket) => ticket.externalKey === key),
        `${key} in the canonical backlog`,
      ).toHaveLength(1);
    }

    // …and the intake mirror, which is the backlog mockup 03 draws and the only table M.3 will
    // queue from. Sizing is the estimation pipeline's and runs after the sync answers, so this
    // waits for it: a resume pressed while the rows are still `estimating` would find nothing
    // queueable and the queue assertion below would be about the clock.
    for (const issue of pushedSoFar) {
      await expect
        .poll(() => mirroredSizing(context, issue.number), {
          message: `#${String(issue.number)} never reached the intake mirror, sized`,
          timeout: ENGINE_MS,
        })
        .toBe("sized");
    }

    /* -------------------------------------------------- resume, and the duplicate check */

    const queuedBefore = await queuedIssues(page);

    await page.goto(batchUrl);
    await generator(page).getByRole("button", { name: "Resume push" }).click();
    await expect(outcome(page).first()).toContainText("Pushed", { timeout: ENGINE_MS });

    // **The duplicate check, explicitly.** The resume re-ran only what failed, so the tracker
    // now holds one issue per selected draft plus the epic's parent — and **not one more**. A
    // `createTicket` that stopped probing for its own push key would file a second copy of
    // everything the first run created, and this is the only place that is visible.
    const afterResume = await sandbox.issues();

    expect(afterResume, "the resume filed an issue that already existed").toHaveLength(
      pushing.length + 1,
    );
    expect(
      new Set(afterResume.map((issue) => issue.title)).size,
      "two issues in the tracker carry the same title",
    ).toBe(afterResume.length);

    // **And the claim about what was not written.** `OTA-5` was planned as blocked by the
    // rollback *and* by the draft this chain deselected. Only the first was pushed, so only the
    // first may be a relation: a dependency on a draft nobody filed cannot reference anything,
    // and `push.service.ts` leaves it in `ticket_dependencies` as planned rather than inventing
    // an end for it.
    const hil = issueTitled(afterResume, TITLES.hil);

    expect(
      (await sandbox.blockedBy(hil.number)).map((blocker) => blocker.title),
      "the HIL tests are blocked by the rollback and by nothing else",
    ).toEqual([TITLES.rollback]);

    // Every issue the push filed is a child of the epic's parent, the deselected one included
    // by its absence: five drafts went, one stayed, and the parent has five children.
    expect(
      (await sandbox.subIssues(parent?.number ?? 0)).map((child) => child.number).sort(ascending),
    ).toEqual(
      afterResume
        .filter((issue) => issue.number !== parent?.number)
        .map((issue) => issue.number)
        .sort(ascending),
    );

    // Queue-small ran on this push and named what it queued. The drafts the first run filed are
    // mirrored and sized by now; the one the resume has just created is not, and the hook says
    // so per draft rather than pretending otherwise.
    // A regex, not a string: `hasText` matches a string case-insensitively, and the hook's own
    // *"… not queued — not mirrored yet"* line would match a `"Queued"` filter as well.
    await expect(outcome(page).filter({ hasText: /^Queued / })).toHaveCount(1);

    /* -------------------------------------------------- the dashboard's queue card */

    // **Queue-small proves composition.** A different page, a different roadmap, and a read
    // model INTAKE-M.3 wrote through — moved by at least one and never by more than the batch's
    // small tickets, which is what decision N7's *reuse M.3 rather than add a queue path* comes
    // to in the end.
    const queuedAfter = await queuedIssues(page);

    expect(queuedAfter, "the dashboard's queue did not move").toBeGreaterThan(queuedBefore);
    expect(
      queuedAfter - queuedBefore,
      "the queue moved by more than this batch's small tickets",
    ).toBeLessThanOrEqual(small.length);
  });

  test.afterEach(async ({ context, request }) => {
    await quietly(
      () => clearGithubToken(context),
      "the workspace still holds this leg's GitHub token — the intake leg's *sync paused* " +
        "guidance is about a workspace that has none.",
    );
    await quietly(
      () => resetTracker(request),
      "the sandbox tracker still holds this run's issues — the next run's duplicate check " +
        "would be counting them.",
    );
  });
});

/** Numbers, ascending — `sort()` without one compares them as text. */
function ascending(left: number, right: number): number {
  return left - right;
}

/**
 * The tracker's issue with one title.
 *
 * By title rather than by push key, because the chain's batch is one the *service* made: its
 * draft ids were never seen here, and the title is the one thing the outline decided and the
 * push carried through unchanged.
 *
 * @param issues - What the tracker holds.
 * @param title - The bullet's title.
 * @returns The issue.
 * @throws When nothing carries it — which is the failure a caller wants named, rather than an
 *   assertion against `undefined` two lines later.
 */
function issueTitled(issues: readonly TrackerIssue[], title: string): TrackerIssue {
  const found = issues.find((issue) => issue.title === title);

  if (found === undefined) {
    throw new Error(`the tracker holds no issue titled "${title}"`);
  }

  return found;
}

/**
 * What the intake mirror says about one issue's sizing.
 *
 * @param context - A signed-in context.
 * @param number - The issue's number.
 * @returns Its `sizingStatus`, or `absent` when the mirror has not seen it — two different
 *   facts, and a poll that answered `undefined` for both would time out without saying which.
 */
async function mirroredSizing(context: BrowserContext, number: number): Promise<string> {
  const listing = await requestAs<{ items: { number: number; sizingStatus: string }[] }>(
    context,
    "GET",
    `/api/v1/backlog?q=${String(number)}`,
    null,
    `reading the intake mirror for #${String(number)}`,
  );

  return listing?.items.find((row) => row.number === number)?.sizingStatus ?? "absent";
}

/**
 * How many issues the dashboard says are queued.
 *
 * Read off the *page* rather than from the aggregate, because the claim being followed is that
 * a pushed ticket reaches the **dashboard** — and a figure taken from the API would be the same
 * read model the queue write already answered from.
 *
 * @param page - The page. It is left on the dashboard; the caller navigates back.
 * @returns The count.
 */
async function queuedIssues(page: Page): Promise<number> {
  await page.goto("/dashboard");

  const tile = page.getByRole("region", { name: "Queued issues" });

  await expect(tile).toBeVisible();

  return Number(await tile.locator(".dash-stat__value").innerText());
}
