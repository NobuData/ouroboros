import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import {
  API_BASE_PATH,
  API_PREFIX,
  API_VERSION,
  applicationOptions,
  createApplication,
} from "./application";
import type { AuthEcho } from "./auth/better-auth.fixture";
import { AUTH_BASE_PATH } from "./auth/auth.options";
import { AUTH_ROUTES } from "./auth/auth.routes";
import type { Heartbeat } from "./modules/app/app.service";
import { AppConfigService } from "./modules/config/config.service";
import { testConfiguration } from "./modules/config/configuration.fixture";
import { DatabaseService } from "./modules/db/db.service";
import type { ErrorEnvelope } from "./modules/errors/error.envelope";
import { document } from "./openapi/specification";
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

describe("the options every application is created with", () => {
  it("switches the body parser off", () => {
    expect(applicationOptions().bodyParser).toBe(false);
  });

  it("carries everything else the caller asked for", () => {
    expect(applicationOptions({ logger: false }).logger).toBe(false);
  });

  it("will not let a caller switch it back on", () => {
    // Not a preference a call site gets to hold: an application that parsed bodies
    // globally would hand BetterAuth a stream somebody else had already read, and the
    // failure looks like a bad signature rather than like a bootstrap setting.
    expect(applicationOptions({ bodyParser: true }).bodyParser).toBe(false);
  });
});

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

/**
 * Every operation in the contract that carries a request body, with its path parameters
 * filled in.
 *
 * Read from the published document rather than listed, which is what makes the body-parser
 * regression below a sweep instead of a spot check: an endpoint added to `openapi.yaml`
 * without this file being touched is covered the day it is documented.
 *
 * The substituted value never reaches a handler — every one of these routes is behind the
 * session guard, and that is the point of the suite it belongs to — so any well-formed
 * segment will do.
 *
 * @returns One `[method, path]` pair per documented operation that takes a body.
 */
function routesTakingBodies(): [string, string][] {
  const routes: [string, string][] = [];

  for (const [path, item] of Object.entries(document().paths)) {
    // The auth family is the one subtree the parsers are deliberately *not* added for —
    // BetterAuth signs what it reads, so it reads the stream. Its bodies are published
    // since [#711](https://github.com/NobuData/ouroboros/issues/711), which is what would
    // otherwise sweep them in here; that they arrive unparsed is asserted directly, in
    // *BetterAuth's route surface* above, and asserting the opposite of it here would be
    // a suite arguing with itself.
    if (path.startsWith(`${AUTH_BASE_PATH}/`)) continue;

    for (const [method, operation] of Object.entries(item)) {
      if (typeof operation === "object" && operation !== null && "requestBody" in operation) {
        routes.push([method, path.replace(/\{[^}]+\}/g, PATH_PARAMETER)]);
      }
    }
  }

  return routes;
}

/** What a documented path parameter is filled in with — see {@link routesTakingBodies}. */
const PATH_PARAMETER = "00000000-0000-4000-8000-000000000000";

/**
 * The envelope code a body the parser refused comes back as.
 *
 * `codeForStatus(400)`, through the global filter — which is the point: a parser error is
 * raised in middleware, before any handler, and `docs/ARCHITECTURE.md` § 5.3 applies to it
 * anyway.
 */
const BAD_REQUEST_CODE = "bad_request";

describe("BetterAuth's route surface", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await testApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  /**
   * Read an answer that came from the library rather than from a controller.
   *
   * @param body - The response body Supertest parsed.
   * @returns The same body, typed. See `src/auth/better-auth.fixture.ts` for what the
   *   instance under test answers with and why it is an echo.
   */
  const echoOf = (body: unknown): AuthEcho => body as AuthEcho;

  it("answers under /api/auth, which no controller declares", async () => {
    const response = await request(server()).get(`${AUTH_BASE_PATH}/ok`).expect(200);

    expect(echoOf(response.body).betterAuth).toBe(true);
    expect(echoOf(response.body).path).toBe(`${AUTH_BASE_PATH}/ok`);
  });

  it("takes the whole subtree, not an enumerated list of paths", async () => {
    // The library owns its own routing: a path it does not serve is a 404 *it* writes, in
    // its own shape. Nest answering first would mean a route added by a plugin — #704's
    // organization endpoints, say — being swallowed by the global filter instead.
    const response = await request(server())
      .get(`${AUTH_BASE_PATH}/nothing-a-controller-declares`)
      .expect(200);

    expect(echoOf(response.body).betterAuth).toBe(true);
  });

  it.each(AUTH_ROUTES.map((route) => route.path))("mounts %s below the API prefix", (path) => {
    // The documented map and the mount are the same string by construction, and this is
    // what keeps them so: a base path edited in `auth.options.ts` moves both.
    expect(path.startsWith(`${AUTH_BASE_PATH}/`)).toBe(true);
    expect(path.startsWith(API_BASE_PATH)).toBe(false);
  });

  it("does not serve them under the version, and the version does not serve them", async () => {
    // `/api/v1/auth` is #33's controller and answers its own four routes; what matters is
    // that BetterAuth's are not reachable there, because a client that found them under
    // both would be free to depend on the one this service does not intend to keep.
    await request(server()).get(`${API_BASE_PATH}/auth/ok`).expect(404);
    await request(server()).get(`/v1${AUTH_BASE_PATH}/ok`).expect(404);
  });

  it("hands the library the body byte for byte, unparsed", async () => {
    // The acceptance criterion `bodyParser: false` exists for. BetterAuth signs what it
    // reads, so it reads the stream — and a stream Nest had already parsed is a stream
    // that is empty by the time the library gets to it. The echoed body is that read.
    const payload = JSON.stringify({ provider: "github", callbackURL: "/" });

    const response = await request(server())
      .post(`${AUTH_BASE_PATH}/sign-in/social`)
      .set("Content-Type", "application/json")
      .send(payload)
      .expect(200);

    expect(echoOf(response.body).body).toBe(payload);
  });

  it("does not reject a malformed body on its behalf", async () => {
    // The mirror of the regression suite below: everywhere else, JSON that will not parse
    // is refused before routing. Here it must reach the library, which has its own opinion
    // about what a bad payload deserves and its own shape to say it in.
    const response = await request(server())
      .post(`${AUTH_BASE_PATH}/sign-in/social`)
      .set("Content-Type", "application/json")
      .send('{"provider":')
      .expect(200);

    expect(echoOf(response.body).body).toBe('{"provider":');
  });
});

describe("the body parser every other route depends on", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await testApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  /**
   * The regression this issue was written around.
   *
   * Nest parses nothing now — `applicationOptions` — and the parsers are re-added, for
   * every path but the auth ones, by the library's own middleware. That indirection is
   * invisible until it stops working, and when it stops working every endpoint in the
   * service quietly receives `undefined` where its DTO should be.
   *
   * Each case is a pair, and it is the pair that carries the proof. Well-formed JSON gets
   * past the parser and is refused by whatever runs after it; malformed JSON never gets
   * that far, because the parser refuses it first with a `400`. A service with no parser
   * installed answers the *same* thing to both — the body simply arrives as `undefined` —
   * so it is the difference between the two that is the assertion.
   *
   * What refuses the well-formed one depends on the route, and both answers are accounted
   * for rather than collapsed. Every authenticated route is a `401` from the session guard,
   * which runs before the pipe. `POST /api/v1/auth/discover` is the exception
   * ([#712](https://github.com/NobuData/ouroboros/issues/712)): it is `@AllowAnonymous()`,
   * so there is no guard to stop the request and the validation pipe answers `422` about a
   * body full of fields it does not declare — which is the stronger of the two proofs, since
   * only something that *read* the body can complain about what is in it.
   */
  it.each(routesTakingBodies())(
    "parses a JSON body on %s %s, and refuses one that will not parse",
    async (method, path) => {
      const send = (): request.Test =>
        request(server())[method as "post" | "patch"](path).set("Content-Type", "application/json");

      const wellFormed = await send().send(JSON.stringify({ slug: "ouro-parse" }));
      expect([401, 422]).toContain(wellFormed.status);

      const malformed = await send().send('{"slug":');
      expect(malformed.status).toBe(400);
      expect((malformed.body as ErrorEnvelope).code).toBe(BAD_REQUEST_CODE);
    },
  );

  it("parses a URL-encoded body too, which is the other parser Nest used to install", async () => {
    // Nothing in this API asks for one, and that is exactly why it is asserted: the
    // service used to accept them and a mounting that quietly dropped the second parser
    // would be a change to the contract that no endpoint test would notice.
    await request(server())
      .post(`${API_BASE_PATH}/tenants`)
      .type("form")
      .send({ slug: "ouro-parse" })
      .expect(401);
  });

  it("still refuses a body larger than the parser's limit", async () => {
    // Express's default is 100 kB, and the library re-adds the parsers with their own
    // defaults rather than with none. A parser with no limit would be a way to make this
    // service allocate as much memory as a caller cared to send it, and switching Nest's
    // parsers off is exactly the change that could have left one behind.
    //
    // What the refusal is spelled as is not asserted, deliberately. It is the envelope
    // filter's answer for an error no handler produced, it is what Nest's own parser
    // produced before this issue — checked by running this suite with `bodyParser: true` —
    // and improving it belongs to [#38](https://github.com/NobuData/ouroboros/issues/38)'s
    // security baseline rather than here. That the request never reaches the guard is the
    // claim this test makes.
    const response = await request(server())
      .post(`${API_BASE_PATH}/tenants`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ slug: "x".repeat(200_000) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(401);
  });
});

/**
 * The part of the HTTP adapter the drain test registers its route through.
 *
 * The same narrowing `publishSpecification` uses on the same object, for the same reason:
 * `HttpServer`'s own generics describe a response this suite does not need to name.
 */
interface SlowRouteAdapter {
  get(path: string, handler: (request: IncomingMessage, response: SlowResponse) => void): unknown;
}

/** The one method the slow route's handler calls. */
interface SlowResponse {
  send(body: string): unknown;
}

/**
 * Where the drain test's route lives.
 *
 * Outside `/api`, so it is nothing the global prefix, the versioning or the parsers have
 * an opinion about — the test is about the socket, not about the routing table.
 */
const SLOW_PATH = "/__slow-for-the-drain-test";

describe("shutting down", () => {
  it("lets a request that is already being served finish", async () => {
    // The acceptance criterion, made deterministic: the route below does not answer until
    // this test says so, so the close genuinely overlaps a request in flight rather than
    // racing it. `enableShutdownHooks` is what Nest needs to hear a signal; this is the
    // half that matters to whoever is holding the connection when it does.
    const app = await createApplication(testConfiguration(), { logger: false });

    let arrived!: () => void;
    let answer!: () => void;
    const inHandler = new Promise<void>((resolve) => (arrived = resolve));
    const released = new Promise<void>((resolve) => (answer = resolve));

    // Registered on the adapter rather than as a controller, the way the specification's
    // own route is (see `publishSpecification`), because a slow controller would be a
    // slow route in the shipped service.
    (app.getHttpAdapter() as unknown as SlowRouteAdapter).get(SLOW_PATH, (_req, res) => {
      arrived();
      void released.then(() => res.send("finished"));
    });

    await app.listen(0, "127.0.0.1");
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;

    const inFlight = fetch(`http://127.0.0.1:${port}${SLOW_PATH}`);
    await inHandler;

    const closing = app.close();
    answer();

    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("finished");

    await closing;
  });

  it("drains the pool the auth adapter and the repositories share", async () => {
    // One pool, so one drain — and now two libraries holding it. A shutdown that stopped
    // running this hook would leave BetterAuth's connections behind as well as tenancy's,
    // and PostgreSQL would be the first to notice rather than the suite.
    const app = await testApplication();
    const database = app.get(DatabaseService);
    const end = jest.spyOn(database, "end");

    await app.close();

    expect(end).toHaveBeenCalled();
    expect(database.pool.ending).toBe(true);
  });
});
