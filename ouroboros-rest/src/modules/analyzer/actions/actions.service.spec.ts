import type { AuditRecord } from "../../audit/audit.events";
import type { AuditService } from "../../audit/audit.service";
import type { Workflow } from "../../db/schema";
import type { EngineSeriesPoint } from "../../engine/engine.analysis";
import { NotFoundError } from "../../errors/error.envelope";
import type { JobHooksService } from "../../farm/config/job-hooks.service";
import type { PoolWindowsService } from "../../farm/config/pool-windows.service";
import type { BatchesService } from "../../planning/batches.service";
import type { BatchResource } from "../../planning/planning.resources";
import type { PushReport, PushService } from "../../planning/push.service";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import type { WorkflowsService } from "../../workflows/workflows.service";
import type { CorpusRepository } from "../corpus/corpus.repository";
import type { Impact } from "../composer/composer.types";
import type { ActionsRepository, AppliedRecord, SuggestionRow } from "./actions.repository";
import { ANALYZER_PLANNER, NO_REASON, SuggestionActionsService } from "./actions.service";

/**
 * The actions' orchestration (BV.5, #514) over stand-ins for every plane: each apply composes the
 * owning plane's service and nothing else, every refusal comes before any plane is asked, every
 * action is audited, and a successful apply records the measurement row in the same write as the
 * resolution.
 */

const ORG = "org_5eed0001";
const ADMIN = "user_maya";
const MEMBER = "user_jorge";

/** A quantified impact, calibrated. */
function impact(impactClass: string, estimate = -240): Impact {
  return {
    estimate,
    unit: "seconds",
    applies_to: "queue p95",
    basis: {
      method: "extrapolated",
      description: "pool-a's window waits with forge-02 taking the backlog",
      formula: "runner_move v1: -wait_reduction_seconds",
      inputs: { wait_reduction_seconds: 240 },
      window: { from: "2026-06-01", to: "2026-08-29", days: 90 },
      calibration: { analyzer: "queue_correlation", impact_class: impactClass, factor: 1 },
      raw: -240,
    },
  };
}

/** The seeded suggestions, by name. */
const SUGGESTIONS: Record<string, SuggestionRow> = {
  pool: {
    id: "s-pool",
    repo_ref: "acme-robotics/helios-firmware",
    kind: "build_process",
    title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
    evidence_line: "pool-a queue exceeds 9 min in that window on 9 of last 10 weekdays",
    confidence: 78,
    impact: impact("queue_wait"),
    needs_spike: false,
    action_binding: {
      plane: "farm_config",
      change: {
        runner: "forge-02",
        pool: "pool-a",
        days_of_week: [1, 2, 3, 4, 5],
        starts_at: "14:00",
        ends_at: "16:00",
      },
    },
    status: "open",
    last_run_id: "run-2",
    evidence_refs: [],
  },
  gate: {
    id: "s-gate",
    repo_ref: "acme-robotics/helios-firmware",
    kind: "build_process",
    title: "Split the test gate",
    evidence_line: "qemu caught 0 unique failures",
    confidence: 92,
    impact: impact("duration_delta", -220),
    needs_spike: false,
    action_binding: {
      plane: "test_gate",
      change: { pr_builds: ["native_sim"], merge_gate: ["HIL"] },
    },
    status: "open",
    last_run_id: "run-2",
    evidence_refs: [],
  },
  review: {
    id: "s-review",
    repo_ref: "acme-robotics/helios-firmware",
    kind: "workflow",
    title: "standard-fix: run self-review BEFORE the build stage",
    evidence_line: "42% of failed builds in standard-fix loops contained defects review flagged",
    confidence: 81,
    impact: impact("attempt_duration", -125),
    needs_spike: false,
    action_binding: {
      plane: "workflow",
      change: { workflow: "standard-fix", move: "self-review", before: "build" },
    },
    status: "open",
    last_run_id: "run-2",
    evidence_refs: [],
  },
  ticket: {
    id: "s-ticket",
    repo_ref: "acme-robotics/helios-firmware",
    kind: "ticket_draft",
    title: "Refactor tests/ota fixtures",
    evidence_line: "61.8% of OTA suite failures share one fixture timeout signature",
    confidence: 84,
    impact: null,
    needs_spike: false,
    action_binding: { plane: "planning", change: { ticket: "fixture_timeout_ticket" } },
    status: "open",
    last_run_id: "run-2",
    evidence_refs: [{ kind: "build", id: "b-1" }],
  },
};

/** How a case shapes the world. */
interface Shape {
  status?: SuggestionRow["status"];
  /** The target metric's rollup rows. */
  series?: EngineSeriesPoint[];
  batchPlanner?: string;
}

/**
 * The service over stand-ins.
 *
 * @param shape - What exists.
 * @returns The service and what each stand-in recorded, in one ordered log.
 */
function build(shape: Shape = {}) {
  const log: string[] = [];
  const audited: AuditRecord[] = [];
  const applied: AppliedRecord[] = [];

  const repository = {
    suggestion: jest.fn((_org: string, id: string) => {
      const row = Object.values(SUGGESTIONS).find((candidate) => candidate.id === id);
      return Promise.resolve(
        row === undefined ? undefined : { ...row, status: shape.status ?? row.status },
      );
    }),
    windowDays: jest.fn(() => Promise.resolve(14)),
    dismiss: jest.fn(() => {
      log.push("dismiss");
      return Promise.resolve(true);
    }),
    markDrafted: jest.fn((_org: string, ids: readonly string[]) => {
      log.push("markDrafted");
      return Promise.resolve([...ids]);
    }),
    recordApply: jest.fn((record: AppliedRecord) => {
      log.push("recordApply");
      applied.push(record);
      return Promise.resolve({
        id: "m-1",
        target_metric: record.measurement.targetMetric,
        window_days: 14,
        baseline: record.measurement.baseline,
        predicted: record.measurement.predicted,
      });
    }),
  } as unknown as ActionsRepository;

  const corpus = {
    series: jest.fn(() => {
      log.push("series");
      return Promise.resolve(
        shape.series ?? [
          { day: "2026-09-20", dimension: "pool-a", value: 0, samples: [300_000, 600_000] },
          { day: "2026-09-20", dimension: "pool-b", value: 0, samples: [1_000] },
        ],
      );
    }),
  } as unknown as CorpusRepository;

  const windows = {
    add: jest.fn(() => {
      log.push("windows.add");
      return Promise.resolve({
        window: { id: "w-1", runner: { name: "forge-02" }, pool: { name: "pool-a" } },
        created: true,
      });
    }),
  } as unknown as PoolWindowsService;

  const hooks = { register: jest.fn() } as unknown as JobHooksService;

  const workflows = {
    draftBase: jest.fn(() =>
      Promise.resolve({
        workflow: { id: "wf-1", slug: "standard-fix", current_version: 15 } as Workflow,
        definition: readFixture("valid/standard-fix.json"),
        from: "version",
        version: 15,
        etag: "none",
      }),
    ),
    proposeDraft: jest.fn(() => {
      log.push("proposeDraft");
      return Promise.resolve({ etag: "etag-2", definition: {}, updatedAt: null, changeNote: "x" });
    }),
    publish: jest.fn(),
  } as unknown as WorkflowsService;

  const batch = { id: "batch-1", planner: shape.batchPlanner ?? ANALYZER_PLANNER } as BatchResource;
  const batches = {
    compose: jest.fn(() => {
      log.push("compose");
      return Promise.resolve(batch);
    }),
    read: jest.fn((_org: string, id: string) =>
      id === "batch-1" ? Promise.resolve(batch) : Promise.reject(new NotFoundError("x", "x")),
    ),
  } as unknown as BatchesService;

  const report = { batchId: "batch-1", outcome: "pushed", batchStatus: "pushed", pushedThisRun: 4 };
  const pusher = {
    push: jest.fn(() => {
      log.push("push");
      return Promise.resolve(report as unknown as PushReport);
    }),
  } as unknown as PushService;

  const audit = {
    record: jest.fn((event: AuditRecord) => {
      log.push(`audit:${event.action}`);
      audited.push(event);
      return Promise.resolve("event-1");
    }),
  } as unknown as AuditService;

  return {
    service: new SuggestionActionsService(
      repository,
      corpus,
      windows,
      hooks,
      workflows,
      batches,
      pusher,
      audit,
    ),
    log,
    audited,
    applied,
    repository,
    windows,
    workflows,
    batches,
    pusher,
  };
}

describe("the preview", () => {
  it("names the concrete change and writes nothing", async () => {
    const world = build();

    const preview = await world.service.preview(ORG, "s-pool");

    expect(preview).toMatchObject({
      appliable: true,
      draftable: false,
      summary: expect.stringContaining("forge-02 joins pool-a between 14:00–16:00 UTC") as string,
      lands: "Build farm · pool windows",
    });
    expect(world.log).toEqual([]);
  });

  it("opens a workflow plan at the studio, without proposing anything", async () => {
    const world = build();

    const preview = await world.service.preview(ORG, "s-review");

    expect(preview.studioPath).toBe("/workflows/standard-fix");
    expect(world.log).toEqual([]);
  });
});

describe("applying", () => {
  it("composes the farm, audits the apply, then records the resolution with the measurement", async () => {
    const world = build();
    const { fingerprint } = await world.service.preview(ORG, "s-pool");

    const result = await world.service.apply(ORG, ADMIN, "s-pool", fingerprint);

    expect(world.log).toEqual([
      "series",
      "windows.add",
      "audit:analysis_suggestion.applied",
      "recordApply",
    ]);
    expect(world.audited[0]).toMatchObject({
      actorId: ADMIN,
      subjectType: "analysis_suggestion",
      subjectId: "s-pool",
      detail: { plane: "farm_config", target_kind: "runner_pool_window", target_id: "w-1" },
    });
    expect(world.applied[0]).toMatchObject({
      eventId: "event-1",
      reversal: { action: "farm.pool_window.delete", target: { id: "w-1" } },
      measurement: {
        targetMetric: "queue_wait",
        // pool-a's samples only, p95, in seconds.
        baseline: { value: 585, statistic: "p95", dimension: "pool-a" },
        predicted: { delta: -240, calibration: { impact_class: "queue_wait", factor: 1 } },
      },
    });
    expect(result.measurement).toMatchObject({ id: "m-1", targetMetric: "queue_wait" });
  });

  it("drafts a workflow change citing the finding, and never publishes", async () => {
    const world = build({
      series: [{ day: "2026-09-20", dimension: "build", value: 0, samples: [900_000] }],
    });

    const result = await world.service.apply(ORG, ADMIN, "s-review");

    expect(world.workflows.proposeDraft).toHaveBeenCalledWith(
      ORG,
      "wf-1",
      "none",
      expect.objectContaining({ dsl_version: "1.0" }),
      expect.stringContaining("Proposed by the Build Analyzer (suggestion s-review)"),
    );
    expect(world.workflows.publish).not.toHaveBeenCalled();
    expect(result.target).toMatchObject({
      kind: "workflow_draft",
      studioPath: "/workflows/standard-fix",
      nextVersion: 16,
    });
  });

  it.each([
    [
      "a resolved suggestion",
      "s-pool",
      { status: "dismissed" as const },
      "analysis_suggestion_resolved",
    ],
    ["a test-gate split no plane owns", "s-gate", {}, "analysis_plane_unavailable"],
    ["a ticket, which is drafted", "s-ticket", {}, "analysis_plane_unavailable"],
    ["a metric with no baseline yet", "s-pool", { series: [] }, "analysis_baseline_unavailable"],
  ])("refuses %s before any plane is asked", async (_name, id, shape, code) => {
    const world = build(shape);

    await expect(world.service.apply(ORG, ADMIN, id)).rejects.toMatchObject({ code });
    expect(world.log.filter((entry) => entry !== "series")).toEqual([]);
  });

  it("refuses a plan that moved since the preview the caller confirmed", async () => {
    const world = build();

    await expect(
      world.service.apply(ORG, ADMIN, "s-pool", `sha256:${"0".repeat(64)}`),
    ).rejects.toMatchObject({ code: "analysis_preview_stale" });
    expect(world.log).toEqual([]);
  });
});

describe("dismissing", () => {
  it("records the reason against the suggestion and audits it", async () => {
    const world = build();

    const resolution = await world.service.dismiss(
      ORG,
      MEMBER,
      "s-gate",
      "QEMU caught a bug last week",
    );

    expect(resolution).toMatchObject({
      status: "dismissed",
      reason: "QEMU caught a bug last week",
    });
    expect(world.audited[0]).toMatchObject({
      action: "analysis_suggestion.dismissed",
      actorId: MEMBER,
      detail: { reason: "QEMU caught a bug last week" },
    });
  });

  it("records a dismissal without a reason as such", async () => {
    const resolution = await build().service.dismiss(ORG, MEMBER, "s-gate");

    expect(resolution.reason).toBe(NO_REASON);
  });

  it("refuses a suggestion already resolved", async () => {
    await expect(
      build({ status: "applied" }).service.dismiss(ORG, MEMBER, "s-gate"),
    ).rejects.toMatchObject({ code: "analysis_suggestion_resolved" });
  });
});

describe("drafting", () => {
  it("composes an analyzer-v1 batch, marks the suggestions drafted and audits each", async () => {
    const world = build();

    const drafted = await world.service.draft(ORG, ADMIN, ["s-ticket"], "source-1");

    expect(world.batches.compose).toHaveBeenCalledWith(ORG, ADMIN, {
      prompt: expect.stringContaining("acme-robotics/helios-firmware") as string,
      planner: "analyzer-v1",
      targetSourceId: "source-1",
      drafts: [expect.objectContaining({ localKey: "BA-1", title: "Refactor tests/ota fixtures" })],
    });
    expect(drafted.batch.id).toBe("batch-1");
    expect(drafted.suggestionIds).toEqual(["s-ticket"]);
    expect(world.audited[0]).toMatchObject({
      action: "analysis_suggestion.drafted",
      detail: { batch_id: "batch-1" },
    });
  });

  it("refuses to draft what is applied instead, before composing anything", async () => {
    const world = build();

    await expect(world.service.draft(ORG, ADMIN, ["s-pool"], "source-1")).rejects.toMatchObject({
      code: "analysis_suggestion_not_draftable",
    });
    expect(world.log).toEqual([]);
  });
});

describe("pushing", () => {
  it("pushes an analyzer batch through the push service and audits the outcome", async () => {
    const world = build();

    const report = await world.service.push(ORG, ADMIN, "batch-1");

    expect(report.pushedThisRun).toBe(4);
    expect(world.audited[0]).toMatchObject({
      action: "analyzer.batch_pushed",
      subjectType: "draft_batch",
      detail: { outcome: "pushed", pushed_this_run: 4 },
    });
  });

  it("answers 404 for a batch the analyzer did not draft, or none at all", async () => {
    await expect(
      build({ batchPlanner: "outline-v0" }).service.push(ORG, ADMIN, "batch-1"),
    ).rejects.toMatchObject({ code: "analysis_batch_not_found" });
    await expect(build().service.push(ORG, ADMIN, "batch-9")).rejects.toMatchObject({
      code: "analysis_batch_not_found",
    });
  });
});
