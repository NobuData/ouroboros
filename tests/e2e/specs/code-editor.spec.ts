/**
 * Leg 13 — *mockup 05's editor, drawn in a browser*
 * ([#170](https://github.com/NobuData/ouroboros/issues/170), the code view's first leg; V.8,
 * [#176](https://github.com/NobuData/ouroboros/issues/176), extends it).
 *
 * `ouroboros-ui`'s suites prove the editor's structure — which CodeMirror parts each variant
 * mounts, which class each token of the DSL takes — and prove that the sheet puts each on a token
 * and re-colours every rule of CodeMirror's base theme. What none of them can prove is a pixel:
 * jsdom applies no stylesheet and paints nothing. The ticket's criteria are pictures and
 * browser facts — *mockup-parity coloring in both themes*, *no CodeMirror default styling is
 * visible*, *typing stays at 60fps*, *the content pane never scrolls horizontally because of
 * it* — so this leg opens the seeded `standard-fix` in the product and asks the browser.
 *
 * ## What it asserts
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
 * Nothing here writes: the save loop is V.4's ([#172](https://github.com/NobuData/ouroboros/issues/172)),
 * so typed text stays in the page and is gone at the next navigation.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  CARET_LINE,
  CODEMIRROR_DEFAULTS,
  CODE_PATH,
  CODE_TITLE,
  EDITOR_COLOURS,
  FILE_LABEL,
  FILE_PATH,
  FRAME_MS,
  READ_ONLY_NOTE,
  SAVE_NOTE,
  SYNTAX_SAMPLES,
} from "../support/code";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { PANE_SELECTOR } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The window the leg runs in: the shell beside a card wide enough for the file's long lines to overflow. */
const WINDOW = { width: 1440, height: 1000 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WINDOW);
});

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

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CODE_TITLE);

  const file = page.getByRole("region", { name: FILE_LABEL });

  await expect(file.locator(".code-editor .cm-editor")).toBeVisible();
  await expect(file.locator(".code-editor__static")).toBeHidden();
  await expect(file.locator(".code-editor__callee").first()).toBeVisible();

  return file;
}

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
