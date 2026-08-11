import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeToggle, describeTheme, nextTheme } from "@/app/shell/theme-toggle";
import { DARK_MEDIA_QUERY, THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@/app/theme";
import { ThemeProvider } from "@/app/theme-provider";

import { installMatchMedia, type MediaController } from "../helpers/match-media";

/**
 * The visible switcher (#42).
 *
 * Applying and persisting a theme belongs to the engine and is tested against the engine
 * (`__tests__/theme-provider.test.tsx`). What is this control's own, and what these tests
 * are about, is the issue's three acceptance criteria: a press swaps the palette, the
 * choice survives a reload, and a screen reader is told.
 */

/** The three states one full cycle passes through. */
const CYCLE_LENGTH = 3;

let media: MediaController | undefined;

/**
 * Render the toggle inside a provider, with the OS preference and storage set up first.
 *
 * @param options.prefersDark What the OS answers.
 * @param options.stored The value already in `localStorage` — the reload path, since a
 *   fresh mount reading storage is exactly what a reload produces.
 * @returns The Testing Library render result.
 */
function renderToggle({
  prefersDark = false,
  stored,
}: { prefersDark?: boolean; stored?: string } = {}) {
  if (stored !== undefined) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  media = installMatchMedia(prefersDark, DARK_MEDIA_QUERY);

  return render(<ThemeToggle />, { wrapper: ThemeProvider });
}

/** The control itself. Its accessible name always opens with the state it is in. */
const toggle = () => screen.getByRole("button", { name: /^Theme:/ });

/** Press it once. */
const press = () => fireEvent.click(toggle());

/** The attribute on `<html>`, which is the whole of a theme being applied. */
const stamped = () => document.documentElement.getAttribute(THEME_ATTRIBUTE);

/** Which palette the icon depicts. */
const drawn = () =>
  document.querySelector("[data-palette]")?.getAttribute("data-palette") ?? null;

/** What the live region currently offers a screen reader. */
const announced = () => screen.getByRole("status").textContent;

afterEach(() => {
  media?.restore();
  media = undefined;
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  window.localStorage.clear();
});

describe("the theme toggle", () => {
  it("is a native button, so the keyboard both reaches and activates it", () => {
    renderToggle();

    // Enter and Space on a <button> are the browser's, not something to reimplement —
    // which is why "keyboard operable" is asserted as "is a button in the tab order"
    // rather than as a key handler this component would have to own.
    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle()).toHaveAttribute("type", "button");
    expect(toggle()).not.toBeDisabled();
    expect(toggle()).not.toHaveAttribute("tabindex");
  });

  it("starts on system, which is what a visitor who has never chosen gets", () => {
    renderToggle();

    expect(toggle()).toHaveAccessibleName("Theme: system (light). Switch to light.");
    // Nothing stamped: while the choice is system the palette is the sheet's media
    // query, and the attribute's absence is what lets it apply.
    expect(stamped()).toBeNull();
  });

  it("draws the palette that is rendering, not the choice that produced it", () => {
    renderToggle({ prefersDark: true });

    expect(drawn()).toBe("dark");
    expect(toggle()).toHaveAccessibleName("Theme: system (dark). Switch to light.");
  });

  it("marks the system choice, so a sun does not mean two different things", () => {
    // system-resolving-to-light and an explicit light choice draw the same icon; the
    // marker is what separates them without hovering for the tooltip.
    renderToggle();
    expect(toggle()).toHaveClass("theme-toggle--auto");

    press();

    expect(drawn()).toBe("light");
    expect(toggle()).not.toHaveClass("theme-toggle--auto");
  });

  it("cycles light → dark → system, and round again", () => {
    renderToggle();

    press();
    expect(toggle()).toHaveAccessibleName("Theme: light. Switch to dark.");

    press();
    expect(toggle()).toHaveAccessibleName("Theme: dark. Switch to system.");

    press();
    expect(toggle()).toHaveAccessibleName("Theme: system (light). Switch to light.");
  });

  it("swaps the palette instantly — one attribute, and the control is never rebuilt", () => {
    renderToggle();
    const before = toggle();

    press();
    expect(stamped()).toBe("light");

    press();
    expect(stamped()).toBe("dark");

    press();
    expect(stamped()).toBeNull();

    // The same node throughout: nothing remounted, which is what "no reload, no flash"
    // means at the React level.
    expect(toggle()).toBe(before);
  });

  it("persists each choice as the engine represents it", () => {
    renderToggle();

    press();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    press();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // system is the absence of the key, not the word — so there is one representation
    // of it in storage and one on the element.
    press();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it.each(["light", "dark"] as const)("comes back on %s after a reload", (theme) => {
    // A fresh mount reading storage is what a reload is.
    renderToggle({ prefersDark: true, stored: theme });

    expect(drawn()).toBe(theme);
    expect(toggle()).toHaveAccessibleName(new RegExp(`^Theme: ${theme}\\.`));
  });

  it("mirrors its accessible name in the tooltip", () => {
    renderToggle();

    expect(toggle()).toHaveAttribute("title", toggle().getAttribute("aria-label"));
  });

  it("follows the OS while the choice is system", () => {
    renderToggle({ prefersDark: false });
    expect(drawn()).toBe("light");

    act(() => media?.set(true));

    expect(drawn()).toBe("dark");
    expect(toggle()).toHaveAccessibleName("Theme: system (dark). Switch to light.");
    expect(stamped()).toBeNull();
  });

  it("ignores the OS once the choice is explicit", () => {
    renderToggle({ prefersDark: false, stored: "light" });

    act(() => media?.set(true));

    expect(drawn()).toBe("light");
    expect(toggle()).toHaveAccessibleName("Theme: light. Switch to dark.");
  });
});

describe("what a screen reader is told", () => {
  it("offers a live region that is on the page before it has anything to say", () => {
    renderToggle();

    // A region added at the same moment as its text is not reliably announced, so it is
    // mounted empty rather than conditionally.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(announced()).toBe("");
  });

  it("says nothing about the provider settling its own state on load", () => {
    // The provider corrects itself from storage just after mount. That is not something
    // the reader did, and announcing it would make every page load speak.
    renderToggle({ stored: "dark" });

    expect(announced()).toBe("");
  });

  it("announces the state each press produced", () => {
    renderToggle();

    press();
    expect(announced()).toBe("Theme: light.");

    press();
    expect(announced()).toBe("Theme: dark.");
  });

  it("resolves system when it announces it, so 'system' is never the whole answer", () => {
    renderToggle({ prefersDark: true, stored: "dark" });

    press();

    expect(announced()).toBe("Theme: system (dark).");
  });

  it("changes text on every press, or a press would pass unannounced", () => {
    // A live region re-announces on *change*. Two consecutive states that described
    // themselves identically would leave the second press silent.
    renderToggle();
    const heard: (string | null)[] = [];

    for (let i = 0; i < CYCLE_LENGTH; i += 1) {
      press();
      heard.push(announced());
    }

    expect(new Set(heard).size).toBe(CYCLE_LENGTH);
  });
});

describe("nextTheme", () => {
  it.each([
    ["system", "light"],
    ["light", "dark"],
    ["dark", "system"],
  ] as const)("moves %s to %s", (from, to) => {
    expect(nextTheme(from)).toBe(to);
  });

  it("returns to where it started after one full cycle", () => {
    expect(nextTheme(nextTheme(nextTheme("light")))).toBe("light");
  });
});

describe("describeTheme", () => {
  it.each(["light", "dark"] as const)("leaves an explicit %s choice alone", (theme) => {
    expect(describeTheme(theme, theme)).toBe(theme);
  });

  it.each(["light", "dark"] as const)("resolves system against %s", (resolved) => {
    expect(describeTheme("system", resolved)).toBe(`system (${resolved})`);
  });
});
