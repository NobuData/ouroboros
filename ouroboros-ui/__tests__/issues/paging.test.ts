import { describe, expect, it } from "vitest";

import { type BacklogFilter, DEFAULT_FILTER, filterSearch } from "@/app/issues/filter";
import {
  FIRST_PAGE,
  PAGE_SIZE,
  isPaged,
  pageCount,
  pageHref,
  pageQuery,
  pageSearch,
  pagination,
  parsePage,
} from "@/app/issues/paging";

import { HELIOS } from "../helpers/issues";

/**
 * The backlog's page in the address (#117).
 *
 * The page rides beside the filter's five controls as `&page=`, is left out on the first page as
 * every default is, and becomes M.1's `limit`/`offset` in exactly one place — so the route's read
 * and the browser's poll cannot ask for different rows. The footer's arithmetic is the other half:
 * where a page sits, which controls are live, and whether the address has run past the end.
 */

/** A filtered view, for the cases about the page riding beside the filter. */
const FILTERED: BacklogFilter = { ...DEFAULT_FILTER, repo: HELIOS.id, labels: ["bug"] };

describe("parsePage", () => {
  it("reads a whole number above zero", () => {
    expect(parsePage({ page: "3" })).toBe(3);
    expect(parsePage({ page: " 4 " })).toBe(4);
  });

  it("lands on the first page for anything else, rather than failing", () => {
    expect(parsePage({})).toBe(FIRST_PAGE);
    expect(parsePage({ page: "0" })).toBe(FIRST_PAGE);
    expect(parsePage({ page: "-2" })).toBe(FIRST_PAGE);
    expect(parsePage({ page: "two" })).toBe(FIRST_PAGE);
    expect(parsePage({ page: "1.5" })).toBe(FIRST_PAGE);
    expect(parsePage({ page: "" })).toBe(FIRST_PAGE);
  });

  it("takes the first of a repeated parameter", () => {
    expect(parsePage({ page: ["2", "5"] })).toBe(2);
  });
});

describe("the address", () => {
  it("is the filter's alone on the first page — the default is never written", () => {
    expect(pageSearch(DEFAULT_FILTER, FIRST_PAGE)).toBe("");
    expect(pageSearch(FILTERED, FIRST_PAGE)).toBe(filterSearch(FILTERED));
  });

  it("adds the page after the filter's controls, in K8's spelling", () => {
    expect(pageSearch(DEFAULT_FILTER, 2)).toBe("?page=2");
    expect(pageSearch(FILTERED, 3)).toBe(`${filterSearch(FILTERED)}&page=3`);
  });

  it("lives under /issues", () => {
    expect(pageHref(DEFAULT_FILTER, 2)).toBe("/issues?page=2");
    expect(pageHref(DEFAULT_FILTER, FIRST_PAGE)).toBe("/issues");
  });

  it("round-trips through parsePage", () => {
    const search = new URLSearchParams(pageSearch(FILTERED, 7));

    expect(parsePage({ page: search.get("page") ?? undefined })).toBe(7);
  });
});

describe("the query M.1 is asked with", () => {
  it("is the filter's, one page long, offset by the pages before it", () => {
    expect(pageQuery(FILTERED, FIRST_PAGE)).toEqual({
      repo: HELIOS.id,
      labels: ["bug"],
      state: "open",
      sort: "effort",
      limit: PAGE_SIZE,
      offset: 0,
    });
    expect(pageQuery(DEFAULT_FILTER, 3)).toMatchObject({ limit: PAGE_SIZE, offset: PAGE_SIZE * 2 });
  });
});

describe("pageCount", () => {
  it("has at least one page, even for an empty view, so its empty state has somewhere to be drawn", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(-3)).toBe(1);
  });

  it("rounds up", () => {
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(42)).toBe(2);
    expect(pageCount(PAGE_SIZE * 4)).toBe(4);
  });
});

describe("pagination", () => {
  it("on the first of two pages: the range, no previous, a next", () => {
    expect(pagination({ shown: PAGE_SIZE, total: 42, offset: 0 }, 1)).toEqual({
      range: "1–25 of 42",
      previous: null,
      next: 2,
      pastEnd: false,
    });
  });

  it("on the last: the range to the end, a previous, no next", () => {
    expect(pagination({ shown: 17, total: 42, offset: PAGE_SIZE }, 2)).toEqual({
      range: "26–42 of 42",
      previous: 1,
      next: null,
      pastEnd: false,
    });
  });

  it("past the end: rows exist and none are here, with the way back", () => {
    expect(pagination({ shown: 0, total: 42, offset: PAGE_SIZE * 2 }, 3)).toEqual({
      range: "0 of 42",
      previous: 2,
      next: null,
      pastEnd: true,
    });
  });

  it("is not past the end of a view that has no rows at all", () => {
    expect(pagination({ shown: 0, total: 0, offset: 0 }, 1)).toMatchObject({
      range: "0 of 0",
      pastEnd: false,
    });
  });
});

describe("isPaged", () => {
  it("draws the footer only for a backlog beyond a page, or an address past the end of one", () => {
    expect(isPaged(pagination({ shown: 9, total: 9, offset: 0 }, 1), 9)).toBe(false);
    expect(isPaged(pagination({ shown: PAGE_SIZE, total: PAGE_SIZE, offset: 0 }, 1), PAGE_SIZE)).toBe(false);
    expect(isPaged(pagination({ shown: PAGE_SIZE, total: PAGE_SIZE + 1, offset: 0 }, 1), PAGE_SIZE + 1)).toBe(true);
    expect(isPaged(pagination({ shown: 0, total: 9, offset: PAGE_SIZE }, 2), 9)).toBe(true);
  });
});
