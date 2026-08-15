import type { CommandSource } from "./command";

/**
 * The registry the command palette draws from
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * The shape, and the argument for it, are `app/shell/nav-registry.ts`'s: a surface
 * **registers** what it can contribute and the palette renders whatever is registered, so
 * `app/shell/command-palette.tsx` names no source and does not change to gain one. The
 * acceptance criterion this exists for is the last of H.3's — *the action registry API is
 * documented for #93 to extend* — and the documentation is this file plus the contract in
 * `app/shell/command.ts`.
 *
 * ```ts
 * import { registerCommandSource } from "@/app/shell/command-registry";
 *
 * registerCommandSource({
 *   id: "issues",
 *   sort: 30,
 *   async find(query, context, signal) {
 *     const found = await searchIssues(query, { signal });
 *     return found.map((issue) => ({
 *       id: `issues:${issue.number}`,
 *       label: `#${issue.number} ${issue.title}`,
 *       group: "Issues",
 *       run: () => context.navigate(`/issues/${issue.number}`),
 *     }));
 *   },
 * });
 * ```
 *
 * That is the whole of what #93 adds. It does not touch the palette, the matcher, or this
 * file — which is what "without rework" has to mean if it is to mean anything.
 *
 * ### Why a store rather than props
 *
 * The palette is opened from the shell's header, and the surfaces that can contribute to it
 * live anywhere in the tree — or, for the seeded ones, nowhere in it at all. Threading a list
 * of sources down from the header would make every screen that wants a command a screen that
 * has to edit the shell. An external store subscribed to with `useSyncExternalStore` is
 * React's own answer to that shape (`app/shell/use-command-actions.ts` holds the hook), and it
 * keeps this module **framework-free**: no React, no `next/*`, so the registry can be
 * exercised without rendering anything.
 *
 * ### Nothing reader-specific may be stored here
 *
 * `app/shell/nav-registry.ts` refuses to hold a badge count or a capability outside the
 * browser, because a module singleton on the server is shared by every request the process
 * handles. This registry holds **no reader state at all** — only sources, which describe the
 * product and are the same for everybody — so the same hazard is answered by there being
 * nothing to store. Everything about the person in front of the screen arrives as the
 * `CommandContext` the palette builds per render and hands to `list` and `find`.
 *
 * The snapshot is cached and replaced only when something actually changes, which is not an
 * optimisation but the contract: `useSyncExternalStore` re-renders whenever the snapshot's
 * identity moves, so a freshly built array per read would re-render forever.
 */

/** The registered sources, by id. A Map, so re-registering an id replaces rather than doubles. */
const sources = new Map<string, CommandSource>();

/** Everyone waiting to hear that the set moved. */
const listeners = new Set<() => void>();

/** The last snapshot handed out, or `null` when something has changed since. */
let snapshot: readonly CommandSource[] | null = null;

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
 * Reject a source the palette could not draw from, at the moment it is registered.
 *
 * Every one of these is a programming error in a source's own registration, so it throws
 * rather than being skipped: a registration that silently did nothing would be a set of
 * commands missing from the palette with nothing anywhere saying why.
 *
 * @param source The candidate.
 * @returns Nothing.
 * @throws {Error} When the source is unusable — see the checks for which cases those are.
 */
function assertUsable(source: CommandSource): void {
  if (source.id === "") throw new Error("A command source needs an id.");

  if (!Number.isFinite(source.sort)) {
    throw new Error(`Command source "${source.id}" needs a finite sort.`);
  }

  // A source with neither half contributes nothing, whatever it was meant to do.
  if (source.list === undefined && source.find === undefined) {
    throw new Error(`Command source "${source.id}" offers neither a list nor a find.`);
  }
}

/**
 * Register a source of palette actions.
 *
 * Registering an id that is already registered **replaces** it, for the reason
 * `registerNavEntry` gives: that is what module hot reloading does on every save, and throwing
 * would turn a development-time reload into a broken palette.
 *
 * @param source The source. Copied and frozen, so a later edit of the caller's object cannot
 *   change the palette from underneath it.
 * @returns The way to remove it again — which is also how a test adds a fixture source without
 *   needing a reset hook production would never call. Calling it twice, or after the id has
 *   been re-registered by somebody else, does nothing.
 * @throws {Error} When the source is unusable — see {@link assertUsable}.
 */
export function registerCommandSource(source: CommandSource): () => void {
  assertUsable(source);

  const registered = Object.freeze({ ...source });
  sources.set(registered.id, registered);
  changed();

  return () => {
    // Identity, not id: a stale handle must not remove whatever took its place.
    if (sources.get(registered.id) !== registered) return;
    sources.delete(registered.id);
    changed();
  };
}

/**
 * The registered sources, in the order the palette asks them.
 *
 * @returns A frozen snapshot, ascending by {@link CommandSource.sort} and then by id, whose
 *   identity is **stable until something changes** — what `useSyncExternalStore` requires of
 *   it.
 */
export function commandSources(): readonly CommandSource[] {
  snapshot ??= Object.freeze(
    [...sources.values()].sort(
      (left, right) => left.sort - right.sort || left.id.localeCompare(right.id),
    ),
  );

  return snapshot;
}

/**
 * Hear about changes to the registry.
 *
 * @param listener Called after each change, with no argument — the listener re-reads
 *   {@link commandSources}, which is the contract `useSyncExternalStore` expects.
 * @returns The way to stop listening.
 */
export function subscribeCommandSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
