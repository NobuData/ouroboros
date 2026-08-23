/**
 * The dialect an adapter's `configSchema()` is written in — the thing that lets five very
 * different provider cards render from one component.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)). Look at mockup 07's five
 * cards and the differences are all in the same place: Anthropic has a masked key row and
 * nothing else, the vLLM card has a **Base URL** field *and* an optional key row, Ollama has
 * a **Host** field and no key at all, Copilot and Cursor are back to a key row. The ticket's
 * claim is that every one of those differences is a `configSchema()` rather than a branch in
 * the card component, and this file is what makes that claim checkable.
 *
 * ---------------------------------------------------------------------------
 * **Why a subset of JSON Schema rather than JSON Schema.**
 *
 * A renderer that has to handle `$ref`, `oneOf`, `allOf`, nested objects and tuple arrays is
 * a renderer full of special cases — it just moves them from *per provider* to *per schema
 * keyword*, which is worse, because the second list has no end. So the dialect is narrow
 * enough to render exhaustively: **one flat object of string-valued fields**, and nothing
 * else. {@link configSchemaViolations} is the gate, the conformance kit runs it against every
 * adapter, and `provider.forms.ts` is a total function over what survives.
 *
 * It is still real JSON Schema — `$schema`, `type`, `properties`, `required`,
 * `additionalProperties` all mean what they mean, and the conformance kit compiles each one
 * with Ajv and validates the adapter's own sample config through it. A schema that would not
 * pass a generic validator would be a schema AE.5
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) could not hand to one.
 *
 * **Every field is a string, today.** None of the five cards asks for a number or a boolean —
 * a monthly cap is a column on the connection, not a provider setting, and the enable switch
 * is a row's `status`. When one genuinely does, the type is added *here*, with a widget and a
 * renderer case, once. That is the shape of a growing dialect; `type: "number"` appearing in
 * one adapter and being handled by one card is the shape of the thing this replaces.
 *
 * ---------------------------------------------------------------------------
 * **Two annotations, and the reason each exists.**
 *
 * `x-ouroboros-secret` marks the one field whose value **never enters the config object**. It
 * is the key row: the value goes to the vault (AD.1, [#222](https://github.com/NobuData/ouroboros/issues/222))
 * and comes back as `provider_connections.credentials_encrypted`, and everything else in the
 * schema is ordinary settings. Declaring it in the schema rather than out of band is what
 * lets AE.5 render a masked row with **Reveal** and **Rotate** without knowing which provider
 * it is looking at — and lets the conformance kit assert that at most one field per adapter
 * is ever routed to the vault.
 *
 * `x-ouroboros-placeholder` is the input's placeholder, and it exists because mockup 07's is
 * prose — *"API key — optional, no auth configured"* — rather than an example value. Using
 * JSON Schema's `examples` for it would put a sentence where a validator expects a specimen.
 *
 * Both are `x-` prefixed, which is JSON Schema's own extension mechanism: a generic validator
 * ignores them, so the schema stays portable.
 *
 * ---------------------------------------------------------------------------
 * **{@link BASE_URL_FIELD} is the one reserved name, and it is the whole trick.**
 *
 * Ollama's card says **Host**, the vLLM card says **Base URL**, and they are the same field:
 * `baseUrl`, whose value lands in `provider_connections.base_url`. What differs is the
 * `title`, which is *data*. If the two adapters had each named the field after their own
 * vendor's word for it, the card would need to know which vendor it was rendering in order to
 * find the address — and that is precisely the `switch (kind)` decision **P1** refuses.
 */

/** The JSON Schema dialect every provider config schema declares. */
export const PROVIDER_CONFIG_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * The field name whose value is `provider_connections.base_url`.
 *
 * Reserved: an adapter that takes an address calls it this, whatever its vendor calls it. See
 * this file's header for why that is the load-bearing convention rather than a tidiness rule.
 */
export const BASE_URL_FIELD = "baseUrl";

/** The annotation marking the field that is routed to the vault. */
export const SECRET_ANNOTATION = "x-ouroboros-secret";

/** The annotation carrying an input's placeholder text. */
export const PLACEHOLDER_ANNOTATION = "x-ouroboros-placeholder";

/**
 * One field of a provider's configuration.
 *
 * The keywords are JSON Schema's and mean what JSON Schema says they mean. What is *not* here
 * is as deliberate as what is: no `type` other than `string`, no `$ref`, no composition
 * keywords, no nesting. See this file's header.
 */
export interface ProviderFieldSchema {
  /** Always `"string"` today — this file's header says when that changes and how. */
  readonly type: "string";
  /**
   * The form's label, and the card's — *Base URL*, *Host*, *API key*.
   *
   * Required rather than optional, because the fallback for a missing one is the field name
   * and `baseUrl` is not a label. A renderer that had to invent a label from a name is a
   * renderer with an opinion about naming conventions.
   */
  readonly title: string;
  /** The help line under the input, when the label is not enough on its own. */
  readonly description?: string;
  /**
   * `"uri"` for an address field.
   *
   * Drives the `url` widget — a `type="url"` input and the browser's own validation — and
   * nothing else. It is deliberately not a security control: whether an address may point at
   * RFC 1918 space is AC.3's SSRF policy, made server-side, where a form annotation cannot
   * reach it.
   */
  readonly format?: "uri";
  /** What the field starts as, when there is a sensible answer. */
  readonly default?: string;
  /** The permitted values, when the field is a choice. Drives the `select` widget. */
  readonly enum?: readonly string[];
  /** The shortest acceptable value. `1` is how a schema says *not blank*. */
  readonly minLength?: number;
  /** The longest acceptable value. */
  readonly maxLength?: number;
  /** A regular expression the value must match, in JSON Schema's (ECMA-262) syntax. */
  readonly pattern?: string;
  /**
   * Whether this field's value is routed to the vault rather than stored as configuration.
   *
   * At most one field per schema, and the conformance kit enforces it. See this file's header.
   */
  readonly [SECRET_ANNOTATION]?: true;
  /** The input's placeholder. Prose, not an example — see this file's header. */
  readonly [PLACEHOLDER_ANNOTATION]?: string;
}

/**
 * What an adapter's `configSchema()` answers — one flat object, renderable exhaustively.
 *
 * **Field order is the insertion order of {@link properties}**, and that is a contract rather
 * than an accident. ECMAScript fixes the iteration order of non-integer string keys, and
 * `JSON.parse` preserves it, so a schema that crosses the wire to AE.5 arrives in the order
 * its author wrote — which is the order mockup 07 draws the vLLM card in: address first, key
 * second. The conformance kit round-trips every schema through JSON and asserts the order
 * survives, because the day it does not is the day a form silently reorders itself.
 */
export interface ProviderConfigSchema {
  /** Always {@link PROVIDER_CONFIG_DIALECT}. Stated so a generic validator knows the rules. */
  readonly $schema: typeof PROVIDER_CONFIG_DIALECT;
  /** Always `"object"`. */
  readonly type: "object";
  /** What the add-form's heading says — *Connect Anthropic*, *Connect an Ollama host*. */
  readonly title: string;
  /** The fields, in the order the form renders them. */
  readonly properties: Readonly<Record<string, ProviderFieldSchema>>;
  /** Which of them must be filled in. Every entry must name a declared property. */
  readonly required: readonly string[];
  /**
   * Always `false`.
   *
   * A provider config with a field nobody declared is a field nobody validates and nothing
   * renders. Refusing it here means AE.5 can round-trip a form's output back through the
   * schema and be told about a typo, rather than storing it.
   */
  readonly additionalProperties: false;
}

/**
 * A connection's configuration, as it is stored and as it is handed back to an adapter.
 *
 * String-valued because {@link ProviderFieldSchema} is, and **without the secret**: the field
 * marked {@link SECRET_ANNOTATION} is routed to the vault, so a config object that carried one
 * would be a plaintext credential in a place designed to be readable. `validate` and
 * {@link ProviderConnectionContext} both take the secret as a separate parameter for exactly
 * that reason.
 */
export type ProviderConnectionConfig = Readonly<Record<string, string>>;

/**
 * Everything wrong with a schema, in the order it was found.
 *
 * A list of sentences rather than a thrown error or a boolean, so the conformance kit can
 * report *all* of a new adapter's problems in one run instead of one per fix — and so this
 * function is itself testable against a schema that is wrong in six ways at once.
 *
 * The checks are the dialect, restated as code. Every one of them is something
 * `provider.forms.ts` would otherwise have to defend against at render time, which is how a
 * renderer acquires special cases.
 *
 * @param schema - The schema an adapter answered. Typed as `unknown` because the interesting
 *   caller is a conformance kit checking somebody else's adapter, and an adapter written in
 *   JavaScript, or against an older version of this interface, will not have been stopped by
 *   the compiler.
 * @returns The violations. Empty means the schema is in the dialect and
 *   {@link import("./provider.forms").toFormFields} is total over it.
 */
export function configSchemaViolations(schema: unknown): string[] {
  const violations: string[] = [];

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return ["schema must be an object"];
  }

  const candidate = schema as Partial<ProviderConfigSchema>;

  if (candidate.$schema !== PROVIDER_CONFIG_DIALECT) {
    violations.push(`$schema must be "${PROVIDER_CONFIG_DIALECT}"`);
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

  const properties = candidate.properties;

  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    violations.push("properties must be an object");

    return violations;
  }

  const names = Object.keys(properties);

  if (names.length === 0) {
    // A provider that needs nothing configured still needs a schema — an empty one is how the
    // add-form knows to show a bare *Connect* button. What it must not be is *absent*, and it
    // must not be this: an object with no properties reaches AE.5 as a form with no fields and
    // no way to tell that apart from a schema that failed to load.
    violations.push("properties must declare at least one field");
  }

  for (const name of names) {
    violations.push(...fieldViolations(name, properties[name]));
  }

  // Read defensively rather than through the declared type. This function's whole audience is
  // schemas that are *wrong*, and `properties: { host: null }` is a shape the compiler never
  // stopped anybody writing — a crash here would take the conformance kit down instead of
  // reporting the six things wrong with somebody's first adapter.
  const secrets = names.filter((name) => secretFlagOf(properties[name]) === true);

  if (secrets.length > 1) {
    violations.push(
      `at most one field may be marked ${SECRET_ANNOTATION}; found ${secrets.join(", ")}`,
    );
  }

  const required = candidate.required;

  if (!Array.isArray(required)) {
    violations.push("required must be an array");

    return violations;
  }

  for (const name of required) {
    if (typeof name !== "string" || !names.includes(name)) {
      violations.push(`required names ${String(name)}, which is not a declared property`);
    }
  }

  return violations;
}

/**
 * The `x-ouroboros-secret` annotation on a value that may not be an object at all.
 *
 * @param field - Whatever the schema declared for a property.
 * @returns The annotation's value, or `undefined` when there is nowhere for one to be.
 */
function secretFlagOf(field: unknown): unknown {
  return typeof field === "object" && field !== null
    ? (field as Record<string, unknown>)[SECRET_ANNOTATION]
    : undefined;
}

/**
 * Everything wrong with one field.
 *
 * Split out so {@link configSchemaViolations} reads as the list of *schema* rules, and so a
 * violation always names the field it is about — a report saying "format must be uri" with no
 * field name is a report somebody has to go looking with.
 *
 * @param name - The property name, used to prefix every sentence.
 * @param field - What the schema declared for it.
 * @returns The violations for this field.
 */
function fieldViolations(name: string, field: unknown): string[] {
  const violations: string[] = [];
  const prefix = `field "${name}":`;

  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return [`${prefix} must be an object`];
  }

  const candidate = field as Partial<ProviderFieldSchema>;

  if (candidate.type !== "string") {
    violations.push(`${prefix} type must be "string"`);
  }

  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    violations.push(`${prefix} title must be a non-empty string`);
  }

  if (candidate.format !== undefined && candidate.format !== "uri") {
    violations.push(`${prefix} format, when present, must be "uri"`);
  }

  if (
    candidate.enum !== undefined &&
    (!Array.isArray(candidate.enum) || candidate.enum.length === 0)
  ) {
    violations.push(`${prefix} enum, when present, must be a non-empty array`);
  }

  const secret = candidate[SECRET_ANNOTATION];

  if (secret !== undefined && secret !== true) {
    violations.push(`${prefix} ${SECRET_ANNOTATION}, when present, must be true`);
  }

  // A default is what the form starts the input at, and a default on the field routed to the
  // vault would be a credential written into a schema that every client of the add-form can
  // read. There is no version of this that is a good idea.
  if (secret === true && candidate.default !== undefined) {
    violations.push(`${prefix} a ${SECRET_ANNOTATION} field must not declare a default`);
  }

  const composition = ["$ref", "oneOf", "anyOf", "allOf", "not", "if", "properties", "items"];
  const present = composition.filter((keyword) => keyword in candidate);

  if (present.length > 0) {
    violations.push(`${prefix} the dialect has no ${present.join(", ")} — see provider.config.ts`);
  }

  return violations;
}
