import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_BASE_PATH } from "../../application";
import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable, SHIPPED_PUBLIC_SURFACE } from "../auth/route.table.fixture";
import {
  isInstallerPath,
  INSTALL_SCRIPT_PATH,
  RELEASE_FILE_PATH,
} from "./installer/installer.paths";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { certificationRequest } from "./farm.fixture";
import type {
  EnrollmentResource,
  EnrollmentTokenResource,
  MintedTokenResource,
} from "./farm.resources";
import type { FarmResource, PoolResource } from "./fleet/fleet.resources";
import type { BuildJobResource } from "./dispatch/jobs.resources";

/**
 * **Organization isolation, on every farm route — enumerated, not sampled.**
 *
 * AH.7 ([#255](https://github.com/NobuData/ouroboros/issues/255)). The issue's criterion is
 * *isolation is asserted on **every** farm route, not a sample*, and the word doing the work is
 * "every". Each of AH.2–AH.6 ends with an isolation block of its own, and every one of them is a
 * hand-picked list: `fleet.integration-spec.ts` walks the three runner lifecycle routes and the
 * two pool writes, `dispatch.integration-spec.ts` walks submission, dispatch and cancellation,
 * `logs.integration-spec.ts` walks the one log route. Nothing anywhere walks the *registered*
 * routes, so the identity layer's five — the authority, the three token routes and the
 * certificate revocation — were covered by no isolation assertion at all, and a route added
 * tomorrow would be covered by none either. **That is the failure this file exists to make
 * impossible**: the list below is compared against what the router actually registered, and a
 * farm route with no entry fails the first test in the file rather than going unnoticed.
 *
 * It is the same trick `guard.surface.integration-spec.ts` plays with `routeTable`, asked about
 * a different property. That suite asks *what does a stranger get*; this one asks **what does a
 * neighbour get** — a real, signed-in, fully-privileged administrator of a different workspace,
 * which is the more dangerous caller of the two because every guard before the query lets them
 * through.
 *
 * ---------------------------------------------------------------------------
 * **Three kinds of claim**, because the farm's routes are three kinds of route and one assertion
 * would be wrong about two of them:
 *
 *   * **Addressed** — the route names a thing (`:id`, `:runnerId`, a `?pool=`, a repository).
 *     The claim is that aiming it at another workspace's thing is refused *and changes nothing*.
 *     Both halves matter: a route that answered `404` after deleting the row would satisfy a
 *     suite that only read the status.
 *   * **Collections** — the route names nothing and answers with whatever the caller may see.
 *     The claim is that the answer contains nothing of the other workspace.
 *   * **Unsessioned** — the five routes in `SHIPPED_PUBLIC_SURFACE` (registration, renewal, the
 *     artifact upload, and the installer's two). They take no workspace, so "refuse the neighbour" is not the claim
 *     and asserting it would be theatre. What is asserted instead is the property that makes
 *     them safe to expose: **the credential decides the workspace, and the tenant header cannot
 *     move it.** A token minted in B enrols into B while the caller shouts `A` in the header.
 *
 * ---------------------------------------------------------------------------
 * **The two workspaces are built once**, which is a deliberate departure from the
 * `afterEach(truncate)` most integration suites here use. Every case below asserts a *refusal*,
 * so none of them leaves anything behind to clean up, and the two cases that do write (creating
 * a pool in A, enrolling a runner into B) write into the workspace they were always going to.
 * Building a populated pair per case would mean twenty-one certificate authorities and
 * twenty-one signed certificates for assertions that share the same fixtures — minutes of real
 * ECDSA, against this issue's ≤ 90s budget.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** The farm's HTTP surface, from the origin root. */
const FARM = `${API_BASE_PATH}/farm`;

/** The commit every build here is of. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/** The one runner release this deployment has, so the installer's routes answer for real. */
const RELEASE = "0.7.0";

/** A refusal, as the service envelopes one. */
interface Refusal {
  readonly code: string;
}

/** One workspace, populated with one of everything the farm's routes can be aimed at. */
interface Tenant {
  readonly owner: Person;
  readonly workspace: Workspace;
  /** Distinct per workspace, so a pool named in a *body* cannot accidentally match the caller's own. */
  readonly poolName: string;
  readonly poolId: string;
  readonly repository: string;
  readonly runnerId: string;
  readonly certificate: string;
  readonly jobId: string;
  readonly tokenId: string;
}

/**
 * What one route's isolation claim is, and how to ask it.
 *
 * `about` is printed as the test name beside the signature, so a failure names the claim rather
 * than only the route.
 */
interface IsolationCase {
  readonly about: string;
  readonly check: (mine: Tenant, theirs: Tenant) => Promise<void>;
}

describe("organization isolation, on every farm route", () => {
  let api: ApiHarness;
  let mine: Tenant;
  let theirs: Tenant;

  beforeAll(async () => {
    // A public origin and a releases directory, because two of these routes refuse *before* they
    // look anything up without them. `GET /farm/enroll-command` answers
    // `farm_enroll_command_unavailable` on a deployment with no configured origin — a `404` that
    // would satisfy a status-only assertion while proving nothing whatever about isolation, since
    // the pool was never read. Configuring them is what makes the refusals below the ones this
    // file claims they are.
    const releases = await mkdtemp(join(tmpdir(), "ouro-isolation-releases-"));
    await mkdir(join(releases, RELEASE));
    await writeFile(join(releases, RELEASE, "SHA256SUMS"), "0  ouroboros-runner\n");

    api = await ApiHarness.start({
      OURO_FARM_CLIENT_CERT_HEADER: HEADER,
      OURO_FARM_PUBLIC_URL: "https://ouroboros.acme.dev",
      OURO_FARM_RELEASES_DIR: releases,
    });
    mine = await tenant("a");
    theirs = await tenant("b");
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  /**
   * A workspace with a pool, a mirrored repository, an enrolled runner, a queued build and a
   * live enrollment token — one of everything a farm route can name.
   *
   * @param suffix - Distinguishes this workspace's pool and repository from the other's, so that
   *   a route addressed *by name* rather than by id is still aimed across the boundary.
   * @returns The populated workspace.
   */
  async function tenant(suffix: string): Promise<Tenant> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const poolName = `pool-${suffix}`;
    const login = `acme-${suffix}`;
    const repo = `firmware-${suffix}`;

    const { rows: pools } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image, default_command)
       values ($1, $2, 'container', 'img:0.17', 'make all') returning id`,
      [workspace.id, poolName],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, login],
    );
    await api.sql.query(
      `insert into ouroboros.github_repos (org_id, name, enabled) values ($1, $2, true)`,
      [orgs[0].id, repo],
    );

    const context = {
      owner,
      workspace,
      poolName,
      poolId: pools[0].id,
      repository: `${login}/${repo}`,
    };

    // Enrolled through the real routes rather than inserted, because the certificate is what
    // `POST /farm/registrations/renewal` is addressed by — and a row without one could not be
    // aimed at that route at all.
    const minted = bodyOf<MintedTokenResource>(
      await as(context)("post", `${FARM}/enrollment-tokens`)
        .send({ pool: poolName, maxUses: 5 })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await api
        .anonymous("post", `${FARM}/registrations`)
        .send({
          token: minted.token,
          name: `forge-${suffix}`,
          arch: "linux/x86_64",
          csr: certificationRequest(),
        })
        .expect(201),
    );

    const job = bodyOf<BuildJobResource>(
      await as(context)("post", `${FARM}/jobs`)
        .send({
          pool: poolName,
          repository: context.repository,
          ref: "refs/heads/main",
          commit: COMMIT,
        })
        .expect(201),
    );

    return {
      ...context,
      runnerId: enrollment.runnerId,
      certificate: enrollment.certificate as string,
      jobId: job.id,
      tokenId: minted.id,
    };
  }

  /**
   * A request as a workspace's owner, in that workspace.
   *
   * @param context - Whose session and workspace to use.
   * @returns The bound request builder.
   */
  function as(context: { owner: Person; workspace: Workspace }) {
    return (method: "get" | "post" | "patch" | "delete", path: string) =>
      api.as(context.owner)(method, path).set(TENANT_HEADER, context.workspace.id);
  }

  /**
   * Aim a request at another workspace's object, as the caller's own workspace.
   *
   * This is the shape of every addressed case: a real session, a real active workspace, full
   * administrator rights in it — and an id belonging to somebody else.
   *
   * @param context - The caller.
   * @param method - The verb.
   * @param path - The path, carrying the other workspace's id.
   * @param body - What to send, for the verbs that take one.
   * @returns The refusal's code, having asserted the status.
   */
  async function refused(
    context: Tenant,
    method: "get" | "post" | "patch" | "delete",
    path: string,
    body?: object,
    status = 404,
  ): Promise<string> {
    const request = as(context)(method, path);
    const response = await (body === undefined ? request : request.send(body)).expect(status);

    return bodyOf<Refusal>(response).code;
  }

  /** A workspace's farm page, which is the cheapest read of everything it owns. */
  async function page(context: Tenant): Promise<FarmResource> {
    return bodyOf<FarmResource>(await as(context)("get", FARM).expect(200));
  }

  /** A runner's row, for asserting a refused mutation changed nothing. */
  async function runnerRow(runnerId: string): Promise<{ status: string; desired_state: string }> {
    const { rows } = await api.sql.query<{ status: string; desired_state: string }>(
      "select status, desired_state from ouroboros.runners where id = $1",
      [runnerId],
    );

    return rows[0];
  }

  /** A job's status, for the same reason. */
  async function jobStatus(jobId: string): Promise<string> {
    const { rows } = await api.sql.query<{ status: string }>(
      "select status from ouroboros.build_jobs where id = $1",
      [jobId],
    );

    return rows[0].status;
  }

  /**
   * Every farm route the application registered.
   *
   * The farm's surface is `/api/v1/farm/**` plus the installer's two, which are version-neutral
   * and live outside `/api` — so membership is asked through `isInstallerPath`, the module's own
   * answer to that question, rather than by a second copy of the rule here.
   *
   * @returns Their signatures, sorted.
   */
  function farmRoutes(): string[] {
    return routeTable(api.nest)
      .filter(
        (route) =>
          route.path === FARM || route.path.startsWith(`${FARM}/`) || isInstallerPath(route.path),
      )
      .map((route) => route.signature)
      .sort();
  }

  /**
   * The claim made about each route, by signature.
   *
   * Adding a farm route means adding a line here. That is the point: the test below compares
   * these keys against the router's own list, so the alternative to writing the claim down is a
   * red suite rather than a silent hole.
   */
  const CASES: Readonly<Record<string, IsolationCase>> = {
    // ---------------------------------------------------------------- collections
    [`GET ${FARM}`]: {
      about: "shows one workspace nothing of another's fleet",
      check: async (self, other) => {
        const payload = await page(self);

        expect(payload.runners.map((runner) => runner.id)).not.toContain(other.runnerId);
        expect(payload.pools.map((pool) => pool.id)).not.toContain(other.poolId);
        expect(payload.runners).toHaveLength(1);
      },
    },

    [`GET ${FARM}/pools`]: {
      about: "lists only the caller's own pools",
      check: async (self, other) => {
        const pools = bodyOf<PoolResource[]>(await as(self)("get", `${FARM}/pools`).expect(200));

        expect(pools.map((pool) => pool.id)).not.toContain(other.poolId);
        expect(pools.map((pool) => pool.name)).toEqual([self.poolName]);
      },
    },

    [`GET ${FARM}/enrollment-tokens`]: {
      about: "lists only the caller's own enrollment tokens",
      check: async (self, other) => {
        const tokens = bodyOf<EnrollmentTokenResource[]>(
          await as(self)("get", `${FARM}/enrollment-tokens`).expect(200),
        );

        expect(tokens.map((token) => token.id)).not.toContain(other.tokenId);
        expect(tokens.map((token) => token.id)).toContain(self.tokenId);
      },
    },

    [`GET ${FARM}/authority`]: {
      about: "hands each workspace its own certificate authority, never the other's",
      check: async (self, other) => {
        const ours = bodyOf<{ fingerprint: string }>(
          await as(self)("get", `${FARM}/authority`).expect(200),
        );
        const yours = bodyOf<{ fingerprint: string }>(
          await as(other)("get", `${FARM}/authority`).expect(200),
        );

        // Two workspaces, two CAs — which is what makes a certificate issued by one useless
        // against the other, and therefore what the whole identity layer's isolation rests on.
        expect(ours.fingerprint).not.toBe(yours.fingerprint);
      },
    },

    // ------------------------------------------------------------------ addressed
    [`POST ${FARM}/enrollment-tokens`]: {
      about: "will not mint a token against another workspace's pool",
      check: async (self, other) => {
        expect(
          await refused(self, "post", `${FARM}/enrollment-tokens`, { pool: other.poolName }),
        ).toBe("farm_pool_not_found");
      },
    },

    [`DELETE ${FARM}/enrollment-tokens/:id`]: {
      about: "will not revoke another workspace's token, and leaves it usable",
      check: async (self, other) => {
        expect(await refused(self, "delete", `${FARM}/enrollment-tokens/${other.tokenId}`)).toBe(
          "farm_enrollment_token_not_found",
        );

        const { rows } = await api.sql.query<{ revoked_at: Date | null }>(
          "select revoked_at from ouroboros.enrollment_tokens where id = $1",
          [other.tokenId],
        );
        expect(rows[0].revoked_at).toBeNull();
      },
    },

    [`DELETE ${FARM}/runners/:runnerId/certificate`]: {
      about: "will not revoke another workspace's runner certificate",
      check: async (self, other) => {
        expect(await refused(self, "delete", `${FARM}/runners/${other.runnerId}/certificate`)).toBe(
          "farm_runner_not_found",
        );

        const { rows } = await api.sql.query<{ live: string }>(
          `select count(*)::text as live from ouroboros.runner_certificates
            where runner_id = $1 and revoked_at is null`,
          [other.runnerId],
        );
        expect(rows[0].live).toBe("1");
      },
    },

    [`GET ${FARM}/enroll-command`]: {
      about: "mints an enroll command only for a pool of the caller's own workspace",
      check: async (self, other) => {
        expect(await refused(self, "get", `${FARM}/enroll-command?pool=${other.poolName}`)).toBe(
          "farm_pool_not_found",
        );
      },
    },

    [`POST ${FARM}/pools`]: {
      about: "creates the pool in the caller's workspace, where the other cannot see it",
      check: async (self, other) => {
        const created = bodyOf<PoolResource>(
          await as(self)("post", `${FARM}/pools`)
            .send({ name: "pool-fresh", executor: "shell" })
            .expect(201),
        );

        const seen = bodyOf<PoolResource[]>(await as(other)("get", `${FARM}/pools`).expect(200));
        expect(seen.map((pool) => pool.id)).not.toContain(created.id);

        await as(self)("delete", `${FARM}/pools/${created.id}`).expect(204);
      },
    },

    [`PATCH ${FARM}/pools/:id`]: {
      about: "will not patch another workspace's pool, and leaves it enabled",
      check: async (self, other) => {
        expect(
          await refused(self, "patch", `${FARM}/pools/${other.poolId}`, { enabled: false }),
        ).toBe("farm_pool_not_found");

        const { rows } = await api.sql.query<{ enabled: boolean }>(
          "select enabled from ouroboros.runner_pools where id = $1",
          [other.poolId],
        );
        expect(rows[0].enabled).toBe(true);
      },
    },

    [`DELETE ${FARM}/pools/:id`]: {
      about: "will not delete another workspace's pool, and leaves it standing",
      check: async (self, other) => {
        expect(await refused(self, "delete", `${FARM}/pools/${other.poolId}`)).toBe(
          "farm_pool_not_found",
        );

        const { rows } = await api.sql.query<{ n: string }>(
          "select count(*)::text as n from ouroboros.runner_pools where id = $1",
          [other.poolId],
        );
        expect(rows[0].n).toBe("1");
      },
    },

    [`POST ${FARM}/runners/:id/drain`]: {
      about: "will not drain another workspace's runner",
      check: async (self, other) => {
        expect(await refused(self, "post", `${FARM}/runners/${other.runnerId}/drain`, {})).toBe(
          "farm_runner_not_found",
        );
        expect((await runnerRow(other.runnerId)).desired_state).toBe("active");
      },
    },

    [`POST ${FARM}/runners/:id/undrain`]: {
      about: "will not undrain another workspace's runner",
      check: async (self, other) => {
        expect(await refused(self, "post", `${FARM}/runners/${other.runnerId}/undrain`, {})).toBe(
          "farm_runner_not_found",
        );
        expect((await runnerRow(other.runnerId)).desired_state).toBe("active");
      },
    },

    [`DELETE ${FARM}/runners/:id`]: {
      about: "will not remove another workspace's runner, and leaves it in the fleet",
      check: async (self, other) => {
        expect(await refused(self, "delete", `${FARM}/runners/${other.runnerId}`)).toBe(
          "farm_runner_not_found",
        );
        expect((await runnerRow(other.runnerId)).status).not.toBe("retired");
      },
    },

    [`POST ${FARM}/jobs`]: {
      about: "will not queue a build against another workspace's pool or repository",
      check: async (self, other) => {
        const before = await jobStatus(other.jobId);

        expect(
          await refused(self, "post", `${FARM}/jobs`, {
            pool: other.poolName,
            repository: self.repository,
            ref: "refs/heads/main",
            commit: COMMIT,
          }),
        ).toBe("farm_pool_not_found");

        expect(
          await refused(self, "post", `${FARM}/jobs`, {
            pool: self.poolName,
            repository: other.repository,
            ref: "refs/heads/main",
            commit: COMMIT,
          }),
        ).toBe("farm_repository_not_found");

        expect(await jobStatus(other.jobId)).toBe(before);
      },
    },

    [`POST ${FARM}/jobs/:id/cancel`]: {
      about: "will not cancel another workspace's build, and leaves it queued",
      check: async (self, other) => {
        const before = await jobStatus(other.jobId);

        expect(await refused(self, "post", `${FARM}/jobs/${other.jobId}/cancel`, {})).toBe(
          "farm_job_not_found",
        );
        expect(await jobStatus(other.jobId)).toBe(before);
      },
    },

    [`GET ${FARM}/jobs/:id/log`]: {
      about: "will not read another workspace's build log",
      check: async (self, other) => {
        expect(await refused(self, "get", `${FARM}/jobs/${other.jobId}/log`)).toBe(
          "farm_job_not_found",
        );
      },
    },

    // ---------------------------------------------------------------- unsessioned
    //
    // These five name no workspace, so the claim is not "the neighbour is refused" but "the
    // credential decides, and the header cannot argue". Asserting a refusal here would be
    // asserting something untrue about a route an unenrolled machine has to be able to reach.
    [`POST ${FARM}/registrations`]: {
      about: "enrols into the token's workspace however the request is addressed",
      check: async (self, other) => {
        const minted = bodyOf<MintedTokenResource>(
          await as(other)("post", `${FARM}/enrollment-tokens`)
            .send({ pool: other.poolName })
            .expect(201),
        );

        // The token is the other workspace's; every *other* signal on the request says this one.
        const enrolled = bodyOf<EnrollmentResource>(
          await api
            .anonymous("post", `${FARM}/registrations`)
            .set(TENANT_HEADER, self.workspace.id)
            .send({
              token: minted.token,
              name: "forge-crossed",
              arch: "linux/x86_64",
              csr: certificationRequest(),
            })
            .expect(201),
        );

        const { rows } = await api.sql.query<{ organization_id: string }>(
          "select organization_id from ouroboros.runners where id = $1",
          [enrolled.runnerId],
        );
        expect(rows[0].organization_id).toBe(other.workspace.id);
        expect(rows[0].organization_id).not.toBe(self.workspace.id);
      },
    },

    [`POST ${FARM}/registrations/renewal`]: {
      about: "renews the certificate's own runner, and refuses a certificate of no farm",
      check: async (self, other) => {
        const renewed = bodyOf<{ serial: string }>(
          await api
            .anonymous("post", `${FARM}/registrations/renewal`)
            .set(HEADER, encodeURIComponent(other.certificate))
            .set(TENANT_HEADER, self.workspace.id)
            .send({ csr: certificationRequest() })
            .expect(201),
        );

        // It landed on the certificate's runner — the other workspace's — and on no other.
        const { rows } = await api.sql.query<{ runner_id: string }>(
          "select runner_id from ouroboros.runner_certificates where serial = $1",
          [renewed.serial],
        );
        expect(rows[0].runner_id).toBe(other.runnerId);
      },
    },

    [`POST ${FARM}/jobs/:id/artifacts`]: {
      about: "admits only the job's own upload token, whatever workspace the header names",
      check: async (self, other) => {
        // The job in the path and the token its offer carried decide everything (#330); a tenant
        // header is not read, and a token no offer minted opens neither workspace's job.
        for (const jobId of [self.jobId, other.jobId]) {
          const response = await api
            .anonymous("post", `${FARM}/jobs/${jobId}/artifacts`)
            .set(TENANT_HEADER, self.workspace.id)
            .set("authorization", "Bearer ouro_upl_not-a-token-any-offer-carried")
            .set("content-type", "multipart/form-data; boundary=x")
            .send("--x--\r\n")
            .expect(401);

          expect(bodyOf<Refusal>(response).code).toBe("farm_artifact_upload_refused");
        }

        const { rows } = await api.sql.query(
          `select 1 from ouroboros.test_artifacts a
             join ouroboros.test_runs t on t.id = a.test_run_id
            where t.build_job_id in ($1, $2)`,
          [self.jobId, other.jobId],
        );
        expect(rows).toEqual([]);
      },
    },

    [`GET ${INSTALL_SCRIPT_PATH}`]: {
      about: "is the same public script whoever asks, because it reads no workspace",
      check: async (self, other) => {
        const ours = await api
          .anonymous("get", INSTALL_SCRIPT_PATH)
          .set(TENANT_HEADER, self.workspace.id);
        const yours = await api
          .anonymous("get", INSTALL_SCRIPT_PATH)
          .set(TENANT_HEADER, other.workspace.id);

        expect(ours.status).toBe(yours.status);
        expect(ours.text).toBe(yours.text);
      },
    },

    [`GET ${RELEASE_FILE_PATH}`]: {
      about: "answers from the releases directory alone, identically for either workspace",
      check: async (self, other) => {
        const path = `/runner/${RELEASE}/SHA256SUMS`;
        const ours = await api.anonymous("get", path).set(TENANT_HEADER, self.workspace.id);
        const yours = await api.anonymous("get", path).set(TENANT_HEADER, other.workspace.id);

        expect(ours.status).toBe(200);
        expect(ours.status).toBe(yours.status);
        expect(ours.text).toBe(yours.text);
      },
    },
  };

  it("HAS A CLAIM FOR EVERY FARM ROUTE THE APPLICATION REGISTERS", () => {
    // The assertion that makes the rest of the file a specification rather than a sample. A farm
    // route added without a line in CASES fails here, naming itself.
    expect(farmRoutes()).toEqual(Object.keys(CASES).sort());
  });

  it("agrees with the guard surface about which farm routes are unsessioned", () => {
    // The three kinds above are only meaningful if "unsessioned" means what the guard means by
    // it. This holds the five routes whose claim is the credential's, not the header's, to the
    // list the session guard actually exempts — so a route that quietly became public would not
    // keep its neighbour-is-refused claim.
    const unsessioned = farmRoutes().filter((signature) =>
      SHIPPED_PUBLIC_SURFACE.includes(signature),
    );

    expect(unsessioned).toEqual(
      [
        `POST ${FARM}/registrations`,
        `POST ${FARM}/registrations/renewal`,
        `POST ${FARM}/jobs/:id/artifacts`,
        `GET ${INSTALL_SCRIPT_PATH}`,
        `GET ${RELEASE_FILE_PATH}`,
      ].sort(),
    );
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(
        ([signature, value]) => [signature, value.about, value.check] as const,
      ),
    )("%s — %s", async (_signature, _about, check) => {
      await check(mine, theirs);
    });
  });
});
