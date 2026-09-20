import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { EnrollmentController } from "./enrollment.controller";
import { EnrollmentService } from "./enrollment.service";
import { FARM_CLOCK, FarmAuthorityService, type FarmClock } from "./farm.authority";
import { FarmAudit } from "./farm.audit";
import { FarmModule } from "./farm.module";
import { FarmRepository } from "./farm.repository";
import { RegistrationController } from "./registration.controller";
import { RegistrationService } from "./registration.service";
import { RunnerIdentityService } from "./runner.identity";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time. Nothing connects: `pg` connects lazily, and no query is issued.
 *
 * The export list gets its own test, because *which* things leave this module is a security
 * decision rather than a convenience: the service that holds the role gate must not be
 * reachable from anywhere but its own routes.
 */

describe("the farm module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FarmModule],
    }).compile();

    expect(moduleRef.get(EnrollmentController)).toBeInstanceOf(EnrollmentController);
    expect(moduleRef.get(RegistrationController)).toBeInstanceOf(RegistrationController);
    expect(moduleRef.get(EnrollmentService)).toBeInstanceOf(EnrollmentService);
    expect(moduleRef.get(RegistrationService)).toBeInstanceOf(RegistrationService);
    expect(moduleRef.get(RunnerIdentityService)).toBeInstanceOf(RunnerIdentityService);
    expect(moduleRef.get(FarmAuthorityService)).toBeInstanceOf(FarmAuthorityService);
    expect(moduleRef.get(FarmRepository)).toBeInstanceOf(FarmRepository);
    expect(moduleRef.get(FarmAudit)).toBeInstanceOf(FarmAudit);

    await moduleRef.close();
  });

  it("binds a clock that answers the present", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), FarmModule],
    }).compile();

    const clock = moduleRef.get<FarmClock>(FARM_CLOCK);

    expect(Math.abs(clock().getTime() - Date.now())).toBeLessThan(1000);

    await moduleRef.close();
  });

  it("exports the identity check, the authority and revocation — and not the mint", () => {
    // `RunnerIdentityService` is exported for AH.3 (#251): a second implementation of *is this
    // certificate live?* is how a revocation ends up honoured on one path and not the other.
    // `FarmAuthorityService` is exported for AH.6 (#254). `RegistrationService` joined with
    // AH.6 too, because retiring a runner has to revoke that machine's certificate through the
    // one write that owns it and its audit row — and it has no role gate to bypass: both its
    // routes are `@AllowAnonymous()`, and every check that protects them is inside the service.
    //
    // **`EnrollmentService` is the one that stays in.** Minting is `@Roles(...ADMINISTRATORS)`,
    // the gate belongs to the route, and exporting the service would be an invitation past it.
    // This assertion is what keeps that true: adding it here would be a deliberate act.
    const exported = Reflect.getMetadata("exports", FarmModule) as unknown[] | undefined;

    expect(exported).toEqual([RunnerIdentityService, FarmAuthorityService, RegistrationService]);
    expect(exported).not.toContain(EnrollmentService);
  });

  it("imports the four capabilities it is not allowed to have of its own", () => {
    // The vault (AD.1) because nothing here implements cryptography over a *secret*; the audit
    // module (AD.4) because every operation writes an event; the database module because "who
    // can reach the farm tables" should have one answer; and the installer (AG.6) because the
    // enroll command has to name this deployment's own origin and the release it would serve.
    const imported = (Reflect.getMetadata("imports", FarmModule) as { name?: string }[]).map(
      (module) => module.name,
    );

    expect(imported).toEqual(["DbModule", "VaultModule", "AuditModule", "FarmInstallerModule"]);
  });
});
