-- insights-invariants.sql — the invariants the Insights read path is written against, named
-- (#436, BI.5).
--
-- Mockup 15 trusts the rollup grain completely. BJ.1 (#437) re-windows a rate by summing its
-- components, pools a median's samples, renders a tooltip from `meta`, and labels a bar from a
-- dimension. None of that re-checks anything, and each rule has a failure that lands in the
-- database without raising:
--
--   * **Grain uniqueness.** Two rows for one (workspace, repository, metric, dimension, day) are a
--     day counted twice. The page shows a plausible number that is wrong.
--   * **Component consistency.** A rate whose stored value is not its numerator over its
--     denominator is a typed KPI. The day's chart point and the window's re-derived rate then
--     disagree, and nothing says which is true.
--   * **The vocabularies.** A cause outside the taxonomy is a bar no label maps to. An effort
--     outside XS–XL is a rung of the ladder that does not exist.
--   * **Meta shapes.** The tooltip reads raw numbers, and a median reads its samples. A string
--     where a number belongs renders as `NaN`; unsorted samples give a median that moves
--     between reads.
--   * **The registry.** A row whose metric has no definition is a number with no methodology
--     popover. #436's acceptance criteria require every seeded `metric_id` to have one.
--
-- The schema refuses most of these at write time (V076, V078, V079), and constraints.sql asserts
-- that where each migration lives. This fragment is the same list read as **stored rows**: every
-- row a database holds, in every workspace, satisfies every rule. It also covers the two rules no
-- constraint can state: that a rate's value *is* its ratio, and that a dimension is from its
-- kind's vocabulary. Against the seeded database `ci/db` builds, that turns
-- R__dev_seed_workspace_metrics.sql into a standing witness. It is also what
-- tests/verify-insights-invariants.sh plants a bad row under to prove each probe goes red.
--
-- The second half asks the catalogue by name, for the reason the planning probes give (#276).
-- A stored-row probe over a table nobody planted into is green whether or not its rule exists.
-- So each rule is also required to still be declared, and no rule body is pinned.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red
-- build says which guarantee went and the verifier can require that name.
--
-- Run through tests/insights-invariants.sql, which owns the session and the transaction. It
-- writes nothing, so it is safe against any database, a developer's included. Unlike the
-- planning probes it is not also a section of constraints.sql: that file clears every workspace
-- before it starts, so the stored-row half would have nothing to read there.

-- ===========================================================================
-- 1. The rows the database holds
-- ===========================================================================

-- --- one row per grain ---------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.metric_daily
               group by organization_id, repo_ref, metric_id, dimension, day
              having count(*) > 1),
  'metric_daily_grain_key: no stored (workspace, repository, metric, dimension, day) has two rows — a day counted twice');

-- --- a rate carries its components, and nothing else does ---------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.metric_daily
               where case when is_rate
                          then numerator is null or denominator is null
                               or numerator < 0 or denominator <= 0
                          else numerator is not null or denominator is not null
                     end),
  'metric_daily_rate_components: every stored rate row has a numerator and a positive denominator, and no other row has either');

-- --- and its value is its ratio -------------------------------------------------------------------
--
-- No constraint can say this; the extractors write it and the seed computes it. A row that breaks
-- it is a value somebody typed. × 100 for a pct metric, as V076's component rule says.
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.metric_daily d
                join ouroboros.metric_definitions def on def.metric_id = d.metric_id
               where d.is_rate and d.denominator > 0
                 and abs(d.value - d.numerator / d.denominator
                                   * case def.unit when 'pct' then 100 else 1 end) >= 0.000001),
  'metric_daily_value_is_ratio: every stored rate row''s value is its numerator over its denominator — no rate is typed');

-- --- every metric is registered, as the rate it is ----------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.metric_daily d
               where not exists (select 1 from ouroboros.metric_definitions def
                                  where def.metric_id = d.metric_id and def.is_rate = d.is_rate)),
  'metric_daily_registered: every stored metric_id has a registry entry with the same is_rate — no number without a methodology');

-- --- the shape guard's two rules, over what is stored -----------------------------------------
--
-- A dimensioned metric's rows carry a dimension and an undimensioned one's carry ''. A median's
-- rows carry ascending, non-negative samples whose median is the value; no other row carries
-- samples.
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.metric_daily d
                join ouroboros.metric_definitions def on def.metric_id = d.metric_id
               where (def.dimension_kind is null) <> (d.dimension = '')
                  or (def.aggregation <> 'median' and d.meta ? 'samples')
                  or (def.aggregation = 'median'
                      and (jsonb_typeof(d.meta -> 'samples') is distinct from 'array'
                           or jsonb_array_length(d.meta -> 'samples') = 0
                           or exists (select 1
                                        from (select s::text::numeric as v,
                                                     lag(s::text::numeric) over (order by n) as prev,
                                                     jsonb_typeof(s) as kind
                                                from jsonb_array_elements(d.meta -> 'samples')
                                                       with ordinality as t(s, n)) o
                                       where o.kind <> 'number' or o.v < 0 or o.v < o.prev)
                           or d.value <> (select (percentile_cont(0.5) within group
                                                    (order by s::text::numeric))::numeric
                                            from jsonb_array_elements(d.meta -> 'samples') s)))),
  'metric_daily_shape_guard: every stored row matches its definition''s dimension and aggregation — a median is its sorted samples'' median');

-- --- the dimension vocabularies ---------------------------------------------------------------
--
-- Two of the five kinds are closed: the cause taxonomy (V079) and the estimator's efforts (V026).
-- Stages are workflow node ids, suites are report names and task kinds (V083) are whatever the
-- usage ledger recorded, so none of the three has a list to check.
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.metric_daily d
                join ouroboros.metric_definitions def on def.metric_id = d.metric_id
               where (def.dimension_kind = 'cause'
                      and d.dimension not in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                              'model_disagreement', 'other'))
                  or (def.dimension_kind = 'effort'
                      and d.dimension not in ('xs', 's', 'm', 'l', 'xl'))),
  'metric_daily_dimension_vocabulary: every stored cause is one of the five and every effort one of XS–XL — no bar without a label');

-- --- the taxonomy, at its source ---------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.intervention_events
               where cause not in ('infra_rig', 'ambiguous_ticket', 'policy_gate',
                                   'model_disagreement', 'other')),
  'intervention_events_cause_known: every stored intervention has one of the five causes');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.intervention_events
               where not ouroboros.intervention_signals_known(signals)),
  'intervention_events_signals_known: every stored intervention''s signals are in the vocabulary the rules read');

-- --- meta shapes -------------------------------------------------------------------------------
--
-- Always an object. The throughput row's tooltip extras are whole, non-negative numbers under
-- their two keys, and nothing else; a median carries only its samples; every other row carries
-- nothing. A formatted string is exactly what V076 says meta must never hold.
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.metric_daily where jsonb_typeof(meta) <> 'object'),
  'metric_daily_meta_object: every stored meta is a JSON object');

select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.metric_daily d
                join ouroboros.metric_definitions def on def.metric_id = d.metric_id
               where jsonb_typeof(d.meta) = 'object'
                 and case
                       when d.metric_id = 'merged_prs' then
                         exists (select 1 from jsonb_each(d.meta) e
                                  where e.key not in ('cost_cents', 'interventions')
                                     or jsonb_typeof(e.value) <> 'number'
                                     or e.value::text::numeric < 0
                                     or e.value::text::numeric <> trunc(e.value::text::numeric))
                       when def.aggregation = 'median' then
                         exists (select 1 from jsonb_object_keys(d.meta) k where k <> 'samples')
                       else d.meta <> '{}'::jsonb
                     end),
  'metric_daily_meta_shape: the tooltip extras are whole numbers under cost_cents and interventions, a median carries only samples, and nothing else carries meta');

-- ===========================================================================
-- 2. The catalogue, by name
-- ===========================================================================

select pg_temp.must_hold(
  (select count(*) = 1 from pg_constraint c
    where c.conrelid = 'ouroboros.metric_daily'::regclass
      and c.conname = 'metric_daily_grain_key' and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
          = array['day', 'dimension', 'metric_id', 'organization_id', 'repo_ref']),
  'metric_daily_grain_key: the grain is still a unique key over workspace, repository, metric, dimension and day');

select pg_temp.must_hold(
  (select count(*) = 3 from pg_constraint
    where conrelid = 'ouroboros.metric_daily'::regclass and contype = 'c'
      and conname in ('metric_daily_rate_components', 'metric_daily_meta_object',
                      'metric_daily_value_nonnegative')),
  'metric_daily_rate_components: the component, meta-object and non-negative checks are still declared');

select pg_temp.must_hold(
  (select count(*) = 1 from pg_constraint
    where conrelid = 'ouroboros.metric_daily'::regclass and contype = 'f'
      and conname = 'metric_daily_definition_fkey'
      and confrelid = 'ouroboros.metric_definitions'::regclass),
  'metric_daily_registered: metric_daily still references the registry by (metric_id, is_rate)');

select pg_temp.must_hold(
  (select count(*) = 1 from pg_trigger
    where tgrelid = 'ouroboros.metric_daily'::regclass
      and tgname = 'metric_daily_shape_guard' and tgenabled <> 'D'),
  'metric_daily_shape_guard: the shape guard is still an enabled trigger on metric_daily');

select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.intervention_events'::regclass and contype = 'c'
      and conname in ('intervention_events_cause_known', 'intervention_events_signals_known')),
  'intervention_events_cause_known: the cause and signal vocabularies are still declared');
