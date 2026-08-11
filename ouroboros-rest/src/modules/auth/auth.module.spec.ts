import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { createApplication } from "../../application";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AuthController } from "./auth.controller";
import { AUTH_ERRORS } from "./auth.errors";
import { AuthModule } from "./auth.module";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { GithubClient } from "./github";

/**
 * The wiring, and the one piece of it that is a security property.
 *
 * `TenancyModule`'s spec explains why compiling a module is worth a test: a missing
 * provider is a green typecheck and a boot failure on the first request. This module has a
 * second thing worth checking, and it is not about resolution at all — **the guard is
 * registered globally**, which is what makes every route in the application authenticated
 * by default. If that registration were dropped, every other test in the suite would still
 * pass and the service would answer to anybody.
 *
 * Nothing connects. `pg` connects lazily, so the real `DatabaseService` can be resolved by a
 * suite that starts no database.
 */

describe("the auth module", () => {
  /** The module, compiled with configuration, as the application registers it. */
  async function compile() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), AuthModule],
    }).compile();
  }

  it("compiles", async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it.each([
    ["the repository", AuthRepository],
    ["the GitHub client", GithubClient],
    ["the service", AuthService],
  ])("resolves %s", async (_description, provider) => {
    const moduleRef = await compile();

    expect(moduleRef.get(provider)).toBeInstanceOf(provider);
  });

  it("publishes the auth controller", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
  });

  it("reaches the database through DbModule rather than assuming it", async () => {
    // The import is the answer to "who can reach the users table". Resolving the real
    // provider is what proves the import is there.
    const moduleRef = await compile();

    expect(moduleRef.get(DatabaseService, { strict: false })).toBeInstanceOf(DatabaseService);
  });

  it("exports the service, because #32 resolves memberships through it", async () => {
    const moduleRef = await compile();

    expect(moduleRef.select(AuthModule).get(AuthService)).toBeInstanceOf(AuthService);
  });
});

describe("the guard this module registers", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  it("protects a route declared in another module entirely", async () => {
    // The whole point of `APP_GUARD`: `TenancyModule` knows nothing about authentication,
    // and its routes are authenticated anyway. Asserted through the application rather than
    // by introspecting the container, because Nest registers a global guard under a token
    // it generates — so behaviour is the only honest way to ask this question.
    const response = await request(server()).get("/api/v1/tenants").expect(401);

    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
  });

  it("refuses a mutation as readily as a read", async () => {
    await request(server())
      .post("/api/v1/tenants")
      .send({ slug: "x", displayName: "X" })
      .expect(401);
  });

  it("refuses before validation runs, so an unauthenticated caller learns nothing about the shape", async () => {
    // A guard runs before a pipe. Without that ordering, a malformed body would be a 422
    // that told a stranger which fields exist.
    const response = await request(server()).post("/api/v1/tenants").send({ nonsense: true });

    expect(response.status).toBe(401);
  });

  it("leaves the heartbeat and the probes alone", async () => {
    await request(server()).get("/api/v1").expect(200);
    await request(server()).get("/health/live").expect(200);
  });

  it("leaves the sign-in routes alone", async () => {
    await request(server()).get("/api/v1/auth/github").expect(302);
    await request(server()).post("/api/v1/auth/logout").expect(204);
  });

  it("answers the envelope, so a 401 parses like every other failure", async () => {
    const response = await request(server()).get("/api/v1/auth/me").expect(401);

    const envelope = response.body as ErrorEnvelope;

    expect(envelope.code).toBe(AUTH_ERRORS.unauthenticated);
    expect(envelope.message).not.toBe("");
    expect(envelope.details).toEqual({});
  });
});
