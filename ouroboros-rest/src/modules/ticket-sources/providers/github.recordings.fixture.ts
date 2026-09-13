/**
 * A recorded GitHub that answers the way the issues endpoint does — per repository, filtered by
 * `state` and `since`, oldest change first, a page at a time — so the conformance kit's sync legs
 * replay real payload shapes through the real provider.
 *
 * Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142)). `github.provider.fixture.ts`'s
 * `scriptedOctokit` serves each repository's pages in the order a spec queued them and ignores the
 * query, which is right for a suite asserting what the provider *sent*. The kit asks a different
 * question — does a sequence of polls converge on the tracker's state and then stop writing — and a
 * stand-in that answered the same page whatever `since` said could not show a cursor doing its job.
 * So this one holds the issues and applies the two parameters the provider's query rests on.
 *
 * The payloads themselves are `github.provider.fixture.ts`'s `issuePayload` and
 * `pullRequestPayload` — the recorded shapes — and the error answers are K.3's `httpError`, so
 * nothing here is a second description of GitHub's JSON.
 */

import type { OctokitLike, OctokitResponseLike } from "../../github/github.client";
import { httpError, response } from "../../github/github.fixture";
import { ISSUES_ROUTE } from "./github.mapping";
import { REPO_ROUTE } from "./github.provider";

/**
 * How many issues one response carries unless told otherwise.
 *
 * Deliberately tiny, so a recording of a handful of issues is walked across several responses and
 * the provider's own pagination is inside what the kit exercises.
 */
export const RECORDED_PAGE_SIZE = 2;

/** A recorded GitHub, and the two ways a case changes it. */
export interface RecordedGithub {
  /** What the provider's factory hands out. */
  readonly octokit: OctokitLike;
  /**
   * Record an issue as GitHub now has it — replacing the one with the same number in the same
   * repository, or adding it.
   *
   * @param payload - An `issuePayload` or `pullRequestPayload`.
   */
  record(payload: Readonly<Record<string, unknown>>): void;
  /**
   * Answer every later request with a refusal.
   *
   * @param error - What to reject with — `httpError(401)` and its relatives.
   */
  refuse(error: Error): void;
}

/**
 * A GitHub holding these issues.
 *
 * @param issues - The recorded payloads, in any order.
 * @param pageSize - How many issues one response carries.
 * @returns The recording.
 */
export function recordedGithub(
  issues: readonly Readonly<Record<string, unknown>>[],
  pageSize = RECORDED_PAGE_SIZE,
): RecordedGithub {
  const held = [...issues];
  let refusal: Error | null = null;

  const octokit: OctokitLike = {
    request(route, params = {}) {
      if (refusal !== null) {
        return Promise.reject(refusal);
      }

      const { owner, repo } = addressOf(params);

      // A repository is visible when it holds a recorded issue — the only repositories a
      // recording knows about — and anything else is GitHub's `404` for *not there, or not yours*.
      if (route !== REPO_ROUTE || !held.some((issue) => belongsTo(issue, owner, repo))) {
        return Promise.reject(httpError(404));
      }

      return Promise.resolve(response({ full_name: `${owner}/${repo}` }));
    },
    paginate: {
      iterator(route, params = {}) {
        const walk = async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
          if (refusal !== null) {
            throw refusal;
          }

          if (route !== ISSUES_ROUTE) {
            throw httpError(404);
          }

          const { owner, repo } = addressOf(params);
          const since = typeof params.since === "string" ? new Date(params.since).getTime() : null;
          const listed = held
            .filter(
              (issue) =>
                belongsTo(issue, owner, repo) &&
                (params.state === "all" || issue.state === params.state) &&
                (since === null || stampOf(issue) >= since),
            )
            .sort((left, right) => stampOf(left) - stampOf(right));

          // One empty response for a repository with nothing to list, which is what GitHub
          // answers — not zero responses.
          for (let start = 0; start === 0 || start < listed.length; start += pageSize) {
            yield await Promise.resolve(response(listed.slice(start, start + pageSize)));
          }
        };

        return { [Symbol.asyncIterator]: walk };
      },
    },
  };

  return {
    octokit,
    record(payload) {
      const index = held.findIndex(
        (issue) =>
          issue.number === payload.number && issue.repository_url === payload.repository_url,
      );

      if (index === -1) {
        held.push(payload);
      } else {
        held[index] = payload;
      }
    },
    refuse(error) {
      refusal = error;
    },
  };
}

/**
 * The owner and repository a request names.
 *
 * @param params - What the provider sent.
 * @returns Both, as text — empty when absent.
 */
function addressOf(params: Readonly<Record<string, unknown>>): { owner: string; repo: string } {
  return {
    owner: typeof params.owner === "string" ? params.owner : "",
    repo: typeof params.repo === "string" ? params.repo : "",
  };
}

/**
 * Whether a recorded issue lives in a repository.
 *
 * @param issue - The payload.
 * @param owner - The account.
 * @param repo - The repository.
 * @returns `true` when its `repository_url` names them.
 */
function belongsTo(issue: Readonly<Record<string, unknown>>, owner: string, repo: string): boolean {
  return issue.repository_url === `https://api.github.com/repos/${owner}/${repo}`;
}

/**
 * When a recorded issue last changed.
 *
 * @param issue - The payload.
 * @returns Its `updated_at`, in epoch milliseconds — compared as instants, because GitHub's `Z`
 *   stamps and the provider's millisecond cursors are the same instant spelled two ways.
 */
function stampOf(issue: Readonly<Record<string, unknown>>): number {
  return new Date(String(issue.updated_at)).getTime();
}
