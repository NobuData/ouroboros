-- V016__task_kinds_routes_hops.sql — `task_kinds`, `routes` and ordered `route_hops`:
-- the matrix row of mockup 06, and the inspector's numbered chain, as relations.
--
-- Filed as issue #190 (Y.2). Needs Y.1 (#189). Blocks Y.3 (#191), Y.4 (#192), Z.1 (#194)
-- and Z.2 (#195), and serves task-kind names to WF-R.3 (#145) through Z.4.
--
-- Mockup 06 (docs/mockups/06-model-routing.html) is what these three tables draw:
--
--   * the routing matrix's `8 task kinds` — `analyze`, `estimate`, `plan`, `implement`,
--     `test-gen`, `review`, `docs`, `commit-msg`, each with the second line that says what
--     it is (*"Write the change, run tests, iterate to green"*) — is `task_kinds`, in
--     `sort_order`,
--   * the route tag under each row (`implement-primary`) and the inspector's three policy
--     controls — **Allow fallback to local models**, **Fail run instead of degrading below
--     fallback 2**, **Max cost per run `$2.50`** — are one row of `routes`,
--   * the inspector's numbered chain — 1 `coder-max`, 2 `coder-fallback`, 3 `local-docs`,
--     each with its hop-meta line (*"Fallback on 5xx / timeouts"*) — is `route_hops` in
--     `position` order.
--
-- A matrix row is not a row of text. It is one task kind, exactly one route, an **ordered**
-- chain of hops and a policy triple, and each of those needs relational integrity that
-- resolution (Z.1, #194) can trust without re-validating it defensively on every call.
--
-- ---------------------------------------------------------------------------
-- Decision M1 — the raw model id is unreachable from here, by construction.
-- ---------------------------------------------------------------------------
--
-- `route_hops.model_alias_id` is a foreign key to `model_aliases` (V015). **There is no
-- `model_id`, `model` or `model_name` column anywhere in these three tables**, so a raw
-- provider model string cannot enter a route even by mistake — not by a migration, not by
-- a seed, not by a service that had one in hand and no alias for it.
--
-- V015 could only *state* M1, because the rule is about tables it did not create. This
-- migration is where it becomes structural: the inspector's footnote — *"Aliases resolve in
-- the Model registry — routes never name raw models"* — is now a property of the schema
-- rather than a promise in a comment. `tests/constraints.sql` reads `information_schema`
-- and asserts that the only column in these tables with `model` in its name is the uuid
-- foreign key, so the criterion is checked rather than reviewed.
--
-- ---------------------------------------------------------------------------
-- Decision M3 — task kinds are registry data, not an enum.
-- ---------------------------------------------------------------------------
--
-- The eight names are seeded (Y.4, #192), not compiled in. Three separate things reference
-- the same vocabulary — the WF stage catalog (#145), the estimator (#106) and the DSL's
-- `route.task(...)` — and a vocabulary hardcoded in three services is a vocabulary that
-- forks the first time one of them is edited alone. A table serves it to all three, and
-- Z.4 (#197) is the amendment that points the catalog here.
--
-- Registry data also means a workspace may add a ninth, which is why `name` is unique *per
-- organization* rather than globally, and why the eight arrive as seed rows in a
-- development database rather than as `insert`s in this file.
--
-- ---------------------------------------------------------------------------
-- Decision M4 — a route is an ordered alias chain plus policy, and the ordering is the
-- part that has to be enforceable.
-- ---------------------------------------------------------------------------
--
-- The matrix hint reads *"drag ⠿ to reorder fallback chains"*, and drag-reorder against a
-- `position` column with no guarantees is where this usually goes wrong: two rows land on
-- the same number, a delete leaves a gap, and the chain's *"fallback 2"* becomes ambiguous.
-- That is not cosmetic here, because the inspector's floor toggle — *"Fail run instead of
-- degrading below fallback 2"* — is a rule **about a hop number**. A chain whose numbering
-- is approximate makes the floor meaningless, and the page's promise that the loop *"never
-- silently degrades below the floor you set"* becomes unkeepable.
--
-- So two properties are enforced rather than conventional:
--
--   * **unique** — `route_hops_route_position_key`, so no two hops claim the same place,
--   * **dense from 1** — the `route_chain_intact()` constraint trigger, so the chain is
--     exactly `1 … n` with no gaps and no empty chain.
--
-- **How a reorder is performed, so Z.2 (#195) does not have to invent it.** Both rules are
-- `deferrable initially deferred`, which is V009's answer for `queue_items.position` and
-- for the same reason: PostgreSQL checks a unique index as each row version is written —
-- mid-statement, not at the end of it — so under an immediate constraint every ordinary
-- swap collides with the row already at the target position. Deferring moves both checks to
-- `commit`, where the ordering is once again valid, and a reorder is therefore plain SQL
-- with no ceremony in it:
--
--   begin;
--   update ouroboros.route_hops
--      set position = case position when 2 then 3 when 3 then 2 end
--    where route_id = $1 and position in (2, 3);
--   commit;
--
-- No `set constraints`, no shuffle through a temporary negative position — neither of which
-- a caller should have to know about, and the second of which `route_hops_position_positive`
-- would refuse anyway. A whole-chain rewrite (`delete` the hops, `insert` the new order) is
-- the same transaction shape and is equally legal, because nothing is checked until it ends.
--
-- What deferral costs is *where* a violation is reported: at `commit` rather than at the
-- statement. That is the right trade for a reorder, which is a transaction that either
-- applies whole or does not. `tests/constraints.sql` proves deferred is not unenforced the
-- way V009's section does — by asking for the check early with
-- `set constraints … immediate` and watching it fire.
--
-- **Why density is enforced here and deliberately was not on `queue_items`.** V009 declined
-- it, and its reasoning was sound for that table: the dashboard renders the queue with
-- `order by position`, which draws 1, 2, 5 exactly as it draws 1, 2, 3, so nothing a reader
-- could see depended on the numbers themselves. Here something does. `floor_hop_index` is a
-- hop *number*, the inspector prints those numbers in its rail, and a user reading
-- *"fallback 2"* is reading position 3. The numbers are load-bearing, so they are held.
--
-- ---------------------------------------------------------------------------
-- The floor, and why it is a deferred cross-row rule rather than a CHECK.
-- ---------------------------------------------------------------------------
--
-- `floor_hop_index` is nullable and null means *no floor* — degrade as far as the chain
-- goes. Set, it means *fail the run rather than resolve past this hop*, and the acceptance
-- criterion is that it can never point past the end of the chain: a floor at hop 4 of a
-- three-hop chain is a rule that can never fire, which reads in the inspector as a
-- protection the workspace has and does not.
--
-- A row-level CHECK cannot express it — the chain length lives in another table, and it
-- changes when a *hop* is deleted rather than when the route is written. So the same
-- constraint trigger that holds density holds this, attached to both tables, and deferred
-- for the same reason: `insert route; insert hops` and `delete a hop; lower the floor` are
-- both transactions that are momentarily inconsistent and finally correct.
--
-- ---------------------------------------------------------------------------
-- Money is integer cents, everywhere and only.
-- ---------------------------------------------------------------------------
--
-- `max_cost_cents_per_run` is an `integer` holding cents: the inspector's `$2.50` is `250`.
-- Not `numeric`, and emphatically not a float — a cap compared against a running total is
-- arithmetic a run is aborted on, and binary floating point is the wrong type to abort on.
-- It is the same unit `token_usage.cost_cents` (V010) and `model_prices` (V012) already
-- use, so a resolution comparing a cap to spend compares two integers in one unit and needs
-- no conversion anywhere. `tests/constraints.sql` asserts the column's declared type rather
-- than trusting the declaration below to stay put.
--
-- ---------------------------------------------------------------------------
-- Tenancy — composite foreign keys the whole way down, and the one `alter` that makes the
-- last of them possible.
-- ---------------------------------------------------------------------------
--
-- Every table here carries `organization_id`, and every parent reference is a composite
-- foreign key onto `(organization_id, id)`. That is V015's decision applied to three more
-- tables, and the failure it prevents is the same one: a hop naming another workspace's
-- alias is not a broken join, it is a route resolving onto another workspace's **model and
-- credential**. Two independent columns never agree by themselves; a composite key makes
-- them agree by the same machinery every other referential rule uses, with no plpgsql
-- beside it.
--
-- `model_aliases` is V015's table and had no unique key on `(organization_id, id)` — it
-- declared `(organization_id, alias)`, which is its own natural key, and V015 needed no
-- other. `route_hops` references an alias by **id**, so this migration declares the key its
-- foreign key requires. It is one `alter table … add constraint` against a table with no
-- rows in any environment yet (V015 seeds none; Y.4 is what fills it), and it adds no rule
-- — `id` is already the primary key, so the pair is unique whatever else happens. What it
-- adds is a *declaration*, which is the thing a composite foreign key needs to point at.
--
-- ---------------------------------------------------------------------------
-- Deleting an alias a hop names, and the refusal that has to name the route.
-- ---------------------------------------------------------------------------
--
-- `route_hops_alias_fk` is `on delete restrict`. The alternative is a cascade, and a cascade
-- here silently *shortens a chain*: an alias retired in mockup 21 would take hop 2 out of
-- six routes, leave their remaining hops at 1 and 3, and the first anybody would know of it
-- is a run that degraded past a floor which no longer counts the hops it was written
-- against. `restrict` turns that into a refusal at the moment of the delete, which is where
-- somebody can still act on it.
--
-- The criterion is that the refusal **names the affected route**, and the read that lets it
-- is one indexed query, which is the second job `route_hops_alias_idx` does:
--
--   select distinct r.tag
--     from ouroboros.route_hops h
--     join ouroboros.routes     r on r.organization_id = h.organization_id and r.id = h.route_id
--    where h.organization_id = $1 and h.model_alias_id = $2
--    order by r.tag;
--
-- That is the same shape V015 left for mockup 07's *"which aliases depend on this
-- connection"*, and it belongs to the same place: the surface that offers the delete. No
-- alias delete exists yet — `ouroboros-rest`'s registry module (#189) reads and does not
-- write, and mockup 21 owns the management UI (decision **M2**) — so this migration ships
-- the refusal and the read it needs, and stops there rather than inventing an endpoint the
-- roadmap that owns it would then have to negotiate with. `tests/constraints.sql` asserts
-- both halves: that the delete is refused, and that the blocking routes are nameable
-- through the index.
--
-- The interaction V015 wrote down holds here too and is asserted again for the wider graph:
-- **deleting a workspace still works.** Every table in this file cascades from
-- `organization`, and those cascades are queued as after-triggers of the same statement,
-- so the hops are gone by the time the restrict the alias delete appends is checked.
--
-- ---------------------------------------------------------------------------
-- House snake_case throughout — decision **A4**. `organization` is referenced by its quoted
-- camelCase `"id"` (V005), and `"user"` is quoted everywhere because it is a reserved word.
--
-- No seed rows. Y.4 (#192) is what fills these tables with mockup-06 parity data, in a
-- development database and nowhere else.

-- ---------------------------------------------------------------------------
-- The key `route_hops_alias_fk` points at.
--
-- V015's table, one declaration wider. See the header: `id` is already the primary key, so
-- this asserts nothing new about the data and everything about what may reference it.
-- ---------------------------------------------------------------------------
alter table ouroboros.model_aliases
  add constraint model_aliases_organization_id_key unique (organization_id, id);

comment on constraint model_aliases_organization_id_key on ouroboros.model_aliases is
  'The target of route_hops_alias_fk (#190), declared so the hop → alias reference can be composite and therefore hold both to one workspace. Redundant as a uniqueness claim — id is the primary key — and load-bearing as a declaration.';

-- ---------------------------------------------------------------------------
-- route_chain_intact() — the two rules that are properties of a chain rather than of a row.
--
--   * hop positions are **dense from 1**: exactly `1 … n`, no gaps, and never empty,
--   * `floor_hop_index`, when set, points **at a hop that exists**.
--
-- Neither can be a CHECK. Density is a property of a set, and the floor compares a column
-- on `routes` against a count in `route_hops`, so both need to look at rows other than the
-- one being written — which is a trigger's job, and specifically a *constraint* trigger's,
-- because both must be allowed to be momentarily false inside a reorder and true again at
-- `commit`. See the header for the transaction shape that depends on it.
--
-- Attached to both tables, because either side can break either rule: deleting a hop
-- shortens the chain under a floor that was valid a moment ago, and raising a floor points
-- past a chain nobody touched.
--
-- Raised as class 23 (`check_violation`) naming the trigger — the idiom V008 and V010
-- established for a rule a function enforces — so a caller sees an integrity violation with
-- a constraint name in it rather than a bespoke error class it would have to learn. The
-- *message* is where the specific rule and the route's tag go, because that is what a
-- designed refusal has to say out loud.
-- ---------------------------------------------------------------------------
create function ouroboros.route_chain_intact()
returns trigger language plpgsql as $$
declare
  targets   uuid[] := '{}';
  target    uuid;
  tag       text;
  floor_at  integer;
  hop_count integer;
  lowest    integer;
  highest   integer;
begin
  -- Which chains this event can have disturbed. Both sides of an update are collected, not
  -- just the new one: moving a hop from one route to another shortens the chain it left,
  -- and a rule that only looked forward would leave that gap behind it.
  --
  -- The two tables name the route differently, so the branches are separate statements
  -- rather than one `case` expression — plpgsql parses a statement on its first execution,
  -- so the branch that reads a column the other table does not have is never parsed for it.
  if tg_table_name = 'routes' then
    if tg_op <> 'INSERT' then targets := targets || old.id;       end if;
    if tg_op <> 'DELETE' then targets := targets || new.id;       end if;
  else
    if tg_op <> 'INSERT' then targets := targets || old.route_id; end if;
    if tg_op <> 'DELETE' then targets := targets || new.route_id; end if;
  end if;

  -- An ordinary update names the same route twice.
  targets := array(select distinct t from unnest(targets) as t);

  foreach target in array targets loop
    -- The route may be gone: the route itself was deleted, its task kind was, or the whole
    -- workspace was, and the hops went with it. A chain that does not exist has nothing to
    -- be intact about, and the referential rules have already had their say.
    select r.tag, r.floor_hop_index
      into tag, floor_at
      from ouroboros.routes r
     where r.id = target;

    if found then
      select count(*), min(h.position), max(h.position)
        into hop_count, lowest, highest
        from ouroboros.route_hops h
       where h.route_id = target;

      -- A route is its chain. Zero hops is a matrix row with no primary model, which
      -- resolution cannot answer and the inspector cannot draw — so it is refused rather
      -- than stored and discovered later by the thing that needed a model.
      if hop_count = 0 then
        raise exception 'route % has no hops — a route is its chain, and resolution has nothing to return for an empty one', tag
          using errcode = 'check_violation', constraint = tg_name;
      end if;

      -- Dense from 1. With positions already unique per route, first = 1 and last = the
      -- count is the whole of it: any gap pushes the last position past the number of hops.
      if lowest <> 1 or highest <> hop_count then
        raise exception 'route % numbers its % hop(s) % … % — positions must be dense from 1, because the floor rule counts them', tag, hop_count, lowest, highest
          using errcode = 'check_violation', constraint = tg_name;
      end if;

      if floor_at is not null and floor_at > hop_count then
        raise exception 'route % sets its floor at hop % but its chain is % hop(s) long — a floor past the end can never fire', tag, floor_at, hop_count
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

comment on function ouroboros.route_chain_intact() is
  'Deferred constraint trigger for routes and route_hops (#190): a route''s hop positions are dense from 1 and never empty, and its floor_hop_index points at a hop that exists. Both are properties of the chain rather than of a row, so neither can be a CHECK; both are deferred so a reorder or a whole-chain rewrite may be momentarily inconsistent inside its transaction. Raises class 23 naming the trigger, so each table reports its own constraint name.';

-- ---------------------------------------------------------------------------
-- task_kinds
-- ---------------------------------------------------------------------------
create table ouroboros.task_kinds (
  -- Surrogate key. `routes` references it and the matrix addresses a row by it, so a uuid
  -- rather than a serial for V001's reason: an id that appears in a URL should not also be
  -- a count of how many exist.
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a task kind is configuration, and the routes hanging off it go
  -- with the workspace too.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The name everything else spells: `analyze`, `estimate`, `plan`, `implement`,
  -- `test-gen`, `review`, `docs`, `commit-msg`. Unique **per workspace** (decision M3) —
  -- registry data, so a ninth kind is a row rather than a migration.
  --
  -- Lower-case kebab by CHECK, and for the same correctness reason V015 gave `alias`:
  -- uniqueness is enforced on the stored text, so admitting `Implement` beside `implement`
  -- would give one name two routes. It is also about to be a DSL identifier in
  -- `route.task("implement")`, a WF stage-catalog key (#145) and a URL segment, and this
  -- shape is safe in all three.
  name            text        not null,

  -- The matrix's second line — *"Write the change, run tests, iterate to green"*. Required:
  -- a kind with no description is a matrix row an operator cannot tell from its neighbour,
  -- and the eight the product ships all have one.
  description     text        not null,

  -- Where the row sits in the matrix. 1 is the top.
  --
  -- Unique per workspace and **deferrable**, so the matrix is reorderable with plain SQL —
  -- the same arrangement as `queue_items.position` (V009) and for the same reason. Unlike
  -- `route_hops.position` it is deliberately **not dense**: nothing reads these numbers,
  -- the matrix is `order by sort_order` and renders 1, 2, 5 exactly as it renders 1, 2, 3.
  -- The header says why hops are the exception — their numbers are what the floor rule
  -- counts.
  sort_order      integer     not null,

  created_at      timestamptz not null default now(),

  -- Moved by the V001 trigger rather than by the writer, as everywhere else in this schema.
  updated_at      timestamptz not null default now(),

  -- The natural key, and the lookup `route.task("implement")` and WF-R.3's catalog (#145)
  -- validate a name through. Immediate, not deferrable: a duplicate name is a thing a
  -- person can ask for and should be told about at the statement — and Y.4's seed needs it
  -- as an `on conflict` arbiter, which a deferrable index cannot be.
  constraint task_kinds_organization_name_key unique (organization_id, name),

  -- The target of `routes_task_kind_fk`. See the header on composite keys.
  constraint task_kinds_organization_id_key unique (organization_id, id),

  -- Reorderable. See the column.
  constraint task_kinds_organization_sort_order_key
    unique (organization_id, sort_order) deferrable initially deferred,

  constraint task_kinds_name_shape
    check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(name) <= 64),

  constraint task_kinds_description_present
    check (btrim(description) = description and description <> '' and length(description) <= 200),

  -- The top row is first, not zeroth, and there is no row before it.
  constraint task_kinds_sort_order_positive check (sort_order >= 1)
);

comment on table ouroboros.task_kinds is
  'The kinds of work a route can be written for — mockup 06''s "8 task kinds" (#190, decision M3). Registry data rather than an enum, because the WF stage catalog (#145), the estimator and the DSL''s route.task() all reference the same vocabulary and hardcoding it in three services forks it. Seeded per workspace by Y.4 (#192), extensible by a row.';
comment on column ouroboros.task_kinds.organization_id is
  'The workspace. ON DELETE CASCADE — a task kind is configuration, and the route hanging off it goes with the workspace too.';
comment on column ouroboros.task_kinds.name is
  'The name everything else spells — analyze, estimate, plan, implement, test-gen, review, docs, commit-msg. Unique per workspace, and lower-case kebab by CHECK: uniqueness is on the stored text, so Implement beside implement would give one name two routes. Also a DSL identifier, a stage-catalog key and a URL segment.';
comment on column ouroboros.task_kinds.description is
  'The matrix''s second line — "Write the change, run tests, iterate to green". Required: a kind with no description is a row an operator cannot tell from its neighbour.';
comment on column ouroboros.task_kinds.sort_order is
  'Matrix row order; 1 is the top. Unique per workspace and deferrable, so a drag-reorder is plain SQL inside a transaction. Deliberately NOT dense, unlike route_hops.position — nothing reads these numbers, and the matrix renders 1, 2, 5 exactly as it renders 1, 2, 3.';

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------
create table ouroboros.routes (
  id                     uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, and half of both composite foreign keys below.
  organization_id        text        not null
                                     references ouroboros.organization ("id") on delete cascade,

  -- The task kind this route answers for. **Exactly one route per kind**, which is
  -- `routes_task_kind_key` below rather than a rule in a service.
  task_kind_id           uuid        not null,

  -- What the inspector titles itself with — `ROUTE — implement-primary` — and the tag under
  -- the matrix row.
  --
  -- Its own column rather than something derived from the kind's name, because the mockup's
  -- eight are not mechanical: `test-gen` tags `testgen-primary` and `commit-msg` tags
  -- `commitmsg-primary`. A derivation would have to encode those two exceptions and would
  -- still be wrong for the ninth kind somebody adds.
  --
  -- Unique per workspace: it is how a person refers to a route in a conversation, a log line
  -- and a support request, and two routes answering to one tag makes all three ambiguous.
  tag                    text        not null,

  -- The inspector's **Allow fallback to local models** toggle.
  --
  -- Defaults **true**, which is the chain as authored being what runs: putting `local-docs`
  -- at hop 3 is already an operator saying local models are acceptable for this kind of
  -- work, and a default of false would silently ignore a hop somebody deliberately added.
  -- The toggle is how that consent is *withdrawn* for one task kind — a workspace whose
  -- `review` must never leave an audited provider — without rewriting the chain it would
  -- have to put back later.
  allow_local_fallback   boolean     not null default true,

  -- The inspector's **Fail run instead of degrading below fallback 2** rule, as the hop
  -- number it is really about.
  --
  -- Null means **no floor**: degrade as far as the chain goes. Set to `n`, it means *fail
  -- the run rather than resolve past hop n* — so the mockup's *"below fallback 2"* is `3`,
  -- the chain's third hop. Held to a hop that exists by `route_chain_intact()`; see the
  -- header for why that cannot be a CHECK.
  floor_hop_index        integer,

  -- The inspector's **Max cost per run** field, in **integer cents** — `$2.50` is `250`.
  --
  -- Null means no cap. Never a float and never a dollar amount: this is compared against a
  -- running total to abort a run, it is the same unit `token_usage.cost_cents` (V010) and
  -- `model_prices` (V012) already keep, and a cap in a second unit is a conversion nobody
  -- remembers on the path where it matters.
  max_cost_cents_per_run integer,

  -- Who last saved this route — the audit half of `updated_at`.
  --
  -- Nullable for both of V011's reasons, unchanged: a route can be written by something
  -- other than a person (Y.4's seed, an onboarding default), and the reference empties this
  -- when the person is deleted. **`on delete set null`, never cascade** — cascading would
  -- delete the *route* when whoever last touched it left the company, which is a task kind
  -- silently losing its model because of an unrelated account deletion.
  --
  -- Deliberately not additionally constrained to a member of this workspace, for the reason
  -- V011 gives at length: membership is revocable, so re-checking it on an unrelated update
  -- would refuse a legitimate write on the strength of somebody else's resignation. This
  -- records *who*, which stays true; whether they were allowed is the endpoint's question
  -- (Z.2's role gate), asked when it mattered.
  updated_by             text        references ouroboros."user" ("id") on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- --- exactly one route per task kind ------------------------------------------
  --
  -- Acceptance criterion, and it is a constraint rather than application code because every
  -- reader downstream depends on it: resolution (Z.1) asks for *the* route of a task kind
  -- and a second row would make that question have two answers, silently and differently
  -- per query plan.
  --
  -- A plain unique key on `task_kind_id` — the ticket's `task_kinds ||--|| routes`, drawn
  -- exactly. There is no `is_active` flag beside it, and that is the same decision seen from
  -- the other side: a nullable flag would make "one active route" a partial index and make
  -- *inactive* routes a state this schema has, with no column saying what one is for. When
  -- versioned route configuration arrives it is history in a table of its own, where a
  -- superseded revision cannot be mistaken for a route that is merely switched off.
  constraint routes_task_kind_key unique (task_kind_id),

  -- The target of `route_hops_route_fk`.
  constraint routes_organization_id_key unique (organization_id, id),

  constraint routes_organization_tag_key unique (organization_id, tag),

  constraint routes_tag_shape
    check (tag ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tag) <= 64),

  -- The chain starts at hop 1, so a floor below it is not a floor. The other half of the
  -- rule — that it is not *past* the end — is `route_chain_intact()`, because the end is in
  -- another table.
  constraint routes_floor_hop_index_positive
    check (floor_hop_index is null or floor_hop_index >= 1),

  -- A cap of zero is not a cap, it is a route that can never run. Null is how "no cap" is
  -- said here.
  constraint routes_max_cost_positive
    check (max_cost_cents_per_run is null or max_cost_cents_per_run > 0),

  -- **Composite.** The route and its task kind belong to one workspace, declaratively —
  -- see the header. Cascade: deleting a task kind deletes the route that answered for it,
  -- which then takes its hops.
  constraint routes_task_kind_fk
    foreign key (organization_id, task_kind_id)
    references ouroboros.task_kinds (organization_id, id)
    on delete cascade
);

comment on table ouroboros.routes is
  'One task kind''s route — the ordered alias chain''s owner and its policy triple (#190, decision M4). Exactly one row per task kind by constraint, which is what lets resolution (Z.1, #194) ask for "the route of this kind" and get one answer. Holds mockup 06''s inspector controls: allow_local_fallback, floor_hop_index and max_cost_cents_per_run.';
comment on column ouroboros.routes.organization_id is
  'The workspace. ON DELETE CASCADE, and half of both composite foreign keys — the one to task_kinds here, and the one route_hops uses to reach this row.';
comment on column ouroboros.routes.task_kind_id is
  'The task kind this route answers for. Unique, so exactly one route exists per kind — the ticket''s "one active route per kind" as a constraint rather than as application code. There is deliberately no is_active flag: a superseded revision belongs in a history table, where it cannot be mistaken for a route that is switched off.';
comment on column ouroboros.routes.tag is
  'The inspector''s title and the matrix''s row tag — implement-primary. Its own column rather than derived from the kind''s name, because the mockup''s eight are not mechanical: test-gen tags testgen-primary and commit-msg tags commitmsg-primary. Unique per workspace, because it is how a person names a route in a log line or a support request.';
comment on column ouroboros.routes.allow_local_fallback is
  'Mockup 06''s "Allow fallback to local models" toggle. Defaults true: a local alias placed in the chain is already consent, and a false default would ignore a hop somebody deliberately added. The toggle is how that consent is withdrawn for one task kind without rewriting the chain.';
comment on column ouroboros.routes.floor_hop_index is
  'Mockup 06''s "Fail run instead of degrading below fallback 2", as the hop number it is about — "below fallback 2" is 3, the chain''s third hop. Null means no floor. Held to a hop that exists by route_chain_intact(), which cannot be a CHECK because the chain length lives in route_hops.';
comment on column ouroboros.routes.max_cost_cents_per_run is
  'Mockup 06''s "Max cost per run", in integer cents — $2.50 is 250. Null means no cap. Never a float and never dollars: it is compared against a running total to abort a run, and it is the same unit token_usage.cost_cents and model_prices already keep.';
comment on column ouroboros.routes.updated_by is
  'Who last saved this route, or null — nothing requires a person, and ON DELETE SET NULL empties it when one is deleted. Never cascade: that would delete the route when whoever last touched it left. Not constrained to a member; authorization is the endpoint''s (Z.2), and membership is revocable.';

-- ---------------------------------------------------------------------------
-- route_hops
-- ---------------------------------------------------------------------------
create table ouroboros.route_hops (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, and half of both composite foreign keys below — which is what
  -- makes "this hop's alias belongs to this hop's workspace" a referential rule instead of
  -- a trigger.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The chain this hop is part of.
  route_id        uuid        not null,

  -- Where in the chain: 1 is the primary, 2 is the first fallback. **Unique and dense per
  -- route**, which is the whole of decision M4's ordering half — see the header for why
  -- both, and for the reorder those two rules are shaped around.
  position        integer     not null,

  -- **The alias this hop resolves through, and the reason no raw model id can reach a
  -- route** (decision M1). A foreign key to `model_aliases` (V015), which is the only table
  -- in this schema holding a provider's model string.
  --
  -- `on delete restrict`, via the composite key below: retiring an alias six routes name
  -- must be refused, not silently applied by shortening six chains. See the header for the
  -- read a refusal names the routes with.
  model_alias_id  uuid        not null,

  -- The inspector's hop-meta line — *"Fallback on 5xx / timeouts"*, *"Offline mode — keeps
  -- the loop turning without a network"*.
  --
  -- Nullable, because most hops need no explanation and an empty line is better than a
  -- generated one; the mockup's first hop prints *"Primary · API key valid, 42ms to
  -- us-east"*, of which only the word *Primary* is this column's business — the rest is
  -- health, which Z.3 (#196) measures and nothing stores here.
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- --- the ordering ---------------------------------------------------------------
  --
  -- Acceptance criterion, first half: no two hops claim the same place. Deferred, so a swap
  -- is plain SQL — the header has the transaction, and V009's `queue_items` section has the
  -- longer argument for why an immediate unique index refuses every ordinary reorder.
  --
  -- The second half — dense from 1 — is `route_hops_chain_intact` below, because density is
  -- a property of the set rather than of any row.
  constraint route_hops_route_position_key
    unique (route_id, position) deferrable initially deferred,

  -- The primary is hop 1. There is no hop 0 and no negative shuffle position, which is also
  -- why the reorder in the header does not need one.
  constraint route_hops_position_positive check (position >= 1),

  constraint route_hops_note_present
    check (note is null
           or (btrim(note) = note and note <> '' and length(note) <= 200)),

  -- **Composite.** The hop and its route belong to one workspace. Cascade: a deleted route
  -- takes its chain with it, which is what makes a chain a chain rather than a set of rows
  -- that outlive it.
  constraint route_hops_route_fk
    foreign key (organization_id, route_id)
    references ouroboros.routes (organization_id, id)
    on delete cascade,

  -- **Composite, and `restrict`.** The pair holds the hop and its alias to one workspace —
  -- without it a hop could resolve onto another workspace's model and credential — and the
  -- restrict is what stops an alias being retired out from under the routes that name it.
  -- Deleting the workspace itself still works; the header explains why, and
  -- tests/constraints.sql asserts it.
  constraint route_hops_alias_fk
    foreign key (organization_id, model_alias_id)
    references ouroboros.model_aliases (organization_id, id)
    on delete restrict
);

comment on table ouroboros.route_hops is
  'The ordered fallback chain — mockup 06''s numbered inspector rail (#190, decision M4). Positions are unique and dense from 1, enforced rather than conventional, because floor_hop_index is a rule about a hop number and an approximate chain makes it meaningless. Every hop names a model_aliases row and nothing else: there is no raw model id column here, which is decision M1 by construction rather than by review.';
comment on column ouroboros.route_hops.organization_id is
  'The workspace. ON DELETE CASCADE, and half of both composite foreign keys — which is what makes "this hop''s alias belongs to this hop''s workspace" referential rather than a trigger. A hop reaching another workspace''s alias would resolve onto that workspace''s model and credential.';
comment on column ouroboros.route_hops.route_id is
  'The chain this hop belongs to. Reached through route_hops_route_fk, which cascades: a deleted route takes its chain with it.';
comment on column ouroboros.route_hops.position is
  'Place in the chain; 1 is the primary. Unique per route and deferrable, so a reorder is plain SQL inside a transaction, and dense from 1 by route_chain_intact() — unlike queue_items.position, because these numbers are read: floor_hop_index counts them and the inspector prints them.';
comment on column ouroboros.route_hops.model_alias_id is
  'The alias this hop resolves through — and the reason a route can never name a raw model (decision M1). ON DELETE RESTRICT: retiring an alias that routes name is refused rather than silently shortening their chains past the floor those chains were written against.';
comment on column ouroboros.route_hops.note is
  'The inspector''s hop-meta line — "Fallback on 5xx / timeouts". Nullable: most hops need no explanation, and the health half of the mockup''s first line ("API key valid, 42ms to us-east") is Z.3''s measurement rather than stored text.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- One is added, and every other read this schema serves is already entered through a key a
-- rule needed — which is the arrangement worth having: the fast path is the one the
-- constraints already paid for.
--
--   * the matrix — `task_kinds` by workspace in row order — is
--     `task_kinds_organization_sort_order_key`, and its route is `routes_task_kind_key`;
--   * the WF-R.3 catalog read (#145) — a workspace's task-kind names — enters through the
--     leading column of `task_kinds_organization_sort_order_key`, and one kind *by* name —
--     what `route.task("implement")` validates through — is
--     `task_kinds_organization_name_key`;
--   * the inspector's chain — a route's hops in order — is
--     `route_hops_route_position_key`, whose leading column is the route;
--   * a route by tag is `routes_organization_tag_key`, and a workspace's routes enter
--     through the leading column of `routes_organization_id_key`;
--   * the referencing side of `route_hops_route_fk` — *which hops does this route have*,
--     asked by every route delete and every cascade into one — needs no index of its own
--     either: `route_hops_route_position_key` leads on `route_id` and the index below leads
--     on `organization_id`, so the pair the check filters on is covered whichever the
--     planner reaches for;
--   * the referencing side of `routes_task_kind_fk` is `routes_task_kind_key`.
--
-- `routes.updated_by` is deliberately **not** indexed, which is V011's call repeated for the
-- same reason: it is a referencing column with `on delete set null`, so a user deletion
-- scans this table — and this table holds one row per task kind per workspace, so it stays a
-- handful of pages at any plausible installation size. An index nothing reads is still an
-- index every write maintains.
-- ---------------------------------------------------------------------------

-- The referencing side of `route_hops_alias_fk`, which PostgreSQL does not create — it
-- indexes the *referenced* side of a foreign key and never the referencing one. Without it
-- every alias delete, and every workspace delete that cascades into one, scans `route_hops`
-- end to end to decide whether the restrict fires.
--
-- It earns its place twice, exactly as `model_aliases_provider_idx` (V015) does: it is also
-- the *"which routes depend on this alias"* read that the designed refusal has to name, and
-- the swap menu Z.2 (#195) needs before it can offer the change at all.
create index route_hops_alias_idx
  on ouroboros.route_hops (organization_id, model_alias_id);

comment on index ouroboros.route_hops_alias_idx is
  'The referencing side of route_hops_alias_fk (#190), which PostgreSQL does not create: without it every alias delete scans this table to decide whether the restrict fires. Also the "which routes depend on this alias" read that the refusal names the routes from, and that Z.2''s swap menu is built on.';

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger task_kinds_touch_updated_at
  before update on ouroboros.task_kinds
  for each row execute function ouroboros.touch_updated_at();

create trigger routes_touch_updated_at
  before update on ouroboros.routes
  for each row execute function ouroboros.touch_updated_at();

create trigger route_hops_touch_updated_at
  before update on ouroboros.route_hops
  for each row execute function ouroboros.touch_updated_at();

-- The chain rules, on both tables that can break them. `deferrable initially deferred` is
-- what makes a reorder, a whole-chain rewrite and a `insert route; insert hops` sequence
-- all legal — see the header — and `set constraints … immediate` is how tests/constraints.sql
-- shows that deferred is not unenforced.
create constraint trigger routes_chain_intact
  after insert or update or delete on ouroboros.routes
  deferrable initially deferred
  for each row execute function ouroboros.route_chain_intact();

create constraint trigger route_hops_chain_intact
  after insert or update or delete on ouroboros.route_hops
  deferrable initially deferred
  for each row execute function ouroboros.route_chain_intact();
