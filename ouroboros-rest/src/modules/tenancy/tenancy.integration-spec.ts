import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";

import { createApplication } from "../../application";
import {
  bodyOf,
  containing,
  integrationDatabaseUrl,
  matching,
  uniqueEmail,
  uniqueName,
} from "../../testing/integration.fixture";
import { signInAs } from "../auth/session.fixture";
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
 * #37 is the harness that runs it on Testcontainers, with a database it starts itself, so
 * the whole of what this suite needs is Docker:
 *
 * ```bash
 * yarn test:integration
 * ```
 *
 * It predates the harness and still arranges its own world — its own connection, its own
 * session, its own prefix-scoped cleanup. That is deliberate rather than left over:
 * `roles.integration-spec.ts` is what the harness's fixtures are demonstrated by, and having
 * one suite that reaches for the database directly is what would catch a harness whose
 * `truncate` or `signIn` had quietly stopped doing what it says.
 *
 * Every row it creates is named with {@link TEST_PREFIX} and removed afterwards, so it is
 * safe to point at the development stack with `OURO_DATABASE_URL` and it touches nothing
 * that was there before it ran. Do not point it at anything else.
 */

/**
 * The database this suite runs against.
 *
 * No default and no skip, for the reason `db.integration-spec.ts` gives: a suite that quietly
 * passes when it was given no database reports "the constraints are mapped" having mapped
 * nothing.
 */
const DATABASE_URL = integrationDatabaseUrl();

/**
 * What every row this suite creates is named with.
 *
 * Shaped to fit `tenants_slug_format` and `github_orgs_login_format`, which admit only
 * lower-case alphanumerics in single-hyphen-separated groups.
 */
const TEST_PREFIX = "ouro-it";

/**
 * The address of the person this suite is signed in as.
 *
 * Deliberately *not* of the form `cleanUp` deletes — that pattern is `ouro-it-%`, and this
 * carries an `@` where the hyphen would be — because the cleanup runs after every test and
 * would otherwise remove the user whose session the next test is holding.
 */
const SESSION_EMAIL = `${TEST_PREFIX}@session.test`;

/** The base path every operation below sits under. */
const TENANTS = "/api/v1/tenants";

/** A uuid that is well-formed and belongs to nothing. */
const ABSENT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A connection of this suite's own, for the cleanup the application must not do. */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/** A name no other run of this suite will produce, inside this suite's namespace. */
const aName = (): string => uniqueName(TEST_PREFIX);

/** An address inside this suite's namespace, so the cleanup can find it. */
const anAddress = (): string => uniqueEmail(TEST_PREFIX);

describe("the tenancy API, for real", () => {
  let app: INestApplication;
  let session: string;
  /**
   * The suite's own user id.
   *
   * Needed since [#32](https://github.com/NobuData/ouroboros/issues/32): creating a
   * workspace makes the creator its `owner`, so this suite is a member — and the owner — of
   * every tenant it makes. The last-owner tests are about *this* person now.
   */
  let sessionUserId: string;

  beforeAll(async () => {
    app = await createApplication(testConfiguration({ OURO_DATABASE_URL: DATABASE_URL }), {
      logger: false,
    });
    await app.init();

    // Every route below is authenticated ([#703](https://github.com/NobuData/ouroboros/issues/703)),
    // so the suite signs in as somebody real. The session is a genuine one — a row in
    // `ouroboros.session` naming a real person, exactly as a sign-in would have written —
    // so what runs below is the guard doing its job rather than the guard switched off. The
    // rows are the suite's own and are removed in `afterAll`; the address deliberately does
    // not match `cleanUp`'s pattern, which would otherwise delete the person this suite is
    // signed in as after its first test.
    const { rows } = await admin.query<{ id: string }>(
      "insert into ouroboros.users (email, display_name) values ($1, $2) " +
        "on conflict (email) do update set display_name = excluded.display_name returning id",
      [SESSION_EMAIL, "Integration Suite"],
    );
    sessionUserId = rows[0].id;
    session = await signInAs(admin, sessionUserId);
  });

  afterAll(async () => {
    await app.close();
    await cleanUp();
    await admin.query("delete from ouroboros.users where email = $1", [SESSION_EMAIL]);
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
   * A request from the signed-in browser.
   *
   * Every call in this suite goes through it, so the session is carried by construction
   * rather than remembered at fifty call sites — and a route that stopped being reachable
   * with one would fail here rather than silently pass because a `401` was expected.
   *
   * @param method - The verb.
   * @param path - The path, under `/api/v1`.
   * @returns The Supertest request, with the session cookie already set.
   */
  function signedIn(method: "get" | "post" | "patch" | "delete", path: string): request.Test {
    return request(server())[method](path).set("Cookie", session);
  }

  /**
   * Create a tenant through the API.
   *
   * @returns The tenant, as it was stored.
   */
  async function aTenant(): Promise<TenantResource> {
    return bodyOf<TenantResource>(
      await signedIn("post", TENANTS)
        .send({ slug: aName(), displayName: "Integration Suite" })
        .expect(201),
    );
  }

  describe("tenants", () => {
    it("creates one, and gives back what the database stored", async () => {
      const slug = aName();

      const tenant = bodyOf<TenantResource>(
        await signedIn("post", TENANTS)
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
        await signedIn("get", `${TENANTS}/${tenant.id}`).expect(200),
      );

      expect(read).toEqual(tenant);
    });

    it("lists them with the window it applied", async () => {
      await aTenant();

      const page = bodyOf<Page<TenantResource>>(
        await signedIn("get", `${TENANTS}?limit=1&offset=0`).expect(200),
      );

      expect(page).toMatchObject({ limit: 1, offset: 0 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(0);
    });

    it("renames one, and lets the database keep updated_at", async () => {
      const tenant = await aTenant();

      const renamed = bodyOf<TenantResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}`)
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

      await signedIn("patch", `${TENANTS}/${tenant.id}`).send({ status: "suspended" }).expect(200);
      const deleted = bodyOf<TenantResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}`).send({ status: "deleted" }).expect(200),
      );

      expect(deleted.status).toBe("deleted");
      // Soft: the row survives, so it is one further PATCH away from being undone.
      await signedIn("get", `${TENANTS}/${tenant.id}`).expect(200);
    });

    it("answers a body that asked for nothing with the tenant unchanged", async () => {
      const tenant = await aTenant();

      const unchanged = bodyOf<TenantResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}`).send({}).expect(200),
      );

      expect(unchanged).toEqual(tenant);
    });

    it("refuses a slug another tenant holds", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", TENANTS)
          .send({ slug: tenant.slug, displayName: "Second" })
          .expect(409),
      );

      expect(failure).toMatchObject({ code: "slug_taken", details: {} });
    });

    it("answers 404 for a tenant that does not exist", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${TENANTS}/${ABSENT}`).expect(404),
      );

      expect(failure).toMatchObject({ code: "tenant_not_found", details: { tenantId: ABSENT } });
    });

    it("answers 422 for a slug the schema would refuse", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", TENANTS)
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
        await signedIn("post", `${TENANTS}/${tenantId}/domains`)
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
        await signedIn("get", `${TENANTS}/${tenantId}/domains`).expect(200),
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
        await signedIn("post", `${TENANTS}/${second.id}/domains`).send({ domain }).expect(409),
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

      await signedIn("patch", `${TENANTS}/${tenant.id}/domains/${second.id}`)
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

      await signedIn("patch", `${TENANTS}/${tenant.id}/domains/${domain.id}`)
        .send({ isPrimary: false })
        .expect(200);

      const { items } = await listDomains(tenant.id);
      expect(items.filter((each) => each.isPrimary)).toHaveLength(0);
    });

    it("removes one, and answers 204 with no body", async () => {
      const tenant = await aTenant();
      const domain = await addDomain(tenant.id, `${tenant.slug}.example`);

      const removed = await signedIn(
        "delete",
        `${TENANTS}/${tenant.id}/domains/${domain.id}`,
      ).expect(204);

      expect(removed.body).toEqual({});
      expect(await listDomains(tenant.id)).toMatchObject({ items: [], total: 0 });
    });

    it("answers 404 for a domain that belongs to another tenant", async () => {
      // The existence leak this API refuses: the id is real, and the answer must not say so.
      const owner = await aTenant();
      const other = await aTenant();
      const domain = await addDomain(owner.id, `${owner.slug}.example`);

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("delete", `${TENANTS}/${other.id}/domains/${domain.id}`).expect(404),
      );

      expect(failure.code).toBe("domain_not_found");
      // …and it is still the owner's.
      expect(await listDomains(owner.id)).toMatchObject({ total: 1 });
    });

    it("answers 404 for a tenant that does not exist", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${TENANTS}/${ABSENT}/domains`).expect(404),
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
      email = anAddress(),
    ): Promise<MemberResource> {
      return bodyOf<MemberResource>(
        await signedIn("post", `${TENANTS}/${tenantId}/members`).send({ email, role }).expect(201),
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
        await signedIn("get", `${TENANTS}/${tenantId}/members`).expect(200),
      );
    }

    it("creates the person and the membership, with the invitation outstanding", async () => {
      const tenant = await aTenant();
      const email = anAddress();

      const member = bodyOf<MemberResource>(
        await signedIn("post", `${TENANTS}/${tenant.id}/members`)
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
      const email = anAddress();

      const one = await invite(first.id, "owner", email.toUpperCase());
      const two = await invite(second.id, "viewer", email);

      expect(one.email).toBe(email);
      expect(two.userId).toBe(one.userId);
      expect(two.role).toBe("viewer");
    });

    it("names somebody after their address when the invitation did not", async () => {
      const tenant = await aTenant();
      const email = anAddress();

      const member = await invite(tenant.id, "member", email);

      expect(member.displayName).toBe(email.slice(0, email.indexOf("@")));
    });

    it("refuses a second membership for the same person", async () => {
      const tenant = await aTenant();
      const owner = await invite(tenant.id, "owner");

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${TENANTS}/${tenant.id}/members`)
          .send({ email: owner.email, role: "viewer" })
          .expect(409),
      );

      expect(failure.code).toBe("member_exists");
    });

    it("lists them with the person's details on each row", async () => {
      const tenant = await aTenant();
      const invited = await invite(tenant.id, "viewer");

      const page = await listMembers(tenant.id);

      // Two: the person who created the workspace, and the person they invited.
      expect(page.total).toBe(2);
      expect(page.items).toContainEqual(
        expect.objectContaining({ userId: invited.userId, email: invited.email, role: "viewer" }),
      );
      expect(page.items).toContainEqual(
        expect.objectContaining({ userId: sessionUserId, role: "owner" }),
      );
    });

    it("makes the creator of a workspace its owner, joined rather than invited", async () => {
      // Without it the workspace would have no members, and every route under it would
      // answer 404 to everybody — the person who has just made it included (#32).
      const tenant = await aTenant();

      const page = await listMembers(tenant.id);

      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ userId: sessionUserId, role: "owner" });
      expect(page.items[0].joinedAt).not.toBeNull();
    });

    it("changes a role while another owner remains", async () => {
      const tenant = await aTenant();
      const first = await invite(tenant.id, "owner");

      const changed = bodyOf<MemberResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/members/${first.userId}`)
          .send({ role: "viewer" })
          .expect(200),
      );

      expect(changed.role).toBe("viewer");
    });

    it("rejects demoting the last owner", async () => {
      // The acceptance criterion, and the rule V002 deliberately left to this service because
      // it spans rows. The creator is the sole owner, so demoting them is the case.
      const tenant = await aTenant();
      await invite(tenant.id, "admin");

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/members/${sessionUserId}`)
          .send({ role: "admin" })
          .expect(409),
      );

      expect(failure).toMatchObject({ code: "last_owner", details: { userId: sessionUserId } });
      // …and the demotion did not happen.
      const { items } = await listMembers(tenant.id);
      expect(items.filter((member) => member.role === "owner")).toHaveLength(1);
    });

    it("rejects removing the last owner", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("delete", `${TENANTS}/${tenant.id}/members/${sessionUserId}`).expect(409),
      );

      expect(failure.code).toBe("last_owner");
      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("allows removing an owner once somebody else holds the role", async () => {
      // The second owner is the one removed rather than the creator, and that is not
      // squeamishness: since #32 a caller who removes their own membership can no longer
      // read the workspace — every route under it answers 404 to a non-member — so the
      // suite would be asserting from outside a room it had just locked.
      const tenant = await aTenant();
      const second = await invite(tenant.id, "admin");

      await signedIn("patch", `${TENANTS}/${tenant.id}/members/${second.userId}`)
        .send({ role: "owner" })
        .expect(200);
      await signedIn("delete", `${TENANTS}/${tenant.id}/members/${second.userId}`).expect(204);

      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("removes somebody who was never an owner", async () => {
      const tenant = await aTenant();
      const viewer = await invite(tenant.id, "viewer");

      await signedIn("delete", `${TENANTS}/${tenant.id}/members/${viewer.userId}`).expect(204);

      expect(await listMembers(tenant.id)).toMatchObject({ total: 1 });
    });

    it("answers 404 for somebody who is not a member", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/members/${ABSENT}`)
          .send({ role: "admin" })
          .expect(404),
      );

      expect(failure.code).toBe("member_not_found");
    });

    it("leaves the person behind when the membership goes", async () => {
      const tenant = await aTenant();
      const viewer = await invite(tenant.id, "viewer");

      await signedIn("delete", `${TENANTS}/${tenant.id}/members/${viewer.userId}`).expect(204);
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
      const login = aName();

      return bodyOf<OrgResource>(
        await signedIn("post", `${TENANTS}/${tenantId}/orgs`)
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
        await signedIn("post", `${TENANTS}/${tenant.id}/orgs`)
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

      await signedIn("post", `${TENANTS}/${second.id}/orgs`).send({ login: org.login }).expect(201);
    });

    it("enables and disables one, listing it either way", async () => {
      const tenant = await aTenant();
      const org = await addOrg(tenant.id);

      const enabled = bodyOf<OrgResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}`)
          .send({ enabled: true })
          .expect(200),
      );
      expect(enabled.enabled).toBe(true);

      await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}`)
        .send({ enabled: false })
        .expect(200);

      // A disabled organisation is still listed — a settings screen has to render the switch
      // that is off.
      const page = bodyOf<Page<OrgResource>>(
        await signedIn("get", `${TENANTS}/${tenant.id}/orgs`).expect(200),
      );
      expect(page).toMatchObject({ items: [{ login: org.login, enabled: false }], total: 1 });
    });

    it("answers 404 for an organisation this tenant has not recorded", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${aName()}`)
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
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
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
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: true, defaultBranch: "main" })
          .expect(200),
      );

      const updated = bodyOf<RepoResource>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
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
      await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos/ouroboros`)
        .send({ enabled: true })
        .expect(200);

      const page = bodyOf<Page<RepoResource>>(
        await signedIn("get", `${TENANTS}/${tenant.id}/orgs/${org.login}/repos`).expect(200),
      );

      expect(page).toMatchObject({ items: [{ name: "ouroboros", enabled: true }], total: 1 });
    });

    it("answers the organisation's 404 rather than creating one", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${aName()}/repos/ouroboros`)
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
      const login = aName();
      await signedIn("post", `${TENANTS}/${tenant.id}/domains`)
        .send({ domain: `${tenant.slug}.example` })
        .expect(201);
      await signedIn("post", `${TENANTS}/${tenant.id}/orgs`).send({ login }).expect(201);
      await signedIn("patch", `${TENANTS}/${tenant.id}/orgs/${login}/repos/ouroboros`)
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

  describe("the tenant context", () => {
    /**
     * Somebody else, holding a role in a tenant, with a session of their own.
     *
     * Created directly rather than through the API because the API's own invite flow makes a
     * stub `users` row with no identity — which is exactly right for an invitation and no use
     * for signing in as them.
     *
     * @param tenantId - The tenant to be a member of, or `undefined` to belong nowhere.
     * @param role - What they hold there.
     * @returns Their id and the `Cookie` header a request from them carries.
     */
    async function anotherPerson(
      tenantId: string | undefined,
      role = "member",
    ): Promise<{ id: string; cookie: string }> {
      const { rows } = await admin.query<{ id: string }>(
        "insert into ouroboros.users (email, display_name) values ($1, $2) returning id",
        [anAddress(), "Somebody Else"],
      );

      if (tenantId !== undefined) {
        await admin.query(
          "insert into ouroboros.tenant_members (tenant_id, user_id, role) values ($1, $2, $3)",
          [tenantId, rows[0].id, role],
        );
      }

      return { id: rows[0].id, cookie: await signInAs(admin, rows[0].id) };
    }

    it("answers 404 for a workspace you are not a member of — the first acceptance criterion", async () => {
      const tenant = await aTenant();
      const stranger = await anotherPerson(undefined);

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .get(`${TENANTS}/${tenant.id}`)
          .set("Cookie", stranger.cookie)
          .expect(404),
      );

      expect(failure.code).toBe("tenant_not_found");
    });

    it("answers a workspace that exists and one that does not identically", async () => {
      // The whole of *no existence leaks*: a difference in the code, the message or the
      // details is exactly what somebody enumerating identifiers is looking for.
      const tenant = await aTenant();
      const stranger = await anotherPerson(undefined);

      const real = await request(server())
        .get(`${TENANTS}/${tenant.id}`)
        .set("Cookie", stranger.cookie)
        .expect(404);
      const invented = await request(server())
        .get(`${TENANTS}/${ABSENT}`)
        .set("Cookie", stranger.cookie)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(real).code).toBe(bodyOf<ErrorEnvelope>(invented).code);
      expect(bodyOf<ErrorEnvelope>(real).message).toBe(bodyOf<ErrorEnvelope>(invented).message);
    });

    it("never answers 403 for a workspace you cannot see", async () => {
      const tenant = await aTenant();
      const stranger = await anotherPerson(undefined);

      await request(server())
        .patch(`${TENANTS}/${tenant.id}`)
        .set("Cookie", stranger.cookie)
        .send({ displayName: "Mine Now" })
        .expect(404);
    });

    it("blocks a member-level user from an admin mutation — the second acceptance criterion", async () => {
      const tenant = await aTenant();
      const member = await anotherPerson(tenant.id, "member");

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .post(`${TENANTS}/${tenant.id}/domains`)
          .set("Cookie", member.cookie)
          .send({ domain: `${aName()}.example` })
          .expect(403),
      );

      expect(failure).toMatchObject({
        code: "forbidden",
        details: { role: "member", required: ["owner", "admin"] },
      });
    });

    it("lets that same member read what they may not change", async () => {
      // A viewer is a role that exists to be able to look, and a member more so.
      const tenant = await aTenant();
      const member = await anotherPerson(tenant.id, "member");

      await request(server())
        .get(`${TENANTS}/${tenant.id}/domains`)
        .set("Cookie", member.cookie)
        .expect(200);
    });

    it("lets an admin do what a member may not", async () => {
      const tenant = await aTenant();
      const maintainer = await anotherPerson(tenant.id, "admin");

      await request(server())
        .post(`${TENANTS}/${tenant.id}/domains`)
        .set("Cookie", maintainer.cookie)
        .send({ domain: `${aName()}.example` })
        .expect(201);
    });

    it("lists only the workspaces you belong to", async () => {
      // Which is also the proof that the context reaches a service without being threaded
      // through one: `TenantsService.list` reads it from `AsyncLocalStorage`, and it can only
      // be there if the middleware opened a store and the guard wrote to it.
      const mine = await aTenant();
      const stranger = await anotherPerson(undefined);

      const theirs = bodyOf<Page<TenantResource>>(
        await request(server()).get(TENANTS).set("Cookie", stranger.cookie).expect(200),
      );

      expect(theirs.items).toEqual([]);
      expect(theirs.total).toBe(0);

      const ours = bodyOf<Page<TenantResource>>(await signedIn("get", TENANTS).expect(200));
      expect(ours.items.map((tenant) => tenant.id)).toContain(mine.id);
    });

    it("accepts a header that names the same workspace the path does, by slug", async () => {
      const tenant = await aTenant();

      await signedIn("get", `${TENANTS}/${tenant.id}`)
        .set("X-Ouro-Tenant", tenant.slug)
        .expect(200);
    });

    it("refuses a header that names a different workspace than the path", async () => {
      const one = await aTenant();
      const two = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${TENANTS}/${one.id}`).set("X-Ouro-Tenant", two.slug).expect(422),
      );

      expect(failure).toMatchObject({
        code: "tenant_mismatch",
        details: { path: one.id, header: two.slug },
      });
    });
  });

  describe("the error envelope", () => {
    it("is the shape of every failure, including the ones no controller produced", async () => {
      const failure = bodyOf<ErrorEnvelope>(await signedIn("get", "/api/v1/nope").expect(404));

      expect(failure).toEqual({
        code: "not_found",
        message: containing("/api/v1/nope"),
        details: {},
      });
    });

    it("carries one entry per field a request got wrong", async () => {
      const tenant = await aTenant();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${TENANTS}/${tenant.id}/members`)
          .send({ email: "not an address", role: "maintainer" })
          .expect(422),
      );

      expect(failure.code).toBe("validation_failed");
      expect(Object.keys(failure.details).sort()).toEqual(["email", "role"]);
    });

    it("refuses a property no DTO declares", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", TENANTS)
          .send({ slug: aName(), displayName: "Integration Suite", status: "active" })
          .expect(422),
      );

      expect(failure.details).toHaveProperty("status");
    });

    it("answers a malformed identifier with 422 rather than a query", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${TENANTS}/not-a-uuid`).expect(422),
      );

      expect(failure.details).toHaveProperty("tenantId");
    });
  });
});
