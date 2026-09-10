import { Logger } from "@nestjs/common";

import type { AppConfigService } from "../config/config.service";
import type { EngineClient } from "../engine/engine.client";
import { engineUnavailable } from "../engine/engine.errors";
import type { Estimate, EstimateRequest } from "../engine/engine.contract";
import type { EstimationContextService } from "./estimation.context";
import {
  drainMicrotasks,
  estimate,
  FIXTURE_CONTEXT,
  FIXTURE_ISSUE_ID,
  FIXTURE_WORKSPACE,
  issueRow,
} from "./estimation.fixture";
import {
  EstimationOrchestrator,
  MAX_ENGINE_ATTEMPTS,
  SWEEP_BATCH,
} from "./estimation.orchestrator";
import type { EstimableIssueRow, EstimationRepository } from "./estimation.repository";
import type { NewIssueEstimate } from "../db/schema";
import type { EstimatedStatus } from "./estimation.outcome";

/**
 * The state machine ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Every collaborator is a recording stand-in, because what is under test is *the order things
 * happen in and what is written when they go wrong* — which is the one thing neither the SQL
 * assertions in `estimation.repository.spec.ts` nor the integration suite can isolate. That
 * every path leaves a terminal status is the acceptance criterion *"never leaves a row stuck"*,
 * and it is asserted here failure by failure.
 */

/** What a stand-in repository recorded. */
interface RepositoryLog {
  claimed: string[];
  persisted: { issueId: string; status: EstimatedStatus; row: NewIssueEstimate }[];
  settled: { issueId: string; status: EstimatedStatus }[];
}

/** How a stand-in is told to behave. */
interface Behaviour {
  issue?: EstimableIssueRow | undefined;
  context?: typeof FIXTURE_CONTEXT | undefined;
  /** What the engine does, per attempt (1-based). */
  engine?: (attempt: number) => Promise<Estimate>;
  /** Issue ids the sweep's read answers with. */
  stale?: string[];
  /** Make the versioned write fail. */
  persistFails?: boolean;
  /** Make the terminal-status write fail. */
  settleFails?: boolean;
  concurrency?: number;
  confidenceFloor?: number;
  staleSeconds?: number;
}

/**
 * An orchestrator over stand-ins, and the record of what it did.
 *
 * @param behaviour - What the collaborators do.
 * @returns The orchestrator, the repository's record, and the engine requests it made.
 */
function build(behaviour: Behaviour = {}) {
  const log: RepositoryLog = { claimed: [], persisted: [], settled: [] };
  const requests: EstimateRequest[] = [];
  const staleReads: { olderThan: Date; limit: number }[] = [];

  const issues = {
    issue: async (issueId: string) =>
      Promise.resolve("issue" in behaviour ? behaviour.issue : issueRow({ issueId })),
    claim: async (issueId: string) => {
      log.claimed.push(issueId);
      return Promise.resolve(true);
    },
    persist: async (
      issueId: string,
      status: EstimatedStatus,
      make: (version: number) => NewIssueEstimate,
    ) => {
      if (behaviour.persistFails === true) {
        return Promise.reject(new Error("the column refused it"));
      }

      log.persisted.push({ issueId, status, row: make(1) });
      return Promise.resolve(1);
    },
    settle: async (issueId: string, status: EstimatedStatus) => {
      if (behaviour.settleFails === true) {
        return Promise.reject(new Error("the pool is exhausted"));
      }

      log.settled.push({ issueId, status });
      return Promise.resolve(true);
    },
    staleIssues: async (olderThan: Date, limit: number) => {
      staleReads.push({ olderThan, limit });
      return Promise.resolve(behaviour.stale ?? []);
    },
  } as unknown as EstimationRepository;

  const engine = {
    estimate: async (request: EstimateRequest) => {
      requests.push(request);
      return (behaviour.engine ?? (async () => Promise.resolve(estimate())))(requests.length);
    },
  } as unknown as EngineClient;

  const context = {
    forWorkspace: async () =>
      Promise.resolve("context" in behaviour ? behaviour.context : FIXTURE_CONTEXT),
  } as unknown as EstimationContextService;

  const config = {
    estimationConcurrency: behaviour.concurrency ?? 4,
    estimationConfidenceFloor: behaviour.confidenceFloor ?? 70,
    estimationStaleSeconds: behaviour.staleSeconds ?? 600,
  } as unknown as AppConfigService;

  return {
    orchestrator: new EstimationOrchestrator(issues, engine, context, config),
    log,
    requests,
    staleReads,
  };
}

/** One issue's handoff, as the backlog sync builds it. */
function handoff(issueId = FIXTURE_ISSUE_ID) {
  return {
    organizationId: FIXTURE_WORKSPACE,
    issueId,
    githubRepoId: "dfff0000-0000-0000-0000-00000000000a",
    number: 485,
    reason: "imported" as const,
  };
}

// The orchestrator narrates every issue it finishes, which is the behaviour an operator wants
// and noise a test runner does not. Silenced once here; the suites that assert *what* was
// logged spy again, which hands them the same mock rather than a second one.
beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("the happy path", () => {
  it("claims, sizes, and writes an estimate with the issue's status", async () => {
    const { orchestrator, log, requests } = build();

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.claimed).toEqual([FIXTURE_ISSUE_ID]);
    expect(requests).toHaveLength(1);
    expect(log.persisted).toHaveLength(1);
    expect(log.persisted[0]).toMatchObject({ issueId: FIXTURE_ISSUE_ID, status: "sized" });
    expect(log.settled).toHaveLength(0);
  });

  it("sends the issue and the workspace's vocabularies as the L.1 payload", async () => {
    const { orchestrator, requests } = build();

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(requests[0]).toEqual({
      issue: {
        number: 485,
        title: "I2C bus lockup after IMU sleep/wake cycle",
        body: "After entering low-power sleep and waking the BMI270, the I2C bus locks up.",
        labels: ["bug", "i2c", "watchdog"],
        repo: "acme-robotics/helios-firmware",
      },
      context: FIXTURE_CONTEXT,
    });
  });

  it("claims *after* the context resolved, so a workspace with no routes is never claimed", async () => {
    // The order matters: a claim writes `estimating`, and writing it for an issue that is then
    // never dispatched would put an `estimating…` pill on the page with nothing behind it —
    // until the sweep found it, forever, on every cycle.
    const { orchestrator, log } = build({ context: undefined });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.claimed).toEqual([]);
    expect(log.persisted).toHaveLength(0);
    expect(log.settled).toHaveLength(0);
  });

  it("routes an estimate under the floor to needs_human, and stores it anyway", async () => {
    // mockup 03's #490. The estimate is a real answer with a real trace, and the pill beside it
    // says a person should look — discarding it would throw away what they are looking at.
    const { orchestrator, log } = build({
      engine: async () => Promise.resolve(estimate({ confidence: 61, effort: "xl" })),
    });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.persisted[0]?.status).toBe("needs_human");
    expect(log.persisted[0]?.row.effort).toBe("xl");
    expect(log.settled).toHaveLength(0);
  });

  it("honours a floor an installation moved", async () => {
    const { orchestrator, log } = build({ confidenceFloor: 95 });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.persisted[0]?.status).toBe("needs_human");
  });
});

describe("when the engine cannot answer", () => {
  it("tries once more before giving up", async () => {
    const { orchestrator, log, requests } = build({
      engine: async (attempt) =>
        attempt === 1 ? Promise.reject(engineUnavailable()) : Promise.resolve(estimate()),
    });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(requests).toHaveLength(2);
    expect(log.persisted[0]?.status).toBe("sized");
  });

  it("gives up after exactly two attempts and leaves the issue to a person", async () => {
    const { orchestrator, log, requests } = build({
      engine: async () => Promise.reject(engineUnavailable()),
    });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(requests).toHaveLength(MAX_ENGINE_ATTEMPTS);
    expect(log.settled).toEqual([{ issueId: FIXTURE_ISSUE_ID, status: "needs_human" }]);
  });

  it("writes no estimate row for a failure", async () => {
    // `issue_estimates` has no nullable effort and no "unknown". A row invented here would put
    // an effort chip on the backlog table for an issue nothing sized, and a `trace.estimator`
    // on a record of nothing — decision K10 read backwards.
    const { orchestrator, log } = build({
      engine: async () => Promise.reject(engineUnavailable()),
    });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.persisted).toHaveLength(0);
  });

  it("names the issue and the failure in the log — honest, not silent", async () => {
    const warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { orchestrator } = build({ engine: async () => Promise.reject(engineUnavailable()) });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining("acme-robotics/helios-firmware#485"),
    );
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("needs a human"));
  });
});

describe("when the write fails", () => {
  it("leaves the issue to a person rather than in `estimating`", async () => {
    // A row V026 refuses would fail identically on every retry, so retrying it is how an issue
    // gets stuck in a loop between this class and the sweep.
    const { orchestrator, log } = build({ persistFails: true });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.settled).toEqual([{ issueId: FIXTURE_ISSUE_ID, status: "needs_human" }]);
  });

  it("does not throw when even the terminal write fails — the sweep is the backstop", async () => {
    const { orchestrator } = build({ persistFails: true, settleFails: true });

    await expect(orchestrator.accept([handoff()])).resolves.toBeUndefined();
    await expect(orchestrator.settled()).resolves.toBeUndefined();
  });
});

describe("an issue that is gone", () => {
  it("is not claimed, not sized and not settled", async () => {
    // Ordinary: the sync hands work over after committing, and a repository that left scope in
    // between takes its issues with it (`on delete cascade`).
    const { orchestrator, log, requests } = build({ issue: undefined });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.claimed).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(log.settled).toHaveLength(0);
  });
});

describe("queueing", () => {
  it("is silent and does nothing for an empty batch, which is most polls", async () => {
    const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const { orchestrator, requests } = build();

    await orchestrator.accept([]);

    expect(requests).toHaveLength(0);
    expect(logged).not.toHaveBeenCalled();
  });

  it("returns before the estimates are done, so a poll cycle is not held open", async () => {
    // The caller is a sync cycle holding a GitHub token's rate budget; waiting for a backlog to
    // be sized would keep that open for the length of an import.
    let release: (value: Estimate) => void = () => undefined;
    const { orchestrator, log } = build({
      engine: async () =>
        new Promise<Estimate>((resolve) => {
          release = resolve;
        }),
    });

    await orchestrator.accept([handoff()]);
    // `accept` resolves once the work is *queued*, so the job has not yet reached its first
    // engine call. One turn of the loop is what lets it get there — and the point of the test
    // is that the caller was already back before that happened.
    await drainMicrotasks();

    expect(log.persisted).toHaveLength(0);
    expect(orchestrator.estimating(FIXTURE_ISSUE_ID)).toBe(true);

    release(estimate());
    await orchestrator.settled();

    expect(log.persisted).toHaveLength(1);
  });

  it("refuses an issue it is already estimating", () => {
    // The state L.4 (#108) answers a double-fire with `409` for, read from the queue rather
    // than from a second look at a column that may have moved since.
    const { orchestrator } = build({ concurrency: 1 });

    expect(orchestrator.enqueue(FIXTURE_ISSUE_ID)).toBe(true);
    expect(orchestrator.enqueue(FIXTURE_ISSUE_ID)).toBe(false);
    expect(orchestrator.estimating(FIXTURE_ISSUE_ID)).toBe(true);
  });

  it("estimates every distinct issue in a batch", async () => {
    const { orchestrator, requests } = build();

    await orchestrator.accept([handoff("issue-a"), handoff("issue-b"), handoff("issue-c")]);
    await orchestrator.settled();

    expect(requests).toHaveLength(3);
  });
});

describe("the recovery sweep", () => {
  it("asks for rows claimed before the staleness threshold, in a bounded batch", async () => {
    const { orchestrator, staleReads } = build({ staleSeconds: 300 });
    const before = Date.now();

    await orchestrator.sweep();

    const [read] = staleReads;
    expect(read?.limit).toBe(SWEEP_BATCH);
    expect(read?.olderThan.getTime()).toBeLessThanOrEqual(before - 300_000);
    expect(read?.olderThan.getTime()).toBeGreaterThan(before - 301_000);
  });

  it("re-queues what it found, and re-estimates it", async () => {
    const { orchestrator, log, requests } = build({ stale: ["stranded"] });

    const report = await orchestrator.sweep();
    await orchestrator.settled();

    expect(report).toEqual({ stale: 1, requeued: 1, inFlight: 0 });
    expect(requests).toHaveLength(1);
    expect(log.persisted[0]?.status).toBe("sized");
  });

  it("counts, rather than re-running, work this process already holds", async () => {
    // A sweep that keeps finding its own in-flight work means the threshold is set below how
    // long an estimate legitimately takes — a misconfiguration nothing else would report.
    let release: (value: Estimate) => void = () => undefined;
    const { orchestrator, requests } = build({
      stale: [FIXTURE_ISSUE_ID],
      engine: async () =>
        new Promise<Estimate>((resolve) => {
          release = resolve;
        }),
    });

    await orchestrator.accept([handoff()]);
    await drainMicrotasks();
    const report = await orchestrator.sweep();

    expect(report).toEqual({ stale: 1, requeued: 0, inFlight: 1 });
    expect(requests).toHaveLength(1);

    release(estimate());
    await orchestrator.settled();
  });

  it("reports nothing on a healthy service", async () => {
    await expect(build().orchestrator.sweep()).resolves.toEqual({
      stale: 0,
      requeued: 0,
      inFlight: 0,
    });
  });
});
