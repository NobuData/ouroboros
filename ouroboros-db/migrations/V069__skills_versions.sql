-- V069__skills_versions.sql — `skills` and `skill_versions`: the knowledge domain's skill
-- registry, scoped, flagged and versioned (#405, BE.1).
--
-- The first migration of the **knowledge** domain (docs/ROADMAP_MOCKUP_14_KNOWLEDGE.md, epic
-- #401). Mockup 14's skills card is six rows — `zephyr-conventions`, `repo-map`,
-- `pr-etiquette`, the locked `hil-safety`, `commit-style` and the tinted draft
-- `power-budget-checks` — under the caption *"Skills are markdown with frontmatter — edit in
-- the Workflow Studio editor."* Decision **K1** makes that caption the storage model: a skill
-- is a registry row, and its text is a history of immutable markdown versions with typed
-- frontmatter, on the WF-P.1 (#132, `V029`) pattern the workflows already use.
--
-- Nothing writes it yet. BF.1 (#410) is the service, BE.5 (#409) seeds the six mockup rows,
-- #413 imports rules files as drafts and #415 generates `repo-map`. As with `V029`, that is
-- why each rule a reader depends on is a constraint here rather than an application invariant.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **Scope is typed, and its referent is stored.** A skill applies at `org`, `repo` or
--     `workflow` level, and closest-scope wins on conflict (decision **K8**). That resolution
--     is the assembly service's (#406's consumers), but it can only happen if the scope is a
--     closed vocabulary and the thing it names is on the row: `skills_scope_referent` holds a
--     repo-scoped skill to a `repo_ref` (`V067`'s `owner/name` domain) and a workflow-scoped
--     one to a `workflow_id`, and an org-scoped skill to neither. The workflow is a composite
--     foreign key on `(workflow_id, organization_id)`, so a skill cannot point at another
--     workspace's workflow; it cascades, because a workflow-scoped skill means nothing once
--     its workflow is gone.
--
--   * **`required` is an invariant, not a UI state.** `hil-safety` protects physical test
--     hardware, so disabling it must be impossible rather than discouraged. The lock is three
--     layers: `skills_required_enabled` (`NOT (required AND NOT enabled)`) here, BF.1's 403 in
--     the service, and the locked switch in the UI — the last of three, not the only one.
--     `skills_required_not_draft` refuses a required draft for the same reason: a skill that
--     is locked on and never injected is a contradiction, not a state.
--
--   * **Draft skills are never injected — enforced in assembly, documented here.** `draft` is
--     what makes #413's one-click import safe: every row an import creates is a draft, so
--     importing somebody's whole `CLAUDE.md` changes no run's behaviour until a person
--     promotes a skill out of draft. The context-assembly service (#406's injection records
--     are its output) excludes `draft = true` rows unconditionally, whatever `enabled` says.
--     This column is the skill's *lifecycle*, and is distinct from a draft *version* — the
--     unnumbered `skill_versions` row that holds unpublished edits, exactly as in `V029`.
--
--   * **Origin tells three authorship stories apart.** `authored` is a person; `imported`
--     came from a rules file, and its frontmatter carries that provenance
--     (`{"provenance": {"source": "CLAUDE.md", "section": "…"}}`); `generated` is `repo-map`
--     (decision **K2**). **Generated-origin skills are rebuilt by the #415 job**: its history
--     is the generator's diffs, each run publishing the next version, and a hand edit will be
--     overwritten by the next rebuild — which is what the UI tells a person because this
--     column lets it.
--
--   * **Versions are immutable once published** — `V029`'s trigger, `V029`'s one exception
--     (the publisher foreign key's own set-null) and `V029`'s draft row. Publishing is the
--     draft being given the next number, dense from 1 (`skill_versions_next_version`), and
--     `skills.current_version` is a pointer at the version in force, not a cache of
--     `max(version)`. One authoring and versioning model across workflows and skills.
--
--   * **Frontmatter is stored parsed and typed.** `skill_frontmatter_typed(jsonb)` holds the
--     document to a closed set of keys, each with its type — see that function. The service
--     parses the YAML; the database refuses anything that did not parse into this shape.
--     `skills.scope` is authoritative for resolution; a version's declared `scope` is what the
--     author wrote, checked against the row by BF.1 on publish.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   * **Usage statistics.** *61% of runs*, *every run* and *used 48×* are derived from #406's
--     injection records, which count what context assembly actually injected. There is no
--     usage count or percentage column on either table, and constraints.sql asserts that
--     none appears: a denormalised counter would be the first thing to drift.
--   * **`organization_id` on `skill_versions`.** `V029`'s argument: a version is a fact about
--     a skill, and the one cascading foreign key is the whole of its tenancy.
--   * **A foreign key for `repo_ref`.** `V067`'s choice: a repository is named
--     source-agnostically, and removing a GitHub mirror row must not delete the knowledge a
--     team wrote about the repository.

-- ---------------------------------------------------------------------------
-- The frontmatter's shape
-- ---------------------------------------------------------------------------
create function ouroboros.skill_frontmatter_typed(fm jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
  prov jsonb;
begin
  -- Written as a sequence of early returns rather than one boolean expression, because SQL
  -- does not promise to evaluate `and` left to right, and jsonb_object_keys raises on a
  -- non-object rather than answering false.
  if fm is null or jsonb_typeof(fm) <> 'object' then
    return false;
  end if;

  -- A closed set of keys. An unknown key is a typo or a field nothing reads.
  if exists (select 1 from jsonb_object_keys(fm) as k
              where k not in ('name', 'description', 'scope', 'triggers', 'load', 'provenance'))
  then
    return false;
  end if;

  -- name and description: non-blank strings.
  if fm ? 'name'
     and (jsonb_typeof(fm -> 'name') <> 'string' or btrim(fm ->> 'name') = '') then
    return false;
  end if;
  if fm ? 'description'
     and (jsonb_typeof(fm -> 'description') <> 'string' or btrim(fm ->> 'description') = '') then
    return false;
  end if;

  -- The declared scope: the same vocabulary as skills.scope.
  if fm ? 'scope'
     and (jsonb_typeof(fm -> 'scope') <> 'string'
          or fm ->> 'scope' not in ('org', 'repo', 'workflow')) then
    return false;
  end if;

  -- Triggers: one to thirty-two non-blank strings.
  if fm ? 'triggers' then
    if jsonb_typeof(fm -> 'triggers') <> 'array'
       or jsonb_array_length(fm -> 'triggers') not between 1 and 32
       or exists (select 1 from jsonb_array_elements(fm -> 'triggers') as t
                   where jsonb_typeof(t) <> 'string' or btrim(t #>> '{}') = '') then
      return false;
    end if;
  end if;

  -- The load hint: always injected, or injected when a trigger matches — which needs one.
  if fm ? 'load' then
    if jsonb_typeof(fm -> 'load') <> 'string'
       or fm ->> 'load' not in ('always', 'on_trigger') then
      return false;
    end if;
    if fm ->> 'load' = 'on_trigger' and not fm ? 'triggers' then
      return false;
    end if;
  end if;

  -- Import provenance: the rules file, and optionally the heading it was split from.
  if fm ? 'provenance' then
    prov := fm -> 'provenance';
    if jsonb_typeof(prov) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(prov) as k where k not in ('source', 'section'))
    then
      return false;
    end if;
    if jsonb_typeof(prov -> 'source') is distinct from 'string'
       or btrim(prov ->> 'source') = '' then
      return false;
    end if;
    if prov ? 'section'
       and (jsonb_typeof(prov -> 'section') <> 'string' or btrim(prov ->> 'section') = '') then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function ouroboros.skill_frontmatter_typed(jsonb) is
  'True when a skill version''s frontmatter is the typed document BE.1 (#405) stores: a jsonb object whose keys are drawn from name, description (non-blank strings), scope (org|repo|workflow), triggers (1–32 non-blank strings), load (always|on_trigger — on_trigger requires triggers) and provenance ({source, section?}, non-blank strings — where an imported skill came from). Anything else is refused: the service parses the YAML, and the database refuses what did not parse into this shape.';

-- ---------------------------------------------------------------------------
-- workflows gains the key a composite foreign key needs
-- ---------------------------------------------------------------------------
alter table ouroboros.workflows
  add constraint workflows_id_organization_key unique (id, organization_id);

comment on constraint workflows_id_organization_key on ouroboros.workflows is
  'Redundant as a uniqueness rule — id is the primary key — and present for the composite foreign keys that must name a workflow of the same workspace: skills_workflow_fk (#405) first.';

-- ---------------------------------------------------------------------------
-- skills
-- ---------------------------------------------------------------------------
create table ouroboros.skills (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a skill is that workspace's, and takes its versions with it.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- `zephyr-conventions`, `hil-safety`, `repo-map`. The shape of `workflows.slug` (V029).
  slug            text        not null,

  -- The table's first cell: the name, and the line beneath it.
  name            text        not null,
  description     text        not null,

  -- org | repo | workflow, and the referent that scope needs (skills_scope_referent).
  scope           text        not null,
  repo_ref        ouroboros.repo_ref,
  workflow_id     uuid,

  -- The switch. A required skill is always on (skills_required_enabled).
  enabled         boolean     not null default true,

  -- The locked switch — hil-safety.
  required        boolean     not null default false,

  -- Never injected. Enforced in context assembly; see the header.
  draft           boolean     not null default false,

  -- authored | imported | generated (repo-map, rebuilt by #415).
  origin          text        not null default 'authored',

  -- The published version in force — the `v12` of `v12 · 2d ago`. Null until one is published.
  -- Held to a real published version of this skill by skills_current_version_fk.
  current_version integer,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint skills_organization_slug_key unique (organization_id, slug),

  constraint skills_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),

  constraint skills_name_present
    check (btrim(name) <> '' and length(name) <= 120),

  constraint skills_description_present
    check (btrim(description) <> '' and length(description) <= 300),

  constraint skills_scope_valid
    check (scope in ('org', 'repo', 'workflow')),

  -- The referent columns agree with scope: exactly the one the scope names, and no other.
  constraint skills_scope_referent
    check (case scope
             when 'org'      then repo_ref is null and workflow_id is null
             when 'repo'     then repo_ref is not null and workflow_id is null
             when 'workflow' then workflow_id is not null and repo_ref is null
           end),

  -- The lock as an invariant: a required skill cannot be switched off.
  constraint skills_required_enabled
    check (not (required and not enabled)),

  -- A required skill is always injected and a draft never is; one row cannot be both.
  constraint skills_required_not_draft
    check (not (required and draft)),

  constraint skills_origin_valid
    check (origin in ('authored', 'imported', 'generated')),

  constraint skills_current_version_positive
    check (current_version is null or current_version >= 1),

  -- A workflow of this workspace. MATCH SIMPLE: a null workflow_id is not checked.
  constraint skills_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade
);

comment on table ouroboros.skills is
  'The knowledge domain''s skill registry (#405, BE.1, decision K1) — mockup 14''s skills card. Scoped org|repo|workflow with the referent stored, switched by enabled, locked by required, held out of context assembly by draft, and pointed at the published skill_versions row in force. Usage (61% of runs) is derived from #406''s injection records and deliberately not stored.';
comment on column ouroboros.skills.organization_id is
  'The workspace. ON DELETE CASCADE — a skill belongs to it, and the version history cascades from the skill in turn.';
comment on column ouroboros.skills.slug is
  'zephyr-conventions, hil-safety, repo-map: lower-case kebab, at most 64 characters, unique per workspace (skills_organization_slug_key).';
comment on column ouroboros.skills.name is
  'The human title — the first line of the table''s first cell.';
comment on column ouroboros.skills.description is
  'The line beneath the name — "Hardware-in-loop interlocks before any motor spins".';
comment on column ouroboros.skills.scope is
  'org | repo | workflow — where the skill applies. Closest scope wins on conflict (decision K8), resolved by the assembly service; the referent that scope needs is repo_ref or workflow_id (skills_scope_referent).';
comment on column ouroboros.skills.repo_ref is
  'The repository a repo-scoped skill applies to, as owner/name (V067''s domain). Set exactly when scope = repo. A label rather than a foreign key, so removing a mirror row does not delete what a team wrote.';
comment on column ouroboros.skills.workflow_id is
  'The workflow a workflow-scoped skill applies to — a workflow of the same workspace (skills_workflow_fk), ON DELETE CASCADE. Set exactly when scope = workflow.';
comment on column ouroboros.skills.enabled is
  'The switch. May not be false while required is true (skills_required_enabled).';
comment on column ouroboros.skills.required is
  'The locked switch — hil-safety''s "required — cannot disable". The database refuses required AND NOT enabled, the service refuses the write with a designed 403, and the UI locks the switch: three layers, of which the UI is the last.';
comment on column ouroboros.skills.draft is
  'A draft skill is never injected — context assembly excludes it whatever enabled says. Every row #413''s import creates is a draft, which is what makes that import safe. The skill''s lifecycle, distinct from a draft version (skill_versions.version null).';
comment on column ouroboros.skills.origin is
  'authored (a person) | imported (a rules file; the version''s frontmatter carries provenance) | generated (repo-map, decision K2 — rebuilt nightly by the #415 job, which overwrites hand edits).';
comment on column ouroboros.skills.current_version is
  'Which published version is in force — the v12 of "v12 · 2d ago". A pointer, not a cache of max(version), as workflows.current_version is. Null until a version is published. Held to a published version of this skill by skills_current_version_fk.';
comment on constraint skills_scope_referent on ouroboros.skills is
  'A skill''s scope and its referent agree (#405): org has neither, repo has repo_ref and no workflow, workflow has workflow_id and no repo. A repo-scoped skill cannot exist without its repository.';
comment on constraint skills_required_enabled on ouroboros.skills is
  'NOT (required AND NOT enabled) — the lock as a database invariant (#405), so a required skill such as hil-safety is not one API call from being off.';
comment on constraint skills_required_not_draft on ouroboros.skills is
  'A required skill is always injected and a draft is never injected (#405); a row that claimed both would be a contradiction assembly would have to break.';
comment on constraint skills_workflow_fk on ouroboros.skills is
  'A workflow-scoped skill names a workflow of its own workspace (#405). Composite so a cross-tenant pointer is unstorable; ON DELETE CASCADE because a workflow-scoped skill means nothing without its workflow.';

-- ---------------------------------------------------------------------------
-- skill_versions
-- ---------------------------------------------------------------------------
create table ouroboros.skill_versions (
  id           uuid        primary key default gen_random_uuid(),

  -- The skill, and the whole of this row's tenancy. Cascade: a skill takes its history.
  skill_id     uuid        not null
                           references ouroboros.skills (id) on delete cascade,

  -- The version number; null is the draft (V029's model). Dense from 1, never reused.
  version      integer,

  -- The markdown, after the frontmatter.
  body         text        not null,

  -- The frontmatter, parsed and typed (skill_frontmatter_typed).
  frontmatter  jsonb       not null default '{}',

  -- When this became a version; null exactly while version is null.
  published_at timestamptz,

  -- Who published it. Set null when the person is removed — V029's one permitted update.
  published_by text        references ouroboros."user" ("id") on delete set null,

  -- Why this version exists, in the publisher's words.
  change_note  text,

  created_at   timestamptz not null default now(),

  -- The draft's last-edited time; frozen once published.
  updated_at   timestamptz not null default now(),

  constraint skill_versions_skill_version_key unique (skill_id, version),

  constraint skill_versions_version_positive
    check (version is null or version >= 1),

  constraint skill_versions_version_publish_stamp
    check ((version is null) = (published_at is null)),

  constraint skill_versions_draft_unattributed
    check (published_at is not null or (published_by is null and change_note is null)),

  -- A published version says something. A draft may be empty while it is being written.
  constraint skill_versions_published_body_present
    check (version is null or btrim(body) <> ''),

  constraint skill_versions_frontmatter_typed
    check (ouroboros.skill_frontmatter_typed(frontmatter)),

  constraint skill_versions_change_note_present
    check (change_note is null or (btrim(change_note) <> '' and length(change_note) <= 500))
);

comment on table ouroboros.skill_versions is
  'A skill''s version history plus its one mutable draft (#405, BE.1) — V029''s model for workflows, applied to skills. Published rows are immutable (skill_versions_no_update); the draft is the unnumbered row, and publishing gives it the next number.';
comment on column ouroboros.skill_versions.skill_id is
  'The skill this is a version of, and the whole of this row''s tenancy. ON DELETE CASCADE.';
comment on column ouroboros.skill_versions.version is
  'The published version number — dense from 1 (skill_versions_next_version), never reused. NULL is the draft version, at most one per skill (skill_versions_one_draft_idx).';
comment on column ouroboros.skill_versions.body is
  'The skill''s markdown, without its frontmatter. Non-blank once published.';
comment on column ouroboros.skill_versions.frontmatter is
  'The frontmatter, parsed and typed: name, description, scope (declared), triggers, load (always|on_trigger) and import provenance — see skill_frontmatter_typed. Not an opaque blob.';
comment on column ouroboros.skill_versions.published_at is
  'When this row became a version. Null exactly while version is null.';
comment on column ouroboros.skill_versions.published_by is
  'Who published — "user".id, ON DELETE SET NULL. Null for a seed, an import or the #415 generator; set-null, the one update a published row permits, when a person is removed.';
comment on column ouroboros.skill_versions.change_note is
  'Why this version exists. Optional, never blank, and never on a draft.';
comment on column ouroboros.skill_versions.updated_at is
  'The draft''s last-edited time. Frozen once published: the touch trigger fires only for drafts.';
comment on constraint skill_versions_frontmatter_typed on ouroboros.skill_versions is
  'The frontmatter is the typed document skill_frontmatter_typed describes (#405) — parsed, with a closed set of typed keys, rather than an opaque blob.';

create unique index skill_versions_one_draft_idx
  on ouroboros.skill_versions (skill_id)
  where version is null;

comment on index ouroboros.skill_versions_one_draft_idx is
  'At most one draft version per skill (#405), and the index the editor opens it through — V029''s workflow_versions_one_draft_idx.';

-- ---------------------------------------------------------------------------
-- Versions are dense from 1 — V029's workflow_version_next, for skills.
-- ---------------------------------------------------------------------------
create function ouroboros.skill_version_next() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  -- A draft carries no number.
  if new.version is null then
    return new;
  end if;

  -- An update that leaves the number alone (the publisher set-null) is not a publish.
  if tg_op = 'UPDATE' and new.version is not distinct from old.version then
    return new;
  end if;

  -- Below 1 is skill_versions_version_positive's complaint, not this one's.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.skill_versions
   where skill_id = new.skill_id;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next version of skill % is v%, not v% (highest published: %)',
      new.skill_id, coalesce(highest, 0) + 1, new.version, coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.skill_version_next() is
  'BEFORE INSERT OR UPDATE trigger for skill_versions (#405): a published version must be exactly one above the highest that skill has, and the first is 1. Refuses rather than assigns, as V029 does — two publishers racing both compute max + 1 and the unique key lets one commit. Raises class 23 naming the trigger (skill_versions_next_version).';

create trigger skill_versions_next_version
  before insert or update on ouroboros.skill_versions
  for each row execute function ouroboros.skill_version_next();

-- ---------------------------------------------------------------------------
-- Immutable once published — V029's workflow_versions_refuse_update, for skills.
-- ---------------------------------------------------------------------------
create function ouroboros.skill_versions_refuse_update() returns trigger
language plpgsql as $$
begin
  -- The draft is the mutable row, and promoting it is the publish itself.
  if old.version is null then
    return new;
  end if;

  -- The published_by foreign key's own ON DELETE SET NULL, with nothing else moving.
  if new.published_by is null and old.published_by is not null
     and row(new.id, new.skill_id, new.version, new.body, new.frontmatter,
             new.published_at, new.change_note, new.created_at, new.updated_at)
         is not distinct from
         row(old.id, old.skill_id, old.version, old.body, old.frontmatter,
             old.published_at, old.change_note, old.created_at, old.updated_at)
  then
    return new;
  end if;

  raise exception
    'ouroboros.skill_versions is immutable once published: v% cannot be revised', old.version
    using errcode = 'restrict_violation',
          detail  = format('refused update of version %s of skill %s (row %s)',
                           old.version, old.skill_id, old.id),
          hint    = 'Edit the draft and publish the next version instead. See V069__skills_versions.sql (#405).';
end;
$$;

comment on function ouroboros.skill_versions_refuse_update() is
  'Refuses every UPDATE of a published skill version (#405), for every role including the owner — V029''s rule and V022''s argument. Two updates pass: any edit of the draft, and the published_by foreign key''s own ON DELETE SET NULL.';

create trigger skill_versions_no_update
  before update on ouroboros.skill_versions
  for each row execute function ouroboros.skill_versions_refuse_update();

comment on trigger skill_versions_no_update on ouroboros.skill_versions is
  'A published skill version cannot be revised (#405). No delete counterpart, for V029''s reason: skill_id cascades, and what cannot be deleted is the version in force, which skills_current_version_fk refuses.';

-- ---------------------------------------------------------------------------
-- Touch triggers — the skill always, a version only while it is the draft.
-- ---------------------------------------------------------------------------
create trigger skills_touch_updated_at
  before update on ouroboros.skills
  for each row execute function ouroboros.touch_updated_at();

create trigger skill_versions_touch_updated_at
  before update on ouroboros.skill_versions
  for each row when (old.version is null)
  execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The pointer's key — V029's workflows_current_version_fk, for skills.
-- ---------------------------------------------------------------------------
alter table ouroboros.skills
  add constraint skills_current_version_fk
  foreign key (id, current_version)
  references ouroboros.skill_versions (skill_id, version);

comment on constraint skills_current_version_fk on ouroboros.skills is
  'current_version names a published version of this skill (#405), or nothing. Composite, so another skill''s version number or an unpublished one is unstorable; NO ACTION so deleting a skill takes its versions and its pointer in one statement.';

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update, delete on ouroboros.skills to ouroboros_app;
grant select, insert, update on ouroboros.skill_versions to ouroboros_app;
revoke delete on ouroboros.skill_versions from public;
