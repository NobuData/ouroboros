import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, type Page } from "@playwright/test";

import { runActions } from "./lib/actions.ts";
import { optimiseCapture } from "./lib/image.ts";
import {
  captureInstant,
  loadManifest,
  outputPath,
  readyTimeoutMessage,
  selectEntries,
  type Entry,
  type Theme,
} from "./lib/manifest.ts";
import { ONLY_ENV, READY_TIMEOUT_MS, RESULTS_ENV } from "./settings.ts";

/**
 * One test per selected manifest entry, run once per theme project (CZ.1, #1170). A failing
 * entry fails its own test only, so the rest are still captured and the run exits non-zero.
 */

/** Stops everything that moves: animations, transitions, the caret, smooth scrolling. */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

const manifest = loadManifest();
const entries = selectEntries(manifest, process.env[ONLY_ENV] || undefined);
const instant = captureInstant(manifest);

/**
 * Makes the entry's workspace the session's active one — the route the UI's own workspace
 * switcher calls.
 *
 * @param page the page whose session to move.
 * @param entry the entry.
 * @throws {Error} naming the workspace when the switch is refused.
 */
async function enterWorkspace(page: Page, entry: Entry): Promise<void> {
  const response = await page.request.post("/api/auth/organization/set-active", {
    data: { organizationSlug: entry.workspace },
  });
  if (!response.ok()) {
    throw new Error(
      `${entry.id}: switching to workspace ${entry.workspace} answered ${response.status()}: ` +
        `${await response.text()}`,
    );
  }
}

/**
 * Loads every image on the page before the capture: lazy images (`loading="lazy"`) are
 * switched to eager, and the capture waits until each has loaded or failed. Without this a
 * below-the-fold or freshly revealed image is sometimes still blank when the shot is taken,
 * and two runs of the same entry differ.
 *
 * @param page the page, ready.
 * @param entry the entry, for the failure message.
 * @throws {Error} naming the entry when the images have not settled in time.
 */
async function settleImages(page: Page, entry: Entry): Promise<void> {
  try {
    await page.evaluate(async (timeoutMs) => {
      const images = Array.from(document.images);
      for (const image of images) image.loading = "eager";
      const settled = images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
      );
      await Promise.race([
        Promise.all(settled),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
    }, READY_TIMEOUT_MS);
  } catch {
    throw new Error(`${entry.id}: images on ${entry.route} did not finish loading`);
  }
}

/**
 * Takes the raw capture: the viewport, the full page, or one element.
 *
 * @param page the page, ready.
 * @param entry the entry.
 * @returns Playwright's PNG at device scale 2.
 */
async function shoot(page: Page, entry: Entry): Promise<Buffer> {
  // Masks are painted in the app's own raised surface colour, read from its tokens, so a
  // hidden region looks like an empty card rather than a block of Playwright's magenta.
  const maskColor = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--raised").trim(),
  );
  const options = {
    animations: "disabled" as const,
    caret: "hide" as const,
    mask: (entry.masks ?? []).map((selector) => page.locator(selector)),
    ...(maskColor ? { maskColor } : {}),
  };
  if (entry.clip === "page") return page.screenshot(options);
  if (entry.clip === "fullPage") return page.screenshot({ ...options, fullPage: true });
  return page.locator(entry.clip).first().screenshot(options);
}

for (const entry of entries) {
  test(entry.id, async ({ page }, info) => {
    const theme = info.project.name as Theme;

    await page.clock.setFixedTime(instant);
    await enterWorkspace(page, entry);

    const response = await page.goto(entry.route);
    if (response && response.status() >= 400) {
      throw new Error(`${entry.id}: ${entry.route} answered ${response.status()}`);
    }
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error(
        `${entry.id}: ${entry.route} redirected to sign-in — the session was refused`,
      );
    }

    await page.addStyleTag({ content: FREEZE_CSS });
    await runActions(page, entry.actions);

    try {
      await page
        .locator(entry.ready)
        .first()
        .waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    } catch {
      throw new Error(readyTimeoutMessage(entry, theme, READY_TIMEOUT_MS));
    }
    await page.evaluate(() => document.fonts.ready);
    await settleImages(page, entry);

    const file = outputPath(entry.id, theme);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await optimiseCapture(await shoot(page, entry)));

    const results = process.env[RESULTS_ENV];
    if (results) appendFileSync(results, `${JSON.stringify({ id: entry.id, theme })}\n`);
  });
}
