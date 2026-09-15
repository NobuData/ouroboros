/**
 * Leg 12 — *mockup 04's studio, drawn and driven in a browser*
 * ([#149](https://github.com/NobuData/ouroboros/issues/149), the studio's first leg;
 * [#154](https://github.com/NobuData/ouroboros/issues/154), S.8, the authoring loop).
 *
 * `ouroboros-ui`'s suites prove every decision behind the canvas's visual language — which
 * treatment a stage takes, what its chips say, which arrowhead an edge ends in, what tone a label
 * wears — and prove that the sheet puts each on the right token. What none of them can prove is a
 * pixel: jsdom applies no stylesheet and paints nothing. The ticket's first acceptance criterion
 * is a picture — *side-by-side parity with the mockup canvas in both themes* — and three of its
 * others are claims about what a browser computes: the octagon is a clip-path, the loop edge is
 * dashed and glows, the selected stage wears the `.sel` ring. So this leg opens the seeded
 * `standard-fix` in the product and asks the browser.
 *
 * ## What #149 asserts
 *
 *   * **the treatments** — each of the twelve stages takes its type's classes, prints its type
 *     line and prints the chips its config becomes (`support/studio.ts` has the table), with the
 *     four labels in their tones;
 *   * **the shapes** — both flow nodes are clipped to a polygon, and *Back to queue* is the
 *     mockup's 176 × 44 pill;
 *   * **the ouroboros** — the loop edge is dashed, glows, ends in its own arrowhead, and is drawn in
 *     `--accent-deep` as each palette defines it — the token reaching an SVG path, which is the
 *     half of *both themes* a screenshot of one palette cannot show;
 *   * **the `.sel` ring** — a clicked stage gets the accent rim and the two-shadow glow;
 *   * **parity** — the canvas with *Implement* selected, as the mockup draws it, screenshot-diffed
 *     in both palettes;
 *   * **S.6's dry run** — `#485` paints the mockup's active path in both palettes, edge by edge, and
 *     the first edit clears it. *Parity* is the canvas as it opens, and a screenshot of a walk the
 *     engine may lengthen would not survive, so the path is asserted rather than photographed.
 *
 * ## What S.8 adds, and why only a running stack can see it
 *
 * The authoring loop — edit → publish → version → dry run — spans the browser, `ouroboros-rest`, the
 * engine and the database, and each of them can pass its own suite while the loop as a whole is
 * broken. So the leg drives the loop:
 *
 *   * **parity for the frame** — the rail's five seeded entries with their served captions, and the
 *     inspector opened on *Implement* with every field its schema draws, including the model pill an
 *     inherited route resolves to three tables away;
 *   * **an edit that reaches the canvas** — a skill typed into the inspector does *not* move the chip
 *     until **Apply**, does move it after, and is still there after a reload, which is autosave's
 *     write read back;
 *   * **the publish gate** — a draft sabotaged with an alias the registry does not hold is refused with
 *     *that* finding, anchored to *Code the change*, not merely refused; the finding selects the
 *     stage, the inspector repairs it, and the publish that follows takes and moves the version by
 *     exactly one;
 *   * **a member's studio** — the note that says why, no **Publish**, inert controls carrying their
 *     reasons, and the service's own `403` for the publish the page withholds;
 *   * **the shell** — fixed chrome over a scrolling pane, the Workflows entry and the Visual tab lit,
 *     the segmented control stuck to the pane, and the studio at the 125% font scale.
 *
 * ## What it writes, and what it puts back
 *
 * #149's cases write nothing: they read the seeded workflow and select a stage, which is the browser's
 * state and not the workspace's, and the dry run moves a stage as the seeded **member**, whose page
 * never saves.
 *
 * S.8's edit and publish cases write `standard-fix`'s draft, and put it back in teardown whether or
 * not the test reached its end (`restoreStandardFixDraft`). **The publish itself cannot be put back**
 * — versions are append-only — and needs no undoing: the version it freezes *is* the seeded document,
 * because the repair restores the one field the sabotage changed, so the canvas, the rail's caption
 * and both screenshots read the same afterwards. Only the number moves, and nothing here writes the
 * number down (`PUBLISH_LABEL`), so the leg is green on a cold stack and on the one after it.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import {
  PANE_SELECTOR,
  chromeBoxes,
  expectDocumentUnscrolled,
  expectNoPaneHorizontalScroll,
} from "../support/shell";
import {
  ACCENT_DEEP,
  APPLY_LABEL,
  CANVAS_LABEL,
  CLEAN_REASON,
  DELETE_STAGE_LABEL,
  DIRTY_NOTE,
  DRY_RUN_DIALOG_TITLE,
  DRY_RUN_LABEL,
  DRY_RUN_SHEET_TITLE,
  EDITED_CHIPS,
  EDITED_SKILL,
  FINDINGS_LABEL,
  FINDINGS_MESSAGE,
  IMPLEMENT_CHIPS,
  IMPLEMENT_INSPECTOR,
  INSPECTOR_LABEL,
  LOOP_EDGE,
  MEMBER_CREATE_REASON,
  MEMBER_EDIT_REASON,
  MEMBER_READ_ONLY_NOTE,
  MOCKUP_ACTIVE_EDGES,
  NEW_WORKFLOW_LABEL,
  NOT_TAKEN_EDGE,
  PUBLISH_LABEL,
  RAIL_LABEL,
  REPAIR_NOTE,
  RUN_LABEL,
  SABOTAGE,
  SAVED_NOTE,
  SEEDED_LABELS,
  SEEDED_RAIL,
  SEEDED_STAGES,
  SEEDED_TICKET,
  SELECTED_STAGE,
  STUDIO_PATH,
  STUDIO_SUBNAV_LABEL,
  STUDIO_TITLE,
  TICKET_LABEL,
  publishStatusFor,
  publishedToast,
  publishedVersion,
  restoreStandardFixDraft,
  sabotageDraft,
} from "../support/studio";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/* ------------------------------------------------------------------ getting there */

/**
 * Sign in, enter the seeded workspace, and open the studio on `standard-fix`.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param person - Who signs in. Defaults to the seeded owner.
 * @returns The canvas region, once every stage, edge and label has been drawn.
 */
async function enterStudio(
  context: BrowserContext,
  page: Page,
  person: string = SEED_OWNER.id,
): Promise<Locator> {
  await signIn(context, person);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(STUDIO_PATH);

  return drawnCanvas(page);
}

/**
 * Wait for an open studio page to have drawn its canvas — after a navigation or a reload.
 *
 * @param page - The page, on {@link STUDIO_PATH}.
 * @returns The canvas region, once every stage, edge and label has been drawn.
 */
async function drawnCanvas(page: Page): Promise<Locator> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STUDIO_TITLE);

  const canvas = page.getByRole("region", { name: CANVAS_LABEL });

  // React Flow draws its nodes, measures them, then routes the edges between the measured
  // handles and lays the labels over them — so the labels are the last thing to arrive.
  await expect(canvas.locator(".react-flow__node")).toHaveCount(SEEDED_STAGES.length);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(12);
  await expect(canvas.locator(".studio-edge-label")).toHaveCount(SEEDED_LABELS.length);

  return canvas;
}

/* ------------------------------------------------------------------ the page, as a reader finds it */

/** React Flow's wrapper for one stage. */
function stage(canvas: Locator, id: string): Locator {
  return canvas.locator(`.react-flow__node[data-id="${id}"]`);
}

/** The stage's own box inside the wrapper — where the treatment is. */
function stageBox(canvas: Locator, id: string): Locator {
  return stage(canvas, id).locator(".studio-node");
}

/** The chips a stage prints, in order. */
function stageChips(canvas: Locator, id: string): Locator {
  return stageBox(canvas, id).locator(".studio-node__chip");
}

/** One edge's line. */
function edgeLine(canvas: Locator, id: string): Locator {
  return canvas.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
}

/** The inspector panel beside the canvas. */
function inspector(page: Page): Locator {
  return page.getByRole("complementary", { name: INSPECTOR_LABEL, exact: true });
}

/**
 * The inspector's **Skill** text field.
 *
 * Scoped to its field wrapper because the mode segment's *Skill* radio carries the same label, and
 * a lookup by label alone would find both.
 *
 * @param panel - The inspector.
 * @returns The input.
 */
function skillField(panel: Locator): Locator {
  return panel.locator(".studio-inspector__field").getByLabel("Skill", { exact: true });
}

/** The workflow rail. */
function rail(page: Page): Locator {
  return page.getByRole("navigation", { name: RAIL_LABEL, exact: true });
}

/**
 * A pattern matching text that begins with this text, taken literally.
 *
 * @param text - The beginning.
 * @returns The anchored, escaped pattern.
 */
function startingWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

/**
 * Select a stage the way a reader does, and take the pointer off the canvas so the shot records
 * the selection and not a hover.
 *
 * @param page - The page.
 * @param canvas - The canvas region.
 * @param id - The stage.
 */
async function select(page: Page, canvas: Locator, id: string): Promise<void> {
  await stage(canvas, id).click();
  await page.mouse.move(0, 0);
  await expect(stage(canvas, id)).toHaveClass(/\bselected\b/);
}

/**
 * Press the head's **Publish vN** and wait for its dialog.
 *
 * @param page - The page, as an owner or admin.
 * @returns The dialog, and the action's label — which is also the dialog's title and its submit.
 */
async function openPublish(
  page: Page,
): Promise<{ readonly dialog: Locator; readonly label: string }> {
  const head = page.getByRole("button", { name: PUBLISH_LABEL });

  await expect(head).toHaveCount(1);
  const label = (await head.textContent())?.trim() ?? "";

  await head.click();

  const dialog = page.getByRole("dialog", { name: label });
  await expect(dialog).toBeVisible();

  return { dialog, label };
}

/**
 * Require a pressed publish to have taken — and, when it did not, fail with the sentence the dialog
 * said instead.
 *
 * A bare wait for the toast would fail as a timeout naming a locator, which is the failure somebody
 * marks flaky. A refusal is the dialog's alert, and its words name the layer that refused — the
 * engine's *could not check this definition* above all, which is the text
 * `scripts/verify-failure-modes.sh` looks for with the engine stopped.
 *
 * @param page - The page.
 * @param dialog - The publish dialog the submit was pressed in.
 * @param version - The version the publish must have frozen.
 * @returns When the toast is up and the dialog is gone.
 */
async function expectPublished(page: Page, dialog: Locator, version: number): Promise<void> {
  const toast = page.getByRole("status").filter({ hasText: publishedToast(version) });
  const refusal = dialog.getByRole("alert");

  await expect(toast.or(refusal)).toBeVisible();

  if (await refusal.isVisible()) {
    expect(
      await refusal.textContent(),
      `Publish v${version} refused the repaired draft`,
    ).toBeNull();
  }

  await expect(dialog).toBeHidden();
}

/* ------------------------------------------------------------------ #149: the canvas's language */

test.describe("the studio canvas draws the seeded workflow in mockup 04's language", () => {
  test("every stage takes its type's treatment and prints the chips its config becomes", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);

    for (const { id, treatment, typeLine, chips } of SEEDED_STAGES) {
      const box = stageBox(canvas, id);

      await expect(box, id).toHaveClass(treatment);
      if (typeLine === null) {
        await expect(box.locator(".studio-node__kind"), id).toHaveCount(0);
      } else {
        await expect(box.locator(".studio-node__kind"), id).toHaveText(typeLine);
      }
      await expect(box.locator(".studio-node__chip"), id).toHaveText([...chips]);
    }

    for (const { edge, text, tone } of SEEDED_LABELS) {
      const pill = canvas.locator(`.studio-edge-label[data-edge="${edge}"]`);

      await expect(pill, edge).toHaveText(text);
      await expect(pill, edge).toHaveClass(`studio-edge-label ${tone}`);
    }
  });

  test("the flow nodes are octagons, and Back to queue is the mockup's pill", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);

    for (const id of ["effort-recheck", "checks-green"]) {
      await expect(stageBox(canvas, id), id).toHaveCSS("clip-path", /^polygon\(/);
    }

    const pill = await stageBox(canvas, "back-to-queue").boundingBox();

    expect(pill, "the pill is laid out").not.toBeNull();
    expect({ width: pill?.width, height: pill?.height }).toEqual({ width: 176, height: 44 });
  });

  test("the ouroboros edge is dashed, glows, and is drawn in accent-deep in each palette", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);
    const loop = edgeLine(canvas, LOOP_EDGE);

    await expect(loop).toHaveAttribute("marker-end", "url(#studio-arrow-loop)");
    await expect(loop).toHaveCSS("stroke-dasharray", "7px, 6px");
    await expect(loop).toHaveCSS("filter", /drop-shadow/);

    await pinTheme(page, "light");
    await expect(loop).toHaveCSS("stroke", ACCENT_DEEP.light);

    await pinTheme(page, "dark");
    await expect(loop).toHaveCSS("stroke", ACCENT_DEEP.dark);

    // And every other edge is the plain line, in neither the loop's dash nor its hue.
    await expect(edgeLine(canvas, "implement→build")).toHaveCSS("stroke-dasharray", "none");
  });

  test("a selected stage wears the .sel ring: the accent rim and a two-part glow", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);

    await select(page, canvas, SELECTED_STAGE);

    const box = stageBox(canvas, SELECTED_STAGE);

    await expect(box).toHaveCSS("box-shadow", /0px 0px 0px 3px.*,.*0px 0px 26px -4px/);
    // The rail takes the accent too, as the mockup's `.sel` sets `border-left-color`.
    const rim = await box.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.borderLeftColor];
    });
    expect(rim[1]).toBe(rim[0]);
  });
});

/**
 * The window the parity pair is photographed through: wide enough for the rail beside the
 * canvas, and tall enough that the canvas — the page head, then the 800px stage and its toolbar —
 * sits inside it whole. The shot is of the canvas region alone, so the head's *Last edited 2h
 * ago*, which moves with the clock, is never in it.
 */
const PARITY_WINDOW = { width: 1920, height: 1400 };

test.describe("the studio canvas is drawn in both palettes", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PARITY_WINDOW);
  });

  test("light and dark are both mockup 04's canvas, with Implement selected", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);

    await select(page, canvas, SELECTED_STAGE);

    // The canvas must be in the window whole, or the shutter would record a cropped stage and
    // nothing would say so; and the pane must not have scrolled to put it there.
    const frame = await canvas.boundingBox();
    expect(frame, "the canvas is laid out").not.toBeNull();
    expect(
      (frame?.y ?? 0) + (frame?.height ?? 0),
      "the canvas fits the parity window",
    ).toBeLessThanOrEqual(PARITY_WINDOW.height);
    expect(await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollTop)).toBe(0);

    await pinTheme(page, "light");
    await expect(stage(canvas, SELECTED_STAGE)).toHaveClass(/\bselected\b/);
    await expect(canvas).toHaveScreenshot("studio-canvas-light.png");

    await pinTheme(page, "dark");
    await expect(stage(canvas, SELECTED_STAGE)).toHaveClass(/\bselected\b/);
    await expect(canvas).toHaveScreenshot("studio-canvas-dark.png");
  });
});

test.describe("S.6's dry run paints the engine's walk on the canvas", () => {
  test("#485 on standard-fix draws the mockup's active path in both palettes, and the first edit clears it", async ({
    context,
    page,
  }) => {
    // As the member: a dry run is every member's, and the edit that clears it is one a member's page
    // never saves — so the seeded draft is left exactly as the other legs read it.
    const canvas = await enterStudio(context, page, SEED_MEMBER.id);

    await page.getByRole("button", { name: DRY_RUN_LABEL, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: DRY_RUN_DIALOG_TITLE });
    await expect(
      dialog.getByRole("combobox", { name: TICKET_LABEL }).locator("option:checked"),
    ).toHaveText(SEEDED_TICKET);
    await dialog.getByRole("button", { name: RUN_LABEL }).click();

    // The walk, from the running engine: both of the decision's roads, and the loop's bound.
    const sheet = page.getByRole("complementary", { name: DRY_RUN_SHEET_TITLE });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".studio-dryrun__edge--taken").first()).toBeVisible();
    await expect(sheet.locator(".studio-dryrun__edge--skipped").first()).toBeVisible();
    await expect(sheet.locator(".studio-dryrun__loop").first()).toHaveText(/retry bound/);

    for (const palette of ["light", "dark"] as const) {
      await pinTheme(page, palette);

      for (const id of MOCKUP_ACTIVE_EDGES) {
        await expect(edgeLine(canvas, id), `${id} in ${palette}`).toHaveClass(
          /\bstudio-edge--active\b/,
        );
      }
      await expect(edgeLine(canvas, NOT_TAKEN_EDGE)).not.toHaveClass(/\bstudio-edge--active\b/);

      // The accent reaches the path in this palette: a walked edge is not stroked as the road not taken.
      const walked = await edgeLine(canvas, MOCKUP_ACTIVE_EDGES[0]).evaluate(
        (element) => getComputedStyle(element).stroke,
      );
      const skipped = await edgeLine(canvas, NOT_TAKEN_EDGE).evaluate(
        (element) => getComputedStyle(element).stroke,
      );
      expect(walked, `the active stroke in ${palette}`).not.toBe(skipped);
    }

    await stage(canvas, "plan").click();
    await page.keyboard.press("ArrowRight");

    await expect(sheet).toBeHidden();
    await expect(canvas.locator(".react-flow__edge-path.studio-edge--active")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ S.8: the frame, at parity */

test.describe("S.8: the studio's rail and inspector draw the seeded workspace", () => {
  test("the rail lists the five seeded workflows with their served captions, standard-fix lit", async ({
    context,
    page,
  }) => {
    await enterStudio(context, page);

    const items = rail(page).locator(".studio-rail__item");

    // Position by position: the order is P.4's `created_at`, and a second opinion about it would be a
    // rail two surfaces could disagree on.
    await expect(items).toHaveCount(SEEDED_RAIL.length);
    await expect(items.locator(".studio-rail__name")).toHaveText(
      SEEDED_RAIL.map((entry) => entry.name),
    );
    await expect(items.locator(".studio-rail__caption")).toHaveText(
      SEEDED_RAIL.map((entry) => entry.caption),
    );

    for (const [index, entry] of SEEDED_RAIL.entries()) {
      await expect(items.nth(index).locator(".studio-rail__dot"), entry.name).toHaveCount(
        entry.paused ? 1 : 0,
      );
    }

    await expect(rail(page).locator("[aria-current='page']")).toHaveCount(1);
    await expect(items.nth(0)).toHaveAttribute("aria-current", "page");

    // An owner's tile is live.
    await expect(rail(page).getByRole("button", { name: NEW_WORKFLOW_LABEL })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("the inspector opens on Implement with every field its schema draws, and its route's model", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);

    await select(page, canvas, SELECTED_STAGE);

    const panel = inspector(page);
    const expected = IMPLEMENT_INSPECTOR;

    await expect(panel.locator(".studio-inspector__type")).toContainText(expected.role);
    await expect(panel.getByRole("heading", { name: expected.title })).toBeVisible();
    await expect(panel.locator(".studio-inspector__description")).toHaveText(expected.description);

    // Mode and skill, then the template — each a value R.3's schema says how to draw.
    await expect(panel.getByRole("radio", { name: "Skill", exact: true })).toBeChecked();
    await expect(skillField(panel)).toHaveValue(expected.skill);
    await expect(panel.getByLabel("Prompt template", { exact: true })).toHaveValue(
      startingWith(expected.promptStart),
    );

    // The routing choice, and the model the inherited route resolves to on another service's read.
    await expect(panel.getByRole("radio", { name: expected.inherit })).toBeChecked();
    await expect(panel.getByLabel("Task", { exact: true })).toHaveValue(expected.task);
    await expect(panel.locator(".studio-inspector__model")).toHaveText(expected.model);

    await expect(panel.getByLabel("Max retries", { exact: true })).toHaveValue(expected.retries);
    await expect(panel.getByLabel("Token budget", { exact: true })).toHaveValue(expected.budget);

    for (const { name, on } of expected.permissions) {
      await expect(panel.getByRole("switch", { name }), name).toHaveAttribute(
        "aria-checked",
        String(on),
      );
    }

    // Untouched, **Apply** is in its place and says there is nothing to apply, rather than vanishing.
    const apply = panel.getByRole("button", { name: APPLY_LABEL, exact: true });
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await expect(apply).toHaveAttribute("title", CLEAN_REASON);
  });
});

/* ------------------------------------------------------------------ S.8: edit → apply */

test.describe("S.8: an edit in the inspector reaches the canvas, and the stored draft", () => {
  test.afterEach(async ({ context }) => {
    await restoreStandardFixDraft(context);
  });

  test("a skill typed in moves no chip until Apply, moves it after, and survives a reload", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page);
    const chips = stageChips(canvas, SELECTED_STAGE);

    await expect(chips).toHaveText([...IMPLEMENT_CHIPS]);
    await select(page, canvas, SELECTED_STAGE);

    const panel = inspector(page);
    await skillField(panel).fill(EDITED_SKILL);

    // Typed is not applied: the panel says so, and the canvas still draws the document.
    await expect(panel.locator(".studio-inspector__status")).toHaveText(DIRTY_NOTE);
    await expect(chips).toHaveText([...IMPLEMENT_CHIPS]);

    await panel.getByRole("button", { name: APPLY_LABEL, exact: true }).click();
    await expect(chips).toHaveText([...EDITED_CHIPS]);

    // Autosave's write, said by the toolbar and then proved by the service: a reload reads the draft
    // back from the database, so a chip that only ever lived in this page's state goes red here.
    await expect(canvas.locator(".studio-canvas__unsaved")).toHaveText(SAVED_NOTE);
    await page.reload();
    await expect(stageChips(await drawnCanvas(page), SELECTED_STAGE)).toHaveText([...EDITED_CHIPS]);
  });
});

/* ------------------------------------------------------------------ S.8: the publish gate */

test.describe("S.8: publishing refuses a sabotaged draft by its finding, and takes the repair", () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await sabotageDraft(context);
  });

  test.afterEach(async ({ context }) => {
    await restoreStandardFixDraft(context);
  });

  test("the unknown alias is named on Code the change, repaired in the inspector, and published as the next version", async ({
    page,
  }) => {
    await page.goto(STUDIO_PATH);

    const canvas = await drawnCanvas(page);
    const chips = stageChips(canvas, SABOTAGE.stage);

    // The sabotage reached the canvas, so what the gate refuses is the graph the reader is looking at.
    await expect(chips).toHaveText([IMPLEMENT_CHIPS[0], SABOTAGE.alias]);

    /* refused — by this graph's own finding, anchored to its stage */

    const refused = await openPublish(page);
    const version = publishedVersion(refused.label);

    await refused.dialog.getByRole("button", { name: refused.label, exact: true }).click();
    await expect(refused.dialog.getByRole("alert")).toHaveText(FINDINGS_MESSAGE);

    const findings = refused.dialog.getByRole("list", { name: FINDINGS_LABEL });
    await expect(findings.getByRole("listitem")).toHaveCount(1);

    const finding = findings.getByRole("button").filter({ hasText: SABOTAGE.message });
    await expect(finding).toContainText(`Select ${SABOTAGE.stageTitle}`);

    /* the finding takes the reader to the stage it is about */

    await finding.click();
    await expect(refused.dialog).toBeHidden();
    await expect(stage(canvas, SABOTAGE.stage)).toHaveClass(/\bselected\b/);

    const panel = inspector(page);
    await expect(panel.getByRole("heading", { name: SABOTAGE.stageTitle })).toBeVisible();

    /* repaired — the route inherited again, applied */

    await panel.getByRole("radio", { name: IMPLEMENT_INSPECTOR.inherit }).check();
    await panel.getByLabel("Task", { exact: true }).fill(IMPLEMENT_INSPECTOR.task);
    await panel.getByRole("button", { name: APPLY_LABEL, exact: true }).click();
    await expect(chips).toHaveText([...IMPLEMENT_CHIPS]);

    /* published — the same action, now green, and the version moves by exactly one */

    const repaired = await openPublish(page);
    expect(
      repaired.label,
      "a refused publish freezes nothing, so the next version is unchanged",
    ).toBe(refused.label);

    await repaired.dialog.getByLabel("Change note", { exact: true }).fill(REPAIR_NOTE);
    await repaired.dialog.getByRole("button", { name: repaired.label, exact: true }).click();
    await expectPublished(page, repaired.dialog, version);

    const next = `Publish v${version + 1}`;
    await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();

    // The service's number, not the session's: a fresh read counts from the version it stored.
    await page.reload();
    await drawnCanvas(page);
    await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ S.8: the member's studio */

test.describe("S.8: a member is served the studio read-only, and told why", () => {
  test("no Publish, every edit inert with its reason, and the service refuses the publish the page withholds", async ({
    context,
    page,
  }) => {
    const canvas = await enterStudio(context, page, SEED_MEMBER.id);

    await expect(page.getByRole("note").filter({ hasText: /^Viewing the studio as/ })).toHaveText(
      MEMBER_READ_ONLY_NOTE,
    );

    // Publishing is not drawn for a member at all — the note above is its reason — and a dry run,
    // which writes nothing, still is.
    await expect(page.getByRole("button", { name: PUBLISH_LABEL })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: DRY_RUN_LABEL, exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");

    const tile = rail(page).getByRole("button", { name: NEW_WORKFLOW_LABEL });
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await expect(tile).toHaveAttribute("title", MEMBER_CREATE_REASON);

    // The inspector: readable, every input inert, every foot control carrying the reason.
    await select(page, canvas, SELECTED_STAGE);

    const panel = inspector(page);
    await expect(skillField(panel)).toHaveValue(IMPLEMENT_INSPECTOR.skill);
    await expect(skillField(panel)).toBeDisabled();

    for (const name of [APPLY_LABEL, DELETE_STAGE_LABEL]) {
      const control = panel.getByRole("button", { name, exact: true });

      await expect(control, name).toHaveAttribute("aria-disabled", "true");
      await expect(control, name).toHaveAttribute("title", MEMBER_EDIT_REASON);
    }

    // The page withholds the action; the role gate is what enforces it.
    expect(await publishStatusFor(context), "the publish route's answer to a member").toBe(403);
  });
});

/* ------------------------------------------------------------------ S.8: the shell */

test.describe("S.8: the shell holds the studio", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterStudio(context, page);
  });

  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the chrome holds still, and the segmented control sticks to the pane, while the pane scrolls", async ({
    page,
  }) => {
    const pane = page.locator(PANE_SELECTOR);
    const before = await chromeBoxes(page);

    expect(before.header, "the shell's header is laid out").not.toBeNull();
    expect(before.sidebar, "the shell's sidebar is laid out").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the studio must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(await chromeBoxes(page)).toEqual(before);
    await expectDocumentUnscrolled(page);

    // The in-pane chrome owns the pane's top edge once the head has scrolled away.
    const paneBox = await pane.boundingBox();
    const subnavBox = await page
      .getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true })
      .boundingBox();

    expect(subnavBox, "the segmented control is laid out").not.toBeNull();
    expect(Math.round(subnavBox?.y ?? 0)).toBe(Math.round(paneBox?.y ?? 0));
  });

  test("the Workflows entry, the rail and the Visual tab all know where the reader is", async ({
    page,
  }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Workflows" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    await expect(
      page
        .getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true })
        .getByRole("link", { name: "Visual", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      rail(page).getByRole("link", { name: startingWith(SEEDED_RAIL[0].name) }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("the studio still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const canvas = await drawnCanvas(page);
    const html = page.locator("html");

    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // A canvas, a rail and an inspector side by side: wide content scrolls in its own wrapper, never
    // the pane (§ 1.3).
    await expectNoPaneHorizontalScroll(page);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(rail(page).locator(".studio-rail__item")).toHaveCount(SEEDED_RAIL.length);
    await expect(stageChips(canvas, SELECTED_STAGE)).toHaveText([...IMPLEMENT_CHIPS]);
  });
});
