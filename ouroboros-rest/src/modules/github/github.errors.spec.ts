import { HttpStatus } from "@nestjs/common";

import {
  GITHUB_ERRORS,
  GITHUB_FAILURES,
  GITHUB_MESSAGES,
  GithubApiError,
  githubDomainError,
} from "./github.errors";
import { FIXTURE_TOKEN } from "./github.fixture";

/**
 * Two claims.
 *
 * **The mapping is the one written down**, including the two deliberate refusals: GitHub's
 * `401` must not become this API's `401` (it would sign an administrator out to tell them a
 * token expired) and a GitHub rate limit must not become a `429` (it would tell the one party
 * that did not cause it to slow down). Those are the assertions worth having, because both
 * are the answer somebody would "fix" it to.
 *
 * **Nothing carries a credential.** Asserted over every reason at once rather than at each
 * one, so a sixth reason added later without a message is a failing test rather than a gap.
 */

describe("the GitHub failure taxonomy", () => {
  it("has a message for every reason", () => {
    for (const failure of Object.values(GITHUB_FAILURES)) {
      expect(GITHUB_MESSAGES[failure]).toEqual(expect.any(String));
      expect(GITHUB_MESSAGES[failure].length).toBeGreaterThan(0);
    }
  });

  it("has a distinct code for every reason", () => {
    const codes = Object.values(GITHUB_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps the log detail on the error and out of the answer", () => {
    const error = new GithubApiError(GITHUB_FAILURES.notFound, "GET /repos/x/y answered 404");

    expect(error.message).toContain("GET /repos/x/y answered 404");
    expect(githubDomainError(error).envelope().details).toEqual({});
  });
});

describe("answering a GitHub failure over HTTP", () => {
  it("answers 409 for a workspace that has configured no token", () => {
    // The operation exists and the workspace exists; the state they are in is what refuses
    // the call, and it is a state the reader can leave in one click.
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.notConfigured, "no token"));

    expect(answer.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(answer.envelope().code).toBe(GITHUB_ERRORS.notConfigured);
  });

  it("answers 502 — not 401 — when GitHub rejected the stored token", () => {
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.unauthorized, "refused"));

    // A `401` from this service means *your session is not good*, and a browser that reads
    // one signs the person out. GitHub having rejected the workspace's token has nothing to
    // do with the session of whoever triggered the call.
    expect(answer.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(answer.getStatus()).not.toBe(HttpStatus.UNAUTHORIZED);
    expect(answer.envelope().code).toBe(GITHUB_ERRORS.unauthorized);
  });

  it("answers 404 when GitHub has nothing there for this token", () => {
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.notFound, "404"));

    expect(answer.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(answer.envelope().code).toBe(GITHUB_ERRORS.notFound);
  });

  it("answers 502 — not 429 — for a rate limit, and says how long to wait", () => {
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.rateLimited, "spent", 300));

    // `TooManyRequestsError` means *the caller has done this too often*. A GitHub limit is
    // this installation's hourly budget, spent by a poller the caller never saw.
    expect(answer.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(answer.getStatus()).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(answer.envelope().details).toEqual({ retryAfterSeconds: 300 });
  });

  it("omits the wait rather than guessing one GitHub did not give", () => {
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.rateLimited, "spent"));

    // A made-up number would render as a countdown that means nothing, and a client can tell
    // absence from zero.
    expect(answer.envelope().details).toEqual({});
  });

  it("answers 502 for anything else", () => {
    const answer = githubDomainError(new GithubApiError(GITHUB_FAILURES.upstreamError, "500"));

    expect(answer.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(answer.envelope().code).toBe(GITHUB_ERRORS.upstreamError);
  });

  it("puts no token in any answer, whatever the failure was told", () => {
    for (const failure of Object.values(GITHUB_FAILURES)) {
      // The detail is the *log* line, and a careless caller could put anything in it. What
      // this asserts is that none of it reaches the envelope.
      const answer = githubDomainError(
        new GithubApiError(failure, `a call made with ${FIXTURE_TOKEN}`, 30),
      );

      expect(JSON.stringify(answer.envelope())).not.toContain(FIXTURE_TOKEN);
    }
  });
});
