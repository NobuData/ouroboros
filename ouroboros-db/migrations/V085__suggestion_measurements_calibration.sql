-- V085__suggestion_measurements_calibration.sql — `suggestion_measurements`,
-- `analyzer_measurement_policies`, `analyzer_calibration` and `analyzer_calibration_history`:
-- what the Build Analyzer predicted, what happened over the following fortnight, and how its
-- model was corrected (#508, BU.3, decision A6).
--
-- Mockup 18's **Predicted vs Measured** card —
--
--   Test-suite split (applied Jul 2)   predicted −3m 40s / measured −3m 55s ✓
--   ccache warm-up   (applied Jul 9)   predicted −1m 50s / measured −1m 12s
--                                      under-delivered — analyzer revised its cache model
--
-- — is two rows of `suggestion_measurements`, and the note's *"revised its cache model"* is one
-- row of `analyzer_calibration_history`. The under-delivered row is the most valuable thing on
-- the page, and it only exists if the prediction was written down before the outcome was known.
--
-- ===========================================================================
-- THE PREDICTION IS FROZEN AT APPLY — baseline, predicted
-- ===========================================================================
--
-- BV.5 (#514) inserts the row when the change goes in; BV.6's job (#515) closes it.
--
--   baseline   { "window": { "from": "2026-06-18", "to": "2026-07-01" }, "value": 912 }
--   predicted  { "delta": -220, "unit": "seconds",
--                "basis": { "method": "measured", "sample_size": 214, "description": "…" },
--                "calibration": { "analyzer": "workflow_outcome",
--                                 "impact_class": "duration_delta", "factor": 1 } }
--
--   * `baseline` — the target metric over the window before the apply (`to` is no later than the
--     apply day) and its value.
--   * `predicted` — the delta the composer promised, its unit (`seconds | interventions |
--     count`, the suggestion impact's vocabulary) and the composer's basis at the time
--     (`measured` with its sample, or `extrapolated`; an unquantified basis is a spike, and a
--     spike is never applied). `calibration` is the cell of `analyzer_calibration` the composer
--     read and the factor it multiplied by — 1 when the cell had no row. It is what lets a later
--     correction be computed against the *uncorrected* prediction (see THE FORMULA).
--   * `baseline.value`, `measured.value` and both deltas are all in `predicted.unit`, so the
--     arithmetic below needs no conversion. `target_metric` names the `metric_definitions` row
--     (#432) the job reads them from — the same rollups the rest of the product reads.
--
-- `baseline` and `predicted` are **write-once**: `suggestion_measurements_guard` refuses any
-- update that touches either (`suggestion_measurements_prediction_frozen`), and with them the
-- apply itself — suggestion, `applied_at`, `target_metric`, `window_days` and the verdict bands
-- (`suggestion_measurements_application_frozen`). A prediction that can be edited after the
-- fact is not a prediction. The job fills `measured`, `verdict`, `confounds`, `note` and
-- `closed_at`, once; a closed row never changes again.
--
-- ===========================================================================
-- THE WINDOW — window_days, stored per row
-- ===========================================================================
--
-- Days are UTC days (V078's rule). With `applied_on` the apply's UTC date:
--
--   day 0            the apply day itself
--   day 1 … day N    the measured window, N = `window_days`; `window_ends_on` = applied_on + N
--   close            any day after `window_ends_on` (`suggestion_measurements_closed_after_window`)
--
-- `window_days` and the two verdict bands are copied from the workspace's configuration
-- (`ouroboros.analyzer_measurement_policy()`) when the row is inserted — an explicit value is
-- kept — and are frozen with the prediction. Changing the configuration therefore changes the
-- *next* application; a measurement already open keeps the window and the definition of
-- "delivered" it was applied under.
--
-- `ouroboros.suggestion_measurement_day(applied_at, window_days, at)` is the card's pending
-- state — *day 6 of 14* — as arithmetic over the row, so there is no progress table to drift.
--
-- ===========================================================================
-- THE VERDICT IS ARITHMETIC — and its bands are configuration
-- ===========================================================================
--
--   measured   { "window": { "from": "2026-07-03", "to": "2026-07-16" },
--                "value": 677, "delta": -235 }
--
--   measured.delta = measured.value − baseline.value     (suggestion_measurements_measured_delta)
--   ratio          = measured.delta ÷ predicted.delta
--
--   confounds is not empty            ⇒ confounded
--   ratio <  verdict_under_below      ⇒ under
--   ratio >  verdict_over_above       ⇒ over
--   otherwise                         ⇒ delivered            (both bands inclusive)
--
-- That is `ouroboros.suggestion_measurement_verdict()`, and
-- `suggestion_measurements_verdict_computed` holds every closed row to it — the stored verdict is
-- the one a reader gets by hand from the stored numbers and the stored bands. A measured delta in
-- the opposite direction to the prediction is a negative ratio, which is `under`.
--
-- The bands are configuration: `analyzer_measurement_policies` holds one row per workspace —
-- `verdict_under_below` (0.80), `verdict_over_above` (1.20) and `window_days` (14) — created
-- lazily, as V011's settings and V075's policies are: a workspace with no row is at the defaults,
-- and `analyzer_measurement_policy()` answers them either way. So "delivered" is defined in one
-- inspectable, adjustable place rather than in the job's source.
--
--   predicted −220 · measured −235 ⇒ ratio 1.07 ⇒ delivered ✓
--   predicted −110 · measured  −72 ⇒ ratio 0.65 ⇒ under
--
-- ===========================================================================
-- CONFOUNDS ARE FIRST-CLASS — confounds
-- ===========================================================================
--
-- Fourteen days is long enough for a second suggestion to be applied or a dependency to land.
-- The measured delta then belongs to both, so the honest verdict is `confounded`, with what
-- interfered listed:
--
--   [ { "kind": "application",  "id": "<suggestion id>", "date": "2026-07-08" },
--     { "kind": "change_point", "id": "<finding id>",    "date": "2026-07-11" } ]
--
--   * `application`  — another suggestion of the same repository applied on that date; `id` is
--     its `analysis_suggestions.id`, and it must have a measurement applied that day.
--   * `change_point` — a change-point finding of the same repository dated that day; `id` is its
--     `analysis_findings.id`.
--
-- Each entry resolves **when it is recorded** (`suggestion_measurements_confound_resolves`) and
-- its date lies inside the window, day 0 included. They are references, not foreign keys, for
-- V081's reason: retention removing a finding later must not rewrite the record. A row with any
-- confound cannot close as delivered, under or over, and a row with none cannot close as
-- confounded — the verdict function takes the list's emptiness as an input. Which events count
-- as interference is the measurement job's finding (BV.6); what the schema guarantees is that a
-- recorded one is never silently counted as a win.
--
-- ===========================================================================
-- THE FORMULA — analyzer_calibration, derivable by hand
-- ===========================================================================
--
-- *"The analyzer's model retrains on its own misses"* is a multiplier per (repository, analyzer,
-- impact class) — `{cache_window, duration_delta} = 0.65` — that the composer (BV.4) multiplies
-- its raw estimate by. Its value is:
--
--   raw prediction of a measurement = predicted.delta ÷ predicted.calibration.factor
--   factor = round( Σ measured.delta ÷ Σ raw prediction , 4 )
--
-- over **every** measurement of that cell that closed `delivered`, `under` or `over`. Pending
-- and confounded measurements are never inputs. Dividing each prediction by the factor it was
-- made with is what stops the correction compounding: once the factor is 0.65 the next prediction
-- is already scaled, and comparing its outcome to the scaled number would correct twice. The
-- ratio of sums is the mean of the per-measurement ratios weighted by the size of each raw
-- prediction. No row means a factor of 1.
--
--   predicted −110 (factor 1) · measured −72
--     ⇒ −72 ÷ (−110 ÷ 1) = 0.6545   calibration{cache_window, duration_delta} 1.00 → 0.65
--
-- `ouroboros.recalibrate_analyzer()` is the write. It reads the inputs
-- (`analyzer_calibration_inputs()`), and when a measurement has closed since the last update it
-- sets the factor and appends an `analyzer_calibration_history` row carrying `from_factor`,
-- `to_factor`, both sums, `measurement_ids` — every measurement the new value is computed
-- from — and `added_measurement_ids`, the ones that moved it. Two rules make the trail
-- unavoidable rather than conventional:
--
--   * `analyzer_calibration_history_guard` refuses a history row whose inputs are not exactly
--     the cell's eligible measurements, or that adds none, and refuses any later revision;
--   * `analyzer_calibration_traces` (deferred to commit) refuses a factor that is not its latest
--     history row's `to_factor` — a factor cannot change without the row that says why.
--
-- **Retention.** Measurements hang off their suggestion and calibration off the workspace; both
-- are the accountability record and no retention class deletes them. The service role may not
-- delete either.

-- ---------------------------------------------------------------------------
-- analyzer_measurement_policies — the default window and the verdict bands, per workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.analyzer_measurement_policies (
  -- The workspace, and the key the settings upsert conflicts on. Cascade.
  organization_id     text         not null primary key
                                   references ouroboros.organization ("id") on delete cascade,

  -- How many UTC days an applied suggestion is measured for.
  window_days         integer      not null default 14
                                   constraint analyzer_measurement_policies_window_days_range
                                     check (window_days between 1 and 90),

  -- THE VERDICT IS ARITHMETIC: a ratio below the first is under, above the second is over.
  verdict_under_below numeric(4,2) not null default 0.80,
  verdict_over_above  numeric(4,2) not null default 1.20,

  -- Who last changed it; set null if the person is removed, for V011's reason.
  updated_by          text         references ouroboros."user" ("id") on delete set null,

  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint analyzer_measurement_policies_verdict_bands
    check (verdict_under_below > 0 and verdict_under_below <= 1 and verdict_over_above >= 1)
);

comment on table ouroboros.analyzer_measurement_policies is
  'How a workspace''s applied Build Analyzer suggestions are measured (#508, decision A6) — the window in days and the verdict bands. One row per workspace, created lazily: a workspace with no row is at the defaults (14 days, 0.80 / 1.20). Read through ouroboros.analyzer_measurement_policy(); copied onto each suggestion_measurements row at apply, so a change here never alters an open measurement.';
comment on column ouroboros.analyzer_measurement_policies.window_days is
  'How many UTC days after the apply day a suggestion is measured for. 1–90, default 14.';
comment on column ouroboros.analyzer_measurement_policies.verdict_under_below is
  'The lower verdict band: a measured ÷ predicted ratio below it closes as under. In (0, 1], default 0.80.';
comment on column ouroboros.analyzer_measurement_policies.verdict_over_above is
  'The upper verdict band: a measured ÷ predicted ratio above it closes as over. At least 1, default 1.20.';
comment on column ouroboros.analyzer_measurement_policies.updated_by is
  'Who last saved the policy; null after the person is removed.';

create trigger analyzer_measurement_policies_touch_updated_at
  before update on ouroboros.analyzer_measurement_policies
  for each row execute function ouroboros.touch_updated_at();

-- The window and verdict bands a workspace's next application is recorded with.
--   p_org — the workspace
-- Returns exactly one row: the workspace's policy, or the defaults when it has never set one.
-- The defaults are written here and as the column defaults; tests/constraints.sql binds the two,
-- as it binds V011's, because a function cannot spell "whatever that column defaults to".
create function ouroboros.analyzer_measurement_policy(p_org text)
returns table (window_days integer, verdict_under_below numeric, verdict_over_above numeric)
language sql stable as $$
  select coalesce(p.window_days, 14),
         coalesce(p.verdict_under_below, 0.80),
         coalesce(p.verdict_over_above, 1.20)
    from (select p_org as id) o
    left join ouroboros.analyzer_measurement_policies p on p.organization_id = o.id
$$;

comment on function ouroboros.analyzer_measurement_policy(text) is
  'The measurement window and verdict bands in force for a workspace (#508): its analyzer_measurement_policies row, or the defaults (14 days, 0.80 / 1.20) when it has none. The suggestion_measurements guard copies them onto each new row.';

-- ---------------------------------------------------------------------------
-- JSON helpers.
-- ---------------------------------------------------------------------------

-- A JSON value as a calendar date, or null when it is not a real ISO date string.
--   v — any jsonb value, or null
-- Returns the date, or null — for `"2026-02-30"` as much as for `"July 2"`.
create function ouroboros.analysis_json_date(v jsonb)
returns date language plpgsql immutable as $$
declare
  s text;
begin
  if v is null or jsonb_typeof(v) <> 'string' then
    return null;
  end if;
  s := v #>> '{}';
  if s !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return make_date(substr(s, 1, 4)::integer, substr(s, 6, 2)::integer, substr(s, 9, 2)::integer);
exception when datetime_field_overflow then
  return null;
end;
$$;

comment on function ouroboros.analysis_json_date(jsonb) is
  'A jsonb value as a date, or null when it is not a real YYYY-MM-DD date string (#508).';

-- Whether a JSON value is a window of whole days.
--   w — the window
-- Returns true for {from, to} holding two real ISO dates in order.
create function ouroboros.analysis_json_day_window_valid(w jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(w) = 'object'
    and ouroboros.analysis_json_date(w -> 'from') <= ouroboros.analysis_json_date(w -> 'to'),
    false)
$$;

comment on function ouroboros.analysis_json_day_window_valid(jsonb) is
  'Whether a jsonb value is {from, to} with two real ISO dates, from ≤ to (#508).';

-- ---------------------------------------------------------------------------
-- The measurement contracts.
-- ---------------------------------------------------------------------------

-- Whether a baseline has the shape frozen at apply.
--   b — the baseline
-- Returns true for {window: {from, to}, value}.
create function ouroboros.suggestion_measurement_baseline_valid(b jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(b) = 'object'
    and ouroboros.analysis_json_day_window_valid(b -> 'window')
    and ouroboros.analysis_json_number(b -> 'value') is not null,
    false)
$$;

comment on function ouroboros.suggestion_measurement_baseline_valid(jsonb) is
  'The baseline contract (#508) — {window: {from, to}, value}: the target metric over the window before the apply, in predicted.unit.';

-- Whether a prediction has the shape frozen at apply.
--   p — the prediction
-- Returns true for {delta ≠ 0, unit, basis: {method: measured|extrapolated, description,
-- sample_size (measured)}, calibration: {analyzer, impact_class, factor ≠ 0}}.
create function ouroboros.suggestion_measurement_predicted_valid(p jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and ouroboros.analysis_json_number(p -> 'delta') <> 0
    and p ->> 'unit' in ('seconds', 'interventions', 'count')
    and jsonb_typeof(p -> 'basis') = 'object'
    and p #>> '{basis,method}' in ('measured', 'extrapolated')
    and ouroboros.analysis_json_text(p #> '{basis,description}') is not null
    and (p #>> '{basis,method}' <> 'measured'
         or ouroboros.analysis_json_count(p #> '{basis,sample_size}') >= 1)
    and jsonb_typeof(p -> 'calibration') = 'object'
    and ouroboros.analysis_json_text(p #> '{calibration,analyzer}') ~ '^[a-z][a-z0-9_]{0,62}$'
    and ouroboros.analysis_json_text(p #> '{calibration,impact_class}') ~ '^[a-z][a-z0-9_]{0,62}$'
    and ouroboros.analysis_json_number(p #> '{calibration,factor}') <> 0,
    false)
$$;

comment on function ouroboros.suggestion_measurement_predicted_valid(jsonb) is
  'The prediction contract (#508) — {delta ≠ 0, unit: seconds|interventions|count, basis: {method: measured|extrapolated, description, sample_size (measured)}, calibration: {analyzer, impact_class, factor ≠ 0}}. calibration is the analyzer_calibration cell the composer read and the factor it applied (1 when the cell had no row).';

-- Whether a measured result has the shape the job writes at window close.
--   m — the measured result; null is answered null so a nullable column's check passes
-- Returns true for {window: {from, to}, value, delta}.
create function ouroboros.suggestion_measurement_measured_valid(m jsonb)
returns boolean language sql immutable as $$
  select case when m is null then null else coalesce(
    jsonb_typeof(m) = 'object'
    and ouroboros.analysis_json_day_window_valid(m -> 'window')
    and ouroboros.analysis_json_number(m -> 'value') is not null
    and ouroboros.analysis_json_number(m -> 'delta') is not null,
    false)
  end
$$;

comment on function ouroboros.suggestion_measurement_measured_valid(jsonb) is
  'The measured contract (#508) — {window: {from, to}, value, delta}: the target metric over the measured window and its change from baseline.value, in predicted.unit. Null in, null out.';

-- Whether a confound list is well-formed and lies inside a measurement's window.
--   c      — the confounds
--   p_from — the apply day (day 0)
--   p_to   — the window's last day
-- Returns true for an array of distinct {kind: application|change_point, id: uuid, date}
-- entries, each dated from p_from to p_to inclusive. An empty array is valid.
create function ouroboros.suggestion_measurement_confounds_valid(c jsonb, p_from date, p_to date)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(c) is distinct from 'array' then false else coalesce(
    not exists (
      select 1 from jsonb_array_elements(c) e
       where case when jsonb_typeof(e) <> 'object' then true else coalesce(not (
               (select array_agg(k order by k) from jsonb_object_keys(e) k)
                 = array['date', 'id', 'kind']
               and e ->> 'kind' in ('application', 'change_point')
               and jsonb_typeof(e -> 'id') = 'string'
               and e ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and ouroboros.analysis_json_date(e -> 'date') between p_from and p_to), true) end)
    and (select count(distinct e) from jsonb_array_elements(c) e) = jsonb_array_length(c),
    false) end
$$;

comment on function ouroboros.suggestion_measurement_confounds_valid(jsonb, date, date) is
  'The confounds contract (#508) — an array of distinct {kind: application|change_point, id: lowercase uuid, date} entries, each dated inside the window (apply day to last day, inclusive). Empty is valid.';

-- The verdict a closed measurement must carry.
--   p_predicted_delta — predicted.delta
--   p_measured_delta  — measured.delta
--   p_under_below     — the lower band: a ratio below it is under
--   p_over_above      — the upper band: a ratio above it is over
--   p_confounded      — whether the measurement lists any confound
-- Returns confounded | under | over | delivered, or null when there is no ratio to take (a
-- missing number, or a predicted delta of zero).
create function ouroboros.suggestion_measurement_verdict(
  p_predicted_delta numeric, p_measured_delta numeric, p_under_below numeric,
  p_over_above numeric, p_confounded boolean)
returns text language sql immutable as $$
  select case
    when p_measured_delta / nullif(p_predicted_delta, 0) is null
      or p_under_below is null or p_over_above is null or p_confounded is null then null
    when p_confounded then 'confounded'
    when p_measured_delta / nullif(p_predicted_delta, 0) < p_under_below then 'under'
    when p_measured_delta / nullif(p_predicted_delta, 0) > p_over_above then 'over'
    else 'delivered'
  end
$$;

comment on function ouroboros.suggestion_measurement_verdict(numeric, numeric, numeric, numeric, boolean) is
  'The verdict arithmetic (#508): confounded when any confound is listed; otherwise ratio = measured ÷ predicted, under below p_under_below, over above p_over_above, delivered in between (bands inclusive). Null when there is no ratio.';

-- Where an open measurement is in its window — the card's "day N of 14".
--   p_applied_at  — the measurement's applied_at
--   p_window_days — its window_days
--   p_at          — the moment asked about; now by default
-- Returns the number of UTC days since the apply day, held between 0 and p_window_days.
create function ouroboros.suggestion_measurement_day(
  p_applied_at timestamptz, p_window_days integer, p_at timestamptz default now())
returns integer language sql immutable as $$
  select least(p_window_days,
               greatest(0, (p_at at time zone 'UTC')::date
                           - (p_applied_at at time zone 'UTC')::date))
$$;

comment on function ouroboros.suggestion_measurement_day(timestamptz, integer, timestamptz) is
  'Day N of a measurement''s window (#508): UTC days since the apply day, 0 on the apply day and never above window_days. The pending state of the predicted-vs-measured card.';

-- ---------------------------------------------------------------------------
-- suggestion_measurements — one applied suggestion, predicted and then measured.
-- ---------------------------------------------------------------------------
create table ouroboros.suggestion_measurements (
  id                  uuid        primary key default gen_random_uuid(),

  -- The applied suggestion, and its workspace and repo under the composite key. Cascade: a
  -- measurement is its suggestion's record. One measurement per suggestion.
  suggestion_id       uuid        not null,
  organization_id     text        not null,
  repo_ref            ouroboros.repo_ref not null,

  -- The apply. applied_by is set null if the person is removed.
  applied_at          timestamptz not null default now(),
  applied_by          text        references ouroboros."user" ("id") on delete set null,

  -- The BI metric (#432) the job reads baseline and measured from.
  target_metric       text        not null
                                  references ouroboros.metric_definitions (metric_id),

  -- THE PREDICTION IS FROZEN AT APPLY.
  baseline            jsonb       not null
                                  constraint suggestion_measurements_baseline_shape
                                    check (ouroboros.suggestion_measurement_baseline_valid(baseline)),
  predicted           jsonb       not null
                                  constraint suggestion_measurements_predicted_shape
                                    check (ouroboros.suggestion_measurement_predicted_valid(predicted)),

  -- THE WINDOW, and the verdict bands. No column defaults: the guard copies the workspace's
  -- configuration into whichever of the three the insert leaves null.
  window_days         integer     not null
                                  constraint suggestion_measurements_window_days_range
                                    check (window_days between 1 and 90),
  verdict_under_below numeric(4,2) not null,
  verdict_over_above  numeric(4,2) not null,

  -- Day 0 and the window's last day, as UTC dates.
  applied_on          date        not null
                                  generated always as ((applied_at at time zone 'UTC')::date) stored,
  window_ends_on      date        not null
                                  generated always as
                                    ((applied_at at time zone 'UTC')::date + window_days) stored,

  -- Filled by the job at window close.
  measured            jsonb
                      constraint suggestion_measurements_measured_shape
                        check (ouroboros.suggestion_measurement_measured_valid(measured)),
  verdict             text        not null default 'pending'
                                  constraint suggestion_measurements_verdict_known
                                    check (verdict in ('pending', 'delivered', 'under', 'over',
                                                       'confounded')),
  confounds           jsonb       not null default '[]'::jsonb,

  -- The composed revision line — "under-delivered — analyzer revised its cache model".
  note                text
                      constraint suggestion_measurements_note_present
                        check (btrim(note) <> '' and length(note) <= 1024),
  closed_at           timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint suggestion_measurements_suggestion_fkey
    foreign key (suggestion_id, organization_id, repo_ref)
    references ouroboros.analysis_suggestions (id, organization_id, repo_ref) on delete cascade,
  constraint suggestion_measurements_suggestion_key unique (suggestion_id),

  constraint suggestion_measurements_verdict_bands
    check (verdict_under_below > 0 and verdict_under_below <= 1 and verdict_over_above >= 1),

  -- The baseline is the window before the change.
  constraint suggestion_measurements_baseline_precedes
    check (ouroboros.analysis_json_date(baseline #> '{window,to}') <= applied_on),

  constraint suggestion_measurements_confounds_shape
    check (ouroboros.suggestion_measurement_confounds_valid(confounds, applied_on, window_ends_on)),

  -- Open rows have no result; closed rows have all of it.
  constraint suggestion_measurements_measured_when_closed
    check ((verdict = 'pending') = (measured is null)),
  constraint suggestion_measurements_closed_when_verdict
    check ((verdict = 'pending') = (closed_at is null)),
  constraint suggestion_measurements_note_when_closed
    check (verdict <> 'pending' or note is null),
  constraint suggestion_measurements_closed_after_window
    check (closed_at is null or (closed_at at time zone 'UTC')::date > window_ends_on),

  -- The measured window is the row's own, and its delta is the change from the baseline.
  constraint suggestion_measurements_measured_window
    check (measured is null
           or (ouroboros.analysis_json_date(measured #> '{window,from}') >= applied_on
               and ouroboros.analysis_json_date(measured #> '{window,to}') <= window_ends_on)),
  constraint suggestion_measurements_measured_delta
    check (measured is null
           or ouroboros.analysis_json_number(measured -> 'delta')
              = ouroboros.analysis_json_number(measured -> 'value')
                - ouroboros.analysis_json_number(baseline -> 'value')),

  -- THE VERDICT IS ARITHMETIC.
  constraint suggestion_measurements_verdict_computed
    check (verdict = 'pending'
           or verdict is not distinct from ouroboros.suggestion_measurement_verdict(
                ouroboros.analysis_json_number(predicted -> 'delta'),
                ouroboros.analysis_json_number(measured -> 'delta'),
                verdict_under_below, verdict_over_above, jsonb_array_length(confounds) > 0))
);

comment on table ouroboros.suggestion_measurements is
  'What an applied Build Analyzer suggestion predicted and what was measured (#508, decision A6) — one row per applied suggestion, its baseline and prediction frozen at apply, measured over window_days UTC days, and closed with a verdict that is arithmetic over the stored numbers and bands. The predicted-vs-measured card renders these rows.';
comment on column ouroboros.suggestion_measurements.applied_at is
  'When the change went in. Frozen.';
comment on column ouroboros.suggestion_measurements.applied_by is
  'Who applied it; set null if the person is removed.';
comment on column ouroboros.suggestion_measurements.target_metric is
  'The metric_definitions id (#432) baseline and measured are read from. Frozen.';
comment on column ouroboros.suggestion_measurements.baseline is
  '{window: {from, to}, value} — the target metric before the apply, in predicted.unit. Write-once.';
comment on column ouroboros.suggestion_measurements.predicted is
  '{delta, unit, basis, calibration: {analyzer, impact_class, factor}} — what the composer promised, on what basis, with which calibration factor. Write-once.';
comment on column ouroboros.suggestion_measurements.window_days is
  'How many UTC days after the apply day are measured. Copied from the workspace''s analyzer_measurement_policy() at insert unless given; frozen.';
comment on column ouroboros.suggestion_measurements.verdict_under_below is
  'The lower verdict band this measurement is judged by — the workspace''s at apply unless given. Frozen.';
comment on column ouroboros.suggestion_measurements.verdict_over_above is
  'The upper verdict band this measurement is judged by — the workspace''s at apply unless given. Frozen.';
comment on column ouroboros.suggestion_measurements.applied_on is
  'Generated: the apply''s UTC date — day 0.';
comment on column ouroboros.suggestion_measurements.window_ends_on is
  'Generated: applied_on + window_days, the window''s last day. The row may close on any later day.';
comment on column ouroboros.suggestion_measurements.measured is
  '{window: {from, to}, value, delta} — filled once, at close. delta = value − baseline.value.';
comment on column ouroboros.suggestion_measurements.verdict is
  'pending | delivered | under | over | confounded. Born pending; closed once, by ouroboros.suggestion_measurement_verdict().';
comment on column ouroboros.suggestion_measurements.confounds is
  'What else happened inside the window: [{kind: application|change_point, id, date}], each resolving when recorded. Any entry makes the verdict confounded.';
comment on column ouroboros.suggestion_measurements.note is
  'The composed revision line. Only on a closed row.';
comment on column ouroboros.suggestion_measurements.closed_at is
  'When the job closed the measurement; a day after window_ends_on at the earliest.';

-- The card's read, and the job's: a repository's measurements, and the open ones whose window
-- has ended.
create index suggestion_measurements_repo_idx
  on ouroboros.suggestion_measurements (organization_id, repo_ref, applied_at desc);
create index suggestion_measurements_open_idx
  on ouroboros.suggestion_measurements (window_ends_on) where verdict = 'pending';

create trigger suggestion_measurements_touch_updated_at
  before update on ouroboros.suggestion_measurements
  for each row execute function ouroboros.touch_updated_at();

-- Whether a confound names something real in the measurement's own repository.
--   p_org        — the measurement's workspace
--   p_repo       — its repository
--   p_suggestion — its own suggestion, which cannot confound itself
--   p_confound   — an entry suggestion_measurement_confounds_valid() accepts
-- Returns true for an application whose suggestion has a measurement applied on that date, or a
-- change-point finding dated that day.
create function ouroboros.suggestion_measurement_confound_resolves(
  p_org text, p_repo ouroboros.repo_ref, p_suggestion uuid, p_confound jsonb)
returns boolean language plpgsql stable as $$
declare
  ref_id uuid := (p_confound ->> 'id')::uuid;
begin
  case p_confound ->> 'kind'
    when 'application' then
      return ref_id <> p_suggestion
         and exists (select 1 from ouroboros.suggestion_measurements m
                      where m.suggestion_id = ref_id
                        and m.organization_id = p_org and m.repo_ref = p_repo
                        and m.applied_on = ouroboros.analysis_json_date(p_confound -> 'date'));
    when 'change_point' then
      return exists (select 1 from ouroboros.analysis_findings f
                      where f.id = ref_id
                        and f.organization_id = p_org and f.repo_ref = p_repo
                        and f.finding_type = 'change_point'
                        and f.data ->> 'date' = p_confound ->> 'date');
    else
      return false;
  end case;
end;
$$;

comment on function ouroboros.suggestion_measurement_confound_resolves(text, ouroboros.repo_ref, uuid, jsonb) is
  'Whether a confound entry names something real in the measurement''s repository (#508): another suggestion with a measurement applied on that date, or a change-point finding dated that day.';

-- Holds a measurement to its lifecycle: born pending against an applied suggestion, with the
-- window and bands the workspace is configured with; the application and its prediction
-- frozen; closed once; every confound resolving when it is recorded.
create function ouroboros.suggestion_measurements_guard()
returns trigger language plpgsql as $$
declare
  policy            record;
  suggestion_status text;
  confound          jsonb;
begin
  if tg_op = 'INSERT' then
    if new.window_days is null or new.verdict_under_below is null
       or new.verdict_over_above is null then
      select * into policy from ouroboros.analyzer_measurement_policy(new.organization_id);
      new.window_days         := coalesce(new.window_days, policy.window_days);
      new.verdict_under_below := coalesce(new.verdict_under_below, policy.verdict_under_below);
      new.verdict_over_above  := coalesce(new.verdict_over_above, policy.verdict_over_above);
    end if;

    if new.verdict <> 'pending' then
      raise exception 'a measurement is born pending, not %', new.verdict
        using errcode = 'check_violation', constraint = 'suggestion_measurements_born_pending';
    end if;

    -- A missing suggestion is the foreign key's to report.
    select status into suggestion_status
      from ouroboros.analysis_suggestions where id = new.suggestion_id;
    if found and suggestion_status <> 'applied' then
      raise exception 'suggestion % is %; only an applied suggestion is measured',
        new.suggestion_id, suggestion_status
        using errcode = 'check_violation',
              constraint = 'suggestion_measurements_suggestion_applied';
    end if;
  else
    if new.baseline is distinct from old.baseline
       or new.predicted is distinct from old.predicted then
      raise exception 'measurement %''s baseline and prediction were frozen at apply', old.id
        using errcode = 'check_violation',
              constraint = 'suggestion_measurements_prediction_frozen';
    end if;

    -- applied_by may only go to null: the user foreign key's own set-null.
    if (new.id, new.suggestion_id, new.organization_id, new.repo_ref, new.applied_at,
        new.target_metric, new.window_days, new.verdict_under_below, new.verdict_over_above,
        new.created_at)
       is distinct from
       (old.id, old.suggestion_id, old.organization_id, old.repo_ref, old.applied_at,
        old.target_metric, old.window_days, old.verdict_under_below, old.verdict_over_above,
        old.created_at)
       or (new.applied_by is not null and new.applied_by is distinct from old.applied_by) then
      raise exception 'measurement % keeps the application it was recorded for', old.id
        using errcode = 'check_violation',
              constraint = 'suggestion_measurements_application_frozen';
    end if;

    if old.verdict <> 'pending'
       and (new.measured, new.verdict, new.confounds, new.note, new.closed_at)
           is distinct from
           (old.measured, old.verdict, old.confounds, old.note, old.closed_at) then
      raise exception 'measurement % closed as %; it is not revised', old.id, old.verdict
        using errcode = 'check_violation', constraint = 'suggestion_measurements_closed_frozen';
    end if;
  end if;

  -- The shape is the check constraint's to report; resolution only means anything for entries
  -- that are well-formed, and only for the ones this write records.
  if jsonb_typeof(new.confounds) = 'array' then
    for confound in
      select e from jsonb_array_elements(new.confounds) e
       where jsonb_typeof(e) = 'object'
         and e ->> 'kind' in ('application', 'change_point')
         and coalesce(e ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                      false)
         and (tg_op = 'INSERT' or not old.confounds @> jsonb_build_array(e))
    loop
      if not ouroboros.suggestion_measurement_confound_resolves(
               new.organization_id, new.repo_ref, new.suggestion_id, confound) then
        raise exception 'confound % does not resolve in % of workspace %',
          confound, new.repo_ref, new.organization_id
          using errcode = 'check_violation',
                constraint = 'suggestion_measurements_confound_resolves';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

comment on function ouroboros.suggestion_measurements_guard() is
  'The measurement lifecycle (#508): an insert takes its window and verdict bands from analyzer_measurement_policy() unless given, is born pending and needs an applied suggestion; baseline and predicted are write-once; the application (suggestion, applied_at, target_metric, window_days, bands) never changes, applied_by only to null; a closed row is frozen; a confound resolves when it is recorded.';

create trigger suggestion_measurements_guard
  before insert or update on ouroboros.suggestion_measurements
  for each row execute function ouroboros.suggestion_measurements_guard();

-- ---------------------------------------------------------------------------
-- analyzer_calibration — the current factor per (repository, analyzer, impact class).
-- ---------------------------------------------------------------------------
create table ouroboros.analyzer_calibration (
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,
  repo_ref        ouroboros.repo_ref not null,

  -- The analyzer whose findings the suggestions were composed from, and the class of impact the
  -- composer's formula produces — `duration_delta`. Both are the composer's vocabulary (BV.4).
  analyzer        text        not null
                              constraint analyzer_calibration_analyzer_shape
                                check (analyzer ~ '^[a-z][a-z0-9_]{0,62}$'),
  impact_class    text        not null
                              constraint analyzer_calibration_impact_class_shape
                                check (impact_class ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- THE FORMULA's value, and how many measurements it is computed from.
  factor          numeric(8,4) not null,
  sample_count    integer     not null
                              constraint analyzer_calibration_sample_count_positive
                                check (sample_count >= 1),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (organization_id, repo_ref, analyzer, impact_class)
);

comment on table ouroboros.analyzer_calibration is
  'The Build Analyzer''s calibration factors (#508, decision A6) — one row per (workspace, repository, analyzer, impact class), holding the multiplier the composer applies to its raw estimate. No row means 1. Written by ouroboros.recalibrate_analyzer(); every value is its latest analyzer_calibration_history row''s.';
comment on column ouroboros.analyzer_calibration.analyzer is
  'The analyzer id, as analysis_findings.analyzer names it.';
comment on column ouroboros.analyzer_calibration.impact_class is
  'The class of impact the factor scales — duration_delta. The composer''s vocabulary.';
comment on column ouroboros.analyzer_calibration.factor is
  'round(Σ measured.delta ÷ Σ (predicted.delta ÷ predicted.calibration.factor), 4) over the cell''s measurements that closed delivered, under or over. A plain multiplier.';
comment on column ouroboros.analyzer_calibration.sample_count is
  'How many measurements the factor is computed from.';

create trigger analyzer_calibration_touch_updated_at
  before update on ouroboros.analyzer_calibration
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- analyzer_calibration_history — every update, with the measurements that produced it.
-- ---------------------------------------------------------------------------
create table ouroboros.analyzer_calibration_history (
  id                    bigint      generated always as identity primary key,

  organization_id       text        not null,
  repo_ref              ouroboros.repo_ref not null,
  analyzer              text        not null,
  impact_class          text        not null,

  from_factor           numeric(8,4) not null,
  to_factor             numeric(8,4) not null,

  -- THE FORMULA's inputs: Σ measured.delta and Σ raw prediction over measurement_ids.
  sample_count          integer     not null,
  measured_sum          numeric     not null,
  predicted_sum         numeric     not null
                                    constraint analyzer_calibration_history_predicted_sum_nonzero
                                      check (predicted_sum <> 0),

  -- Every measurement the value is computed from, in id order, and the ones new to this update.
  measurement_ids       uuid[]      not null,
  added_measurement_ids uuid[]      not null,

  created_at            timestamptz not null default now(),

  constraint analyzer_calibration_history_cell_fkey
    foreign key (organization_id, repo_ref, analyzer, impact_class)
    references ouroboros.analyzer_calibration (organization_id, repo_ref, analyzer, impact_class)
    on delete cascade,

  constraint analyzer_calibration_history_sample_count
    check (sample_count = cardinality(measurement_ids)),
  constraint analyzer_calibration_history_formula
    check (to_factor = round(measured_sum / predicted_sum, 4))
);

comment on table ouroboros.analyzer_calibration_history is
  'The audit trail of analyzer_calibration (#508) — one append-only row per factor update: from_factor → to_factor, the two sums the new value is the ratio of, every measurement it is computed from and the ones that moved it.';
comment on column ouroboros.analyzer_calibration_history.from_factor is
  'The factor before this update — the previous row''s to_factor, or 1 for the first.';
comment on column ouroboros.analyzer_calibration_history.to_factor is
  'round(measured_sum ÷ predicted_sum, 4).';
comment on column ouroboros.analyzer_calibration_history.measured_sum is
  'Σ measured.delta over measurement_ids.';
comment on column ouroboros.analyzer_calibration_history.predicted_sum is
  'Σ (predicted.delta ÷ predicted.calibration.factor) over measurement_ids, rounded to 6 places — the uncorrected predictions.';
comment on column ouroboros.analyzer_calibration_history.measurement_ids is
  'Every suggestion_measurements row the value is computed from, in id order.';
comment on column ouroboros.analyzer_calibration_history.added_measurement_ids is
  'The measurements new since the previous update — the ones that moved the factor.';

-- The trail of one cell, newest first.
create index analyzer_calibration_history_cell_idx
  on ouroboros.analyzer_calibration_history
     (organization_id, repo_ref, analyzer, impact_class, id desc);

-- THE FORMULA's inputs for one cell: every measurement that closed with a clean verdict.
--   p_org          — the workspace
--   p_repo         — the repository
--   p_analyzer     — the analyzer id
--   p_impact_class — the impact class
-- Returns one row: the measurement ids in id order, their count, Σ measured.delta and
-- Σ raw prediction (6 places). An empty cell is an empty array and zeros.
create function ouroboros.analyzer_calibration_inputs(
  p_org text, p_repo ouroboros.repo_ref, p_analyzer text, p_impact_class text)
returns table (measurement_ids uuid[], sample_count integer, measured_sum numeric,
               predicted_sum numeric)
language sql stable as $$
  select coalesce(array_agg(m.id order by m.id), '{}'),
         count(*)::integer,
         coalesce(sum(ouroboros.analysis_json_number(m.measured -> 'delta')), 0),
         coalesce(round(sum(ouroboros.analysis_json_number(m.predicted -> 'delta')
                            / ouroboros.analysis_json_number(m.predicted #> '{calibration,factor}')),
                        6), 0)
    from ouroboros.suggestion_measurements m
   where m.organization_id = p_org and m.repo_ref = p_repo
     and m.verdict in ('delivered', 'under', 'over')
     and m.predicted #>> '{calibration,analyzer}' = p_analyzer
     and m.predicted #>> '{calibration,impact_class}' = p_impact_class
$$;

comment on function ouroboros.analyzer_calibration_inputs(text, ouroboros.repo_ref, text, text) is
  'The calibration formula''s inputs for one cell (#508): the measurements that closed delivered, under or over (never pending or confounded), their count, Σ measured.delta and Σ (predicted.delta ÷ predicted.calibration.factor).';

-- Admits a history row only when it is the cell's arithmetic: its inputs are exactly the
-- eligible measurements, it starts from the current factor, and it adds at least one
-- measurement. Refuses any revision.
create function ouroboros.analyzer_calibration_history_guard()
returns trigger language plpgsql as $$
declare
  inputs   record;
  previous record;
  added    uuid[];
begin
  if tg_op = 'UPDATE' then
    raise exception 'calibration history is append-only'
      using errcode = 'check_violation',
            constraint = 'analyzer_calibration_history_append_only';
  end if;

  select * into inputs
    from ouroboros.analyzer_calibration_inputs(new.organization_id, new.repo_ref, new.analyzer,
                                               new.impact_class);

  if (new.measurement_ids, new.sample_count, new.measured_sum, new.predicted_sum)
     is distinct from
     (inputs.measurement_ids, inputs.sample_count, inputs.measured_sum, inputs.predicted_sum) then
    raise exception 'a calibration update cites exactly the clean measurements of %/% and their sums',
      new.analyzer, new.impact_class
      using errcode = 'check_violation', constraint = 'analyzer_calibration_history_inputs';
  end if;

  select h.to_factor, h.measurement_ids into previous
    from ouroboros.analyzer_calibration_history h
   where (h.organization_id, h.repo_ref, h.analyzer, h.impact_class)
         = (new.organization_id, new.repo_ref, new.analyzer, new.impact_class)
   order by h.id desc limit 1;

  if new.from_factor is distinct from coalesce(previous.to_factor, 1) then
    raise exception 'a calibration update starts from the current factor'
      using errcode = 'check_violation',
            constraint = 'analyzer_calibration_history_from_current';
  end if;

  added := array(select i from unnest(new.measurement_ids) i
                  where i <> all (coalesce(previous.measurement_ids, '{}')) order by i);

  if cardinality(added) = 0 or new.added_measurement_ids is distinct from added then
    raise exception 'a calibration update names the newly closed measurements that moved it'
      using errcode = 'check_violation', constraint = 'analyzer_calibration_history_adds';
  end if;

  return new;
end;
$$;

comment on function ouroboros.analyzer_calibration_history_guard() is
  'Holds a calibration history row to the formula (#508): measurement_ids, sample_count and both sums are exactly analyzer_calibration_inputs() for its cell, from_factor is the previous to_factor (1 for the first), and added_measurement_ids are the inputs new since the previous row — at least one. Refuses any update.';

create trigger analyzer_calibration_history_guard
  before insert or update on ouroboros.analyzer_calibration_history
  for each row execute function ouroboros.analyzer_calibration_history_guard();

-- Checks, at commit, that a cell's factor and sample count are its latest history row's. Fires
-- on every write to either table.
create function ouroboros.analyzer_calibration_traces()
returns trigger language plpgsql as $$
declare
  cell   record;
  latest record;
begin
  select c.factor, c.sample_count into cell
    from ouroboros.analyzer_calibration c
   where (c.organization_id, c.repo_ref, c.analyzer, c.impact_class)
         = (new.organization_id, new.repo_ref, new.analyzer, new.impact_class);
  if not found then
    return null;
  end if;

  select h.to_factor, h.sample_count into latest
    from ouroboros.analyzer_calibration_history h
   where (h.organization_id, h.repo_ref, h.analyzer, h.impact_class)
         = (new.organization_id, new.repo_ref, new.analyzer, new.impact_class)
   order by h.id desc limit 1;

  if not found
     or (latest.to_factor, latest.sample_count)
        is distinct from (cell.factor, cell.sample_count) then
    raise exception 'calibration %/% of % has no history row for its factor',
      new.analyzer, new.impact_class, new.repo_ref
      using errcode = 'check_violation', constraint = 'analyzer_calibration_traces';
  end if;

  return null;
end;
$$;

comment on function ouroboros.analyzer_calibration_traces() is
  'Deferred check (#508): a calibration cell''s factor and sample_count equal its latest analyzer_calibration_history row''s to_factor and sample_count — no factor changes without the row that says why.';

create constraint trigger analyzer_calibration_traces
  after insert or update on ouroboros.analyzer_calibration
  deferrable initially deferred
  for each row execute function ouroboros.analyzer_calibration_traces();

create constraint trigger analyzer_calibration_history_traces
  after insert on ouroboros.analyzer_calibration_history
  deferrable initially deferred
  for each row execute function ouroboros.analyzer_calibration_traces();

-- ---------------------------------------------------------------------------
-- The calibration write.
-- ---------------------------------------------------------------------------

-- Recomputes one cell's factor from its measurements (THE FORMULA) and, when a measurement has
-- closed since the last update, stores it with the history row that cites its inputs.
--   p_org          — the workspace
--   p_repo         — the repository
--   p_analyzer     — the analyzer id
--   p_impact_class — the impact class
-- Returns the cell's factor after the call — null when it has never been calibrated. Nothing is
-- written when no clean measurement is new, or when the raw predictions sum to zero and there
-- is no ratio to take.
create function ouroboros.recalibrate_analyzer(
  p_org text, p_repo ouroboros.repo_ref, p_analyzer text, p_impact_class text)
returns numeric language plpgsql as $$
declare
  inputs     record;
  previous   record;
  factor_now numeric;
  factor_new numeric;
begin
  select * into inputs
    from ouroboros.analyzer_calibration_inputs(p_org, p_repo, p_analyzer, p_impact_class);

  select h.to_factor, h.measurement_ids into previous
    from ouroboros.analyzer_calibration_history h
   where (h.organization_id, h.repo_ref, h.analyzer, h.impact_class)
         = (p_org, p_repo, p_analyzer, p_impact_class)
   order by h.id desc limit 1;

  factor_now := previous.to_factor;

  if inputs.sample_count = 0 or inputs.predicted_sum = 0
     or inputs.measurement_ids is not distinct from previous.measurement_ids then
    return factor_now;
  end if;

  factor_new := round(inputs.measured_sum / inputs.predicted_sum, 4);

  insert into ouroboros.analyzer_calibration as c
      (organization_id, repo_ref, analyzer, impact_class, factor, sample_count)
  values (p_org, p_repo, p_analyzer, p_impact_class, factor_new, inputs.sample_count)
  on conflict (organization_id, repo_ref, analyzer, impact_class) do update
     set factor = excluded.factor, sample_count = excluded.sample_count;

  insert into ouroboros.analyzer_calibration_history
      (organization_id, repo_ref, analyzer, impact_class, from_factor, to_factor, sample_count,
       measured_sum, predicted_sum, measurement_ids, added_measurement_ids)
  values (p_org, p_repo, p_analyzer, p_impact_class, coalesce(factor_now, 1), factor_new,
          inputs.sample_count, inputs.measured_sum, inputs.predicted_sum, inputs.measurement_ids,
          array(select i from unnest(inputs.measurement_ids) i
                 where i <> all (coalesce(previous.measurement_ids, '{}')) order by i));

  return factor_new;
end;
$$;

comment on function ouroboros.recalibrate_analyzer(text, ouroboros.repo_ref, text, text) is
  'The calibration write (#508): factor = round(Σ measured.delta ÷ Σ (predicted.delta ÷ predicted.calibration.factor), 4) over the cell''s measurements that closed delivered, under or over. Upserts analyzer_calibration and appends the analyzer_calibration_history row citing every input and the newly closed ones. Idempotent — a call with nothing new writes nothing. Returns the factor, or null when never calibrated.';

-- ---------------------------------------------------------------------------
-- The service role's grants. Nothing here is deleted by the service: a measurement is a
-- published prediction, and a factor's trail is append-only.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.analyzer_measurement_policies to ouroboros_app;
grant select, insert, update on ouroboros.suggestion_measurements to ouroboros_app;
grant select, insert, update on ouroboros.analyzer_calibration to ouroboros_app;
grant select, insert on ouroboros.analyzer_calibration_history to ouroboros_app;
