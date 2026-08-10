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
    stampTheme(stored);
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_MEDIA_QUERY);
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => {
      setSystem(event.matches ? "dark" : "light");
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
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
