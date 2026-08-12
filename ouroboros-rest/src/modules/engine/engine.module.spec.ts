import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { applicationOptions, configureApplication, createApplication } from "../../application";
import { AppModule } from "../app/app.module";
import { AuthService } from "../auth/auth.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { EngineClient } from "./engine.client";
import { EngineController } from "./engine.controller";
import { ENGINE_ERRORS, engineUnavailable } from "./engine.errors";
import { EngineModule } from "./engine.module";

/**
 * The wiring, and the three properties of it that are not about resolution.
 *
 * A missing provider is a green typecheck and a boot failure on the first request, which is
 * why compiling a module is worth a test at all. The rest is what this module is for: the
 * route is really published under `/api/v1`, it is really behind the session guard — a
 * gateway to an internal service that answered strangers would be `docs/ARCHITECTURE.md`
 * § 10's first invariant undone by a decorator nobody wrote — and an engine that cannot
 * answer really becomes the envelope, through the application's own filter rather than
 * through a `try` in a controller.
 *
 * Nothing connects. Where a signed-in caller is needed, `AuthService` is replaced rather
 * than a session earned: this suite starts no database, and `auth`'s own specs are where a
 * cookie is proved to become a person.
 */

/** The person the replaced `AuthService` signs every request in as. */
const SIGNED_IN = {
  user: {
    id: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    createdAt: new Date("2026-08-11T10:20:23.114Z"),
    updatedAt: new Date("2026-08-11T10:20:23.114Z"),
  },
};

/**
 * The real application, with a session and an engine that behaves as the test says.
 *
 * `AppModule.forRoot` and the same `configureApplication` the process runs, so the guards,
 * the global filter and the versioned prefix are all shipped code — only the two things
 * this suite cannot start for itself are replaced.
 *
 * @param engine - What the controller's client does when it is asked.
 * @returns The initialised application. The caller closes it.
 */
async function applicationWith(engine: Partial<EngineClient>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testConfiguration())],
  })
    .overrideProvider(AuthService)
    .useValue({ authenticate: () => Promise.resolve(SIGNED_IN) })
    .overrideProvider(EngineClient)
    .useValue(engine)
    .compile();

  const app = moduleRef.createNestApplication(applicationOptions({ logger: false }));
  configureApplication(app);
  await app.init();

  return app;
}

describe("the engine module", () => {
  /** The module, compiled with configuration, as the application registers it. */
  async function compile() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), EngineModule],
    }).compile();
  }

  it("compiles", async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it("resolves the client", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(EngineClient)).toBeInstanceOf(EngineClient);
  });

  it("publishes the engine controller", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(EngineController)).toBeInstanceOf(EngineController);
  });

  it("exports the client, because the next engine feature is another caller of it", async () => {
    const moduleRef = await compile();

    expect(moduleRef.select(EngineModule).get(EngineClient)).toBeInstanceOf(EngineClient);
  });

  it("reads configuration without importing anything, because that module is global", async () => {
    // The client needs `OURO_ENGINE_URL` and the shared secret. Resolving it at all is what
    // proves the global registration reaches this module.
    const moduleRef = await compile();

    expect(moduleRef.get(EngineClient)).toBeDefined();
  });
});

describe("the route it publishes", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  it("refuses a request with no session", async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();

    const response = await request(server()).get("/api/v1/engine/status").expect(401);

    expect((response.body as ErrorEnvelope).code).toBe("unauthenticated");
  });

  it("does not reach the engine before it has refused an anonymous caller", async () => {
    // The guard runs before the handler, so a signed-out caller cannot use this route to
    // learn whether the engine is up — or to make this service open a socket for them.
    const status = jest.fn();
    app = await createApplication(testConfiguration(), { logger: false });
    jest.spyOn(app.get(EngineClient), "status").mockImplementation(status);
    await app.init();

    await request(server()).get("/api/v1/engine/status").expect(401);

    expect(status).not.toHaveBeenCalled();
  });

  it("answers a signed-in caller with the engine's version", async () => {
    app = await applicationWith({
      status: () =>
        Promise.resolve({ service: "ouroboros-engine", version: "0.3.0", uptimeSeconds: 1 }),
    });

    const response = await request(server()).get("/api/v1/engine/status").expect(200);

    expect(response.body).toEqual({ engine: "up", version: "0.3.0" });
  });

  it("needs no workspace, because there is one engine behind every one of them", async () => {
    // The caller belongs to no tenant here and sends no `X-Ouro-Tenant`. Without
    // `@TenantOptional()` this would be the tenancy guard's answer rather than the route's.
    app = await applicationWith({
      status: () =>
        Promise.resolve({ service: "ouroboros-engine", version: "0.3.0", uptimeSeconds: 1 }),
    });

    await request(server()).get("/api/v1/engine/status").expect(200);
  });

  it("answers 502 in the envelope when the engine cannot serve the request", async () => {
    app = await applicationWith({ status: () => Promise.reject(engineUnavailable()) });

    const response = await request(server()).get("/api/v1/engine/status").expect(502);

    const envelope = response.body as ErrorEnvelope;
    expect(envelope.code).toBe(ENGINE_ERRORS.unavailable);
    expect(envelope.details).toEqual({});
  });

  it("names no internal address in that answer", async () => {
    app = await applicationWith({ status: () => Promise.reject(engineUnavailable()) });

    const response = await request(server()).get("/api/v1/engine/status").expect(502);

    expect(JSON.stringify(response.body)).not.toContain("localhost:8000");
  });
});
