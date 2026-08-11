"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

import {
  DARK_MEDIA_QUERY,
  DEFAULT_THEME,
  type ResolvedTheme,
  type Theme,
  beginThemeFade,
  endThemeFade,
  readStoredTheme,
  stampTheme,
  storeTheme,
  systemTheme,
} from "./theme";

/** What {@link useTheme} hands back. */
export interface ThemeContextValue {
  /** The user's choice: `light`, `dark`, or `system`. */
  theme: Theme;
  /** The palette actually in force, with *system* already resolved against the OS. */
  resolved: ResolvedTheme;
  /** Change the choice: applies it, persists it, and re-renders consumers. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * The provider is server-rendered like any client component, and React warns that
 * `useLayoutEffect` does nothing during server rendering. Swapping the hook by
 * environment silences a warning about a difference that does not exist: neither hook runs
 * on the server, and in the browser only the layout variant runs early enough — see the
 * comment on the sync effect below.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Owns the theme choice for the application.
 *
 * The palette itself is *not* this component's doing. By the time React runs, the inline
 * boot script has already stamped `data-theme` and the browser has already painted the
 * right colours. What the provider adds is everything after first paint: the current value
 * as React state, a setter that applies and persists a new one, and a `resolved` value
 * that stays true while the choice is *system* and the OS changes underneath it.
 *
 * It is also where the cross-fade is armed, at both of the two moments a palette can
 * change — a press of the switcher, and an OS flip while the choice is *system* — and
 * nowhere else. `app/theme.ts` describes what arming does and `globals.css` decides
 * whether it shows.
 *
 * ### Why the initial state is not read from storage
 *
 * A lazy initialiser reading `localStorage` would make the first client render disagree
 * with the server's HTML, which is a hydration mismatch in every consumer that renders
 * from `theme`. Instead the state starts at the same value the server used, and the sync
 * effect below corrects it after hydration but **before paint** — so React's hydration
 * render matches exactly, no consumer needs `suppressHydrationWarning`, and nothing
 * visible was ever wrong: the colours came from the boot script, and a control's icon is
 * settled before the frame is drawn.
 *
 * @param children The application, which becomes able to call {@link useTheme}.
 * @returns The provider, rendering `children` unchanged.
 */
export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  // The OS preference, tracked only so `resolved` stays true while the choice is system.
  // Light is the server's assumption because the token sheet's base palette is light.
  const [system, setSystem] = useState<ResolvedTheme>("light");

  useIsomorphicLayoutEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setSystem(systemTheme());

    // Re-stamp what the boot script already stamped. In production this is a no-op. In
    // development React's Strict Mode remounts once and resets <html> to the attributes
    // it manages from JSX, dropping the one the script set; without this the page would
    // then render in the wrong palette, ignoring the value's own source of truth. It runs
    // in a layout effect so the repair lands before the browser paints.
    //
    // Bare, with no fade armed: on a load that needs the repair the palette is already
    // wrong, and fading into the right one would turn a correction nobody should notice
    // into an animation everybody does. The fade belongs to a change someone asked for.
    stampTheme(stored);

    // Closing the window is the provider's, for the same reason opening it is: a timer
    // that outlived this component would strip an attribute off a document it no longer
    // owns.
    return endThemeFade;
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_MEDIA_QUERY);
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => {
      // While the choice is system this event *is* the palette changing: the sheet's own
      // media query has flipped and CSS repaints with no help from here. Arming is
      // therefore best-effort, and deliberately so — it fades the swap only when the
      // change is reported before the frame that repaints, which is the order the
      // rendering steps specify but not the one a Chrome whose media state was changed
      // from the outside was measured doing. When it loses that race the swap is instant,
      // exactly as it was before the fade existed, and nothing is worse for having tried.
      //
      // Under an explicit choice nothing repaints at all, and arming would open a window
      // over a change that is not happening.
      if (theme === "system") beginThemeFade();
      setSystem(event.matches ? "dark" : "light");
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    // Before the stamp. Either order works — a transition is chosen from the style an
    // element ends up with, not the one it started in — but this is the order that reads
    // as what it does: open the window, then change the palette inside it.
    beginThemeFade();
    setThemeState(next);
    stampTheme(next);
    storeTheme(next);
  }, []);

  const resolved = theme === "system" ? system : theme;

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Read and change the theme.
 *
 * @returns The current choice, the palette it resolves to, and the setter.
 * @throws {Error} When called outside a {@link ThemeProvider}. Returning a default
 *   instead would give a control that silently does nothing — a bug that looks like a
 *   styling problem rather than a missing provider.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (value === null) {
    throw new Error(
      "useTheme must be called inside <ThemeProvider>. The provider wraps the " +
        "application in app/layout.tsx.",
    );
  }

  return value;
}
