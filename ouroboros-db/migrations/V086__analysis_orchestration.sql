-- V086__analysis_orchestration.sql — what BV.1's run orchestrator needs from the schema: a log-line
-- count it can read without reading a log, a run's phase and per-analyzer progress, and the
-- build-duration metric family in the Insights registry (#510, BV.1, decisions A2/A7).
--
-- Mockup 18's meta strip says `Corpus 1,284 builds · 312 loops · 90 days · 4.1M log lines · 62
-- HIL sessions`, and the head's *Run analysis now ⟳* opens a run the page then watches. V080 gave
-- the run its manifest and its terminal statuses; three things were still missing.
--
-- ===========================================================================
-- 1. LOG LINES ARE COUNTED WHERE THE BYTES LAND — build_jobs.log_lines
-- ===========================================================================
--
-- *4.1M log lines* is not a query result anybody can afford. Counting the lines of ninety days of
-- logs by reading them would stream every byte the farm kept to answer one number on a strip —
-- and the retention sweep (#253) has already deleted most of those bytes, so the answer would be
-- wrong as well as expensive. The count has to exist before the question is asked.
--
-- `build_jobs.log_lines` is that count: the newline-terminated lines the farm **stored** for the
-- job, maintained by `build_log_chunks_count_lines`, an AFTER INSERT trigger on
-- `build_log_chunks`. AFTER, so it sees the row V040's cap trigger actually wrote:
--
--   * a chunk under the cap is counted whole;
--   * a chunk the cap clamped is counted as clamped — the lines past the cap were not stored;
--   * a chunk past the cap has no row (the cap trigger returned null), so no AFTER trigger fires
--     and nothing is counted. Those bytes are `log_dropped_bytes`, not lines.
--
-- A line is a `0x0a` byte. A final line with no newline yet is not counted until the chunk that
-- ends it arrives — a chunk boundary inside a line therefore counts it exactly once. Counted
-- through `encode(content, 'escape')`, which renders high-bit and zero bytes as `\nnn` escapes
-- but leaves `0x0a` literal, so `length(e) - length(replace(e, E'\n', ''))` is the newline count
-- whatever the log's encoding.
--
-- It is a **history** count: the retention sweep deleting a job's chunks does not decrement it.
-- The strip reports how much the builds said, not how much of it is still on disk.
--
-- ===========================================================================
-- 2. A RUNNING RUN SAYS WHERE IT IS — analysis_runs.phase and analysis_runs.progress
-- ===========================================================================
--
-- The UI's run states are `assembling → analyzing (per-analyzer ticks) → composing`, then a
-- terminal status. V080's `status` is only the last of those. Progress lives on the row rather
-- than in one process's memory, so it survives a restart of `ouroboros-rest` and reads the same
-- from every replica that serves the page's poll.
--
--   * `phase` — `assembling | analyzing | composing`. On a running run, where it is; on a
--     terminal run, the phase it ended in, so *"failed while assembling"* is a column, not a
--     sentence somebody parses out of `failure_reason`. Defaults to `assembling` — the phase a
--     run is born in.
--   * `progress` — `{ "analyzers": [ {id, version, status, findings?, elapsed_seconds?,
--     reason?} ] }`, one entry per analyzer of the run's set, held to
--     `ouroboros.analysis_progress_valid()`. `status` is the engine harness's vocabulary
--     (BV.2, #511) plus the two states before an outcome exists: `pending`, `running`,
--     `completed`, `skipped`, `failed`, `timed_out`, `memory_exceeded`, `not_run`.
--
-- `analysis_runs_progress_guard` keeps both honest: **the phase never moves backwards**
-- (`assembling < analyzing < composing`), and **neither changes once the run is terminal** — the
-- statement that ends a run may still set them, because it sees the run as `running`. A finished
-- run's progress is what happened; rewriting it would contradict the findings it produced.
--
-- ===========================================================================
-- 3. THE BUILD-DURATION METRIC FAMILY — the duration series has a first-class home
-- ===========================================================================
--
-- The analyzer's duration chart (BW.2, #517), the change-point analyzer's input and the
-- measurement job's target metric (BV.6, #515) are all *the median build duration per day*. V076
-- deferred it to here ("#510's build durations register in their own migrations"); it registers
-- now as its own family, `build_duration`, so `ouroboros-rest`'s extractor fills it in its own
-- pass with its own bookkeeping row, and nothing derives it ad hoc.
--
--   * One metric, `build_duration`, aggregated as a **median** (V078's component rule: each day
--     keeps its samples, a window pools them), unit `duration_ms`.
--   * Broken out by **`job_label`**, a new dimension kind: a firmware build and a HIL sweep are
--     different jobs with different lengths, and a median over both describes neither. The label
--     is the farm's own (`build_jobs.label`), an open vocabulary like `suite`.
--   * Only jobs that finished `succeeded` are timed. A failed build measures how far it got.

-- ---------------------------------------------------------------------------
-- 1. build_jobs.log_lines, and the trigger that counts them.
-- ---------------------------------------------------------------------------
alter table ouroboros.build_jobs
  add column log_lines bigint not null default 0
    constraint build_jobs_log_lines_non_negative check (log_lines >= 0);

comment on column ouroboros.build_jobs.log_lines is
  'Newline-terminated log lines the farm stored for this job (#510), counted by build_log_chunks_count_lines as each chunk lands — after the cap clamped it, never for a chunk past the cap. A history count: the retention sweep does not decrement it. The Build Analyzer''s manifest sums it instead of reading logs.';

-- The number of 0x0a bytes in a chunk's content.
--   content — the stored bytes; null is answered 0
-- Returns the newline count. `escape` encoding leaves 0x0a literal and escapes only zero and
-- high-bit bytes (and doubles backslashes), none of which can introduce a newline.
create function ouroboros.log_newline_count(content bytea)
returns bigint language sql immutable as $$
  select coalesce(length(e) - length(replace(e, E'\n', '')), 0)::bigint
    from (select encode(content, 'escape') as e) escaped
$$;

comment on function ouroboros.log_newline_count(bytea) is
  'The number of newline (0x0a) bytes in a log chunk — the lines it ends (#510). Null in, 0 out.';

-- Adds a stored chunk's lines to its job's running count.
create function ouroboros.build_log_chunk_lines()
returns trigger language plpgsql as $$
declare
  lines bigint := ouroboros.log_newline_count(new.content);
begin
  if lines > 0 then
    update ouroboros.build_jobs
       set log_lines = log_lines + lines
     where id = new.job_id;
  end if;
  return null;
end;
$$;

comment on function ouroboros.build_log_chunk_lines() is
  'AFTER INSERT on build_log_chunks (#510): adds the stored chunk''s newline count to build_jobs.log_lines. Runs after V040''s cap trigger, so it counts what was kept; a past-cap chunk has no row and is not counted.';

create trigger build_log_chunks_count_lines
  after insert on ouroboros.build_log_chunks
  for each row execute function ouroboros.build_log_chunk_lines();

-- Jobs logged before this migration: their kept chunks, counted once.
update ouroboros.build_jobs job
   set log_lines = counted.lines
  from (select chunk.job_id, sum(ouroboros.log_newline_count(chunk.content)) as lines
          from ouroboros.build_log_chunks chunk
         group by chunk.job_id) counted
 where counted.job_id = job.id
   and counted.lines > 0;

-- ---------------------------------------------------------------------------
-- 2. analysis_runs.phase and analysis_runs.progress.
-- ---------------------------------------------------------------------------

-- Whether a run's progress has the shape the orchestrator writes and the UI renders.
--   p — the progress document; null is answered null so a nullable use's check passes
-- Returns true for {analyzers: [{id, version, status, findings?, elapsed_seconds?, reason?}]},
-- an empty list included (a run whose set is not yet ticked), false otherwise.
create function ouroboros.analysis_progress_valid(p jsonb)
returns boolean language sql immutable as $$
  select case when p is null then null else coalesce(
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'analyzers') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p -> 'analyzers') a
       where jsonb_typeof(a) <> 'object'
          or not coalesce(a ->> 'id' ~ '^[a-z][a-z0-9_]{0,62}$', false)
          or coalesce(ouroboros.analysis_json_count(a -> 'version') < 1, true)
          or coalesce(a ->> 'status' not in ('pending', 'running', 'completed', 'skipped',
                                             'failed', 'timed_out', 'memory_exceeded',
                                             'not_run'), true)
          or (a ? 'findings' and ouroboros.analysis_json_count(a -> 'findings') is null)
          or (a ? 'elapsed_seconds'
              and (jsonb_typeof(a -> 'elapsed_seconds') <> 'number'
                   or (a ->> 'elapsed_seconds')::numeric < 0))
          or (a ? 'reason' and jsonb_typeof(a -> 'reason') <> 'string')),
    false)
  end
$$;

comment on function ouroboros.analysis_progress_valid(jsonb) is
  'The run-progress contract (#510) — {analyzers:[{id, version >= 1, status: pending|running|completed|skipped|failed|timed_out|memory_exceeded|not_run, findings?: int >= 0, elapsed_seconds?: number >= 0, reason?: string}]}. Null in, null out.';

alter table ouroboros.analysis_runs
  add column phase text not null default 'assembling'
    constraint analysis_runs_phase_known
      check (phase in ('assembling', 'analyzing', 'composing')),
  add column progress jsonb not null default '{"analyzers": []}'::jsonb
    constraint analysis_runs_progress_shape
      check (ouroboros.analysis_progress_valid(progress));

comment on column ouroboros.analysis_runs.phase is
  'assembling | analyzing | composing (#510). Where a running run is; on a terminal run, the phase it ended in. Never moves backwards (analysis_runs_progress_guard).';
comment on column ouroboros.analysis_runs.progress is
  'Per-analyzer ticks (#510): {analyzers:[{id, version, status, findings?, elapsed_seconds?, reason?}]} — see ouroboros.analysis_progress_valid(). Frozen once the run is terminal.';

-- The phases' order.
--   p — a phase
-- Returns its rank, 1-3, or null for anything else.
create function ouroboros.analysis_phase_rank(p text)
returns integer language sql immutable as $$
  select case p when 'assembling' then 1 when 'analyzing' then 2 when 'composing' then 3 end
$$;

comment on function ouroboros.analysis_phase_rank(text) is
  'assembling = 1 < analyzing = 2 < composing = 3 (#510); null for anything else.';

-- Refuses a phase moving backwards, and any change to phase or progress on a terminal run.
create function ouroboros.analysis_runs_progress_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'running'
     and (new.phase is distinct from old.phase or new.progress is distinct from old.progress) then
    raise exception 'analysis run % already ended as %; its phase and progress are a record',
      old.id, old.status
      using errcode = 'check_violation', constraint = 'analysis_runs_progress_guard';
  end if;

  if ouroboros.analysis_phase_rank(new.phase) < ouroboros.analysis_phase_rank(old.phase) then
    raise exception 'analysis run % is %; it cannot go back to %', old.id, old.phase, new.phase
      using errcode = 'check_violation', constraint = 'analysis_runs_progress_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.analysis_runs_progress_guard() is
  'Holds analysis_runs.phase to assembling < analyzing < composing and freezes phase and progress once the run is terminal (#510). The statement that ends a run may still set them.';

create trigger analysis_runs_progress_guard
  before update of phase, progress on ouroboros.analysis_runs
  for each row execute function ouroboros.analysis_runs_progress_guard();

-- ---------------------------------------------------------------------------
-- 3. The build-duration metric family.
-- ---------------------------------------------------------------------------
alter table ouroboros.metric_definitions
  drop constraint metric_definitions_dimension_kind_known,
  add constraint metric_definitions_dimension_kind_known
    check (dimension_kind in ('stage', 'suite', 'effort', 'cause', 'task_kind', 'job_label'));

comment on column ouroboros.metric_definitions.dimension_kind is
  'What a dimensioned metric''s rows are broken out by — stage, suite, effort, cause, task_kind or job_label — or null for an undimensioned metric. metric_daily_shape_guard holds every row to it.';

insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy,
   aggregation, dimension_kind)
values
  ('build_duration', 'build_duration', 'Build duration',
   'The median start-to-finish wall time of build-farm jobs that finished succeeded on this day, per job label. A window''s median pools every build in the window, never averaging daily medians.',
   '{builds}',
   'Failed, retried and canceled jobs are not timed — a failed build measures how far it got, not how long a build takes. Time waiting in the queue is not included.',
   'duration_ms', false, false, 'median', 'job_label');
