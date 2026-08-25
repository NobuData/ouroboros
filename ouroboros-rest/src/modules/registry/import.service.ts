/**
 * Bulk import from discovery — the head's **Import from provider ▾**
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * Four rules the ticket states as hard requirements, and where each one lives:
 *
 * **Import never invents a model.** Decision **R7**. {@link ImportService.candidates} lists
 * `provider_models` and nothing else, and {@link ImportService.create} refuses an item whose
 * `modelId` is not in that list — the one place this service is stricter than CH.1's create,
 * which warns and saves. A bulk path that accepted a typed model id would reintroduce exactly
 * the typo class the registry exists to remove, forty rows at a time.
 *
 * **There is no import-all.** This service creates what the request names and never what the
 * connection has; `selected` on a candidate row is a *suggestion* the wizard starts from. The
 * curation is the feature — an alias per discovered model would fill a workspace with names
 * nothing routes to and make the page's own caption false.
 *
 * **Collisions are visible before anything is created.** Every candidate arrives with the
 * alias that already names its model and with a name suggested clear of everything taken, so
 * the ordinary case never reaches a refusal at all. When one does,
 * {@link ImportService.create} checks **every** item and answers `422` itemized — the whole
 * batch, in one round trip, rather than the first problem it met.
 *
 * **Nothing partial is ever committed.** Validation finishes before the transaction opens, so
 * atomicity here is a write that never started rather than a rollback that has to work. The
 * one thing decided inside the transaction is the unique-name race two concurrent imports can
 * lose, and that rolls the whole batch back by construction.
 *
 * ---------------------------------------------------------------------------
 * **Imported aliases arrive switched on, and that is the deliberate opposite of duplicate.**
 *
 * `AliasesService.duplicate` creates a copy **off**, because a copy exists to be edited into
 * something else and a copy that started taking traffic would be a surprise. An import is the
 * other situation entirely: every row is bound to a connection the operator just chose, names
 * a model that connection reported minutes ago, and was ticked by hand. Creating forty aliases
 * that all then have to be switched on individually would make the wizard a way of generating
 * work. So `enabled: true`, and V019's CHECK is satisfied by construction because there is no
 * unbound path into this service at all.
 *
 * ---------------------------------------------------------------------------
 * **Re-running an import skips rather than fails, and says what it skipped.**
 *
 * An operator who refreshes discovery and imports again is asking for *the new ones*, not for
 * an error about the old ones. An item whose model already has an alias on this connection is
 * passed over before it is validated — so the name it carries is never checked, never
 * collides, and never refuses a batch that is otherwise entirely new. What was skipped comes
 * back in the answer, because an idempotent operation that reports nothing is one nobody can
 * tell succeeded.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { InvalidRequestError } from "../errors/error.envelope";
import type { ResolvedPrice } from "../pricing/price";
import { PricingService } from "../pricing/pricing.service";
import { requiredDiff, type AliasState } from "./aliases.changes";
import { isAliasNameTaken } from "./aliases.errors";
import { AliasesRepository } from "./aliases.repository";
import type { AliasConnectionRow, AliasRow, ModelOptionRow } from "./aliases.rows";
import {
  referencesByAlias,
  toAliasResource,
  type AliasConnectionResource,
} from "./aliases.resources";
import type { ImportAliasesDto, ImportItemDto } from "./import.dto";
import {
  ALIAS_FIELD,
  IMPORT_MESSAGES,
  MODEL_ID_FIELD,
  importInvalid,
  type BatchProblems,
  type ItemProblems,
} from "./import.errors";
import { sharedModelPrefix, foldModelId, shortModelName, suggestAliasName } from "./import.naming";
import { ImportRepository } from "./import.repository";
import {
  noModelsDiscovered,
  toCandidateAliasResource,
  toCandidateResource,
  type ImportCandidateAliasResource,
  type ImportCandidateListResource,
  type ImportResultResource,
  type ImportedAliasResource,
  type SkippedImportResource,
} from "./import.resources";
import type { ImportAliasRow } from "./import.rows";
import { ParamSchemaService, type ModelParamAnswer } from "./params.service";
import { assertParamsValid } from "./params.validation";
import { REGISTRY_ERRORS, registryConnectionNotFound } from "./registry.errors";

/** One item that survived the skip pass, with the position it arrived in. */
interface PendingItem {
  /** Where in the request's array it was — the key its complaints are filed under. */
  readonly index: number;
  readonly item: ImportItemDto;
}

@Injectable()
export class ImportService {
  /**
   * @param imports - The two statements this ticket adds.
   * @param aliases - CH.1's statements: the connection, the discovered models, the insert and
   *   the revision record. An imported alias is written by the same code a typed one is.
   * @param params - CH.2's capability summaries and its write validation.
   * @param prices - CH.3's resolution, for the preview. Never re-derived here.
   * @param database - The transaction boundary the whole batch commits in.
   */
  constructor(
    private readonly imports: ImportRepository,
    private readonly aliases: AliasesRepository,
    private readonly params: ParamSchemaService,
    private readonly prices: PricingService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * The wizard's table for one connection — every discovered model, annotated.
   *
   * Four statements and one adapter call per model, whatever the catalog's size: the models,
   * the aliases already on the connection, the workspace's names, and CH.2's batched metadata
   * behind {@link ParamSchemaService.summariesFor}. CH.3's prices are one more, or none when
   * its cache already holds them.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection to import from.
   * @returns The connection, its candidates ordered by model id, and the explanation when
   *   there are none.
   * @throws {NotFoundError} `404 provider_connection_not_found` for a connection this
   *   workspace does not have.
   */
  async candidates(
    organizationId: string,
    connectionId: string,
  ): Promise<ImportCandidateListResource> {
    const connection = await this.requireConnection(organizationId, connectionId);
    const [models, bound, names] = await Promise.all([
      this.aliases.modelOptions(organizationId, connectionId),
      this.imports.aliasesOn(organizationId, connectionId),
      this.imports.aliasNames(organizationId),
    ]);

    if (models.length === 0) {
      return {
        connection: toConnectionResource(connection),
        candidates: [],
        empty: noModelsDiscovered(connection.display_name),
      };
    }

    const modelIds = models.map((model) => model.model_id);
    const [answers, prices] = await Promise.all([
      this.params.forModels(organizationId, connectionId, modelIds),
      this.prices.resolveMany(
        modelIds.map((modelId) => ({ connectionKind: connection.kind, modelId })),
        organizationId,
      ),
    ]);
    const aliasByModel = aliasesByModel(bound);
    // Seeded with what the workspace already has and grown as suggestions are made, so two
    // rows of one wizard never arrive pre-filled with the same name.
    const taken = new Set(names);
    const prefix = sharedModelPrefix(modelIds.map(foldModelId));

    return {
      connection: toConnectionResource(connection),
      candidates: models.map((model, position) =>
        candidate({
          model,
          alias: aliasByModel.get(model.model_id) ?? null,
          suggestedName: suggestFor(model.model_id, prefix, taken),
          price: prices[position],
          connectionKind: connection.kind,
          capabilities: answerFor(answers, model.model_id).capabilities,
        }),
      ),
      empty: null,
    };
  }

  /**
   * Create the ticked rows — all of them, or none.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - Who is importing, from the session. Recorded on every row and on every
   *   revision, read from the session rather than the body for CH.1's reason.
   * @param body - The validated request.
   * @returns What was created, and what was skipped because its model already had an alias.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   * @throws {InvalidRequestError} `422 model_import_invalid`, itemized, with nothing created.
   */
  async create(
    organizationId: string,
    actorId: string,
    body: ImportAliasesDto,
  ): Promise<ImportResultResource> {
    const connection = await this.requireConnection(organizationId, body.connectionId);
    const aliasByModel = aliasesByModel(
      await this.imports.aliasesOn(organizationId, connection.id),
    );
    const skipped: SkippedImportResource[] = [];
    const pending: PendingItem[] = [];

    for (const [index, item] of body.items.entries()) {
      const existing = aliasByModel.get(item.modelId);

      if (existing === undefined) {
        pending.push({ index, item });
      } else {
        // Skipped before it is validated, which is what makes a re-run safe: the name this
        // item carries is the one the last import already used, and checking it would refuse
        // a batch whose only fault is having been run before.
        skipped.push({ modelId: item.modelId, requestedAlias: item.alias, alias: existing });
      }
    }

    await this.assertImportable(organizationId, connection, pending);

    const created = await this.writeAll(organizationId, actorId, connection, pending);

    return { connection: toConnectionResource(connection), created, skipped };
  }

  /**
   * The whole batch is creatable, or the designed `422` naming every reason it is not.
   *
   * Every item is checked even after one has failed, which is the point: an operator whose
   * wizard has three problems in it should learn all three now rather than one per submission.
   *
   * @param organizationId - The workspace.
   * @param connection - The connection every item binds to.
   * @param pending - The items that were not skipped, with their request positions.
   * @returns Nothing when every item may be created.
   * @throws {InvalidRequestError} `422 model_import_invalid`.
   */
  private async assertImportable(
    organizationId: string,
    connection: AliasConnectionRow,
    pending: readonly PendingItem[],
  ): Promise<void> {
    if (pending.length === 0) {
      return;
    }

    const [models, names, answers] = await Promise.all([
      this.aliases.modelOptions(organizationId, connection.id),
      this.imports.aliasNames(organizationId),
      this.params.forModels(
        organizationId,
        connection.id,
        pending.map(({ item }) => item.modelId),
      ),
    ]);
    const discovered = new Set(models.map((model) => model.model_id));
    const existing = new Set(names);
    const repeated = repeatedNames(pending);
    const problems: BatchProblems = {};

    for (const { index, item } of pending) {
      const fields: ItemProblems = {};

      if (!discovered.has(item.modelId)) {
        fields[MODEL_ID_FIELD] = [IMPORT_MESSAGES.notDiscovered];
      }

      if (repeated.has(item.alias)) {
        fields[ALIAS_FIELD] = [IMPORT_MESSAGES.nameRepeated];
      } else if (existing.has(item.alias)) {
        fields[ALIAS_FIELD] = [IMPORT_MESSAGES.nameTaken];
      }

      Object.assign(fields, paramProblems(answerFor(answers, item.modelId), item));

      if (Object.keys(fields).length > 0) {
        problems[index.toString()] = fields;
      }
    }

    if (Object.keys(problems).length > 0) {
      throw importInvalid(problems);
    }
  }

  /**
   * Insert every pending item and its revision, in one transaction.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is importing.
   * @param connection - The connection every alias binds to.
   * @param pending - The items to create, in request order.
   * @returns Each alias as stored, with the revision its creation left — re-read after the
   *   commit rather than echoed from the body, exactly as CH.1's writes answer.
   * @throws {InvalidRequestError} `422 model_import_invalid` when a concurrent write took one
   *   of the names between the check and the insert — the race the pre-check cannot close,
   *   answered as the same refusal rather than as a unique-violation leak.
   */
  private async writeAll(
    organizationId: string,
    actorId: string,
    connection: AliasConnectionRow,
    pending: readonly PendingItem[],
  ): Promise<ImportedAliasResource[]> {
    if (pending.length === 0) {
      return [];
    }

    let written: { id: string; revisionId: string }[];

    try {
      written = await this.database.transaction(async (trx) => {
        const rows: { id: string; revisionId: string }[] = [];

        for (const { item } of pending) {
          const state = importedState(item, connection.id);
          const id = await this.aliases.insert(trx, organizationId, actorId, state);
          const revisionId = await this.aliases.recordRevision(trx, {
            organizationId,
            aliasId: id,
            alias: state.alias,
            actor: actorId,
            action: "created",
            diff: requiredDiff(null, state),
          });

          rows.push({ id, revisionId });
        }

        return rows;
      });
    } catch (error) {
      if (isAliasNameTaken(error)) {
        throw importInvalid(nameRaceProblems(pending));
      }

      throw error;
    }

    const ids = written.map(({ id }) => id);
    // Two reads for the whole batch rather than two per alias: the list is the workspace's
    // registry, which is a handful of names, and two hundred round trips to answer one import
    // is the N+1 this file avoided on the way in.
    const [rows, references] = await Promise.all([
      this.aliases.list(organizationId),
      this.aliases.references(organizationId, ids),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byAlias = referencesByAlias(references);

    return written.map(({ id, revisionId }) => ({
      alias: toAliasResource(committed(byId, id), byAlias.get(id) ?? []),
      revisionId,
    }));
  }

  /**
   * The connection, or the designed 404.
   *
   * @param organizationId - The workspace.
   * @param connectionId - Which connection.
   * @returns The row.
   * @throws {NotFoundError} `404 provider_connection_not_found` — the same answer for *no such
   *   connection* and *another workspace's*, for the reason every read in this service gives.
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
}

/**
 * An alias this import just committed, out of the list read back after it.
 *
 * @param rows - Every alias in the workspace, keyed by id.
 * @param aliasId - The row.
 * @returns The row.
 * @throws {Error} When it is gone between the commit and the read. Unlike CH.1's `404`, this is
 *   not a state a caller can be in: the id was returned by an insert in a transaction that
 *   committed, so its absence means somebody deleted it in the microseconds since — raised
 *   rather than dressed up as a not-found, because the honest answer is *this should not have
 *   happened*.
 */
function committed(rows: ReadonlyMap<string, AliasRow>, aliasId: string): AliasRow {
  const row = rows.get(aliasId);

  if (row === undefined) {
    throw new Error(`an alias this import created is already gone: ${aliasId}`);
  }

  return row;
}

/**
 * The name to pre-fill one row with, claimed against everything already spoken for.
 *
 * @param modelId - The discovered model.
 * @param prefix - The connection's shared model prefix, or null when there is none to drop.
 * @param taken - Every name that is spoken for, **mutated**: a suggestion joins it, so the next
 *   row is suggested clear of this one.
 * @returns The suggestion, or null when none could be made.
 */
function suggestFor(modelId: string, prefix: string | null, taken: Set<string>): string | null {
  const suggested = suggestAliasName(shortModelName(modelId, prefix), taken);

  if (suggested !== null) {
    taken.add(suggested);
  }

  return suggested;
}

/** Everything one candidate row is composed from — named, because six positional arguments are not. */
interface CandidateParts {
  readonly model: ModelOptionRow;
  readonly alias: ImportCandidateAliasResource | null;
  readonly suggestedName: string | null;
  readonly price: ResolvedPrice | undefined;
  readonly connectionKind: string;
  readonly capabilities: ModelParamAnswer["capabilities"];
}

/**
 * One candidate row.
 *
 * @param parts - What it is made of.
 * @returns The resource.
 */
function candidate(parts: CandidateParts) {
  return toCandidateResource(
    parts.model,
    parts.alias,
    parts.suggestedName,
    parts.price,
    parts.connectionKind,
    parts.capabilities,
  );
}

/**
 * CH.2's answer for one model, which is always there.
 *
 * `forModels` is asked about exactly the ids this then looks up, so an absent entry is a
 * programming fault rather than a state a request can produce — raised as one instead of
 * being papered over with a default that would quietly report a model as having no
 * capabilities.
 *
 * @param answers - What CH.2 answered for the batch.
 * @param modelId - The model.
 * @returns Its schema and headline.
 * @throws {Error} When the map does not hold it.
 */
function answerFor(
  answers: ReadonlyMap<string, ModelParamAnswer>,
  modelId: string,
): ModelParamAnswer {
  const answer = answers.get(modelId);

  if (answer === undefined) {
    throw new Error(`no param schema was fetched for ${modelId}`);
  }

  return answer;
}

/**
 * What CH.2 says is wrong with one item's params, keyed by its own field paths.
 *
 * The `422` CH.1's writes throw is caught rather than propagated: a batch answers one refusal
 * describing every item, and a params failure escaping from the middle of the loop would be a
 * `model_alias_params_invalid` about an item the client cannot identify. Anything else thrown
 * is re-thrown untouched — a bug swallowed here would become a batch that silently refused
 * every row.
 *
 * `restrictions` is checked as empty because {@link importedState} stores it empty: the wizard
 * has no column for registry policy, and validating a document the request cannot send would
 * be checking a field that does not exist.
 *
 * @param answer - CH.2's schema for the item's model.
 * @param item - The row.
 * @returns `{"params.thinking": ["…"]}`, or empty when the params suit the model.
 */
function paramProblems(answer: ModelParamAnswer, item: ImportItemDto): ItemProblems {
  try {
    assertParamsValid(answer.schema, { params: item.params ?? {}, restrictions: {} }, item.modelId);

    return {};
  } catch (error) {
    if (
      !(error instanceof InvalidRequestError) ||
      error.code !== REGISTRY_ERRORS.aliasParamsInvalid
    ) {
      throw error;
    }

    const fields: ItemProblems = {};

    for (const [field, messages] of Object.entries(error.details)) {
      if (Array.isArray(messages)) {
        fields[field] = messages.map((message) => String(message));
      }
    }

    return fields;
  }
}

/**
 * The state one imported item is stored as.
 *
 * Enabled, bound, with no note and no restrictions — see this file's header for why the switch
 * is the opposite of a duplicate's.
 *
 * @param item - The row the wizard sent.
 * @param connectionId - The connection every item of a batch binds to.
 * @returns The state.
 */
function importedState(item: ImportItemDto, connectionId: string): AliasState {
  return {
    alias: item.alias,
    connectionId,
    modelId: item.modelId,
    enabled: true,
    params: item.params ?? {},
    restrictions: {},
    notes: null,
  };
}

/**
 * Which models a connection's aliases already name.
 *
 * @param rows - The aliases on the connection, **ordered by name** — the repository's order,
 *   which is what makes the answer for a model named twice the alphabetically first rather
 *   than whichever the planner returned.
 * @returns Model id to the alias that marks it.
 */
function aliasesByModel(
  rows: readonly ImportAliasRow[],
): Map<string, ImportCandidateAliasResource> {
  const byModel = new Map<string, ImportCandidateAliasResource>();

  for (const row of rows) {
    if (!byModel.has(row.model_id)) {
      byModel.set(row.model_id, toCandidateAliasResource(row));
    }
  }

  return byModel;
}

/**
 * The names a batch asks for more than once.
 *
 * A refusal rather than a first-wins, because two rows asking for one name is a wizard the
 * operator has not finished filling in — and creating one of them silently would leave the
 * other model unimported with nothing said about it.
 *
 * @param pending - The items that were not skipped.
 * @returns The repeated names. Empty in the ordinary case.
 */
function repeatedNames(pending: readonly PendingItem[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const { item } of pending) {
    if (seen.has(item.alias)) {
      repeated.add(item.alias);
    }

    seen.add(item.alias);
  }

  return repeated;
}

/**
 * The complaint a lost name race produces — filed against every item, in its own words.
 *
 * V015's unique key names the constraint and not which of the inserts met it, so there is no
 * honest way to blame one row. See {@link IMPORT_MESSAGES.nameRaced} for why that message is
 * not the ordinary *this name is taken*.
 *
 * @param pending - The items the transaction was rolling back.
 * @returns One entry per item.
 */
function nameRaceProblems(pending: readonly PendingItem[]): BatchProblems {
  const problems: BatchProblems = {};

  for (const { index } of pending) {
    problems[index.toString()] = { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameRaced] };
  }

  return problems;
}

/**
 * A connection row as the contract publishes it.
 *
 * @param connection - The row.
 * @returns The resource.
 */
function toConnectionResource(connection: AliasConnectionRow): AliasConnectionResource {
  return { id: connection.id, kind: connection.kind, displayName: connection.display_name };
}
