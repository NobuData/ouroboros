"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import {
  focusRepoIn,
  focusRepoState,
  setFocusRepo,
  useFocusRepo,
} from "@/app/shell/focus-repo";
import { Button, Card } from "@/app/ui";

import { onClearFilters } from "./clear-filters";
import {
  ALL_REPOS_OPTION,
  type BacklogFilter,
  type BacklogSort,
  type BacklogState,
  CLEAR_ALL_LABEL,
  CLEAR_ALL_TITLE,
  DEFAULT_FILTER,
  FACETS_UNREAD,
  FILTER_BAR_LABEL,
  LABELS_LABEL,
  NO_LABELS_IN_SCOPE,
  REPO_LABEL,
  REPOS_UNREAD,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  SORT_LABEL,
  SORT_OPTIONS,
  STATE_LABEL,
  STATE_OPTIONS,
  UNLISTED_REPO_OPTION,
  UPDATING_VIEW,
  chipSet,
  filterHref,
  focusArrival,
  isFiltered,
  toggleLabel,
} from "./filter";

/**
 * Mockup 03's filter bar ([#116](https://github.com/NobuData/ouroboros/issues/116)) — the
 * repository select, the label chips, the state and sort selects and the search box, as **a
 * query-string editor**.
 *
 * ### The URL is the state, and this component holds almost none
 *
 * Decision K8: every control's value lives in `?repo=&labels=&state=&sort=&q=`, the route reads it
 * on the server (`app/(app)/issues/page.tsx`) and asks M.1 with it (`app/issues/data.ts`), and this
 * bar draws the answer. A press does not set state here — it writes the next address with
 * `router.replace`, and the Server Components re-query. That is the opposite of the decision
 * `app/models/routing-matrix.tsx` makes for its selection, and for the opposite reason: there the
 * address is a *record* of a keystroke nothing on the server needs, whereas here the address is
 * *what the server was asked*, so a filter kept in React would be a second copy that could disagree
 * with the table under it. `replace` rather than `push`, so **Back** means *the page I came from*
 * rather than *one chip ago*. `scroll: false`, because the pane should stay where the reader left it
 * while the rows under the bar change.
 *
 * The one thing held here is the search box's text. A box that wrote to the URL per keystroke would
 * be a request per keystroke, so the text is local and the URL follows it after
 * {@link SEARCH_DEBOUNCE_MS} of quiet — and every other control flushes it, so a chip pressed
 * mid-word asks for the word too. The text is reset from the address only when the address moved by
 * a hand other than this bar's (**Back**, a pasted link), which is the paired-state pattern
 * `app/registry/registry-table.tsx` uses for its selection.
 *
 * ### The repository select is the header's focus repository, seen from the page
 *
 * H.1's chip ([#77](https://github.com/NobuData/ouroboros/issues/77)) and this select are one
 * choice, and they are kept in step both ways: choosing here publishes to the store the chip draws
 * from, and a choice made in the chip is followed into the address. On arrival, the address decides
 * — {@link focusArrival} says how, and why a pasted link wins.
 *
 * ### Nothing is drawn that the address does not carry
 *
 * A repository the enabled list does not name, or a label the facets do not, is still what the
 * address asked for — so each is drawn, as an option or a pressed chip, and can be changed. A bar
 * that hid them would show a default view over a filtered table.
 *
 * ### The address moving is a state, and the bar draws it
 *
 * Every navigation is made inside a transition ([#120](https://github.com/NobuData/ouroboros/issues/120)),
 * so between a press and the server's answer the bar is `aria-busy` and says *Updating the
 * backlog…* under its row — the rows beneath are the old address's until the new one arrives,
 * and a reader who pressed a chip should be told the press took. Nothing else changes: the
 * controls stay pressable, and a second press supersedes the first the way a second
 * navigation does.
 *
 * ### Clearing is the bar's, from wherever it is asked
 *
 * The table's *no issues match* state carries a **Clear filters** control, and what it does is
 * exactly this bar's **Clear all** — the store cleared, the box settled, the default address —
 * asked for through `app/issues/clear-filters.ts`, because those three moves are only right in
 * this order and only this bar knows it.
 */

/** What the bar takes. */
export interface FilterBarProps {
  /** The filter the address carries — what the page was asked for. */
  readonly filter: BacklogFilter;
  /** Every label in scope (M.1's `labelFacets`), or why the chip set could not be read. */
  readonly facets: Reading<readonly string[]>;
  /** The workspace's enabled repositories, or why the select could not be filled. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The workspace — BetterAuth's organization id — the focus repository is stored under. */
  readonly organizationId: string;
}

/**
 * The search box's text, beside the two values that decide when the address may overwrite it.
 *
 * The address's `q` arrives as a prop, and a prop that changed is one of two things: what this bar
 * wrote a moment ago coming back rendered, which must not touch the box (the reader may have typed
 * on), or a move made by another hand — **Back**, a pasted link — which must. Telling them apart
 * needs both the prop as last seen and the value last written, which is the pair
 * `app/registry/registry-table.tsx` keeps for its selection.
 */
interface SearchBox {
  /** The address's `q` as this bar last saw it. */
  readonly seen: string;
  /** The `q` this bar last wrote to the address, or adopted from it. */
  readonly committed: string;
  /** What the box shows, as typed. */
  readonly draft: string;
}

/**
 * The box, once the address's `q` has changed since it was last seen.
 *
 * @param held The box as it stands.
 * @param q The address's `q` now.
 * @returns The box with the address noted — and, when the address moved by another hand, with its
 *   text adopted.
 */
function noticing(held: SearchBox, q: string): SearchBox {
  return q === held.committed ? { ...held, seen: q } : { seen: q, committed: q, draft: q };
}

/**
 * The bar.
 *
 * @param props See {@link FilterBarProps}.
 * @returns The card, with the mockup's five controls and — while anything is filtered — the
 *   clear-all control after them.
 */
export function FilterBar({ filter, facets, repos, organizationId }: FilterBarProps) {
  const router = useRouter();
  const [pending, startNavigation] = useTransition();

  const [search, setSearch] = useState<SearchBox>({
    seen: filter.q,
    committed: filter.q,
    draft: filter.q,
  });
  // The address changed since it was last seen. Compared during render, so the box is right
  // before it is painted (the registry table's argument for the same shape).
  if (search.seen !== filter.q) setSearch(noticing(search, filter.q));

  /** The pending search commit, if a keystroke armed one. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The props and the box as last rendered, for the timer to read when it fires. */
  const latest = useRef({ filter, search });

  useEffect(() => {
    latest.current = { filter, search };
  }, [filter, search]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Write the next address. Every navigation the bar makes goes through here, and each one
   * cancels a pending search commit — the caller carries the box's text itself, which is what makes
   * *a control flushes the search* one rule rather than five.
   *
   * @param next The filter to navigate to.
   */
  const navigate = useCallback(
    (next: BacklogFilter) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Inside a transition, so `pending` is true from the press until the route has drawn
      // the new address — the state the bar reports under its row.
      startNavigation(() => {
        router.replace(filterHref(next), { scroll: false });
      });
    },
    [router, startNavigation],
  );

  const focus = useFocusRepo(organizationId);
  const focusId = focus?.id ?? null;
  /**
   * The focus repository this bar last agreed with the header on — `undefined` until the page has
   * arrived. Set by every path that moves the store, so a change the bar itself made is not
   * followed a second time.
   */
  const reconciled = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (reconciled.current === undefined) {
      // Arrival. The store is read directly rather than through the hook, whose first value in
      // the browser is the server's empty snapshot, not what this browser chose.
      const stored = focusRepoIn(focusRepoState(), organizationId);
      const arrival = focusArrival(filter.repo, stored, repos.ok ? repos.value : null);

      if (arrival.kind === "publish") {
        reconciled.current = arrival.repo?.id ?? null;
        setFocusRepo(organizationId, arrival.repo);
      } else if (arrival.kind === "adopt") {
        reconciled.current = arrival.repo;
        navigate({ ...filter, repo: arrival.repo });
      } else {
        reconciled.current = stored?.id ?? null;
      }
      return;
    }

    // Afterwards: the header's chip moved the store, and the address follows it — carrying the
    // box's text, which the address then hands back and the box adopts.
    if (focusId === reconciled.current) return;
    reconciled.current = focusId;
    if (focusId !== filter.repo) navigate({ ...filter, repo: focusId, q: search.draft.trim() });
  }, [filter, focusId, navigate, organizationId, repos, search.draft]);

  /**
   * Back to the default view: the header's chip cleared and recorded as this bar's own move, the
   * box settled on nothing, and the default address. Also what the table's **Clear filters**
   * asks for, through the signal below.
   */
  const clearAll = useCallback(() => {
    reconciled.current = null;
    setFocusRepo(organizationId, null);
    setSearch((held) => ({ ...held, committed: "", draft: "" }));
    navigate(DEFAULT_FILTER);
  }, [navigate, organizationId]);

  useEffect(() => onClearFilters(clearAll), [clearAll]);

  /** The repositories the select can name. */
  const listed = repos.ok ? repos.value : [];
  /** Whether the address names a repository the select cannot. */
  const unlisted = filter.repo !== null && !listed.some((repo) => repo.id === filter.repo);
  const chips = chipSet(facets.ok ? facets.value : [], filter.labels);
  const active = isFiltered({ ...filter, q: search.draft.trim() });

  /** A control other than the search box moved: navigate, carrying whatever the box holds. */
  function change(next: Partial<BacklogFilter>): void {
    const q = search.draft.trim();

    setSearch((held) => ({ ...held, committed: q }));
    navigate({ ...filter, q, ...next });
  }

  function chooseRepo(event: ChangeEvent<HTMLSelectElement>): void {
    const id = event.target.value === "" ? null : event.target.value;
    const named = listed.find((repo) => repo.id === id);

    // Publish to the header first, and record it, so the store's change is not followed as if
    // the chip had made it. A repository the list cannot name is not published — see the note.
    if (id === null || named !== undefined) {
      reconciled.current = id;
      setFocusRepo(organizationId, named === undefined ? null : { id: named.id, name: named.name });
    }
    change({ repo: id });
  }

  function type(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;

    setSearch((held) => ({ ...held, draft: value }));
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const { filter: now, search: box } = latest.current;

      // The box moved on — a reset from the address — or there is nothing new to ask for.
      if (box.draft !== value) return;
      const q = value.trim();
      if (q === box.committed) return;

      setSearch((held) => ({ ...held, committed: q }));
      navigate({ ...now, q });
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <Card
      as="section"
      aria-busy={pending || undefined}
      aria-label={FILTER_BAR_LABEL}
      className="issues-filter"
    >
      <div className="issues-filter__row">
        <select
          aria-label={REPO_LABEL}
          className="ou-input issues-filter__select"
          onChange={chooseRepo}
          value={filter.repo ?? ""}
        >
          <option value="">{ALL_REPOS_OPTION}</option>
          {listed.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
          {unlisted && <option value={filter.repo ?? ""}>{UNLISTED_REPO_OPTION}</option>}
        </select>

        <div aria-label={LABELS_LABEL} className="issues-filter__chips" role="group">
          {chips.map(({ label, on }) => (
            <button
              key={label}
              aria-pressed={on}
              className="ou-tag issues-filter__chip"
              onClick={() => change({ labels: toggleLabel(filter, label).labels })}
              type="button"
            >
              {label}
              {/* The mockup's `bug ✓` — the mark repeats what `aria-pressed` already says. */}
              {on && <span aria-hidden="true"> ✓</span>}
            </button>
          ))}
          {facets.ok && chips.length === 0 && (
            <span className="issues-filter__note">{NO_LABELS_IN_SCOPE}</span>
          )}
        </div>

        <select
          aria-label={STATE_LABEL}
          className="ou-input issues-filter__select"
          onChange={(event) => change({ state: event.target.value as BacklogState })}
          value={filter.state}
        >
          {STATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          aria-label={SORT_LABEL}
          className="ou-input issues-filter__select"
          onChange={(event) => change({ sort: event.target.value as BacklogSort })}
          value={filter.sort}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <input
          aria-label={SEARCH_LABEL}
          className="ou-input issues-filter__search"
          onChange={type}
          placeholder={SEARCH_PLACEHOLDER}
          type="search"
          value={search.draft}
        />

        {active && (
          <Button
            className="issues-filter__clear"
            onClick={clearAll}
            size="sm"
            title={CLEAR_ALL_TITLE}
            tone="ghost"
          >
            {CLEAR_ALL_LABEL}
          </Button>
        )}
      </div>

      {pending && (
        <p className="issues-filter__pending" role="status">
          {UPDATING_VIEW}
        </p>
      )}
      {!facets.ok && (
        <p className="issues-filter__unread" role="status">
          {FACETS_UNREAD} {facets.reason}
        </p>
      )}
      {!repos.ok && (
        <p className="issues-filter__unread" role="status">
          {REPOS_UNREAD} {repos.reason}
        </p>
      )}
    </Card>
  );
}
