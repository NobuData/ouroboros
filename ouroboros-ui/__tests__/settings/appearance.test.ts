import { describe, expect, it } from "vitest";

import { FONT_SCALES } from "@/app/font-scale";
import {
  APPEARANCE_TAG,
  FONT_SIZE_HINT,
  FONT_SIZE_LABEL,
  FONT_SIZE_STEPS,
  PREVIEW_CODE,
  PREVIEW_LABEL,
  PREVIEW_SENTENCE,
  THEME_HINT,
  THEME_LABEL,
  THEME_OPTIONS,
  fontSizeAnnouncement,
  fontSizeLabel,
  themeAnnouncement,
} from "@/app/settings/appearance";

/**
 * The Appearance section's copy and choices (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491) — the App Shell amendment, CQ.2
 * #649), held to mockup 17.
 */

describe("the card's copy", () => {
  it("is mockup 17's, verbatim", () => {
    expect(APPEARANCE_TAG).toBe("per user · applies instantly");
    expect(THEME_LABEL).toBe("Theme");
    expect(THEME_HINT).toBe("light · dark · follow system");
    expect(FONT_SIZE_LABEL).toBe("Font size");
    expect(FONT_SIZE_HINT).toBe(
      "scales the whole interface — for high-resolution displays where text runs small; saved to your account",
    );
    expect(PREVIEW_LABEL).toBe("Preview");
    expect(`${PREVIEW_SENTENCE} ${PREVIEW_CODE}`).toBe(
      "The quick brown fox jumps over the lazy dog — 0123456789 · dock_ctrl.c:214",
    );
  });
});

describe("the theme choices", () => {
  it("are the engine's three, the one that follows the system first", () => {
    expect(THEME_OPTIONS).toEqual([
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ]);
  });

  it("are announced with the palette actually on screen", () => {
    expect(themeAnnouncement("dark", "dark")).toBe("Theme: dark.");
    expect(themeAnnouncement("system", "light")).toBe("Theme: system (light).");
  });
});

describe("the font-size steps", () => {
  it("are the five the preference allows — 87.5 to 150% — smallest first", () => {
    expect(FONT_SIZE_STEPS).toEqual(["87.5", "100", "112.5", "125", "150"]);
    // The service's own enumeration, not a second copy of it.
    expect(FONT_SIZE_STEPS).toBe(FONT_SCALES);
  });

  it("are labelled as percentages", () => {
    expect(FONT_SIZE_STEPS.map(fontSizeLabel)).toEqual(["87.5%", "100%", "112.5%", "125%", "150%"]);
  });

  it("are announced in the profile menu's own sentence, so the two controls say one thing", () => {
    expect(fontSizeAnnouncement("112.5")).toBe("Font size 112.5%.");
  });
});
