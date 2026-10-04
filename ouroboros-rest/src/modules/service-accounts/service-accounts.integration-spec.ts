import { createHash } from "node:crypto";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type {
  ServiceAccountListResource,
  ServiceAccountResource,
  ServiceAccountSecretResource,
} from "./service-accounts.resources";

/**
 * Service accounts, end to end over HTTP on a real database
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1):
 *
 *   * **create → authenticate → rotate → revoke** — the pre-rotation token stops working at
 *     once, and the revoked one is dead;
 *   * **hash-only** — no row in the database and no list or read response holds the token;
 *   * **scopes at the route** — a token outside its scopes is a `403` naming the missing scope;
 *   * **audit actor** — a service-authenticated submission is recorded as `service:devops-bot`.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/service-accounts
 * ```
 */

const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

describe("service accounts", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
  });

  afterEach(() => api.truncate());

  /** A settings call as the owner. */
  function asOwner(method: "get" | "post", path: string) {
    return api.as(owner)(method, path).set(TENANT_HEADER, workspace.id);
  }

  /** A call carrying only a bearer token — no cookie, no tenant header. */
  function asToken(token: string, method: "get" | "post", path: string) {
    return api.anonymous(method, path).set("Authorization", `Bearer ${token}`);
  }

  /** Create an account through the route. */
  async function create(scopes: string[]): Promise<ServiceAccountSecretResource> {
    return bodyOf<ServiceAccountSecretResource>(
      await asOwner("post", "/api/v1/settings/service-accounts")
        .send({ name: "devops-bot", scopes })
        .expect(201),
    );
  }

  /** Give the workspace a pool and an enabled repository a job can be submitted against. */
  async function farm(): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runner_pools
         (organization_id, name, executor, image, max_concurrency, default_command, enabled)
       values ($1, 'pool-a', 'container', 'img:0.17', 1, 'make all', true)`,
      [workspace.id],
    );
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled) values ($1, 'helios-firmware', true)`,
      [rows[0].id],
    );
  }

  const JOB = {
    pool: "pool-a",
    repository: "acme-robotics/helios-firmware",
    ref: "refs/heads/main",
    commit: COMMIT,
  };

  it("completes create → authenticate → rotate → revoke, and a replaced token stops working at once", async () => {
    const created = await create(["api.read"]);

    expect(created.token).toMatch(/^orb_svc_[A-Za-z0-9_-]{43}$/);
    expect(created.account).toMatchObject({ name: "devops-bot", actor: "service:devops-bot" });
    expect(created.account.token?.hint).toMatch(/^orb_svc_•{4}.{4}$/);

    await asToken(created.token, "get", "/api/v1/settings/lifecycle").expect(200);

    const rotated = bodyOf<ServiceAccountSecretResource>(
      await asOwner(
        "post",
        `/api/v1/settings/service-accounts/${created.account.id}/rotate`,
      ).expect(200),
    );

    expect(rotated.token).not.toBe(created.token);
    await asToken(created.token, "get", "/api/v1/settings/lifecycle")
      .expect(401)
      .expect((response) => {
        expect((response.body as { code: string }).code).toBe("service_token_invalid");
      });
    await asToken(rotated.token, "get", "/api/v1/settings/lifecycle").expect(200);

    const revoked = bodyOf<ServiceAccountResource>(
      await asOwner(
        "post",
        `/api/v1/settings/service-accounts/${created.account.id}/revoke`,
      ).expect(200),
    );

    expect(revoked.disabledAt).not.toBeNull();
    expect(revoked.token).toBeNull();
    await asToken(rotated.token, "get", "/api/v1/settings/lifecycle").expect(401);
    await asOwner("post", `/api/v1/settings/service-accounts/${created.account.id}/rotate`)
      .expect(409)
      .expect((response) => {
        expect((response.body as { code: string }).code).toBe("service_account_disabled");
      });

    const trail = await api.sql.query<{ action: string }>(
      `select action from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and subject_type = 'service_account' order by occurred_at`,
      [workspace.id],
    );

    expect(trail.rows.map((row) => row.action)).toEqual([
      "service_account.created",
      "service_account.rotated",
      "service_account.revoked",
    ]);
  });

  it("stores the token hash-only and never returns it from a list or read", async () => {
    const created = await create(["api.read"]);
    const digest = createHash("sha256").update(created.token).digest("hex");

    const stored = await api.sql.query<{ token_hash: string; hint_sealed: string }>(
      `select token_hash, hint_sealed from ${SCHEMA_NAME}.service_tokens where service_account_id = $1`,
      [created.account.id],
    );

    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_hash).toBe(digest);
    expect(stored.rows[0].hint_sealed).toMatch(/^ouro\.v1\./);

    // The grep: nothing any of the touched tables holds contains the token, or its secret half.
    const secret = created.token.slice("orb_svc_".length);
    const dumped = await api.sql.query<{ row: string }>(
      `select row_to_json(t)::text as row from ${SCHEMA_NAME}.service_tokens t
       union all select row_to_json(a)::text from ${SCHEMA_NAME}.service_accounts a
       union all select row_to_json(e)::text from ${SCHEMA_NAME}.audit_events e`,
    );

    for (const { row } of dumped.rows) {
      expect(row).not.toContain(secret);
    }

    const list = await asOwner("get", "/api/v1/settings/service-accounts").expect(200);
    const members = await asOwner("get", "/api/v1/settings/members").expect(200);

    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(members.body)).not.toContain(secret);
    expect(bodyOf<ServiceAccountListResource>(list).items[0].token?.hint).toBe(
      created.account.token?.hint,
    );
  });

  it("refuses a token outside its scopes with a 403 naming the missing scope", async () => {
    const created = await create(["api.read"]);

    await farm();
    await asToken(created.token, "post", "/api/v1/farm/jobs")
      .send(JOB)
      .expect(403)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: "service_scope_missing",
          details: { scope: "farm.submit" },
        });
      });

    // A person's read and an administrator's route refuse every service account.
    await asToken(created.token, "get", "/api/v1/settings/members")
      .expect(403)
      .expect((response) => {
        expect((response.body as { code: string }).code).toBe("service_principal_refused");
      });
    await asToken(created.token, "get", "/api/v1/settings/service-accounts").expect(403);
  });

  it("records a service-authenticated request as service:<name>, distinct from a person", async () => {
    const created = await create(["farm.submit"]);

    await farm();
    await asToken(created.token, "post", "/api/v1/farm/jobs").send(JOB).expect(201);

    const event = await api.sql.query<{ actor_id: string | null; actor_service: string | null }>(
      `select actor_id, actor_service from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'runner.job_submitted'`,
      [workspace.id],
    );

    expect(event.rows).toEqual([{ actor_id: null, actor_service: "devops-bot" }]);

    const trail = await asOwner(
      "get",
      "/api/v1/providers/audit?action=runner.job_submitted",
    ).expect(200);

    expect((trail.body as { items: object[] }).items[0]).toMatchObject({
      actorKind: "service",
      actorService: "devops-bot",
      actorId: null,
    });

    const used = bodyOf<ServiceAccountListResource>(
      await asOwner("get", "/api/v1/settings/service-accounts").expect(200),
    );

    expect(used.items[0].token?.lastUsedAt).not.toBeNull();
  });

  it("does not let a service token act in another workspace", async () => {
    const created = await create(["api.read"]);
    const stranger = await api.signIn();
    const elsewhere = await api.workspace(stranger);

    await asToken(created.token, "get", "/api/v1/settings/lifecycle")
      .set(TENANT_HEADER, elsewhere.id)
      .expect(404);
  });
});
