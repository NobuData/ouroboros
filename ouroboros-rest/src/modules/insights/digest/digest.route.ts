/**
 * The weekly Insights digest as an org notification route sends it (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * The `weekly_insights` route mails #440's digest to the addresses an administrator configured
 * (`eng-leads@…`), at the route's own weekday and time. The figures are the same — assembled
 * from the Insights page as of the slot, exactly as a subscriber's run assembles them — and only
 * the framing differs: a routed address subscribed to nothing, so the mail carries no
 * unsubscribe link and says it came through the workspace's notification route.
 *
 * This composes; it does not send. The route sender (`notification-routes/`) claims, sends and
 * settles, so a subscriber's opt-in (`insights_digest_subscriptions`) and the org route never
 * share a send log.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { InsightsPageService } from "../page/page.service";
import { DIGEST_RANGE, assembleDigest } from "./digest.assembly";
import { insightsUrl, renderDigest, type RenderedDigest } from "./digest.render";

/**
 * The sentence a routed mail closes with, in place of the subscription sentence.
 *
 * @param workspaceName - The workspace's name.
 * @returns The sentence.
 */
export function routedReason(workspaceName: string): string {
  return (
    `You receive this because an administrator of ${workspaceName} routed the weekly Insights ` +
    `digest to this address in Settings → Notifications.`
  );
}

@Injectable()
export class DigestRouteComposer {
  /**
   * @param pages - The Insights page — the only source of the digest's figures.
   * @param config - The UI origin the *Open Insights* link is built from.
   */
  constructor(
    private readonly pages: InsightsPageService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The routed digest for one slot.
   *
   * @param organizationId - The workspace.
   * @param workspaceName - Its name, for the subject and the closing sentence.
   * @param slot - The route's scheduled instant; the week reported ends there.
   * @returns The mail's subject, HTML and text — the same for every routed address.
   */
  async compose(
    organizationId: string,
    workspaceName: string,
    slot: Date,
  ): Promise<RenderedDigest> {
    const assembly = assembleDigest(
      await this.pages.read(organizationId, { range: DIGEST_RANGE, now: slot }),
    );

    return renderDigest(assembly, {
      workspaceName,
      insightsUrl: insightsUrl(this.config.uiUrl),
      unsubscribeUrl: null,
      reason: routedReason(workspaceName),
    });
  }
}
