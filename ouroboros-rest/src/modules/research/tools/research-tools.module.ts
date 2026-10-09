/**
 * The research tool SPI's module — and the single place an adapter is registered.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decision **V2**. Every adapter
 * lives in `./adapters/` and is bound here under {@link RESEARCH_TOOL_ADAPTERS}; nothing else in
 * the service may import one (`.dependency-cruiser.cjs`, `research-tool-core-imports-the-spi-only`).
 *
 * CL.2 (#615) registers the first, `web`, built from the deployment's `OURO_RESEARCH_*`
 * configuration; CL.3 (#616) the second, `competitor`, with the watch scheduler that feeds it.
 * CL.4–CL.6 (#617–#619) each add a line to {@link registeredAdapters}. A slug with no adapter
 * answers `501 research_tool_not_registered`.
 *
 * The page reader is one provider ({@link RESEARCH_PAGE_FETCHER}), shared by the web tool and the
 * tracker's snapshots, so robots.txt is read once per site and a host is paced across both.
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { GithubClientFactory } from "../../github/github.client.factory";
import { GithubModule } from "../../github/github.module";
import { CompetitorsModule } from "../competitors/competitors.module";
import { CompetitorsRepository } from "../competitors/competitors.repository";
import { buildCompetitorTool, buildWatchScheduler } from "./adapters/competitor/competitor.factory";
import { CompetitorWatchScheduler } from "./adapters/competitor/competitor.scheduler";
import type { PageFetcher } from "./adapters/web/web.fetcher";
import { buildPageFetcher, buildWebTool } from "./adapters/web/web.factory";
import type { ResearchToolAdapter } from "./research-tool.adapter";
import { ResearchToolInvoker } from "./research-tool.invoker";
import { RESEARCH_TOOL_ADAPTERS, ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolRepository } from "./research-tool.repository";
import { ResearchToolSettings } from "./research-tool.settings";
import { ResearchToolsInternalController } from "./tools.internal.controller";

/** The DI token the shared page reader is bound under. */
export const RESEARCH_PAGE_FETCHER = Symbol("RESEARCH_PAGE_FETCHER");

/**
 * The adapters this build ships. CL.4–CL.6 add theirs.
 *
 * @param config - The deployment's configuration, for each adapter's bounds and defaults.
 * @param fetcher - The shared page reader.
 * @param competitors - The competitor registry and archive.
 * @returns One adapter per registered slug.
 */
export function registeredAdapters(
  config: AppConfigService,
  fetcher: PageFetcher,
  competitors: CompetitorsRepository,
): readonly ResearchToolAdapter[] {
  return [buildWebTool(config, fetcher), buildCompetitorTool(competitors)];
}

@Module({
  imports: [DbModule, CompetitorsModule, GithubModule],
  controllers: [ResearchToolsInternalController],
  providers: [
    { provide: RESEARCH_PAGE_FETCHER, inject: [AppConfigService], useFactory: buildPageFetcher },
    {
      provide: RESEARCH_TOOL_ADAPTERS,
      inject: [AppConfigService, RESEARCH_PAGE_FETCHER, CompetitorsRepository],
      useFactory: registeredAdapters,
    },
    {
      provide: CompetitorWatchScheduler,
      inject: [AppConfigService, RESEARCH_PAGE_FETCHER, CompetitorsRepository, GithubClientFactory],
      useFactory: buildWatchScheduler,
    },
    ResearchToolRegistry,
    ResearchToolRepository,
    ResearchToolSettings,
    ResearchToolInvoker,
  ],
  exports: [ResearchToolRegistry, ResearchToolSettings],
})
export class ResearchToolsModule {}
