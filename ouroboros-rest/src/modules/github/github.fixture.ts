/**
 * The stand-ins K.3's suites share ([#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * Three kinds of thing, and they are here together because six suites want the same ones:
 * a workspace and a token to act on, a scriptable {@link OctokitLike} for the client's suite,
 * and the header shapes GitHub answers with so that a rate-limit assertion reads as the
 * header it is about rather than as a literal object.
 *
 * **{@link FIXTURE_TOKEN} is not a credential.** It is `ghp_` followed by thirty-six
 * characters chosen to be obviously a keyboard walk, at the length a classic personal access
 * token has, so that a suite exercising the shape rules is exercising them against something
 * the rules would actually accept — and so that a grep of this repository for a leaked token
 * finds nothing that ever worked.
 */

import type { OctokitLike, OctokitResponseLike } from "./github.client";
import { LIMIT_HEADER, REMAINING_HEADER, RESET_HEADER } from "./github.rate-limit";
import type { CredentialActor } from "./github.credentials.service";
import type { GithubCredentials } from "../db/schema";

/** The workspace every unit suite here acts in. */
export const FIXTURE_WORKSPACE = "org-backlog";

/** Who is doing it — a `"user".id`. */
export const FIXTURE_ACTOR = "user-admin";

/** A token shaped exactly like a classic personal access token, and worth nothing. */
export const FIXTURE_TOKEN = "ghp_qwertyuiopasdfghjklzxcvbnm0123456789";

/** A second one, for the rotation cases — a different value with a different tail. */
export const FIXTURE_ROTATED_TOKEN = "ghp_0987654321mnbvcxzlkjhgfdsapoiuytre";

/** What {@link FIXTURE_TOKEN} masks to. */
export const FIXTURE_MASK = "ghp_••••6789";

/** A fine-grained token, for the cases that are about the prefix rather than the value. */
export const FIXTURE_FINE_GRAINED = "github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789";

/** A pre-2021 classic token — forty lowercase hex characters, no prefix. */
export const FIXTURE_LEGACY_TOKEN = "0123456789abcdef0123456789abcdef01234567";

/**
 * The actor a service call is made as.
 *
 * @param at - When, so a suite asserting on the stamp can name it.
 * @returns The actor.
 */
export function fixtureActor(at = new Date("2026-09-08T10:00:00.000Z")): CredentialActor {
  return { organizationId: FIXTURE_WORKSPACE, actorId: FIXTURE_ACTOR, at };
}

/**
 * A stored credential row.
 *
 * @param envelope - What the sealed column holds. The tests that care supply a real envelope
 *   from `inMemoryVault`; the ones that do not supply a shape.
 * @param stamps - Overrides for the timestamps.
 * @returns The row, as a `select` would answer it.
 */
export function credentialRow(
  envelope: string,
  stamps: Partial<Pick<GithubCredentials, "created_at" | "updated_at">> = {},
): GithubCredentials {
  return {
    organization_id: FIXTURE_WORKSPACE,
    token_encrypted: envelope,
    created_at: stamps.created_at ?? new Date("2026-09-01T09:00:00.000Z"),
    updated_at: stamps.updated_at ?? new Date("2026-09-01T09:00:00.000Z"),
  };
}

/** What GitHub says about the budget on every response. */
export interface BudgetHeaders {
  /** `x-ratelimit-remaining`. */
  readonly remaining: number;
  /** `x-ratelimit-limit`. Defaults to an authenticated token's five thousand. */
  readonly limit?: number;
  /**
   * `x-ratelimit-reset`, as a `Date`. Defaults to **an hour from the real clock** rather than
   * from {@link FIXTURE_NOW}: the guard's own methods take an injectable clock, but the client
   * calls them with the default, so a fixed reset stamp would quietly become a window that has
   * already turned over and every "refuses" assertion would pass for the wrong reason.
   */
  readonly resetAt?: Date;
}

/** The instant the fixtures treat as *now* — a fixed clock, so a countdown is assertable. */
export const FIXTURE_NOW = new Date("2026-09-08T10:00:00.000Z");

/**
 * GitHub's rate headers, as a response carries them.
 *
 * @param budget - What the headers should say.
 * @returns The headers, lower-cased as the library delivers them.
 */
export function budgetHeaders(budget: BudgetHeaders): Record<string, string> {
  const resetAt = budget.resetAt ?? new Date(Date.now() + 3_600_000);

  return {
    [REMAINING_HEADER]: String(budget.remaining),
    [LIMIT_HEADER]: String(budget.limit ?? 5000),
    [RESET_HEADER]: String(Math.floor(resetAt.getTime() / 1000)),
  };
}

/**
 * An error shaped like the one `@octokit/request` throws for a non-2xx answer.
 *
 * Structural rather than the library's class, for `github.client.ts`'s reason: `status` is
 * the only part of it the product reads, and building one here keeps the client's suite free
 * of the ES module.
 *
 * @param status - The HTTP status.
 * @param headers - The response's headers.
 * @returns The error to reject with.
 */
export function httpError(status: number, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), {
    status,
    response: { headers },
  });
}

/** One scripted answer: a response to give, or an error to throw. */
export type ScriptedAnswer = OctokitResponseLike<unknown> | Error;

/** A scriptable stand-in for the library, and a record of what it was asked. */
export interface FakeOctokit extends OctokitLike {
  /** Every `(route, params)` pair the client sent, in order. */
  readonly calls: { route: string; params: Readonly<Record<string, unknown>> }[];
}

/**
 * A response, ready to be scripted.
 *
 * @param data - The body.
 * @param headers - The headers.
 * @param status - The status. Defaults to `200`.
 * @returns The response.
 */
export function response(
  data: unknown,
  headers: Record<string, string> = {},
  status = 200,
): OctokitResponseLike<unknown> {
  return { status, headers, data };
}

/**
 * A stand-in for Octokit that answers from a script.
 *
 * **Not a mock of the library** — a mock would prove the client calls a method. This answers
 * the shapes the library answers, in order, so the client's suite asserts what the client
 * *does* with them: guards before the call, learns from the headers, classifies the failure.
 * What the library itself does is `github.octokit.spec.ts`'s subject, driven over a stub
 * `fetch` against the real thing.
 *
 * @param answers - What to answer, in order. An `Error` is thrown rather than returned. A
 *   script that runs out throws, because a client asking for a page nobody scripted is a
 *   test that has stopped describing anything.
 * @returns The stand-in.
 */
export function fakeOctokit(answers: readonly ScriptedAnswer[]): FakeOctokit {
  const calls: { route: string; params: Readonly<Record<string, unknown>> }[] = [];
  let next = 0;

  const answer = (
    route: string,
    params: Readonly<Record<string, unknown>> = {},
  ): OctokitResponseLike<unknown> => {
    calls.push({ route, params });

    if (next >= answers.length) {
      throw new Error(`github.fixture: nothing scripted for call ${String(next + 1)} (${route})`);
    }

    const scripted = answers[next];

    next += 1;

    if (scripted instanceof Error) {
      throw scripted;
    }

    return scripted;
  };

  return {
    calls,
    request(route, params) {
      return Promise.resolve().then(() => answer(route, params));
    },
    paginate: {
      iterator(route, params) {
        // A generator rather than an array, so that a client which stops reading — because
        // the budget ran out, or because it found what it wanted — stops the walk. An array
        // would answer every page before the client saw the first, which is the one property
        // the pagination criterion is about.
        //
        // Returned as an `AsyncIterable`, which is what the library returns: its own object
        // has `[Symbol.asyncIterator]` and no `next`, and a fixture that offered both would
        // let the client reach for a method that is not there in production.
        const walk = async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
          while (next < answers.length) {
            yield await Promise.resolve().then(() => answer(route, params));
          }
        };

        return { [Symbol.asyncIterator]: walk };
      },
    },
  };
}
