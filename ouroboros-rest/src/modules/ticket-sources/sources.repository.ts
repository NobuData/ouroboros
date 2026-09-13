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
