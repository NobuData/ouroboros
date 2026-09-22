/**
 * Every statement the guardrail service issues.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)). Like `ingest.repository.ts`,
 * nothing here takes an `organizationId` from a caller: this runs inside a change-set report on
 * the internal surface, and the workspace is **read off the run** — every later statement is then
 * scoped to that value, so a workflow, an issue or a rule of another workspace can never be
 * consulted for this run's verdicts.
 *
 * **Every method takes the writer it is given.** The verdicts are written inside the report's own
 * transaction (AP.1's contract, `GuardrailWriter`), and reads go through the same handle so they
 * see the change-set the report just wrote.
 */

import { Injectable } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";

import type { Database, EscalationThen, EscalationWhen } from "../db/schema";
import type { GuardrailVerdictRow } from "./guardrails.checks";

/** A connection or a transaction — always the caller's. */
export type Writer = Kysely<Database> | Transaction<Database>;

/** What the run itself says about the policy it is judged under. */
export interface RunPolicyRow {
  readonly organizationId: string;
  readonly githubRepoId: string;
  readonly issueNumber: number;
  readonly workflowTag: string;
  /** `runs.workflow_version_pin` — the `v14`, and every verdict's `policy_ref`. */
  readonly workflowVersionPin: number | null;
}

/** The run's ticket, as the checks read it. */
export interface TicketFacts {
  /** The mirrored issue's labels. */
  readonly labels: readonly string[];
  /** The latest estimate's declared files, when the issue has been estimated. */
  readonly planFiles?: readonly string[];
  /** The latest estimate's effort, when the issue has been estimated. */
  readonly effort?: string;
}

@Injectable()
export class GuardrailsRepository {
  /**
   * The run's workspace, ticket and pin.
   *
   * @param writer - The report's transaction.
   * @param run - `runs.id`.
   * @returns The row, or `undefined` when there is no such run — which the ingestion service has
   *   already refused, so this is a defence rather than a path.
   */
  async runPolicy(writer: Writer, run: string): Promise<RunPolicyRow | undefined> {
    const row = await writer
      .selectFrom("runs")
      .select([
        "organization_id",
        "github_repo_id",
        "issue_number",
        "workflow_tag",
        "workflow_version_pin",
      ])
      .where("id", "=", run)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          organizationId: row.organization_id,
          githubRepoId: row.github_repo_id,
          issueNumber: row.issue_number,
          workflowTag: row.workflow_tag,
          workflowVersionPin: row.workflow_version_pin,
        };
  }

  /**
   * The pinned version's stored document.
   *
   * @param writer - The transaction.
   * @param organizationId - The run's workspace.
   * @param tag - `workflows.slug`.
   * @param version - `workflow_versions.version`.
   * @returns The definition wrapped in its row, or `undefined` when no such published version
   *   exists — wrapped so *"no row"* and *"a row whose definition is null"* stay distinguishable.
   */
  async pinnedDefinition(
    writer: Writer,
    organizationId: string,
    tag: string,
    version: number,
  ): Promise<{ definition: unknown } | undefined> {
    return writer
      .selectFrom("workflow_versions")
      .innerJoin("workflows", "workflows.id", "workflow_versions.workflow_id")
      .select("workflow_versions.definition")
      .where("workflows.organization_id", "=", organizationId)
      .where("workflows.slug", "=", tag)
      .where("workflow_versions.version", "=", version)
      .executeTakeFirst();
  }

  /**
   * The stage keys this run has reported, most recently touched first.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @returns Distinct keys in recency order — `run_stages.updated_at` is stamped by the database
   *   on every transition, so the stage that moved last is the one that wrote the latest files.
   */
  async reportedStages(writer: Writer, run: string): Promise<string[]> {
    const rows = await writer
      .selectFrom("run_stages")
      .select("stage_key")
      .where("run_id", "=", run)
      .orderBy("updated_at", "desc")
      .orderBy("attempt", "desc")
      .execute();

    return [...new Set(rows.map((row) => row.stage_key))];
  }

  /**
   * The run's ticket: its labels, and its latest estimate's file list and effort.
   *
   * Resolved through the mirrored issue — `(github_repo_id, number)` is the issue a run was
   * opened for — and scoped to the run's workspace, so a mirror of the same repository in
   * another workspace is never read.
   *
   * @param writer - The transaction.
   * @param run - The run's policy row.
   * @returns The facts. A run whose issue is not mirrored has no labels and no plan, which the
   *   checks answer honestly (`allowed_paths` is `not_applicable`, no vote rule matches a label).
   */
  async ticketFacts(writer: Writer, run: RunPolicyRow): Promise<TicketFacts> {
    const issue = await writer
      .selectFrom("github_issues")
      .select(["id", "labels"])
      .where("organization_id", "=", run.organizationId)
      .where("github_repo_id", "=", run.githubRepoId)
      .where("number", "=", run.issueNumber)
      .executeTakeFirst();

    if (issue === undefined) {
      return { labels: [] };
    }

    const estimate = await writer
      .selectFrom("issue_estimates")
      .select(["breakdown", "effort"])
      .where("github_issue_id", "=", issue.id)
      .orderBy("version", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      labels: issue.labels,
      ...(estimate === undefined
        ? {}
        : { planFiles: estimate.breakdown.files, effort: estimate.effort }),
    };
  }

  /**
   * The workspace's enabled escalation rules.
   *
   * @param writer - The transaction.
   * @param organizationId - The run's workspace.
   * @returns Their predicates and actions, in `sort_order`.
   */
  async enabledRules(
    writer: Writer,
    organizationId: string,
  ): Promise<{ when: EscalationWhen; then: EscalationThen }[]> {
    return writer
      .selectFrom("escalation_rules")
      .select(["when", "then"])
      .where("organization_id", "=", organizationId)
      .where("enabled", "=", true)
      .orderBy("sort_order")
      .execute();
  }

  /**
   * Append one evaluation's verdicts.
   *
   * An insert and never an update: `guardrail_evaluations` is append-only to this service by
   * grant, and a re-evaluation **supersedes** through `v_run_guardrails_latest` while the earlier
   * rows stay as history.
   *
   * @param writer - The report's transaction.
   * @param run - The run.
   * @param policyRef - The pinned version the policy was read from.
   * @param verdicts - The rows, evidence already screened.
   */
  async appendVerdicts(
    writer: Writer,
    run: string,
    policyRef: number | null,
    verdicts: readonly GuardrailVerdictRow[],
  ): Promise<void> {
    await writer
      .insertInto("guardrail_evaluations")
      .values(
        verdicts.map((verdict) => ({
          run_id: run,
          check: verdict.check,
          verdict: verdict.verdict,
          // `pg` serialises an object parameter as JSON, which the `jsonb` column accepts. An
          // object, never an array — `pg` would render an array as a PostgreSQL array literal.
          evidence: verdict.evidence,
          ruleset_version: verdict.rulesetVersion,
          policy_ref: policyRef,
          change_set_seq: verdict.changeSetSeq,
        })),
      )
      .execute();
  }
}
