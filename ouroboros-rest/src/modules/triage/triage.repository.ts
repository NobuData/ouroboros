/**
 * Every statement the classification & routing service issues — AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * Reads are scoped to the caller's workspace in every statement, so an attempt, a case or a run of
 * another workspace is simply not found — one answer for *absent* and *not yours*.
 *
 * The rules that make a write legal are the schema's, not this file's: V055's triggers refuse a
 * classification of a case that did not fail, supersede the case's current decision, hold a
 * decision frozen and a receipt written once; V061's constraints hold the health note and the test
 * selection to their shapes. A statement here that tried anything else would fail in the database.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  BuildJobStatus,
  ClassificationReceipt,
  Database,
  FailureClass,
  FailureSubtype,
  RunnerStatus,
  TestAttemptOutcome,
  TestCaseFailure,
  TestCaseStatus,
} from "../db/schema";
import type { CaseDossier, TriageRequest } from "./triage.contract";

/** A connection or a transaction. */
export type Writer = Kysely<Database> | Transaction<Database>;

/** An attempt, with the run it belongs to. */
export interface AttemptRow {
  readonly id: string;
  readonly organization_id: string;
  readonly run_id: string;
  readonly attempt_seq: number;
  readonly build_job_id: string | null;
  readonly commit_sha: string | null;
}

/** A case of an attempt, with its suite. */
export interface CaseRow {
  readonly id: string;
  readonly case_key: string;
  readonly name: string;
  readonly classname: string | null;
  readonly status: TestCaseStatus;
  readonly retry_outcomes: TestAttemptOutcome[];
  readonly failure: TestCaseFailure | null;
  readonly suite: string;
  readonly platform: string;
}

/** The build that produced an attempt, and the runner that held it. */
export interface AttemptJob {
  readonly id: string;
  readonly status: BuildJobStatus;
  readonly runner_id: string | null;
  readonly runner_name: string | null;
  readonly runner_status: RunnerStatus | null;
}

/** A classification being written. */
export interface NewClassification {
  readonly organizationId: string;
  readonly testCaseId: string;
  readonly class: FailureClass;
  readonly subtype: FailureSubtype | null;
  readonly note: string | null;
  readonly createdBy: string;
}

/** A classification as the service reads it back. */
export interface ClassificationRow {
  readonly id: string;
  readonly test_case_id: string;
  readonly class: FailureClass;
  readonly subtype: FailureSubtype | null;
  readonly note: string | null;
  readonly actor: "human" | "heuristic" | "model";
  readonly rule_id: string | null;
  readonly confidence: string | null;
  readonly routed: ClassificationReceipt | null;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly superseded_by: string | null;
}

/** A waiver as written. */
export interface WaiverRow {
  readonly id: string;
  readonly run_id: string;
  readonly author: string | null;
  readonly reason: string;
  readonly case_keys: string[];
  readonly annotation_state: "pending_pr_plane";
  readonly created_at: Date;
}

/** The statuses a case can be classified in — V055's `failure_classifications_case_failing`. */
export const FAILING_STATUSES: readonly TestCaseStatus[] = ["failed", "error", "flaky"];

/** The statuses *Re-run failed* re-runs — the attempt's `failed` count (V051). */
export const FAILED_STATUSES: readonly TestCaseStatus[] = ["failed", "error"];

@Injectable()
export class TriageRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /** The connection, for reads that need no transaction. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Run several statements as one transaction.
   *
   * @param work - What to run.
   * @returns What `work` resolved to, once committed.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  // --- attempts and cases -----------------------------------------------------------------

  /**
   * An attempt of this workspace.
   *
   * @param organizationId - The workspace.
   * @param testRunId - `test_runs.id`.
   * @returns The attempt, or undefined when absent or another workspace's.
   */
  attempt(organizationId: string, testRunId: string): Promise<AttemptRow | undefined> {
    return this.db
      .selectFrom("test_runs")
      .select(["id", "organization_id", "run_id", "attempt_seq", "build_job_id", "commit_sha"])
      .where("id", "=", testRunId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * The cases of an attempt, optionally one of them or only some statuses.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @param filter - A case id, and/or the statuses wanted.
   * @returns The cases, by suite then name.
   */
  cases(
    organizationId: string,
    testRunId: string,
    filter: { caseId?: string; statuses?: readonly TestCaseStatus[] } = {},
  ): Promise<CaseRow[]> {
    let query = this.db
      .selectFrom("test_cases as c")
      .innerJoin("test_suites as s", (join) =>
        join
          .onRef("s.id", "=", "c.test_suite_id")
          .onRef("s.organization_id", "=", "c.organization_id"),
      )
      .select([
        "c.id",
        "c.case_key",
        "c.name",
        "c.classname",
        "c.status",
        "c.retry_outcomes",
        "c.failure",
        "s.name as suite",
        "s.platform",
      ])
      .where("s.test_run_id", "=", testRunId)
      .where("c.organization_id", "=", organizationId);

    if (filter.caseId !== undefined) query = query.where("c.id", "=", filter.caseId);
    if (filter.statuses !== undefined) query = query.where("c.status", "in", filter.statuses);

    return query.orderBy("s.name").orderBy("s.platform").orderBy("c.name").execute();
  }

  // --- what the rules and the contract read -----------------------------------------------

  /**
   * Everything the hints and `/v0/triage` read about some cases of one attempt.
   *
   * @param organizationId - The workspace.
   * @param attempt - The attempt.
   * @param cases - Its failing cases.
   * @returns One dossier per case, by case id.
   */
  async dossiers(
    organizationId: string,
    attempt: AttemptRow,
    cases: readonly CaseRow[],
  ): Promise<Map<string, CaseDossier>> {
    const dossiers = new Map<string, CaseDossier>();

    if (cases.length === 0) return dossiers;

    const ids = cases.map((row) => row.id);
    const keys = [...new Set(cases.map((row) => row.case_key))];

    const [measurements, files, earlier, history, scores] = await Promise.all([
      this.db
        .selectFrom("hil_measurements")
        .select([
          "test_case_id",
          "metric",
          "value",
          "unit",
          "limit_value",
          "limit_kind",
          "verdict",
          "trials",
        ])
        .where("organization_id", "=", organizationId)
        .where("test_case_id", "in", ids)
        .orderBy("metric")
        .execute(),
      this.db
        .selectFrom("run_files")
        .select(["path", "status", "additions", "deletions"])
        .where("run_id", "=", attempt.run_id)
        .orderBy("path")
        .execute(),
      this.db
        .selectFrom("test_runs as t")
        .leftJoin(
          (eb) =>
            eb
              .selectFrom("test_cases as c")
              .innerJoin("test_suites as s", (join) =>
                join
                  .onRef("s.id", "=", "c.test_suite_id")
                  .onRef("s.organization_id", "=", "c.organization_id"),
              )
              .select(["s.test_run_id", "c.case_key", "c.status"])
              .where("c.organization_id", "=", organizationId)
              .where("c.case_key", "in", keys)
              .as("k"),
          (join) => join.onRef("k.test_run_id", "=", "t.id"),
        )
        .select(["t.attempt_seq", "t.commit_sha", "k.case_key", "k.status"])
        .where("t.run_id", "=", attempt.run_id)
        .where("t.organization_id", "=", organizationId)
        .where("t.attempt_seq", "<", attempt.attempt_seq)
        .orderBy("t.attempt_seq")
        .execute(),
      this.db
        .selectFrom("test_case_history")
        .select(["case_key", "test_case_id", "pass_on_retry"])
        .where("organization_id", "=", organizationId)
        .where("case_key", "in", keys)
        .execute(),
      sql<{ case_key: string; score: string; state: "healthy" | "watching" | "quarantined" }>`
        select case_key, score::text as score, state
          from ouroboros.flake_scores
         where organization_id = ${organizationId}
           and case_key = any(${keys}::text[])`.execute(this.db),
    ]);

    const attempts = new Map<
      number,
      { commit_sha: string | null; statuses: Map<string, TestCaseStatus> }
    >();

    for (const row of earlier) {
      const entry = attempts.get(row.attempt_seq) ?? {
        commit_sha: row.commit_sha,
        statuses: new Map<string, TestCaseStatus>(),
      };

      if (row.case_key !== null && row.status !== null)
        entry.statuses.set(row.case_key, row.status);
      attempts.set(row.attempt_seq, entry);
    }

    const changedFiles = files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    }));

    for (const row of cases) {
      const own = history.filter((entry) => entry.case_key === row.case_key);
      const score = scores.rows.find((entry) => entry.case_key === row.case_key);

      dossiers.set(row.id, {
        case: {
          case_key: row.case_key,
          name: row.name,
          classname: row.classname,
          suite: row.suite,
          platform: row.platform,
          status: row.status as TriageRequest["case"]["status"],
          retry_outcomes: row.retry_outcomes,
          failure: row.failure === null ? null : { ...row.failure },
        },
        hilMeasurements: measurements
          .filter((measurement) => measurement.test_case_id === row.id)
          .map((measurement) => ({
            metric: measurement.metric,
            value: Number(measurement.value),
            unit: measurement.unit,
            limit_value: Number(measurement.limit_value),
            limit_kind: measurement.limit_kind,
            verdict: measurement.verdict,
            trials: measurement.trials,
          })),
        changedFiles,
        priorAttempts: [...attempts.entries()].map(([attemptSeq, entry]) => ({
          attempt_seq: attemptSeq,
          outcome: entry.statuses.get(row.case_key) ?? "absent",
          commit_sha: entry.commit_sha,
        })),
        flakeHistory: {
          // Earlier occurrences only: this attempt's own is the case itself.
          occurrences: own.filter((entry) => entry.test_case_id !== row.id).length,
          pass_on_retry: own.filter((entry) => entry.test_case_id !== row.id && entry.pass_on_retry)
            .length,
          score: score === undefined ? null : Number(score.score),
          state: score?.state ?? null,
        },
      });
    }

    return dossiers;
  }

  /**
   * The build that produced an attempt, and its runner.
   *
   * @param organizationId - The workspace.
   * @param jobId - `test_runs.build_job_id`.
   * @returns The job, or undefined when the attempt has none or it was pruned.
   */
  job(organizationId: string, jobId: string | null): Promise<AttemptJob | undefined> {
    if (jobId === null) return Promise.resolve(undefined);

    return this.db
      .selectFrom("build_jobs as j")
      .leftJoin("runners as r", (join) =>
        join.onRef("r.id", "=", "j.runner_id").onRef("r.organization_id", "=", "j.organization_id"),
      )
      .select([
        "j.id",
        "j.status",
        "j.runner_id",
        "r.name as runner_name",
        "r.status as runner_status",
      ])
      .where("j.id", "=", jobId)
      .where("j.organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * The build a re-run of an attempt copies: the attempt's own, or — for an attempt with none,
   * such as one reported without the farm — the latest earlier attempt of the run that has one.
   *
   * @param organizationId - The workspace.
   * @param attempt - The attempt.
   * @returns The job id, or undefined when no attempt of the run was built on the farm.
   */
  async rerunSource(organizationId: string, attempt: AttemptRow): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("test_runs as t")
      .innerJoin("build_jobs as j", (join) =>
        join
          .onRef("j.id", "=", "t.build_job_id")
          .onRef("j.organization_id", "=", "t.organization_id"),
      )
      .select("j.id")
      .where("t.run_id", "=", attempt.run_id)
      .where("t.organization_id", "=", organizationId)
      .where("t.attempt_seq", "<=", attempt.attempt_seq)
      .orderBy("t.attempt_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * The stage a correction round retries: the run's active stage, or else its most recent one.
   *
   * @param runId - The run.
   * @returns The stage and its current attempt, or undefined before any stage has started.
   */
  currentStage(runId: string): Promise<{ stage_key: string; attempt: number } | undefined> {
    return this.db
      .selectFrom("run_stages")
      .select(["stage_key", "attempt"])
      .where("run_id", "=", runId)
      .where("status", "in", ["active", "failed", "succeeded"])
      .orderBy(sql`status = 'active'`, "desc")
      .orderBy(sql`coalesce(started_at, created_at)`, "desc")
      .orderBy("attempt", "desc")
      .limit(1)
      .executeTakeFirst();
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
      .where("s.test_run_id", "=", testRunId)
      .where("f.organization_id", "=", organizationId)
      .where("f.superseded_by", "is", null)
      .orderBy("f.created_at")
      .execute();
  }

  // --- writes -----------------------------------------------------------------------------

  /**
   * Record a person's classification. V055's triggers supersede the case's current decision.
   *
   * @param writer - The transaction.
   * @param row - The decision.
   * @returns The row as written.
   */
  insertClassification(writer: Writer, row: NewClassification): Promise<ClassificationRow> {
    return writer
      .insertInto("failure_classifications")
      .values({
        organization_id: row.organizationId,
        test_case_id: row.testCaseId,
        class: row.class,
        subtype: row.subtype,
        note: row.note,
        actor: "human",
        created_by: row.createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Write a classification's routing receipt — once; V055 refuses a second.
   *
   * @param organizationId - The workspace.
   * @param id - The classification.
   * @param receipt - What was dispatched.
   * @returns The row with its receipt.
   */
  route(
    organizationId: string,
    id: string,
    receipt: ClassificationReceipt,
  ): Promise<ClassificationRow> {
    return this.db
      .updateTable("failure_classifications")
      .set({ routed: JSON.stringify(receipt) })
      .where("id", "=", id)
      .where("organization_id", "=", organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Store the card's PR toggles for the run — intents, not gates (decision T8).
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @param toggles - The toggles the request set; an absent one keeps its stored value.
   * @param updatedBy - Who set them.
   */
  async upsertIntents(
    writer: Writer,
    organizationId: string,
    runId: string,
    toggles: { blockUntilGreen?: boolean; autoRerunPhysical?: boolean },
    updatedBy: string,
  ): Promise<void> {
    const set = {
      ...(toggles.blockUntilGreen === undefined
        ? {}
        : { block_until_green: toggles.blockUntilGreen }),
      ...(toggles.autoRerunPhysical === undefined
        ? {}
        : { auto_rerun_physical: toggles.autoRerunPhysical }),
      updated_by: updatedBy,
    };

    await writer
      .insertInto("run_pr_intents")
      .values({ run_id: runId, organization_id: organizationId, ...set })
      .onConflict((conflict) => conflict.column("run_id").doUpdateSet(set))
      .execute();
  }

  /**
   * Mark a case's occurrence in the flake history (V054) — the flake route's history mark. A
   * writer supplies the case and the trigger derives the rest, `pass_on_retry` included; an
   * occurrence already recorded (the parse-time hook of #331) is left alone.
   *
   * @param organizationId - The workspace.
   * @param testCaseId - The case.
   * @returns Whether this call recorded it.
   */
  async markHistory(organizationId: string, testCaseId: string): Promise<boolean> {
    const inserted = await this.db
      .insertInto("test_case_history")
      .values({ organization_id: organizationId, test_case_id: testCaseId })
      .onConflict((conflict) => conflict.column("test_case_id").doNothing())
      .returning("id")
      .executeTakeFirst();

    return inserted !== undefined;
  }

  /**
   * Write a runner's farm health note (V061), replacing any earlier one.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param note - The sentence.
   * @param notedBy - Who wrote it.
   * @returns When it was written, or undefined when the runner is gone.
   */
  async flagRunner(
    organizationId: string,
    runnerId: string,
    note: string,
    notedBy: string,
  ): Promise<Date | undefined> {
    const row = await this.db
      .updateTable("runners")
      .set({ health_note: note, health_noted_at: sql<Date>`now()`, health_noted_by: notedBy })
      .where("id", "=", runnerId)
      .where("organization_id", "=", organizationId)
      .returning("health_noted_at")
      .executeTakeFirst();

    return row?.health_noted_at ?? undefined;
  }

  /**
   * Record a waiver — append-only, reason required (V055).
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @param author - Who waived.
   * @param reason - Why.
   * @param caseKeys - The waived cases; empty for a criterion-level waiver.
   * @returns The waiver.
   */
  insertWaiver(
    organizationId: string,
    runId: string,
    author: string,
    reason: string,
    caseKeys: readonly string[],
  ): Promise<WaiverRow> {
    return this.db
      .insertInto("pr_waivers")
      .values({
        organization_id: organizationId,
        run_id: runId,
        author,
        reason,
        case_keys: [...caseKeys],
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
