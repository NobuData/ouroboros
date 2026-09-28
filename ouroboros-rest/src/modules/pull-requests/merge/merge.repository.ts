/**
 * Every statement the merge executor issues.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)), over V058's `pr_merge_plans`
 * ([#355](https://github.com/NobuData/ouroboros/issues/355)), V056's gate aggregate, V064's
 * `planning_epic_notes`, and V008's `runs` — the dashboard read-model whose `merged` outcome the
 * executor finalizes.
 *
 * ## The re-check's transaction holds the PR row
 *
 * The gate engine (AX.2, #358) evaluates each PR inside a transaction that locks its
 * `pull_requests` row `for update` before it appends a single verdict. {@link MergeTransaction.lock}
 * takes **the same lock**, then the plan's. So while the executor re-checks the gates, asks the
 * host and asks it to merge, no evaluation of that PR can append a verdict: one that starts waits
 * for the executor's commit and then judges a PR that has either merged or been disarmed, and one
 * that was already running finishes first and the executor reads what it wrote. That is what makes
 * *"a gate that goes red between arm and fire"* unable to slip through — there is no instant
 * between the check and the merge in which a gate can change.
 *
 * ## Writes name the person acted for
 *
 * V058's audit trigger names `armed_by` for an arm, `updated_by` for a manual disarm, and — since
 * V064 — `updated_by` for a merge. So every write acting for a person sets `updated_by` in the
 * same statement; a re-check's disarm leaves it, and the trigger writes no actor.
 *
 * ## Tenancy
 *
 * A PR is read inside the workspace asking ({@link MergeStore.pr}); everything after is keyed by
 * that PR's own rows, and a run is finalized only inside the PR's workspace.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  Database,
  PrMergePlan,
  PrMergedResult,
  PrMergeStrategy,
  PullRequestState,
} from "../../db/schema";
import { GuardrailsRepository } from "../../guardrails/guardrails.repository";
import { readPinnedPolicy } from "../../guardrails/guardrails.policy";
import { readSpendTotals, type SpendTotals } from "../../runs/run.spend";
import type { SummaryGate } from "./merge.evidence";
import type { RecheckGates, RecheckRevision } from "./merge.recheck";

/** A PR as the executor reads it. */
export interface MergePr {
  /** `pull_requests.id`. */
  readonly id: string;
  /** Its workspace. */
  readonly organizationId: string;
  /** The git-host source it lives on. */
  readonly sourceId: string;
  /** The host's number. */
  readonly number: number;
  /** Its title. */
  readonly title: string;
  /** Where it stands. */
  readonly state: PullRequestState;
  /** The loop that opened it, or null. */
  readonly runId: string | null;
  /** The canonical ticket's key — `#482` — or null. */
  readonly ticketKey: string | null;
}

/** A merge plan as the executor reads it. */
export interface StoredMergePlan {
  readonly id: string;
  readonly prId: string;
  readonly strategy: PrMergeStrategy;
  readonly deleteBranch: boolean;
  readonly commitMessage: string;
  readonly closeTicket: boolean;
  readonly commentEvidence: boolean;
  readonly backAnnotateEpic: boolean;
  readonly epicId: string | null;
  readonly armed: boolean;
  readonly armedBy: string | null;
  readonly armedAt: Date | null;
  readonly armedAgainstRevisionId: string | null;
  readonly disarmReason: string | null;
  readonly mergedResult: PrMergedResult | null;
  readonly updatedAt: Date;
}

/** A PR locked for a re-check, with its plan and latest revision. */
export interface LockedPr {
  readonly pr: MergePr;
  /** The plan, or undefined when none has been materialized. */
  readonly plan: StoredMergePlan | undefined;
  /** The latest revision, or null when none is recorded. */
  readonly latest: RecheckRevision | null;
}

/** The statements of one re-check, inside its transaction. */
export interface MergeTransaction {
  /**
   * Lock the PR row — the gate engine's lock — then its plan, and read the latest revision.
   *
   * @param organizationId - The workspace asking.
   * @param prId - The PR.
   * @returns It, or undefined when the workspace has no such PR.
   */
  lock(organizationId: string, prId: string): Promise<LockedPr | undefined>;
  /**
   * Write the PR's plan with the table's defaults if it has none, and lock it.
   *
   * @param prId - The PR.
   * @returns The plan.
   */
  materialize(prId: string): Promise<StoredMergePlan>;
  /**
   * @param prId - The PR.
   * @param revisionId - Its latest revision.
   * @returns `pr_gate_aggregate(revision)` and the labels of its red required gates.
   */
  gates(prId: string, revisionId: string): Promise<RecheckGates>;
  /**
   * @param prId - The PR.
   * @param revisionId - Its latest revision.
   * @returns Every gate of the PR with its latest verdict on the revision, in card order.
   */
  summaryGates(prId: string, revisionId: string): Promise<SummaryGate[]>;
  /**
   * Arm a plan against a revision, for a person.
   *
   * @param planId - The plan.
   * @param actorId - Who armed it.
   * @param revisionId - The revision they looked at.
   * @returns The plan.
   */
  arm(planId: string, actorId: string, revisionId: string): Promise<StoredMergePlan>;
  /**
   * Disarm a plan — by a person (`reason` null), or by a failed re-check (`actorId` null).
   *
   * @param planId - The plan.
   * @param by - Who, or why.
   * @returns The plan.
   */
  disarm(
    planId: string,
    by:
      | { readonly actorId: string; readonly reason: null }
      | { readonly actorId: null; readonly reason: string },
  ): Promise<StoredMergePlan>;
  /**
   * Record what a merge did — the plan is final afterwards.
   *
   * @param planId - The plan.
   * @param result - The sha, identity, actions and instant.
   * @param actorId - The person the merge was made for, or null when they are gone.
   * @returns The plan.
   */
  recordMerge(
    planId: string,
    result: PrMergedResult,
    actorId: string | null,
  ): Promise<StoredMergePlan>;
  /**
   * Move the PR one edge of V052's graph.
   *
   * @param prId - The PR.
   * @param state - The next state.
   */
  setPrState(prId: string, state: PullRequestState): Promise<void>;
  /**
   * Annotate the plan's epic, once per epic and PR. A refusal is thrown, and leaves the
   * transaction usable.
   *
   * @param epicId - The epic.
   * @param prId - The PR.
   * @param body - The line.
   */
  writeEpicNote(epicId: string, prId: string, body: string): Promise<void>;
  /**
   * Finalize the run that opened the PR as `merged` — the dashboard read-model's outcome.
   *
   * @param organizationId - The PR's workspace.
   * @param runId - The run.
   * @param prNumber - The PR's number, for the *Issue → PR* column.
   * @returns Whether the run moved — false when it had already finished.
   */
  finalizeRun(organizationId: string, runId: string, prNumber: number): Promise<boolean>;
  /**
   * @param runId - The run.
   * @returns What it has spent.
   */
  spend(runId: string): Promise<SpendTotals>;
}

/** The executor's store — what its unit suite stands in for. */
export interface MergeStore {
  /**
   * One PR of the workspace.
   *
   * @param organizationId - The workspace asking.
   * @param prId - The PR.
   * @returns It, or undefined.
   */
  pr(organizationId: string, prId: string): Promise<MergePr | undefined>;
  /**
   * @param prId - The PR.
   * @returns Its plan, or undefined when none is materialized.
   */
  plan(prId: string): Promise<StoredMergePlan | undefined>;
  /**
   * Whether the pinned workflow of the PR's run ends in an auto-merge terminal — the policy that
   * lets a `member` arm.
   *
   * @param pr - The PR.
   * @returns `false` for a PR without a run, or whose pin cannot be read.
   */
  autoMerges(pr: MergePr): Promise<boolean>;
  /**
   * Run one re-check in a transaction.
   *
   * @param work - What to do with it.
   * @returns What `work` returned.
   */
  transaction<T>(work: (tx: MergeTransaction) => Promise<T>): Promise<T>;
}

/** The columns a plan is read with. */
const PLAN_COLUMNS = [
  "id",
  "pr_id",
  "strategy",
  "delete_branch",
  "commit_message",
  "close_ticket",
  "comment_evidence",
  "back_annotate_epic",
  "epic_id",
  "armed",
  "armed_by",
  "armed_at",
  "armed_against_revision_id",
  "disarm_reason",
  "merged_result",
  "updated_at",
] as const;

/**
 * A plan row as the executor reads it.
 *
 * @param row - The row.
 * @returns The plan.
 */
function planOf(row: Pick<PrMergePlan, (typeof PLAN_COLUMNS)[number]>): StoredMergePlan {
  return {
    id: row.id,
    prId: row.pr_id,
    strategy: row.strategy,
    deleteBranch: row.delete_branch,
    commitMessage: row.commit_message,
    closeTicket: row.close_ticket,
    commentEvidence: row.comment_evidence,
    backAnnotateEpic: row.back_annotate_epic,
    epicId: row.epic_id,
    armed: row.armed,
    armedBy: row.armed_by,
    armedAt: row.armed_at,
    armedAgainstRevisionId: row.armed_against_revision_id,
    disarmReason: row.disarm_reason,
    mergedResult: row.merged_result,
    updatedAt: row.updated_at,
  };
}

/** The PostgreSQL {@link MergeStore}. */
@Injectable()
export class MergeRepository implements MergeStore {
  /**
   * @param database - The pool.
   * @param guardrails - AP.3's pinned-policy reads, shared with the gate engine.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly guardrails: GuardrailsRepository,
  ) {}

  /** @inheritdoc */
  pr(organizationId: string, prId: string): Promise<MergePr | undefined> {
    return readPr(this.database.db, organizationId, prId, false);
  }

  /** @inheritdoc */
  async plan(prId: string): Promise<StoredMergePlan | undefined> {
    const row = await this.database.db
      .selectFrom("pr_merge_plans")
      .select(PLAN_COLUMNS)
      .where("pr_id", "=", prId)
      .executeTakeFirst();

    return row === undefined ? undefined : planOf(row);
  }

  /** @inheritdoc */
  async autoMerges(pr: MergePr): Promise<boolean> {
    if (pr.runId === null) {
      return false;
    }

    const db = this.database.db;
    const run = await this.guardrails.runPolicy(db, pr.runId);

    if (run?.organizationId !== pr.organizationId || run.workflowVersionPin === null) {
      return false;
    }

    const pinned = await this.guardrails.pinnedDefinition(
      db,
      pr.organizationId,
      run.workflowTag,
      run.workflowVersionPin,
    );

    return pinned === undefined
      ? false
      : (readPinnedPolicy(pinned.definition)?.autoMerges ?? false);
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: MergeTransaction) => Promise<T>): Promise<T> {
    return this.database.db.transaction().execute((trx) => work(new PgMergeTransaction(trx)));
  }
}

/**
 * One PR of a workspace, with its ticket's key.
 *
 * @param reader - The pool or a transaction.
 * @param organizationId - The workspace asking.
 * @param prId - The PR.
 * @param lock - Whether to lock the PR row `for update` — the gate engine's lock.
 * @returns It, or undefined.
 */
async function readPr(
  reader: DatabaseService["db"] | Transaction<Database>,
  organizationId: string,
  prId: string,
  lock: boolean,
): Promise<MergePr | undefined> {
  const query = reader
    .selectFrom("pull_requests")
    .select([
      "id",
      "organization_id",
      "source_id",
      "external_number",
      "title",
      "state",
      "run_id",
      "ticket_id",
    ])
    .where("organization_id", "=", organizationId)
    .where("id", "=", prId);
  const pr = await (lock ? query.forUpdate() : query).executeTakeFirst();

  if (pr === undefined) {
    return undefined;
  }

  const ticket =
    pr.ticket_id === null
      ? undefined
      : await reader
          .selectFrom("tickets")
          .select("external_key")
          .where("id", "=", pr.ticket_id)
          .where("organization_id", "=", organizationId)
          .executeTakeFirst();

  return {
    id: pr.id,
    organizationId: pr.organization_id,
    sourceId: pr.source_id,
    number: pr.external_number,
    title: pr.title,
    state: pr.state,
    runId: pr.run_id,
    ticketKey: ticket?.external_key ?? null,
  };
}

/** One re-check's statements, over its transaction. */
class PgMergeTransaction implements MergeTransaction {
  /** @param trx - The transaction. */
  constructor(private readonly trx: Transaction<Database>) {}

  /** @inheritdoc */
  async lock(organizationId: string, prId: string): Promise<LockedPr | undefined> {
    const pr = await readPr(this.trx, organizationId, prId, true);

    if (pr === undefined) {
      return undefined;
    }

    const plan = await this.trx
      .selectFrom("pr_merge_plans")
      .select(PLAN_COLUMNS)
      .where("pr_id", "=", prId)
      .forUpdate()
      .executeTakeFirst();
    const latest = await this.trx
      .selectFrom("pr_revisions")
      .select(["id", "revision_seq", "head_sha"])
      .where("pr_id", "=", prId)
      .orderBy("revision_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      pr,
      plan: plan === undefined ? undefined : planOf(plan),
      latest:
        latest === undefined
          ? null
          : { id: latest.id, seq: latest.revision_seq, headSha: latest.head_sha },
    };
  }

  /** @inheritdoc */
  async materialize(prId: string): Promise<StoredMergePlan> {
    // The message is left out: the before-write trigger fills it from the template.
    await this.trx
      .insertInto("pr_merge_plans")
      .values({ pr_id: prId })
      .onConflict((conflict) => conflict.column("pr_id").doNothing())
      .execute();

    const row = await this.trx
      .selectFrom("pr_merge_plans")
      .select(PLAN_COLUMNS)
      .where("pr_id", "=", prId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    return planOf(row);
  }

  /** @inheritdoc */
  async gates(prId: string, revisionId: string): Promise<RecheckGates> {
    const { rows } = await sql<{
      required_count: number;
      satisfied_count: number;
      merge_ready: boolean;
    }>`select required_count, satisfied_count, merge_ready
         from ouroboros.pr_gate_aggregate(${revisionId}::uuid)`.execute(this.trx);
    const red = await this.trx
      .selectFrom("pr_gate_results_latest")
      .select("label")
      .where("pr_id", "=", prId)
      .where("revision_id", "=", revisionId)
      .where("required", "=", true)
      .where("verdict", "=", "red")
      .orderBy("sort_order")
      .orderBy("gate_key")
      .execute();
    const aggregate = rows[0];

    return {
      mergeReady: aggregate.merge_ready,
      red: red.map((row) => row.label),
      satisfied: aggregate.satisfied_count,
      required: aggregate.required_count,
    };
  }

  /** @inheritdoc */
  async summaryGates(prId: string, revisionId: string): Promise<SummaryGate[]> {
    const rows = await this.trx
      .selectFrom("pr_gate_definitions as d")
      .leftJoin("pr_gate_results_latest as r", (join) =>
        join.onRef("r.definition_id", "=", "d.id").on("r.revision_id", "=", revisionId),
      )
      .select(["d.label", "d.required", "r.verdict", "r.evidence"])
      .where("d.pr_id", "=", prId)
      .orderBy("d.sort_order")
      .orderBy("d.gate_key")
      .execute();

    return rows.map((row) => ({
      label: row.label,
      required: row.required,
      verdict: row.verdict,
      evidence: row.evidence,
    }));
  }

  /** @inheritdoc */
  async arm(planId: string, actorId: string, revisionId: string): Promise<StoredMergePlan> {
    const row = await this.trx
      .updateTable("pr_merge_plans")
      .set({
        armed: true,
        armed_by: actorId,
        armed_at: sql<Date>`now()`,
        armed_against_revision_id: revisionId,
        disarm_reason: null,
        updated_by: actorId,
      })
      .where("id", "=", planId)
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();

    return planOf(row);
  }

  /** @inheritdoc */
  async disarm(
    planId: string,
    by:
      | { readonly actorId: string; readonly reason: null }
      | { readonly actorId: null; readonly reason: string },
  ): Promise<StoredMergePlan> {
    const row = await this.trx
      .updateTable("pr_merge_plans")
      .set({
        armed: false,
        armed_by: null,
        armed_at: null,
        armed_against_revision_id: null,
        disarm_reason: by.reason,
        // A re-check is not a person: the trigger writes no actor, and updated_by is left alone.
        ...(by.actorId === null ? {} : { updated_by: by.actorId }),
      })
      .where("id", "=", planId)
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();

    return planOf(row);
  }

  /** @inheritdoc */
  async recordMerge(
    planId: string,
    result: PrMergedResult,
    actorId: string | null,
  ): Promise<StoredMergePlan> {
    const row = await this.trx
      .updateTable("pr_merge_plans")
      .set({
        armed: false,
        armed_by: null,
        armed_at: null,
        armed_against_revision_id: null,
        disarm_reason: null,
        // An object, never an array: `pg` serialises an object parameter as JSON.
        merged_result: result,
        updated_by: actorId,
      })
      .where("id", "=", planId)
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();

    return planOf(row);
  }

  /** @inheritdoc */
  async setPrState(prId: string, state: PullRequestState): Promise<void> {
    await this.trx.updateTable("pull_requests").set({ state }).where("id", "=", prId).execute();
  }

  /**
   * @inheritdoc
   *
   * Under a savepoint: a refused note must not abort the transaction the merge is recorded in.
   */
  async writeEpicNote(epicId: string, prId: string, body: string): Promise<void> {
    await sql`savepoint epic_note`.execute(this.trx);

    try {
      await this.trx
        .insertInto("planning_epic_notes")
        .values({ epic_id: epicId, pr_id: prId, body })
        .onConflict((conflict) => conflict.columns(["epic_id", "pr_id", "kind"]).doNothing())
        .execute();
    } catch (error) {
      await sql`rollback to savepoint epic_note`.execute(this.trx);
      throw error;
    }

    await sql`release savepoint epic_note`.execute(this.trx);
  }

  /** @inheritdoc */
  async finalizeRun(organizationId: string, runId: string, prNumber: number): Promise<boolean> {
    const result = await this.trx
      .updateTable("runs")
      .set({ status: "merged", finished_at: sql<Date>`now()`, pr_number: prNumber })
      .where("id", "=", runId)
      .where("organization_id", "=", organizationId)
      // A run that already finished keeps its outcome.
      .where("finished_at", "is", null)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /** @inheritdoc */
  spend(runId: string): Promise<SpendTotals> {
    return readSpendTotals(this.trx, runId);
  }
}
