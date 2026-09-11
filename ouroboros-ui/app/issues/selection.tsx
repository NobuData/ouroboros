"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The backlog's checkbox selection — the one piece of client state the intake screen shares
 * between regions ([#115](https://github.com/NobuData/ouroboros/issues/115)) — and, since the
 * table landed ([#117](https://github.com/NobuData/ouroboros/issues/117)), the row whose
 * detail is open beside it.
 *
 * ### Why it exists above the table
 *
 * The page head's **Queue N selected ⟳** reflects this selection, and the head shipped first.
 * N.3's scope names the store — *"selection store (URL-independent, survives filter changes
 * within the page, exposed to N.1/N.4)"* — so the head was its first reader, the table
 * (`app/issues/backlog-table.tsx`) is its writer, and N.4's selection bar
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) is its second reader. Writing the
 * seam first, with its one reader, is what let the table arrive as a writer rather than as a
 * refactor of the head.
 *
 * ### Why a context rather than the URL
 *
 * The filter bar's state lives in the query string (decision K8), and a selection kept there
 * would be dropped by the first `router.replace` the filter bar makes. A provider around the
 * screen holds the selection for as long as the page is mounted and no longer: a selection is
 * something a person is in the middle of doing, not a view to share. The same is true of a
 * page change: the footer navigates with a soft `Link`, the screen stays mounted, and what
 * was selected on page one is still selected on page two.
 *
 * **The order is the order it was built in**, because `POST /api/v1/backlog/queue` hands out
 * queue positions down the list it is sent — *"the queue reads the way the person built the
 * selection"*. Select-all appends the rows it adds in the table's order, after whatever was
 * already selected, for the same reason.
 *
 * ### Two states, not one
 *
 * *Selected-for-detail* and *checkbox-selected* are different facts — the mockup's `#485`
 * happens to be both — so the row whose detail panel is open ({@link IssueSelection.detail})
 * is held beside the checked set rather than inside it, and neither moves the other. It is
 * here rather than in a provider of its own because it is the same kind of thing for the same
 * two readers: the table writes it on a row's click or `Enter`, and N.5's panel
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)) is what reads it.
 */

/** What a region reads, and the ways it may change it. */
export interface IssueSelection {
  /** The selected issues' `github_issues.id`s, in the order they were selected. */
  readonly ids: readonly string[];
  /**
   * Select an issue, or deselect it if it already is.
   *
   * @param id The issue's `github_issues.id` — the `id` a backlog row carries.
   */
  readonly toggle: (id: string) => void;
  /**
   * Select several issues at once — the header's select-all.
   *
   * @param ids The issues, in the order to append them. Ones already selected keep their
   *   place; the rest join the end in the order given.
   */
  readonly select: (ids: readonly string[]) => void;
  /**
   * Deselect several issues at once — the header's select-none.
   *
   * @param ids The issues. Ones not selected are ignored.
   */
  readonly deselect: (ids: readonly string[]) => void;
  /** Deselect everything — what a queue press that took does, since those issues are queued. */
  readonly clear: () => void;
  /** The issue whose detail is open, by `github_issues.id`, or `null` while none is. */
  readonly detail: string | null;
  /**
   * Open an issue's detail, or close it.
   *
   * @param id The issue, or `null` to close the panel.
   */
  readonly inspect: (id: string | null) => void;
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
 * A selection with several issues added.
 *
 * @param ids The selection as it stands.
 * @param more The issues to add, in the order to append them. Empty ids and ids already
 *   selected are skipped, and an id given twice is appended once.
 * @returns A new list, or the same list when nothing was added — so a select-all over rows
 *   already selected re-renders nothing.
 */
export function selected(ids: readonly string[], more: readonly string[]): readonly string[] {
  const added: string[] = [];

  for (const id of more) {
    if (id !== "" && !ids.includes(id) && !added.includes(id)) added.push(id);
  }

  return added.length === 0 ? ids : [...ids, ...added];
}

/**
 * A selection with several issues removed.
 *
 * @param ids The selection as it stands.
 * @param gone The issues to remove.
 * @returns A new list keeping the rest in their order, or the same list when none of them was
 *   selected.
 */
export function deselected(ids: readonly string[], gone: readonly string[]): readonly string[] {
  const kept = ids.filter((id) => !gone.includes(id));

  return kept.length === ids.length ? ids : kept;
}

/**
 * Hold a selection for everything rendered beneath it.
 *
 * @param props.children The screen.
 * @returns The screen, with a selection that starts empty and no detail open.
 */
export function IssueSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);

  const toggle = useCallback((id: string) => setIds((current) => toggled(current, id)), []);
  const select = useCallback(
    (more: readonly string[]) => setIds((current) => selected(current, more)),
    [],
  );
  const deselect = useCallback(
    (gone: readonly string[]) => setIds((current) => deselected(current, gone)),
    [],
  );
  // Hands back the same empty list when there is nothing to clear, so a clear that changes nothing
  // re-renders nothing.
  const clear = useCallback(() => setIds((current) => (current.length === 0 ? current : [])), []);
  const inspect = useCallback((id: string | null) => setDetail(id === "" ? null : id), []);

  const selection = useMemo(
    () => ({ ids, toggle, select, deselect, clear, detail, inspect }),
    [ids, toggle, select, deselect, clear, detail, inspect],
  );

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
