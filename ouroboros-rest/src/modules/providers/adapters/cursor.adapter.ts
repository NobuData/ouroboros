/**
 * The Cursor adapter — key auth, a fixed catalog, and nothing else.
 *
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)), on AC.1's interface
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)) and AD.1's vault
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)). It is mockup 07's `CU` card —
 * *Cursor*, *api.cursor.com · used for second-opinion reviews* — as code:
 *
 * ```
 * configSchema   ─▶ { apiKey, capabilityNote? }        a masked key row, and the card's line
 * validate       ─▶ GET /v0/me ─▶ 200 ────────────────▶ the card foot's  ✓ 200 · 51ms
 *                              ├▶ 401 ────────────────▶ auth       ·  key rejected (401)
 *                              ├▶ 429 ────────────────▶ rate_limit ·  rate limited (429)
 *                              ├▶ 503 ────────────────▶ upstream   ·  degraded upstream
 *                              └▶ ECONNRESET ─────────▶ network    ·  unreachable
 * discoverModels ─▶ a fixed catalog, no request at all ▶ cursor/composer-2
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The plainest adapter in the module, and that is the point of it being here.**
 *
 * It is the shape AC.1's SPI was drawn around: one credential, one status check, one answer.
 * Everything the other four have that this does not — an address policy, a pull stream, an
 * entitlement lookup, a bounded retry — is a *provider's* complexity rather than the
 * framework's, and a fifth adapter that needed none of it is the evidence for that claim.
 *
 * ---------------------------------------------------------------------------
 * **A fixed catalog, for `copilot.adapter.ts`'s reason.** Cursor publishes no models-list
 * endpoint worth discovering against, so {@link CURSOR_CATALOG} is declared here with a source
 * for every field, and it is upserted into `provider_models` exactly as a discovered model
 * is — the table cannot tell the difference, which is what keeps the card, mockup 21's
 * registry and Y.1's alias validation reading one table. `capabilities().discovery` is `false`
 * because *refreshing* means nothing over a constant, not because the member is missing.
 *
 * ---------------------------------------------------------------------------
 * **The key is sent as HTTP Basic, which is Cursor's own convention.** Its Admin API is
 * documented as `curl -u API_KEY: https://api.cursor.com/…` — the key as the username, an
 * empty password — rather than as a bearer token. {@link authorization} is the one line that
 * encodes it, so a vendor that moves to `Authorization: Bearer` is a one-line change with a
 * test beside it rather than a hunt.
 *
 * **No entitlements.** `/v0/me` answers what the key is called and who owns it; nothing in it
 * is a seat, an allowance or a tier. `capabilities().entitlements` is therefore `false` and
 * every model reports `tier: null` — decision **P8**, which is worth more here than anywhere:
 * the Copilot card beside this one shows a real entitlement, and a plausible-looking invented
 * one here would make that one unreadable too.
 *
 * ---------------------------------------------------------------------------
 * **Where the credential is, and where it is not.** It arrives as a parameter, opened by the
 * caller for the length of one call. This class stores none and **logs nothing at all** —
 * there is no logger in the file, which is the only version of *never logged* that stays true
 * after somebody adds a debug line in a hurry. No response body reaches a `detail`: the
 * refusal's is cancelled unread, and the success's is never read either, because the question
 * was the status.
 */

import { Injectable } from "@nestjs/common";

import type {
  ModelProviderAdapter,
  NormalizedModel,
  ProviderCapabilities,
  ProviderConnectionContext,
  ProviderValidation,
} from "../provider.adapter";
import { discardBody } from "../provider.address";
import {
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "../provider.config";
import { MODEL_PARAM_DIALECT, copyParamSchema, type ModelParamSchema } from "../provider.params";
import {
  ProviderAdapterError,
  classifyHttpStatus,
  describeHttpRefusal,
  describeTransportFailure,
} from "../provider.errors";

/**
 * The property the API key is submitted under.
 *
 * The same name Anthropic's schema uses, and that is fine: there is no reserved name for a
 * credential the way `BASE_URL_FIELD` reserves one for an address, because the
 * `x-ouroboros-secret` annotation is what identifies it. `provider.forms.ts` finds this field
 * without knowing the word `apiKey`.
 */
export const CURSOR_API_KEY_FIELD = "apiKey";

/** What the key row's `<label>` says — mockup 07's **API key**. */
export const CURSOR_API_KEY_TITLE = "API key";

/**
 * Where Cursor's API is — the host mockup 07's capability line names.
 *
 * Fixed, and there is no field by which a caller could change it: this adapter talks to one
 * host, so it owns no address policy. That is `provider.address.ts`, for the two adapters that
 * take an address from a person.
 */
export const CURSOR_API_BASE_URL = "https://api.cursor.com";

/**
 * The route that answers *is this key any good*.
 *
 * Cursor's Admin API `me` endpoint — the cheapest authenticated `GET` it publishes, and one
 * that reads nothing and changes nothing.
 */
export const CURSOR_ME_PATH = "/v0/me";

/**
 * How long a call waits before it is a timeout.
 *
 * Ten seconds, the same as every other adapter's and for the same reason: this call is
 * user-initiated — somebody pressed **Test connection** and is watching a spinner — so the
 * health sweep's five (`provider-health/cadence.ts`) would be this service's impatience
 * rendered as a provider's fault.
 */
export const CURSOR_TIMEOUT_MS = 10_000;

/** The model id mockup 07's `CU` card draws a chip for, as Cursor spells it. */
export const CURSOR_MODEL_ID = "composer-2";

/** What that chip prints — mockup 07's `cursor/composer-2`, verbatim. */
export const CURSOR_MODEL_DISPLAY = "cursor/composer-2";

/** The context window Cursor publishes for that model, in tokens. */
export const CURSOR_MODEL_CONTEXT_TOKENS = 200_000;

/**
 * The models this connection can reach — declared, because there is nothing to discover.
 *
 * Every field has a source. The id is Cursor's own spelling, which is what
 * `model_aliases.model` and `model_prices.match_model` are written against; the display is
 * mockup 07's chip; the context length is what Cursor publishes for the model. `sizeBytes` is
 * null because a hosted model has no on-disk size, and `tier` is null because Cursor publishes
 * no entitlement signal at all.
 *
 * These are the same values `R__dev_seed_providers.sql` writes for the seeded Cursor
 * connection — `model_id`, `display`, `meta.context_tokens` — so a seeded stack and a real
 * connection produce one catalog rather than two that look alike.
 */
export const CURSOR_CATALOG: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: CURSOR_MODEL_ID,
    display: CURSOR_MODEL_DISPLAY,
    contextLength: CURSOR_MODEL_CONTEXT_TOKENS,
    sizeBytes: null,
    tier: null,
  }),
]);

/**
 * The add-form for mockup 07's Cursor card: a masked key row, and the card's second line.
 *
 * A module constant rather than a literal inside `configSchema()` so it can be asserted
 * against `card.shapes.fixture.ts` directly. {@link CursorAdapter.configSchema} still hands out
 * a **copy** — the caller is AE.5, holding the value while somebody fills in a form, and an
 * adapter handing out its own object would have that form's edits land here.
 */
const CURSOR_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect Cursor",
  properties: {
    [CURSOR_API_KEY_FIELD]: {
      type: "string",
      title: CURSOR_API_KEY_TITLE,
      minLength: 1,
      [SECRET_ANNOTATION]: true,
      [PLACEHOLDER_ANNOTATION]: "key_…",
    },
    [CAPABILITY_NOTE_FIELD]: {
      type: "string",
      title: "Capability note",
      description: "The card's second line — what this connection is for, in your own words.",
      maxLength: CAPABILITY_NOTE_MAX_LENGTH,
      [PLACEHOLDER_ANNOTATION]: "api.cursor.com · used for second-opinion reviews",
    },
  },
  required: [CURSOR_API_KEY_FIELD],
  additionalProperties: false,
};

/**
 * Where the key check lives.
 *
 * @returns The absolute URL. Built from {@link CURSOR_API_BASE_URL} rather than from anything a
 *   caller supplied — this adapter has no address field, so there is no path by which a request
 *   could be sent somewhere else.
 */
export function meUrl(): string {
  return `${CURSOR_API_BASE_URL}${CURSOR_ME_PATH}`;
}

/**
 * The `Authorization` header for one key.
 *
 * HTTP Basic with the key as the username and an empty password, which is what Cursor's Admin
 * API documents — `curl -u API_KEY:`. The one line in this file that knows the scheme.
 *
 * @param apiKey - The opened credential.
 * @returns The header value. `Buffer` rather than `btoa`, because the key is bytes and `btoa`
 *   throws on anything outside Latin-1 — which is a way for a pasted key with a stray
 *   character to become an exception rather than a `401`.
 */
export function authorization(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

/**
 * How the request is configured.
 *
 * A function rather than a template with the key spliced into it, which is the habit
 * `provider-health/checks.ts` sets: the plaintext exists as an argument for the length of one
 * call rather than as a string something might later log or retain.
 *
 * @param apiKey - The opened credential.
 * @returns The init.
 */
function requestInit(apiKey: string): RequestInit {
  return {
    // Stated rather than defaulted. The default *is* GET, and writing it here is what puts
    // "this adapter cannot send a completion" on the one line that could ever break it.
    method: "GET",
    headers: { accept: "application/json", authorization: authorization(apiKey) },
    signal: AbortSignal.timeout(CURSOR_TIMEOUT_MS),
  };
}

/**
 * The fields the schema requires that nothing has supplied.
 *
 * Derived from the schema rather than written out, which is the habit
 * `docs/MODEL_PROVIDERS.md` asks an author to copy — **check the configuration before opening
 * a socket**, because a connection with no key is not a provider being down and reporting it
 * as `network` sends somebody to check a firewall.
 *
 * @param config - The settings, without the credential.
 * @param secret - The credential, or null.
 * @returns The **titles** of the missing fields, because the sentence is printed on a card foot
 *   — `apiKey required` is a field name leaking into a page.
 */
export function missingConfiguration(
  config: ProviderConnectionConfig,
  secret: string | null,
): string[] {
  return CURSOR_CONFIG_SCHEMA.required
    .filter((name) =>
      CURSOR_CONFIG_SCHEMA.properties[name][SECRET_ANNOTATION] === true
        ? (secret ?? "").length === 0
        : (config[name] ?? "").length === 0,
    )
    .map((name) => CURSOR_CONFIG_SCHEMA.properties[name].title);
}

/**
 * What a Cursor model can be tuned with: nothing, stated rather than faked.
 *
 * The same shape and the same argument as the Copilot adapter's — a fixed catalog of one model,
 * reached on usage-metered terms rather than through a parameterised API. See
 * `copilot.adapter.ts`'s constant for the full reasoning; mockup 21's `second-opinion` row
 * draws one chip, and it is `review vote only`, which is a registry restriction rather than a
 * param.
 */
const CURSOR_PARAM_SCHEMA: ModelParamSchema = {
  $schema: MODEL_PARAM_DIALECT,
  type: "object",
  title: "Cursor model parameters",
  description:
    "Cursor is a fixed catalog metered on its own terms, and publishes no per-call parameters " +
    "this product can set. Restrictions still apply to the alias.",
  properties: {},
  additionalProperties: false,
};

/**
 * The Cursor adapter.
 *
 * `@Injectable()` because `providers.module.ts` registers the class and Nest constructs it. It
 * takes no dependencies and holds no state — one instance serves every workspace, which is only
 * safe because nothing about a connection is remembered between calls.
 */
@Injectable()
export class CursorAdapter implements ModelProviderAdapter {
  /** V015's `provider_connections.kind` for this provider, and the registry's key. */
  readonly kind = "cursor" as const;

  /**
   * The add-form: a masked key row, and the card's second line.
   *
   * @returns A fresh deep copy every call, so a caller holding it while somebody fills in a
   *   form cannot mutate the adapter's own value. The conformance kit tries exactly that.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(CURSOR_CONFIG_SCHEMA)) as ProviderConfigSchema;
  }

  /**
   * What this adapter can do.
   *
   * All four answered, and three of them `false`: the catalog is declared so `discovery` means
   * nothing, nothing pulls a hosted model onto a machine, and `/v0/me` says nothing about an
   * entitlement. `invocation` is AF.2's
   * ([#235](https://github.com/NobuData/ouroboros/issues/235)) reservation.
   *
   * @returns All four flags, freshly built and equal on every call.
   */
  capabilities(): ProviderCapabilities {
    return { discovery: false, pull: false, entitlements: false, invocation: false };
  }

  /**
   * What a Cursor model can be tuned with — nothing, and the schema explains why.
   *
   * @param _modelId - Unread, and named with an underscore to say so: this adapter's catalog is
   *   one model and it has no tunable.
   * @returns A fresh empty schema every call, carrying the sentence the inspector renders in
   *   place of fields. See {@link CURSOR_PARAM_SCHEMA}.
   */
  paramSchema(_modelId: string): ModelParamSchema {
    return copyParamSchema(CURSOR_PARAM_SCHEMA);
  }

  /**
   * The **Test connection** button: is this key any good, and how fast did we find out.
   *
   * @param config - The settings, as `partitionSubmission` produced them.
   * @param secret - The opened credential, or null when the add-form's key row was left blank.
   * @returns What the check found — `{status: "ok", latencyMs, detail: "200"}` for a success,
   *   which the card foot renders as `✓ 200 · 51ms`. **Never rejects**: a refusal, a timeout
   *   and a closed socket are all results, because a provider being down is the state the card
   *   exists to draw.
   */
  async validate(
    config: ProviderConnectionConfig,
    secret: string | null,
  ): Promise<ProviderValidation> {
    const missing = missingConfiguration(config, secret);

    // The `secret === null` half is what narrows the type for the call below; `missing` is what
    // says *which* fields, and for this schema the two are the same fact.
    if (secret === null || missing.length > 0) {
      return { status: "failed", errorClass: "config", detail: `${missing.join(", ")} required` };
    }

    const started = performance.now();
    let response: Response;

    try {
      response = await fetch(meUrl(), requestInit(secret));
    } catch (error) {
      // Nothing answered. Says nothing about the credential, and deliberately does not.
      return {
        status: "failed",
        errorClass: "network",
        detail: describeTransportFailure(error, CURSOR_TIMEOUT_MS),
      };
    }

    // Measured before the body is dealt with, because the round trip is what the card prints
    // and the tidying up afterwards is this service's own time.
    const latencyMs = Math.max(0, Math.round(performance.now() - started));

    // Nothing here reads a body: the question is whether the key was honoured. Cancelling
    // returns the socket to the pool, and it is what keeps a refusal's body — which may quote
    // the header it rejected — out of every sentence this method can produce.
    await discardBody(response);

    if (!response.ok) {
      return {
        status: "failed",
        errorClass: classifyHttpStatus(response.status),
        detail: describeHttpRefusal(response.status),
      };
    }

    return { status: "ok", latencyMs, detail: response.status.toString() };
  }

  /**
   * The **Models available** chips: the fixed catalog, and no request at all.
   *
   * See this file's header on why a declared catalog is a real answer. What this member owes
   * `provider_models` is what a discovering adapter owes it — ids that are the provider's own
   * spellings, unique within an answer, and identical across repeated runs — which is exactly
   * what makes `(provider_connection_id, model_id)` an upsert rather than a doubled row of
   * chips.
   *
   * @param connection - The saved connection, opened by its caller.
   * @returns The catalog, as fresh objects — a caller that sorted the answer in place must not
   *   be sorting this module's own constant.
   * @throws {ProviderAdapterError} `config` when the connection has no credential. A connection
   *   nobody has finished configuring reaches no models, and answering a catalog for one would
   *   put chips on a card that cannot be used. There is no `async` here because there is
   *   nothing to await; the failure is a rejection rather than a synchronous throw, which is
   *   what `@throws` means on a member that answers a promise.
   */
  discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    const missing = missingConfiguration(connection.config, connection.secret);

    if (connection.secret === null || missing.length > 0) {
      return Promise.reject(new ProviderAdapterError("config", `${missing.join(", ")} required`));
    }

    return Promise.resolve(CURSOR_CATALOG.map((model) => ({ ...model })));
  }
}
