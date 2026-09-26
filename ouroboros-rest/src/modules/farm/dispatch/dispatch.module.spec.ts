import { FarmArtifactsModule } from "../artifacts/artifacts.module";
import { FarmAudit } from "../farm.audit";
import { FARM_DISPATCH_GATE, OPEN_GATE } from "./dispatch.gate";
import { FarmDispatchModule } from "./dispatch.module";
import { JobCompletions } from "./job.completions";
import { FarmJobsService } from "./jobs.service";

/** The module's shape (#252): what it depends on, and the three things it hands to named tickets. */
describe("the dispatch module", () => {
  it("imports the gateway and the artifact upload, neither of which imports it back", () => {
    // #330: every offer carries a single-use upload token, minted by FarmArtifactsModule.
    const imported = (
      Reflect.getMetadata("imports", FarmDispatchModule) as { name?: string }[]
    ).map((module) => module.name);

    expect(imported).toEqual([
      "DbModule",
      "AuditModule",
      "FarmGatewayModule",
      "FarmArtifactsModule",
    ]);
    expect(
      (Reflect.getMetadata("imports", FarmArtifactsModule) as { name?: string }[]).map(
        (module) => module.name,
      ),
    ).not.toContain("FarmDispatchModule");
  });

  it("writes to the audit trail through its own FarmAudit, without importing FarmModule", () => {
    // #260 audits a submission. `FarmAudit` is a stateless writer over `AuditService`, so it
    // is provided here — `fleet.module.ts`'s arrangement — and dispatch does not come to
    // depend on the enrollment module for one class.
    const imported = (
      Reflect.getMetadata("imports", FarmDispatchModule) as { name?: string }[]
    ).map((module) => module.name);

    expect(Reflect.getMetadata("providers", FarmDispatchModule)).toContain(FarmAudit);
    expect(imported).not.toContain("FarmModule");
  });

  it("exports the jobs service (AJ.3, AH.6), completions (#510) and the gate token (#489)", () => {
    expect(Reflect.getMetadata("exports", FarmDispatchModule)).toEqual([
      FarmJobsService,
      JobCompletions,
      FARM_DISPATCH_GATE,
    ]);
  });

  it("binds the open gate until #489 makes a pause an organization state", async () => {
    const providers = Reflect.getMetadata("providers", FarmDispatchModule) as unknown[];

    expect(providers).toContainEqual({ provide: FARM_DISPATCH_GATE, useValue: OPEN_GATE });
    await expect(OPEN_GATE.admits("any-workspace")).resolves.toBe(true);
  });
});
