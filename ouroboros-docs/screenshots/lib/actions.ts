import type { Page } from "@playwright/test";

import type { Action } from "./manifest.ts";

/**
 * Running a manifest entry's declarative steps (CZ.1, #1170) — the clicks, hovers, fills
 * and key presses that open a dialog or a menu before the capture.
 */

/** The part of Playwright's `Page` the steps use, so a test can hand in a fake. */
export type ActionPage = Pick<Page, "locator" | "keyboard">;

/**
 * Runs one step. Locators are taken `.first()`, so a selector that matches a list acts on
 * its first item rather than failing on ambiguity.
 *
 * @param page the page.
 * @param action the step.
 * @returns when the step is done.
 */
export async function runAction(page: ActionPage, action: Action): Promise<void> {
  if ("click" in action) return page.locator(action.click).first().click();
  if ("hover" in action) return page.locator(action.hover).first().hover();
  if ("fill" in action) return page.locator(action.fill).first().fill(action.value);
  if (action.on) return page.locator(action.on).first().press(action.press);
  return page.keyboard.press(action.press);
}

/**
 * Runs an entry's steps in order.
 *
 * @param page the page.
 * @param actions the steps; none when absent.
 * @returns when every step is done.
 */
export async function runActions(page: ActionPage, actions: readonly Action[] = []): Promise<void> {
  for (const action of actions) await runAction(page, action);
}
