/**
 * `GatesModule` — the gate engine (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)).
 *
 * It exports {@link GATE_EVIDENCE}, bound `useExisting` to {@link GateEngineService}, so every
 * evidence emitter — the PR sync, the artifact upload's parse, the agent gateway's `job.finish` and
 * the change-set ingest — depends on the `GateEvidenceSink` interface only. It imports nothing but
 * `DbModule`, which is what lets those four modules import it without a cycle.
 *
 * {@link ORG_GATE_POLICY} is bound to the defaults until the org policy document's resolver
 * (#481) rebinds it.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { GuardrailsRepository } from "../../guardrails/guardrails.repository";
import { GATE_EVIDENCE } from "./gate.evidence";
import { DEFAULT_ORG_GATE_POLICY, ORG_GATE_POLICY } from "./gate.policy";
import { GateRepository } from "./gate.repository";
import { GateEngineService } from "./gate.service";

/** The sink binding, stated once so the module and its spec agree on it. */
export const gateEvidenceProvider = { provide: GATE_EVIDENCE, useExisting: GateEngineService };

@Module({
  imports: [DbModule],
  providers: [
    GuardrailsRepository,
    GateRepository,
    GateEngineService,
    { provide: ORG_GATE_POLICY, useValue: DEFAULT_ORG_GATE_POLICY },
    gateEvidenceProvider,
  ],
  exports: [GateEngineService, GATE_EVIDENCE],
})
export class GatesModule {}
