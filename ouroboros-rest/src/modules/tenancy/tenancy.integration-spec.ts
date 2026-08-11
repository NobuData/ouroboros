import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";

import { createApplication } from "../../application";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "./pagination";
import type {
  DomainResource,
  MemberResource,
  OrgResource,
  RepoResource,
  TenantResource,
} from "./resources";

/**
 * The tenancy API, against a real migrated PostgreSQL.
 *
 * > *Full CRUD verified in the [#37](https://github.com/NobuData/ouroboros/issues/37)
 * > harness, including constraint-violation mapping (duplicate domain → 409 with
 * > `code:"domain_taken"`).*
 * > *Last-owner demotion or removal is rejected.*
 *
 * Both acceptance criteria are here, because both are things a unit suite cannot answer.
 * `tenant_domains_domain_key` is a rule in `ouroboros-db`, and "the API maps it to
 * `domain_taken`" is a claim about two systems agreeing — a mocked repository can be made to
 * reject with anything, including a constraint that no longer exists. The last-owner rule is
 * the same shape from the other side: it is enforced with `select … for update`, and a lock
 * has no behaviour at all without a server to take it on.
 *
 * #37 is the harness that will run this on Testcontainers, with a database it starts itself.
 * Until then it takes one the way `db.integration-spec.ts` does:
 *
 * ```bash
 * docker compose up -d                                     # the #10 data tier, migrated
 * OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
 *   yarn test:integration
 * ```
 *
 * Every row it creates is named with {@link TEST_PREFIX} and removed afterwards, so it is
 * safe to point at the development stack and it touches nothing that was there before it
 * ran. Do not point it at anything else.
 */

/**
 * The database this suite runs against.
 *
 * No default and no skip, for the reason `db.integration-spec.ts` gives: a suite that quietly
 * passes when it was given no database reports "the constraints are mapped" having mapped
 * nothing.
 */
const DATABASE_URL = process.env.OURO_DATABASE_URL;

if (DATABASE_URL === undefined || DATABASE_URL === "") {
  throw new Error(
    "The integration suite needs a migrated database. Start one with `docker compose up -d` " +
      "and run it with OURO_DATABASE_URL set — see the header of this file.",
  );
}

/**
 * What every row this suite creates is named with.
 *
 * Shaped to fit `tenants_slug_format` and `github_orgs_login_format`, which admit only
 * lower-case alphanumerics in single-hyphen-separated groups.
 */
const TEST_PREFIX = "ouro-it";

/** The base path every operation below sits under. */
const TENANTS = "/api/v1/tenants";

/** A uuid that is well-formed and belongs to nothing. */
const ABSENT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A connection of this suite's own, for the cleanup the application must not do. */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/** A name no other run of this suite will produce. */
function uniqueName(): string {
  return `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
}

/** An address inside this suite's namespace, so the cleanup can find it. */
function uniqueEmail(): string {
  return `${uniqueName()}@example.test`;
}

/**
 * A response's body, as the type `openapi.yaml` says that operation answers with.
 *
 * Supertest types `body` as `any`, which is honest — it has no idea what was asked for — and
 * unusable: every field read off it would be unchecked. Naming the type here means a spec
 * that reads `page.items[0].isPrimary` is checked against the resource this module actually
 * returns, and the drift check in `src/openapi/openapi.spec.ts` is what keeps *that* type and
 * the published contract in step.
 *
 * @param response - What Supertest returned.
 * @returns Its body, typed.
 */
function bodyOf<T>(response: request.Response): T {
  return response.body as T;
}

/**
 * A matcher for a value the database chose, typed as the field it stands in for.
 *
 * Jest's asymmetric matchers are typed `any`, so dropping one into an object literal makes
 * the whole literal unchecked — which defeats the point of {@link bodyOf} naming the type in
 * the first place. Naming them here is what keeps `toEqual` exhaustive *and* typed: an
 * expectation that lists every field is how a column added to a resource without being
 * documented gets caught.
 *
 * @param pattern - What the value has to look like.
 * @returns The matcher, as the string the field is.
 */
function matching(pattern: RegExp): string {
  const matcher: unknown = expect.stringMatching(pattern);

  return matcher as string;
}

/**
 * A matcher for a message that has to mention something.
 *
 * @param text - What it has to contain.
 * @returns The matcher, as the string the field is.
 */
function containing(text: string): string {
  const matcher: unknown = expect.stringContaining(text);

  return matcher as string;
}

describe("the tenancy API, for real", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(testConfiguration({ OURO_DATABASE_URL: DATABASE_URL }), {
      logger: false,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await cleanUp();
    await admin.end();
  });

  afterEach(cleanUp);

  /** Remove everything this suite created. Tenants cascade; people do not. */
  async function cleanUp(): Promise<void> {
    await admin.query("delete from ouroboros.tenants where slug like $1", [`${TEST_PREFIX}-%`]);
    await admin.query("delete from ouroboros.users where email like $1", [`${TEST_PREFIX}-%`]);
  }

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  /**
   * Create a tenant through the API.
   *
   * @returns The tenant, as it was stored.
   */
  async function aTenant(): Promise<TenantResource> {
    return bodyOf<TenantResource>(
      await request(server())
        .post(TENANTS)
        .send({ slug: uniqueName(), displayName: "Integration Suite" })
        .expect(201),
    );
  }

  describe("tenants", () => {
    it("creates one, and gives back what the database stored", async () => {
      const slug = uniqueName();

      const tenant = bodyOf<TenantResource>(
        await request(server())
          .post(TENANTS)
          .send({ slug, displayName: "Integration Suite" })
          .expect(201),
      );

      expect(tenant).toEqual({
        id: matching(/^[0-9a-f-]{36}$/),
        slug,
        displayName: "Integration Suite",
        // The default V001 declares, and the timestamps its `default now()` produced.
        status: "active",
        createdAt: matching(/^\d{4}-\d{2}-\d{2}T/),
        updatedAt: matching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it("reads one back", async () => {
      const tenant = await aTenant();

      const read = bodyOf<TenantResource>(
        await request(server()).get(`${TENANTS}/${tenant.id}`).expect(200),
      );

      expect(read).toEqual(tenant);
    });

    it("lists them with the window it applied", async () => {
      await aTenant();

      const page = bodyOf<Page<TenantResource>>(
        await request(server()).get(`${TENANTS}?limit=1&offset=0`).expect(200),
      );

      expect(page).toMatchObject({ limit: 1, offset: 0 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(0);
    });

    it("renames one, and lets the database keep updated_at", async () => {
      const tenant = await aTenant();

      const renamed = bodyOf<TenantResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}`)
          .send({ displayName: "Renamed" })
          .expect(200),
      );

      expect(renamed.displayName).toBe("Renamed");
      // `ouroboros.touch_updated_at()` stamps this from the server clock. Nothing in the
      // request said so, and the type does not offer the column.
      expect(renamed.updatedAt >= renamed.createdAt).toBe(true);
      expect(renamed.createdAt).toBe(tenant.createdAt);
    });

    it("suspends and soft-deletes one through its status", async () => {
      const tenant = await aTenant();

      await request(server())
        .patch(`${TENANTS}/${tenant.id}`)
        .send({ status: "suspended" })
        .expect(200);
      const deleted = bodyOf<TenantResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}`)
          .send({ status: "deleted" })
          .expect(200),
      );

      expect(deleted.status).toBe("deleted");
      // Soft: the row survives, so it is one further PATCH away from being undone.
      await request(server()).get(`${TENANTS}/${tenant.id}`).expect(200);
    });

    it("answers a body that asked for nothing with the tenant unchanged", async () => {
      const tenant = await aTenant();

      const unchanged = bodyOf<TenantResource>(
        await request(server()).patch(`${TENANTS}/${tenant.id}`).send({}).expect(200),
      );

      expect(unchanged).toEqual(tenant);
    });

    it("refuses a slug another tenant holds", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(TENANTS)
          .send({ slug: tenant.slug, displayName: "Second" })
          .expect(409),
      );

      expect(failure).toMatchObject({ code: "slug_taken", details: {} });
    });

    it("answers 404 for a tenant that does not exist", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server()).get(`${TENANTS}/${ABSENT}`).expect(404),
      );

      expect(failure).toMatchObject({ code: "tenant_not_found", details: { tenantId: ABSENT } });
    });

    it("answers 422 for a slug the schema would refuse", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(TENANTS)
          .send({ slug: "Not A Slug", displayName: "Integration Suite" })
          .expect(422),
      );

      expect(failure.code).toBe("validation_failed");
      expect(failure.details).toHaveProperty("slug");
    });
  });

  describe("domains", () => {
    /**
     * Add a domain to a tenant.
     *
     * @param tenantId - The tenant.
     * @param domain - The domain to claim.
     * @param isPrimary - Whether it becomes the displayed one.
     * @returns The stored domain.
     */
    async function addDomain(
      tenantId: string,
      domain: string,
      isPrimary = false,
    ): Promise<DomainResource> {
      return bodyOf<DomainResource>(
        await request(server())
          .post(`${TENANTS}/${tenantId}/domains`)
          .send({ domain, isPrimary })
          .expect(201),
      );
    }

    /**
     * List a tenant's domains.
     *
     * @param tenantId - The tenant.
     * @returns The page.
     */
    async function listDomains(tenantId: string): Promise<Page<DomainResource>> {
      return bodyOf<Page<DomainResource>>(
        await request(server()).get(`${TENANTS}/${tenantId}/domains`).expect(200),
      );
    }

    it("adds one and lists it", async () => {
      const tenant = await aTenant();

      await addDomain(tenant.id, `${tenant.slug}.example`, true);

      expect(await listDomains(tenant.id)).toMatchObject({
        items: [{ domain: `${tenant.slug}.example`, isPrimary: true, tenantId: tenant.id }],
        total: 1,
      });
    });

    it("maps a duplicate domain to 409 domain_taken", async () => {
      // The issue's worked example, end to end: the rule is `tenant_domains_domain_key` in
      // V001, the answer is this envelope, and nothing between them is mocked.
      const first = await aTenant();
      const second = await aTenant();
      const domain = `${first.slug}.example`;
      await addDomain(first.id, domain);

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(`${TENANTS}/${second.id}/domains`)
          .send({ domain })
          .expect(409),
      );

      expect(failure).toEqual({
        code: "domain_taken",
        message: "That domain belongs to another tenant.",
        details: {},
      });
    });

    it("moves the primary flag rather than adding a second one", async () => {
      // `tenant_domains_one_primary_per_tenant` is a partial unique index, so this only works
      // because the demotion and the promotion are in one transaction.
      const tenant = await aTenant();
      const first = await addDomain(tenant.id, `a-${tenant.slug}.example`, true);
      const second = await addDomain(tenant.id, `b-${tenant.slug}.example`);

      await request(server())
        .patch(`${TENANTS}/${tenant.id}/domains/${second.id}`)
        .send({ isPrimary: true })
        .expect(200);

      const { items } = await listDomains(tenant.id);
      expect(items.filter((domain) => domain.isPrimary)).toHaveLength(1);
      expect(items.find((domain) => domain.isPrimary)?.id).toBe(second.id);
      expect(items.find((domain) => domain.id === first.id)?.isPrimary).toBe(false);
    });

    it("adds one as primary while another already holds the flag", async () => {
      const tenant = await aTenant();
      await addDomain(tenant.id, `a-${tenant.slug}.example`, true);

      await addDomain(tenant.id, `b-${tenant.slug}.example`, true);

      const { items } = await listDomains(tenant.id);
      expect(items.filter((domain) => domain.isPrimary)).toHaveLength(1);
    });

    it("demotes without promoting anything, which V001 permits", async () => {
      const tenant = await aTenant();
      const domain = await addDomain(tenant.id, `${tenant.slug}.example`, true);

      await request(server())
        .patch(`${TENANTS}/${tenant.id}/domains/${domain.id}`)
        .send({ isPrimary: false })
        .expect(200);

      const { items } = await listDomains(tenant.id);
      expect(items.filter((each) => each.isPrimary)).toHaveLength(0);
    });

    it("removes one, and answers 204 with no body", async () => {
      const tenant = await aTenant();
      const domain = await addDomain(tenant.id, `${tenant.slug}.example`);

      const removed = await request(server())
        .delete(`${TENANTS}/${tenant.id}/domains/${domain.id}`)
        .expect(204);

      expect(removed.body).toEqual({});
      expect(await listDomains(tenant.id)).toMatchObject({ items: [], total: 0 });
    });

    it("answers 404 for a domain that belongs to another tenant", async () => {
      // The existence leak this API refuses: the id is real, and the answer must not say so.
      const owner = await aTenant();
      const other = await aTenant();
      const domain = await addDomain(owner.id, `${owner.slug}.example`);

      const failure = bodyOf<ErrorEnvelope>(
        await request(server()).delete(`${TENANTS}/${other.id}/domains/${domain.id}`).expect(404),
      );

      expect(failure.code).toBe("domain_not_found");
      // …and it is still the owner's.
      expect(await listDomains(owner.id)).toMatchObject({ total: 1 });
    });

    it("answers 404 for a tenant that does not exist", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server()).get(`${TENANTS}/${ABSENT}/domains`).expect(404),
      );

      expect(failure.code).toBe("tenant_not_found");
    });
  });

  describe("members", () => {
    /**
     * Invite somebody to a tenant.
     *
     * @param tenantId - The tenant.
     * @param role - What they may do.
     * @param email - Their address. A fresh one by default.
     * @returns The membership.
     */
    async function invite(
      tenantId: string,
      role: string,
      email = uniqueEmail(),
    ): Promise<MemberResource> {
      return bodyOf<MemberResource>(
        await request(server())
          .post(`${TENANTS}/${tenantId}/members`)
          .send({ email, role })
          .expect(201),
      );
    }

    /**
     * List a tenant's members.
     *
     * @param tenantId - The tenant.
     * @returns The page.
     */
    async function listMembers(tenantId: string): Promise<Page<MemberResource>> {
      return bodyOf<Page<MemberResource>>(
        await request(server()).get(`${TENANTS}/${tenantId}/members`).expect(200),
      );
    }

    it("creates the person and the membership, with the invitation outstanding", async () => {
      const tenant = await aTenant();
      const email = uniqueEmail();

      const member = bodyOf<MemberResource>(
        await request(server())
          .post(`${TENANTS}/${tenant.id}/members`)
          .send({ email, role: "owner", displayName: "Ada Lovelace" })
          .expect(201),
      );

      expect(member).toEqual({
        tenantId: tenant.id,
        userId: matching(/^[0-9a-f-]{36}$/),
        email,
        displayName: "Ada Lovelace",
        avatarUrl: null,
        role: "owner",
        invitedAt: matching(/^\d{4}-/),
        // Nothing before #33's sign-in can honestly say they accepted.
        joinedAt: null,
      });
    });

    it("folds the address, and reuses the person in a second tenant", async () => {
      // V002 makes `users` global precisely so one human is one row across the workspaces
      // they belong to.
      const first = await aTenant();
      const second = await aTenant();
      const email = uniqueEmail();

      const one = await invite(first.id, "owner", email.toUpperCase());
      const two = await invite(second.id, "viewer", email);

      expect(one.email).toBe(email);
      expect(two.userId).toBe(one.userId);
      expect(two.role).toBe("viewer");
    });

    it("names somebody after their address when the invitation did not", async () => {
      const tenant = await aTenant();
      const email = uniqueEmail();

      const member = await invite(tenant.id, "member", email);

      expect(member.displayName).toBe(email.slice(0, email.indexOf("@")));
    });

    it("refuses a second membership for the same person", async () => {
      const tenant = await aTenant();
      const owner = await invite(tenant.id, "owner");

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(`${TENANTS}/${tenant.id}/members`)
          .send({ email: owner.email, role: "viewer" })
          .expect(409),
      );

      expect(failure.code).toBe("member_exists");
    });

    it("lists them with the person's details on each row", async () => {
      const tenant = await aTenant();
      const owner = await invite(tenant.id, "owner");

      expect(await listMembers(tenant.id)).toMatchObject({
        items: [{ userId: owner.userId, email: owner.email, role: "owner" }],
        total: 1,
      });
    });

    it("changes a role while another owner remains", async () => {
      const tenant = await aTenant();
      const first = await invite(tenant.id, "owner");
      await invite(tenant.id, "owner");

      const changed = bodyOf<MemberResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/members/${first.userId}`)
          .send({ role: "viewer" })
          .expect(200),
      );

      expect(changed.role).toBe("viewer");
    });

    it("rejects demoting the last owner", async () => {
      // The acceptance criterion, and the rule V002 deliberately left to this service because
      // it spans rows.
      const tenant = await aTenant();
      const owner = await invite(tenant.id, "owner");
      await invite(tenant.id, "admin");

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/members/${owner.userId}`)
          .send({ role: "admin" })
          .expect(409),
      );

      expect(failure).toMatchObject({ code: "last_owner", details: { userId: owner.userId } });
      // …and the demotion did not happen.
      const { items } = await listMembers(tenant.id);
      expect(items.filter((member) => member.role === "owner")).toHaveLength(1);
    });

    it("rejects removing the last owner", async () => {
      const tenant = await aTenant();
      const owner = await invite(tenant.id, "owner");

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .delete(`${TENANTS}/${tenant.id}/members/${owner.userId}`)
          .expect(409),
      );

      expect(failure.code).toBe("last_owner");
      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("allows removing an owner once somebody else holds the role", async () => {
      const tenant = await aTenant();
      const first = await invite(tenant.id, "owner");
      const second = await invite(tenant.id, "admin");

      await request(server())
        .patch(`${TENANTS}/${tenant.id}/members/${second.userId}`)
        .send({ role: "owner" })
        .expect(200);
      await request(server()).delete(`${TENANTS}/${tenant.id}/members/${first.userId}`).expect(204);

      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("removes somebody who was never an owner", async () => {
      const tenant = await aTenant();
      await invite(tenant.id, "owner");
      const viewer = await invite(tenant.id, "viewer");

      await request(server())
        .delete(`${TENANTS}/${tenant.id}/members/${viewer.userId}`)
        .expect(204);

      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("answers 404 for somebody who is not a member", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/members/${ABSENT}`)
          .send({ role: "admin" })
          .expect(404),
      );

      expect(failure.code).toBe("member_not_found");
    });

    it("leaves the person behind when the membership goes", async () => {
      const tenant = await aTenant();
      await invite(tenant.id, "owner");
      const viewer = await invite(tenant.id, "viewer");

      await request(server())
        .delete(`${TENANTS}/${tenant.id}/members/${viewer.userId}`)
        .expect(204);
      const reinvited = await invite(tenant.id, "member", viewer.email);

      // They may hold roles in other tenants, so removing a membership must not remove them.
      expect(reinvited.userId).toBe(viewer.userId);
    });
  });

  describe("GitHub enablement", () => {
    /**
     * Record an organisation for a tenant.
     *
     * @param tenantId - The tenant.
     * @param enabled - Whether it starts switched on.
     * @returns The stored organisation.
     */
    async function addOrg(tenantId: string, enabled?: boolean): Promise<OrgResource> {
      const login = uniqueName();

      return bodyOf<OrgResource>(
        await request(server())
          .post(`${TENANTS}/${tenantId}/orgs`)
          .send(enabled === undefined ? { login } : { login, enabled })
          .expect(201),
      );
    }

    it("records an organisation switched off unless asked", async () => {
      const tenant = await aTenant();

      const org = await addOrg(tenant.id);

      expect(org).toMatchObject({ enabled: false, installedAt: null, tenantId: tenant.id });
    });

    it("refuses the same organisation twice for one tenant", async () => {
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(`${TENANTS}/${tenant.id}/orgs`)
          .send({ login: org.login })
          .expect(409),
      );

      expect(failure.code).toBe("org_taken");
    });

    it("lets two tenants each enable the same organisation", async () => {
      // The unique key is `(tenant_id, login)`, not `login`: enablement is per tenant, and
      // each holds its own flag and its own installation.
      const first = await aTenant();
      const second = await aTenant();
      const org = await addOrg(first.id);

      await request(server())
        .post(`${TENANTS}/${second.id}/orgs`)
        .send({ login: org.login })
        .expect(201);
    });

    it("enables and disables one, listing it either way", async () => {
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);

      const enabled = bodyOf<OrgResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}`)
          .send({ enabled: true })
          .expect(200),
      );
      expect(enabled.enabled).toBe(true);

      await request(server())
        .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}`)
        .send({ enabled: false })
        .expect(200);

      // A disabled organisation is still listed — a settings screen has to render the switch
      // that is off.
      const page = bodyOf<Page<OrgResource>>(
        await request(server()).get(`${TENANTS}/${tenant.id}/orgs`).expect(200),
      );
      expect(page).toMatchObject({ items: [{ login: org.login, enabled: false }], total: 1 });
    });

    it("answers 404 for an organisation this tenant has not recorded", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${uniqueName()}`)
          .send({ enabled: true })
          .expect(404),
      );

      expect(failure.code).toBe("org_not_found");
    });

    it("records a repository the first time it is enabled", async () => {
      // The upsert: there is no discovery flow yet to have created the row, so the PATCH is
      // what brings one into being.
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);

      const repo = bodyOf<RepoResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: true, defaultBranch: "main" })
          .expect(200),
      );

      expect(repo).toMatchObject({
        orgId: org.id,
        name: "ouroboros",
        enabled: true,
        defaultBranch: "main",
      });
    });

    it("updates the same repository on a second call rather than duplicating it", async () => {
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);
      const created = bodyOf<RepoResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: true, defaultBranch: "main" })
          .expect(200),
      );

      const updated = bodyOf<RepoResource>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: false })
          .expect(200),
      );

      expect(updated.id).toBe(created.id);
      expect(updated.enabled).toBe(false);
      // Omitted means "I am not setting this", not "set this to nothing".
      expect(updated.defaultBranch).toBe("main");
    });

    it("lists an organisation's repositories", async () => {
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);
      await request(server())
        .patch(`${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
        .send({ enabled: true })
        .expect(200);

      const page = bodyOf<Page<RepoResource>>(
        await request(server()).get(`${TENANTS}/${tenant.id}/orgs/${org.login}/repos`).expect(200),
      );

      expect(page).toMatchObject({ items: [{ name: "ouroboros", enabled: true }], total: 1 });
    });

    it("answers the organisation's 404 rather than creating one", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .patch(`${TENANTS}/${tenant.id}/orgs/${uniqueName()}/repos/ouroboros`)
          .send({ enabled: true })
          .expect(404),
      );

      expect(failure.code).toBe("org_not_found");
    });
  });

  describe("deleting a tenant", () => {
    it("takes everything that hangs off it", async () => {
      // Not an API operation — there is deliberately no `DELETE /tenants/{id}` — but the
      // cascade is what makes the soft delete the right default, and what this suite's own
      // cleanup relies on.
      const tenant = await aTenant();
      const login = uniqueName();
      await request(server())
        .post(`${TENANTS}/${tenant.id}/domains`)
        .send({ domain: `${tenant.slug}.example` })
        .expect(201);
      await request(server()).post(`${TENANTS}/${tenant.id}/orgs`).send({ login }).expect(201);
      await request(server())
        .patch(`${TENANTS}/${tenant.id}/orgs/${login}/repos/ouroboros`)
        .send({ enabled: true })
        .expect(200);

      await admin.query("delete from ouroboros.tenants where id = $1", [tenant.id]);

      const { rows } = await admin.query<{ count: string }>(
        `select (select count(*) from ouroboros.tenant_domains where tenant_id = $1)
              + (select count(*) from ouroboros.github_orgs where tenant_id = $1) as count`,
        [tenant.id],
      );
      expect(Number(rows[0].count)).toBe(0);
    });
  });

  describe("the error envelope", () => {
    it("is the shape of every failure, including the ones no controller produced", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server()).get("/api/v1/nope").expect(404),
      );

      expect(failure).toEqual({
        code: "not_found",
        message: containing("/api/v1/nope"),
        details: {},
      });
    });

    it("carries one entry per field a request got wrong", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(`${TENANTS}/${tenant.id}/members`)
          .send({ email: "not an address", role: "maintainer" })
          .expect(422),
      );

      expect(failure.code).toBe("validation_failed");
      expect(Object.keys(failure.details).sort()).toEqual(["email", "role"]);
    });

    it("refuses a property no DTO declares", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(TENANTS)
          .send({ slug: uniqueName(), displayName: "Integration Suite", status: "active" })
          .expect(422),
      );

      expect(failure.details).toHaveProperty("status");
    });

    it("answers a malformed identifier with 422 rather than a query", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await request(server()).get(`${TENANTS}/not-a-uuid`).expect(422),
      );

      expect(failure.details).toHaveProperty("tenantId");
    });
  });
});
