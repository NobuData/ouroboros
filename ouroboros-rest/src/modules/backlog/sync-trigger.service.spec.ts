import { HttpStatus, Logger } from "@nestjs/common";

import type { BacklogSyncScheduler } from "../backlog-sync/backlog-sync.scheduler";
import type { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import type { SyncCycleReport } from "../backlog-sync/sync.report";
import type { DomainError } from "../errors/error.envelope";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "./debounce";
import { BACKLOG_SYNC_ERRORS } from "./sync.errors";
import type { SyncStatusResource } from "./sync.resources";
import type { SyncStatusService } from "./sync-status.service";
import { SyncTriggerService } from "./sync-trigger.service";

/**
 * The manual re-sync, and the two guards the ticket asks to see verified:
 *
 * > *Debounce verified: concurrent trigger → 409; rapid repeat within the minimum interval →
 * > 409 with a retry hint.*
 *
 * Both are asserted as **answers** rather than as internal calls, because that is what a
 * client sees: the status, the code, and — where it is knowable — the number of seconds that
 * makes the refusal actionable.
 *
 * The third criterion, *the trigger runs a sync cycle*, is asserted here as the cycle being
 * driven and in `backlog-sync.scheduler.spec.ts` as the cycle actually running; its
 * *`syncedAt` advances afterwards* half is `backlog.integration-spec.ts`', which has a
 * database for the column to move in.
 */

const ORG = "acme-robotics-id";

/** The clock every case below runs at. */
const NOW = new Date("2026-09-10T14:10:00.000Z");

/** What the status service is stubbed to answer. */
const STATUS: SyncStatusResource = {
  syncedAt: "2026-09-10T14:07:20.000Z",
  state: "ok",
  pause: null,
  message: null,
  retryAfterSeconds: null,
  // The snapshot is taken before the cycle starts, so the service is what turns this on.
  running: false,
  repositories: [],
};

/**
 * A completed cycle that began this long before {@link NOW}.
 *
 * @param secondsAgo - How long ago it started.
 * @returns The report.
 */
function cycleStarted(secondsAgo: number): SyncCycleReport {
  return {
    startedAt: new Date(NOW.getTime() - secondsAgo * 1000),
    organizations: [],
    pending: false,
  };
}

/** What each collaborator is asked, per test. */
interface Stubs {
  scheduler: { running: jest.Mock; runNow: jest.Mock };
  sync: { lastCycle: jest.Mock };
  status: { status: jest.Mock };
}

/**
 * A trigger over stand-ins — a loop with nothing running and no cycle behind it.
 *
 * @param overrides - What this case is about.
 * @returns The service and its stubs.
 */
function build(overrides: { running?: boolean; started?: boolean; last?: SyncCycleReport } = {}): {
  service: SyncTriggerService;
  stubs: Stubs;
} {
  const stubs: Stubs = {
    scheduler: {
      running: jest.fn().mockReturnValue(overrides.running ?? false),
      runNow: jest
        .fn()
        .mockReturnValue((overrides.started ?? true) ? Promise.resolve() : undefined),
    },
    sync: { lastCycle: jest.fn().mockReturnValue(overrides.last) },
    status: { status: jest.fn().mockResolvedValue(STATUS) },
  };

  return {
    service: new SyncTriggerService(
      stubs.scheduler as unknown as BacklogSyncScheduler,
      stubs.sync as unknown as BacklogSyncService,
      stubs.status as unknown as SyncStatusService,
    ),
    stubs,
  };
}

/**
 * The envelope a refused trigger threw.
 *
 * @param call - The call that should have been refused.
 * @returns Its status and envelope.
 * @throws {Error} When the call was not refused at all, which is the failure worth naming.
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

  throw new Error("the trigger was accepted, and this case is about it being refused");
}

describe("triggering a sync", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  it("drives one cycle and answers with the status at that moment", async () => {
    const { service, stubs } = build();

    const answer = await service.trigger(ORG, NOW);

    expect(stubs.scheduler.runNow).toHaveBeenCalledTimes(1);
    expect(stubs.status.status).toHaveBeenCalledWith(ORG, NOW);
    expect(answer).toEqual({ ...STATUS, running: true });
  });

  it("answers before the cycle has finished", async () => {
    // The `202`: a poll of a large backlog is several seconds of somebody else's network, and
    // a request that waited for it would turn a click into a timeout.
    let settled = false;
    const { service, stubs } = build();
    stubs.scheduler.runNow.mockReturnValue(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve();
        }, 50);
      }),
    );

    await service.trigger(ORG, NOW);

    expect(settled).toBe(false);
  });

  it("records the trigger, naming the workspace and nobody", async () => {
    const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const { service } = build();

    await service.trigger(ORG, NOW);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining(ORG));
  });

  it("goes ahead when this process has completed no cycle at all", async () => {
    // A fresh deployment has nothing to be too soon after; refusing the first trigger would
    // be a guard with no state behind it.
    const { service, stubs } = build({ last: undefined });

    await service.trigger(ORG, NOW);

    expect(stubs.scheduler.runNow).toHaveBeenCalled();
  });

  it("goes ahead once the minimum interval has passed", async () => {
    const { service, stubs } = build({ last: cycleStarted(MINIMUM_SYNC_INTERVAL_SECONDS) });

    await service.trigger(ORG, NOW);

    expect(stubs.scheduler.runNow).toHaveBeenCalled();
  });
});

describe("refusing a trigger", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  it("answers 409 while a cycle is running, and starts nothing", async () => {
    const { service, stubs } = build({ running: true });

    const refused = await refusal(service.trigger(ORG, NOW));

    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.code).toBe(BACKLOG_SYNC_ERRORS.running);
    expect(stubs.scheduler.runNow).not.toHaveBeenCalled();
  });

  it("carries no retry hint for a running cycle, rather than inventing one", async () => {
    // How long a cycle takes depends on how many repositories are enabled and how quickly
    // GitHub answers. A made-up countdown would be rendered as if it meant something; what a
    // client should watch instead is `running` on the status endpoint.
    const refused = await refusal(build({ running: true }).service.trigger(ORG, NOW));

    expect(refused.details).toEqual({});
  });

  it("answers 409 with a retry hint for a repeat inside the minimum interval", async () => {
    const { service, stubs } = build({ last: cycleStarted(8) });

    const refused = await refusal(service.trigger(ORG, NOW));

    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.code).toBe(BACKLOG_SYNC_ERRORS.tooSoon);
    expect(refused.details).toEqual({ retryAfterSeconds: MINIMUM_SYNC_INTERVAL_SECONDS - 8 });
    expect(stubs.scheduler.runNow).not.toHaveBeenCalled();
  });

  it("prefers `running` to `too soon` when both are true", async () => {
    // A cycle that started five seconds ago is both. "It is happening now" is the more useful
    // of the two things to be told, and it is the one a client can watch end.
    const { service } = build({ running: true, last: cycleStarted(5) });

    expect((await refusal(service.trigger(ORG, NOW))).code).toBe(BACKLOG_SYNC_ERRORS.running);
  });

  it("answers 409 when it loses the start to a request in the same tick", async () => {
    // The check and the start are one synchronous step in the scheduler, so this is the
    // answer for a trigger that asked at the same moment as another: `runNow()` says it
    // started nothing, and that is taken as the refusal rather than re-read from a flag.
    const { service, stubs } = build({ started: false });

    const refused = await refusal(service.trigger(ORG, NOW));

    expect(refused.code).toBe(BACKLOG_SYNC_ERRORS.running);
    expect(stubs.scheduler.runNow).toHaveBeenCalledTimes(1);
  });

  it("reads the status before starting the cycle, so the answer is a snapshot not a race", async () => {
    // Reading afterwards would mean a fast cycle could stamp `synced_at` between the two, and
    // the `202` would carry freshness the caller had not been told to wait for.
    const order: string[] = [];
    const { service, stubs } = build();
    stubs.status.status.mockImplementation(() => {
      order.push("status");

      return Promise.resolve(STATUS);
    });
    stubs.scheduler.runNow.mockImplementation(() => {
      order.push("cycle");

      return Promise.resolve();
    });

    await service.trigger(ORG, NOW);

    expect(order).toEqual(["status", "cycle"]);
  });

  it("refuses a second trigger fired at the same instant as an accepted one", async () => {
    // The criterion's *concurrent trigger → 409*, driven rather than described: one
    // scheduler, two callers, and only one of them starts a cycle.
    let running = false;
    const { service, stubs } = build();
    stubs.scheduler.running.mockImplementation(() => running);
    stubs.scheduler.runNow.mockImplementation(() => {
      if (running) {
        return undefined;
      }

      running = true;

      return Promise.resolve();
    });

    const [first, second] = await Promise.allSettled([
      service.trigger(ORG, NOW),
      service.trigger(ORG, NOW),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    // **Both** asked to start, because the status read sits between the first guard and the
    // start and gives the other request a turn — and exactly one was allowed to. That is why
    // `runNow()`'s answer is the authority rather than a second reading of `running()`.
    expect(stubs.scheduler.runNow).toHaveBeenCalledTimes(2);
    expect(
      second.status === "rejected" ? (second.reason as DomainError).envelope().code : undefined,
    ).toBe(BACKLOG_SYNC_ERRORS.running);
  });
});
