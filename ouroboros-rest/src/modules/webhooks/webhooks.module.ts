/**
 * Outbound webhooks & SIEM streaming (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * registry     families, types, versions, matching            → webhook.registry.ts
 * outbox       the in-transaction event writer                → webhook.outbox.ts
 * dispatcher   fan out · send · retry · dead-letter           → webhook.dispatcher.ts
 * scheduler    when the dispatcher runs                       → webhook.scheduler.ts
 * signing      HMAC-SHA256 over "<timestamp>.<body>"          → webhook.signing.ts
 * ssrf         https · internal ranges denied · override      → webhook.ssrf.ts
 * transport    the one way out, guarded at connect time       → webhook.transport.ts
 * management   /settings/webhooks                             → webhooks.controller.ts / .service.ts
 * ```
 *
 * The receiver's half of the contract is `docs/WEBHOOKS.md`.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { AppConfigService } from "../config/config.service";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { WEBHOOK_RANDOM, WebhookDispatcher } from "./webhook.dispatcher";
import { WebhookDispatchScheduler } from "./webhook.scheduler";
import { InternalAllowlist } from "./webhook.ssrf";
import {
  HttpsWebhookTransport,
  WEBHOOK_RESOLVER,
  WEBHOOK_TRANSPORT,
  systemResolver,
} from "./webhook.transport";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksRepository } from "./webhooks.repository";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [DbModule, ScheduleModule.forRoot(), AuditModule, VaultModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksRepository,
    WebhooksService,
    WebhookDispatcher,
    WebhookDispatchScheduler,
    { provide: WEBHOOK_RESOLVER, useValue: systemResolver },
    { provide: WEBHOOK_RANDOM, useValue: Math.random },
    {
      provide: WEBHOOK_TRANSPORT,
      inject: [AppConfigService, WEBHOOK_RESOLVER],
      useFactory: (config: AppConfigService, resolve: typeof systemResolver) =>
        new HttpsWebhookTransport(new InternalAllowlist(config.webhookInternalAllowlist), resolve),
    },
  ],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
