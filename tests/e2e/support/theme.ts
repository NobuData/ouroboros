/**
 * Pinning a palette, through the control a reader would use.
 *
 * Three legs now stamp a theme before they measure or photograph something — the
 * dashboard's screenshot pair ([#88](https://github.com/NobuData/ouroboros/issues/88)),
 * the shell's fixed-chrome measurement
 * ([#647](https://github.com/NobuData/ouroboros/issues/647)) and the readability matrix
 * ([#650](https://github.com/NobuData/ouroboros/issues/650)) — and each had grown its own
 * copy of the same eight lines. One copy, here, because the interesting part is not the
 * clicking: it is the two decisions the clicking encodes, and a decision restated three
 * times is a decision that will shortly be made three different ways.
 *
 * ### Through the menu, not through `localStorage`
 *
 * `app/theme.ts` mirrors the choice into storage and an init script stamps it before
 * paint, so a leg *could* seed the key and skip the menu. It would then be asserting
 * against a palette no reader can reach — the same trap `support/settings.ts` describes
 * for the font scale. The account menu's radios (`app/shell/user-menu.tsx`, CP.3) are the
 * product's own answer to "make this dark", so they are what a leg uses.
 *
 * ### Closed afterwards, and settled
 *
 * What these legs do next is measure the chrome or photograph the page, and an open menu
 * panel over it is the measurement's own artefact. Escape closes it — the menu's own key —
 * and the close is awaited, because a shutter that fires while the panel is fading out
 * records the fade.
 *
 * The palette itself fades too. `app/theme.ts` arms a cross-fade over every colour in the
 * product for one swap by putting {@link THEME_FADE_ATTRIBUTE} on `<html>`, and removes it
 * when the swap is over. **Waiting for that attribute to go is the difference between
 * reading the new palette and reading a frame halfway between two of them** — the
 * readability audit found this the hard way, computing contrast ratios of 1.1:1 for a page
 * whose ink and ground were both mid-transition, which is exactly what a half-faded page
 * is. A screenshot assertion re-shoots until two frames agree and would have survived it;
 * a `getComputedStyle` read has one chance.
 */

import { expect, type Page } from "@playwright/test";

/**
 * The attribute `app/theme.ts` arms the cross-fade with, and clears when it is over.
 *
 * Restated here rather than imported, because nothing in this suite may import service
 * source (`eslint.config.mjs`). It is a published constant on that side —
 * `THEME_FADE_ATTRIBUTE` — for the same reason the pane's is.
 */
export const THEME_FADE_ATTRIBUTE = "data-theme-fade";

/** The two palettes every surface is verified in (design system § 3.1, the house rule). */
export const THEMES = ["light", "dark"] as const;

/** One of {@link THEMES}. */
export type Theme = (typeof THEMES)[number];

/**
 * The label the account menu gives a palette's radio — `Light`, `Dark`.
 *
 * The menu writes them capitalised and `<html data-theme>` carries them lowercased, so the
 * two spellings are one function apart rather than two constants that can disagree.
 *
 * @param theme - The palette.
 * @returns The radio's accessible name.
 */
function radioName(theme: Theme): string {
  return theme === "light" ? "Light" : "Dark";
}

/**
 * Choose a palette through the account menu, and put the menu away again.
 *
 * A fresh context has stored no choice and starts at *system*, so pinning is also what
 * makes a two-palette comparison a comparison of palettes rather than of whatever the
 * runner's operating system happened to prefer.
 *
 * @param page - The page, already inside the shell — the account menu lives in its header.
 * @param theme - The palette to stamp.
 * @returns When `<html data-theme>` says so, the cross-fade has finished, and the menu is
 *   closed — that is, when the page is the palette rather than on its way to it.
 */
export async function pinTheme(page: Page, theme: Theme): Promise<void> {
  await page.getByRole("button", { name: /^Account menu/ }).click();

  const menu = page.getByRole("menu", { name: "Account" });
  const html = page.locator("html");

  await menu.getByRole("menuitemradio", { name: radioName(theme) }).click();
  await expect(html).toHaveAttribute("data-theme", theme);

  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();

  // Last, because Escape and the panel's own fade run inside the same window: by the time
  // the menu has gone the palette usually has too, and this is the assertion that says so
  // rather than the sleep that assumes it.
  await expect(html).not.toHaveAttribute(THEME_FADE_ATTRIBUTE, /.*/);
}
