import { SECRETS_RULESET_DISCLOSURE } from "../guardrails/guardrails.ruleset";
import {
  budgetStageOf,
  changesOf,
  entryOf,
  guardrailsOf,
  guardrailsStatusOf,
  resourcesOf,
  secondsBetween,
  subjectOf,
  timelineOf,
  type ResourcesInput,
} from "./console.resources";
import {
  commitRow,
  eventRow,
  fileRow,
  guardrailRow,
  into,
  mockupGuardrails,
  mockupStages,
  stageRow,
  STARTED,
} from "./runs.fixture";

/**
 * The console's mappers, against mockup 10's own numbers.
 *
 * The acceptance criterion is that *nothing the page renders is computed in the browser from
 * something the API did not state*, so each card is asserted here to state every figure the
 * mockup draws — the stepper's three durations and `attempt 2/3`, the change-set's `3 files`,
 * `212k / 400k`, `$1.14 / $2.50`, `forge-02`, `12m 40s`, the `clean` pill and the footer — and
 * to state nothing it was not given. The two honesty rules are asserted outright: a missing rate
 * is never a zero, and a missing relationship is an omitted field.
 */

/** The mockup's ledger: 212 000 tokens and 114 cents, four rows, all priced. */
const MOCKUP_SPEND = {
  tokensIn: 169_600,
  tokensOut: 42_400,
  costCents: "114.0000",
  unpricedEvents: 0,
};

/** The Resources card's inputs as mockup 10 draws them, twelve minutes forty seconds in. */
function mockupResources(over: Partial<ResourcesInput> = {}): ResourcesInput {
  return {
    spend: MOCKUP_SPEND,
    budgetStage: budgetStageOf(mockupStages()),
    route: { tag: "implement-primary", maxCostCentsPerRun: 250 },
    reservation: {
      id: "5eed0026-0000-4000-8000-000000000483",
      number: 483,
      status: "running",
      runnerName: "forge-02",
    },
    startedAt: STARTED,
    finishedAt: null,
    asOf: into(760),
    ...over,
  };
}

describe("secondsBetween", () => {
  it("floors to whole seconds, as the stepper's captions print them", () => {
    expect(secondsBetween(into(4), into(76))).toBe(72);
    expect(secondsBetween(STARTED, new Date(STARTED.getTime() + 1999))).toBe(1);
  });

  it("is null unless both ends are known", () => {
    expect(secondsBetween(null, into(4))).toBeNull();
    expect(secondsBetween(into(4), null)).toBeNull();
  });

  it("never goes negative when a clock stepped backwards", () => {
    expect(secondsBetween(into(10), into(4))).toBe(0);
  });
});

describe("the stepper", () => {
  const timeline = timelineOf("standard-fix", 14, mockupStages());

  it("draws one node per stage, in pinned order, whatever order the rows arrived in", () => {
    expect(timeline.stages.map((stage) => stage.stageKey)).toEqual([
      "queued",
      "analyze",
      "plan",
      "implement",
      "build",
      "review",
    ]);
  });

  it("states the three done captions the mockup prints: 0m 04s, 1m 12s, 2m 05s", () => {
    const [queued, analyze, plan] = timeline.stages;

    expect([queued.status, analyze.status, plan.status]).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect([queued.durationSeconds, analyze.durationSeconds, plan.durationSeconds]).toEqual([
      4, 72, 125,
    ]);
  });

  it("states attempt 2/3 and the gate's note on the active node", () => {
    const implement = timeline.stages[3];

    expect(implement).toMatchObject({
      status: "active",
      attempt: 2,
      maxAttempts: 3,
      durationSeconds: null,
      note: "attempt 1 failed tests — loop returned from gate ↺",
    });
    expect(timeline.currentStageKey).toBe("implement");
  });

  it("keeps every attempt, oldest first, with the transition the note was composed from", () => {
    const [first, second] = timeline.stages[3].attempts;

    expect(first).toEqual({
      attempt: 1,
      status: "failed",
      startedAt: into(201).toISOString(),
      finishedAt: into(460).toISOString(),
      durationSeconds: 259,
      note: null,
    });
    // An attempt no loop edge produced has no `returnedFrom` at all — absent, not null.
    expect(first).not.toHaveProperty("returnedFrom");
    expect(second.returnedFrom).toEqual({
      stageKey: "checks-green",
      kind: "gate",
      reason: "failed_tests",
    });
  });

  it("draws a stage not yet entered as pending with nothing to caption", () => {
    expect(timeline.stages[4]).toMatchObject({
      stageKey: "build",
      label: "Build farm",
      status: "pending",
      attempt: 1,
      maxAttempts: null,
      durationSeconds: null,
    });
  });

  it("names the pin the card's tag prints", () => {
    expect(timeline.workflowTag).toBe("standard-fix");
    expect(timeline.workflowVersion).toBe(14);
  });

  it("has no current stage and no nodes for a run that has no history", () => {
    expect(timelineOf("standard-fix", null, [])).toEqual({
      workflowTag: "standard-fix",
      workflowVersion: null,
      currentStageKey: null,
      stages: [],
    });
  });
});

describe("the budget stage", () => {
  it("is the model stage that started most recently — implement's second attempt", () => {
    expect(budgetStageOf(mockupStages())).toMatchObject({ stage_key: "implement", attempt: 2 });
  });

  it("stays on the last model stage while the run sits in one with no limits", () => {
    const stages = [
      ...mockupStages(),
      stageRow({ stage_key: "build", position: 5, status: "active", started_at: into(800) }),
    ];

    expect(budgetStageOf(stages)?.stage_key).toBe("implement");
  });

  it("breaks a tie in start time by the later attempt", () => {
    const stages = [
      stageRow({ attempt: 1, started_at: into(10), token_budget: 100_000 }),
      stageRow({ attempt: 2, started_at: into(10), token_budget: 200_000 }),
    ];

    expect(budgetStageOf(stages)?.token_budget).toBe(200_000);
  });

  it("is absent before any model stage has started — the count-only case", () => {
    expect(budgetStageOf([stageRow({ token_budget: 400_000 })])).toBeUndefined();
    expect(budgetStageOf([])).toBeUndefined();
  });
});

describe("the changes card", () => {
  const changes = changesOf(
    [
      fileRow(),
      fileRow({ path: "drivers/can/isr_fastpath.c", additions: 9, deletions: 3 }),
      fileRow({
        path: "tests/telemetry/test_frame_order.c",
        additions: 21,
        deletions: 0,
        status: "added",
      }),
    ],
    [
      commitRow(),
      commitRow({
        seq: 2,
        sha: "7f03b8d",
        message: "can: assign frame seq in ISR before enqueue",
        committed_at: into(580),
      }),
    ],
    "squash",
  );

  it("draws the three file rows in the order given, with their counts", () => {
    expect(changes.files).toEqual([
      {
        path: "drivers/can/telemetry_buf.c",
        status: "modified",
        additions: 38,
        deletions: 12,
      },
      { path: "drivers/can/isr_fastpath.c", status: "modified", additions: 9, deletions: 3 },
      {
        path: "tests/telemetry/test_frame_order.c",
        status: "added",
        additions: 21,
        deletions: 0,
      },
    ]);
  });

  it("states the 3 files tag and the sums, rather than leaving them to the browser", () => {
    expect(changes.totals).toEqual({ files: 3, additions: 68, deletions: 15 });
  });

  it("draws each commit as its seven-character chip and its first line", () => {
    expect(changes.commits).toEqual([
      {
        sha: "a41c9e2",
        shortSha: "a41c9e2",
        subject: "can: replace telemetry k_fifo with k_msgq + frame seq",
        committedAt: into(300).toISOString(),
      },
      {
        sha: "7f03b8d",
        shortSha: "7f03b8d",
        subject: "can: assign frame seq in ISR before enqueue",
        committedAt: into(580).toISOString(),
      },
    ]);
  });

  it("states the merge tag's source", () => {
    expect(changes.mergeStrategy).toBe("squash");
  });

  it("abbreviates a full sha and keeps the whole name beside it", () => {
    const sha = "a41c9e2b7d0c4f1e8a9b3c5d6e7f8091a2b3c4d5";
    const [commit] = changesOf([], [commitRow({ sha })], null).commits;

    expect(commit.sha).toBe(sha);
    expect(commit.shortSha).toBe("a41c9e2");
  });

  it("is empty — zero files, no commits, no tag — for a run that has changed nothing", () => {
    expect(changesOf([], [], null)).toEqual({
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
      commits: [],
      mergeStrategy: null,
    });
  });
});

describe("subjectOf", () => {
  it("is the first line of a multi-line message", () => {
    expect(subjectOf("can: fix the ISR\n\nLonger explanation.")).toBe("can: fix the ISR");
    expect(subjectOf("can: fix the ISR  \r\nbody")).toBe("can: fix the ISR");
  });
});

describe("the resources card", () => {
  it("states 212k / 400k, $1.14 / $2.50, forge-02 and 12m 40s", () => {
    expect(resourcesOf(mockupResources())).toEqual({
      tokens: {
        used: 212_000,
        tokensIn: 169_600,
        tokensOut: 42_400,
        budget: 400_000,
        budgetStageKey: "implement",
      },
      cost: {
        costCents: "114.0000",
        unpricedEvents: 0,
        capCents: 250,
        routeTag: "implement-primary",
      },
      farm: {
        buildJobId: "5eed0026-0000-4000-8000-000000000483",
        jobNumber: 483,
        jobStatus: "running",
        runnerName: "forge-02",
      },
      wallClock: {
        startedAt: STARTED.toISOString(),
        finishedAt: null,
        elapsedSeconds: 760,
      },
    });
  });

  it("answers unpriced spend with a token count and a null cost — never $0", () => {
    // The honesty rule (M7/N10, carried by R8): a model with no price in the catalog did not
    // cost nothing, and a zero would say that it did.
    const resources = resourcesOf(
      mockupResources({
        spend: { tokensIn: 1_000, tokensOut: 250, costCents: null, unpricedEvents: 3 },
      }),
    );

    expect(resources.tokens.used).toBe(1_250);
    expect(resources.cost.costCents).toBeNull();
    expect(resources.cost.costCents).not.toBe("0");
    expect(resources.cost.unpricedEvents).toBe(3);
  });

  it("passes a partly priced ledger through as a lower bound, with the unpriced rows counted", () => {
    const resources = resourcesOf(
      mockupResources({
        spend: { tokensIn: 1_000, tokensOut: 0, costCents: "40.0000", unpricedEvents: 1 },
      }),
    );

    expect(resources.cost).toMatchObject({ costCents: "40.0000", unpricedEvents: 1 });
  });

  it("is count-only when no model stage has started, and cap-less when no route applies", () => {
    const resources = resourcesOf(mockupResources({ budgetStage: undefined, route: undefined }));

    expect(resources.tokens).toMatchObject({ budget: null, budgetStageKey: null });
    expect(resources.cost).toMatchObject({ capCents: null, routeTag: null });
  });

  it("states a route that exists but sets no cap as exactly that", () => {
    const resources = resourcesOf(
      mockupResources({ route: { tag: "review-primary", maxCostCentsPerRun: null } }),
    );

    expect(resources.cost).toMatchObject({ capCents: null, routeTag: "review-primary" });
  });

  it("omits the farm row entirely when the run holds no reservation", () => {
    // Absent data is absent: no placeholder for the UI to detect.
    const resources = resourcesOf(mockupResources({ reservation: undefined }));

    expect(resources).not.toHaveProperty("farm");
  });

  it("states a reservation no runner has taken yet with a null runner", () => {
    const resources = resourcesOf(
      mockupResources({
        reservation: { id: "job", number: 7, status: "queued", runnerName: null },
      }),
    );

    expect(resources.farm).toEqual({
      buildJobId: "job",
      jobNumber: 7,
      jobStatus: "queued",
      runnerName: null,
    });
  });

  it("freezes the wall clock at finished_at once the run is terminal", () => {
    const resources = resourcesOf(mockupResources({ finishedAt: into(900), asOf: into(5000) }));

    expect(resources.wallClock).toEqual({
      startedAt: STARTED.toISOString(),
      finishedAt: into(900).toISOString(),
      elapsedSeconds: 900,
    });
  });
});

describe("the guardrails card", () => {
  it("draws the mockup's four rows in the card's order and calls it clean", () => {
    const card = guardrailsOf(mockupGuardrails(), "standard-fix", 14, "acme-robotics");

    expect(card.status).toBe("clean");
    expect(card.checks.map((row) => [row.check, row.verdict])).toEqual([
      ["allowed_paths", "pass"],
      ["ci_config", "pass"],
      ["secrets", "pass"],
      ["review_required", "not_applicable"],
    ]);
    expect(card.checks[2].rulesetVersion).toBe("v3");
    expect(card.checks[3].changeSetSeq).toBeNull();
  });

  it("states the footer: Policy: standard-fix v14 · tenant acme-robotics", () => {
    const card = guardrailsOf(mockupGuardrails(), "standard-fix", 14, "acme-robotics");

    expect(card.policy).toEqual({
      workflowTag: "standard-fix",
      workflowVersion: 14,
      tenant: "acme-robotics",
    });
  });

  it("names the policy the newest verdict applied, not the run's pin", () => {
    const rows = [
      guardrailRow({ check: "allowed_paths", policy_ref: 13, evaluated_at: into(100) }),
      guardrailRow({ check: "ci_config", policy_ref: 15, evaluated_at: into(200) }),
    ];

    expect(guardrailsOf(rows, "standard-fix", 14, "acme").policy.workflowVersion).toBe(15);
  });

  it("falls back to the run's pin before anything has been evaluated", () => {
    const card = guardrailsOf([], "standard-fix", 14, "acme");

    expect(card.status).toBe("unevaluated");
    expect(card.checks).toEqual([]);
    expect(card.policy.workflowVersion).toBe(14);
  });

  it("carries a failure's evidence, and omits evidence a verdict does not have", () => {
    const card = guardrailsOf(
      [
        guardrailRow({
          check: "secrets",
          verdict: "fail",
          evidence: { path: "config/prod.env", line: 3, rule_id: "aws-access-key-id" },
        }),
        guardrailRow({ check: "allowed_paths" }),
      ],
      "standard-fix",
      14,
      "acme",
    );

    expect(card.status).toBe("violations");
    expect(card.checks[1].evidence).toEqual({
      path: "config/prod.env",
      line: 3,
      rule_id: "aws-access-key-id",
    });
    expect(card.checks[0]).not.toHaveProperty("evidence");
  });

  it("carries the secrets ruleset's disclosure for the tooltip, as AP.3 states it", () => {
    const card = guardrailsOf(mockupGuardrails(), "standard-fix", 14, "acme");

    expect(card.secrets).toEqual({ ...SECRETS_RULESET_DISCLOSURE });
  });

  it.each([
    [[], "unevaluated"],
    [["pass", "pass", "pass", "not_applicable"], "clean"],
    [["pass", "pending"], "pending"],
    [["pass", "pending", "fail"], "violations"],
    [["not_applicable"], "clean"],
  ] as const)("reads %j as %s", (verdicts, status) => {
    expect(guardrailsStatusOf(verdicts)).toBe(status);
  });
});

describe("a transcript entry", () => {
  it("carries the fields the entry reported and no others — the JSONL rule", () => {
    expect(entryOf(eventRow())).toEqual({
      seq: 1,
      ts: into(131).toISOString(),
      actor: "plan",
      stageKey: "plan",
      attempt: 1,
      body: "Root cause: test asserts on frame order; CAN driver ISR can reorder under load.",
      simulated: true,
    });
  });

  it("carries a tool's tag and payload, and a model's provenance", () => {
    const edit = entryOf(
      eventRow({
        seq: 4,
        actor: "tool",
        stage_key: "implement",
        tool_tag: "edit_file",
        body: "drivers/can/telemetry_buf.c",
        payload: { hunks: [{ kind: "del", text: "static struct k_fifo tel_fifo;" }] },
      }),
    );
    const model = entryOf(
      eventRow({ seq: 3, actor: "model", stage_key: "implement", model_id: "claude-fable-5" }),
    );

    expect(edit).toMatchObject({
      toolTag: "edit_file",
      payload: { hunks: [{ kind: "del", text: "static struct k_fifo tel_fifo;" }] },
    });
    expect(model.modelId).toBe("claude-fable-5");
  });

  it("describes an elision marker's hole, and only a marker has one", () => {
    const marker = entryOf(
      eventRow({
        seq: 20_000,
        actor: "system",
        stage_key: null,
        attempt: null,
        body: "transcript capped",
        elided_events: 12,
        elided_bytes: "40960",
        elided_from: into(900),
        elided_to: into(960),
      }),
    );

    expect(marker).not.toHaveProperty("stageKey");
    expect(marker.elision).toEqual({
      events: 12,
      bytes: 40_960,
      from: into(900).toISOString(),
      to: into(960).toISOString(),
    });
    expect(entryOf(eventRow())).not.toHaveProperty("elision");
  });

  it("keeps a real run's entry unwatermarked", () => {
    expect(entryOf(eventRow({ simulated: false })).simulated).toBe(false);
  });
});
