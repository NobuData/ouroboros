/**
 * `PathPreviewService` — what a `protected_paths` glob actually covers, before it is published
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * ```
 * globs ─▶ grammar check ─▶ each enabled repository ─▶ its tree ─▶ match counts and samples
 *          (path_glob)       (github_repos, as the     (one host     (guardrails.glob.ts — the
 *                             backlog sync reads)        request,      matcher AP.3 enforces with)
 *                                                        cached 60 s)
 * ```
 *
 * - **It reads the repository the way a scan does** — `DetectionService.readTree`, through the
 *   source that covers the repository and that source's rate guard (#384, #101). Never a clone.
 * - **A repository that cannot be listed is an answer, not a failure.** No connected source, a
 *   host refusal or a rate limit makes that one repository `unavailable` with a sentence saying
 *   why; the others are still previewed, and the request is never a `5xx` for it.
 * - **Trees are cached for {@link TREE_CACHE_TTL_MS} per process.** The editor asks again on every
 *   settled keystroke, and each listing is a request on the connection the backlog sync depends
 *   on. A minute-old tree is an honest preview; only a successful listing is kept.
 * - **It writes nothing and audits nothing** — a preview is a question.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { DETECTION_ERRORS } from "../detection/detection.errors";
import { DetectionService } from "../detection/detection.service";
import { DomainError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { RepoMapRepository } from "../repo-map/repo-map.repository";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { type GlobMatchResource, assertPolicyPathGlobs, filesOf, matchGlobs } from "./path-preview";

/** How long a listed tree answers previews before it is listed again — one minute. */
export const TREE_CACHE_TTL_MS = 60_000;

/** Why a repository's tree could not be listed, as the editor says it. */
export const PATH_PREVIEW_REASONS = Object.freeze({
  noSource: "No connected source covers this repository, so its files cannot be listed.",
  rateLimit: "The repository host is rate-limiting this workspace. Try again shortly.",
  hostError: "The repository host could not list this repository's files.",
});

/** What the globs cover in one repository. */
export interface RepositoryPreviewResource {
  /** `owner/name`, lower-case. */
  readonly repository: string;
  /** Whether its tree was listed. */
  readonly status: "listed" | "unavailable";
  /** Why not, for an `unavailable` repository; null otherwise. */
  readonly reason: string | null;
  /** How many files the listing holds; null when it could not be listed. */
  readonly fileCount: number | null;
  /** Whether the host cut the listing short — the counts are then of *some* of the files. */
  readonly truncated: boolean;
  /** One answer per glob, in the request's order. Zero matches each when `unavailable`. */
  readonly globs: readonly GlobMatchResource[];
}

/** The preview: every enabled repository of the workspace, by name. */
export interface PathPreviewResource {
  readonly repositories: readonly RepositoryPreviewResource[];
}

/** Which repositories a workspace has enabled — `RepoMapRepository.enabledRepos`. */
export type PathPreviewRepos = Pick<RepoMapRepository, "enabledRepos">;

/** What lists a repository's tree — `DetectionService.readTree`. */
export type PathPreviewReader = Pick<DetectionService, "readTree">;

/** A repository's files as last listed. */
interface CachedTree {
  readonly files: readonly string[];
  readonly truncated: boolean;
  /** When it was listed, in ms. */
  readonly at: number;
}

@Injectable()
export class PathPreviewService {
  /** Where an unexpected listing failure is reported. Never a credential. */
  private readonly logger = new Logger(PathPreviewService.name);

  /** Each `(workspace, repository)`'s tree as last listed by this process. */
  private readonly trees = new Map<string, CachedTree>();

  /**
   * @param repos - The workspace's enabled repositories.
   * @param reader - The tree listing.
   */
  constructor(
    @Inject(RepoMapRepository) private readonly repos: PathPreviewRepos,
    @Inject(DetectionService) private readonly reader: PathPreviewReader,
  ) {}

  /**
   * The clock — a method so a test can pin it.
   *
   * @returns Now, in ms.
   */
  now(): number {
    return Date.now();
  }

  /**
   * What each glob covers in each enabled repository of a workspace.
   *
   * @param organizationId - The workspace.
   * @param globs - The patterns, a non-empty list of distinct strings.
   * @returns One entry per enabled repository, by name — empty for a workspace with none.
   * @throws {InvalidRequestError} `policy_path_glob_invalid` — before any host request.
   */
  async preview(organizationId: string, globs: readonly string[]): Promise<PathPreviewResource> {
    assertPolicyPathGlobs(globs);

    const repositories: RepositoryPreviewResource[] = [];

    // One at a time: each uncached listing is a request on the source's host budget.
    for (const { repo } of await this.repos.enabledRepos(organizationId)) {
      repositories.push(await this.previewRepository(organizationId, repo, globs));
    }

    return { repositories };
  }

  /**
   * One repository's answer.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param globs - The patterns.
   * @returns What they cover there, or why the repository could not be listed.
   */
  private async previewRepository(
    organizationId: string,
    repo: string,
    globs: readonly string[],
  ): Promise<RepositoryPreviewResource> {
    const listed = await this.tree(organizationId, repo);

    if ("reason" in listed) {
      return {
        repository: repo,
        status: "unavailable",
        reason: listed.reason,
        fileCount: null,
        truncated: false,
        globs: matchGlobs(globs, []),
      };
    }

    return {
      repository: repo,
      status: "listed",
      reason: null,
      fileCount: listed.files.length,
      truncated: listed.truncated,
      globs: matchGlobs(globs, listed.files),
    };
  }

  /**
   * A repository's files — from the cache while fresh, else listed and remembered.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The files, or why they could not be listed. A failure is never cached.
   */
  private async tree(
    organizationId: string,
    repo: string,
  ): Promise<CachedTree | { readonly reason: string }> {
    const key = `${organizationId}\u0000${repo}`;
    const now = this.now();

    this.evictStale(now);

    const cached = this.trees.get(key);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const { tree } = await this.reader.readTree(organizationId, repo, () => []);
      const fresh: CachedTree = { files: filesOf(tree), truncated: tree.truncated, at: now };

      this.trees.set(key, fresh);

      return fresh;
    } catch (error) {
      if (TicketSourceError.is(error)) {
        return {
          reason:
            error.errorClass === "rate_limit"
              ? PATH_PREVIEW_REASONS.rateLimit
              : PATH_PREVIEW_REASONS.hostError,
        };
      }

      if (error instanceof DomainError && error.code === DETECTION_ERRORS.sourceMissing) {
        return { reason: PATH_PREVIEW_REASONS.noSource };
      }

      // Anything else is this service's fault, not the caller's — said as the host's failure to
      // list, logged in full, and the other repositories are still previewed.
      this.logger.error(`Listing ${repo} for a path preview failed.`, describeForLog(error));

      return { reason: PATH_PREVIEW_REASONS.hostError };
    }
  }

  /**
   * Drop every tree older than {@link TREE_CACHE_TTL_MS}, so the cache holds only what a preview
   * in the last minute listed.
   *
   * @param now - The clock, in ms.
   */
  private evictStale(now: number): void {
    for (const [key, cached] of this.trees) {
      if (now - cached.at >= TREE_CACHE_TTL_MS) {
        this.trees.delete(key);
      }
    }
  }
}
