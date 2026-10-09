import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../../../../config/config.module";
import { testConfiguration } from "../../../../config/configuration.fixture";
import { RESEARCH_TOOL_ADAPTERS } from "../../research-tool.registry";
import { RESEARCH_PAGE_FETCHER, ResearchToolsModule } from "../../research-tools.module";
import { PageFetcher } from "../web/web.fetcher";
import { WebResearchTool } from "../web/web.tool";
import { CompetitorWatchScheduler } from "./competitor.scheduler";
import { CompetitorResearchTool } from "./competitor.tool";

/**
 * The tracker's wiring: its scheduler is a provider (so it boots and stops with the application),
 * and the page reader is one instance shared with the web tool. Nothing connects.
 */
describe("the competitor tracker's wiring", () => {
  it("registers the tool and its scheduler, and shares one page reader", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ResearchToolsModule],
    }).compile();

    const adapters = moduleRef.get<readonly unknown[]>(RESEARCH_TOOL_ADAPTERS);

    expect(adapters.some((adapter) => adapter instanceof CompetitorResearchTool)).toBe(true);
    expect(adapters.some((adapter) => adapter instanceof WebResearchTool)).toBe(true);
    expect(moduleRef.get(CompetitorWatchScheduler)).toBeInstanceOf(CompetitorWatchScheduler);
    expect(moduleRef.get(RESEARCH_PAGE_FETCHER)).toBeInstanceOf(PageFetcher);

    await moduleRef.close();
  });
});
