/**
 * Every statement the alias lifecycle issues
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)), and nothing that decides.
 *
 * **The workspace is a parameter of every statement.** Every read and every write below
 * carries `organization_id` — into the `where`, into the join, into the row — so a row from
 * another workspace cannot be returned, updated or deleted through this class whatever id a
 * caller holds. `aliases.repository.spec.ts` asserts that per statement.
 *
 * **Reads take the pool; writes take a transaction the service opens.** A write here is two
 * statements that must commit together — the row and the `alias_revisions` record describing
 * it — and V021's argument holds unchanged: a revision that survived a rolled-back write would
 * be an audit trail describing something that did not happen. So `insert`, `update`, `delete`
 * and `recordRevision` take the `Transaction` and never open one, and the service is where
 * the boundary is.
 *
 * **The reference guard is called as the function it is.** `alias_reference_guard()` (V023)
 * locks the alias `FOR UPDATE` before it answers, and `deleteGuardedReferences` runs it inside
 * the delete's own transaction — so the referrer list a `409` names is still true when the
 * `delete` after it runs, which is the whole difference between the guard and the view. The
 * view is read directly everywhere else, where the answer is rendered rather than acted on.
 *
 * **Discovery is asked, not trusted to a trigger.** V017's soft validation raises a PostgreSQL
 * *warning* when an alias names a model discovery has not reported; a warning is a notice on
 * the wire and nothing here would surface it. `discovery()` asks the same predicate the
 * trigger uses — `provider_model_discovered()` — and the service turns the answer into a
 * warning the response carries. Surfaced rather than swallowed, which is the ticket's phrase.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  SCHEMA_NAME,
  type AliasRevisionAction,
  type AliasRevisionDiff,
  type Database,
} from "../db/schema";
import type { AliasState } from "./aliases.changes";
import type {
  AliasConnectionRow,
  AliasReferenceRow,
  AliasRow,
  DiscoveryVerdict,
  ModelOptionRow,
} from "./aliases.rows";

/** What one write leaves in `alias_revisions`. */
export interface RevisionRecord {
  organizationId: string;
  /** The alias the write was about, or null once it has been deleted. */
  aliasId: string | null;
  /** The name as it read after the write. */
  alias: string;
  actor: string | null;
  action: AliasRevisionAction;
  diff: AliasRevisionDiff;
}

/** Either side of the transaction boundary. */
type Executor = Kysely<Database> | Transaction<Database>;

/** The columns every alias read selects, so the list and the single read return one shape. */
const ALIAS_COLUMNS = [
  "a.id",
  "a.organization_id",
  "a.alias",
  "a.provider_connection_id",
  "a.model_id",
  "a.enabled",
  "a.params",
  "a.restrictions",
  "a.notes",
  "a.updated_by",
  "a.created_at",
  "a.updated_at",
  "c.kind as connection_kind",
  "c.display_name as connection_display_name",
] as const;

@Injectable()
export class AliasesRepository {
  /**
   * @param database - The pool, and the transaction helper the service opens writes with.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every alias in the workspace, ordered by name.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The rows, unbound ones included.
   */
  async list(organizationId: string): Promise<AliasRow[]> {
    return this.aliasQuery(this.database.db, organizationId).orderBy("a.alias").execute();
  }

  /**
   * One alias by id.
   *
   * @param organizationId - The workspace.
   * @param aliasId - `model_aliases.id`.
   * @returns The row, or undefined for no such alias in this workspace.
   */
  async find(organizationId: string, aliasId: string): Promise<AliasRow | undefined> {
    return this.aliasQuery(this.database.db, organizationId)
      .where("a.id", "=", aliasId)
      .executeTakeFirst();
  }

  /**
   * One alias by name.
   *
   * @param organizationId - The workspace.
   * @param alias - `model_aliases.alias`.
   * @returns The row, or undefined for no such name in this workspace.
   */
  async findByName(organizationId: string, alias: string): Promise<AliasRow | undefined> {
    return this.aliasQuery(this.database.db, organizationId)
      .where("a.alias", "=", alias)
      .executeTakeFirst();
  }

  /**
   * What references some aliases — the view, read without a lock.
   *
   * For rendering: the `Used by` column, the inspector's chips, and the referrer list a
   * response carries. A decision that must still be true after the next statement reads
   * {@link AliasesRepository.guardedReferences} instead.
   *
   * @param organizationId - The workspace.
   * @param aliasIds - Whose references. Empty answers empty without a round trip.
   * @returns The rows, routes before rules and each ordered by label — the order mockup 21
   *   draws the chips in.
   */
  async references(
    organizationId: string,
    aliasIds: readonly string[],
  ): Promise<AliasReferenceRow[]> {
    if (aliasIds.length === 0) {
      return [];
    }

    return this.database.db
      .selectFrom("alias_references")
      .select(["alias_id", "kind", "ref_id", "ref_label", "blocking"])
      .where("organization_id", "=", organizationId)
      .where("alias_id", "in", [...aliasIds])
      .orderBy("kind", "desc")
      .orderBy("ref_label")
      .execute();
  }

  /**
   * What references one alias, under the lock a delete needs.
   *
   * `alias_reference_guard()` takes `FOR UPDATE` on the alias before it answers, so a route
   * save that would add a reference waits behind this transaction rather than slipping in
   * between the check and the delete. See V023 and `tests/verify-alias-reference-guard.sh`.
   *
   * @param trx - The transaction the delete will run in.
   * @param organizationId - The workspace.
   * @param aliasId - Whose references.
   * @returns The rows, in the same order {@link AliasesRepository.references} answers.
   */
  async guardedReferences(
    trx: Transaction<Database>,
    organizationId: string,
    aliasId: string,
  ): Promise<AliasReferenceRow[]> {
    const { rows } = await sql<AliasReferenceRow>`
      select alias_id, kind, ref_id, ref_label, blocking
        from ${sql.id(SCHEMA_NAME)}.alias_reference_guard(${organizationId}, ${aliasId}::uuid)
       order by kind desc, ref_label
    `.execute(trx);

    return rows;
  }

  /**
   * One connection, as far as a binding needs to know it.
   *
   * @param organizationId - The workspace.
   * @param connectionId - `provider_connections.id`.
   * @returns The row, or undefined for no such connection in this workspace.
   */
  async connection(
    organizationId: string,
    connectionId: string,
  ): Promise<AliasConnectionRow | undefined> {
    return this.database.db
      .selectFrom("provider_connections")
      .select(["id", "kind", "display_name"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
  }

  /**
   * Whether discovery has reported a model on a connection — V017's predicate, asked directly.
   *
   * @param connectionId - The connection. Tenancy is the caller's: a connection id reaches
   *   here only after {@link AliasesRepository.connection} answered for this workspace.
   * @param modelId - The model.
   * @returns The verdict.
   */
  async discovery(connectionId: string, modelId: string): Promise<DiscoveryVerdict> {
    const { rows } = await sql<DiscoveryVerdict>`
      select ${sql.id(SCHEMA_NAME)}.provider_model_discovered(${connectionId}::uuid, ${modelId})
               as discovered,
             exists (select 1
                       from ${sql.id(SCHEMA_NAME)}.provider_models m
                      where m.provider_connection_id = ${connectionId}::uuid)
               as catalogued
    `.execute(this.database.db);

    return rows[0] ?? { discovered: false, catalogued: false };
  }

  /**
   * The models discovery has reported on a connection — the inspector's select.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @returns The rows, ordered by model id. Empty when discovery has not run.
   */
  async modelOptions(organizationId: string, connectionId: string): Promise<ModelOptionRow[]> {
    return this.database.db
      .selectFrom("provider_models as m")
      .innerJoin("provider_connections as c", "c.id", "m.provider_connection_id")
      .select(["m.model_id", "m.display", "m.discovered_at", "m.meta"])
      .where("c.organization_id", "=", organizationId)
      .where("m.provider_connection_id", "=", connectionId)
      .orderBy("m.model_id")
      .execute();
  }

  /**
   * The names in the workspace that begin with a prefix — what a duplicate must not collide
   * with.
   *
   * No wildcard escaping: an alias is lower-case kebab by V015's CHECK, so a prefix built from
   * one carries no `%` or `_` to escape.
   *
   * @param organizationId - The workspace.
   * @param prefix - `<alias>-copy`.
   * @returns The names.
   */
  async namesStartingWith(organizationId: string, prefix: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("model_aliases")
      .select("alias")
      .where("organization_id", "=", organizationId)
      .where("alias", "like", `${prefix}%`)
      .execute();

    return rows.map((row) => row.alias);
  }

  /**
   * Create an alias.
   *
   * @param trx - The write's transaction.
   * @param organizationId - The workspace.
   * @param actorId - Who is creating it, for `updated_by`.
   * @param state - What to store.
   * @returns The new row's id.
   * @throws The driver's unique violation when the name is taken — the service maps it.
   */
  async insert(
    trx: Transaction<Database>,
    organizationId: string,
    actorId: string,
    state: AliasState,
  ): Promise<string> {
    const row = await trx
      .insertInto("model_aliases")
      .values({
        organization_id: organizationId,
        alias: state.alias,
        provider_connection_id: state.connectionId,
        model_id: state.modelId,
        enabled: state.enabled,
        params: sql`${JSON.stringify(state.params)}::jsonb`,
        restrictions: sql`${JSON.stringify(state.restrictions)}::jsonb`,
        notes: state.notes,
        updated_by: actorId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Rewrite an alias's editable columns.
   *
   * Every column, not only the changed ones: the service has already composed the whole
   * after-state and diffed it, and a `set` of the whole is one statement that cannot
   * disagree with that diff.
   *
   * @param trx - The write's transaction.
   * @param organizationId - The workspace.
   * @param aliasId - Which alias.
   * @param actorId - Who is writing, for `updated_by`.
   * @param state - What the row should now say.
   * @returns Whether a row was written.
   */
  async update(
    trx: Transaction<Database>,
    organizationId: string,
    aliasId: string,
    actorId: string,
    state: AliasState,
  ): Promise<boolean> {
    const result = await trx
      .updateTable("model_aliases")
      .set({
        alias: state.alias,
        provider_connection_id: state.connectionId,
        model_id: state.modelId,
        enabled: state.enabled,
        params: sql`${JSON.stringify(state.params)}::jsonb`,
        restrictions: sql`${JSON.stringify(state.restrictions)}::jsonb`,
        notes: state.notes,
        updated_by: actorId,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", aliasId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Delete an alias.
   *
   * Runs after {@link AliasesRepository.guardedReferences} in the same transaction, so the
   * foreign keys it could meet — a hop's `restrict`, a rule's deferred trigger — are the race
   * the guard exists to close rather than the ordinary refusal.
   *
   * @param trx - The write's transaction.
   * @param organizationId - The workspace.
   * @param aliasId - Which alias.
   * @returns Whether a row was deleted.
   */
  async delete(
    trx: Transaction<Database>,
    organizationId: string,
    aliasId: string,
  ): Promise<boolean> {
    const result = await trx
      .deleteFrom("model_aliases")
      .where("organization_id", "=", organizationId)
      .where("id", "=", aliasId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Record what a write did.
   *
   * @param trx - The write's transaction, so the record and the row commit together or not
   *   at all.
   * @param record - Who, what, and the diff. The diff is non-empty by construction —
   *   `aliases.changes.ts` answers `null` for a write that changed nothing, and V025 refuses
   *   an empty document anyway.
   * @returns The revision's id, which the write answers with.
   */
  async recordRevision(trx: Transaction<Database>, record: RevisionRecord): Promise<string> {
    const row = await trx
      .insertInto("alias_revisions")
      .values({
        organization_id: record.organizationId,
        alias_id: record.aliasId,
        alias: record.alias,
        actor: record.actor,
        action: record.action,
        diff: sql<AliasRevisionDiff>`${JSON.stringify(record.diff)}::jsonb`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * The one select every alias read is built from — the alias left-joined to its connection,
   * scoped to the workspace.
   *
   * @param executor - The pool, or a transaction.
   * @param organizationId - The workspace.
   * @returns The query, for a caller to narrow and order.
   */
  private aliasQuery(executor: Executor, organizationId: string) {
    return executor
      .selectFrom("model_aliases as a")
      .leftJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select(ALIAS_COLUMNS)
      .where("a.organization_id", "=", organizationId);
  }
}
