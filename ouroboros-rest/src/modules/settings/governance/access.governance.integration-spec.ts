import { createHash } from "node:crypto";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import type { OrganizationRole } from "../../db/schema";
import { SCHEMA_NAME } from "../../db/schema";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../../decisions/decision.kinds.fixture";
import type { InboxQueueResource } from "../../decisions/inbox.queue";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import type { MemberResource, MembersPageResource } from "../../members/members.resources";
import { MergeExecutorService } from "../../pull-requests/merge/merge.executor";
import {
  one,
  PrPlaneHosts,
  prPlaneScene,
  type PrPlaneScene,
} from "../../pull-requests/pr-plane.integration.fixture";
import type {
  ServiceAccountResource,
  ServiceAccountSecretResource,
} from "../../service-accounts/service-accounts.resources";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import type { InMemoryPrHost } from "../../ticket-sources/providers/in-memory.pr.fixture";

/**
 * Who may act without asking, and as whom — the access half of the settings governance suites
 * ([#490](https://github.com/NobuData/ouroboros/issues/490), BR.6).
 *
 *   * **`can_approve_loops`** — owner, admin, member and viewer, each at the role default, ticked
 *     and unticked **through `PATCH /settings/members/:id`**, asserted at both real consumers in
 *     one table: the PR plane's approval route (`CapabilityGuard`) and the inbox executor
 *     (`assertMayPress`), with the inbox's read side (`actions[].allowed`) agreeing with what the
 *     executor allows. The viewer asymmetry is pinned: a ticked viewer may answer an inbox
 *     approver action but is refused the PR route by its role before the capability is read.
 *   * **Service tokens** — create → authenticate → scope-denied → rotate (old dead) → revoke (new
 *     dead), with both tokens revoked in the table, the audit actor `service:<name>`, hash-only
 *     storage, a malformed bearer refused, and the account routes refused below administrator.
 *
 * **The adversarial bar.** These are controls that fail *open* — a check that stops being called
 * quietly permits. So every refusal here is asserted alongside the absence of its side effect,
 * and each control has a row that would turn green-to-red if it were removed:
 *
 * | control removed                                              | turns red                       |
 * |--------------------------------------------------------------|---------------------------------|
 * | `CapabilityGuard`'s capability check (`tenancy/capabilities.ts`) | the matrix's PR column         |
 * | the inbox executor's `assertMayPress`                        | the matrix's inbox column, and the merge-class refusal |
 * | the scope check in `TenantContextGuard.admitService`          | the token chain's scope step    |
 * | the revoked/disabled filter in the token lookup              | the token chain's rotate/revoke steps |
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/access
 * ```
 */

/** A capability setting a matrix row is put in: none stored, or explicitly ticked/unticked. */
type Setting = "default" | "true" | "false";

/** One row of the capability matrix: who, how they were set, and what each consumer answers. */
interface MatrixRow {
  readonly role: OrganizationRole;
  readonly setting: Setting;
  /** The PR approval route's status, and its error code when refused. */
  readonly pr: string;
  /** The inbox executor's status for an approver action, and its code when refused. */
  readonly inbox: string;
  /** What `GET /api/v1/inbox` says about that action for this person. */
  readonly shown: boolean;
}

/**
 * Every role at every setting. `501 decision_action_unbound` is the inbox executor **admitting**
 * the press — `plan_sign_off` has no plane operation yet, so a press that passes the capability
 * check fails afterwards with the item still open, and no plane is touched either way.
 */
const MATRIX: readonly MatrixRow[] = [
  { role: "owner", setting: "default", pr: "200", inbox: "501", shown: true },
  { role: "owner", setting: "true", pr: "200", inbox: "501", shown: true },
  {
    role: "owner",
    setting: "false",
    pr: "403 capability_required",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
  { role: "admin", setting: "default", pr: "200", inbox: "501", shown: true },
  { role: "admin", setting: "true", pr: "200", inbox: "501", shown: true },
  {
    role: "admin",
    setting: "false",
    pr: "403 capability_required",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
  {
    role: "member",
    setting: "default",
    pr: "403 capability_required",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
  { role: "member", setting: "true", pr: "200", inbox: "501", shown: true },
  {
    role: "member",
    setting: "false",
    pr: "403 capability_required",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
  // The asymmetry: the PR routes are CONTRIBUTORS-only, so a viewer is refused by role there
  // whatever the capability says; the inbox reads the capability alone.
  {
    role: "viewer",
    setting: "default",
    pr: "403 forbidden",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
  { role: "viewer", setting: "true", pr: "403 forbidden", inbox: "501", shown: true },
  {
    role: "viewer",
    setting: "false",
    pr: "403 forbidden",
    inbox: "403 decision_action_forbidden",
    shown: false,
  },
];

/** The farm job a service token submits. */
const JOB = {
  pool: "pool-a",
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
};

/** The service-token prefix every minted token carries. */
const TOKEN_PREFIX = "orb_svc_";

describe("settings governance: capabilities and service tokens (#490)", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      hosts.overrides(),
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
  });

  afterEach(async () => {
    await api.nest.get(MergeExecutorService).settled();
    await api.truncate();
  });

  /**
   * A call as somebody, in the scene's workspace.
   *
   * @param person - Who.
   * @param at - The scene.
   * @param method - The verb.
   * @param path - The path.
   * @returns The request.
   */
  function as(person: Person, at: PrPlaneScene, method: "get" | "post" | "patch", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /**
   * A call carrying only a bearer token — no cookie, no tenant header.
   *
   * @param token - The bearer.
   * @param method - The verb.
   * @param path - The path.
   * @returns The request.
   */
  function asToken(token: string, method: "get" | "post", path: string) {
    return api.anonymous(method, path).set("Authorization", `Bearer ${token}`);
  }

  /**
   * A status and, when refused, the envelope's code — one comparable string per answer.
   *
   * @param response - What came back.
   * @returns `"200"`, or `"403 capability_required"`.
   */
  function outcome(response: { status: number; body: unknown }): string {
    return response.status < 400
      ? String(response.status)
      : `${String(response.status)} ${(response.body as ErrorEnvelope).code}`.replace(
          /^501 .*/,
          "501",
        );
  }

  /**
   * Set a member's `can_approve_loops` the way the Members card does, as the scene's owner.
   *
   * @param at - The scene.
   * @param person - Whose.
   * @param value - Ticked or unticked.
   * @returns Their row afterwards.
   */
  async function tick(at: PrPlaneScene, person: Person, value: boolean): Promise<MemberResource> {
    const page = bodyOf<MembersPageResource>(
      await as(at.owner, at, "get", "/api/v1/settings/members").expect(200),
    );
    const row = page.members.find((member) => member.userId === person.id);

    if (row === undefined) throw new Error(`${person.id} is not on the Members card`);

    return bodyOf<MemberResource>(
      await as(at.owner, at, "patch", `/api/v1/settings/members/${row.id}`)
        .send({ canApproveLoops: value })
        .expect(200),
    );
  }

  /**
   * File an inbox item on the scene's run.
   *
   * @param at - The scene.
   * @param kindId - `plan_sign_off` or `merge_approval`.
   * @returns The item's id.
   */
  async function file(
    at: PrPlaneScene,
    kindId: "plan_sign_off" | "merge_approval",
  ): Promise<string> {
    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: at.org,
      kindId,
      payload: SEEDED_PAYLOADS[kindId],
      refs:
        kindId === "merge_approval"
          ? [
              { type: "run", id: at.runId, label: "loop #1" },
              { type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` },
            ]
          : [{ type: "run", id: at.runId, label: "loop #1" }],
      key:
        kindId === "merge_approval"
          ? { plane: "pr.gates", sourceRef: `pr:${at.prId}` }
          : { plane: "workflows", sourceRef: `run:${at.runId}:stage:plan` },
    });

    if (itemId === undefined || itemId === null) throw new Error(`${kindId} was not filed`);

    return itemId;
  }

  /**
   * How many rows a person's presses and approvals left behind.
   *
   * @param at - The scene.
   * @param person - Whose.
   * @returns Their decision attempts and PR approvals.
   */
  async function tracesOf(
    at: PrPlaneScene,
    person: Person,
  ): Promise<{ attempts: number; approvals: number }> {
    return one<{ attempts: number; approvals: number }>(
      api,
      `select (select count(*) from ${SCHEMA_NAME}.decision_action_attempts
               where organization_id = $1 and actor_id = $2)::int as attempts,
              (select count(*) from ${SCHEMA_NAME}.pr_approvals
               where pr_id = $3 and decided_by = $2)::int as approvals`,
      [at.org, person.id, at.prId],
    );
  }

  describe("can_approve_loops", () => {
    it("holds the role × setting matrix at the PR plane and the inbox executor, and the inbox shows what the executor allows", async () => {
      const at = await prPlaneScene(api, host);
      const item = await file(at, "plan_sign_off");
      const people: Person[] = [];

      for (const row of MATRIX) {
        const person = await api.signIn();

        await api.join(at.org, person, row.role);
        if (row.setting !== "default") await tick(at, person, row.setting === "true");
        people.push(person);
      }

      const observed: MatrixRow[] = [];

      for (const [index, row] of MATRIX.entries()) {
        const person = people[index];
        const queue = bodyOf<InboxQueueResource>(
          await as(person, at, "get", "/api/v1/inbox").expect(200),
        );
        const shown = queue.items
          .find((candidate) => candidate.id === item)
          ?.actions.find((action) => action.id === "sign_off")?.allowed;
        const pr = await as(person, at, "post", `/api/v1/pull-requests/${at.prId}/approvals`).send({
          decision: "approve",
        });
        const inbox = await as(
          person,
          at,
          "post",
          `/api/v1/inbox/items/${item}/actions/sign_off`,
        ).send({});

        observed.push({
          role: row.role,
          setting: row.setting,
          pr: outcome(pr),
          inbox: outcome(inbox),
          shown: shown === true,
        });

        // A refusal leaves nothing behind: no approval row, no recorded attempt.
        const traces = await tracesOf(at, person);

        expect({ row: `${row.role}/${row.setting}`, ...traces }).toEqual({
          row: `${row.role}/${row.setting}`,
          approvals: pr.status === 200 ? 1 : 0,
          attempts: inbox.status === 501 ? 1 : 0,
        });
      }

      expect(observed).toEqual(MATRIX);

      // Every explicit setting went through the card, and each is on the record.
      const changed = await api.sql.query<{ detail: Record<string, unknown> }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'member.capability_changed'
          order by occurred_at`,
        [at.org],
      );

      expect(changed.rows).toHaveLength(MATRIX.filter((row) => row.setting !== "default").length);
      expect(changed.rows[0].detail).toMatchObject({
        capability: "can_approve_loops",
        before: true,
        after: true,
        before_source: "role",
      });
      expect(changed.rows.map((row) => row.detail.after)).toEqual(
        MATRIX.filter((row) => row.setting !== "default").map((row) => row.setting === "true"),
      );
    });

    it("refuses an unticked admin's approve & merge before the PR plane is touched, and the same press succeeds once ticked", async () => {
      const at = await prPlaneScene(api, host);
      const item = await file(at, "merge_approval");
      const admin = await api.signIn();

      await api.join(at.org, admin, "admin");
      expect(await tick(at, admin, false)).toMatchObject({
        canApproveLoops: false,
        canApproveLoopsSource: "explicit",
      });

      await as(admin, at, "post", `/api/v1/inbox/items/${item}/actions/approve_merge`)
        .send({})
        .expect(403)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: "decision_action_forbidden",
            details: { required: "approver" },
          });
        });

      const untouched = await one<{ approvals: number; armed: number; status: string }>(
        api,
        `select (select count(*) from ${SCHEMA_NAME}.pr_approvals where pr_id = $1)::int as approvals,
                (select count(*) from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1 and armed)::int as armed,
                (select status from ${SCHEMA_NAME}.decision_items where id = $2) as status`,
        [at.prId, item],
      );

      expect(untouched).toEqual({ approvals: 0, armed: 0, status: "open" });
      expect(await tracesOf(at, admin)).toEqual({ attempts: 0, approvals: 0 });

      await tick(at, admin, true);
      await as(admin, at, "post", `/api/v1/inbox/items/${item}/actions/approve_merge`)
        .send({})
        .expect(200);

      const armed = await one<{ armed: number; status: string }>(
        api,
        `select (select count(*) from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1 and armed)::int as armed,
                (select status from ${SCHEMA_NAME}.decision_items where id = $2) as status`,
        [at.prId, item],
      );

      expect(armed).toEqual({ armed: 1, status: "resolved" });
    });

    // The tenant guard refuses first: an approval is a POST with no declared service scope, so it is
    // for people only. `CapabilityGuard` refuses a service too, behind it — defence in depth.
    it("refuses a service token on an approval route — a service holds no person's approval power", async () => {
      const at = await prPlaneScene(api, host);
      const created = bodyOf<ServiceAccountSecretResource>(
        await as(at.owner, at, "post", "/api/v1/settings/service-accounts")
          .send({ name: "devops-bot", scopes: ["api.read", "farm.submit"] })
          .expect(201),
      );

      const refused = await asToken(
        created.token,
        "post",
        `/api/v1/pull-requests/${at.prId}/approvals`,
      ).send({ decision: "approve" });

      expect(refused.status).toBe(403);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("service_principal_refused");
      expect(
        (
          await one<{ approvals: number }>(
            api,
            `select count(*)::int as approvals from ${SCHEMA_NAME}.pr_approvals where pr_id = $1`,
            [at.prId],
          )
        ).approvals,
      ).toBe(0);
    });
  });

  describe("service tokens", () => {
    let owner: Person;
    let workspace: Workspace;

    beforeEach(async () => {
      owner = await api.signIn();
      workspace = await api.workspace(owner);
    });

    /**
     * A settings call as somebody, in this describe's workspace.
     *
     * @param person - Who.
     * @param method - The verb.
     * @param path - The path.
     * @returns The request.
     */
    function inWorkspace(person: Person, method: "get" | "post", path: string) {
      return api.as(person)(method, path).set(TENANT_HEADER, workspace.id);
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

    it("walks create → authenticate → scope-denied → rotate → revoke, each dead token dead in the table, acting as service:<name>, stored hash-only", async () => {
      const accounts = "/api/v1/settings/service-accounts";

      await farm();

      const created = bodyOf<ServiceAccountSecretResource>(
        await inWorkspace(owner, "post", accounts)
          .send({ name: "ci-bot", scopes: ["api.read", "farm.submit"] })
          .expect(201),
      );
      const account = created.account.id;

      // Authenticate: the token acts, and the trail names the service rather than a person.
      await asToken(created.token, "post", "/api/v1/farm/jobs").send(JOB).expect(201);

      const submitted = await one<{ actor_id: string | null; actor_service: string | null }>(
        api,
        `select actor_id, actor_service from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'runner.job_submitted'`,
        [workspace.id],
      );

      expect(submitted).toEqual({ actor_id: null, actor_service: "ci-bot" });

      const trail = await inWorkspace(
        owner,
        "get",
        "/api/v1/settings/audit?action=runner.job_submitted",
      ).expect(200);

      expect((trail.body as { items: object[] }).items[0]).toMatchObject({
        actorKind: "service",
        actorService: "ci-bot",
      });

      // Scope-denied: the same workspace's reader token cannot submit.
      const reader = bodyOf<ServiceAccountSecretResource>(
        await inWorkspace(owner, "post", accounts)
          .send({ name: "read-bot", scopes: ["api.read"] })
          .expect(201),
      );
      const jobsBefore = await one<{ jobs: number }>(
        api,
        `select count(*)::int as jobs from ${SCHEMA_NAME}.build_jobs where organization_id = $1`,
        [workspace.id],
      );

      await asToken(reader.token, "post", "/api/v1/farm/jobs")
        .send(JOB)
        .expect(403)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: "service_scope_missing",
            details: { scope: "farm.submit" },
          });
        });
      expect(
        await one<{ jobs: number }>(
          api,
          `select count(*)::int as jobs from ${SCHEMA_NAME}.build_jobs where organization_id = $1`,
          [workspace.id],
        ),
      ).toEqual(jobsBefore);

      // Rotate: the old token is dead at once, the new one works.
      const rotated = bodyOf<ServiceAccountSecretResource>(
        await inWorkspace(owner, "post", `${accounts}/${account}/rotate`).expect(200),
      );

      await asToken(created.token, "get", "/api/v1/settings/lifecycle")
        .expect(401)
        .expect((response) => {
          expect(bodyOf<ErrorEnvelope>(response).code).toBe("service_token_invalid");
        });
      await asToken(rotated.token, "get", "/api/v1/settings/lifecycle").expect(200);

      // Revoke: the new token is dead too.
      const revoked = bodyOf<ServiceAccountResource>(
        await inWorkspace(owner, "post", `${accounts}/${account}/revoke`).expect(200),
      );

      expect(revoked.disabledAt).not.toBeNull();
      await asToken(rotated.token, "get", "/api/v1/settings/lifecycle").expect(401);
      await asToken(rotated.token, "post", "/api/v1/farm/jobs").send(JOB).expect(401);

      const tokens = await api.sql.query<{ token_hash: string; revoked: boolean }>(
        `select token_hash, revoked_at is not null as revoked from ${SCHEMA_NAME}.service_tokens
          where service_account_id = $1 order by created_at`,
        [account],
      );

      expect(tokens.rows).toEqual([
        { token_hash: createHash("sha256").update(created.token).digest("hex"), revoked: true },
        { token_hash: createHash("sha256").update(rotated.token).digest("hex"), revoked: true },
      ]);

      // Hash-only: no row of the three tables a token touches holds any token's secret half.
      const secrets = [created.token, rotated.token, reader.token].map((token) =>
        token.slice(TOKEN_PREFIX.length),
      );
      const dumped = await api.sql.query<{ row: string }>(
        `select row_to_json(t)::text as row from ${SCHEMA_NAME}.service_tokens t
         union all select row_to_json(a)::text from ${SCHEMA_NAME}.service_accounts a
         union all select row_to_json(e)::text from ${SCHEMA_NAME}.audit_events e`,
      );

      for (const secret of secrets) {
        expect(dumped.rows.filter(({ row }) => row.includes(secret))).toEqual([]);
      }
    });

    it("refuses a malformed bearer, and keeps the account routes from members and viewers", async () => {
      const accounts = "/api/v1/settings/service-accounts";
      const created = bodyOf<ServiceAccountSecretResource>(
        await inWorkspace(owner, "post", accounts)
          .send({ name: "devops-bot", scopes: ["api.read"] })
          .expect(201),
      );

      for (const bearer of ["not-a-token", `${TOKEN_PREFIX}`, `${created.token}x`]) {
        await asToken(bearer, "get", "/api/v1/settings/lifecycle").expect(401);
      }

      const member = await api.signIn();
      const viewer = await api.signIn();

      await api.join(workspace.id, member, "member");
      await api.join(workspace.id, viewer, "viewer");

      for (const person of [member, viewer]) {
        await inWorkspace(person, "get", accounts).expect(403);
        await inWorkspace(person, "post", accounts)
          .send({ name: "sneaky-bot", scopes: ["farm.submit"] })
          .expect(403);
        await inWorkspace(person, "post", `${accounts}/${created.account.id}/rotate`).expect(403);
        await inWorkspace(person, "post", `${accounts}/${created.account.id}/revoke`).expect(403);
      }

      const state = await api.sql.query<{ name: string; disabled: boolean; tokens: number }>(
        `select a.name, a.disabled_at is not null as disabled,
                (select count(*) from ${SCHEMA_NAME}.service_tokens t
                  where t.service_account_id = a.id)::int as tokens
           from ${SCHEMA_NAME}.service_accounts a where a.organization_id = $1`,
        [workspace.id],
      );

      expect(state.rows).toEqual([{ name: "devops-bot", disabled: false, tokens: 1 }]);
      await asToken(created.token, "get", "/api/v1/settings/lifecycle").expect(200);
    });
  });
});
