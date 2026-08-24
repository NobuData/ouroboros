/**
 * The `422` a bad param write answers with — one schema, compiled by Ajv, and a message per
 * field that names what was wrong rather than what a validator calls it.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)). The ticket's acceptance
 * criteria are three sentences and all three are produced here:
 *
 * ```
 * {thinking: "max"} on qwen3-coder:32b  → 422  params.thinking      "qwen3-coder:32b does not support thinking…"
 * {temperature: 3.0} on claude-fable-5  → 422  params.temperature   "temperature must be between 0 and 1"
 * {batch_ok: "yes"}                     → 422  restrictions.batch_ok "batch_ok must be true or false"
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The schema that validates is the schema that rendered.** `params.merge.ts` produces one
 * value; the inspector draws its fields and this compiles it. There is no second description of
 * the rules to drift from the first — which is the discipline the whole ticket is about, applied
 * to itself.
 *
 * ---------------------------------------------------------------------------
 * **Why Ajv's messages are translated rather than forwarded.**
 *
 * Ajv is right and unhelpful. `must NOT have additional properties` is what JSON Schema calls a
 * param the model has no notion of, and the property's name is in a `params` object beside the
 * message rather than in it; `must be <= 1` says nothing about what the field is or what the
 * other end of the range is. A person looking at an inspector needs *this model does not have
 * that control* and *temperature runs from 0 to 1 here*, keyed by the field they typed into.
 * So {@link describeError} is a translation from keyword to sentence, and it is exhaustive over
 * the keywords this dialect can produce — a dialect narrow enough to render exhaustively is
 * narrow enough to explain exhaustively, which is the second dividend of `provider.params.ts`.
 *
 * ---------------------------------------------------------------------------
 * **The envelope is `errors/validation.ts`'s, deliberately.** A client already maps
 * `details[field]` to inputs for every DTO failure in this service; a param failure that
 * invented its own shape would be a second mapping for the same job. The code differs — this is
 * not a malformed request, it is a well-formed one the *model* refuses — and the field paths are
 * prefixed `params.` and `restrictions.` so they address the write body exactly as
 * `fieldMessages` addresses a nested DTO.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import { MODEL_ALIAS_PARAM_KEYS } from "../db/schema";
import { InvalidRequestError } from "../errors/error.envelope";
import type { ModelParamSchema, ModelParamValues } from "../providers/provider.params";
import { offeredParams, type MergedParamSchema } from "./params.merge";
import { REGISTRY_ERRORS } from "./registry.errors";

/** What a client is told, above the per-field detail. */
export const PARAMS_INVALID_MESSAGE =
  "These parameters are not ones this model accepts. See `details` for each field.";

/** The prefix the params half's field paths carry, matching the write body's own shape. */
export const PARAMS_FIELD_PREFIX = "params";

/** The prefix the restrictions half's field paths carry. */
export const RESTRICTIONS_FIELD_PREFIX = "restrictions";

/**
 * One `model_aliases` write's two documents.
 *
 * Both halves are optional because CH.1's create takes an alias with neither, which is the
 * ordinary way an alias is made — seven of mockup 21's eight rows have an empty one of at least
 * one of them. An absent document is validated as `{}` rather than skipped, so a schema that
 * somehow required something would be caught rather than silently satisfied.
 */
export interface AliasParamWrite {
  /** What is to become `model_aliases.params`. */
  readonly params?: ModelParamValues;
  /** What is to become `model_aliases.restrictions`. */
  readonly restrictions?: ModelParamValues;
}

/**
 * Check a write against the schema its inspector was rendered from.
 *
 * @param schema - The merged schema for the alias's model, from `params.merge.ts`. For an
 *   unbound alias its params half is empty, which means every param sent is refused by name —
 *   the honest answer, since nothing knows what the model supports.
 * @param write - The documents to check. Values are checked as sent: nothing here coerces a
 *   `"0.2"` into a number, because a client that sent a string meant to and a form that
 *   submitted one has a bug the coercion would hide until a request body carried it.
 * @param modelId - The model the schema is for, named in the messages. A refusal reading
 *   *does not support thinking* is only actionable if it says which model.
 * @returns Nothing. The success path is a return.
 * @throws {InvalidRequestError} `422 model_alias_params_invalid`, with one `details` entry per
 *   field — `params.thinking`, `restrictions.batch_ok` — each a list of sentences, exactly as
 *   `errors/validation.ts` shapes a DTO failure.
 */
export function assertParamsValid(
  schema: MergedParamSchema,
  write: AliasParamWrite,
  modelId: string,
): void {
  const fields: Record<string, string[]> = {};

  collect(fields, PARAMS_FIELD_PREFIX, schema.params, write.params ?? {}, modelId);
  collect(fields, RESTRICTIONS_FIELD_PREFIX, schema.restrictions, write.restrictions ?? {}, null);

  if (Object.keys(fields).length === 0) {
    return;
  }

  throw new InvalidRequestError(REGISTRY_ERRORS.aliasParamsInvalid, PARAMS_INVALID_MESSAGE, fields);
}

/**
 * Validate one document and add what is wrong with it to `fields`.
 *
 * @param fields - The accumulating details, mutated. One object across both halves so a write
 *   wrong in both is one answer rather than two round trips.
 * @param prefix - `params` or `restrictions` — what the field paths are keyed under.
 * @param schema - The half's schema.
 * @param values - The half's document.
 * @param modelId - The model, for the params half's messages; null for the restrictions half,
 *   whose rules are this workspace's rather than the model's.
 */
function collect(
  fields: Record<string, string[]>,
  prefix: string,
  schema: ModelParamSchema,
  values: ModelParamValues,
  modelId: string | null,
): void {
  const validate = compile(schema, prefix);

  if (validate(values)) {
    return;
  }

  for (const error of validate.errors ?? []) {
    const { field, message } = describeError(error, schema, modelId);
    const path = `${prefix}.${field}`;
    const existing = fields[path];

    // Appended rather than replaced: `allErrors` means one field can be wrong twice — a value
    // both below a minimum and of the wrong type — and a form showing one of the two sends
    // somebody back for a second attempt.
    if (existing === undefined) {
      fields[path] = [message];
    } else if (!existing.includes(message)) {
      existing.push(message);
    }
  }
}

/**
 * A compiled validator for one schema.
 *
 * A fresh Ajv per call rather than a cached one, and that is a considered trade. The schemas
 * here are *derived per model* — the merge narrows bounds from discovery, so two connections
 * reaching the same model can produce two different documents — which makes a cache key the
 * whole schema rather than a name. Compiling a five-property object is microseconds; a cache
 * keyed on a stringified schema would cost the stringify on every call and hold a validator per
 * distinct deployment for the life of the process.
 *
 * `strict: false` for the reason `openapi.spec.ts` and the conformance kit set it: the schema
 * carries `x-ouroboros-sources`, which is JSON Schema's own extension mechanism and which strict
 * mode reports as an unknown keyword.
 *
 * @param schema - The schema to compile.
 * @param prefix - Used as the `$id` so two compiled in one call cannot collide.
 * @returns The validator.
 */
function compile(schema: ModelParamSchema, prefix: string): ValidateFunction {
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  return ajv.compile({ ...schema, $id: `urn:ouroboros:model-params:write:${prefix}` });
}

/**
 * One Ajv error, as the field it is about and the sentence a person needs.
 *
 * Exhaustive over the keywords this dialect can produce, which is a short list precisely because
 * the dialect is narrow: `additionalProperties` (a param the model has no notion of), `type`,
 * `enum`, `minimum` and `maximum`. Anything else falls through to Ajv's own message, which is
 * correct if unlovely and is what a keyword added to the dialect without a sentence here would
 * produce until somebody writes one.
 *
 * @param error - What Ajv reported.
 * @param schema - The schema it was validating against, read for the field's own title and
 *   bounds so a message can quote them.
 * @param modelId - The model, or null for the restrictions half.
 * @returns The field's name — without a prefix — and the message.
 */
function describeError(
  error: ErrorObject,
  schema: ModelParamSchema,
  modelId: string | null,
): { field: string; message: string } {
  if (error.keyword === "additionalProperties") {
    const field = String((error.params as { additionalProperty?: unknown }).additionalProperty);

    return { field, message: unsupportedMessage(field, schema, modelId) };
  }

  // Every other keyword is about a property, and Ajv addresses it as `/name` from the document
  // root. One segment, always, because the dialect has no nesting.
  const field = error.instancePath.replace(/^\//, "");
  const declared = schema.properties[field];
  const label = declared === undefined ? field : `${field} (${declared.title})`;

  switch (error.keyword) {
    case "enum": {
      const allowed = declared?.enum ?? [];

      return {
        field,
        message: `${label} must be one of ${allowed.join(", ")}`,
      };
    }
    case "type":
      return { field, message: `${label} must be ${typeWord(declared?.type)}` };
    case "minimum":
    case "maximum":
      return { field, message: `${label} must be ${rangeWord(declared)}` };
    default:
      return { field, message: `${label} ${error.message ?? "is not valid"}` };
  }
}

/**
 * What a client is told about a param the model has no notion of.
 *
 * The ticket's headline refusal, and the one that has to name three things to be useful: the
 * param, the model, and what the model *does* offer. *"model does not support thinking"* alone
 * leaves somebody guessing whether they misspelled a key or picked the wrong model.
 *
 * @param field - The param that was sent.
 * @param schema - The schema it was refused by.
 * @param modelId - The model, or null for the restrictions half — whose refusal is about this
 *   product's vocabulary rather than about any model.
 * @returns The sentence.
 */
function unsupportedMessage(
  field: string,
  schema: ModelParamSchema,
  modelId: string | null,
): string {
  if (modelId === null) {
    const known = offeredParams(schema);

    return `${field} is not a restriction this registry has — it has ${known.join(" and ")}`;
  }

  const offered = offeredParams(schema);
  const supported =
    offered.length === 0 ? "it accepts no parameters at all" : `it accepts ${offered.join(", ")}`;

  // Two refusals rather than one, because the two mistakes are different. A key V019 stores that
  // this model does not offer is *the model does not have that control*; a key V019 does not
  // store at all is a misspelling or a param from somewhere else, and telling somebody their
  // model lacks `temprature` would send them looking at the wrong thing.
  const storable: readonly string[] = MODEL_ALIAS_PARAM_KEYS;

  return storable.includes(field)
    ? `${modelId} does not support ${field} — ${supported}`
    : `${field} is not a parameter this registry stores — ${supported}`;
}

/**
 * A declared type as the word a message uses.
 *
 * @param type - The declared type, or undefined for a field the schema does not declare.
 * @returns The word — *a whole number*, *a number*, *true or false*, *text*.
 */
function typeWord(type: string | undefined): string {
  switch (type) {
    case "integer":
      return "a whole number";
    case "number":
      return "a number";
    case "boolean":
      return "true or false";
    case "string":
      return "text";
    default:
      return "of the declared type";
  }
}

/**
 * A field's permitted range as a clause — *between 0 and 1*, *at least 1*, *at most 400000*.
 *
 * The ticket asks for *"a temperature of 3.0 is rejected with the permitted range in the
 * error"*, and the range is read off the same merged schema the form was rendered from — so a
 * bound that came from discovery is quoted as discovery narrowed it, rather than as the adapter
 * originally declared it.
 *
 * @param declared - The field's schema, or undefined for a field the schema does not declare.
 * @returns The clause.
 */
function rangeWord(declared: { minimum?: number; maximum?: number } | undefined): string {
  const minimum = declared?.minimum;
  const maximum = declared?.maximum;

  if (minimum !== undefined && maximum !== undefined) {
    return `between ${minimum} and ${maximum}`;
  }

  if (minimum !== undefined) {
    return `at least ${minimum}`;
  }

  if (maximum !== undefined) {
    return `at most ${maximum}`;
  }

  return "inside its permitted range";
}
