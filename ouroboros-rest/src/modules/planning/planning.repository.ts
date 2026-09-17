/**
 * Everything the planning API reads and writes that the push does not — batches, drafts, their
 * dependency edges, epics and the roadmap.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). The push's own statements stay in
 * `push.repository.ts` (AL.3); this file is the rest of V034–V037.
 *
 * **Organization isolation is in every read's `where`.** A batch is found only inside the workspace
 * asking, and a draft only through its batch — `ticket_drafts` carries no `organization_id`, so the
 * batch *is* its tenancy. An id from another workspace reads as nothing, which is what the service
 * answers `404` to. V034–V036's triggers hold the same rule underneath.
 *
 * **Writes that must agree are one transaction**: a generation inserts the batch, its drafts and
 * their edges together; a regeneration replaces the unpushed drafts and their edges together; a
 * reorder rewrites every `sort_order` inside the deferred unique key's one transaction.
 *
 * **Months never leave PostgreSQL as a `Date`.** `pg` parses a `date` at the *process's* local
 * midnight, so a month is selected as `to_char(…, 'YYYY-MM')` and written as `'YYYY-MM-01'::date`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  SCHEMA_NAME,
  type BillingMode,
  type Database,
  type DraftBatchStatus,
  type DraftProvenance,
  type DraftPushError,
  type DraftPushState,
  type EpicMirrorKind,
  type EpicStatus,
  type EpicTint,
  type TicketState,
} from "../db/schema";
import type { Effort } from "../engine/engine.contract";
import type { TicketWriteRef } from "../ticket-sources/ticket-source.write";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";

/** A batch, as the planning API reads it. */
export interface BatchRow {
  readonly id: string;
  readonly organizationId: string;
  readonly status: DraftBatchStatus;
  readonly planner: string;
  readonly prompt: string;
  readonly outline: string | null;
  readonly targetMilestone: string | null;
  readonly epicId: string | null;
  readonly autoSize: boolean;
  readonly queueSmall: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** The target source — read through the batch's own workspace. */
  readonly source: SyncSource;
}

/** One draft, with its estimate in force and the rate that prices it. */
export interface DraftRow {
  readonly id: string;
  readonly localKey: string;
  readonly title: string;
  readonly body: string | null;
  readonly selected: boolean;
  readonly suggestedWorkflow: string | null;
  readonly provenance: DraftProvenance;
  readonly pushState: DraftPushState;
  readonly pushedTicketId: string | null;
  /** The tracker's own identity for the pushed ticket — `#612` and its link — or null. */
  readonly pushedTicket: TicketWriteRef | null;
  readonly pushError: DraftPushError | null;
  /** The latest estimate, or null while unsized. */
  readonly estimate: {
    readonly version: number;
    readonly effort: Effort;
    readonly confidence: number;
    readonly routedModel: string;
    readonly estMinutes: number;
    readonly estTokens: number;
    readonly estimator: string;
  } | null;
  /** What `ouroboros.model_price()` resolved the routed model to, or null. */
  readonly price: {
    readonly billingMode: BillingMode;
    readonly inputCentsPer1m: string | null;
  } | null;
}

/** One `blocks` edge touching a batch's drafts — the blocker a draft or a ticket, the blocked a draft. */
export interface BatchEdgeRow {
  readonly blockerDraftId: string | null;
  readonly blockerTicketId: string | null;
  readonly blockedDraftId: string;
}

/** A drafted ticket about to be stored — the planner's answer, keyed. */
export interface NewDraft {
  readonly localKey: string;
  readonly title: string;
  readonly body: string | null;
  readonly suggestedWorkflow: string;
  readonly selected: boolean;
  /** The local keys this draft is blocked by. */
  readonly dependencies: readonly string[];
}

/** A batch about to be stored. */
export interface NewBatch {
  readonly organizationId: string;
  readonly prompt: string;
  readonly outline: string | null;
  readonly planner: string;
  readonly targetSourceId: string;
  readonly targetMilestone: string | null;
  readonly epicId: string | null;
  readonly autoSize: boolean;
  readonly queueSmall: boolean;
  readonly createdBy: string | null;
}

/** What storing drafts answered: each new draft's id, by local key. */
export type StoredDrafts = ReadonlyMap<string, string>;

/** A draft's editable fields — only the present ones change. */
export interface DraftPatch {
  readonly selected?: boolean;
  readonly title?: string;
  readonly body?: string | null;
  /** Set to `edited` whenever the title or body is in the patch. */
  readonly provenance?: DraftProvenance;
}

/** A pushed draft, as the queue-small hook reads it. */
export interface PushedDraftRow {
  readonly localKey: string;
  /** The tracker's id for the ticket — a GitHub issue number, as text. */
  readonly externalId: string;
  /** The latest estimate's effort, or null. */
  readonly effort: Effort | null;
}

/** A mirrored GitHub issue, as the queue-small hook matches one. */
export interface MirroredIssueRow {
  readonly id: string;
  readonly number: number;
  readonly sizingStatus: string;
}

/** An epic lane, with its computed chip. */
export interface EpicRow {
  readonly id: string;
  readonly name: string;
  readonly tint: EpicTint;
  readonly status: EpicStatus;
  readonly startMonth: string | null;
  readonly endMonth: string | null;
  readonly sortOrder: number;
  readonly roadmapName: string | null;
  readonly roadmapWindow: string | null;
  readonly ticketCount: number;
  readonly doneCount: number;
}

/** A canonical ticket, as the epic editor lists it (AM.4, #286). */
export interface PlanningTicketRow {
  readonly id: string;
  readonly sourceId: string;
  readonly externalKey: string;
  readonly title: string;
  readonly state: TicketState;
  readonly url: string;
}

/** What an epic became in one source (AL.3's `epic_mirrors`), with the source's display name. */
export interface EpicMirrorRow {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly kind: EpicMirrorKind;
  readonly externalRef: string;
}

/** A ticket search, as the statement uses it — `backlog/listing.search.ts`'s escaped pattern. */
export interface TicketSearch {
  /** The `ilike` pattern for the title and the key, or `undefined` for no filter. */
  readonly pattern: string | undefined;
  /** The most rows to answer. */
  readonly limit: number;
}

/** An epic's stored fields — months as `YYYY-MM` or null. */
export interface EpicFieldsRow {
  readonly name: string;
  readonly tint: EpicTint;
  readonly status: EpicStatus;
  readonly startMonth: string | null;
  readonly endMonth: string | null;
  readonly roadmapName: string | null;
  readonly roadmapWindow: string | null;
}

/**
 * A month as the database stores it.
 *
 * @param month - `2026-07`, or null.
 * @returns `'2026-07-01'::date`, or null.
 */
function monthValue(month: string | null) {
  return month === null ? null : sql<Date>`${`${month}-01`}::date`;
}

@Injectable()
export class PlanningRepository {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  // --- sources and epics a batch names ------------------------------------------------------

  /**
   * One ticket source, inside the workspace asking — never its credential.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The source, or undefined.
   */
  async source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    const row = await this.database.db
      .selectFrom("ticket_sources_public")
      .select([
        "id",
        "organization_id",
        "kind",
        "display_name",
        "config",
        "sync_cursor",
        "synced_at",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          sourceId: row.id,
          organizationId: row.organization_id,
          kind: row.kind,
          displayName: row.display_name,
          config: row.config,
          cursor: row.sync_cursor,
          syncedAt: row.synced_at,
        };
  }

  // --- batches -------------------------------------------------------------------------------

  /**
   * One batch and its target source, inside the workspace asking.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch, or undefined.
   */
  async batch(organizationId: string, batchId: string): Promise<BatchRow | undefined> {
    const row = await this.database.db
      .selectFrom("draft_batches as b")
      .innerJoin("ticket_sources_public as s", (join) =>
        join
          .onRef("s.id", "=", "b.target_source_id")
          .onRef("s.organization_id", "=", "b.organization_id"),
      )
      .select([
        "b.id",
        "b.organization_id",
        "b.status",
        "b.planner",
        "b.source_prompt",
        "b.outline",
        "b.target_milestone",
        "b.epic_id",
        "b.auto_size",
        "b.queue_small",
        "b.created_at",
        "b.updated_at",
        "s.id as source_id",
        "s.kind",
        "s.display_name",
        "s.config",
        "s.sync_cursor",
        "s.synced_at",
      ])
      .where("b.organization_id", "=", organizationId)
      .where("b.id", "=", batchId)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      status: row.status,
      planner: row.planner,
      prompt: row.source_prompt,
      outline: row.outline,
      targetMilestone: row.target_milestone,
      epicId: row.epic_id,
      autoSize: row.auto_size,
      queueSmall: row.queue_small,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: {
        sourceId: row.source_id,
        organizationId: row.organization_id,
        kind: row.kind,
        displayName: row.display_name,
        config: row.config,
        cursor: row.sync_cursor,
        syncedAt: row.synced_at,
      },
    };
  }

  /**
   * A batch's drafts, each with its latest estimate and the rate its routed model resolves to.
   *
   * The rate is `ouroboros.model_price()` — the one pricing lookup — asked with the connection kind
   * of the workspace alias that routes to the model, or with no kind when no alias does.
   *
   * @param organizationId - The workspace — the pricing lookup's scope.
   * @param batchId - A batch the caller has already found in that workspace.
   * @returns The drafts in local-key order.
   */
  async drafts(organizationId: string, batchId: string): Promise<DraftRow[]> {
    const { rows } = await sql<{
      id: string;
      local_key: string;
      title: string;
      body: string | null;
      selected: boolean;
      suggested_workflow: string | null;
      provenance: DraftProvenance;
      push_state: DraftPushState;
      pushed_ticket_id: string | null;
      push_error: DraftPushError | null;
      ticket_external_id: string | null;
      ticket_external_key: string | null;
      ticket_external_url: string | null;
      version: number | null;
      effort: Effort | null;
      confidence: number | null;
      routed_model: string | null;
      est_minutes: number | null;
      est_tokens: number | null;
      estimator: string | null;
      billing_mode: BillingMode | null;
      input_cents_per_1m: string | null;
    }>`
      select d.id, d.local_key, d.title, d.body, d.selected, d.suggested_workflow, d.provenance,
             d.push_state, d.pushed_ticket_id, d.push_error,
             t.external_id as ticket_external_id, t.external_key as ticket_external_key,
             t.external_url as ticket_external_url,
             e.version, e.effort, e.confidence, e.routed_model,
             (e.breakdown->>'est_minutes')::float8 as est_minutes,
             (e.breakdown->>'est_tokens')::float8 as est_tokens,
             e.trace->>'estimator' as estimator,
             p.billing_mode, p.input_cents_per_1m::text as input_cents_per_1m
        from ${sql.id(SCHEMA_NAME, "ticket_drafts")} d
        left join ${sql.id(SCHEMA_NAME, "tickets")} t
          on t.id = d.pushed_ticket_id and t.organization_id = ${organizationId}
        left join lateral (
               select ie.*
                 from ${sql.id(SCHEMA_NAME, "issue_estimates")} ie
                where ie.draft_id = d.id
                order by ie.version desc
                limit 1
             ) e on true
        left join lateral (
               select c.kind
                 from ${sql.id(SCHEMA_NAME, "model_aliases")} a
                 join ${sql.id(SCHEMA_NAME, "provider_connections")} c
                   on c.id = a.provider_connection_id and c.organization_id = a.organization_id
                where a.organization_id = ${organizationId}
                  and a.model_id = e.routed_model
                order by a.alias
                limit 1
             ) k on true
        left join lateral ${sql.id(SCHEMA_NAME)}.model_price(${organizationId}, k.kind, e.routed_model) p
          on e.routed_model is not null
       where d.batch_id = ${batchId}
       order by d.local_key
    `.execute(this.database.db);

    return rows
      .map((row) => ({
        id: row.id,
        localKey: row.local_key,
        title: row.title,
        body: row.body,
        selected: row.selected,
        suggestedWorkflow: row.suggested_workflow,
        provenance: row.provenance,
        pushState: row.push_state,
        pushedTicketId: row.pushed_ticket_id,
        // Null only because the join is a left one — a pushed draft's ticket always has all three.
        pushedTicket:
          row.ticket_external_id === null ||
          row.ticket_external_key === null ||
          row.ticket_external_url === null
            ? null
            : {
                externalId: row.ticket_external_id,
                externalKey: row.ticket_external_key,
                url: row.ticket_external_url,
              },
        pushError: row.push_error,
        estimate:
          row.version === null
            ? null
            : {
                version: row.version,
                effort: row.effort as Effort,
                confidence: row.confidence ?? 0,
                routedModel: row.routed_model ?? "",
                estMinutes: row.est_minutes ?? 0,
                estTokens: row.est_tokens ?? 0,
                estimator: row.estimator ?? "",
              },
        price:
          row.billing_mode === null
            ? null
            : { billingMode: row.billing_mode, inputCentsPer1m: row.input_cents_per_1m },
      }))
      .sort((left, right) => left.localKey.localeCompare(right.localKey, "en", { numeric: true }));
  }

  /**
   * Every edge whose blocked end is one of a batch's drafts.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The edges.
   */
  async edges(organizationId: string, batchId: string): Promise<BatchEdgeRow[]> {
    const rows = await this.database.db
      .selectFrom("ticket_dependencies as t")
      .innerJoin("ticket_drafts as d", "d.id", "t.blocked_draft_id")
      .select(["t.blocker_draft_id", "t.blocker_ticket_id", "t.blocked_draft_id"])
      .where("t.organization_id", "=", organizationId)
      .where("d.batch_id", "=", batchId)
      .execute();

    return rows.map((row) => ({
      blockerDraftId: row.blocker_draft_id,
      blockerTicketId: row.blocker_ticket_id,
      blockedDraftId: row.blocked_draft_id as string,
    }));
  }

  /**
   * Store a generated batch, its drafts and their edges — one transaction.
   *
   * @param batch - The batch.
   * @param drafts - The planner's drafts, keyed.
   * @returns The batch's id and each draft's.
   */
  async insertBatch(
    batch: NewBatch,
    drafts: readonly NewDraft[],
  ): Promise<{ batchId: string; drafts: StoredDrafts }> {
    return this.database.transaction(async (trx) => {
      const { id: batchId } = await trx
        .insertInto("draft_batches")
        .values({
          organization_id: batch.organizationId,
          source_prompt: batch.prompt,
          outline: batch.outline,
          planner: batch.planner,
          target_source_id: batch.targetSourceId,
          target_milestone: batch.targetMilestone,
          epic_id: batch.epicId,
          auto_size: batch.autoSize,
          queue_small: batch.queueSmall,
          created_by: batch.createdBy,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const stored = await this.insertDrafts(trx, batch.organizationId, batchId, drafts, new Map());

      return { batchId, drafts: stored };
    });
  }

  /**
   * Replace a batch's **unpushed** drafts with a new planner answer — one transaction.
   *
   * Pushed drafts, their keys and their edges are untouched. A new draft whose key a pushed draft
   * already holds is not stored (the pushed one is the truth for that key). An edge from a new draft
   * to a pushed draft's key is kept against the pushed draft, or against the ticket it became when
   * AL.3 has rewritten it.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param planner - Which planner answered this time.
   * @param drafts - The new drafts, selection already carried over by the caller.
   * @returns Each stored draft's id, by local key.
   */
  async replaceUnpushed(
    organizationId: string,
    batchId: string,
    planner: string,
    drafts: readonly NewDraft[],
  ): Promise<StoredDrafts> {
    return this.database.transaction(async (trx) => {
      await trx
        .deleteFrom("ticket_drafts")
        .where("batch_id", "=", batchId)
        .where("push_state", "<>", "pushed")
        .execute();

      const pushed = await trx
        .selectFrom("ticket_drafts")
        .select(["id", "local_key", "pushed_ticket_id"])
        .where("batch_id", "=", batchId)
        .execute();
      const kept = new Map(
        pushed.map((row) => [row.local_key, { draftId: row.id, ticketId: row.pushed_ticket_id }]),
      );

      const stored = await this.insertDrafts(
        trx,
        organizationId,
        batchId,
        drafts.filter((draft) => !kept.has(draft.localKey)),
        kept,
      );

      await trx
        .updateTable("draft_batches")
        .set({ planner, status: "drafting" })
        .where("organization_id", "=", organizationId)
        .where("id", "=", batchId)
        .execute();

      return stored;
    });
  }

  /**
   * Insert drafts and their dependency edges.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace — every edge's.
   * @param batchId - The batch.
   * @param drafts - The drafts to insert.
   * @param existing - Drafts already in the batch that new drafts may depend on, by key: a pushed
   *   draft still named as a draft, or already rewritten to its ticket.
   * @returns Each inserted draft's id, by local key.
   */
  private async insertDrafts(
    trx: Transaction<Database>,
    organizationId: string,
    batchId: string,
    drafts: readonly NewDraft[],
    existing: ReadonlyMap<string, { draftId: string; ticketId: string | null }>,
  ): Promise<StoredDrafts> {
    if (drafts.length === 0) {
      return new Map();
    }

    const inserted = await trx
      .insertInto("ticket_drafts")
      .values(
        drafts.map((draft) => ({
          batch_id: batchId,
          local_key: draft.localKey,
          title: draft.title,
          body: draft.body,
          selected: draft.selected,
          suggested_workflow: draft.suggestedWorkflow,
        })),
      )
      .returning(["id", "local_key"])
      .execute();
    const ids = new Map(inserted.map((row) => [row.local_key, row.id]));
    const edges = drafts.flatMap((draft) =>
      draft.dependencies.flatMap((key) => {
        const blocked = ids.get(draft.localKey) as string;
        const blocker = ids.get(key);

        if (blocker !== undefined) {
          return [{ blocker_draft_id: blocker, blocker_ticket_id: null, blocked: blocked }];
        }

        const kept = existing.get(key);

        if (kept === undefined) {
          return [];
        }

        // A pushed draft that AL.3 rewrote is its ticket now; one it has not is still the draft.
        const ticketNamed = kept.ticketId !== null;

        return [
          {
            blocker_draft_id: ticketNamed ? null : kept.draftId,
            blocker_ticket_id: ticketNamed ? kept.ticketId : null,
            blocked: blocked,
          },
        ];
      }),
    );

    if (edges.length > 0) {
      await trx
        .insertInto("ticket_dependencies")
        .values(
          edges.map((edge) => ({
            organization_id: organizationId,
            blocker_draft_id: edge.blocker_draft_id,
            blocker_ticket_id: edge.blocker_ticket_id,
            blocked_draft_id: edge.blocked,
            origin: "planned",
          })),
        )
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }

    return ids;
  }

  /**
   * Change one draft's editable fields.
   *
   * @param batchId - The batch — the draft's tenancy.
   * @param draftId - The draft.
   * @param patch - What changes.
   */
  async patchDraft(batchId: string, draftId: string, patch: DraftPatch): Promise<void> {
    const set: Record<string, unknown> = {};

    for (const field of ["selected", "title", "body", "provenance"] as const) {
      if (patch[field] !== undefined) {
        set[field] = patch[field];
      }
    }

    if (Object.keys(set).length === 0) {
      return;
    }

    await this.database.db
      .updateTable("ticket_drafts")
      .set(set)
      .where("id", "=", draftId)
      .where("batch_id", "=", batchId)
      .execute();
  }

  /**
   * Replace the blocked-by set of one draft that the batch itself expresses.
   *
   * What is replaced is every edge into the draft whose blocker is a draft, or a ticket one of this
   * batch's drafts was pushed as — the set a local-key list can name. A ticket blocker from outside
   * the batch (a relation a sync recorded) is not the request's to remove, and stays.
   *
   * @param organizationId - The workspace.
   * @param blockedDraftId - The draft being re-wired.
   * @param blockers - Its new blockers: a draft, or the ticket a pushed draft became.
   * @param batchTicketIds - The tickets the batch's pushed drafts became.
   */
  async setDraftBlockers(
    organizationId: string,
    blockedDraftId: string,
    blockers: readonly ({ readonly draftId: string } | { readonly ticketId: string })[],
    batchTicketIds: readonly string[],
  ): Promise<void> {
    await this.database.transaction(async (trx) => {
      await trx
        .deleteFrom("ticket_dependencies")
        .where("organization_id", "=", organizationId)
        .where("blocked_draft_id", "=", blockedDraftId)
        .where((where) =>
          batchTicketIds.length === 0
            ? where("blocker_draft_id", "is not", null)
            : where.or([
                where("blocker_draft_id", "is not", null),
                where("blocker_ticket_id", "in", [...batchTicketIds]),
              ]),
        )
        .execute();

      if (blockers.length > 0) {
        await trx
          .insertInto("ticket_dependencies")
          .values(
            blockers.map((blocker) => ({
              organization_id: organizationId,
              blocker_draft_id: "draftId" in blocker ? blocker.draftId : null,
              blocker_ticket_id: "ticketId" in blocker ? blocker.ticketId : null,
              blocked_draft_id: blockedDraftId,
              origin: "planned",
            })),
          )
          .execute();
      }
    });
  }

  /**
   * Move a batch from one status to another, only if it is still in the first.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param from - The status it must be in.
   * @param to - Its new status.
   * @returns Whether it moved.
   */
  async moveStatus(
    organizationId: string,
    batchId: string,
    from: DraftBatchStatus,
    to: DraftBatchStatus,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("draft_batches")
      .set({ status: to })
      .where("organization_id", "=", organizationId)
      .where("id", "=", batchId)
      .where("status", "=", from)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * How many of a batch's selected drafts have no estimate.
   *
   * @param batchId - The batch.
   * @returns The count; zero is *all sized*.
   */
  async unsizedSelected(batchId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("ticket_drafts as d")
      .select(({ fn }) => fn.countAll<string>().as("unsized"))
      .where("d.batch_id", "=", batchId)
      .where("d.selected", "=", true)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("issue_estimates as e")
              .select("e.id")
              .whereRef("e.draft_id", "=", "d.id"),
          ),
        ),
      )
      .executeTakeFirst();

    return Number(row?.unsized ?? 0);
  }

  // --- queue-small ---------------------------------------------------------------------------

  /**
   * A batch's pushed drafts, with the tracker id of the ticket each became and its latest effort.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The pushed drafts, in local-key order.
   */
  async pushedDrafts(organizationId: string, batchId: string): Promise<PushedDraftRow[]> {
    const { rows } = await sql<{ local_key: string; external_id: string; effort: Effort | null }>`
      select d.local_key, t.external_id, e.effort
        from ${sql.id(SCHEMA_NAME, "ticket_drafts")} d
        join ${sql.id(SCHEMA_NAME, "draft_batches")} b on b.id = d.batch_id
        join ${sql.id(SCHEMA_NAME, "tickets")} t
          on t.id = d.pushed_ticket_id and t.organization_id = b.organization_id
        left join lateral (
               select ie.effort
                 from ${sql.id(SCHEMA_NAME, "issue_estimates")} ie
                where ie.draft_id = d.id
                order by ie.version desc
                limit 1
             ) e on true
       where b.organization_id = ${organizationId}
         and b.id = ${batchId}
         and d.push_state = 'pushed'
       order by d.local_key
    `.execute(this.database.db);

    return rows.map((row) => ({
      localKey: row.local_key,
      externalId: row.external_id,
      effort: row.effort,
    }));
  }

  /**
   * The workspace's mirrored GitHub issues with these numbers in one repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param numbers - The issue numbers.
   * @returns The mirrored issues found.
   */
  async mirroredIssues(
    organizationId: string,
    repo: string,
    numbers: readonly number[],
  ): Promise<MirroredIssueRow[]> {
    const [owner, name] = repo.split("/");

    if (numbers.length === 0 || owner === undefined || name === undefined) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("github_issues as i")
      .innerJoin("github_repos as r", "r.id", "i.github_repo_id")
      .innerJoin("github_orgs as o", "o.id", "r.org_id")
      .select(["i.id", "i.number", "i.sizing_status"])
      .where("i.organization_id", "=", organizationId)
      .where("o.login", "=", owner)
      .where("r.name", "=", name)
      .where("i.number", "in", [...numbers])
      .execute();

    return rows.map((row) => ({ id: row.id, number: row.number, sizingStatus: row.sizing_status }));
  }

  // --- epics ---------------------------------------------------------------------------------

  /**
   * The workspace's lanes with their computed chips, top first.
   *
   * @param organizationId - The workspace.
   * @returns The lanes.
   */
  async epics(organizationId: string): Promise<EpicRow[]> {
    const rows = await this.epicSelect()
      .where("organization_id", "=", organizationId)
      .orderBy("sort_order")
      .execute();

    return rows.map(toEpicRow);
  }

  /**
   * One lane, inside the workspace asking.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns The lane, or undefined.
   */
  async epic(organizationId: string, epicId: string): Promise<EpicRow | undefined> {
    const row = await this.epicSelect()
      .where("organization_id", "=", organizationId)
      .where("epic_id", "=", epicId)
      .executeTakeFirst();

    return row === undefined ? undefined : toEpicRow(row);
  }

  /**
   * Create a lane at the bottom of the roadmap.
   *
   * @param organizationId - The workspace.
   * @param fields - Its fields.
   * @returns Its id.
   */
  async createEpic(organizationId: string, fields: EpicFieldsRow): Promise<string> {
    return this.database.transaction(async (trx) => {
      const last = await trx
        .selectFrom("planning_epics")
        .select(({ fn }) => fn.max<number>("sort_order").as("highest"))
        .where("organization_id", "=", organizationId)
        .executeTakeFirst();
      const { id } = await trx
        .insertInto("planning_epics")
        .values({
          organization_id: organizationId,
          name: fields.name,
          tint: fields.tint,
          status: fields.status,
          start_month: monthValue(fields.startMonth),
          end_month: monthValue(fields.endMonth),
          sort_order: (last?.highest ?? 0) + 1,
          roadmap_name: fields.roadmapName,
          roadmap_window: fields.roadmapWindow,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return id;
    });
  }

  /**
   * Rewrite a lane's fields.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @param fields - Every field, merged by the caller.
   * @returns Whether the workspace had the epic.
   */
  async updateEpic(
    organizationId: string,
    epicId: string,
    fields: EpicFieldsRow,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("planning_epics")
      .set({
        name: fields.name,
        tint: fields.tint,
        status: fields.status,
        start_month: monthValue(fields.startMonth),
        end_month: monthValue(fields.endMonth),
        roadmap_name: fields.roadmapName,
        roadmap_window: fields.roadmapWindow,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", epicId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Delete a lane — its links and mirrors cascade, and its batches keep their drafts (set null).
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns Whether the workspace had the epic.
   */
  async deleteEpic(organizationId: string, epicId: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("planning_epics")
      .where("organization_id", "=", organizationId)
      .where("id", "=", epicId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Put the lanes in this order — one transaction, inside the deferred unique key.
   *
   * @param organizationId - The workspace.
   * @param epicIds - Every epic of the workspace, top first. The caller has checked the set.
   */
  async reorderEpics(organizationId: string, epicIds: readonly string[]): Promise<void> {
    await this.database.transaction(async (trx) => {
      for (const [index, epicId] of epicIds.entries()) {
        await trx
          .updateTable("planning_epics")
          .set({ sort_order: index + 1 })
          .where("organization_id", "=", organizationId)
          .where("id", "=", epicId)
          .execute();
      }
    });
  }

  /**
   * Which of these tickets the workspace holds.
   *
   * @param organizationId - The workspace.
   * @param ticketIds - The ids.
   * @returns Those found.
   */
  async ticketIdsIn(organizationId: string, ticketIds: readonly string[]): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("tickets")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("id", "in", [...ticketIds])
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * Link tickets to a lane; a link that exists is left alone.
   *
   * @param epicId - An epic the caller found in the workspace.
   * @param ticketIds - Tickets the caller found in the workspace.
   */
  async linkTickets(epicId: string, ticketIds: readonly string[]): Promise<void> {
    await this.database.db
      .insertInto("epic_tickets")
      .values(ticketIds.map((ticketId) => ({ epic_id: epicId, ticket_id: ticketId })))
      .onConflict((conflict) => conflict.columns(["epic_id", "ticket_id"]).doNothing())
      .execute();
  }

  /**
   * Unlink tickets from a lane; a link that does not exist is not an error.
   *
   * @param epicId - An epic the caller found in the workspace.
   * @param ticketIds - The tickets.
   */
  async unlinkTickets(epicId: string, ticketIds: readonly string[]): Promise<void> {
    await this.database.db
      .deleteFrom("epic_tickets")
      .where("epic_id", "=", epicId)
      .where("ticket_id", "in", [...ticketIds])
      .execute();
  }

  /**
   * The tickets linked to a lane — open first, then by key.
   *
   * @param organizationId - The workspace. Held in the `where` on the ticket as well as the lane,
   *   so a link can never surface another workspace's ticket.
   * @param epicId - The epic.
   * @returns The linked tickets.
   */
  async epicTickets(organizationId: string, epicId: string): Promise<PlanningTicketRow[]> {
    const rows = await this.ticketSelect()
      .innerJoin("epic_tickets as et", "et.ticket_id", "t.id")
      .where("et.epic_id", "=", epicId)
      .where("t.organization_id", "=", organizationId)
      .orderBy(sql`t.state = 'closed'`)
      .orderBy("t.external_key")
      .orderBy("t.id")
      .execute();

    return rows.map(toTicketRow);
  }

  /**
   * What a lane became in each tracker it was pushed to.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns The mirrors, by source name then kind.
   */
  async epicMirrors(organizationId: string, epicId: string): Promise<EpicMirrorRow[]> {
    const rows = await this.database.db
      .selectFrom("epic_mirrors as m")
      .innerJoin("ticket_sources as s", "s.id", "m.source_id")
      .select(["m.source_id", "s.display_name", "m.kind", "m.external_ref"])
      .where("m.epic_id", "=", epicId)
      .where("s.organization_id", "=", organizationId)
      .orderBy("s.display_name")
      .orderBy("m.kind")
      .execute();

    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceName: row.display_name,
      kind: row.kind,
      externalRef: row.external_ref,
    }));
  }

  /**
   * The workspace's canonical tickets matching a search — the epic editor's link picker.
   *
   * @param organizationId - The workspace.
   * @param search - The escaped pattern, matched against the title and the key, and the limit.
   * @returns The matches, most recently updated in their tracker first.
   */
  async searchTickets(organizationId: string, search: TicketSearch): Promise<PlanningTicketRow[]> {
    let query = this.ticketSelect()
      .where("t.organization_id", "=", organizationId)
      .orderBy("t.source_updated_at", "desc")
      .orderBy("t.id")
      .limit(search.limit);

    if (search.pattern !== undefined) {
      const pattern = search.pattern;

      query = query.where((eb) =>
        eb.or([eb("t.title", "ilike", pattern), eb("t.external_key", "ilike", pattern)]),
      );
    }

    return (await query.execute()).map(toTicketRow);
  }

  /**
   * The ticket read the editor's two lists share.
   *
   * @returns The select, without a `where`.
   */
  private ticketSelect() {
    return this.database.db
      .selectFrom("tickets as t")
      .select(["t.id", "t.source_id", "t.external_key", "t.title", "t.state", "t.external_url"]);
  }

  /**
   * The lane read, months as text.
   *
   * @returns The select, without a `where`.
   */
  private epicSelect() {
    return this.database.db
      .selectFrom("planning_epic_progress")
      .select([
        "epic_id",
        "name",
        "tint",
        "status",
        sql<string | null>`to_char(start_month, 'YYYY-MM')`.as("start_month"),
        sql<string | null>`to_char(end_month, 'YYYY-MM')`.as("end_month"),
        "sort_order",
        "roadmap_name",
        "roadmap_window",
        "ticket_count",
        "done_count",
      ]);
  }
}

/**
 * A ticket row as this file answers it.
 *
 * @param row - What the select returned.
 * @returns The ticket.
 */
function toTicketRow(row: {
  id: string;
  source_id: string;
  external_key: string;
  title: string;
  state: TicketState;
  external_url: string;
}): PlanningTicketRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalKey: row.external_key,
    title: row.title,
    state: row.state,
    url: row.external_url,
  };
}

/**
 * A lane row as this file answers it.
 *
 * @param row - What the view returned.
 * @returns The lane.
 */
function toEpicRow(row: {
  epic_id: string;
  name: string;
  tint: EpicTint;
  status: EpicStatus;
  start_month: string | null;
  end_month: string | null;
  sort_order: number;
  roadmap_name: string | null;
  roadmap_window: string | null;
  ticket_count: string;
  done_count: string;
}): EpicRow {
  return {
    id: row.epic_id,
    name: row.name,
    tint: row.tint,
    status: row.status,
    startMonth: row.start_month,
    endMonth: row.end_month,
    sortOrder: row.sort_order,
    roadmapName: row.roadmap_name,
    roadmapWindow: row.roadmap_window,
    ticketCount: Number(row.ticket_count),
    doneCount: Number(row.done_count),
  };
}
