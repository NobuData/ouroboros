-- ===========================================================================
-- V154 — origin-aware rollups: the Insights grain split per data origin (DJ.2, #1315)
-- ===========================================================================
--
-- V141 (DJ.1) gave every run, and every row derived from one, an origin — `live`, `simulated` or
-- `seeded`. The daily grain still summed across them, so a workspace with three real runs and
-- forty simulated ones reported a merge rate that described the simulator. This migration splits
-- the grain:
--
--   column       what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   origin       which origin's rows the figure was computed from. Part of the grain key: a day
--                of a metric holds one row per origin that had activity, never a sum of two.
--   population   how many source rows are behind the figure — runs, builds, usage rows, test
--                cases — so a reader can tell "no live data" (no row) from "zero" (a row whose
--                value is 0 over a population of 12). Null only on a row a seed wrote without it.
--
-- **Rebuilt once, here.** A stored row cannot be split after the fact — it is already a sum — so
-- every row and every family's bookkeeping is deleted. The rollup job then finds no
-- `metric_rollup_state` row for any (workspace, family) and backfills its horizon from the source
-- planes, per origin (`rollup/plan.ts`). The development seeds re-run after this (their checksum
-- changed with it) and write their ledgers and bookkeeping again, as `seeded`.
--
-- **The registry records the rule.** `metric_definitions.origin_rule` says, in words, how each
-- metric treats origin — shown beside the formula in the methodology popover. Every metric whose
-- computation is now split per origin has its version raised; the extractors' `metrics` maps and
-- `rollup.formula.lock.json` move with them. The `decisions` family is not split: decisions carry
-- no origin (DJ.1 gave one to runs and what derives from them), and its rule says so.
--
-- A row a seed file writes states no origin and gets `ouroboros.data_origin_default()` — `seeded`
-- inside a seed file, `live` otherwise (V141). The rollup job always states it.
--
-- To undo (forward only — for a rehearsal against a copy; the deleted rows are rebuilt by the job):
--   alter table ouroboros.metric_daily drop constraint metric_daily_grain_key,
--     add constraint metric_daily_grain_key
--       unique nulls not distinct (organization_id, repo_ref, metric_id, dimension, day);
--   alter table ouroboros.metric_daily drop column population, drop column origin;
--   alter table ouroboros.metric_definitions drop column origin_rule;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The rebuild: nothing stored survives the split.
-- ---------------------------------------------------------------------------
delete from ouroboros.metric_daily;
delete from ouroboros.metric_rollup_state;

-- ---------------------------------------------------------------------------
-- metric_daily — origin and population
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_daily
  add column origin text not null default ouroboros.data_origin_default()
    constraint metric_daily_origin_known check (origin in ('live', 'simulated', 'seeded')),
  add column population bigint
    constraint metric_daily_population_nonnegative check (population >= 0);

alter table ouroboros.metric_daily
  drop constraint metric_daily_grain_key,
  add constraint metric_daily_grain_key
    unique nulls not distinct (organization_id, repo_ref, metric_id, dimension, origin, day);

comment on table ouroboros.metric_daily is
  'The Insights daily grain (#432, #433, #1315, decision I2) — one row per (workspace, repository or null for org-level, metric, dimension, origin, day), filled by the rollup extractors. A window re-derives each metric by its definition''s aggregation over the rows of the origins it reads (live by default), never across origins unless asked, and never as an average of daily values.';
comment on column ouroboros.metric_daily.origin is
  'live, simulated or seeded — the origin of every source row behind the figure (DJ.2, #1315). Part of the grain key: origins are never summed into one row.';
comment on column ouroboros.metric_daily.population is
  'How many source rows are behind the figure (runs, builds, usage rows, test cases), summed across a window as the count behind a number. Null only on a row a seed wrote without one.';

-- Reads filter on (workspace, origin) before anything else.
create index metric_daily_org_origin_day_idx
  on ouroboros.metric_daily (organization_id, origin, day);

-- ---------------------------------------------------------------------------
-- metric_definitions — the origin rule, and the versions it raises
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_definitions
  add column origin_rule text not null
    default 'Computed separately for each data origin (live, simulated, seeded) from the origin of the rows it counts. Reads answer live rows only unless another origin is asked for; asking for all origins sums them and marks the answer mixed.'
    constraint metric_definitions_origin_rule_nonblank check (btrim(origin_rule) <> '');

comment on column ouroboros.metric_definitions.origin_rule is
  'How the metric treats data origin, in words, for the methodology popover (DJ.2, #1315).';

update ouroboros.metric_definitions
   set origin_rule = 'Not split by origin: decisions carry no data origin (DJ.1 gave one to runs and what derives from them), so every decision in the workspace is counted whichever origin is asked for.'
 where family = 'decisions';

update ouroboros.metric_definitions
   set version = version + 1, updated_at = now()
 where family <> 'decisions';

-- ---------------------------------------------------------------------------
-- token_usage_daily — one row per origin too
--
-- The dashboard's *Token spend · today* card reads this view; it now keeps each origin's usage
-- apart so the card can answer for live usage alone. `create or replace` may only append a column,
-- so `origin` is last, and the grouping gains it.
-- ---------------------------------------------------------------------------
create or replace view ouroboros.token_usage_daily
  with (security_invoker = true) as
select u.organization_id,
       (u.occurred_at at time zone 'utc')::date            as day,
       u.provider,
       count(*)                                            as events,
       count(*) filter (where u.cost_cents is null)        as unpriced_events,
       sum(u.tokens_in)                                    as tokens_in,
       sum(u.tokens_out)                                   as tokens_out,
       sum(u.tokens_in + u.tokens_out)                     as tokens_total,
       -- Null-propagating on purpose, as V010 explains: the cost of the priced events only.
       sum(u.cost_cents)                                   as cost_cents,
       u.origin
  from ouroboros.token_usage u
 group by u.organization_id, 2, u.provider, u.origin;

comment on view ouroboros.token_usage_daily is
  'Per-organization, per-day, per-provider, per-origin rollup of token_usage (#66, #1315) — the read behind mockup 02''s Token spend · today. A plain view, not materialized: decision F10, a stored total drifts. The day is UTC, fixed rather than session-dependent. One row per data origin, so a reader sums only the origin it was asked for.';
