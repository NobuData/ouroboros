-- V106__investigations.sql — the Research domain's root entity: investigations, the kind registry
-- whose playbooks configure them, and the research-tool slugs both are validated against
-- (#608, CK.1).
--
-- Mockup 22 is a page of views over one entity. The composer collects a question, a kind, a
-- depth and a tool selection; the investigations card lists `RS-127 · gap analysis · 44 sources
-- · ✓ brief ready`; the closing line — *"every investigation ends the same way the build loop
-- does"* — is a lifecycle. This migration writes all of that down:
--
--   1. **`research_tools`** — the installation's research-tool slugs (`web`, `competitor`,
--      `code`, `tickets`, `telemetry`, `docs`). The adapters themselves are code — CL.1's
--      `ResearchToolAdapter` SPI (#614) registers them by slug — but "an unknown tool slug is
--      rejected at write" needs a registry the database can see, and this is it: one row per
--      slug an adapter answers to. An adapter joining later is a row, not a migration.
--   2. **`investigation_kinds`** — per workspace, one row per kind (decision V10): its slug,
--      the composer's label, the chip's tint key and a **versioned `playbook`** — the tools it
--      defaults on, the synthesis template it runs, the deliverables it produces. Kinds differ
--      by playbook, never by code path. Every workspace gets the four built-ins
--      (`bug_root_cause`, `regression_forensics`, `roadmap_improvements`, `gap_analysis`) when
--      it is created, and the existing ones get them below.
--   3. **`investigations`** — one row per `RS-###`: kind, question, depth, tools, status,
--      estimate, actuals, provenance, origin, the engine task running it, who started it.
--   4. **`investigation_seq_counters`** — the per-workspace counter `seq` is drawn from.
--
-- ---------------------------------------------------------------------------
-- Why the display id is a counter row and not `max + 1`
-- ---------------------------------------------------------------------------
--
-- `RS-127` is how people refer to an investigation in a PR, in Slack, in a ticket, so it must
-- not skip and must never be handed out twice. V045's `runs.loop_seq` takes an advisory lock
-- and computes `max + 1`, which is right for a caption; here it is not quite enough, because
-- deleting the newest investigation would make `max + 1` hand its number to the next one, and
-- `RS-127` would then name two different things in two different Slack threads.
--
-- So: one counter row per workspace, bumped by `insert … on conflict do update … returning`.
--
--   - **Concurrent creates serialise** on that row's lock — the second waits for the first to
--     commit or roll back and then reads what it left. Workspaces never contend: the row is
--     the workspace's own.
--   - **A rollback leaves no gap.** The bump is part of the creating transaction, so a
--     rolled-back create takes its increment with it and the next create gets the same number.
--   - **A delete leaves its number spent.** The counter only moves forward.
--
-- tests/verify-investigation-seq.sh proves the first two under real concurrency (two sessions,
-- interleaved), and that without the counter row's lock the same race collides.
--
-- An insert that supplies its own `seq` keeps it and moves the counter up to it — CK.6's seed
-- renders mockup 22's `RS-118`…`RS-127`, which the counter could not choose. The unique key
-- still holds, and the next allocated number continues past it.
--
-- ---------------------------------------------------------------------------
-- The lifecycle
-- ---------------------------------------------------------------------------
--
--   queued ──▶ running ──▶ brief_ready ──▶ issues_filed
--     │           │
--     └───────────┴──▶ failed | cancelled
--
-- Enforced on UPDATE by `investigations_status_transition`. `issues_filed`, `failed` and
-- `cancelled` are terminal. An INSERT may land in any status (CK.6's seed inserts finished
-- investigations), but the status-dependent CHECKs below hold for it all the same.
-- *"`brief_ready` requires a brief"* is CK.2's (#609): `briefs` does not exist yet, so the
-- deferred check lands with that table and is proved in its tests.
--
-- Revert forward:
--   drop trigger organization_seed_investigation_kinds on ouroboros.organization;
--   drop table ouroboros.investigations, ouroboros.investigation_seq_counters,
--              ouroboros.investigation_kinds, ouroboros.research_tools;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- research_tools — the slugs a tool selection may name.
-- ---------------------------------------------------------------------------
create table ouroboros.research_tools (
  -- The slug the composer's chips, a kind's default tool set and an investigation's selection
  -- all spell. Lower-case, short, no punctuation but `_` and `-`.
  slug         text        primary key
                           constraint research_tools_slug_format
                             check (slug ~ '^[a-z][a-z0-9_-]{0,31}$'),

  -- The tools card's row title — *Web search & page reader*.
  display_name text        not null
                           constraint research_tools_display_name_present
                             check (btrim(display_name) <> ''),

  created_at   timestamptz not null default now()
);

comment on table ouroboros.research_tools is
  'The research-tool slugs this installation answers to (#608, CK.1) — the registry investigations.tools_enabled and investigation_kinds.playbook default_tools are validated against at write. The adapters are code (CL.1''s ResearchToolAdapter SPI, #614); a row here is what lets the database refuse a slug no adapter has.';
comment on column ouroboros.research_tools.slug is
  'The adapter slug — web, competitor, code, tickets, telemetry, docs.';
comment on column ouroboros.research_tools.display_name is
  'The tools card''s row title, e.g. Web search & page reader.';

-- The six tools of mockup 22's tools card. `docs` is listed even though its adapter is v2
-- (CO.1): the mockup shows it idle with an `enable` button, which is a tool that exists and is
-- not connected — health is the adapter's to report, not this table's.
insert into ouroboros.research_tools (slug, display_name) values
  ('web',        'Web search & page reader'),
  ('competitor', 'Competitor tracker'),
  ('code',       'Codebase & git mining'),
  ('tickets',    'Issue & PR history index'),
  ('telemetry',  'Build & test telemetry'),
  ('docs',       'Docs, standards & papers');

-- ---------------------------------------------------------------------------
-- Shape helpers. Immutable, so the CHECKs below can call them. The ones that expand a jsonb
-- value are plpgsql with early returns: jsonb_object_keys() and jsonb_array_elements() raise on
-- the wrong type, and SQL does not promise to evaluate an `and` left to right — a wrong-typed
-- value must come back `false`, so the CHECK names itself, rather than as an error.
-- ---------------------------------------------------------------------------

-- jsonb_keys_are(value, keys) — whether a jsonb object has exactly the given keys.
--   value — the jsonb value to inspect
--   keys  — the expected keys, in any order
--   returns true when value is an object whose key set equals keys
create function ouroboros.jsonb_keys_are(value jsonb, keys text[])
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(value) is distinct from 'object' then
    return false;
  end if;
  return (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(value) k)
       = (select coalesce(array_agg(k order by k), '{}') from unnest(keys) k);
end;
$$;

comment on function ouroboros.jsonb_keys_are(jsonb, text[]) is
  'True when a jsonb value is an object with exactly the given keys, no more and no fewer (#608).';

-- jsonb_nonneg_int(value) — whether a jsonb value is a non-negative integer.
--   value — the jsonb value to inspect (may be null)
--   returns true for 0, 1, 2, …; false for anything else, null included
create function ouroboros.jsonb_nonneg_int(value jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^[0-9]{1,15}$', false);
$$;

comment on function ouroboros.jsonb_nonneg_int(jsonb) is
  'True when a jsonb value is a non-negative integer (#608). Null and every other type are false.';

-- jsonb_int_range_valid(range) — whether a jsonb value is {min, max} of non-negative integers
-- with min ≤ max.
--   range — the jsonb value to inspect
--   returns true when it is a well-formed range
create function ouroboros.jsonb_int_range_valid(range jsonb)
returns boolean language plpgsql immutable as $$
begin
  if not (ouroboros.jsonb_keys_are(range, array['min', 'max'])
          and ouroboros.jsonb_nonneg_int(range -> 'min')
          and ouroboros.jsonb_nonneg_int(range -> 'max')) then
    return false;
  end if;
  return (range ->> 'min')::bigint <= (range ->> 'max')::bigint;
end;
$$;

comment on function ouroboros.jsonb_int_range_valid(jsonb) is
  'True when a jsonb value is exactly {min, max} of non-negative integers with min <= max (#608).';

-- research_tool_set_valid(tools) — whether `tools` is a JSON array of distinct slug-shaped
-- strings. Whether each slug is *registered* is a table lookup, which a CHECK may not do; that
-- half is research_tool_slugs_unknown() in a trigger.
--   tools — the jsonb value to inspect
--   returns true when it is a well-formed tool set (the empty array included)
create function ouroboros.research_tool_set_valid(tools jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(tools) is distinct from 'array' then
    return false;
  end if;
  return not exists (select 1 from jsonb_array_elements(tools) e
                      where jsonb_typeof(e) <> 'string'
                         or (e #>> '{}') !~ '^[a-z][a-z0-9_-]{0,31}$')
     and (select count(*) = count(distinct e) from jsonb_array_elements(tools) e);
end;
$$;

comment on function ouroboros.research_tool_set_valid(jsonb) is
  'True when the value is a JSON array of distinct slug-shaped strings (#608). Registration is checked separately, by research_tool_slugs_unknown().';

-- research_tool_slugs_unknown(tools) — the slugs in `tools` that research_tools has no row for.
--   tools — a jsonb array of strings (anything else yields no slugs)
--   returns the unknown slugs in array order; empty when every slug is registered
create function ouroboros.research_tool_slugs_unknown(tools jsonb)
returns text[] language sql stable as $$
  select coalesce(array_agg(e.slug order by e.ord), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(tools) = 'array'
                                        then tools else '[]'::jsonb end)
         with ordinality as e(slug, ord)
   where not exists (select 1 from ouroboros.research_tools t where t.slug = e.slug);
$$;

comment on function ouroboros.research_tool_slugs_unknown(jsonb) is
  'The slugs of a jsonb tool set that are not registered in research_tools (#608); empty when all are.';

-- investigation_playbook_valid(playbook) — whether a kind's playbook has exactly the shape the
-- engine reads (decision V10):
--
--   {version: int ≥ 1, default_tools: [slug…], synthesis_template: text,
--    deliverables: [brief | matrix | roadmap_doc | fix_draft …]}
--
-- `deliverables` is distinct and always includes `brief` — every investigation ends in a brief,
-- and the others are what a kind adds to it (V10: brief / brief+matrix / brief+roadmap-doc /
-- brief+fix-draft).
--   playbook — the jsonb value to inspect
--   returns true when it is a well-formed playbook
create function ouroboros.investigation_playbook_valid(playbook jsonb)
returns boolean language plpgsql immutable as $$
begin
  if not (ouroboros.jsonb_keys_are(playbook,
            array['version', 'default_tools', 'synthesis_template', 'deliverables'])
          and jsonb_typeof(playbook -> 'deliverables') = 'array') then
    return false;
  end if;
  return jsonb_typeof(playbook -> 'version') = 'number'
     and (playbook ->> 'version') ~ '^[1-9][0-9]{0,8}$'
     and ouroboros.research_tool_set_valid(playbook -> 'default_tools')
     and jsonb_typeof(playbook -> 'synthesis_template') = 'string'
     and btrim(playbook ->> 'synthesis_template') <> ''
     and playbook -> 'deliverables' ? 'brief'
     and not exists (select 1 from jsonb_array_elements(playbook -> 'deliverables') d
                      where jsonb_typeof(d) <> 'string'
                         or (d #>> '{}') not in ('brief', 'matrix', 'roadmap_doc', 'fix_draft'))
     and (select count(*) = count(distinct d)
            from jsonb_array_elements(playbook -> 'deliverables') d);
end;
$$;

comment on function ouroboros.investigation_playbook_valid(jsonb) is
  'True when a kind playbook is exactly {version ≥ 1, default_tools: slug set, synthesis_template: text, deliverables: distinct subset of brief|matrix|roadmap_doc|fix_draft including brief} (#608, V10).';

-- investigation_estimate_valid(estimate) — {sources: {min, max}, cost_cents: {min, max} | null}.
--   estimate — the jsonb value to inspect
--   returns true when it is a well-formed estimate
create function ouroboros.investigation_estimate_valid(estimate jsonb)
returns boolean language sql immutable as $$
  select ouroboros.jsonb_keys_are(estimate, array['sources', 'cost_cents'])
     and ouroboros.jsonb_int_range_valid(estimate -> 'sources')
     and (jsonb_typeof(estimate -> 'cost_cents') = 'null'
          or ouroboros.jsonb_int_range_valid(estimate -> 'cost_cents'));
$$;

comment on function ouroboros.investigation_estimate_valid(jsonb) is
  'True when an investigation estimate is exactly {sources: {min, max}, cost_cents: {min, max} | null} (#608, V5).';

-- investigation_actuals_valid(actuals) — {sources_used: int, spend_cents: int | null,
-- duration_ms: int}, every integer non-negative.
--   actuals — the jsonb value to inspect
--   returns true when it is well-formed actuals
create function ouroboros.investigation_actuals_valid(actuals jsonb)
returns boolean language sql immutable as $$
  select ouroboros.jsonb_keys_are(actuals, array['sources_used', 'spend_cents', 'duration_ms'])
     and ouroboros.jsonb_nonneg_int(actuals -> 'sources_used')
     and ouroboros.jsonb_nonneg_int(actuals -> 'duration_ms')
     and (jsonb_typeof(actuals -> 'spend_cents') = 'null'
          or ouroboros.jsonb_nonneg_int(actuals -> 'spend_cents'));
$$;

comment on function ouroboros.investigation_actuals_valid(jsonb) is
  'True when investigation actuals are exactly {sources_used, spend_cents | null, duration_ms} of non-negative integers (#608).';

-- investigation_provenance_valid(provenance) — {researcher: text, alias: text,
-- resolution_ref: text | null}, every text non-blank.
--   provenance — the jsonb value to inspect
--   returns true when it is well-formed provenance
create function ouroboros.investigation_provenance_valid(provenance jsonb)
returns boolean language sql immutable as $$
  select ouroboros.jsonb_keys_are(provenance, array['researcher', 'alias', 'resolution_ref'])
     and jsonb_typeof(provenance -> 'researcher') = 'string'
     and btrim(provenance ->> 'researcher') <> ''
     and jsonb_typeof(provenance -> 'alias') = 'string'
     and btrim(provenance ->> 'alias') <> ''
     and (jsonb_typeof(provenance -> 'resolution_ref') = 'null'
          or (jsonb_typeof(provenance -> 'resolution_ref') = 'string'
              and btrim(provenance ->> 'resolution_ref') <> ''));
$$;

comment on function ouroboros.investigation_provenance_valid(jsonb) is
  'True when investigation provenance is exactly {researcher, alias, resolution_ref | null} with non-blank text (#608).';

-- ---------------------------------------------------------------------------
-- investigation_kinds — the kind registry, one playbook per kind per workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_kinds (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a kind is configuration and goes with its workspace.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- `gap_analysis`. Unique per workspace; a format rather than a closed list, because a fifth
  -- kind is a row (V10's "org-extensible later without schema change").
  slug            text        not null
                              constraint investigation_kinds_slug_format
                                check (slug ~ '^[a-z][a-z0-9_]{0,47}$'),

  -- The composer's segmented-control label — *Gap analysis*.
  display_name    text        not null
                              constraint investigation_kinds_display_name_present
                                check (btrim(display_name) <> ''),

  -- The kind chip's hue, mockup 22's `.kind.gap` — `bug`, `reg`, `road`, `gap`. A key the UI
  -- maps to its tokens, never a colour.
  tint_key        text        not null
                              constraint investigation_kinds_tint_key_format
                                check (tint_key ~ '^[a-z][a-z0-9-]{0,31}$'),

  -- The kind's configuration (V10). See investigation_playbook_valid(). Its `version` must rise
  -- whenever the playbook changes — investigation_kinds_playbook_version.
  playbook        jsonb       not null
                              constraint investigation_kinds_playbook_shape
                                check (ouroboros.investigation_playbook_valid(playbook)),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint investigation_kinds_organization_slug_key unique (organization_id, slug),
  -- The target of investigations' composite foreign key: a kind is only ever named by an
  -- investigation of its own workspace.
  constraint investigation_kinds_organization_id_key unique (organization_id, id)
);

comment on table ouroboros.investigation_kinds is
  'Investigation kinds per workspace (#608, CK.1; decision V10): one engine, differing by playbook. The four built-ins are seeded into every workspace by investigation_kinds_seed(); more kinds are rows.';
comment on column ouroboros.investigation_kinds.slug is
  'bug_root_cause | regression_forensics | roadmap_improvements | gap_analysis, or a workspace''s own. Unique per workspace.';
comment on column ouroboros.investigation_kinds.display_name is
  'The composer''s label — Bug root cause, Regression forensics, Roadmap & improvements, Gap analysis.';
comment on column ouroboros.investigation_kinds.tint_key is
  'The kind chip''s hue key (mockup 22 .kind.bug/.reg/.road/.gap). The UI maps it to tokens.';
comment on column ouroboros.investigation_kinds.playbook is
  '{version, default_tools, synthesis_template, deliverables} — what makes this kind differ from the others (V10). default_tools are registered research_tools slugs; version rises with every change.';

-- A playbook change must carry a higher version, so "which playbook did RS-127 run under?" has
-- an answer, and an edit that forgot to bump is refused rather than silently rewriting history.
create function ouroboros.investigation_kinds_playbook_version()
returns trigger language plpgsql as $$
begin
  -- A malformed playbook is investigation_kinds_playbook_shape's to refuse, by name; triggers
  -- run before CHECKs, so reading its version here could raise a cast error instead.
  if not ouroboros.investigation_playbook_valid(new.playbook) then
    return new;
  end if;

  if new.playbook is distinct from old.playbook
     and (new.playbook ->> 'version')::int <= (old.playbook ->> 'version')::int then
    raise exception 'the playbook of investigation kind % changed without its version rising past %',
      old.slug, old.playbook ->> 'version'
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.investigation_kinds_playbook_version() is
  'Refuses a playbook change whose version is not higher than the one it replaces (#608).';

create trigger investigation_kinds_playbook_version
  before update of playbook on ouroboros.investigation_kinds
  for each row execute function ouroboros.investigation_kinds_playbook_version();

create trigger investigation_kinds_touch_updated_at
  before update on ouroboros.investigation_kinds
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- investigation_seq_counters — the per-workspace RS-### counter. See the header.
-- ---------------------------------------------------------------------------
create table ouroboros.investigation_seq_counters (
  organization_id text    primary key
                          references ouroboros.organization ("id") on delete cascade,

  -- The highest `seq` handed out in this workspace. Only ever rises.
  last_seq        integer not null
                          constraint investigation_seq_counters_last_seq_positive
                            check (last_seq >= 1)
);

comment on table ouroboros.investigation_seq_counters is
  'The per-workspace counter investigations.seq is drawn from (#608). One row per workspace that has created an investigation; bumped inside the creating transaction, so concurrent creates serialise on the row, a rollback returns its number, and a deleted investigation''s number is never reused.';
comment on column ouroboros.investigation_seq_counters.last_seq is
  'The highest seq handed out in the workspace — the next allocation is last_seq + 1.';

-- ---------------------------------------------------------------------------
-- investigations — RS-###.
-- ---------------------------------------------------------------------------
create table ouroboros.investigations (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The 127 of RS-127. Allocated by investigations_allocate_seq() when not supplied.
  seq              integer     not null
                               constraint investigations_seq_positive check (seq >= 1),

  -- RS-127, as every surface spells it: zero-padded to three digits, wider when it needs to be.
  display_id       text        generated always as
                                 ('RS-' || case when seq < 1000 then lpad(seq::text, 3, '0')
                                                else seq::text end) stored,

  -- The kind, of this workspace — the composite key below. No action rather than restrict on
  -- delete: a kind with investigations cannot be deleted, but a workspace deletion that
  -- cascades to both is checked at the end of the statement, after both are gone.
  kind_id          uuid        not null,

  -- What the person asked, as they asked it.
  question         text        not null
                               constraint investigations_question_present
                                 check (btrim(question) <> ''),

  -- The composer's Depth menu.
  depth            text        not null
                               constraint investigations_depth
                                 check (depth in ('quick', 'standard', 'deep_dive')),

  -- The tool chips that were on: registered research_tools slugs, at least one — an
  -- investigation with no tool has nothing to cite. Registration is checked at write by
  -- investigations_tools_registered.
  tools_enabled    jsonb       not null
                               constraint investigations_tools_enabled_shape
                                 check (ouroboros.research_tool_set_valid(tools_enabled)
                                        and tools_enabled <> '[]'::jsonb),

  status           text        not null default 'queued'
                               constraint investigations_status
                                 check (status in ('queued', 'running', 'brief_ready',
                                                   'issues_filed', 'failed', 'cancelled')),

  -- The composer's `est. 40–60 sources · ~$6` (V5, #622's output):
  --   {sources: {min, max}, cost_cents: {min, max} | null}
  -- cost_cents is null when the routed alias is unpriced — a source range and no dollar figure,
  -- never a $0. Null as a whole when nothing has been estimated.
  estimate         jsonb
                   constraint investigations_estimate_shape
                     check (estimate is null or ouroboros.investigation_estimate_valid(estimate)),

  -- What it actually used and spent:
  --   {sources_used: int, spend_cents: int | null, duration_ms: int}
  -- spend_cents is null when spend could not be priced. Null as a whole until it has run, and
  -- independent of estimate — an investigation that never ran has an estimate and no actuals.
  actuals          jsonb
                   constraint investigations_actuals_shape
                     check (actuals is null or ouroboros.investigation_actuals_valid(actuals)),

  -- Which researcher ran it, under which alias, through which resolution:
  --   {researcher: 'loop-v1', alias: 'researcher-long-ctx', resolution_ref: text | null}
  provenance       jsonb
                   constraint investigations_provenance_shape
                     check (provenance is null
                            or ouroboros.investigation_provenance_valid(provenance)),

  -- Who opened it: a person (`user`), the regression watch (V6 — the watch chain reads this),
  -- or a schedule (CO.4, #638).
  origin           text        not null default 'user'
                               constraint investigations_origin
                                 check (origin in ('user', 'regression_watch', 'scheduled')),

  -- The engine task running it (#54). Text: the engine's task model is not a table here.
  engine_task_ref  text
                   constraint investigations_engine_task_ref_present
                     check (engine_task_ref is null or btrim(engine_task_ref) <> ''),

  -- Who started it. Null for watch- and schedule-opened investigations, and once the person is
  -- deleted — the investigation outlives them.
  created_by       text        references ouroboros."user" ("id") on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint investigations_organization_seq_key unique (organization_id, seq),
  constraint investigations_kind_fk foreign key (organization_id, kind_id)
    references ouroboros.investigation_kinds (organization_id, id),

  -- A running investigation has resolved its researcher, and a finished one has also measured
  -- what it used: without both, the page's cost honesty (V5) and reproducibility fail.
  constraint investigations_running_provenance
    check (status in ('queued', 'failed', 'cancelled') or provenance is not null),
  constraint investigations_finished_actuals
    check (status not in ('brief_ready', 'issues_filed') or actuals is not null)
);

comment on table ouroboros.investigations is
  'Investigations (#608, CK.1; decision V1) — RS-### per workspace: kind, question, depth, tools, lifecycle, estimate, actuals, provenance and origin. Every card on mockup 22 is a view over these rows.';
comment on column ouroboros.investigations.seq is
  'Per-workspace, gapless, never reused — drawn from investigation_seq_counters by investigations_allocate_seq(). An insert that supplies its own keeps it.';
comment on column ouroboros.investigations.display_id is
  'RS-### — generated from seq, three digits minimum.';
comment on column ouroboros.investigations.kind_id is
  'The investigation_kinds row of the same workspace whose playbook this runs.';
comment on column ouroboros.investigations.depth is
  'quick | standard | deep_dive — the composer''s Depth menu.';
comment on column ouroboros.investigations.tools_enabled is
  'The enabled tool chips — a non-empty set of registered research_tools slugs, checked at write.';
comment on column ouroboros.investigations.status is
  'queued → running → brief_ready → issues_filed, or failed/cancelled from queued or running. Transitions enforced by investigations_status_transition.';
comment on column ouroboros.investigations.estimate is
  '{sources: {min, max}, cost_cents: {min, max} | null} — the composer''s estimate (V5, #622). Null cost is an unpriced alias.';
comment on column ouroboros.investigations.actuals is
  '{sources_used, spend_cents | null, duration_ms} — measured. Null until run; required from brief_ready on.';
comment on column ouroboros.investigations.provenance is
  '{researcher, alias, resolution_ref | null} — which loop version and alias ran it. Required from running on.';
comment on column ouroboros.investigations.origin is
  'user | regression_watch | scheduled — who opened it. The watch chain (V6) depends on telling these apart.';
comment on column ouroboros.investigations.engine_task_ref is
  'The engine task (#54) executing the investigation, or null before it is dispatched.';
comment on column ouroboros.investigations.created_by is
  'The person who started it; null for watch- or schedule-opened investigations and after the person is deleted.';

-- The active list (org + status), the quarter counter (org + created_at), and by kind.
create index investigations_organization_status_idx
  on ouroboros.investigations (organization_id, status);
create index investigations_organization_created_at_idx
  on ouroboros.investigations (organization_id, created_at desc);
create index investigations_kind_idx
  on ouroboros.investigations (kind_id);

-- --- seq allocation ----------------------------------------------------------
--
-- The counter row is the lock: `on conflict do update` takes it, so a second create for the
-- same workspace waits here until the first commits or rolls back, then reads what it left.
--
-- `security definer`, on V046's argument: the counter is a write the caller must not be able to
-- make — an application that could set `last_seq` could hand out a number twice or skip a
-- hundred — so `ouroboros_app` has no grant on the table and this runs as its owner. The
-- search_path is pinned and every name is qualified, and `execute` is revoked from public below:
-- outside the trigger it can only raise.
create function ouroboros.investigations_allocate_seq()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
begin
  if new.seq is null then
    insert into ouroboros.investigation_seq_counters as c (organization_id, last_seq)
    values (new.organization_id, 1)
    on conflict (organization_id) do update set last_seq = c.last_seq + 1
    returning c.last_seq into new.seq;
  else
    -- A supplied number keeps its place, and the counter moves up to it so the next allocation
    -- continues past it rather than colliding with it.
    insert into ouroboros.investigation_seq_counters as c (organization_id, last_seq)
    values (new.organization_id, greatest(new.seq, 1))
    on conflict (organization_id) do update set last_seq = greatest(c.last_seq, excluded.last_seq);
  end if;
  return new;
end;
$$;

comment on function ouroboros.investigations_allocate_seq() is
  'Assigns investigations.seq from the workspace''s investigation_seq_counters row (#608) — serialised on that row, so concurrent creates never collide and a rollback leaves no gap. A supplied seq is kept and raises the counter to it.';

create trigger investigations_allocate_seq
  before insert on ouroboros.investigations
  for each row execute function ouroboros.investigations_allocate_seq();

revoke execute on function ouroboros.investigations_allocate_seq() from public;

-- --- identity and lifecycle on update ----------------------------------------
create function ouroboros.investigations_status_transition()
returns trigger language plpgsql as $$
begin
  if new.organization_id <> old.organization_id or new.seq <> old.seq
     or new.kind_id <> old.kind_id or new.origin <> old.origin then
    raise exception 'investigation % keeps its workspace, number, kind and origin', old.display_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status <> old.status and not (
       (old.status = 'queued'      and new.status in ('running', 'failed', 'cancelled'))
    or (old.status = 'running'     and new.status in ('brief_ready', 'failed', 'cancelled'))
    or (old.status = 'brief_ready' and new.status = 'issues_filed')) then
    raise exception 'investigation % cannot go from % to %', old.display_id, old.status, new.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.investigations_status_transition() is
  'Refuses a status change outside queued → running → brief_ready → issues_filed (with failed/cancelled from queued or running), and any change of workspace, seq, kind or origin (#608).';

create trigger investigations_status_transition
  before update on ouroboros.investigations
  for each row execute function ouroboros.investigations_status_transition();

create trigger investigations_touch_updated_at
  before update on ouroboros.investigations
  for each row execute function ouroboros.touch_updated_at();

-- --- tool slugs are registered -------------------------------------------------
--
-- One function for both tables: it reads `tools_enabled` from an investigation and
-- `playbook.default_tools` from a kind.
create function ouroboros.research_tools_registered()
returns trigger language plpgsql as $$
declare
  tools   jsonb;
  unknown text[];
begin
  tools := case tg_table_name
             when 'investigations' then to_jsonb(new) -> 'tools_enabled'
             else to_jsonb(new) -> 'playbook' -> 'default_tools'
           end;

  -- A malformed set is the shape CHECK's to refuse, under its own name. Triggers run before
  -- CHECKs, so without this a `[1]` would be reported as an unknown slug.
  if not ouroboros.research_tool_set_valid(tools) then
    return new;
  end if;

  unknown := ouroboros.research_tool_slugs_unknown(tools);
  if cardinality(unknown) > 0 then
    raise exception 'unknown research tool slug(s) on %: %', tg_table_name,
      array_to_string(unknown, ', ')
      using errcode = 'foreign_key_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.research_tools_registered() is
  'Refuses an investigation''s tools_enabled, or a kind''s playbook default_tools, naming a slug research_tools does not have (#608).';

create trigger investigations_tools_registered
  before insert or update of tools_enabled on ouroboros.investigations
  for each row execute function ouroboros.research_tools_registered();

create trigger investigation_kinds_tools_registered
  before insert or update of playbook on ouroboros.investigation_kinds
  for each row execute function ouroboros.research_tools_registered();

-- And the other direction: a slug something still names cannot be removed or renamed.
create function ouroboros.research_tools_in_use()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' or new.slug <> old.slug)
     and (exists (select 1 from ouroboros.investigations where tools_enabled ? old.slug)
          or exists (select 1 from ouroboros.investigation_kinds
                      where playbook -> 'default_tools' ? old.slug)) then
    raise exception 'research tool % is named by an investigation or a kind playbook', old.slug
      using errcode = 'restrict_violation', constraint = tg_name;
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function ouroboros.research_tools_in_use() is
  'Refuses deleting or renaming a research_tools slug that an investigation or kind playbook still names (#608).';

create trigger research_tools_in_use
  before update of slug or delete on ouroboros.research_tools
  for each row execute function ouroboros.research_tools_in_use();

-- ---------------------------------------------------------------------------
-- The four built-in kinds, in every workspace.
-- ---------------------------------------------------------------------------

-- investigation_kinds_seed(organization_id) — give a workspace the four built-in kinds.
-- Idempotent: a kind the workspace already has (by slug) is left as it is.
--   p_organization_id — the workspace
--   returns nothing
create function ouroboros.investigation_kinds_seed(p_organization_id text)
returns void language sql as $$
  insert into ouroboros.investigation_kinds (organization_id, slug, display_name, tint_key, playbook)
  values
    (p_organization_id, 'bug_root_cause', 'Bug root cause', 'bug',
     '{"version": 1, "default_tools": ["code", "tickets", "telemetry"],
       "synthesis_template": "bug_root_cause@1", "deliverables": ["brief", "fix_draft"]}'),
    (p_organization_id, 'regression_forensics', 'Regression forensics', 'reg',
     '{"version": 1, "default_tools": ["code", "telemetry", "tickets"],
       "synthesis_template": "regression_forensics@1", "deliverables": ["brief", "fix_draft"]}'),
    (p_organization_id, 'roadmap_improvements', 'Roadmap & improvements', 'road',
     '{"version": 1, "default_tools": ["tickets", "web", "competitor"],
       "synthesis_template": "roadmap_improvements@1", "deliverables": ["brief", "roadmap_doc"]}'),
    (p_organization_id, 'gap_analysis', 'Gap analysis', 'gap',
     '{"version": 1, "default_tools": ["web", "competitor", "code", "tickets", "telemetry"],
       "synthesis_template": "gap_analysis@1", "deliverables": ["brief", "matrix"]}')
  on conflict (organization_id, slug) do nothing;
$$;

comment on function ouroboros.investigation_kinds_seed(text) is
  'Inserts the four built-in investigation kinds (bug_root_cause, regression_forensics, roadmap_improvements, gap_analysis) with their v1 playbooks into a workspace; leaves any it already has (#608).';

create function ouroboros.organization_seed_investigation_kinds()
returns trigger language plpgsql as $$
begin
  perform ouroboros.investigation_kinds_seed(new."id");
  return null;
end;
$$;

comment on function ouroboros.organization_seed_investigation_kinds() is
  'Gives every new workspace the four built-in investigation kinds (#608).';

create trigger organization_seed_investigation_kinds
  after insert on ouroboros.organization
  for each row execute function ouroboros.organization_seed_investigation_kinds();

-- And every workspace that already exists.
select ouroboros.investigation_kinds_seed("id") from ouroboros.organization;

-- ---------------------------------------------------------------------------
-- The application role.
--
-- Investigations are created and moved through their lifecycle, and a kind's playbook is edited
-- (with its version), but neither is deleted by the application — a deleted investigation is an
-- RS number that resolves to nothing in somebody's Slack thread. CL.1 registers adapters by
-- inserting slugs. investigation_seq_counters has no grant at all: only the allocator writes it.
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.research_tools to ouroboros_app;
grant select, insert, update on ouroboros.investigation_kinds to ouroboros_app;
grant select, insert, update on ouroboros.investigations to ouroboros_app;
