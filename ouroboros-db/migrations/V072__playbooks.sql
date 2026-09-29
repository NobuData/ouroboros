-- V072__playbooks.sql — `playbooks`: the knowledge domain's named recipes, each a pinned
-- workflow version, skill overrides, a context preset and the run it was learned from (#407,
-- BE.3, decision K6).
--
-- Mockup 14's playbooks card is three rows — `Flaky test hunt · run 9×`, `CVE bump · run 14×`,
-- `New driver bring-up · run 3×` — each with **Run on issue… ▾**, and a dashed
-- **+ New playbook from a past run…** tile. The tile is the storage model: a good recipe is a
-- run that went well, kept. So a playbook is mostly a snapshot of how a run was configured —
-- which workflow at which version, which skills, what the human steered it toward — and
-- `source_run_id` says which run taught it.
--
-- Nothing writes it yet. BF.6 (#415) is the service (create-from-run, run-on-issue) and BE.5
-- (#409) seeds the three mockup rows. As with `V069`, that is why each rule a reader depends on
-- is a constraint here rather than an application invariant.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **The workflow is pinned, and cannot track head.** `workflow_version` is `not null` and
--     `playbooks_workflow_version_fk` names a *published* `workflow_versions` row of that
--     workflow (`V029`: the draft is the row whose version is null, so it can never be named).
--     There is no "latest" sentinel and no link to `workflows.current_version`: publishing v15
--     moves that pointer and moves no playbook. A person who wants the newer workflow re-pins
--     deliberately — an UPDATE of `workflow_version`. `playbooks_workflow_fk` holds the workflow
--     to the playbook's own workspace and cascades, because a recipe whose workflow is gone
--     cannot run; the version key is NO ACTION, so a pinned version cannot be deleted from
--     under a playbook on its own.
--
--   * **Skill overrides are deltas, typed.** `skill_overrides` is
--     `{"enable": [skill id…], "disable": [skill id…]}` — both keys optional, each a set of at
--     most 64 skill ids, the two disjoint (`playbook_skill_overrides_typed`). They are relative
--     to what context assembly would have resolved for the issue (decision K8), not a full
--     list: `{}` means "as assembly resolves". `playbooks_refs_resolve` holds every id to a
--     skill of this workspace, and refuses a `disable` of a `required` skill — `V069`'s
--     `hil-safety` lock is not one recipe away from being off.
--
--   * **The context preset is typed.** `context_preset` is
--     `{"steer_notes": [text…], "fact_ids": [fact id…]}` — the steer the human gave the source
--     run (1–16 non-blank notes of at most 2000 characters) and extra facts to inject (a set of
--     at most 64 ids, each a fact of this workspace — `playbooks_refs_resolve`)
--     (`playbook_context_preset_typed`). A malformed preset is refused at write, so it cannot
--     reach the assembly service. A referenced fact that later goes stale or expires stays
--     referenced; assembly injects only confirmed facts (`V071`'s `context_injections_resolves`).
--
--   * **The issue filter narrows Run on issue… ▾.** `issue_filter` is null (every issue) or
--     `{"labels": [label…], "repos": [owner/name…]}` with at least one key
--     (`playbook_issue_filter_typed`). `playbook_issue_filter_admits(filter, repo, labels)` is
--     the picker's test: every present key must match — `labels` when the issue carries any of
--     them (`V014`'s `labels` array), `repos` when the issue's repository is one of them. A
--     CVE-bump recipe says `{"labels": ["dependencies"]}` and is not offered for a HIL failure.
--
--   * **Provenance survives its run.** `source_run_id` is nullable — a hand-authored recipe has
--     none — and `playbooks_source_run_fk` is composite to a run of the same workspace with
--     `on delete set null (source_run_id)`: deleting the run clears the pointer and leaves the
--     playbook whole and runnable.
--
--   * **`run 9×` is derived from launches.** `runs.playbook_id` and `queue_items.playbook_id`
--     (an amendment to INTAKE-M.3, #112) name the playbook a run or queued issue was launched
--     through — composite to a playbook of the same workspace, `set null` when the playbook is
--     deleted so the history stays. The count is
--     `select count(*) from ouroboros.runs where playbook_id = $1`, served by
--     `runs_playbook_idx`. A queued item carries the id so the run that claims it can inherit
--     it; it is not itself a launch until then.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   * **A run count.** No `run_count`, `uses` or `last_run_at` column on `playbooks` —
--     constraints.sql asserts none appears. A counter is one failed launch away from lying, and
--     this card's credibility is that the recipes have actually been used.
--   * **Foreign keys inside the jsonb.** Skill and fact ids are checked when the playbook is
--     written, not kept in step afterwards: deleting a skill does not rewrite recipes that
--     mention it, and assembly ignores an override naming a skill it did not resolve.

-- ---------------------------------------------------------------------------
-- Shape helpers
-- ---------------------------------------------------------------------------
create function ouroboros.jsonb_uuid_set(arr jsonb, max_items integer) returns boolean
language plpgsql immutable parallel safe as $$
begin
  -- A JSON array of 1..max_items distinct, canonical lower-case uuid strings.
  if arr is null or jsonb_typeof(arr) <> 'array'
     or jsonb_array_length(arr) not between 1 and max_items then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(arr) as e
              where jsonb_typeof(e) <> 'string'
                 or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  then
    return false;
  end if;
  return (select count(distinct e) = count(*) from jsonb_array_elements(arr) as e);
end;
$$;

comment on function ouroboros.jsonb_uuid_set(jsonb, integer) is
  'True when arr is a JSON array of 1..max_items distinct canonical (lower-case, hyphenated) uuid strings — the id lists inside playbooks'' skill_overrides and context_preset (#407).';

create function ouroboros.jsonb_text_set(arr jsonb, max_items integer, max_length integer)
returns boolean
language plpgsql immutable parallel safe as $$
begin
  -- A JSON array of 1..max_items distinct, non-blank strings of at most max_length characters.
  if arr is null or jsonb_typeof(arr) <> 'array'
     or jsonb_array_length(arr) not between 1 and max_items then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(arr) as e
              where jsonb_typeof(e) <> 'string'
                 or btrim(e #>> '{}') = ''
                 or length(e #>> '{}') > max_length)
  then
    return false;
  end if;
  return (select count(distinct e) = count(*) from jsonb_array_elements(arr) as e);
end;
$$;

comment on function ouroboros.jsonb_text_set(jsonb, integer, integer) is
  'True when arr is a JSON array of 1..max_items distinct non-blank strings, each at most max_length characters — steer notes, labels and repositories in a playbook (#407).';

-- ---------------------------------------------------------------------------
-- The three documents' shapes
-- ---------------------------------------------------------------------------
create function ouroboros.playbook_skill_overrides_typed(o jsonb) returns boolean
language plpgsql immutable parallel safe as $$
begin
  -- Early returns, as V069's skill_frontmatter_typed: jsonb_object_keys raises on a non-object.
  if o is null or jsonb_typeof(o) <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(o) as k where k not in ('enable', 'disable')) then
    return false;
  end if;
  if o ? 'enable' and not ouroboros.jsonb_uuid_set(o -> 'enable', 64) then
    return false;
  end if;
  if o ? 'disable' and not ouroboros.jsonb_uuid_set(o -> 'disable', 64) then
    return false;
  end if;
  -- A skill is enabled or disabled by a recipe, not both.
  if o ? 'enable' and o ? 'disable'
     and exists (select 1 from jsonb_array_elements(o -> 'enable') as e
                  where (o -> 'disable') @> jsonb_build_array(e)) then
    return false;
  end if;
  return true;
end;
$$;

comment on function ouroboros.playbook_skill_overrides_typed(jsonb) is
  'True when a playbook''s skill_overrides is {"enable"?: [skill id…], "disable"?: [skill id…]} (#407): each a set of 1–64 uuid strings, the two disjoint, no other key. {} is no delta — assembly''s resolution unchanged.';

create function ouroboros.playbook_context_preset_typed(p jsonb) returns boolean
language plpgsql immutable parallel safe as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p) as k where k not in ('steer_notes', 'fact_ids'))
  then
    return false;
  end if;
  if p ? 'steer_notes' and not ouroboros.jsonb_text_set(p -> 'steer_notes', 16, 2000) then
    return false;
  end if;
  if p ? 'fact_ids' and not ouroboros.jsonb_uuid_set(p -> 'fact_ids', 64) then
    return false;
  end if;
  return true;
end;
$$;

comment on function ouroboros.playbook_context_preset_typed(jsonb) is
  'True when a playbook''s context_preset is {"steer_notes"?: [text…], "fact_ids"?: [fact id…]} (#407): 1–16 distinct non-blank notes of at most 2000 characters, 1–64 distinct fact uuids, no other key. {} is no preset.';

create function ouroboros.playbook_issue_filter_typed(f jsonb) returns boolean
language plpgsql immutable parallel safe as $$
begin
  if f is null or jsonb_typeof(f) <> 'object' then
    return false;
  end if;
  -- An empty filter would admit everything; that is what a null filter says, once.
  if f = '{}'::jsonb then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(f) as k where k not in ('labels', 'repos')) then
    return false;
  end if;
  if f ? 'labels' and not ouroboros.jsonb_text_set(f -> 'labels', 32, 100) then
    return false;
  end if;
  if f ? 'repos' then
    if not ouroboros.jsonb_text_set(f -> 'repos', 32, 255) then
      return false;
    end if;
    -- The shape of V067's repo_ref domain, element by element.
    if exists (select 1 from jsonb_array_elements_text(f -> 'repos') as r
                where r !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$'
                   or r ~ '(^|/)\.\.?(/|$)') then
      return false;
    end if;
  end if;
  return true;
end;
$$;

comment on function ouroboros.playbook_issue_filter_typed(jsonb) is
  'True when a playbook''s issue_filter is {"labels"?: [label…], "repos"?: [owner/name…]} with at least one key (#407): 1–32 distinct non-blank labels of at most 100 characters, 1–32 distinct repo_ref-shaped repositories. A filter admitting every issue is stored as null, not {}.';

create function ouroboros.playbook_issue_filter_admits(
  filter jsonb, repo text, labels jsonb
) returns boolean
language sql immutable parallel safe as $$
  -- Null admits every issue. Otherwise every present key must match: repos when the issue's
  -- repository is listed, labels when the issue carries any listed label.
  select filter is null
      or ((not filter ? 'repos' or (filter -> 'repos') @> jsonb_build_array(repo))
          and (not filter ? 'labels'
               or exists (select 1
                            from jsonb_array_elements_text(coalesce(labels, '[]'::jsonb)) as l
                           where (filter -> 'labels') @> jsonb_build_array(l))));
$$;

comment on function ouroboros.playbook_issue_filter_admits(jsonb, text, jsonb) is
  'The Run on issue… ▾ picker''s test (#407): true when a playbook with this issue_filter may be offered for an issue in repo (owner/name) carrying labels (a JSON array of names, V014''s github_issues.labels). Null admits all; otherwise repos must list the repository and labels must share at least one label with the issue.';

-- ---------------------------------------------------------------------------
-- playbooks
-- ---------------------------------------------------------------------------
create table ouroboros.playbooks (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a recipe is that workspace's.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The card's row: "Flaky test hunt", and the line beneath it.
  name             text        not null,
  description      text        not null,

  -- The pinned workflow — never its head (playbooks_workflow_version_fk).
  workflow_id      uuid        not null,
  workflow_version integer     not null,

  -- Enable/disable deltas relative to assembly's resolution (playbook_skill_overrides_typed).
  skill_overrides  jsonb       not null default '{}',

  -- Steer notes and extra fact refs (playbook_context_preset_typed).
  context_preset   jsonb       not null default '{}',

  -- The run that taught it; null for a hand-authored recipe, cleared if the run is deleted.
  source_run_id    uuid,

  -- Narrows Run on issue… ▾; null offers it for every issue (playbook_issue_filter_typed).
  issue_filter     jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint playbooks_organization_name_key unique (organization_id, name),

  -- For the composite keys runs and queue_items use to name a playbook of their workspace.
  constraint playbooks_id_organization_key unique (id, organization_id),

  constraint playbooks_name_present
    check (btrim(name) <> '' and length(name) <= 120),

  constraint playbooks_description_present
    check (btrim(description) <> '' and length(description) <= 300),

  constraint playbooks_workflow_version_positive
    check (workflow_version >= 1),

  constraint playbooks_skill_overrides_typed
    check (ouroboros.playbook_skill_overrides_typed(skill_overrides)),

  constraint playbooks_context_preset_typed
    check (ouroboros.playbook_context_preset_typed(context_preset)),

  constraint playbooks_issue_filter_typed
    check (issue_filter is null or ouroboros.playbook_issue_filter_typed(issue_filter)),

  -- A workflow of this workspace; the recipe goes with it.
  constraint playbooks_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade,

  -- A published version of that workflow — the pin. NO ACTION: a pinned version stays.
  constraint playbooks_workflow_version_fk
    foreign key (workflow_id, workflow_version)
    references ouroboros.workflow_versions (workflow_id, version),

  -- A run of this workspace; deleting it clears the pointer and nothing else.
  constraint playbooks_source_run_fk
    foreign key (source_run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete set null (source_run_id)
);

comment on table ouroboros.playbooks is
  'The knowledge domain''s recipes (#407, BE.3, decision K6) — mockup 14''s playbooks card. A pinned workflow version, skill overrides relative to assembly, a typed context preset, an optional issue filter, and the run it was learned from. "run 9×" is derived from runs.playbook_id and deliberately not stored.';
comment on column ouroboros.playbooks.organization_id is
  'The workspace. ON DELETE CASCADE.';
comment on column ouroboros.playbooks.name is
  'The recipe''s name — "Flaky test hunt". Non-blank, at most 120 characters, unique per workspace (playbooks_organization_name_key).';
comment on column ouroboros.playbooks.description is
  'The line beneath the name on the card. Non-blank, at most 300 characters.';
comment on column ouroboros.playbooks.workflow_id is
  'The workflow the recipe runs — a workflow of the same workspace (playbooks_workflow_fk), ON DELETE CASCADE.';
comment on column ouroboros.playbooks.workflow_version is
  'The pinned published version of workflow_id — the v14 of standard-fix@v14. NOT NULL and a key into workflow_versions (playbooks_workflow_version_fk), so a playbook cannot name a draft or track workflows.current_version; re-pinning is a deliberate update.';
comment on column ouroboros.playbooks.skill_overrides is
  '{"enable"?: [skill id…], "disable"?: [skill id…]} — deltas relative to the skills context assembly would resolve (K8). Typed by playbook_skill_overrides_typed; ids are skills of this workspace and a required skill is never disabled (playbooks_refs_resolve). {} is no delta.';
comment on column ouroboros.playbooks.context_preset is
  '{"steer_notes"?: [text…], "fact_ids"?: [fact id…]} — the human''s steer and extra facts to inject. Typed by playbook_context_preset_typed; fact ids are facts of this workspace (playbooks_refs_resolve). {} is no preset.';
comment on column ouroboros.playbooks.source_run_id is
  'The run the recipe was created from (+ New playbook from a past run…). Null for a hand-authored recipe. A run of the same workspace; ON DELETE SET NULL (source_run_id), so deleting the run neither orphans nor invalidates the playbook.';
comment on column ouroboros.playbooks.issue_filter is
  'Null (offer for every issue) or {"labels"?: […], "repos"?: [owner/name…]} — typed by playbook_issue_filter_typed and applied by playbook_issue_filter_admits in the Run on issue… ▾ picker.';
comment on constraint playbooks_workflow_version_fk on ouroboros.playbooks is
  'The pin (#407): (workflow_id, workflow_version) is a published version of the workflow. Drafts carry a null version and cannot be named; NO ACTION so a pinned version cannot be removed on its own, while deleting the workflow takes its versions and its playbooks in one statement.';
comment on constraint playbooks_source_run_fk on ouroboros.playbooks is
  'Create-from-run provenance (#407): a run of the same workspace. ON DELETE SET NULL (source_run_id) — only the pointer is cleared; organization_id stays.';

-- ---------------------------------------------------------------------------
-- Skill and fact refs resolve to this workspace
-- ---------------------------------------------------------------------------
create function ouroboros.playbooks_refs_resolve() returns trigger
language plpgsql as $$
declare
  missing text;
begin
  -- A BEFORE trigger runs ahead of the CHECK constraints. A malformed document is theirs to
  -- refuse, by name, rather than this function's to trip over casting a non-uuid.
  if not ouroboros.playbook_skill_overrides_typed(new.skill_overrides)
     or not ouroboros.playbook_context_preset_typed(new.context_preset) then
    return new;
  end if;

  -- Every enabled or disabled skill is a skill of this workspace.
  select string_agg(ref, ', ') into missing
    from jsonb_array_elements_text(coalesce(new.skill_overrides -> 'enable', '[]'::jsonb)
                                   || coalesce(new.skill_overrides -> 'disable', '[]'::jsonb))
         as ref
   where not exists (select 1 from ouroboros.skills s
                      where s.id = ref::uuid and s.organization_id = new.organization_id);
  if missing is not null then
    raise exception 'skill_overrides names skills that are not skills of workspace %: %',
      new.organization_id, missing
      using errcode = 'foreign_key_violation', constraint = tg_name;
  end if;

  -- A required skill cannot be switched off by a recipe (V069's lock).
  select string_agg(s.slug, ', ') into missing
    from jsonb_array_elements_text(coalesce(new.skill_overrides -> 'disable', '[]'::jsonb))
         as ref
    join ouroboros.skills s on s.id = ref::uuid
   where s.required;
  if missing is not null then
    raise exception 'skill_overrides may not disable a required skill: %', missing
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- Every extra fact is a fact of this workspace.
  select string_agg(ref, ', ') into missing
    from jsonb_array_elements_text(coalesce(new.context_preset -> 'fact_ids', '[]'::jsonb))
         as ref
   where not exists (select 1 from ouroboros.facts f
                      where f.id = ref::uuid and f.organization_id = new.organization_id);
  if missing is not null then
    raise exception 'context_preset names facts that are not facts of workspace %: %',
      new.organization_id, missing
      using errcode = 'foreign_key_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.playbooks_refs_resolve() is
  'BEFORE INSERT OR UPDATE trigger for playbooks (#407): every skill id in skill_overrides is a skill of the playbook''s workspace, no disable names a required skill, and every fact id in context_preset is a fact of the workspace. Raises class 23 naming the trigger. Checked at write only — see the header.';

create trigger playbooks_refs_resolve
  before insert or update of organization_id, skill_overrides, context_preset
  on ouroboros.playbooks
  for each row execute function ouroboros.playbooks_refs_resolve();

create trigger playbooks_touch_updated_at
  before update on ouroboros.playbooks
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Launch linkage — the amendment to INTAKE-M.3 (#112)
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column playbook_id uuid,
  add constraint runs_playbook_fk
    foreign key (playbook_id, organization_id)
    references ouroboros.playbooks (id, organization_id) on delete set null (playbook_id);

alter table ouroboros.queue_items
  add column playbook_id uuid,
  add constraint queue_items_playbook_fk
    foreign key (playbook_id, organization_id)
    references ouroboros.playbooks (id, organization_id) on delete set null (playbook_id);

comment on column ouroboros.runs.playbook_id is
  'The playbook this run was launched through (#407), or null. "run 9×" is count(*) of runs carrying it (runs_playbook_idx). SET NULL when the playbook is deleted, so the run''s history stays.';
comment on column ouroboros.queue_items.playbook_id is
  'The playbook this queued issue was launched through (#407, amending INTAKE-M.3 #112), or null — inherited by the run that claims it. SET NULL when the playbook is deleted.';
comment on constraint runs_playbook_fk on ouroboros.runs is
  'A run names a playbook of its own workspace (#407). ON DELETE SET NULL (playbook_id).';
comment on constraint queue_items_playbook_fk on ouroboros.queue_items is
  'A queued issue names a playbook of its own workspace (#407). ON DELETE SET NULL (playbook_id).';

-- `runs_with_stage` carries the new column too — V049's reason: a read moves from `runs` to
-- the view by changing one word only while the two have the same columns. Appended at the
-- end, which is what `create or replace view` allows.
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
       run.playbook_id
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303 and #407). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

create index runs_playbook_idx
  on ouroboros.runs (playbook_id)
  where playbook_id is not null;

comment on index ouroboros.runs_playbook_idx is
  'The derived launch count — "run 9×" is count(*) where playbook_id = $1 (#407) — and the set-null a playbook delete performs.';

create index queue_items_playbook_idx
  on ouroboros.queue_items (playbook_id)
  where playbook_id is not null;

comment on index ouroboros.queue_items_playbook_idx is
  'The set-null a playbook delete performs on queued issues (#407).';

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update, delete on ouroboros.playbooks to ouroboros_app;
