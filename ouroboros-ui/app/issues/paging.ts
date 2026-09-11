/**
 * The backlog's page — the one piece of the table's address the filter bar does not own
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * Decision K8 puts the bar's five controls in `?repo=&labels=&state=&sort=&q=`, and the page
 * joins them as `&page=` for the same reason: a pasted address reproduces the view, and a
 * table drawn from the address cannot disagree with the address. It is **not** part of
 * `BacklogFilter`, deliberately. The bar navigates with `filterHref(next)`, which spells the
 * filter and nothing else, so every press the bar makes lands on the first page of the new
 * view — a chip pressed on page three of the old view must not ask for page three of a view
 * that may have one. Keeping the page beside the filter rather than inside it is what makes
 * that a property of the address rather than a rule every control has to remember.
 *
 * M.1 speaks `limit`/`offset` (the #31 convention, not `&page=`), so this module is also
 * where a page number becomes an offset — once, for the route's read and the browser's poll
 * alike, so the two cannot ask for different rows.
 *
 * Framework-free and deliberately not `server-only`: the route parses on the server, the
 * footer writes in the browser, and the poll's URL is spelled the same way in both.
 */

import type { BacklogQuery } from "@/app/api/backlog";
import { ISSUES_PATH } from "@/app/paths";

import { type BacklogFilter, type SearchParams, filterQuery, filterSearch } from "./filter";

/**
 * How many rows a page holds — M.1's own default, written down so the route's read and the
 * footer's arithmetic cannot drift from each other. The contract's ceiling is a hundred.
 */
export const PAGE_SIZE = 25;

/** The address's parameter. */
export const PAGE_PARAM = "page";

/** The first page — the default, and therefore never written. */
export const FIRST_PAGE = 1;

/* ------------------------------------------------------------------ copy */

/** The footer's accessible name — it is a navigation between pages, and this is what it is called. */
export const PAGES_LABEL = "Backlog pages";

/** The control that goes back one page. */
export const PREVIOUS_LABEL = "← Previous";

/** The control that goes on one page. */
export const NEXT_LABEL = "Next →";

/** Why **Previous** is inert on the first page. */
export const FIRST_PAGE_REASON = "This is the first page of the backlog.";

/** Why **Next** is inert on the last. */
export const LAST_PAGE_REASON = "This is the last page of the backlog.";

/** What the table says over a page the address asked for that the backlog does not have. */
export const PAST_END = "This page is past the end of the backlog";

/** The way back from it. */
export const FIRST_PAGE_LABEL = "Back to the first page";

/* ------------------------------------------------------------------ the URL, read */

/**
 * The page a query string asks for.
 *
 * @param params The route's `searchParams`, resolved.
 * @returns The page, or the first when the parameter is absent, repeated, or not a whole
 *   number above zero — `?page=0`, `?page=two` and `?page=1.5` all land on a real page rather
 *   than failing, which is the rule `parseFilter` keeps for its own controls.
 */
export function parsePage(params: SearchParams): number {
  const raw = params[PAGE_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return FIRST_PAGE;

  const page = Number(value.trim());
  return Number.isInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
}

/* ------------------------------------------------------------------ the URL, written */

/**
 * The query string a filter and a page are spelled as.
 *
 * The filter's own spelling, then `page=` — left out on the first page, for the reason every
 * default is left out of the address: the default view has one address.
 *
 * @param filter The filter.
 * @param page The page.
 * @returns `?repo=…&page=2`, `?page=2`, or `""` for the default view's first page.
 */
export function pageSearch(filter: BacklogFilter, page: number): string {
  const search = filterSearch(filter);
  if (page <= FIRST_PAGE) return search;

  return `${search === "" ? "?" : `${search}&`}${PAGE_PARAM}=${page}`;
}

/**
 * The address a page of a filtered view lives at.
 *
 * @param filter The filter.
 * @param page The page.
 * @returns `/issues` followed by {@link pageSearch}.
 */
export function pageHref(filter: BacklogFilter, page: number): string {
  return `${ISSUES_PATH}${pageSearch(filter, page)}`;
}

/**
 * The query M.1 is asked with for one page of a filtered view.
 *
 * @param filter The filter.
 * @param page The page.
 * @returns The filter's query with the page as `limit`/`offset`.
 */
export function pageQuery(filter: BacklogFilter, page: number): BacklogQuery {
  return { ...filterQuery(filter), limit: PAGE_SIZE, offset: (page - FIRST_PAGE) * PAGE_SIZE };
}

/* ------------------------------------------------------------------ the footer */

/** What one page of a listing says about where it sits in the whole. */
export interface Pagination {
  /** The mockup-less line the footer prints: `1–25 of 42`. */
  readonly range: string;
  /** The page before this one, or `null` on the first. */
  readonly previous: number | null;
  /** The page after this one, or `null` on the last. */
  readonly next: number | null;
  /**
   * Whether the address asked for a page the backlog does not have — rows exist, and none of
   * them are on this page. A filter narrowed while on a late page is how a reader gets here.
   */
  readonly pastEnd: boolean;
}

/** The three figures a footer is drawn from — a listing's own, by name. */
export interface PageOfListing {
  /** How many rows this page carries. */
  readonly shown: number;
  /** How many rows the whole filtered view has — the listing's `total`. */
  readonly total: number;
  /** How many rows this page skipped — the listing's `offset`. */
  readonly offset: number;
}

/**
 * How many pages a view has.
 *
 * @param total The listing's `total`.
 * @returns At least one: an empty view still has a first page, which is where its empty
 *   state is drawn.
 */
export function pageCount(total: number): number {
  return Math.max(FIRST_PAGE, Math.ceil(Math.max(0, total) / PAGE_SIZE));
}

/**
 * Whether the footer is drawn at all — only for a backlog beyond a page, or for an address
 * that has run past the end of one, where the way back has to be drawn somewhere.
 *
 * @param pagination The footer's decisions.
 * @param total The listing's `total`.
 * @returns Whether to draw it.
 */
export function isPaged(pagination: Pagination, total: number): boolean {
  return pagination.pastEnd || total > PAGE_SIZE;
}

/**
 * The footer's decisions, out of one page of a listing.
 *
 * @param listing The page's three figures.
 * @param page Which page the address asked for.
 * @returns The decisions.
 */
export function pagination(listing: PageOfListing, page: number): Pagination {
  const pages = pageCount(listing.total);
  const pastEnd = listing.total > 0 && listing.shown === 0;

  return {
    // `0 of 42` for a page with nothing on it, rather than a span that ends before it starts.
    range:
      listing.shown === 0
        ? `0 of ${listing.total}`
        : `${listing.offset + 1}–${listing.offset + listing.shown} of ${listing.total}`,
    previous: page > FIRST_PAGE ? page - 1 : null,
    next: page < pages ? page + 1 : null,
    pastEnd,
  };
}
