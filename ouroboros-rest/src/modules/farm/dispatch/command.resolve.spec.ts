/**
 * The build command's one rule, shared by dispatch and the loop readiness check (FE.3, #1836):
 * the same cases through {@link resolveBuildCommand} and through `loopReadiness`, so the check is
 * red exactly when dispatch would refuse `farm_command_required`.
 */

import { loopReadiness, type ReadinessFacts } from "../../loop/readiness";
import { resolveBuildCommand } from "./command";

/** One case: the stage's command, the pool's default, and where the command comes from. */
const CASES: readonly (readonly [
  name: string,
  stage: string | null,
  poolDefault: string | null,
  expected: "stage" | "pool" | undefined,
])[] = [
  ["the stage's own command", "make all", null, "stage"],
  ["the stage's command over the pool's default", "make all", "west build", "stage"],
  ["the pool's default when the stage sets none", null, "west build -b helios app", "pool"],
  ["an empty stage command falls back to the pool", "", "make", "pool"],
  ["neither", null, null, undefined],
  ["a pool default dispatch cannot read back into argv", null, 'make "all"', undefined],
  ["a pool default of two spaces between words", null, "make  all", undefined],
];

/**
 * Facts for one ready workspace whose one build stage is on pool-a.
 *
 * @param stage - The stage's command.
 * @param poolDefault - pool-a's default command.
 * @returns The facts.
 */
function facts(stage: string | null, poolDefault: string | null): ReadinessFacts {
  return {
    repository: { slug: "acme/helios", enabled: true },
    workflowSlug: "live-slice",
    workflow: {
      slug: "live-slice",
      version: 1,
      stages: {
        modelStages: 0,
        tasks: [],
        buildStages: [{ node: "build", pool: "pool-a", command: stage }],
      },
    },
    deploymentEnabled: true,
    workspaceState: "active",
    connections: [{ kind: "anthropic", displayName: "Anthropic", status: "active" }],
    routes: [],
    engine: { reachable: true, executors: ["harness"] },
    pools: [
      {
        name: "pool-a",
        exists: true,
        enabled: true,
        online: 1,
        eligible: 1,
        defaultCommand: poolDefault,
      },
    ],
    defaultPool: null,
    push: { outcome: "can_push" },
    pullRequest: { outcome: "can_push" },
    dryRun: true,
    slots: { taken: 0, ceiling: 1 },
    estimate: { costCapCentsPerRun: null, issue: null },
  };
}

describe("resolveBuildCommand — dispatch and readiness agree (FE.3, #1836)", () => {
  it.each(CASES)("%s", (_name, stage, poolDefault, expected) => {
    const resolved = resolveBuildCommand(stage, poolDefault);
    const check = loopReadiness(facts(stage, poolDefault)).checks.find(
      (candidate) => candidate.id === "build_command",
    );

    expect(resolved?.source).toBe(expected);
    expect(resolved?.text).toBe(
      expected === "stage" ? stage : expected === "pool" ? poolDefault : undefined,
    );
    // Readiness is green exactly when dispatch has a command to send.
    expect(check?.state).toBe(expected === undefined ? "fail" : "pass");
    expect(check?.code).toBe(expected === undefined ? "build_command_required" : null);
  });

  it("treats undefined as no command, the way an API request without one reads", () => {
    expect(resolveBuildCommand(undefined, null)).toBeUndefined();
    expect(resolveBuildCommand(undefined, "make")).toEqual({ source: "pool", text: "make" });
  });
});
