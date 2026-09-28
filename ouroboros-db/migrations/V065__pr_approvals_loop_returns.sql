-- V065__pr_approvals_loop_returns.sql — what mockup 12's two composed head actions record:
-- the human-approval slot *Request human review* opens, and the expectation *Return to loop*
-- leaves behind.
--
-- Filed as issue #361 (AX.5, the PR read APIs & head actions) of the PR verification roadmap
-- (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md, decision V5). Needs V052's PRs and revisions
-- (#352), V056's gates (#353) and V048/V050/V061's control queue (#306, #332).
--
--
-- Approval records — `pr_approvals`.
-- ---------------------------------------------------------------------------
--
-- V056 reserved the evidence kind `approval` "until AX.5 adds its table". This is that table.
-- A row is one **approval slot**: opened when a person asks for a human review, answered once
-- when a reviewer approves or declines it with a note.
--
--     state       means                                          human_approval verdict
--     requested   a person asked for a review; nobody answered   pending  (the needs-you item)
--     approved    a reviewer approved it                         green    (on the revision approved)
--     declined    a reviewer declined it, saying why             red      (on the revision declined)
--
-- Asking is what flips the gate: a PR whose policy says `not required` becomes a PR a person
-- must approve, because somebody decided it should be. The slot stays the question until it is
-- answered — **at most one open slot per PR** (`pr_approvals_one_open`), so a second request
-- answers the first rather than opening a queue nobody asked for. An answered slot is history;
-- the next request opens a new row.
--
-- **The open slot is the needs-you item.** Mockup 16's inbox (#461) will wrap it as its
-- `merge_approval` decision kind; until then a `requested` row is the durable record that a
-- person is wanted, and `GET /api/v1/pull-requests?reviewRequested=true` is its feed.
--
-- `requested_revision_id` is the revision a review was asked about; `decided_revision_id` is the
-- one the reviewer looked at. The gate honours a decision only on the revision it was made on,
-- so a push after an approval leaves the PR needing a fresh one — an approval of code nobody
-- has seen would be a green that lies.
--
-- `host_reviewer` / `host_request` / `host_detail` record the optional SPI `requestReview`
-- (#357): the login asked on the git host and how that landed — `requested`, `unsupported`
-- (the host declares no reviews) or `failed` (the host refused; the detail says why). They are
-- written together or not at all, and a host refusal never undoes the slot.
--
--
-- Loop returns — `pr_loop_returns`.
-- ---------------------------------------------------------------------------
--
-- *Return to loop* is not a new control path: it is AP.4's correction round — a steer whose
-- text is the selected red gates' evidence lines, plus a stage retry (V061's `retry_stage`).
-- The control is the queue's row; this records what the PR plane asked and what it expects
-- back: which revision's gates were returned, which gate keys, and **the attempt the next
-- revision should come from** (`expected_stage_key` × `expected_attempt`) — the strip's
-- "attempt N+1 expected". One row per control (`pr_loop_returns_control_key`), so an
-- idempotent replay of the same control records nothing twice. Rows are appended and never
-- edited; the control's run must be the PR's run.
--
--
-- The evidence link — `pr_gate_evidence_ref_resolves`, extended.
-- ---------------------------------------------------------------------------
--
-- `approval` now resolves to a `pr_approvals` row whose PR belongs to the workspace, so the
-- human-approval gate can cite the slot its verdict came from. `vote` stays reserved for AZ.1
-- (#371). Both functions are V056's otherwise verbatim.

-- ---------------------------------------------------------------------------
-- pr_approvals
-- ---------------------------------------------------------------------------
create table ouroboros.pr_approvals (
  id                     uuid        primary key default gen_random_uuid(),

  pr_id                  uuid        not null
                                     references ouroboros.pull_requests (id) on delete cascade,

  state                  text        not null default 'requested',

  -- --- the request ----------------------------------------------------------------------
  requested_revision_id  uuid        references ouroboros.pr_revisions (id) on delete set null,
  requested_by           text        references ouroboros."user" ("id") on delete set null,
  requested_at           timestamptz not null default now(),

  -- --- the optional host review request (SPI requestReview) ------------------------------
  host_reviewer          text,
  host_request           text,
  host_detail            text,

  -- --- the answer -----------------------------------------------------------------------
  decided_revision_id    uuid        references ouroboros.pr_revisions (id) on delete set null,
  decided_by             text        references ouroboros."user" ("id") on delete set null,
  decided_at             timestamptz,
  note                   text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint pr_approvals_state
    check (state in ('requested', 'approved', 'declined')),

  constraint pr_approvals_decided_when_answered
    check ((state = 'requested') = (decided_at is null)),

  constraint pr_approvals_decision_fields_when_answered
    check (state <> 'requested'
           or (decided_by is null and decided_revision_id is null and note is null)),

  constraint pr_approvals_note_bounded
    check (note is null or (length(btrim(note)) > 0 and length(note) <= 2000)),

  constraint pr_approvals_declined_has_note
    check (state <> 'declined' or note is not null),

  constraint pr_approvals_host_request
    check (host_request in ('requested', 'unsupported', 'failed')),

  constraint pr_approvals_host_complete
    check ((host_request is null) = (host_reviewer is null)
           and (host_detail is null or host_request is not null)),

  constraint pr_approvals_host_reviewer_shape
    check (host_reviewer is null
           or (length(btrim(host_reviewer)) > 0 and length(host_reviewer) <= 255)),

  constraint pr_approvals_host_detail_bounded
    check (host_detail is null or (length(btrim(host_detail)) > 0 and length(host_detail) <= 512))
);

comment on table ouroboros.pr_approvals is
  'One human-approval slot of a PR (#361, AX.5, decision V5): opened by Request human review, answered once by an approve or a decline with a note. At most one open slot per PR; an answered slot is history. The open slot is the PR''s needs-you item until mockup 16''s inbox (#461) wraps it. The human_approval gate reads the newest slot.';
comment on column ouroboros.pr_approvals.state is
  'requested | approved | declined. requested moves once to approved or declined; an answered slot is frozen (pr_approvals_lifecycle).';
comment on column ouroboros.pr_approvals.requested_revision_id is
  'The revision a review was asked about — the PR''s latest when the slot opened. Set null if the revision goes.';
comment on column ouroboros.pr_approvals.requested_by is
  'Who asked for the review. Set null if the person is removed.';
comment on column ouroboros.pr_approvals.host_reviewer is
  'The git-host login the SPI requestReview asked, or null when nobody was asked on the host. Set with host_request.';
comment on column ouroboros.pr_approvals.host_request is
  'How the host request landed: requested, unsupported (the host declares no reviews) or failed (the host refused — host_detail says why). Null exactly when host_reviewer is.';
comment on column ouroboros.pr_approvals.host_detail is
  'The host''s refusal, in at most 512 characters — only beside a host_request.';
comment on column ouroboros.pr_approvals.decided_revision_id is
  'The revision the reviewer approved or declined — the PR''s latest when they answered. The gate honours the answer only while this is the latest revision.';
comment on column ouroboros.pr_approvals.decided_by is
  'Who answered. Set null if the person is removed.';
comment on column ouroboros.pr_approvals.note is
  'The reviewer''s note, at most 2000 characters. Required on a decline: a red gate says why.';

create unique index pr_approvals_one_open
  on ouroboros.pr_approvals (pr_id) where state = 'requested';

create index pr_approvals_pr_idx
  on ouroboros.pr_approvals (pr_id, requested_at desc);

create trigger pr_approvals_touch_updated_at
  before update on ouroboros.pr_approvals
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A slot's revisions are its own PR's.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_approvals_revision_of_pr()
returns trigger
language plpgsql
as $$
declare
  requested_pr uuid;
  decided_pr   uuid;
begin
  select v.pr_id into requested_pr from ouroboros.pr_revisions v where v.id = new.requested_revision_id;
  select v.pr_id into decided_pr from ouroboros.pr_revisions v where v.id = new.decided_revision_id;

  -- A missing revision is its foreign key's to report.
  if (requested_pr is not null and requested_pr <> new.pr_id)
     or (decided_pr is not null and decided_pr <> new.pr_id) then
    raise exception 'approval slot % names a revision that is not one of pr %', new.id, new.pr_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_approvals_revision_of_pr() is
  'Refuses an approval slot whose requested or decided revision belongs to another PR (#361).';

create trigger pr_approvals_revision_of_pr
  before insert or update of pr_id, requested_revision_id, decided_revision_id
  on ouroboros.pr_approvals
  for each row execute function ouroboros.pr_approvals_revision_of_pr();

-- ---------------------------------------------------------------------------
-- The lifecycle: requested → approved | declined, once.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_approvals_lifecycle()
returns trigger
language plpgsql
as $$
declare
  -- What may still move on an answered slot: the foreign keys' own set null, the touch, and the
  -- host request's answer, which can land after a quick reviewer.
  released text[] := array['requested_revision_id', 'requested_by', 'decided_revision_id',
                           'decided_by', 'updated_at', 'host_reviewer', 'host_request',
                           'host_detail'];
begin
  if tg_op = 'INSERT' then
    if new.state <> 'requested' then
      raise exception 'an approval slot opens as requested — it is answered afterwards'
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  -- The request's facts are fixed; its person and revision may only be released to null.
  if (new.pr_id, new.requested_at, new.created_at)
     is distinct from (old.pr_id, old.requested_at, old.created_at)
     or (new.requested_revision_id is distinct from old.requested_revision_id
         and new.requested_revision_id is not null)
     or (new.requested_by is distinct from old.requested_by and new.requested_by is not null) then
    raise exception 'approval slot %: who asked, about which revision and when is fixed', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.state = 'requested' then
    return new;
  end if;

  -- Answered: nothing moves but what `released` names.
  if (to_jsonb(new) - released) is distinct from (to_jsonb(old) - released)
     or (new.decided_revision_id is distinct from old.decided_revision_id
         and new.decided_revision_id is not null)
     or (new.decided_by is distinct from old.decided_by and new.decided_by is not null) then
    raise exception 'approval slot % was % and is final — request a new review instead',
      old.id, old.state
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_approvals_lifecycle() is
  'Holds pr_approvals to its lifecycle (#361): a slot opens requested; the request''s PR, time and creation are fixed and its person and revision may only be released to null; requested is answered once (approved or declined, with the pr_approvals_decided_when_answered shape) and an answered slot is frozen but for set-null foreign keys and the host request''s late answer. Binds every role.';

create trigger pr_approvals_lifecycle
  before insert or update on ouroboros.pr_approvals
  for each row execute function ouroboros.pr_approvals_lifecycle();

-- ---------------------------------------------------------------------------
-- pr_loop_returns
-- ---------------------------------------------------------------------------
create function ouroboros.pr_loop_return_gate_keys_valid(p_keys text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select p_keys is not null
     and cardinality(p_keys) between 1 and 64
     and array_position(p_keys, null) is null
     and cardinality(p_keys) = (select count(distinct k) from unnest(p_keys) k)
     and not exists (
       select 1 from unnest(p_keys) k
        where not (k in ('build', 'test_suite', 'physical_hil', 'diff_vs_plan',
                         'secrets_license', 'model_review', 'human_approval')
                   or k ~ '^custom:[a-z0-9][a-z0-9_.-]{0,62}$'))
$$;

comment on function ouroboros.pr_loop_return_gate_keys_valid(text[]) is
  'True when a loop return''s gate keys are 1–64 distinct, non-null gate keys under V056''s pr_gate_definitions_gate_key rule (#361).';

create table ouroboros.pr_loop_returns (
  id                  uuid        primary key default gen_random_uuid(),

  pr_id               uuid        not null
                                  references ouroboros.pull_requests (id) on delete cascade,
  -- The revision whose red gates were sent back. Set null if the revision goes.
  revision_id         uuid        references ouroboros.pr_revisions (id) on delete set null,
  -- The correction round AP.4 queued — the steer carrying the evidence, with retry_stage.
  control_id          uuid        not null
                                  references ouroboros.run_controls (id) on delete cascade,

  gate_keys           text[]      not null,

  -- The attempt the next revision is expected from: the stage retried and its next attempt.
  expected_stage_key  text,
  expected_attempt    integer,

  requested_by        text        references ouroboros."user" ("id") on delete set null,
  created_at          timestamptz not null default now(),

  constraint pr_loop_returns_control_key unique (control_id),

  constraint pr_loop_returns_gate_keys
    check (ouroboros.pr_loop_return_gate_keys_valid(gate_keys)),

  constraint pr_loop_returns_expectation_complete
    check ((expected_stage_key is null) = (expected_attempt is null)),

  constraint pr_loop_returns_expected_attempt_positive
    check (expected_attempt is null or expected_attempt >= 1),

  constraint pr_loop_returns_expected_stage_key_present
    check (expected_stage_key is null or length(btrim(expected_stage_key)) > 0)
);

comment on table ouroboros.pr_loop_returns is
  'One Return to loop of a PR (#361, AX.5, decision V5): the AP.4 correction round it queued (control_id), the revision and gate keys whose evidence the steer carried, and the stage attempt the next revision is expected from. Appended, never edited; one row per control. The control''s run is the PR''s run (pr_loop_returns_control_of_pr_run).';
comment on column ouroboros.pr_loop_returns.gate_keys is
  'The gates whose evidence lines were the steer''s text — the red gates the person selected.';
comment on column ouroboros.pr_loop_returns.expected_attempt is
  'The attempt of expected_stage_key the next revision should come from — the active stage''s attempt plus one when the control was queued. Null, with expected_stage_key, when the run had no active stage.';

create index pr_loop_returns_pr_idx
  on ouroboros.pr_loop_returns (pr_id, created_at desc);

create function ouroboros.pr_loop_returns_control_of_pr_run()
returns trigger
language plpgsql
as $$
declare
  pr_run       uuid;
  control_run  uuid;
  revision_pr  uuid;
begin
  select p.run_id into pr_run from ouroboros.pull_requests p where p.id = new.pr_id;
  select c.run_id into control_run from ouroboros.run_controls c where c.id = new.control_id;
  select v.pr_id into revision_pr from ouroboros.pr_revisions v where v.id = new.revision_id;

  -- A missing PR or control is its foreign key's to report.
  if control_run is not null and (pr_run is null or pr_run <> control_run) then
    raise exception 'loop return pairs pr % with control %, which is not a control of the PR''s run',
      new.pr_id, new.control_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if revision_pr is not null and revision_pr <> new.pr_id then
    raise exception 'loop return names revision %, which is not a revision of pr %',
      new.revision_id, new.pr_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_loop_returns_control_of_pr_run() is
  'Refuses a loop return whose control belongs to a run other than the PR''s, or whose revision is another PR''s (#361).';

create trigger pr_loop_returns_control_of_pr_run
  before insert or update on ouroboros.pr_loop_returns
  for each row execute function ouroboros.pr_loop_returns_control_of_pr_run();

-- ---------------------------------------------------------------------------
-- The evidence link: approval resolves now. V056's functions, extended by one kind.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.pr_gate_evidence_ref_resolves(p_organization_id text, p_ref jsonb)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
  -- A case, not an or: only a shaped link may reach the uuid casts.
  select case
           when p_ref is null then true
           when not ouroboros.pr_gate_evidence_ref_shaped(p_ref) then false
           when p_ref ->> 'kind' = 'build_job' then exists (
             select 1 from ouroboros.build_jobs j
              where j.id = (p_ref ->> 'id')::uuid and j.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'test_run' then exists (
             select 1 from ouroboros.test_runs t
              where t.id = (p_ref ->> 'id')::uuid and t.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'hil_measurement' then exists (
             select 1 from ouroboros.hil_measurements m
              where m.id = (p_ref ->> 'id')::uuid and m.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'guardrail_evaluation' then exists (
             select 1 from ouroboros.guardrail_evaluations g
               join ouroboros.runs r on r.id = g.run_id
              where g.id = (p_ref ->> 'id')::uuid and r.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'approval' then exists (
             select 1 from ouroboros.pr_approvals a
               join ouroboros.pull_requests p on p.id = a.pr_id
              where a.id = (p_ref ->> 'id')::uuid and p.organization_id = p_organization_id)
           -- vote is reserved: no table to resolve against until AZ.1 (#371).
           else false
         end
$$;

comment on function ouroboros.pr_gate_evidence_ref_resolves(text, jsonb) is
  'True when an evidence_ref is null or names a real row of the given workspace (#353, extended by #361): build_job → build_jobs, test_run → test_runs, hil_measurement → hil_measurements, guardrail_evaluation → guardrail_evaluations of a workspace run, approval → pr_approvals of a workspace PR. False for vote, which is reserved until AZ.1 (#371) adds its table.';

create or replace function ouroboros.pr_gate_results_evidence_ref_resolves()
returns trigger
language plpgsql
as $$
declare
  owner text;
begin
  -- Null, and a malformed link, are not this trigger's: the latter is
  -- pr_gate_results_evidence_ref_shape's to refuse by its own name.
  if new.evidence_ref is null or not ouroboros.pr_gate_evidence_ref_shaped(new.evidence_ref) then
    return new;
  end if;

  select p.organization_id into owner
    from ouroboros.pr_gate_definitions d
    join ouroboros.pull_requests p on p.id = d.pr_id
   where d.id = new.definition_id;

  -- A missing definition is its foreign key's to report.
  if owner is null then
    return new;
  end if;

  if new.evidence_ref ->> 'kind' = 'vote' then
    raise exception
      'evidence kind % is reserved — its table has not landed yet, so the link cannot be resolved',
      new.evidence_ref ->> 'kind'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if not ouroboros.pr_gate_evidence_ref_resolves(owner, new.evidence_ref) then
    raise exception
      'evidence % % is not a row of organization %',
      new.evidence_ref ->> 'kind', new.evidence_ref ->> 'id', owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_gate_results_evidence_ref_resolves() is
  'Refuses a gate result whose evidence_ref does not name a real row of the PR''s workspace, and refuses the reserved kind vote until its table exists (#353; approval resolves since #361).';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason.
--
--   * **Approval slots are opened and answered** — inserted and updated, never deleted: a slot
--     that vanished would take with it who approved the code that merged. What bounds `update`
--     is pr_approvals_lifecycle, which binds every role.
--   * **Loop returns are appended** — a record of what was sent back, never edited or removed.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.pr_approvals to ouroboros_app;
grant select, insert on ouroboros.pr_loop_returns to ouroboros_app;

revoke delete on ouroboros.pr_approvals from ouroboros_app;
revoke delete on ouroboros.pr_approvals from public;
revoke update, delete on ouroboros.pr_loop_returns from ouroboros_app;
revoke update, delete on ouroboros.pr_loop_returns from public;

grant execute on function ouroboros.pr_loop_return_gate_keys_valid(text[]) to ouroboros_app;
