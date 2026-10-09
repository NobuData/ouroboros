/**
 * The research tool SPI's module — and the single place an adapter is registered.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decision **V2**. Every adapter
 * lives in `./adapters/` and is bound here under {@link RESEARCH_TOOL_ADAPTERS}; nothing else in
 * the service may import one (`.dependency-cruiser.cjs`, `research-tool-core-imports-the-spi-only`).
 *
 * CL.2 (#615) registers the first, `web`, built from the deployment's `OURO_RESEARCH_*`
 * configuration; CL.3–CL.6 (#616–#619) each add a line to {@link registeredAdapters}. A slug with no
 * adapter answers `501 research_tool_not_registered`.
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { buildWebTool } from "./adapters/web/web.factory";
import type { ResearchToolAdapter } from "./research-tool.adapter";
import { ResearchToolInvoker } from "./research-tool.invoker";
import { RESEARCH_TOOL_ADAPTERS, ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolRepository } from "./research-tool.repository";
import { ResearchToolSettings } from "./research-tool.settings";
import { ResearchToolsInternalController } from "./tools.internal.controller";

/**
 * The adapters this build ships. CL.3–CL.6 add theirs.
 *
 * @param config - The deployment's configuration, for each adapter's bounds and defaults.
 * @returns One adapter per registered slug.
 */
export function registeredAdapters(config: AppConfigService): readonly ResearchToolAdapter[] {
  return [buildWebTool(config)];
}

@Module({
  imports: [DbModule],
  controllers: [ResearchToolsInternalController],
  providers: [
    { provide: RESEARCH_TOOL_ADAPTERS, inject: [AppConfigService], useFactory: registeredAdapters },
    ResearchToolRegistry,
    ResearchToolRepository,
    ResearchToolSettings,
    ResearchToolInvoker,
  ],
  exports: [ResearchToolRegistry, ResearchToolSettings],
})
export class ResearchToolsModule {}
