-- V078__metric_rollup_extractors.sql — what the rollup extractors need from the Insights grain:
-- a dimension on `metric_daily`, an aggregation method on every registry entry, a stored median
-- that can be re-windowed honestly, and the registry rows for the families V076 did not ship
-- (#433, BI.2, decisions I1/I2).
--
-- V076 made the grain and the registry; #433's extractors fill it, one per metric family, each
-- with an on-the-fly SQL twin the service's integration suite compares it against. Filling
-- mockup 15's cards asked three things of the schema that V076 could not yet answer.
--
-- ===========================================================================
-- 1. A DIMENSION — "Test failures by suite" is one metric with many rows per day
-- ===========================================================================
--
-- `Test failures by suite · 30d`, `Cycle time by stage · median` and `Time to completion by
-- effort` are each one metric broken out by a label: a suite name, a stage key, an effort size.
-- `metric_daily.dimension` is that label, and it joins the grain key:
--
--   unique nulls not distinct (organization_id, repo_ref, metric_id, dimension, day)
--
-- `''` is the undimensioned row — every metric V076 shipped — so existing rows and writers keep
-- their meaning. Not null with an empty default rather than nullable: the grain is already
-- nulls-not-distinct for `repo_ref`, and a second nullable key column would make "the total"
-- and "the row nobody labelled" indistinguishable. A window over a dimension re-reads exactly
-- like a window over the metric, with `and dimension = $6` added.
--
-- `metric_definitions.dimension_kind` says what a metric's dimension *is* — `stage`, `suite`,
-- `effort` or `cause` (#434 adds the cause breakdown to `human_interventions`) — or null for an
-- undimensioned metric. `metric_daily_shape_guard` holds every row to it: a dimensioned metric's
-- rows carry a non-empty dimension, an undimensioned metric's rows carry `''`.
--
-- ===========================================================================
-- 2. THE AGGREGATION RULE — how a window re-derives a metric, per metric
-- ===========================================================================
--
-- V076's component rule covers rates. Medians have the same trap with a different shape: **the
-- median of thirty days is not the average of thirty daily medians**, nor the median of them. So
-- every registry entry now states how a window re-derives it, in `aggregation`:
--
--   * `sum`    — counts and totals. The window is `sum(value)`.
--   * `ratio`  — V076's rates (`is_rate`, and only those). The window is
--                `sum(numerator) / sum(denominator)`, never `avg(value)`.
--   * `median` — **component percentiles over the retained samples.** A median row keeps the
--                day's observations, ascending, in `meta.samples`; `value` is that day's median
--                for the day's own chart point and nothing else. The window's median is the
--                median of every sample in the window, pooled:
--
--                  select percentile_cont(0.5) within group (order by s::numeric)
--                    from ouroboros.metric_daily d,
--                         jsonb_array_elements_text(d.meta -> 'samples') s
--                   where d.organization_id = $1 and d.repo_ref is not distinct from $2
--                     and d.metric_id = $3 and d.dimension = $4 and d.day between $5 and $6;
--
--                That is exact, not an approximation, and it is the same computation on the
--                thirtieth re-run as on the first: the samples are stored sorted, and
--                `percentile_cont` interpolates between the two middle values of an even count
--                the same way every time. At hundreds of loops a day the sample arrays are
--                small; #451 is where a sketch replaces them if they ever are not.
--
-- `metric_daily_shape_guard` makes the median rule structural, as V076 made the component rule
-- structural: a median row must carry a non-empty ascending array of non-negative numbers in
-- `meta.samples`, and its `value` must *be* their median; any other row must not carry
-- `samples`. A writer that averaged anything is refused at the insert.
--
-- `aggregation` defaults from `is_rate` when an insert omits it (`ratio` for a rate, `sum`
-- otherwise — `metric_definitions_aggregation_default`), so V076's writers and probes keep
-- working; a `median` is always stated. It is part of what a metric *means*: the version guard
-- now refuses a change to `aggregation` or `dimension_kind` without a version bump, as it already
-- did for `formula_text`, `source_planes`, `unit`, `is_rate` and `proxy`.
--
-- ===========================================================================
-- 3. THE NEW FAMILIES' REGISTRY ROWS
-- ===========================================================================
--
-- V076 shipped the KPI row, throughput, cost and DORA. The remaining cards' metrics are below —
-- `cycle` (median cycle, stage medians), `builds`, `tests` (with the suite dimension), `effort`
-- (completion time by effort) — and `unpriced_tokens`, which keeps priced and unpriced usage
-- separable in the stored components (decision I8): `tokens` counts every token, `cost_cents`
-- only priced spend, and `unpriced_tokens` the part of `tokens` no price covered. `cost_per_merged_pr`
-- is computed per window rather than stored per day (see the end of this file).
--
-- **Extractors are versioned with these rows.** Each extractor in
-- `ouroboros-rest/src/modules/insights/rollup/` declares the registry version of every metric it
-- fills, and refuses to fill when the database's row has moved past it — so a formula change
-- here without the matching extractor change fails the fill loudly instead of writing numbers
-- the popover no longer describes.
--
-- **Days are UTC days.** Every extractor buckets by `(timestamptz at time zone 'UTC')::date`.

-- ---------------------------------------------------------------------------
-- metric_definitions — aggregation and dimension_kind
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_definitions
  add column aggregation    text,
  add column dimension_kind text
    constraint metric_definitions_dimension_kind_known
      check (dimension_kind in ('stage', 'suite', 'effort', 'cause'));

-- The existing rows: V076's component rule already said which are ratios.
update ouroboros.metric_definitions
   set aggregation = case when is_rate then 'ratio' else 'sum' end;

alter table ouroboros.metric_definitions
  alter column aggregation set not null,
  add constraint metric_definitions_aggregation_known
    check (aggregation in ('sum', 'ratio', 'median')),
  add constraint metric_definitions_ratio_is_rate
    check ((aggregation = 'ratio') = is_rate);

comment on column ouroboros.metric_definitions.aggregation is
  'How a window re-derives the metric (#433): sum (sum of values), ratio (sum(numerator) / sum(denominator) — exactly the is_rate metrics) or median (the median of every meta.samples entry in the window, pooled). Never an average of daily values.';
comment on column ouroboros.metric_definitions.dimension_kind is
  'What metric_daily.dimension names for this metric — stage | suite | effort | cause — or null for an undimensioned metric, whose rows carry dimension ''''.';

-- Fills aggregation from is_rate when an insert omits it, so V076's writers keep working.
create function ouroboros.metric_definitions_aggregation_default()
returns trigger language plpgsql as $$
begin
  if new.aggregation is null then
    new.aggregation := case when new.is_rate then 'ratio' else 'sum' end;
  end if;

  return new;
end;
$$;

comment on function ouroboros.metric_definitions_aggregation_default() is
  'Defaults metric_definitions.aggregation to ratio for a rate and sum otherwise when an insert omits it (#433). A median is always stated.';

create trigger metric_definitions_aggregation_default
  before insert on ouroboros.metric_definitions
  for each row execute function ouroboros.metric_definitions_aggregation_default();

-- The version rule, now covering aggregation and dimension_kind.
create or replace function ouroboros.metric_definitions_version_guard()
returns trigger language plpgsql as $$
begin
  if new.version < old.version then
    raise exception 'metric % version cannot go backwards (% → %)',
      old.metric_id, old.version, new.version
      using errcode = 'check_violation', constraint = 'metric_definitions_version_guard';
  end if;

  if (new.formula_text, new.source_planes, new.unit, new.is_rate, new.proxy,
      new.aggregation, new.dimension_kind)
       is distinct from
     (old.formula_text, old.source_planes, old.unit, old.is_rate, old.proxy,
      old.aggregation, old.dimension_kind)
     and new.version <= old.version then
    raise exception 'metric % changed its formula without bumping version (still %)',
      old.metric_id, old.version
      using errcode = 'check_violation', constraint = 'metric_definitions_version_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.metric_definitions_version_guard() is
  'Refuses an update to metric_definitions that changes formula_text, source_planes, unit, is_rate, proxy, aggregation or dimension_kind without increasing version, or that lowers version (#432, #433 — the version rule).';

-- ---------------------------------------------------------------------------
-- metric_daily — the dimension
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_daily
  add column dimension text not null default ''
    constraint metric_daily_dimension_format
      check (dimension = ''
             or (dimension = btrim(dimension) and length(dimension) <= 200));

comment on column ouroboros.metric_daily.dimension is
  'The label a dimensioned metric is broken out by — a suite name, a stage key, an effort size (the definition''s dimension_kind) — or '''' for an undimensioned metric. Part of the grain key.';

alter table ouroboros.metric_daily
  drop constraint metric_daily_grain_key,
  add constraint metric_daily_grain_key
    unique nulls not distinct (organization_id, repo_ref, metric_id, dimension, day);

comment on table ouroboros.metric_daily is
  'The Insights daily grain (#432, #433, decision I2) — one row per (workspace, repository or null for org-level, metric, dimension, day), filled by the rollup extractors. A window re-derives each metric by its definition''s aggregation: sum of values, sum(numerator) / sum(denominator) for a rate, or the pooled median of meta.samples for a median — never an average of daily values.';

-- Holds a row to its definition's dimension_kind and aggregation. Unknown metrics pass through
-- so metric_daily_definition_fkey refuses them under its own name.
create function ouroboros.metric_daily_shape_guard()
returns trigger language plpgsql as $$
declare
  def     ouroboros.metric_definitions%rowtype;
  samples jsonb;
  median  numeric;
begin
  select * into def from ouroboros.metric_definitions where metric_id = new.metric_id;
  if not found then
    return new;
  end if;

  if (def.dimension_kind is null) <> (new.dimension = '') then
    raise exception 'metric % is %, but its row has dimension ''%''',
      new.metric_id,
      coalesce('dimensioned by ' || def.dimension_kind, 'undimensioned'),
      new.dimension
      using errcode = 'check_violation', constraint = 'metric_daily_shape_guard';
  end if;

  samples := case when jsonb_typeof(new.meta) = 'object' then new.meta -> 'samples' end;

  if def.aggregation <> 'median' then
    if samples is not null then
      raise exception 'metric % is aggregated by %, so its rows carry no samples',
        new.metric_id, def.aggregation
        using errcode = 'check_violation', constraint = 'metric_daily_shape_guard';
    end if;
    return new;
  end if;

  if samples is null or jsonb_typeof(samples) <> 'array' or jsonb_array_length(samples) = 0
     or exists (select 1 from jsonb_array_elements(samples) e
                 where jsonb_typeof(e) <> 'number' or e::text::numeric < 0)
     or exists (select 1
                  from (select e::text::numeric as v,
                               lag(e::text::numeric) over (order by n) as prev
                          from jsonb_array_elements(samples) with ordinality as t(e, n)) o
                 where o.v < o.prev) then
    raise exception 'median metric % needs meta.samples: a non-empty ascending array of non-negative numbers',
      new.metric_id
      using errcode = 'check_violation', constraint = 'metric_daily_shape_guard';
  end if;

  select percentile_cont(0.5) within group (order by e::text::numeric)::numeric into median
    from jsonb_array_elements(samples) e;

  if new.value <> median then
    raise exception 'median metric % stored value % but its samples'' median is %',
      new.metric_id, new.value, median
      using errcode = 'check_violation', constraint = 'metric_daily_shape_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.metric_daily_shape_guard() is
  'Holds a metric_daily row to its definition (#433): a non-empty dimension exactly when the metric has a dimension_kind; for a median metric, meta.samples is a non-empty ascending array of non-negative numbers and value is their median; any other metric carries no samples.';

create trigger metric_daily_shape_guard
  before insert or update on ouroboros.metric_daily
  for each row execute function ouroboros.metric_daily_shape_guard();

-- ---------------------------------------------------------------------------
-- The new families' registry rows
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy,
   aggregation, dimension_kind)
values
  ('cycle_time', 'cycle', 'Median cycle',
   'The median time from a loop starting to the loop finishing merged, over loops that finished merged. A window''s median is computed over every loop in the window — each day keeps its loops'' times — never as an average or median of daily medians.',
   '{runs}',
   'Only merged loops are timed; a loop handed to a person or failed is not in the median. Time in the queue before the loop starts is not included.',
   'duration_ms', false, false, 'median', null),

  ('stage_duration', 'cycle', 'Cycle time by stage',
   'For each stage, the median time a merged loop spent in it — the sum of every attempt''s start-to-finish time for that stage — dated by the day the loop finished. A window''s median pools every loop''s time in the window, never averaging daily medians.',
   '{runs}',
   'Retried attempts are summed into their stage, so a stage that often retries looks slow rather than hidden. An attempt with no finish time is not counted.',
   'duration_ms', false, false, 'median', 'stage'),

  ('builds', 'builds', 'Builds',
   'Build-farm jobs that finished succeeded or failed on this day; a job that failed and was retried counts as a failed build.',
   '{builds}',
   'Canceled jobs are not counted. Every pool and ref is included, not only the default branch.',
   'count', false, false, 'sum', null),

  ('build_failures', 'builds', 'Failed builds',
   'Build-farm jobs that finished failed on this day, including failed jobs that were later retried.',
   '{builds}',
   'A retried failure is still a failure — the retry is its own build.',
   'count', false, false, 'sum', null),

  ('build_success_rate', 'builds', 'Build success',
   'Succeeded builds divided by succeeded plus failed builds (retried failures included).',
   '{builds}',
   'A window''s rate is total successes over total finished builds, not an average of daily rates. Canceled jobs are in neither side.',
   'pct', true, false, 'ratio', null),

  ('test_cases_run', 'tests', 'Test cases run',
   'Test cases that ran — passed, failed or flaky — across every finished test run started on this day. Skipped cases did not run.',
   '{tests}',
   'A case re-run in a second test run counts each time it ran.',
   'count', false, false, 'sum', null),

  ('test_pass_rate', 'tests', 'Test pass rate',
   'Cases that passed — first time or on retry (flaky) — divided by cases that ran.',
   '{tests}',
   'A flaky case counts as passed because it passed in the end; the flaky-tests card is where flakiness is measured.',
   'pct', true, false, 'ratio', null),

  ('test_failures_by_suite', 'tests', 'Test failures by suite',
   'Failed test cases per suite across every finished test run started on this day. The suite is the suite name the report gave; the same name on two platforms is one suite here.',
   '{tests}',
   'Counts failing case runs, not distinct failing cases — a case failing in three runs is three.',
   'count', false, false, 'sum', 'suite'),

  ('completion_time_by_effort', 'effort', 'Time to completion by effort',
   'For each predicted effort (XS–XL), the median lead time — loop start to merge — of merged loops estimated at that effort when they were queued. A window''s median pools every merge in the window.',
   '{estimates,runs,pull_requests}',
   'Sliced by the effort predicted at queue time, not the effort the work turned out to need. Unestimated merges are in no slice.',
   'duration_ms', false, false, 'median', 'effort'),

  ('unpriced_tokens', 'cost', 'Unpriced tokens',
   'Input plus output tokens on this day from usage with no price — the part of Tokens that Total cost does not cover.',
   '{usage}',
   'An unpriced call is not $0: its cost is unknown, which is why it is stored apart from priced spend.',
   'tokens', false, false, 'sum', null);

-- `cost_per_merged_pr` is a ratio whose numerator is not a subset of its denominator: a day of spend
-- with no merges has no denominator a daily row can hold. So it is never stored per day — a window
-- computes it from `cost_cents` and `merged_prs`, both stored — and the popover says so. Copy only,
-- so the version stays.
update ouroboros.metric_definitions
   set caveats = 'Spend on loops that did not merge is included in the numerator — failure has a cost. Computed for the whole window as total priced cost over merged PRs, never per day: a day of spend with no merges has no per-day ratio.'
 where metric_id = 'cost_per_merged_pr';
