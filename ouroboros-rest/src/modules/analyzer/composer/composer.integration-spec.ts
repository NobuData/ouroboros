import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import type { EngineFinding } from "../../engine/engine.analysis";
import { pendingProgress } from "../analysis.progress";
import { AnalysisRepository } from "../analysis.repository";
import { FORGE_02_ID, POOL_A_ID, SEEDED_FINDINGS } from "./composer.seed.fixture";
import { SuggestionComposer } from "./composer.service";

/**
 * The suggestion composer against a migrated database (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * What only `record_analysis_suggestion()` (V081, V087) and real rows can prove:
 *
 *   * the seeded findings compose and **record** the mockup's ten suggestions, each with its
 *     confidence basis and a link to every finding it cites;
 *   * **re-analysis updates rather than duplicates** — a second run over the same findings lands
 *     on the same rows — and **a dismissed suggestion stays dismissed**, as it was composed.
 *
 * ```bash
 * yarn test:integration src/modules/analyzer/composer
 * ```
 */

const REPO = "acme-robotics/helios-firmware";

/**
 * The seeded findings this suite can store with a runner pool as their evidence: a waiver cite
 * must cite as many `pr_waivers` as it counts (V081), which needs a loop plane this suite does
 * not build — the unit suite composes BA-3 from the mirror instead.
 */
const PERSISTABLE = SEEDED_FINDINGS.filter((finding) => finding.analyzer !== "waiver_cite");

/** Every analyzer the seeded findings came from, at v1. */
const ANALYZER_SET = {
  label: "deterministic analyzers v1",
  analyzers: [
    "cache_window",
    "config_usage",
    "log_signature",
    "queue_correlation",
    "waiver_cite",
    "workflow_outcome",
  ].map((id) => ({ id, version: 1, kind: "deterministic" as const })),
};

describe("the suggestion composer", () => {
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
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runner_pools (id, organization_id, name, executor)
       values ($2, $1, 'pool-a', 'shell')`,
      [workspace.id, POOL_A_ID],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runners
         (id, organization_id, pool_id, name, arch, status, desired_state, security_mode,
          cert_serial, capabilities)
       values ($3, $1, $2, 'forge-02', 'linux/arm64', 'offline', 'active', 'mtls', '4a7333a2',
               '{"executors": ["shell"]}'::jsonb)`,
      [workspace.id, POOL_A_ID, FORGE_02_ID],
    );
  });

  afterEach(() => api.truncate());

  /** Start a run, write the seeded findings into it, and return it. */
  async function runWithFindings() {
    const runs = api.nest.get(AnalysisRepository);
    const inserted = await runs.insertRun({
      organizationId: workspace.id,
      repoRef: REPO,
      trigger: "manual",
      scheduleId: null,
      analyzerSet: ANALYZER_SET,
      progress: pendingProgress(ANALYZER_SET),
    });
    if (!inserted.started) throw new Error("the run did not start");
    const run = inserted.run;
    const evidence = [{ kind: "runner_pool", id: POOL_A_ID }];

    for (const analyzer of ANALYZER_SET.analyzers) {
      const findings: EngineFinding[] = PERSISTABLE.filter(
        (finding) => finding.analyzer === analyzer.id,
      ).map((finding) => ({
        analyzer: finding.analyzer,
        analyzer_version: 1,
        finding_type: finding.findingType,
        subject_key: finding.subjectKey,
        data:
          finding.findingType === "log_signature"
            ? { ...finding.data, sample_refs: evidence }
            : { ...finding.data },
        evidence_refs: evidence,
        confidence: finding.confidence,
        confidence_basis: { ...finding.confidenceBasis },
      }));
      await runs.writeFindings(run, findings);
    }

    return run;
  }

  /** End a run, so the next one may start — how it ended does not matter to composition. */
  async function end(id: string): Promise<void> {
    await api.nest.get(AnalysisRepository).finish(id, {
      status: "failed",
      phase: "composing",
      manifest: null,
      progress: null,
      computeSeconds: 1,
      confidenceNote: null,
      failureReason: "ended by the suite so the next run may start",
    });
  }

  const WINDOW = { from: "2026-05-10", to: "2026-08-07", days: 90 };

  it("records the mockup's suggestions, each with its confidence basis and every citation", async () => {
    const run = await runWithFindings();

    const result = await api.nest.get(SuggestionComposer).compose(run, WINDOW);

    expect(result.failed).toEqual([]);
    expect(result.recorded).toHaveLength(9);
    const { rows } = await api.sql.query<{
      title: string;
      confidence: number;
      value: number;
      estimate: string | null;
      cited: string;
    }>(
      `select s.title, s.confidence, (s.confidence_basis ->> 'value')::int as value,
              s.impact ->> 'estimate' as estimate,
              (select count(*) from ${SCHEMA_NAME}.analysis_suggestion_findings l
                where l.suggestion_id = s.id)::text as cited
         from ${SCHEMA_NAME}.analysis_suggestions s
        where s.organization_id = $1 order by s.title`,
      [workspace.id],
    );
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.value === row.confidence)).toBe(true);
    const gate = rows.find((row) => row.title.startsWith("Split the test gate"));
    // Uncalibrated (no BU.3 history in this workspace): the raw −206 s.
    expect(gate).toMatchObject({ confidence: 91, estimate: "-206", cited: "2" });
    expect(rows.find((row) => row.title.startsWith("Delete 12 dead"))?.cited).toBe("12");
  });

  it("updates on re-analysis — no duplicates — and keeps a dismissal as it was composed", async () => {
    const first = await runWithFindings();
    await api.nest.get(SuggestionComposer).compose(first, WINDOW);
    await api.sql.query(
      `update ${SCHEMA_NAME}.analysis_suggestions
          set status = 'dismissed', resolved_by = $2, resolved_at = now(),
              resolution_reason = 'forge-02 is reserved for HIL'
        where organization_id = $1 and title like 'Move forge-02%'`,
      [workspace.id, owner.id],
    );
    await end(first.id);

    const second = await runWithFindings();
    const result = await api.nest.get(SuggestionComposer).compose(second, {
      ...WINDOW,
      days: 120,
    });

    expect(result.failed).toEqual([]);
    const { rows } = await api.sql.query<{ title: string; status: string; last_run_id: string }>(
      `select title, status, last_run_id from ${SCHEMA_NAME}.analysis_suggestions
        where organization_id = $1`,
      [workspace.id],
    );
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.last_run_id === second.id)).toBe(true);
    expect(rows.find((row) => row.title.startsWith("Move forge-02"))?.status).toBe("dismissed");
  });
});
