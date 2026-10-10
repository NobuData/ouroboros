/**
 * What the telemetry tool reads (CL.6, [#619](https://github.com/NobuData/ouroboros/issues/619)).
 *
 * Five statements over planes that already exist — HIL measurements (V053), case history and
 * flake scores (V054), runs and token usage, and the regression baselines a release captured
 * (V115). The insights plane is read through its own service, `MetricsService.span()`, so its
 * figures are the Insights page's by construction.
 *
 * **Read-only, and that is structural.** Every statement here is a `select`; there is no insert,
 * update, delete or function call that writes, and `telemetry.repository.spec.ts` fails the file
 * the day one appears. **Every statement names the workspace**, so a query about another
 * workspace's case key or repository finds nothing — the designed answer, not a refusal.
 *
 * Nothing is filled in. A day with no runs is absent from a series, not a zero; a window with no
 * measurements is an empty array, and the tool turns that into its no-data record.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { SCHEMA_NAME } from "../../db/schema";

/** The most measurements one window reads. Far above any real window; a guard, not a page. */
export const MAX_SAMPLES = 20_000;

/** One HIL measurement of a case metric. */
export interface MeasurementSample {
  readonly value: number;
  readonly unit: string;
  readonly verdict: "pass" | "fail";
  /** When the test run that took it started. */
  readonly at: Date;
}

/** A release's captured baseline for a metric (V115's `window` document). */
export interface StoredBaseline {
  readonly releaseTag: string;
  readonly n: number;
  readonly median: number;
  readonly spread: number;
  readonly spreadKind: string;
  readonly unit: string;
  /** The window it was captured over. */
  readonly from: string;
  readonly to: string;
}

/** A case's — or a suite's — history over a window. */
export interface CaseHistoryRow {
  /** Observations: one per case per test run. */
  readonly runs: number;
  /** Distinct cases observed. */
  readonly cases: number;
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
  readonly errored: number;
  /** Retries across every observation. */
  readonly retries: number;
  readonly firstObservedAt: Date | null;
  readonly lastObservedAt: Date | null;
}

/** The flake scorer's current verdict on the cases a history covers. */
export interface FlakeContext {
  /** Cases with a score. */
  readonly scored: number;
  /** The highest score among them, 0–1; `null` when none is scored. */
  readonly maxScore: number | null;
  readonly healthy: number;
  readonly watching: number;
  readonly quarantined: number;
  /** When the most recent of them was scored. */
  readonly lastScoredAt: Date | null;
}

/** One UTC day of runs. */
export interface RunDay {
  readonly day: string;
  /** Runs started that day. */
  readonly started: number;
  readonly merged: number;
  readonly failed: number;
  readonly needsHuman: number;
}

/** One UTC day of token usage. */
export interface TokenDay {
  readonly day: string;
  /** Model calls recorded. */
  readonly events: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** The priced cost; `null` when no call that day carried a price. */
  readonly costCents: number | null;
  /** Calls with no price — the part of the day the cost does not cover. */
  readonly unpricedEvents: number;
}

/** What the workspace holds, for the tool's card and its health. */
export interface TelemetrySummary {
  readonly measurements: number;
  readonly cases: number;
  readonly metrics: number;
  readonly baselines: number;
}

/** Who a history is about. */
export type HistorySubject =
  | { readonly kind: "case"; readonly caseKey: string }
  | { readonly kind: "suite"; readonly suite: string };

/** A half-open stretch of time. */
export interface Stretch {
  readonly from: Date;
  readonly to: Date;
}

@Injectable()
export class TelemetryRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The HIL measurements of one case metric taken in a window.
   *
   * @param organizationId - The workspace.
   * @param caseKey - The durable case key (V051).
   * @param measurement - The measurement's name (V053), e.g. `overshoot_pct`.
   * @param window - `[from, to)`, by the start of the test run that took the measurement.
   * @param repo - `owner/name` to keep to one repository, or `null`.
   * @returns The samples, oldest first; empty when nothing was measured.
   */
  async measurements(
    organizationId: string,
    caseKey: string,
    measurement: string,
    window: Stretch,
    repo: string | null,
  ): Promise<MeasurementSample[]> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{ value: string; unit: string; verdict: "pass" | "fail"; at: Date }>`
      select m.value, m.unit, m.verdict, tr.started_at as at
        from ${schema}.hil_measurements m
        join ${schema}.test_cases c on c.id = m.test_case_id and c.organization_id = m.organization_id
        join ${schema}.test_suites s on s.id = c.test_suite_id and s.organization_id = c.organization_id
        join ${schema}.test_runs tr on tr.id = s.test_run_id and tr.organization_id = s.organization_id
        join ${schema}.runs r on r."id" = tr.run_id and r.organization_id = tr.organization_id
       where m.organization_id = ${organizationId}
         and c.case_key = ${caseKey}
         and m.metric = ${measurement}
         and tr.started_at >= ${window.from}
         and tr.started_at < ${window.to}
         and (${repo}::text is null or r.github_repo_id in (${this.repositories(organizationId, repo)}))
       order by tr.started_at, m.id
       limit ${MAX_SAMPLES}
    `.execute(this.database.db);

    return rows.map((row) => ({ ...row, value: Number(row.value) }));
  }

  /**
   * The baseline a release captured for a metric.
   *
   * @param organizationId - The workspace.
   * @param metricKey - The metric's key — an insights metric id, or `<case key>:<measurement>`.
   * @param releaseTag - The release.
   * @returns The most recently captured baseline for that pair, or `undefined` when none exists.
   */
  async baseline(
    organizationId: string,
    metricKey: string,
    releaseTag: string,
  ): Promise<StoredBaseline | undefined> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      release_tag: string;
      window: {
        n: number;
        median: number;
        spread: number;
        spread_kind: string;
        unit: string;
        from: string;
        to: string;
      };
    }>`
      select b.release_tag, b."window"
        from ${schema}.regression_baselines b
       where b.organization_id = ${organizationId}
         and b.metric_key = ${metricKey}
         and b.release_tag = ${releaseTag}
       order by b.captured_at desc, b.id
       limit 1
    `.execute(this.database.db);
    const row = rows[0] as (typeof rows)[number] | undefined;

    if (row === undefined) return undefined;

    return {
      releaseTag: row.release_tag,
      n: Number(row.window.n),
      median: Number(row.window.median),
      spread: Number(row.window.spread),
      spreadKind: row.window.spread_kind,
      unit: row.window.unit,
      from: row.window.from,
      to: row.window.to,
    };
  }

  /**
   * A case's, or a suite's, results over a window.
   *
   * @param organizationId - The workspace.
   * @param subject - One case by its key, or every case of a suite by the suite's name.
   * @param window - `[from, to)`, by when each result was observed.
   * @param repo - `owner/name` to keep to one repository, or `null`.
   * @returns The counts. `runs` is 0 when nothing was observed.
   */
  async caseHistory(
    organizationId: string,
    subject: HistorySubject,
    window: Stretch,
    repo: string | null,
  ): Promise<CaseHistoryRow> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      runs: string;
      cases: string;
      passed: string;
      failed: string;
      flaky: string;
      skipped: string;
      errored: string;
      retries: string | null;
      first_observed_at: Date | null;
      last_observed_at: Date | null;
    }>`
      select count(*) as runs,
             count(distinct h.case_key) as cases,
             count(*) filter (where h.status = 'passed') as passed,
             count(*) filter (where h.status = 'failed') as failed,
             count(*) filter (where h.status = 'flaky') as flaky,
             count(*) filter (where h.status = 'skipped') as skipped,
             count(*) filter (where h.status = 'error') as errored,
             sum(h.retries) as retries,
             min(h.observed_at) as first_observed_at,
             max(h.observed_at) as last_observed_at
        from ${schema}.test_case_history h
       where h.organization_id = ${organizationId}
         and h.observed_at >= ${window.from}
         and h.observed_at < ${window.to}
         and ${this.subjectMatches(organizationId, subject)}
         and (${repo}::text is null or h.github_repo_id in (${this.repositories(organizationId, repo)}))
    `.execute(this.database.db);
    const row = rows[0];

    return {
      runs: Number(row.runs),
      cases: Number(row.cases),
      passed: Number(row.passed),
      failed: Number(row.failed),
      flaky: Number(row.flaky),
      skipped: Number(row.skipped),
      errored: Number(row.errored),
      retries: Number(row.retries ?? 0),
      firstObservedAt: row.first_observed_at,
      lastObservedAt: row.last_observed_at,
    };
  }

  /**
   * The flake scorer's current verdict on the cases a history covered.
   *
   * It is the score **as it stands now**, not as it stood in the window: the scorer keeps one
   * row per case. The tool says so beside the figure.
   *
   * @param organizationId - The workspace.
   * @param subject - The case, or the suite.
   * @param window - The window whose observed cases are looked up.
   * @param repo - `owner/name`, or `null`.
   * @returns The scored cases by state, and the highest score.
   */
  async flakeContext(
    organizationId: string,
    subject: HistorySubject,
    window: Stretch,
    repo: string | null,
  ): Promise<FlakeContext> {
    const schema = sql.id(SCHEMA_NAME);
    // Grouped by state rather than counted per named state: the scorer is the only code that
    // spells a flake state beside an equals sign (`flakes.quarantine.spec.ts`, #331), and a read
    // has no need to.
    const { rows } = await sql<{
      state: string;
      scored: string;
      max_score: string | null;
      last_scored_at: Date | null;
    }>`
      select f.state,
             count(*) as scored,
             max(f.score) as max_score,
             max(f.last_scored_at) as last_scored_at
        from ${schema}.flake_scores f
       where f.organization_id = ${organizationId}
         and f.case_key in (
               select h.case_key
                 from ${schema}.test_case_history h
                where h.organization_id = ${organizationId}
                  and h.observed_at >= ${window.from}
                  and h.observed_at < ${window.to}
                  and ${this.subjectMatches(organizationId, subject)}
                  and (${repo}::text is null
                       or h.github_repo_id in (${this.repositories(organizationId, repo)})))
       group by f.state
    `.execute(this.database.db);
    const count = (state: string): number =>
      rows
        .filter((row) => row.state === state)
        .reduce((total, row) => total + Number(row.scored), 0);
    const scores = rows.flatMap((row) => (row.max_score === null ? [] : [Number(row.max_score)]));
    const scoredAt = rows.flatMap((row) =>
      row.last_scored_at === null ? [] : [row.last_scored_at.getTime()],
    );

    return {
      scored: rows.reduce((total, row) => total + Number(row.scored), 0),
      maxScore: scores.length === 0 ? null : Math.max(...scores),
      healthy: count("healthy"),
      watching: count("watching"),
      quarantined: count("quarantined"),
      lastScoredAt: scoredAt.length === 0 ? null : new Date(Math.max(...scoredAt)),
    };
  }

  /**
   * Runs started per UTC day in a window. A day with no run is absent, not zero.
   *
   * @param organizationId - The workspace.
   * @param window - `[from, to)`, by when a run started.
   * @param repo - `owner/name`, or `null`.
   * @returns The days that had runs, oldest first.
   */
  async runDays(organizationId: string, window: Stretch, repo: string | null): Promise<RunDay[]> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      day: string;
      started: string;
      merged: string;
      failed: string;
      needs_human: string;
    }>`
      select to_char(date_trunc('day', r.started_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*) as started,
             count(*) filter (where r.status = 'merged') as merged,
             count(*) filter (where r.status = 'failed') as failed,
             count(*) filter (where r.status = 'needs_human') as needs_human
        from ${schema}.runs r
       where r.organization_id = ${organizationId}
         and not r.simulated
         and r.started_at >= ${window.from}
         and r.started_at < ${window.to}
         and (${repo}::text is null or r.github_repo_id in (${this.repositories(organizationId, repo)}))
       group by 1
       order by 1
    `.execute(this.database.db);

    return rows.map((row) => ({
      day: row.day,
      started: Number(row.started),
      merged: Number(row.merged),
      failed: Number(row.failed),
      needsHuman: Number(row.needs_human),
    }));
  }

  /**
   * Token usage per UTC day in a window. A day with no usage is absent, not zero.
   *
   * @param organizationId - The workspace.
   * @param window - `[from, to)`, by when the usage occurred.
   * @param repo - `owner/name` to keep to the usage of that repository's runs, or `null` for
   *   all usage, including calls that belong to no run.
   * @returns The days that had usage, oldest first.
   */
  async tokenDays(
    organizationId: string,
    window: Stretch,
    repo: string | null,
  ): Promise<TokenDay[]> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      day: string;
      events: string;
      tokens_in: string;
      tokens_out: string;
      cost_cents: string | null;
      unpriced_events: string;
    }>`
      select to_char(date_trunc('day', u.occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*) as events,
             sum(u.tokens_in) as tokens_in,
             sum(u.tokens_out) as tokens_out,
             sum(u.cost_cents) as cost_cents,
             count(*) filter (where u.cost_cents is null) as unpriced_events
        from ${schema}.token_usage u
       where u.organization_id = ${organizationId}
         and u.occurred_at >= ${window.from}
         and u.occurred_at < ${window.to}
         and (${repo}::text is null
              or u.run_id in (select r."id" from ${schema}.runs r
                               where r.organization_id = ${organizationId}
                                 and r.github_repo_id in (${this.repositories(organizationId, repo)})))
       group by 1
       order by 1
    `.execute(this.database.db);

    return rows.map((row) => ({
      day: row.day,
      events: Number(row.events),
      tokensIn: Number(row.tokens_in),
      tokensOut: Number(row.tokens_out),
      costCents: row.cost_cents === null ? null : Number(row.cost_cents),
      unpricedEvents: Number(row.unpriced_events),
    }));
  }

  /**
   * What the workspace holds — the tool card's counts.
   *
   * @param organizationId - The workspace.
   * @returns HIL measurements, cases with history, insights metrics with any recorded day, and
   *   captured baselines.
   */
  async summary(organizationId: string): Promise<TelemetrySummary> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      measurements: string;
      cases: string;
      metrics: string;
      baselines: string;
    }>`
      select (select count(*) from ${schema}.hil_measurements m
               where m.organization_id = ${organizationId}) as measurements,
             (select count(distinct h.case_key) from ${schema}.test_case_history h
               where h.organization_id = ${organizationId}) as cases,
             (select count(distinct d.metric_id) from ${schema}.metric_daily d
               where d.organization_id = ${organizationId}) as metrics,
             (select count(*) from ${schema}.regression_baselines b
               where b.organization_id = ${organizationId}) as baselines
    `.execute(this.database.db);
    const row = rows[0];

    return {
      measurements: Number(row.measurements),
      cases: Number(row.cases),
      metrics: Number(row.metrics),
      baselines: Number(row.baselines),
    };
  }

  /**
   * The ids of the workspace's repositories called `owner/name` — a subquery, so a name the
   * workspace does not mirror matches no row rather than raising.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, compared without regard to case; `null` matches nothing.
   * @returns The subquery.
   */
  private repositories(organizationId: string, repo: string | null) {
    const schema = sql.id(SCHEMA_NAME);

    return sql`
      select gr.id
        from ${schema}.github_repos gr
        join ${schema}.github_orgs go on go.id = gr.org_id
       where go.organization_id = ${organizationId}
         and lower(go.login || '/' || gr.name) = lower(${repo}::text)`;
  }

  /**
   * The predicate that keeps `test_case_history h` to a subject.
   *
   * @param organizationId - The workspace.
   * @param subject - One case, or a suite by name.
   * @returns The predicate.
   */
  private subjectMatches(organizationId: string, subject: HistorySubject) {
    const schema = sql.id(SCHEMA_NAME);

    return subject.kind === "case"
      ? sql<boolean>`h.case_key = ${subject.caseKey}`
      : sql<boolean>`h.test_case_id in (
            select c.id
              from ${schema}.test_cases c
              join ${schema}.test_suites s
                on s.id = c.test_suite_id and s.organization_id = c.organization_id
             where c.organization_id = ${organizationId}
               and s.name = ${subject.suite})`;
  }
}
