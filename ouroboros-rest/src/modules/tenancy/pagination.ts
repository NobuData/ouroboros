/**
 * The pagination convention every list endpoint in this API follows.
 *
 * One convention, written once, because the alternative is five list endpoints that each
 * decided for themselves — and a UI that has to remember which. The screens that consume it
 * are the settings tables in mockup 17 and the run lists in mockup 02, which is where
 * `docs/ROADMAP_MOCKUP_02_DASHBOARD.md` says "pagination per the #31 convention".
 *
 * ```json
 * { "items": [ … ], "total": 42, "limit": 25, "offset": 0 }
 * ```
 *
 * Three decisions:
 *
 *   * **Offset and limit, not a cursor.** These lists are a tenant's domains, its members,
 *     the orgs it has enabled — sets that are small, that a person reads in a table with
 *     page numbers, and that nobody scrolls infinitely. A cursor buys stability under
 *     concurrent inserts and costs the "page 4 of 9" a settings screen wants to render; for
 *     a feed of runs it would be the right trade, and this convention does not have to be
 *     the one that feed uses.
 *   * **`total` is always counted.** It is the field that makes a page count renderable, and
 *     over tables of this size the extra `count(*)` is cheaper than the round trip a client
 *     would otherwise make to discover the same number.
 *   * **The window is echoed back.** `limit` and `offset` in the response are what the
 *     server actually applied, defaults and clamping included — so a client that sent
 *     neither can still compute the next offset without knowing this file's defaults.
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** Rows returned when a request names no `limit`. Large enough for a settings table. */
export const DEFAULT_LIMIT = 25;

/**
 * Most rows one request may ask for.
 *
 * A ceiling rather than a suggestion: without it, `?limit=1000000` is a client's way of
 * asking this service to hold a table in memory and serialise it, and the request that does
 * it is indistinguishable from a mistake in a loop.
 */
export const MAX_LIMIT = 100;

/** Where a request that names no `offset` starts: the beginning. */
export const DEFAULT_OFFSET = 0;

/**
 * The query string of every list endpoint.
 *
 * Extended rather than repeated by an endpoint that filters on something as well, so the two
 * window parameters keep one definition — and one set of messages when they are wrong.
 */
export class PageQuery {
  /**
   * How many rows to return. 1–{@link MAX_LIMIT}; defaults to {@link DEFAULT_LIMIT}.
   *
   * `@Type` is what turns the string a query string always carries into the number `@IsInt`
   * is about: the global pipe transforms, and without the hint every numeric query parameter
   * would fail its own validation.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  /** How many rows to skip. Zero or more; defaults to 0. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** The window a repository is asked for, with the defaults already applied. */
export interface PageWindow {
  limit: number;
  offset: number;
}

/** One page of rows, as every list endpoint answers. */
export interface Page<T> extends PageWindow {
  /** The rows themselves, in the endpoint's documented order. */
  items: T[];
  /** How many rows there are in total, ignoring the window. */
  total: number;
}

/**
 * Resolve a query string into the window a repository takes.
 *
 * @param query - What the client asked for. Both fields are optional and both are already
 *   known to be in range — the pipe rejected them otherwise — so this only fills in what was
 *   left out.
 * @returns The window, with defaults applied.
 */
export function windowOf(query: PageQuery = {}): PageWindow {
  return { limit: query.limit ?? DEFAULT_LIMIT, offset: query.offset ?? DEFAULT_OFFSET };
}

/**
 * Assemble a page from what a repository returned.
 *
 * @param items - The rows for this window, already mapped to their API representation.
 * @param total - How many rows match without the window.
 * @param window - The window that was applied.
 * @returns The body of a list response.
 */
export function pageOf<T>(items: T[], total: number, window: PageWindow): Page<T> {
  return { items, total, limit: window.limit, offset: window.offset };
}
