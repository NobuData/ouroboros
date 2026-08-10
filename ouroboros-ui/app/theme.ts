/**
 * The runtime theme engine's vocabulary and its two DOM operations.
 *
 * Everything here is framework-free and synchronous, which is what lets the same
 * constants drive three different things that must not disagree: the inline `<head>`
 * script that stamps the theme before first paint, the React provider that owns the
 * choice afterwards, and the tests.
 *
 * ## The contract
 *
 * `docs/DESIGN_TOKENS.md` states it in one line: put `data-theme="light"`,
 * `data-theme="dark"`, or **nothing at all** on `<html>`. Nothing is *system* — the token
 * sheet's `prefers-color-scheme` block then decides, and an explicit `light` still beats a
 * dark OS because that block is written `:root:not([data-theme="light"])`.
 *
 * One consequence is worth stating, because it is the reason this module never asks the
 * OS anything on the way in: while the choice is *system*, the attribute is **absent**, so
 * the operating system's preference is tracked by CSS with no JavaScript involved at all.
 * Live OS tracking is not a listener re-stamping an attribute; it is the absence of the
 * attribute. The provider does listen — but only to keep the *resolved* value it reports
 * to a control like the theme toggle (#42) current, never to stamp.
 *
 * `color-scheme` is likewise not set here. The sheet declares it in all three palette
 * blocks, so native scrollbars, form controls and the browser's own canvas follow the
 * theme for the same reason the palette does. There is no second place a theme is
 * expressed.
 */

/** The three states a theme choice can be in. `system` is the default. */
export type Theme = "light" | "dark" | "system";

/** The two palettes a {@link Theme} resolves to once the OS has been consulted. */
export type ResolvedTheme = "light" | "dark";

/** `localStorage` key holding the user's choice. Absent means *system*. */
export const THEME_STORAGE_KEY = "ouro-theme";

/** The attribute on `<html>` that selects a palette. Absent means *system*. */
export const THEME_ATTRIBUTE = "data-theme";

/** The media query that answers "is the OS set to dark?". */
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** What a visitor who has never chosen gets. */
export const DEFAULT_THEME: Theme = "system";

/** The two choices that are stamped as an attribute; *system* is the absence of one. */
const STAMPED: readonly Theme[] = ["light", "dark"];

/**
 * Narrow an untrusted string to a {@link Theme}.
 *
 * @param value Candidate, typically straight out of `localStorage`.
 * @returns The theme it names, or {@link DEFAULT_THEME} if it names none — a key edited
 *   by hand, written by an older version, or absent are all the same answer.
 */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME;
}

/**
 * Read the persisted choice.
 *
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns The stored choice, or {@link DEFAULT_THEME} when there is none or storage
 *   cannot be reached — Safari's private mode throws on `localStorage` access rather than
 *   returning null, and a visitor in private mode should still get a working page.
 */
export function readStoredTheme(storage: Storage | undefined = safeStorage()): Theme {
  try {
    return parseTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Persist a choice, so it survives the session.
 *
 * *system* is stored as the **absence** of the key rather than as the word, so that
 * "nothing stored" and "the user chose system" cannot drift apart — there is one
 * representation of system in storage, one on the element, and no state to reconcile.
 *
 * @param theme The choice to persist.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. A storage that refuses the write is not an error the user can act
 *   on: the theme applies to this session and simply will not be remembered.
 */
export function storeTheme(
  theme: Theme,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    if (theme === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode, or a full quota — the choice just will not be remembered. */
  }
}

/**
 * Ask the operating system which palette it prefers.
 *
 * @param view Window to query. Defaults to the global `window`.
 * @returns `"dark"` if the OS prefers dark, `"light"` otherwise — including when
 *   `matchMedia` is unavailable, which matches the token sheet, whose `:root` base is the
 *   light palette.
 */
export function systemTheme(view: Window | undefined = safeWindow()): ResolvedTheme {
  return view?.matchMedia?.(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

/**
 * Resolve a choice to the palette that will actually render.
 *
 * @param theme The choice.
 * @param view Window used to answer *system*. Defaults to the global `window`.
 * @returns The palette in force.
 */
export function resolveTheme(
  theme: Theme,
  view: Window | undefined = safeWindow(),
): ResolvedTheme {
  return theme === "system" ? systemTheme(view) : theme;
}

/**
 * Put a choice on the document, which is the whole of applying a theme.
 *
 * No reload and no restyle: the palette is a set of custom properties on `:root`, so
 * changing which block wins changes every colour in the product at once.
 *
 * @param theme The choice to express.
 * @param root Element to stamp. Defaults to `<html>`.
 * @returns Nothing.
 */
export function stampTheme(theme: Theme, root: Element = document.documentElement): void {
  if (STAMPED.includes(theme)) root.setAttribute(THEME_ATTRIBUTE, theme);
  else root.removeAttribute(THEME_ATTRIBUTE);
}

/**
 * The inline `<head>` script, as source.
 *
 * This is the one part of the engine that must run *while the browser is parsing the
 * HTML* — before first paint, before React exists. Anything later is a visible flash of
 * the wrong theme on a slow connection, because the browser paints the server's HTML long
 * before hydration.
 *
 * It is generated from the constants above rather than written out, so the key and the
 * attribute cannot drift from the module that reads them, and it is deliberately tiny:
 * it blocks the parser.
 *
 * Three properties of what it does *not* do:
 *
 * - It never consults `matchMedia`. *system* is the absence of the attribute, and CSS
 *   resolves it — so a stored choice is applied and everything else is left alone.
 * - It never writes. A boot script that repaired storage would be a boot script that
 *   could corrupt it.
 * - It cannot throw. `localStorage` access itself throws in some privacy modes, and a
 *   thrown boot script would leave the rest of the page's scripts unrun.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t)}catch(e){}})();`;

/**
 * `window`, or `undefined` on the server.
 *
 * @returns The global window when there is one.
 */
function safeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

/**
 * `window.localStorage`, or `undefined` where it cannot be reached.
 *
 * Merely *reaching* the property throws when storage is blocked, which is why this is a
 * function with a `try` rather than a constant.
 *
 * @returns Local storage when it is available.
 */
function safeStorage(): Storage | undefined {
  try {
    return safeWindow()?.localStorage;
  } catch {
    return undefined;
  }
}
