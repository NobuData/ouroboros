-- V076__metric_rollups.sql — `metric_definitions`, `metric_daily` and `metric_rollup_state`: the
-- Insights page's daily grain and the methodology registry that explains it (#432, BI.1, decisions
-- I1/I2).
--
-- Mockup 15 is an aggregation layer over planes that already exist — runs, PRs, builds, tests,
-- usage. This migration is the layer's storage: one daily row per (workspace, repository, metric,
-- day), maintained by #433's incremental jobs, and one registry row per metric carrying the copy
-- every methodology popover renders.
--
-- **Plain Postgres, deliberately (decision I2).** TimescaleDB's continuous aggregates are the
-- textbook tool and would be the right call at a hundred times this volume. At hundreds of runs a
-- day the rollup is a small table and the incremental job is ours to write, which keeps every
-- deployment on stock PostgreSQL 17. The graduation path, with measured triggers, is #451's.
--
-- ===========================================================================
-- THE COMPONENT RULE — rate metrics store their numerator and denominator
-- ===========================================================================
--
-- **A 30-day merge rate is not the average of thirty daily merge rates.** A day with 2 merges out
-- of 2 is 100 %; a day with 50 out of 60 is 83.3 %. Averaging those gives 91.7 %; the true rate is
-- 52 / 62 = 83.9 %. Every rate on the page has that shape, so:
--
--   1. A metric whose definition says `is_rate` stores `numerator` and `denominator` on every
--      daily row. That is a constraint, not a convention: `metric_daily` carries `is_rate` under a
--      composite foreign key to the registry (`metric_daily_definition_fkey`), so a row cannot
--      disagree with its definition, and `metric_daily_rate_components` requires both components
--      exactly when `is_rate` is true. A non-rate row carries neither.
--   2. **A percentage is never re-derived by averaging.** Re-windowing sums the components and
--      divides once:
--
--        select sum(numerator) / sum(denominator)   -- × 100 for a `pct` metric
--          from ouroboros.metric_daily
--         where organization_id = $1 and repo_ref is not distinct from $2
--           and metric_id = $3 and day between $4 and $5;
--
--      `value` on a rate row is that day's rate, for the day's own chart point and nothing else —
--      `avg(value)` over a window is wrong by construction, and plausibly so, which is the worst
--      failure mode an analytics surface has.
--   3. Every `pct` metric is a rate (`metric_definitions_pct_is_rate`). A rate need not be a
--      percentage: cost per merged PR (`cents`) and a mean recovery time (`duration_ms`) are ratios
--      too, and re-window the same way.
--
-- ===========================================================================
-- THE VERSION RULE — a formula change requires a version bump
-- ===========================================================================
--
-- The DORA caption claims these numbers come from real events, and two of the four DORA metrics
-- are proxies. The registry is what keeps that honest, and versioning it is what makes a formula
-- change a recorded event rather than a silent one:
--
--   * Changing what a metric *means* — `formula_text`, `source_planes`, `unit`, `is_rate` or
--     `proxy` — requires `version` to increase in the same statement.
--     `metric_definitions_version_guard` refuses the update otherwise, and refuses a version that
--     goes backwards at all.
--   * `title` and `caveats` are copy and may be edited in place.
--   * Registry rows ship in versioned migrations (the rows below), so the bump is also in the
--     history of this directory. #441 (BJ.5) adds the CI check over the service's own formulas.
--
-- ===========================================================================
-- The other rules
-- ===========================================================================
--
-- **`repo_ref` is nullable on purpose.** Null is the org-level row — reserved for #451's
-- cross-repo rollups, and storable today. The grain key is `unique nulls not distinct` (V012's
-- argument): with PostgreSQL's default, two org-level rows for the same metric and day would not
-- collide, and the grain would be a grain for repositories only.
--
-- **`meta` is what makes the tooltip one read.** `Aug 4 — 6 merged · $9.12 · 1 intervention` is
-- three metrics on one day; the throughput row stores the other two as raw numbers —
-- `{"cost_cents": 912, "interventions": 1}` — and the chart formats them. Raw numbers, never
-- formatted strings, so the money rules (unpriced ≠ $0, decision I8) stay the renderer's.
--
-- **Restartable fills.** `metric_rollup_state` is one row per (workspace, metric family). A job
-- fills one day of one family in **one transaction** — upsert every row of that day on the grain
-- key, then move the cursor past it:
--
--   insert into ouroboros.metric_daily (…) values (…)
--   on conflict (organization_id, repo_ref, metric_id, day) do update
--     set value = excluded.value, numerator = excluded.numerator,
--         denominator = excluded.denominator, meta = excluded.meta, computed_at = now();
--   update ouroboros.metric_rollup_state
--      set backfill_cursor = $day + 1                      -- or last_filled_day = $day
--    where organization_id = $1 and family = $2;
--
-- An interruption therefore loses at most the day in flight, whose rows roll back with the
-- cursor move: a restart begins at the cursor (no gaps), and a re-filled day replaces rather than
-- adds (no double-counting). When `backfill_cursor` passes `backfill_until` the backfill is done
-- and both are cleared.

-- ---------------------------------------------------------------------------
-- metric_definitions — the methodology registry.
-- ---------------------------------------------------------------------------
create table ouroboros.metric_definitions (
  -- The id every other table and the service name a metric by — `merged_prs`, `merge_rate`.
  metric_id     text        primary key
                            constraint metric_definitions_metric_id_format
                              check (metric_id ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- The family a rollup job fills the metric with, and the key its bookkeeping is kept under.
  -- Metrics computed from one pass over one plane share a family.
  family        text        not null
                            constraint metric_definitions_family_format
                              check (family ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- The label the page prints — *Autonomous merge rate*.
  title         text        not null
                            constraint metric_definitions_title_present
                              check (btrim(title) <> ''),

  -- The popover copy: how the number is computed, written for the person reading the page.
  formula_text  text        not null
                            constraint metric_definitions_formula_present
                              check (btrim(formula_text) <> ''),

  -- The planes the number is computed from — `{runs, pull_requests}`. At least one, no nulls,
  -- each a lowercase identifier.
  source_planes text[]      not null
                            constraint metric_definitions_source_planes_present
                              check (cardinality(source_planes) > 0
                                     and array_position(source_planes, null) is null
                                     and array_to_string(source_planes, ',')
                                         ~ '^[a-z][a-z_]*(,[a-z][a-z_]*)*$'),

  -- What the number does not tell you. Required: a metric with nothing to disclose says so.
  caveats       text        not null
                            constraint metric_definitions_caveats_present
                              check (btrim(caveats) <> ''),

  unit          text        not null
                            constraint metric_definitions_unit_known
                              check (unit in ('count', 'pct', 'duration_ms', 'cents', 'tokens')),

  -- Whether daily rows carry numerator and denominator — see THE COMPONENT RULE.
  is_rate       boolean     not null,

  -- Moves on every change to what the metric means — see THE VERSION RULE.
  version       integer     not null default 1
                            constraint metric_definitions_version_positive
                              check (version >= 1),

  -- A stand-in for the thing the title names: DORA change failure rate is revert detection,
  -- MTTR is loop-scoped recovery. The popover flags it.
  proxy         boolean     not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint metric_definitions_pct_is_rate
    check (unit <> 'pct' or is_rate),

  -- The composite key metric_daily's foreign key names, so a daily row's is_rate is its
  -- definition's.
  constraint metric_definitions_rate_key
    unique (metric_id, is_rate)
);

comment on table ouroboros.metric_definitions is
  'The Insights methodology registry (#432, decision I1) — one row per metric, carrying the formula text, source planes, caveats, unit, version and proxy flag every methodology popover renders. Rows ship in versioned migrations; a change to what a metric means bumps version (metric_definitions_version_guard).';
comment on column ouroboros.metric_definitions.family is
  'The rollup family that fills this metric; metric_rollup_state keeps its bookkeeping per (workspace, family).';
comment on column ouroboros.metric_definitions.formula_text is
  'The popover copy — how the number is computed, written for a user.';
comment on column ouroboros.metric_definitions.source_planes is
  'The data planes the metric is computed from (runs, pull_requests, builds, usage, …). Non-empty.';
comment on column ouroboros.metric_definitions.caveats is
  'What the number does not tell you. Required.';
comment on column ouroboros.metric_definitions.unit is
  'count | pct | duration_ms | cents | tokens. Every pct metric is a rate.';
comment on column ouroboros.metric_definitions.is_rate is
  'Whether daily rows store numerator and denominator. Re-windowing a rate sums the components and divides once — never averages daily values.';
comment on column ouroboros.metric_definitions.version is
  'Increases with every change to formula_text, source_planes, unit, is_rate or proxy; never decreases.';
comment on column ouroboros.metric_definitions.proxy is
  'True when the metric stands in for what its title names (DORA change failure rate, MTTR). The popover says so.';

create trigger metric_definitions_touch_updated_at
  before update on ouroboros.metric_definitions
  for each row execute function ouroboros.touch_updated_at();

-- Refuses a change to what a metric means without a version bump, and any version that goes
-- backwards. Copy (title, caveats) may change at the same version.
create function ouroboros.metric_definitions_version_guard()
returns trigger language plpgsql as $$
begin
  if new.version < old.version then
    raise exception 'metric % version cannot go backwards (% → %)',
      old.metric_id, old.version, new.version
      using errcode = 'check_violation', constraint = 'metric_definitions_version_guard';
  end if;

  if (new.formula_text, new.source_planes, new.unit, new.is_rate, new.proxy)
       is distinct from
     (old.formula_text, old.source_planes, old.unit, old.is_rate, old.proxy)
     and new.version <= old.version then
    raise exception 'metric % changed its formula without bumping version (still %)',
      old.metric_id, old.version
      using errcode = 'check_violation', constraint = 'metric_definitions_version_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.metric_definitions_version_guard() is
  'Refuses an update to metric_definitions that changes formula_text, source_planes, unit, is_rate or proxy without increasing version, or that lowers version (#432, the version rule).';

create trigger metric_definitions_version_guard
  before update on ouroboros.metric_definitions
  for each row execute function ouroboros.metric_definitions_version_guard();

-- ---------------------------------------------------------------------------
-- metric_daily — the daily grain.
-- ---------------------------------------------------------------------------
create table ouroboros.metric_daily (
  id              bigint      generated always as identity primary key,

  -- The workspace. Cascade: a deleted workspace leaves no history behind for a reused id.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The repository, or null for an org-level row (#451). V067's domain, so the name means what
  -- it means everywhere else in the schema.
  repo_ref        ouroboros.repo_ref,

  metric_id       text        not null,

  -- Copied from the definition under the composite key below — the writer states it, and a
  -- statement that disagrees with the registry is refused. Cascades if a definition's is_rate
  -- ever changes (with its version bump), which then re-checks every row.
  is_rate         boolean     not null,

  day             date        not null,

  -- The day's number: a count, a total, or — on a rate row — that day's rate (× 100 for pct).
  value           numeric     not null
                              constraint metric_daily_value_nonnegative
                                check (value >= 0),

  -- The rate's components, exactly when is_rate. See THE COMPONENT RULE.
  numerator       numeric,
  denominator     numeric,

  -- Per-day extras for the chart tooltip, as raw numbers: {"cost_cents": 912, "interventions": 1}.
  meta            jsonb       not null default '{}'::jsonb
                              constraint metric_daily_meta_object
                                check (jsonb_typeof(meta) = 'object'),

  -- When the job last wrote this row; a re-fill sets it again.
  computed_at     timestamptz not null default now(),

  constraint metric_daily_definition_fkey
    foreign key (metric_id, is_rate)
    references ouroboros.metric_definitions (metric_id, is_rate)
    on update cascade on delete restrict,

  constraint metric_daily_rate_components
    check (case when is_rate
                then numerator is not null and denominator is not null
                     and numerator >= 0 and denominator > 0
                else numerator is null and denominator is null
           end),

  constraint metric_daily_grain_key
    unique nulls not distinct (organization_id, repo_ref, metric_id, day)
);

comment on table ouroboros.metric_daily is
  'The Insights daily grain (#432, decision I2) — one row per (workspace, repository or null for org-level, metric, day), filled by the rollup jobs. Rate metrics store numerator and denominator; a window re-sums them and divides once, never averaging daily values.';
comment on column ouroboros.metric_daily.repo_ref is
  'The repository, or null for an org-level row (#451). Unique nulls-not-distinct in the grain key, so org-level rows collide too.';
comment on column ouroboros.metric_daily.is_rate is
  'The definition''s is_rate, held to it by metric_daily_definition_fkey. Decides whether numerator and denominator are required (true) or forbidden (false).';
comment on column ouroboros.metric_daily.value is
  'The day''s number. On a rate row it is that day''s rate for the day''s own chart point only — a window re-derives from the components.';
comment on column ouroboros.metric_daily.numerator is
  'Required on a rate row, null otherwise. Summed across a window.';
comment on column ouroboros.metric_daily.denominator is
  'Required (and positive) on a rate row, null otherwise. Summed across a window; a day with no denominator has no row.';
comment on column ouroboros.metric_daily.meta is
  'Per-day tooltip extras as raw numbers — the throughput row''s {"cost_cents": 912, "interventions": 1}. Always an object.';

-- Range scans by day across the whole table — the rollup appends in day order, which is what
-- BRIN is for.
create index metric_daily_day_brin on ouroboros.metric_daily using brin (day);

-- The registry's foreign key, and "which rows does this definition own".
create index metric_daily_metric_idx on ouroboros.metric_daily (metric_id, is_rate);

-- ---------------------------------------------------------------------------
-- metric_rollup_state — per-family bookkeeping for restartable fills.
-- ---------------------------------------------------------------------------
create table ouroboros.metric_rollup_state (
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- A metric_definitions.family. Not a foreign key — a family is a label shared by rows, not a
  -- row — but held to the same format.
  family          text        not null
                              constraint metric_rollup_state_family_format
                                check (family ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- The last day the incremental job filled completely; null before the first fill.
  last_filled_day date,

  -- The next day a backfill will fill, and the last day it will fill. Both null when no backfill
  -- is in progress; set together, and cleared together when the cursor passes the end.
  backfill_cursor date,
  backfill_until  date,

  -- The last run's outcome, and why it failed when it did.
  last_run_status text
                  constraint metric_rollup_state_status_known
                    check (last_run_status in ('running', 'succeeded', 'failed')),
  last_run_at     timestamptz,
  last_error      text,

  updated_at      timestamptz not null default now(),

  primary key (organization_id, family),

  constraint metric_rollup_state_backfill_pair
    check ((backfill_cursor is null) = (backfill_until is null)),
  constraint metric_rollup_state_backfill_order
    check (backfill_cursor is null or backfill_cursor <= backfill_until),
  constraint metric_rollup_state_run_stamped
    check ((last_run_status is null) = (last_run_at is null)),
  constraint metric_rollup_state_error_on_failure
    check (last_error is null or last_run_status = 'failed')
);

comment on table ouroboros.metric_rollup_state is
  'Rollup job bookkeeping per (workspace, metric family) (#432) — last filled day, backfill cursor and range, last run status. A job writes a day''s rows and moves the cursor in one transaction, so a restart neither skips nor double-counts.';
comment on column ouroboros.metric_rollup_state.last_filled_day is
  'The last day the incremental job filled completely; null before the first fill.';
comment on column ouroboros.metric_rollup_state.backfill_cursor is
  'The next day the backfill fills. Moved in the same transaction as that day''s metric_daily rows; null when no backfill is running.';
comment on column ouroboros.metric_rollup_state.backfill_until is
  'The last day the backfill fills (inclusive). Set and cleared with backfill_cursor.';
comment on column ouroboros.metric_rollup_state.last_run_status is
  'running | succeeded | failed, stamped with last_run_at.';
comment on column ouroboros.metric_rollup_state.last_error is
  'Why the last run failed. Only on a failed run.';

create trigger metric_rollup_state_touch_updated_at
  before update on ouroboros.metric_rollup_state
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The registry's first rows — mockup 15's KPI row, throughput chart and DORA strip.
-- Later metrics (#458's decision plane, #510's build durations) register in their own migrations.
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy)
values
  ('merged_prs', 'throughput', 'Merged PRs',
   'Pull requests opened by a loop that merged on this day.',
   '{pull_requests}',
   'Counts merges, not deploys. A PR merged by hand after the loop handed off still counts.',
   'count', false, false),

  ('merge_rate', 'throughput', 'Autonomous merge rate',
   'Loop PRs that merged without a human intervention, divided by all loop PRs that closed (merged or not) in the window.',
   '{pull_requests,runs}',
   'A window''s rate is total autonomous merges over total closed PRs, not an average of daily rates.',
   'pct', true, false),

  ('merged_untouched_rate', 'throughput', 'Merged w/o human edits',
   'Merged PRs whose revisions contain no human-authored pushes and no human-edited files after the loop''s last revision, divided by all merged PRs.',
   '{pull_requests}',
   'Authorship comes from host sync; a human edit made outside the host (a squash rewrite) is not seen.',
   'pct', true, false),

  ('human_interventions', 'interventions', 'Human interventions',
   'Times a loop stopped for a person: needs-human handoffs, guardrail stops and policy gates.',
   '{runs}',
   'Counts stops, not minutes spent; one person answering three gates on one loop is three.',
   'count', false, false),

  ('cost_cents', 'cost', 'Total cost',
   'Spend across all providers for priced usage on this day, in cents.',
   '{usage}',
   'Unpriced usage is excluded rather than counted as $0; token counts include it.',
   'cents', false, false),

  ('tokens', 'cost', 'Tokens',
   'Input plus output tokens across all providers on this day, priced or not.',
   '{usage}',
   'Includes local models served at $0.',
   'tokens', false, false),

  ('cost_per_merged_pr', 'cost', 'Cost per merged PR',
   'Priced spend divided by merged PRs in the window.',
   '{usage,pull_requests}',
   'Spend on loops that did not merge is included in the numerator — failure has a cost.',
   'cents', true, false),

  ('deploy_frequency', 'dora', 'Deploy frequency',
   'Successful default-branch builds on the build farm per day.',
   '{builds}',
   'A green default-branch build stands in for a deploy; pipelines that deploy elsewhere are not seen.',
   'count', false, false),

  ('lead_time', 'dora', 'Lead time',
   'Mean time from a loop starting on an issue to its pull request merging.',
   '{runs,pull_requests}',
   'A mean of the window''s merges, re-windowed from total time over count. Time before the loop picked the issue up is not included.',
   'duration_ms', true, false),

  ('change_failure_rate', 'dora', 'Change failure rate',
   'Merged pull requests later reverted, divided by merged pull requests.',
   '{pull_requests}',
   'A proxy: revert detection only. A failure fixed forward rather than reverted is not counted.',
   'pct', true, true),

  ('mttr', 'dora', 'MTTR',
   'Mean time from a loop''s build or test failure to the same loop''s next green, over recoveries completed that day.',
   '{runs,builds}',
   'A proxy: loop-scoped recovery, not production incidents. Re-windowed from total time over count.',
   'duration_ms', true, true);

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
-- The registry ships in migrations; the service reads it.
grant select on ouroboros.metric_definitions to ouroboros_app;
grant select, insert, update, delete on ouroboros.metric_daily to ouroboros_app;
grant select, insert, update on ouroboros.metric_rollup_state to ouroboros_app;
