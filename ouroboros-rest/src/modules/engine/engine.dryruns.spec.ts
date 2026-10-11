import {
  ENGINE_DRY_RUN_HARNESS_ROUTE,
  ENGINE_DRY_RUN_MAX_MANIFEST,
  ENGINE_DRY_RUN_MAX_TICKET_BODY,
  ENGINE_DRY_RUN_TIMEOUT_MS,
  ENGINE_DRY_RUNS_ROUTE,
  dryRunRequestBody,
  engineDryRunEventSchema,
  engineDryRunHarnessSchema,
  type EngineDryRunRequest,
} from "./engine.dryruns";
import { ENGINE_DRY_RUN_WIRE } from "./engine.dryruns.fixture";

const REQUEST: EngineDryRunRequest = {
  dryRun: "5eed008b-0000-4000-8000-000000000001",
  definition: { dsl_version: "1.0" },
  ticket: {
    externalKey: "#489",
    source: "github",
    labels: ["bug", "can-bus"],
    estimate: { effort: "m" },
    title: "CAN arbitration-lost storm",
    body: "b".repeat(ENGINE_DRY_RUN_MAX_TICKET_BODY + 50),
  },
  repository: {
    slug: "acme-robotics/helios-firmware",
    pinnedSha: "b7e4c2a19f0d3e5b6a7c8d9e0f1a2b3c4d5e6f70",
    token: "ghp_read_only",
  },
  stages: {
    implement: {
      alias: "coder-max",
      resolutionVersion: "res-7",
      manifest: "m".repeat(ENGINE_DRY_RUN_MAX_MANIFEST + 50),
      skillResolved: true,
      warnings: [],
    },
    "exploit-verify": {
      alias: null,
      resolutionVersion: null,
      manifest: "",
      skillResolved: true,
      warnings: ['Task kind "exploit-verify" has no route yet — the stage was skipped.'],
    },
  },
  budget: { runCostCents: 500, stageCostCents: null, runTokens: null, stageTokens: null },
};

describe("the dry-run harness contract", () => {
  it("names the two routes and a deadline far longer than an ordinary call's", () => {
    expect(ENGINE_DRY_RUNS_ROUTE).toBe("v0/dry-runs");
    expect(ENGINE_DRY_RUN_HARNESS_ROUTE).toBe("v0/dry-runs/harness");
    expect(ENGINE_DRY_RUN_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("writes the request in the engine's spelling, cutting the ticket body and manifest to its bounds", () => {
    const body = dryRunRequestBody(REQUEST) as {
      ticket: { body: string };
      stages: Record<string, { manifest: string }>;
    };

    expect(body).toMatchObject({
      dry_run: REQUEST.dryRun,
      definition: { dsl_version: "1.0" },
      ticket: {
        external_key: "#489",
        source: "github",
        labels: ["bug", "can-bus"],
        estimate: { effort: "m" },
        title: "CAN arbitration-lost storm",
      },
      repository: {
        slug: "acme-robotics/helios-firmware",
        pinned_sha: REQUEST.repository.pinnedSha,
        token: "ghp_read_only",
      },
      stages: {
        implement: {
          alias: "coder-max",
          resolution_version: "res-7",
          skill_resolved: true,
          warnings: [],
        },
        "exploit-verify": {
          alias: null,
          resolution_version: null,
          manifest: "",
          warnings: [REQUEST.stages["exploit-verify"]?.warnings[0]],
        },
      },
      budget: { run_cost_cents: 500, stage_cost_cents: null, run_tokens: null, stage_tokens: null },
    });
    expect(body.ticket.body).toHaveLength(ENGINE_DRY_RUN_MAX_TICKET_BODY);
    expect(body.stages.implement?.manifest).toHaveLength(ENGINE_DRY_RUN_MAX_MANIFEST);
    // Exactly the engine's closed request: a key it does not know is a 422 there.
    expect(Object.keys(body)).toEqual([
      "dry_run",
      "definition",
      "ticket",
      "repository",
      "stages",
      "budget",
    ]);
  });

  it("parses every event the engine really streams, in its order", () => {
    const events = ENGINE_DRY_RUN_WIRE.events.map((line) => engineDryRunEventSchema.parse(line));

    expect(events).toHaveLength(ENGINE_DRY_RUN_WIRE.events.length);
    expect(events.at(-1)?.kind).toBe("done");
    expect(events.filter((event) => event.kind === "done")).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "stage_started",
      seq: 1,
      stageKey: "analyze",
      displayName: "analyze",
    });
    expect(events[1]).toEqual({
      kind: "stage_finished",
      stage: {
        seq: 1,
        stageKey: "analyze",
        displayName: "analyze",
        nodes: ["analyze"],
        verdict: "ok",
        how: "llm",
        note: "mapped 4 files · skill advisory-db skipped (not defined yet)",
        metrics: { tokens: 3000, cost_cents: 3, files_touched: 4 },
        skipReason: null,
        startedAt: "2026-10-10T12:00:01Z",
        finishedAt: "2026-10-10T12:00:02Z",
      },
    });
  });

  it("reads the whole result off the final event: rows, artifacts, totals and a clean audit", () => {
    const done = engineDryRunEventSchema.parse(ENGINE_DRY_RUN_WIRE.events.at(-1));
    if (done.kind !== "done") throw new Error("the stream must end with done");

    expect(done.result).toMatchObject({
      dryRun: "5eed008b-0000-4000-8000-000000000001",
      harness: "dry-run-v1",
      status: "complete",
      failureReason: null,
      findings: [],
      guardAudit: [],
      guardsClean: true,
      tokens: 10000,
      costCents: 10,
      durationMs: 13000,
    });
    expect(done.result.stages.map((stage) => stage.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(done.result.stages.map((stage) => stage.how)).toEqual(
      expect.arrayContaining(["llm", "replayed", "skipped", "deterministic"]),
    );
    const diff = done.result.artifacts.find((artifact) => artifact.kind === "overlay_diff");
    expect(diff?.pathSummary.length).toBeGreaterThan(0);
    expect(diff?.originalBytes).toBeGreaterThan(0);
  });

  it("parses a guard holding, a populated audit, findings and an unpriced failure", () => {
    expect(
      engineDryRunEventSchema.parse({
        kind: "guard_blocked",
        guard: "allow_list",
        call: "git_push",
        stage_key: "implement",
      }),
    ).toEqual({
      kind: "guard_blocked",
      guard: "allow_list",
      call: "git_push",
      stageKey: "implement",
    });

    const done = engineDryRunEventSchema.parse({
      kind: "done",
      result: {
        dry_run: "r",
        harness: "dry-run-v1",
        status: "failed",
        failure_reason: "the tool boundary refused 1 call",
        findings: [
          { code: "graph.unreachable", message: "m", node_id: "build", edge: null, path: null },
        ],
        guard_audit: [
          { guard: "allow_list", call: "git_push", count: 1, stage_key: "implement" },
          { guard: "workspace_boundary", call: "edit_file", count: 2 },
        ],
        guards_clean: false,
        tokens: 0,
        duration_ms: 12,
      },
    });

    expect(done).toMatchObject({
      kind: "done",
      result: {
        status: "failed",
        failureReason: "the tool boundary refused 1 call",
        findings: [{ code: "graph.unreachable", message: "m", node: "build" }],
        guardAudit: [
          { guard: "allow_list", call: "git_push", count: 1, stageKey: "implement" },
          { guard: "workspace_boundary", call: "edit_file", count: 2, stageKey: null },
        ],
        guardsClean: false,
        costCents: null,
        stages: [],
        artifacts: [],
        workspaceNotes: [],
      },
    });
  });

  it("refuses a line that is not an event of the contract", () => {
    for (const line of [
      { kind: "surprise" },
      { kind: "stage_started", seq: 0, stage_key: "a", display_name: "a" },
      {
        kind: "stage_finished",
        stage: {
          seq: 1,
          stage_key: "a",
          display_name: "a",
          verdict: "great",
          how: "llm",
          note: "",
        },
      },
      {
        kind: "done",
        result: {
          dry_run: "r",
          harness: "h",
          status: "cancelled",
          guards_clean: true,
          tokens: 0,
          duration_ms: 0,
        },
      },
      { kind: "guard_blocked", guard: "", call: "x", stage_key: "a" },
    ]) {
      expect(engineDryRunEventSchema.safeParse(line).success).toBe(false);
    }
  });

  it("parses the harness exactly as the engine describes it", () => {
    const harness = engineDryRunHarnessSchema.parse(ENGINE_DRY_RUN_WIRE.harness);

    expect(harness.harness).toBe("dry-run-v1");
    expect(harness.tools.map((tool) => [tool.name, tool.effect])).toEqual([
      ["read_file", "read"],
      ["list_dir", "read"],
      ["search", "read"],
      ["edit_file", "simulated_write"],
      ["build", "replay"],
      ["run_tests", "replay"],
    ]);
    expect(harness.guards.map((guard) => guard.name)).toEqual(["allow_list", "workspace_boundary"]);
    expect(harness.forbiddenCapabilities).toEqual([
      "network_egress",
      "shell",
      "repository_write",
      "farm_dispatch",
      "pull_request",
      "ticket_source_write",
      "credential_access",
    ]);
    expect(harness).toMatchObject({
      writes: "memory_overlay",
      reads: "provider_api_at_pinned_sha",
      replayEstimatesPath: "/internal/dry-runs/{id}/replay-estimates",
      invokePath: "/internal/llm/invoke",
    });
    expect(engineDryRunHarnessSchema.safeParse({ harness: "x" }).success).toBe(false);
  });
});
