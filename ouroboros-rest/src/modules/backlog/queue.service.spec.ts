import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import type { QueueItem } from "../db/schema";
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
    position,
    est_minutes: 45,
    enqueued_at: new Date("2026-09-10T15:41:12.000Z"),
    created_at: new Date("2026-09-10T15:41:12.000Z"),
    updated_at: new Date("2026-09-10T15:41:12.000Z"),
    ...overrides,
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
  let queue: BacklogQueueService;

  beforeEach(() => {
    repository = {
      selection: jest.fn().mockResolvedValue(SELECTION),
      queuedNumbers: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue([written(1)]),
    } as unknown as jest.Mocked<BacklogQueueRepository>;

    queue = new BacklogQueueService(repository);
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
          estMinutes: 45,
        },
      ]);
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
