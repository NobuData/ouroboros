import { Logger } from "@nestjs/common";

import type { AppConfigService } from "../config/config.service";
import type { EngineClient } from "../engine/engine.client";
import { engineUnavailable } from "../engine/engine.errors";
import type { Estimate, EstimateRequest } from "../engine/engine.contract";
import type { EstimationContextService } from "./estimation.context";
import {
  deferred,
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
  draftNumber,
  draftQueueKey,
  ticketQueueKey,
  type DraftSizingOutcome,
} from "./estimation.orchestrator";
import type { EstimableTicketRow } from "./estimation.ticket";
import type { ResizeReviewEmitter } from "./resize-review.emitter";
import type {
  EstimableDraftRow,
  EstimableIssueRow,
  EstimationRepository,
} from "./estimation.repository";
import type { NewIssueEstimate } from "../db/schema";
import type { ContextManifest } from "../context-assembly/context-assembly.resources";
import type {
  AssemblyScope,
  ContextAssemblyService,
  InjectionInput,
} from "../context-assembly/context-assembly.service";
import { EstimationKnowledge } from "./estimation.knowledge";
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
  draftsPersisted: { draftId: string; row: NewIssueEstimate }[];
  settled: { issueId: string; status: EstimatedStatus }[];
  ticketsClaimed: string[];
  ticketsPersisted: { ticketId: string; status: EstimatedStatus; row: NewIssueEstimate }[];
  ticketsSettled: { ticketId: string; status: EstimatedStatus }[];
  /** What context assembly was asked for, and what was recorded against it (#414). */
  assembled: { organizationId: string; repo: string | null | undefined }[];
  injected: { organizationId: string; injection: InjectionInput }[];
}

/** How a stand-in is told to behave. */
interface Behaviour {
  issue?: EstimableIssueRow | undefined;
  draft?: EstimableDraftRow | undefined;
  context?: typeof FIXTURE_CONTEXT | undefined;
  /** What the engine does, per attempt (1-based). */
  engine?: (attempt: number) => Promise<Estimate>;
  /** Issue ids the sweep's read answers with. */
  stale?: string[];
  ticket?: EstimableTicketRow | undefined;
  /** Ticket ids the sweep's ticket read answers with. */
  staleTickets?: string[];
  /** Make the ticket read fail. */
  ticketReadFails?: boolean;
  /** Make the versioned write fail. */
  persistFails?: boolean;
  /** Make the terminal-status write fail. */
  settleFails?: boolean;
  concurrency?: number;
  confidenceFloor?: number;
  staleSeconds?: number;
  /** The estimator's context manifest; none (no facts) by default. */
  manifest?: ContextManifest;
  /** Make context assembly fail. */
  assemblyFails?: boolean;
  /** Make the injection record fail. */
  recordFails?: boolean;
  /** The version the ticket's write answers with — 2 and up is a re-estimate. */
  ticketVersion?: number;
  /** The Needs-You emitter (#461), when the case listens to it. */
  resizes?: ResizeReviewEmitter;
}

/**
 * An orchestrator over stand-ins, and the record of what it did.
 *
 * @param behaviour - What the collaborators do.
 * @returns The orchestrator, the repository's record, and the engine requests it made.
 */
function build(behaviour: Behaviour = {}) {
  const log: RepositoryLog = {
    claimed: [],
    persisted: [],
    settled: [],
    draftsPersisted: [],
    ticketsClaimed: [],
    ticketsPersisted: [],
    ticketsSettled: [],
    assembled: [],
    injected: [],
  };
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
    draft: async (draftId: string) =>
      Promise.resolve(
        "draft" in behaviour
          ? behaviour.draft
          : {
              draftId,
              batchId: "b2800000-0000-0000-0000-0000000000b1",
              organizationId: FIXTURE_WORKSPACE,
              localKey: "OTA-3",
              title: "Rollback state machine on failed boot confirmation",
              body: "- restore the previous slot",
            },
      ),
    persistDraft: async (draftId: string, make: (version: number) => NewIssueEstimate) => {
      if (behaviour.persistFails === true) {
        return Promise.reject(new Error("the column refused it"));
      }

      log.draftsPersisted.push({ draftId, row: make(1) });
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
    ticket: async (ticketId: string) => {
      if (behaviour.ticketReadFails === true) {
        return Promise.reject(new Error("the connection dropped"));
      }

      return Promise.resolve("ticket" in behaviour ? behaviour.ticket : ticketRow({ ticketId }));
    },
    claimTicket: async (ticketId: string) => {
      log.ticketsClaimed.push(ticketId);
      return Promise.resolve(true);
    },
    persistTicket: async (
      ticketId: string,
      status: EstimatedStatus,
      make: (version: number) => NewIssueEstimate,
    ) => {
      if (behaviour.persistFails === true) {
        return Promise.reject(new Error("the column refused it"));
      }

      log.ticketsPersisted.push({ ticketId, status, row: make(behaviour.ticketVersion ?? 1) });
      return Promise.resolve(behaviour.ticketVersion ?? 1);
    },
    settleTicket: async (ticketId: string, status: EstimatedStatus) => {
      if (behaviour.settleFails === true) {
        return Promise.reject(new Error("the pool is exhausted"));
      }

      log.ticketsSettled.push({ ticketId, status });
      return Promise.resolve(true);
    },
    staleTickets: async (olderThan: Date, limit: number) => {
      staleReads.push({ olderThan, limit });
      return Promise.resolve(behaviour.staleTickets ?? []);
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

  const assembly = {
    assemble: async (organizationId: string, scope: AssemblyScope) => {
      log.assembled.push({ organizationId, repo: scope.repo });
      if (behaviour.assemblyFails === true) {
        return Promise.reject(new Error("the skills read failed"));
      }
      return Promise.resolve(behaviour.manifest ?? estimatorManifest([]));
    },
    record: async (organizationId: string, injection: InjectionInput) => {
      if (behaviour.recordFails === true) {
        return Promise.reject(new Error("context_injections_resolves"));
      }
      log.injected.push({ organizationId, injection });
      return Promise.resolve();
    },
  } as unknown as ContextAssemblyService;

  return {
    orchestrator: new EstimationOrchestrator(
      issues,
      engine,
      context,
      config,
      new EstimationKnowledge(assembly),
      behaviour.resizes,
    ),
    log,
    requests,
    staleReads,
  };
}

/** The canonical ticket the ticket cases size — seeded `#588`. */
const TICKET_ID = "5eed001d-0000-4000-8000-000000000588";

/**
 * A canonical ticket, as `EstimationRepository.ticket` reads it.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
function ticketRow(overrides: Partial<EstimableTicketRow> = {}): EstimableTicketRow {
  return {
    ticketId: TICKET_ID,
    organizationId: FIXTURE_WORKSPACE,
    externalKey: "#588",
    title: "Compress telemetry frames with heatshrink",
    body: null,
    labels: ["telemetry", "enhancement"],
    meta: { github: { owner: "acme-robotics", repo: "helios-telemetry" } },
    sourceKind: "github",
    sourceName: "GitHub · acme-robotics",
    ...overrides,
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
      context: { ...FIXTURE_CONTEXT, facts: [] },
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

  it("re-queues stranded canonical tickets too, in their own bounded read (AL.5, #281)", async () => {
    const { orchestrator, log, staleReads } = build({
      stale: ["stranded"],
      staleTickets: [TICKET_ID],
    });

    const report = await orchestrator.sweep();
    await orchestrator.settled();

    expect(staleReads.map((read) => read.limit)).toEqual([SWEEP_BATCH, SWEEP_BATCH]);
    expect(report).toEqual({ stale: 2, requeued: 2, inFlight: 0 });
    expect(log.persisted).toHaveLength(1);
    expect(log.ticketsPersisted.map((write) => write.ticketId)).toEqual([TICKET_ID]);
  });

  it("reports nothing on a healthy service", async () => {
    await expect(build().orchestrator.sweep()).resolves.toEqual({
      stale: 0,
      requeued: 0,
      inFlight: 0,
    });
  });
});

describe("sizing a ticket draft (AL.4, #280 — one sizer, decision N3)", () => {
  /** The draft every case sizes. */
  const DRAFT_ID = "d2800000-0000-0000-0000-0000000000d3";

  /** A listener that records how each draft ended. */
  function recorder() {
    const outcomes: [string, DraftSizingOutcome][] = [];

    return {
      outcomes,
      listener: async (draftId: string, outcome: DraftSizingOutcome) => {
        outcomes.push([draftId, outcome]);
        return Promise.resolve();
      },
    };
  }

  it("asks the same engine with the draft's title, body, key position and push target", async () => {
    const { orchestrator, requests, log } = build();
    const { outcomes, listener } = recorder();

    expect(
      orchestrator.enqueueDraft(
        { draftId: DRAFT_ID, repo: "acme-robotics/helios-firmware" },
        listener,
      ),
    ).toBe(true);
    await orchestrator.settled();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      issue: {
        number: 3,
        title: "Rollback state machine on failed boot confirmation",
        body: "- restore the previous slot",
        labels: [],
        repo: "acme-robotics/helios-firmware",
      },
      context: { ...FIXTURE_CONTEXT, facts: [] },
    });
    expect(log.draftsPersisted).toHaveLength(1);
    expect(log.draftsPersisted[0].row).toMatchObject({ draft_id: DRAFT_ID, github_issue_id: null });
    // A draft has no sizing status: nothing is claimed, settled, or written against an issue.
    expect(log.claimed).toEqual([]);
    expect(log.settled).toEqual([]);
    expect(log.persisted).toEqual([]);
    expect(outcomes).toEqual([[DRAFT_ID, "sized"]]);
  });

  it("stores an estimate under the floor too — a draft is sized once it has one", async () => {
    const { orchestrator, log } = build({
      engine: async () => Promise.resolve(estimate({ confidence: 10 })),
    });
    const { outcomes, listener } = recorder();

    orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, listener);
    await orchestrator.settled();

    expect(log.draftsPersisted).toHaveLength(1);
    expect(outcomes).toEqual([[DRAFT_ID, "sized"]]);
  });

  it("retries once, then stores nothing and reports the failure", async () => {
    const { orchestrator, requests, log } = build({
      engine: async () => Promise.reject(engineUnavailable()),
    });
    const { outcomes, listener } = recorder();

    orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, listener);
    await orchestrator.settled();

    expect(requests).toHaveLength(MAX_ENGINE_ATTEMPTS);
    expect(log.draftsPersisted).toEqual([]);
    expect(outcomes).toEqual([[DRAFT_ID, "failed"]]);
  });

  it("reports a failed write as failed", async () => {
    const { orchestrator } = build({ persistFails: true });
    const { outcomes, listener } = recorder();

    orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, listener);
    await orchestrator.settled();

    expect(outcomes).toEqual([[DRAFT_ID, "failed"]]);
  });

  it("skips a draft that is gone, and one whose workspace routes nothing", async () => {
    const gone = build({ draft: undefined });
    const unrouted = build({ context: undefined });
    const first = recorder();
    const second = recorder();

    gone.orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, first.listener);
    unrouted.orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, second.listener);
    await Promise.all([gone.orchestrator.settled(), unrouted.orchestrator.settled()]);

    expect(gone.requests).toEqual([]);
    expect(unrouted.requests).toEqual([]);
    expect(first.outcomes).toEqual([[DRAFT_ID, "skipped"]]);
    expect(second.outcomes).toEqual([[DRAFT_ID, "skipped"]]);
  });

  it("holds a draft once, apart from an issue with the same id", async () => {
    const gate = deferred<Estimate>();
    const { orchestrator } = build({ engine: async () => gate.promise, concurrency: 1 });

    expect(orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" })).toBe(true);
    expect(orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" })).toBe(false);
    // Both are uuids; the prefix is what keeps a draft from being mistaken for an issue.
    expect(orchestrator.estimating(DRAFT_ID)).toBe(false);

    gate.resolve(estimate());
    await orchestrator.settled();
  });

  it("survives a listener that throws", async () => {
    const { orchestrator, log } = build();

    orchestrator.enqueueDraft({ draftId: DRAFT_ID, repo: "a/b" }, async () =>
      Promise.reject(new Error("the batch is gone")),
    );
    await orchestrator.settled();

    expect(log.draftsPersisted).toHaveLength(1);
  });

  it.each([
    ["OTA-3", 3],
    ["OTA-12", 12],
    ["hand-seeded", 1],
    ["OTA-0", 1],
  ])("sizes %s as number %i", (localKey, number) => {
    expect(draftNumber(localKey)).toBe(number);
  });

  it("keys the queue with a draft: prefix", () => {
    expect(draftQueueKey(DRAFT_ID)).toBe(`draft:${DRAFT_ID}`);
  });
});

describe("sizing a canonical ticket (AL.5, #281 — one sizer, decision N9)", () => {
  it("claims, asks the same engine with the ticket as the contract's issue, and stores it under ticket_id", async () => {
    const { orchestrator, log, requests } = build();

    expect(orchestrator.enqueueTicket(TICKET_ID)).toBe(true);
    await orchestrator.settled();

    expect(log.ticketsClaimed).toEqual([TICKET_ID]);
    expect(requests).toEqual([
      {
        issue: {
          number: 588,
          title: "Compress telemetry frames with heatshrink",
          body: null,
          labels: ["telemetry", "enhancement"],
          repo: "acme-robotics/helios-telemetry",
        },
        context: { ...FIXTURE_CONTEXT, facts: [] },
      },
    ]);
    expect(log.ticketsPersisted).toHaveLength(1);
    expect(log.ticketsPersisted[0]?.status).toBe("sized");
    expect(log.ticketsPersisted[0]?.row).toMatchObject({
      github_issue_id: null,
      ticket_id: TICKET_ID,
      version: 1,
    });
    // Nothing went to the issue or draft paths.
    expect(log.claimed).toEqual([]);
    expect(log.persisted).toEqual([]);
    expect(log.draftsPersisted).toEqual([]);
  });

  it("hands a stored re-estimate to the re-size emitter (#461)", async () => {
    const resizes = { estimated: jest.fn().mockResolvedValue(undefined) };
    const { orchestrator } = build({
      ticketVersion: 2,
      resizes: resizes as unknown as ResizeReviewEmitter,
    });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(resizes.estimated).toHaveBeenCalledWith(TICKET_ID, 2);
  });

  it("applies the same confidence floor as an issue", async () => {
    const { orchestrator, log } = build({ confidenceFloor: 95 });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(log.ticketsPersisted[0]?.status).toBe("needs_human");
  });

  it("retries the engine once, then leaves the ticket to a person with no estimate", async () => {
    const { orchestrator, log, requests } = build({
      engine: async () => Promise.reject(engineUnavailable()),
    });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(requests).toHaveLength(MAX_ENGINE_ATTEMPTS);
    expect(log.ticketsPersisted).toEqual([]);
    expect(log.ticketsSettled).toEqual([{ ticketId: TICKET_ID, status: "needs_human" }]);
  });

  it("leaves a ticket whose write failed to a person rather than in `estimating`", async () => {
    const { orchestrator, log } = build({ persistFails: true });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(log.ticketsSettled).toEqual([{ ticketId: TICKET_ID, status: "needs_human" }]);
  });

  it("does not reject when even the terminal write fails — the sweep is the backstop", async () => {
    const { orchestrator, log } = build({ persistFails: true, settleFails: true });

    orchestrator.enqueueTicket(TICKET_ID);
    await expect(orchestrator.settled()).resolves.toBeUndefined();

    expect(log.ticketsSettled).toEqual([]);
  });

  it("touches nothing when the read fails before a claim — the next night asks again", async () => {
    const { orchestrator, log, requests } = build({ ticketReadFails: true });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(log.ticketsClaimed).toEqual([]);
    expect(log.ticketsSettled).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("skips a ticket that is gone, and one whose workspace routes nothing, without claiming it", async () => {
    for (const behaviour of [{ ticket: undefined }, { context: undefined }]) {
      const { orchestrator, log, requests } = build(behaviour);

      orchestrator.enqueueTicket(TICKET_ID);
      await orchestrator.settled();

      expect(log.ticketsClaimed).toEqual([]);
      expect(log.ticketsSettled).toEqual([]);
      expect(requests).toEqual([]);
    }
  });

  it("holds a ticket once, apart from an issue and a draft with the same id", async () => {
    let release: (value: Estimate) => void = () => undefined;
    const { orchestrator } = build({
      engine: async () =>
        new Promise<Estimate>((resolve) => {
          release = resolve;
        }),
    });

    expect(orchestrator.enqueueTicket(TICKET_ID)).toBe(true);
    expect(orchestrator.enqueueTicket(TICKET_ID)).toBe(false);
    expect(orchestrator.estimating(ticketQueueKey(TICKET_ID))).toBe(true);
    expect(orchestrator.estimating(TICKET_ID)).toBe(false);

    await drainMicrotasks();
    release(estimate());
    await orchestrator.settled();
  });

  it("keys the queue with a ticket: prefix", () => {
    expect(ticketQueueKey(TICKET_ID)).toBe(`ticket:${TICKET_ID}`);
  });
});

/**
 * An estimator manifest carrying these facts.
 *
 * @param facts - `[id, text]` pairs.
 * @returns The manifest, as `ContextAssemblyService.assemble` would answer.
 */
function estimatorManifest(facts: readonly (readonly [string, string])[]): ContextManifest {
  return {
    consumer: "estimator",
    scope: { repo: "acme-robotics/helios-firmware", workflow: null },
    budgetTokens: 8000,
    estTokens: facts.length * 10,
    skillVersions: [],
    facts: facts.map(([id, text]) => ({ id, text, repoRef: null, tier: "org", estTokens: 10 })),
    trimmed: [],
    excluded: [],
    refusedOverrides: [],
    manifestHash: "a".repeat(64),
  };
}

describe("the estimator as a context-assembly consumer (#414)", () => {
  const DRAFT = "d2800000-0000-0000-0000-0000000000d3";
  const WEST = "5eed0044-0000-4000-8000-000000000001";
  const TIMER = "5eed0044-0000-4000-8000-000000000005";
  const manifest = estimatorManifest([
    [WEST, "CI needs `west update` before first build of the day"],
    [TIMER, "Zephyr needs `CONFIG_LEGACY_TIMER`"],
  ]);

  it("assembles for the issue's repository and sends the manifest's confirmed facts", async () => {
    const { orchestrator, requests, log } = build({ manifest });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.assembled).toEqual([
      { organizationId: FIXTURE_WORKSPACE, repo: "acme-robotics/helios-firmware" },
    ]);
    expect(requests[0]?.context.facts).toEqual([
      { id: WEST, text: "CI needs `west update` before first build of the day" },
      { id: TIMER, text: "Zephyr needs `CONFIG_LEGACY_TIMER`" },
    ]);
  });

  it("records the injection against the estimate row it stored", async () => {
    const { orchestrator, log } = build({ manifest });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    const stored = log.persisted[0]?.row as { id?: string };
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.injected).toEqual([
      {
        organizationId: FIXTURE_WORKSPACE,
        injection: {
          consumer: "estimator",
          estimateId: stored.id,
          skillVersionIds: [],
          factIds: [WEST, TIMER],
          manifestHash: manifest.manifestHash,
        },
      },
    ]);
  });

  it("records nothing when the estimate could not be stored", async () => {
    const { orchestrator, log } = build({ manifest, persistFails: true });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.injected).toEqual([]);
    expect(log.settled).toEqual([{ issueId: FIXTURE_ISSUE_ID, status: "needs_human" }]);
  });

  it("records nothing when the manifest carried no facts — nothing was injected", async () => {
    const { orchestrator, log } = build();

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.persisted).toHaveLength(1);
    expect(log.injected).toEqual([]);
  });

  it("sizes without facts when assembly fails — knowledge never blocks an estimate", async () => {
    const { orchestrator, requests, log } = build({ assemblyFails: true });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(requests[0]?.context.facts).toEqual([]);
    expect(log.persisted[0]?.status).toBe("sized");
    expect(log.injected).toEqual([]);
  });

  it("keeps the estimate when the injection record is refused", async () => {
    const { orchestrator, log } = build({ manifest, recordFails: true });

    await orchestrator.accept([handoff()]);
    await orchestrator.settled();

    expect(log.persisted[0]?.status).toBe("sized");
    expect(log.settled).toEqual([]);
  });

  it("carries facts for a draft and records against the draft's estimate", async () => {
    const { orchestrator, requests, log } = build({ manifest });

    orchestrator.enqueueDraft({ draftId: DRAFT, repo: "acme-robotics/helios-firmware" });
    await orchestrator.settled();

    expect(requests[0]?.context.facts.map((fact) => fact.id)).toEqual([WEST, TIMER]);
    const stored = log.draftsPersisted[0]?.row as { id?: string };
    expect(log.injected[0]?.injection.estimateId).toBe(stored.id);
  });

  it("carries facts for a canonical ticket and records against the ticket's estimate", async () => {
    const { orchestrator, requests, log } = build({ manifest });

    orchestrator.enqueueTicket(TICKET_ID);
    await orchestrator.settled();

    expect(log.assembled[0]?.repo).toBe("acme-robotics/helios-telemetry");
    expect(requests[0]?.context.facts.map((fact) => fact.id)).toEqual([WEST, TIMER]);
    const stored = log.ticketsPersisted[0]?.row as { id?: string };
    expect(log.injected[0]?.injection.estimateId).toBe(stored.id);
  });
});
