-- V109__investigation_estimate_outcomes.sql — which calibration produced an investigation's
-- estimate, and the recorded comparison of that estimate against what the run actually used
-- (#622, CM.3).
--
-- Mockup 22's composer prints `est. 40–60 sources · ~$6` before anybody spends anything, and
-- decision V5 says that line is **computed, never invented**: depth preset × enabled tools ×
-- the routed alias's price. CM.3's estimator (ouroboros-rest) computes it from calibrated
-- constants, and V106 already gave the investigation somewhere to keep the answer —
-- `investigations.estimate`. This migration adds the two things that turn a stored estimate
-- into something that can be *answered for*:
--
--   1. **`investigations.estimate_calibration_version`** — which set of calibration constants
--      produced the estimate. The constants are code and will change; an estimate that does not
--      say which constants it came from cannot be graded against them later. Present exactly
--      when `estimate` is (`investigations_estimate_calibration_version_paired`): a version with
--      no estimate is a claim about nothing, and an estimate with no version is ungradeable.
--   2. **`investigation_estimate_outcomes`** — one row per investigation that has both an
--      estimate and actuals: the estimate as it stood, the actuals as measured, and two
--      generated verdicts — did the sources land inside the range, did the spend. Written by
--      `record_investigation_estimate_outcome()`, the one writer, after the run records its
--      actuals (CM.1, #620).
--
-- ---------------------------------------------------------------------------
-- Why a recorded row and not a view
-- ---------------------------------------------------------------------------
--
-- The comparison is exactly a join of two columns V106 already holds, so a view would answer
-- *today's* question. It would not answer calibration's: "how did calibration v1 do on deep
-- dives?" must stay the same answer after somebody re-estimates a queued investigation or a
-- later migration reshapes `investigations`. The row is the comparison **as recorded at
-- reconciliation** — the BI.4 discipline (V077's `estimate_outcomes`, #435): calibration is
-- deterministic arithmetic over real history, never over whatever the rows say now.
--
-- The verdicts are generated columns so they cannot disagree with the numbers beside them,
-- and `cost_within_estimate` is **null** — not false — whenever either side of the cost is
-- unknown: an unpriced alias estimated no dollars (V5's honesty rule), and an unpriced run
-- spent an unknown amount, and neither is a miss.
--
-- The function is deliberately *not* `security definer`: it reads and writes only rows of the
-- workspace it is handed, as the caller, under the caller's grants.
--
-- Revert forward:
--   drop function ouroboros.record_investigation_estimate_outcome(text, uuid);
--   drop table ouroboros.investigation_estimate_outcomes;
--   alter table ouroboros.investigations
--     drop constraint investigations_organization_id_key,
--     drop column estimate_calibration_version;

-- ---------------------------------------------------------------------------
-- investigations — the calibration an estimate was made under.
-- ---------------------------------------------------------------------------
alter table ouroboros.investigations
  add column estimate_calibration_version integer
    constraint investigations_estimate_calibration_version_positive
      check (estimate_calibration_version is null or estimate_calibration_version >= 1),
  add constraint investigations_estimate_calibration_version_paired
    check ((estimate is null) = (estimate_calibration_version is null)),
  -- The target of investigation_estimate_outcomes' composite foreign key: an outcome is only
  -- ever recorded in the workspace of the investigation it grades.
  add constraint investigations_organization_id_key unique (organization_id, id);

comment on column ouroboros.investigations.estimate_calibration_version is
  'The version of CM.3''s estimator calibration constants that produced estimate (#622). Present exactly when estimate is; what lets an outcome be graded against the constants that made it.';
comment on constraint investigations_estimate_calibration_version_paired on ouroboros.investigations is
  'An estimate carries the calibration version that produced it, and a version is never stored without an estimate (#622).';

-- ---------------------------------------------------------------------------
-- investigation_estimate_outcomes — estimate vs actuals, as recorded.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_estimate_outcomes (
  -- One outcome per investigation; a re-reconciliation replaces it.
  investigation_id         uuid        primary key,

  -- The workspace. Cascade, as everything a workspace owns, and half of the composite key.
  organization_id          text        not null
                                       references ouroboros.organization ("id") on delete cascade,

  -- The calibration constants the estimate was computed under — investigations'
  -- estimate_calibration_version, copied at reconciliation.
  calibration_version      integer     not null
                                       constraint investigation_estimate_outcomes_calibration_version_positive
                                         check (calibration_version >= 1),

  -- The inputs the estimate was a function of, copied so the calibration sample is
  -- self-describing: depth, tools and the alias it was priced against.
  depth                    text        not null
                                       constraint investigation_estimate_outcomes_depth
                                         check (depth in ('quick', 'standard', 'deep_dive')),
  tools_enabled            jsonb       not null
                                       constraint investigation_estimate_outcomes_tools_enabled_shape
                                         check (ouroboros.research_tool_set_valid(tools_enabled)),
  -- provenance ->> 'alias', or null when the investigation recorded none.
  alias                    text
                           constraint investigation_estimate_outcomes_alias_present
                             check (alias is null or btrim(alias) <> ''),

  -- The estimate.
  estimated_sources_min    integer     not null,
  estimated_sources_max    integer     not null,
  -- Null together: the alias was unpriced and no dollar figure was estimated (V5).
  estimated_cost_cents_min integer,
  estimated_cost_cents_max integer,

  -- The actuals.
  actual_sources           integer     not null
                                       constraint investigation_estimate_outcomes_actual_sources_nonneg
                                         check (actual_sources >= 0),
  -- Null when the run's spend could not be priced.
  actual_spend_cents       integer
                           constraint investigation_estimate_outcomes_actual_spend_nonneg
                             check (actual_spend_cents is null or actual_spend_cents >= 0),

  -- The verdicts, generated so they cannot drift from the numbers beside them.
  sources_within_estimate  boolean     generated always as
                                         (actual_sources between estimated_sources_min
                                                             and estimated_sources_max) stored,
  -- Null when either side of the cost is unknown — not estimated, or not priced. Neither is a miss.
  cost_within_estimate     boolean     generated always as
                                         (case when estimated_cost_cents_min is null
                                                 or actual_spend_cents is null then null
                                               else actual_spend_cents between estimated_cost_cents_min
                                                                           and estimated_cost_cents_max
                                          end) stored,

  recorded_at              timestamptz not null default now(),

  constraint investigation_estimate_outcomes_investigation_fk
    foreign key (organization_id, investigation_id)
    references ouroboros.investigations (organization_id, id) on delete cascade,
  constraint investigation_estimate_outcomes_sources_range
    check (estimated_sources_min >= 0 and estimated_sources_min <= estimated_sources_max),
  constraint investigation_estimate_outcomes_cost_range
    check ((estimated_cost_cents_min is null) = (estimated_cost_cents_max is null)
           and (estimated_cost_cents_min is null
                or (estimated_cost_cents_min >= 0
                    and estimated_cost_cents_min <= estimated_cost_cents_max)))
);

comment on table ouroboros.investigation_estimate_outcomes is
  'Estimator calibration for investigations (#622, CM.3; decision V5) — one row per investigation with both an estimate and actuals: the estimate, its calibration version and inputs, the actuals, and generated within-range verdicts. Written by record_investigation_estimate_outcome(); the BI.4 (#435) discipline, so recalibration is arithmetic over recorded history.';
comment on column ouroboros.investigation_estimate_outcomes.calibration_version is
  'The estimator calibration version the estimate was computed under (investigations.estimate_calibration_version).';
comment on column ouroboros.investigation_estimate_outcomes.alias is
  'The alias the investigation ran under (provenance ->> alias), or null when none was recorded.';
comment on column ouroboros.investigation_estimate_outcomes.estimated_cost_cents_min is
  'Low end of the estimated cost in cents; null with its max when the alias was unpriced and no dollar figure was estimated.';
comment on column ouroboros.investigation_estimate_outcomes.actual_spend_cents is
  'What the run spent in cents, or null when its spend could not be priced.';
comment on column ouroboros.investigation_estimate_outcomes.sources_within_estimate is
  'Generated: actual_sources lies within [estimated_sources_min, estimated_sources_max].';
comment on column ouroboros.investigation_estimate_outcomes.cost_within_estimate is
  'Generated: actual_spend_cents lies within the estimated cost range; null when either side is unknown.';

create index investigation_estimate_outcomes_calibration_idx
  on ouroboros.investigation_estimate_outcomes (organization_id, calibration_version);

-- record_investigation_estimate_outcome(organization, investigation) — reconcile one
-- investigation's estimate against its actuals.
--   p_organization_id  — the workspace the investigation must belong to
--   p_investigation_id — the investigation to reconcile
--   returns the recorded row; no row when the investigation is not in that workspace or lacks
--   an estimate, a calibration version or actuals. Idempotent: a replay re-derives the same
--   figures and refreshes recorded_at.
create function ouroboros.record_investigation_estimate_outcome(p_organization_id text,
                                                                p_investigation_id uuid)
returns setof ouroboros.investigation_estimate_outcomes
language sql as $$
  insert into ouroboros.investigation_estimate_outcomes as o
      (investigation_id, organization_id, calibration_version, depth, tools_enabled, alias,
       estimated_sources_min, estimated_sources_max,
       estimated_cost_cents_min, estimated_cost_cents_max,
       actual_sources, actual_spend_cents)
  select i.id, i.organization_id, i.estimate_calibration_version, i.depth, i.tools_enabled,
         i.provenance ->> 'alias',
         (i.estimate #>> '{sources,min}')::integer, (i.estimate #>> '{sources,max}')::integer,
         (i.estimate #>> '{cost_cents,min}')::integer, (i.estimate #>> '{cost_cents,max}')::integer,
         (i.actuals ->> 'sources_used')::integer, (i.actuals ->> 'spend_cents')::integer
    from ouroboros.investigations i
   where i.organization_id = p_organization_id
     and i.id = p_investigation_id
     and i.estimate is not null
     and i.estimate_calibration_version is not null
     and i.actuals is not null
  on conflict (investigation_id) do update
     set organization_id          = excluded.organization_id,
         calibration_version      = excluded.calibration_version,
         depth                    = excluded.depth,
         tools_enabled            = excluded.tools_enabled,
         alias                    = excluded.alias,
         estimated_sources_min    = excluded.estimated_sources_min,
         estimated_sources_max    = excluded.estimated_sources_max,
         estimated_cost_cents_min = excluded.estimated_cost_cents_min,
         estimated_cost_cents_max = excluded.estimated_cost_cents_max,
         actual_sources           = excluded.actual_sources,
         actual_spend_cents       = excluded.actual_spend_cents,
         recorded_at              = now()
  returning o.*;
$$;

comment on function ouroboros.record_investigation_estimate_outcome(text, uuid) is
  'Reconciles one investigation''s estimate against its actuals (#622): upserts its investigation_estimate_outcomes row from the investigations row of that workspace and returns it, or returns no row when the investigation is elsewhere or lacks an estimate, calibration version or actuals. Idempotent. Runs as the caller.';

-- ---------------------------------------------------------------------------
-- The application role.
--
-- The function runs as the caller, so the service writes the table through it and needs the
-- table's insert and update. No delete: an outcome goes with its investigation or its workspace,
-- and calibration history is not something the application trims. The new column on
-- investigations is covered by V106's table-level grant.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.investigation_estimate_outcomes to ouroboros_app;
grant execute on function ouroboros.record_investigation_estimate_outcome(text, uuid) to ouroboros_app;
