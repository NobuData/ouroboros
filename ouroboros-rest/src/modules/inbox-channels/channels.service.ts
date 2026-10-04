/**
 * `ChannelsService` — the facts the channel truth payload is computed from (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463)): how many of the workspace's sources
 * can comment on a PR through the SPI, and whether this deployment has a mail server.
 */

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { MAILER, type Mailer } from "../mail/mailer";
import { supportsPullRequests } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { channelTruth, type ChannelsResource } from "./channels.truth";

@Injectable()
export class ChannelsService {
  /**
   * @param database - The workspace's sources.
   * @param registry - Which kinds' providers carry the PR capability.
   * @param mailer - This deployment's mailer.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: TicketSourceRegistry,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * The four channel rows, as they truly stand for a workspace.
   *
   * @param organizationId - The workspace.
   * @returns The payload BO.4 renders verbatim.
   */
  async truth(organizationId: string): Promise<ChannelsResource> {
    const sources = await this.database.db
      .selectFrom("ticket_sources_public")
      .select("kind")
      .where("organization_id", "=", organizationId)
      .where("status", "<>", "paused")
      .execute();
    const commentingSources = sources.filter(({ kind }) => {
      const provider = this.registry.find(kind);

      return provider !== undefined && supportsPullRequests(provider);
    }).length;

    return channelTruth({ commentingSources, mailTransport: this.mailer.transport });
  }
}
