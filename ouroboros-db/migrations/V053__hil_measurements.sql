-- V053__hil_measurements.sql — `hil_measurements`: what a physical rig did, what it measured,
-- against which limit, and the verdict that comparison gives.
--
-- Mockup 11's *Physical tests* card (docs/mockups/11-test-results.html) reads:
--
--     PHYSICAL TESTS — RIG HELIOS-RIG-02   rig online   bench: CAN bus + motor + power-cycler
--     Motor overshoot on e-stop release                                              FAIL
--       dyno bench releases e-stop under 2 Nm load, 3 trials
--       measured: overshoot 2.4% vs limit 2.0%
--     CAN bus frame order under 90% load                                             pass
--       traffic generator floods bus at 900 kbit/s for 60s
--       measured: 0 reordered frames in 10⁶ (was 37 in build 1)
--
-- Filed as issue #325 (AS.2) of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md). It needs V051 (#324) and feeds the HIL parser
-- (#329) and the physical tests card (#338).
--
--
-- Option 2-A — measurements are rows, not strings.
-- ---------------------------------------------------------------------------
--
-- JUnit has a pass/fail bit and a message. The card needs a number, a unit, a limit, a
-- direction and a verdict, plus the procedure the rig physically ran. Stuffing those into JUnit
-- `<properties>` (option 2-B) would make `2.4% vs limit 2.0%` a string somebody typed rather
-- than a comparison the product can make. So a physical case owns zero or more
-- `hil_measurements` rows, fed by an `ouro-hil-results.json` upload (its format is #329's).
--
--
-- The verdict is held to its own numbers.
-- ---------------------------------------------------------------------------
--
-- `limit_kind` says which way the limit points — direction is data, not convention:
--
--   | limit_kind | pass when              |
--   |------------|------------------------|
--   | `max`      | value <= limit_value   |
--   | `min`      | value >= limit_value   |
--
-- Both are inclusive: a value that sits exactly on its limit passes.
-- `hil_measurements_verdict_consistent` refuses a stored verdict that disagrees, so the card's
-- FAIL pill is a stored fact the browser reads rather than a judgement it makes. `NaN` and the
-- infinities are refused: `NaN` sorts above every number in PostgreSQL, so it would "fail" a
-- `max` limit without having been measured.
--
--
-- The comparative is composed, never typed.
-- ---------------------------------------------------------------------------
--
-- `(was 37 in build 1)` is a claim about history, so `hil_measurements_compose_context` writes
-- it from stored rows and refuses any other value. It looks for the latest earlier attempt of
-- the same run with a measurement of the same case (`case_key`) and metric whose value
-- **differs** from this one — an unchanged value is not news. It renders that as
--
--     was <value><unit> in build <attempt_seq>          -- `count` is shown without a unit
--
-- and when no such attempt exists `context` is null. A writer may leave it null or supply the
-- same text; anything else is refused, so a comparative cannot be invented. It is composed at
-- write time, so attempts must be written in order — the parser writes each attempt as it
-- completes, which is that order.
--
--
-- The procedure is the case's, not the measurement's.
-- ---------------------------------------------------------------------------
--
-- A case can carry several metrics (*"recovered 3/3 boots · slot-B fallback 412ms"*), but the
-- card prints one what-it-did line per case. `hil_measurements_procedure_agrees` refuses a row
-- whose `procedure` differs from its siblings', so that one line is never a choice between two.
--
--
-- Degraded mode is declared, so it can be told apart from loss.
-- ---------------------------------------------------------------------------
--
-- A rig that only emits JUnit still produces a valid physical suite; its cases render as plain
-- rows with a hint and never with invented measurements. What the card must *also* tell apart
-- is a suite whose measurements went missing. So `test_suites` gains `results_format`:
--
--   * `junit` (the default) — the suite came from JUnit alone and carries no measurements.
--     `hil_measurements_case_is_hil` refuses a measurement on its cases.
--   * `hil` — the suite came from `ouro-hil-results.json`; it must be `kind = 'physical'`,
--     and every case that ran should carry a measurement.
--
-- `hil_suite_modes` reads a physical suite as `measured`, `degraded` or `incomplete` — the
-- last being a `hil` suite with a case that ran but has no measurement, which is the loss.
--
--
-- Rig identity lives on the suite.
-- ---------------------------------------------------------------------------
--
-- V051 already stores the platform (`rig:helios-rig-02`) and a `meta` object. The bench
-- description is `meta.bench`, and `test_suites_meta_bench_text` holds it to a string, so a
-- physical suite is identifiable without joining its measurements.

-- ---------------------------------------------------------------------------
-- test_suites — which format the results came from, and the bench's shape.
-- ---------------------------------------------------------------------------
alter table ouroboros.test_suites
  add column results_format text not null default 'junit',
  add constraint test_suites_results_format
    check (results_format in ('junit', 'hil')),
  add constraint test_suites_hil_is_physical
    check (results_format <> 'hil' or kind = 'physical'),
  add constraint test_suites_meta_bench_text
    check (coalesce(jsonb_typeof(meta -> 'bench'), 'string') = 'string');

comment on column ouroboros.test_suites.results_format is
  'junit (default) | hil — whether the suite came from JUnit alone or from ouro-hil-results.json (#325). A hil suite is physical and carries hil_measurements; a junit suite carries none, which is degraded mode rather than loss.';

-- A measurement's case must stay in a `hil` suite, so the format cannot move once written.
create function ouroboros.test_suites_results_format_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.results_format is distinct from old.results_format then
    raise exception 'a test suite''s results_format is fixed once written'
      using errcode = 'check_violation', constraint = 'test_suites_results_format_frozen';
  end if;
  return new;
end;
$$;

comment on function ouroboros.test_suites_results_format_frozen() is
  'Refuses changing test_suites.results_format (#325): hil_measurements are only valid under a hil suite, and degraded versus incomplete is read from it.';

create trigger test_suites_results_format_frozen
  before update of results_format on ouroboros.test_suites
  for each row execute function ouroboros.test_suites_results_format_frozen();

-- hil_measurements references a case by (id, organization_id), V051's composite pattern.
alter table ouroboros.test_cases
  add constraint test_cases_id_organization_key unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- The verdict rule, as a function a CHECK and a test can both call.
-- ---------------------------------------------------------------------------
create function ouroboros.hil_verdict(
  p_value       numeric,
  p_limit_value numeric,
  p_limit_kind  text
) returns text
language sql
immutable
parallel safe
as $$
  select case p_limit_kind
           when 'max' then case when p_value <= p_limit_value then 'pass'
                                when p_value >  p_limit_value then 'fail' end
           when 'min' then case when p_value >= p_limit_value then 'pass'
                                when p_value <  p_limit_value then 'fail' end
         end
$$;

comment on function ouroboros.hil_verdict(numeric, numeric, text) is
  'The verdict a measurement''s numbers give (#325): max passes when value <= limit_value, min passes when value >= limit_value; both inclusive. Null for an unknown limit_kind or a null input.';

-- ---------------------------------------------------------------------------
-- How a comparative prints a value — `37`, `2.9%`, `480ms`.
-- ---------------------------------------------------------------------------
create function ouroboros.hil_format_value(p_value numeric, p_unit text)
returns text
language sql
immutable
parallel safe
as $$
  select trim_scale(p_value)::text || case when p_unit = 'count' then '' else p_unit end
$$;

comment on function ouroboros.hil_format_value(numeric, text) is
  'Prints a measured value for a comparative (#325): trailing zeros trimmed, the unit appended with no space, and count shown bare — so 37 count is "37" and 2.90 % is "2.9%".';

-- ---------------------------------------------------------------------------
-- hil_measurements — one metric measured on one physical case.
-- ---------------------------------------------------------------------------
create table ouroboros.hil_measurements (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null,

  -- Cascade: a measurement means nothing without its case.
  test_case_id     uuid        not null,

  -- The what-it-did line — one per case (hil_measurements_procedure_agrees).
  procedure        text        not null,

  -- Ordered trial records: per-trial values, timings and notes.
  trials           jsonb       not null default '[]'::jsonb,

  -- `overshoot_pct`, `slot_b_fallback_ms`, `reordered_frames`.
  metric           text        not null,

  value            numeric     not null,

  -- `%`, `ms`, `s`, `count`.
  unit             text        not null,

  limit_value      numeric     not null,
  limit_kind       text        not null,

  verdict          text        not null,

  -- The comparative — composed by hil_measurements_compose_context, null when there is none.
  context          text,

  created_at       timestamptz not null default now(),

  constraint hil_measurements_case_metric_key unique (test_case_id, metric),

  constraint hil_measurements_test_case_fk
    foreign key (test_case_id, organization_id)
    references ouroboros.test_cases (id, organization_id) on delete cascade,

  constraint hil_measurements_procedure_present
    check (length(btrim(procedure)) > 0),

  constraint hil_measurements_trials_shape
    check (jsonb_typeof(trials) = 'array'
           and not jsonb_path_exists(trials, '$[*] ? (@.type() != "object")')),

  constraint hil_measurements_metric_shape
    check (metric ~ '^[a-z][a-z0-9_]*$'),

  constraint hil_measurements_unit_shape
    check (unit ~ '^[^[:space:]]{1,16}$'),

  constraint hil_measurements_value_finite
    check (value not in ('NaN', 'Infinity', '-Infinity')
           and limit_value not in ('NaN', 'Infinity', '-Infinity')),

  constraint hil_measurements_limit_kind
    check (limit_kind in ('max', 'min')),

  constraint hil_measurements_verdict
    check (verdict in ('pass', 'fail')),

  constraint hil_measurements_verdict_consistent
    check (verdict = ouroboros.hil_verdict(value, limit_value, limit_kind))
);

comment on table ouroboros.hil_measurements is
  'One metric measured on one physical test case (#325, AS.2, option 2-A) — a measured line of mockup 11''s Physical tests card. Zero rows under a case is JUnit-degraded mode when its suite''s results_format is junit.';
comment on column ouroboros.hil_measurements.procedure is
  'What the rig physically did — the card''s what-it-did line. The same for every measurement of a case.';
comment on column ouroboros.hil_measurements.trials is
  'A JSON array of trial objects in the order they ran (per-trial values, timings, notes).';
comment on column ouroboros.hil_measurements.metric is
  'The measured quantity as a lowercase identifier — overshoot_pct, slot_b_fallback_ms, reordered_frames. Unique per case.';
comment on column ouroboros.hil_measurements.unit is
  'The unit value and limit_value are in — %, ms, s, count.';
comment on column ouroboros.hil_measurements.limit_kind is
  'max (value must not exceed limit_value) | min (value must reach limit_value).';
comment on column ouroboros.hil_measurements.verdict is
  'pass | fail — always equal to hil_verdict(value, limit_value, limit_kind) (hil_measurements_verdict_consistent).';
comment on column ouroboros.hil_measurements.context is
  'The comparative, e.g. "was 37 in build 1": composed from the latest earlier attempt of the same run whose value for this case and metric differs; null when there is none. Never typed (hil_measurements_compose_context).';

-- ---------------------------------------------------------------------------
-- A measurement belongs to a case of a `hil` suite.
-- ---------------------------------------------------------------------------
create function ouroboros.hil_measurements_case_is_hil()
returns trigger
language plpgsql
as $$
declare
  fmt text;
begin
  select s.results_format into fmt
    from ouroboros.test_cases c
    join ouroboros.test_suites s on s.id = c.test_suite_id
   where c.id = new.test_case_id and c.organization_id = new.organization_id;

  -- No case: the foreign key reports it, by name.
  if fmt is not null and fmt <> 'hil' then
    raise exception
      'test case % is in a % suite; only a hil suite''s cases carry measurements',
      new.test_case_id, fmt
      using errcode = 'check_violation', constraint = 'hil_measurements_case_is_hil';
  end if;

  return new;
end;
$$;

comment on function ouroboros.hil_measurements_case_is_hil() is
  'Refuses a measurement whose case is not in a results_format = hil suite (#325), so a JUnit-degraded suite never carries measurements.';

create trigger hil_measurements_case_is_hil
  before insert or update of test_case_id on ouroboros.hil_measurements
  for each row execute function ouroboros.hil_measurements_case_is_hil();

-- ---------------------------------------------------------------------------
-- One what-it-did line per case.
-- ---------------------------------------------------------------------------
create function ouroboros.hil_measurements_procedure_agrees()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from ouroboros.hil_measurements m
              where m.test_case_id = new.test_case_id
                and m.id <> new.id
                and m.procedure <> new.procedure) then
    raise exception
      'test case % already has a different procedure; a case has one what-it-did line',
      new.test_case_id
      using errcode = 'check_violation', constraint = 'hil_measurements_procedure_agrees';
  end if;

  return new;
end;
$$;

comment on function ouroboros.hil_measurements_procedure_agrees() is
  'Refuses a measurement whose procedure differs from another measurement of the same case (#325): the card prints one what-it-did line per case.';

create trigger hil_measurements_procedure_agrees
  before insert or update of test_case_id, procedure on ouroboros.hil_measurements
  for each row execute function ouroboros.hil_measurements_procedure_agrees();

-- ---------------------------------------------------------------------------
-- The comparative a measurement is entitled to — null when history has none.
-- ---------------------------------------------------------------------------
create function ouroboros.hil_measurement_context(
  p_test_case_id uuid,
  p_metric       text,
  p_value        numeric
) returns text
language sql
stable
as $$
  select format('was %s in build %s',
                ouroboros.hil_format_value(pm.value, pm.unit), pt.attempt_seq)
    from ouroboros.test_cases c
    join ouroboros.test_suites s  on s.id = c.test_suite_id
    join ouroboros.test_runs t    on t.id = s.test_run_id
    join ouroboros.test_runs pt   on pt.run_id = t.run_id and pt.attempt_seq < t.attempt_seq
    join ouroboros.test_suites ps on ps.test_run_id = pt.id
    join ouroboros.test_cases pc  on pc.test_suite_id = ps.id and pc.case_key = c.case_key
    join ouroboros.hil_measurements pm on pm.test_case_id = pc.id and pm.metric = p_metric
   where c.id = p_test_case_id
     and pm.value <> p_value
   order by pt.attempt_seq desc
   limit 1
$$;

comment on function ouroboros.hil_measurement_context(uuid, text, numeric) is
  'The comparative for a measurement (#325): "was <value><unit> in build <n>" from the latest earlier attempt of the same run whose measurement of the same case_key and metric has a different value. Null when there is no such attempt — absent, never invented.';

create function ouroboros.hil_measurements_compose_context()
returns trigger
language plpgsql
as $$
declare
  expected text;
begin
  expected := ouroboros.hil_measurement_context(new.test_case_id, new.metric, new.value);

  if new.context is null then
    new.context := expected;
  elsif new.context is distinct from expected then
    raise exception
      'context % is not the comparative the stored history gives (%)',
      new.context, coalesce(expected, 'none')
      using errcode = 'check_violation', constraint = 'hil_measurements_context_composed';
  end if;

  return new;
end;
$$;

comment on function ouroboros.hil_measurements_compose_context() is
  'Fills hil_measurements.context from hil_measurement_context() when written null and refuses any other value (#325), so the comparative is composed from history and absent when history has none.';

create trigger hil_measurements_compose_context
  before insert or update of test_case_id, metric, value, context on ouroboros.hil_measurements
  for each row execute function ouroboros.hil_measurements_compose_context();

-- ---------------------------------------------------------------------------
-- Measured, degraded or incomplete — how the card reads a physical suite.
-- ---------------------------------------------------------------------------
create view ouroboros.hil_suite_modes as
select s.id                                                           as test_suite_id,
       s.organization_id,
       s.test_run_id,
       s.platform,
       s.meta ->> 'bench'                                             as bench,
       s.results_format,
       count(c.id)::integer                                           as cases,
       count(c.id) filter (where c.status <> 'skipped')::integer      as ran,
       count(c.id) filter (where exists (
               select 1 from ouroboros.hil_measurements m
                where m.test_case_id = c.id))::integer                as measured,
       case
         when s.results_format = 'junit' then 'degraded'
         when count(c.id) filter (where c.status <> 'skipped' and not exists (
                     select 1 from ouroboros.hil_measurements m
                      where m.test_case_id = c.id)) > 0 then 'incomplete'
         else 'measured'
       end                                                            as mode
  from ouroboros.test_suites s
  left join ouroboros.test_cases c on c.test_suite_id = s.id
 where s.kind = 'physical'
 group by s.id;

comment on view ouroboros.hil_suite_modes is
  'Every physical suite with its rig platform, bench and mode (#325): degraded = JUnit only, rendered as plain cases with a hint; incomplete = a hil suite with a case that ran but has no measurement (measurements were lost); measured = otherwise.';

-- ---------------------------------------------------------------------------
-- Grants — V051's reasoning: the parser writes and re-parses replace.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on ouroboros.hil_measurements to ouroboros_app;
grant select on ouroboros.hil_suite_modes to ouroboros_app;
