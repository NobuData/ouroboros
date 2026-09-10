import { HttpStatus, Logger } from "@nestjs/common";

import type { DomainError } from "../errors/error.envelope";
import { ESTIMATION_ERRORS } from "./estimation.errors";
import { ESTIMATION_ATTEMPTS_PER_WINDOW, EstimationLimiter } from "./estimation.limiter";
import type { EstimationOrchestrator } from "./estimation.orchestrator";
import type { EstimableIssueRow, EstimationRepository } from "./estimation.repository";
import { EstimationTriggerService } from "./estimation.trigger.service";

/**
 * The two presses, and the guards between one and an engine call
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)).
 *
 * Four of the ticket's five acceptance criteria are rules about *what happens before the
 * pipeline is touched*, which makes them this file's rather than the orchestrator's:
 *
 *   * *`estimate-all` touches only non-`estimating` rows and reports how many it enqueued* —
 *     asserted as the statement that is called and the counts that come back. That the
 *     statement really has that scope is `estimation.repository.spec.ts`'.
 *   * *Double-fire while running → 409 with the current status, no duplicate queue entry.*
 *   * *Cross-org id → 404.*
 *   * *Per-org rate limit rejects a hammering caller with a designed error.*
 *
 * The fifth — *a new estimate version (v+1)* — is the pipeline's, and it is asserted against a
 * real database in `estimation.integration-spec.ts`, where a version number exists.
 *
 * The limiter is the **real** one rather than a stub, because the ordering it is part of is
 * itself a decision worth holding: it runs ahead of the read, so a caller collecting `409`s is
 * still a caller being counted.
 */

const ORG = "acme-robotics-id";
const ISSUE = "5eed0018-0000-4000-8000-000000000485";

/** The clock every case runs at. */
const NOW = new Date("2026-09-10T15:00:00.000Z");

/** One mirrored issue, as the scoped read answers it. */
function row(overrides: Partial<EstimableIssueRow> = {}): EstimableIssueRow {
  return {
    issueId: ISSUE,
    organizationId: ORG,
    number: 485,
    title: "I2C bus lockup after IMU sleep/wake cycle",
    body: "After entering low-power sleep and waking the BMI270, the bus locks up.",
    labels: ["bug", "i2c"],
    repo: "acme-robotics/helios-firmware",
    sizingStatus: "sized",
    ...overrides,
  };
}

/** What each collaborator is asked, per test. */
interface Stubs {
  issues: {
    issueIn: jest.Mock;
    claim: jest.Mock;
    backlogCounts: jest.Mock;
    claimBacklog: jest.Mock;
  };
  orchestrator: { enqueue: jest.Mock; estimating: jest.Mock };
  limiter: EstimationLimiter;
}

/**
 * A trigger over stand-ins — one sized issue, an idle queue and an empty window.
 *
 * @param overrides - What this case is about.
 * @returns The service and its stubs.
 */
function build(
  overrides: {
    issue?: EstimableIssueRow;
    missing?: boolean;
    inQueue?: boolean;
    counts?: { total: number; estimating: number };
    claimed?: string[];
    admits?: boolean;
  } = {},
): { service: EstimationTriggerService; stubs: Stubs } {
  const stubs: Stubs = {
    issues: {
      issueIn: jest
        .fn()
        .mockResolvedValue((overrides.missing ?? false) ? undefined : (overrides.issue ?? row())),
      claim: jest.fn().mockResolvedValue(true),
      backlogCounts: jest.fn().mockResolvedValue(overrides.counts ?? { total: 9, estimating: 0 }),
      claimBacklog: jest.fn().mockResolvedValue(overrides.claimed ?? [ISSUE]),
    },
    orchestrator: {
      enqueue: jest.fn().mockReturnValue(overrides.admits ?? true),
      estimating: jest.fn().mockReturnValue(overrides.inQueue ?? false),
    },
    limiter: new EstimationLimiter(),
  };

  return {
    service: new EstimationTriggerService(
      stubs.issues as unknown as EstimationRepository,
      stubs.orchestrator as unknown as EstimationOrchestrator,
      stubs.limiter,
    ),
    stubs,
  };
}

/**
 * The envelope a refused press threw.
 *
 * @param call - The call that should have been refused.
 * @returns Its status and envelope.
 * @throws {Error} When the call was accepted, which is the failure worth naming.
 */
async function refusal(
  call: Promise<unknown>,
): Promise<{ status: number; code: string; details: Record<string, unknown> }> {
  try {
    await call;
  } catch (error) {
    const domain = error as DomainError;

    return {
      status: domain.getStatus(),
      code: domain.envelope().code,
      details: domain.envelope().details,
    };
  }

  throw new Error("the press was accepted, and this case is about it being refused");
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

describe("re-estimating one issue", () => {
  it("claims the row, queues it, and answers what the panel needs", async () => {
    const { service, stubs } = build();

    await expect(service.estimate(ORG, ISSUE, NOW)).resolves.toEqual({
      issueId: ISSUE,
      number: 485,
      repository: "acme-robotics/helios-firmware",
      status: "estimating",
    });

    expect(stubs.issues.claim).toHaveBeenCalledWith(ISSUE);
    expect(stubs.orchestrator.enqueue).toHaveBeenCalledWith(ISSUE);
  });

  it("claims before it queues, so the status it answers with is already true", async () => {
    // If it only queued, the answer would say `estimating` while a client re-reading the issue
    // still saw `sized` — and the double-fire refusal would come from one process's memory
    // rather than from a column every replica can read.
    const order: string[] = [];
    const { service, stubs } = build();
    stubs.issues.claim.mockImplementation(() => {
      order.push("claim");

      return Promise.resolve(true);
    });
    stubs.orchestrator.enqueue.mockImplementation(() => {
      order.push("queue");

      return true;
    });

    await service.estimate(ORG, ISSUE, NOW);

    expect(order).toEqual(["claim", "queue"]);
  });

  it("reads the issue scoped to the workspace, never filtered afterwards", async () => {
    const { service, stubs } = build();

    await service.estimate(ORG, ISSUE, NOW);

    expect(stubs.issues.issueIn).toHaveBeenCalledWith(ORG, ISSUE);
  });

  it.each(["unsized", "sized", "needs_human"] as const)(
    "accepts an issue that is %s",
    async (sizingStatus) => {
      // Every status but `estimating` is re-estimable: the mockup offers the button on a sized
      // issue *and* on one a person was asked to look at.
      const { service } = build({ issue: row({ sizingStatus }) });

      await expect(service.estimate(ORG, ISSUE, NOW)).resolves.toMatchObject({
        status: "estimating",
      });
    },
  );
});

describe("refusing one issue", () => {
  it("answers 404 for an issue this workspace does not have", async () => {
    // Cross-org and missing are one answer: the scoped read returns nothing for both, and
    // nothing is what a 404 is honest about.
    const { service, stubs } = build({ missing: true });

    const refused = await refusal(service.estimate(ORG, ISSUE, NOW));

    expect(refused.status).toBe(HttpStatus.NOT_FOUND);
    expect(refused.code).toBe(ESTIMATION_ERRORS.issueNotFound);
    expect(stubs.issues.claim).not.toHaveBeenCalled();
    expect(stubs.orchestrator.enqueue).not.toHaveBeenCalled();
  });

  it("answers 409 with the current status when the column says estimating", async () => {
    const { service, stubs } = build({ issue: row({ sizingStatus: "estimating" }) });

    const refused = await refusal(service.estimate(ORG, ISSUE, NOW));

    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.code).toBe(ESTIMATION_ERRORS.alreadyEstimating);
    expect(refused.details).toEqual({ status: "estimating" });
    // *No duplicate queue entry* — the criterion's second half, and the one a client cannot
    // see: an accepted double-fire would spend an engine call to write the same answer twice.
    expect(stubs.orchestrator.enqueue).not.toHaveBeenCalled();
  });

  it("answers 409 when the queue holds it but the column has not moved yet", async () => {
    // The window the column cannot see: a row this process queued a moment ago still says
    // `sized` until the work reaches it. Both halves are checked, because they fail
    // differently — the column survives a restart and is visible to every replica; the queue
    // knows about the seconds before a claim.
    const { service, stubs } = build({ inQueue: true });

    expect((await refusal(service.estimate(ORG, ISSUE, NOW))).code).toBe(
      ESTIMATION_ERRORS.alreadyEstimating,
    );
    expect(stubs.orchestrator.enqueue).not.toHaveBeenCalled();
  });
});

describe("re-estimating the whole backlog", () => {
  it("claims every eligible row and reports what it took", async () => {
    const { service, stubs } = build({
      counts: { total: 9, estimating: 2 },
      claimed: ["a", "b", "c", "d", "e", "f", "g"],
    });

    await expect(service.estimateAll(ORG, NOW)).resolves.toEqual({
      enqueued: 7,
      skipped: 2,
      total: 9,
    });

    expect(stubs.issues.claimBacklog).toHaveBeenCalledWith(ORG);
    expect(stubs.orchestrator.enqueue).toHaveBeenCalledTimes(7);
  });

  it("counts before it claims, so `total` describes the backlog the caller asked about", async () => {
    const order: string[] = [];
    const { service, stubs } = build();
    stubs.issues.backlogCounts.mockImplementation(() => {
      order.push("count");

      return Promise.resolve({ total: 9, estimating: 0 });
    });
    stubs.issues.claimBacklog.mockImplementation(() => {
      order.push("claim");

      return Promise.resolve([ISSUE]);
    });

    await service.estimateAll(ORG, NOW);

    expect(order).toEqual(["count", "claim"]);
  });

  it("counts a claimed row the queue already held as skipped rather than enqueued", async () => {
    // It is in flight either way; reporting it as work this request began would overstate what
    // the press did.
    const { service } = build({
      counts: { total: 2, estimating: 0 },
      claimed: ["a", "b"],
      admits: false,
    });

    await expect(service.estimateAll(ORG, NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 2,
      total: 2,
    });
  });

  it("answers zeros for a workspace that mirrors nothing", async () => {
    // Empty is a state, not a failure — and deliberately not the 409 below.
    const { service } = build({ counts: { total: 0, estimating: 0 }, claimed: [] });

    await expect(service.estimateAll(ORG, NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
      total: 0,
    });
  });

  it("answers 409 when a fan-out is already running", async () => {
    // Pressed twice. The first press claimed every eligible row, so this one has nothing to
    // take — and `202 {enqueued: 0}` would report *accepted* for a request that started
    // nothing.
    const { service, stubs } = build({ counts: { total: 9, estimating: 9 }, claimed: [] });

    const refused = await refusal(service.estimateAll(ORG, NOW));

    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.code).toBe(ESTIMATION_ERRORS.backlogEstimating);
    expect(refused.details).toEqual({ estimating: 9 });
    expect(stubs.orchestrator.enqueue).not.toHaveBeenCalled();
  });
});

describe("the rate limit", () => {
  it("refuses a workspace that has asked too often, with a wait", async () => {
    const { service } = build();

    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      await service.estimate(ORG, ISSUE, NOW);
    }

    const refused = await refusal(service.estimate(ORG, ISSUE, NOW));

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(refused.code).toBe(ESTIMATION_ERRORS.rateLimited);
    expect(refused.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts both endpoints against one window, because both spend the same quota", async () => {
    const { service } = build();

    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      await service.estimate(ORG, ISSUE, NOW);
    }

    expect((await refusal(service.estimateAll(ORG, NOW))).code).toBe(ESTIMATION_ERRORS.rateLimited);
  });

  it("counts a request that is about to be refused 409", async () => {
    // The caller the criterion names is *mostly* collecting conflicts: their second click lands
    // on an issue their first one moved into `estimating`. A limiter that only counted
    // accepted work would never see them.
    const { service } = build({ issue: row({ sizingStatus: "estimating" }) });

    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      expect((await refusal(service.estimate(ORG, ISSUE, NOW))).code).toBe(
        ESTIMATION_ERRORS.alreadyEstimating,
      );
    }

    expect((await refusal(service.estimate(ORG, ISSUE, NOW))).code).toBe(
      ESTIMATION_ERRORS.rateLimited,
    );
  });

  it("is checked before anything is read, so a full window costs no query", async () => {
    const { service, stubs } = build();

    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      await service.estimate(ORG, ISSUE, NOW);
    }

    stubs.issues.issueIn.mockClear();
    await refusal(service.estimate(ORG, ISSUE, NOW));

    expect(stubs.issues.issueIn).not.toHaveBeenCalled();
  });

  it("limits each workspace on its own", async () => {
    const { service } = build();

    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      await service.estimate(ORG, ISSUE, NOW);
    }

    await expect(service.estimate("kensuenobu-id", ISSUE, NOW)).resolves.toMatchObject({
      status: "estimating",
    });
  });
});
