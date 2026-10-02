-- R__dev_seed_workspace_metrics.sql — mockup 15's Insights page, as rollup history, in a
-- development database and nowhere else.
--
-- [`docs/mockups/15-insights.html`](../../docs/mockups/15-insights.html) draws eleven visuals over
-- thirty days. Filed as issue #436 (BI.5). The rollup extractors (#433) fill `metric_daily` from
-- the source planes, and the other seeds hold days or weeks of those planes, not ninety days of
-- them. So this file writes the **rollup history**: ninety days of `metric_daily` for
-- `acme-robotics`. That covers the 30-day window the page opens on, the 30 days before it (every
-- delta's prior window) and 30 more, so 7d, 30d and 90d each read a whole window.
--
-- ---------------------------------------------------------------------------
-- **Components are seeded. Values are computed.**
-- ---------------------------------------------------------------------------
--
-- The ledger below is one row per day of *components*: PRs closed, merged, merged autonomously,
-- merged untouched, reverted; spend and tokens; extra builds and test cases; recoveries; and how
-- many of the day's merged loops were estimated at each effort. Every `value` is computed from
-- those in the statement: a rate is `numerator / denominator`, a median is `percentile_cont` over
-- the day's samples, and no KPI, delta or insight figure is written anywhere in this file.
-- tests/seed.sql re-derives each one the registry's way (sum the components, divide once; pool
-- the samples) and tests/seed.test.sh refuses the figures themselves.
--
--   | Rendered (30d)                         | Falls out of                                            |
--   |----------------------------------------|---------------------------------------------------------|
--   | Autonomous merge rate 92% ▲ 3pts       | 96 / 104 closed vs 97 / 109 in the prior 30 days         |
--   | Merged w/o human edits 78%             | 76 untouched / 97 merged                                |
--   | Median cycle 14m 20s ▼ 2m              | the pooled samples' median vs the prior window's 16m 20s |
--   | Cost per merged PR $1.87 ▼ $0.41       | Σ cost_cents / Σ merged_prs, each window                |
--   | Human interventions — 20 ▼ 5           | #434's twenty events vs 25 in the prior window          |
--   | Throughput ending at 6                 | today's merged_prs; the 7-day sum is the dashboard's 27 |
--   | `Aug 4 — 6 merged · $9.12 · 1 int.`    | four days ago: merged, cost and interventions that day  |
--   | Cost curve, spike, $18.60 endpoint     | eight days ago and today's cost_cents                   |
--   | Stage medians, *sum to 8m 20s*         | the stage samples' pooled medians                       |
--   | Builds 412 · 377 ✓ / 35 ✗              | the farm seed's jobs plus the ledger's extras           |
--   | Suites 14/10/5/3/1, *0.12%*            | the test plane's failures plus extras, over cases run   |
--   | Effort ladder XS 6m … XL 2h 10m        | each effort's pooled lead-time samples                  |
--   | *89% within band*                      | nine graded merges, eight inside their band (#435)      |
--   | Tokens by stage 71M … 3M, *31% local*  | each day's tokens split by task kind, and the part of   |
--   |                                        | each kind a local model served (V083, #438)             |
--   | DORA cells and their sparklines        | deploys, lead time, reverts and recoveries per day      |
--
-- ---------------------------------------------------------------------------
-- **Reconciled with the other seeds where they overlap — and where they cannot be, said so.**
-- ---------------------------------------------------------------------------
--
-- Three families are **derived** from source planes the other seeds already hold, with the
-- extractor's own grouping, so the rollup re-deriving one of those days writes what is here:
--
--   * `interventions` — the last 30 days are `intervention_cause_daily` over #434's twenty events,
--     every repository, exactly. Only the two earlier windows are summarised.
--   * `builds` — the farm seed's (#249) finished jobs, every repository and day, **plus** the
--     ledger's extra builds on helios-firmware. Today has no extra, so today is exactly the farm.
--     Since #509 every extra is a row: R__dev_seed_workspace_metrics_analyzer.sql writes each
--     day's extra builds and failures as the Build Analyzer's corpus, and sorts after this file
--     so the farm read here does not count them twice. Days 30–87 gained 115 builds for it, so
--     the ninety days hold mockup 18's 1,284; the thirty this page opens on did not change.
--   * `tests` — the test plane's (#328, #434) finished attempts, every repository, suite and
--     day, **plus** the ledger's extra cases and suite failures. Today again has no extra.
--
-- So no seeded number is ever below what another seed stores for the same repository and day,
-- and tests/seed.sql asserts that floor.
--
-- The rest are **summaries** on `acme-robotics/helios-firmware`. Each one's source plane is
-- seeded too thinly to stand for thirty days:
--
--   * `throughput`, `dora`, `effort` — the PR plane holds #514 under verification and the nine
--     graded merges below, not a month of merges. The calibration loops' PRs are inside the ledger:
--     each day they merged counts them, and each one's lead time is a sample of its effort that day.
--     The 7-day merged sum is the dashboard seed's (#68) *PRs merged · 7d — 27* by number; the
--     dashboard counts runs across the workspace, so the match is by number, not by row.
--   * `cycle` — the dashboard's 44 recent runs carry mockup 02's cycles. This history stands for
--     the whole month and does not contain them sample for sample.
--   * `cost` — usage is attributed to a repository through its run, and almost every seeded call
--     has none. Today's 1860 cents and 4.2M tokens are the dashboard's *Token spend · today* by
--     number. The routing seed's (#192) 370 calls are mockup 06's month compressed into the day
--     and a half before the seed ran, so they are not a day of spend and are not followed.
--
-- **Where the mockup contradicts itself or the source planes, the source plane wins** (#436, the
-- same call #434 made):
--
--   * Human interventions renders 20 in 30 days against 25 (▼ 5). The mockup's `2/wk` cannot hold
--     beside its own twenty-event card.
--   * Test failures by suite are 14 / 10 / 5 / 3 / 1, not 14 / 9 / 6 / 3 / 1. The test plane
--     already holds ten HIL-rig failures (#328's three on #482, #434's seven), so `physical · HIL`
--     cannot be 6. The total stays 33, so *0.12% of everything that ran* still computes, and the
--     pass rate is then 99.9% rather than the mockup's 98.9%.
--   * The Verify stage is the workflow's `review` node, which is what the run plane calls it.
--   * Lead time is a mean of the same loop-start-to-merge interval the effort ladder takes medians
--     of, so it is about half an hour, not the mockup's 3h 10m.
--   * Cost is $1.87 per merged PR, as the KPI says, so the month is about $181, not the strip's
--     $563.20. The $18.60 endpoint and the $31.40 spike are kept.
--
-- **And three visuals have no storage here**, so nothing in this file can seed them:
--
--   | Visual                               | Waits for                                          |
--   |--------------------------------------|----------------------------------------------------|
--   | Model scoreboard (incl. $0.00 local) | BJ.3 (#439) — its registry entries and aggregation |
--   | $20 budget guide, $600 cap, 90% alert | provider caps (AF.4), decision I8                  |
--   | Flaky tests card                     | nothing: it reads AT.3's `flake_scores`, which the  |
--   |                                      | test-results seed holds (one `watching` case); this |
--   |                                      | file writes no flake row of its own                 |
--
-- ---------------------------------------------------------------------------
-- **The rollup and this file share the table.**
-- ---------------------------------------------------------------------------
--
-- `metric_rollup_state` is written for every extractor family with `last_filled_day` yesterday,
-- so ouroboros-rest's first tick does not backfill ninety days over this history. Its hourly tail
-- still re-fills **today** from the source planes, and from tomorrow its consolidation re-fills
-- the trailing days. For `interventions`, `builds` and `tests` that changes nothing; for the
-- summaries it replaces the seeded day with the thinner source answer. That is the boundary
-- above, working as designed. `scripts/clean-dev` and a fresh `migrate` restore the seeded page.
--
-- ---------------------------------------------------------------------------
-- **The calibration rows are real (#435).**
-- ---------------------------------------------------------------------------
--
-- *"89% of issues land within their predicted band"* is read from `estimate_outcomes`, which
-- needs merged loop PRs with estimates. Nine closed tickets `#520`–`#528` each get a loop, a merged
-- PR and the estimate in force when the loop started, and `record_estimate_outcome()` — #435's own
-- fill — grades them: eight inside their band, `#528` over it, across all five efforts. The numbers
-- are no other seed's — canonical tickets are `#540`–`#591` and runs `#12`–`#496` — and
-- tests/seed.sql's collision check keeps runs off a planning ticket's number. Each loop merges
-- 16–29 days ago, outside the dashboard's two weekly windows, and its lead time is its effort's
-- 30-day centre, so the effort ladder holds it as a sample.
--
-- ---------------------------------------------------------------------------
--
-- Every day is relative to `now()` as a UTC day, the extractors' bucketing (V078). No date is
-- written. The same three properties as every seed: every statement is behind `${ouro_dev_seed}`;
-- every insert ends `on conflict do nothing`, with a `not exists` guard on the estimates (whose
-- version trigger raises before a conflict is looked for) and on the grading fill (which upserts);
-- and every parent from another seed is found by natural key. `metric_daily` ids are the
-- table's identity. The rest are `5eed005e…` tickets, `5eed005f…` runs, `5eed0060…` pull requests
-- and `5eed0061…` estimates, each ending in the ticket number.
--
-- **Order.** It reads the farm, test-results, sources and interventions seeds, so it must sort
-- after all of them: `dev_seed_workspace_metrics` does. `dev_seed_workspace_insights` would sort
-- before `dev_seed_workspace_interventions`, and on a database migrated from empty the
-- intervention history would have no events to count.
--
-- Filed as issue #436 (BI.5). Needs #432–#435 and the seeds above. Asserted in tests/seed.sql and
-- tests/seed.test.sh; tests/insights-invariants.sql probes the stored rows, and
-- tests/verify-insights-invariants.sh proves each probe goes red.

-- ---------------------------------------------------------------------------
-- The nine graded loops' tickets — closed by the merge that graded them.
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status,
   meta)
select ('5eed005e-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", src.id, seed.number::text, '#' || seed.number,
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/issues/'
         || seed.number,
       seed.title, null, 'closed', seed.labels::jsonb, seed.author,
       now() - make_interval(days => seed.days_ago + 20),
       (date_trunc('day', now() at time zone 'UTC') - make_interval(days => seed.days_ago)
          + interval '15 hours') at time zone 'UTC',
       now() - interval '40 seconds',
       'sized',
       jsonb_build_object('github', jsonb_build_object('owner', src.config ->> 'login',
                                                       'repo',  'helios-firmware'))
  from (values
         (520, 16, 'maya-chen',   '["bootloader"]',  'Bootloader: log the slot it booted from'),
         (521, 17, 'kensuenobu',  '["watchdog"]',    'Watchdog: name the task that starved it'),
         (522, 19, 'jorge-reyes', '["imu"]',         'IMU: debounce the tap-to-wake interrupt'),
         (523, 21, 'maya-chen',   '["telemetry"]',   'Telemetry: batch frames under link congestion'),
         (524, 23, 'kensuenobu',  '["flash"]',       'Flash: wear-level the settings partition'),
         (525, 25, 'jorge-reyes', '["can"]',         'CAN: expose bus-off counters over diagnostics'),
         (526, 26, 'maya-chen',   '["motor"]',       'Motor: clamp the integral term on direction change'),
         (527, 28, 'kensuenobu',  '["power"]',       'Power: report brown-out resets in the boot banner'),
         (528, 29, 'jorge-reyes', '["ota"]',         'OTA: verify the image hash before marking it pending')
       ) as seed (number, days_ago, author, labels, title)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Their loops — merged at 15:00 UTC on their day, after their effort's 30-day centre.
--
-- XS 6m, S 11m, M 19m, L 48m, XL 2h 10m: the same centres the ledger's effort samples are drawn
-- around, so each loop *is* one of its day's samples (tests/seed.sql checks it is). Four are
-- `standard-fix` and five `feature-loop`: mockup 05's *used by 42% of runs* is 22 of the 53 runs
-- in the last thirty days without them and 26 of 62 with them, so the workflows page still reads
-- what it read.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            loop_seq, workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
select ('5eed005f-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.number, ticket.title,
       1365 + seed.number, seed.workflow_tag, 'claude-fable-5', 'merged',
       'Merged', 6, 6,
       merged.at - seed.lead,
       merged.at,
       seed.number + 100, 12, 12
  from (values
         (520, 16, interval '6 minutes',           'standard-fix'),
         (521, 17, interval '11 minutes',          'standard-fix'),
         (522, 19, interval '19 minutes',          'feature-loop'),
         (523, 21, interval '48 minutes',          'feature-loop'),
         (524, 23, interval '2 hours 10 minutes',  'feature-loop'),
         (525, 25, interval '6 minutes',           'standard-fix'),
         (526, 26, interval '11 minutes',          'standard-fix'),
         (527, 28, interval '19 minutes',          'feature-loop'),
         (528, 29, interval '48 minutes',          'feature-loop')
       ) as seed (number, days_ago, lead, workflow_tag)
  cross join lateral (
    select (date_trunc('day', now() at time zone 'UTC') - make_interval(days => seed.days_ago)
              + interval '15 hours') at time zone 'UTC' as at
  ) merged
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.tickets ticket    on ticket.organization_id = org."id"
                                  and ticket.external_key = '#' || seed.number
                                  and ticket.id::text like '5eed005e-%'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Their pull requests — opened two minutes into the loop, merged when it finished.
-- ---------------------------------------------------------------------------
insert into ouroboros.pull_requests (id, organization_id, source_id, external_number,
                                     external_url, title, head_branch, base_branch, state,
                                     merged_at, run_id, ticket_id, created_at)
select ('5eed0060-0000-4000-8000-' || lpad(ticket.external_id, 12, '0'))::uuid,
       org."id", ticket.source_id, run.pr_number,
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/pull/'
         || run.pr_number,
       ticket.title, 'ouro/issue-' || ticket.external_id, 'main', 'merged',
       run.finished_at, run.id, ticket.id,
       run.started_at + interval '2 minutes'
  from ouroboros.organization org
  join ouroboros.tickets ticket     on ticket.organization_id = org."id"
                                   and ticket.id::text like '5eed005e-%'
  join ouroboros.ticket_sources src on src.id = ticket.source_id
  join ouroboros.runs run           on run.organization_id = org."id"
                                   and run.issue_number = ticket.external_id::integer
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The estimate each loop was queued under — written an hour before it started.
--
-- Bands in minutes. `#528`'s 25–40 is the miss: its loop took 48. The guard is the intake seed's,
-- for its reason: the version trigger raises before a conflict is looked for.
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, ticket_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select ('5eed0061-0000-4000-8000-' || lpad(ticket.external_id, 12, '0'))::uuid,
       ticket.id, 1, seed.effort, seed.confidence, run.workflow_tag, 'claude-fable-5',
       jsonb_build_object('files',       seed.files::jsonb,
                          'est_tokens',  seed.est_tokens,
                          'cycle_min',   seed.cycle_min,
                          'cycle_max',   seed.cycle_max,
                          'est_minutes', (seed.cycle_min + seed.cycle_max) / 2),
       'low', seed.risk_note,
       jsonb_build_object('estimator',   'heuristic-v0',
                          'sized_at',    to_char((run.started_at - interval '1 hour')
                                                   at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0,
                          'signals',     '[]'::jsonb),
       run.started_at - interval '1 hour'
  from (values
         (520, 'xs', 96, '["boot/main.c"]',                           30000,   4,   8,
          'A log line in the boot path.'),
         (521, 's',  90, '["drivers/watchdog.c"]',                    60000,   8,  14,
          'One driver; the starvation test exists.'),
         (522, 'm',  85, '["drivers/imu_bmi270.c", "tests/unit/test_imu_tap.c"]',
                                                                       150000,  15,  25,
          'Interrupt timing on one sensor.'),
         (523, 'l',  78, '["src/telemetry/batch.c", "src/telemetry/link.c", "tests/unit/test_batch.c"]',
                                                                       320000,  40,  60,
          'Changes framing under load; the soak test covers it.'),
         (524, 'xl', 70, '["drivers/flash.c", "src/settings/store.c", "src/settings/wear.c", "tests/hil/test_settings_wear.py"]',
                                                                       700000, 100, 160,
          'Touches every settings write; a wear bug corrupts config.'),
         (525, 'xs', 97, '["src/can/diag.c"]',                        30000,   4,   8,
          'Two counters on an existing diagnostics frame.'),
         (526, 's',  91, '["drivers/motor_pid.c"]',                   60000,   9,  15,
          'One clamp in the controller step.'),
         (527, 'm',  86, '["boot/banner.c", "drivers/power.c"]',      150000,  16,  24,
          'Reads a reset-cause register at boot.'),
         (528, 'l',  80, '["src/ota/verify.c", "src/ota/manifest.c", "tests/unit/test_ota_verify.c"]',
                                                                       280000,  25,  40,
          'The image-hash check sits on the update path.')
       ) as seed (number, effort, confidence, files, est_tokens, cycle_min, cycle_max, risk_note)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.tickets ticket   on ticket.organization_id = org."id"
                                 and ticket.external_key = '#' || seed.number
                                 and ticket.id::text like '5eed005e-%'
  join ouroboros.runs run         on run.organization_id = org."id"
                                 and run.issue_number = seed.number
 where not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.ticket_id = ticket.id
                      and prior.version >= 1)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The grades — #435's fill, once per merged PR it has not graded yet.
-- ---------------------------------------------------------------------------
select count(outcome.pr_id) as graded
  from ouroboros.pull_requests pr
  cross join lateral ouroboros.record_estimate_outcome(pr.organization_id, pr.id) outcome
 where pr.id::text like '5eed0060-%'
   and not exists (select 1 from ouroboros.estimate_outcomes outcome where outcome.pr_id = pr.id)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Ninety days of metric_daily.
--
-- One statement, because the ledger is read by every family and a CTE is the one scope a single
-- statement can share. `d` is days before today (UTC); the windows are d 0–29 (the page's 30d),
-- 30–59 (its prior window) and 60–89.
--
-- Ledger columns — components, never values:
--   closed, merged, autonomous, untouched, reverted     loop PRs, the throughput and CFR components
--   cost_cents, tokens, unpriced_tokens                  priced spend; every token; the unpriced part
--                                                        (`token_kinds` splits tokens by task kind)
--   extra_builds, extra_failed_builds                    helios-firmware builds beyond the farm seed's
--                                                        (#509's analyzer seed writes each one)
--   deploys                                              successful default-branch builds
--   extra_cases                                          test cases beyond the test plane's
--   recoveries, recovery_ms                              failure-to-green recoveries and their total
--   xs, s, m, l, xl, unestimated                         that day's merged loops by predicted effort
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_daily
  (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, numerator, denominator,
   meta)
with scope as (
  select org."id" as organization_id,
         (gh.login || '/' || repo.name) as repo_ref,
         (now() at time zone 'UTC')::date as today
    from ouroboros.organization org
    join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
   where org."slug" = 'acme-robotics'
),
ledger (d, closed, merged, autonomous, untouched, reverted, cost_cents, tokens, unpriced_tokens,
        extra_builds, extra_failed_builds, deploys, extra_cases, recoveries, recovery_ms,
        xs, s, m, l, xl, unestimated) as (
  values
    ( 0, 6, 6, 6, 5, 0,  1860,   4200000,  500000,  0, 0,  8,    0, 3,  3194000, 2, 1, 1, 0, 2, 0),
    ( 1, 4, 4, 4, 3, 0,   530,   3965477,  158000, 16, 0,  8,  912, 0,        0, 1, 1, 1, 0, 0, 1),
    ( 2, 4, 3, 3, 3, 0,   524,   3920585,  156000,  6, 0,  3,  889, 0,        0, 0, 1, 1, 0, 1, 0),
    ( 3, 4, 4, 4, 3, 0,   518,   3875693,  155000,  4, 0,  3,  926, 0,        0, 1, 1, 1, 1, 0, 0),
    ( 4, 6, 6, 6, 5, 0,   912,   6823613,  272000, 17, 4,  6,  903, 4,  4542000, 2, 1, 2, 1, 0, 0),
    ( 5, 3, 3, 3, 2, 1,   512,   3830800,  153000, 15, 0,  7,  881, 0,        0, 1, 1, 0, 0, 1, 0),
    ( 6, 1, 1, 1, 0, 0,   506,   3785908,  151000, 19, 0,  8,  917, 0,        0, 0, 0, 0, 0, 0, 1),
    ( 7, 4, 4, 4, 4, 0,   500,   3741016,  149000, 17, 4,  6,  894, 4,  4755000, 1, 1, 1, 1, 0, 0),
    ( 8, 3, 3, 3, 2, 0,  3140,  23493581,  939000,  7, 0,  3,  931, 0,        0, 0, 1, 1, 1, 0, 0),
    ( 9, 6, 5, 5, 4, 0,   494,   3696124,  147000,  4, 0,  1,  908, 0,        0, 2, 1, 2, 0, 0, 0),
    (10, 4, 4, 4, 3, 0,   488,   3651232,  146000, 16, 0,  6,  885, 0,        0, 1, 1, 1, 0, 1, 0),
    (11, 2, 2, 2, 1, 0,   483,   3613821,  144000, 19, 4,  5,  922, 4,  5039000, 0, 1, 0, 1, 0, 0),
    (12, 3, 3, 3, 2, 0,   477,   3568929,  142000, 17, 0,  6,  899, 0,        0, 1, 0, 1, 0, 0, 1),
    (13, 5, 4, 4, 4, 0,   471,   3524037,  140000, 15, 4,  4,  877, 4,  5181000, 1, 1, 1, 1, 0, 0),
    (14, 2, 2, 2, 1, 0,   465,   3479145,  139000, 16, 0,  5,  913, 0,        0, 0, 0, 1, 0, 0, 1),
    (15, 4, 4, 4, 4, 0,   459,   3434253,  137000,  6, 0,  2,  890, 0,        0, 1, 1, 0, 1, 1, 0),
    (16, 4, 4, 3, 3, 0,   453,   3389361,  135000,  3, 0,  1,  927, 0,        0, 1, 1, 1, 1, 0, 0),
    (17, 3, 3, 3, 2, 1,   447,   3344468,  133000, 17, 0,  5,  904, 0,        0, 1, 1, 0, 0, 1, 0),
    (18, 4, 3, 3, 3, 0,   441,   3299576,  131000, 16, 4,  4,  882, 4,  5535000, 0, 1, 1, 1, 0, 0),
    (19, 2, 2, 2, 1, 0,   435,   3254684,  130000, 19, 0,  6,  918, 0,        0, 1, 0, 1, 0, 0, 0),
    (20, 4, 4, 4, 3, 0,   429,   3209792,  128000, 17, 0,  5,  895, 0,        0, 1, 1, 0, 1, 0, 1),
    (21, 2, 2, 2, 2, 0,   423,   3164900,  126000, 15, 4,  3,  932, 4,  5748000, 0, 1, 0, 1, 0, 0),
    (22, 4, 3, 3, 2, 0,   417,   3120007,  124000,  4, 0,  1,  909, 0,        0, 1, 0, 1, 0, 1, 0),
    (23, 4, 4, 4, 3, 0,   411,   3075115,  123000,  4, 0,  1,  886, 0,        0, 1, 1, 0, 1, 1, 0),
    (24, 4, 4, 4, 3, 0,   405,   3030223,  121000, 16, 0,  4,  923, 0,        0, 1, 1, 0, 1, 0, 1),
    (25, 3, 2, 2, 2, 0,   399,   2985331,  119000, 17, 4,  3,  900, 4,  6032000, 1, 0, 1, 0, 0, 0),
    (26, 3, 3, 3, 2, 1,   394,   2947921,  117000, 15, 0,  4,  878, 0,        0, 0, 1, 1, 0, 1, 0),
    (27, 3, 2, 2, 2, 0,   388,   2903028,  116000, 18, 4,  3,  914, 4,  6174000, 0, 1, 0, 0, 0, 1),
    (28, 1, 1, 1, 0, 0,   382,   2858136,  114000, 16, 0,  4,  891, 0,        0, 0, 0, 1, 0, 0, 0),
    (29, 2, 2, 2, 2, 0,   376,   2813244,  112000,  6, 0,  1,  928, 0,        0, 1, 0, 0, 1, 0, 0),
    (30, 4, 4, 4, 3, 0,   700,   4417293,  176000, 21, 0,  6,  812, 0,        0, 1, 1, 1, 1, 0, 0),
    (31, 4, 3, 3, 2, 0,   737,   4650779,  186000, 18, 2,  4,  852, 2,  3360000, 1, 0, 1, 0, 0, 1),
    (32, 2, 2, 2, 1, 0,   775,   4890575,  195000,  8, 2,  1,  834, 2,  3360000, 0, 1, 0, 0, 1, 0),
    (33, 4, 3, 3, 2, 0,   721,   4549812,  181000,  6, 2,  1,  815, 2,  3360000, 1, 1, 1, 0, 0, 0),
    (34, 4, 4, 4, 3, 1,   758,   4783298,  191000, 20, 2,  5,  855, 2,  3360000, 1, 0, 1, 1, 0, 1),
    (35, 3, 3, 2, 3, 0,   705,   4448845,  177000, 17, 2,  4,  837, 2,  3360000, 1, 1, 0, 1, 0, 0),
    (36, 4, 3, 3, 2, 0,   742,   4682331,  187000, 21, 2,  5,  818, 2,  3360000, 0, 1, 1, 0, 1, 0),
    (37, 5, 5, 5, 4, 0,   780,   4922127,  196000, 19, 0,  5,  858, 0,        0, 2, 1, 1, 1, 0, 0),
    (38, 2, 2, 2, 1, 0,   726,   4581364,  183000,  9, 1,  2,  840, 1,  1680000, 0, 0, 1, 0, 0, 1),
    (39, 3, 3, 3, 2, 0,   764,   4821160,  192000,  6, 2,  1,  821, 2,  3360000, 1, 1, 0, 1, 0, 0),
    (40, 5, 4, 4, 4, 0,   710,   4480397,  179000, 18, 0,  5,  861, 0,        0, 1, 1, 1, 0, 1, 0),
    (41, 3, 3, 3, 2, 0,   747,   4713883,  188000, 21, 2,  5,  842, 2,  3360000, 0, 1, 1, 0, 0, 1),
    (42, 3, 3, 3, 2, 0,   785,   4953679,  198000, 19, 2,  5,  824, 2,  3360000, 1, 0, 1, 1, 0, 0),
    (43, 4, 4, 4, 3, 0,   731,   4612916,  184000, 17, 0,  5,  864, 0,        0, 1, 1, 1, 1, 0, 0),
    (44, 4, 3, 3, 2, 0,   769,   4852712,  194000, 18, 2,  4,  845, 2,  3360000, 1, 1, 0, 0, 1, 0),
    (45, 3, 3, 3, 2, 1,   715,   4511950,  180000,  8, 0,  2,  827, 0,        0, 0, 1, 1, 0, 0, 1),
    (46, 5, 5, 5, 4, 0,   752,   4745435,  189000,  5, 2,  0,  867, 2,  3360000, 1, 1, 1, 1, 1, 0),
    (47, 3, 2, 2, 2, 0,   790,   4985231,  199000, 19, 2,  5,  848, 2,  3360000, 1, 0, 0, 0, 1, 0),
    (48, 3, 3, 3, 2, 0,   736,   4644468,  185000, 18, 0,  5,  830, 0,        0, 1, 1, 0, 1, 0, 0),
    (49, 5, 4, 4, 4, 0,   774,   4884264,  195000, 21, 2,  5,  869, 2,  3360000, 1, 1, 1, 0, 1, 0),
    (50, 3, 3, 3, 2, 0,   720,   4543502,  181000, 19, 2,  5,  851, 2,  3360000, 0, 1, 1, 0, 0, 1),
    (51, 2, 2, 2, 1, 0,   757,   4776987,  191000, 17, 0,  4,  833, 0,        0, 1, 0, 0, 1, 0, 0),
    (52, 5, 4, 4, 4, 0,   704,   4442535,  177000,  6, 2,  1,  814, 2,  3360000, 1, 1, 0, 1, 1, 0),
    (53, 3, 3, 3, 2, 0,   741,   4676020,  187000,  6, 0,  1,  854, 0,        0, 0, 1, 1, 0, 0, 1),
    (54, 3, 3, 3, 2, 0,   779,   4915816,  196000, 18, 2,  4,  836, 2,  3360000, 1, 0, 1, 0, 1, 0),
    (55, 5, 4, 4, 4, 0,   725,   4575054,  183000, 19, 2,  4,  817, 2,  3360000, 1, 1, 0, 1, 1, 0),
    (56, 3, 3, 3, 2, 1,   762,   4808539,  192000, 17, 0,  4,  857, 0,        0, 1, 1, 0, 1, 0, 0),
    (57, 4, 3, 3, 2, 0,   709,   4474087,  178000, 21, 2,  5,  839, 2,  3360000, 0, 1, 1, 0, 0, 1),
    (58, 4, 4, 4, 3, 0,   746,   4707573,  188000, 18, 2,  4,  820, 2,  3360000, 1, 1, 1, 0, 1, 0),
    (59, 4, 3, 3, 2, 0,   784,   4947368,  197000,  8, 2,  1,  860, 2,  3360000, 1, 0, 0, 1, 1, 0),
    (60, 3, 3, 3, 2, 0,   677,   4576019,  183000,  7, 0,  1,  793, 0,        0, 1, 1, 1, 0, 0, 0),
    (61, 4, 3, 3, 2, 0,   727,   4913982,  196000, 18, 2,  4,  835, 2,  3720000, 1, 0, 0, 1, 0, 1),
    (62, 2, 2, 1, 1, 0,   701,   4738241,  189000, 20, 2,  5,  819, 2,  3720000, 0, 1, 1, 0, 0, 0),
    (63, 4, 4, 4, 3, 1,   751,   5076204,  203000, 16, 2,  4,  802, 2,  3720000, 1, 1, 1, 0, 1, 0),
    (64, 4, 3, 3, 2, 0,   726,   4907222,  196000, 19, 0,  5,  844, 0,        0, 1, 0, 0, 1, 0, 1),
    (65, 2, 2, 2, 1, 0,   700,   4731482,  189000, 18, 1,  4,  827, 1,  1860000, 0, 1, 1, 0, 0, 0),
    (66, 4, 3, 3, 2, 0,   750,   5069444,  202000,  6, 2,  1,  811, 2,  3720000, 1, 0, 1, 1, 0, 0),
    (67, 4, 4, 4, 3, 0,   725,   4900463,  196000,  6, 0,  1,  794, 0,        0, 1, 1, 1, 0, 1, 0),
    (68, 3, 3, 3, 2, 0,   699,   4724722,  188000, 16, 2,  3,  836, 2,  3720000, 0, 1, 0, 1, 0, 1),
    (69, 3, 2, 2, 2, 0,   749,   5062685,  202000, 19, 0,  5,  820, 0,        0, 1, 0, 1, 0, 0, 0),
    (70, 3, 3, 2, 2, 0,   724,   4893704,  195000, 20, 2,  5,  803, 2,  3720000, 1, 1, 0, 1, 0, 0),
    (71, 5, 4, 4, 3, 0,   699,   4724722,  188000, 17, 2,  4,  845, 2,  3720000, 1, 1, 1, 0, 1, 0),
    (72, 3, 3, 3, 2, 0,   748,   5055926,  202000, 19, 0,  5,  828, 0,        0, 0, 1, 1, 0, 0, 1),
    (73, 4, 3, 3, 2, 0,   723,   4886944,  195000,  5, 2,  0,  812, 2,  3720000, 1, 0, 1, 1, 0, 0),
    (74, 3, 3, 3, 2, 0,   698,   4717963,  188000,  7, 1,  1,  795, 1,  1860000, 1, 1, 0, 1, 0, 0),
    (75, 2, 2, 2, 1, 1,   747,   5049167,  201000, 17, 2,  4,  837, 2,  3720000, 0, 1, 0, 0, 1, 0),
    (76, 5, 4, 4, 4, 0,   722,   4880185,  195000, 16, 0,  4,  820, 0,        0, 1, 1, 1, 1, 0, 0),
    (77, 3, 3, 3, 2, 0,   697,   4711204,  188000, 19, 2,  4,  804, 2,  3720000, 1, 0, 0, 0, 1, 1),
    (78, 4, 3, 3, 3, 0,   746,   5042407,  201000, 20, 0,  5,  846, 0,        0, 0, 1, 1, 1, 0, 0),
    (79, 2, 2, 2, 1, 0,   721,   4873426,  194000, 17, 2,  4,  829, 2,  3720000, 1, 0, 0, 0, 1, 0),
    (80, 3, 3, 2, 2, 0,   696,   4704444,  188000,  6, 2,  1,  813, 2,  3720000, 1, 1, 0, 1, 0, 0),
    (81, 4, 3, 3, 3, 0,   746,   5042407,  201000,  8, 0,  2,  796, 0,        0, 0, 1, 1, 0, 0, 1),
    (82, 4, 4, 4, 3, 0,   720,   4866667,  194000, 19, 2,  4,  838, 2,  3720000, 1, 1, 1, 0, 1, 0),
    (83, 2, 2, 2, 1, 0,   695,   4697685,  187000, 20, 0,  5,  821, 0,        0, 1, 0, 0, 1, 0, 0),
    (84, 4, 3, 3, 3, 0,   745,   5035648,  201000, 16, 2,  3,  805, 2,  3720000, 0, 1, 0, 1, 1, 0),
    (85, 3, 3, 3, 2, 0,   719,   4859907,  194000, 19, 2,  4,  847, 2,  3720000, 1, 0, 1, 0, 0, 1),
    (86, 3, 3, 3, 2, 1,   694,   4690926,  187000,  6, 1,  1,  830, 1,  1860000, 1, 1, 0, 0, 1, 0),
    (87, 4, 3, 3, 3, 0,   744,   5028889,  201000,  6, 2,  1,  814, 2,  3720000, 0, 1, 1, 1, 0, 0),
    (88, 4, 4, 4, 3, 0,   718,   4853148,  194000, 15, 1,  4,  797, 1,  1860000, 1, 1, 0, 0, 1, 1),
    (89, 4, 3, 3, 2, 0,   693,   4684167,  187000, 18, 2,  5,  839, 2,  3720000, 1, 0, 1, 1, 0, 0)
),
-- Each window's centres, ms. A day's samples sit symmetrically around them, so every window's
-- pooled median is its centre exactly — and the cycle centre lies between every S and every M
-- sample, with as many samples below it as above.
cycle_centres (first_d, last_d, centre_ms) as (
  values (0, 29, 860000), (30, 59, 980000), (60, 89, 1040000)
),
effort_centres (first_d, last_d, effort, centre_ms, step_ms) as (
  values (0, 29, 'xs',  360000,  20000), (0, 29, 's',  660000,  20000),
         (0, 29, 'm',  1140000,  40000), (0, 29, 'l', 2880000, 120000),
         (0, 29, 'xl', 7800000, 240000),
         (30, 59, 'xs', 420000,  20000), (30, 59, 's',  720000,  20000),
         (30, 59, 'm', 1260000,  40000), (30, 59, 'l', 3120000, 120000),
         (30, 59, 'xl', 8400000, 240000),
         (60, 89, 'xs', 450000,  20000), (60, 89, 's',  750000,  20000),
         (60, 89, 'm', 1320000,  40000), (60, 89, 'l', 3300000, 120000),
         (60, 89, 'xl', 9000000, 240000)
),
-- What a day's tokens were spent on, and how much of each kind a local model served: the bars'
-- weights (they sum to the ledger's month in millions) and each kind's local percentage. A kind's
-- tokens are the day's tokens × weight / Σ weights, floored; the rounding goes to the heaviest
-- kind, so every day's bars sum to that day's tokens exactly.
token_kinds (kind, weight, local_pct) as (
  values ('implement', 71, 3), ('review', 18, 0), ('plan', 14, 100),
         ('analyze', 12, 100), ('test-gen', 8, 100), ('docs', 3, 100)
),
token_split as (
  select share.d, share.kind, share.local_pct,
         share.floored
           + case when share.weight = share.heaviest
                  then share.tokens - sum(share.floored) over (partition by share.d)
                  else 0 end as tokens
    from (select l.d, l.tokens, k.kind, k.weight, k.local_pct,
                 max(k.weight) over () as heaviest,
                 floor(l.tokens::numeric * k.weight
                         / sum(k.weight) over (partition by l.d)) as floored
            from ledger l cross join token_kinds k) share
),
stage_centres (first_d, last_d, stage, centre_ms) as (
  values (0, 29, 'analyze',  60000), (0, 29, 'plan', 120000), (0, 29, 'implement', 364000),
         (0, 29, 'build',   120000), (0, 29, 'test', 160000), (0, 29, 'review',     40000),
         (30, 59, 'analyze', 70000), (30, 59, 'plan', 140000), (30, 59, 'implement', 420000),
         (30, 59, 'build',  140000), (30, 59, 'test', 180000), (30, 59, 'review',     50000),
         (60, 89, 'analyze', 75000), (60, 89, 'plan', 150000), (60, 89, 'implement', 440000),
         (60, 89, 'build',  145000), (60, 89, 'test', 190000), (60, 89, 'review',     55000)
),
effort_samples as (
  select l.d, c.effort, c.centre_ms + (2 * t - (k.n - 1)) * (c.step_ms / 2) as ms
    from ledger l
    join effort_centres c on l.d between c.first_d and c.last_d
    cross join lateral (select case c.effort when 'xs' then l.xs when 's' then l.s
                                             when 'm' then l.m when 'l' then l.l
                                             else l.xl end as n) k
    cross join lateral generate_series(0, k.n - 1) t
),
cycle_samples as (
  select d, ms from effort_samples
  union all
  select l.d, c.centre_ms
    from ledger l
    join cycle_centres c on l.d between c.first_d and c.last_d
    cross join lateral generate_series(1, l.unestimated)
),
stage_samples as (
  select l.d, c.stage, c.centre_ms + (2 * t - (l.merged - 1)) * 1000 as ms
    from ledger l
    join stage_centres c on l.d between c.first_d and c.last_d
    cross join lateral generate_series(0, l.merged - 1) t
),
-- The farm seed's finished jobs — the builds extractor's population and grouping.
farm as (
  select (gh.login || '/' || repo.name) as repo_ref,
         (job.finished_at at time zone 'UTC')::date as day,
         count(*) as builds,
         count(*) filter (where job.status <> 'succeeded') as failed
    from scope
    join ouroboros.build_jobs   job  on job.organization_id = scope.organization_id
    join ouroboros.github_repos repo on repo.id = job.github_repo_id
    join ouroboros.github_orgs  gh   on gh.id = repo.org_id
   where job.status in ('succeeded', 'failed', 'retried')
     and (job.finished_at at time zone 'UTC')::date >= scope.today - 89
   group by 1, 2
),
-- The test plane's finished attempts — the tests extractor's population and grouping.
tested as (
  select (gh.login || '/' || repo.name) as repo_ref,
         (attempt.started_at at time zone 'UTC')::date as day,
         btrim(left(btrim(suite.name), 200)) as suite,
         sum(suite.passed + suite.failed + suite.flaky) as ran,
         sum(suite.passed + suite.flaky) as passed,
         sum(suite.failed) as failed
    from scope
    join ouroboros.test_runs    attempt on attempt.organization_id = scope.organization_id
    join ouroboros.test_suites  suite   on suite.test_run_id = attempt.id
    join ouroboros.runs         run     on run.id = attempt.run_id
    join ouroboros.github_repos repo    on repo.id = run.github_repo_id
    join ouroboros.github_orgs  gh      on gh.id = repo.org_id
   where attempt.status <> 'running'
     and (attempt.started_at at time zone 'UTC')::date >= scope.today - 89
   group by 1, 2, 3
),
-- Failing cases beyond the test plane's, one per array element — the day it failed.
extra_suite_failures (suite, days) as (
  values ('telemetry integration', '{15,19,24,28,30,32,35,37,40,43,46,48,51,54,56,59,61,63,66,69,72,74,77,80,83,86,89}'::int[]),
         ('OTA update',            '{16,18,22,25,29,31,34,38,41,45,49,53,58,60,64,67,71,75,78,82,85,88}'),
         ('PHYSICAL · HIL rig',    '{33,36,42,47,50,55,57,62,65,70,76,79,84,87,89}'),
         ('motor control',         '{20,39,44,52,57,68,73,81}'),
         ('unit · drivers',        '{36,50,63,84}')
),
extra_failures as (
  select scope.repo_ref, scope.today - day_ago as day, extra.suite, count(*) as failed
    from scope, extra_suite_failures extra, unnest(extra.days) day_ago
   group by 1, 2, 3
),
-- #434's events, the interventions extractor's grouping, for the page's 30 days.
events as (
  select (gh.login || '/' || repo.name) as repo_ref, daily.day, daily.cause,
         sum(daily.events) as events
    from scope
    join ouroboros.intervention_cause_daily daily on daily.organization_id = scope.organization_id
    join ouroboros.github_repos repo on repo.id = daily.github_repo_id
    join ouroboros.github_orgs  gh   on gh.id = repo.org_id
   where daily.day >= scope.today - 29
   group by 1, 2, 3
),
-- The two earlier windows' interventions, one per array element.
summarised_interventions (cause, days) as (
  values ('infra_rig',          '{30,32,34,37,40,43,46,50,53,57,60,62,65,67,70,73,76,79,82,85,88}'::int[]),
         ('ambiguous_ticket',   '{31,36,41,47,52,58,61,66,71,75,80,84,89}'),
         ('policy_gate',        '{33,39,44,49,55,63,69,74,81,86}'),
         ('model_disagreement', '{38,51,64,78}'),
         ('other',              '{45,56,68,83}')
),
interventions as (
  select repo_ref, day, cause, events from events
  union all
  select scope.repo_ref, scope.today - day_ago, summary.cause, count(*)
    from scope, summarised_interventions summary, unnest(summary.days) day_ago
   group by 1, 2, 3
),
builds as (
  select coalesce(farm.repo_ref, extra.repo_ref) as repo_ref,
         coalesce(farm.day, extra.day) as day,
         coalesce(farm.builds, 0) + coalesce(extra.builds, 0) as builds,
         coalesce(farm.failed, 0) + coalesce(extra.failed, 0) as failed
    from farm
    full join (select scope.repo_ref, scope.today - l.d as day,
                      l.extra_builds as builds, l.extra_failed_builds as failed
                 from scope, ledger l
                where l.extra_builds > 0) extra
      on extra.repo_ref = farm.repo_ref and extra.day = farm.day
),
suite_failures as (
  select coalesce(t.repo_ref, x.repo_ref) as repo_ref, coalesce(t.day, x.day) as day,
         coalesce(t.suite, x.suite) as suite,
         coalesce(t.failed, 0) + coalesce(x.failed, 0) as failed
    from (select repo_ref, day, suite, failed from tested where failed > 0) t
    full join extra_failures x on x.repo_ref = t.repo_ref and x.day = t.day and x.suite = t.suite
),
cases as (
  select coalesce(t.repo_ref, x.repo_ref) as repo_ref, coalesce(t.day, x.day) as day,
         coalesce(t.ran, 0) + coalesce(x.ran, 0) as ran,
         coalesce(t.passed, 0) + coalesce(x.passed, 0) as passed
    from (select repo_ref, day, sum(ran) as ran, sum(passed) as passed
            from tested group by 1, 2) t
    full join (select scope.repo_ref, scope.today - l.d as day, l.extra_cases as ran,
                      l.extra_cases - coalesce((select sum(f.failed) from extra_failures f
                                                 where f.day = scope.today - l.d), 0) as passed
                 from scope, ledger l
                where l.extra_cases > 0) x
      on x.repo_ref = t.repo_ref and x.day = t.day
),
-- Every row, as (repo_ref, metric, is_rate, dimension, day, value, numerator, denominator, meta).
-- A rate's value is its numerator over its denominator (× 100 for a pct metric); a median's is
-- percentile_cont over the samples it carries.
rows (repo_ref, metric_id, is_rate, dimension, day, value, numerator, denominator, meta) as (
  -- throughput — the chart's tooltip extras are the same day's cost and interventions
  select scope.repo_ref, 'merged_prs', false, '', scope.today - l.d, l.merged::numeric,
         null::numeric, null::numeric,
         jsonb_build_object('cost_cents', l.cost_cents,
                            'interventions',
                            coalesce((select sum(i.events) from interventions i
                                       where i.repo_ref = scope.repo_ref
                                         and i.day = scope.today - l.d), 0))
    from scope, ledger l where l.closed > 0
  union all
  select scope.repo_ref, 'merge_rate', true, '', scope.today - l.d,
         100.0 * l.autonomous / l.closed, l.autonomous, l.closed, '{}'::jsonb
    from scope, ledger l where l.closed > 0
  union all
  select scope.repo_ref, 'merged_untouched_rate', true, '', scope.today - l.d,
         100.0 * l.untouched / l.merged, l.untouched, l.merged, '{}'
    from scope, ledger l where l.merged > 0
  -- cost
  union all
  select scope.repo_ref, 'cost_cents', false, '', scope.today - l.d, l.cost_cents, null, null, '{}'
    from scope, ledger l
  union all
  select scope.repo_ref, 'tokens', false, '', scope.today - l.d, l.tokens, null, null, '{}'
    from scope, ledger l
  union all
  select scope.repo_ref, 'unpriced_tokens', false, '', scope.today - l.d, l.unpriced_tokens,
         null, null, '{}'
    from scope, ledger l
  union all
  select scope.repo_ref, 'tokens_by_task_kind', false, t.kind, scope.today - t.d, t.tokens,
         null, null, '{}'
    from scope, token_split t
  union all
  select scope.repo_ref, 'local_tokens', false, '', scope.today - t.d,
         sum(floor(t.tokens * t.local_pct / 100)), null, null, '{}'
    from scope, token_split t
   group by scope.repo_ref, scope.today, t.d
  -- dora
  union all
  select scope.repo_ref, 'deploy_frequency', false, '', scope.today - l.d, l.deploys, null, null,
         '{}'
    from scope, ledger l where l.deploys > 0
  union all
  select scope.repo_ref, 'lead_time', true, '', scope.today - c.d, sum(c.ms)::numeric / count(*),
         sum(c.ms), count(*), '{}'
    from scope, cycle_samples c group by scope.repo_ref, scope.today, c.d
  union all
  select scope.repo_ref, 'change_failure_rate', true, '', scope.today - l.d,
         100.0 * l.reverted / l.merged, l.reverted, l.merged, '{}'
    from scope, ledger l where l.merged > 0
  union all
  select scope.repo_ref, 'mttr', true, '', scope.today - l.d,
         l.recovery_ms::numeric / l.recoveries, l.recovery_ms, l.recoveries, '{}'
    from scope, ledger l where l.recoveries > 0
  -- cycle and effort — medians over the day's samples, which the row carries
  union all
  select scope.repo_ref, 'cycle_time', false, '', scope.today - c.d,
         (percentile_cont(0.5) within group (order by c.ms))::numeric, null, null,
         jsonb_build_object('samples', jsonb_agg(c.ms order by c.ms))
    from scope, cycle_samples c group by scope.repo_ref, scope.today, c.d
  union all
  select scope.repo_ref, 'stage_duration', false, s.stage, scope.today - s.d,
         (percentile_cont(0.5) within group (order by s.ms))::numeric, null, null,
         jsonb_build_object('samples', jsonb_agg(s.ms order by s.ms))
    from scope, stage_samples s group by scope.repo_ref, scope.today, s.d, s.stage
  union all
  select scope.repo_ref, 'completion_time_by_effort', false, e.effort, scope.today - e.d,
         (percentile_cont(0.5) within group (order by e.ms))::numeric, null, null,
         jsonb_build_object('samples', jsonb_agg(e.ms order by e.ms))
    from scope, effort_samples e group by scope.repo_ref, scope.today, e.d, e.effort
  -- builds
  union all
  select b.repo_ref, 'builds', false, '', b.day, b.builds, null, null, '{}' from builds b
  union all
  select b.repo_ref, 'build_failures', false, '', b.day, b.failed, null, null, '{}' from builds b
  union all
  select b.repo_ref, 'build_success_rate', true, '', b.day,
         100.0 * (b.builds - b.failed) / b.builds, b.builds - b.failed, b.builds, '{}'
    from builds b
  -- tests
  union all
  select c.repo_ref, 'test_cases_run', false, '', c.day, c.ran, null, null, '{}'
    from cases c where c.ran > 0
  union all
  select c.repo_ref, 'test_pass_rate', true, '', c.day, 100.0 * c.passed / c.ran, c.passed, c.ran,
         '{}'
    from cases c where c.ran > 0
  union all
  select f.repo_ref, 'test_failures_by_suite', false, f.suite, f.day, f.failed, null, null, '{}'
    from suite_failures f
  -- interventions, by cause
  union all
  select i.repo_ref, 'human_interventions', false, i.cause, i.day, i.events, null, null, '{}'
    from interventions i
)
select scope.organization_id, r.repo_ref, r.metric_id, r.is_rate, r.dimension, r.day, r.value,
       r.numerator, r.denominator, r.meta
  from scope, rows r
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The rollup's bookkeeping: every extractor family filled through yesterday.
--
-- Without it ouroboros-rest's first tick would backfill ninety days from the source planes over
-- the history above. With it, the tick re-fills today and nothing else (see the header).
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_rollup_state (organization_id, family, last_filled_day,
                                           last_run_status, last_run_at)
select org."id", family, (now() at time zone 'UTC')::date - 1, 'succeeded', now()
  from (values ('throughput'), ('interventions'), ('cost'), ('dora'), ('cycle'), ('builds'),
               ('tests'), ('effort')) as seed (family)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;
