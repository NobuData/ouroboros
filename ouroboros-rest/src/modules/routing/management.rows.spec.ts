import {
  chainsByRoute,
  toRouteState,
  type ManagedHopRow,
  type ManagedRouteRow,
} from "./management.rows";

/**
 * Rows in, editor state out — the one crossing point between the matrix read's vocabulary and
 * the save's.
 *
 * Two things live here and nowhere else. **The split**: one statement reads every chain in the
 * workspace, and grouping it by route is what makes that one round trip instead of eight — so
 * a grouping that reordered or dropped a hop would be a chain drawn wrongly on the page and
 * saved wrongly from it. **The projection**: `RouteState` is the *before* half of every
 * comparison the diff makes, so a field it forgets is a change that is silently never
 * recorded.
 */

const ROUTE = "5eed0011-0000-4000-8000-000000000004";
const OTHER = "5eed0011-0000-4000-8000-000000000007";

/** One hop row, with the alias join filled in. */
function hop(
  routeId: string,
  position: number,
  alias: string,
  note: string | null = null,
): ManagedHopRow {
  return {
    route_id: routeId,
    position,
    note,
    alias,
    model_id: `${alias}-model`,
    params: {},
    connection_id: null,
    kind: null,
    display_name: null,
    base_url: null,
  };
}

/** One route row. */
const ROW: ManagedRouteRow = {
  route_id: ROUTE,
  task_kind: "implement",
  tag: "implement-primary",
  allow_local_fallback: false,
  floor_hop_index: 2,
  max_cost_cents_per_run: 250,
  updated_by: null,
  updated_at: new Date("2026-08-23T09:58:12.004Z"),
};

describe("splitting one statement's hops by route", () => {
  it("keeps each chain in the order the statement returned it", () => {
    const chains = chainsByRoute([
      hop(ROUTE, 1, "coder-max"),
      hop(ROUTE, 2, "coder-fallback"),
      hop(OTHER, 1, "local-docs"),
    ]);

    expect(chains.get(ROUTE)?.map((entry) => entry.alias)).toEqual(["coder-max", "coder-fallback"]);
    expect(chains.get(OTHER)?.map((entry) => entry.alias)).toEqual(["local-docs"]);
  });

  it("does not interleave two routes whose hops arrive apart", () => {
    // The read orders by route and then by position, so this cannot happen — but a grouping
    // that depended on that would be a grouping that broke the day somebody added an order-by.
    const chains = chainsByRoute([
      hop(ROUTE, 1, "coder-max"),
      hop(OTHER, 1, "local-docs"),
      hop(ROUTE, 2, "coder-fallback"),
    ]);

    expect(chains.get(ROUTE)?.map((entry) => entry.position)).toEqual([1, 2]);
    expect(chains.get(OTHER)).toHaveLength(1);
  });

  it("has no entry for a route with no hops", () => {
    // Unreachable through the schema — `route_chain_intact()` refuses an empty chain — so the
    // caller treats an absent chain as the empty array rather than as a state to report.
    expect(chainsByRoute([]).get(ROUTE)).toBeUndefined();
  });
});

describe("a route as the editor compares it", () => {
  it("carries the policy triple and the chain, by name", () => {
    expect(
      toRouteState(ROW, [hop(ROUTE, 1, "coder-max", "Primary"), hop(ROUTE, 2, "local-docs")]),
    ).toEqual({
      routeId: ROUTE,
      taskKind: "implement",
      allowLocalFallback: false,
      floorHopIndex: 2,
      maxCostCentsPerRun: 250,
      hops: [
        { alias: "coder-max", note: "Primary" },
        { alias: "local-docs", note: null },
      ],
    });
  });

  it("drops everything a save does not compare", () => {
    // The tag, the stamps and the resolution are read for the *page*; the diff compares what a
    // body can change, and a state carrying more would invite a comparison of something no
    // request can move.
    expect(Object.keys(toRouteState(ROW, []))).toEqual([
      "routeId",
      "taskKind",
      "allowLocalFallback",
      "floorHopIndex",
      "maxCostCentsPerRun",
      "hops",
    ]);
  });
});
