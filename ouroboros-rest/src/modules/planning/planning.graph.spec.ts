import { DomainError } from "../errors/error.envelope";
import { assertAcyclic, withBlockers } from "./planning.graph";
import { PUSH_ERRORS } from "./push.errors";

/**
 * The acyclicity rule every edge write passes through (AL.4, #280) — and the criterion that a
 * cycle-introducing edit is a `422` **naming the cycle**, not a generic validation error.
 */

/** Mockup 09's six drafts, by key. */
const DRAFTS = ["OTA-1", "OTA-2", "OTA-3", "OTA-4", "OTA-5", "OTA-6"].map((key) => ({
  id: key,
  localKey: key,
}));

/** The mockup's shape: OTA-3 ← OTA-1, OTA-2; OTA-5 ← OTA-3, OTA-4. */
const EDGES = [
  { blockerId: "OTA-1", blockedId: "OTA-3" },
  { blockerId: "OTA-2", blockedId: "OTA-3" },
  { blockerId: "OTA-3", blockedId: "OTA-5" },
  { blockerId: "OTA-4", blockedId: "OTA-5" },
];

/**
 * What a refusal carried.
 *
 * @param run - The call expected to refuse.
 * @returns The envelope.
 */
function refusal(run: () => void) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);

    return { status: (error as DomainError).getStatus(), ...(error as DomainError).envelope() };
  }

  throw new Error("expected a refusal");
}

describe("assertAcyclic", () => {
  it("accepts the mockup's dependency shape", () => {
    expect(() => {
      assertAcyclic("batch-1", DRAFTS, EDGES);
    }).not.toThrow();
  });

  it("refuses the issue's own example — OTA-3 → OTA-5 → OTA-3 — naming the cycle", () => {
    // PATCH …/drafts/OTA-3 {dependencies: ["OTA-5"]} where OTA-5 already waits on OTA-3.
    const envelope = refusal(() => {
      assertAcyclic("batch-1", DRAFTS, withBlockers(EDGES, "OTA-3", ["OTA-5"]));
    });

    expect(envelope.status).toBe(422);
    expect(envelope.code).toBe(PUSH_ERRORS.cycle);
    expect(envelope.message).toContain("OTA-3 → OTA-5 → OTA-3");
    expect(envelope.details).toEqual({ batchId: "batch-1", cycle: ["OTA-3", "OTA-5", "OTA-3"] });
  });

  it("names a longer cycle from its smallest key", () => {
    const envelope = refusal(() => {
      assertAcyclic("batch-1", DRAFTS, [...EDGES, { blockerId: "OTA-5", blockedId: "OTA-1" }]);
    });

    expect(envelope.details).toMatchObject({ cycle: ["OTA-1", "OTA-3", "OTA-5", "OTA-1"] });
  });

  it("ignores an edge naming a draft outside the graph", () => {
    expect(() => {
      assertAcyclic("batch-1", DRAFTS, [{ blockerId: "ELSEWHERE", blockedId: "OTA-1" }]);
    }).not.toThrow();
  });
});

describe("withBlockers", () => {
  it("replaces one draft's blockers and keeps every other edge", () => {
    expect(withBlockers(EDGES, "OTA-5", ["OTA-6"])).toEqual([
      { blockerId: "OTA-1", blockedId: "OTA-3" },
      { blockerId: "OTA-2", blockedId: "OTA-3" },
      { blockerId: "OTA-6", blockedId: "OTA-5" },
    ]);
  });

  it("clears a draft's blockers with an empty list", () => {
    expect(withBlockers(EDGES, "OTA-3", [])).toEqual([
      { blockerId: "OTA-3", blockedId: "OTA-5" },
      { blockerId: "OTA-4", blockedId: "OTA-5" },
    ]);
  });
});
