/**
 * A submitted provider configuration, checked against the adapter's own `configSchema()`.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223))'s first scope line —
 * *config validated against the adapter's `configSchema()`* — as a total function over
 * `provider.config.ts`'s dialect.
 *
 * ---------------------------------------------------------------------------
 * **Why this is written out rather than handed to a JSON Schema library.**
 *
 * The conformance kit compiles every adapter's schema with **Ajv**, which is the right tool
 * for the job it does there: proving that what an adapter answers is real JSON Schema that a
 * generic validator — including whatever AE.5 renders with — accepts. Ajv is a
 * `devDependency`, though, and it is one deliberately: `package.json` keeps the running
 * service's dependency list to what a request actually needs, and adding a schema compiler
 * to it to check six string fields would be the largest dependency in this module by an
 * order of magnitude.
 *
 * What makes writing it out safe rather than a second implementation drifting from the first
 * is that the dialect is *closed*. `provider.config.ts` admits one flat object of string
 * fields and seven keywords — `minLength`, `maxLength`, `pattern`, `enum`, `format`,
 * `required`, `additionalProperties: false` — and `configSchemaViolations` is the gate that
 * makes any other keyword a schema the conformance kit rejects. So this file is not "our
 * subset of JSON Schema"; it is *all* of a dialect somebody else is already policing.
 *
 * ---------------------------------------------------------------------------
 * **The messages are what a form renders**, one per field, in the same
 * `{field: [sentences]}` shape `errors/validation.ts` produces for DTO failures — so AE.5
 * has one renderer for both, and a client cannot tell which layer refused it by the shape of
 * what came back. Which layer it *was* is in the code, where a client that cares can read it.
 *
 * **`format: "uri"` is checked through AC.3's own address policy**, `resolveProviderAddress`,
 * rather than through a `URL` parse of this file's own. Two reasons, and the second is the
 * one that matters. A bare `URL` parse accepts `ken-station.local:11434` — the parser reads
 * `ken-station.local:` as a scheme — so the commonest address mistake there is would sail
 * through a form check and be refused by the adapter, which is a worse place to learn about
 * it. And the policy is where the scheme allow-list and the no-userinfo rule live, so a form
 * that asked its own question would eventually give a different answer from the adapter about
 * the same string.
 *
 * That does **not** make this a security control, and the distinction is the same one
 * `provider.config.ts` draws: this runs on a submission and produces a message under an
 * input, while `provider.address.ts` runs inside the adapter, on every call, where a form
 * annotation cannot reach. What is shared is the *rule*, which is exactly the thing that
 * should not exist in two versions.
 */

import { resolveProviderAddress } from "../providers/provider.address";
import type { ProviderConfigSchema, ProviderFieldSchema } from "../providers/provider.config";

/** What a submitted configuration arrives as: the form's values, keyed by field name. */
export type SubmittedConfig = Readonly<Record<string, string>>;

/** Field name to the complaints about it, in the order they were found. */
export type ConfigViolations = Record<string, string[]>;

/**
 * Everything wrong with a submission, keyed by the field it is about.
 *
 * A map rather than a thrown error, for `configSchemaViolations`' reason: a person filling
 * in a form should be told about all four mistakes at once rather than one per attempt.
 *
 * @param schema - The schema to check against. For an *add* this is the adapter's own, so
 *   the credential row's `minLength` is exercised; for an *edit* it is
 *   `storedConfigSchema(...)`, because the credential is not resubmitted and demanding it
 *   would make every provider whose key is required un-editable.
 * @param values - What was submitted. Keys the schema does not declare are violations rather
 *   than being dropped, because the dialect says `additionalProperties: false` and a value
 *   silently discarded is a setting somebody believes they made.
 * @returns The complaints. Empty when the submission is acceptable.
 */
export function configViolations(
  schema: ProviderConfigSchema,
  values: SubmittedConfig,
): ConfigViolations {
  const violations: ConfigViolations = {};

  const complain = (field: string, message: string): void => {
    (violations[field] ??= []).push(message);
  };

  for (const name of Object.keys(values)) {
    if (!(name in schema.properties)) {
      complain(name, `${name} is not a setting this provider takes`);
    }
  }

  for (const [name, field] of Object.entries(schema.properties)) {
    const value = values[name];

    if (value === undefined || value.length === 0) {
      // Absent and empty are one case on purpose: an untouched input submits `""`, and a
      // schema that required the field means *fill this in* rather than *send the key*.
      // `partitionSubmission` reads an empty optional credential the same way.
      if (schema.required.includes(name)) {
        complain(name, `${field.title} is required`);
      }

      continue;
    }

    for (const message of fieldViolations(field, value)) {
      complain(name, message);
    }
  }

  return violations;
}

/**
 * Everything wrong with one field's value.
 *
 * Separated from {@link configViolations} so the keyword rules can be asserted one at a time
 * against a single field, which is how a table-driven spec reads.
 *
 * @param field - The field's schema.
 * @param value - What was submitted for it, known to be non-empty.
 * @returns The complaints, in the order the keywords are declared in `provider.config.ts`.
 */
export function fieldViolations(field: ProviderFieldSchema, value: string): string[] {
  const messages: string[] = [];

  if (field.enum !== undefined && !field.enum.includes(value)) {
    messages.push(`${field.title} must be one of ${field.enum.join(", ")}`);
  }

  if (field.minLength !== undefined && value.length < field.minLength) {
    messages.push(`${field.title} must be at least ${field.minLength} characters`);
  }

  if (field.maxLength !== undefined && value.length > field.maxLength) {
    messages.push(`${field.title} must be at most ${field.maxLength} characters`);
  }

  if (field.pattern !== undefined && !matchesPattern(field.pattern, value)) {
    messages.push(`${field.title} is not in the expected format`);
  }

  if (field.format === "uri") {
    const address = resolveProviderAddress(value);

    if (!address.ok) {
      messages.push(`${field.title} is not usable: ${address.violation}`);
    }
  }

  return messages;
}

/**
 * Whether a value matches a schema's `pattern`.
 *
 * The expression is compiled per call rather than cached. A schema's patterns are a handful
 * of short expressions per request, and a cache keyed by a string that arrives from an
 * adapter is a map that grows with the number of adapters and never shrinks — which is a
 * worse trade than the compile.
 *
 * **Unanchored, exactly as JSON Schema specifies.** `pattern` is a *search*, not a full
 * match, so an adapter that means "the whole value" writes `^…$` — and the two adapters that
 * declare a pattern both do. Anchoring here would refuse values a generic validator, and
 * therefore AE.5's own client-side check, accepts.
 *
 * @param pattern - The expression, in JSON Schema's (ECMA-262) syntax.
 * @param value - The submitted value.
 * @returns Whether it matches. `false` for an expression that will not compile, which is a
 *   broken adapter rather than a bad value — and refusing is the safe direction: a pattern
 *   nobody can evaluate must not read as *anything is fine*. `provider.config.ts`'s own gate
 *   is what catches it at the source; the conformance kit runs that gate on every adapter.
 */
function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
