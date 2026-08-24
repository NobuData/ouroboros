import type {
  ManagedHopRow,
  ManagedRouteRow,
  ManagedRuleRow,
  TaskKindRow,
} from "./management.rows";
import {
  EMPTY_ROUTE_STATS,
  toAliasResource,
  toEscalationRuleResource,
  toRouteHopResource,
  toRouteProvider,
  toRouteResource,
  toTaskKindResource,
  type RouteStatsResource,
} from "./resources";
import type { AliasRow } from "./routing.rows";

/**
 * Rows → resources, and the three promises the mapping makes.
 *
 * **Absence stays absent.** An unbound alias arrives with `provider: null`, and the hop is
 * still in the chain — the same rule `routing.rows.ts` keeps for resolution, for the same
 * reason: a three-hop chain that arrived as two is the silence this roadmap exists to remove.
 *
 * **Nothing here invents a number.** `stats` is whatever Z.5
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)) measured from `token_usage`,
 * carried through untouched — and for a kind nothing has been spent on it is
 * {@link EMPTY_ROUTE_STATS}, because decision **M7** is *no data → em-dash, never a fabricated
 * number* and `0` is not *unknown*, it is a figure.
 *
 * **Nothing here composes a sentence.** `display` is the generated column, carried through
 * unchanged (decision **M5**), so the rules card and the resolution explanation cannot print
 * two sentences for one rule.
 */

/** What Z.5 measured for a kind that has been run — carried through, never recomputed here. */
const MEASURED: RouteStatsResource = {
  costCentsPerRunAvg: 87,
  latencyP50Ms: 41_000,
  pricedCalls: 15,
  unpricedCalls: 0,
  timedCalls: 15,
};

/** A bound alias, joined. */
const BOUND: AliasRow = {
  alias: "coder-max",
  model_id: "claude-fable-5",
  params: { thinking: "max" },
  connection_id: "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
  kind: "anthropic",
  display_name: "Anthropic",
  base_url: null,
};

/** V019's unbound alias — a name created ahead of its key. All four connection columns null. */
const UNBOUND: AliasRow = {
  alias: "gpt5-experiments",
  model_id: "gpt-5-preview",
  params: {},
  connection_id: null,
  kind: null,
  display_name: null,
  base_url: null,
};

/** One hop of a chain. */
function hop(row: AliasRow, position: number, note: string | null = null): ManagedHopRow {
  return { ...row, route_id: "5eed0011-0000-4000-8000-000000000004", position, note };
}

/** One route row. */
const ROUTE: ManagedRouteRow = {
  route_id: "5eed0011-0000-4000-8000-000000000004",
  task_kind: "implement",
  tag: "implement-primary",
  allow_local_fallback: true,
  floor_hop_index: 3,
  max_cost_cents_per_run: 250,
  updated_by: "66666666-6666-6666-6666-666666666666",
  updated_at: new Date("2026-08-23T09:58:12.004Z"),
};

describe("an alias's binding", () => {
  it("is the four identifying facts when the alias is bound", () => {
    expect(toRouteProvider(BOUND)).toEqual({
      id: "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
      kind: "anthropic",
      displayName: "Anthropic",
      baseUrl: null,
    });
  });

  it("is null when it is not", () => {
    expect(toRouteProvider(UNBOUND)).toBeNull();
  });

  it("carries no health, because the strip is the one place a status comes from", () => {
    // A status published twice is a status that can be shown two ways at once, on one page.
    expect(Object.keys(toRouteProvider(BOUND) ?? {})).toEqual([
      "id",
      "kind",
      "displayName",
      "baseUrl",
    ]);
  });
});

describe("a hop", () => {
  it("keeps its stored number, which is what the floor counts", () => {
    expect(toRouteHopResource(hop(BOUND, 2, "Fallback on 5xx / timeouts"))).toEqual({
      position: 2,
      alias: "coder-max",
      modelId: "claude-fable-5",
      note: "Fallback on 5xx / timeouts",
      provider: {
        id: "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: null,
      },
    });
  });

  it("survives its alias being unbound, with an empty resolution line", () => {
    const resource = toRouteHopResource(hop(UNBOUND, 3));

    expect(resource.alias).toBe("gpt5-experiments");
    expect(resource.provider).toBeNull();
  });
});

describe("a route", () => {
  it("publishes the chain, the policy triple and who last saved it", () => {
    const resource = toRouteResource(ROUTE, [hop(BOUND, 1, "Primary"), hop(UNBOUND, 2)], MEASURED);

    expect(resource).toMatchObject({
      id: "5eed0011-0000-4000-8000-000000000004",
      taskKind: "implement",
      tag: "implement-primary",
      allowLocalFallback: true,
      floorHopIndex: 3,
      maxCostCentsPerRun: 250,
      updatedBy: "66666666-6666-6666-6666-666666666666",
    });
    expect(resource.hops).toHaveLength(2);
  });

  it("stamps in ISO 8601 rather than handing a client a Date", () => {
    expect(toRouteResource(ROUTE, [], MEASURED).updatedAt).toBe("2026-08-23T09:58:12.004Z");
  });

  it("publishes the stats it was handed, without recomputing or defaulting them", () => {
    // Decision M7 lives one layer up: Z.5 measures, and this function reports. What is asserted
    // here is that nothing between the aggregate and the contract touches the figures.
    expect(toRouteResource(ROUTE, [], MEASURED).stats).toEqual(MEASURED);
  });

  it("reports em-dashes for a kind nothing has measured, and never a fabricated zero", () => {
    // A workspace that has run nothing has not spent `$0.00` per run — it has spent nothing
    // anybody can average. The three counts are counts of rows, not claims about money.
    expect(toRouteResource(ROUTE, [], EMPTY_ROUTE_STATS).stats).toEqual({
      costCentsPerRunAvg: null,
      latencyP50Ms: null,
      pricedCalls: 0,
      unpricedCalls: 0,
      timedCalls: 0,
    });
  });

  it("says nothing about whether a hop would be used", () => {
    // This is the *configured* chain. Whether a hop survives health, the rules and the floor is
    // Z.1's resolution, served by Z.4 — and a second opinion published from the editor would be
    // a second thing to disagree with the first.
    const [first] = toRouteResource(ROUTE, [hop(BOUND, 1)], MEASURED).hops;

    expect(Object.keys(first)).toEqual(["position", "alias", "modelId", "note", "provider"]);
  });
});

describe("a matrix row", () => {
  const KIND: TaskKindRow = {
    id: "3ee00011-0000-4000-8000-000000000001",
    name: "implement",
    description: "Write the change, run tests, iterate to green",
    sort_order: 4,
  };

  it("carries the kind and its route", () => {
    const route = toRouteResource(ROUTE, [hop(BOUND, 1)], MEASURED);

    expect(toTaskKindResource(KIND, route)).toMatchObject({
      name: "implement",
      description: "Write the change, run tests, iterate to green",
      sortOrder: 4,
    });
  });

  it("carries a null route rather than vanishing when the kind has none", () => {
    // V016 makes `routes.task_kind_id` unique but not mandatory, so a kind with no route is a
    // legal state and is a matrix row with an empty cell. Hiding it would hide a kind the
    // workspace has.
    expect(toTaskKindResource(KIND, null).route).toBeNull();
  });

  it("does not carry the kind's id", () => {
    // Nothing addresses a task kind by id: `resolve("implement", …)` names the row of the
    // matrix, and every write in this API names it the same way.
    expect(Object.keys(toTaskKindResource(KIND, null))).toEqual([
      "name",
      "description",
      "sortOrder",
      "route",
    ]);
  });
});

describe("a rule", () => {
  const RULE: ManagedRuleRow = {
    id: "f0000000-0000-4000-8000-000000000001",
    enabled: true,
    sort_order: 1,
    when: { effort_gte: "l" },
    then: {
      use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
    },
    display: "effort ≥ L → implement uses coder-max (max thinking)",
  };

  it("publishes the structure and the sentence the database derived from it", () => {
    expect(toEscalationRuleResource(RULE)).toEqual({
      id: "f0000000-0000-4000-8000-000000000001",
      enabled: true,
      sortOrder: 1,
      when: { effort_gte: "l" },
      then: {
        use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
      },
      display: "effort ≥ L → implement uses coder-max (max thinking)",
    });
  });

  it("carries the sentence through unchanged rather than recomposing it", () => {
    // Decision M5 end to end. The sentence is a generated column, so a mapper that rebuilt it
    // would be a second expression producing a second string for one rule.
    expect(toEscalationRuleResource({ ...RULE, display: "anything at all" }).display).toBe(
      "anything at all",
    );
  });

  it("publishes a disabled rule as a rule, not as an absence", () => {
    // *The rules this workspace has* and *the rules that currently fire* are different
    // questions, and the card asks both — `3 active` is the count of the second over the first.
    expect(toEscalationRuleResource({ ...RULE, enabled: false }).enabled).toBe(false);
  });
});

describe("a swap menu's alias", () => {
  it("carries the resolution a menu previews", () => {
    expect(toAliasResource(BOUND)).toEqual({
      alias: "coder-max",
      modelId: "claude-fable-5",
      params: { thinking: "max" },
      provider: {
        id: "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: null,
      },
    });
  });

  it("offers an unbound alias rather than hiding it", () => {
    expect(toAliasResource(UNBOUND).provider).toBeNull();
  });
});
