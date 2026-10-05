import { DbModule } from "../../db/db.module";
import { PoliciesModule } from "../../policies/policies.module";
import { GATE_EVIDENCE } from "./gate.evidence";
import { GateListeners } from "./gate.listeners";
import { OrgPolicyGateResolver } from "./gate.org-policy";
import { DEFAULT_ORG_GATE_POLICY, ORG_GATE_POLICY } from "./gate.policy";
import { GateEngineService } from "./gate.service";
import { GatesModule, gateEvidenceProvider, orgGatePolicyProvider } from "./gates.module";

/**
 * The wiring (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)): the evidence token
 * is the engine itself, the org policy is read through #481's shared resolver, and the module imports
 * nothing but the database and the policy plane — which is what lets four emitter modules import it
 * without a cycle.
 */

describe("the gates module", () => {
  it("binds the evidence token to the engine with useExisting, and exports both and the listeners", () => {
    expect(gateEvidenceProvider).toEqual({
      provide: GATE_EVIDENCE,
      useExisting: GateEngineService,
    });
    expect(Reflect.getMetadata("exports", GatesModule)).toEqual([
      GateEngineService,
      GATE_EVIDENCE,
      GateListeners,
      OrgPolicyGateResolver,
    ]);
  });

  it("binds the org policy to the resolver that reads the published human_review rule (#461)", () => {
    const providers = Reflect.getMetadata("providers", GatesModule) as unknown[];

    expect(orgGatePolicyProvider).toEqual({
      provide: ORG_GATE_POLICY,
      useExisting: OrgPolicyGateResolver,
    });
    expect(providers).toContainEqual(orgGatePolicyProvider);
    expect(providers).toContainEqual(OrgPolicyGateResolver);
    expect(Reflect.getMetadata("exports", GatesModule)).toContain(OrgPolicyGateResolver);
  });

  it("imports the database and the policy plane — the resolver every enforcement point shares (#481)", () => {
    expect(Reflect.getMetadata("imports", GatesModule)).toEqual([DbModule, PoliciesModule]);
  });

  it("answers every workspace with no overrides and a permissive allow-list", async () => {
    const config = await DEFAULT_ORG_GATE_POLICY.forOrganization("any");

    expect(config.overrides).toEqual({});
    expect(config.license.allow).toContain("Apache-2.0");
    expect(config.license.allow).not.toContain("GPL-3.0-only");
  });
});
