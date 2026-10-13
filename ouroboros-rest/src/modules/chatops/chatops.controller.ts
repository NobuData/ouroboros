/**
 * The chat routes (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537); BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)):
 *
 * ```
 * GET  /api/v1/chat/grammar                 the whole `/ouro` grammar, and what the caller may run
 * GET  /api/v1/chat/completions?text=…      what could be typed next
 * POST /api/v1/chat/commands                run what was typed, as the signed-in person
 * GET  /api/v1/chat/commands/{id}           the caller's own console command — an async result
 * ```
 *
 * All four are open to any member, in the workspace the request names. **The routes decide
 * nothing about a command**: `POST` hands the text and the session to {@link ChatDispatcher} —
 * the same call the Slack adapter makes — and answers with what it said, so who may run what,
 * the confirm rule and every reply are the dispatcher's on both surfaces. That is why a command
 * a person may not run is a `200` with `outcome: "denied"`, not a `403`: the refusal is the
 * command's reply, worded as Slack words it, and recorded.
 *
 * The grammar route is what the console and the commands card (#543) list from, so they cannot
 * show a command the dispatcher does not have; `allowed` and `deniedReason` on each command are
 * the caller's own, computed with the dispatcher's rule (`chatops.resources.ts`).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import { complete, type ChatCompletionsResource } from "./chatops.completions";
import { ChatCommandRequest, ChatCompletionsQuery, commandText } from "./chatops.dto";
import { SlackRepository } from "../slack/slack.repository";
import { chatChannelNotFound, chatCommandNotFound, chatPersonRequired } from "./chatops.errors";
import { ChatopsRepository } from "./chatops.repository";
import {
  callerGrammar,
  toCommand,
  toCommandResult,
  type CallerGrammarResource,
  type ChatCommandResource,
  type ChatCommandResultResource,
} from "./chatops.resources";
import { ChatDispatcher } from "./dispatcher.service";
import { COMPLETION_SOURCES, type CompletionSources } from "./grammar.ports";
import { CHAT_GRAMMAR } from "./grammar.registry";
import type { Grammar } from "./grammar.types";

/** The route family, relative to the API base path. */
export const CHAT_ROUTE = "chat";

/** What a `chat_commands.id` looks like; anything else names no command and is never queried. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller(CHAT_ROUTE)
export class ChatopsController {
  /**
   * @param grammar - The grammar the dispatcher runs.
   * @param sources - The planes' completion vocabularies.
   * @param capabilities - The caller's explicit capability, for the invoker a source is shown.
   * @param dispatcher - Runs a command — the one path every surface's commands take.
   * @param commands - The command trail, for a caller reading their own command back.
   * @param channels - The workspace's channels, for a command typed under one's mirror.
   */
  constructor(
    @Inject(CHAT_GRAMMAR) private readonly grammar: Grammar,
    @Inject(COMPLETION_SOURCES) private readonly sources: CompletionSources,
    private readonly capabilities: CapabilityRepository,
    private readonly dispatcher: ChatDispatcher,
    private readonly commands: ChatopsRepository,
    private readonly channels: SlackRepository,
  ) {}

  /**
   * `GET /api/v1/chat/grammar` — every command, its arguments, who may run it and what it calls,
   * and whether the caller is one of those who may.
   *
   * @param tenant - The workspace.
   * @param member - The caller's membership.
   * @returns The reference — the same document as the committed `chat-grammar.json` — with
   *   `allowed` and `deniedReason` on each command. A caller who is not a person is allowed none.
   */
  @Get("grammar")
  async reference(
    @CurrentTenant() tenant: Organization,
    @CurrentMember() member: ActiveMembership,
  ): Promise<CallerGrammarResource> {
    const user = currentUser();

    return callerGrammar(
      this.grammar,
      user === undefined
        ? null
        : {
            roles: member.roles,
            canApproveLoops: await this.capabilities.explicitFor(tenant.id, user.id),
          },
    );
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

  /**
   * `POST /api/v1/chat/commands` — run what was typed in the console, as the signed-in person.
   *
   * Always `200` for anything a person typed or a plane refused: `outcome` says how it went and
   * `reply` is what Slack would have said. An async command answers `async_pending`; its result
   * is read from `GET /api/v1/chat/commands/{id}`.
   *
   * A command typed in a channel mirror's composer (#542) names that channel; it is recorded on
   * the command's row, which is what puts the command in that mirror. The channel is checked
   * before anything is dispatched, so a command is never run under a channel it cannot be
   * shown in. The palette names none.
   *
   * @param tenant - The workspace.
   * @param body - The text typed, with or without its `/ouro` prefix, and the channel if any.
   * @returns The dispatcher's result.
   * @throws {ForbiddenError} `403 chat_person_required` for a service account.
   * @throws {NotFoundError} `404 chat_channel_not_found` when `channelId` is not a bound channel
   *   of this workspace — another workspace's, an unbound one, or a DM conversation.
   */
  @Post("commands")
  @HttpCode(HttpStatus.OK)
  async run(
    @CurrentTenant() tenant: Organization,
    @Body() body: ChatCommandRequest,
  ): Promise<ChatCommandResultResource> {
    const user = currentUser();

    if (user === undefined) {
      throw chatPersonRequired("commands");
    }

    const typedUnder = body.channelId ?? null;
    const channelId =
      typedUnder === null
        ? null
        : ((await this.channels.boundChannel(tenant.id, typedUnder)) ?? null);

    // Before anything runs, and before the row's own foreign key would refuse it (V137).
    if (typedUnder !== null && channelId === null) {
      throw chatChannelNotFound();
    }

    return toCommandResult(
      await this.dispatcher.dispatch({
        surface: "console",
        text: commandText(body.text),
        console: { organizationId: tenant.id, userId: user.id, channelId },
      }),
    );
  }

  /**
   * `GET /api/v1/chat/commands/{id}` — a console command the caller ran, as it stands now.
   *
   * What the console asks until `outcome` leaves `async_pending`; `settledReply` is then what
   * the command finally said, beside `reply` — what it said at once.
   *
   * @param tenant - The workspace.
   * @param id - The command's id.
   * @returns The command.
   * @throws {ForbiddenError} `403 chat_person_required` for a service account.
   * @throws {NotFoundError} `404 chat_command_not_found` for an id that is not a UUID, names
   *   nothing, or names a command that is somebody else's, Slack's, or another workspace's.
   */
  @Get("commands/:id")
  async command(
    @CurrentTenant() tenant: Organization,
    @Param("id") id: string,
  ): Promise<ChatCommandResource> {
    const user = currentUser();

    if (user === undefined) {
      throw chatPersonRequired("commands");
    }

    const row = UUID.test(id)
      ? await this.commands.ownConsoleCommand(tenant.id, user.id, id)
      : undefined;

    if (row === undefined) {
      throw chatCommandNotFound();
    }

    return toCommand(row);
  }
}
