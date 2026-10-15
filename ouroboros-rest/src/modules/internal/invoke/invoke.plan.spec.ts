import { resolve } from "../../routing/resolve";
import type { Resolution } from "../../routing/resolution";
import { resolutionInput, routedWith } from "../../routing/routing.fixture";
import {
  chainPlan,
  effectiveCap,
  effectiveFloor,
  isRefusal,
  singleHopPlan,
  type InvokePlan,
} from "./invoke.plan";

/** The fixture's `implement-primary`, as routing resolves it. */
function implement(): Resolution {
  return resolve(resolutionInput());
}

/** A plan, or a test failure. */
function planned(value: ReturnType<typeof chainPlan>): InvokePlan {
  if (value === null || isRefusal(value)) {
    throw new Error("expected a plan");
  }

  return value;
}

describe("chainPlan", () => {
  it("walks the kept hops in array order, skipping what routing dropped (R1)", () => {
    const plan = planned(chainPlan(implement(), "coder-max", { run: "r" }));

    // coder-fallback is on Copilot, which routing drops as not invocable.
    expect(plan.hops.map((hop) => [hop.index, hop.alias, hop.position])).toEqual([
      [0, "coder-max", 1],
      [1, "local-docs", 3],
    ]);
    expect(plan.chained).toBe(true);
  });

  it("starts at the alias the worker named", () => {
    const plan = planned(chainPlan(implement(), "local-docs", { run: "r" }));

    expect(plan.hops.map((hop) => hop.alias)).toEqual(["local-docs"]);
  });

  it("answers null for an alias the resolution does not keep, so the caller calls it alone", () => {
    expect(chainPlan(implement(), "coder-fallback", { run: "r" })).toBeNull();
    expect(chainPlan(implement(), "sizer", { run: "r" })).toBeNull();
  });

  it("runs nothing for a fail_run resolution and carries routing's failure code", () => {
    const failed: Resolution = {
      ...implement(),
      outcome: "fail_run",
      failure: { code: "floor_breached", explanation: "Routing says no." },
    };
    const plan = chainPlan(failed, "coder-max", { run: "r" });

    expect(plan).toEqual({
      refused: true,
      code: "resolution_failed",
      message: "Routing says no.",
      reason: "floor_breached",
    });
  });

  it("refuses a resolution with a vote rather than dropping the vote silently (G5)", () => {
    const voted = { ...implement(), votes: [{ alias: "second-opinion" }] } as unknown as Resolution;

    expect(chainPlan(voted, "coder-max", { run: "r" })).toMatchObject({
      refused: true,
      code: "vote_execution_unavailable",
    });
  });

  it("carries routing's floor and its sentence", () => {
    const resolution = resolve(routedWith({ floorHopIndex: 2 }));
    const plan = planned(chainPlan(resolution, "coder-max", { run: "r" }));

    expect(plan.floorPosition).toBe(2);
    expect(plan.floorReason).toBe(resolution.floor.explanation);
  });

  it("takes the cap from routing, lowered by the worker's (R4)", () => {
    expect(planned(chainPlan(implement(), "coder-max", { run: "r" })).cap).toEqual({
      source: "route",
      limitCents: 250,
    });
    expect(
      planned(chainPlan(implement(), "coder-max", { run: "r", costCapCents: 100 })).cap,
    ).toEqual({
      source: "worker",
      limitCents: 100,
    });
    expect(
      planned(chainPlan(implement(), "coder-max", { run: "r", costCapCents: 900 })).cap,
    ).toEqual({
      source: "route",
      limitCents: 250,
    });
  });
});

describe("effectiveFloor", () => {
  it("lets a worker tighten the floor and never loosen it (G4)", () => {
    expect(effectiveFloor(3, 2)).toBe(2);
    expect(effectiveFloor(2, 5)).toBe(2);
    expect(effectiveFloor(null, 2)).toBe(2);
    expect(effectiveFloor(2, undefined)).toBe(2);
    expect(effectiveFloor(null, undefined)).toBeNull();
  });
});

describe("effectiveCap", () => {
  it("names the spend guard when it set the cap", () => {
    expect(
      effectiveCap(
        100,
        { limit: "spend_guard", ruleId: "spend_guard", policyVersion: 3 },
        undefined,
      ),
    ).toEqual({
      source: "spend_guard",
      limitCents: 100,
    });
  });

  it("is the worker's alone when routing has none", () => {
    expect(effectiveCap(null, undefined, 40)).toEqual({ source: "worker", limitCents: 40 });
    expect(effectiveCap(null, undefined, undefined)).toBeNull();
  });
});

describe("singleHopPlan", () => {
  it("is one hop with no fallback and no floor", () => {
    const plan = singleHopPlan(
      { alias: null, modelId: "m", params: {}, connectionId: "c", kind: "ollama" },
      null,
    );

    expect(plan).toEqual({
      hops: [
        {
          index: 0,
          position: null,
          alias: null,
          modelId: "m",
          params: {},
          connectionId: "c",
          kind: "ollama",
        },
      ],
      chained: false,
      floorPosition: null,
      floorReason: null,
      cap: null,
    });
  });
});
