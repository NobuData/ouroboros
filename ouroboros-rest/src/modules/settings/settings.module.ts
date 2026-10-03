/**
 * Settings — the dashboard's one write, over the V011 settings pair
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)), and the Settings page's workspace
 * card ([#483](https://github.com/NobuData/ouroboros/issues/483), `workspace.*.ts`): name and
 * tenant domain as edits, region and training data as deployment truth.
 *
 * The same three layers as everywhere, at the switch's size:
 *
 * ```
 * controller  the routes, the role gate                → settings.controller.ts
 * service     the defaults, the attribution, the audit → settings.service.ts
 * repository  the statements, and nothing else         → settings.repository.ts
 * ```
 *
 * A module of its own rather than a controller in `DashboardModule`, per the runs and queue
 * modules' argument — sharpened here by what this one does: the dashboard *reads*, and a
 * module that exists to display numbers should not acquire the API's only dashboard-page
 * mutation as a side room. The aggregate still reports the switch (its repository reads the
 * same view), which is exactly the ETag-bump contract the integration suite holds.
 *
 * `SettingsAudit` is a provider rather than a value so #90 replaces a binding: the seam the
 * stub declares is the seam the audit path implements.
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is
 * the answer to "who can reach the settings pair", and `DbModule` is deliberately
 * non-global so the question has one.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { ConstraintViolationInterceptor } from "../tenancy/constraints";
import { DomainsRepository } from "../tenancy/domains.repository";
import { SettingsAudit } from "./audit";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";
import { BetterAuthWorkspaceNames, WORKSPACE_NAME_STORE } from "./workspace.auth";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceRepository } from "./workspace.repository";
import { WorkspaceService } from "./workspace.service";
import { SsoEnforcement } from "./workspace.sso";

@Module({
  // `AuditModule` for the workspace card's `workspace.updated` event.
  imports: [DbModule, AuditModule],
  controllers: [SettingsController, WorkspaceController],
  providers: [
    SettingsService,
    SettingsRepository,
    SettingsAudit,
    WorkspaceService,
    WorkspaceRepository,
    // The tenancy module's domain statements, reused rather than restated: `TenancyModule`
    // exports nothing, and the repository holds no state, so a second instance is the same rules.
    DomainsRepository,
    SsoEnforcement,
    ConstraintViolationInterceptor,
    { provide: WORKSPACE_NAME_STORE, useClass: BetterAuthWorkspaceNames },
  ],
  // Nothing is exported, for the dashboard module's own reason: the routes are the surface,
  // and the merge logic that will *act* on this switch (v2) reads the view, not a provider.
})
export class SettingsModule {}
