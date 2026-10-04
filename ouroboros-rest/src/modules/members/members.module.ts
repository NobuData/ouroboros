/**
 * Members, roles and capabilities — the Settings page's Members & Roles card
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1, decision S3).
 *
 * ```
 * controller   the routes, the role gate                       → members.controller.ts
 * service      last-owner rule, capability edits, the audit    → members.service.ts
 * repository   reads of the plugin's tables, the capability write → members.repository.ts
 * port         the organization plugin's writes                → members.auth.ts
 * ```
 *
 * The capability *check* is not here: it is `tenancy/capabilities.ts`, a global guard, so every
 * approval route in the product reads the same rule without importing this module.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { BetterAuthMemberDirectory, MEMBER_DIRECTORY } from "./members.auth";
import { MembersController } from "./members.controller";
import { MembersRepository } from "./members.repository";
import { MembersService } from "./members.service";
import { DirectorySyncStatus } from "./members.sync";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [MembersController],
  providers: [
    MembersRepository,
    MembersService,
    DirectorySyncStatus,
    { provide: MEMBER_DIRECTORY, useClass: BetterAuthMemberDirectory },
  ],
})
export class MembersModule {}
