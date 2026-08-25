/**
 * The alias lifecycle — every write mockup 21's registry can make, with the guards that make
 * its caption true ([#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * Four rules the ticket states as hard requirements, and where each one lives:
 *
 * **Rebind is one row and touches nothing else.** *"Point coder-max at Bedrock tomorrow; zero
 * workflow or route edits."* {@link AliasesService.update} with a new `connectionId` writes
 * `model_aliases.provider_connection_id` and nothing in `route_hops`, `escalation_rules` or a
 * workflow document — those hold the alias by id or by name, both of which stand still — and
 * the answer states what the next resolution will now reach. `aliases.integration-spec.ts`
 * asserts the four references survive and the resolution moves.
 *
 * **Delete is blocked, and says by what.** {@link AliasesService.remove} asks
 * `alias_reference_guard()` inside the delete's own transaction, so the referrer list a `409`
 * carries is still true when the `delete` after it would have run.
 *
 * **Rename is delete-shaped.** A workflow document holds `{"alias": "coder-max"}` by name, so
 * renaming a referenced alias breaks it as a delete would (decision **R5**). The same list,
 * as a `422` naming the field that cannot change.
 *
 * **An unbound alias is never enabled through this API.** V019's CHECK would refuse it too;
 * what the user is owed is `422 model_alias_unbound` with the pointer to Providers & keys,
 * decided here before any statement runs. Unbinding an enabled alias switches it off, with a
 * warning saying so, because the alternative is a write the database refuses.
 *
 * **Every write leaves exactly one revision, and a write that changed nothing leaves none.**
 * The row and its `alias_revisions` record are one transaction; a `PATCH` whose every field
 * already held that value is a `200` with `revisionId: null` (V021's precedent). Refusals are
 * decided before the transaction opens wherever a read can decide them, so a `4xx` here means
 * nothing was written — the one exception being the reference guard, which needs the lock.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";
import {
  aliasDiff,
  bindingChanged,
  copyName,
  COPY_SUFFIX,
  DUPLICATE_OF_KEY,
  requiredDiff,
  revisionAction,
  stateOf,
  type AliasState,
} from "./aliases.changes";
import { MAX_ALIAS_LENGTH, type CreateAliasDto, type UpdateAliasDto } from "./aliases.dto";
import {
  aliasIdNotFound,
  aliasNameTaken,
  aliasReferenced,
  aliasRenameBlocked,
  aliasUnbound,
  copyNameTooLong,
  isAliasNameTaken,
  PROVIDERS_FIX_PATH,
  type ReferrerDetail,
} from "./aliases.errors";
import { AliasesRepository } from "./aliases.repository";
import type { AliasConnectionRow, AliasReferenceRow, AliasRow } from "./aliases.rows";
import {
  ALIAS_WARNINGS,
  referencesByAlias,
  toAliasResource,
  toModelOptionResource,
  toReferenceResource,
  type AliasChangeResource,
  type AliasConnectionResource,
  type AliasReferenceResource,
  type AliasResolutionPreviewResource,
  type AliasWarningResource,
  type ModelAliasListResource,
  type ModelOptionListResource,
} from "./aliases.resources";
import { ParamSchemaService } from "./params.service";
import { registryConnectionNotFound } from "./registry.errors";

@Injectable()
export class AliasesService {
  /**
   * @param aliases - The statements.
   * @param params - CH.2's write validation — the schema that rendered the inspector is the
   *   schema that validates the write, re-read against the binding *after* this write.
   * @param database - The transaction boundary.
   */
  constructor(
    private readonly aliases: AliasesRepository,
    private readonly params: ParamSchemaService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Every alias in the workspace, with what references each.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The list, ordered by name. Empty for a workspace with none — CI.6's empty
   *   registry, not a failure.
   */
  async list(organizationId: string): Promise<ModelAliasListResource> {
    const rows = await this.aliases.list(organizationId);
    const byAlias = referencesByAlias(
      await this.aliases.references(
        organizationId,
        rows.map((row) => row.id),
      ),
    );

    return {
      aliases: rows.map((row) => toAliasResource(row, byAlias.get(row.id) ?? [])),
    };
  }

  /**
   * Create an alias — bound, or unbound.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is creating it, from the session.
   * @param body - The validated request.
   * @returns The alias as stored, its revision, and the warnings: the discovery warning for a
   *   bound model discovery has not reported, or the Providers & keys pointer for an unbound
   *   one.
   * @throws {NotFoundError} `404 provider_connection_not_found` for a `connectionId` this
   *   workspace does not have.
   * @throws {InvalidRequestError} `422 model_alias_params_invalid` when the params do not suit
   *   the model; `422 model_alias_name_taken` when the name is.
   */
  async create(
    organizationId: string,
    actorId: string,
    body: CreateAliasDto,
  ): Promise<AliasChangeResource> {
    const connection = await this.connectionFor(organizationId, body.connectionId ?? null);
    const state: AliasState = {
      alias: body.alias,
      connectionId: connection?.id ?? null,
      modelId: body.modelId,
      // Forced off for an unbound alias, whatever the body said: V019 refuses the other thing.
      enabled: connection === null ? false : (body.enabled ?? true),
      params: body.params ?? {},
      restrictions: body.restrictions ?? {},
      notes: body.notes ?? null,
    };

    await this.assertParams(organizationId, state);
    await this.assertNameFree(organizationId, state.alias);

    const warnings = await this.warningsFor(state, connection, true);
    const { aliasId, revisionId } = await this.writing(state.alias, async (trx) => {
      const id = await this.aliases.insert(trx, organizationId, actorId, state);
      const revision = await this.aliases.recordRevision(trx, {
        organizationId,
        aliasId: id,
        alias: state.alias,
        actor: actorId,
        action: "created",
        diff: requiredDiff(null, state),
      });

      return { aliasId: id, revisionId: revision };
    });

    return this.answer(organizationId, aliasId, revisionId, warnings, null, []);
  }

  /**
   * Edit, rebind, rename, or switch an alias.
   *
   * Only the fields present are written; the after-state is composed from the row and the
   * body, checked whole, diffed against the row, and written whole. See the class header for
   * the four guards.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is editing it, from the session.
   * @param aliasId - Which alias.
   * @param body - The validated request.
   * @returns The alias as stored, the revision (null when nothing changed), the warnings, and
   *   what the write did: `nextResolution` after a rebind, `droppedHops` after switching a
   *   referenced alias off.
   * @throws {NotFoundError} `404 model_alias_not_found`; `404 provider_connection_not_found`.
   * @throws {InvalidRequestError} `422 model_alias_unbound` for enabling an unbound alias;
   *   `422 model_alias_rename_blocked` for renaming a referenced one; `422
   *   model_alias_name_taken`; `422 model_alias_params_invalid`.
   */
  async update(
    organizationId: string,
    actorId: string,
    aliasId: string,
    body: UpdateAliasDto,
  ): Promise<AliasChangeResource> {
    const row = await this.require(organizationId, aliasId);
    const before = stateOf(row);
    const connection =
      body.connectionId === undefined
        ? currentConnection(row)
        : await this.connectionFor(organizationId, body.connectionId);

    let after: AliasState = {
      alias: body.alias ?? before.alias,
      connectionId:
        body.connectionId === undefined ? before.connectionId : (connection?.id ?? null),
      modelId: body.modelId ?? before.modelId,
      enabled: body.enabled ?? before.enabled,
      params: body.params ?? before.params,
      restrictions: body.restrictions ?? before.restrictions,
      notes: body.notes === undefined ? before.notes : body.notes,
    };

    if (after.connectionId === null && after.enabled) {
      // Asked to enable an unbound alias: the designed refusal, with the pointer. Asked to
      // unbind an enabled one without saying otherwise: switched off, with a warning, because
      // the row the body describes is one the database refuses.
      if (body.enabled === true) {
        throw aliasUnbound(after.alias);
      }

      after = { ...after, enabled: false };
    }

    const references = await this.aliases.references(organizationId, [aliasId]);

    if (after.alias !== before.alias) {
      if (references.length > 0) {
        throw aliasRenameBlocked(before.alias, references.map(toReferrer));
      }

      await this.assertNameFree(organizationId, after.alias);
    }

    // Against the binding *after* the write: a rebind changes what the params have to be
    // legal for, and the stored params are re-checked against the new model whether or not
    // the body sent any.
    await this.assertParams(organizationId, after);

    const diff = aliasDiff(before, after);

    if (diff === null) {
      return this.answer(organizationId, aliasId, null, [], null, []);
    }

    const rebound = bindingChanged(before, after);
    const warnings = await this.warningsFor(after, connection, rebound);
    const revisionId = await this.writing(after.alias, async (trx) => {
      const written = await this.aliases.update(trx, organizationId, aliasId, actorId, after);

      if (!written) {
        throw aliasIdNotFound(aliasId);
      }

      return this.aliases.recordRevision(trx, {
        organizationId,
        aliasId,
        alias: after.alias,
        actor: actorId,
        action: revisionAction(before, after),
        diff,
      });
    });

    const nextResolution: AliasResolutionPreviewResource | null = rebound
      ? {
          connection: connection === null ? null : toConnection(connection),
          modelId: after.modelId,
        }
      : null;
    const droppedHops = before.enabled && !after.enabled ? references.map(toReferenceResource) : [];

    return this.answer(organizationId, aliasId, revisionId, warnings, nextResolution, droppedHops);
  }

  /**
   * Copy an alias to `<alias>-copy`, switched off.
   *
   * Binding, params, restrictions and notes are copied; `enabled` is not, so a duplicate never
   * starts taking traffic — it exists to be edited into something else first.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is duplicating it, from the session.
   * @param aliasId - Which alias.
   * @returns The copy as stored, its revision, and the unbound warning when the source was.
   * @throws {NotFoundError} `404 model_alias_not_found`.
   * @throws {InvalidRequestError} `422 model_alias_copy_name_too_long` when the suffixed name
   *   would not fit.
   */
  async duplicate(
    organizationId: string,
    actorId: string,
    aliasId: string,
  ): Promise<AliasChangeResource> {
    const row = await this.require(organizationId, aliasId);
    const source = stateOf(row);
    const taken = new Set(
      await this.aliases.namesStartingWith(organizationId, `${source.alias}${COPY_SUFFIX}`),
    );
    const name = copyName(source.alias, taken);

    if (name.length > MAX_ALIAS_LENGTH) {
      throw copyNameTooLong(source.alias, name, MAX_ALIAS_LENGTH);
    }

    const copy: AliasState = { ...source, alias: name, enabled: false };
    const warnings = copy.connectionId === null ? [unboundWarning(copy.alias)] : [];
    const { copyId, revisionId } = await this.writing(name, async (trx) => {
      const id = await this.aliases.insert(trx, organizationId, actorId, copy);
      const revision = await this.aliases.recordRevision(trx, {
        organizationId,
        aliasId: id,
        alias: copy.alias,
        actor: actorId,
        action: "duplicated",
        diff: {
          ...requiredDiff(null, copy),
          [DUPLICATE_OF_KEY]: { from: null, to: source.alias },
        },
      });

      return { copyId: id, revisionId: revision };
    });

    return this.answer(organizationId, copyId, revisionId, warnings, null, []);
  }

  /**
   * Delete an alias — refused, naming every referrer, while anything references it.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is deleting it, from the session.
   * @param aliasId - Which alias.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 model_alias_not_found`.
   * @throws {ConflictError} `409 model_alias_referenced`, with `details.references`.
   */
  async remove(organizationId: string, actorId: string, aliasId: string): Promise<void> {
    const row = await this.require(organizationId, aliasId);
    const before = stateOf(row);

    await this.database.transaction(async (trx) => {
      const references = await this.aliases.guardedReferences(trx, organizationId, aliasId);

      if (references.length > 0) {
        throw aliasReferenced(before.alias, references.map(toReferrer));
      }

      // Recorded first, while the row still exists to reference: V025's `on delete set null`
      // then clears `alias_id` as the row goes, which is the shape a deleted revision keeps.
      await this.aliases.recordRevision(trx, {
        organizationId,
        aliasId,
        alias: before.alias,
        actor: actorId,
        action: "deleted",
        diff: requiredDiff(before, null),
      });

      if (!(await this.aliases.delete(trx, organizationId, aliasId))) {
        throw aliasIdNotFound(aliasId);
      }
    });
  }

  /**
   * The models a connection has, as discovery reported them — the inspector's select.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @returns The connection and its models, ordered by id.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   */
  async modelOptions(
    organizationId: string,
    connectionId: string,
  ): Promise<ModelOptionListResource> {
    const connection = await this.requireConnection(organizationId, connectionId);
    const rows = await this.aliases.modelOptions(organizationId, connectionId);

    return { connection: toConnection(connection), models: rows.map(toModelOptionResource) };
  }

  /**
   * The row, or the designed 404.
   *
   * @param organizationId - The workspace.
   * @param aliasId - Which alias.
   * @returns The row.
   * @throws {NotFoundError} `404 model_alias_not_found` — the same answer for *no such alias*
   *   and *another workspace's*.
   */
  private async require(organizationId: string, aliasId: string): Promise<AliasRow> {
    const row = await this.aliases.find(organizationId, aliasId);

    if (row === undefined) {
      throw aliasIdNotFound(aliasId);
    }

    return row;
  }

  /**
   * The connection, or the designed 404.
   *
   * @param organizationId - The workspace.
   * @param connectionId - Which connection.
   * @returns The row.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   */
  private async requireConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<AliasConnectionRow> {
    const connection = await this.aliases.connection(organizationId, connectionId);

    if (connection === undefined) {
      throw registryConnectionNotFound(connectionId);
    }

    return connection;
  }

  /**
   * The connection a body names, or null for none — the unbound state.
   *
   * @param organizationId - The workspace.
   * @param connectionId - What the body carried, `null` for unbound.
   * @returns The row, or null.
   */
  private async connectionFor(
    organizationId: string,
    connectionId: string | null,
  ): Promise<AliasConnectionRow | null> {
    return connectionId === null ? null : this.requireConnection(organizationId, connectionId);
  }

  /**
   * CH.2's write validation, against the binding the state describes.
   *
   * @param organizationId - The workspace.
   * @param state - The after-state.
   * @throws {InvalidRequestError} `422 model_alias_params_invalid`.
   */
  private async assertParams(organizationId: string, state: AliasState): Promise<void> {
    await this.params.assertWriteValid(organizationId, state.connectionId, state.modelId, {
      params: state.params,
      restrictions: state.restrictions,
    });
  }

  /**
   * The name is free in this workspace, or the designed 422.
   *
   * A pre-check, so the ordinary collision is refused before any statement runs; the race two
   * creates of one name can still lose is caught by {@link AliasesService.writing}.
   *
   * @param organizationId - The workspace.
   * @param alias - The name.
   * @throws {InvalidRequestError} `422 model_alias_name_taken`.
   */
  private async assertNameFree(organizationId: string, alias: string): Promise<void> {
    if ((await this.aliases.findByName(organizationId, alias)) !== undefined) {
      throw aliasNameTaken(alias);
    }
  }

  /**
   * A write, in its transaction, with the unique violation mapped to the designed 422.
   *
   * @param alias - The name the write is storing, for the message.
   * @param work - The statements.
   * @returns Whatever the work resolved to, once committed.
   */
  private async writing<T>(
    alias: string,
    work: (trx: Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (isAliasNameTaken(error)) {
        throw aliasNameTaken(alias);
      }

      throw error;
    }
  }

  /**
   * What a write should warn about, beside the row it stored.
   *
   * @param state - The after-state.
   * @param connection - Its connection, or null for unbound.
   * @param bindingTouched - Whether this write set the binding — a create or a rebind — which
   *   is when discovery is worth asking. An edit of params on an undiscovered model is not
   *   the moment to repeat a warning the create already gave.
   * @returns The warnings, in the order they matter.
   */
  private async warningsFor(
    state: AliasState,
    connection: AliasConnectionRow | null,
    bindingTouched: boolean,
  ): Promise<AliasWarningResource[]> {
    if (connection === null || state.connectionId === null) {
      return [unboundWarning(state.alias)];
    }

    if (!bindingTouched) {
      return [];
    }

    const verdict = await this.aliases.discovery(connection.id, state.modelId);

    if (verdict.discovered) {
      return [];
    }

    return [
      {
        code: ALIAS_WARNINGS.modelNotDiscovered,
        message: verdict.catalogued
          ? `Discovery has not reported ${state.modelId} on ${connection.display_name} — its ` +
            "catalog lists other models. Check the spelling against the model options for " +
            "this connection. The alias was saved."
          : `Nothing has been discovered on ${connection.display_name} yet, so ${state.modelId} ` +
            "could not be checked against its catalog. Run discovery for the connection. " +
            "The alias was saved.",
        fix: null,
      },
    ];
  }

  /**
   * What a write answers with: the alias re-read after the commit, and what the write did.
   *
   * @param organizationId - The workspace.
   * @param aliasId - Which alias.
   * @param revisionId - The revision the write left, or null for a write that changed nothing.
   * @param warnings - What the client should know.
   * @param nextResolution - Where the next resolution goes, after a rebind.
   * @param droppedHops - The references whose hops a disable will drop.
   * @returns The resource.
   * @throws {NotFoundError} `404 model_alias_not_found` when the row is gone between the commit
   *   and the read — a concurrent delete, which is the honest answer to it.
   */
  private async answer(
    organizationId: string,
    aliasId: string,
    revisionId: string | null,
    warnings: readonly AliasWarningResource[],
    nextResolution: AliasResolutionPreviewResource | null,
    droppedHops: readonly AliasReferenceResource[],
  ): Promise<AliasChangeResource> {
    const row = await this.require(organizationId, aliasId);
    const references = await this.aliases.references(organizationId, [aliasId]);

    return {
      alias: toAliasResource(row, references),
      revisionId,
      warnings,
      nextResolution,
      droppedHops,
    };
  }
}

/**
 * A row's connection, as the write path needs it, or null for an unbound alias.
 *
 * @param row - The row, with its connection flattened in.
 * @returns The connection row, or null.
 */
function currentConnection(row: AliasRow): AliasConnectionRow | null {
  if (
    row.provider_connection_id === null ||
    row.connection_kind === null ||
    row.connection_display_name === null
  ) {
    return null;
  }

  return {
    id: row.provider_connection_id,
    kind: row.connection_kind,
    display_name: row.connection_display_name,
  };
}

/**
 * A connection row as the contract publishes it.
 *
 * @param connection - The row.
 * @returns The resource.
 */
function toConnection(connection: AliasConnectionRow): AliasConnectionResource {
  return { id: connection.id, kind: connection.kind, displayName: connection.display_name };
}

/**
 * A reference row as a refusal names it.
 *
 * @param reference - The row.
 * @returns The referrer.
 */
function toReferrer(reference: AliasReferenceRow): ReferrerDetail {
  return {
    kind: reference.kind,
    refId: reference.ref_id,
    label: reference.ref_label,
    blocking: reference.blocking,
  };
}

/**
 * The warning an unbound alias carries — mockup 21's *Fix in Providers →*.
 *
 * @param alias - The alias's name.
 * @returns The warning.
 */
function unboundWarning(alias: string): AliasWarningResource {
  return {
    code: ALIAS_WARNINGS.unbound,
    message:
      `${alias} has no provider connection, so it is switched off and nothing routes through ` +
      "it. Connect a provider under Providers & keys, then bind the alias to it.",
    fix: PROVIDERS_FIX_PATH,
  };
}
