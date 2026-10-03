/**
 * The Build Analyzer's integration benches (BV.5 #514, BV.6 #515) — one workspace with everything
 * mockup 18's suggestions name, the seeded findings composed into suggestions, and the helpers the
 * action, measurement and isolation suites share.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import type { ApiHarness, Person, Workspace } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { EngineFinding } from "../engine/engine.analysis";
import { readFixture } from "../workflows/dsl.golden.fixture";
import { WorkflowsService } from "../workflows/workflows.service";
import { analyzerEnded, pendingProgress, remainingNotRun } from "./analysis.progress";
import { AnalysisRepository } from "./analysis.repository";
import { FORGE_02_ID, POOL_A_ID, SEEDED_FINDINGS } from "./composer/composer.seed.fixture";
import { SuggestionComposer } from "./composer/composer.service";
import { DEFAULT_BUDGET, FULL_READ, manifestBudget } from "./corpus/corpus.manifest";

/** The repository every bench analyzes. */
export const BENCH_REPO = "acme-robotics/helios-firmware";

/** The seeded findings a bench can store — a waiver cite needs a loop plane no bench builds. */
const PERSISTABLE = SEEDED_FINDINGS.filter((finding) => finding.analyzer !== "waiver_cite");

/** Every analyzer the seeded findings came from, at v1, plus the change-point analyzer. */
export const BENCH_ANALYZER_SET = {
  label: "deterministic analyzers v1",
  analyzers: [
    "cache_window",
    "change_point",
    "config_usage",
    "log_signature",
    "queue_correlation",
    "waiver_cite",
    "workflow_outcome",
  ].map((id) => ({ id, version: 1, kind: "deterministic" as const })),
};

/** The corpus window the seeded findings were composed over. */
const WINDOW = { from: "2026-05-10", to: "2026-08-07", days: 90 };

/**
 * The bench workspace the composer seed's fixed ids expect: pool-a and forge-02 at their seeded ids
 * (the seeded findings cite them), the mirrored repository and the `standard-fix` workflow.
 *
 * @param api - The harness.
 * @param workspace - The workspace.
 */
export async function seedSeededIdsWorkspace(api: ApiHarness, workspace: Workspace): Promise<void> {
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.runner_pools (id, organization_id, name, executor)
     values ($2, $1, 'pool-a', 'shell')`,
    [workspace.id, POOL_A_ID],
  );
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.runners
       (id, organization_id, pool_id, name, arch, status, desired_state, security_mode,
        cert_serial, capabilities)
     values ($3, $1, $2, 'forge-02', 'linux/arm64', 'offline', 'active', 'mtls', '4a7333a2',
             '{"executors": ["shell"]}'::jsonb)`,
    [workspace.id, POOL_A_ID, FORGE_02_ID],
  );
  const [login, name] = BENCH_REPO.split("/");
  const orgs = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
     values ($1, $2, true) returning id`,
    [workspace.id, login],
  );
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled) values ($1, $2, true)`,
    [orgs.rows[0].id, name],
  );
  await api.nest.get(WorkflowsService).create(workspace.id, {
    name: "Standard fix",
    slug: "standard-fix",
    definition: readFixture("valid/standard-fix.json") as Record<string, unknown>,
  });
}

/**
 * Start a run over the seeded findings (and any extra), compose it, and end it.
 *
 * @param api - The harness.
 * @param workspace - The workspace — one {@link seedSeededIdsWorkspace} prepared.
 * @param extra - More findings to store with the run (a change-point, say).
 * @returns The run's id.
 */
export async function analyze(
  api: ApiHarness,
  workspace: Workspace,
  extra: EngineFinding[] = [],
): Promise<string> {
  const runs = api.nest.get(AnalysisRepository);
  const inserted = await runs.insertRun({
    organizationId: workspace.id,
    repoRef: BENCH_REPO,
    trigger: "manual",
    scheduleId: null,
    analyzerSet: BENCH_ANALYZER_SET,
    progress: pendingProgress(BENCH_ANALYZER_SET),
  });
  if (!inserted.started) throw new Error("the run did not start");
  const evidence = [{ kind: "runner_pool", id: POOL_A_ID }];

  for (const analyzer of BENCH_ANALYZER_SET.analyzers) {
    const findings: EngineFinding[] = [
      ...PERSISTABLE.filter((finding) => finding.analyzer === analyzer.id).map((finding) => ({
        analyzer: finding.analyzer,
        analyzer_version: 1,
        finding_type: finding.findingType,
        subject_key: finding.subjectKey,
        data:
          finding.findingType === "log_signature"
            ? { ...finding.data, sample_refs: evidence }
            : { ...finding.data },
        evidence_refs: evidence,
        confidence: finding.confidence,
        confidence_basis: { ...finding.confidenceBasis },
      })),
      ...extra.filter((finding) => finding.analyzer === analyzer.id),
    ];
    if (findings.length > 0) await runs.writeFindings(inserted.run, findings);
  }

  await api.nest.get(SuggestionComposer).compose(inserted.run, WINDOW);
  await runs.finish(inserted.run.id, {
    status: "failed",
    phase: "composing",
    manifest: null,
    progress: null,
    computeSeconds: 1,
    confidenceNote: null,
    failureReason: "ended by the suite so the next run may start",
  });
  return inserted.run.id;
}

/**
 * A change-point finding as the engine's v1 analyzer emits one — a shift on `date`, with ranked
 * candidates.
 *
 * @param date - The breakpoint day.
 * @param deltaSeconds - After minus before.
 * @param candidates - The ranked candidates, best first; each cites its `ref`.
 * @param evidence - References cited beyond the candidates' — the builds either side.
 * @returns The finding.
 */
export function changePointFinding(
  date: string,
  deltaSeconds: number,
  candidates: {
    label: string;
    score: number;
    ref: { kind: string; id: string };
    event_kind: string | null;
    days_from_breakpoint: number;
  }[],
  evidence: { kind: string; id: string }[] = [],
): EngineFinding {
  return {
    analyzer: "change_point",
    analyzer_version: 1,
    finding_type: "change_point",
    subject_key: `build.duration_median@${date}`,
    data: {
      date,
      metric: "build.duration_median",
      delta_seconds: deltaSeconds,
      before_median_seconds: 342,
      after_median_seconds: 342 + deltaSeconds,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        date,
        proximity: 1 - Math.abs(candidate.days_from_breakpoint) / 4,
        prior: 0.7,
      })),
    },
    evidence_refs: [...candidates.map((candidate) => candidate.ref), ...evidence],
    confidence: 90,
    confidence_basis: { method: "change_point v1", sample_size: 40, effect_size: 9, stability: 1 },
  };
}

/**
 * A complete run whose change-point analyzer finished with the given findings — what the duration
 * chart annotates (BW.2, #517). The other analyzers of the set are recorded as not run.
 *
 * @param api - The harness.
 * @param workspace - The workspace — one {@link seedSeededIdsWorkspace} prepared.
 * @param findings - The change-point findings to store.
 * @param durationLabel - The job label the corpus timed.
 * @returns The run's id.
 */
export async function annotate(
  api: ApiHarness,
  workspace: Workspace,
  findings: EngineFinding[],
  durationLabel: string | null = "zephyr build",
): Promise<string> {
  const runs = api.nest.get(AnalysisRepository);
  const inserted = await runs.insertRun({
    organizationId: workspace.id,
    repoRef: BENCH_REPO,
    trigger: "manual",
    scheduleId: null,
    analyzerSet: BENCH_ANALYZER_SET,
    progress: pendingProgress(BENCH_ANALYZER_SET),
  });
  if (!inserted.started) throw new Error("the run did not start");

  await runs.analyzing(inserted.run.id, {
    window: WINDOW,
    counts: { builds: 40, loops: 0, log_lines: 0, hil_sessions: 0 },
    sources: { builds: FULL_READ, loops: FULL_READ, log_lines: FULL_READ, hil_sessions: FULL_READ },
    budget: manifestBudget(DEFAULT_BUDGET),
    duration_label: durationLabel,
  });
  await runs.writeFindings(inserted.run, findings);
  await runs.finish(inserted.run.id, {
    status: "complete",
    phase: "composing",
    manifest: null,
    progress: remainingNotRun(
      analyzerEnded(
        pendingProgress(BENCH_ANALYZER_SET),
        {
          analyzer: "change_point",
          version: 1,
          status: "completed",
          reason: null,
          elapsedSeconds: 1,
        },
        findings.length,
      ),
      "the bench ran the change-point analyzer alone",
    ),
    computeSeconds: 1,
    confidenceNote: "medium — the bench's corpus",
    failureReason: null,
  });
  return inserted.run.id;
}

/**
 * A suggestion's id by the start of its title.
 *
 * @param api - The harness.
 * @param workspace - The workspace.
 * @param prefix - The title's start.
 * @returns The id.
 */
export async function suggestionId(
  api: ApiHarness,
  workspace: Workspace,
  prefix: string,
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `select id from ${SCHEMA_NAME}.analysis_suggestions
      where organization_id = $1 and title like $2`,
    [workspace.id, `${prefix}%`],
  );
  if (rows.length !== 1) throw new Error(`no single suggestion titled ${prefix}…`);
  return rows[0].id;
}

/** What a directly recorded application predicts and is measured on. */
export interface Application {
  /** When it was applied. */
  at: string;
  metric: string;
  /** In seconds. */
  baseline: number;
  /** In seconds. */
  delta: number;
  analyzer: string;
  impactClass?: string;
  /** The factor the prediction was made with. */
  factor?: number;
  statistic?: string;
  dimension?: string;
}

/**
 * Record an apply as BV.5 would — its audit event, the suggestion moved to `applied`, and the
 * measurement row — with a chosen instant, target metric and prediction.
 *
 * @param api - The harness.
 * @param workspace - The workspace.
 * @param person - Who applied it.
 * @param id - The suggestion.
 * @param application - The apply.
 * @returns The measurement's id.
 */
export async function recordApplication(
  api: ApiHarness,
  workspace: Workspace,
  person: Person,
  id: string,
  application: Application,
): Promise<string> {
  const event = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.audit_events
       (organization_id, actor_id, action, subject_type, subject_id, occurred_at)
     values ($1, $2, 'analysis_suggestion.applied', 'analysis_suggestion', $3, $4) returning id`,
    [workspace.id, person.id, id, application.at],
  );
  await api.sql.query(
    `update ${SCHEMA_NAME}.analysis_suggestions
        set status = 'applied', resolved_by = $2, resolved_at = $3, applied_event_id = $4
      where id = $1`,
    [id, person.id, application.at, event.rows[0].id],
  );
  const day = application.at.slice(0, 10);
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const measurement = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.suggestion_measurements
       (suggestion_id, organization_id, repo_ref, applied_at, applied_by, target_metric, baseline,
        predicted)
     select s.id, s.organization_id, s.repo_ref, $2, $3, $4, $5::jsonb, $6::jsonb
       from ${SCHEMA_NAME}.analysis_suggestions s where s.id = $1
     returning id`,
    [
      id,
      application.at,
      person.id,
      application.metric,
      JSON.stringify({
        window: { from, to },
        value: application.baseline,
        ...(application.statistic === undefined ? {} : { statistic: application.statistic }),
        ...(application.dimension === undefined ? {} : { dimension: application.dimension }),
      }),
      JSON.stringify({
        delta: application.delta,
        unit: "seconds",
        basis: { method: "extrapolated", description: "the bench's prediction" },
        calibration: {
          analyzer: application.analyzer,
          impact_class: application.impactClass ?? "duration_delta",
          factor: application.factor ?? 1,
        },
      }),
    ],
  );
  return measurement.rows[0].id;
}

/**
 * Write one rolled-up day of a median metric, as the extractor would.
 *
 * @param api - The harness.
 * @param workspace - The workspace.
 * @param metric - The metric.
 * @param day - `YYYY-MM-DD`.
 * @param samplesMs - The day's samples, milliseconds.
 * @param dimension - The dimension, `""` when undimensioned.
 */
export async function rollUp(
  api: ApiHarness,
  workspace: Workspace,
  metric: string,
  day: string,
  samplesMs: number[],
  dimension = "",
): Promise<void> {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.metric_daily
       (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, meta)
     values ($1, $2, $3, false, $4, $5::date, $6, $7::jsonb)`,
    [workspace.id, BENCH_REPO, metric, dimension, day, median, JSON.stringify({ samples: sorted })],
  );
}

/**
 * Mark a metric family rolled up through a day.
 *
 * @param api - The harness.
 * @param workspace - The workspace.
 * @param family - The family.
 * @param day - The last filled day.
 */
export async function filledThrough(
  api: ApiHarness,
  workspace: Workspace,
  family: string,
  day: string,
): Promise<void> {
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.metric_rollup_state
       (organization_id, family, last_filled_day, last_run_status, last_run_at)
     values ($1, $2, $3::date, 'succeeded', now())
     on conflict (organization_id, family) do update set last_filled_day = excluded.last_filled_day`,
    [workspace.id, family, day],
  );
}
