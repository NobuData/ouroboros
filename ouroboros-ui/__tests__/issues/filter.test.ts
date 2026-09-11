import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type BacklogFilter,
  DEFAULT_FILTER,
  REPO_LABEL,
  SEARCH_PLACEHOLDER,
  SORT_LABEL,
  SORT_OPTIONS,
  STATE_LABEL,
  STATE_OPTIONS,
  chipSet,
  filterHref,
  filterQuery,
  filterSearch,
  focusArrival,
  isFiltered,
  parseFilter,
  toggleLabel,
} from "@/app/issues/filter";

import { ATLAS, HELIOS, SEEDED_FACETS, SEEDED_REPOS } from "../helpers/issues";

/**
 * The filter bar's state, as data (#116).
 *
 * Decision K8 says the bar is a query-string editor, and this suite is that sentence held to: a
 * filter written as a query string and read back is the same filter, the default view has one
 * address, every unknown value falls back to a real one, and the query M.1 is asked with is the
 * same five controls. The copy is compared with `docs/mockups/03-issues.html` itself rather than
 * typed twice. The one decision with any weight — what the bar does about the header's focus
 * repository on arrival — is a table.
 */

/** The mockup this bar is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "03-issues.html"),
  "utf8",
);

/** The mockup's filter bar alone — from its comment to the grid that follows it. */
const BAR = MOCKUP.slice(MOCKUP.indexOf("<!-- filter bar -->"), MOCKUP.indexOf('<div class="grid">'));

/** A filter with every control away from its default. */
const EVERYTHING: BacklogFilter = {
  repo: HELIOS.id,
  labels: ["bug", "tech-debt"],
  state: "closed",
  sort: "updated",
  q: "watchdog",
};

/**
 * A query string as the route receives it — decoded, one value per key.
 *
 * @param search What {@link filterSearch} wrote.
 * @returns The route's `searchParams`.
 */
function received(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

describe("the copy, against the mockup", () => {
  it("names the three selects as the mockup's aria-labels do, in its order", () => {
    const labels = [...BAR.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);

    expect(labels).toEqual([REPO_LABEL, STATE_LABEL, SORT_LABEL]);
  });

  it("takes the search placeholder verbatim", () => {
    expect(BAR).toContain(`placeholder="${SEARCH_PLACEHOLDER}"`);
  });

  it("draws the mockup's four chips, with the same one on", () => {
    // `<span class="tag chip-on">bug ✓</span>` and three plain tags. The mockup's *order* is design
    // copy — M.1's facets are ascending by name, so a person can scan them for a name — and the
    // set and the pressed one are what is held to it.
    const tags = [...BAR.matchAll(/<span class="tag( chip-on)?">([^<]*?)( ✓)?<\/span>/g)].map(
      (match) => ({ label: match[2]!, on: match[1] !== undefined }),
    );
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

    expect(tags).toHaveLength(4);
    expect([...chipSet(SEEDED_FACETS, ["bug"])].sort(byName)).toEqual([...tags].sort(byName));
    expect(SEEDED_FACETS).toEqual([...SEEDED_FACETS].sort());
  });

  it("defaults the state and the sort to what the mockup's selects show", () => {
    expect(BAR).toContain(`<option>${STATE_OPTIONS[0]!.label} ▾</option>`);
    expect(BAR).toContain(`<option>${SORT_OPTIONS[0]!.label} ▾</option>`);
    expect(DEFAULT_FILTER.state).toBe(STATE_OPTIONS[0]!.value);
    expect(DEFAULT_FILTER.sort).toBe(SORT_OPTIONS[0]!.value);
  });
});

describe("reading the address", () => {
  it("reads nothing as the default view", () => {
    expect(parseFilter({})).toEqual(DEFAULT_FILTER);
  });

  it("reads every control", () => {
    expect(
      parseFilter({
        repo: HELIOS.id,
        labels: "bug,tech-debt",
        state: "closed",
        sort: "updated",
        q: " watchdog ",
      }),
    ).toEqual(EVERYTHING);
  });

  it("reads both spellings of the chip set, once each, trimmed, and without the empties", () => {
    expect(parseFilter({ labels: ["bug", " bug , tech-debt", "", " "] }).labels).toEqual([
      "bug",
      "tech-debt",
    ]);
  });

  it("falls back to the default state and sort for a value it does not know", () => {
    const filter = parseFilter({ state: "archived", sort: "size" });

    expect(filter.state).toBe(DEFAULT_FILTER.state);
    expect(filter.sort).toBe(DEFAULT_FILTER.sort);
  });

  it("takes the first of a repeated single-valued key", () => {
    expect(parseFilter({ state: ["closed", "open"] }).state).toBe("closed");
  });

  it("reads an empty repository and a blank search as their absence", () => {
    const filter = parseFilter({ repo: " ", q: "   " });

    expect(filter.repo).toBeNull();
    expect(filter.q).toBe("");
  });
});

describe("writing the address", () => {
  it("writes the default view as the bare route", () => {
    expect(filterSearch(DEFAULT_FILTER)).toBe("");
    expect(filterHref(DEFAULT_FILTER)).toBe("/issues");
  });

  it("writes every control, in K8's order", () => {
    expect(filterHref(EVERYTHING)).toBe(
      `/issues?repo=${HELIOS.id}&labels=bug,tech-debt&state=closed&sort=updated&q=watchdog`,
    );
  });

  it("leaves a control at its default out, so one view has one address", () => {
    expect(filterSearch({ ...DEFAULT_FILTER, state: "open", sort: "effort" })).toBe("");
    expect(filterSearch({ ...DEFAULT_FILTER, sort: "number" })).toBe("?sort=number");
  });

  it("encodes what needs encoding, and keeps the chip set's comma literal", () => {
    expect(
      filterSearch({ ...DEFAULT_FILTER, labels: ["needs triage", "a&b"], q: "I²C bus" }),
    ).toBe("?labels=needs%20triage,a%26b&q=I%C2%B2C%20bus");
  });

  it.each([
    ["the default view", DEFAULT_FILTER],
    ["every control", EVERYTHING],
    ["a search with spaces and a hash", { ...DEFAULT_FILTER, q: "#485 bus lockup" }],
    ["labels with spaces", { ...DEFAULT_FILTER, labels: ["needs triage", "good first issue"] }],
  ])("round-trips %s", (_name, filter) => {
    // The acceptance criterion: pasting the address reproduces the view.
    expect(parseFilter(received(filterSearch(filter)))).toEqual(filter);
  });
});

describe("the query M.1 is asked with", () => {
  it("always names the state and the sort, and nothing else at its default", () => {
    expect(filterQuery(DEFAULT_FILTER)).toEqual({ state: "open", sort: "effort" });
  });

  it("carries every control by the contract's name", () => {
    expect(filterQuery(EVERYTHING)).toEqual({
      repo: HELIOS.id,
      labels: ["bug", "tech-debt"],
      state: "closed",
      sort: "updated",
      q: "watchdog",
    });
  });
});

describe("isFiltered", () => {
  it("is false for the default view", () => {
    expect(isFiltered(DEFAULT_FILTER)).toBe(false);
  });

  it.each([
    ["a repository", { repo: HELIOS.id }],
    ["a chip", { labels: ["bug"] }],
    ["a state", { state: "all" as const }],
    ["a sort, which narrows nothing but is not the default view", { sort: "number" as const }],
    ["a search", { q: "bus" }],
  ])("is true with %s", (_name, over) => {
    expect(isFiltered({ ...DEFAULT_FILTER, ...over })).toBe(true);
  });
});

describe("toggleLabel", () => {
  it("turns a chip on by appending it, so the address reads in the order chosen", () => {
    expect(toggleLabel({ ...DEFAULT_FILTER, labels: ["tech-debt"] }, "bug").labels).toEqual([
      "tech-debt",
      "bug",
    ]);
  });

  it("turns a chip off, and is its own inverse", () => {
    const on = toggleLabel(DEFAULT_FILTER, "bug");

    expect(on.labels).toEqual(["bug"]);
    expect(toggleLabel(on, "bug")).toEqual(DEFAULT_FILTER);
  });
});

describe("chipSet", () => {
  it("draws the facets in the service's order, on where the address says so", () => {
    expect(chipSet(SEEDED_FACETS, ["tech-debt"])).toEqual([
      { label: "bug", on: false },
      { label: "enhancement", on: false },
      { label: "good-first-issue", on: false },
      { label: "tech-debt", on: true },
    ]);
  });

  it("keeps a label the address names and the facets do not, on and last, so it can be turned off", () => {
    expect(chipSet(["bug"], ["retired", "bug"])).toEqual([
      { label: "bug", on: true },
      { label: "retired", on: true },
    ]);
  });

  it("is empty when nothing is in scope and nothing is asked for", () => {
    expect(chipSet([], [])).toEqual([]);
  });
});

describe("focusArrival", () => {
  const helios = { id: HELIOS.id, name: HELIOS.name };
  const atlas = { id: ATLAS.id, name: ATLAS.name };
  const stale = { id: "5eed0006-0000-4000-8000-00000000dead", name: "retired-repo" };

  it.each([
    ["nothing on either side", null, null, SEEDED_REPOS, { kind: "settled" }],
    ["the two already agreeing", HELIOS.id, helios, SEEDED_REPOS, { kind: "settled" }],
    // The address wins: a pasted link reproduces its view, and the header follows.
    ["the address naming a repository the header does not", HELIOS.id, atlas, SEEDED_REPOS, { kind: "publish", repo: helios }],
    ["the address naming a repository and the header none", HELIOS.id, null, SEEDED_REPOS, { kind: "publish", repo: helios }],
    // …unless it cannot be named to a header that paints the name.
    ["the address naming a repository the list does not carry", stale.id, atlas, SEEDED_REPOS, { kind: "settled" }],
    ["the address naming a repository and no list to name it by", HELIOS.id, atlas, null, { kind: "settled" }],
    // The header's choice applies to a bare address, and the address says so.
    ["a bare address and a header choice", null, helios, SEEDED_REPOS, { kind: "adopt", repo: HELIOS.id }],
    ["a bare address, a header choice and no list to check it by", null, helios, null, { kind: "adopt", repo: HELIOS.id }],
    // A choice the workspace no longer enables is dropped, as the header's own menu drops it.
    ["a bare address and a stale header choice", null, stale, SEEDED_REPOS, { kind: "publish", repo: null }],
  ])("settles %s", (_name, urlRepo, focus, known, expected) => {
    expect(focusArrival(urlRepo, focus, known)).toEqual(expected);
  });
});
