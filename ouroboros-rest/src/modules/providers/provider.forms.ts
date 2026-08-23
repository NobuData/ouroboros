/**
 * A config schema, as the thing a form renderer actually iterates.
 *
 * AC.1's ([#216](https://github.com/NobuData/ouroboros/issues/216)) third acceptance
 * criterion: *config schemas render AE.5's forms with zero UI special-casing, proven with a
 * fixture rather than asserted*. This file is the half of that proof that lives in `rest` —
 * one total function from a schema to an ordered list of fields, with **no provider kind
 * anywhere in it**. `provider.forms.spec.ts` reads this file's own source with its comments
 * stripped and fails if any of V015's six kinds appears in the code, which is the only version
 * of "no special-casing" that stays true after somebody is in a hurry.
 *
 * The fixture half is `card.shapes.fixture.ts`: the five card shapes mockup 07 draws, written
 * as schemas, run through {@link toFormFields}, with the expected field list recorded beside
 * each. Anthropic's masked key row, the vLLM card's address field *plus* optional key, Ollama's
 * host field and no key at all — five different-looking cards out of one call.
 *
 * ---------------------------------------------------------------------------
 * **Why a form model at all, rather than handing AE.5 the schema.**
 *
 * Because the derivations are decisions, and they should be made once on this side. Which
 * widget a field gets, whether it is required, what its placeholder is, and — the one that
 * matters — *which field is the credential*: all four are read from the schema by rules a
 * renderer would otherwise implement, differently, in the add-form (AE.5) and in the card
 * (AE.2, [#228](https://github.com/NobuData/ouroboros/issues/228)). Two renderers disagreeing
 * about which field goes to the vault is not a cosmetic bug.
 *
 * ---------------------------------------------------------------------------
 * **{@link partitionSubmission} is the safeguard, not a convenience.**
 *
 * A form comes back as one flat object of strings, and exactly one of its entries must not be
 * stored as configuration. Every consumer that splits that object by hand is a consumer that
 * can get it wrong once and write a credential into `provider_connections`, which V015's
 * CHECK would not catch because it only guards the *encrypted* column. So the split is a
 * function, it is derived from the same annotation the renderer used to mask the input, and
 * `provider.forms.spec.ts` asserts the secret is absent from the config half rather than
 * trusting the two to agree.
 */

import {
  PLACEHOLDER_ANNOTATION,
  SECRET_ANNOTATION,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
  type ProviderFieldSchema,
} from "./provider.config";

/**
 * How one field is drawn.
 *
 * Four values, derived rather than declared — see {@link widgetFor}. An adapter author picks a
 * widget by describing the field truthfully (*it is a URI*, *it is the credential*), which is
 * the property that keeps a fifth widget from being invented per provider.
 */
export type ProviderFormWidget = "text" | "url" | "secret" | "select";

/**
 * One rendered field.
 *
 * Every optional schema keyword becomes an explicit `null` here, which is the same asymmetry
 * `provider-health/snapshot.ts` draws between a stored row and a read value: absence is fine
 * in a schema an author is writing, and unhelpful in a value a renderer is consuming.
 */
export interface ProviderFormField {
  /** The property name — what a submitted value is keyed by. Never shown to a person. */
  readonly name: string;
  /** What the `<label>` says. */
  readonly label: string;
  /** How to draw it. */
  readonly widget: ProviderFormWidget;
  /** Whether the schema requires a value. */
  readonly required: boolean;
  /** The help line under the input, or null. */
  readonly help: string | null;
  /** The input's placeholder, or null. */
  readonly placeholder: string | null;
  /** What the input starts at, or null. */
  readonly defaultValue: string | null;
  /** The options for a `select`, or null for every other widget. */
  readonly choices: readonly string[] | null;
  /** The shortest acceptable value, or null. */
  readonly minLength: number | null;
  /** The longest acceptable value, or null. */
  readonly maxLength: number | null;
  /** The pattern a value must match, or null. */
  readonly pattern: string | null;
}

/**
 * A submitted add-form, split into the two places its values go.
 *
 * The whole reason {@link partitionSubmission} exists — see this file's header.
 */
export interface ProviderSubmission {
  /** Everything that is stored as configuration. Never contains the credential. */
  readonly config: ProviderConnectionConfig;
  /**
   * The credential, for the vault — or null when the schema declares none, or when the
   * schema declares an optional one and nobody filled it in.
   *
   * Null rather than an empty string, because an empty credential is not a credential and a
   * connection sealing `""` would look configured and fail at first use.
   */
  readonly secret: string | null;
}

/**
 * Which widget a field is drawn with.
 *
 * The order of the checks is the priority: a field that is the credential is a masked row
 * whatever else it says about itself, because getting that wrong renders a key in the clear.
 *
 * @param field - The field's schema.
 * @returns The widget.
 */
export function widgetFor(field: ProviderFieldSchema): ProviderFormWidget {
  if (field[SECRET_ANNOTATION] === true) {
    return "secret";
  }

  if (field.enum !== undefined) {
    return "select";
  }

  return field.format === "uri" ? "url" : "text";
}

/**
 * The fields of one schema, in the order the form renders them.
 *
 * Total over every schema {@link import("./provider.config").configSchemaViolations} accepts —
 * there is no branch here that can fail to produce a field, which is what makes a renderer
 * over the result total too.
 *
 * @param schema - The adapter's config schema.
 * @returns The fields, in `properties` insertion order. See `provider.config.ts` on why that
 *   order is a contract rather than a coincidence.
 */
export function toFormFields(schema: ProviderConfigSchema): ProviderFormField[] {
  return Object.entries(schema.properties).map(([name, field]) => ({
    name,
    label: field.title,
    widget: widgetFor(field),
    required: schema.required.includes(name),
    help: field.description ?? null,
    placeholder: field[PLACEHOLDER_ANNOTATION] ?? null,
    defaultValue: field.default ?? null,
    choices: field.enum ?? null,
    minLength: field.minLength ?? null,
    maxLength: field.maxLength ?? null,
    pattern: field.pattern ?? null,
  }));
}

/**
 * The name of the field routed to the vault, if the schema has one.
 *
 * @param schema - The adapter's config schema.
 * @returns The property name, or null for a provider that needs no credential — which is the
 *   ordinary state of a local one rather than an unfinished schema.
 */
export function secretFieldName(schema: ProviderConfigSchema): string | null {
  const entry = Object.entries(schema.properties).find(
    ([, field]) => field[SECRET_ANNOTATION] === true,
  );

  return entry === undefined ? null : entry[0];
}

/**
 * Split a submitted form into the configuration to store and the credential to seal.
 *
 * @param schema - The adapter's config schema, which is what says where each value goes.
 * @param values - What the form submitted, keyed by field name. Values not declared by the
 *   schema are dropped rather than passed through: the schema says `additionalProperties:
 *   false`, so storing one would put a value in `provider_connections` that nothing validates
 *   and nothing renders.
 * @returns The two halves. The credential is never in the first one.
 */
export function partitionSubmission(
  schema: ProviderConfigSchema,
  values: Readonly<Record<string, string | undefined>>,
): ProviderSubmission {
  const secretField = secretFieldName(schema);
  const config: Record<string, string> = {};

  for (const name of Object.keys(schema.properties)) {
    const value = values[name];

    if (name === secretField || value === undefined) {
      continue;
    }

    config[name] = value;
  }

  const submitted = secretField === null ? undefined : values[secretField];

  return {
    config,
    // An empty string is treated as *not supplied*: it is what an untouched optional key row
    // submits, and sealing it would produce a connection that looks credentialled and is not.
    secret: submitted === undefined || submitted.length === 0 ? null : submitted,
  };
}
