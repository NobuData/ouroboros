/**
 * The GitHub provider's repository-document operations (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)) — see `ticket-source.repo-doc.ts`.
 *
 * ```
 * defaultBranch   GET  /repos/{owner}/{repo}
 * fileAt          GET  /repos/{owner}/{repo}/contents/{path}?ref=
 *                 GET  /repos/{owner}/{repo}/commits?path=&sha=&per_page=1
 * commitFile      GET  /repos/{owner}/{repo}/git/ref/heads/{branch}   ─┐ only when the branch
 *                 POST /repos/{owner}/{repo}/git/refs                 ─┘ is missing
 *                 PUT  /repos/{owner}/{repo}/contents/{path}
 * updatePR        PATCH /repos/{owner}/{repo}/pulls/{pull_number}
 * ```
 *
 * Built per call and dropped with it, as `GithubWriter` is: the client holds the credential.
 * Throws `TicketSourceError` `validation` for an argument it refuses before sending anything, and
 * K.3's `GithubApiError` for anything GitHub refused; `github.provider.ts` classifies the latter.
 */

import { z } from "zod";

import type { GithubClient } from "../../github/github.client";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { TicketSourceError } from "../ticket-source.errors";
import {
  isRepoDocPath,
  type CommitFileInput,
  type CommitFileResult,
  type RepoDocState,
  type UpdatePrInput,
} from "../ticket-source.repo-doc";
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./github.mapping";
import type { GithubTarget } from "./github.write";

/** Read a repository. */
export const REPO_ROUTE = "GET /repos/{owner}/{repo}";

/** Read a file at a ref. */
export const CONTENTS_AT_ROUTE = "GET /repos/{owner}/{repo}/contents/{path}";

/** Create or update a file. */
export const PUT_CONTENTS_ROUTE = "PUT /repos/{owner}/{repo}/contents/{path}";

/** The commits that touched a path, newest first. */
export const COMMITS_ROUTE = "GET /repos/{owner}/{repo}/commits";

/** Read a branch's head. */
export const BRANCH_REF_ROUTE = "GET /repos/{owner}/{repo}/git/ref/{ref}";

/** Create a branch. */
export const CREATE_REF_ROUTE = "POST /repos/{owner}/{repo}/git/refs";

/** Edit a PR. */
export const UPDATE_PULL_ROUTE = "PATCH /repos/{owner}/{repo}/pulls/{pull_number}";

/** The largest document this file will send — V113's bound on a version's markdown. */
export const MAX_DOC_BYTES = 524_288;

/** The longest commit message sent. */
export const MAX_COMMIT_MESSAGE_LENGTH = 2_000;

/** GitHub's answer for something that is not there. */
const NOT_FOUND = 404;

/** A git branch name this file will send — no whitespace, no `..`, no leading `-`. */
const BRANCH = /^(?!-)(?!.*\.\.)[^\s~^:?*[\\]{1,255}$/;

const repoPayload = z.object({ default_branch: z.string().min(1) });
const contentsPayload = z.object({
  type: z.string(),
  sha: z.string(),
  encoding: z.string().nullish(),
  content: z.string().nullish(),
});
const commitsPayload = z.array(z.object({ sha: z.string() }));
const refPayload = z.object({ object: z.object({ sha: z.string() }) });
const putPayload = z.object({ commit: z.object({ sha: z.string() }) });

/** The provider's repository-document operations against one repository, over K.3's client. */
export class GithubRepoDocs {
  /**
   * @param client - K.3's client for this source's token and budget.
   * @param target - The repository.
   */
  constructor(
    private readonly client: GithubClient,
    private readonly target: GithubTarget,
  ) {}

  /**
   * The repository's default branch.
   *
   * @returns Its name.
   */
  async defaultBranch(): Promise<string> {
    const answered = await this.client.request<unknown>(REPO_ROUTE, this.address());

    return parse(repoPayload, answered.data, REPO_ROUTE).default_branch;
  }

  /**
   * One file as a ref holds it.
   *
   * @param path - Relative to the root.
   * @param ref - A branch name or commit sha.
   * @returns The file with its blob and last commit; `null` when the ref holds no file there.
   */
  async fileAt(path: string, ref: string): Promise<RepoDocState | null> {
    pathOf(path);

    if (ref.trim() === "") {
      throw invalid("a ref is needed to read a file at");
    }

    let data: z.infer<typeof contentsPayload>;

    try {
      const answered = await this.client.request<unknown>(CONTENTS_AT_ROUTE, {
        ...this.address(),
        path,
        ref,
      });

      if (Array.isArray(answered.data)) {
        return null;
      }

      data = parse(contentsPayload, answered.data, CONTENTS_AT_ROUTE);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }

    if (data.type !== "file") {
      return null;
    }

    const content =
      data.encoding === "base64" && typeof data.content === "string"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : "";

    return { content, blobSha: data.sha, commitSha: await this.lastCommit(path, ref) };
  }

  /**
   * Commit one file to a branch — or find that the branch already holds exactly this content.
   *
   * @param input - The file, its text, the message and the branches.
   * @returns The commit, and whether anything was written.
   */
  async commitFile(input: CommitFileInput): Promise<CommitFileResult> {
    pathOf(input.path);
    branchOf(input.branch, "branch");
    branchOf(input.base, "base");

    const message = input.message.trim();

    if (message === "" || message.length > MAX_COMMIT_MESSAGE_LENGTH) {
      throw invalid(
        `a commit message must be non-blank and at most ${String(MAX_COMMIT_MESSAGE_LENGTH)} characters`,
      );
    }

    if (Buffer.byteLength(input.content, "utf8") > MAX_DOC_BYTES) {
      throw invalid(`a document must be at most ${String(MAX_DOC_BYTES)} bytes`);
    }

    const head = await this.ensureBranch(input.branch, input.base);
    const existing = await this.fileAt(input.path, input.branch);

    if (existing?.content === input.content) {
      return { commitSha: existing.commitSha ?? head, changed: false };
    }

    const written = await this.client.request<unknown>(PUT_CONTENTS_ROUTE, {
      ...this.address(),
      path: input.path,
      message,
      content: Buffer.from(input.content, "utf8").toString("base64"),
      branch: input.branch,
      ...(existing === null ? {} : { sha: existing.blobSha }),
    });

    return {
      commitSha: parse(putPayload, written.data, PUT_CONTENTS_ROUTE).commit.sha,
      changed: true,
    };
  }

  /**
   * Change a PR's title or description.
   *
   * @param prNumber - Its number.
   * @param input - The fields to change; nothing is sent when neither is present.
   */
  async updatePR(prNumber: number, input: UpdatePrInput): Promise<void> {
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      throw invalid("a PR number is a positive whole number");
    }

    const title = input.title?.trim();

    if (title !== undefined && (title === "" || title.length > MAX_TITLE_LENGTH)) {
      throw invalid(
        `a PR title must be non-blank and at most ${String(MAX_TITLE_LENGTH)} characters`,
      );
    }

    if (input.body !== undefined && input.body.length > MAX_BODY_LENGTH) {
      throw invalid(`a PR description must be at most ${String(MAX_BODY_LENGTH)} characters`);
    }

    if (title === undefined && input.body === undefined) {
      return;
    }

    await this.client.request<unknown>(UPDATE_PULL_ROUTE, {
      ...this.address(),
      pull_number: prNumber,
      ...(title === undefined ? {} : { title }),
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  /**
   * A branch's head, creating the branch from `base` when it does not exist.
   *
   * @param branch - The branch.
   * @param base - What a missing branch is cut from.
   * @returns The branch's head commit.
   * @throws {TicketSourceError} `validation` when neither the branch nor its base exists.
   */
  private async ensureBranch(branch: string, base: string): Promise<string> {
    const head = await this.branchHead(branch);

    if (head !== null) {
      return head;
    }

    const from = branch === base ? null : await this.branchHead(base);

    if (from === null) {
      throw invalid(`branch ${base} does not exist, so ${branch} cannot be created from it`);
    }

    await this.client.request<unknown>(CREATE_REF_ROUTE, {
      ...this.address(),
      ref: `refs/heads/${branch}`,
      sha: from,
    });

    return from;
  }

  /**
   * A branch's head commit.
   *
   * @param branch - The branch.
   * @returns The sha, or `null` when there is no such branch.
   */
  private async branchHead(branch: string): Promise<string | null> {
    try {
      const answered = await this.client.request<unknown>(BRANCH_REF_ROUTE, {
        ...this.address(),
        ref: `heads/${branch}`,
      });

      return parse(refPayload, answered.data, BRANCH_REF_ROUTE).object.sha;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * The commit that last touched a path on a ref.
   *
   * @param path - The file.
   * @param ref - The branch or commit.
   * @returns Its sha, or `null` when the history names none.
   */
  private async lastCommit(path: string, ref: string): Promise<string | null> {
    const answered = await this.client.request<unknown>(COMMITS_ROUTE, {
      ...this.address(),
      path,
      sha: ref,
      per_page: 1,
    });

    return parse(commitsPayload, answered.data, COMMITS_ROUTE)[0]?.sha ?? null;
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
 * Whether an error is GitHub saying something is not there.
 *
 * @param error - Anything thrown.
 * @returns True for a `404`.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof GithubApiError && error.httpStatus === NOT_FOUND;
}

/**
 * A document path this file will send.
 *
 * @param path - The path.
 * @returns It, unchanged.
 * @throws {TicketSourceError} `validation` when it is not a relative path without `..`.
 */
function pathOf(path: string): string {
  if (!isRepoDocPath(path)) {
    throw invalid("a document path must be relative, with no empty, `.` or `..` segment");
  }

  return path;
}

/**
 * A branch name git would accept.
 *
 * @param value - The name.
 * @param field - What it is, for the message.
 * @returns It, unchanged.
 * @throws {TicketSourceError} `validation` otherwise.
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
 * @param route - The route, for the message.
 * @returns The parsed value.
 * @throws {GithubApiError} `upstream_error` when the body is not what the route promises.
 */
function parse<T>(schema: z.ZodType<T>, data: unknown, route: string): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw new GithubApiError(
      GITHUB_FAILURES.upstreamError,
      `${route} answered a body that is not what the route promises`,
    );
  }

  return parsed.data;
}

/**
 * A refused argument.
 *
 * @param detail - What was wrong.
 * @returns The error to throw.
 */
function invalid(detail: string): TicketSourceError {
  return new TicketSourceError("validation", detail);
}
