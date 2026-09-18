-- R__dev_seed_farm.sql — mockup 08's Build Farm, as rows, in a development database and
-- nowhere else.
--
-- The tenth development seed. R__dev_seed_dashboard.sql (#68) says *what the loop has done*;
-- this one puts in **the machines that do the building and the builds themselves**: the five
-- runners mockup 08's table lists, the two pools its POOLS card configures, the enrollment
-- tokens behind its install one-liner, the job history its stat row is computed from, and the
-- chunked log its LIVE card streams
-- ([`docs/mockups/08-build-farm.html`](../../docs/mockups/08-build-farm.html)). All of it belongs
-- to `acme-robotics`. **The personal workspace `kensuenobu` gets nothing** — no pool, no runner,
-- no job — and that absence is AI.7's (#262) guidance-path fixture. `acme-labs` gets nothing
-- either.
--
-- **Dev-only, and that matters more here than anywhere else in this directory.** A runner is a
-- live entity: a row in `ouroboros.runners` claims a machine somewhere is heartbeating, and a
-- production database holding five that are not would render a fleet nobody owns. Like every
-- seed here it is behind `${ouro_dev_seed}`, which is `false` in flyway.toml and `true` only in
-- flyway.seed.toml.
--
-- Named `farm` for its *sort order* as much as its subject: Flyway applies repeatable migrations
-- in the order of their descriptions, and every row here hangs off the workspace, the people and
-- the repositories R__dev_seed.sql creates. `dev_seed_farm` sorts after `dev_seed`;
-- tests/seed.test.sh asserts the order.
--
-- ---------------------------------------------------------------------------
-- **Every number the page prints is computed. None is stored.**
-- ---------------------------------------------------------------------------
--
-- The rows are shaped so the mockup's figures *fall out* of the obvious aggregates, and this
-- file contains none of the figures themselves (tests/seed.test.sh refuses them):
--
--   | Rendered                            | Computed from                                          |
--   |-------------------------------------|--------------------------------------------------------|
--   | `5 runners. 2 pools.`               | `runners` and `runner_pools`, excluding `removed`      |
--   | `Runners online 4/5`                | runners whose `status` is not `offline` or `removed`   |
--   | `forge-03 offline · 2h`             | `now() - last_seen_at` of the offline runner           |
--   | `1 building`                        | runners with `status = 'building'`                     |
--   | `Builds today 23`                   | terminal jobs whose `finished_at` is today             |
--   | `19 clean · 3 retried · 1 failed`   | that same set, partitioned by `status`                 |
--   | `Avg build time 4m 12s`             | mean `finished_at - started_at` over it (252 s)        |
--   | `▼ 38s vs last week`                | the same mean over the prior week (290 s)              |
--   | `78%` cache hit rate                | Σ hits ÷ Σ (hits + misses) over today's `ccache_stats` |
--   | `q:2` · `q:1`                       | `queued`/`offered` jobs per runner                     |
--   | `3 runners` · `2 runners` (pools)   | `runners` grouped by pool, excluding `removed`         |
--   | `hit 78.4% (412/525 objects)`       | job `#479`'s own `ccache_stats` — 412 hits, 113 misses |
--
-- **Each metric has a row built to tell a right answer from a nearly-right one.**
--
--   * *The fleet* — `forge-00` is a sixth runner with `status` and `desired_state` both
--     `removed`. A count that forgets to exclude it reads **6 runners**, and pool-a reads
--     **4 runners** rather than three. It also still owns two of last week's builds, which is
--     the reason its row was kept rather than deleted.
--   * *Builds today* — two jobs are `running` and three are `queued`, so a count taken over
--     `queued_at` rather than over `finished_at` reads **28**; the twenty jobs of the prior week
--     are still there, so a count that forgets the day window reads **43**.
--   * *The 19/3/1 split* — the three `retried` jobs each have a successor among the nineteen
--     `succeeded` ones (`#458`, `#463`, `#467`), so the three numbers partition the day rather
--     than double-counting a retry. A count of *attempts that ultimately failed* is 1, not 4.
--   * *Average build time* — the two running jobs have no `finished_at`, so an average over
--     `now() - started_at` instead of over the recorded pair would be dragged by `#472`, which
--     has been running since this morning.
--   * *Cache rate* — the prior week's builds carry ccache stats too, at a deliberately
--     different 70%, so a rate computed without the day window reads **74%** rather than 78%.
--     Seven of today's twenty-three jobs carry **no** stats at all — the shell pool's four and
--     the three attempts that died before ccache printed its summary — and null is not zero
--     (decision **B5**): a mean of per-job rates that reads a missing summary as 0% reads **54%**.
--   * *The image snapshot* — last week's container builds record `zephyr-sdk:0.16` and today's
--     record `0.17`, while the pool pins `0.17`. A configuration class read through the pool
--     rather than off the job would put both weeks in one class, which is exactly what CD.3's
--     (#561) estimator must not do.
--
-- ---------------------------------------------------------------------------
-- **Coordinated with DASH-F.5 (#68), and with nothing else by accident.**
-- ---------------------------------------------------------------------------
--
-- `build_jobs.number` is the farm's own sequence, `#435`–`#482`. One number in it is
-- deliberately shared: **`#479`**, the live build on `forge-01`, is the same story as the
-- dashboard seed's run `#479` — same title, same repository — because both seeds are drawn from
-- one universe (the coordination #328 extends). The two are *not* linked, and `run_id` is null
-- on every row here: decision **B6** makes loop attribution AJ.3's (#265), and a seeded
-- loop-linked job would be a state the product cannot yet reach.
--
-- ---------------------------------------------------------------------------
-- **Today is relative to today, not to the day this was typed.**
-- ---------------------------------------------------------------------------
--
-- Every instant is derived from `now()`. Today's twenty-three finished jobs are spread across
-- the *elapsed* part of the current UTC day — `date_trunc('day', now())` plus a fraction of the
-- time since — so they land inside the day and in the past whatever the hour a developer
-- migrates at. A literal timestamp, or a fixed `now() - 6 hours`, would put half of them in
-- yesterday for anyone who reset their database before breakfast.
--
-- ---------------------------------------------------------------------------
-- **What is deliberately not written.**
-- ---------------------------------------------------------------------------
--
-- * **No `run_id`.** Decision B6. See above.
-- * **No unsealed token, and no unsealed CA key.** Both enrollment tokens, `anvil-mac`'s bearer
--   secret and the farm CA's private key carry an `ouro.v1.…` envelope whose body is base64url
--   of a sentence saying it is not a real credential — the shape R__dev_seed_providers.sql
--   established. The schema would refuse anything else anyway, which is the point of
--   `enrollment_tokens_sealed`, `runners_bearer_sealed` and `farm_authorities_key_sealed`.
-- * **No real certificate.** The seeded CA certificate is a PEM block with a placeholder body:
--   nothing in development verifies a chain against it, and generating a genuine one in a
--   migration would put a private key nobody controls into every developer's database.
-- * **No auto-scale that does anything.** `pool-a` stores the mockup's *"when queue > 5"*
--   preference with `enabled` false (decision **B9**). It is stored and inert until AJ.1
--   (#263), and the card labels it as such.
-- * **No second pool window.** One `runner_pool_windows` row exists so #514's capability has a
--   fixture; overlap resolution is dispatch's (AH.4, #252) and there is nothing here to
--   overlap with.
-- * **No truncated log.** The cap trigger's marker is asserted in tests/constraints.sql against
--   a fixture that actually exceeds a cap. Seeding a 64 MiB log to prove it would make every
--   `docker compose up` write sixty-four megabytes.
--
-- **Ids.** `5eed…`, as everywhere, one prefix per table and a suffix computed from a value each
-- row already names — `gen_random_uuid()` appears nowhere:
--
--   | Rows                        | Id prefix   | Suffix                                   |
--   |-----------------------------|-------------|------------------------------------------|
--   | `runner_pools` (2)          | `5eed0024…` | the pool's ordinal                       |
--   | `runners` (6)               | `5eed0025…` | the runner's ordinal                     |
--   | `enrollment_tokens` (2)     | `5eed0026…` | the token's ordinal                      |
--   | `runner_pool_windows` (1)   | `5eed0027…` | 1                                        |
--   | `build_jobs` (48)           | `5eed0028…` | the job number                           |
--   | `build_log_chunks` (5)      | `5eed0029…` | the job number, then the chunk's `seq`   |
--   | `runner_certificates` (5)   | `5eed002a…` | the runner's ordinal                     |
--
-- The same three properties as every seed, each asserted by a test: every statement ends
-- `${ouro_dev_seed}` so it writes nothing outside a development database; every insert ends
-- `on conflict do nothing`, with a `not exists` guard on the one statement whose BEFORE trigger
-- would run first; and every parent from another seed is found by natural key — the workspace by
-- slug, a person by email, a repository by name — never by repeating its id.
--
-- Filed as issue #249 (AH.1), extended by #250 (AH.2) with the farm CA, the certificates the
-- mTLS runners hold and `anvil-mac`'s fallback secret. Needs #23 (the base seed), V040 and V041.
-- Consumed by #255, #256, #257 and #262. Asserted in tests/seed.sql and tests/seed.test.sh.

-- ---------------------------------------------------------------------------
-- The two pools — the mockup's POOLS card.
--
-- `pool-a` is a container world with a pinned Zephyr SDK image; `pool-b` is a shell world,
-- because a HIL rig and a Mac are the machine, not a container on it (decision **B4**). The
-- runner counts the card prints are counts of ouroboros.runners, not columns here.
--
-- `pool-b` carries the tag `hil`, which is what a marketplace snippet's `runner_tags`
-- requirement resolves against (#776) — the difference between that row being a fact and being
-- decoration.
-- ---------------------------------------------------------------------------
insert into ouroboros.runner_pools
  (id, organization_id, name, description, executor, image, env_allowlist,
   max_concurrency, enabled, autoscale_pref, tags)
select ('5eed0024-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.name, seed.description, seed.executor, seed.image,
       seed.env_allowlist::jsonb, seed.max_concurrency, true,
       seed.autoscale_pref::jsonb, seed.tags::jsonb
  from (values
         (1, 'pool-a', 'firmware builds', 'container',
          'ghcr.io/acme-robotics/zephyr-sdk:0.17',
          '["CCACHE_DIR", "WEST_TOPDIR", "ZEPHYR_BASE"]', 2,
          '{"enabled": false, "queue_threshold": 5}', '["firmware", "zephyr"]'),
         (2, 'pool-b', 'HIL & macOS jobs', 'shell', null,
          '["DEVELOPER_DIR", "HIL_RIG_ID"]', 1,
          '{}', '["hil", "macos"]')
       ) as seed (ordinal, name, description, executor, image,
                  env_allowlist, max_concurrency, autoscale_pref, tags)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The fleet — five runners the mockup lists, and a sixth it does not.
--
-- The five are its five rows, in its order, with the statuses that give the table all of its
-- archetypes: building, idle, idle, draining and offline. `forge-03` was last seen two hours
-- ago and carries no telemetry and no uptime, because a snapshot the fleet cannot vouch for is
-- not a snapshot and the mockup prints `—`.
--
-- `anvil-mac` is on `bearer_fallback` and holds no certificate serial: a Mac behind a proxy that
-- terminates client certificates is exactly the case decision **B3** keeps visible rather than
-- hiding, and AI.2 (#257) renders it as degraded. Every other runner is on mTLS and carries the
-- serial its certificate was issued with.
--
-- `forge-00` is the sixth. It is `removed` on both sides — observed and intended — and it is
-- here for two reasons: it owns two of last week's builds, which is why a removal keeps the row
-- rather than deleting it, and it is the near miss every count of the fleet has to exclude.
-- ---------------------------------------------------------------------------
insert into ouroboros.runners
  (id, organization_id, pool_id, name, arch, status, desired_state, last_seen_at,
   agent_version, capabilities, security_mode, cert_serial, bearer_sealed, enrolled_at,
   enrolled_by, uptime_seconds, telemetry)
select ('5eed0025-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", pool.id, seed.name, seed.arch, seed.status, seed.desired_state,
       now() - make_interval(secs => seed.last_seen_secs_ago),
       seed.agent_version, seed.capabilities::jsonb, seed.security_mode, seed.cert_serial,
       seed.bearer_sealed, now() - make_interval(days => seed.enrolled_days_ago), person."id",
       seed.uptime_seconds, seed.telemetry::jsonb
  from (values
         (1, 'forge-01', 'pool-a', 'linux/arm64', 'building', 'active', 4,
          '1.0.0', '{"docker": true, "cpu_count": 8}', 'mtls', '4a110e97', null, 60, 3542400,
          '{"cpu_pct": 82, "ram_used_bytes": 14200000000, "ram_total_bytes": 32000000000, "queue_depth": 2}'),
         (2, 'forge-02', 'pool-a', 'linux/arm64', 'online', 'active', 7,
          '1.0.0', '{"docker": true, "cpu_count": 8}', 'mtls', '4a110e98', null, 60, 3542400,
          '{"cpu_pct": 3, "ram_used_bytes": 2100000000, "ram_total_bytes": 32000000000, "queue_depth": 0}'),
         (3, 'anvil-mac', 'pool-b', 'darwin/arm64', 'online', 'active', 5,
          '1.0.0', '{"docker": false, "cpu_count": 12}', 'bearer_fallback', null,
          'ouro.v1.1.ZmFybS1zZWVkLW5vbmNlLTM.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1iZWFyZXItc2VjcmV0',
          20, 1036800,
          '{"cpu_pct": 6, "ram_used_bytes": 5000000000, "ram_total_bytes": 64000000000, "queue_depth": 0}'),
         (4, 'bigiron', 'pool-b', 'linux/x86_64', 'draining', 'draining', 9,
          '1.0.0', '{"docker": true, "cpu_count": 64}', 'mtls', '4a110e99', null, 95, 259200,
          '{"cpu_pct": 54, "ram_used_bytes": 88000000000, "ram_total_bytes": 256000000000, "queue_depth": 1}'),
         (5, 'forge-03', 'pool-a', 'linux/arm64', 'offline', 'active', 7200,
          '0.9.2', '{"docker": true, "cpu_count": 8}', 'mtls', '4a110e9a', null, 60, null,
          '{}'),
         (6, 'forge-00', 'pool-a', 'linux/arm64', 'removed', 'removed', 518400,
          '0.9.2', '{"docker": true, "cpu_count": 4}', 'mtls', '4a110e9b', null, 120, null,
          '{}')
       ) as seed (ordinal, name, pool_name, arch, status, desired_state, last_seen_secs_ago,
                  agent_version, capabilities, security_mode, cert_serial, bearer_sealed,
                  enrolled_days_ago, uptime_seconds, telemetry)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros."user" person     on person."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Two enrollment tokens — one live, one revoked.
--
-- The live one is what mockup 08's install card renders as `orb_enroll_••••`: scoped to
-- `pool-a`, good for five machines, three of them already spent. The revoked one is the state
-- the token-management panel has to be able to show, and it is revoked rather than expired
-- because those are different events and only one of them is an incident.
--
-- Neither value is a credential. Both are AD.1 (#222) envelopes whose base64url body decodes to
-- a sentence saying so, which is R__dev_seed_providers.sql's convention; the schema refuses any
-- other shape.
-- ---------------------------------------------------------------------------
insert into ouroboros.enrollment_tokens
  (id, organization_id, pool_id, token_sealed, expires_at, max_uses, uses,
   revoked, revoked_at, created_by, created_at)
select ('5eed0026-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", pool.id, seed.token_sealed,
       now() + make_interval(days => seed.expires_in_days),
       seed.max_uses, seed.uses, seed.revoked,
       case when seed.revoked then now() - make_interval(days => 1) end,
       person."id", now() - make_interval(days => seed.created_days_ago)
  from (values
         (1, 'pool-a',
          'ouro.v1.1.ZmFybS1zZWVkLW5vbmNlLTE.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1lbnJvbGxtZW50LXRva2Vu',
          7, 5, 3, false, 10, 'ken@acme-robotics.dev'),
         (2, 'pool-b',
          'ouro.v1.1.ZmFybS1zZWVkLW5vbmNlLTI.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1lbnJvbGxtZW50LXRva2Vu',
          30, 1, 0, true, 4, 'maya@acme-robotics.dev')
       ) as seed (ordinal, pool_name, token_sealed, expires_in_days, max_uses, uses,
                  revoked, created_days_ago, created_email)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros."user" person     on person."email" = seed.created_email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- One pool-assignment window — #514's capability, with a fixture.
--
-- The Build Analyzer's suggestion reads *"forge-02 joins pool-a between 14:00–16:00 UTC on
-- weekdays"*; forge-02's home pool in this fleet already **is** pool-a, so the fixture is the
-- same sentence in the direction the mockup's fleet leaves open — forge-02 lends its afternoons
-- to the HIL pool. Dispatch honours it from AH.4 (#252); nothing reads it today.
-- ---------------------------------------------------------------------------
insert into ouroboros.runner_pool_windows
  (id, organization_id, runner_id, pool_id, days_of_week, starts_at, ends_at, enabled, created_by)
select ('5eed0027-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", runner.id, pool.id, seed.days_of_week::jsonb,
       seed.starts_at::time, seed.ends_at::time, true, person."id"
  from (values
         (1, 'forge-02', 'pool-b', '[1, 2, 3, 4, 5]', '14:00', '16:00')
       ) as seed (ordinal, runner_name, pool_name, days_of_week, starts_at, ends_at)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runners runner    on runner.organization_id = org."id" and runner.name = seed.runner_name
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros."user" person     on person."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The prior week's builds — twenty, and the other side of `▼ 38s vs last week`.
--
-- Finished on each of the seven whole days before today — anchored to `date_trunc('day', now())`
-- and an hour of the day, so the set sits inside the prior-week window and outside today's
-- whatever the hour a developer migrates at. Their mean duration is 290 seconds; today's is 252,
-- and the difference is the thirty-eight the stat row prints. Nothing here stores either number.
--
-- Fourteen of them carry ccache stats at a deliberately different rate — near 70%, not 78% — so
-- a cache rate computed without the day window reads 74% and is visibly wrong rather than
-- plausibly wrong. Their container image is `zephyr-sdk:0.16`, which the pool no longer pins:
-- that is the snapshot doing its job, and the reason CD.3's (#561) configuration class must be
-- read off the job rather than through the pool.
--
-- `#450` and `#452` were retried — `#451` and `#453` are the attempts that replaced them — and
-- `#454` failed outright. `#447` and `#448` ran on `forge-00`, which has since been removed;
-- the rows outliving the runner is why a removal keeps its row.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_jobs
  (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
   label, title, executor, image, command, status,
   queued_at, offered_at, started_at, finished_at, exit_code, ccache_stats, retry_of)
select ('5eed0028-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", seed.number, pool.id, runner.id, repo.id, 'refs/heads/main',
       substr(md5('ouroboros-farm-' || seed.number::text) || md5(seed.number::text), 1, 40),
       seed.label, seed.title, seed.executor, seed.image, seed.command, seed.status,
       done.at - make_interval(secs => seed.duration_secs + 20),
       done.at - make_interval(secs => seed.duration_secs + 10),
       done.at - make_interval(secs => seed.duration_secs),
       done.at,
       seed.exit_code,
       case when seed.ccache_hits is null then null
            else jsonb_build_object('hits', seed.ccache_hits,
                                    'misses', seed.ccache_misses,
                                    'version', '4.9') end,
       case when seed.retry_of is null then null
            else ('5eed0028-0000-4000-8000-' || lpad(seed.retry_of::text, 12, '0'))::uuid end
  from (values
         (435, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Bootloader: reserve a second image slot in the flash layout',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 140, 380, 140, 1, 2),
         (436, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Image header: add version and slot-generation fields',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 215, 336, 144, 2, 5),
         (437, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Verify the signed update manifest with ed25519',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 228, 427, 183, 3, 8),
         (438, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Flash driver: erase-before-write guard on the slot boundary',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 241, 319, 136, 4, 11),
         (439, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Watchdog: extend the timeout while an image is being copied',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 254, 474, 226, 5, 14),
         (440, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Publish OTA progress events on the telemetry channel',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 262, 273, 117, 6, 17),
         (441, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Tune the brown-out threshold for writes during flashing',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 271, 382, 163, 7, 20),
         (442, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Persist swap state across a reset in the middle of an image copy',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 279, 434, 186, 1, 3),
         (443, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Anti-rollback counter in OTP fuses',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 286, 354, 151, 2, 6),
         (444, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Fleet canary: stage an update to 5% of units first',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 294, 301, 129, 3, 9),
         (445, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'BLE: allocate UUIDs for the provisioning GATT service',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 301, 402, 173, 4, 12),
         (446, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Debounce the e-stop interrupt handler',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 308, 322, 138, 5, 15),
         (447, 'pool-a', 'forge-00', 'helios-firmware', 'zephyr build', 'Refactor the telemetry buffer allocation',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 315, 182, 78, 6, 18),
         (448, 'pool-a', 'forge-00', 'helios-firmware', 'zephyr build', 'Motor PID: clamp the integral term on saturation',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.16', 'west build -b helios_mainboard app', 'succeeded', 0, null, 322, 314, 136, 7, 21),
         (449, 'pool-b', 'anvil-mac', 'helios-telemetry', 'HIL test rig', 'HIL: soak the OTA resume path for an hour',
          'shell', null, 'make hil-sweep RIG=rig-02', 'succeeded', 0, null, 329, null, null, 1, 4),
         (450, 'pool-b', 'bigiron', 'helios-console', 'macOS build', 'macOS: notarize the nightly console build',
          'shell', null, 'xcodebuild -scheme HeliosConsole -destination platform=macOS test', 'retried', 1, null, 336, null, null, 2, 7),
         (451, 'pool-b', 'anvil-mac', 'helios-telemetry', 'HIL test rig', 'HIL: sweep the charge controller against rig-03',
          'shell', null, 'make hil-sweep RIG=rig-02', 'succeeded', 0, 450, 344, null, null, 3, 10),
         (452, 'pool-b', 'bigiron', 'helios-console', 'macOS build', 'macOS: refresh the console dependency lockfile',
          'shell', null, 'xcodebuild -scheme HeliosConsole -destination platform=macOS test', 'retried', 1, null, 351, null, null, 4, 13),
         (453, 'pool-b', 'anvil-mac', 'helios-telemetry', 'HIL test rig', 'HIL: replay the brown-out capture against rig-01',
          'shell', null, 'make hil-sweep RIG=rig-02', 'succeeded', 0, 452, 358, null, null, 5, 16),
         (454, 'pool-b', 'bigiron', 'helios-console', 'macOS build', 'macOS: build the fleet console for Apple silicon',
          'shell', null, 'xcodebuild -scheme HeliosConsole -destination platform=macOS test', 'failed', 2, null, 366, null, null, 6, 19)
       ) as seed (number, pool_name, runner_name, repo_name, label, title,
                  executor, image, command, status, exit_code, retry_of, duration_secs,
                  ccache_hits, ccache_misses, days_ago, hour_of_day)
  cross join lateral (select date_trunc('day', now())
                             - make_interval(days => seed.days_ago)
                             + make_interval(hours => seed.hour_of_day) as at) done
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros.runners runner    on runner.organization_id = org."id" and runner.name = seed.runner_name
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Today's finished builds — twenty-three, and the whole of the stat row's middle two cards.
--
-- Nineteen `succeeded`, three `retried`, one `failed`: `23 builds today` is their count and
-- `19 clean · 3 retried · 1 failed` is that count partitioned by status, so the three numbers
-- add up because they are one partition rather than three queries. Each retried attempt has a
-- successor among the nineteen — `#457`→`#458`, `#462`→`#463`, `#466`→`#467` — which is why a
-- retry is counted once as the attempt that failed and once as the build that worked, and never
-- twice as either.
--
-- Their mean duration is 252 seconds, which the card prints as `4m 12s`.
--
-- Sixteen carry ccache stats summing to 6 864 hits in 8 800 objects — the `78%` meter — and
-- seven carry none: the shell pool's four, which have no cache at all, and the three attempts
-- that died before ccache printed its summary. Null is not zero (decision **B5**).
--
-- Every instant is a fraction of the elapsed part of today, so the whole set lands inside the
-- current UTC day and in the past whatever the hour a developer migrates at.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_jobs
  (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
   label, title, executor, image, command, status,
   queued_at, offered_at, started_at, finished_at, exit_code, ccache_stats, retry_of)
select ('5eed0028-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", seed.number, pool.id, runner.id, repo.id, 'refs/heads/main',
       substr(md5('ouroboros-farm-' || seed.number::text) || md5(seed.number::text), 1, 40),
       seed.label, seed.title, seed.executor, seed.image, seed.command, seed.status,
       done.at - make_interval(secs => seed.duration_secs + 20),
       done.at - make_interval(secs => seed.duration_secs + 10),
       done.at - make_interval(secs => seed.duration_secs),
       done.at,
       seed.exit_code,
       case when seed.ccache_hits is null then null
            else jsonb_build_object('hits', seed.ccache_hits,
                                    'misses', seed.ccache_misses,
                                    'version', '4.9') end,
       case when seed.retry_of is null then null
            else ('5eed0028-0000-4000-8000-' || lpad(seed.retry_of::text, 12, '0'))::uuid end
  from (values
         (455, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Persist swap state across a reset in the middle of an image copy',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 198, 374, 106, 1),
         (456, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Anti-rollback counter in OTP fuses',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 205, 488, 122, 2),
         (457, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Fleet canary: stage an update to 5% of units first',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'retried', 1, null, 96, null, null, 3),
         (458, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'BLE: allocate UUIDs for the provisioning GATT service',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, 457, 212, 315, 105, 4),
         (459, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Debounce the e-stop interrupt handler',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 221, 583, 137, 5),
         (460, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Refactor the telemetry buffer allocation',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 228, 421, 119, 6),
         (461, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Motor PID: clamp the integral term on saturation',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 233, 341, 114, 7),
         (462, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'CAN-bus: retry a frame after an arbitration loss',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'retried', 1, null, 142, null, null, 8),
         (463, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Pairing screen: drop the unused pairing timeout',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, 462, 240, 544, 136, 9),
         (464, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Bootloader: reserve a second image slot in the flash layout',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 246, 379, 126, 10),
         (465, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Image header: add version and slot-generation fields',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 251, 448, 112, 11),
         (466, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Verify the signed update manifest with ed25519',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'retried', 1, null, 173, null, null, 12),
         (467, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Flash driver: erase-before-write guard on the slot boundary',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, 466, 255, 322, 108, 13),
         (468, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Watchdog: extend the timeout while an image is being copied',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 262, 486, 129, 14),
         (469, 'pool-a', 'forge-02', 'helios-firmware', 'zephyr build', 'Publish OTA progress events on the telemetry channel',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 268, 372, 118, 15),
         (470, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Tune the brown-out threshold for writes during flashing',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 274, 460, 115, 16),
         (471, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'Persist swap state across a reset in the middle of an image copy',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 281, 507, 143, 17),
         (473, 'pool-a', 'forge-03', 'helios-firmware', 'zephyr build', 'Fleet canary: stage an update to 5% of units first',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 288, 353, 117, 18),
         (474, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build', 'BLE: allocate UUIDs for the provisioning GATT service',
          'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app', 'succeeded', 0, null, 295, 471, 129, 19),
         (475, 'pool-b', 'bigiron', 'helios-telemetry', 'HIL test rig', 'Overnight HIL sweep on rig-02',
          'shell', null, 'make hil-sweep RIG=rig-02', 'succeeded', 0, null, 302, null, null, 20),
         (476, 'pool-b', 'anvil-mac', 'helios-console', 'macOS build', 'HIL: replay the brown-out capture against rig-01',
          'shell', null, 'xcodebuild -scheme HeliosConsole -destination platform=macOS test', 'succeeded', 0, null, 311, null, null, 21),
         (477, 'pool-b', 'bigiron', 'helios-telemetry', 'HIL test rig', 'macOS: build the fleet console for Apple silicon',
          'shell', null, 'make hil-sweep RIG=rig-02', 'succeeded', 0, null, 324, null, null, 22),
         (478, 'pool-b', 'anvil-mac', 'helios-console', 'macOS build', 'HIL: soak the OTA resume path for an hour',
          'shell', null, 'xcodebuild -scheme HeliosConsole -destination platform=macOS test', 'failed', 2, null, 491, null, null, 23)       ) as seed (number, pool_name, runner_name, repo_name, label, title,
                  executor, image, command, status, exit_code, retry_of, duration_secs,
                  ccache_hits, ccache_misses, day_slot)
  cross join lateral (select date_trunc('day', now())
                             + (now() - date_trunc('day', now()))
                               * (seed.day_slot::double precision / 24) as at) done
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros.runners runner    on runner.organization_id = org."id" and runner.name = seed.runner_name
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What is in flight — two running builds and three waiting behind them.
--
-- `#479` on `forge-01` is the mockup's LIVE card: three minutes and forty-one seconds in, with
-- the ccache figures its log prints. `#472` on `bigiron` is the *"HIL test rig · finishing"* of
-- a draining runner — a long sweep started this morning that drain lets finish.
--
-- `#480` and `#481` are queued **on** `forge-01` and `#482` on `bigiron`, which is where the
-- runners table's `q:2` and `q:1` come from and what each runner's `queue_depth` telemetry
-- agrees with. Nothing waits on `forge-02`, `anvil-mac` or `forge-03`, so their chips read
-- `q:0` without a row saying so.
--
-- None of these has a `finished_at`, which is what keeps them out of `23 builds today` and out
-- of the average; a count that forgot to require a terminal status would read 28.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_jobs
  (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
   label, title, executor, image, command, status,
   queued_at, offered_at, started_at, ccache_stats)
select ('5eed0028-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", seed.number, pool.id, runner.id, repo.id, 'refs/heads/main',
       substr(md5('ouroboros-farm-' || seed.number::text) || md5(seed.number::text), 1, 40),
       seed.label, seed.title, seed.executor, seed.image, seed.command, seed.status,
       now() - make_interval(secs => seed.queued_secs_ago),
       case when seed.started_secs_ago is null then null
            else now() - make_interval(secs => seed.started_secs_ago + 10) end,
       case when seed.started_secs_ago is null then null
            else now() - make_interval(secs => seed.started_secs_ago) end,
       case when seed.ccache_hits is null then null
            else jsonb_build_object('hits', seed.ccache_hits,
                                    'misses', seed.ccache_misses,
                                    'version', '4.9') end
  from (values
         (472, 'pool-b', 'bigiron', 'helios-telemetry', 'HIL test rig',
          'Overnight HIL sweep on rig-02', 'shell', null,
          'make hil-sweep RIG=rig-02', 'running', 15660, 15600, null, null),
         (479, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build',
          'Add OTA rollback on failed checksum', 'container',
          'ghcr.io/acme-robotics/zephyr-sdk:0.17',
          'west build -b helios_mainboard app -- -DCONFIG_OTA_ROLLBACK=y',
          'running', 260, 221, 412, 113),
         (480, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build',
          'Motor PID: clamp the integral term on saturation', 'container',
          'ghcr.io/acme-robotics/zephyr-sdk:0.17',
          'west build -b helios_mainboard app', 'queued', 150, null, null, null),
         (481, 'pool-a', 'forge-01', 'helios-firmware', 'zephyr build',
          'CAN-bus: retry a frame after an arbitration loss', 'container',
          'ghcr.io/acme-robotics/zephyr-sdk:0.17',
          'west build -b helios_mainboard app', 'queued', 95, null, null, null),
         (482, 'pool-b', 'bigiron', 'helios-telemetry', 'HIL test rig',
          'HIL: soak the OTA resume path for an hour', 'shell', null,
          'make hil-sweep RIG=rig-02', 'queued', 40, null, null, null)
       ) as seed (number, pool_name, runner_name, repo_name, label, title,
                  executor, image, command, status, queued_secs_ago, started_secs_ago,
                  ccache_hits, ccache_misses)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = seed.pool_name
  join ouroboros.runners runner    on runner.organization_id = org."id" and runner.name = seed.runner_name
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The live log — the LIVE card's listing, in the chunks it was streamed as.
--
-- Three chunks for `#479`, two for `#472`. The text is the mockup's, byte for byte, including
-- the ccache line — and the figures in it are the same 412 and 113 the job's own `ccache_stats`
-- carries, because a log that disagreed with the row beside it would be the product telling two
-- stories about one build.
--
-- `byte_start` is not written here: the cap trigger assigns it from each job's running total, so
-- the chunk offsets and `build_jobs.log_bytes` are the database's arithmetic rather than this
-- file's. That is also why this is the one statement with a `not exists` guard as well as an
-- `on conflict`: the trigger fires **before** the conflict is detected, so a second application
-- would add every chunk's bytes to the job's total again before PostgreSQL discarded the row.
-- The guard is what makes `migrate` twice leave the counters where the first pass left them.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_log_chunks (id, job_id, seq, content)
select ('5eed0029-0000-4000-8000-' || lpad(seed.number::text, 9, '0')
                                   || lpad(seed.seq::text, 3, '0'))::uuid,
       job.id, seq, convert_to(seed.content, 'UTF8')
  from (values
         (479, 1, E'$ west build -b helios_mainboard app -- -DCONFIG_OTA_ROLLBACK=y\n-- west build: making build dir /work/479/build pristine\n-- Board: helios_mainboard, qualifiers: stm32h743\n-- Cache: ccache 4.9 · hit 78.4% (412/525 objects) · miss 21.6%\n'),
         (479, 2, E'[598/638] Compiling subsys/ota/slot_manager.c\n[612/638] Compiling subsys/ota/rollback.c\n[631/638] Compiling subsys/ota/checksum_verify.c\n'),
         (479, 3, E'Memory region         Used Size  Region Size  %age Used\n     FLASH:            912344 B         2 MB     43.50%\n       RAM:            181208 B       512 KB     34.56%\n[6/7] Linking zephyr.elf …'),
         (472, 1, E'$ make hil-sweep RIG=rig-02\nrig-02: power cycling the DUT\nrig-02: flashing the image under test\n'),
         (472, 2, E'[  1/120] ota.resume.interrupted_download ... ok\n[  2/120] ota.resume.power_loss_mid_swap ... ok\n[  3/120] ota.rollback.checksum_mismatch ... ok\n')
       ) as seed (number, seq, content)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.build_jobs job
    on job.organization_id = org."id" and job.number = seed.number
 where ${ouro_dev_seed}
   and not exists (select 1 from ouroboros.build_log_chunks existing
                    where existing.job_id = job.id and existing.seq = seed.seq)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The farm CA, and the certificates the fleet is holding.
--
-- AH.2 (#250), decision **B3**. The workspace has one authority; the five mTLS runners each
-- hold the certificate their `cert_serial` names, and `anvil-mac` holds none because it is on
-- the fallback — which is the pairing `runners_cert_serial_with_mtls` and
-- `runners_bearer_with_fallback` state, made visible in rows.
--
-- **Neither the CA key nor the certificate is real.** The key is an `ouro.v1.…` envelope whose
-- body decodes to a sentence saying so, as every sealed column in every seed is; the
-- certificate is a PEM block with a placeholder body. A genuine CA generated in a migration
-- would be a private key nobody controls, identical in every developer's database, and the
-- first thing an accident would ship to production. Nothing in development verifies a chain
-- against it — AH.3 (#251) verifies against what the CA service issued at run time, and its
-- own suites mint a real one for the occasion.
--
-- `forge-00` is removed and still holds its certificate row, revoked with the reason a removal
-- gives. That is the fixture AH.6 (#254) and the gateway's refusal path both need: a serial
-- that resolves, and resolves to *no*.
-- ---------------------------------------------------------------------------
insert into ouroboros.farm_authorities
  (organization_id, certificate_pem, key_sealed, serial, fingerprint, not_before, not_after)
select org."id",
       '-----BEGIN CERTIFICATE-----' || chr(10)
         || 'ZGV2LXNlZWQtY2VydGlmaWNhdGUtbm90LWEtcmVhbC1mYXJtLWNh' || chr(10)
         || '-----END CERTIFICATE-----' || chr(10),
       'ouro.v1.1.ZmFybS1zZWVkLW5vbmNlLTQ.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jYS1rZXk',
       '5eed0a11c0de0001', repeat('5e', 32),
       now() - make_interval(days => 120), now() + make_interval(days => 3530)
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.runner_certificates
  (id, organization_id, runner_id, serial, fingerprint, issued_for, not_before, not_after,
   issued_at, revoked, revoked_at, revoked_by, revocation_reason)
select ('5eed002a-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", runner.id, runner.cert_serial, repeat(seed.fingerprint_byte, 32),
       seed.issued_for,
       runner.enrolled_at, runner.enrolled_at + make_interval(days => 90),
       runner.enrolled_at,
       seed.revoked,
       case when seed.revoked then now() - make_interval(days => 6) end,
       case when seed.revoked then person."id" end,
       case when seed.revoked then 'runner_removed' end
  from (values
         (1, 'forge-01', 'enrollment', '11', false),
         (2, 'forge-02', 'enrollment', '22', false),
         (4, 'bigiron',  'renewal',    '44', false),
         (5, 'forge-03', 'enrollment', '55', false),
         (6, 'forge-00', 'enrollment', '66', true)
       ) as seed (ordinal, runner_name, issued_for, fingerprint_byte, revoked)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runners runner
    on runner.organization_id = org."id" and runner.name = seed.runner_name
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;
