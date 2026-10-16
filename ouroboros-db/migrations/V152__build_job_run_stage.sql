-- ===========================================================================
-- V152 — which stage of a run a build job is (#265, AJ.3)
-- ===========================================================================
--
-- AJ.3 wires a workflow's build stage to the farm: the engine submits a job for a live run through
-- `POST /internal/runs/:id/builds`, and `build_jobs.run_id` — nullable since V040 for exactly this
-- linkage (decision B6) — is finally filled. A run has more than one build stage (`build`, `test`)
-- and enters each more than once (a gate's `onFail` loops back through them), so the run alone
-- does not say which timeline row a job belongs to. Two columns do:
--
--   column          written by                         what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   stage_key       the run-build submit, once;        the workflow node the job builds for —
--                   copied onto an automatic retry     `run_stages.stage_key`
--   stage_attempt   the same                           the attempt of that stage — 1-based, as
--                                                      `run_stages.attempt`
--
-- Both are null on every job a person, the API, a hook or a re-run submitted: those have no stage.
-- They are set together or not at all (`build_jobs_stage_pair`).
--
-- **One submission per stage attempt.** `build_jobs_run_stage_key` is unique over the first job of
-- each (run, stage, attempt) — retries excluded, because an automatic retry copies the stage and
-- is a second row for the same attempt by design. The submit route reads it as its idempotency:
-- an engine that resends a submission it never saw answered finds the job it already created.
--
-- No check ties `stage_key` to `run_id`: a job detached from its run keeps the stage it built
-- for, and the name it leaves behind is history, not a reference.
--
-- To undo (forward only — for a rehearsal against a copy):
--   drop index ouroboros.build_jobs_run_stage_key;
--   alter table ouroboros.build_jobs drop constraint build_jobs_stage_pair,
--     drop column stage_attempt, drop column stage_key;
-- ===========================================================================

alter table ouroboros.build_jobs
  add column stage_key text,
  add column stage_attempt integer;

alter table ouroboros.build_jobs
  add constraint build_jobs_stage_pair
    check (
      (stage_key is null and stage_attempt is null)
      or (stage_key is not null and stage_attempt is not null)
    ),
  add constraint build_jobs_stage_key_shape
    check (stage_key is null or length(stage_key) between 1 and 200),
  add constraint build_jobs_stage_attempt_positive
    check (stage_attempt is null or stage_attempt >= 1);

comment on column ouroboros.build_jobs.stage_key is
  'The workflow stage of the run this job builds for — run_stages.stage_key (#265, AJ.3). Null for every job not submitted by a run''s build stage. Copied onto an automatic retry.';

comment on column ouroboros.build_jobs.stage_attempt is
  'The attempt of stage_key this job builds for, 1-based as run_stages.attempt (#265, AJ.3). Set with stage_key or not at all.';

-- The submit route's idempotency and the console's read: the first job of each stage attempt.
create unique index build_jobs_run_stage_key
  on ouroboros.build_jobs (run_id, stage_key, stage_attempt)
  where stage_key is not null and run_id is not null and retry_of is null;
