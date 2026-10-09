/**
 * `/api/v1/workflows/{id}/copilot/…` — the conversation's routes.
 *
 * Starting a session and sending to it change the draft, so they are administrators' like the
 * draft's own `PUT`; reading the conversation is every member's, like reading the draft. The two
 * sending routes answer `text/event-stream` written directly to the response — see
 * `copilot.stream.ts` for why the headers go out after the first event.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CopilotAnswerBody,
  CopilotMessageBody,
  CopilotMessageParams,
  CopilotSessionParams,
  CopilotWorkflowParams,
  StartCopilotSessionBody,
} from "./copilot.dto";
import type { CopilotConversationResource, CopilotSessionResource } from "./copilot.resources";
import { CopilotService } from "./copilot.service";
import { writeSse, type SseResponse } from "./copilot.stream";

@Controller("workflows/:id/copilot")
export class CopilotController {
  /**
   * @param copilot - The conversation's rules.
   */
  constructor(private readonly copilot: CopilotService) {}

  /**
   * `POST /api/v1/workflows/{id}/copilot/sessions` — start a conversation on the draft.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param principal - The session, for `copilot_sessions.created_by`.
   * @param body - The draft tag, optionally.
   * @returns The session, `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post("sessions")
  @HttpCode(HttpStatus.CREATED)
  start(
    @CurrentTenant() tenant: Organization,
    @Param() params: CopilotWorkflowParams,
    @Session() principal: Principal,
    @Body() body: StartCopilotSessionBody,
  ): Promise<CopilotSessionResource> {
    return this.copilot.start(tenant.id, params.id, principal.user.id, body);
  }

  /**
   * `GET /api/v1/workflows/{id}/copilot/conversation` — the active conversation and the draft as it
   * stands, for a surface switching back (decision W9).
   *
   * @param tenant - The workspace.
   * @param params - The workflow's id.
   * @returns The session, its messages and the draft.
   */
  @Get("conversation")
  conversation(
    @CurrentTenant() tenant: Organization,
    @Param() params: CopilotWorkflowParams,
  ): Promise<CopilotConversationResource> {
    return this.copilot.conversation(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/workflows/{id}/copilot/sessions/{sessionId}/messages` — say something, and
   * watch the reply build.
   *
   * @param tenant - The workspace.
   * @param params - The workflow and the session.
   * @param principal - The session, for the operations' provenance.
   * @param body - The message.
   * @param response - Written directly, as a `text/event-stream`.
   * @returns When the stream has ended.
   */
  @Roles(...ADMINISTRATORS)
  @Post("sessions/:sessionId/messages")
  async send(
    @CurrentTenant() tenant: Organization,
    @Param() params: CopilotSessionParams,
    @Session() principal: Principal,
    @Body() body: CopilotMessageBody,
    @Res() response: SseResponse,
  ): Promise<void> {
    await writeSse(
      response,
      this.copilot.send(tenant.id, params.id, params.sessionId, principal.user.id, body.text),
    );
  }

  /**
   * `POST /api/v1/workflows/{id}/copilot/sessions/{sessionId}/messages/{messageId}/answers` —
   * choose a chip; the answer re-enters the loop.
   *
   * @param tenant - The workspace.
   * @param params - The workflow, the session and the reply that asked.
   * @param principal - The session.
   * @param body - Which question, which option.
   * @param response - Written directly, as a `text/event-stream`.
   * @returns When the stream has ended.
   */
  @Roles(...ADMINISTRATORS)
  @Post("sessions/:sessionId/messages/:messageId/answers")
  async answer(
    @CurrentTenant() tenant: Organization,
    @Param() params: CopilotMessageParams,
    @Session() principal: Principal,
    @Body() body: CopilotAnswerBody,
    @Res() response: SseResponse,
  ): Promise<void> {
    await writeSse(
      response,
      this.copilot.answer(
        tenant.id,
        params.id,
        params.sessionId,
        params.messageId,
        principal.user.id,
        body,
      ),
    );
  }
}
