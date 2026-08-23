-- V015__provider_connections_model_aliases.sql — `provider_connections` and
-- `model_aliases`: where a workspace's model providers are, and what its routes are
-- allowed to name.
--
-- **This is the shared foundation for mockups 07 and 21, and that is a decision rather
-- than an accident of ordering.** Roadmap decision **M2**
-- (docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md): mockup 07 (*Providers & keys*,
-- docs/ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md) owns the management UI for the first table and
-- mockup 21 (*Model registry*, docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md) owns the
-- management UI for the second. Neither has landed, and routing cannot be built without
-- the rows underneath both. So the *schema* lands here, with its constraints and the
-- minimal internal accessors `ouroboros-rest` needs to resolve an alias — and **no CRUD
-- surface**, because a create/update/delete API written here would be the thing those two
-- roadmaps then had to negotiate with rather than write.
--
-- The next roadmap to touch these tables is therefore inheriting them, not finding them.
-- What it inherits is: the vocabularies below are CHECK-constrained and widening one is an
-- ordinary migration; `credentials_encrypted` is envelope-only and cannot hold a plaintext
-- key; `health` is empty until something measured it; and an alias may not be pointed at
-- another workspace's connection. Everything else — display order, discovery, key rotation
-- UI, per-alias capability flags — is unclaimed.
--
-- Mockup 06 (docs/mockups/06-model-routing.html) is what reads them today:
--
--   * the `.phealth` strip — `Anthropic ● 42ms`, `GitHub Copilot ⚠ degraded · elevated
--     latency`, `OpenAI-compatible ● vLLM local`, `Ollama ● workstation · 3 models` — is
--     one row of `provider_connections` per pill,
--   * every alias pill in the matrix and the inspector — `coder-max`, `coder-fallback`,
--     `local-docs` — with its resolution line `claude-fable-5 · Anthropic`, is one row of
--     `model_aliases` joined to the connection it names.
--
-- Filed as issue #189 (Y.1). Blocks Y.2 (#190), Z.2 (#195) and Z.3 (#196).
--
-- ---------------------------------------------------------------------------
-- Decision M1 — `model_aliases.model_id` is the only column in this schema where a raw
-- provider model string may live.
-- ---------------------------------------------------------------------------
--
-- The inspector's footnote states the contract to the user: *"Aliases resolve in the Model
-- registry — routes never name raw models."* Everything downstream of this migration —
-- Y.2's `routes` and `route_hops`, Y.3's escalation rules, the DSL's `route.task(...)` —
-- names an **alias**, and the alias is the only thing that knows what `claude-fable-5`
-- is.
--
-- That indirection is not tidiness. Swapping `coder-max` from one model to another is one
-- edit of one row *because* nothing else in the system spells the model out; without it,
-- the same swap is a search-and-replace across every routing table, and the first place it
-- is missed is a route that quietly keeps using the old model. So the rule is stated here,
-- at the only place a raw id exists, and the tables that would break it are the ones this
-- migration blocks.
--
-- Nothing in this file can *enforce* M1 — a later migration is free to add a `model` text
-- column somewhere else. What it can do is make the correct thing available and say so at
-- the top of the file, which is why this paragraph is here rather than in a roadmap only.
--
-- ---------------------------------------------------------------------------
-- Decision M8 — `unknown` is a state, and `health` is empty until something measured it.
-- ---------------------------------------------------------------------------
--
-- `status` defaults to `unknown` and `health` defaults to `{}`. A connection that has just
-- been created has not been checked, and the honest rendering of that is the mockup's
-- unknown pill rather than a green dot the product has no evidence for.
--
-- The rule that keeps it honest is `provider_connections_health_measured`: a non-empty
-- `health` requires `last_checked_at`. A measurement is a measurement *at a time*, and the
-- failure this prevents is the one that looks like a feature — a `{"latency_ms": 0}`
-- default that renders `0ms` on a provider nothing has ever called. `0ms` is not
-- "unknown", it is a very good latency, and a strip that reports one for an unreachable
-- provider is worse than a blank.
--
-- `provider_connections_health_latency` is the second half: if `latency_ms` is present it
-- must be a JSON **number** and not negative. A string `"42ms"` and an explicit JSON
-- `null` are both refused — the first because the renderer would have to guess at a unit,
-- the second because an explicit null is an absence somebody wrote down, and the way to
-- say *nothing was measured* is to leave the key out.
--
-- What is deliberately **not** constrained is `status` against `last_checked_at`. The four
-- words mix two kinds of statement: `paused` is an operator's intent and needs no
-- measurement, while `active` and `error` are usually conclusions from one. A CHECK that
-- required a check timestamp for `active` would be a rule about Z.3's (#196) polling
-- policy written into the schema before Z.3 exists, and Z.3 is what owns the transitions.
--
-- ---------------------------------------------------------------------------
-- Decision — `credentials_encrypted` is `text`, not `bytea`, and is envelope-only.
-- ---------------------------------------------------------------------------
--
-- The ticket's ER diagram draws it as `bytea`. It is `text` here, because the AES-GCM
-- helper this reuses — AD.1 (#222), `ouroboros-rest/src/modules/vault/` — does not produce
-- bytes. `VaultService.encryptText` returns the five-field envelope string
-- `ouro.v1.<key version>.<base64url nonce>.<base64url ciphertext‖tag>`, and the key
-- version in the middle field is what makes rotation additive: a value sealed under
-- version 3 stays readable after version 4 becomes active because the value itself says
-- which key opened it. A `bytea` column would mean decoding that framing on write and
-- re-encoding it on read — a second encoding of a value nothing reads as bytes, and a
-- second place the version could be lost.
--
-- `tenant_keys.sealed_dek` is `bytea` and stays so, which is the same decision seen from
-- the other side: that column holds the raw output of a `KeyWrapper` whose framing is the
-- wrapper's and changes with it (V013's header argues why its length is unconstrained).
-- This column holds *this* module's framing, which is text by construction.
--
-- **`provider_connections_credentials_sealed` is the part that matters.** It refuses any
-- value that is not one of those envelopes, so a plaintext `sk-ant-…` pasted into this
-- column by a migration, a fixture or a hand-written `update` is rejected by the server
-- rather than stored. That is a stronger guarantee than "the service always encrypts": the
-- service is one writer, and this is every writer. It also means the vault's *adoption*
-- path — seal a value that was never sealed — has nothing to do here, because a row
-- holding an unsealed secret cannot exist.
--
-- Nullable, and legitimately so: an Ollama daemon on the same box and an operator's own
-- vLLM are both reached with no credential at all. That is the same fact
-- `ouroboros-rest`'s `LOCAL_PROVIDER_KINDS` states from the lease side (AD.3, #224) — the
-- kinds worth handing an address to are exactly the ones where the address is not a
-- secret.
--
-- ---------------------------------------------------------------------------
-- Decision — the alias's foreign key is composite, and that is what makes the tenancy
-- rule declarative.
-- ---------------------------------------------------------------------------
--
-- `model_aliases` carries `organization_id` (its own workspace) and
-- `provider_connection_id` (a connection). Nothing about two independent columns makes
-- them agree, and a row naming one workspace and another's connection is not a broken join
-- — it is a tenancy leak that resolves one workspace's alias onto another workspace's
-- **credential**.
--
-- V008–V010 and V014 meet this shape and answer it with a trigger
-- (`ouroboros.repo_in_organization()`), for a reason V008's header states: `github_repos`
-- has no unique key on `(organization_id, id)`, so the composite foreign key that would
-- express the rule cannot be written. Here it can — this migration creates both tables, so
-- `provider_connections_organization_id_key` is declared for exactly this purpose and
-- `model_aliases_provider_fk` references it.
--
-- A composite foreign key is strictly better than the trigger where it is available: it is
-- checked by the same machinery as every other referential rule, it needs no plpgsql, and
-- it carries the `on delete restrict` the next section is about rather than needing a
-- second mechanism beside it.
--
-- ---------------------------------------------------------------------------
-- Decision — `on delete restrict`, and why it does not block deleting a workspace.
-- ---------------------------------------------------------------------------
--
-- Deleting a connection that aliases still name must fail. The alternative is a cascade,
-- and a cascade here deletes *aliases* — which are the things Y.2's routes point at, so a
-- provider removed in mockup 07 would silently empty routes drawn in mockup 06. `restrict`
-- turns that into a refusal the person deleting can see and act on, which is what the
-- ticket's *"routes must never dangle"* asks for.
--
-- The interaction worth writing down, because it looks like a bug and is not: **deleting
-- an organization still works.** Both tables cascade from `organization`, and `restrict`
-- is checked immediately, so the obvious fear is that the connection cascade fires first,
-- meets aliases that have not been deleted yet, and refuses. It does not. Both cascades
-- are queued as after-triggers of the *same* statement and are processed before the
-- referential check that the connection delete appends, so the aliases are gone by the
-- time it runs. `tests/constraints.sql` asserts this directly rather than leaving it as a
-- claim, because it is a property of ordering that a future reader would reasonably doubt.
--
-- ---------------------------------------------------------------------------
-- Resolution is one indexed query.
-- ---------------------------------------------------------------------------
--
-- *Alias → provider + model* is the hot read: every route hop, every simulation, every
-- swap menu goes through it. It is
--
--   select a.model_id, a.params, c.kind, c.base_url, c.status
--     from ouroboros.model_aliases a
--     join ouroboros.provider_connections c
--       on c.organization_id = a.organization_id and c.id = a.provider_connection_id
--    where a.organization_id = $1 and a.alias = $2;
--
-- and it is two index lookups and no scan: `model_aliases_organization_alias_key` finds
-- the alias, `provider_connections_organization_id_key` finds the connection. Both indexes
-- exist for a rule rather than for the plan — uniqueness per workspace, and the composite
-- foreign key's target — which is the arrangement worth having: the fast path is the one
-- the constraints already paid for. `tests/constraints.sql` asserts both under `EXPLAIN`.
--
-- ---------------------------------------------------------------------------
-- House snake_case throughout — decision **A4**. `organization` is referenced by its
-- quoted camelCase `"id"`, because that is BetterAuth's column (V005).
--
-- No seed rows. Y.4 (#192) is what fills these tables with mockup-06 parity data, in a
-- development database and nowhere else.

-- ---------------------------------------------------------------------------
-- provider_connections
-- ---------------------------------------------------------------------------
create table ouroboros.provider_connections (
  -- Surrogate key. `model_aliases` references it, and mockup 07's routes will address a
  -- connection by it, so it is a uuid rather than a serial for V001's reason: an id that
  -- appears in a URL should not also be a count of how many exist.
  id                    uuid        primary key default gen_random_uuid(),

  -- The workspace this connection belongs to.
  --
  -- **Cascade.** A connection is configuration, not history: when the workspace goes, the
  -- address and the sealed credential go with it. The credential is unreadable anyway once
  -- V013's cascade has destroyed that workspace's DEK, so keeping the row would leave a
  -- ciphertext nothing can open attached to a workspace nothing can reach.
  organization_id       text        not null
                                    references ouroboros.organization ("id") on delete cascade,

  -- Which adapter reaches this provider — the vocabulary AC.1's adapter registry keys on,
  -- and the same spellings `model_prices.match_provider_kind` (V012) carries.
  --
  -- Text with a CHECK rather than an enum, per the house rule: adding a sixth vendor is an
  -- ordinary migration, where adding an enum value is a migration that cannot be run
  -- inside a transaction with everything else.
  --
  -- `custom` is the escape hatch and is deliberately last: it means *an OpenAI-shaped
  -- endpoint this product has no adapter opinion about*, and a deployment that needs one
  -- should not have to wait for a migration.
  kind                  text        not null,

  -- What the `.phealth` strip prints — `Anthropic`, `GitHub Copilot`, `Ollama`. Free text,
  -- because it names a thing in the operator's head (*"workstation"*, *"vLLM local"*) and
  -- not a thing in this schema.
  --
  -- Not unique: two Ollama daemons on two machines are two legitimate rows, and a
  -- uniqueness rule here would be a naming policy invented by a migration rather than by
  -- the surface (mockup 07) that will ask people for these names.
  display_name          text        not null,

  -- Where this provider is, for the kinds where that is a question.
  --
  -- Required for `ollama` and `openai_compatible` and optional for the rest, which is the
  -- distinction `ouroboros-rest`'s `LOCAL_PROVIDER_KINDS` (AD.3, #224) draws from the
  -- other side: those two kinds have no public endpoint to fall back on, so a row without
  -- an address is a connection nothing can reach. The cloud kinds have one and may still
  -- carry a base URL — a corporate proxy, a regional endpoint — which is why the rule is
  -- an implication and not a biconditional.
  --
  -- `http`/`https` only, and RFC-1918 addresses are deliberately **allowed**: refusing
  -- private ranges would refuse the vLLM and the Ollama this column exists to reach. See
  -- docs/SECURITY_MODEL.md § SSRF, which enumerates what is enforced instead.
  base_url              text,

  -- The provider's credential, sealed — **never a key in the clear**.
  --
  -- An `ouro.v1.…` envelope from AD.1's vault, and the CHECK below refuses anything else,
  -- so this column cannot hold a plaintext even by accident. Null where the provider needs
  -- none, which is the ordinary state of a local one. See this file's header.
  --
  -- The `recordId` the envelope is bound to is this row's `id`, which is what stops a
  -- ciphertext being moved from one connection to another inside the same workspace.
  credentials_encrypted text,

  -- Whether this connection is usable, as far as anything knows.
  --
  --   `active`   — reachable and configured.
  --   `paused`   — an operator switched it off. Intent, not a measurement.
  --   `error`    — the last check failed. `health` says how.
  --   `unknown`  — nothing has checked. **The default, and a real state** (decision M8).
  --
  -- `unknown` is what a connection is until Z.3 (#196) looks at it, and rendering it as
  -- such is the whole of the honesty rule: the alternative is a green dot the product has
  -- no evidence for.
  status                text        not null default 'unknown',

  -- When the last health check finished. Null until one has.
  --
  -- The *check's* clock, not the row's: a check that found nothing changed still moves it,
  -- because "we looked and it was fine" is what a freshness tag claims.
  last_checked_at       timestamptz,

  -- What that check measured — `{"latency_ms": 42}`, `{"detail": "elevated latency"}`,
  -- `{"models": 3}` for the Ollama pill's *"3 models"*.
  --
  -- **Empty means nothing was measured, and the CHECKs below keep it that way.** jsonb
  -- rather than columns because the shape genuinely differs per kind — a latency belongs
  -- to a cloud provider, a model count to a local daemon — and inventing a wide nullable
  -- row now would fix a vocabulary Z.3 has not written yet. What is *not* deferred is the
  -- honesty: `latency_ms` must be a number, and any content at all requires a
  -- `last_checked_at` to have produced it.
  health                jsonb       not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),

  -- Moved by the V001 trigger rather than by the writer, as everywhere else in this schema.
  updated_at            timestamptz not null default now(),

  -- The target of `model_aliases_provider_fk`, and the reason that foreign key can be
  -- composite. Redundant as a uniqueness claim — `id` is already the primary key — and not
  -- redundant as a *declaration*: a composite foreign key needs a unique constraint on
  -- exactly the referenced pair, and without this one the tenancy rule below would have to
  -- be a trigger. See the header.
  constraint provider_connections_organization_id_key unique (organization_id, id),

  constraint provider_connections_kind
    check (kind in ('anthropic', 'openai_compatible', 'ollama', 'copilot', 'cursor', 'custom')),

  constraint provider_connections_status
    check (status in ('active', 'paused', 'error', 'unknown')),

  constraint provider_connections_display_name_present
    check (btrim(display_name) <> '' and length(display_name) <= 120),

  -- Present, bounded, and one of two schemes. A blank string is the value a form submits
  -- when it meant to submit nothing, and it would read as "configured" everywhere.
  constraint provider_connections_base_url_present
    check (base_url is null
           or (btrim(base_url) = base_url
               and base_url ~ '^https?://[^[:space:]]+$'
               and length(base_url) <= 2048)),

  -- The two kinds with no public endpoint to fall back on. See the column.
  constraint provider_connections_local_has_base_url
    check (kind not in ('ollama', 'openai_compatible') or base_url is not null),

  -- **Envelope-only.** The header argues why this is the guarantee rather than "the
  -- service always encrypts": the service is one writer and this is every writer.
  constraint provider_connections_credentials_sealed
    check (credentials_encrypted is null
           or credentials_encrypted ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  constraint provider_connections_health_object
    check (jsonb_typeof(health) = 'object'),

  -- A measurement happened at a time (decision M8). The other direction is legitimate: a
  -- check that failed to connect stamps `last_checked_at`, sets `status = 'error'` and has
  -- no latency to report.
  constraint provider_connections_health_measured
    check (health = '{}'::jsonb or last_checked_at is not null),

  -- If a latency is reported it is a JSON number and it is not negative. `CASE` rather than
  -- `and`/`or` so the cast is only reached once `jsonb_typeof` has said it is safe —
  -- PostgreSQL does not promise the evaluation order of a boolean operator, and it does
  -- promise `CASE`'s. A JSON `null` falls to the `else` and is refused: the way to say
  -- nothing was measured is to leave the key out.
  constraint provider_connections_health_latency
    check (case jsonb_typeof(health -> 'latency_ms')
             when 'number' then (health -> 'latency_ms')::numeric >= 0
             else health -> 'latency_ms' is null
           end)
);

comment on table ouroboros.provider_connections is
  'Where a workspace''s model providers are, and the sealed credential for the ones that need one (#189, decision M2). The shared foundation mockup 07 (Providers & keys) builds its management UI on — this migration lands the schema and the resolution accessors only, deliberately no CRUD. Read by mockup 06''s .phealth strip and by every alias resolution. Never holds a credential in the clear: credentials_encrypted is envelope-only by CHECK.';
comment on column ouroboros.provider_connections.organization_id is
  'The workspace. ON DELETE CASCADE — a connection is configuration, and its sealed credential is unreadable anyway once V013''s cascade has destroyed that workspace''s DEK.';
comment on column ouroboros.provider_connections.kind is
  'Which adapter reaches this provider — AC.1''s registry keys, and the same spellings model_prices.match_provider_kind carries. Text with a CHECK rather than an enum so a sixth vendor is an ordinary migration. custom means an endpoint this product has no adapter opinion about.';
comment on column ouroboros.provider_connections.display_name is
  'What the .phealth strip prints. Free text and deliberately not unique: two Ollama daemons on two machines are two legitimate rows, and a naming policy belongs to the surface that asks for the name (mockup 07), not to this migration.';
comment on column ouroboros.provider_connections.base_url is
  'Where this provider is. Required for ollama and openai_compatible, which have no public endpoint to fall back on; optional elsewhere, where a proxy or a regional endpoint is a legitimate reason to set one. http/https only; RFC-1918 is deliberately allowed — see docs/SECURITY_MODEL.md § SSRF.';
comment on column ouroboros.provider_connections.credentials_encrypted is
  'The provider credential, sealed by AD.1''s vault (#222) as an ouro.v1.<version>.<nonce>.<ciphertext> envelope bound to this row''s id. Never a key in the clear — provider_connections_credentials_sealed refuses any other shape, so a plaintext cannot be stored by any writer. Null where the provider needs none, which is the ordinary state of a local one.';
comment on column ouroboros.provider_connections.status is
  'active | paused | error | unknown. unknown is the default and a real state (decision M8), not a placeholder: it is what a connection is until Z.3 (#196) has checked it, and rendering it honestly is the alternative to a green dot with no evidence behind it. paused is operator intent rather than a measurement, which is why no CHECK ties status to last_checked_at.';
comment on column ouroboros.provider_connections.last_checked_at is
  'When the last health check finished; null until one has. The check''s clock rather than the row''s — a check that found nothing changed still moves it.';
comment on column ouroboros.provider_connections.health is
  'What the last check measured — latency_ms, detail, a local daemon''s model count. Empty means nothing was measured, and two CHECKs keep that true: any content requires a last_checked_at, and latency_ms must be a non-negative JSON number. There is deliberately no default 0ms, which would render a very good latency for a provider nothing has ever called (decision M8).';

-- ---------------------------------------------------------------------------
-- model_aliases
-- ---------------------------------------------------------------------------
create table ouroboros.model_aliases (
  id                     uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade for the same reason the connection's does — an alias is
  -- configuration, and the routes that named it are going with it.
  organization_id        text        not null
                                     references ouroboros.organization ("id") on delete cascade,

  -- The name routes use: `coder-max`, `coder-std`, `sizer`, `coder-fallback`,
  -- `local-docs`, `local-free`. Unique per workspace.
  --
  -- **Constrained to lower-case kebab, and that is a correctness rule rather than a style
  -- one.** Uniqueness is enforced on the stored text, so `coder-max` and `Coder-Max` are
  -- two rows — two aliases that a person reading the inspector would call the same name,
  -- resolving to two different models. Folding the shape at the boundary is what makes
  -- "unique per organization" mean what a user reads it to mean. It also keeps an alias
  -- safe in the places it is about to appear: a URL segment, a DSL identifier in
  -- `route.task(...)`, a CLI argument.
  alias                  text        not null,

  -- The connection this alias resolves on. Half of the composite foreign key below.
  provider_connection_id uuid        not null,

  -- **The raw provider model string, and the only place in this schema one may live**
  -- (decision M1) — `claude-fable-5`, `gpt-4o-mini`, `llama-4-maverick`.
  --
  -- Unfolded, because a model id is the vendor's and vendors disagree about case. Not
  -- checked against `model_prices`: a model this product has no price for is a model that
  -- renders `—` in the registry, not a model that cannot be routed to.
  model_id               text        not null,

  -- Per-alias invocation defaults — the inspector's *"(max thinking)"* rides here, as does
  -- a temperature the workspace wants pinned.
  --
  -- jsonb rather than columns for the same reason `health` is: the keys that matter differ
  -- per vendor, and a thinking budget is not a concept every provider has. Constrained to
  -- an object so a caller merging it into a request body has something to merge.
  params                 jsonb       not null default '{}'::jsonb,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- The ticket's first acceptance criterion, and the index resolution enters through.
  constraint model_aliases_organization_alias_key unique (organization_id, alias),

  -- Lower-case kebab, bounded. See the column for why the shape is a rule.
  constraint model_aliases_alias_shape
    check (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(alias) <= 64),

  constraint model_aliases_model_id_present
    check (btrim(model_id) = model_id and model_id <> '' and length(model_id) <= 200),

  constraint model_aliases_params_object
    check (jsonb_typeof(params) = 'object'),

  -- **Composite, and `restrict`.** The pair is what holds the alias and its connection to
  -- the same workspace — see the header on why this is a foreign key here where V008–V014
  -- needed a trigger — and `restrict` is what stops a connection being deleted out from
  -- under the routes that reached it through this alias. Deleting the workspace itself
  -- still works; the header explains why, and tests/constraints.sql asserts it.
  constraint model_aliases_provider_fk
    foreign key (organization_id, provider_connection_id)
    references ouroboros.provider_connections (organization_id, id)
    on delete restrict
);

comment on table ouroboros.model_aliases is
  'The names a workspace''s routes may use, and what each resolves to (#189, decisions M1 and M2). The shared foundation mockup 21 (Model registry) builds its management UI on — this migration lands the schema and the resolution accessors only, deliberately no CRUD. model_id is the only column in this schema where a raw provider model string lives, which is what makes swapping a model one edit of one row rather than a search-and-replace across every routing table.';
comment on column ouroboros.model_aliases.organization_id is
  'The workspace. ON DELETE CASCADE, and held to the connection''s workspace by model_aliases_provider_fk rather than by a trigger — an alias pointing at another workspace''s connection would resolve onto that workspace''s credential.';
comment on column ouroboros.model_aliases.alias is
  'The name routes use — coder-max, sizer, local-docs. Unique per workspace. Lower-case kebab by CHECK, which is a correctness rule: uniqueness is enforced on the stored text, so admitting Coder-Max beside coder-max would give one name two resolutions.';
comment on column ouroboros.model_aliases.provider_connection_id is
  'The connection this alias resolves on. Half of model_aliases_provider_fk, whose other half is organization_id — which is what makes the tenancy rule declarative rather than a trigger.';
comment on column ouroboros.model_aliases.model_id is
  'The raw provider model string, and the ONLY place in this schema one may live (decision M1). Routes, hops, escalation rules and the DSL all name an alias instead. Unfolded — a model id is the vendor''s and vendors disagree about case. Not checked against model_prices: an unpriced model renders an em-dash, it is not unroutable.';
comment on column ouroboros.model_aliases.params is
  'Per-alias invocation defaults — the inspector''s "(max thinking)", a pinned temperature. jsonb because the keys that matter differ per vendor; constrained to an object so a caller has something to merge into a request body.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- Resolution — the hot read, and the ticket's acceptance criterion — needs no index of its
-- own. `model_aliases_organization_alias_key` finds the alias and
-- `provider_connections_organization_id_key` finds its connection, and both of those exist
-- because a *rule* needed them: uniqueness per workspace, and the composite foreign key's
-- target. tests/constraints.sql asserts the plan uses both.
--
-- Listing a workspace's connections for the `.phealth` strip enters through the same
-- `(organization_id, id)` index on its leading column, so it needs nothing either.
--
-- One index is added, and it earns its place twice.
-- ---------------------------------------------------------------------------

-- The referencing side of `model_aliases_provider_fk`.
--
-- PostgreSQL indexes the *referenced* side of a foreign key automatically and the
-- referencing side never. Without this, every delete of a connection — and every delete of
-- a workspace, which cascades into one — scans `model_aliases` end to end to decide whether
-- the `restrict` fires.
--
-- It is also the read mockup 07 needs before it can offer that delete at all: *which
-- aliases depend on this connection*, which is the list a designed refusal has to name.
create index model_aliases_provider_idx
  on ouroboros.model_aliases (organization_id, provider_connection_id);

comment on index ouroboros.model_aliases_provider_idx is
  'The referencing side of model_aliases_provider_fk (#189), which PostgreSQL does not create: without it every connection delete scans this table to decide whether the restrict fires. Also the "which aliases depend on this connection" read that mockup 07''s delete confirmation is built from.';

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger provider_connections_touch_updated_at
  before update on ouroboros.provider_connections
  for each row execute function ouroboros.touch_updated_at();

create trigger model_aliases_touch_updated_at
  before update on ouroboros.model_aliases
  for each row execute function ouroboros.touch_updated_at();
