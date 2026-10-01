-- V080__analysis_runs.sql — `analysis_schedules` and `analysis_runs`: the Build Analyzer's run
-- records, corpus manifests and schedule configuration (#506, BU.1, decisions A2/A3/A7).
--
-- Mockup 18's meta strip —
--
--   Corpus 1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL sessions
--   Analyzed by [deterministic analyzers v1]   Last run 2h ago · 41 min
--   Confidence: high — 90d of stable telemetry
--
-- — is not a summary. It is the receipt for one row of `analysis_runs`. Six weeks after a run
-- claims *"qemu_cortex_m3 caught 0 unique failures in 214 builds"*, somebody will ask which 214;
-- the run's stored manifest is the only honest answer, so every number on the strip is computed
-- when the corpus is assembled and stored with the run that read it. Two runs a week apart
-- disagree because their corpora differ, and only the manifest makes that distinguishable from a
-- defect.
--
-- ===========================================================================
-- THE MANIFEST CONTRACT — corpus_manifest, filled by BV.1 (#510), rendered by BW.1
-- ===========================================================================
--
--   {
--     "window":  { "from": "2026-07-03", "to": "2026-10-01", "days": 90 },
--     "counts":  { "builds": 1284, "loops": 312, "log_lines": 4100000, "hil_sessions": 62 },
--     "sources": {
--       "builds":       { "sampled": false, "rate": 1,   "cap": null },
--       "loops":        { "sampled": false, "rate": 1,   "cap": null },
--       "log_lines":    { "sampled": true,  "rate": 0.3, "cap": "max_log_lines" },
--       "hil_sessions": { "sampled": false, "rate": 1,   "cap": null }
--     },
--     "budget":  { "max_builds": 2000, "max_log_lines": 1500000, "compute_ceiling_seconds": 3600 }
--   }
--
--   * `window` — the corpus bounds as ISO dates (`from` ≤ `to`) and the day count the strip prints.
--   * `counts` — what lies inside the window per source, counted at assembly: the strip's numbers.
--     Non-negative integers, all four keys present.
--   * `sources` — **the sampling record**, one entry per `counts` key. A source read in full is
--     `sampled: false, rate: 1, cap: null`. A source the budget bound is `sampled: true` with the
--     fraction actually read (`0 < rate < 1`) and the budget key that bound it (`cap`). A finding
--     from 30 % of the logs is still useful; presenting it as exhaustive is not, so the record is
--     required rather than optional.
--   * `budget` — the caps the run was assembled under, copied from its schedule (or the manual
--     request) at start, so a later budget change does not rewrite what this run was allowed.
--
-- `ouroboros.analysis_corpus_manifest_valid()` is that contract as a function, and
-- `analysis_runs_manifest_shape` applies it. Keys beyond these are allowed — a later source (AJ.4's
-- rig telemetry, #266) adds itself to `counts` and `sources` together — but the four above may
-- not be dropped and every `counts` key must have a `sources` entry.
--
-- ===========================================================================
-- THE PROVENANCE RULE — analyzer_set, and no fabricated cost (decision A3)
-- ===========================================================================
--
--   { "label": "deterministic analyzers v1",
--     "analyzers": [ { "id": "change_point",  "version": 2, "kind": "deterministic" },
--                    { "id": "log_signature", "version": 1, "kind": "deterministic" } ] }
--
-- `label` is what `Analyzed by` renders — the UI never invents it. `analyzers` is the versioned
-- list behind it, each `kind` `deterministic` or `llm`. Until BX.1's synthesis pass exists every
-- entry is deterministic, and **`llm_cost_cents` is null**: the strip shows compute time and never
-- a `$` nobody spent. `analysis_runs_cost_needs_llm` makes that a schema rule rather than a
-- convention — a cost is storable only on a run whose analyzer set contains an `llm` analyzer.
--
-- ===========================================================================
-- The other rules
-- ===========================================================================
--
-- **budget_exceeded is not failed.** A run that hit its compute ceiling after four analyzers have
-- partial, usable findings; a run that crashed has none. Both are terminal and both say why in
-- `failure_reason`; only `budget_exceeded` (and `complete`) carry a manifest the UI may render
-- findings against. A terminal run never changes status again (`analysis_runs_status_guard`).
--
-- **One running analysis per repository, enforced here.** Two concurrent analyses of one repo
-- duplicate compute, race on findings and confuse the every-N counter. The partial unique index
-- `analysis_runs_one_running` admits at most one `running` row per (workspace, repo): a second
-- trigger's insert waits on the first's uncommitted row and is refused when it commits, which an
-- application-side "is one running?" check cannot promise under retry.
-- tests/verify-analysis-run-guard.sh proves it with two sessions.
--
-- **The every-N counter is independent of its threshold.** `build_counter` counts builds since the
-- last trigger and is stored whether or not `every_n_builds` is set, so turning the threshold off
-- and on again does not lose the count, and lowering it below the counter simply makes the next
-- build trigger.
--
-- **Budgets live on the schedule row**, as typed columns, so the orchestrator reads trigger
-- config and caps in one lookup.
--
-- **Retention.** Runs (and BU.2's findings, which hang off them) belong to the settings retention
-- plane's analysis class (#482). The retention service deletes by `finished_at`; `running` rows
-- are never eligible. Nothing here schedules deletion — the coordination is the class name.

-- ---------------------------------------------------------------------------
-- The manifest contract as a function.
-- ---------------------------------------------------------------------------

-- A JSON value as a non-negative whole number, or null when it is anything else (a string, a
-- fraction, a negative). The manifest checks read every count through it, so a malformed value
-- fails the check instead of raising a cast error.
--   v — any jsonb value, or null
-- Returns the number, or null.
--
-- plpgsql rather than SQL on purpose: an inlined SQL function's cast can be constant-folded at
-- plan time ahead of the type test that guards it, and a guard that raises is no guard.
create function ouroboros.analysis_json_count(v jsonb)
returns numeric language plpgsql immutable as $$
declare
  n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    return null;
  end if;
  n := v::text::numeric;
  if n < 0 or n <> trunc(n) then
    return null;
  end if;
  return n;
end;
$$;

comment on function ouroboros.analysis_json_count(jsonb) is
  'A jsonb value as a non-negative whole number, or null when it is not one (#506).';

-- Whether a corpus manifest has the shape BV.1 writes and BW.1 renders (see THE MANIFEST
-- CONTRACT above).
--   m — the manifest; null is answered null so a nullable column's check passes
-- Returns true when every required key is present and well-formed, false otherwise — never null
-- for a non-null manifest, so a missing nested key is a refusal rather than a check that passes.
create function ouroboros.analysis_corpus_manifest_valid(m jsonb)
returns boolean language sql immutable as $$
  select case when m is null then null else coalesce(
    jsonb_typeof(m) = 'object'
    -- window: two ISO dates in order, and a positive day count.
    and jsonb_typeof(m -> 'window') = 'object'
    and coalesce(m #>> '{window,from}' ~ '^\d{4}-\d{2}-\d{2}$', false)
    and coalesce(m #>> '{window,to}'   ~ '^\d{4}-\d{2}-\d{2}$', false)
    and (m #>> '{window,from}') <= (m #>> '{window,to}')
    and ouroboros.analysis_json_count(m #> '{window,days}') >= 1
    -- counts: the four strip sources at least, each a non-negative integer.
    and jsonb_typeof(m -> 'counts') = 'object'
    and m -> 'counts' ?& array['builds', 'loops', 'log_lines', 'hil_sessions']
    and not exists (
      select 1 from jsonb_each(m -> 'counts') c
       where ouroboros.analysis_json_count(c.value) is null)
    -- sources: one sampling record per count, full reads stated as such, bound reads with a
    -- rate below one and the cap that bound them.
    and jsonb_typeof(m -> 'sources') = 'object'
    and not exists (
      select 1 from jsonb_object_keys(m -> 'counts') k
       where not (m -> 'sources' ? k))
    and not exists (
      select 1 from jsonb_each(m -> 'sources') s
       where case
               when jsonb_typeof(s.value) <> 'object'
                 or coalesce(jsonb_typeof(s.value -> 'sampled'), '') <> 'boolean'
                 or coalesce(jsonb_typeof(s.value -> 'rate'), '') <> 'number' then true
               when (s.value ->> 'sampled')::boolean
                 then not ((s.value ->> 'rate')::numeric > 0
                           and (s.value ->> 'rate')::numeric < 1
                           and coalesce(s.value ->> 'cap' in
                                 ('max_builds', 'max_log_lines', 'compute_ceiling_seconds'),
                                 false))
               else not ((s.value ->> 'rate')::numeric = 1
                         and coalesce(jsonb_typeof(s.value -> 'cap'), 'null') = 'null')
             end)
    -- budget: the caps the run was assembled under.
    and jsonb_typeof(m -> 'budget') = 'object'
    and m -> 'budget' ?& array['max_builds', 'max_log_lines', 'compute_ceiling_seconds'],
    false)
  end
$$;

comment on function ouroboros.analysis_corpus_manifest_valid(jsonb) is
  'The corpus-manifest contract (#506) — window {from,to,days}, counts {builds,loops,log_lines,hil_sessions,…}, a per-source sampling record {sampled,rate,cap} for every count, and the budget the run was assembled under. Null in, null out.';

-- Whether an analyzer set has the provenance shape the meta strip renders (see THE PROVENANCE
-- RULE above).
--   s — the analyzer set; null is answered null
-- Returns true for {label, analyzers:[{id, version, kind}, …]} with at least one analyzer.
create function ouroboros.analysis_analyzer_set_valid(s jsonb)
returns boolean language sql immutable as $$
  select case when s is null then null else coalesce(
    jsonb_typeof(s) = 'object'
    and jsonb_typeof(s -> 'label') = 'string'
    and btrim(s ->> 'label') <> ''
    and jsonb_typeof(s -> 'analyzers') = 'array'
    and jsonb_array_length(s -> 'analyzers') > 0
    and not exists (
      select 1 from jsonb_array_elements(s -> 'analyzers') a
       where jsonb_typeof(a) <> 'object'
          or not coalesce(a ->> 'id' ~ '^[a-z][a-z0-9_]{0,62}$', false)
          or coalesce(ouroboros.analysis_json_count(a -> 'version') < 1, true)
          or coalesce(a ->> 'kind' not in ('deterministic', 'llm'), true)),
    false)
  end
$$;

comment on function ouroboros.analysis_analyzer_set_valid(jsonb) is
  'The analyzer-set provenance contract (#506, decision A3) — {label, analyzers:[{id, version, kind: deterministic|llm}]}, non-empty. Null in, null out.';

-- ---------------------------------------------------------------------------
-- analysis_schedules — the head's Schedule control, and the budgets a run is held to.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_schedules (
  id                      uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a deleted workspace takes its schedule with it.
  organization_id         text        not null
                                      references ouroboros.organization ("id") on delete cascade,

  -- The repository the schedule analyses (V067's domain).
  repo_ref                ouroboros.repo_ref not null,

  -- The master switch. Off, no scheduled run starts; manual runs still may.
  enabled                 boolean     not null default true,

  -- Weekly trigger: ISO day of week (1 = Monday … 7 = Sunday) and time of day, UTC. Both are
  -- required when the weekly trigger is on and kept when it is turned off, so the picker
  -- remembers them.
  weekly_enabled          boolean     not null default false,
  weekly_day              smallint
                          constraint analysis_schedules_weekly_day_range
                            check (weekly_day between 1 and 7),
  weekly_time             time,

  -- Every-N trigger: the threshold (null = off) and the builds counted since the last trigger.
  -- The counter is stored independently of the threshold — see the header.
  every_n_builds          integer
                          constraint analysis_schedules_every_n_positive
                            check (every_n_builds >= 1),
  build_counter           integer     not null default 0
                          constraint analysis_schedules_build_counter_nonnegative
                            check (build_counter >= 0),

  -- Budgets: the corpus caps and compute ceiling every run of this repository is held to.
  max_builds              integer     not null default 2000
                          constraint analysis_schedules_max_builds_positive
                            check (max_builds >= 1),
  max_log_lines           bigint      not null default 5000000
                          constraint analysis_schedules_max_log_lines_positive
                            check (max_log_lines >= 1),
  compute_ceiling_seconds integer     not null default 3600
                          constraint analysis_schedules_compute_ceiling_positive
                            check (compute_ceiling_seconds >= 1),

  -- Who last changed the configuration; null for the defaults or after the person is removed.
  updated_by              text        references ouroboros."user" ("id") on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint analysis_schedules_repo_key
    unique (organization_id, repo_ref),

  constraint analysis_schedules_weekly_slot
    check (not weekly_enabled or (weekly_day is not null and weekly_time is not null)),

  -- The composite key analysis_runs' foreign key names, so a run's schedule is its repo's.
  constraint analysis_schedules_scope_key
    unique (id, organization_id, repo_ref)
);

comment on table ouroboros.analysis_schedules is
  'Build Analyzer schedule configuration per (workspace, repository) (#506, decision A7) — weekly day/time, every-N-builds threshold with its running counter, and the run budgets (corpus caps, compute ceiling) the orchestrator reads in the same lookup.';
comment on column ouroboros.analysis_schedules.enabled is
  'Master switch for scheduled triggers. Manual runs are not affected.';
comment on column ouroboros.analysis_schedules.weekly_day is
  'ISO day of week, 1 = Monday … 7 = Sunday. Required while weekly_enabled.';
comment on column ouroboros.analysis_schedules.weekly_time is
  'Time of day in UTC. Required while weekly_enabled.';
comment on column ouroboros.analysis_schedules.every_n_builds is
  'Trigger after this many builds; null turns the every-N trigger off.';
comment on column ouroboros.analysis_schedules.build_counter is
  'Builds since the last trigger. Stored independently of every_n_builds; reset to 0 when a run is triggered.';
comment on column ouroboros.analysis_schedules.max_builds is
  'Corpus cap: the most builds a run reads before sampling.';
comment on column ouroboros.analysis_schedules.max_log_lines is
  'Corpus cap: the most log lines a run reads before sampling.';
comment on column ouroboros.analysis_schedules.compute_ceiling_seconds is
  'Compute ceiling: a run reaching it stops as budget_exceeded with the findings it has.';
comment on column ouroboros.analysis_schedules.updated_by is
  'The person who last saved the configuration; null for defaults.';

create trigger analysis_schedules_touch_updated_at
  before update on ouroboros.analysis_schedules
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- analysis_runs — one row per analysis; the meta strip is its rendering.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_runs (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, for the reason metric_daily gives.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  repo_ref        ouroboros.repo_ref not null,

  -- What started it, and the schedule that did when a schedule did. The schedule is not required:
  -- deleting one leaves its runs as records, with the trigger kept and schedule_id cleared.
  trigger         text        not null
                              constraint analysis_runs_trigger_known
                                check (trigger in ('manual', 'weekly', 'every_n_builds')),
  schedule_id     uuid,

  status          text        not null default 'running'
                              constraint analysis_runs_status_known
                                check (status in ('running', 'complete', 'failed',
                                                  'budget_exceeded')),

  -- THE MANIFEST CONTRACT. Null only before assembly finishes — while running, or on a run that
  -- failed during assembly.
  corpus_manifest jsonb
                  constraint analysis_runs_manifest_shape
                    check (ouroboros.analysis_corpus_manifest_valid(corpus_manifest)),

  -- THE PROVENANCE RULE. Known when the run starts, so always present.
  analyzer_set    jsonb       not null
                              constraint analysis_runs_analyzer_set_shape
                                check (ouroboros.analysis_analyzer_set_valid(analyzer_set)),

  started_at      timestamptz not null default now(),
  finished_at     timestamptz,

  -- Wall-clock compute the run used — the strip's `41 min`.
  compute_seconds integer     not null default 0
                              constraint analysis_runs_compute_nonnegative
                                check (compute_seconds >= 0),

  -- LLM spend in cents. Null until an LLM pass actually runs — see THE PROVENANCE RULE.
  llm_cost_cents  integer
                  constraint analysis_runs_llm_cost_nonnegative
                    check (llm_cost_cents >= 0),

  -- The computed corpus-stability summary — `high — 90d of stable telemetry`.
  confidence_note text
                  constraint analysis_runs_confidence_note_present
                    check (btrim(confidence_note) <> ''),

  -- Why a failed or budget-bound run stopped.
  failure_reason  text
                  constraint analysis_runs_failure_reason_present
                    check (btrim(failure_reason) <> ''),

  created_at      timestamptz not null default now(),

  constraint analysis_runs_schedule_fkey
    foreign key (schedule_id, organization_id, repo_ref)
    references ouroboros.analysis_schedules (id, organization_id, repo_ref)
    on delete set null (schedule_id),

  constraint analysis_runs_finished_when_terminal
    check ((status = 'running') = (finished_at is null)),
  constraint analysis_runs_finish_order
    check (finished_at is null or finished_at >= started_at),

  -- complete and budget_exceeded have findings to render against a manifest; failed may not.
  constraint analysis_runs_manifest_when_results
    check (status not in ('complete', 'budget_exceeded') or corpus_manifest is not null),

  -- A complete run states its confidence; a running one has nothing to state yet.
  constraint analysis_runs_confidence_when_complete
    check (case status when 'complete' then confidence_note is not null
                       when 'running'  then confidence_note is null
                       else true end),

  -- failed and budget_exceeded say why; complete and running have no reason to.
  constraint analysis_runs_failure_reason_when_stopped
    check ((status in ('failed', 'budget_exceeded')) = (failure_reason is not null)),

  -- No `$` without an LLM pass that spent it.
  constraint analysis_runs_cost_needs_llm
    check (llm_cost_cents is null
           or jsonb_path_exists(analyzer_set, '$.analyzers[*] ? (@.kind == "llm")'))
);

comment on table ouroboros.analysis_runs is
  'Build Analyzer runs (#506, decisions A2/A3) — what each analysis read (corpus_manifest, with its per-source sampling record), when, under what budget, with which analyzers (analyzer_set), and how it ended. The meta strip renders one row. At most one running row per (workspace, repo).';
comment on column ouroboros.analysis_runs.trigger is
  'manual | weekly | every_n_builds.';
comment on column ouroboros.analysis_runs.schedule_id is
  'The schedule that triggered a weekly or every_n_builds run, held to the run''s workspace and repo. Set null if the schedule is deleted; the trigger stays.';
comment on column ouroboros.analysis_runs.status is
  'running | complete | failed | budget_exceeded. budget_exceeded has partial, usable findings; failed has none. Terminal statuses never change.';
comment on column ouroboros.analysis_runs.corpus_manifest is
  'The corpus receipt: window, counts, per-source sampling record and budget — see ouroboros.analysis_corpus_manifest_valid(). Required on complete and budget_exceeded.';
comment on column ouroboros.analysis_runs.analyzer_set is
  'Provenance: {label, analyzers:[{id, version, kind}]}. label is what "Analyzed by" renders — "deterministic analyzers v1" until an LLM pass exists.';
comment on column ouroboros.analysis_runs.compute_seconds is
  'Compute time the run used; the strip renders it as a duration.';
comment on column ouroboros.analysis_runs.llm_cost_cents is
  'LLM spend in cents. Null unless analyzer_set contains an llm analyzer — the strip never shows a fabricated cost.';
comment on column ouroboros.analysis_runs.confidence_note is
  'Computed corpus-stability summary ("high — 90d of stable telemetry"). Required on complete.';
comment on column ouroboros.analysis_runs.failure_reason is
  'Why a failed or budget_exceeded run stopped. Required for exactly those two.';

-- THE GUARD: at most one running analysis per (workspace, repository).
create unique index analysis_runs_one_running
  on ouroboros.analysis_runs (organization_id, repo_ref)
  where status = 'running';

-- The page's read: the latest runs of a repository.
create index analysis_runs_repo_recent_idx
  on ouroboros.analysis_runs (organization_id, repo_ref, started_at desc);

-- The schedule foreign key's referencing side.
create index analysis_runs_schedule_idx
  on ouroboros.analysis_runs (schedule_id) where schedule_id is not null;

-- Refuses any status change out of a terminal status: a finished run is a record, and
-- rewriting how it ended would void the findings it produced.
create function ouroboros.analysis_runs_status_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'running' and new.status is distinct from old.status then
    raise exception 'analysis run % already ended as %; it cannot become %',
      old.id, old.status, new.status
      using errcode = 'check_violation', constraint = 'analysis_runs_status_guard';
  end if;
  return new;
end;
$$;

create trigger analysis_runs_status_guard
  before update of status on ouroboros.analysis_runs
  for each row execute function ouroboros.analysis_runs_status_guard();

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on ouroboros.analysis_schedules to ouroboros_app;
grant select, insert, update on ouroboros.analysis_runs to ouroboros_app;
