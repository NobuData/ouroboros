/**
 * Leg 13 — *mockup 05's editor, drawn and driven in a browser*
 * ([#170](https://github.com/NobuData/ouroboros/issues/170), the code view's first leg; V.8,
 * [#176](https://github.com/NobuData/ouroboros/issues/176), the cross-editor round-trip).
 *
 * `ouroboros-ui`'s suites prove the editor's structure — which CodeMirror parts each variant
 * mounts, which class each token of the DSL takes — and prove that the sheet puts each on a token
 * and re-colours every rule of CodeMirror's base theme. What none of them can prove is a pixel:
 * jsdom applies no stylesheet and paints nothing. The ticket's criteria are pictures and
 * browser facts — *mockup-parity coloring in both themes*, *no CodeMirror default styling is
 * visible*, *typing stays at 60fps*, *the content pane never scrolls horizontally because of
 * it* — so this leg opens the seeded `standard-fix` in the product and asks the browser.
 *
 * ## What #170 asserts
 *
 *   * **the colours** — in each palette, each syntax class, the gutter, the current line, its
 *     number and inset, and the caret are that palette's token (`support/code.ts`), and neither
 *     CodeMirror's default gutter nor its default caret is;
 *   * **the read-only variant** — the seeded member gets the file with no caret, no current line
 *     and no editable region;
 *   * **containment** — a 500-character line scrolls the editor sideways and moves the pane not
 *     at all, and the editor stays inside the window;
 *   * **typing** — two hundred keystrokes mid-file, none of whose event handlers takes a frame;
 *   * **parity** — the editor with the caret on line 3, screenshot-diffed in both palettes.
 *
 * ## What V.8 adds, and why only a running stack can see it
 *
 * *Every graph compiles to this typed DSL and back, losslessly* spans the browser, `ouroboros-rest`,
 * the engine and the database. U.4's property tests prove the printer and the parser agree; only a
 * browser driving both editors proves that **an edit in one shows up in the other**, which is what a
 * reader experiences as the claim being true. So the leg drives it:
 *
 *   * **parity** — the file in the editor is U.1's golden listing, line for line, under mockup 05's
 *     head and over its status bar;
 *   * **the round-trip, both directions, in one test** — a token budget typed into the file is what
 *     the canvas's inspector shows, and a stage moved on the canvas is where the file's layout block
 *     puts it;
 *   * **the publish gate** — an unknown alias typed into the file is refused at **Publish** by its
 *     finding, which comes back into the code on *Implement*'s lines and puts the cursor on its call;
 *     the repair publishes, and the version moves by exactly one **in both editors**;
 *   * **a member's code view** — the note that says why, no **Publish**, the file read-only, and the
 *     service's own `403`;
 *   * **both palettes** — the whole workbench, screenshot-diffed;
 *   * **the shell** — fixed chrome over a scrolling pane, the Workflows entry and the Code tab lit,
 *     and the code view at the 125% font scale.
 *
 * ## What it writes, and what it puts back
 *
 * #170's cases write nothing: typed text stays in a page no save loop is waited on, and the next
 * navigation drops it.
 *
 * V.8's round-trip and publish cases write `standard-fix`'s draft — through the code view's autosave
 * and the canvas's — and put it back in teardown whether or not the test reached its end
 * (`restoreStandardFixDraft`). **The publish cannot be put back**, and needs no undoing, for the
 * studio leg's reason: the repair restores the one line the sabotage changed, so the version it
 * freezes is the seeded document, and nothing here writes the version number down.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  BUDGET_EDIT,
  CARET_LINE,
  CODEMIRROR_DEFAULTS,
  CODE_PATH,
  CODE_REPAIR_NOTE,
  CODE_SABOTAGE,
  CODE_SUBLINE,
  CODE_TAB,
  CODE_TITLE,
  DRAFT_LABEL,
  EDITOR_COLOURS,
  FILE_LABEL,
  FILE_PATH,
  FRAME_MS,
  MOVED_STAGE,
  PANEL_LABEL,
  READ_ONLY_NOTE,
  SAVE_NOTE,
  STATUS_BAR_LABEL,
  STATUS_RIGHT_AT_START,
  SYNCED_WORDS,
  SYNTAX_SAMPLES,
  VISUAL_TAB,
  goldenListing,
  layoutLine,
} from "../support/code";
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
  FINDINGS_LABEL,
  FINDINGS_MESSAGE,
  INSPECTOR_LABEL,
  MEMBER_READ_ONLY_NOTE,
  PUBLISH_LABEL,
  SABOTAGE,
  SAVED_NOTE,
  SEEDED_STAGES,
  STUDIO_PATH,
  STUDIO_SUBNAV_LABEL,
  STUDIO_TITLE,
  expectPublished,
  openPublish,
  publishStatusFor,
  publishedVersion,
  restoreStandardFixDraft,
} from "../support/studio";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The window the leg runs in: the shell beside a card wide enough for the file's long lines to overflow. */
const WINDOW = { width: 1440, height: 1000 };

/**
 * The window V.8's whole-file cases run in. CodeMirror draws only the lines near its viewport, and
 * the editor is bounded at 70vh, so a window this tall is what puts all 161 lines of the seeded file
 * — the layout block at its foot included — in the DOM at once, with no scrolling to arrange it.
 */
const WHOLE_FILE_WINDOW = { width: 1440, height: 4200 };

/**
 * The window the workbench pair is photographed through: tall enough that the head, the editor at
 * 70vh and the status bar sit inside it whole.
 */
const PARITY_WINDOW = { width: 1440, height: 1600 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WINDOW);
});

/* ------------------------------------------------------------------ getting there */

/**
 * Sign in as someone, enter the seeded workspace, and open the code view on `standard-fix`.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param userId - Who signs in.
 * @returns The file card, once CodeMirror has mounted and highlighted the file.
 */
async function enterCode(context: BrowserContext, page: Page, userId: string): Promise<Locator> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(CODE_PATH);

  return drawnFile(page);
}

/**
 * Wait for an open code view to have drawn its file — after a navigation, a reload or a tab switch.
 *
 * @param page - The page, on {@link CODE_PATH}.
 * @returns The file card, once CodeMirror has mounted and highlighted the file.
 */
async function drawnFile(page: Page): Promise<Locator> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CODE_TITLE);

  const file = page.getByRole("region", { name: FILE_LABEL });

  await expect(file.locator(".code-editor .cm-editor")).toBeVisible();
  await expect(file.locator(".code-editor__static")).toBeHidden();
  await expect(file.locator(".code-editor__callee").first()).toBeVisible();

  return file;
}

/**
 * Wait for an open studio page to have drawn its canvas — the other editor, reached by its tab.
 *
 * @param page - The page, on {@link STUDIO_PATH}.
 * @returns The canvas's stage wrappers, once every stage has been drawn.
 */
async function drawnStages(page: Page): Promise<Locator> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STUDIO_TITLE);

  const stages = page.locator(".react-flow__node");
  await expect(stages).toHaveCount(SEEDED_STAGES.length);

  return stages;
}

/**
 * Press one of the segmented control's live segments — the switch a reader makes between editors.
 *
 * @param page - The page, on either editor.
 * @param tab - {@link VISUAL_TAB} or {@link CODE_TAB}.
 */
async function switchTo(page: Page, tab: string): Promise<void> {
  await page
    .getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true })
    .getByRole("link", { name: tab, exact: true })
    .click();
}

/* ------------------------------------------------------------------ the file, as a reader finds it */

/**
 * Put the caret at the end of one line, by keyboard, and take the pointer off the editor.
 *
 * @param page - The page.
 * @param file - The file card.
 * @param line - The 1-based line.
 */
async function caretOn(page: Page, file: Locator, line: number): Promise<void> {
  await file.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let step = 1; step < line; step += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.mouse.move(0, 0);
  await expect(file.locator(".cm-activeLineGutter")).toHaveText(String(line));
}

/**
 * The editor's lines that contain this text.
 *
 * @param file - The file card.
 * @param text - The text, matched as a substring of the line.
 * @returns The lines.
 */
function codeLine(file: Locator, text: string): Locator {
  return file.locator(".cm-content .cm-line").filter({ hasText: text });
}

/**
 * Replace one line of the file the way a reader does: click it, select it from the end back to its
 * indentation, and type its replacement.
 *
 * `insertText` rather than `type`, so the replacement arrives as one input — the text a reader pastes
 * — and no key handler gets to interpret a bracket or a quote on the way in.
 *
 * @param page - The page.
 * @param file - The file card.
 * @param before - The line's text, which must be on exactly one line.
 * @param after - What the line must read instead, indentation aside.
 */
async function replaceLine(
  page: Page,
  file: Locator,
  before: string,
  after: string,
): Promise<void> {
  const line = codeLine(file, before);

  await expect(line, `"${before}" is one line of the file`).toHaveCount(1);
  await line.click();
  await page.keyboard.press("End");
  // CodeMirror's Shift+Home stops at the line's indentation, so the indentation is kept.
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText(after);

  await expect(codeLine(file, after)).toHaveCount(1);
}

/**
 * Where React Flow has put a stage, as its wrapper's transform says.
 *
 * @param stage - The stage's wrapper.
 * @returns Its position in canvas coordinates.
 * @throws {Error} If the wrapper carries no `translate(…)`.
 */
async function stagePosition(stage: Locator): Promise<{ x: number; y: number }> {
  const transform = await stage.evaluate((element) => (element as HTMLElement).style.transform);
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);

  if (match === null) throw new Error(`the stage's transform "${transform}" is not a translate`);

  return { x: Number(match[1]), y: Number(match[2]) };
}

/* ------------------------------------------------------------------ #170: the editor's language */

test.describe("the code editor is drawn in both palettes", () => {
  test("every colour is the palette's token, and none is CodeMirror's", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);

    await caretOn(page, file, CARET_LINE);

    for (const theme of THEMES) {
      await pinTheme(page, theme);

      for (const { className, text, colour } of SYNTAX_SAMPLES) {
        const token = file.locator(`.cm-content .${className}`, { hasText: text }).first();
        await expect(token, `${className} in ${theme}`).toHaveCSS(
          "color",
          EDITOR_COLOURS[colour][theme],
        );
      }

      const gutters = file.locator(".cm-gutters");
      await expect(gutters).toHaveCSS("background-color", EDITOR_COLOURS.inset[theme]);
      await expect(gutters).toHaveCSS("color", EDITOR_COLOURS.inkFaint[theme]);
      expect(CODEMIRROR_DEFAULTS.gutter).not.toContain(
        await gutters.evaluate((element) => getComputedStyle(element).backgroundColor),
      );

      await expect(file.locator(".cm-activeLine")).toHaveCSS(
        "background-color",
        EDITOR_COLOURS.accentTint[theme],
      );

      const current = file.locator(".cm-activeLineGutter");
      await expect(current).toHaveCSS("color", EDITOR_COLOURS.accent[theme]);
      await expect(current).toHaveCSS(
        "box-shadow",
        `${EDITOR_COLOURS.accentDeep[theme]} 2px 0px 0px 0px inset`,
      );

      const caret = file.locator(".cm-cursor").first();
      await expect(caret).toHaveCSS("border-left-color", EDITOR_COLOURS.accent[theme]);
      await expect(caret).toHaveCSS("border-left-width", "2px");
      await expect(caret).toHaveCSS("box-shadow", /0px 0px 6px 0px/);
      expect(CODEMIRROR_DEFAULTS.caret).not.toContain(
        await caret.evaluate((element) => getComputedStyle(element).borderLeftColor),
      );
    }
  });

  test("light and dark are both mockup 05's editor, with the caret on line 3", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);
    const editor = file.locator(".code-editor");

    await expect(file).toContainText(SAVE_NOTE);
    await caretOn(page, file, CARET_LINE);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      // The caret's blink is an animation, which the shutter holds still.
      await expect(editor).toHaveScreenshot(`code-editor-${theme}.png`);
    }
  });
});

test.describe("the code editor's variants and containment", () => {
  test("a member is served the read-only variant, with no edit affordance", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_MEMBER.id);
    const content = file.getByRole("textbox", { name: FILE_PATH });

    await expect(file).toContainText(READ_ONLY_NOTE);
    await expect(file.locator(".code-editor")).toHaveClass(/\bcode-editor--read-only\b/);
    await expect(content).toHaveAttribute("contenteditable", "false");
    await expect(content).toHaveAttribute("aria-readonly", "true");

    await content.focus();
    await page.keyboard.type("typed");

    await expect(file.locator(".cm-cursor")).toHaveCount(0);
    await expect(file.locator(".cm-activeLine")).toHaveCount(0);
    await expect(content).not.toContainText("typed");
  });

  test("a long line scrolls the editor, never the pane, and the editor fits the window", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);

    await caretOn(page, file, CARET_LINE);
    await page.keyboard.type("x".repeat(500));

    const scroller = file.locator(".cm-scroller");
    const overflow = await scroller.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow, "the editor scrolls sideways").toBeGreaterThan(0);

    const pane = page.locator(PANE_SELECTOR);
    expect(await pane.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    const box = await file.locator(".cm-editor").boundingBox();
    expect(box, "the editor is laid out").not.toBeNull();
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(WINDOW.height);
  });

  test("typing on the seeded file never spends a frame in the key handlers", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);

    await caretOn(page, file, 24);

    // The Event Timing API reports every input event slower than its threshold, with how long its
    // handlers ran: the part of *60fps* that is the editor's rather than the machine's.
    await page.evaluate(() => {
      const slow: number[] = [];
      (window as unknown as { __keyCosts: number[] }).__keyCosts = slow;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          if (["keydown", "keypress", "beforeinput", "input", "keyup"].includes(entry.name)) {
            slow.push(entry.processingEnd - entry.processingStart);
          }
        }
      }).observe({
        type: "event",
        durationThreshold: 16,
        buffered: false,
      } as PerformanceObserverInit);
    });

    await page.keyboard.type("y".repeat(200), { delay: 25 });
    await expect(file.locator(".cm-activeLine")).toContainText("y".repeat(200));

    const costs = await page.evaluate(
      () => (window as unknown as { __keyCosts: number[] }).__keyCosts,
    );
    expect(costs.filter((cost) => cost >= FRAME_MS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ V.8: parity */

test.describe("V.8: the code view prints the seeded workflow as the golden listing", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WHOLE_FILE_WINDOW);
  });

  test("the file is U.1's golden listing line for line, under mockup 05's head and over its status bar", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);
    const golden = goldenListing();

    await expect(page.getByText(CODE_SUBLINE, { exact: true })).toBeVisible();

    // Exactly, whitespace and all: a projection that reindented a line, dropped the layout block or
    // lost the trailing newline is not the file the parser reads back.
    await expect
      .poll(() =>
        file
          .locator(".cm-content")
          .evaluate((content) =>
            Array.from(content.querySelectorAll(":scope > .cm-line"), (line) => line.textContent),
          ),
      )
      .toEqual(golden);
    await expect(file.locator(".cm-lineNumbers .cm-gutterElement").last()).toHaveText(
      String(golden.length),
    );

    const status = file.getByRole("group", { name: STATUS_BAR_LABEL });
    await expect(status.locator(".code-status__sync")).toContainText(SYNCED_WORDS);
    await expect(status.locator(".code-status__sync")).toHaveClass(/\bcode-status__sync--synced\b/);
    await expect(status.locator(".code-status__draft")).toHaveText(DRAFT_LABEL);
    await expect(status.locator(".code-status__right")).toHaveText(STATUS_RIGHT_AT_START);

    await expect(page.getByRole("complementary", { name: PANEL_LABEL })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ V.8: the round-trip */

test.describe("V.8: an edit in either editor is what the other one shows", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WHOLE_FILE_WINDOW);
  });

  test.afterEach(async ({ context }) => {
    await restoreStandardFixDraft(context);
  });

  test("code → visual: a budget typed in the file is the inspector's; visual → code: a stage moved on the canvas is the file's", async ({
    context,
    page,
  }) => {
    /* code → visual */

    const file = await enterCode(context, page, SEED_OWNER.id);

    await replaceLine(page, file, BUDGET_EDIT.before, BUDGET_EDIT.after);

    // Autosave's write, said by the file card; until it lands the other editor would read the seed.
    await expect(file).toContainText(SAVED_NOTE);
    await expect(file.getByRole("group", { name: STATUS_BAR_LABEL })).toContainText(SYNCED_WORDS);

    await switchTo(page, VISUAL_TAB);
    await expect(page).toHaveURL(STUDIO_PATH);

    const stages = await drawnStages(page);
    const moved = stages.and(page.locator(`[data-id="${MOVED_STAGE.id}"]`));

    await moved.click();
    await page.mouse.move(0, 0);

    const panel = page.getByRole("complementary", { name: INSPECTOR_LABEL, exact: true });
    await expect(panel.getByLabel("Token budget", { exact: true })).toHaveValue(
      BUDGET_EDIT.inspector,
    );

    /* visual → code */

    // Where the canvas opens the stage is where the file's layout block put it — the seed's place.
    expect(await stagePosition(moved)).toEqual({ x: MOVED_STAGE.x, y: MOVED_STAGE.y });

    // A keyboard nudge of the selected stage: a settled move, which the canvas saves.
    await moved.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await stagePosition(moved)).x).not.toBe(MOVED_STAGE.x);

    const target = await stagePosition(moved);
    await expect(page.locator(".studio-canvas__unsaved")).toHaveText(SAVED_NOTE);

    await switchTo(page, CODE_TAB);
    await expect(page).toHaveURL(CODE_PATH);

    const reread = await drawnFile(page);

    await expect(
      codeLine(reread, layoutLine(MOVED_STAGE.id, Math.round(target.x), Math.round(target.y))),
      "the file's layout block puts the stage where the canvas left it",
    ).toHaveCount(1);
    await expect(
      codeLine(reread, layoutLine(MOVED_STAGE.id, MOVED_STAGE.x, MOVED_STAGE.y)),
    ).toHaveCount(0);

    // And the code → visual edit survived the canvas's own write of the draft.
    await expect(codeLine(reread, BUDGET_EDIT.after)).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ V.8: the publish gate */

test.describe("V.8: publishing from code refuses a sabotaged file by its finding, and takes the repair", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WHOLE_FILE_WINDOW);
  });

  test.afterEach(async ({ context }) => {
    await restoreStandardFixDraft(context);
  });

  test("the unknown alias is marked on Implement's lines, repaired in the file, and published as the next version in both editors", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);
    const status = file.getByRole("group", { name: STATUS_BAR_LABEL });

    // A draft accepts the unknown alias (decision P7 makes it a warning while editing), so it saves.
    await replaceLine(page, file, CODE_SABOTAGE.seeded, CODE_SABOTAGE.sabotaged);
    await expect(file).toContainText(SAVED_NOTE);

    /* refused — by this file's own finding */

    const refused = await openPublish(page);
    const version = publishedVersion(refused.label);

    await refused.dialog.getByRole("button", { name: refused.label, exact: true }).click();
    await expect(refused.dialog.getByRole("alert")).toHaveText(FINDINGS_MESSAGE);

    const findings = refused.dialog.getByRole("list", { name: FINDINGS_LABEL });
    await expect(findings.getByRole("listitem")).toHaveCount(1);

    // The code view anchors by the file's stage ids, so the control names the stage by its id.
    const finding = findings.getByRole("button").filter({ hasText: SABOTAGE.message });
    await expect(finding).toContainText(`Select ${SABOTAGE.stage}`);

    /* anchored — the finding comes back into the code, on its stage's lines and nowhere else */

    await finding.click();
    await expect(refused.dialog).toBeHidden();
    await expect(status.locator(".code-status__right")).toContainText(
      `Ln ${CODE_SABOTAGE.stageLine}, Col 1`,
    );

    await expect(
      codeLine(file, CODE_SABOTAGE.sabotaged).locator(".cm-lintRange-error").first(),
    ).toBeVisible();
    await expect(
      codeLine(file, CODE_SABOTAGE.elsewhere).locator(".cm-lintRange-error"),
    ).toHaveCount(0);

    /* repaired — the route inherited again, typed; Publish writes what is waiting before it asks */

    await replaceLine(page, file, CODE_SABOTAGE.sabotaged, CODE_SABOTAGE.seeded);

    const repaired = await openPublish(page);
    expect(
      repaired.label,
      "a refused publish freezes nothing, so the next version is unchanged",
    ).toBe(refused.label);

    await repaired.dialog.getByLabel("Change note", { exact: true }).fill(CODE_REPAIR_NOTE);
    await repaired.dialog.getByRole("button", { name: repaired.label, exact: true }).click();
    await expectPublished(page, repaired.dialog, version);

    /* the version moved by exactly one — in the code view, then the service's read, then Visual's */

    const next = `Publish v${version + 1}`;
    await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();

    await page.reload();
    await drawnFile(page);
    await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();

    await switchTo(page, VISUAL_TAB);
    await drawnStages(page);
    await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: PUBLISH_LABEL })).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ V.8: the member's code view */

test.describe("V.8: a member is served the code view read-only, and told why", () => {
  test("the note, no Publish, a file nobody can type into, and the service refusing the publish the page withholds", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_MEMBER.id);

    await expect(page.getByRole("note").filter({ hasText: /^Viewing the studio as/ })).toHaveText(
      MEMBER_READ_ONLY_NOTE,
    );

    // Publishing is not drawn for a member at all; Validate, which publishes nothing, still is.
    await expect(page.getByRole("button", { name: PUBLISH_LABEL })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Validate", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // Readable — the file, its checks and outline — and nothing to type into.
    await expect(file).toContainText(READ_ONLY_NOTE);
    await expect(file.getByRole("textbox", { name: FILE_PATH })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(page.getByRole("complementary", { name: PANEL_LABEL })).toBeVisible();

    // The page withholds the action; the role gate is what enforces it.
    expect(await publishStatusFor(context), "the publish route's answer to a member").toBe(403);
  });
});

/* ------------------------------------------------------------------ V.8: both palettes */

test.describe("V.8: the code view's workbench is drawn in both palettes", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PARITY_WINDOW);
  });

  test("light and dark are both mockup 05's workbench — explorer, tabs, editor, checks and status bar", async ({
    context,
    page,
  }) => {
    const file = await enterCode(context, page, SEED_OWNER.id);

    await expect(file).toContainText(SAVE_NOTE);
    await page.mouse.move(0, 0);

    const frame = await file.boundingBox();
    expect(frame, "the workbench is laid out").not.toBeNull();
    expect(
      (frame?.y ?? 0) + (frame?.height ?? 0),
      "the workbench fits the parity window",
    ).toBeLessThanOrEqual(PARITY_WINDOW.height);

    // `v15 draft` on a cold stack and one more for every green publish since: masked, not recorded.
    const draft = file.locator(".code-status__draft");

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(file).toHaveScreenshot(`code-workbench-${theme}.png`, { mask: [draft] });
    }
  });
});

/* ------------------------------------------------------------------ V.8: the shell */

test.describe("V.8: the shell holds the code view", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterCode(context, page, SEED_OWNER.id);
  });

  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the chrome holds still while the pane scrolls", async ({ page }) => {
    const pane = page.locator(PANE_SELECTOR);
    const before = await chromeBoxes(page);

    expect(before.header, "the shell's header is laid out").not.toBeNull();
    expect(before.sidebar, "the shell's sidebar is laid out").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the code view must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(await chromeBoxes(page)).toEqual(before);
    await expectDocumentUnscrolled(page);
  });

  test("the Workflows entry and the Code tab both know where the reader is", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Workflows" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    const subnav = page.getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true });
    await expect(subnav.getByRole("link", { name: CODE_TAB, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(subnav.locator("[aria-current='page']")).toHaveCount(1);
  });

  test("the code view still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const file = await drawnFile(page);
    const html = page.locator("html");

    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // An explorer, an editor and a panel side by side: wide content scrolls in its own wrapper, never
    // the pane (§ 1.3).
    await expectNoPaneHorizontalScroll(page);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(file.getByRole("group", { name: STATUS_BAR_LABEL })).toContainText(SYNCED_WORDS);
  });
});
