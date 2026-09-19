import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AgentSessions, type FrameContext } from "../gateway/agent.sessions";
import { fixtureFrame } from "../gateway/gateway.fixture";
import { GatewayMetrics } from "../gateway/gateway.metrics";
import { decode, type Envelope, type MessageType } from "../protocol/protocol";
import { wireId } from "../protocol/ulid";
import { LOG_GAP_WAIT_MS, LOG_IDLE_FORGET_MS, LOG_RETENTION_DAYS } from "./log.policy";
import { LogIngest } from "./log.ingest";
import type { ChunkWrite, FinishedLog, LogRepository, Stored, WritableJob } from "./log.repository";
import { RateGuard } from "./rate.guard";

/**
 * Log ingest (#253), against the real session registry and a repository that records what it was
 * asked to write — so the order chunks reach storage, and what each carries, is what is asserted.
 */

const ORG = "org-farm";
const RUNNER = "7f000002-0000-4000-8000-000000000001";
const OTHER_RUNNER = "7f000002-0000-4000-8000-000000000002";
const JOB = "5eed0028-0000-4000-8000-000000000479";
const WIRE = wireId("job", JOB);

/** A repository that remembers every write, and whose job belongs to {@link RUNNER}. */
class RecordingRepository {
  readonly stored: ChunkWrite[] = [];
  readonly finished: FinishedLog[] = [];
  readonly agentDrops: number[] = [];
  next = 0;
  outcome: Stored = "stored";
  fail = false;
  /** Whether the job is still offered, accepted or running. */
  open = true;
  lookups = 0;

  writableJob(
    organizationId: string,
    runnerId: string,
    jobId: string,
  ): Promise<WritableJob | undefined> {
    this.lookups += 1;
    return Promise.resolve(
      this.open && organizationId === ORG && runnerId === RUNNER && jobId === JOB
        ? { id: JOB, organization_id: ORG }
        : undefined,
    );
  }

  nextSeq(): Promise<number> {
    return Promise.resolve(this.next);
  }

  store(_job: WritableJob, write: ChunkWrite): Promise<Stored> {
    if (this.fail) return Promise.reject(new Error("the database went away"));
    this.stored.push(write);
    return Promise.resolve(this.outcome);
  }

  countAgentDrops(_job: WritableJob, dropped: number): Promise<void> {
    this.agentDrops.push(dropped);
    return Promise.resolve();
  }

  finish(_job: WritableJob, finished: FinishedLog): Promise<void> {
    this.finished.push(finished);
    return Promise.resolve();
  }
}

/**
 * An agent frame, decoded as the gateway hands it to a listener.
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

/** A `log.chunk` for {@link JOB}. */
function chunk(seq: number, text: string, droppedBytes = 0): Envelope<"log.chunk"> {
  return agentFrame("valid/log-chunk.json", {
    job: WIRE,
    seq,
    data: Buffer.from(text).toString("base64"),
    dropped_bytes: droppedBytes,
  });
}

/** A `job.finish` for {@link JOB}. */
function finish(chunks: number, droppedBytes: number): Envelope<"job.finish"> {
  return agentFrame("valid/job-finish.json", {
    job: WIRE,
    log: { bytes: 0, chunks, dropped_bytes: droppedBytes },
  });
}

describe("log ingest", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let now: number;
  let repository: RecordingRepository;
  let sessions: AgentSessions;
  let guard: RateGuard;
  let ingest: LogIngest;
  const from: FrameContext = { organizationId: ORG, runnerId: RUNNER, sessionId: "sess_x" };

  beforeEach(() => {
    now = Date.parse("2026-09-19T12:00:00.000Z");
    repository = new RecordingRepository();
    sessions = new AgentSessions(() => new Date(now), new GatewayMetrics());
    guard = new RateGuard(1_000_000, 1_000_000);
    ingest = new LogIngest(
      repository as unknown as LogRepository,
      sessions,
      guard,
      { days: LOG_RETENTION_DAYS, budgetBytesPerOrg: 1 << 30 },
      new SchedulerRegistry(),
      () => new Date(now),
    );
    ingest.onApplicationBootstrap();
  });

  afterEach(() => ingest.onApplicationShutdown());

  /** What was stored, as text in order. */
  function storedText(): string[] {
    return repository.stored.map((write) => write.content.toString("utf8"));
  }

  it("stores chunks through the gateway's listener, with their retention window", async () => {
    await sessions.notify(from, chunk(0, "$ west build\n"));

    expect(storedText()).toEqual(["$ west build\n"]);
    expect(repository.stored[0]).toMatchObject({
      seq: 0,
      elidedBytes: 0,
      missingChunks: 0,
      agentDropped: 0,
      retainUntil: new Date(now + LOG_RETENTION_DAYS * 86_400_000),
    });
  });

  it("REASSEMBLES IN ORDER under deliberately out-of-order arrival", async () => {
    await sessions.notify(from, chunk(0, "a"));
    await sessions.notify(from, chunk(2, "c"));
    expect(storedText()).toEqual(["a"]);

    await sessions.notify(from, chunk(1, "b"));

    expect(storedText()).toEqual(["a", "b", "c"]);
    expect(repository.stored.map((write) => write.seq)).toEqual([0, 1, 2]);
  });

  it("carries the agent's own dropped bytes on the chunk they came before", async () => {
    await sessions.notify(from, chunk(0, "x", 4096));

    expect(repository.stored[0]).toMatchObject({ elidedBytes: 4096, agentDropped: 4096 });
  });

  it("ignores another runner's job, another workspace's, and an id that is not a job", async () => {
    await sessions.notify({ ...from, runnerId: OTHER_RUNNER }, chunk(0, "not yours"));
    await sessions.notify({ ...from, organizationId: "org-other" }, chunk(0, "not yours"));
    await sessions.notify(
      from,
      agentFrame("valid/log-chunk.json", { job: "job_7ZZZZZZZZZZZZZZZZZZZZZZZZZ" }),
    );

    expect(repository.stored).toEqual([]);
    expect(ingest.active).toBe(0);
  });

  it("starts from the job's stored log, so a re-sent chunk is not stored twice", async () => {
    repository.next = 3;

    await sessions.notify(from, chunk(2, "old"));
    await sessions.notify(from, chunk(3, "new"));

    expect(storedText()).toEqual(["new"]);
  });

  it("refuses what the workspace's rate cannot pay for, and marks it before the next stored chunk", async () => {
    guard = new RateGuard(0, 10);
    ingest.onApplicationShutdown();
    ingest = new LogIngest(
      repository as unknown as LogRepository,
      sessions,
      guard,
      { days: LOG_RETENTION_DAYS, budgetBytesPerOrg: 1 << 30 },
      new SchedulerRegistry(),
      () => new Date(now),
    );
    ingest.onApplicationBootstrap();

    await sessions.notify(from, chunk(0, "12345"));
    // A bucket of ten bytes that never refills: five are left, and twenty cannot be paid for.
    await sessions.notify(from, chunk(1, "this is far too much", 7));
    await sessions.notify(from, chunk(2, "abcde"));

    expect(storedText()).toEqual(["12345", "abcde"]);
    expect(repository.stored[1]).toMatchObject({ seq: 2, elidedBytes: 20 + 7, agentDropped: 0 });
    expect(repository.agentDrops).toEqual([7]);
  });

  it("keeps what it carried when the chunk it lands on turns out to be a duplicate", async () => {
    await sessions.notify(from, chunk(0, "a", 5));
    repository.outcome = "duplicate";
    await sessions.notify(from, chunk(1, "b", 3));
    repository.outcome = "stored";
    await sessions.notify(from, chunk(2, "c"));

    expect(repository.stored.map((write) => write.elidedBytes)).toEqual([5, 3, 0]);
  });

  describe("a finish", () => {
    it("releases what was held, gives up the gap, and records the tail", async () => {
      await sessions.notify(from, chunk(0, "a"));
      await sessions.notify(from, chunk(3, "d"));

      await sessions.beforeTerminal(from, finish(6, 9000));

      expect(storedText()).toEqual(["a", "d"]);
      expect(repository.stored[1]).toMatchObject({ seq: 3, missingChunks: 2 });
      // Six chunks were sent, four arrived: the last two are missing at the tail.
      expect(repository.finished).toEqual([
        { agentDropped: 9000, missingChunks: 2, refusedBytes: 0 },
      ]);
      expect(ingest.active).toBe(0);
    });

    it("records the tail of a job that shipped no chunks at all — today's agent", async () => {
      await sessions.beforeTerminal(from, finish(0, 184320));

      expect(repository.finished).toEqual([
        { agentDropped: 184320, missingChunks: 0, refusedBytes: 0 },
      ]);
    });

    it("changes nothing for a job already finished — a re-send, or a cancelled build", async () => {
      repository.open = false;

      await sessions.beforeTerminal(from, finish(0, 10));

      expect(repository.finished).toEqual([]);
    });

    it("ignores another runner's finish", async () => {
      await sessions.beforeTerminal({ ...from, runnerId: OTHER_RUNNER }, finish(0, 10));

      expect(repository.finished).toEqual([]);
    });

    it("is accounted before the gateway records the finish — on the hook, not after it", async () => {
      // A listener runs after the ledger; the hook the connection awaits runs before it.
      await sessions.notify(from, finish(0, 10));
      expect(repository.finished).toEqual([]);

      await sessions.beforeTerminal(from, finish(0, 10));
      expect(repository.finished).toHaveLength(1);
    });
  });

  describe("housekeeping", () => {
    it("gives up a gap nobody filled once it has waited long enough", async () => {
      await sessions.notify(from, chunk(0, "a"));
      await sessions.notify(from, chunk(2, "c"));

      now += LOG_GAP_WAIT_MS - 1;
      await ingest.housekeep();
      expect(storedText()).toEqual(["a"]);

      now += 1;
      await ingest.housekeep();
      expect(storedText()).toEqual(["a", "c"]);
      expect(repository.stored[1]).toMatchObject({ missingChunks: 1 });
    });

    it("forgets a job nobody has written to, releasing what it held", async () => {
      await sessions.notify(from, chunk(1, "b"));

      now += LOG_IDLE_FORGET_MS;
      await ingest.housekeep();

      expect(storedText()).toEqual(["b"]);
      expect(ingest.active).toBe(0);
    });
  });

  it("stops writing a job that finished while its chunks were on the way", async () => {
    await sessions.notify(from, chunk(0, "a"));
    repository.outcome = "closed";
    await sessions.notify(from, chunk(1, "b"));
    repository.open = false;
    await sessions.notify(from, chunk(2, "c"));

    // "b" reached the store, which found the job finished and wrote nothing; the state was
    // forgotten, so "c" asked again and was refused before any store.
    expect(storedText()).toEqual(["a", "b"]);
    expect(ingest.active).toBe(0);
    expect(repository.lookups).toBe(2);
  });

  it("logs a store that failed, and still stores the job's next chunk", async () => {
    repository.fail = true;
    await sessions.notify(from, chunk(0, "lost"));
    repository.fail = false;
    await sessions.notify(from, chunk(1, "kept"));

    expect(storedText()).toEqual(["kept"]);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it("stops listening when the application shuts down", async () => {
    ingest.onApplicationShutdown();

    await sessions.notify(from, chunk(0, "late"));

    expect(repository.stored).toEqual([]);
  });
});
