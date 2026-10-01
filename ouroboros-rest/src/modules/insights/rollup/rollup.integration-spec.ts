import { ApiHarness } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { throughputExtractor } from "./extractors/throughput.extractor";
import { addDays } from "./rollup.days";
import { ROLLUP_EXTRACTORS } from "./rollup.extractors";
import { oracle, rewindow, windowKey, type WindowValues } from "./rollup.oracle.fixture";
import { RollupService } from "./rollup.service";
import type { Day } from "./rollup.types";

/**
 * The oracle parity suite — the rollup extractors against their on-the-fly twins, over a migrated
 * database (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433), decision **I2**).
 *
 * This is the issue's central deliverable. Every family fills three days of a fixture through the
 * real service; every metric's window is then re-derived from `metric_daily` the way a reader must
 * (sums, re-summed rate components, pooled median samples) and must equal what
 * `rollup.oracle.fixture.ts` computes straight from the source planes — per day and over the whole
 * window, per repository and dimension. A rollup that drifts from the truth fails CI here.
 *
 * Then the operational criteria: an hourly tick run twice changes nothing, a backfill interrupted
 * mid-range resumes without gaps or double-counting, revert detection catches both patterns and
 * not the near-miss, I6's untouched rate excludes a PR with a human push, priced and unpriced usage
 * stay separable, and test failures land in suite-dimensioned rows.
 *
 * ```bash
 * yarn test:integration src/modules/insights/rollup
 * ```
 */

/** The fixture's three days, and the instant the suite pretends it is. */
const D1 = "2026-08-03";
const D2 = "2026-08-04";
const D3 = "2026-08-05";
const NOW = new Date("2026-09-01T12:00:00.000Z");

/** The workspaces: the one under test, and a neighbour whose rows must never appear in it. */
const ORG = "org-rollup-parity";
const OTHER = "org-rollup-other";

const HELIOS = "parity-works/helios";
const ZEPHYR = "parity-works/zephyr";

/** Every metric the extractors fill, plus the one a window derives. */
const METRICS = [
  ...ROLLUP_EXTRACTORS.flatMap((extractor) => Object.keys(extractor.metrics)),
  "cost_per_merged_pr",
];

/**
 * An instant on a fixture day.
 *
 * @param day - The day.
 * @param time - `HH:MM` or `HH:MM:SS`, UTC.
 * @returns The ISO instant.
 */
function at(day: Day, time: string): string {
  return `${day}T${time.length === 5 ? `${time}:00` : time}.000Z`;
}

describe("the rollup extractors and their oracle twins", () => {
  let api: ApiHarness;
  let rollups: RollupService;

  /**
   * Run a statement on the suite's own connection and return its first row.
   *
   * @param text - The statement.
   * @param params - Its parameters.
   * @returns The first row.
   */
  async function one<T extends object>(text: string, params: unknown[] = []): Promise<T> {
    const { rows } = await api.sql.query<T>(text, params);

    return rows[0];
  }

  /**
   * One loop: a run, optionally its PR, stages, commits and revisions.
   *
   * @param spec - The loop.
   * @returns The run's id and the PR's.
   */
  async function loop(spec: {
    org?: string;
    repo: string;
    issue: number;
    status: "merged" | "needs_human" | "coding";
    started: string;
    finished?: string;
    pr?: { title: string; state: "merged" | "closed"; mergedAt?: string; url: string };
    commits?: { sha: string; message: string; at: string }[];
    revisions?: string[];
    stages?: { key: string; attempt: number; start: string; finish: string; status?: string }[];
  }): Promise<{ run: string; pr?: string }> {
    const org = spec.org ?? ORG;
    const { id: run } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs
         (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model, status,
          stage_label, stage_index, stage_total, started_at, finished_at, pr_number)
       values ($1, $2, $3, 'Loop', 'standard-fix', 'claude-fable-5', $4, 'Verify', 6, 6, $5, $6, $7)
       returning id`,
      [
        org,
        spec.repo,
        spec.issue,
        spec.status,
        spec.started,
        spec.finished ?? null,
        spec.pr ? spec.issue : null,
      ],
    );

    for (const [index, commit] of (spec.commits ?? []).entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_commits (run_id, sha, message, seq, committed_at)
         values ($1, $2, $3, $4, $5)`,
        [run, commit.sha, commit.message, index + 1, commit.at],
      );
    }

    for (const stage of spec.stages ?? []) {
      const retry = stage.attempt > 1;

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_stages
           (run_id, stage_key, stage_label, position, attempt, status, started_at, finished_at,
            return_reason, returned_from_stage_key, returned_from_kind)
         values ($1, $2, initcap($2), 1, $3, $4, $5, $6, $7, $8, $9)`,
        [
          run,
          stage.key,
          stage.attempt,
          stage.status ?? "succeeded",
          stage.start,
          stage.finish,
          retry ? "failed_tests" : null,
          retry ? "test" : null,
          retry ? "gate" : null,
        ],
      );
    }

    if (spec.pr === undefined) {
      return { run };
    }

    const { id: pr } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
         (organization_id, source_id, external_number, external_url, title, head_branch,
          base_branch, run_id, state, merged_at)
       values ($1, (select id from ${SCHEMA_NAME}.ticket_sources where organization_id = $1),
               $2::int, $3, $4, 'loop/' || $2::text, 'main', $5, $6, $7)
       returning id`,
      [org, spec.issue, spec.pr.url, spec.pr.title, run, spec.pr.state, spec.pr.mergedAt ?? null],
    );

    for (const [index, sha] of (spec.revisions ?? []).entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at)
         values ($1, $2, $3, $4)`,
        [pr, index + 1, sha, spec.started],
      );
    }

    return { run, pr };
  }

  /**
   * A PR with no loop behind it — a person's revert, or a near-miss.
   *
   * @param number - Its number.
   * @param title - Its title.
   * @param mergedAt - When it merged.
   * @param url - Its URL, which names its repository.
   */
  async function humanPr(
    number: number,
    title: string,
    mergedAt: string,
    url: string,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.pull_requests
         (organization_id, source_id, external_number, external_url, title, head_branch,
          base_branch, state, merged_at)
       values ($1, (select id from ${SCHEMA_NAME}.ticket_sources where organization_id = $1),
               $2::int, $3, $4, 'revert-' || $2::text, 'main', 'merged', $5)`,
      [ORG, number, url, title, mergedAt],
    );
  }

  /**
   * A finished farm job.
   *
   * @param spec - The job.
   */
  async function job(spec: {
    run: string;
    repo: string;
    number: number;
    status: "succeeded" | "failed" | "retried" | "canceled";
    finished: string;
    ref: string;
  }): Promise<void> {
    const started = spec.status === "canceled" ? null : spec.finished;

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, run_id, github_repo_id, git_ref, label,
          title, executor, command, status, queued_at, offered_at, started_at, finished_at, exit_code)
       values ($1, $2, (select id from ${SCHEMA_NAME}.runner_pools where organization_id = $1),
               (select id from ${SCHEMA_NAME}.runners where organization_id = $1),
               $3, $4, $5, 'build', 'Build', 'shell', 'make', $6,
               $7::timestamptz - interval '1 minute', $8, $8, $7, $9)`,
      [
        ORG,
        spec.number,
        spec.run,
        spec.repo,
        spec.ref,
        spec.status,
        spec.finished,
        started,
        spec.status === "succeeded" ? 0 : spec.status === "canceled" ? null : 1,
      ],
    );
  }

  /**
   * A test run with its suites' counts.
   *
   * @param run - The loop.
   * @param status - `complete`, `error` or `running`.
   * @param started - When it started.
   * @param suites - `[name, passed, failed, flaky, skipped]` per suite.
   */
  async function testRun(
    run: string,
    status: "complete" | "error" | "running",
    started: string,
    suites: [string, number, number, number, number][],
  ): Promise<void> {
    const { id } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, status, started_at)
       values ($1, $2, (select count(*) + 1 from ${SCHEMA_NAME}.test_runs where run_id = $2), $3, $4)
       returning id`,
      [ORG, run, status, started],
    );

    for (const [name, passed, failed, flaky, skipped] of suites) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.test_suites
           (organization_id, test_run_id, name, platform, kind, total, passed, failed, flaky, skipped, meta)
         values ($1, $2, $3, 'native_posix', 'sim', $4, $5, $6, $7, $8, '{}')`,
        [ORG, id, name, passed + failed + flaky + skipped, passed, failed, flaky, skipped],
      );
    }
  }

  /**
   * Token usage on a loop.
   *
   * @param run - The loop.
   * @param tokensIn - Input tokens.
   * @param tokensOut - Output tokens.
   * @param costCents - The priced cost, or null for unpriced.
   * @param occurred - When.
   */
  async function usage(
    run: string | null,
    tokensIn: number,
    tokensOut: number,
    costCents: number | null,
    occurred: string,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.token_usage
         (organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents, occurred_at)
       values ($1, $2, 'anthropic', 'claude-fable-5', $3, $4, $5, $6)`,
      [ORG, run, tokensIn, tokensOut, costCents, occurred],
    );
  }

  /**
   * An estimate outcome for a merged loop PR, as #435's fill would write it.
   *
   * @param pr - The PR.
   * @param effort - The predicted effort.
   * @param band - The cycle band, minutes.
   * @param actualMs - The lead time.
   * @param mergedAt - When it merged.
   */
  async function outcome(
    pr: string,
    effort: string,
    band: [number, number],
    actualMs: number,
    mergedAt: string,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.estimate_outcomes
         (organization_id, pr_id, queued_at, predicted_effort, predicted_cycle_min,
          predicted_cycle_max, actual_duration_ms, merged_at)
       values ($1, $2, $3::timestamptz - interval '1 hour', $4, $5, $6, $7, $3)`,
      [ORG, pr, mergedAt, effort, band[0], band[1], actualMs],
    );
  }

  /**
   * The workspace's fixture: three days across two repositories, built so every family has rows,
   * and so each acceptance criterion has its own case — see each comment.
   */
  async function seed(): Promise<void> {
    for (const [id, slug] of [
      [ORG, "rollup-parity"],
      [OTHER, "rollup-other"],
    ]) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.organization ("id", "name", "slug", "createdAt")
         values ($1, $2, $2, now())`,
        [id, slug],
      );
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name)
         values ($1, 'github', 'GitHub')`,
        [id],
      );
    }

    const { id: owner } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'parity-works', true) returning id`,
      [ORG],
    );
    const { id: helios } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled, default_branch)
       values ($1, 'helios', true, 'main') returning id`,
      [owner],
    );
    // No default branch recorded: its green builds are builds, never deploys.
    const { id: zephyr } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled) values ($1, 'zephyr', true)
       returning id`,
      [owner],
    );
    const { id: otherOwner } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'other-works', true) returning id`,
      [OTHER],
    );
    const { id: otherRepo } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled, default_branch)
       values ($1, 'helios', true, 'main') returning id`,
      [otherOwner],
    );
    const { id: pool } = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, 'build-pool', 'shell') returning id`,
      [ORG],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runners
         (organization_id, pool_id, name, arch, status, desired_state, security_mode, cert_serial,
          capabilities)
       values ($1, $2, 'forge-01', 'linux/arm64', 'offline', 'active', 'mtls', '4a7333a1',
               '{"executors": ["shell"]}'::jsonb)`,
      [ORG, pool],
    );

    const heliosPr = (n: number) => `https://github.com/${HELIOS}/pull/${String(n)}`;
    const zephyrPr = (n: number) => `https://github.com/${ZEPHYR}/pull/${String(n)}`;

    // R1 — merged untouched and autonomous; a stage retried; a red build then a green default-branch
    // one (a deploy and a 5-minute recovery); priced and unpriced usage; a test run with a failing
    // and a clean suite; estimated `s`.
    const r1 = await loop({
      repo: helios,
      issue: 101,
      status: "merged",
      started: at(D1, "09:00"),
      finished: at(D1, "09:14:20"),
      pr: {
        title: "Fix CAN-bus flake",
        state: "merged",
        mergedAt: at(D1, "09:14:20"),
        url: heliosPr(101),
      },
      commits: [{ sha: "a1a1a1a", message: "fix: CAN-bus flake", at: at(D1, "09:10") }],
      revisions: ["a1a1a1a"],
      stages: [
        { key: "analyze", attempt: 1, start: at(D1, "09:00"), finish: at(D1, "09:01") },
        {
          key: "implement",
          attempt: 1,
          start: at(D1, "09:01"),
          finish: at(D1, "09:03"),
          status: "failed",
        },
        { key: "implement", attempt: 2, start: at(D1, "09:03"), finish: at(D1, "09:07") },
        { key: "test", attempt: 1, start: at(D1, "09:07"), finish: at(D1, "09:09:40") },
      ],
    });

    await job({
      run: r1.run,
      repo: helios,
      number: 1,
      status: "failed",
      finished: at(D1, "09:05"),
      ref: "refs/heads/main",
    });
    await job({
      run: r1.run,
      repo: helios,
      number: 2,
      status: "succeeded",
      finished: at(D1, "09:10"),
      ref: "refs/heads/main",
    });
    await job({
      run: r1.run,
      repo: helios,
      number: 3,
      status: "canceled",
      finished: at(D1, "09:11"),
      ref: "refs/heads/main",
    });
    await usage(r1.run, 1000, 500, 912.5, at(D1, "09:05"));
    await usage(r1.run, 300, 100, null, at(D1, "09:06"));
    await testRun(r1.run, "complete", at(D1, "09:08"), [
      ["telemetry integration", 10, 2, 1, 3],
      ["unit · drivers", 20, 0, 0, 0],
    ]);
    await outcome(r1.pr ?? "", "s", [12, 18], 860_000, at(D1, "09:14:20"));

    // R2 — merged, but a human pushed after the loop (not untouched) and a guardrail failed twice on
    // one check (not autonomous; one intervention, not two). A retried build, then green off the
    // default branch: a recovery, no deploy. Reverted on D3 by a loop commit (`revert:`).
    const r2 = await loop({
      repo: helios,
      issue: 102,
      status: "merged",
      started: at(D1, "10:00"),
      finished: at(D1, "10:40"),
      pr: {
        title: "Add telemetry",
        state: "merged",
        mergedAt: at(D1, "10:40"),
        url: heliosPr(102),
      },
      commits: [{ sha: "b2b2b2b", message: "feat: telemetry", at: at(D1, "10:20") }],
      revisions: ["b2b2b2b", "c3c3c3c"],
      stages: [{ key: "implement", attempt: 1, start: at(D1, "10:00"), finish: at(D1, "10:30") }],
    });

    for (const [check, verdict, time] of [
      ["secrets", "fail", "10:10"],
      ["secrets", "fail", "10:15"],
      ["ci_config", "pass", "10:12"],
    ]) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.guardrail_evaluations (run_id, "check", verdict, evaluated_at)
         values ($1, $2, $3, $4)`,
        [r2.run, check, verdict, at(D1, time)],
      );
    }

    await job({
      run: r2.run,
      repo: helios,
      number: 4,
      status: "retried",
      finished: at(D1, "10:20"),
      ref: "loop/102",
    });
    await job({
      run: r2.run,
      repo: helios,
      number: 5,
      status: "succeeded",
      finished: at(D1, "10:30"),
      ref: "loop/102",
    });
    await outcome(r2.pr ?? "", "s", [12, 18], 2_400_000, at(D1, "10:40"));

    // R3 — handed to a person: an intervention, and a closed PR in merge rate's denominator. Its
    // still-running test run is in nothing.
    const r3 = await loop({
      repo: helios,
      issue: 103,
      status: "needs_human",
      started: at(D1, "11:00"),
      finished: at(D1, "12:00"),
      pr: { title: "Rework ISR", state: "closed", url: heliosPr(103) },
    });

    await testRun(r3.run, "running", at(D1, "11:30"), [["telemetry integration", 0, 5, 0, 0]]);

    // R4 — zephyr: merged with only unpriced usage (no cost row), a green build that is not a deploy,
    // an errored test run, estimated `m`. Reverted on D3 by a person's squash-merged revert PR.
    const r4 = await loop({
      repo: zephyr,
      issue: 104,
      status: "merged",
      started: at(D2, "08:00"),
      finished: at(D2, "08:30"),
      pr: { title: "Bump deps", state: "merged", mergedAt: at(D2, "08:30"), url: zephyrPr(104) },
      commits: [{ sha: "d4d4d4d", message: "chore: bump deps", at: at(D2, "08:10") }],
      revisions: ["d4d4d4d"],
    });

    await job({
      run: r4.run,
      repo: zephyr,
      number: 6,
      status: "succeeded",
      finished: at(D2, "08:20"),
      ref: "main",
    });
    await usage(r4.run, 2000, 1000, null, at(D2, "08:10"));
    await testRun(r4.run, "error", at(D2, "08:15"), [["unit", 3, 1, 0, 0]]);
    await outcome(r4.pr ?? "", "m", [30, 45], 1_800_000, at(D2, "08:30"));

    // R5 — merged with no revisions at all (untouched), unestimated, and usage priced at a real $0.
    const r5 = await loop({
      repo: helios,
      issue: 106,
      status: "merged",
      started: at(D2, "09:00"),
      finished: at(D2, "09:20"),
      pr: { title: "Docs typo", state: "merged", mergedAt: at(D2, "09:20"), url: heliosPr(106) },
      stages: [{ key: "implement", attempt: 1, start: at(D2, "09:00"), finish: at(D2, "09:15") }],
    });

    await usage(r5.run, 100, 100, 0, at(D2, "09:10"));
    // Usage with no loop belongs to no repository.
    await usage(null, 5000, 5000, 100, at(D2, "09:10"));

    // R6 — a loop still coding, whose commit reverts R2 by Conventional Commits.
    await loop({
      repo: helios,
      issue: 107,
      status: "coding",
      started: at(D3, "08:00"),
      commits: [
        {
          sha: "e5e5e5e",
          message: "revert: Add telemetry\n\nThe sampler regressed.",
          at: at(D3, "09:00"),
        },
      ],
    });

    // People's PRs. #105 reverts R4 (squash suffix). #108 names R1 but is in zephyr; #109 names R1
    // but merged before it. #110 is the near-miss that must not match anything.
    await humanPr(105, 'Revert "Bump deps" (#104)', at(D3, "10:00"), zephyrPr(105));
    await humanPr(108, 'Revert "Fix CAN-bus flake"', at(D3, "10:30"), zephyrPr(108));
    await humanPr(109, 'Revert "Fix CAN-bus flake"', at(D1, "08:00"), heliosPr(109));
    await humanPr(110, "Reverted docs typo", at(D3, "11:00"), heliosPr(110));

    // The neighbour: one merged loop, in a repository with the same name under another owner.
    await loop({
      org: OTHER,
      repo: otherRepo,
      issue: 201,
      status: "merged",
      started: at(D1, "09:00"),
      finished: at(D1, "09:30"),
      pr: {
        title: "Elsewhere",
        state: "merged",
        mergedAt: at(D1, "09:30"),
        url: "https://github.com/other-works/helios/pull/201",
      },
    });
  }

  /** Fill D1–D3 for every family of every workspace, through the service. */
  async function fillFixtureDays(): Promise<void> {
    for (const organizationId of [ORG, OTHER]) {
      for (const extractor of ROLLUP_EXTRACTORS) {
        const result = await rollups.backfill(organizationId, extractor.family, D1, D3, NOW);

        expect(result).toEqual(expect.objectContaining({ status: "succeeded" }));
      }
    }
  }

  /**
   * The grain, as comparable rows.
   *
   * @returns Every row, without its id and fill time, in a stable order.
   */
  async function grain(): Promise<unknown[]> {
    const { rows } = await api.sql.query<Record<string, unknown>>(
      `select organization_id, repo_ref, metric_id, dimension, to_char(day, 'YYYY-MM-DD') as day,
              value, numerator, denominator, meta
         from ${SCHEMA_NAME}.metric_daily
        order by 1, 2, 3, 4, 5`,
    );

    return rows;
  }

  /**
   * A metric's window as a reader re-derives it from the grain.
   *
   * @param metricId - The metric.
   * @param from - The first day.
   * @param to - The last day.
   * @returns The window.
   */
  async function rolledUp(metricId: string, from: Day, to: Day): Promise<WindowValues> {
    if (metricId === "cost_per_merged_pr") {
      const cents = await rewindow(api.sql, ORG, "cost_cents", "sum", from, to);
      const merged = await rewindow(api.sql, ORG, "merged_prs", "sum", from, to);
      const out: WindowValues = new Map();

      for (const [key, spend] of cents) {
        const prs = merged.get(key);

        if ("value" in spend && prs !== undefined && "value" in prs && prs.value > 0) {
          out.set(key, { numerator: spend.value, denominator: prs.value });
        }
      }

      return out;
    }

    const { rows } = await api.sql.query<{ aggregation: "sum" | "ratio" | "median" }>(
      `select aggregation from ${SCHEMA_NAME}.metric_definitions where metric_id = $1`,
      [metricId],
    );

    return rewindow(api.sql, ORG, metricId, rows[0].aggregation, from, to);
  }

  /**
   * A window with zero-valued sums dropped — a zero count over a non-empty population is a row, and
   * an empty population is no row, and both mean the same "none". `cost_cents` keeps its zeros: a
   * real $0 is not "cost unavailable".
   *
   * @param metricId - The metric.
   * @param values - The window.
   * @returns The comparable window, as a plain object.
   */
  function comparable(metricId: string, values: WindowValues): Record<string, unknown> {
    return Object.fromEntries(
      [...values].filter(
        ([, value]) => metricId === "cost_cents" || !("value" in value) || value.value !== 0,
      ),
    );
  }

  beforeAll(async () => {
    api = await ApiHarness.start({
      // One tick fills the fixture's days: D1 is 29 days before NOW.
      OURO_INSIGHTS_ROLLUP_BACKFILL_DAYS: "40",
      OURO_INSIGHTS_ROLLUP_DAYS_PER_TICK: "366",
    });
    rollups = api.nest.get(RollupService);
    await api.truncate();
    await seed();
  });

  beforeEach(async () => {
    await api.sql.query(`delete from ${SCHEMA_NAME}.metric_daily`);
    await api.sql.query(`delete from ${SCHEMA_NAME}.metric_rollup_state`);
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  it("covers every rolled-up metric with fixture data, so parity is never vacuous", async () => {
    const empty: string[] = [];

    for (const metricId of METRICS) {
      if ((await oracle(api.sql, ORG, metricId, D1, D3)).size === 0) {
        empty.push(metricId);
      }
    }

    expect(empty).toEqual([]);
  });

  it.each([
    [D1, D1],
    [D2, D2],
    [D3, D3],
    [D1, D2],
    [D1, D3],
  ])("equals its oracle for every family over %s … %s", async (from, to) => {
    await fillFixtureDays();

    for (const metricId of METRICS) {
      expect({
        metricId,
        window: comparable(metricId, await rolledUp(metricId, from, to)),
      }).toEqual({
        metricId,
        window: comparable(metricId, await oracle(api.sql, ORG, metricId, from, to)),
      });
    }
  });

  it("keeps each workspace's rows to its own repositories", async () => {
    await fillFixtureDays();

    const { rows } = await api.sql.query<{ organization_id: string; repo_ref: string }>(
      `select distinct organization_id, repo_ref from ${SCHEMA_NAME}.metric_daily order by 1, 2`,
    );

    expect(rows).toEqual([
      { organization_id: OTHER, repo_ref: "other-works/helios" },
      { organization_id: ORG, repo_ref: HELIOS },
      { organization_id: ORG, repo_ref: ZEPHYR },
    ]);
  });

  it("pools median samples across days and never averages daily medians — stable on re-run", async () => {
    await fillFixtureDays();

    const window = await rolledUp("cycle_time", D1, D2);
    const daily = await api.sql.query<{ day: string; value: string; meta: { samples: number[] } }>(
      `select to_char(day, 'YYYY-MM-DD') as day, value, meta from ${SCHEMA_NAME}.metric_daily
        where organization_id = $1 and repo_ref = $2 and metric_id = 'cycle_time' order by day`,
      [ORG, HELIOS],
    );

    // D1: 14m20s and 40m (median 27m10s); D2: 20m. Pooled: 20m, 14m20s, 40m → 20m.
    expect(daily.rows).toEqual([
      { day: D1, value: "1630000", meta: { samples: [860_000, 2_400_000] } },
      { day: D2, value: "1200000", meta: { samples: [1_200_000] } },
    ]);
    expect(window.get(windowKey(HELIOS, ""))).toEqual({ value: 1_200_000 });

    const before = await grain();

    await fillFixtureDays();
    expect(await grain()).toEqual(before);
  });

  it("is idempotent — the hourly tick run twice changes nothing", async () => {
    await rollups.tick(NOW);
    const first = await grain();

    await rollups.tick(NOW);
    await rollups.tick(new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(first.length).toBeGreaterThan(0);
    expect(await grain()).toEqual(first);

    const { rows } = await api.sql.query<{
      family: string;
      last_filled_day: string;
      cursor: string | null;
    }>(
      `select family, to_char(last_filled_day, 'YYYY-MM-DD') as last_filled_day,
              to_char(backfill_cursor, 'YYYY-MM-DD') as cursor
         from ${SCHEMA_NAME}.metric_rollup_state where organization_id = $1 order by family`,
      [ORG],
    );

    expect(rows).toHaveLength(ROLLUP_EXTRACTORS.length);
    expect(
      rows.every((row) => row.last_filled_day === addDays("2026-09-01", -1) && row.cursor === null),
    ).toBe(true);
  });

  it("resumes an interrupted backfill at its cursor, without gaps or double-counting", async () => {
    await rollups.backfill(ORG, "throughput", D1, D3, NOW);
    const clean = await grain();

    await api.sql.query(`delete from ${SCHEMA_NAME}.metric_daily`);
    await api.sql.query(`delete from ${SCHEMA_NAME}.metric_rollup_state`);

    // The deploy lands mid-range: D2's fill dies after D1 committed.
    const extract = throughputExtractor.extract.bind(throughputExtractor);
    const spy = jest.spyOn(throughputExtractor, "extract").mockImplementation((db, org, day) => {
      if (day === D2) {
        return Promise.reject(new Error("deploy interrupted the fill"));
      }

      return extract(db, org, day);
    });

    const interrupted = await rollups.backfill(ORG, "throughput", D1, D3, NOW);

    expect(interrupted).toEqual(
      expect.objectContaining({
        status: "failed",
        backfilledDays: 1,
        error: "deploy interrupted the fill",
      }),
    );

    const cursor = await one<{ cursor: string; status: string; last_error: string }>(
      `select to_char(backfill_cursor, 'YYYY-MM-DD') as cursor, last_run_status as status, last_error
         from ${SCHEMA_NAME}.metric_rollup_state where organization_id = $1 and family = 'throughput'`,
      [ORG],
    );

    expect(cursor).toEqual({
      cursor: D2,
      status: "failed",
      last_error: "deploy interrupted the fill",
    });

    spy.mockRestore();

    // The next tick resumes at D2 — it does not start over, and it does not skip.
    await rollups.tick(NOW);

    const { rows } = await api.sql.query(
      `select organization_id, repo_ref, metric_id, dimension, to_char(day, 'YYYY-MM-DD') as day,
              value, numerator, denominator, meta
         from ${SCHEMA_NAME}.metric_daily
        where organization_id = $1 and metric_id = any($2::text[]) and day between $3 and $4
        order by 1, 2, 3, 4, 5`,
      [ORG, Object.keys(throughputExtractor.metrics), D1, D3],
    );

    expect(rows).toEqual(clean);
  });

  it("detects reverts by both patterns, after the merge, in the same repository — and not the near-miss", async () => {
    await fillFixtureDays();

    // D1 helios: #102 reverted by a loop's `revert:` commit; #101's only reverts are in another
    // repository or before its merge. D2 zephyr: #104 reverted by `Revert "…" (#104)`. D2 helios:
    // #106 "Docs typo" is not reverted by "Reverted docs typo".
    expect(await rolledUp("change_failure_rate", D1, D1)).toEqual(
      new Map([[windowKey(HELIOS, ""), { numerator: 1, denominator: 2 }]]),
    );
    expect(await rolledUp("change_failure_rate", D2, D2)).toEqual(
      new Map([
        [windowKey(HELIOS, ""), { numerator: 0, denominator: 1 }],
        [windowKey(ZEPHYR, ""), { numerator: 1, denominator: 1 }],
      ]),
    );
  });

  it("implements I6 exactly — a PR with a human push is not untouched", async () => {
    await fillFixtureDays();

    expect(await rolledUp("merged_untouched_rate", D1, D2)).toEqual(
      new Map([
        [windowKey(HELIOS, ""), { numerator: 2, denominator: 3 }],
        [windowKey(ZEPHYR, ""), { numerator: 1, denominator: 1 }],
      ]),
    );
    expect(await rolledUp("merge_rate", D1, D1)).toEqual(
      new Map([[windowKey(HELIOS, ""), { numerator: 1, denominator: 3 }]]),
    );
    // R2's secrets stop (failed twice — one stop) and R3's handoff: neither has a record the cause
    // rules map, so both are `other` (#434) — recorded, not dropped.
    expect(await rolledUp("human_interventions", D1, D1)).toEqual(
      new Map([[windowKey(HELIOS, "other"), { value: 2 }]]),
    );
  });

  it("keeps priced and unpriced usage separable — no cost row is not a $0 row", async () => {
    await fillFixtureDays();

    expect(await rolledUp("tokens", D2, D2)).toEqual(
      new Map([
        [windowKey(HELIOS, ""), { value: 200 }],
        [windowKey(ZEPHYR, ""), { value: 3000 }],
      ]),
    );
    expect(await rolledUp("unpriced_tokens", D2, D2)).toEqual(
      new Map([
        [windowKey(HELIOS, ""), { value: 0 }],
        [windowKey(ZEPHYR, ""), { value: 3000 }],
      ]),
    );
    // Helios spent a real $0; zephyr's cost is unknown, so it has no row at all.
    expect(await rolledUp("cost_cents", D2, D2)).toEqual(
      new Map([[windowKey(HELIOS, ""), { value: 0 }]]),
    );
    expect(await rolledUp("cost_cents", D1, D1)).toEqual(
      new Map([[windowKey(HELIOS, ""), { value: 912.5 }]]),
    );
  });

  it("writes suite-dimensioned failure rows for the failures-by-suite card", async () => {
    await fillFixtureDays();

    expect(await rolledUp("test_failures_by_suite", D1, D3)).toEqual(
      new Map([
        [windowKey(HELIOS, "telemetry integration"), { value: 2 }],
        [windowKey(ZEPHYR, "unit"), { value: 1 }],
      ]),
    );
    expect(await rolledUp("stage_duration", D1, D1)).toEqual(
      new Map([
        [windowKey(HELIOS, "analyze"), { value: 60_000 }],
        [windowKey(HELIOS, "implement"), { value: 1_080_000 }],
        [windowKey(HELIOS, "test"), { value: 160_000 }],
      ]),
    );
  });
});
