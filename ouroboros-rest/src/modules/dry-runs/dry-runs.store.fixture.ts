/**
 * An in-memory `DryRunsRepository` for the suites (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)) — the rows a dry run is made from
 * and the three tables it writes, with the two rules of V111/V126 the lifecycle leans on: only
 * a `running` run can be ended, and a finished run takes no new rows.
 */

import type { CopilotToolTrace, DryRun, DryRunArtifact, DryRunStage, Workflow } from "../db/schema";
import type {
  EngineDryRunArtifact,
  EngineDryRunEvent,
  EngineDryRunHarness,
  EngineDryRunRequest,
  EngineDryRunResult,
  EngineDryRunStage,
} from "../engine/engine.dryruns";
import { engineUnavailable } from "../engine/engine.errors";
import type {
  DryRunEnding,
  DryRunSpendRow,
  DryRunTicketRow,
  DryRunsRepository,
  NewDryRun,
} from "./dry-runs.repository";

export const WORKSPACE = "acme-robotics-id";
export const WORKFLOW_ID = "5eed0089-0000-4000-8000-000000000001";
export const TICKET_ID = "5eed0088-0000-4000-8000-000000000489";
export const SESSION_ID = "5eed008a-0000-4000-8000-000000000001";
export const PINNED_SHA = "b7e4c2a19f0d3e5b6a7c8d9e0f1a2b3c4d5e6f70";

/** A valid security-patch draft: trigger on `security`, one model stage, a build, a terminal. */
export const DEFINITION = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: { labels: ["security"] } },
  nodes: [
    { id: "trigger", type: "trigger", title: "trigger", position: { x: 0, y: 0 }, config: {} },
    {
      id: "implement",
      type: "llm",
      title: "implement",
      position: { x: 0, y: 120 },
      config: {
        mode: "prompt",
        prompt_template: "Implement the plan.",
        routing: { inherit_task: "implement" },
        limits: { max_retries: 1, token_budget: 200000 },
        permissions: { push_fixup: false, touch_ci: false },
      },
    },
    {
      id: "build",
      type: "infra",
      title: "build",
      position: { x: 0, y: 240 },
      config: { runner_pool: "pool-a" },
    },
    {
      id: "open-pr",
      type: "term",
      title: "open PR",
      position: { x: 0, y: 360 },
      config: { action: "needs_review", options: {} },
    },
  ],
  edges: [
    { from: "trigger", to: "implement", kind: "default" },
    { from: "implement", to: "build", kind: "default" },
    { from: "build", to: "open-pr", kind: "default" },
  ],
};

/**
 * The seeded `security-patch` workflow at `v0.3`.
 *
 * @param overrides - Columns to change.
 * @returns The row.
 */
export function workflowRow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW_ID,
    organization_id: WORKSPACE,
    slug: "security-patch",
    name: "security-patch",
    status: "active",
    current_version: null,
    created_at: new Date("2026-10-06T15:01:00Z"),
    updated_at: new Date("2026-10-06T15:04:00Z"),
    template_slug: null,
    template_version: null,
    draft_rev: 3,
    provenance_summary: { canvas: 1, code: 0, copilot: 2, suggestion: 0 },
    ...overrides,
  };
}

/**
 * `#489` — the CAN arbitration storm, no `security` label.
 *
 * @param overrides - Columns to change.
 * @returns The row.
 */
export function ticketRow(overrides: Partial<DryRunTicketRow> = {}): DryRunTicketRow {
  return {
    id: TICKET_ID,
    external_key: "#489",
    external_url: "https://github.com/acme-robotics/helios-firmware/issues/489",
    title: "CAN arbitration-lost storm under full telemetry load",
    body: "Under full telemetry load the bus loses arbitration repeatedly.",
    state: "open",
    labels: ["bug", "can-bus"],
    source_updated_at: new Date("2026-10-10T23:49:06Z"),
    source_kind: "github",
    effort: "m",
    repo_owner: "acme-robotics",
    repo_name: "helios-firmware",
    repo_default_branch: "main",
    ...overrides,
  };
}

/**
 * A copilot reply's trace proposing a per-run spend guard.
 *
 * @param cents - The cap.
 * @returns The trace.
 */
export function guardTrace(cents: number): CopilotToolTrace {
  return {
    operations: [
      {
        op: {
          kind: "set_guard",
          params: { guard: "spend_guard", params: { per_run_cap_cents: cents } },
        },
        outcome: "proposed",
      },
    ],
    reads: [],
    dry_run_proposals: [],
  };
}

/** What the store holds, open for a suite to arrange and inspect. */
export class DryRunStore {
  workflows: Workflow[] = [workflowRow()];
  definition: unknown = DEFINITION;
  tickets: DryRunTicketRow[] = [ticketRow()];
  capCents = 1000;
  traces: CopilotToolTrace[] = [];
  sessions: string[] = [SESSION_ID];
  runs: DryRun[] = [];
  stageRows: DryRunStage[] = [];
  artifactRows: DryRunArtifact[] = [];
  /** Set to make the next stage insert fail, as a CHECK violation would. */
  failStageInsert = false;
  private sequence = 0;

  /** @returns The store, typed as the repository it stands in for. */
  get repository(): DryRunsRepository {
    return this as unknown as DryRunsRepository;
  }

  workflow(organizationId: string, id: string): Promise<Workflow | undefined> {
    return Promise.resolve(
      this.workflows.find((row) => row.organization_id === organizationId && row.id === id),
    );
  }

  draftDefinition(): Promise<unknown> {
    return Promise.resolve(this.definition);
  }

  ticket(_organizationId: string, ticketId: string): Promise<DryRunTicketRow | undefined> {
    return Promise.resolve(this.tickets.find((row) => row.id === ticketId));
  }

  candidates(_organizationId: string, limit: number): Promise<DryRunTicketRow[]> {
    return Promise.resolve(this.tickets.slice(0, limit));
  }

  workspaceCapCents(): Promise<number> {
    return Promise.resolve(this.capCents);
  }

  guardTraces(): Promise<CopilotToolTrace[]> {
    return Promise.resolve(this.traces);
  }

  sessionIsAbout(_org: string, _workflow: string, sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.includes(sessionId));
  }

  insert(run: NewDryRun): Promise<DryRun> {
    this.sequence += 1;
    const row = {
      id: `5eed008b-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      organization_id: run.organizationId,
      workflow_id: run.workflowId,
      base_version: run.baseVersion,
      draft_rev: run.draftRev,
      session_id: run.sessionId,
      ticket_id: run.ticketId,
      pinned_sha: run.pinnedSha,
      mode: "deep",
      status: "precheck",
      duration_ms: null,
      cost_cents: null,
      tokens: null,
      guard_audit: [],
      guards_clean: true,
      precheck_findings: null,
      failure_reason: null,
      started_at: new Date(Date.now() + this.sequence),
      finished_at: null,
    } as DryRun;
    this.runs.push(row);

    return Promise.resolve(row);
  }

  markRunning(id: string): Promise<DryRun> {
    return Promise.resolve(this.patch(id, { status: "running", precheck_findings: [] }));
  }

  failPrecheck(id: string, findings: readonly object[], reason: string): Promise<DryRun> {
    return Promise.resolve(
      this.patch(id, {
        status: "failed",
        precheck_findings: findings as Record<string, unknown>[],
        failure_reason: reason,
        finished_at: new Date(),
        duration_ms: "1",
      }),
    );
  }

  insertStage(
    run: Pick<DryRun, "id" | "organization_id">,
    stage: EngineDryRunStage,
  ): Promise<void> {
    if (this.failStageInsert) {
      return Promise.reject(new Error("dry_run_stages_metrics_shape"));
    }
    if (this.isFinished(run.id)) {
      return Promise.reject(new Error("dry_run_stages_open"));
    }
    if (!this.stageRows.some((row) => row.dry_run_id === run.id && row.seq === stage.seq)) {
      this.stageRows.push({
        id: `stage-${run.id}-${String(stage.seq)}`,
        organization_id: run.organization_id,
        dry_run_id: run.id,
        seq: stage.seq,
        stage_key: stage.stageKey,
        display_name: stage.displayName,
        verdict: stage.verdict,
        how: stage.how,
        note: stage.note,
        metrics: { ...stage.metrics },
        skip_reason: stage.skipReason,
        started_at: stage.startedAt === null ? null : new Date(stage.startedAt),
        finished_at: stage.finishedAt === null ? null : new Date(stage.finishedAt),
      });
    }

    return Promise.resolve();
  }

  insertArtifacts(
    run: Pick<DryRun, "id" | "organization_id">,
    artifacts: readonly EngineDryRunArtifact[],
  ): Promise<void> {
    for (const artifact of artifacts) {
      this.artifactRows.push({
        id: `artifact-${run.id}-${artifact.kind}`,
        organization_id: run.organization_id,
        dry_run_id: run.id,
        kind: artifact.kind,
        content: artifact.content,
        truncated: artifact.truncated,
        original_bytes: String(artifact.originalBytes),
        path_summary: artifact.kind === "overlay_diff" ? [...artifact.pathSummary] : null,
        created_at: new Date(),
      });
    }

    return Promise.resolve();
  }

  finish(id: string, ending: DryRunEnding): Promise<DryRun | undefined> {
    const run = this.runs.find((row) => row.id === id);
    if (run === undefined) return Promise.resolve(undefined);
    if (run.status !== "running") return Promise.resolve(run);

    return Promise.resolve(
      this.patch(id, {
        status: ending.status,
        failure_reason: ending.failureReason,
        cost_cents: ending.costCents,
        tokens: ending.tokens === null ? null : String(ending.tokens),
        guard_audit: [...ending.guardAudit],
        guards_clean: ending.guardAudit.length === 0,
        finished_at: new Date(),
        duration_ms: String(ending.durationMs ?? 1),
      }),
    );
  }

  find(organizationId: string, workflowId: string, id: string): Promise<DryRun | undefined> {
    return Promise.resolve(
      this.runs.find(
        (row) =>
          row.organization_id === organizationId && row.workflow_id === workflowId && row.id === id,
      ),
    );
  }

  open(workflowId: string): Promise<DryRun | undefined> {
    return Promise.resolve(
      this.runs.find((row) => row.workflow_id === workflowId && !this.isFinished(row.id)),
    );
  }

  stages(dryRunId: string): Promise<DryRunStage[]> {
    return Promise.resolve(
      this.stageRows.filter((row) => row.dry_run_id === dryRunId).sort((a, b) => a.seq - b.seq),
    );
  }

  artifacts(dryRunId: string): Promise<DryRunArtifact[]> {
    return Promise.resolve(this.artifactRows.filter((row) => row.dry_run_id === dryRunId));
  }

  history(
    organizationId: string,
    workflowId: string,
    limit: number,
  ): Promise<(DryRun & { ticket_key: string; ticket_title: string })[]> {
    return Promise.resolve(
      this.runs
        .filter((row) => row.organization_id === organizationId && row.workflow_id === workflowId)
        .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
        .slice(0, limit)
        .map((row) => {
          const ticket = this.tickets.find((candidate) => candidate.id === row.ticket_id);
          return {
            ...row,
            ticket_key: ticket?.external_key ?? "?",
            ticket_title: ticket?.title ?? "?",
          };
        }),
    );
  }

  spend(organizationId: string, workflowId: string): Promise<DryRunSpendRow> {
    const runs = this.runs.filter(
      (row) => row.organization_id === organizationId && row.workflow_id === workflowId,
    );
    const priced = runs.filter((row) => row.cost_cents !== null);

    return Promise.resolve({
      runs: runs.length,
      cost_cents:
        priced.length === 0 ? null : priced.reduce((sum, row) => sum + (row.cost_cents ?? 0), 0),
      unpriced: runs.filter((row) => row.finished_at !== null && row.cost_cents === null).length,
    });
  }

  private isFinished(id: string): boolean {
    const status = this.runs.find((row) => row.id === id)?.status;
    return status !== "precheck" && status !== "running";
  }

  private patch(id: string, changes: Partial<DryRun>): DryRun {
    const index = this.runs.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`no dry run ${id}`);
    const next = { ...this.runs[index], ...changes };
    this.runs[index] = next;

    return next;
  }
}

/**
 * One harness stage row.
 *
 * @param seq - Its position.
 * @param key - Its key and name.
 * @param overrides - Fields to change.
 * @returns The row.
 */
export function harnessStage(
  seq: number,
  key: string,
  overrides: Partial<EngineDryRunStage> = {},
): EngineDryRunStage {
  return {
    seq,
    stageKey: key,
    displayName: key,
    nodes: [key],
    verdict: "ok",
    how: "llm",
    note: `${key} done`,
    metrics: { tokens: 1000 },
    skipReason: null,
    startedAt: "2026-10-06T15:05:00.000Z",
    finishedAt: "2026-10-06T15:05:30.000Z",
    ...overrides,
  };
}

/** The harness as `ouroboros-engine` describes it today. */
export const HARNESS: EngineDryRunHarness = {
  harness: "dry-run-v1",
  tools: [
    { name: "read_file", effect: "read", does: "Read a file." },
    { name: "list_dir", effect: "read", does: "List a directory." },
    { name: "search", effect: "read", does: "Find text." },
    { name: "edit_file", effect: "simulated_write", does: "Draft a change." },
    { name: "build", effect: "replay", does: "Estimate the build." },
    { name: "run_tests", effect: "replay", does: "Estimate the test run." },
  ],
  guards: [
    { name: "allow_list", refuses: "Refuses any tool that is not on the allow-list." },
    { name: "workspace_boundary", refuses: "Refuses a path outside the repository." },
  ],
  forbiddenCapabilities: [
    "network_egress",
    "shell",
    "repository_write",
    "farm_dispatch",
    "pull_request",
    "ticket_source_write",
    "credential_access",
  ],
  writes: "memory_overlay",
  reads: "provider_api_at_pinned_sha",
  replayEstimatesPath: "/internal/dry-runs/{id}/replay-estimates",
  invokePath: "/internal/llm/invoke",
};

/**
 * A harness result.
 *
 * @param dryRun - The dry run it is about.
 * @param overrides - Fields to change.
 * @returns The result.
 */
export function harnessResult(
  dryRun: string,
  overrides: Partial<EngineDryRunResult> = {},
): EngineDryRunResult {
  return {
    dryRun,
    harness: "dry-run-v1",
    status: "complete",
    failureReason: null,
    findings: [],
    stages: [],
    artifacts: [],
    guardAudit: [],
    guardsClean: true,
    tokens: 0,
    costCents: null,
    durationMs: 161000,
    workspaceNotes: [],
    ...overrides,
  };
}

/** One step of a scripted harness stream: an event, or a pause the suite releases. */
export type ScriptStep = EngineDryRunEvent | { readonly kind: "pause"; readonly name: string };

/**
 * A stand-in for the engine: a pre-check verdict, a harness description, and a dry-run stream
 * played from a script — pausing where the script says, and breaking off the way the real
 * client does when its signal is aborted.
 */
export class FakeEngine {
  /** Every dry run dispatched, as it was sent — the gateway spy. */
  readonly dispatched: EngineDryRunRequest[] = [];
  /** How many times the pre-check was asked. */
  validations = 0;
  findings: { code: string; message: string; node?: string }[] = [];
  /** Set to make the pre-check fail as an unreachable engine does. */
  validateFails = false;
  harness: EngineDryRunHarness = HARNESS;
  private readonly pauses = new Map<string, () => void>();
  private readonly reached = new Map<string, () => void>();

  /**
   * @param script - What the stream plays; built per dry run from its request.
   */
  constructor(public script: (request: EngineDryRunRequest) => ScriptStep[] = () => []) {}

  validateWorkflow(): Promise<{ findings: { code: string; message: string; node?: string }[] }> {
    this.validations += 1;

    return this.validateFails
      ? Promise.reject(engineUnavailable())
      : Promise.resolve({ findings: this.findings });
  }

  dryRunHarness(): Promise<EngineDryRunHarness> {
    return Promise.resolve(this.harness);
  }

  async *dryRun(
    request: EngineDryRunRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<EngineDryRunEvent> {
    this.dispatched.push(request);

    for (const step of this.script(request)) {
      if (step.kind === "pause") {
        await new Promise<void>((resolve, reject) => {
          this.pauses.set(step.name, resolve);
          signal?.addEventListener("abort", () => reject(engineUnavailable()), { once: true });
          this.reached.get(step.name)?.();
        });
        continue;
      }
      if (signal?.aborted === true) throw engineUnavailable();
      yield step;
    }
  }

  /**
   * Wait until the stream is held at a pause.
   *
   * @param name - The pause.
   * @returns When it has been reached.
   */
  atPause(name: string): Promise<void> {
    return this.pauses.has(name)
      ? Promise.resolve()
      : new Promise((resolve) => this.reached.set(name, resolve));
  }

  /**
   * Let the stream go on past a pause.
   *
   * @param name - The pause.
   */
  release(name: string): void {
    this.pauses.get(name)?.();
  }
}
