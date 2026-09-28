/**
 * Every statement the test-results reads and the artifact sweep issue (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * **Every read names the caller's workspace**, so a run, an attempt, a case or an artifact of
 * another workspace is simply not found — one answer for *absent* and *not yours*, which the
 * service turns into a `404`.
 *
 * The one write is the sweep's tombstone. V055's `test_artifacts_lifecycle` holds it to
 * `expired_at` alone and makes it final; the statement also asks for a row that has not expired,
 * so two sweeps racing on one artifact tombstone it once.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  BuildJobStatus,
  Database,
  FlakeState,
  HilLimitKind,
  HilVerdict,
  TestArtifactKind,
  TestAttemptOutcome,
  TestCaseFailure,
  TestCaseStatus,
  TestRunStatus,
  TestSelection,
  TestSuiteKind,
  TestSuiteResultsFormat,
} from "../db/schema";
import type { ClassificationRow } from "../triage/triage.repository";

/** The run a timeline belongs to — what the attempts card's header prints. */
export interface RunRow {
  readonly id: string;
  readonly github_repo_id: string;
  readonly issue_number: number;
  readonly issue_title: string;
  readonly loop_seq: number;
  readonly branch_name: string | null;
  readonly workflow_tag: string;
  readonly workflow_version_pin: number | null;
  readonly started_at: Date;
}

/** One attempt, with the build and runner that produced it. */
export interface AttemptRow {
  readonly id: string;
  readonly run_id: string;
  readonly attempt_seq: number;
  readonly status: TestRunStatus;
  readonly commit_sha: string | null;
  readonly started_at: Date;
  /** `test_runs.updated_at` — moved by every results write, so it is when a report last arrived. */
  readonly updated_at: Date;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
  readonly wall_ms: string | null;
  readonly sim_ms: string | null;
  readonly physical_ms: string | null;
  readonly parse_warnings: unknown[];
  readonly build_job_id: string | null;
  readonly job_number: number | null;
  readonly job_status: BuildJobStatus | null;
  readonly test_selection: TestSelection | null;
  readonly runner_name: string | null;
}

/** One suite of an attempt. */
export interface SuiteRow {
  readonly id: string;
  readonly test_run_id: string;
  readonly name: string;
  readonly platform: string;
  readonly kind: TestSuiteKind;
  readonly results_format: TestSuiteResultsFormat;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
  readonly meta: Record<string, unknown>;
}

/** One case of an attempt, with the suite it ran in. */
export interface CaseRow {
  readonly id: string;
  readonly test_run_id: string;
  readonly test_suite_id: string;
  readonly case_key: string;
  readonly name: string;
  readonly classname: string | null;
  readonly status: TestCaseStatus;
  readonly retries: number;
  readonly retry_outcomes: TestAttemptOutcome[];
  readonly duration_ms: string | null;
  readonly failure: TestCaseFailure | null;
  readonly suite: string;
  readonly platform: string;
  readonly suite_kind: TestSuiteKind;
}

/** One HIL measurement. `value` and `limit_value` are `numeric`, so strings. */
export interface MeasurementRow {
  /** `hil_measurements.id` — what a criterion's evidence cites (#366). */
  readonly id: string;
  readonly test_case_id: string;
  readonly procedure: string;
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly limit_value: string;
  readonly limit_kind: HilLimitKind;
  readonly verdict: HilVerdict;
  readonly context: string | null;
  readonly trials: Record<string, unknown>[];
}

/** A case's current flake score. */
export interface FlakeRow {
  readonly case_key: string;
  readonly state: FlakeState;
  readonly score: string;
  readonly window_runs: number;
  readonly formula_version: number;
}

/** One artifact — a live file or a tombstone. */
export interface ArtifactRow {
  readonly id: string;
  readonly organization_id: string;
  readonly test_run_id: string;
  readonly name: string;
  readonly kind: TestArtifactKind;
  readonly size_bytes: string;
  readonly storage_ref: unknown;
  readonly checksum: string;
  readonly retained_until: Date;
  readonly expired_at: Date | null;
  readonly truncated: boolean;
  readonly truncation_note: string | null;
  readonly created_at: Date;
}

/** V059's coverage summary of one attempt. */
export interface CoverageRow {
  readonly lines_covered: string;
  readonly lines_total: string;
  readonly percent: string;
  readonly previous_attempt_seq: number | null;
  readonly delta: string | null;
}

/** The run's PR toggles (V055). */
export interface IntentRow {
  readonly block_until_green: boolean;
  readonly auto_rerun_physical: boolean;
}

/** The run's PR, and its `test_suite` gate definition when it has one. */
export interface PullRequestRow {
  readonly id: string;
  readonly external_number: number;
  readonly external_url: string;
  readonly gate_required: boolean | null;
  readonly gate_source: string | null;
}

/** An artifact past its retention, as the sweep reads it. */
export interface ExpiringArtifact {
  readonly id: string;
  readonly organization_id: string;
  readonly storage_ref: unknown;
  readonly size_bytes: string;
}

@Injectable()
export class ResultsRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /** The connection. */
  private get db(): Kysely<Database> {
    return this.database.db;
  }

  // --- the run and its attempts -------------------------------------------------------------

  /**
   * A run of this workspace.
   *
   * @param organizationId - The workspace.
   * @param runId - `runs.id`.
   * @returns The run, or undefined when absent or another workspace's.
   */
  run(organizationId: string, runId: string): Promise<RunRow | undefined> {
    return this.db
      .selectFrom("runs")
      .select([
        "id",
        "github_repo_id",
        "issue_number",
        "issue_title",
        "loop_seq",
        "branch_name",
        "workflow_tag",
        "workflow_version_pin",
        "started_at",
      ])
      .where("id", "=", runId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * The attempts of a run — or one attempt, by id — with the build and runner behind each.
   *
   * @param organizationId - The workspace.
   * @param filter - The run's attempts, or one attempt.
   * @returns The attempts, oldest first.
   */
  attempts(
    organizationId: string,
    filter: { runId: string } | { testRunId: string },
  ): Promise<AttemptRow[]> {
    let query = this.db
      .selectFrom("test_runs as t")
      .leftJoin("build_jobs as j", (join) =>
        join
          .onRef("j.id", "=", "t.build_job_id")
          .onRef("j.organization_id", "=", "t.organization_id"),
      )
      .leftJoin("runners as r", (join) =>
        join.onRef("r.id", "=", "j.runner_id").onRef("r.organization_id", "=", "j.organization_id"),
      )
      .select([
        "t.id",
        "t.run_id",
        "t.attempt_seq",
        "t.status",
        "t.commit_sha",
        "t.started_at",
        "t.updated_at",
        "t.total",
        "t.passed",
        "t.failed",
        "t.flaky",
        "t.skipped",
        "t.wall_ms",
        "t.sim_ms",
        "t.physical_ms",
        "t.parse_warnings",
        "t.build_job_id",
        "j.number as job_number",
        "j.status as job_status",
        "j.test_selection",
        "r.name as runner_name",
      ])
      .where("t.organization_id", "=", organizationId);

    query =
      "runId" in filter
        ? query.where("t.run_id", "=", filter.runId)
        : query.where("t.id", "=", filter.testRunId);

    return query.orderBy("t.attempt_seq").execute();
  }

  /**
   * The suites of some attempts.
   *
   * @param organizationId - The workspace.
   * @param testRunIds - The attempts.
   * @returns Their suites — simulated before physical, as the suites card draws them, then in the
   *   order they were written, which is the report's.
   */
  async suites(organizationId: string, testRunIds: readonly string[]): Promise<SuiteRow[]> {
    if (testRunIds.length === 0) return [];

    return this.db
      .selectFrom("test_suites")
      .select([
        "id",
        "test_run_id",
        "name",
        "platform",
        "kind",
        "results_format",
        "total",
        "passed",
        "failed",
        "flaky",
        "skipped",
        "meta",
      ])
      .where("organization_id", "=", organizationId)
      .where("test_run_id", "in", testRunIds)
      .orderBy("test_run_id")
      .orderBy(sql`kind = 'physical'`)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  /**
   * The cases of some attempts, optionally only some statuses or one case.
   *
   * @param organizationId - The workspace.
   * @param testRunIds - The attempts.
   * @param filter - The statuses wanted, and/or one case id.
   * @returns The cases, by suite then name.
   */
  async cases(
    organizationId: string,
    testRunIds: readonly string[],
    filter: { statuses?: readonly TestCaseStatus[]; caseId?: string } = {},
  ): Promise<CaseRow[]> {
    if (testRunIds.length === 0) return [];

    let query = this.db
      .selectFrom("test_cases as c")
      .innerJoin("test_suites as s", (join) =>
        join
          .onRef("s.id", "=", "c.test_suite_id")
          .onRef("s.organization_id", "=", "c.organization_id"),
      )
      .select([
        "c.id",
        "s.test_run_id",
        "c.test_suite_id",
        "c.case_key",
        "c.name",
        "c.classname",
        "c.status",
        "c.retries",
        "c.retry_outcomes",
        "c.duration_ms",
        "c.failure",
        "s.name as suite",
        "s.platform",
        "s.kind as suite_kind",
      ])
      .where("c.organization_id", "=", organizationId)
      .where("s.test_run_id", "in", testRunIds);

    if (filter.statuses !== undefined) query = query.where("c.status", "in", filter.statuses);
    if (filter.caseId !== undefined) query = query.where("c.id", "=", filter.caseId);

    return query.orderBy("s.name").orderBy("s.platform").orderBy("c.name").execute();
  }

  /**
   * The HIL measurements of an attempt's cases.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns Every measurement, by case then metric.
   */
  measurements(organizationId: string, testRunId: string): Promise<MeasurementRow[]> {
    return this.db
      .selectFrom("hil_measurements as m")
      .innerJoin("test_cases as c", (join) =>
        join
          .onRef("c.id", "=", "m.test_case_id")
          .onRef("c.organization_id", "=", "m.organization_id"),
      )
      .innerJoin("test_suites as s", (join) =>
        join
          .onRef("s.id", "=", "c.test_suite_id")
          .onRef("s.organization_id", "=", "c.organization_id"),
      )
      .select([
        "m.id",
        "m.test_case_id",
        "m.procedure",
        "m.metric",
        "m.value",
        "m.unit",
        "m.limit_value",
        "m.limit_kind",
        "m.verdict",
        "m.context",
        "m.trials",
      ])
      .where("m.organization_id", "=", organizationId)
      .where("s.test_run_id", "=", testRunId)
      .orderBy("c.name")
      .orderBy("m.metric")
      .execute();
  }

  /**
   * The current flake score of some cases in one repository.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - The repository — a `case_key` is only a case within it (decision T2).
   * @param caseKeys - The cases.
   * @returns The scored ones; a case never scored is absent.
   */
  async flakes(
    organizationId: string,
    githubRepoId: string,
    caseKeys: readonly string[],
  ): Promise<FlakeRow[]> {
    if (caseKeys.length === 0) return [];

    return this.db
      .selectFrom("flake_scores")
      .select(["case_key", "state", "score", "window_runs", "formula_version"])
      .where("organization_id", "=", organizationId)
      .where("github_repo_id", "=", githubRepoId)
      .where("case_key", "in", caseKeys)
      .execute();
  }

  /**
   * The current classification of every classified case of an attempt.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns The decisions, oldest first.
   */
  classifications(organizationId: string, testRunId: string): Promise<ClassificationRow[]> {
    return this.db
      .selectFrom("failure_classifications as f")
      .innerJoin("test_cases as c", (join) =>
        join
          .onRef("c.id", "=", "f.test_case_id")
          .onRef("c.organization_id", "=", "f.organization_id"),
      )
      .innerJoin("test_suites as s", (join) =>
        join
          .onRef("s.id", "=", "c.test_suite_id")
          .onRef("s.organization_id", "=", "c.organization_id"),
      )
      .selectAll("f")
      .where("f.organization_id", "=", organizationId)
      .where("s.test_run_id", "=", testRunId)
      .where("f.superseded_by", "is", null)
      .orderBy("f.created_at")
      .execute();
  }

  /**
   * An attempt's coverage summary — V059's view, delta included.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns The summary, or undefined when the attempt uploaded no coverage report.
   */
  coverage(organizationId: string, testRunId: string): Promise<CoverageRow | undefined> {
    return this.db
      .selectFrom("test_run_coverage")
      .select(["lines_covered", "lines_total", "percent", "previous_attempt_seq", "delta"])
      .where("organization_id", "=", organizationId)
      .where("test_run_id", "=", testRunId)
      .executeTakeFirst();
  }

  // --- the next step ------------------------------------------------------------------------

  /**
   * The run's PR toggles.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns Them, or undefined when nobody has set any.
   */
  intents(organizationId: string, runId: string): Promise<IntentRow | undefined> {
    return this.db
      .selectFrom("run_pr_intents")
      .select(["block_until_green", "auto_rerun_physical"])
      .where("organization_id", "=", organizationId)
      .where("run_id", "=", runId)
      .executeTakeFirst();
  }

  /**
   * The run's pull request — the newest, if a loop opened more than one — and its `test_suite`
   * gate definition.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The PR, or undefined when the run has opened none.
   */
  pullRequest(organizationId: string, runId: string): Promise<PullRequestRow | undefined> {
    return this.db
      .selectFrom("pull_requests as p")
      .leftJoin("pr_gate_definitions as g", (join) =>
        join.onRef("g.pr_id", "=", "p.id").on("g.gate_key", "=", "test_suite"),
      )
      .select([
        "p.id",
        "p.external_number",
        "p.external_url",
        "g.required as gate_required",
        "g.source as gate_source",
      ])
      .where("p.organization_id", "=", organizationId)
      .where("p.run_id", "=", runId)
      .orderBy("p.created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  // --- artifacts ----------------------------------------------------------------------------

  /**
   * The artifacts of an attempt, tombstones included.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns Every artifact, in the order it was uploaded — the card's order.
   */
  artifacts(organizationId: string, testRunId: string): Promise<ArtifactRow[]> {
    return this.artifactQuery(organizationId)
      .where("test_run_id", "=", testRunId)
      .orderBy("created_at")
      .orderBy("name")
      .execute();
  }

  /**
   * One artifact of this workspace.
   *
   * @param organizationId - The workspace.
   * @param artifactId - `test_artifacts.id`.
   * @returns It, or undefined when absent or another workspace's.
   */
  artifact(organizationId: string, artifactId: string): Promise<ArtifactRow | undefined> {
    return this.artifactQuery(organizationId).where("id", "=", artifactId).executeTakeFirst();
  }

  /**
   * Live artifacts whose retention has run out, oldest first — the sweep's batch. Every
   * workspace's: the sweep is the system's, and each row carries its own policy in
   * `retained_until`.
   *
   * Only rows stored through `driver` are chosen: bytes in another store cannot be removed from
   * here, and tombstoning them anyway would orphan them — they wait for the migration (AV.5, #347).
   *
   * @param at - Now.
   * @param driver - The driver this process runs.
   * @param limit - The batch size.
   * @returns At most `limit` artifacts.
   */
  expiring(at: Date, driver: string, limit: number): Promise<ExpiringArtifact[]> {
    return this.db
      .selectFrom("test_artifacts")
      .select(["id", "organization_id", "storage_ref", "size_bytes"])
      .where("expired_at", "is", null)
      .where("retained_until", "<=", at)
      .where(sql<string>`storage_ref ->> 'driver'`, "=", driver)
      .orderBy("retained_until")
      .limit(limit)
      .execute();
  }

  /**
   * Tombstone an artifact whose bytes are gone: the name, kind and size stay, so the card can say
   * `expired` rather than lose the row.
   *
   * @param artifact - The artifact.
   * @param at - When.
   * @returns Whether this call wrote the tombstone — false when another sweep already had.
   */
  async markExpired(artifact: ExpiringArtifact, at: Date): Promise<boolean> {
    const result = await this.db
      .updateTable("test_artifacts")
      .set({ expired_at: at })
      .where("id", "=", artifact.id)
      .where("organization_id", "=", artifact.organization_id)
      .where("expired_at", "is", null)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * The artifact columns every read wants, in one workspace.
   *
   * @param organizationId - The workspace.
   * @returns The query, unfiltered but for the workspace.
   */
  private artifactQuery(organizationId: string) {
    return this.db
      .selectFrom("test_artifacts")
      .select([
        "id",
        "organization_id",
        "test_run_id",
        "name",
        "kind",
        "size_bytes",
        "storage_ref",
        "checksum",
        "retained_until",
        "expired_at",
        "truncated",
        "truncation_note",
        "created_at",
      ])
      .where("organization_id", "=", organizationId);
  }
}
