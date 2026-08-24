/**
 * The dialect an adapter's `paramSchema()` is written in — the thing that lets mockup 21's
 * inspector offer *thinking* on one alias, *context clamp* on another, and nothing at all on a
 * third, out of one renderer.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)), an amendment to AC.1
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)). It is `provider.config.ts` one
 * layer along: that file is the dialect of *what a provider needs configured*, this is the
 * dialect of *what a model can be tuned with*, and both exist so a form is data rather than a
 * `switch (kind)`.
 *
 * ---------------------------------------------------------------------------
 * **The problem it exists for.** A thinking budget on `qwen3-coder:32b` is a field somebody
 * fills in, a value the server stores, a chip the table renders — and nothing at all at the
 * other end, because the model has no such notion. The inspector must therefore be generated
 * from what the adapter says the model supports (decision **R3**, option 2-A), which means an
 * adapter has to have somewhere to say it. This is that place.
 *
 * ---------------------------------------------------------------------------
 * **Why a subset of JSON Schema, again.** The argument is `provider.config.ts`'s and has not
 * changed: a renderer that has to handle `$ref`, `oneOf` and nesting is a renderer full of
 * special cases, and the second list has no end. So this dialect is **one flat object of
 * scalar-valued fields** — {@link paramSchemaViolations} is the gate and `param.forms.ts` is a
 * total function over what survives.
 *
 * It is still real JSON Schema, and here that is load-bearing rather than tidy: the same
 * document is compiled with Ajv and used to validate every write CH.1
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)) makes. The form a person fills in
 * and the check the server applies are one artefact, so they cannot drift.
 *
 * ---------------------------------------------------------------------------
 * **Four types rather than one, and that is the difference from the config dialect.** A
 * provider configuration is a form of strings; a param is a number, a level or a switch, and
 * a temperature typed as a string would be a range check written in a regular expression. The
 * cost is four widget cases in one renderer, paid once.
 *
 * ---------------------------------------------------------------------------
 * **An empty schema is a legitimate answer, and it must explain itself.**
 *
 * Mockup 07's Copilot and Cursor cards are fixed catalogs reached through APIs with no
 * per-call tunables this product can honestly offer. The ticket asks for *"minimal or empty
 * tunables, stated as such rather than faked"*, so a schema with no properties is allowed —
 * and is required to carry a {@link ModelParamSchema.description} saying why, which the
 * inspector renders in place of the fields. That is the whole difference between an empty form
 * and a form that failed to load, and it is checked rather than hoped for.
 *
 * ---------------------------------------------------------------------------
 * **An adapter may only offer keys V019 can store.** {@link storageViolations} is that rule,
 * and the conformance kit applies it to every registered adapter. The database's vocabulary is
 * closed ([#579](https://github.com/NobuData/ouroboros/issues/579), decision **R3**) and its
 * bounds are real, so an adapter offering a sixth key — or a temperature ceiling of five —
 * would be rendering a field whose valid-looking value the insert refuses. Catching that in an
 * adapter author's test run is the point; catching it at somebody's **Save alias** is the
 * failure being avoided.
 *
 * The rule is deliberately *not* part of {@link paramSchemaViolations}. The dialect is about
 * shape and is what `param.forms.ts` is total over — which is what lets `param.shapes.fixture.ts`
 * prove a schema carrying a param nothing in this build has ever seen still renders a field,
 * with no renderer change. Storability is a separate question with a separate answer.
 */

import {
  MODEL_ALIAS_PARAM_KEYS,
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MAX,
  MODEL_ALIAS_TOKENS_MIN,
  MODEL_ALIAS_RESTRICTION_KEYS,
  THINKING_LEVELS,
  type ModelAliasParamKey,
} from "../db/schema";

/** The JSON Schema dialect every param schema declares. The same one config schemas use. */
export const MODEL_PARAM_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * The four types a param may have.
 *
 * `integer` is separate from `number` because JSON Schema's is: a token budget of `4096.5` is
 * not a small mistake, it is a value no provider accepts, and `type: "integer"` is how a
 * validator says so without anybody writing a `multipleOf`.
 */
export type ModelParamType = "string" | "integer" | "number" | "boolean";

/** The four types as values, for a renderer that switches over them exhaustively. */
export const MODEL_PARAM_TYPES = [
  "string",
  "integer",
  "number",
  "boolean",
] as const satisfies readonly ModelParamType[];

/**
 * Where a field, or one of its bounds, came from.
 *
 * The annotation exists because the merge has four contributors of very different authority —
 * see `registry/params.merge.ts` — and a page that cannot tell a live bound from a catalogued
 * guess is a page whose bounds all have to be distrusted. It is the same argument decision
 * **P8** makes about the `priority tier` pill.
 */
export type ParamSource = "adapter" | "discovery" | "catalog" | "registry";

/**
 * The four sources, **in precedence order, highest first**.
 *
 * `adapter` is what the live provider adapter says about this model; `discovery` is what that
 * provider reported about it into `provider_models` (V017); `catalog` is the bundled price
 * catalog's metadata (V012), which is a snapshot of somebody else's file and may never
 * override either of the two above it; `registry` is this workspace's own policy, which is not
 * a claim about the model at all.
 */
export const PARAM_SOURCES = [
  "adapter",
  "discovery",
  "catalog",
  "registry",
] as const satisfies readonly ParamSource[];

/**
 * The annotation naming every source that shaped a field.
 *
 * `x-` prefixed, which is JSON Schema's own extension mechanism, so a generic validator ignores
 * it and the schema stays portable — the same trade `provider.config.ts` makes for
 * `x-ouroboros-secret`.
 */
export const SOURCES_ANNOTATION = "x-ouroboros-sources";

/** How a param name may be spelled — the snake_case the jsonb documents are keyed by. */
export const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * One tunable, as JSON Schema plus one annotation.
 *
 * The keywords are JSON Schema's and mean what JSON Schema says they mean. What is *not* here
 * is as deliberate as what is: no `$ref`, no composition keywords, no nesting, no arrays. See
 * this file's header.
 */
export interface ModelParamFieldSchema {
  /** Which of the four this is. */
  readonly type: ModelParamType;
  /**
   * The form's label — *Thinking*, *Token budget*, *Temperature*.
   *
   * Required rather than optional, for `provider.config.ts`'s reason: the fallback for a
   * missing label is the property name, and `context_clamp` is not a label.
   */
  readonly title: string;
  /** The help line under the input, when the label is not enough on its own. */
  readonly description?: string;
  /**
   * The permitted values, for a `string` field. Drives the `select` widget.
   *
   * `string` only, and the dialect enforces it: an enum of numbers would be a choice a
   * renderer draws as a select and a validator checks as a bound, which are two different
   * fields wearing one declaration.
   */
  readonly enum?: readonly string[];
  /** The lowest acceptable value, for a `number` or an `integer`. */
  readonly minimum?: number;
  /** The highest acceptable value, for a `number` or an `integer`. */
  readonly maximum?: number;
  /**
   * What the field starts at when the alias has no value of its own.
   *
   * **Not a value this product sends.** An alias whose `params` omits a key is an alias that
   * says nothing about it, and what a provider then does is the provider's own default. This
   * is what the *input* shows before somebody types, which is a rendering decision and not a
   * claim about a request body.
   */
  readonly default?: string | number | boolean;
  /**
   * Every source that shaped this field, highest precedence first.
   *
   * Written by the merge, not by an adapter — an adapter's own schema is `adapter` throughout
   * and may leave the annotation off. See `registry/params.merge.ts`.
   */
  readonly [SOURCES_ANNOTATION]?: readonly ParamSource[];
}

/**
 * What an adapter's `paramSchema()` answers — one flat object, renderable exhaustively.
 *
 * **Field order is the insertion order of {@link properties}**, and it is a contract for
 * `provider.config.ts`'s reason: ECMAScript fixes the iteration order of non-integer string
 * keys and `JSON.parse` preserves it, so the inspector draws the fields in the order their
 * author wrote them. The conformance kit round-trips every schema through JSON and asserts the
 * order survives.
 *
 * **There is no `required`.** Every param is optional by construction: an alias that names none
 * of them is an alias that takes the provider's defaults, which is the ordinary state and the
 * one seven of mockup 21's eight rows are in. A `required: []` would invite a reader to wonder
 * what would go in it.
 */
export interface ModelParamSchema {
  /** Always {@link MODEL_PARAM_DIALECT}. Stated so a generic validator knows the rules. */
  readonly $schema: typeof MODEL_PARAM_DIALECT;
  /** Always `"object"`. */
  readonly type: "object";
  /** What the inspector's param section is headed — *Anthropic model parameters*. */
  readonly title: string;
  /**
   * Why there is nothing to tune, when there is nothing to tune.
   *
   * Required exactly when {@link properties} is empty — see this file's header. Allowed, and
   * useful, on a schema that does have fields.
   */
  readonly description?: string;
  /** The tunables, in the order the inspector renders them. May be empty. */
  readonly properties: Readonly<Record<string, ModelParamFieldSchema>>;
  /**
   * Always `false`.
   *
   * The keyword that makes *this model does not support thinking* a validation failure rather
   * than a stored key nothing reads. Every `422` CH.2 answers with is, at bottom, this line.
   */
  readonly additionalProperties: false;
}

/**
 * A stored `model_aliases.params` or `model_aliases.restrictions` document, as it arrives.
 *
 * Scalar-valued because {@link ModelParamFieldSchema} is. `unknown` rather than the union,
 * because the interesting caller is a validator holding something a client just sent.
 */
export type ModelParamValues = Readonly<Record<string, unknown>>;

/**
 * Everything wrong with a param schema, in the order it was found.
 *
 * A list of sentences rather than a thrown error or a boolean, for the reason
 * `configSchemaViolations` is one: a new adapter with six problems should be six sentences and
 * one run, and the function itself has to be testable against a schema that is wrong in six
 * ways at once.
 *
 * The checks are the dialect restated as code. Every one is something `param.forms.ts` would
 * otherwise have to defend against at render time, which is how a renderer acquires special
 * cases.
 *
 * @param schema - The schema an adapter answered. Typed as `unknown` because the interesting
 *   caller is a conformance kit checking somebody else's adapter, and an adapter written in
 *   JavaScript, or against an older version of this interface, will not have been stopped by
 *   the compiler.
 * @returns The violations. Empty means the schema is in the dialect and
 *   {@link import("./param.forms").toParamFields} is total over it.
 */
export function paramSchemaViolations(schema: unknown): string[] {
  const violations: string[] = [];

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return ["schema must be an object"];
  }

  const candidate = schema as Partial<ModelParamSchema>;

  if (candidate.$schema !== MODEL_PARAM_DIALECT) {
    violations.push(`$schema must be "${MODEL_PARAM_DIALECT}"`);
  }

  if (candidate.type !== "object") {
    violations.push('type must be "object"');
  }

  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    violations.push("title must be a non-empty string");
  }

  if (candidate.additionalProperties !== false) {
    violations.push("additionalProperties must be false");
  }

  // The dialect has no `required` at all — see the interface. Reported rather than ignored,
  // because a schema carrying one was written against a different idea of what a param is, and
  // silently dropping the keyword would leave that idea in place.
  if ("required" in candidate) {
    violations.push("the dialect has no required — every param is optional by construction");
  }

  const properties = candidate.properties;

  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    violations.push("properties must be an object");

    return violations;
  }

  const names = Object.keys(properties);

  if (
    names.length === 0 &&
    (typeof candidate.description !== "string" || candidate.description.length === 0)
  ) {
    // The one rule that is about honesty rather than about shape. A fixed catalog with nothing
    // to tune is a legitimate answer and the inspector has to be able to say *why* there are no
    // fields — otherwise an empty form and a form that failed to load look the same.
    violations.push("a schema with no properties must carry a description saying why");
  }

  for (const name of names) {
    violations.push(...fieldViolations(name, properties[name]));
  }

  return violations;
}

/**
 * Everything wrong with one field.
 *
 * Split out so {@link paramSchemaViolations} reads as the list of *schema* rules, and so a
 * violation always names the field it is about.
 *
 * @param name - The property name, used to prefix every sentence.
 * @param field - What the schema declared for it.
 * @returns The violations for this field.
 */
function fieldViolations(name: string, field: unknown): string[] {
  const violations: string[] = [];
  const prefix = `param "${name}":`;

  if (!PARAM_NAME_PATTERN.test(name)) {
    violations.push(`${prefix} a param name must match ${PARAM_NAME_PATTERN.source}`);
  }

  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return [...violations, `${prefix} must be an object`];
  }

  const candidate = field as Partial<ModelParamFieldSchema>;
  const type = candidate.type;

  if (type === undefined || !MODEL_PARAM_TYPES.includes(type)) {
    violations.push(`${prefix} type must be one of ${MODEL_PARAM_TYPES.join(", ")}`);
  }

  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    violations.push(`${prefix} title must be a non-empty string`);
  }

  violations.push(...enumViolations(prefix, type, candidate.enum));
  violations.push(...boundViolations(prefix, type, candidate));
  violations.push(...defaultViolations(prefix, type, candidate));
  violations.push(...sourceViolations(prefix, candidate[SOURCES_ANNOTATION]));

  const composition = ["$ref", "oneOf", "anyOf", "allOf", "not", "if", "properties", "items"];
  const present = composition.filter((keyword) => keyword in candidate);

  if (present.length > 0) {
    violations.push(`${prefix} the dialect has no ${present.join(", ")} — see provider.params.ts`);
  }

  return violations;
}

/**
 * Everything wrong with a field's `enum`.
 *
 * @param prefix - The sentence prefix naming the field.
 * @param type - The declared type, or whatever was in its place.
 * @param values - The declared enum, if any.
 * @returns The violations.
 */
function enumViolations(prefix: string, type: unknown, values: unknown): string[] {
  if (values === undefined) {
    return [];
  }

  if (type !== "string") {
    return [`${prefix} enum is for a string field — see provider.params.ts`];
  }

  if (!Array.isArray(values) || values.length === 0) {
    return [`${prefix} enum, when present, must be a non-empty array`];
  }

  return values.every((value) => typeof value === "string")
    ? []
    : [`${prefix} every enum value must be a string`];
}

/**
 * Everything wrong with a field's `minimum` and `maximum`.
 *
 * @param prefix - The sentence prefix naming the field.
 * @param type - The declared type, or whatever was in its place.
 * @param field - The field, read defensively.
 * @returns The violations.
 */
function boundViolations(
  prefix: string,
  type: unknown,
  field: Partial<ModelParamFieldSchema>,
): string[] {
  const violations: string[] = [];
  const numeric = type === "number" || type === "integer";

  for (const keyword of ["minimum", "maximum"] as const) {
    const bound = field[keyword];

    if (bound === undefined) {
      continue;
    }

    if (!numeric) {
      violations.push(`${prefix} ${keyword} is for a number or an integer field`);
    } else if (typeof bound !== "number" || !Number.isFinite(bound)) {
      violations.push(`${prefix} ${keyword}, when present, must be a finite number`);
    } else if (type === "integer" && !Number.isInteger(bound)) {
      violations.push(`${prefix} ${keyword} on an integer field must be a whole number`);
    }
  }

  const { minimum, maximum } = field;

  if (
    typeof minimum === "number" &&
    typeof maximum === "number" &&
    Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    minimum > maximum
  ) {
    // A range nothing satisfies. It renders as an input a person cannot fill in correctly and
    // validates as a field that always fails, which is worse than either half alone.
    violations.push(`${prefix} minimum ${minimum} is above maximum ${maximum}`);
  }

  return violations;
}

/**
 * Everything wrong with a field's `default`.
 *
 * A default outside its own field's rules is the specific bug worth spending a check on: the
 * form starts at a value, the person changes nothing, and the save is refused by the schema the
 * form was rendered from.
 *
 * @param prefix - The sentence prefix naming the field.
 * @param type - The declared type, or whatever was in its place.
 * @param field - The field, read defensively.
 * @returns The violations.
 */
function defaultViolations(
  prefix: string,
  type: unknown,
  field: Partial<ModelParamFieldSchema>,
): string[] {
  const value = field.default;

  if (value === undefined) {
    return [];
  }

  if (!matchesType(value, type)) {
    return [`${prefix} default ${JSON.stringify(value)} is not a ${String(type)}`];
  }

  if (typeof value === "string" && field.enum !== undefined && !field.enum.includes(value)) {
    return [`${prefix} default ${JSON.stringify(value)} is not one of its enum values`];
  }

  if (typeof value === "number") {
    const { minimum, maximum } = field;

    if (typeof minimum === "number" && value < minimum) {
      return [`${prefix} default ${value} is below minimum ${minimum}`];
    }

    if (typeof maximum === "number" && value > maximum) {
      return [`${prefix} default ${value} is above maximum ${maximum}`];
    }
  }

  return [];
}

/**
 * Everything wrong with a field's source annotation.
 *
 * @param prefix - The sentence prefix naming the field.
 * @param sources - The annotation's value, if any.
 * @returns The violations.
 */
function sourceViolations(prefix: string, sources: unknown): string[] {
  if (sources === undefined) {
    return [];
  }

  if (!Array.isArray(sources) || sources.length === 0) {
    return [`${prefix} ${SOURCES_ANNOTATION}, when present, must be a non-empty array`];
  }

  const unknownSources = sources.filter(
    (source) => typeof source !== "string" || !PARAM_SOURCES.includes(source as ParamSource),
  );

  return unknownSources.length === 0
    ? []
    : [`${prefix} ${SOURCES_ANNOTATION} names ${unknownSources.join(", ")}, which is not a source`];
}

/**
 * Whether a value is of the declared type, JSON Schema's way.
 *
 * @param value - The value.
 * @param type - The declared type, or whatever was in its place.
 * @returns Whether they agree. `false` for a type that is not one of the four, which is
 *   already reported separately — this function does not need to guess what was meant.
 */
function matchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return false;
  }
}

/**
 * What V019 will store for each key it accepts — the domain a param schema must stay inside.
 *
 * The mirror of `ouroboros.model_alias_params_valid()`, as fields. It is the *widest* schema
 * this product can hold: an adapter narrows it — Anthropic's temperature ceiling is one, not
 * two — and may never widen it.
 *
 * Exported because two callers need it and neither should re-derive it: {@link storageViolations}
 * checks an adapter against it, and `registry/params.merge.ts` uses the restriction half
 * verbatim as the schema it appends to every answer.
 */
export const STORABLE_PARAM_FIELDS: Readonly<Record<ModelAliasParamKey, ModelParamFieldSchema>> =
  Object.freeze({
    thinking: {
      type: "string",
      title: "Thinking",
      enum: THINKING_LEVELS,
    },
    token_budget: {
      type: "integer",
      title: "Token budget",
      minimum: MODEL_ALIAS_TOKENS_MIN,
      maximum: MODEL_ALIAS_TOKENS_MAX,
    },
    max_output: {
      type: "integer",
      title: "Max output",
      minimum: MODEL_ALIAS_TOKENS_MIN,
      maximum: MODEL_ALIAS_TOKENS_MAX,
    },
    context_clamp: {
      type: "integer",
      title: "Context clamp",
      minimum: MODEL_ALIAS_TOKENS_MIN,
      maximum: MODEL_ALIAS_TOKENS_MAX,
    },
    temperature: {
      type: "number",
      title: "Temperature",
      minimum: MODEL_ALIAS_TEMPERATURE_MIN,
      maximum: MODEL_ALIAS_TEMPERATURE_MAX,
    },
  });

/**
 * Everything about a param schema that the database would refuse to store.
 *
 * The rule shipped adapters are held to, applied by the conformance kit — see this file's
 * header for why it is separate from {@link paramSchemaViolations}. Three things are checked,
 * and each of them is a field somebody could fill in correctly and fail to save:
 *
 *   * a **key** outside V019's five;
 *   * a **type** that is not the one the column's own check expects;
 *   * a **bound** wider than V019's, including an enum value it does not accept.
 *
 * @param schema - The schema an adapter answered, already known to be in the dialect. Typed
 *   as `unknown` for {@link paramSchemaViolations}' reason.
 * @returns The violations. Empty means every field this schema offers is one a write could
 *   land.
 */
export function storageViolations(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return ["schema must be an object"];
  }

  const properties = (schema as Partial<ModelParamSchema>).properties;

  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return ["properties must be an object"];
  }

  const violations: string[] = [];

  for (const [name, field] of Object.entries(properties)) {
    const storable = (STORABLE_PARAM_FIELDS as Record<string, ModelParamFieldSchema | undefined>)[
      name
    ];

    if (storable === undefined) {
      violations.push(
        `param "${name}" is not one of the keys model_aliases.params stores ` +
          `(${MODEL_ALIAS_PARAM_KEYS.join(", ")}) — see V019, decision R3`,
      );

      continue;
    }

    violations.push(...narrowerThan(name, field, storable));
  }

  return violations;
}

/**
 * Whether one field stays inside another's domain, as sentences.
 *
 * @param name - The param's name, for the messages.
 * @param field - What the adapter declared.
 * @param storable - What the column will hold, from {@link STORABLE_PARAM_FIELDS}.
 * @returns The violations.
 */
function narrowerThan(
  name: string,
  field: ModelParamFieldSchema,
  storable: ModelParamFieldSchema,
): string[] {
  const violations: string[] = [];
  const prefix = `param "${name}":`;

  if (field.type !== storable.type) {
    violations.push(`${prefix} must be a ${storable.type} — model_aliases.params stores one`);
  }

  if (storable.enum !== undefined) {
    const offered = field.enum ?? [];
    const outside = offered.filter((value) => !storable.enum?.includes(value));

    if (field.enum === undefined) {
      violations.push(`${prefix} must declare an enum — V019 accepts ${storable.enum.join(", ")}`);
    } else if (outside.length > 0) {
      violations.push(`${prefix} offers ${outside.join(", ")}, which V019 does not accept`);
    }
  }

  // An **absent** bound is not a violation, and that asymmetry is deliberate. A ceiling the
  // adapter does not know is the ordinary case — Anthropic's maximum output differs per model
  // and no adapter can ask offline — and `params.merge.ts` fills such a bound from the catalog
  // and then clamps it to V019's domain, so nothing unstorable reaches a form. What is refused
  // is a bound the adapter *states* and states wider than the column, because that is a claim
  // the merge would have to overrule rather than complete.
  if (
    field.minimum !== undefined &&
    storable.minimum !== undefined &&
    field.minimum < storable.minimum
  ) {
    violations.push(`${prefix} minimum must be at least ${storable.minimum} — V019's floor`);
  }

  if (
    field.maximum !== undefined &&
    storable.maximum !== undefined &&
    field.maximum > storable.maximum
  ) {
    violations.push(`${prefix} maximum must be at most ${storable.maximum} — V019's ceiling`);
  }

  return violations;
}

/**
 * The schema for the two registry restriction flags — the same object on every answer.
 *
 * Appended to every param schema CH.2 serves, bound or unbound, and adapter-independently:
 * `review_vote_only` and `batch_ok` are what *this workspace* allows an alias to be used for,
 * which is true of the alias regardless of what is on the other end of it. An adapter is never
 * asked about them and could not answer if it were.
 *
 * Served as a second schema rather than merged into the params one, because the two are stored
 * in two columns with two vocabularies — so a `422` can name `restrictions.batch_ok` and mean
 * exactly one thing, and a write can be checked against the rules that actually apply to it.
 */
export const RESTRICTIONS_SCHEMA: ModelParamSchema = Object.freeze({
  $schema: MODEL_PARAM_DIALECT,
  type: "object",
  title: "Registry restrictions",
  description:
    "What this workspace allows this alias to be used for. Registry policy rather than " +
    "provider capability, so it is offered on every alias — including one with no provider " +
    "bound yet.",
  properties: Object.freeze({
    review_vote_only: {
      type: "boolean",
      title: "Review vote only",
      description: "This alias may cast a review vote and may not be routed work of its own.",
      [SOURCES_ANNOTATION]: ["registry"],
    },
    batch_ok: {
      type: "boolean",
      title: "Batch ok",
      description: "Work routed to this alias may be batched rather than sent one call at a time.",
      [SOURCES_ANNOTATION]: ["registry"],
    },
  }) satisfies Readonly<
    Record<(typeof MODEL_ALIAS_RESTRICTION_KEYS)[number], ModelParamFieldSchema>
  >,
  additionalProperties: false,
});

/**
 * A deep copy of a param schema.
 *
 * Every `paramSchema()` hands out one, for the reason `configSchema()` does: the caller is a
 * form renderer holding the value while somebody fills it in, and an adapter handing out its
 * own object would have that form's edits land in the adapter. The conformance kit tries
 * exactly that.
 *
 * @param schema - The schema to copy.
 * @returns A structurally equal value sharing nothing with the original.
 */
export function copyParamSchema(schema: ModelParamSchema): ModelParamSchema {
  return JSON.parse(JSON.stringify(schema)) as ModelParamSchema;
}
