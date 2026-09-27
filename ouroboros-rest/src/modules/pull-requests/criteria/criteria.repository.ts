/**
 * Every statement the criteria & evidence service issues — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)) over V057's `pr_criteria` and
 * `pr_criteria_evidence` and V055/V062's `pr_waivers`.
 *
 * **Tenancy enters through the PR.** V057's tables carry no `organization_id` (V052's reason), so
 * {@link CriteriaRepository.pr} is the one read scoped by workspace, and every later statement is
 * scoped by the PR or criterion that read returned.
 *
 * **Evidence resolves in the PR's run, not just its workspace.** V057 holds a reference to the
 * PR's workspace; the lookups here hold a test case, a measurement and an artifact to an attempt
 * of the loop that opened the PR — a passing test of some other run shows nothing about this one.
 */

import { Injectable } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  Database,
  HilLimitKind,
  PrCriterion,
  PrCriterionEvidence,
  PrCriterionSource,
  PrCriterionStatus,
  PrRevisionFile,
  NewPrCriterionEvidence,
  PrWaiver,
  TestCaseStatus,
} from "../../db/schema";

/** The fields of a PR the service needs. */
export interface CriteriaPrRow {
  readonly id: string;
  readonly organization_id: string;
  readonly source_id: string;
  readonly external_number: number;
  /** The loop that opened it — null for a PR no loop opened. */
  readonly run_id: string | null;
  readonly ticket_id: string | null;
}

/** A test case a key resolved to, with the attempt it was in. */
export interface ResolvedCase {
  readonly id: string;
  readonly name: string;
  readonly status: TestCaseStatus;
  readonly test_run_id: string;
  readonly attempt_seq: number;
}

/** A HIL measurement, with what its line needs. */
export interface ResolvedMeasurement {
  readonly id: string;
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly limit_value: string;
  readonly limit_kind: HilLimitKind;
  readonly context: string | null;
}

/** An uploaded artifact, with what its line needs. */
export interface ResolvedArtifact {
  readonly id: string;
  readonly name: string;
  readonly expired_at: Date | null;
}

/** A revision of the PR, with its files snapshot. */
export interface ResolvedRevision {
  readonly id: string;
  readonly revision_seq: number;
  readonly files: PrRevisionFile[];
}

/** A plan draft pushed as the PR's ticket. */
export interface PlanDraftRow {
  readonly id: string;
  readonly body: string;
}

/** A new criterion. */
export interface NewCriterionRow {
  readonly claim: string;
  readonly source: PrCriterionSource;
  readonly createdBy: string;
}

/** What {@link CriteriaRepository.waive} wrote. */
export interface WaiveWrite {
  readonly criterion: PrCriterion;
  readonly waiver: PrWaiver;
  /** The status the criterion left. */
  readonly previous: PrCriterionStatus;
}

@Injectable()
export class CriteriaRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /** The connection. */
  private get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * A PR of the workspace.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The row, or undefined for a PR that is absent or another workspace's.
   */
  pr(organizationId: string, prId: string): Promise<CriteriaPrRow | undefined> {
    return this.db
      .selectFrom("pull_requests")
      .select(["id", "organization_id", "source_id", "external_number", "run_id", "ticket_id"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", prId)
      .executeTakeFirst();
  }

  /**
   * A PR's criteria, in the matrix's order: `sort_order`, then `created_at`, then id.
   *
   * @param prId - The PR.
   * @returns The rows.
   */
  criteria(prId: string): Promise<PrCriterion[]> {
    return this.db
      .selectFrom("pr_criteria")
      .selectAll()
      .where("pr_id", "=", prId)
      .orderBy("sort_order")
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  /**
   * One criterion of a PR.
   *
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @returns The row, or undefined when it is not this PR's.
   */
  criterion(prId: string, criterionId: string): Promise<PrCriterion | undefined> {
    return this.db
      .selectFrom("pr_criteria")
      .selectAll()
      .where("pr_id", "=", prId)
      .where("id", "=", criterionId)
      .executeTakeFirst();
  }

  /**
   * The evidence of some criteria, oldest first.
   *
   * @param criterionIds - The criteria.
   * @returns The rows; none for an empty list.
   */
  async evidence(criterionIds: readonly string[]): Promise<PrCriterionEvidence[]> {
    if (criterionIds.length === 0) {
      return [];
    }

    return this.db
      .selectFrom("pr_criteria_evidence")
      .selectAll()
      .where("criterion_id", "in", criterionIds)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  /**
   * Some waivers, by id.
   *
   * @param waiverIds - The waivers.
   * @returns The rows; none for an empty list.
   */
  async waivers(waiverIds: readonly string[]): Promise<PrWaiver[]> {
    if (waiverIds.length === 0) {
      return [];
    }

    return this.db.selectFrom("pr_waivers").selectAll().where("id", "in", waiverIds).execute();
  }

  /**
   * Append criteria after the PR's last row, in the order given.
   *
   * @param prId - The PR.
   * @param rows - The claims.
   * @returns The rows written, in that order.
   */
  insertCriteria(prId: string, rows: readonly NewCriterionRow[]): Promise<PrCriterion[]> {
    return this.db.transaction().execute(async (trx) => {
      // Serialise appends to one PR, so two imports cannot both take the same next position.
      await trx
        .selectFrom("pull_requests")
        .select("id")
        .where("id", "=", prId)
        .forUpdate()
        .executeTakeFirst();

      const last = await trx
        .selectFrom("pr_criteria")
        .select(({ fn }) => fn.max<number | null>("sort_order").as("max"))
        .where("pr_id", "=", prId)
        .executeTakeFirst();
      const next = (last?.max ?? -1) + 1;

      const written = await trx
        .insertInto("pr_criteria")
        .values(
          rows.map((row, index) => ({
            pr_id: prId,
            claim: row.claim,
            source: row.source,
            created_by: row.createdBy,
            sort_order: next + index,
          })),
        )
        .returningAll()
        .execute();

      return written.sort((a, b) => a.sort_order - b.sort_order);
    });
  }

  /**
   * Reword a criterion.
   *
   * @param criterionId - The criterion.
   * @param claim - The new wording.
   * @returns The row.
   */
  updateClaim(criterionId: string, claim: string): Promise<PrCriterion> {
    return this.db
      .updateTable("pr_criteria")
      .set({ claim })
      .where("id", "=", criterionId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Delete a criterion; its evidence cascades, its waiver stays (V055 is append-only).
   *
   * @param criterionId - The criterion.
   */
  async deleteCriterion(criterionId: string): Promise<void> {
    await this.db.deleteFrom("pr_criteria").where("id", "=", criterionId).execute();
  }

  /**
   * Put a PR's criteria in the order given, as one transaction.
   *
   * @param prId - The PR.
   * @param criterionIds - Every criterion of the PR, each once — the service has checked.
   */
  async reorder(prId: string, criterionIds: readonly string[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      for (const [index, id] of criterionIds.entries()) {
        await trx
          .updateTable("pr_criteria")
          .set({ sort_order: index })
          .where("pr_id", "=", prId)
          .where("id", "=", id)
          .execute();
      }
    });
  }

  /**
   * A test case of the run, by its durable key — in the attempt given, or the latest that has it.
   *
   * @param organizationId - The workspace.
   * @param runId - The PR's run.
   * @param caseKey - `test_cases.case_key`.
   * @param testRunId - The attempt, or null for the latest.
   * @returns The case, or undefined when no attempt of the run has it.
   */
  caseByKey(
    organizationId: string,
    runId: string,
    caseKey: string,
    testRunId: string | null,
  ): Promise<ResolvedCase | undefined> {
    let query = this.db
      .selectFrom("test_cases as c")
      .innerJoin("test_suites as s", "s.id", "c.test_suite_id")
      .innerJoin("test_runs as t", "t.id", "s.test_run_id")
      .select(["c.id", "c.name", "c.status", "t.id as test_run_id", "t.attempt_seq"])
      .where("c.organization_id", "=", organizationId)
      .where("t.run_id", "=", runId)
      .where("c.case_key", "=", caseKey);

    if (testRunId !== null) {
      query = query.where("t.id", "=", testRunId);
    }

    return query.orderBy("t.attempt_seq", "desc").orderBy("c.id").limit(1).executeTakeFirst();
  }

  /**
   * A HIL measurement of one of the run's cases.
   *
   * @param organizationId - The workspace.
   * @param runId - The PR's run.
   * @param measurementId - The measurement.
   * @returns The row, or undefined when it is not a measurement of the run.
   */
  measurement(
    organizationId: string,
    runId: string,
    measurementId: string,
  ): Promise<ResolvedMeasurement | undefined> {
    return this.db
      .selectFrom("hil_measurements as m")
      .innerJoin("test_cases as c", "c.id", "m.test_case_id")
      .innerJoin("test_suites as s", "s.id", "c.test_suite_id")
      .innerJoin("test_runs as t", "t.id", "s.test_run_id")
      .select([
        "m.id",
        "m.metric",
        "m.value",
        "m.unit",
        "m.limit_value",
        "m.limit_kind",
        "m.context",
      ])
      .where("m.organization_id", "=", organizationId)
      .where("t.run_id", "=", runId)
      .where("m.id", "=", measurementId)
      .executeTakeFirst();
  }

  /**
   * A file one of the run's attempts uploaded.
   *
   * @param organizationId - The workspace.
   * @param runId - The PR's run.
   * @param artifactId - The artifact.
   * @returns The row, or undefined when it is not one of the run's.
   */
  artifact(
    organizationId: string,
    runId: string,
    artifactId: string,
  ): Promise<ResolvedArtifact | undefined> {
    return this.db
      .selectFrom("test_artifacts as a")
      .innerJoin("test_runs as t", "t.id", "a.test_run_id")
      .select(["a.id", "a.name", "a.expired_at"])
      .where("a.organization_id", "=", organizationId)
      .where("t.run_id", "=", runId)
      .where("a.id", "=", artifactId)
      .executeTakeFirst();
  }

  /**
   * A revision of the PR — the one given, or the latest.
   *
   * @param prId - The PR.
   * @param revisionId - The revision, or null for the latest.
   * @returns The revision, or undefined when it is not the PR's or the PR has none.
   */
  revision(prId: string, revisionId: string | null): Promise<ResolvedRevision | undefined> {
    let query = this.db
      .selectFrom("pr_revisions")
      .select(["id", "revision_seq", "files"])
      .where("pr_id", "=", prId);

    if (revisionId !== null) {
      query = query.where("id", "=", revisionId);
    }

    return query.orderBy("revision_seq", "desc").limit(1).executeTakeFirst();
  }

  /**
   * Cite evidence. V057's foreign keys and `pr_criteria_evidence_resolves` check it again.
   *
   * @param row - The typed reference and its line.
   * @returns The row.
   */
  insertEvidence(row: NewPrCriterionEvidence): Promise<PrCriterionEvidence> {
    return this.db
      .insertInto("pr_criteria_evidence")
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Remove a citation. V057 demotes a verified criterion whose last evidence goes.
   *
   * @param criterionId - The criterion.
   * @param evidenceId - The evidence.
   * @returns Whether a row was removed.
   */
  async deleteEvidence(criterionId: string, evidenceId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("pr_criteria_evidence")
      .where("criterion_id", "=", criterionId)
      .where("id", "=", evidenceId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Move a criterion between `unverified` and `verified`, only from the status the service read.
   *
   * @param criterionId - The criterion.
   * @param from - The status it must still be in.
   * @param to - The status to set.
   * @returns The row, or undefined when it moved in between.
   */
  setStatus(
    criterionId: string,
    from: PrCriterionStatus,
    to: "verified" | "unverified",
  ): Promise<PrCriterion | undefined> {
    return this.db
      .updateTable("pr_criteria")
      .set({ status: to })
      .where("id", "=", criterionId)
      .where("status", "=", from)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * The body of the newest plan draft pushed as a ticket — AL.1's planning context (#277).
   *
   * @param organizationId - The workspace.
   * @param ticketId - The PR's ticket.
   * @returns The draft, or undefined when none was pushed as it or it has no body.
   */
  async planDraft(organizationId: string, ticketId: string): Promise<PlanDraftRow | undefined> {
    const row = await this.db
      .selectFrom("ticket_drafts as d")
      .innerJoin("draft_batches as b", "b.id", "d.batch_id")
      .select(["d.id", "d.body"])
      .where("b.organization_id", "=", organizationId)
      .where("d.pushed_ticket_id", "=", ticketId)
      .where("d.body", "is not", null)
      .orderBy("d.updated_at", "desc")
      .orderBy("d.id")
      .limit(1)
      .executeTakeFirst();

    return row === undefined || row.body === null ? undefined : { id: row.id, body: row.body };
  }

  /**
   * Waive a criterion: the AS.4 waiver and the criterion's status, as one transaction with the
   * criterion locked, so two waives of one criterion cannot interleave.
   *
   * @param organizationId - The workspace.
   * @param runId - The PR's run — the waiver's.
   * @param criterionId - The criterion.
   * @param author - Who waived.
   * @param reason - Why.
   * @returns The criterion, the waiver, and the status the criterion left.
   */
  waive(
    organizationId: string,
    runId: string,
    criterionId: string,
    author: string,
    reason: string,
  ): Promise<WaiveWrite> {
    return this.db.transaction().execute(async (trx: Transaction<Database>) => {
      const before = await trx
        .selectFrom("pr_criteria")
        .select("status")
        .where("id", "=", criterionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const waiver = await trx
        .insertInto("pr_waivers")
        .values({ organization_id: organizationId, run_id: runId, author, reason, case_keys: [] })
        .returningAll()
        .executeTakeFirstOrThrow();
      const criterion = await trx
        .updateTable("pr_criteria")
        .set({ status: "waived", waiver_ref: waiver.id })
        .where("id", "=", criterionId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { criterion, waiver, previous: before.status };
    });
  }

  /**
   * Record where the annotation landed (V062).
   *
   * @param waiverId - The waiver.
   * @param commentId - The host's comment id.
   * @param url - The comment's page, or null.
   * @param at - When it was posted.
   * @returns The waiver.
   */
  markAnnotated(
    waiverId: string,
    commentId: string,
    url: string | null,
    at: Date,
  ): Promise<PrWaiver> {
    return this.db
      .updateTable("pr_waivers")
      .set({
        annotation_state: "annotated",
        annotation_comment_id: commentId,
        annotation_url: url,
        annotated_at: at,
      })
      .where("id", "=", waiverId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record that the host refused the annotation (V062) — so the matrix can say it is missing.
   *
   * @param waiverId - The waiver.
   * @returns The waiver.
   */
  markAnnotationFailed(waiverId: string): Promise<PrWaiver> {
    return this.db
      .updateTable("pr_waivers")
      .set({ annotation_state: "failed" })
      .where("id", "=", waiverId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
