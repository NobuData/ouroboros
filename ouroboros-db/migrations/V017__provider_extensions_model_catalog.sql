-- V017__provider_extensions_model_catalog.sql — what mockup 07's provider cards show
-- beyond a name and a status, and `provider_models`: the catalog discovery writes and
-- three different readers depend on.
--
-- Filed as issue #221 (AC.6). Extends Y.1 (#189) — never forks it. Coordinates its seeds
-- with Y.4 (#192) and DASH-F.5 (#68). Feeds every issue in Epic AE (#228–#233), and its
-- catalog is what mockup 21's registry (docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md) and
-- Y.1's alias validation read.
--
-- V015 deliberately shipped the *minimum* provider schema — enough for an alias to
-- resolve — and left the management surface to this roadmap (decision **M2**). So
-- everything a card in docs/mockups/07-providers.html displays that is not a live API
-- call is missing, and this is where it arrives:
--
--   * the enable **switch** — `enabled`, which is an operator's intent and is *not* the
--     health `status` Z.3 (#196) maintains,
--   * the meta row — *Added by Ken · 2026-06-12 · last used 3m ago* — `added_by`, the
--     row's own `created_at`, and `last_used_at`,
--   * the capability line — *api.anthropic.com · primary coding lane*, *self-hosted ·
--     A100 ×2* — `capability_note`,
--   * the **Monthly cap** field and the meter beside it (`$412.80 of $600`) —
--     `monthly_cap_cents`, against calendar-month spend from `token_usage` (V010),
--   * the model chips and the Ollama pull-list — `provider_models`, below.
--
-- ---------------------------------------------------------------------------
-- `enabled` is not `status`, and the card draws both.
-- ---------------------------------------------------------------------------
--
-- A card carries a switch *and* a pill, and they answer different questions. `status`
-- (V015) is a measurement — what the last health check found, `unknown` until one has run
-- (decision **M8**). `enabled` is an answer to *may we use this at all*, given by a person,
-- and nothing measures it.
--
-- Collapsing them would lose one of the two: an operator switching a provider off would
-- either be overwritten by the next health check, or would have to be encoded as
-- `status = 'paused'` — which is how V015 spells "an operator switched it off" *within the
-- health vocabulary*, and which the next successful check would then have to know not to
-- clear. Two columns is what lets Z.3 write `status` on a schedule while `enabled` is
-- written only by AD.2 (#223), and what lets the card render *connected* beside a switch
-- that is off, which is a real and legible state.
--
-- `paused` therefore stays in the `status` vocabulary and stays V015's: it is what a
-- health service records about a connection an operator has turned off. `enabled` is the
-- switch itself. `tests/constraints.sql` asserts the two are independently settable in all
-- four combinations, because a reader would reasonably suspect a duplicated concept.
--
-- ---------------------------------------------------------------------------
-- `capability_note` holds the card's line, not a rule for composing one.
-- ---------------------------------------------------------------------------
--
-- The five lines mockup 07 prints are not mechanically derivable from anything else in
-- this schema: two lead with a hostname the connection has no `base_url` for (a cloud
-- provider at its vendor default), one names a GitHub organization, and two describe
-- hardware or purpose (*self-hosted · A100 ×2*, *zero-cost lane — used for docs & commit
-- messages*). A derived line would be a rule with five exceptions, so the column holds the
-- sentence and AE.2 (#228) prints it.
--
-- Nullable, because a connection somebody added without one still has to render — the card
-- simply drops the line — and a required column here would make the add-form (AE.5, #231)
-- demand prose before it will store an address.
--
-- ---------------------------------------------------------------------------
-- `monthly_cap_cents` is integer cents, nullable, and non-negative.
-- ---------------------------------------------------------------------------
--
-- Cents for the reason `routes.max_cost_cents_per_run` (V016) is: money in a float is a
-- rounding error waiting to be argued about, and `$600` is `60000`. **Null is a real
-- value** — it is the `—` the mockup renders for both local providers, and it means *no
-- cap*, which is not the same as a cap of zero. Zero is admitted deliberately: it is
-- *spend nothing*, and AF.4 (#237) enforcing it is a legitimate way to mothball a
-- connection without deleting its configuration.
--
-- Caps are **warning-only until AF.4** (decision **P7**) — nothing in this migration
-- enforces one, and the meter is arithmetic over `token_usage`. What the schema owes that
-- arithmetic is that the number cannot be negative, which is what the CHECK is for: a
-- negative cap renders a meter that is already past 100% for a workspace that has spent
-- nothing.
--
-- **How a meter is computed, since no column holds it.** Calendar-month spend for a
-- connection is the sum of `token_usage.cost_cents` over the workspace's rows whose
-- `provider` equals the connection's `kind`, for the current month:
--
--   select sum(u.cost_cents)
--     from ouroboros.token_usage u
--    where u.organization_id = c.organization_id
--      and u.provider = c.kind
--      and u.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
--
-- Attribution is by *kind* because that is the only attribution `token_usage` can carry
-- today: V010's ledger records a `provider` string, and AF.2 (#235) — the invocation
-- gateway that will write those rows per hop — is what could one day record the connection
-- id itself. Naming that here rather than inventing the column now is deliberate: a
-- `provider_connection_id` on `token_usage` written by nothing would be null on every
-- existing row, and a meter that read it would render `$0.00` for a workspace that has
-- spent money. `tests/seed.sql` computes the mockup's five figures with exactly the query
-- above, so the arithmetic is asserted where the seed can be seen.
--
-- ---------------------------------------------------------------------------
-- `provider_models` — discovered truth, and the three readers that need it.
-- ---------------------------------------------------------------------------
--
-- Decision **P6**: *"Models available"* must be discovered truth rather than typed
-- strings. That means a table, because three things read it and none of them can be the
-- one that owns it:
--
--   * the cards (AE.2/AE.4) — the chips, and the Ollama pull-list with its `19 GB` tags,
--   * mockup 21's registry — the model column, the import wizard (CH.4, #587), and the
--     param service (CH.2, #585) which merges `meta` with an adapter's `paramSchema`,
--   * Y.1's alias validation, which today has **no way at all** to know whether
--     `coder-max`'s `model_id` still exists on its provider.
--
-- The rows come from `ModelProviderAdapter.discoverModels()` (AC.1, #216) — one row per
-- `NormalizedModel`, `model_id` from its `id`, `display` from its `display`, `size_bytes`
-- from its `sizeBytes`, and its `contextLength` into `meta.context_tokens`, which is the
-- key `model_prices.meta` (V012) already carries so a caller reading both is not made to
-- translate. Discovery re-runs, so the write is an upsert on the unique key:
--
--   insert into ouroboros.provider_models
--        (provider_connection_id, model_id, display, size_bytes, meta, discovered_at)
--   values (…)
--       on conflict (provider_connection_id, model_id) do update
--          set display       = excluded.display,
--              size_bytes    = excluded.size_bytes,
--              meta          = excluded.meta,
--              discovered_at = excluded.discovered_at;
--
-- which is why `(provider_connection_id, model_id)` is a constraint rather than a
-- convention: without it a second discovery pass doubles every chip on the card.
--
-- **No `organization_id`, and that is the one deliberate departure from this schema's
-- tenancy habit.** Every workspace-scoped table here carries the workspace and holds a
-- composite foreign key to it (V015's `model_aliases` is the pattern). A discovered model
-- is not workspace configuration — it is a fact about a *connection*, which already
-- belongs to exactly one workspace, and every read of this table enters through a
-- connection the caller has already been authorized for. A second copy of the workspace id
-- here would be a second thing that can disagree with the first, and nothing would read it:
-- there is no query that wants *this workspace's models* other than through its
-- connections. It cascades from the connection, so a deleted connection takes its catalog
-- with it and a deleted workspace takes both.
--
-- No index is added. The unique key `(provider_connection_id, model_id)` is also the
-- referencing side of the foreign key and the leading column of *list this connection's
-- models*, so both reads and every connection delete enter through an index a rule already
-- paid for — the arrangement V015's header argues for, achieved here without the extra
-- index `model_aliases` needed (its foreign key is composite, and led with a different
-- column).
--
-- ---------------------------------------------------------------------------
-- Alias validation is a **warning**, and that is the whole design.
-- ---------------------------------------------------------------------------
--
-- An alias names a model on a connection; `provider_models` now knows which models a
-- connection has. The obvious next step — a foreign key — is the wrong one *in MVP*, and
-- the reason is a gap rather than a preference: discovery is not yet universal. A
-- connection is added before anything has discovered it (AE.5 stores the row, AE.4 runs
-- discovery afterwards), only two adapters ship discovery on day one, and an operator may
-- legitimately create an alias ahead of a key. A hard reference would refuse every one of
-- those, so the rule that would have been enforced would instead be worked around.
--
-- So the trigger below **warns and writes**. What it costs is that a mis-typed model id is
-- stored; what it buys is that the warning appears on exactly the write that caused it,
-- carrying the alias and the model, and that mockup 21 (CI.2/CI.3) has a signal to render
-- as *discovery mismatch*. It becomes enforceable — a `not valid` foreign key validated
-- once the catalogs are complete, or the same trigger raising instead of warning — the day
-- discovery covers every adapter, and nothing in this migration has to move for that.
--
-- The two branches are told apart on purpose: *nothing has been discovered on this
-- connection yet* is a gap, and *this connection's catalog does not list that model* is a
-- mismatch. A single message would make the first read like the second, and the first is
-- the ordinary state of a connection nobody has run discovery against.
--
-- ---------------------------------------------------------------------------
-- House snake_case throughout — decision **A4**. `"user"` is referenced by its quoted
-- camelCase `"id"`, because that is BetterAuth's column (V004).
--
-- No seed rows. migrations/R__dev_seed_providers.sql is what fills these columns and this
-- table with mockup-07 parity data, in a development database and nowhere else.

-- ---------------------------------------------------------------------------
-- provider_connections — the five columns a card shows.
-- ---------------------------------------------------------------------------
alter table ouroboros.provider_connections
  -- The monthly cap in whole cents, or null for *no cap* — the `—` both local providers
  -- render. Warning-only until AF.4 (decision P7); see the header for the meter's query.
  add column monthly_cap_cents integer,

  -- Who connected this provider — the meta row's *"Added by Ken"*.
  --
  -- **Sets null rather than cascading**, exactly as `workspace_settings.updated_by` (V011)
  -- and `routes.updated_by` (V016) do, and for the same reason: deleting the person who
  -- added a provider must not delete the workspace's provider. What is lost when they go is
  -- the attribution, which is the honest outcome — the card then renders the connection
  -- without a name in front of it rather than not at all.
  --
  -- Nullable for the second reason as well: a connection created by a migration, an import,
  -- or a service account was added by nobody in this table.
  add column added_by text,

  -- When something last invoked through this connection — the meta row's *last used 3m
  -- ago*, and the em-dash before the first call.
  --
  -- **Maintained by AF.2** (#235), the invocation gateway, which is the only thing that
  -- knows a call happened. Nothing in MVP writes it except the seed, and null is therefore
  -- the ordinary state rather than a defect: the card renders *never used* for a connection
  -- that has been configured and not yet called, which is what a freshly added provider is.
  --
  -- Not tied to `created_at` by a CHECK. Clocks are not the point — a row imported with a
  -- last-use time from another system is a legitimate write, and a rule that refused it
  -- would be defending a property nothing reads.
  add column last_used_at timestamptz,

  -- The card's second line, verbatim. See the header for why it is stored rather than
  -- composed.
  add column capability_note text,

  -- The card's switch: may this connection be used at all.
  --
  -- **Not the health `status`** — see the header. `not null default true`, because a
  -- provider somebody has just added is one they intend to use, and because a nullable
  -- switch would have a third state the card cannot draw.
  --
  -- Routing reads it: a disabled connection drops out of the health strip and out of chain
  -- resolution (Z.1, #194), which is the difference between *switched off* and *deleted* —
  -- the aliases and routes that name it survive, and turning it back on restores them.
  add column enabled boolean not null default true;

alter table ouroboros.provider_connections
  -- Non-negative, and zero is admitted deliberately. See the header.
  add constraint provider_connections_monthly_cap_nonnegative
    check (monthly_cap_cents is null or monthly_cap_cents >= 0),

  -- Present, trimmed and bounded, on the pattern V015 gave `display_name`. A blank string
  -- is what a form submits when it meant to submit nothing, and it would render as an empty
  -- second line rather than as no second line.
  add constraint provider_connections_capability_note_present
    check (capability_note is null
           or (btrim(capability_note) = capability_note
               and capability_note <> ''
               and length(capability_note) <= 160)),

  -- Named rather than left to PostgreSQL's `…_added_by_fkey`, so that the probe that drops
  -- it (tests/verify-constraint-probes.sh) names a constraint this migration creates.
  add constraint provider_connections_added_by_fk
    foreign key (added_by) references ouroboros."user" ("id") on delete set null;

comment on column ouroboros.provider_connections.monthly_cap_cents is
  'The card''s Monthly cap, in whole cents — $600 is 60000 (#221, decision P7). Null means no cap and is what the mockup renders as an em-dash for both local providers; zero is a real cap meaning spend nothing. Warning-only until AF.4 (#237) enforces it: the meter is arithmetic over token_usage (V010), summed per connection kind for the current calendar month.';
comment on column ouroboros.provider_connections.added_by is
  'Who connected this provider — the meta row''s "Added by Ken" (#221). References "user" and SETS NULL rather than cascading, because deleting the person who added a provider must not delete the workspace''s provider; the card then renders the connection without a name rather than not at all. Null is also the honest state for a connection created by an import or a service account.';
comment on column ouroboros.provider_connections.last_used_at is
  'When something last invoked through this connection — the meta row''s "last used 3m ago" (#221). Maintained by AF.2 (#235), the invocation gateway, which is the only thing that knows a call happened; null until then, and rendered as never used rather than as an unfilled column.';
comment on column ouroboros.provider_connections.capability_note is
  'The card''s capability line, verbatim — "api.anthropic.com · primary coding lane", "self-hosted · A100 ×2" (#221). Stored rather than composed: the mockup''s five lines are not derivable from any other column — two lead with a vendor host the row has no base_url for, one names a GitHub org, two describe hardware or purpose. Nullable, and a card with no note simply drops the line.';
comment on column ouroboros.provider_connections.enabled is
  'The card''s switch — may this connection be used at all (#221). NOT the health status: status is what the last check measured (Z.3, decision M8), this is what a person decided, and the card draws both. Defaults true because a provider somebody just added is one they intend to use. A disabled connection drops out of routing and out of the health strip while its aliases and routes survive, which is the difference between switched off and deleted.';

-- ---------------------------------------------------------------------------
-- provider_models — the discovered catalog (decision P6).
-- ---------------------------------------------------------------------------
create table ouroboros.provider_models (
  -- Surrogate key. Mockup 21's registry addresses a discovered model by it, so a uuid
  -- rather than a serial for V001's reason: an id that appears in a URL should not also be
  -- a count of how many exist.
  id                     uuid        primary key default gen_random_uuid(),

  -- The connection this model was discovered on.
  --
  -- **Cascade**, and the only tenancy this row has — see the header on why there is no
  -- `organization_id` beside it. A catalog outliving the connection it describes would be a
  -- list of models nothing can reach.
  provider_connection_id uuid        not null
                                     references ouroboros.provider_connections (id)
                                     on delete cascade,

  -- The provider's own identifier, unchanged — `claude-fable-5`, `qwen3-coder:32b`.
  --
  -- Unfolded, exactly as `model_aliases.model_id` (V015) is and for the same reason: it is
  -- the vendor's string, vendors disagree about case, and it is what the next call has to
  -- send back. This is *not* a second home for decision M1's raw model id — M1 is about
  -- what may name a model in a **route**, and a route still reaches one only through an
  -- alias. This column is discovery's report of what exists.
  model_id               text        not null,

  -- What a chip prints — `claude-fable-5`, `local/llama-4-maverick`, `cursor/composer-2`.
  --
  -- Required, because a chip with no text is a chip nobody can click; AC.1's adapter
  -- contract says the same, and falls back to the id where a provider publishes no display
  -- name. It is separate from `model_id` because the two genuinely differ — a locally
  -- served model's id is `llama-4-maverick` and what the card prints is
  -- `local/llama-4-maverick`, which says where it runs.
  display                text        not null,

  -- On-disk size in bytes, or null where the concept does not apply.
  --
  -- Only a locally-hosted model has one: this is the Ollama pull-list's `19 GB`, `63 GB`,
  -- `9.1 GB`, in **bytes**, because a number is a fact and `19 GB` is a rendering decision
  -- that belongs to AE.4 (#230). `bigint` — a 63 GB model is 6.3e10, which does not fit in
  -- an integer. Null for every cloud model, and null is not zero: a zero-byte model would
  -- render as a tag claiming a model that takes no space.
  size_bytes             bigint,

  -- What else discovery reported — `{"context_tokens": 200000}`, `{"tier": "priority"}`.
  --
  -- jsonb rather than columns for the reason `provider_connections.health` (V015) is: the
  -- keys genuinely differ per provider, and a context length is not something every one of
  -- them publishes. `context_tokens` is the key `model_prices.meta` (V012) already uses, so
  -- CH.2 (#585) merging a price and a discovered model is not made to translate.
  meta                   jsonb       not null default '{}'::jsonb,

  -- When discovery last reported this model. Moved by every upsert, which is what makes it
  -- the freshness mockup 21 renders as *listed live from the provider* — and why this table
  -- has no `updated_at`: it is a cache of what a provider said, and this is the stamp of
  -- when it said it.
  discovered_at          timestamptz not null default now(),

  -- **The rule the whole table turns on.** Discovery re-runs, so without this a second pass
  -- doubles every chip; with it the write is an upsert. See the header for the statement.
  constraint provider_models_connection_model_key
    unique (provider_connection_id, model_id),

  constraint provider_models_model_id_present
    check (btrim(model_id) = model_id and model_id <> '' and length(model_id) <= 200),

  constraint provider_models_display_present
    check (btrim(display) = display and display <> '' and length(display) <= 200),

  -- A size is a size. Negative is impossible and zero would be a claim.
  constraint provider_models_size_bytes_positive
    check (size_bytes is null or size_bytes > 0),

  constraint provider_models_meta_object
    check (jsonb_typeof(meta) = 'object')
);

comment on table ouroboros.provider_models is
  'The models a connection has, as discovery reported them (#221, decision P6) — the cards'' chips and Ollama pull-list, mockup 21''s registry, and what Y.1''s aliases are validated against. Written by ModelProviderAdapter.discoverModels() (AC.1) as an upsert on (provider_connection_id, model_id), so re-running discovery refreshes rather than duplicates. Deliberately carries no organization_id: a discovered model is a fact about a connection, which already belongs to exactly one workspace, and every read enters through one.';
comment on column ouroboros.provider_models.provider_connection_id is
  'The connection this model was discovered on, and this row''s only tenancy. ON DELETE CASCADE — a catalog outliving its connection is a list of models nothing can reach. Its unique key with model_id is also the index this foreign key''s referencing side needs, so a connection delete scans nothing.';
comment on column ouroboros.provider_models.model_id is
  'The provider''s own identifier, unfolded — claude-fable-5, qwen3-coder:32b. Not a second home for decision M1''s raw model id: M1 governs what may name a model in a route, and a route still reaches one only through an alias. This is discovery''s report of what exists.';
comment on column ouroboros.provider_models.display is
  'What a chip prints — local/llama-4-maverick beside a model_id of llama-4-maverick. Required: a chip with no text is a chip nobody can click, and AC.1''s adapter contract falls back to the id where a provider publishes no display name.';
comment on column ouroboros.provider_models.size_bytes is
  'On-disk size in bytes for a locally-hosted model, null for a cloud one — the pull-list''s 19 GB, in bytes because a number is a fact and the unit is a rendering decision (AE.4). bigint, since 63 GB does not fit in an integer. Null rather than zero: a zero would be a tag claiming a model that takes no space.';
comment on column ouroboros.provider_models.meta is
  'What else discovery reported — context_tokens, tier. jsonb because the keys differ per provider; context_tokens is the spelling model_prices.meta already uses, so a caller merging a price with a discovered model is not made to translate.';
comment on column ouroboros.provider_models.discovered_at is
  'When discovery last reported this model; moved by every upsert. This table has no updated_at because that is what this column is — a cache of what a provider said, stamped with when it said it.';

-- ---------------------------------------------------------------------------
-- The soft alias validation (decision P6) — a warning, not a foreign key.
-- ---------------------------------------------------------------------------

-- Is this model in that connection's discovered catalog?
--
-- The predicate on its own, so that the rule can be asserted, read by a service, and
-- rendered by mockup 21's *discovery mismatch* state without any of them re-deriving it —
-- and so that the day it becomes enforcement, the thing that changes is the caller rather
-- than the rule.
--
--   connection — the provider connection the alias resolves on
--   model      — the raw provider model string the alias names
--   returns    — true when discovery has reported that model on that connection
create function ouroboros.provider_model_discovered(connection uuid, model text)
returns boolean
language sql
stable
as $$
  select exists (select 1
                   from ouroboros.provider_models pm
                  where pm.provider_connection_id = connection
                    and pm.model_id = model);
$$;

comment on function ouroboros.provider_model_discovered(uuid, text) is
  'Has discovery reported this model on this connection (#221, decision P6)? The predicate behind the model_aliases warning, exposed on its own so a service, mockup 21''s discovery-mismatch state and tests/constraints.sql all read one definition — and so that turning the warning into enforcement changes the caller rather than the rule.';

-- Warn when an alias names a model discovery has not reported — and write it anyway.
--
-- The header argues why this is a warning in MVP. What matters here is that it never
-- refuses: the trigger returns `new` on every path, so the only observable effect is the
-- message. The two branches are told apart because *nothing has been discovered on this
-- connection* is a gap and *this catalog does not list that model* is a mismatch.
create function ouroboros.warn_undiscovered_alias_model()
returns trigger
language plpgsql
as $$
begin
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
  'Raises a WARNING when a model_aliases row names a model discovery has not reported on its connection (#221, decision P6) — and writes the row regardless, because discovery is not yet universal and a hard reference would refuse configurations that are valid during the gap. Enforceable later by raising instead of warning, or by a validated foreign key, without moving anything else. Tells a gap (nothing discovered yet) apart from a mismatch (catalog lists other models).';

-- `of provider_connection_id, model_id` so that an update of `params` alone — the
-- inspector pinning a temperature — does not re-litigate a model that has not changed.
create trigger model_aliases_warn_undiscovered_model
  before insert or update of provider_connection_id, model_id
  on ouroboros.model_aliases
  for each row execute function ouroboros.warn_undiscovered_alias_model();
