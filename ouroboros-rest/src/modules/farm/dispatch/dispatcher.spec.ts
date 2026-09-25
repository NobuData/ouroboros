import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { OfferUploads } from "../artifacts/upload.service";
import { AgentSessions, type FrameContext } from "../gateway/agent.sessions";
import { FakeSocket, drain, fixtureFrame } from "../gateway/gateway.fixture";
import { GatewayMetrics } from "../gateway/gateway.metrics";
import { OFFER_ACK_MS } from "../gateway/gateway.policy";
import { decode, type Envelope, type MessageType } from "../protocol/protocol";
import type { JobUpload } from "../protocol/protocol.messages";
import { uuidOf, wireId } from "../protocol/ulid";
import { JOB, ORG, OTHER_RUNNER, RUNNER, buildJob } from "./dispatch.fixture";
import type { DispatchGate } from "./dispatch.gate";
import {
  DECLINE_COOLDOWN_MS,
  JOB_TIMEOUT_S,
  LOST_RUNNER_AFTER_MS,
  OFFER_RECLAIM_MS,
} from "./dispatch.policy";
import type { Candidate, DispatchRepository, Placement, WaitingJob } from "./dispatch.repository";
import { DeclineMemory, DispatchService } from "./dispatcher";
import { JobCompletions, type JobCompleted } from "./job.completions";

/**
 * The dispatcher (#252), against a scripted repository and the real session registry — so what
 * reaches an agent is judged by the protocol codec, as the agent would judge it.
 */

/** The waiting job the queue holds. */
const WAITING: WaitingJob = {
  id: JOB,
  organization_id: ORG,
  pool_id: "7f000001-0000-4000-8000-000000000001",
  executor: "container",
  command: "west build -b helios_mainboard app",
  commit_sha: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
};

/** The job's wire id. */
const WIRE = wireId("job", JOB);

/** An upload a run-attributed job's offer carries (#330). */
const UPLOAD: JobUpload = {
  path: `/api/v1/farm/jobs/${JOB}/artifacts`,
  token: "ouro_upl_Yk3vQm9ZtR2wXa7LpN4sD8fH1jC6bE0uGiKoMq5TyVw",
  expires_at: "2026-09-19T14:00:15.000Z",
  globs: ["**/junit*.xml"],
  max_file_bytes: 67108864,
  max_job_bytes: 268435456,
  max_files: 256,
};

/**
 * A candidate runner.
 *
 * @param id - Its id.
 * @param held - How many jobs it holds.
 * @returns The candidate.
 */
function candidate(id: string, held = 0): Candidate {
  return { id, name: id === RUNNER ? "forge-01" : "forge-02", held, max_concurrency: 2 };
}

/**
 * A placement onto a runner.
 *
 * @param runnerId - The runner.
 * @param attempt - Which attempt.
 * @returns The placement.
 */
function placed(runnerId: string, attempt = 1): Placement {
  return {
    kind: "placed",
    placed: {
      job: buildJob({ status: "offered", runner_id: runnerId, offered_at: new Date() }),
      poolName: "pool-a",
      repoOwner: "acme-robotics",
      repoName: "helios-firmware",
      attempt,
    },
  };
}

/**
 * An agent frame, decoded as the gateway would hand it to a listener.
 *
 * @param fixture - The golden file.
 * @param payload - Fields to change.
 * @returns The envelope.
 */
function agentFrame<T extends MessageType>(
  fixture: string,
  payload: Record<string, unknown>,
): Envelope<T> {
  const value = fixtureFrame(fixture);
  Object.assign(value.payload, payload);
  const decoded = decode(JSON.stringify(value));
  if (!decoded.envelope) throw new Error(JSON.stringify(decoded.diagnostics));

  return decoded.envelope as Envelope<T>;
}

describe("the dispatcher", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let now: Date;
  let repository: jest.Mocked<
    Pick<
      DispatchRepository,
      | "waiting"
      | "candidates"
      | "place"
      | "release"
      | "accept"
      | "reclaimOffers"
      | "lostJobs"
      | "requeueLost"
      | "liveness"
    >
  >;
  let sessions: AgentSessions;
  let completions: JobCompletions;
  let completed: JobCompleted[];
  let gate: jest.Mocked<DispatchGate>;
  let uploads: jest.Mocked<OfferUploads>;
  let dispatcher: DispatchService;

  beforeEach(() => {
    now = new Date("2026-09-19T12:00:00.000Z");
    repository = {
      waiting: jest.fn().mockResolvedValue([WAITING]),
      candidates: jest.fn().mockResolvedValue([candidate(RUNNER)]),
      place: jest
        .fn()
        .mockImplementation((_job, runnerId: string) => Promise.resolve(placed(runnerId))),
      release: jest.fn().mockResolvedValue(true),
      accept: jest.fn().mockResolvedValue(true),
      reclaimOffers: jest.fn().mockResolvedValue([]),
      lostJobs: jest.fn().mockResolvedValue([]),
      requeueLost: jest.fn().mockResolvedValue(undefined),
      liveness: jest.fn().mockResolvedValue("live"),
    };
    sessions = new AgentSessions(() => now, new GatewayMetrics());
    completions = new JobCompletions();
    completed = [];
    completions.subscribe((event) => {
      completed.push(event);
    });
    gate = { admits: jest.fn().mockResolvedValue(true) };
    // A job attributed to no run has nowhere to upload to — the fixture's default.
    uploads = { forOffer: jest.fn().mockResolvedValue(undefined) };
    dispatcher = new DispatchService(
      repository as unknown as DispatchRepository,
      sessions,
      completions,
      gate,
      new SchedulerRegistry(),
      () => now,
      uploads,
    );
    dispatcher.onApplicationBootstrap();
  });

  afterEach(() => dispatcher.onApplicationShutdown());

  /** Connect a runner's agent to this process. */
  function connect(runnerId = RUNNER, org = ORG) {
    const socket = new FakeSocket();
    const { session } = sessions.open(org, runnerId, undefined);
    sessions.attach(session, socket);

    return { session, socket };
  }

  /** Where a frame from a runner comes from. */
  function from(runnerId = RUNNER, extra: Partial<FrameContext> = {}): FrameContext {
    const session = sessions.find(ORG, runnerId);
    return { organizationId: ORG, runnerId, sessionId: session?.id ?? "", ...extra };
  }

  describe("placing the queue", () => {
    it("offers the oldest waiting job to a connected runner that can take it", async () => {
      const { session, socket } = connect();

      await dispatcher.kick();
      await session.flushed();

      expect(repository.place).toHaveBeenCalledWith(WAITING, RUNNER, now);
      const offer = socket.last("job.offer");
      expect(offer.payload).toMatchObject({
        job: WIRE,
        pool: "pool-a",
        executor: "container",
        command: ["west", "build", "-b", "helios_mainboard", "app"],
        expires_at: new Date(now.getTime() + OFFER_ACK_MS).toISOString(),
      });
      expect(offer.payload).not.toHaveProperty("attempt");
    });

    it("carries no upload for a job with nowhere to upload to", async () => {
      const { session, socket } = connect();

      await dispatcher.kick();
      await session.flushed();

      expect(socket.last("job.offer").payload).not.toHaveProperty("upload");
    });

    it("mints the job's upload token with the offer, valid for the answer window and the run (#330)", async () => {
      const { session, socket } = connect();
      uploads.forOffer.mockResolvedValue(UPLOAD);

      await dispatcher.kick();
      await session.flushed();

      expect(uploads.forOffer).toHaveBeenCalledWith(
        expect.objectContaining({ id: JOB, runner_id: RUNNER }),
        now,
        OFFER_ACK_MS + JOB_TIMEOUT_S * 1000,
      );
      expect(socket.last("job.offer").payload.upload).toEqual(UPLOAD);
    });

    it("mints a fresh token for each offer of a job, so the runner that did not take it holds a dead one", async () => {
      repository.candidates.mockResolvedValue([candidate(RUNNER), candidate(OTHER_RUNNER)]);
      jest.spyOn(sessions, "offer").mockImplementationOnce(() => undefined);
      uploads.forOffer.mockResolvedValue(UPLOAD);
      connect(RUNNER);
      const other = connect(OTHER_RUNNER);

      await dispatcher.kick();
      await other.session.flushed();

      expect(uploads.forOffer).toHaveBeenCalledTimes(2);
    });

    it("puts the job back rather than offer it without somewhere for its results to go", async () => {
      const { socket } = connect();
      uploads.forOffer.mockRejectedValue(new Error("the database went away"));

      await dispatcher.kick();

      expect(repository.release).toHaveBeenCalledWith(ORG, RUNNER, JOB);
      expect(socket.sent).toHaveLength(0);
    });

    it("offers a retry with the attempt it is", async () => {
      const { session, socket } = connect();
      repository.place.mockResolvedValue(placed(RUNNER, 2));

      await dispatcher.kick();
      await session.flushed();

      expect(socket.last("job.offer").payload.attempt).toBe(2);
    });

    it("never offers to a runner with no socket here — disconnected, or on another replica", async () => {
      repository.candidates.mockResolvedValue([candidate(OTHER_RUNNER), candidate(RUNNER)]);
      const detached = connect(OTHER_RUNNER);
      sessions.detach(detached.session, detached.socket);
      const { session, socket } = connect(RUNNER);

      await dispatcher.kick();
      await session.flushed();

      expect(repository.place).toHaveBeenCalledTimes(1);
      expect(repository.place).toHaveBeenCalledWith(WAITING, RUNNER, now);
      expect(socket.types()).toEqual(["job.offer"]);
      expect(detached.socket.sent).toHaveLength(0);
    });

    it("tries the next runner when one fills up between the read and the lock", async () => {
      repository.candidates.mockResolvedValue([candidate(RUNNER), candidate(OTHER_RUNNER)]);
      repository.place.mockImplementation((_job, runnerId: string) =>
        Promise.resolve(runnerId === RUNNER ? { kind: "runner_unavailable" } : placed(runnerId)),
      );
      connect(RUNNER);
      const other = connect(OTHER_RUNNER);

      await dispatcher.kick();
      await other.session.flushed();

      expect(other.socket.types()).toEqual(["job.offer"]);
    });

    it("stops at once when another dispatcher took the job", async () => {
      repository.candidates.mockResolvedValue([candidate(RUNNER), candidate(OTHER_RUNNER)]);
      repository.place.mockResolvedValue({ kind: "job_unavailable" });
      connect(RUNNER);
      connect(OTHER_RUNNER);

      await dispatcher.kick();

      expect(repository.place).toHaveBeenCalledTimes(1);
    });

    it("puts the job back and tries the next runner when its offer cannot be sent", async () => {
      repository.candidates.mockResolvedValue([candidate(RUNNER), candidate(OTHER_RUNNER)]);
      const full = connect(RUNNER);
      const other = connect(OTHER_RUNNER);
      // A session that already owes its ceiling takes no more offers.
      jest.spyOn(sessions, "offer").mockImplementationOnce(() => undefined);

      await dispatcher.kick();
      await other.session.flushed();

      expect(repository.release).toHaveBeenCalledWith(ORG, RUNNER, JOB);
      expect(full.socket.sent).toHaveLength(0);
      expect(other.socket.types()).toEqual(["job.offer"]);
    });

    it("leaves a record it cannot offer queued, and says so once", async () => {
      repository.waiting.mockResolvedValue([{ ...WAITING, commit_sha: null }]);
      const error = jest.spyOn(Logger.prototype, "error");
      connect();

      await dispatcher.kick();
      await dispatcher.kick();

      expect(repository.candidates).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("asks the dispatch gate once per workspace per pass, and offers nothing it refuses (#489)", async () => {
      repository.waiting.mockResolvedValue([WAITING, { ...WAITING, id: "second" }]);
      gate.admits.mockResolvedValue(false);
      const { socket } = connect();

      await dispatcher.kick();

      expect(gate.admits).toHaveBeenCalledTimes(1);
      expect(gate.admits).toHaveBeenCalledWith(ORG);
      expect(repository.candidates).not.toHaveBeenCalled();
      expect(socket.sent).toHaveLength(0);
    });

    it("coalesces kicks that arrive during a drain into one more pass, not one per kick", async () => {
      let release: () => void = () => undefined;
      repository.waiting.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => {
              resolve([]);
            };
          }),
      );
      repository.waiting.mockResolvedValue([]);

      const first = dispatcher.kick();
      void dispatcher.kick();
      void dispatcher.kick();
      release();
      await first;

      expect(repository.waiting).toHaveBeenCalledTimes(2);
    });

    it("survives a failed pass — the next kick retries", async () => {
      repository.waiting.mockRejectedValueOnce(new Error("the database went away"));

      await expect(dispatcher.kick()).resolves.toBeUndefined();
      await dispatcher.kick();

      expect(repository.waiting).toHaveBeenCalledTimes(2);
    });
  });

  describe("the agents' answers", () => {
    it("records an accept, and says nothing more", async () => {
      const { session, socket } = connect();

      await sessions.notify(from(), agentFrame("valid/job-accept.json", { job: WIRE }));
      await session.flushed();

      expect(repository.accept).toHaveBeenCalledWith(ORG, RUNNER, JOB);
      expect(socket.sent).toHaveLength(0);
    });

    it("tells an agent that accepted a job gone elsewhere to stop it — once per session", async () => {
      repository.accept.mockResolvedValue(false);
      repository.liveness.mockResolvedValue("elsewhere");
      const { session, socket } = connect();

      await sessions.notify(from(), agentFrame("valid/job-accept.json", { job: WIRE }));
      await sessions.notify(from(), agentFrame("valid/job-accept.json", { job: WIRE }));
      await session.flushed();

      expect(socket.types()).toEqual(["job.cancel"]);
      expect(socket.last("job.cancel").payload).toMatchObject({ job: WIRE, reason: "reassigned" });
    });

    it("tells a new session again — its agent may be a new process that never heard", async () => {
      repository.liveness.mockResolvedValue("elsewhere");
      const first = connect();
      await sessions.notify(from(), agentFrame("valid/job-start.json", { job: WIRE }));
      await first.session.flushed();

      const second = connect();
      await sessions.notify(from(), agentFrame("valid/job-start.json", { job: WIRE }));
      await second.session.flushed();

      expect(second.socket.types()).toEqual(["job.cancel"]);
    });

    it("says nothing about a job this workspace does not know, or one it still counts as live", async () => {
      const { session, socket } = connect();

      for (const liveness of ["unknown", "live", "finished_here"] as const) {
        repository.liveness.mockResolvedValue(liveness);
        await sessions.notify(from(), agentFrame("valid/job-start.json", { job: WIRE }));
      }
      await session.flushed();

      expect(socket.sent).toHaveLength(0);
    });

    it("returns a declined job to the queue and passes the decliner over for it", async () => {
      repository.candidates.mockResolvedValue([candidate(RUNNER), candidate(OTHER_RUNNER)]);
      repository.place.mockResolvedValue({ kind: "job_unavailable" });
      connect(RUNNER);
      connect(OTHER_RUNNER);

      await sessions.notify(from(), agentFrame("valid/job-decline.json", { job: WIRE }));
      await dispatcher.kick();

      expect(repository.release).toHaveBeenCalledWith(ORG, RUNNER, JOB);
      expect(repository.place).toHaveBeenLastCalledWith(WAITING, OTHER_RUNNER, now);
      expect(repository.place).not.toHaveBeenCalledWith(WAITING, RUNNER, expect.anything());
    });

    it("forgets nothing about a decline that moved nothing", async () => {
      repository.release.mockResolvedValue(false);
      connect();

      await sessions.notify(from(), agentFrame("valid/job-decline.json", { job: WIRE }));
      await dispatcher.kick();

      expect(repository.place).toHaveBeenCalledWith(WAITING, RUNNER, now);
    });

    it("announces a finish that applied as a completion, and not a re-send", async () => {
      await sessions.notify(
        from(RUNNER, {
          terminal: {
            duplicate: false,
            applied: true,
            jobId: JOB,
            status: "retried",
            retryId: "r",
          },
        }),
        agentFrame("valid/job-finish.json", { job: WIRE }),
      );
      await sessions.notify(
        from(RUNNER, { terminal: { duplicate: true, applied: false } }),
        agentFrame("valid/job-finish.json", { job: WIRE }),
      );
      await drain();

      expect(completed).toEqual([{ organizationId: ORG, jobId: JOB, status: "retried" }]);
    });

    it("tells an agent whose heartbeat names a cancelled job to stop it", async () => {
      repository.liveness.mockResolvedValue("canceled");
      const { session, socket } = connect();

      await sessions.notify(
        from(),
        agentFrame("valid/heartbeat-busy.json", { job: { id: WIRE, phase: "run", pct: 40 } }),
      );
      await session.flushed();

      expect(socket.last("job.cancel").payload.reason).toBe("operator");
    });

    it("asks nothing of a heartbeat that runs no job", async () => {
      connect();

      await sessions.notify(from(), agentFrame("valid/heartbeat.json", {}));

      expect(repository.liveness).not.toHaveBeenCalled();
    });
  });

  describe("the tick", () => {
    it("takes back unanswered offers, and withdraws them from their sessions", async () => {
      const { session } = connect();
      await dispatcher.kick();
      await session.flushed();
      expect(session.outbox).toHaveLength(1);
      repository.reclaimOffers.mockResolvedValue([
        { id: JOB, organization_id: ORG, runner_id: RUNNER },
      ]);
      repository.waiting.mockResolvedValue([]);

      const report = await dispatcher.tick();

      expect(repository.reclaimOffers).toHaveBeenCalledWith(
        new Date(now.getTime() - OFFER_RECLAIM_MS),
      );
      expect(report.reclaimed).toBe(1);
      expect(session.outbox).toHaveLength(0);
    });

    it("takes back a lost runner's jobs, announcing the ones that ended", async () => {
      repository.lostJobs.mockResolvedValue([
        { id: "a", organization_id: ORG },
        { id: "b", organization_id: ORG },
        { id: "c", organization_id: ORG },
      ]);
      repository.requeueLost
        .mockResolvedValueOnce({
          organizationId: ORG,
          jobId: "a",
          runnerId: RUNNER,
          from: "running",
          to: "retried",
          retryId: "a2",
        })
        .mockResolvedValueOnce({
          organizationId: ORG,
          jobId: "b",
          runnerId: RUNNER,
          from: "accepted",
          to: "waiting",
        })
        .mockResolvedValueOnce(undefined);

      const report = await dispatcher.tick();
      await drain();

      const cutoff = new Date(now.getTime() - LOST_RUNNER_AFTER_MS);
      expect(repository.lostJobs).toHaveBeenCalledWith(cutoff, expect.any(Number));
      expect(repository.requeueLost).toHaveBeenCalledWith(ORG, "a", cutoff, now);
      expect(report.requeued).toBe(2);
      expect(completed).toEqual([{ organizationId: ORG, jobId: "a", status: "retried" }]);
    });
  });

  describe("propagating a cancellation", () => {
    it("withdraws the job's offer and tells its runner to stop — and only once", async () => {
      const { session, socket } = connect();
      await dispatcher.kick();
      await session.flushed();

      dispatcher.propagateCancel(ORG, RUNNER, JOB);
      repository.liveness.mockResolvedValue("canceled");
      await sessions.notify(from(), agentFrame("valid/job-start.json", { job: WIRE }));
      await session.flushed();

      expect(session.outbox).toHaveLength(0);
      expect(socket.types()).toEqual(["job.offer", "job.cancel"]);
      expect(socket.last("job.cancel").payload).toMatchObject({ job: WIRE, reason: "operator" });
      expect(uuidOf("job", socket.last("job.cancel").payload.job)).toBe(JOB);
    });
  });

  it("stops listening when the application shuts down", async () => {
    dispatcher.onApplicationShutdown();

    await sessions.notify(from(), agentFrame("valid/job-accept.json", { job: WIRE }));

    expect(repository.accept).not.toHaveBeenCalled();
  });
});

describe("the decline memory", () => {
  it("passes a decliner over for its cooldown, and only for that job", () => {
    const memory = new DeclineMemory();
    memory.note(JOB, RUNNER, 1_000);

    expect(memory.cooling(JOB, RUNNER, 1_000 + DECLINE_COOLDOWN_MS - 1)).toBe(true);
    expect(memory.cooling(JOB, RUNNER, 1_000 + DECLINE_COOLDOWN_MS)).toBe(false);
    expect(memory.cooling(JOB, OTHER_RUNNER, 1_000)).toBe(false);
    expect(memory.cooling("another-job", RUNNER, 1_000)).toBe(false);
  });

  it("forgets cooldowns that have ended", () => {
    const memory = new DeclineMemory(10);
    memory.note(JOB, RUNNER, 0);
    memory.note(JOB, OTHER_RUNNER, 100);

    memory.prune(50);

    expect(memory.cooling(JOB, OTHER_RUNNER, 50)).toBe(true);
    memory.prune(1_000);
    expect(memory.cooling(JOB, OTHER_RUNNER, 50)).toBe(false);
  });
});
