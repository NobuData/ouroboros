import { DbModule } from "../../db/db.module";
import { GATE_EVIDENCE } from "./gate.evidence";
import { GateListeners } from "./gate.listeners";
import { DEFAULT_ORG_GATE_POLICY, ORG_GATE_POLICY } from "./gate.policy";
import { GateEngineService } from "./gate.service";
import { GatesModule, gateEvidenceProvider } from "./gates.module";

/**
 * The wiring (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)): the evidence token
 * is the engine itself, the org policy is the defaults until #481, and the module imports nothing
 * but the database — which is what lets four emitter modules import it without a cycle.
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
    ]);
  });

  it("binds the org policy to the defaults", () => {
    const providers = Reflect.getMetadata("providers", GatesModule) as unknown[];

    expect(providers).toContainEqual({
      provide: ORG_GATE_POLICY,
      useValue: DEFAULT_ORG_GATE_POLICY,
    });
  });

  it("imports only the database module", () => {
    expect(Reflect.getMetadata("imports", GatesModule)).toEqual([DbModule]);
  });

  it("answers every workspace with no overrides and a permissive allow-list", async () => {
    const config = await DEFAULT_ORG_GATE_POLICY.forOrganization("any");

    expect(config.overrides).toEqual({});
    expect(config.license.allow).toContain("Apache-2.0");
    expect(config.license.allow).not.toContain("GPL-3.0-only");
  });
});
