import { NotFoundError } from "../errors/error.envelope";
import { ESTIMATION_ERRORS } from "../estimation/estimation.errors";
import type {
  BacklogDetailRepository,
  IssueDetailRow,
  IssueEstimateRow,
} from "./detail.repository";
import { BacklogDetailService } from "./detail.service";

/**
 * The two rules of the endpoint — read without a database, because they are rules rather than
 * statements.
 *
 *   * **The two reads are concurrent**, which is `listing.service.ts`' argument one endpoint
 *     along: a round trip costs more than the statement it carries. Concurrency is asserted the
 *     only way it can be from outside — both statements are in flight before either resolves.
 *   * **An issue this workspace does not have is `404 issue_not_found`**, and it is the *same*
 *     `404` for an id that names nothing and one that names somebody else's issue. That is the
 *     ticket's third criterion, and the thing it protects is that a probe learns nothing.
 *
 * The refusal is deliberately `estimation.errors.ts`', not a second definition of one code —
 * see `detail.service.ts`' header — so this suite asserts the code rather than the message.
 */

const WORKSPACE = "acme-robotics-id";
const ISSUE = "5eed0018-0000-4000-8000-000000000485";

/** One issue row, as the statement returns it. */
const ROW: IssueDetailRow = {
  id: ISSUE,
  number: 485,
  title: "Watchdog reset on I²C bus lockup",
  labels: ["bug", "i2c", "watchdog", "priority-high"],
  state: "open",
  sizingStatus: "sized",
  githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  repository: "acme-robotics/helios-firmware",
  body: "Unit 07 in the Fremont pilot rebooted 14 times overnight.",
  authorLogin: "field-support",
  ghCreatedAt: new Date("2026-09-08T15:41:12.000Z"),
  ghUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
};

/** One estimate row. */
const ESTIMATE: IssueEstimateRow = {
  version: 1,
  effort: "m",
  confidence: 92,
  suggestedWorkflow: "standard-fix",
  routedModel: "claude-fable-5",
  breakdown: {
    files: ["drivers/i2c_recovery.c"],
    est_tokens: 180_000,
    cycle_min: 12,
    cycle_max: 18,
    est_minutes: 45,
  },
  risk: "low",
  riskNote: "Isolated to the I²C driver path.",
  trace: {
    estimator: "heuristic-v0",
    sized_at: "2026-09-10T15:39:12.000Z",
    tokens_used: 0,
    signals: [],
  },
  createdAt: new Date("2026-09-10T15:39:12.000Z"),
};

describe("the backlog detail service", () => {
  let repository: jest.Mocked<BacklogDetailRepository>;
  let service: BacklogDetailService;

  beforeEach(() => {
    repository = {
      issue: jest.fn().mockResolvedValue(ROW),
      estimates: jest.fn().mockResolvedValue([ESTIMATE]),
    } as unknown as jest.Mocked<BacklogDetailRepository>;

    service = new BacklogDetailService(repository);
  });

  it("hands both statements the workspace and the id, and nothing else", () => {
    void service.detailOf(WORKSPACE, ISSUE);

    expect(repository.issue).toHaveBeenCalledWith(WORKSPACE, ISSUE);
    expect(repository.estimates).toHaveBeenCalledWith(WORKSPACE, ISSUE);
  });

  it("issues the two reads together rather than one after the other", async () => {
    // The **first** read is held open and the second is asserted to have gone out anyway, which
    // is what `Promise.all` buys and what a sequential `await` would quietly give away. Holding
    // the second one instead would prove nothing: it is called second either way.
    let settle: (row: IssueDetailRow) => void = () => {};
    repository.issue.mockReturnValue(
      new Promise<IssueDetailRow>((resolve) => {
        settle = resolve;
      }),
    );

    const answered = service.detailOf(WORKSPACE, ISSUE);
    await Promise.resolve();

    expect(repository.estimates).toHaveBeenCalledTimes(1);

    settle(ROW);
    await expect(answered).resolves.toMatchObject({ issue: { number: 485 } });
  });

  it("composes the panel from what the two reads returned", async () => {
    const detail = await service.detailOf(WORKSPACE, ISSUE);

    expect(detail.issue.number).toBe(485);
    expect(detail.estimate!.version).toBe(1);
    expect(detail.history).toHaveLength(1);
  });

  it("answers the issue-only shape for an issue that has never been sized", async () => {
    repository.estimates.mockResolvedValue([]);

    const detail = await service.detailOf(WORKSPACE, ISSUE);

    expect(detail.estimate).toBeNull();
    expect(detail.history).toEqual([]);
    expect(detail.issue.id).toBe(ISSUE);
  });

  it("refuses an issue this workspace does not have with `issue_not_found`", async () => {
    repository.issue.mockResolvedValue(undefined);

    await expect(service.detailOf(WORKSPACE, ISSUE)).rejects.toThrow(NotFoundError);
    await expect(service.detailOf(WORKSPACE, ISSUE)).rejects.toMatchObject({
      code: ESTIMATION_ERRORS.issueNotFound,
      details: { issueId: ISSUE },
    });
  });

  it("answers a cross-workspace id exactly as it answers an unknown one", async () => {
    // The ticket's *404, not 403* criterion, seen from above the statements: this layer cannot
    // tell the two apart, because the `where` in `detail.repository.ts` already collapsed them.
    repository.issue.mockResolvedValue(undefined);
    repository.estimates.mockResolvedValue([]);

    const refusal = await service.detailOf(WORKSPACE, ISSUE).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(NotFoundError);
    expect((refusal as NotFoundError).code).toBe(ESTIMATION_ERRORS.issueNotFound);
  });

  it("discards the estimates it read for an id that was not this workspace's", async () => {
    // Nothing is disclosed by the concurrency: the estimates statement carries the workspace
    // predicate too, so what was discarded had already answered nothing.
    repository.issue.mockResolvedValue(undefined);
    repository.estimates.mockResolvedValue([ESTIMATE]);

    await expect(service.detailOf(WORKSPACE, ISSUE)).rejects.toBeInstanceOf(NotFoundError);
  });
});
