/**
 * The Appearance section's copy and choices, as values
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491) — the App Shell roadmap's
 * amendment, CQ.2 [#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * Mockup 17's Appearance card: the theme choice, the full font-size control — five steps,
 * 87.5 to 150% — and a preview paragraph, under the tag *per user · applies instantly*.
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4 puts the quick control in the profile menu and the
 * full one here; both are views of one preference, so neither holds it
 * (`app/settings/appearance-card.tsx`).
 *
 * Framework-free and pure.
 */

import { FONT_SCALES, type FontScale } from "@/app/font-scale";
import { type ResolvedTheme, type Theme, describeTheme } from "@/app/theme";

import { IMMEDIATE_MARK } from "./view";

/** The card's tag — mockup 17's, and what kind of control everything in the card is. */
export const APPEARANCE_TAG = `per user · ${IMMEDIATE_MARK}`;

/** The theme field's label and the line under it — the mockup's. */
export const THEME_LABEL = "Theme";
export const THEME_HINT = "light · dark · follow system";

/** The three choices, in the mockup's order: the one that follows the system first. */
export const THEME_OPTIONS: readonly { readonly value: Theme; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The font-size control's label and the line under it — the mockup's. */
export const FONT_SIZE_LABEL = "Font size";
export const FONT_SIZE_HINT =
  "scales the whole interface — for high-resolution displays where text runs small; saved to your account";

/** The five steps, smallest first — § 4's, which is the service's own enumeration. */
export const FONT_SIZE_STEPS: readonly FontScale[] = FONT_SCALES;

/**
 * What a step says on its segment — `112.5%`.
 *
 * @param scale The step.
 * @returns The label.
 */
export function fontSizeLabel(scale: FontScale): string {
  return `${scale}%`;
}

/** The preview's label, its sentence, and the identifier it ends on — the mockup's. */
export const PREVIEW_LABEL = "Preview";
export const PREVIEW_SENTENCE = "The quick brown fox jumps over the lazy dog — 0123456789 ·";
export const PREVIEW_CODE = "dock_ctrl.c:214";

/**
 * What is announced when the font size changes — the profile menu's own sentence, so the two
 * controls say one thing.
 *
 * @param scale The step now in force.
 * @returns The sentence.
 */
export function fontSizeAnnouncement(scale: FontScale): string {
  return `Font size ${scale}%.`;
}

/**
 * What is announced when the theme changes.
 *
 * @param theme The choice.
 * @param resolved The palette that choice renders as.
 * @returns The sentence — `Theme: system (dark).` rather than `system` alone, which does not
 *   say which of the two palettes is on the screen.
 */
export function themeAnnouncement(theme: Theme, resolved: ResolvedTheme): string {
  return `Theme: ${describeTheme(theme, resolved)}.`;
}
