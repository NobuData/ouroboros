-- V101__retention_ceiling_transcript_sweep.sql — retention tiers bounded above, and the
-- transcript sweep the `transcripts` tier governs (BQ.3, #482).
--
-- BQ.3 makes `retention_policies` (V094) the one config every sweep reads. Two things the schema
-- did not have yet:
--
--   1. **A ceiling per class** (`retention_policies_days_ceiling`). V094 bounded a tier below —
--      audit at least 90 days, everything else at least 7 — so a setting cannot destroy what a
--      quarterly review or a long weekend's investigation needs. The ceiling is the other half:
--      a mistyped `3650` on loop data would quietly turn a cleanup into unbounded growth. The
--      three loop classes the workspace card's one select governs (`transcripts`, `build_logs`,
--      `artifacts`) are kept **at most 365 days**; `audit` and every `custom:*` class **at most
--      3650** (ten years — the longest regulatory horizon a self-hosted install is likely to be
--      asked for). REST refuses the same bounds first, with a reason the card renders.
--
--   2. **The transcript sweep.** `run_events` (V046, #299) is append-only for the application role
--      — no `delete`, by grant — and nothing pruned it, so the card's *transcripts* promise had no
--      sweep behind it. `run_events_sweep()` is that sweep's one write: it removes **a finished
--      run's whole transcript** once the run finished before the cutoff, and stamps the run's new
--      `events_swept_at` tombstone, so the console answers *removed by retention* rather than a
--      run that looks as if it said nothing. A definer function rather than a `delete` grant:
--      the application role still cannot delete one entry of a transcript, or any entry of a live
--      run's, and the function refuses a cutoff newer than the class's 7-day floor — so even a
--      caller that computed its cutoff wrongly cannot sweep inside the window the policy
--      guarantees. The cutoff itself is REST's `RetentionPolicyService`'s; the function computes
--      no date arithmetic beyond that floor check.
--
--   3. **The artifact sweep's index.** It now cuts on `created_at` against the workspace's
--      `artifacts` cutoff, so the live rows are indexed by `created_at`
--      (`test_artifacts_live_created_idx`, replacing V055's `retained_until` index).

-- ---------------------------------------------------------------------------
-- 1. retention_policies — bounded above as well as below.
-- ---------------------------------------------------------------------------
alter table ouroboros.retention_policies
  add constraint retention_policies_days_ceiling
    check (days <= case when data_class in ('transcripts', 'build_logs', 'artifacts') then 365
                        else 3650 end);

comment on constraint retention_policies_days_ceiling on ouroboros.retention_policies is
  'A tier is bounded above (#482): the loop-data classes (transcripts, build_logs, artifacts) at most 365 days, audit and custom:* at most 3650 — so a mistyped value cannot configure unbounded growth.';

comment on column ouroboros.retention_policies.days is
  'Whole days kept. At least 90 for audit and 7 for every other class (retention_policies_days_floor); at most 365 for the loop-data classes and 3650 for audit and custom:* (retention_policies_days_ceiling).';

-- ---------------------------------------------------------------------------
-- 2. runs.events_swept_at — the transcript's tombstone.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column events_swept_at timestamptz;

alter table ouroboros.runs
  -- Only a finished run's transcript is ever swept: a live run's is what the console is reading.
  add constraint runs_events_swept_when_finished
    check (events_swept_at is null or finished_at is not null);

comment on column ouroboros.runs.events_swept_at is
  'When the retention sweep removed this run''s transcript (#482) — set by run_events_sweep() alone, and only on a finished run. Null while the transcript is kept.';

-- The tombstone is not the run being heard from. `updated_at` is the dashboard's freshness signal
-- (V008), so a sweep that stamped it would make a month-old run look as if it had just reported.
-- The touch trigger is recreated to skip an update that changes `events_swept_at` and nothing
-- else; `updated_at` stays inside the comparison, so a statement still cannot backdate it.
drop trigger runs_touch_updated_at on ouroboros.runs;

create trigger runs_touch_updated_at
  before update on ouroboros.runs
  for each row
  when ((to_jsonb(new) - 'events_swept_at') is distinct from (to_jsonb(old) - 'events_swept_at'))
  execute function ouroboros.touch_updated_at();

-- `runs_with_stage` carries the new column too — V049's reason: a read moves from `runs` to the
-- view by changing one word, so the view has every column `runs` has (V072's definition, plus one).
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
       run.events_swept_at
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407 and #482). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- The sweep's candidate scan: finished runs whose transcript is still kept, oldest first.
create index runs_events_unswept_idx
  on ouroboros.runs (finished_at)
  where events_swept_at is null and finished_at is not null;

-- ---------------------------------------------------------------------------
-- 3. run_events_sweep() — remove one finished run's whole transcript, and tombstone it.
-- ---------------------------------------------------------------------------
--
-- **Why `security definer`.** The application role holds `select` and `insert` on `run_events`
-- and nothing else (V046), and that posture is what keeps a transcript from being edited. The
-- sweep needs one `delete`, of one run's entries, when that run is finished and past the cutoff;
-- running as the owner gives it exactly that and nothing wider. Narrow on inspection, for
-- V046's reasons: no dynamic SQL, every relation qualified, `search_path` pinned with `pg_temp`
-- last, and `execute` revoked from `public` and granted to the application role alone.
--
-- Returns the tombstone counts — entries and body bytes removed — or no row when the run is not
-- sweepable (live, already swept, another workspace's, locked by a concurrent sweep, or finished
-- at or after the cutoff), so a caller never mistakes "nothing to do" for "removed nothing".
create function ouroboros.run_events_sweep(p_organization_id text, p_run_id uuid,
                                           p_cutoff timestamptz, p_at timestamptz)
returns table (events integer, bytes bigint)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  swept_run uuid;
begin
  -- The floor, again, beneath the service: no cutoff may reach inside the last seven days.
  if p_cutoff > now() - interval '7 days' then
    raise exception 'a transcript cutoff of % is inside the 7-day retention floor', p_cutoff
      using errcode = 'check_violation',
            constraint = 'run_events_sweep_cutoff_floor',
            hint = 'The cutoff is RetentionPolicyService''s now() - days for the transcripts tier, and that tier is at least 7 days (#482).';
  end if;

  select run.id
    into swept_run
    from ouroboros.runs run
   where run.id = p_run_id
     and run.organization_id = p_organization_id
     and run.finished_at is not null
     and run.finished_at < p_cutoff
     and run.events_swept_at is null
     for update skip locked;

  if swept_run is null then
    return;
  end if;

  return query
    with removed as (
      delete from ouroboros.run_events entry
       where entry.run_id = swept_run
      returning octet_length(coalesce(entry.body, ''))
                + coalesce(octet_length(entry.payload::text), 0) as size
    )
    select count(*)::integer, coalesce(sum(removed.size), 0)::bigint from removed;

  update ouroboros.runs
     set events_swept_at = p_at
   where id = swept_run;
end;
$$;

comment on function ouroboros.run_events_sweep(text, uuid, timestamptz, timestamptz) is
  'The transcript retention sweep''s one write (#482): removes every run_events entry of one finished run of the workspace whose finished_at is before p_cutoff, and stamps runs.events_swept_at = p_at. Returns (events, bytes) removed, or no row when the run is not sweepable. Refuses a cutoff inside the 7-day floor. Runs as the owner because the application role cannot delete from run_events (V046).';

revoke execute on function ouroboros.run_events_sweep(text, uuid, timestamptz, timestamptz) from public;
grant execute on function ouroboros.run_events_sweep(text, uuid, timestamptz, timestamptz) to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 4. The artifact sweep cuts on when an artifact was stored.
-- ---------------------------------------------------------------------------
--
-- The artifact sweep used to read each row's `retained_until`, stamped at upload, so a tier changed
-- later never reached what was already stored. It now compares `created_at` with the workspace's
-- `artifacts` cutoff (#482), so its scan wants `created_at` among the live rows. V055's
-- `test_artifacts_retention_idx` served the old predicate and nothing else reads `retained_until`
-- in a filter (it is still written — the card's `retained 30d`), so it is replaced rather than
-- kept as a second index on every upload.
drop index ouroboros.test_artifacts_retention_idx;

create index test_artifacts_live_created_idx
  on ouroboros.test_artifacts (created_at)
  where expired_at is null;

comment on index ouroboros.test_artifacts_live_created_idx is
  'The artifact retention sweep''s scan (#482): live artifacts stored before their workspace''s artifacts cutoff, oldest first. Replaces V055''s test_artifacts_retention_idx.';
