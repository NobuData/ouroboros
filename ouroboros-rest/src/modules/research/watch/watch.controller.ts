/**
 * `/api/v1/research/regression-watch` — mockup 22's regression watch (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)):
 *
 *   GET  …                          the card: every watch item under the release it is compared with
 *   GET  …/settings                 watched metrics, thresholds over their defaults, the two policies
 *   PUT  …/settings                 change them
 *   POST …/baselines                capture a release's baselines by hand
 *   POST …/comparisons              run the nightly comparison now
 *   POST …/items/{itemId}/dismiss   dismiss a drift, with a reason
 *
 * Every member reads the card and the settings. Everything that changes the watch is an
 * owner's or an admin's, and a person's: a service account has nobody to answer for a policy.
 * The workspace is the session's, and an item of another workspace is `404`.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import { HumanOnly } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import {
  CaptureBaselinesDto,
  DismissItemDto,
  SaveWatchSettingsDto,
  WatchItemParams,
} from "./watch.dto";
import type {
  CaptureResource,
  ComparisonResource,
  WatchCardResource,
  WatchItemResource,
  WatchSettingsResource,
} from "./watch.resources";
import { RegressionWatchService } from "./watch.service";
import { patchOf } from "./watch.settings";

@Controller("research/regression-watch")
export class RegressionWatchController {
  /** @param watch - Baselines, the comparison, the card and the settings. */
  constructor(private readonly watch: RegressionWatchService) {}

  /**
   * `GET …` — the card.
   *
   * @param tenant - The workspace.
   * @returns Every watch item, open ones first.
   */
  @Get()
  card(@CurrentTenant() tenant: Organization): Promise<WatchCardResource> {
    return this.watch.card(tenant.id);
  }

  /**
   * `GET …/settings` — what is watched, and how.
   *
   * @param tenant - The workspace.
   * @returns The settings.
   */
  @Get("settings")
  settings(@CurrentTenant() tenant: Organization): Promise<WatchSettingsResource> {
    return this.watch.settings(tenant.id);
  }

  /**
   * `PUT …/settings` — change what is watched, the thresholds or the policies.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who changed it.
   * @param body - What changed; an absent field keeps what is stored.
   * @returns The settings as they now stand.
   */
  @Put("settings")
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  saveSettings(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: SaveWatchSettingsDto,
  ): Promise<WatchSettingsResource> {
    return this.watch.saveSettings(tenant.id, principal.user.id, patchOf(body));
  }

  /**
   * `POST …/baselines` — capture a release's baselines by hand.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who captured.
   * @param body - The repository and the release.
   * @returns What was captured and what was skipped.
   */
  @Post("baselines")
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  capture(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CaptureBaselinesDto,
  ): Promise<CaptureResource> {
    return this.watch.capture(tenant.id, {
      repository: body.repository,
      releaseTag: body.releaseTag,
      via: "manual",
      userId: principal.user.id,
    });
  }

  /**
   * `POST …/comparisons` — run the nightly comparison now.
   *
   * @param tenant - The workspace.
   * @returns What each metric's comparison concluded.
   */
  @Post("comparisons")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  compare(@CurrentTenant() tenant: Organization): Promise<ComparisonResource> {
    return this.watch.compare(tenant.id);
  }

  /**
   * `POST …/items/{itemId}/dismiss` — dismiss a drift.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who dismissed it.
   * @param params - The item.
   * @param body - Why.
   * @returns The item, dismissed.
   */
  @Post("items/:itemId/dismiss")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  dismiss(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: WatchItemParams,
    @Body() body: DismissItemDto,
  ): Promise<WatchItemResource> {
    return this.watch.dismiss(tenant.id, principal.user.id, params.itemId, body.reason);
  }
}
