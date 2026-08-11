import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TerminusModule } from "@nestjs/terminus";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import {
  ENGINE_HEALTH_ROUTE,
  ENGINE_KEY,
  EngineHealthIndicator,
  engineHealthUrl,
} from "./engine.health";
import { PROBE_TIMEOUT_MS } from "./probe";
import { engineResponse, fetchRefused, fetchTimedOut, stubFetch } from "./probe.fixture";

/**
 * The engine half of `/health/ready`.
 *
 * The engine's `/healthz` is the one path it serves without `X-Ouro-Internal-Key`
 * ([#51](https://github.com/NobuData/ouroboros/issues/51)), so the first thing asserted here
 * is that this probe sends no secret — a probe that leaked the shared key into a log or onto
 * the wire would be a worse outcome than one that never worked.
 */

/** The status one indicator reported, as Terminus keys it. */
type Reported = { status: string; message?: string };

/**
 * Build the indicator over the development configuration.
 *
 * @returns The indicator, ready to check. `OURO_ENGINE_URL` is `http://localhost:8000`, the
 *   value `.env.example` documents — see `configuration.fixture.ts`.
 */
async function indicator(): Promise<EngineHealthIndicator> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigurationModule.forRoot(testConfiguration()), TerminusModule],
    providers: [EngineHealthIndicator],
  }).compile();

  return moduleRef.get(EngineHealthIndicator);
}

/**
 * Probe an engine that answers however the test says.
 *
 * @param respond - What `fetch` does with the request.
 * @returns What the indicator said about `engine`.
 */
async function report(respond: (url: string) => Promise<Response>): Promise<Reported> {
  stubFetch(respond);
  const result = await (await indicator()).check();

  return result[ENGINE_KEY] as Reported;
}

describe("engineHealthUrl", () => {
  it("appends the engine's open liveness route", () => {
    expect(engineHealthUrl("http://localhost:8000")).toBe("http://localhost:8000/healthz");
  });

  it("keeps a base URL's own path, for an engine behind a proxy", () => {
    // `new URL("/healthz", "http://host/engine")` would throw the /engine away, which is a
    // deployment this service does not get to break.
    expect(engineHealthUrl("https://internal.example/engine")).toBe(
      "https://internal.example/engine/healthz",
    );
  });

  it("does not double the separator when the base URL ends in one", () => {
    expect(engineHealthUrl("http://localhost:8000/")).toBe("http://localhost:8000/healthz");
  });
});

describe("EngineHealthIndicator", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("is keyed as the dependency a 503 has to name", () => {
    expect(ENGINE_KEY).toBe("engine");
  });

  it("reports up when the engine answers its liveness route", async () => {
    await expect(report(() => Promise.resolve(engineResponse()))).resolves.toEqual({
      status: "up",
    });
  });

  it("asks the engine's open route, at the configured base URL", async () => {
    const fetched = stubFetch(() => Promise.resolve(engineResponse()));

    await (await indicator()).check();

    expect(fetched).toHaveBeenCalledWith(
      `http://localhost:8000/${ENGINE_HEALTH_ROUTE}`,
      expect.anything(),
    );
  });

  it("sends no shared secret, because the route it asks does not want one", async () => {
    const fetched = stubFetch(() => Promise.resolve(engineResponse()));

    await (await indicator()).check();

    const [, options] = fetched.mock.calls[0];
    expect(JSON.stringify(options?.headers)).not.toContain("dev-engine-shared-secret-change-me");
    expect(JSON.stringify(options?.headers).toLowerCase()).not.toContain("x-ouro-internal-key");
  });

  it("aborts the request rather than only giving up on it", async () => {
    // A race would leave the request in flight. A probe polled every few seconds against a
    // struggling engine would then hold one socket per poll.
    const fetched = stubFetch(() => Promise.resolve(engineResponse()));

    await (await indicator()).check();

    const [, options] = fetched.mock.calls[0];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the socket back rather than leaving an unread body to the collector", async () => {
    const response = engineResponse();

    await report(() => Promise.resolve(response));

    // `bodyUsed` is true once the stream has been disturbed, which cancelling it is. An
    // uncancelled body would still be pending here — and would hold its connection out of
    // undici's pool until the garbage collector noticed.
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    [503, "responded 503"],
    [401, "responded 401"],
    [500, "responded 500"],
  ])("reports down when the engine answers %s", async (status, message) => {
    const reported = await report(() => Promise.resolve(engineResponse(status)));

    expect(reported.status).toBe("down");
    expect(reported.message).toBe(`GET /${ENGINE_HEALTH_ROUTE} ${message}`);
  });

  it("reports down when nothing is listening", async () => {
    const reported = await report(() => Promise.reject(fetchRefused()));

    expect(reported.status).toBe("down");
    expect(reported.message).toBe(`GET /${ENGINE_HEALTH_ROUTE} failed (ECONNREFUSED)`);
  });

  it("reports down when the engine does not answer in time", async () => {
    const reported = await report(() => Promise.reject(fetchTimedOut()));

    expect(reported.status).toBe("down");
    expect(reported.message).toBe(
      `GET /${ENGINE_HEALTH_ROUTE} timed out after ${PROBE_TIMEOUT_MS} ms`,
    );
  });

  it("never rejects, so a dependency being down is never mistaken for a broken probe", async () => {
    await expect(
      report(() => {
        throw new Error("something nobody anticipated");
      }),
    ).resolves.toEqual({ status: "down", message: `GET /${ENGINE_HEALTH_ROUTE} failed` });
  });

  it("names the route it asked, and not the host it asked it of", async () => {
    // `OURO_ENGINE_URL` is internal topology. It is in the log line, not in a body an
    // unauthenticated caller reads.
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const reported = await report(() => Promise.reject(fetchRefused()));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:8000/healthz"),
      expect.stringContaining("ECONNREFUSED"),
    );
    expect(JSON.stringify(reported)).not.toContain("localhost");
  });
});
