/**
 * The Slack app (BZ.1, [#535](https://github.com/NobuData/ouroboros/issues/535)) — this
 * deployment's own, per decision **C1**: OAuth install per workspace, three signature-verified
 * endpoints, the identity-linking flow, the connection's status, and Socket Mode for a
 * development stack with no public URL. CA.1 (#541) adds the channel list and its bindings —
 * which of the workspace's channels loops, alerts and the leads' digest are posted to.
 *
 * It publishes nothing: cards are BZ.2 and BZ.4 (#536, #538), which take {@link SLACK_API} and
 * the connection this module keeps.
 *
 * **Commands.** `/ouro link` and `/ouro unlink` are answered here, because linking is a Slack
 * matter; every other `/ouro …` is handed to the dispatcher of BZ.3 (#537), which is why this
 * module imports `ChatopsModule`. The dispatcher in turn needs {@link SlackRepository} to find
 * out who typed a command — so the repository is provided by `SlackStoreModule`, which both
 * modules import and neither is imported by: no cycle, no `forwardRef`
 * (`slack.store.module.ts`).
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ChatopsModule } from "../chatops/chatops.module";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { SlackChannelsController } from "./slack.channels.controller";
import { SlackChannelsService } from "./slack.channels.service";
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
import { SlackSignatureGuard } from "./slack.signature.guard";
import { SlackSocketMode } from "./slack.socket-mode";
import { SlackStoreModule } from "./slack.store.module";

@Module({
  imports: [DbModule, AuditModule, VaultModule, SlackStoreModule, ChatopsModule],
  controllers: [
    SlackInboundController,
    SlackOauthController,
    SlackLinkController,
    SlackConnectionController,
    SlackChannelsController,
  ],
  providers: [
    SlackInstallService,
    SlackChannelsService,
    SlackLinkService,
    SlackInboundService,
    SlackSignatureGuard,
    SlackSocketMode,
    // A factory rather than `useClass`: the client's one constructor parameter is the fetch to
    // call through, which Nest must not try to resolve.
    { provide: SLACK_API, useFactory: (): HttpSlackApi => new HttpSlackApi() },
  ],
  // `SlackStoreModule` is re-exported for `SlackRepository`, which this module used to provide.
  exports: [SLACK_API, SlackInstallService, SlackInboundService, SlackStoreModule],
})
export class SlackModule {}
