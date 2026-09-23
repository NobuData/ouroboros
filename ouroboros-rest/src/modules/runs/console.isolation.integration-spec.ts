import type request from "supertest";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { RunControlResource } from "../controls/controls.resources";
import { INGEST_ERRORS } from "../ingest/ingest.errors";
import { seedIngestBench, seedReservableJob, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";

/**
 * **Org isolation, over every run route** — AP.6
 * ([#308](https://github.com/NobuData/ouroboros/issues/308)).
 *
 * > The isolation suite covers **every** route added by this epic, not a sample.
 *
 * "Every" is checked rather than claimed. {@link ROUTES} names each route under `/api/v1/runs`
 * and `/internal/runs` with how it is isolated, and the first test holds that table equal to the
 * route table the running application registered (`route.table.fixture.ts`, the walk
 * `guard.surface.integration-spec.ts` uses). A route added without a row here fails that test
 * before any other runs.
 *
 * Two kinds of isolation, because there are two kinds of caller:
 *
 *   * **`public`** — a signed-in person in a workspace. Another workspace's run is answered
 *     `404 run_not_found`, exactly as an id that never existed, and nothing is written.
 *   * **`reference`** — the internal channel. Its principals (executor, simulator) are
 *     fleet-wide and carry no workspace, so what a request *can* get wrong is naming another
 *     workspace's object: a repository on open, a build job on a resource report, a control on
 *     an acknowledgement. Each is answered `404`.
 *   * **`fleet`** — the internal routes whose only reference is the run id. With no workspace on
 *     the principal, there is no "other org" for them to confuse: the run *is* the scope. What
 *     they owe is that a run id that does not exist is `404 run_not_found` rather than a write
 *     somewhere else, and that is what is asserted.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** A run id nobody has. */
const ABSENT_RUN = "5eed0009-0000-4000-8000-000000000999";

/** How a route keeps one workspace out of another's runs. */
type Isolation = "public" | "reference" | "fleet";

/** Every run route, with its isolation. The key is the route table's signature. */
const ROUTES: Readonly<Record<string, Isolation>> = {
  "GET /api/v1/runs": "public",
  "GET /api/v1/runs/:id": "public",
  "GET /api/v1/runs/:id/events": "public",
  "GET /api/v1/runs/:id/transcript.jsonl": "public",
  "GET /api/v1/runs/:id/controls": "public",
  "POST /api/v1/runs/:id/controls": "public",
  "POST /internal/runs": "reference",
  "POST /internal/runs/:id/resources": "reference",
  "POST /internal/runs/:id/controls/:controlId/ack": "reference",
  "POST /internal/runs/:id/stage-transitions": "fleet",
  "POST /internal/runs/:id/events": "fleet",
  "PUT /internal/runs/:id/files": "fleet",
  "POST /internal/runs/:id/commits": "fleet",
  "POST /internal/runs/:id/controls/fetch": "fleet",
};

describe("org isolation across every run route", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace, its owner, and a run the simulator opened in it. */
  interface Tenant {
    readonly owner: Person;
    readonly bench: IngestBench;
    readonly run: RunOpenedResource;
  }

  /**
   * One workspace with a run in it.
   *
   * @returns The tenant.
   */
  async function tenant(): Promise<Tenant> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await internal("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(
        201,
      ),
    );

    return { owner, bench, run };
  }

  /** Call the internal channel as the simulator. */
  function internal(method: "post" | "put", path: string, body: object = {}): request.Test {
    return api.anonymous(method, path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);
  }

  /** Call the public API as a tenant's owner, in the tenant's own workspace. */
  function asOwner(at: Tenant, method: "get" | "post", path: string): request.Test {
    return api.as(at.owner)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /** How many rows a table holds for a run. */
  async function count(table: string, run: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.${table} where run_id = $1`,
      [run],
    );

    return Number(rows[0].count);
  }

  it("names every run route the application registered, and nothing it did not", () => {
    const registered = routeTable(api.nest)
      .map((route) => route.signature)
      .filter((signature) => /^\w+ \/(api\/v1|internal)\/runs(\/|$)/.test(signature));

    expect(registered.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  describe("public routes — another workspace's run is one that never existed", () => {
    const perRun = Object.entries(ROUTES)
      .filter(([signature, isolation]) => isolation === "public" && signature.includes(":id"))
      .map(([signature]) => signature.split(" ") as ["GET" | "POST", string]);

    it.each(perRun)("%s %s answers 404 run_not_found", async (method, path) => {
      const home = await tenant();
      const foreign = await tenant();
      const verb = method.toLowerCase() as "get" | "post";
      const send = (id: string) => {
        const call = asOwner(home, verb, path.replace(":id", id));
        return verb === "post" ? call.send({ kind: "pause" }) : call;
      };

      const refused = await send(foreign.run.id).expect(404);
      const absent = await send(ABSENT_RUN).expect(404);

      expect(bodyOf<ErrorEnvelope>(refused)).toEqual({
        code: "run_not_found",
        message: bodyOf<ErrorEnvelope>(absent).message,
        details: { runId: foreign.run.id },
      });

      // Refused whole: a control pressed at another workspace's run is not queued there.
      expect(await count("run_controls", foreign.run.id)).toBe(0);
      expect(await count("run_events", foreign.run.id)).toBe(0);
    });

    it("GET /api/v1/runs lists only the workspace's own runs", async () => {
      const home = await tenant();
      const foreign = await tenant();

      const page = bodyOf<{ items: { id: string }[] }>(
        await asOwner(home, "get", "/api/v1/runs?status=active").expect(200),
      );

      expect(page.items.map((item) => item.id)).toEqual([home.run.id]);
      expect(page.items.map((item) => item.id)).not.toContain(foreign.run.id);
    });

    it("refuses a workspace the caller does not belong to before any run is looked up", async () => {
      const home = await tenant();
      const foreign = await tenant();

      // Naming the other workspace in the header does not borrow its membership.
      await api
        .as(home.owner)("get", `/api/v1/runs/${foreign.run.id}`)
        .set(TENANT_HEADER, foreign.bench.workspace.slug)
        .expect(404);
    });
  });

  describe("internal routes — a reference into another workspace", () => {
    it("POST /internal/runs refuses another workspace's repository", async () => {
      const home = await tenant();
      const foreign = await tenant();

      const refused = bodyOf<ErrorEnvelope>(
        await internal("post", "/internal/runs", {
          idempotencyKey: "open-cross",
          ...home.bench.open,
          repository: foreign.bench.workspace.repoId,
        }).expect(404),
      );

      expect(refused.code).toBe(INGEST_ERRORS.repositoryNotFound);
    });

    it("POST /internal/runs/:id/resources refuses another workspace's build job", async () => {
      const home = await tenant();
      const foreign = await tenant();
      const job = await seedReservableJob(api, foreign.bench, 900);

      const refused = bodyOf<ErrorEnvelope>(
        await internal("post", `/internal/runs/${home.run.id}/resources`, {
          idempotencyKey: "reserve-cross",
          reservedBuildJob: job,
        }).expect(404),
      );

      expect(refused.code).toBe(INGEST_ERRORS.buildJobNotFound);

      const { rows } = await api.sql.query<{ reserved_build_job_id: string | null }>(
        `select reserved_build_job_id from ${SCHEMA_NAME}.runs where id = $1`,
        [home.run.id],
      );
      expect(rows[0].reserved_build_job_id).toBeNull();
    });

    it("POST /internal/runs/:id/controls/:controlId/ack refuses another workspace's control", async () => {
      const home = await tenant();
      const foreign = await tenant();
      const control = bodyOf<RunControlResource>(
        await asOwner(foreign, "post", `/api/v1/runs/${foreign.run.id}/controls`)
          .send({ kind: "pause" })
          .expect(202),
      );

      await internal("post", `/internal/runs/${foreign.run.id}/controls/fetch`).expect(200);

      const refused = bodyOf<ErrorEnvelope>(
        await internal("post", `/internal/runs/${home.run.id}/controls/${control.id}/ack`).expect(
          404,
        ),
      );

      expect(refused.code).toBe("control_not_found");

      // The foreign control is untouched: still waiting for its own executor's answer.
      const { rows } = await api.sql.query<{ state: string }>(
        `select state from ${SCHEMA_NAME}.run_controls where id = $1`,
        [control.id],
      );
      expect(rows[0].state).toBe("delivered");
    });
  });

  describe("fleet routes — the run id is the only scope, and an unknown one writes nothing", () => {
    /** A valid body per fleet route, so a 404 is about the run and not the request. */
    const BODIES: Readonly<Record<string, object>> = {
      "POST /internal/runs/:id/stage-transitions": {
        idempotencyKey: "k",
        stageKey: "analyze",
        status: "active",
      },
      "POST /internal/runs/:id/events": {
        idempotencyKey: "k",
        events: [{ hint: 1, actor: "system", body: "x" }],
      },
      "PUT /internal/runs/:id/files": {
        idempotencyKey: "k",
        files: [{ path: "a.c", status: "added", additions: 1 }],
      },
      "POST /internal/runs/:id/commits": {
        idempotencyKey: "k",
        commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
      },
      "POST /internal/runs/:id/controls/fetch": {},
    };

    const fleet = Object.entries(ROUTES)
      .filter(([, isolation]) => isolation === "fleet")
      .map(([signature]) => signature);

    it("has a body for every fleet route", () => {
      expect(Object.keys(BODIES).sort()).toEqual([...fleet].sort());
    });

    it.each(fleet)("%s answers 404 run_not_found for a run nobody has", async (signature) => {
      const [method, path] = signature.split(" ");

      const refused = bodyOf<ErrorEnvelope>(
        await internal(
          method.toLowerCase() as "post" | "put",
          path.replace(":id", ABSENT_RUN),
          BODIES[signature],
        ).expect(404),
      );

      expect(refused.code).toBe("run_not_found");
    });
  });
});
