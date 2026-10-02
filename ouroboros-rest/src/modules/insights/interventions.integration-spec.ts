import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InterventionListResource, InterventionResource } from "./interventions.resources";
import { RollupService } from "./rollup/rollup.service";

/**
 * `/api/v1/insights/interventions/{id}/recategorize`, over a socket and against a migrated database
 * (BI.3, [#434](https://github.com/NobuData/ouroboros/issues/434)).
 *
 * The criteria only this scale proves: the events come from the source planes' hooks, not from the
 * service; a member re-categorizes and the audit row is written with the change; a viewer is
 * refused on a direct call; another workspace's event is a `404`; and a human cause survives a
 * rule run and a replay of the run's records. BK.4 (#445) adds the list behind each bar — open to a
 * viewer, scoped to the workspace — and the round trip: a correction to an event on an already
 * rolled-up day moves the page's bars and its computed line at once. The rules' full matrix is
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
  /** The interventions card, as `GET /api/v1/insights` answers it. */
  interface BarCard {
    total: number | null;
    bars: { key: string; value: number }[];
    line: string | null;
  }

  it("lists the card's events to any member, a viewer included, by cause and per workspace", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const other = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");
    const { waiverEvent } = await seed(workspace.id, owner.id);

    const all = bodyOf<InterventionListResource>(
      await api
        .as(viewer)("get", `${INTERVENTIONS}?range=7d`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );

    expect(all).toMatchObject({ range: "7d", cause: null, total: 2 });
    expect(all.interventions.map((event) => event.source).sort()).toEqual([
      "needs_human_run",
      "waiver",
    ]);

    const none = bodyOf<InterventionListResource>(
      await api
        .as(viewer)("get", `${INTERVENTIONS}?cause=infra_rig`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );

    expect(none).toMatchObject({ range: "30d", cause: "infra_rig", total: 0, interventions: [] });

    const elsewhere = bodyOf<InterventionListResource>(
      await api.as(owner)("get", INTERVENTIONS).set(TENANT_HEADER, other.slug).expect(200),
    );

    expect(elsewhere.total).toBe(0);
    expect(all.interventions.map((event) => event.id)).toContain(waiverEvent);

    await api
      .as(viewer)("get", `${INTERVENTIONS}?range=custom`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(422);
  });

  it("moves the page's bars and computed line at once for an event on a rolled-up day", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { waiverEvent } = await seed(workspace.id, owner.id);

    // Both events two days ago, rolled up as the nightly consolidation would leave them.
    await api.sql.query(
      `update ${SCHEMA_NAME}.intervention_events set detected_at = now() - interval '2 days'
        where organization_id = $1`,
      [workspace.id],
    );
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await api.nest.get(RollupService).backfill(workspace.id, "interventions", day, day);

    /** @returns The interventions card, read through the page. */
    const card = async (): Promise<BarCard> =>
      bodyOf<{ hbars: { interventions: BarCard } }>(
        await api
          .as(owner)("get", "/api/v1/insights?range=7d")
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      ).hbars.interventions;

    const before = await card();

    expect(before.bars).toEqual([expect.objectContaining({ key: "other", value: 2 })]);

    await api
      .as(owner)("post", `${INTERVENTIONS}/${waiverEvent}/recategorize`)
      .set(TENANT_HEADER, workspace.slug)
      .send({ cause: "infra_rig", reason: "The bench has no thermal chamber." })
      .expect(200);

    const after = await card();

    expect(after.total).toBe(2);
    expect(after.bars.map((bar) => [bar.key, bar.value]).sort()).toEqual([
      ["infra_rig", 1],
      ["other", 1],
    ]);
    expect(after.line).not.toEqual(before.line);
  });
});
