/**
 * Four contributors, one schema — and a label on every field saying which of them shaped it.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)). The adapter says what a model
 * can be tuned with; discovery says how the deployment in front of us was actually started; the
 * bundled price catalog knows things about published models that nothing here asked it; and
 * V019's column knows what this product will store at all. Each of those is true, none of them
 * is complete, and they are not equally trustworthy — so the merge is a precedence rule rather
 * than an `Object.assign`.
 *
 * ```
 * adapter    paramSchema(model)        live, this build's own code        ─┐
 * discovery  provider_models.meta      live, what the provider reported    │ tightest wins,
 * catalog    model_prices.meta         a vendored snapshot of someone      │ ties to the left
 *                                      else's file                         │
 * registry   V019's column domain      what an insert will accept         ─┘
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The catalog may never override the two above it — acceptance criterion, not a preference.**
 *
 * `model_prices.meta` is a pruned copy of an upstream JSON file, pinned at a commit
 * ([#580](https://github.com/NobuData/ouroboros/issues/580)). It is genuinely useful — it is
 * where a published model's maximum output lives, which no adapter can answer offline — and it
 * is exactly the kind of source that goes stale without anybody noticing. So it is *fallback
 * enrichment* (the ticket's option **2-B**): it may fill a bound that is **absent**, and it may
 * not touch one that is present. {@link mergeParamSchema} implements that as one asymmetry —
 * {@link fillAbsent} against {@link tighten} — rather than as a comment asking the next reader
 * to be careful.
 *
 * Discovery, by contrast, *is* live: it is what this provider said about this model on this
 * connection. It may tighten an adapter's bound, because the adapter's is a statement about the
 * family and discovery's is about the deployment.
 *
 * ---------------------------------------------------------------------------
 * **Every bound is intersected with what V019 will store.** A schema whose ceiling was above
 * the column's would render a control somebody fills in correctly and cannot save — the exact
 * failure this ticket exists to prevent, arriving from the merge instead of from an adapter.
 * The conformance kit already refuses an *adapter* that does it; this closes the same door on
 * the merge's own arithmetic, and labels the result `registry` where the registry's own domain
 * is what supplied the bound.
 *
 * ---------------------------------------------------------------------------
 * **An unbound alias gets the generic schema, and says why.**
 *
 * With no connection there is no adapter, no discovery row, and — since the catalog is keyed by
 * provider kind — no catalog row either. Offering `gpt5-experiments` a full param form would be
 * inventing every field on it. So the params half is empty and carries the reason, the
 * restrictions half is served in full because policy is not a claim about a model, and
 * {@link MergedParamSchema.reason} is what the inspector prints instead of fields. Mockup 21
 * draws that row dimmed with *no key — connect a provider*, and this is the same fact arriving
 * through the API.
 */

import type { ModelAliasParamKey, ProviderConnectionKind } from "../db/schema";
import {
  MODEL_PARAM_DIALECT,
  PARAM_SOURCES,
  RESTRICTIONS_SCHEMA,
  SOURCES_ANNOTATION,
  STORABLE_PARAM_FIELDS,
  copyParamSchema,
  type ModelParamFieldSchema,
  type ModelParamSchema,
  type ParamSource,
} from "../providers/provider.params";

/**
 * What discovery and the catalog contribute, in this module's vocabulary.
 *
 * Both `meta` columns are opaque jsonb — V017's is what an adapter reported and V012's is a
 * vendor's own file — so reading them is a separate step from merging them, and this is the
 * shape in between. Every field is nullable because *the source did not say* is the ordinary
 * answer and the one thing the merge must not confuse with a value.
 */
export interface ModelMetadata {
  /**
   * The model's context window in tokens, or null.
   *
   * The key is spelled `context_tokens` in both columns, which V017 chose deliberately so that
   * merging a discovered model with a catalogued one is not a translation exercise.
   */
  readonly contextTokens: number | null;
  /**
   * The most tokens one answer may run to, or null.
   *
   * `max_output_tokens`, and the catalog's alone: no adapter this build ships can answer it
   * offline and no discovery endpoint publishes it. It is the worked example of enrichment —
   * see this file's header.
   */
  readonly maxOutputTokens: number | null;
}

/** Nothing known — what a source that has no row for a model contributes. */
export const NO_METADATA: ModelMetadata = Object.freeze({
  contextTokens: null,
  maxOutputTokens: null,
});

/**
 * Why an alias has no param fields, when it has none.
 *
 * Three states rather than a boolean, because the inspector says something different in each
 * and a client that could only tell *fields* from *no fields* would have to invent the
 * sentence. `null` — the ordinary case — means the fields are there and there is nothing to
 * explain.
 */
export type NoParamsReason =
  /** No provider is bound, so there is no adapter to ask. Mockup 21's `gpt5-experiments`. */
  | "alias_unbound"
  /** The provider is bound to a kind this build has no adapter for. */
  | "provider_unsupported"
  /** There is an adapter and it honestly offers nothing — a fixed catalog. */
  | "provider_has_no_parameters";

/**
 * The answer `GET /registry/param-schema` is built from, and the value CH.1's writes are
 * validated against.
 *
 * Two schemas rather than one merged object, because the two are stored in two columns with two
 * vocabularies — so a `422` can name `restrictions.batch_ok` and mean exactly one thing, and a
 * write is checked against the rules that actually apply to it. They are in the same dialect,
 * so a renderer draws both with one pass and no special-casing, which is the whole point.
 */
export interface MergedParamSchema {
  /** The tunables this model supports, merged and bounded. Empty when {@link reason} says why. */
  readonly params: ModelParamSchema;
  /**
   * The two registry flags, identically on every answer.
   *
   * Not merged, not narrowed, and never absent — including on an unbound alias. A restriction
   * is what this workspace allows the alias to be used for, which is true whether or not
   * anything is on the other end of it.
   */
  readonly restrictions: ModelParamSchema;
  /**
   * Why {@link params} offers nothing, or null when it offers something.
   *
   * A code rather than a sentence: the sentence belongs to whatever is rendering, and a server
   * that shipped one would be choosing the inspector's copy. {@link params}'s own
   * `description` carries the human-readable half.
   */
  readonly reason: NoParamsReason | null;
  /**
   * Every source that contributed to any field, in precedence order.
   *
   * The summary of the per-field annotations, so a client can say *these bounds include
   * catalogued values* once above a form rather than reading every field to find out.
   */
  readonly sources: readonly ParamSource[];
}

/**
 * The params schema an alias with no adapter behind it gets.
 *
 * Empty properties and a sentence — which is the same shape `provider.params.ts` requires of a
 * fixed-catalog adapter, and for the same reason: an empty form that cannot explain itself is
 * indistinguishable from one that failed to load.
 *
 * @param reason - Why there is nothing, which decides the sentence.
 * @returns The schema.
 */
export function genericParamSchema(reason: NoParamsReason): ModelParamSchema {
  return {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Model parameters",
    description: GENERIC_DESCRIPTIONS[reason],
    properties: {},
    additionalProperties: false,
  };
}

/**
 * What each reason says, for a reader.
 *
 * Held here rather than in the UI because the *server* is what knows which of the three it is,
 * and a client rewriting the sentence from a code would be a second place for the explanation
 * to live. A client is free to render its own; this is what a client that does not have to.
 */
const GENERIC_DESCRIPTIONS: Readonly<Record<NoParamsReason, string>> = Object.freeze({
  alias_unbound:
    "This alias has no provider bound yet, so there is nothing to ask what it supports. " +
    "Bind it to a connection and its parameters appear.",
  provider_unsupported:
    "This build has no adapter for that provider kind, so nothing here can say what its " +
    "models support.",
  provider_has_no_parameters:
    "This provider publishes no per-call parameters this product can set.",
});

/**
 * The schema for one model on one connection, from everything known about it.
 *
 * @param adapterSchema - What the bound adapter answered for this model, or `null` when there
 *   is no adapter — an unbound alias, or a connection of a kind this build does not implement.
 *   The two are told apart by `unsupportedKind`.
 * @param discovered - What the provider reported about this model into `provider_models`
 *   (V017). {@link NO_METADATA} when discovery has not run or does not list it, which is an
 *   ordinary state and not an error.
 * @param catalogued - What the bundled price catalog knows about it (V012). Lower precedence
 *   than both of the above, always — see this file's header.
 * @param unsupportedKind - The connection's kind when there is a connection but no adapter for
 *   it, so the reason can say which of the two absences this is. `null` otherwise.
 * @returns The merged schema, its restrictions, the reason there are no params if there are
 *   none, and the sources that contributed.
 */
export function mergeParamSchema(
  adapterSchema: ModelParamSchema | null,
  discovered: ModelMetadata,
  catalogued: ModelMetadata,
  unsupportedKind: ProviderConnectionKind | null = null,
): MergedParamSchema {
  const restrictions = copyParamSchema(RESTRICTIONS_SCHEMA);

  if (adapterSchema === null) {
    const reason: NoParamsReason =
      unsupportedKind === null ? "alias_unbound" : "provider_unsupported";

    // Nothing is merged in either branch, and that is the honest answer rather than a shortcut.
    // With no adapter there is no statement to enrich: a catalogue entry alone would be this
    // service inventing a capability out of a file, which is the "no fabricated capabilities"
    // half of the ticket's unbound criterion.
    return {
      params: genericParamSchema(reason),
      restrictions,
      reason,
      sources: ["registry"],
    };
  }

  const properties: Record<string, ModelParamFieldSchema> = {};
  const sources = new Set<ParamSource>();

  for (const [name, field] of Object.entries(adapterSchema.properties)) {
    const merged = mergeField(name, field, discovered, catalogued);

    properties[name] = merged;

    for (const source of merged[SOURCES_ANNOTATION] ?? []) {
      sources.add(source);
    }
  }

  const empty = Object.keys(properties).length === 0;

  // The restrictions are always offered, so `registry` is always a contributor to the answer as
  // a whole even when no param field took a bound from V019's domain.
  sources.add("registry");

  return {
    params: {
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: adapterSchema.title,
      // An adapter with fields may still carry a description and it is kept; an adapter with
      // none must carry one, which `provider.params.ts` enforces — so the fallback below is for
      // the impossible case rather than the ordinary one, and it says the same thing.
      ...(adapterSchema.description === undefined
        ? empty
          ? { description: GENERIC_DESCRIPTIONS.provider_has_no_parameters }
          : {}
        : { description: adapterSchema.description }),
      properties,
      additionalProperties: false,
    },
    restrictions,
    reason: empty ? "provider_has_no_parameters" : null,
    sources: orderedSources(sources),
  };
}

/**
 * One field, with every source's contribution applied in precedence order.
 *
 * The order of the three steps below *is* the precedence rule, and each one is a different
 * operation for a different reason:
 *
 *   1. **Discovery tightens.** The adapter's bound is about the model family; discovery's is
 *      about the deployment in front of us. A smaller one wins and a larger one is ignored —
 *      a provider reporting a context above what the adapter will accept does not raise the
 *      adapter's ceiling, because the adapter's is a statement about what it will send.
 *   2. **The catalog fills.** Only where a bound is absent. See this file's header.
 *   3. **The registry clamps.** The intersection with what V019 will store, which cannot widen
 *      anything and is applied last so it is the final word.
 *
 * @param name - The param's name, which decides which metadata applies to it.
 * @param field - What the adapter declared.
 * @param discovered - Discovery's metadata.
 * @param catalogued - The catalog's metadata.
 * @returns The merged field, annotated with every source that shaped it.
 */
function mergeField(
  name: string,
  field: ModelParamFieldSchema,
  discovered: ModelMetadata,
  catalogued: ModelMetadata,
): ModelParamFieldSchema {
  const sources = new Set<ParamSource>(["adapter"]);
  let merged: ModelParamFieldSchema = { ...field };

  const fromDiscovery = ceilingFor(name, discovered);

  if (fromDiscovery !== null) {
    const tightened = tighten(merged, fromDiscovery);

    if (tightened !== merged) {
      merged = tightened;
      sources.add("discovery");
    }
  }

  const fromCatalog = ceilingFor(name, catalogued);

  if (fromCatalog !== null) {
    const filled = fillAbsent(merged, fromCatalog);

    if (filled !== merged) {
      merged = filled;
      sources.add("catalog");
    }
  }

  const storable = (STORABLE_PARAM_FIELDS as Record<string, ModelParamFieldSchema | undefined>)[
    name
  ];

  if (storable !== undefined) {
    const clamped = clampToStorable(merged, storable);

    if (clamped !== merged) {
      merged = clamped;
      sources.add("registry");
    }
  }

  return { ...merged, [SOURCES_ANNOTATION]: orderedSources(sources) };
}

/**
 * The ceiling one metadata source implies for one param, or null when it implies none.
 *
 * The whole of the mapping from *what a vendor publishes* to *what a form may offer*, in one
 * place. Three of V019's five params are bounded by something a source can know and two are
 * not: `thinking` is a choice with no numeric bound, and `temperature`'s range is the API's own
 * and is the adapter's to state.
 *
 * `token_budget` is bounded by the context window, and that is a real rule rather than a
 * convenience: thinking tokens are spent inside the context, so a budget above it is a budget
 * no request can honour.
 *
 * @param name - The param's name.
 * @param metadata - What the source knows.
 * @returns The ceiling, or null.
 */
function ceilingFor(name: string, metadata: ModelMetadata): number | null {
  switch (name as ModelAliasParamKey) {
    case "context_clamp":
    case "token_budget":
      return metadata.contextTokens;
    case "max_output":
      return metadata.maxOutputTokens;
    default:
      // Includes every param outside V019's five, which a registered adapter cannot ship —
      // the conformance kit refuses one — and which therefore reaches here only from a
      // fixture. Answering `null` leaves such a field exactly as its adapter declared it.
      return null;
  }
}

/**
 * A field whose ceiling is lowered to `ceiling`, or the same field when it already is lower.
 *
 * @param field - The field so far.
 * @param ceiling - The ceiling this source knows about.
 * @returns A new field, or the one passed in — returned by identity so the caller can tell
 *   whether the source actually contributed and label it only when it did.
 */
function tighten(field: ModelParamFieldSchema, ceiling: number): ModelParamFieldSchema {
  if (field.maximum !== undefined && field.maximum <= ceiling) {
    return field;
  }

  return { ...field, maximum: ceiling };
}

/**
 * A field whose ceiling is filled in **only if it has none**.
 *
 * The asymmetry with {@link tighten}, and the whole of *"never overrides live adapter or
 * discovery truth"*.
 *
 * @param field - The field so far.
 * @param ceiling - The ceiling this source knows about.
 * @returns A new field, or the one passed in by identity.
 */
function fillAbsent(field: ModelParamFieldSchema, ceiling: number): ModelParamFieldSchema {
  return field.maximum === undefined ? { ...field, maximum: ceiling } : field;
}

/**
 * A field intersected with what `model_aliases.params` will store.
 *
 * Applied last and cannot widen: a bound already inside the column's domain is left alone, and
 * one outside it — or absent — becomes the column's. See this file's header for why a schema
 * that skipped this step would render a control whose save is refused.
 *
 * @param field - The field so far.
 * @param storable - The column's own domain for this param, from `STORABLE_PARAM_FIELDS`.
 * @returns A new field, or the one passed in by identity.
 */
function clampToStorable(
  field: ModelParamFieldSchema,
  storable: ModelParamFieldSchema,
): ModelParamFieldSchema {
  const clamped: { minimum?: number; maximum?: number } = {};

  if (storable.minimum !== undefined && (field.minimum ?? -Infinity) < storable.minimum) {
    clamped.minimum = storable.minimum;
  }

  if (storable.maximum !== undefined && (field.maximum ?? Infinity) > storable.maximum) {
    clamped.maximum = storable.maximum;
  }

  return Object.keys(clamped).length === 0 ? field : { ...field, ...clamped };
}

/**
 * A set of sources in precedence order, highest first.
 *
 * Ordered rather than insertion-ordered so two merges that consulted the same sources in a
 * different order produce the same annotation — which is what makes the answer comparable
 * between calls, and what `params.merge.spec.ts` asserts by merging twice.
 *
 * @param sources - The sources that contributed.
 * @returns Them, ordered by `PARAM_SOURCES`.
 */
function orderedSources(sources: ReadonlySet<ParamSource>): ParamSource[] {
  // `PARAM_SOURCES` is declared in precedence order and this filter is the only thing that
  // depends on that, which is why the order is documented there rather than restated here.
  return PARAM_SOURCES.filter((source) => sources.has(source));
}

/**
 * The metadata a `meta` jsonb column carries, read defensively.
 *
 * Both columns are opaque — V012's is a vendor's own vocabulary and V017's is whatever an
 * adapter reported — so every value is checked rather than cast. A key holding a string, a
 * float or a negative is read as *the source did not say*, which is the honest reading: a
 * context window of `"200k"` is not a number this product can bound a form with, and treating
 * it as one would produce a ceiling nobody can explain.
 *
 * @param meta - The column's value, or undefined when there is no row.
 * @returns What is usable in it. {@link NO_METADATA} for an absent, empty or unreadable object.
 */
export function readModelMetadata(meta: Record<string, unknown> | undefined): ModelMetadata {
  if (typeof meta !== "object" || meta === null) {
    return NO_METADATA;
  }

  return {
    contextTokens: positiveInteger(meta.context_tokens),
    maxOutputTokens: positiveInteger(meta.max_output_tokens),
  };
}

/**
 * A value that is a whole number of tokens, or null.
 *
 * @param value - Whatever the column held.
 * @returns The number, or null for anything that is not a positive whole one.
 */
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Which params a merged schema offers, in the schema's own order.
 *
 * A small convenience with one real caller — the validation's *this model does not support
 * thinking* message, which names what it *does* support — kept here so the answer comes from
 * the merged schema rather than from a list somebody maintains beside it.
 *
 * @param schema - A merged params schema.
 * @returns The param names offered. Empty for a provider with nothing to tune.
 */
export function offeredParams(schema: ModelParamSchema): string[] {
  return Object.keys(schema.properties);
}

/**
 * The headline a list renders instead of a form — *what is this model, in one line*.
 *
 * CH.4's import wizard ([#587](https://github.com/NobuData/ouroboros/issues/587)) draws one of
 * these per candidate row: an operator naming forty models needs to know which of them think
 * and how much context they hold, and cannot be shown forty inspectors to find out. It is a
 * projection of the merge above and adds no knowledge of its own, which is the point — a
 * summary derived from a second reading of the same four sources would be a second precedence
 * rule waiting to disagree with this one.
 *
 * **The two token counts come from the metadata, not from the merged bounds.** A field's
 * `maximum` has been through {@link clampToStorable}, so `context_clamp.maximum` is *what this
 * product will store*, which for a model with a ten-million-token window is a smaller number
 * than the window. A headline saying what the model has must read what the sources said it
 * has.
 *
 * @param merged - The merged schema, whose param names and reason this reports.
 * @param discovered - What discovery reported about the model.
 * @param catalogued - What the bundled catalog knows. Consulted only where discovery said
 *   nothing, which is {@link fillAbsent}'s rule stated for a scalar.
 * @returns The headline.
 */
export function summariseCapabilities(
  merged: MergedParamSchema,
  discovered: ModelMetadata,
  catalogued: ModelMetadata,
): ModelCapabilitySummary {
  const params = offeredParams(merged.params);

  return {
    params,
    thinking: params.includes(THINKING_PARAM),
    contextTokens: discovered.contextTokens ?? catalogued.contextTokens,
    maxOutputTokens: discovered.maxOutputTokens ?? catalogued.maxOutputTokens,
    reason: merged.reason,
  };
}

/**
 * What a model can be tuned with and how much it holds, in the five facts a row has space for.
 *
 * Deliberately not a `MergedParamSchema` with fewer fields: a client handed a schema will
 * render a form from it, and a candidate row is not a form. See {@link summariseCapabilities}.
 */
export interface ModelCapabilitySummary {
  /** The params this model offers, in the adapter's order. Empty when {@link reason} says why. */
  readonly params: readonly string[];
  /** Whether `thinking` is one of them — the fact the row prints as a word rather than a count. */
  readonly thinking: boolean;
  /** The context window in tokens, or null when no source published one. */
  readonly contextTokens: number | null;
  /** The largest single answer in tokens, or null when no source published one. */
  readonly maxOutputTokens: number | null;
  /** Why there are no params, or null when there are some. */
  readonly reason: NoParamsReason | null;
}

/**
 * The param whose presence {@link ModelCapabilitySummary.thinking} reports.
 *
 * Named rather than inlined so the summary and V019's vocabulary cannot drift — `params.dto.ts`
 * and the adapters spell it the same way, and a headline reporting a key nothing offers would
 * quietly read `false` for every model.
 */
const THINKING_PARAM: ModelAliasParamKey = "thinking";
