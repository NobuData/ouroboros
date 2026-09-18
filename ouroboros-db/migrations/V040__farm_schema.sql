-- V040__farm_schema.sql — the build farm's relational model: pools, runners, enrollment
-- tokens, build jobs and log chunks.
--
-- AH.1 (#249) under epic #240, decisions **B3**–**B9**. Mockup 08
-- ([`docs/mockups/08-build-farm.html`](../../docs/mockups/08-build-farm.html)) is a projection of
-- these five tables: the runners table's five rows with their statuses and architectures, the
-- pools card's two pools with their executor metadata, the stat row's `23` builds today
-- (`19 clean · 3 retried · 1 failed`), the `78%` cache rate, and the live log card's streamed
-- `#479` output. Every figure that page prints is an aggregate over rows this file declares;
-- none of them is a column.
--
-- Most of what follows is ordinary. Four parts are not, and each has its own section below:
-- `runners` holds **live state**, `build_jobs.run_id` is **nullable on purpose**, the log cap is
-- enforced by a **trigger** rather than by hope, and tenancy is held by **composite foreign
-- keys** rather than by a service remembering to filter.
--
-- ---------------------------------------------------------------------------
-- `runners` is a live view, which is unusual for a table.
-- ---------------------------------------------------------------------------
--
-- Decision **B7** makes telemetry push-based: every runner heartbeats every ten seconds, and
-- each heartbeat writes `status`, `last_seen_at` and a `telemetry` snapshot. Every page load
-- reads them back. So the two access patterns that would be an afterthought on an ordinary
-- table are the design here — the **presence sweep** (which live runners have stopped
-- heartbeating?) and **queue depth** (how much work is waiting on this runner?) — and both get
-- partial indexes written for the query rather than for the column. `runners_presence_idx` is
-- the one index in this file whose shape is decided by a background job rather than by a page.
--
-- **Observation and intent are two columns, not one.** `status` is what the fleet last
-- observed: `online`, `building`, `draining`, `offline`, `removed`. `desired_state` is what an
-- operator decided: `active`, `draining`, `removed`. Conflating them is the bug this splits
-- apart — *offline* is a measurement nobody chose and *draining* is a choice nobody measured,
-- and a single column makes "drain this runner" and "this runner stopped answering" the same
-- write. Two constraints keep the pair coherent: a runner cannot *show* `draining` unless an
-- operator asked for it, and `removed` is true on both sides or on neither.
--
-- A removed runner keeps its row. Its jobs reference it, its history is what the stat row is
-- computed from, and a delete would take both. Every count of the fleet therefore excludes
-- `removed` — which is also the near miss the seed is built to catch.
--
-- ---------------------------------------------------------------------------
-- `build_jobs.run_id` is nullable, and that is the whole of decision B6.
-- ---------------------------------------------------------------------------
--
-- MVP workloads are API- and UI-submitted builds. Workflow execution (WF-T.6, #160) is v2, so
-- there is no loop to attribute a build to yet, and a farm that could only pretend to build
-- would be fiction. The column exists now, nullable, so **AJ.3 (#265) fills it in** rather than
-- migrating a live table later — and because it is a composite foreign key onto
-- `(runs.id, runs.organization_id)` with the default MATCH SIMPLE, a null `run_id` satisfies it
-- and a non-null one can only ever name a run of the job's own workspace.
--
-- Nothing in this file writes it, and neither does the seed. A seeded loop-linked job would be
-- a state the product cannot reach.
--
-- ---------------------------------------------------------------------------
-- The log cap is a trigger, because one bug must not become an outage.
-- ---------------------------------------------------------------------------
--
-- A runaway build emitting gigabytes cannot be allowed to fill the disk. Trusting the agent
-- (AG.5, #247) or the ingest path (AH.5, #253) alone leaves exactly one bug between a verbose
-- compiler and a full volume, so the cap lives with the rows: `build_log_chunk_cap()` is a
-- BEFORE INSERT trigger on `build_log_chunks` that clamps the job's stream at
-- `build_jobs.log_cap_bytes` and **records marker metadata** on the chunk it clamps.
--
-- The marker matters as much as the cap. `truncation_meta` says why the stream stops, what the
-- cap was, how much of the chunk was kept and how much of it was dropped; `build_jobs`
-- accumulates `log_dropped_bytes` across every chunk refused afterwards and stamps
-- `log_truncated_at`. Together they let AI.6 (#261) render an **explicit elision** — *"4.2 MB
-- elided: per-job log cap reached"* — instead of a log that silently stops mid-line, which is
-- the failure this ticket exists to prevent.
--
-- `byte_start` is the database's to assign, not the caller's. The trigger sets it from the
-- job's own running total, so the stream is contiguous by construction and AH.5's offset fetch
-- has an exact answer; a caller that passes a value which does not continue the stream is
-- refused rather than quietly re-based. A re-sent chunk collides on `(job_id, seq)` and writes
-- nothing, which is what makes AG.1's resume idempotent here.
--
-- ---------------------------------------------------------------------------
-- Tenancy is structural, through composite keys.
-- ---------------------------------------------------------------------------
--
-- Every table here carries `organization_id`, and every reference between them is a **composite
-- foreign key** that carries it too: a runner's pool, a token's pool, a job's pool, a job's
-- runner, a job's retry parent and a job's future run are all constrained to the referring
-- row's own workspace. So "this job ran on another tenant's runner" is not a bug a service can
-- have — it is a row PostgreSQL refuses. That is why `runner_pools`, `runners` and `build_jobs`
-- each carry a redundant-looking `unique (id, organization_id)`: it is what a composite
-- reference needs to point at.
--
-- The one reference that cannot be spelled that way is `github_repo_id`. `github_repos` hangs
-- off `github_orgs` and has no `organization_id` of its own, so the rule is a trigger —
-- `build_jobs_repo_in_organization`, V008's (#64) pattern for the same join, raising class 23
-- and naming itself so a rejected write still reports a constraint name.
--
-- ---------------------------------------------------------------------------
-- What is stored and deliberately inert.
-- ---------------------------------------------------------------------------
--
-- * **`runner_pools.autoscale_pref`** (decision **B9**) — the mockup's *"Auto-scale to cloud
--   when queue > 5"* toggle. It persists, and nothing reads it until AJ.1 (#263) makes cloud
--   runners real. Storing intent and labelling it honestly beats hiding the switch or faking it.
-- * **`runner_pool_windows`** — time-windowed pool assignment, *"forge-02 joins pool-a between
--   14:00–16:00 UTC on weekdays"*. BV.5 (#514) composes it through the farm's own APIs, so the
--   capability belongs to the farm rather than to the analyzer; dispatch honours it from AH.4
--   (#252). The schema states the shape of a window and refuses a malformed one; it does not
--   state that two windows may not overlap, which is a rule about a set of rows and is AH.4's.
-- * **`runner_pools.tags`** — queryable pool tags (`hil`), which a marketplace snippet declares
--   as `runner_tags` and #776's detail panel resolves live. Indexed with GIN, because a
--   decorative tag and a resolvable one differ by exactly that.
--
-- ---------------------------------------------------------------------------
-- What a later ticket attaches, and why nothing is reserved for it.
-- ---------------------------------------------------------------------------
--
-- `test_runs.build_job_id` (AS.1, #324) and `test_artifacts` (AT.2, #330) hang off `build_jobs`
-- — one build attempt is one job is one results tree (decision **T1**) — and CD.3's (#561)
-- infra estimator classes jobs by repository, pool, executor kind and **configuration class**.
-- That last one is why `executor`, `image` and `command` are snapshotted onto the job rather
-- than read through the pool: a pool edited after a build leaves every earlier job describing a
-- configuration it did not run under, and a similarity key computed from the pool would then
-- group builds that have nothing in common. The class is *derivable* from the snapshot; deriving
-- it is CD.3's, and so is the sample floor below which it answers `insufficient_history` rather
-- than a number.

-- ---------------------------------------------------------------------------
-- The shape validators.
--
-- Each is `immutable` and written with `jsonb_path_exists` rather than with casts, deliberately:
-- SQL does not promise the evaluation order of `and`, so a guard-then-cast expression can reach
-- the cast on a value the guard was supposed to exclude. A jsonpath filter carries the type test
-- and the range test in one term and cannot raise.
--
-- They are functions rather than inline CHECKs so the same rule can be asserted by name, dropped
-- by name in tests/verify-constraint-probes.sh, and — where two tables share a rule — written
-- once.
-- ---------------------------------------------------------------------------

-- A jsonb array of distinct, non-empty strings, bounded in length.
--   items     — the document to check
--   max_items — the most entries the array may hold
-- Returns true when `items` is such an array.
create function ouroboros.farm_text_set_valid(items jsonb, max_items integer)
returns boolean language sql immutable as $$
  select jsonb_typeof(items) = 'array'
     and jsonb_array_length(items) <= max_items
     and not jsonb_path_exists(items, '$[*] ? (@.type() != "string")')
     and not items @> '[""]'::jsonb
     and (select count(distinct value) = jsonb_array_length(items)
            from jsonb_array_elements_text(items) as value);
$$;

comment on function ouroboros.farm_text_set_valid(jsonb, integer) is
  'True when the document is a bounded jsonb array of distinct, non-empty strings (#249). Shared by runner_pools.env_allowlist and runner_pools.tags, which are both sets rather than lists: a duplicate entry in either is a writer that appended without reading, and it would render twice.';

-- The pool tag vocabulary: a slug an API can match on.
--   tags — the document to check
-- Returns true when every entry is a lowercase slug of 1–32 characters.
create function ouroboros.farm_pool_tags_valid(tags jsonb)
returns boolean language sql immutable as $$
  select ouroboros.farm_text_set_valid(tags, 32)
     and not jsonb_path_exists(tags, '$[*] ? (!(@ like_regex "^[a-z0-9][a-z0-9_-]{0,31}$"))');
$$;

comment on function ouroboros.farm_pool_tags_valid(jsonb) is
  'True when every pool tag is a lowercase slug (#249, amended for #776). A marketplace snippet declares runner_tags as a requirement and the detail panel resolves "pool tagged: hil — available" against these, so the tag a snippet writes and the tag a pool carries have to be comparable without normalisation at read time.';

-- The auto-scale preference document (decision B9) — stored, and inert until AJ.1 (#263).
--   pref — the document to check
-- Returns true when it holds only the three known keys with sane values.
create function ouroboros.farm_autoscale_pref_valid(pref jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(pref) = 'object'
     and not exists (select 1 from jsonb_object_keys(pref) as k
                      where k not in ('enabled', 'queue_threshold', 'max_runners'))
     and not jsonb_path_exists(pref, '$.enabled ? (@.type() != "boolean")')
     and not jsonb_path_exists(pref, '$.queue_threshold ? (@.type() != "number" || @ < 1)')
     and not jsonb_path_exists(pref, '$.max_runners ? (@.type() != "number" || @ < 1)');
$$;

comment on function ouroboros.farm_autoscale_pref_valid(jsonb) is
  'True when a pool''s auto-scale preference holds only enabled, queue_threshold and max_runners (#249, decision B9). Closed even though nothing reads it yet: the whole point of storing an inert preference is that AJ.1 (#263) can activate it without first discovering what shapes accumulated in the column while nobody was looking.';

-- A runner's live telemetry snapshot (decision B7) — what the CPU meter, the RAM column and
-- the queue chip are drawn from.
--   snapshot — the document to check
-- Returns true when it holds only known keys, each within the range its meter can render.
create function ouroboros.farm_telemetry_valid(snapshot jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(snapshot) = 'object'
     and not exists (select 1 from jsonb_object_keys(snapshot) as k
                      where k not in ('cpu_pct', 'ram_used_bytes', 'ram_total_bytes',
                                      'queue_depth', 'sampled_at'))
     and not jsonb_path_exists(snapshot, '$.cpu_pct ? (@.type() != "number" || @ < 0 || @ > 100)')
     and not jsonb_path_exists(snapshot, '$.ram_used_bytes ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(snapshot, '$.ram_total_bytes ? (@.type() != "number" || @ < 1)')
     and not jsonb_path_exists(snapshot, '$.queue_depth ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(snapshot, '$.sampled_at ? (@.type() != "string")')
     and not jsonb_path_exists(snapshot, '$ ? (@.ram_used_bytes > @.ram_total_bytes)');
$$;

comment on function ouroboros.farm_telemetry_valid(jsonb) is
  'True when a heartbeat snapshot holds only the five fields mockup 08''s runners table renders, each in range (#249, decision B7). cpu_pct is bounded to 0–100 and ram_used_bytes to ram_total_bytes because the table draws both as meters: a snapshot outside those bounds is a bar past the end of its track, and the agent that produced it is the thing to fix.';

-- What a runner says it can do — AG.1's `hello` capabilities, as stored.
--   caps — the document to check
-- Returns true when it is an object whose known keys carry the types AG.4 reads them as.
create function ouroboros.farm_capabilities_valid(caps jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(caps) = 'object'
     and not jsonb_path_exists(caps, '$.docker ? (@.type() != "boolean")')
     and not jsonb_path_exists(caps, '$.cpu_count ? (@.type() != "number" || @ < 1)')
     and (not caps ? 'executors' or ouroboros.farm_text_set_valid(caps -> 'executors', 8));
$$;

comment on function ouroboros.farm_capabilities_valid(jsonb) is
  'True when a runner''s reported capabilities are an object whose known keys carry usable types (#249). Open rather than closed, because the vocabulary belongs to the agent protocol (AG.1, #243) and a runner one version ahead of the control plane must still be able to enrol; what is pinned is the handful AG.4 (#246) reads for executor eligibility, since a `docker` that arrives as the string "true" would make every container pool look available.';

-- A build's ccache summary (decision B5) — null is a real answer and is not zero.
--   stats — the document to check
-- Returns true when hits and misses are both present, non-negative and not both zero.
create function ouroboros.build_ccache_stats_valid(stats jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(stats) = 'object'
     and not exists (select 1 from jsonb_object_keys(stats) as k
                      where k not in ('hits', 'misses', 'version',
                                      'size_bytes', 'max_size_bytes'))
     and stats ? 'hits'
     and stats ? 'misses'
     and not jsonb_path_exists(stats, '$.hits ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(stats, '$.misses ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(stats, '$.size_bytes ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(stats, '$.max_size_bytes ? (@.type() != "number" || @ < 0)')
     and not jsonb_path_exists(stats, '$.version ? (@.type() != "string")')
     and jsonb_path_exists(stats, '$ ? (@.hits + @.misses >= 1)');
$$;

comment on function ouroboros.build_ccache_stats_valid(jsonb) is
  'True when a job''s ccache summary carries both counters and at least one object between them (#249, decision B5). Both are required because the stat row''s rate is a weighted sum of hits over hits+misses, and a row carrying one of the two would silently bias it. A build that compiled nothing has no rate to report and carries null, which is why null is left legal and 0/0 is not: null means "not measured", and rendering it as 0% would be the product claiming a cache miss it never had.';

-- A set of ISO weekdays, for a pool-assignment window.
--   days — the document to check
-- Returns true when it is a non-empty array of distinct integers 1 (Monday) to 7 (Sunday).
create function ouroboros.farm_weekday_set_valid(days jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(days) = 'array'
     and jsonb_array_length(days) between 1 and 7
     and (select count(*) = 0 from jsonb_array_elements(days) as d
           where d not in ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb,
                           '5'::jsonb, '6'::jsonb, '7'::jsonb))
     and (select count(distinct d) = jsonb_array_length(days)
            from jsonb_array_elements(days) as d);
$$;

comment on function ouroboros.farm_weekday_set_valid(jsonb) is
  'True when a window''s weekday set is a non-empty set of ISO weekday numbers, 1 = Monday (#249, for #514). Enumerated rather than range-checked so that 1.5 and "mon" are both refused: the set is read by dispatch to decide whether a runner is in a pool right now, and a day it cannot interpret is a window that silently never opens.';

-- ---------------------------------------------------------------------------
-- runner_pools — the execution worlds a build can be sent to (decision B4).
--
-- A pool owns the executor kind and, for a container pool, the pinned image; `pool-a` and
-- `pool-b` in the mockup are different execution worlds by design rather than two labels over
-- the same machine. `max_concurrency` is per runner, not per pool — it is what a runner may run
-- at once, which is the number dispatch compares a runner's in-flight jobs against.
-- ---------------------------------------------------------------------------
create table ouroboros.runner_pools (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The name the mockup prints as a tag and the install command passes as `--pool`. Slug-shaped
  -- because it travels on a command line and in a URL.
  name            text        not null,

  -- The line under the name on the pools card — *"firmware builds"*, *"HIL & macOS jobs"*. The
  -- rest of that line (the image, and the runner count) is composed by the page from data.
  description     text,

  -- `container` | `shell` (decision B4). Snapshotted onto every job, so a pool edited later
  -- does not rewrite what earlier builds ran under.
  executor        text        not null,

  -- The pinned image, for a container pool and only for one. Mockup 08's *"zephyr-sdk 0.17
  -- image"*.
  image           text,

  -- Environment variables a submitted job may carry through to the build. An allow-list rather
  -- than a deny-list: the failure mode of forgetting an entry is a build that cannot see a
  -- variable, and the failure mode of forgetting a denial is a credential on a machine nobody
  -- here administers.
  env_allowlist   jsonb       not null default '[]'::jsonb,

  -- How many jobs one runner of this pool may run at once.
  max_concurrency integer     not null default 1,

  -- The pools card's right-hand switch. Operator intent: a disabled pool accepts no new work
  -- and keeps everything it already has.
  enabled         boolean     not null default true,

  -- Decision B9 — stored and **inert**. See this file's header.
  autoscale_pref  jsonb       not null default '{}'::jsonb,

  -- Queryable pool tags (#776). `hil` is the one the marketplace resolves against today.
  tags            jsonb       not null default '[]'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint runner_pools_organization_name_key unique (organization_id, name),

  -- What every composite reference in this file points at. See the header's tenancy section.
  constraint runner_pools_id_organization_key unique (id, organization_id),

  constraint runner_pools_name_shape
    check (name ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),

  constraint runner_pools_executor
    check (executor in ('container', 'shell')),

  -- Both directions. A container pool with no image has nothing to run a build in; a shell pool
  -- with one is a pinned image nothing will ever pull, and it would render on the card as a
  -- promise the pool does not keep.
  constraint runner_pools_image_for_container
    check ((executor = 'container') = (image is not null)),

  constraint runner_pools_env_allowlist_shape
    check (ouroboros.farm_text_set_valid(env_allowlist, 64)),

  constraint runner_pools_tags_shape
    check (ouroboros.farm_pool_tags_valid(tags)),

  constraint runner_pools_autoscale_pref_shape
    check (ouroboros.farm_autoscale_pref_valid(autoscale_pref)),

  constraint runner_pools_max_concurrency_in_range
    check (max_concurrency between 1 and 64)
);

comment on table ouroboros.runner_pools is
  'An execution world builds can be dispatched to (#249, AH.1, decision B4) — the executor kind, the pinned image for a container pool, the environment a job may carry, and how much one runner of it may run at once. Mockup 08''s POOLS card is two of these. The runner count that card prints is a count of ouroboros.runners, not a column here.';
comment on column ouroboros.runner_pools.executor is
  'container | shell (decision B4). Decides how a job of this pool is run and, with the image, what "the same build" means for CD.3''s (#561) similarity classing. Snapshotted onto every job, so editing a pool does not rewrite the past.';
comment on column ouroboros.runner_pools.image is
  'The pinned container image, for a container pool and only for one (runner_pools_image_for_container). Mockup 08 renders it in the pool meta line; AJ.5 is where a registry of them, rather than a string, is considered.';
comment on column ouroboros.runner_pools.env_allowlist is
  'Environment variable names a submitted job may pass into the build. An allow-list, because the machines this reaches are the customer''s and the cost of forgetting a denial is a secret on one of them.';
comment on column ouroboros.runner_pools.max_concurrency is
  'How many jobs one runner of this pool may run at once — per runner, not per pool. Dispatch (AH.4, #252) compares a runner''s in-flight jobs against it; the queue chip in the runners table is what is waiting behind it.';
comment on column ouroboros.runner_pools.enabled is
  'The pools card''s switch. Operator intent: a disabled pool accepts no new work and keeps what it is already running. Not a health signal and not a delete.';
comment on column ouroboros.runner_pools.autoscale_pref is
  'The mockup''s "Auto-scale to cloud when queue > 5" preference — stored, and INERT until AJ.1 (#263) makes cloud runners real (decision B9). The UI labels it as arriving with cloud runners rather than hiding it, which is why the intent is persisted and nothing reads it.';
comment on column ouroboros.runner_pools.tags is
  'Queryable pool tags, e.g. ["hil"] (#776). A marketplace snippet declares runner_tags as a requirement and its detail panel resolves that against these, live — which is the difference between "pool tagged: hil — available" being a fact and being decoration.';
comment on constraint runner_pools_image_for_container on ouroboros.runner_pools is
  'A container pool has an image and a shell pool has none — both directions (#249). Half of it prevents a pool that cannot run anything; the other half prevents a pinned image on the card that nothing will ever pull.';
comment on constraint runner_pools_id_organization_key on ouroboros.runner_pools is
  'The key every composite reference to a pool points at (#249), which is what makes "this runner belongs to another workspace''s pool" a row PostgreSQL refuses rather than a filter a service has to remember.';

create trigger runner_pools_touch_updated_at
  before update on ouroboros.runner_pools
  for each row execute function ouroboros.touch_updated_at();

-- The marketplace's live resolution of `runner_tags` (#776) — a containment lookup, so GIN.
create index runner_pools_tags_idx
  on ouroboros.runner_pools using gin (tags);

-- ---------------------------------------------------------------------------
-- runners — the fleet, and the one table in this schema that is a live view.
--
-- See the header. `status` is observed, `desired_state` is intended, and the two constraints
-- below are what keep an operator's decision from being overwritten by a measurement.
-- ---------------------------------------------------------------------------
create table ouroboros.runners (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  pool_id         uuid        not null,

  -- `forge-01`, `anvil-mac`. Unique per workspace, because it is how a person refers to a
  -- machine and how the install command names one.
  name            text        not null,

  -- The three architectures AG.6 (#248) builds the agent for. A fourth is a migration, which is
  -- the point of a CHECK rather than free text: a runner whose architecture nothing ships a
  -- binary for cannot be enrolled by accident.
  arch            text        not null,

  -- **Observed.** What the fleet last saw. `offline` is a measurement, not a decision.
  status          text        not null default 'offline',

  -- **Intended.** What an operator asked for. `draining` here is the decision behind a
  -- `draining` pill; `removed` is the guarded lifecycle action AH.6 (#254) performs.
  desired_state   text        not null default 'active',

  -- Truthful, and what *"last seen 2h ago"* is computed from. Null until the first heartbeat:
  -- an enrolled runner that has never connected has not been seen, and `now()` would be a lie
  -- the page would render as health.
  last_seen_at    timestamptz,

  -- The agent build that last connected. Null until it says. AI.2 (#257) renders an out-of-date
  -- agent from this; AH.3 (#251) refuses one below the protocol floor.
  agent_version   text,

  -- What the runner reported it can do — AG.1's `hello`. Read by AG.4 (#246) for executor
  -- eligibility.
  capabilities    jsonb       not null default '{}'::jsonb,

  -- `mtls` | `bearer_fallback` (decision B3). The fallback exists because some corporate
  -- proxies terminate client certificates, and it is recorded rather than hidden so AI.2 (#257)
  -- can surface a **visibly degraded** connection instead of a green shield over a weaker one.
  security_mode   text        not null default 'mtls',

  -- The serial of the certificate the control-plane CA issued (AH.2, #250). Present exactly
  -- when the runner is on mTLS, which is the constraint below.
  cert_serial     text,

  enrolled_at     timestamptz not null default now(),

  -- Who enrolled it. SET NULL rather than cascade: removing a person must not remove the
  -- machines they installed, and a runner enrolled by a service account has nobody to name.
  enrolled_by     text        references ouroboros."user" ("id") on delete set null,

  -- Seconds the agent has been up, as it last reported. Null when there is no live report —
  -- the mockup's offline row prints `—` rather than a number that stopped being true two hours
  -- ago.
  uptime_seconds  bigint,

  -- The live snapshot the CPU meter, RAM column and queue chip are drawn from (decision B7).
  -- Empty for a runner the fleet cannot currently vouch for: the presence sweep that flips a
  -- runner to `offline` clears it, because a stale snapshot renders exactly like a fresh one.
  telemetry       jsonb       not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint runners_organization_name_key unique (organization_id, name),
  constraint runners_id_organization_key   unique (id, organization_id),

  -- **NO ACTION rather than RESTRICT**, and the difference is load-bearing. Both refuse to
  -- delete a pool that still has runners; only NO ACTION lets the check wait until the end of
  -- the statement. Deleting a workspace cascades into `runner_pools` and into `runners` at
  -- once, in an order PostgreSQL does not promise, and RESTRICT would fail whenever the pool
  -- went first. Every `on delete` in this file that refuses is written this way for that
  -- reason.
  constraint runners_pool_fk
    foreign key (pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id) on delete no action,

  constraint runners_name_shape
    check (name ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'),

  constraint runners_arch
    check (arch in ('linux/arm64', 'linux/x86_64', 'darwin/arm64')),

  constraint runners_status
    check (status in ('online', 'building', 'draining', 'offline', 'removed')),

  constraint runners_desired_state
    check (desired_state in ('active', 'draining', 'removed')),

  -- A runner cannot *show* draining unless somebody asked for it. Without this, a heartbeat
  -- could write the pill an operator never chose, and *"who drained bigiron?"* would have no
  -- answer.
  constraint runners_draining_is_intended
    check (status <> 'draining' or desired_state = 'draining'),

  -- Removal is the one state where observation and intent must agree exactly: a removed runner
  -- that is still `active` would be dispatched to, and an `active` row that reads `removed`
  -- disappears from a fleet that still holds it.
  constraint runners_removed_is_intended
    check ((status = 'removed') = (desired_state = 'removed')),

  constraint runners_security_mode
    check (security_mode in ('mtls', 'bearer_fallback')),

  -- A certificate serial is the evidence for the mTLS claim. Both directions, so neither an
  -- mTLS runner with nothing to show nor a fallback runner carrying a serial it does not use
  -- can exist.
  constraint runners_cert_serial_with_mtls
    check ((security_mode = 'mtls') = (cert_serial is not null)),

  constraint runners_capabilities_shape
    check (ouroboros.farm_capabilities_valid(capabilities)),

  constraint runners_telemetry_shape
    check (ouroboros.farm_telemetry_valid(telemetry)),

  constraint runners_uptime_non_negative
    check (uptime_seconds is null or uptime_seconds >= 0),

  constraint runners_seen_after_enrolled
    check (last_seen_at is null or last_seen_at >= enrolled_at)
);

comment on table ouroboros.runners is
  'One machine in a workspace''s build farm (#249, AH.1) — and the one table in this schema that holds live state: a heartbeat every ten seconds writes status, last_seen_at and telemetry, and every load of mockup 08 reads them back (decision B7). Rows are never deleted; a removed runner keeps its row with status and desired_state both `removed`, because its jobs reference it and the stat row is computed from them. Every count of the fleet therefore excludes `removed`.';
comment on column ouroboros.runners.status is
  'What the fleet last OBSERVED: online | building | draining | offline | removed. Written by heartbeats and by the presence sweep, never by an operator directly. `offline` is a measurement — the answer to "has it stopped heartbeating?" — and is deliberately not the same column as desired_state, which is the answer to "did somebody switch it off?".';
comment on column ouroboros.runners.desired_state is
  'What an operator INTENDED: active | draining | removed. Written by the lifecycle actions on mockup 08''s ⋯ menu (AH.6, #254) and by nothing else. Kept apart from status because conflating an intent with a measurement makes "drain this runner" and "this runner stopped answering" the same write, and there is then no way to tell a drained machine from a dead one.';
comment on column ouroboros.runners.last_seen_at is
  'When the last heartbeat arrived. Truthful, and what mockup 08''s "last seen 2h ago" is computed from. Null until the first one: an enrolled runner that has never connected has not been seen, and defaulting to now() would render as health the product has no evidence for.';
comment on column ouroboros.runners.security_mode is
  'mtls | bearer_fallback (decision B3). Recorded rather than assumed, so AI.2 (#257) can show a connection that fell back to a bearer token as visibly degraded. A green shield over the weaker mode is the thing this column exists to prevent.';
comment on column ouroboros.runners.cert_serial is
  'The serial of the certificate the control-plane CA issued this runner (AH.2, #250), which is how a revocation names one. Present exactly when security_mode is mtls — runners_cert_serial_with_mtls.';
comment on column ouroboros.runners.telemetry is
  'The live heartbeat snapshot behind the CPU meter, the RAM column and the queue chip: cpu_pct, ram_used_bytes, ram_total_bytes, queue_depth, sampled_at (decision B7). Empty `{}` for a runner the fleet cannot vouch for — the presence sweep clears it when it flips a runner offline, because a two-hour-old snapshot renders exactly like a fresh one and the mockup''s offline row prints `—`.';
comment on column ouroboros.runners.uptime_seconds is
  'Uptime as the agent last reported it. Null when there is no live report, which is what the mockup''s offline row prints as `—`. Stored rather than derived from enrolled_at, because a restarted agent on a long-enrolled machine has an uptime of minutes and enrollment has nothing to say about it.';
comment on constraint runners_draining_is_intended on ouroboros.runners is
  'A runner cannot show `draining` unless an operator asked for it (#249). This is the constraint that makes the observed/intended split load-bearing rather than documentary: without it a heartbeat could write a pill nobody chose, and the audit question "who drained this?" would have no row to answer from.';
comment on constraint runners_removed_is_intended on ouroboros.runners is
  'Removal is intent and observation at once, or neither (#249). A removed runner that is still `active` would be dispatched to; an `active` runner rendered as removed vanishes from a fleet that still holds it.';
comment on constraint runners_cert_serial_with_mtls on ouroboros.runners is
  'The mTLS claim carries its evidence (#249, decision B3). An mtls runner with no serial is a claim nothing issued; a bearer_fallback runner with one is a serial the connection does not use, and AI.2 would then have two sources for one answer.';

create trigger runners_touch_updated_at
  before update on ouroboros.runners
  for each row execute function ouroboros.touch_updated_at();

-- **The presence sweep** (decision B7). The background job asks, every few seconds, which
-- *live* runners have stopped heartbeating — so the index is over `last_seen_at` and is partial
-- on exactly the statuses that can go offline. `offline` and `removed` rows are the bulk of an
-- old fleet and the sweep never looks at them; keeping them out of the index is what stops it
-- growing with history rather than with the fleet.
create index runners_presence_idx
  on ouroboros.runners (last_seen_at)
  where status in ('online', 'building', 'draining');

-- The runners table itself, and the pools card's per-pool count.
create index runners_pool_status_idx
  on ouroboros.runners (pool_id, status);

-- The page's own read: one workspace's fleet, in the order the table renders.
create index runners_organization_name_idx
  on ouroboros.runners (organization_id, name);

-- ---------------------------------------------------------------------------
-- enrollment_tokens — the scoped secret the install one-liner carries (decision B3).
--
-- The token itself is never stored in the clear: `token_sealed` holds one of AD.1's (#222)
-- `ouro.v1.…` envelopes and the CHECK refuses anything else, so a plaintext cannot be put here
-- by any writer — V015's and V027's posture, for their reason.
--
-- A token is spent rather than consumed once: `max_uses` and `uses` are what let one token
-- enrol a rack. `revoked` is the immediate kill, and it is separate from expiry because "this
-- leaked" and "this aged out" are different events and only one of them is an incident.
--
-- How AH.2 (#250) finds the row for a presented token is AH.2's: the envelope is not
-- searchable, so the token an agent sends carries its own row's id and the sealed value is what
-- verifies it. Nothing here needs a lookup column, and adding one for a search that does not
-- happen would be a second place for the secret to leak from.
-- ---------------------------------------------------------------------------
create table ouroboros.enrollment_tokens (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The pool a runner enrolled with this token joins. The mockup's `--pool pool-a`.
  pool_id         uuid        not null,

  token_sealed    text        not null,

  expires_at      timestamptz not null,

  max_uses        integer     not null default 1,
  uses            integer     not null default 0,

  revoked         boolean     not null default false,
  revoked_at      timestamptz,

  created_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),

  constraint enrollment_tokens_pool_fk
    foreign key (pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id) on delete cascade,

  -- **Envelope-only.** The rule is about every writer, not about the one service that is
  -- supposed to seal.
  constraint enrollment_tokens_sealed
    check (token_sealed ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  -- A TTL is a *positive* interval. A token that expired before it was minted is one nothing
  -- can use and nothing will clean up, and it is what a bad unit conversion produces.
  constraint enrollment_tokens_ttl_positive
    check (expires_at > created_at),

  constraint enrollment_tokens_max_uses_positive
    check (max_uses >= 1),

  constraint enrollment_tokens_uses_within_max
    check (uses between 0 and max_uses),

  constraint enrollment_tokens_revoked_at
    check (revoked = (revoked_at is not null))
);

comment on table ouroboros.enrollment_tokens is
  'A scoped, sealed secret the install one-liner carries so a machine can join one pool of one workspace (#249, decision B3). Minted and revoked by owners and admins through AH.2 (#250), every action audited on AD.4''s shape. The value is an AD.1 (#222) envelope and enrollment_tokens_sealed refuses any other shape, so no writer — service, seed or hand-run update — can leave a plaintext here.';
comment on column ouroboros.enrollment_tokens.token_sealed is
  'The enrollment secret, sealed by AD.1''s vault (#222) as an ouro.v1.<version>.<nonce>.<ciphertext> envelope bound to this row''s id. Never returned by any API after minting and never logged; mockup 08 renders `orb_enroll_••••` because the plaintext exists once, in the response that created it.';
comment on column ouroboros.enrollment_tokens.max_uses is
  'How many runners one token may enrol. More than one because a rack is installed with one command, not with one command per machine; bounded because an unlimited token is a password.';
comment on column ouroboros.enrollment_tokens.revoked is
  'The immediate kill. Separate from expires_at because "this leaked" and "this aged out" are different events, and only the first is an incident somebody has to be told about.';
comment on constraint enrollment_tokens_ttl_positive on ouroboros.enrollment_tokens is
  'A TTL is a positive interval (#249). A token that expired before it was minted is unusable and uncollectable, and it is exactly what a seconds-for-milliseconds slip produces.';
comment on constraint enrollment_tokens_sealed on ouroboros.enrollment_tokens is
  'The token is one of the vault''s envelopes, always (#249) — V015''s and V027''s posture, for their reason: this is a rule about every writer rather than about the one service that is supposed to seal. It also means AD.1''s adoption path has nothing to do on this table, because a row holding an unsealed token cannot exist.';

-- The mint/revoke panel's read, and the expiry sweep's: this workspace's tokens that are still
-- worth anything, soonest to expire.
create index enrollment_tokens_live_idx
  on ouroboros.enrollment_tokens (organization_id, expires_at)
  where not revoked;

create index enrollment_tokens_pool_idx
  on ouroboros.enrollment_tokens (pool_id);

-- ---------------------------------------------------------------------------
-- runner_pool_windows — time-windowed pool assignment (#514, BV.5).
--
-- *"forge-02 joins pool-a between 14:00–16:00 UTC on weekdays"* is the Build Analyzer's
-- pool-move suggestion, applied. The analyzer never writes farm tables; it composes this
-- through the farm's own APIs, which is why the capability lives here.
--
-- What the schema states is the shape of one window: a non-empty set of ISO weekdays and a
-- time range inside a single UTC day. What it deliberately does **not** state is that two
-- windows may not overlap — that is a rule about a *set* of rows under a moving clock, and
-- dispatch (AH.4, #252) is what resolves a runner's effective pool at an instant. A constraint
-- that could only half-express it would read like a guarantee nothing keeps.
-- ---------------------------------------------------------------------------
create table ouroboros.runner_pool_windows (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  runner_id       uuid        not null,
  pool_id         uuid        not null,

  -- ISO weekday numbers, 1 = Monday. `[1,2,3,4,5]` is the mockup sentence's *"on weekdays"*.
  days_of_week    jsonb       not null,

  -- UTC, always. A window stored in a workspace's local time moves twice a year, and a build
  -- farm that changes shape at a daylight-saving boundary is a support ticket nobody can read.
  starts_at       time        not null,
  ends_at         time        not null,

  enabled         boolean     not null default true,

  created_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),

  constraint runner_pool_windows_runner_fk
    foreign key (runner_id, organization_id)
    references ouroboros.runners (id, organization_id) on delete cascade,

  constraint runner_pool_windows_pool_fk
    foreign key (pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id) on delete cascade,

  constraint runner_pool_windows_unique
    unique (runner_id, pool_id, starts_at, ends_at),

  constraint runner_pool_windows_days_shape
    check (ouroboros.farm_weekday_set_valid(days_of_week)),

  -- Inside one day. A window that wrapped midnight would be two windows wearing one row, and
  -- every reader would have to know that; splitting it is the writer's job.
  constraint runner_pool_windows_ordered
    check (ends_at > starts_at)
);

comment on table ouroboros.runner_pool_windows is
  'A time-windowed pool assignment (#249, for #514/BV.5): "forge-02 joins pool-a between 14:00-16:00 UTC on weekdays". The Build Analyzer suggests these and composes them through the farm''s APIs — it never writes farm tables — so the capability belongs to the farm. Declared here and honoured by dispatch from AH.4 (#252); a runner with no window is simply in its own pool all the time.';
comment on column ouroboros.runner_pool_windows.days_of_week is
  'ISO weekday numbers the window applies on, 1 = Monday. [1,2,3,4,5] is "on weekdays". A set rather than a bitmask so the row reads as the sentence it came from.';
comment on column ouroboros.runner_pool_windows.starts_at is
  'The window''s opening time, in UTC and only in UTC. A window stored in local time changes twice a year, and a farm that quietly reshapes itself at a daylight-saving boundary is the hardest kind of incident to read.';
comment on constraint runner_pool_windows_ordered on ouroboros.runner_pool_windows is
  'A window lies inside one day (#249). A row that wrapped midnight would be two windows in one, and every reader of the table would have to know it; splitting it is the writer''s job and this is what asks for that.';

create index runner_pool_windows_runner_idx
  on ouroboros.runner_pool_windows (runner_id)
  where enabled;

-- ---------------------------------------------------------------------------
-- The key AJ.3's linkage will point at.
--
-- `build_jobs.run_id` is a composite foreign key onto `(runs.id, runs.organization_id)`, which
-- needs a unique key over that pair to reference. `runs.id` is already unique on its own, so
-- this adds no guarantee about runs — what it adds is the ability to say, in the schema rather
-- than in a service, that a build job and the run it belongs to are the same workspace's.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add constraint runs_id_organization_key unique ("id", organization_id);

comment on constraint runs_id_organization_key on ouroboros.runs is
  'What build_jobs.run_id references, with organization_id beside it (#249, decision B6). It constrains nothing about runs — id is already unique — and everything about the rows that point here: a build job can only ever name a run of its own workspace, and AJ.3 (#265) inherits that rather than having to remember it.';

-- ---------------------------------------------------------------------------
-- build_jobs — one build attempt.
--
-- `number` is a job's public name. Until AJ.3 (#265) links runs, a job has no other one: a
-- build submitted from the API belongs to no loop, and the runners table still has to print
-- something in its *Current job* column. It is per workspace and assigned at submission, which
-- is what makes `#479` in mockup 08 a link rather than a label.
--
-- The executor, image and command are **snapshots**. A pool edited after a build ran must not
-- rewrite what that build ran under — and CD.3's (#561) similarity classing reads exactly
-- those three plus the repository and the pool, so a snapshot is also what keeps its estimate
-- honest.
-- ---------------------------------------------------------------------------
create table ouroboros.build_jobs (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The job's public name, per workspace. Mockup 08's `#479` and `#472`.
  number           integer     not null,

  pool_id          uuid        not null,

  -- Null until dispatch assigns it, and it stays set afterwards — including once the job is
  -- finished, because *"what has this runner built today"* is a question the health history
  -- answers from these rows.
  runner_id        uuid,

  -- **NULLABLE, on purpose** — decision B6. The loop linkage AJ.3 (#265) fills in. Composite
  -- with organization_id and MATCH SIMPLE, so null satisfies it and a non-null value can only
  -- ever name a run of this job's own workspace. See this file's header.
  run_id           uuid,

  -- What was built. The repository is the mirror V003/V014 keep; the git ref and sha are the
  -- commit the build is of, which is also how #328's seeds line up with this one.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete no action,
  git_ref          text        not null,
  commit_sha       text,

  -- The short label the runners table prints beside the number — *"zephyr build"*, *"HIL test
  -- rig"* — and the one-line description the live log card's head carries.
  label            text        not null,
  title            text        not null,

  -- The pool configuration this attempt actually ran under. Snapshots. See above.
  executor         text        not null,
  image            text,
  command          text        not null,
  env              jsonb       not null default '{}'::jsonb,

  status           text        not null default 'queued',

  queued_at        timestamptz not null default now(),
  offered_at       timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,

  exit_code        integer,

  -- Null is a real answer and is not zero (decision B5). See build_ccache_stats_valid.
  ccache_stats     jsonb,

  -- The attempt this one replaces. The earlier row keeps status `retried`, which is what the
  -- stat row's `3 retried` counts; this row is an ordinary attempt and lands in `19 clean` if
  -- it works.
  retry_of         uuid,

  -- The log accounting the cap trigger maintains. See build_log_chunk_cap().
  log_bytes        bigint      not null default 0,
  log_dropped_bytes bigint     not null default 0,
  log_cap_bytes    bigint      not null default 67108864,
  log_truncated_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint build_jobs_organization_number_key unique (organization_id, number),
  constraint build_jobs_id_organization_key     unique (id, organization_id),

  -- Both refuse, and both are NO ACTION for `runners_pool_fk`'s reason: a workspace's deletion
  -- reaches the pool, the runner and the job in an unspecified order, and a check that cannot
  -- wait for the end of the statement turns that into an intermittent failure.
  constraint build_jobs_pool_fk
    foreign key (pool_id, organization_id)
    references ouroboros.runner_pools (id, organization_id) on delete no action,

  constraint build_jobs_runner_fk
    foreign key (runner_id, organization_id)
    references ouroboros.runners (id, organization_id) on delete no action,

  constraint build_jobs_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete set null,

  constraint build_jobs_retry_of_fk
    foreign key (retry_of, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete set null,

  constraint build_jobs_number_positive
    check (number >= 1),

  constraint build_jobs_status
    check (status in ('queued', 'offered', 'running',
                      'succeeded', 'failed', 'retried', 'canceled')),

  constraint build_jobs_executor
    check (executor in ('container', 'shell')),

  constraint build_jobs_image_for_container
    check ((executor = 'container') = (image is not null)),

  constraint build_jobs_env_object
    check (jsonb_typeof(env) = 'object'),

  -- A job has a finish time exactly when it has stopped. The four terminal states are what the
  -- stat row partitions today's builds by, and a `succeeded` row with no finish time is a build
  -- that contributes to `23 builds today` without contributing to `4m 12s`.
  constraint build_jobs_finished_when_terminal
    check ((status in ('succeeded', 'failed', 'retried', 'canceled'))
           = (finished_at is not null)),

  -- Every state past `offered` has a start, except a cancellation — which can land on a job
  -- that never ran.
  constraint build_jobs_started_when_run
    check (started_at is not null or status in ('queued', 'offered', 'canceled')),

  -- Offered, running and finished jobs are on a runner. A queued one may or may not be: the
  -- mockup's `q:2` is work already assigned to forge-01 and waiting behind its current build.
  constraint build_jobs_runner_when_dispatched
    check (runner_id is not null or status in ('queued', 'canceled')),

  constraint build_jobs_offered_after_queued
    check (offered_at is null or offered_at >= queued_at),
  constraint build_jobs_started_after_offered
    check (started_at is null or started_at >= coalesce(offered_at, queued_at)),
  constraint build_jobs_finished_after_started
    check (finished_at is null or started_at is null or finished_at >= started_at),

  constraint build_jobs_exit_code_when_finished
    check (exit_code is null or finished_at is not null),

  -- A success is exit 0, and a failure is not. A `succeeded` row carrying 1 is a build the
  -- product called clean and the compiler did not.
  constraint build_jobs_success_is_exit_zero
    check (status <> 'succeeded' or exit_code = 0),
  constraint build_jobs_failure_is_not_exit_zero
    check (status <> 'failed' or exit_code is null or exit_code <> 0),

  constraint build_jobs_ccache_stats_shape
    check (ccache_stats is null or ouroboros.build_ccache_stats_valid(ccache_stats)),

  constraint build_jobs_retry_not_self
    check (retry_of is null or retry_of <> id),

  -- The cap is bounded by the schema, not by the writer. A per-job cap is useful — a release
  -- build legitimately says more than a unit-test run — but a writer able to set it to a
  -- terabyte is a writer able to undo the whole point of the trigger.
  constraint build_jobs_log_cap_in_range
    check (log_cap_bytes between 65536 and 268435456),

  constraint build_jobs_log_bytes_within_cap
    check (log_bytes between 0 and log_cap_bytes),

  constraint build_jobs_log_dropped_non_negative
    check (log_dropped_bytes >= 0),

  -- The elision has a time exactly when there is something elided.
  constraint build_jobs_log_truncated_at_when_dropped
    check ((log_dropped_bytes > 0) = (log_truncated_at is not null))
);

comment on table ouroboros.build_jobs is
  'One build attempt (#249, AH.1) — what was built, in which pool, on which runner, how it ended, and what its log cost. Mockup 08''s stat row is four aggregates over these rows and stores none of them: 23 builds today is a count, 19/3/1 is that count partitioned by status, 4m 12s is a mean of finished_at - started_at, and 78% is a weighted sum over ccache_stats. run_id is nullable because MVP builds are API- and UI-submitted (decision B6); AJ.3 (#265) is what fills it in.';
comment on column ouroboros.build_jobs.number is
  'The job''s public name within its workspace — mockup 08''s #479 and #472. A job needs one of its own because until AJ.3 (#265) links runs there is nothing else to call it: an API-submitted build belongs to no loop, and the runners table still has to print something in Current job.';
comment on column ouroboros.build_jobs.run_id is
  'The loop run this build belongs to — NULLABLE, and null throughout the MVP (decision B6). Workflow execution is v2, so nothing here can honestly be attributed to a loop yet; the column exists now so AJ.3 (#265) fills it in rather than migrating a live table later. Composite with organization_id, so a non-null value can only name a run of this job''s own workspace.';
comment on column ouroboros.build_jobs.runner_id is
  'The runner this attempt was dispatched to. Null until assigned, and retained afterwards — "what has this machine built today" is answered from these rows, and clearing it on completion would make the health history unanswerable.';
comment on column ouroboros.build_jobs.executor is
  'The executor this attempt actually ran under — a snapshot of the pool''s, not a read through it. A pool edited after a build must not rewrite what that build ran under, and CD.3''s (#561) similarity classing reads this with image, command, repository and pool as its key: grouping by the pool''s current configuration would group builds that have nothing in common.';
comment on column ouroboros.build_jobs.ccache_stats is
  'The ccache summary the agent parsed (AG.5, #247), or null. Null is a real answer and is NOT zero (decision B5): a shell job with no cache, or a build that died before the summary, has no rate to report, and rendering that as 0% would be the product claiming a miss it never measured. The stat row''s weighted rate sums hits and misses across the rows that have them.';
comment on column ouroboros.build_jobs.retry_of is
  'The attempt this one replaces. The earlier row keeps status `retried`, which is what mockup 08''s "3 retried" counts; this row is an ordinary attempt and joins "19 clean" if it succeeds. So the three numbers partition the day''s jobs rather than double-counting the retried ones.';
comment on column ouroboros.build_jobs.log_cap_bytes is
  'How many bytes of log this job may store. Enforced by build_log_chunk_cap(), bounded by build_jobs_log_cap_in_range: per-job because a release build legitimately says more than a unit-test run, bounded because a writer that could set it to a terabyte could undo the cap entirely.';
comment on column ouroboros.build_jobs.log_dropped_bytes is
  'How many bytes the cap refused, across every chunk. What lets AI.6 (#261) render "4.2 MB elided" instead of a log that stops mid-line — the chunk at the boundary carries the marker, and this carries the total, because every chunk after it is dropped without a row to hold one.';
comment on constraint build_jobs_finished_when_terminal on ouroboros.build_jobs is
  'A job has a finish time exactly when it has stopped (#249). Both halves matter to the stat row: a terminal job with no finish time counts in "builds today" and not in the average, and a running job with one counts in both.';
comment on constraint build_jobs_success_is_exit_zero on ouroboros.build_jobs is
  'A success is exit 0 (#249). A succeeded row carrying a non-zero code is a build the product called clean and the compiler did not, and it would land in "19 clean" on mockup 08 and in a green check on mockup 12.';
comment on constraint build_jobs_log_cap_in_range on ouroboros.build_jobs is
  'The per-job log cap lies between 64 KiB and 256 MiB (#249). The ceiling is the part that matters: the cap exists so one runaway build cannot fill the volume, and a cap the writer chooses without bound is not a cap.';

create trigger build_jobs_touch_updated_at
  before update on ouroboros.build_jobs
  for each row execute function ouroboros.touch_updated_at();

-- The repository belongs to the job's workspace.
--
-- V008's (#64) rule for the same join, and a trigger for its reason: `github_repos` hangs off
-- `github_orgs` and carries no `organization_id`, so there is no composite key to point a
-- foreign key at. It raises class 23 naming itself, so a rejected write still reports a
-- constraint name and reads like every other refusal in this schema.
create function ouroboros.build_jobs_repo_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  select o.organization_id into owner
    from ouroboros.github_repos r
    join ouroboros.github_orgs  o on o.id = r.org_id
   where r.id = new.github_repo_id;

  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      'build job repository % belongs to organization %, not %',
      new.github_repo_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = 'build_jobs_repo_in_organization';
  end if;

  return new;
end;
$$;

comment on function ouroboros.build_jobs_repo_in_organization() is
  'Refuses a build job whose repository belongs to another workspace (#249) — V008''s rule for the same join. A trigger rather than a foreign key because github_repos reaches its organization through github_orgs and has no organization_id for a composite key to carry. Every other cross-table rule in this schema is declarative; this is the one that cannot be.';

create trigger build_jobs_repo_in_organization
  before insert or update of github_repo_id, organization_id on ouroboros.build_jobs
  for each row execute function ouroboros.build_jobs_repo_in_organization();

-- **Queue depth, per runner.** The mockup's `q:2`, and what dispatch compares against a pool's
-- max_concurrency. Partial on the two waiting states, so the index holds the queue rather than
-- the history.
create index build_jobs_runner_queue_idx
  on ouroboros.build_jobs (runner_id, queued_at)
  where status in ('queued', 'offered');

-- The same question of a pool, which is what an unassigned queue looks like and what AJ.1's
-- auto-scale threshold would read.
create index build_jobs_pool_queue_idx
  on ouroboros.build_jobs (pool_id, queued_at)
  where status in ('queued', 'offered');

-- **The stat row's time windows.** `23 builds today`, the 19/3/1 split and both sides of
-- `4m 12s ▼ 38s` are one scan of this index per window.
create index build_jobs_organization_finished_idx
  on ouroboros.build_jobs (organization_id, finished_at desc)
  where finished_at is not null;

-- The runners table's *Current job* column: the one live job on each runner.
create index build_jobs_runner_active_idx
  on ouroboros.build_jobs (runner_id)
  where status = 'running';

-- AJ.3's linkage, once it exists, and the retry chain the stat row's `3 retried` walks.
create index build_jobs_run_id_idx
  on ouroboros.build_jobs (run_id)
  where run_id is not null;

create index build_jobs_retry_of_idx
  on ouroboros.build_jobs (retry_of)
  where retry_of is not null;

-- ---------------------------------------------------------------------------
-- build_log_chunks — the streamed log, with the cap that keeps it bounded.
--
-- Chunks arrive over the agent channel (decision B8), land here, and are read back by offset
-- (AH.5, #253). `seq` is the agent's ordering and the idempotency key a re-send collides on;
-- `byte_start` is the database's, assigned by the cap trigger from the job's own running total
-- so the stream is contiguous by construction.
-- ---------------------------------------------------------------------------
create table ouroboros.build_log_chunks (
  id              uuid        primary key default gen_random_uuid(),

  job_id          uuid        not null
                              references ouroboros.build_jobs (id) on delete cascade,

  -- The agent's ordering. A re-sent chunk repeats it, collides on the unique key below, and
  -- writes nothing — which is what makes AG.1's resume cost a round trip rather than a
  -- duplicated log.
  seq             integer     not null,

  -- The offset of this chunk's first byte in the job's stream. Assigned by the trigger; a
  -- caller that passes a value which does not continue the stream is refused.
  byte_start      bigint      not null,

  content         bytea       not null,

  -- Null on an ordinary chunk. On the chunk the cap clamped, the elision marker the UI renders.
  truncation_meta jsonb,

  received_at     timestamptz not null default now(),

  -- Retention metadata. The sweep deletes by this, which is why it is a column rather than an
  -- interval applied to received_at at read time: a retention policy that changes must not
  -- retroactively delete what was written under the old one.
  retain_until    timestamptz not null default now() + interval '30 days',

  constraint build_log_chunks_job_seq_key        unique (job_id, seq),
  constraint build_log_chunks_job_byte_start_key unique (job_id, byte_start),

  constraint build_log_chunks_seq_non_negative
    check (seq >= 0),
  constraint build_log_chunks_byte_start_non_negative
    check (byte_start >= 0),

  -- An empty chunk is a write that says nothing and still costs a row, an index entry and a
  -- sequence number the reader has to skip.
  constraint build_log_chunks_content_non_empty
    check (octet_length(content) >= 1),

  constraint build_log_chunks_retain_after_received
    check (retain_until > received_at),

  -- The marker's shape, so the UI can render it without guessing. Written only by the trigger.
  constraint build_log_chunks_truncation_meta_shape
    check (truncation_meta is null
           or (jsonb_typeof(truncation_meta) = 'object'
               and truncation_meta ->> 'reason' = 'per_job_cap'
               and truncation_meta ? 'cap_bytes'
               and truncation_meta ? 'kept_bytes'
               and truncation_meta ? 'dropped_bytes'
               and truncation_meta ? 'truncated_at'))
);

comment on table ouroboros.build_log_chunks is
  'A build''s log, in the chunks it was streamed as (#249, decision B8). Ordered by seq, which is also the idempotency key a re-sent chunk collides on; addressed by byte_start, which the cap trigger assigns so AH.5''s (#253) offset fetch has an exact answer. Capped per job by build_log_chunk_cap(), which records an elision marker rather than letting a log stop mid-line.';
comment on column ouroboros.build_log_chunks.byte_start is
  'The offset of this chunk''s first byte in the job''s stream. The database''s to assign, not the caller''s: build_log_chunk_cap() takes it from build_jobs.log_bytes, so the stream is contiguous by construction, and a caller that passes a value which does not continue it is refused rather than quietly re-based.';
comment on column ouroboros.build_log_chunks.truncation_meta is
  'The elision marker, on the one chunk the per-job cap clamped — reason, the cap, how much of that chunk was kept and how much was dropped, and when. Null on every ordinary chunk. Written by the trigger and by nothing else: a caller-supplied marker would be the product describing an elision that did not happen.';
comment on column ouroboros.build_log_chunks.retain_until is
  'When the retention sweep may delete this chunk. A column rather than an interval applied to received_at at read time, so a retention policy that changes later does not retroactively delete logs written under the old one.';
comment on constraint build_log_chunks_job_seq_key on ouroboros.build_log_chunks is
  'One chunk per sequence number per job (#249). This is what makes AG.1''s resume idempotent here: a terminal frame re-sent to a dying socket repeats its seq, collides, and writes nothing — so recovery costs a round trip rather than a duplicated log.';

-- The reader's index: a job's chunks, in order, from an offset. `(job_id, seq)`'s unique index
-- already serves it, and `(job_id, byte_start)`'s serves the offset fetch — both are declared
-- above as constraints, which is where the guarantee belongs.
--
-- The sweep's index is the one that has nothing to stand on otherwise.
create index build_log_chunks_retain_until_idx
  on ouroboros.build_log_chunks (retain_until);

-- ---------------------------------------------------------------------------
-- The per-job byte cap.
--
-- The rule this ticket exists for. A runaway build emitting gigabytes must not fill the disk,
-- and trusting the agent or the ingest path leaves one bug between a verbose compiler and an
-- outage — so the cap is enforced where the bytes land.
--
-- Three things happen here, in order:
--
--   1. **The job row is locked.** `log_bytes` is a running total read and written by every
--      chunk; without the lock two concurrent writers both read the same total and the cap
--      admits twice what it allows. One runner owns a job, so the lock is almost never
--      contended — it is there for the almost.
--   2. **`byte_start` is assigned** from that total, or checked against it. A caller that
--      passes an offset which does not continue the stream is refused, because a gap or an
--      overlap in an offset-addressed log is a reader that silently returns the wrong bytes.
--   3. **The cap is applied.** Under it, the chunk is written whole. Across it, the chunk is
--      clamped to what is left and carries the marker. Past it, the chunk is dropped entirely
--      and only the job's dropped-byte total moves — there is no row to put a second marker on,
--      which is exactly why the total lives on the job.
--
-- Returning `null` from a BEFORE INSERT trigger is how the third case skips the row without
-- raising: an ingest path that had to handle an exception per chunk after the cap would spend
-- its time on the one build that has already been told to be quiet.
-- ---------------------------------------------------------------------------
create function ouroboros.build_log_chunk_cap()
returns trigger language plpgsql as $$
declare
  cap       bigint;
  written   bigint;
  allowance bigint;
  incoming  bigint;
begin
  if new.truncation_meta is not null then
    raise exception
      'build_log_chunks.truncation_meta is written by the cap trigger, not by the caller'
      using errcode = 'check_violation',
            constraint = 'build_log_chunks_truncation_meta_is_the_database_s';
  end if;

  select j.log_cap_bytes, j.log_bytes
    into cap, written
    from ouroboros.build_jobs j
   where j.id = new.job_id
     for update;

  -- No such job. The foreign key is the right thing to report that, and it is about to.
  if cap is null then
    return new;
  end if;

  incoming  := octet_length(new.content);
  allowance := cap - written;

  -- Past the cap: no row, and the bytes are counted as dropped.
  if allowance <= 0 then
    update ouroboros.build_jobs
       set log_dropped_bytes = log_dropped_bytes + incoming,
           log_truncated_at  = coalesce(log_truncated_at, now())
     where id = new.job_id;
    return null;
  end if;

  if new.byte_start is null then
    new.byte_start := written;
  elsif new.byte_start <> written then
    raise exception
      'build_log_chunks.byte_start % does not continue job %''s stream, which stands at %',
      new.byte_start, new.job_id, written
      using errcode = 'check_violation',
            constraint = 'build_log_chunks_byte_start_continuous';
  end if;

  -- Across the cap: clamp, and record the elision where the UI will read it.
  if incoming > allowance then
    new.content := substring(new.content from 1 for allowance::integer);
    new.truncation_meta := jsonb_build_object(
      'reason',        'per_job_cap',
      'cap_bytes',     cap,
      'kept_bytes',    allowance,
      'dropped_bytes', incoming - allowance,
      'truncated_at',  to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

    update ouroboros.build_jobs
       set log_bytes         = cap,
           log_dropped_bytes = log_dropped_bytes + (incoming - allowance),
           log_truncated_at  = coalesce(log_truncated_at, now())
     where id = new.job_id;

    return new;
  end if;

  -- Under the cap: the ordinary path.
  update ouroboros.build_jobs
     set log_bytes = written + incoming
   where id = new.job_id;

  return new;
end;
$$;

comment on function ouroboros.build_log_chunk_cap() is
  'The per-job log cap (#249), enforced where the bytes land. Locks the job row, assigns byte_start from its running total (or refuses an offset that does not continue the stream), then writes the chunk whole, clamped with an elision marker, or not at all. Trusting the agent (AG.5, #247) or the ingest path (AH.5, #253) alone would leave exactly one bug between a verbose compiler and a full volume; this leaves none. The marker and build_jobs.log_dropped_bytes together are what let AI.6 (#261) render an explicit elision rather than a log that stops mid-line.';

create trigger build_log_chunks_cap
  before insert on ouroboros.build_log_chunks
  for each row execute function ouroboros.build_log_chunk_cap();
