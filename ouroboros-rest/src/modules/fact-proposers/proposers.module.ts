/**
 * `FactProposersModule` — BF.3's deterministic fact proposers
 * ([#412](https://github.com/NobuData/ouroboros/issues/412), decision **K5**).
 *
 * ```
 * proposers.text        lead-instruction extraction, inline-code spans verbatim (pure)
 * proposers.types       candidate, proposal, outcome; sealCandidate — no status, ever (pure)
 * proposers.registry    the versioned, declarative entries: correction_note, waiver, steer, import
 * proposers.learn       the /v0/learn contract's candidates → registry candidates (#423's plug)
 * proposers.repository  sources by id, a run's sources, the dedupe baseline, fact_suppressions
 * proposers.service     propose → dedupe → FactsService.propose | suppression; the observer
 * proposers.controller  the registry, the suppressions, the backfill
 * ```
 *
 * It exports `FACT_SOURCE_OBSERVER`, bound to the service, for the triage, criteria and controls
 * services to report a new source on. It imports `FactsModule` for `FactsService.propose` — the
 * lifecycle's entry point, the only way a candidate becomes a fact.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { FactsModule } from "../facts/facts.module";
import { FactProposersController } from "./proposers.controller";
import { FACT_SOURCE_OBSERVER } from "./proposers.observer";
import { ProposerRepository } from "./proposers.repository";
import { FactProposersService } from "./proposers.service";

@Module({
  imports: [DbModule, FactsModule],
  controllers: [FactProposersController],
  providers: [
    ProposerRepository,
    FactProposersService,
    { provide: FACT_SOURCE_OBSERVER, useExisting: FactProposersService },
  ],
  exports: [FACT_SOURCE_OBSERVER],
})
export class FactProposersModule {}
