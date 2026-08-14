"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  type CommandAction,
  type CommandContext,
  type CommandSource,
  matchCommandActions,
} from "./command";
import { commandSources, subscribeCommandSources } from "./command-registry";

/**
 * The registry, a query and a context, resolved into the rows the palette draws
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * `app/shell/command.ts` is pure and `app/shell/command-registry.ts` is framework-free, both
 * on purpose; this file is the one place either meets React, which is the split
 * `app/shell/use-shell-nav.ts` made for the sidebar and for the same reasons.
 *
 * It is where the **two halves of a source** are reconciled, and that is the whole of the
 * work:
 *
 * ```
 *            list(context)                    find(query, context, signal)
 *                 │                                       │
 *      every keystroke, synchronous              debounced, abortable, async
 *                 │                                       │
 *      matchCommandActions(query, …)              already matched by the source
 *                 └──────────────┬────────────────────────┘
 *                                ▼
 *                    what the palette renders
 * ```
 *
 * Nothing in MVP scope has a `find` — H.3 ships navigation only — so the asynchronous path is
 * exercised by `__tests__/shell/use-command-actions.test.tsx` through a fixture source, which
 * is deliberate: [#93](https://github.com/NobuData/ouroboros/issues/93) is supposed to add a
 * source and edit nothing here, and a path nothing has ever been passed through is a path that
 * does not work yet and nobody has found out.
 */

/** How long the typing has to stop before a `find` source is asked. */
export const COMMAND_SEARCH_DELAY_MS = 150;

/** The empty result, as one frozen array rather than a fresh one per render. */
const NONE: readonly CommandAction[] = Object.freeze([]);

/** What the last completed search answered, and what it answered *for*. */
interface Found {
  /** The query it was asked, so a stale answer can be recognised rather than shown. */
  readonly query: string;
  /** What it returned. */
  readonly actions: readonly CommandAction[];
}

/** Nothing has been searched for yet. */
const NOTHING_FOUND: Found = Object.freeze({ query: "", actions: NONE });

/** A source that searches — the narrowing the `find` calls below need. */
type FindingSource = CommandSource & { readonly find: NonNullable<CommandSource["find"]> };

/**
 * Whether a source searches over the wire.
 *
 * @param source The source.
 * @returns True when it has a `find`, narrowed so the caller can invoke it.
 */
function searches(source: CommandSource): source is FindingSource {
  return source.find !== undefined;
}

/**
 * The registered command sources.
 *
 * The same reader answers for the server and the browser, which is safe because the registry
 * holds nothing about the reader — sources describe the product and are seeded at module
 * import on both sides. So the snapshot React hydrates against is the one the server rendered.
 *
 * @returns The sources, re-read whenever one registers or is removed.
 */
export function useCommandSources(): readonly CommandSource[] {
  return useSyncExternalStore(subscribeCommandSources, commandSources, commandSources);
}

/** What the palette needs to draw a state of itself. */
export interface CommandActionsState {
  /** Every row, ranked: the matched synchronous ones, then whatever a search has found. */
  readonly actions: readonly CommandAction[];
  /** Whether a search is out for the query as typed — so the palette can say so rather than
   *  render "no matches" over an answer that is still coming. */
  readonly searching: boolean;
}

/**
 * The rows for a query.
 *
 * @param query What the reader has typed, raw. Trimmed where it is used, so the palette does
 *   not have to decide what a trailing space means.
 * @param context What the shell can do, handed to every source. **Must be stable between
 *   renders that did not change it** — the palette memoises it — because it is a dependency
 *   of the search effect, and an identity that moved every render would re-fetch every render.
 * @returns See {@link CommandActionsState}.
 */
export function useCommandActions(query: string, context: CommandContext): CommandActionsState {
  const sources = useCommandSources();

  /**
   * The last answer a `find` came back with.
   *
   * The only state here, and it is written **from the promise's callback** rather than from
   * the effect body — which is what keeps the whole hook clear of the cascading render
   * `react-hooks/set-state-in-effect` reports (`app/shell/client-value.ts` argues the case).
   * Everything else below is derived, including whether a search is in flight: that is
   * *"the last answer is not about the query as typed"*, which needs no second flag to keep
   * in agreement with the first.
   */
  const [found, setFound] = useState<Found>(NOTHING_FOUND);

  const asked = query.trim();
  const searchable = asked !== "" && sources.some(searches);

  useEffect(() => {
    if (!searchable) return;

    const controller = new AbortController();

    // Debounced here rather than in each source, so a source owns its request and not the
    // timing — and so two sources cannot debounce a query for different lengths of time and
    // deliver two halves of one answer a moment apart.
    const timer = setTimeout(() => {
      void Promise.all(
        // A source that fails contributes nothing. Saying so is its own business, and the
        // shape for it is an unavailable action carrying the reason — see `CommandSource.find`.
        sources
          .filter(searches)
          .map((source) => source.find(asked, context, controller.signal).catch(() => NONE)),
      ).then((answers) => {
        // The abort is what makes a stale answer impossible rather than merely unlikely: the
        // cleanup below fires before the next effect runs, so an in-flight request whose query
        // has moved on can never write over a newer one.
        if (controller.signal.aborted) return;
        setFound({ query: asked, actions: answers.flat() });
      });
    }, COMMAND_SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [asked, searchable, sources, context]);

  /** Everything the shell already knows, filtered and ranked by the matcher. */
  const listed = matchCommandActions(
    query,
    sources.flatMap((source) => source.list?.(context) ?? NONE),
  );

  /**
   * What a search found, shown only while it still describes what is in the box.
   *
   * Which is also why there is no "clear the results" branch anywhere: a query that moved on
   * makes the previous answer invisible by arithmetic rather than by a second write.
   */
  const fetched = found.query === asked ? found.actions : NONE;

  return { actions: [...listed, ...fetched], searching: searchable && found.query !== asked };
}
