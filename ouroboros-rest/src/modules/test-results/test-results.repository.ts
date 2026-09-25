/**
 * Every statement the result parser issues (AT.1, [#329](https://github.com/NobuData/ouroboros/issues/329))
 * — reading the attempt it parses for, the prior attempt's coverage, and the one transaction that
 * replaces the attempt's tree.
 *
 * ## Re-parse replaces, and keeps identities
 *
 * Uploads get retried, and a re-parse that appended would corrupt every count on the page. So the
 * write is a **replacement**, in one transaction with the `test_runs` row locked `for update` (two
 * parses of one attempt serialise). But it is a replacement **by durable key**, not a delete and
 * re-insert: suites are upserted on `(test_run_id, name, platform)`, cases on
 * `(test_suite_id, case_key)`, measurements on `(test_case_id, metric)`, and only what the new
 * parse no longer contains is deleted. The difference matters because rows hang off a case with
 * `on delete cascade` — a person's failure classification (V055) and a PR criterion's evidence
 * (V057) — and a re-parse of the same upload set must not silently erase them. Parsing the same
 * files twice therefore leaves the same ids, the same counts and no duplicates.
 *
 * Two exceptions delete rather than update, because the database freezes what would change:
 * a suite whose `results_format` changed (`test_suites_results_format_frozen`) is replaced whole,
 * and a measurement whose case's procedure changed is replaced (`hil_measurements_procedure_agrees`
 * compares against its siblings, so an in-place update of one would be refused).
 *
 * ## The totals are recomputed, never counted here
 *
 * After the cases are written, `ouroboros.test_run_recount()` rewrites the suite and attempt counts
 * from V051's counting views — the single definition of counting — so stored equals recompute
 * after every parse.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";
import { testCaseKey } from "./case-key";
import type { ParseWarning } from "./parser.spi";
import type { DurationSplit, PreparedCase, PreparedSuite } from "./tree";

/** How many rows one multi-row insert carries. */
const BATCH_ROWS = 500;

/** The attempt a parse writes into. */
export interface AttemptRef {
  /** `test_runs.id`. */
  readonly id: string;
  readonly organizationId: string;
  readonly runId: string;
  /** Build 1 · 2 · 3. */
  readonly attemptSeq: number;
  /** The run's repository — every `case_key` beneath the attempt is scoped to it. */
  readonly githubRepoId: string;
}

/** An attempt's five stored counts. */
export interface AttemptTotals {
  readonly total: number;
  readonly passed: number;
  /** `failed` and `error` cases together, as V051 counts them. */
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

/** A previous attempt's coverage, as V059's `test_run_coverage` sums it. */
export interface PriorCoverage {
  readonly attemptSeq: number;
  readonly linesCovered: number;
  readonly linesTotal: number;
}

/** What one replacement writes. */
export interface TreeWrite {
  readonly attempt: AttemptRef;
  readonly suites: readonly PreparedSuite[];
  readonly warnings: readonly ParseWarning[];
  readonly split: DurationSplit;
}

/** The statements the parse orchestration needs — what its unit suite stands in for. */
export interface TestResultsStore {
  /**
   * One attempt of the workspace.
   *
   * @param organizationId - The workspace.
   * @param testRunId - `test_runs.id`.
   * @returns It, or undefined when the workspace has no such attempt.
   */
  attempt(organizationId: string, testRunId: string): Promise<AttemptRef | undefined>;
  /**
   * The latest earlier attempt of the same run that has coverage.
   *
   * @param attempt - The attempt being parsed.
   * @returns Its counts, or undefined when there is none.
   */
  priorCoverage(attempt: AttemptRef): Promise<PriorCoverage | undefined>;
  /**
   * Replace the attempt's tree — see this file's header.
   *
   * @param write - The tree, the warnings and the split.
   * @returns The attempt's totals after the recount.
   */
  replaceTree(write: TreeWrite): Promise<AttemptTotals>;
}

/** The PostgreSQL {@link TestResultsStore}. */
@Injectable()
export class TestResultsRepository implements TestResultsStore {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async attempt(organizationId: string, testRunId: string): Promise<AttemptRef | undefined> {
    const row = await this.database.db
      .selectFrom("test_runs as t")
      .innerJoin("runs as r", "r.id", "t.run_id")
      .select(["t.id", "t.organization_id", "t.run_id", "t.attempt_seq", "r.github_repo_id"])
      .where("t.organization_id", "=", organizationId)
      .where("t.id", "=", testRunId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          runId: row.run_id,
          attemptSeq: row.attempt_seq,
          githubRepoId: row.github_repo_id,
        };
  }

  /** @inheritdoc */
  async priorCoverage(attempt: AttemptRef): Promise<PriorCoverage | undefined> {
    const row = await this.database.db
      .selectFrom("test_run_coverage")
      .select(["attempt_seq", "lines_covered", "lines_total"])
      .where("organization_id", "=", attempt.organizationId)
      .where("run_id", "=", attempt.runId)
      .where("attempt_seq", "<", attempt.attemptSeq)
      .orderBy("attempt_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          attemptSeq: row.attempt_seq,
          linesCovered: Number(row.lines_covered),
          linesTotal: Number(row.lines_total),
        };
  }

  /** @inheritdoc */
  replaceTree(write: TreeWrite): Promise<AttemptTotals> {
    const { attempt } = write;

    return this.database.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom("test_runs")
        .select("id")
        .where("id", "=", attempt.id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const existing = await trx
        .selectFrom("test_suites")
        .select(["id", "name", "platform", "results_format"])
        .where("test_run_id", "=", attempt.id)
        .execute();
      const wanted = new Set(write.suites.map((suite) => suiteKey(suite.name, suite.platform)));
      const stale = existing.filter(
        (row) =>
          !wanted.has(suiteKey(row.name, row.platform)) ||
          write.suites.some(
            (suite) =>
              suite.name === row.name &&
              suite.platform === row.platform &&
              suite.format !== row.results_format,
          ),
      );

      if (stale.length > 0) {
        await trx
          .deleteFrom("test_suites")
          .where(
            "id",
            "in",
            stale.map((row) => row.id),
          )
          .execute();
      }

      for (const suite of write.suites) {
        await writeSuite(trx, attempt, suite);
      }

      await sql`select ouroboros.test_run_recount(${attempt.id}::uuid)`.execute(trx);

      return trx
        .updateTable("test_runs")
        .set({
          parse_warnings: JSON.stringify(write.warnings),
          wall_ms: write.split.wallMs,
          sim_ms: write.split.simMs,
          physical_ms: write.split.physicalMs,
        })
        .where("id", "=", attempt.id)
        .returning(["total", "passed", "failed", "flaky", "skipped"])
        .executeTakeFirstOrThrow();
    });
  }
}

/**
 * Upsert one suite, its cases and their measurements, and delete its cases the parse no longer has.
 *
 * @param trx - The transaction.
 * @param attempt - The attempt.
 * @param suite - The suite.
 * @returns When it is written.
 */
async function writeSuite(
  trx: Transaction<Database>,
  attempt: AttemptRef,
  suite: PreparedSuite,
): Promise<void> {
  const { id: suiteId } = await trx
    .insertInto("test_suites")
    .values({
      organization_id: attempt.organizationId,
      test_run_id: attempt.id,
      name: suite.name,
      platform: suite.platform,
      kind: suite.kind,
      results_format: suite.format,
      meta: JSON.stringify(suite.meta),
    })
    .onConflict((conflict) =>
      conflict
        .columns(["test_run_id", "name", "platform"])
        .doUpdateSet({ kind: suite.kind, meta: JSON.stringify(suite.meta) }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();

  const keyed = suite.cases.map((kase) => ({
    kase,
    key: testCaseKey(attempt.githubRepoId, suite.name, kase.classname, kase.name),
  }));
  const ids = new Map<string, string>();

  for (let at = 0; at < keyed.length; at += BATCH_ROWS) {
    const rows = await trx
      .insertInto("test_cases")
      .values(
        keyed
          .slice(at, at + BATCH_ROWS)
          .map(({ kase, key }) => caseRow(attempt, suiteId, key, kase)),
      )
      .onConflict((conflict) =>
        conflict.columns(["test_suite_id", "case_key"]).doUpdateSet((eb) => ({
          status: eb.ref("excluded.status"),
          retries: eb.ref("excluded.retries"),
          retry_outcomes: eb.ref("excluded.retry_outcomes"),
          duration_ms: eb.ref("excluded.duration_ms"),
          failure: eb.ref("excluded.failure"),
          meta: eb.ref("excluded.meta"),
        })),
      )
      .returning(["id", "case_key"])
      .execute();

    for (const row of rows) {
      ids.set(row.case_key, row.id);
    }
  }

  // One array parameter rather than one per key, so a suite of any size stays under PostgreSQL's
  // bind-parameter ceiling.
  await trx
    .deleteFrom("test_cases")
    .where("test_suite_id", "=", suiteId)
    .where(sql<boolean>`case_key <> all(${[...ids.keys()]}::text[])`)
    .execute();

  if (suite.format === "hil") {
    for (const { kase, key } of keyed) {
      await writeMeasurements(trx, attempt, ids.get(key) as string, kase);
    }
  }
}

/**
 * One case as a `test_cases` row.
 *
 * @param attempt - The attempt.
 * @param suiteId - Its suite.
 * @param key - Its `case_key`.
 * @param kase - The case.
 * @returns The row.
 */
function caseRow(attempt: AttemptRef, suiteId: string, key: string, kase: PreparedCase) {
  return {
    organization_id: attempt.organizationId,
    test_suite_id: suiteId,
    case_key: key,
    name: kase.name,
    classname: kase.classname,
    status: kase.status,
    retries: kase.retries,
    retry_outcomes: JSON.stringify(kase.outcomes),
    duration_ms: kase.durationMs,
    failure: kase.failure === null ? null : JSON.stringify(kase.failure),
    meta: JSON.stringify(kase.meta),
  };
}

/**
 * Replace one case's measurements by metric.
 *
 * @param trx - The transaction.
 * @param attempt - The attempt.
 * @param caseId - The case.
 * @param kase - The case, with its HIL detail when it has one.
 * @returns When they are written.
 */
async function writeMeasurements(
  trx: Transaction<Database>,
  attempt: AttemptRef,
  caseId: string,
  kase: PreparedCase,
): Promise<void> {
  const measurements = kase.hil?.measurements ?? [];
  let stale = trx.deleteFrom("hil_measurements").where("test_case_id", "=", caseId);

  if (kase.hil !== undefined && measurements.length > 0) {
    const procedure = kase.hil.procedure;

    stale = stale.where((eb) =>
      eb.or([
        eb(
          "metric",
          "not in",
          measurements.map((m) => m.metric),
        ),
        eb("procedure", "<>", procedure),
      ]),
    );
  }
  await stale.execute();

  if (kase.hil === undefined || measurements.length === 0) {
    return;
  }

  const procedure = kase.hil.procedure;

  await trx
    .insertInto("hil_measurements")
    .values(
      measurements.map((m) => ({
        organization_id: attempt.organizationId,
        test_case_id: caseId,
        procedure,
        trials: JSON.stringify(m.trials),
        metric: m.metric,
        value: m.value,
        unit: m.unit,
        limit_value: m.limitValue,
        limit_kind: m.limitKind,
        verdict: m.verdict,
        // Composed by hil_measurements_compose_context from the attempt's history.
        context: null,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(["test_case_id", "metric"]).doUpdateSet((eb) => ({
        trials: eb.ref("excluded.trials"),
        value: eb.ref("excluded.value"),
        unit: eb.ref("excluded.unit"),
        limit_value: eb.ref("excluded.limit_value"),
        limit_kind: eb.ref("excluded.limit_kind"),
        verdict: eb.ref("excluded.verdict"),
        context: null,
      })),
    )
    .execute();
}

/**
 * A suite's identity within its attempt.
 *
 * @param name - Its name.
 * @param platform - Its platform.
 * @returns A string key.
 */
function suiteKey(name: string, platform: string): string {
  return `${name}\u001f${platform}`;
}
