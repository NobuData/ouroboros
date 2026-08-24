import type { RouteRevisionEntry } from "../db/schema";
import {
  HOPS_KEY,
  POLICY_KEYS,
  revisionDiff,
  routeChanges,
  routeEntry,
  sameChain,
} from "./management.diff";
import type { DesiredRoute, RouteState } from "./management.rows";

/**
 * What a save changed, as a table of inputs.
 *
 * The function is pure, which is what makes the ticket's *"every save writes a
 * `route_revisions` row whose diff reflects exactly what changed"* checkable here rather than
 * only against a database. Three properties are the point:
 *
 *   * **a change is recorded exactly when something moved** — no entry for a body that asks
 *     for the state a route is already in, and an entry for every column that did move;
 *   * **a reorder is a change**, which is the whole of the matrix's drag handle. Same aliases,
 *     different order, and a comparison by set would call that nothing; and
 *   * **the keys are the columns and the hops are alias names**, because a revision is read by
 *     a person months later and `floor_hop_index` is what they will find in the schema.
 */

/** A route as it stands: two hops, no floor, a cap. */
function stored(overrides: Partial<RouteState> = {}): RouteState {
  return {
    routeId: "5eed0011-0000-4000-8000-000000000004",
    taskKind: "implement",
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: 250,
    hops: [
      { alias: "coder-max", note: "Primary" },
      { alias: "coder-fallback", note: null },
    ],
    ...overrides,
  };
}

/** The same route as a body asks for it — identical unless a test says otherwise. */
function asked(overrides: Partial<DesiredRoute> = {}): DesiredRoute {
  const base = stored();

  return {
    taskKind: base.taskKind,
    allowLocalFallback: base.allowLocalFallback,
    floorHopIndex: base.floorHopIndex,
    maxCostCentsPerRun: base.maxCostCentsPerRun,
    hops: base.hops,
    ...overrides,
  };
}

describe("comparing two chains", () => {
  it("calls a chain the same as itself", () => {
    expect(sameChain(stored().hops, asked().hops)).toBe(true);
  });

  it("calls a reorder a change, which is what the drag handle exists for", () => {
    const reordered = [...stored().hops].reverse();

    expect(sameChain(stored().hops, reordered)).toBe(false);
  });

  it("calls a rewritten note a change", () => {
    // An operator rewriting *"Fallback on 5xx"* has changed the chain a reader sees, and a
    // diff that ignored it would report a save that did something as a save that did nothing.
    const renoted = [{ alias: "coder-max", note: "Primary · audited" }, stored().hops[1]];

    expect(sameChain(stored().hops, renoted)).toBe(false);
  });

  it("calls a longer chain a change", () => {
    expect(sameChain(stored().hops, [...stored().hops, { alias: "local-docs", note: null }])).toBe(
      false,
    );
  });
});

describe("what one route's save moved", () => {
  it("is empty when the body asks for the state the route is in", () => {
    // The no-op save. Nothing is written and no revision exists to say a button was pressed.
    expect(routeChanges(stored(), asked())).toEqual({});
    expect(routeEntry(stored(), asked())).toBeNull();
  });

  it("records a reorder under the chain's own key", () => {
    const reordered = [...stored().hops].reverse();

    expect(routeChanges(stored(), asked({ hops: reordered }))).toEqual({
      [HOPS_KEY]: { from: stored().hops, to: reordered },
    });
  });

  it("records the hops by alias name, never by id", () => {
    // V021's argument: a uuid is a lookup into a row that may since have been repointed, which
    // is exactly the interval somebody reading a revision is asking about.
    const changes = routeChanges(stored(), asked({ hops: [{ alias: "local-docs", note: null }] }));
    const chain = changes[HOPS_KEY].to as { alias: string }[];

    expect(chain).toEqual([{ alias: "local-docs", note: null }]);
  });

  it.each([
    [
      "the local switch",
      { allowLocalFallback: false },
      POLICY_KEYS.allowLocalFallback,
      true,
      false,
    ],
    ["the floor being set", { floorHopIndex: 2 }, POLICY_KEYS.floorHopIndex, null, 2],
    ["the cap being raised", { maxCostCentsPerRun: 500 }, POLICY_KEYS.maxCostCentsPerRun, 250, 500],
    [
      "the cap being cleared",
      { maxCostCentsPerRun: null },
      POLICY_KEYS.maxCostCentsPerRun,
      250,
      null,
    ],
  ])("records %s as a from/to pair", (_what, change, key, from, to) => {
    expect(routeChanges(stored(), asked(change))).toEqual({ [key]: { from, to } });
  });

  it("records everything that moved rather than the first thing", () => {
    const changes = routeChanges(
      stored(),
      asked({ floorHopIndex: 2, maxCostCentsPerRun: 500, allowLocalFallback: false }),
    );

    expect(Object.keys(changes).sort()).toEqual(
      [
        POLICY_KEYS.allowLocalFallback,
        POLICY_KEYS.floorHopIndex,
        POLICY_KEYS.maxCostCentsPerRun,
      ].sort(),
    );
  });

  it("names the entry by the task kind the body asked for", () => {
    expect(routeEntry(stored(), asked({ floorHopIndex: 1 }))).toEqual({
      task_kind: "implement",
      changes: { [POLICY_KEYS.floorHopIndex]: { from: null, to: 1 } },
    });
  });

  it("uses the column names V016 uses, so a revision reads against the schema", () => {
    expect(Object.values(POLICY_KEYS)).toEqual([
      "allow_local_fallback",
      "floor_hop_index",
      "max_cost_cents_per_run",
    ]);
  });
});

describe("the batch's revision", () => {
  it("is null when no route in it moved", () => {
    // Not a failure: a client pressed **Save routes** on a matrix it had not edited, and the
    // honest record of that is no record. V021 refuses an empty document anyway.
    expect(revisionDiff([])).toBeNull();
  });

  it("carries one entry per route that moved, in the order they were listed", () => {
    const entries: RouteRevisionEntry[] = [
      { task_kind: "implement", changes: { floor_hop_index: { from: null, to: 2 } } },
      { task_kind: "docs", changes: { allow_local_fallback: { from: true, to: false } } },
    ];

    expect(revisionDiff(entries)).toEqual({ routes: entries });
  });

  it("copies rather than aliasing what it was given", () => {
    const entries: RouteRevisionEntry[] = [
      { task_kind: "docs", changes: { floor_hop_index: { from: null, to: 1 } } },
    ];
    const diff = revisionDiff(entries);

    entries.push({ task_kind: "review", changes: { floor_hop_index: { from: null, to: 1 } } });

    expect(diff?.routes).toHaveLength(1);
  });
});
