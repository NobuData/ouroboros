/**
 * `ChannelsController` — the *Answer From Anywhere* card's reads and the caller's notification
 * preferences (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463)).
 *
 * ```
 * GET   /api/v1/inbox/channels        the four channel rows, as they truly stand (BO.4 renders verbatim)
 * GET   /api/v1/inbox/notifications   the caller's digest, instant threshold and mutes here
 * PATCH /api/v1/inbox/notifications   change them; answers the whole resource
 * ```
 *
 * Every member reaches these routes: the channel rows are the workspace's, and preferences are the
 * caller's own. A caller with no person (a service account) has no mailbox, so the preference
 * routes refuse it.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";

import type { ActiveMembership } from "../tenancy/tenant.context";
import { currentUser } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { preferencesNeedPerson } from "./channels.errors";
import { ChannelsService } from "./channels.service";
import type { ChannelsResource } from "./channels.truth";
import { PatchNotificationPreferencesDto } from "./notifications/preferences.dto";
import {
  NotificationPreferencesService,
  type NotificationPreferencesResource,
} from "./notifications/preferences.service";

/**
 * The signed-in person, or a refusal.
 *
 * @returns `"user".id`.
 * @throws {ForbiddenError} `notification_preferences_need_person`.
 */
function personId(): string {
  const user = currentUser();

  if (user === undefined) {
    throw preferencesNeedPerson();
  }

  return user.id;
}

@Controller("inbox")
export class ChannelsController {
  /**
   * @param channels - The channel truth.
   * @param preferences - The caller's preferences.
   */
  constructor(
    private readonly channels: ChannelsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  /**
   * The four channel rows.
   *
   * @param member - The workspace.
   * @returns GitHub, Email, Slack and Push, each `connected`, `available` or `unavailable-until`.
   */
  @Get("channels")
  channelRows(@CurrentMember() member: ActiveMembership): Promise<ChannelsResource> {
    return this.channels.truth(member.tenant.id);
  }

  /**
   * The caller's notification preferences in this workspace, defaults filled in.
   *
   * @param member - The workspace.
   * @returns The resource, with the next digest's send time.
   */
  @Get("notifications")
  readPreferences(
    @CurrentMember() member: ActiveMembership,
  ): Promise<NotificationPreferencesResource> {
    return this.preferences.read(member.tenant.id, personId());
  }

  /**
   * Change the caller's notification preferences.
   *
   * @param member - The workspace.
   * @param patch - The fields to change.
   * @returns The resource after the write.
   */
  @Patch("notifications")
  updatePreferences(
    @CurrentMember() member: ActiveMembership,
    @Body() patch: PatchNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResource> {
    return this.preferences.update(member.tenant.id, personId(), {
      digestEnabled: patch.digestEnabled,
      digestTime: patch.digestTime,
      instantSeverity: patch.instantSeverity,
      mutedKinds: patch.mutedKinds,
    });
  }
}
