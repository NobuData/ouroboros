/**
 * The Anthropic adapter — the first conforming implementation of the SPI, and the bar the
 * other four are measured against.
 *
 * AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)), on AC.1's interface
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)) and AD.1's vault
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)). It is mockup 07's `AN` card,
 * as code:
 *
 * ```
 * configSchema  ─▶ { apiKey: secret }                    the masked key row, and nothing else
 * validate(key) ─▶ GET /v1/models?limit=1 ─▶ 200 · 38ms  the card foot's  ✓ 200 · 38ms
 *                                        └▶ 401 ───────▶ auth       ·  key rejected
 *                                        └▶ 429 ───────▶ rate_limit ·  rate limited
 *                                        └▶ 503 ───────▶ upstream   ·  degraded upstream
 *                                        └▶ ECONNRESET ▶ network    ·  unreachable
 * discoverModels ─▶ GET /v1/models ─▶ claude-fable-5 · claude-opus-5 · claude-sonnet-5 · …
 *                       headers  ─▶ priority tier, only when the response really said so
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The `priority tier` pill is the one genuinely tricky element, and decision P8 settles
 * it.**
 *
 * A tier is real information when the API exposes it and pure invention when it does not.
 * Anthropic exposes it as *response headers*: an organization with priority-tier capacity is
 * told its priority allowances on every answer, under `anthropic-priority-…-limit`, and an
 * organization without one is told nothing. So {@link priorityTierOf} reads the headers of
 * the listing this adapter already had to make, reports `priority` when one of those
 * allowances is a positive number, and reports `null` otherwise — which is
 * {@link NormalizedModel.tier}'s *the provider did not say*, and which renders as no pill at
 * all.
 *
 * There is deliberately no fallback, no default and no inference from the models a key can
 * see. An adapter that guessed at entitlement would make the whole card untrustworthy,
 * because a person cannot tell which pills were earned; the pill is worth having only while
 * every one of them was.
 *
 * ---------------------------------------------------------------------------
 * **Why there is no Base URL field.**
 *
 * The endpoint is fixed at {@link ANTHROPIC_DEFAULT_BASE_URL} and the card shows it as prose
 * — mockup 07's capability line reads *api.anthropic.com · primary coding lane*, which is
 * `provider_connections.capability_note` (V017) rather than a setting. The one thing this
 * card asks anybody for is a key, which is exactly what `card.shapes.fixture.ts` recorded
 * before this adapter existed, and `anthropic.adapter.spec.ts` asserts the two still agree.
 *
 * A configurable address is what AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218))
 * is for. Adding one here would also mean owning an SSRF policy for a field that exists to
 * hold one hostname.
 *
 * ---------------------------------------------------------------------------
 * **Where the credential is, and where it is not.**
 *
 * It arrives as a parameter, opened by the caller — AD.1's vault service through AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) — for the length of one call.
 * This class stores none, holds no vault, and **logs nothing at all**: there is no logger in
 * the file, which is the only version of *never logged* that stays true after somebody adds
 * a debug line in a hurry. Nothing a provider sends is ever put in a `detail` either — a
 * refusal's body is cancelled unread, because provider error bodies quote request headers
 * and the request header here is the key.
 *
 * ---------------------------------------------------------------------------
 * **A plain `fetch`, for the reason `provider-health/probe.client.ts` gives.** Node 24's
 * global `fetch` *is* undici, the client the ticket's technical stack names, so adding
 * `@anthropic-ai/sdk` would put a second HTTP client in the process to make two `GET`s the
 * runtime already makes — and this adapter sends no completions, which is the only thing an
 * SDK would be buying. `.dependency-cruiser.cjs` permits that import here and nowhere else,
 * for the day one is genuinely needed.
 */

import { Injectable } from "@nestjs/common";

import {
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MIN,
  THINKING_LEVELS,
} from "../../db/schema";
import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_VERSION } from "../../provider-health/checks";
import type {
  ModelProviderAdapter,
  NormalizedModel,
  ProviderCapabilities,
  ProviderConnectionContext,
  ProviderValidation,
} from "../provider.adapter";
import {
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
 * Named rather than spelled twice, because the schema declares it and
 * {@link missingConfiguration} reads it back — two literals is two places to mistype one.
 * There is no reserved name for a credential the way {@link import("../provider.config").BASE_URL_FIELD}
 * reserves one for an address: the annotation is what identifies it, so `provider.forms.ts`
 * finds this field without knowing the word `apiKey`.
 */
export const ANTHROPIC_API_KEY_FIELD = "apiKey";

/** What the key row's `<label>` says — mockup 07's **API key**. */
export const ANTHROPIC_API_KEY_TITLE = "API key";

/**
 * How long a call waits before it is a timeout.
 *
 * Ten seconds rather than the health sweep's five (`provider-health/cadence.ts`). That one is
 * a background poll of every provider a workspace has and must stay bounded; both calls here
 * are user-initiated — somebody pressed **Test connection** or **Refresh models** and is
 * watching a spinner — and calling a vendor *unreachable* after five seconds because it was
 * having a slow moment would be this service's impatience rendered as a provider's fault.
 */
export const ANTHROPIC_TIMEOUT_MS = 10_000;

/**
 * How many models one listing page asks for.
 *
 * Anthropic's maximum, so the ordinary case — a few dozen published models — is one request
 * and the pagination below never runs. It is still written, because a catalog that silently
 * stopped at the first page would be a card missing chips with nothing to say it was.
 */
export const ANTHROPIC_PAGE_SIZE = 1000;

/**
 * How many listing pages one discovery will follow before giving up.
 *
 * A backstop rather than a limit anybody should reach: at {@link ANTHROPIC_PAGE_SIZE} a page
 * this is ten thousand models. What it is really guarding is a provider whose `has_more`
 * never turns off, which is an infinite loop holding a request open — and a bounded failure
 * an operator can read beats a spinner that never stops.
 */
export const ANTHROPIC_PAGE_LIMIT = 10;

/**
 * The prefix Anthropic puts on the headers that describe a priority-tier allowance.
 *
 * `anthropic-priority-input-tokens-limit`, `anthropic-priority-output-tokens-limit`, and the
 * remaining/reset headers beside them. Only an organization with priority-tier capacity is
 * sent any of them, which is what makes their presence a signal rather than a formality.
 */
export const PRIORITY_TIER_HEADER_PREFIX = "anthropic-priority-";

/** The suffix on the headers that carry an allowance, as opposed to a remaining or a reset. */
export const PRIORITY_TIER_HEADER_SUFFIX = "-limit";

/**
 * The word reported as {@link NormalizedModel.tier}, and stored as `provider_models.meta.tier`.
 *
 * The same spelling `R__dev_seed_providers.sql` writes on the four Anthropic rows, so the
 * seeded stack and a real discovery produce the same catalog rather than two that look alike.
 */
export const PRIORITY_TIER = "priority";

/**
 * The add-form for mockup 07's Anthropic card: one masked key row.
 *
 * A module constant rather than a literal inside `configSchema()` so it can be asserted
 * against `card.shapes.fixture.ts` directly. {@link AnthropicAdapter.configSchema} still
 * hands out a **copy** — the caller is AE.5, holding the value while somebody fills in a
 * form, and an adapter handing out its own object would have that form's edits land here.
 */
const ANTHROPIC_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect Anthropic",
  properties: {
    [ANTHROPIC_API_KEY_FIELD]: {
      type: "string",
      title: ANTHROPIC_API_KEY_TITLE,
      minLength: 1,
      [SECRET_ANNOTATION]: true,
      [PLACEHOLDER_ANNOTATION]: "sk-ant-api03-…",
    },
  },
  required: [ANTHROPIC_API_KEY_FIELD],
  additionalProperties: false,
};

/**
 * The generations with no extended thinking — the one piece of per-model knowledge this
 * adapter's param schema carries.
 *
 * Extended thinking arrived with Claude 3.7 and is a feature of every generation since; the
 * families below predate it, so offering a `thinking` field on one would be offering a control
 * with nothing behind it. Written as **prefixes of the vendor's own identifiers** rather than
 * parsed out of a version number, because `claude-3-5-sonnet-20241022`,
 * `claude-3-7-sonnet-20250219` and `claude-opus-4-1` do not agree about where the version goes
 * — a regular expression over them would be a guess that reads like a rule.
 *
 * The list is checked against the bundled price catalog's own `capabilities.reasoning` flags in
 * `anthropic.adapter.spec.ts`: every Anthropic model that catalog knows about is asked, and the
 * two answers have to agree. That is what keeps this from being one person's recollection.
 *
 * A model this build has never heard of is **not** on the list and therefore gets the field.
 * That direction is deliberate: a new Claude arriving between releases should render the
 * control its whole generation has, and a param the model turns out to ignore is a smaller
 * failure than a control missing from the one model somebody bought the key for.
 */
export const ANTHROPIC_PRE_THINKING_MODELS: readonly string[] = Object.freeze([
  "claude-instant-",
  "claude-1",
  "claude-2",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "claude-3-5-",
]);

/**
 * The largest thinking budget this adapter offers — one million tokens.
 *
 * The widest context any Claude publishes, so a budget above it could not be spent whatever the
 * model. The real ceiling is smaller and is the *model's own* context length, which this adapter
 * cannot know offline; `registry/params.merge.ts` narrows this bound to what discovery reported
 * for the model and labels the result as coming from there.
 */
export const ANTHROPIC_MAX_THINKING_BUDGET = 1_000_000;

/**
 * The highest temperature the Messages API accepts — one, not two.
 *
 * V019's column allows two because that is the widest any provider this product reaches
 * publishes; Anthropic's own range is `0`–`1`, and a form offering `1.5` would be a form whose
 * valid-looking submission the provider refuses. The narrower of the two is what a write is
 * checked against, which is this.
 */
export const ANTHROPIC_MAX_TEMPERATURE = 1;

/**
 * Whether a model has extended thinking, as far as this adapter knows.
 *
 * @param modelId - The model's own identifier. Not checked against a catalog — see
 *   {@link ModelProviderAdapter.paramSchema} on why an id it has never seen is answered rather
 *   than refused.
 * @returns Whether to offer the thinking controls.
 */
export function anthropicSupportsThinking(modelId: string): boolean {
  return !ANTHROPIC_PRE_THINKING_MODELS.some((prefix) => modelId.startsWith(prefix));
}

/**
 * The three tunables every Claude has, and the two more a thinking model adds.
 *
 * Built per call rather than held as a constant, because the answer differs by model — see
 * {@link anthropicSupportsThinking}. The thinking pair is inserted **first**, which is the order
 * mockup 21's inspector draws them in: *Thinking*, *Token budget*, then the temperature row.
 *
 * **`max_output` deliberately declares no ceiling.** Anthropic's maximum output differs per
 * model — 64k on one Claude, 128k on another — and this adapter cannot ask without a network.
 * Leaving the bound absent is what lets `registry/params.merge.ts` fill it from the bundled
 * catalog's `max_output_tokens` and *label it* as catalogued rather than live, which is the
 * ticket's option 2-B: enrichment where the adapter is silent, never a value that overrides it.
 *
 * @param modelId - The model the schema is for.
 * @returns The schema, freshly built.
 */
function anthropicParamSchema(modelId: string): ModelParamSchema {
  const thinking: ModelParamSchema["properties"] = anthropicSupportsThinking(modelId)
    ? {
        thinking: {
          type: "string",
          title: "Thinking",
          description: "How much reasoning effort to ask for before the answer starts.",
          enum: THINKING_LEVELS,
        },
        token_budget: {
          type: "integer",
          title: "Token budget",
          description: "The ceiling on thinking tokens, inside the model's context window.",
          minimum: MODEL_ALIAS_TOKENS_MIN,
          maximum: ANTHROPIC_MAX_THINKING_BUDGET,
        },
      }
    : {};

  return {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Anthropic model parameters",
    properties: {
      ...thinking,
      max_output: {
        type: "integer",
        title: "Max output",
        description: "The most tokens one answer may run to.",
        minimum: MODEL_ALIAS_TOKENS_MIN,
      },
      temperature: {
        type: "number",
        title: "Temperature",
        description: "Zero is deterministic; one is as varied as this API goes.",
        minimum: MODEL_ALIAS_TEMPERATURE_MIN,
        maximum: ANTHROPIC_MAX_TEMPERATURE,
      },
    },
    additionalProperties: false,
  };
}

/** What one page of `/v1/models` told us, in this file's terms. */
interface ModelListingPage {
  /** The entries, unread — {@link normalizeModel} is what makes sense of one. */
  readonly entries: readonly unknown[];
  /** Whether Anthropic says there is another page. */
  readonly hasMore: boolean;
  /** The cursor for that page, or null when the provider named none. */
  readonly lastId: string | null;
  /** The tier this response's headers reported, or null. See {@link priorityTierOf}. */
  readonly tier: string | null;
}

/**
 * The headers one request carries.
 *
 * A function rather than a template with the key spliced into it, which is the habit
 * `provider-health/checks.ts` sets for the same reason: the plaintext exists as an argument
 * for the length of one call rather than as a string something might later log or retain.
 *
 * @param apiKey - The opened credential.
 * @returns The headers. `anthropic-version` is required on every request the API accepts.
 */
function requestHeaders(apiKey: string): Record<string, string> {
  return {
    accept: "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/**
 * Where a listing lives.
 *
 * @param limit - How many models to ask for.
 * @param after - The cursor from a previous page, or null for the first.
 * @returns The absolute URL. Built from {@link ANTHROPIC_DEFAULT_BASE_URL} rather than from
 *   anything a caller supplied — this adapter has no address field, so there is no path by
 *   which a request could be sent somewhere else.
 */
function listingUrl(limit: number, after: string | null): string {
  const params = new URLSearchParams({ limit: limit.toString() });

  if (after !== null) {
    params.set("after_id", after);
  }

  return `${ANTHROPIC_DEFAULT_BASE_URL}/v1/models?${params.toString()}`;
}

/**
 * Give a response's socket back without reading it.
 *
 * An unread body keeps its connection checked out of undici's pool until the collector gets
 * to it. Errors are swallowed because a body that cannot be cancelled has already ended —
 * and a `401` must not be reported as a `network` failure because tidying up after it threw.
 *
 * @param response - The response to discard.
 */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The socket is already gone, which is the outcome this was asking for.
  }
}

/**
 * The service tier a response's headers report, if they report one.
 *
 * Decision **P8**, as the only line of code that can break it. A header carrying a positive
 * allowance is the signal; anything else — no such header, an unparseable value, or an
 * allowance of zero, which is an organization with no priority capacity — is `null`.
 *
 * @param headers - The response's headers. Names arrive lower-cased, which is why the prefix
 *   match needs no case folding of its own.
 * @returns {@link PRIORITY_TIER}, or null when the response said nothing about a tier.
 */
export function priorityTierOf(headers: Headers): string | null {
  let tier: string | null = null;

  headers.forEach((value, name) => {
    if (
      !name.startsWith(PRIORITY_TIER_HEADER_PREFIX) ||
      !name.endsWith(PRIORITY_TIER_HEADER_SUFFIX)
    ) {
      return;
    }

    const allowance = Number.parseInt(value, 10);

    if (Number.isInteger(allowance) && allowance > 0) {
      tier = PRIORITY_TIER;
    }
  });

  return tier;
}

/**
 * A number a provider published, or null.
 *
 * `null` means *the provider did not say*, and the point of the floor is that a fabricated
 * zero and a fraction are both what a parse looks like when nobody checked it — each of which
 * reaches mockup 21's registry as a confident-looking context length.
 *
 * @param value - Whatever was at the field.
 * @returns The number when it is a whole one of at least 1, null otherwise.
 */
function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * One entry of a listing, in this product's vocabulary.
 *
 * @param entry - The entry, `unknown` because a provider is not a source of types: a null in
 *   the array, an entry with no `id`, or a `display_name` that is a number are all cases this
 *   has to survive rather than cases that cannot happen.
 * @param tier - The tier the *response* reported, applied to every model in it. An entitlement
 *   is a fact about the credential rather than about one model, and the card draws one pill
 *   beside the chips rather than one per chip.
 * @returns The model, or null when the entry carried no usable id — a chip with no id is one
 *   nothing can alias, price or route to.
 */
export function normalizeModel(entry: unknown, tier: string | null): NormalizedModel | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";

  if (id.length === 0) {
    return null;
  }

  const displayName = typeof record.display_name === "string" ? record.display_name.trim() : "";

  return {
    // The provider's own spelling, deliberately unprettified: it is what a later call sends
    // back, and `model_aliases.model_id` and `model_prices.match_model` are written against
    // these strings. The only thing taken off is surrounding whitespace, and that is the
    // question *is there an id here at all* rather than a normalization — an id that is
    // nothing but spaces joins to no price and resolves no alias.
    id,
    display: displayName.length > 0 ? displayName : id,
    // Anthropic's model object publishes an id, a display name and a creation timestamp — no
    // context window — so this is `null` today, which is what `null` is for. It is *read*
    // rather than assumed absent so that the day the field appears, a chip gains its context
    // length without a release here.
    contextLength: wholeNumber(record.context_window),
    // Only a locally-hosted model has an on-disk size; a hosted one has none to report. AC.4's
    // Ollama adapter is where this stops being null.
    sizeBytes: null,
    tier,
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
 * The split is the one `provider.forms.ts` makes: the field marked `x-ouroboros-secret` is
 * satisfied by the credential parameter, and every other field by the config object. A
 * required-field check that looked for the key inside `config` would report a perfectly good
 * connection as unconfigured, because that value never travels there.
 *
 * @param config - The settings, without the credential.
 * @param secret - The credential, or null.
 * @returns The **titles** of the missing fields, because the sentence is printed on a card
 *   foot — `baseUrl required` is a field name leaking into a page.
 */
export function missingConfiguration(
  config: ProviderConnectionConfig,
  secret: string | null,
): string[] {
  return ANTHROPIC_CONFIG_SCHEMA.required
    .filter((name) =>
      ANTHROPIC_CONFIG_SCHEMA.properties[name][SECRET_ANNOTATION] === true
        ? (secret ?? "").length === 0
        : (config[name] ?? "").length === 0,
    )
    .map((name) => ANTHROPIC_CONFIG_SCHEMA.properties[name].title);
}

/**
 * The Anthropic adapter.
 *
 * `@Injectable()` because `providers.module.ts` registers the class and Nest constructs it.
 * It takes no dependencies and holds no state — one instance serves every workspace, which is
 * only safe because nothing about a connection is remembered between calls.
 */
@Injectable()
export class AnthropicAdapter implements ModelProviderAdapter {
  /** V015's `provider_connections.kind` for this provider, and the registry's key. */
  readonly kind = "anthropic" as const;

  /**
   * The add-form: one masked key row.
   *
   * @returns A fresh deep copy every call, so a caller holding it while somebody fills in a
   *   form cannot mutate the adapter's own value. The conformance kit tries exactly that.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(ANTHROPIC_CONFIG_SCHEMA)) as ProviderConfigSchema;
  }

  /**
   * What this adapter can do.
   *
   * `discovery` is `true` — {@link discoverModels} really asks, so AE.4's refresh affordance
   * means something. `pull` is `false`: nothing pulls a hosted model onto a machine.
   *
   * **`entitlements` is `false`, and the tier pill is not a counter-example.** That flag is a
   * promise about {@link validate}'s `detail` — mockup 07's Copilot card reads *org-billed ·
   * 4 seats*, which is a capability line AE.2 composes from a validation result, and AC.1
   * names AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) as the adapter that
   * sets it. This card's capability line is prose an operator wrote (`capability_note`), and
   * its entitlement signal travels the other road entirely: per model, through discovery,
   * into `provider_models.meta.tier`. Setting the flag would promise a `detail` that says
   * something it does not, and the card foot would then print an entitlement where the mockup
   * prints `✓ 200 · 38ms`.
   *
   * @returns All four flags, freshly built and equal on every call.
   */
  capabilities(): ProviderCapabilities {
    return { discovery: true, pull: false, entitlements: false, invocation: false };
  }

  /**
   * What one Claude can be tuned with — thinking and its budget where the model has them, a
   * maximum output and a temperature everywhere.
   *
   * The inspector's field stack for mockup 21's `coder-max`, and the schema every write to that
   * alias's `params` is checked against. Local: no network, no credential, no connection — see
   * `provider.adapter.ts` on why a form field may not wait on a provider.
   *
   * @param modelId - The model's own identifier. An id this adapter has never seen is answered
   *   rather than refused, and gets the thinking controls — see
   *   {@link ANTHROPIC_PRE_THINKING_MODELS} for which way that error leans and why.
   * @returns A fresh schema every call, equal for equal ids. `claude-fable-5` offers thinking
   *   and a budget; `claude-3-haiku-20240307` offers neither.
   */
  paramSchema(modelId: string): ModelParamSchema {
    return copyParamSchema(anthropicParamSchema(modelId));
  }

  /**
   * The **Test connection** button: is this key any good, and how fast did we find out.
   *
   * A models listing of one row — the smallest question that still needs the credential to be
   * honoured, and the same one `provider-health/checks.ts` asks on its slow cadence. Nothing
   * here sends a completion; there is no parameter by which it could.
   *
   * @param config - The settings, as `partitionSubmission` produced them. Empty for this
   *   provider today, and read through the schema rather than ignored so a field added to the
   *   schema is checked without this method changing.
   * @param secret - The opened credential, or null when the add-form's key row was left blank.
   * @returns What the check found — `{status: "ok", latencyMs, detail: "200"}` for a success,
   *   which the card foot renders as `✓ 200 · 38ms`. **Never rejects**: a refusal, a timeout,
   *   a closed socket and a nonsense body are all results, because a provider being down is
   *   the state the card exists to draw.
   */
  async validate(
    config: ProviderConnectionConfig,
    secret: string | null,
  ): Promise<ProviderValidation> {
    const missing = missingConfiguration(config, secret);

    // The `secret === null` half is what narrows the type for the call below; `missing` is
    // what says *which* fields, and for this schema the two are the same fact.
    if (secret === null || missing.length > 0) {
      return {
        status: "failed",
        errorClass: "config",
        detail: `${missing.join(", ")} required`,
      };
    }

    const started = performance.now();
    let response: Response;

    try {
      response = await fetch(listingUrl(1, null), {
        // Stated rather than defaulted. The default *is* GET, and writing it here is what puts
        // "this adapter cannot send a completion" on the one line that could ever break it.
        method: "GET",
        headers: requestHeaders(secret),
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      });
    } catch (error) {
      // Nothing answered. Says nothing about the credential, and deliberately does not.
      return {
        status: "failed",
        errorClass: "network",
        detail: describeTransportFailure(error, ANTHROPIC_TIMEOUT_MS),
      };
    }

    // Measured before the body is dealt with, because the round trip is what the card prints
    // and the tidying up afterwards is this service's own time.
    const latencyMs = Math.max(0, Math.round(performance.now() - started));

    await discard(response);

    if (!response.ok) {
      // `classifyHttpStatus` refuses anything below 300, which is what keeps a `200` from
      // being classified as a plausible-looking `upstream`. It cannot be reached from here:
      // `Response.ok` covers 200–299 and the `Response` constructor refuses a status outside
      // 200–599, so `fetch` has no way to deliver one this would throw on.
      return {
        status: "failed",
        errorClass: classifyHttpStatus(response.status),
        detail: describeHttpRefusal(response.status),
      };
    }

    return { status: "ok", latencyMs, detail: response.status.toString() };
  }

  /**
   * The **Models available** chips: every model this key can reach.
   *
   * @param connection - The saved connection, opened by its caller.
   * @returns The models, in the order Anthropic listed them — newest first, which is an order
   *   this layer has no better version of. Every one of them carries the tier the *listing*
   *   reported, which is `null` unless the response really said otherwise.
   * @throws {ProviderAdapterError} `config` when the connection has no credential, and the
   *   class the refusal or transport failure belongs to otherwise. A list has no room for a
   *   failure, which is why this one is thrown rather than returned.
   */
  async discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    const missing = missingConfiguration(connection.config, connection.secret);
    const secret = connection.secret;

    if (secret === null || missing.length > 0) {
      throw new ProviderAdapterError("config", `${missing.join(", ")} required`);
    }

    const models: NormalizedModel[] = [];
    // Ids are unique within one answer, which the conformance kit requires: a page boundary
    // that repeated an entry would otherwise become two chips a person cannot tell apart.
    const seen = new Set<string>();
    let after: string | null = null;

    for (let page = 0; page < ANTHROPIC_PAGE_LIMIT; page += 1) {
      const listing = await this.listPage(secret, after);

      for (const entry of listing.entries) {
        const model = normalizeModel(entry, listing.tier);

        if (model !== null && !seen.has(model.id)) {
          seen.add(model.id);
          models.push(model);
        }
      }

      if (!listing.hasMore || listing.lastId === null) {
        return models;
      }

      after = listing.lastId;
    }

    // Reached only by a provider whose `has_more` never turns off. Reported rather than
    // returned, because a silently truncated catalog is a card missing chips with nothing to
    // say it was, and `provider_models` would then be upserted from an answer that is not one.
    throw new ProviderAdapterError(
      "upstream",
      `model listing did not end after ${ANTHROPIC_PAGE_LIMIT.toString()} pages`,
    );
  }

  /**
   * One page of the listing.
   *
   * @param apiKey - The opened credential.
   * @param after - The cursor from the previous page, or null for the first.
   * @returns What the page said.
   * @throws {ProviderAdapterError} For a refusal, a transport failure, or a body that is not
   *   a listing. The last of those is `upstream` rather than `config`: the address is this
   *   file's own constant, so a `200` that is not JSON is the provider misbehaving and there
   *   is no setting anybody could correct.
   */
  private async listPage(apiKey: string, after: string | null): Promise<ModelListingPage> {
    let response: Response;

    try {
      response = await fetch(listingUrl(ANTHROPIC_PAGE_SIZE, after), {
        method: "GET",
        headers: requestHeaders(apiKey),
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderAdapterError(
        "network",
        describeTransportFailure(error, ANTHROPIC_TIMEOUT_MS),
      );
    }

    if (!response.ok) {
      // The body of a refusal is never read: it is the vendor's error object, it quotes
      // request headers often enough that reading one is not worth the times it does not, and
      // the request header here is the key.
      await discard(response);

      throw new ProviderAdapterError(
        classifyHttpStatus(response.status),
        describeHttpRefusal(response.status),
        response.status,
      );
    }

    // Read before the body, because a cancelled body cannot be asked for its response's
    // headers afterwards — and because the tier belongs to the answer rather than to a model
    // inside it.
    const tier = priorityTierOf(response.headers);
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new ProviderAdapterError("upstream", "the model listing was not JSON");
    }

    if (typeof body !== "object" || body === null) {
      throw new ProviderAdapterError("upstream", "the model listing was not an object");
    }

    const listing = body as Record<string, unknown>;

    if (!Array.isArray(listing.data)) {
      throw new ProviderAdapterError("upstream", "the model listing carried no data array");
    }

    return {
      entries: listing.data as readonly unknown[],
      hasMore: listing.has_more === true,
      lastId:
        typeof listing.last_id === "string" && listing.last_id.length > 0 ? listing.last_id : null,
      tier,
    };
  }
}
