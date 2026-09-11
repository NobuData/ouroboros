"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The backlog's checkbox selection — the one piece of client state the intake screen shares
 * between regions ([#115](https://github.com/NobuData/ouroboros/issues/115)).
 *
 * ### Why it exists before the table does
 *
 * The page head's **Queue N selected ⟳** reflects this selection, and the head ships first. N.3
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) names the store in its scope —
 * *"selection store (URL-independent, survives filter changes within the page, exposed to
 * N.1/N.4)"* — so the dependency runs the other way from the order the tickets land in: the head
 * is this store's first reader, N.3's table will be its writer, and N.4's selection bar
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) its second reader. Writing the seam
 * now, with its one reader, is what lets the table arrive as a writer rather than as a refactor of
 * the head.
 *
 * ### Why a context rather than the URL
 *
 * The filter bar's state lives in the query string (decision K8), and a selection kept there
 * would be dropped by the first `router.replace` the filter bar makes. A provider around the screen
 * holds the selection for as long as the page is mounted and no longer: a selection is something
 * a person is in the middle of doing, not a view to share.
 *
 * **The order is the order it was built in**, because `POST /api/v1/backlog/queue` hands out queue
 * positions down the list it is sent — *"the queue reads the way the person built the selection"*.
 */

/** What a region reads, and the two ways it may change it. */
export interface IssueSelection {
  /** The selected issues' `github_issues.id`s, in the order they were selected. */
  readonly ids: readonly string[];
  /**
   * Select an issue, or deselect it if it already is.
   *
   * @param id The issue's `github_issues.id` — the `id` a backlog row carries.
   */
  readonly toggle: (id: string) => void;
  /** Deselect everything — what a queue press that took does, since those issues are queued. */
  readonly clear: () => void;
}

/** The nearest provider's selection, or `null` outside one — see {@link useIssueSelection}. */
const SelectionContext = createContext<IssueSelection | null>(null);

/**
 * A selection with one issue toggled.
 *
 * @param ids The selection as it stands.
 * @param id The issue to toggle. An empty id is ignored: it names no issue, and a selection that
 *   counted one would draw *Queue 1 selected* over a press the service can only refuse.
 * @returns A new list — the id appended when it was absent, removed when it was present — or the
 *   same list when nothing changed.
 */
export function toggled(ids: readonly string[], id: string): readonly string[] {
  if (id === "") return ids;

  return ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id];
}

/**
 * Hold a selection for everything rendered beneath it.
 *
 * @param props.children The screen.
 * @returns The screen, with a selection that starts empty.
 */
export function IssueSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [ids, setIds] = useState<readonly string[]>([]);

  const toggle = useCallback((id: string) => setIds((current) => toggled(current, id)), []);
  // Hands back the same empty list when there is nothing to clear, so a clear that changes nothing
  // re-renders nothing.
  const clear = useCallback(() => setIds((current) => (current.length === 0 ? current : [])), []);

  const selection = useMemo(() => ({ ids, toggle, clear }), [ids, toggle, clear]);

  return <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>;
}

/**
 * The selection the nearest provider holds.
 *
 * @returns The selection.
 * @throws {Error} Outside an {@link IssueSelectionProvider}. A default empty selection would draw a
 *   queue button that can never be enabled, with nothing anywhere saying why, so the misuse is a
 *   loud error on the first render rather than a quietly dead control.
 */
export function useIssueSelection(): IssueSelection {
  const selection = useContext(SelectionContext);

  if (selection === null) {
    throw new Error(
      "useIssueSelection() needs an IssueSelectionProvider above it — IssuesScreen renders one.",
    );
  }

  return selection;
}
