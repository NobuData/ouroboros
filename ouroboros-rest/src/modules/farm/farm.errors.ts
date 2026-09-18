/**
 * How enrollment is refused, and the one rule the whole vocabulary is shaped by.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)).
 *
 * ---------------------------------------------------------------------------
 * **The agent-facing surface has one refusal, and that is deliberate.**
 *
 * `POST /farm/registrations` is reachable without a session — it has to be, because the
 * caller is a machine holding nothing but a token. So every way a token can fail answers
 * {@link enrollmentRefused}: a token that never existed, a token whose secret is wrong, an
 * expired one, a spent one, a revoked one, and one scoped to a different pool. Six states,
 * one answer.
 *
 * Splitting them would be more helpful to an operator and considerably more helpful to
 * somebody spraying tokens at the endpoint. *Expired* tells them the id was real; *spent*
 * tells them they found a live workspace; *wrong pool* tells them a pool name they did not
 * have. The audit trail records which of the six it actually was — that is what
 * `farm.audit.ts` is for — so the information exists where the operator can read it and does
 * not exist where the caller can.
 *
 * The **shape** errors are separate and are `422`, because those are the caller's own
 * mistakes rather than facts about this workspace: a body that is not a certificate request,
 * a key on the wrong curve, a request whose self-signature does not verify. Answering those
 * with the same opaque refusal would leave an agent author unable to tell a broken CSR from a
 * dead token, and neither of them reveals anything.
 *
 * ---------------------------------------------------------------------------
 * **The operator-facing surface answers ordinarily.** Minting, listing and revoking are
 * behind a session and a role, so a `404` there means what it means everywhere else in this
 * API — see `tenancy/roles.guard.ts` on why "you may not" is a `404` and not a `403`.
 */

import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and `farm.errors.spec.ts` holds every one
 * of them to `openapi.yaml` — the document is the registry a client reads, so a code that is
 * not in it is a code nobody can look up.
 */
export const FARM_ERRORS = {
  /** The one agent-facing refusal. Six states behind it; see this file's header. */
  enrollmentRefused: "farm_enrollment_refused",
  /** The certificate request could not be read, or is not the shape this CA signs. */
  invalidCsr: "farm_invalid_csr",
  /** The request asked for the bearer fallback and the workspace does not permit it. */
  fallbackNotPermitted: "farm_bearer_fallback_not_permitted",
  /** A renewal arrived with no client certificate the gateway could read. */
  clientCertificateRequired: "farm_client_certificate_required",
  /** A renewal's client certificate is unknown, expired, superseded or revoked. */
  identityRefused: "farm_identity_refused",
  /** A mint or a revoke named a pool this workspace does not have. */
  poolNotFound: "farm_pool_not_found",
  /** A revoke named a token or a runner this workspace does not have. */
  tokenNotFound: "farm_enrollment_token_not_found",
  /** A revoke named a runner this workspace does not have. */
  runnerNotFound: "farm_runner_not_found",
  /** The runner named has no live certificate to revoke. */
  noLiveCertificate: "farm_no_live_certificate",
  /** A registration used a machine name this workspace already has. */
  runnerNameTaken: "runner_name_taken",
} as const;

/** One of {@link FARM_ERRORS}' values. */
export type FarmErrorCode = (typeof FARM_ERRORS)[keyof typeof FARM_ERRORS];

/**
 * Why an enrollment was refused — for the **audit trail**, never for the response.
 *
 * This is the information the caller does not get and the operator does. It is a separate
 * type from the error precisely so that the two cannot be wired together by accident: there
 * is no constructor below that takes one of these.
 */
export type EnrollmentRefusal =
  "unknown_token" | "bad_secret" | "expired" | "spent" | "revoked" | "pool_mismatch";

/**
 * `401` — the token does not entitle the caller to enrol.
 *
 * `401` rather than `403`, and the difference is real: the caller has presented a credential
 * and it did not authenticate them. A `403` would say *we know who you are and you may not*,
 * which is a claim this endpoint is never in a position to make.
 *
 * **It carries no details at all.** See this file's header.
 *
 * @returns The error.
 */
export function enrollmentRefused(): UnauthenticatedError {
  return new UnauthenticatedError(
    FARM_ERRORS.enrollmentRefused,
    "This enrollment token cannot be used.",
  );
}

/**
 * `422` — the certificate request is not one this CA can sign.
 *
 * @param reason - One sentence from `csr.ts`, for a person writing an agent. It describes the
 *   *request's* shape and never this workspace's state, which is what makes it safe to say
 *   where {@link enrollmentRefused} is not.
 * @returns The error.
 */
export function invalidCsr(reason: string): InvalidRequestError {
  return new InvalidRequestError(FARM_ERRORS.invalidCsr, reason);
}

/**
 * `403` — the workspace has not switched the bearer fallback on.
 *
 * `403` rather than the opaque refusal, because nothing here is secret: the caller has
 * already proved it holds a valid token, and what it is being told is that this workspace
 * requires certificates. An agent behind a certificate-stripping proxy needs to be able to
 * tell that from a dead token, or the operator's next step is unknowable.
 *
 * @returns The error.
 */
export function fallbackNotPermitted(): ForbiddenError {
  return new ForbiddenError(
    FARM_ERRORS.fallbackNotPermitted,
    "This workspace requires runners to enrol with a client certificate.",
  );
}

/**
 * `401` — a renewal arrived without a client certificate.
 *
 * The likeliest cause is a reverse proxy that terminates TLS and does not forward the client
 * certificate, which is the deployment note `SECURITY_MODEL.md`'s farm-CA section exists to
 * make findable — so the message names it rather than leaving an operator to guess.
 *
 * @returns The error.
 */
export function clientCertificateRequired(): UnauthenticatedError {
  return new UnauthenticatedError(
    FARM_ERRORS.clientCertificateRequired,
    "This endpoint is authenticated by the runner's client certificate, and none was presented. " +
      "A TLS-terminating proxy must be configured to pass it through.",
  );
}

/**
 * `401` — the client certificate presented is not a live identity of this farm.
 *
 * One code for unknown, expired, superseded and revoked, for {@link enrollmentRefused}'s
 * reason. The agent's own answer is the same in every case — stop, do not retry — and the
 * protocol's `identity.revoked` close code is where the distinction is drawn for a connection
 * that had already been established.
 *
 * @returns The error.
 */
export function identityRefused(): UnauthenticatedError {
  return new UnauthenticatedError(
    FARM_ERRORS.identityRefused,
    "This certificate is not a live runner identity.",
  );
}

/**
 * `404` — the workspace has no pool of that name.
 *
 * @param pool - The name, echoed so an operator can see the typo. Safe: the caller is a
 *   session-holding member of this workspace, and it is their own input.
 * @returns The error.
 */
export function poolNotFound(pool: string): NotFoundError {
  return new NotFoundError(FARM_ERRORS.poolNotFound, `No pool named ${pool}.`, { pool });
}

/**
 * `404` — the workspace has no such enrollment token.
 *
 * @returns The error.
 */
export function tokenNotFound(): NotFoundError {
  return new NotFoundError(FARM_ERRORS.tokenNotFound, "No such enrollment token.");
}

/**
 * `404` — the workspace has no such runner.
 *
 * @returns The error.
 */
export function runnerNotFound(): NotFoundError {
  return new NotFoundError(FARM_ERRORS.runnerNotFound, "No such runner.");
}

/**
 * `409` — the runner holds no live certificate, so there is nothing to revoke.
 *
 * A conflict rather than a `404`: the runner exists and the caller may act on it, and the
 * request would become possible again the moment the runner re-enrols. That is
 * `ConflictError`'s definition, and it is also what a bearer-fallback runner gets — it has no
 * certificate by construction, and revoking one is not the way to cut it off.
 *
 * @returns The error.
 */
export function noLiveCertificate(): ConflictError {
  return new ConflictError(FARM_ERRORS.noLiveCertificate, "This runner holds no live certificate.");
}

/**
 * `409` — a runner of that name already exists in the token's workspace.
 *
 * The one thing about a registration that is refused with a *reason*, and it is worth saying
 * why that does not contradict `enrollmentRefused()`'s posture. What this discloses is that a
 * machine of that name is already enrolled — which the caller has just proved it is entitled
 * to know, because it holds a live token for that workspace and could have discovered the
 * same fact by trying another name. What the opaque refusal protects is the *token*, and the
 * token has already been accepted by the time this can be raised.
 *
 * The alternative is worse than the disclosure: an installer that re-ran the one-liner after
 * a timeout would get `farm_enrollment_refused` and conclude its token was dead, and the
 * operator's next act would be to mint a second one for a machine that is already enrolled.
 *
 * **The token is not spent.** The name collision refuses the insert inside the same
 * transaction that increments `uses`, so the whole write rolls back — which is why this is
 * raised from a constraint rather than checked for first: a check-then-insert would leave the
 * race it was trying to describe.
 *
 * @param name - The name, echoed. It is the caller's own input.
 * @returns The error.
 */
export function runnerNameTaken(name: string): ConflictError {
  return new ConflictError(
    FARM_ERRORS.runnerNameTaken,
    `A runner named ${name} is already enrolled in this workspace.`,
    { name },
  );
}
