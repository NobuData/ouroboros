import {
  ApiHarness,
  type Method,
  type Person,
  type Workspace,
} from "../../../testing/harness.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { SCHEMA_NAME } from "../../db/schema";
import {
  analyze,
  BENCH_REPO,
  seedSeededIdsWorkspace,
  suggestionId,
} from "../analyzer.integration.fixture";
import type { PoolWindowChange } from "./bindings";
import type { AppliedSuggestionResource, SuggestionPreviewResource } from "./actions.resources";

/**
 * The suggestion actions against a migrated database, through the HTTP routes (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)).
 *
 *   * each appliable binding kind **round-trips**: the pool window is visible in farm config, the
 *     job hook is registered, the workflow draft carries the citation and nothing is published;
 *   * the preview **writes nothing** and the apply does what it said;
 *   * a test-gate split is refused and writes nothing;
 *   * every apply writes BU.3's measurement row and its audit event;
 *   * a dismissal **survives re-analysis**;
 *   * the role gates hold.
 *
 * ```bash
 * yarn test:integration src/modules/analyzer/actions
 * ```
 */

/** Yesterday, UTC — inside every apply's baseline window. */
function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

describe("the suggestion actions", () => {
  let api: ApiHarness;
  let owner: Person;
  let member: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
    member = await api.signIn();
    await api.join(workspace.id, member, "member");

    await seedSeededIdsWorkspace(api, workspace);
    // The baselines: yesterday's queue waits in pool-a and build durations, in milliseconds.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.metric_daily
         (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, meta)
       values ($1, $2, 'queue_wait', false, 'pool-a', $3::date, 420000,
               '{"samples": [300000, 420000, 600000]}'),
              ($1, $2, 'build_duration', false, 'zephyr build', $3::date, 252000,
               '{"samples": [238000, 252000, 260500]}')`,
      [workspace.id, BENCH_REPO, yesterday()],
    );
  });

  afterEach(() => api.truncate());

  /**
   * A request as a person, in the workspace.
   *
   * @param person - Who.
   * @param method - The verb.
   * @param path - The route.
   * @returns The request.
   */
  function call(person: Person, method: Method, path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** How many rows a table has for the workspace. */
  async function count(table: string, column = "organization_id"): Promise<number> {
    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*)::text as n from ${SCHEMA_NAME}.${table} where ${column} = $1`,
      [workspace.id],
    );
    return Number(rows[0].n);
  }

  it("previews a pool move without writing, then applies exactly that through the farm", async () => {
    await analyze(api, workspace);
    const id = await suggestionId(api, workspace, "Move forge-02");

    const preview = (
      await call(owner, "get", `/api/v1/analyzer/suggestions/${id}/preview`).expect(200)
    ).body as SuggestionPreviewResource;
    const change = preview.change as PoolWindowChange;
    expect(preview).toMatchObject({ appliable: true, lands: "Build farm · pool windows" });
    expect(preview.summary).toContain("forge-02 joins pool-a between");
    expect(await count("runner_pool_windows")).toBe(0);
    expect(await count("audit_events")).toBe(0);

    const applied = await call(owner, "post", `/api/v1/analyzer/suggestions/${id}/apply`)
      .send({ fingerprint: preview.fingerprint })
      .expect(200);

    const windows = await call(member, "get", "/api/v1/farm/pool-windows").expect(200);
    expect(windows.body).toEqual([
      expect.objectContaining({
        runner: expect.objectContaining({ name: "forge-02" }) as unknown,
        pool: expect.objectContaining({ name: "pool-a" }) as unknown,
        daysOfWeek: change.daysOfWeek,
        startsAt: change.startsAt,
        endsAt: change.endsAt,
      }),
    ]);
    expect((applied.body as AppliedSuggestionResource).measurement).toMatchObject({
      targetMetric: "queue_wait",
      windowDays: 14,
      baseline: { statistic: "p95", dimension: "pool-a" },
    });

    const { rows } = await api.sql.query<{ status: string; reversal: { action: string } }>(
      `select s.status, a.reversal
         from ${SCHEMA_NAME}.analysis_suggestions s
         join ${SCHEMA_NAME}.analysis_suggestion_applications a on a.suggestion_id = s.id
        where s.id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        status: "applied",
        reversal: expect.objectContaining({ action: "farm.pool_window.delete" }) as unknown,
      },
    ]);
    const events = await api.sql.query<{ action: string; actor_id: string }>(
      `select action, actor_id from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 order by occurred_at, action`,
      [workspace.id],
    );
    expect(events.rows.map((row) => row.action).sort()).toEqual([
      "analysis_suggestion.applied",
      "runner.pool_window_added",
    ]);
    expect(events.rows.every((row) => row.actor_id === owner.id)).toBe(true);

    // Applied is final.
    await call(owner, "post", `/api/v1/analyzer/suggestions/${id}/apply`).send({}).expect(409);
  });

  it("drafts a workflow change citing the suggestion, and publishes nothing", async () => {
    await analyze(api, workspace);
    const id = await suggestionId(api, workspace, "standard-fix: run");

    const applied = await call(owner, "post", `/api/v1/analyzer/suggestions/${id}/apply`)
      .send({})
      .expect(200);

    expect((applied.body as AppliedSuggestionResource).target).toMatchObject({
      kind: "workflow_draft",
      studioPath: "/workflows/standard-fix",
    });
    const { rows } = await api.sql.query<{ change_note: string; published: string; current: null }>(
      `select d.change_note,
              (select count(*) from ${SCHEMA_NAME}.workflow_versions v
                where v.workflow_id = w.id and v.version is not null)::text as published,
              w.current_version as current
         from ${SCHEMA_NAME}.workflows w
         join ${SCHEMA_NAME}.workflow_versions d on d.workflow_id = w.id and d.version is null
        where w.organization_id = $1 and w.slug = 'standard-fix'`,
      [workspace.id],
    );
    expect(rows).toEqual([
      {
        change_note: expect.stringContaining(
          `Proposed by the Build Analyzer (suggestion ${id})`,
        ) as unknown,
        published: "0",
        current: null,
      },
    ]);
  });

  it("registers the cache re-warm as a farm job hook", async () => {
    await analyze(api, workspace);
    const id = await suggestionId(api, workspace, "Re-warm ccache");

    await call(owner, "post", `/api/v1/analyzer/suggestions/${id}/apply`).send({}).expect(200);

    const hooks = await call(member, "get", "/api/v1/farm/job-hooks").expect(200);
    expect(hooks.body).toEqual([
      expect.objectContaining({
        repo: BENCH_REPO,
        pool: expect.objectContaining({ name: "pool-a" }) as unknown,
        event: "merge",
        command: ["west", "build", "-t", "ccache-warm"],
      }),
    ]);
  });

  it("refuses the test-gate split, which no plane owns, and writes nothing", async () => {
    await analyze(api, workspace);
    const id = await suggestionId(api, workspace, "Split the test gate");

    const refused = await call(owner, "post", `/api/v1/analyzer/suggestions/${id}/apply`)
      .send({})
      .expect(422);

    expect((refused.body as { code: string }).code).toBe("analysis_plane_unavailable");
    expect(await count("audit_events")).toBe(0);
    expect(await count("suggestion_measurements")).toBe(0);
  });

  it("keeps a dismissal through re-analysis, and lets a member dismiss but not apply", async () => {
    await analyze(api, workspace);
    const id = await suggestionId(api, workspace, "Move forge-02");

    await call(member, "post", `/api/v1/analyzer/suggestions/${id}/apply`).send({}).expect(403);
    await call(member, "post", `/api/v1/analyzer/suggestions/${id}/dismiss`)
      .send({ reason: "forge-02 is reserved for HIL" })
      .expect(200);

    await analyze(api, workspace);

    const { rows } = await api.sql.query<{ status: string; resolution_reason: string }>(
      `select status, resolution_reason from ${SCHEMA_NAME}.analysis_suggestions where id = $1`,
      [id],
    );
    expect(rows).toEqual([
      { status: "dismissed", resolution_reason: "forge-02 is reserved for HIL" },
    ]);
  });
});
