-- V089__calibration_bounded.sql — the calibration formula, bounded against a single outlier
-- (#515, BV.6, decision A6).
--
-- V085's factor is the ratio of sums over a cell's clean measurements:
--
--   factor = round( Σ measured.delta ÷ Σ raw prediction , 4 )
--
-- One wild measurement — a build-farm outage inside the window, a delta in the wrong direction
-- ten times the prediction — moves that ratio as far as it likes. BV.6 bounds it the way a person
-- checking it with a calculator would expect: **each measurement's contribution is winsorized**.
-- Its ratio to its own raw prediction is held to [0, 2] before it is summed:
--
--   raw          = predicted.delta ÷ predicted.calibration.factor     (V085, unchanged)
--   contribution = clamp(measured.delta ÷ raw, 0, 2) × raw            rounded to 6 places
--   factor       = round( Σ contribution ÷ Σ raw , 4 )
--
-- So a change that made things worse counts as having delivered nothing (ratio 0) rather than
-- dragging the factor negative, and an over-delivery counts at most double. Within the band the
-- formula is exactly V085's: the seeded ccache row, −72 against −110, is 0.6545 either way.
--
-- `analyzer_calibration_history.measured_sum` now holds Σ contribution — the bounded sum the
-- factor is the ratio of — and the history guard, which compares a new row with
-- `analyzer_calibration_inputs()`, holds every later update to the new arithmetic. Rows already
-- written keep the sums they were computed with; the trail is append-only.

-- One measurement's bounded contribution to its cell's factor.
--   p_measured_delta — measured.delta
--   p_raw            — the raw prediction, predicted.delta ÷ predicted.calibration.factor
-- Returns clamp(p_measured_delta ÷ p_raw, 0, 2) × p_raw, rounded to 6 places; null for a null
-- input or a zero raw prediction.
create function ouroboros.analyzer_calibration_contribution(p_measured_delta numeric, p_raw numeric)
returns numeric language sql immutable as $$
  -- Explicit, because greatest() and least() skip a null rather than propagate it.
  select case when p_measured_delta is null or p_raw is null or p_raw = 0 then null
              else round(least(greatest(p_measured_delta / p_raw, 0), 2) * p_raw, 6) end
$$;

comment on function ouroboros.analyzer_calibration_contribution(numeric, numeric) is
  'One measurement''s contribution to its calibration factor (#515): its measured ÷ raw-predicted ratio held to [0, 2], times the raw prediction, rounded to 6 places — so no single measurement moves the factor further than twice its prediction, or below nothing.';

create or replace function ouroboros.analyzer_calibration_inputs(
  p_org text, p_repo ouroboros.repo_ref, p_analyzer text, p_impact_class text)
returns table (measurement_ids uuid[], sample_count integer, measured_sum numeric,
               predicted_sum numeric)
language sql stable as $$
  with cell as (
    select m.id,
           ouroboros.analysis_json_number(m.measured -> 'delta') as measured_delta,
           ouroboros.analysis_json_number(m.predicted -> 'delta')
             / ouroboros.analysis_json_number(m.predicted #> '{calibration,factor}') as raw
      from ouroboros.suggestion_measurements m
     where m.organization_id = p_org and m.repo_ref = p_repo
       and m.verdict in ('delivered', 'under', 'over')
       and m.predicted #>> '{calibration,analyzer}' = p_analyzer
       and m.predicted #>> '{calibration,impact_class}' = p_impact_class)
  select coalesce(array_agg(c.id order by c.id), '{}'),
         count(*)::integer,
         coalesce(sum(ouroboros.analyzer_calibration_contribution(c.measured_delta, c.raw)), 0),
         coalesce(round(sum(c.raw), 6), 0)
    from cell c
$$;

comment on function ouroboros.analyzer_calibration_inputs(text, ouroboros.repo_ref, text, text) is
  'The calibration formula''s inputs for one cell (#508, bounded by #515): the measurements that closed delivered, under or over (never pending or confounded), their count, Σ analyzer_calibration_contribution() — each measured delta held to [0, 2] times its raw prediction — and Σ (predicted.delta ÷ predicted.calibration.factor).';

comment on column ouroboros.analyzer_calibration_history.measured_sum is
  'Σ analyzer_calibration_contribution(measured.delta, raw) over measurement_ids — each measurement held to [0, 2] times its raw prediction (#515). Rows written before V089 hold the unbounded Σ measured.delta they were computed with.';
comment on column ouroboros.analyzer_calibration.factor is
  'round(Σ bounded contribution ÷ Σ (predicted.delta ÷ predicted.calibration.factor), 4) over the cell''s measurements that closed delivered, under or over; each contribution is the measured delta held to [0, 2] times its raw prediction (#515). A plain multiplier.';
comment on function ouroboros.recalibrate_analyzer(text, ouroboros.repo_ref, text, text) is
  'The calibration write (#508, bounded by #515): factor = round(Σ analyzer_calibration_contribution ÷ Σ raw prediction, 4) over the cell''s measurements that closed delivered, under or over. Upserts analyzer_calibration and appends the analyzer_calibration_history row citing every input and the newly closed ones. Idempotent — a call with nothing new writes nothing. Returns the factor, or null when never calibrated.';
