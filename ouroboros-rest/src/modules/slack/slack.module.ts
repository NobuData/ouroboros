/**
 * The Slack app (BZ.1, [#535](https://github.com/NobuData/ouroboros/issues/535)) — this
 * deployment's own, per decision **C1**: OAuth install per workspace, three signature-verified
 * endpoints, the identity-linking flow, the connection's status, and Socket Mode for a
 * development stack with no public URL.
 *
 * It publishes nothing: cards and command replies beyond `link` are BZ.2–BZ.4 (#536–#538),
 * which take {@link SLACK_API} and the connection this module keeps.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { HttpSlackApi, SLACK_API } from "./slack.client";
import {
  SlackConnectionController,
  SlackInboundController,
  SlackLinkController,
  SlackOauthController,
} from "./slack.controller";
import { SlackInboundService } from "./slack.inbound.service";
import { SlackInstallService } from "./slack.install.service";
import { SlackLinkService } from "./slack.link.service";
import { SlackRepository } from "./slack.repository";
import { SlackSignatureGuard } from "./slack.signature.guard";
import { SlackSocketMode } from "./slack.socket-mode";

@Module({
  imports: [DbModule, AuditModule, VaultModule],
  controllers: [
    SlackInboundController,
    SlackOauthController,
    SlackLinkController,
    SlackConnectionController,
  ],
  providers: [
    SlackRepository,
    SlackInstallService,
    SlackLinkService,
    SlackInboundService,
    SlackSignatureGuard,
    SlackSocketMode,
    // A factory rather than `useClass`: the client's one constructor parameter is the fetch to
    // call through, which Nest must not try to resolve.
    { provide: SLACK_API, useFactory: (): HttpSlackApi => new HttpSlackApi() },
  ],
  exports: [SLACK_API, SlackInstallService, SlackRepository],
})
export class SlackModule {}
