/**
 * The GitHub Copilot adapter — the org-billed lane, and the one card mockup 07 draws in a
 * state that is not healthy.
 *
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)), on AC.1's interface
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)) and AD.1's vault
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)). It is mockup 07's `GH` card —
 * *GitHub Copilot*, *billed through GitHub org acme-robotics* — as code:
 *
 * ```
 * configSchema   ─▶ { token, organization?, capabilityNote? }   a masked token row, org-billed
 * validate       ─▶ GET /user ─▶ 200 ─▶ GET /orgs/{org}/copilot/billing ─▶ "200 · 4 seats"
 *                            │                                  └▶ no seats published ─▶ "200"
 *                            ├▶ 401 ──────────────▶ auth       ·  key rejected (401)
 *                            ├▶ 503 ──────────────▶ upstream   ·  degraded upstream   ⟳ once
 *                            ├▶ answered, slowly ─▶ upstream   ·  degraded upstream
 *                            └▶ ECONNRESET ───────▶ network    ·  unreachable
 * discoverModels ─▶ a fixed catalog, no request at all ──────▶ copilot/gpt-5-codex
 * ```
 *
 * ---------------------------------------------------------------------------
 * **A fixed catalog is a real answer, not a stub.**
 *
 * GitHub publishes no models-list endpoint for Copilot worth discovering against, so the
 * models this connection can reach are *declared* — by {@link COPILOT_CATALOG}, in this file,
 * with a source for every field. They are then upserted into `provider_models` exactly as a
 * discovered model is, which is what keeps the card, mockup 21's registry and Y.1's alias
 * validation reading one table regardless of where the truth originated. The row a fixed
 * catalog writes and the row a discovery writes are indistinguishable, and that is the
 * design.
 *
 * `capabilities().discovery` is therefore `false` — not because {@link discoverModels} is
 * absent, but because *refreshing* means nothing here. AE.4
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) hides the refresh affordance on
 * that flag, because a spinner over a constant is a lie about where data comes from.
 *
 * ---------------------------------------------------------------------------
 * **Seats: rendered from real entitlement data, or omitted. There is no third option.**
 *
 * Mockup 07's meter reads `$76.00 of $95 cap · 4 seats`, and the suffix is entitlement data
 * that only GitHub can know. It is available only when three things are true at once: an
 * organization is configured, the token may read that organization's Copilot billing, and the
 * response really carries a `seat_breakdown.total`. When any of them is not, the seat suffix
 * is **absent** — decision **P8** — because a count a person cannot tell *earned* from
 * *assumed* makes every other number on the card unreadable too.
 *
 * The count travels in `validate`'s `detail`, which is what `ProviderCapabilities.entitlements`
 * promises and the only channel the SPI has for one. `provider.entitlements.ts` owns the
 * spelling at both ends, so AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232))
 * reads the number back with a function instead of a regular expression it invented.
 *
 * **The entitlement lookup cannot fail a validation.** It is a second request, made only after
 * the token has already been accepted, and everything it can answer other than a seat count
 * means *no seat count*: a `403` is a token without `manage_billing:copilot`, a `404` is an
 * organization this token cannot see, a `500` is GitHub having a moment. None of those makes
 * the credential bad, and reporting a good token as broken because a supplementary endpoint
 * was unavailable would be this adapter's curiosity rendered as an operator's outage.
 *
 * ---------------------------------------------------------------------------
 * **Degraded upstream, and the two bounds on the retry.**
 *
 * This is the only card in the mockup showing a non-healthy state — `degraded upstream`, with
 * the foot note `△ 503 upstream · retrying` — and every part of it is earned by a real
 * response rather than special-cased. A `5xx` is `upstream` through
 * {@link classifyHttpStatus}, which every adapter shares; the pill is `PROVIDER_ERROR_PILLS`'
 * and the `· retrying` is `validationNote`'s, from `PROVIDER_ERROR_RETRYABLE`. Nothing in the
 * path from a recorded `503` to that sentence names this provider.
 *
 * A **latency outlier** takes the same road: an answer slower than {@link COPILOT_SLOW_MS} is
 * reported as `upstream` even though it arrived, because a token check that took six seconds
 * describes a provider in trouble rather than a healthy one. *Outlier* means *past a stated
 * threshold* and not *unusual for this connection*: a rolling baseline would be state, one
 * instance of this class serves every workspace, and a threshold nobody can read is worse than
 * a number written down.
 *
 * The auto-retry is bounded **twice**, and the two bounds interact deliberately:
 *
 *   * {@link COPILOT_VALIDATE_ATTEMPTS} — at most two token checks per `validate`. One retry
 *     converts the transient `503` that a load balancer answers while a node is rotating;
 *     more than one is a client hammering a struggling upstream, which is how a status
 *     indicator becomes a denial-of-service contribution.
 *   * {@link COPILOT_VALIDATE_BUDGET_MS} — the whole call, retry included, must fit. So an
 *     attempt that failed *fast* leaves room for a second, and an attempt that failed
 *     *slowly* has by definition already spent it. That is why the retry is in practice for
 *     the transient refusal: it is the case a retry can actually convert, and doubling
 *     somebody's wait to re-ask a server that is merely slow converts nothing.
 *
 * A `401` and a closed socket are not retried at all — the taxonomy already says so, and the
 * retry condition is *the class is `upstream`* rather than a list this file keeps.
 *
 * ---------------------------------------------------------------------------
 * **The organization is interpolated into a URL, so it is validated before it gets there.**
 *
 * {@link COPILOT_ORGANIZATION_PATTERN} is in the schema, which is what AE.5 validates a form
 * against — and {@link GITHUB_LOGIN_PATTERN} is re-checked here, because a schema annotation is
 * a rendering hint and this is a path segment. A login cannot contain `/`, `.` or `%`, so there is no `..` to traverse with
 * and no query to smuggle; {@link billingUrl} still encodes it, which is the belt to that
 * braces. A value that is not a login is a `config` failure with an actionable sentence rather
 * than a silently-skipped lookup, because *the seat count never appeared* is not a thing an
 * operator can debug.
 *
 * ---------------------------------------------------------------------------
 * **Where the credential is, and where it is not.** It arrives as a parameter, opened by the
 * caller for the length of one call. This class stores none and **logs nothing at all** —
 * there is no logger in the file, which is the only version of *never logged* that stays true
 * after somebody adds a debug line in a hurry. No response body reaches a `detail`: a refusal's
 * is cancelled unread, and the billing response is read for one integer.
 *
 * **A plain `fetch`, for `anthropic.adapter.ts`'s reason.** Node 24's global `fetch` *is*
 * undici, the client the ticket's technical stack names, and two `GET`s against a REST API
 * are not what an SDK would be buying.
 */

import { setTimeout as pause } from "node:timers/promises";

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
import { readSeatCount, withSeats } from "../provider.entitlements";
import {
  ProviderAdapterError,
  classifyHttpStatus,
  describeHttpRefusal,
  describeTransportFailure,
} from "../provider.errors";

/**
 * The property the GitHub token is submitted under.
 *
 * `token` rather than `apiKey`, because that is what GitHub calls it and what mockup 07's row
 * holds — `ghu_••••••••••••7Kd2`, a GitHub App user-to-server token. There is no reserved name
 * for a credential the way `BASE_URL_FIELD` reserves one for an address: the
 * `x-ouroboros-secret` annotation is what identifies it, so `provider.forms.ts` finds this
 * field without knowing the word `token`.
 */
export const COPILOT_TOKEN_FIELD = "token";

/** What the token row's `<label>` says — mockup 07's **GitHub token**. */
export const COPILOT_TOKEN_TITLE = "GitHub token";

/** The property the billing organization is submitted under. */
export const COPILOT_ORGANIZATION_FIELD = "organization";

/** What the organization row's `<label>` says. */
export const COPILOT_ORGANIZATION_TITLE = "GitHub organization";

/**
 * What a GitHub login may be, in JSON Schema's (ECMA-262) syntax.
 *
 * Alphanumerics and single hyphens, neither leading nor trailing, at most 39 characters —
 * GitHub's own rule. It is what {@link ORGANIZATION_EXPRESSION} compiles and what
 * {@link resolveOrganization} tests a supplied value against, because the value reaches a URL
 * path and a form annotation is not a check.
 */
export const GITHUB_LOGIN_PATTERN = "^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$";

/**
 * What the *form's* organization row accepts: a login, or nothing at all.
 *
 * The blank alternation is the row being optional, taken seriously. An untouched optional
 * input submits an empty string rather than nothing, and `partitionSubmission` stores what the
 * form sent — so a pattern that only matched a login would fail an add-form on a field nobody
 * filled in. It is the same trap `openai-compatible.adapter.ts` avoids by declaring no
 * `minLength` on its optional key row.
 *
 * The server-side check is deliberately the strict one: {@link resolveOrganization} treats a
 * blank as *no organization* before it tests anything, so a blank never reaches the expression
 * and never reaches a URL.
 */
export const COPILOT_ORGANIZATION_PATTERN = `^$|${GITHUB_LOGIN_PATTERN}`;

/** {@link GITHUB_LOGIN_PATTERN}, compiled. */
const ORGANIZATION_EXPRESSION = new RegExp(GITHUB_LOGIN_PATTERN);

/** The longest a GitHub login can be, which is what the form's `maxLength` says. */
export const GITHUB_LOGIN_MAX_LENGTH = 39;

/**
 * Where GitHub's REST API is.
 *
 * Fixed, and there is no field by which a caller could change it: this adapter talks to one
 * host, so it owns no address policy — that is `provider.address.ts`, for the two adapters
 * that take an address from a person.
 */
export const GITHUB_API_BASE_URL = "https://api.github.com";

/**
 * The API version every request declares.
 *
 * GitHub's dated versioning: a request without it is served by whatever is current, and the
 * shape of `seat_breakdown` is exactly the kind of thing that moves when that happens.
 */
export const GITHUB_API_VERSION = "2022-11-28";

/** The route that answers *is this token any good* — the cheapest authenticated `GET` there is. */
export const GITHUB_USER_PATH = "/user";

/**
 * How long one call waits before it is a timeout.
 *
 * Ten seconds, the same as the other adapters', and for the same reason: this call is
 * user-initiated — somebody pressed **Test connection** and is watching a spinner — so the
 * health sweep's five (`provider-health/cadence.ts`) would be this service's impatience
 * rendered as a provider's fault.
 */
export const COPILOT_TIMEOUT_MS = 10_000;

/**
 * Past which an answered call is reported as a degraded upstream.
 *
 * Half the deadline. `api.github.com/user` answers in a few hundred milliseconds; a token
 * check that took five seconds is a provider in trouble, and the mockup's `degraded upstream`
 * pill is the honest thing to draw for it. See this file's header on why the threshold is a
 * stated number rather than a baseline this class remembers.
 */
export const COPILOT_SLOW_MS = 5_000;

/**
 * How many token checks one `validate` will make. The first bound on the auto-retry.
 *
 * Two: the original and one retry. See this file's header for why more is a client hammering
 * a struggling upstream rather than a client being thorough.
 */
export const COPILOT_VALIDATE_ATTEMPTS = 2;

/**
 * How long to wait before the retry, in milliseconds.
 *
 * Long enough that the second request is not part of the same burst as the first, short
 * enough that nobody watching the spinner notices it. A back-off schedule would be a bigger
 * mechanism than one retry needs.
 */
export const COPILOT_RETRY_BACKOFF_MS = 250;

/**
 * How long the whole of `validate` may take, retry included. The second bound.
 *
 * Fifteen seconds — one full-deadline attempt plus room for a fast failure ahead of it. It is
 * what makes {@link hasRetryBudget} refuse a second attempt after a slow first one, which is
 * the interaction this file's header describes: the retry is for the failure that came back
 * fast, because that is the one a retry can convert.
 */
export const COPILOT_VALIDATE_BUDGET_MS = 15_000;

/** The model id mockup 07's `GH` card draws a chip for, as GitHub spells it. */
export const COPILOT_MODEL_ID = "gpt-5-codex";

/** What that chip prints — mockup 07's `copilot/gpt-5-codex`, verbatim. */
export const COPILOT_MODEL_DISPLAY = "copilot/gpt-5-codex";

/** The context window Copilot publishes for that model, in tokens. */
export const COPILOT_MODEL_CONTEXT_TOKENS = 128_000;

/**
 * The models this connection can reach — declared, because there is nothing to discover.
 *
 * Every field has a source. The id is GitHub's own spelling, which is what
 * `model_aliases.model` and `model_prices.match_model` are written against; the display is
 * mockup 07's chip; the context length is what Copilot publishes for the model. `sizeBytes` is
 * null because a hosted model has no on-disk size, and `tier` is null because Copilot
 * publishes no entitlement signal *per model* — the entitlement it does publish is the seat
 * count, and that belongs to the connection rather than to a chip.
 *
 * These are the same values `R__dev_seed_providers.sql` writes for the seeded Copilot
 * connection — `model_id`, `display`, `meta.context_tokens` — so a seeded stack and a real
 * connection produce one catalog rather than two that look alike.
 */
export const COPILOT_CATALOG: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: COPILOT_MODEL_ID,
    display: COPILOT_MODEL_DISPLAY,
    contextLength: COPILOT_MODEL_CONTEXT_TOKENS,
    sizeBytes: null,
    tier: null,
  }),
]);

/**
 * The add-form for mockup 07's Copilot card: a masked token row, the org it bills through, and
 * the card's second line.
 *
 * A module constant rather than a literal inside `configSchema()` so it can be asserted
 * against `card.shapes.fixture.ts` directly. {@link CopilotAdapter.configSchema} still hands
 * out a **copy** — the caller is AE.5, holding the value while somebody fills in a form, and
 * an adapter handing out its own object would have that form's edits land here.
 *
 * The order is the order the form renders in: the credential first, because it is the only
 * required row and the one the card is about.
 */
const COPILOT_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect GitHub Copilot",
  properties: {
    [COPILOT_TOKEN_FIELD]: {
      type: "string",
      title: COPILOT_TOKEN_TITLE,
      description: "Billed to the organization. Seats are read back when the token is tested.",
      minLength: 1,
      [SECRET_ANNOTATION]: true,
      [PLACEHOLDER_ANNOTATION]: "ghu_…",
    },
    [COPILOT_ORGANIZATION_FIELD]: {
      type: "string",
      title: COPILOT_ORGANIZATION_TITLE,
      description:
        "The org Copilot is billed through. Seat counts are read back only when this is set " +
        "and the token may see the org's billing.",
      // Optional, and the seat suffix is what is lost by leaving it blank — never the
      // connection. A Copilot token is perfectly usable by somebody who is not an
      // administrator of the organization paying for it, which is why there is no `minLength`
      // and why the pattern admits a blank.
      maxLength: GITHUB_LOGIN_MAX_LENGTH,
      pattern: COPILOT_ORGANIZATION_PATTERN,
      [PLACEHOLDER_ANNOTATION]: "acme-robotics",
    },
    [CAPABILITY_NOTE_FIELD]: {
      type: "string",
      title: "Capability note",
      description: "The card's second line — what this connection is, in your own words.",
      maxLength: CAPABILITY_NOTE_MAX_LENGTH,
      [PLACEHOLDER_ANNOTATION]: "billed through GitHub org acme-robotics",
    },
  },
  required: [COPILOT_TOKEN_FIELD],
  additionalProperties: false,
};

/** A configured organization, or the reason there is no usable one. */
export type CopilotOrganization =
  | {
      readonly ok: true;
      /**
       * The login to ask GitHub about, or null when the field was left blank — which is the
       * ordinary state of a connection whose owner is not an org administrator, and not an
       * error.
       */
      readonly login: string | null;
    }
  | {
      readonly ok: false;
      /** Why not — a `config` failure's `detail`. */
      readonly violation: string;
    };

/**
 * The organization this connection bills through, if it named a usable one.
 *
 * @param config - The connection's settings.
 * @returns The login, `null` for a blank field, or a violation for a value that is not a
 *   GitHub login. A violation rather than a silent skip: somebody typed in that box, and *the
 *   seat count never appeared* is not something an operator can debug.
 */
export function resolveOrganization(config: ProviderConnectionConfig): CopilotOrganization {
  const supplied = (config[COPILOT_ORGANIZATION_FIELD] ?? "").trim();

  if (supplied.length === 0) {
    return { ok: true, login: null };
  }

  if (!ORGANIZATION_EXPRESSION.test(supplied)) {
    // The value itself is deliberately not echoed. It is not a credential, but a `detail` is
    // rendered on a page and quoting back whatever somebody pasted is a habit that eventually
    // quotes the wrong field.
    return {
      ok: false,
      violation: `${COPILOT_ORGANIZATION_TITLE} is not a GitHub login`,
    };
  }

  return { ok: true, login: supplied };
}

/**
 * Where the token check lives.
 *
 * @returns The absolute URL. Built from {@link GITHUB_API_BASE_URL} rather than from anything
 *   a caller supplied — this adapter has no address field, so there is no path by which a
 *   request could be sent somewhere else.
 */
export function userUrl(): string {
  return `${GITHUB_API_BASE_URL}${GITHUB_USER_PATH}`;
}

/**
 * Where one organization's Copilot billing lives.
 *
 * @param login - The organization, already through {@link resolveOrganization}.
 * @returns The absolute URL. The login is encoded as well as validated: the pattern is what
 *   makes traversal impossible and this is what makes it impossible twice.
 */
export function billingUrl(login: string): string {
  return `${GITHUB_API_BASE_URL}/orgs/${encodeURIComponent(login)}/copilot/billing`;
}

/**
 * The headers one request carries.
 *
 * A function rather than a template with the token spliced into it, which is the habit
 * `provider-health/checks.ts` sets: the plaintext exists as an argument for the length of one
 * call rather than as a string something might later log or retain.
 *
 * @param token - The opened credential.
 * @returns The headers.
 */
function requestHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

/**
 * How every request this adapter makes is configured.
 *
 * One function, so the two calls cannot come to disagree about the deadline. A fresh
 * `AbortSignal` per call, which is what makes a retry a new deadline rather than a share of
 * the first one's.
 *
 * @param token - The opened credential.
 * @returns The init.
 */
function requestInit(token: string): RequestInit {
  return {
    // Stated rather than defaulted. The default *is* GET, and writing it here is what puts
    // "this adapter cannot send a completion" on the one line that could ever break it.
    method: "GET",
    headers: requestHeaders(token),
    signal: AbortSignal.timeout(COPILOT_TIMEOUT_MS),
  };
}

/**
 * How a call that answered too slowly reads on the card foot.
 *
 * Names the measurement rather than the threshold: an operator reading `slow upstream
 * (6210 ms)` can tell how bad it was, and a sentence quoting the threshold would say the same
 * thing about every slow call there has ever been.
 *
 * @param latencyMs - What was measured.
 * @returns The phrase — which `validationNote` renders as `slow upstream (6210 ms) · retrying`.
 */
export function describeSlowUpstream(latencyMs: number): string {
  return `slow upstream (${latencyMs.toString()} ms)`;
}

/**
 * Whether an answered call was slow enough to be reported as degraded.
 *
 * @param latencyMs - The measured round trip.
 * @returns `true` past {@link COPILOT_SLOW_MS}. A separate function because it is the whole of
 *   *what counts as an outlier*, and a rule worth stating is a rule worth testing on its own.
 */
export function isLatencyOutlier(latencyMs: number): boolean {
  return latencyMs > COPILOT_SLOW_MS;
}

/**
 * Whether the failure just seen is the one the auto-retry exists for.
 *
 * The condition is *the taxonomy said `upstream`*, which is what makes the `503` and the
 * latency outlier one case rather than two — and what keeps a `401` and a closed socket out of
 * it without this file keeping a list.
 *
 * @param validation - What the attempt found.
 * @returns `true` for an `upstream` failure.
 */
export function isDegraded(validation: ProviderValidation): boolean {
  return validation.status === "failed" && validation.errorClass === "upstream";
}

/**
 * Whether there is room in the budget for another attempt.
 *
 * @param spentMs - How long `validate` has taken so far — the attempts it has made plus the
 *   back-offs it has waited.
 * @returns `true` when another back-off *and* another full-deadline attempt still fit inside
 *   {@link COPILOT_VALIDATE_BUDGET_MS}. The next attempt is charged at its deadline rather
 *   than at what it will probably take, because a bound that assumes the good case is not a
 *   bound.
 */
export function hasRetryBudget(spentMs: number): boolean {
  return spentMs + COPILOT_RETRY_BACKOFF_MS + COPILOT_TIMEOUT_MS <= COPILOT_VALIDATE_BUDGET_MS;
}

/** One token check, and what it cost. */
interface TokenProbe {
  /** What the attempt found. */
  readonly validation: ProviderValidation;
  /**
   * How long it took, measured on every branch including the failing ones.
   *
   * Not the same number as {@link ProviderValidationOk.latencyMs}, which exists only on a
   * success because a timeout's "latency" is the deadline and a refusal's is how fast the
   * refusal came. This one is spent time, and it is what the budget is counted in.
   */
  readonly elapsedMs: number;
}

/**
 * The fields the schema requires that nothing has supplied.
 *
 * Derived from the schema rather than written out, which is the habit
 * `docs/MODEL_PROVIDERS.md` asks an author to copy — **check the configuration before opening
 * a socket**, because a connection with no token is not a provider being down and reporting it
 * as `network` sends somebody to check a firewall.
 *
 * @param config - The settings, without the credential.
 * @param secret - The credential, or null.
 * @returns The **titles** of the missing fields, because the sentence is printed on a card
 *   foot — `token required` is a field name leaking into a page.
 */
export function missingConfiguration(
  config: ProviderConnectionConfig,
  secret: string | null,
): string[] {
  return COPILOT_CONFIG_SCHEMA.required
    .filter((name) =>
      COPILOT_CONFIG_SCHEMA.properties[name][SECRET_ANNOTATION] === true
        ? (secret ?? "").length === 0
        : (config[name] ?? "").length === 0,
    )
    .map((name) => COPILOT_CONFIG_SCHEMA.properties[name].title);
}

/**
 * The seat count for one organization, or null.
 *
 * **Never throws and never fails a validation.** Every branch that is not *GitHub published a
 * count* answers `null`, which renders as no seat suffix at all — decision **P8**, and this
 * file's header on why a supplementary lookup must not be able to break a good connection.
 *
 * @param token - The opened credential, already accepted by the token check.
 * @param login - The organization, already through {@link resolveOrganization}.
 * @returns The count GitHub published, or null when it published none this could read.
 */
async function readSeats(token: string, login: string): Promise<number | null> {
  let response: Response;

  try {
    response = await fetch(billingUrl(login), requestInit(token));
  } catch {
    // A supplement that could not be fetched is no seat data. The token check has already
    // succeeded, so this says nothing about the connection.
    return null;
  }

  if (!response.ok) {
    // `403` — a token without `manage_billing:copilot`. `404` — an organization this token
    // cannot see, or one with no Copilot subscription. `5xx` — GitHub having a moment. All of
    // them are *no seat count*, and none of them is a bad credential. The body is cancelled
    // unread for every other refusal's reason.
    await discardBody(response);

    return null;
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) {
    return null;
  }

  const breakdown = (body as Record<string, unknown>).seat_breakdown;

  if (typeof breakdown !== "object" || breakdown === null) {
    // A billing response with no `seat_breakdown` is the shape an organization on a plan that
    // does not report seats answers with. It is the fixture the acceptance criterion names:
    // the cap line renders without a seat suffix rather than with a guessed one.
    return null;
  }

  return readSeatCount((breakdown as Record<string, unknown>).total);
}

/**
 * The GitHub Copilot adapter.
 *
 * `@Injectable()` because `providers.module.ts` registers the class and Nest constructs it. It
 * takes no dependencies and holds no state — one instance serves every workspace, which is
 * only safe because nothing about a connection is remembered between calls. That is also why
 * the latency threshold is a constant rather than a baseline: a baseline would be the state
 * this class does not have.
 */
@Injectable()
export class CopilotAdapter implements ModelProviderAdapter {
  /** V015's `provider_connections.kind` for this provider, and the registry's key. */
  readonly kind = "copilot" as const;

  /**
   * The add-form: a masked token row, the billing org, and the card's second line.
   *
   * @returns A fresh deep copy every call, so a caller holding it while somebody fills in a
   *   form cannot mutate the adapter's own value. The conformance kit tries exactly that.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(COPILOT_CONFIG_SCHEMA)) as ProviderConfigSchema;
  }

  /**
   * What this adapter can do.
   *
   * `discovery` is `false` — the catalog is declared, so a refresh affordance would spin over
   * a constant. `pull` is `false`: nothing pulls a hosted model onto a machine.
   * `entitlements` is **`true`**, and this is the adapter AC.1 named as the one that sets it:
   * {@link validate}'s `detail` really does report what the credential is entitled to, when
   * GitHub says. `invocation` is AF.2's
   * ([#235](https://github.com/NobuData/ouroboros/issues/235)) reservation.
   *
   * @returns All four flags, freshly built and equal on every call.
   */
  capabilities(): ProviderCapabilities {
    return { discovery: false, pull: false, entitlements: true, invocation: false };
  }

  /**
   * The **Test connection** button: is this token any good, how fast did we find out, and what
   * is it entitled to.
   *
   * A `GET /user` — the cheapest call that still needs the credential to be honoured. Nothing
   * here sends a completion; there is no parameter by which it could.
   *
   * @param config - The settings, as `partitionSubmission` produced them.
   * @param secret - The opened credential, or null when the add-form's token row was left
   *   blank.
   * @returns What the check found. `{status: "ok", latencyMs, detail: "200 · 4 seats"}` when
   *   GitHub published a seat count and `"200"` when it did not, which the card foot renders
   *   as `✓ 200 · 38ms`. **Never rejects**: a refusal, a timeout, a closed socket and a
   *   nonsense body are all results, because a provider being down is the state the card
   *   exists to draw. The latency is the last attempt's, which is the round trip the answer
   *   actually came from.
   */
  async validate(
    config: ProviderConnectionConfig,
    secret: string | null,
  ): Promise<ProviderValidation> {
    const missing = missingConfiguration(config, secret);

    // The `secret === null` half is what narrows the type for the calls below; `missing` is
    // what says *which* fields, and for this schema the two are the same fact.
    if (secret === null || missing.length > 0) {
      return { status: "failed", errorClass: "config", detail: `${missing.join(", ")} required` };
    }

    const organization = resolveOrganization(config);

    if (!organization.ok) {
      // Found before any socket exists: a value that is not a login is a field somebody can
      // correct, and no retry fixes it.
      return { status: "failed", errorClass: "config", detail: organization.violation };
    }

    let probe = await this.checkToken(secret);
    let spentMs = probe.elapsedMs;

    for (let attempt = 2; attempt <= COPILOT_VALIDATE_ATTEMPTS; attempt += 1) {
      if (!isDegraded(probe.validation) || !hasRetryBudget(spentMs)) {
        break;
      }

      await pause(COPILOT_RETRY_BACKOFF_MS);
      spentMs += COPILOT_RETRY_BACKOFF_MS;
      probe = await this.checkToken(secret);
      spentMs += probe.elapsedMs;
    }

    const validation = probe.validation;

    if (validation.status !== "ok") {
      return validation;
    }

    const seats = organization.login === null ? null : await readSeats(secret, organization.login);

    return { ...validation, detail: withSeats(validation.detail, seats) };
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
   * The organization is deliberately **not** checked here: the catalog does not depend on it,
   * and failing a discovery over a field discovery never reads would be inventing a
   * dependency. {@link validate} is where a malformed one is reported.
   *
   * @param connection - The saved connection, opened by its caller.
   * @returns The catalog, as fresh objects — a caller that sorted the answer in place must not
   *   be sorting this module's own constant.
   * @throws {ProviderAdapterError} `config` when the connection has no credential. A
   *   connection nobody has finished configuring reaches no models, and answering a catalog
   *   for one would put chips on a card that cannot be used. There is no `async` here because
   *   there is nothing to await; the failure is a rejection rather than a synchronous throw,
   *   which is what `@throws` means on a member that answers a promise.
   */
  discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    const missing = missingConfiguration(connection.config, connection.secret);

    if (connection.secret === null || missing.length > 0) {
      return Promise.reject(new ProviderAdapterError("config", `${missing.join(", ")} required`));
    }

    return Promise.resolve(COPILOT_CATALOG.map((model) => ({ ...model })));
  }

  /**
   * One token check.
   *
   * @param token - The opened credential.
   * @returns What it found, and what it cost. Never rejects — every branch is a result, which
   *   is what lets the retry loop above read as a loop rather than as a `try`.
   */
  private async checkToken(token: string): Promise<TokenProbe> {
    const started = performance.now();
    let response: Response;

    try {
      response = await fetch(userUrl(), requestInit(token));
    } catch (error) {
      // Nothing answered. Says nothing about the credential, and deliberately does not.
      return {
        validation: {
          status: "failed",
          errorClass: "network",
          detail: describeTransportFailure(error, COPILOT_TIMEOUT_MS),
        },
        elapsedMs: elapsedSince(started),
      };
    }

    // Measured before the body is dealt with, because the round trip is what the card prints
    // and the tidying up afterwards is this service's own time.
    const latencyMs = elapsedSince(started);

    // The body of a refusal is never read: it is the vendor's error object, and a proxy in
    // front of it answers with a page that quotes the request headers — one of which is the
    // token. Nothing is read on the success path either; the question was the status.
    await discardBody(response);

    if (!response.ok) {
      return {
        validation: {
          status: "failed",
          errorClass: classifyHttpStatus(response.status),
          detail: describeHttpRefusal(response.status),
        },
        elapsedMs: latencyMs,
      };
    }

    if (isLatencyOutlier(latencyMs)) {
      // It answered, and what it answered arrived far too late to call the connection healthy.
      // The class is the same one a `503` gets, so the pill and the note are the same two the
      // mockup draws — which is the whole point of routing this through the taxonomy.
      return {
        validation: {
          status: "failed",
          errorClass: "upstream",
          detail: describeSlowUpstream(latencyMs),
        },
        elapsedMs: latencyMs,
      };
    }

    return {
      validation: { status: "ok", latencyMs, detail: response.status.toString() },
      elapsedMs: latencyMs,
    };
  }
}

/**
 * Whole milliseconds since a `performance.now()` reading, never negative.
 *
 * @param started - The reading taken before the call.
 * @returns The elapsed time.
 */
function elapsedSince(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
