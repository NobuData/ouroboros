/**
 * The commit a dry run reads at, and the credential it reads with (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * A dry run pins one commit before anything else happens — `dry_runs.pinned_sha` is not
 * nullable, and every read of the virtual workspace resolves at it — so the first step of a
 * start is asking the provider where the repository's default branch is.
 *
 * **The token is per run.** {@link PinnedCommitReader.pin} opens the workspace's GitHub token
 * for the one request the harness makes with it, as `research/code/code.workspace.ts` does for a
 * code read; nothing here keeps it, and it is never part of a record, an event or a log line.
 */

import { Injectable } from "@nestjs/common";

import { GithubClientFactory } from "../github/github.client.factory";
import { GithubCredentialsService } from "../github/github.credentials.service";
import { GithubApiError, githubDomainError } from "../github/github.errors";
import { UpstreamError } from "../errors/error.envelope";

/** A full commit sha — `dry_runs_pinned_sha_format`. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The refusal for a provider answer that names no commit. */
export const DRY_RUN_COMMIT_UNREADABLE = "dry_run_commit_unreadable";

/** Where a dry run reads from. */
export interface PinnedCommit {
  /** `owner/name`. */
  readonly slug: string;
  /** The commit every read resolves at. */
  readonly sha: string;
  /** A read credential for this run. */
  readonly token: string;
}

@Injectable()
export class PinnedCommitReader {
  /**
   * @param clients - The authenticated, rate-guarded GitHub client.
   * @param credentials - The workspace's token, opened per run.
   */
  constructor(
    private readonly clients: GithubClientFactory,
    private readonly credentials: GithubCredentialsService,
  ) {}

  /**
   * Pin the head of a repository's branch.
   *
   * @param organizationId - The workspace.
   * @param owner - The repository's owner.
   * @param name - The repository's name.
   * @param branch - The branch to pin — the mirror's default branch — or `null` for `HEAD`.
   * @returns The slug, the commit and the token.
   * @throws {DomainError} `409` when the workspace has no GitHub token, `404` when GitHub has
   *   no such repository for it, `502` for the ways GitHub can refuse — `github.errors.ts`'
   *   mapping — and `502 dry_run_commit_unreadable` for an answer that names no commit.
   */
  async pin(
    organizationId: string,
    owner: string,
    name: string,
    branch: string | null,
  ): Promise<PinnedCommit> {
    try {
      const client = await this.clients.forOrganization(organizationId);
      const { data } = await client.request<{ sha?: unknown }>(
        "GET /repos/{owner}/{repo}/commits/{ref}",
        { owner, repo: name, ref: branch ?? "HEAD" },
      );
      const sha = data?.sha;

      if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
        throw new UpstreamError(
          DRY_RUN_COMMIT_UNREADABLE,
          `GitHub did not name a commit for ${owner}/${name}.`,
        );
      }

      return {
        slug: `${owner}/${name}`,
        sha,
        token: await this.credentials.tokenFor(organizationId),
      };
    } catch (error) {
      if (error instanceof GithubApiError) throw githubDomainError(error);
      throw error;
    }
  }
}
