/**
 * `GithubPullRequests` — the GitHub provider's half of the PR SPI, one repository at a time.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)). `github.provider.ts` holds the
 * members `PrCapableProvider` names and turns every failure into the SPI's taxonomy; this file holds
 * what each member *does* against GitHub, over K.3's client — so no Octokit import here either.
 *
 * ```
 * createPR       GET …/pulls?head=owner:branch&base=… ─▶ POST …/pulls           idempotent by branch → base
 * getPR          GET …/pulls/{n}
 * syncPR         GET …/pulls/{n} ─▶ head sha moved? ─▶ GET …/pulls/{n}/files    revision + file snapshot
 * mergePR        strategy advertised? (no request) ─▶ GET …/pulls/{n} ─▶ PUT …/pulls/{n}/merge
 *                ─▶ DELETE …/git/refs/heads/{branch} ─▶ GET …/issues/{closed #N}  verified, not assumed
 * commentPR      GET …/issues/{n}/comments ─▶ PATCH …/issues/comments/{id} | POST …/issues/{n}/comments
 * requestReview  POST …/pulls/{n}/requested_reviewers
 * prEvents       GET …/issues?state=all&sort=updated&direction=asc&since=cursor   PRs only
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The repository is the source's push target** — its first enabled repository, where AL.3 lands
 * tickets. V052 keys a mirrored PR by `(source_id, external_number)`, and a PR number is only unique
 * within one repository, so the PR plane of a source is one repository.
 *
 * **Merge squash takes the message apart.** GitHub's merge endpoint takes a `commit_title` and a
 * `commit_message`; the first line of the merge plan's message is the title and the rest the body,
 * which is where `Closes #482.` usually sits.
 *
 * **Closure is read back, per reference, and a failure to read is a failure to verify.** GitHub
 * closes an issue by keyword only on a merge into the default branch, and only in a repository the
 * merge can see — *keyword closing silently fails across repositories*. So after the merge each
 * referenced issue is read, and anything but `closed` — including a `404` or a refusal — is reported
 * `closed: false` with the reason, rather than failing a merge that has already happened.
 *
 * **Pushed-at is the PR's `updated_at`.** GitHub's PR API reports no push time; the committer date
 * of the head commit is a date the pusher controls (a rebase keeps it). The sync that notices a new
 * head records when GitHub last changed the PR, which is the closest honest answer to *when did the
 * host see the push*.
 *
 * **Events walk the issues listing, because the pulls listing cannot resume.** `GET …/pulls` has
 * no `since`, and a walk newest-first that stopped at a cap could only resume by skipping what lay
 * between. `GET …/issues` takes `since` and sorts ascending, and lists PRs beside issues (each
 * carrying `pull_request`), so a poll walks oldest-first from the cursor and a capped page resumes
 * exactly where it stopped. The cursor is **inclusive** — GitHub's `since` is — so a PR sharing the
 * last instant is never skipped, at the cost of it repeating. An event is a hint to `syncPR`, which
 * is idempotent, so a repeat costs one request and loses nothing.
 */

import { z } from "zod";

import type { GithubClient } from "../../github/github.client";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { TicketSourceError } from "../ticket-source.errors";
import {
  HEAD_SHA,
  assertAdvertisedStrategy,
  closingReferences,
  diffExcerptOf,
  hasPrCommentMarker,
  withPrCommentMarker,
  type ClosingReference,
  type CreatePrInput,
  type HostPrState,
  type IssueClosure,
  type MergePrInput,
  type MergePrResult,
  type PrCommentInput,
  type PrCommentResult,
  type PrEvent,
  type PrEventPage,
  type PrFileChange,
  type PrRef,
  type PrSyncResult,
  type PullRequestSnapshot,
  type ReviewRequestResult,
  type TicketSourcePrCapabilities,
} from "../ticket-source.pr";
import { HTTPS_URL, ISSUES_ROUTE, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./github.mapping";
import { ISSUE_ROUTE, type GithubTarget } from "./github.write";

/**
 * What GitHub can do with pull requests, as the provider declares it.
 *
 * Every strategy GitHub's merge endpoint names, reviews, and a poll — the webhook slot waits for the
 * GitHub App ([#122](https://github.com/NobuData/ouroboros/issues/122)). A repository may switch a
 * strategy off in its settings; GitHub then refuses the merge (`405`), which arrives classified.
 */
export const GITHUB_PR_CAPABILITIES = Object.freeze({
  pullRequests: true,
  create: true,
  mergeStrategies: Object.freeze(["merge", "squash", "rebase"] as const),
  reviews: true,
  events: "poll",
} as const) satisfies TicketSourcePrCapabilities;

/** List a repository's PRs. */
export const PULLS_ROUTE = "GET /repos/{owner}/{repo}/pulls";

/** Open a PR. */
export const CREATE_PULL_ROUTE = "POST /repos/{owner}/{repo}/pulls";

/** Read one PR. */
export const PULL_ROUTE = "GET /repos/{owner}/{repo}/pulls/{pull_number}";

/** A PR's changed files. */
export const PULL_FILES_ROUTE = "GET /repos/{owner}/{repo}/pulls/{pull_number}/files";

/** Merge a PR. */
export const MERGE_PULL_ROUTE = "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge";

/** Delete a branch. */
export const DELETE_REF_ROUTE = "DELETE /repos/{owner}/{repo}/git/refs/{ref}";

/** A PR's conversation comments — GitHub's issue comments. */
export const ISSUE_COMMENTS_ROUTE = "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";

/** Post a comment. */
export const CREATE_COMMENT_ROUTE = "POST /repos/{owner}/{repo}/issues/{issue_number}/comments";

/** Edit a comment. */
export const UPDATE_COMMENT_ROUTE = "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}";

/** Ask for reviews. */
export const REQUEST_REVIEWERS_ROUTE =
  "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers";

/** How many PRs one `prEvents` poll answers at most — one page, GitHub's largest. */
export const MAX_PR_EVENTS = 100;

/** The longest comment GitHub stores. */
export const MAX_COMMENT_LENGTH = 65_536;

/** A GitHub login: alphanumerics and single hyphens, at most 39 characters. */
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** A git branch name this file will send — no whitespace, no `..`, no leading `-`. */
const BRANCH = /^(?!-)(?!.*\.\.)[^\s~^:?*[\\]{1,255}$/;

/** The fields of a PR payload this file reads. */
const pullPayload = z.object({
  number: z.number().int().positive(),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(["open", "closed"]),
  merged_at: z.string().nullish(),
  merged_by: z.object({ login: z.string() }).nullish(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullish(),
  }),
  base: z.object({ ref: z.string() }),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  changed_files: z.number().int().nonnegative().optional(),
  updated_at: z.string(),
});

/** A PR, as this file reads one. */
export type PullPayload = z.infer<typeof pullPayload>;

/** The fields of a changed-file payload this file reads. */
const filePayload = z.object({
  filename: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullish(),
});

/** The fields of a comment payload this file reads. */
const commentPayload = z.object({ id: z.number().int().positive(), body: z.string().nullish() });

/** The fields of an issue payload closure verification reads. */
const issueState = z.object({ state: z.string() });

/** The fields of an issues-listing row `prEvents` reads — a PR carries `pull_request`. */
const listedIssue = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  updated_at: z.string(),
  pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
});

/** The fields of a merge answer this file reads. */
const mergeAnswer = z.object({ sha: z.string().nullish() });

/**
 * The provider's PR operations against one repository, over K.3's client.
 *
 * Built per call and dropped with it, for `GithubWriter`'s reason: the client holds the credential.
 * Throws `TicketSourceError` `validation` for an argument it refuses before sending anything, and
 * K.3's `GithubApiError` for anything GitHub refused; `github.provider.ts` classifies the latter.
 */
export class GithubPullRequests {
  /**
   * @param client - K.3's client for this source's token and budget.
   * @param target - The repository.
   */
  constructor(
    private readonly client: GithubClient,
    private readonly target: GithubTarget,
  ) {}

  /**
   * Open a PR, or answer the open one already proposing this branch into this base.
   *
   * @param input - The branches, title and description.
   * @returns The PR.
   */
  async createPR(input: CreatePrInput): Promise<PrRef> {
    const title = input.title.trim();

    if (title === "" || title.length > MAX_TITLE_LENGTH) {
      throw invalid(
        `a PR title must be non-blank and at most ${String(MAX_TITLE_LENGTH)} characters`,
      );
    }

    branchOf(input.branch, "branch");
    branchOf(input.base, "base");

    if (input.branch === input.base) {
      throw invalid("a branch cannot be proposed into itself");
    }

    if (input.body !== null && input.body.length > MAX_BODY_LENGTH) {
      throw invalid(`a PR description must be at most ${String(MAX_BODY_LENGTH)} characters`);
    }

    const open = await this.client.request<unknown>(PULLS_ROUTE, {
      ...this.address(),
      state: "open",
      head: `${this.target.owner}:${input.branch}`,
      base: input.base,
    });
    const existing = parse(z.array(pullPayload), open.data, PULLS_ROUTE)[0];

    if (existing !== undefined) {
      return refOf(existing);
    }

    const created = await this.client.request<unknown>(CREATE_PULL_ROUTE, {
      ...this.address(),
      title,
      head: input.branch,
      base: input.base,
      ...(input.body === null ? {} : { body: input.body }),
    });

    return refOf(parse(pullPayload, created.data, CREATE_PULL_ROUTE));
  }

  /**
   * One PR as GitHub reports it now.
   *
   * @param prNumber - Its number.
   * @returns The snapshot.
   */
  async getPR(prNumber: number): Promise<PullRequestSnapshot> {
    return snapshotOf(await this.pull(prNumber));
  }

  /**
   * One PR, and a revision when its head moved past the one the caller holds.
   *
   * @param prNumber - Its number.
   * @param knownHeadSha - The caller's latest head, or null.
   * @returns The snapshot and, when the head moved, the revision with its file snapshot.
   */
  async syncPR(prNumber: number, knownHeadSha: string | null): Promise<PrSyncResult> {
    const pr = snapshotOf(await this.pull(prNumber));

    if (knownHeadSha !== null && knownHeadSha.toLowerCase() === pr.headSha) {
      return { pr, revision: null };
    }

    const files: PrFileChange[] = [];
    const patches: { path: string; patch: string | null }[] = [];

    for await (const page of this.client.pages<unknown>(PULL_FILES_ROUTE, {
      ...this.address(),
      pull_number: prNumber,
    })) {
      for (const raw of page.items) {
        const file = parse(filePayload, raw, PULL_FILES_ROUTE);

        files.push({ path: file.filename, additions: file.additions, deletions: file.deletions });
        patches.push({ path: file.filename, patch: file.patch ?? null });
      }
    }

    return {
      pr,
      revision: {
        headSha: pr.headSha,
        pushedAt: pr.updatedAt,
        files,
        diffExcerpt: diffExcerptOf(patches),
      },
    };
  }

  /**
   * Ask GitHub to merge a PR, delete its branch, and verify what its closing keywords closed.
   *
   * @param prNumber - Its number.
   * @param input - The strategy, message and branch deletion.
   * @returns What happened.
   */
  async mergePR(prNumber: number, input: MergePrInput): Promise<MergePrResult> {
    // First, before anything is sent — the acceptance criterion.
    const strategy = assertAdvertisedStrategy(GITHUB_PR_CAPABILITIES, input.strategy);
    const message = input.message.trim();

    if (message === "") {
      throw invalid("a merge needs a message");
    }

    const [commitTitle, ...rest] = message.split("\n");
    const commitMessage = rest.join("\n").trim();
    const before = await this.pull(prNumber);
    const alreadyMerged = hostStateOf(before) === "merged";

    if (!alreadyMerged && before.state === "closed") {
      throw invalid(`#${String(prNumber)} is closed, and a closed PR cannot be merged`);
    }

    let sha: string | null = null;

    if (alreadyMerged) {
      // A retried merge: nothing to send, and the rest still runs — the branch may not have been
      // deleted, and closure is worth verifying again.
      sha = null;
    } else {
      const merged = await this.client.request<unknown>(MERGE_PULL_ROUTE, {
        ...this.address(),
        pull_number: prNumber,
        merge_method: strategy,
        commit_title: commitTitle.trim(),
        ...(commitMessage === "" ? {} : { commit_message: commitMessage }),
      });

      sha = parse(mergeAnswer, merged.data, MERGE_PULL_ROUTE).sha ?? null;
    }

    const branchDeleted = input.deleteBranch ? await this.deleteHead(before) : false;
    const closures: IssueClosure[] = [];

    for (const reference of closingReferences(message, before.body ?? null)) {
      closures.push(await this.closureOf(reference));
    }

    return { sha, alreadyMerged, branchDeleted, closures };
  }

  /**
   * Publish a comment, editing the one an earlier publish under the same key left.
   *
   * @param prNumber - The PR.
   * @param comment - The key and the Markdown.
   * @returns The comment's id and how it landed.
   */
  async commentPR(prNumber: number, comment: PrCommentInput): Promise<PrCommentResult> {
    const body = withPrCommentMarker(comment.body, comment.key);

    if (body.length > MAX_COMMENT_LENGTH) {
      throw invalid(
        `a comment must be at most ${String(MAX_COMMENT_LENGTH)} characters with its marker`,
      );
    }

    for await (const page of this.client.pages<unknown>(ISSUE_COMMENTS_ROUTE, {
      ...this.address(),
      issue_number: prNumber,
    })) {
      for (const raw of page.items) {
        const existing = parse(commentPayload, raw, ISSUE_COMMENTS_ROUTE);

        if (hasPrCommentMarker(existing.body, comment.key)) {
          if (existing.body === body) {
            return { commentId: String(existing.id), mode: "unchanged" };
          }

          await this.client.request<unknown>(UPDATE_COMMENT_ROUTE, {
            ...this.address(),
            comment_id: existing.id,
            body,
          });

          return { commentId: String(existing.id), mode: "edited" };
        }
      }
    }

    const created = await this.client.request<unknown>(CREATE_COMMENT_ROUTE, {
      ...this.address(),
      issue_number: prNumber,
      body,
    });

    return {
      commentId: String(parse(commentPayload, created.data, CREATE_COMMENT_ROUTE).id),
      mode: "created",
    };
  }

  /**
   * Ask a login to review a PR. GitHub treats a login already asked as asked.
   *
   * @param prNumber - The PR.
   * @param user - The login.
   * @returns Who is asked.
   */
  async requestReview(prNumber: number, user: string): Promise<ReviewRequestResult> {
    const login = user.trim();

    if (!GITHUB_LOGIN.test(login)) {
      throw invalid("a reviewer must be a GitHub login");
    }

    const answered = await this.client.request<unknown>(REQUEST_REVIEWERS_ROUTE, {
      ...this.address(),
      pull_number: prNumber,
      reviewers: [login],
    });
    const { requested_reviewers: requested } = parse(
      z.object({ requested_reviewers: z.array(z.object({ login: z.string() })).default([]) }),
      answered.data,
      REQUEST_REVIEWERS_ROUTE,
    );

    return { requested: requested.map((reviewer) => reviewer.login) };
  }

  /**
   * Every PR updated at or after a cursor, oldest first — see this file's header.
   *
   * @param cursor - An ISO-8601 instant this method answered, or null for everything. One that will
   *   not parse is treated as null, so a corrupted cursor costs one wide poll rather than every one.
   * @returns The events, the next cursor, and whether more were waiting.
   */
  async prEvents(cursor: string | null): Promise<PrEventPage> {
    const since = cursor === null ? Number.NaN : Date.parse(cursor);
    const events: PrEvent[] = [];
    let more = false;

    walk: for await (const page of this.client.pages<unknown>(ISSUES_ROUTE, {
      ...this.address(),
      state: "all",
      sort: "updated",
      direction: "asc",
      ...(Number.isNaN(since) ? {} : { since: new Date(since).toISOString() }),
    })) {
      for (const raw of page.items) {
        const row = parse(listedIssue, raw, ISSUES_ROUTE);

        if (row.pull_request === null || row.pull_request === undefined) {
          continue;
        }

        if (events.length >= MAX_PR_EVENTS) {
          more = true;
          break walk;
        }

        events.push({
          number: row.number,
          state: hostStateOf({ state: row.state, merged_at: row.pull_request.merged_at }),
          updatedAt: instantOf(row.updated_at, ISSUES_ROUTE),
        });
      }
    }

    const last = events.at(-1);

    return {
      events,
      nextCursor:
        last === undefined
          ? Number.isNaN(since)
            ? new Date(0).toISOString()
            : new Date(since).toISOString()
          : last.updatedAt.toISOString(),
      hasMore: more,
    };
  }

  /**
   * Delete a merged PR's head branch.
   *
   * @param pull - The PR, as read before the merge.
   * @returns Whether the branch is gone. `false` for a branch in a fork — this token's repository is
   *   not where it lives — or one GitHub refused to delete (a protected branch).
   */
  private async deleteHead(pull: PullPayload): Promise<boolean> {
    const own = `${this.target.owner}/${this.target.repo}`.toLowerCase();

    if (pull.head.repo?.full_name.toLowerCase() !== own) {
      return false;
    }

    try {
      await this.client.request<unknown>(DELETE_REF_ROUTE, {
        ...this.address(),
        ref: `heads/${pull.head.ref}`,
      });

      return true;
    } catch (error) {
      // `422 Reference does not exist` — the repository's own auto-delete got there first. A
      // branch that is gone is the outcome asked for.
      if (error instanceof GithubApiError && error.httpStatus === 422) {
        return true;
      }

      if (error instanceof GithubApiError && error.failure !== GITHUB_FAILURES.rateLimited) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Read back what the host did to one referenced issue.
   *
   * @param reference - The issue a closing keyword named.
   * @returns Closed, or not and why — never a throw: the merge has already happened.
   */
  private async closureOf(reference: ClosingReference): Promise<IssueClosure> {
    try {
      const answered = await this.client.request<unknown>(ISSUE_ROUTE, {
        owner: reference.owner ?? this.target.owner,
        repo: reference.repo ?? this.target.repo,
        issue_number: reference.number,
      });
      const { state } = parse(issueState, answered.data, ISSUE_ROUTE);

      return state === "closed"
        ? { reference: reference.reference, closed: true, detail: null }
        : {
            reference: reference.reference,
            closed: false,
            detail: `${reference.reference} is still ${state} after the merge`,
          };
    } catch (error) {
      const failure = error instanceof GithubApiError ? error.failure : "an unreadable answer";

      return {
        reference: reference.reference,
        closed: false,
        detail: `${reference.reference} could not be verified after the merge (${failure})`,
      };
    }
  }

  /**
   * Read one PR.
   *
   * @param prNumber - Its number.
   * @returns The payload.
   */
  private async pull(prNumber: number): Promise<PullPayload> {
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      throw invalid("a PR number is a whole number ≥ 1");
    }

    const answered = await this.client.request<unknown>(PULL_ROUTE, {
      ...this.address(),
      pull_number: prNumber,
    });

    return parse(pullPayload, answered.data, PULL_ROUTE);
  }

  /**
   * The owner and repository, as route parameters.
   *
   * @returns `{ owner, repo }`.
   */
  private address(): { owner: string; repo: string } {
    return { owner: this.target.owner, repo: this.target.repo };
  }
}

/**
 * Where a PR payload stands on GitHub.
 *
 * @param pull - The payload.
 * @returns `merged` when it carries a merge time, else its `state`.
 */
export function hostStateOf(pull: Pick<PullPayload, "state" | "merged_at">): HostPrState {
  if (pull.merged_at !== null && pull.merged_at !== undefined) {
    return "merged";
  }

  return pull.state;
}

/**
 * A PR payload as the SPI's snapshot.
 *
 * @param pull - What GitHub answered for one PR.
 * @returns The snapshot.
 * @throws {GithubApiError} `upstream_error`, for a link that is not https, a blank title or branch,
 *   a sha that is not hex, or an unreadable instant — a PR V052 could not store.
 */
export function snapshotOf(pull: PullPayload): PullRequestSnapshot {
  const state = hostStateOf(pull);

  if (!HTTPS_URL.test(pull.html_url)) {
    throw upstream(`#${String(pull.number)} answered a link that is not https`);
  }

  if (pull.title.trim() === "" || pull.head.ref.trim() === "" || pull.base.ref.trim() === "") {
    throw upstream(`#${String(pull.number)} answered a blank title or branch`);
  }

  return {
    number: pull.number,
    url: pull.html_url,
    title: pull.title,
    body: pull.body ?? null,
    state,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
    headSha: shaOf(pull.head.sha),
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    mergedAt: state === "merged" ? instantOf(pull.merged_at ?? "", PULL_ROUTE) : null,
    mergedBy: state === "merged" ? (pull.merged_by?.login ?? null) : null,
    updatedAt: instantOf(pull.updated_at, PULL_ROUTE),
  };
}

/**
 * A PR payload as the ref `createPR` answers.
 *
 * @param pull - The payload.
 * @returns `{ number, url }`.
 * @throws {GithubApiError} `upstream_error`, for a link that is not https.
 */
function refOf(pull: PullPayload): PrRef {
  if (!HTTPS_URL.test(pull.html_url)) {
    throw upstream(`#${String(pull.number)} answered a link that is not https`);
  }

  return { number: pull.number, url: pull.html_url };
}

/**
 * A head sha, held to `pr_revisions.head_sha`'s grammar.
 *
 * @param sha - What GitHub answered.
 * @returns It, lower-cased.
 * @throws {GithubApiError} `upstream_error`, when it is not 7–40 hex characters.
 */
function shaOf(sha: string): string {
  const lower = sha.toLowerCase();

  if (!HEAD_SHA.test(lower)) {
    throw upstream("a PR answered a head sha that is not hex");
  }

  return lower;
}

/**
 * An instant GitHub answered.
 *
 * @param value - ISO-8601.
 * @param route - The route, for the refusal.
 * @returns The date.
 * @throws {GithubApiError} `upstream_error`, when it does not parse.
 */
function instantOf(value: string, route: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw upstream(`${route} answered an instant that does not parse`);
  }

  return parsed;
}

/**
 * A branch name, checked before it is sent.
 *
 * @param value - The name.
 * @param field - Which field, for the refusal.
 * @returns It.
 * @throws {TicketSourceError} `validation`, for a name git would refuse.
 */
function branchOf(value: string, field: string): string {
  if (!BRANCH.test(value)) {
    throw invalid(`${field} is not a branch name git would accept`);
  }

  return value;
}

/**
 * A response body, read through a schema.
 *
 * @param schema - What the route promises.
 * @param data - What it answered.
 * @param route - The route, for the log line.
 * @returns The parsed value.
 * @throws {GithubApiError} `upstream_error`, when the answer is not what the route promises.
 */
function parse<T>(schema: z.ZodType<T>, data: unknown, route: string): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw upstream(`${route} answered a body that is not what the route promises`);
  }

  return parsed.data;
}

/**
 * A GitHub answer this file cannot use.
 *
 * @param detail - What was wrong.
 * @returns The error to throw.
 */
function upstream(detail: string): GithubApiError {
  return new GithubApiError(GITHUB_FAILURES.upstreamError, detail);
}

/**
 * A refusal of an argument, before anything is sent.
 *
 * @param detail - What is wrong.
 * @returns The error to throw.
 */
function invalid(detail: string): TicketSourceError {
  return new TicketSourceError("validation", detail);
}
