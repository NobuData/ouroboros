-- ===========================================================================
-- V141 — data origin: live, simulated or seeded, on runs and what derives from them (DJ.1, #1313)
-- ===========================================================================
--
-- The product holds three kinds of rows in the same tables, and its commercial numbers — merge
-- rate, cost per merged pull request — are sums over all of them. This migration lets the
-- schema say which is which:
--
--   who wrote the row                       origin      can it be changed?
--   ──────────────────────────────────────────────────────────────────────
--   engine, OURO_ENGINE_SHARED_SECRET       live        no
--   simulator, OURO_RUN_SIMULATOR_SECRET    simulated   no
--   seed migration (dev / e2e only)         seeded      no
--   a person (PR opened, build submitted)   live        no
--
-- **Set once, by the path.** `runs.origin` is written by AP.1 from the principal that
-- authenticated (decision R4, extended) and by the seed files; no API accepts it. The derived
-- tables — `token_usage`, `build_jobs`, `pull_requests`, `test_runs` — **inherit** it: a
-- trigger copies the run's origin onto any row that names a run, and refuses one that states a
-- different origin. A row with no run (a human-opened pull request, a manually submitted build,
-- a Copilot session's usage) is `live` unless the path that writes it says otherwise.
--
-- **Seed files say `seeded` once, not per row.** Each `R__dev_seed_*` file starts with
--
--     select set_config('ouroboros.seed_origin', 'seeded', true);
--
-- a transaction-local setting the triggers read when a row states no origin. The repeatable
-- seeds run after every versioned migration, so they cannot rely on this file's back-fill.
--
-- **Immutable.** Every one of these columns refuses an update; changing a derived row's run to
-- one of another origin is refused too.
--
-- **The back-fill fails rather than guesses.** An existing run is `seeded` when its id begins
-- `5eed` (the seed files' own convention), `simulated` when it carries R4's watermark, and
-- `live` when AP.1 opened it (its `run.create` receipt). A run that is none of those stops this
-- migration with a count. Derived rows inherit; a run-less one is `seeded` by the same id
-- convention and `live` otherwise.
--
-- The Insights rollups (`metric_daily`) are DJ.2's (#1315): an aggregate has no single run to
-- inherit from, so it gains its origin where the computation is split per origin.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The vocabulary, and what a row states when it states nothing.
-- ---------------------------------------------------------------------------
create function ouroboros.data_origin_default() returns text
  language sql stable as $$
    select case current_setting('ouroboros.seed_origin', true)
             when 'seeded' then 'seeded'
             else 'live'
           end
  $$;

comment on function ouroboros.data_origin_default() is
  'The origin of a row that states none: seeded inside a seed file (ouroboros.seed_origin), live otherwise (DJ.1, #1313).';

-- ---------------------------------------------------------------------------
-- runs.origin — and the back-fill that refuses to guess.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs add column origin text;

update ouroboros.runs run
   set origin = case
         when run.id::text like '5eed%' then 'seeded'
         when run.simulated then 'simulated'
         when exists (
           select 1 from ouroboros.run_ingest_receipts receipt
            where receipt.run_id = run.id and receipt.operation = 'run.create'
         ) then 'live'
       end;

do $$
declare
  unclassified bigint;
begin
  select count(*) into unclassified from ouroboros.runs where origin is null;

  if unclassified > 0 then
    raise exception
      'V141: % run(s) cannot be classified as live, simulated or seeded', unclassified
      using errcode = 'check_violation',
            hint = 'A run is seeded by its 5eed id, simulated by its watermark, live by its AP.1 run.create receipt. Classify these by hand before migrating; DJ.1 (#1313) refuses to guess.';
  end if;
end;
$$;

alter table ouroboros.runs
  alter column origin set not null,
  add constraint runs_origin_known check (origin in ('live', 'simulated', 'seeded')),
  -- R4's watermark and the origin agree: a simulated run carries the watermark, and a run that
  -- carries it is never live. A seeded run may carry it — the run-console seed's does.
  add constraint runs_origin_watermark
    check ((origin = 'simulated') <= simulated and not (simulated and origin = 'live'));

-- A run that states no origin: simulated when it carries the watermark, else the default.
create function ouroboros.runs_origin_set() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.origin is distinct from old.origin then
      raise exception 'runs.origin is set once, by the path that created the run'
        using errcode = 'check_violation', constraint = 'runs_origin_immutable';
    end if;

    return new;
  end if;

  if new.origin is null then
    new.origin := case when new.simulated then 'simulated' else ouroboros.data_origin_default() end;
  end if;

  return new;
end;
$$;

create trigger runs_origin_set
  before insert or update of origin on ouroboros.runs
  for each row execute function ouroboros.runs_origin_set();

-- `runs_with_stage` carries the new column too — V049's reason: a read moves from `runs` to the
-- view by changing one word, so the view has every column `runs` has (V101's definition, plus one).
create or replace view ouroboros.runs_with_stage as
select run.id,
       run.organization_id,
       run.github_repo_id,
       run.issue_number,
       run.issue_title,
       run.workflow_tag,
       run.model,
       run.status,
       coalesce(current_stage.stage_label, run.stage_label) as stage_label,
       coalesce(current_stage.stage_index, run.stage_index) as stage_index,
       coalesce(current_stage.stage_total, run.stage_total) as stage_total,
       run.started_at,
       run.finished_at,
       run.pr_number,
       run.checks_passed,
       run.checks_total,
       run.created_at,
       run.updated_at,
       run.loop_seq,
       run.branch_name,
       run.workflow_version_pin,
       run.simulated,
       run.event_seq,
       run.event_bytes,
       run.event_cap,
       run.event_byte_cap,
       run.events_elided_at,
       run.merge_strategy,
       run.reserved_build_job_id,
       run.event_hint,
       run.change_set_seq,
       run.playbook_id,
       run.events_swept_at,
       run.origin
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407, #482 and #1313). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- The derived tables: inherited from the run, stated by the path when there is none.
-- ---------------------------------------------------------------------------
create function ouroboros.derived_origin_set() returns trigger
  language plpgsql as $$
declare
  run_origin text;
begin
  if tg_op = 'UPDATE' and new.origin is distinct from old.origin then
    raise exception '%.origin is set once, by the path that created the row', tg_table_name
      using errcode = 'check_violation', constraint = tg_table_name || '_origin_immutable';
  end if;

  if new.run_id is not null then
    select run.origin into run_origin from ouroboros.runs run where run.id = new.run_id;

    if new.origin is null then
      -- A run that does not exist leaves the foreign key to say so, not this column.
      new.origin := coalesce(run_origin, ouroboros.data_origin_default());
    elsif run_origin is not null and new.origin <> run_origin then
      raise exception '%.origin must be its run''s (%), not %', tg_table_name, run_origin, new.origin
        using errcode = 'check_violation', constraint = tg_table_name || '_origin_inherited';
    end if;
  elsif new.origin is null then
    new.origin := ouroboros.data_origin_default();
  end if;

  return new;
end;
$$;

comment on function ouroboros.derived_origin_set() is
  'A derived row''s origin: its run''s when it names one (refused if it states another), else the path''s. Immutable (DJ.1, #1313).';

-- token_usage
alter table ouroboros.token_usage add column origin text;

update ouroboros.token_usage usage
   set origin = coalesce(
         (select run.origin from ouroboros.runs run where run.id = usage.run_id),
         case when usage.id::text like '5eed%' then 'seeded' else 'live' end);

alter table ouroboros.token_usage
  alter column origin set not null,
  add constraint token_usage_origin_known check (origin in ('live', 'simulated', 'seeded'));

create trigger token_usage_origin_set
  before insert or update of origin, run_id on ouroboros.token_usage
  for each row execute function ouroboros.derived_origin_set();

-- build_jobs
alter table ouroboros.build_jobs add column origin text;

update ouroboros.build_jobs job
   set origin = coalesce(
         (select run.origin from ouroboros.runs run where run.id = job.run_id),
         case when job.id::text like '5eed%' then 'seeded' else 'live' end);

alter table ouroboros.build_jobs
  alter column origin set not null,
  add constraint build_jobs_origin_known check (origin in ('live', 'simulated', 'seeded'));

create trigger build_jobs_origin_set
  before insert or update of origin, run_id on ouroboros.build_jobs
  for each row execute function ouroboros.derived_origin_set();

-- pull_requests
alter table ouroboros.pull_requests add column origin text;

update ouroboros.pull_requests pr
   set origin = coalesce(
         (select run.origin from ouroboros.runs run where run.id = pr.run_id),
         case when pr.id::text like '5eed%' then 'seeded' else 'live' end);

alter table ouroboros.pull_requests
  alter column origin set not null,
  add constraint pull_requests_origin_known check (origin in ('live', 'simulated', 'seeded'));

create trigger pull_requests_origin_set
  before insert or update of origin, run_id on ouroboros.pull_requests
  for each row execute function ouroboros.derived_origin_set();

-- test_runs (always about a run)
alter table ouroboros.test_runs add column origin text;

update ouroboros.test_runs test
   set origin = (select run.origin from ouroboros.runs run where run.id = test.run_id);

alter table ouroboros.test_runs
  alter column origin set not null,
  add constraint test_runs_origin_known check (origin in ('live', 'simulated', 'seeded'));

create trigger test_runs_origin_set
  before insert or update of origin, run_id on ouroboros.test_runs
  for each row execute function ouroboros.derived_origin_set();

comment on column ouroboros.runs.origin is
  'live, simulated or seeded — set once by the path that created the run (DJ.1, #1313).';
comment on column ouroboros.token_usage.origin is 'Inherited from the run; the path''s when there is none (DJ.1).';
comment on column ouroboros.build_jobs.origin is 'Inherited from the run; the path''s when there is none (DJ.1).';
comment on column ouroboros.pull_requests.origin is 'Inherited from the run; the path''s when there is none (DJ.1).';
comment on column ouroboros.test_runs.origin is 'Inherited from the run (DJ.1).';
