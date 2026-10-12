/**
 * The `/ouro` grammar and its dispatcher (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) — one definition of every command,
 * run the same way from every surface.
 *
 * ```
 * grammar.registry.ts     the commands                     ─┐
 * grammar.parser.ts       reading what was typed            │  no plane, no surface
 * grammar.help.ts         /ouro help, chat-grammar.json     │
 * dispatcher.service.ts   who · may they · confirm · run   ─┘
 * chatops.repository.ts   chat_commands, chat_messages
 * chatops.controller.ts   GET /api/v1/chat/{grammar,completions}
 * planes/                 the bindings, resolvers and completions — the only code here that
 *                         imports another plane, and each binding makes one call the UI makes
 * ```
 *
 * **How the modules fit, without a cycle.** Three need each other's neighbours:
 *
 * ```
 * SlackModule ─▶ ChatopsModule ─▶ ChatopsPlanesModule ─▶ the planes
 *      │               └────────▶ SlackStoreModule (SlackRepository)
 *      └────────────────────────▶ SlackStoreModule
 * ```
 *
 * The Slack adapter calls {@link ChatDispatcher}, so `SlackModule` imports this module. The
 * dispatcher finds out who typed a command through `SlackRepository`, which therefore cannot be
 * `SlackModule`'s to provide; it lives in `SlackStoreModule`, a providers-only module over the
 * database that both import and that imports neither. Nest resolves that with no `forwardRef`,
 * and this module never sees the Slack adapter. The planes side is the same idea in the other
 * direction: this module takes three tokens from `ChatopsPlanesModule` (`grammar.ports.ts`) and
 * imports no plane itself.
 *
 * **`OrganizationRepository` and `CapabilityRepository` are provided here**, as
 * `decisions.module.ts` and `inbox-actions.module.ts` provide the second: they are stateless
 * reads over the library's membership tables, and `TenancyModule` — which registers the global
 * guards — exports nothing by design.
 *
 * **{@link ChatDispatcher} is the module's whole outward surface.**
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { SlackStoreModule } from "../slack/slack.store.module";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { OrganizationRepository } from "../tenancy/organization.repository";
import { ChatopsController } from "./chatops.controller";
import { ChatopsRepository } from "./chatops.repository";
import { ChatDispatcher } from "./dispatcher.service";
import { CHAT_GRAMMAR, GRAMMAR } from "./grammar.registry";
import { ChatopsPlanesModule } from "./planes/chatops-planes.module";

@Module({
  imports: [DbModule, AuditModule, SlackStoreModule, ChatopsPlanesModule],
  controllers: [ChatopsController],
  providers: [
    { provide: CHAT_GRAMMAR, useValue: GRAMMAR },
    ChatopsRepository,
    OrganizationRepository,
    CapabilityRepository,
    ChatDispatcher,
  ],
  exports: [ChatDispatcher],
})
export class ChatopsModule {}
