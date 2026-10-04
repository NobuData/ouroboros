import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FONT_SCALE_ATTRIBUTE, setFontScale } from "@/app/font-scale";
import {
  APPEARANCE_TAG,
  FONT_SIZE_HINT,
  PREVIEW_CODE,
  PREVIEW_SENTENCE,
  THEME_HINT,
} from "@/app/settings/appearance";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@/app/theme";
import { ThemeProvider } from "@/app/theme-provider";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { renderThemed } from "../helpers/theme";

/**
 * The Appearance card (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491) — the
 * App Shell amendment, CQ.2 #649): the theme choice, the full five-step font-size control and
 * the preview. Every control applies at once, and the font size is the same preference the
 * profile menu's stepper writes — the two must stay in sync without a reload.
 */

/** The Server Action a step is persisted through — stubbed, as a `"use server"` module must be. */
const { saveFontScale } = vi.hoisted(() => ({
  saveFontScale: vi.fn<(scale: string) => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock("@/app/shell/preference-actions", () => ({
  saveFontScale: (scale: string) => saveFontScale(scale),
}));

const { AppearanceCard } = await import("@/app/settings/appearance-card");

/** Draw the card, under the theme provider the application renders everything under. */
function card() {
  return renderThemed(<AppearanceCard />);
}

/** The font-size control. */
function steps(): HTMLElement {
  return screen.getByRole("group", { name: "Font size" });
}

/** The label of the step in force. */
function pressed(): (string | null)[] {
  return within(steps())
    .getAllByRole("button", { pressed: true })
    .map((step) => step.textContent);
}

beforeEach(() => {
  saveFontScale.mockClear();
  saveFontScale.mockResolvedValue(true);
  window.localStorage.removeItem(THEME_STORAGE_KEY);
});

afterEach(() => {
  // Both engines are module state on `<html>`; each case starts at the defaults.
  setFontScale("100");
  window.localStorage.removeItem(THEME_STORAGE_KEY);
});

describe("the anatomy", () => {
  it("is the Appearance region, tagged as the reader's own and applying instantly", () => {
    card();

    const region = screen.getByRole("region", { name: "Appearance" });

    expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent("Appearance");
    expect(within(region).getByText(APPEARANCE_TAG)).toHaveClass("ou-tag");
  });

  it("draws the theme choice with its hint wired to it", () => {
    card();

    const theme = screen.getByRole("combobox", { name: "Theme" });

    expect(within(theme).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(theme).toHaveAccessibleDescription(THEME_HINT);
  });

  it("draws the five steps as one named group, described by what the control does", () => {
    card();

    expect(within(steps()).getAllByRole("button").map((step) => step.textContent)).toEqual([
      "87.5%",
      "100%",
      "112.5%",
      "125%",
      "150%",
    ]);
    expect(steps()).toHaveAccessibleDescription(FONT_SIZE_HINT);
    // Buttons that act, never submit: the card sits on a page with a save model.
    for (const step of within(steps()).getAllByRole("button")) {
      expect(step).toHaveAttribute("type", "button");
    }
  });

  it("draws the preview paragraph, ending on an identifier in the mono face", () => {
    card();

    const preview = screen.getByRole("note", { name: "Preview" });

    expect(preview).toHaveTextContent(`${PREVIEW_SENTENCE} ${PREVIEW_CODE}`);
    expect(within(preview).getByText(PREVIEW_CODE)).toHaveClass("settings-appearance__code");
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the font size", () => {
  it("marks the step in force — the default, on a fresh page", () => {
    card();

    expect(pressed()).toEqual(["100%"]);
  });

  it("applies a step the moment it is pressed, then persists it", () => {
    card();

    fireEvent.click(within(steps()).getByRole("button", { name: "125%" }));

    // Live: the document is at the new scale before anything is answered.
    expect(document.documentElement).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    expect(pressed()).toEqual(["125%"]);
    expect(saveFontScale).toHaveBeenCalledExactlyOnceWith("125");
  });

  it("announces the step, in the profile menu's own sentence", () => {
    card();

    fireEvent.click(within(steps()).getByRole("button", { name: "150%" }));

    expect(screen.getByRole("status")).toHaveTextContent("Font size 150%.");
  });

  it("reaches every one of the five steps", () => {
    card();

    for (const [label, scale] of [
      ["87.5%", "87.5"],
      ["112.5%", "112.5"],
      ["125%", "125"],
      ["150%", "150"],
      ["100%", "100"],
    ] as const) {
      fireEvent.click(within(steps()).getByRole("button", { name: label }));

      expect(document.documentElement).toHaveAttribute(FONT_SCALE_ATTRIBUTE, scale);
      expect(pressed()).toEqual([label]);
    }
    expect(saveFontScale).toHaveBeenCalledTimes(5);
  });

  it("spends no write on the step already in force", () => {
    card();

    fireEvent.click(within(steps()).getByRole("button", { name: "100%" }));

    expect(saveFontScale).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("keeps the step when the write fails: the reader is already reading at that size", async () => {
    saveFontScale.mockResolvedValue(false);
    card();

    await act(async () => {
      fireEvent.click(within(steps()).getByRole("button", { name: "125%" }));
    });

    expect(document.documentElement).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    expect(pressed()).toEqual(["125%"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("staying in sync with the profile menu", () => {
  it("follows a step taken elsewhere, without a reload", () => {
    card();

    // The menu's stepper writes the same store; this is that write.
    act(() => {
      setFontScale("112.5");
    });

    expect(pressed()).toEqual(["112.5%"]);
    // Following is not writing: nothing is persisted on the menu's behalf.
    expect(saveFontScale).not.toHaveBeenCalled();
  });

  it("is followed in turn: its own step is in the store the menu reads", () => {
    const first = card();
    // A second view of the same preference — which is all the menu's stepper is.
    const second = renderThemed(<AppearanceCard />);

    fireEvent.click(within(first.container).getByRole("button", { name: "150%" }));

    expect(
      within(second.container)
        .getAllByRole("button", { pressed: true })
        .map((step) => step.textContent),
    ).toEqual(["150%"]);
  });
});

describe("the theme", () => {
  it("starts on the choice in force", () => {
    card();

    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("system");
  });

  it("applies a choice at once, through the engine that persists it", () => {
    card();

    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), { target: { value: "dark" } });

    expect(document.documentElement).toHaveAttribute(THEME_ATTRIBUTE, "dark");
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("status")).toHaveTextContent("Theme: dark.");
  });

  it("goes back to following the system", () => {
    card();
    const theme = screen.getByRole("combobox", { name: "Theme" });

    fireEvent.change(theme, { target: { value: "light" } });
    fireEvent.change(theme, { target: { value: "system" } });

    expect(theme).toHaveValue("system");
    expect(screen.getByRole("status")).toHaveTextContent(/^Theme: system \((light|dark)\)\.$/);
  });
});
