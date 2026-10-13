/**
 * The chat routes (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537)):
 *
 * ```
 * GET /api/v1/chat/grammar                 the whole `/ouro` grammar, as the docs print it
 * GET /api/v1/chat/completions?text=…      what could be typed next
 * ```
 *
 * Both are reads any member may make, in the workspace the request names. Neither runs a
 * command: dispatch from the page's console is BZ.5's (#539). The grammar route is what the
 * console and the commands card (#543) list from, so they cannot show a command the dispatcher
 * does not have.
 */

import { Controller, Get, Inject, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import { complete, type ChatCompletionsResource } from "./chatops.completions";
import { ChatCompletionsQuery } from "./chatops.dto";
import { chatPersonRequired } from "./chatops.errors";
import { renderReference, type GrammarReference } from "./grammar.help";
import { COMPLETION_SOURCES, type CompletionSources } from "./grammar.ports";
import { CHAT_GRAMMAR } from "./grammar.registry";
import type { Grammar } from "./grammar.types";

/** The route family, relative to the API base path. */
export const CHAT_ROUTE = "chat";

@Controller(CHAT_ROUTE)
export class ChatopsController {
  /**
   * @param grammar - The grammar the dispatcher runs.
   * @param sources - The planes' completion vocabularies.
   * @param capabilities - The caller's explicit capability, for the invoker a source is shown.
   */
  constructor(
    @Inject(CHAT_GRAMMAR) private readonly grammar: Grammar,
    @Inject(COMPLETION_SOURCES) private readonly sources: CompletionSources,
    private readonly capabilities: CapabilityRepository,
  ) {}

  /**
   * `GET /api/v1/chat/grammar` — every command, its arguments, who may run it and what it calls.
   *
   * @returns The reference — the same document as the committed `chat-grammar.json`.
   */
  @Get("grammar")
  reference(): GrammarReference {
    return renderReference(this.grammar);
  }

  /**
   * `GET /api/v1/chat/completions` — what could be typed next.
   *
   * @param tenant - The workspace.
   * @param member - The caller's membership.
   * @param query - The text typed so far.
   * @returns The command and argument being typed, and up to ten completions.
   * @throws {ForbiddenError} `403 chat_person_required` for a service account.
   */
  @Get("completions")
  async completions(
    @CurrentTenant() tenant: Organization,
    @CurrentMember() member: ActiveMembership,
    @Query() query: ChatCompletionsQuery,
  ): Promise<ChatCompletionsResource> {
    const user = currentUser();

    if (user === undefined) {
      throw chatPersonRequired();
    }

    return complete(
      this.grammar,
      this.sources,
      tenant.id,
      {
        userId: user.id,
        name: user.name,
        roles: member.roles,
        canApproveLoops: await this.capabilities.explicitFor(tenant.id, user.id),
      },
      query.text ?? "",
    );
  }
}
