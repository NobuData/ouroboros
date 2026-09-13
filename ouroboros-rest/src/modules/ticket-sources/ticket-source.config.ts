/**
 * The dialect a ticket-source provider's `configSchema()` is written in — the model-provider
 * form dialect, plus the one field type a tracker needs that a model provider never did.
 *
 * Q.4 ([#141](https://github.com/NobuData/ouroboros/issues/141)). The acceptance criterion is
 * that the settings surface's *"provider form renders from provider-declared config schema (no
 * hardcoded GitHub form)"*, and `ticket-source.provider.ts` said in advance where the schema
 * should come from: *"in the shape `providers/provider.config.ts` already settled on for model
 * providers, which is the dialect it should reuse"*. So a **string field here is exactly that
 * file's {@link ProviderFieldSchema}** — same keywords, same `x-ouroboros-secret` annotation
 * for the credential, same `x-ouroboros-placeholder` — and the gate, the widget derivation and
 * the submission rules for one are that module's own functions, called rather than copied.
 *
 * ---------------------------------------------------------------------------
 * **The one addition: a list of strings.**
 *
 * Every model-provider card is one flat object of string fields, and the dialect says so. A
 * ticket source is not: the `github` kind's `config` is `{ login, repos[] }` (Q.3,
 * `providers/github.config.ts`), a Jira source is a site and a list of project keys, and a
 * GitLab source is a list of projects. The repository list is the *enabled-repo scoping* the
 * epic asks for, and it is a list in the column because a form that collected it as one
 * comma-separated string would store a grammar the provider then had to re-parse.
 *
 * `provider.config.ts`'s own header says what to do when a field genuinely needs a second type:
 * *"the type is added, with a widget and a renderer case, once"*. It is added here rather than
 * there because no model adapter declares one and the model-provider submission path is typed
 * `Record<string, string>` end to end — widening that for a field nothing on that side uses
 * would ripple through every adapter's `validate` signature for no card. The day a model
 * provider needs a list, {@link TicketSourceListFieldSchema} is what moves down into
 * `provider.config.ts`; nothing in this file's shape stops that.
 *
 * A list field derives to the **`list`** widget: one item per line, which is what the settings
 * form draws and what `sourceConfigViolations` reads back. Its `minLength`, `maxLength` and
 * `pattern` describe **each item**, and `minItems`/`maxItems` bound the list — so the same
 * per-item rules the string dialect has apply to every entry, through the same function.
 *
 * ---------------------------------------------------------------------------
 * **What a submission looks like on the wire.**
 *
 * `Record<string, string | string[]>`, keyed by the schema's property names. The credential —
 * the field marked `x-ouroboros-secret` — travels *in* that object on a `POST /api/v1/sources`
 * exactly as it does on `POST /api/v1/providers`, and {@link partitionSourceSubmission} is what
 * splits it off for the vault before anything is stored. What lands in `ticket_sources.config`
 * is the rest, which is what the provider's own `validateConfig` and the loop's
 * `TicketSyncContext.config` read.
 */

import { fieldViolations } from "../provider-connections/config.validation";
import {
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  configSchemaViolations,
  type ProviderFieldSchema,
} from "../providers/provider.config";
import { widgetFor, type ProviderFormWidget } from "../providers/provider.forms";

/** What each entry of a list field must satisfy — the string dialect's own three keywords. */
export interface TicketSourceListItemSchema {
  /** Always `"string"`. */
  readonly type: "string";
  /** The shortest acceptable entry. `1` is how a schema says *not blank*. */
  readonly minLength?: number;
  /** The longest acceptable entry. */
  readonly maxLength?: number;
  /** A regular expression every entry must match, in JSON Schema's (ECMA-262) syntax. */
  readonly pattern?: string;
}

/**
 * A field whose value is a list of strings — the one type this dialect adds.
 *
 * Real JSON Schema: `type: "array"`, `items`, `minItems`, `maxItems` all mean what the
 * specification says. No `default`, no `enum`, and never the secret annotation: a list of
 * credentials is not a shape any tracker wants, and a default list would be a schema deciding
 * which repositories a workspace watches.
 */
export interface TicketSourceListFieldSchema {
  /** Always `"array"`. What tells the renderer and the validator apart from a string field. */
  readonly type: "array";
  /** The form's label. Required, for the reason `provider.config.ts` gives. */
  readonly title: string;
  /** The help line under the control, when the label is not enough on its own. */
  readonly description?: string;
  /** What each entry must satisfy. */
  readonly items: TicketSourceListItemSchema;
  /** The fewest entries the list may hold. `1` is how a schema says *at least one*. */
  readonly minItems?: number;
  /** The most entries the list may hold. */
  readonly maxItems?: number;
  /** The control's placeholder. Prose, not an example — see `provider.config.ts`. */
  readonly [PLACEHOLDER_ANNOTATION]?: string;
}

/** One field of a ticket-source configuration: the string dialect's field, or a list. */
export type TicketSourceFieldSchema = ProviderFieldSchema | TicketSourceListFieldSchema;

/**
 * What a provider's `configSchema()` answers.
 *
 * The same five keys as `ProviderConfigSchema`, with {@link properties} widened to admit a list
 * field. Field order is insertion order and is a contract, for the reason that file gives: it
 * is the order the settings form draws.
 */
export interface TicketSourceConfigSchema {
  /** Always {@link PROVIDER_CONFIG_DIALECT}. */
  readonly $schema: typeof PROVIDER_CONFIG_DIALECT;
  /** Always `"object"`. */
  readonly type: "object";
  /** What the add-form's heading says — *Connect a GitHub account*. */
  readonly title: string;
  /** The fields, in the order the form renders them. */
  readonly properties: Readonly<Record<string, TicketSourceFieldSchema>>;
  /** Which of them must be filled in. Every entry must name a declared property. */
  readonly required: readonly string[];
  /** Always `false`. */
  readonly additionalProperties: false;
}

/** How one field is drawn: the model-provider dialect's four widgets, and the list. */
export type TicketSourceFormWidget = ProviderFormWidget | "list";

/**
 * One field of the settings form, as the form renders it.
 *
 * `ProviderFormField`'s eleven members plus two, so `ouroboros-ui`'s one schema-driven form
 * primitive consumes both shapes. Every optional keyword is an explicit `null`, for that
 * contract's reason: absence is fine in a schema an author writes and unhelpful in a value a
 * renderer consumes. On a `list` field, `minLength`, `maxLength` and `pattern` describe each
 * entry and `minItems`/`maxItems` the list; on every other widget the last two are `null`.
 */
export interface TicketSourceFormField {
  /** The property name — what a submitted value is keyed by. Never shown to a person. */
  readonly name: string;
  /** What the `<label>` says. */
  readonly label: string;
  /** How to draw it. */
  readonly widget: TicketSourceFormWidget;
  /** Whether the schema requires a value. */
  readonly required: boolean;
  /** The help line under the control, or null. */
  readonly help: string | null;
  /** The control's placeholder, or null. */
  readonly placeholder: string | null;
  /** What the control starts at, or null. Never set on the secret field, and never on a list. */
  readonly defaultValue: string | null;
  /** The options for a `select`, or null for every other widget. */
  readonly choices: readonly string[] | null;
  /** The shortest acceptable value — or entry, on a list — or null. */
  readonly minLength: number | null;
  /** The longest acceptable value — or entry, on a list — or null. */
  readonly maxLength: number | null;
  /** The pattern a value — or every entry, on a list — must match, or null. */
  readonly pattern: string | null;
  /** The fewest entries a `list` may hold, or null on every other widget. */
  readonly minItems: number | null;
  /** The most entries a `list` may hold, or null on every other widget. */
  readonly maxItems: number | null;
}

/** One submitted or stored value: a string, or a list of them. */
export type TicketSourceConfigValue = string | readonly string[];

/** A configuration as the settings form submits it, keyed by field name. */
export type TicketSourceSubmission = Readonly<Record<string, TicketSourceConfigValue>>;

/** Everything wrong with a submission, keyed by the field it is about. */
export type TicketSourceConfigViolations = Record<string, string[]>;

/**
 * A submission split into what is stored and what is sealed.
 *
 * The same two halves `provider.forms.ts`'s `ProviderSubmission` has, for the same reason: the
 * secret must never enter the `config` column, and a type that carried both in one object
 * would let a caller store the wrong half by forgetting to remove it.
 */
export interface TicketSourceSubmissionParts {
  /** Everything that is stored as `ticket_sources.config`. Never contains the credential. */
  readonly config: Readonly<Record<string, TicketSourceConfigValue>>;
  /**
   * The credential, for the vault — or null when the schema declares none, or when it declares
   * one and the submission left it empty. Null rather than `""`, because a sealed empty string
   * is a source that looks credentialled and fails at first use.
   */
  readonly secret: string | null;
}

/**
 * Whether a field is the list kind.
 *
 * @param field - Any field of the dialect.
 * @returns `true` for a list, narrowing the type.
 */
export function isListField(field: TicketSourceFieldSchema): field is TicketSourceListFieldSchema {
  return field.type === "array";
}

/**
 * Everything wrong with a schema, in the order it was found.
 *
 * The gate `TicketSourceRegistry` runs on every provider at boot, so a provider whose schema the
 * settings form could not draw stops the process rather than a page. String fields are judged
 * by `provider.config.ts`'s own `configSchemaViolations` — the schema is handed over with its
 * list fields set aside, so every rule that module states holds here unchanged — and the list
 * fields by the rules below.
 *
 * @param schema - What a provider answered. `unknown`, because the interesting caller is a
 *   registry checking somebody else's provider.
 * @returns The violations. Empty means {@link toSourceFormFields} is total over the schema.
 */
export function sourceSchemaViolations(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return ["schema must be an object"];
  }

  const candidate = schema as {
    properties?: unknown;
    required?: unknown;
  };
  const properties =
    typeof candidate.properties === "object" &&
    candidate.properties !== null &&
    !Array.isArray(candidate.properties)
      ? (candidate.properties as Record<string, unknown>)
      : undefined;

  if (properties === undefined) {
    // The string gate reports the shape problems; nothing below can be judged without a
    // properties object.
    return configSchemaViolations(schema);
  }

  const listNames = Object.keys(properties).filter(
    (name) => (properties[name] as { type?: unknown } | null)?.type === "array",
  );
  const stringProperties = Object.fromEntries(
    Object.entries(properties).filter(([name]) => !listNames.includes(name)),
  );
  const required = Array.isArray(candidate.required) ? candidate.required : undefined;

  // The string dialect's gate, over the string fields only. Its `required` is narrowed to the
  // names it can see, so a required list field is not reported as undeclared; the check that
  // every required name is declared *somewhere* is made below over the whole property set.
  const violations = configSchemaViolations({
    ...candidate,
    properties: stringProperties,
    ...(required === undefined
      ? {}
      : {
          required: required.filter((name) => typeof name === "string" && name in stringProperties),
        }),
  }).filter(
    // A schema of nothing but lists is a legitimate schema; the string gate has no way to know
    // it was handed a subset, so its emptiness complaint is answered here instead.
    (violation) =>
      !(listNames.length > 0 && violation === "properties must declare at least one field"),
  );

  for (const name of listNames) {
    violations.push(...listFieldViolations(name, properties[name]));
  }

  if (required !== undefined) {
    for (const name of required) {
      if (typeof name !== "string" || !(name in properties)) {
        violations.push(`required names ${String(name)}, which is not a declared property`);
      }
    }
  }

  return violations;
}

/**
 * Everything wrong with one list field.
 *
 * @param name - The property name, used to prefix every sentence.
 * @param field - What the schema declared for it. Known to carry `type: "array"`.
 * @returns The violations for this field.
 */
function listFieldViolations(name: string, field: unknown): string[] {
  const violations: string[] = [];
  const prefix = `field "${name}":`;

  if (typeof field !== "object" || field === null) {
    return [`${prefix} must be an object`];
  }

  const candidate = field as Partial<TicketSourceListFieldSchema> & Record<string, unknown>;

  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    violations.push(`${prefix} title must be a non-empty string`);
  }

  const items = candidate.items;

  if (typeof items !== "object" || items === null || Array.isArray(items)) {
    violations.push(`${prefix} items must be an object`);
  } else {
    const entry = items as Partial<TicketSourceListItemSchema> & Record<string, unknown>;

    if (entry.type !== "string") {
      violations.push(`${prefix} items.type must be "string"`);
    }

    if (entry.pattern !== undefined && !compiles(entry.pattern)) {
      violations.push(`${prefix} items.pattern must be a regular expression`);
    }

    for (const bound of ["minLength", "maxLength"] as const) {
      if (entry[bound] !== undefined && !isCount(entry[bound])) {
        violations.push(`${prefix} items.${bound} must be a non-negative integer`);
      }
    }
  }

  for (const bound of ["minItems", "maxItems"] as const) {
    if (candidate[bound] !== undefined && !isCount(candidate[bound])) {
      violations.push(`${prefix} ${bound} must be a non-negative integer`);
    }
  }

  if (
    isCount(candidate.minItems) &&
    isCount(candidate.maxItems) &&
    candidate.minItems > candidate.maxItems
  ) {
    violations.push(`${prefix} minItems must not exceed maxItems`);
  }

  // A list is never the credential, never a choice, never an address, and never defaulted —
  // each of those is a keyword of the string dialect that means nothing on a list and would
  // reach the renderer as a case it has no drawing for.
  const foreign = [
    SECRET_ANNOTATION,
    "enum",
    "format",
    "default",
    "$ref",
    "oneOf",
    "anyOf",
    "allOf",
  ];
  const present = foreign.filter((keyword) => keyword in candidate);

  if (present.length > 0) {
    violations.push(`${prefix} a list field has no ${present.join(", ")}`);
  }

  return violations;
}

/**
 * The fields, in the order the form renders them.
 *
 * Total over any schema {@link sourceSchemaViolations} accepts — which is what the registry
 * guarantees before a provider can be reached — so there is no branch here that can fail to
 * produce a field.
 *
 * @param schema - A provider's schema.
 * @returns One field per property, in declaration order.
 */
export function toSourceFormFields(schema: TicketSourceConfigSchema): TicketSourceFormField[] {
  return Object.entries(schema.properties).map(([name, field]) => {
    const required = schema.required.includes(name);

    if (isListField(field)) {
      return {
        name,
        label: field.title,
        widget: "list",
        required,
        help: field.description ?? null,
        placeholder: field[PLACEHOLDER_ANNOTATION] ?? null,
        defaultValue: null,
        choices: null,
        minLength: field.items.minLength ?? null,
        maxLength: field.items.maxLength ?? null,
        pattern: field.items.pattern ?? null,
        minItems: field.minItems ?? null,
        maxItems: field.maxItems ?? null,
      };
    }

    return {
      name,
      label: field.title,
      widget: widgetFor(field),
      required,
      help: field.description ?? null,
      placeholder: field[PLACEHOLDER_ANNOTATION] ?? null,
      defaultValue: field.default ?? null,
      choices: field.enum ?? null,
      minLength: field.minLength ?? null,
      maxLength: field.maxLength ?? null,
      pattern: field.pattern ?? null,
      minItems: null,
      maxItems: null,
    };
  });
}

/**
 * The name of the field routed to the vault, if the schema declares one.
 *
 * @param schema - A provider's schema.
 * @returns The property name, or null when this provider takes no credential.
 */
export function sourceSecretField(schema: TicketSourceConfigSchema): string | null {
  const entry = Object.entries(schema.properties).find(
    ([, field]) => !isListField(field) && field[SECRET_ANNOTATION] === true,
  );

  return entry === undefined ? null : entry[0];
}

/**
 * The schema with its secret field removed — what a *stored* configuration is judged against.
 *
 * `provider.forms.ts`'s `storedConfigSchema`, for this dialect: an edit does not resubmit the
 * credential, and holding an edit to a `required` secret would make every source whose
 * provider requires one un-editable.
 *
 * @param schema - A provider's schema.
 * @returns The schema without the secret field, or the schema itself when it declares none.
 */
export function storedSourceSchema(schema: TicketSourceConfigSchema): TicketSourceConfigSchema {
  const secret = sourceSecretField(schema);

  if (secret === null) {
    return schema;
  }

  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).filter(([name]) => name !== secret),
    ),
    required: schema.required.filter((name) => name !== secret),
  };
}

/**
 * Everything wrong with a submission, keyed by the field it is about.
 *
 * `config.validation.ts`'s `configViolations`, widened by one case. A string field's value is
 * judged by that module's own `fieldViolations`; a list's entries are judged by the same
 * function, one entry at a time, against the field's `items` — so *"an entry is not in the
 * expected format"* and *"a value is not in the expected format"* are one sentence produced by
 * one rule.
 *
 * @param schema - The schema to check against: the provider's own for an add, its
 *   {@link storedSourceSchema} for an edit.
 * @param values - What was submitted. Keys the schema does not declare are violations rather
 *   than being dropped, because `additionalProperties: false` is what the dialect says and a
 *   value silently discarded is a setting somebody believes they made.
 * @returns The complaints. Empty when the submission is acceptable.
 */
export function sourceConfigViolations(
  schema: TicketSourceConfigSchema,
  values: Readonly<Record<string, unknown>>,
): TicketSourceConfigViolations {
  const violations: TicketSourceConfigViolations = {};

  const complain = (field: string, message: string): void => {
    (violations[field] ??= []).push(message);
  };

  for (const name of Object.keys(values)) {
    if (!(name in schema.properties)) {
      complain(name, `${name} is not a setting this source takes`);
    }
  }

  for (const [name, field] of Object.entries(schema.properties)) {
    const value = values[name];

    if (isEmpty(value)) {
      // Absent, `""` and `[]` are one case: an untouched control submits nothing, and a
      // schema that required the field means *fill this in*.
      if (schema.required.includes(name)) {
        complain(name, `${field.title} is required`);
      }

      continue;
    }

    if (isListField(field)) {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        complain(name, `${field.title} must be a list of entries`);
        continue;
      }

      const entries = value;

      if (field.minItems !== undefined && entries.length < field.minItems) {
        complain(
          name,
          `${field.title} needs at least ${String(field.minItems)} ${plural(field.minItems)}`,
        );
      }

      if (field.maxItems !== undefined && entries.length > field.maxItems) {
        complain(
          name,
          `${field.title} may hold at most ${String(field.maxItems)} ${plural(field.maxItems)}`,
        );
      }

      // Each entry through the string rules, and each *sentence* once: fifty repositories with
      // the same typo are one complaint a person can act on, not fifty lines.
      const seen = new Set<string>();

      for (const entry of entries) {
        for (const message of fieldViolations(entryRules(field), entry)) {
          if (!seen.has(message)) {
            seen.add(message);
            complain(name, message);
          }
        }
      }

      continue;
    }

    if (typeof value !== "string") {
      complain(name, `${field.title} must be text`);
      continue;
    }

    for (const message of fieldViolations(field, value)) {
      complain(name, message);
    }
  }

  return violations;
}

/**
 * Split a submission into what is stored and what is sealed.
 *
 * `provider.forms.ts`'s `partitionSubmission`, for this dialect. Undeclared keys are dropped
 * here because {@link sourceConfigViolations} has already refused them; a caller that partitions
 * without validating first is storing a submission it never checked.
 *
 * @param schema - The provider's own schema — with the secret field, so it can be found.
 * @param values - The submission.
 * @returns The two halves.
 */
export function partitionSourceSubmission(
  schema: TicketSourceConfigSchema,
  values: Readonly<Record<string, unknown>>,
): TicketSourceSubmissionParts {
  const secretField = sourceSecretField(schema);
  const config: Record<string, TicketSourceConfigValue> = {};

  for (const [name, field] of Object.entries(schema.properties)) {
    const value = values[name];

    if (name === secretField || isEmpty(value)) {
      continue;
    }

    if (isListField(field)) {
      if (Array.isArray(value)) {
        config[name] = value.filter((entry): entry is string => typeof entry === "string");
      }

      continue;
    }

    if (typeof value === "string") {
      config[name] = value;
    }
  }

  const submitted = secretField === null ? undefined : values[secretField];

  return {
    config,
    secret: typeof submitted === "string" && submitted.length > 0 ? submitted : null,
  };
}

/**
 * A list field's entry rules, in the shape the string dialect's validator takes.
 *
 * @param field - The list field.
 * @returns A string field carrying the list's title and its `items` keywords.
 */
function entryRules(field: TicketSourceListFieldSchema): ProviderFieldSchema {
  return {
    type: "string",
    title: field.title,
    ...(field.items.minLength === undefined ? {} : { minLength: field.items.minLength }),
    ...(field.items.maxLength === undefined ? {} : { maxLength: field.items.maxLength }),
    ...(field.items.pattern === undefined ? {} : { pattern: field.items.pattern }),
  };
}

/**
 * Whether a submitted value is *nothing*.
 *
 * @param value - What the field carried.
 * @returns `true` for an absent value, an empty string and an empty list.
 */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Whether a value is a non-negative integer — what every count keyword must be.
 *
 * @param value - The keyword's value.
 * @returns `true` for `0`, `1`, `50`; `false` for `-1`, `1.5`, `"3"`.
 */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Whether a pattern is one `RegExp` will take.
 *
 * @param pattern - The keyword's value.
 * @returns `true` when it is a string that compiles.
 */
function compiles(pattern: unknown): boolean {
  if (typeof pattern !== "string") {
    return false;
  }

  try {
    new RegExp(pattern);

    return true;
  } catch {
    return false;
  }
}

/**
 * The noun for a count of list entries.
 *
 * @param count - How many.
 * @returns `entry` or `entries`.
 */
function plural(count: number): string {
  return count === 1 ? "entry" : "entries";
}
