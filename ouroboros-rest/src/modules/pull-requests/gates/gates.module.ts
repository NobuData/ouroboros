/**
 * `GatesModule` — the gate engine (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)).
 *
 * It exports {@link GATE_EVIDENCE}, bound `useExisting` to {@link GateEngineService}, so every
 * evidence emitter — the PR sync, the artifact upload's parse, the agent gateway's `job.finish` and
 * the change-set ingest — depends on the `GateEvidenceSink` interface only. It imports nothing but
 * `DbModule` and `PoliciesModule` (BQ.2, #481 — the shared policy resolver, which imports only the
 * database and the audit trail), which is what lets those four modules import it without a cycle.
 *
 * It exports {@link GateListeners} too — the registry the merge executor (#360) hears each
 * evaluation on, without the engine importing it.
 *
 * {@link ORG_GATE_POLICY} is bound to `OrgPolicyGateResolver` since #461: the published org policy's
 * `human_review` rule, read since #481 through `PolicyResolutionService`, and the defaults for the
 * overrides and the license allow-list, which the policy document does not hold.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { GuardrailsRepository } from "../../guardrails/guardrails.repository";
import { PoliciesModule } from "../../policies/policies.module";
import { GATE_EVIDENCE } from "./gate.evidence";
import { GateListeners } from "./gate.listeners";
import { OrgPolicyGateResolver } from "./gate.org-policy";
import { ORG_GATE_POLICY } from "./gate.policy";
import { GateRepository } from "./gate.repository";
import { GateEngineService } from "./gate.service";

/**
 * The org policy binding (#461's #358 amendment): the published policy's `human_review` rule and
 * the version it was read from (#481), with every other setting at the defaults.
 */
export const orgGatePolicyProvider = {
  provide: ORG_GATE_POLICY,
  useExisting: OrgPolicyGateResolver,
};

/** The sink binding, stated once so the module and its spec agree on it. */
export const gateEvidenceProvider = { provide: GATE_EVIDENCE, useExisting: GateEngineService };

@Module({
  imports: [DbModule, PoliciesModule],
  providers: [
    GuardrailsRepository,
    GateRepository,
    GateEngineService,
    GateListeners,
    OrgPolicyGateResolver,
    orgGatePolicyProvider,
    gateEvidenceProvider,
  ],
  // `OrgPolicyGateResolver` too (BN.4, #464): the inbox's policy card reads the document the engine
  // enforces through the same reader, bound `useExisting` so both are one instance.
  exports: [GateEngineService, GATE_EVIDENCE, GateListeners, OrgPolicyGateResolver],
})
export class GatesModule {}
