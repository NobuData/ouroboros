import { CREATOR_ROLE, ORGANIZATION_ROLES } from "../../auth/organization.roles";
import { PERSONAL_ORGANIZATION_METADATA } from "../../auth/active.organization";
import { ApiHarness, AUTH, ORGS, type Person } from "../../testing/harness.fixture";
import { bodyOf, uniqueName } from "../../testing/integration.fixture";
import { SCHEMA_NAME, type OrganizationRole } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "./pagination";
import type { OrgRowResource } from "./resources";
import { ORGANIZATION_ID_PATTERN } from "./tenancy.dto";
import { TENANT_HEADER } from "./tenant.resolver";

/**
 * Workspaces, through the routes that actually make them — the organization plugin's.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s fourth bullet: *org operations —
 * list, set-active, and the full role matrix.* Those routes are BetterAuth's, mounted at
 * `/api/auth/organization/*` by [#704](https://github.com/NobuData/ouroboros/issues/704), and
 * until this issue **nothing exercised a single one of them.** They could not be: the
 * integration suite replaced the library, and `organization.plugin.spec.ts` can only assert
 * the options object it is configured with.
 *
 * That gap mattered more than a gap usually does, because
 * [#714](https://github.com/NobuData/ouroboros/issues/714) deleted this service's own
 * workspace routes in favour of them. Creating a workspace, choosing one, inviting somebody
 * and changing a role are now entirely the plugin's, so a suite that skipped the plugin
 * skipped tenancy's write path in its entirety.
 *
 * ## The three seams this covers, and why each needs a database
 *
 *   1. **What the plugin does with this service's options** — the four roles including the
 *      `viewer` the library does not ship, the creator's role, and `stripPersonalFlag`, which
 *      is the one rule `organization.plugin.ts` enforces on its own account and is invisible
 *      until a request carries the flag it strips.
 *   2. **What the plugin writes, and what this service then reads.** `set-active` moves
 *      `session."activeOrganizationId"`, and #713 made that the tenant this service resolves.
 *      Two systems agreeing across a column is the definition of something a mock cannot
 *      certify.
 *   3. **The role matrix over the plugin's own access control.** `roles.integration-spec.ts`
 *      is the matrix for this service's routes and its `@Roles()` decorators; this is the
 *      matrix for the routes that left. Together they cover every guarded operation under a
 *      workspace.
 *
 * ## The regression this suite exists to have caught
 *
 * A workspace created here gets the plugin's id — 32 characters, not a uuid — and every route
 * under `/api/v1/orgs/{orgId}` validated that parameter as a uuid. So **every workspace made
 * after #714 answered `422` on its own domains, GitHub organisations and repositories**, while
 * `GET /api/v1/orgs` listed it happily. Nothing caught it because nothing created a workspace
 * the way a person does: the seed is back-filled from `tenants` and carries uuids, and
 * `roles.integration-spec.ts` inserts its own. #715 fixed it — `ORGANIZATION_ID_PATTERN` — and
 * the cases under *a workspace created the way a person creates one* are the regression.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** What every row this suite names for itself is prefixed with. */
const PREFIX = "ouro-orgs";

/** An organization, as the plugin answers with one. */
interface OrganizationBody {
  /** Its id — the plugin's, unless V006 back-filled the row. */
  readonly id: string;
  /** Its handle. */
  readonly slug: string;
  /** What a human reads. */
  readonly name: string;
  /**
   * Whatever was stored, as the plugin returns it.
   *
   * A string on the routes that read a row back and an object on `create`, which is the
   * library's own inconsistency rather than this service's — {@link metadataOf} is where that
   * is absorbed rather than at every call site.
   */
  readonly metadata?: string | Record<string, unknown> | null;
}

/** One membership, as `get-full-organization` lists it. */
interface MemberBody {
  /** The `member.id` — what `update-member-role` and `remove-member` name. */
  readonly id: string;
  /** Whose. */
  readonly userId: string;
  /** What they hold. */
  readonly role: string;
}

/** What `get-full-organization` answers with. */
interface FullOrganizationBody extends OrganizationBody {
  /** Everybody in it. */
  readonly members: readonly MemberBody[];
}

/** What the plugin answers a refused operation with — its own shape, not this service's. */
interface PluginFailureBody {
  /** The library's code. */
  readonly code: string;
  /** The sentence it goes with. */
  readonly message: string;
}

describe("workspaces, through the organization plugin", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * Whatever the plugin stored as metadata, as an object.
   *
   * @param organization - A body from any of the plugin's organization routes.
   * @returns The metadata, or `{}` when there is none.
   */
  function metadataOf(organization: OrganizationBody): Record<string, unknown> {
    const { metadata } = organization;

    if (metadata === undefined || metadata === null) {
      return {};
    }

    return typeof metadata === "string"
      ? (JSON.parse(metadata) as Record<string, unknown>)
      : metadata;
  }

  /**
   * Create a workspace the way a person does — over the plugin's route.
   *
   * @param owner - Who creates it, and therefore who owns it.
   * @param body - What to send. A unique slug is supplied when the caller does not care.
   * @returns The workspace the plugin made.
   */
  async function create(
    owner: Person,
    body: Record<string, unknown> = {},
  ): Promise<OrganizationBody> {
    const response = await api
      .as(owner)("post", `${AUTH}/organization/create`)
      .send({ name: "Acme Robotics", slug: uniqueName(PREFIX), ...body })
      .expect(200);

    return bodyOf<OrganizationBody>(response);
  }

  /**
   * The session's active workspace, read from the row rather than from an answer.
   *
   * @param person - Whose session.
   * @returns The id it points at, or `null`.
   */
  async function activeOrganizationOf(person: Person): Promise<string | null> {
    const { rows } = await api.sql.query<{ activeOrganizationId: string | null }>(
      `select "activeOrganizationId" from ${SCHEMA_NAME}.session
        where "userId" = $1 order by "createdAt" desc limit 1`,
      [person.id],
    );

    return rows[0].activeOrganizationId;
  }

  describe("the ids it mints", () => {
    it("are the shape every route under a workspace validates", async () => {
      // **A drift check, and the one that would have caught #715's regression on the day the
      // library changed rather than months later.** `ORGANIZATION_ID_PATTERN` admits two
      // shapes because two things write the column; this asserts the plugin still writes one
      // of them. A `better-auth` upgrade that moved to a uuid, or to a longer id, fails here
      // with the value in the message.
      const owner = await api.signUp();
      const workspace = await create(owner);

      expect(workspace.id).toMatch(ORGANIZATION_ID_PATTERN);
    });

    it("are not uuids, which is the fact the old rule got wrong", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner);

      expect(workspace.id).toHaveLength(32);
      expect(workspace.id).not.toContain("-");
    });
  });

  describe("creating one", () => {
    it("makes the caller its owner — the one role nobody else can grant", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner, { name: "Acme Robotics" });

      const { rows } = await api.sql.query<{ role: string }>(
        `select "role" from ${SCHEMA_NAME}.member
          where "organizationId" = $1 and "userId" = $2`,
        [workspace.id, owner.id],
      );

      expect(rows).toEqual([{ role: CREATOR_ROLE }]);
    });

    it("makes the new workspace the one the session is acting in", async () => {
      // The plugin's own behaviour rather than this service's, and it is what makes mockup 01
      // Step 2's *create and enter* one call: a workspace made and not entered would leave the
      // caller's next request landing in the personal organization they just left.
      const owner = await api.signUp();
      const personal = await activeOrganizationOf(owner);
      const workspace = await create(owner);

      expect(workspace.id).not.toBe(personal);
      expect(await activeOrganizationOf(owner)).toBe(workspace.id);
    });

    it("strips a `personal` flag the client asked for, and keeps the rest", async () => {
      // `stripPersonalFlag`, as behaviour. Without it anybody could create a workspace wearing
      // the pill that means *this one is yours alone*, invite four colleagues into it, and
      // leave the one screen whose job is to say where somebody's work is going telling them
      // something false.
      const owner = await api.signUp();

      const workspace = await create(owner, {
        metadata: { personal: true, industry: "robotics" },
      });

      expect(metadataOf(workspace)).toEqual({ industry: "robotics" });
    });

    it("stores no metadata at all when the flag was the only thing in it", async () => {
      const owner = await api.signUp();

      const workspace = await create(owner, { metadata: { personal: true } });

      expect(metadataOf(workspace)).toEqual({});
    });

    it("leaves the personal organization the session hook made wearing its flag", async () => {
      // The other direction, and what makes the rule above worth having: `personal` is not
      // forbidden, it is *reserved* — `active.organization.ts` is the only thing that may set
      // it, and it still does.
      const owner = await api.signUp({ displayName: "Maya Chen" });

      const listed = bodyOf<OrganizationBody[]>(
        await api.as(owner)("get", `${AUTH}/organization/list`).expect(200),
      );

      expect(listed).toHaveLength(1);
      expect(metadataOf(listed[0])).toEqual(PERSONAL_ORGANIZATION_METADATA);
    });
  });

  describe("listing them", () => {
    it("answers the caller's own, and says nothing about anybody else's", async () => {
      // It answers from the session, so there is no id to pass and no way to ask about
      // somebody else's memberships — which is why `auth.routes.ts` describes it as it does.
      const owner = await api.signUp();
      const stranger = await api.signUp();
      const personal = await activeOrganizationOf(owner);
      const mine = await create(owner, { name: "Acme Robotics" });
      await create(stranger, { name: "Someone Else" });

      const listed = bodyOf<OrganizationBody[]>(
        await api.as(owner)("get", `${AUTH}/organization/list`).expect(200),
      );

      expect(listed.map((each) => each.id).sort()).toEqual([personal, mine.id].sort());
    });

    it("includes a workspace somebody was added to, not only the ones they made", async () => {
      const owner = await api.signUp();
      const colleague = await api.signUp();
      const workspace = await create(owner);
      await api.join(workspace.id, colleague, "member");

      const listed = bodyOf<OrganizationBody[]>(
        await api.as(colleague)("get", `${AUTH}/organization/list`).expect(200),
      );

      expect(listed.map((each) => each.id)).toContain(workspace.id);
    });

    it("needs a session, like everything else the plugin serves", async () => {
      await api.anonymous("get", `${AUTH}/organization/list`).expect(401);
    });
  });

  describe("choosing where the loop runs", () => {
    it("writes the session row, which is what makes the tenant server state", async () => {
      // Decision **A5**, as a column. `setActiveOrganization` is the only thing that writes
      // it, which is the whole reason #713 could stop trusting a header.
      const owner = await api.signUp();
      const workspace = await create(owner);

      await api
        .as(owner)("post", `${AUTH}/organization/set-active`)
        .send({ organizationId: workspace.id })
        .expect(200);

      expect(await activeOrganizationOf(owner)).toBe(workspace.id);
    });

    it("moves where this service's own routes then operate", async () => {
      // The seam between the two systems, and the assertion that needed both halves real: the
      // plugin writes the column, and `tenant.resolver.ts` reads it on a route that names no
      // workspace at all.
      const owner = await api.signUp();
      const workspace = await create(owner, { name: "Acme Robotics" });
      const domain = `${uniqueName(PREFIX)}.example`;

      await api
        .as(owner)("post", `${AUTH}/organization/set-active`)
        .send({ organizationId: workspace.id })
        .expect(200);
      // No `{orgId}` and no `X-Ouro-Tenant`: where this lands is decided by the session alone.
      await api.as(owner)("post", `${ORGS}/${workspace.id}/domains`).send({ domain }).expect(201);

      const { rows } = await api.sql.query<{ organizationId: string }>(
        `select "organization_id" as "organizationId" from ${SCHEMA_NAME}.tenant_domains
          where "domain" = $1`,
        [domain],
      );
      expect(rows).toEqual([{ organizationId: workspace.id }]);
    });

    it("refuses a workspace the caller does not belong to", async () => {
      // A `403` from the plugin rather than this service's `404`, and the difference is whose
      // rule it is: the plugin answers about a membership the caller asserted, where
      // `tenant.resolver.ts` answers about an identifier they may have guessed. Both are
      // asserted, in the suites that own them.
      const owner = await api.signUp();
      const stranger = await api.signUp();
      const workspace = await create(owner);

      const response = await api
        .as(stranger)("post", `${AUTH}/organization/set-active`)
        .send({ organizationId: workspace.id })
        .expect(403);

      expect(bodyOf<PluginFailureBody>(response).code).toBe(
        "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      );
      expect(await activeOrganizationOf(stranger)).not.toBe(workspace.id);
    });
  });

  describe("what the caller may do where they are", () => {
    // `get-active-member-role` is the third part of the session question — who you are is
    // `get-session`, where you belong is `organization/list`, and what you hold there is this.
    // It is the route `GET /api/v1/auth/me` was deleted in favour of rather than
    // reimplemented, so every role answering correctly is #711's criterion as behaviour.
    it.each(ORGANIZATION_ROLES_UNDER_TEST())("answers a %s with their role", async (role) => {
      const owner = await api.signUp();
      const workspace = await create(owner);
      const person = role === CREATOR_ROLE ? owner : await api.signUp();

      if (person !== owner) {
        await api.join(workspace.id, person, role);
      }

      await api
        .as(person)("post", `${AUTH}/organization/set-active`)
        .send({ organizationId: workspace.id })
        .expect(200);

      const response = await api
        .as(person)("get", `${AUTH}/organization/get-active-member-role`)
        .expect(200);

      expect(bodyOf<{ role: string }>(response).role).toBe(role);
    });

    it("answers about a workspace named explicitly, not only the active one", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner);

      const response = await api
        .as(owner)("get", `${AUTH}/organization/get-active-member-role`)
        .query({ organizationId: workspace.id })
        .expect(200);

      expect(bodyOf<{ role: string }>(response).role).toBe(CREATOR_ROLE);
    });
  });

  describe("the plugin's role matrix", () => {
    /**
     * Stand up a workspace with one member at a given role, acting in it.
     *
     * @param role - What they hold.
     * @returns The workspace, its owner, and the person holding that role.
     */
    async function worldWith(
      role: OrganizationRole,
    ): Promise<{ workspace: OrganizationBody; owner: Person; caller: Person }> {
      const owner = await api.signUp();
      const workspace = await create(owner);
      const caller = role === CREATOR_ROLE ? owner : await api.signUp();

      if (caller !== owner) {
        await api.join(workspace.id, caller, role);
      }

      await api
        .as(caller)("post", `${AUTH}/organization/set-active`)
        .send({ organizationId: workspace.id })
        .expect(200);

      return { workspace, owner, caller };
    }

    // `invitation: create` is an owner-and-admin permission — `organization.roles.ts` — and a
    // `viewer` holds none of the four resources at all. This is the *plugin's* access control
    // answering, over the role list this service handed it, which is the only place that
    // configuration is exercised end to end.
    it.each([
      ["owner", "owner", 200],
      ["admin", "admin", 200],
      ["member", "member", 403],
      ["viewer", "viewer", 403],
    ] as const)("lets a %s invite somebody: %s → %i", async (_label, role, expected) => {
      const { caller } = await worldWith(role);

      await api
        .as(caller)("post", `${AUTH}/organization/invite-member`)
        .send({ email: `${uniqueName(PREFIX)}@example.test`, role: "member" })
        .expect(expected);
    });

    it.each([
      ["owner", "owner", 200],
      ["admin", "admin", 200],
      ["member", "member", 403],
      ["viewer", "viewer", 403],
    ] as const)("lets a %s change a role: %s → %i", async (_label, role, expected) => {
      const { workspace, caller } = await worldWith(role);
      const subject = await api.signUp();
      await api.join(workspace.id, subject, "member");

      const full = bodyOf<FullOrganizationBody>(
        await api.as(caller)("get", `${AUTH}/organization/get-full-organization`).expect(200),
      );
      const membership = full.members.find((each) => each.userId === subject.id);

      await api
        .as(caller)("post", `${AUTH}/organization/update-member-role`)
        .send({ memberId: membership?.id, role: "admin" })
        .expect(expected);
    });

    it("refuses a stranger before it looks at their role, and writes nothing", async () => {
      // Somebody who is not a member is refused for not being one, rather than for holding a
      // role that is too low — the same order this service applies in `tenant.guard.ts` ahead
      // of `roles.guard.ts`.
      //
      // The plugin spells that refusal `400 MEMBER_NOT_FOUND` here and `403
      // USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` on `set-active`, which is the library's
      // inconsistency and is written down rather than smoothed over: pinning what it actually
      // answers is the only way an upgrade that changes it becomes visible. What matters is
      // the same either way, and is the second assertion — no invitation row.
      const owner = await api.signUp();
      const workspace = await create(owner);
      const stranger = await api.signUp();

      const response = await api
        .as(stranger)("post", `${AUTH}/organization/invite-member`)
        .send({ organizationId: workspace.id, email: "x@example.test", role: "member" })
        .expect(400);

      expect(bodyOf<PluginFailureBody>(response).code).toBe("MEMBER_NOT_FOUND");

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.invitation where "organizationId" = $1`,
        [workspace.id],
      );
      expect(rows[0].count).toBe("0");
    });
  });

  describe("a workspace created the way a person creates one", () => {
    // **The #715 regression.** Every case here answered `422 orgId must be a UUID` before this
    // issue, on a workspace that had just been created successfully and was listed correctly
    // by the route above them.
    it("is reachable on its own routes under /api/v1/orgs/{orgId}", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner);

      await api.as(owner)("get", `${ORGS}/${workspace.id}/domains`).expect(200);
      await api.as(owner)("get", `${ORGS}/${workspace.id}/github-orgs`).expect(200);
    });

    it("can be written to, not only read", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner);

      await api
        .as(owner)("post", `${ORGS}/${workspace.id}/domains`)
        .send({ domain: `${uniqueName(PREFIX)}.example` })
        .expect(201);
    });

    it("appears in this service's own listing, with the role the plugin gave", async () => {
      const owner = await api.signUp();
      const workspace = await create(owner, { name: "Acme Robotics" });

      const page = bodyOf<Page<OrgRowResource>>(await api.as(owner)("get", ORGS).expect(200));

      expect(page.items).toContainEqual(
        expect.objectContaining({ id: workspace.id, name: "Acme Robotics", roles: ["owner"] }),
      );
    });

    it("is addressable by the tenant header as well as by the path", async () => {
      // `referenceFrom` tells an id from a slug by the same pattern the DTO validates with, so
      // widening one widened the other — and a 32-character id arriving in the header has to
      // be read as an id rather than as a slug that matches no row.
      const owner = await api.signUp();
      const workspace = await create(owner);

      await api
        .as(owner)("get", `${ORGS}/${workspace.id}/domains`)
        .set(TENANT_HEADER, workspace.id)
        .expect(200);
    });

    it("is still addressable by its slug in that header", async () => {
      // The other side of that discrimination: a slug is what a person types, and widening the
      // id pattern must not have swallowed it.
      const owner = await api.signUp();
      const workspace = await create(owner);

      await api
        .as(owner)("get", `${ORGS}/${workspace.id}/domains`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200);
    });

    it("still answers 422 for something that is not an identifier at all", async () => {
      // What the widening must *not* have cost: a malformed path parameter is a malformed
      // request, and the validation pipe naming the field is what a form needs to render the
      // complaint. Answering `404` here would turn "your id is wrong" into "no such
      // workspace".
      const owner = await api.signUp();
      await create(owner);

      const response = await api.as(owner)("get", `${ORGS}/not an id/domains`).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details).toEqual({
        orgId: ["orgId must be an organization id"],
      });
    });

    it("answers 404 for a well-formed id that names nothing", async () => {
      // The no-existence-leaks rule: a workspace that does not exist and one the caller may
      // not see are the same answer.
      const owner = await api.signUp();
      await create(owner);

      await api
        .as(owner)("get", `${ORGS}/${"a".repeat(32)}/domains`)
        .expect(404);
    });
  });
});

/**
 * The roles the matrix runs over, as `it.each` wants them.
 *
 * A function so the list is read from `organization.roles.ts` at call time rather than copied
 * — the plugin is configured from that array, and a role added there without a row here would
 * otherwise go unexercised.
 *
 * @returns One single-element tuple per role.
 */
function ORGANIZATION_ROLES_UNDER_TEST(): [OrganizationRole][] {
  return (Object.keys(ORGANIZATION_ROLES) as OrganizationRole[]).map((role) => [role]);
}
