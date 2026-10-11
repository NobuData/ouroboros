import { pickerDimensions, rankCandidates, type PickerTicket } from "./dry-runs.picker";
import { DEFINITION } from "./dry-runs.store.fixture";

function ticket(key: string, overrides: Partial<PickerTicket> = {}): PickerTicket {
  return {
    id: `id-${key}`,
    key,
    title: `title of ${key}`,
    url: `https://example.test/${key}`,
    source: "github",
    labels: [],
    effort: "m",
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

/** The seeded pair: #489 has no `security` label, #491 looks like a CVE. */
const STORM = ticket("#489", {
  labels: ["bug", "can-bus"],
  updatedAt: new Date("2026-10-10T23:49:00Z"),
});
const CVE = ticket("#491", {
  labels: ["security", "cve"],
  updatedAt: new Date("2026-10-11T00:00:00Z"),
});

describe("the picker's dimensions", () => {
  it("makes one per trigger label, one for effort and one for source", () => {
    const dimensions = pickerDimensions({
      trigger: {
        event: "ticket_queued",
        conditions: { labels: ["security", "security", "p1"], effort_lte: "m", source: "github" },
      },
    });

    expect(dimensions.map((dimension) => dimension.id)).toEqual([
      "trigger.label:security",
      "trigger.label:p1",
      "trigger.effort_lte",
      "trigger.source",
    ]);
  });

  it("adds the ticket-testing predicates of flow nodes and branch edges, and no others", () => {
    const dimensions = pickerDimensions({
      trigger: { event: "ticket_queued", conditions: {} },
      nodes: [
        {
          id: "has-cve",
          type: "flow",
          config: { kind: "decision", predicate: { kind: "labels", op: "any", values: ["cve"] } },
        },
        {
          id: "big",
          type: "flow",
          config: { kind: "gate", predicate: { kind: "effort", op: "gte", value: "l" } },
        },
        {
          id: "green",
          type: "flow",
          config: { kind: "gate", predicate: { kind: "checks", op: "all_passed" } },
        },
        { id: "always", type: "flow", config: { kind: "gate", predicate: { kind: "always" } } },
        {
          id: "implement",
          type: "llm",
          config: { predicate: { kind: "labels", op: "any", values: ["x"] } },
        },
        { type: "flow", config: {} },
        null,
      ],
      edges: [
        {
          from: "has-cve",
          to: "verify",
          kind: "branch",
          condition: { kind: "source", op: "in", values: ["jira"] },
        },
        {
          from: "a",
          to: "b",
          kind: "branch",
          condition: { kind: "paths", op: "any", globs: ["drivers/**"] },
        },
        { from: "a", to: "c", kind: "default" },
        { from: 1, to: "c" },
      ],
    });

    expect(dimensions.map((dimension) => [dimension.id, dimension.where])).toEqual([
      ["predicate:has-cve", "stage has-cve"],
      ["predicate:big", "stage big"],
      ["condition:has-cve>verify", "branch has-cve → verify"],
    ]);
  });

  it("reads a half-built draft as having none", () => {
    expect(pickerDimensions(null)).toEqual([]);
    expect(pickerDimensions({ trigger: "soon", nodes: "none", edges: 3 })).toEqual([]);
  });
});

describe("ranking candidates", () => {
  it("ranks the #489-class mismatch first and states its reason", () => {
    const [first, second] = rankCandidates(DEFINITION, [CVE, STORM]);

    expect(first).toMatchObject({
      rank: 1,
      ticket: { key: "#489" },
      score: 1,
      dimensions: 1,
      matchesTrigger: false,
      mismatches: [
        { dimension: "trigger.label:security", where: "trigger", detail: "no `security` label" },
      ],
    });
    expect(first?.reason).toBe(
      "no `security` label (trigger) — outside the trigger, so it exercises the path a matching issue would not.",
    );
    expect(second).toMatchObject({
      rank: 2,
      ticket: { key: "#491" },
      score: 0,
      matchesTrigger: true,
      reason: "Meets every condition — exercises the main path.",
    });
  });

  it("is deterministic whatever order the rows arrive in", () => {
    const tickets = [
      CVE,
      STORM,
      ticket("#486"),
      ticket("#100"),
      ticket("#200", { updatedAt: new Date("2026-10-05T00:00:00Z") }),
    ];
    const order = (rows: PickerTicket[]) =>
      rankCandidates(DEFINITION, rows).map((c) => c.ticket.key);

    // Score first; then the most recently updated; then the lower key.
    expect(order(tickets)).toEqual(["#489", "#200", "#100", "#486", "#491"]);
    expect(order([...tickets].reverse())).toEqual(order(tickets));
  });

  it("scores a conditional stage's predicate, and says the ticket still triggers", () => {
    const draft = {
      trigger: { event: "ticket_queued", conditions: { labels: ["security"] } },
      nodes: [
        {
          id: "has-cve",
          type: "flow",
          config: { kind: "decision", predicate: { kind: "labels", op: "any", values: ["cve"] } },
        },
      ],
      edges: [],
    };
    const noCve = ticket("#489", { labels: ["security"] });

    const [first, second] = rankCandidates(draft, [CVE, noCve]);

    expect(first).toMatchObject({
      ticket: { key: "#489" },
      score: 1,
      dimensions: 2,
      matchesTrigger: true,
    });
    expect(first?.reason).toBe("none of `cve` (stage has-cve) — exercises a conditional path.");
    expect(second).toMatchObject({ ticket: { key: "#491" }, score: 0 });
  });

  it("describes every kind of miss", () => {
    const draft = {
      trigger: { event: "ticket_queued", conditions: { effort_lte: "s", source: "jira" } },
      nodes: [
        {
          id: "all",
          type: "flow",
          config: { predicate: { kind: "labels", op: "all", values: ["a", "b"] } },
        },
        {
          id: "none",
          type: "flow",
          config: { predicate: { kind: "labels", op: "none", values: ["a"] } },
        },
        { id: "lt", type: "flow", config: { predicate: { kind: "effort", op: "lt", value: "m" } } },
        {
          id: "eq",
          type: "flow",
          config: { predicate: { kind: "effort", op: "eq", value: "xl" } },
        },
        { id: "gt", type: "flow", config: { predicate: { kind: "effort", op: "gt", value: "m" } } },
        {
          id: "lte",
          type: "flow",
          config: { predicate: { kind: "effort", op: "lte", value: "s" } },
        },
        {
          id: "src",
          type: "flow",
          config: { predicate: { kind: "source", op: "not_in", values: ["github"] } },
        },
      ],
    };

    const [candidate] = rankCandidates(draft, [ticket("#1", { labels: ["a"], effort: "m" })]);

    expect(candidate?.mismatches.map((mismatch) => mismatch.detail)).toEqual([
      "effort M is over S",
      "from github, not jira",
      "not all of `a`, `b`",
      "carries `a`",
      "effort M is not below M",
      "effort M is not exactly XL",
      "effort M is not above M",
      "effort M is not at most S",
      "from github",
    ]);

    const [unsized] = rankCandidates(draft, [ticket("#2", { effort: null, source: "jira" })]);
    expect(unsized?.mismatches.filter((mismatch) => mismatch.detail === "not sized")).toHaveLength(
      5,
    );

    const [meets] = rankCandidates(
      {
        trigger: { event: "ticket_queued", conditions: { effort_lte: "m", source: "github" } },
        nodes: [
          {
            id: "gte",
            type: "flow",
            config: { predicate: { kind: "effort", op: "gte", value: "m" } },
          },
          {
            id: "in",
            type: "flow",
            config: { predicate: { kind: "source", op: "in", values: ["github"] } },
          },
          {
            id: "all",
            type: "flow",
            config: { predicate: { kind: "labels", op: "all", values: ["a"] } },
          },
        ],
      },
      [ticket("#3", { labels: ["a"] })],
    );
    expect(meets).toMatchObject({ score: 0, dimensions: 5, matchesTrigger: true });
  });

  it("says so when the draft tests nothing about the ticket", () => {
    const [only] = rankCandidates({ trigger: { event: "ticket_queued", conditions: {} } }, [STORM]);

    expect(only).toMatchObject({
      score: 0,
      dimensions: 0,
      reason: "The draft tests nothing about the ticket — every issue takes the same path.",
    });
    expect(rankCandidates(DEFINITION, [])).toEqual([]);
  });
});
