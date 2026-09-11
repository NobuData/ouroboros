/**
 * The filter bar's state — everything mockup 03's `.filter-bar` holds, as the URL holds it
 * ([#116](https://github.com/NobuData/ouroboros/issues/116)).
 *
 * Decision K8 makes the bar a query-string editor: `?repo=&labels=&state=&sort=&q=` **is** the
 * state, the route re-queries M.1 ([#110](https://github.com/NobuData/ouroboros/issues/110)) from
 * it, and a pasted address is the same view. This module is the two halves of that agreement — a
 * query string read into a {@link BacklogFilter}, and a filter written back as one — plus the bar's
 * copy and the decisions the bar makes that need no DOM: which chip is on, whether anything is
 * filtered, and how the URL's repository and the shell's focus repository are reconciled when the
 * page is arrived at. Framework-free and deliberately not `server-only`: the route parses on the
 * server and the bar writes in the browser, and both must spell the same address.
 *
 * ### Defaults are not written
 *
 * `/issues` is the default view and `/issues?state=open&sort=effort` is the same view, so the second
 * spelling is never produced: every parameter at its default is left out. The default view then has
 * one address — the one the sidebar links to — and **Clear all** is *go to `/issues`* rather than a
 * form reset that leaves a longer address behind. `app/shell/focus-repo.ts` settles the same
 * question the same way for its storage key.
 *
 * ### Unknown values fall back rather than fail
 *
 * A query string is whatever a person typed or an old link carried. `?state=archived` is read as the
 * default state and `?sort=size` as the default sort, so a mistyped link lands on a real view with the
 * bar showing exactly what the server was asked for. Labels are the one open set: a label in the URL
 * that no longer exists in scope is **kept**, and the bar draws it pressed so it can be pressed off —
 * the alternative is a filter the bar cannot show and the reader cannot remove.
 */

import type { BacklogQuery } from "@/app/api/backlog";
import type { EnabledRepo } from "@/app/api/enablement";
import { ISSUES_PATH } from "@/app/paths";
import type { FocusRepo } from "@/app/shell/focus-repo";

/** Which issues the listing is asked for: the state select's three values. */
export type BacklogState = NonNullable<BacklogQuery["state"]>;

/** How the listing is ordered: the sort select's four values. */
export type BacklogSort = NonNullable<BacklogQuery["sort"]>;

/** The bar's five controls, as one value. */
export interface BacklogFilter {
  /** The repository select — `github_repos.id`, or `null` for every repository. */
  readonly repo: string | null;
  /** The chips that are on, in the order they were turned on. ANDed by the service. */
  readonly labels: readonly string[];
  /** The state select. */
  readonly state: BacklogState;
  /** The sort select. */
  readonly sort: BacklogSort;
  /** The search box, trimmed. `""` when nothing is searched for. */
  readonly q: string;
}

/** What one `<option>` of a select says, and what it sends. */
export interface FilterOption<T extends string> {
  /** The value the URL and the query carry. */
  readonly value: T;
  /** The label the select draws. */
  readonly label: string;
}

/**
 * The state select's options, in its order. `open` first because it is the default, and the
 * mockup's — an intake screen is about the work that is still open.
 */
export const STATE_OPTIONS: readonly FilterOption<BacklogState>[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/**
 * The sort select's options, in the ticket's order. *Estimated effort* first because it is the
 * default and the mockup's: the chip order with the unsized last, which is the order a person
 * picking the next piece of work reads the table in.
 */
export const SORT_OPTIONS: readonly FilterOption<BacklogSort>[] = [
  { value: "effort", label: "Sort: estimated effort" },
  { value: "confidence", label: "Sort: confidence" },
  { value: "updated", label: "Sort: updated" },
  { value: "number", label: "Sort: number" },
];

/** The default view: every repository, no chips, open issues, by estimated effort, no search. */
export const DEFAULT_FILTER: BacklogFilter = Object.freeze({
  repo: null,
  labels: Object.freeze([]) as readonly string[],
  state: "open",
  sort: "effort",
  q: "",
});

/* ------------------------------------------------------------------ copy */

/** The bar's accessible name — it is a region of the page, and this is what it is called. */
export const FILTER_BAR_LABEL = "Filter the backlog";

/** The repository select's name, as the mockup's `aria-label` writes it. */
export const REPO_LABEL = "Repository";

/** The repository select's first option — every repository, which is the absence of a choice. */
export const ALL_REPOS_OPTION = "All repos";

/**
 * The option drawn for a repository the URL names and the workspace's enabled list does not — a
 * link into a repository that was since disabled, or a listing that could not be read. The select
 * still shows a selection, because the URL still carries one and the reader has to be able to
 * change it.
 */
export const UNLISTED_REPO_OPTION = "A repository this workspace does not list";

/** The chip set's name. */
export const LABELS_LABEL = "Labels";

/** What the chip set says when the scope has no labels at all. */
export const NO_LABELS_IN_SCOPE = "No labels in scope.";

/** The state select's name, as the mockup's `aria-label` writes it. */
export const STATE_LABEL = "State";

/** The sort select's name, as the mockup's `aria-label` writes it. */
export const SORT_LABEL = "Sort";

/** The search box's name. A placeholder is not a label, so it has one of its own. */
export const SEARCH_LABEL = "Search the backlog";

/** The search box's placeholder, verbatim from the mockup — it is also M.1's `q` semantics. */
export const SEARCH_PLACEHOLDER = "Filter by title, #number, or label…";

/**
 * How long the search box waits after the last keystroke before the URL moves. Long enough that a
 * word typed at speed is one request, short enough that a pause reads as *done*.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** The clear-all control's label. */
export const CLEAR_ALL_LABEL = "Clear all";

/** What clearing all goes back to, as the control's tooltip. */
export const CLEAR_ALL_TITLE =
  "Back to the default view: every repository, no labels, open issues, sorted by estimated effort.";

/** What the bar says over a chip set it could not read. The service's reason follows it. */
export const FACETS_UNREAD = "The labels could not be listed.";

/** What the bar says under a repository select it could not fill. The service's reason follows. */
export const REPOS_UNREAD = "The repositories could not be listed.";

/* ------------------------------------------------------------------ the URL, read */

/** The route's `searchParams`, resolved — a repeated key arrives as an array. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * A request's query string, in the shape the route's `searchParams` arrive in.
 *
 * For the one reader that is handed a URL rather than a `searchParams` promise — the route
 * handler answering the table's poll (`app/api/backlog/route.ts`) — so that it parses the
 * address with the same two functions the page does, and the poll cannot ask for a different
 * view than the one on screen.
 *
 * @param search The query string, parsed.
 * @returns Every key once; a key given twice as an array, in the order given.
 */
export function searchParamsOf(search: URLSearchParams): SearchParams {
  const params: Record<string, string | string[]> = {};

  for (const [key, value] of search) {
    const held = params[key];
    params[key] = held === undefined ? value : Array.isArray(held) ? [...held, value] : [held, value];
  }

  return params;
}

/**
 * One parameter's value, when it is meant to occur once.
 *
 * @param value What the route was given for the key.
 * @returns The value, or the first of several — a repeated `state=` is a mistake, and the first
 *   is as good a guess as any at which one was meant. `undefined` when absent.
 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The chip set, out of the URL.
 *
 * Both spellings the contract accepts are read — `labels=bug,tech-debt` and
 * `labels=bug&labels=tech-debt` — and a label is kept once, in first-seen order, trimmed, and
 * dropped when empty. A label containing a comma is not addressable this way, on this API or in
 * this bar, and that is the contract's own rule rather than this module's.
 *
 * @param value What the route was given for `labels`.
 * @returns The labels, or none.
 */
function parseLabels(value: string | string[] | undefined): readonly string[] {
  const given = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const labels: string[] = [];

  for (const piece of given.flatMap((one) => one.split(","))) {
    const label = piece.trim();
    if (label !== "" && !labels.includes(label)) labels.push(label);
  }

  return labels;
}

/**
 * Whether a string is one of a select's values.
 *
 * @param options The select's options.
 * @param value The string.
 * @returns Whether some option carries it.
 */
function isOption<T extends string>(
  options: readonly FilterOption<T>[],
  value: string | undefined,
): value is T {
  return options.some((option) => option.value === value);
}

/**
 * The filter a query string asks for.
 *
 * @param params The route's `searchParams`, resolved.
 * @returns The filter — every control's value, with anything absent or unrecognised at its
 *   default (see the module note on why unknown values fall back).
 */
export function parseFilter(params: SearchParams): BacklogFilter {
  const repo = first(params.repo)?.trim() ?? "";
  const state = first(params.state);
  const sort = first(params.sort);

  return {
    repo: repo === "" ? null : repo,
    labels: parseLabels(params.labels),
    state: isOption(STATE_OPTIONS, state) ? state : DEFAULT_FILTER.state,
    sort: isOption(SORT_OPTIONS, sort) ? sort : DEFAULT_FILTER.sort,
    q: first(params.q)?.trim() ?? "",
  };
}

/* ------------------------------------------------------------------ the URL, written */

/**
 * The query string a filter is spelled as.
 *
 * Keys in K8's order, defaults left out (the module note), and every value encoded as a URI
 * component — except that the chip set is joined with a literal comma, the contract's compact
 * spelling, rather than the `%2C` `URLSearchParams` would write.
 *
 * @param filter The filter.
 * @returns `?repo=…&labels=…&state=…&sort=…&q=…` with only the parts that differ from the default,
 *   or `""` for the default view.
 */
export function filterSearch(filter: BacklogFilter): string {
  const pairs: string[] = [];

  if (filter.repo !== null) pairs.push(`repo=${encodeURIComponent(filter.repo)}`);
  if (filter.labels.length > 0) {
    pairs.push(`labels=${filter.labels.map((label) => encodeURIComponent(label)).join(",")}`);
  }
  if (filter.state !== DEFAULT_FILTER.state) pairs.push(`state=${filter.state}`);
  if (filter.sort !== DEFAULT_FILTER.sort) pairs.push(`sort=${filter.sort}`);
  if (filter.q !== "") pairs.push(`q=${encodeURIComponent(filter.q)}`);

  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/**
 * The address a filter lives at.
 *
 * @param filter The filter.
 * @returns `/issues` followed by {@link filterSearch}.
 */
export function filterHref(filter: BacklogFilter): string {
  return `${ISSUES_PATH}${filterSearch(filter)}`;
}

/**
 * The query M.1 is asked with for a filter — the same five controls, in the contract's names.
 *
 * `state` and `sort` are always sent, even at their defaults: the service's defaults are the same
 * two values, but a request that says what it wants cannot drift from one that relies on a default
 * the service might one day change. The page is the caller's to add.
 *
 * @param filter The filter.
 * @returns The query, without a page.
 */
export function filterQuery(filter: BacklogFilter): BacklogQuery {
  return {
    ...(filter.repo === null ? {} : { repo: filter.repo }),
    ...(filter.labels.length === 0 ? {} : { labels: [...filter.labels] }),
    state: filter.state,
    sort: filter.sort,
    ...(filter.q === "" ? {} : { q: filter.q }),
  };
}

/* ------------------------------------------------------------------ decisions */

/**
 * Whether anything differs from the default view — what decides whether **Clear all** is drawn.
 *
 * The sort counts, although it narrows nothing: the control resets *the view*, and a table sorted by
 * number is not the default view.
 *
 * @param filter The filter.
 * @returns Whether some control is away from its default.
 */
export function isFiltered(filter: BacklogFilter): boolean {
  return (
    filter.repo !== DEFAULT_FILTER.repo ||
    filter.labels.length > 0 ||
    filter.state !== DEFAULT_FILTER.state ||
    filter.sort !== DEFAULT_FILTER.sort ||
    filter.q !== DEFAULT_FILTER.q
  );
}

/**
 * The filter with one chip pressed — on if it was off, off if it was on.
 *
 * @param filter The filter.
 * @param label The chip.
 * @returns A new filter. Turning a chip on appends it, so the URL reads in the order the chips
 *   were chosen.
 */
export function toggleLabel(filter: BacklogFilter, label: string): BacklogFilter {
  const labels = filter.labels.includes(label)
    ? filter.labels.filter((one) => one !== label)
    : [...filter.labels, label];

  return { ...filter, labels };
}

/**
 * The chips the bar draws: the scope's facets, then any label the URL names that the facets do
 * not — pressed, so it can be pressed off (the module note on labels).
 *
 * @param facets M.1's `labelFacets` — every label in scope, ascending by name.
 * @param labels The filter's labels.
 * @returns The chips, each with whether it is on.
 */
export function chipSet(
  facets: readonly string[],
  labels: readonly string[],
): readonly { readonly label: string; readonly on: boolean }[] {
  const unlisted = labels.filter((label) => !facets.includes(label));

  return [...facets, ...unlisted].map((label) => ({ label, on: labels.includes(label) }));
}

/* ------------------------------------------------------------------ the focus repository */

/**
 * What the bar does about the shell's focus repository (H.1,
 * [#77](https://github.com/NobuData/ouroboros/issues/77)) when the page is arrived at.
 *
 * The two are one choice seen from two places — the header's chip and this bar's select — and the
 * ticket asks that they be kept in sync. Arriving is the one moment they can disagree, and which
 * side wins is decided by what the address says:
 *
 * - **An address that names a repository wins.** A pasted link must reproduce its view, so the
 *   URL's repository is *published* to the header. It is published under the name the enabled list
 *   gives it, since the header paints the name; a repository the list does not carry cannot be
 *   named and is left where it is.
 * - **An address that names none adopts the header's.** The focus repository is *"a filter
 *   preference … narrowing what a screen asks for"*, and a reader who chose one in the header and
 *   then opened the sidebar's **Issues** entry expects that repository's backlog — with the address
 *   saying so, which is what `adopt` does. A stored choice the workspace no longer enables is
 *   dropped instead, which is the correction the header's own menu makes when it opens; with no
 *   list to check against it is trusted, as the header trusts it.
 */
export type FocusArrival =
  /** The header's choice becomes this repository, or none. */
  | { readonly kind: "publish"; readonly repo: FocusRepo | null }
  /** The address should carry this repository. */
  | { readonly kind: "adopt"; readonly repo: string }
  /** The two already agree, or nothing honest can be done about it. */
  | { readonly kind: "settled" };

/**
 * Decide the arrival — see {@link FocusArrival}.
 *
 * @param urlRepo The filter's repository, from the address.
 * @param focus The header's choice, from the store — `null` for every repository.
 * @param known The enabled repositories, or `null` when they could not be listed.
 * @returns What to do.
 */
export function focusArrival(
  urlRepo: string | null,
  focus: FocusRepo | null,
  known: readonly EnabledRepo[] | null,
): FocusArrival {
  if (urlRepo !== null) {
    if (focus?.id === urlRepo) return { kind: "settled" };

    const named = known?.find((repo) => repo.id === urlRepo);
    return named === undefined
      ? { kind: "settled" }
      : { kind: "publish", repo: { id: named.id, name: named.name } };
  }

  if (focus === null) return { kind: "settled" };
  if (known === null || known.some((repo) => repo.id === focus.id)) {
    return { kind: "adopt", repo: focus.id };
  }

  return { kind: "publish", repo: null };
}
