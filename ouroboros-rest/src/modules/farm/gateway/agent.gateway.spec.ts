import { Logger } from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

import type { AppConfigService } from "../../config/config.service";
import { clientCertificateRequired, identityRefused } from "../farm.errors";
import { runner } from "../farm.fixture";
import { ENVELOPE_MAX_BYTES, decode, type Envelope } from "../protocol/protocol";
import { AgentGateway } from "./agent.gateway";
import { AgentSessions } from "./agent.sessions";
import { fixtureBytes } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import { GATEWAY_PATH, SHUTDOWN_RECONNECT_SPREAD_MS } from "./gateway.policy";
import type { AgentGatewayRepository } from "./gateway.repository";
import { DEFAULT_VERSION_POLICY } from "./hello";
import type { Transport, TransportAuthenticator, TransportRefusal } from "./transport";

/**
 * The socket half of the gateway, over a real HTTP server and a real `ws` client — with the
 * authentication and the database stood in for, so each of the upgrade's answers can be asked
 * for directly. `agent.gateway.integration-spec.ts` asks the same questions of the whole
 * application against a migrated database.
 */

/** What an upgrade that was not accepted answered. */
interface Refused {
  readonly status: number;
  readonly body: { code: string; message: string; details: unknown };
}

describe("the agent gateway's socket", () => {
  // Several cases drive a failure path on purpose — a refused hello, a dead database, a listener
  // that throws — and the gateway logs each one, as it should in production. Silenced here so the
  // suite's output holds only what failed; the cases that care what was said spy on it themselves.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  const row = runner();
  let http: Server;
  let url: string;
  let authenticate: jest.Mock<Promise<Transport | TransportRefusal>, [IncomingMessage]>;
  let metrics: GatewayMetrics;
  let sessions: AgentSessions;
  let gateway: AgentGateway;
  let config: { farmClientCertHeader: string | undefined };

  beforeEach(async () => {
    http = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    url = `ws://127.0.0.1:${String((http.address() as AddressInfo).port)}`;

    authenticate = jest.fn<Promise<Transport | TransportRefusal>, [IncomingMessage]>();
    metrics = new GatewayMetrics();
    sessions = new AgentSessions(() => new Date(), metrics);
    config = { farmClientCertHeader: undefined };

    const repository = {
      recordHello: jest.fn().mockResolvedValue(row),
      poolName: jest.fn().mockResolvedValue("pool-a"),
    };

    gateway = new AgentGateway(
      { httpAdapter: { getHttpServer: () => http } } as unknown as HttpAdapterHost,
      { authenticate } as unknown as TransportAuthenticator,
      sessions,
      repository as unknown as AgentGatewayRepository,
      metrics,
      config as AppConfigService,
      DEFAULT_VERSION_POLICY,
      () => new Date(),
    );
    gateway.onApplicationBootstrap();
  });

  afterEach(async () => {
    await gateway.onApplicationShutdown();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    jest.restoreAllMocks();
  });

  /**
   * Try to upgrade, expecting to be refused.
   *
   * @param path - The path.
   * @returns The status and the parsed body.
   */
  function refused(path: string = GATEWAY_PATH): Promise<Refused> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url}${path}`);

      socket.on("open", () => reject(new Error("the upgrade was accepted")));
      socket.on("error", () => undefined);
      socket.on("unexpected-response", (_request, response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as Refused["body"] }),
        );
      });
    });
  }

  /**
   * Upgrade, and collect every frame the gateway writes.
   *
   * @returns The socket and what it has received so far.
   */
  async function connected(): Promise<{ socket: WebSocket; frames: Envelope[] }> {
    const socket = new WebSocket(`${url}${GATEWAY_PATH}`);
    const frames: Envelope[] = [];

    socket.on("message", (data: Buffer) => {
      const decoded = decode(data);
      if (decoded.envelope) frames.push(decoded.envelope);
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });

    return { socket, frames };
  }

  /**
   * Wait until a condition holds.
   *
   * @param condition - The condition.
   * @returns When it holds.
   */
  async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(condition()).toBe(true);
  }

  it("answers a path that is not the gateway's with 404, in the error envelope", async () => {
    const answer = await refused("/api/v1/elsewhere");

    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe("not_found");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("REJECTS A CONNECTION MISSING A CLIENT CERTIFICATE with 401 before any socket exists", async () => {
    authenticate.mockResolvedValue({
      error: clientCertificateRequired(),
      reason: "no_certificate",
    });

    const answer = await refused();

    expect(answer).toEqual({
      status: 401,
      body: expect.objectContaining({ code: "farm_client_certificate_required" }) as unknown,
    });
    expect(metrics.snapshot(sessions.gauges()).refused.no_certificate).toBe(1);
    expect(metrics.snapshot(sessions.gauges()).connections.opened).toBe(0);
  });

  it("says once, in the log, that a proxy is most likely eating the certificates", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      error: clientCertificateRequired(),
      reason: "no_certificate",
    });

    await refused();
    await refused();

    const said = warn.mock.calls.filter(([message]) => String(message).includes("§ 7.6"));
    expect(said).toHaveLength(1);
    expect(String(said[0]?.[0])).toContain("OURO_FARM_CLIENT_CERT_HEADER is unset");
  });

  it("names the missing header when a deployment has configured one", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    config.farmClientCertHeader = "x-ouro-client-cert";
    authenticate.mockResolvedValue({
      error: clientCertificateRequired(),
      reason: "no_certificate",
    });

    await refused();

    expect(
      warn.mock.calls.some(([message]) => String(message).includes("x-ouro-client-cert")),
    ).toBe(true);
  });

  it("REFUSES A REVOKED CERTIFICATE AT HANDSHAKE with 401 farm_identity_refused", async () => {
    authenticate.mockResolvedValue({ error: identityRefused(), reason: "identity" });

    const answer = await refused();

    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe("farm_identity_refused");
    expect(metrics.snapshot(sessions.gauges()).refused.identity).toBe(1);
  });

  it("answers 500 in the envelope when authentication itself fails, and keeps serving", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    authenticate.mockRejectedValueOnce(new Error("database gone"));

    expect((await refused()).status).toBe(500);

    authenticate.mockResolvedValue({ error: identityRefused(), reason: "identity" });
    expect((await refused()).status).toBe(401);
  });

  it("upgrades an authenticated connection and speaks the protocol on it", async () => {
    authenticate.mockResolvedValue({ runner: row, mode: "mtls" });

    const { socket, frames } = await connected();
    socket.send(fixtureBytes("valid/hello.json").toString("utf8"));
    await until(() => frames.length > 0);

    expect(frames[0]?.type).toBe("ack");
    expect(metrics.snapshot(sessions.gauges()).connections).toMatchObject({ active: 1, opened: 1 });

    socket.close();
    await until(() => metrics.snapshot(sessions.gauges()).connections.active === 0);
  });

  it("refuses a frame over the protocol's ceiling at the transport, unparsed", async () => {
    authenticate.mockResolvedValue({ runner: row, mode: "mtls" });

    const { socket } = await connected();
    const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    socket.send("x".repeat(ENVELOPE_MAX_BYTES + 1));

    expect(await closed).toBe(1009);
  });

  it("says goodbye with a spread-out reconnection delay when the application shuts down", async () => {
    authenticate.mockResolvedValue({ runner: row, mode: "mtls" });
    const { socket, frames } = await connected();
    socket.send(fixtureBytes("valid/hello.json").toString("utf8"));
    await until(() => frames.length > 0);

    const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    await gateway.onApplicationShutdown();

    expect(await closed).toBe(1001);
    const bye = frames.find((envelope) => envelope.type === "bye") as Envelope<"bye"> | undefined;
    expect(bye?.payload.reason).toBe("server_shutdown");
    expect(bye?.payload.reconnect_after_ms).toBeGreaterThanOrEqual(
      SHUTDOWN_RECONNECT_SPREAD_MS.min,
    );
    expect(bye?.payload.reconnect_after_ms).toBeLessThan(SHUTDOWN_RECONNECT_SPREAD_MS.max);
  });
});
