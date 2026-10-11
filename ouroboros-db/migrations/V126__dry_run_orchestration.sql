-- V126__dry_run_orchestration.sql — what the dry-run orchestration needs that V111 did not
-- give it: the workspace's dry-run cap, and a terminal state for a run somebody stopped
-- (#562, CD.4).
--
-- Mockup 20's dry-run card runs real models, so it has a budget and a way out:
--
--   budget = min(the workspace's dry-run cap, the draft's own spend guard)
--   DRY RUN — #489 …   [cancelled — 3 of 7 stages kept]
--
-- Two additions:
--
--   1. **`workspace_settings.dry_run_cap_cents`** — the most one dry run may spend, in integer
--      cents, read through `workspace_settings_effective` so a workspace that never chose reads
--      the default from the database as it does for every other setting there:
--
--        dry_run_cap_cents   1 … 100000   default 1000   ($10.00)
--
--      It is a cap of its own rather than the org policy's `spend_guard.per_run_cap_cents`: that
--      one governs real loops, and a workspace may want a simulation held tighter (or looser)
--      than the work it simulates. The draft's spend guard is the copilot's proposal on the
--      conversation (V107/V110 — DSL v1 has no guard construct); the orchestrator takes the
--      lower of the two.
--   2. **`dry_runs.status = 'cancelled'`** — a fourth terminal state. A run a person stopped
--      did not break (`failed`), did not reach a cap (`budget_stopped`) and did not finish
--      (`complete`), and the card must be able to say which. `running → cancelled` only: the
--      pre-check is milliseconds and has nothing to keep. It carries no `failure_reason` —
--      nothing failed — and, like every terminal state, its rows so far are its record.
--
-- To undo (forward only — for a rehearsal against a copy):
--   update ouroboros.dry_runs set status = 'failed', failure_reason = 'cancelled' where status = 'cancelled';
--   restore V111's dry_runs_status, dry_runs_finished_when_terminal, dry_runs_transition() and
--   dry_run_children_open(); create or replace view ouroboros.workspace_settings_effective …
--   (V123's body); alter table ouroboros.workspace_settings drop column dry_run_cap_cents;

-- ---------------------------------------------------------------------------
-- 1. The workspace's dry-run cap.
-- ---------------------------------------------------------------------------
alter table ouroboros.workspace_settings
  add column dry_run_cap_cents integer not null default 1000
    constraint workspace_settings_dry_run_cap_bounded
      check (dry_run_cap_cents between 1 and 100000);

comment on column ouroboros.workspace_settings.dry_run_cap_cents is
  'The most one deep dry run may spend, in integer cents (#562, CD.4): 1–100000, default 1000 ($10.00). The orchestrator stops a dry run at the lower of this and the draft''s own spend guard.';

create or replace view ouroboros.workspace_settings_effective
  with (security_invoker = true) as
select o."id"                                     as organization_id,
       coalesce(s.auto_merge_on_checks, false)    as auto_merge_on_checks,
       (s.organization_id is not null)            as is_explicit,
       s.updated_at,
       s.updated_by,
       coalesce(s.runner_bearer_fallback, false)  as runner_bearer_fallback,
       coalesce(s.guardrail_exception_max_ttl_minutes, 1440) as guardrail_exception_max_ttl_minutes,
       coalesce(s.action_token_ttl_minutes, 2880)            as action_token_ttl_minutes,
       coalesce(s.research_start_role, 'member')  as research_start_role,

       -- Appended, as V041's, V096's and V123's columns were; the default restated here is
       -- asserted equal to the column's in constraints.sql.
       coalesce(s.dry_run_cap_cents, 1000)        as dry_run_cap_cents
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

comment on column ouroboros.workspace_settings_effective.dry_run_cap_cents is
  'The most one deep dry run may spend, in cents (#562): 1000 for a workspace that has never set it. Bound to the column default by constraints.sql.';

-- ---------------------------------------------------------------------------
-- 2. `cancelled` — a terminal state of its own.
-- ---------------------------------------------------------------------------
alter table ouroboros.dry_runs
  drop constraint dry_runs_status,
  drop constraint dry_runs_finished_when_terminal;

alter table ouroboros.dry_runs
  add constraint dry_runs_status
    check (status in ('precheck', 'running', 'complete', 'failed', 'budget_stopped', 'cancelled')),
  add constraint dry_runs_finished_when_terminal
    check ((status in ('complete', 'failed', 'budget_stopped', 'cancelled')) = (finished_at is not null));

-- dry_runs_failure_reason is V111's, unchanged: a reason exactly for failed and budget_stopped —
-- so a cancelled run carries none.

comment on column ouroboros.dry_runs.status is
  'precheck → running | failed; running → complete | failed | budget_stopped | cancelled. The four ends are terminal and distinct: cancelled (#562) is a run a person stopped, its rows so far kept.';
comment on column ouroboros.dry_runs.failure_reason is
  'Why the run stopped — required for failed and budget_stopped, null otherwise (a cancelled run did not fail).';

create or replace function ouroboros.dry_runs_transition()
returns trigger language plpgsql as $$
begin
  if new.organization_id <> old.organization_id or new.workflow_id <> old.workflow_id
     or new.base_version is distinct from old.base_version or new.draft_rev <> old.draft_rev
     or new.ticket_id <> old.ticket_id or new.pinned_sha <> old.pinned_sha
     or new.mode <> old.mode or new.started_at <> old.started_at
     or (new.session_id is distinct from old.session_id and new.session_id is not null) then
    raise exception 'dry run % keeps the draft, ticket, commit, mode and start it ran with', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status <> old.status
     and not ((old.status = 'precheck' and new.status in ('running', 'failed'))
              or (old.status = 'running'
                  and new.status in ('complete', 'failed', 'budget_stopped', 'cancelled'))) then
    raise exception 'dry run % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.status <> 'precheck' and new.precheck_findings is distinct from old.precheck_findings then
    raise exception 'dry run % keeps what its pre-check found', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- A finished dry run is a record: only a foreign key's own set-null may touch it.
  if old.status in ('complete', 'failed', 'budget_stopped', 'cancelled')
     and row(new.status, new.duration_ms, new.cost_cents, new.tokens, new.guard_audit,
             new.failure_reason, new.finished_at)
         is distinct from
         row(old.status, old.duration_ms, old.cost_cents, old.tokens, old.guard_audit,
             old.failure_reason, old.finished_at) then
    raise exception 'dry run % is %; its record is final', old.id, old.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.dry_runs_transition() is
  'Refuses a dry-run update that changes what was tested (workflow, draft, ticket, commit, mode, start, or a session other than its set-null), moves status outside precheck → running | failed and running → complete | failed | budget_stopped | cancelled, rewrites the pre-check''s findings after the pre-check, or changes a finished run (#557; cancelled since #562).';

create or replace function ouroboros.dry_run_children_open()
returns trigger language plpgsql as $$
declare
  run_status text;
begin
  select status into run_status from ouroboros.dry_runs
   where id = new.dry_run_id
   for share;

  if run_status in ('complete', 'failed', 'budget_stopped', 'cancelled')
     or (tg_op = 'UPDATE' and old.dry_run_id <> new.dry_run_id) then
    raise exception 'dry run % is %; its % are final', new.dry_run_id, run_status, tg_table_name
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.dry_run_children_open() is
  'Refuses a stage or artifact write once its dry run has finished — cancelled included (#562) — or a move to another dry run (#557): a finished dry run''s rows are its record.';
