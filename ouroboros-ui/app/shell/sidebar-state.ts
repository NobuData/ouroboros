import { safeStorage, safeWindow } from "@/app/browser";

/**
 * The sidebar's two pieces of runtime state: how wide the reader wants it, and whether the
 * drawer is open ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * They are here rather than in a component because two components need them and neither
 * contains the other: the chevron at the sidebar's foot sets the width, the hamburger in the
 * header opens the drawer, and the sidebar itself renders from both. A React context would
 * mean a provider wrapping the header *and* the sidebar, which is the shape
 * `app/shell/regions.ts` already argued against for the same shell — an external store
 * subscribed to with `useSyncExternalStore` costs neither of them a boundary
 * (`app/shell/use-shell-nav.ts` holds the hooks).
 *
 * ### The width is a three-state choice, exactly like the theme
 *
 * `wide`, `rail`, or **nothing at all**, and nothing means *the viewport decides*: below
 * 1024px the specification makes the rail the default (§ 1.2), and that default is a media
 * query in `app/shell/shell.css` with no JavaScript in it. So the absence of a stored choice
 * is not "expanded" — it is "whatever the CSS says", which is why {@link SidebarChoice} has a
 * third value and why {@link resolveSidebarChoice} exists to answer what the reader is
 * actually looking at.
 *
 * That is the same contract `app/theme.ts` keeps for `light`/`dark`/*system*, down to the
 * boot script: {@link SIDEBAR_BOOTSTRAP} stamps the stored choice on `<html>` while the
 * browser is still parsing, so a reader who collapsed the sidebar last week does not watch it
 * collapse again on every load.
 *
 * ### The drawer is not persisted, deliberately
 *
 * A drawer is a thing you opened a moment ago, not a preference. Restoring one on load would
 * hand a reader a covered screen they have to dismiss before they can read it.
 *
 * **Framework-free**: no React and no `next/*`, so the boot script's source can be imported by
 * the root layout and every rule below can be tested without a DOM.
 */

/** What the reader has chosen the sidebar's width to be. */
export type SidebarChoice =
  /** Expanded, at 240px. */
  | "wide"
  /** The 64px icon rail. */
  | "rail"
  /** No choice made: the viewport decides, which is the specification's default. */
  | "default";

/** The two widths a {@link SidebarChoice} resolves to once the viewport has been consulted. */
export type SidebarWidth = "wide" | "rail";

/** `localStorage` key holding the choice. Absent means *default*. */
export const SIDEBAR_STORAGE_KEY = "ouro-sidebar";

/** The attribute on `<html>` that selects a width. Absent means *default*. */
export const SIDEBAR_ATTRIBUTE = "data-sidebar";

/** The query that answers "is the viewport narrow enough that the rail is the default?" —
 *  1024px, § 1.2's number, and the same one `shell.css` collapses at. */
export const RAIL_MEDIA_QUERY = "(max-width: 64rem)";

/** The query that answers "is the sidebar a drawer?" — 768px, § 1.2's other number. */
export const DRAWER_MEDIA_QUERY = "(max-width: 48rem)";

/** What a reader who has never chosen gets. */
export const DEFAULT_SIDEBAR_CHOICE: SidebarChoice = "default";

/** The two choices that are stamped as an attribute; *default* is the absence of one. */
const STAMPED: readonly SidebarChoice[] = ["wide", "rail"];

/** The sidebar's state, as anything rendering it sees it. */
export interface SidebarState {
  /** The reader's width choice, unresolved — see {@link resolveSidebarChoice}. */
  readonly choice: SidebarChoice;
  /** Whether the drawer is open. Only meaningful below 768px, where the sidebar is one. */
  readonly drawerOpen: boolean;
}

/**
 * What the server renders, and therefore what the browser hydrates against.
 *
 * No stored choice and no open drawer: the server has neither storage nor a viewport, and
 * guessing at either is a hydration mismatch. The correction lands in the same pass —
 * `app/shell/client-value.ts` explains why `useSyncExternalStore` is the mechanism for that.
 */
export const SIDEBAR_SERVER_STATE: SidebarState = Object.freeze({
  choice: DEFAULT_SIDEBAR_CHOICE,
  drawerOpen: false,
});

/** The state in the browser, read from storage the first time it is asked for. */
let state: SidebarState | null = null;

/** Everyone waiting to hear that it moved. */
const listeners = new Set<() => void>();

/**
 * Narrow an untrusted string to a {@link SidebarChoice}.
 *
 * @param value Candidate, typically straight out of `localStorage`.
 * @returns The choice it names, or {@link DEFAULT_SIDEBAR_CHOICE} if it names none — a key
 *   edited by hand, written by an older version, or absent are all the same answer.
 */
export function parseSidebarChoice(value: string | null | undefined): SidebarChoice {
  return value === "wide" || value === "rail" ? value : DEFAULT_SIDEBAR_CHOICE;
}

/**
 * Read the persisted choice.
 *
 * @param storage Where to read from. Defaults to `window.localStorage`.
 * @returns The stored choice, or {@link DEFAULT_SIDEBAR_CHOICE} when there is none or storage
 *   cannot be reached.
 */
export function readStoredSidebarChoice(
  storage: Storage | undefined = safeStorage(),
): SidebarChoice {
  try {
    return parseSidebarChoice(storage?.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return DEFAULT_SIDEBAR_CHOICE;
  }
}

/**
 * Persist a choice, so it survives the session.
 *
 * *default* is stored as the **absence** of the key rather than as the word, so "nothing
 * stored" and "the reader chose the default" cannot drift apart.
 *
 * Per browser rather than per account, which is as far as this can honestly go today: the
 * account preference API is CQ.2 ([#649](https://github.com/NobuData/ouroboros/issues/649)),
 * and the design system's own plan for it (§ 4) is a server-side value *mirrored* to
 * `localStorage` for a no-flash boot — so this is the mirror either way, and #649 adds the
 * server side above it without changing what boots.
 *
 * @param choice The choice to persist.
 * @param storage Where to write. Defaults to `window.localStorage`.
 * @returns Nothing. A storage that refuses the write is not an error a reader can act on:
 *   the choice applies to this session and simply will not be remembered.
 */
export function storeSidebarChoice(
  choice: SidebarChoice,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    if (choice === "default") storage?.removeItem(SIDEBAR_STORAGE_KEY);
    else storage?.setItem(SIDEBAR_STORAGE_KEY, choice);
  } catch {
    /* private mode, or a full quota — the choice just will not be remembered. */
  }
}

/**
 * Put a choice on the document, which is the whole of applying it.
 *
 * The widths are custom properties on the shell, so changing which rule wins changes the
 * grid's first column and the sidebar together — there is no layout to recompute in script
 * and nothing for a resize observer to do.
 *
 * @param choice The choice to express.
 * @param root Element to stamp. Defaults to `<html>`.
 * @returns Nothing.
 */
export function stampSidebarChoice(
  choice: SidebarChoice,
  root: Element | undefined = safeWindow()?.document.documentElement,
): void {
  if (root === undefined) return;

  if (STAMPED.includes(choice)) root.setAttribute(SIDEBAR_ATTRIBUTE, choice);
  else root.removeAttribute(SIDEBAR_ATTRIBUTE);
}

/**
 * Resolve a choice to the width the reader is actually looking at.
 *
 * @param choice The choice.
 * @param narrow Whether the viewport is below the 1024px rail breakpoint — what
 *   {@link RAIL_MEDIA_QUERY} answers.
 * @returns `"rail"` or `"wide"`, with *default* already resolved against the viewport.
 */
export function resolveSidebarChoice(
  choice: SidebarChoice,
  narrow: boolean,
): SidebarWidth {
  if (choice !== "default") return choice;
  return narrow ? "rail" : "wide";
}

/**
 * The sidebar's state as it stands.
 *
 * @returns A frozen snapshot whose identity is **stable until something changes**, which is
 *   what `useSyncExternalStore` requires. The first call in the browser reads storage; the
 *   server never reaches this, because {@link SIDEBAR_SERVER_STATE} is what it renders from.
 */
export function sidebarState(): SidebarState {
  state ??= Object.freeze({
    choice: readStoredSidebarChoice(),
    drawerOpen: false,
  });

  return state;
}

/**
 * Replace the state and tell everyone waiting.
 *
 * @param next What it becomes.
 * @returns Nothing.
 */
function commit(next: SidebarState): void {
  state = Object.freeze(next);
  for (const listener of [...listeners]) listener();
}

/**
 * Choose a width, and remember it.
 *
 * @param choice The new choice. Persisted and stamped in the same call, so the attribute the
 *   stylesheet reads and the key the next load boots from cannot come apart.
 * @returns Nothing.
 */
export function setSidebarChoice(choice: SidebarChoice): void {
  const current = sidebarState();
  if (current.choice === choice) return;

  storeSidebarChoice(choice);
  stampSidebarChoice(choice);
  commit({ ...current, choice });
}

/**
 * Open or close the drawer.
 *
 * @param open Whether it is open.
 * @returns Nothing.
 */
export function setDrawerOpen(open: boolean): void {
  const current = sidebarState();
  if (current.drawerOpen === open) return;

  commit({ ...current, drawerOpen: open });
}

/**
 * Hear about changes to the sidebar's state.
 *
 * @param listener Called after each change, with no argument — the listener re-reads
 *   {@link sidebarState}, which is the contract `useSyncExternalStore` expects.
 * @returns The way to stop listening.
 */
export function subscribeSidebar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The inline `<head>` script, as source.
 *
 * The same job the theme's boot script does, for the same reason: the browser paints the
 * server's HTML long before hydration, so a collapse applied by React is a collapse the
 * reader watches happen. It is generated from the constants above so the key and the
 * attribute cannot drift from the module that reads them, and — like the theme's — it never
 * writes, never consults a media query (the *default* is the absence of the attribute, and
 * the stylesheet resolves it), and cannot throw.
 */
export const SIDEBAR_BOOTSTRAP = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  SIDEBAR_STORAGE_KEY,
)});if(s==="wide"||s==="rail")document.documentElement.setAttribute(${JSON.stringify(
  SIDEBAR_ATTRIBUTE,
)},s)}catch(e){}})();`;
