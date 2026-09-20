/**
 * A fake agent: a protocol-conformant, scriptable peer for the gateway's integration suites.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)) built the half that speaks the
 * handshake; AH.7 ([#255](https://github.com/NobuData/ouroboros/issues/255)) grew it into the
 * **misbehaving** peer the farm's failure modes need — log streaming, dying mid-job, a stalled
 * channel, a declined offer, a terminal frame delivered twice.
 *
 * **Both directions**, concretely:
 *
 *   * **agent → gateway**: it sends the golden fixtures' own bytes, and the gateway must accept
 *     them — a violation comes back as a `bye {reason: error}` and a 1002 close, which the suites
 *     assert never happens on a legal transcript.
 *   * **gateway → agent**: every frame it receives is judged exactly as the Go agent judges one —
 *     the codec, and the direction table — and a frame the contract refuses is recorded as a
 *     violation *here*, which the suites assert stays empty. A gateway that wrote an illegal
 *     `ack` fails its own suite before it fails a customer's agent.
 *
 * ---------------------------------------------------------------------------
 * **Every frame this class sends is a golden fixture with fields overwritten**, never an object
 * typed from memory — {@link scripted} is the one place that rule is enforced, and it is the
 * reason the scripted methods exist at all rather than each suite assembling payloads. A fake
 * agent whose frames were written from what their author remembered the protocol to be would
 * hold the gateway to that memory; one that starts from `schemas/runner-protocol/fixtures/` holds
 * it to the contract the Go agent is held to, which is the whole point of there being fixtures.
 *
 * ---------------------------------------------------------------------------
 * **The misbehaviour is the deliverable.** A peer that only behaves cannot reach the failure
 * modes distributed systems actually have, and none of them throws — they corrupt quietly:
 *
 *   * {@link drop} — the socket dying with no close, mid-job. The gateway never hears why.
 *   * {@link reconnect} — coming back and re-sending, which is what makes a terminal frame
 *     arrive twice.
 *   * {@link decline} — refusing work that must then go somewhere else rather than nowhere.
 *   * {@link chunk} — output at a sequence number of the caller's choosing, which is how
 *     arrival gets to disagree with production.
 *
 * Two misbehaviours this class deliberately does *not* model. A peer that is **wedged** rather
 * than gone — socket open, the gateway's writes landing, nothing coming back — is {@link quiet},
 * which consumes what arrives and answers none of it; it needs no method of its own. And a peer
 * that **outruns the log cap** is a `log.chunk` run with `dropped_bytes` set, which
 * `../logs/logs.integration-spec.ts` builds directly and asserts far more precisely than a
 * helper here could — the elision at its exact offset, and the server's cap and the agent's own
 * tail as one figure. A second, weaker version of that assertion is worth less than none.
 *
 * It speaks through the forwarded-certificate header, because the suite's application is plain
 * HTTP behind no proxy — which is also the deployment `SECURITY_MODEL.md` § 7.6 documents.
 */

import { WebSocket } from "ws";

import { SENT_BY, decode, type Envelope, type MessageType } from "../protocol/protocol";
import type { AgentState, ByeReason, DeclineReason, Outcome } from "../protocol/protocol.messages";
import { newUlid, wireId } from "../protocol/ulid";
import { GATEWAY_PATH } from "./gateway.policy";
import { fixtureBytes, fixtureFrame } from "./gateway.fixture";

/** How a fake agent authenticates its upgrade. */
export interface Credentials {
  /** A client certificate, forwarded in `header` as a proxy would. */
  readonly certificate?: string;
  /** The header the application trusts a proxy to forward it in. */
  readonly header?: string;
  /** A bearer-fallback secret, sent in `Authorization` on the upgrade. */
  readonly bearer?: string;
}

/** An upgrade the gateway refused. */
export interface RefusedUpgrade {
  readonly refused: true;
  readonly status: number;
  readonly code: string;
}

/** How long a suite waits for a frame before failing, rather than for Jest's own timeout. */
const WAIT_MS = 5_000;

export class FakeAgent {
  /** Every frame the gateway sent, in order, judged. */
  readonly received: Envelope[] = [];
  /** Every gateway frame the contract refuses — an illegal frame, or one from the wrong end. */
  readonly violations: string[] = [];
  /** Resolves with the close code once the socket has closed. */
  readonly closed: Promise<number>;
  private cursor = 0;
  private readonly waiters = new Set<() => void>();

  /**
   * @param socket - The open socket.
   * @param baseUrl - Where it was dialled, so {@link reconnect} can dial it again.
   * @param credentials - What was presented, for the same reason.
   */
  private constructor(
    private readonly socket: WebSocket,
    private readonly baseUrl: string,
    private readonly credentials: Credentials,
  ) {
    socket.on("message", (data: Buffer, isBinary: boolean) => this.judge(data, isBinary));
    this.closed = new Promise((resolve) => socket.on("close", (code) => resolve(code)));
    socket.on("close", () => this.wake());
  }

  /**
   * Dial the gateway.
   *
   * @param baseUrl - The application's `http://host:port`.
   * @param credentials - What to present.
   * @returns The agent, connected — or the refusal, when the upgrade was answered with an error.
   */
  static connect(baseUrl: string, credentials: Credentials): Promise<FakeAgent | RefusedUpgrade> {
    const headers: Record<string, string> = {};

    if (credentials.certificate && credentials.header) {
      // nginx's `$ssl_client_escaped_cert` — percent-encoded PEM.
      headers[credentials.header] = encodeURIComponent(credentials.certificate);
    }
    if (credentials.bearer) headers.authorization = `Bearer ${credentials.bearer}`;

    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}${GATEWAY_PATH}`, { headers });

    return new Promise((resolve, reject) => {
      socket.on("open", () => resolve(new FakeAgent(socket, baseUrl, credentials)));
      socket.on("error", (error) => reject(error));
      socket.on("unexpected-response", (_request, response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        response.on("end", () => {
          const body = JSON.parse(text || "{}") as { code?: string };
          resolve({ refused: true, status: response.statusCode ?? 0, code: body.code ?? "" });
        });
      });
    });
  }

  /**
   * Send a frame as text — one JSON object per text frame, as the protocol requires.
   *
   * @param value - A fixture's path under `fixtures/`, or a frame object.
   */
  send(value: string | object): void {
    const text =
      typeof value === "string" ? fixtureBytes(value).toString("utf8") : JSON.stringify(value);

    this.socket.send(text);
  }

  /**
   * The next frame the gateway sends, optionally of one type — frames of other types before it
   * are consumed.
   *
   * @param type - Which type to wait for, or any.
   * @returns The frame.
   * @throws {Error} If none arrives within {@link WAIT_MS}, or the socket closes first.
   */
  async next<T extends MessageType>(type?: T): Promise<Envelope<T>> {
    const deadline = Date.now() + WAIT_MS;

    for (;;) {
      while (this.cursor < this.received.length) {
        const envelope = this.received[this.cursor];
        this.cursor += 1;
        if (!type || envelope.type === type) return envelope as Envelope<T>;
      }

      if (this.socket.readyState === WebSocket.CLOSED) {
        throw new Error(`the socket closed before a ${type ?? "frame"} arrived`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `no ${type ?? "frame"} within ${String(WAIT_MS)}ms; received ${this.received.map((e) => e.type).join(", ")}`,
        );
      }

      await new Promise<void>((resolve) => {
        const wake = (): void => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 50);
      });
    }
  }

  /**
   * Whether no frame beyond those already consumed arrives within a while — for asserting that
   * the gateway said nothing.
   *
   * @param ms - How long to listen.
   * @returns The frames that did arrive, which a suite expects to be none.
   */
  async quiet(ms = 300): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const extra = this.received.slice(this.cursor);
    this.cursor = this.received.length;

    return extra;
  }

  /** The orderly close from this end. */
  close(): void {
    this.socket.close(1000);
  }

  /**
   * The socket dying without a close — a network drop, or a machine losing power. Nothing more
   * is read, so a frame the gateway was about to answer is never answered here.
   */
  drop(): void {
    this.socket.terminate();
  }

  // -------------------------------------------------------------------------
  // The scripted peer (AH.7, #255)
  //
  // Everything below builds its frame with `scripted`, which starts from a golden fixture.
  // What each method adds is the part a running system decides — the ids, the job it is
  // about, the timestamps — and nothing else.
  // -------------------------------------------------------------------------

  /**
   * Say hello and wait to be let in.
   *
   * @param overrides - Payload fields to change — `capabilities`, `pool`, `resume` and the rest.
   * @returns The `ack`, which carries the session id and the limits this session runs under.
   * @throws {Error} If the gateway refuses, so a suite that expected admission fails on the
   *   refusal rather than on the timeout that follows it.
   */
  async hello(overrides: Record<string, unknown> = {}): Promise<Envelope<"ack">> {
    this.send(this.scripted("valid/hello.json", overrides));

    const answer = await this.next();
    if (answer.type !== "ack") {
      throw new Error(`the gateway answered hello with ${answer.type}: ${JSON.stringify(answer)}`);
    }

    return answer as Envelope<"ack">;
  }

  /**
   * Report in.
   *
   * `sent_at` is stamped here rather than taken from the fixture, because presence is judged
   * against it: a heartbeat carrying the fixture's frozen timestamp would arrive already
   * older than the offline threshold.
   *
   * @param overrides - Payload fields to change — `state`, `queue_depth`, `job`, telemetry.
   */
  heartbeat(overrides: Record<string, unknown> = {}): void {
    this.send(
      this.scripted("valid/heartbeat.json", { sent_at: new Date().toISOString(), ...overrides }),
    );
  }

  /**
   * Report in as a particular state — the shorthand a dispatch case reads better with.
   *
   * @param state - Idle, busy or draining.
   * @param queueDepth - How many jobs this agent believes it holds.
   */
  beat(state: AgentState, queueDepth = 0): void {
    this.heartbeat({ state, queue_depth: queueDepth });
  }

  /**
   * Take an offer.
   *
   * @param offer - The offer being answered.
   */
  accept(offer: Envelope<"job.offer">): void {
    this.send(this.scripted("valid/job-accept.json", { job: offer.payload.job, offer: offer.id }));
  }

  /**
   * Refuse an offer, which must then go somewhere else rather than nowhere.
   *
   * @param offer - The offer being answered.
   * @param reason - Why, from the contract's vocabulary.
   * @param detail - The human half.
   */
  decline(offer: Envelope<"job.offer">, reason: DeclineReason = "busy", detail = "full up"): void {
    this.send(
      this.scripted("valid/job-decline.json", {
        job: offer.payload.job,
        offer: offer.id,
        reason,
        detail,
      }),
    );
  }

  /**
   * Begin the work.
   *
   * @param offer - The offer this attempt is of; its `attempt` and `executor` are carried over,
   *   because a `job.start` that disagreed with its offer about either would be a different
   *   attempt of a different job.
   * @param overrides - Payload fields to change.
   */
  start(offer: Envelope<"job.offer">, overrides: Record<string, unknown> = {}): void {
    this.send(
      this.scripted("valid/job-start.json", {
        job: offer.payload.job,
        attempt: offer.payload.attempt ?? 1,
        executor: offer.payload.executor,
        started_at: new Date().toISOString(),
        ...overrides,
      }),
    );
  }

  /**
   * One `log.chunk`, at a sequence number this caller chooses.
   *
   * The seq is explicit rather than counted here, because the cases worth writing are the ones
   * where it is *not* the next number — a chunk overtaking another in flight, a gap the agent
   * declares with `dropped_bytes`, a re-send after a reconnect.
   *
   * @param job - The job's wire id, or the `build_jobs` UUID, which is converted.
   * @param seq - Its sequence number, 0-based and contiguous per job.
   * @param data - The bytes, which are base64-encoded here.
   * @param overrides - Payload fields to change — `stream`, `dropped_bytes`.
   */
  chunk(
    job: string,
    seq: number,
    data: Buffer | string,
    overrides: Record<string, unknown> = {},
  ): void {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;

    this.send(
      this.scripted("valid/log-chunk.json", {
        job: asJobId(job),
        seq,
        data: bytes.toString("base64"),
        dropped_bytes: 0,
        ...overrides,
      }),
    );
  }

  /**
   * A job's output, as a run of chunks.
   *
   * @param job - The job's wire id or UUID.
   * @param parts - The pieces, in the order they were produced — which is the order their
   *   sequence numbers are assigned in, whatever order they are then sent in.
   * @param options - `startSeq` to begin past zero (a re-send after a reconnect), and `order`
   *   to send them in a permutation of their own indices, which is how arrival gets to
   *   disagree with production.
   */
  stream(
    job: string,
    parts: readonly (Buffer | string)[],
    options: { startSeq?: number; order?: readonly number[] } = {},
  ): void {
    const startSeq = options.startSeq ?? 0;
    const order = options.order ?? parts.map((_part, index) => index);

    if (order.length !== parts.length || new Set(order).size !== parts.length) {
      throw new Error(`order must be a permutation of the ${String(parts.length)} parts`);
    }

    for (const index of order) this.chunk(job, startSeq + index, parts[index]);
  }

  /**
   * End the job, and wait to be told the gateway has it.
   *
   * @param offer - The offer this attempt is of.
   * @param outcome - How it ended.
   * @param options - `exitCode` (null only where the contract allows it), the `log` counters the
   *   agent believes it shipped, `error` for an infrastructure failure, and `ccache`.
   * @returns The `receipt`, whose `duplicate` is the gateway's answer to whether it had already
   *   applied this exact frame.
   */
  async finish(
    offer: Envelope<"job.offer">,
    outcome: Outcome = "succeeded",
    options: {
      exitCode?: number | null;
      log?: { bytes?: number; chunks?: number; dropped_bytes?: number };
      error?: { code: string; detail: string } | null;
      ccache?: Record<string, number> | null;
    } = {},
  ): Promise<Envelope<"receipt">> {
    this.send(this.terminal(offer, outcome, options));

    return this.next("receipt");
  }

  /**
   * The same terminal frame, built but not sent — so a suite can send it twice, byte for byte,
   * which is the only honest way to ask whether it applies once.
   *
   * @param offer - The offer this attempt is of.
   * @param outcome - How it ended.
   * @param options - As {@link finish}.
   * @returns The frame.
   */
  terminal(
    offer: Envelope<"job.offer">,
    outcome: Outcome = "succeeded",
    options: {
      exitCode?: number | null;
      log?: { bytes?: number; chunks?: number; dropped_bytes?: number };
      error?: { code: string; detail: string } | null;
      ccache?: Record<string, number> | null;
    } = {},
  ): object {
    const at = new Date().toISOString();

    return this.scripted("valid/job-finish.json", {
      job: offer.payload.job,
      attempt: offer.payload.attempt ?? 1,
      outcome,
      exit_code: options.exitCode === undefined ? 0 : options.exitCode,
      started_at: at,
      finished_at: at,
      log: { bytes: 0, chunks: 0, dropped_bytes: 0, ...options.log },
      error: options.error ?? null,
      ccache: options.ccache ?? null,
    });
  }

  /**
   * The orderly goodbye, which the gateway is entitled to treat as "gone on purpose".
   *
   * @param reason - Why.
   */
  bye(reason: ByeReason = "shutdown"): void {
    this.send(this.scripted("valid/bye.json", { reason, detail: reason }));
  }

  /**
   * Die, and come back on a new socket with the same credentials.
   *
   * This is the shape of every duplicate-delivery case: the agent never heard the receipt, so
   * on the new session it re-sends what it has. The old instance is finished — its socket is
   * gone — and the caller keeps the returned one.
   *
   * @param resume - The session id to ask for, from the previous `ack`. Omitted, the gateway
   *   sees a fresh agent, which is the case where the ledger rather than the session has to be
   *   what deduplicates.
   * @returns The new agent, connected but not yet greeted.
   * @throws {Error} If the gateway refuses the upgrade.
   */
  async reconnect(resume?: string): Promise<FakeAgent> {
    this.drop();
    await this.closed;

    const next = await FakeAgent.connect(this.baseUrl, this.credentials);
    if (isRefused(next)) {
      throw new Error(`refused on reconnect: ${String(next.status)} ${next.code}`);
    }

    if (resume !== undefined) await next.hello({ resume });

    return next;
  }

  /**
   * A golden fixture with fields overwritten and a fresh envelope id.
   *
   * The id is always new, because two frames sharing one id is exactly what the terminal ledger
   * deduplicates on — a helper that reused the fixture's id would make every frame look like a
   * re-send of the last one.
   *
   * @param fixture - Its path under `fixtures/`.
   * @param payload - The payload fields to overwrite.
   * @returns The frame.
   */
  private scripted(fixture: string, payload: Record<string, unknown>): object {
    const value = fixtureFrame(fixture);

    value.id = newUlid();
    Object.assign(value.payload, payload);

    return value;
  }

  /**
   * Judge one frame from the gateway the way the Go agent does.
   *
   * @param data - Its bytes.
   * @param isBinary - Whether it was a binary frame.
   */
  private judge(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      this.violations.push("a binary frame");
    } else {
      const decoded = decode(data);

      if (!decoded.envelope) {
        this.violations.push(`an illegal frame: ${JSON.stringify(decoded.diagnostics)}`);
      } else if (!SENT_BY[decoded.envelope.type].includes("server")) {
        this.violations.push(`${decoded.envelope.type} is not the gateway's to send`);
      } else {
        this.received.push(decoded.envelope);
      }
    }

    this.wake();
  }

  /** Wake every `next` waiting for a frame. */
  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

/**
 * Whether a connection attempt was refused.
 *
 * @param agent - What {@link FakeAgent.connect} answered.
 * @returns True for a refusal.
 */
export function isRefused(agent: FakeAgent | RefusedUpgrade): agent is RefusedUpgrade {
  return "refused" in agent;
}

/**
 * A job as the wire spells it, from either spelling.
 *
 * Suites hold `build_jobs.id` — a UUID — because that is what they inserted and what they read
 * rows back by, while the protocol carries `job_…`. Converting at this boundary is what keeps
 * `wireId` out of every call site, and a value that is already a wire id passes through so that
 * an id taken from an offer can be handed straight back.
 *
 * @param job - A `job_…` wire id, or a `build_jobs` UUID.
 * @returns The wire id.
 */
function asJobId(job: string): string {
  return job.startsWith("job_") ? job : wireId("job", job);
}
