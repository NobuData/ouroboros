import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import request from "supertest";

import { ApiHarness, TENANTS, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf, uniqueEmail, uniqueName } from "../../testing/integration.fixture";
import type { TenantRole } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { DomainResource, OrgResource } from "./resources";
import { ADMINISTRATORS } from "./roles.guard";

/**
 * Who may do what in a workspace, as a matrix — every guarded route against every caller.
 *
 * > *Removing a guard or constraint turns it red.*
 *
 * That is [#37](https://github.com/NobuData/ouroboros/issues/37)'s second acceptance
 * criterion, and it is the one a suite has to be built *for*. `roles.guard.spec.ts` already
 * proves the guard refuses a role that is not in its list — with a `Reflector` the test wrote
 * the metadata into. What it cannot prove is that the metadata is *there*: delete
 * `@Roles(...ADMINISTRATORS)` from a controller and every unit spec in this module still
 * passes, because none of them go through the router that reads it.
 *
 * So this enumerates the surface instead. Fifteen operations — every route under
 * `/api/v1/tenants/{tenantId}` — against six callers: the four roles V002 admits, somebody
 * who belongs to another workspace, and a browser with no session. Each answer is the whole
 * pipeline: session guard, tenant guard, roles guard, validation pipe, handler, error filter.
 *
 * **Three answers, and the difference between them is the design.** An administrator gets the
 * operation. A member or a viewer gets `403` naming their role, because they have already
 * proved they belong and the only useful thing to tell them is that their role is too low.
 * Everybody else gets `404`, identical to the answer for a workspace that does not exist,
 * because `403` there would confirm that an identifier names something real.
 *
 * The expectations are derived from {@link ADMINISTRATORS} rather than written out per row,
 * so widening who administers a workspace is one edit here as it is one edit there — and a
 * test below pins that list, so the widening is a decision somebody made rather than one this
 * file quietly agreed to. A second test counts the decorators in the controllers, so a route
 * added without a row here fails rather than going unmentioned.
 *
 * It runs on the #37 harness, so it needs nothing but Docker:
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** What every row this suite creates is named with. */
const PREFIX = "ouro-roles";

/** The four roles `tenant_members_role_valid` admits, in the order V002 declares them. */
const ROLES: readonly TenantRole[] = ["owner", "admin", "member", "viewer"];

/** The controllers this matrix claims to cover, in this directory. */
const CONTROLLERS = [
  "tenants.controller.ts",
  "domains.controller.ts",
  "members.controller.ts",
  "orgs.controller.ts",
  "repos.controller.ts",
];

/** The workspace one test operates in, and the subjects it operates on. */
interface World {
  /** The workspace itself. */
  tenantId: string;
  /** A domain it has already claimed, for the operations that change or remove one. */
  domainId: string;
  /** An organisation it has already recorded. */
  orgLogin: string;
  /** Somebody whose membership can be changed or removed — the viewer. */
  memberId: string;
}

/** One route, and what it answers when the caller is allowed to ask. */
interface Operation {
  /** How the test reads. */
  name: string;
  /** The verb. */
  method: Method;
  /** Where it goes, given the world the test built. */
  path: (world: World) => string;
  /** What it sends. A function, so a fresh unique value is minted per call. */
  body?: () => object;
  /** What an administrator gets. */
  success: number;
  /** Whether the route carries `@Roles(…)`. No read does; every mutation does. */
  administered: boolean;
}

/** Every route under a workspace, and what it takes to be allowed to use it. */
const OPERATIONS: readonly Operation[] = [
  {
    name: "read the workspace",
    method: "get",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}`,
    success: 200,
    administered: false,
  },
  {
    name: "list its domains",
    method: "get",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/domains`,
    success: 200,
    administered: false,
  },
  {
    name: "list its members",
    method: "get",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/members`,
    success: 200,
    administered: false,
  },
  {
    name: "list its organisations",
    method: "get",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/orgs`,
    success: 200,
    administered: false,
  },
  {
    name: "list an organisation's repositories",
    method: "get",
    path: ({ tenantId, orgLogin }) => `${TENANTS}/${tenantId}/orgs/${orgLogin}/repos`,
    success: 200,
    administered: false,
  },
  {
    name: "rename the workspace",
    method: "patch",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}`,
    body: () => ({ displayName: "Renamed by the matrix" }),
    success: 200,
    administered: true,
  },
  {
    name: "claim a domain",
    method: "post",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/domains`,
    body: () => ({ domain: `${uniqueName(PREFIX)}.example` }),
    success: 201,
    administered: true,
  },
  {
    name: "make a domain the primary one",
    method: "patch",
    path: ({ tenantId, domainId }) => `${TENANTS}/${tenantId}/domains/${domainId}`,
    body: () => ({ isPrimary: true }),
    success: 200,
    administered: true,
  },
  {
    name: "give a domain up",
    method: "delete",
    path: ({ tenantId, domainId }) => `${TENANTS}/${tenantId}/domains/${domainId}`,
    success: 204,
    administered: true,
  },
  {
    name: "invite somebody",
    method: "post",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/members`,
    body: () => ({ email: uniqueEmail(PREFIX), role: "viewer" }),
    success: 201,
    administered: true,
  },
  {
    name: "change somebody's role",
    method: "patch",
    path: ({ tenantId, memberId }) => `${TENANTS}/${tenantId}/members/${memberId}`,
    body: () => ({ role: "member" }),
    success: 200,
    administered: true,
  },
  {
    name: "remove somebody",
    method: "delete",
    path: ({ tenantId, memberId }) => `${TENANTS}/${tenantId}/members/${memberId}`,
    success: 204,
    administered: true,
  },
  {
    name: "record an organisation",
    method: "post",
    path: ({ tenantId }) => `${TENANTS}/${tenantId}/orgs`,
    body: () => ({ login: uniqueName(PREFIX) }),
    success: 201,
    administered: true,
  },
  {
    name: "enable an organisation",
    method: "patch",
    path: ({ tenantId, orgLogin }) => `${TENANTS}/${tenantId}/orgs/${orgLogin}`,
    body: () => ({ enabled: true }),
    success: 200,
    administered: true,
  },
  {
    name: "enable a repository",
    method: "patch",
    path: ({ tenantId, orgLogin }) => `${TENANTS}/${tenantId}/orgs/${orgLogin}/repos/ouroboros`,
    body: () => ({ enabled: true }),
    success: 200,
    administered: true,
  },
];

/**
 * How often a pattern appears at the start of a line across the tenancy controllers.
 *
 * Line-anchored so a decorator quoted in a doc comment — which every controller in this
 * module does, at length — is not counted as one that was applied.
 *
 * @param pattern - The decorator, as a regular expression source fragment.
 * @returns The number of applications.
 */
function decoratorCount(pattern: string): number {
  return CONTROLLERS.reduce((total, file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    const applications = source.match(new RegExp(`^\\s*@${pattern}\\(`, "gm"));

    return total + (applications?.length ?? 0);
  }, 0);
}

describe("who may do what in a workspace", () => {
  let api: ApiHarness;
  /** One person per role. Rebuilt per test — `truncate` takes `users` with everything else. */
  let people: Record<TenantRole, Person>;
  /** Somebody who holds no role anywhere. */
  let stranger: Person;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  beforeEach(async () => {
    people = {
      owner: await api.signIn({ email: `${PREFIX}-owner@example.test` }),
      admin: await api.signIn({ email: `${PREFIX}-admin@example.test` }),
      member: await api.signIn({ email: `${PREFIX}-member@example.test` }),
      viewer: await api.signIn({ email: `${PREFIX}-viewer@example.test` }),
    };
    stranger = await api.signIn({ email: `${PREFIX}-stranger@example.test` });
  });

  afterEach(() => api.truncate());

  /**
   * A workspace all four roles are held in, with something to operate on.
   *
   * Rebuilt per test rather than shared, because half the operations below change or destroy
   * their subject — the second caller to *give a domain up* would otherwise be asking about a
   * domain the first one deleted, and would get its `404` for a reason that has nothing to do
   * with their role.
   *
   * @returns The workspace and its subjects.
   */
  async function aWorkspace(): Promise<World> {
    const tenant = await api.workspace(people.owner, uniqueName(PREFIX));
    const owner = api.as(people.owner);

    // The creator is already the owner (#32), so only the other three join.
    await api.join(tenant.id, people.admin, "admin");
    await api.join(tenant.id, people.member, "member");
    await api.join(tenant.id, people.viewer, "viewer");

    const domain = bodyOf<DomainResource>(
      await owner("post", `${TENANTS}/${tenant.id}/domains`)
        .send({ domain: `${uniqueName(PREFIX)}.example` })
        .expect(201),
    );
    const org = bodyOf<OrgResource>(
      await owner("post", `${TENANTS}/${tenant.id}/orgs`)
        .send({ login: uniqueName(PREFIX) })
        .expect(201),
    );
    await owner("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
      .send({ enabled: true })
      .expect(200);

    return {
      tenantId: tenant.id,
      domainId: domain.id,
      orgLogin: org.login,
      memberId: people.viewer.id,
    };
  }

  /**
   * Send one operation as one person.
   *
   * @param operation - Which route.
   * @param world - The workspace it operates in.
   * @param person - Who is asking, or `undefined` for a browser with no session.
   * @returns Supertest's response, whatever its status.
   */
  async function attempt(
    operation: Operation,
    world: World,
    person: Person | undefined,
  ): Promise<request.Response> {
    const send = person === undefined ? api.anonymous.bind(api) : api.as(person);
    const sent = send(operation.method, operation.path(world));

    return operation.body === undefined ? await sent : await sent.send(operation.body());
  }

  /**
   * What a role is entitled to on a route.
   *
   * @param operation - The route.
   * @param role - The caller's role in the workspace.
   * @returns The status they should get.
   */
  function entitlement(operation: Operation, role: TenantRole): number {
    if (!operation.administered) {
      return operation.success;
    }

    return ADMINISTRATORS.includes(role) ? operation.success : 403;
  }

  describe("the matrix itself", () => {
    it("is written against the list of roles the module calls administrators", () => {
      // The expectations are derived from this list, so a change to it changes them. That is
      // the right coupling — one place decides who administers a workspace — and this is what
      // stops it from being silent: widening it turns this red, and a widening is exactly the
      // change that should need a second pair of eyes.
      expect(ADMINISTRATORS).toEqual(["owner", "admin"]);
      expect(ROLES).toEqual(expect.arrayContaining([...ADMINISTRATORS]));
    });

    it("has a row for every route the controllers publish under a workspace", () => {
      // Two routes are `@TenantOptional()` — listing your workspaces and creating one — and
      // are not under a workspace at all, so they are not this matrix's to cover.
      const routes = ["Get", "Post", "Patch", "Delete"].reduce(
        (total, verb) => total + decoratorCount(verb),
        0,
      );

      expect(OPERATIONS).toHaveLength(routes - decoratorCount("TenantOptional"));
    });

    it("has an administered row for every @Roles() the controllers apply", () => {
      const administered = OPERATIONS.filter((operation) => operation.administered);

      expect(administered).toHaveLength(decoratorCount("Roles"));
    });
  });

  describe.each(OPERATIONS)("$name", (operation: Operation) => {
    it.each(ROLES)("answers a %s", async (role) => {
      const expected = entitlement(operation, role);
      const world = await aWorkspace();

      const response = await attempt(operation, world, people[role]);

      expect(response.status).toBe(expected);

      if (expected === 403) {
        // The refusal names the role and what would have sufficed, which is the whole of what
        // a `403` is allowed to say here.
        expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
          code: "forbidden",
          details: { role, required: [...ADMINISTRATORS] },
        });
      }
    });

    it("answers 404 to somebody who belongs to another workspace", async () => {
      // Not 403: the workspace's existence is not theirs to learn.
      // `tenancy.integration-spec.ts` proves this answer is identical to the one for an
      // identifier that names nothing.
      const world = await aWorkspace();

      const response = await attempt(operation, world, stranger);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorEnvelope>(response).code).toBe("tenant_not_found");
    });

    it("answers 401 to a browser with no session", async () => {
      // The session guard runs first, so this is the answer before the question of a role is
      // reached at all.
      const world = await aWorkspace();

      const response = await attempt(operation, world, undefined);

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorEnvelope>(response).code).toBe("unauthenticated");
    });
  });
});
