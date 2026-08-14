-- R__dev_seed_dashboard.sql — mockup 02's dashboard, as rows, in a development database
-- and nowhere else.
--
-- R__dev_seed.sql (#23, reshaped by #708/#709) puts the *workspaces* in a development
-- database: three organizations, three people, the orgs and repositories the loop may run
-- in. This file puts the **dashboard** in it — what the loop has been doing, what it will
-- do next, what it has spent doing so, and what the workspace has told it it may do
-- unattended — across the four read-model tables V008–V011 created and nothing writes yet.
--
-- The honesty rule of this roadmap is that **no number exists outside the seeds**. Every
-- figure [`docs/mockups/02-dashboard.html`](../../docs/mockups/02-dashboard.html) renders
-- is therefore either a row here or an aggregate over rows here, and the aggregate
-- endpoint (#70) computes it rather than remembering it. What that costs is a seed with
-- fifty-three runs in it where the card shows seven: the counts on the stat row are
-- counts, so they have to be counted from something.
--
--   | Surface                    | Reads                                                |
--   |----------------------------|------------------------------------------------------|
--   | *Loops live* — `3`         | `runs` with a non-terminal status                    |
--   | *Queued issues* — `12`     | `queue_items`, and `sum(est_minutes)` for `9h 40m`   |
--   | *PRs merged · 7d* — `27`   | `runs` merged in the window, and `19` in the one before |
--   | *Token spend · today*      | `token_usage_daily` for the current UTC day          |
--   | *Active loops* (`c-8`)     | the three non-terminal runs                          |
--   | *Recently closed* (`c-7`)  | the four newest terminal runs                        |
--   | *Up next in queue* (`c-5`) | `queue_items` positions 1–5                          |
--   | *Loop pulse* (`c-4`)       | rates over `runs`, and `workspace_settings_effective` |
--
-- The other half of what this file is for is the **empty state**. `kensuenobu`, the
-- personal workspace R__dev_seed.sql creates, gets no row in any of the four tables — not
-- one run, not one queue item, not one usage event, and no settings row — which is what
-- makes it the fixture I.7 (#86) renders the zero-state cards against, and what makes
-- "switch the active organization and the dashboard empties" a thing a developer can do
-- rather than a thing a mock has to fake. `acme-labs` is empty for the same reason and by
-- the same means: nothing here names it.
--
-- ---------------------------------------------------------------------------
-- **Why this is a second file, and why it is named to sort after the first.**
--
-- Flyway applies repeatable migrations after every versioned one, **in the order of their
-- descriptions**. This file's rows all find their parents by natural key — the
-- organization by slug, a repository by name — so it must run *after* the seed that
-- creates them, and on a database migrated from empty the two are applied in the same
-- pass. `R__dashboard_dev_seed.sql`, which is the name #68's diagram suggests, sorts
-- *before* `R__dev_seed.sql`; every join here would find nothing, every insert would
-- insert nothing, and — because Flyway re-applies a repeatable migration only when its
-- checksum changes — the second `migrate` would not put it right. `dev_seed_dashboard`
-- sorts after `dev_seed`, which is the whole of the reason for the name.
-- tests/seed.test.sh asserts that ordering by comparing the two descriptions, so a rename
-- fails the pull request rather than the dashboard.
--
-- Two files rather than one because they answer different questions and change on
-- different days: R__dev_seed.sql is *who exists*, and is read by the auth work and by
-- tests/e2e/support/seed.ts; this is *what the loop has done*, and is read by the
-- dashboard's endpoints and screens.
-- ---------------------------------------------------------------------------
--
-- The three properties R__dev_seed.sql documents hold here unchanged, and for the same
-- reasons:
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`, which is
--    `false` in flyway.toml — the configuration `scripts/migrate`, CI and every hand-run
--    migration read — and `true` only in flyway.seed.toml, which only the development
--    compose stack loads by itself. With it false every statement below is
--    `insert … select … where false`: the migration applies, and applies as a no-op.
--
-- 2. **It is idempotent.** Every id is derived from a literal prefix and the row's own
--    issue number (or ordinal), so a second application computes the same ids, and every
--    statement ends `on conflict do nothing`, so it writes none of them. The timestamps
--    are relative to `now()` and would differ on a second pass — which is exactly why the
--    conflict clause matters here more than it did there: nothing is re-computed, because
--    nothing is re-inserted.
--
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural
--    key, never by naming an id twice, so a developer who deleted the demo workspace gets
--    a seed that quietly re-creates what it can.
--
-- **Ids.** `5eed…`, as everywhere: an id beginning `5eed` came from a seed. These are
-- computed rather than written out — `5eed0009-0000-4000-8000-` and the twelve-digit issue
-- number for a run, `5eed000a…` for a queue item, `5eed000b…` and an ordinal for a usage
-- event — because there are seventy-seven of them and a list that long is a list
-- nobody proof-reads. They are as deterministic as literals are: the same input file
-- yields the same uuid on every machine and every pass, which is the property the
-- convention is actually for. `gen_random_uuid()` appears nowhere, and tests/seed.test.sh
-- asserts it.
--
--   | Rows                                    | Id prefix   | Suffix          |
--   |-----------------------------------------|-------------|-----------------|
--   | `runs` (53)                             | `5eed0009…` | issue number    |
--   | `queue_items` (12)                      | `5eed000a…` | issue number    |
--   | `token_usage` (12)                      | `5eed000b…` | ordinal 1–12    |
--   | `workspace_settings` (1)                | —           | keyed by org id |
--
-- ---------------------------------------------------------------------------
-- **Where the mockup's arithmetic does not close, and what this seed does about it.**
--
-- Two of the card's numbers cannot both be true of one seven-day window, and it is worth
-- saying so here rather than leaving #70 to discover it against a fixture that will not
-- add up:
--
--   *PRs merged · 7d* is **27**, and *Human interventions* is **2 this week**. Whatever
--   else closed in that window, the merge rate is `27 / (27 + 2 + failures)` — which is
--   93.1% with no failures and 90% with one. There is no integer count of closed runs for
--   which 27 merged is **92%**, because 92% needs a denominator of 29.35.
--
-- So the seed makes 92% exact over the population it *can* be exact over: **the whole of
-- the seeded history**, which is fourteen days, and which holds 46 merged runs of 50
-- closed — `46 / 50 = 92%`, with no rounding at all. Within the trailing seven days the
-- same rows give 27 merged of 29 closed. Both numbers are computable from these rows;
-- which of them the *Autonomous merge rate* meter renders is #70's to decide, and this
-- note is what it should decide against.
--
-- *Avg. cycle time* — **14m 20s** — is exact over **the runs that closed in the trailing
-- seven days**, all twenty-nine of them, including the two that stopped for a human. That
-- is the definition this seed is built to, and the arithmetic that makes it land is set
-- out at the block that supplies it. Averaging the merged rows alone over the same window
-- gives 13m 19s instead, so the two definitions are distinguishable against these rows and
-- the choice is not a free one.
--
-- One line of the mockup is deliberately **not** modelled: the page head's *"merged 6 pull
-- requests since this morning"*. It is prose rather than a rendered statistic, and "this
-- morning" is a wall-clock boundary a seed whose windows are relative to `now()` cannot
-- pin — a stack brought up at 00:05 has no morning to have merged six things in.
-- ---------------------------------------------------------------------------
--
-- Filed as issue #68 (F.5). Needs #64, #65, #66, #67; extends #23. Feeds #70, #76, #88.

-- ---------------------------------------------------------------------------
-- Active loops — the three non-terminal runs, and the *Loops live* stat.
--
-- Mockup 02's `c-8` table, row for row: issue, workflow tag, stage meter, model pill,
-- elapsed, status pill. `finished_at` is null on all three, which is what
-- `runs_terminal_finished_at` requires of a non-terminal status and what puts them in this
-- card rather than the completions one (decision F2 — one table, two queries).
--
-- `started_at` is `now()` less the elapsed the mockup prints, so the *Elapsed* column
-- reads `12m 40s`, `38m 05s` and `7m 12s` the moment the stack comes up and grows from
-- there. It is the one thing on this page that is honestly a moving number.
--
-- No `pr_number`, and no checks. The active table has no PR column, and a pull-request
-- number here would be a number outside the mockup — which is the rule this whole file is
-- written under. The `review` run has plainly opened one in the fiction; the fiction does
-- not say which, so the seed does not either.
--
-- The stat row's subline reads `2 coding · 1 in review` against a table that draws one
-- `coding`, one `building` and one `review`. The issue's scope settles it in favour of the
-- table — those three statuses, in that order — and the roadmap says the same: the
-- mockup's own `building` row is the third live loop. *Loops live* is `3` either way.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            workflow_tag, model, status,
                            stage_label, stage_index, stage_total, started_at)
select ('5eed0009-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.workflow_tag, seed.model, seed.status,
       seed.stage_label, seed.stage_index, seed.stage_total,
       now() - make_interval(secs => seed.elapsed_seconds)
  from (values
         (482, 'Fix flaky CAN-bus telemetry test',        'helios-firmware',
          'standard-fix', 'claude-fable-5',     'coding',   'Implementing', 4, 6,  760),
         (479, 'Add OTA rollback on failed checksum',     'helios-firmware',
          'feature-loop', 'claude-sonnet-5',    'building', 'Build farm',   5, 7, 2285),
         (476, 'Bump MQTT client, migrate deprecated API', 'helios-firmware',
          'deps-refresh', 'ollama/qwen3-coder', 'review',   'Self-review',  6, 6,  432)
       ) as seed (issue_number, issue_title, repo_name, workflow_tag, model, status,
                  stage_label, stage_index, stage_total, elapsed_seconds)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Recently closed by the loop — the four rows the `c-7` card draws.
--
-- Issue → PR, model, cycle, checks, outcome, exactly as the mockup prints them, and the
-- four newest terminal runs in the workspace so that `order by finished_at desc limit 4`
-- is what selects them. `finished_at` is `now()` less the age below; `started_at` is that
-- less the cycle, so the *Cycle* column is `finished_at - started_at` rather than a stored
-- duration — a run's cycle time is the arithmetic of its own timestamps, and a column
-- holding it would be a third place for it to be wrong.
--
-- Three columns the card does not render, and where their values come from:
--
--   * `workflow_tag` is required and the completions table has no Workflow column, so each
--     row takes one of the four tags the rest of the mockup uses, chosen to match the work
--     its title describes. Nothing renders it today; #73's issues screen will.
--   * `stage_label`/`stage_index`/`stage_total` are required of every run, including one
--     that has stopped. A merged run rests at the end of its workflow (`Merged · 6/6`); a
--     run that stopped for a human rests one short of it (`Awaiting human · 5/6`).
--   * `checks_passed`/`checks_total` are the mockup's, and `#465`'s `13/14` is the reason
--     it is `needs_human` rather than `merged` — one check that did not pass.
--
-- The repositories are chosen from acme-robotics's four to match the work: the pairing
-- screen is the console's, the telemetry buffer is the telemetry service's. Every one of
-- them belongs to this workspace, which the `repo_in_organization` trigger (#65) checks on
-- the way in.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
select ('5eed0009-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.workflow_tag, seed.model, seed.status,
       seed.stage_label, seed.stage_index, seed.stage_total,
       now() - make_interval(secs => seed.closed_seconds_ago + seed.cycle_seconds),
       now() - make_interval(secs => seed.closed_seconds_ago),
       seed.pr_number, seed.checks_passed, seed.checks_total
  from (values
         (474, 'Debounce e-stop interrupt handler',    'helios-firmware',  'standard-fix',
          'claude-fable-5',      'merged',      'Merged',         6, 6, 512, 14, 14,  660,  2520),
         (471, 'Unit tests for motor PID edge cases',  'helios-firmware',  'standard-fix',
          'copilot/gpt-5-codex', 'merged',      'Merged',         6, 6, 509, 14, 14, 1140,  8100),
         (468, 'i18n strings for pairing screen',      'helios-console',   'docs-loop',
          'ollama/qwen3-coder',  'merged',      'Merged',         5, 5, 507, 12, 12,  360, 13800),
         (465, 'Refactor telemetry buffer allocation', 'helios-telemetry', 'feature-loop',
          'claude-sonnet-5',     'needs_human', 'Awaiting human', 5, 6, 504, 13, 14, 2520, 19800)
       ) as seed (issue_number, issue_title, repo_name, workflow_tag, model, status,
                  stage_label, stage_index, stage_total, pr_number,
                  checks_passed, checks_total, cycle_seconds, closed_seconds_ago)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The rest of the trailing seven days — twenty-five runs the card never draws.
--
-- *PRs merged · 7d* is `27` and *Human interventions* is `2 this week`, and the four rows
-- above are three merged and one stopped. These are the other twenty-five: twenty-four
-- merged, and one more that stopped for a human. They exist because the stat is a `count`,
-- and a `count` of four rows is four.
--
-- **The arithmetic that makes *Avg. cycle time* land on 14m 20s.** The average is over
-- every run that closed in the window — twenty-nine of them — so the total has to be
-- `29 × 860s = 24 940s`. The four rows above contribute `660 + 1140 + 360 + 2520 = 4 680s`,
-- which leaves `20 260s` for these twenty-five. `cycle_seconds` below is a spread that
-- sums to exactly that, by construction rather than by arithmetic nobody re-checks:
-- twelve pairs straddling 810s (`810 − 30k` and `810 + 30k` for k = 1…12, which cancel to
-- `24 × 810 = 19 440s`) and one row of 820s that carries the remainder. The pairs give
-- cycle times from 7m 30s to 19m 30s, which is the spread a week of small fixes looks
-- like.
--
-- `finished_at` walks backwards from six hours ago in 6h 24m steps, so the oldest lands at
-- 6d 22h — inside the seven-day window with two hours to spare, however long the stack
-- stays up between `migrate` and the first page load. The newest is older than every row
-- in the card above, which is what keeps the completions card showing the four rows the
-- mockup draws and not one of these.
--
-- Issue numbers are `#300`–`#345`, a range below everything the mockup names, so a row
-- here can never be mistaken for a row a screen was drawn around. `pr_number` is the issue
-- number plus 100, which keeps these clear of the mockup's `#504`–`#512`. Checks are
-- `12 + (n mod 4)`, all passing — a merged run is one whose checks passed — and the run
-- that stopped for a human carries `13/14`, the shape that put `#465` in the same state.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
select ('5eed0009-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.workflow_tag, seed.model, seed.status,
       case seed.status when 'merged' then 'Merged' else 'Awaiting human' end,
       case seed.status when 'merged' then 6 else 5 end,
       6,
       now() - make_interval(secs => 21600 + seed.n * 23040
                                     + case when seed.n <= 12 then 810 - 30 * seed.n
                                            when seed.n <= 24 then 810 + 30 * (seed.n - 12)
                                            else 820 end),
       now() - make_interval(secs => 21600 + seed.n * 23040),
       seed.issue_number + 100,
       case seed.status when 'merged' then 12 + (seed.n % 4) else 13 end,
       case seed.status when 'merged' then 12 + (seed.n % 4) else 14 end
  from (values
         ( 1, 321, 'Guard against NaN in IMU fusion filter',     'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         ( 2, 322, 'Console: paginate the run history table',    'helios-console',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         ( 3, 323, 'Drop the unused CAN frame allocator',        'helios-firmware',
           'standard-fix', 'ollama/qwen3-coder',  'merged'),
         ( 4, 324, 'Bump the Zephyr HAL to 3.7.1',               'helios-firmware',
           'deps-refresh', 'copilot/gpt-5-codex', 'merged'),
         ( 5, 325, 'Telemetry: flush partial batches on shutdown', 'helios-telemetry',
           'standard-fix', 'claude-fable-5',      'merged'),
         ( 6, 326, 'Document the OTA rollback runbook',          'helios-console',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         ( 7, 327, 'Scheduler: honour per-repo concurrency caps', 'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         ( 8, 328, 'Fix the leak in the MQTT reconnect path',    'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         ( 9, 329, 'Console: focus ring on the run table',       'helios-console',
           'standard-fix', 'copilot/gpt-5-codex', 'merged'),
         (10, 330, 'Bump OpenSSL and re-pin the build image',    'atlas-scheduler',
           'deps-refresh', 'ollama/qwen3-coder',  'merged'),
         (11, 331, 'Telemetry: compress payloads above 4 KiB',   'helios-telemetry',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         (12, 332, 'Retire the deprecated /v0 telemetry route',  'helios-telemetry',
           'standard-fix', 'claude-fable-5',      'merged'),
         (13, 333, 'Scheduler: fair-share the queue across repos', 'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'needs_human'),
         (14, 334, 'Fix the watchdog kick order on brown-out',   'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         (15, 335, 'Console: empty state for the queue card',    'helios-console',
           'feature-loop', 'copilot/gpt-5-codex', 'merged'),
         (16, 336, 'Bump the protobuf runtime to 5.29',          'helios-telemetry',
           'deps-refresh', 'ollama/qwen3-coder',  'merged'),
         (17, 337, 'Spell-check the operator quick-start',       'helios-console',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         (18, 338, 'Clamp PID integral wind-up on stall',        'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         (19, 339, 'Scheduler: emit metrics for queue depth',    'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         (20, 340, 'Telemetry: back-pressure on ingest overflow', 'helios-telemetry',
           'standard-fix', 'copilot/gpt-5-codex', 'merged'),
         (21, 341, 'Bump nanopb and regenerate the descriptors', 'helios-firmware',
           'deps-refresh', 'ollama/qwen3-coder',  'merged'),
         (22, 342, 'Console: link runs to their pull requests',  'helios-console',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         (23, 343, 'Fix the off-by-one in flash sector erase',   'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         (24, 344, 'Document the build-farm cache layout',       'atlas-scheduler',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         (25, 345, 'Telemetry: drop duplicate device heartbeats', 'helios-telemetry',
           'standard-fix', 'copilot/gpt-5-codex', 'merged')
       ) as seed (n, issue_number, issue_title, repo_name, workflow_tag, model, status)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The week before that — twenty-one runs, and the whole of the `▲ 8` delta.
--
-- *PRs merged · 7d* renders `27` over `▲ 8 vs last week`, and a delta is a comparison: the
-- previous seven days have to hold `19` merged runs for `27` to be eight more than
-- anything. These are those nineteen, plus one run that stopped for a human and one that
-- **failed** — the sixth status, which nothing above exercises and which the seed would
-- otherwise leave to a fixture.
--
-- With them the seeded history is fifty closed runs of which forty-six merged, which is
-- the exact `92%` the *Autonomous merge rate* meter renders. See the header for why that
-- population is fourteen days and not seven.
--
-- The failed run is the one row here with **no pull request and no checks**: it failed
-- before it opened one, which is the case `runs_merged_has_pr` deliberately permits (a run
-- may fail, or stop for a human, before there is anything to merge) and `runs_checks_paired`
-- requires to be both-null rather than `0/0`. Its stage rests where it stopped, in the
-- build farm.
--
-- `finished_at` starts 7d 7h 30m ago and walks back in 7h 30m steps to 13d 13h — outside
-- the trailing week by more than seven hours at the near end, and inside fourteen days by
-- ten hours at the far end. Cycle times are `600 + 30m` seconds, 10m 30s to 20m 30s;
-- nothing averages these, so the spread only has to be plausible.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
select ('5eed0009-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.workflow_tag, seed.model, seed.status,
       case seed.status when 'merged'      then 'Merged'
                        when 'needs_human' then 'Awaiting human'
                        else 'Build farm' end,
       case seed.status when 'merged' then 6 when 'needs_human' then 5 else 4 end,
       case seed.status when 'failed' then 7 else 6 end,
       now() - make_interval(secs => 604800 + seed.m * 27000 + 600 + 30 * seed.m),
       now() - make_interval(secs => 604800 + seed.m * 27000),
       case seed.status when 'failed' then null else seed.issue_number + 100 end,
       case seed.status when 'merged' then 12 + (seed.m % 4)
                        when 'needs_human' then 13 else null end,
       case seed.status when 'merged' then 12 + (seed.m % 4)
                        when 'needs_human' then 14 else null end
  from (values
         ( 1, 300, 'Fix the CAN arbitration retry storm',        'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         ( 2, 301, 'Console: sortable columns on the issue list', 'helios-console',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         ( 3, 302, 'Bump the CMake toolchain to 3.30',           'helios-firmware',
           'deps-refresh', 'ollama/qwen3-coder',  'merged'),
         ( 4, 303, 'Telemetry: retry uploads with jitter',       'helios-telemetry',
           'standard-fix', 'copilot/gpt-5-codex', 'merged'),
         ( 5, 304, 'Document the pairing handshake',             'helios-console',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         ( 6, 305, 'Scheduler: cancel orphaned jobs on restart', 'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         ( 7, 306, 'Fix the stack overflow in the logging task', 'helios-firmware',
           'standard-fix', 'claude-fable-5',      'failed'),
         ( 8, 307, 'Bump gRPC and drop the vendored fork',       'atlas-scheduler',
           'deps-refresh', 'ollama/qwen3-coder',  'merged'),
         ( 9, 308, 'Console: persist the tenant switcher choice', 'helios-console',
           'feature-loop', 'copilot/gpt-5-codex', 'merged'),
         (10, 309, 'Telemetry: index device_id on the events table', 'helios-telemetry',
           'standard-fix', 'claude-sonnet-5',     'merged'),
         (11, 310, 'Fix I²C clock stretching on cold boot',      'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         (12, 311, 'Scheduler: expose a dry-run mode',           'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'needs_human'),
         (13, 312, 'Document the telemetry retention policy',    'helios-telemetry',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         (14, 313, 'Bump zlib and re-run the fuzz corpus',       'helios-firmware',
           'deps-refresh', 'copilot/gpt-5-codex', 'merged'),
         (15, 314, 'Console: badge runs that await a human',     'helios-console',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         (16, 315, 'Fix the double free on OTA abort',           'helios-firmware',
           'standard-fix', 'claude-fable-5',      'merged'),
         (17, 316, 'Telemetry: drop rows past the retention window', 'helios-telemetry',
           'standard-fix', 'ollama/qwen3-coder',  'merged'),
         (18, 317, 'Scheduler: honour maintenance windows',      'atlas-scheduler',
           'feature-loop', 'claude-sonnet-5',     'merged'),
         (19, 318, 'Document the firmware release checklist',    'helios-firmware',
           'docs-loop',    'ollama/qwen3-coder',  'merged'),
         (20, 319, 'Console: collapse long issue titles',        'helios-console',
           'standard-fix', 'copilot/gpt-5-codex', 'merged'),
         (21, 320, 'Bump mbedTLS to 3.6.2',                      'helios-firmware',
           'deps-refresh', 'claude-fable-5',      'merged')
       ) as seed (m, issue_number, issue_title, repo_name, workflow_tag, model, status)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Up next in queue — twelve items, of which the card draws five.
--
-- *Queued issues* renders `12` over `est. 9h 40m of autonomous work`, and the card below
-- it renders positions 1–5. Those five are the mockup's, in the mockup's order, with the
-- mockup's effort chips and workflow tags: `#485` M, `#486` L, `#488` XS, `#490` XL,
-- `#491` S. The other seven are what makes the count `12` — the queue the card is the top
-- of.
--
-- **`est. 9h 40m` is 580 minutes, and it is a `sum`, not a count.** The five visible rows
-- carry 360 of them; the seven below carry the remaining 220. One item — `#496` — carries
-- **no estimate at all**, which is not zero: `est_minutes` is nullable precisely so that
-- "not estimated yet" has a value, `sum` skips it without being asked, and a queue where
-- every row happened to be estimated would leave that path unexercised by the fixture
-- every screen is built against. Twelve rows, eleven estimates, 580 minutes.
--
-- The estimates are deliberately *not* a function of the effort chip — V009 says why: the
-- chip is a size a person chose and the estimate is minutes something measured, and if one
-- were derived from the other the stat would be a restatement of the chips rather than a
-- second fact. So two `s` items sit at 30 and 25 minutes, and that is the point.
--
-- `position` is dense from 1, which is the writer's convention rather than a constraint
-- (the unique key is deferrable so that #73's reorder can swap inside a transaction).
-- `enqueued_at` runs oldest-first — position 1 joined twelve hours ago, position 12 an
-- hour ago — so the queue reads as a queue rather than as a list that happens to be
-- ordered.
--
-- All five chips are exercised across the twelve, which is the acceptance criterion the
-- CHECK on `effort` exists for, and all four workflow tags the mockups use appear.
--
-- **This is the one statement here that names its arbiter**, and the deferrable key is
-- why. `on conflict do nothing` with no target asks PostgreSQL to take *any* unique
-- violation as a reason to skip the row, and PostgreSQL refuses outright on a table
-- carrying a deferrable unique constraint — `ON CONFLICT does not support deferrable
-- unique constraints as arbiters`, class 55000, at the statement rather than at the row.
-- `on conflict (id)` names the primary key, which is immediate, and is the conflict a
-- second application actually meets: the ids are computed from the issue numbers, so the
-- re-run collides on the primary key before it can collide on anything else, and skipping
-- the row means the deferred position key is never given a duplicate to find at commit.
-- ---------------------------------------------------------------------------
insert into ouroboros.queue_items (id, organization_id, github_repo_id, issue_number,
                                   issue_title, effort, workflow_tag, position,
                                   est_minutes, enqueued_at)
select ('5eed000a-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.effort, seed.workflow_tag, seed.position, seed.est_minutes,
       now() - make_interval(hours => 13 - seed.position)
  from (values
         ( 1, 485, 'Watchdog reset on I²C bus lockup',            'helios-firmware',
           'm',  'standard-fix',  45),
         ( 2, 486, 'Expose battery health over BLE GATT',         'helios-firmware',
           'l',  'feature-loop',  90),
         ( 3, 488, 'Typo sweep in operator manual',               'helios-firmware',
           'xs', 'docs-loop',     15),
         ( 4, 490, 'Migrate build to Zephyr 4.2',                 'helios-firmware',
           'xl', 'deps-refresh', 180),
         ( 5, 491, 'Add CRC to config persistence layer',         'helios-firmware',
           's',  'standard-fix',  30),
         ( 6, 487, 'Rate-limit telemetry uploads on cellular',    'helios-telemetry',
           's',  'standard-fix',  30),
         ( 7, 489, 'Console: surface OTA rollback history',       'helios-console',
           'm',  'feature-loop',  45),
         ( 8, 492, 'Document build-farm cache invalidation',      'atlas-scheduler',
           'xs', 'docs-loop',     15),
         ( 9, 493, 'Scheduler: retry backoff for stuck jobs',     'atlas-scheduler',
           'l',  'feature-loop',  90),
         (10, 494, 'Bump libsodium and re-run the FIPS checks',   'helios-firmware',
           's',  'deps-refresh',  25),
         (11, 495, 'Fix the off-by-one in ring buffer wrap',      'helios-telemetry',
           'xs', 'standard-fix',  15),
         (12, 496, 'Telemetry: split ingest into a worker pool',  'helios-telemetry',
           'm',  'feature-loop', null)
       ) as seed (position, issue_number, issue_title, repo_name,
                  effort, workflow_tag, est_minutes)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = seed.repo_name
 where ${ouro_dev_seed}
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Token spend · today — twelve events, four providers, 4.2M tokens, $18.60.
--
-- The stat renders `4.2M` over `≈ $18.60 across 4 providers`, and every part of that is an
-- aggregate over `token_usage_daily` for the current UTC day (V010 fixes the day to UTC so
-- that the same ledger yields the same days to every caller). A ledger rather than a
-- counter is decision F10, so this is twelve *events* that add up rather than one row
-- saying `4200000`.
--
--   | Provider    | Events | Tokens    | Cost      |
--   |-------------|-------:|----------:|----------:|
--   | `anthropic` |      3 | 1 900 000 |   $11.40  |
--   | `copilot`   |      3 | 1 080 000 |    $5.40  |
--   | `cursor`    |      3 |   720 000 |    $1.80  |
--   | `ollama`    |      3 |   500 000 | unpriced  |
--   | **total**   | **12** | **4 200 000** | **$18.60** |
--
-- The four are mockup 07's, which is where this product's providers are drawn: Anthropic
-- Claude, GitHub Copilot, Cursor, and Ollama on a workstation. Three of them are the
-- providers behind mockup 02's own model pills; `cursor` is the fourth, and it is a
-- provider mockup 07 already shows rather than one invented to make a count. `provider` is
-- stored folded because `count(distinct provider)` is the `4` in the subline, and
-- `Anthropic` beside `anthropic` would make it five.
--
-- **`ollama` is unpriced, and that is what the `≈` on the card means.** V010 makes
-- `cost_cents` nullable so that "nobody has priced this" has a value that is not zero, and
-- local inference on a workstation is the honest case of it — mockup 07 renders `$0.00`
-- for exactly those two rows. So the day's cost is the sum of the *priced* events, it is
-- `$18.60`, and `token_usage_daily.unpriced_events` is non-zero, which is how a reader
-- knows the total is a lower bound. Pricing the rest of the ledger from a rate card is
-- #92's; these are recorded amounts on twelve demo calls, chosen to total the figure the
-- mockup prints, and #92 will find nothing here to re-price that it did not write.
--
-- `tokens_in`/`tokens_out` split four to one, which is the shape of an agentic call —
-- a large prompt and a small patch — and is kept as two columns because every provider
-- prices them differently (V010).
--
-- **`run_id` follows the model.** An event is attributed to a run when the run was
-- performed with that event's model and there is exactly one such run: the two Claude
-- events land on the two live Claude runs, the Copilot one on `#471`, and two of the
-- Ollama ones on the live `#476` and the closed `#468`. The rest are null, which is the
-- ordinary case V010 made the column nullable for — planning, triage, and the chat
-- surfaces of mockups 19 and 20 spend tokens no run caused. `cursor` has no run at all,
-- which is what unattributed spend looks like.
--
-- `occurred_at` is spread across the part of today that has already happened: the day's
-- UTC midnight plus `n/13` of the time since. Every event is therefore inside the current
-- UTC day and in the past, whatever hour the stack is brought up at — including 00:05,
-- where all twelve land within the first five minutes rather than in tomorrow.
-- ---------------------------------------------------------------------------
insert into ouroboros.token_usage (id, organization_id, run_id, provider, model,
                                   tokens_in, tokens_out, cost_cents, occurred_at)
select ('5eed000b-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", run.id, seed.provider, seed.model,
       seed.tokens_total / 5 * 4, seed.tokens_total / 5, seed.cost_cents,
       utc_day.day_start + (now() - utc_day.day_start) * (seed.n::double precision / 13)
  from (values
         ( 1, 'anthropic', 'claude-fable-5',       900000, 540.0000,  482),
         ( 2, 'anthropic', 'claude-sonnet-5',      620000, 372.0000,  479),
         ( 3, 'anthropic', 'claude-haiku-4-5',     380000, 228.0000, null),
         ( 4, 'copilot',   'copilot/gpt-5-codex',  500000, 250.0000,  471),
         ( 5, 'copilot',   'copilot/gpt-5-codex',  340000, 170.0000, null),
         ( 6, 'copilot',   'copilot/gpt-5-codex',  240000, 120.0000, null),
         ( 7, 'cursor',    'cursor/composer-2',    360000,  90.0000, null),
         ( 8, 'cursor',    'cursor/composer-2',    220000,  55.0000, null),
         ( 9, 'cursor',    'cursor/composer-2',    140000,  35.0000, null),
         (10, 'ollama',    'ollama/qwen3-coder',   240000,     null,  476),
         (11, 'ollama',    'ollama/qwen3-coder',   160000,     null,  468),
         (12, 'ollama',    'ollama/qwen3-coder',   100000,     null, null)
       ) as seed (n, provider, model, tokens_total, cost_cents, run_issue)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  cross join (select date_trunc('day', now() at time zone 'utc') at time zone 'utc')
          as utc_day (day_start)
  left join ouroboros.runs run
    on run.organization_id = org."id" and run.issue_number = seed.run_issue
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Auto-merge when checks pass — the one switch, and the page's only write.
--
-- Mockup 02's *Loop pulse* card draws the switch **on**, so the demo workspace has said
-- yes: `auto_merge_on_checks = true`, attributed to Ken, who owns it. That is the whole of
-- this table's seed, and it is deliberately one row and not three.
--
-- `acme-labs` and `kensuenobu` get **no row**, which is not an omission but the other half
-- of what V011 designed: row creation is lazy, absence means every setting is at its
-- default, and `workspace_settings_effective` resolves that to `false` for a workspace
-- that has never answered. A seed that wrote `false` rows for the other two would make the
-- fixture unable to tell "answered no" from "never asked" — and it is the second of those
-- that the empty-state work (#86) and the settings endpoint (#74) have to get right.
--
-- `updated_at` comes from the column default here, and would come from the
-- `touch_updated_at` trigger on any later change. `updated_by` is a person rather than
-- null because the switch being on is a choice somebody made, and the audit pair the table
-- keeps is *when* and *by whom*.
-- ---------------------------------------------------------------------------
insert into ouroboros.workspace_settings (organization_id, auto_merge_on_checks, updated_by)
select org."id", true, person."id"
  from ouroboros.organization org
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;
