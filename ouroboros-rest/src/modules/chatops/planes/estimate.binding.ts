/**
 * `/ouro estimate <ticket>` — effort and cycle guess (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * The read is `BacklogDetailService.detailOf` — the backlog side panel's
 * (`GET /api/v1/backlog/{id}`) — and the reply is the estimate in force: effort, the cycle range,
 * the estimated minutes and tokens. **It names no dollar figure**, because an estimate stores
 * none; mockup 19's *"effort, cost, and cycle guess"* is answered with the token estimate, which
 * is the cost an estimate actually carries.
 *
 * When the issue has no estimate, the command starts one through
 * `EstimationTriggerService.estimate` — the *Estimate* button's call
 * (`POST /api/v1/backlog/{id}/estimate`), with its rate limit and its already-estimating refusal.
 *
 * **The one role rule a binding decides.** The registry admits every member, because every
 * member may *read* an estimate; the route that *starts* one is for contributors. The dispatcher
 * cannot say "viewers may run this unless it has to write", so that half is checked here, against
 * the same role list the route's guard uses.
 */

import { Injectable } from "@nestjs/common";

import { BacklogDetailService } from "../../backlog/detail.service";
import { EstimationTriggerService } from "../../estimation/estimation.trigger.service";
import { CONTRIBUTORS } from "../../tenancy/roles.guard";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { argument, ticketReference } from "./binding.arguments";
import { estimateLine } from "./replies";

@Injectable()
export class EstimateBinding implements CommandBinding {
  readonly command = "estimate";

  /**
   * @param backlog - The side panel's read.
   * @param trigger - The *Estimate* button's call.
   */
  constructor(
    private readonly backlog: BacklogDetailService,
    private readonly trigger: EstimationTriggerService,
  ) {}

  /**
   * Read the estimate, or start one.
   *
   * @param context - The invocation.
   * @returns The estimate in one line; or that one was started; or, for a viewer, that there is
   *   none yet.
   * @throws {DomainError} `issue_not_found`; and from the trigger `issue_already_estimating`,
   *   `estimation_rate_limited`.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const ticket = argument(context, "ticket", "ticket");
    const reference = ticketReference(ticket);
    const ref = { issueId: ticket.issueId, issueNumber: ticket.number };
    const { issue, estimate } = await this.backlog.detailOf(context.organizationId, ticket.issueId);

    if (estimate !== null) {
      return {
        kind: "done",
        reply: {
          text: estimateLine(reference, {
            effort: estimate.effort,
            cycleMin: estimate.breakdown.cycleMin,
            cycleMax: estimate.breakdown.cycleMax,
            estMinutes: estimate.breakdown.estMinutes,
            estTokens: estimate.breakdown.estTokens,
            confidence: estimate.confidence,
            suggestedWorkflow: estimate.suggestedWorkflow,
          }),
        },
        ref,
      };
    }

    if (!context.invoker.roles.some((role) => CONTRIBUTORS.includes(role))) {
      return {
        kind: "done",
        reply: {
          text:
            issue.sizingStatus === "estimating"
              ? `${reference} has no estimate yet — one is being worked out. Ask again in a minute.`
              : `${reference} has no estimate yet. Starting one is for workspace owners, admins and members.`,
        },
        ref,
      };
    }

    await this.trigger.estimate(context.organizationId, ticket.issueId);

    return {
      kind: "done",
      reply: {
        text: `${reference} has no estimate yet — started one. Ask again in a minute: /ouro estimate ${reference}`,
      },
      ref,
    };
  }
}
