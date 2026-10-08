/**
 * The research tool SPI's module — and the single place an adapter is registered.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decision **V2**. Every adapter
 * lives in `./adapters/` and is bound here under {@link RESEARCH_TOOL_ADAPTERS}; nothing else in
 * the service may import one (`.dependency-cruiser.cjs`, `research-tool-core-imports-the-spi-only`).
 *
 * No adapter ships in CL.1 — the in-memory fake is test support — so the list is empty and the
 * internal surface answers `501 research_tool_not_registered` until CL.2–CL.6 (#615–#619) each add
 * a line here.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import type { ResearchToolAdapter } from "./research-tool.adapter";
import { ResearchToolInvoker } from "./research-tool.invoker";
import { RESEARCH_TOOL_ADAPTERS, ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolRepository } from "./research-tool.repository";
import { ResearchToolSettings } from "./research-tool.settings";
import { ResearchToolsInternalController } from "./tools.internal.controller";

/** The adapters this build ships. CL.2–CL.6 add theirs. */
const REGISTERED_ADAPTERS: readonly ResearchToolAdapter[] = [];

@Module({
  imports: [DbModule],
  controllers: [ResearchToolsInternalController],
  providers: [
    { provide: RESEARCH_TOOL_ADAPTERS, useValue: REGISTERED_ADAPTERS },
    ResearchToolRegistry,
    ResearchToolRepository,
    ResearchToolSettings,
    ResearchToolInvoker,
  ],
  exports: [ResearchToolRegistry, ResearchToolSettings],
})
export class ResearchToolsModule {}
