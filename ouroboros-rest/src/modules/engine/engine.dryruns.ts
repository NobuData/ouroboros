/**
 * The deep dry-run harness on the wire — `POST /v0/dry-runs` and `GET /v0/dry-runs/harness`
 * (CD.4, [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * Mirrored from `ouroboros-engine/src/ouroboros_engine/dryrun/contract.py`. The engine walks one
 * draft for one ticket and **writes nothing**: it answers NDJSON — a stage starting, a stage
 * finishing, a guard holding — and always exactly one `done` carrying the whole result, whose
 * stage rows and artifacts are already in the shape V111 stores. Persisting them is this
 * service's (`dry-runs/`).
 *
 * The request is built here in the engine's snake_case from this service's names; the events
 * are parsed with zod, so a line outside the contract is `engine_unavailable` rather than a row
 * of something nobody agreed to.
 */

import { z } from "zod";

import {
  ENGINE_API_VERSION,
  engineFindingSchema,
  type EngineDryRunTicket,
  type EngineFinding,
} from "./engine.contract";

/** Where the harness runs a dry run. */
export const ENGINE_DRY_RUNS_ROUTE = `${ENGINE_API_VERSION}/dry-runs`;

/** Where the harness describes itself. */
export const ENGINE_DRY_RUN_HARNESS_ROUTE = `${ENGINE_API_VERSION}/dry-runs/harness`;

/**
 * How long one dry run's stream may run, in milliseconds — thirty minutes.
 *
 * A dry run streams while its stages run real models; the deadline is for a harness that stopped
 * answering, not for one that is working. The spend cap, not the clock, is what bounds a run.
 */
export const ENGINE_DRY_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** The most characters of a ticket's body the harness reads — the engine's `MAX_TICKET_BODY`. */
export const ENGINE_DRY_RUN_MAX_TICKET_BODY = 20_000;

/** The most characters of assembled knowledge one stage may be sent — the engine's `MAX_MANIFEST`. */
export const ENGINE_DRY_RUN_MAX_MANIFEST = 200_000;

/** What routing and context assembly resolved for one model stage. */
export interface EngineDryRunStagePlan {
  /** The alias the stage routes to, or `null` when nothing resolves — the stage is skipped. */
  readonly alias: string | null;
  /** The resolution the alias came from, or `null` for a pinned alias. */
  readonly resolutionVersion: string | null;
  /** The knowledge assembled for the stage, as text. */
  readonly manifest: string;
  /** Whether the skill the stage names exists. */
  readonly skillResolved: boolean;
  /** Decision W7's unresolved-reference warnings, as sentences. */
  readonly warnings: readonly string[];
}

/** The caps a dry run stops at; `null` is *no cap of this kind*. */
export interface EngineDryRunBudget {
  readonly runCostCents: number | null;
  readonly stageCostCents: number | null;
  readonly runTokens: number | null;
  readonly stageTokens: number | null;
}

/** One dry run, as this service asks for it. */
export interface EngineDryRunRequest {
  /** `dry_runs.id` — what every model call and replay estimate is attributed to. */
  readonly dryRun: string;
  /** The draft's document, exactly as stored. */
  readonly definition: unknown;
  /** The ticket, with the title and body a stage reads. */
  readonly ticket: EngineDryRunTicket & { readonly title: string; readonly body: string };
  /** Where the virtual workspace reads from. `token` is a read credential for this request. */
  readonly repository: {
    readonly slug: string;
    readonly pinnedSha: string;
    readonly token: string | null;
  };
  /** What was resolved for each model stage, by node id. */
  readonly stages: Readonly<Record<string, EngineDryRunStagePlan>>;
  readonly budget: EngineDryRunBudget;
}

/**
 * The request body, in the engine's names.
 *
 * @param request - The dry run.
 * @returns The JSON `POST /v0/dry-runs` reads.
 */
export function dryRunRequestBody(request: EngineDryRunRequest): Record<string, unknown> {
  return {
    dry_run: request.dryRun,
    definition: request.definition,
    ticket: {
      external_key: request.ticket.externalKey,
      source: request.ticket.source,
      labels: request.ticket.labels,
      estimate: request.ticket.estimate,
      title: request.ticket.title,
      body: request.ticket.body.slice(0, ENGINE_DRY_RUN_MAX_TICKET_BODY),
    },
    repository: {
      slug: request.repository.slug,
      pinned_sha: request.repository.pinnedSha,
      token: request.repository.token,
    },
    stages: Object.fromEntries(
      Object.entries(request.stages).map(([node, plan]) => [
        node,
        {
          alias: plan.alias,
          resolution_version: plan.resolutionVersion,
          manifest: plan.manifest.slice(0, ENGINE_DRY_RUN_MAX_MANIFEST),
          skill_resolved: plan.skillResolved,
          warnings: plan.warnings,
        },
      ]),
    ),
    budget: {
      run_cost_cents: request.budget.runCostCents,
      stage_cost_cents: request.budget.stageCostCents,
      run_tokens: request.budget.runTokens,
      stage_tokens: request.budget.stageTokens,
    },
  };
}

/** One row of the dry-run card — a `dry_run_stages` row, less its ids. */
export interface EngineDryRunStage {
  readonly seq: number;
  readonly stageKey: string;
  readonly displayName: string;
  /** The DSL node ids the row stands for. */
  readonly nodes: readonly string[];
  readonly verdict: "ok" | "skipped" | "failed" | "not_reached";
  readonly how: "llm" | "replayed" | "deterministic" | "skipped";
  readonly note: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly skipReason: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** An artifact of the run — a `dry_run_artifacts` row, less its ids. */
export interface EngineDryRunArtifact {
  readonly kind: "overlay_diff" | "plan_excerpt" | "review_excerpt";
  readonly content: string;
  readonly truncated: boolean;
  readonly originalBytes: number;
  readonly pathSummary: readonly {
    readonly path: string;
    readonly added: number;
    readonly removed: number;
  }[];
}

/** One line of the guard audit. */
export interface EngineDryRunGuardEntry {
  readonly guard: string;
  readonly call: string;
  readonly count: number;
  readonly stageKey: string | null;
}

/** The whole dry run, as the harness ended it. */
export interface EngineDryRunResult {
  readonly dryRun: string;
  readonly harness: string;
  readonly status: "complete" | "failed" | "budget_stopped";
  readonly failureReason: string | null;
  readonly findings: readonly EngineFinding[];
  readonly stages: readonly EngineDryRunStage[];
  readonly artifacts: readonly EngineDryRunArtifact[];
  readonly guardAudit: readonly EngineDryRunGuardEntry[];
  readonly guardsClean: boolean;
  readonly tokens: number;
  /** `null` when no call was priced — never a zero that was not measured. */
  readonly costCents: number | null;
  readonly durationMs: number;
  readonly workspaceNotes: readonly string[];
}

/** One line of the stream, in this service's names. */
export type EngineDryRunEvent =
  | {
      readonly kind: "stage_started";
      readonly seq: number;
      readonly stageKey: string;
      readonly displayName: string;
    }
  | { readonly kind: "stage_finished"; readonly stage: EngineDryRunStage }
  | {
      readonly kind: "guard_blocked";
      readonly guard: string;
      readonly call: string;
      readonly stageKey: string;
    }
  | { readonly kind: "done"; readonly result: EngineDryRunResult };

const stageSchema = z
  .object({
    seq: z.number().int().min(1),
    stage_key: z.string().min(1),
    display_name: z.string().min(1),
    nodes: z.array(z.string()).default([]),
    verdict: z.enum(["ok", "skipped", "failed", "not_reached"]),
    how: z.enum(["llm", "replayed", "deterministic", "skipped"]),
    note: z.string(),
    metrics: z.record(z.string(), z.unknown()).default({}),
    skip_reason: z.string().nullable().default(null),
    started_at: z.string().nullable().default(null),
    finished_at: z.string().nullable().default(null),
  })
  .transform((stage): EngineDryRunStage => ({
    seq: stage.seq,
    stageKey: stage.stage_key,
    displayName: stage.display_name,
    nodes: stage.nodes,
    verdict: stage.verdict,
    how: stage.how,
    note: stage.note,
    metrics: stage.metrics,
    skipReason: stage.skip_reason,
    startedAt: stage.started_at,
    finishedAt: stage.finished_at,
  }));

const artifactSchema = z
  .object({
    kind: z.enum(["overlay_diff", "plan_excerpt", "review_excerpt"]),
    content: z.string(),
    truncated: z.boolean(),
    original_bytes: z.number().int().nonnegative(),
    path_summary: z
      .array(
        z.object({
          path: z.string(),
          added: z.number().int().nonnegative(),
          removed: z.number().int().nonnegative(),
        }),
      )
      .default([]),
  })
  .transform((artifact): EngineDryRunArtifact => ({
    kind: artifact.kind,
    content: artifact.content,
    truncated: artifact.truncated,
    originalBytes: artifact.original_bytes,
    pathSummary: artifact.path_summary,
  }));

const guardEntrySchema = z
  .object({
    guard: z.string().min(1),
    call: z.string().min(1),
    count: z.number().int().min(1),
    stage_key: z.string().nullable().default(null),
  })
  .transform((entry): EngineDryRunGuardEntry => ({
    guard: entry.guard,
    call: entry.call,
    count: entry.count,
    stageKey: entry.stage_key,
  }));

const resultSchema = z
  .object({
    dry_run: z.string(),
    harness: z.string(),
    status: z.enum(["complete", "failed", "budget_stopped"]),
    failure_reason: z.string().nullable().default(null),
    findings: z.array(engineFindingSchema).default([]),
    stages: z.array(stageSchema).default([]),
    artifacts: z.array(artifactSchema).default([]),
    guard_audit: z.array(guardEntrySchema).default([]),
    guards_clean: z.boolean(),
    tokens: z.number().int().nonnegative(),
    cost_cents: z.number().int().nonnegative().nullable().default(null),
    duration_ms: z.number().int().nonnegative(),
    workspace_notes: z.array(z.string()).default([]),
  })
  .transform((result): EngineDryRunResult => ({
    dryRun: result.dry_run,
    harness: result.harness,
    status: result.status,
    failureReason: result.failure_reason,
    findings: result.findings,
    stages: result.stages,
    artifacts: result.artifacts,
    guardAudit: result.guard_audit,
    guardsClean: result.guards_clean,
    tokens: result.tokens,
    costCents: result.cost_cents,
    durationMs: result.duration_ms,
    workspaceNotes: result.workspace_notes,
  }));

/** One line of the stream, parsed and translated. */
export const engineDryRunEventSchema: z.ZodType<EngineDryRunEvent> = z.union([
  z
    .object({
      kind: z.literal("stage_started"),
      seq: z.number().int().min(1),
      stage_key: z.string().min(1),
      display_name: z.string().min(1),
    })
    .transform((line) => ({
      kind: "stage_started" as const,
      seq: line.seq,
      stageKey: line.stage_key,
      displayName: line.display_name,
    })),
  z
    .object({ kind: z.literal("stage_finished"), stage: stageSchema })
    .transform((line) => ({ kind: "stage_finished" as const, stage: line.stage })),
  z
    .object({
      kind: z.literal("guard_blocked"),
      guard: z.string().min(1),
      call: z.string().min(1),
      stage_key: z.string(),
    })
    .transform((line) => ({
      kind: "guard_blocked" as const,
      guard: line.guard,
      call: line.call,
      stageKey: line.stage_key,
    })),
  z
    .object({ kind: z.literal("done"), result: resultSchema })
    .transform((line) => ({ kind: "done" as const, result: line.result })),
]);

/** What a harness tool does to the world. */
export type EngineHarnessToolEffect = "read" | "simulated_write" | "replay";

/** What the installed harness can and cannot do — read from its own tables. */
export interface EngineDryRunHarness {
  /** The harness version a result names. */
  readonly harness: string;
  /** Every tool a stage has. There is no other way to act. */
  readonly tools: readonly {
    readonly name: string;
    readonly effect: EngineHarnessToolEffect;
    readonly does: string;
  }[];
  /** Every guard that can refuse a call. */
  readonly guards: readonly { readonly name: string; readonly refuses: string }[];
  /** The capabilities no tool provides. */
  readonly forbiddenCapabilities: readonly string[];
  /** Where a stage's writes go. */
  readonly writes: string;
  /** Where a stage's reads come from. */
  readonly reads: string;
  /** The control-plane path an infrastructure stage asks. */
  readonly replayEstimatesPath: string;
  /** The control-plane path every model call goes through. */
  readonly invokePath: string;
}

/** `GET /v0/dry-runs/harness`, as it arrives. */
export const engineDryRunHarnessSchema = z
  .object({
    harness: z.string().min(1),
    tools: z.array(
      z.object({
        name: z.string().min(1),
        effect: z.enum(["read", "simulated_write", "replay"]),
        does: z.string().min(1),
      }),
    ),
    guards: z.array(z.object({ name: z.string().min(1), refuses: z.string().min(1) })),
    forbidden_capabilities: z.array(z.string()),
    writes: z.string(),
    reads: z.string(),
    replay_estimates_path: z.string(),
    invoke_path: z.string(),
  })
  .transform((body): EngineDryRunHarness => ({
    harness: body.harness,
    tools: body.tools,
    guards: body.guards,
    forbiddenCapabilities: body.forbidden_capabilities,
    writes: body.writes,
    reads: body.reads,
    replayEstimatesPath: body.replay_estimates_path,
    invokePath: body.invoke_path,
  }));
