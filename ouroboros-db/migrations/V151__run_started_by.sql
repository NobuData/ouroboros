-- ===========================================================================
-- V151 — who started a run (#1310, DI.2)
-- ===========================================================================
--
-- DI.2 publishes a live run's changes to the customer's repository: the engine commits them
-- under a configured Ouroboros identity with **the person who started the run as co-author**, and
-- every push is an audit row **naming that person** as its actor. Neither was possible before
-- this migration: a live run is started by a person confirming its queue item
-- (`queue_items.confirmed_by`, V146), and that row is deleted when the run opens (V145's claim is
-- consumed), so the run outlived the only record of who started it.
--
--   column       written by                      what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   started_by   the open-run write, once        the user who confirmed the queue item the run
--                (POST /internal/runs)           was opened from; null for a run with no such
--                                                person — the simulator, the seeds, a run opened
--                                                before this migration
--
-- **Set null, not cascade, on the person's deletion.** A run is the workspace's history, not the
-- person's: removing an account must not remove the runs it started, and the audit rows already
-- written keep the actor id they were written with (V022 keeps `actor_id` without a foreign key).
--
-- The column is written by ouroboros-rest's owner connection like every other run column (the
-- application role holds no grant on runs, V048's header); nothing updates it after the open.
--
-- **The ingestion ledger learns its eighth operation, `run.push_result`.** The engine reports how
-- its push ended (`POST /internal/runs/:id/push/result`) idempotency-keyed like every other engine
-- write. The push **grant** is deliberately not a ledger operation: a receipt stores the answer,
-- and the grant's answer carries the workspace's GitHub token for one call — a replay must open
-- the credential again, never read it back out of a table.
--
-- To undo (forward only — for a rehearsal against a copy):
--   recreate runs_with_stage with V147's body;
--   recreate run_ingest_receipts_operation with V147's list;
--   alter table ouroboros.runs drop column started_by;
-- ===========================================================================

alter table ouroboros.runs
  add column started_by text references ouroboros."user" ("id") on delete set null;

comment on column ouroboros.runs.started_by is
  'The user who confirmed the queue item this run was opened from — the co-author of its commits and the actor of its push audit rows (#1310, DI.2). Null for a run no person started (simulator, seeds, runs opened before V151). Set once at open; set null if the person is deleted.';

-- A run's pushes are looked up by the person who started them on the audit plane, not here; the
-- index serves the foreign key's set-null on a user deletion, which would otherwise scan runs.
create index runs_started_by_idx on ouroboros.runs (started_by) where started_by is not null;

-- ---------------------------------------------------------------------------
-- `runs_with_stage` carries the new column too — V049's reason: a read moves from `runs` to the
-- view by changing one word, so the view has every column `runs` has (V147's definition, plus
-- one).
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
       run.exec_checkpoint_at,
       run.started_by
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407, #482, #1313, #91, #160 and #1310). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- The ingestion ledger's eighth operation (V049's rule: an eighth is an edit to
-- openapi.internal.yaml, this list and tests/constraints.sql in one change).
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
                         'run.finish',
                         'run.push_result'));

comment on constraint run_ingest_receipts_operation on ouroboros.run_ingest_receipts is
  'The eight operations openapi.internal.yaml publishes as idempotency-keyed (#303, #160 added run.finish, #1310 run.push_result). Closed, so a typo in a service is a refused write rather than a silently separate idempotency namespace. The push grant is not one: its answer carries a credential no receipt may store.';
