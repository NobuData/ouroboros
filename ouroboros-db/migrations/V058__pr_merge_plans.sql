-- V058__pr_merge_plans.sql — `pr_merge_plans`: how a PR will be merged, the armed "merge when all
-- gates green" intent, and a record of what the merge actually did and as whom.
--
-- Mockup 12 (docs/mockups/12-pr-verification.html), the Merge plan card and the head's button:
--
--     MERGE PLAN                                                         Edit policy →
--     Strategy                 squash · delete branch
--     Commit message preview   fix(can): preserve ISR frame order in telemetry path
--                              Replace k_fifo drain with static K_MSGQ + seq numbers;
--                              decouple PID velocity sampling from drain. Closes #482.
--     [on]  Close issue #482 on merge
--     [on]  Comment evidence summary on GitHub PR
--     [off] Back-annotate roadmap (OTA hardening)
--     Merges as ouroboros-app[bot] · co-authored-by Ken
--
--     [ Merge when all gates green ]
--
-- Filed as issue #355 (AW.4). Needs V052 (#352); the epic is V036's (#274); the audit rows are
-- V022's shape (#225). Feeds the merge executor (#360) and the merge plan card (#369).
--
--
-- Decision V3 — arming is a promise about the future, so it records what it promised.
-- ---------------------------------------------------------------------------
--
-- Arming means that later, with nobody watching, this system will change a repository
-- irreversibly. So `armed` is never a bare boolean: it carries `armed_by`, `armed_at` and
-- **`armed_against_revision_id`** — the revision whose gates the person looked at
-- (`pr_merge_plans_armed_complete`, and `pr_merge_plans_arm` for the person and the revision's
-- PR). If the head moves after arming, the executor's TOCTOU re-check (#360) compares against
-- that revision and disarms rather than merging code nobody reviewed.
--
--     planned ──arm──▶ armed ──re-check passes──▶ merged (merged_result)
--        ▲               │
--        └──disarm───────┘   manual, or a failed re-check with disarm_reason
--
-- Disarming clears the arm's three columns. `disarm_reason` says why a re-check disarmed — *gate
-- red*, *head moved*, *host conflict* — so the card can say so; it lives only on a disarmed plan
-- and arming again clears it. The history of every arm and disarm is the audit trail, below.
--
--
-- The plan.
-- ---------------------------------------------------------------------------
--
-- `strategy` (`squash | merge | rebase`) and `delete_branch` are materialized from the pinned
-- terminal config and editable per org policy. `commit_message` is editable; when a plan is
-- written without one it is filled from `pr_merge_commit_message_template(pr_id)` — the PR's title
-- and a `Closes <key>.` trailer from the PR's **canonical ticket** (V030), so it reads
-- `Closes #482.` for a GitHub issue and `Closes PROJ-142.` for a Jira one: `external_key` is each
-- tracker's own display form. The three toggles are `close_ticket`, `comment_evidence` and
-- `back_annotate_epic`; the last points at a planning epic of the PR's workspace (`epic_id`), is
-- off by default because most PRs are not roadmap-shaped, and falls off if its epic is deleted.
--
--
-- The result, and identity honesty.
-- ---------------------------------------------------------------------------
--
-- After a merge, `merged_result` is exactly
--
--     {"sha": "<7–40 hex>", "identity_used": "<who the host recorded>",
--      "actions_executed": ["close_ticket", "comment_evidence", …], "merged_at": "<ISO 8601>"}
--
-- `actions_executed` answers "which of the configured actions actually ran": each is one of
-- `close_ticket`, `comment_evidence`, `back_annotate_epic`, `delete_branch`, at most once, and
-- only one this plan had switched on (`pr_merge_plans_merged_result_shape`).
--
-- **`identity_used` may not claim a `[bot]` identity** (`pr_merge_plans_identity_not_bot`). The
-- mockup's footer promises `ouroboros-app[bot]`, but until the GitHub App lands (AZ.4, #374)
-- every merge is made with the workspace's configured token (V027), which belongs to a real
-- person — and a merge attributed to a bot that was really somebody's PAT is a lie about
-- accountability in a git history that lives forever. No App-based deployment exists in this
-- schema yet, so the check is unconditional; AZ.4 replaces it with one keyed on the App
-- installation in the same change that makes an App merge possible.
--
-- A merged plan is final (`pr_merge_plans_merged_final`): nothing but the foreign keys' own
-- set-nulls may change it.
--
--
-- Audit — AD.4's shape (V022), written by the schema.
-- ---------------------------------------------------------------------------
--
-- `pr_merge_plans_audit` writes one `audit_events` row per event, on V048's argument: the
-- acceptance criterion is a row for *every* arm, disarm, edit and merge, and a rule the schema
-- keeps cannot be forgotten by the next writer — the executor, a support script.
--
--   | action                   | when                                   | actor                  |
--   |--------------------------|----------------------------------------|------------------------|
--   | `pr_merge_plan.armed`    | `armed` false → true                   | `armed_by`             |
--   | `pr_merge_plan.disarmed` | `armed` true → false, not by a merge   | `updated_by`, or nobody when a re-check disarmed (`disarm_reason` set) |
--   | `pr_merge_plan.edited`   | strategy, delete_branch, message, a toggle or the epic changed | `updated_by` |
--   | `pr_merge_plan.merged`   | `merged_result` null → set             | nobody — the executor  |
--
-- `subject_type` is `pr_merge_plan` and `subject_id` the plan. `detail` is a closed field set —
-- ids, closed vocabularies, booleans, the changed column names, the merge's sha and identity —
-- so the commit message and the disarm reason have nowhere to go. A writer acting for a person
-- sets `updated_by` to that person in the same statement.
--
--
-- Tenancy.
-- ---------------------------------------------------------------------------
--
-- No `organization_id`, for V052's reason: the plan enters through its PR, and `pr_id` cascades.
-- The epic and the armed revision are held to the PR by trigger.

-- ---------------------------------------------------------------------------
-- The commit-message template — `Closes <key>.` from the canonical ticket, whatever the tracker.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_closes_trailer(p_pr_id uuid)
returns text
language sql
stable
as $$
  select 'Closes ' || t.external_key || '.'
    from ouroboros.pull_requests p
    join ouroboros.tickets t on t.id = p.ticket_id
   where p.id = p_pr_id
$$;

comment on function ouroboros.pr_merge_closes_trailer(uuid) is
  'The commit message''s closing trailer for a PR (#355, decision V3): "Closes " || the canonical ticket''s external_key || "." — Closes #482. for a GitHub issue, Closes PROJ-142. for a Jira one. Null when the PR has no ticket.';

create function ouroboros.pr_merge_commit_message_template(p_pr_id uuid)
returns text
language sql
stable
as $$
  select p.title || coalesce(E'\n\n' || ouroboros.pr_merge_closes_trailer(p.id), '')
    from ouroboros.pull_requests p
   where p.id = p_pr_id
$$;

comment on function ouroboros.pr_merge_commit_message_template(uuid) is
  'The deterministic default commit message for a PR (#355): its title, then a blank line and pr_merge_closes_trailer when it has a canonical ticket. What a merge plan written without a message is filled from. Null for an unknown PR.';

-- ---------------------------------------------------------------------------
-- The result record's shape, as a function a CHECK can call.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_result_valid(
  p_result            jsonb,
  p_close_ticket      boolean,
  p_comment_evidence  boolean,
  p_back_annotate     boolean,
  p_delete_branch     boolean
)
returns boolean
language sql
immutable
parallel safe
as $$
  -- A case, not an and: jsonb_object_keys and jsonb_array_elements_text raise on the wrong type.
  select case
    when p_result is null then true
    when jsonb_typeof(p_result) <> 'object' then false
    when (select array_agg(k order by k) from jsonb_object_keys(p_result) k)
         is distinct from array['actions_executed', 'identity_used', 'merged_at', 'sha'] then false
    when jsonb_typeof(p_result -> 'sha') <> 'string'
         or jsonb_typeof(p_result -> 'identity_used') <> 'string'
         or jsonb_typeof(p_result -> 'merged_at') <> 'string'
         or jsonb_typeof(p_result -> 'actions_executed') <> 'array' then false
    else p_result ->> 'sha' ~ '^[0-9a-f]{7,40}$'
         and length(btrim(p_result ->> 'identity_used')) between 1 and 255
         and p_result ->> 'merged_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
         and not jsonb_path_exists(p_result, '$.actions_executed[*] ? (@.type() != "string")')
         and (select coalesce(bool_and(
                       case a
                         when 'close_ticket'       then p_close_ticket
                         when 'comment_evidence'   then p_comment_evidence
                         when 'back_annotate_epic' then p_back_annotate
                         when 'delete_branch'      then p_delete_branch
                         else false
                       end), true)
                     and count(*) = count(distinct a)
                from jsonb_array_elements_text(p_result -> 'actions_executed') a)
  end
$$;

comment on function ouroboros.pr_merge_result_valid(jsonb, boolean, boolean, boolean, boolean) is
  'True when a merged_result is null or exactly {sha, identity_used, actions_executed, merged_at} (#355): sha 7–40 lowercase hex, identity_used a non-blank string of at most 255, merged_at an ISO 8601 timestamp string, and actions_executed an array of distinct actions — close_ticket, comment_evidence, back_annotate_epic, delete_branch — each one the plan had switched on. Identity honesty is pr_merge_plans_identity_not_bot''s, separately.';

-- ---------------------------------------------------------------------------
-- pr_merge_plans — one per PR.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_merge_plans (
  id                         uuid        primary key default gen_random_uuid(),

  pr_id                      uuid        not null
                                         references ouroboros.pull_requests (id) on delete cascade,

  -- --- the plan: from the pinned terminal config, editable per org policy -----------------
  strategy                   text        not null default 'squash',
  delete_branch              boolean     not null default true,
  -- Filled from pr_merge_commit_message_template when written null.
  commit_message             text        not null,

  -- --- the configured actions -------------------------------------------------------------
  close_ticket               boolean     not null default true,
  comment_evidence           boolean     not null default true,
  back_annotate_epic         boolean     not null default false,
  -- The roadmap epic to back-annotate. Released — and the toggle with it — if the epic goes.
  epic_id                    uuid        references ouroboros.planning_epics (id) on delete set null,

  -- --- the armed intent (decision V3) ------------------------------------------------------
  armed                      boolean     not null default false,
  armed_by                   text        references ouroboros."user" ("id") on delete set null,
  armed_at                   timestamptz,
  armed_against_revision_id  uuid        references ouroboros.pr_revisions (id) on delete set null,
  -- Why a re-check disarmed — the card's explanation. Only on a disarmed plan.
  disarm_reason              text,

  -- --- the result --------------------------------------------------------------------------
  merged_result              jsonb,

  -- The person the last manual write acted for — the audit row's actor.
  updated_by                 text        references ouroboros."user" ("id") on delete set null,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint pr_merge_plans_pr_key unique (pr_id),

  constraint pr_merge_plans_strategy
    check (strategy in ('squash', 'merge', 'rebase')),

  constraint pr_merge_plans_commit_message_present
    check (length(btrim(commit_message)) > 0 and length(commit_message) <= 16384),

  -- A merged plan keeps the toggle it merged with, even after its epic is gone.
  constraint pr_merge_plans_back_annotate_has_epic
    check (not back_annotate_epic or epic_id is not null or merged_result is not null),

  -- An armed plan knows when and against what; a disarmed one carries no stale arm.
  -- armed_by is left out: it is required at the arm (pr_merge_plans_arm) and then may be
  -- released by its foreign key, and the arm is still an arm.
  constraint pr_merge_plans_armed_complete
    check (case when armed then armed_at is not null and armed_against_revision_id is not null
                else armed_by is null and armed_at is null and armed_against_revision_id is null
           end),

  constraint pr_merge_plans_disarm_reason_when_disarmed
    check (disarm_reason is null
           or (not armed and length(btrim(disarm_reason)) > 0 and length(disarm_reason) <= 1024)),

  constraint pr_merge_plans_merged_not_armed
    check (merged_result is null or not armed),

  constraint pr_merge_plans_merged_result_shape
    check (ouroboros.pr_merge_result_valid(merged_result, close_ticket, comment_evidence,
                                           back_annotate_epic, delete_branch)),

  -- Decision V3: no [bot] identity while merges are token-based — which, until AZ.4, is always.
  constraint pr_merge_plans_identity_not_bot
    check (merged_result is null
           or jsonb_typeof(merged_result -> 'identity_used') <> 'string'
           or position('[bot]' in lower(merged_result ->> 'identity_used')) = 0)
);

comment on table ouroboros.pr_merge_plans is
  'How a PR will be merged, one per PR (#355, AW.4, decision V3) — mockup 12''s Merge plan card and its "Merge when all gates green" intent: strategy, delete_branch, the editable commit message, three action toggles, the arm (who, when, against which revision), the disarm reason, and merged_result — what actually landed and as whom. Every arm, disarm, edit and merge writes an audit_events row. See V058''s header.';
comment on column ouroboros.pr_merge_plans.strategy is
  'squash | merge | rebase — from the pinned terminal config, editable per org policy.';
comment on column ouroboros.pr_merge_plans.delete_branch is
  'Delete the head branch after merging — from the pinned terminal config, editable per org policy.';
comment on column ouroboros.pr_merge_plans.commit_message is
  'The merge commit''s message, editable. Filled from pr_merge_commit_message_template (title + "Closes <key>.") when written null. At most 16384 characters.';
comment on column ouroboros.pr_merge_plans.close_ticket is
  'Close the canonical ticket on merge — "Close issue #482 on merge".';
comment on column ouroboros.pr_merge_plans.comment_evidence is
  'Comment the evidence summary on the host PR (decision V9).';
comment on column ouroboros.pr_merge_plans.back_annotate_epic is
  'Back-annotate the roadmap epic in epic_id. Off by default; requires epic_id, and is switched off if the epic is deleted before the merge — a merged plan keeps it as the record of what was configured.';
comment on column ouroboros.pr_merge_plans.epic_id is
  'The planning epic (V036, #274) to back-annotate — "Back-annotate roadmap (OTA hardening)". Of the PR''s workspace.';
comment on column ouroboros.pr_merge_plans.armed is
  'The "merge when all gates green" intent. True only with armed_at and armed_against_revision_id, and armed_by at the arm.';
comment on column ouroboros.pr_merge_plans.armed_by is
  'Who armed it; required when arming, released if the person is removed. Null when disarmed.';
comment on column ouroboros.pr_merge_plans.armed_at is
  'When it was armed. Null when disarmed.';
comment on column ouroboros.pr_merge_plans.armed_against_revision_id is
  'The revision of this PR the arm applied to — what the executor''s TOCTOU re-check (#360) compares the head against. Null when disarmed.';
comment on column ouroboros.pr_merge_plans.disarm_reason is
  'Why a failed re-check disarmed the plan — gate red, head moved, host conflict — for the card to show. Only on a disarmed plan; null after a manual disarm and cleared by arming again.';
comment on column ouroboros.pr_merge_plans.merged_result is
  'What the merge did: exactly {sha, identity_used, actions_executed, merged_at}. actions_executed lists the configured actions that actually ran; identity_used is who the host recorded and may not be a [bot] identity while merges are token-based (pr_merge_plans_identity_not_bot). Once set the plan is final.';
comment on column ouroboros.pr_merge_plans.updated_by is
  'The person the last manual write acted for — the actor of the edit and manual-disarm audit rows. Set in the same statement as the write.';
comment on constraint pr_merge_plans_identity_not_bot on ouroboros.pr_merge_plans is
  'Decision V3 (#355): merged_result.identity_used may not contain "[bot]". Until the GitHub App (AZ.4, #374) every merge is made with a person''s configured token, so a bot attribution would misstate who is accountable in a permanent git history. AZ.4 replaces this with a check keyed on the App installation.';

create index pr_merge_plans_armed_idx
  on ouroboros.pr_merge_plans (armed_at) where armed;

create index pr_merge_plans_epic_idx
  on ouroboros.pr_merge_plans (epic_id) where epic_id is not null;

create trigger pr_merge_plans_touch_updated_at
  before update on ouroboros.pr_merge_plans
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Before a write: fill the message, release a deleted epic's toggle, and check the plan's links.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_plans_before_write()
returns trigger
language plpgsql
as $$
declare
  pr_org    text;
  epic_org  text;
begin
  if tg_op = 'UPDATE' and new.pr_id is distinct from old.pr_id then
    raise exception 'a merge plan''s pr is fixed once written'
      using errcode = 'check_violation', constraint = 'pr_merge_plans_pr_frozen';
  end if;

  if new.commit_message is null then
    new.commit_message := ouroboros.pr_merge_commit_message_template(new.pr_id);
  end if;

  -- The epic went (its foreign key set it null): there is nothing left to annotate. A merged
  -- plan keeps its toggle — it is the record of what the merge was configured to do.
  if tg_op = 'UPDATE' and old.epic_id is not null and new.epic_id is null
     and new.merged_result is null then
    new.back_annotate_epic := false;
  end if;

  if new.epic_id is not null
     and (tg_op = 'INSERT' or new.epic_id is distinct from old.epic_id) then
    select p.organization_id into pr_org from ouroboros.pull_requests p where p.id = new.pr_id;
    select e.organization_id into epic_org from ouroboros.planning_epics e where e.id = new.epic_id;

    -- Either missing is its foreign key's to report.
    if pr_org is not null and epic_org is not null and pr_org <> epic_org then
      raise exception 'merge plan names epic %, of organization % rather than the PR''s %',
        new.epic_id, epic_org, pr_org
        using errcode = 'check_violation', constraint = 'pr_merge_plans_epic_in_organization';
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_merge_plans_before_write() is
  'Keeps a merge plan''s pr_id fixed, fills a null commit_message from pr_merge_commit_message_template, switches back_annotate_epic off when the epic''s foreign key releases it, and refuses an epic of another workspace than the PR''s (#355).';

create trigger pr_merge_plans_before_write
  before insert or update on ouroboros.pr_merge_plans
  for each row execute function ouroboros.pr_merge_plans_before_write();

-- ---------------------------------------------------------------------------
-- Arming names a person and a revision of this PR.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_plans_arm()
returns trigger
language plpgsql
as $$
declare
  revision_pr uuid;
begin
  if not new.armed or (tg_op = 'UPDATE' and old.armed
                       and new.armed_against_revision_id is not distinct from old.armed_against_revision_id) then
    return new;
  end if;

  if tg_op = 'INSERT' or not old.armed then
    if new.armed_by is null then
      raise exception 'arming a merge plan names who armed it'
        using errcode = 'check_violation', constraint = 'pr_merge_plans_armed_by_present';
    end if;
  end if;

  select v.pr_id into revision_pr from ouroboros.pr_revisions v where v.id = new.armed_against_revision_id;

  -- A missing revision is its foreign key's to report; a null one pr_merge_plans_armed_complete's.
  if revision_pr is not null and revision_pr <> new.pr_id then
    raise exception 'merge plan armed against revision %, which is not a revision of pr %',
      new.armed_against_revision_id, new.pr_id
      using errcode = 'check_violation', constraint = 'pr_merge_plans_armed_revision_of_pr';
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_merge_plans_arm() is
  'Refuses arming without armed_by, and an armed_against_revision_id that is not a revision of the plan''s own PR (#355, decision V3).';

create trigger pr_merge_plans_arm
  before insert or update of armed, armed_by, armed_against_revision_id on ouroboros.pr_merge_plans
  for each row execute function ouroboros.pr_merge_plans_arm();

-- ---------------------------------------------------------------------------
-- A merged plan is final.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_plans_merged_final()
returns trigger
language plpgsql
as $$
begin
  -- Only the foreign keys' own releases.
  if old.merged_result is not null
     and ((to_jsonb(new) - array['updated_by', 'epic_id', 'updated_at'])
          is distinct from (to_jsonb(old) - array['updated_by', 'epic_id', 'updated_at'])
          or (new.updated_by is distinct from old.updated_by and new.updated_by is not null)
          or (new.epic_id is distinct from old.epic_id and new.epic_id is not null)) then
    raise exception 'merge plan % has merged, and what it did is final', old.id
      using errcode = 'check_violation', constraint = 'pr_merge_plans_merged_final';
  end if;
  return new;
end;
$$;

comment on function ouroboros.pr_merge_plans_merged_final() is
  'Refuses changing a merge plan once merged_result is set (#355): the record of what landed and as whom is final. updated_by and epic_id may still be released by their foreign keys.';

create trigger pr_merge_plans_merged_final
  before update on ouroboros.pr_merge_plans
  for each row execute function ouroboros.pr_merge_plans_merged_final();

-- ---------------------------------------------------------------------------
-- Every arm, disarm, edit and merge writes an audit row — see the header.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_merge_plans_audit()
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
      values (workspace, null, 'pr_merge_plan.merged', 'pr_merge_plan', new.id::text,
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
  'Writes AD.4''s audit event (V022 shape) for every merge-plan arm, disarm, edit and merge (#355): pr_merge_plan.armed (actor armed_by), .disarmed (actor updated_by, or nobody when a re-check disarmed), .edited (actor updated_by, detail.fields the changed plan columns), .merged (no actor; sha, identity_used, actions_executed). detail is a closed field set, so the commit message and disarm reason are never copied into the trail.';

create trigger pr_merge_plans_audit
  after update on ouroboros.pr_merge_plans
  for each row execute function ouroboros.pr_merge_plans_audit();

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason.
--
--   * **A plan is materialized, edited, armed, disarmed and merged** — inserted and updated. What
--     bounds `update` is the triggers above, which bind every role.
--   * **It is never deleted**: it leaves with its PR, and its history is the audit trail's.
--   * The audit trigger runs as the writer, who already holds `insert` on `audit_events` and
--     `select` on `pull_requests`; nothing here runs as its owner.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.pr_merge_plans to ouroboros_app;

revoke delete on ouroboros.pr_merge_plans from ouroboros_app;
revoke delete on ouroboros.pr_merge_plans from public;

grant execute on function ouroboros.pr_merge_closes_trailer(uuid),
                          ouroboros.pr_merge_commit_message_template(uuid),
                          ouroboros.pr_merge_result_valid(jsonb, boolean, boolean, boolean, boolean)
  to ouroboros_app;
