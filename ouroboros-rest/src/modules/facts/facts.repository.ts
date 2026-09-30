/**
 * The fact lifecycle's statements (BF.2, [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * V071's `facts`, `fact_anchors` and `fact_transitions`, read and written on `SkillsRepository`'s
 * model. Every statement that takes an organization is scoped by it; every statement keyed by a
 * fact id alone (`fact_anchors` carries no `organization_id`) is handed an id the service resolved
 * through {@link FactsRepository.lock} or {@link FactsRepository.records} first — that resolution
 * is its tenancy check.
 *
 * **Every status write names its actor and reason in the same statement**, because V071's
 * `fact_transitions_record()` trigger copies whatever `status_changed_by` / `status_reason` hold
 * into the audit: a write that left them alone would attribute the move to the previous actor.
 * This file never writes `fact_transitions` — the application role cannot.
 *
 * Two reads reach past the fact tables, for the staleness sweep:
 *
 *   * {@link FactsRepository.mergedChanges} reads `pull_requests`, their newest `pr_revisions` row
 *     and their `ticket_sources` — a merged PR's changed paths and diff sample, the source sync's
 *     commit awareness (#140). A GitHub source's PRs are its push target's, `config.login` /
 *     `config.repos[0]`, which is the `owner/name` a repository-scoped fact is matched against;
 *   * {@link FactsRepository.sweepAnchors} reads every confirmed fact's anchors.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  Fact,
  FactAnchor,
  FactAnchorKind,
  FactProposer,
  FactStatus,
  PrRevisionFile,
} from "../db/schema";
import { asCount, queryOn } from "../tenancy/queries";
import type { FactProvenance, FactRecord, FactTransitionRow } from "./facts.resources";

/** What {@link FactsRepository.insert} writes — always a proposal. */
export interface NewFactInput {
  readonly repoRef: string | null;
  readonly text: string;
  readonly proposer: FactProposer;
  readonly provenance: FactProvenance;
  /** The person proposing it, or null for an automatic proposer. The creation's audit actor. */
  readonly actorId: string | null;
  /** The expired fact this re-learns, or null. */
  readonly relearnedFromFactId: string | null;
}

/** An anchor to add. */
export interface NewAnchorInput {
  readonly kind: FactAnchorKind;
  readonly value: string;
}

/** A status move, with everything V071 needs written beside it. */
export interface FactMove {
  readonly to: FactStatus;
  /** The person, or null for the sweep's `stale`. */
  readonly actorId: string | null;
  readonly reason: string | null;
  /** For `confirmed`: stamp `confirmed_by` / `confirmed_at` with the actor and now. */
  readonly stampConfirmation?: boolean;
  /** For `expired`: the reason, and the use count snapshotted in the same statement. */
  readonly expiredReason?: string;
}

/** One confirmed fact's anchor, as the sweep evaluates it. */
export interface SweepAnchor {
  readonly organizationId: string;
  readonly factId: string;
  /** The fact's repository, or null for the whole workspace. */
  readonly repoRef: string | null;
  readonly confirmedAt: Date;
  readonly anchorId: string;
  readonly kind: FactAnchorKind;
  readonly value: string;
  readonly lastCheckedAt: Date | null;
}

/** A merged PR, as the sweep reads it. */
export interface MergedChange {
  readonly prId: string;
  readonly number: number;
  /** `owner/name` for a GitHub source's PR; null when the source's kind names none. */
  readonly repoRef: string | null;
  readonly mergedAt: Date;
  readonly paths: readonly string[];
  readonly diffExcerpt: string | null;
}

/** How many merged PRs one sweep reads at most — oldest first, the rest on the next pass. */
export const SWEEP_CHANGE_LIMIT = 500;

@Injectable()
export class FactsRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's facts with everything their resources need.
   *
   * @param organizationId - The workspace.
   * @param filter - `status` to read one status, `ids` to read those facts; both optional.
   * @param trx - The transaction, when there is one.
   * @returns The records, newest first.
   */
  async records(
    organizationId: string,
    filter: { readonly status?: FactStatus; readonly ids?: readonly string[] } = {},
    trx?: Transaction<Database>,
  ): Promise<FactRecord[]> {
    const db = queryOn(this.database, trx);

    if (filter.ids !== undefined && filter.ids.length === 0) {
      return [];
    }

    let query = db
      .selectFrom("facts")
      .selectAll("facts")
      .select(
        sql<string>`(select count(*) from ouroboros.context_injections injection
                      where injection.fact_ids @> array[facts.id])`.as("used_count"),
      )
      .where("facts.organization_id", "=", organizationId);

    if (filter.status !== undefined) {
      query = query.where("facts.status", "=", filter.status);
    }
    if (filter.ids !== undefined) {
      query = query.where("facts.id", "in", [...filter.ids]);
    }

    const facts = await query.orderBy("facts.created_at", "desc").orderBy("facts.id").execute();

    if (facts.length === 0) {
      return [];
    }

    const ids = facts.map((fact) => fact.id);
    const [anchors, transitions, relearned] = await Promise.all([
      db.selectFrom("fact_anchors").selectAll().where("fact_id", "in", ids).execute(),
      db
        .selectFrom("fact_transitions as t")
        .leftJoin("user as u", "u.id", "t.actor_id")
        .select([
          "t.fact_id",
          "t.from_status",
          "t.to_status",
          "t.actor_id",
          "u.name as actor_name",
          "t.reason",
          "t.at",
        ])
        .where("t.fact_id", "in", ids)
        .execute(),
      db
        .selectFrom("facts")
        .select(["id", "relearned_from_fact_id"])
        .where("organization_id", "=", organizationId)
        .where("relearned_from_fact_id", "in", ids)
        .orderBy("created_at")
        .orderBy("id")
        .execute(),
    ]);

    return facts.map(({ used_count, ...fact }) => ({
      fact,
      usedCount: asCount(used_count),
      anchors: anchors.filter((anchor) => anchor.fact_id === fact.id),
      transitions: transitions.filter((row): row is FactTransitionRow => row.fact_id === fact.id),
      relearnedBy: relearned
        .filter((row) => row.relearned_from_fact_id === fact.id)
        .map((row) => row.id),
    }));
  }

  /**
   * A workspace's fact count by status.
   *
   * @param organizationId - The workspace.
   * @returns `(status, count)` for every status with a fact.
   */
  async counts(organizationId: string): Promise<{ status: FactStatus; count: number }[]> {
    const rows = await this.database.db
      .selectFrom("facts")
      .select(["status", sql<string>`count(*)`.as("total")])
      .where("organization_id", "=", organizationId)
      .groupBy("status")
      .execute();

    return rows.map((row) => ({ status: row.status, count: asCount(row.total) }));
  }

  /**
   * Lock one fact's row for the rest of a transaction.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param trx - The transaction.
   * @returns The row as locked, or `undefined` — absent and another workspace's alike.
   */
  async lock(
    organizationId: string,
    factId: string,
    trx: Transaction<Database>,
  ): Promise<Fact | undefined> {
    return trx
      .selectFrom("facts")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", factId)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Insert a proposal. V071 refuses any other starting status.
   *
   * @param organizationId - The workspace.
   * @param input - The fact.
   * @param trx - The transaction.
   * @returns The new fact's id.
   */
  async insert(
    organizationId: string,
    input: NewFactInput,
    trx: Transaction<Database>,
  ): Promise<string> {
    const row = await trx
      .insertInto("facts")
      .values({
        organization_id: organizationId,
        repo_ref: input.repoRef,
        text: input.text,
        proposer: input.proposer,
        provenance: JSON.stringify(input.provenance),
        relearned_from_fact_id: input.relearnedFromFactId,
        status_changed_by: input.actorId,
        status_reason: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Move a fact's status, writing its actor, reason and any stamp in the same statement.
   *
   * @param factId - A fact the caller locked.
   * @param move - The move.
   * @param trx - The transaction.
   */
  async move(factId: string, move: FactMove, trx: Transaction<Database>): Promise<void> {
    await trx
      .updateTable("facts")
      .set({
        status: move.to,
        status_changed_by: move.actorId,
        status_reason: move.reason,
        ...(move.stampConfirmation === true
          ? { confirmed_by: move.actorId, confirmed_at: sql<Date>`now()` }
          : {}),
        ...(move.expiredReason !== undefined
          ? {
              expired_reason: move.expiredReason,
              previous_use_count: sql<number>`(select count(*)::integer
                                                 from ouroboros.context_injections injection
                                                where injection.fact_ids @> array[facts.id])`,
            }
          : {}),
      })
      .where("id", "=", factId)
      .execute();
  }

  /**
   * Flag a confirmed fact stale — the sweep's move, nobody's. Idempotent: a fact no longer
   * `confirmed` is left alone.
   *
   * @param factId - The fact.
   * @param reason - Which anchor matched what.
   * @param trx - The transaction, when there is one.
   * @returns Whether the fact moved.
   */
  async flagStale(factId: string, reason: string, trx?: Transaction<Database>): Promise<boolean> {
    const result = await queryOn(this.database, trx)
      .updateTable("facts")
      .set({ status: "stale", status_changed_by: null, status_reason: reason })
      .where("id", "=", factId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * A fact's anchors.
   *
   * @param factId - A fact the caller resolved.
   * @param trx - The transaction, when there is one.
   * @returns The anchors, oldest first.
   */
  async anchorsOf(factId: string, trx?: Transaction<Database>): Promise<FactAnchor[]> {
    return queryOn(this.database, trx)
      .selectFrom("fact_anchors")
      .selectAll()
      .where("fact_id", "=", factId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  /**
   * Add anchors to a fact.
   *
   * @param factId - A fact the caller resolved.
   * @param anchors - The anchors; empty writes nothing.
   * @param trx - The transaction.
   * @returns The new anchors' ids, in order.
   */
  async insertAnchors(
    factId: string,
    anchors: readonly NewAnchorInput[],
    trx: Transaction<Database>,
  ): Promise<string[]> {
    if (anchors.length === 0) {
      return [];
    }

    const rows = await trx
      .insertInto("fact_anchors")
      .values(
        anchors.map((anchor) => ({ fact_id: factId, kind: anchor.kind, value: anchor.value })),
      )
      .returning("id")
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * Remove one anchor from a fact.
   *
   * @param factId - A fact the caller resolved.
   * @param anchorId - The anchor.
   * @param trx - The transaction.
   * @returns Whether a row was removed.
   */
  async deleteAnchor(
    factId: string,
    anchorId: string,
    trx: Transaction<Database>,
  ): Promise<boolean> {
    const result = await trx
      .deleteFrom("fact_anchors")
      .where("fact_id", "=", factId)
      .where("id", "=", anchorId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Every workspace with a confirmed, anchored fact — the nightly pass's worklist.
   *
   * @returns The organization ids.
   */
  async sweepWorkspaces(): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("facts")
      .select("facts.organization_id")
      .distinct()
      .where("facts.status", "=", "confirmed")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("fact_anchors")
            .select("id")
            .whereRef("fact_anchors.fact_id", "=", "facts.id"),
        ),
      )
      .orderBy("facts.organization_id")
      .execute();

    return rows.map((row) => row.organization_id);
  }

  /**
   * A workspace's confirmed facts' anchors.
   *
   * @param organizationId - The workspace.
   * @returns One row per anchor.
   */
  async sweepAnchors(organizationId: string): Promise<SweepAnchor[]> {
    const rows = await this.database.db
      .selectFrom("facts")
      .innerJoin("fact_anchors", "fact_anchors.fact_id", "facts.id")
      .select([
        "facts.organization_id as organizationId",
        "facts.id as factId",
        "facts.repo_ref as repoRef",
        "facts.confirmed_at as confirmedAt",
        "fact_anchors.id as anchorId",
        "fact_anchors.kind as kind",
        "fact_anchors.value as value",
        "fact_anchors.last_checked_at as lastCheckedAt",
      ])
      .where("facts.organization_id", "=", organizationId)
      .where("facts.status", "=", "confirmed")
      .orderBy("facts.id")
      .orderBy("fact_anchors.created_at")
      .orderBy("fact_anchors.id")
      .execute();

    // `facts_confirmed_stamp` holds confirmed_at on every confirmed fact.
    return rows.map((row) => ({ ...row, confirmedAt: row.confirmedAt ?? new Date(0) }));
  }

  /**
   * A workspace's merged PRs, with their newest revision's paths and diff sample.
   *
   * @param organizationId - The workspace.
   * @param options - `prId` for one PR (the sync hook); otherwise `since` (exclusive) and
   *   `enabledOnly`, the nightly pass's window over GitHub repositories the workspace has enabled.
   * @returns The changes, oldest merge first, at most {@link SWEEP_CHANGE_LIMIT}.
   */
  async mergedChanges(
    organizationId: string,
    options: { readonly prId?: string; readonly since?: Date; readonly enabledOnly?: boolean },
  ): Promise<MergedChange[]> {
    const byPr = options.prId === undefined ? sql`true` : sql`pr.id = ${options.prId}`;
    const since = options.since === undefined ? sql`true` : sql`pr.merged_at > ${options.since}`;
    const enabled =
      options.enabledOnly === true
        ? sql`source.kind = 'github' and exists (
                select 1
                  from ouroboros.github_repos repo
                  join ouroboros.github_orgs o on o.id = repo.org_id
                 where o.organization_id = pr.organization_id
                   and repo.enabled and o.enabled
                   and lower(o.login) = lower(source.config ->> 'login')
                   and lower(repo.name) = lower(source.config -> 'repos' ->> 0))`
        : sql`true`;

    const result = await sql<{
      prId: string;
      number: number;
      repoRef: string | null;
      mergedAt: Date;
      files: PrRevisionFile[] | null;
      diffExcerpt: string | null;
    }>`
      select pr.id as "prId",
             pr.external_number as "number",
             case when source.kind = 'github'
                  then (source.config ->> 'login') || '/' || (source.config -> 'repos' ->> 0)
             end as "repoRef",
             pr.merged_at as "mergedAt",
             revision.files as "files",
             revision.diff_excerpt as "diffExcerpt"
        from ouroboros.pull_requests pr
        join ouroboros.ticket_sources source on source.id = pr.source_id
        left join lateral (
               select r.files, r.diff_excerpt
                 from ouroboros.pr_revisions r
                where r.pr_id = pr.id
                order by r.revision_seq desc
                limit 1) revision on true
       where pr.organization_id = ${organizationId}
         and pr.state = 'merged'
         and pr.merged_at is not null
         and ${byPr}
         and ${since}
         and ${enabled}
       order by pr.merged_at, pr.id
       limit ${SWEEP_CHANGE_LIMIT}`.execute(this.database.db);

    return result.rows.map((row) => ({
      prId: row.prId,
      number: row.number,
      repoRef: row.repoRef,
      mergedAt: row.mergedAt,
      paths: (row.files ?? []).map((file) => file.path),
      diffExcerpt: row.diffExcerpt,
    }));
  }

  /**
   * How many of a workspace's confirmed facts have no anchor — the ones no sweep can flag.
   *
   * @param organizationId - The workspace.
   * @returns The count.
   */
  async uncoveredCount(organizationId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("facts")
      .select(sql<string>`count(*)`.as("total"))
      .where("facts.organization_id", "=", organizationId)
      .where("facts.status", "=", "confirmed")
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("fact_anchors")
              .select("fact_anchors.id")
              .whereRef("fact_anchors.fact_id", "=", "facts.id"),
          ),
        ),
      )
      .executeTakeFirstOrThrow();

    return asCount(row.total);
  }

  /**
   * Stamp when the nightly pass evaluated anchors. Never moves a stamp backwards.
   *
   * @param anchorIds - The anchors evaluated; empty writes nothing.
   * @param at - What the pass checked up to.
   */
  async stampChecked(anchorIds: readonly string[], at: Date): Promise<void> {
    if (anchorIds.length === 0) {
      return;
    }

    await this.database.db
      .updateTable("fact_anchors")
      .set({ last_checked_at: at })
      .where("id", "in", [...anchorIds])
      .where((eb) => eb.or([eb("last_checked_at", "is", null), eb("last_checked_at", "<", at)]))
      .execute();
  }
}
