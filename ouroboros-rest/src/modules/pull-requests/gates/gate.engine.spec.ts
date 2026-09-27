import type { PrGateVerdict, PullRequestState } from "../../db/schema";
import {
  ENGINE_VERSION,
  aggregate,
  evaluateGate,
  statePath,
  unchanged,
  type GateAggregate,
} from "./gate.engine";
import { REVISION_2 } from "./gate.matrix.fixture";
import { GATE_PROVIDERS } from "./gate.providers";
import type { GateResultRow } from "./gate.types";

/**
 * The engine's pure core (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)) — the
 * aggregate V056 documents, the state it drives, and the idempotency rule.
 */

/** Mockup 12's Revision 2 — five green, model_review unavailable, human not_required, all required. */
const REVISION_2_VERDICTS: PrGateVerdict[] = [
  "green",
  "green",
  "green",
  "green",
  "green",
  "unavailable",
  "not_required",
];

/** Revision 1 — the overshoot and one more red. */
const REVISION_1_VERDICTS: PrGateVerdict[] = [
  "green",
  "red",
  "red",
  "green",
  "green",
  "unavailable",
  "not_required",
];

/**
 * @param verdicts - One per required gate.
 * @returns The gates as `aggregate` reads them.
 */
function required(verdicts: (PrGateVerdict | undefined)[]) {
  return verdicts.map((verdict) => ({ required: true, verdict }));
}

describe("aggregate", () => {
  it("reads Revision 2 as 5 of 7 green, 6 satisfied, not merge-ready", () => {
    expect(aggregate(required(REVISION_2_VERDICTS))).toEqual({
      requiredCount: 7,
      greenCount: 5,
      redCount: 0,
      satisfiedCount: 6,
      mergeReady: false,
    });
  });

  it("reads Revision 1 as 2 gates red", () => {
    expect(aggregate(required(REVISION_1_VERDICTS))).toMatchObject({ greenCount: 3, redCount: 2 });
  });

  it("counts waived and not_required toward the precondition, and pending, unavailable and no result against it", () => {
    expect(aggregate(required(["green", "waived", "not_required"])).mergeReady).toBe(true);

    for (const blocking of ["pending", "unavailable", "red", undefined] as const) {
      expect(aggregate(required(["green", blocking])).mergeReady).toBe(false);
    }
  });

  it("ignores advisory gates, and never calls an empty gate set ready", () => {
    expect(
      aggregate([
        { required: true, verdict: "green" },
        { required: false, verdict: "red" },
      ]),
    ).toEqual({
      requiredCount: 1,
      greenCount: 1,
      redCount: 0,
      satisfiedCount: 1,
      mergeReady: true,
    });
    expect(aggregate([]).mergeReady).toBe(false);
  });
});

describe("statePath", () => {
  const ready: GateAggregate = aggregate(required(["green", "green"]));
  const verifying: GateAggregate = aggregate(required(REVISION_2_VERDICTS));
  const blocked: GateAggregate = aggregate(required(REVISION_1_VERDICTS));

  it.each<[PullRequestState, GateAggregate, PullRequestState[]]>([
    ["open", verifying, ["verifying"]],
    ["open", blocked, ["verifying", "blocked"]],
    ["verifying", verifying, []],
    ["verifying", blocked, ["blocked"]],
    ["verifying", ready, []],
    ["blocked", blocked, []],
    ["blocked", verifying, ["verifying"]],
    ["armed", ready, []],
    ["armed", verifying, []],
    ["armed", blocked, ["verifying", "blocked"]],
    ["merged", blocked, []],
    ["closed", verifying, []],
  ])("moves %s under %j along %j", (current, result, path) => {
    expect(statePath(current, result)).toEqual(path);
  });

  it("walks only edges V052 admits", () => {
    const edges: Record<PullRequestState, PullRequestState[]> = {
      open: ["verifying", "closed", "merged"],
      verifying: ["blocked", "armed", "closed", "merged"],
      blocked: ["verifying", "closed", "merged"],
      armed: ["verifying", "merged", "closed"],
      closed: ["open"],
      merged: [],
    };

    for (const current of Object.keys(edges) as PullRequestState[]) {
      for (const result of [ready, verifying, blocked]) {
        let at = current;

        for (const next of statePath(current, result)) {
          expect(edges[at]).toContain(next);
          at = next;
        }
      }
    }
  });
});

describe("unchanged", () => {
  const row: GateResultRow = {
    definitionId: "def-build",
    gateKey: "build",
    required: true,
    verdict: "green",
    evidence: "forge-01 · zephyr.elf · FLASH 43.5%",
    evidenceRef: { kind: "build_job", id: "5eed0028-0000-4000-8000-000000000485" },
    providerVersion: "gate-build@1.0.0",
  };
  const latest = {
    definitionId: row.definitionId,
    verdict: row.verdict,
    evidence: row.evidence,
    evidenceRef: row.evidenceRef,
    providerVersion: row.providerVersion,
  };

  it("is true only when verdict, line, reference and provider all match", () => {
    expect(unchanged(row, latest)).toBe(true);
    expect(unchanged(row, undefined)).toBe(false);
    expect(unchanged(row, { ...latest, verdict: "red" })).toBe(false);
    expect(unchanged(row, { ...latest, evidence: "forge-02 · zephyr.elf · FLASH 43.5%" })).toBe(
      false,
    );
    expect(unchanged(row, { ...latest, evidenceRef: null })).toBe(false);
    expect(unchanged(row, { ...latest, providerVersion: "gate-build@1.0.1" })).toBe(false);
    expect(unchanged({ ...row, evidenceRef: null }, { ...latest, evidenceRef: null })).toBe(true);
  });
});

describe("evaluateGate", () => {
  it("answers a custom gate with no provider as unavailable, under the engine's version", () => {
    expect(
      evaluateGate(
        { id: "def-custom", gateKey: "custom:coverage", required: true, source: "org config" },
        undefined,
        REVISION_2,
        GATE_PROVIDERS,
        [],
      ),
    ).toEqual({
      definitionId: "def-custom",
      gateKey: "custom:coverage",
      required: true,
      verdict: "unavailable",
      evidence: "no provider for custom:coverage",
      evidenceRef: null,
      providerVersion: ENGINE_VERSION,
    });
  });

  it("does not let a waiver touch a gate that is not red", () => {
    expect(
      evaluateGate(
        { id: "def-build", gateKey: "build", required: true, source: "pin" },
        undefined,
        REVISION_2,
        GATE_PROVIDERS,
        [{ gateKey: "build", reason: "no reason needed" }],
      ).verdict,
    ).toBe("green");
  });
});
