import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { NotFoundError } from "../errors/error.envelope";
import { testCaseKey } from "./case-key";
import { NO_RETRIES, parseFlakePolicy } from "./flake-policy";
import { fixtureFile, textFile } from "./test-results.fixture";
import { TestResultIngestService } from "./test-results.service";

/**
 * The result parser against a migrated database (AT.1, [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * The acceptance criteria that only a database can answer: that V051's CHECKs and triggers accept
 * every row the parser writes (`test_case_outcomes_valid`, the derived `case_key`, the rig-is-physical
 * rule, the duration split), that a re-parse is idempotent and keeps ids, that stored totals equal
 * the recompute after every parse, and that V053 composes a measurement's comparative from history.
 *
 * ```bash
 * yarn test:integration
 * ```
 */
describe("the result parser, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** The upload set most cases parse: JUnit from two emitters, a rig's HIL document, coverage. */
  const UPLOAD = ["twister-reruns.xml", "pytest.xml", "ouro-hil-results.json", "cobertura.xml"];

  /**
   * The files of {@link UPLOAD}, with the HIL fixture under its manifest name.
   *
   * @returns The files.
   */
  function upload() {
    return UPLOAD.map((name) =>
      name === "ouro-hil-results.json"
        ? { ...fixtureFile("hil-valid.json"), name }
        : fixtureFile(name),
    );
  }

  /** A case row, as the assertions read it. */
  interface CaseRow {
    id: string;
    suite: string;
    platform: string;
    results_format: string;
    case_key: string;
    classname: string | null;
    name: string;
    status: string;
    retries: number;
    retry_outcomes: string[];
  }

  /**
   * A workspace with a run and two attempts of it.
   *
   * @returns The workspace, the run, both attempts and the service.
   */
  async function sandbox() {
    const owner = await api.signIn();
    const workspace: SeededWorkspace = await workspaceWithRepo(api, owner);
    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
               'claude-fable-5', 'building', 'Build farm', 5, 6, now() - interval '20 minutes')
       returning id`,
      [workspace.id, workspace.repoId],
    );
    const { rows: attempts } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq)
       values ($1, $2, 1), ($1, $2, 2) returning id`,
      [workspace.id, runs[0].id],
    );

    return {
      workspace,
      runId: runs[0].id,
      first: attempts[0].id,
      second: attempts[1].id,
      service: api.nest.get(TestResultIngestService),
    };
  }

  /**
   * An attempt's cases.
   *
   * @param testRunId - The attempt.
   * @returns Every case, ordered by suite, classname and name.
   */
  async function cases(testRunId: string): Promise<CaseRow[]> {
    const { rows } = await api.sql.query<CaseRow>(
      `select c.id, s.name as suite, s.platform, s.results_format, c.case_key, c.classname, c.name,
              c.status, c.retries, c.retry_outcomes
         from ouroboros.test_cases c
         join ouroboros.test_suites s on s.id = c.test_suite_id
        where s.test_run_id = $1
        order by s.name, s.platform, c.classname nulls first, c.name`,
      [testRunId],
    );

    return rows;
  }

  /**
   * An attempt's stored row.
   *
   * @param testRunId - The attempt.
   * @returns Its counts, split and warnings.
   */
  async function attemptRow(testRunId: string) {
    const { rows } = await api.sql.query<{
      total: number;
      passed: number;
      failed: number;
      flaky: number;
      skipped: number;
      wall_ms: string | null;
      sim_ms: string | null;
      physical_ms: string | null;
      parse_warnings: { code: string; file: string }[];
    }>(
      `select total, passed, failed, flaky, skipped, wall_ms, sim_ms, physical_ms, parse_warnings
         from ouroboros.test_runs where id = $1`,
      [testRunId],
    );

    return rows[0];
  }

  /**
   * Every attempt or suite whose stored counts differ from the recompute.
   *
   * @returns V051's drift view, which must be empty.
   */
  async function drift(): Promise<unknown[]> {
    return (
      await api.sql.query<Record<string, unknown>>(
        `select * from ouroboros.test_results_count_drift`,
      )
    ).rows;
  }

  it("writes the upload set as a tree V051 and V053 accept, with totals equal to the recompute", async () => {
    const { workspace, first, service } = await sandbox();
    const report = await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: upload(),
      flakePolicy: parseFlakePolicy("retry-once"),
    });
    const stored = await attemptRow(first);

    expect(report.totals).toEqual({ total: 15, passed: 5, failed: 6, flaky: 2, skipped: 2 });
    expect(stored).toMatchObject(report.totals);
    expect(await drift()).toEqual([]);
    expect(stored).toMatchObject({ wall_ms: "156822", sim_ms: "24822", physical_ms: "132000" });
    expect(stored.parse_warnings.map((w) => w.code)).toEqual(["junit_platform_missing"]);

    const rows = await cases(first);
    const rig = rows.filter((row) => row.platform === "rig:helios-rig-02");

    expect(rig.map((row) => [row.name, row.results_format, row.status])).toEqual([
      ["brownout_recovery", "hil", "passed"],
      ["bus_flood_frame_order", "hil", "passed"],
      ["estop_release_overshoot", "hil", "failed"],
    ]);
    expect(rows.find((row) => row.name === "frame_order_under_isr_load")).toMatchObject({
      status: "flaky",
      retries: 1,
      retry_outcomes: ["failed", "passed"],
    });
    // Past the retry-once budget: the third attempt's pass is not sanctioned, so the last
    // sanctioned attempt — an error — is the status.
    expect(rows.find((row) => row.name === "rx_fifo_high_water")).toMatchObject({
      status: "error",
      retry_outcomes: ["failed", "error"],
    });

    const { rows: measured } = await api.sql.query<{ metric: string; verdict: string }>(
      `select m.metric, m.verdict from ouroboros.hil_measurements m
         join ouroboros.test_cases c on c.id = m.test_case_id
         join ouroboros.test_suites s on s.id = c.test_suite_id
        where s.test_run_id = $1 order by m.metric`,
      [first],
    );

    expect(measured).toEqual([
      { metric: "overshoot_pct", verdict: "fail" },
      { metric: "reboot_ms", verdict: "pass" },
      { metric: "reordered_frames", verdict: "pass" },
      { metric: "retained_frames_pct", verdict: "pass" },
    ]);
    expect(report.coverage).toMatchObject({ percent: 87.4 });
    expect(report.coverage).not.toHaveProperty("delta");
  });

  it("is idempotent: a re-parse keeps every id and count, duplicates nothing and spares classifications", async () => {
    const { workspace, first, service } = await sandbox();
    const input = {
      organizationId: workspace.id,
      testRunId: first,
      files: upload(),
      flakePolicy: parseFlakePolicy("retry-once"),
    };

    await service.parseAttempt(input);
    const before = await cases(first);
    const overshoot = before.find((row) => row.name === "estop_release_overshoot") as CaseRow;

    await api.sql.query(
      `insert into ouroboros.failure_classifications
         (organization_id, test_case_id, class, actor, rule_id)
       values ($1, $2, 'product_bug', 'heuristic', 'hil-limit-exceeded')`,
      [workspace.id, overshoot.id],
    );

    const again = await service.parseAttempt(input);
    const after = await cases(first);

    expect(after).toEqual(before);
    expect(new Set(after.map((row) => row.id)).size).toBe(after.length);
    expect(again.totals).toEqual({ total: 15, passed: 5, failed: 6, flaky: 2, skipped: 2 });
    expect(await drift()).toEqual([]);

    const { rows: classified } = await api.sql.query(
      `select 1 from ouroboros.failure_classifications where test_case_id = $1`,
      [overshoot.id],
    );

    expect(classified).toHaveLength(1);
  });

  it("recounts on every parse, so a stricter policy moves the totals and nothing drifts", async () => {
    const { workspace, first, service } = await sandbox();

    await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: upload(),
      flakePolicy: parseFlakePolicy("retry-twice"),
    });
    expect(await attemptRow(first)).toMatchObject({ flaky: 3, failed: 5 });

    await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: upload(),
      flakePolicy: NO_RETRIES,
    });
    expect(await attemptRow(first)).toMatchObject({ flaky: 0, failed: 8 });
    expect(await drift()).toEqual([]);
  });

  it("computes the case_key the database derives, stable across attempts", async () => {
    const { workspace, first, second, service } = await sandbox();

    for (const testRunId of [first, second]) {
      await service.parseAttempt({ organizationId: workspace.id, testRunId, files: upload() });
    }
    const one = await cases(first);
    const two = await cases(second);

    for (const row of one) {
      expect(row.case_key).toBe(testCaseKey(workspace.repoId, row.suite, row.classname, row.name));
    }
    expect(two.map((row) => row.case_key)).toEqual(one.map((row) => row.case_key));
    const firstIds = new Set(one.map((row) => row.id));

    expect(two.filter((row) => firstIds.has(row.id))).toEqual([]);
  });

  it("composes a measurement's comparative from the earlier attempt", async () => {
    const { workspace, first, second, service } = await sandbox();
    const hil = fixtureFile("hil-valid.json");
    const fixed = textFile(
      "ouro-hil-results.json",
      Buffer.from(hil.bytes).toString("utf8").replace('"value": 2.4', '"value": 1.8'),
    );

    await service.parseAttempt({ organizationId: workspace.id, testRunId: first, files: [hil] });
    await service.parseAttempt({ organizationId: workspace.id, testRunId: second, files: [fixed] });

    const { rows } = await api.sql.query<{ verdict: string; context: string | null }>(
      `select m.verdict, m.context from ouroboros.hil_measurements m
         join ouroboros.test_cases c on c.id = m.test_case_id
         join ouroboros.test_suites s on s.id = c.test_suite_id
        where s.test_run_id = $1 and m.metric = 'overshoot_pct'`,
      [second],
    );

    expect(rows).toEqual([{ verdict: "pass", context: "was 2.4% in build 1" }]);
  });

  it("keeps partial results and stores a typed warning for every malformed input", async () => {
    const { workspace, first, service } = await sandbox();
    const report = await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: [
        fixtureFile("truncated.xml"),
        fixtureFile("hil-invalid.json"),
        fixtureFile("hil-unknown-version.json"),
        fixtureFile("ouro-hil-results-truncated.json"),
        fixtureFile("lcov-empty.info"),
        fixtureFile("notes.txt"),
      ],
    });
    const stored = await attemptRow(first);

    expect(stored.parse_warnings).toEqual(report.warnings);
    expect([...new Set(stored.parse_warnings.map((w) => w.code))].sort()).toEqual([
      "coverage_unreadable",
      "format_unrecognized",
      "hil_json_malformed",
      "hil_measurement_incomplete",
      "hil_schema_invalid",
      "hil_schema_version_unknown",
      "xml_truncated",
    ]);
    // Four cases closed before the cut, and two HIL cases survived validation.
    expect(stored.total).toBe(6);
    expect(await drift()).toEqual([]);
  });

  it("replaces a suite whose results_format changed rather than updating it", async () => {
    const { workspace, first, service } = await sandbox();

    await service.parseAttempt({ organizationId: workspace.id, testRunId: first, files: upload() });
    await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: [fixtureFile("twister-reruns.xml")],
    });

    const rig = (await cases(first)).filter((row) => row.platform === "rig:helios-rig-02");

    expect(rig.map((row) => [row.name, row.results_format])).toEqual([
      ["bus_flood_frame_order", "junit"],
      ["estop_release_overshoot", "junit"],
    ]);
    expect((await attemptRow(first)).total).toBe(10);
    expect(await drift()).toEqual([]);
  });

  it("deletes the cases a re-parse no longer has, down to a suite with none", async () => {
    const { workspace, first, service } = await sandbox();

    await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: [fixtureFile("twister-reruns.xml")],
    });
    const before = await cases(first);

    await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: first,
      files: [fixtureFile("truncated.xml")],
    });
    const after = await cases(first);

    // The truncated report closed the drivers suite and opened telemetry with no case closed.
    expect(after.map((row) => row.id)).toEqual(
      before.filter((row) => row.suite === "unit · drivers").map((row) => row.id),
    );
    expect(await attemptRow(first)).toMatchObject({ total: 4 });
    expect(await drift()).toEqual([]);
  });

  it("computes the coverage delta against the prior attempt's stored counts", async () => {
    const { workspace, first, second, service } = await sandbox();

    await api.sql.query(
      `insert into ouroboros.test_artifacts
         (organization_id, test_run_id, name, kind, size_bytes, storage_ref, checksum,
          retained_until, lines_covered, lines_total)
       values ($1, $2, 'coverage.xml', 'coverage', 2048, '{"driver": "local", "key": "c/1"}',
               'sha256:' || repeat('a', 64), now() + interval '30 days', 868, 1000)`,
      [workspace.id, first],
    );

    const report = await service.parseAttempt({
      organizationId: workspace.id,
      testRunId: second,
      files: [fixtureFile("cobertura.xml")],
    });

    expect(report.coverage).toMatchObject({ percent: 87.4, delta: 0.6, previousAttemptSeq: 1 });
  });

  it("refuses an attempt of another workspace", async () => {
    const { first, service } = await sandbox();
    const other = await workspaceWithRepo(api, await api.signIn(), "other-repo");

    await expect(
      service.parseAttempt({ organizationId: other.id, testRunId: first, files: upload() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
