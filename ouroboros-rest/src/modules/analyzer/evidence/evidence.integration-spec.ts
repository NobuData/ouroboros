import { ApiHarness, type Person } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import { EvidenceRepository, type EvidenceIds } from "./evidence.repository";
import { evidenceResource } from "./evidence.resources";

/**
 * Evidence resolution against a migrated database (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — the three kinds the suggestion
 * cards' Details sheet added to the resolver: a test run, a test case and a verification waiver.
 * (Builds, merges, workflow versions, pools and runners are `duration.integration-spec.ts`'s.)
 *
 * What only real rows can prove: a test case resolves to the loop, the attempt and the suite it
 * ran in; a waiver opens on the pull request its loop opened once the mirror has one, and on that
 * loop's test results until then; and **none of it resolves from another workspace**, whose ids
 * are as good as unknown.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/analyzer/evidence
 * ```
 */

/** The simulator's key — what lets the suite open a loop through the ingestion contract. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** No references of any kind. */
const NONE: EvidenceIds = {
  builds: [],
  merges: [],
  workflowVersions: [],
  runnerPools: [],
  runners: [],
  testRuns: [],
  testCases: [],
  waivers: [],
};

describe("evidence resolution — test runs, test cases and waivers", () => {
  let api: ApiHarness;
  let owner: Person;
  let bench: IngestBench;
  let runId: string;
  let testRunId: string;
  let testCaseId: string;
  let waiverId: string;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    });
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signUp();
    bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
        .send({ idempotencyKey: "open-1", ...bench.open })
        .expect(201),
    );
    runId = run.id;

    testRunId = await one(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, commit_sha, status)
       values ($1, $2, 3, 'f42b9a0', 'complete') returning id`,
      [bench.workspace.id, runId],
    );
    const suite = await one(
      `insert into ${SCHEMA_NAME}.test_suites (organization_id, test_run_id, name, platform, kind, meta)
       values ($1, $2, 'telemetry integration', 'qemu_cortex_m3', 'sim', '{}') returning id`,
      [bench.workspace.id, testRunId],
    );
    testCaseId = await one(
      `insert into ${SCHEMA_NAME}.test_cases
         (organization_id, test_suite_id, name, classname, status, retries, retry_outcomes, failure)
       values ($1, $2, 'ring buffer drains under burst', 'telemetry', 'failed', 0,
               '["failed"]'::jsonb, '{"message": "timeout"}'::jsonb)
       returning id`,
      [bench.workspace.id, suite],
    );
    waiverId = await one(
      `insert into ${SCHEMA_NAME}.pr_waivers (organization_id, run_id, author, reason)
       values ($1, $2, $3, $4) returning id`,
      [bench.workspace.id, runId, owner.id, "No thermal chamber on helios-rig-02 — bench waived"],
    );
  });

  afterEach(() => api.truncate());

  /** The one id a statement returns. */
  async function one(text: string, values: unknown[]): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(text, values);

    return rows[0].id;
  }

  /** Resolve references in a workspace. */
  function resolve(organizationId: string, ids: Partial<EvidenceIds>) {
    return api.nest.get(EvidenceRepository).resolve(organizationId, { ...NONE, ...ids });
  }

  it("resolves a test run to its loop and attempt, and a case to its suite within it", async () => {
    const resolved = await resolve(bench.workspace.id, {
      testRuns: [testRunId],
      testCases: [testCaseId],
    });

    expect(resolved.testRuns).toEqual([{ id: testRunId, run_id: runId, attempt_seq: 3 }]);
    expect(resolved.testCases).toEqual([
      {
        id: testCaseId,
        run_id: runId,
        attempt_seq: 3,
        suite: "telemetry integration",
        name: "ring buffer drains under burst",
      },
    ]);
    expect(evidenceResource({ kind: "test_case", id: testCaseId }, resolved)).toMatchObject({
      label: "ring buffer drains under burst",
      surface: "test_results",
      runId,
      attempt: 3,
      suiteName: "telemetry integration",
      caseName: "ring buffer drains under burst",
    });
  });

  it("opens a waiver on its loop's test results until the mirror has that loop's PR, then on the PR", async () => {
    const before = await resolve(bench.workspace.id, { waivers: [waiverId] });

    expect(before.waivers).toEqual([
      {
        id: waiverId,
        run_id: runId,
        reason: "No thermal chamber on helios-rig-02 — bench waived",
        pull_request_id: null,
      },
    ]);
    expect(evidenceResource({ kind: "waiver", id: waiverId }, before)).toMatchObject({
      surface: "test_results",
      runId,
      pullRequestId: null,
    });

    const pullRequestId = await one(
      `insert into ${SCHEMA_NAME}.pull_requests
         (organization_id, source_id, external_number, external_url, title, head_branch,
          base_branch, run_id)
       values ($1, $2, 514, 'https://github.example/acme/helios/pull/514', 'Fix the CAN flake',
               'loop/482-canbus-flake', 'main', $3)
       returning id`,
      [bench.workspace.id, bench.source, runId],
    );
    const after = await resolve(bench.workspace.id, { waivers: [waiverId] });

    expect(evidenceResource({ kind: "waiver", id: waiverId }, after)).toMatchObject({
      label: "No thermal chamber on helios-rig-02 — bench waived",
      surface: "pull_request",
      pullRequestId,
      runId: null,
    });
  });

  it("resolves none of it from another workspace", async () => {
    const stranger = await api.signUp();
    const theirs = await api.workspace(stranger);

    const resolved = await resolve(theirs.id, {
      testRuns: [testRunId],
      testCases: [testCaseId],
      waivers: [waiverId],
    });

    expect(resolved).toMatchObject({ testRuns: [], testCases: [], waivers: [] });
    expect(evidenceResource({ kind: "waiver", id: waiverId }, resolved)).toMatchObject({
      label: null,
      surface: null,
    });
  });

  it("answers nothing for a row that is gone, rather than failing the read", async () => {
    const gone = "5eed0000-0000-4000-8000-00000000dead";

    const resolved = await resolve(bench.workspace.id, {
      testRuns: [gone],
      testCases: [gone],
      waivers: [gone],
    });

    expect(resolved).toMatchObject({ testRuns: [], testCases: [], waivers: [] });
  });
});
