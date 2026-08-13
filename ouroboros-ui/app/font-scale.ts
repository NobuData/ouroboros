import { safeStorage, safeWindow } from "@/app/browser";
import type { components } from "@/app/api/schema";

/**
 * The font-scale engine ([#649](https://github.com/NobuData/ouroboros/issues/649)): the five
 * root font-size steps of `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4, applied without a flash and
 * remembered per *person* rather than per browser.
 *
 * The third instance of the #17 pattern, after the theme and the sidebar — and the first
 * whose truth lives on the server. That difference is the whole architecture:
 *
 * ```
 *                    boot (inline <head> script, before first paint)
 * localStorage ────▶ data-font-scale on <html> ────▶ :root[data-font-scale] { font-size }
 *      ▲                                                        (app/globals.css)
 *      │ mirror
 * GET /api/v1/me/preferences ──▶ reconcile on session load (server wins: it is the
 *                                cross-device truth; the mirror only makes boot instant)
 * PATCH ◀── a control's step (applied locally first — live preview is the local write)
 * ```
 *
 * **The mirror is not the record.** `app/shell/sidebar-state.ts` § "per browser … is as far
 * as this can honestly go today" named this issue as the one that adds the server side; this
 * is that, and the sidebar's caveat does not apply here. Signing in on another machine brings
 * the scale along because `GET` does; the localStorage copy exists so the *next* load of this
 * browser paints right before any request could answer.
 *
 * **Applying is one attribute.** `stampFontScale` sets `data-font-scale` on `<html>`, and
 * five rules in `app/globals.css` turn it into `font-size: N%` — CSS resolves the value, the
 * boot script stays trivial and throw-proof, and `__tests__/styles.test.ts` can assert the
 * rules exist. Percentages compose with browser zoom rather than fighting it, which is § 4's
 * own requirement.
 *
 * **Anonymous screens honour the mirror for free.** The boot script is injected in the root
 * layout beside the theme's, so `/login` scales before any session exists — § 4's "anonymous
 * screens honor the local mirror", implemented by *where the script is* rather than by code.
 *
 * An external store rather than a context, exactly as the sidebar argues: two controls in
 * two subtrees (the menu's stepper, CP.3; Settings → Appearance, #492) must read one value
 * and hear one another's writes, and a provider wrapping both would be the shape
 * `app/shell/regions.ts` already argued against. `app/use-font-scale.ts` holds the hook.
 *
 * **Framework-free**: no React and no `next/*`, so the boot script's source can be imported
 * by the root layout and every rule here can be tested without a DOM.
 */

/** One of the five steps — the contract's own type, so the API and this file cannot drift. */
export type FontScale = components["schemas"]["FontScale"];

/** The five, smallest first — § 4's vocabulary, and V007's CHECK, as a value. */
export const FONT_SCALES: readonly FontScale[] = ["87.5", "100", "112.5", "125", "150"];

/** What a reader who has never chosen gets: the browser's base size, untouched. */
export const DEFAULT_FONT_SCALE: FontScale = "100";

/** `localStorage` key holding the mirror. Absent means *never reconciled, use the default*. */
export const FONT_SCALE_STORAGE_KEY = "ouro-font-scale";

/** The attribute on `<html>` that selects a step. Absent means the default 100%. */
export const FONT_SCALE_ATTRIBUTE = "data-font-scale";

/** The value in the browser, read from the mirror the first time it is asked for. */
let state: FontScale | null = null;

/** Everyone waiting to hear that it moved. */
const listeners = new Set<() => void>();

/**
 * Narrow an untrusted string to a {@link FontScale}.
 *
 * @param value Candidate, typically straight out of `localStorage`.
 * @returns The step it names, or `null` when it names none — a key edited by hand, written
 *   by a future version with a wider scale, or absent are all the same answer, and the
 *   caller decides what that means. Not the default: "unreadable" and "chose 100" are
 *   different facts, even though they paint the same.
 */
export function parseFontScale(value: string | null | undefined): FontScale | null {
  return FONT_SCALES.includes(value as FontScale) ? (value as FontScale) : null;
}

/**
 * Read the mirrored step.
 *
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns The mirrored step, or `null` when there is none or storage cannot be reached.
 */
export function readStoredFontScale(
  storage: Storage | undefined = safeStorage(),
): FontScale | null {
  try {
    return parseFontScale(storage?.getItem(FONT_SCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Mirror a step, so the next load of this browser boots at it.
 *
 * Always the value, never an absence-for-default: the server distinguishes "never chose"
 * from "chose 100" (a row exists or does not), and the mirror does not need to — but a
 * mirror that deleted the key for `'100'` would make a reader who *returned* to the default
 * boot as "never reconciled" and flash if their server truth ever disagrees.
 *
 * @param scale The step to mirror.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. A storage that refuses the write is not an error a reader can act on:
 *   the scale applies to this session and the next boot simply starts from the default.
 */
export function storeFontScale(
  scale: FontScale,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(FONT_SCALE_STORAGE_KEY, scale);
  } catch {
    /* private mode, or a full quota — the next boot just will not know. */
  }
}

/**
 * Put a step on the document, which is the whole of applying it.
 *
 * The attribute selects one of the five `:root[data-font-scale]` rules in
 * `app/globals.css`, each of them one `font-size` percentage — so every rem in the product
 * moves together, and there is nothing for script to recompute.
 *
 * @param scale The step to express.
 * @param root Element to stamp. Defaults to `<html>`.
 * @returns Nothing.
 */
export function stampFontScale(
  scale: FontScale,
  root: Element | undefined = safeWindow()?.document.documentElement,
): void {
  root?.setAttribute(FONT_SCALE_ATTRIBUTE, scale);
}

/**
 * The step the reader is looking at.
 *
 * @returns The current step. The first call in the browser reads the mirror; the server
 *   renders from {@link DEFAULT_FONT_SCALE} through the hook's server snapshot and never
 *   reaches this.
 */
export function currentFontScale(): FontScale {
  state ??= readStoredFontScale() ?? DEFAULT_FONT_SCALE;
  return state;
}

/**
 * Apply a step: stamp it, mirror it, and tell everyone waiting.
 *
 * **Persistence to the account is deliberately not here.** The two callers want different
 * halves: a control (the CP.3 stepper, #492's Settings row) applies locally *and* calls the
 * `saveFontScale` Server Action — the local write is the live preview — while the
 * session-load reconciliation applies a value that came *from* the server and must not be
 * PATCHed straight back at it. One function that sometimes persisted would need a flag, and
 * a flag is two functions wearing one name.
 *
 * @param scale The step to apply.
 * @returns Nothing.
 */
export function setFontScale(scale: FontScale): void {
  if (currentFontScale() === scale) return;

  stampFontScale(scale);
  storeFontScale(scale);
  state = scale;
  for (const listener of [...listeners]) listener();
}

/**
 * Hear about changes to the scale.
 *
 * @param listener Called after each change, with no argument — the listener re-reads
 *   {@link currentFontScale}, which is the contract `useSyncExternalStore` expects.
 * @returns The way to stop listening.
 */
export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The inline `<head>` script, as source.
 *
 * The same job the theme's and the sidebar's do, for the same reason: the browser paints
 * the server's HTML long before hydration, and a scale applied by React is small text a
 * 150% reader watches jump on every load. Generated from the constants above so the key,
 * the attribute and the vocabulary cannot drift from the module that reads them back; like
 * its two siblings it never writes, never fetches, and cannot throw. The five values are
 * inlined as a literal because the script must stand alone in `<head>` — and
 * `__tests__/font-scale.test.ts` holds that literal to {@link FONT_SCALES}.
 */
export const FONT_SCALE_BOOTSTRAP = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  FONT_SCALE_STORAGE_KEY,
)});if(${JSON.stringify([...FONT_SCALES])}.indexOf(s)>=0)document.documentElement.setAttribute(${JSON.stringify(
  FONT_SCALE_ATTRIBUTE,
)},s)}catch(e){}})();`;
