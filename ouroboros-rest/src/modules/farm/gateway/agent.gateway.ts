/**
 * `wss://<control plane>/api/v1/farm/agent` — the farm's nervous system.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240): the server half of the runner
 * protocol ([`docs/RUNNER_PROTOCOL.md`](../../../../../docs/RUNNER_PROTOCOL.md), AG.1 #243), against
 * which the Go agent's connection loop (AG.2, #244) is written.
 *
 * ```
 * agent ──wss:// 443 + client cert──▶ [proxy: MUST pass the cert through] ──▶ HTTP upgrade
 *                                                                               │
 *   this file: path? · authenticate (transport.ts) ── refused ─▶ 401 {code, message, details}
 *                                                    └─ ok ────▶ ws upgrade ─▶ AgentConnection
 * ```
 *
 * ---------------------------------------------------------------------------
 * **A Nest provider holding a `ws` server, rather than `@nestjs/websockets`' `@WebSocketGateway`.**
 * Three things this gateway must do are things that abstraction is shaped against:
 *
 *   1. **Refuse before upgrading, in the service's own error envelope.** A revoked certificate
 *      and a missing one are answered with AH.2's `401 farm_identity_refused` and
 *      `401 farm_client_certificate_required` on the upgrade request itself — codes the Go agent
 *      already reads as *stop* and *fix the proxy*. That needs the `upgrade` event, before any
 *      socket exists.
 *   2. **Speak `{v, type, id, payload}`, one frame at a time, in order.** Nest's adapter routes
 *      `{event, data}` messages to handlers concurrently; the protocol's frames are neither.
 *   3. **Exist only when there is an HTTP server.** An adapter is process-global, and a suite
 *      that compiles `AppModule` without one would fail on a driver nobody asked for.
 *
 * It is still a gateway in Nest's sense — injected, with lifecycle hooks — and `ws` is the
 * library the issue names. `maxPayload` is the protocol's frame ceiling, so a frame over 64 KiB
 * is refused by the transport without being buffered, let alone parsed.
 *
 * ---------------------------------------------------------------------------
 * **The deployment note that makes or breaks the security model** (decision **B3**,
 * `SECURITY_MODEL.md` § 7.6): a reverse proxy that terminates TLS and does not pass the client
 * certificate through leaves every agent connecting with no certificate at all. That connection
 * is **refused** here — never accepted as ordinary TLS — and because the failure is otherwise
 * silent, the first such refusal is also *logged* with what it most likely means and where the fix
 * is documented, and every one is counted in `refused.no_certificate`.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

import { AppConfigService } from "../../config/config.service";
import { NotFoundError, type DomainError, type ErrorEnvelope } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { ENVELOPE_MAX_BYTES, frame } from "../protocol/protocol";
import { AgentConnection } from "./agent.connection";
import { AgentSessions } from "./agent.sessions";
import { wsSocket } from "./agent.socket";
import { GATEWAY_CLOCK, type GatewayClock } from "./gateway.clock";
import { GatewayMetrics } from "./gateway.metrics";
import { GATEWAY_PATH, SHUTDOWN_RECONNECT_SPREAD_MS } from "./gateway.policy";
import { AgentGatewayRepository } from "./gateway.repository";
import type { VersionPolicy } from "./hello";
import { TransportAuthenticator, isRefusal, type Transport } from "./transport";

/** The injection token for the version policy — built from configuration in the module. */
export const VERSION_POLICY = Symbol("VERSION_POLICY");

@Injectable()
export class AgentGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AgentGateway.name);
  private server: WebSocketServer | undefined;
  private http: Server | undefined;
  private readonly connections = new Set<AgentConnection>();
  /** Whether the stripping-proxy warning has been logged — once per process is enough to act on. */
  private warnedNoCertificate = false;

  /**
   * @param adapterHost - Where the HTTP server is, when there is one.
   * @param authenticator - Who is on the other end of an upgrade.
   * @param sessions - The session registry.
   * @param repository - The gateway's statements.
   * @param metrics - The counters.
   * @param config - Which header a trusted proxy forwards a certificate in, for the warning.
   * @param policy - Which protocol lines and agent versions are accepted.
   * @param now - The clock.
   */
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authenticator: TransportAuthenticator,
    private readonly sessions: AgentSessions,
    private readonly repository: AgentGatewayRepository,
    private readonly metrics: GatewayMetrics,
    private readonly config: AppConfigService,
    @Inject(VERSION_POLICY) private readonly policy: VersionPolicy,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /**
   * Start answering upgrades on the application's own HTTP server.
   *
   * `onApplicationBootstrap` runs before `listen()` binds the port, so no upgrade can arrive
   * before this is listening for it. A module compiled without an HTTP adapter — a suite that
   * only wants the injector — gets no gateway, and needs none.
   */
  onApplicationBootstrap(): void {
    const http = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!http) return;

    this.http = http;
    this.server = new WebSocketServer({ noServer: true, maxPayload: ENVELOPE_MAX_BYTES });
    http.on("upgrade", this.onUpgrade);
  }

  /**
   * Say goodbye to every agent, with a reconnection spread, and stop.
   *
   * @returns When every connection has been told and the server closed.
   */
  async onApplicationShutdown(): Promise<void> {
    this.http?.off("upgrade", this.onUpgrade);

    await this.sessions.shutdown(() =>
      frame("bye", {
        reason: "server_shutdown",
        detail: "the control plane is restarting; reconnect after the delay given",
        reconnect_after_ms: spread(),
      }),
    );

    for (const connection of this.connections) connection.closed();
    this.connections.clear();

    const server = this.server;
    this.server = undefined;
    if (server) {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /**
   * The HTTP server's `upgrade` event. An arrow so it can be removed again by identity.
   *
   * @param request - The upgrade request.
   * @param socket - Its socket.
   * @param head - Any bytes already read past the request.
   */
  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // A socket that errors while this is still deciding — the agent gave up, a reset — must not
    // become an unhandled error that takes the process with it.
    socket.on("error", () => socket.destroy());

    void this.upgrade(request, socket, head).catch((error: unknown) => {
      this.logger.error("An agent upgrade failed.", describeForLog(error));
      reject(socket, 500, {
        code: "internal_error",
        message: "The gateway could not complete the connection.",
        details: {},
      });
    });
  };

  /**
   * Decide an upgrade.
   *
   * @param request - The upgrade request.
   * @param socket - Its socket.
   * @param head - Any bytes already read past the request.
   * @returns When it has been refused or handed to `ws`.
   */
  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const server = this.server;
    if (!server) {
      socket.destroy();
      return;
    }

    if (pathOf(request) !== GATEWAY_PATH) {
      // Nothing else in this service upgrades; a path that is not the gateway's is a 404 rather
      // than a hung socket. Another listener, if one is ever added, is left to answer its own.
      if ((this.http?.listenerCount("upgrade") ?? 0) <= 1) {
        refuse(
          socket,
          new NotFoundError("not_found", "There is nothing to upgrade to at this path."),
        );
      }
      return;
    }

    const verdict = await this.authenticator.authenticate(request);

    if (isRefusal(verdict)) {
      this.metrics.connectionRefused(verdict.reason);
      if (verdict.reason === "no_certificate") this.warnNoCertificate(request);
      refuse(socket, verdict.error);
      return;
    }

    server.handleUpgrade(request, socket, head, (ws) => this.accept(ws, verdict));
  }

  /**
   * An upgraded, authenticated connection: hand it to its protocol.
   *
   * @param ws - The socket.
   * @param transport - Who it proved it is.
   */
  private accept(ws: WebSocket, transport: Transport): void {
    this.metrics.connectionOpened();

    const connection = new AgentConnection(wsSocket(ws), transport, {
      sessions: this.sessions,
      repository: this.repository,
      metrics: this.metrics,
      policy: this.policy,
      now: this.now,
    });
    this.connections.add(connection);

    ws.on("message", (data: Buffer, isBinary: boolean) => connection.receive(data, isBinary));
    ws.on("error", (error) => {
      this.logger.warn(`An agent socket failed: ${error.message}`);
    });
    ws.on("close", () => {
      connection.closed();
      this.connections.delete(connection);
      this.metrics.connectionClosed();
    });
  }

  /**
   * Log, once per process, what a connection with no certificate most likely means.
   *
   * This is the *detectable* half of the issue's deployment criterion: a stripping proxy does not
   * fail, it just produces connections with no certificate, and a refusal nobody reads the reason
   * for looks like a broken agent. The sentence names which of the two deployments this process
   * is in, because the fix differs.
   *
   * @param request - The refused upgrade.
   */
  private warnNoCertificate(request: IncomingMessage): void {
    if (this.warnedNoCertificate) return;
    this.warnedNoCertificate = true;

    const header = this.config.farmClientCertHeader;
    const overTls = "encrypted" in request.socket && request.socket.encrypted === true;

    this.logger.warn(
      header
        ? `Refused an agent connection that carried no client certificate: the ${header} header ` +
            "OURO_FARM_CLIENT_CERT_HEADER names was absent. The proxy in front of this service is " +
            "not forwarding runner certificates — see docs/SECURITY_MODEL.md § 7.6."
        : overTls
          ? "Refused an agent connection that presented no client certificate over TLS. The agent " +
            "is not presenting one, or something in between is re-terminating TLS."
          : "Refused an agent connection that presented no client certificate. This service is not " +
            "terminating TLS and OURO_FARM_CLIENT_CERT_HEADER is unset, so a TLS-terminating proxy " +
            "in front of it is consuming runner certificates without passing them through — see " +
            "docs/SECURITY_MODEL.md § 7.6. Every agent connection will be refused until it does.",
    );
  }
}

/**
 * The path an upgrade request asked for, without its query.
 *
 * @param request - The upgrade request.
 * @returns The path.
 */
function pathOf(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://gateway.invalid").pathname;
  } catch {
    return "";
  }
}

/**
 * Answer an upgrade with a `DomainError`, as every other route in this service answers one.
 *
 * @param socket - The socket.
 * @param error - The error.
 */
function refuse(socket: Duplex, error: DomainError): void {
  reject(socket, error.getStatus(), error.envelope());
}

/**
 * Write an HTTP response to a socket that was asking to be upgraded, and close it.
 *
 * @param socket - The socket.
 * @param status - The HTTP status.
 * @param body - The error envelope.
 */
function reject(socket: Duplex, status: number, body: ErrorEnvelope): void {
  if (socket.destroyed) return;

  const json = JSON.stringify(body);

  socket.end(
    `HTTP/1.1 ${String(status)} ${STATUS_CODES[status] ?? "Error"}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${String(Buffer.byteLength(json))}\r\n` +
      "Connection: close\r\n" +
      "\r\n" +
      json,
  );
}

/**
 * A point in the shutdown reconnection spread.
 *
 * @returns Milliseconds, uniformly inside {@link SHUTDOWN_RECONNECT_SPREAD_MS}.
 */
function spread(): number {
  const { min, max } = SHUTDOWN_RECONNECT_SPREAD_MS;
  return min + Math.floor(Math.random() * (max - min));
}
