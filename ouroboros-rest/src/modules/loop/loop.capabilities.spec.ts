import {
  LOOP_REASONS,
  LOOP_STAGES,
  loopCapabilities,
  PR_PUBLISHING_IMPLEMENTED,
  STAGE_SINCE_VERSION,
  type LoopFacts,
  type LoopReason,
  type LoopStage,
} from "./loop.capabilities";

/** Today's `main`: nothing is wired, and the workspace has nothing either. */
const TODAY: LoopFacts = {
  deploymentEnabled: false,
  invocationImplemented: false,
  invocableConnection: false,
  engine: { reachable: true, taskQueue: false, executors: [] },
  runners: { online: false, sourceCheckout: false },
  prPublishingImplemented: false,
  dryRun: false,
};

/** Every condition met — the state the whole slice is building toward. */
const ALL_LIVE: LoopFacts = {
  deploymentEnabled: true,
  invocationImplemented: true,
  invocableConnection: true,
  engine: { reachable: true, taskQueue: true, executors: ["native", "harness"] },
  runners: { online: true, sourceCheckout: true },
  prPublishingImplemented: true,
  dryRun: true,
};

/**
 * `ALL_LIVE`, with some facts overridden.
 *
 * @param change - The facts to change.
 * @returns The facts.
 */
function live(change: Partial<LoopFacts>): LoopFacts {
  return { ...ALL_LIVE, ...change };
}

const reasonOf = (facts: LoopFacts, stage: LoopStage): LoopReason | null =>
  loopCapabilities(facts).stages[stage].reason;

describe("the loop capability report (DG.2, #1300)", () => {
  describe("on today's main", () => {
    it("reports every stage unavailable, each with the reason the issue names", () => {
      expect(loopCapabilities(TODAY)).toEqual({
        deploymentEnabled: false,
        stages: {
          invocation: { available: false, reason: "not_implemented", sinceVersion: null },
          execution: { available: false, reason: "deployment_disabled", sinceVersion: null },
          guardrailEnforcement: {
            available: false,
            reason: "execution_unavailable",
            sinceVersion: null,
          },
          buildIntegration: { available: false, reason: "no_runner", sinceVersion: null },
          prPublishing: { available: false, reason: "execution_unavailable", sinceVersion: null },
        },
        executors: [],
      });
    });

    it("has shipped no stage and no PR publishing yet", () => {
      expect(PR_PUBLISHING_IMPLEMENTED).toBe(false);
      expect(Object.values(STAGE_SINCE_VERSION)).toEqual([null, null, null, null, null]);
    });
  });

  it("reports every stage available once every condition holds", () => {
    const report = loopCapabilities(ALL_LIVE);

    for (const stage of LOOP_STAGES) {
      expect(report.stages[stage]).toEqual({ available: true, reason: null, sinceVersion: null });
    }
    expect(report.executors).toEqual(["native", "harness"]);
    expect(report.deploymentEnabled).toBe(true);
  });

  describe("one test per reason code — each flips the stage when, and only when, it holds", () => {
    const cases: readonly [LoopReason, LoopStage, Partial<LoopFacts>][] = [
      ["not_implemented", "invocation", { invocationImplemented: false }],
      ["no_invocable_connection", "invocation", { invocableConnection: false }],
      ["deployment_disabled", "execution", { deploymentEnabled: false }],
      [
        "engine_unavailable",
        "execution",
        { engine: { reachable: false, taskQueue: false, executors: [] } },
      ],
      [
        "no_task_queue",
        "execution",
        { engine: { reachable: true, taskQueue: false, executors: ["harness"] } },
      ],
      ["no_executor", "execution", { engine: { reachable: true, taskQueue: true, executors: [] } }],
      ["execution_unavailable", "guardrailEnforcement", { deploymentEnabled: false }],
      ["no_runner", "buildIntegration", { runners: { online: false, sourceCheckout: false } }],
      [
        "no_source_checkout",
        "buildIntegration",
        { runners: { online: true, sourceCheckout: false } },
      ],
      ["policy_not_dry_run", "prPublishing", { dryRun: false }],
    ];

    it("covers every code in the vocabulary", () => {
      const covered = new Set(cases.map(([reason]) => reason));

      // `not_implemented` and `execution_unavailable` also reach a second stage, below.
      expect([...covered].sort()).toEqual([...LOOP_REASONS].sort());
    });

    it.each(cases)("%s — makes %s unavailable", (reason, stage, change) => {
      expect(reasonOf(live(change), stage)).toBe(reason);
      expect(loopCapabilities(live(change)).stages[stage].available).toBe(false);
      // …and only that fact: restore it and the stage is live again.
      expect(reasonOf(ALL_LIVE, stage)).toBeNull();
    });

    it("not_implemented — PR publishing waits on DI.2/DI.3's code", () => {
      expect(reasonOf(live({ prPublishingImplemented: false }), "prPublishing")).toBe(
        "not_implemented",
      );
    });

    it("execution_unavailable — PR publishing waits on execution", () => {
      expect(reasonOf(live({ deploymentEnabled: false }), "prPublishing")).toBe(
        "execution_unavailable",
      );
    });
  });

  describe("the deployment switch", () => {
    it("keeps execution off whatever else is true", () => {
      const report = loopCapabilities(live({ deploymentEnabled: false }));

      expect(report.deploymentEnabled).toBe(false);
      expect(report.stages.execution).toEqual({
        available: false,
        reason: "deployment_disabled",
        sinceVersion: null,
      });
      // And everything that runs inside execution with it.
      expect(report.stages.guardrailEnforcement.available).toBe(false);
      expect(report.stages.prPublishing.available).toBe(false);
    });

    it("does not touch the stages that do not run inside execution", () => {
      const report = loopCapabilities(live({ deploymentEnabled: false }));

      expect(report.stages.invocation.available).toBe(true);
      expect(report.stages.buildIntegration.available).toBe(true);
    });

    it("still reports the executors the engine registered", () => {
      expect(loopCapabilities(live({ deploymentEnabled: false })).executors).toEqual([
        "native",
        "harness",
      ]);
    });
  });

  describe("precedence — the nearest thing to fix comes first", () => {
    it("names the switch before the engine", () => {
      const facts = live({
        deploymentEnabled: false,
        engine: { reachable: false, taskQueue: false, executors: [] },
      });

      expect(reasonOf(facts, "execution")).toBe("deployment_disabled");
    });

    it("names an unreachable engine before its queue", () => {
      expect(
        reasonOf(
          live({ engine: { reachable: false, taskQueue: false, executors: [] } }),
          "execution",
        ),
      ).toBe("engine_unavailable");
    });

    it("names an unimplemented route before a missing connection", () => {
      expect(
        reasonOf(live({ invocationImplemented: false, invocableConnection: false }), "invocation"),
      ).toBe("not_implemented");
    });

    it("names a missing runner before a missing capability", () => {
      expect(
        reasonOf(live({ runners: { online: false, sourceCheckout: false } }), "buildIntegration"),
      ).toBe("no_runner");
    });

    it("names execution before PR publishing's own code and policy", () => {
      expect(
        reasonOf(
          live({ deploymentEnabled: false, prPublishingImplemented: false, dryRun: false }),
          "prPublishing",
        ),
      ).toBe("execution_unavailable");
      expect(
        reasonOf(live({ prPublishingImplemented: false, dryRun: false }), "prPublishing"),
      ).toBe("not_implemented");
    });
  });

  it("reports no executors from an engine it could not reach", () => {
    const facts = live({ engine: { reachable: false, taskQueue: true, executors: ["harness"] } });

    expect(loopCapabilities(facts).executors).toEqual([]);
  });
});
