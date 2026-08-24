import type { AliasRow, ChainHopRow, EscalationRuleRow, RouteRow } from "./routing.rows";
import { toAliasSpec, toChainHop, toRouteSpec, toRuleSpec } from "./routing.rows";

/**
 * The crossing point — rows in the database's vocabulary, inputs in the service's.
 *
 * The one behaviour here that is not a rename is the **left join's null**. `registry`'s alias
 * read inner-joins the connection, so an unbound alias is simply not in its answer; a chain
 * cannot do that, because a hop that vanished would make a three-hop chain arrive as two. So
 * the binding becomes null and `resolve()` drops the hop with a reason — and the tests below
 * are what keep the null from being turned into something else on the way through.
 */

/** One joined alias row, bound unless a test says otherwise. */
function aliasRow(overrides: Partial<AliasRow> = {}): AliasRow {
  return {
    alias: "coder-max",
    model_id: "claude-fable-5",
    params: {},
    connection_id: "c0000000-0000-4000-8000-000000000001",
    kind: "anthropic",
    display_name: "Anthropic Claude",
    base_url: null,
    ...overrides,
  };
}

describe("an alias row", () => {
  it("crosses into the service's names without translating anything else", () => {
    expect(toAliasSpec(aliasRow({ params: { thinking: "max" } }))).toEqual({
      alias: "coder-max",
      modelId: "claude-fable-5",
      params: { thinking: "max" },
      binding: {
        connectionId: "c0000000-0000-4000-8000-000000000001",
        kind: "anthropic",
        displayName: "Anthropic Claude",
        baseUrl: null,
      },
    });
  });

  it("carries the params through as they are, without defaulting", () => {
    // V015 makes the column an object and defaults it to `{}`, so a fallback here would be
    // this file quietly disagreeing with the schema about what is possible.
    expect(toAliasSpec(aliasRow()).params).toEqual({});
  });

  it("reports an unbound alias as unbound rather than dropping it", () => {
    const unbound = toAliasSpec(
      aliasRow({ connection_id: null, kind: null, display_name: null, base_url: null }),
    );

    expect(unbound.binding).toBeNull();
    expect(unbound.alias).toBe("coder-max");
    expect(unbound.modelId).toBe("claude-fable-5");
  });
});

describe("a hop row", () => {
  it("carries the position and the operator's note beside the alias", () => {
    const row: ChainHopRow = {
      ...aliasRow({ alias: "coder-fallback", model_id: "gpt-5-codex" }),
      position: 2,
      note: "Fallback on 5xx / timeouts",
    };

    expect(toChainHop(row)).toEqual({
      position: 2,
      note: "Fallback on 5xx / timeouts",
      target: toAliasSpec(row),
    });
  });

  it("keeps a hop with no note as having none", () => {
    const row: ChainHopRow = { ...aliasRow(), position: 1, note: null };

    expect(toChainHop(row).note).toBeNull();
  });
});

describe("a route row", () => {
  /** `implement-primary`, as the seed writes it. */
  const row: RouteRow = {
    route_id: "5eed0011-0000-4000-8000-000000000004",
    tag: "implement-primary",
    allow_local_fallback: true,
    floor_hop_index: null,
    max_cost_cents_per_run: 250,
  };

  it("takes the task kind from the caller rather than from the row", () => {
    // The caller has it — it is the argument `resolve` was called with. Echoing it from the
    // row would only prove the join matched.
    expect(toRouteSpec(row, "implement")).toEqual({
      taskKind: "implement",
      tag: "implement-primary",
      allowLocalFallback: true,
      floorHopIndex: null,
      maxCostCents: 250,
    });
  });

  it("keeps null policies null rather than defaulting them", () => {
    // Null is what *off* means for the floor and *no cap configured* for the cost. A default
    // here would make the inspector's fields look like displays of a value somebody chose.
    const uncapped = toRouteSpec({ ...row, max_cost_cents_per_run: null }, "docs");

    expect(uncapped.maxCostCents).toBeNull();
    expect(uncapped.floorHopIndex).toBeNull();
  });
});

describe("a rule row", () => {
  it("carries the generated sentence through unchanged", () => {
    const row: EscalationRuleRow = {
      id: "5eed0013-0000-4000-8000-000000000001",
      sort_order: 1,
      display: "effort ≥ L → implement uses coder-max (max thinking)",
      when: { effort_gte: "l" },
      then: {
        use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
      },
    };

    expect(toRuleSpec(row)).toEqual({
      id: row.id,
      sortOrder: 1,
      display: "effort ≥ L → implement uses coder-max (max thinking)",
      when: row.when,
      then: row.then,
    });
  });
});
