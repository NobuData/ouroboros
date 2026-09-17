-- V039__reestimation_runs.sql — `reestimation_runs` and `reestimation_run_counts`: the record the
-- nightly re-estimation job keeps of itself, so *"Estimator re-runs nightly"* can be checked.
--
-- AL.5 (#281) under epic #269, decision **N9**. Mockup 09's *Backlog Health* card ends in the
-- footnote *"Estimator re-runs nightly on unsized issues"*, and the issue asks for it to stop being
-- copy: the job is real, and its **last run time and processed counts** are surfaced in the card's
-- tooltip (`re-runs nightly (02:14 ✓)`), so somebody who asks when it last ran gets an answer.
--
-- ---------------------------------------------------------------------------
-- Stored, not held in memory.
-- ---------------------------------------------------------------------------
--
-- A record kept in the process would be lost on every restart — a deploy at noon and the tooltip
-- says *never* until two in the morning — and every replica would hold its own answer. A row is the
-- one record every instance reads the same way, and it survives the thing that most often happens
-- to a service between two nights.
--
-- ---------------------------------------------------------------------------
-- One run per night, across the fleet.
-- ---------------------------------------------------------------------------
--
-- `night` is the date whose scheduled slot a run belongs to, and it is **unique**. Every replica
-- schedules the job, each with its own jitter; the first to start inserts the night and does the
-- work, and every later one collides on `reestimation_runs_night_key` and stands down. That is what
-- keeps N replicas from dispatching N bounded batches — a bound multiplied by the fleet is not a
-- bound — and it is the database's guarantee rather than a lock any one process holds.
--
-- ---------------------------------------------------------------------------
-- Counts are per workspace, and the run is not.
-- ---------------------------------------------------------------------------
--
-- The job sweeps every workspace at once, so *when it ran* and *whether it finished* are facts
-- about the deployment, and any workspace may read them. *How many tickets it found and queued* is
-- a fact about somebody's backlog, and reading another workspace's is a tenancy leak even as a
-- number — so those live in `reestimation_run_counts`, keyed by workspace and cascading with it. A
-- workspace the run found nothing in has no row, and reads zeros.

create table ouroboros.reestimation_runs (
  id          uuid        primary key default gen_random_uuid(),
  night       date        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text        not null default 'running',
  batch_limit integer     not null,
  constraint reestimation_runs_night_key unique (night),
  constraint reestimation_runs_status
    check (status in ('running', 'succeeded', 'failed')),
  constraint reestimation_runs_finished_when_settled
    check ((status = 'running') = (finished_at is null)),
  constraint reestimation_runs_finished_after_started
    check (finished_at is null or finished_at >= started_at),
  constraint reestimation_runs_batch_limit_positive
    check (batch_limit >= 1)
);

comment on table ouroboros.reestimation_runs is
  'One night of the nightly re-estimation job (#281, AL.5, decision N9) — when it started, whether it finished, and the batch bound it ran under. What the Backlog Health card''s last-run tooltip reads, so the footnote "Estimator re-runs nightly" is checkable. Deployment-wide: per-workspace counts are reestimation_run_counts''.';
comment on column ouroboros.reestimation_runs.night is
  'The date of the scheduled slot this run belongs to, in UTC. Unique, which is what lets every replica schedule the job while only the first to start one night runs it.';
comment on column ouroboros.reestimation_runs.status is
  'running | succeeded | failed. Closed because the tooltip renders each as a mark (… ✓ ✗). A run that queued its batch has succeeded: the estimates themselves finish later, each in its own terminal status.';
comment on column ouroboros.reestimation_runs.batch_limit is
  'The most tickets the run was allowed to queue, across every workspace — recorded so a count that reached it reads as a bound doing its job rather than as the whole backlog.';
comment on constraint reestimation_runs_night_key on ouroboros.reestimation_runs is
  'At most one run per night across the fleet (#281): the second replica to start collides here and stands down, so a bounded batch is not multiplied by the number of instances.';
comment on constraint reestimation_runs_finished_when_settled on ouroboros.reestimation_runs is
  'A run has a finish time exactly when it has stopped running — a succeeded run with no finish time is a tooltip with nothing to print.';

-- The tooltip's read: the latest run, one index step.
create index reestimation_runs_started_at_idx
  on ouroboros.reestimation_runs (started_at desc);

create table ouroboros.reestimation_run_counts (
  run_id          uuid    not null
                          references ouroboros.reestimation_runs (id) on delete cascade,
  organization_id text    not null
                          references ouroboros.organization ("id") on delete cascade,
  found           integer not null,
  queued          integer not null,
  in_flight       integer not null,
  constraint reestimation_run_counts_pkey primary key (run_id, organization_id),
  constraint reestimation_run_counts_non_negative
    check (found >= 0 and queued >= 0 and in_flight >= 0),
  constraint reestimation_run_counts_add_up
    check (queued + in_flight = found)
);

comment on table ouroboros.reestimation_run_counts is
  'What one nightly re-estimation run did in one workspace (#281): the open unsized tickets it selected, how many it queued, and how many the pipeline was already sizing. Separate from reestimation_runs because a count of somebody''s backlog is tenant data. A workspace with no row found nothing that night, and reads zeros.';
comment on column ouroboros.reestimation_run_counts.found is
  'Open, unsized tickets of this workspace the run selected — within the run''s batch_limit, so not necessarily the whole unsized backlog.';
comment on column ouroboros.reestimation_run_counts.queued is
  'How many of them were handed to the estimation orchestrator (#107).';
comment on column ouroboros.reestimation_run_counts.in_flight is
  'How many the orchestrator was already sizing, and so did not queue twice.';
comment on constraint reestimation_run_counts_add_up on ouroboros.reestimation_run_counts is
  'Every ticket a run selected was either queued or already in flight — a count that did not add up would be a ticket the job lost track of.';
