"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { type ResolvedTheme, type Theme, resolveTheme } from "../theme";
import { useTheme } from "../theme-provider";

/**
 * The order the control cycles in, from #42's state diagram: light → dark → system,
 * and round again.
 *
 * *system* is last because it is the default, so a visitor who has never chosen starts
 * there and their first press produces the light palette — a change they can see. A
 * cycle ending on *system* would make the first press of a fresh install do nothing
 * visible on a machine whose OS already prefers light.
 */
const CYCLE: readonly Theme[] = ["light", "dark", "system"];

/**
 * The choice one press moves to.
 *
 * @param theme The current choice.
 * @returns The next entry in {@link CYCLE}, wrapping at the end — and `light` for
 *   anything the cycle does not contain, which the type forbids and `parseTheme` has
 *   already ruled out, but which is the harmless answer if either ever stops holding.
 */
export function nextTheme(theme: Theme): Theme {
  return CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
}

/**
 * Name a state in words, resolving *system* rather than leaving it ambiguous.
 *
 * @param theme The choice being described.
 * @param resolved The palette that choice renders as.
 * @returns `"light"`, `"dark"`, or `"system (light)"` / `"system (dark)"` — the form the
 *   issue asks the tooltip for, because "system" alone does not tell a reader which of
 *   the two palettes is on the screen.
 */
export function describeTheme(theme: Theme, resolved: ResolvedTheme): string {
  return theme === "system" ? `system (${resolved})` : theme;
}

/**
 * The visible light / dark / system switcher (#42).
 *
 * The theme engine (#17) already owns everything about *applying* a theme; this is its
 * control surface and holds no theme state of its own. One press calls `setTheme` with
 * the next choice, and the palette swaps under the whole product because the engine
 * changes one attribute on `<html>` — no reload, no remount, and nothing here to keep in
 * step. Persistence is likewise the engine's, so the choice survives a reload without
 * this component knowing that storage exists.
 *
 * ### What the icon says, and what it cannot
 *
 * The icon is the **resolved** palette — a sun when light is rendering, a moon when dark
 * is — which is what the issue specifies and what makes the control legible: it shows
 * the state of the product, not the state of a preference. The cost is that *light* and
 * *system resolving to light* draw the same sun, so the button carries a marker dot
 * while the choice is *system* (`.theme-toggle--auto` in `shell.css`). The accessible
 * name and the tooltip say the same thing in words, and both name the next state, so
 * pressing is never a guess.
 *
 * ### Announcing the change
 *
 * A screen reader is told by the live region below, and only ever about a press. The
 * text is set in the handler rather than derived from `theme`, because the provider
 * corrects its own state once just after mount — a derived region would announce that
 * correction on every page load, which is an announcement about nothing the reader did.
 * The region itself is always mounted, empty until then: a live region added to the page
 * at the same moment as its text is not reliably announced at all.
 *
 * @returns The button and the live region that reports its effect.
 */
export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const [announcement, setAnnouncement] = useState("");

  const upcoming = nextTheme(theme);
  const label = `Theme: ${describeTheme(theme, resolved)}. Switch to ${upcoming}.`;
  const Icon = resolved === "dark" ? Moon : Sun;

  /** Move to the next choice and tell a screen reader what that produced. */
  const cycle = () => {
    setTheme(upcoming);
    // resolveTheme rather than the hook's `resolved`, which still describes the palette
    // being left behind: this render happens before the state change is applied.
    setAnnouncement(`Theme: ${describeTheme(upcoming, resolveTheme(upcoming))}.`);
  };

  return (
    <>
      <button
        type="button"
        className={
          theme === "system"
            ? "shell-icon-button theme-toggle theme-toggle--auto"
            : "shell-icon-button theme-toggle"
        }
        aria-label={label}
        title={label}
        onClick={cycle}
      >
        {/*
          `data-palette` is the icon saying which of the two palettes it depicts. It is
          the one fact about this element anything outside the component needs, and
          lucide's own class names are not a contract to read it from.
        */}
        <Icon size={16} aria-hidden data-palette={resolved} />
      </button>

      {/*
        Not inside the button: the button's name is its aria-label, and a live region is
        a place a reader is sent, not part of the control they are on.
      */}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
