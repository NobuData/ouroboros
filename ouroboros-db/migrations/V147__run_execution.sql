-- ===========================================================================
-- V147 — run execution: the epoch fence, the heartbeat and the checkpoint (#160)
-- ===========================================================================
--
-- AP.1 (#303) gave a run a control plane to report through, and the simulator drove it. #160 is
-- the engine interpreting a run's pinned workflow over that plane for real, and a real executor
-- can die mid-stage. The execution-engine ADR's decision A (docs/DECISION_EXECUTION_ENGINE.md)
-- makes that survivable with four facts about the run, kept on the run's own row:
--
--   column               written by                         what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   exec_epoch           POST /internal/runs/:id/start      how many times a worker has
--                                                           started this run; every engine
--                                                           write carries it, and a stale one
--                                                           is refused 409 fenced
--   exec_worker          start                              which worker holds the current epoch
--   exec_heartbeat_at    start, heartbeat, checkpoint       when that worker was last heard from;
--                                                           the REST supervisor resubmits a run
--                                                           whose heartbeat is stale
--   exec_base_commit     checkpoint (once)                  the commit the run's working tree was
--                                                           cut from — immutable once set, so a
--                                                           resumed run never rebases silently
--   exec_checkpoint(_at) checkpoint                         the interpreter's opaque state: where
--                                                           to resume, attempts, loop rounds
--
-- **Only live runs execute.** A simulated or seeded run is reported by the simulator or the seed,
-- never interpreted, so its epoch stays 0: REST refuses the start with 409 run_simulated, and
-- runs_exec_live_only refuses it here too.
--
-- **A heartbeat is not the run being heard from.** `updated_at` is the dashboard's freshness
-- signal and its ETag (V008, V101). A five-second heartbeat that stamped it would make every
-- executing run look as if it had just reported and bust every dashboard tag every five
-- seconds, so the touch trigger is recreated, as V101 recreated it for the sweep, to skip an
-- update that changes `exec_heartbeat_at` (and `events_swept_at`) and nothing else.
--
-- The application role holds no grant on runs (V048's header) and these columns need none: every
-- write goes through ouroboros-rest's owner connection, like the rest of the run.
--
-- To undo (forward only — for a rehearsal against a copy):
--   recreate runs_with_stage with V145's body; recreate runs_touch_updated_at with V101's;
--   drop trigger runs_exec_guard on ouroboros.runs; drop function ouroboros.runs_exec_guard();
--   alter table ouroboros.runs drop column exec_epoch, drop column exec_worker,
--     drop column exec_heartbeat_at, drop column exec_base_commit, drop column exec_checkpoint,
--     drop column exec_checkpoint_at;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns, and the shapes they may hold.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column exec_epoch         integer not null default 0,
  add column exec_worker        text,
  add column exec_heartbeat_at  timestamptz,
  add column exec_base_commit   text,
  add column exec_checkpoint    jsonb,
  add column exec_checkpoint_at timestamptz,

  add constraint runs_exec_epoch_nonnegative
    check (exec_epoch >= 0),
  -- The same shape rule as queue_items.claimed_by (V145): the worker names itself the same way
  -- to the claim and to the start.
  add constraint runs_exec_worker_shape
    check (exec_worker is null or (length(exec_worker) between 1 and 128 and exec_worker !~ '^\s|\s$')),
  -- A start sets all three; nothing clears them. A run never started has none.
  add constraint runs_exec_started_whole
    check ((exec_epoch = 0) = (exec_worker is null)
       and (exec_epoch = 0) = (exec_heartbeat_at is null)),
  add constraint runs_exec_base_commit_shape
    check (exec_base_commit is null or exec_base_commit ~ '^[0-9a-f]{40}$'),
  -- Opaque to the schema, but an object and bounded: a checkpoint is a resume position, not a
  -- transcript, and 64 KiB is far more than one needs.
  add constraint runs_exec_checkpoint_shape
    check (exec_checkpoint is null
           or (jsonb_typeof(exec_checkpoint) = 'object'
               and octet_length(exec_checkpoint::text) <= 65536)),
  add constraint runs_exec_checkpoint_stamped
    check ((exec_checkpoint is null) = (exec_checkpoint_at is null)),
  -- A base commit or a checkpoint belongs to a started execution.
  add constraint runs_exec_state_needs_start
    check (exec_epoch > 0 or (exec_base_commit is null and exec_checkpoint is null)),
  add constraint runs_exec_live_only
    check (exec_epoch = 0 or origin = 'live');

comment on column ouroboros.runs.exec_epoch is
  'How many times an engine worker has started this run (#160, ADR decision A). Incremented by POST /internal/runs/:id/start; every engine write carries it and a stale one is refused 409 fenced. 0 for a run never started — always, for a simulated or seeded one. Never decreases (runs_exec_guard).';
comment on column ouroboros.runs.exec_worker is
  'The worker holding the current epoch, as it named itself (#160) — the shape rule of queue_items.claimed_by. Null until the first start.';
comment on column ouroboros.runs.exec_heartbeat_at is
  'When the worker holding the epoch was last heard from (#160): set by start, heartbeat and checkpoint. The REST run supervisor resubmits a coding/building live run whose heartbeat is older than OURO_RUN_HEARTBEAT_STALE_SECONDS. Null until the first start. A heartbeat alone does not touch updated_at.';
comment on column ouroboros.runs.exec_base_commit is
  'The 40-hex commit the run''s working tree was cut from (#160), set by the first checkpoint that names it and immutable after (runs_exec_guard), so a resumed run reopens on the same base.';
comment on column ouroboros.runs.exec_checkpoint is
  'The interpreter''s opaque resume state (#160): position, attempts, loop rounds, the executor''s own checkpoint. A JSON object of at most 64 KiB; null until the first checkpoint.';
comment on column ouroboros.runs.exec_checkpoint_at is
  'When exec_checkpoint was last written (#160). Null exactly when it is.';

-- ---------------------------------------------------------------------------
-- 2. The two rules a CHECK cannot see: the epoch only rises, the base commit is set once.
-- ---------------------------------------------------------------------------
create function ouroboros.runs_exec_guard() returns trigger
  language plpgsql as $$
begin
  if new.exec_epoch < old.exec_epoch then
    raise exception 'run %: the execution epoch cannot go back from % to %',
        old.id, old.exec_epoch, new.exec_epoch
      using errcode = 'check_violation', constraint = 'runs_exec_epoch_monotonic';
  end if;

  if old.exec_base_commit is not null
     and new.exec_base_commit is distinct from old.exec_base_commit then
    raise exception 'run %: the base commit is already %', old.id, old.exec_base_commit
      using errcode = 'check_violation', constraint = 'runs_exec_base_commit_immutable';
  end if;

  return new;
end;
$$;

comment on function ouroboros.runs_exec_guard() is
  'Holds runs.exec_epoch to rising and runs.exec_base_commit to set-once (#160): a fenced worker cannot rewind the fence, and a resumed run cannot be rebased onto another commit.';

create trigger runs_exec_guard
  before update of exec_epoch, exec_base_commit on ouroboros.runs
  for each row execute function ouroboros.runs_exec_guard();

-- ---------------------------------------------------------------------------
-- 3. A heartbeat does not touch updated_at (V101's trigger, one more column skipped).
-- ---------------------------------------------------------------------------
drop trigger runs_touch_updated_at on ouroboros.runs;

create trigger runs_touch_updated_at
  before update on ouroboros.runs
  for each row
  when ((to_jsonb(new) - 'events_swept_at' - 'exec_heartbeat_at')
        is distinct from (to_jsonb(old) - 'events_swept_at' - 'exec_heartbeat_at'))
  execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. `runs_with_stage` carries the new columns too — V049's reason: a read moves from `runs` to
--    the view by changing one word, so the view has every column `runs` has (V145's definition,
--    plus six).
-- ---------------------------------------------------------------------------
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
       run.origin,
       run.queue_item_id,
       run.exec_epoch,
       run.exec_worker,
       run.exec_heartbeat_at,
       run.exec_base_commit,
       run.exec_checkpoint,
       run.exec_checkpoint_at
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407, #482, #1313, #91 and #160). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- 5. The ingestion ledger learns its seventh operation: finishing a run is idempotency-keyed
--    like every other engine write (V049's rule: a seventh is an edit to openapi.internal.yaml,
--    this list and tests/constraints.sql in one change).
-- ---------------------------------------------------------------------------
alter table ouroboros.run_ingest_receipts
  drop constraint run_ingest_receipts_operation,
  add constraint run_ingest_receipts_operation
    check (operation in ('run.create',
                         'run.stage_transition',
                         'run.events',
                         'run.files',
                         'run.commits',
                         'run.resources',
                         'run.finish'));

comment on constraint run_ingest_receipts_operation on ouroboros.run_ingest_receipts is
  'The seven operations openapi.internal.yaml publishes as idempotency-keyed (#303, #160 added run.finish). Closed, so a typo in a service is a refused write rather than a silently separate idempotency namespace.';
