/**
 * `/ouro answer <q-id> <action>` — answer a blocking question (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * One call: `InboxActionsService.execute`, the action executor behind
 * `POST /api/v1/inbox/items/:id/actions/:actionId` (#462), with the channel `slack` so the resolution
 * records where it was pressed. The executor checks the action's own requirement against the
 * invoker — role or `can_approve_loops` — so nothing here does; a member who may not press it is
 * refused by the plane, in the plane's words.
 */

import { Injectable } from "@nestjs/common";

import type { DecisionChannel } from "../../db/schema";
import { InboxActionsService } from "../../inbox-actions/inbox-actions.service";
import type { BindingResult, CommandBinding, CommandContext, ChatSurface } from "../grammar.types";
import { argument, requesterOf } from "./binding.arguments";

/** The channel a resolution records for each surface. */
const CHANNELS: Readonly<Record<ChatSurface, DecisionChannel>> = {
  slack: "slack",
  // The in-app console (#539) is the web app.
  console: "web",
};

@Injectable()
export class AnswerBinding implements CommandBinding {
  readonly command = "answer";

  /** @param actions - The action executor. */
  constructor(private readonly actions: InboxActionsService) {}

  /**
   * Press the action as the invoker.
   *
   * @param context - The invocation.
   * @returns What the answer did, from the plane's receipt, and where to see it.
   * @throws {DomainError} The executor's refusals — `decision_action_forbidden`,
   *   `decision_already_answered`, `decision_note_required`, … — and whatever the owning plane
   *   refused with.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const question = argument(context, "question", "question");
    const action = argument(context, "action", "action");
    const result = await this.actions.execute(
      context.organizationId,
      question.itemId,
      action.actionId,
      requesterOf(context.invoker),
      {},
      CHANNELS[context.surface],
    );
    const [link] = result.receipt.links;

    return {
      kind: "done",
      reply: {
        text: `${question.shortId} answered with ${result.resolution.actionId} — ${result.receipt.effects.join(" · ")}`,
        ...(link === undefined
          ? {}
          : { link: { label: link.label, url: `${context.appUrl}${link.href}` } }),
      },
      ref: {
        itemId: result.itemId,
        actionId: result.resolution.actionId,
        attemptId: result.attempt.id,
      },
    };
  }
}
