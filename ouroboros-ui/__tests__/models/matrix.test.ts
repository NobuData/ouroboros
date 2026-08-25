import { describe, expect, it } from "vitest";

import type { MatrixRow } from "@/app/models/matrix";
import {
  EM_DASH,
  MATRIX_TITLE,
  NO_PROVIDER,
  aliasCell,
  costCell,
  escalationFor,
  hopAt,
  inspectorTitle,
  latencyCell,
  matrixRows,
  ruleTaskKind,
  selectedKind,
  selectionAnnouncement,
  taskKindCount,
} from "@/app/models/matrix";
import type { EscalationRule, Route, RouteHop, RouteStats } from "@/app/api/routing";

import { seededMatrix, seededRules, seededTaskKinds } from "../helpers/models";

/**
 * Every decision the routing matrix makes (#201).
 *
 * The table is the page, and almost nothing about it is markup: which hop is the primary,
 * what a resolution line says when its alias has no provider, which rules touch a row, and
 * what a cell prints when nobody measured the number are all judgements. They are covered here
 * as functions, so the acceptance criteria are assertions about small objects rather than
 * about rendered text — `routing-matrix.test.tsx` is where the drawing is.
 *
 * The fixtures are the dev seed's own rows (`../helpers/models.ts`), which is what makes *the
 * seeded matrix matches the mockup row for row* something this file can actually check.
 */

/**
 * A hop, defaulting to the seeded `coder-max`.
 *
 * @param overrides What this case is about.
 * @returns The hop, as the contract serves it.
 */
function hop(overrides: Partial<RouteHop> = {}): RouteHop {
  return {
    position: 1,
    alias: "coder-max",
    modelId: "claude-fable-5",
    note: null,
    provider: {
      id: "5eed000c-0000-4000-8000-000000000001",
      kind: "anthropic",
      displayName: "Anthropic Claude",
      baseUrl: null,
    },
    ...overrides,
  };
}

/**
 * Measured figures, defaulting to the seeded `implement` row's.
 *
 * @param overrides What this case is about.
 * @returns The stats.
 */
function stats(overrides: Partial<RouteStats> = {}): RouteStats {
  return {
    costCentsPerRunAvg: 87,
    latencyP50Ms: 41000,
    pricedCalls: 15,
    unpricedCalls: 0,
    timedCalls: 15,
    ...overrides,
  };
}

/**
 * One row of the seeded matrix, decided.
 *
 * @param kind Which task kind.
 * @returns The row.
 */
function row(kind: string): MatrixRow {
  const found = matrixRows(seededTaskKinds(), seededRules()).find(
    (candidate) => candidate.kind === kind,
  );

  if (found === undefined) throw new Error(`no seeded row for ${kind}`);
  return found;
}

/**
 * One seeded route, as the contract serves it.
 *
 * @param kind Which task kind's route.
 * @returns The route.
 */
function seededRoute(kind: string): Route {
  const route = seededTaskKinds().find((candidate) => candidate.name === kind)?.route;

  if (route === undefined || route === null) throw new Error(`no seeded route for ${kind}`);
  return route;
}

describe("the alias cells", () => {
  it("keeps the alias and its resolution as two facts, because they are two claims", () => {
    // A route points at aliases and never at raw model ids (decision M1). The pill is what the
    // route *names* and the line beneath it is what that name currently *means*, which is the
    // half that moves when the registry does.
    expect(aliasCell(hop())).toEqual({
      alias: "coder-max",
      resolution: "claude-fable-5 · Anthropic Claude",
    });
  });

  it("says so when an alias has no provider bound, rather than stopping at the model", () => {
    // The registry's `gpt5-experiments` case seen from the routing side: a name created ahead
    // of its key. A line that stopped at the model id would read exactly like a bound one.
    const cell = aliasCell(hop({ alias: "gpt5-experiments", modelId: "gpt-5.2-preview", provider: null }));

    expect(cell.resolution).toBe(`gpt-5.2-preview · ${NO_PROVIDER}`);
  });

  it("finds a hop by its position rather than by where it sits in the array", () => {
    // *Which hop is the primary* is the fact this matrix must not get wrong, and the array
    // index would be right for every payload the service sends today and wrong for one that
    // arrived in another order.
    const route = seededRoute("implement");
    const shuffled: Route = { ...route, hops: [...route.hops].reverse() };

    expect(hopAt(shuffled, 1)?.alias).toBe("coder-max");
    expect(hopAt(shuffled, 2)?.alias).toBe("coder-fallback");
  });

  it("answers null for a hop the chain does not reach, and for a kind with no route", () => {
    const route = seededRoute("docs");

    expect(hopAt({ ...route, hops: route.hops.slice(0, 1) }, 2)).toBeNull();
    expect(hopAt(null, 1)).toBeNull();
  });
});

describe("the escalation column", () => {
  it("draws a rule on the row its `then` names", () => {
    // The `use_alias` rule names `implement`, not `plan`. Y.3 (#191) settled the mockup's own
    // inconsistency in the schema's favour and the seed records it.
    expect(row("implement").escalation).toEqual([
      "effort ≥ L → implement uses coder-max (max thinking)",
    ]);
    expect(row("review").escalation).toEqual([
      "security label → review adds second-opinion vote",
    ]);
    expect(row("plan").escalation).toEqual([]);
  });

  it("prints the database's sentence rather than one composed here", () => {
    // The property that makes *the matrix and the rules card cannot disagree* a fact about
    // the schema rather than a promise two components make apart: `display` is a generated
    // column, so there is exactly one string.
    const rules = seededRules();

    for (const summary of row("implement").escalation) {
      expect(rules.map((rule) => rule.display)).toContain(summary);
    }
  });

  it("leaves a workspace-wide rule to the rules card rather than to eight copies of one cell", () => {
    // `route_local` names no task kind — it modifies every one — so it is a fact about the
    // workspace rather than about a row. Repeated across all eight rows it would drown the two
    // summaries that really are per-row, and the em-dash would stop meaning anything.
    const rows = matrixRows(seededTaskKinds(), seededRules());

    for (const candidate of rows) {
      expect(candidate.escalation).not.toContain("docs-only diff → everything routes local");
    }
  });

  it("names the kind for the two actions that carry one, and none for the third", () => {
    const [useAlias, addVote, routeLocal] = seededRules();

    expect(ruleTaskKind(useAlias!)).toBe("implement");
    expect(ruleTaskKind(addVote!)).toBe("review");
    expect(ruleTaskKind(routeLocal!)).toBeNull();
  });

  it("leaves a disabled rule out, because a rule that cannot fire is not an escalation", () => {
    // The column describes what routing *does*. The card is where a disabled rule keeps its
    // place, its sentence and its switch.
    const off: EscalationRule[] = seededRules().map((rule) => ({ ...rule, enabled: false }));

    expect(escalationFor(off, "implement")).toEqual([]);
  });

  it("keeps two rules on one row in the order they are evaluated in", () => {
    // *Which rule wins* has one answer, and it is `sortOrder`. A cell that reordered them
    // would be describing a different resolution than the one that will happen.
    const rules = seededRules();
    const second: EscalationRule = {
      ...rules[1]!,
      id: "5eed0013-0000-4000-8000-0000000000ff",
      sortOrder: 4,
      then: { add_vote: { task_kind: "implement", alias: "second-opinion" } },
      display: "security label → implement adds second-opinion vote",
    };

    expect(escalationFor([...rules, second], "implement")).toEqual([
      "effort ≥ L → implement uses coder-max (max thinking)",
      "security label → implement adds second-opinion vote",
    ]);
  });
});

describe("the numeric columns, which is where this matrix could lie", () => {
  it("draws the seeded figures exactly as mockup 06 does", () => {
    // The seed's sequences are built so that `avg(cost_cents)` is each kind's centre and
    // `percentile_cont(0.5)` lands on the row at it — which is what makes this a check against
    // the mockup rather than against whatever the fixture happens to hold.
    expect([row("analyze").cost, row("analyze").latency]).toEqual(["$0.04", "3.1s"]);
    expect([row("estimate").cost, row("estimate").latency]).toEqual(["$0.01", "1.2s"]);
    expect([row("plan").cost, row("plan").latency]).toEqual(["$0.31", "9.8s"]);
    expect([row("implement").cost, row("implement").latency]).toEqual(["$0.87", "41.0s"]);
    expect([row("test-gen").cost, row("test-gen").latency]).toEqual(["$0.12", "17.4s"]);
    expect([row("review").cost, row("review").latency]).toEqual(["$0.22", "12.6s"]);
    expect([row("docs").cost, row("docs").latency]).toEqual(["$0.00", "6.3s"]);
    expect([row("commit-msg").cost, row("commit-msg").latency]).toEqual(["$0.00", "0.8s"]);
  });

  it("renders an em-dash where nothing was measured, and never a zero", () => {
    // Decision M7. A workspace that has run nothing has not spent `$0.00` per run, it has spent
    // nothing anybody can average — and `0.0s` is an excellent latency for a call nobody made.
    const nothing = stats({ costCentsPerRunAvg: null, latencyP50Ms: null, pricedCalls: 0, timedCalls: 0 });

    expect(costCell(nothing)).toBe(EM_DASH);
    expect(latencyCell(nothing)).toBe(EM_DASH);
  });

  it("renders a measured zero as a figure, because it is one", () => {
    // `costCentsPerRunAvg: 0` with a non-zero `pricedCalls` is calls that were priced, at
    // nothing — a `docs` pass on hardware the workspace already owns. That is a different fact
    // from the null above, and only one of them is an em-dash.
    expect(costCell(stats({ costCentsPerRunAvg: 0 }))).toBe("$0.00");
    expect(latencyCell(stats({ latencyP50Ms: 0 }))).toBe("0.0s");
  });

  it("renders an em-dash for a kind with no route at all", () => {
    expect(costCell(null)).toBe(EM_DASH);
    expect(latencyCell(null)).toBe(EM_DASH);
  });
});

describe("the rows", () => {
  it("draws the eight seeded kinds in the order the service sends them", () => {
    // The loop's own order of operations. Sorting again here would be a second opinion about
    // row order, and the two would differ the first time two kinds shared a `sortOrder`.
    expect(matrixRows(seededTaskKinds(), seededRules()).map((candidate) => candidate.kind)).toEqual([
      "analyze",
      "estimate",
      "plan",
      "implement",
      "test-gen",
      "review",
      "docs",
      "commit-msg",
    ]);
  });

  it("carries the route's own tag rather than one composed from the kind", () => {
    // `test-gen` tags `testgen-primary`. A client that composed the tag would print a name the
    // service does not answer to.
    expect(row("test-gen").tag).toBe("testgen-primary");
  });

  it("takes the first two hops as the primary and the fallback columns", () => {
    const implement = row("implement");

    expect(implement.primary).toEqual({
      alias: "coder-max",
      resolution: "claude-fable-5 · Anthropic Claude",
    });
    expect(implement.fallback).toEqual({
      alias: "coder-fallback",
      resolution: "gpt-5-codex · GitHub Copilot",
    });
  });

  it("draws a kind with no route rather than hiding it", () => {
    // A legal state the contract publishes on purpose. Hiding it would hide the very kind
    // somebody opened this page to configure.
    const [rowless] = matrixRows(
      [{ name: "triage", description: "Sort the inbox", sortOrder: 9, route: null }],
      seededRules(),
    );

    expect(rowless?.kind).toBe("triage");
    expect(rowless?.tag).toBeNull();
    expect(rowless?.primary).toBeNull();
    expect(rowless?.fallback).toBeNull();
    expect([rowless?.cost, rowless?.latency]).toEqual([EM_DASH, EM_DASH]);
  });

  it("leaves the fallback empty for a chain one hop long, and keeps the primary", () => {
    const kinds = seededTaskKinds().map((kind) =>
      kind.name === "docs" && kind.route !== null
        ? { ...kind, route: { ...kind.route, hops: kind.route.hops.slice(0, 1) } }
        : kind,
    );
    const [docs] = matrixRows(kinds, seededRules()).filter((candidate) => candidate.kind === "docs");

    expect(docs?.primary?.alias).toBe("local-docs");
    expect(docs?.fallback).toBeNull();
  });
});

describe("the selection the URL carries", () => {
  it("accepts a kind the matrix has", () => {
    expect(selectedKind(matrixRows(seededTaskKinds(), seededRules()), "implement")).toBe("implement");
  });

  it("refuses a kind it does not, rather than naming something nobody can act on", () => {
    const rows = matrixRows(seededTaskKinds(), seededRules());

    expect(selectedKind(rows, "deploy")).toBeNull();
    expect(selectedKind(rows, null)).toBeNull();
    expect(selectedKind(rows, undefined)).toBeNull();
  });

  it("refuses a repeated parameter, because two answers are not an answer", () => {
    const rows = matrixRows(seededTaskKinds(), seededRules());

    expect(selectedKind(rows, ["implement", "review"])).toBeNull();
  });

  it("says what was selected in a sentence, because a live region is read out of context", () => {
    expect(selectionAnnouncement("implement")).toContain("implement");
    expect(selectionAnnouncement("implement")).toMatch(/selected/);
  });
});

describe("the copy", () => {
  it("counts the kinds it actually has rather than the seeded eight", () => {
    expect(taskKindCount(seededMatrix().taskKinds.length)).toBe("8 task kinds");
    expect(taskKindCount(1)).toBe("1 task kind");
    expect(taskKindCount(0)).toBe("0 task kinds");
  });

  it("titles the inspector with the route's tag, the way the mockup does", () => {
    expect(inspectorTitle("implement-primary")).toBe("Route — implement-primary");
  });

  it("leaves the title whole rather than trailing a dash for a route with no tag", () => {
    expect(inspectorTitle(null)).toBe("Route");
  });

  it("names the card the way the mockup heads it", () => {
    expect(MATRIX_TITLE).toBe("Routing matrix");
  });
});
