/**
 * Detection — `RepoDetectionService`: versioned rule packs probing a repository through the
 * ticket-source SPI, producing the onboarding card's six evidence-bearing rows without cloning
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * ```
 * controller   routes and request shape                      → detection.controller.ts
 * service      debounce, source choice, store, reconcile      → detection.service.ts
 * scan         packs × probes inside a budget (pure)          → detection.scan.ts
 * registry     the packs, checked at boot                     → detection.registry.ts
 * packs        the six core packs                             → packs/
 * reconcile    tests row detected → measured (pure)           → detection.reconcile.ts
 * repository   the statements                                 → detection.repository.ts
 * ```
 *
 * It reaches a repository only through `TicketSourceRegistry` and `supportsRepoProbes` — never a
 * provider import (`ticket-source-core-imports-the-spi-only`).
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { DetectionController } from "./detection.controller";
import { RULE_PACKS, RulePackRegistry } from "./detection.registry";
import { DetectionRepository } from "./detection.repository";
import { DEFAULT_SCAN_BUDGET } from "./detection.scan";
import { DetectionService, SCAN_BUDGET } from "./detection.service";
import { CORE_PACKS } from "./packs/core.packs";

@Module({
  imports: [DbModule, TicketSourcesModule],
  controllers: [DetectionController],
  providers: [
    DetectionService,
    DetectionRepository,
    RulePackRegistry,
    // The registration point: a new pack is an entry in `CORE_PACKS`, not a change here.
    { provide: RULE_PACKS, useValue: CORE_PACKS },
    { provide: SCAN_BUDGET, useValue: DEFAULT_SCAN_BUDGET },
  ],
  exports: [DetectionService],
})
export class DetectionModule {}
