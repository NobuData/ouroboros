import { Logger } from "@nestjs/common";

import type { AppConfigService } from "../config/config.service";
import type { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import type { NightlySlot } from "../scheduling/cadence";
import { ReestimationJob } from "./reestimation.job";
import type {
  ReestimationRepository,
  RunCounts,
  UnsizedTicketRow,
} from "./reestimation.repository";

/**
 * One night of re-estimation (AL.5, #281): it stands down when another replica has the night, it
 * dispatches no more than its batch, every ticket goes through the orchestrator, and the run's
 * record says what happened per workspace — or that it failed.
 */

const SLOT: NightlySlot = { night: "2026-09-17", at: new Date("2026-09-17T02:00:00.000Z") };
const RUN = "c2810000-0000-4000-8000-000000000001";

/** How the stand-ins behave. */
interface Behaviour {
  /** What the night claim answers. */
  runId?: string | undefined;
  /** The batch the read answers with — the repository is what bounds it. */
  tickets?: UnsizedTicketRow[];
  /** Ticket ids the orchestrator already holds. */
  inFlight?: string[];
  /** Make the batch read fail. */
  readFails?: boolean;
  /** Make every run record fail. */
  recordFails?: boolean;
  batch?: number;
}

/**
 * A job over stand-ins, and what they recorded.
 *
 * @param behaviour - What the stand-ins do.
 * @returns The job and its collaborators' mocks.
 */
function build(behaviour: Behaviour = {}) {
  const finished: { runId: string; status: string; counts: readonly RunCounts[] }[] = [];
  const runs = {
    startRun: jest.fn(async () => Promise.resolve("runId" in behaviour ? behaviour.runId : RUN)),
    unsizedTickets: jest.fn(async (limit: number) =>
      behaviour.readFails === true
        ? Promise.reject(new Error("the pool is exhausted"))
        : Promise.resolve((behaviour.tickets ?? []).slice(0, limit)),
    ),
    finishRun: jest.fn(async (runId: string, status: string, counts: readonly RunCounts[]) => {
      if (behaviour.recordFails === true) {
        return Promise.reject(new Error("the connection dropped"));
      }

      finished.push({ runId, status, counts });
      return Promise.resolve();
    }),
  };
  const orchestrator = {
    enqueueTicket: jest.fn((ticketId: string) => !(behaviour.inFlight ?? []).includes(ticketId)),
  };
  const config = { reestimationBatch: behaviour.batch ?? 100 } as unknown as AppConfigService;

  return {
    job: new ReestimationJob(
      runs as unknown as ReestimationRepository,
      orchestrator as unknown as EstimationOrchestrator,
      config,
    ),
    runs,
    orchestrator,
    finished,
  };
}

/**
 * A backlog of unsized tickets.
 *
 * @param count - How many.
 * @param organizationId - Whose.
 * @returns The rows.
 */
function backlog(count: number, organizationId = "org-acme"): UnsizedTicketRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ticketId: `${organizationId}-t${String(index)}`,
    organizationId,
  }));
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("a night of re-estimation", () => {
  it("claims the night under the configured batch bound", async () => {
    const { job, runs } = build({ batch: 25 });

    await job.run(SLOT);

    expect(runs.startRun).toHaveBeenCalledWith("2026-09-17", 25);
    expect(runs.unsizedTickets).toHaveBeenCalledWith(25);
  });

  it("stands down, selecting and queuing nothing, when another replica has the night", async () => {
    const { job, runs, orchestrator } = build({ runId: undefined, tickets: backlog(4) });

    await expect(job.run(SLOT)).resolves.toEqual({ kind: "skipped", night: "2026-09-17" });

    expect(runs.unsizedTickets).not.toHaveBeenCalled();
    expect(orchestrator.enqueueTicket).not.toHaveBeenCalled();
    expect(runs.finishRun).not.toHaveBeenCalled();
  });

  it("hands every selected ticket to the orchestrator and records per-workspace counts", async () => {
    const tickets = [...backlog(3, "org-acme"), ...backlog(2, "org-globex")];
    const { job, orchestrator, finished } = build({
      tickets,
      inFlight: ["org-acme-t1"],
    });

    const outcome = await job.run(SLOT);

    expect(orchestrator.enqueueTicket.mock.calls.map(([id]) => id)).toEqual(
      tickets.map((ticket) => ticket.ticketId),
    );
    const counts = [
      { organizationId: "org-acme", found: 3, queued: 2, inFlight: 1 },
      { organizationId: "org-globex", found: 2, queued: 2, inFlight: 0 },
    ];
    expect(finished).toEqual([{ runId: RUN, status: "succeeded", counts }]);
    expect(outcome).toEqual({ kind: "succeeded", night: "2026-09-17", runId: RUN, counts });
  });

  it("never dispatches more than its bound, however large the unsized backlog", async () => {
    const { job, orchestrator, finished } = build({ tickets: backlog(5000), batch: 100 });

    await job.run(SLOT);

    expect(orchestrator.enqueueTicket).toHaveBeenCalledTimes(100);
    expect(finished[0]?.counts).toEqual([
      { organizationId: "org-acme", found: 100, queued: 100, inFlight: 0 },
    ]);
  });

  it("records a quiet night as succeeded, with no counts", async () => {
    const { job, finished } = build({ tickets: [] });

    await job.run(SLOT);

    expect(finished).toEqual([{ runId: RUN, status: "succeeded", counts: [] }]);
  });

  it("records a run that could not read its batch as failed, and does not reject", async () => {
    const { job, orchestrator, finished } = build({ readFails: true });

    await expect(job.run(SLOT)).resolves.toEqual({
      kind: "failed",
      night: "2026-09-17",
      runId: RUN,
    });

    expect(orchestrator.enqueueTicket).not.toHaveBeenCalled();
    expect(finished).toEqual([{ runId: RUN, status: "failed", counts: [] }]);
  });

  it("does not reject when even the failure cannot be recorded", async () => {
    const { job } = build({ readFails: true, recordFails: true });

    await expect(job.run(SLOT)).resolves.toMatchObject({ kind: "failed" });
  });

  it("rejects only when the night itself cannot be claimed", async () => {
    const { job, runs } = build();
    runs.startRun.mockRejectedValueOnce(new Error("the database is unreachable"));

    await expect(job.run(SLOT)).rejects.toThrow("unreachable");
  });

  it("says what it did when it queued anything, and names a reached bound", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const { job } = build({ tickets: backlog(10), batch: 10 });

    await job.run(SLOT);

    expect(log).toHaveBeenCalledWith(
      "Nightly re-estimation for 2026-09-17: queued 10 of 10 unsized ticket(s) across 1 " +
        "workspace(s) — the batch bound was reached.",
    );
  });

  it("stays silent on a quiet night", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const { job } = build({ tickets: [] });

    await job.run(SLOT);

    expect(log).not.toHaveBeenCalled();
  });
});
