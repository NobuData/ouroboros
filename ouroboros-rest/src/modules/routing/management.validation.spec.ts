import type { DesiredRoute } from "./management.rows";
import {
  FLOOR_FIELD,
  SAVE_MESSAGES,
  TASK_KIND_FIELD,
  batchProblems,
  floorTooDeepMessage,
  hopAliasField,
  unknownAliasMessage,
} from "./management.validation";

/**
 * The ticket's invalid states, as a table.
 *
 * *"Invalid states — empty chain, floor > chain length, unknown alias — return 422 with the
 * field named"* is three of the four rows below; the empty chain is the DTO's, because it is a
 * fact about the body rather than about the workspace, and this file's header says why the
 * split is not arbitrary.
 *
 * The property worth asserting hardest is the **keying**. A client that sent eight routes and
 * got one wrong has to know which row of the matrix to mark, and it learns that from the key
 * rather than from a message it would have to parse.
 */

/** The workspace's eight, as Y.4 seeds them — enough that a missing one is a real absence. */
const TASK_KINDS = new Set(["analyze", "implement", "docs", "review"]);

/** Every one of them is routed, unless a test narrows it. */
const ROUTED = new Set(TASK_KINDS);

/** The mockup's aliases. `second-opinion` is in no chain, which is why it is in the registry. */
const ALIASES = new Set(["coder-max", "coder-fallback", "local-docs", "second-opinion"]);

/** One well-formed request, overridable. */
function request(overrides: Partial<DesiredRoute> = {}): DesiredRoute {
  return {
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

/** Run the checks against the standard workspace. */
function problems(...requests: DesiredRoute[]) {
  return batchProblems(requests, TASK_KINDS, ROUTED, ALIASES);
}

describe("a batch this workspace can save", () => {
  it("has no complaints", () => {
    expect(problems(request(), request({ taskKind: "docs" }))).toEqual({});
  });

  it("accepts a chain naming an unbound alias", () => {
    // V019 permits an alias created ahead of its key, and mockup 21 draws it as a first-class
    // row. A chain that names one is a configuration whose hop will be dropped with a stated
    // reason when it resolves — which is Z.1's answer to give, not this one's to pre-empt.
    expect(problems(request({ hops: [{ alias: "second-opinion", note: null }] }))).toEqual({});
  });

  it("accepts a floor exactly at the end of the chain", () => {
    // Off by one in the permissive direction is the failure that matters here: hop 2 of a
    // two-hop chain is the last hop, and refusing it would make the deepest floor unsettable.
    expect(problems(request({ floorHopIndex: 2 }))).toEqual({});
  });
});

describe("a task kind the save cannot land on", () => {
  it("is a complaint about the kind when the workspace has never had it", () => {
    expect(problems(request({ taskKind: "triage" }))).toEqual({
      triage: { [TASK_KIND_FIELD]: [SAVE_MESSAGES.unknownTaskKind] },
    });
  });

  it("is a different complaint when the kind exists and nothing routes it", () => {
    // The two send somebody to different places: one is a typo, and the other is a matrix row
    // with an empty cell that needs a route before it can be saved onto. V016 makes the second
    // possible on purpose — `routes.task_kind_id` is unique, not mandatory.
    const routed = new Set(["implement"]);

    expect(batchProblems([request({ taskKind: "docs" })], TASK_KINDS, routed, ALIASES)).toEqual({
      docs: { [TASK_KIND_FIELD]: [SAVE_MESSAGES.noRouteForTaskKind] },
    });
  });

  it("refuses a kind named twice rather than letting the later entry win", () => {
    // A body that says two different things about one row has no reading under which both were
    // applied, and picking one silently would make **Save routes** depend on array order.
    const twice = problems(request(), request({ floorHopIndex: 1 }));

    expect(twice).toEqual({ implement: { [TASK_KIND_FIELD]: [SAVE_MESSAGES.duplicateTaskKind] } });
  });
});

describe("a hop naming an alias this workspace does not have", () => {
  it("is a complaint addressed at the hop that named it", () => {
    const missing = problems(
      request({
        hops: [
          { alias: "coder-max", note: null },
          { alias: "gpt5-experiments", note: null },
        ],
      }),
    );

    expect(missing).toEqual({
      implement: { [hopAliasField(1)]: [unknownAliasMessage("gpt5-experiments")] },
    });
  });

  it("echoes the spelling that was sent", () => {
    // V015 stores aliases folded, so `Coder-Max` genuinely is not `coder-max` — and a client
    // told its correctly-spelled alias does not exist would go looking in the wrong place.
    expect(unknownAliasMessage("Coder-Max")).toContain('"Coder-Max"');
  });

  it("complains about every bad hop rather than the first", () => {
    const missing = problems(
      request({
        hops: [
          { alias: "nope", note: null },
          { alias: "also-nope", note: null },
        ],
      }),
    );

    expect(Object.keys(missing.implement)).toEqual([hopAliasField(0), hopAliasField(1)]);
  });

  it("addresses hops by index, the way a nested validation failure is addressed", () => {
    expect(hopAliasField(0)).toBe("hops.0.alias");
    expect(hopAliasField(2)).toBe("hops.2.alias");
  });
});

describe("a floor deeper than the chain sent with it", () => {
  it("is a complaint about the floor", () => {
    expect(problems(request({ floorHopIndex: 9 }))).toEqual({
      implement: { [FLOOR_FIELD]: [floorTooDeepMessage(9, 2)] },
    });
  });

  it("is measured against the chain in the same body, not the stored one", () => {
    // A save that shortens a chain and lowers its floor is a legal edit. Measuring against the
    // stored chain would refuse it — and V016's own trigger measures the same way at commit.
    expect(
      problems(request({ hops: [{ alias: "coder-max", note: null }], floorHopIndex: 1 })),
    ).toEqual({});
  });

  it("says both numbers, so a client can offer the deepest floor that would work", () => {
    const message = floorTooDeepMessage(9, 3);

    expect(message).toContain("hop 9");
    expect(message).toContain("3 hops");
  });

  it("says hop rather than hops for a chain of one", () => {
    expect(floorTooDeepMessage(2, 1)).toContain("1 hop.");
  });
});

describe("a batch with several things wrong", () => {
  it("collects every route's complaints rather than answering the first", () => {
    // The mockup commits the whole matrix in one press, so answering with the first failure
    // would send a client back for the second, and the third.
    const collected = problems(
      request({ taskKind: "implement", floorHopIndex: 9 }),
      request({ taskKind: "triage" }),
      request({ taskKind: "docs", hops: [{ alias: "nope", note: null }] }),
    );

    expect(Object.keys(collected).sort()).toEqual(["docs", "implement", "triage"]);
  });

  it("collects several complaints about one route", () => {
    const collected = problems(
      request({ taskKind: "triage", floorHopIndex: 9, hops: [{ alias: "nope", note: null }] }),
    );

    expect(Object.keys(collected.triage).sort()).toEqual(
      [TASK_KIND_FIELD, FLOOR_FIELD, hopAliasField(0)].sort(),
    );
  });

  it("keeps the second entry's complaints when a kind is duplicated", () => {
    // Merged rather than assigned: the duplicate complaint must not discard what the second
    // entry said about its own aliases.
    const collected = problems(request(), request({ hops: [{ alias: "nope", note: null }] }));

    expect(Object.keys(collected.implement).sort()).toEqual(
      [TASK_KIND_FIELD, hopAliasField(0)].sort(),
    );
  });
});
