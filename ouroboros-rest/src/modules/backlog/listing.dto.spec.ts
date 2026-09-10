import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { DEFAULT_LIMIT, MAX_LIMIT } from "../tenancy/pagination";
import {
  BACKLOG_SORTS,
  BACKLOG_STATES,
  DEFAULT_BACKLOG_SORT,
  DEFAULT_BACKLOG_STATE,
  ListBacklogQuery,
  MAX_LABEL_FILTERS,
  MAX_LABEL_LENGTH,
  MAX_SEARCH_LENGTH,
  labelList,
} from "./listing.dto";

/**
 * The filter bar as a query string — validated and transformed the way the pipe does it.
 *
 * Decision **K8** makes this shape a contract rather than an implementation detail: a filtered
 * view is a URL somebody pastes to a colleague, so what is asserted here is that the two
 * spellings a real client sends both work, that a cleared control means *no filter* rather than
 * *match nothing*, and that a parameter naming something outside its vocabulary is a `422`
 * before a statement is issued.
 */

/**
 * Run a query string through the pipe's own two steps.
 *
 * @param query - The parameters, as Express parsed them.
 * @returns The instance a handler would receive, and the properties that failed.
 */
async function parse(
  query: Record<string, unknown>,
): Promise<{ value: ListBacklogQuery; failed: string[] }> {
  const value = plainToInstance(ListBacklogQuery, query);
  const failures = await validate(value);

  return { value, failed: failures.map((failure) => failure.property) };
}

describe("reading a repeatable parameter", () => {
  it("splits the spelling a URL-writing filter bar produces", () => {
    expect(labelList("bug,tech-debt")).toEqual(["bug", "tech-debt"]);
  });

  it("takes the spelling most HTTP libraries emit", () => {
    expect(labelList(["bug", "tech-debt"])).toEqual(["bug", "tech-debt"]);
  });

  it("takes both at once, because a client may mix them", () => {
    expect(labelList(["bug,i2c", "watchdog"])).toEqual(["bug", "i2c", "watchdog"]);
  });

  it("trims, because a person editing a URL leaves spaces", () => {
    expect(labelList("bug, tech-debt")).toEqual(["bug", "tech-debt"]);
  });

  it("reads an empty parameter as no filter at all", () => {
    // `?labels=` is how a chip set spells *nothing selected*. Read as a name, it would be a
    // filter no row can satisfy — `github_issues_labels_shape` refuses the empty label.
    expect(labelList("")).toBeUndefined();
    expect(labelList("bug,,")).toEqual(["bug"]);
    expect(labelList(undefined)).toBeUndefined();
  });
});

describe("the backlog query", () => {
  it("accepts a request with no query string, which is the screen's first draw", async () => {
    const { value, failed } = await parse({});

    expect(failed).toEqual([]);
    expect(value.state).toBeUndefined();
    expect(value.sort).toBeUndefined();
    // The defaults are the service's, not the DTO's — `listing.service.ts` says why.
    expect(DEFAULT_BACKLOG_STATE).toBe("open");
    expect(DEFAULT_BACKLOG_SORT).toBe("effort");
  });

  it("accepts the whole filter bar at once", async () => {
    const { value, failed } = await parse({
      repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      labels: "bug,tech-debt",
      state: "open",
      sort: "effort",
      q: "watchdog",
      limit: "10",
      offset: "20",
    });

    expect(failed).toEqual([]);
    expect(value.labels).toEqual(["bug", "tech-debt"]);
    // `@Type(() => Number)` on the window: a query string carries strings, and a handler is
    // handed the numbers its DTO declares.
    expect(value.limit).toBe(10);
    expect(value.offset).toBe(20);
  });

  it("refuses a repository that is not an id", async () => {
    // The id, not the name: a name is unique only inside its GitHub organisation.
    expect((await parse({ repo: "helios-firmware" })).failed).toEqual(["repo"]);
  });

  it.each([...BACKLOG_STATES])("admits the state `%s`", async (state) => {
    expect((await parse({ state })).failed).toEqual([]);
  });

  it.each([...BACKLOG_SORTS])("admits the sort `%s`", async (sort) => {
    expect((await parse({ sort })).failed).toEqual([]);
  });

  it("refuses a state and a sort it does not serve", async () => {
    // A `422` naming the field rather than a silent fallback: a client that misspelt `closed`
    // should be told, not shown the open issues it did not ask for.
    expect((await parse({ state: "merged" })).failed).toEqual(["state"]);
    expect((await parse({ sort: "risk" })).failed).toEqual(["sort"]);
  });

  it("reads a cleared search box as no search", async () => {
    // A person clearing the box sends `?q=`. Matching nothing at the moment they asked to see
    // everything is the one behaviour a search must not have.
    const { value, failed } = await parse({ q: "   " });

    expect(failed).toEqual([]);
    expect(value.q).toBeUndefined();
  });

  it("trims a search before judging its length", async () => {
    expect((await parse({ q: "  watchdog  " })).value.q).toBe("watchdog");
  });

  it("refuses a search longer than the box could hold", async () => {
    expect((await parse({ q: "x".repeat(MAX_SEARCH_LENGTH + 1) })).failed).toEqual(["q"]);
    expect((await parse({ q: "x".repeat(MAX_SEARCH_LENGTH) })).failed).toEqual([]);
  });

  it("refuses more labels than an issue may carry", async () => {
    // GitHub's own cap, mirrored by `github_issues_labels_shape`. A request naming 101 labels
    // is asking for a row the database cannot hold.
    const names = Array.from({ length: MAX_LABEL_FILTERS + 1 }, (_, index) => `label-${index}`);

    expect((await parse({ labels: names })).failed).toEqual(["labels"]);
    expect((await parse({ labels: names.slice(1) })).failed).toEqual([]);
  });

  it("refuses a label longer than GitHub allows one to be", async () => {
    expect((await parse({ labels: "x".repeat(MAX_LABEL_LENGTH + 1) })).failed).toEqual(["labels"]);
    expect((await parse({ labels: "x".repeat(MAX_LABEL_LENGTH) })).failed).toEqual([]);
  });

  it("inherits the window convention rather than restating it", async () => {
    // #31's `limit`/`offset`, extended: one definition, one set of messages when they are wrong.
    expect((await parse({ limit: String(MAX_LIMIT + 1) })).failed).toEqual(["limit"]);
    expect((await parse({ offset: "-1" })).failed).toEqual(["offset"]);
    expect(DEFAULT_LIMIT).toBe(25);
  });
});
