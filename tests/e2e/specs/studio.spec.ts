/**
 * Leg 12 — *mockup 04's canvas, drawn in a browser*
 * ([#149](https://github.com/NobuData/ouroboros/issues/149), the studio's first leg;
 * [#154](https://github.com/NobuData/ouroboros/issues/154) extends it).
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
 * ## What it asserts
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
 *     in both palettes.
 *
 * ## What it deliberately leaves to the legs after it
 *
 * The baselines show the page as the product serves it today: plain edges and the dashed loop,
 * with **no accent path**. The mockup's four accent edges are an execution path, and nothing on
 * the page draws one until S.6's dry run ([#152](https://github.com/NobuData/ouroboros/issues/152))
 * hands the canvas its `highlight_path`; `ouroboros-ui`'s suites exercise that mode with the
 * mockup's own path as a fixture. S.6 re-records this pair with the walk drawn. Editing, publish,
 * the member's read-only view and the font-scale check are S.8's.
 *
 * Nothing here writes: the leg reads the seeded workflow and selects a stage, which is the
 * browser's state and not the workspace's.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { PANE_SELECTOR } from "../support/shell";
import {
  ACCENT_DEEP,
  CANVAS_LABEL,
  LOOP_EDGE,
  SEEDED_LABELS,
  SEEDED_STAGES,
  SELECTED_STAGE,
  STUDIO_PATH,
  STUDIO_TITLE,
} from "../support/studio";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/**
 * Sign in, enter the seeded workspace, and open the studio on `standard-fix`.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @returns The canvas region, once every stage, edge and label has been drawn.
 */
async function enterStudio(context: BrowserContext, page: Page): Promise<Locator> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(STUDIO_PATH);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STUDIO_TITLE);

  const canvas = page.getByRole("region", { name: CANVAS_LABEL });

  // React Flow draws its nodes, measures them, then routes the edges between the measured
  // handles and lays the labels over them — so the labels are the last thing to arrive.
  await expect(canvas.locator(".react-flow__node")).toHaveCount(SEEDED_STAGES.length);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(12);
  await expect(canvas.locator(".studio-edge-label")).toHaveCount(SEEDED_LABELS.length);

  return canvas;
}

/** React Flow's wrapper for one stage. */
function stage(canvas: Locator, id: string): Locator {
  return canvas.locator(`.react-flow__node[data-id="${id}"]`);
}

/** The stage's own box inside the wrapper — where the treatment is. */
function stageBox(canvas: Locator, id: string): Locator {
  return stage(canvas, id).locator(".studio-node");
}

/** One edge's line. */
function edgeLine(canvas: Locator, id: string): Locator {
  return canvas.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
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
