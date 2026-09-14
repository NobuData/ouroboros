import { resolve } from "./resolve";
import { resolutionInput, withHealth } from "./routing.fixture";
import { RESOLUTION_SNAPSHOT_SHAPE_VERSION, snapshotOf } from "./snapshot";

/**
 * The writer's half of CH.6's snapshot contract
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)) — what an executor stores about a
 * resolution it acted on, asserted in V024's spelling.
 *
 * Every refusal here is one of V024's CHECKs met early: a writer that passed a whole key where
 * the suffix belongs, or timed a hop it never tried, should learn so from a `RangeError` naming
 * the hop rather than from a constraint violation at the insert. That the documents this function
 * builds are *accepted* by those CHECKs is `resolutions.integration-spec.ts`' question, answered
 * against a migrated database.
 */

/** Mockup 06's `implement`, everything healthy — run #482's resolution. */
const HEALTHY = resolve(resolutionInput());

/** The same, with Copilot erroring — the run console's dropped hop. */
const COPILOT_DOWN = resolve(withHealth({ copilot: "error" }));

describe("the stored document", () => {
  it("stamps the shape version, the kind, the route and the outcome", () => {
    const document = snapshotOf(HEALTHY, { durationMs: 42 });

    expect(document).toMatchObject({
      shape_version: RESOLUTION_SNAPSHOT_SHAPE_VERSION,
      task_kind: "implement",
      route_tag: "implement-primary",
      outcome: "resolved",
      duration_ms: 42,
    });
    expect(RESOLUTION_SNAPSHOT_SHAPE_VERSION).toBe(1);
  });

  it("writes the hop that resolved as mockup 21's card reads it", () => {
    const [primary] = snapshotOf(HEALTHY, {
      durationMs: 42,
      hops: new Map([[1, { keySuffix: "Xq4A", durationMs: 42 }]]),
    }).chain;

    expect(primary).toEqual({
      index: 1,
      position: 1,
      alias: "coder-max",
      model_id: "claude-fable-5",
      params: {},
      provider: {
        kind: "anthropic",
        display_name: "Anthropic Claude",
        key_suffix: "Xq4A",
        status: "active",
        latency_ms: 42,
        detail: null,
      },
      note: null,
      decision: "kept",
      code: "provider_healthy",
      explanation: "Primary · healthy · 42ms",
      duration_ms: 42,
    });
  });

  it("keeps a dropped hop with its sentence and without a timing", () => {
    const [, fallback] = snapshotOf(COPILOT_DOWN, { durationMs: null }).chain;

    expect(fallback).toMatchObject({
      index: 2,
      alias: "coder-fallback",
      decision: "dropped",
      code: "provider_error",
      explanation: "Fallback 1 dropped — GitHub Copilot is unreachable (elevated latency).",
      duration_ms: null,
      note: "Fallback on 5xx / timeouts",
    });
  });

  it("records nothing execution did not measure", () => {
    // Null is *nobody timed it* and *no key was involved*; 0 and an empty string would each be a
    // claim (decision M8).
    const document = snapshotOf(HEALTHY, { durationMs: null });

    expect(document.duration_ms).toBeNull();
    for (const hop of document.chain) {
      expect(hop.duration_ms).toBeNull();
      expect(hop.provider?.key_suffix).toBeNull();
    }
  });

  it("carries every matched rule, applied or not, in the stored spelling", () => {
    const document = snapshotOf(resolve(resolutionInput({ context: { effort: "l" } })), {
      durationMs: 3,
    });

    expect(document.rules).toEqual([
      {
        id: "5eed0013-0000-4000-8000-000000000001",
        sort_order: 1,
        display: "effort ≥ L → implement uses coder-max (max thinking)",
        applied: true,
        code: "use_alias_params_merged",
        explanation:
          "Applied — coder-max is already the primary, and the rule's parameters " +
          "were merged over the alias's.",
      },
    ]);
  });

  it("stores a refused run as fail_run, with every dropped hop", () => {
    const failed = resolve(withHealth({ anthropic: "error", copilot: "error", ollama: "paused" }));
    const document = snapshotOf(failed, { durationMs: 5 });

    expect(document.outcome).toBe("fail_run");
    expect(document.chain.map((hop) => hop.decision)).toEqual(["dropped", "dropped", "dropped"]);
  });

  it("writes an unbound hop with no provider at all", () => {
    const unbound = resolve(
      resolutionInput({
        hops: resolutionInput().hops.map((hop, offset) =>
          offset === 0 ? { ...hop, target: { ...hop.target, binding: null, enabled: false } } : hop,
        ),
      }),
    );

    expect(snapshotOf(unbound, { durationMs: null }).chain[0].provider).toBeNull();
  });
});

describe("what a writer may not store", () => {
  it.each([
    ["a whole key", "sk-ant-api03-Xq4A"],
    ["a suffix longer than sixteen", "A".repeat(17)],
    ["an empty suffix", ""],
  ])("refuses %s where the masked suffix belongs", (_what, keySuffix) => {
    expect(() =>
      snapshotOf(HEALTHY, { durationMs: 1, hops: new Map([[1, { keySuffix }]]) }),
    ).toThrow(RangeError);
  });

  it("refuses a suffix on a hop with no provider", () => {
    const unbound = resolve(
      resolutionInput({
        hops: resolutionInput().hops.map((hop, offset) =>
          offset === 0 ? { ...hop, target: { ...hop.target, binding: null, enabled: false } } : hop,
        ),
      }),
    );

    expect(() =>
      snapshotOf(unbound, { durationMs: 1, hops: new Map([[1, { keySuffix: "Xq4A" }]]) }),
    ).toThrow("hop 1 is unbound");
  });

  it("refuses a timing on a hop that was dropped, and so never tried", () => {
    expect(() =>
      snapshotOf(COPILOT_DOWN, { durationMs: 1, hops: new Map([[2, { durationMs: 900 }]]) }),
    ).toThrow("hop 2 was dropped");
  });

  it.each([-1, 1.5, Number.NaN])("refuses a duration of %d", (durationMs) => {
    expect(() => snapshotOf(HEALTHY, { durationMs })).toThrow(RangeError);
    expect(() =>
      snapshotOf(HEALTHY, { durationMs: 1, hops: new Map([[1, { durationMs }]]) }),
    ).toThrow(RangeError);
  });

  it("refuses a measurement for a hop the chain does not have", () => {
    expect(() =>
      snapshotOf(HEALTHY, { durationMs: 1, hops: new Map([[9, { durationMs: 1 }]]) }),
    ).toThrow("there is no hop 9");
  });
});
