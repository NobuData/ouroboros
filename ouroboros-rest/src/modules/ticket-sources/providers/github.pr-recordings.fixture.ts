/**
 * A recorded GitHub that holds **pull requests** — branches of commits, PRs, conversation comments,
 * reviewers and issues a merge can close — so the PR conformance kit and the sandbox round trip
 * drive the real provider with nothing standing in but the network.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)). It answers the routes
 * `github.pr.ts` sends, in the shapes GitHub's REST API documents, and applies the rules a real
 * repository applies that the provider's correctness depends on:
 *
 * ```
 * GET  …/pulls?head=owner:branch&base=…     open PRs for that pair
 * POST …/pulls                              422 for a missing branch or a second open PR for the pair
 * GET  …/pulls/{n} · …/pulls/{n}/files      the head's commits, summed per path
 * PUT  …/pulls/{n}/merge                    405 unless open and the strategy is allowed ·
 *                                           keyword closes on a merge into the default branch only
 * DELETE …/git/refs/heads/{b}               422 for a ref that does not exist
 * GET · POST …/issues/{n}/comments · PATCH …/issues/comments/{id}
 * POST …/pulls/{n}/requested_reviewers
 * GET  …/issues?since&sort=updated&direction=asc   issues and PRs, PRs carrying `pull_request`
 * GET  …/issues/{n}                          another repository is a 404 — the silent failure
 * ```
 *
 * **Its ledger is read off its own state**, never through the provider, for the kit's reason.
 */

import type { OctokitLike, OctokitResponseLike } from "../../github/github.client";
import { budgetHeaders, httpError, response } from "../../github/github.fixture";
import type { PrLedger } from "../conformance.pr.fixture";
import { closingReferences, type MergeStrategy, type PrFileChange } from "../ticket-source.pr";
import { SOURCE_LOGIN, SOURCE_REPO } from "./github.provider.fixture";
import { ISSUES_ROUTE } from "./github.mapping";
import {
  CREATE_COMMENT_ROUTE,
  CREATE_PULL_ROUTE,
  DELETE_REF_ROUTE,
  ISSUE_COMMENTS_ROUTE,
  MERGE_PULL_ROUTE,
  PULLS_ROUTE,
  PULL_FILES_ROUTE,
  PULL_ROUTE,
  REQUEST_REVIEWERS_ROUTE,
  UPDATE_COMMENT_ROUTE,
} from "./github.pr";
import { ISSUE_ROUTE } from "./github.write";

/** The repository's default branch. */
export const RECORDED_DEFAULT_BRANCH = "main";

/** Who merges on the recording. */
export const RECORDED_MERGER = "ouroboros-bot";

/** A changed file, as a recorded push carries it. */
export interface RecordedFileChange extends PrFileChange {
  /** The patch text, or null for a binary. */
  readonly patch?: string | null;
}

/** A PR, as the recording holds it. */
export interface RecordedPull {
  /** Its number — shared with issues, as GitHub's numbering is. */
  readonly number: number;
  /** The branch it merges from. */
  readonly head: string;
  /** The branch it merges into. */
  readonly base: string;
  /** The title. */
  readonly title: string;
  /** The description. */
  readonly body: string | null;
  /** `open` or `closed`. */
  state: "open" | "closed";
  /** When it merged, or null. */
  mergedAt: string | null;
  /** The head it merged at. */
  mergedHead: string | null;
  /** The commits it merged — frozen, so a deleted branch keeps its files, as on github.com. */
  mergedCommits: { sha: string; files: RecordedFileChange[] }[] | null;
  /** When it last changed. */
  updated: string;
  /** Who is asked to review. */
  readonly reviewers: string[];
}

/** How a recording is set up. */
export interface PrRecordingOptions {
  /** The strategies the repository allows. All three unless given. */
  readonly strategies?: readonly MergeStrategy[];
}

/** A recorded GitHub with pull requests. */
export interface PrRecording {
  /** What the provider's factory hands out. */
  readonly octokit: OctokitLike;
  /** Every request, in order. */
  readonly calls: { route: string; params: Readonly<Record<string, unknown>> }[];
  /** The PRs, by number. */
  readonly pulls: Map<number, RecordedPull>;
  /** Push a commit onto a branch, creating it off the default branch. Answers the sha. */
  push(branch: string, files: readonly RecordedFileChange[]): string;
  /** Open a PR directly, as a person would on github.com. Answers its number. */
  open(branch: string, title: string): number;
  /** File an open issue. Answers its number. */
  openIssue(): number;
  /** What the repository holds. */
  ledger(): PrLedger;
  /** Refuse every later request with this error. */
  refuse(error: Error): void;
  /** Answer again. */
  recover(): void;
}

/** Healthy budget headers, so a case about PRs is not a case about the rate guard. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * A recorded GitHub repository with only a default branch until something is pushed.
 *
 * @param options - The allowed merge strategies.
 * @returns The recording.
 */
export function prRecording(options: PrRecordingOptions = {}): PrRecording {
  const strategies = new Set(options.strategies ?? ["merge", "squash", "rebase"]);
  const calls: { route: string; params: Readonly<Record<string, unknown>> }[] = [];
  const branches = new Map<string, { sha: string; files: RecordedFileChange[] }[]>();
  const pulls = new Map<number, RecordedPull>();
  const issues = new Map<number, { state: "open" | "closed"; updated: string }>();
  const comments: { id: number; issue: number; body: string }[] = [];
  let clock = Date.UTC(2026, 8, 24, 9, 0);
  let commits = 0;
  let refusal: Error | null = null;

  const tick = (): string => {
    clock += 60_000;

    return new Date(clock).toISOString();
  };

  const nextSha = (): string => {
    commits += 1;

    return (commits.toString(16).padStart(7, "0") + "a".repeat(33)).slice(0, 40);
  };

  branches.set(RECORDED_DEFAULT_BRANCH, [{ sha: nextSha(), files: [] }]);

  const nextNumber = (): number => pulls.size + issues.size + 1;

  const headOf = (pull: RecordedPull): string =>
    pull.mergedHead ?? branches.get(pull.head)?.at(-1)?.sha ?? "0".repeat(40);

  const filesOf = (pull: RecordedPull): RecordedFileChange[] => {
    const byPath = new Map<string, RecordedFileChange>();

    for (const commit of pull.mergedCommits ?? branches.get(pull.head) ?? []) {
      for (const file of commit.files) {
        const known = byPath.get(file.path);

        byPath.set(file.path, {
          path: file.path,
          additions: (known?.additions ?? 0) + file.additions,
          deletions: (known?.deletions ?? 0) + file.deletions,
          patch: file.patch ?? known?.patch ?? null,
        });
      }
    }

    return [...byPath.values()];
  };

  const pullPayload = (pull: RecordedPull): Record<string, unknown> => {
    const files = filesOf(pull);

    return {
      number: pull.number,
      html_url: `https://github.com/${SOURCE_LOGIN}/${SOURCE_REPO}/pull/${String(pull.number)}`,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.mergedAt !== null,
      merged_at: pull.mergedAt,
      merged_by: pull.mergedAt === null ? null : { login: RECORDED_MERGER },
      merge_commit_sha: null,
      head: {
        ref: pull.head,
        sha: headOf(pull),
        repo: { full_name: `${SOURCE_LOGIN}/${SOURCE_REPO}` },
      },
      base: { ref: pull.base },
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      changed_files: files.length,
      updated_at: pull.updated,
    };
  };

  const find = (value: unknown): RecordedPull => {
    const pull = pulls.get(Number(value));

    if (pull === undefined) {
      throw httpError(404, HEALTHY);
    }

    return pull;
  };

  const openPull = (
    branch: string,
    base: string,
    title: string,
    body: string | null,
  ): RecordedPull => {
    if (
      !branches.has(branch) ||
      !branches.has(base) ||
      branch === base ||
      [...pulls.values()].some(
        (pull) => pull.state === "open" && pull.head === branch && pull.base === base,
      )
    ) {
      throw httpError(422, HEALTHY);
    }

    const pull: RecordedPull = {
      number: nextNumber(),
      head: branch,
      base,
      title,
      body,
      state: "open",
      mergedAt: null,
      mergedHead: null,
      mergedCommits: null,
      updated: tick(),
      reviewers: [],
    };

    pulls.set(pull.number, pull);

    return pull;
  };

  const answer = (route: string, params: Readonly<Record<string, unknown>>): unknown => {
    calls.push({ route, params });

    if (refusal !== null) {
      throw refusal;
    }

    if (params.owner !== SOURCE_LOGIN || params.repo !== SOURCE_REPO) {
      throw httpError(404, HEALTHY);
    }

    switch (route) {
      case PULLS_ROUTE: {
        const head = typeof params.head === "string" ? params.head : "";

        return [...pulls.values()]
          .filter(
            (pull) =>
              (params.state !== "open" || pull.state === "open") &&
              (head === "" || `${SOURCE_LOGIN}:${pull.head}` === head) &&
              (params.base === undefined || pull.base === params.base),
          )
          .map(pullPayload);
      }

      case CREATE_PULL_ROUTE:
        return pullPayload(
          openPull(
            String(params.head),
            String(params.base),
            String(params.title),
            typeof params.body === "string" ? params.body : null,
          ),
        );

      case PULL_ROUTE:
        return pullPayload(find(params.pull_number));

      case PULL_FILES_ROUTE:
        return filesOf(find(params.pull_number)).map((file) => ({
          filename: file.path,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.additions + file.deletions,
          status: "modified",
          ...(file.patch === null || file.patch === undefined ? {} : { patch: file.patch }),
        }));

      case MERGE_PULL_ROUTE: {
        const pull = find(params.pull_number);

        if (pull.state !== "open" || !strategies.has(params.merge_method as MergeStrategy)) {
          throw httpError(405, HEALTHY);
        }

        pull.mergedHead = headOf(pull);
        pull.mergedCommits = [...(branches.get(pull.head) ?? [])];
        pull.state = "closed";
        pull.updated = tick();
        pull.mergedAt = pull.updated;

        const message = [params.commit_title, params.commit_message]
          .filter((part): part is string => typeof part === "string")
          .join("\n");

        if (pull.base === RECORDED_DEFAULT_BRANCH) {
          for (const reference of closingReferences(message, pull.body)) {
            const issue = issues.get(reference.number);

            if (reference.owner === null && issue !== undefined) {
              issue.state = "closed";
              issue.updated = tick();
            }
          }
        }

        return { sha: nextSha(), merged: true, message: "Pull Request successfully merged" };
      }

      case DELETE_REF_ROUTE: {
        const branch = String(params.ref).replace(/^heads\//, "");

        if (!branches.has(branch) || branch === RECORDED_DEFAULT_BRANCH) {
          throw httpError(422, HEALTHY);
        }

        branches.delete(branch);

        return undefined;
      }

      case ISSUE_ROUTE: {
        const number = Number(params.issue_number);
        const issue = issues.get(number);

        if (issue !== undefined) {
          return { number, state: issue.state };
        }

        const pull = find(number);

        return { number, state: pull.state };
      }

      case ISSUE_COMMENTS_ROUTE:
        find(params.issue_number);

        return comments
          .filter((comment) => comment.issue === Number(params.issue_number))
          .map(({ id, body }) => ({ id, body }));

      case CREATE_COMMENT_ROUTE: {
        const pull = find(params.issue_number);
        const comment = {
          id: 7_000_000 + comments.length + 1,
          issue: pull.number,
          body: String(params.body),
        };

        comments.push(comment);
        pull.updated = tick();

        return { id: comment.id, body: comment.body };
      }

      case UPDATE_COMMENT_ROUTE: {
        const comment = comments.find((known) => known.id === params.comment_id);

        if (comment === undefined) {
          throw httpError(404, HEALTHY);
        }

        comment.body = String(params.body);
        find(comment.issue).updated = tick();

        return { id: comment.id, body: comment.body };
      }

      case REQUEST_REVIEWERS_ROUTE: {
        const pull = find(params.pull_number);

        for (const login of params.reviewers as string[]) {
          if (!pull.reviewers.includes(login)) {
            pull.reviewers.push(login);
          }
        }

        return {
          number: pull.number,
          requested_reviewers: pull.reviewers.map((login) => ({ login })),
        };
      }

      case ISSUES_ROUTE: {
        const since =
          typeof params.since === "string" ? Date.parse(params.since) : Number.NEGATIVE_INFINITY;
        const rows = [
          ...[...issues].map(([number, issue]) => ({
            number,
            state: issue.state,
            updated_at: issue.updated,
          })),
          ...[...pulls.values()].map((pull) => ({
            number: pull.number,
            state: pull.state,
            updated_at: pull.updated,
            pull_request: { merged_at: pull.mergedAt },
          })),
        ];

        return rows
          .filter((row) => Date.parse(row.updated_at) >= since)
          .sort(
            (left, right) =>
              Date.parse(left.updated_at) - Date.parse(right.updated_at) ||
              left.number - right.number,
          );
      }

      default:
        throw httpError(404, HEALTHY);
    }
  };

  const respond = (
    route: string,
    params: Readonly<Record<string, unknown>> = {},
  ): OctokitResponseLike<unknown> => {
    const data = answer(route, params);
    const status = route.startsWith("POST ") ? 201 : route.startsWith("DELETE ") ? 204 : 200;

    return response(data, HEALTHY, status);
  };

  const octokit: OctokitLike = {
    request(route, params) {
      return Promise.resolve().then(() => respond(route, params));
    },
    paginate: {
      iterator(route, params) {
        // One page holding everything, for `github.write-recordings.fixture.ts`'s reason.
        const walk = async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
          yield await Promise.resolve().then(() => respond(route, params));
        };

        return { [Symbol.asyncIterator]: walk };
      },
    },
  };

  return {
    octokit,
    calls,
    pulls,
    push(branch, files) {
      const sha = nextSha();
      const history = branches.get(branch) ?? [];

      history.push({ sha, files: files.map((file) => ({ ...file })) });
      branches.set(branch, history);

      for (const pull of pulls.values()) {
        if (pull.head === branch && pull.state === "open") {
          pull.updated = tick();
        }
      }

      return sha;
    },
    open(branch, title) {
      return openPull(branch, RECORDED_DEFAULT_BRANCH, title, null).number;
    },
    openIssue() {
      const number = nextNumber();

      issues.set(number, { state: "open", updated: tick() });

      return number;
    },
    ledger: () => ({
      prs: [...pulls.keys()],
      comments: comments.map(
        ({ id, issue, body }) => [issue, String(id), body] as [number, string, string],
      ),
      merged: [...pulls.values()]
        .filter((pull) => pull.mergedAt !== null)
        .map((pull) => pull.number),
      branches: [...branches.keys()],
      requests: calls.length,
    }),
    refuse(error) {
      refusal = error;
    },
    recover() {
      refusal = null;
    },
  };
}
