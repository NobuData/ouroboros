/**
 * Slack's button presses, answered by the chat module (BZ.4,
 * [#538](https://github.com/NobuData/ouroboros/issues/538)).
 *
 * `SlackInboundService` receives a press but cannot depend on what answers it: the chat module
 * already depends on this one for its backend. So the binding runs the other way — this provider
 * lives beside the chat module's others (`chat.module.ts`) and, at start, tells the inbound
 * service where presses go. Before that, and in a deployment without it, a press is told
 * answering is not available and changes nothing.
 */

import { Injectable, type OnModuleInit } from "@nestjs/common";

import { ChatAnswers } from "../chat/chat.answers";
import { SlackInboundService } from "./slack.inbound.service";

@Injectable()
export class SlackPressHandler implements OnModuleInit {
  /**
   * @param inbound - Receives Slack's interactions.
   * @param answers - Answers a press through the inbox's action executor.
   */
  constructor(
    private readonly inbound: SlackInboundService,
    private readonly answers: ChatAnswers,
  ) {}

  /** Route presses to the answering service. */
  onModuleInit(): void {
    this.inbound.answerPressesWith(this.answers);
  }
}
