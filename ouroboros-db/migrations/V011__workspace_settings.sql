-- V011__workspace_settings.sql — org-scoped product settings, and the view every reader
-- resolves them through.
--
-- The fourth and last table of the dashboard read-model, and the only one behind a
-- *write*. Mockup 02's *Loop pulse* card (`c-4`, docs/mockups/02-dashboard.html) renders
-- **Auto-merge when checks pass** as a working switch — decision F6, and the single
-- mutation on a page that is otherwise six read surfaces. `auto_merge_on_checks` is what
-- that switch is, and this table is where the next twenty settings land beside it when
-- mockup 17's workspace settings screen arrives: it joins this table rather than
-- replacing it.
--
-- **Typed columns, not key/value** — the roadmap's house rule, and worth restating
-- because a settings table is the classic place the rule gets broken. A `(key, value)`
-- pair buys the ability to add a setting without a migration, and pays for it with
-- everything that makes a database worth having: `auto_merge_on_checks` stops being a
-- boolean and becomes text that is usually `'true'`, no CHECK can describe a column whose
-- meaning depends on a sibling row, Kysely infers `string` for every setting in the
-- product, and a typo in a key name is a silently absent setting rather than a compile
-- error. A new setting here is an ordinary additive migration, which is the price this
-- schema already pays everywhere else and the one that keeps the compiler useful.
--
-- ---------------------------------------------------------------------------
-- **Decision — row creation is LAZY. There is no creation trigger, and absence is a
-- valid, expected state meaning "every setting is at its default".**
--
-- The acceptance criterion asks for one or the other, so this is the argument for the one
-- chosen.
--
-- A creation trigger on `ouroboros.organization` would guarantee a row per workspace and
-- make `GET` a plain `select` and `PATCH` a plain `update`. Three things are wrong with
-- it here. It writes a row recording a choice nobody made, so this table stops being a
-- record of *decisions* and becomes a partial mirror of the defaults — and a row whose
-- `updated_by` is null and whose `updated_at` is the workspace's creation date is an
-- audit trail asserting something that did not happen. It hangs product behaviour off a
-- trigger on a table BetterAuth writes, so organization creation acquires a failure mode
-- the library cannot see. And it is not actually sufficient on its own: it would need a
-- backfill for the workspaces that already exist, which means the "every organization has
-- a row" invariant is maintained in two places from the first day, and is quietly broken
-- by anything that loads organizations outside the trigger's reach.
--
-- V007 settled this shape already for `user_preferences` — "absence is an answer" — and
-- this is the same shape one level up. What is different, and what the rest of this
-- decision is about, is that V007 left the default to the API to synthesize. That is one
-- `coalesce` per reader, and a reader that forgets it renders *unset* where the product
-- means *off*. So the default is not left to a reader here:
--
--   `ouroboros.workspace_settings_effective` is the read side. It is
--   `organization LEFT JOIN workspace_settings` with the defaults coalesced in, so every
--   organization has exactly one row in it whether or not anyone has ever touched a
--   setting, and a newly created workspace reads `auto_merge_on_checks = false` from the
--   database rather than from an application's memory of what the default was.
--
-- The write side is the table, and one statement covers both the first write and every
-- later one:
--
--   insert into ouroboros.workspace_settings
--          (organization_id, auto_merge_on_checks, updated_by)
--     values ($1, $2, $3)
--   on conflict (organization_id) do update
--     set auto_merge_on_checks = excluded.auto_merge_on_checks,
--         updated_by           = excluded.updated_by;
--
-- — which is why the primary key matters beyond "one row per organization is enforced":
-- it is the arbiter that makes the upsert atomic, so two concurrent PATCHes cannot both
-- decide the row is missing. G.5 (#74) is the endpoint that runs it.
--
-- The cost of the view is one duplicated literal: `false` is written both as the column
-- default and as the coalesce. There is no way to spell "the column's default" in a view
-- that is not an introspection query, so the two are bound by an assertion instead —
-- tests/constraints.sql reads the same setting through an organization with a default row
-- and an organization with no row and requires the answers to match, which fails if a
-- later migration moves one without the other.
-- ---------------------------------------------------------------------------
--
-- **Nothing writes this table yet**, as with `runs` (V008, #64), `queue_items` (V009,
-- #65) and `token_usage` (V010, #66): the seed rows are F.5 (#68) and the endpoint is G.5
-- (#74). So every rule a reader depends on is a database constraint rather than an
-- application invariant — the writers do not exist to be trusted yet.
--
-- House snake_case throughout — decision A4. `organization` and `"user"` are referenced
-- by their quoted camelCase `"id"` because that is BetterAuth's column, and `"user"` is
-- quoted at every mention because unquoted it is a reserved word; everything this file
-- creates is ours.
--
-- Filed as issue #67 (F.4).

-- ---------------------------------------------------------------------------
-- workspace_settings
-- ---------------------------------------------------------------------------
create table ouroboros.workspace_settings (
  -- The workspace, and the key: one row of settings each, which is the acceptance
  -- criterion's "one row per organization" stated as a primary key rather than as a
  -- unique index beside a surrogate id. There is no second candidate key here and no
  -- child table to reference this one, so a surrogate would buy nothing and would let two
  -- rows for one workspace exist long enough for a unique index to reject the second.
  --
  -- It is also what the upsert in the header conflicts on. BetterAuth ids are text (V005).
  --
  -- Cascade, as on every table in this read-model: settings for a workspace that no
  -- longer exists are unreachable by definition, and leaving them would make a later
  -- workspace that happened to reuse an id inherit somebody else's auto-merge posture.
  organization_id      text        not null primary key
                                   references ouroboros.organization ("id")
                                   on delete cascade,

  -- The switch. Decision F6, and the first typed column of what mockup 17 will extend.
  --
  -- **Default false, and the default is the safe direction.** True means the loop merges
  -- its own pull requests without a person looking at them, so a workspace that has never
  -- answered the question must not be answered *for* it in the direction that acts. A
  -- workspace that wants it says so, and `workspace_settings_effective` below is what
  -- makes "has never answered" and "answered false" the same value to a reader.
  --
  -- `boolean not null`, not a nullable one: null would be a third state — "unset" — and
  -- the whole point of the view is that unset is not a state the product has. Absence of
  -- the *row* carries that, and it carries it in one place.
  auto_merge_on_checks boolean     not null default false,

  -- Who last changed a setting here. Nullable, and it is worth saying why for both
  -- reasons it can be null: nothing has to have been changed by a *person* (an onboarding
  -- default or a support action has no user to name), and the reference below sets this
  -- to null when the person is deleted.
  --
  -- **`on delete set null`, emphatically not cascade.** Cascade would delete the settings
  -- row when the person who last touched it left — which does not un-answer the question,
  -- it silently reverts the workspace's auto-merge posture to `false` because the row the
  -- answer lived in is gone. That is a security-relevant setting changing itself as a side
  -- effect of an unrelated account deletion, with nothing anywhere recording that it
  -- happened. The same reasoning as V010's `run_id`: what is genuinely lost when the
  -- parent goes is the attribution, not the fact.
  --
  -- Deliberately **not** additionally constrained to a member of this organization. The
  -- authorization rule — owner or admin — is BA-C.3's role guard on the endpoint, and a
  -- write-time trigger here could assert membership at the moment of the write but could
  -- not maintain it: membership is revocable, so an ordinary departure would leave rows
  -- this table considers invalid, and re-checking them on an unrelated update would refuse
  -- a legitimate write on the strength of somebody else's resignation. This column records
  -- *who*, which stays true; whether they were allowed is the endpoint's question, asked
  -- at the time it mattered.
  updated_by           text        references ouroboros."user" ("id") on delete set null,

  created_at           timestamptz not null default now(),

  -- Moved by the V001 trigger below rather than by whoever writes the row, so the upsert
  -- in the header does not have to remember to set it — and so that a writer cannot
  -- report a change as older than it is. The audit pair is this and `updated_by`: when,
  -- and by whom.
  updated_at           timestamptz not null default now()
);

comment on table ouroboros.workspace_settings is
  'Org-scoped typed product settings (#67) — one row per workspace, holding CHOICES only. A workspace with no row is at every default; read through workspace_settings_effective, which resolves that, and write with an ON CONFLICT upsert on the primary key. Row creation is lazy by decision: see the migration header. Mockup 17 joins this table rather than replacing it.';
comment on column ouroboros.workspace_settings.organization_id is
  'The workspace, and the key — "one row per organization" as a primary key, which is also what the settings upsert conflicts on. Cascades, so a deleted workspace leaves no settings behind for a reused id to inherit.';
comment on column ouroboros.workspace_settings.auto_merge_on_checks is
  'Mockup 02''s Auto-merge when checks pass switch (decision F6) — the dashboard''s only write. Defaults false: a workspace that has never answered must not be answered for it in the direction that merges without review.';
comment on column ouroboros.workspace_settings.updated_by is
  'The person who last changed a setting here, or null — nothing requires a person, and ON DELETE SET NULL empties it when one is deleted. Never cascade: that would delete the row and silently revert the workspace to the default. Not constrained to a member; authorization is the endpoint''s (BA-C.3), and membership is revocable.';
comment on column ouroboros.workspace_settings.updated_at is
  'When a setting here last changed, moved by the touch_updated_at trigger rather than by the writer. With updated_by, the whole of the audit trail this table keeps.';

-- ---------------------------------------------------------------------------
-- Indexes — the primary key, and deliberately nothing else.
--
-- `updated_by` is a referencing column with `on delete set null`, which on a large table
-- would make every user deletion a sequential scan — the reason V010 indexes
-- `token_usage.run_id`. It is not indexed here, and the difference is cardinality rather
-- than taste: this table holds exactly one row per organization, so it is the smallest
-- table in the schema by construction and stays a handful of pages at any plausible
-- installation size. PostgreSQL would not choose the index for the cascade, and an index
-- nothing reads is still an index every write maintains.
--
-- The read path needs nothing either: every query is by primary key, because there is no
-- question this table answers that is not "what has *this* workspace chosen".
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger workspace_settings_touch_updated_at
  before update on ouroboros.workspace_settings
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- workspace_settings_effective — the read side, and where "default" is defined.
--
-- One row per organization, always, whether or not the workspace has ever set anything.
-- That is the whole purpose: it turns the lazy-row decision above from something every
-- caller has to know into something only this view knows. `GET /settings/auto-merge`
-- (#74) is a select from here by `organization_id` and nothing else, and the dashboard
-- aggregate (#70) joins it for the switch's position.
--
-- Driven from `organization` rather than from `workspace_settings`, which is the part
-- that makes the acceptance criterion true at the database: a workspace created a second
-- ago has no settings row and still reads `auto_merge_on_checks = false` here.
--
-- `is_explicit` distinguishes the two states the coalesce merges, for the callers that
-- genuinely need them apart — onboarding (mockup 13) asking whether a workspace has been
-- through this question, and any surface that would otherwise render an audit line with
-- no timestamp in it. It is deliberately the only place the distinction survives; the
-- setting's *value* is the same either way, and nothing that renders the switch should
-- have to care.
--
-- `updated_at` and `updated_by` are passed through unresolved — null when there is no
-- row. That is correct rather than an oversight: coalescing them would have to invent a
-- time at which nothing happened.
--
-- A plain view, not materialized. It is a primary-key join over the smallest table in
-- the schema; there is nothing here to precompute.
--
-- `security_invoker = true` so reading through it requires the rights to read what it
-- reads — the same posture V010's rollup takes, and what stops a view from becoming a way
-- around the per-role privileges #25 will grant.
-- ---------------------------------------------------------------------------
create view ouroboros.workspace_settings_effective
  with (security_invoker = true) as
select o."id"                                  as organization_id,

       -- The default, and the one duplication this shape costs — see the header. Bound to
       -- the column default by assertion in tests/constraints.sql rather than by syntax,
       -- because a view cannot spell "whatever that column defaults to".
       coalesce(s.auto_merge_on_checks, false) as auto_merge_on_checks,

       -- Whether the workspace has answered, as opposed to what the answer is.
       (s.organization_id is not null)         as is_explicit,

       s.updated_at,
       s.updated_by
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

comment on view ouroboros.workspace_settings_effective is
  'Every organization''s settings with the defaults resolved (#67) — one row per workspace whether or not it has a workspace_settings row. The read side of the lazy-creation decision in V011''s header: it is what makes a newly created workspace read auto_merge_on_checks = false from the database rather than from an application default. Read here, write the table.';
comment on column ouroboros.workspace_settings_effective.auto_merge_on_checks is
  'The switch''s position (decision F6), false for a workspace that has never set it. Callers rendering the switch want this column and not is_explicit.';
comment on column ouroboros.workspace_settings_effective.is_explicit is
  'Whether the workspace has ever written a settings row — i.e. whether the values above are choices or defaults. For onboarding (mockup 13) and for audit lines; the switch itself does not need it.';
comment on column ouroboros.workspace_settings_effective.updated_at is
  'When a setting last changed, or null when nothing ever has. Not coalesced — there is no honest time to invent for a change that did not happen.';
