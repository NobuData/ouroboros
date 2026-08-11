import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DARK_MEDIA_QUERY,
  THEME_ATTRIBUTE,
  THEME_FADE_ATTRIBUTE,
  THEME_STORAGE_KEY,
} from "@/app/theme";
import { ThemeProvider, useTheme } from "@/app/theme-provider";

import { installMatchMedia, type MediaController } from "./helpers/match-media";

/**
 * A probe that renders everything `useTheme()` exposes and offers a way to change it.
 *
 * @returns The current choice, the resolved palette, and one button per choice.
 */
function Probe() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <div>
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved">{resolved}</output>
      {(["light", "dark", "system"] as const).map((choice) => (
        <button key={choice} type="button" onClick={() => setTheme(choice)}>
          {choice}
        </button>
      ))}
    </div>
  );
}

let media: MediaController | undefined;

/**
 * Render the probe inside a provider, with the OS preference and storage set up first.
 *
 * @param options.prefersDark What the OS answers.
 * @param options.stored The value already in `localStorage`, if any.
 * @returns The Testing Library render result, so a test can unmount on purpose.
 */
function renderProbe({
  prefersDark = false,
  stored,
}: { prefersDark?: boolean; stored?: string } = {}) {
  if (stored !== undefined) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  media = installMatchMedia(prefersDark, DARK_MEDIA_QUERY);

  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

/** The value the probe currently reports for the given field. */
const reported = (field: "theme" | "resolved") => screen.getByTestId(field).textContent;

/** The attribute currently on `<html>`, or null when there is none. */
const stamped = () => document.documentElement.getAttribute(THEME_ATTRIBUTE);

/** Whether a cross-fade is armed on `<html>` right now. */
const fading = () => document.documentElement.hasAttribute(THEME_FADE_ATTRIBUTE);

afterEach(() => {
  media?.restore();
  media = undefined;
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  document.documentElement.removeAttribute(THEME_FADE_ATTRIBUTE);
  window.localStorage.clear();
});

describe("ThemeProvider", () => {
  it("starts at system when nothing has been chosen", () => {
    renderProbe();

    expect(reported("theme")).toBe("system");
    expect(stamped()).toBeNull();
  });

  it("resolves system against the OS", () => {
    renderProbe({ prefersDark: true });

    expect(reported("theme")).toBe("system");
    expect(reported("resolved")).toBe("dark");
    // Resolving is for the benefit of a control that has to draw a sun or a moon. The
    // palette itself still comes from the sheet's media query, so nothing is stamped.
    expect(stamped()).toBeNull();
  });

  it.each(["light", "dark"] as const)("adopts a stored %s choice", (theme) => {
    renderProbe({ stored: theme });

    expect(reported("theme")).toBe(theme);
    expect(reported("resolved")).toBe(theme);
  });

  it("re-stamps the stored choice, repairing the attribute React drops on a remount", () => {
    // In development Strict Mode remounts once and resets <html> to the attributes it
    // renders from JSX, dropping the boot script's. The sync effect puts it back before
    // paint; this is that effect, observed.
    renderProbe({ stored: "dark" });

    expect(stamped()).toBe("dark");
  });

  it("keeps an explicit choice when the OS disagrees", () => {
    renderProbe({ prefersDark: true, stored: "light" });

    expect(reported("resolved")).toBe("light");
    expect(stamped()).toBe("light");
  });

  it("ignores a stored value it does not recognise", () => {
    renderProbe({ stored: "chartreuse" });

    expect(reported("theme")).toBe("system");
    expect(stamped()).toBeNull();
  });
});

describe("setTheme", () => {
  it.each(["light", "dark"] as const)("applies and persists %s", async (theme) => {
    renderProbe();

    await act(async () => {
      screen.getByRole("button", { name: theme }).click();
    });

    expect(reported("theme")).toBe(theme);
    expect(reported("resolved")).toBe(theme);
    expect(stamped()).toBe(theme);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
  });

  it("swaps the palette without a reload — one attribute, no remount", async () => {
    renderProbe({ stored: "light" });
    const output = screen.getByTestId("theme");

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });

    expect(stamped()).toBe("dark");
    // The same node, still mounted: nothing was torn down and rebuilt, which is what
    // "no reload and no flash" means at the React level.
    expect(screen.getByTestId("theme")).toBe(output);
  });

  it("returns to system by clearing both the attribute and the key", async () => {
    renderProbe({ prefersDark: true, stored: "light" });

    await act(async () => {
      screen.getByRole("button", { name: "system" }).click();
    });

    expect(reported("theme")).toBe("system");
    expect(reported("resolved")).toBe("dark");
    expect(stamped()).toBeNull();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe("tracking the OS", () => {
  it("follows an OS change while the choice is system", () => {
    renderProbe({ prefersDark: false });
    expect(reported("resolved")).toBe("light");

    act(() => media?.set(true));

    expect(reported("resolved")).toBe("dark");
    // Still nothing stamped: CSS did the repaint, this only updates what a control reads.
    expect(stamped()).toBeNull();
  });

  it("ignores an OS change while the choice is explicit", async () => {
    renderProbe({ prefersDark: false, stored: "light" });

    act(() => media?.set(true));

    expect(reported("resolved")).toBe("light");
    expect(stamped()).toBe("light");
  });

  it("picks the OS back up when the choice returns to system", async () => {
    renderProbe({ prefersDark: false, stored: "light" });

    act(() => media?.set(true));
    await act(async () => {
      screen.getByRole("button", { name: "system" }).click();
    });

    expect(reported("resolved")).toBe("dark");
  });

  it("stops listening when unmounted", () => {
    const { unmount } = renderProbe();

    expect(media?.listenerCount()).toBe(1);

    unmount();

    // A listener that outlives its provider is a leak that only shows up after enough
    // navigations to be blamed on something else.
    expect(media?.listenerCount()).toBe(0);
  });
});

describe("the cross-fade", () => {
  it("is armed by a press, so the palette interpolates instead of cutting", async () => {
    renderProbe({ stored: "light" });

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });

    expect(fading()).toBe(true);
    // Armed alongside the palette, never instead of it: the swap is still one attribute.
    expect(stamped()).toBe("dark");
  });

  it("is not armed on mount, where a fade would animate a correction nobody asked for", () => {
    // The stored choice is re-stamped after hydration to repair what Strict Mode drops.
    // Fading that would turn an invisible repair into a visible animation on every load.
    renderProbe({ stored: "dark" });

    expect(stamped()).toBe("dark");
    expect(fading()).toBe(false);
  });

  it("is armed when the OS flips and the choice is system", () => {
    renderProbe({ prefersDark: false });

    act(() => media?.set(true));

    // Nothing is stamped here — CSS repaints on its own — so arming is the only part of
    // this swap JavaScript has any hand in.
    expect(stamped()).toBeNull();
    expect(fading()).toBe(true);
  });

  it("is not armed when the OS flips under an explicit choice", () => {
    renderProbe({ prefersDark: false, stored: "light" });

    act(() => media?.set(true));

    // Nothing repaints: the explicit choice still wins. A window opened here would put
    // an unrelated colour change behind a transition for no reason.
    expect(fading()).toBe(false);
  });

  it("is closed by unmounting, so no timer outlives the provider", async () => {
    const { unmount } = renderProbe();

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });
    expect(fading()).toBe(true);

    unmount();

    expect(fading()).toBe(false);
  });
});

describe("useTheme outside a provider", () => {
  it("throws, naming the provider", () => {
    // A silent default would give a theme control that does nothing, which reads as a
    // styling bug rather than as a missing provider.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    } finally {
      quiet.mockRestore();
    }
  });
});
