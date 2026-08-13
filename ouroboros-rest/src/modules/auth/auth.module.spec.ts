import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { createApplication } from "../../application";
import { BetterAuthModule } from "../../auth/auth.module";
import { ConfigurationModule } from "../config/config.module";
import { DbModule } from "../db/db.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AuthController } from "./auth.controller";
import { AUTH_ERRORS } from "./auth.errors";
import { AuthModule } from "./auth.module";
import { LegacySessionCookieMiddleware } from "./legacy.cookie";

/**
 * The wiring, and what this module contributes to a request now that it no longer
 * contributes a guard.
 *
 * `TenancyModule`'s spec explains why compiling a module is worth a test: a missing provider
 * is a green typecheck and a boot failure on the first request.
 *
 * **The guard used to be here and is not.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) replaced #33's `SessionGuard`
 * with the library's `AuthGuard`, registered in `src/auth/auth.module.ts`. The polarity it
 * enforced is unchanged and is asserted below — every route authenticated unless it says
 * otherwise — but *which routes say otherwise* is `guard.surface.spec.ts`, which enumerates
 * the whole table rather than the three routes a reader happens to remember.
 *
 * What this module contributes instead is one piece of middleware, and it is the other
 * thing asserted here: a browser still holding `ouro_session` is told to drop it.
 *
 * **And the database is not here either, since
 * [#711](https://github.com/NobuData/ouroboros/issues/711).** `AuthService` and
 * `AuthRepository` existed to answer `GET /api/v1/auth/me`, which that issue deleted along
 * with them; nothing left in this module issues a statement, so the `DbModule` import went
 * too. That is asserted rather than assumed below — an import that came back would be this
 * module quietly acquiring a reason to reach the database again.
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

  it("resolves the cookie eviction, which is the whole of what it provides", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(LegacySessionCookieMiddleware)).toBeInstanceOf(
      LegacySessionCookieMiddleware,
    );
  });

  it("publishes the auth controller", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
  });

  it("imports the database for no reason of its own", () => {
    // The inverse of the assertion this replaced. `DbModule` was imported for the two reads
    // that answered `GET /api/v1/auth/me`, and #711 deleted both — so an import that came
    // back would be this module acquiring a reason to reach the database that its code no
    // longer has.
    //
    // Read from the decorator rather than from the injector, and that distinction is the
    // whole of what can honestly be claimed: `DatabaseService` is still *resolvable* here,
    // because `BetterAuthModule` imports `DbModule` so the library's adapter can share the
    // pool. What is gone is this module asking for it.
    const imports = (Reflect.getMetadata("imports", AuthModule) ?? []) as unknown[];

    expect(imports).not.toContain(DbModule);
    expect(imports).toEqual([BetterAuthModule]);
  });

  it("still resolves the database through the library's own import", async () => {
    // The other half, stated so the assertion above is not read as "nothing in this graph
    // can reach the database". BetterAuth's adapter issues its statements over the pool
    // `DbModule` owns, and that is why signing out works at all.
    const moduleRef = await compile();

    expect(moduleRef.get(DatabaseService, { strict: false })).toBeInstanceOf(DatabaseService);
  });
});

describe("the authentication this module's routes sit behind", () => {
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
    // and its routes are authenticated anyway — by a guard that is now registered in a
    // third module again. Asserted through the application rather than by introspecting the
    // container, because Nest registers a global guard under a token it generates, so
    // behaviour is the only honest way to ask this question.
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

  it("leaves signing out alone", async () => {
    // The one route of this module's own that stays anonymous, and the one exemption #703
    // had to port rather than merely keep: it is what makes an *expired* session disposable,
    // since requiring one would refuse the request for carrying the thing it came to remove.
    await request(server()).post("/api/v1/auth/logout").expect(204);
  });

  it("tells a browser still holding #33's cookie to drop it", async () => {
    // The middleware this module does contribute. The cut-over invalidates every live
    // session — there is no way to migrate a stateless cookie into a session row — so a
    // browser that goes on sending `ouro_session` is refused cleanly and told to stop.
    const response = await request(server())
      .get("/api/v1")
      .set("Cookie", "ouro_session=left-over-from-33")
      .expect(200);

    const cookies = (response.headers["set-cookie"] ?? []) as unknown as string[];

    expect(cookies.find((header) => header.startsWith("ouro_session="))).toContain("Max-Age=0");
  });

  it("leaves BetterAuth's own routes alone, mounted ahead of the router as they are", async () => {
    // The seam #702 depends on: sign-in has to work for somebody holding no session, and it
    // does so by not passing through a Nest guard at all. `/api/auth/ok` is the library
    // answering for itself, which is what makes this an assertion about the mount rather
    // than about a provider.
    await request(server()).get("/api/auth/ok").expect(200);
  });

  it("answers the envelope, so a 401 parses like every other failure", async () => {
    // Any authenticated route: this was `/api/v1/auth/me` until
    // [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it, and the envelope
    // is the guard's rather than the route's.
    const response = await request(server()).get("/api/v1/engine/status").expect(401);

    const envelope = response.body as ErrorEnvelope;

    expect(envelope.code).toBe(AUTH_ERRORS.unauthenticated);
    expect(envelope.message).not.toBe("");
    expect(envelope.details).toEqual({});
  });
});
