-- registry-invariants.sql — the invariants every registry service trusts (#583, CG.5).
--
-- Mockup 21's registry is read and written by four services that do not re-check any of
-- this. CH.1 (#584) assumes an unbound alias can never be enabled; CH.2 (#585) assumes
-- `params` never holds a key it does not understand; CH.3 (#586) assumes a `free` row
-- cannot carry a price and a `token` row cannot omit one; CH.5 (#588) assumes `Used by` is
-- derivable from one view. If any of those rules is dropped in a later migration none of
-- those services fails loudly — they start being *wrong*, on the page a workspace reads its
-- prices from. So each one is attempted here as a write the schema must refuse, refused,
-- and named.
--
-- ---------------------------------------------------------------------------
-- Why this is a file rather than another section of constraints.sql.
-- ---------------------------------------------------------------------------
--
-- Because it has to run in two places. `\ir`-ed into constraints.sql it is CG.5's section
-- of that file, and every existing runner picks it up unchanged — `ci/db`, a developer's
-- psql, and verify-constraint-probes.sh's mutated copies. Run through its sibling
-- tests/registry-invariants.sql it is a suite of its own, which is what lets `ci/db` point
-- it at the **seeded** database #582 built and require it green there too — the ticket's
-- third acceptance criterion.
--
-- That second run is the reason for the one rule this file keeps that its neighbours do
-- not: **it depends on nothing outside itself.** constraints.sql can clear the schema
-- because it is going to roll back, and every section in it counts rows in a database it
-- emptied first. This one cannot — the seed is the fixture the step before it just
-- asserted — so every row it needs it creates, under two workspaces nothing else names, and
-- every assertion is scoped to them. The two exceptions are deliberate and are the only
-- unscoped counts in the file: the reference view's `workflow` and `chat_pin` legs have to
-- be empty *everywhere* or they are not absent, and a count scoped to one workspace would
-- say nothing about that.
--
-- No `begin`, no `rollback`, and no `\ir lib/assert.sql`: the caller owns the transaction
-- and the helpers, because one of the two callers already has both open. What that buys is
-- that this file writes nothing anybody keeps — the caller's rollback takes the fixtures
-- with it, which is what "without mutating it" means for a database somebody is using.
--
-- ---------------------------------------------------------------------------
-- What is here that is not already above it, and what is deliberately not.
-- ---------------------------------------------------------------------------
--
-- Most of these rules are also asserted by the section of constraints.sql belonging to the
-- migration that made them — V012 (#580) for the prices, V015 (#189) and V019 (#579) for the
-- aliases, V023 (#581) for the reference view — because that file's standing rule is that a
-- migration adds its assertion in the same change. Those sections stay where they are and
-- are not restated: what is asserted twice can disagree.
--
-- This is the same list read as one thing, over fixtures of its own, so that it can be asked
-- of a database whose rows it did not put there. Where a bullet of #583 names something no
-- section above covers, the assertion is new rather than duplicated — the `usage` billing
-- mode's amounts, a duplicate *override* key, and the reference view's column list.
--
-- The last part asks the catalogue by name, and it is a backstop rather than the assertion:
-- everything it covers is already refused above. What it adds is the half a refusal cannot
-- report — *which columns* the price key spans, and that both foreign keys still say
-- `restrict` rather than having been relaxed to `cascade` under the same name — and, when
-- one of them goes, a failure line naming the object to go looking for. It asserts no rule
-- *body*: no CHECK expression, no function source, for the reason Y.5's section gives —
-- those are legitimately rewritten, and a test that pins a rule's wording fails on the
-- refactor rather than on the regression.

-- ---------------------------------------------------------------------------
-- Fixtures: two workspaces so alias uniqueness can be shown to be scoped to one, three
-- connections — one bound, one nothing depends on, one next door — and a chain of a single
-- hop for the reference view to find.
--
-- Text ids on the BetterAuth-shaped tables and `c5…` uuids elsewhere, so nothing here can
-- collide with the seed's `5eed…` rows or with a fixture of a section above.
--
-- `provider_models` is populated for the model the bound alias names, so V017's soft
-- validation (#221, decision P6) has nothing to warn about. The warning is a warning rather
-- than a refusal and could be left to fire; seeding the row keeps this file's output empty,
-- which is what makes a CI transcript worth reading.
-- ---------------------------------------------------------------------------
insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-cg5',       'Registry Invariants', 'registry-invariants-cg5', now()),
  ('org-cg5-other', 'Next Door',           'next-door-cg5',           now());

insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('c5000000-0000-0000-0000-0000000000a1', 'org-cg5',       'anthropic', 'Anthropic'),
  ('c5000000-0000-0000-0000-0000000000b1', 'org-cg5',       'cursor',    'Cursor'),
  ('c5000000-0000-0000-0000-0000000000c1', 'org-cg5-other', 'anthropic', 'Anthropic');

insert into ouroboros.provider_models (id, provider_connection_id, model_id, display) values
  ('c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000a1',
   'claude-fable-5', 'Claude Fable 5'),
  ('c5000000-0000-0000-0000-0000000000d2', 'c5000000-0000-0000-0000-0000000000c1',
   'claude-fable-5', 'Claude Fable 5');

-- The two rows mockup 21's table is drawn around: one bound and switched on, one created
-- ahead of its key — a model id, no connection, and the switch off because it must be.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, enabled) values
  ('c5100000-0000-0000-0000-000000000001', 'org-cg5', 'coder-max',
   'c5000000-0000-0000-0000-0000000000a1', 'claude-fable-5', true),
  ('c5100000-0000-0000-0000-000000000002', 'org-cg5', 'gpt5-experiments',
   null, 'gpt-5.2-preview', false);

insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order) values
  ('c5200000-0000-0000-0000-000000000001', 'org-cg5', 'implement', 'Writes the code', 1);

insert into ouroboros.routes (id, organization_id, task_kind_id, tag) values
  ('c5300000-0000-0000-0000-000000000001', 'org-cg5',
   'c5200000-0000-0000-0000-000000000001', 'implement-primary');

insert into ouroboros.route_hops (id, organization_id, route_id, position, model_alias_id) values
  ('c5400000-0000-0000-0000-000000000001', 'org-cg5',
   'c5300000-0000-0000-0000-000000000001', 1, 'c5100000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Unbound ⇒ disabled.
--
-- The dimmed row that is always off. Decision R2 makes it a CHECK rather than a promise a
-- service keeps, because the row is written by three of them and read by all four. All three
-- verbs are attempted, because a rule enforced on only one of them is a rule with a way
-- round it: switching an orphan on, unbinding a live alias, and creating an orphan that
-- takes `enabled` from the column default rather than saying it is off.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set enabled = true
     where id = 'c5100000-0000-0000-0000-000000000002'$$,
  'an alias with no provider connection cannot be switched on',
  'model_aliases_unbound_disabled');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set provider_connection_id = null
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'and an alias that is switched on cannot have its connection taken away',
  'model_aliases_unbound_disabled');

select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases (organization_id, alias, model_id)
    values ('org-cg5', 'silent-orphan', 'gpt-5.2-preview')$$,
  'an unbound alias that does not say it is off is refused rather than quietly corrected',
  'model_aliases_unbound_disabled');

-- ---------------------------------------------------------------------------
-- Params and restrictions are closed vocabularies.
--
-- Every chip in the mockup's table is derived from one of these two documents, so a key
-- nothing renders is a key that renders as nothing. Each probe writes a well-formed object,
-- which is what keeps V015's `params is an object` rule from being the one that fires and
-- makes the constraint name the assertion.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"top_p": 0.9}'
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'a params key outside the vocabulary is refused — no chip is derived from it',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"temperature": 3.0}'
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'a temperature no vendor accepts is refused at the shape',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"token_budget": 1.5}'
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'a token budget with a fraction in it is refused — a token count is whole',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set restrictions = '{"batch_okay": true}'
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'a restriction flag outside the two is refused',
  'model_aliases_restrictions_known');

-- And the documents the mockup actually renders are storable, so what is above is a
-- vocabulary rather than a subset of one.
update ouroboros.model_aliases
   set params = '{"thinking": "max", "token_budget": 400000}',
       restrictions = '{"batch_ok": true}'
 where id = 'c5100000-0000-0000-0000-000000000001';

select pg_temp.must_hold(
  (select params = '{"thinking": "max", "token_budget": 400000}'::jsonb
      and restrictions = '{"batch_ok": true}'::jsonb
     from ouroboros.model_aliases where id = 'c5100000-0000-0000-0000-000000000001'),
  'the mockup''s (max thinking)(400k budget)(batch ok) chips are two documents this column holds');

-- ---------------------------------------------------------------------------
-- An alias name is unique per workspace, which is what the table's caption claims.
--
-- Both halves, because a rule scoped too widely fails exactly as badly as one scoped too
-- narrowly: two workspaces naming their own `coder-max` is the ordinary case, and one
-- workspace naming two is the one the inspector could not address.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases (organization_id, alias, model_id, enabled)
    values ('org-cg5', 'coder-max', 'claude-opus-5', false)$$,
  'one workspace cannot hold the same alias name twice',
  'model_aliases_organization_alias_key');

insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, enabled) values
  ('c5100000-0000-0000-0000-00000000000f', 'org-cg5-other', 'coder-max',
   'c5000000-0000-0000-0000-0000000000c1', 'claude-fable-5', true);

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_aliases
    where alias = 'coder-max' and organization_id in ('org-cg5', 'org-cg5-other')),
  'and the workspace next door may name its own, which is what "per workspace" means');

-- ---------------------------------------------------------------------------
-- Price coherence: the amounts follow the billing mode.
--
-- The `$ per 1M in·out` cell chooses between four shapes on `billing_mode` alone, so each
-- of the four is only structural while these hold. A `token` row missing half its price
-- would total as though the missing half were free; a `free` row carrying one is a `token`
-- row that took the wrong mode; and a per-token amount on a `seat` or `usage` row is a
-- number that gets multiplied by a token count and charged to somebody.
--
-- `usage` is probed beside `seat` because one constraint covers both and a probe for one of
-- them alone would leave the other's half of the rule unwatched.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'cg5-half-priced', 'token', 100, 'bundled', 'cg5-probe')$$,
  'a token row carrying only one of its two amounts is refused',
  'model_prices_token_requires_amounts');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('ollama', 'cg5-not-really-free', 'free', 50, 0, 'bundled', 'cg5-probe')$$,
  'a free row carrying a non-zero amount is refused — "$0" is a claim, not a rounding',
  'model_prices_free_amounts_zero');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('copilot', 'cg5-seat-with-a-rate', 'seat', 100, 500, 'bundled', 'cg5-probe')$$,
  'a seat row carrying per-token amounts is refused',
  'model_prices_metered_amounts_absent');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('cursor', 'cg5-usage-with-a-rate', 'usage', 100, 500, 'bundled', 'cg5-probe')$$,
  'and so is a usage row — the rule covers both metered modes, not just the first',
  'model_prices_metered_amounts_absent');

-- ---------------------------------------------------------------------------
-- Price provenance: a row says where it came from, and both ways of saying it agree.
--
-- The sweep that applies a new snapshot deletes by `source`. A bundled row naming a
-- workspace would put that workspace's negotiated rate inside its reach; an override
-- belonging to nobody would be a rate no workspace can edit and every workspace reads.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (organization_id, match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('org-cg5', 'anthropic', 'cg5-claimed-bundled', 'token', 1, 1, 'bundled', 'cg5-probe')$$,
  'a bundled row naming a workspace is refused',
  'model_prices_source_matches_owner');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source)
    values ('anthropic', 'cg5-orphan-override', 'token', 1, 1, 'override')$$,
  'and an override belonging to no workspace is refused too',
  'model_prices_source_matches_owner');

-- ---------------------------------------------------------------------------
-- Price uniqueness: one row per (workspace, provider kind, model, source).
--
-- Both halves of the key, because the two differ in the one property that is easy to lose.
-- A bundled row's workspace is null, and under PostgreSQL's default two nulls are distinct —
-- so without `nulls not distinct` the bundled half of this key enforces nothing at all and a
-- re-import doubles the catalog instead of updating it. The override half would go on
-- working, which is what would make the loss hard to notice.
-- ---------------------------------------------------------------------------
insert into ouroboros.model_prices
    (match_provider_kind, match_model, billing_mode,
     input_cents_per_1m, output_cents_per_1m, source, catalog_version)
  values ('anthropic', 'cg5-probe-model', 'token', 100, 500, 'bundled', 'cg5-probe');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('anthropic', 'cg5-probe-model', 'token', 900, 900, 'bundled', 'cg5-probe')$$,
  'a second bundled row for one model is refused, null workspace and all',
  'model_prices_match_key');

insert into ouroboros.model_prices
    (organization_id, match_provider_kind, match_model, billing_mode,
     input_cents_per_1m, output_cents_per_1m, source)
  values ('org-cg5', 'anthropic', 'cg5-probe-model', 'token', 111, 222, 'override');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (organization_id, match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source)
    values ('org-cg5', 'anthropic', 'cg5-probe-model', 'token', 333, 444, 'override')$$,
  'and a workspace cannot hold two overrides for the same model either',
  'model_prices_match_key');

-- The two rows that key just kept apart are the precedence rule the pricing service is
-- written against: the workspace reads its own correction, and the workspace next door,
-- which corrected nothing, reads the catalog.
select pg_temp.must_hold(
  (select source = 'override' and input_cents_per_1m = 111
     from ouroboros.model_price('org-cg5', 'anthropic', 'cg5-probe-model')),
  'a workspace''s override is what its own lookup resolves to');

select pg_temp.must_hold(
  (select source = 'bundled' and input_cents_per_1m = 100
     from ouroboros.model_price('org-cg5-other', 'anthropic', 'cg5-probe-model')),
  'and the workspace next door still reads the bundled row');

-- The honesty line the whole pricing surface rests on, in the one shape that cannot be
-- asserted by a row: a model nothing prices resolves to **no row**, which the read path
-- renders as `—`. A zero here would be the claim that the call is free.
--
-- Asked of a provider kind no vendor has, deliberately. A real kind would make this
-- assertion depend on the bundled catalog *not* carrying a family row for it, which is a
-- property of the next `--vendor` rather than of this schema — and a probe that a snapshot
-- bump can turn red is a probe that will be edited rather than read.
select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.model_price('org-cg5', 'cg5-no-such-vendor', 'cg5-model-nobody-prices')),
  'a model the catalog does not cover resolves to nothing — never to a zero');

-- ---------------------------------------------------------------------------
-- The reference view's shape.
--
-- `Used by`, the inspector's chip list, the blocked *Remove* and the guarded rename are one
-- definition (decision R5), so its **columns** are an interface rather than an
-- implementation: CH.5 (#588) selects them by name. The list is asserted in order, with the
-- type of each, which is the half a `select *` cannot notice going wrong.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(att.attname::text || ' ' || typ.typname::text order by att.attnum)
            = array['organization_id text', 'alias_id uuid', 'alias text',
                    'kind alias_reference_kind', 'ref_id uuid',
                    'ref_label text', 'blocking bool']
     from pg_attribute att
     join pg_type typ on typ.oid = att.atttypid
    where att.attrelid = 'ouroboros.alias_references'::regclass
      and att.attnum > 0 and not att.attisdropped),
  'alias_references publishes the seven documented columns, in order, with the documented types');

-- The vocabulary behind the `kind` column, which is what makes the output shape stable
-- across the two legs that have no storage yet. All four are castable today; a fifth is a
-- migration rather than a string somebody typed into the union.
select pg_temp.must_hold(
  (select count(*) = 4 from unnest(
      array['route', 'escalation', 'workflow', 'chat_pin']::ouroboros.alias_reference_kind[])),
  'all four reference kinds are already in the vocabulary, whether or not their storage exists');

select pg_temp.must_reject(
  $$select 'chat_ping'::ouroboros.alias_reference_kind$$,
  'and a fifth kind is refused rather than admitted by a typo',
  'alias_reference_kind_known');

-- The absent legs are zero rows, not an error. BZ.3's chat pins (#537) and the workflow
-- versions #132/#133 will store are the two the union carries no arm for yet, and a view
-- that raised for either would take the whole `Used by` column down with it.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references where kind = 'chat_pin'),
  'the chat-pin source contributes zero rows rather than an error while BZ.3 storage is absent');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references where kind = 'workflow'),
  'and the workflow source does the same until #132/#133 land');

-- And the leg that does have storage answers for this workspace's chain: one route
-- reference, labelled with the tag the matrix draws, blocking a delete.
select pg_temp.must_hold(
  (select count(*) = 1 and bool_and(kind = 'route' and ref_label = 'implement-primary'
                                    and blocking)
     from ouroboros.alias_references
    where organization_id = 'org-cg5' and alias = 'coder-max'),
  'a hop is one blocking route reference, labelled with the route''s tag');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references
    where organization_id = 'org-cg5' and alias = 'gpt5-experiments'),
  'and an alias nothing names reads as no rows, which is the "0 routes" cell');

-- ---------------------------------------------------------------------------
-- The two deletions that must be refused.
--
-- AD.2's direction (#223): a provider connection cannot be removed on mockup 07 while
-- aliases on mockup 21 are bound to it. Y.2's direction (#190): an alias cannot be retired
-- while a chain on mockup 06 names it. Both are `restrict` foreign keys, and both fail
-- **open** if relaxed — a cascade deletes the dependants and reports success.
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $$delete from ouroboros.provider_connections
     where id = 'c5000000-0000-0000-0000-0000000000a1'$$,
  'a provider connection an alias is bound to cannot be deleted',
  'model_aliases_provider_fk');

select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases
     where id = 'c5100000-0000-0000-0000-000000000001'$$,
  'an alias a route hop names cannot be deleted — the blocked Remove, at the database',
  'route_hops_alias_fk');

-- A connection nothing is bound to is still deletable, so the rule above is a reference
-- rule and not a table nobody may delete from.
delete from ouroboros.provider_connections
 where id = 'c5000000-0000-0000-0000-0000000000b1';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_connections
    where id = 'c5000000-0000-0000-0000-0000000000b1'),
  'and a connection no alias names is deletable, which is what makes the refusal above mean something');

-- ---------------------------------------------------------------------------
-- The two shapes a write cannot show.
--
-- Everything above is a statement the schema refused. These two rules are not observable
-- that way from one session: `nulls not distinct` is a property of an index that only a
-- second bundled row can demonstrate — which the probe above does — but *which columns* the
-- key spans is not, and `restrict` versus `cascade` is a refusal versus a success whose
-- difference is a row count somewhere else. Both are relaxations that leave the object's
-- name exactly where it was, so they are asked of the catalogue by name.
--
-- Shapes only. No CHECK expression and no function body: those are legitimately rewritten,
-- and a test that pins a rule's wording fails on the refactor rather than on the regression.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select idx.indisunique and idx.indnullsnotdistinct
      and (select array_agg(att.attname::text order by att.attnum)
             from pg_attribute att
            where att.attrelid = idx.indrelid
              and att.attnum = any (idx.indkey::smallint[]))
          = array['organization_id', 'match_provider_kind', 'match_model', 'source']
     from pg_index idx
    where idx.indexrelid = 'ouroboros.model_prices_match_key'::regclass),
  'model_prices_match_key: one price per workspace, kind, model and source — with nulls not distinct, so the bundled half is a key at all');

select pg_temp.must_hold(
  (select confdeltype = 'r' from pg_constraint
    where conrelid = 'ouroboros.model_aliases'::regclass
      and conname = 'model_aliases_provider_fk' and contype = 'f'),
  'model_aliases_provider_fk: a connection an alias is bound to cannot be deleted (restrict, not cascade)');

select pg_temp.must_hold(
  (select confdeltype = 'r' from pg_constraint
    where conrelid = 'ouroboros.route_hops'::regclass
      and conname = 'route_hops_alias_fk' and contype = 'f'),
  'route_hops_alias_fk: an alias a hop names cannot be deleted (restrict, not cascade)');

-- ---------------------------------------------------------------------------
-- The fixtures go, so this file leaves the transaction as clean as it found it — which is
-- what lets constraints.sql go on running after it, and what makes a run against a database
-- somebody is using an ordinary thing to do rather than a thing to be careful about.
--
-- The workspace cascade is the delete: two statements take the connections, the aliases, the
-- kinds, the routes, the hops and the price overrides with them. The one bundled row this
-- file wrote belongs to no workspace, so it is named.
-- ---------------------------------------------------------------------------
delete from ouroboros.organization where "id" in ('org-cg5', 'org-cg5-other');
delete from ouroboros.model_prices where catalog_version = 'cg5-probe';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_aliases
    where organization_id in ('org-cg5', 'org-cg5-other'))
   and (select count(*) = 0 from ouroboros.provider_connections
         where organization_id in ('org-cg5', 'org-cg5-other'))
   and (select count(*) = 0 from ouroboros.route_hops
         where organization_id in ('org-cg5', 'org-cg5-other'))
   and (select count(*) = 0 from ouroboros.model_prices
         where organization_id = 'org-cg5' or catalog_version = 'cg5-probe'),
  'and deleting the two workspaces takes every registry row this file wrote with them');
