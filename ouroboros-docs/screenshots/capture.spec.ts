import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, type Locator, type Page } from "@playwright/test";

import { runActions } from "./lib/actions.ts";
import { optimiseCapture } from "./lib/image.ts";
import {
  captureInstant,
  loadManifest,
  outputPath,
  readyTimeoutMessage,
  selectEntries,
  signInRedirectError,
  type Entry,
  type Theme,
} from "./lib/manifest.ts";
import { CAPTURE_USER, ONLY_ENV, READY_TIMEOUT_MS, RESULTS_ENV } from "./settings.ts";

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
/**
 * Signs this capture in as another seeded person — every seeded account shares the capture
 * user's password. Each test has its own context, so no other capture's session moves.
 *
 * @param page the page whose session to replace.
 * @param entry the entry, naming the person in `as`.
 * @throws {Error} naming the person when the sign-in is refused.
 */
async function signInAs(page: Page, entry: Entry): Promise<void> {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: entry.as, password: CAPTURE_USER.password },
  });
  if (!response.ok()) {
    throw new Error(
      `${entry.id}: sign-in as ${String(entry.as)} answered ${response.status()}: ` +
        `${await response.text()}`,
    );
  }
}

async function enterWorkspace(page: Page, entry: Entry): Promise<void> {
  if (!entry.workspace) throw new Error(`${entry.id}: names no workspace`);
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
  const target = page.locator(entry.clip).first();
  const restore = await fitViewport(page, target);
  try {
    return await target.screenshot(options);
  } finally {
    await restore();
  }
}

/** How far apart the two looks that call a page's scrolling settled are. */
const SCROLL_SETTLE_POLL_MS = 150;

/** How long a capture with actions waits for the page to go quiet before the first one. */
const HYDRATION_WAIT_MS = 5_000;

/** The most a page pins over its pane's top edge: the sub-navigation row and a sticky bar under it. */
const PINNED_ALLOWANCE_PX = 96;

/**
 * Makes room for an element taller than the pane it scrolls in, for the length of one capture.
 *
 * The app scrolls inside its content pane, not the document, so Playwright cannot stitch a tall
 * element: the part below the fold comes out as a blank band with the shell's header drawn
 * across it. Growing the window lets the pane lay the whole element out; the width, and so the
 * layout, is unchanged.
 *
 * @param page the page.
 * @param target the element about to be captured.
 * @returns a function that puts the viewport back.
 */
async function fitViewport(page: Page, target: Locator): Promise<() => Promise<void>> {
  const viewport = page.viewportSize();
  const box = await target.boundingBox();
  if (!viewport || !box) return async () => {};

  // What the element has to fit in is the pane it scrolls in, less what is pinned over the pane's
  // top edge — not the window, part of which is the shell's header.
  const room = await target.evaluate((element, pinned) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return node.clientHeight - pinned;
    }
    return window.innerHeight;
  }, PINNED_ALLOWANCE_PX);
  if (box.height <= Math.min(viewport.height, room)) return async () => {};

  // The element's own height plus one window: whatever sits above it in the pane still fits.
  await page.setViewportSize({
    width: viewport.width,
    height: Math.ceil(box.height) + viewport.height,
  });
  await target.scrollIntoViewIfNeeded();
  return () => page.setViewportSize(viewport);
}

/**
 * Waits until nothing on the page is still scrolling.
 *
 * Chromium animates a scroll made from the keyboard, so a capture taken straight after a `press`
 * catches the scroller part-way — and at a different offset in each theme's run.
 *
 * @param page the page.
 * @returns when two looks in a row found every scroll position where the last one left it.
 */
async function settleScroll(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const held = window as unknown as { ouroScrollSeen?: string };
      const seen = [...document.querySelectorAll("*")].map((element) => element.scrollTop).join(",");
      const still = held.ouroScrollSeen === seen;

      held.ouroScrollSeen = seen;
      return still;
    },
    undefined,
    { polling: SCROLL_SETTLE_POLL_MS },
  );
}

for (const entry of entries) {
  test(entry.id, async ({ page }, info) => {
    const theme = info.project.name as Theme;

    await page.clock.setFixedTime(instant);
    // Each test has its own context, so clearing its cookies signs out this capture only.
    if (entry.signedOut) await page.context().clearCookies();
    else {
      if (entry.as) await signInAs(page, entry);
      // A held person belongs to no workspace, so there is none to enter.
      if (!entry.held) await enterWorkspace(page, entry);
    }

    const response = await page.goto(entry.route);
    if (response && response.status() >= 400) {
      throw new Error(`${entry.id}: ${entry.route} answered ${response.status()}`);
    }
    const redirected = signInRedirectError(entry, new URL(page.url()).pathname);
    if (redirected) throw new Error(redirected);

    await page.addStyleTag({ content: FREEZE_CSS });
    // An action on a page that has not hydrated yet races the page's own first effects — a card
    // that scrolls itself to its end on mount undoes a key pressed before it. Bounded, because a
    // page that polls or holds a stream open is never idle.
    if (entry.actions?.length) {
      await page.waitForLoadState("networkidle", { timeout: HYDRATION_WAIT_MS }).catch(() => {});
    }
    await runActions(page, entry.actions);
    if (entry.actions?.length) await settleScroll(page);

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
