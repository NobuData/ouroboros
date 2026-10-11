/**
 * The suggestions' statements (CD.5, [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * `dry_run_suggestions` and `review_replay_pairs` (V114, V128), and the one draft write an Apply
 * makes — through `ouroboros.apply_draft_batch()` as the `suggestion` actor, the same function
 * the canvas, the code editor and the copilot write through (V110).
 *
 * A suggestion is a record: it is inserted `open` and only its resolution ever moves
 * (`dry_run_suggestions_transition`), so the two updates here set a status and nothing else.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  DryRun,
  DryRunConfidenceBasis,
  DryRunSuggestion,
  DryRunSuggestionSource,
  StoredDraftOperation,
  Workflow,
  WorkflowVersion,
} from "../db/schema";
import { queryOn } from "../tenancy/queries";
import type { ReplayStatistics } from "./suggestions.rules";

/** A suggestion to file. */
export interface NewSuggestion {
  readonly source: DryRunSuggestionSource;
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
  readonly title: string;
  readonly body: string;
  readonly evidence: Record<string, unknown>;
  readonly proposedOps: readonly StoredDraftOperation[];
  readonly confidence: number | null;
  readonly confidenceBasis: DryRunConfidenceBasis;
}

/** What identifies a suggestion somebody ignored — enough to not propose it again. */
export type IgnoredSuggestion = Pick<DryRunSuggestion, "rule_id" | "title" | "proposed_ops">;

/** What `apply_draft_batch()` returns. */
export interface AppliedSuggestionBatch {
  readonly draft_rev: number;
  readonly batch_id: string;
}

@Injectable()
export class DryRunSuggestionsRepository {
  /** @param database - The typed connection; its pool's lifecycle is `DatabaseService`'s. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A dry run's suggestions, as the card orders them: oldest first, and within one filing the
   * most confident first with the copilot's unscored ones last.
   *
   * @param dryRunId - The dry run.
   * @returns The suggestions.
   */
  async forRun(dryRunId: string): Promise<DryRunSuggestion[]> {
    return this.database.db
      .selectFrom("dry_run_suggestions")
      .selectAll()
      .where("dry_run_id", "=", dryRunId)
      .orderBy("created_at")
      .orderBy(sql`confidence desc nulls last`)
      .orderBy("id")
      .execute();
  }

  /**
   * One suggestion of one dry run.
   *
   * @param dryRunId - The dry run.
   * @param id - The suggestion.
   * @param trx - The transaction to read within; the row is then locked for the update.
   * @returns The row, or `undefined`.
   */
  async find(
    dryRunId: string,
    id: string,
    trx?: Transaction<Database>,
  ): Promise<DryRunSuggestion | undefined> {
    const query = queryOn(this.database, trx)
      .selectFrom("dry_run_suggestions")
      .selectAll()
      .where("dry_run_id", "=", dryRunId)
      .where("id", "=", id);

    return (trx === undefined ? query : query.forUpdate()).executeTakeFirst();
  }

  /**
   * File suggestions on a dry run, open.
   *
   * @param run - The dry run.
   * @param suggestions - What to file; an empty list writes nothing.
   * @returns The rows, in the order given.
   */
  async insert(
    run: Pick<DryRun, "id" | "organization_id">,
    suggestions: readonly NewSuggestion[],
  ): Promise<DryRunSuggestion[]> {
    if (suggestions.length === 0) return [];

    return this.database.db
      .insertInto("dry_run_suggestions")
      .values(
        suggestions.map((suggestion) => ({
          organization_id: run.organization_id,
          dry_run_id: run.id,
          source: suggestion.source,
          rule_id: suggestion.ruleId,
          rule_version: suggestion.ruleVersion,
          title: suggestion.title,
          body: suggestion.body,
          evidence: JSON.stringify(suggestion.evidence),
          proposed_ops: JSON.stringify(suggestion.proposedOps),
          confidence: suggestion.confidence,
          confidence_basis: JSON.stringify(suggestion.confidenceBasis),
        })),
      )
      .returningAll()
      .execute();
  }

  /**
   * Whether a dry run already has rule suggestions — filing is once per run.
   *
   * @param dryRunId - The dry run.
   * @returns `true` when at least one `rule` suggestion exists.
   */
  async hasRuleSuggestions(dryRunId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("dry_run_suggestions")
      .select("id")
      .where("dry_run_id", "=", dryRunId)
      .where("source", "=", "rule")
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * The rule suggestions somebody ignored on earlier dry runs of the same draft revision.
   *
   * @param run - The dry run being filed for; its workflow, base version and revision scope the
   *   read.
   * @returns What was ignored, by rule, title and operations.
   */
  async ignoredAtRevision(
    run: Pick<DryRun, "id" | "organization_id" | "workflow_id" | "base_version" | "draft_rev">,
  ): Promise<IgnoredSuggestion[]> {
    return this.database.db
      .selectFrom("dry_run_suggestions as s")
      .innerJoin("dry_runs as r", "r.id", "s.dry_run_id")
      .select(["s.rule_id", "s.title", "s.proposed_ops"])
      .where("r.organization_id", "=", run.organization_id)
      .where("r.workflow_id", "=", run.workflow_id)
      .where("r.draft_rev", "=", run.draft_rev)
      .where("r.base_version", "is not distinct from", run.base_version)
      .where("r.id", "<>", run.id)
      .where("s.source", "=", "rule")
      .where("s.status", "=", "ignored")
      .execute();
  }

  /**
   * The workflow's newest review replay, counted.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The replay set's totals, or `null` when no replay exists (CF.5, #574, records them).
   */
  async replay(organizationId: string, workflowId: string): Promise<ReplayStatistics | null> {
    const result = await sql<{
      replay_set: string;
      reviewer_stages: string[];
      pairs: string;
      style: string;
      substance: string;
    }>`
      select p.replay_set,
             (array_agg(p.reviewer_stages order by p.replayed_at desc, p.id))[1:1][1:2] as reviewer_stages,
             count(*) as pairs,
             count(*) filter (where p.disagreement_class = 'style') as style,
             count(*) filter (where p.disagreement_class = 'substance') as substance
        from ouroboros.review_replay_pairs p
       where p.organization_id = ${organizationId}
         and p.workflow_id = ${workflowId}::uuid
       group by p.replay_set
       order by max(p.replayed_at) desc, p.replay_set
       limit 1`.execute(this.database.db);

    const [row] = result.rows;
    if (row === undefined) return null;

    return {
      replaySet: row.replay_set,
      reviewerStages: row.reviewer_stages.flat(),
      pairs: Number(row.pairs),
      styleDisagreements: Number(row.style),
      substanceDisagreements: Number(row.substance),
    };
  }

  /**
   * The newest dry run of a conversation that ended with results — what a copilot suggestion
   * is about.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param sessionId - The copilot session.
   * @returns The dry run, or `undefined` when the session has none.
   */
  async latestForSession(
    organizationId: string,
    workflowId: string,
    sessionId: string,
  ): Promise<DryRun | undefined> {
    return this.database.db
      .selectFrom("dry_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("session_id", "=", sessionId)
      .where("status", "in", ["complete", "budget_stopped"])
      .orderBy("started_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * The workflow's draft, locked — the first step of an Apply.
   *
   * @param workflowId - The workflow.
   * @param trx - The transaction that will write.
   * @returns The draft row, or `undefined` when the workflow has none.
   */
  async lockDraft(
    workflowId: string,
    trx: Transaction<Database>,
  ): Promise<WorkflowVersion | undefined> {
    return trx
      .selectFrom("workflow_versions")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("version", "is", null)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * The draft row after a write.
   *
   * @param workflowId - The workflow.
   * @param trx - The transaction that wrote.
   * @returns The draft row.
   */
  async draft(workflowId: string, trx: Transaction<Database>): Promise<WorkflowVersion> {
    return trx
      .selectFrom("workflow_versions")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("version", "is", null)
      .executeTakeFirstOrThrow();
  }

  /**
   * The draft's revision counters.
   *
   * @param workflowId - The workflow.
   * @param trx - The transaction to read within.
   * @returns The version in force and the draft revision.
   */
  async revision(
    workflowId: string,
    trx: Transaction<Database>,
  ): Promise<Pick<Workflow, "current_version" | "draft_rev">> {
    return trx
      .selectFrom("workflows")
      .select(["current_version", "draft_rev"])
      .where("id", "=", workflowId)
      .executeTakeFirstOrThrow();
  }

  /**
   * Apply a suggestion's operations as one batch — `ouroboros.apply_draft_batch()` with the
   * `suggestion` actor and this suggestion's id, so the log says which callout changed the draft.
   *
   * @param run - The dry run the suggestion is of; its session, when it still exists, is the
   *   batch's.
   * @param suggestionId - The suggestion.
   * @param actorUserId - Who pressed Apply.
   * @param operations - The operations, validated against the locked draft.
   * @param trx - The transaction holding the draft lock.
   * @returns The revision the batch produced, and its id.
   */
  async applyBatch(
    run: Pick<DryRun, "organization_id" | "workflow_id" | "session_id">,
    suggestionId: string,
    actorUserId: string | null,
    operations: readonly StoredDraftOperation[],
    trx: Transaction<Database>,
  ): Promise<AppliedSuggestionBatch> {
    const result = await sql<AppliedSuggestionBatch>`
      select draft_rev, batch_id
        from ouroboros.apply_draft_batch(
          ${run.organization_id}, ${run.workflow_id}::uuid, 'suggestion', ${actorUserId},
          ${run.session_id}::uuid, ${suggestionId}::uuid,
          ${JSON.stringify(operations)}::jsonb)`.execute(trx);

    const [row] = result.rows;
    if (row === undefined) throw new Error("apply_draft_batch returned no row");
    return row;
  }

  /**
   * Settle a suggestion as applied, naming the batch its Apply produced.
   *
   * @param id - The suggestion.
   * @param batchId - The batch.
   * @param userId - Who applied it.
   * @param trx - The transaction that applied the batch.
   * @returns The suggestion, settled.
   */
  async markApplied(
    id: string,
    batchId: string,
    userId: string | null,
    trx: Transaction<Database>,
  ): Promise<DryRunSuggestion> {
    return trx
      .updateTable("dry_run_suggestions")
      .set({
        status: "applied",
        applied_op_batch_id: batchId,
        resolved_by: userId,
        resolved_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Settle an open suggestion as ignored.
   *
   * @param id - The suggestion.
   * @param userId - Who ignored it.
   * @returns The suggestion, settled — or `undefined` when it was no longer open.
   */
  async markIgnored(id: string, userId: string | null): Promise<DryRunSuggestion | undefined> {
    return this.database.db
      .updateTable("dry_run_suggestions")
      .set({ status: "ignored", resolved_by: userId, resolved_at: sql<Date>`now()` })
      .where("id", "=", id)
      .where("status", "=", "open")
      .returningAll()
      .executeTakeFirst();
  }
}
