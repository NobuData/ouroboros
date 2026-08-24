-- V024__resolution_snapshots.sql — `resolution_snapshots`: what a run's routing resolution
-- decided, kept, so that mockup 21's chain card and the run console's transcript render a
-- stored fact rather than a re-computation.
--
-- Mockup 21 (docs/mockups/21-model-registry.html) closes with the *RESOLUTION CHAIN* card:
--
--   route.task("implement") → route implement-primary → alias coder-max
--     → provider Anthropic (key …Xq4A) → model claude-fable-5    ● resolved · 42ms
--   "Every hop is inspectable in the run console transcript."                 run #482
--
-- and the caption is a claim about **stored truth**. Z.1's `resolve()` (#194) is pure and
-- versioned and answers that chain on demand — but on demand is not the same as *what
-- happened*: a card that re-resolved `implement` every time it rendered would show today's
-- health and today's rules beside a run number from last week, and would call that
-- inspection. Roadmap decision **R9** (docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md) is the
-- alternative: the card renders **persisted resolution snapshots**, written at execution time,
-- and until execution exists it renders a Simulate-driven preview *labelled as one* plus one
-- seeded run — #482 — as fixture data. A hard-coded card would be a fake run #482; a stored
-- row is a real one, and the fixture is honest about being a fixture.
--
-- ---------------------------------------------------------------------------
-- Whose table this is, and why it lands here.
-- ---------------------------------------------------------------------------
--
-- CH.6 (#589) owns the **contract**: the versioned snapshot shape, the executor that writes
-- it (AF.2 #235 / WF-T.6 #160), and `GET /api/v1/registry/resolutions/latest?alias=` that
-- reads it for the chain card (CI.5, #595) and the run console (AP.2 #304, AQ.4 #312). CG.4
-- (#582) owns the **fixture** — and a fixture needs a table to be persisted in. That ordering
-- is the same one V015 met for mockups 07 and 21 and V022 met for #26's audit trail, and it is
-- resolved the same way: the schema lands with the migration that first needs a row in it,
-- with its shape CHECKed and its accessors deliberately absent, and the service ticket
-- **inherits** the table rather than creating a second one. What #589 finds here is a table
-- whose columns are its own contract's nouns — run, task kind, route, chain with provider,
-- masked key suffix and health per hop, rules applied, timings — and a `shape_version` it may
-- bump. What it does not find is any read path: the endpoint, its OpenAPI shape and the
-- executor's write are that ticket's, and a `latest_resolution()` function written here would
-- be the thing it had to negotiate with rather than write.
--
-- ---------------------------------------------------------------------------
-- The shape is versioned, and a version is a promise about this file.
-- ---------------------------------------------------------------------------
--
-- `shape_version` is `1` and this migration is what `1` means. The rule for bumping it is
-- `ouroboros-rest/src/modules/routing/resolution.ts`'s rule for its own `r1`: **adding** a
-- hop code, a rule code or an optional key is not a bump — a reader that does not recognise
-- a code has an `explanation` to render and a `decision` to branch on; **renaming** a field,
-- removing one, or changing what one means **is**. A reader pins the version; a writer states
-- it. The CHECK `resolution_snapshots_shape_version_known` admits exactly the versions this
-- schema can validate, so a writer ahead of the schema is refused at the row rather than
-- stored as a document nothing here can read — and widening it is an ordinary migration that
-- replaces the validators beside it.
--
-- ---------------------------------------------------------------------------
-- Names inside the document, one foreign key outside it.
-- ---------------------------------------------------------------------------
--
-- The chain names its alias by `alias`, its route by `tag`, its task kind by `name` and its
-- provider by `kind` and `display_name` — never by id. V021 made the same choice for
-- `route_revisions` and for the same reason: a snapshot is read by a person reconstructing a
-- decision after the alias has been repointed, renamed or deleted, and a uuid is a lookup into
-- a row that may no longer say what it said. Nothing in the chain is a reference, so nothing in
-- the chain can block a delete or dangle after one — `alias_references` (V023) does not count
-- a snapshot, deliberately, because history is not a use.
--
-- The **run** is the one exception, and it is a real foreign key because the run is what a
-- snapshot is *about*: the run console reads *this run's* resolutions, the card prints the run
-- number, and a snapshot whose run is gone is a transcript of nothing. It **cascades**: a
-- deleted run takes its transcript with it. It is held to the snapshot's own workspace by
-- `resolution_snapshot_run_in_organization()`, a trigger on V008's precedent rather than a
-- composite key on V016's — the composite key would be a second btree on `runs` carrying
-- `organization_id`, and tests/constraints.sql showed the planner taking it over V008's
-- partial indexes on that table the moment it existed, whichever column led. A rule that
-- costs an unrelated section its plan assertion is the wrong shape for a rule a trigger
-- states just as plainly. A resolution with no run is a simulation (Z.4, #197), and decision
-- R9 says a simulation is rendered as one and never stored as this.
--
-- ---------------------------------------------------------------------------
-- Append-only, like the audit trail, and for the same reason.
-- ---------------------------------------------------------------------------
--
-- A snapshot is an event: it records what resolution decided at a moment, and an event that
-- can be edited is not one. There is no `updated_at`, no touch trigger, and
-- `resolution_snapshots_no_update` refuses every UPDATE from every role including the owner
-- this stack connects as (V022's argument: a rule that only lives in the grants is true in
-- production and false on the machine the code is written on). Unlike V022 there is no
-- exception to carve out — both foreign keys cascade rather than set null, so no statement in
-- this schema ever needs to revise a row here.
--
-- ---------------------------------------------------------------------------
-- What the document may hold, and the two things it may not.
-- ---------------------------------------------------------------------------
--
-- Every hop carries the alias, the model id, the provider **as it was** — kind, display name,
-- status and latency from the health snapshot the resolution was made against — the decision
-- (`kept` / `dropped`), Z.1's stable `code`, and its sentence. Two rules hold the document to
-- what it is:
--
--   * **The key suffix is a suffix.** `provider.key_suffix` is the masked tail mockup 21
--     prints (`…Xq4A`) and the inspector's `sk-ant-…Xq4A`: at most sixteen alphanumerics by
--     CHECK, which is a shape no credential fits. AD.1's vault (#222) seals the key and AD.4
--     (#225) grep-tests the audit trail for it; this column is CHECKed instead, because a
--     suffix has a shape and a payload does not. Null where no credential was involved — a
--     local provider, or a hop that was dropped before a key was leased.
--
--   * **A timing is a measurement.** `duration_ms` on a hop is present only on a hop that was
--     *tried*, which is a kept one; a dropped hop cost nothing and carries no number. The
--     row's own `duration_ms` is nullable for V020's reason — null is *nobody timed it* and
--     `0` is a resolution that took under a millisecond — and is never defaulted (decision
--     M8).
--
-- Filed as issue #582 (CG.4). Shape coordinated with #589 (CH.6); read by #595 (CI.5) and the
-- run console (#304, #312); written by #235 (AF.2) once invocation exists, and by
-- R__dev_seed_routing.sql until then. Asserted in tests/constraints.sql and tests/seed.sql.

-- ---------------------------------------------------------------------------
-- The provider half of a hop — where the model ran, as the health snapshot saw it.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_provider_valid(provider jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  member text;
  held   text;
begin
  if jsonb_typeof(provider) <> 'object' then
    return false;
  end if;

  for member in select k from jsonb_object_keys(provider) as k loop
    if member not in ('kind', 'display_name', 'key_suffix', 'status', 'latency_ms', 'detail') then
      return false;
    end if;
  end loop;

  if not (provider ?& array['kind', 'display_name', 'status']) then
    return false;
  end if;

  -- The adapter kind, in the shape model_prices.match_provider_kind holds it — shape rather
  -- than V015's vocabulary, because a snapshot taken under a kind added later must still read.
  if jsonb_typeof(provider -> 'kind') <> 'string'
     or (provider ->> 'kind') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or length(provider ->> 'kind') > 64 then
    return false;
  end if;

  if jsonb_typeof(provider -> 'display_name') <> 'string'
     or btrim(provider ->> 'display_name') = ''
     or length(provider ->> 'display_name') > 120 then
    return false;
  end if;

  -- The four states V015 gives a connection, copied at the time — a snapshot's `unknown` is
  -- "nothing had checked it when this ran", which is a different fact from today's chip.
  if jsonb_typeof(provider -> 'status') <> 'string'
     or (provider ->> 'status') not in ('active', 'paused', 'error', 'unknown') then
    return false;
  end if;

  held := coalesce(jsonb_typeof(provider -> 'key_suffix'), 'null');
  if held <> 'null'
     and (held <> 'string' or (provider ->> 'key_suffix') !~ '^[A-Za-z0-9]{1,16}$') then
    return false;
  end if;

  held := coalesce(jsonb_typeof(provider -> 'latency_ms'), 'null');
  if held <> 'null'
     and (held <> 'number' or (provider -> 'latency_ms')::numeric < 0) then
    return false;
  end if;

  held := coalesce(jsonb_typeof(provider -> 'detail'), 'null');
  if held <> 'null'
     and (held <> 'string' or btrim(provider ->> 'detail') = ''
          or length(provider ->> 'detail') > 200) then
    return false;
  end if;

  return true;
end;
$$;

comment on function ouroboros.resolution_snapshot_provider_valid(jsonb) is
  'Whether a hop''s provider document is inside the snapshot shape (#582, shape version 1): kind (shaped as model_prices.match_provider_kind), display_name, status (V015''s four), and optionally key_suffix — at most sixteen alphanumerics, the masked tail mockup 21 prints and a shape no credential fits — latency_ms (non-negative) and detail. Unknown keys are refused; absent and JSON null both mean not known.';

-- ---------------------------------------------------------------------------
-- One hop of the chain.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_hop_valid(hop jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  member text;
  held   text;
  amount numeric;
  kept   boolean;
begin
  if jsonb_typeof(hop) <> 'object' then
    return false;
  end if;

  for member in select k from jsonb_object_keys(hop) as k loop
    if member not in ('index', 'position', 'alias', 'model_id', 'params', 'provider',
                      'note', 'decision', 'code', 'explanation', 'duration_ms') then
      return false;
    end if;
  end loop;

  if not (hop ?& array['index', 'alias', 'model_id', 'provider', 'decision', 'code', 'explanation']) then
    return false;
  end if;

  -- `index` is the hop's 1-based place in the resolved chain, dropped hops included — Z.1's
  -- own numbering, which is what "Fallback 2" in a sentence counts.
  if jsonb_typeof(hop -> 'index') <> 'number' then
    return false;
  end if;
  amount := (hop -> 'index')::numeric;
  if amount <> trunc(amount) or amount < 1 then
    return false;
  end if;

  -- `position` is the stored route_hops.position, or null for a hop a rule prepended.
  held := coalesce(jsonb_typeof(hop -> 'position'), 'null');
  if held <> 'null' then
    if held <> 'number' then
      return false;
    end if;
    amount := (hop -> 'position')::numeric;
    if amount <> trunc(amount) or amount < 1 then
      return false;
    end if;
  end if;

  if jsonb_typeof(hop -> 'alias') <> 'string'
     or (hop ->> 'alias') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(hop ->> 'alias') > 64 then
    return false;
  end if;

  if jsonb_typeof(hop -> 'model_id') <> 'string'
     or btrim(hop ->> 'model_id') <> (hop ->> 'model_id')
     or (hop ->> 'model_id') = ''
     or length(hop ->> 'model_id') > 200 then
    return false;
  end if;

  -- The params the hop resolved with — the alias's merged with a rule's (Z.1). An object and
  -- nothing more: a rule's params are V018's wider vocabulary, not V019's.
  if coalesce(jsonb_typeof(hop -> 'params'), 'object') <> 'object' then
    return false;
  end if;

  -- Null is an unbound alias, which is a hop with nowhere to run.
  if jsonb_typeof(hop -> 'provider') <> 'null'
     and not ouroboros.resolution_snapshot_provider_valid(hop -> 'provider') then
    return false;
  end if;

  held := coalesce(jsonb_typeof(hop -> 'note'), 'null');
  if held <> 'null'
     and (held <> 'string' or btrim(hop ->> 'note') = '' or length(hop ->> 'note') > 200) then
    return false;
  end if;

  if jsonb_typeof(hop -> 'decision') <> 'string'
     or (hop ->> 'decision') not in ('kept', 'dropped') then
    return false;
  end if;
  kept := (hop ->> 'decision') = 'kept';

  -- Z.1's stable code — provider_healthy, alias_unbound, below_floor … — as an identifier,
  -- not a vocabulary: a code added to explanations.ts must not need a migration to be stored.
  if jsonb_typeof(hop -> 'code') <> 'string'
     or (hop ->> 'code') !~ '^[a-z][a-z0-9_]*$'
     or length(hop ->> 'code') > 64 then
    return false;
  end if;

  if jsonb_typeof(hop -> 'explanation') <> 'string'
     or btrim(hop ->> 'explanation') = ''
     or length(hop ->> 'explanation') > 500 then
    return false;
  end if;

  -- A kept hop has somewhere to run; an unbound alias is dropped by construction.
  if kept and jsonb_typeof(hop -> 'provider') = 'null' then
    return false;
  end if;

  -- A timing is a measurement of a hop that was tried, and only a kept hop is tried.
  held := coalesce(jsonb_typeof(hop -> 'duration_ms'), 'null');
  if held <> 'null' then
    if held <> 'number' or not kept then
      return false;
    end if;
    amount := (hop -> 'duration_ms')::numeric;
    if amount <> trunc(amount) or amount < 0 then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function ouroboros.resolution_snapshot_hop_valid(jsonb) is
  'Whether one hop of a stored chain is inside the snapshot shape (#582, shape version 1): index (1-based, dropped hops included), optional position, alias and model_id (shaped as their columns), optional params object, provider (a resolution_snapshot_provider_valid document, or null for an unbound alias), optional note, decision (kept | dropped), code (an identifier, Z.1''s vocabulary but not pinned to it), explanation, and optionally duration_ms. Two coherence rules: a kept hop has a provider, and only a kept hop carries a timing.';

-- ---------------------------------------------------------------------------
-- The chain — every hop in order, numbered densely from 1.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_chain_valid(chain jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  hop      jsonb;
  expected integer := 1;
begin
  if jsonb_typeof(chain) <> 'array' or jsonb_array_length(chain) = 0 then
    return false;
  end if;

  for hop in select e from jsonb_array_elements(chain) as e loop
    if not ouroboros.resolution_snapshot_hop_valid(hop) then
      return false;
    end if;
    -- Dense and in array order, for V016's reason: "Fallback 2" is a hop *number*, and a
    -- chain numbered 1, 2, 5 makes the sentence beside it mean nothing.
    if (hop -> 'index')::numeric <> expected then
      return false;
    end if;
    expected := expected + 1;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.resolution_snapshot_chain_valid(jsonb) is
  'Whether a stored chain is inside the snapshot shape (#582, shape version 1): a non-empty array of resolution_snapshot_hop_valid documents whose index runs densely from 1 in array order — a route is its chain, and a resolution over no hops has nothing to have decided.';

-- ---------------------------------------------------------------------------
-- How many hops a chain kept — the one number outcome has to agree with.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_kept_hops(chain jsonb)
returns integer
language sql
immutable
strict
as $$
  select case
           when jsonb_typeof(chain) = 'array'
           then (select count(*)::integer
                   from jsonb_array_elements(chain) as hop
                  where hop ->> 'decision' = 'kept')
           else 0
         end
$$;

comment on function ouroboros.resolution_snapshot_kept_hops(jsonb) is
  'How many hops of a stored chain were kept (#582). Zero for anything that is not an array, so the outcome CHECK it serves never raises on a document the shape CHECK is about to refuse. Z.1''s rule read back: a resolution is resolved exactly when some hop was usable.';

-- ---------------------------------------------------------------------------
-- The rules — every escalation rule the resolution evaluated, and whether it applied.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_rules_valid(rules jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  rule   jsonb;
  member text;
  held   text;
  amount numeric;
begin
  if jsonb_typeof(rules) <> 'array' then
    return false;
  end if;

  for rule in select e from jsonb_array_elements(rules) as e loop
    if jsonb_typeof(rule) <> 'object' then
      return false;
    end if;

    for member in select k from jsonb_object_keys(rule) as k loop
      if member not in ('id', 'sort_order', 'display', 'applied', 'code', 'explanation') then
        return false;
      end if;
    end loop;

    if not (rule ?& array['id', 'display', 'applied', 'code']) then
      return false;
    end if;

    -- The rule's id, as text: a name rather than a reference, like everything else in the
    -- document, so a rule deleted after the run leaves the transcript legible.
    if jsonb_typeof(rule -> 'id') <> 'string'
       or (rule ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;

    held := coalesce(jsonb_typeof(rule -> 'sort_order'), 'null');
    if held <> 'null' then
      if held <> 'number' then
        return false;
      end if;
      amount := (rule -> 'sort_order')::numeric;
      if amount <> trunc(amount) or amount < 1 then
        return false;
      end if;
    end if;

    -- V018's generated sentence, copied — the card's line as it read when the rule fired.
    if jsonb_typeof(rule -> 'display') <> 'string'
       or btrim(rule ->> 'display') = ''
       or length(rule ->> 'display') > 300 then
      return false;
    end if;

    if jsonb_typeof(rule -> 'applied') <> 'boolean' then
      return false;
    end if;

    if jsonb_typeof(rule -> 'code') <> 'string'
       or (rule ->> 'code') !~ '^[a-z][a-z0-9_]*$'
       or length(rule ->> 'code') > 64 then
      return false;
    end if;

    held := coalesce(jsonb_typeof(rule -> 'explanation'), 'null');
    if held <> 'null'
       and (held <> 'string' or btrim(rule ->> 'explanation') = ''
            or length(rule ->> 'explanation') > 500) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.resolution_snapshot_rules_valid(jsonb) is
  'Whether a snapshot''s rules document is inside the shape (#582, shape version 1): an array — empty when no rule was evaluated — of {id, sort_order?, display, applied, code, explanation?}, Z.1''s AppliedRule with the database''s spellings. The id is a name, not a reference: a rule retired after the run must not make its transcript unreadable.';

-- ---------------------------------------------------------------------------
-- The run belongs to the snapshot's workspace — V008's move, for a reason of this file's own.
--
-- `runs_repo_in_organization()` holds a run to its repository's workspace with a trigger
-- because the composite key a foreign key would need did not exist. Here it *could* exist,
-- and is deliberately not created — see the header: a second index on `runs` is what it
-- costs, and that index changed which path the planner took for V008's own reads. Refuses
-- with class 23 and the trigger's name as the constraint, so a caller meets the same shape
-- of error a foreign key gives and tests/constraints.sql can ask for it by name.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshot_run_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  select r.organization_id into owner
    from ouroboros.runs r
   where r.id = new.run_id;
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      'resolution snapshot names run %, which belongs to organization % rather than %',
      new.run_id, owner, new.organization_id
      using errcode = 'check_violation',
            constraint = 'resolution_snapshots_run_in_organization';
  end if;
  return new;
end;
$$;

comment on function ouroboros.resolution_snapshot_run_in_organization() is
  'Refuses a resolution snapshot whose run_id belongs to a different organization than its organization_id (#582), on runs_repo_in_organization()''s precedent. A run that does not exist at all is left to resolution_snapshots_run_fk, which is the rule about that.';

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table ouroboros.resolution_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,
  run_id          uuid        not null,
  shape_version   integer     not null default 1,
  task_kind       text        not null,
  route_tag       text        not null,
  outcome         text        not null,
  duration_ms     integer,
  chain           jsonb       not null,
  rules           jsonb       not null default '[]'::jsonb,
  resolved_at     timestamptz not null default now(),
  constraint resolution_snapshots_run_fk
    foreign key (run_id) references ouroboros.runs (id) on delete cascade,
  constraint resolution_snapshots_shape_version_known
    check (shape_version = 1),
  constraint resolution_snapshots_task_kind_shape
    check (task_kind ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(task_kind) <= 64),
  constraint resolution_snapshots_route_tag_shape
    check (route_tag ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(route_tag) <= 64),
  constraint resolution_snapshots_outcome
    check (outcome in ('resolved', 'fail_run')),
  constraint resolution_snapshots_duration_nonnegative
    check (duration_ms is null or duration_ms >= 0),
  constraint resolution_snapshots_chain_shape
    check (ouroboros.resolution_snapshot_chain_valid(chain)),
  constraint resolution_snapshots_rules_shape
    check (ouroboros.resolution_snapshot_rules_valid(rules)),
  -- Guarded on the chain being well-formed, so a malformed document is refused by the shape
  -- rule alone rather than by whichever of two CHECKs PostgreSQL happens to evaluate first.
  constraint resolution_snapshots_outcome_coherent
    check (not ouroboros.resolution_snapshot_chain_valid(chain)
           or ((outcome = 'resolved') = (ouroboros.resolution_snapshot_kept_hops(chain) > 0)))
);

comment on table ouroboros.resolution_snapshots is
  'What a run''s routing resolution decided, kept (#582, decision R9) — the stored truth behind mockup 21''s RESOLUTION CHAIN card and the run console''s transcript, in the versioned shape CH.6 (#589) contracts and AF.2 (#235) writes at execution time. One row per resolution: the run, the task kind and route it answered for, the chain hop by hop with the provider as the health snapshot then saw it, the masked key suffix, the rules evaluated, and the timings. Append-only; the chain names things rather than referencing them, so a snapshot outlives every alias and rule it mentions; the run is the one foreign key, because a transcript of a deleted run is a transcript of nothing. No read path lives here — the endpoint is #589''s.';
comment on column ouroboros.resolution_snapshots.organization_id is
  'The workspace, and the leading column of the latest-first read. ON DELETE CASCADE, and what resolution_snapshots_run_in_organization holds the run to, so a snapshot cannot be filed under one workspace about another''s run.';
comment on column ouroboros.resolution_snapshots.run_id is
  'The run this resolution served — runs.id, cascading with it through resolution_snapshots_run_fk and held to organization_id by resolution_snapshots_run_in_organization. The card''s "run #482" is that row''s issue_number. Not nullable: a resolution with no run is a simulation, which decision R9 renders as one and never stores as this.';
comment on column ouroboros.resolution_snapshots.shape_version is
  'Which version of the snapshot shape chain and rules are written in; 1 is V024''s. A reader pins it and a writer states it. resolution_snapshots_shape_version_known admits exactly the versions this schema''s validators can read, so a writer ahead of the schema is refused rather than stored unreadably; widening it is a migration that replaces the validators beside it.';
comment on column ouroboros.resolution_snapshots.task_kind is
  'The task kind resolved for — task_kinds.name as it read, plain text with no foreign key, for the ledger''s reason (V020, decision F8): a transcript must survive the kind being renamed or retired. Shaped as the name is, so a typo cannot be mistaken for a kind.';
comment on column ouroboros.resolution_snapshots.route_tag is
  'The route that answered — routes.tag as it read, the card''s "route implement-primary". A name rather than a reference, like task_kind and for the same reason.';
comment on column ouroboros.resolution_snapshots.outcome is
  'resolved | fail_run — Z.1''s ResolutionOutcome. Held to the chain by resolution_snapshots_outcome_coherent: resolved exactly when some hop was kept, which is the rule resolve() decides it by.';
comment on column ouroboros.resolution_snapshots.duration_ms is
  'How long the whole resolution took, in whole milliseconds — the card''s "· 42ms". Null is nobody timed it, and is what the card then omits; never defaulted to 0, which is a measurement of an excellent resolution (decision M8, V020''s rule).';
comment on column ouroboros.resolution_snapshots.chain is
  'The chain, hop by hop, in the shape resolution_snapshot_chain_valid() holds it to: index, alias, model_id, params, the provider as the health snapshot then saw it (kind, display_name, status, latency_ms, detail) with its masked key_suffix, the decision, Z.1''s code and sentence, and duration_ms on the hop that was tried. Names, never ids. Indexed with jsonb_path_ops for the one read the chain card makes — chain @> ''[{"alias": "coder-max"}]''.';
comment on column ouroboros.resolution_snapshots.rules is
  'Every escalation rule the resolution evaluated, with whether it applied — Z.1''s AppliedRule list in the database''s spellings, held by resolution_snapshot_rules_valid(). Empty when the workspace had no rules to evaluate; a list of applied = false entries when it had rules and none matched, which is the ordinary run.';
comment on column ouroboros.resolution_snapshots.resolved_at is
  'When the resolution was made. There is no updated_at: a snapshot is an event, and resolution_snapshots_no_update makes that structural.';
comment on constraint resolution_snapshots_run_fk on ouroboros.resolution_snapshots is
  'A snapshot belongs to a run, and goes with it (#582): cascading, because a transcript of a deleted run is a transcript of nothing. That the run is in the snapshot''s own workspace is resolution_snapshots_run_in_organization''s rule, kept out of this key so runs carries no second index for it.';
comment on constraint resolution_snapshots_chain_shape on ouroboros.resolution_snapshots is
  'The chain''s grammar (#582, shape version 1), through ouroboros.resolution_snapshot_chain_valid(). A jsonb column with no shape rule holds four shapes within a year, one per writer — and this one has an executor, a seed and a simulation queueing up to write it.';
comment on constraint resolution_snapshots_rules_shape on ouroboros.resolution_snapshots is
  'The rules list''s grammar (#582, shape version 1), through ouroboros.resolution_snapshot_rules_valid().';
comment on constraint resolution_snapshots_outcome_coherent on ouroboros.resolution_snapshots is
  'outcome agrees with the chain (#582): resolved exactly when a hop was kept. Guarded on the chain being well-formed, so a malformed document is refused by resolution_snapshots_chain_shape alone.';
comment on constraint resolution_snapshots_shape_version_known on ouroboros.resolution_snapshots is
  'The shape versions this schema can read (#582) — 1, until a migration widens it together with the validators.';

-- ---------------------------------------------------------------------------
-- The three reads.
-- ---------------------------------------------------------------------------
create index resolution_snapshots_organization_resolved_at_idx
  on ouroboros.resolution_snapshots (organization_id, resolved_at desc, id desc);

comment on index ouroboros.resolution_snapshots_organization_resolved_at_idx is
  'A workspace''s resolutions, newest first (#582) — the "latest" of #589''s read endpoint, and the page of the run-console transcript. id breaks the tie so two resolutions in the same millisecond page deterministically.';

create index resolution_snapshots_run_idx
  on ouroboros.resolution_snapshots (run_id, resolved_at desc);

comment on index ouroboros.resolution_snapshots_run_idx is
  'This run''s resolutions, in order (#582) — the run console''s read, and the referencing side of resolution_snapshots_run_fk, which PostgreSQL does not create: without it every run delete scans this table to find what cascades.';

create index resolution_snapshots_chain_idx
  on ouroboros.resolution_snapshots using gin (chain jsonb_path_ops);

comment on index ouroboros.resolution_snapshots_chain_idx is
  'The chain card''s read (#582): the latest snapshot whose chain touches an alias — chain @> ''[{"alias": "coder-max"}]'' — which is the ?alias= of #589''s endpoint. jsonb_path_ops because containment is the only operator that read needs, and it is the smaller, faster index for exactly that one.';

-- ---------------------------------------------------------------------------
-- Append-only, in the database rather than in the grants.
-- ---------------------------------------------------------------------------
create function ouroboros.resolution_snapshots_refuse_update() returns trigger
language plpgsql
as $$
begin
  raise exception
    'ouroboros.resolution_snapshots is append-only: a resolution snapshot cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of snapshot %s (run %s) in organization %s',
                           old.id, old.run_id, old.organization_id),
          hint    = 'Store a new snapshot instead; nothing about a resolution that happened can change. See V024__resolution_snapshots.sql (#582).';
end;
$$;

comment on function ouroboros.resolution_snapshots_refuse_update() is
  'Refuses every UPDATE on resolution_snapshots (#582), for any role including the owner — V022''s argument, without V022''s exception, because both of this table''s foreign keys cascade and no statement in the schema therefore ever needs to revise a row here.';

create trigger resolution_snapshots_run_in_organization
  before insert on ouroboros.resolution_snapshots
  for each row execute function ouroboros.resolution_snapshot_run_in_organization();

comment on trigger resolution_snapshots_run_in_organization on ouroboros.resolution_snapshots is
  'A snapshot''s run is in the snapshot''s workspace (#582). Insert only: an update is refused outright by resolution_snapshots_no_update, so there is no second statement for this rule to watch.';

create trigger resolution_snapshots_no_update
  before update on ouroboros.resolution_snapshots
  for each row execute function ouroboros.resolution_snapshots_refuse_update();

comment on trigger resolution_snapshots_no_update on ouroboros.resolution_snapshots is
  'A resolution snapshot cannot be revised (#582). No delete counterpart, for V022''s reason: organization_id and run_id both cascade, and a delete-refusing trigger would not protect the transcript — it would make removing a run or a workspace fail.';
