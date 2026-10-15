/**
 * The statements live-run admission reads and the one it writes (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * **The workspace is a parameter of every statement.** A reason must never be computed from
 * another workspace's rows; `admission.repository.spec.ts` compiles each statement and asserts
 * the predicate.
 *
 * Every read takes a {@link Writer} so the claim can ask inside its own transaction — after
 * {@link AdmissionRepository.lockClaims} — and see what the lock protects.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { ACTIVE_RUN_STATUSES, type Database, type QueueItem } from "../db/schema";

/** A connection or a transaction. */
export type Writer = Kysely<Database> | Transaction<Database>;

@Injectable()
export class AdmissionRepository {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** The pool, for reads outside a claim. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Serialize claims within one workspace until the transaction ends, so two engine workers
   * cannot both see the last free slot under the ceiling. Other workspaces are not held.
   *
   * @param writer - The claim's transaction.
   * @param organizationId - The workspace.
   */
  async lockClaims(writer: Transaction<Database>, organizationId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${`live-claim:${organizationId}`}))`.execute(
      writer,
    );
  }

  /**
   * The workspace's live-run ceiling, as it set it — 1 when it never did.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @returns `workspace_settings_effective.live_run_ceiling`.
   */
  async ceiling(writer: Writer, organizationId: string): Promise<number> {
    const row = await writer
      .selectFrom("workspace_settings_effective")
      .select("live_run_ceiling")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row?.live_run_ceiling ?? 1;
  }

  /**
   * Set the workspace's live-run ceiling.
   *
   * @param organizationId - The workspace.
   * @param ceiling - The new ceiling, already checked against the deployment's maximum.
   * @param userId - Who changed it.
   */
  async saveCeiling(organizationId: string, ceiling: number, userId: string): Promise<void> {
    await this.database.db
      .insertInto("workspace_settings")
      .values({ organization_id: organizationId, live_run_ceiling: ceiling, updated_by: userId })
      .onConflict((conflict) =>
        conflict
          .column("organization_id")
          .doUpdateSet({ live_run_ceiling: ceiling, updated_by: userId }),
      )
      .execute();
  }

  /**
   * How many live-run slots are taken: live runs still executing, plus items leased to a worker
   * whose lease has not run out — each of those is about to become a run.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @param now - The instant a lease is judged against.
   * @returns The count.
   */
  async liveSlotsTaken(writer: Writer, organizationId: string, now: Date): Promise<number> {
    const [runs, leases] = await Promise.all([
      writer
        .selectFrom("runs")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", organizationId)
        .where("origin", "=", "live")
        .where("finished_at", "is", null)
        .where("status", "in", ACTIVE_RUN_STATUSES)
        .executeTakeFirstOrThrow(),
      writer
        .selectFrom("queue_items")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", organizationId)
        .where("claim_expires_at", ">", now)
        .executeTakeFirstOrThrow(),
    ]);

    return Number(runs.n) + Number(leases.n);
  }

  /**
   * Whether each repository is enabled — only those of this workspace are answered.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @param repositoryIds - `github_repos.id` values.
   * @returns `enabled` by id; an id of another workspace, or none, is absent.
   */
  async repositoriesEnabled(
    writer: Writer,
    organizationId: string,
    repositoryIds: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>> {
    if (repositoryIds.length === 0) {
      return new Map();
    }

    const rows = await writer
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["github_repos.id", "github_repos.enabled"])
      .where("github_orgs.organization_id", "=", organizationId)
      .where("github_repos.id", "in", [...repositoryIds])
      .execute();

    return new Map(rows.map((row) => [row.id, row.enabled]));
  }

  /**
   * A pinned workflow version's stored definition.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @param tag - The workflow's slug.
   * @param version - The published version.
   * @returns The definition wrapped in its row, or `undefined` when no such version exists.
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
   * The queue items nobody holds, in queue order, locked for the claim — `skip locked`, so a
   * second worker passes over what the first is judging.
   *
   * @param writer - The claim's transaction.
   * @param organizationId - The workspace.
   * @param now - The instant a lease is judged against.
   * @param limit - How many to judge at most.
   * @returns The candidates, head first.
   */
  async claimableCandidates(
    writer: Transaction<Database>,
    organizationId: string,
    now: Date,
    limit: number,
  ): Promise<QueueItem[]> {
    return writer
      .selectFrom("queue_items")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where((eb) => eb.or([eb("claim_expires_at", "is", null), eb("claim_expires_at", "<=", now)]))
      .orderBy("position")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
  }

  /**
   * Confirm a queue item for a live run. Idempotent: an item already confirmed keeps its first
   * confirmation.
   *
   * @param organizationId - The workspace.
   * @param itemId - `queue_items.id`.
   * @param userId - Who confirmed.
   * @param now - When.
   * @returns The item and whether this call confirmed it, or `undefined` when this workspace
   *   has no such item.
   */
  async confirm(
    organizationId: string,
    itemId: string,
    userId: string,
    now: Date,
  ): Promise<{ item: QueueItem; changed: boolean } | undefined> {
    const confirmed = await this.database.db
      .updateTable("queue_items")
      .set({ confirmed_at: now, confirmed_by: userId })
      .where("organization_id", "=", organizationId)
      .where("id", "=", itemId)
      .where("confirmed_at", "is", null)
      .returningAll()
      .executeTakeFirst();

    if (confirmed !== undefined) {
      return { item: confirmed, changed: true };
    }

    const existing = await this.database.db
      .selectFrom("queue_items")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", itemId)
      .executeTakeFirst();

    return existing === undefined ? undefined : { item: existing, changed: false };
  }
}
