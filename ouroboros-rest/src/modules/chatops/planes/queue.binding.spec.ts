import { QUEUE_ERRORS, QUEUE_ISSUE_PROBLEMS } from "../../backlog/queue.errors";
import type { BacklogQueueService } from "../../backlog/queue.service";
import {
  ConflictError,
  DomainError,
  InvalidRequestError,
  NotFoundError,
} from "../../errors/error.envelope";
import { bindsOf, contextFor, strictDouble, TICKET, WORKSPACE } from "./planes.fixture";
import { QueueBinding, singleIssueRefusal } from "./queue.binding";

/**
 * `/ouro queue <ticket> [workflow]` (#537) is `BacklogQueueService.queueSelection` — the call
 * `POST /api/v1/backlog/queue` makes (`BacklogQueueController.queueSelection`:
 * `this.queue.queueSelection(tenant.id, body)`), with a selection of one. Trigger evaluation
 * (#143) happens inside that method, so nothing here may pick a workflow itself: the double has
 * that one method, and the binding has no trigger service to reach for.
 */

/** The row the queue answers a selection of one with. */
const ITEM = {
  id: "queue-item-1",
  issueNumber: 485,
  position: 2,
  workflowTag: "standard-fix",
  workflowVersion: 14,
};

describe("the /ouro queue binding", () => {
  let queueSelection: jest.Mock;
  let binding: QueueBinding;

  beforeEach(() => {
    queueSelection = jest.fn().mockResolvedValue({ items: [ITEM] });
    binding = new QueueBinding(
      strictDouble<BacklogQueueService>("BacklogQueueService", { queueSelection }),
    );
  });

  it("serves the queue command, which the registry binds to the backlog's queue route", () => {
    expect(binding.command).toBe("queue");
    expect(bindsOf("queue")).toBe("POST /api/v1/backlog/queue");
  });

  it("queues a selection of one and leaves the workflow to trigger evaluation", async () => {
    await binding.run(contextFor("queue", { ticket: TICKET }));

    expect(queueSelection).toHaveBeenCalledTimes(1);
    // No `workflow` key at all: an absent workflow is what makes the plane evaluate triggers.
    expect(queueSelection).toHaveBeenCalledWith(WORKSPACE, { issueIds: [TICKET.issueId] });
  });

  it("names the workflow when one was typed, as the action bar's menu does", async () => {
    await binding.run(
      contextFor("queue", { ticket: TICKET, workflow: { type: "workflow", slug: "deep-fix" } }),
    );

    expect(queueSelection).toHaveBeenCalledTimes(1);
    expect(queueSelection).toHaveBeenCalledWith(WORKSPACE, {
      issueIds: [TICKET.issueId],
      workflow: "deep-fix",
    });
  });

  it("answers mockup 19's line: the position, and the version the plane pinned", async () => {
    expect(await binding.run(contextFor("queue", { ticket: TICKET }))).toEqual({
      kind: "done",
      reply: { text: "queued at position 2 (pinned standard-fix@v14)" },
      ref: { queueItemId: "queue-item-1", issueNumber: 485, position: 2 },
    });
  });

  it("does not claim a pin for a workflow with nothing published", async () => {
    queueSelection.mockResolvedValue({ items: [{ ...ITEM, workflowVersion: null }] });

    const result = await binding.run(contextFor("queue", { ticket: TICKET }));

    expect(result.reply.text).toBe(
      "queued at position 2 (standard-fix — nothing published to pin)",
    );
  });

  it("fails loudly when the queue accepts the issue and returns no row", async () => {
    queueSelection.mockResolvedValue({ items: [] });

    await expect(binding.run(contextFor("queue", { ticket: TICKET }))).rejects.toThrow(
      "The queue accepted #485 and returned no row for it.",
    );
  });

  it.each([
    ["an unknown issue", new NotFoundError(QUEUE_ERRORS.notFound, "No such issues.")],
    [
      "an unknown workflow",
      new InvalidRequestError(QUEUE_ERRORS.workflowUnknown, "No such workflow."),
    ],
    ["a failure that is no refusal", new Error("connection reset")],
  ])("relays %s as the plane threw it", async (_what, refusal) => {
    queueSelection.mockRejectedValue(refusal);

    await expect(binding.run(contextFor("queue", { ticket: TICKET }))).rejects.toBe(refusal);
  });

  it("says the plane's already-queued refusal about the one issue, code and details kept", async () => {
    const details = { issues: [{ id: TICKET.issueId, code: QUEUE_ISSUE_PROBLEMS.alreadyQueued }] };
    queueSelection.mockRejectedValue(
      new ConflictError(QUEUE_ERRORS.conflict, "Some of those issues are already queued.", details),
    );

    const refusal = await binding
      .run(contextFor("queue", { ticket: TICKET }))
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictError);
    expect(refusal).toMatchObject({
      code: QUEUE_ERRORS.conflict,
      message: "#485 is already in the queue.",
      details,
    });
  });
});

describe("singleIssueRefusal", () => {
  /**
   * The queue's not-queueable refusal for one issue.
   *
   * @param problem - What is wrong with the issue.
   * @returns The error the plane throws.
   */
  function notQueueable(problem: Record<string, unknown>): InvalidRequestError {
    return new InvalidRequestError(
      QUEUE_ERRORS.notQueueable,
      "Some of those issues cannot be queued.",
      { issues: [problem] },
    );
  }

  it("points an unsized issue at /ouro estimate, naming how far sizing has got", () => {
    const plane = notQueueable({ code: QUEUE_ISSUE_PROBLEMS.notSized, sizingStatus: "not_sized" });

    const refusal = singleIssueRefusal(plane, "#485") as DomainError;

    expect(refusal).toBeInstanceOf(InvalidRequestError);
    expect(refusal.code).toBe(QUEUE_ERRORS.notQueueable);
    expect(refusal.getStatus()).toBe(plane.getStatus());
    expect(refusal.details).toBe(plane.details);
    expect(refusal.message).toBe(
      "#485 has not been sized yet (it is not sized), and only sized issues can be queued — try /ouro estimate #485.",
    );
  });

  it("leaves the sizing status out when the plane did not say it", () => {
    const refusal = singleIssueRefusal(
      notQueueable({ code: QUEUE_ISSUE_PROBLEMS.notSized }),
      "#485",
    ) as DomainError;

    expect(refusal.message).toBe(
      "#485 has not been sized yet, and only sized issues can be queued — try /ouro estimate #485.",
    );
  });

  it("says a sized issue with no estimate apart from one that was never sized", () => {
    const refusal = singleIssueRefusal(
      notQueueable({ code: QUEUE_ISSUE_PROBLEMS.estimateMissing }),
      "#485",
    ) as DomainError;

    expect(refusal.message).toBe(
      "#485 is marked sized but has no estimate to queue from — run /ouro estimate #485.",
    );
  });

  it("returns every other refusal, and anything that is not one, untouched", () => {
    const notFound = new NotFoundError(QUEUE_ERRORS.notFound, "No such issues.");
    const fault = new Error("connection reset");

    expect(singleIssueRefusal(notFound, "#485")).toBe(notFound);
    expect(singleIssueRefusal(fault, "#485")).toBe(fault);
    expect(singleIssueRefusal("a string", "#485")).toBe("a string");
  });
});
