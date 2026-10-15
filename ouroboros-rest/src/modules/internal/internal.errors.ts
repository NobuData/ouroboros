/**
 * Every code the engine-facing surface can answer with, and the errors that carry them.
 *
 * The same arrangement as `auth.errors.ts` and `pricing.errors.ts`, for the same reason: a
 * code is only meaningful beside the operation that produces it, the specification is where
 * the two are published together — `openapi.internal.yaml` here rather than `openapi.yaml`
 * — and this file is what makes the string in the document and the string in the answer one
 * constant instead of two.
 *
 * Two of them are the policy this ticket exists to enforce, and the difference between them
 * is worth reading before either is used:
 *
 *   * {@link INTERNAL_ERRORS.providerNotLeasable} is a **decision**. Nothing about the
 *     request is wrong and no state would make it succeed; the control plane will not hand
 *     over a cloud provider's connection details, today or after any amount of
 *     configuration. It is a `403` because the caller is fully authenticated and is asking
 *     for something it may not have.
 *   * {@link INTERNAL_ERRORS.localProviderNotConfigured} is an **absence**. The kind is one
 *     this service will happily lease and this deployment has not said where it is, which an
 *     operator fixes by setting `OURO_LOCAL_PROVIDER_URLS`. A `403` here would tell a worker
 *     that a provider it may legitimately use is forbidden.
 *
 * Conflating the two would be the kind of error taxonomy that survives review and then
 * costs a day: an executor retrying a `403` forever, or an operator reading *forbidden* and
 * going looking for a permission that does not exist.
 */

import {
  ForbiddenError,
  NotFoundError,
  InvalidRequestError,
  UnauthenticatedError,
} from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `internal.errors.spec.ts` can
 * hold the internal specification's copy to these.
 */
export const INTERNAL_ERRORS = {
  /**
   * The request did not carry the internal key, or carried the wrong one.
   *
   * The same string the browser boundary answers with (`auth.errors.ts`), deliberately: a
   * client's `switch (error.code)` should not have to learn a second word for *you are not
   * who you would have to be*. What differs is the message, because "sign in to continue"
   * is advice a worker process cannot act on.
   */
  unauthenticated: "unauthenticated",

  /** This provider kind is proxied, never leased — decision **P3**. */
  providerNotLeasable: "provider_not_leasable",

  /** A leasable kind this deployment has not been told the address of. */
  localProviderNotConfigured: "local_provider_not_configured",

  /** No such run, so there is nothing to scope a lease to. */
  runNotFound: "run_not_found",

  /** The proxy is specified and not yet built — AF.2. */
  invokeTargetInvalid: "invoke_target_invalid",
  aliasNotFound: "alias_not_found",
  aliasUnavailable: "alias_unavailable",
  connectionNotFound: "connection_not_found",
  invokeModelRequired: "invoke_model_required",
} as const;

/** One of {@link INTERNAL_ERRORS}' values. */
export type InternalErrorCode = (typeof INTERNAL_ERRORS)[keyof typeof INTERNAL_ERRORS];

/**
 * What every rejection at this boundary says.
 *
 * Constant, so it cannot vary with the request that earned it: no path, no header name, no
 * "did you mean". It is written the way `ouroboros-engine`'s `InternalKeyMiddleware` writes
 * its own — the two sides of one boundary should refuse in the same voice — and what an
 * operator needs is in the log line instead, which stays inside the cluster.
 */
export const UNAUTHORIZED_MESSAGE = "Unauthorized.";

/**
 * `401` — this request did not prove it came from inside.
 *
 * @returns The error to throw. It carries no details for the same reason the message is a
 *   constant: the only thing a caller could learn from a fuller answer is which part of
 *   their guess was right.
 */
export function internalUnauthenticated(): UnauthenticatedError {
  return new UnauthenticatedError(INTERNAL_ERRORS.unauthenticated, UNAUTHORIZED_MESSAGE);
}

/**
 * `403` — this provider's credentials never leave the control plane.
 *
 * @param provider - The kind that was asked for. Echoed because the caller sent it and a
 *   worker looping over a chain needs to know which hop was refused; it is a kind, not a
 *   connection, so it identifies nothing belonging to a workspace.
 * @returns The error to throw.
 */
export function providerNotLeasable(provider: string): ForbiddenError {
  return new ForbiddenError(
    INTERNAL_ERRORS.providerNotLeasable,
    "This provider is reached through the invocation proxy; its credentials never leave " +
      "the control plane. Call POST /internal/llm/invoke instead.",
    { provider },
  );
}

/**
 * `404` — nobody has told this deployment where that provider is.
 *
 * @param provider - The leasable kind that was asked for.
 * @returns The error to throw. The message names the variable an operator sets, because
 *   this failure is always a deployment's rather than a caller's.
 */
export function localProviderNotConfigured(provider: string): NotFoundError {
  return new NotFoundError(
    INTERNAL_ERRORS.localProviderNotConfigured,
    "This deployment has no local provider of that kind. Set OURO_LOCAL_PROVIDER_URLS to " +
      "declare one.",
    { provider },
  );
}

/**
 * `404` — there is no such run to scope a lease to.
 *
 * @param run - The run id that was asked for.
 * @returns The error to throw.
 */
export function runNotFound(run: string): NotFoundError {
  return new NotFoundError(
    INTERNAL_ERRORS.runNotFound,
    "No such run. A lease is scoped to the run it is for.",
    { run },
  );
}

/**
 * An invocation that names neither or both of `connection` and `alias`.
 *
 * @returns `422 invoke_target_invalid`.
 */
export function invokeTargetInvalid(): InvalidRequestError {
  return new InvalidRequestError(
    INTERNAL_ERRORS.invokeTargetInvalid,
    "Name exactly one of connection or alias: a connection is this provider, an alias is " +
      "whatever routing resolves it to.",
  );
}

/**
 * The run an invocation is attributed to does not exist.
 *
 * Shares `run_not_found` with the lease, but not its sentence: an invocation may be made for
 * a run, a Copilot session, a dry run or an investigation.
 *
 * @param run - The id the worker sent.
 * @returns `404 run_not_found`.
 */
export function invokeRunNotFound(run: string): NotFoundError {
  return new NotFoundError(
    INTERNAL_ERRORS.runNotFound,
    "No run, Copilot session, dry run or investigation has that id. Every invocation is " +
      "attributed to one.",
    { run },
  );
}

/**
 * The alias names nothing in the run's workspace.
 *
 * @param alias - The alias the worker sent.
 * @returns `404 alias_not_found`.
 */
export function aliasNotFound(alias: string): NotFoundError {
  return new NotFoundError(
    INTERNAL_ERRORS.aliasNotFound,
    "No such model alias in this workspace.",
    {
      alias,
    },
  );
}

/**
 * The alias exists but cannot be called: disabled, or bound to no connection.
 *
 * @param alias - The alias the worker sent.
 * @returns `422 alias_unavailable`.
 */
export function aliasUnavailable(alias: string): InvalidRequestError {
  return new InvalidRequestError(
    INTERNAL_ERRORS.aliasUnavailable,
    "This model alias is disabled or bound to no provider connection.",
    { alias },
  );
}

/**
 * The connection names nothing in the run's workspace.
 *
 * @param connection - The connection id the worker sent.
 * @returns `404 connection_not_found`.
 */
export function invokeConnectionNotFound(connection: string): NotFoundError {
  return new NotFoundError(
    INTERNAL_ERRORS.connectionNotFound,
    "No such provider connection in this workspace.",
    { connection },
  );
}

/**
 * A call to a named connection with no `payload.model`.
 *
 * An alias carries its model; a connection does not, so the payload has to.
 *
 * @returns `422 invoke_model_required`.
 */
export function invokeModelRequired(): InvalidRequestError {
  return new InvalidRequestError(
    INTERNAL_ERRORS.invokeModelRequired,
    "A call to a named connection must say which model in payload.model.",
  );
}
