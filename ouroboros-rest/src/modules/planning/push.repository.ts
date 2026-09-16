/**
 * Everything the push service reads and writes in the database.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)). One statement per question and
 * **one transaction per pushed draft** — {@link PushRepository.recordPushed} — because the three
 * facts a successful draft produces have to become true together or not at all:
 *
 * ```
 * recordPushed ─┬─ tickets              the canonical ticket (or the one a sync already adopted)
 *               ├─ ticket_drafts        push_state = pushed · pushed_ticket_id
 *               ├─ ticket_dependencies  every draft end rewritten to the ticket (AK.2)
 *               └─ epic_tickets         the batch epic counts it (AK.3)
 * ```
 *
 * A crash before that commit leaves the draft `pending` with its issue already in the tracker,
 * which is the case the provider's idempotency probe exists for; a crash after it leaves nothing
 * for a resume to do. There is no state in between.
 *
 * **Organization isolation is in every read's `where`**, and in V034–V036's triggers underneath
 * it: a batch is found only inside the workspace asking, and the source it targets is read through
 * the same filter, so a push cannot reach another organization's source even with a guessed id.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  DEFAULT_SIZING_STATUS,
  type Database,
  type DraftBatchStatus,
  type DraftPushError,
  type DraftPushState,
  type EpicMirrorKind,
} from "../db/schema";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import type { TicketWriteRef } from "../ticket-sources/ticket-source.write";

/** A batch, as a push reads it. */
export interface PushBatch {
  /** `draft_batches.id`. */
  readonly id: string;
  /** The workspace. */
  readonly organizationId: string;
  /** Where the batch is in its life. */
  readonly status: DraftBatchStatus;
  /** The milestone name to ensure and assign, or null. */
  readonly targetMilestone: string | null;
  /** The planning epic the drafts belong to, or null. */
  readonly epicId: string | null;
  /** The source the push files into — read through the batch's own workspace. */
  readonly source: SyncSource;
}

/** One selected draft, as a push reads it. */
export interface PushDraft {
  /** `ticket_drafts.id`. */
  readonly id: string;
  /** The planner's key — `OTA-3`. */
  readonly localKey: string;
  /** The title. */
  readonly title: string;
  /** The body, or null. */
  readonly body: string | null;
  /** Where the draft is in the push. */
  readonly pushState: DraftPushState;
  /** The ticket it became, once pushed. */
  readonly pushedTicketId: string | null;
  /** Why it failed, when it did. */
  readonly pushError: DraftPushError | null;
}

/** One dependency touching the batch — each end a draft or a ticket, never both. */
export interface PushEdge {
  readonly blockerDraftId: string | null;
  readonly blockerTicketId: string | null;
  readonly blockedDraftId: string | null;
  readonly blockedTicketId: string | null;
}

/** A canonical ticket, as a push links to it. */
export interface PushTicket {
  /** `tickets.id`. */
  readonly ticketId: string;
  /** The source it belongs to — a link is only made inside one tracker. */
  readonly sourceId: string;
  /** Its identity in that tracker. */
  readonly ref: TicketWriteRef;
}

/** What one successful draft records. */
export interface PushedDraft {
  /** The workspace. */
  readonly organizationId: string;
  /** The batch. */
  readonly batchId: string;
  /** The draft. */
  readonly draftId: string;
  /** The source the ticket was created in. */
  readonly sourceId: string;
  /** What the tracker answered. */
  readonly ref: TicketWriteRef;
  /** The draft's title — the canonical row's until the next sync. */
  readonly title: string;
  /** The draft's body — likewise. */
  readonly body: string | null;
  /** The batch epic to count the ticket in, or null. */
  readonly epicId: string | null;
  /** When the push recorded it. */
  readonly at: Date;
}

/**
 * The push service's view of the database, as an interface — so the service's suites run it over
 * an in-memory store and the integration suite over PostgreSQL, against the same contract.
 */
export interface PushStore {
  /**
   * @param organizationId - The workspace asking.
   * @param batchId - The batch.
   * @returns The batch and its target source, or undefined when the workspace has no such batch.
   */
  batch(organizationId: string, batchId: string): Promise<PushBatch | undefined>;
  /**
   * @param batchId - The batch.
   * @returns Its selected drafts, in local-key order.
   */
  selectedDrafts(batchId: string): Promise<PushDraft[]>;
  /**
   * @param organizationId - The workspace.
   * @param draftIds - The drafts.
   * @returns Every dependency with a draft end among them.
   */
  dependencies(organizationId: string, draftIds: readonly string[]): Promise<PushEdge[]>;
  /**
   * @param organizationId - The workspace.
   * @param ticketIds - The tickets.
   * @returns Those of them the workspace holds.
   */
  tickets(organizationId: string, ticketIds: readonly string[]): Promise<PushTicket[]>;
  /**
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param status - Its new status.
   */
  setBatchStatus(organizationId: string, batchId: string, status: DraftBatchStatus): Promise<void>;
  /**
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns Its name, or undefined when the workspace has no such epic.
   */
  epicName(organizationId: string, epicId: string): Promise<string | undefined>;
  /**
   * @param epicId - The epic.
   * @param sourceId - The source.
   * @param kind - The mirror's kind.
   * @returns The stored reference, or undefined.
   */
  epicMirror(epicId: string, sourceId: string, kind: EpicMirrorKind): Promise<string | undefined>;
  /**
   * Record a mirror, keeping whichever reference was stored first.
   *
   * @param epicId - The epic.
   * @param sourceId - The source.
   * @param kind - The mirror's kind.
   * @param externalRef - The tracker's handle.
   */
  saveEpicMirror(
    epicId: string,
    sourceId: string,
    kind: EpicMirrorKind,
    externalRef: string,
  ): Promise<void>;
  /**
   * Record a pushed draft — see this file's header.
   *
   * @param pushed - What to record.
   * @returns The canonical ticket's id.
   */
  recordPushed(pushed: PushedDraft): Promise<string>;
  /**
   * Record a failed draft. A draft already pushed is left alone.
   *
   * @param batchId - The batch.
   * @param draftId - The draft.
   * @param error - Why.
   */
  recordFailed(batchId: string, draftId: string, error: DraftPushError): Promise<void>;
}

/** The PostgreSQL {@link PushStore}. */
@Injectable()
export class PushRepository implements PushStore {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async batch(organizationId: string, batchId: string): Promise<PushBatch | undefined> {
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
        "b.target_milestone",
        "b.epic_id",
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
      targetMilestone: row.target_milestone,
      epicId: row.epic_id,
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

  /** @inheritdoc */
  async selectedDrafts(batchId: string): Promise<PushDraft[]> {
    const rows = await this.database.db
      .selectFrom("ticket_drafts")
      .select(["id", "local_key", "title", "body", "push_state", "pushed_ticket_id", "push_error"])
      .where("batch_id", "=", batchId)
      .where("selected", "=", true)
      .orderBy("local_key")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      localKey: row.local_key,
      title: row.title,
      body: row.body,
      pushState: row.push_state,
      pushedTicketId: row.pushed_ticket_id,
      pushError: row.push_error,
    }));
  }

  /** @inheritdoc */
  async dependencies(organizationId: string, draftIds: readonly string[]): Promise<PushEdge[]> {
    if (draftIds.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("ticket_dependencies")
      .select(["blocker_draft_id", "blocker_ticket_id", "blocked_draft_id", "blocked_ticket_id"])
      .where("organization_id", "=", organizationId)
      .where((where) =>
        where.or([
          where("blocker_draft_id", "in", [...draftIds]),
          where("blocked_draft_id", "in", [...draftIds]),
        ]),
      )
      .execute();

    return rows.map((row) => ({
      blockerDraftId: row.blocker_draft_id,
      blockerTicketId: row.blocker_ticket_id,
      blockedDraftId: row.blocked_draft_id,
      blockedTicketId: row.blocked_ticket_id,
    }));
  }

  /** @inheritdoc */
  async tickets(organizationId: string, ticketIds: readonly string[]): Promise<PushTicket[]> {
    if (ticketIds.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .selectFrom("tickets")
      .select(["id", "source_id", "external_id", "external_key", "external_url"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", [...ticketIds])
      .execute();

    return rows.map((row) => ({
      ticketId: row.id,
      sourceId: row.source_id,
      ref: { externalId: row.external_id, externalKey: row.external_key, url: row.external_url },
    }));
  }

  /** @inheritdoc */
  async setBatchStatus(
    organizationId: string,
    batchId: string,
    status: DraftBatchStatus,
  ): Promise<void> {
    await this.database.db
      .updateTable("draft_batches")
      .set({ status })
      .where("organization_id", "=", organizationId)
      .where("id", "=", batchId)
      .execute();
  }

  /** @inheritdoc */
  async epicName(organizationId: string, epicId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("planning_epics")
      .select("name")
      .where("organization_id", "=", organizationId)
      .where("id", "=", epicId)
      .executeTakeFirst();

    return row?.name;
  }

  /** @inheritdoc */
  async epicMirror(
    epicId: string,
    sourceId: string,
    kind: EpicMirrorKind,
  ): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("epic_mirrors")
      .select("external_ref")
      .where("epic_id", "=", epicId)
      .where("source_id", "=", sourceId)
      .where("kind", "=", kind)
      .executeTakeFirst();

    return row?.external_ref;
  }

  /** @inheritdoc */
  async saveEpicMirror(
    epicId: string,
    sourceId: string,
    kind: EpicMirrorKind,
    externalRef: string,
  ): Promise<void> {
    await this.database.db
      .insertInto("epic_mirrors")
      .values({ epic_id: epicId, source_id: sourceId, kind, external_ref: externalRef })
      .onConflict((conflict) => conflict.columns(["epic_id", "source_id", "kind"]).doNothing())
      .execute();
  }

  /** @inheritdoc */
  async recordPushed(pushed: PushedDraft): Promise<string> {
    return this.database.transaction(async (trx) => {
      const ticketId = await this.adoptOrInsertTicket(trx, pushed);

      await trx
        .updateTable("ticket_drafts")
        .set({ push_state: "pushed", pushed_ticket_id: ticketId, push_error: null })
        .where("id", "=", pushed.draftId)
        .where("batch_id", "=", pushed.batchId)
        .execute();

      await this.rewriteEnd(trx, "blocker", pushed.draftId, ticketId);
      await this.rewriteEnd(trx, "blocked", pushed.draftId, ticketId);

      if (pushed.epicId !== null) {
        await trx
          .insertInto("epic_tickets")
          .values({ epic_id: pushed.epicId, ticket_id: ticketId })
          .onConflict((conflict) => conflict.columns(["epic_id", "ticket_id"]).doNothing())
          .execute();
      }

      return ticketId;
    });
  }

  /** @inheritdoc */
  async recordFailed(batchId: string, draftId: string, error: DraftPushError): Promise<void> {
    await this.database.db
      .updateTable("ticket_drafts")
      .set({ push_state: "failed", push_error: JSON.stringify(error) })
      .where("id", "=", draftId)
      .where("batch_id", "=", batchId)
      .where("push_state", "<>", "pushed")
      .execute();
  }

  /**
   * The canonical ticket for what the tracker answered — inserted, or the row a sync already
   * adopted between the tracker's `201` and this transaction.
   *
   * @param trx - The transaction.
   * @param pushed - What to record.
   * @returns The ticket's id.
   */
  private async adoptOrInsertTicket(
    trx: Transaction<Database>,
    pushed: PushedDraft,
  ): Promise<string> {
    const inserted = await trx
      .insertInto("tickets")
      .values({
        organization_id: pushed.organizationId,
        source_id: pushed.sourceId,
        external_id: pushed.ref.externalId,
        external_key: pushed.ref.externalKey,
        external_url: pushed.ref.url,
        title: pushed.title,
        body: pushed.body,
        state: "open",
        labels: "[]",
        author: null,
        source_created_at: pushed.at,
        source_updated_at: pushed.at,
        synced_at: pushed.at,
        sizing_status: DEFAULT_SIZING_STATUS,
        meta: "{}",
      })
      .onConflict((conflict) => conflict.columns(["source_id", "external_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    if (inserted !== undefined) {
      return inserted.id;
    }

    const adopted = await trx
      .selectFrom("tickets")
      .select("id")
      .where("source_id", "=", pushed.sourceId)
      .where("external_id", "=", pushed.ref.externalId)
      .executeTakeFirstOrThrow();

    return adopted.id;
  }

  /**
   * Rewrite one end of every dependency naming a draft to the ticket it became (AK.2).
   *
   * An edge that would become a duplicate of one already stored against the ticket — a relation a
   * sync recorded while the push was running — is removed rather than rewritten, because
   * `ticket_dependencies_pair_key` would refuse the second copy and the fact is already there.
   *
   * @param trx - The transaction.
   * @param end - Which end to rewrite.
   * @param draftId - The draft.
   * @param ticketId - The ticket.
   */
  private async rewriteEnd(
    trx: Transaction<Database>,
    end: "blocker" | "blocked",
    draftId: string,
    ticketId: string,
  ): Promise<void> {
    const draftColumn = end === "blocker" ? "blocker_draft_id" : "blocked_draft_id";
    const ticketColumn = end === "blocker" ? "blocker_ticket_id" : "blocked_ticket_id";
    const otherDraft = end === "blocker" ? "blocked_draft_id" : "blocker_draft_id";
    const otherTicket = end === "blocker" ? "blocked_ticket_id" : "blocker_ticket_id";

    await trx
      .deleteFrom("ticket_dependencies as d")
      .where(`d.${draftColumn}`, "=", draftId)
      .where((where) =>
        where.exists(
          where
            .selectFrom("ticket_dependencies as t")
            .select("t.id")
            .where(`t.${ticketColumn}`, "=", ticketId)
            .whereRef(`t.${otherDraft}`, "is not distinct from", `d.${otherDraft}`)
            .whereRef(`t.${otherTicket}`, "is not distinct from", `d.${otherTicket}`),
        ),
      )
      .execute();

    await trx
      .updateTable("ticket_dependencies")
      .set({ [draftColumn]: null, [ticketColumn]: ticketId })
      .where(draftColumn, "=", draftId)
      .execute();
  }
}
