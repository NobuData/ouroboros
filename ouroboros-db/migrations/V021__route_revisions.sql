-- V021__route_revisions.sql — `route_revisions`: who changed the routing table, when, and
-- exactly what moved.
--
-- Filed as issue #195 (Z.2), the routing management API. Needs V016 (#190) and V018 (#191).
-- Read later by the audit log (#26), which is the surface these rows exist to feed.
--
-- Mockup 06 (docs/mockups/06-model-routing.html) puts a **Save routes** button in the page
-- head and a hint under the matrix — *"drag ⠿ to reorder fallback chains"*. The editing
-- model is therefore explicitly **staged, not live**: edits accumulate in the browser and
-- commit as one batch when somebody presses the button. This table is what that press
-- leaves behind.
--
-- ---------------------------------------------------------------------------
-- Why a batch commit to routing deserves a row of its own.
-- ---------------------------------------------------------------------------
--
-- The routing table decides where every token of every run goes. When a tenant asks why
-- last Tuesday's runs went to the fallback provider, *"somebody saved the routes at some
-- point"* is not an answer — and it is the only answer `routes.updated_by` and
-- `routes.updated_at` can give, because both are overwritten by the next save. They record
-- the **current** state's author; this table records the **transitions**.
--
-- It is deliberately cheap. Three facts — an actor, a stamp and a diff — and no attempt at
-- a general-purpose event log: #26 owns that, and a routing-specific table it can read is a
-- smaller promise than an event bus it would have to be designed around.
--
-- V016 anticipated this table in as many words, and the sentence is worth repeating because
-- it is the reason `routes` has no `is_active` flag:
--
--   > When versioned route configuration arrives it is history in a table of its own, where
--   > a superseded revision cannot be mistaken for a route that is merely switched off.
--
-- This is that table, and it holds history rather than versions: a revision is *what
-- changed*, not a copy of the route as it then stood. A snapshot table would answer "what
-- did the chain look like on Tuesday" without a join and would grow by the whole matrix on
-- every save, most of it unchanged; a diff answers the question anybody actually asks —
-- *what did somebody do* — and is small enough that nothing has to prune it.
--
-- ---------------------------------------------------------------------------
-- The diff's shape, and why it is checked rather than trusted.
-- ---------------------------------------------------------------------------
--
-- `diff` is one document per save, holding one entry per **route that changed**:
--
--   {
--     "routes": [
--       {
--         "task_kind": "implement",
--         "changes": {
--           "hops":                   {"from": [{"alias": "coder-max",  "note": "Primary"}],
--                                      "to":   [{"alias": "coder-max",  "note": "Primary"},
--                                               {"alias": "local-docs", "note": null}]},
--           "floor_hop_index":        {"from": null, "to": 2},
--           "max_cost_cents_per_run": {"from": 250,  "to": 500}
--         }
--       }
--     ]
--   }
--
-- Keys inside `changes` are **column names**, and hops are named by `model_aliases.alias`
-- rather than by uuid. Both choices are about the reader: a revision is read by a person
-- reconstructing a decision, months later, possibly after the alias has been repointed —
-- and `coder-max` is what they will have been told, while a uuid is a lookup into a row
-- that may no longer say what it said. That the alias names may have moved on is the
-- honest state of a historical record and is why this is history rather than a foreign key.
--
-- The CHECK is `ouroboros.route_revision_diff_valid()` below. A jsonb column with no shape
-- rule is a column that holds four shapes within a year — one per service that ever wrote
-- to it — and #26 would then be reading a union nobody wrote down. The function is
-- `immutable` and reads no table, so it costs one expression evaluation per insert.
--
-- **A save that changed nothing writes no row**, which is the other half of the same rule:
-- `changes` must be non-empty, so an empty revision is unstorable by construction rather
-- than by a service remembering not to write one. An audit trail whose rows mostly say
-- *somebody pressed Save and nothing moved* is an audit trail nobody reads to the end.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here.
-- ---------------------------------------------------------------------------
--
--   * **No `route_id`.** A revision names its routes by `task_kinds.name` inside the diff,
--     for the reason the aliases are named: the row survives the route being deleted and
--     recreated, which is exactly the interval somebody will be asking about. A foreign key
--     would have to cascade (destroying the record) or restrict (making a task kind
--     undeletable once it has ever been saved), and both are worse than a name.
--   * **No `revert`.** Reading a revision back onto a route is an operation with its own
--     failure modes — an alias in the `from` may no longer exist — and it belongs to
--     whichever ticket asks for the button, not to the table.
--   * **No rules.** The escalation-rules card is not part of the staged **Save routes**
--     batch; its switches commit immediately, one request each. A rules edit is therefore
--     not a route revision, and folding it in here would make `diff.routes` a name that
--     lies about half its contents.

-- ---------------------------------------------------------------------------
-- The diff's grammar.
--
-- `immutable` and table-free, which is what lets it sit in a CHECK: the shape of a document
-- is a property of the document, and a rule that reached into `task_kinds` would refuse to
-- validate a historical revision the moment somebody retired a kind — turning the audit
-- trail into something a future migration cannot re-check.
-- ---------------------------------------------------------------------------
create function ouroboros.route_revision_diff_valid(revision_diff jsonb)
returns boolean language sql immutable as $$
  select
    -- One object with exactly one key, so a writer cannot smuggle a second vocabulary in
    -- beside `routes` and leave #26 reading a union.
    jsonb_typeof(revision_diff) = 'object'
    and revision_diff ?& array['routes']
    and (select count(*) = 1 from jsonb_object_keys(revision_diff))
    and jsonb_typeof(revision_diff -> 'routes') = 'array'

    -- A revision with no routes in it is a save that changed nothing, and a row saying so
    -- is the noise this table exists without.
    and jsonb_array_length(revision_diff -> 'routes') >= 1

    and not exists (
      select 1
      from jsonb_array_elements(revision_diff -> 'routes') as entry
      where not (
        jsonb_typeof(entry) = 'object'
        and entry ?& array['task_kind', 'changes']
        and (select count(*) = 2 from jsonb_object_keys(entry))

        -- Shaped as `task_kinds.name` is (V016), so a diff can only ever name something
        -- that table could have held. The shape rather than a reference — see the header.
        and jsonb_typeof(entry -> 'task_kind') = 'string'
        and entry ->> 'task_kind' ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        and length(entry ->> 'task_kind') <= 64

        and jsonb_typeof(entry -> 'changes') = 'object'
        and (select count(*) >= 1 from jsonb_object_keys(entry -> 'changes'))

        -- Every change is a before and an after, and nothing else. `from` and `to` may hold
        -- any json — null for a policy that was off, an array for a chain — because what a
        -- column holds is that column's business; that a change *has two sides* is this
        -- table's, and it is the property a reader depends on.
        and not exists (
          select 1
          from jsonb_each(entry -> 'changes') as change(key, value)
          where not (
            jsonb_typeof(change.value) = 'object'
            and change.value ?& array['from', 'to']
            and (select count(*) = 2 from jsonb_object_keys(change.value))
          )
        )
      )
    );
$$;

comment on function ouroboros.route_revision_diff_valid(jsonb) is
  'The shape of a route revision''s diff (#195): {routes: [{task_kind, changes: {<column>: {from, to}}}]} — at least one route, at least one change per route, every change a from/to pair, and task kinds shaped as task_kinds.name is. Immutable and table-free, so it can sit in a CHECK and so a historical revision stays re-checkable after the kinds it names have been retired.';

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table ouroboros.route_revisions (
  -- Surrogate key, and what a save answers with: the API returns `revisionId` so a client
  -- can name the commit it just made without correlating by clock.
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a revision is that workspace's history and goes with it.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- **Who pressed Save.**
  --
  -- Nullable and `on delete set null`, for the reason `routes.updated_by` is: a route can
  -- be written by something other than a person — a seed, an onboarding default — and the
  -- record of *what changed* must survive the person leaving the company. Cascading here
  -- would delete the audit trail of everybody who has ever left, which is the opposite of
  -- what an audit trail is for.
  --
  -- Deliberately not additionally constrained to a member of this workspace, on V011's
  -- argument: membership is revocable, and re-checking it later would make a historical row
  -- unwritable because of somebody's resignation. That they were *allowed* at the time is
  -- the endpoint's question (Z.2's role gate), asked when it mattered.
  actor           text        references ouroboros."user" ("id") on delete set null,

  -- **What moved.** See the header for the document, and the function above for its rules.
  diff            jsonb       not null,

  -- **When.** No `updated_at` beside it and no touch trigger: a revision is an event, and
  -- an event that can be edited is not one. Nothing in this schema updates this table.
  created_at      timestamptz not null default now(),

  constraint route_revisions_diff_shape
    check (ouroboros.route_revision_diff_valid(diff))
);

comment on table ouroboros.route_revisions is
  'One row per Save routes batch commit (#195, Z.2) — actor, stamp and a diff of exactly what changed. The audit trail behind mockup 06''s staged editing model, and the feed the audit log (#26) reads: routes.updated_by records who wrote the current state, this records the transitions. Append-only by design — no updated_at, no touch trigger, and a diff whose shape is CHECKed so #26 is not reading a union of whatever four services happened to write.';
comment on column ouroboros.route_revisions.organization_id is
  'The workspace. ON DELETE CASCADE — a revision is that workspace''s history and goes with it.';
comment on column ouroboros.route_revisions.actor is
  'Who pressed Save routes — "user".id, ON DELETE SET NULL. Nullable because a route can be written by a seed or an onboarding default, and set-null rather than cascade because deleting a person must not delete the record of what they changed. Whether they were allowed is the endpoint''s role gate, asked at the time.';
comment on column ouroboros.route_revisions.diff is
  'What changed: {routes: [{task_kind, changes: {<column>: {from, to}}}]}. Column names as keys and model_aliases.alias for hops, because a revision is read by a person reconstructing a decision months later — a uuid is a lookup into a row that may no longer say what it said. Shape held by route_revisions_diff_shape; a save that changed nothing is unstorable, which is why one is never written.';
comment on column ouroboros.route_revisions.created_at is
  'When the batch committed. There is no updated_at: a revision is an event, and an event that can be edited is not one.';
comment on constraint route_revisions_diff_shape on ouroboros.route_revisions is
  'The diff''s grammar (#195), via ouroboros.route_revision_diff_valid(): at least one route, at least one change per route, and every change a {from, to} pair. A jsonb column with no shape rule holds four shapes within a year, one per service that ever wrote to it.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- One, and it is the only read this table has: a workspace's revisions, newest first —
-- what #26 pages and what a support question starts from. `id` is in the key as the
-- tiebreaker, so two saves inside the same millisecond still page deterministically rather
-- than swapping places between requests.
--
-- Nothing reads by actor. When #26 wants *what did Maya change*, that is a filter over a
-- workspace's own revisions, which enters through this index's leading column; an index
-- nothing reads is still an index every insert maintains.
-- ---------------------------------------------------------------------------
create index route_revisions_organization_created_at_idx
  on ouroboros.route_revisions (organization_id, created_at desc, id desc);

comment on index ouroboros.route_revisions_organization_created_at_idx is
  'A workspace''s revisions, newest first (#195) — the audit log''s page (#26) and the first read of any support question about a routing change. id breaks the tie so two saves in the same millisecond page deterministically.';
