/**
 * Every code the credential lifecycle can answer with, and the errors that carry them.
 *
 * The same shape and the same argument as `pricing/pricing.errors.ts` and
 * `registry/registry.errors.ts`: a code is only meaningful beside the operation that
 * produces it, `openapi.yaml` is where the two are published together, and this file exists
 * so the string in the specification and the string in the answer come from one constant.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)), roadmap decision **P4**.
 *
 * ---------------------------------------------------------------------------
 * **Two refusals this module deliberately does not own.**
 *
 * A kind with no adapter in this build is `provider_kind_unsupported`, and it is
 * `providers/provider.registry.ts`'s — thrown by `ModelProviderRegistry.get`, which is the
 * one place that knows what is registered. A connection with aliases resolving on it is
 * `provider_connection_in_use`, and it is `registry/registry.errors.ts`'s — written there
 * by Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189)) *for* this ticket, with
 * both directions covered: the pre-flight message and the recogniser for the race the
 * pre-flight cannot close. Re-spelling either here would be two vocabularies for one rule.
 *
 * ---------------------------------------------------------------------------
 * **Why the step-up refusal is a `401` and not a `403`.**
 *
 * `error.envelope.ts` draws the line at *who is asking* versus *what they asked for*, and a
 * step-up sits exactly on it: the caller is signed in, holds `owner` or `admin`, and would
 * be allowed to reveal — what is missing is a *recent* proof that the browser holding the
 * session is still the person it belongs to. The action is *authenticate again*, which is
 * what `401` means and what `403` says will not help. The same reasoning is why the answer
 * carries the methods that would satisfy it: a challenge a client cannot answer is a
 * refusal wearing a challenge's status.
 */

import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  NotImplementedError,
  TooManyRequestsError,
  UnauthenticatedError,
  UpstreamError,
} from "../errors/error.envelope";
import type { ProviderValidationFailure } from "../providers/provider.adapter";
import type { ProviderAdapterError } from "../providers/provider.errors";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `provider-connections.errors.spec.ts`
 * can hold the specification's copy to these.
 */
export const PROVIDER_CONNECTION_ERRORS = {
  /** `404` — this workspace has no connection with that id. */
  notFound: "provider_connection_not_found",
  /** `422` — the submitted configuration does not satisfy the adapter's own schema. */
  configInvalid: "provider_config_invalid",
  /** `501` — the configuration is valid and this build has nowhere to keep part of it. */
  configNotStorable: "provider_config_not_storable",
  /** `422` — the provider itself refused the configuration or the credential. */
  validationFailed: "provider_validation_failed",
  /** `409` — there is no credential on this connection to reveal or rotate. */
  credentialAbsent: "provider_credential_absent",
  /** `409` — something rewrote the connection between the validation and the swap. */
  connectionChanged: "provider_connection_changed",
  /** `401` — reveal needs a recent re-authentication, and there is not one. */
  stepUpRequired: "step_up_required",
  /** `429` — too many reveal attempts, by this person or against this connection. */
  revealRateLimited: "provider_reveal_rate_limited",
  /** `502` — the provider did not answer its models list, so the catalog is unchanged. */
  discoveryFailed: "provider_discovery_failed",
} as const;

/** One of {@link PROVIDER_CONNECTION_ERRORS}' values. */
export type ProviderConnectionErrorCode =
  (typeof PROVIDER_CONNECTION_ERRORS)[keyof typeof PROVIDER_CONNECTION_ERRORS];

/**
 * `404` — this workspace has no connection with that id.
 *
 * A `404` and never a `403`, including for a connection that exists in *another* workspace:
 * `error.envelope.ts` argues the case, and it is sharper here than anywhere else in this
 * API. A `403` would confirm that an id names a real provider connection, and somebody
 * enumerating ids against this endpoint is trying to learn exactly that.
 *
 * @param connectionId - The id that was addressed. Echoed so a client with two requests in
 *   flight can tell which one was refused.
 * @returns The error to throw.
 */
export function connectionNotFound(connectionId: string): NotFoundError {
  return new NotFoundError(
    PROVIDER_CONNECTION_ERRORS.notFound,
    "This workspace has no provider connection with that id.",
    { connectionId },
  );
}

/**
 * `422` — the submitted configuration does not satisfy the adapter's `configSchema()`.
 *
 * Shaped like the validation pipe's own `validation_failed`: `details.fields` maps a field
 * name to the sentences about it, so AE.5
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) renders each one under the input
 * that produced it without knowing which provider it is drawing. A different *code* rather
 * than the pipe's, because the rule that was broken is the adapter's rather than this API's
 * — a client that wants to know whether re-rendering the form from a fresh `configSchema()`
 * would help can tell the two apart.
 *
 * @param fields - Field name to the complaints about it, as
 *   {@link import("./config.validation").configViolations} reported them. Never empty: an
 *   empty map means nothing was wrong, and this error would then be describing a refusal
 *   that did not happen.
 * @returns The error to throw.
 * @throws {RangeError} If `fields` is empty, which is a programming error at the call site.
 */
export function configInvalid(fields: Readonly<Record<string, string[]>>): InvalidRequestError {
  if (Object.keys(fields).length === 0) {
    throw new RangeError("configInvalid needs at least one field to complain about");
  }

  return new InvalidRequestError(
    PROVIDER_CONNECTION_ERRORS.configInvalid,
    "The provider configuration is not valid. See `details.fields` for each field.",
    { fields },
  );
}

/**
 * `501` — the configuration is valid, and this build has nowhere to keep one of its fields.
 *
 * The honest answer to a real gap rather than a silent data loss, and it is worth reading
 * the gap out loud. `provider_connections` (V015, extended by V017) keeps a connection's
 * settings in *columns* — `base_url` and `capability_note`, which is why `provider.config.ts`
 * reserves the two field names `baseUrl` and `capabilityNote` for them. It has no general
 * column for anything else, and one adapter declares a field that is neither: AC.5's Copilot
 * schema offers an optional billing `organization`.
 *
 * Three answers were available and two of them are worse. **Dropping the value** would store
 * a connection that quietly disagrees with what somebody typed, and the disagreement would
 * surface much later as an entitlement line that reads *personal plan* for an org-billed
 * seat. **Adding the column** is a migration, and AD.2's scope is `ouroboros-rest`: schema
 * changes are filed against `ouroboros-db` and numbered in a sequence other open tickets are
 * also claiming from. So the third answer is this one — refuse, name the field, and say why
 * — which is the same choice `provider.registry.ts` makes for a kind with no adapter, and
 * for the same reason: *this build cannot* is a different fact from *you asked wrongly*, and
 * the person who needs to tell them apart is whoever implements the other half.
 *
 * A provider whose unstorable fields are all **optional** is unaffected: Copilot connects
 * without an `organization`, which is the state its own schema calls ordinary.
 *
 * @param kind - The provider kind whose schema declares the fields.
 * @param fields - The submitted field names with nowhere to go, sorted so the message is
 *   stable between calls. Never empty, for {@link configInvalid}'s reason.
 * @returns The error to throw.
 * @throws {RangeError} If `fields` is empty.
 */
export function configNotStorable(kind: string, fields: readonly string[]): NotImplementedError {
  if (fields.length === 0) {
    throw new RangeError("configNotStorable needs at least one field to name");
  }

  return new NotImplementedError(
    PROVIDER_CONNECTION_ERRORS.configNotStorable,
    `This build cannot store ${listOf(fields)} for a ${kind} connection. ` +
      "Leave the field empty and connect without it.",
    { kind, fields: [...fields] },
  );
}

/**
 * `422` — the provider refused the configuration or the credential, so nothing was written.
 *
 * The refusal behind two of this ticket's acceptance criteria — *adding a provider with an
 * invalid key fails without persisting anything*, and *rotate with an invalid new key leaves
 * the old key live and working; the error is designed, not a stack trace*. Both are
 * properties of the **service**, which calls the adapter before it calls the database; what
 * this function contributes is the second half of the second one.
 *
 * `details` carries the taxonomy's class and the adapter's own note — `key rejected (401)`,
 * `503 upstream` — which is exactly what mockup 07's card foot renders, so a form and a card
 * say the same thing about the same failure. Neither ever contains the credential: an
 * adapter's `detail` is asserted against every recorded failure fixture by the conformance
 * kit, which is where that promise is kept.
 *
 * @param failure - What the adapter's live check found.
 * @returns The error to throw.
 */
export function providerValidationFailed(failure: ProviderValidationFailure): InvalidRequestError {
  return new InvalidRequestError(
    PROVIDER_CONNECTION_ERRORS.validationFailed,
    "The provider refused this configuration, so nothing was saved.",
    { errorClass: failure.errorClass, detail: failure.detail },
  );
}

/**
 * `502` — the provider did not answer its models list.
 *
 * A discovery is a request to somebody else's server, and this is what its failure is: not a
 * fault in this service and not a malformed request, but an upstream that did not answer —
 * which is what `502` says, and what makes retrying reasonable. `details` carries the
 * taxonomy's class and the adapter's own phrase, exactly as `provider_validation_failed`
 * does, so a card says the same thing about the same provider whether it was testing or
 * refreshing. Neither ever echoes the provider's body: the conformance kit holds every
 * adapter's `detail` to that.
 *
 * **The catalog is unchanged.** A discovery that failed reported nothing, and a failure that
 * emptied a card's chips would be this service turning *could not read the list* into *the
 * list is empty* — the two facts V017's `models` column comment insists are different.
 *
 * @param failure - What the adapter threw.
 * @returns The error to throw.
 */
export function providerDiscoveryFailed(failure: ProviderAdapterError): UpstreamError {
  return new UpstreamError(
    PROVIDER_CONNECTION_ERRORS.discoveryFailed,
    "The provider did not answer its models list, so the catalog is unchanged.",
    { errorClass: failure.errorClass, detail: failure.detail },
  );
}

/**
 * `409` — there is no credential on this connection.
 *
 * Reveal and rotate both need one. A local provider — an Ollama daemon, an unauthenticated
 * OpenAI-compatible endpoint — is reached without a credential, and V015 makes
 * `credentials_encrypted` nullable precisely so that is a state rather than an unfinished
 * row. So this is not a malformed request and not a missing resource: the connection exists
 * and its state refuses the operation, which is what `409` says.
 *
 * @param connectionId - The connection that was addressed.
 * @returns The error to throw.
 */
export function credentialAbsent(connectionId: string): ConflictError {
  return new ConflictError(
    PROVIDER_CONNECTION_ERRORS.credentialAbsent,
    "This provider connection has no stored credential.",
    { connectionId },
  );
}

/**
 * `409` — the connection changed between the live validation and the swap.
 *
 * The race verify-then-retire cannot close on its own: two administrators rotating the same
 * connection at once, or a rotation landing while the vault's re-encryption sweep re-seals
 * the row. The swap is conditional on the row still holding the envelope the validation was
 * run against — see `provider-connections.repository.ts` — so the loser of that race is told
 * to look again rather than having its new credential silently overwrite a newer one.
 *
 * @param connectionId - The connection that was being rotated.
 * @returns The error to throw.
 */
export function connectionChanged(connectionId: string): ConflictError {
  return new ConflictError(
    PROVIDER_CONNECTION_ERRORS.connectionChanged,
    "This provider connection changed while the new credential was being checked. " +
      "Read it again and retry.",
    { connectionId },
  );
}

/**
 * `401` — reveal needs a recent re-authentication and this request has none.
 *
 * The challenge, and it is a challenge rather than a wall: `details.methods` names what
 * would satisfy it and `details.maxAgeSeconds` says how long a proof counts for, so a client
 * can put the right prompt in front of a person instead of guessing.
 *
 * @param methods - The ways this build accepts a step-up, in the order a client should
 *   prefer them. See `step-up.ts` for what each one means.
 * @param maxAgeSeconds - How long a step-up remains recent.
 * @returns The error to throw.
 */
export function stepUpRequired(
  methods: readonly string[],
  maxAgeSeconds: number,
): UnauthenticatedError {
  return new UnauthenticatedError(
    PROVIDER_CONNECTION_ERRORS.stepUpRequired,
    "Revealing a credential needs a recent re-authentication.",
    { methods: [...methods], maxAgeSeconds },
  );
}

/**
 * `429` — too many reveal attempts.
 *
 * **Every attempt counts, including the ones that failed the step-up.** A limiter that only
 * counted successes would leave the step-up itself unlimited, which is a password oracle
 * with a rate limit in front of the wrong door.
 *
 * @param scope - Which bucket filled — `user` or `connection`. Named because the two have
 *   different remedies: one person waits, or one connection is being hammered by several.
 * @param retryAfterSeconds - How long until the bucket has room, rounded up to a whole
 *   second. Never zero: a refusal that says *retry now* would be inviting the request it
 *   just refused.
 * @returns The error to throw.
 */
export function revealRateLimited(
  scope: "user" | "connection",
  retryAfterSeconds: number,
): TooManyRequestsError {
  return new TooManyRequestsError(
    PROVIDER_CONNECTION_ERRORS.revealRateLimited,
    "Too many reveal attempts. Wait before trying again.",
    { scope, retryAfterSeconds },
  );
}

/**
 * Join names the way a sentence does — `a`, `a and b`, `a, b and c`.
 *
 * Local and unexported, exactly as `registry.errors.ts`'s is: it exists so one message reads
 * like English, and a shared list-formatting helper is a thing this service does not have
 * and does not need. Two copies of four lines is cheaper than a module nobody can name.
 *
 * @param names - At least one name, already in the order they should be read.
 * @returns The names as one clause.
 */
function listOf(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0];
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
