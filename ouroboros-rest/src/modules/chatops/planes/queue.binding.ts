/**
 * `/ouro queue <ticket> [workflow]` — send an issue into the loop (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * One call: `BacklogQueueService.queueSelection`, which is what `POST /api/v1/backlog/queue` calls
 * — a selection of one. Trigger evaluation (#143) is inside it, so the workflow a chat command
 * queues under is decided by the same rules as the backlog's action bar.
 *
 * The plane's refusals speak of a selection (*"Some of those issues…"*). A command names exactly
 * one issue, so {@link singleIssueRefusal} says the same refusal about that issue — the code, the
 * status and the details are the plane's, unchanged.
 */

import { Injectable } from "@nestjs/common";

import {
  QUEUE_ERRORS,
  QUEUE_ISSUE_PROBLEMS,
  type QueueIssueProblem,
} from "../../backlog/queue.errors";
import { BacklogQueueService } from "../../backlog/queue.service";
import { ConflictError, DomainError, InvalidRequestError } from "../../errors/error.envelope";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { argument, optionalArgument, ticketReference } from "./binding.arguments";
import { queuedLine } from "./replies";

@Injectable()
export class QueueBinding implements CommandBinding {
  readonly command = "queue";

  /** @param queue - M.3's queue write. */
  constructor(private readonly queue: BacklogQueueService) {}

  /**
   * Queue the issue.
   *
   * @param context - The invocation.
   * @returns `queued at position 2 (pinned standard-fix@v14)`.
   * @throws {DomainError} The queue's own refusals: `queue_issues_not_queueable`,
   *   `queue_issues_conflict`, `queue_issues_not_found`, `queue_workflow_unknown`.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const ticket = argument(context, "ticket", "ticket");
    const workflow = optionalArgument(context, "workflow", "workflow");
    const reference = ticketReference(ticket);

    let selection;
    try {
      selection = await this.queue.queueSelection(context.organizationId, {
        issueIds: [ticket.issueId],
        ...(workflow === undefined ? {} : { workflow: workflow.slug }),
      });
    } catch (error) {
      throw singleIssueRefusal(error, reference);
    }

    const [item] = selection.items;
    if (item === undefined) {
      throw new Error(`The queue accepted ${reference} and returned no row for it.`);
    }

    return {
      kind: "done",
      reply: { text: queuedLine(item.position, item.workflowTag, item.workflowVersion) },
      ref: { queueItemId: item.id, issueNumber: item.issueNumber, position: item.position },
    };
  }
}

/**
 * The queue's refusal of a selection, said about the one issue a command named.
 *
 * @param error - What the queue threw.
 * @param reference - The issue — `#485`.
 * @returns The same refusal with a one-issue sentence, or `error` itself when it is not one of
 *   the queue's per-issue refusals.
 */
export function singleIssueRefusal(error: unknown, reference: string): unknown {
  if (!(error instanceof DomainError)) return error;

  const problems = error.details.issues;
  const problem = Array.isArray(problems)
    ? (problems[0] as QueueIssueProblem | undefined)
    : undefined;

  if (error.code === QUEUE_ERRORS.conflict) {
    return new ConflictError(error.code, `${reference} is already in the queue.`, error.details);
  }

  if (error.code === QUEUE_ERRORS.notQueueable) {
    return new InvalidRequestError(
      error.code,
      problem?.code === QUEUE_ISSUE_PROBLEMS.estimateMissing
        ? `${reference} is marked sized but has no estimate to queue from — run /ouro estimate ${reference}.`
        : `${reference} has not been sized yet${
            problem?.sizingStatus === undefined
              ? ""
              : ` (it is ${problem.sizingStatus.replace("_", " ")})`
          }, and only sized issues can be queued — try /ouro estimate ${reference}.`,
      error.details,
    );
  }

  return error;
}
