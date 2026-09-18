/**
 * The build farm's identity layer — decision **B3**'s chain, from a minted token to a
 * certificate a gateway can refuse.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240). The same three layers as
 * everywhere, with the security-carrying files named beside them:
 *
 * ```
 * controllers  the operator's five routes, and the      → enrollment.controller.ts
 *              agent's two                              → registration.controller.ts
 * services     the order of operations — which is the   → enrollment.service.ts
 *              ticket: check, then write                → registration.service.ts
 * repository   every statement, and the three that      → farm.repository.ts
 *              have to be one transaction
 * ---
 * farm.authority.ts     the CA. The ONE file allowed to unwrap a key
 * runner.identity.ts    the handshake check AH.3 (#251) shares rather than rewrites
 * client.certificate.ts where a certificate comes from, and what a proxy has to do
 * farm.tokens.ts        orb_enroll_… — named row, constant-time compare, mask from the id
 * farm.policy.ts        every number, once
 * farm.errors.ts        six refusals, one answer
 * farm.audit.ts         …and the trail where the difference between the six is recorded
 * x509/                 DER in, DER out. No dependency on anything above
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Three modules are imported and each one is a capability this module is not allowed to
 * have of its own.**
 *
 *   * `DbModule` — the answer to *who can reach the farm tables*, and non-global so the
 *     question has one.
 *   * `VaultModule` — AD.1's ([#222](https://github.com/NobuData/ouroboros/issues/222))
 *     envelope encryption, for the three secrets this module owns: an enrollment token, a
 *     bearer-fallback secret, and the CA's private key. Nothing here implements cryptography
 *     of its own — `x509/` composes and signs, and every *key* it touches was handed to it.
 *   * `AuditModule` — AD.4's ([#225](https://github.com/NobuData/ouroboros/issues/225)) one
 *     writer. Every operation in this module writes an event, including the refusals.
 *
 * `ConfigModule` is not imported and does not need to be: it is global, so `AppConfigService`
 * is injectable wherever it has been registered. That is the one setting read at request time
 * — which header, if any, carries a forwarded client certificate.
 *
 * ---------------------------------------------------------------------------
 * **It exports two things, and the choice of which is the whole of what this module is.**
 *
 * `RunnerIdentityService` is exported for AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)):
 * the gateway has to answer *is this certificate live?* at every handshake, and a second
 * implementation of that question is how a revocation ends up being honoured on one path and
 * not the other. `FarmAuthorityService` is exported for AH.6
 * ([#254](https://github.com/NobuData/ouroboros/issues/254)) and nothing else — removing a
 * runner has to revoke its certificate, which goes through this module's own repository.
 *
 * **`EnrollmentService` and `RegistrationService` are not exported.** Their routes are the
 * surface. A module that exported them would be inviting a second caller to bypass the role
 * gate and the token checks, which is the whole of what those services are — the same
 * position `ProviderConnectionsModule` takes for the same reason.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { EnrollmentController } from "./enrollment.controller";
import { EnrollmentService } from "./enrollment.service";
import { FARM_CLOCK, FarmAuthorityService } from "./farm.authority";
import { FarmAudit } from "./farm.audit";
import { FarmRepository } from "./farm.repository";
import { RegistrationController } from "./registration.controller";
import { RegistrationService } from "./registration.service";
import { RunnerIdentityService } from "./runner.identity";

@Module({
  imports: [DbModule, VaultModule, AuditModule],
  controllers: [EnrollmentController, RegistrationController],
  providers: [
    EnrollmentService,
    RegistrationService,
    RunnerIdentityService,
    FarmAuthorityService,
    FarmRepository,
    FarmAudit,
    {
      // The clock, as a provider rather than as `new Date()` at seven call sites. Four of the
      // rules in this module are comparisons against the present — a token's TTL, a
      // certificate's window, when a renewal is due, whether a presented certificate has
      // expired — and a suite that had to wait for one of them to pass would be a suite
      // nobody runs. `provider-health` and `estimation` inject their clocks for the same
      // reason.
      provide: FARM_CLOCK,
      useValue: () => new Date(),
    },
  ],
  exports: [RunnerIdentityService, FarmAuthorityService],
})
export class FarmModule {}
