/**
 * Socket Mode — the development transport (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535), decision **C1**).
 *
 * A local stack has no public URL for Slack to call. With `OURO_SLACK_SOCKET_MODE=true` this
 * service opens a WebSocket to Slack instead and receives the same three kinds of request over
 * it — events, slash commands, interactivity — which it hands to the very handlers the HTTPS
 * endpoints use (`slack.inbound.service.ts`).
 *
 * **Development only, and the difference is not hidden.** Configuration refuses it in
 * production (`config/configuration.ts`): requests arriving over the socket are authenticated
 * by the app-level token that opened it, not by a signature, and one process holds the
 * connection. HTTPS with signature verification is the one supported production path.
 *
 * ```
 * apps.connections.open (xapp token) ─▶ wss URL ─▶ connect
 *   envelope {envelope_id, type, payload} ─▶ ack {envelope_id[, payload]} ─▶ handler
 *   {type: disconnect} or close ─▶ reconnect, backing off
 * ```
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import { WebSocket } from "ws";

import { AppConfigService } from "../config/config.service";
import { SLACK_API, type SlackApi } from "./slack.client";
import { SlackInboundService } from "./slack.inbound.service";

/** The first wait before reconnecting, and the longest. */
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/** The part of a WebSocket this transport uses — what a test's fake implements. */
export interface SlackSocket {
  on(event: "message", listener: (data: { toString(): string }) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
  send(data: string): unknown;
  close(): unknown;
}

/** Opens a socket to a URL. */
export type SlackSocketFactory = (url: string) => SlackSocket;

/** The injection token for {@link SlackSocketFactory}. */
export const SLACK_SOCKET_FACTORY = Symbol("SLACK_SOCKET_FACTORY");

/**
 * What an envelope is acknowledged with, and the work it starts.
 *
 * @param inbound - The handlers.
 * @param envelope - One message from the socket, parsed.
 * @returns The acknowledgement to send back, or `undefined` for a message that is not an
 *   envelope (a `hello`, or something unrecognised).
 */
export function acknowledge(
  inbound: Pick<SlackInboundService, "event" | "command" | "interaction">,
  envelope: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const { envelope_id: id, type, payload } = envelope;

  if (typeof id !== "string") {
    return undefined;
  }

  switch (type) {
    case "events_api":
      inbound.event(payload);

      return { envelope_id: id };
    case "slash_commands":
      // The acknowledgement carries the reply Slack shows at once, as the HTTP response does.
      return { envelope_id: id, payload: inbound.command(payload) };
    case "interactive":
      inbound.interaction(payload);

      return { envelope_id: id };
    default:
      // Acknowledged so Slack does not redeliver something this version does not know.
      return { envelope_id: id };
  }
}

@Injectable()
export class SlackSocketMode implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SlackSocketMode.name);

  private socket: SlackSocket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private attempt = 0;

  /**
   * @param config - Whether Socket Mode is on, and the app-level token.
   * @param slack - Opens the connection.
   * @param inbound - The handlers every request is given to.
   * @param factory - Opens a socket; the `ws` client by default.
   */
  constructor(
    private readonly config: AppConfigService,
    @Inject(SLACK_API) private readonly slack: SlackApi,
    private readonly inbound: SlackInboundService,
    @Optional()
    @Inject(SLACK_SOCKET_FACTORY)
    private readonly factory: SlackSocketFactory = (url) => new WebSocket(url),
  ) {}

  /** Connect, when the deployment turned Socket Mode on. */
  onApplicationBootstrap(): void {
    if (this.config.slackSocketMode) {
      this.logger.warn(
        "Slack Socket Mode is on — a development transport. Production uses the signed HTTPS endpoints.",
      );
      void this.connect();
    }
  }

  /** Close the socket and stop reconnecting. */
  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  /**
   * Open one connection. Never rejects: a failure schedules the next attempt.
   *
   * @returns When the socket is open, or the attempt has failed and a retry is scheduled.
   */
  async connect(): Promise<void> {
    const appToken = this.config.slackAppToken;

    if (this.stopped || appToken === undefined) {
      return;
    }

    const opened = await this.slack.openSocket(appToken);

    if (!opened.ok) {
      this.logger.warn(`Slack did not open a Socket Mode connection: ${opened.error}`);
      this.retry();

      return;
    }

    const socket = this.factory(opened.url);

    this.socket = socket;
    socket.on("message", (data) => this.receive(socket, data.toString()));
    // An `error` is always followed by a `close`; reconnecting on both would double up.
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = undefined;
        this.retry();
      }
    });
  }

  /**
   * One message from the socket.
   *
   * @param socket - The socket it arrived on, which the acknowledgement goes back over.
   * @param raw - The message text.
   */
  private receive(socket: SlackSocket, raw: string): void {
    let message: unknown;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof message !== "object" || message === null) {
      return;
    }

    const envelope = message as Record<string, unknown>;

    if (envelope.type === "hello") {
      this.attempt = 0;

      return;
    }
    // Slack is rotating the connection: close this one, and the close handler reconnects.
    if (envelope.type === "disconnect") {
      socket.close();

      return;
    }

    const ack = acknowledge(this.inbound, envelope);

    if (ack !== undefined) {
      socket.send(JSON.stringify(ack));
    }
  }

  /** Schedule the next connection attempt, backing off to {@link RECONNECT_MAX_MS}. */
  private retry(): void {
    if (this.stopped) {
      return;
    }

    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempt);

    this.attempt += 1;
    this.timer = setTimeout(() => void this.connect(), delay);
    this.timer.unref();
  }
}
