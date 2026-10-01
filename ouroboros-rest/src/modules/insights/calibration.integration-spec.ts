import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { CALIBRATION_MERGE_OBSERVER, type CalibrationMergeObserver } from "./calibration.observer";
import type { CalibrationReport } from "./calibration.rules";

/**
 * `/api/v1/insights/calibration` and the merge fill, over a socket and against a migrated database
 * (BI.4, [#435](https://github.com/NobuData/ouroboros/issues/435)).
 *
 * The criteria only this scale proves: the fill the PR sync calls grades a merge against the
 * estimate in force at queue time — the fixture's later revision would grade it the other way —
 * a replay leaves one row, an unestimated merge is counted, and the report a viewer reads carries
 * the headline and the effort slice with its bias direction. The join's full matrix is
 * `ouroboros-db/tests/constraints.sql`'s V077 section.
 *
 * ```bash
 * yarn test:integration src/modules/insights
 * ```
 */

const CALIBRATION = "/api/v1/insights/calibration";

describe("estimator calibration", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with two merged loop PRs: #514, estimated `s` 12–18 min at queue time and
   * re-estimated `l` 30–45 min afterwards, merged 14m20s after its loop started; and #516, never
   * estimated.
   *
   * @param organizationId - The workspace.
   * @returns The two PRs' ids.
   */
  async function seed(organizationId: string): Promise<{ estimated: string; unestimated: string }> {
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const {
      rows: [{ id: githubOrg }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'calibration-works', true) returning id`,
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
      rows: [{ id: source }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name)
       values ($1, 'github', 'GitHub') returning id`,
      [organizationId],
    );
    const {
      rows: [{ id: ticket }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, state,
          source_created_at, source_updated_at)
       values ($1, $2, '514', '#514', 'https://github.com/x/y/issues/514', 'CAN-bus flake',
               'open', now(), now())
       returning id`,
      [organizationId, source],
    );

    for (const [version, effort, min, max, minutesAgo] of [
      [1, "s", 12, 18, 180],
      [2, "l", 30, 45, 90],
    ] as const) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.issue_estimates
           (ticket_id, version, effort, confidence, suggested_workflow, routed_model, breakdown,
            risk, risk_note, trace, created_at)
         values ($1, $2, $3, 80, 'standard-fix', 'claude-fable-5',
                 jsonb_build_object('files', '[]'::jsonb, 'est_tokens', 1000, 'cycle_min', $4::int,
                                    'cycle_max', $5::int, 'est_minutes', $5::int),
                 'low', 'Isolated.',
                 jsonb_build_object('estimator', 'heuristic-v0', 'sized_at', $6::text,
                                    'tokens_used', 0, 'signals', '[]'::jsonb),
                 $6::timestamptz)`,
        [ticket, version, effort, min, max, at(minutesAgo)],
      );
    }

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.queue_items
         (organization_id, github_repo_id, issue_number, issue_title, effort, workflow_tag,
          position, enqueued_at)
       values ($1, $2, 514, 'CAN-bus flake', 's', 'standard-fix', 1, $3)`,
      [organizationId, repo, at(120)],
    );

    const pr = async (issue: number, ticketId: string | null): Promise<string> => {
      const {
        rows: [{ id: run }],
      } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runs
           (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
            status, stage_label, stage_index, stage_total, started_at)
         values ($1, $2, $3, 'Loop', 'standard-fix', 'claude-fable-5', 'review', 'Review', 7, 8,
                 $4)
         returning id`,
        [organizationId, repo, issue, at(60)],
      );
      const {
        rows: [{ id }],
      } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.pull_requests
           (organization_id, source_id, external_number, external_url, title, head_branch,
            base_branch, run_id, ticket_id, state, merged_at)
         values ($1, $2, $3::int, 'https://github.com/x/y/pull/' || $3::text, 'Loop PR',
                 'loop/' || $3::text,
                 'main', $4, $5, 'merged', $6::timestamptz + interval '14 minutes 20 seconds')
         returning id`,
        [organizationId, source, issue + 100, run, ticketId, at(60)],
      );

      return id;
    };

    return { estimated: await pr(514, ticket), unestimated: await pr(516, null) };
  }

  it("refuses a stranger", async () => {
    await api.anonymous("get", CALIBRATION).expect(401);
  });

  it("grades a merge at queue time, idempotently, and reports it to a viewer", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");
    const { estimated, unestimated } = await seed(workspace.id);
    const observer = api.nest.get<CalibrationMergeObserver>(CALIBRATION_MERGE_OBSERVER);

    await observer.mergeObserved(workspace.id, estimated);
    await observer.mergeObserved(workspace.id, estimated);
    await observer.mergeObserved(workspace.id, unestimated);

    const { rows } = await api.sql.query<{
      pr_id: string;
      predicted_effort: string | null;
      within_band: boolean | null;
      deviation_ms: string | null;
      actual_duration_ms: string;
    }>(
      `select pr_id, predicted_effort, within_band, deviation_ms, actual_duration_ms
         from ${SCHEMA_NAME}.estimate_outcomes where organization_id = $1 order by predicted_effort`,
      [workspace.id],
    );

    expect(rows).toEqual([
      {
        pr_id: estimated,
        predicted_effort: "s",
        within_band: true,
        deviation_ms: "-40000",
        actual_duration_ms: "860000",
      },
      {
        pr_id: unestimated,
        predicted_effort: null,
        within_band: null,
        deviation_ms: null,
        actual_duration_ms: "860000",
      },
    ]);

    const report = bodyOf<CalibrationReport>(
      await api.as(viewer)("get", CALIBRATION).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(report).toMatchObject({
      window: "30d",
      merged: 2,
      estimated: 1,
      unestimated: 1,
      withinBand: 1,
      withinBandPct: 100,
    });
    expect(report.efforts.find((slice) => slice.effort === "s")).toEqual({
      effort: "s",
      estimated: 1,
      withinBand: 1,
      withinBandPct: 100,
      over: 0,
      under: 0,
      biasPct: -4.4,
      bias: "under",
    });
  });

  it("refuses an unknown window, naming the field", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    const refusal = await api
      .as(owner)("get", `${CALIBRATION}?window=1y`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(422);

    expect(bodyOf<ErrorEnvelope>(refusal)).toMatchObject({ code: "validation_failed" });
  });
});
