import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { OrgPolicyService, type DryRunPolicyResource } from "./org-policy.service";

/**
 * `/api/v1/policies/dry-run`, over a socket and against a migrated database (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * The criteria only this scale proves: the flip is refused for a member and a viewer on a direct
 * API call and writes nothing; an owner's or admin's flip persists and is audited with the actor,
 * the instant and the value it replaced; and onboarding completion's default turns an unset
 * workspace on without overwriting an explicit `false`.
 *
 * ```bash
 * yarn test:integration src/modules/policies
 * ```
 */

const POLICY = "/api/v1/policies/dry-run";

describe("the dry-run policy endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The workspace's policy rows, straight from the table. */
  async function stored(organizationId: string): Promise<{ dry_run: boolean }[]> {
    const { rows } = await api.sql.query<{ dry_run: boolean }>(
      `select dry_run from ${SCHEMA_NAME}.org_policies where organization_id = $1`,
      [organizationId],
    );

    return rows;
  }

  /** The workspace's flips, from the audit trail. */
  async function flips(organizationId: string) {
    const { rows } = await api.sql.query<{
      actor_id: string | null;
      subject_type: string;
      subject_id: string;
      detail: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select actor_id, subject_type, subject_id, detail, occurred_at
         from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'policy.dry_run_changed'
        order by occurred_at`,
      [organizationId],
    );

    return rows;
  }

  it("refuses a stranger", async () => {
    await api.anonymous("get", POLICY).expect(401);
    await api.anonymous("patch", POLICY).expect(401);
  });

  it("lets a viewer read, and reads a workspace that never answered as off", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const policy = bodyOf<DryRunPolicyResource>(
      await api.as(viewer)("get", POLICY).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(policy).toEqual({
      dryRun: false,
      explicit: false,
      reason: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it.each(["member", "viewer"] as const)(
    "refuses a %s's flip on a direct call, and writes nothing",
    async (role) => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const person = await api.signIn();
      await api.join(workspace.id, person, role);

      const response = await api
        .as(person)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: false })
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "forbidden",
        details: { role, required: [...ADMINISTRATORS] },
      });
      expect(await stored(workspace.id)).toEqual([]);
      expect(await flips(workspace.id)).toEqual([]);
    },
  );

  it("persists an admin's flip and audits actor, instant and prior value", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const admin = await api.signIn();
    await api.join(workspace.id, admin, "admin");

    const on = bodyOf<DryRunPolicyResource>(
      await api
        .as(admin)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: true })
        .expect(200),
    );
    const off = bodyOf<DryRunPolicyResource>(
      await api
        .as(owner)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: false })
        .expect(200),
    );

    expect(on).toMatchObject({ dryRun: true, explicit: true, reason: "dry-run policy active" });
    expect(off).toMatchObject({ dryRun: false, explicit: true, reason: null, updatedBy: owner.id });

    const trail = await flips(workspace.id);

    expect(trail).toMatchObject([
      {
        actor_id: admin.id,
        subject_type: "org_policy",
        subject_id: workspace.id,
        detail: { dry_run: true, previous: false, previous_explicit: false },
      },
      {
        actor_id: owner.id,
        detail: { dry_run: false, previous: true, previous_explicit: true },
      },
    ]);
    expect(trail[1].occurred_at.toISOString()).toBe(off.updatedAt);
  });

  it("refuses a body that is not a boolean", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    await api
      .as(owner)("patch", POLICY)
      .set(TENANT_HEADER, workspace.slug)
      .send({ dryRun: "false" })
      .expect(422);
    expect(await stored(workspace.id)).toEqual([]);
  });

  it("turns an unset workspace on at onboarding completion, and leaves an explicit false alone", async () => {
    const owner = await api.signIn();
    const unset = await api.workspace(owner);
    const chose = await api.workspace(owner);
    const policies = api.nest.get(OrgPolicyService);

    await policies.setDryRun(chose.id, owner.id, false);

    await expect(policies.adoptDefault(unset.id)).resolves.toBe(true);
    await expect(policies.adoptDefault(chose.id)).resolves.toBe(false);

    await expect(policies.read(unset.id)).resolves.toMatchObject({ dryRun: true, explicit: true });
    await expect(policies.read(chose.id)).resolves.toMatchObject({ dryRun: false });
  });

  it("reads a workspace whose policy document was published first as unanswered, and onboarding still turns it on", async () => {
    // V092 (#480): the publish creates the org_policies handle with dry_run null.
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const policies = api.nest.get(OrgPolicyService);

    await api.sql.query(`select ${SCHEMA_NAME}.org_policy_publish($1, $2::jsonb, $3)`, [
      workspace.id,
      JSON.stringify(POLICY_V7),
      owner.id,
    ]);

    await expect(policies.dryRunNow(workspace.id)).resolves.toBe(false);
    await expect(policies.read(workspace.id)).resolves.toMatchObject({
      dryRun: false,
      explicit: false,
      updatedAt: null,
      updatedBy: null,
    });

    await expect(policies.adoptDefault(workspace.id)).resolves.toBe(true);
    await expect(policies.read(workspace.id)).resolves.toMatchObject({
      dryRun: true,
      explicit: true,
    });
  });
});

/** Mockup 17's `policy v7` — `schemas/org-policy/fixtures/valid/policy-v7.json`. */
const POLICY_V7 = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: true,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: {
    enabled: true,
    conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
  },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};
