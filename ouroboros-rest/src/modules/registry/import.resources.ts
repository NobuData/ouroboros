/**
 * Row → resource, for bulk import ([#587](https://github.com/NobuData/ouroboros/issues/587)) —
 * the wizard's candidate table, and the report a batch answers with.
 *
 * Four decisions are made here rather than at the call sites, and each is one the ticket
 * states as a requirement:
 *
 * **1. A candidate carries its collision, not a boolean.** {@link ImportCandidateResource.alias}
 * is the alias that already names this model — id and name, so the row can *link* to it — and
 * `null` when nothing does. `selected` is pre-computed beside it, because the rule *an already
 * aliased model arrives unticked* is the server's to state: a client deriving it would be a
 * second place for the wizard's default to live.
 *
 * **2. The price is CH.3's answer, whole.** {@link ImportCandidateResource.price} is the exact
 * {@link ModelPriceResource} `GET /registry/prices` publishes, mapped by the same function —
 * so an Ollama model reads `$0` here for the same reason it reads `$0` there, and a model the
 * catalog does not cover reads `—` rather than a zero somebody sizes a budget from.
 *
 * **3. The capability headline *is* CH.2's summary.** The type is that module's, re-exported
 * rather than restated, which makes it structurally impossible for the published shape and the
 * merged schema to drift. A candidate row gets a headline and not a schema — see
 * `params.merge.ts`'s `summariseCapabilities` for why.
 *
 * **4. An empty catalog is an answer with words in it.** {@link ImportCandidateListResource.empty}
 * is non-null exactly when there are no candidates, and it carries the sentence and the place
 * to go. The ticket's phrasing is *never an empty wizard with no explanation*, and a client that
 * had to compose that sentence from an empty array would be composing it differently on every
 * page that ever asks.
 */

import { modelPriceResource, type ModelPriceResource } from "../pricing/resources";
import type { ResolvedPrice } from "../pricing/price";
import { PROVIDERS_FIX_PATH } from "./aliases.errors";
import type {
  AliasConnectionResource,
  ModelAliasResource,
  ModelOptionResource,
} from "./aliases.resources";
import { toModelOptionResource } from "./aliases.resources";
import type { ModelOptionRow } from "./aliases.rows";
import type { ImportAliasRow } from "./import.rows";
import type { ModelCapabilitySummary } from "./params.merge";

/**
 * The capability headline a candidate row prints — CH.2's summary, published unchanged.
 *
 * A type alias rather than a second interface: see this file's header, decision 3.
 */
export type ImportCapabilitiesResource = ModelCapabilitySummary;

/** The alias that already names a discovered model — what marks a candidate row. */
export interface ImportCandidateAliasResource {
  /** `model_aliases.id`, so the row can link to the alias rather than only name it. */
  readonly id: string;
  /** What it is called. */
  readonly alias: string;
}

/** One discovered model, annotated with everything the wizard's row draws. */
export interface ImportCandidateResource extends ModelOptionResource {
  /**
   * The alias that already resolves to this model on this connection, or null for one nothing
   * names yet.
   *
   * When a model has more than one — which is legal; uniqueness is on the *name* — this is the
   * alphabetically first, so the row is stable between reads.
   */
  readonly alias: ImportCandidateAliasResource | null;
  /**
   * The name to pre-fill, or **null** when none could be suggested.
   *
   * Collision-suffixed against the workspace's existing aliases and against the suggestions
   * above it in this same list, so ticking every row is a request that can be submitted. Null
   * is honest rather than empty — see `import.naming.ts`.
   */
  readonly suggestedName: string | null;
  /**
   * Whether the wizard should arrive with this row ticked.
   *
   * False for a model that already has an alias — *the curation is the feature*, and
   * re-importing what is already named is the one thing an operator did not ask for — and
   * false when there is no name to suggest, since a ticked row with an empty name cannot be
   * submitted.
   */
  readonly selected: boolean;
  /** What it costs, resolved by CH.3 and rendered by CH.3. Never re-derived here. */
  readonly price: ModelPriceResource;
  /** What it can be tuned with and how much it holds — CH.2's headline. */
  readonly capabilities: ImportCapabilitiesResource;
}

/** The code an empty candidate list carries. Stable; what a client branches on. */
export const NO_MODELS_DISCOVERED = "no_models_discovered";

/** Why the wizard has nothing to show, when it has nothing to show. */
export interface ImportEmptyResource {
  /** Always {@link NO_MODELS_DISCOVERED} today. A code, so the sentence is not the contract. */
  readonly code: typeof NO_MODELS_DISCOVERED;
  /** For a person. */
  readonly message: string;
  /** Where to go — Providers & keys, where a connection is tested and discovery is run. */
  readonly fix: string;
}

/** The wizard's whole state for one connection. */
export interface ImportCandidateListResource {
  /**
   * The connection being imported from.
   *
   * CH.1's own connection resource, reused rather than restated: a client that draws the
   * registry table's monogram draws this one with the code it already has.
   */
  readonly connection: AliasConnectionResource;
  /** Its discovered models, ordered by id. Empty when discovery has reported nothing. */
  readonly candidates: readonly ImportCandidateResource[];
  /** Non-null **exactly** when `candidates` is empty. See this file's header, decision 4. */
  readonly empty: ImportEmptyResource | null;
}

/** One alias the import created. */
export interface ImportedAliasResource {
  /** The alias as stored, re-read after the commit rather than echoed from the body. */
  readonly alias: ModelAliasResource;
  /** The `alias_revisions` row this creation left. Never null — a create always moves every column. */
  readonly revisionId: string;
}

/** One model the import passed over because it already had an alias. */
export interface SkippedImportResource {
  /** The model the item named. */
  readonly modelId: string;
  /** The name the item asked for, which was not used. */
  readonly requestedAlias: string;
  /** The alias that already resolves to the model, and is why this item was skipped. */
  readonly alias: ImportCandidateAliasResource;
}

/** What a batch answers with — what it created, and what it deliberately did not. */
export interface ImportResultResource {
  /** The connection everything was created on. */
  readonly connection: AliasConnectionResource;
  /**
   * The aliases created, in the order the items arrived. Empty for a re-run that skipped
   * everything, which is a success and not a failure.
   */
  readonly created: readonly ImportedAliasResource[];
  /**
   * The items passed over because their model was already aliased — the idempotency, reported
   * rather than silent. An operator who re-ran an import is owed the list of what that meant.
   */
  readonly skipped: readonly SkippedImportResource[];
}

/**
 * An alias row as a candidate's mark.
 *
 * @param row - The alias bound to this connection.
 * @returns The two fields a row links with.
 */
export function toCandidateAliasResource(row: ImportAliasRow): ImportCandidateAliasResource {
  return { id: row.id, alias: row.alias };
}

/**
 * One discovered model as the wizard's row.
 *
 * @param row - The `provider_models` row, as `aliases.repository.ts` selects it.
 * @param alias - The alias that already names it, or null.
 * @param suggestedName - What `import.naming.ts` suggested, or null when it could not.
 * @param price - What CH.3 resolved for the pair, or undefined when the catalog covers nothing.
 * @param connectionKind - The kind the price was resolved against, folded, so the published
 *   pair says which spelling was looked up.
 * @param capabilities - CH.2's headline for the model.
 * @returns The resource.
 */
export function toCandidateResource(
  row: ModelOptionRow,
  alias: ImportCandidateAliasResource | null,
  suggestedName: string | null,
  price: ResolvedPrice | undefined,
  connectionKind: string,
  capabilities: ImportCapabilitiesResource,
): ImportCandidateResource {
  return {
    ...toModelOptionResource(row),
    alias,
    suggestedName,
    // Both halves of the rule in one place — see the field's own documentation.
    selected: alias === null && suggestedName !== null,
    price: modelPriceResource({ connectionKind, modelId: row.model_id }, price),
    capabilities,
  };
}

/**
 * The sentence a connection with nothing discovered answers with.
 *
 * @param displayName - What the connection is called, so the sentence names it rather than
 *   saying *this connection*.
 * @returns The resource.
 */
export function noModelsDiscovered(displayName: string): ImportEmptyResource {
  return {
    code: NO_MODELS_DISCOVERED,
    message:
      `Nothing has been discovered on ${displayName} yet, so there is nothing to import. ` +
      "Test the connection under Providers & keys — discovery runs with it — and try again.",
    fix: PROVIDERS_FIX_PATH,
  };
}
