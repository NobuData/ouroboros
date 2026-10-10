-- V125__research_planning_handoff.sql — what the two paths from a brief to work need stored
-- (#624, CM.5).
--
-- Mockup 22 has two actions that turn evidence into work:
--
--   [Draft epic from gaps →]   PROPOSED FROM GAPS  [EPIC · Docking parity] [DOCK-1 …] [+3 more]
--
--   RS-124 — FROM BRIEF TO ROADMAP TO ISSUES   [skill · create-roadmap] → [skill · create-issues]
--   2 · CREATE-ISSUES → GITHUB   6 issues · 2 milestones · synced
--       ◆ M1 · Docking parity · due Oct 15 · 1/3 done     #742 …  MVP  L  cx:high
--
-- Both end in Planning drafts (AK.1, V034) pushed by the one push path (AL.3). Four things the
-- schema could not yet say:
--
--   1. **Where a draft came from in research.** V037 deferred this to "the migration that can
--      reference them": `ticket_drafts.research_provenance` names the investigation, the gap
--      (capability and severity) or roadmap item the draft was written for, the effort the
--      brief proposed, and the ledger records (V108 `source_records`) it cites.
--   2. **A milestone per draft.** A batch has one `target_milestone`, a name. A roadmap files
--      six issues under two milestones with due dates, so a draft may name its own
--      (`milestone_name`, `milestone_due`), which wins over the batch's.
--   3. **Labels.** The MVP flag reaches the tracker as a label, which is also what lets the
--      drift check read it back: `ticket_drafts.labels`.
--   4. **The document's side of the round trip.** `roadmap_docs.target_source_id` is the
--      repository the file lives in and the tracker its issues are filed to;
--      `roadmap_docs.batch_id` is the one batch create-issues composed, which is what makes a
--      re-run find its drafts instead of writing new ones.
--
-- And one policy: `roadmap_pipeline_settings.direct_commit` — whether a projection may be
-- committed to the default branch without a pull request. Default false: the repository's own
-- gate is review.
--
-- Revert forward:
--   drop table ouroboros.roadmap_pipeline_settings;
--   alter table ouroboros.roadmap_docs drop column batch_id, drop column target_source_id;
--   alter table ouroboros.ticket_drafts drop column labels, drop column milestone_due,
--     drop column milestone_name, drop column research_provenance;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- draft_research_provenance_valid(provenance) — whether a draft's research provenance is exactly
-- {investigation_id, origin, capability, severity, item_key, effort, sources} where
--   investigation_id  a uuid string — the investigation whose brief the draft came from
--   origin            gap | roadmap — a matrix gap, or an item of a roadmap document
--   capability        the gap's capability (non-blank, ≤ 200) for a gap; null for a roadmap item
--   severity          high | med for a gap; null for a roadmap item
--   item_key          the roadmap item's key for a roadmap item; null for a gap
--   effort            xs | s | m | l | xl — the effort the brief proposed — or null
--   sources           0–200 distinct uuid strings: the ledger records the draft cites
--   provenance — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.draft_research_provenance_valid(provenance jsonb)
returns boolean language plpgsql immutable as $$
declare
  origin  text;
  source  jsonb;
  seen    text[] := '{}';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not ouroboros.jsonb_keys_are(provenance, array['investigation_id', 'origin', 'capability',
                                                    'severity', 'item_key', 'effort', 'sources'])
     or jsonb_typeof(provenance -> 'investigation_id') <> 'string'
     or (provenance ->> 'investigation_id') !~ uuid_re
     or jsonb_typeof(provenance -> 'origin') <> 'string'
     or jsonb_typeof(provenance -> 'sources') <> 'array'
     or jsonb_array_length(provenance -> 'sources') > 200
     or not (jsonb_typeof(provenance -> 'effort') = 'null'
             or (provenance ->> 'effort') in ('xs', 's', 'm', 'l', 'xl')) then
    return false;
  end if;

  origin := provenance ->> 'origin';
  if origin = 'gap' then
    if not ouroboros.jsonb_nonblank_string(provenance -> 'capability')
       or length(provenance ->> 'capability') > 200
       or jsonb_typeof(provenance -> 'severity') <> 'string'
       or (provenance ->> 'severity') not in ('high', 'med')
       or jsonb_typeof(provenance -> 'item_key') <> 'null' then
      return false;
    end if;
  elsif origin = 'roadmap' then
    if jsonb_typeof(provenance -> 'item_key') <> 'string'
       or (provenance ->> 'item_key') !~ '^[a-z0-9][a-z0-9_-]{0,31}$'
       or jsonb_typeof(provenance -> 'capability') <> 'null'
       or jsonb_typeof(provenance -> 'severity') <> 'null' then
      return false;
    end if;
  else
    return false;
  end if;

  for source in select s from jsonb_array_elements(provenance -> 'sources') s loop
    if jsonb_typeof(source) <> 'string' or (source #>> '{}') !~ uuid_re
       or (source #>> '{}') = any (seen) then
      return false;
    end if;
    seen := seen || (source #>> '{}');
  end loop;
  return true;
end;
$$;

comment on function ouroboros.draft_research_provenance_valid(jsonb) is
  'True when a draft''s research provenance is exactly {investigation_id, origin gap|roadmap, capability, severity, item_key, effort, sources}: a gap names its capability and severity (high|med), a roadmap item its item_key; effort xs|s|m|l|xl or null; sources ≤ 200 distinct uuids (#624).';

-- draft_labels_valid(labels) — whether a draft's labels are a list of at most 20 distinct,
-- non-blank strings of at most 50 characters (a GitHub label's bound).
--   labels — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.draft_labels_valid(labels jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(labels) = 'array'
     and jsonb_array_length(labels) <= 20
     and not exists (select 1 from jsonb_array_elements(labels) l
                      where jsonb_typeof(l) <> 'string'
                         or btrim(l #>> '{}') = '' or length(l #>> '{}') > 50)
     and (select count(*) = count(distinct l #>> '{}') from jsonb_array_elements(labels) l);
$$;

comment on function ouroboros.draft_labels_valid(jsonb) is
  'True when a value is a list of at most 20 distinct non-blank strings of at most 50 characters (#624).';

-- ---------------------------------------------------------------------------
-- ticket_drafts — research provenance, a milestone of its own, labels.
-- ---------------------------------------------------------------------------
alter table ouroboros.ticket_drafts
  add column research_provenance jsonb
    constraint ticket_drafts_research_provenance_shape
      check (research_provenance is null
             or ouroboros.draft_research_provenance_valid(research_provenance)),
  add column milestone_name text
    constraint ticket_drafts_milestone_name_present
      check (btrim(milestone_name) <> '' and length(milestone_name) <= 200),
  add column milestone_due date,
  add column labels jsonb not null default '[]'
    constraint ticket_drafts_labels_shape check (ouroboros.draft_labels_valid(labels)),
  add constraint ticket_drafts_milestone_due_needs_name
    check (milestone_due is null or milestone_name is not null);

comment on column ouroboros.ticket_drafts.research_provenance is
  'Where in research the draft came from (#624, CM.5): {investigation_id, origin gap|roadmap, capability, severity, item_key, effort, sources} — the investigation, the matrix gap or roadmap item it was written for, the effort the brief proposed and the source_records it cites. Null for a draft research did not write. History, so not a foreign key: it is checked at write and outlives the investigation.';
comment on column ouroboros.ticket_drafts.milestone_name is
  'The tracker milestone this draft is filed under (#624), winning over the batch''s target_milestone; null to use the batch''s.';
comment on column ouroboros.ticket_drafts.milestone_due is
  'The due date sent when the push creates milestone_name (#624); an existing milestone keeps its own. Only with a milestone_name.';
comment on column ouroboros.ticket_drafts.labels is
  'The labels the push sends with the ticket (#624) — a roadmap item''s MVP flag travels as `mvp`. At most 20.';

-- The investigation a draft names is its batch's workspace's, and so is every record it cites.
create function ouroboros.ticket_drafts_research_provenance_same_workspace()
returns trigger language plpgsql as $$
declare
  workspace     text;
  investigation uuid;
begin
  -- A malformed value is the shape check's to refuse (ticket_drafts_research_provenance_shape),
  -- which runs after this trigger.
  if new.research_provenance is null
     or not ouroboros.draft_research_provenance_valid(new.research_provenance) then
    return new;
  end if;

  select b.organization_id into workspace from ouroboros.draft_batches b where b.id = new.batch_id;
  investigation := (new.research_provenance ->> 'investigation_id')::uuid;

  if not exists (select 1 from ouroboros.investigations i
                  where i.id = investigation and i.organization_id = workspace) then
    raise exception 'draft % names investigation %, which is not of workspace %',
      new.local_key, investigation, workspace
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if exists (select 1 from jsonb_array_elements_text(new.research_provenance -> 'sources') s
              where not exists (select 1 from ouroboros.source_records r
                                 where r.id = s::uuid and r.investigation_id = investigation)) then
    raise exception 'draft % cites a source outside investigation %''s ledger',
      new.local_key, investigation
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'A draft cites source_records of the investigation it names.';
  end if;
  return new;
end;
$$;

comment on function ouroboros.ticket_drafts_research_provenance_same_workspace() is
  'Refuses a draft whose research provenance names an investigation outside its batch''s workspace, or cites a source outside that investigation''s ledger (#624).';

create trigger ticket_drafts_research_provenance_same_workspace
  before insert or update of research_provenance on ouroboros.ticket_drafts
  for each row execute function ouroboros.ticket_drafts_research_provenance_same_workspace();

-- ---------------------------------------------------------------------------
-- roadmap_docs — the repository and tracker it is projected to, and its batch.
-- ---------------------------------------------------------------------------
alter table ouroboros.roadmap_docs
  add column target_source_id uuid
    constraint roadmap_docs_target_source_fk
      references ouroboros.ticket_sources (id) on delete set null,
  add column batch_id uuid
    constraint roadmap_docs_batch_fk
      references ouroboros.draft_batches (id) on delete set null,
  add constraint roadmap_docs_batch_key unique (batch_id);

comment on column ouroboros.roadmap_docs.target_source_id is
  'The ticket source whose repository ROADMAP.md is projected to and whose tracker create-issues files to (#624). Null when the source was removed: the document stays readable and cannot be projected or filed until one is chosen.';
comment on column ouroboros.roadmap_docs.batch_id is
  'The Planning batch create-issues composed for this document (#624) — one per document, which is what makes a re-run find its drafts rather than write new ones. Null before create-issues first runs.';

-- The source and the batch are the document's workspace's.
create function ouroboros.roadmap_docs_targets_same_workspace()
returns trigger language plpgsql as $$
begin
  if new.target_source_id is not null
     and not exists (select 1 from ouroboros.ticket_sources s
                      where s.id = new.target_source_id
                        and s.organization_id = new.organization_id) then
    raise exception 'ticket source % is not of workspace %', new.target_source_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  if new.batch_id is not null
     and not exists (select 1 from ouroboros.draft_batches b
                      where b.id = new.batch_id and b.organization_id = new.organization_id) then
    raise exception 'draft batch % is not of workspace %', new.batch_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_docs_targets_same_workspace() is
  'Refuses a roadmap doc whose target source or batch belongs to another workspace (#624).';

create trigger roadmap_docs_targets_same_workspace
  before insert or update of target_source_id, batch_id, organization_id on ouroboros.roadmap_docs
  for each row execute function ouroboros.roadmap_docs_targets_same_workspace();

-- ---------------------------------------------------------------------------
-- roadmap_pipeline_settings — the workspace's one pipeline policy.
-- ---------------------------------------------------------------------------
create table ouroboros.roadmap_pipeline_settings (
  -- One row per workspace. Cascade, as everything a workspace owns.
  organization_id text        primary key
                              references ouroboros.organization ("id") on delete cascade,

  -- Whether ROADMAP.md may be committed to the default branch without a pull request.
  direct_commit   boolean     not null default false,

  -- Who last decided. Set null when the person is removed.
  updated_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table ouroboros.roadmap_pipeline_settings is
  'A workspace''s roadmap-pipeline policy (#624, CM.5). Absent row = the defaults: every projection of ROADMAP.md goes through a pull request.';
comment on column ouroboros.roadmap_pipeline_settings.direct_commit is
  'Whether a roadmap projection is committed straight to the repository''s default branch (#624) — an explicit opt-in. Default false: the file lands through a pull request.';

create trigger roadmap_pipeline_settings_touch_updated_at
  before update on ouroboros.roadmap_pipeline_settings
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- skills.origin — `generated` now has a second writer.
--
-- V069 wrote the comment when the only generated skill was the nightly repo-map (#415). The
-- roadmap pipeline's `create-roadmap` and `create-issues` are generated too — written once for
-- a workspace, by the product, the first time the pipeline needs them — and nothing rebuilds
-- them: a workspace publishes its own version and that is what runs. The vocabulary is
-- unchanged; the comment says what it now covers.
-- ---------------------------------------------------------------------------
comment on column ouroboros.skills.origin is
  'Who wrote the skill: authored — a person, in the product; imported — read from a rules file (#410); generated — written by the product itself. A generated skill of a repository is rebuilt nightly by the repo-map job (#415), which overwrites hand edits; an org-wide generated skill (the roadmap pipeline''s create-roadmap and create-issues, #624) is shipped once on first use and is the workspace''s to edit.';

-- ---------------------------------------------------------------------------
-- The application role. Drafts and docs are already granted (V034, V113).
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.roadmap_pipeline_settings to ouroboros_app;
