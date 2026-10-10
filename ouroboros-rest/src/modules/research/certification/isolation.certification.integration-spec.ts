/**
 * Every research route, isolated and gated, certified over the development seeds (CM.7,
 * [#626](https://github.com/NobuData/ouroboros/issues/626)).
 *
 * The seeded workspace holds one of everything the research plane serves — four featured
 * investigations with a brief, a matrix, a roadmap and its suggestions, rivals and their
 * watches, a document import, the regression watch's items. A second, empty workspace asks
 * every route for those things by their seeded ids and must be told there is nothing
 * (`404`), or read a collection holding none of them; and in the seeded workspace the lowest
 * role each route refuses is refused (`403`): a viewer cannot start, a member cannot cancel
 * what they did not start, nothing that writes to a repository or a tracker is below an admin,
 * and a document import is an owner's.
 *
 * The table is held against the router's own list: a research route added without a line here
 * fails the first test, naming itself. Tool configuration and price-affecting routes do not
 * exist yet (CN.3, #629); when they do they arrive here as a line each.
 */

import request from "supertest";

import { routeTable } from "../../auth/route.table.fixture";
import {
  ApiHarness,
  type Method,
  type Person,
  type Workspace,
} from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME, type OrganizationRole } from "../../db/schema";
import { EngineClient } from "../../engine/engine.client";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { fillRoute } from "../../planning/planning.routes.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import type { WatchSettingsResource } from "../watch/watch.resources";
import { seedResearch, type SeededResearch } from "./certification.fixture";

const API = "/api/v1/research";
const INTERNAL = "/internal/research";

/** How a route is held. */
interface RouteCase {
  readonly about: string;
  /**
   * `entity` — the other workspace asks for ours by id and is told `404`;
   * `collection` — the other workspace reads it and holds none of ours;
   * `stateless` — the other workspace may call it and sees none of ours;
   * `config` — the other workspace writes its own and ours is unchanged;
   * `internal` — the engine-facing surface, refused without the shared secret.
   */
  readonly kind: "entity" | "collection" | "stateless" | "config" | "internal";
  /** The highest role the route refuses in our own workspace, when it gates by role. */
  readonly refusedAs?: OrganizationRole;
  /** A body the route's validation accepts, so a refusal is the guard's and not the pipe's. */
  readonly body?: object;
}

describe("every research route, isolated and gated, certified over the seeds", () => {
  let api: ApiHarness;
  let mine: SeededResearch;
  let theirs: { owner: Person; workspace: Workspace };
  /** Every seeded id a response of the other workspace must not carry. */
  let ours: string[];
  /** The `:name` parameters, filled from the seeds. */
  let params: Record<string, string>;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RESEARCH_ROADMAP_TICK_MS: "0" });
    mine = await seedResearch(api);

    const owner = await api.signIn();

    theirs = { owner, workspace: await api.workspace(owner) };

    const rs127 = await mine.investigation("RS-127");
    const rs124 = await mine.investigation("RS-124");
    const { rows } = await api.sql.query<{ kind: string; id: string }>(
      `select 'competitor' as kind, c.id::text from ${SCHEMA_NAME}.competitors c where c.organization_id = $1
       union all
       select 'watch', w.id::text from ${SCHEMA_NAME}.competitor_watches w
         join ${SCHEMA_NAME}.competitors c on c.id = w.competitor_id where c.organization_id = $1
       union all
       select 'import', i.id::text from ${SCHEMA_NAME}.document_imports i where i.organization_id = $1
       union all
       select 'item', r.id::text from ${SCHEMA_NAME}.regression_watch_items r where r.organization_id = $1
       union all
       select 'doc', d.id::text from ${SCHEMA_NAME}.roadmap_docs d where d.organization_id = $1
       union all
       select 'suggestion', s.id::text from ${SCHEMA_NAME}.doc_suggestions s
         join ${SCHEMA_NAME}.roadmap_docs d on d.id = s.doc_id
        where d.organization_id = $1 and s.status = 'open'
       union all
       select 'investigation', i.id::text from ${SCHEMA_NAME}.investigations i where i.organization_id = $1`,
      [mine.workspace.id],
    );
    const first = (kind: string): string => {
      const row = rows.find((candidate) => candidate.kind === kind);

      if (row === undefined)
        throw new Error(`The seeds hold no ${kind} in ${mine.workspace.slug}.`);

      return row.id;
    };

    ours = [...new Set(rows.map((row) => row.id))];
    params = {
      investigationId: rs127.id,
      // The loop's internal routes spell the same parameter `:id`.
      id: rs127.id,
      suggestionId: first("suggestion"),
      itemId: first("item"),
      competitorId: first("competitor"),
      watchId: first("watch"),
      importId: first("import"),
      slug: "web",
      op: "search",
    };

    // The roadmap routes address RS-124, the investigation with a document.
    params.roadmapInvestigationId = rs124.id;
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A request as somebody, in a workspace. */
  function as(person: Person, workspace: Workspace, method: Method, path: string): request.Test {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** The person holding a role in the seeded workspace. */
  function holder(role: OrganizationRole): Person {
    return mine.people[role];
  }

  /** The path with every parameter filled from the seeds. */
  function filled(path: string): string {
    const values = path.includes("/roadmap")
      ? { ...params, investigationId: params.roadmapInvestigationId }
      : params;

    return fillRoute(path, values);
  }

  function refused(response: request.Response, status: number): ErrorEnvelope {
    expect({ status: response.status, body: response.body as unknown }).toMatchObject({ status });

    return bodyOf<ErrorEnvelope>(response);
  }

  /**
   * The claim made about each route, by signature.
   */
  const CASES: Readonly<Record<string, RouteCase>> = {
    // ── the composer's catalogs (#628) ───────────────────────────────────────────────────────
    [`GET ${API}/kinds`]: { about: "reads the caller's own kinds", kind: "collection" },
    [`GET ${API}/tools`]: {
      about: "is the installation's, and names no workspace",
      kind: "stateless",
    },

    // ── estimates, settings ──────────────────────────────────────────────────────────────────
    [`POST ${API}/estimates`]: {
      about: "estimates for the caller's own workspace only",
      kind: "stateless",
      body: { kind: "gap_analysis", depth: "quick", tools: ["web"] },
    },
    [`GET ${API}/settings`]: { about: "reads the caller's own settings", kind: "collection" },
    [`PATCH ${API}/settings`]: {
      about: "is an admin's, and changes the caller's own workspace only",
      kind: "config",
      refusedAs: "member",
      body: { startRole: "admin" },
    },

    // ── investigations ───────────────────────────────────────────────────────────────────────
    [`POST ${API}/investigations`]: {
      about: "starts in the caller's own workspace, and not for a viewer",
      kind: "stateless",
      refusedAs: "viewer",
      body: {
        question: "Does isolation hold?",
        kind: "gap_analysis",
        depth: "quick",
        tools: ["web"],
      },
    },
    [`GET ${API}/investigations`]: { about: "lists none of theirs", kind: "collection" },
    [`GET ${API}/investigations/:investigationId`]: { about: "cannot read theirs", kind: "entity" },
    [`GET ${API}/investigations/:investigationId/progress`]: {
      about: "cannot follow theirs",
      kind: "entity",
    },
    [`POST ${API}/investigations/:investigationId/cancel`]: {
      about: "cannot cancel theirs, nor one they did not start",
      kind: "entity",
      refusedAs: "member",
    },
    [`GET ${API}/investigations/:investigationId/brief`]: {
      about: "cannot read their brief",
      kind: "entity",
    },
    [`GET ${API}/investigations/:investigationId/sources`]: {
      about: "cannot read their ledger",
      kind: "entity",
    },
    [`GET ${API}/investigations/:investigationId/brief/export`]: {
      about: "cannot export their brief",
      kind: "entity",
    },

    // ── the gaps hand-off and the roadmap pipeline ───────────────────────────────────────────
    [`POST ${API}/investigations/:investigationId/draft-epic`]: {
      about: "cannot draft from their gaps, and a viewer cannot draft at all",
      kind: "entity",
      refusedAs: "viewer",
      body: {},
    },
    [`POST ${API}/investigations/:investigationId/roadmap`]: {
      about: "cannot generate their roadmap, and a member cannot write a repository",
      kind: "entity",
      refusedAs: "member",
      body: {},
    },
    [`GET ${API}/investigations/:investigationId/roadmap`]: {
      about: "cannot read their roadmap",
      kind: "entity",
    },
    [`POST ${API}/investigations/:investigationId/roadmap/suggestions`]: {
      about: "cannot suggest on theirs, and a viewer cannot suggest",
      kind: "entity",
      refusedAs: "viewer",
      body: { text: "Pull the gust estimator into MVP." },
    },
    [`POST ${API}/investigations/:investigationId/roadmap/suggestions/:suggestionId/apply`]: {
      about: "cannot apply theirs, and a member cannot re-run the skill",
      kind: "entity",
      refusedAs: "member",
    },
    [`POST ${API}/investigations/:investigationId/roadmap/suggestions/:suggestionId/dismiss`]: {
      about: "cannot dismiss theirs, and a member cannot dismiss",
      kind: "entity",
      refusedAs: "member",
    },
    [`POST ${API}/investigations/:investigationId/roadmap/issues`]: {
      about: "cannot file theirs, and a member cannot write a tracker",
      kind: "entity",
      refusedAs: "member",
      body: {},
    },
    [`POST ${API}/investigations/:investigationId/roadmap/drift-check`]: {
      about: "cannot check theirs, and a viewer cannot check",
      kind: "entity",
      refusedAs: "viewer",
    },
    [`GET ${API}/roadmap-settings`]: { about: "reads the caller's own policy", kind: "collection" },
    [`PUT ${API}/roadmap-settings`]: {
      about: "is an admin's, and changes the caller's own workspace only",
      kind: "config",
      refusedAs: "member",
      body: { directCommit: true },
    },

    // ── the regression watch ─────────────────────────────────────────────────────────────────
    [`GET ${API}/regression-watch`]: { about: "shows none of their items", kind: "collection" },
    [`GET ${API}/regression-watch/settings`]: {
      about: "reads the caller's own watch",
      kind: "collection",
    },
    [`PUT ${API}/regression-watch/settings`]: {
      about: "is an admin's, and changes the caller's own workspace only",
      kind: "config",
      refusedAs: "member",
      body: { autoFile: true },
    },
    [`POST ${API}/regression-watch/baselines`]: {
      about: "captures for the caller's own workspace, and not below an admin",
      kind: "stateless",
      refusedAs: "member",
      body: { repository: "acme-robotics/helios-firmware", releaseTag: "v0.0.0-isolation" },
    },
    [`POST ${API}/regression-watch/comparisons`]: {
      about: "compares the caller's own workspace, and not below an admin",
      kind: "stateless",
      refusedAs: "member",
    },
    [`POST ${API}/regression-watch/items/:itemId/dismiss`]: {
      about: "cannot dismiss their item, and a member cannot dismiss",
      kind: "entity",
      refusedAs: "member",
      body: { reason: "Not a regression." },
    },

    // ── competitors ──────────────────────────────────────────────────────────────────────────
    [`GET ${API}/competitors`]: { about: "lists none of their rivals", kind: "collection" },
    [`GET ${API}/competitor-changes`]: { about: "shows none of their changes", kind: "collection" },
    [`POST ${API}/competitors`]: {
      about: "adds to the caller's own workspace, and not below an admin",
      kind: "stateless",
      refusedAs: "member",
      body: { name: "Isolation Aero" },
    },
    [`PATCH ${API}/competitors/:competitorId`]: {
      about: "cannot rename theirs, and a member cannot rename",
      kind: "entity",
      refusedAs: "member",
      body: { name: "Renamed" },
    },
    [`DELETE ${API}/competitors/:competitorId`]: {
      about: "cannot delete theirs, and a member cannot delete",
      kind: "entity",
      refusedAs: "member",
    },
    [`POST ${API}/competitors/:competitorId/watches`]: {
      about: "cannot watch for theirs, and a member cannot watch",
      kind: "entity",
      refusedAs: "member",
      body: { sourceKind: "page", url: "https://example.com/changelog" },
    },
    [`PATCH ${API}/competitors/:competitorId/watches/:watchId`]: {
      about: "cannot change their watch, and a member cannot change one",
      kind: "entity",
      refusedAs: "member",
      body: { enabled: false },
    },
    [`DELETE ${API}/competitors/:competitorId/watches/:watchId`]: {
      about: "cannot delete their watch, and a member cannot delete one",
      kind: "entity",
      refusedAs: "member",
    },

    // ── document imports ─────────────────────────────────────────────────────────────────────
    [`GET ${API}/document-imports`]: { about: "lists none of their imports", kind: "collection" },
    [`POST ${API}/document-imports`]: {
      about: "imports into the caller's own workspace, and is an owner's",
      kind: "stateless",
      refusedAs: "admin",
      body: { collection: "support", name: "isolation", format: "ndjson", content: "" },
    },
    [`GET ${API}/document-imports/:importId`]: {
      about: "cannot read their import",
      kind: "entity",
    },
    [`DELETE ${API}/document-imports/:importId`]: {
      about: "cannot remove their import, and is an owner's",
      kind: "entity",
      refusedAs: "admin",
    },

    // ── the engine-facing surface ────────────────────────────────────────────────────────────
    [`POST ${INTERNAL}/investigations/:id/start`]: { about: "needs the key", kind: "internal" },
    [`PUT ${INTERNAL}/investigations/:id/checkpoint`]: { about: "needs the key", kind: "internal" },
    [`POST ${INTERNAL}/investigations/:id/brief`]: { about: "needs the key", kind: "internal" },
    [`POST ${INTERNAL}/investigations/:id/finish`]: { about: "needs the key", kind: "internal" },
    [`POST ${INTERNAL}/tools/:slug/:op`]: { about: "needs the key", kind: "internal" },
    [`POST ${INTERNAL}/regression-watch/releases`]: { about: "needs the key", kind: "internal" },
  };

  function researchRoutes(): string[] {
    return routeTable(api.nest)
      .filter((route) => route.path.startsWith(API) || route.path.startsWith(INTERNAL))
      .map((route) => route.signature)
      .sort();
  }

  it("HAS A CLAIM FOR EVERY RESEARCH ROUTE THE APPLICATION REGISTERS", () => {
    expect(researchRoutes()).toEqual(Object.keys(CASES).sort());
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(([signature, value]) => [signature, value.about, value] as const),
    )("%s — %s", async (signature, _about, route) => {
      const [verb, path] = signature.split(" ") as [string, string];
      const method = verb.toLowerCase() as Method;
      const send = (test: request.Test): request.Test =>
        route.body === undefined ? test : test.send(route.body);

      switch (route.kind) {
        case "entity": {
          // The other workspace, asking for ours by its seeded id: there is no such thing.
          refused(await send(as(theirs.owner, theirs.workspace, method, filled(path))), 404);
          break;
        }
        case "collection": {
          const response = await send(as(theirs.owner, theirs.workspace, method, filled(path)));

          expect(response.status).toBeLessThan(300);
          for (const id of ours) expect(JSON.stringify(response.body)).not.toContain(id);
          break;
        }
        case "stateless": {
          jest.spyOn(api.nest.get(EngineClient), "investigate").mockImplementation((request) =>
            Promise.resolve({
              investigation: request.investigation,
              task: `investigate:${request.investigation}`,
              state: "accepted",
              loopVersion: "loop-v1",
            }),
          );

          const response = await send(as(theirs.owner, theirs.workspace, method, filled(path)));

          expect(response.status).toBeLessThan(500);
          for (const id of ours) expect(JSON.stringify(response.body)).not.toContain(id);
          break;
        }
        case "config": {
          const before = await as(holder("viewer"), mine.workspace, "get", filled(path)).expect(
            200,
          );

          await send(as(theirs.owner, theirs.workspace, method, filled(path))).expect(200);

          const after = await as(holder("viewer"), mine.workspace, "get", filled(path)).expect(200);

          expect(after.body).toEqual(before.body);
          break;
        }
        case "internal": {
          // No key, and a session is not a key.
          refused(await send(request(api.baseUrl)[method](filled(path))), 401);
          refused(await send(as(holder("owner"), mine.workspace, method, filled(path))), 401);
          return;
        }
      }

      if (route.refusedAs !== undefined) {
        refused(await send(as(holder(route.refusedAs), mine.workspace, method, filled(path))), 403);
      }
    });
  });

  it("left the seeded workspace's watch policy and roadmap policy as the seed wrote them", async () => {
    const watch = bodyOf<WatchSettingsResource>(
      await as(holder("viewer"), mine.workspace, "get", `${API}/regression-watch/settings`).expect(
        200,
      ),
    );
    const roadmap = bodyOf<{ directCommit: boolean }>(
      await as(holder("viewer"), mine.workspace, "get", `${API}/roadmap-settings`).expect(200),
    );

    expect(watch.autoFile).toBe(false);
    expect(roadmap.directCommit).toBe(false);
  });
});
