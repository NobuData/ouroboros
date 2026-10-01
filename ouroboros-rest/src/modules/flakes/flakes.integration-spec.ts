import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { NO_RETRIES, parseFlakePolicy, type FlakePolicy } from "../test-results/flake-policy";
import { textFile } from "../test-results/test-results.fixture";
import { TestResultIngestService } from "../test-results/test-results.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { FlakeScorerService } from "./flake-scorer.service";
import { FlakeStateService } from "./flake-state.service";

/**
 * The flake scorer against a migrated database (AT.3, [#331](https://github.com/NobuData/ouroboros/issues/331)).
 *
 * What only a database can answer: that the parse-time hook writes exactly the occurrences V054
 * derives, that V054's formula scores a history reproducibly and lands mockup 11's telemetry case
 * `watching`, that the nightly pass walks a case that stopped flaking back to `healthy` within its
 * cap and records its bookkeeping, that a new formula is stamped on re-score, that nothing writes
 * `quarantined`, and that the state API reads it all back per workspace.
 *
 * ```bash
 * yarn test:integration -t "flake scorer"
 * ```
 */
describe("the flake scorer, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  const SUITE = "telemetry integration";
  const CLASSNAME = "telemetry";
  const CASE = "ring buffer drains under burst";

  /** One attempt's outcome for the telemetry case, as its report writes it. */
  type Outcome = "passed" | "failed" | "flaky" | "flaky-twice";

  /**
   * A JUnit report with the telemetry case and a steady neighbour.
   *
   * @param outcome - The telemetry case's attempts: a pass, a failure, a pass after one failure,
   *   or a pass after two.
   * @returns The report's text.
   */
  function report(outcome: Outcome): string {
    const body = {
      passed: "",
      failed: '<failure message="frame dropped under burst"/>',
      flaky: '<flakyFailure message="frame dropped under burst"/>',
      "flaky-twice":
        '<flakyFailure message="frame dropped under burst"/>' +
        '<flakyFailure message="frame dropped under burst"/>',
    }[outcome];

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${SUITE}" tests="2">` +
      `<testcase classname="${CLASSNAME}" name="${CASE}" time="0.5">${body}</testcase>` +
      `<testcase classname="${CLASSNAME}" name="frame counter is monotonic" time="0.1"/>` +
      `</testsuite></testsuites>`
    );
  }

  /** A workspace, its owner, and a helper to add attempts. */
  interface Bench {
    owner: Person;
    workspace: SeededWorkspace;
    ingest: TestResultIngestService;
    scorer: FlakeScorerService;
  }

  /**
   * A workspace with a repository.
   *
   * @returns The bench.
   */
  async function bench(): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);

    return {
      owner,
      workspace,
      ingest: api.nest.get(TestResultIngestService),
      scorer: api.nest.get(FlakeScorerService),
    };
  }

  /**
   * A run of the workspace's repository.
   *
   * @param at - The bench.
   * @param issue - Its issue number.
   * @returns Its id.
   */
  async function run(at: Bench, issue: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at)
       values ($1, $2, $3, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
               'claude-fable-5', 'building', 'Build farm', 5, 6, now() - interval '1 day')
       returning id`,
      [at.workspace.id, at.workspace.repoId, issue],
    );

    return rows[0].id;
  }

  /**
   * An attempt that ran `minutesAgo` minutes ago — its occurrences' `observed_at`.
   *
   * @param at - The bench.
   * @param runId - The run.
   * @param seq - Its attempt number.
   * @param minutesAgo - When it started.
   * @returns Its id.
   */
  async function attempt(at: Bench, runId: string, seq: number, minutesAgo: number) {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq, started_at)
       values ($1, $2, $3, now() - $4::numeric * interval '1 minute') returning id`,
      [at.workspace.id, runId, seq, minutesAgo],
    );

    return rows[0].id;
  }

  /**
   * Parse the telemetry report into an attempt.
   *
   * @param at - The bench.
   * @param testRunId - The attempt.
   * @param outcome - The telemetry case's attempts.
   * @param policy - The pinned `flakes:` policy.
   * @returns The parse report.
   */
  function parse(at: Bench, testRunId: string, outcome: Outcome, policy: FlakePolicy) {
    return at.ingest.parseAttempt({
      organizationId: at.workspace.id,
      testRunId,
      files: [textFile("junit.xml", report(outcome))],
      flakePolicy: policy,
    });
  }

  /**
   * The telemetry case's durable key in the bench's workspace.
   *
   * @param at - The bench.
   * @returns It.
   */
  async function telemetryKey(at: Bench): Promise<string> {
    const { rows } = await api.sql.query<{ case_key: string }>(
      `select distinct case_key from ouroboros.test_cases
        where organization_id = $1 and name = $2`,
      [at.workspace.id, CASE],
    );

    expect(rows).toHaveLength(1);
    return rows[0].case_key;
  }

  /**
   * A case's score row.
   *
   * @param at - The bench.
   * @param caseKey - The key.
   * @returns It, or undefined.
   */
  async function scoreRow(at: Bench, caseKey: string) {
    const { rows } = await api.sql.query<{
      score: string;
      window_runs: number;
      state: string;
      formula_version: number;
      state_changed_at: Date;
    }>(
      `select score::text, window_runs, state, formula_version, state_changed_at
         from ouroboros.flake_scores where organization_id = $1 and case_key = $2`,
      [at.workspace.id, caseKey],
    );

    return rows[0];
  }

  /**
   * Mockup 11's telemetry history, parsed the way builds arrive: `#479` passed on retry, then
   * `#482`'s Build 1 and Build 2 failed and Build 3 passed on its second retry — the seed's story
   * (#328), under the pinned `retry-twice` policy.
   *
   * @param at - The bench.
   * @returns The case key and each parse's flake tally, oldest first.
   */
  async function telemetryHistory(at: Bench) {
    const policy = parseFlakePolicy("retry-twice");
    const earlier = await run(at, 479);
    const loop = await run(at, 482);
    const tallies = [];

    tallies.push((await parse(at, await attempt(at, earlier, 1, 300), "flaky", policy)).flakes);
    tallies.push((await parse(at, await attempt(at, loop, 1, 40), "failed", policy)).flakes);
    tallies.push((await parse(at, await attempt(at, loop, 2, 25), "failed", policy)).flakes);
    tallies.push((await parse(at, await attempt(at, loop, 3, 10), "flaky-twice", policy)).flakes);

    return { caseKey: await telemetryKey(at), tallies, loop };
  }

  /**
   * Write clean passing occurrences of the telemetry case directly — builds the nightly pass
   * sees without the parse having re-scored them.
   *
   * @param at - The bench.
   * @param count - How many attempts.
   * @returns When they are written.
   */
  async function cleanBuildsWithoutScoring(at: Bench, count: number): Promise<void> {
    const runId = await run(at, 490);

    for (let seq = 1; seq <= count; seq += 1) {
      const testRunId = await attempt(at, runId, seq, 5 - seq / (count + 1));
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ouroboros.test_suites (organization_id, test_run_id, name, platform, kind)
         values ($1, $2, $3, 'unknown', 'sim') returning id`,
        [at.workspace.id, testRunId, SUITE],
      );

      await api.sql.query(
        `with c as (
           insert into ouroboros.test_cases
               (organization_id, test_suite_id, name, classname, status, retries, retry_outcomes)
           values ($1, $2, $3, $4, 'passed', 0, '["passed"]') returning organization_id, id)
         insert into ouroboros.test_case_history (organization_id, test_case_id)
         select organization_id, id from c`,
        [at.workspace.id, rows[0].id, CASE, CLASSNAME],
      );
    }
  }

  it("writes one occurrence per case, flagged only for a sanctioned pass on retry", async () => {
    const at = await bench();
    const runId = await run(at, 482);
    const sanctioned = await attempt(at, runId, 1, 30);
    const unsanctioned = await attempt(at, runId, 2, 20);

    await parse(at, sanctioned, "flaky", parseFlakePolicy("retry-once"));
    await parse(at, unsanctioned, "flaky", NO_RETRIES);

    const { rows } = await api.sql.query<{ test_run_id: string; pass_on_retry: boolean }>(
      `select h.test_run_id, h.pass_on_retry
         from ouroboros.test_case_history h
         join ouroboros.test_cases c on c.id = h.test_case_id
        where h.organization_id = $1 and c.name = $2
        order by h.observed_at`,
      [at.workspace.id, CASE],
    );

    expect(rows).toEqual([
      { test_run_id: sanctioned, pass_on_retry: true },
      { test_run_id: unsanctioned, pass_on_retry: false },
    ]);

    const { rows: counts } = await api.sql.query<{ occurrences: string; flagged: string }>(
      `select count(*) as occurrences, count(*) filter (where pass_on_retry) as flagged
         from ouroboros.test_case_history where organization_id = $1`,
      [at.workspace.id],
    );

    // Two cases in each of two attempts; one sanctioned pass on retry among them.
    expect(counts[0]).toEqual({ occurrences: "4", flagged: "1" });
  });

  it("rewrites an occurrence with its re-parsed case — one row, no drift", async () => {
    const at = await bench();
    const testRunId = await attempt(at, await run(at, 482), 1, 30);

    await parse(at, testRunId, "flaky", parseFlakePolicy("retry-once"));
    await parse(at, testRunId, "flaky", parseFlakePolicy("retry-once"));
    await parse(at, testRunId, "flaky", NO_RETRIES);

    const { rows } = await api.sql.query<{ status: string; pass_on_retry: boolean }>(
      `select h.status, h.pass_on_retry from ouroboros.test_case_history h
         join ouroboros.test_cases c on c.id = h.test_case_id
        where h.test_run_id = $1 and c.name = $2`,
      [testRunId, CASE],
    );
    const { rows: drift } = await api.sql.query(`select * from ouroboros.test_case_history_drift`);

    expect(rows).toEqual([{ status: "failed", pass_on_retry: false }]);
    expect(drift).toEqual([]);
  });

  it("lands mockup 11's telemetry case watching through formula 1, reproducibly", async () => {
    const at = await bench();
    const { caseKey, tallies } = await telemetryHistory(at);

    // Healthy until three observations; `F · · F` newest first is (1 + 0.9³) / Σ 0.9ⁱ = 0.5028.
    expect(tallies).toEqual([
      { scored: 1, stateChanges: 0, formulaVersion: 1 },
      { scored: 1, stateChanges: 0, formulaVersion: 1 },
      { scored: 1, stateChanges: 1, formulaVersion: 1 },
      { scored: 1, stateChanges: 0, formulaVersion: 1 },
    ]);
    expect(await scoreRow(at, caseKey)).toMatchObject({
      score: "0.5028",
      window_runs: 4,
      state: "watching",
      formula_version: 1,
    });

    // The same occurrences, scored again, are the same number and state — and not a change.
    const before = await scoreRow(at, caseKey);
    const again = await at.scorer.rescoreWorkspace(at.workspace.id, 1, 100);

    expect(again).toMatchObject({ status: "complete", casesScored: 1, stateChanges: 0 });
    expect(await scoreRow(at, caseKey)).toEqual(before);

    // The steady neighbour never passed on retry, so it was never scored.
    const { rows } = await api.sql.query(
      `select case_key from ouroboros.flake_scores where organization_id = $1`,
      [at.workspace.id],
    );

    expect(rows).toEqual([{ case_key: caseKey }]);
  });

  it("returns a case that stopped flaking to healthy on the next nightly pass", async () => {
    const at = await bench();
    const { caseKey } = await telemetryHistory(at);

    // Ten clean builds the parse did not score: the flakes sink to ranks 10 and 13, 0.078 < 0.10.
    await cleanBuildsWithoutScoring(at, 10);
    expect(await scoreRow(at, caseKey)).toMatchObject({ state: "watching" });

    const report = await at.scorer.rescoreAll();

    expect(report.workspaces).toEqual([
      expect.objectContaining({
        organizationId: at.workspace.id,
        status: "complete",
        casesScored: 1,
        stateChanges: 1,
        candidates: [],
      }),
    ]);
    expect(await scoreRow(at, caseKey)).toMatchObject({
      score: "0.0782",
      window_runs: 14,
      state: "healthy",
      formula_version: 1,
    });

    const { rows } = await api.sql.query<{
      status: string;
      formula_version: number;
      cases_scored: number;
      state_changes: number;
      duration_ms: string | null;
    }>(
      `select status, formula_version, cases_scored, state_changes, duration_ms
         from ouroboros.flake_scorer_runs where organization_id = $1`,
      [at.workspace.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "complete",
      formula_version: 1,
      cases_scored: 1,
      state_changes: 1,
    });
    expect(rows[0].duration_ms).not.toBeNull();

    // Healthy at zero-ish is still active (score > 0); a later night records a run of its own.
    await at.scorer.rescoreAll();
    const { rows: runs } = await api.sql.query(
      `select id from ouroboros.flake_scorer_runs where organization_id = $1`,
      [at.workspace.id],
    );

    expect(runs).toHaveLength(2);
  });

  it("respects the cap, least recently scored first", async () => {
    const at = await bench();
    const policy = parseFlakePolicy("retry-once");
    const runId = await run(at, 482);

    // Three flaky cases, each passing on retry once.
    const testRunId = await attempt(at, runId, 1, 30);
    const flakyCase = (name: string) =>
      `<testcase classname="${CLASSNAME}" name="${name}"><flakyFailure message="x"/></testcase>`;

    await at.ingest.parseAttempt({
      organizationId: at.workspace.id,
      testRunId,
      files: [
        textFile(
          "junit.xml",
          `<testsuites><testsuite name="${SUITE}">${flakyCase("a")}${flakyCase("b")}${flakyCase("c")}` +
            `</testsuite></testsuites>`,
        ),
      ],
      flakePolicy: policy,
    });

    await api.sql.query(
      `update ouroboros.flake_scores s set last_scored_at = now() - make_interval(hours => o.n::int)
         from (select id, row_number() over (order by case_key) as n
                 from ouroboros.flake_scores where organization_id = $1) o
        where s.id = o.id`,
      [at.workspace.id],
    );

    const { rows: stalest } = await api.sql.query<{ case_key: string }>(
      `select case_key from ouroboros.flake_scores where organization_id = $1
        order by last_scored_at limit 2`,
      [at.workspace.id],
    );
    const first = await at.scorer.rescoreWorkspace(at.workspace.id, 1, 2);
    const { rows: fresh } = await api.sql.query<{ case_key: string }>(
      `select case_key from ouroboros.flake_scores
        where organization_id = $1 and last_scored_at > now() - interval '1 minute'
        order by case_key`,
      [at.workspace.id],
    );

    expect(first).toMatchObject({ status: "complete", casesScored: 2 });
    expect(fresh.map((row) => row.case_key)).toEqual(stalest.map((row) => row.case_key).sort());

    const second = await at.scorer.rescoreWorkspace(at.workspace.id, 1, 2);

    expect(second).toMatchObject({ casesScored: 2 });
    const { rows: all } = await api.sql.query(
      `select case_key from ouroboros.flake_scores
        where organization_id = $1 and last_scored_at > now() - interval '1 minute'`,
      [at.workspace.id],
    );

    expect(all).toHaveLength(3);
  });

  it("stamps a new formula on every score the next pass writes", async () => {
    const at = await bench();
    const { caseKey } = await telemetryHistory(at);

    await api.sql.query(
      `insert into ouroboros.flake_score_formulas
           (version, window_size, decay, watch_at, clear_below, min_observations, description)
       values (2, 3, 1, 0.9, 0.5, 1, 'test: a three-run unweighted window')`,
    );

    try {
      const report = await at.scorer.rescoreAll();

      expect(report.formulaVersion).toBe(2);
      // The latest three are `F · ·` unweighted: 1/3, under v2's clear_below of 0.5.
      expect(await scoreRow(at, caseKey)).toMatchObject({
        score: "0.3333",
        window_runs: 3,
        state: "healthy",
        formula_version: 2,
      });
    } finally {
      await api.sql.query(`delete from ouroboros.flake_scorer_runs`);
      await api.sql.query(`delete from ouroboros.flake_scores`);
      await api.sql.query(`delete from ouroboros.flake_score_formulas where version = 2`);
    }
  });

  it("holds formula 1's window boundaries: three observations, the band between thresholds, twenty runs", async () => {
    // AT.6 (#334): each boundary of V054's formula 1, crossed in both directions by parses alone.
    const at = await bench();
    const policy = parseFlakePolicy("retry-once");
    const runId = await run(at, 482);
    let seq = 0;

    /** Parse `count` more attempts of one outcome, each a minute newer than the last. */
    const builds = async (count: number, outcome: Outcome) => {
      for (let n = 0; n < count; n += 1) {
        seq += 1;
        await parse(at, await attempt(at, runId, seq, 100 - seq), outcome, policy);
      }
    };

    // Under min_observations (3) the state is kept, however high the score.
    await builds(2, "flaky");
    const caseKey = await telemetryKey(at);
    expect(await scoreRow(at, caseKey)).toMatchObject({
      score: "1.0000",
      window_runs: 2,
      state: "healthy",
    });

    // The third observation crosses watch_at (0.25) upwards.
    await builds(1, "flaky");
    expect(await scoreRow(at, caseKey)).toMatchObject({ window_runs: 3, state: "watching" });

    // Six clean builds sink it to 0.2351 — inside the band, so it keeps watching.
    await builds(6, "passed");
    expect(await scoreRow(at, caseKey)).toMatchObject({ score: "0.2351", state: "watching" });

    // Six more reach 0.0964, under clear_below (0.10): healthy, downwards.
    await builds(6, "passed");
    expect(await scoreRow(at, caseKey)).toMatchObject({ score: "0.0964", state: "healthy" });

    // Twenty clean builds fill the window; the flakes have fallen out of it entirely.
    await builds(8, "passed");
    expect(await scoreRow(at, caseKey)).toMatchObject({
      score: "0.0000",
      window_runs: 20,
      state: "healthy",
      formula_version: 1,
    });
  });

  it("never writes quarantined — a score of 1 watches, and a quarantined case stays put", async () => {
    const at = await bench();
    const policy = parseFlakePolicy("retry-once");
    const runId = await run(at, 482);

    for (let seq = 1; seq <= 3; seq += 1) {
      await parse(at, await attempt(at, runId, seq, 60 - seq), "flaky", policy);
    }

    const caseKey = await telemetryKey(at);

    expect(await scoreRow(at, caseKey)).toMatchObject({ score: "1.0000", state: "watching" });

    // AV.3's move, made by hand: the scorer must keep it, even as the case turns clean.
    await api.sql.query(
      `update ouroboros.flake_scores set state = 'quarantined'
        where organization_id = $1 and case_key = $2`,
      [at.workspace.id, caseKey],
    );
    await cleanBuildsWithoutScoring(at, 20);
    const night = await at.scorer.rescoreAll();

    expect(night.workspaces).toEqual([
      expect.objectContaining({ status: "complete", casesScored: 1 }),
    ]);

    expect(await scoreRow(at, caseKey)).toMatchObject({ score: "0.0000", state: "quarantined" });

    const { rows } = await api.sql.query(
      `select case_key from ouroboros.flake_scores where state = 'quarantined'`,
    );

    expect(rows).toEqual([{ case_key: caseKey }]);
  });

  it("reads the case state and the summary back, per workspace", async () => {
    const at = await bench();
    const { caseKey } = await telemetryHistory(at);

    await at.scorer.rescoreAll();

    const owner = (path: string) =>
      api.as(at.owner)("get", path).set(TENANT_HEADER, at.workspace.slug);

    const summary = await owner("/api/v1/flakes/summary").expect(200);

    expect(summary.body).toMatchObject({
      formulaVersion: 1,
      watching: 1,
      quarantined: 0,
      candidates: [
        {
          caseKey,
          repository: "helios-firmware",
          name: CASE,
          classname: CLASSNAME,
          suite: SUITE,
          score: 0.5028,
          windowRuns: 4,
          state: "watching",
          formulaVersion: 1,
        },
      ],
      lastRun: { status: "complete", casesScored: 1, stateChanges: 0, error: null },
    });

    const state = await owner(`/api/v1/flakes/cases/${caseKey}`).expect(200);

    expect(state.body).toMatchObject({
      caseKey,
      githubRepoId: at.workspace.repoId,
      state: "watching",
      quarantined: false,
      observed: 4,
      passOnRetry: 2,
      score: { score: 0.5028, windowRuns: 4, state: "watching", formulaVersion: 1 },
    });

    const missing = await owner(`/api/v1/flakes/cases/${"0".repeat(64)}`).expect(404);

    expect(missing.body).toMatchObject({ code: "flake_case_not_found" });
    await owner("/api/v1/flakes/cases/not-a-key").expect(422);

    // Another workspace cannot read this one's case.
    const stranger = await bench();

    await api
      .as(stranger.owner)("get", `/api/v1/flakes/cases/${caseKey}`)
      .set(TENANT_HEADER, stranger.workspace.slug)
      .expect(404);
    await api
      .as(stranger.owner)("get", "/api/v1/flakes/summary")
      .set(TENANT_HEADER, stranger.workspace.slug)
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({ watching: 0, candidates: [], lastRun: null }),
      );
  });

  describe("the Insights flaky card (#438)", () => {
    /** A window comfortably around everything the bench writes. */
    const span = () => ({
      from: new Date(Date.now() - 2 * 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    });

    it("lists a watching case with its real occurrences, per day, and the platform it flaked on", async () => {
      const at = await bench();
      const { caseKey } = await telemetryHistory(at);
      const state = api.nest.get(FlakeStateService);

      const [watching, ...rest] = await state.card(at.workspace.id, span());

      expect(rest).toEqual([]);
      expect(watching).toMatchObject({
        caseKey,
        repository: "helios-firmware",
        name: CASE,
        suite: SUITE,
        state: "watching",
        // Four builds: a pass on retry, two failures, a pass on its second retry.
        observed: 4,
        flaky: 2,
        resolvedBy: null,
      });
      // Whatever days the four fell on, the history adds up to them and nothing else.
      expect(watching.history.reduce((total, day) => total + day.observed, 0)).toBe(4);
      expect(watching.history.reduce((total, day) => total + day.flaky, 0)).toBe(2);
      expect(watching.history.map((day) => day.day)).toEqual(
        [...watching.history.map((day) => day.day)].sort(),
      );
      // The report names one platform, so the flaky occurrences all ran on it.
      expect(watching.platform).toEqual(expect.any(String));
    });

    it("calls a case that came back to healthy fixed, naming the loop whose build showed it", async () => {
      const at = await bench();
      const { caseKey } = await telemetryHistory(at);
      const state = api.nest.get(FlakeStateService);

      await cleanBuildsWithoutScoring(at, 10);
      await at.scorer.rescoreAll();
      expect(await scoreRow(at, caseKey)).toMatchObject({ state: "healthy" });

      const [fixed] = await state.card(at.workspace.id, span());
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runs where organization_id = $1 and issue_number = 490`,
        [at.workspace.id],
      );

      expect(fixed).toMatchObject({
        caseKey,
        state: "fixed",
        observed: 14,
        flaky: 2,
        // The first clean pass after the last flaky occurrence was loop #490's.
        resolvedBy: { runId: rows[0].id, issueNumber: 490 },
      });
    });

    it("does not list a healthy case that was never flaky, or one fixed before the window", async () => {
      const at = await bench();
      const { caseKey } = await telemetryHistory(at);
      const state = api.nest.get(FlakeStateService);

      await cleanBuildsWithoutScoring(at, 10);
      await at.scorer.rescoreAll();

      // The steady neighbour has no score at all; the fixed case's change is outside this window.
      const before = {
        from: new Date(Date.now() - 10 * 86_400_000),
        to: new Date(Date.now() - 5 * 86_400_000),
      };

      expect(await state.card(at.workspace.id, before)).toEqual([]);
      expect((await state.card(at.workspace.id, span())).map((flaky) => flaky.caseKey)).toEqual([
        caseKey,
      ]);
    });

    it("does not call a case fixed that flaked but never left healthy", async () => {
      const at = await bench();
      const policy = parseFlakePolicy("retry-once");
      const runId = await run(at, 482);

      // Two flaky builds: scored, but under formula 1's three observations — healthy from birth.
      await parse(at, await attempt(at, runId, 1, 20), "flaky", policy);
      await parse(at, await attempt(at, runId, 2, 10), "flaky", policy);

      expect(await scoreRow(at, await telemetryKey(at))).toMatchObject({ state: "healthy" });
      // Nothing was ever wrong enough to fix, so "fixed" would be a claim with nothing behind it.
      expect(await api.nest.get(FlakeStateService).card(at.workspace.id, span())).toEqual([]);
    });

    it("keeps to the workspace and to the repository asked for", async () => {
      const at = await bench();
      const neighbour = await bench();
      const state = api.nest.get(FlakeStateService);

      await telemetryHistory(at);

      const mirror = `${at.workspace.slug}/helios-firmware`;

      expect(await state.card(neighbour.workspace.id, span())).toEqual([]);
      // The neighbour mirrors a repository of the same name: asking for this one's is still empty.
      expect(await state.card(neighbour.workspace.id, span(), mirror)).toEqual([]);
      expect(await state.card(at.workspace.id, span(), mirror.toUpperCase())).toHaveLength(1);
      expect(
        await state.card(at.workspace.id, span(), `${at.workspace.slug}/atlas-control`),
      ).toEqual([]);
    });
  });
});
