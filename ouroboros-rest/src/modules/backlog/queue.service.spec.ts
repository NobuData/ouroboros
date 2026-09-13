import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import type { QueueItem } from "../db/schema";
import type { WorkflowRegistryService } from "../workflows/registry.service";
import type { QueuedTicket, TriggerService, WorkflowPin } from "../workflows/trigger.service";
import { QUEUE_ERRORS } from "./queue.errors";
import type { BacklogQueueRepository, QueueCandidate } from "./queue.repository";
import { BacklogQueueService } from "./queue.service";

/**
 * The four rules of the bulk queue write
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)):
 *
 *   * **nothing is written unless everything can be**, and the refusals are ordered `404`,
 *     `422`, `409` so one press is refused for one reason at a time;
 *   * **every refusal names its offenders**, which is the criterion N.4
 *     ([#118](https://github.com/NobuData/ouroboros/issues/118)) renders against;
 *   * **a queue row is copied from the estimate in force** — the effort, the tag and
 *     `est_minutes` — rather than recomputed from anything;
 *   * **an explicit `workflow` wins, and otherwise each issue keeps its own.**
 *
 * A fifth arrived with P.4 ([#135](https://github.com/NobuData/ouroboros/issues/135)): **an
 * explicit workflow must be one the workspace has**, checked against the registry before the
 * selection is read. The vocabulary was a constant caught by the body's `@IsIn` until the
 * amendment absorbed from [#124](https://github.com/NobuData/ouroboros/issues/124) made it a
 * workspace's own workflows.
 *
 * And R.1 ([#143](https://github.com/NobuData/ouroboros/issues/143)) put the workflow itself
 * behind **the trigger service**: this write hands it every issue's facts once, after every
 * refusal, and stores the slug, version and reason it answers. Which workflow wins is
 * `workflows/trigger.evaluation.spec.ts`'; that this write asks, and stores the answer, is here.
 *
 * The repository is a double, so what is asserted here is the *rules* — which id is refused,
 * with which code, in which order, and what is handed to the write. What the statements say is
 * `queue.repository.spec.ts`'.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** Mockup 03's three selected rows, by the ids the fixture and the seed both give them. */
const ISSUE_485 = "5eed0018-0000-4000-8000-000000000485";
const ISSUE_484 = "5eed0018-0000-4000-8000-000000000484";
const ISSUE_491 = "5eed0018-0000-4000-8000-000000000491";

/** One candidate, as the selection statement returns it. */
function candidate(overrides: Partial<QueueCandidate> = {}): QueueCandidate {
  return {
    id: ISSUE_485,
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    githubRepoId: REPO,
    sizingStatus: "sized",
    labels: ["bug"],
    effort: "m",
    suggestedWorkflow: "standard-fix",
    estMinutes: 45,
    ...overrides,
  };
}

/** Mockup 03's selection: `#485`, `#484` and `#491`, sized as the seed sizes them. */
const SELECTION: QueueCandidate[] = [
  candidate(),
  candidate({
    id: ISSUE_484,
    number: 484,
    title: "Motor PID integral windup on wheel stall",
    estMinutes: 50,
  }),
  candidate({
    id: ISSUE_491,
    number: 491,
    title: "Add CRC32 to config persistence layer",
    effort: "s",
    estMinutes: 30,
  }),
];

/** One written row, as `returning *` hands it back. */
function written(position: number, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: `b0b0b0b0-0000-4000-8000-00000000000${position}`,
    organization_id: WORKSPACE,
    github_repo_id: REPO,
    issue_number: 485,
    issue_title: "Watchdog reset on I²C bus lockup",
    effort: "m",
    workflow_tag: "standard-fix",
    workflow_version: null,
    workflow_pin_reason: "suggested",
    position,
    est_minutes: 45,
    enqueued_at: new Date("2026-09-10T15:41:12.000Z"),
    created_at: new Date("2026-09-10T15:41:12.000Z"),
    updated_at: new Date("2026-09-10T15:41:12.000Z"),
    ...overrides,
  };
}

/**
 * The workflows a workspace offers, as `WorkflowRegistryService` answers.
 *
 * Mockup 03's four by default, which is what a workspace with no workflow entities of its own
 * is offered — see `workflows/registry.service.ts` on the bootstrap vocabulary.
 *
 * @param slugs - What this case's workspace has.
 * @returns The registry double, and the workspaces it was asked about.
 */
function registry(slugs: string[] = ["standard-fix", "docs-loop", "feature-loop", "deps-refresh"]) {
  const asked: string[] = [];

  return {
    asked,
    service: {
      offered: (organizationId: string) => {
        asked.push(organizationId);
        return Promise.resolve({ slugs, source: "bootstrap" as const });
      },
    } as unknown as WorkflowRegistryService,
  };
}

/** One call the trigger service received. */
interface PinRequest {
  readonly organizationId: string;
  readonly tickets: readonly QueuedTicket[];
  readonly explicit: string | undefined;
}

/**
 * What the real trigger service answers for a workspace with no workflows: the explicit choice,
 * or each issue's own suggestion, with nothing published to pin.
 *
 * @param ticket - One issue being queued.
 * @param explicit - The workflow the request named, if any.
 * @returns The pin.
 */
function bootstrapPin(ticket: QueuedTicket, explicit: string | undefined): WorkflowPin {
  return explicit === undefined
    ? { slug: ticket.suggestedWorkflow, version: null, reason: "suggested", matched: [] }
    : { slug: explicit, version: null, reason: "explicit", matched: [] };
}

/**
 * R.1's trigger service, as a double that pins whatever a case decides.
 *
 * @param decide - The pin for one ticket. {@link bootstrapPin} by default.
 * @returns The double, and every request it received.
 */
function triggers(decide: typeof bootstrapPin = bootstrapPin) {
  const requests: PinRequest[] = [];

  return {
    requests,
    service: {
      pin: (organizationId: string, tickets: readonly QueuedTicket[], explicit?: string) => {
        requests.push({ organizationId, tickets, explicit });
        return Promise.resolve(tickets.map((ticket) => decide(ticket, explicit)));
      },
    } as unknown as TriggerService,
  };
}

/**
 * A `pg` refusal, as the driver hands one up.
 *
 * @param constraint - Which constraint refused.
 * @returns The error to throw.
 */
function refusal(constraint: string): Error {
  return Object.assign(new Error("refused"), { code: UNIQUE_VIOLATION, constraint });
}

describe("the bulk queue write", () => {
  let repository: jest.Mocked<BacklogQueueRepository>;
  let pins: ReturnType<typeof triggers>;
  let queue: BacklogQueueService;

  beforeEach(() => {
    repository = {
      selection: jest.fn().mockResolvedValue(SELECTION),
      queuedNumbers: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue([written(1)]),
    } as unknown as jest.Mocked<BacklogQueueRepository>;

    pins = triggers();
    queue = new BacklogQueueService(repository, registry().service, pins.service);
  });

  describe("the happy path", () => {
    it("queues the selection and answers the combined estimate", async () => {
      // The mockup's three selected rows, as the seeded fixture sizes them: 45 + 50 + 30. The
      // bar's own *"1h 10m"* is design copy over a backlog of nine, exactly as its *"42 open
      // issues"* is — `intake.fixture.ts` makes the same point about the page head.
      repository.append.mockResolvedValue([
        written(1, { issue_number: 485, est_minutes: 45 }),
        written(2, { issue_number: 484, est_minutes: 50 }),
        written(3, { issue_number: 491, est_minutes: 30 }),
      ]);

      const answer = await queue.queueSelection(WORKSPACE, {
        issueIds: [ISSUE_485, ISSUE_484, ISSUE_491],
      });

      expect(answer.items.map((item) => item.issueNumber)).toEqual([485, 484, 491]);
      expect(answer.estMinutes).toBe(125);
    });

    it("appends in the order the selection was sent, not the order the rows came back", async () => {
      // Positions are handed out down the request's own list, so the queue reads the way the
      // person built the selection.
      repository.selection.mockResolvedValue([SELECTION[2], SELECTION[0], SELECTION[1]]);

      await queue.queueSelection(WORKSPACE, {
        issueIds: [ISSUE_485, ISSUE_484, ISSUE_491],
      });

      const [, rows] = repository.append.mock.calls[0];

      expect(rows.map((row) => row.issueNumber)).toEqual([485, 484, 491]);
    });

    it("copies the effort, the workflow and the estimate off the estimate in force", async () => {
      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] });

      const [organizationId, rows] = repository.append.mock.calls[0];

      expect(organizationId).toBe(WORKSPACE);
      expect(rows).toEqual([
        {
          githubRepoId: REPO,
          issueNumber: 485,
          issueTitle: "Watchdog reset on I²C bus lockup",
          effort: "m",
          workflowTag: "standard-fix",
          workflowVersion: null,
          workflowPinReason: "suggested",
          estMinutes: 45,
        },
      ]);
    });
  });

  describe("the pin", () => {
    it("hands the trigger service every issue's facts, once, for the tenant's workspace", async () => {
      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484, ISSUE_491] });

      expect(pins.requests).toEqual([
        {
          organizationId: WORKSPACE,
          explicit: undefined,
          tickets: [
            { source: "github", labels: ["bug"], effort: "m", suggestedWorkflow: "standard-fix" },
            { source: "github", labels: ["bug"], effort: "m", suggestedWorkflow: "standard-fix" },
            { source: "github", labels: ["bug"], effort: "s", suggestedWorkflow: "standard-fix" },
          ],
        },
      ]);
    });

    it("hands it the workflow the request named", async () => {
      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485], workflow: "deps-refresh" });

      expect(pins.requests.map((request) => request.explicit)).toEqual(["deps-refresh"]);
    });

    it("stores the slug, the version and the reason it chose on each row, in order", async () => {
      // `#485` is a bug the default trigger claims; `#484` carries `docs` and a more specific
      // trigger wins it.
      pins = triggers((ticket) =>
        ticket.labels.includes("docs")
          ? { slug: "docs-loop", version: 2, reason: "most_specific", matched: [] }
          : { slug: "standard-fix", version: 14, reason: "predicate", matched: [] },
      );
      queue = new BacklogQueueService(repository, registry().service, pins.service);
      repository.selection.mockResolvedValue([
        candidate(),
        candidate({ id: ISSUE_484, number: 484, labels: ["docs"] }),
      ]);

      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484] });

      const [, rows] = repository.append.mock.calls[0];
      expect(
        rows.map((row) => [
          row.issueNumber,
          row.workflowTag,
          row.workflowVersion,
          row.workflowPinReason,
        ]),
      ).toEqual([
        [485, "standard-fix", 14, "predicate"],
        [484, "docs-loop", 2, "most_specific"],
      ]);
    });

    it("is not asked about a selection that is refused as unknown", async () => {
      repository.selection.mockResolvedValue([]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.notFound });
      expect(pins.requests).toEqual([]);
    });

    it("is not asked about a selection that is refused as unsized", async () => {
      repository.selection.mockResolvedValue([candidate({ sizingStatus: "unsized" })]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.notQueueable });
      expect(pins.requests).toEqual([]);
    });

    it("is not asked about a selection the queue already holds", async () => {
      repository.queuedNumbers.mockResolvedValue([485]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.conflict });
      expect(pins.requests).toEqual([]);
    });

    it("is not asked about a workflow the registry refuses", async () => {
      queue = new BacklogQueueService(repository, registry(["standard-fix"]).service, pins.service);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485], workflow: "hotfix-p0" }),
      ).rejects.toMatchObject({ response: { code: QUEUE_ERRORS.workflowUnknown } });
      expect(pins.requests).toEqual([]);
    });

    it("is asked once even when the insert loses a race and the conflict is re-read", async () => {
      // The pin is a snapshot taken before the write; answering the race is a second read of the
      // queue, not a second evaluation.
      repository.append.mockRejectedValue(refusal("queue_items_organization_issue_key"));
      repository.queuedNumbers.mockResolvedValueOnce([]).mockResolvedValueOnce([485]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.conflict });
      expect(pins.requests).toHaveLength(1);
    });
  });

  describe("the workflow", () => {
    it("uses each issue's own suggestion when the request names none", async () => {
      // *Queue 3 selected ⟳* — the page head's button, which sends a selection and no tag.
      repository.selection.mockResolvedValue([
        candidate({ suggestedWorkflow: "standard-fix" }),
        candidate({ id: ISSUE_484, number: 484, suggestedWorkflow: "docs-loop" }),
      ]);

      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484] });

      const [, rows] = repository.append.mock.calls[0];

      expect(rows.map((row) => row.workflowTag)).toEqual(["standard-fix", "docs-loop"]);
    });

    it("uses the one the request names for every issue when it names one", async () => {
      // *Queue → standard-fix* — the action bar's button, which sends one tag for the lot.
      repository.selection.mockResolvedValue([
        candidate({ suggestedWorkflow: "docs-loop" }),
        candidate({ id: ISSUE_484, number: 484, suggestedWorkflow: "feature-loop" }),
      ]);

      await queue.queueSelection(WORKSPACE, {
        issueIds: [ISSUE_485, ISSUE_484],
        workflow: "deps-refresh",
      });

      const [, rows] = repository.append.mock.calls[0];

      expect(rows.map((row) => row.workflowTag)).toEqual(["deps-refresh", "deps-refresh"]);
    });

    it("accepts a workflow only this workspace has", async () => {
      // The amendment's whole point: the vocabulary is the workspace's registry, so a slug no
      // installation shares is as valid as `standard-fix` in the workspace that owns it.
      const workflows = registry(["release-train"]);
      queue = new BacklogQueueService(repository, workflows.service, pins.service);
      repository.selection.mockResolvedValue([candidate()]);

      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485], workflow: "release-train" });

      const [, rows] = repository.append.mock.calls[0];
      expect(rows.map((row) => row.workflowTag)).toEqual(["release-train"]);
      expect(workflows.asked).toEqual([WORKSPACE]);
    });

    it("refuses one the workspace does not have, naming the vocabulary", async () => {
      queue = new BacklogQueueService(repository, registry(["standard-fix"]).service, pins.service);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485], workflow: "midnight-loop" }),
      ).rejects.toMatchObject({
        response: {
          code: QUEUE_ERRORS.workflowUnknown,
          details: { workflow: "midnight-loop", offered: ["standard-fix"] },
        },
      });
    });

    it("refuses it before reading the selection, and writes nothing", async () => {
      // A request naming a workflow the workspace does not have cannot succeed for *any*
      // selection, so refusing it first keeps one failure one answer — and costs no statement.
      queue = new BacklogQueueService(repository, registry(["standard-fix"]).service, pins.service);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485], workflow: "midnight-loop" }),
      ).rejects.toBeDefined();

      expect(repository.selection).not.toHaveBeenCalled();
      expect(repository.append).not.toHaveBeenCalled();
    });

    it("does not check the registry when the request names no workflow", async () => {
      // *Queue 3 selected* copies each issue's own suggestion, and that value was held to the
      // offered vocabulary when the estimate was made. Re-checking it here would refuse a
      // stored estimate for naming a workflow that has since been renamed — which is exactly
      // the history decision F8 keeps readable.
      const workflows = registry(["release-train"]);
      queue = new BacklogQueueService(repository, workflows.service, pins.service);
      repository.selection.mockResolvedValue([candidate({ suggestedWorkflow: "standard-fix" })]);

      await queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] });

      const [, rows] = repository.append.mock.calls[0];
      expect(rows.map((row) => row.workflowTag)).toEqual(["standard-fix"]);
      expect(workflows.asked).toEqual([]);
    });
  });

  describe("ids this workspace does not have", () => {
    it("is a 404 naming every id that matched nothing", async () => {
      repository.selection.mockResolvedValue([SELECTION[0]]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484, ISSUE_491] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.notFound,
        details: {
          issues: [
            { issueId: ISSUE_484, code: "issue_not_found" },
            { issueId: ISSUE_491, code: "issue_not_found" },
          ],
        },
      });
    });

    it("writes nothing", async () => {
      repository.selection.mockResolvedValue([]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.notFound });
      expect(repository.append).not.toHaveBeenCalled();
    });

    it("is the same answer for an issue that belongs to another workspace", async () => {
      // The statement is scoped, so somebody else's issue matches nothing here — and a `403`
      // would confirm that the id names a real issue somewhere.
      repository.selection.mockResolvedValue([]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.notFound });
    });
  });

  describe("issues that are not sized", () => {
    it("is a 422 naming each offender and the status it is in", async () => {
      // The acceptance criterion: an unsized issue in the selection refuses the whole request
      // with per-issue codes, so N.4 can name them instead of showing a generic failure.
      repository.selection.mockResolvedValue([
        SELECTION[0],
        candidate({
          id: ISSUE_484,
          number: 483,
          sizingStatus: "estimating",
          effort: null,
          suggestedWorkflow: null,
          estMinutes: null,
        }),
      ]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.notQueueable,
        details: {
          issues: [
            {
              issueId: ISSUE_484,
              code: "issue_not_sized",
              issueNumber: 483,
              sizingStatus: "estimating",
            },
          ],
        },
      });
      expect(repository.append).not.toHaveBeenCalled();
    });

    it("refuses every status that is not `sized`, including one held for a human", async () => {
      // `#490` is `needs_human` *with* an estimate: it has an effort to copy and is still not
      // work the loop should pick up on its own.
      for (const sizingStatus of ["unsized", "estimating", "needs_human"] as const) {
        repository.selection.mockResolvedValue([candidate({ sizingStatus })]);

        await expect(
          queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
        ).rejects.toMatchObject({ code: QUEUE_ERRORS.notQueueable });
      }
    });

    it("names a sized issue whose estimate has gone rather than failing with a 500", async () => {
      // Not a state the pipeline produces — L.3 writes the estimate and the status in one
      // transaction — but one a deleted estimate row leaves behind, and the request is still
      // answerable: that issue cannot be queued, and the others are named beside it.
      repository.selection.mockResolvedValue([
        candidate({ effort: null, suggestedWorkflow: null, estMinutes: null }),
      ]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.notQueueable,
        details: { issues: [{ issueId: ISSUE_485, code: "issue_estimate_missing" }] },
      });
    });

    it("is refused before the queue is even asked about them", async () => {
      // The order is what a client can act on: one press, one reason.
      repository.selection.mockResolvedValue([candidate({ sizingStatus: "unsized" })]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ code: QUEUE_ERRORS.notQueueable });
      expect(repository.queuedNumbers).not.toHaveBeenCalled();
    });
  });

  describe("issues the queue already holds", () => {
    it("is a 409 naming each offender", async () => {
      repository.queuedNumbers.mockResolvedValue([484]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484, ISSUE_491] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.conflict,
        details: {
          issues: [{ issueId: ISSUE_484, code: "issue_already_queued", issueNumber: 484 }],
        },
      });
      expect(repository.append).not.toHaveBeenCalled();
    });

    it("refuses two issues in one selection that share a GitHub number", async () => {
      // `queue_items_organization_issue_key` is `(organization_id, issue_number)`, so a
      // workspace watching two repositories cannot queue both of their `#485`s. Refused before
      // either is written rather than half-applied.
      repository.selection.mockResolvedValue([
        candidate(),
        candidate({ id: ISSUE_484, githubRepoId: "0f0f0f0f-0000-4000-8000-000000000001" }),
      ]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485, ISSUE_484] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.conflict,
        details: {
          issues: [{ issueId: ISSUE_484, code: "issue_number_taken", issueNumber: 485 }],
        },
      });
    });

    it("answers the same 409 when the constraint refuses what the check had allowed", async () => {
      // The window between the check and the insert, closed by the key rather than by hoping.
      // `constraints.ts` makes the argument: the loser of that race must not get a `500` with
      // PostgreSQL's own text in it.
      repository.append.mockRejectedValue(refusal("queue_items_organization_issue_key"));
      repository.queuedNumbers.mockResolvedValueOnce([]).mockResolvedValueOnce([485]);

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({
        code: QUEUE_ERRORS.conflict,
        details: {
          issues: [{ issueId: ISSUE_485, code: "issue_already_queued", issueNumber: 485 }],
        },
      });
    });

    it("leaves a failure that is not a duplicate as the failure it is", async () => {
      // A check violation, a dropped connection, a timeout: the service's problem rather than
      // the caller's, and dressing one up as a `4xx` would hide it.
      repository.append.mockRejectedValue(refusal("queue_items_organization_position_key"));

      await expect(
        queue.queueSelection(WORKSPACE, { issueIds: [ISSUE_485] }),
      ).rejects.toMatchObject({ constraint: "queue_items_organization_position_key" });
    });
  });
});
