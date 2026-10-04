/**
 * `/api/v1/insights/digest` — the weekly email's subscription, schedule and preview (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)).
 *
 * **The workspace is the session's, never the request's**, as on every route beside this one.
 *
 * **Who may do what.** Reading the state, previewing, and changing *one's own* subscription are
 * every member's — a viewer may read Insights, so a viewer may be mailed them. Moving the
 * workspace's schedule changes when everybody's digest arrives, so it is an administrator's
 * (`owner`/`admin`), refused with the API's one `403` below that.
 *
 * The unsubscribe link's two routes need no session and live in
 * `digest.unsubscribe.controller.ts`.
 */

import { Body, Controller, Get, Patch, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import { HumanOnly } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { PatchDigestScheduleDto, PutDigestSubscriptionDto } from "./digest.dto";
import type { InsightsDigestPreviewResource, InsightsDigestResource } from "./digest.resources";
import { DigestService } from "./digest.service";

@Controller("insights/digest")
export class DigestController {
  /** @param digest - The digest's request-side behaviour. */
  constructor(private readonly digest: DigestService) {}

  /**
   * The caller's subscription, the workspace's schedule, and whether this deployment can send.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The caller.
   * @returns The resource. Never a 404: a workspace always has a schedule, if only the default.
   */
  @Get()
  // The caller's own view, so a service account (#485) has nobody to read it for.
  @HumanOnly()
  read(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
  ): Promise<InsightsDigestResource> {
    return this.digest.state(tenant, principal.user);
  }

  /**
   * Opt the caller in or out of this workspace's weekly digest.
   *
   * @param tenant - The workspace.
   * @param principal - The caller — the only person this route can subscribe.
   * @param body - `{subscribed}`.
   * @returns The resource after the write. `409 insights_digest_mail_unconfigured` when
   *   subscribing on a deployment with no mail server.
   */
  @Put("subscription")
  subscribe(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: PutDigestSubscriptionDto,
  ): Promise<InsightsDigestResource> {
    return this.digest.setSubscription(tenant, principal.user, body.subscribed);
  }

  /**
   * Move the workspace's weekly slot.
   *
   * @param tenant - The workspace.
   * @param principal - The administrator saving it.
   * @param patch - The day, the time, or both.
   * @returns The resource after the write.
   */
  @Patch("schedule")
  @Roles(...ADMINISTRATORS)
  reschedule(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() patch: PatchDigestScheduleDto,
  ): Promise<InsightsDigestResource> {
    return this.digest.setSchedule(tenant, principal.user, patch);
  }

  /**
   * What the digest would say if it were sent now.
   *
   * @param tenant - The workspace.
   * @returns The subject, the HTML part and the text part.
   */
  @Get("preview")
  preview(@CurrentTenant() tenant: Organization): Promise<InsightsDigestPreviewResource> {
    return this.digest.preview(tenant);
  }
}
