import {
  INDEX_ORG,
  MemoryHistoryIndex,
  OTHER_ORG,
  entry,
  fixtureCorpus,
} from "../../../history/history-index.store.fixture";
import type { ToolCallContext, ToolResult } from "../../research-tool.adapter";
import { resultViolations } from "../../research-tool.citations";
import { ResearchToolError } from "../../research-tool.errors";
import { renderSubLine } from "../../research-tool.health";
import {
  CITED_BUCKETS,
  CITED_PER_BUCKET,
  SEARCH_BUDGET_MS,
  TicketsResearchTool,
  subLineOf,
} from "./tickets.tool";

/**
 * The issue & PR history index tool (CL.5, #618), over an in-memory index. What PostgreSQL does
 * with a query — ranking, stemming, the latency budget — is `history-index.integration-spec.ts`'s.
 */

const NOW = new Date("2026-09-30T12:00:00Z");

const context = (organizationId = INDEX_ORG, config = {}): ToolCallContext => ({
  organizationId,
  investigationId: "5eed0091-0000-4000-8000-000000000124",
  config,
  secret: null,
  tokenCeiling: null,
});

function build(index = new MemoryHistoryIndex()) {
  return { index, tool: new TicketsResearchTool(index, () => NOW) };
}

/** The class a call is refused with. */
async function refusal(work: Promise<ToolResult>): Promise<[string, string]> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ResearchToolError) return [error.errorClass, error.detail];
    throw error;
  }
  throw new Error("the call was answered");
}

interface Hit {
  locator: string;
  kind: string;
  [field: string]: unknown;
}

describe("the tools card row", () => {
  it("is mockup 22's fourth row, with a sub-line counted from the index", async () => {
    const { tool } = build();

    expect(tool.slug).toBe("tickets");
    expect(tool.displayMeta()).toEqual({
      name: "Issue & PR history index",
      glyph: "▤",
      subLine: "{issues} · {prs} · {imports}",
    });
    expect(tool.capabilities()).toEqual({ search: false, fetch: false, query: true, watch: false });
    expect(renderSubLine(tool.displayMeta().subLine, await tool.counts(INDEX_ORG))).toBe(
      "3 issues · 1 pull request · Support churn interviews Q2",
    );
  });

  it("counts what is indexed — a ticket more is an issue more", async () => {
    const { index, tool } = build();
    index.entries.push(entry({ locator: "issue-index://support/SUP-9", title: "One more" }));

    expect((await tool.counts(INDEX_ORG)).issues).toBe("4 issues");
  });

  it("formats thousands, counts sets past two, and says when there are none", () => {
    expect(subLineOf({ tickets: 3412, pullRequests: 1, documents: 14, sets: ["A", "B"] })).toEqual({
      issues: "3,412 issues",
      prs: "1 pull request",
      imports: "A, B",
    });
    expect(subLineOf({ tickets: 1, pullRequests: 0, documents: 0, sets: ["A", "B", "C"] })).toEqual(
      { issues: "1 issue", prs: "0 pull requests", imports: "3 imported sets" },
    );
    expect(subLineOf({ tickets: 0, pullRequests: 0, documents: 0, sets: [] }).imports).toBe(
      "no imported sets",
    );
  });

  it("renders unknown counts when the index cannot be read, and never rejects", async () => {
    const tool = new TicketsResearchTool({
      summary: () => Promise.reject(new Error("gone")),
    } as never);

    expect(await tool.counts(INDEX_ORG)).toEqual({ issues: null, prs: null, imports: null });
  });
});

describe("health", () => {
  it("is idle unconfigured, and for an empty index says what to do", async () => {
    const { tool } = build();

    expect(await tool.healthCheck(null, null, INDEX_ORG)).toEqual({
      state: "not_configured",
      detail: "not configured",
    });
    expect(await tool.healthCheck({}, null, OTHER_ORG)).toEqual({
      state: "not_configured",
      detail: "nothing indexed yet — connect a ticket source or import a document set",
    });
  });

  it("is healthy with what is indexed", async () => {
    expect(await build().tool.healthCheck({}, null, INDEX_ORG)).toEqual({
      state: "healthy",
      detail: "3 issues · 1 pull request · Support churn interviews Q2",
    });
  });
});

describe("search", () => {
  it("answers ranked hits, each cited as an issue-index:// source with its excerpt", async () => {
    const result = await build().tool.query(context(), { op: "search", q: "docking abort churn" });
    const payload = result.payload as { hits: Hit[] };

    expect(resultViolations(result, null)).toEqual([]);
    // The set mentions every term; the rest mention some.
    expect(payload.hits[0]).toMatchObject({
      locator: "issue-index://support/churn-2026-q2",
      kind: "document_set",
      matchedEveryTerm: true,
    });
    expect(payload.hits.map((hit) => hit.locator)).toEqual(
      expect.arrayContaining([
        "issue-index://github-acme-robotics/498",
        "issue-index://support/SUP-2214",
        "issue-index://github-acme-robotics/pull/512",
        "issue-index://support/churn-2026-q2/acct-01",
      ]),
    );
    expect(result.sources.map((source) => source.locator)).toEqual(
      payload.hits.map((hit) => hit.locator),
    );
    expect(result.sources[0]).toEqual({
      kind: "ticket",
      title: "Support churn interviews Q2",
      locator: "issue-index://support/churn-2026-q2",
      retrievedAt: NOW.toISOString(),
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as string,
      excerpt:
        'Exit interviews with churned accounts. 9 of 14 cite docking reliability; several said the drone "gives up" after one abort.',
      meta: {
        entry: "document_set",
        set: "support/churn-2026-q2",
        ref: "churn-2026-q2",
        occurredAt: "2026-07-01T00:00:00.000Z",
        query: { op: "search", q: "docking abort churn" },
      },
    });
    expect(result.usage).toEqual({ tokens: 0 });
  });

  it("gives a ticket from a second tracker the same shape as a GitHub-fed one", async () => {
    const result = await build().tool.query(context(), {
      op: "search",
      q: "docking",
      kinds: ["ticket"],
    });
    const [first, second] = (result.payload as { hits: Hit[] }).hits;

    expect(Object.keys(first)).toEqual(Object.keys(second));
    expect(new Set([first.locator, second.locator])).toEqual(
      new Set(["issue-index://github-acme-robotics/498", "issue-index://support/SUP-2214"]),
    );
    expect(Object.keys(result.sources[0]).sort()).toEqual(Object.keys(result.sources[1]).sort());
    // Nothing in the answer says which tracker fed either.
    expect(JSON.stringify(result)).not.toMatch(/"(github|jira|linear|gitlab|custom)"/);
  });

  it("narrows by kind, label, date, repository and set", async () => {
    const { tool } = build();
    const locators = async (filters: Record<string, unknown>): Promise<string[]> => {
      const result = await tool.query(context(), { op: "search", q: "docking abort", ...filters });
      return ((result.payload as { hits: Hit[] } | null)?.hits ?? []).map((hit) => hit.locator);
    };

    expect(await locators({ kinds: ["pr"] })).toEqual([
      "issue-index://github-acme-robotics/pull/512",
    ]);
    expect(await locators({ labels: ["support"] })).toEqual(["issue-index://support/SUP-2214"]);
    expect(await locators({ since: "2026-09-01", until: "2026-09-04" })).toEqual([
      "issue-index://support/SUP-2214",
    ]);
    expect(await locators({ repo: "Helios-Firmware", kinds: ["ticket"] })).toEqual([
      "issue-index://github-acme-robotics/498",
    ]);
    expect(await locators({ set: "support/churn-2026-q2", kinds: ["document"] })).toEqual([
      "issue-index://support/churn-2026-q2/acct-01",
    ]);
  });

  it("honours the limit, and asks the index under the declared budget", async () => {
    const index = new MemoryHistoryIndex();
    const search = jest.spyOn(index, "search");
    const result = await new TicketsResearchTool(index, () => NOW).query(context(), {
      op: "search",
      q: "docking",
      limit: 2,
    });

    expect((result.payload as { hits: Hit[] }).hits).toHaveLength(2);
    expect(search).toHaveBeenCalledWith(INDEX_ORG, "docking", {}, 2, SEARCH_BUDGET_MS);
    expect(SEARCH_BUDGET_MS).toBe(500);
  });

  it("answers null — nothing to cite — when nothing matches", async () => {
    expect(await build().tool.query(context(), { op: "search", q: "submarine" })).toEqual({
      payload: null,
      sources: [],
      usage: { tokens: 0 },
    });
  });

  it("returns nothing from another workspace", async () => {
    const { index, tool } = build();

    for (const call of [
      { op: "search", q: "docking" },
      { op: "get", ref: "issue-index://support/churn-2026-q2" },
      { op: "aggregate", groupBy: "label" },
    ]) {
      expect((await tool.query(context(OTHER_ORG), call)).payload).toBeNull();
    }
    expect(await tool.counts(OTHER_ORG)).toEqual({
      issues: "0 issues",
      prs: "0 pull requests",
      imports: "no imported sets",
    });
    // Every read named the caller's workspace.
    expect(new Set(index.reads.map(([organizationId]) => organizationId))).toEqual(
      new Set([OTHER_ORG]),
    );
  });

  it.each([
    [{ op: "search" }, "search() takes a query"],
    [{ op: "search", q: "  " }, "search() takes a query"],
    [{ op: "search", q: "x".repeat(501) }, "search() takes a query"],
    [{ op: "search", q: "a", limit: 0 }, "limit must be a whole number from 1 to 50"],
    [{ op: "search", q: "a", limit: 51 }, "limit must be a whole number from 1 to 50"],
    [{ op: "search", q: "a", kinds: ["epic"] }, "kinds must be one of"],
    [{ op: "search", q: "a", kinds: "ticket" }, "kinds must be a list"],
    [{ op: "search", q: "a", labels: [] }, "labels must be a list of 1 to 20"],
    [{ op: "search", q: "a", since: "last week" }, "since must be an ISO-8601 date"],
    [{ op: "search", q: "a", since: "2027-01-01" }, "since is in the future"],
    [
      { op: "search", q: "a", since: "2026-09-02", until: "2026-09-01" },
      "until must be after since",
    ],
    [{ op: "search", q: "a", repo: "" }, "repo must be a non-empty string"],
    [{ op: "search", q: "a", set: 7 }, "set must be a non-empty string"],
    [{ op: "cluster" }, 'the history index answers {op: "search" | "get" | "aggregate"}'],
    [{}, "the history index answers"],
  ])("refuses %j as unsupported", async (call, detail) => {
    const [errorClass, said] = await refusal(build().tool.query(context(), call));

    expect(errorClass).toBe("unsupported");
    expect(said).toContain(detail);
  });
});

describe("get", () => {
  it("cites the churn interviews as mockup 22's [19]", async () => {
    const result = await build().tool.query(context(), {
      op: "get",
      ref: "issue-index://support/churn-2026-q2",
    });

    expect(resultViolations(result, null)).toEqual([]);
    expect(result.payload).toMatchObject({
      op: "get",
      ref: "issue-index://support/churn-2026-q2",
      entries: [
        { kind: "document_set", title: "Support churn interviews Q2", meta: { documents: 14 } },
      ],
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      kind: "ticket",
      title: "Support churn interviews Q2",
      locator: "issue-index://support/churn-2026-q2",
    });
  });

  it("answers a ticket, a PR and a document with their own titles", async () => {
    const { tool } = build();
    const title = async (ref: string): Promise<string> =>
      (await tool.query(context(), { op: "get", ref })).sources[0].title;

    expect(await title("issue-index://github-acme-robotics/498")).toBe(
      "#498 — Docking abort in crosswind above 6 m/s",
    );
    expect(await title("issue-index://github-acme-robotics/pull/512")).toBe(
      "PR #512 — dock: retry the approach after an abort",
    );
    expect(await title("issue-index://support/churn-2026-q2/acct-01")).toBe(
      "Churn interview — Northwind Survey",
    );
  });

  it("answers every entry a locator names, and cuts a long body", async () => {
    const index = new MemoryHistoryIndex([
      ...fixtureCorpus(),
      entry({
        locator: "issue-index://support/SUP-2214",
        entryId: "e-twin",
        title: "A second source whose name slugs alike",
        body: "y".repeat(30000),
      }),
    ]);
    const result = await new TicketsResearchTool(index, () => NOW).query(context(), {
      op: "get",
      ref: "issue-index://support/SUP-2214",
    });
    const entries = (result.payload as { entries: { body: string }[] }).entries;

    expect(entries).toHaveLength(2);
    expect(entries[1].body).toHaveLength(20001);
    expect(result.sources).toHaveLength(2);
    expect(resultViolations(result, null)).toEqual([]);
  });

  it("answers null for a locator the workspace does not have", async () => {
    expect(
      (await build().tool.query(context(), { op: "get", ref: "issue-index://support/SUP-0" }))
        .payload,
    ).toBeNull();
  });

  it.each([
    [undefined],
    ["SUP-2214"],
    ["https://support.example.com/tickets/SUP-2214"],
    ["issue-index://Support/SUP-2214"],
    ["issue-index://support"],
    ["issue-index://support/a b"],
  ])("refuses the ref %j", async (ref) => {
    expect((await refusal(build().tool.query(context(), { op: "get", ref })))[0]).toBe(
      "unsupported",
    );
  });
});

describe("aggregate", () => {
  it("counts by label over a window, citing each bucket's newest entries", async () => {
    const result = await build().tool.query(context(), { op: "aggregate", groupBy: "label" });

    expect(resultViolations(result, null)).toEqual([]);
    expect(result.payload).toEqual({
      op: "aggregate",
      groupBy: "label",
      period: null,
      q: null,
      filters: { since: "2026-07-02T12:00:00.000Z", until: NOW.toISOString() },
      window: { since: "2026-07-02T12:00:00.000Z", until: NOW.toISOString() },
      total: 3,
      buckets: [
        { key: "docking", count: 2 },
        { key: "support", count: 2 },
        { key: "battery", count: 1 },
        { key: "bug", count: 1 },
      ],
      truncated: false,
    });
    // SUP-2214 is in two buckets and cited once, naming both.
    expect(result.sources.map((source) => source.locator).sort()).toEqual([
      "issue-index://github-acme-robotics/498",
      "issue-index://support/SUP-2214",
      "issue-index://support/SUP-2301",
    ]);
    expect(
      result.sources.find((source) => source.locator === "issue-index://support/SUP-2214")?.meta,
    ).toMatchObject({
      buckets: { docking: 2, support: 2 },
      query: { op: "aggregate", groupBy: "label" },
    });
  });

  it("answers only the labels asked for — a theme count", async () => {
    const result = await build().tool.query(context(), {
      op: "aggregate",
      groupBy: "label",
      labels: ["docking", "battery"],
      windowDays: 365,
    });

    expect(result.payload).toMatchObject({
      total: 5,
      buckets: [
        { key: "docking", count: 3 },
        { key: "battery", count: 2 },
      ],
    });
  });

  it("counts mentions, by period, kind, repository and set", async () => {
    const { tool } = build();
    const buckets = async (call: Record<string, unknown>): Promise<unknown> =>
      (
        (await tool.query(context(), { op: "aggregate", windowDays: 365, ...call })).payload as {
          buckets: unknown;
        }
      ).buckets;

    expect(await buckets({ groupBy: "period", period: "month", q: "docking" })).toEqual([
      { key: "2026-04-01", count: 1 },
      { key: "2026-08-01", count: 1 },
      { key: "2026-09-01", count: 1 },
    ]);
    expect(await buckets({ groupBy: "period", q: "battery" })).toEqual([
      { key: "2026-04-20", count: 1 },
      { key: "2026-09-07", count: 1 },
    ]);
    expect(await buckets({ groupBy: "kind" })).toEqual([
      { key: "ticket", count: 3 },
      { key: "document", count: 2 },
      { key: "pr", count: 1 },
    ]);
    expect(await buckets({ groupBy: "repo" })).toEqual([
      { key: "(none)", count: 4 },
      { key: "helios-firmware", count: 2 },
    ]);
    expect(await buckets({ groupBy: "set" })).toEqual([
      { key: "github-acme-robotics", count: 2 },
      { key: "support", count: 2 },
      { key: "support/churn-2026-q2", count: 2 },
    ]);
  });

  it("takes its default window from the workspace's configuration", async () => {
    const { tool } = build();
    const since = async (config: Record<string, string>, call = {}): Promise<string> =>
      (
        (
          await tool.query(context(INDEX_ORG, config), {
            op: "aggregate",
            groupBy: "kind",
            ...call,
          })
        ).payload as { window: { since: string } }
      ).window.since;

    expect(await since({})).toBe("2026-07-02T12:00:00.000Z");
    expect(await since({ windowDays: "365" })).toBe("2025-09-30T12:00:00.000Z");
    expect(await since({ windowDays: "7" })).toBe("2026-07-02T12:00:00.000Z");
    expect(await since({ windowDays: "365" }, { windowDays: 30 })).toBe("2026-08-31T12:00:00.000Z");
    expect(await since({}, { since: "2026-01-01" })).toBe("2026-01-01T00:00:00.000Z");
  });

  it("cites at most the leading buckets' newest entries", async () => {
    const index = new MemoryHistoryIndex(
      Array.from({ length: 60 }, (_unused, n) =>
        entry({
          locator: `issue-index://support/SUP-${String(n)}`,
          title: `Ticket ${String(n)}`,
          labels: [`theme-${String(n % 12)}`],
          occurredAt: new Date(Date.UTC(2026, 8, 1 + (n % 20))),
        }),
      ),
    );
    const result = await new TicketsResearchTool(index, () => NOW).query(context(), {
      op: "aggregate",
      groupBy: "label",
    });

    expect((result.payload as { buckets: unknown[] }).buckets).toHaveLength(12);
    expect(result.sources).toHaveLength(CITED_BUCKETS * CITED_PER_BUCKET);
    expect(resultViolations(result, null)).toEqual([]);
  });

  it("answers null when the window holds nothing", async () => {
    expect(
      (await build().tool.query(context(), { op: "aggregate", groupBy: "label", windowDays: 1 }))
        .payload,
    ).toBeNull();
  });

  it.each([
    [{ op: "aggregate" }, "groupBy must be one of"],
    [{ op: "aggregate", groupBy: "component" }, "groupBy must be one of"],
    [{ op: "aggregate", groupBy: "period", period: "quarter" }, "period must be one of"],
    [{ op: "aggregate", groupBy: "label", windowDays: 0 }, "windowDays must be a whole number"],
    [{ op: "aggregate", groupBy: "label", windowDays: 4000 }, "windowDays must be a whole number"],
    [
      { op: "aggregate", groupBy: "label", windowDays: 30, since: "2026-09-01" },
      "name a window with windowDays or since, not both",
    ],
    [{ op: "aggregate", groupBy: "label", q: "" }, "q must be a non-empty string"],
  ])("refuses %j as unsupported", async (call, detail) => {
    const [errorClass, said] = await refusal(build().tool.query(context(), call));

    expect(errorClass).toBe("unsupported");
    expect(said).toContain(detail);
  });
});

describe("a failing index", () => {
  const failing = (failure: Error) =>
    new TicketsResearchTool({ search: () => Promise.reject(failure) } as never, () => NOW).query(
      context(),
      { op: "search", q: "docking" },
    );

  it("is a network failure when the database cannot be reached", async () => {
    expect(await refusal(failing(Object.assign(new Error("x"), { code: "ECONNREFUSED" })))).toEqual(
      ["network", "the history index could not be reached"],
    );
  });

  it("is an upstream failure naming the budget when a statement outlives it", async () => {
    expect(await refusal(failing(Object.assign(new Error("x"), { code: "57014" })))).toEqual([
      "upstream",
      "the history index did not answer within its 500 ms budget",
    ]);
  });

  it("is an upstream failure for anything else, without the cause's words", async () => {
    expect(
      await refusal(failing(new Error("relation history_index_entries does not exist"))),
    ).toEqual(["upstream", "the history index could not be read"]);
  });
});
