/**
 * Where a provider setting lives — the seam between an adapter's vocabulary and V015's
 * columns.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)). One file, because the
 * mapping is needed in both directions and by three callers, and a mapping written twice is
 * a mapping that will disagree with itself: **add** and **edit** turn a submitted form into
 * columns, **reveal**, **rotate** and **edit** turn a stored row back into the config an
 * adapter's `validate` and `discoverModels` take.
 *
 * ---------------------------------------------------------------------------
 * **Two field names have columns, and `provider.config.ts` is what makes that a rule.**
 *
 * That file reserves `baseUrl` for `provider_connections.base_url` and `capabilityNote` for
 * `provider_connections.capability_note`, and argues the case: Ollama's card says **Host**
 * and the vLLM card says **Base URL**, and the only reason one component can render both is
 * that the *field name* is the same and only the `title` differs. Reading those two names
 * here rather than matching on a provider kind is the same decision seen from the storage
 * side — this file contains no `switch (kind)` and there is nothing it could usefully switch
 * on.
 *
 * ---------------------------------------------------------------------------
 * **Everything else has nowhere to go, and this is where that is noticed.**
 *
 * `provider_connections` has no general settings column. One adapter declares a field that is
 * neither reserved name — AC.5's Copilot schema offers an optional billing `organization` —
 * and {@link unstorableFields} is what turns that into the designed `501` in
 * `provider-connections.errors.ts` rather than into a value that is accepted and then lost.
 * See `configNotStorable` there for the three answers that were available and why this is
 * the one that does not lie to somebody.
 *
 * The check is on the **submitted values**, never on the schema: a schema that *declares* an
 * unstorable field is fine as long as nobody fills it in, which is why Copilot connects
 * perfectly well today.
 */

import type { ProviderConnection } from "../db/schema";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "../providers/provider.config";
import { secretFieldName } from "../providers/provider.forms";
import type { SubmittedConfig } from "./config.validation";

/**
 * The config field names this schema has a column for, in the order V015 and V017 added
 * them.
 *
 * Derived from `provider.config.ts`'s two reserved constants rather than spelled again, so
 * renaming a reserved field is a compile error here instead of a setting that silently stops
 * being stored.
 */
export const STORABLE_FIELDS: readonly string[] = [BASE_URL_FIELD, CAPABILITY_NOTE_FIELD];

/** The columns a submitted configuration writes. */
export interface ConfigColumns {
  /** `provider_connections.base_url`, or null when the schema declares no address. */
  readonly base_url: string | null;
  /** `provider_connections.capability_note`, or null when nothing was said. */
  readonly capability_note: string | null;
}

/**
 * The submitted fields this build cannot keep.
 *
 * @param schema - The adapter's config schema, which is what says which field is the
 *   credential — that one goes to the vault and is therefore never unstorable.
 * @param values - What was submitted, after {@link import("./config.validation").configViolations}
 *   has accepted it.
 * @returns The field names with nowhere to go, sorted so a message built from them is stable
 *   between calls. Empty for every submission that fills in only reserved fields, which is
 *   every submission four of the five adapters can produce.
 */
export function unstorableFields(schema: ProviderConfigSchema, values: SubmittedConfig): string[] {
  const secret = secretFieldName(schema);

  return Object.entries(values)
    .filter(([name, value]) => {
      if (value.length === 0 || name === secret || STORABLE_FIELDS.includes(name)) {
        return false;
      }

      // A key the schema does not declare has already been refused as a violation; treating
      // it as unstorable too would answer 501 for what is really a typo.
      return name in schema.properties;
    })
    .map(([name]) => name)
    .sort();
}

/**
 * The columns a submitted configuration writes.
 *
 * @param values - The submitted configuration, without the credential — as
 *   `partitionSubmission` produced it.
 * @returns The two columns. A field that was not submitted, or was submitted empty, is
 *   `null` rather than `""`: V017's `provider_connections_capability_note_present` refuses a
 *   blank note, and an empty address would satisfy V015's *has a base_url* check while being
 *   an address nothing can reach.
 */
export function columnsFor(values: SubmittedConfig): ConfigColumns {
  return {
    base_url: nullIfBlank(values[BASE_URL_FIELD]),
    capability_note: nullIfBlank(values[CAPABILITY_NOTE_FIELD]),
  };
}

/**
 * A stored connection's configuration, in the adapter's own vocabulary.
 *
 * What `ModelProviderAdapter.validate` and `ProviderConnectionContext.config` are handed —
 * see `provider.adapter.ts` on why one takes loose parts and the other a connection.
 *
 * **Only fields the schema declares are included.** An Anthropic connection with a
 * `capability_note` — which is every one of them on mockup 07 — yields an empty config,
 * because AC.2's schema declares no such field and handing an adapter a setting it never
 * asked for is how a config object acquires keys nobody validates.
 *
 * @param schema - The adapter's config schema.
 * @param row - The stored connection.
 * @returns The configuration. Frozen, because it is handed to an adapter and
 *   `provider.adapter.ts` is explicit that an adapter must not be able to reach back into
 *   its caller's state.
 */
export function configOf(
  schema: ProviderConfigSchema,
  row: Pick<ProviderConnection, "base_url" | "capability_note">,
): ProviderConnectionConfig {
  const config: Record<string, string> = {};

  if (BASE_URL_FIELD in schema.properties && row.base_url !== null) {
    config[BASE_URL_FIELD] = row.base_url;
  }

  if (CAPABILITY_NOTE_FIELD in schema.properties && row.capability_note !== null) {
    config[CAPABILITY_NOTE_FIELD] = row.capability_note;
  }

  return Object.freeze(config);
}

/**
 * A stored connection's configuration, as a submission an edit can be merged onto.
 *
 * The same values {@link configOf} answers, as a mutable plain object rather than a frozen
 * adapter input — because `PATCH` merges what was sent over what is stored and then
 * validates the result, which is the only way a partial edit can be checked against rules
 * that span fields.
 *
 * @param schema - The adapter's config schema.
 * @param row - The stored connection.
 * @returns The stored settings, keyed by field name.
 */
export function submissionOf(
  schema: ProviderConfigSchema,
  row: Pick<ProviderConnection, "base_url" | "capability_note">,
): Record<string, string> {
  return { ...configOf(schema, row) };
}

/**
 * A value, or null when it is absent or blank.
 *
 * @param value - The submitted value.
 * @returns The value, or null.
 */
function nullIfBlank(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}
