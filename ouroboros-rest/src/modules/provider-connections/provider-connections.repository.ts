/**
 * Every statement the credential lifecycle issues — all against V015's
 * `provider_connections`, all scoped to one workspace.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)).
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement carries it — the same rule
 * `registry.repository.ts`, `pricing.repository.ts` and `dashboard.repository.ts` state,
 * and sharper here than in any of them: the rows this file writes carry sealed credentials,
 * and a `where id = $1` without the workspace beside it is one guessed uuid away from
 * another workspace's key. The id is globally unique, so the workspace predicate is
 * *redundant* for a correct caller and load-bearing for an incorrect one — which is exactly
 * when a predicate earns its place.
 *
 * That is also why the value comes from the tenant context and never from anything a caller
 * wrote. `provider-connections.controller.ts` reads it off `@CurrentTenant()`; there is no
 * `{orgId}` anywhere in these paths to be substituted.
 *
 * ## The sealed column is selected in exactly two methods, and written in two
 *
 * {@link ProviderConnectionsRepository.envelopeOf} and
 * {@link ProviderConnectionsRepository.envelopesFor} are the only statements below that
 * *read* `credentials_encrypted`, and each selects nothing else; {@link insert} and
 * {@link swapCredential} are the only two that write it. Every other read spells its columns
 * out — {@link CONNECTION_COLUMNS} — rather than using `selectAll`, so a column added to the
 * table later cannot become a response field by default, and the sealed one cannot be
 * carried into a resource by accident.
 *
 * `provider-connections.repository.spec.ts` compiles each statement and asserts which of
 * them name the column, which makes that a property of the SQL rather than of anybody's
 * care. It is the same assertion `registry.repository.spec.ts` makes, with the one
 * difference this ticket introduces: here the answer is not *none*, because revealing and
 * rotating a credential is what this module is for.
 *
 * ## The swap is one statement, and it is conditional
 *
 * {@link ProviderConnectionsRepository.swapCredential} is a single `update` — so there is no
 * window in which neither credential is active, which is the ticket's *rotate's swap is
 * atomic* — and it is conditional on the row still holding the envelope the live validation
 * was run against. That is what makes verify-then-retire safe against a concurrent rotation
 * or against the vault's re-encryption sweep landing in between: the loser is told, rather
 * than overwriting a value it never checked.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { NewProviderConnection, ProviderConnection } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";

/**
 * The columns every read below selects — the whole row except the sealed credential, the
 * health blob and the workspace.
 *
 * Written out rather than `selectAll()` for this file's header's reason. The three that are
 * absent are absent deliberately: `credentials_encrypted` is the point, `health` is Z.3's
 * and is served by `/api/v1/routing/providers`, and `organization_id` is a value the caller
 * supplied and would only be echoing back to itself.
 */
export const CONNECTION_COLUMNS = [
  "id",
  "kind",
  "display_name",
  "base_url",
  "status",
  "last_checked_at",
  "monthly_cap_cents",
  "added_by",
  "last_used_at",
  "capability_note",
  "enabled",
  "created_at",
  "updated_at",
] as const;

/** A connection as this module reads one — {@link CONNECTION_COLUMNS}, typed. */
export type ConnectionRow = Omit<
  ProviderConnection,
  "credentials_encrypted" | "health" | "organization_id"
>;

/**
 * What {@link ProviderConnectionsRepository.insert} is handed — a new row, minus its
 * credential.
 *
 * The sealed column is deliberately not part of it: it is a second parameter, so that the
 * only file in this module naming `credentials_encrypted` is this one.
 */
export type NewConnection = Omit<NewProviderConnection, "credentials_encrypted">;

/** The columns {@link ProviderConnectionsRepository.update} may write. */
export interface ConnectionPatch {
  readonly display_name?: string;
  readonly base_url?: string | null;
  readonly capability_note?: string | null;
  readonly monthly_cap_cents?: number | null;
  readonly enabled?: boolean;
  readonly status?: ProviderConnection["status"];
  readonly last_checked_at?: Date | null;
  readonly health?: Record<string, unknown>;
}

@Injectable()
export class ProviderConnectionsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of this workspace's connections.
   *
   * Ordered by name then id: mockup 07 is a list somebody scans for a provider they already
   * know, and the id breaks ties because `display_name` is deliberately not unique — two
   * cards called *Ollama* would otherwise page in whatever order the planner felt like,
   * which is how a row appears on two pages and another on none.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param window - The `limit`/`offset`, per the #31 convention.
   * @returns The rows and the workspace's total.
   */
  async list(
    organizationId: string,
    window: PageWindow,
  ): Promise<{ rows: ConnectionRow[]; total: number }> {
    const rows = await this.database.db
      .selectFrom("provider_connections")
      .select(CONNECTION_COLUMNS)
      .where("organization_id", "=", organizationId)
      .orderBy("display_name")
      .orderBy("id")
      .limit(window.limit)
      .offset(window.offset)
      .execute();

    const counted = await this.database.db
      .selectFrom("provider_connections")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("organization_id", "=", organizationId)
      .executeTakeFirstOrThrow();

    // `count(*)` is a `bigint`, which `pg` hands over as a string and is right to — see
    // `db/schema.ts`. A workspace's provider count is far inside a double, so the narrowing
    // is safe here in a way it is not for a token total.
    return { rows, total: Number(counted.total) };
  }

  /**
   * One connection of this workspace.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @returns The row, or `undefined` when this workspace has no such connection — including
   *   when another workspace does. Turning that into a `404` is the service's job, one layer
   *   up, where it is known to have come from a request.
   */
  async find(organizationId: string, connectionId: string): Promise<ConnectionRow | undefined> {
    return this.database.db
      .selectFrom("provider_connections")
      .select(CONNECTION_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
  }

  /**
   * One connection's sealed credential.
   *
   * **The only statement in this module that names `credentials_encrypted`**, and it selects
   * nothing else — see this file's header. Kept apart from {@link find} rather than folded
   * into it so that reading a connection and reading its credential are two decisions a
   * caller makes separately, and so the second one is greppable.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @returns The envelope, `null` for a provider that stores none, or `undefined` when this
   *   workspace has no such connection. Three answers rather than two, because *no
   *   credential* and *no connection* are different refusals — `409` and `404`.
   */
  async envelopeOf(
    organizationId: string,
    connectionId: string,
  ): Promise<string | null | undefined> {
    const row = await this.database.db
      .selectFrom("provider_connections")
      .select("credentials_encrypted")
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();

    return row?.credentials_encrypted;
  }

  /**
   * Several connections' sealed credentials, in one statement.
   *
   * The list path's answer to *what does each card's key row say*. A mask is computed from
   * the plaintext (see `masking.ts`), so a page of connections needs a page of envelopes —
   * and asking for them one at a time would be a query per card on the most-loaded read this
   * module has.
   *
   * **This does not make the decryption free.** Opening each envelope is still one key
   * lookup per *distinct key version* in the page, inside `VaultService`. That cost is
   * accepted deliberately: mockup 07 draws five cards, the alternative is storing the
   * suffix in a column of its own — a schema change this ticket's scope does not include —
   * and the page it serves is not one anybody polls.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionIds - The connections, as {@link list} returned them. An empty list
   *   issues no statement: `in ()` is not valid SQL in every dialect and an empty page has
   *   nothing to ask about.
   * @returns Envelope by connection id. A connection that stores no credential is present
   *   with `null` rather than absent, so a caller can tell *no credential* from *not in this
   *   workspace* without a second read.
   */
  async envelopesFor(
    organizationId: string,
    connectionIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (connectionIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("provider_connections")
      .select(["id", "credentials_encrypted"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", [...connectionIds])
      .execute();

    return new Map(rows.map((row) => [row.id, row.credentials_encrypted]));
  }

  /**
   * Create a connection.
   *
   * @param row - Everything but the credential, including the `id`. The id is chosen by the
   *   **caller**, and that is not incidental: the vault binds a ciphertext to
   *   `(organization, record)`, so the credential cannot be sealed until the row's identity
   *   is known — and a database-generated id would mean inserting the row first and sealing
   *   afterwards, which is a window in which a connection exists with no credential. See
   *   `provider-connections.service.ts`.
   * @param envelope - The sealed credential, or `null` for a provider that needs none. A
   *   parameter of its own rather than a field of `row`, so that `credentials_encrypted` is
   *   named in this file and in no other in the module — see this file's header, and
   *   `provider-connections.repository.spec.ts`, which reads the module's source to keep it
   *   that way.
   * @returns The row as stored, without its sealed column.
   */
  async insert(row: NewConnection, envelope: string | null): Promise<ConnectionRow> {
    return this.database.db
      .insertInto("provider_connections")
      .values({ ...row, credentials_encrypted: envelope })
      .returning(CONNECTION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Change a connection's settings.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @param patch - The columns to write. An empty patch is a caller's mistake rather than a
   *   no-op update — the service refuses a body that changes nothing before reaching here.
   * @returns The row after the change, or `undefined` when this workspace has no such
   *   connection.
   */
  async update(
    organizationId: string,
    connectionId: string,
    patch: ConnectionPatch,
  ): Promise<ConnectionRow | undefined> {
    return (
      this.database.db
        .updateTable("provider_connections")
        // `updated_at` is deliberately absent: V015 attaches `provider_connections_touch_updated_at`
        // to this table, so the column is the database's and `db/schema.ts` types it as
        // un-writable. A service that set it too would be racing a trigger for the same column.
        .set(patch)
        .where("organization_id", "=", organizationId)
        .where("id", "=", connectionId)
        .returning(CONNECTION_COLUMNS)
        .executeTakeFirst()
    );
  }

  /**
   * Replace a connection's credential, if it still holds the one that was validated against.
   *
   * One `update`, so the old credential is live until the instant the new one is — the
   * ticket's *no window where neither key is active*. There is no delete-then-insert here
   * and there is deliberately no transaction: a transaction around a single statement adds a
   * round trip and buys nothing PostgreSQL does not already promise.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @param previous - The envelope the row held when the new credential was validated, or
   *   `null` for a connection that had none. Compared with `is not distinct from`, which is
   *   the only comparison that treats two nulls as equal — a plain `=` against `null` is
   *   `null`, so a rotation onto a credential-less connection would silently match nothing.
   * @param next - The new envelope, already sealed.
   * @param checkedAt - When the live validation succeeded, stamped onto the row so the card
   *   foot reflects the check that authorised the swap rather than an older one.
   * @param health - What that check measured — `{latency_ms}`.
   * @returns The row after the swap, or `undefined` when the row had changed underneath. The
   *   service turns that into `409 provider_connection_changed`.
   */
  async swapCredential(
    organizationId: string,
    connectionId: string,
    previous: string | null,
    next: string,
    checkedAt: Date,
    health: Record<string, unknown>,
  ): Promise<ConnectionRow | undefined> {
    return this.database.db
      .updateTable("provider_connections")
      .set({
        credentials_encrypted: next,
        status: "active",
        last_checked_at: checkedAt,
        health,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .where("credentials_encrypted", "is not distinct from", previous)
      .returning(CONNECTION_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Remove a connection.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @returns Whether a row was removed. `false` means this workspace had no such connection
   *   — which the service answers `404` for, exactly as a read would.
   * @throws A foreign-key violation when aliases still resolve on the connection.
   *   `registry.errors.ts`'s `isProviderConnectionInUse` is what recognises it, and the
   *   service's pre-flight is what usually makes it unnecessary — see there on the race the
   *   pre-flight cannot close.
   */
  async remove(organizationId: string, connectionId: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("provider_connections")
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }
}
