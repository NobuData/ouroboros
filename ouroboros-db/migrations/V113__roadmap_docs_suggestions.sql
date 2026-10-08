-- V113__roadmap_docs_suggestions.sql — ROADMAP.md as a versioned product entity whose markdown is
-- a projection, with its repo state and its suggestion queue beside it (#612, CK.5).
--
-- Mockup 22's pipeline card, step 1:
--
--   1 · CREATE-ROADMAP → ROADMAP.MD                                    (Rendered | Raw .md)
--   docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief
--   Helios — Q4 Improvement Roadmap
--   M1 · DOCKING PARITY — TARGET OCT 15
--    [x] #742  Wind-feedforward MPC in final approach   MVP  L
--    [ ] #743  Re-planned abort & retry vectors         MVP  M
--    [ ] #744  Gust estimator from IMU residuals             M
--   M2 · FLEET RELIABILITY — TARGET NOV 20
--    [ ] #745  Battery health model v2                       M
--    [ ] #746  Telemetry gap alerts                          S
--    [ ] #747  Operator recovery playbook docs               XS
--
--   SUGGESTED CHANGES — 2 OPEN                          applying re-runs create-roadmap
--    KS  Pull #744 into the M1 MVP set — …                         [Apply ⟳] [Dismiss]
--    AI  Split #745 — complexity is high for a single loop; …      [Apply ⟳] [Dismiss]
--
-- *"The file and the tracker never drift"* needs one owner (decision **V8**). If the markdown were
-- the source of truth, every writeback would be a text edit a human merge could silently undo. So
-- a structured entity owns the roadmap and the markdown is regenerated from it:
--
--   1. **`roadmap_docs`** — the document: its workspace, the investigation that produced it
--      (nullable — a doc can outlive or precede one), its title and `current_version`.
--   2. **`roadmap_doc_versions`** — each generation: `structure` (milestones with a name and a
--      target date; items with a title, draft and ticket refs, MVP flag, effort and checked
--      state), `markdown` (the projection — regenerated, never hand-authored), `generated_by` (the
--      skill run that produced it) and `repo_projection` (the file's state in the repo).
--   3. **`doc_suggestions`** — the queue: a human's or the AI's proposed change, `open` until it
--      is `applied` (recording the version it produced) or `dismissed` (recording who and when).
--
-- ---------------------------------------------------------------------------
-- Versions are immutable — except where the repo is
-- ---------------------------------------------------------------------------
--
-- WF-P.1's discipline (#132, `workflow_versions_refuse_update`): a written version is never
-- revised, for any role. Versions are dense from 1 and the highest is current;
-- `roadmap_docs.current_version` follows each new one. Applying a suggestion is a **re-run, not
-- a patch** — create-roadmap writes the next version and the suggestion records it — and the
-- writeback is the same: issue numbers and MVP flags land in the **next** version, never in the
-- current one.
--
-- The one thing a version may change is `repo_projection`, because the repo is a separate state
-- machine that moves after the version is written. A version exists before its PR opens, while
-- the PR is open, after it lands — and it can be found to have drifted from what the repo holds:
--
--   pending ──▶ pr_open ──▶ committed ──▶ drift_detected
--      │          │  ▲          ▲              │
--      │          ▼  │          │              │ (re-projected: a PR, or a direct commit)
--      │       pending          └──────────────┤
--      └──────────────────────▶ committed      └──▶ pr_open
--
-- `pending → committed` is a direct commit; `pr_open → pending` a PR closed unmerged. The shape
-- follows the state: a PR ref while `pr_open`, a committed sha from `committed` on, and the sha
-- the drift was observed at only in `drift_detected`. `roadmap_doc_versions_no_update` refuses
-- every other change; `roadmap_doc_versions_projection_transition` holds the edges.
--
-- ---------------------------------------------------------------------------
-- Items point at drafts, then at tickets
-- ---------------------------------------------------------------------------
--
-- Before the push an item names the Planning draft it became (AK.1, `ticket_drafts`); after it,
-- the canonical ticket (`tickets`) as well — the draft link is kept — with the ticket's display
-- key (`#742`) mirrored beside it, so the version is a self-contained record of what it said.
-- `roadmap_doc_versions_refs_valid` checks at write that every draft and ticket is the doc's
-- workspace's and that a mirrored key is the ticket's own. Versions are history, so a ref is not a
-- foreign key: a draft or ticket deleted later leaves the old version saying what it said.
--
-- Revert forward:
--   drop table ouroboros.doc_suggestions, ouroboros.roadmap_doc_versions, ouroboros.roadmap_docs;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- roadmap_iso_date_valid(value) — whether a `YYYY-MM-DD` string names a real calendar date.
--   value — the string to inspect
--   returns true for a real date (2026-10-15), false for one that is not (2026-02-30)
create function ouroboros.roadmap_iso_date_valid(value text)
returns boolean language plpgsql immutable as $$
begin
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception
  when others then
    return false;
end;
$$;

comment on function ouroboros.roadmap_iso_date_valid(text) is
  'True when a YYYY-MM-DD string is a real calendar date (#612).';

-- roadmap_structure_valid(structure) — whether a version's structure is exactly
-- {milestones: [milestone…]}, 1–50 milestones and at most 500 items in all, where
--   milestone = {key, name, target_date, items: [item…]}
--     key          `^[a-z0-9][a-z0-9_-]{0,31}$`, unique in the structure
--     name         non-blank, ≤ 200 characters
--     target_date  an ISO date `YYYY-MM-DD`, or null
--   item = {key, title, draft_id, ticket_id, ticket_key, mvp, effort, checked}
--     key          as a milestone key, unique among items
--     title        non-blank, ≤ 512 characters (a ticket title's bound)
--     draft_id     a uuid string or null — the Planning draft
--     ticket_id    a uuid string or null — the canonical ticket
--     ticket_key   the ticket's display key (`#742`), present exactly when ticket_id is
--     mvp          boolean
--     effort       xs | s | m | l | xl, or null
--     checked      boolean
--   structure — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.roadmap_structure_valid(structure jsonb)
returns boolean language plpgsql immutable as $$
declare
  milestone jsonb;
  item      jsonb;
  keys      text[] := '{}';
  item_keys text[] := '{}';
  uuid_re   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  key_re    constant text := '^[a-z0-9][a-z0-9_-]{0,31}$';
begin
  if not ouroboros.jsonb_keys_are(structure, array['milestones'])
     or jsonb_typeof(structure -> 'milestones') <> 'array'
     or jsonb_array_length(structure -> 'milestones') not between 1 and 50 then
    return false;
  end if;
  for milestone in select m from jsonb_array_elements(structure -> 'milestones') m loop
    if not ouroboros.jsonb_keys_are(milestone, array['key', 'name', 'target_date', 'items'])
       or jsonb_typeof(milestone -> 'key') <> 'string'
       or (milestone ->> 'key') !~ key_re
       or (milestone ->> 'key') = any (keys)
       or not ouroboros.jsonb_nonblank_string(milestone -> 'name')
       or length(milestone ->> 'name') > 200
       or jsonb_typeof(milestone -> 'items') <> 'array' then
      return false;
    end if;
    keys := keys || (milestone ->> 'key');
    if jsonb_typeof(milestone -> 'target_date') <> 'null'
       and not (jsonb_typeof(milestone -> 'target_date') = 'string'
                and (milestone ->> 'target_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                and ouroboros.roadmap_iso_date_valid(milestone ->> 'target_date')) then
      return false;
    end if;
    for item in select i from jsonb_array_elements(milestone -> 'items') i loop
      if not ouroboros.jsonb_keys_are(item, array['key', 'title', 'draft_id', 'ticket_id',
                                                  'ticket_key', 'mvp', 'effort', 'checked'])
         or jsonb_typeof(item -> 'key') <> 'string'
         or (item ->> 'key') !~ key_re
         or (item ->> 'key') = any (item_keys)
         or not ouroboros.jsonb_nonblank_string(item -> 'title')
         or length(item ->> 'title') > 512
         or not (jsonb_typeof(item -> 'draft_id') = 'null'
                 or (jsonb_typeof(item -> 'draft_id') = 'string' and (item ->> 'draft_id') ~ uuid_re))
         or not (jsonb_typeof(item -> 'ticket_id') = 'null'
                 or (jsonb_typeof(item -> 'ticket_id') = 'string' and (item ->> 'ticket_id') ~ uuid_re))
         or (jsonb_typeof(item -> 'ticket_id') = 'null') <> (jsonb_typeof(item -> 'ticket_key') = 'null')
         or not (jsonb_typeof(item -> 'ticket_key') = 'null'
                 or (ouroboros.jsonb_nonblank_string(item -> 'ticket_key')
                     and length(item ->> 'ticket_key') <= 64))
         or jsonb_typeof(item -> 'mvp') <> 'boolean'
         or jsonb_typeof(item -> 'checked') <> 'boolean'
         or not (jsonb_typeof(item -> 'effort') = 'null'
                 or (item ->> 'effort') in ('xs', 's', 'm', 'l', 'xl')) then
        return false;
      end if;
      item_keys := item_keys || (item ->> 'key');
    end loop;
  end loop;
  return cardinality(item_keys) <= 500;
end;
$$;

comment on function ouroboros.roadmap_structure_valid(jsonb) is
  'True when a roadmap version''s structure is exactly {milestones: [{key, name, target_date, items: [{key, title, draft_id, ticket_id, ticket_key, mvp, effort, checked}]}]} — 1–50 milestones, ≤ 500 items, keys unique, ticket_key present exactly with ticket_id, effort xs|s|m|l|xl or null (#612).';

-- roadmap_structure_refs(structure) — the items of a structure with their refs, in reading order.
--   structure — a version structure (anything else yields no rows)
--   returns one row per item: milestone key, item key, draft_id, ticket_id, ticket_key
create function ouroboros.roadmap_structure_refs(structure jsonb)
returns table (milestone_key text, item_key text, draft_id uuid, ticket_id uuid, ticket_key text)
language sql immutable as $$
  select m.milestone ->> 'key', i.item ->> 'key',
         (i.item ->> 'draft_id')::uuid, (i.item ->> 'ticket_id')::uuid, i.item ->> 'ticket_key'
    from jsonb_array_elements(case when jsonb_typeof(structure -> 'milestones') = 'array'
                                   then structure -> 'milestones' else '[]'::jsonb end)
         with ordinality as m(milestone, mo),
         jsonb_array_elements(case when jsonb_typeof(m.milestone -> 'items') = 'array'
                                   then m.milestone -> 'items' else '[]'::jsonb end)
         with ordinality as i(item, io)
   order by m.mo, i.io;
$$;

comment on function ouroboros.roadmap_structure_refs(jsonb) is
  'The items of a roadmap structure with their draft and ticket refs, in reading order (#612).';

-- roadmap_repo_projection_valid(projection) — whether a repo projection is exactly
-- {state, path, pr_ref, committed_sha, observed_sha} with the shape its state requires:
--   state          pending | pr_open | committed | drift_detected
--   path           a relative repo path (`docs/ROADMAP.md`): no leading slash, no `.`/`..`/empty
--                  segment, no whitespace, ≤ 512 characters
--   pr_ref         non-blank (≤ 200) when pr_open; null or non-blank otherwise
--   committed_sha  7–40 hex; required from committed on, null before
--   observed_sha   7–40 hex — the repo commit the drift was seen at; only in drift_detected
--   projection — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.roadmap_repo_projection_valid(projection jsonb)
returns boolean language plpgsql immutable as $$
declare
  state text;
  sha_re constant text := '^[0-9a-f]{7,40}$';
begin
  if not ouroboros.jsonb_keys_are(projection, array['state', 'path', 'pr_ref', 'committed_sha',
                                                    'observed_sha'])
     or jsonb_typeof(projection -> 'state') <> 'string'
     or jsonb_typeof(projection -> 'path') <> 'string' then
    return false;
  end if;
  state := projection ->> 'state';
  if state not in ('pending', 'pr_open', 'committed', 'drift_detected')
     or length(projection ->> 'path') > 512
     or (projection ->> 'path') !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
     or (projection ->> 'path') ~ '(^|/)\.\.?(/|$)' then
    return false;
  end if;
  -- pr_ref: required while the PR is open, optional otherwise (the PR a commit came from).
  if not (jsonb_typeof(projection -> 'pr_ref') = 'null'
          or (ouroboros.jsonb_nonblank_string(projection -> 'pr_ref')
              and length(projection ->> 'pr_ref') <= 200))
     or (state = 'pr_open' and jsonb_typeof(projection -> 'pr_ref') = 'null') then
    return false;
  end if;
  -- committed_sha: exactly from committed on.
  if (state in ('committed', 'drift_detected'))
     <> (jsonb_typeof(projection -> 'committed_sha') = 'string'
         and (projection ->> 'committed_sha') ~ sha_re) then
    return false;
  end if;
  if state in ('pending', 'pr_open') and jsonb_typeof(projection -> 'committed_sha') <> 'null' then
    return false;
  end if;
  -- observed_sha: exactly in drift_detected.
  if (state = 'drift_detected')
     <> (jsonb_typeof(projection -> 'observed_sha') = 'string'
         and (projection ->> 'observed_sha') ~ sha_re) then
    return false;
  end if;
  if state <> 'drift_detected' and jsonb_typeof(projection -> 'observed_sha') <> 'null' then
    return false;
  end if;
  return true;
end;
$$;

comment on function ouroboros.roadmap_repo_projection_valid(jsonb) is
  'True when a repo projection is exactly {state, path, pr_ref, committed_sha, observed_sha}: state pending|pr_open|committed|drift_detected, a relative path, a pr_ref while pr_open, a committed sha from committed on, and the observed sha only in drift_detected (#612).';

-- ---------------------------------------------------------------------------
-- roadmap_docs — the document.
-- ---------------------------------------------------------------------------
create table ouroboros.roadmap_docs (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The investigation whose brief it was generated from — "generated from the RS-124 brief".
  -- Nullable: a doc can precede an investigation or outlive one, so deleting the investigation
  -- leaves the roadmap. Of the doc's workspace (roadmap_docs_investigation_same_workspace).
  investigation_id uuid        references ouroboros.investigations (id) on delete set null,

  -- "Helios — Q4 Improvement Roadmap".
  title            text        not null
                               constraint roadmap_docs_title_present
                                 check (btrim(title) <> '' and length(title) <= 200),

  -- The highest version; null until the first is written, then moved by each new version.
  current_version  integer
                   constraint roadmap_docs_current_version_positive check (current_version >= 1),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- An investigation produces at most one roadmap.
  constraint roadmap_docs_investigation_key unique (investigation_id)
);

comment on table ouroboros.roadmap_docs is
  'A roadmap document (#612, CK.5; decision V8): a structured, versioned entity whose ROADMAP.md is a regenerated projection. current_version is the highest version, moved by each new one.';
comment on column ouroboros.roadmap_docs.investigation_id is
  'The investigation it was generated from, if any — nullable, set null when the investigation is deleted. At most one doc per investigation.';
comment on column ouroboros.roadmap_docs.current_version is
  'The highest roadmap_doc_versions.version; null before the first. Kept by roadmap_doc_versions_advance_current.';

-- The investigation is the doc's workspace's.
create function ouroboros.roadmap_docs_investigation_same_workspace()
returns trigger language plpgsql as $$
begin
  if new.investigation_id is not null
     and not exists (select 1 from ouroboros.investigations i
                      where i.id = new.investigation_id and i.organization_id = new.organization_id) then
    raise exception 'investigation % is not of workspace %', new.investigation_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_docs_investigation_same_workspace() is
  'Refuses a roadmap doc whose investigation belongs to another workspace (#612).';

create trigger roadmap_docs_investigation_same_workspace
  before insert or update of investigation_id, organization_id on ouroboros.roadmap_docs
  for each row execute function ouroboros.roadmap_docs_investigation_same_workspace();

create trigger roadmap_docs_touch_updated_at
  before update on ouroboros.roadmap_docs
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- roadmap_doc_versions — each generation, immutable but for its repo state.
-- ---------------------------------------------------------------------------
create table ouroboros.roadmap_doc_versions (
  id              uuid        primary key default gen_random_uuid(),

  doc_id          uuid        not null
                              references ouroboros.roadmap_docs (id) on delete cascade,

  -- 1, 2, 3, … per doc with no gap; the highest is current.
  version         integer     not null
                              constraint roadmap_doc_versions_version_positive check (version >= 1),

  -- Milestones and items — see roadmap_structure_valid().
  structure       jsonb       not null
                              constraint roadmap_doc_versions_structure_shape
                                check (ouroboros.roadmap_structure_valid(structure)),

  -- The projection: the ROADMAP.md create-roadmap rendered from the structure. Never
  -- hand-authored — a change to the roadmap is a new version.
  markdown        text        not null
                              constraint roadmap_doc_versions_markdown_bounded
                                check (btrim(markdown) <> '' and octet_length(markdown) <= 524288),

  -- The skill run that generated it — "create-roadmap@<run ref>" (BE.1, #405).
  generated_by    text        not null
                              constraint roadmap_doc_versions_generated_by_present
                                check (btrim(generated_by) <> '' and length(generated_by) <= 200),

  -- The file's state in the repo; the one column that changes after the write.
  repo_projection jsonb       not null
                              constraint roadmap_doc_versions_repo_projection_shape
                                check (ouroboros.roadmap_repo_projection_valid(repo_projection)),

  created_at      timestamptz not null default now(),

  constraint roadmap_doc_versions_doc_version_key unique (doc_id, version)
);

comment on table ouroboros.roadmap_doc_versions is
  'A roadmap''s versions (#612, CK.5): the structure (milestones · items · mvp · effort · checked, items referencing drafts and tickets), the markdown projected from it, the skill run that generated it, and the repo projection state. Dense from 1; immutable except repo_projection, whose state machine is constrained.';
comment on column ouroboros.roadmap_doc_versions.structure is
  '{milestones: [{key, name, target_date, items: [{key, title, draft_id, ticket_id, ticket_key, mvp, effort, checked}]}]}.';
comment on column ouroboros.roadmap_doc_versions.markdown is
  'The ROADMAP.md projection, regenerated from structure — never hand-authored. At most 512 KiB.';
comment on column ouroboros.roadmap_doc_versions.generated_by is
  'The skill-run reference that generated this version (create-roadmap, BE.1 #405).';
comment on column ouroboros.roadmap_doc_versions.repo_projection is
  '{state: pending|pr_open|committed|drift_detected, path, pr_ref, committed_sha, observed_sha}. The only column a version may change, along the edges roadmap_doc_versions_projection_transition allows.';

-- The doc's current version follows the newest one.
alter table ouroboros.roadmap_docs
  add constraint roadmap_docs_current_version_fk
    foreign key (id, current_version)
    references ouroboros.roadmap_doc_versions (doc_id, version)
    deferrable initially deferred;

-- A version is the next one: no gap, no going back. Two writers racing for the same version meet
-- at roadmap_doc_versions_doc_version_key.
create function ouroboros.roadmap_doc_versions_version_next()
returns trigger language plpgsql as $$
declare
  expected integer;
begin
  select coalesce(max(version), 0) + 1 into expected
    from ouroboros.roadmap_doc_versions where doc_id = new.doc_id;
  if new.version <> expected then
    raise exception 'roadmap version % of doc % is not the next version, %',
      new.version, new.doc_id, expected
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_doc_versions_version_next() is
  'Refuses a roadmap version that is not one past the doc''s highest (#612).';

create trigger roadmap_doc_versions_version_next
  before insert on ouroboros.roadmap_doc_versions
  for each row execute function ouroboros.roadmap_doc_versions_version_next();

-- Every draft and ticket an item names is the doc's workspace's, and a mirrored ticket key is the
-- ticket's own at the time of writing.
create function ouroboros.roadmap_doc_versions_refs_valid()
returns trigger language plpgsql as $$
declare
  workspace text;
  bad       record;
begin
  select d.organization_id into workspace from ouroboros.roadmap_docs d where d.id = new.doc_id;

  select r.item_key, r.draft_id, r.ticket_id into bad
    from ouroboros.roadmap_structure_refs(new.structure) r
   where (r.draft_id is not null
          and not exists (select 1 from ouroboros.ticket_drafts td
                            join ouroboros.draft_batches b on b.id = td.batch_id
                           where td.id = r.draft_id and b.organization_id = workspace))
      or (r.ticket_id is not null
          and not exists (select 1 from ouroboros.tickets t
                           where t.id = r.ticket_id and t.organization_id = workspace
                             and t.external_key = r.ticket_key))
   limit 1;

  if found then
    raise exception 'roadmap item % names draft % / ticket % that is not its workspace''s, or a ticket key that is not the ticket''s',
      bad.item_key, bad.draft_id, bad.ticket_id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'An item names a Planning draft (ticket_drafts) and, after the push, the canonical ticket with its external_key mirrored as ticket_key.';
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_doc_versions_refs_valid() is
  'Refuses a roadmap version whose items name a draft or ticket outside the doc''s workspace, or mirror a ticket_key that is not the ticket''s external_key (#612).';

create trigger roadmap_doc_versions_refs_valid
  before insert on ouroboros.roadmap_doc_versions
  for each row execute function ouroboros.roadmap_doc_versions_refs_valid();

-- WF-P.1's immutability, with the repo projection as the one exception.
create function ouroboros.roadmap_doc_versions_refuse_update()
returns trigger language plpgsql as $$
begin
  if row(new.id, new.doc_id, new.version, new.structure, new.markdown, new.generated_by,
         new.created_at)
     is not distinct from
     row(old.id, old.doc_id, old.version, old.structure, old.markdown, old.generated_by,
         old.created_at) then
    return new;
  end if;
  raise exception 'roadmap version % of doc % is immutable — only its repo projection may move',
    old.version, old.doc_id
    using errcode = 'check_violation', constraint = 'roadmap_doc_versions_no_update',
          hint = 'Write the next version instead: a re-run of create-roadmap, with any writeback mirrored into it (decision V8).';
end;
$$;

comment on function ouroboros.roadmap_doc_versions_refuse_update() is
  'Refuses any update of a roadmap version other than its repo_projection, for every role (#612, the WF-P.1 #132 pattern).';

create trigger roadmap_doc_versions_no_update
  before update on ouroboros.roadmap_doc_versions
  for each row execute function ouroboros.roadmap_doc_versions_refuse_update();

-- The repo projection's edges — see the header's diagram. A projection may also be restated in the
-- same state (a PR ref filled in, say), but its path is fixed once written.
create function ouroboros.roadmap_doc_versions_projection_transition()
returns trigger language plpgsql as $$
declare
  was text := old.repo_projection ->> 'state';
  now_ text := new.repo_projection ->> 'state';
begin
  if (new.repo_projection ->> 'path') is distinct from (old.repo_projection ->> 'path')
     or not (was = now_
             or (was, now_) in (('pending', 'pr_open'), ('pending', 'committed'),
                                ('pr_open', 'committed'), ('pr_open', 'pending'),
                                ('committed', 'drift_detected'),
                                ('drift_detected', 'pr_open'), ('drift_detected', 'committed'))) then
    raise exception 'roadmap version % repo projection cannot move % → % (or change its path)',
      old.version, was, now_
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.roadmap_doc_versions_projection_transition() is
  'Holds a roadmap version''s repo projection to its state machine (#612): pending → pr_open | committed, pr_open → committed | pending, committed → drift_detected, drift_detected → pr_open | committed; the path never changes.';

create trigger roadmap_doc_versions_projection_transition
  before update of repo_projection on ouroboros.roadmap_doc_versions
  for each row execute function ouroboros.roadmap_doc_versions_projection_transition();

-- Each new version becomes the doc's current one.
create function ouroboros.roadmap_doc_versions_advance_current()
returns trigger language plpgsql as $$
begin
  update ouroboros.roadmap_docs d
     set current_version = new.version
   where d.id = new.doc_id
     and (d.current_version is null or d.current_version < new.version);
  return null;
end;
$$;

comment on function ouroboros.roadmap_doc_versions_advance_current() is
  'Moves roadmap_docs.current_version to a newly written version (#612).';

create trigger roadmap_doc_versions_advance_current
  after insert on ouroboros.roadmap_doc_versions
  for each row execute function ouroboros.roadmap_doc_versions_advance_current();

-- ---------------------------------------------------------------------------
-- doc_suggestions — the suggestion queue.
-- ---------------------------------------------------------------------------
create table ouroboros.doc_suggestions (
  id              uuid        primary key default gen_random_uuid(),

  doc_id          uuid        not null
                              references ouroboros.roadmap_docs (id) on delete cascade,

  -- KS or AI — who proposed it.
  author_kind     text        not null
                              constraint doc_suggestions_author_kind
                                check (author_kind in ('user', 'ai')),

  -- The person, for a user suggestion. Set null when they are deleted; the kind stays.
  author_user_id  text        references ouroboros."user" ("id") on delete set null,

  -- The agent, for an AI suggestion — "estimator".
  author_agent    text
                  constraint doc_suggestions_author_agent_present
                    check (btrim(author_agent) <> '' and length(author_agent) <= 100),

  -- "Pull #744 into the M1 MVP set — churn interviews rank gust handling above battery accuracy."
  text            text        not null
                              constraint doc_suggestions_text_present
                                check (btrim(text) <> '' and length(text) <= 4000),

  -- An optional structured hint for the re-run — {"move": "dock-gust", "to": "m1", "mvp": true}.
  hint            jsonb
                  constraint doc_suggestions_hint_shape
                    check (jsonb_typeof(hint) = 'object' and octet_length(hint::text) <= 8192),

  status          text        not null default 'open'
                              constraint doc_suggestions_status
                                check (status in ('open', 'applied', 'dismissed')),

  -- The version applying it produced.
  applied_version integer,
  applied_at      timestamptz,
  applied_by      text        references ouroboros."user" ("id") on delete set null,

  dismissed_at    timestamptz,
  dismissed_by    text        references ouroboros."user" ("id") on delete set null,

  created_at      timestamptz not null default now(),

  constraint doc_suggestions_applied_version_fk
    foreign key (doc_id, applied_version)
    references ouroboros.roadmap_doc_versions (doc_id, version),

  -- An AI suggestion names its agent and no person; a user suggestion names no agent (its
  -- person may since have been deleted).
  constraint doc_suggestions_author_coherent
    check (case author_kind
             when 'ai'   then author_agent is not null and author_user_id is null
             when 'user' then author_agent is null
           end),

  -- What is recorded follows the status.
  constraint doc_suggestions_status_coherent
    check (case status
             when 'open'      then applied_version is null and applied_at is null and applied_by is null
                                   and dismissed_at is null and dismissed_by is null
             when 'applied'   then applied_version is not null and applied_at is not null
                                   and dismissed_at is null and dismissed_by is null
             when 'dismissed' then dismissed_at is not null
                                   and applied_version is null and applied_at is null and applied_by is null
           end)
);

comment on table ouroboros.doc_suggestions is
  'Suggested changes to a roadmap doc (#612, CK.5): a user''s or the AI''s, with an optional structured hint. open → applied (recording the version the re-run produced, when and by whom) or open → dismissed (when and by whom). Applying re-runs create-roadmap; the suggestion never patches a version.';
comment on column ouroboros.doc_suggestions.author_kind is
  'user | ai — rendered as the author''s initials or AI.';
comment on column ouroboros.doc_suggestions.hint is
  'An optional structured hint for the re-run; an object of at most 8 KiB.';
comment on column ouroboros.doc_suggestions.applied_version is
  'The roadmap_doc_versions.version the re-run produced, for an applied suggestion.';

-- The card's "SUGGESTED CHANGES — 2 OPEN".
create index doc_suggestions_doc_status_idx
  on ouroboros.doc_suggestions (doc_id, status);

-- open → applied | dismissed, each terminal and recorded with its actor; nothing else about a
-- suggestion changes, beyond a foreign key's own set-null.
create function ouroboros.doc_suggestions_transition()
returns trigger language plpgsql as $$
declare
  produced timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'a suggestion is written open'
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  if new.doc_id <> old.doc_id or new.author_kind <> old.author_kind
     or new.author_agent is distinct from old.author_agent
     or new.text <> old.text or new.hint is distinct from old.hint
     or new.created_at <> old.created_at
     or (new.author_user_id is distinct from old.author_user_id and new.author_user_id is not null) then
    raise exception 'suggestion % is not edited — write a new one', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status = old.status then
    -- Only a person's deletion may touch a settled suggestion: an actor cleared, nothing else.
    if new.applied_version is distinct from old.applied_version
       or new.applied_at is distinct from old.applied_at
       or new.dismissed_at is distinct from old.dismissed_at
       or (new.applied_by is distinct from old.applied_by and new.applied_by is not null)
       or (new.dismissed_by is distinct from old.dismissed_by and new.dismissed_by is not null) then
      raise exception 'suggestion % is % and its record does not change', old.id, old.status
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'suggestion % is already %', old.id, old.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status = 'applied' then
    if new.applied_by is null then
      raise exception 'applying suggestion % records who applied it', old.id
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    -- The re-run's version is one written after the suggestion was made.
    select v.created_at into produced from ouroboros.roadmap_doc_versions v
     where v.doc_id = new.doc_id and v.version = new.applied_version;
    if produced is not null and produced < old.created_at then
      raise exception 'suggestion % cannot have produced version %, written before it',
        old.id, new.applied_version
        using errcode = 'check_violation', constraint = tg_name;
    end if;
  elsif new.status = 'dismissed' and new.dismissed_by is null then
    raise exception 'dismissing suggestion % records who dismissed it', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.doc_suggestions_transition() is
  'Holds a doc suggestion to open → applied | dismissed (#612): written open; applied with the version a re-run produced after it and who applied it; dismissed with who dismissed it; terminal; the suggestion itself never edited. A person''s deletion may clear an actor.';

create trigger doc_suggestions_transition
  before insert or update on ouroboros.doc_suggestions
  for each row execute function ouroboros.doc_suggestions_transition();

-- ---------------------------------------------------------------------------
-- The application role.
--
-- Docs are managed; versions are written, and only their repo projection moved; suggestions are
-- made and settled. Nothing is deleted piecemeal — a doc goes with its workspace.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.roadmap_docs to ouroboros_app;
grant select, insert, update (repo_projection) on ouroboros.roadmap_doc_versions to ouroboros_app;
grant select, insert, update on ouroboros.doc_suggestions to ouroboros_app;
