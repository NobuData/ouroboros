/**
 * The oracle twins — every rollup metric computed on the fly, straight from its source planes, over
 * a whole window (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433), decision **I2**).
 *
 * A rollup is a cache of a computation, and this file is the computation. `rollup.integration-spec.ts`
 * fills the daily grain through the extractors, re-derives each window from `metric_daily` the way
 * a reader must — summing values, re-summing rate components, pooling median samples — and requires
 * the result to equal what the twin here computes directly. If the two disagree, CI fails.
 *
 * **The twins are written independently of the extractors on purpose.** They share no SQL with
 * `extractors/` (a shared fragment would make the check compare a query with itself), they work on
 * the window rather than on days, and where an extractor decides something in TypeScript — revert
 * detection, MTTR's streaks, a median — the twin decides it in SQL: regular expressions, window
 * functions, `percentile_cont`. Only the definitions are shared, and those are the registry's.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import type { Pool } from "pg";

import type { MetricAggregation } from "../../db/schema";
import { addDays } from "./rollup.days";
import type { Day } from "./rollup.types";

/** A window's value for one (repository, dimension): a number, or a rate's components. */
export type WindowValue = { value: number } | { numerator: number; denominator: number };

/** A window's values, keyed by {@link windowKey}. */
export type WindowValues = Map<string, WindowValue>;

/** One twin: the metric over `[from, to]` (whole UTC days), per repository and dimension. */
type Oracle = (sql: Pool, organizationId: string, from: Date, to: Date) => Promise<WindowValues>;

/** A grouped row as the twins and the re-derivation return it. */
interface GroupRow {
  repo_ref: string;
  dimension: string;
  value?: string | number | null;
  numerator?: string | number | null;
  denominator?: string | number | null;
}

/**
 * The key a window value is filed under.
 *
 * @param repoRef - The repository.
 * @param dimension - The dimension, `""` when none.
 * @returns `repo|dimension`.
 */
export function windowKey(repoRef: string, dimension: string): string {
  return `${repoRef}|${dimension}`;
}

/**
 * Run a grouped statement and file its rows.
 *
 * @param sql - The suite's pool.
 * @param text - The statement: `$1` the workspace, `$2` the window's first instant, `$3` the
 *   instant after its last.
 * @param params - Those three.
 * @returns The values; a rate row with no denominator is left out, as the grain would leave it.
 */
async function grouped(sql: Pool, text: string, params: unknown[]): Promise<WindowValues> {
  const { rows } = await sql.query<GroupRow>(text, params);
  const out: WindowValues = new Map();

  for (const row of rows) {
    const key = windowKey(row.repo_ref, row.dimension);

    if (row.denominator !== undefined) {
      if (Number(row.denominator) > 0) {
        out.set(key, {
          numerator: Number(row.numerator ?? 0),
          denominator: Number(row.denominator),
        });
      }
    } else if (row.value !== null && row.value !== undefined) {
      out.set(key, { value: Number(row.value) });
    }
  }

  return out;
}

/** `login/name` of the repository joined as `gr`/`go`. */
const REPO = `go.login || '/' || gr.name`;

/** Join a run (`r`) to its repository. */
const RUN_REPO = `join ouroboros.github_repos gr on gr.id = r.github_repo_id
                  join ouroboros.github_orgs go on go.id = gr.org_id`;

/** Join a build job (`b`) to its repository. */
const JOB_REPO = `join ouroboros.github_repos gr on gr.id = b.github_repo_id
                  join ouroboros.github_orgs go on go.id = gr.org_id`;

/** Loop PRs merged in the window, with their run and repository. */
const MERGED_LOOP_PRS = `
  select pr.*, r.started_at as run_started_at, r.status as run_status, ${REPO} as repo
    from ouroboros.pull_requests pr
    join ouroboros.runs r on r.id = pr.run_id
    ${RUN_REPO}
   where pr.organization_id = $1 and pr.state = 'merged'
     and pr.merged_at >= $2 and pr.merged_at < $3`;

/** Elapsed whole milliseconds between two timestamps, never negative. */
function elapsedMs(from: string, to: string): string {
  return `greatest(0, floor(extract(epoch from (${to} - ${from})) * 1000))`;
}

/**
 * The text a revert names, in SQL — the twin of `revert.detection.ts`, written as regular
 * expressions over the first line of `text`.
 *
 * @param text - An SQL expression yielding a title or commit message.
 * @returns An SQL expression yielding the reverted title, or null.
 */
function revertTarget(text: string): string {
  const line = `btrim(split_part(${text}, E'\\n', 1), E' \\t\\r')`;
  const raw = `coalesce(substring(${line} from '^Revert "(.+)"(?: \\(#[0-9]+\\))?$'),
                        substring(${line} from '^[Rr][Ee][Vv][Ee][Rr][Tt]:\\s*(.+)$'))`;

  return `nullif(btrim(regexp_replace(${raw}, ' \\(#[0-9]+\\)$', '')), '')`;
}

/** Every metric's twin. */
export const ORACLES: Readonly<Record<string, Oracle>> = {
  merged_prs: (sql, org, from, to) =>
    grouped(
      sql,
      `select repo as repo_ref, '' as dimension, count(*) as value
                    from (${MERGED_LOOP_PRS}) m group by repo`,
      [org, from, to],
    ),

  merge_rate: (sql, org, from, to) =>
    grouped(
      sql,
      `select repo as repo_ref, '' as dimension,
              sum(case when autonomous then 1 else 0 end) as numerator, count(*) as denominator
         from (select ${REPO} as repo,
                      pr.state = 'merged' and r.status = 'merged'
                        and (select count(*) from ouroboros.guardrail_evaluations g
                              where g.run_id = r.id and g.verdict = 'fail') = 0 as autonomous
                 from ouroboros.pull_requests pr
                 join ouroboros.runs r on r.id = pr.run_id
                 ${RUN_REPO}
                where pr.organization_id = $1
                  and case pr.state
                        when 'merged' then pr.merged_at >= $2 and pr.merged_at < $3
                        when 'closed' then r.finished_at >= $2 and r.finished_at < $3
                        else false
                      end) closed
        group by repo`,
      [org, from, to],
    ),

  merged_untouched_rate: (sql, org, from, to) =>
    grouped(
      sql,
      `select repo as repo_ref, '' as dimension,
              count(*) filter (where human_pushes = 0) as numerator, count(*) as denominator
         from (select m.repo,
                      (select count(*) from ouroboros.pr_revisions v
                        where v.pr_id = m.id
                          and v.head_sha not in (select c.sha from ouroboros.run_commits c
                                                  where c.run_id = m.run_id)) as human_pushes
                 from (${MERGED_LOOP_PRS}) m) graded
        group by repo`,
      [org, from, to],
    ),

  human_interventions: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, e.cause as dimension, count(*) as value
         from ouroboros.intervention_events e
         join ouroboros.runs r on r.id = e.run_id
         ${RUN_REPO}
        where e.organization_id = $1 and e.detected_at >= $2 and e.detected_at < $3
        group by 1, 2`,
      [org, from, to],
    ),

  cycle_time: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension,
              percentile_cont(0.5) within group (order by ${elapsedMs("r.started_at", "r.finished_at")}) as value
         from ouroboros.runs r
         ${RUN_REPO}
        where r.organization_id = $1 and r.status = 'merged'
          and r.finished_at >= $2 and r.finished_at < $3
        group by 1`,
      [org, from, to],
    ),

  stage_duration: (sql, org, from, to) =>
    grouped(
      sql,
      `select repo as repo_ref, stage_key as dimension,
              percentile_cont(0.5) within group (order by ms) as value
         from (select ${REPO} as repo, s.stage_key,
                      sum(${elapsedMs("s.started_at", "s.finished_at")}) as ms
                 from ouroboros.runs r
                 join ouroboros.run_stages s on s.run_id = r.id
                 ${RUN_REPO}
                where r.organization_id = $1 and r.status = 'merged'
                  and r.finished_at >= $2 and r.finished_at < $3
                  and s.started_at is not null and s.finished_at is not null
                group by 1, r.id, s.stage_key) per_loop
        group by repo, stage_key`,
      [org, from, to],
    ),

  cost_cents: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, sum(tu.cost_cents) as value
         from ouroboros.token_usage tu
         join ouroboros.runs r on r.id = tu.run_id
         ${RUN_REPO}
        where tu.organization_id = $1 and tu.cost_cents is not null
          and tu.occurred_at >= $2 and tu.occurred_at < $3
        group by 1`,
      [org, from, to],
    ),

  tokens: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, sum(tu.tokens_in + tu.tokens_out) as value
         from ouroboros.token_usage tu
         join ouroboros.runs r on r.id = tu.run_id
         ${RUN_REPO}
        where tu.organization_id = $1 and tu.occurred_at >= $2 and tu.occurred_at < $3
        group by 1`,
      [org, from, to],
    ),

  unpriced_tokens: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, sum(tu.tokens_in + tu.tokens_out) as value
         from ouroboros.token_usage tu
         join ouroboros.runs r on r.id = tu.run_id
         ${RUN_REPO}
        where tu.organization_id = $1 and tu.cost_cents is null
          and tu.occurred_at >= $2 and tu.occurred_at < $3
        group by 1`,
      [org, from, to],
    ),

  cost_per_merged_pr: (sql, org, from, to) =>
    grouped(
      sql,
      `select spend.repo as repo_ref, '' as dimension, spend.cents as numerator, merged.n as denominator
         from (select ${REPO} as repo, sum(tu.cost_cents) as cents
                 from ouroboros.token_usage tu
                 join ouroboros.runs r on r.id = tu.run_id
                 ${RUN_REPO}
                where tu.organization_id = $1 and tu.cost_cents is not null
                  and tu.occurred_at >= $2 and tu.occurred_at < $3
                group by 1) spend
         join (select repo, count(*) as n from (${MERGED_LOOP_PRS}) m group by repo) merged
           on merged.repo = spend.repo`,
      [org, from, to],
    ),

  builds: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, count(*) as value
         from ouroboros.build_jobs b
         ${JOB_REPO}
        where b.organization_id = $1 and b.status in ('succeeded', 'failed', 'retried')
          and b.finished_at >= $2 and b.finished_at < $3
        group by 1`,
      [org, from, to],
    ),

  build_failures: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, count(*) as value
         from ouroboros.build_jobs b
         ${JOB_REPO}
        where b.organization_id = $1 and b.status in ('failed', 'retried')
          and b.finished_at >= $2 and b.finished_at < $3
        group by 1`,
      [org, from, to],
    ),

  build_success_rate: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension,
              sum((b.status = 'succeeded')::int) as numerator, count(*) as denominator
         from ouroboros.build_jobs b
         ${JOB_REPO}
        where b.organization_id = $1 and b.status in ('succeeded', 'failed', 'retried')
          and b.finished_at >= $2 and b.finished_at < $3
        group by 1`,
      [org, from, to],
    ),

  test_cases_run: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, sum(s.total - s.skipped) as value
         from ouroboros.test_suites s
         join ouroboros.test_runs t on t.id = s.test_run_id
         join ouroboros.runs r on r.id = t.run_id
         ${RUN_REPO}
        where t.organization_id = $1 and t.status in ('complete', 'error')
          and t.started_at >= $2 and t.started_at < $3
        group by 1`,
      [org, from, to],
    ),

  test_pass_rate: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension,
              sum(s.total - s.skipped - s.failed) as numerator, sum(s.total - s.skipped) as denominator
         from ouroboros.test_suites s
         join ouroboros.test_runs t on t.id = s.test_run_id
         join ouroboros.runs r on r.id = t.run_id
         ${RUN_REPO}
        where t.organization_id = $1 and t.status in ('complete', 'error')
          and t.started_at >= $2 and t.started_at < $3
        group by 1`,
      [org, from, to],
    ),

  test_failures_by_suite: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, btrim(left(btrim(s.name), 200)) as dimension, sum(s.failed) as value
         from ouroboros.test_suites s
         join ouroboros.test_runs t on t.id = s.test_run_id
         join ouroboros.runs r on r.id = t.run_id
         ${RUN_REPO}
        where t.organization_id = $1 and t.status in ('complete', 'error')
          and t.started_at >= $2 and t.started_at < $3
        group by 1, 2
       having sum(s.failed) > 0`,
      [org, from, to],
    ),

  completion_time_by_effort: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, eo.predicted_effort as dimension,
              percentile_cont(0.5) within group (order by greatest(0, eo.actual_duration_ms)) as value
         from ouroboros.estimate_outcomes eo
         join ouroboros.pull_requests pr on pr.id = eo.pr_id
         join ouroboros.runs r on r.id = pr.run_id
         ${RUN_REPO}
        where eo.organization_id = $1 and eo.predicted_effort is not null
          and eo.merged_at >= $2 and eo.merged_at < $3
        group by 1, 2`,
      [org, from, to],
    ),

  deploy_frequency: (sql, org, from, to) =>
    grouped(
      sql,
      `select ${REPO} as repo_ref, '' as dimension, count(*) as value
         from ouroboros.build_jobs b
         ${JOB_REPO}
        where b.organization_id = $1 and b.status = 'succeeded'
          and b.finished_at >= $2 and b.finished_at < $3
          and regexp_replace(b.git_ref, '^refs/heads/', '') = gr.default_branch
        group by 1`,
      [org, from, to],
    ),

  lead_time: (sql, org, from, to) =>
    grouped(
      sql,
      `select repo as repo_ref, '' as dimension,
              sum(${elapsedMs("m.run_started_at", "m.merged_at")}) as numerator, count(*) as denominator
         from (${MERGED_LOOP_PRS}) m
        group by repo`,
      [org, from, to],
    ),

  change_failure_rate: (sql, org, from, to) =>
    grouped(
      sql,
      `with reverts as (
         select ${revertTarget("p.title")} as target, p.merged_at as at,
                regexp_replace(p.external_url, '/(pull|-/merge_requests)/[0-9]+.*$', '') as repo_url,
                null::text as repo
           from ouroboros.pull_requests p
          where p.organization_id = $1 and p.state = 'merged'
         union all
         select ${revertTarget("c.message")}, c.committed_at, null, ${REPO}
           from ouroboros.run_commits c
           join ouroboros.runs r on r.id = c.run_id
           ${RUN_REPO}
          where r.organization_id = $1
       )
       select m.repo as repo_ref, '' as dimension,
              count(*) filter (where exists (
                select 1 from reverts v
                 where v.target = btrim(m.title) and v.at > m.merged_at
                   and (v.repo = m.repo
                        or v.repo_url = regexp_replace(m.external_url,
                                                       '/(pull|-/merge_requests)/[0-9]+.*$', ''))
              )) as numerator,
              count(*) as denominator
         from (${MERGED_LOOP_PRS}) m
        group by m.repo`,
      [org, from, to],
    ),

  mttr: (sql, org, from, to) =>
    grouped(
      sql,
      `with jobs as (
         select b.run_id, ${REPO} as repo, b.status, b.finished_at,
                count(*) filter (where b.status = 'succeeded')
                  over (partition by b.run_id order by b.finished_at, b.number
                        rows between unbounded preceding and 1 preceding) as greens_before
           from ouroboros.build_jobs b
           ${JOB_REPO}
          where b.organization_id = $1 and b.run_id is not null
            and b.status in ('succeeded', 'failed', 'retried')
       ),
       streaks as (
         select run_id, greens_before, min(finished_at) as first_red
           from jobs where status <> 'succeeded' group by run_id, greens_before
       )
       select g.repo as repo_ref, '' as dimension,
              sum(${elapsedMs("s.first_red", "g.finished_at")}) as numerator, count(*) as denominator
         from jobs g
         join streaks s on s.run_id = g.run_id and s.greens_before = g.greens_before
        where g.status = 'succeeded' and g.finished_at >= $2 and g.finished_at < $3
        group by g.repo`,
      [org, from, to],
    ),
};

/**
 * A window re-derived from the daily grain, the way a reader must — V078's aggregation rule.
 *
 * @param sql - The suite's pool.
 * @param organizationId - The workspace.
 * @param metricId - The metric.
 * @param aggregation - Its registry aggregation.
 * @param from - The window's first day.
 * @param to - Its last day, inclusive.
 * @returns The window per (repository, dimension).
 */
export function rewindow(
  sql: Pool,
  organizationId: string,
  metricId: string,
  aggregation: MetricAggregation,
  from: Day,
  to: Day,
): Promise<WindowValues> {
  const where = `d.organization_id = $1 and d.metric_id = $4 and d.day >= $2::date and d.day <= $3::date`;
  const params = [organizationId, from, to, metricId];

  switch (aggregation) {
    case "sum":
      return grouped(
        sql,
        `select d.repo_ref, d.dimension, sum(d.value) as value
                             from ouroboros.metric_daily d where ${where}
                            group by 1, 2`,
        params,
      );
    case "ratio":
      return grouped(
        sql,
        `select d.repo_ref, d.dimension,
                                  sum(d.numerator) as numerator, sum(d.denominator) as denominator
                             from ouroboros.metric_daily d where ${where}
                            group by 1, 2`,
        params,
      );
    case "median":
      return grouped(
        sql,
        `select d.repo_ref, d.dimension,
                                  percentile_cont(0.5) within group (order by s::numeric) as value
                             from ouroboros.metric_daily d,
                                  jsonb_array_elements_text(d.meta -> 'samples') s
                            where ${where}
                            group by 1, 2`,
        params,
      );
  }
}

/**
 * Twin a metric over whole UTC days.
 *
 * @param sql - The suite's pool.
 * @param organizationId - The workspace.
 * @param metricId - The metric; must have a twin.
 * @param from - The window's first day.
 * @param to - Its last day, inclusive.
 * @returns The twin's window.
 * @throws {Error} When the metric has no twin — every rolled-up metric must.
 */
export function oracle(
  sql: Pool,
  organizationId: string,
  metricId: string,
  from: Day,
  to: Day,
): Promise<WindowValues> {
  const twin = ORACLES[metricId] as Oracle | undefined;

  if (twin === undefined) {
    throw new Error(`${metricId} has no oracle twin`);
  }

  return twin(
    sql,
    organizationId,
    new Date(`${from}T00:00:00.000Z`),
    new Date(`${addDays(to, 1)}T00:00:00.000Z`),
  );
}
