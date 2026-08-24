/**
 * The OpenAI-compatible adapter — the one that makes *"or any OpenAI-compatible endpoint"*
 * true.
 *
 * AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)), on AC.1's interface
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)) and AD.1's vault
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)). It is mockup 07's `VL` card —
 * *OpenAI-compatible · local vLLM*, *self-hosted · A100 ×2* — as code:
 *
 * ```
 * configSchema   ─▶ { baseUrl, apiKey?, capabilityNote? }   address first, key optional
 * validate       ─▶ GET {base}/v1/models ─▶ 200 ──────────▶ the card foot's  ✓ 200 · 12ms
 *                                        └▶ 401 ──────────▶ auth       ·  key rejected
 *                                        └▶ 3xx ──────────▶ config     ·  redirect not followed
 *                                        └▶ 503 ──────────▶ upstream   ·  degraded upstream
 *                                        └▶ ECONNREFUSED ─▶ network    ·  10.0.4.20:8000 unreachable
 * discoverModels ─▶ the same call ───────────────────────▶ local/llama-4-maverick · local/deepseek-v3.2
 * ```
 *
 * ---------------------------------------------------------------------------
 * **One adapter, an unbounded set of endpoints — which is the security problem.**
 *
 * This adapter covers the entire self-hosted lane: vLLM, LM Studio, llama.cpp's server, TGI,
 * and anything else speaking the OpenAI wire format. Every *other* adapter talks to a fixed,
 * well-known host. This one accepts an address a person typed and then fetches it from inside
 * the control plane, which is the textbook shape of an SSRF vulnerability — and the reflexive
 * mitigation, blocking private address ranges, is exactly wrong here, because the legitimate
 * use case *is* `http://10.0.4.20:8000/v1`.
 *
 * So the policy is stated rather than inherited, it lives in `provider.address.ts` where AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) shares it, and it is
 * `docs/SECURITY_MODEL.md` §6.1 for a reader auditing rather than editing. Every request this
 * file makes goes through it: {@link listingEndpoint} is the only place a URL is built, it
 * refuses anything but `http`/`https`, and {@link requestInit} sets `redirect: manual` so a
 * `3xx` arrives as a refusal to classify rather than as a hop somebody's endpoint got for
 * free. Discovery reads a capped body; validation reads none at all.
 *
 * ---------------------------------------------------------------------------
 * **The key is genuinely optional, and that is a shape most adapters do not have.**
 *
 * Mockup 07 draws the key row with the placeholder *"API key — optional, no auth configured"*,
 * because the deployments this kind exists for are the operator's own GPU on the operator's own
 * network. So `apiKey` is declared but not `required`, `partitionSubmission` already answers
 * `null` for an untouched row, and {@link requestHeaders} sends **no `Authorization` header at
 * all** in that case rather than an empty bearer — a server that sees `Authorization: Bearer `
 * answers `401`, which would render *key rejected* on a card whose whole point is that it needs
 * no key.
 *
 * ---------------------------------------------------------------------------
 * **Why the chips read `local/…` while the ids do not.**
 *
 * The mockup's chips are `local/llama-4-maverick` and `local/deepseek-v3.2`; the ids vLLM
 * serves them under are `llama-4-maverick` and `deepseek-v3.2`. The prefix is a **display**
 * decision and it stays on that side of {@link NormalizedModel}: `id` is the provider's own
 * spelling, unchanged, because `model_aliases.model` and `model_prices.match_model` are written
 * against it and an adapter that prefixed the id would break the join that makes a chip's price
 * real. What the prefix buys is a reader looking at a registry of a hundred models being able
 * to tell which of them are somebody's own hardware — see `pricing.dto.ts`, where
 * `('openai_compatible', '*') → free` is how a deployment says exactly that.
 *
 * ---------------------------------------------------------------------------
 * **No tier, and that is decision P8 rather than an omission.** The OpenAI wire format carries
 * no entitlement signal — no header, no field — so {@link NormalizedModel.tier} is `null` on
 * every model this adapter reports, which renders as no pill. Anthropic's adapter reports one
 * because Anthropic really sends it. Inventing something plausible here would make *its* pill
 * unreadable too, because a person cannot tell an earned pill from an assumed one.
 *
 * ---------------------------------------------------------------------------
 * **Where the credential is, and where it is not.** It arrives as a parameter, opened by the
 * caller for the length of one call. This class stores none and **logs nothing at all** —
 * there is no logger in the file, which is the only version of *never logged* that stays true
 * after somebody adds a debug line in a hurry. No response body reaches a `detail`: a refusal's
 * is cancelled unread, and a listing's is parsed into {@link NormalizedModel}s or discarded.
 *
 * **A plain `fetch`, for `anthropic.adapter.ts`'s reason.** Node 24's global `fetch` *is*
 * undici, the client the ticket's technical stack names, and this adapter sends no completions
 * — which is the only thing the `openai` SDK would be buying. `.dependency-cruiser.cjs` permits
 * that import here and nowhere else, for the day one is genuinely needed.
 */

import { Injectable } from "@nestjs/common";

import {
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MIN,
} from "../../db/schema";
import type {
  ModelProviderAdapter,
  NormalizedModel,
  ProviderCapabilities,
  ProviderConnectionContext,
  ProviderValidation,
} from "../provider.adapter";
import {
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_REDIRECT,
  describeRefusal,
  describeUnreachable,
  discardBody,
  readCappedBody,
  resolveProviderAddress,
} from "../provider.address";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "../provider.config";
import { ProviderAdapterError, classifyHttpStatus } from "../provider.errors";
import { MODEL_PARAM_DIALECT, copyParamSchema, type ModelParamSchema } from "../provider.params";

/**
 * The property the optional API key is submitted under.
 *
 * Not a reserved name — {@link BASE_URL_FIELD} and {@link CAPABILITY_NOTE_FIELD} are, because
 * each is a column. A credential is identified by its `x-ouroboros-secret` annotation, so
 * `provider.forms.ts` finds this field without knowing the word `apiKey`.
 */
export const OPENAI_COMPATIBLE_API_KEY_FIELD = "apiKey";

/** What the address row's `<label>` says — mockup 07's **Base URL**. */
export const OPENAI_COMPATIBLE_BASE_URL_TITLE = "Base URL";

/**
 * How long a call waits before it is a timeout.
 *
 * Ten seconds, the same as the Anthropic adapter's and for the same reason: both calls here
 * are user-initiated — somebody pressed **Test connection** or **Refresh models** and is
 * watching a spinner — so the health sweep's five (`provider-health/cadence.ts`) would be this
 * service's impatience rendered as a provider's fault. A self-hosted server loading a model
 * into GPU memory is genuinely slow on its first request.
 */
export const OPENAI_COMPATIBLE_TIMEOUT_MS = 10_000;

/**
 * The path segment an OpenAI-compatible base URL conventionally ends with.
 *
 * See {@link listingUrl} for why this file looks for it rather than always appending it.
 */
export const OPENAI_VERSION_SEGMENT = "/v1";

/** The listing route, relative to the versioned root. */
export const OPENAI_MODELS_PATH = "/models";

/**
 * What every discovered model's {@link NormalizedModel.display} begins with.
 *
 * Mockup 07's chips, verbatim. See this file's header for why it is on the display and not on
 * the id.
 */
export const LOCAL_DISPLAY_PREFIX = "local/";

/**
 * The add-form for mockup 07's vLLM card: an address, an optional key, and the card's second
 * line.
 *
 * A module constant rather than a literal inside `configSchema()` so it can be asserted against
 * `card.shapes.fixture.ts` directly. {@link OpenAiCompatibleAdapter.configSchema} still hands
 * out a **copy** — the caller is AE.5, holding the value while somebody fills in a form, and an
 * adapter handing out its own object would have that form's edits land here.
 *
 * The order is the order the form renders in, and it is the order the mockup draws: address,
 * then key, then the note under the card's name. `provider.config.ts` explains why that is a
 * contract rather than a coincidence.
 */
const OPENAI_COMPATIBLE_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect an OpenAI-compatible endpoint",
  properties: {
    [BASE_URL_FIELD]: {
      type: "string",
      title: OPENAI_COMPATIBLE_BASE_URL_TITLE,
      description: "The OpenAI-compatible root — vLLM, LM Studio, llama.cpp, TGI.",
      // Drives the `url` widget and the browser's own validation, and nothing else. The
      // address policy is server-side, in `provider.address.ts`, where a form annotation
      // cannot be edited around.
      format: "uri",
      minLength: 1,
      [PLACEHOLDER_ANNOTATION]: "http://10.0.4.20:8000/v1",
    },
    [OPENAI_COMPATIBLE_API_KEY_FIELD]: {
      type: "string",
      title: "API key",
      // Deliberately absent from `required`, and deliberately without a `minLength`: the row
      // ships empty on the mockup's card, and a `minLength` on a field nobody has to fill in
      // is a validator that only ever fires on somebody who started typing and stopped.
      [SECRET_ANNOTATION]: true,
      [PLACEHOLDER_ANNOTATION]: "API key — optional, no auth configured",
    },
    [CAPABILITY_NOTE_FIELD]: {
      type: "string",
      title: "Capability note",
      description: "The card's second line — what this endpoint is, in your own words.",
      maxLength: CAPABILITY_NOTE_MAX_LENGTH,
      [PLACEHOLDER_ANNOTATION]: "self-hosted · A100 ×2",
    },
  },
  required: [BASE_URL_FIELD],
  additionalProperties: false,
};

/**
 * Where a listing lives, given an address that has already passed the policy.
 *
 * **Both spellings of the base URL work, and that is the point.** The ticket writes the call as
 * `GET {base}/v1/models`, and mockup 07's field holds `http://10.0.4.20:8000/v1` — an
 * OpenAI-style base URL, which by that ecosystem's convention already ends in `/v1`, because it
 * is the value you would hand an OpenAI client as its `base_url`. Appending unconditionally
 * would make the mockup's own placeholder request `/v1/v1/models`, and requiring the bare host
 * would reject what every one of these vendors prints in its README. So the segment is appended
 * only when it is not already there.
 *
 * Any query string or fragment on the configured address has already been dropped by
 * `resolveProviderAddress`: a listing route takes neither.
 *
 * @param root - `ProviderAddress.root` — the validated address with trailing slashes, query and
 *   fragment already taken off.
 * @returns The absolute URL to `GET`.
 */
export function listingUrl(root: string): string {
  return root.endsWith(OPENAI_VERSION_SEGMENT)
    ? `${root}${OPENAI_MODELS_PATH}`
    : `${root}${OPENAI_VERSION_SEGMENT}${OPENAI_MODELS_PATH}`;
}

/**
 * The fields the schema requires that nothing has supplied.
 *
 * Derived from the schema rather than written out, which is the habit `docs/MODEL_PROVIDERS.md`
 * asks an author to copy — **check the configuration before opening a socket**, because a
 * connection with no address is not a provider being down, and reporting it as `network` sends
 * somebody to check a firewall.
 *
 * The `x-ouroboros-secret` branch is written even though this schema's credential is optional
 * and therefore never reaches it. It stays because the function is the schema's, not this
 * adapter's opinion of it: a later change that made the key mandatory would otherwise look for
 * it in `config`, where a credential by design never travels, and report a perfectly good
 * connection as unconfigured.
 *
 * @param config - The settings, without the credential.
 * @param secret - The credential, or null.
 * @returns The **titles** of the missing fields, because the sentence is printed on a card foot
 *   — `baseUrl required` is a field name leaking into a page.
 */
export function missingConfiguration(
  config: ProviderConnectionConfig,
  secret: string | null,
): string[] {
  return OPENAI_COMPATIBLE_CONFIG_SCHEMA.required
    .filter((name) =>
      OPENAI_COMPATIBLE_CONFIG_SCHEMA.properties[name][SECRET_ANNOTATION] === true
        ? (secret ?? "").length === 0
        : (config[name] ?? "").length === 0,
    )
    .map((name) => OPENAI_COMPATIBLE_CONFIG_SCHEMA.properties[name].title);
}

/**
 * A listing endpoint this connection may be asked for, or the reason it may not.
 *
 * Both callers begin here, so there is exactly one path from a stored configuration to a URL
 * and it is the one that runs the address policy. A second `fetch` built from
 * `config[BASE_URL_FIELD]` directly would be the whole of the SSRF policy, quietly skipped.
 */
export type ListingEndpoint =
  | {
      readonly ok: true;
      /** The absolute URL to `GET`. */
      readonly url: string;
      /**
       * The address's `host:port`, for the sentence an unreachable endpoint renders as.
       *
       * Safe to print: it is the operator's own address, already visible in the field it came
       * from, and it carries no credential because `resolveProviderAddress` refuses userinfo.
       */
      readonly host: string;
    }
  | {
      readonly ok: false;
      /** Why not — a `config` failure's `detail`, in both callers. */
      readonly detail: string;
    };

/**
 * Turn a connection's settings into an endpoint, or into the reason there is none.
 *
 * @param config - The connection's settings.
 * @param secret - The credential, or null. Read only so the missing-field check is the
 *   schema's; this schema's credential is optional, so it never contributes a missing field.
 * @returns The endpoint, or a `config` failure's detail.
 */
export function listingEndpoint(
  config: ProviderConnectionConfig,
  secret: string | null,
): ListingEndpoint {
  const missing = missingConfiguration(config, secret);

  if (missing.length > 0) {
    return { ok: false, detail: `${missing.join(", ")} required` };
  }

  const address = resolveProviderAddress(config[BASE_URL_FIELD]);

  if (!address.ok) {
    // A `config` failure rather than a `network` one, and found before any socket exists: an
    // address with the wrong scheme is a field somebody can correct, and no retry fixes it.
    return { ok: false, detail: address.violation };
  }

  return { ok: true, url: listingUrl(address.root), host: address.url.host };
}

/**
 * The headers one request carries.
 *
 * A function rather than a template with the key spliced into it, which is the habit
 * `provider-health/checks.ts` sets: the plaintext exists as an argument for the length of one
 * call rather than as a string something might later log or retain.
 *
 * @param secret - The opened credential, or null for the keyless endpoint this card is mostly
 *   used for.
 * @returns The headers. **No `Authorization` at all** when there is no credential — see this
 *   file's header on why an empty bearer would be worse than none.
 */
function requestHeaders(secret: string | null): Record<string, string> {
  return secret === null || secret.length === 0
    ? { accept: "application/json" }
    : { accept: "application/json", authorization: `Bearer ${secret}` };
}

/**
 * How every request this adapter makes is configured.
 *
 * One function, so the two calls cannot come to disagree about the deadline or — the one that
 * matters — about {@link PROVIDER_REDIRECT}. A `fetch` here that forgot it would follow a
 * redirect out of the address the policy checked, which is the whole of rule 2 undone in one
 * omitted property.
 *
 * @param secret - The opened credential, or null.
 * @returns The init.
 */
function requestInit(secret: string | null): RequestInit {
  return {
    // Stated rather than defaulted. The default *is* GET, and writing it here is what puts
    // "this adapter cannot send a completion" on the one line that could ever break it.
    method: "GET",
    headers: requestHeaders(secret),
    redirect: PROVIDER_REDIRECT,
    signal: AbortSignal.timeout(OPENAI_COMPATIBLE_TIMEOUT_MS),
  };
}

/**
 * How an endpoint that never answered reads on the card foot.
 *
 * AC.3's acceptance criterion: *the host is echoed and no raw socket error is surfaced*. Both
 * halves are `provider.address.ts`'s {@link describeUnreachable}, which AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) moved there when it became the
 * second adapter that needed the sentence; all this adds is the deadline it names.
 *
 * @param host - The address's `host:port`.
 * @param error - Whatever was caught.
 * @returns The phrase — `10.0.4.20:8000 unreachable (ECONNREFUSED)`,
 *   `10.0.4.20:8000 timed out after 10000 ms`.
 */
function unreachable(host: string, error: unknown): string {
  return describeUnreachable(host, error, OPENAI_COMPATIBLE_TIMEOUT_MS);
}

/**
 * A number a provider published, or null.
 *
 * @param value - Whatever was at the field.
 * @returns The number when it is a whole one of at least 1, null otherwise. `null` means *the
 *   provider did not say*, and the floor is what keeps a fabricated zero or a fraction from
 *   reaching mockup 21's registry as a confident-looking context length.
 */
function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * What a model chip says.
 *
 * @param id - The provider's own id.
 * @returns The id under {@link LOCAL_DISPLAY_PREFIX} — mockup 07's `local/llama-4-maverick`.
 *   An id that already carries the prefix is left alone rather than doubled: a deployment whose
 *   served-model-name is literally `local/mistral` is somebody being explicit, not somebody to
 *   correct.
 */
export function localDisplay(id: string): string {
  return id.startsWith(LOCAL_DISPLAY_PREFIX) ? id : `${LOCAL_DISPLAY_PREFIX}${id}`;
}

/**
 * One entry of a listing, in this product's vocabulary.
 *
 * @param entry - The entry, `unknown` because a provider is not a source of types: a null in
 *   the array, an entry with no `id`, or an `id` that is a number are all cases this has to
 *   survive rather than cases that cannot happen. The wire format is served by a dozen
 *   implementations of varying rigour, which is more reason to read it defensively rather than
 *   less.
 * @returns The model, or null when the entry carried no usable id — a chip with no id is one
 *   nothing can alias, price or route to.
 */
export function normalizeModel(entry: unknown): NormalizedModel | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";

  if (id.length === 0) {
    return null;
  }

  return {
    // The provider's own spelling, deliberately unprefixed and unprettified: it is what a later
    // call sends back, and `model_aliases.model` and `model_prices.match_model` are written
    // against these strings. The only thing taken off is surrounding whitespace, which is the
    // question *is there an id here at all* rather than a normalization.
    id,
    display: localDisplay(id),
    // Three spellings, in the order they are worth trusting. `max_model_len` is vLLM's and is
    // the one that is really the served context window; `context_length` is what LM Studio and
    // several gateways publish; `context_window` is read because Anthropic's adapter reads it
    // and an endpoint mirroring that shape should not be silently ignored. Plain OpenAI
    // publishes none of them, which is what `null` is for.
    contextLength:
      wholeNumber(record.max_model_len) ??
      wholeNumber(record.context_length) ??
      wholeNumber(record.context_window),
    // Only a locally-hosted model *file* has an on-disk size, and this wire format never
    // reports one — a served model is already in memory. AC.4's Ollama adapter is where this
    // stops being null.
    sizeBytes: null,
    // The OpenAI wire format carries no entitlement signal. Decision P8: report what was said,
    // or say nothing. See this file's header.
    tier: null,
  };
}

/**
 * What an OpenAI-compatible endpoint can be tuned with — the three every implementation of the
 * wire format honours, and nothing beyond them.
 *
 * A module constant rather than a value built per model: this adapter serves vLLM, llama.cpp,
 * LM Studio and anything else speaking `/v1/chat/completions`, and what distinguishes two models
 * behind one of those is a *deployment* fact — how the server was started, what context it was
 * given — rather than something the wire format publishes. So the schema is the same for every
 * model, and the per-model narrowing is `provider_models.meta` merged over it by
 * `registry/params.merge.ts`.
 *
 * **There is no `thinking` field, and its absence is the point.** Some models served this way
 * reason and some do not, and this format has no way to ask which; a control offered on every
 * one of them would be a control that silently does nothing on most. Decision **R3**'s option
 * 2-A is exactly this refusal.
 *
 * **`context_clamp` and `max_output` declare no ceiling.** The real limits are the deployment's,
 * which arrive through discovery — see {@link ANTHROPIC_MAX_THINKING_BUDGET}'s neighbour in the
 * Anthropic adapter for the same argument stated once.
 */
const OPENAI_COMPATIBLE_PARAM_SCHEMA: ModelParamSchema = {
  $schema: MODEL_PARAM_DIALECT,
  type: "object",
  title: "OpenAI-compatible model parameters",
  properties: {
    max_output: {
      type: "integer",
      title: "Max output",
      description: "`max_tokens` — the most tokens one answer may run to.",
      minimum: MODEL_ALIAS_TOKENS_MIN,
    },
    context_clamp: {
      type: "integer",
      title: "Context clamp",
      description: "Hold this model to a smaller context than the server was started with.",
      minimum: MODEL_ALIAS_TOKENS_MIN,
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "Zero is deterministic; two is as varied as this wire format goes.",
      minimum: MODEL_ALIAS_TEMPERATURE_MIN,
      maximum: MODEL_ALIAS_TEMPERATURE_MAX,
    },
  },
  additionalProperties: false,
};

/**
 * The OpenAI-compatible adapter.
 *
 * `@Injectable()` because `providers.module.ts` registers the class and Nest constructs it. It
 * takes no dependencies and holds no state — one instance serves every workspace, which is only
 * safe because nothing about a connection is remembered between calls.
 */
@Injectable()
export class OpenAiCompatibleAdapter implements ModelProviderAdapter {
  /** V015's `provider_connections.kind` for this provider, and the registry's key. */
  readonly kind = "openai_compatible" as const;

  /**
   * The add-form: an address, an optional key, and the card's second line.
   *
   * @returns A fresh deep copy every call, so a caller holding it while somebody fills in a
   *   form cannot mutate the adapter's own value. The conformance kit tries exactly that.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(OPENAI_COMPATIBLE_CONFIG_SCHEMA)) as ProviderConfigSchema;
  }

  /**
   * What this adapter can do.
   *
   * `discovery` is `true` — {@link discoverModels} really asks, so AE.4's refresh affordance
   * means something, and it means more here than anywhere else: the model an operator serves
   * changes when they restart the server, which is a thing that happens on a Tuesday.
   *
   * `pull` is `false`: a served model is already loaded, and there is no route in this wire
   * format to ask for another. `entitlements` is `false` because nothing in an OpenAI-shaped
   * response says anything about a seat or an allowance — and `invocation` is AF.2's
   * ([#235](https://github.com/NobuData/ouroboros/issues/235)) reservation.
   *
   * @returns All four flags, freshly built and equal on every call.
   */
  capabilities(): ProviderCapabilities {
    return { discovery: true, pull: false, entitlements: false, invocation: false };
  }

  /**
   * What a model behind this endpoint can be tuned with — an output ceiling, a context clamp
   * and a temperature.
   *
   * The same three for every model, because the wire format publishes nothing that would
   * distinguish them; what does distinguish them is the deployment, and that reaches the schema
   * through discovery. See {@link OPENAI_COMPATIBLE_PARAM_SCHEMA} on why there is no thinking
   * field here.
   *
   * @param _modelId - Unread, and named with an underscore to say so: nothing this adapter can
   *   answer offline varies by model.
   * @returns A fresh schema every call, equal on every call.
   */
  paramSchema(_modelId: string): ModelParamSchema {
    return copyParamSchema(OPENAI_COMPATIBLE_PARAM_SCHEMA);
  }

  /**
   * The **Test connection** button: is anything there, and how fast did it answer.
   *
   * A models listing — the one route every implementation of this wire format serves, and the
   * same one `provider-health/checks.ts` asks on its local cadence. Nothing here sends a
   * completion; there is no parameter by which it could.
   *
   * @param config - The settings, as `partitionSubmission` produced them.
   * @param secret - The opened credential, or null when the key row was left blank — which is
   *   the ordinary state of this card.
   * @returns What the check found — `{status: "ok", latencyMs, detail: "200"}` for a success,
   *   which the card foot renders as `✓ 200 · 12ms`. **Never rejects**: a refusal, a redirect,
   *   a timeout and a closed socket are all results, because a provider being down is the state
   *   the card exists to draw.
   */
  async validate(
    config: ProviderConnectionConfig,
    secret: string | null,
  ): Promise<ProviderValidation> {
    const endpoint = listingEndpoint(config, secret);

    if (!endpoint.ok) {
      return { status: "failed", errorClass: "config", detail: endpoint.detail };
    }

    const started = performance.now();
    let response: Response;

    try {
      response = await fetch(endpoint.url, requestInit(secret));
    } catch (error) {
      // Nothing answered. Says nothing about the credential, and deliberately does not.
      return {
        status: "failed",
        errorClass: "network",
        detail: unreachable(endpoint.host, error),
      };
    }

    // Measured before the body is dealt with, because the round trip is what the card prints
    // and the tidying up afterwards is this service's own time.
    const latencyMs = Math.max(0, Math.round(performance.now() - started));

    // Nothing here reads a body: the question is whether something answered, and a listing's
    // contents are `discoverModels`' business. Cancelling returns the socket to the pool.
    await discardBody(response);

    if (!response.ok) {
      return {
        status: "failed",
        errorClass: classifyHttpStatus(response.status),
        detail: describeRefusal(response.status),
      };
    }

    return { status: "ok", latencyMs, detail: response.status.toString() };
  }

  /**
   * The **Models available** chips: every model this endpoint is serving.
   *
   * One request, and no pagination — unlike Anthropic's listing, the OpenAI wire format's
   * `/v1/models` is a whole `{object: "list", data: [...]}` with no cursor and no `has_more`,
   * because the answer is *what this server has loaded* rather than a catalog.
   *
   * @param connection - The saved connection, opened by its caller.
   * @returns The models, in the order the server listed them — an order this layer has no
   *   better version of. An empty list is a legitimate answer: a server that has been started
   *   with no model loaded is a real state, and it is not a failure.
   * @throws {ProviderAdapterError} `config` for an address the policy refuses or a connection
   *   with none, and the class the refusal or transport failure belongs to otherwise. A list has
   *   no room for a failure, which is why this one is thrown rather than returned.
   */
  async discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    const endpoint = listingEndpoint(connection.config, connection.secret);

    if (!endpoint.ok) {
      throw new ProviderAdapterError("config", endpoint.detail);
    }

    let response: Response;

    try {
      response = await fetch(endpoint.url, requestInit(connection.secret));
    } catch (error) {
      throw new ProviderAdapterError("network", unreachable(endpoint.host, error));
    }

    if (!response.ok) {
      // The body of a refusal is never read: it is somebody's error object, and this endpoint
      // is one this service was pointed at rather than one it knows — a gateway's `401` page
      // quoting the `Authorization` header it received is a real shape.
      await discardBody(response);

      throw new ProviderAdapterError(
        classifyHttpStatus(response.status),
        describeRefusal(response.status),
        response.status,
      );
    }

    return normalizeListing(await readListing(response));
  }
}

/**
 * A listing's entries, read from a response.
 *
 * @param response - The `200`. Its body is consumed here.
 * @returns The entries, unread — {@link normalizeModel} is what makes sense of one.
 * @throws {ProviderAdapterError} `upstream` when the body is too large, ends early, is not
 *   JSON, or is JSON that is not a listing. `upstream` rather than `config` because the address
 *   already answered `200` to a models route: something is at the other end and it is
 *   misbehaving, which is not a field anybody can correct.
 */
async function readListing(response: Response): Promise<readonly unknown[]> {
  const body = await readCappedBody(response, PROVIDER_MAX_RESPONSE_BYTES);

  if (!body.read) {
    throw new ProviderAdapterError("upstream", body.violation);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body.text);
  } catch {
    // The commonest real cause is an address pointing at a web UI rather than an API, which
    // answers `200 text/html` — so the sentence says what was expected rather than quoting
    // what arrived.
    throw new ProviderAdapterError("upstream", "the model listing was not JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ProviderAdapterError("upstream", "the model listing was not an object");
  }

  const listing = parsed as Record<string, unknown>;

  if (!Array.isArray(listing.data)) {
    throw new ProviderAdapterError("upstream", "the model listing carried no data array");
  }

  return listing.data as readonly unknown[];
}

/**
 * A listing's entries, normalized.
 *
 * @param entries - What the server listed.
 * @returns The models, in the server's own order. Entries with no usable id are dropped rather
 *   than reported: one unusable row in a listing of forty is a chip nothing could do anything
 *   with, and failing the whole discovery over it would leave a card with no chips at all.
 *   Duplicate ids are dropped for the conformance kit's reason — two rows with the same id
 *   become two chips a person cannot tell apart, and an alias resolving against the catalog
 *   then has two candidates and no rule for choosing.
 */
function normalizeListing(entries: readonly unknown[]): NormalizedModel[] {
  const models: NormalizedModel[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const model = normalizeModel(entry);

    if (model !== null && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }

  return models;
}
