/**
 * Every way a call to GitHub can fail, named — and what each one becomes when a person is
 * waiting for the answer.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). The issue asks for a
 * taxonomy — `unauthorized` / `not-found` / `rate-limited` / `upstream-error` — *"mapped
 * onto the #31 error envelope so the UI can render honest pause reasons (M.4, N.6)"*. Those
 * are two different jobs, and this file keeps them apart on purpose:
 *
 *   * {@link GithubFailure} is the **reason**, and it is what K.4's sync
 *     ([#102](https://github.com/NobuData/ouroboros/issues/102)) stores and the backlog card
 *     renders. A poller has no client waiting on it; what it needs is a stable word for why
 *     it stopped, so that *"sync paused"* can say **which** kind of paused it is.
 *   * {@link githubDomainError} is the **answer**, for an operation somebody triggered and
 *     is watching — Q.4's test-connection
 *     ([#141](https://github.com/NobuData/ouroboros/issues/141)), a manual re-sync.
 *
 * Collapsing the two would mean either a poller throwing HTTP exceptions at nobody, or a
 * controller having to invent a status from a string.
 *
 * ---------------------------------------------------------------------------
 * **Why GitHub's `401` does not become this API's `401`.**
 *
 * `engine.errors.ts` makes the same call for the same reason and it is worth restating: a
 * `401` from this service means *your session is not good*, and a browser that reads one
 * signs the person out and sends them to log in again. GitHub having rejected **the
 * workspace's stored token** has nothing to do with the session of whoever happened to
 * trigger the call, and answering `401` would sign out an administrator to tell them their
 * GitHub token expired.
 *
 * So it is a `502` — this service is working, something it depends on refused — with a code
 * of its own, {@link GITHUB_ERRORS.unauthorized}, and a message that says what to do about
 * it. The code is what carries the difference: a client branching on `github_unauthorized`
 * knows to point at the settings surface, and a client branching on `github_unavailable`
 * knows to suggest waiting.
 *
 * ---------------------------------------------------------------------------
 * **Why rate-limited is not a `429`.**
 *
 * `TooManyRequestsError` means, in its own words, *"the caller may do this, and has done it
 * too often"*. A GitHub rate limit is not the caller's doing — it is this installation's
 * hourly budget for one token, spent by a poller the caller never saw. Answering `429` would
 * invite a client to back **its own** requests off, which changes nothing, and would put the
 * blame on the one party that did not cause it. It is a `502` carrying
 * `details.retryAfterSeconds`, which is the fact that actually makes the state actionable —
 * and it is a number in the envelope rather than a header, for the reason
 * `TooManyRequestsError`'s own documentation gives.
 *
 * ---------------------------------------------------------------------------
 * **What none of these carry.** No token, no fragment of one, no `Authorization` header, and
 * nothing GitHub said in its own body. `details` holds a repository reference and a number
 * of seconds; everything else goes to the log. That is the second acceptance criterion —
 * *the token is absent from every API response and every log line* — held at the one place
 * every failure passes through, rather than at each `throw`.
 */

import { ConflictError, DomainError, NotFoundError, UpstreamError } from "../errors/error.envelope";

/**
 * Why a call to GitHub did not produce an answer.
 *
 * The vocabulary K.4 stores and mockup 03 renders. Five rather than the issue's four:
 * {@link not_configured} is the state the *first* acceptance criterion is about — *"clear →
 * sync pauses with a designed status (not a crash)"* — and it is a different sentence on the
 * card from every other entry here, because it is the only one the reader can fix in one
 * click and the only one that is not a failure at all.
 */
export const GITHUB_FAILURES = {
  /** This workspace has no GitHub token. Not an error: a thing nobody has done yet. */
  notConfigured: "not_configured",
  /** GitHub refused the token — revoked, expired, or never valid. `401`. */
  unauthorized: "unauthorized",
  /**
   * GitHub has no such repository *for this token*. `404`.
   *
   * Deliberately one reason rather than two: GitHub answers `404` both for a repository that
   * does not exist and for a private one the token may not see, precisely so that a token
   * cannot be used to enumerate private repositories. Splitting them here would be inventing
   * a distinction the upstream refuses to make.
   */
  notFound: "not_found",
  /** The token's hourly budget is spent, or a secondary limit was tripped. `403` / `429`. */
  rateLimited: "rate_limited",
  /** Anything else — a `5xx`, a socket, a body that was not what the route promised. */
  upstreamError: "upstream_error",
} as const;

/** One of {@link GITHUB_FAILURES}' values. */
export type GithubFailure = (typeof GITHUB_FAILURES)[keyof typeof GITHUB_FAILURES];

/**
 * The codes this API answers with when a GitHub call fails under somebody's cursor.
 *
 * Published in `openapi.yaml` beside the operations that can produce them, which is what
 * makes them a contract rather than strings.
 */
export const GITHUB_ERRORS = {
  /** No token is configured for this workspace. `409`. */
  notConfigured: "github_token_missing",
  /** GitHub rejected the stored token. `502` — see this file's header. */
  unauthorized: "github_unauthorized",
  /** GitHub has nothing there for this token. `404`. */
  notFound: "github_not_found",
  /** The token's budget is spent. `502` with `details.retryAfterSeconds`. */
  rateLimited: "github_rate_limited",
  /** GitHub could not be reached, or did not answer the contract. `502`. */
  upstreamError: "github_unavailable",
} as const;

/** One of {@link GITHUB_ERRORS}' values. */
export type GithubErrorCode = (typeof GITHUB_ERRORS)[keyof typeof GITHUB_ERRORS];

/** What a person reads for each reason. Constants, so the document and the answer agree. */
export const GITHUB_MESSAGES: Record<GithubFailure, string> = {
  [GITHUB_FAILURES.notConfigured]:
    "This workspace has no GitHub token. Add one in settings to let Ouroboros read the backlog.",
  [GITHUB_FAILURES.unauthorized]:
    "GitHub rejected this workspace's token. It may have been revoked or expired — set a new one in settings.",
  [GITHUB_FAILURES.notFound]:
    "GitHub has no such repository, or this workspace's token cannot see it.",
  [GITHUB_FAILURES.rateLimited]:
    "GitHub's rate limit for this workspace's token is spent. Syncing resumes when it resets.",
  [GITHUB_FAILURES.upstreamError]: "GitHub is not available right now. Try again in a moment.",
};

/**
 * A call to GitHub that did not produce an answer, carrying why.
 *
 * Thrown by `GithubClient` and caught by whatever asked. A plain `Error` subclass rather
 * than a `DomainError`: the sync is the main caller and it has no HTTP response to make, so
 * the status is decided by {@link githubDomainError} at the boundary where there is one.
 */
export class GithubApiError extends Error {
  /**
   * @param failure - Which reason this is.
   * @param detail - What to write in the **log**. May name the route, the status and the
   *   repository; may never name the token. Not sent to a client.
   * @param retryAfterSeconds - How long until the call is worth repeating, where GitHub
   *   said. Only ever set for {@link GITHUB_FAILURES.rateLimited}.
   */
  constructor(
    readonly failure: GithubFailure,
    readonly detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`github: ${failure} — ${detail}`);
    this.name = "GithubApiError";
  }
}

/**
 * The envelope answer for a GitHub failure, for an operation somebody is waiting on.
 *
 * @param error - The failure, as `GithubClient` threw it.
 * @returns The error to throw at a controller boundary. `404` for a repository that is not
 *   there, `409` for a workspace that has not configured a token, and `502` for the three
 *   ways GitHub itself can refuse — see this file's header for why `401` and `429` are not
 *   among them.
 */
export function githubDomainError(error: GithubApiError): DomainError {
  const message = GITHUB_MESSAGES[error.failure];

  switch (error.failure) {
    case GITHUB_FAILURES.notConfigured:
      // `409` rather than `404`: the operation exists and the workspace exists — the state
      // they are in is what refuses the call, and it is a state the reader can leave.
      return new ConflictError(GITHUB_ERRORS.notConfigured, message);

    case GITHUB_FAILURES.notFound:
      return new NotFoundError(GITHUB_ERRORS.notFound, message);

    case GITHUB_FAILURES.rateLimited:
      return new UpstreamError(
        GITHUB_ERRORS.rateLimited,
        message,
        // Omitted rather than guessed when GitHub did not say: a made-up number would be
        // rendered as a countdown that means nothing, and a client can tell absence from
        // zero.
        error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds },
      );

    case GITHUB_FAILURES.unauthorized:
      return new UpstreamError(GITHUB_ERRORS.unauthorized, message);

    default:
      return new UpstreamError(GITHUB_ERRORS.upstreamError, message);
  }
}
