/**
 * The weekly Insights digest, rendered the way a mail client would
 * ([#440](https://github.com/NobuData/ouroboros/issues/440), BJ.4) — see
 * `playwright.email.config.ts` for the four profiles and for why this needs no stack.
 *
 * The documents under test are **the renderer's own output**: `digest.golden.json` is written
 * by ouroboros-rest's `digest.render.spec.ts` from the code that sends the mail, and that suite
 * fails when the renderer and the file disagree. So a baseline here is a picture of what is
 * actually sent, in each of the digest's four states:
 *
 *   * `priced` — a week with priced usage;
 *   * `partly-priced` — some tokens have no price, and the cost line says so;
 *   * `unpriced` — no price at all: tokens, and no dollar figure anywhere;
 *   * `empty` — nothing happened, and the mail says that instead of printing zeroes.
 *
 * Besides the pictures, each profile asserts what a picture cannot fail loudly on: nothing
 * overflows sideways, the mail stays light under a dark colour scheme, and nothing is fetched.
 *
 * **One thing is pinned for the camera: the font.** The mail asks for the reader's system font,
 * which is a different font on every machine, so a baseline of it would be a baseline of the
 * machine. The spec draws the text in Liberation Sans — installed with Playwright's Chromium —
 * so the same pixels come out here and in CI. The layout under test is unchanged.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test as base } from "@playwright/test";

import type { ClientProfile } from "../playwright.email.config";

const test = base.extend<ClientProfile>({ stripStyles: [false, { option: true }] });

/** ouroboros-rest's golden renders: `{cases: {<state>: {subject, html, text}}}`. */
const GOLDEN = resolve(
  __dirname,
  "../../../ouroboros-rest/src/modules/insights/digest/digest.golden.json",
);

/** The design tokens the mail's palette is written out from. */
const TOKENS = resolve(__dirname, "../../../docs/design/tokens.css");

interface Rendered {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const CASES = (JSON.parse(readFileSync(GOLDEN, "utf8")) as { cases: Record<string, Rendered> })
  .cases;

/** The four states the renderer's suite records, in its order. */
const STATES = ["priced", "partly-priced", "unpriced", "empty"] as const;

/** The font the baselines are drawn in — see the header. */
const CAMERA_FONT = `* { font-family: "Liberation Sans" !important; }`;

/** The light ground, as a browser reports a computed colour. */
const LIGHT_GROUND = "rgb(245, 248, 250)";

/**
 * A document as a client that removes `<style>` blocks would show it.
 *
 * @param html - The HTML part.
 * @returns The same document with every `<style>` element gone.
 */
function withoutStyleBlocks(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "");
}

/**
 * The light palette of the token sheet: the first `:root` block's hex colours.
 *
 * @returns Every hex value a light token holds, lower-case.
 */
function lightTokens(): Set<string> {
  const sheet = readFileSync(TOKENS, "utf8");
  const start = sheet.indexOf(":root {");
  const block = sheet.slice(start, sheet.indexOf("\n}", start));

  return new Set(
    [...block.matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{6})\b/g)].map(([, hex]) => hex.toLowerCase()),
  );
}

test("the golden file holds the four states this suite photographs", () => {
  expect(Object.keys(CASES)).toEqual([...STATES]);
});

test("every colour in the mail is a light design token", () => {
  const tokens = lightTokens();

  // The sheet was read, and it is the light block: its ground is the mail's ground.
  expect(tokens.has("#f5f8fa")).toBe(true);
  expect(tokens.has("#12181d")).toBe(false);

  for (const state of STATES) {
    const colours = [...CASES[state].html.matchAll(/(?::\s*|solid )(#[0-9a-fA-F]{6})\b/g)].map(
      ([, hex]) => hex.toLowerCase(),
    );

    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter((hex) => !tokens.has(hex))).toEqual([]);
  }
});

for (const state of STATES) {
  test(`the ${state} digest renders under this client profile`, async ({ page, stripStyles }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    const { html } = CASES[state];
    await page.setContent(stripStyles ? withoutStyleBlocks(html) : html);
    await page.addStyleTag({ content: CAMERA_FONT });
    await page.evaluate(() => document.fonts.ready);

    // The headline is there, and so is the way to the page.
    await expect(page.getByRole("link", { name: "Open Insights" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Unsubscribe" })).toBeVisible();

    // Nothing is wider than the client's pane: no sideways scroll, on a phone least of all.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    // The mail declares itself light, so a dark-mode client leaves it as drawn.
    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(ground).toBe(LIGHT_GROUND);

    // A mail that fetches nothing cannot be broken by a client that blocks remote content.
    expect(requests.filter((url) => !url.startsWith("about:"))).toEqual([]);

    await expect(page).toHaveScreenshot(`digest-${state}.png`, { fullPage: true });
  });
}

test("an unpriced digest shows no dollar sign in any profile", async ({ page, stripStyles }) => {
  const { html } = CASES.unpriced;

  await page.setContent(stripStyles ? withoutStyleBlocks(html) : html);

  await expect(page.locator("body")).not.toContainText("$");
  await expect(page.locator("body")).toContainText("Tokens per merged PR");
  await expect(page.locator("body")).toContainText("there is no dollar figure");
});

test("an empty digest shows its one sentence and no table of figures", async ({ page }) => {
  await page.setContent(CASES.empty.html);

  await expect(page.locator("body")).toContainText("Nothing to report this week.");
  await expect(page.locator("body")).not.toContainText("Autonomous merge rate");
});
