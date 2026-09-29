-- V068__workflow_templates.sql — `workflow_templates`: the onboarding tiles as product data,
-- and the provenance a workflow instantiated from one records (#381, BA.2).
--
-- Mockup 13's step 3 draws four tiles — **Quick fixes**, **Feature builder**, **Docs & chores**
-- and a dimmed **Deep refactor** — under the footer *"All templates are editable later in the
-- Workflow Studio — visually or as code."* Decision **O4** makes that footer true: each tile is
-- a registry row whose `definition` is a real WF-P.2 (#133) DSL document, and choosing one
-- instantiates a real workflow. This migration is that registry's data layer, delivering the
-- data half of WF-T.5 (#159). BB.3 (#386) renders it and BA.4 (#383) instantiates from it.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **Versioned, and a version never changes.** Instantiation copies a version's definition
--     into the new workflow's own `workflow_versions` row and records the slug and version it
--     came from. A template row is immutable (`workflow_templates_immutable`), and publishing a
--     change is a new row one version above the last (`workflow_templates_next_version`).
--     A shipped template improving later therefore cannot change a workflow somebody already
--     instantiated and edited — there is nothing linking the two but the provenance label.
--
--   * **Global rows ship with the product; an org row shadows them.** `organization_id` null
--     is a product template. An organization's own row with the same slug replaces the global
--     one on that organization's onboarding screen — `workflow_templates_for(org)` is the one
--     place that resolution is written. Versions are numbered per (organization, slug), so an
--     org override starts its own history at v1.
--
--   * **The lock computes.** `unlock_rule` is `{"merged_loops_gte": 10}`, not a caption.
--     `workflow_template_unlocked(rule, merged, override)` evaluates it against a merged-loop
--     count (`merged_loop_count(org)` reads it off the runs read-model), and the override is
--     how an operator's configured threshold replaces the shipped one without a new version.
--     Starter tiles carry no rule; an advanced tile must carry one.
--
--   * **Captions are qualitative (decision O8).** The mockup's *"92% of teams start here"* is a
--     cross-tenant statistic that does not exist. `workflow_templates_caption_qualitative`
--     refuses any digit or percent sign in a caption, so a fabricated number cannot be shipped.
--
--   * **The grammar is not a CHECK.** As with `workflow_versions.definition` (V029), the
--     definition is CHECKed to be a jsonb object and nothing more: the DSL has one owner, the
--     published JSON Schema. ci/db validates every shipped template against it through
--     `tests/lib/seeded-definitions.sql` and `scripts/workflow-dsl-drift.mjs` (#137's pattern),
--     and ouroboros-rest's `dsl.templates.spec.ts` runs the full P.2 validator over the
--     documents below.
--
-- ---------------------------------------------------------------------------
-- The human gate and the cheap lane, in DSL v1
-- ---------------------------------------------------------------------------
--
-- *"Plans bigger changes, asks before merging"* is feature-builder's `ask-you` node: a `term`
-- stage whose action is `needs_review`, which is DSL v1's human gate (WF-T.6 routes it to the
-- Needs-you inbox). v1 has no mid-graph pause, so the gate sits at the merge — which is
-- exactly what the caption promises. Its `stage_dots` still read as the mockup draws them;
-- they are the tile's display sequence, not a second copy of the graph.
--
-- *"Docs, typos, dep bumps on your cheapest model"* is docs-chores routing every model stage
-- through `inherit_task: "docs"` — the task kind whose route is the workspace's cheap lane — and
-- a trigger bounded to XS–S tickets.
--
-- ---------------------------------------------------------------------------
-- Why the provenance on `workflows` is not a foreign key
-- ---------------------------------------------------------------------------
--
-- `workflows.template_slug` and `template_version` are a label, as `runs.workflow_tag` is
-- (decision F8): a template row may belong to the workflow's organization or be global, so a
-- key would need the resolution rule inside it, and an organization deleting its override must
-- not rewrite or refuse the history of workflows made from it. The pair is both-or-neither and
-- well-formed, and that is all.

-- ---------------------------------------------------------------------------
-- workflow_templates
-- ---------------------------------------------------------------------------
create table ouroboros.workflow_templates (
  id              uuid        primary key default gen_random_uuid(),

  -- Null is a global, product-shipped template. An organization's row shadows the global row
  -- of the same slug for that organization, and goes with the organization.
  organization_id text        references ouroboros.organization ("id") on delete cascade,

  -- `quick-fixes`, `feature-builder`, `docs-chores`, `deep-refactor`. The shape of
  -- `workflows.slug` (V029), since instantiation usually carries it across.
  slug            text        not null,

  -- Monotonic per (organization, slug), dense from 1.
  version         integer     not null,

  -- The tile's headline and subline.
  name            text        not null,
  description     text        not null,

  -- The displayed stage sequence, as the tile draws it: ["analyze", "plan", "code", ...].
  stage_dots      jsonb       not null,

  -- The effort chips, in the V009 vocabulary: {xs, s, m}.
  effort_range    text[]      not null,

  -- The tile's footnote. Qualitative only (O8).
  caption         text,

  -- A WF-P.2 (#133) DSL document. Validated against the schema in ci, not here.
  definition      jsonb       not null,

  -- `starter` tiles are open; `advanced` tiles are gated by `unlock_rule`.
  tier            text        not null,

  -- `{"merged_loops_gte": N}` for an advanced tile, null for a starter one.
  unlock_rule     jsonb,

  -- Tile order on the grid.
  sort_order      integer     not null,

  created_at      timestamptz not null default now(),

  constraint workflow_templates_org_slug_version_key
    unique nulls not distinct (organization_id, slug, version),

  constraint workflow_templates_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),

  constraint workflow_templates_version_positive
    check (version >= 1),

  constraint workflow_templates_name_present
    check (btrim(name) <> '' and length(name) <= 80),

  constraint workflow_templates_description_present
    check (btrim(description) <> '' and length(description) <= 200),

  -- A non-empty array of non-empty strings, at most twelve dots.
  constraint workflow_templates_stage_dots_shape
    check (jsonb_typeof(stage_dots) = 'array'
           and jsonb_array_length(stage_dots) between 1 and 12
           and not jsonb_path_exists(stage_dots, '$[*] ? (@.type() != "string" || @ == "")')),

  -- One to five chips from the effort vocabulary, no nulls.
  constraint workflow_templates_effort_range_vocabulary
    check (cardinality(effort_range) between 1 and 5
           and array_position(effort_range, null) is null
           and effort_range <@ array['xs', 's', 'm', 'l', 'xl']),

  -- O8: no digit and no percent sign, so no invented statistic.
  constraint workflow_templates_caption_qualitative
    check (caption is null
           or (btrim(caption) <> '' and length(caption) <= 120 and caption !~ '[0-9%]')),

  constraint workflow_templates_definition_object
    check (jsonb_typeof(definition) = 'object'),

  constraint workflow_templates_tier
    check (tier in ('starter', 'advanced')),

  -- An advanced tile is gated and a starter tile is not.
  constraint workflow_templates_tier_unlock_rule
    check ((tier = 'advanced') = (unlock_rule is not null)),

  -- The one rule kind: exactly `merged_loops_gte`, a whole number of at least 1.
  constraint workflow_templates_unlock_rule_shape
    -- A CASE rather than AND, so the key and cast are only evaluated on an object holding a number.
    check (case
             when unlock_rule is null then true
             when jsonb_typeof(unlock_rule) <> 'object' then false
             when unlock_rule - 'merged_loops_gte' <> '{}'::jsonb then false
             when jsonb_typeof(unlock_rule -> 'merged_loops_gte') is distinct from 'number' then false
             else (unlock_rule ->> 'merged_loops_gte')::numeric >= 1
                  and (unlock_rule ->> 'merged_loops_gte')::numeric
                      = trunc((unlock_rule ->> 'merged_loops_gte')::numeric)
           end),

  constraint workflow_templates_sort_order_positive
    check (sort_order >= 1)
);

comment on table ouroboros.workflow_templates is
  'The onboarding tiles as product data (#381, decision O4). Global rows (organization_id null) ship with the product; an organization row of the same slug shadows the global one — resolve with workflow_templates_for(org). Rows are immutable: a change is a new version, and instantiation copies a version, so a template update never changes an existing workflow.';
comment on column ouroboros.workflow_templates.organization_id is
  'Null for a global, product-shipped template; otherwise the organization whose onboarding this row overrides.';
comment on column ouroboros.workflow_templates.slug is
  'quick-fixes, feature-builder, docs-chores, deep-refactor. Unique per organization and version.';
comment on column ouroboros.workflow_templates.version is
  'Dense and monotonic per (organization, slug), from 1. Recorded on a workflow instantiated from it as workflows.template_version.';
comment on column ouroboros.workflow_templates.stage_dots is
  'The tile''s displayed stage sequence, a jsonb array of strings. Display data, not the graph.';
comment on column ouroboros.workflow_templates.effort_range is
  'The tile''s effort chips, in the xs|s|m|l|xl vocabulary.';
comment on column ouroboros.workflow_templates.caption is
  'The tile''s qualitative footnote. Refuses digits and percent signs: no fabricated statistics (decision O8).';
comment on column ouroboros.workflow_templates.definition is
  'A WF-P.2 (#133) DSL document. CHECKed to be a jsonb object only; ci validates every shipped definition against schemas/workflow-dsl/v1.json.';
comment on column ouroboros.workflow_templates.tier is
  'starter (always offered) or advanced (gated by unlock_rule).';
comment on column ouroboros.workflow_templates.unlock_rule is
  '{"merged_loops_gte": N} on an advanced template, null on a starter one. Evaluate with workflow_template_unlocked(rule, merged_loop_count(org), configured_override).';

-- A template version is never revised: a change is the next version.
create function ouroboros.workflow_templates_refuse_update() returns trigger
language plpgsql as $$
begin
  raise exception
    'ouroboros.workflow_templates is immutable: %@v% cannot be revised',
    old.slug, old.version
    using errcode = 'restrict_violation',
          hint    = 'Insert the next version instead. See V068__workflow_templates.sql (#381).';
end;
$$;

comment on function ouroboros.workflow_templates_refuse_update() is
  'BEFORE UPDATE trigger for workflow_templates (#381): every update is refused, so an instantiated version can be relied on never to change.';

create trigger workflow_templates_immutable
  before update on ouroboros.workflow_templates
  for each row execute function ouroboros.workflow_templates_refuse_update();

-- A new version is exactly one above the highest of the same (organization, slug).
create function ouroboros.workflow_templates_version_next() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  -- Below 1 is workflow_templates_version_positive's complaint, not this one's.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.workflow_templates
   where organization_id is not distinct from new.organization_id
     and slug = new.slug;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next version of template % is v%, not v% (highest: %)',
      new.slug, coalesce(highest, 0) + 1, new.version, coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.workflow_templates_version_next() is
  'BEFORE INSERT trigger for workflow_templates (#381): a version must be exactly one above the highest for its (organization, slug), and the first is 1. Two racing publishers are settled by workflow_templates_org_slug_version_key.';

create trigger workflow_templates_next_version
  before insert on ouroboros.workflow_templates
  for each row execute function ouroboros.workflow_templates_version_next();

-- ---------------------------------------------------------------------------
-- Resolution: org rows shadow globals, latest version wins
-- ---------------------------------------------------------------------------

-- Returns the templates an organization's onboarding screen offers: for each slug, the
-- organization's own latest version if it has one, otherwise the latest global version.
-- Ordered by sort_order, then slug.
create function ouroboros.workflow_templates_for(p_organization_id text)
returns setof ouroboros.workflow_templates
language sql stable as $$
  select resolved.*
    from (select distinct on (t.slug) t.*
            from ouroboros.workflow_templates t
           where t.organization_id is null
              or t.organization_id = p_organization_id
           order by t.slug, (t.organization_id is null), t.version desc) as resolved
   order by resolved.sort_order, resolved.slug;
$$;

comment on function ouroboros.workflow_templates_for(text) is
  'The templates offered to an organization (#381): per slug, its own latest version if it has one (the override), else the latest global version. Ordered by sort_order, slug.';

-- ---------------------------------------------------------------------------
-- The unlock rule, evaluated
-- ---------------------------------------------------------------------------

-- The threshold in force for a rule: the operator's configured override when given, else the
-- rule's own `merged_loops_gte`. Null when the rule is null (nothing to unlock). An override
-- below 0 is refused; 0 unlocks everything.
create function ouroboros.workflow_template_unlock_threshold(
  p_rule jsonb, p_threshold_override integer default null)
returns integer
language plpgsql immutable as $$
begin
  if p_threshold_override is not null and p_threshold_override < 0 then
    raise exception 'an unlock threshold override cannot be negative (got %)', p_threshold_override
      using errcode = 'invalid_parameter_value';
  end if;

  if p_rule is null then
    return null;
  end if;

  -- A rule not read from the table may not have its shape; refuse it rather than answer null.
  if jsonb_typeof(p_rule) is distinct from 'object'
     or jsonb_typeof(p_rule -> 'merged_loops_gte') is distinct from 'number' then
    raise exception 'an unlock rule is {"merged_loops_gte": N} (got %)', p_rule
      using errcode = 'invalid_parameter_value';
  end if;

  return coalesce(p_threshold_override, (p_rule ->> 'merged_loops_gte')::integer);
end;
$$;

comment on function ouroboros.workflow_template_unlock_threshold(jsonb, integer) is
  'The merged-loop threshold in force for an unlock rule (#381): the configured override if given, else the rule''s merged_loops_gte; null for a null rule. Refuses a negative override. Drives the tile''s "3 of 10 merged loops".';

-- Whether a template is unlocked, given the organization's merged-loop count and the
-- operator's configured override (null for none). A null rule — a starter tile — is always
-- unlocked.
create function ouroboros.workflow_template_unlocked(
  p_rule jsonb, p_merged_loops bigint, p_threshold_override integer default null)
returns boolean
language sql immutable as $$
  select case
           when p_rule is null then true
           else coalesce(p_merged_loops, 0)
                >= ouroboros.workflow_template_unlock_threshold(p_rule, p_threshold_override)
         end;
$$;

comment on function ouroboros.workflow_template_unlocked(jsonb, bigint, integer) is
  'Evaluates an unlock rule (#381): true when the rule is null, else merged_loops >= the threshold in force (the configured override, or the rule''s merged_loops_gte).';

-- The organization's merged loops, off the runs read-model (V008): runs whose status is
-- `merged`. Served by runs_organization_status_idx.
create function ouroboros.merged_loop_count(p_organization_id text)
returns bigint
language sql stable as $$
  select count(*)
    from ouroboros.runs
   where organization_id = p_organization_id
     and status = 'merged';
$$;

comment on function ouroboros.merged_loop_count(text) is
  'The number of merged runs an organization has (#381) — the count an unlock rule is evaluated against.';

-- ---------------------------------------------------------------------------
-- workflows: instantiation provenance
-- ---------------------------------------------------------------------------
alter table ouroboros.workflows
  add column template_slug    text,
  add column template_version integer,
  add constraint workflows_template_provenance_pair
    check ((template_slug is null) = (template_version is null)),
  add constraint workflows_template_slug_format
    check (template_slug is null
           or (template_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(template_slug) <= 64)),
  add constraint workflows_template_version_positive
    check (template_version is null or template_version >= 1);

comment on column ouroboros.workflows.template_slug is
  'The template this workflow was instantiated from (#381), e.g. quick-fixes. Null for a workflow made from scratch. A label, not a foreign key (see V068).';
comment on column ouroboros.workflows.template_version is
  'The template version copied at instantiation (#381) — the 3 of quick-fixes@v3. Set with template_slug or not at all.';

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.workflow_templates to ouroboros_app;
revoke update, delete on ouroboros.workflow_templates from public;

-- ---------------------------------------------------------------------------
-- The four shipped templates, v1
-- ---------------------------------------------------------------------------
insert into ouroboros.workflow_templates
    (slug, version, name, description, stage_dots, effort_range, caption, definition, tier,
     unlock_rule, sort_order)
values
  -- Quick fixes: small bugs and cleanups, merged without a person once checks are green.
  ('quick-fixes', 1, 'Quick fixes', 'Small bugs and cleanups, fully hands-off.',
   '["analyze", "plan", "code", "build", "test", "PR"]',
   array['xs', 's', 'm'],
   'recommended first workflow',
   $quick_fixes_v1$
   {
     "dsl_version": "1.0",
     "trigger": { "event": "ticket_queued", "conditions": { "effort_lte": "m" } },
     "nodes": [
       {
         "id": "issue-queued", "type": "trigger", "title": "Issue queued",
         "description": "Runs when an issue of size M or smaller reaches the queue.",
         "position": { "x": 24, "y": 40 }, "config": {}
       },
       {
         "id": "analyze", "type": "llm", "title": "Analyze",
         "description": "Reads the issue and maps the code paths it touches.",
         "position": { "x": 306, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Read this issue and map the code paths it affects.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "analyze" },
           "limits": { "max_retries": 1, "token_budget": 100000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "plan", "type": "llm", "title": "Plan",
         "description": "Breaks the fix into small steps.",
         "position": { "x": 588, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Plan the smallest change that fixes this issue.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "plan" },
           "limits": { "max_retries": 1, "token_budget": 100000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "code", "type": "llm", "title": "Code",
         "description": "Writes the change and its tests.",
         "position": { "x": 870, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Implement the plan, with tests.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "implement" },
           "limits": { "max_retries": 3, "token_budget": 300000 },
           "permissions": { "push_fixup": true, "touch_ci": false }
         }
       },
       {
         "id": "build", "type": "infra", "title": "Build",
         "description": "Builds the repository on the default pool.",
         "position": { "x": 870, "y": 230 }, "config": {}
       },
       {
         "id": "test", "type": "infra", "title": "Test",
         "description": "Runs the repository's test suite.",
         "position": { "x": 588, "y": 230 }, "config": {}
       },
       {
         "id": "open-pr", "type": "term", "title": "Open PR & auto-merge",
         "description": "Opens the pull request and merges it once the required checks are green.",
         "position": { "x": 306, "y": 230 },
         "config": { "action": "open_pr_automerge", "options": { "merge_method": "squash", "delete_branch": true } }
       }
     ],
     "edges": [
       { "from": "issue-queued", "to": "analyze", "kind": "default" },
       { "from": "analyze", "to": "plan", "kind": "default" },
       { "from": "plan", "to": "code", "kind": "default" },
       { "from": "code", "to": "build", "kind": "default" },
       { "from": "build", "to": "test", "kind": "default" },
       { "from": "test", "to": "open-pr", "kind": "default" }
     ]
   }
   $quick_fixes_v1$::jsonb,
   'starter', null, 1),

  -- Feature builder: plans bigger changes and ends at the human gate instead of merging.
  ('feature-builder', 1, 'Feature builder', 'Plans bigger changes, asks before merging.',
   '["analyze", "plan", "ask you", "code", "build", "test", "PR"]',
   array['m', 'l'],
   'best for new capabilities that touch several files',
   $feature_builder_v1$
   {
     "dsl_version": "1.0",
     "trigger": { "event": "ticket_queued", "conditions": { "effort_lte": "l" } },
     "nodes": [
       {
         "id": "issue-queued", "type": "trigger", "title": "Issue queued",
         "description": "Runs when a feature issue reaches the queue.",
         "position": { "x": 24, "y": 40 }, "config": {}
       },
       {
         "id": "analyze", "type": "llm", "title": "Analyze",
         "description": "Reads the issue and maps every area the feature touches.",
         "position": { "x": 306, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Read this feature request and map the code it affects.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "analyze" },
           "limits": { "max_retries": 1, "token_budget": 200000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "plan", "type": "llm", "title": "Plan",
         "description": "Decomposes the feature into ordered steps.",
         "position": { "x": 588, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Decompose this feature into ordered implementation steps.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "plan" },
           "limits": { "max_retries": 1, "token_budget": 200000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "code", "type": "llm", "title": "Code",
         "description": "Implements the plan, with tests.",
         "position": { "x": 870, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Implement the plan step by step, with tests.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "implement" },
           "limits": { "max_retries": 3, "token_budget": 600000 },
           "permissions": { "push_fixup": true, "touch_ci": false }
         }
       },
       {
         "id": "build", "type": "infra", "title": "Build",
         "description": "Builds the repository on the default pool.",
         "position": { "x": 870, "y": 230 }, "config": {}
       },
       {
         "id": "test", "type": "infra", "title": "Test",
         "description": "Runs the repository's test suite.",
         "position": { "x": 588, "y": 230 }, "config": {}
       },
       {
         "id": "ask-you", "type": "term", "title": "Ask you",
         "description": "The human gate: opens the pull request and waits in the Needs-you inbox. Nothing merges until you say so.",
         "position": { "x": 306, "y": 230 },
         "config": { "action": "needs_review", "options": {} }
       }
     ],
     "edges": [
       { "from": "issue-queued", "to": "analyze", "kind": "default" },
       { "from": "analyze", "to": "plan", "kind": "default" },
       { "from": "plan", "to": "code", "kind": "default" },
       { "from": "code", "to": "build", "kind": "default" },
       { "from": "build", "to": "test", "kind": "default" },
       { "from": "test", "to": "ask-you", "kind": "default" }
     ]
   }
   $feature_builder_v1$::jsonb,
   'starter', null, 2),

  -- Docs & chores: every model stage on the docs task kind, the workspace's cheap lane.
  ('docs-chores', 1, 'Docs & chores', 'Docs, typos, dep bumps on your cheapest model.',
   '["analyze", "code", "check", "PR"]',
   array['xs', 's'],
   'best for keeping the backlog tidy at near-zero cost',
   $docs_chores_v1$
   {
     "dsl_version": "1.0",
     "trigger": { "event": "ticket_queued", "conditions": { "effort_lte": "s" } },
     "nodes": [
       {
         "id": "issue-queued", "type": "trigger", "title": "Issue queued",
         "description": "Runs when an XS or S chore reaches the queue.",
         "position": { "x": 24, "y": 40 }, "config": {}
       },
       {
         "id": "analyze", "type": "llm", "title": "Analyze",
         "description": "Reads the chore on the cheap lane.",
         "position": { "x": 306, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Read this chore and list the files it needs.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "docs" },
           "limits": { "max_retries": 1, "token_budget": 50000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "code", "type": "llm", "title": "Code",
         "description": "Makes the docs, typo or dependency change on the cheap lane, and nothing beside it.",
         "position": { "x": 588, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Make the change this chore asks for, and nothing else.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "docs" },
           "limits": { "max_retries": 1, "token_budget": 120000 },
           "permissions": { "push_fixup": true, "touch_ci": false }
         }
       },
       {
         "id": "check", "type": "infra", "title": "Check",
         "description": "Runs the repository's checks on the default pool.",
         "position": { "x": 588, "y": 230 }, "config": {}
       },
       {
         "id": "open-pr", "type": "term", "title": "Open PR & auto-merge",
         "description": "Opens the pull request and merges it once the required checks are green.",
         "position": { "x": 306, "y": 230 },
         "config": { "action": "open_pr_automerge", "options": { "merge_method": "squash", "delete_branch": true } }
       }
     ],
     "edges": [
       { "from": "issue-queued", "to": "analyze", "kind": "default" },
       { "from": "analyze", "to": "code", "kind": "default" },
       { "from": "code", "to": "check", "kind": "default" },
       { "from": "check", "to": "open-pr", "kind": "default" }
     ]
   }
   $docs_chores_v1$::jsonb,
   'starter', null, 3),

  -- Deep refactor: advanced, gated on ten merged loops, ends at review.
  ('deep-refactor', 1, 'Deep refactor',
   'Multi-PR restructures with staged rollout and extra review.',
   '["map", "plan", "split", "code ×n", "verify", "PR ×n"]',
   array['l', 'xl'],
   'best once the loop has learned your codebase',
   $deep_refactor_v1$
   {
     "dsl_version": "1.0",
     "trigger": { "event": "ticket_queued", "conditions": {} },
     "nodes": [
       {
         "id": "issue-queued", "type": "trigger", "title": "Issue queued",
         "description": "Runs when a refactor issue reaches the queue.",
         "position": { "x": 24, "y": 40 }, "config": {}
       },
       {
         "id": "map", "type": "llm", "title": "Map",
         "description": "Maps the code the refactor restructures and everything that depends on it.",
         "position": { "x": 306, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Map the code this refactor restructures and its dependents.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "analyze" },
           "limits": { "max_retries": 1, "token_budget": 400000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "plan", "type": "llm", "title": "Plan",
         "description": "Plans a staged rollout.",
         "position": { "x": 588, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Plan this refactor as a staged rollout.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}",
           "routing": { "inherit_task": "plan" },
           "limits": { "max_retries": 1, "token_budget": 400000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "split", "type": "llm", "title": "Split",
         "description": "Splits the plan into independently mergeable pull requests.",
         "position": { "x": 870, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Split the plan into independently mergeable pull requests.\n\nIssue: {{issue.title}}",
           "routing": { "inherit_task": "plan" },
           "limits": { "max_retries": 1, "token_budget": 200000 },
           "permissions": { "push_fixup": false, "touch_ci": false }
         }
       },
       {
         "id": "code", "type": "llm", "title": "Code",
         "description": "Implements each slice, with tests.",
         "position": { "x": 1152, "y": 40 },
         "config": {
           "mode": "prompt",
           "prompt_template": "Implement the next slice of the refactor, with tests.\n\nIssue: {{issue.title}}",
           "routing": { "inherit_task": "implement" },
           "limits": { "max_retries": 3, "token_budget": 800000 },
           "permissions": { "push_fixup": true, "touch_ci": false }
         }
       },
       {
         "id": "verify", "type": "infra", "title": "Verify",
         "description": "Builds and runs the full test suite on the default pool.",
         "position": { "x": 1152, "y": 230 }, "config": {}
       },
       {
         "id": "review", "type": "term", "title": "Open PRs for review",
         "description": "Opens the pull requests for extra review in the Needs-you inbox. Nothing merges on its own.",
         "position": { "x": 870, "y": 230 },
         "config": { "action": "needs_review", "options": {} }
       }
     ],
     "edges": [
       { "from": "issue-queued", "to": "map", "kind": "default" },
       { "from": "map", "to": "plan", "kind": "default" },
       { "from": "plan", "to": "split", "kind": "default" },
       { "from": "split", "to": "code", "kind": "default" },
       { "from": "code", "to": "verify", "kind": "default" },
       { "from": "verify", "to": "review", "kind": "default" }
     ]
   }
   $deep_refactor_v1$::jsonb,
   'advanced', '{"merged_loops_gte": 10}', 4);
