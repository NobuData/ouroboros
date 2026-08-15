-- V012__model_prices.sql — `model_prices`, the pricing catalog the registry's
-- `$ per 1M in·out` column is rendered from, and the two functions that fill it and read it.
--
-- The first table of the model registry (docs/mockups/21-model-registry.html), and the
-- one surface of it that is a claim about money. Seven of the mockup's eight rows carry
-- something in that column, and only three of them are a per-token price:
--
--   claude-fable-5   $10 · $50      claude-sonnet-5  $2 · $10       claude-haiku-4-5  $1 · $5
--   gpt-5-codex      seat-based     composer-2       usage-based
--   qwen3-coder:32b  $0             llama-4-maverick $0             gpt-5.2-preview   —
--
-- Four shapes, and three of them are not per-token rates at all. A schema with only an
-- input rate and an output rate would force the other three to lie or to blank, so
-- `billing_mode` is a column here and the CHECKs below make the four shapes structural
-- rather than conventional: a `seat` row *cannot* carry a per-token amount, and a `token`
-- row *cannot* be missing one.
--
-- ---------------------------------------------------------------------------
-- **Decision R4 — a vendored, versioned snapshot with org overrides.**
--
-- The three alternatives are each rejected for a reason that outlives this migration:
--
--   * **Typing the numbers in.** Nobody hand-maintains a hundred-model price list, so the
--     column would ship and then render `—` for everything real.
--
--   * **Fabricating them.** The honesty rules this product is built on (M7, P8, and
--     DASH-J.4's `cost_cents is null means UNPRICED`) forbid presenting an invented figure
--     as current pricing, and a price is exactly the number a user acts on.
--
--   * **A live catalog API on the render path.** An air-gapped deployment would lose the
--     column entirely, and a third-party outage would degrade a page that has nothing to
--     do with that third party. This module reaches no network, at migration time or ever.
--
-- So the catalog is **data in the repository**: a pruned extract of LiteLLM's
-- `model_prices_and_context_window.json` (MIT), pinned to one upstream commit, vendored
-- under `ouroboros-db/catalog/`, transformed by `scripts/price-catalog.mjs` into
-- `R__model_price_catalog.sql` — which is nothing but a call to
-- `ouroboros.import_model_price_catalog()` below with the rows as jsonb. The pinned
-- commit, its date, the licence and the transform are recorded in three places that a
-- reviewer can compare: the extract's `provenance` block, the generated migration's
-- header, and `catalog_version` on every row this schema stores.
--
-- What a deployment gets is therefore a catalog that is *old and honest* rather than
-- *live and fragile*, and one row of it can always be corrected in place by the
-- organization it is wrong for. That is what `organization_id` is: null means the bundled
-- snapshot said so, set means this workspace said so, and an override always wins.
--
-- ---------------------------------------------------------------------------
-- **Unknown means absent.** No row is created for a model the catalog does not cover, and
-- nothing in this file defaults an amount to zero. `—` and `$0` are different claims —
-- the first says *we do not know what this costs*, the second says *this costs nothing* —
-- and the read path can only tell them apart if the schema refuses to blur them. Hence:
--
--   * no `default 0` on either amount column;
--   * `ouroboros.model_price()` returns **zero rows** for an uncovered model rather than a
--     zeroed one;
--   * a `token` row whose two amounts are both zero is rejected (see
--     `model_prices_token_amounts_meaningful`) — that row is a `free` row wearing the
--     wrong mode, and it would render `$0` for a model somebody is being invoiced for;
--   * and the transform drops any upstream entry with a missing or zero cost rather than
--     importing it as free. A hosted model that costs nothing is not a thing this catalog
--     is willing to assert on a vendor's behalf.
--
-- ---------------------------------------------------------------------------
-- **Three places where this file is narrower than issue #580 asked, each on purpose.**
--
-- 1. **`numeric(14, 4)` for the amounts, not `integer`.** The issue's diagram annotates
--    both amounts `int`. Integer cents per 1M tokens is a coarser unit than it looks:
--    it renders every rate below one cent per million as `0`, which is precisely the
--    `$0`-that-means-unknown this whole ticket exists to prevent, and it would do it
--    silently inside the transform where no CHECK could see it. Every rate in the pinned
--    snapshot happens to land on a whole cent per 1M, so today the two types would store
--    the same numbers; the type is chosen for the snapshot that does not. It is also the
--    type DASH-F.3 already chose for `token_usage.cost_cents` (V010), for the same reason
--    and so the two can be arithmetic on each other without a cast that rounds.
--
-- 2. **The glob is `*` and nothing else.** The issue asks for "a documented glob for
--    family rows", and this is the documentation: `match_model = '*'` matches every model
--    of its kind, `match_provider_kind = '*'` matches every kind, and no other wildcard
--    exists — a `*` anywhere inside either value is rejected. Prefix globs were considered
--    and dropped twice over: `model like match_model` cannot use an index, so the lookup
--    below would stop being one indexed query, and two overlapping prefixes would need a
--    specificity rule that no reader could predict from the row. The family rows actually
--    needed are whole-kind rows (`copilot`, `cursor`, `ollama` below), and a whole-kind
--    row is an exact `'*'` lookup, which is why the precedence order at the foot of this
--    file is three booleans rather than a pattern-length tie-break.
--
-- 3. **No bundled `free` row for `openai_compatible`.** The issue lists "Ollama and
--    OpenAI-compatible local kinds `free`", and the mockup's `llama-4-maverick` — served
--    by a vLLM behind the OpenAI-compatible adapter — renders `$0`. Ollama is here:
--    that adapter talks to a local daemon, so *every* model reached through it is local by
--    construction and `('ollama', '*') → free` is a statement about the kind. The
--    OpenAI-compatible kind is not: the same adapter fronts a vLLM on somebody's own GPU
--    **and** `api.openai.com`, and nothing at the level of a provider *kind* can tell them
--    apart. A bundled `('openai_compatible', '*') → free` row would therefore price every
--    uncovered OpenAI model at `$0` — the exact lie above, shipped in the catalog rather
--    than reached by accident. Local-ness is a property of the connection, not of the
--    kind, so a workspace running a local endpoint says so once, in a row of its own:
--
--      insert into ouroboros.model_prices
--        (organization_id, match_provider_kind, match_model, billing_mode, source)
--      values ('org-acme', 'openai_compatible', '*', 'free', 'override');
--
--    which is what CG.4's (#582) registry seed inserts to reproduce the mockup's `$0`, and
--    what CH.3 (#586) surfaces as a settable row rather than a hard-coded branch. Until
--    somebody says it, such a model reads `—`, which is true.
--
-- ---------------------------------------------------------------------------
-- **No vocabulary on `match_provider_kind`** — decision F8, as on `token_usage.provider`
-- (V010) and `runs.provider` (V008). The kinds are AC.1's (#216) registry keys —
-- `anthropic`, `openai_compatible`, `ollama`, `copilot`, `cursor`, and `custom` beside them
-- in mockup 06 — and that list is owned by the adapter registry in `ouroboros-rest`, which
-- has not landed and will grow. A CHECK enumerating it here would be this table inventing
-- a catalog it does not own, and its failure mode is a price row refused for a provider
-- the product really supports. Shape is enforced, spelling is folded, vocabulary is not.
-- `billing_mode` and `source` *are* enumerated, because both are this table's own closed
-- vocabulary: every one of the four modes has a rule in this file, and a fifth would have
-- to be given one.
--
-- House snake_case throughout — decision A4. `organization` is referenced by its quoted
-- camelCase `"id"` because that is BetterAuth's column; everything this file creates is
-- ours.
--
-- Filed as issue #580 (CG.2).

-- ---------------------------------------------------------------------------
-- model_prices
-- ---------------------------------------------------------------------------
create table ouroboros.model_prices (
  id                  uuid          primary key default gen_random_uuid(),

  -- Whose statement this is, and the whole of the bundled/override distinction:
  --
  --   null  — the bundled catalog said so. Applies to every workspace, and is replaced
  --           wholesale by the next snapshot.
  --   set   — *this* workspace said so. Survives every re-import untouched, and wins.
  --
  -- Cascade, as everywhere in this schema: an override for a workspace that no longer
  -- exists is unreachable, and leaving it would let a later workspace that reused the id
  -- inherit somebody else's negotiated rate — a wrong number on an invoice, arrived at by
  -- a deletion nobody connected to pricing.
  organization_id     text          references ouroboros.organization ("id") on delete cascade,

  -- What this row prices. `match_` because these are the two halves of a lookup key, not
  -- a description of a model: `ouroboros.model_price()` is given a provider kind and a
  -- model identifier and finds the most specific row that matches both.
  --
  -- `'*'` in either position is the family wildcard, and the only wildcard there is — see
  -- the header, narrowing 2. `('copilot', '*')` is "every model reached through Copilot",
  -- which is the row that makes the seat-billed column cell true for a provider whose
  -- model list is not knowable in advance.
  match_provider_kind text          not null,
  match_model         text          not null,

  -- How the money works, which decides which of the four cells the read path renders and
  -- which amounts may be present at all:
  --
  --   token  — per-token rates. Both amounts required.        `$10 · $50`
  --   seat   — billed per person, not per call (Copilot).     `seat-based`
  --   usage  — metered by the vendor on terms this catalog
  --            cannot express (Cursor).                       `usage-based`
  --   free   — no per-call charge (a model running locally).  `$0`
  --
  -- `seat` and `usage` both mean "there is a price and it is not a function of tokens",
  -- and they are two modes rather than one because they are two different answers to the
  -- follow-up question — a seat count is knowable from the subscription, a usage bill is
  -- not knowable until it arrives — and #198's spend aggregation has to treat them
  -- differently.
  billing_mode        text          not null,

  -- The rates, per **one million** tokens, in cents. Null unless `billing_mode` is
  -- `token` or `free`; see the four amount CHECKs below, which make that structural.
  --
  -- Per 1M because that is the unit vendors publish and the unit the column renders, so
  -- storing it any other way would move a division into every reader. Cents because the
  -- rest of the schema counts money in cents (`token_usage.cost_cents`, V010). Four
  -- decimal places for the reason that column has them and the reason the header gives:
  -- a whole cent per million tokens is not a fine enough unit to hold every published
  -- rate, and rounding one down to zero is the one arithmetic error this table must not
  -- make.
  input_cents_per_1m  numeric(14, 4),
  output_cents_per_1m numeric(14, 4),

  -- Provenance, stamped on the row rather than inferred from `organization_id` being
  -- null. It is derivable — the CHECK below requires the two to agree — and it is stored
  -- anyway for three reasons: the re-import's sweep and upsert both key on it, so the
  -- statement that only bundled rows are touched is a `where` clause a reader can see
  -- rather than a null test they have to interpret; it is what the read path shows a user
  -- who asks where a number came from (CH.3, #586); and it is the column the unique key
  -- names, per issue #580.
  source              text          not null,

  -- Which snapshot this row came out of, and null on an override — an override is not a
  -- version of anything, it is a workspace's own statement. Required on bundled rows,
  -- because a bundled row with no version cannot be swept by the next import and would
  -- outlive the catalog it belongs to.
  --
  -- The grammar is `<snapshot date>+<upstream>.<short commit>` —
  -- `2026-08-15+litellm.70d51a1` — set by the transform from the pinned commit, never by
  -- hand. Compared only for equality, so the format is documentation rather than
  -- something anything parses.
  catalog_version     text,

  -- Everything the catalog knows that is not a price: context window, maximum output,
  -- the capability flags, and which upstream entry the row was transformed from. Kept
  -- because CH.2's (#585) discovery fallback needs exactly this when a provider's own
  -- model list is unavailable — a model registry that knows a price but not a context
  -- window would send it back to the same snapshot for the other half.
  --
  -- jsonb rather than columns, and this is the one place in the schema where that is the
  -- right way round: these fields are an upstream vendor's vocabulary, they change shape
  -- when upstream does, and nothing in this product branches on them. The moment
  -- something does, it earns a column and a migration — the same rule V011 states for
  -- settings, applied from the other side.
  meta                jsonb         not null default '{}'::jsonb,

  -- When these prices took effect, as far as the source knows. For a bundled row that is
  -- the snapshot's own timestamp — the upstream commit date — so every row of one import
  -- carries the same instant and re-importing the same snapshot does not move it. For an
  -- override it is when the workspace says its rate started.
  --
  -- **Not a history axis.** The unique key below permits exactly one row per
  -- (workspace, kind, model), so this table holds what is true now and cannot hold what
  -- was true last quarter; `ouroboros.model_price()` accordingly does *not* filter on it.
  -- Re-pricing a ledger against the rates of the day it was spent needs price history,
  -- which is a table this one does not pretend to be — #598 owns that question when the
  -- v2 refresh arrives, and this column is what it would key from.
  effective_at        timestamptz   not null default now(),

  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  -- --- one row per thing being priced ------------------------------------------------
  --
  -- **`nulls not distinct` is load-bearing, not decoration.** PostgreSQL's default is that
  -- two nulls are different values, so under the ordinary spelling of this constraint
  -- every bundled row — all of which have `organization_id is null` — would be unique
  -- against every other bundled row automatically, and a re-import would *add* a second
  -- `claude-fable-5` rather than update the first. The catalog would double in size on
  -- every snapshot bump and the lookup would start choosing between duplicates. It is
  -- also what makes `on conflict (organization_id, match_provider_kind, match_model,
  -- source)` in the import below infer this constraint at all.
  --
  -- `source` is in the key because #580 specifies it, and it is redundant given the
  -- coherence CHECK two constraints down: source is a function of `organization_id` being
  -- null. Redundant and harmless — it cannot separate two rows the first three columns
  -- already agreed on — and it says in the index what the CHECK says in prose.
  constraint model_prices_match_key
    unique nulls not distinct (organization_id, match_provider_kind, match_model, source),

  -- --- the vocabularies this table does own -------------------------------------------
  constraint model_prices_billing_mode
    check (billing_mode in ('token', 'seat', 'usage', 'free')),
  constraint model_prices_source
    check (source in ('bundled', 'override')),

  -- --- provenance is coherent -----------------------------------------------------------
  --
  -- The two halves of the same fact, required to agree in both directions. Without this a
  -- row could claim `source = 'bundled'` while naming a workspace — and the re-import's
  -- sweep, which deletes by `source`, would silently delete a workspace's override.
  constraint model_prices_source_matches_owner
    check ((source = 'bundled'  and organization_id is null)
        or (source = 'override' and organization_id is not null)),

  -- A bundled row must say which snapshot it came from; an override must not, because it
  -- did not come from one. See `catalog_version` above.
  constraint model_prices_catalog_version_for_bundled
    check ((source = 'bundled'  and catalog_version is not null
                                and btrim(catalog_version) <> ''
                                and length(catalog_version) <= 100)
        or (source = 'override' and catalog_version is null)),

  -- --- the amounts match the billing mode ----------------------------------------------
  --
  -- Four constraints rather than one `case`, so a rejection names which rule was broken
  -- rather than reporting that the row is wrong somehow. Together they are what makes the
  -- mockup's four cells structural: nothing can store a seat row with a rate on it, or a
  -- token row with half a rate, whatever the writer believes.

  -- A per-token price with one amount missing is not a price. It would render as half a
  -- cell and, worse, would total as if the missing half were free.
  constraint model_prices_token_requires_amounts
    check (billing_mode <> 'token'
           or (input_cents_per_1m is not null and output_cents_per_1m is not null)),

  -- And a per-token price of nothing in both directions is a `free` row that took the
  -- wrong mode — the `$0`-versus-`—` line, defended from the other side. One direction
  -- free is a real vendor arrangement and stays legal.
  constraint model_prices_token_amounts_meaningful
    check (billing_mode <> 'token'
           or input_cents_per_1m > 0 or output_cents_per_1m > 0),

  -- `free` is the claim that a call costs nothing, so its amounts are zero or absent.
  -- Both spellings are accepted because both are true and the import writes neither by
  -- hand: a locally served model has no rate at all, and a vendor publishing 0 is saying
  -- the same thing.
  constraint model_prices_free_amounts_zero
    check (billing_mode <> 'free'
           or (coalesce(input_cents_per_1m, 0) = 0 and coalesce(output_cents_per_1m, 0) = 0)),

  -- Seats and metered usage are not functions of tokens. A per-token amount on one of
  -- these rows is a number that would be multiplied by a token count and charged to
  -- somebody, and there is no reading of it that is true.
  constraint model_prices_metered_amounts_absent
    check (billing_mode not in ('seat', 'usage')
           or (input_cents_per_1m is null and output_cents_per_1m is null)),

  -- A negative rate is a parse error in whatever produced it, and it would subtract from
  -- a total silently. The same rule, and the same reason, as `token_usage.cost_cents`.
  constraint model_prices_amounts_nonnegative
    check (coalesce(input_cents_per_1m, 0) >= 0 and coalesce(output_cents_per_1m, 0) >= 0),

  -- --- the lookup key is a lookup key ---------------------------------------------------
  --
  -- `'*'` or a folded provider kind — the same character class `token_usage.provider`
  -- uses (V010), and folded for the same reason: `Anthropic` and `anthropic` are one kind,
  -- and a lookup that missed because of a capital would render `—` for a priced model.
  -- Vocabulary is deliberately absent; see the header.
  constraint model_prices_match_provider_kind_format
    check (match_provider_kind = '*'
           or (match_provider_kind ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
               and length(match_provider_kind) <= 64)),

  -- `'*'` or an exact model identifier — bounded, non-blank, and carrying no `*` of its
  -- own, which is what keeps "the glob is `*` and nothing else" a rule rather than a
  -- convention. Not folded, unlike the kind: a model identifier is a name the vendor
  -- chose, some of them carry capitals, and `token_usage.model` and `runs.model` store
  -- them unfolded too — the same fact in three tables must fit all three.
  constraint model_prices_match_model_format
    check (match_model = '*'
           or (btrim(match_model) <> '' and length(match_model) <= 200
               and position('*' in match_model) = 0)),

  -- The enrichment #585 reads is an object or it is nothing. `jsonb` alone would accept a
  -- bare string or an array, and `meta -> 'context_tokens'` on either is null rather than
  -- an error — a reader would see a model with no context window instead of a row that is
  -- the wrong shape.
  constraint model_prices_meta_is_object
    check (jsonb_typeof(meta) = 'object')
);

comment on table ouroboros.model_prices is
  'Model pricing catalog (#580) — the truth source behind mockup 21''s "$ per 1M in·out" column, and the shared price table DASH-J.4/#92, Z.5/#198 and AB.4/#210 read rather than re-invent. Bundled rows (organization_id null) come from a vendored, version-stamped snapshot; org rows override them. Decision R4: vendored and honest beats live and fragile. No row means the price is unknown, which renders "—" and never "$0".';
comment on column ouroboros.model_prices.organization_id is
  'Null for a bundled catalog row, set for a workspace''s own override. An override always wins, and no re-import ever touches one.';
comment on column ouroboros.model_prices.match_provider_kind is
  'AC.1 provider kind (anthropic | openai_compatible | ollama | copilot | cursor | …) or ''*'' for every kind. Folded lower-case; deliberately not enumerated — the kinds are the adapter registry''s vocabulary, not this table''s.';
comment on column ouroboros.model_prices.match_model is
  'Exact model identifier, or ''*'' for every model of the kind — the family row a seat- or usage-billed provider is priced by. ''*'' is the only wildcard; a literal ''*'' inside an identifier is rejected.';
comment on column ouroboros.model_prices.billing_mode is
  'token | seat | usage | free — which of mockup 21''s four cells this row renders, and which amounts it may carry. The four amount CHECKs make that structural rather than conventional.';
comment on column ouroboros.model_prices.input_cents_per_1m is
  'Input rate in cents per one million tokens. Required iff billing_mode is token; zero or null iff free; never present on seat or usage. numeric(14,4), like token_usage.cost_cents — whole cents per 1M would round the cheapest models to a "$0" that means "unknown".';
comment on column ouroboros.model_prices.output_cents_per_1m is
  'Output rate in cents per one million tokens. Same rules as input_cents_per_1m, and kept separate because every vendor prices the two differently.';
comment on column ouroboros.model_prices.source is
  'bundled | override — where this row came from, stamped rather than inferred. The re-import upserts and sweeps by it, so "overrides are never touched" is a where clause rather than an intention.';
comment on column ouroboros.model_prices.catalog_version is
  'Which snapshot a bundled row came from — "<date>+<upstream>.<short commit>", e.g. 2026-08-15+litellm.70d51a1. Required on bundled rows (the sweep deletes by it), null on overrides.';
comment on column ouroboros.model_prices.meta is
  'What the catalog knows besides the price: context_tokens, max_output_tokens, capability flags, and the upstream entry it was transformed from. Read by CH.2 (#585) when a provider''s own model list is unavailable.';
comment on column ouroboros.model_prices.effective_at is
  'When these prices took effect as far as the source knows — the snapshot''s upstream commit date for a bundled row. Not a history axis: one row per (workspace, kind, model), so this table holds what is true now. Price history is #598''s question.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- The unique constraint above already indexes `(organization_id, …)`, which is also the
-- index the workspace cascade needs, so nothing here repeats it. What it cannot serve is
-- the lookup, whose leading predicate is the *kind*: a read asks "what does this workspace
-- pay for this model", and the answer is at most one bundled row and at most one override,
-- found by kind and model together.
-- ---------------------------------------------------------------------------

-- The lookup index, and the acceptance criterion's: `ouroboros.model_price()` resolves in
-- one indexed query, asserted plan-first in tests/constraints.sql.
--
-- `(match_provider_kind, match_model)` in that order because both are tested with
-- `= any (array[…, '*'])` — two equalities, so either order would work for the scan, and
-- this one keeps the family rows of a kind adjacent, which is the order a human reading
-- the catalog wants. `organization_id` is deliberately *not* in it: the org predicate is
-- `= $1 or is null`, which no b-tree column can satisfy as an equality, and at most two
-- rows survive the first two columns anyway.
create index model_prices_lookup_idx
  on ouroboros.model_prices (match_provider_kind, match_model);

-- The re-import's sweep: `delete … where source = 'bundled' and catalog_version <> $1`,
-- run once per snapshot bump over the whole bundled catalog. Partial on `source` because
-- that is the only value it is ever asked about, which keeps the index to the bundled
-- rows and states in the catalogue that overrides are outside the sweep's reach.
create index model_prices_bundled_version_idx
  on ouroboros.model_prices (catalog_version) where source = 'bundled';

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger model_prices_touch_updated_at
  before update on ouroboros.model_prices
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ouroboros.model_price() — the lookup, and the precedence rule, in one place.
--
-- Every reader of this table asks the same question — *what does this workspace pay for
-- this model on this provider* — and the answer is a four-way precedence that no caller
-- should be re-deriving in application code. A function is what makes the rule the
-- schema's rather than the pricing service's, the dashboard's and the spend report's
-- separately.
--
--   select * from ouroboros.model_price('org-acme', 'anthropic', 'claude-fable-5');
--
-- Zero rows or one, never more: the unique constraint permits one bundled and one
-- override row per (kind, model), and `limit 1` picks between them. Zero rows is the
-- honest answer for an uncovered model and the one the read path renders `—` from.
--
-- **Precedence, in the order the `order by` states it:**
--
--   1. an override beats a bundled row, always — including an override *family* row
--      beating a bundled *exact* row. A workspace that says "everything I reach through
--      this provider is free" or "we are on an enterprise contract" is describing its own
--      invoice, and the snapshot is describing a public price list. The specific statement
--      about the general case beats the general statement about the specific case, because
--      only one of the two parties has seen the bill.
--   2. an exact model beats a family row.
--   3. an exact kind beats `'*'`.
--
-- Deterministic without a tie-break: after `organization_id`, `match_model` and
-- `match_provider_kind` are fixed, the unique constraint leaves exactly one candidate.
--
-- **A null `p_provider_kind` is the unbound alias** — mockup 21's `gpt5-experiments`, which
-- names `gpt-5.2-preview` and no provider. `null = any (array[null, '*'])` is null, so only
-- `'*'` kinds can match, of which the bundled catalog has none: an unbound alias resolves
-- to nothing and renders `—`, which is exactly right. Nothing has told us who would be
-- billing.
--
-- **`language sql` and `stable`, deliberately.** Both are what let PostgreSQL inline the
-- body into the calling query, so the plan a caller gets is the index scan below rather
-- than an opaque function scan — which is what makes the acceptance criterion's
-- "one indexed query, plan-verified" an observable property of the function itself, and
-- not of a copy of its body pasted into a test. A plpgsql rewrite of this would pass every
-- behavioural assertion and quietly lose that.
-- ---------------------------------------------------------------------------
create function ouroboros.model_price(
  p_organization_id text,
  p_provider_kind   text,
  p_model           text
) returns setof ouroboros.model_prices
language sql stable as $$
  select p.*
    from ouroboros.model_prices p
   where p.match_provider_kind = any (array[p_provider_kind, '*'])
     and p.match_model         = any (array[p_model, '*'])
     and (p.organization_id = p_organization_id or p.organization_id is null)
   order by (p.organization_id is not null) desc,
            (p.match_model         <> '*')  desc,
            (p.match_provider_kind <> '*')  desc
   limit 1;
$$;

comment on function ouroboros.model_price(text, text, text) is
  'The pricing lookup (#580): the one row that prices (provider kind, model) for a workspace, or no row at all when the catalog does not cover it. Precedence is override over bundled, exact model over family, exact kind over ''*''. SQL and STABLE so it inlines — callers get the model_prices_lookup_idx scan, not a function scan.';

-- ---------------------------------------------------------------------------
-- ouroboros.import_model_price_catalog() — the bundled snapshot, applied.
--
-- `R__model_price_catalog.sql` is a repeatable migration that consists of one call to this
-- function: a version string, a timestamp and the rows as a jsonb array. Splitting it that
-- way is what keeps the generated file **data** — the transform emits no logic, so a
-- snapshot bump is a diff of numbers a reviewer can read, and the rules below are versioned
-- here where they can be tested against synthetic catalogs rather than only against the
-- one that shipped.
--
-- **What it guarantees, in the order the acceptance criteria ask for it:**
--
--   * **Idempotent.** A second call with the same arguments returns
--     `(0, 0, n, 0)` — nothing inserted, nothing updated, everything unchanged, nothing
--     deleted. The `where` clause on the `do update` is what makes that literal rather
--     than approximate: an identical row is not written, so `updated_at` does not move and
--     no trigger fires. Counting the four outcomes and returning them is not diagnostics —
--     it is how a caller, and the test suite, can *assert* idempotency instead of inferring
--     it from row counts that would look the same either way.
--
--   * **Newer snapshots update bundled rows only.** Every row it writes is
--     `organization_id null, source 'bundled'`, and the conflict target names those
--     columns, so an override is not reachable from here — not by convention, but because
--     there is no key this statement can produce that collides with one.
--
--   * **The bundled catalog is exactly the snapshot.** After the upsert, bundled rows
--     carrying any other `catalog_version` are deleted. Without that sweep a model dropped
--     upstream would linger for ever at last year's price, stamped with a version nobody
--     could interpret, and the catalog would be the union of every snapshot ever applied
--     rather than the one it claims to be.
--
-- The whole of it is one transaction — Flyway wraps a migration in one, and a partial
-- catalog is not a state anything should read.
--
-- Parameters:
--   p_catalog_version — stamped on every row, and the sweep's survivor test. See the
--                       column comment for the grammar.
--   p_effective_at    — when the snapshot's prices took effect: upstream's commit
--                       timestamp, passed in rather than defaulted to `now()`, so
--                       re-applying an unchanged catalog is genuinely a no-op.
--   p_catalog         — a jsonb array of objects, each
--                       `{match_provider_kind, match_model, billing_mode,
--                         input_cents_per_1m, output_cents_per_1m, meta}`. The amounts and
--                       `meta` are optional; everything else is refused as null by the
--                       table's own constraints, which describe the problem better than a
--                       hand-written message here could.
--
-- Returns one row: `(inserted, updated, unchanged, deleted)`.
-- ---------------------------------------------------------------------------
create function ouroboros.import_model_price_catalog(
  p_catalog_version text,
  p_effective_at    timestamptz,
  p_catalog         jsonb
) returns table (inserted bigint, updated bigint, unchanged bigint, deleted bigint)
language plpgsql as $$
declare
  incoming_rows bigint;
  distinct_rows bigint;
  ins_count     bigint := 0;
  upd_count     bigint := 0;
  del_count     bigint := 0;
begin
  -- The three arguments, checked before anything is written. Each of these would
  -- otherwise fail later and further away: a null version as a CHECK violation on the
  -- first row, a null timestamp as a not-null violation, a non-array as a type error
  -- inside `jsonb_array_elements`. Class 22 (data exception) rather than 23, because the
  -- argument is wrong rather than the row.
  if p_catalog_version is null or btrim(p_catalog_version) = '' then
    raise exception 'import_model_price_catalog: a bundled catalog must name its version'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_effective_at is null then
    raise exception 'import_model_price_catalog: a bundled catalog must say when it took effect'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(p_catalog) is distinct from 'array' then
    raise exception 'import_model_price_catalog: the catalog must be a jsonb array, not %',
      coalesce(jsonb_typeof(p_catalog), 'null')
      using errcode = 'invalid_parameter_value';
  end if;

  -- Two rows for the same (kind, model) in one payload is a bug in whatever generated it,
  -- and PostgreSQL's own message for it — "ON CONFLICT DO UPDATE command cannot affect row
  -- a second time" — names neither the model nor the file to fix. Caught here so the
  -- report is the count and the statement is never attempted.
  select count(*), count(distinct (e ->> 'match_provider_kind', e ->> 'match_model'))
    into incoming_rows, distinct_rows
    from jsonb_array_elements(p_catalog) as e;

  if incoming_rows <> distinct_rows then
    raise exception
      'import_model_price_catalog: the catalog prices some model twice (% entries, % distinct keys)',
      incoming_rows, distinct_rows
      using errcode = 'invalid_parameter_value';
  end if;

  -- The upsert. `where` on the `do update` is the idempotency guarantee: a row that would
  -- be written back identically is left alone, so it neither counts as an update nor
  -- moves `updated_at`. `xmax = 0` is how a returning clause tells an inserted row from an
  -- updated one — a freshly inserted tuple has no updating transaction.
  with incoming as (
    select e ->> 'match_provider_kind'              as match_provider_kind,
           e ->> 'match_model'                      as match_model,
           e ->> 'billing_mode'                     as billing_mode,
           (e ->> 'input_cents_per_1m')::numeric    as input_cents_per_1m,
           (e ->> 'output_cents_per_1m')::numeric   as output_cents_per_1m,
           coalesce(e -> 'meta', '{}'::jsonb)       as meta
      from jsonb_array_elements(p_catalog) as e
  ),
  upserted as (
    insert into ouroboros.model_prices as mp
      (organization_id, match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version, meta, effective_at)
    select null, i.match_provider_kind, i.match_model, i.billing_mode,
           i.input_cents_per_1m, i.output_cents_per_1m, 'bundled', p_catalog_version,
           i.meta, p_effective_at
      from incoming i
    on conflict (organization_id, match_provider_kind, match_model, source) do update
       set billing_mode        = excluded.billing_mode,
           input_cents_per_1m  = excluded.input_cents_per_1m,
           output_cents_per_1m = excluded.output_cents_per_1m,
           catalog_version     = excluded.catalog_version,
           meta                = excluded.meta,
           effective_at        = excluded.effective_at
     where (mp.billing_mode, mp.input_cents_per_1m, mp.output_cents_per_1m,
            mp.catalog_version, mp.meta, mp.effective_at)
        is distinct from
           (excluded.billing_mode, excluded.input_cents_per_1m, excluded.output_cents_per_1m,
            excluded.catalog_version, excluded.meta, excluded.effective_at)
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into ins_count, upd_count
    from upserted;

  -- The sweep. `is distinct from` rather than `<>` so a bundled row that somehow carries a
  -- null version is removed too rather than surviving the comparison — it is a row no
  -- import can account for, and the CHECK that forbids it is the reason there should never
  -- be one.
  with swept as (
    delete from ouroboros.model_prices
     where source = 'bundled'
       and catalog_version is distinct from p_catalog_version
    returning 1
  )
  select count(*) into del_count from swept;

  return query select ins_count, upd_count, incoming_rows - ins_count - upd_count, del_count;
end;
$$;

comment on function ouroboros.import_model_price_catalog(text, timestamptz, jsonb) is
  'Applies a bundled price snapshot (#580) and returns (inserted, updated, unchanged, deleted). Idempotent — a second call with the same arguments writes nothing at all — and structurally incapable of touching an override, since every row it writes is organization_id null / source bundled. Bundled rows left over from an earlier catalog_version are swept, so the bundled catalog is exactly the snapshot named. Called by R__model_price_catalog.sql, which is generated by ouroboros-db/scripts/price-catalog.mjs.';
