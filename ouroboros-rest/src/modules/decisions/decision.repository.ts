/**
 * Every statement the decision registry, the feed and the out-of-band watcher issue.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). Writes go through the database's
 * own functions — `decision_item_emit` (V093's upsert) and `decision_item_source_resolve` (V097's
 * closure) — so the rules they hold (one row per key, refresh only while asking, a closure only on
 * an asking item) are never re-implemented here.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, DecisionChannel, DecisionItemStatus, DecisionSeverity } from "../db/schema";
import type {
  DecisionEmission,
  DecisionKey,
  DecisionKindDeclaration,
  PublishedDecisionKind,
} from "./decision.types";

/** A connection or a transaction. */
export type DecisionExecutor = Kysely<Database> | Transaction<Database>;

/** An item as an emission compares against it. */
export interface DecisionItemSnapshot {
  readonly id: string;
  readonly status: DecisionItemStatus;
  readonly payload: Record<string, unknown>;
  readonly refs: unknown;
  readonly severity: DecisionSeverity;
}

/** What an audit line and a lifecycle event need about an item. */
export interface DecisionItemIdentity {
  readonly id: string;
  readonly organizationId: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly plane: string;
  readonly sourceRef: string;
}

/** One severity's count for the feed. */
export interface DecisionFeedRow {
  readonly severity: DecisionSeverity;
  /** Open, or snoozed with the snooze already elapsed. */
  readonly open: number;
  /** Snoozed and still hidden. */
  readonly snoozed: number;
  /** The soonest a hidden item of this severity wakes, or null. */
  readonly nextWakeAt: Date | null;
}

/**
 * A row of `decision_kinds`, as a declaration.
 *
 * @param row - The row, with the interval read as text.
 * @returns The published declaration.
 */
function declarationOf(row: {
  kind_id: string;
  version: number;
  severity_default: DecisionSeverity;
  question_template: string;
  why_template: string;
  payload_schema: unknown;
  actions: unknown;
  resolution_semantics: unknown;
  ref_shape: unknown;
  escalation_window_text: string;
  merge_class: boolean;
}): PublishedDecisionKind {
  return {
    kindId: row.kind_id,
    version: row.version,
    severityDefault: row.severity_default,
    questionTemplate: row.question_template,
    whyTemplate: row.why_template,
    payloadSchema: row.payload_schema as PublishedDecisionKind["payloadSchema"],
    actions: row.actions as PublishedDecisionKind["actions"],
    resolutionSemantics: row.resolution_semantics as PublishedDecisionKind["resolutionSemantics"],
    refShape: row.ref_shape as PublishedDecisionKind["refShape"],
    escalationWindow: row.escalation_window_text,
    mergeClass: row.merge_class,
  };
}

@Injectable()
export class DecisionRepository {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** The query builder, for a caller (a detector) that reads planes of its own. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Run work in one transaction.
   *
   * @param work - The work.
   * @returns What it returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * The newest published version of a kind — what a new emission pins.
   *
   * @param kindId - The kind.
   * @param executor - Where to read; the pool by default.
   * @returns The declaration, or undefined when the kind has none.
   */
  async currentKind(
    kindId: string,
    executor: DecisionExecutor = this.database.db,
  ): Promise<PublishedDecisionKind | undefined> {
    const row = await this.kinds(executor)
      .where("kind_id", "=", kindId)
      .orderBy("version", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? undefined : declarationOf(row);
  }

  /**
   * One published version of a kind — what an open item renders and resolves at.
   *
   * @param kindId - The kind.
   * @param version - The pinned version.
   * @returns The declaration, or undefined when there is no such version.
   */
  async kindVersion(kindId: string, version: number): Promise<PublishedDecisionKind | undefined> {
    const row = await this.kinds(this.database.db)
      .where("kind_id", "=", kindId)
      .where("version", "=", version)
      .executeTakeFirst();

    return row === undefined ? undefined : declarationOf(row);
  }

  /**
   * The newest version of every declared kind.
   *
   * @returns The declarations, by kind id.
   */
  async currentKinds(): Promise<PublishedDecisionKind[]> {
    const rows = await this.kinds(this.database.db)
      .distinctOn("kind_id")
      .orderBy("kind_id")
      .orderBy("version", "desc")
      .execute();

    return rows.map(declarationOf);
  }

  /**
   * Publish a declaration as a given version. The database refuses any version but the kind's
   * next (`decision_kinds_next_version`) and holds every other rule (templates slotted,
   * merge-class never auto-resolvable, no loosening).
   *
   * @param declaration - The declaration.
   * @param version - The kind's next version — the newest plus one, or 1.
   * @param executor - The transaction.
   * @returns The version it was published as.
   */
  async publishKind(
    declaration: DecisionKindDeclaration,
    version: number,
    executor: DecisionExecutor,
  ): Promise<number> {
    const row = await executor
      .insertInto("decision_kinds")
      .values({
        kind_id: declaration.kindId,
        version,
        severity_default: declaration.severityDefault,
        question_template: declaration.questionTemplate,
        why_template: declaration.whyTemplate,
        payload_schema: JSON.stringify(declaration.payloadSchema),
        actions: JSON.stringify(declaration.actions),
        resolution_semantics: JSON.stringify(declaration.resolutionSemantics),
        ref_shape: JSON.stringify(declaration.refShape),
        escalation_window: declaration.escalationWindow,
        merge_class: declaration.mergeClass,
      })
      .returning("version")
      .executeTakeFirstOrThrow();

    return row.version;
  }

  /**
   * An interval as PostgreSQL prints it — so `30 minutes` and `00:30:00` compare equal.
   *
   * @param executor - Where to ask.
   * @param interval - Interval text.
   * @returns Its canonical text.
   */
  async canonicalInterval(executor: DecisionExecutor, interval: string): Promise<string> {
    const result = await sql<{ text: string }>`select ${interval}::interval::text as text`.execute(
      executor,
    );

    return result.rows[0].text;
  }

  /**
   * Serialize registrations of one kind, for the transaction's life — so two registering at once
   * agree on which version each publishes.
   *
   * @param trx - The transaction.
   * @param kindId - The kind.
   */
  async lockKind(trx: Transaction<Database>, kindId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`decision-kind:${kindId}`}, 0))`.execute(
      trx,
    );
  }

  /**
   * Serialize emissions of one key, for the transaction's life — so two planes emitting the same
   * key at once agree on which of them filed it.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param key - The emission's key.
   */
  async lockKey(
    trx: Transaction<Database>,
    organizationId: string,
    key: DecisionKey,
  ): Promise<void> {
    await sql`
      select pg_advisory_xact_lock(hashtextextended(${`decision:${organizationId}:${key.plane}:${key.sourceRef}`}, 0))
    `.execute(trx);
  }

  /**
   * The item a key already filed, if any.
   *
   * @param executor - The transaction.
   * @param organizationId - The workspace.
   * @param key - The key.
   * @returns Its id, status and facts, or undefined.
   */
  async itemByKey(
    executor: DecisionExecutor,
    organizationId: string,
    key: DecisionKey,
  ): Promise<DecisionItemSnapshot | undefined> {
    return executor
      .selectFrom("decision_items")
      .select(["id", "status", "payload", "refs", "severity"])
      .where("organization_id", "=", organizationId)
      .where("idempotency_key", "=", `${key.plane}:${key.sourceRef}`)
      .executeTakeFirst();
  }

  /**
   * File (or refresh) an item through V093's upsert.
   *
   * @param executor - The transaction.
   * @param emission - The kind, facts, refs and key.
   * @returns The item's id.
   */
  async emit(executor: DecisionExecutor, emission: DecisionEmission): Promise<string> {
    const result = await sql<{ id: string }>`
      select ouroboros.decision_item_emit(
        ${emission.organizationId},
        ${emission.kindId},
        ${JSON.stringify(emission.payload)}::jsonb,
        ${JSON.stringify(emission.refs)}::jsonb,
        ${emission.key.plane},
        ${emission.key.sourceRef},
        ${emission.severity ?? null}
      ) as id
    `.execute(executor);

    return result.rows[0].id;
  }

  /**
   * What an audit line needs about an item.
   *
   * @param itemId - The item.
   * @returns Its workspace, kind, version and key, or undefined.
   */
  async identity(itemId: string): Promise<DecisionItemIdentity | undefined> {
    const row = await this.database.db
      .selectFrom("decision_items")
      .select(["id", "organization_id", "kind_id", "kind_version", "emitted_by", "source_ref"])
      .where("id", "=", itemId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          kindId: row.kind_id,
          kindVersion: row.kind_version,
          plane: row.emitted_by,
          sourceRef: row.source_ref,
        };
  }

  /**
   * Close an item whose source settled elsewhere — V097's `policy(source_resolved)`.
   *
   * @param itemId - The item.
   * @param channel - Where the settlement came from.
   * @param outcome - The receipt — `{source: "pr_merged"}`.
   * @returns Whether this call closed it; false when it was no longer asking.
   */
  async sourceResolve(
    itemId: string,
    channel: DecisionChannel,
    outcome: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    const result = await sql<{ closed: boolean }>`
      select ouroboros.decision_item_source_resolve(
        ${itemId}::uuid, ${channel}, ${JSON.stringify(outcome)}::jsonb
      ) as closed
    `.execute(this.database.db);

    return result.rows[0]?.closed === true;
  }

  /**
   * Open items of the given kinds, with the refs and key a detector matches on.
   *
   * @param kinds - The kinds a detector watches.
   * @param organizationId - One workspace, or null for every workspace.
   * @returns Every open or snoozed item of those kinds.
   */
  async asking(
    kinds: readonly string[],
    organizationId: string | null,
  ): Promise<
    { id: string; organization_id: string; kind_id: string; refs: unknown; source_ref: string }[]
  > {
    if (kinds.length === 0) {
      return [];
    }

    let query = this.database.db
      .selectFrom("decision_items")
      .select(["id", "organization_id", "kind_id", "refs", "source_ref"])
      .where("status", "in", ["open", "snoozed"])
      .where("kind_id", "in", [...kinds]);

    if (organizationId !== null) {
      query = query.where("organization_id", "=", organizationId);
    }

    return query.execute();
  }

  /**
   * The feed: per severity, what is asking and what is hidden.
   *
   * Snooze-aware: an item snoozed until a moment that has passed counts as open, even before
   * `decision_items_wake` has swept it — the badge never hides a question longer than asked.
   *
   * @param organizationId - The workspace.
   * @param now - The instant the counts are as of.
   * @returns One row per severity present; absent severities count zero.
   */
  async feed(organizationId: string, now: Date): Promise<DecisionFeedRow[]> {
    const rows = await this.database.db
      .selectFrom("decision_items")
      .select((eb) => [
        "severity",
        eb.fn
          .count<string>("id")
          .filterWhere((w) =>
            w.or([
              w("status", "=", "open"),
              w.and([w("status", "=", "snoozed"), w("snoozed_until", "<=", now)]),
            ]),
          )
          .as("open"),
        eb.fn
          .count<string>("id")
          .filterWhere((w) => w.and([w("status", "=", "snoozed"), w("snoozed_until", ">", now)]))
          .as("snoozed"),
        eb.fn
          .min<Date | null>("snoozed_until")
          .filterWhere((w) => w.and([w("status", "=", "snoozed"), w("snoozed_until", ">", now)]))
          .as("next_wake_at"),
      ])
      .where("organization_id", "=", organizationId)
      .where("status", "in", ["open", "snoozed"])
      .groupBy("severity")
      .execute();

    return rows.map((row) => ({
      severity: row.severity,
      open: Number(row.open),
      snoozed: Number(row.snoozed),
      nextWakeAt: row.next_wake_at,
    }));
  }

  /**
   * The `decision_kinds` select, with the interval read as text (`00:30:00`).
   *
   * @param executor - Where to read.
   * @returns The query.
   */
  private kinds(executor: DecisionExecutor) {
    return executor
      .selectFrom("decision_kinds")
      .select([
        "kind_id",
        "version",
        "severity_default",
        "question_template",
        "why_template",
        "payload_schema",
        "actions",
        "resolution_semantics",
        "ref_shape",
        "merge_class",
        sql<string>`escalation_window::text`.as("escalation_window_text"),
      ]);
  }
}
