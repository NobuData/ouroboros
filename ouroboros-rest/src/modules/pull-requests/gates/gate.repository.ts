/**
 * Every statement the gate engine issues.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)), over V056's gate tables and the
 * evidence systems they cite: `build_jobs` (V040), `test_runs` · `test_suites` · `test_cases`
 * (V051), `hil_measurements` (V053), `run_pr_intents` · `pr_waivers` (V055) and
 * `v_run_guardrails_latest` (V048). The pinned policy, the ticket and the vote rules are read with
 * `GuardrailsRepository`'s own statements, so "the run's policy" has one reading in the service.
 *
 * ## One transaction per evaluation, with the PR row locked
 *
 * Two evidence events for one PR can arrive together — a build finishing while its test report
 * parses. Each evaluation locks the `pull_requests` row `for update` first, so they serialise: the
 * second reads the first's results and appends only what changed. `evaluated_at` defaults to
 * `now()`, the transaction's instant, so two evaluations can never collide on V056's
 * `(definition_id, revision_id, evaluated_at)` key.
 *
 * ## Tenancy
 *
 * An event names the workspace it came from, and every lookup from an event is filtered by it —
 * a job id or run id of another workspace resolves to no PR. From the PR on, every read is keyed by
 * the PR's own rows.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  Database,
  EscalationThen,
  EscalationWhen,
  PrGateEvidenceRef,
  PullRequestState,
} from "../../db/schema";
import {
  GuardrailsRepository,
  type RunPolicyRow,
  type TicketFacts,
} from "../../guardrails/guardrails.repository";
import type { GateEvidenceEvent } from "./gate.evidence";
import type { GateAggregate, LatestResult } from "./gate.engine";
import type {
  AttemptFact,
  BuildFact,
  GateDefinitionSpec,
  GatePr,
  GateResultRow,
  GateRevision,
  HilFact,
  SecretsFact,
  StoredGateDefinition,
} from "./gate.types";

/** How many of a job's last log chunks the Build gate reads for its memory map. */
export const LOG_TAIL_CHUNKS = 8;

/** The states a gate evaluation touches — merged and closed PRs are the host's. */
const EVALUATED_STATES: readonly PullRequestState[] = ["open", "verifying", "blocked", "armed"];

/** A PR and its latest revision — what one evaluation is about. */
export interface GateSubject {
  readonly pr: GatePr;
  /** The latest revision, or null when the PR has none recorded yet. */
  readonly revision: GateRevision | null;
}

/** The policy's raw sources — the service derives the policy from them. */
export interface PolicySources {
  /** The run's pin and workspace, or undefined for a PR without a run. */
  readonly run: RunPolicyRow | undefined;
  /** The pinned version's stored document, or undefined when there is none. */
  readonly definition: unknown;
  /** The run's ticket: labels, plan files, effort. */
  readonly ticket: TicketFacts;
  /** The workspace's enabled escalation rules. */
  readonly rules: readonly { when: EscalationWhen; then: EscalationThen }[];
  /** The run's *Block PR until green* intent. */
  readonly blockUntilGreen: boolean;
}

/** The evidence rows the providers read. */
export interface EvidenceRows {
  readonly build: BuildFact | null;
  readonly attempt: AttemptFact | null;
  readonly hil: readonly HilFact[];
  readonly waivedCaseKeys: readonly string[];
  readonly secrets: SecretsFact | null;
}

/** The statements of one evaluation, inside its transaction. */
export interface GateTransaction {
  /**
   * Lock and read one PR.
   *
   * @param prId - The PR.
   * @returns It and its latest revision, or undefined when it does not exist.
   */
  lockPr(prId: string): Promise<GateSubject | undefined>;
  /**
   * @param pr - The PR.
   * @returns The policy's sources.
   */
  policySources(pr: GatePr): Promise<PolicySources>;
  /**
   * @param pr - The PR.
   * @param revision - Its latest revision.
   * @returns The evidence at the revision's head.
   */
  evidence(pr: GatePr, revision: GateRevision): Promise<EvidenceRows>;
  /**
   * Insert the definitions not yet stored, and update the ones whose policy moved.
   *
   * @param prId - The PR.
   * @param specs - The materialized set.
   * @returns Every definition of the PR, after the write.
   */
  upsertDefinitions(
    prId: string,
    specs: readonly GateDefinitionSpec[],
  ): Promise<StoredGateDefinition[]>;
  /**
   * @param revisionId - The revision.
   * @returns The latest result of each gate on it.
   */
  latestResults(revisionId: string): Promise<LatestResult[]>;
  /**
   * Append results — never update.
   *
   * @param revisionId - The revision.
   * @param rows - The results.
   */
  appendResults(revisionId: string, rows: readonly GateResultRow[]): Promise<void>;
  /**
   * @param revisionId - The revision.
   * @returns `pr_gate_aggregate(revision)`.
   */
  aggregate(revisionId: string): Promise<GateAggregate>;
  /**
   * Move the PR one edge of V052's graph.
   *
   * @param prId - The PR.
   * @param state - The next state.
   */
  setState(prId: string, state: PullRequestState): Promise<void>;
}

/** The gate engine's store — what its unit suite stands in for. */
export interface GateStore {
  /**
   * The PRs an event concerns — open ones only, inside the event's workspace.
   *
   * @param organizationId - The workspace the evidence came from.
   * @param event - The event.
   * @returns PR ids, sorted, each once.
   */
  targets(organizationId: string, event: GateEvidenceEvent): Promise<string[]>;
  /**
   * Run one evaluation in a transaction.
   *
   * @param work - What to do with it.
   * @returns What `work` returned.
   */
  transaction<T>(work: (tx: GateTransaction) => Promise<T>): Promise<T>;
}

/** The PostgreSQL {@link GateStore}. */
@Injectable()
export class GateRepository implements GateStore {
  /**
   * @param database - The pool.
   * @param guardrails - The pinned-policy and ticket reads, shared with AP.3.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly guardrails: GuardrailsRepository,
  ) {}

  /** @inheritdoc */
  async targets(organizationId: string, event: GateEvidenceEvent): Promise<string[]> {
    const db = this.database.db;
    const open = db
      .selectFrom("pull_requests")
      .select("pull_requests.id")
      .where("pull_requests.organization_id", "=", organizationId)
      .where("pull_requests.state", "in", EVALUATED_STATES);
    let ids: { id: string }[];

    switch (event.kind) {
      case "revision_pushed":
      case "pr_synced":
        ids = await open.where("pull_requests.id", "=", event.prId).execute();
        break;
      case "guardrail_evaluated":
        ids = await open.where("pull_requests.run_id", "=", event.runId).execute();
        break;
      case "test_run_parsed":
        ids = await open
          .innerJoin("test_runs", "test_runs.run_id", "pull_requests.run_id")
          .where("test_runs.id", "=", event.testRunId)
          .where("test_runs.organization_id", "=", organizationId)
          .execute();
        break;
      case "build_job_finished":
        // The job's own loop, or any PR one of whose revisions is the job's commit.
        ids = await open
          .innerJoin("build_jobs", "build_jobs.organization_id", "pull_requests.organization_id")
          .where("build_jobs.id", "=", event.jobId)
          .where((eb) =>
            eb.or([
              eb("build_jobs.run_id", "=", eb.ref("pull_requests.run_id")),
              eb.exists(
                eb
                  .selectFrom("pr_revisions")
                  .select("pr_revisions.id")
                  .whereRef("pr_revisions.pr_id", "=", "pull_requests.id")
                  .where(
                    sameCommitSql(
                      sql.ref("build_jobs.commit_sha"),
                      sql.ref("pr_revisions.head_sha"),
                    ),
                  ),
              ),
            ]),
          )
          .execute();
        break;
    }

    return [...new Set(ids.map((row) => row.id))].sort();
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: GateTransaction) => Promise<T>): Promise<T> {
    return this.database.db
      .transaction()
      .execute((trx) => work(new PgGateTransaction(trx, this.guardrails)));
  }
}

/**
 * SQL for "these two shas name the same commit" — the shorter, at least seven characters, is a
 * prefix of the longer. `sameCommit` in `gate.providers.ts` is the same rule.
 *
 * @param a - One sha expression.
 * @param b - The other.
 * @returns The predicate.
 */
function sameCommitSql(a: RawBuilder<unknown>, b: RawBuilder<unknown>): RawBuilder<boolean> {
  return sql<boolean>`(length(${a}) >= 7 and length(${b}) >= 7
    and (lower(${a}) like lower(${b}) || '%' or lower(${b}) like lower(${a}) || '%'))`;
}

/** One evaluation's statements, over its transaction. */
class PgGateTransaction implements GateTransaction {
  /**
   * @param trx - The transaction.
   * @param guardrails - AP.3's policy reads.
   */
  constructor(
    private readonly trx: Transaction<Database>,
    private readonly guardrails: GuardrailsRepository,
  ) {}

  /** @inheritdoc */
  async lockPr(prId: string): Promise<GateSubject | undefined> {
    const pr = await this.trx
      .selectFrom("pull_requests")
      .select(["id", "organization_id", "state", "run_id"])
      .where("id", "=", prId)
      .forUpdate()
      .executeTakeFirst();

    if (pr === undefined) {
      return undefined;
    }

    const revision = await this.trx
      .selectFrom("pr_revisions")
      .select(["id", "revision_seq", "head_sha", "files", "diff_excerpt"])
      .where("pr_id", "=", prId)
      .orderBy("revision_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      pr: { id: pr.id, organizationId: pr.organization_id, state: pr.state, runId: pr.run_id },
      revision:
        revision === undefined
          ? null
          : {
              id: revision.id,
              seq: revision.revision_seq,
              headSha: revision.head_sha,
              files: revision.files,
              diffExcerpt: revision.diff_excerpt,
            },
    };
  }

  /** @inheritdoc */
  async policySources(pr: GatePr): Promise<PolicySources> {
    const run = pr.runId === null ? undefined : await this.guardrails.runPolicy(this.trx, pr.runId);
    // The run's workspace is the PR's (V052's composite key), but the policy is read in the PR's
    // workspace regardless, so a mismatched row could never lend another workspace's rules.
    const scoped = run?.organizationId === pr.organizationId ? run : undefined;
    const pinned =
      scoped === undefined || scoped.workflowVersionPin === null
        ? undefined
        : await this.guardrails.pinnedDefinition(
            this.trx,
            pr.organizationId,
            scoped.workflowTag,
            scoped.workflowVersionPin,
          );
    const ticket =
      scoped === undefined ? { labels: [] } : await this.guardrails.ticketFacts(this.trx, scoped);
    const rules = await this.guardrails.enabledRules(this.trx, pr.organizationId);
    const intent =
      pr.runId === null
        ? undefined
        : await this.trx
            .selectFrom("run_pr_intents")
            .select("block_until_green")
            .where("run_id", "=", pr.runId)
            .where("organization_id", "=", pr.organizationId)
            .executeTakeFirst();

    return {
      run: scoped,
      definition: pinned?.definition,
      ticket,
      rules,
      blockUntilGreen: intent?.block_until_green ?? false,
    };
  }

  /** @inheritdoc */
  async evidence(pr: GatePr, revision: GateRevision): Promise<EvidenceRows> {
    const build = await this.build(pr, revision);
    const attempt = pr.runId === null ? null : await this.attempt(pr, pr.runId, revision);
    const hil = attempt === null ? [] : await this.hil(pr, attempt.id);
    const waivers =
      pr.runId === null
        ? []
        : await this.trx
            .selectFrom("pr_waivers")
            .select("case_keys")
            .where("run_id", "=", pr.runId)
            .where("organization_id", "=", pr.organizationId)
            .execute();
    const secrets =
      pr.runId === null
        ? undefined
        : await this.trx
            .selectFrom("v_run_guardrails_latest")
            .select(["id", "verdict"])
            .where("run_id", "=", pr.runId)
            .where("check", "=", "secrets")
            .executeTakeFirst();

    return {
      build,
      attempt,
      hil,
      waivedCaseKeys: [...new Set(waivers.flatMap((waiver) => waiver.case_keys))].sort(),
      secrets: secrets === undefined ? null : { id: secrets.id, verdict: secrets.verdict },
    };
  }

  /**
   * The latest farm build of the head, with the end of its log.
   *
   * @param pr - The PR, for its workspace.
   * @param revision - The revision.
   * @returns It, or null.
   */
  private async build(pr: GatePr, revision: GateRevision): Promise<BuildFact | null> {
    const job = await this.trx
      .selectFrom("build_jobs")
      .leftJoin("runners", "runners.id", "build_jobs.runner_id")
      .select([
        "build_jobs.id",
        "build_jobs.status",
        "build_jobs.exit_code",
        "runners.name as runner_name",
      ])
      .where("build_jobs.organization_id", "=", pr.organizationId)
      .where(sameCommitSql(sql.ref("build_jobs.commit_sha"), sql.val(revision.headSha)))
      .orderBy("build_jobs.queued_at", "desc")
      .orderBy("build_jobs.number", "desc")
      .limit(1)
      .executeTakeFirst();

    if (job === undefined) {
      return null;
    }

    const chunks = await this.trx
      .selectFrom("build_log_chunks")
      .select("content")
      .where("job_id", "=", job.id)
      .orderBy("seq", "desc")
      .limit(LOG_TAIL_CHUNKS)
      .execute();

    return {
      jobId: job.id,
      status: job.status,
      runnerName: job.runner_name,
      exitCode: job.exit_code,
      logTail: Buffer.concat(chunks.reverse().map((chunk) => chunk.content)).toString("utf8"),
    };
  }

  /**
   * The run's latest test attempt at the head, with its failing case keys.
   *
   * @param pr - The PR.
   * @param runId - Its run.
   * @param revision - The revision.
   * @returns It, or null.
   */
  private async attempt(
    pr: GatePr,
    runId: string,
    revision: GateRevision,
  ): Promise<AttemptFact | null> {
    const attempt = await this.trx
      .selectFrom("test_runs")
      .select(["id", "attempt_seq", "status", "total", "passed", "failed"])
      .where("run_id", "=", runId)
      .where("organization_id", "=", pr.organizationId)
      .where(sameCommitSql(sql.ref("test_runs.commit_sha"), sql.val(revision.headSha)))
      .orderBy("attempt_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    if (attempt === undefined) {
      return null;
    }

    const failing = await this.trx
      .selectFrom("test_cases")
      .innerJoin("test_suites", "test_suites.id", "test_cases.test_suite_id")
      .select("test_cases.case_key")
      .where("test_suites.test_run_id", "=", attempt.id)
      .where("test_cases.status", "in", ["failed", "error"])
      .orderBy("test_cases.case_key")
      .execute();

    return {
      id: attempt.id,
      attemptSeq: attempt.attempt_seq,
      status: attempt.status,
      total: attempt.total,
      passed: attempt.passed,
      failed: attempt.failed,
      failingCaseKeys: [...new Set(failing.map((row) => row.case_key))],
    };
  }

  /**
   * The attempt's physical measurements.
   *
   * @param pr - The PR, for its workspace.
   * @param attemptId - The attempt.
   * @returns Every measurement of its physical suites, by id.
   */
  private async hil(pr: GatePr, attemptId: string): Promise<HilFact[]> {
    const rows = await this.trx
      .selectFrom("hil_measurements")
      .innerJoin("test_cases", "test_cases.id", "hil_measurements.test_case_id")
      .innerJoin("test_suites", "test_suites.id", "test_cases.test_suite_id")
      .select([
        "hil_measurements.id",
        "hil_measurements.metric",
        "hil_measurements.value",
        "hil_measurements.unit",
        "hil_measurements.limit_value",
        "hil_measurements.limit_kind",
        "hil_measurements.verdict",
        "test_suites.platform",
        "test_cases.case_key",
      ])
      .where("test_suites.test_run_id", "=", attemptId)
      .where("test_suites.kind", "=", "physical")
      .where("hil_measurements.organization_id", "=", pr.organizationId)
      .orderBy("hil_measurements.id")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      metric: row.metric,
      value: String(row.value),
      unit: row.unit,
      limitValue: String(row.limit_value),
      limitKind: row.limit_kind,
      verdict: row.verdict,
      platform: row.platform,
      caseKey: row.case_key,
    }));
  }

  /** @inheritdoc */
  async upsertDefinitions(
    prId: string,
    specs: readonly GateDefinitionSpec[],
  ): Promise<StoredGateDefinition[]> {
    if (specs.length > 0) {
      await this.trx
        .insertInto("pr_gate_definitions")
        .values(
          specs.map((spec) => ({
            pr_id: prId,
            gate_key: spec.gateKey,
            source: spec.source,
            required: spec.required,
            sort_order: spec.sortOrder,
            label: spec.label,
          })),
        )
        .onConflict((conflict) =>
          conflict
            .columns(["pr_id", "gate_key"])
            .doUpdateSet((eb) => ({
              source: eb.ref("excluded.source"),
              required: eb.ref("excluded.required"),
              sort_order: eb.ref("excluded.sort_order"),
              label: eb.ref("excluded.label"),
            }))
            // Only when something moved: pr_gate_definitions_touch_updated_at is unconditional.
            .where(
              sql<boolean>`(pr_gate_definitions.source, pr_gate_definitions.required,
                pr_gate_definitions.sort_order, pr_gate_definitions.label)
                is distinct from (excluded.source, excluded.required, excluded.sort_order, excluded.label)`,
            ),
        )
        .execute();
    }

    const rows = await this.trx
      .selectFrom("pr_gate_definitions")
      .select(["id", "gate_key", "required", "source"])
      .where("pr_id", "=", prId)
      .orderBy("sort_order")
      .orderBy("gate_key")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      gateKey: row.gate_key,
      required: row.required,
      source: row.source,
    }));
  }

  /** @inheritdoc */
  async latestResults(revisionId: string): Promise<LatestResult[]> {
    const rows = await this.trx
      .selectFrom("pr_gate_results_latest")
      .select(["definition_id", "verdict", "evidence", "evidence_ref", "provider_version"])
      .where("revision_id", "=", revisionId)
      .execute();

    return rows.map((row) => ({
      definitionId: row.definition_id,
      verdict: row.verdict,
      evidence: row.evidence,
      evidenceRef: row.evidence_ref,
      providerVersion: row.provider_version,
    }));
  }

  /** @inheritdoc */
  async appendResults(revisionId: string, rows: readonly GateResultRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.trx
      .insertInto("pr_gate_results")
      .values(
        rows.map((row) => ({
          definition_id: row.definitionId,
          revision_id: revisionId,
          verdict: row.verdict,
          evidence: row.evidence,
          // An object, never an array: `pg` serialises an object parameter as JSON.
          evidence_ref: row.evidenceRef satisfies PrGateEvidenceRef | null,
          provider_version: row.providerVersion,
        })),
      )
      .execute();
  }

  /** @inheritdoc */
  async aggregate(revisionId: string): Promise<GateAggregate> {
    const { rows } = await sql<{
      required_count: number;
      green_count: number;
      red_count: number;
      satisfied_count: number;
      merge_ready: boolean;
    }>`select * from ouroboros.pr_gate_aggregate(${revisionId}::uuid)`.execute(this.trx);
    const row = rows[0];

    return {
      requiredCount: row.required_count,
      greenCount: row.green_count,
      redCount: row.red_count,
      satisfiedCount: row.satisfied_count,
      mergeReady: row.merge_ready,
    };
  }

  /** @inheritdoc */
  async setState(prId: string, state: PullRequestState): Promise<void> {
    await this.trx.updateTable("pull_requests").set({ state }).where("id", "=", prId).execute();
  }
}
