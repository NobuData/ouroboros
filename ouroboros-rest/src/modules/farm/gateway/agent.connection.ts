/**
 * One agent's connection, from its `hello` to its close — the gateway's half of the session in
 * `docs/RUNNER_PROTOCOL.md`.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). By the time one of these
 * exists the transport has already been authenticated (`transport.ts`): the connection knows
 * *which runner* it is talking to, and nothing an agent writes afterwards can change that.
 *
 * ```
 *  awaiting hello ── hello ──▶ readHello: violation? refuse? ── security mode vs transport
 *        │                              │
 *        │ 10s, nothing                 └─▶ runner row: hostname · arch · version · caps · online
 *        ▼                                   session: resumed or fresh ─▶ ack ─▶ replay the outbox
 *     close 1008                             drained while away? ─▶ drain
 *                                                  │
 *                                                  ▼
 *  open ── heartbeat ──▶ telemetry · last_seen_at ← THIS beat · pill · reconcile drain
 *       ── job.finish ─▶ ledger + job, one transaction ─▶ receipt{duplicate}
 *       ── job.start ──▶ job running
 *       ── accept/decline ─▶ the offer is settled
 *       ── bye ────────▶ offline, deliberately; session ended; close
 *       ── anything the contract refuses, or from the wrong end ─▶ bye{error} + close 1002
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Frames are handled one at a time, in arrival order.** Every `message` event joins a promise
 * chain, so a `job.start` is written before the `job.finish` that follows it even when the first
 * write is slow — the WebSocket's own ordering guarantee, kept through the asynchronous database
 * work rather than lost to it.
 *
 * **Record, then answer.** A `receipt` is written only after `recordTerminal` has committed; a
 * failure between the two closes the connection *without* a receipt, which is the one outcome an
 * agent is built to survive — it re-sends, and the ledger answers `duplicate`.
 *
 * **Everything written to the agent is the contract's.** Refusals are codes the Go agent already
 * branches on; a violation is answered with `bye {reason: error}` naming the diagnostic codes and
 * paths — where a frame was wrong, never what was in it — so the log line on both ends is safe
 * to keep.
 */

import { Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import type { Runner } from "../../db/schema";
import { SENT_BY, decode, encode, frame, type Envelope, type Frame } from "../protocol/protocol";
import type { RefusePayload } from "../protocol/protocol.messages";
import { uuidOf, wireId } from "../protocol/ulid";
import type { AgentSession, AgentSessions, FrameContext } from "./agent.sessions";
import type { AgentSocket } from "./agent.socket";
import { capabilitiesOf } from "./capabilities";
import type { GatewayClock } from "./gateway.clock";
import type { GatewayMetrics, RefusalReason } from "./gateway.metrics";
import { HELLO_TIMEOUT_MS, REDRAIN_DEADLINE_MS, SESSION_LIMITS } from "./gateway.policy";
import type { AgentGatewayRepository } from "./gateway.repository";
import { describe, readHello, securityModeRefusal, type VersionPolicy } from "./hello";
import { isBuilding, telemetryOf } from "./telemetry";
import { terminalState } from "./terminal";
import type { Transport } from "./transport";

/** What a connection needs, handed in by the gateway that accepted it. */
export interface ConnectionContext {
  readonly sessions: AgentSessions;
  readonly repository: AgentGatewayRepository;
  readonly metrics: GatewayMetrics;
  readonly policy: VersionPolicy;
  readonly now: GatewayClock;
}

/** The close codes this file uses. */
const CLOSE = {
  normal: 1000,
  protocolError: 1002,
  policy: 1008,
  internalError: 1011,
} as const;

/** The `detail` a re-sent drain carries. */
const REDRAIN_DETAIL =
  "an operator drained this runner; it stays out of rotation until it is undrained";

/** Where a connection is in its life. */
type Phase = "hello" | "open" | "closed";

export class AgentConnection {
  private readonly logger = new Logger(AgentConnection.name);
  private phase: Phase = "hello";
  private session: AgentSession | undefined;
  /** The runner row, refreshed by every write that returns it. */
  private runner: Runner;
  /** Every frame's handling, in arrival order. */
  private queue: Promise<void> = Promise.resolve();
  private readonly helloTimer: NodeJS.Timeout;

  /**
   * @param socket - The upgraded connection.
   * @param transport - Who it proved it is.
   * @param context - The gateway's collaborators.
   */
  constructor(
    private readonly socket: AgentSocket,
    private readonly transport: Transport,
    private readonly context: ConnectionContext,
  ) {
    this.runner = transport.runner;
    this.helloTimer = setTimeout(() => this.helloTimedOut(), HELLO_TIMEOUT_MS);
    // A connection that never says hello must not be the reason a process stays alive.
    this.helloTimer.unref();
  }

  /**
   * A frame arrived. Handled after every frame before it.
   *
   * @param data - Its bytes.
   * @param isBinary - Whether it arrived as a binary frame, which the protocol does not use.
   */
  receive(data: Buffer, isBinary: boolean): void {
    this.queue = this.queue
      .then(() => this.handle(data, isBinary))
      .catch((error: unknown) => this.fail(error));
  }

  /**
   * The socket closed — from either end.
   *
   * The session waits out its resume window rather than being ended: a socket that drops is
   * *not* the runner going offline. Presence is the heartbeat's to judge, and the sweep's.
   */
  closed(): void {
    clearTimeout(this.helloTimer);
    if (this.session) this.context.sessions.detach(this.session, this.socket);
    this.phase = "closed";
  }

  /**
   * Resolves when every frame received so far has been handled — for the gateway's shutdown,
   * and for a suite.
   *
   * @returns The queue's tail.
   */
  settled(): Promise<void> {
    return this.queue;
  }

  /**
   * Handle one frame.
   *
   * @param data - Its bytes.
   * @param isBinary - Whether it was a binary frame.
   * @returns When it has been handled.
   */
  private async handle(data: Buffer, isBinary: boolean): Promise<void> {
    if (this.phase === "closed") return;

    if (isBinary) {
      await this.violation("a binary frame; every frame is one JSON object in a text frame");
      return;
    }

    if (this.phase === "hello") {
      await this.hello(data);
      return;
    }

    const decoded = decode(data);
    if (!decoded.envelope) {
      await this.violation(`an illegal frame: ${describe(decoded.diagnostics)}`);
      return;
    }

    const envelope = decoded.envelope;
    if (!SENT_BY[envelope.type].includes("agent")) {
      await this.violation(`${envelope.type} is not the agent's to send`);
      return;
    }

    this.context.metrics.frameReceived(envelope.type);
    await this.dispatch(envelope);
  }

  /**
   * The first frame: acknowledge it, refuse it, or close on it.
   *
   * @param data - Its bytes.
   * @returns When it has been answered.
   */
  private async hello(data: Buffer): Promise<void> {
    clearTimeout(this.helloTimer);

    const reading = readHello(data, this.context.policy);

    if (reading.kind === "violation") {
      await this.violation(reading.reason);
      return;
    }
    if (reading.kind === "refuse") {
      await this.refuse(reading.refusal, "version");
      return;
    }

    const hello = reading.envelope.payload;
    this.context.metrics.frameReceived("hello");

    const claim = securityModeRefusal(hello.security_mode, this.transport.mode);
    if (claim) {
      await this.refuse(claim, "security_mode");
      return;
    }

    const runner = await this.context.repository.recordHello(
      this.runner.organization_id,
      this.runner.id,
      {
        hostname: hello.hostname,
        arch: hello.arch,
        agentVersion: hello.agent.version,
        capabilities: capabilitiesOf(hello.capabilities),
      },
      this.context.now(),
    );

    if (!runner) {
      await this.refuse(
        {
          code: "identity.revoked",
          minimum: null,
          detail: "this runner has been removed from the farm; enroll the machine again",
          retry_after_ms: null,
        },
        "removed",
      );
      return;
    }

    this.runner = runner;

    const pool = await this.context.repository.poolOfRecord(runner.organization_id, runner.pool_id);
    const { session, resumed } = this.context.sessions.open(
      runner.organization_id,
      runner.id,
      hello.resume,
    );
    this.session = session;
    this.context.sessions.attach(session, this.socket);

    // The pool's policy travels with the ack (#246): the agent holds itself to the pool's
    // concurrency cap and passes a job only the variables the pool allows. A pool that has gone
    // is stated as `unknown` with no policy, which the agent reads as the column defaults.
    const ack = frame("ack", {
      session: session.id,
      protocol: reading.protocol,
      resumed,
      runner: { id: wireId("rnr", runner.id), name: runner.name, pool: pool?.name ?? "unknown" },
      limits: SESSION_LIMITS,
      ...(pool ? { pool: pool.policy } : {}),
    });

    if (!(await this.write(ack))) return;

    this.phase = "open";
    this.context.metrics.helloAcknowledged(resumed);
    this.context.sessions.replay(session);

    // A runner drained while it was away is told again now — the agent's own drain flag does
    // not survive a restart, and the operator's intent does.
    if (runner.desired_state === "draining" && session.lastControl !== "drain") this.redrain();

    await this.context.sessions.notify(this.frameContext(), reading.envelope);
  }

  /**
   * Handle a frame of an open session.
   *
   * @param envelope - The frame, judged and from the right end.
   * @returns When it has been handled.
   */
  private async dispatch(envelope: Envelope): Promise<void> {
    const session = this.session as AgentSession;
    const context = this.frameContext();

    switch (envelope.type) {
      case "hello":
        await this.violation("a second hello on one connection");
        return;

      case "heartbeat":
        await this.heartbeat(envelope as Envelope<"heartbeat">, session);
        break;

      case "job.finish":
        await this.finish(envelope as Envelope<"job.finish">, session);
        break;

      case "job.start":
        await this.start(envelope as Envelope<"job.start">);
        break;

      case "job.accept":
      case "job.decline":
        this.context.sessions.settle(
          session,
          (envelope as Envelope<"job.accept" | "job.decline">).payload.offer,
        );
        break;

      case "bye":
        await this.bye(session);
        break;

      // job.progress and log.chunk are advisory here: counted, and handed to whoever listens —
      // log ingest is AH.5's (#253).
      default:
        break;
    }

    await this.context.sessions.notify(context, envelope);
  }

  /**
   * A heartbeat: telemetry, presence, and the drain reconciliation.
   *
   * The reconciliation is what makes a drain reach an agent that is connected to *another*
   * replica, and what brings back an agent that restarted drained: the operator's intent is in
   * the row this write returns, the agent's state is in the beat, and when they disagree the
   * gateway says so — once per session per direction, so a beat that crossed the push in flight
   * does not provoke a second one.
   *
   * @param envelope - The heartbeat.
   * @param session - The session.
   * @returns When it has been recorded.
   */
  private async heartbeat(envelope: Envelope<"heartbeat">, session: AgentSession): Promise<void> {
    const beat = envelope.payload;
    const at = this.context.now();

    const runner = await this.context.repository.recordHeartbeat(
      this.runner.organization_id,
      this.runner.id,
      {
        reported: beat.state,
        building: isBuilding(beat),
        telemetry: telemetryOf(beat),
        uptimeSeconds: beat.uptime_s,
      },
      at,
    );

    if (!runner) {
      await this.goodbye("error", "this runner has been removed from the farm");
      return;
    }

    this.runner = runner;
    session.lastHeartbeatAt = at.getTime();

    const agentDraining = beat.state === "draining";

    if (runner.desired_state === "draining" && !agentDraining && session.lastControl !== "drain") {
      this.redrain();
    } else if (
      runner.desired_state === "active" &&
      agentDraining &&
      session.lastControl !== "undrain"
    ) {
      this.context.sessions.push(runner.organization_id, runner.id, frame("undrain", {}));
    }
  }

  /**
   * A terminal frame: record it and apply it once, then — and only then — answer it.
   *
   * @param envelope - The `job.finish`.
   * @param session - The session to owe the receipt to.
   * @returns When the receipt is owed.
   */
  private async finish(envelope: Envelope<"job.finish">, session: AgentSession): Promise<void> {
    const at = this.context.now();
    const started = new Date(envelope.payload.started_at);

    const record = await this.context.repository.recordTerminal(
      {
        organizationId: this.runner.organization_id,
        runnerId: this.runner.id,
        frameId: envelope.id,
        jobId: uuidOf("job", envelope.payload.job),
        state: terminalState(envelope.payload),
        agentStartedAt: Number.isNaN(started.getTime()) ? at : started,
      },
      at,
    );

    this.context.metrics.terminalRecorded(record.duplicate);
    this.context.sessions.deliver(
      session,
      frame("receipt", { of: envelope.id, of_type: "job.finish", duplicate: record.duplicate }),
      "receipt",
    );
  }

  /**
   * A job started.
   *
   * @param envelope - The `job.start`.
   * @returns When it has been recorded.
   */
  private async start(envelope: Envelope<"job.start">): Promise<void> {
    const jobId = uuidOf("job", envelope.payload.job);
    if (!jobId) return;

    const at = this.context.now();
    const started = new Date(envelope.payload.started_at);

    await this.context.repository.startJob(
      this.runner.organization_id,
      this.runner.id,
      jobId,
      Number.isNaN(started.getTime()) ? at : started,
      at,
    );
  }

  /**
   * The agent's orderly close — what a SIGTERM becomes. `offline` now, deliberately, and the
   * session ended: an agent that said goodbye is not coming back for it.
   *
   * @param session - The session.
   * @returns When the row is written and the close begun.
   */
  private async bye(session: AgentSession): Promise<void> {
    await this.context.repository.recordBye(this.runner.organization_id, this.runner.id);

    this.context.sessions.end(session);
    this.session = undefined;
    this.phase = "closed";
    this.socket.close(CLOSE.normal, "bye");
  }

  /** Tell the agent, again, that it is drained. */
  private redrain(): void {
    this.context.sessions.push(
      this.runner.organization_id,
      this.runner.id,
      frame("drain", {
        reason: "operator",
        deadline_ms: REDRAIN_DEADLINE_MS,
        detail: REDRAIN_DETAIL,
      }),
    );
  }

  /**
   * Refuse a hello: the `refuse` frame, then a close.
   *
   * @param refusal - What to say.
   * @param reason - Which counter.
   * @returns When it has been written and the close begun.
   */
  private async refuse(refusal: RefusePayload, reason: RefusalReason): Promise<void> {
    this.context.metrics.connectionRefused(reason);
    this.logger.warn(`Refused runner ${this.runner.id} (${refusal.code}): ${refusal.detail}`);

    await this.write(frame("refuse", refusal));
    this.phase = "closed";
    this.socket.close(CLOSE.normal, "refused");
  }

  /**
   * End a session over something the contract refuses.
   *
   * @param reason - One sentence — codes, paths and types, never frame content.
   * @returns When the goodbye has been written and the close begun.
   */
  private async violation(reason: string): Promise<void> {
    this.context.metrics.violation();
    this.logger.warn(`Protocol violation from runner ${this.runner.id}: ${reason}`);

    await this.write(
      frame("bye", {
        reason: "error",
        detail: truncate(`protocol violation: ${reason}`),
        reconnect_after_ms: null,
      }),
    );
    this.phase = "closed";
    this.socket.close(CLOSE.protocolError, "protocol violation");
  }

  /**
   * End a session the gateway cannot continue, with a `bye` saying why.
   *
   * @param reason - The `bye` reason.
   * @param detail - One sentence.
   * @returns When it has been written and the close begun.
   */
  private async goodbye(reason: "error" | "server_shutdown", detail: string): Promise<void> {
    await this.write(frame("bye", { reason, detail, reconnect_after_ms: null }));
    this.phase = "closed";
    this.socket.close(CLOSE.normal, "bye");
  }

  /** The first frame did not arrive in time. */
  private helloTimedOut(): void {
    if (this.phase !== "hello") return;

    this.context.metrics.connectionRefused("hello_timeout");
    this.phase = "closed";
    this.socket.close(CLOSE.policy, "no hello");
  }

  /**
   * Something failed that is this service's fault — most often the database. The connection is
   * closed **without** answering the frame it was handling, which for a terminal frame is exactly
   * right: no receipt means the agent re-sends, and the ledger decides.
   *
   * @param error - What failed.
   */
  private fail(error: unknown): void {
    this.logger.error(
      `The session for runner ${this.runner.id} failed; closing it so the agent reconnects.`,
      describeForLog(error),
    );

    if (this.phase === "closed") return;

    this.phase = "closed";
    this.socket.close(CLOSE.internalError, "internal error");
  }

  /**
   * Write a frame straight to the socket — the frames that belong to the connection rather than
   * to a session: `ack`, `refuse`, and a closing `bye`.
   *
   * @param value - The frame.
   * @returns Whether it was written.
   */
  private async write(value: Frame): Promise<boolean> {
    try {
      await this.socket.send(encode(value));
      this.context.metrics.frameSent(value.type);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Where frames on this connection come from, as a listener is told.
   *
   * @returns The context.
   */
  private frameContext(): FrameContext {
    return {
      organizationId: this.runner.organization_id,
      runnerId: this.runner.id,
      sessionId: this.session?.id ?? "",
    };
  }
}

/** The longest `detail` a `bye` may carry. */
const DETAIL_MAX = 512;

/**
 * Bound a sentence to what the contract allows a `detail`, on a code-point boundary.
 *
 * @param text - The sentence.
 * @returns It, or its first {@link DETAIL_MAX} code points.
 */
function truncate(text: string): string {
  const points = [...text];
  return points.length <= DETAIL_MAX ? text : points.slice(0, DETAIL_MAX).join("");
}
