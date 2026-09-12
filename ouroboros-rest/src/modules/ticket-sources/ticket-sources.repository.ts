/**
 * Every statement the ticket-source sync issues — the cross-workspace read that starts a
 * cycle, the one statement that names the sealed credential, and the one transaction that ends
 * a sync.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * ## The read is unscoped, and that is the one place in this module that is
 *
 * {@link TicketSourcesRepository.activeSources} takes no workspace. Every other repository in
 * this service takes an `organizationId` first, and the rule exists because the caller is a
 * request; this module's caller is a timer. Nobody is signed in, there is no tenant context to
 * read, and the work is *every workspace's active sources*. What keeps that safe is written
 * into the statement — it selects through `ticket_sources_public`, so there is no credential in
 * the rows at all, and they are consumed only by a sync that writes back to the source they
 * came from and answers nobody. `backlog-sync.repository.ts` and `provider-health.repository.ts`
 * make the same call for the same reason.
 *
 * ## One statement names `ticket_sources`, and it selects one column
 *
 * Q.2's fifth acceptance criterion is that *"credentials are decrypted only inside provider
 * calls, never logged"*, and V030 built the mechanism for the first half: `ticket_sources_public`
 * is every column except `credentials_encrypted`, so a read path cannot leak what it cannot
 * select. {@link TicketSourcesRepository.sealedCredential} is the exception that makes the rule
 * visible — one method, one column, called once per source per cycle, immediately before the
 * provider call that needs it. `ticket-sources.repository.spec.ts` asserts over this file's own
 * source that no other statement names the table for reading.
 *
 * ## The whole sync is one transaction, because freshness must never outrun the rows
 *
 * {@link TicketSourcesRepository.applySync} reads the rows a page will land on, writes the ones
 * that changed, and sets the source's stamp, cursor and status — all inside one transaction
 * that either happens or does not. A sync that failed part way leaves the mirror and the
 * freshness tag exactly as they were, which is the difference between a tag that means *"we
 * looked"* and one that means *"we started looking"*. V014's decision **K2**, carried over
 * unchanged by V030.
 *
 * It is also why the read of the existing rows is *inside* the transaction: the comparison that
 * decides *"has this ticket changed"* has to be against the rows the write will land on.
 *
 * ## An unchanged ticket is not written, and that is a rule about `updated_at`
 *
 * `tickets_touch_updated_at` is an unconditional `BEFORE UPDATE` trigger, so the only way to
 * keep V030's promise — *`updated_at` moves only when something in the row actually changed* —
 * is to not issue the update. Most trackers' cursors are inclusive, so every incremental sync
 * re-reads the ticket sitting exactly on the watermark; writing it would move a timestamp
 * nothing had changed. It is also what makes a re-sync **idempotent**, which is a property
 * Q.5's conformance kit ([#142](https://github.com/NobuData/ouroboros/issues/142)) will require
 * of every provider and which this loop has to make available to be required.
 *
 * ## A closed ticket this mirror has never seen is not stored
 *
 * The one policy this loop applies to a page a provider returned, and it is worth defending
 * because it looks like the loop having an opinion. It is not a *provider* opinion: it says
 * nothing about GitHub, Jira or Linear, and it is applied identically to all three. It is an
 * opinion about what the word **backlog** means — a mirror of work that was open at least once
 * — and the alternative is that a first sync of a ten-year-old project stores every ticket ever
 * closed, none of which any default view renders and none of which anybody asked for.
 *
 * Putting it here rather than in the providers is what keeps it one rule instead of five. A
 * provider **cannot** apply it in any case: deciding whether a closed ticket is *new* needs the
 * mirror's own state, which is exactly what a provider does not have. `backlog-sync.repository.ts`
 * drew the same line for GitHub alone.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  DEFAULT_SIZING_STATUS,
  type Database,
  type TicketSourceKind,
  type TicketSourceStatus,
  type TicketState,
} from "../db/schema";
import type { EstimableTicket } from "./ticket.intake";
import type { CanonicalTicket } from "./ticket-source.provider";

/** One source a cycle is about to sync. Every column but the credential. */
export interface SyncSource {
  /** `ticket_sources.id` — what the tickets hang off and what the cursor is stored on. */
  readonly sourceId: string;
  /** The workspace, and the tickets' `organization_id`. */
  readonly organizationId: string;
  /** Which tracker — the key the registry resolves a provider by. */
  readonly kind: TicketSourceKind;
  /** The workspace's own name for it, for a log line a person reads. */
  readonly displayName: string;
  /** The non-secret settings, as stored. Handed to the provider unread. */
  readonly config: unknown;
  /**
   * The stored watermark, or null on a source that has never been synced.
   *
   * Null is what makes a sync a **full** one rather than an incremental one, and it is the
   * whole of how the loop tells the two apart — see `ticket-sources.service.ts`.
   */
  readonly cursor: string | null;
  /** When it was last synced successfully, or null when it never has been. */
  readonly syncedAt: Date | null;
}

/** What one sync asks to be written. */
export interface SyncWrite {
  /** Which source. */
  readonly source: SyncSource;
  /** The tickets the provider returned, in the order it listed them. */
  readonly tickets: readonly CanonicalTicket[];
  /** The watermark to store, or null to leave the stored one alone. */
  readonly cursor: string | null;
  /** The cycle's clock — the freshness stamp every source in one cycle shares. */
  readonly syncedAt: Date;
}

/** What the transaction did. */
export interface SyncWritten {
  /** Rows inserted. */
  readonly imported: number;
  /** Rows rewritten because something the tracker owns had changed. */
  readonly updated: number;
  /** Rows the provider returned that were identical to what was stored — and were not written. */
  readonly unchanged: number;
  /** Closed tickets this mirror had never seen, and did not store. See this file's header. */
  readonly skippedClosed: number;
  /**
   * The tickets to hand to the estimation pipeline: everything imported, and everything that
   * reopened.
   *
   * Returned rather than handed over here, because the handoff must happen **after** this
   * transaction has committed — a ticket announced to a queue and then rolled back is a queue
   * holding a row that does not exist.
   */
  readonly estimable: readonly EstimableTicket[];
}

/** The mirrored columns, as a comparison reads them. */
interface StoredTicket {
  id: string;
  external_id: string;
  external_key: string;
  external_url: string;
  title: string;
  body: string | null;
  state: TicketState;
  labels: string[];
  author: string | null;
  source_created_at: Date;
  source_updated_at: Date;
  meta: unknown;
}

@Injectable()
export class TicketSourcesRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every source the loop should poll, across every workspace.
   *
   * Through `ticket_sources_public`, so the rows carry no credential — see this file's header.
   * `status = 'active'` is the whole filter, which is what V030's three-state column is for: a
   * `paused` source is somebody's choice and an `error` one is a source the loop already has a
   * reason for.
   *
   * @returns The sources, oldest-synced first so a source that has never been polled — whose
   *   `synced_at` is null — is at the front. A cycle that can only get through some of its work
   *   should spend it on the sources that have waited longest, and a cold source has waited
   *   forever.
   */
  async activeSources(): Promise<SyncSource[]> {
    const rows = await this.database.db
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
      .where("status", "=", "active")
      // `nulls first` rather than relying on PostgreSQL's default, which for `asc` puts nulls
      // *last* — the opposite of what "a source that has never been synced has waited longest"
      // means, and a default worth spelling rather than depending on.
      .orderBy("synced_at", (order) => order.asc().nullsFirst())
      // A tiebreak, so a cycle's order is stable when several sources were stamped by the same
      // cycle — which is every source in a workspace, because a cycle shares one clock.
      .orderBy("id", "asc")
      .execute();

    return rows.map((row) => ({
      sourceId: row.id,
      organizationId: row.organization_id,
      kind: row.kind,
      displayName: row.display_name,
      config: row.config,
      cursor: row.sync_cursor,
      syncedAt: row.synced_at,
    }));
  }

  /**
   * The sealed credential for one source.
   *
   * **The only statement in this service that reads `ticket_sources` rather than the view**,
   * and it selects one column. See this file's header; `ticket-sources.repository.spec.ts`
   * asserts the exclusivity over this file's source, so a second reader of the table is a red
   * test rather than something a reviewer has to notice.
   *
   * @param sourceId - The source.
   * @returns The envelope, or null when the source has no credential yet — which is a real
   *   state rather than an unfinished one. Also null when the source is gone, which a caller
   *   between a cycle's read and its sync can legitimately hit; the sync then fails `auth`,
   *   and the next cycle will not list the row at all.
   */
  async sealedCredential(sourceId: string): Promise<string | null> {
    const row = await this.database.db
      .selectFrom("ticket_sources")
      .select("credentials_encrypted")
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return row?.credentials_encrypted ?? null;
  }

  /**
   * Store one sync: the rows it changed, and the freshness it earned.
   *
   * @param write - What the provider returned, and the stamps to record with it.
   * @returns What was written, and which tickets the estimation pipeline should be told about.
   */
  async applySync(write: SyncWrite): Promise<SyncWritten> {
    return this.database.transaction(async (trx) => {
      const stored = await this.storedTickets(
        trx,
        write.source.sourceId,
        write.tickets.map((ticket) => ticket.externalId),
      );

      let imported = 0;
      let updated = 0;
      let unchanged = 0;
      let skippedClosed = 0;
      const estimable: EstimableTicket[] = [];

      for (const ticket of write.tickets) {
        const previous = stored.get(ticket.externalId);

        if (previous === undefined) {
          // See this file's header: a backlog holds what was open at least once.
          if (ticket.state === "closed") {
            skippedClosed += 1;
            continue;
          }

          const row = await this.insert(trx, write.source, ticket, write.syncedAt);

          imported += 1;
          estimable.push(handoff(write.source, row.id, ticket, "imported"));

          continue;
        }

        if (!differs(previous, ticket)) {
          unchanged += 1;
          continue;
        }

        await this.update(trx, previous.id, ticket, write.syncedAt);

        updated += 1;

        // A reopen is the one update that is also new work: the ticket left the backlog when it
        // closed, and it is back with whatever estimate it had — which the pipeline is entitled
        // to redo. A close is the opposite and enqueues nothing.
        if (previous.state === "closed" && ticket.state === "open") {
          estimable.push(handoff(write.source, previous.id, ticket, "reopened"));
        }
      }

      await this.stampSource(trx, write);

      return { imported, updated, unchanged, skippedClosed, estimable };
    });
  }

  /**
   * Record that a source's provider failed.
   *
   * Outside the sync transaction, because there is no sync transaction: this is the path where
   * the provider threw before anything could be written. It moves `status` and V031's
   * `status_reason` and **nothing else** — in particular not `synced_at`, which would claim a
   * poll that did not happen, and not `sync_cursor`, which would either lose the watermark or
   * re-store the one already there.
   *
   * @param sourceId - The source.
   * @param status - What the taxonomy maps the failure onto — see
   *   `ticket-source.errors.ts`. A parameter rather than the constant `'error'` so that a
   *   future class mapping onto something else needs no change here.
   * @param reason - The sentence, from `statusReasonFor`. Bounded and non-blank by that
   *   function, which is what `ticket_sources_status_reason_present` requires.
   */
  async markFailure(sourceId: string, status: TicketSourceStatus, reason: string): Promise<void> {
    await this.database.db
      .updateTable("ticket_sources")
      .set({ status, status_reason: reason })
      .where("id", "=", sourceId)
      .execute();
  }

  /**
   * The rows a page's tickets will land on.
   *
   * @param trx - The sync's transaction.
   * @param sourceId - The source.
   * @param externalIds - The identities the provider returned.
   * @returns The stored rows by external id. Empty for a first sync, and for a page whose
   *   tickets are all new.
   */
  private async storedTickets(
    trx: Transaction<Database>,
    sourceId: string,
    externalIds: readonly string[],
  ): Promise<Map<string, StoredTicket>> {
    if (externalIds.length === 0) {
      return new Map();
    }

    const rows = await trx
      .selectFrom("tickets")
      .select([
        "id",
        "external_id",
        "external_key",
        "external_url",
        "title",
        "body",
        "state",
        "labels",
        "author",
        "source_created_at",
        "source_updated_at",
        "meta",
      ])
      .where("source_id", "=", sourceId)
      .where("external_id", "in", [...externalIds])
      .execute();

    return new Map(rows.map((row) => [row.external_id, row]));
  }

  /**
   * Insert one canonical ticket.
   *
   * @param trx - The sync's transaction.
   * @param source - The source, which is also where `organization_id` comes from.
   * @param ticket - The canonical values.
   * @param syncedAt - The cycle's clock.
   * @returns The new row's id, for the estimation handoff.
   */
  private async insert(
    trx: Transaction<Database>,
    source: SyncSource,
    ticket: CanonicalTicket,
    syncedAt: Date,
  ): Promise<{ id: string }> {
    return trx
      .insertInto("tickets")
      .values({
        organization_id: source.organizationId,
        source_id: source.sourceId,
        external_id: ticket.externalId,
        external_key: ticket.externalKey,
        external_url: ticket.externalUrl,
        title: ticket.title,
        body: ticket.body,
        state: ticket.state,
        labels: JSON.stringify(ticket.labels),
        author: ticket.author,
        source_created_at: ticket.sourceCreatedAt,
        source_updated_at: ticket.sourceUpdatedAt,
        meta: JSON.stringify(ticket.meta),
        synced_at: syncedAt,
        // Spelled rather than left to the column default, because it is the sync's claim
        // rather than the schema's convenience: a freshly ingested ticket has no estimate, and
        // this is the value the estimation pipeline claims work by.
        sizing_status: DEFAULT_SIZING_STATUS,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  /**
   * Rewrite one canonical ticket.
   *
   * Only ever called for a row that actually differs — see this file's header on why an
   * unchanged row is left alone. `sizing_status` is **not** in the set: it is the one column
   * this product owns, and a sync that reset it would undo the pipeline's work every time
   * somebody edited a title.
   *
   * @param trx - The sync's transaction.
   * @param id - The stored row.
   * @param ticket - The canonical values, as the tracker now has them.
   * @param syncedAt - The cycle's clock.
   */
  private async update(
    trx: Transaction<Database>,
    id: string,
    ticket: CanonicalTicket,
    syncedAt: Date,
  ): Promise<void> {
    await trx
      .updateTable("tickets")
      .set({
        external_key: ticket.externalKey,
        external_url: ticket.externalUrl,
        title: ticket.title,
        body: ticket.body,
        state: ticket.state,
        labels: JSON.stringify(ticket.labels),
        author: ticket.author,
        source_created_at: ticket.sourceCreatedAt,
        source_updated_at: ticket.sourceUpdatedAt,
        meta: JSON.stringify(ticket.meta),
        synced_at: syncedAt,
      })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Move the source's freshness stamp, watermark and status.
   *
   * The last statement of the transaction, and the one the whole *"freshness can never claim a
   * sync that partly failed"* argument rests on.
   *
   * **It also clears a previous failure**, which is why `status` and `status_reason` are set
   * here unconditionally rather than only when they changed. A source that was rate limited an
   * hour ago and has just synced cleanly is `active` with nothing to explain, and the only
   * moment that is knowable is the moment a sync succeeds. Writing them from
   * {@link markFailure} and not from here would mean a source stayed red until somebody
   * noticed.
   *
   * @param trx - The sync's transaction.
   * @param write - The sync.
   */
  private async stampSource(trx: Transaction<Database>, write: SyncWrite): Promise<void> {
    await trx
      .updateTable("ticket_sources")
      .set({
        synced_at: write.syncedAt,
        status: "active",
        status_reason: null,
        // Null leaves the stored cursor alone rather than clearing it: a provider that returned
        // no watermark has none to record, and `ticket_sources_cursor_after_sync` reads that as
        // the legitimate state it is — synced, with nothing to resume from.
        ...(write.cursor === null ? {} : { sync_cursor: write.cursor }),
      })
      .where("id", "=", write.source.sourceId)
      .execute();
  }
}

/**
 * One entry for the estimation handoff.
 *
 * @param source - The source the ticket came from.
 * @param ticketId - `tickets.id`, as the insert or the stored row gave it.
 * @param ticket - The canonical values, for the display key a log line prints.
 * @param reason - Why it is being handed over.
 * @returns The handoff entry.
 */
function handoff(
  source: SyncSource,
  ticketId: string,
  ticket: CanonicalTicket,
  reason: EstimableTicket["reason"],
): EstimableTicket {
  return {
    organizationId: source.organizationId,
    ticketId,
    sourceId: source.sourceId,
    sourceKind: source.kind,
    externalKey: ticket.externalKey,
    reason,
  };
}

/**
 * Has anything the tracker owns changed?
 *
 * Compared field by field rather than by `source_updated_at` alone. Most trackers do bump that
 * column on every change, so the cheaper test would usually agree — but *usually* is the wrong
 * standard for the predicate that decides whether a row is written at all, *most* is a weaker
 * word than it was when only GitHub was involved, and a field-wise comparison also heals a row
 * that a previous sync stored wrongly or a seed wrote by hand.
 *
 * `external_id` is not compared: it is the key the two were matched on, so it cannot differ.
 *
 * @param stored - The row as it is.
 * @param ticket - The ticket as the tracker now has it.
 * @returns `true` when the two differ in any mirrored column.
 */
function differs(stored: StoredTicket, ticket: CanonicalTicket): boolean {
  return (
    stored.external_key !== ticket.externalKey ||
    stored.external_url !== ticket.externalUrl ||
    stored.title !== ticket.title ||
    stored.body !== ticket.body ||
    stored.state !== ticket.state ||
    stored.author !== ticket.author ||
    stored.source_created_at.getTime() !== ticket.sourceCreatedAt.getTime() ||
    stored.source_updated_at.getTime() !== ticket.sourceUpdatedAt.getTime() ||
    // Order is part of the value: a tracker lists a ticket's labels in a stable order and the
    // tags render in it, so a reordering is a change a reader would see.
    JSON.stringify(stored.labels) !== JSON.stringify(ticket.labels) ||
    // `meta` is an open shape, so there is nothing finer to compare it by. Key order is
    // PostgreSQL's on the way out — `jsonb` sorts keys — and a provider's on the way in, so the
    // two are normalised before comparison rather than compared as written; without that, every
    // sync of every ticket would look like a change and `updated_at` would stop meaning
    // anything.
    canonicalJson(stored.meta) !== canonicalJson(ticket.meta)
  );
}

/**
 * A JSON value with its object keys in a fixed order.
 *
 * `jsonb` does not preserve key order, so `JSON.stringify` over a stored value and over a
 * provider's value compares two orderings rather than two values. Sorting both makes the
 * comparison about content, which is what {@link differs} is asking.
 *
 * Recursive, because `meta` is nested by convention — `{ "github": { "repo_id": … } }` — so
 * sorting only the top level would leave the same bug one level down.
 *
 * @param value - Any JSON value.
 * @returns Its canonical text. `undefined` never occurs: the inputs are a parsed `jsonb` column
 *   and an object literal, and `JSON.stringify` returns a string for both.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    typeof nested === "object" && nested !== null && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
      : nested,
  );
}
