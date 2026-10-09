/**
 * Build the competitor tracker from the deployment — the one place its readers, its store and
 * the `OURO_RESEARCH_WATCH_*` variables meet, called by `research-tools.module.ts`.
 */

import type { AppConfigService } from "../../../../config/config.service";
import type { GithubClientFactory } from "../../../../github/github.client.factory";
import type { CompetitorsRepository } from "../../../competitors/competitors.repository";
import type { PageFetcher } from "../web/web.fetcher";
import { RELEASES_PER_CHECK, type GithubRelease } from "./competitor.github";
import { CompetitorWatchScheduler } from "./competitor.scheduler";
import { CompetitorSnapshotter, type ReleasesReader } from "./competitor.snapshotter";
import { CompetitorResearchTool } from "./competitor.tool";

/**
 * The production tool.
 *
 * @param repository - The registry and archive.
 * @returns The adapter.
 */
export function buildCompetitorTool(repository: CompetitorsRepository): CompetitorResearchTool {
  return new CompetitorResearchTool(repository);
}

/**
 * Releases through the workspace's GitHub client — its token, its rate guard.
 *
 * @param github - The client factory.
 * @returns The reader.
 */
export function githubReleasesReader(github: GithubClientFactory): ReleasesReader {
  return async (organizationId, { owner, repo }) => {
    const client = await github.forOrganization(organizationId);
    const answer = await client.request<GithubRelease[]>("GET /repos/{owner}/{repo}/releases", {
      owner,
      repo,
      per_page: RELEASES_PER_CHECK,
    });
    return Array.isArray(answer.data) ? answer.data : [];
  };
}

/**
 * The production scheduler, with its snapshotter.
 *
 * @param config - The deployment's configuration.
 * @param fetcher - The shared page reader.
 * @param repository - The registry and archive.
 * @param github - The GitHub client factory.
 * @returns The scheduler; it starts ticking when the application boots.
 */
export function buildWatchScheduler(
  config: AppConfigService,
  fetcher: PageFetcher,
  repository: CompetitorsRepository,
  github: GithubClientFactory,
): CompetitorWatchScheduler {
  const snapshotter = new CompetitorSnapshotter({
    store: repository,
    pages: fetcher,
    releases: githubReleasesReader(github),
  });

  return new CompetitorWatchScheduler({
    claim: (now, limit, leaseUntil) => repository.claimDue(now, limit, leaseUntil),
    check: (watch, now) => snapshotter.check(watch, now),
    tickMs: config.researchWatchTickMs,
    batch: config.researchWatchBatch,
  });
}
