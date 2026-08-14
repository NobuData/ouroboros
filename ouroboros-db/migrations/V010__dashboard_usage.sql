-- V010__dashboard_usage.sql — `token_usage`, the append-only spend ledger, and the
-- `token_usage_daily` view the dashboard reads it through.
--
-- The third table of the dashboard read-model, and the last of mockup 02's six surfaces
-- to get one (docs/mockups/02-dashboard.html):
--
--   * the stat row's **Token spend · today** — `4.2M`, over the subline
--     `≈ $18.60 across 4 providers`.
--
-- **Decision F10 — a ledger, not a counter.** The card is one number, and the cheap
-- shape for one number is one row per organization that something increments. That shape
-- is wrong here twice over. It drifts the moment anything is corrected — a re-priced
-- month, a double-counted retry, a provider invoice that disagrees — and there is no
-- record left to reconcile against, because the arithmetic that produced the total was
-- thrown away as it happened. And it cannot answer the question the product is already
-- committed to asking: per-run cost attribution is what mockup 15's insights screen is
-- made of, and a counter has no `run_id` to attribute to. So spend is stored as the
-- events that caused it, and every total in the product is an aggregate over them.
--
-- **Decision F8 — `provider` and `model` stay opaque**, as they are on `runs`. A
-- provider is `anthropic`, `openai`, `ollama`, `copilot` on mockup 07 today and will be
-- whatever the model registry (mockup 21) admits tomorrow; a CHECK enumerating them here
-- would be this table inventing a catalog it does not own, and would reject a call the
-- engine really made and really paid for. Bounded and non-blank, and no vocabulary.
--
-- `provider` carries one rule beyond that, and it is the stat's rather than the
-- registry's: it is stored folded, so `count(distinct provider)` — the `4 providers` in
-- the subline — counts providers rather than spellings. Enforced by the character class,
-- exactly as V003 folds a GitHub login.
--
-- **`cost_cents` is nullable, and null means *unpriced*.** Priced accounting is #92: it
-- owns the rate card, the currency question, and the pass that fills these in. Until it
-- lands, most of this column is null, and that is the honest value — a zero would say
-- the call was free, which is a claim about money that nothing here is entitled to make.
-- Nothing defaults it, nothing coalesces it, and the view below propagates the null so
-- the card can render `cost unavailable` rather than an understated total. It is also
-- why the mockup's subline reads `≈`: a day whose local inference is unpriced is a day
-- whose cost is a lower bound, and `token_usage_daily.unpriced_events` is how a reader
-- finds that out.
--
-- **Append-only is a posture, not a trigger.** See the grant section at the foot of this
-- file for what enforces it and what does not, and why a `before update or delete`
-- refusal would be the wrong instrument.
--
-- **Nothing writes this table yet**, as with `runs` (V008, #64) and `queue_items` (V009,
-- #65): the loop engine is v2 (#54), the seed rows are F.5 (#68) and the endpoint that
-- reads the view is G.1 (#70). So every rule a reader depends on is a database
-- constraint rather than an application invariant — the writers do not exist to be
-- trusted yet.
--
-- House snake_case throughout — decision A4. `organization` is referenced by its quoted
-- camelCase `"id"` because that is BetterAuth's column; everything this file creates is
-- ours.
--
-- Filed as issue #66 (F.3).

-- ---------------------------------------------------------------------------
-- The run-belongs-to-the-organization check.
--
-- `token_usage` names two parents — the workspace the spend is billed to, and
-- (optionally) the run that incurred it — and, as on `runs` and `queue_items`, nothing
-- about two separate foreign keys makes them agree. A row naming `org-acme` and a run of
-- Globex's is not a broken join: it is Globex's work appearing in Acme's spend, and,
-- once mockup 15 joins the two, Acme's insights screen attributing cost to an issue in
-- somebody else's repository.
--
-- V009 generalised V008's equivalent into `ouroboros.repo_in_organization()`, and said
-- at the time that this table could not use it: that function reaches the workspace
-- through `github_repo_id`, and this table has no such column — it reaches a repository
-- through its run, if it has one at all. So this is the second rule of the same shape
-- rather than a second copy of the same rule, and it is written the same way V009 left
-- that one: generic over the table, keyed on `tg_table_name` and `tg_name`, so the next
-- table that attributes something to a run reuses it instead of copying it.
--
-- What that costs is the same invisible requirement V009 named: the table must call its
-- columns `organization_id` and `run_id`. That is the house naming already, and a table
-- that spells them differently gets an `undefined_column` error on its first insert
-- rather than a silently absent check.
--
-- Two differences from `repo_in_organization()`, both worth stating because they change
-- what a caller sees:
--
--   * `run_id` is nullable here — usage that no run caused is ordinary — so a null run
--     is accepted without a lookup. Which means this trigger does *not* subsume the
--     organization foreign key the way V008's and V009's do: a row naming an
--     organization that does not exist is refused by the trigger when it carries a run,
--     and by `token_usage_organization_id_fkey` when it does not. Both are class 23 and
--     both are refusals; only the name differs.
--
--   * `runs` cascades from `organization`, so a run and the workspace it belongs to
--     cannot disagree behind this check's back.
--
-- What it does **not** cover, inherited unchanged from V008: it fires on writes to the
-- referencing table, so re-parenting a `runs` row onto another workspace would leave
-- existing usage rows mis-scoped behind it. `runs.organization_id` is not a column
-- anything moves today. The day something moves it, that migration owns this.
-- ---------------------------------------------------------------------------
create function ouroboros.run_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  -- Usage with no run is usage nothing has to agree with: planning, chat, a retry that
  -- never opened a run row. The organization foreign key is the whole of the rule then.
  if new.run_id is null then
    return new;
  end if;

  select r.organization_id into owner
    from ouroboros.runs r
   where r.id = new.run_id;

  -- Null means the run is gone between this statement and its own foreign key — which
  -- the FK itself will refuse a moment later. Saying nothing here leaves that error to
  -- the constraint that describes it properly.
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      '% row attributes usage to run %, which belongs to organization % rather than %',
      tg_table_name, new.run_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.run_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for any table carrying both organization_id and a nullable run_id (#66): refuses a row whose run belongs to a different organization than the row does. The sibling of repo_in_organization() (#65), which this table cannot use — it reaches a repository through its run, not directly. Raises class 23 naming the trigger, so each table reports its own constraint name.';

-- ---------------------------------------------------------------------------
-- token_usage
-- ---------------------------------------------------------------------------
create table ouroboros.token_usage (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace the spend is billed to, and the scope of every read of this table.
  -- Cascade, as on every table in this read-model: a deleted workspace must not leave a
  -- ledger behind naming runs nobody can reach. It is the one deletion that is allowed
  -- to remove events, and it removes all of that workspace's, which keeps every total
  -- computable from what is left.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The run that incurred the spend, if a run did. Nullable for two reasons that both
  -- stay true: the loop spends tokens outside a run (planning, triage, the chat surfaces
  -- of mockups 19 and 20), and an event may be recorded before the run it belongs to is
  -- known.
  --
  -- `set null` rather than cascade, and this is the ledger's whole character: deleting a
  -- run does not un-spend the money. The event happened, the invoice will say so, and a
  -- day's total that shrank because a repository was disabled would be exactly the drift
  -- decision F10 exists to avoid. What is lost is the attribution, which is the thing
  -- that genuinely no longer exists.
  run_id           uuid        references ouroboros.runs (id) on delete set null,

  -- Who was paid, and what was asked. Opaque, decision F8 — see the header, and see
  -- `token_usage_provider_format` below for the one rule `provider` carries beyond it.
  provider         text        not null,
  model            text        not null,

  -- The call, in tokens. Two columns rather than a total because they are priced
  -- differently by every provider — output tokens cost a multiple of input tokens — so a
  -- single number could not be re-priced by #92 without the split it threw away. The
  -- card adds them: `4.2M` is `sum(tokens_in + tokens_out)`.
  --
  -- Zero is legal in either column and is not a missing value: a call that was refused
  -- after its prompt was read produced no output tokens, and a fully cached read
  -- produced no billable input.
  tokens_in        integer     not null,
  tokens_out       integer     not null,

  -- What it cost, in cents — and null until something knows, which today is everything.
  -- See the header: priced accounting is #92, null means *unpriced*, and zero would be a
  -- claim that the call was free.
  --
  -- `numeric`, and to four decimal places, because a cent is too coarse a unit for one
  -- call: per-token rates put a small request well under a cent, and integer cents would
  -- round a whole afternoon of them to nothing. Exact rather than floating point for the
  -- ordinary reason money is — `sum()` over a day of `numeric` is the number the invoice
  -- has, and over `double precision` it is nearly that number.
  cost_cents       numeric(14, 4),

  -- When the spend happened, which is not when the row appeared. `occurred_at` is what
  -- the day is computed from and what the BRIN index below summarises; `created_at` is
  -- the row's own timestamp. They are the same instant for an event recorded as it
  -- happens and deliberately different for one back-filled from a provider's usage
  -- export, which is how a ledger is reconciled.
  occurred_at      timestamptz not null default now(),

  created_at       timestamptz not null default now(),

  -- Deliberately no `updated_at`, and so no `touch_updated_at` trigger — the only table
  -- this repository creates without one (the BetterAuth tables are the library's, and
  -- keep whatever shape it emits). An event is a fact that already happened; there is no
  -- edit to it that this table is the record of. The one mutation anticipated is #92
  -- filling `cost_cents` in, which is a null becoming known rather than a value
  -- changing, and if that pass wants to record when it ran it owns saying so.

  -- --- the numbers are counts --------------------------------------------------------
  --
  -- A negative token count is not a refund, it is a bug in whatever parsed the provider's
  -- response — and it would subtract from the card silently, which is the one arithmetic
  -- error a total cannot survive. `integer` is the upper bound: a single call cannot
  -- reach two billion tokens, and a writer that thinks it did fails loudly here rather
  -- than adding a fictional order of magnitude to the day.
  constraint token_usage_tokens_in_nonnegative  check (tokens_in  >= 0),
  constraint token_usage_tokens_out_nonnegative check (tokens_out >= 0),

  -- Absent or a real amount. Null is *unpriced* (see the header); a negative cost is the
  -- same class of parse error as a negative token count.
  constraint token_usage_cost_cents_nonnegative
    check (cost_cents is null or cost_cents >= 0),

  -- --- the opaque strings are still strings -------------------------------------------
  --
  -- No vocabulary (decision F8), but a shape. `model` matches `runs.model` exactly — the
  -- same fact in two tables must fit both — and is *not* folded, because a model
  -- identifier is a name a provider chose and some of them carry capitals.
  constraint token_usage_model_present check (btrim(model) <> ''
                                              and length(model) <= 200),

  -- `provider` is folded, and the character class is what folds it: lower-case
  -- alphanumerics with single separators, the same instrument V003 uses on a GitHub
  -- login. This is the stat's rule rather than the registry's — the subline says
  -- `across 4 providers`, which is `count(distinct provider)`, and `Anthropic` alongside
  -- `anthropic` would make that 5. A separate `check (provider = lower(provider))` would
  -- be unreachable behind this one; relaxing the class to admit capitals would have to
  -- add it back.
  constraint token_usage_provider_format
    check (provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(provider) <= 64)
);

comment on table ouroboros.token_usage is
  'Append-only token spend ledger (#66) — one row per call, not one row per organization. The read-model behind mockup 02''s Token spend · today stat, read through token_usage_daily, and the source of the per-run cost attribution mockup 15 is made of. Decision F10: totals are aggregates over events, because a stored total drifts the moment anything is corrected.';
comment on column ouroboros.token_usage.organization_id is
  'Owning workspace — who is billed. Every read is scoped by it, and it leads the b-tree index.';
comment on column ouroboros.token_usage.run_id is
  'The run that incurred the spend, or null for usage no run caused (planning, triage, chat). ON DELETE SET NULL, not cascade: deleting a run does not un-spend the money.';
comment on column ouroboros.token_usage.provider is
  'Who was paid — anthropic | openai | ollama | copilot | … Opaque (decision F8) but folded lower-case, so the subline''s count(distinct provider) counts providers rather than spellings.';
comment on column ouroboros.token_usage.model is
  'Model identifier as recorded, opaque and unfolded (decision F8), the same shape as runs.model.';
comment on column ouroboros.token_usage.tokens_in is
  'Input tokens. Kept apart from tokens_out because every provider prices the two differently, which is what #92 will need to re-price an event.';
comment on column ouroboros.token_usage.cost_cents is
  'Cost in cents, or null for UNPRICED — never 0, which would claim the call was free. Priced accounting is #92; until then most rows are null and token_usage_daily propagates it.';
comment on column ouroboros.token_usage.occurred_at is
  'When the spend happened — what the day is computed from and what the BRIN index summarises. Not created_at, which is when the row appeared; they differ for events back-filled from a provider''s usage export.';

-- ---------------------------------------------------------------------------
-- Indexes — the ledger's own, the card's, and the run cascade's.
--
-- Acceptance criterion: a BRIN index on `occurred_at` is present, and inserting seed
-- volume stays under a second. Both are asserted in tests/constraints.sql against a
-- migrated database, which is the only place either can be observed.
-- ---------------------------------------------------------------------------

-- The ledger's own index, and the acceptance criterion's.
--
-- BRIN rather than a b-tree because of what this table is: append-only, ordered by the
-- column being indexed, and the only table here that grows per *call* rather than per
-- issue or per run. That is precisely the correlation BRIN exists for — it stores a
-- min/max summary per 128-page range instead of an entry per row, so the index stays
-- kilobytes where a b-tree would be gigabytes, and an insert touches one summary tuple
-- instead of descending a tree. The criterion's "seed volume in under a second" is the
-- floor of that; the point of it is the millionth row, not the thousandth.
--
-- What it costs is precision: a range scan reads whole 128-page ranges, so a query for
-- one hour reads the pages around it too. For time windows the product actually asks for
-- — a day, seven days, a month — that is noise.
--
-- `autosummarize = on` because the reads are of the newest data. Without it a range is
-- summarised only by `VACUUM`, and until then it is unsummarised — which is *correct*
-- (an unsummarised range always matches, so nothing is missed) but means today's spend
-- is found by reading today's pages exhaustively. Summarising as each range fills is
-- what keeps the newest window as cheap as the oldest.
create index token_usage_occurred_at_brin
  on ouroboros.token_usage using brin (occurred_at) with (autosummarize = on);

-- The card's read, which the BRIN cannot serve on its own:
--
--   select provider, sum(tokens_in + tokens_out), sum(cost_cents)
--     from ouroboros.token_usage
--    where organization_id = $1 and occurred_at >= $2
--    group by provider
--
-- — the query `token_usage_daily` is, with the day's bounds pushed into it. Every read
-- this product makes is workspace-scoped, and a workspace is a small fraction of the
-- ledger; the BRIN narrows to the day across *all* workspaces and leaves the rest to a
-- filter, which is the wrong way round for a card that renders per organization.
--
-- So the two indexes are not two copies of one answer: this one answers "this workspace,
-- this window" and is the dashboard's, the BRIN answers "this window, whoever it belongs
-- to" and is the ledger's — #92's re-pricing pass, and any retention work that reads by
-- age. It is also the index the organization cascade needs, since a workspace deletion
-- would otherwise scan the whole ledger.
--
-- `desc` on the timestamp so the newest-first reads the insights screens will want come
-- out of the index in order.
create index token_usage_organization_occurred_at_idx
  on ouroboros.token_usage (organization_id, occurred_at desc);

-- Not a read path today, but two things at once: `runs` back-references this table on
-- delete (`set null`), and an unindexed referencing column makes every run deletion a
-- full scan of the ledger — the biggest table in the schema. It is also the index the
-- per-run attribution of mockup 15 will read, which is the one query that starts from a
-- run rather than from a workspace.
create index token_usage_run_id_idx
  on ouroboros.token_usage (run_id);

-- ---------------------------------------------------------------------------
-- Triggers. No `touch_updated_at` — there is no `updated_at` to touch; see the column
-- list for why an event has none.
-- ---------------------------------------------------------------------------
create trigger token_usage_run_in_organization
  before insert or update of organization_id, run_id on ouroboros.token_usage
  for each row execute function ouroboros.run_in_organization();

-- ---------------------------------------------------------------------------
-- token_usage_daily — the rollup the stat card is rendered from.
--
-- Acceptance criterion: per-day, per-organization, per-provider sums matching the events
-- underneath. A plain view rather than a materialized one, and that is decision F10
-- again in its second half: a materialized rollup is a stored total wearing a different
-- hat, and it is stale from the moment an event is corrected or back-filled until
-- something refreshes it. This is the aggregate, computed when it is asked for, and the
-- indexes above are what make asking cheap. If the day comes when the aggregate is too
-- slow to compute per request, the answer is a refresh policy somebody chose, on a
-- migration that says so.
--
-- One row per (organization, day, provider) — which makes the card's whole read a query
-- over this view and nothing else:
--
--   select sum(tokens_total)  as tokens,   -- "4.2M"
--          sum(cost_cents)    as cents,    -- "≈ $18.60"
--          count(*)           as providers -- "across 4 providers"
--     from ouroboros.token_usage_daily
--    where organization_id = $1 and day = (now() at time zone 'utc')::date;
--
-- **The day is UTC, deliberately and explicitly.** `date_trunc('day', occurred_at)` on a
-- `timestamptz` is resolved in the *session's* time zone, which makes the boundary of
-- "today" a property of whichever connection asked — the same ledger yielding different
-- days to the API server and to a psql session is a rollup nobody can reconcile. Fixing
-- it to UTC makes the view's answer the same everywhere. A per-workspace display time
-- zone is a real product question and it is not this table's: the endpoint (#70) renders
-- the day, and the day it renders is defined here.
--
-- `security_invoker = true` so reading through the view requires the rights to read the
-- table. Without it a view runs as its owner, which would make it a way around the
-- insert-only posture below rather than a convenience on top of it.
-- ---------------------------------------------------------------------------
create view ouroboros.token_usage_daily
  with (security_invoker = true) as
select u.organization_id,
       (u.occurred_at at time zone 'utc')::date            as day,
       u.provider,

       -- The two counts are what let a reader know how much of the money below is known:
       -- a day with unpriced events has a cost that is a lower bound, which is the `≈`
       -- the mockup's subline already carries.
       count(*)                                            as events,
       count(*) filter (where u.cost_cents is null)        as unpriced_events,

       sum(u.tokens_in)                                    as tokens_in,
       sum(u.tokens_out)                                   as tokens_out,
       sum(u.tokens_in + u.tokens_out)                     as tokens_total,

       -- Null-propagating on purpose: `sum` skips nulls, so this is the cost of the
       -- priced events and is null when none of them are priced. Not `coalesce(…, 0)` —
       -- a zero here is the same lie the column refuses to default to, and the card
       -- renders `cost unavailable` from exactly this null.
       sum(u.cost_cents)                                   as cost_cents
  from ouroboros.token_usage u
 -- `2` is the day expression above. Positional rather than repeated, so the grouping key
 -- and the projected column cannot drift apart.
 group by u.organization_id, 2, u.provider;

comment on view ouroboros.token_usage_daily is
  'Per-organization, per-day, per-provider rollup of token_usage (#66) — the read behind mockup 02''s Token spend · today. A plain view, not materialized: decision F10, a stored total drifts. The day is UTC, fixed rather than session-dependent.';
comment on column ouroboros.token_usage_daily.day is
  'The UTC calendar day occurred_at falls in. Fixed to UTC so the same ledger yields the same days to every caller; rendering it in a workspace''s own zone is the endpoint''s question (#70).';
comment on column ouroboros.token_usage_daily.unpriced_events is
  'How many of the day''s events have no cost_cents yet. Non-zero means cost_cents below is a lower bound — which is the "≈" on the card, and today it is every event (#92 prices them).';
comment on column ouroboros.token_usage_daily.tokens_total is
  'tokens_in + tokens_out summed — the "4.2M" the stat renders.';
comment on column ouroboros.token_usage_daily.cost_cents is
  'Cost of the day''s PRICED events, in cents, and null when none of them are priced. Never coalesced to zero: the card renders "cost unavailable" from this null.';

-- ---------------------------------------------------------------------------
-- The grant posture, documented rather than granted.
--
-- This table is append-only, and the honest way to say so is a grant: the role the
-- engine writes with should hold `insert` on `ouroboros.token_usage` and nothing else on
-- it, and the role the API reads with should hold `select` on `ouroboros.token_usage_daily`
-- — with `update` and `delete` granted to neither.
--
-- **Not written here, because there is nobody to grant it to.** Every module still
-- connects as the migration user; per-role least privilege is #25's work, and a `grant`
-- naming a role that does not exist is a migration that fails on a clean database. When
-- #25 creates those roles, this is the posture it applies to this table, stated here so
-- that it is a decision it inherits rather than one it has to re-derive.
--
-- **And it is deliberately not a trigger.** A `before update or delete … raise` would
-- enforce append-only today, at the cost of the two mutations this table is *designed*
-- for: #92's pricing pass filling `cost_cents` in, and the `on delete set null` that
-- detaches an event from a deleted run. Both are legitimate and both would have to be
-- special-cased in the trigger, at which point the trigger enforces "append-only except
-- where we said otherwise" — a rule that reads as a guarantee and is not one. Privileges
-- can say "this connection may not update" without saying "this table may never change",
-- which is the distinction that actually holds.
--
-- What *is* enforced here, and needs no roles: the ledger cannot be silently reduced.
-- Token counts cannot go negative, costs cannot go negative, and the only cascade that
-- removes events is the deletion of the workspace they belong to.
-- ---------------------------------------------------------------------------
