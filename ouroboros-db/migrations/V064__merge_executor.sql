-- V064__merge_executor.sql — what the merge executor writes that V058 had nowhere to put: the
-- epic back-annotation note, and the person a merge was made for.
--
-- Filed as issue #360 (AX.4, the merge executor & host publishing) of the PR verification roadmap
-- (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md, decisions V3 and V9). Needs V036's epics (#274),
-- V052's PRs (#352) and V058's merge plans (#355).
--
--
-- The epic back-annotation — `planning_epic_notes`.
-- ---------------------------------------------------------------------------
--
-- Mockup 12's third toggle, **Back-annotate roadmap (OTA hardening)**, is an internal act: the
-- roadmap's "planning AK.3 epics" row says *"the toggle posts merge-progress annotations to the
-- linked planning epic (internal, real in MVP)"*. V036 gave an epic its tickets and its mirrors
-- and nothing to annotate, so the note lands here:
--
--     OTA hardening  ·  merged PR #514 — fix(can): preserve ISR frame order (Closes #482.)
--
-- One note per epic, PR and `kind`: the executor writes it with `on conflict do nothing`, so a
-- retried merge never annotates twice (`planning_epic_notes_pr_kind_key`). A note is a record of
-- something that happened, so it is never edited — the app role may insert and read, nothing else.
-- It leaves with its epic; a deleted PR releases `pr_id` and the note stays as history.
--
-- `kind` is a closed vocabulary of one — `pr_merged` — so the next annotation (a revert, a
-- reopened PR) is a migration that says what it means rather than a free-text column that does not.
--
--
-- The merge's actor — `pr_merge_plans_audit`, replaced.
-- ---------------------------------------------------------------------------
--
-- V058 wrote `pr_merge_plan.merged` with no actor — *"nobody — the executor"*. AX.4's acceptance
-- criterion is that arm, disarm **and merge** are each audited with actor identity, and a merge
-- is always made for somebody: the person who armed it, when the last gate turning green fired
-- it, or the person who called merge directly. The executor sets `updated_by` to that person in
-- the statement that records `merged_result`, as every writer acting for a person already does,
-- so the merged row's actor becomes `new.updated_by`. Everything else in the function is V058's,
-- unchanged: the re-check's disarm still has no person behind it.

-- ---------------------------------------------------------------------------
-- planning_epic_notes
-- ---------------------------------------------------------------------------
create table ouroboros.planning_epic_notes (
  id          uuid        primary key default gen_random_uuid(),

  epic_id     uuid        not null
                          references ouroboros.planning_epics (id) on delete cascade,
  -- The PR the note is about. Released, not cascaded: the note is the roadmap's history.
  pr_id       uuid        references ouroboros.pull_requests (id) on delete set null,

  kind        text        not null default 'pr_merged',
  -- The line the roadmap shows. Composed by the executor from the PR's number, title and closing
  -- trailer; never a person's free text.
  body        text        not null,

  created_at  timestamptz not null default now(),

  constraint planning_epic_notes_kind
    check (kind in ('pr_merged')),

  constraint planning_epic_notes_body_present
    check (length(btrim(body)) > 0 and length(body) <= 2048),

  constraint planning_epic_notes_pr_kind_key unique (epic_id, pr_id, kind)
);

comment on table ouroboros.planning_epic_notes is
  'Annotations on a planning epic (#360, AX.4) — mockup 12''s "Back-annotate roadmap" toggle: the merge executor writes one pr_merged note per epic and PR when a merge plan with back_annotate_epic merges. Idempotent by (epic_id, pr_id, kind); never edited. See V064''s header.';
comment on column ouroboros.planning_epic_notes.epic_id is
  'The planning epic (V036) annotated. The note leaves with it.';
comment on column ouroboros.planning_epic_notes.pr_id is
  'The PR the note is about, of the epic''s workspace (planning_epic_notes_pr_in_organization). Released if the PR is deleted — the note stays as the roadmap''s history.';
comment on column ouroboros.planning_epic_notes.kind is
  'What happened: pr_merged. A closed vocabulary — the next kind is a migration.';
comment on column ouroboros.planning_epic_notes.body is
  'The line the roadmap shows — composed by the executor, at most 2048 characters, never blank.';

create index planning_epic_notes_epic_idx
  on ouroboros.planning_epic_notes (epic_id, created_at desc);

create index planning_epic_notes_pr_idx
  on ouroboros.planning_epic_notes (pr_id) where pr_id is not null;

-- ---------------------------------------------------------------------------
-- A note's PR is of the epic's workspace.
-- ---------------------------------------------------------------------------
create function ouroboros.planning_epic_notes_pr_in_organization()
returns trigger
language plpgsql
as $$
declare
  epic_org  text;
  pr_org    text;
begin
  if new.pr_id is null then
    return new;
  end if;

  select e.organization_id into epic_org from ouroboros.planning_epics e where e.id = new.epic_id;
  select p.organization_id into pr_org from ouroboros.pull_requests p where p.id = new.pr_id;

  -- Either missing is its foreign key's to report.
  if epic_org is not null and pr_org is not null and epic_org <> pr_org then
    raise exception 'epic note names pr %, of organization % rather than the epic''s %',
      new.pr_id, pr_org, epic_org
      using errcode = 'check_violation', constraint = 'planning_epic_notes_pr_in_organization';
  end if;

  return new;
end;
$$;

comment on function ouroboros.planning_epic_notes_pr_in_organization() is
  'Refuses an epic note about a PR of another workspace than the epic''s (#360).';

create trigger planning_epic_notes_pr_in_organization
  before insert on ouroboros.planning_epic_notes
  for each row execute function ouroboros.planning_epic_notes_pr_in_organization();

-- ---------------------------------------------------------------------------
-- The merge row names the person the merge was made for — see the header.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.pr_merge_plans_audit()
returns trigger
language plpgsql
as $$
declare
  workspace  text;
  edited     text[];
begin
  if tg_op <> 'UPDATE' then
    return null;
  end if;

  select p.organization_id into workspace from ouroboros.pull_requests p where p.id = new.pr_id;

  select array_agg(c order by c) into edited
    from unnest(array['strategy', 'delete_branch', 'commit_message', 'close_ticket',
                      'comment_evidence', 'back_annotate_epic', 'epic_id']) c
   where to_jsonb(new) -> c is distinct from to_jsonb(old) -> c;

  if edited is not null then
    insert into ouroboros.audit_events (organization_id, actor_id, action, subject_type, subject_id, detail)
      values (workspace, new.updated_by, 'pr_merge_plan.edited', 'pr_merge_plan', new.id::text,
              jsonb_build_object('pr_id', new.pr_id::text, 'fields', to_jsonb(edited)));
  end if;

  if new.armed and not old.armed then
    insert into ouroboros.audit_events (organization_id, actor_id, action, subject_type, subject_id, detail)
      values (workspace, new.armed_by, 'pr_merge_plan.armed', 'pr_merge_plan', new.id::text,
              jsonb_build_object('pr_id', new.pr_id::text,
                                 'revision_id', new.armed_against_revision_id::text));
  end if;

  if old.armed and not new.armed and new.merged_result is null then
    insert into ouroboros.audit_events (organization_id, actor_id, action, subject_type, subject_id, detail)
      values (workspace,
              -- A re-check that disarmed is not a person.
              case when new.disarm_reason is null then new.updated_by end,
              'pr_merge_plan.disarmed', 'pr_merge_plan', new.id::text,
              jsonb_build_object('pr_id', new.pr_id::text,
                                 'revision_id', old.armed_against_revision_id::text,
                                 'recheck_failed', new.disarm_reason is not null));
  end if;

  if new.merged_result is not null and old.merged_result is null then
    insert into ouroboros.audit_events (organization_id, actor_id, action, subject_type, subject_id, detail)
      values (workspace,
              -- V064: the person the merge was made for — who armed it, or who called merge.
              new.updated_by,
              'pr_merge_plan.merged', 'pr_merge_plan', new.id::text,
              jsonb_build_object('pr_id', new.pr_id::text,
                                 'sha', new.merged_result -> 'sha',
                                 'identity_used', new.merged_result -> 'identity_used',
                                 'actions_executed', new.merged_result -> 'actions_executed',
                                 'was_armed', old.armed,
                                 'armed_revision_id', old.armed_against_revision_id::text));
  end if;

  return null;
end;
$$;

comment on function ouroboros.pr_merge_plans_audit() is
  'Writes AD.4''s audit event (V022 shape) for every merge-plan arm, disarm, edit and merge (#355, #360): pr_merge_plan.armed (actor armed_by), .disarmed (actor updated_by, or nobody when a re-check disarmed), .edited (actor updated_by, detail.fields the changed plan columns), .merged (actor updated_by — the person the merge was made for, V064; sha, identity_used, actions_executed). detail is a closed field set, so the commit message and disarm reason are never copied into the trail.';

-- ---------------------------------------------------------------------------
-- Grants — V022's block. A note is written once and read; never edited or deleted directly.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.planning_epic_notes to ouroboros_app;

revoke update, delete on ouroboros.planning_epic_notes from ouroboros_app;
revoke update, delete on ouroboros.planning_epic_notes from public;
