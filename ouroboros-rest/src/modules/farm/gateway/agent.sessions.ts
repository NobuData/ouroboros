/**
 * The session registry — connection ↔ runner, and every frame the gateway still owes an agent.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). Two jobs, and the issue names
 * both:
 *
 *   * **Reach a specific runner.** Dispatch (AH.4, [#252](https://github.com/NobuData/ouroboros/issues/252))
 *     offers a job *to a runner*, and lifecycle actions (AH.6, [#254](https://github.com/NobuData/ouroboros/issues/254))
 *     drain one. {@link AgentSessions.offer} and {@link AgentSessions.push} are that reach, keyed
 *     by the workspace and the runner — never by a session id somebody could guess.
 *   * **Ordered delivery with resume.** Every frame the gateway writes into a session goes
 *     through its outbox, in order, and stays there until it is no longer owed: a receipt until
 *     it has been written, an offer until it is answered or has expired. A socket that dies with
 *     frames owed leaves the session *detached* for the resume window, and a `hello.resume`
 *     naming it gets them again, in the order they were first sent.
 *
 * ```
 * hello{resume: sess_A} ─▶ sess_A held, same runner, inside its window?
 *        yes ─▶ ack{resumed: true}  ─▶ replay the outbox in order ─▶ carry on
 *        no  ─▶ ack{resumed: false} on a fresh session; sess_A is discarded
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Resume is an optimisation of the session, never what makes delivery correct** — the
 * protocol's own sentence (§ 5). A terminal frame is exactly-once because of the ledger in
 * `gateway.repository.ts`, which does not know sessions exist; a receipt lost with a socket is
 * re-sent here on resume, and if the session did not survive the agent re-sends its frame and
 * is told `duplicate`. Either way one finished job.
 *
 * **Sessions live in this process.** A reconnect that lands on another replica gets
 * `resumed: false`, which the protocol is written to survive; and a drain issued on one replica
 * reaches an agent connected to another at its next heartbeat, because the heartbeat reconciles
 * the agent's state against `desired_state` in the database (`agent.connection.ts`). Nothing
 * here is the source of truth for anything the farm page renders.
 *
 * **One current session per runner.** A second connection from the same runner replaces the
 * first — the old socket is closed and its session discarded or, when it is the one being
 * resumed, taken over — so an agent that reconnected before its old socket noticed it was dead
 * is never talking on two.
 *
 * **Isolation is structural.** A `hello.resume` naming another runner's session — including one
 * in another workspace — is simply not resumable: the session is matched on workspace *and*
 * runner, both taken from the connection's proven identity, and the named session is left alone.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import {
  decode,
  encode,
  frame,
  type Envelope,
  type Frame,
  type MessageType,
} from "../protocol/protocol";
import type { JobCancelPayload, JobOfferPayload } from "../protocol/protocol.messages";
import { newPrefixedId, newUlid } from "../protocol/ulid";
import type { AgentSocket } from "./agent.socket";
import { GATEWAY_CLOCK, type GatewayClock } from "./gateway.clock";
import { GatewayMetrics } from "./gateway.metrics";
import { MAX_PENDING_FRAMES, OFFER_ACK_MS, RESUME_WINDOW_MS } from "./gateway.policy";
import type { TerminalRecord } from "./gateway.repository";

/** Why a frame is in an outbox, which decides when it stops being owed. */
export type OutboundKind = "offer" | "receipt" | "control";

/** One frame a session owes its agent. */
interface Outbound {
  readonly frame: Frame;
  readonly text: string;
  readonly kind: OutboundKind;
  /** For an offer: when it stops being answerable, in epoch milliseconds. */
  readonly expiresAt?: number;
}

/** Where an agent frame came from, as a listener is told. */
export interface FrameContext {
  readonly organizationId: string;
  readonly runnerId: string;
  readonly sessionId: string;
  /**
   * For a `job.finish`: what the ledger made of it — whether it was a duplicate, and whether it
   * finished a build. What lets a listener tell a completion from a re-send (AH.4, #252).
   */
  readonly terminal?: TerminalRecord;
}

/** Something that wants to hear about a type of agent frame — AH.4 for answers, AH.5 for logs. */
export type FrameListener<T extends MessageType = MessageType> = (
  context: FrameContext,
  envelope: Envelope<T>,
) => void | Promise<void>;

/**
 * Something that must see a terminal frame **before** it is recorded — AH.5's log tail (#253).
 *
 * A `job.finish` ends a job, and once the job reads as finished its log must already be final:
 * the live card stops polling when `live` goes false, and a tail recorded a moment later would
 * never be drawn. So a hook runs first, and the ledger and the job's terminal status commit after
 * it. It sees every copy of the frame, re-sends included, and must be idempotent against a job
 * that is already finished.
 */
export type TerminalHook = (
  context: FrameContext,
  envelope: Envelope<"job.finish">,
) => void | Promise<void>;

/** What {@link AgentSessions.open} answers. */
export interface OpenedSession {
  readonly session: AgentSession;
  /** Whether it is the session `hello.resume` named, still held. */
  readonly resumed: boolean;
}

/** One agent's session: its socket when it has one, and what it is still owed. */
export class AgentSession {
  /** The socket, while one is attached. */
  socket: AgentSocket | undefined;
  /** When the socket went, while the session waits out its resume window. */
  detachedAt: number | undefined;
  /** When the agent last beat — or said hello — in epoch milliseconds. */
  lastHeartbeatAt: number;
  /** The last drain or undrain this session told its agent, so a heartbeat does not repeat it. */
  lastControl: "drain" | "undrain" | undefined;
  /** Every frame still owed, in the order it was first sent. */
  readonly outbox: Outbound[] = [];
  /** The write chain: one frame at a time, so the order in the outbox is the order on the wire. */
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param id - `sess_…`.
   * @param organizationId - The workspace, from the connection's identity.
   * @param runnerId - The runner, from the same.
   * @param openedAt - When, in epoch milliseconds.
   * @param onSent - Told the type of each frame once it has been written.
   */
  constructor(
    readonly id: string,
    readonly organizationId: string,
    readonly runnerId: string,
    openedAt: number,
    private readonly onSent: (type: MessageType) => void,
  ) {
    this.lastHeartbeatAt = openedAt;
  }

  /** Whether a socket is attached. */
  get attached(): boolean {
    return this.socket !== undefined;
  }

  /**
   * Owe a frame, and write it if there is a socket to write it to.
   *
   * @param entry - The frame.
   */
  enqueue(entry: Outbound): void {
    this.outbox.push(entry);
    if (this.socket) this.transmit(entry, this.socket);
  }

  /**
   * Write everything still owed to the socket just attached, in order.
   *
   * @param now - Epoch milliseconds; offers that expired while nobody was listening are dropped
   *   rather than delivered unanswerable.
   */
  replay(now: number): void {
    this.dropExpired(now);

    const socket = this.socket;
    if (!socket) return;

    for (const entry of [...this.outbox]) this.transmit(entry, socket);
  }

  /**
   * Stop owing the frames that match.
   *
   * @param matches - Which.
   * @returns How many were dropped.
   */
  drop(matches: (entry: Outbound) => boolean): number {
    let dropped = 0;

    for (let i = this.outbox.length - 1; i >= 0; i -= 1) {
      if (matches(this.outbox[i])) {
        this.outbox.splice(i, 1);
        dropped += 1;
      }
    }

    return dropped;
  }

  /**
   * Stop owing offers nobody can answer any more.
   *
   * @param now - Epoch milliseconds.
   * @returns How many were dropped.
   */
  dropExpired(now: number): number {
    return this.drop((entry) => entry.expiresAt !== undefined && entry.expiresAt <= now);
  }

  /**
   * Resolves once every write already started has finished — for a caller that must know the
   * outbox has been flushed, and for a suite.
   *
   * @returns The chain's tail.
   */
  flushed(): Promise<void> {
    return this.chain;
  }

  /**
   * Put one frame on the write chain.
   *
   * A frame is written only if, when its turn comes, this socket is still the session's and the
   * frame is still owed — so a socket replaced mid-chain writes nothing more, and a frame settled
   * while waiting is not sent. A write that fails leaves the frame owed, for the next socket.
   *
   * @param entry - The frame.
   * @param socket - The socket it is for.
   */
  private transmit(entry: Outbound, socket: AgentSocket): void {
    this.chain = this.chain.then(async () => {
      if (this.socket !== socket || !socket.isOpen || !this.outbox.includes(entry)) return;

      try {
        await socket.send(entry.text);
      } catch {
        return;
      }

      this.onSent(entry.frame.type);

      // A receipt or a control frame is delivered once it is written; an offer is owed until
      // it is answered, because a socket that died after the write may have taken it along.
      if (entry.kind !== "offer") this.drop((candidate) => candidate === entry);
    });
  }
}

@Injectable()
export class AgentSessions {
  private readonly logger = new Logger(AgentSessions.name);
  /** Every session held, by id. */
  private readonly sessions = new Map<string, AgentSession>();
  /** Each runner's current session. */
  private readonly current = new Map<string, AgentSession>();
  /** Who wants to hear about which frames. */
  private readonly listeners = new Map<MessageType, Set<FrameListener>>();
  /** Who must see a terminal frame before it is recorded. */
  private readonly terminalHooks = new Set<TerminalHook>();

  /**
   * @param now - The clock.
   * @param metrics - The counters.
   */
  constructor(
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
    private readonly metrics: GatewayMetrics,
  ) {}

  /**
   * Open a session for a runner that has just said hello — resuming the one it named if that is
   * still held for it.
   *
   * @param organizationId - The workspace, from the connection's identity.
   * @param runnerId - The runner, from the same.
   * @param resume - `hello.resume`, if the agent sent one.
   * @returns The session, and whether it was resumed.
   */
  open(organizationId: string, runnerId: string, resume: string | undefined): OpenedSession {
    const at = this.now().getTime();
    const named = resume === undefined ? undefined : this.sessions.get(resume);
    const resumable =
      named !== undefined &&
      named.organizationId === organizationId &&
      named.runnerId === runnerId &&
      !this.lapsed(named, at)
        ? named
        : undefined;

    const previous = this.current.get(key(organizationId, runnerId));
    if (previous && previous !== resumable) this.discard(previous);

    if (resumable) {
      this.release(resumable);
      resumable.lastHeartbeatAt = at;

      return { session: resumable, resumed: true };
    }

    const session = new AgentSession(
      newPrefixedId("sess", at),
      organizationId,
      runnerId,
      at,
      (type) => this.metrics.frameSent(type),
    );
    this.sessions.set(session.id, session);
    this.current.set(key(organizationId, runnerId), session);

    return { session, resumed: false };
  }

  /**
   * Give a session its socket.
   *
   * Nothing is written: the connection writes its `ack` first and then calls {@link replay}, so
   * the ack is the first frame on the socket and what the session is owed follows it in its
   * original order. Attaching *before* the ack is what lets a socket that dies during the ack
   * detach the session properly, rather than leave it with neither a socket nor a window.
   *
   * @param session - The session.
   * @param socket - The socket.
   */
  attach(session: AgentSession, socket: AgentSocket): void {
    session.socket = socket;
    session.detachedAt = undefined;
  }

  /**
   * Write everything a session is owed to its socket, in the order it was first sent — the
   * resume half of ordered delivery.
   *
   * @param session - The session, attached.
   */
  replay(session: AgentSession): void {
    session.replay(this.now().getTime());
  }

  /**
   * A socket closed: its session waits out the resume window, unless something newer already
   * took it over.
   *
   * @param session - The session.
   * @param socket - The socket that closed.
   */
  detach(session: AgentSession, socket: AgentSocket): void {
    if (session.socket !== socket) return;

    session.socket = undefined;
    session.detachedAt = this.now().getTime();
  }

  /**
   * Forget a session — after an agent's `bye`, which means it is not coming back for it.
   *
   * @param session - The session.
   */
  end(session: AgentSession): void {
    session.socket = undefined;
    this.forget(session);
  }

  /**
   * A runner's current session.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The session, attached or waiting out its window, or `undefined`.
   */
  find(organizationId: string, runnerId: string): AgentSession | undefined {
    return this.current.get(key(organizationId, runnerId));
  }

  /**
   * Whether a runner has a socket to this process right now.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns Whether it is connected here.
   */
  isConnected(organizationId: string, runnerId: string): boolean {
    return this.find(organizationId, runnerId)?.attached ?? false;
  }

  /**
   * Owe a session a frame — a receipt or a control frame, written now if there is a socket and
   * replayed on resume if there is not.
   *
   * @param session - The session.
   * @param value - The frame.
   * @param kind - Why it is owed.
   */
  deliver(session: AgentSession, value: Frame, kind: Exclude<OutboundKind, "offer">): void {
    session.enqueue({ frame: value, text: encode(value), kind });
  }

  /**
   * Offer a job to a runner — AH.4's reach.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param payload - The offer. **Held to the contract before it is sent**: an offer this
   *   gateway wrote that the agent then refused as illegal would end the agent's session, so a
   *   payload the codec rejects is thrown back to its author instead.
   * @param id - The offer's envelope id — the id `job.accept` and `job.decline` will name. A
   *   caller that records the offer before sending it passes its own.
   * @returns The offer's envelope id, or `undefined` when the runner has no session here or the
   *   session already owes {@link MAX_PENDING_FRAMES} frames — in which case nothing was sent
   *   and the job is still the caller's to place.
   * @throws {TypeError} If the payload is not a legal `job.offer`.
   */
  offer(
    organizationId: string,
    runnerId: string,
    payload: JobOfferPayload,
    id: string = newUlid(),
  ): string | undefined {
    const value = frame("job.offer", payload, id);
    const text = encode(value);
    const judged = decode(text);

    if (!judged.envelope) {
      throw new TypeError(
        `refusing to send an illegal job.offer: ${judged.diagnostics.map((d) => `${d.code} at ${d.path}`).join(", ")}`,
      );
    }

    const session = this.find(organizationId, runnerId);
    if (!session || session.outbox.length >= MAX_PENDING_FRAMES) return undefined;

    const expires = Date.parse(payload.expires_at);
    session.enqueue({
      frame: value,
      text,
      kind: "offer",
      expiresAt: Number.isNaN(expires) ? this.now().getTime() + OFFER_ACK_MS : expires,
    });

    return id;
  }

  /**
   * Stop owing every unanswered offer of a job — it was cancelled, or taken back, before its
   * agent answered (AH.4, [#252](https://github.com/NobuData/ouroboros/issues/252)).
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner it was offered to.
   * @param job - The job's wire id, as the offer named it.
   * @returns How many offers were withdrawn. Zero when there were none, or no session here.
   */
  withdraw(organizationId: string, runnerId: string, job: string): number {
    const session = this.find(organizationId, runnerId);
    if (!session) return 0;

    return session.drop(
      (entry) =>
        entry.kind === "offer" && (entry.frame.payload as Partial<JobOfferPayload>).job === job,
    );
  }

  /**
   * Tell a runner to stop a job — AH.4's cancellation, propagated
   * ([#252](https://github.com/NobuData/ouroboros/issues/252)).
   *
   * A control frame: written now if the session has a socket, and replayed on resume if it does
   * not. A runner with no session here is told again when it next reports the job — the
   * dispatcher reconciles every `job.accept`, `job.start` and heartbeat against the job's row.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param payload - The cancel. **Held to the contract before it is sent**, for
   *   {@link offer}'s reason.
   * @returns Whether the runner has a session here to deliver it to.
   * @throws {TypeError} If the payload is not a legal `job.cancel`.
   */
  cancel(organizationId: string, runnerId: string, payload: JobCancelPayload): boolean {
    const value = frame("job.cancel", payload);
    const judged = decode(encode(value));

    if (!judged.envelope) {
      throw new TypeError(
        `refusing to send an illegal job.cancel: ${judged.diagnostics.map((d) => `${d.code} at ${d.path}`).join(", ")}`,
      );
    }

    const session = this.find(organizationId, runnerId);
    if (!session) return false;

    this.deliver(session, value, "control");

    return true;
  }

  /**
   * An offer was answered — accepted or declined — and is no longer owed.
   *
   * @param session - The session it was offered in.
   * @param offerId - The offer's envelope id, as the answer named it.
   * @returns Whether it was still owed. False for an answer to an offer already answered,
   *   expired, or never made in this session — which is what makes a second answer to one offer
   *   a no-op here.
   */
  settle(session: AgentSession, offerId: string): boolean {
    return session.drop((entry) => entry.kind === "offer" && entry.frame.id === offerId) > 0;
  }

  /**
   * Push a `drain` or `undrain` to a runner — AH.6's reach.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param value - The frame.
   * @returns Whether the runner has a session here to push it into. A detached session is owed
   *   it until it resumes; a runner with none will be told at its next hello or heartbeat, which
   *   reconcile against `desired_state`.
   */
  push(
    organizationId: string,
    runnerId: string,
    value: Frame<"drain"> | Frame<"undrain">,
  ): boolean {
    const session = this.find(organizationId, runnerId);
    if (!session) return false;

    session.lastControl = value.type === "drain" ? "drain" : "undrain";
    this.deliver(session, value, "control");

    return true;
  }

  /**
   * Hear about every agent frame of a type, after the gateway's own handling of it.
   *
   * @param type - Which frames.
   * @param listener - Called with where the frame came from and the frame. Its failure is
   *   logged and does not end the session — a listener's bug is not the agent's.
   * @returns A function that stops listening.
   */
  listen<T extends MessageType>(type: T, listener: FrameListener<T>): () => void {
    const set = this.listeners.get(type) ?? new Set<FrameListener>();
    set.add(listener as FrameListener);
    this.listeners.set(type, set);

    return () => {
      set.delete(listener as FrameListener);
    };
  }

  /**
   * See every `job.finish` before the gateway records it (#253).
   *
   * @param hook - Called with where the frame came from and the frame, and awaited before the
   *   ledger's transaction. Its failure is logged and never stops the frame being recorded — a
   *   hook's bug must not cost an agent its result.
   * @returns A function that stops the hook.
   */
  onTerminal(hook: TerminalHook): () => void {
    this.terminalHooks.add(hook);

    return () => {
      this.terminalHooks.delete(hook);
    };
  }

  /**
   * Run every terminal hook on a frame, in registration order — what the connection awaits before
   * it records a `job.finish`.
   *
   * @param context - Where the frame came from.
   * @param envelope - The frame.
   * @returns When every hook has finished.
   */
  async beforeTerminal(context: FrameContext, envelope: Envelope<"job.finish">): Promise<void> {
    for (const hook of this.terminalHooks) {
      try {
        await hook(context, envelope);
      } catch (error) {
        this.logger.error(
          "A job.finish hook failed; the frame is recorded anyway.",
          describeForLog(error),
        );
      }
    }
  }

  /**
   * Tell every listener of a frame's type about it.
   *
   * @param context - Where it came from.
   * @param envelope - The frame.
   * @returns When every listener has finished.
   */
  async notify(context: FrameContext, envelope: Envelope): Promise<void> {
    for (const listener of this.listeners.get(envelope.type) ?? []) {
      try {
        await listener(context, envelope);
      } catch (error) {
        this.logger.error(`A ${envelope.type} listener failed.`, describeForLog(error));
      }
    }
  }

  /**
   * Stop holding what can no longer be claimed: offers past their expiry, and sessions past
   * their resume window.
   *
   * @returns How many sessions expired.
   */
  expire(): number {
    const at = this.now().getTime();
    let expired = 0;

    for (const session of [...this.sessions.values()]) {
      session.dropExpired(at);

      if (this.lapsed(session, at)) {
        this.forget(session);
        expired += 1;
      }
    }

    if (expired > 0) this.metrics.sessionsExpired(expired);

    return expired;
  }

  /**
   * The attached sessions whose agent has not beaten since a cutoff.
   *
   * @param cutoff - Epoch milliseconds.
   * @returns The sessions.
   */
  stale(cutoff: number): AgentSession[] {
    return [...this.sessions.values()].filter(
      (session) => session.attached && session.lastHeartbeatAt < cutoff,
    );
  }

  /**
   * How many sessions are attached and detached, for the metrics snapshot.
   *
   * @returns The two gauges.
   */
  gauges(): { attached: number; detached: number } {
    let attached = 0;

    for (const session of this.sessions.values()) if (session.attached) attached += 1;

    return { attached, detached: this.sessions.size - attached };
  }

  /**
   * Close every session — the gateway is going away.
   *
   * @param bye - The `bye` to say to each agent, built per session so each can be given its own
   *   point in the reconnection spread.
   * @returns When every goodbye has been written or has failed.
   */
  async shutdown(bye: () => Frame<"bye">): Promise<void> {
    const sockets = [...this.sessions.values()].flatMap((session) =>
      session.socket ? [session.socket] : [],
    );

    this.sessions.clear();
    this.current.clear();

    await Promise.all(
      sockets.map(async (socket) => {
        const value = bye();

        try {
          await socket.send(encode(value));
          this.metrics.frameSent(value.type);
        } catch {
          // Already gone: there is nobody to say goodbye to.
        }

        socket.close(1001, "server shutdown");
      }),
    );
  }

  /**
   * Take a session's socket away from it — the socket a newer connection is replacing.
   *
   * @param session - The session.
   */
  private release(session: AgentSession): void {
    const socket = session.socket;
    if (!socket) return;

    session.socket = undefined;
    this.metrics.sessionReplaced();
    socket.close(1000, "replaced by a newer connection");
  }

  /**
   * Replace a runner's previous session with nothing: its socket is closed and what it owed is
   * dropped — an unanswered offer is AH.4's to re-dispatch when it expires.
   *
   * @param session - The session.
   */
  private discard(session: AgentSession): void {
    this.release(session);
    this.forget(session);
  }

  /**
   * Remove a session from both maps.
   *
   * @param session - The session.
   */
  private forget(session: AgentSession): void {
    this.sessions.delete(session.id);

    const runnerKey = key(session.organizationId, session.runnerId);
    if (this.current.get(runnerKey) === session) this.current.delete(runnerKey);
  }

  /**
   * Whether a session has outlived its resume window.
   *
   * @param session - The session.
   * @param at - Epoch milliseconds.
   * @returns True for a detached session detached longer than the window.
   */
  private lapsed(session: AgentSession, at: number): boolean {
    return session.detachedAt !== undefined && at - session.detachedAt > RESUME_WINDOW_MS;
  }
}

/**
 * A runner's key in {@link AgentSessions}' `current` map.
 *
 * @param organizationId - The workspace.
 * @param runnerId - The runner.
 * @returns A key no two runners share: JSON, so no separator can be forged by an id.
 */
function key(organizationId: string, runnerId: string): string {
  return JSON.stringify([organizationId, runnerId]);
}
