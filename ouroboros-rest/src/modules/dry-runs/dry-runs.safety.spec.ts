import type { EngineDryRunHarness } from "../engine/engine.dryruns";
import { safetyStrip } from "./dry-runs.safety";
import { HARNESS } from "./dry-runs.store.fixture";

function column(harness: EngineDryRunHarness, id: string) {
  return safetyStrip(harness).columns.find((entry) => entry.id === id);
}

describe("the safety strip", () => {
  it("serves three columns, each with the mechanism that backs it", () => {
    const strip = safetyStrip(HARNESS);

    expect(strip.harness).toBe("dry-run-v1");
    expect(strip.columns.map((entry) => [entry.id, entry.holds, entry.mechanism.kind])).toEqual([
      ["simulated_writes", true, "overlay"],
      ["replayed_infra", true, "estimator_service"],
      ["real_models", true, "gateway_routing"],
    ]);
    expect(column(HARNESS, "simulated_writes")?.mechanism.tools).toEqual(["edit_file"]);
    expect(column(HARNESS, "replayed_infra")?.mechanism).toMatchObject({
      tools: ["build", "run_tests"],
      path: "/internal/dry-runs/{id}/replay-estimates",
    });
    expect(column(HARNESS, "replayed_infra")?.facts).toEqual({
      formulas: [
        { id: "build_duration_replay", version: 1, dispersion: "median_absolute_deviation" },
        { id: "test_duration_replay", version: 1, dispersion: "median_absolute_deviation" },
      ],
    });
    expect(column(HARNESS, "real_models")?.mechanism.path).toBe("/internal/llm/invoke");
    expect(strip.absent).toEqual([
      { claim: "no writes", capability: "repository_write" },
      { claim: "no PRs", capability: "pull_request" },
      { claim: "no merges", capability: "pull_request" },
    ]);
    expect(strip.guards).toEqual(HARNESS.guards);
    expect(strip.blockedCallFailsRun).toBe(true);
  });

  it("changes when a guard changes", () => {
    const widened = safetyStrip({
      ...HARNESS,
      guards: [...HARNESS.guards, { name: "egress_filter", refuses: "Refuses an outbound call." }],
    });
    expect(widened.guards.map((guard) => guard.name)).toContain("egress_filter");

    // Without the allow-list nothing decides which tools exist: writes are not provably simulated.
    const unguarded = {
      ...HARNESS,
      guards: HARNESS.guards.filter((guard) => guard.name !== "allow_list"),
    };
    expect(column(unguarded, "simulated_writes")?.holds).toBe(false);
    expect(safetyStrip(unguarded).guards).toHaveLength(1);
  });

  it("stops claiming simulated writes when a repository write becomes possible", () => {
    const writable = {
      ...HARNESS,
      forbiddenCapabilities: HARNESS.forbiddenCapabilities.filter(
        (name) => name !== "repository_write",
      ),
    };

    expect(column(writable, "simulated_writes")?.holds).toBe(false);
    expect(safetyStrip(writable).absent.map((entry) => entry.claim)).toEqual([
      "no PRs",
      "no merges",
    ]);
    expect(column({ ...HARNESS, writes: "disk" }, "simulated_writes")?.holds).toBe(false);
    expect(
      column(
        { ...HARNESS, tools: HARNESS.tools.filter((tool) => tool.effect !== "simulated_write") },
        "simulated_writes",
      )?.holds,
    ).toBe(false);
  });

  it("stops claiming replayed infra when the farm is reachable or the estimator is not what answers", () => {
    expect(
      column(
        {
          ...HARNESS,
          forbiddenCapabilities: HARNESS.forbiddenCapabilities.filter(
            (name) => name !== "farm_dispatch",
          ),
        },
        "replayed_infra",
      )?.holds,
    ).toBe(false);
    expect(column({ ...HARNESS, replayEstimatesPath: "/elsewhere" }, "replayed_infra")?.holds).toBe(
      false,
    );
    expect(
      column(
        { ...HARNESS, tools: HARNESS.tools.filter((tool) => tool.effect !== "replay") },
        "replayed_infra",
      )?.holds,
    ).toBe(false);
  });

  it("stops claiming real models through the gateway when calls go elsewhere or a credential is reachable", () => {
    expect(column({ ...HARNESS, invokePath: "/v1/messages" }, "real_models")?.holds).toBe(false);
    expect(
      column(
        {
          ...HARNESS,
          forbiddenCapabilities: HARNESS.forbiddenCapabilities.filter(
            (name) => name !== "credential_access",
          ),
        },
        "real_models",
      )?.holds,
    ).toBe(false);
  });
});
