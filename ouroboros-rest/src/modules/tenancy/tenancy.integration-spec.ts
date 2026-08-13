import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";

import { createApplication } from "../../application";
import {
  bodyOf,
  containing,
  integrationDatabaseUrl,
  uniqueEmail,
  uniqueName,
} from "../../testing/integration.fixture";
import { signInAs } from "../auth/session.fixture";
import { testConfiguration } from "../config/configuration.fixture";
import type { OrganizationRole } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "./pagination";
import type { DomainResource, GithubOrgResource, OrgRowResource, RepoResource } from "./resources";

/**
 * The tenancy API, against a real migrated PostgreSQL.
 *
 * > *Seeded data returns the three mockup rows with correct counts.*
 * > *A member-role toggle attempt → 403 with the envelope; an owner's succeeds.*
 * > *No endpoint in `modules/tenancy` still reads `tenant_members` or `users`.*
 *
 * [#714](https://github.com/NobuData/ouroboros/issues/714)'s acceptance criteria, and every
 * one of them needs a database. The row model is three tables joined and counted, and a
 * mocked repository can be made to return any numbers at all; the role gate is the whole
 * pipeline reading a `member` row; and "no endpoint reads the dropped tables" is a claim about
 * statements PostgreSQL either accepts or refuses. (The third has a second, cheaper form in
 * `organization.repository.spec.ts`, which reads the module's source — the two catch different
 * mistakes, and a raw `sql` fragment is the one only this suite would find.)
 *
 * The worked constraint example is still here too, from #31: `tenant_domains_domain_key` is a
 * rule in `ouroboros-db`, and "the API maps it to `domain_taken`" is a claim about two systems
 * agreeing.
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
 * Shaped to fit `github_orgs_login_format`, which admits only lower-case alphanumerics in
 * single-hyphen-separated groups — the strictest of the rules these rows have to satisfy.
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
const ORGS = "/api/v1/orgs";

/** A uuid that is well-formed and belongs to nothing. */
const ABSENT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A connection of this suite's own, for the arrangement and cleanup the application cannot do. */
const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });

/**
 * What the application under test is configured with.
 *
 * Hoisted out of `beforeAll` by [#715](https://github.com/NobuData/ouroboros/issues/715),
 * because the suite now needs one value out of it before the application exists: the
 * integration suite loads the real BetterAuth, which verifies a session cookie's signature,
 * so `signInAs` has to sign under the same `BETTER_AUTH_SECRET` the service was given.
 */
const configuration = testConfiguration({ OURO_DATABASE_URL: DATABASE_URL });

/** How every session below is signed. See {@link configuration}. */
const SIGNING = { secret: configuration.betterAuthSecret };

/** A name no other run of this suite will produce, inside this suite's namespace. */
const aName = (): string => uniqueName(TEST_PREFIX);

/** An address inside this suite's namespace, so the cleanup can find it. */
const anAddress = (): string => uniqueEmail(TEST_PREFIX);

/** A workspace this suite stood up. */
interface Workspace {
  id: string;
  slug: string;
  name: string;
}

describe("the tenancy API, for real", () => {
  let app: INestApplication;
  let session: string;
  /** The suite's own user id — the owner of every workspace it makes. */
  let sessionUserId: string;

  beforeAll(async () => {
    app = await createApplication(configuration, { logger: false });
    await app.init();

    // Every route below is authenticated ([#703](https://github.com/NobuData/ouroboros/issues/703)),
    // so the suite signs in as somebody real. The session is a genuine one — a row in
    // `ouroboros.session` naming a real person, exactly as a sign-in would have written —
    // so what runs below is the guard doing its job rather than the guard switched off.
    sessionUserId = await aPerson(SESSION_EMAIL, "Integration Suite");
    session = await signInAs(admin, sessionUserId, SIGNING);
  });

  afterAll(async () => {
    await app.close();
    await cleanUp();
    await admin.query(`delete from ouroboros."user" where "email" = $1`, [SESSION_EMAIL]);
    await admin.end();
  });

  afterEach(cleanUp);

  /** Remove everything this suite created. Workspaces cascade; people do not. */
  async function cleanUp(): Promise<void> {
    await admin.query(`delete from ouroboros.organization where "slug" like $1`, [
      `${TEST_PREFIX}-%`,
    ]);
    await admin.query(`delete from ouroboros."user" where "email" like $1`, [`${TEST_PREFIX}-%`]);
  }

  /**
   * Create a person.
   *
   * @param email - Their address.
   * @param name - What a member list prints.
   * @returns Their `"user".id`.
   */
  async function aPerson(email: string, name = "Somebody Else"): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into ouroboros."user" ("id", "name", "email", "emailVerified", "updatedAt")
       values (gen_random_uuid()::text, $1, $2, true, now())
       on conflict ("email") do update set "name" = excluded."name"
       returning "id"`,
      [name, email],
    );

    return rows[0].id;
  }

  /**
   * Create a workspace, owned by somebody.
   *
   * Directly rather than over the API, because this service has no route that creates one:
   * `POST /api/auth/organization/create` is the organization plugin's since
   * [#704](https://github.com/NobuData/ouroboros/issues/704), and #714 deleted this module's
   * version rather than leaving two write paths to `organization` and `member`. Two statements
   * reproduce exactly what the plugin does — the workspace, and its creator as `owner`.
   *
   * @param overrides - Its name, slug and metadata, when a test cares what they are.
   * @param ownerId - Who owns it. The suite's own person unless a test says otherwise.
   * @returns The workspace.
   */
  async function aWorkspace(
    overrides: Partial<Workspace> & { metadata?: string } = {},
    ownerId: string = sessionUserId,
  ): Promise<Workspace> {
    const slug = overrides.slug ?? aName();
    const name = overrides.name ?? "Integration Suite";

    const { rows } = await admin.query<{ id: string }>(
      `insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
       values (gen_random_uuid()::text, $1, $2, now(), $3)
       returning "id"`,
      [name, slug, overrides.metadata ?? null],
    );

    await join(rows[0].id, ownerId, "owner");

    return { id: rows[0].id, slug, name };
  }

  /**
   * Give somebody a role in a workspace.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param role - What they hold there.
   * @returns When the membership exists.
   */
  async function join(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<void> {
    await admin.query(
      `insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
       values (gen_random_uuid()::text, $1, $2, $3, now())`,
      [organizationId, userId, role],
    );
  }

  /**
   * Somebody else, with a session of their own and an optional membership.
   *
   * @param organizationId - The workspace to belong to, or `undefined` to belong nowhere.
   * @param role - What they hold there.
   * @returns Their id and the `Cookie` header a request from them carries.
   */
  async function anotherPerson(
    organizationId: string | undefined,
    role: OrganizationRole = "member",
  ): Promise<{ id: string; cookie: string }> {
    const id = await aPerson(anAddress());

    if (organizationId !== undefined) {
      await join(organizationId, id, role);
    }

    return { id, cookie: await signInAs(admin, id, SIGNING) };
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
   * Record a GitHub organisation for a workspace, over the API.
   *
   * @param organizationId - The workspace.
   * @param login - Its login. Invented inside the suite's namespace when not given.
   * @param enabled - Whether it starts switched on.
   * @returns The stored organisation.
   */
  async function addGithubOrg(
    organizationId: string,
    login: string = aName(),
    enabled?: boolean,
  ): Promise<GithubOrgResource> {
    return bodyOf<GithubOrgResource>(
      await signedIn("post", `${ORGS}/${organizationId}/github-orgs`)
        .send(enabled === undefined ? { login } : { login, enabled })
        .expect(201),
    );
  }

  /**
   * Turn a repository on.
   *
   * @param organizationId - The workspace.
   * @param login - The GitHub organisation.
   * @param name - The repository.
   * @returns The stored repository.
   */
  async function enableRepo(
    organizationId: string,
    login: string,
    name: string,
  ): Promise<RepoResource> {
    return bodyOf<RepoResource>(
      await signedIn("patch", `${ORGS}/${organizationId}/github-orgs/${login}/repos/${name}`)
        .send({ enabled: true })
        .expect(200),
    );
  }

  /**
   * The signed-in person's workspaces, as Step 2 rows.
   *
   * @returns The page.
   */
  async function myWorkspaces(): Promise<Page<OrgRowResource>> {
    return bodyOf<Page<OrgRowResource>>(await signedIn("get", ORGS).expect(200));
  }

  describe("the Step 2 row model", () => {
    it("reproduces the mockup's three rows, counts and all", async () => {
      // **The first acceptance criterion.** The development seed (#709) writes exactly these
      // three workspaces, and this suite runs against a database where the seed was a no-op
      // (`harness.integration-spec.ts` asserts that) — so rather than depending on rows that
      // are not there, it *builds* the seed's shape and asserts the answer mockup 01 Step 2
      // draws. The slugs carry this suite's prefix so the cleanup can find them; nothing the
      // mockup renders is derived from a slug.
      const robotics = await aWorkspace({ name: "Acme Robotics" });
      const labs = await aWorkspace({ name: "Acme Labs" });
      const personal = await aWorkspace({
        name: "Ken Suenobu",
        metadata: '{"personal": true}',
      });

      // acme-robotics: switched on, four repositories, `helios-firmware` first.
      const roboticsOrg = await addGithubOrg(robotics.id, `${TEST_PREFIX}-robotics`, true);
      for (const repo of [
        "helios-firmware",
        "helios-console",
        "helios-telemetry",
        "atlas-scheduler",
      ]) {
        await enableRepo(robotics.id, roboticsOrg.login, repo);
      }

      // acme-labs: recorded and switched off, with nothing under it.
      await addGithubOrg(labs.id, `${TEST_PREFIX}-labs`, false);

      // kensuenobu: switched on, two repositories, and the personal pill.
      const personalOrg = await addGithubOrg(personal.id, `${TEST_PREFIX}-personal`, true);
      for (const repo of ["dotfiles", "ouroboros-playground"]) {
        await enableRepo(personal.id, personalOrg.login, repo);
      }

      const page = await myWorkspaces();

      expect(page.total).toBe(3);
      // Oldest first, which is the order they were created in and the order the mockup draws.
      expect(page.items.map((row) => row.name)).toEqual([
        "Acme Robotics",
        "Acme Labs",
        "Ken Suenobu",
      ]);
      expect(page.items).toMatchObject([
        {
          monogram: "AR",
          personal: false,
          enabled: true,
          repoCounts: { enabled: 4, total: 4 },
          featuredRepo: "helios-firmware",
          roles: ["owner"],
        },
        {
          monogram: "AL",
          personal: false,
          enabled: false,
          repoCounts: { enabled: 0, total: 0 },
          featuredRepo: null,
        },
        {
          monogram: "KS",
          personal: true,
          enabled: true,
          repoCounts: { enabled: 2, total: 2 },
        },
      ]);
    });

    it("counts a disabled repository in the total and not in the enabled figure", async () => {
      // The two flags are independent by design (V003), and the row's line is about the
      // repository's own — so turning one off moves one number and not the other.
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id, aName(), true);
      await enableRepo(workspace.id, org.login, "helios-firmware");
      await enableRepo(workspace.id, org.login, "helios-console");

      await signedIn(
        "patch",
        `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/helios-console`,
      )
        .send({ enabled: false })
        .expect(200);

      const [row] = (await myWorkspaces()).items;
      expect(row.repoCounts).toEqual({ enabled: 1, total: 2 });
      expect(row.featuredRepo).toBe("helios-firmware");
    });

    it("is empty for somebody who belongs to nothing yet", async () => {
      // The login screen's `no-workspace` state, and a `200` rather than a refusal: choosing
      // where to work is what Step 2 is for.
      const stranger = await anotherPerson(undefined);

      const page = bodyOf<Page<OrgRowResource>>(
        await request(server()).get(ORGS).set("Cookie", stranger.cookie).expect(200),
      );

      expect(page).toEqual({ items: [], total: 0, limit: 25, offset: 0 });
    });

    it("lists only the workspaces you belong to", async () => {
      // Which is also the proof that the context reaches a service without being threaded
      // through one: `OrgsService.list` reads the caller from `AsyncLocalStorage`, and it can
      // only be there if the middleware opened a store and the guard wrote to it.
      const mine = await aWorkspace();
      const theirs = await aWorkspace({}, await aPerson(anAddress()));

      const page = await myWorkspaces();

      expect(page.items.map((row) => row.id)).toContain(mine.id);
      expect(page.items.map((row) => row.id)).not.toContain(theirs.id);
    });

    it("reports what the caller holds, not what the workspace's owner does", async () => {
      const workspace = await aWorkspace();
      const member = await anotherPerson(workspace.id, "member");

      const page = bodyOf<Page<OrgRowResource>>(
        await request(server()).get(ORGS).set("Cookie", member.cookie).expect(200),
      );

      expect(page.items).toMatchObject([{ id: workspace.id, roles: ["member"] }]);
    });

    it("reads a membership that carries more than one role as all of them", async () => {
      // `member.role` is un-CHECK-constrained text holding a comma-separated list (V005), and
      // read as one word `admin,member` would match no `@Roles()` at all.
      const workspace = await aWorkspace();
      const id = await aPerson(anAddress());
      await admin.query(
        `insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
         values (gen_random_uuid()::text, $1, $2, 'admin,member', now())`,
        [workspace.id, id],
      );

      const page = bodyOf<Page<OrgRowResource>>(
        await request(server())
          .get(ORGS)
          .set("Cookie", await signInAs(admin, id, SIGNING))
          .expect(200),
      );

      expect(page.items[0].roles).toEqual(["admin", "member"]);
    });

    it("needs no workspace to be chosen first", async () => {
      // It is the one `@TenantOptional()` route in this module, and the reason is circularity:
      // a session acting nowhere gets `400 organization_required` everywhere else, and this is
      // the call that tells them what there is to choose from.
      const stranger = await anotherPerson(undefined);

      await request(server()).get(ORGS).set("Cookie", stranger.cookie).expect(200);
      await request(server())
        .get(`${ORGS}/${ABSENT}/domains`)
        .set("Cookie", stranger.cookie)
        .expect(404);
    });

    it("refuses a browser with no session", async () => {
      await request(server()).get(ORGS).expect(401);
    });
  });

  describe("domains", () => {
    /**
     * Add a domain to a workspace.
     *
     * @param organizationId - The workspace.
     * @param domain - The domain to claim.
     * @param isPrimary - Whether it becomes the displayed one.
     * @returns The stored domain.
     */
    async function addDomain(
      organizationId: string,
      domain: string,
      isPrimary = false,
    ): Promise<DomainResource> {
      return bodyOf<DomainResource>(
        await signedIn("post", `${ORGS}/${organizationId}/domains`)
          .send({ domain, isPrimary })
          .expect(201),
      );
    }

    /**
     * List a workspace's domains.
     *
     * @param organizationId - The workspace.
     * @returns The page.
     */
    async function listDomains(organizationId: string): Promise<Page<DomainResource>> {
      return bodyOf<Page<DomainResource>>(
        await signedIn("get", `${ORGS}/${organizationId}/domains`).expect(200),
      );
    }

    it("adds one and lists it", async () => {
      const workspace = await aWorkspace();

      await addDomain(workspace.id, `${workspace.slug}.example`, true);

      expect(await listDomains(workspace.id)).toMatchObject({
        items: [{ domain: `${workspace.slug}.example`, isPrimary: true, orgId: workspace.id }],
        total: 1,
      });
    });

    it("maps a duplicate domain to 409 domain_taken", async () => {
      // #31's worked example, end to end: the rule is `tenant_domains_domain_key` in V001 —
      // which V006 preserved untouched, because `POST /api/v1/auth/discover` reads it — the
      // answer is this envelope, and nothing between them is mocked.
      const first = await aWorkspace();
      const second = await aWorkspace();
      const domain = `${first.slug}.example`;
      await addDomain(first.id, domain);

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${ORGS}/${second.id}/domains`).send({ domain }).expect(409),
      );

      expect(failure).toEqual({
        code: "domain_taken",
        message: "That domain belongs to another workspace.",
        details: {},
      });
    });

    it("moves the primary flag rather than adding a second one", async () => {
      // `tenant_domains_one_primary_per_organization` is a partial unique index — V001's
      // rule, re-scoped by V006 — so this only works because the demotion and the promotion
      // are in one transaction.
      const workspace = await aWorkspace();
      const first = await addDomain(workspace.id, `a-${workspace.slug}.example`, true);
      const second = await addDomain(workspace.id, `b-${workspace.slug}.example`);

      await signedIn("patch", `${ORGS}/${workspace.id}/domains/${second.id}`)
        .send({ isPrimary: true })
        .expect(200);

      const { items } = await listDomains(workspace.id);
      expect(items.filter((domain) => domain.isPrimary)).toHaveLength(1);
      expect(items.find((domain) => domain.isPrimary)?.id).toBe(second.id);
      expect(items.find((domain) => domain.id === first.id)?.isPrimary).toBe(false);
    });

    it("adds one as primary while another already holds the flag", async () => {
      const workspace = await aWorkspace();
      await addDomain(workspace.id, `a-${workspace.slug}.example`, true);

      await addDomain(workspace.id, `b-${workspace.slug}.example`, true);

      const { items } = await listDomains(workspace.id);
      expect(items.filter((domain) => domain.isPrimary)).toHaveLength(1);
    });

    it("demotes without promoting anything, which V001 permits", async () => {
      const workspace = await aWorkspace();
      const domain = await addDomain(workspace.id, `${workspace.slug}.example`, true);

      await signedIn("patch", `${ORGS}/${workspace.id}/domains/${domain.id}`)
        .send({ isPrimary: false })
        .expect(200);

      const { items } = await listDomains(workspace.id);
      expect(items.filter((each) => each.isPrimary)).toHaveLength(0);
    });

    it("removes one, and answers 204 with no body", async () => {
      const workspace = await aWorkspace();
      const domain = await addDomain(workspace.id, `${workspace.slug}.example`);

      const removed = await signedIn(
        "delete",
        `${ORGS}/${workspace.id}/domains/${domain.id}`,
      ).expect(204);

      expect(removed.body).toEqual({});
      expect(await listDomains(workspace.id)).toMatchObject({ items: [], total: 0 });
    });

    it("answers 404 for a domain that belongs to another workspace", async () => {
      // The existence leak this API refuses: the id is real, and the answer must not say so.
      const owner = await aWorkspace();
      const other = await aWorkspace();
      const domain = await addDomain(owner.id, `${owner.slug}.example`);

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("delete", `${ORGS}/${other.id}/domains/${domain.id}`).expect(404),
      );

      expect(failure.code).toBe("domain_not_found");
      // …and it is still the owner's.
      expect(await listDomains(owner.id)).toMatchObject({ total: 1 });
    });

    it("answers 404 for a workspace that does not exist", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${ORGS}/${ABSENT}/domains`).expect(404),
      );

      expect(failure.code).toBe("tenant_not_found");
    });
  });

  describe("GitHub enablement", () => {
    it("records an organisation switched off unless asked", async () => {
      const workspace = await aWorkspace();

      const org = await addGithubOrg(workspace.id);

      expect(org).toMatchObject({ enabled: false, installedAt: null, orgId: workspace.id });
    });

    it("refuses the same organisation twice for one workspace", async () => {
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${ORGS}/${workspace.id}/github-orgs`)
          .send({ login: org.login })
          .expect(409),
      );

      expect(failure.code).toBe("org_taken");
    });

    it("lets two workspaces each enable the same organisation", async () => {
      // The unique key is `(organization_id, login)`, not `login`: enablement is per
      // workspace, and each holds its own flag and its own installation. V006 restated V003's
      // rule under the new parent, and this is the assertion that it really did.
      const first = await aWorkspace();
      const second = await aWorkspace();
      const org = await addGithubOrg(first.id);

      await signedIn("post", `${ORGS}/${second.id}/github-orgs`)
        .send({ login: org.login })
        .expect(201);
    });

    it("enables and disables one, listing it either way", async () => {
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);

      const enabled = bodyOf<GithubOrgResource>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}`)
          .send({ enabled: true })
          .expect(200),
      );
      expect(enabled.enabled).toBe(true);

      await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}`)
        .send({ enabled: false })
        .expect(200);

      // A disabled organisation is still listed — a settings screen has to render the switch
      // that is off.
      const page = bodyOf<Page<GithubOrgResource>>(
        await signedIn("get", `${ORGS}/${workspace.id}/github-orgs`).expect(200),
      );
      expect(page).toMatchObject({ items: [{ login: org.login, enabled: false }], total: 1 });
    });

    it("reads one by its login", async () => {
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id, aName(), true);

      const read = bodyOf<GithubOrgResource>(
        await signedIn("get", `${ORGS}/${workspace.id}/github-orgs/${org.login}`).expect(200),
      );

      expect(read).toEqual(org);
    });

    it("answers 404 for an organisation this workspace has not recorded", async () => {
      const workspace = await aWorkspace();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${aName()}`)
          .send({ enabled: true })
          .expect(404),
      );

      expect(failure.code).toBe("org_not_found");
    });

    it("records a repository the first time it is enabled", async () => {
      // The upsert: there is no discovery flow yet to have created the row, so the PATCH is
      // what brings one into being.
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);

      const repo = bodyOf<RepoResource>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: true, defaultBranch: "main" })
          .expect(200),
      );

      expect(repo).toMatchObject({
        githubOrgId: org.id,
        name: "ouroboros",
        enabled: true,
        defaultBranch: "main",
      });
    });

    it("updates the same repository on a second call rather than duplicating it", async () => {
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);
      const created = bodyOf<RepoResource>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: true, defaultBranch: "main" })
          .expect(200),
      );

      const updated = bodyOf<RepoResource>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/ouroboros`)
          .send({ enabled: false })
          .expect(200),
      );

      expect(updated.id).toBe(created.id);
      expect(updated.enabled).toBe(false);
      // Omitted means "I am not setting this", not "set this to nothing".
      expect(updated.defaultBranch).toBe("main");
    });

    it("lists and reads an organisation's repositories", async () => {
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);
      await enableRepo(workspace.id, org.login, "ouroboros");

      const page = bodyOf<Page<RepoResource>>(
        await signedIn("get", `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos`).expect(200),
      );
      const one = bodyOf<RepoResource>(
        await signedIn(
          "get",
          `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/ouroboros`,
        ).expect(200),
      );

      expect(page).toMatchObject({ items: [{ name: "ouroboros", enabled: true }], total: 1 });
      expect(one).toEqual(page.items[0]);
    });

    it("answers 404 for a repository nothing has recorded", async () => {
      // The one operation that can. Its `PATCH` counterpart would create the row instead.
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn(
          "get",
          `${ORGS}/${workspace.id}/github-orgs/${org.login}/repos/never-heard-of-it`,
        ).expect(404),
      );

      expect(failure.code).toBe("repo_not_found");
    });

    it("answers the organisation's 404 rather than creating one", async () => {
      const workspace = await aWorkspace();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${aName()}/repos/ouroboros`)
          .send({ enabled: true })
          .expect(404),
      );

      expect(failure.code).toBe("org_not_found");
    });
  });

  describe("deleting a workspace", () => {
    it("takes everything that hangs off it", async () => {
      // Not an API operation — deleting a workspace is the organization plugin's — but the
      // cascade is what V006 restated when it re-parented these tables, and what this suite's
      // own cleanup relies on.
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);
      await signedIn("post", `${ORGS}/${workspace.id}/domains`)
        .send({ domain: `${workspace.slug}.example` })
        .expect(201);
      await enableRepo(workspace.id, org.login, "ouroboros");

      await admin.query(`delete from ouroboros.organization where "id" = $1`, [workspace.id]);

      const { rows } = await admin.query<{ count: string }>(
        `select (select count(*) from ouroboros.tenant_domains where organization_id = $1)
              + (select count(*) from ouroboros.github_orgs where organization_id = $1)
              + (select count(*) from ouroboros.github_repos where org_id = $2)
              + (select count(*) from ouroboros.member where "organizationId" = $1) as count`,
        [workspace.id, org.id],
      );
      expect(Number(rows[0].count)).toBe(0);
    });
  });

  describe("the tenant context", () => {
    it("answers 404 for a workspace you are not a member of", async () => {
      const workspace = await aWorkspace();
      const stranger = await anotherPerson(undefined);

      const failure = bodyOf<ErrorEnvelope>(
        await request(server())
          .get(`${ORGS}/${workspace.id}/domains`)
          .set("Cookie", stranger.cookie)
          .expect(404),
      );

      expect(failure.code).toBe("tenant_not_found");
    });

    it("answers a workspace that exists and one that does not identically", async () => {
      // The whole of *no existence leaks*: a difference in the code, the message or the
      // details is exactly what somebody enumerating identifiers is looking for.
      const workspace = await aWorkspace();
      const stranger = await anotherPerson(undefined);

      const real = await request(server())
        .get(`${ORGS}/${workspace.id}/domains`)
        .set("Cookie", stranger.cookie)
        .expect(404);
      const invented = await request(server())
        .get(`${ORGS}/${ABSENT}/domains`)
        .set("Cookie", stranger.cookie)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(real).code).toBe(bodyOf<ErrorEnvelope>(invented).code);
      expect(bodyOf<ErrorEnvelope>(real).message).toBe(bodyOf<ErrorEnvelope>(invented).message);
    });

    it("never answers 403 for a workspace you cannot see", async () => {
      const workspace = await aWorkspace();
      const stranger = await anotherPerson(undefined);

      await request(server())
        .post(`${ORGS}/${workspace.id}/github-orgs`)
        .set("Cookie", stranger.cookie)
        .send({ login: aName() })
        .expect(404);
    });

    it("refuses a member's toggle with 403 and lets an owner's through", async () => {
      // **The second acceptance criterion**, both halves in one test because the pair is the
      // claim: the same request, the same workspace, two roles, two answers.
      const workspace = await aWorkspace();
      const org = await addGithubOrg(workspace.id);
      const member = await anotherPerson(workspace.id, "member");

      const refused = bodyOf<ErrorEnvelope>(
        await request(server())
          .patch(`${ORGS}/${workspace.id}/github-orgs/${org.login}`)
          .set("Cookie", member.cookie)
          .send({ enabled: true })
          .expect(403),
      );

      expect(refused).toEqual({
        code: "forbidden",
        message: "Your role in this workspace does not permit this.",
        details: { role: "member", required: ["owner", "admin"] },
      });

      // …and the owner's succeeds, on the very same organisation.
      const allowed = bodyOf<GithubOrgResource>(
        await signedIn("patch", `${ORGS}/${workspace.id}/github-orgs/${org.login}`)
          .send({ enabled: true })
          .expect(200),
      );
      expect(allowed.enabled).toBe(true);
    });

    it("lets that same member read what they may not change", async () => {
      // A viewer is a role that exists to be able to look, and a member more so.
      const workspace = await aWorkspace();
      const member = await anotherPerson(workspace.id, "member");

      await request(server())
        .get(`${ORGS}/${workspace.id}/github-orgs`)
        .set("Cookie", member.cookie)
        .expect(200);
    });

    it("lets an admin do what a member may not", async () => {
      const workspace = await aWorkspace();
      const maintainer = await anotherPerson(workspace.id, "admin");

      await request(server())
        .post(`${ORGS}/${workspace.id}/github-orgs`)
        .set("Cookie", maintainer.cookie)
        .send({ login: aName() })
        .expect(201);
    });

    it("accepts a header that names the same workspace the path does, by slug", async () => {
      const workspace = await aWorkspace();

      await signedIn("get", `${ORGS}/${workspace.id}/domains`)
        .set("X-Ouro-Tenant", workspace.slug)
        .expect(200);
    });

    it("refuses a header that names a different workspace than the path", async () => {
      const one = await aWorkspace();
      const two = await aWorkspace();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${ORGS}/${one.id}/domains`)
          .set("X-Ouro-Tenant", two.slug)
          .expect(422),
      );

      expect(failure).toMatchObject({
        code: "tenant_mismatch",
        details: { path: one.id, header: two.slug },
      });
    });
  });

  describe("the tables V006 dropped", () => {
    it("are gone, so a statement naming one could not have succeeded", async () => {
      // **The third acceptance criterion**, from the database's side. Every request this suite
      // made above went through the whole module; if any statement in it still named
      // `tenant_members` or `users`, PostgreSQL would have answered `42P01` and the test that
      // issued it would already have failed. This is the assertion that the tables really are
      // absent, so that success above means what it says rather than meaning the old tables
      // happen to survive in this database.
      const { rows } = await admin.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'ouroboros'
            and table_name in ('tenants', 'tenant_members', 'users', 'user_identities')`,
      );

      expect(rows).toEqual([]);
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
      const workspace = await aWorkspace();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${ORGS}/${workspace.id}/github-orgs`)
          .send({ login: "Not A Login", enabled: "yes" })
          .expect(422),
      );

      expect(failure.code).toBe("validation_failed");
      expect(Object.keys(failure.details).sort()).toEqual(["enabled", "login"]);
    });

    it("refuses a property no DTO declares", async () => {
      const workspace = await aWorkspace();

      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("post", `${ORGS}/${workspace.id}/github-orgs`)
          .send({ login: aName(), installedAt: "2026-08-11T00:00:00.000Z" })
          .expect(422),
      );

      expect(failure.details).toHaveProperty("installedAt");
    });

    it("answers a malformed identifier with 422 rather than a query", async () => {
      const failure = bodyOf<ErrorEnvelope>(
        await signedIn("get", `${ORGS}/not-a-uuid/domains`).expect(422),
      );

      expect(failure.details).toHaveProperty("orgId");
    });
  });
});
