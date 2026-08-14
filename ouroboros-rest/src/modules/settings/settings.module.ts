/**
 * Settings — the dashboard's one write, over the V011 settings pair
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)).
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

import { DbModule } from "../db/db.module";
import { SettingsAudit } from "./audit";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

@Module({
  imports: [DbModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository, SettingsAudit],
  // Nothing is exported, for the dashboard module's own reason: the routes are the surface,
  // and the merge logic that will *act* on this switch (v2) reads the view, not a provider.
})
export class SettingsModule {}
