/**
 * The weekly digest's request-side behaviour (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)): a person's subscription, a
 * workspace's schedule, the preview, and the two halves of an unsubscribe link.
 *
 * **Subscription is per person, per workspace, and opt-in.** Nobody is subscribed until they
 * ask; asking is refused when this deployment has no mail server, because a subscription that
 * can never be honoured is a promise nobody is keeping.
 *
 * **The schedule is the workspace's.** Any member reads it; an administrator moves it.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import type { SessionUser } from "../../auth/principal";
import { AppConfigService } from "../../config/config.service";
import type { Organization } from "../../db/schema";
import { MAILER, type Mailer } from "../../mail/mailer";
import { nextWeeklySlot } from "../../scheduling/cadence";
import { METRICS_CLOCK } from "../metrics/metrics.service";
import { InsightsPageService } from "../page/page.service";
import { DIGEST_RANGE, assembleDigest } from "./digest.assembly";
import type { PatchDigestScheduleDto } from "./digest.dto";
import { digestMailUnconfigured } from "./digest.errors";
import { confirmPage, invalidLinkPage, unsubscribedPage, type DigestPage } from "./digest.pages";
import { insightsUrl, renderDigest } from "./digest.render";
import { DigestRepository, type DigestScheduleRow } from "./digest.repository";
import type { InsightsDigestPreviewResource, InsightsDigestResource } from "./digest.resources";
import { hashUnsubscribeToken, isUnsubscribeToken } from "./digest.token";

/** The slot a workspace's digest goes out at until somebody chooses one: Monday 09:00 UTC. */
export const DEFAULT_DIGEST_SCHEDULE: DigestScheduleRow = { weeklyDay: 1, weeklyTime: "09:00" };

@Injectable()
export class DigestService {
  /**
   * @param repository - The digest's own storage.
   * @param pages - The Insights page — the only source of the digest's figures.
   * @param mailer - This deployment's mailer, for whether it can send at all.
   * @param config - The UI origin the preview links to.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly repository: DigestRepository,
    private readonly pages: InsightsPageService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: AppConfigService,
    @Optional() @Inject(METRICS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * The caller's subscription and the workspace's schedule.
   *
   * @param tenant - The workspace.
   * @param user - The caller.
   * @returns The resource.
   */
  async state(tenant: Organization, user: SessionUser): Promise<InsightsDigestResource> {
    const [subscribed, stored] = await Promise.all([
      this.repository.subscribed(tenant.id, user.id),
      this.repository.schedule(tenant.id),
    ]);
    const schedule = stored ?? DEFAULT_DIGEST_SCHEDULE;

    return {
      subscribed,
      recipient: user.email,
      schedule: {
        weeklyDay: schedule.weeklyDay,
        weeklyTime: schedule.weeklyTime,
        timezone: "UTC",
        nextRunAt: nextWeeklySlot(
          new Date(this.clock()),
          schedule.weeklyDay,
          schedule.weeklyTime,
        ).toISOString(),
      },
      mail: { transport: this.mailer.transport },
    };
  }

  /**
   * Opt the caller in or out of this workspace's digest.
   *
   * @param tenant - The workspace.
   * @param user - The caller.
   * @param subscribed - True to receive it.
   * @returns The resource after the write.
   * @throws {ConflictError} `insights_digest_mail_unconfigured` when subscribing on a deployment
   *   that cannot send. Unsubscribing is never refused.
   */
  async setSubscription(
    tenant: Organization,
    user: SessionUser,
    subscribed: boolean,
  ): Promise<InsightsDigestResource> {
    if (subscribed) {
      if (this.mailer.transport === "none") {
        throw digestMailUnconfigured();
      }

      await this.repository.subscribe(tenant.id, user.id);
    } else {
      await this.repository.unsubscribe(tenant.id, user.id);
    }

    return this.state(tenant, user);
  }

  /**
   * Move the workspace's weekly slot.
   *
   * @param tenant - The workspace.
   * @param user - The administrator saving it.
   * @param patch - The day, the time, or both; what is left out keeps its value.
   * @returns The resource after the write. A patch carrying nothing writes nothing.
   */
  async setSchedule(
    tenant: Organization,
    user: SessionUser,
    patch: PatchDigestScheduleDto,
  ): Promise<InsightsDigestResource> {
    if (patch.weeklyDay !== undefined || patch.weeklyTime !== undefined) {
      const current = (await this.repository.schedule(tenant.id)) ?? DEFAULT_DIGEST_SCHEDULE;

      await this.repository.saveSchedule(
        tenant.id,
        {
          weeklyDay: patch.weeklyDay ?? current.weeklyDay,
          weeklyTime: patch.weeklyTime ?? current.weeklyTime,
        },
        user.id,
      );
    }

    return this.state(tenant, user);
  }

  /**
   * What the digest would say if it were sent now — rendered by the code that sends it.
   *
   * @param tenant - The workspace.
   * @returns The subject and both parts. Its unsubscribe link is absent: it was sent to nobody.
   */
  async preview(tenant: Organization): Promise<InsightsDigestPreviewResource> {
    const assembly = assembleDigest(await this.pages.read(tenant.id, { range: DIGEST_RANGE }));
    const rendered = renderDigest(assembly, {
      workspaceName: tenant.name,
      insightsUrl: insightsUrl(this.config.uiUrl),
      unsubscribeUrl: null,
    });

    return {
      ...rendered,
      window: assembly.window,
      contentVersion: assembly.contentVersion,
    };
  }

  /**
   * The page an unsubscribe link opens. It changes nothing: the page's button does.
   *
   * @param token - The path's token, as it arrived.
   * @returns The confirmation page, or the invalid-link page for a token no send carried.
   */
  async unsubscribePage(token: unknown): Promise<DigestPage> {
    const target = await this.targetOf(token);

    return target === undefined ? invalidLinkPage() : confirmPage(target.workspaceName);
  }

  /**
   * Unsubscribe whoever the token's mail was sent to. Doing it twice is doing it once.
   *
   * @param token - The path's token, as it arrived.
   * @returns The done page, or the invalid-link page for a token no send carried.
   */
  async unsubscribe(token: unknown): Promise<DigestPage> {
    const target = await this.targetOf(token);

    if (target === undefined) {
      return invalidLinkPage();
    }

    // A person since removed has no subscription left; the answer is the same.
    if (target.userId !== null) {
      await this.repository.unsubscribe(target.organizationId, target.userId);
    }

    return unsubscribedPage(target.workspaceName);
  }

  /**
   * Who a presented token belongs to.
   *
   * @param token - The path's token.
   * @returns The send's workspace and person. A value that is not shaped like a token is refused
   *   here, before any read.
   */
  private async targetOf(token: unknown) {
    return isUnsubscribeToken(token)
      ? this.repository.unsubscribeTarget(hashUnsubscribeToken(token))
      : undefined;
  }
}
