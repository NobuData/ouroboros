-- V029__workflows_versions.sql — `workflows` and `workflow_versions`: the studio's entities,
-- and the version history a run can pin.
--
-- The first migration of the **workflow** domain (docs/ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md),
-- filed as P.1 (#132) under epic #127. It is what mockup 04's page head is drawn from — the
-- title `standard-fix`, the `v14` chip beside *Last edited 2h ago*, and the **Publish v15**
-- button that turns one into the other — and what the `.wf-list` rail lists, including the
-- `hotfix-p0` entry whose err-dot is a `status` of `paused`.
--
-- Nothing writes it yet. P.2 (#133) is the DSL these definitions are written in, P.3 the CRUD
-- and publish endpoints, P.4 (#135) the rail's stats and #136 the seed that fills the rail.
-- As with every read-model table before it, that is exactly why each rule a reader depends on
-- is a constraint here rather than an application invariant: the writers do not exist to be
-- trusted yet.
--
-- ---------------------------------------------------------------------------
-- The tags were the placeholder; these are the entities.
-- ---------------------------------------------------------------------------
--
-- `runs.workflow_tag` (`V008`) and `queue_items.workflow_tag` (`V009`) are opaque strings by
-- **decision F8**, and deliberately so: workflow entities were mockup 04's and a foreign key
-- from a closed run would have made a rename or a delete rewrite history. Decision **K5** kept
-- that posture through the intake roadmap and deferred the real thing to here.
--
-- This migration does **not** come back and tighten those columns, and that is the point worth
-- stating first, because it is the change a reader arrives expecting:
--
--   * **No foreign key is added to `runs` or `queue_items`.** F8's argument has not weakened.
--     A run that closed under `standard-fix` in March must still render as such in December,
--     whether or not a workflow by that slug still exists — and a cascade or a restrict is
--     exactly what would take that away.
--   * **The bridge is the slug, and it is a join a reader may make rather than a key the
--     schema enforces.** `workflows.slug` is bounded at 64 characters, the same bound
--     `runs_workflow_tag_present` and `queue_items_workflow_tag_present` put on a tag, so
--     every tag those tables can hold is short enough to be a slug and the existing four —
--     `standard-fix`, `feature-loop`, `docs-loop`, `deps-refresh` — remain valid slugs
--     unchanged. `(organization_id, slug)` is unique, so that join has one answer per
--     workspace, and it is an index lookup rather than a scan. `tests/constraints.sql`
--     asserts both.
--
-- So the resolution a surface performs is `where organization_id = $1 and slug = $tag`, and a
-- tag that resolves to nothing is a workflow that has been renamed or removed — which is a
-- fact about history, not a broken row.
--
-- ---------------------------------------------------------------------------
-- Decision P1 — published versions are immutable, and the draft is the row that becomes one.
-- ---------------------------------------------------------------------------
--
-- The mockup states the lifecycle in two controls: a chip that says which version is in force,
-- and a button that publishes the next one. Underneath, decision **P1** is the whole of it —
-- *drafts are mutable, published versions never change* — and the reason is not tidiness. A
-- run pins the version it executed, so that months later *"what did this loop actually do"* has
-- an answer; silently editing a published definition would rewrite that answer for every run
-- that ever pinned it.
--
-- The shape that follows is one table of versions in which exactly one row is unnumbered:
--
--     workflow_versions           version   published_at   what it is
--     ------------------------   -------   ------------   ------------------------------
--     …                                1   2026-02-03     published, immutable
--     …                              …                    …
--     …                               14   2026-09-10     published, immutable  ← v14
--     …                             null   null           the draft, mutable, edited freely
--
-- **Publishing promotes the draft in place**: the unnumbered row is given the next number and
-- a publish stamp, and from that instant it is immutable like every row above it. The button
-- reading *Publish v15* is therefore literal — the row being edited becomes v15 — and the
-- studio gets a signal it would otherwise have to compute by comparing two jsonb documents:
--
--     **a draft exists  ⟺  there are unpublished changes.**
--
-- That equivalence is what *Last edited 2h ago* is honest about and what decides whether the
-- publish button has anything to do. A copy-on-publish model — insert the new version, leave
-- the draft behind — would leave every workflow permanently holding a draft identical to its
-- published version, and *"are there unpublished changes"* would become a document comparison
-- that is wrong the moment a key is reordered.
--
-- The schema does not *forbid* a copy-on-publish writer: inserting a numbered row directly is
-- a legal publish, and the rules below hold either way. What it forbids is the thing P1 is
-- about, which is touching a row that has already been published.
--
-- ---------------------------------------------------------------------------
-- Why the draft is `version is null` rather than an `is_draft` flag.
-- ---------------------------------------------------------------------------
--
-- The roadmap left this open and named both candidates. `version is null` is taken, for three
-- reasons that are all the same reason:
--
--   1. **A draft has no version number.** That is not a modelling convenience, it is the fact:
--      the number is assigned *by* publishing, which is why the button can say which number is
--      coming. An `is_draft` boolean forces a number onto a row that has not earned one — and
--      whatever it is set to is then either a lie (`15`, a version that does not exist) or a
--      collision waiting for the real v15.
--   2. **One column cannot disagree with itself.** With a flag there are two facts — `is_draft`
--      and `version` — and every reader has to know which wins when they disagree. Here there
--      is one, and `workflow_versions_version_publish_stamp` ties it to the publish stamp so
--      the three publish columns cannot drift apart either: a row has a number and a stamp, or
--      neither.
--   3. **The rule that matters becomes an index rather than a promise.** *At most one draft*
--      is `unique (workflow_id) where version is null` — a partial unique index, which is where
--      two concurrent *"start editing"* requests collide, rather than a count somebody
--      remembered to take first.
--
-- PostgreSQL 17 would also permit `unique nulls not distinct (workflow_id, version)`, folding
-- the draft rule into the version key. It is not taken because the **name** is the useful part
-- of a rejection: a writer told `workflow_versions_one_draft_idx` has been told the rule, and
-- one told `workflow_versions_workflow_version_key` has been told that a version number
-- collided, which is not what happened.
--
-- ---------------------------------------------------------------------------
-- Versions are dense from 1, and refused rather than assigned.
-- ---------------------------------------------------------------------------
--
-- Acceptance criterion: *publishing creates version N+1*. `workflow_version_next()` enforces
-- exactly that — the first published version of a workflow is 1, and every one after it is one
-- above the highest that workflow has.
--
-- **Dense**, unlike `issue_estimates.version` (`V026`), which is only required to ascend. The
-- difference is who reads the numbers. Nothing counts an estimate's versions; this number is
-- printed in the page head as `v14` and a person reads it as *the fourteenth time somebody
-- published this workflow*. A sequence that ran 14, 15, 17 would have no answer to *"where is
-- v16"* — nothing deleted it, because published rows are immutable — so the gap would be a
-- defect with no explanation rather than a number nobody looks at. It is the rule that makes
-- `version` and *how many times this has been published* the same quantity.
--
-- **Refused rather than assigned**, which is `V026`'s argument unchanged: a default of
-- `max(version) + 1` would read as a convenience and would hide the one case a writer must
-- handle — two people publishing the same workflow at once. Both compute 15, both attempt it,
-- and `workflow_versions_workflow_version_key` lets exactly one commit. That is a retry, and a
-- writer that never sees it is a writer that will one day silently overwrite.
--
-- ---------------------------------------------------------------------------
-- `current_version` is a pointer, not a cache.
-- ---------------------------------------------------------------------------
--
-- It would be easy to read `workflows.current_version` as a denormalised `max(version)` and to
-- ask why a derived number is stored at all. It is not derived, and the distinction is the
-- column's whole justification: it records **which published version is in force**, which is
-- normally the newest and is not required to be. Rolling a workflow back to v12 after a bad
-- publish is then a one-column write that invents no history — v13 and v14 stay exactly as
-- published, and the chip says v12 because v12 is what runs.
--
-- What stops it becoming a lie is a **composite foreign key**, `(id, current_version)` against
-- `workflow_versions (workflow_id, version)`. It is the pattern `V015` and `V016` use for
-- tenancy, applied to a pointer: a `current_version` that names a version of a *different*
-- workflow, or one that was never published, is unstorable. `MATCH SIMPLE` is what admits the
-- null — a workflow that has only ever had a draft has nothing in force yet, which is the state
-- the rail's *+ New workflow* leaves behind, and `V019` relies on the same rule for an unbound
-- alias.
--
-- The key is added by `alter table` at the foot of this file rather than in the `create table`,
-- because the two tables reference each other and one of them has to be created first. It is
-- `no action` on delete rather than `restrict`, deliberately: the two differ only in *when* the
-- check runs, and end-of-statement is what lets `delete from workflows` work — the cascade that
-- removes the versions and the row that pointed at one are the same statement, and by the end
-- of it neither is there.
--
-- ---------------------------------------------------------------------------
-- Immutability lives in the database, not in the grants.
-- ---------------------------------------------------------------------------
--
-- `V022`'s posture and `V022`'s argument. A `revoke update` would be true in production and
-- false on the machine this code is written on, because the development stack connects as the
-- database owner and a superuser bypasses every grant — so the rule that a published version
-- cannot be revised is a trigger, refusing every role including the owner.
--
-- It carries `V022`'s one exception, for `V022`'s reason: `published_by` is
-- `on delete set null`, and a set-null **is an UPDATE**. A trigger that refused every update
-- would not be making this table immutable, it would be making `delete from "user"` fail — and
-- a schema in which a person cannot be removed because they once pressed Publish is not a
-- privacy posture anybody would choose. So exactly that statement is permitted and nothing
-- beside it: the attribution may be *erased*, never changed, and never while any other column
-- moves. What was published cannot be rewritten; who published it can be forgotten.
--
-- There is no delete counterpart, for `V022`'s reason again: `workflow_id` cascades, so a
-- delete-refusing trigger would not protect the history — it would make removing a workflow or
-- a workspace fail. What a stray `delete from workflow_versions` cannot take is the version
-- something points at: the composite key above refuses that one.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here.
-- ---------------------------------------------------------------------------
--
--   * **The DSL's grammar.** `definition` is CHECKed to be a jsonb *object* and nothing more.
--     The document's shape is P.2's (#133) — one published JSON Schema, validated by `zod` in
--     REST and `pydantic` in the engine against that same file — and a second, partial copy of
--     it in a CHECK would be a rule nobody updates and every writer eventually argues with.
--     The object check is what a column holding a document owes its readers, and the reason it
--     stops there is also positive: **an empty `{}` is a legal draft**, which is what *+ New
--     workflow* produces before a single node is placed. A CHECK requiring `nodes` would make
--     the empty canvas unrepresentable.
--   * **`organization_id` on `workflow_versions`.** `V017`'s and `V026`'s choice: a version is
--     a fact *about a workflow*, every read enters through one, and the single cascading
--     foreign key is therefore the whole of its tenancy. A second parent would buy a shorter
--     join and cost a trigger keeping the two in agreement — a rule that can be got wrong, in
--     exchange for one that cannot.
--   * **Stage counts, usage percentages and the rail's captions.** *6 stages · auto-merge* and
--     *used by 61% of runs* are derived — from the definition and from `runs` — and P.4 (#135)
--     owns them. A stored count would be a number that drifts from the document it counts.
--   * **A `draft` status.** `status` is `active|paused|archived`, which is what the rail
--     renders; whether a workflow has unpublished work is `current_version` and the draft row,
--     not a fourth value that would have to be kept in step with them.

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------
create table ouroboros.workflows (
  -- Surrogate uuid rather than the slug, for `V001`'s reason: the slug is a display and URL
  -- concern that a workspace may want to change, while `workflow_versions` points here and
  -- must never have to be rewritten because somebody renamed a workflow.
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a workflow is that workspace's, and goes with it — taking its
  -- whole version history, which cascades from here in turn.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- **The name the rest of the product already knows this workflow by.**
  --
  -- Lower-case kebab and at most 64 characters, which is not a house style applied for its own
  -- sake: it is exactly what `runs.workflow_tag` and `queue_items.workflow_tag` can hold, so
  -- every tag already stored is a slug this column could carry, and the existing four are
  -- unchanged. See the header on the bridge those tags make.
  slug            text        not null,

  -- The human title. Free text, because it is prose — the slug is the identifier, and the two
  -- are frequently the same string (the mockup's rail and page head both render `standard-fix`).
  name            text        not null,

  -- `active` on the rail, `paused` as its err-dot, `archived` as the soft delete that keeps a
  -- workflow's history readable after it stops being offered. A closed vocabulary rather than
  -- free text, because the dot is rendered from it.
  status          text        not null default 'active',

  -- **Which published version is in force** — the `v14` chip. Null is *nothing in force yet*,
  -- the state a workflow with only a draft is in. Not a cache of `max(version)`; see the header.
  -- Held to a real published version of *this* workflow by `workflows_current_version_fk`,
  -- added once `workflow_versions` exists.
  current_version integer,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- --- one slug per workspace ---------------------------------------------------
  --
  -- Acceptance criterion, and the index the tag bridge resolves through. Per workspace rather
  -- than per installation: two tenants both running a `standard-fix` is the ordinary case, and
  -- a global unique would make the second one rename for a reason it could never be told.
  constraint workflows_organization_slug_key unique (organization_id, slug),

  constraint workflows_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),

  constraint workflows_name_present
    check (btrim(name) <> '' and length(name) <= 120),

  constraint workflows_status_valid
    check (status in ('active', 'paused', 'archived')),

  -- Versions start at 1, so a pointer at 0 or below is a pointer at nothing. The foreign key
  -- refuses those too; this refuses them at the column, where the message is about the number
  -- rather than about a missing row.
  constraint workflows_current_version_positive
    check (current_version is null or current_version >= 1)
);

comment on table ouroboros.workflows is
  'A workspace''s workflows (#132, P.1) — the entities mockup 04''s rail lists and its page head names, and the real thing behind the opaque workflow_tag strings runs and queue_items carry (decision F8/K5). Org-scoped, slugged, and pointed at whichever published version is in force.';
comment on column ouroboros.workflows.organization_id is
  'The workspace. ON DELETE CASCADE — a workflow belongs to it, and the version history cascades from the workflow in turn.';
comment on column ouroboros.workflows.slug is
  'The name runs and queue items already carry as workflow_tag: lower-case kebab, at most 64 characters — the same bound those columns have, so every stored tag is a slug this column could hold. Unique per workspace, which is what makes tag resolution a single indexed lookup with one answer.';
comment on column ouroboros.workflows.name is
  'The human title. Free text, because it is prose; the slug is the identifier, and the two are often the same string.';
comment on column ouroboros.workflows.status is
  'active | paused | archived — what the rail renders, including the err-dot beside the mockup''s paused hotfix-p0. archived is the soft delete that keeps a workflow''s history readable after it stops being offered; there is deliberately no draft value, because unpublished work is a draft row, not a status.';
comment on column ouroboros.workflows.current_version is
  'Which published version is in force — the v14 chip. A pointer, not a cache of max(version): a rollback to an earlier published version is this column moving and no history changing. Null is nothing in force yet, which is a workflow that has only ever had a draft. Held to a real published version of this workflow by workflows_current_version_fk.';
comment on constraint workflows_organization_slug_key on ouroboros.workflows is
  'One slug per workspace (#132) — the acceptance criterion, and the index a workflow_tag resolves through. Per workspace rather than globally, because two tenants both running a standard-fix is the ordinary case.';
comment on constraint workflows_slug_format on ouroboros.workflows is
  'Lower-case kebab, at most 64 characters — the bound runs.workflow_tag and queue_items.workflow_tag already have, so no storable tag is too long to be a slug. Folded, so uniqueness cannot be defeated by capitalisation.';
comment on constraint workflows_status_valid on ouroboros.workflows is
  'The rail''s three states (#132). A closed vocabulary rather than free text, because paused is what the err-dot is rendered from.';
comment on constraint workflows_current_version_positive on ouroboros.workflows is
  'Versions start at 1, so a pointer at 0 or below names nothing. The foreign key refuses it too; this refuses it at the column, where the complaint is about the number rather than about a missing row.';

-- ---------------------------------------------------------------------------
-- workflow_versions
-- ---------------------------------------------------------------------------
create table ouroboros.workflow_versions (
  id           uuid        primary key default gen_random_uuid(),

  -- The workflow this is a version of, and — see the header — the whole of this row's tenancy.
  -- Cascade: deleting a workflow takes its history with it.
  workflow_id  uuid        not null
                           references ouroboros.workflows (id) on delete cascade,

  -- **The version number, and null is the draft.** Assigned by publishing, dense from 1, and
  -- never reused. See the header for why this is the draft marker rather than an is_draft flag.
  version      integer,

  -- The P.2 DSL document. Checked to be an object and no further — the grammar is #133's, and
  -- an empty `{}` is the legal state of a canvas nobody has placed a node on yet.
  definition   jsonb       not null,

  -- **When this became a version.** Null exactly while `version` is null, which is the one
  -- rule that keeps "is this a draft" from having two answers.
  published_at timestamptz,

  -- **Who pressed Publish.** Nullable and `on delete set null`, for `route_revisions.actor`'s
  -- reason: a version can be published by something other than a person — a seed, a template
  -- import — and the record of what was published must survive the publisher leaving. The
  -- set-null is an UPDATE, which is the one exception workflow_versions_no_update carries.
  --
  -- Deliberately not additionally constrained to a member of this workspace, on `V011`'s
  -- argument: membership is revocable, and re-checking it later would make a historical row
  -- unwritable because of somebody's resignation. That they were allowed at the time is the
  -- endpoint's question, asked when it mattered.
  published_by text        references ouroboros."user" ("id") on delete set null,

  -- What changed, in the publisher's words. Optional — a publish with nothing to say is
  -- ordinary — but never blank, because an empty string is a note that lost its text rather
  -- than one that was never written.
  change_note  text,

  created_at   timestamptz not null default now(),

  -- **Last edited**, and the mockup's *Last edited 2h ago*. Moved by the touch trigger only
  -- while the row is a draft: a published version cannot be edited, so its stamp stays where
  -- publishing left it rather than drifting when the foreign key erases an attribution.
  updated_at   timestamptz not null default now(),

  -- --- one version number per workflow, once --------------------------------------
  --
  -- Read backwards it is also the history's index — `order by version desc` is this b-tree
  -- read in reverse, `V026`'s measurement unchanged — and it is what makes the density rule
  -- safe under concurrency: two publishers that both computed max + 1 cannot both commit.
  --
  -- Null versions are distinct to a unique key, so this says nothing about drafts. That rule
  -- is workflow_versions_one_draft_idx, deliberately separate so its name can say so.
  constraint workflow_versions_workflow_version_key unique (workflow_id, version),

  constraint workflow_versions_version_positive
    check (version is null or version >= 1),

  -- A number and a publish stamp arrive together or not at all. This is what makes
  -- `version is null` a *definition* of draft rather than a convention about one.
  constraint workflow_versions_version_publish_stamp
    check ((version is null) = (published_at is null)),

  -- A draft has no publisher and no change note: both describe a publish that has not
  -- happened. Publishing sets them in the same statement that sets the number.
  constraint workflow_versions_draft_unattributed
    check (published_at is not null or (published_by is null and change_note is null)),

  -- The document is a document. Its grammar is P.2's (#133) — see the header for why this
  -- stops here, and why `{}` has to be legal.
  constraint workflow_versions_definition_object
    check (jsonb_typeof(definition) = 'object'),

  constraint workflow_versions_change_note_present
    check (change_note is null or (btrim(change_note) <> '' and length(change_note) <= 500))
);

comment on table ouroboros.workflow_versions is
  'A workflow''s version history plus its one mutable draft (#132, P.1, decision P1). Published rows — every row with a version number — are immutable, because a run pins the version it executed and editing one would rewrite what that run did. The draft is the unnumbered row, and publishing is that row being given the next number: a draft exists exactly when there are unpublished changes.';
comment on column ouroboros.workflow_versions.workflow_id is
  'The workflow this is a version of, and the whole of this row''s tenancy — V017''s and V026''s choice, since a version has no meaning apart from a workflow and every read enters through one. ON DELETE CASCADE.';
comment on column ouroboros.workflow_versions.version is
  'The published version number — dense from 1, assigned by publishing, never reused. NULL is the draft: a draft has no number because the number is what publishing confers, which is why the mockup''s button can say Publish v15. Held dense by workflow_versions_next_version and unique by workflow_versions_workflow_version_key.';
comment on column ouroboros.workflow_versions.definition is
  'The P.2 DSL document (#133). CHECKed to be a jsonb object and no further: the grammar has one owner and one published JSON Schema, and an empty {} is the legal state of a canvas with nothing on it yet.';
comment on column ouroboros.workflow_versions.published_at is
  'When this row became a version. Null exactly while version is null — workflow_versions_version_publish_stamp — so "is this the draft" has one answer.';
comment on column ouroboros.workflow_versions.published_by is
  'Who pressed Publish — "user".id, ON DELETE SET NULL. Nullable because a version can be published by a seed or a template import, and set-null rather than cascade because removing a person must not delete what they published. That set-null is an UPDATE, and it is the one update workflow_versions_no_update permits.';
comment on column ouroboros.workflow_versions.change_note is
  'What changed, in the publisher''s words. Optional, never blank, and never on a draft — it describes a publish, and a draft has not had one.';
comment on column ouroboros.workflow_versions.updated_at is
  'Last edited — the mockup''s "Last edited 2h ago". Moved by the touch trigger only while the row is a draft; a published version cannot be edited, so its stamp stays where publishing left it.';
comment on constraint workflow_versions_workflow_version_key on ouroboros.workflow_versions is
  'One version number per workflow, once (#132) — and, read backwards, the index the history pages through. It is also what makes the density rule safe under concurrency: two publishers that both computed max + 1 cannot both commit. Says nothing about drafts, whose null versions are distinct to a unique key; that rule is workflow_versions_one_draft_idx.';
comment on constraint workflow_versions_version_publish_stamp on ouroboros.workflow_versions is
  'A version number and a publish stamp arrive together or not at all (#132). What makes `version is null` the definition of a draft rather than a convention about one — with a separate is_draft flag there would be two facts and a rule about which of them wins.';
comment on constraint workflow_versions_draft_unattributed on ouroboros.workflow_versions is
  'A draft has no publisher and no change note (#132): both describe a publish that has not happened. Publishing sets all four columns in the statement that numbers the row.';
comment on constraint workflow_versions_definition_object on ouroboros.workflow_versions is
  'The definition is a jsonb object (#132). The grammar itself is P.2''s (#133), deliberately not half-copied here; an empty {} is legal because that is what + New workflow leaves on the canvas.';

-- ---------------------------------------------------------------------------
-- At most one draft per workflow.
--
-- Acceptance criterion, and the index the studio finds the draft through — `where workflow_id
-- = $1 and version is null` is this index exactly. A partial unique index rather than
-- `unique nulls not distinct` on the version key, because a writer told
-- `workflow_versions_one_draft_idx` has been told the rule and one told
-- `workflow_versions_workflow_version_key` has been told that a version number collided, which
-- is not what happened.
--
-- It is also where two concurrent *"start editing"* requests meet: both read no draft, both
-- insert, and exactly one commits.
-- ---------------------------------------------------------------------------
create unique index workflow_versions_one_draft_idx
  on ouroboros.workflow_versions (workflow_id)
  where version is null;

comment on index ouroboros.workflow_versions_one_draft_idx is
  'At most one draft per workflow (#132) — the acceptance criterion as a database rule, and the index the studio''s "open the draft" read uses. Where two concurrent start-editing requests collide instead of producing two drafts nobody can choose between.';

-- ---------------------------------------------------------------------------
-- Versions are dense from 1.
--
-- See the header for why dense rather than merely ascending, and why this refuses a wrong
-- number instead of assigning a right one.
--
-- Fires on insert *and* update, because both are publishes: promoting the draft in place is
-- an UPDATE that gives an unnumbered row a number, and inserting a numbered row directly is
-- the copy-on-publish writer this schema does not forbid. A draft — new.version null — carries
-- no number and is returned untouched.
--
-- An update that leaves `version` where it was is returned untouched too, and that guard is
-- load-bearing rather than an optimisation: `delete from "user"` sets `published_by` to null on
-- every version that person published, and without it v3 of a workflow published to v14 would
-- be measured against a next number of 15 and refused — making a person undeletable because
-- they once pressed Publish. The rule is about a version number coming into existence or
-- changing, and this is that rule stated exactly.
--
-- The row being written is deliberately *not* excluded from `max`. An attempt to renumber a
-- published v14 to v15 therefore passes here — 14 is in the maximum, 15 is the next number —
-- and is refused by workflow_versions_no_update instead, which is the right refusal for what
-- was actually attempted.
--
-- A number below 1 passes through on a related argument: `workflow_versions_version_positive`
-- is the rule about the number, this is the rule about the sequence, and a constraint whose
-- refusal is always pre-empted by a trigger is one no test can reach.
-- ---------------------------------------------------------------------------
create function ouroboros.workflow_version_next() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  if new.version is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.version is not distinct from old.version then
    return new;
  end if;

  -- Below 1 is the column's rule rather than this one. Passing it through leaves
  -- workflow_versions_version_positive to make the complaint, which is about the number
  -- itself — and a rule whose refusal is always pre-empted by another is a rule nothing can
  -- check.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.workflow_versions
   where workflow_id = new.workflow_id;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next version of workflow % is v%, not v% (highest published: %)',
      new.workflow_id, coalesce(highest, 0) + 1, new.version,
      coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.workflow_version_next() is
  'BEFORE INSERT OR UPDATE trigger for workflow_versions (#132): a published version must be exactly one above the highest that workflow has, and the first is 1. Dense rather than merely ascending, because the number is printed as the mockup''s v14 chip and a gap would be a defect with no explanation — nothing deletes a published version. Refuses rather than assigns, as V026 does: two publishers racing both compute max + 1, and the unique key lets one commit, which is a retry a writer must see. An update that does not move the version is passed through, which is what keeps the published_by foreign key''s set-null — and so deleting a person — from being refused by a numbering rule. Raises class 23 naming the trigger, so a rejection reports workflow_versions_next_version.';

create trigger workflow_versions_next_version
  before insert or update on ouroboros.workflow_versions
  for each row execute function ouroboros.workflow_version_next();

comment on trigger workflow_versions_next_version on ouroboros.workflow_versions is
  'Publishing creates version N+1 (#132), on insert and on update alike — promoting the draft in place is an update that numbers an unnumbered row. A draft carries no number and passes straight through.';

-- ---------------------------------------------------------------------------
-- Immutable once published, in the database rather than in the grants.
--
-- See the header. `V022`'s trigger with `V022`'s single exception, and the draft explicitly
-- let through: this table is not append-only, it is *immutable-after-publish*, and the draft
-- is the row that difference exists for.
-- ---------------------------------------------------------------------------
create function ouroboros.workflow_versions_refuse_update() returns trigger
language plpgsql
as $$
begin
  -- The draft is the mutable row. Editing it is what the studio does all day, and promoting it
  -- to a version is the publish itself — numbering, stamping and attributing in one statement,
  -- after which this branch is never taken for that row again.
  if old.version is null then
    return new;
  end if;

  -- The one update a published version permits, and it is not a revision: `published_by`
  -- going from a person to null, with every other column untouched.
  --
  -- That statement is the foreign key's own — `on delete set null` is implemented as an UPDATE
  -- of the child row — so a trigger that refused every update would not be making this table
  -- immutable, it would be making `delete from "user"` fail.
  --
  -- Narrow on purpose: what may change is the attribution and nothing else, and it may only be
  -- *erased*. Null to a name is refused, one name to another is refused, and a definition
  -- edited in the same statement is refused whatever happens to the publisher.
  if new.published_by is null and old.published_by is not null
     and row(new.id, new.workflow_id, new.version, new.definition,
             new.published_at, new.change_note, new.created_at, new.updated_at)
         is not distinct from
         row(old.id, old.workflow_id, old.version, old.definition,
             old.published_at, old.change_note, old.created_at, old.updated_at)
  then
    return new;
  end if;

  raise exception
    'ouroboros.workflow_versions is immutable once published: v% cannot be revised',
    old.version
    using errcode = 'restrict_violation',
          detail  = format('refused update of version %s of workflow %s (row %s)',
                           old.version, old.workflow_id, old.id),
          hint    = 'Edit the draft and publish the next version instead; only published_by may be cleared, and only by the foreign key''s own set-null. See V029__workflows_versions.sql (#132).';
end;
$$;

comment on function ouroboros.workflow_versions_refuse_update() is
  'Refuses every UPDATE of a published workflow version (#132, decision P1), for any role including the owner — V022''s argument: the development stack connects as the database owner and a superuser bypasses every grant, so a rule that only lived in the catalogue would be true in production and false on the machine the code is written on. Two updates pass: any edit of the draft, which is the row this table is mutable for, and the published_by foreign key''s own ON DELETE SET NULL — what was published cannot be rewritten, who published it can be forgotten.';

create trigger workflow_versions_no_update
  before update on ouroboros.workflow_versions
  for each row execute function ouroboros.workflow_versions_refuse_update();

comment on trigger workflow_versions_no_update on ouroboros.workflow_versions is
  'A published version cannot be revised (#132) — the acceptance criterion, enforced for every role. There is deliberately no delete counterpart, for V022''s reason: workflow_id cascades, and a delete-refusing trigger would not protect the history, it would make removing a workflow or a workspace fail. What cannot be deleted is the version something points at, which workflows_current_version_fk refuses.';

-- ---------------------------------------------------------------------------
-- Touch triggers.
--
-- `workflows.updated_at` is ordinary. `workflow_versions.updated_at` is conditional: only a
-- draft has a last-edited time, so the trigger is scoped to the rows that can be edited. Were
-- it unconditional, the one update a published row permits — the publisher foreign key's
-- set-null — would move a stamp on an immutable row, and `updated_at` would quietly come to
-- mean *when somebody was forgotten*.
--
-- The publish itself is an update of a draft (`old.version is null`), so it stamps, which is
-- right: publishing is the last time that row changed.
--
-- Trigger names decide firing order within an event, and these sort after the two above —
-- `workflow_versions_next_version`, `workflow_versions_no_update`, then the touch — so a
-- refused update is refused before a stamp is computed for it.
-- ---------------------------------------------------------------------------
create trigger workflows_touch_updated_at
  before update on ouroboros.workflows
  for each row execute function ouroboros.touch_updated_at();

create trigger workflow_versions_touch_updated_at
  before update on ouroboros.workflow_versions
  for each row when (old.version is null)
  execute function ouroboros.touch_updated_at();

comment on trigger workflow_versions_touch_updated_at on ouroboros.workflow_versions is
  'Stamps a draft''s last-edited time (#132), and only a draft''s: a published version cannot be edited, so an unconditional touch would only ever fire for the publisher set-null and would turn updated_at into "when somebody was forgotten". The publish is itself an update of a draft, so it stamps.';

-- ---------------------------------------------------------------------------
-- The pointer's key.
--
-- Added here rather than inside `create table ouroboros.workflows` because the two tables
-- reference each other and one has to exist first — `V016`'s one `alter`, for the same reason.
--
-- `no action` rather than `restrict`: they differ only in when the check runs, and
-- end-of-statement is what lets `delete from workflows` work, since the cascade that removes
-- the versions and the row that pointed at one belong to the same statement.
-- ---------------------------------------------------------------------------
alter table ouroboros.workflows
  add constraint workflows_current_version_fk
  foreign key (id, current_version)
  references ouroboros.workflow_versions (workflow_id, version);

comment on constraint workflows_current_version_fk on ouroboros.workflows is
  'current_version names a published version of this workflow (#132), or nothing at all. A composite key, V015''s and V016''s pattern applied to a pointer: a version number belonging to a different workflow, or one never published, is unstorable. MATCH SIMPLE admits the null, which is a workflow that has only ever had a draft. ON DELETE NO ACTION rather than RESTRICT so the check falls at the end of the statement, where deleting a workflow has already taken its versions and its pointer together.';
