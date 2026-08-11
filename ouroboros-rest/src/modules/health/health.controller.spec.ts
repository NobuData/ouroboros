import type { Server } from "node:http";

import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { API_BASE_PATH, API_PREFIX, configureApplication } from "../../application";
import { AppModule } from "../app/app.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DATABASE_KEY } from "./database.health";
import { DATABASE_PROBE_POOL, PROBE_STATEMENT, type ProbePool } from "./database.pool";
import { ENGINE_KEY } from "./engine.health";
import { HEALTH_LIVE_PATH, HEALTH_PATH, HEALTH_READY_PATH, LIVE_ROUTE } from "./health.paths";
import {
  answeringPool,
  engineResponse,
  fetchRefused,
  refusingPool,
  stubFetch,
} from "./probe.fixture";

/**
 * The probes as a platform sees them: two paths, two status codes, and a body that names
 * which dependency is missing.
 *
 * This is where issue [#29](https://github.com/NobuData/ouroboros/issues/29)'s acceptance
 * criteria are checked, and they are checked over HTTP rather than against the controller's
 * return value — "stopping PostgreSQL flips ready to 503 while live stays 200" is a claim
 * about status codes and paths, and a unit test on the controller would pass with the routes
 * mounted in the wrong place and the exception mapped to the wrong code.
 *
 * The application is the real one: `AppModule.forRoot` and the same `configureApplication`
 * the process runs, with one provider replaced. What the fake replaces is the *connection*,
 * not the probe — so the indicator, Terminus's aggregation, Nest's exception mapping and the
 * global-prefix exclusion are all the shipped code.
 */

/** The body both probes answer with, as Terminus shapes it. */
interface HealthReport {
  status: string;
  info: Record<string, { status: string; message?: string }>;
  error: Record<string, { status: string; message?: string }>;
  details: Record<string, { status: string; message?: string }>;
}

/**
 * Build the application with a database that behaves as the test says.
 *
 * @param pool - The connection the readiness probe queries through.
 * @returns The initialised application. The caller closes it.
 */
async function applicationWith(pool: ProbePool): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testConfiguration())],
  })
    .overrideProvider(DATABASE_PROBE_POOL)
    .useValue(pool)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApplication(app);
  await app.init();

  return app;
}

describe("the health probes", () => {
  let app: INestApplication;

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  beforeEach(() => {
    // Terminus logs a failed check, and the indicators log the driver's diagnosis. Both are
    // wanted in production and neither is wanted in a suite that fails checks on purpose.
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("when every dependency answers", () => {
    beforeEach(async () => {
      stubFetch(() => Promise.resolve(engineResponse()));
      app = await applicationWith(answeringPool());
    });

    it("answers liveness with 200", async () => {
      const response = await request(server()).get(HEALTH_LIVE_PATH).expect(200);
      const body = response.body as HealthReport;

      expect(body.status).toBe("ok");
    });

    it("reports nothing under liveness, because it depends on nothing", async () => {
      const response = await request(server()).get(HEALTH_LIVE_PATH).expect(200);
      const body = response.body as HealthReport;

      expect(body.details).toEqual({});
      expect(body.info).toEqual({});
      expect(body.error).toEqual({});
    });

    it("answers readiness with 200", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(200);
      const body = response.body as HealthReport;

      expect(body.status).toBe("ok");
    });

    it("reports both dependencies independently — the issue's first criterion", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(200);
      const body = response.body as HealthReport;

      expect(body.details).toEqual({
        [DATABASE_KEY]: { status: "up" },
        [ENGINE_KEY]: { status: "up" },
      });
      expect(body.error).toEqual({});
    });

    it("tells the caller not to cache a probe", async () => {
      // A cached probe is a probe: the answer is only worth anything at the moment it is
      // asked. `@HealthCheck()` is what sets this, and this is what notices if it is dropped.
      await request(server())
        .get(HEALTH_READY_PATH)
        .expect("Cache-Control", /no-cache/);
    });

    it.each([
      ["liveness", HEALTH_LIVE_PATH],
      ["readiness", HEALTH_READY_PATH],
    ])("answers %s with JSON", async (_description, path) => {
      await request(server())
        .get(path)
        .expect("Content-Type", /application\/json/);
    });
  });

  describe("when PostgreSQL is stopped", () => {
    beforeEach(async () => {
      stubFetch(() => Promise.resolve(engineResponse()));
      app = await applicationWith(refusingPool());
    });

    it("flips readiness to 503 — the issue's second criterion", async () => {
      await request(server()).get(HEALTH_READY_PATH).expect(503);
    });

    it("names the database as the failing dependency", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(503);
      const body = response.body as HealthReport;

      expect(Object.keys(body.error)).toEqual([DATABASE_KEY]);
      expect(body.error[DATABASE_KEY].message).toBe(`${PROBE_STATEMENT} failed (ECONNREFUSED)`);
    });

    it("still reports the dependency that is fine", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(503);
      const body = response.body as HealthReport;

      expect(body.info).toEqual({ [ENGINE_KEY]: { status: "up" } });
      expect(body.details[ENGINE_KEY]).toEqual({ status: "up" });
    });

    it("keeps liveness at 200, so nothing restarts a process that is fine", async () => {
      const response = await request(server()).get(HEALTH_LIVE_PATH).expect(200);
      const body = response.body as HealthReport;

      expect(body.status).toBe("ok");
    });

    it("says nothing about where the database is", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(503);

      expect(JSON.stringify(response.body)).not.toContain("127.0.0.1");
      expect(JSON.stringify(response.body)).not.toContain("ouroboros:ouroboros");
    });
  });

  describe("when the engine is stopped", () => {
    beforeEach(async () => {
      stubFetch(() => Promise.reject(fetchRefused()));
      app = await applicationWith(answeringPool());
    });

    it("flips readiness to 503 naming the engine", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(503);
      const body = response.body as HealthReport;

      expect(Object.keys(body.error)).toEqual([ENGINE_KEY]);
      expect(body.info).toEqual({ [DATABASE_KEY]: { status: "up" } });
    });
  });

  describe("when nothing is reachable", () => {
    beforeEach(async () => {
      stubFetch(() => Promise.reject(fetchRefused()));
      app = await applicationWith(refusingPool());
    });

    it("names both, rather than stopping at the first", async () => {
      const response = await request(server()).get(HEALTH_READY_PATH).expect(503);
      const body = response.body as HealthReport;

      expect(Object.keys(body.error).sort()).toEqual([DATABASE_KEY, ENGINE_KEY]);
      expect(body.status).toBe("error");
    });
  });

  describe("where the probes answer", () => {
    beforeEach(async () => {
      stubFetch(() => Promise.resolve(engineResponse()));
      app = await applicationWith(answeringPool());
    });

    // A probe is configured once, in a Dockerfile (#36) or a compose file (#55), and read by
    // infrastructure with no notion of an API version. Each of these is the path it would
    // have had if it were an ordinary route — and none of them may answer, or the exclusion
    // in `src/application.ts` has stopped doing its job.
    it.each([
      ["under the API's base path", `${API_BASE_PATH}/${HEALTH_PATH}/${LIVE_ROUTE}`],
      ["under the prefix without a version", `/${API_PREFIX}/${HEALTH_PATH}/${LIVE_ROUTE}`],
      ["at a version that is not served", `/${API_PREFIX}/v2/${HEALTH_PATH}/${LIVE_ROUTE}`],
    ])("does not also answer %s", async (_description, path) => {
      await request(server()).get(path).expect(404);
    });

    it.each([
      ["liveness", HEALTH_LIVE_PATH],
      ["readiness", HEALTH_READY_PATH],
    ])("accepts only GET on %s", async (_description, path) => {
      await request(server()).post(path).expect(404);
      await request(server()).delete(path).expect(404);
    });

    it("leaves the health path itself unserved", async () => {
      // Two probes, two answers. `/health` would be a third thing to explain.
      await request(server()).get(`/${HEALTH_PATH}`).expect(404);
    });
  });
});
