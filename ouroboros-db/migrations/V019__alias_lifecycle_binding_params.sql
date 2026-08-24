-- V019__alias_lifecycle_binding_params.sql — the three things mockup 21's allowed-models
-- table needs from an alias that Y.1 deliberately deferred: a **switch**, a **binding that
-- may be absent**, and **params that cannot lie**.
--
-- Filed as issue #579 (CG.1). Extends Y.1 (#189) — never forks it, which is roadmap
-- decision **R1** (docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md). Coordinates with AC.6 (#221),
-- whose `provider_models` is the binding target and whose soft alias validation is amended
-- below. Blocks CG.3 (#581), CG.4 (#582) and CH.1 (#584).
--
-- V015's header says what it left undone in one line — *"07/21 build UIs later"* — and this
-- is that later. The last row of mockup 21's table
-- (docs/mockups/21-model-registry.html) is this migration's specification:
--
--   gpt5-experiments   — no provider   gpt-5.2-preview   —   ✗ no key — connect a provider
--                                                            [Fix in Providers →]   [off]
--
-- …dimmed, switch off. Nothing in V015 can store that row: the foreign key is mandatory, so
-- an alias created ahead of its key cannot exist at all. Alongside it, the params chips
-- every other row carries — `(max thinking)(400k budget)`, `(std thinking)`, `(temp 0)(8k
-- out)`, `(review vote only)`, `(ctx 32k)`, `(batch ok)` — which are **derived from
-- structure** (decision **R3**), and therefore only as true as the structure they are
-- derived from.
--
-- ---------------------------------------------------------------------------
-- `enabled` is not provider health, and it is not a delete.
-- ---------------------------------------------------------------------------
--
-- The table's `On` column is a third thing beside the two that already exist. It is not
-- `provider_connections.status` (V015), which is what a health check *measured* — decision
-- **M8** — and it is not `provider_connections.enabled` (V017), which switches off a whole
-- provider and every alias that resolves on it. It is an operator saying *this name exists
-- and must not be routed to right now*, about one alias.
--
-- Deleting instead is the thing it exists to avoid: an alias is referenced **by name**
-- inside workflow documents and by id from `route_hops` (V016), so retiring one is a
-- change to every route that named it. The switch is how a model is taken out of service
-- without that — the routes keep their chains, resolution drops the hop with an explanation
-- (decision **R2**), and turning it back on restores exactly what was there.
--
-- `not null default true`, on V017's argument for the connection switch: a nullable switch
-- has a third position the table cannot draw, and an alias somebody has just created is one
-- they intend to use. The exception is the whole of the next section.
--
-- ---------------------------------------------------------------------------
-- The unbound state, and why the database is where *"it can never be switched on"* lives.
-- ---------------------------------------------------------------------------
--
-- `provider_connection_id` becomes **nullable**, and null means **unbound**: an alias with
-- a `model_id` and no provider to reach it on. `gpt5-experiments` is that row — a name
-- created ahead of a key, which is decision **R7**'s one deliberate exception to *import
-- never invents models*.
--
-- An unbound alias must never be enabled. Enabling one would let resolution (Z.1, #194)
-- select a binding that resolves to nothing, which is a run that fails at invocation time
-- for a reason nobody chose — decision **R2**. So it is a CHECK:
--
--   check (provider_connection_id is not null or enabled = false)
--
-- at the database rather than in the service, because *no service path can race past it*.
-- The window a service-level guard leaves open is real and small: read the alias, see a
-- binding, enable it, while a concurrent statement clears the binding. Two statements that
-- are each correct leave a row that is not. A CHECK is evaluated against the row that is
-- actually being written, so the only outcome is a refusal.
--
-- **The default is deliberately not weakened to make this convenient.** `enabled` defaults
-- true, so creating an unbound alias without saying `enabled = false` is refused rather
-- than quietly corrected. That is the intended shape: *this alias has no key yet and is
-- off* is a statement the writer makes, not one the database makes on their behalf.
--
-- **The composite foreign key needs no change, and that is worth stating rather than
-- discovering.** `model_aliases_provider_fk` is `MATCH SIMPLE` — PostgreSQL's default and
-- the SQL standard's — under which a reference with *any* null column is satisfied without
-- being checked. `organization_id` stays `not null`, so an unbound row is
-- `(org, null)` and the key is simply not applied to it; a bound row is checked exactly as
-- before. Written `MATCH FULL` it would refuse the unbound row outright, which is why the
-- match type is now an assertion in tests/constraints.sql rather than a default nobody
-- looked at.
--
-- What the two reads on the referencing side do with null follows from that and is checked
-- too: `aliasesForConnection` — the list AD.2's delete refusal (#223) names — is
-- `where provider_connection_id = $1`, which never matches null, so an unbound alias does
-- not depend on any connection and cannot block any deletion. And `route_hops_alias_fk`
-- (V016) is untouched: a hop names an alias by id, and whether that alias has a binding is
-- not a referential question. Both are regression-asserted rather than assumed, because
-- *"nothing else changed"* is the claim a widened column most often gets wrong.
--
-- ---------------------------------------------------------------------------
-- Params are a closed vocabulary, because the chips are derived from them.
-- ---------------------------------------------------------------------------
--
-- V015 made `params` an object and stopped there, which was right for a foundation whose
-- only reader merged it into a request body. It is wrong for a table that *renders* it.
-- Decision **R3**: the chips are server-derived from structure, exactly as V018's rule
-- sentences are — and a derivation over a free-form document either drops what it does not
-- recognise or prints it raw. The first makes a saved param silently do nothing; the second
-- prints `(0.30000000000000004 temperature)` on the densest table in the product.
--
-- So five keys, and nothing else:
--
--   | key             | type    | rule                                              |
--   |-----------------|---------|---------------------------------------------------|
--   | `thinking`      | string  | `off` \| `std` \| `max`                           |
--   | `token_budget`  | number  | whole, 1 … 10 000 000                              |
--   | `max_output`    | number  | whole, 1 … 10 000 000                              |
--   | `context_clamp` | number  | whole, 1 … 10 000 000                              |
--   | `temperature`   | number  | 0 … 2, fractional                                  |
--
-- One rule for the three token counts rather than three, because they are the same kind of
-- quantity: a whole number of tokens, at least one, below a ceiling no vendor is near. Zero
-- is refused for all three — a budget of zero tokens is not a small budget, it is a param
-- that means *do not answer*, and every place it could be typed meant to clear the field
-- instead. **Clearing a param is removing the key**, which is how absence is said
-- everywhere else in this schema and what makes *unset* legible beside *set to nothing*.
--
-- `temperature` is bounded 0 … 2 because that is the widest range any current vendor
-- accepts, not because any one model accepts it: the issue's example — a 3.0 persisted
-- against a model whose maximum is 1 — is refused here at 3.0, and the 1.5 that is
-- out of range *for that model* is refused one layer up.
--
-- **That layer is CH.2 (#585), and the split is the point.** This migration stops the shape
-- from being wrong; it cannot stop the *meaning* from being wrong, because meaning is a
-- fact about the bound model — a thinking budget against a model with no thinking is a
-- perfectly well-shaped document. Semantic validation reads the adapter's `paramSchema`
-- and `provider_models.meta` (V017), neither of which a CHECK may look at, and neither of
-- which exists at all for an unbound alias. A database that tried would be enforcing a
-- rule it can only sometimes see.
--
-- Widening the vocabulary is an ordinary migration, which is V015's argument for the `kind`
-- and `status` CHECKs and the reason the current width is asserted rather than assumed.
--
-- **What V018's rule params are, and why they stay looser.** An escalation rule's
-- `then.use_alias.params` (V018, #191) is the same *shape* — a flat object of scalars that
-- Z.1 merges over this column — but its domain checks scalars and key hygiene rather than
-- this vocabulary, and it is not narrowed here. It is a different write with a different
-- reader: the rule's params are rendered into `escalation_rules.display` by an `immutable`
-- derivation that already handles any scalar, and narrowing a shipped grammar is a change
-- to rules that exist rather than a rule about rows that do not. The seam is real and is
-- named here so the next reader meets it as a decision: a rule may carry a param key an
-- alias could not, and CH.2 is where the merged result is validated against the model.
--
-- ---------------------------------------------------------------------------
-- `restrictions` is registry policy, which is why it is not a param.
-- ---------------------------------------------------------------------------
--
-- `review vote only` and `batch ok` are chips on the same cell, and putting them in the
-- same column would be the mistake. A param is *what we send the provider*; a restriction
-- is *what this workspace allows this alias to be used for*, and it is true of the alias
-- independent of what any provider supports — `second-opinion` is review-vote-only because
-- an operator said so, not because Cursor said so. Merging one into a request body is
-- correct; merging the other would send `review_vote_only: true` to a vendor that has never
-- heard of it.
--
-- Same known-keys discipline, two flags, boolean values. Absence and `false` both mean
-- *not restricted* — a boolean flag reads naturally in both spellings and the chip renders
-- on `true` either way — so `false` is admitted rather than being a third thing to explain
-- at every call site that toggles one.
--
-- ---------------------------------------------------------------------------
-- Authorship, and what it is for.
-- ---------------------------------------------------------------------------
--
-- `notes` is an operator's prose about why an alias exists — *dev key, do not point routes
-- at this* — and `updated_by` is who last wrote the row. `updated_at` already exists, moved
-- by V015's touch trigger, so only the person is added.
--
-- `updated_by` **sets null** rather than cascading, exactly as `workspace_settings.updated_by`
-- (V011), `routes.updated_by` (V016) and `provider_connections.added_by` (V017) do, and for
-- the same reason: deleting the person who last edited an alias must not delete the alias.
-- What is lost is the attribution, which is the honest outcome. It is nullable for the
-- second reason as well — a row written by a migration, an import or a service account was
-- written by nobody in that table.
--
-- Together they are the revision record CH.1 (#584) emits on every write and CJ.2 (#599)
-- later promotes to an audit event. Neither is a history: this schema keeps *who last*, and
-- the sequence of edits belongs to whatever writes those events.
--
-- ---------------------------------------------------------------------------
-- Rename stays allowed here — decision **R5**.
-- ---------------------------------------------------------------------------
--
-- An alias is referenced by **name** inside workflow documents, and by id from `route_hops`.
-- The second is a foreign key and already restricts; the first is a string inside a jsonb
-- column of a table this migration does not know about. A database constraint cannot see it,
-- so a rename guard written here would be half a rule — refusing the renames it can see and
-- silently allowing the ones that actually break a published workflow. The guard is CH.1's,
-- over CG.3's (#581) reference index, where all four reference kinds are visible at once.
--
-- ---------------------------------------------------------------------------
-- Existing rows migrate unchanged.
-- ---------------------------------------------------------------------------
--
-- `enabled` defaults true and every existing row is bound, so every one of them satisfies
-- the binding CHECK on the way in. `restrictions` defaults `{}`. The params vocabulary is
-- validated against existing rows by `alter table` itself — which is the point of adding it
-- as a table constraint rather than trusting future writers — and it admits every shape
-- anything in this repository has ever written: `{}` and `{"thinking": "max"}`. Y.4's six
-- mockup-06 aliases (#192) have not landed yet, so the seeded rows this criterion names are
-- the ones CG.4 (#582) writes *into* this shape rather than rows that have to survive it.
--
-- House snake_case throughout — decision **A4**. `"user"` is referenced by its quoted
-- camelCase `"id"`, because that is BetterAuth's column (V004).
--
-- No seed rows. CG.4 (#582) is what fills these columns with mockup-21 parity data, in a
-- development database and nowhere else.

-- ---------------------------------------------------------------------------
-- The two validators.
--
-- Functions rather than CHECK expressions written inline, for V018's reason: a vocabulary
-- with per-key value rules is control flow, and a boolean expression that encodes control
-- flow is one nobody will edit correctly. `immutable` because a CHECK may only call a
-- function that is — they read their argument and nothing else, no table, no clock, no
-- session setting — and `strict`, so a null argument is null rather than a scan of nothing.
-- Neither column is nullable, so `strict` is a statement about the function rather than a
-- case that arises.
--
-- Both are total: an argument that is not an object returns false rather than raising, so
-- the constraint's answer is always a refusal a reader can act on.
-- ---------------------------------------------------------------------------

-- Whether a params document is inside the vocabulary above.
--
--   params  — the document, as written
--   returns — true when every key is known and every value is in range
create function ouroboros.model_alias_params_valid(params jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  param_key   text;
  param_value jsonb;
  amount      numeric;
  -- One ceiling for the three token counts. Far above any current context window, so it
  -- refuses a typo and a unit mistake without pretending to know a model's real limit —
  -- which is CH.2's (#585) to read from the adapter and from provider_models.meta.
  token_ceiling constant numeric := 10000000;
begin
  if jsonb_typeof(params) <> 'object' then
    return false;
  end if;

  for param_key, param_value in select p.key, p.value from jsonb_each(params) as p loop
    case param_key
      -- The chips' `(max thinking)` and `(std thinking)`. `off` is the third position and
      -- is not the same as omitting the key: omitted is *whatever the adapter defaults to*,
      -- `off` is *this workspace has decided against it for this alias*.
      when 'thinking' then
        if jsonb_typeof(param_value) <> 'string'
           or (param_value #>> '{}') not in ('off', 'std', 'max') then
          return false;
        end if;

      -- The chips' `400k budget`, `8k out` and `ctx 32k`. Whole tokens, at least one: see
      -- the header on why zero is refused rather than read as "no budget".
      when 'token_budget', 'max_output', 'context_clamp' then
        if jsonb_typeof(param_value) <> 'number' then
          return false;
        end if;

        amount := param_value::numeric;

        if amount <> trunc(amount) or amount < 1 or amount > token_ceiling then
          return false;
        end if;

      -- The chip's `temp 0`. Fractional by nature, and bounded by the widest range any
      -- vendor accepts rather than by the range one model accepts.
      when 'temperature' then
        if jsonb_typeof(param_value) <> 'number' then
          return false;
        end if;

        amount := param_value::numeric;

        if amount < 0 or amount > 2 then
          return false;
        end if;

      -- An unknown key. The chips are derived from this document, so a key nothing derives
      -- is a param that was saved, renders nowhere, and is sent nowhere.
      else
        return false;
    end case;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.model_alias_params_valid(jsonb) is
  'Whether a model_aliases.params document is inside the registry vocabulary (#579, decision R3): thinking (off|std|max), token_budget, max_output and context_clamp (whole tokens, 1 to 10000000) and temperature (0 to 2). Unknown keys are refused, because mockup 21''s param chips are derived from this document and a key nothing derives is a param that renders nowhere and is sent nowhere. Shape only — whether a param means anything for the bound model is CH.2''s (#585), which reads the adapter schema and provider_models.meta that no CHECK may look at.';

-- Whether a restrictions document is inside the two-flag vocabulary.
--
--   restrictions — the document, as written
--   returns      — true when every key is a known flag with a boolean value
create function ouroboros.model_alias_restrictions_valid(restrictions jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  flag_key   text;
  flag_value jsonb;
begin
  if jsonb_typeof(restrictions) <> 'object' then
    return false;
  end if;

  for flag_key, flag_value in select r.key, r.value from jsonb_each(restrictions) as r loop
    -- The chips' `review vote only` and `batch ok`. Registry policy, which is why these are
    -- not params — see the header.
    if flag_key not in ('review_vote_only', 'batch_ok') then
      return false;
    end if;

    -- A flag is a boolean. `"true"` and `1` are the two shapes a form submits when nothing
    -- coerced them, and both would be truthy to a reader that only asked whether the key
    -- was there.
    if jsonb_typeof(flag_value) <> 'boolean' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.model_alias_restrictions_valid(jsonb) is
  'Whether a model_aliases.restrictions document is inside the two-flag vocabulary (#579, decision R3): review_vote_only and batch_ok, boolean. Separate from params because a restriction is what this workspace allows an alias to be used for — true of the alias regardless of what the provider supports — while a param is what gets merged into a request body.';

-- ---------------------------------------------------------------------------
-- model_aliases — the switch, the unbound binding, the structured documents, authorship.
-- ---------------------------------------------------------------------------
alter table ouroboros.model_aliases
  -- The table's `On` switch. See the header: not provider health, not the provider's own
  -- switch, and not a delete.
  add column enabled boolean not null default true,

  -- The registry policy flags — `review vote only`, `batch ok`. Held to the two-flag
  -- vocabulary by the validator above, and `{}` for the alias nobody has restricted, which
  -- is almost all of them.
  add column restrictions jsonb not null default '{}'::jsonb,

  -- The inspector's free-text note about why this alias exists. Nullable, and null is the
  -- ordinary state: a required note would make the create form demand prose before it will
  -- store a name.
  add column notes text,

  -- Who last wrote this row. Half of the revision record CH.1 (#584) emits; the other half
  -- is V015's updated_at, which its touch trigger already moves.
  add column updated_by text;

-- **Null means unbound.** The one statement this whole migration is arranged around — see
-- the header for why the composite foreign key needs no change to accept it, and why the
-- CHECK below has to be a CHECK.
alter table ouroboros.model_aliases
  alter column provider_connection_id drop not null;

alter table ouroboros.model_aliases
  -- Decision R2, at the database. An unbound alias can never be switched on, so no service
  -- path can race past it and no seed, migration or hand-run update can write past it
  -- either.
  add constraint model_aliases_unbound_disabled
    check (provider_connection_id is not null or enabled = false),

  -- The params vocabulary. Validated against existing rows by this statement, which is the
  -- reason it is a table constraint rather than a promise about future writers.
  --
  -- **The object guard is deliberate, and it is not redundant.** V015's
  -- `model_aliases_params_object` already owns *params is an object*; this constraint owns
  -- *its keys and values are in the vocabulary*, and a document that is not an object has
  -- no keys for that rule to be about. Without the guard both constraints refuse the same
  -- statement and which one PostgreSQL reports is unspecified — so V015's assertion, which
  -- names its constraint, would pass or fail on evaluation order. The validator itself
  -- stays total and answers false for a non-object, so the `or` is correct whichever side
  -- the planner evaluates first.
  add constraint model_aliases_params_known
    check (jsonb_typeof(params) <> 'object'
           or ouroboros.model_alias_params_valid(params)),

  -- No such guard here: `restrictions` is this migration's column, so one constraint owns
  -- the whole rule and there is no older one to collide with.
  add constraint model_aliases_restrictions_known
    check (ouroboros.model_alias_restrictions_valid(restrictions)),

  -- Present, trimmed and bounded, on the pattern V017 gave `capability_note` — a blank
  -- string is what a form submits when it meant to submit nothing, and it would render as
  -- an empty note rather than as no note. Longer than that column's 160, because this is a
  -- paragraph in an inspector rather than a line on a card.
  add constraint model_aliases_notes_present
    check (notes is null
           or (btrim(notes) = notes and notes <> '' and length(notes) <= 2000)),

  -- Named rather than left to PostgreSQL's `…_updated_by_fkey`, on V017's precedent: a name
  -- this migration chose is a name a probe or an assertion can refer to.
  add constraint model_aliases_updated_by_fk
    foreign key (updated_by) references ouroboros."user" ("id") on delete set null;

comment on column ouroboros.model_aliases.enabled is
  'Mockup 21''s On switch — may routing use this alias right now (#579). Not provider health (provider_connections.status, decision M8) and not the provider''s own switch (provider_connections.enabled, V017): those are about a connection, this is about one name on it. Defaults true, because an alias somebody just created is one they intend to use — and an unbound alias must therefore say enabled = false explicitly, which model_aliases_unbound_disabled enforces. Switching off leaves every route and workflow reference intact; deleting does not, which is why the switch exists.';
comment on column ouroboros.model_aliases.provider_connection_id is
  'The connection this alias resolves on, or NULL for the unbound state (#579, decision R2) — mockup 21''s gpt5-experiments row, a name created ahead of its key. Half of model_aliases_provider_fk, whose other half is organization_id — which is what makes the tenancy rule declarative rather than a trigger, and which MATCH SIMPLE simply does not apply to a row whose binding is null. An unbound alias can never be enabled, and depends on no connection: it blocks no provider deletion.';
comment on column ouroboros.model_aliases.params is
  'Per-alias invocation defaults, and a closed vocabulary since #579 (decision R3): thinking (off|std|max), token_budget, max_output, context_clamp (whole tokens, 1 to 10000000) and temperature (0 to 2). Unknown keys are refused by model_aliases_params_known, because mockup 21''s chips are derived from this structure and a derivation over a free-form document either drops what it cannot read or prints it raw. Shape only — a param that is well-formed and meaningless for the bound model is CH.2''s (#585) to refuse.';
comment on column ouroboros.model_aliases.restrictions is
  'What this workspace allows this alias to be used for — review_vote_only and batch_ok, mockup 21''s "review vote only" and "batch ok" chips (#579, decision R3). Registry policy rather than provider capability, which is why it is not params: a param is merged into a request body and a restriction never leaves this product. Absence and false both mean unrestricted.';
comment on column ouroboros.model_aliases.notes is
  'An operator''s prose about why this alias exists — "dev key, do not point routes at this" (#579). Nullable, and null is the ordinary state; a blank string is refused, because it renders as an empty note rather than as no note.';
comment on column ouroboros.model_aliases.updated_by is
  'Who last wrote this row — half of the revision record CH.1 (#584) emits and CJ.2 (#599) promotes to an audit event; the other half is updated_at, which V015''s touch trigger moves. References "user" and SETS NULL rather than cascading, because deleting the person who last edited an alias must not delete the alias. Null is also the honest state for a row written by a migration, an import or a service account.';

comment on constraint model_aliases_unbound_disabled on ouroboros.model_aliases is
  'An unbound alias can never be switched on (#579, decision R2). At the database rather than in a service because a service-level guard leaves a window — read the binding, enable, while a concurrent statement clears the binding — in which two correct statements leave a row that is not. Enabling it would let resolution select a binding that resolves to nothing.';
comment on constraint model_aliases_params_known on ouroboros.model_aliases is
  'The params vocabulary (#579, decision R3), through ouroboros.model_alias_params_valid(). A table constraint rather than a convention, so ALTER TABLE validated every row that already existed and no writer — seed, migration or hand-run update — can add a key the chips cannot render. It owns the keys and values only: that params is an object at all is V015''s model_aliases_params_object, and the guard in this expression is what keeps one statement from being refused by two constraints in an unspecified order.';
comment on constraint model_aliases_restrictions_known on ouroboros.model_aliases is
  'The two-flag restrictions vocabulary (#579, decision R3), through ouroboros.model_alias_restrictions_valid(). Boolean values only: "true" and 1 are what a form submits when nothing coerced them, and both read as true to anything that only asks whether the key is present.';

comment on table ouroboros.model_aliases is
  'The names a workspace''s routes may use, and what each resolves to (#189, decisions M1 and M2; extended by #579, decision R1). model_id is the only column in this schema where a raw provider model string lives, which is what makes swapping a model one edit of one row. Since V019 it is also mockup 21''s management surface: enabled is the On switch, a NULL provider_connection_id is the unbound state an alias created ahead of its key sits in — and can never be enabled from — and params and restrictions are closed vocabularies, because the table''s chips are derived from them.';

-- ---------------------------------------------------------------------------
-- V017's soft alias validation, amended for the state it predates.
--
-- `warn_undiscovered_alias_model()` (#221, decision P6) warns when an alias names a model
-- discovery has not reported, and tells a *gap* (nothing discovered on this connection yet)
-- from a *mismatch* (its catalog lists other models). An unbound alias is neither: there is
-- no connection to have discovered anything, so the question the warning asks has no
-- subject. Left unamended it takes the gap branch and reports *nothing has been discovered
-- on it yet* about a connection that does not exist — a warning nobody can act on, on the
-- one write this migration exists to make possible.
--
-- Replaced rather than dropped and recreated: the trigger V017 attached keeps pointing at
-- this function, so the `before insert or update of provider_connection_id, model_id`
-- column list — which is a rule of its own, asserted in tests/constraints.sql — is
-- untouched. Both of its message branches survive unchanged, which is what keeps `ci/db`'s
-- grep of the constraints.sql transcript meaningful.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.warn_undiscovered_alias_model()
returns trigger
language plpgsql
as $$
begin
  -- Unbound (#579): no connection, therefore no catalog to be right or wrong about. The
  -- state this alias is in is rendered by mockup 21 as `no key — connect a provider`, which
  -- is a designed row rather than a warning in a log.
  if new.provider_connection_id is null then
    return new;
  end if;

  if ouroboros.provider_model_discovered(new.provider_connection_id, new.model_id) then
    return new;
  end if;

  if exists (select 1
               from ouroboros.provider_models pm
              where pm.provider_connection_id = new.provider_connection_id) then
    raise warning 'alias "%" names model "%", which discovery has not reported on this connection — its catalog lists other models',
      new.alias, new.model_id
      using hint = 'Discovery (AC.2–AC.5) upserts ouroboros.provider_models; check the spelling against that connection''s catalog. Soft in MVP by decision P6 — the row is written.';
  else
    raise warning 'alias "%" names model "%", which discovery has not reported on this connection — nothing has been discovered on it yet',
      new.alias, new.model_id
      using hint = 'Run discovery for this connection (AE.4) to fill ouroboros.provider_models. Soft in MVP by decision P6 — the row is written.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.warn_undiscovered_alias_model() is
  'The trigger function behind V017''s soft alias validation (#221, decision P6): warns, without refusing, when an alias names a model discovery has not reported on its connection, telling a gap from a mismatch. Since #579 an unbound alias returns before either branch — there is no connection to have discovered anything, so the gap message would name one that does not exist.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- **The registry's table read needs none, and that is asserted rather than assumed.** The
-- single query behind mockup 21's eight rows (CI.1, #588) is the workspace's aliases
-- ordered by name, left-joined to the connection each is bound to:
--
--   select a.alias, a.model_id, a.enabled, a.params, a.restrictions,
--          c.kind, c.display_name, c.status
--     from ouroboros.model_aliases a
--     left join ouroboros.provider_connections c
--       on c.organization_id = a.organization_id and c.id = a.provider_connection_id
--    where a.organization_id = $1
--    order by a.alias;
--
-- `model_aliases_organization_alias_key` (V015) is `(organization_id, alias)`, so it is the
-- range scan *and* the ordering, and `provider_connections_organization_id_key` (V015) is
-- the join's other side. Both exist because a rule needed them — uniqueness per workspace,
-- and the composite foreign key's target — which is V015's arrangement holding one table
-- wider: the fast path is the one the constraints already paid for. Adding a third index
-- for this read would be a duplicate that every write then maintains, so tests/constraints.sql
-- asserts the plan instead.
--
-- One index is added, for the read this migration *creates*.
-- ---------------------------------------------------------------------------

-- The unbound aliases of a workspace — the rows mockup 21 dims and offers
-- `Fix in Providers →` on, and the set CH.1's rebind flow works through.
--
-- **Partial, because unbound is the exception.** Every entry in this index is a row with no
-- binding, so it is a handful of tuples in a workspace that has any and nothing at all in
-- one that does not — where a full index on the same columns would carry every alias to
-- answer a question about almost none of them. `model_aliases_provider_idx` (V015) can
-- serve the same predicate, since a btree does index nulls, but it exists for the foreign
-- key's referencing side and would be scanned past every bound alias to reach them.
--
-- Ordered by `alias` for the reason the table read is: this is a list somebody reads.
create index model_aliases_unbound_idx
  on ouroboros.model_aliases (organization_id, alias)
  where provider_connection_id is null;

comment on index ouroboros.model_aliases_unbound_idx is
  'The workspace''s unbound aliases (#579) — mockup 21''s dimmed rows with "Fix in Providers →", and the set CH.1''s (#584) rebind flow works through. Partial, because unbound is the exception: every entry is a row with no binding, so it holds nothing at all in a workspace where every alias has a key.';
