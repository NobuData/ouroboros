import { Logger } from "@nestjs/common";
import { frame } from "../protocol/protocol";
import type { JobOfferPayload } from "../protocol/protocol.messages";
import { AgentSessions } from "./agent.sessions";
import { FakeSocket, drain, fixtureFrame } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import { MAX_PENDING_FRAMES, RESUME_WINDOW_MS } from "./gateway.policy";

/** Two workspaces, and runners in them. */
const ORG = "org-a";
const OTHER_ORG = "org-b";
const RUNNER = "7f000002-0000-4000-8000-000000000001";
const OTHER_RUNNER = "7f000002-0000-4000-8000-000000000002";

/** The golden offer's payload, with an expiry the suite controls. */
function offerPayload(expiresAt: string): JobOfferPayload {
  return {
    ...(fixtureFrame("valid/job-offer.json").payload as unknown as JobOfferPayload),
    expires_at: expiresAt,
  };
}

describe("the session registry", () => {
  // Several cases drive a failure path on purpose — a refused hello, a dead database, a listener
  // that throws — and the gateway logs each one, as it should in production. Silenced here so the
  // suite's output holds only what failed; the cases that care what was said spy on it themselves.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let now: Date;
  let metrics: GatewayMetrics;
  let sessions: AgentSessions;

  beforeEach(() => {
    now = new Date("2026-09-18T12:00:00.000Z");
    metrics = new GatewayMetrics();
    sessions = new AgentSessions(() => now, metrics);
  });

  /** Advance the registry's clock. */
  function advance(ms: number): void {
    now = new Date(now.getTime() + ms);
  }

  /** Open and attach a session, as a hello that was acknowledged does. */
  function connect(resume?: string, org = ORG, runner = RUNNER) {
    const socket = new FakeSocket();
    const opened = sessions.open(org, runner, resume);
    sessions.attach(opened.session, socket);
    sessions.replay(opened.session);

    return { ...opened, socket };
  }

  describe("opening and resuming", () => {
    it("opens a fresh session with a protocol-shaped id", () => {
      const { session, resumed } = connect();

      expect(resumed).toBe(false);
      expect(session.id).toMatch(/^sess_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(sessions.isConnected(ORG, RUNNER)).toBe(true);
    });

    it("resumes the session a hello names, inside its window", () => {
      const first = connect();
      sessions.detach(first.session, first.socket);
      advance(RESUME_WINDOW_MS);

      const second = connect(first.session.id);

      expect(second.resumed).toBe(true);
      expect(second.session).toBe(first.session);
      expect(metrics.snapshot(sessions.gauges()).sessions).toMatchObject({
        attached: 1,
        detached: 0,
      });
    });

    it("does not resume a session past its window, and forgets it", () => {
      const first = connect();
      sessions.detach(first.session, first.socket);
      advance(RESUME_WINDOW_MS + 1);

      const second = connect(first.session.id);

      expect(second.resumed).toBe(false);
      expect(second.session.id).not.toBe(first.session.id);
      expect(sessions.gauges()).toEqual({ attached: 1, detached: 0 });
    });

    it("does not resume an unknown session", () => {
      expect(connect("sess_01KE7MV3WKAG706QMDN23AJ3BE").resumed).toBe(false);
    });

    it("never resumes another runner's session — and leaves it alone", () => {
      const theirs = connect(undefined, ORG, OTHER_RUNNER);

      const mine = connect(theirs.session.id);

      expect(mine.resumed).toBe(false);
      expect(theirs.socket.closedWith).toBeUndefined();
      expect(sessions.isConnected(ORG, OTHER_RUNNER)).toBe(true);
    });

    it("never resumes another workspace's session, even for the same runner id", () => {
      const theirs = connect(undefined, OTHER_ORG, RUNNER);

      const mine = connect(theirs.session.id);

      expect(mine.resumed).toBe(false);
      expect(theirs.socket.closedWith).toBeUndefined();
      expect(sessions.find(OTHER_ORG, RUNNER)).toBe(theirs.session);
    });

    it("replaces a runner's previous connection with its new one", () => {
      const first = connect();

      const second = connect();

      expect(first.socket.closedWith).toEqual({
        code: 1000,
        reason: "replaced by a newer connection",
      });
      expect(sessions.find(ORG, RUNNER)).toBe(second.session);
      expect(metrics.snapshot(sessions.gauges()).connections.replaced).toBe(1);
    });

    it("takes over a resumed session still attached to a socket that has not noticed it died", () => {
      const first = connect();

      const second = connect(first.session.id);

      expect(second.resumed).toBe(true);
      expect(first.socket.closedWith?.code).toBe(1000);
      expect(first.session.socket).toBe(second.socket);
    });

    it("ignores a detach from a socket the session no longer holds", () => {
      const first = connect();
      const second = connect(first.session.id);

      sessions.detach(first.session, first.socket);

      expect(second.session.attached).toBe(true);
    });

    it("forgets a session that ended with a bye", () => {
      const { session } = connect();

      sessions.end(session);

      expect(sessions.find(ORG, RUNNER)).toBeUndefined();
      expect(connect(session.id).resumed).toBe(false);
    });
  });

  describe("ordered delivery", () => {
    it("writes owed frames in order, and stops owing a receipt once it is written", async () => {
      const { session, socket } = connect();

      sessions.deliver(
        session,
        frame("receipt", {
          of: "01KE7PDZMQDPKXES55PN5RZM7Q",
          of_type: "job.finish",
          duplicate: false,
        }),
        "receipt",
      );
      sessions.deliver(
        session,
        frame("drain", { reason: "operator", deadline_ms: 0, detail: "d" }),
        "control",
      );
      await session.flushed();

      expect(socket.types()).toEqual(["receipt", "drain"]);
      expect(session.outbox).toHaveLength(0);
      expect(metrics.snapshot(sessions.gauges()).sent).toMatchObject({ receipt: 1, drain: 1 });
    });

    it("keeps a receipt whose write failed, and replays it — first — on resume", async () => {
      const first = connect();
      first.socket.failWrites = true;

      sessions.deliver(
        first.session,
        frame("receipt", {
          of: "01KE7PDZMQDPKXES55PN5RZM7Q",
          of_type: "job.finish",
          duplicate: false,
        }),
        "receipt",
      );
      await first.session.flushed();
      sessions.detach(first.session, first.socket);

      expect(first.session.outbox).toHaveLength(1);

      const second = connect(first.session.id);
      await second.session.flushed();

      expect(second.socket.types()).toEqual(["receipt"]);
      expect(second.session.outbox).toHaveLength(0);
    });

    it("queues frames for a detached session and delivers them, in order, on resume", async () => {
      const first = connect();
      sessions.detach(first.session, first.socket);

      sessions.push(
        ORG,
        RUNNER,
        frame("drain", { reason: "operator", deadline_ms: 0, detail: "d" }),
      );
      sessions.push(ORG, RUNNER, frame("undrain", {}));
      expect(first.socket.sent).toHaveLength(0);

      const second = connect(first.session.id);
      await second.session.flushed();

      expect(second.socket.types()).toEqual(["drain", "undrain"]);
    });

    it("drops what a discarded session owed rather than handing it to a stranger", async () => {
      const first = connect();
      sessions.detach(first.session, first.socket);
      sessions.push(ORG, RUNNER, frame("undrain", {}));

      const fresh = connect();
      await fresh.session.flushed();

      expect(fresh.resumed).toBe(false);
      expect(fresh.socket.sent).toHaveLength(0);
    });
  });

  describe("offers", () => {
    it("sends an offer, keeps it owed after the write, and settles it on an answer", async () => {
      const { session, socket } = connect();

      const id = sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T12:00:05.000Z"));
      await session.flushed();

      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(socket.last("job.offer").id).toBe(id);
      expect(session.outbox).toHaveLength(1);

      expect(sessions.settle(session, id as string)).toBe(true);
      expect(sessions.settle(session, id as string)).toBe(false);
      expect(session.outbox).toHaveLength(0);
    });

    it("uses the envelope id a caller chose", async () => {
      const { session, socket } = connect();

      sessions.offer(
        ORG,
        RUNNER,
        offerPayload("2026-09-18T12:00:05.000Z"),
        "01KE76GYFT5404Q2FA41RMP9PE",
      );
      await session.flushed();

      expect(socket.last("job.offer").id).toBe("01KE76GYFT5404Q2FA41RMP9PE");
    });

    it("re-sends an unanswered offer on resume — the undelivered job.offer the issue names", async () => {
      const first = connect();
      const id = sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T12:00:05.000Z"));
      await first.session.flushed();
      sessions.detach(first.session, first.socket);

      const second = connect(first.session.id);
      await second.session.flushed();

      expect(second.socket.last("job.offer").id).toBe(id);
    });

    it("drops an offer that expired while nobody was listening, instead of delivering it unanswerable", async () => {
      const first = connect();
      sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T12:00:05.000Z"));
      await first.session.flushed();
      sessions.detach(first.session, first.socket);
      advance(10_000);

      const second = connect(first.session.id);
      await second.session.flushed();

      expect(second.socket.sent).toHaveLength(0);
      expect(second.session.outbox).toHaveLength(0);
    });

    it("answers undefined for a runner with no session here, and sends nothing", () => {
      expect(sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T12:00:05.000Z"))).toBeUndefined();
    });

    it("refuses to send an illegal offer — the agent would end the session over it", () => {
      connect();
      const illegal = { ...offerPayload("2026-09-18T12:00:05.000Z"), executor: "shell" as const };

      expect(() => sessions.offer(ORG, RUNNER, illegal)).toThrow(TypeError);
    });

    it("refuses a new offer once a session owes its ceiling, rather than evicting a promised one", () => {
      const { session } = connect();
      session.socket = undefined;

      for (let i = 0; i < MAX_PENDING_FRAMES; i += 1) {
        expect(sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T13:00:00.000Z"))).toBeDefined();
      }

      expect(sessions.offer(ORG, RUNNER, offerPayload("2026-09-18T13:00:00.000Z"))).toBeUndefined();
    });
  });

  describe("housekeeping", () => {
    it("expires sessions past their window and offers past their expiry", async () => {
      const kept = connect(undefined, ORG, OTHER_RUNNER);
      sessions.offer(ORG, OTHER_RUNNER, offerPayload("2026-09-18T12:00:05.000Z"));
      await kept.session.flushed();

      const gone = connect();
      sessions.detach(gone.session, gone.socket);
      advance(RESUME_WINDOW_MS + 1);

      expect(sessions.expire()).toBe(1);
      expect(kept.session.outbox).toHaveLength(0);
      expect(sessions.find(ORG, RUNNER)).toBeUndefined();
      expect(metrics.snapshot(sessions.gauges()).sessions.expired).toBe(1);
    });

    it("names the attached sessions whose agent has gone quiet", () => {
      const quiet = connect();
      advance(40_000);
      const loud = connect(undefined, ORG, OTHER_RUNNER);

      expect(sessions.stale(now.getTime() - 32_000)).toEqual([quiet.session]);
      expect(sessions.stale(now.getTime() - 32_000)).not.toContain(loud.session);
    });

    it("says goodbye to every agent on shutdown and forgets everything", async () => {
      const one = connect();
      const two = connect(undefined, ORG, OTHER_RUNNER);

      await sessions.shutdown(() =>
        frame("bye", { reason: "server_shutdown", detail: "d", reconnect_after_ms: 5000 }),
      );

      for (const { socket } of [one, two]) {
        expect(socket.last("bye").payload).toMatchObject({
          reason: "server_shutdown",
          reconnect_after_ms: 5000,
        });
        expect(socket.closedWith?.code).toBe(1001);
      }
      expect(sessions.gauges()).toEqual({ attached: 0, detached: 0 });
    });
  });

  describe("listeners", () => {
    it("tells every listener of a type, in registration order, and stops when asked", async () => {
      const heard: string[] = [];
      const stop = sessions.listen("job.accept", (context) => {
        heard.push(`first:${context.runnerId}`);
      });
      sessions.listen("job.accept", () => {
        heard.push("second");
      });

      const accept = fixtureFrame("valid/job-accept.json");
      const context = { organizationId: ORG, runnerId: RUNNER, sessionId: "sess_x" };
      await sessions.notify(context, accept as never);
      stop();
      await sessions.notify(context, accept as never);

      expect(heard).toEqual([`first:${RUNNER}`, "second", "second"]);
    });

    it("survives a listener that throws", async () => {
      const heard: string[] = [];
      sessions.listen("log.chunk", () => {
        throw new Error("boom");
      });
      sessions.listen("log.chunk", () => {
        heard.push("after");
      });

      await sessions.notify(
        { organizationId: ORG, runnerId: RUNNER, sessionId: "sess_x" },
        fixtureFrame("valid/log-chunk.json") as never,
      );
      await drain();

      expect(heard).toEqual(["after"]);
    });
  });
});
