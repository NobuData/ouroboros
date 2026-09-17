import { Logger } from "@nestjs/common";
import type request from "supertest";

import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME, type OrganizationRole } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import { OCTOKIT_FACTORY } from "../github/github.client.factory";
import { recordingFactory } from "../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import { ADMINISTRATORS, CONTRIBUTORS } from "../tenancy/roles.guard";
import { PLANNING_ERRORS } from "./planning.errors";
import {
  EVERY_ROLE,
  callAs,
  countOf,
  insertBatch,
  insertEpic,
  insertTickets,
  planningWorkspace,
  type PlanningWorkspace,
} from "./planning.integration.fixture";
import type {
  BacklogHealthResource,
  EpicResource,
  PlanningTicketSearchResource,
  RoadmapResource,
} from "./planning.resources";
import { fillRoute, planningRoutes, type PlanningRoute } from "./planning.routes.fixture";
import { PUSH_ERRORS } from "./push.errors";

/**
 * Who may do what on the planning API, and whose data they may reach — over HTTP, against a
 * migrated database (AL.6, [#282](https://github.com/NobuData/ouroboros/issues/282)).
 *
 * Both tables are keyed by the **route inventory read off the controllers**
 * (`planning.routes.fixture.ts`), and each suite first asserts its table has a row for every route
 * the controllers declare. A route added without a case turns this file red — which is what makes
 * *"the role matrix is asserted on every mutating route"* and *"isolation is asserted on every
 * planning route"* claims about the API rather than about a list somebody remembered to update.
 *
 * ```bash
 * yarn test:integration planning.access
 * ```
 */

/** What one call sends. */
interface Call {
  /** Route parameters by name. */
  readonly params?: Readonly<Record<string, string>>;
  /** The JSON body. */
  readonly body?: Record<string, unknown>;
  /** The query string. */
  readonly query?: Record<string, string>;
}

describe("planning access — the role matrix and workspace isolation, on every route", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let github: WriteRecording;
  let ours: PlanningWorkspace;
  const routes = planningRoutes();

  beforeAll(async () => {
    engine = await startEngineStub();
    github = writeRecording();
    api = await ApiHarness.start(
      {
        OURO_ENGINE_URL: engine.url,
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
      },
      [{ provide: OCTOKIT_FACTORY, useValue: recordingFactory(github.octokit).factory }],
    );
    ours = await planningWorkspace(api);
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    expect(engine.violations).toEqual([]);
  });

  /**
   * Send one call to a route.
   *
   * @param route - The route.
   * @param slug - The tenant header.
   * @param person - Who.
   * @param call - Parameters, body, query.
   * @returns The response.
   */
  async function send(
    route: PlanningRoute,
    slug: string,
    person: Person,
    call: Call,
  ): Promise<request.Response> {
    let test = callAs(api, slug, person, route.method, fillRoute(route.path, call.params ?? {}));

    if (call.query !== undefined) {
      test = test.query(call.query);
    }

    return call.body === undefined ? test : test.send(call.body);
  }

  describe("the role matrix", () => {
    /** One mutating route's case: the policy, a fresh fixture per call, and what success answers. */
    interface MatrixCase {
      /**
       * Who may call it — **the documented policy**, written here rather than read off `@Roles`, so
       * a decorator loosened by mistake is a member served where this says refused.
       */
      readonly allowed: readonly OrganizationRole[];
      /** Build what the call needs — fresh, so one role's success cannot spoil the next role's. */
      readonly arrange: () => Promise<Call>;
      /** What an allowed role gets. */
      readonly success: number;
    }

    /** Ticket numbers handed out so far — each arrangement needs one the source has not seen. */
    let nextTicket = 700;

    const freshEpic = async (): Promise<Call> => ({
      params: { epic: await insertEpic(api, ours.bench.id, "Matrix lane") },
    });

    const CASES: Readonly<Record<string, MatrixCase>> = {
      "POST /api/v1/planning/batches": {
        allowed: CONTRIBUTORS,
        arrange: () =>
          Promise.resolve({
            body: { prompt: "- Journal writes before the swap", targetSourceId: ours.sourceId },
          }),
        success: 201,
      },
      "POST /api/v1/planning/batches/:batch/regenerate": {
        allowed: CONTRIBUTORS,
        arrange: async () => ({ params: { batch: (await insertBatch(api, ours)).id } }),
        success: 200,
      },
      "PATCH /api/v1/planning/batches/:batch/drafts/:key": {
        allowed: CONTRIBUTORS,
        arrange: async () => ({
          params: { batch: (await insertBatch(api, ours)).id, key: "OTA-1" },
          body: { selected: false },
        }),
        success: 200,
      },
      "POST /api/v1/planning/batches/:batch/push": {
        allowed: ADMINISTRATORS,
        arrange: async () => ({ params: { batch: (await insertBatch(api, ours)).id } }),
        success: 200,
      },
      "POST /api/v1/planning/batches/:batch/push/resume": {
        allowed: ADMINISTRATORS,
        arrange: async () => ({
          params: { batch: (await insertBatch(api, ours, { status: "pushing" })).id },
        }),
        success: 200,
      },
      "POST /api/v1/planning/epics": {
        allowed: ADMINISTRATORS,
        arrange: () => Promise.resolve({ body: { name: "Matrix lane" } }),
        success: 201,
      },
      "PUT /api/v1/planning/epics/order": {
        allowed: ADMINISTRATORS,
        arrange: async () => {
          await insertEpic(api, ours.bench.id, "Matrix lane");

          const { rows } = await api.sql.query<{ id: string }>(
            `select id from ${SCHEMA_NAME}.planning_epics
              where organization_id = $1 order by sort_order desc`,
            [ours.bench.id],
          );

          return { body: { epicIds: rows.map((row) => row.id) } };
        },
        success: 200,
      },
      "PATCH /api/v1/planning/epics/:epic": {
        allowed: ADMINISTRATORS,
        arrange: async () => ({ ...(await freshEpic()), body: { name: "Renamed lane" } }),
        success: 200,
      },
      "DELETE /api/v1/planning/epics/:epic": {
        allowed: ADMINISTRATORS,
        arrange: freshEpic,
        success: 204,
      },
      "POST /api/v1/planning/epics/:epic/tickets": {
        allowed: ADMINISTRATORS,
        arrange: async () => ({
          ...(await freshEpic()),
          body: { ticketIds: await insertTickets(api, ours, [{ number: nextTicket++ }]) },
        }),
        success: 200,
      },
      "DELETE /api/v1/planning/epics/:epic/tickets": {
        allowed: ADMINISTRATORS,
        arrange: async () => {
          const call = await freshEpic();
          const ticketIds = await insertTickets(api, ours, [{ number: nextTicket++ }]);

          await api.sql.query(
            `insert into ${SCHEMA_NAME}.epic_tickets (epic_id, ticket_id) values ($1, $2)`,
            [call.params?.epic, ticketIds[0]],
          );

          return { ...call, body: { ticketIds } };
        },
        success: 200,
      },
    };

    it("has a case for every mutating route the controllers declare", () => {
      const mutating = routes.filter((route) => route.mutating).map((route) => route.key);

      expect(Object.keys(CASES).sort()).toEqual(mutating.sort());
    });

    it.each(routes.filter((route) => route.mutating).map((route) => [route.key, route] as const))(
      "%s — refuses every role it does not name, and serves every role it does",
      async (_, route) => {
        const matrixCase = CASES[route.key];
        const { allowed } = matrixCase;

        // What the API actually does, role by role, against the policy…
        for (const role of EVERY_ROLE) {
          const call = await matrixCase.arrange();
          const issuesBefore = github.issues.length;
          const plansBefore = engine.plans.length;
          const response = await send(route, ours.bench.slug, ours.people[role], call);

          await api.nest.get(EstimationOrchestrator).settled();

          if (allowed.includes(role)) {
            expect([role, response.status]).toEqual([role, matrixCase.success]);
          } else {
            expect([role, response.status, bodyOf<ErrorEnvelope>(response).code]).toEqual([
              role,
              403,
              "forbidden",
            ]);
            // Refused before the handler: nothing reached the planner or the tracker.
            expect(github.issues).toHaveLength(issuesBefore);
            expect(engine.plans).toHaveLength(plansBefore);
          }
        }

        // …and the decorator the guard reads says the same.
        expect(route.roles).toEqual(allowed);
      },
    );
  });

  describe("workspace isolation", () => {
    /** Our workspace's objects, which the stranger's calls aim at. */
    interface Targets {
      readonly batchId: string;
      readonly epicId: string;
      readonly ticketId: string;
    }

    /** One route's isolation case. */
    interface IsolationCase {
      /** The call, aimed at our objects. */
      readonly call: (targets: Targets) => Call;
      /** What the stranger, in their own workspace, must get. */
      readonly expect: (response: request.Response, targets: Targets) => void;
    }

    const notFound =
      (code: string) =>
      (response: request.Response): void => {
        expect([response.status, bodyOf<ErrorEnvelope>(response).code]).toEqual([404, code]);
      };

    const batch = notFound(PUSH_ERRORS.batchNotFound);
    const epic = notFound(PLANNING_ERRORS.epicNotFound);

    const CASES: Readonly<Record<string, IsolationCase>> = {
      "POST /api/v1/planning/batches": {
        call: () => ({ body: { prompt: "Steal", targetSourceId: ours.sourceId } }),
        expect: notFound(PLANNING_ERRORS.sourceNotFound),
      },
      "GET /api/v1/planning/batches/:batch": {
        call: (t) => ({ params: { batch: t.batchId } }),
        expect: batch,
      },
      "POST /api/v1/planning/batches/:batch/regenerate": {
        call: (t) => ({ params: { batch: t.batchId } }),
        expect: batch,
      },
      "PATCH /api/v1/planning/batches/:batch/drafts/:key": {
        call: (t) => ({ params: { batch: t.batchId, key: "OTA-1" }, body: { selected: false } }),
        expect: batch,
      },
      "POST /api/v1/planning/batches/:batch/push": {
        call: (t) => ({ params: { batch: t.batchId } }),
        expect: batch,
      },
      "POST /api/v1/planning/batches/:batch/push/resume": {
        call: (t) => ({ params: { batch: t.batchId } }),
        expect: batch,
      },
      "GET /api/v1/planning/batches/:batch/push-status": {
        call: (t) => ({ params: { batch: t.batchId } }),
        expect: batch,
      },
      "GET /api/v1/planning/health": {
        call: () => ({}),
        expect: (response) => {
          expect(response.status).toBe(200);
          expect(bodyOf<BacklogHealthResource>(response)).toMatchObject({
            open: 0,
            sized: { count: 0, total: 0 },
            blocked: { count: 0 },
            stale: { count: 0 },
          });
        },
      },
      "GET /api/v1/planning/roadmap": {
        call: () => ({}),
        expect: (response) => {
          expect(response.status).toBe(200);
          expect(bodyOf<RoadmapResource>(response).lanes).toEqual([]);
        },
      },
      "GET /api/v1/planning/epics": {
        call: () => ({}),
        expect: (response) => {
          expect([response.status, bodyOf<EpicResource[]>(response)]).toEqual([200, []]);
        },
      },
      "POST /api/v1/planning/epics": {
        call: () => ({ body: { name: "Their lane" } }),
        expect: (response) => {
          // Created — in the stranger's own workspace, which the checks after every call confirm.
          expect(response.status).toBe(201);
          expect(bodyOf<EpicResource>(response)).toMatchObject({
            name: "Their lane",
            sortOrder: 1,
          });
        },
      },
      "PUT /api/v1/planning/epics/order": {
        call: (t) => ({ body: { epicIds: [t.epicId] } }),
        expect: (response) => {
          expect([response.status, bodyOf<ErrorEnvelope>(response).code]).toEqual([
            422,
            PLANNING_ERRORS.reorderIncomplete,
          ]);
        },
      },
      "GET /api/v1/planning/epics/:epic": {
        call: (t) => ({ params: { epic: t.epicId } }),
        expect: epic,
      },
      "PATCH /api/v1/planning/epics/:epic": {
        call: (t) => ({ params: { epic: t.epicId }, body: { name: "Stolen" } }),
        expect: epic,
      },
      "DELETE /api/v1/planning/epics/:epic": {
        call: (t) => ({ params: { epic: t.epicId } }),
        expect: epic,
      },
      "GET /api/v1/planning/epics/:epic/tickets": {
        call: (t) => ({ params: { epic: t.epicId } }),
        expect: epic,
      },
      "POST /api/v1/planning/epics/:epic/tickets": {
        call: (t) => ({ params: { epic: t.epicId }, body: { ticketIds: [t.ticketId] } }),
        expect: epic,
      },
      "DELETE /api/v1/planning/epics/:epic/tickets": {
        call: (t) => ({ params: { epic: t.epicId }, body: { ticketIds: [t.ticketId] } }),
        expect: epic,
      },
      "GET /api/v1/planning/tickets": {
        call: () => ({ query: { q: "#800" } }),
        expect: (response) => {
          expect(response.status).toBe(200);
          expect(bodyOf<PlanningTicketSearchResource>(response).items).toEqual([]);
        },
      },
      "GET /api/v1/planning/sources/:source/milestones": {
        call: () => ({ params: { source: ours.sourceId } }),
        expect: notFound(PLANNING_ERRORS.sourceNotFound),
      },
    };

    let targets: Targets;
    let stranger: Person;
    let theirSlug: string;

    beforeAll(async () => {
      const epicId = await insertEpic(api, ours.bench.id, "Ours");
      const [ticketId] = await insertTickets(api, ours, [{ number: 800 }]);

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.epic_tickets (epic_id, ticket_id) values ($1, $2)`,
        [epicId, ticketId],
      );

      const { id: batchId } = await insertBatch(api, ours, {
        status: "pushing",
        epicId,
        blocks: [["OTA-1", "OTA-2"]],
      });

      targets = { batchId, epicId, ticketId };
      stranger = await api.signIn();
      theirSlug = (await api.workspace(stranger)).slug;
    });

    /**
     * Our workspace's rows the stranger's calls must not have moved.
     *
     * @returns A snapshot.
     */
    async function snapshot(): Promise<unknown> {
      const s = SCHEMA_NAME;
      const { rows } = await api.sql.query(
        `select
           (select json_agg(json_build_object('key', local_key, 'selected', selected,
                                              'state', push_state) order by local_key)
              from ${s}.ticket_drafts where batch_id = $1) as drafts,
           (select status from ${s}.draft_batches where id = $1) as batch_status,
           (select json_build_object('name', name, 'sort', sort_order)
              from ${s}.planning_epics where id = $2) as epic,
           (select count(*)::int from ${s}.epic_tickets where epic_id = $2) as links,
           (select count(*)::int from ${s}.draft_batches where organization_id = $3) as batches,
           (select count(*)::int from ${s}.planning_epics where organization_id = $3) as epics`,
        [targets.batchId, targets.epicId, ours.bench.id],
      );

      return rows[0];
    }

    it("has a case for every route the controllers declare", () => {
      expect(Object.keys(CASES).sort()).toEqual(routes.map((route) => route.key).sort());
    });

    it.each(routes.map((route) => [route.key, route] as const))(
      "%s — from another workspace, reaches nothing of ours",
      async (_, route) => {
        const isolation = CASES[route.key];
        const before = await snapshot();
        const issuesBefore = github.issues.length;
        const plansBefore = engine.plans.length;

        // As the owner of their own workspace, so no role check stands between them and the data.
        const response = await send(route, theirSlug, stranger, isolation.call(targets));

        isolation.expect(response, targets);
        await expect(snapshot()).resolves.toEqual(before);
        expect(github.issues).toHaveLength(issuesBefore);
        expect(engine.plans).toHaveLength(plansBefore);
      },
    );

    it.each(routes.map((route) => [route.key, route] as const))(
      "%s — naming our workspace without belonging to it is a 404",
      async (_, route) => {
        const before = await snapshot();
        const response = await send(
          route,
          ours.bench.slug,
          stranger,
          CASES[route.key].call(targets),
        );

        expect(response.status).toBe(404);
        await expect(snapshot()).resolves.toEqual(before);
      },
    );

    it("leaves the stranger's epics in their own workspace", async () => {
      await expect(
        countOf(
          api,
          `select count(*)::int as count from ${SCHEMA_NAME}.planning_epics
            where organization_id = $1 and name = 'Their lane'`,
          [ours.bench.id],
        ),
      ).resolves.toBe(0);
    });
  });
});
