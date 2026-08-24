-- V025__alias_revisions.sql — `alias_revisions`: who changed a model alias, when, and what
-- moved — the lightweight revision record every registry write leaves behind.
--
-- Mockup 21's inspector is a write surface: **Save alias**, **Duplicate**, the **On** switch,
-- a rename in the name field, **Remove**. CH.1 (#584) is the API behind every one of them, and
-- its last acceptance criterion is *"every write leaves exactly one revision record"*. This
-- is the table that record lands in.
--
-- ---------------------------------------------------------------------------
-- Why a table of its own, and why not `audit_events`.
-- ---------------------------------------------------------------------------
--
-- V021 already answers the same question for routes: `routes.updated_by` and `updated_at`
-- say who wrote the state a route is *in*, both are overwritten by the next save, and the
-- transitions between them live in `route_revisions`. `model_aliases` has the same two
-- columns (V019's `updated_by`, V015's touch trigger) and the same blind spot — *who rebound
-- `coder-max` to what, when* is not a question the row can answer after the next edit — so
-- this is V021's table again, for the registry: an actor, a stamp, and a diff of exactly the
-- columns that changed.
--
-- It is deliberately **not** `audit_events` (V022). That table is the platform trail with the
-- append-only posture AD.4 specifies, its `detail` is grep-tested for secret material, and
-- promoting registry writes into it — with CJ.2's (#599) vocabulary of `alias.created`,
-- `alias.rebound` and the rest, and the inspector's History tab rendering rebind diffs as
-- `provider/model → provider/model` — is CJ.2's ticket, not this one. What #584 owes CJ.2 is a
-- shape that promotion can *copy* rather than rewrite, and the columns below are chosen for
-- that: `actor` is `audit_events.actor_id`, `action` is the event half of its
-- `family.event` grammar, `alias_id` is its `subject_id`, and `diff` is the before/after
-- document its `detail` will carry.
--
-- ---------------------------------------------------------------------------
-- The alias is a name *and* a reference, and the two do different jobs.
-- ---------------------------------------------------------------------------
--
-- `alias` is the name as it read after the write — `coder-max`, or `coder-max-copy` for a
-- duplicate — and it is text with no foreign key, for V021's reason: a revision is read by a
-- person reconstructing a decision months later, and a rename or a delete must not make the
-- record of the alias's earlier life unreadable. `alias_id` is the row it was about, and it is
-- a real foreign key that **sets null**: the History tab (CJ.2) reads *this alias's*
-- revisions by id, a deleted alias's `deleted` revision must survive the row it describes,
-- and a revision that outlives its alias is the ordinary case rather than a dangling one.
--
-- `actor` sets null too, for `routes.updated_by`'s reason — deleting a person must not delete
-- the record of what they changed — and is nullable because a seed or an import is not a
-- person.
--
-- ---------------------------------------------------------------------------
-- One action per write, from a closed vocabulary.
-- ---------------------------------------------------------------------------
--
-- A `PATCH` may rename, rebind and edit params in one request, and it still leaves exactly
-- one revision. `action` names the most consequential thing it did — the service ranks
-- `renamed` above `rebound` above `enabled`/`disabled` above `edited`, because that is the
-- order in which a reader of the History tab wants to be told — and `diff` carries every
-- column that moved, so nothing is lost to the ranking. `created`, `duplicated` and `deleted`
-- are the three lifecycle edges; a duplicate's diff records the alias it was copied from
-- under `duplicate_of`, which is a key of the same `{from, to}` shape and not a column.
--
-- ---------------------------------------------------------------------------
-- Append-only by construction, as V021 is.
-- ---------------------------------------------------------------------------
--
-- No `updated_at`, no touch trigger, and nothing in `ouroboros-rest` updates a row here: an
-- event that can be edited is not one. There is deliberately no update-refusing trigger
-- either — that is V022's and V024's posture for tables an operator's history *depends* on,
-- and CJ.2 is where these rows acquire that weight, by being promoted into V022's table.
--
-- Filed as issue #584 (CH.1). Written by `ouroboros-rest`'s alias lifecycle service; read by
-- CJ.2 (#599). Asserted in tests/constraints.sql.

-- ---------------------------------------------------------------------------
-- The diff's grammar: `{<column>: {from, to}}`, at least one entry.
--
-- Keys are column names — or `duplicate_of` — and every value is a from/to pair. A jsonb
-- column with no shape rule holds four shapes within a year, one per service that ever wrote
-- to it; this one has a service, a seed and CJ.2's promotion queueing up to read it.
-- ---------------------------------------------------------------------------
create function ouroboros.alias_revision_diff_valid(revision_diff jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(revision_diff) = 'object'
    and (select count(*) >= 1 from jsonb_object_keys(revision_diff))
    and not exists (
      select 1
        from jsonb_each(revision_diff) as change(key, value)
       where not (
         change.key ~ '^[a-z][a-z0-9_]*$'
         and length(change.key) <= 64
         and jsonb_typeof(change.value) = 'object'
         and change.value ?& array['from', 'to']
         and (select count(*) = 2 from jsonb_object_keys(change.value))
       )
    );
$$;

comment on function ouroboros.alias_revision_diff_valid(jsonb) is
  'The shape of an alias revision''s diff (#584): {<column>: {from, to}} — at least one entry, every key a column name (or duplicate_of), every value a from/to pair. Immutable and table-free, so it can sit in a CHECK and so a historical revision stays re-checkable after the alias it names is gone.';

create table ouroboros.alias_revisions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,
  alias_id        uuid        references ouroboros.model_aliases (id) on delete set null,
  alias           text        not null,
  actor           text        references ouroboros."user" ("id") on delete set null,
  action          text        not null,
  diff            jsonb       not null,
  created_at      timestamptz not null default now(),
  constraint alias_revisions_action
    check (action in ('created', 'renamed', 'rebound', 'enabled', 'disabled', 'edited',
                      'duplicated', 'deleted')),
  constraint alias_revisions_alias_shape
    check (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(alias) <= 64),
  constraint alias_revisions_diff_shape
    check (ouroboros.alias_revision_diff_valid(diff))
);

comment on table ouroboros.alias_revisions is
  'One row per registry write (#584, CH.1) — who changed a model alias, when, what the write was, and a diff of exactly the columns that moved. V021''s table again, for the registry: model_aliases.updated_by records who wrote the current state, this records the transitions. Append-only by construction — no updated_at, no touch trigger, nothing updates it. Promoted into audit_events by CJ.2 (#599), which is why its columns are that table''s nouns.';
comment on column ouroboros.alias_revisions.organization_id is
  'The workspace. ON DELETE CASCADE — a revision is that workspace''s history and goes with it.';
comment on column ouroboros.alias_revisions.alias_id is
  'The alias this revision was about — model_aliases.id, ON DELETE SET NULL. Null after the alias is deleted, which is what lets a deleted revision survive the row it describes; the name lives in alias for exactly that case.';
comment on column ouroboros.alias_revisions.alias is
  'The alias''s name as it read after the write — coder-max, or coder-max-copy for a duplicate. Text with no foreign key, so a rename or a delete cannot make the record of an earlier life unreadable. Shaped as model_aliases.alias is.';
comment on column ouroboros.alias_revisions.actor is
  'Who made the write — "user".id, ON DELETE SET NULL. Nullable because a seed or an import is not a person, and set-null rather than cascade because deleting a person must not delete the record of what they changed.';
comment on column ouroboros.alias_revisions.action is
  'What the write was: created | renamed | rebound | enabled | disabled | edited | duplicated | deleted. One per write — a request that renamed, rebound and edited at once records the most consequential of them, in that order, and its diff carries the rest.';
comment on column ouroboros.alias_revisions.diff is
  'What moved: {<column>: {from, to}}, one entry per model_aliases column that changed (plus duplicate_of for a duplicate). Every column of the row for created and deleted; only the changed ones otherwise. Shape held by alias_revisions_diff_shape, so a write that changed nothing is unstorable — which is why the service records none for it.';
comment on column ouroboros.alias_revisions.created_at is
  'When the write committed. There is no updated_at: a revision is an event, and an event that can be edited is not one.';
comment on constraint alias_revisions_diff_shape on ouroboros.alias_revisions is
  'The diff''s grammar (#584), via ouroboros.alias_revision_diff_valid(): at least one entry and every entry a {from, to} pair.';
comment on constraint alias_revisions_action on ouroboros.alias_revisions is
  'The eight things a registry write can be (#584). A vocabulary rather than a grammar because the History tab branches on it — CJ.2 renders a rebind differently from an edit.';

create index alias_revisions_organization_created_at_idx
  on ouroboros.alias_revisions (organization_id, created_at desc, id desc);

comment on index ouroboros.alias_revisions_organization_created_at_idx is
  'A workspace''s registry history, newest first (#584) — the org-level registry filter CJ.2 adds to the audit surface. id breaks the tie so two writes in the same millisecond page deterministically.';

create index alias_revisions_alias_idx
  on ouroboros.alias_revisions (alias_id, created_at desc);

comment on index ouroboros.alias_revisions_alias_idx is
  'One alias''s history, newest first (#584) — the inspector''s History tab (CJ.2) — and the referencing side of the alias_id foreign key, which PostgreSQL does not create: without it every alias delete scans this table to find the rows to set null.';
