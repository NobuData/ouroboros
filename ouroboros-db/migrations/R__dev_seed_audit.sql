-- R__dev_seed_audit.sql — the credential trail mockup 07's **Audit log** button opens, in a
-- development database and nowhere else.
--
-- The fifth development seed. R__dev_seed.sql (#23) is *who exists*,
-- R__dev_seed_dashboard.sql (#68) is *what the loop has done*, R__dev_seed_providers.sql
-- (#221) is *what the loop is allowed to call*, R__dev_seed_routing.sql (#192) is *where the
-- calls go* — and this is **who touched the keys**. All of it belongs to `acme-robotics`,
-- which is the workspace every mockup is drawn in.
--
-- Filed as issue #225 (AD.4). The schema it fills is V022.
--
-- It **cannot run in production** (every statement ends `and ${ouro_dev_seed}`, which is
-- `false` in flyway.toml), it is **idempotent** (every id is a literal and every statement
-- ends `on conflict do nothing`), and it **never fails on a database somebody has edited**
-- (the workspace is found by slug and each person by email). The long form of all three is
-- in R__dev_seed.sql's header.
--
-- Ids are `5eed0015-0000-4000-8000-` + the ordinal below, continuing the convention listed
-- in R__dev_seed.sql's table: an id beginning `5eed` came from a seed.
--
-- ---------------------------------------------------------------------------
-- Why this file names connection ids as literals rather than joining for them.
-- ---------------------------------------------------------------------------
--
-- Every other seed finds its parents by natural key — the workspace by slug, a connection by
-- its kind and name — precisely so that it survives a database somebody has edited. This one
-- writes `subject_id` as the literal uuid R__dev_seed_providers.sql gives each card, and the
-- reason is the same reason V022 gives that column no foreign key:
--
--   * **There is nothing to join to.** `audit_events.subject_id` is not referential — an
--     event about a connection has to outlive the connection, because `provider.deleted` is
--     exactly the event whose subject no longer exists. A join here would be inventing a
--     constraint the schema deliberately refuses.
--   * **Flyway orders repeatable migrations by description**, so this file runs *before*
--     `R__dev_seed_providers.sql` on a first pass. A join would find nothing, insert nothing,
--     and then insert on the second `docker compose up` — a seed that converges on the
--     second run rather than the first, which is the one property R__dev_seed.sql's header
--     spends a page ruling out.
--
-- So the five uuids below are copies, and the copy is safe because the values are literals in
-- both files rather than anything either one computes. `tests/seed.sql` asserts they still
-- name the cards they are meant to name.
--
-- ---------------------------------------------------------------------------
-- The trail, and why it reads the way it does.
-- ---------------------------------------------------------------------------
--
-- Fourteen events, chosen to be a *lived-in* history rather than a demonstration of the
-- vocabulary — but between them they cover every action AD.4 defines, which is what makes
-- this file the fixture the sheet's own tests render:
--
--   | When            | Who   | What                    | Where                     |
--   |-----------------|-------|-------------------------|---------------------------|
--   | 2026-05-14      | Ken   | `provider.added`        | Ollama · workstation      |
--   | 2026-05-30      | Ken   | `provider.added`        | local vLLM                |
--   | 2026-06-12      | Ken   | `provider.added`        | Anthropic Claude          |
--   | 2026-06-18      | Maya  | `provider.added`        | GitHub Copilot            |
--   | 2026-07-02      | Maya  | `provider.added`        | Cursor                    |
--   | now − 9 days    | Ken   | `provider.tested`       | Anthropic Claude          |
--   | now − 6 days    | Ken   | `provider.cap_changed`  | Anthropic Claude          |
--   | now − 4 days    | Maya  | `provider.revealed`     | GitHub Copilot            |
--   | now − 3 days    | Ken   | `provider.rotated`      | Anthropic Claude          |
--   | now − 2 days    | Maya  | `provider.rotated` ✗    | GitHub Copilot            |
--   | now − 2 days    | Maya  | `provider.disabled`     | GitHub Copilot            |
--   | now − 47 hours  | Maya  | `provider.enabled`      | GitHub Copilot            |
--   | now − 90 min    | —     | `credential.lease_granted` | run #482 · Ollama       |
--   | now − 40 min    | Ken   | `provider.revealed`     | Anthropic Claude          |
--
-- **The five `provider.added` stamps are copies of each card's `added_on`**, so the trail and
-- the cards agree about when a provider arrived. Everything after them is relative to `now()`
-- so the sheet always opens on a recent history rather than on rows that age out of interest.
-- No other seed's assertions read this table, so unlike R__dev_seed_providers.sql there is no
-- rule here about avoiding the current day — a trail whose newest row is forty minutes old is
-- the point.
--
-- **Three of the rows are the ones worth having in a fixture**, and each is here deliberately:
--
--   * The **failed rotation** (`outcome: "failure"`). AD.4's first acceptance criterion is
--     that every operation writes exactly one event *including the failure paths*, so the
--     fixture has to contain one — otherwise the sheet is only ever tested against a history
--     in which nothing went wrong, and the row that renders `✗` is rendered for the first
--     time in production.
--   * The **lease grant**, whose `actor_id` is **null**. A worker being told how to reach a
--     local provider is authenticated by a service key and not by a person, and a sheet that
--     assumed an actor would render `undefined` against the one event class that never has
--     one.
--   * The **`10.0.4.20` address** on that same row, which is a worker on the cluster network
--     rather than a person at a desk — the one thing that tells a lease grant's provenance
--     apart from a reveal's, and a large part of why `ip` is worth having on this table.
--     It is dotted-quad because that is what `ouroboros-rest` writes: a dual-stack listener
--     reports an IPv4 client as `::ffff:10.0.4.20`, PostgreSQL keeps the two spellings
--     distinct, and the service unwraps the mapping so that a subnet question finds both. A
--     fixture carrying the mapped form would be demonstrating a shape the writer cannot
--     produce.
--
-- **Nothing in `detail` is secret material, and that is the invariant rather than a habit.**
-- The payloads below carry a step-up method, a pair of cap figures, a field list, a latency
-- and an outcome. Not a key, not a mask, not an envelope, not a fragment of one — see V022's
-- header, and `ouroboros-rest`'s `audit.secrecy.spec.ts`, which greps the rows the service
-- actually writes against the vault's own redaction vocabulary.

-- ---------------------------------------------------------------------------
-- The fourteen events.
--
-- One statement, so the whole trail is one `on conflict do nothing` and a re-run is one
-- no-op. `occurred_at` is a `timestamptz` expression per row rather than a literal column,
-- which is what lets the five historical stamps and the nine relative ones live in the same
-- `values` list: the first five are absolute strings, the rest are `now()` minus an interval.
--
-- The actor is found by email and the workspace by slug, both `join`s rather than literals,
-- for the reason R__dev_seed.sql's header gives. The lease grant has no actor at all, so it
-- names `null` and reaches the same `left join` with nothing to match — which is why that
-- join is a `left` one.
-- ---------------------------------------------------------------------------
insert into ouroboros.audit_events
    (id, organization_id, actor_id, action, subject_type, subject_id, ip, detail, occurred_at)
select ('5eed0015-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", person."id", seed.action, seed.subject_type, seed.subject_id,
       seed.ip::inet, seed.detail::jsonb, seed.occurred_at
  from (values
         -- The five arrivals, stamped to match each card's `added_on`.
         ( 1, 'ken@acme-robotics.dev',  'provider.added',    'provider_connection',
           '5eed000c-0000-4000-8000-000000000005', '198.51.100.24',
           '{"kind": "ollama", "display_name": "Ollama · workstation"}',
           timestamptz '2026-05-14 08:55:00+00'),
         ( 2, 'ken@acme-robotics.dev',  'provider.added',    'provider_connection',
           '5eed000c-0000-4000-8000-000000000004', '198.51.100.24',
           '{"kind": "openai_compatible", "display_name": "OpenAI-compatible · local vLLM"}',
           timestamptz '2026-05-30 14:12:00+00'),
         ( 3, 'ken@acme-robotics.dev',  'provider.added',    'provider_connection',
           '5eed000c-0000-4000-8000-000000000001', '198.51.100.24',
           '{"kind": "anthropic", "display_name": "Anthropic Claude"}',
           timestamptz '2026-06-12 16:20:00+00'),
         ( 4, 'maya@acme-robotics.dev', 'provider.added',    'provider_connection',
           '5eed000c-0000-4000-8000-000000000003', '198.51.100.61',
           '{"kind": "copilot", "display_name": "GitHub Copilot"}',
           timestamptz '2026-06-18 09:40:00+00'),
         ( 5, 'maya@acme-robotics.dev', 'provider.added',    'provider_connection',
           '5eed000c-0000-4000-8000-000000000002', '198.51.100.61',
           '{"kind": "cursor", "display_name": "Cursor"}',
           timestamptz '2026-07-02 10:05:00+00'),

         -- The recent history the sheet opens on.
         ( 6, 'ken@acme-robotics.dev',  'provider.tested',   'provider_connection',
           '5eed000c-0000-4000-8000-000000000001', '198.51.100.24',
           '{"kind": "anthropic", "outcome": "success", "latency_ms": 38}',
           now() - interval '9 days'),
         ( 7, 'ken@acme-robotics.dev',  'provider.cap_changed', 'provider_connection',
           '5eed000c-0000-4000-8000-000000000001', '198.51.100.24',
           '{"kind": "anthropic", "from_cap_cents": 40000, "to_cap_cents": 60000}',
           now() - interval '6 days'),
         ( 8, 'maya@acme-robotics.dev', 'provider.revealed', 'provider_connection',
           '5eed000c-0000-4000-8000-000000000003', '198.51.100.61',
           '{"kind": "copilot", "step_up": "password"}',
           now() - interval '4 days'),
         ( 9, 'ken@acme-robotics.dev',  'provider.rotated',  'provider_connection',
           '5eed000c-0000-4000-8000-000000000001', '198.51.100.24',
           '{"kind": "anthropic", "outcome": "success"}',
           now() - interval '3 days'),
         (10, 'maya@acme-robotics.dev', 'provider.rotated',  'provider_connection',
           '5eed000c-0000-4000-8000-000000000003', '198.51.100.61',
           '{"kind": "copilot", "outcome": "failure", "reason": "provider_validation_failed"}',
           now() - interval '2 days'),
         (11, 'maya@acme-robotics.dev', 'provider.disabled', 'provider_connection',
           '5eed000c-0000-4000-8000-000000000003', '198.51.100.61',
           '{"kind": "copilot"}',
           now() - interval '2 days' + interval '5 minutes'),
         (12, 'maya@acme-robotics.dev', 'provider.enabled',  'provider_connection',
           '5eed000c-0000-4000-8000-000000000003', '198.51.100.61',
           '{"kind": "copilot"}',
           now() - interval '47 hours'),

         -- The worker's lease: no actor, and a cluster address rather than a desk.
         (13, null,                     'credential.lease_granted', 'run',
           '5eed0009-0000-4000-8000-000000000482', '10.0.4.20',
           '{"kind": "ollama", "ttl_seconds": 900}',
           now() - interval '90 minutes'),

         (14, 'ken@acme-robotics.dev',  'provider.revealed', 'provider_connection',
           '5eed000c-0000-4000-8000-000000000001', '198.51.100.24',
           '{"kind": "anthropic", "step_up": "session"}',
           now() - interval '40 minutes')
       ) as seed (n, actor_email, action, subject_type, subject_id, ip, detail, occurred_at)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  left join ouroboros."user" person on person."email" = seed.actor_email
 where ${ouro_dev_seed}
on conflict do nothing;
