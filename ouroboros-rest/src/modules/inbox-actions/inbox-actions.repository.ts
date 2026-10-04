/**
 * Every statement the action executor issues (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462)).
 *
 * Three groups:
 *
 * ```
 * the item          read (tenant-scoped) · lock for update · the resolution that won
 * the attempt       by key · the running one · insert (running) · finish (succeeded | failed)
 * the answer        insert the V095 resolution — its trigger closes the item and computes the spans
 * plane reads       the few facts a handler needs that no plane service hands out
 * ```
 *
 * Every read of an item takes the workspace, so an id from another workspace is simply not found.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  DecisionActionAttemptStatus,
  DecisionChannel,
  DecisionItemStatus,
} from "../db/schema";

/** A connection or a transaction. */
export type ActionExecutor = Kysely<Database> | Transaction<Database>;

/** An item, as the executor reads it. */
export interface ActionItem {
  readonly id: string;
  readonly organizationId: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly status: DecisionItemStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: unknown;
  readonly sourceRef: string;
}

/** A person, as a receipt or a refusal names them. */
export interface ActionPerson {
  readonly id: string;
  readonly name: string;
}

/** One attempt, as the executor reads it back. */
export interface ActionAttempt {
  readonly id: string;
  readonly actionId: string;
  readonly actorId: string | null;
  readonly actor: ActionPerson | null;
  readonly channel: DecisionChannel;
  readonly idempotencyKey: string;
  readonly status: DecisionActionAttemptStatus;
  readonly outcome: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null;
  readonly startedAt: Date;
}

/** An item's resolution, as a receipt or a 409 shows it. */
export interface ActionResolution {
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actor: ActionPerson | null;
  readonly channel: DecisionChannel;
  readonly note: string | null;
  readonly outcome: Record<string, unknown>;
  readonly resolvedAt: Date;
}

/** A new attempt. */
export interface NewActionAttempt {
  readonly organizationId: string;
  readonly itemId: string;
  readonly actionId: string;
  readonly actorId: string;
  readonly channel: DecisionChannel;
  readonly idempotencyKey: string;
}

/** Why an attempt failed. */
export interface ActionFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

/** A new human resolution. */
export interface NewHumanResolution {
  readonly itemId: string;
  readonly organizationId: string;
  readonly actionId: string;
  readonly userId: string;
  readonly channel: DecisionChannel;
  readonly note: string | null;
  readonly outcome: Readonly<Record<string, unknown>>;
}

/** The attempt columns, with the presser's name. */
const ATTEMPT_COLUMNS = [
  "attempt.id",
  "attempt.action_id",
  "attempt.actor_id",
  "attempt.channel",
  "attempt.idempotency_key",
  "attempt.status",
  "attempt.outcome",
  "attempt.error_code",
  "attempt.error_message",
  "attempt.error_status",
  "attempt.started_at",
  "person.name as actor_name",
] as const;

/**
 * An attempt row as {@link ActionAttempt}.
 *
 * @param row - The selected row.
 * @returns The attempt.
 */
function attemptOf(row: {
  id: string;
  action_id: string;
  actor_id: string | null;
  channel: DecisionChannel;
  idempotency_key: string;
  status: DecisionActionAttemptStatus;
  outcome: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  error_status: number | null;
  started_at: Date;
  actor_name: string | null;
}): ActionAttempt {
  return {
    id: row.id,
    actionId: row.action_id,
    actorId: row.actor_id,
    actor:
      row.actor_id === null || row.actor_name === null
        ? null
        : { id: row.actor_id, name: row.actor_name },
    channel: row.channel,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    outcome: row.outcome,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorStatus: row.error_status,
    startedAt: row.started_at,
  };
}

@Injectable()
export class InboxActionsRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /** The pool, for a handler's own reads. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Run work in one transaction.
   *
   * @param work - The statements.
   * @returns What the work returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * One item of the workspace, optionally locked.
   *
   * @param executor - The connection or transaction.
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @param lock - Whether to take its row lock (the claim serialises on it).
   * @returns The item, or `undefined` when the workspace has no such item.
   */
  async item(
    executor: ActionExecutor,
    organizationId: string,
    itemId: string,
    lock = false,
  ): Promise<ActionItem | undefined> {
    let query = executor
      .selectFrom("decision_items")
      .select([
        "id",
        "organization_id",
        "kind_id",
        "kind_version",
        "status",
        "payload",
        "refs",
        "source_ref",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", itemId);

    if (lock) {
      query = query.forUpdate();
    }

    const row = await query.executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          kindId: row.kind_id,
          kindVersion: row.kind_version,
          status: row.status,
          payload: row.payload,
          refs: row.refs,
          sourceRef: row.source_ref,
        };
  }

  /**
   * The item's resolution, with the person who answered.
   *
   * @param executor - The connection or transaction.
   * @param itemId - The item.
   * @returns The resolution, or `undefined` when it has none.
   */
  async resolution(
    executor: ActionExecutor,
    itemId: string,
  ): Promise<ActionResolution | undefined> {
    const row = await executor
      .selectFrom("decision_resolutions as resolution")
      .leftJoin("user as person", "person.id", "resolution.resolved_by_user")
      .select([
        "resolution.action_id",
        "resolution.resolver",
        "resolution.resolved_by_user",
        "resolution.resolved_by_policy",
        "resolution.channel",
        "resolution.note",
        "resolution.outcome",
        "resolution.resolved_at",
        "person.name as person_name",
      ])
      .where("resolution.item_id", "=", itemId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          actionId: row.action_id,
          resolver: row.resolver,
          policy: row.resolved_by_policy,
          actor:
            row.resolved_by_user === null || row.person_name === null
              ? null
              : { id: row.resolved_by_user, name: row.person_name },
          channel: row.channel,
          note: row.note,
          outcome: row.outcome,
          resolvedAt: row.resolved_at,
        };
  }

  /**
   * The attempt filed under an idempotency key.
   *
   * @param executor - The connection or transaction.
   * @param itemId - The item.
   * @param key - The key.
   * @returns The attempt, or `undefined`.
   */
  async attemptByKey(
    executor: ActionExecutor,
    itemId: string,
    key: string,
  ): Promise<ActionAttempt | undefined> {
    const row = await executor
      .selectFrom("decision_action_attempts as attempt")
      .leftJoin("user as person", "person.id", "attempt.actor_id")
      .select(ATTEMPT_COLUMNS)
      .where("attempt.item_id", "=", itemId)
      .where("attempt.idempotency_key", "=", key)
      .executeTakeFirst();

    return row === undefined ? undefined : attemptOf(row);
  }

  /**
   * The item's running attempt — at most one (`decision_action_attempts_one_running`).
   *
   * @param executor - The connection or transaction.
   * @param itemId - The item.
   * @returns The attempt, or `undefined`.
   */
  async runningAttempt(
    executor: ActionExecutor,
    itemId: string,
  ): Promise<ActionAttempt | undefined> {
    const row = await executor
      .selectFrom("decision_action_attempts as attempt")
      .leftJoin("user as person", "person.id", "attempt.actor_id")
      .select(ATTEMPT_COLUMNS)
      .where("attempt.item_id", "=", itemId)
      .where("attempt.status", "=", "running")
      .executeTakeFirst();

    return row === undefined ? undefined : attemptOf(row);
  }

  /**
   * Record a press, running.
   *
   * @param executor - The claim's transaction.
   * @param attempt - Who pressed what, under which key.
   * @returns The new attempt's id.
   */
  async insertAttempt(executor: ActionExecutor, attempt: NewActionAttempt): Promise<string> {
    const row = await executor
      .insertInto("decision_action_attempts")
      .values({
        organization_id: attempt.organizationId,
        item_id: attempt.itemId,
        action_id: attempt.actionId,
        actor_id: attempt.actorId,
        channel: attempt.channel,
        idempotency_key: attempt.idempotencyKey,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Finish an attempt as succeeded, with its receipt.
   *
   * @param executor - The answer's transaction.
   * @param attemptId - The attempt.
   * @param outcome - What the handler did.
   */
  async succeed(
    executor: ActionExecutor,
    attemptId: string,
    outcome: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await executor
      .updateTable("decision_action_attempts")
      .set({ status: "succeeded", outcome: JSON.stringify(outcome), finished_at: sql`now()` })
      .where("id", "=", attemptId)
      .where("status", "=", "running")
      .execute();
  }

  /**
   * Finish an attempt as failed. The item stays open.
   *
   * @param executor - The connection.
   * @param attemptId - The attempt.
   * @param failure - The plane's code, sentence and HTTP status.
   */
  async fail(executor: ActionExecutor, attemptId: string, failure: ActionFailure): Promise<void> {
    await executor
      .updateTable("decision_action_attempts")
      .set({
        status: "failed",
        error_code: failure.code,
        error_message: failure.message.slice(0, 2000),
        error_status: failure.status,
        finished_at: sql`now()`,
      })
      .where("id", "=", attemptId)
      .where("status", "=", "running")
      .execute();
  }

  /**
   * Write a person's answer. V095's triggers check the action against the pinned kind, compute
   * both spans and close the item.
   *
   * @param executor - The answer's transaction.
   * @param resolution - The answer.
   */
  async insertResolution(executor: ActionExecutor, resolution: NewHumanResolution): Promise<void> {
    await executor
      .insertInto("decision_resolutions")
      .values({
        item_id: resolution.itemId,
        organization_id: resolution.organizationId,
        action_id: resolution.actionId,
        resolver: "human",
        resolved_by_user: resolution.userId,
        resolved_by_policy: null,
        channel: resolution.channel,
        note: resolution.note,
        outcome: JSON.stringify(resolution.outcome),
      })
      .execute();
  }

  /**
   * A PR's latest revision, ticket and its source — what Approve & merge and Require bench upgrade
   * read.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The facts, or `undefined` when the workspace has no such PR.
   */
  async pullRequest(
    organizationId: string,
    prId: string,
  ): Promise<
    | {
        readonly number: number;
        readonly latestRevisionId: string | null;
        readonly ticketSourceId: string | null;
        readonly ticketKey: string | null;
      }
    | undefined
  > {
    const row = await this.database.db
      .selectFrom("pull_requests as pr")
      .leftJoin("tickets as ticket", "ticket.id", "pr.ticket_id")
      .select([
        "pr.external_number",
        "ticket.source_id",
        "ticket.external_key",
        (eb) =>
          eb
            .selectFrom("pr_revisions as revision")
            .select("revision.id")
            .whereRef("revision.pr_id", "=", "pr.id")
            .orderBy("revision.revision_seq", "desc")
            .limit(1)
            .as("latest_revision_id"),
      ])
      .where("pr.organization_id", "=", organizationId)
      .where("pr.id", "=", prId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          number: row.external_number,
          latestRevisionId: row.latest_revision_id ?? null,
          ticketSourceId: row.source_id ?? null,
          ticketKey: row.external_key ?? null,
        };
  }

  /**
   * A run's loop number — what an abort's typed confirmation must equal.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The `loop_seq`, or `undefined`.
   */
  async loopSeq(organizationId: string, runId: string): Promise<number | undefined> {
    const row = await this.database.db
      .selectFrom("runs")
      .select("loop_seq")
      .where("organization_id", "=", organizationId)
      .where("id", "=", runId)
      .executeTakeFirst();

    return row?.loop_seq;
  }

  /**
   * A fact's lifecycle state — which transition Confirm or Retire is.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @returns The status, or `undefined`.
   */
  async factStatus(organizationId: string, factId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("facts")
      .select("status")
      .where("organization_id", "=", organizationId)
      .where("id", "=", factId)
      .executeTakeFirst();

    return row?.status;
  }

  /**
   * Grant an allow-once exception (V096): one run, one path, through the item, expiring at the
   * workspace's ceiling. The table's trigger refuses a wider grant.
   *
   * @param executor - The allow-once transaction.
   * @param grant - The run, path, granter and item.
   * @param grant.organizationId - The workspace.
   * @param grant.runId - The run.
   * @param grant.pathGlob - The protected path, exactly.
   * @param grant.grantedBy - The person.
   * @param grant.itemId - The decision item that authorises it.
   * @returns The exception's id.
   */
  async grantException(
    executor: ActionExecutor,
    grant: {
      readonly organizationId: string;
      readonly runId: string;
      readonly pathGlob: string;
      readonly grantedBy: string;
      readonly itemId: string;
    },
  ): Promise<string> {
    const row = await executor
      .insertInto("guardrail_exceptions")
      .values({
        organization_id: grant.organizationId,
        run_id: grant.runId,
        path_glob: grant.pathGlob,
        granted_by: grant.grantedBy,
        granted_via: grant.itemId,
        expires_at: sql<Date>`now() + (select ttl.exception_max_ttl
                                         from ouroboros.decision_ttl_settings(${grant.organizationId}) ttl)`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }
}
