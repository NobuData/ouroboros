import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InterventionResource } from "./interventions.resources";

/**
 * `/api/v1/insights/interventions/{id}/recategorize`, over a socket and against a migrated database
 * (BI.3, [#434](https://github.com/NobuData/ouroboros/issues/434)).
 *
 * The criteria only this scale proves: the events come from the source planes' hooks, not from the
 * service; a member re-categorizes and the audit row is written with the change; a viewer is
 * refused on a direct call; another workspace's event is a `404`; and a human cause survives a
 * rule run and a replay of the run's records. The rules' full matrix is
 * `ouroboros-db/tests/constraints.sql`'s V079 section.
 *
 * ```bash
 * yarn test:integration src/modules/insights
 * ```
 */

const INTERVENTIONS = "/api/v1/insights/interventions";

describe("intervention re-categorization", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A loop that handed off with a waiver on it — two events, both `other` by the rules.
   *
   * @param organizationId - The workspace.
   * @param authorId - Who waived.
   * @returns The run and the waiver's event.
   */
  async function seed(
    organizationId: string,
    authorId: string,
  ): Promise<{ run: string; waiverEvent: string }> {
    const {
      rows: [{ id: githubOrg }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'intervention-works', true) returning id`,
      [organizationId],
    );
    const {
      rows: [{ id: repo }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled, default_branch)
       values ($1, 'helios-firmware', true, 'main') returning id`,
      [githubOrg],
    );
    const {
      rows: [{ id: run }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs
         (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
          status, stage_label, stage_index, stage_total, started_at, finished_at)
       values ($1, $2, 482, 'Loop', 'standard-fix', 'claude-fable-5', 'needs_human', 'Test', 5, 8,
               now() - interval '1 hour', now() - interval '10 minutes')
       returning id`,
      [organizationId, repo],
    );
    const {
      rows: [{ id: waiver }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pr_waivers (organization_id, run_id, author, reason)
       values ($1, $2, $3, 'rig runs at 22°C only') returning id`,
      [organizationId, run, authorId],
    );
    const {
      rows: [{ id: waiverEvent }],
    } = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.intervention_events where source = 'waiver' and source_ref = $1`,
      [waiver],
    );

    return { run, waiverEvent };
  }

  it("refuses a stranger", async () => {
    await api
      .anonymous("post", `${INTERVENTIONS}/a7920000-0000-4000-8000-000000000001/recategorize`)
      .expect(401);
  });

  it("lets a member re-categorize, audited, and keeps the cause through a rule run and a replay", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const member = await api.signIn();
    await api.join(workspace.id, member, "member");
    const { run, waiverEvent } = await seed(workspace.id, owner.id);

    const { rows: before } = await api.sql.query<{ source: string; cause: string }>(
      `select source, cause from ${SCHEMA_NAME}.intervention_events
        where organization_id = $1 order by source`,
      [workspace.id],
    );

    expect(before).toEqual([
      { source: "needs_human_run", cause: "other" },
      { source: "waiver", cause: "other" },
    ]);

    const resource = bodyOf<InterventionResource>(
      await api
        .as(member)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ cause: "infra_rig", reason: "The bench has no thermal chamber." })
        .expect(200),
    );

    expect(resource).toMatchObject({
      id: waiverEvent,
      runId: run,
      source: "waiver",
      cause: "infra_rig",
      causeOrigin: "human",
      ruleId: null,
      override: {
        actorId: member.id,
        fromCause: "other",
        toCause: "infra_rig",
        reason: "The bench has no thermal chamber.",
      },
    });

    await api.sql.query(`select ${SCHEMA_NAME}.apply_intervention_rules($1)`, [workspace.id]);
    await api.sql.query(`select ${SCHEMA_NAME}.sync_intervention_events($1)`, [run]);

    const { rows: after } = await api.sql.query<{ cause: string; cause_origin: string }>(
      `select cause, cause_origin from ${SCHEMA_NAME}.intervention_events where id = $1`,
      [waiverEvent],
    );
    const { rows: overrides } = await api.sql.query<{ actor_id: string }>(
      `select actor_id from ${SCHEMA_NAME}.intervention_overrides where event_id = $1`,
      [waiverEvent],
    );

    expect(after).toEqual([{ cause: "infra_rig", cause_origin: "human" }]);
    expect(overrides).toEqual([{ actor_id: member.id }]);
  });

  it("refuses a viewer on a direct call, and writes nothing", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");
    const { waiverEvent } = await seed(workspace.id, owner.id);

    await api
      .as(viewer)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
      .set(TENANT_HEADER, workspace.slug)
      .send({ cause: "infra_rig", reason: "Trying." })
      .expect(403);

    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*) as n from ${SCHEMA_NAME}.intervention_overrides where event_id = $1`,
      [waiverEvent],
    );

    expect(rows).toEqual([{ n: "0" }]);
  });

  it("answers 404 for another workspace's event and 409 for an unchanged cause", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const other = await api.workspace(owner);
    const { waiverEvent } = await seed(workspace.id, owner.id);

    const missing = await api
      .as(owner)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
      .set(TENANT_HEADER, other.slug)
      .send({ cause: "infra_rig", reason: "Not mine." })
      .expect(404);

    expect(bodyOf<ErrorEnvelope>(missing)).toMatchObject({ code: "intervention_not_found" });

    const unchanged = await api
      .as(owner)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
      .set(TENANT_HEADER, workspace.slug)
      .send({ cause: "other", reason: "Same again." })
      .expect(409);

    expect(bodyOf<ErrorEnvelope>(unchanged)).toMatchObject({
      code: "intervention_cause_unchanged",
    });
  });

  it("refuses an unknown cause and a blank reason, naming the fields", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { waiverEvent } = await seed(workspace.id, owner.id);

    const refusal = await api
      .as(owner)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
      .set(TENANT_HEADER, workspace.slug)
      .send({ cause: "flaky", reason: "  " })
      .expect(422);

    expect(bodyOf<ErrorEnvelope>(refusal)).toMatchObject({ code: "validation_failed" });
  });
});
