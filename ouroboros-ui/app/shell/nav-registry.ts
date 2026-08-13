import { safeWindow } from "@/app/browser";

import { type NavEntry, orderNavEntries } from "./nav";

/**
 * The module registry the sidebar renders
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * Twelve module surfaces and counting make a hand-written navigation list a liability: every
 * new screen would edit the same file, which is a merge conflict per roadmap and a place for
 * an entry to be quietly forgotten. So a module **registers** an entry and the sidebar renders
 * whatever is registered (decision S1) — `app/shell/sidebar-nav.tsx` names no module and
 * changes for no new one.
 *
 * Three things are published here, and they are separate on purpose:
 *
 * 1. **The entries.** {@link registerNavEntry} adds one and hands back the way to remove it.
 * 2. **The badge counts.** An entry declares the *name* of the count it shows
 *    ({@link NavEntry.badgeSource}); whoever can compute one publishes it with
 *    {@link setNavBadge}. A source that has published nothing is **absent**, and an absent
 *    count draws no badge — "we do not know" and "nothing needs you" are different claims,
 *    and only one of them may be spelled `0`.
 * 3. **The granted capabilities.** {@link setNavCapabilities} publishes what the reader may
 *    do; `permittedNavEntries` in `app/shell/nav.ts` is the rule that reads it.
 *
 * ### Why a store rather than props
 *
 * The sidebar is rendered by the shell, which is a Server Component with no session, no
 * counts and nothing to pass down; the things that *can* answer — an inbox poll, a capability
 * read — are client-side and live anywhere in the tree. An external store subscribed to with
 * `useSyncExternalStore` is React's own answer to that shape (`app/shell/use-shell-nav.ts`
 * holds the hooks), and it keeps this module **framework-free**: no React, no `next/*`, so the
 * registry can be exercised without rendering anything.
 *
 * The snapshot is cached and replaced only when something actually changes, which is not an
 * optimisation but the contract: `useSyncExternalStore` re-renders whenever the snapshot's
 * identity moves, so a freshly built object per read would re-render forever.
 */

/** What the sidebar reads: the registered entries, the published counts, the granted
 *  capabilities. One object, because they change independently and are read together. */
export interface NavRegistry {
  /** Every registered entry, in the order `orderNavEntries` puts them. */
  readonly entries: readonly NavEntry[];
  /** The published counts, by {@link NavEntry.badgeSource}. A source with no count is
   *  **absent from this map** — see {@link setNavBadge}. */
  readonly badges: Readonly<Record<string, number>>;
  /** What the reader has been granted. Empty until something publishes a set. */
  readonly capabilities: readonly string[];
}

/** The registered entries, by id. A Map, so registration order is recoverable and a
 *  re-registration of the same id replaces rather than duplicates. */
const entries = new Map<string, NavEntry>();

/** The published counts, by source name. */
const badges = new Map<string, number>();

/** The granted capabilities, as published. Replaced wholesale, never edited. */
let capabilities: readonly string[] = Object.freeze([]);

/** Everyone waiting to hear that one of the three above moved. */
const listeners = new Set<() => void>();

/** The last snapshot handed out, or `null` when something has changed since. */
let snapshot: NavRegistry | null = null;

/**
 * Whether this process may hold an answer *about one reader*.
 *
 * The entries above describe the product and are the same for everybody, so a module
 * singleton is the right place for them. A badge count and a capability set are not: they are
 * answers about the person in front of the screen, and a module singleton on the server is
 * shared by **every request the process handles** — publishing one there would put one
 * reader's inbox count, or one reader's permissions, in front of the next visitor.
 *
 * So both publishers below refuse outside the browser. It is not defensiveness: there is no
 * legitimate server-side caller, because a Server Component that knows a count should pass it
 * to a client component, which publishes it. The guard is what makes that the only way.
 *
 * It has a second effect worth naming. Nothing can have been published when the browser
 * hydrates, so the snapshot React hydrates against is exactly the one the server rendered —
 * which is why `app/shell/use-shell-nav.ts` can hand `useSyncExternalStore` the same reader
 * for both snapshots. The contract that keeps that true: **publish from an effect or an event
 * handler, never at module scope.**
 *
 * @returns True in the browser, false during a server render.
 */
function readerScoped(): boolean {
  return safeWindow() !== undefined;
}

/**
 * Rebuild the snapshot next time it is asked for, and tell everyone waiting.
 *
 * @returns Nothing.
 */
function changed(): void {
  snapshot = null;
  for (const listener of [...listeners]) listener();
}

/**
 * Reject an entry that would break the sidebar, at the moment it is registered.
 *
 * Every one of these is a programming error in a module's own registration, so it throws
 * rather than being skipped: a registration that silently did nothing would be a module
 * missing from the navigation with nothing anywhere saying why.
 *
 * @param entry The candidate.
 * @returns Nothing.
 * @throws {Error} When the entry is unusable — see the checks for which cases those are.
 */
function assertUsable(entry: NavEntry): void {
  if (entry.id === "") throw new Error("A navigation entry needs an id.");
  if (entry.label === "") throw new Error(`Navigation entry "${entry.id}" needs a label.`);

  // A route that is not a path on this origin is a link off the product. `//evil.test` is a
  // protocol-relative URL, which is the case a bare startsWith("/") would miss.
  if (!entry.route.startsWith("/") || entry.route.startsWith("//")) {
    throw new Error(`Navigation entry "${entry.id}" needs a route rooted at "/".`);
  }

  if (!Number.isFinite(entry.sort)) {
    throw new Error(`Navigation entry "${entry.id}" needs a finite sort.`);
  }

  // Two entries on one route would both highlight on it, and neither would be wrong.
  for (const other of entries.values()) {
    if (other.id !== entry.id && other.route === entry.route) {
      throw new Error(
        `Navigation entry "${entry.id}" claims "${entry.route}", already claimed by "${other.id}".`,
      );
    }
  }

  // The honesty rule (§ 3.5) as a precondition: a row that is not built has to say what it
  // is waiting for, because in rail mode that sentence is the only thing left of it.
  if (entry.status === "soon" && !entry.soonNote) {
    throw new Error(`Navigation entry "${entry.id}" is "soon" and must say what it awaits.`);
  }

  if (entry.status !== "soon" && entry.soonNote !== undefined) {
    throw new Error(`Navigation entry "${entry.id}" is live and cannot be awaiting anything.`);
  }
}

/**
 * Register a navigation entry.
 *
 * Registering an id that is already registered **replaces** it. That is what module hot
 * reloading does on every save, and the alternative — throwing — turns a development-time
 * reload into a broken sidebar; a duplicate id in production is caught by the uniqueness
 * assertions over the seeded list instead.
 *
 * @param entry The entry. Copied and frozen, so a later edit of the caller's object cannot
 *   change the navigation from underneath the sidebar.
 * @returns The way to remove it again — which is also how a test adds a fixture entry without
 *   needing a reset hook that production would never call. Calling it twice, or after the id
 *   has been re-registered by somebody else, does nothing.
 * @throws {Error} When the entry is unusable — see {@link assertUsable}.
 */
export function registerNavEntry(entry: NavEntry): () => void {
  assertUsable(entry);

  const registered = Object.freeze({ ...entry });
  entries.set(registered.id, registered);
  changed();

  return () => {
    // Identity, not id: a stale handle must not remove whatever took its place.
    if (entries.get(registered.id) !== registered) return;
    entries.delete(registered.id);
    changed();
  };
}

/**
 * Publish the count an entry's badge shows.
 *
 * @param source The badge source's name — the value entries carry as
 *   {@link NavEntry.badgeSource}.
 * @param count How many, or `null` to withdraw the count. `null` **removes** the source
 *   rather than storing a null beside it, so "nothing has been published" has exactly one
 *   representation and no two states to keep in agreement — the same reason
 *   `app/theme.ts` stores *system* as the absence of its key.
 * @returns Nothing — including outside the browser, where {@link readerScoped} explains why
 *   a count must not be stored at all.
 */
export function setNavBadge(source: string, count: number | null): void {
  if (!readerScoped()) return;

  if (count === null) {
    if (!badges.delete(source)) return;
  } else {
    if (badges.get(source) === count) return;
    badges.set(source, count);
  }

  changed();
}

/**
 * Publish what the reader is allowed to do.
 *
 * The whole set at once rather than one grant at a time: capabilities arrive as an answer
 * about a person in a workspace, and applying half of a new answer over half of an old one
 * would show entries belonging to neither.
 *
 * @param granted The capabilities. Duplicates are dropped; order is not significant.
 * @returns Nothing. Publishing a set equal to the current one changes nothing and notifies
 *   nobody, so a poll that keeps returning the same answer does not re-render the sidebar.
 *   Outside the browser it does nothing at all — {@link readerScoped} explains why.
 */
export function setNavCapabilities(granted: readonly string[]): void {
  if (!readerScoped()) return;

  const next = Object.freeze([...new Set(granted)]);

  if (
    next.length === capabilities.length &&
    next.every((capability) => capabilities.includes(capability))
  ) {
    return;
  }

  capabilities = next;
  changed();
}

/**
 * The registry as it stands.
 *
 * @returns A frozen snapshot whose identity is **stable until something changes**, which is
 *   what `useSyncExternalStore` requires of it.
 */
export function navRegistry(): NavRegistry {
  snapshot ??= Object.freeze({
    entries: Object.freeze(orderNavEntries([...entries.values()])),
    badges: Object.freeze(Object.fromEntries(badges)),
    capabilities,
  });

  return snapshot;
}

/**
 * Hear about changes to the registry.
 *
 * @param listener Called after each change, with no argument — the listener re-reads
 *   {@link navRegistry}, which is the contract `useSyncExternalStore` expects.
 * @returns The way to stop listening.
 */
export function subscribeNavRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
