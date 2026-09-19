import { Logger } from "@nestjs/common";
import type { Runner } from "../../db/schema";
import { runner } from "../farm.fixture";
import { encode, frame, type Envelope } from "../protocol/protocol";
import type { JobOfferPayload } from "../protocol/protocol.messages";
import { uuidOf, wireId } from "../protocol/ulid";
import { AgentConnection } from "./agent.connection";
import { AgentSessions } from "./agent.sessions";
import { FakeSocket, bytes, drain, fixtureBytes, fixtureFrame } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import { HELLO_TIMEOUT_MS, MIB, SESSION_LIMITS } from "./gateway.policy";
import type { AgentGatewayRepository, TerminalRecord } from "./gateway.repository";
import { DEFAULT_VERSION_POLICY, type VersionPolicy } from "./hello";
import type { Transport } from "./transport";

/**
 * One connection's protocol, driven frame by frame from the golden fixtures against a socket
 * that records what the gateway writes and a repository that records what it asks for.
 * `agent.gateway.integration-spec.ts` is the same story over a real socket and database.
 */

const NOW = new Date("2026-09-18T12:00:01.000Z");

/** A deferred promise, for holding a repository call open. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

describe("an agent connection", () => {
  // Several cases drive a failure path on purpose — a refused hello, a dead database, a listener
  // that throws — and the gateway logs each one, as it should in production. Silenced here so the
  // suite's output holds only what failed; the cases that care what was said spy on it themselves.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let row: Runner;
  let socket: FakeSocket;
  let metrics: GatewayMetrics;
  let sessions: AgentSessions;
  let repository: jest.Mocked<
    Pick<
      AgentGatewayRepository,
      "recordHello" | "poolName" | "recordHeartbeat" | "recordTerminal" | "startJob" | "recordBye"
    >
  >;
  let connection: AgentConnection;

  /** Build the connection under test. */
  function open(options: { mode?: Transport["mode"]; policy?: VersionPolicy } = {}): void {
    connection = new AgentConnection(
      socket,
      { runner: row, mode: options.mode ?? "mtls" },
      {
        sessions,
        repository: repository as unknown as AgentGatewayRepository,
        metrics,
        policy: options.policy ?? DEFAULT_VERSION_POLICY,
        now: () => NOW,
      },
    );
  }

  /** Deliver a frame and let everything it set off finish. */
  async function send(value: Buffer | object, isBinary = false): Promise<void> {
    connection.receive(Buffer.isBuffer(value) ? value : bytes(value), isBinary);
    await connection.settled();
    await drain();
  }

  /** Say the golden hello, and be acknowledged. */
  async function hello(): Promise<Envelope<"ack">> {
    await send(fixtureBytes("valid/hello.json"));
    return socket.last("ack");
  }

  beforeEach(() => {
    row = runner({ desired_state: "active", status: "offline" });
    socket = new FakeSocket();
    metrics = new GatewayMetrics();
    sessions = new AgentSessions(() => NOW, metrics);
    repository = {
      recordHello: jest.fn().mockResolvedValue({ ...row, status: "online" }),
      poolName: jest.fn().mockResolvedValue("arm-builders"),
      recordHeartbeat: jest.fn().mockResolvedValue({ ...row, status: "online" }),
      recordTerminal: jest.fn().mockResolvedValue({ duplicate: false, applied: true }),
      startJob: jest.fn().mockResolvedValue(true),
      recordBye: jest.fn().mockResolvedValue(undefined),
    };
    open();
  });

  describe("the hello", () => {
    it("records what the machine is, and acknowledges it with a session and the limits", async () => {
      const ack = await hello();

      expect(repository.recordHello).toHaveBeenCalledWith(
        row.organization_id,
        row.id,
        {
          hostname: "shed-pi-01",
          arch: "linux/arm64",
          agentVersion: "0.1.0",
          capabilities: {
            docker: true,
            shell: true,
            ccache: true,
            cpu_count: 8,
            memory_mb: 16384,
            executors: ["container", "shell"],
          },
        },
        NOW,
      );
      expect(ack.payload).toEqual({
        session: expect.stringMatching(/^sess_/) as string,
        protocol: 1,
        resumed: false,
        runner: { id: wireId("rnr", row.id), name: row.name, pool: "arm-builders" },
        limits: SESSION_LIMITS,
      });
      expect(socket.types()).toEqual(["ack"]);
      expect(sessions.isConnected(row.organization_id, row.id)).toBe(true);
    });

    it("resumes the session it names, and replays what that session was owed", async () => {
      const earlier = sessions.open(row.organization_id, row.id, undefined).session;
      const gone = new FakeSocket();
      sessions.attach(earlier, gone);
      sessions.detach(earlier, gone);
      sessions.push(row.organization_id, row.id, frame("undrain", {}));

      const resume = fixtureFrame("valid/hello-resume.json");
      resume.payload.resume = earlier.id;
      await send(resume);

      expect(socket.last("ack").payload).toMatchObject({ session: earlier.id, resumed: true });
      expect(socket.types()).toEqual(["ack", "undrain"]);
    });

    it("tells a runner drained while it was away that it is drained, right after the ack", async () => {
      repository.recordHello.mockResolvedValueOnce({ ...row, desired_state: "draining" });

      await hello();

      expect(socket.types()).toEqual(["ack", "drain"]);
      expect(socket.last("drain").payload).toMatchObject({ reason: "operator", deadline_ms: 0 });
    });

    it("REFUSES AN AGENT BELOW THE VERSION FLOOR with a reason it can act on, and writes nothing", async () => {
      open({ policy: { ...DEFAULT_VERSION_POLICY, minimumAgentVersion: "0.2.0" } });

      await send(fixtureBytes("valid/hello.json"));

      expect(socket.types()).toEqual(["refuse"]);
      expect(socket.last("refuse").payload).toEqual({
        code: "version.below_minimum",
        minimum: 1,
        detail: "agent 0.1.0 is below this farm's minimum agent version 0.2.0; upgrade the agent",
        retry_after_ms: null,
      });
      expect(socket.closedWith).toEqual({ code: 1000, reason: "refused" });
      expect(repository.recordHello).not.toHaveBeenCalled();
      expect(metrics.snapshot(sessions.gauges()).refused.version).toBe(1);
    });

    it("refuses a hello that claims mtls on a connection that authenticated by bearer", async () => {
      open({ mode: "bearer_fallback" });

      await send(fixtureBytes("valid/hello.json"));

      expect(socket.last("refuse").payload.code).toBe("identity.unknown");
      expect(repository.recordHello).not.toHaveBeenCalled();
      expect(metrics.snapshot(sessions.gauges()).refused.security_mode).toBe(1);
    });

    it("accepts the fallback's own hello on a bearer connection", async () => {
      open({ mode: "bearer_fallback" });

      await send(fixtureBytes("valid/hello-bearer-fallback.json"));

      expect(socket.types()).toEqual(["ack"]);
    });

    it("reads a hello without security_mode from the transport alone", async () => {
      open({ mode: "bearer_fallback" });

      await send(fixtureBytes("valid/hello-without-security-mode.json"));

      expect(socket.types()).toEqual(["ack"]);
    });

    it("refuses a runner removed between its handshake and its hello", async () => {
      repository.recordHello.mockResolvedValueOnce(undefined);

      await hello().catch(() => undefined);

      expect(socket.last("refuse").payload.code).toBe("identity.revoked");
      expect(sessions.find(row.organization_id, row.id)).toBeUndefined();
    });

    it("closes on a first frame that is not a hello", async () => {
      await send(fixtureBytes("valid/heartbeat.json"));

      expect(socket.last("bye").payload).toMatchObject({ reason: "error" });
      expect(socket.last("bye").payload.detail).toContain("not hello");
      expect(socket.closedWith?.code).toBe(1002);
      expect(metrics.snapshot(sessions.gauges()).violations).toBe(1);
    });

    it("closes a connection that never says hello", () => {
      jest.useFakeTimers();
      try {
        open();
        jest.advanceTimersByTime(HELLO_TIMEOUT_MS);

        expect(socket.closedWith).toEqual({ code: 1008, reason: "no hello" });
        expect(metrics.snapshot(sessions.gauges()).refused.hello_timeout).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("an open session", () => {
    beforeEach(async () => {
      await hello();
    });

    it("closes on a binary frame, an illegal frame, a second hello and a frame from the wrong end", async () => {
      for (const [input, binary, expected] of [
        [fixtureBytes("valid/heartbeat.json"), true, "binary frame"],
        [
          fixtureBytes("invalid/two-mistakes.json"),
          false,
          "payload.field.range at /payload/cpu_pct",
        ],
        [fixtureBytes("valid/hello.json"), false, "a second hello"],
        [fixtureBytes("valid/job-offer.json"), false, "job.offer is not the agent's to send"],
      ] as const) {
        socket = new FakeSocket();
        sessions = new AgentSessions(() => NOW, metrics);
        open();
        await hello();

        await send(input, binary);

        expect(socket.last("bye").payload.detail).toContain(expected);
        expect(socket.closedWith?.code).toBe(1002);
      }
    });

    it("records a heartbeat's telemetry, and moves last_seen_at to this beat", async () => {
      await send(fixtureBytes("valid/heartbeat-busy.json"));

      expect(repository.recordHeartbeat).toHaveBeenCalledWith(
        row.organization_id,
        row.id,
        {
          reported: "busy",
          building: true,
          telemetry: expect.objectContaining({ ram_total_bytes: 16384 * MIB }) as unknown,
          uptimeSeconds: 86650,
        },
        NOW,
      );
      expect(sessions.find(row.organization_id, row.id)?.lastHeartbeatAt).toBe(NOW.getTime());
    });

    it("tells an agent it is drained when a heartbeat shows it does not know — once", async () => {
      repository.recordHeartbeat.mockResolvedValue({ ...row, desired_state: "draining" });

      await send(fixtureBytes("valid/heartbeat.json"));
      await send(fixtureBytes("valid/heartbeat.json"));

      expect(socket.types().filter((type) => type === "drain")).toHaveLength(1);
    });

    it("undrains an agent that is draining when nobody intends it to be", async () => {
      const beat = fixtureFrame("valid/heartbeat.json");
      beat.payload.state = "draining";

      await send(beat);

      expect(socket.types()).toContain("undrain");
    });

    it("ends the session of a runner removed while connected", async () => {
      repository.recordHeartbeat.mockResolvedValueOnce(undefined);

      await send(fixtureBytes("valid/heartbeat.json"));

      expect(socket.last("bye").payload).toMatchObject({ reason: "error" });
      expect(socket.closedWith?.code).toBe(1000);
    });

    it("records a job.finish against its job and answers with a receipt", async () => {
      await send(fixtureBytes("valid/job-finish.json"));

      expect(repository.recordTerminal).toHaveBeenCalledWith(
        {
          organizationId: row.organization_id,
          runnerId: row.id,
          frameId: "01KE7PDZMQDPKXES55PN5RZM7Q",
          jobId: uuidOf("job", "job_01KE7J4EZ3204KQXMHJRPQPWQ6"),
          state: expect.objectContaining({ status: "succeeded", exitCode: 0 }) as unknown,
          agentStartedAt: new Date("2026-09-18T12:00:02.140Z"),
        },
        NOW,
      );
      expect(socket.last("receipt").payload).toEqual({
        of: "01KE7PDZMQDPKXES55PN5RZM7Q",
        of_type: "job.finish",
        duplicate: false,
      });
    });

    it("answers a re-send the ledger recognised with duplicate: true", async () => {
      repository.recordTerminal.mockResolvedValueOnce({ duplicate: true, applied: false });

      await send(fixtureBytes("valid/job-finish.json"));

      expect(socket.last("receipt").payload.duplicate).toBe(true);
      expect(metrics.snapshot(sessions.gauges()).terminal).toEqual({ recorded: 0, duplicates: 1 });
    });

    it("RECORDS, THEN ANSWERS — no receipt exists until the ledger has committed", async () => {
      const commit = deferred<TerminalRecord>();
      repository.recordTerminal.mockReturnValueOnce(commit.promise);

      connection.receive(fixtureBytes("valid/job-finish.json"), false);
      await drain();

      expect(socket.types()).not.toContain("receipt");

      commit.resolve({ duplicate: false, applied: true });
      await connection.settled();
      await drain();

      expect(socket.types()).toContain("receipt");
    });

    it("sends NO receipt when recording fails, and closes so the agent re-sends", async () => {
      repository.recordTerminal.mockRejectedValueOnce(new Error("database gone"));

      await send(fixtureBytes("valid/job-finish.json"));

      expect(socket.types()).not.toContain("receipt");
      expect(socket.closedWith).toEqual({ code: 1011, reason: "internal error" });
    });

    it("handles frames strictly in arrival order, even when the first write is slow", async () => {
      const started = deferred<boolean>();
      repository.startJob.mockReturnValueOnce(started.promise);

      connection.receive(fixtureBytes("valid/job-start.json"), false);
      connection.receive(fixtureBytes("valid/job-finish.json"), false);
      await drain();

      expect(repository.startJob).toHaveBeenCalled();
      expect(repository.recordTerminal).not.toHaveBeenCalled();

      started.resolve(true);
      await connection.settled();

      expect(repository.recordTerminal).toHaveBeenCalled();
    });

    it("starts the job a job.start names", async () => {
      await send(fixtureBytes("valid/job-start.json"));

      expect(repository.startJob).toHaveBeenCalledWith(
        row.organization_id,
        row.id,
        uuidOf("job", "job_01KE7J4EZ3204KQXMHJRPQPWQ6"),
        new Date("2026-09-18T12:00:02.140Z"),
        NOW,
      );
    });

    it("does not look up a job id that spells no UUID of this database", async () => {
      const start = fixtureFrame("valid/job-start.json");
      start.payload.job = "job_8ZZZZZZZZZZZZZZZZZZZZZZZZZ";

      await send(start);

      expect(repository.startJob).not.toHaveBeenCalled();
    });

    it("settles an offer when it is answered", async () => {
      const offer = fixtureFrame("valid/job-offer.json");
      sessions.offer(
        row.organization_id,
        row.id,
        {
          ...(offer.payload as unknown as JobOfferPayload),
          expires_at: "2026-09-18T12:00:15.000Z",
        },
        offer.id,
      );
      await drain();

      await send(fixtureBytes("valid/job-accept.json"));

      expect(sessions.find(row.organization_id, row.id)?.outbox).toHaveLength(0);
    });

    it("hands every frame to its listeners with where it came from", async () => {
      const heard: string[] = [];
      sessions.listen("log.chunk", (context, envelope) => {
        heard.push(`${context.runnerId}:${envelope.payload.seq}`);
      });

      await send(fixtureBytes("valid/log-chunk.json"));

      expect(heard).toEqual([`${row.id}:4`]);
      expect(metrics.snapshot(sessions.gauges()).received["log.chunk"]).toBe(1);
    });

    it("records an agent's bye as a deliberate offline, and ends the session", async () => {
      await send(fixtureBytes("valid/bye.json"));

      expect(repository.recordBye).toHaveBeenCalledWith(row.organization_id, row.id);
      expect(sessions.find(row.organization_id, row.id)).toBeUndefined();
      expect(socket.closedWith).toEqual({ code: 1000, reason: "bye" });
    });

    it("leaves the session waiting for resume when the socket merely drops", () => {
      connection.closed();

      const session = sessions.find(row.organization_id, row.id);
      expect(session?.attached).toBe(false);
      expect(session?.detachedAt).toBe(NOW.getTime());
    });

    it("ignores frames that arrive after it has closed", async () => {
      await send(fixtureBytes("valid/bye.json"));
      await send(
        encode(frame("heartbeat", fixtureFrame("valid/heartbeat.json").payload as never)) as never,
      );

      expect(repository.recordHeartbeat).not.toHaveBeenCalled();
    });
  });
});
