/**
 * A fake agent: a protocol-conformant, scriptable peer for the gateway's integration suites.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). The issue's first criterion is
 * that *the fake-agent contract suite passes in both directions*, and this is the smallest fake
 * agent that can hold the gateway to that — AH.7 ([#255](https://github.com/NobuData/ouroboros/issues/255))
 * is the ticket that grows it into the full misbehaving peer (log streaming, dying mid-job, a
 * stalled channel) for dispatch and log ingest, which do not exist yet.
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
 * It speaks through the forwarded-certificate header, because the suite's application is plain
 * HTTP behind no proxy — which is also the deployment `SECURITY_MODEL.md` § 7.6 documents.
 */

import { WebSocket } from "ws";

import { SENT_BY, decode, type Envelope, type MessageType } from "../protocol/protocol";
import { GATEWAY_PATH } from "./gateway.policy";
import { fixtureBytes } from "./gateway.fixture";

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
   */
  private constructor(private readonly socket: WebSocket) {
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
      socket.on("open", () => resolve(new FakeAgent(socket)));
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
