-- V111__dry_run_records.sql — the deep dry run's record, in a domain of its own: the run, its
-- per-stage results with the truth of how each was produced, the simulated diff and excerpts,
-- costs and history (#557, CC.3; decision W4).
--
-- Mockup 20's dry-run card:
--
--   DRY RUN — #489 …   [simulated — no writes · no PRs · no merges]   2m 41s · $0.31
--
--   ✓ analyze                                 mapped 4 files · advisory DB skipped (no CVE on this issue)
--   ✓ plan                                    3 steps · would touch drivers/can/arbitration.c
--   ✓ implement      (simulated)              diff drafted +41 −9 (below) · 84k tokens
--   ✓ build          (replayed from history)  est. 4m 02s (214 similar builds, ±20s)
--   ⏸ exploit-verify (skipped)                no PoC exists: stage had nothing to do
--   ✓ review ×2                               both approve · 1 style nit
--   ○ open PR                                 would open DRAFT PR · not merged (policy)
--
--   @@ drivers/can/arbitration.c · simulated diff (never written to repo) @@
--
--   history: 1 dry run · draft v0.3 (2 copilot edits applied)
--
-- Three tables:
--
--   1. **`dry_runs`** — one dry run of one draft revision against one canonical ticket (#138):
--      the workflow and `(base_version, draft_rev)` under test (V110's `v{base}.{rev}`), the
--      copilot session that proposed it (nullable — the studio can start one too), the
--      `pinned_sha` the virtual workspace read at, `mode`, `status`, totals, the guard audit, the
--      R.2 pre-check's findings, and its timings.
--   2. **`dry_run_stages`** — one result row per stage, in `seq` order: `verdict` (what happened)
--      and `how` (how the result was produced), the composed `note`, `metrics`, `skip_reason`.
--   3. **`dry_run_artifacts`** — the overlay diff and the plan/review excerpts, bounded.
--
-- ---------------------------------------------------------------------------
-- Why a domain of its own (W4)
-- ---------------------------------------------------------------------------
--
-- A dry run has stages, durations and a cost: it is shaped almost exactly like a run. If one
-- reached the run read-model, every dashboard loop count, cycle time and spend rollup would
-- silently include work that never happened. So nothing here has a foreign key into the run plane
-- and no run read-model view selects from here — and that is asserted rather than hoped:
-- `dry_run_isolation_violations` lists every foreign key between a `dry_run*` table and the run
-- plane (`runs` and every table with a foreign-key path into it), and every view that reads from
-- both. It is empty, and tests assert it stays so.
--
-- ---------------------------------------------------------------------------
-- `verdict` and `how`
-- ---------------------------------------------------------------------------
--
--   card row          verdict       how             how label (dry_run_stage_how_label)
--   ---------------   -----------   -------------   ------------------------------------
--   analyze ✓         ok            llm             —
--   plan ✓            ok            llm             —
--   implement ✓       ok            llm             simulated  (metrics.simulated_writes > 0)
--   build ✓           ok            replayed        replayed from history
--   exploit-verify ⏸  skipped       skipped         skipped    (skip_reason says why)
--   review ×2 ✓       ok            llm             —
--   open PR ○         not_reached   deterministic   —          (a dry run never opens one)
--
-- The label is derived, not stored, so it cannot drift from the truth it names. A `replayed`
-- result is a statistical estimate, not a measurement: its metrics must carry `estimate_ms`
-- **with** `sample_count` (≥ 1), `spread_ms` and `similarity_class`, so the card can say
-- `est. 4m 02s (214 similar builds, ±20s)` and a low-sample estimate can be rendered honestly.
-- A row is `skipped` in its verdict exactly when it is in its `how`, and only then has a reason.
--
-- ---------------------------------------------------------------------------
-- Costs, bounds and the guard audit
-- ---------------------------------------------------------------------------
--
-- `cost_cents` is **null when unpriced** — never a fabricated 0 — as in V107. `budget_stopped` is
-- a terminal status of its own: neither `failed` (something broke) nor `complete` (it ran to the
-- end). An artifact's `content` is at most 64 KiB; `original_bytes` is the size before
-- truncation and `truncated` says so, held consistent by a CHECK — a partial diff never reads as
-- whole. `path_summary` (`[{path, added, removed}]`) lets the diff's header render without
-- parsing it. `guard_audit` is the blocked-call summary — `[]` on a clean run — and
-- `guards_clean` is generated from it, so a populated audit is a visible failure signal.
--
-- ---------------------------------------------------------------------------
-- Retention — two custom classes (#482)
-- ---------------------------------------------------------------------------
--
--   class                       what it governs
--   -------------------------   ------------------------------------------------------------
--   custom:dry-run              a finished dry run and its stage results — the history line
--   custom:dry-run-artifacts    its overlay diff and excerpts — the bulk
--
-- `dry_runs_sweep()` is the one delete. Artifacts are cut at the later of the two cutoffs, so
-- they always expire no later than their record: history survives without the bulk. A dry run
-- still in `precheck` or `running` is never swept.
--
-- Revert forward:
--   drop view ouroboros.dry_run_isolation_violations;
--   drop table ouroboros.dry_run_artifacts, ouroboros.dry_run_stages, ouroboros.dry_runs;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers. Immutable, so the CHECKs below can call them; plpgsql with early returns, for
-- V106's reason — a wrong-typed value must come back `false` so the CHECK names itself.
-- ---------------------------------------------------------------------------

-- dry_run_guard_audit_valid(audit) — whether a guard audit is an array of blocked-call entries,
-- each {guard, call, count} plus an optional stage_key: guard and call non-blank strings (what
-- kind of guard held, and what was attempted), count a positive integer, stage_key a DSL slug.
--   audit — the jsonb value to inspect
--   returns true when well-formed (the empty array — a clean run — included)
create function ouroboros.dry_run_guard_audit_valid(audit jsonb)
returns boolean language plpgsql immutable as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(audit) is distinct from 'array' then
    return false;
  end if;
  for entry in select e from jsonb_array_elements(audit) e loop
    if jsonb_typeof(entry) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(entry) k where k not in ('guard', 'call', 'count', 'stage_key'))
       or not ouroboros.jsonb_nonblank_string(entry -> 'guard')
       or not ouroboros.jsonb_nonblank_string(entry -> 'call')
       or not ouroboros.jsonb_nonneg_int(entry -> 'count')
       or (entry ->> 'count')::bigint < 1 then
      return false;
    end if;
    if entry ? 'stage_key'
       and not (jsonb_typeof(entry -> 'stage_key') = 'string'
                and (entry ->> 'stage_key') ~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function ouroboros.dry_run_guard_audit_valid(jsonb) is
  'True when a value is a JSON array of blocked-call entries {guard, call, count, stage_key?}: guard and call non-blank strings, count a positive integer, stage_key a DSL slug when present (#557). The empty array is a clean run.';

-- dry_run_stage_metrics_valid(how, metrics) — whether a stage's metrics fit its `how`.
--   Every stage may carry tokens, cost_cents, files_touched, simulated_writes, lines_added and
--   lines_removed (non-negative integers; cost_cents is absent when unpriced, never 0 by
--   default). A `replayed` stage must also carry estimate_ms, sample_count (≥ 1), spread_ms
--   (non-negative integers) and similarity_class (a non-blank string) — the estimate and its
--   basis together — and no other stage may carry any of them.
--   how     — the stage's how (llm | replayed | deterministic | skipped)
--   metrics — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.dry_run_stage_metrics_valid(how text, metrics jsonb)
returns boolean language plpgsql immutable as $$
declare
  key text;
  replay_keys constant text[] := array['estimate_ms', 'sample_count', 'spread_ms', 'similarity_class'];
  count_keys constant text[] := array['tokens', 'cost_cents', 'files_touched', 'simulated_writes',
                                      'lines_added', 'lines_removed', 'estimate_ms', 'sample_count',
                                      'spread_ms'];
begin
  if jsonb_typeof(metrics) is distinct from 'object' then
    return false;
  end if;
  for key in select k from jsonb_object_keys(metrics) k loop
    if key = 'similarity_class' then
      if not ouroboros.jsonb_nonblank_string(metrics -> key) then
        return false;
      end if;
    elsif key = any (count_keys) then
      if not ouroboros.jsonb_nonneg_int(metrics -> key) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  if how = 'replayed' then
    return metrics ?& replay_keys and (metrics ->> 'sample_count')::bigint >= 1;
  end if;
  return not (metrics ?| replay_keys);
end;
$$;

comment on function ouroboros.dry_run_stage_metrics_valid(text, jsonb) is
  'True when a stage''s metrics are an object of known keys — tokens, cost_cents, files_touched, simulated_writes, lines_added, lines_removed (non-negative integers) — and, exactly on a replayed stage, the estimate with its basis: estimate_ms, sample_count ≥ 1, spread_ms and a non-blank similarity_class (#557).';

-- dry_run_path_summary_valid(summary) — whether a path summary is a non-empty array of
-- {path, added, removed}: path a non-blank string, distinct across entries; added and removed
-- non-negative integers. The diff header renders from it without parsing the diff.
--   summary — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.dry_run_path_summary_valid(summary jsonb)
returns boolean language plpgsql immutable as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(summary) is distinct from 'array' or jsonb_array_length(summary) = 0 then
    return false;
  end if;
  for entry in select e from jsonb_array_elements(summary) e loop
    if not (ouroboros.jsonb_keys_are(entry, array['path', 'added', 'removed'])
            and ouroboros.jsonb_nonblank_string(entry -> 'path')
            and ouroboros.jsonb_nonneg_int(entry -> 'added')
            and ouroboros.jsonb_nonneg_int(entry -> 'removed')) then
      return false;
    end if;
  end loop;
  return (select count(*) = count(distinct e ->> 'path') from jsonb_array_elements(summary) e);
end;
$$;

comment on function ouroboros.dry_run_path_summary_valid(jsonb) is
  'True when a value is a non-empty JSON array of exactly {path, added, removed} — path a non-blank string, unique; added and removed non-negative integers (#557).';

-- dry_run_stage_how_label(how, metrics) — the label a result row shows beside its stage name.
--   how     — the stage's how
--   metrics — the stage's metrics
--   returns 'replayed from history' for a replay, 'skipped' for a skip, 'simulated' for an LLM
--           stage whose writes were virtualized (metrics.simulated_writes > 0), and null otherwise
create function ouroboros.dry_run_stage_how_label(how text, metrics jsonb)
returns text language sql immutable as $$
  select case
           when how = 'replayed' then 'replayed from history'
           when how = 'skipped' then 'skipped'
           when how = 'llm' and ouroboros.jsonb_nonneg_int(metrics -> 'simulated_writes')
                and (metrics ->> 'simulated_writes')::bigint > 0 then 'simulated'
         end;
$$;

comment on function ouroboros.dry_run_stage_how_label(text, jsonb) is
  'The how label of a dry-run result row (#557): replayed from history | skipped | simulated (an llm stage with simulated_writes > 0) | null. Derived, so it cannot drift from how and metrics.';

-- ---------------------------------------------------------------------------
-- dry_runs — one dry run of one draft revision against one ticket.
-- ---------------------------------------------------------------------------
create table ouroboros.dry_runs (
  id                uuid        primary key default gen_random_uuid(),

  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  -- The workflow whose draft was tested — of this workspace, by the composite key below.
  workflow_id       uuid        not null,

  -- The draft under test, as V110 numbers it: v{base_version or 0}.{draft_rev}. base_version is
  -- null before the workflow's first publish.
  base_version      integer
                    constraint dry_runs_base_version_positive
                      check (base_version is null or base_version >= 1),
  draft_rev         integer     not null
                                constraint dry_runs_draft_rev_nonnegative check (draft_rev >= 0),

  -- The copilot conversation that proposed it; null when started from the studio, and set null
  -- when a closed session is swept — the record outlives the transcript. Must be a conversation
  -- about this workflow (dry_runs_references_check).
  session_id        uuid,

  -- The canonical ticket (#138) it ran against — tracker-agnostic by construction. Of this
  -- workspace (dry_runs_references_check). Cascade, as everything ingested from a source.
  ticket_id         uuid        not null
                                references ouroboros.tickets (id) on delete cascade,

  -- The commit the virtual workspace read at.
  pinned_sha        text        not null
                                constraint dry_runs_pinned_sha_format
                                  check (pinned_sha ~ '^[0-9a-f]{40}$'),

  -- deep: LLM stages, virtualized writes, replayed infra. deep_build is reserved and inert until
  -- CF.3 (#572) activates it.
  mode              text        not null default 'deep'
                                constraint dry_runs_mode check (mode in ('deep', 'deep_build')),

  status            text        not null default 'precheck'
                                constraint dry_runs_status
                                  check (status in ('precheck', 'running', 'complete', 'failed',
                                                    'budget_stopped')),

  -- Totals. duration_ms is set exactly when the run finished; cost_cents is null when unpriced
  -- (never a fabricated 0); tokens is null when nothing was metered.
  duration_ms       bigint      constraint dry_runs_duration_nonnegative check (duration_ms >= 0),
  cost_cents        integer     constraint dry_runs_cost_nonnegative check (cost_cents >= 0),
  tokens            bigint      constraint dry_runs_tokens_nonnegative check (tokens >= 0),

  -- The blocked-call summary: [] on a clean run; populated when a guard held.
  guard_audit       jsonb       not null default '[]'
                                constraint dry_runs_guard_audit_shape
                                  check (ouroboros.dry_run_guard_audit_valid(guard_audit)),

  -- Whether no guard had to hold — the safety strip's claim, from the audit itself.
  guards_clean      boolean     generated always as (guard_audit = '[]'::jsonb) stored,

  -- The R.2 structural pre-check's findings (publish-finding shaped). Null until it has run.
  precheck_findings jsonb       constraint dry_runs_precheck_findings_shape
                                  check (precheck_findings is null
                                         or (jsonb_typeof(precheck_findings) = 'array'
                                             and not jsonb_path_exists(precheck_findings,
                                                                       '$[*] ? (@.type() != "object")'))),

  -- Why it stopped, for failed and budget_stopped; null otherwise.
  failure_reason    text,

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  constraint dry_runs_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade,
  constraint dry_runs_session_fk
    foreign key (session_id, organization_id)
    references ouroboros.copilot_sessions (id, organization_id) on delete set null (session_id),

  constraint dry_runs_finished_when_terminal
    check ((status in ('complete', 'failed', 'budget_stopped')) = (finished_at is not null)),
  constraint dry_runs_finished_after_started
    check (finished_at is null or finished_at >= started_at),
  constraint dry_runs_duration_when_finished
    check ((duration_ms is not null) = (finished_at is not null)),
  constraint dry_runs_failure_reason
    check ((status in ('failed', 'budget_stopped'))
           = (failure_reason is not null and btrim(failure_reason) <> '')
           and (failure_reason is null or btrim(failure_reason) <> '')),

  -- R.2 runs before every deep dry run: a run past its pre-check carries what the pre-check said.
  constraint dry_runs_precheck_recorded
    check (status in ('precheck', 'failed') or precheck_findings is not null),

  -- The target of the children's composite keys.
  constraint dry_runs_id_organization_key unique (id, organization_id)
);

comment on table ouroboros.dry_runs is
  'One deep dry run (#557, CC.3) of a workflow''s draft revision against a canonical ticket, in its own domain (decision W4): no foreign key into the run plane and no run read-model view reads it (dry_run_isolation_violations). Retention: custom:dry-run, through dry_runs_sweep().';
comment on column ouroboros.dry_runs.base_version is
  'The published version the tested draft was based on; null before the first publish. With draft_rev, the v{base}.{rev} the history line names.';
comment on column ouroboros.dry_runs.draft_rev is
  'The draft revision tested (workflows.draft_rev at the time, V110).';
comment on column ouroboros.dry_runs.session_id is
  'The copilot session that proposed the dry run — a conversation about this workflow. Null when started from the studio, or once the session is swept.';
comment on column ouroboros.dry_runs.ticket_id is
  'The canonical ticket (#138) the dry run ran against, of the same workspace.';
comment on column ouroboros.dry_runs.pinned_sha is
  'The full commit sha the virtual workspace read at.';
comment on column ouroboros.dry_runs.mode is
  'deep | deep_build. deep_build is reserved and inert until CF.3 (#572).';
comment on column ouroboros.dry_runs.status is
  'precheck → running | failed; running → complete | failed | budget_stopped. complete, failed and budget_stopped are terminal and distinct.';
comment on column ouroboros.dry_runs.cost_cents is
  'What the dry run cost, in cents. Null when unpriced — never a fabricated 0.';
comment on column ouroboros.dry_runs.guard_audit is
  '[{guard, call, count, stage_key?}] — what the tool-boundary guards blocked. [] on a clean run; a populated audit is itself a failure signal.';
comment on column ouroboros.dry_runs.guards_clean is
  'Generated: whether guard_audit is empty — the safety strip''s claim, as a record.';
comment on column ouroboros.dry_runs.precheck_findings is
  'The R.2 pre-check''s findings, an array of finding objects; null until the pre-check has run, and required past it.';
comment on column ouroboros.dry_runs.failure_reason is
  'Why the run stopped — required for failed and budget_stopped, null otherwise.';

-- Per-draft history: the footer's line and the re-run / compare reads.
create index dry_runs_workflow_history_idx
  on ouroboros.dry_runs (workflow_id, started_at desc);

comment on index ouroboros.dry_runs_workflow_history_idx is
  'A workflow''s dry-run history, newest first (#557): the footer''s per-draft history line and the re-run/compare reads.';

-- The retention sweep: finished dry runs by when they finished.
create index dry_runs_finished_idx
  on ouroboros.dry_runs (organization_id, finished_at)
  where finished_at is not null;

-- The foreign keys' own deletes (a swept session, a removed ticket) find their rows by index.
create index dry_runs_session_idx on ouroboros.dry_runs (session_id) where session_id is not null;
create index dry_runs_ticket_idx on ouroboros.dry_runs (ticket_id);

-- --- references a foreign key cannot state ------------------------------------
--
-- tickets has no (id, organization_id) key, and a session's workflow is not part of its key, so
-- both rules are checked here: the ticket is of this workspace, and the session — when there is
-- one — is a conversation about this workflow.
create function ouroboros.dry_runs_references_check()
returns trigger language plpgsql as $$
begin
  -- Only what changed is checked: a foreign key's own set-null of session_id (a swept session)
  -- must not depend on the ticket still being there mid-cascade.
  if (tg_op = 'INSERT' or new.ticket_id <> old.ticket_id or new.organization_id <> old.organization_id)
     and not exists (select 1 from ouroboros.tickets t
                      where t.id = new.ticket_id and t.organization_id = new.organization_id) then
    raise exception 'ticket % is not in workspace %', new.ticket_id, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'dry_runs_ticket_workspace';
  end if;

  if new.session_id is not null
     and not exists (select 1 from ouroboros.copilot_sessions s
                      where s.id = new.session_id and s.workflow_id = new.workflow_id) then
    raise exception 'copilot session % is not a conversation about workflow %', new.session_id, new.workflow_id
      using errcode = 'foreign_key_violation', constraint = 'dry_runs_session_workflow';
  end if;

  return new;
end;
$$;

comment on function ouroboros.dry_runs_references_check() is
  'Refuses a dry run whose ticket is of another workspace, or whose copilot session is about another workflow (#557).';

create trigger dry_runs_references_check
  before insert or update of ticket_id, session_id, workflow_id, organization_id on ouroboros.dry_runs
  for each row execute function ouroboros.dry_runs_references_check();

-- --- identity and lifecycle on update ----------------------------------------
create function ouroboros.dry_runs_transition()
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
              or (old.status = 'running' and new.status in ('complete', 'failed', 'budget_stopped'))) then
    raise exception 'dry run % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.status <> 'precheck' and new.precheck_findings is distinct from old.precheck_findings then
    raise exception 'dry run % keeps what its pre-check found', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- A finished dry run is a record: only a foreign key's own set-null may touch it.
  if old.status in ('complete', 'failed', 'budget_stopped')
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
  'Refuses a dry-run update that changes what was tested (workflow, draft, ticket, commit, mode, start, or a session other than its set-null), moves status outside precheck → running | failed and running → complete | failed | budget_stopped, rewrites the pre-check''s findings after the pre-check, or changes a finished run (#557).';

create trigger dry_runs_transition
  before update on ouroboros.dry_runs
  for each row execute function ouroboros.dry_runs_transition();

-- ---------------------------------------------------------------------------
-- dry_run_stages — the per-stage results, in order.
-- ---------------------------------------------------------------------------
create table ouroboros.dry_run_stages (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null,
  dry_run_id      uuid        not null,

  -- The row's place on the card, from 1.
  seq             integer     not null
                              constraint dry_run_stages_seq_positive check (seq >= 1),

  -- The DSL stage id, and the name the card shows (`review ×2`).
  stage_key       text        not null
                              constraint dry_run_stages_stage_key_format
                                check (stage_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(stage_key) <= 64),
  display_name    text        not null
                              constraint dry_run_stages_display_name_nonblank
                                check (btrim(display_name) <> ''),

  -- What happened.
  verdict         text        not null
                              constraint dry_run_stages_verdict
                                check (verdict in ('ok', 'skipped', 'failed', 'not_reached')),

  -- How the result was produced: a real model call, a statistical replay of history, a
  -- deterministic evaluation, or nothing (skipped). See the header's table.
  how             text        not null
                              constraint dry_run_stages_how
                                check (how in ('llm', 'replayed', 'deterministic', 'skipped')),

  -- The composed result line. Blank only for a stage the run never reached.
  note            text        not null default '',

  -- See dry_run_stage_metrics_valid().
  metrics         jsonb       not null default '{}'
                              constraint dry_run_stages_metrics_shape
                                check (ouroboros.dry_run_stage_metrics_valid(how, metrics)),

  -- Why a skipped stage had nothing to do.
  skip_reason     text,

  started_at      timestamptz,
  finished_at     timestamptz,

  constraint dry_run_stages_dry_run_fk
    foreign key (dry_run_id, organization_id)
    references ouroboros.dry_runs (id, organization_id) on delete cascade,

  constraint dry_run_stages_dry_run_seq_key unique (dry_run_id, seq),

  constraint dry_run_stages_skipped_paired
    check ((verdict = 'skipped') = (how = 'skipped')),
  constraint dry_run_stages_skip_reason
    check ((verdict = 'skipped') = (skip_reason is not null)
           and (skip_reason is null or btrim(skip_reason) <> '')),
  constraint dry_run_stages_note_when_reached
    check (verdict = 'not_reached' or btrim(note) <> ''),
  constraint dry_run_stages_finished_after_started
    check (finished_at is null or (started_at is not null and finished_at >= started_at))
);

comment on table ouroboros.dry_run_stages is
  'A dry run''s per-stage results in card order (#557, CC.3): verdict, how (the honesty of the card), the composed note, metrics and the skip reason. Retention follows the dry run (custom:dry-run).';
comment on column ouroboros.dry_run_stages.verdict is
  'ok | skipped | failed | not_reached.';
comment on column ouroboros.dry_run_stages.how is
  'llm | replayed | deterministic | skipped. The card''s label is dry_run_stage_how_label(how, metrics).';
comment on column ouroboros.dry_run_stages.note is
  'The composed result line — "est. 4m 02s (214 similar builds, ±20s)". Non-blank unless the stage was not reached.';
comment on column ouroboros.dry_run_stages.metrics is
  '{tokens, cost_cents, files_touched, simulated_writes, lines_added, lines_removed} as measured; on a replay also {estimate_ms, sample_count ≥ 1, spread_ms, similarity_class}. cost_cents is absent when unpriced.';
comment on column ouroboros.dry_run_stages.skip_reason is
  'Why the stage had nothing to do — present exactly when the verdict is skipped.';

-- --- artifacts and stages are written while the run is open -------------------
--
-- A finished dry run is a record, and its rows are part of it. The parent row is read `for
-- share`, so a write here and the update that finishes the run serialise.
create function ouroboros.dry_run_children_open()
returns trigger language plpgsql as $$
declare
  run_status text;
begin
  select status into run_status from ouroboros.dry_runs
   where id = new.dry_run_id
   for share;

  if run_status in ('complete', 'failed', 'budget_stopped')
     or (tg_op = 'UPDATE' and old.dry_run_id <> new.dry_run_id) then
    raise exception 'dry run % is %; its % are final', new.dry_run_id, run_status, tg_table_name
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.dry_run_children_open() is
  'Refuses a stage or artifact write once its dry run has finished, or a move to another dry run (#557): a finished dry run''s rows are its record.';

create trigger dry_run_stages_open
  before insert or update on ouroboros.dry_run_stages
  for each row execute function ouroboros.dry_run_children_open();

-- ---------------------------------------------------------------------------
-- dry_run_artifacts — the overlay diff and excerpts, bounded.
-- ---------------------------------------------------------------------------
create table ouroboros.dry_run_artifacts (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null,
  dry_run_id      uuid        not null,

  kind            text        not null
                              constraint dry_run_artifacts_kind
                                check (kind in ('overlay_diff', 'plan_excerpt', 'review_excerpt')),

  -- At most 64 KiB. What was cut is said by truncated and original_bytes.
  content         text        not null
                              constraint dry_run_artifacts_content_bounded
                                check (octet_length(content) <= 65536),

  -- Whether content is a prefix of something larger, and that something's size in bytes.
  truncated       boolean     not null,
  original_bytes  bigint      not null,

  -- [{path, added, removed}] — the overlay diff's files and ± counts; null on an excerpt.
  path_summary    jsonb,

  created_at      timestamptz not null default now(),

  constraint dry_run_artifacts_dry_run_fk
    foreign key (dry_run_id, organization_id)
    references ouroboros.dry_runs (id, organization_id) on delete cascade,

  constraint dry_run_artifacts_truncation_honest
    check (original_bytes >= octet_length(content)
           and truncated = (original_bytes > octet_length(content))),

  constraint dry_run_artifacts_path_summary
    check (case when kind = 'overlay_diff' then ouroboros.dry_run_path_summary_valid(path_summary)
                else path_summary is null end)
);

comment on table ouroboros.dry_run_artifacts is
  'A dry run''s overlay diff (never written to the repo) and plan/review excerpts (#557, CC.3), bounded at 64 KiB with an explicit truncation flag. Retention: custom:dry-run-artifacts, which expires before the dry run''s own record (dry_runs_sweep()).';
comment on column ouroboros.dry_run_artifacts.kind is
  'overlay_diff | plan_excerpt | review_excerpt. At most one overlay_diff per dry run.';
comment on column ouroboros.dry_run_artifacts.content is
  'The artifact, at most 64 KiB (octet length).';
comment on column ouroboros.dry_run_artifacts.truncated is
  'Whether content was cut from something larger — exactly when original_bytes exceeds its octet length.';
comment on column ouroboros.dry_run_artifacts.original_bytes is
  'The size of the artifact before truncation, in bytes.';
comment on column ouroboros.dry_run_artifacts.path_summary is
  '[{path, added, removed}] for an overlay diff — its header line without parsing it; null on an excerpt.';

create unique index dry_run_artifacts_one_overlay_diff
  on ouroboros.dry_run_artifacts (dry_run_id)
  where kind = 'overlay_diff';

comment on index ouroboros.dry_run_artifacts_one_overlay_diff is
  'A dry run has at most one overlay diff (#557).';

create index dry_run_artifacts_dry_run_idx on ouroboros.dry_run_artifacts (dry_run_id);

create trigger dry_run_artifacts_open
  before insert or update on ouroboros.dry_run_artifacts
  for each row execute function ouroboros.dry_run_children_open();

-- ---------------------------------------------------------------------------
-- The W4 isolation probe.
-- ---------------------------------------------------------------------------
--
-- The run plane is `runs` and every table with a foreign-key path into it (dry-run tables
-- excepted, so a coupling cannot hide itself by joining the plane). The domain is every
-- `dry_run*` table. A row here is a coupling:
--
--   foreign_key — a foreign key between the domain and the run plane, either direction;
--   view        — a view (or materialized view) that reads, directly or through other views,
--                 from both the domain and the run plane — a run read-model that counts
--                 simulations.
create view ouroboros.dry_run_isolation_violations as
with recursive
  dry_domain as (
    select c.oid
      from pg_class c
     where c.relnamespace = 'ouroboros'::regnamespace
       and c.relkind in ('r', 'p')
       and c.relname like 'dry\_run%'
  ),
  plane (oid) as (
    select c.oid
      from pg_class c
     where c.relnamespace = 'ouroboros'::regnamespace and c.relname = 'runs' and c.relkind in ('r', 'p')
    union
    select con.conrelid
      from pg_constraint con
      join plane p on con.confrelid = p.oid
     where con.contype = 'f'
       and con.conrelid not in (select oid from dry_domain)
  ),
  view_reads (view_oid, rel_oid) as (
    select rw.ev_class, d.refobjid
      from pg_rewrite rw
      join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
     where d.refclassid = 'pg_class'::regclass and d.refobjid <> rw.ev_class
    union
    select vr.view_oid, d.refobjid
      from view_reads vr
      join pg_rewrite rw on rw.ev_class = vr.rel_oid
      join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
     where d.refclassid = 'pg_class'::regclass and d.refobjid <> rw.ev_class
  )
select 'foreign_key'::text as kind,
       con.conrelid::regclass::text as relation,
       format('%s references %s', con.conname, con.confrelid::regclass) as detail
  from pg_constraint con
 where con.contype = 'f'
   and ((con.conrelid in (select oid from dry_domain) and con.confrelid in (select oid from plane))
        or (con.conrelid in (select oid from plane) and con.confrelid in (select oid from dry_domain)))
union all
select 'view',
       v.oid::regclass::text,
       format('reads %s and %s',
              (select string_agg(r.rel_oid::regclass::text, ', ' order by r.rel_oid::regclass::text)
                 from (select distinct rel_oid from view_reads
                        where view_oid = v.oid and rel_oid in (select oid from dry_domain)) r),
              (select string_agg(r.rel_oid::regclass::text, ', ' order by r.rel_oid::regclass::text)
                 from (select distinct rel_oid from view_reads
                        where view_oid = v.oid and rel_oid in (select oid from plane)) r))
  from pg_class v
 where v.relkind in ('v', 'm')
   and exists (select 1 from view_reads r where r.view_oid = v.oid and r.rel_oid in (select oid from dry_domain))
   and exists (select 1 from view_reads r where r.view_oid = v.oid and r.rel_oid in (select oid from plane));

comment on view ouroboros.dry_run_isolation_violations is
  'The W4 isolation probe (#557): every foreign key between a dry_run* table and the run plane (runs and every table with a foreign-key path into it), and every view reading from both. Empty — a simulation can never be counted as work.';

-- ---------------------------------------------------------------------------
-- The retention sweep — the two classes' one write.
-- ---------------------------------------------------------------------------

-- dry_runs_sweep(organization_id, record_cutoff, artifact_cutoff, limit) — remove a workspace's
-- finished dry-run artifacts and records past their class's cutoff.
--   p_organization_id — the workspace
--   p_record_cutoff   — RetentionPolicyService's cutoff for custom:dry-run
--   p_artifact_cutoff — its cutoff for custom:dry-run-artifacts; artifacts are cut at the later
--                       of the two, so they never outlive their record
--   p_limit           — the most dry runs whose artifacts, and the most dry runs, to remove in
--                       one call, oldest first
--   returns (dry_runs, stages, artifacts) removed
create function ouroboros.dry_runs_sweep(p_organization_id text, p_record_cutoff timestamptz,
                                         p_artifact_cutoff timestamptz, p_limit integer)
returns table (dry_runs integer, stages integer, artifacts integer)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  stripped uuid[];
  doomed   uuid[];
begin
  -- The custom-class floor, beneath the service: no cutoff may reach inside the last seven days.
  if p_record_cutoff > now() - interval '7 days' or p_artifact_cutoff > now() - interval '7 days' then
    raise exception 'a dry-run cutoff of % / % is inside the 7-day retention floor',
      p_record_cutoff, p_artifact_cutoff
      using errcode = 'check_violation',
            constraint = 'dry_runs_sweep_cutoff_floor',
            hint = 'The cutoffs are RetentionPolicyService''s now() - days for custom:dry-run and custom:dry-run-artifacts, and a custom tier is at least 7 days (#482).';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception 'a dry-run sweep removes at least one dry run per call, not %', p_limit
      using errcode = 'check_violation', constraint = 'dry_runs_sweep_limit';
  end if;

  -- The bulk first: artifacts of finished runs past the later cutoff.
  select coalesce(array_agg(r.id), '{}')
    into stripped
    from (select run.id
            from ouroboros.dry_runs run
           where run.organization_id = p_organization_id
             and run.finished_at < greatest(p_artifact_cutoff, p_record_cutoff)
             and exists (select 1 from ouroboros.dry_run_artifacts a where a.dry_run_id = run.id)
           order by run.finished_at
           limit p_limit
             for update skip locked) r;

  delete from ouroboros.dry_run_artifacts a where a.dry_run_id = any (stripped);
  get diagnostics artifacts = row_count;

  -- Then the records past their own cutoff, stages and any artifacts left with them.
  select coalesce(array_agg(r.id), '{}')
    into doomed
    from (select run.id
            from ouroboros.dry_runs run
           where run.organization_id = p_organization_id
             and run.finished_at < p_record_cutoff
           order by run.finished_at
           limit p_limit
             for update skip locked) r;

  stages := (select count(*) from ouroboros.dry_run_stages s where s.dry_run_id = any (doomed));
  artifacts := artifacts + (select count(*) from ouroboros.dry_run_artifacts a where a.dry_run_id = any (doomed));
  delete from ouroboros.dry_runs where id = any (doomed);
  dry_runs := cardinality(doomed);
  return next;
end;
$$;

comment on function ouroboros.dry_runs_sweep(text, timestamptz, timestamptz, integer) is
  'The dry-run retention sweep''s one write (#557): removes the artifacts of at most p_limit finished dry runs that finished before the later of p_artifact_cutoff and p_record_cutoff, then at most p_limit finished dry runs (stages and artifacts with them) that finished before p_record_cutoff — oldest first. Never a dry run still in precheck or running. Refuses a cutoff inside the 7-day floor. Runs as the owner because the application role cannot delete.';

revoke execute on function ouroboros.dry_runs_sweep(text, timestamptz, timestamptz, integer) from public;
grant execute on function ouroboros.dry_runs_sweep(text, timestamptz, timestamptz, integer) to ouroboros_app;

-- ---------------------------------------------------------------------------
-- The application role.
--
-- Dry runs are started, advanced and finished; stages and artifacts written while they run. None
-- is deleted by the application: the history is the record, and the sweep is its one delete.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.dry_runs to ouroboros_app;
grant select, insert, update on ouroboros.dry_run_stages to ouroboros_app;
grant select, insert, update on ouroboros.dry_run_artifacts to ouroboros_app;
grant select on ouroboros.dry_run_isolation_violations to ouroboros_app;
