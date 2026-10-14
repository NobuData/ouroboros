/**
 * Every statement the source-management API issues — the workspace-scoped reads through the
 * view, the insert, the three updates, and the one question the view cannot answer
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * A second repository beside `ticket-sources.repository.ts` rather than more methods on it, and
 * the split is the one `BacklogSyncModule` and `BacklogModule` draw: that file is the *loop's*
 * statements — unscoped by workspace, because its caller is a timer — and this is the
 * *request's*, where every statement takes an `organizationId` first because the caller is a
 * person acting in one workspace. `ticket-sources.repository.spec.ts` holds that file to *one*
 * `selectFrom("ticket_sources")`, and this file adds none: the credential's value is still read
 * by exactly one statement in this service, and it is that one.
 *
 * ---------------------------------------------------------------------------
 * **The view cannot say whether a credential is stored, so one statement asks the table.**
 *
 * `ticket_sources_public` omits `credentials_encrypted` outright — V030's mechanism for *a read
 * path cannot leak what it cannot select* — and the settings list needs exactly one bit from
 * that column: is it null. {@link SourcesRepository.credentialPresence} selects
 * `credentials_encrypted is not null` and nothing else, so no statement here ever has the
 * envelope in a row. The doc's *"the one statement that names the table for reading"* is
 * therefore still true of the **value**; this is a second statement that names the table and
 * reads a boolean about it, and it is written down as such rather than smuggled in.
 *
 * **Every write is scoped by `organization_id` in the `where`**, not only by id. A source id
 * guessed from another workspace matches zero rows and the service answers `404` — the same
 * answer a well-formed id that names nothing gets, which is the point.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { TicketSourceKind, TicketSourcePublic, TicketSourceStatus } from "../db/schema";
import { type Page, type PageWindow, pageOf } from "../tenancy/pagination";

/** What removing a source would delete, and what would refuse it — see `removalCounts`. */
export interface SourceRemovalCounts {
  /** The tickets ingested through it, in any state. */
  readonly tickets: number;
  /** The pull request records opened through it. */
  readonly pullRequests: number;
  /** The Planning draft batches that target it. */
  readonly draftBatches: number;
  /** Those of the batches an analyzer suggestion was drafted into — each one refuses removal. */
  readonly analyzerDraftBatches: number;
}

/** What an insert carries. `id` is minted by the caller: the vault binds a credential to it. */
export interface NewSourceRow {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: TicketSourceKind;
  readonly displayName: string;
  /** The provider's settings, minus the credential. Stored as `jsonb`. */
  readonly config: Readonly<Record<string, unknown>>;
  /** The sealed credential, or null while there is none. */
  readonly credentialsEncrypted: string | null;
}

/** What a `PATCH` may change. Every member optional; an absent one is left alone. */
export interface SourcePatch {
  readonly displayName?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly status?: TicketSourceStatus;
  /** Set explicitly, because clearing a reason is a write and absence must not be one. */
  readonly statusReason?: string | null;
}

/** The columns every read here selects — every column of the view, by name. */
const COLUMNS = [
  "id",
  "organization_id",
  "kind",
  "display_name",
  "config",
  "status",
  "status_reason",
  "sync_cursor",
  "synced_at",
  "created_at",
  "updated_at",
] as const;

@Injectable()
export class SourcesRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a workspace's sources, by display name.
   *
   * @param organizationId - The workspace.
   * @param window - The page.
   * @returns The page. Empty for a workspace that has added nothing — the guidance state, not
   *   a failure.
   */
  async list(organizationId: string, window: PageWindow): Promise<Page<TicketSourcePublic>> {
    const [rows, counted] = await Promise.all([
      this.database.db
        .selectFrom("ticket_sources_public")
        .select(COLUMNS)
        .where("organization_id", "=", organizationId)
        .orderBy("display_name", "asc")
        .orderBy("id", "asc")
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      this.database.db
        .selectFrom("ticket_sources_public")
        .select(({ fn }) => fn.countAll<string>().as("total"))
        .where("organization_id", "=", organizationId)
        .executeTakeFirstOrThrow(),
    ]);

    return pageOf(rows, Number(counted.total), window);
  }

  /**
   * One source, if it is this workspace's.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The row, or `undefined` — for a source that does not exist and for one that
   *   belongs to somebody else alike.
   */
  async find(organizationId: string, sourceId: string): Promise<TicketSourcePublic | undefined> {
    return this.database.db
      .selectFrom("ticket_sources_public")
      .select(COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();
  }

  /**
   * Whether each of these sources has a credential stored.
   *
   * The one statement here that names the table rather than the view — see this file's header.
   *
   * @param organizationId - The workspace.
   * @param sourceIds - Which sources.
   * @returns Source id to whether its sealed column is set. Absent for an id that matched no
   *   row of this workspace, which a caller reads as *no credential* — there is no source to
   *   have one.
   */
  async credentialPresence(
    organizationId: string,
    sourceIds: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>> {
    if (sourceIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("ticket_sources")
      .select(["id", sql<boolean>`credentials_encrypted is not null`.as("has_credential")])
      .where("organization_id", "=", organizationId)
      .where("id", "in", [...sourceIds])
      .execute();

    return new Map(rows.map((row) => [row.id, row.has_credential]));
  }

  /**
   * How much open work each of these sources has brought in
   * ([#285](https://github.com/NobuData/ouroboros/issues/285)).
   *
   * **Counted, never stored.** A column would have to be written by every path that closes a
   * ticket — a sync, a push, a webhook — and the first one that forgot would leave the *Tracker
   * Sync* card asserting a figure nothing could reproduce. `V030`'s
   * `tickets_organization_source_state_idx` is `(organization_id, source_id, state)`, which is
   * exactly this grouping's prefix, so the count is an index scan rather than a table one.
   *
   * One statement for the whole page rather than one per row: a workspace with four sources is
   * one aggregate, not four round trips.
   *
   * @param organizationId - The workspace.
   * @param sourceIds - Which sources.
   * @returns Source id to its number of `open` tickets. **Absent for a source with none** —
   *   `group by` produces no row for an empty group — which every caller reads as zero.
   */
  async openTicketCounts(
    organizationId: string,
    sourceIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (sourceIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("tickets")
      .select(({ fn }) => ["source_id", fn.countAll<string>().as("open_count")])
      .where("organization_id", "=", organizationId)
      .where("source_id", "in", [...sourceIds])
      .where("state", "=", "open")
      .groupBy("source_id")
      .execute();

    return new Map(rows.map((row) => [row.source_id, Number(row.open_count)]));
  }

  /**
   * What removing a source would take with it, and what would stop it (V138).
   *
   * Four counts in one statement, each over the column whose foreign key decides the row's
   * fate: tickets, pull request records and draft batches are deleted with the source by
   * `on delete cascade`; a draft batch an analyzer suggestion was drafted into cannot be
   * deleted at all, because the suggestion's own foreign key to it restricts.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The counts. All zero for a source that has brought nothing in — and for an id
   *   that names no source of this workspace, which the caller has already ruled out.
   */
  async removalCounts(organizationId: string, sourceId: string): Promise<SourceRemovalCounts> {
    // Raw SQL, as the analyzer's own statements are: `analysis_suggestions` is not among the
    // tables this module's typed schema describes.
    const { rows } = await sql<{
      tickets: string;
      pull_requests: string;
      draft_batches: string;
      analyzer_draft_batches: string;
    }>`
      select
        (select count(*) from ouroboros.tickets t
          where t.organization_id = ${organizationId} and t.source_id = ${sourceId}) as tickets,
        (select count(*) from ouroboros.pull_requests p
          where p.organization_id = ${organizationId} and p.source_id = ${sourceId}) as pull_requests,
        (select count(*) from ouroboros.draft_batches b
          where b.organization_id = ${organizationId}
            and b.target_source_id = ${sourceId}) as draft_batches,
        (select count(*) from ouroboros.draft_batches b
          where b.organization_id = ${organizationId}
            and b.target_source_id = ${sourceId}
            and exists (select 1 from ouroboros.analysis_suggestions s
                         where s.draft_batch_id = b.id)) as analyzer_draft_batches
    `.execute(this.database.db);
    const row = rows[0];

    return {
      tickets: Number(row?.tickets ?? 0),
      pullRequests: Number(row?.pull_requests ?? 0),
      draftBatches: Number(row?.draft_batches ?? 0),
      analyzerDraftBatches: Number(row?.analyzer_draft_batches ?? 0),
    };
  }

  /**
   * Remove a source, and with it everything the schema cascades from it (V030, V034, V036,
   * V052; V138 for what made the cascade complete).
   *
   * One statement, so it is one transaction: either the source and all of it go, or nothing
   * does.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns Whether a row was removed. `false` for an id that names no source of this
   *   workspace — including one somebody else removed a moment ago.
   * @throws Whatever the driver throws — a foreign-key violation (`23503`) in particular, when
   *   a row that restricts appeared after the counts were read.
   */
  async remove(organizationId: string, sourceId: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("ticket_sources")
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Store a new source.
   *
   * @param row - What to store. The id is the caller's — see {@link NewSourceRow}.
   * @throws Whatever the driver throws — a unique violation on
   *   `ticket_sources_organization_name_key` in particular, which the service turns into a
   *   `409`.
   */
  async insert(row: NewSourceRow): Promise<void> {
    await this.database.db
      .insertInto("ticket_sources")
      .values({
        id: row.id,
        organization_id: row.organizationId,
        kind: row.kind,
        display_name: row.displayName,
        config: JSON.stringify(row.config),
        credentials_encrypted: row.credentialsEncrypted,
      })
      .execute();
  }

  /**
   * Change a source's name, settings or status.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param patch - What changes. A patch with nothing in it issues no statement at all, and
   *   answers as if one row had matched — a no-op is not a `404`.
   * @returns Whether a row of this workspace matched.
   */
  async update(organizationId: string, sourceId: string, patch: SourcePatch): Promise<boolean> {
    const set = {
      ...(patch.displayName === undefined ? {} : { display_name: patch.displayName }),
      ...(patch.config === undefined ? {} : { config: JSON.stringify(patch.config) }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.statusReason === undefined ? {} : { status_reason: patch.statusReason }),
    };

    if (Object.keys(set).length === 0) {
      return true;
    }

    const result = await this.database.db
      .updateTable("ticket_sources")
      .set(set)
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Replace a source's sealed credential.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param sealed - The envelope, as `VaultService` produced it for this source's id.
   * @returns Whether a row of this workspace matched.
   */
  async setCredential(organizationId: string, sourceId: string, sealed: string): Promise<boolean> {
    const result = await this.database.db
      .updateTable("ticket_sources")
      .set({ credentials_encrypted: sealed })
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }
}
