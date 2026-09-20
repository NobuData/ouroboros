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
  /** This deployment is not set up to serve the runner installer (#248). */
  installerUnavailable: "farm_installer_unavailable",
  /** The runner release, or the file in it, that a request named is not served here (#248). */
  releaseNotFound: "farm_release_not_found",
  /** A build job this workspace does not have (#252). */
  jobNotFound: "farm_job_not_found",
  /** A cancel named a build job that has already finished (#252). */
  jobNotCancellable: "farm_job_not_cancellable",
  /** A submission named a repository this workspace does not mirror (#252). */
  repositoryNotFound: "farm_repository_not_found",
  /** A submission named a pool an operator has switched off (#252). */
  poolDisabled: "farm_pool_disabled",
  /** A submission named no command, and its pool has no default to fall back to (#252). */
  commandRequired: "farm_command_required",
  /** A log read asked for an offset past the end of what is stored (#253). */
  logOffsetOutOfRange: "farm_log_offset_out_of_range",
  /** A removal named a runner that is still connected — the lifecycle guard (#254). */
  runnerNotRemovable: "farm_runner_not_removable",
  /** A lifecycle action named a runner that has already been retired (#254). */
  runnerRemoved: "farm_runner_removed",
  /** A pool create or rename used a name this workspace already has (#254). */
  poolNameTaken: "farm_pool_name_taken",
  /** A pool delete named a pool that still has runners or builds (#254). */
  poolInUse: "farm_pool_in_use",
  /** This deployment cannot render an enroll command — no origin, or no release (#254). */
  enrollCommandUnavailable: "farm_enroll_command_unavailable",
  /** A pool write would leave a container pool imageless, or a shell pool with one (#254). */
  poolImageMismatch: "farm_pool_image_mismatch",
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

/**
 * `404` — this deployment serves no runner installer (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)).
 *
 * Raised by `GET /install.sh` and the release files beside it when the deployment has not been
 * given what they need. The reader is `curl -fsSL`, which prints the status and pipes nothing
 * into `sh`, and then a person — so the message says which setting is missing, by the name an
 * operator would set. It names **no path**: where the releases live on this host is the
 * operator's business and not a stranger's.
 *
 * @param reason - One sentence naming the setting, from `installer.service.ts`.
 * @returns The error.
 */
export function installerUnavailable(reason: string): NotFoundError {
  return new NotFoundError(FARM_ERRORS.installerUnavailable, reason);
}

/**
 * `404` — no such runner release, or no such file in one, is served here (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)).
 *
 * @param version - The version the request named, echoed: it is the caller's own input, and
 *   a person reading `curl`'s output needs to see the typo.
 * @param file - The file it named, when it named one.
 * @returns The error.
 */
export function releaseNotFound(version: string, file?: string): NotFoundError {
  return file === undefined
    ? new NotFoundError(
        FARM_ERRORS.releaseNotFound,
        `This deployment serves no ouroboros-runner release ${version}.`,
        { version },
      )
    : new NotFoundError(
        FARM_ERRORS.releaseNotFound,
        `The ouroboros-runner release ${version} served here has no file named ${file}.`,
        { version, file },
      );
}

/**
 * `404` — the workspace has no such build job (AH.4,
 * [#252](https://github.com/NobuData/ouroboros/issues/252)). Another workspace's job is the same
 * answer: see `tenancy/roles.guard.ts` on why "you may not" is a `404`.
 *
 * @returns The error.
 */
export function jobNotFound(): NotFoundError {
  return new NotFoundError(FARM_ERRORS.jobNotFound, "No such build job.");
}

/**
 * `409` — the build job has already finished, so there is nothing to cancel.
 *
 * A conflict rather than a success: a cancel that answered `200` for a build that had already
 * succeeded would let a client believe it stopped something, and the stat row would disagree.
 *
 * @param status - How it ended, echoed so the caller can see why.
 * @returns The error.
 */
export function jobNotCancellable(status: string): ConflictError {
  return new ConflictError(
    FARM_ERRORS.jobNotCancellable,
    `This build job has already finished (${status}); there is nothing to cancel.`,
    { status },
  );
}

/**
 * `404` — the workspace mirrors no repository of that name.
 *
 * @param repository - The `owner/name`, echoed: it is the caller's own input.
 * @returns The error.
 */
export function repositoryNotFound(repository: string): NotFoundError {
  return new NotFoundError(
    FARM_ERRORS.repositoryNotFound,
    `This workspace mirrors no repository named ${repository}.`,
    { repository },
  );
}

/**
 * `409` — the pool is switched off: an operator's intent that it accepts no new work.
 *
 * @param pool - The pool's name.
 * @returns The error.
 */
export function poolDisabled(pool: string): ConflictError {
  return new ConflictError(
    FARM_ERRORS.poolDisabled,
    `The pool ${pool} is disabled and accepts no new builds.`,
    { pool },
  );
}

/**
 * `422` — the submission named no command, and its pool has no default to fall back to.
 *
 * @param pool - The pool's name.
 * @returns The error.
 */
export function commandRequired(pool: string): InvalidRequestError {
  return new InvalidRequestError(
    FARM_ERRORS.commandRequired,
    `The pool ${pool} has no default command; name the command to run.`,
    { pool },
  );
}

/**
 * `422` — a log read's `after` is past the end of the stored log (AH.5,
 * [#253](https://github.com/NobuData/ouroboros/issues/253)).
 *
 * Refused rather than clamped: a client only ever asks from the `nextOffset` it was given, so an
 * offset past the end is a client that lost count, and quietly answering from the end would hide
 * that it had skipped — or invented — bytes.
 *
 * @param end - How many bytes are stored, so the client can see how far off it is.
 * @returns The error.
 */
export function logOffsetOutOfRange(end: number): InvalidRequestError {
  return new InvalidRequestError(
    FARM_ERRORS.logOffsetOutOfRange,
    `This build log holds ${String(end)} bytes; there is nothing to read after that.`,
    { end },
  );
}

/**
 * `409` — the runner is still connected, so it may not be removed (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * **The guard the issue asks for, and the error names the reason rather than the rule.**
 * A machine may be retired when it is `offline` — the fleet cannot reach it anyway — or when
 * it is `draining`, which is an operator who has already decided and has watched it finish.
 * Removing a runner mid-build would strand that build: the row would say `removed`, dispatch
 * would stop offering to it, and the agent would go on compiling something nobody was waiting
 * for until it tried to report a finish the gateway no longer recognises.
 *
 * A conflict rather than a refusal, because it is a fact about the runner's *state* and the
 * request becomes possible the moment that changes — drain it, and this succeeds. The message
 * says which of the two ways out applies, since *drain it first* is the answer for a busy
 * machine and *wait* is the answer for one that is merely reachable.
 *
 * @param status - What the fleet last observed, echoed so the message is checkable against
 *   the row the caller is looking at.
 * @returns The error.
 */
export function runnerNotRemovable(status: string): ConflictError {
  return new ConflictError(
    FARM_ERRORS.runnerNotRemovable,
    `This runner is ${status}; drain it and let it finish, or wait until it goes offline, ` +
      "before removing it.",
    { status },
  );
}

/**
 * `409` — the runner has already been retired (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * Not a `404`, even though a removed runner is absent from `GET /api/v1/farm`. The row is
 * there, the caller may act on this workspace, and *no such runner* would send somebody
 * looking for a machine they are holding the identifier of. It is the answer to draining,
 * undraining or re-removing something that is gone — all three of which are the same fact.
 *
 * @returns The error.
 */
export function runnerRemoved(): ConflictError {
  return new ConflictError(
    FARM_ERRORS.runnerRemoved,
    "This runner has been removed from the fleet.",
  );
}

/**
 * `409` — the workspace already has a pool of that name (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * A pool's name is how the install one-liner names it (`--pool`) and how a submission selects
 * one, so it is unique per workspace (`runner_pools_organization_name_key`). Raised from that
 * constraint rather than from a check first, for `runnerNameTaken`'s reason: a check-then-insert
 * leaves the race it was describing.
 *
 * @param name - The name, echoed. The caller's own input.
 * @returns The error.
 */
export function poolNameTaken(name: string): ConflictError {
  return new ConflictError(
    FARM_ERRORS.poolNameTaken,
    `This workspace already has a pool named ${name}.`,
    { name },
  );
}

/**
 * `409` — the pool still has runners or builds, so it cannot be deleted (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * V040's `runners_pool_fk` and `build_jobs_pool_fk` are `on delete no action`: the database
 * refuses this delete whatever a service believes, and it refuses it with a foreign-key
 * violation nobody outside PostgreSQL can read. So the counts are taken first and the refusal
 * says what is in the way — and the **retired** runners are counted too, because the
 * constraint counts them.
 *
 * **Disabling is the answer most callers want**, and the message says so: `enabled: false`
 * stops a pool taking new work and keeps its history, which is what *delete* usually means
 * when a pool has built things.
 *
 * @param pool - The pool's name.
 * @param references - How many runners and builds still name it.
 * @returns The error.
 */
export function poolInUse(
  pool: string,
  references: { runners: number; jobs: number },
): ConflictError {
  return new ConflictError(
    FARM_ERRORS.poolInUse,
    `The pool ${pool} still has ${String(references.runners)} runner(s) and ` +
      `${String(references.jobs)} build(s); disable it instead, or move them first.`,
    { pool, runners: references.runners, jobs: references.jobs },
  );
}

/**
 * `404` — this deployment cannot render an enroll command (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * The same shape and the same code family as `installerUnavailable`, and separate from it
 * because the caller is different: that one answers `curl` on a build machine, this one
 * answers the enroll card. A command this deployment cannot serve the installer for would be
 * a one-liner that downloads nothing — mockup 08's `get.ouroboros.dev` is design shorthand,
 * and the honest answer is to say what is missing rather than to render a public host a
 * self-hosted tenant never agreed to trust.
 *
 * @param reason - What is missing, in a sentence an operator can act on.
 * @returns The error.
 */
export function enrollCommandUnavailable(reason: string): NotFoundError {
  return new NotFoundError(FARM_ERRORS.enrollCommandUnavailable, reason);
}

/**
 * `422` — a container pool must pin an image, and a shell pool must not (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * V040's `runner_pools_image_for_container` is a **both-directions** CHECK, and both
 * directions earn their place: a container pool with no image has nothing to run a build in,
 * and a shell pool carrying one is a pinned image nothing will ever pull — which the pools
 * card would render as a promise the pool does not keep.
 *
 * A `422` rather than a `409`, because it is a fact about the request rather than about the
 * workspace: the body describes a pool that cannot exist. It cannot be decided by the DTO on
 * a `PATCH`, where the executor may be unchanged and absent — `fleet.dto.ts` says why, and
 * `pools.service.ts` decides it against the merged row.
 *
 * @returns The error.
 */
export function imageRequired(): InvalidRequestError {
  return new InvalidRequestError(
    FARM_ERRORS.poolImageMismatch,
    "A container pool must pin the image its builds run in; name one in `image`.",
    { field: "image", executor: "container" },
  );
}

/**
 * `422` — the other direction of {@link imageRequired}.
 *
 * @returns The error.
 */
export function imageNotAllowed(): InvalidRequestError {
  return new InvalidRequestError(
    FARM_ERRORS.poolImageMismatch,
    "A shell pool runs on the machine itself and cannot pin an image; clear `image`.",
    { field: "image", executor: "shell" },
  );
}
