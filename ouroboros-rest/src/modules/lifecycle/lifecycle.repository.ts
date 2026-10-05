/**
 * Every statement the workspace lifecycle issues (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * The state itself (`workspace_lifecycle`), the `audit.*` outbox, the disconnect preview's live
 * counts, the purge's reads and its tombstone — the purge's progress record since V104 (#490). `organization` and `member` are read here and never
 * written: they are BetterAuth's rows (`LIBRARY_OWNED_TABLES`), so removing the organization goes
 * through the library — see `lifecycle.auth.ts`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Selectable, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { enqueueWebhookEvents } from "../webhooks/webhook.outbox";
import {
  SCHEMA_NAME,
  type Database,
  type WorkspaceLifecycle,
  type WorkspaceLifecycleState,
  type WorkspaceTombstonesTable,
} from "../db/schema";

/** A connection or a transaction — whatever a statement should run on. */
type Executor = Transaction<Database> | DatabaseService["db"];

/** The pull-request states a PR is still open in — everything but `merged` and `closed`. */
const OPEN_PULL_REQUEST_STATES = ["open", "verifying", "blocked", "armed"] as const;

/**
 * The tables a purge deliberately leaves rows in: the outbox's purge event and the tombstone are
 * the two records meant to outlive the workspace.
 */
const PURGE_SURVIVORS = new Set(["webhook_outbox", "workspace_tombstones"]);

/** The live state the disconnect preview is computed from. */
export interface DisconnectCounts {
  /** Pull requests still open — they stay on GitHub, untouched. */
  readonly openPullRequests: number;
  /** Runs that have not finished — they finish their stage, then hold. */
  readonly activeRuns: number;
  /** GitHub ticket sources currently syncing — they stop. */
  readonly syncingSources: number;
  /** Enabled repositories — their issues stop syncing. */
  readonly enabledRepositories: number;
  /** Whether a GitHub token is stored — it is cleared. */
  readonly tokenStored: boolean;
}

/** One move of the state, as written. */
export interface StateWrite {
  readonly organizationId: string;
  readonly state: WorkspaceLifecycleState;
  readonly changedBy: string | null;
  readonly at: Date;
  readonly purgeAfter: Date | null;
}

/** The workspace's identity, as a tombstone keeps it. */
export interface WorkspaceIdentity {
  readonly name: string;
  readonly slug: string | null;
}

/** A workspace whose recovery window has closed, or whose purge began and did not finish. */
export interface DuePurge {
  readonly organizationId: string;
  readonly requestedBy: string | null;
  readonly requestedAt: Date;
}

/** A purge's tombstone — its progress record, and its completion record once `purgedAt` is set. */
export interface PurgeRecord {
  readonly organizationId: string;
  readonly identity: WorkspaceIdentity;
  readonly requestedBy: string | null;
  readonly requestedAt: Date;
  readonly startedAt: Date;
  /** When the purge completed; null while it is in progress. */
  readonly purgedAt: Date | null;
  /** DEK versions destroyed — counted before the shred. */
  readonly dekVersionsDestroyed: number;
  readonly artifactsDeleted: number;
  readonly rowsRemaining: number;
}

/**
 * A tombstone row as a {@link PurgeRecord}.
 *
 * @param row - The row.
 * @returns The record.
 */
function recordOf(row: Selectable<WorkspaceTombstonesTable>): PurgeRecord {
  return {
    organizationId: row.organization_id,
    identity: { name: row.name, slug: row.slug },
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    purgedAt: row.purged_at,
    dekVersionsDestroyed: row.dek_versions_destroyed,
    artifactsDeleted: row.artifacts_deleted,
    rowsRemaining: row.rows_remaining,
  };
}

@Injectable()
export class LifecycleRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Run `work` in one transaction.
   *
   * @param work - The statements.
   * @returns Whatever `work` resolved to.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Lock a workspace's lifecycle row for the rest of the transaction, creating it as `active`
   * first if it has none — so two administrators pausing at once serialise on one row rather
   * than both reading "active" and both writing an audit row.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @returns The locked row.
   */
  async lock(trx: Transaction<Database>, organizationId: string): Promise<WorkspaceLifecycle> {
    await trx
      .insertInto("workspace_lifecycle")
      .values({ organization_id: organizationId, state: "active", changed_by: null })
      .onConflict((conflict) => conflict.column("organization_id").doNothing())
      .execute();

    return trx
      .selectFrom("workspace_lifecycle")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  /**
   * Write a new state onto a locked row.
   *
   * @param trx - The transaction that holds the lock.
   * @param write - The move.
   * @returns The row as stored.
   */
  async write(trx: Transaction<Database>, write: StateWrite): Promise<WorkspaceLifecycle> {
    return trx
      .updateTable("workspace_lifecycle")
      .set({
        state: write.state,
        changed_by: write.changedBy,
        changed_at: write.at,
        purge_after: write.purgeAfter,
      })
      .where("organization_id", "=", write.organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Queue one event for outbound webhook delivery — the purge's `audit.workspace.purged`, which
   * has no audit row to ride (its trail is deleted with the workspace), so it is written here.
   *
   * @param executor - Where to write it. The purge passes the transaction that completes its
   *   tombstone, so the event is queued exactly once.
   * @param organizationId - The workspace.
   * @param types - The registered types it is published as.
   * @param payload - The event's `data`.
   * @param at - When it happened.
   */
  async enqueue(
    executor: Executor,
    organizationId: string,
    types: readonly string[],
    payload: Record<string, unknown>,
    at: Date,
  ): Promise<void> {
    await enqueueWebhookEvents(executor, { organizationId, types, data: payload, occurredAt: at });
  }

  /**
   * The disconnect preview's numbers, read from live state.
   *
   * @param organizationId - The workspace.
   * @returns What the disconnect would leave, stop and clear.
   */
  async disconnectCounts(organizationId: string): Promise<DisconnectCounts> {
    const db = this.database.db;
    const [prs, runs, sources, repos, token] = await Promise.all([
      db
        .selectFrom("pull_requests")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("state", "in", OPEN_PULL_REQUEST_STATES)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("runs")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("finished_at", "is", null)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("ticket_sources")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("kind", "=", "github")
        .where("status", "=", "active")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("github_repos")
        .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("github_orgs.organization_id", "=", organizationId)
        .where("github_repos.enabled", "=", true)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("github_credentials")
        .select("organization_id")
        .where("organization_id", "=", organizationId)
        .executeTakeFirst(),
    ]);

    return {
      openPullRequests: Number(prs.count),
      activeRuns: Number(runs.count),
      syncingSources: Number(sources.count),
      enabledRepositories: Number(repos.count),
      tokenStored: token !== undefined,
    };
  }

  /**
   * Pause every active GitHub ticket source, so nothing syncs from the disconnected source.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @returns How many sources were paused.
   */
  async pauseGithubSources(trx: Transaction<Database>, organizationId: string): Promise<number> {
    const result = await trx
      .updateTable("ticket_sources")
      .set({ status: "paused", status_reason: "Disconnected from the workspace's Danger zone" })
      .where("organization_id", "=", organizationId)
      .where("kind", "=", "github")
      .where("status", "=", "active")
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  /**
   * The workspace's name and slug — what the typed confirmation is checked against and what the
   * tombstone keeps.
   *
   * @param organizationId - The workspace.
   * @returns Its identity, or `undefined` once it is gone.
   */
  async identity(organizationId: string): Promise<WorkspaceIdentity | undefined> {
    return this.database.db
      .selectFrom("organization")
      .select(["name", "slug"])
      .where("id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * The user ids holding the owner role in a workspace — whose sessions a deletion keeps.
   *
   * @param organizationId - The workspace.
   * @returns Their ids. `member.role` may be a comma-separated list (V005), so each is split.
   */
  async ownerIds(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("member")
      .select(["userId", "role"])
      .where("organizationId", "=", organizationId)
      .execute();

    return rows
      .filter((row) =>
        row.role
          .split(",")
          .map((role) => role.trim())
          .includes("owner"),
      )
      .map((row) => row.userId);
  }

  /**
   * Every purge the sweep owes: workspaces whose recovery window has closed, and every purge that
   * began and did not finish (V104, [#490](https://github.com/NobuData/ouroboros/issues/490)).
   *
   * The second half is what makes a purge resumable. Once the organization row is removed its
   * `workspace_lifecycle` row cascades away, so a purge that failed after that step would never
   * be seen again by the first half — the unfinished tombstone is how it is found.
   *
   * @param now - The instant to judge against.
   * @returns The due purges, each workspace once — unfinished purges first, then the oldest window.
   */
  async due(now: Date): Promise<DuePurge[]> {
    const db = this.database.db;
    const [unfinished, closed] = await Promise.all([
      db
        .selectFrom("workspace_tombstones")
        .select(["organization_id", "requested_by", "requested_at"])
        .where("purged_at", "is", null)
        .orderBy("started_at", "asc")
        .execute(),
      db
        .selectFrom("workspace_lifecycle")
        .select(["organization_id", "changed_by", "changed_at"])
        .where("state", "=", "pending_delete")
        .where("purge_after", "<=", now)
        .orderBy("purge_after", "asc")
        .execute(),
    ]);

    const due = new Map<string, DuePurge>();

    for (const row of unfinished) {
      due.set(row.organization_id, {
        organizationId: row.organization_id,
        requestedBy: row.requested_by,
        requestedAt: row.requested_at,
      });
    }

    for (const row of closed) {
      if (!due.has(row.organization_id)) {
        due.set(row.organization_id, {
          organizationId: row.organization_id,
          requestedBy: row.changed_by,
          requestedAt: row.changed_at,
        });
      }
    }

    return [...due.values()];
  }

  /**
   * Every stored artifact of a workspace, as `{driver, key}` refs.
   *
   * @param organizationId - The workspace.
   * @returns The refs of artifacts not yet expired (an expired one has no bytes left).
   */
  async artifactRefs(organizationId: string): Promise<unknown[]> {
    const rows = await this.database.db
      .selectFrom("test_artifacts")
      .select("storage_ref")
      .where("organization_id", "=", organizationId)
      .where("expired_at", "is", null)
      .execute();

    return rows.map((row) => row.storage_ref);
  }

  /**
   * Drop the workspace's queued outbox events — their subscribers are tenant data the purge is
   * about to delete, so nothing could receive them.
   *
   * @param organizationId - The workspace.
   */
  async clearOutbox(organizationId: string): Promise<void> {
    await this.database.db
      .deleteFrom("webhook_outbox")
      .where("organization_id", "=", organizationId)
      .execute();
  }

  /**
   * How many rows anywhere in the schema still name the workspace — the purge's assertion that
   * it left nothing behind.
   *
   * Every base table with an `organization_id` or `"organizationId"` column is counted, except
   * the two records meant to survive ({@link PURGE_SURVIVORS}). Discovered from the catalogue
   * rather than listed, so a table added next month is counted without anybody remembering to.
   *
   * @param organizationId - The workspace.
   * @returns The total, which a correct purge makes zero.
   */
  async residualRows(organizationId: string): Promise<number> {
    const db = this.database.db;
    const columns = await sql<{ table_name: string; column_name: string }>`
      select c.table_name, c.column_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = ${SCHEMA_NAME}
         and t.table_type = 'BASE TABLE'
         and c.column_name in ('organization_id', 'organizationId')
       order by c.table_name`.execute(db);

    let total = 0;

    for (const { table_name: table, column_name: column } of columns.rows) {
      if (PURGE_SURVIVORS.has(table)) continue;

      const counted = await sql<{ count: string }>`
        select count(*) as count from ${sql.id(SCHEMA_NAME, table)}
         where ${sql.id(column)} = ${organizationId}`.execute(db);

      total += Number(counted.rows[0]?.count ?? 0);
    }

    return total;
  }

  /**
   * A workspace's purge record, if a purge of it has begun.
   *
   * @param organizationId - The workspace.
   * @returns The tombstone — complete when `purgedAt` is set — or `undefined` when no purge began.
   */
  async purgeRecord(organizationId: string): Promise<PurgeRecord | undefined> {
    const row = await this.database.db
      .selectFrom("workspace_tombstones")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row === undefined ? undefined : recordOf(row);
  }

  /**
   * Whether a purge of the workspace has begun — read inside a transition's transaction, so a
   * restore and a purge's start serialise on the lifecycle row.
   *
   * @param trx - The transaction holding the workspace's lifecycle lock.
   * @param organizationId - The workspace.
   * @returns True once a tombstone exists.
   */
  async purgeBegun(trx: Transaction<Database>, organizationId: string): Promise<boolean> {
    const row = await trx
      .selectFrom("workspace_tombstones")
      .select("organization_id")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Begin a purge: write its tombstone **before anything is destroyed**.
   *
   * Under the lifecycle row's lock, and only while the workspace is still `pending_delete` with
   * its window closed — a restore that won the lock first leaves nothing to purge. The DEK
   * versions are counted here, before the shred, so a purge resumed after the keys are gone still
   * records how many there were.
   *
   * @param due - The workspace and who asked for its deletion when.
   * @param now - When the purge begins.
   * @returns The record, or `undefined` when the workspace is no longer due (restored, or gone).
   */
  async beginPurge(due: DuePurge, now: Date): Promise<PurgeRecord | undefined> {
    const { organizationId } = due;

    return this.database.transaction(async (trx) => {
      const lifecycle = await trx
        .selectFrom("workspace_lifecycle")
        .select(["state", "purge_after"])
        .where("organization_id", "=", organizationId)
        .forUpdate()
        .executeTakeFirst();

      if (
        lifecycle?.state !== "pending_delete" ||
        lifecycle.purge_after === null ||
        lifecycle.purge_after > now
      ) {
        return undefined;
      }

      const identity = await trx
        .selectFrom("organization")
        .select(["name", "slug"])
        .where("id", "=", organizationId)
        .executeTakeFirst();

      if (identity === undefined) return undefined;

      const keys = await trx
        .selectFrom("tenant_keys")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("organization_id", "=", organizationId)
        .executeTakeFirstOrThrow();

      const row = await trx
        .insertInto("workspace_tombstones")
        .values({
          organization_id: organizationId,
          name: identity.name,
          slug: identity.slug,
          requested_by: due.requestedBy,
          requested_at: due.requestedAt,
          started_at: now,
          purged_at: null,
          dek_versions_destroyed: Number(keys.count),
          artifacts_deleted: 0,
          rows_remaining: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return recordOf(row);
    });
  }

  /**
   * Record how many artifact objects a purge attempt removed.
   *
   * The larger of the stored and the new count: a resumed attempt deletes the same objects again
   * (deletion is idempotent) or, once their rows are gone, none — neither may lower the record.
   *
   * @param organizationId - The workspace.
   * @param deleted - What this attempt removed.
   */
  async recordArtifacts(organizationId: string, deleted: number): Promise<void> {
    await this.database.db
      .updateTable("workspace_tombstones")
      .set({ artifacts_deleted: sql<number>`greatest(artifacts_deleted, ${deleted})` })
      .where("organization_id", "=", organizationId)
      .where("purged_at", "is", null)
      .execute();
  }

  /**
   * Complete a purge: stamp the tombstone and queue `audit.workspace.purged`, in one transaction,
   * so the event is queued exactly once — by whichever attempt completed the record.
   *
   * @param organizationId - The workspace.
   * @param completion - When, what was left, and the event to queue.
   * @returns The completed record, or `undefined` when another attempt completed it first.
   */
  async completePurge(
    organizationId: string,
    completion: {
      readonly now: Date;
      readonly rowsRemaining: number;
      readonly event: (record: PurgeRecord) => {
        readonly types: readonly string[];
        readonly payload: Record<string, unknown>;
      };
    },
  ): Promise<PurgeRecord | undefined> {
    return this.database.transaction(async (trx) => {
      const row = await trx
        .updateTable("workspace_tombstones")
        .set({
          // Never before it started, whatever clock the sweep was handed.
          purged_at: sql<Date>`greatest(${completion.now}::timestamptz, started_at)`,
          rows_remaining: completion.rowsRemaining,
        })
        .where("organization_id", "=", organizationId)
        .where("purged_at", "is", null)
        .returningAll()
        .executeTakeFirst();

      if (row === undefined) return undefined;

      const record = recordOf(row);
      const { types, payload } = completion.event(record);

      await this.enqueue(trx, organizationId, types, payload, completion.now);

      return record;
    });
  }
}
