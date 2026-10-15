/**
 * The chain executor's SQL — AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * Five reads and two writes, each scoped to the workspace the subject belongs to:
 *
 * ```
 * subjectOf          runs → copilot_sessions → dry_runs → investigations   which workspace
 * aliasBinding       model_aliases ⟕ provider_connections                  a single-hop target
 * subjectSpent       sum(token_usage.cost_cents) for the subject           the per-run cap
 * providerMonthSpent sum(token_usage.cost_cents) for the kind this month   the provider cap
 * insertUsage        one token_usage row per attempted hop                 R4, G2
 * insertSnapshot     one resolution_snapshots row for a run's call         G1
 * ```
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { NewTokenUsage, ProviderConnectionKind, TokenUsageSubjectKind } from "../../db/schema";
import type { ResolutionSnapshotDocument } from "../../routing/snapshot";

/** What an invocation is attributed to. */
export interface InvokeSubject {
  readonly organizationId: string;
  readonly kind: TokenUsageSubjectKind;
  readonly id: string;
}

/** An alias as a single-hop call needs it. */
export interface AliasBinding {
  readonly alias: string;
  readonly modelId: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
  readonly connectionId: string | null;
  readonly kind: ProviderConnectionKind | null;
}

/**
 * The tables an invocation can be attributed to, in lookup order — each with its own
 * `organization_id`. An estimate (V144, #123) is attributed to what it sized: a GitHub issue or
 * a canonical ticket here, a ticket draft through its batch ({@link InvokeRepository.subjectOf}).
 */
const SUBJECT_TABLES = [
  ["run", "runs"],
  ["copilot_session", "copilot_sessions"],
  ["dry_run", "dry_runs"],
  ["investigation", "investigations"],
  ["estimate", "github_issues"],
  ["estimate", "tickets"],
] as const;

@Injectable()
export class InvokeRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Which workspace a `runCtx.run` belongs to, and what kind of thing it is — a run, a copilot
   * session, a dry run, an investigation, or what an estimate sized (#123).
   *
   * @param id - A uuid.
   * @returns The subject, or undefined when no owner table has the id.
   */
  async subjectOf(id: string): Promise<InvokeSubject | undefined> {
    for (const [kind, table] of SUBJECT_TABLES) {
      const row = await this.database.db
        .selectFrom(table)
        .select("organization_id")
        .where("id", "=", id)
        .executeTakeFirst();

      if (row !== undefined) {
        return { organizationId: row.organization_id, kind, id };
      }
    }

    // A ticket draft has no workspace of its own: its batch is its whole tenancy (V034).
    const draft = await this.database.db
      .selectFrom("ticket_drafts")
      .innerJoin("draft_batches", "draft_batches.id", "ticket_drafts.batch_id")
      .select("draft_batches.organization_id")
      .where("ticket_drafts.id", "=", id)
      .executeTakeFirst();

    return draft === undefined
      ? undefined
      : { organizationId: draft.organization_id, kind: "estimate", id };
  }

  /**
   * An alias and the connection it is bound to.
   *
   * @param organizationId - The workspace.
   * @param alias - `model_aliases.alias`.
   * @returns The binding, or undefined when the workspace has no such alias.
   */
  async aliasBinding(organizationId: string, alias: string): Promise<AliasBinding | undefined> {
    const row = await this.database.db
      .selectFrom("model_aliases as a")
      .leftJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select(["a.alias", "a.model_id", "a.params", "a.enabled", "c.id as connection_id", "c.kind"])
      .where("a.organization_id", "=", organizationId)
      .where("a.alias", "=", alias)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          alias: row.alias,
          modelId: row.model_id,
          params: row.params,
          enabled: row.enabled,
          connectionId: row.connection_id,
          kind: row.kind,
        };
  }

  /**
   * What a subject has spent so far — the per-run cap's left-hand side.
   *
   * Priced rows only: an unpriced row is not counted toward a cap (G6).
   *
   * @param subject - The run, session, dry run or investigation.
   * @returns Cents.
   */
  async subjectSpent(subject: InvokeSubject): Promise<number> {
    const row = await this.database.db
      .selectFrom("token_usage")
      .select(sql<string | null>`sum(cost_cents)::text`.as("spent"))
      .where("organization_id", "=", subject.organizationId)
      .where("subject_kind", "=", subject.kind)
      .where("subject_id", "=", subject.id)
      .executeTakeFirst();

    return Number(row?.spent ?? 0);
  }

  /**
   * What a provider kind has spent this calendar month in the workspace.
   *
   * By kind rather than by connection, because that is the figure the provider card's meter
   * shows against its cap (`routing/stats.repository.ts` `byProvider`) — a cap enforced on a
   * different sum than the one printed beside it would be a cap nobody can predict.
   *
   * @param organizationId - The workspace.
   * @param kind - The provider kind.
   * @param since - The start of the month (`monthWindow`).
   * @returns Cents.
   */
  async providerMonthSpent(
    organizationId: string,
    kind: ProviderConnectionKind,
    since: Date,
  ): Promise<number> {
    const row = await this.database.db
      .selectFrom("token_usage")
      .select(sql<string | null>`sum(cost_cents)::text`.as("spent"))
      .where("organization_id", "=", organizationId)
      .where("provider", "=", kind)
      .where("occurred_at", ">=", since)
      .executeTakeFirst();

    return Number(row?.spent ?? 0);
  }

  /**
   * Store one hop's usage.
   *
   * @param row - The row.
   */
  async insertUsage(row: NewTokenUsage): Promise<void> {
    await this.database.db.insertInto("token_usage").values(row).execute();
  }

  /**
   * Store the resolution a run's call executed (gap G1).
   *
   * Only for a run: `resolution_snapshots.run_id` references `runs`.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @param document - `snapshotOf(resolution, …)`.
   * @returns The snapshot's id.
   */
  async insertSnapshot(
    organizationId: string,
    runId: string,
    document: ResolutionSnapshotDocument,
  ): Promise<string> {
    const row = await this.database.db
      .insertInto("resolution_snapshots")
      .values({
        organization_id: organizationId,
        run_id: runId,
        ...document,
        chain: JSON.stringify(document.chain),
        rules: JSON.stringify(document.rules),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }
}
