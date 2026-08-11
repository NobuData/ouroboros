import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { API_BASE_PATH, API_PREFIX, API_VERSION, createApplication } from "./application";
import type { Heartbeat } from "./modules/app/app.service";
import { AppConfigService } from "./modules/config/config.service";
import { testConfiguration } from "./modules/config/configuration.fixture";
import { SERVICE_NAME, serviceVersion } from "./version";

/**
 * The application as the process builds it, minus the socket: `init()` wires the module
 * tree and the HTTP adapter without binding a port, which is what lets Supertest ask it
 * real questions in a unit suite.
 *
 * `logger: false` silences Nest's boot banner. It is the only difference from what
 * `main.ts` builds, and it changes nothing that is asserted below.
 */
async function testApplication(): Promise<INestApplication> {
  const app = await createApplication(testConfiguration(), { logger: false });
  await app.init();
  return app;
}

describe("the API base path", () => {
  it("is composed from the prefix and the default version", () => {
    expect(API_PREFIX).toBe("api");
    expect(API_VERSION).toBe("1");
    expect(API_BASE_PATH).toBe("/api/v1");
  });
});

describe("the application's HTTP surface", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await testApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  it("serves the heartbeat at the base path", async () => {
    const response = await request(server()).get(API_BASE_PATH).expect(200);
    const body = response.body as Heartbeat;

    expect(body.service).toBe(SERVICE_NAME);
    expect(body.version).toBe(serviceVersion());
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("answers with JSON", async () => {
    await request(server())
      .get(API_BASE_PATH)
      .expect("Content-Type", /application\/json/);
  });

  // The prefix and the version are only worth configuring if the routes are not also
  // reachable without them: each of these is one half of /api/v1 left off.
  it.each([
    ["the origin root", "/"],
    ["the prefix without a version", `/${API_PREFIX}`],
    ["the version without the prefix", `/v${API_VERSION}`],
    ["a version that is not served", `/${API_PREFIX}/v2`],
    ["an unknown route under the base path", `${API_BASE_PATH}/nothing-here`],
  ])("does not serve %s", async (_description, path) => {
    await request(server()).get(path).expect(404);
  });

  it("accepts only GET on the heartbeat", async () => {
    await request(server()).post(API_BASE_PATH).expect(404);
    await request(server()).delete(API_BASE_PATH).expect(404);
  });
});

describe("configuration", () => {
  it("is registered on the application every feature module will read it from", async () => {
    const app = await testApplication();

    try {
      expect(app.get(AppConfigService).all).toEqual(testConfiguration());
    } finally {
      await app.close();
    }
  });
});

describe("the browser origins that may call with credentials", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await testApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  it("answers a listed origin with itself and permission to send cookies", async () => {
    // Without both headers the browser drops the response, and the session the OAuth flow
    // just landed is a cookie `ouroboros-ui` can never use.
    const response = await request(server())
      .get(API_BASE_PATH)
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("never answers with a wildcard, which a credentialed request may not use", async () => {
    const response = await request(server())
      .get(API_BASE_PATH)
      .set("Origin", "http://localhost:3000");

    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("does not permit an origin that is not configured", async () => {
    const response = await request(server())
      .get(API_BASE_PATH)
      .set("Origin", "https://not-configured.example");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("tells a preflight that the tenant header is allowed", async () => {
    // `X-Ouro-Tenant` is #32's. A header a browser is not told it may send is a preflight
    // failure rather than a missing header — a failure that would land on that issue
    // looking like its own bug.
    const response = await request(server())
      .options(API_BASE_PATH)
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "x-ouro-tenant");

    expect(response.headers["access-control-allow-headers"]).toContain("X-Ouro-Tenant");
  });
});

describe("shutdown hooks", () => {
  it("are enabled, so providers get to close what they opened", async () => {
    // Measured as a delta: this process is a test runner with listeners of its own, and
    // the absolute count is nobody's business but Node's.
    const before = process.listenerCount("SIGTERM");

    const app = await testApplication();
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(before);

    await app.close();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
