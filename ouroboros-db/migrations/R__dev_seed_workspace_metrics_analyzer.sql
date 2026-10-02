-- R__dev_seed_workspace_metrics_analyzer.sql — mockup 18's Build Analyzer, as a corpus the
-- analyzers can rediscover it from, in a development database and nowhere else.
--
-- [`docs/mockups/18-build-analyzer.html`](../../docs/mockups/18-build-analyzer.html). Filed as
-- issue #509 (BU.4). Most seeds in this directory plant the answer; this one must not. A finding
-- that says *"Jun 22, −2m 10s, ccache enabled"* proves nothing if somebody typed it. So the
-- substance here is the **corpus** — ninety days of helios-firmware builds, their log tails and
-- the merges, waivers and pool events around them — and the findings are what the analyzers
-- make of it:
--
--   * **Rediscovered.** The three change-points. tests/verify-analyzer-rediscovery.sh reads the
--     corpus back out (tests/lib/analyzer-corpus.sql), runs BV.2's own `ChangePointAnalyzer`
--     over it, and requires the three stored findings to be exactly what it emits — dates,
--     deltas, the ranked candidates with every score, the evidence, the confidence and its basis.
--   * **Re-derived.** Every pattern finding's numbers are aggregates computed in the statement
--     that stores them, over the rows below, and tests/seed.sql computes each again. None of the
--     figures the page prints appears in this file (tests/seed.test.sh refuses them).
--   * **Stored.** Three workflow correlations and the earlier run's two findings, whose planes
--     are not seeded at the scale they need — see *What is stored* below.
--
-- ---------------------------------------------------------------------------
-- **The corpus**
-- ---------------------------------------------------------------------------
--
-- 1,270 builds on the eighty-nine days before today, `#10001`–`#11270` in queue order, plus the
-- farm seed's fourteen helios-firmware builds of the prior week: the strip's **1,284 builds**,
-- counted when the run is stored. Every instant is a UTC day and a time of day relative to
-- `now()`; mockup 18's *today* is Aug 8, so **May 18, Jun 22 and Jul 30 are 82, 47 and 9 days
-- ago** and read as those dates on that day.
--
-- `plan` below is the ledger — one row per day of components: zephyr builds and how many
-- failed, native_sim/qemu_cortex_m3 pairs and their failures, the HIL sweep, and how many of the
-- day's builds ran on main. Everything per build is a formula over it:
--
--   | Rendered                                    | Falls out of                                             |
--   |---------------------------------------------|----------------------------------------------------------|
--   | the duration curve, ending at 4m 12s        | each day's zephyr builds spread around its level, so the |
--   |                                             | day's median *is* the level: 252 → 342 → 212 → 252 s     |
--   | May 18 +1m 30s · Jun 22 −2m 10s · Jul 30 +40s | the level stepping 82, 47 and 9 days ago — PELT finds  |
--   |                                             | them; the chips are its finding                          |
--   | Zephyr 4.1 migration · ccache enabled ·     | the merge first built on main that day, out-ranking the  |
--   | twister suite growth                        | near misses in reach: an image bump and standard-fix v5  |
--   |                                             | two days before, a typo fix three after; a CAN tweak and |
--   |                                             | v9 the day before; four farm merges two and three after  |
--   | 7.2% … fixture timeout (31 builds)          | the fixture line in 31 native_sim tails, of 430 OTA      |
--   |                                             | `FAIL` lines                                             |
--   | ccache issue #1412 in 118 builds            | the manifest-miss line in that many cached builds' tails |
--   | 0 of 1,284 builds toggled them; 4 … drift   | no build's command sets the twelve options; four tails   |
--   |                                             | carry Kconfig's "assigned … but got" warning             |
--   | 78%→31% for ~6h … (14 occurrences), ~20%    | `ccache_stats` inside and outside the six hours after    |
--   |                                             | each `deps: refresh west manifest` merge                 |
--   | 11 of last 14 weekdays; pool-b idle 82%     | the longest pool-a wait queued 14:00–16:00 each weekday; |
--   |                                             | pool-b's HIL sweeps' overlap with the same window        |
--   | qemu_cortex_m3 0 unique in 214; HIL 9 at    | per commit: a stage's failure no other stage shared      |
--   | merge gates                                 |                                                          |
--   | 3 waivers in 60 days … thermal coverage     | three `pr_waivers` below, on helios-firmware loops       |
--   | 1,284 · 62 HIL sessions (the strip)         | the builds, and the HIL sweeps among them                |
--
-- Each day's median is exact rather than approximately right because the analyzer's deltas are
-- asserted exactly: the builds below a day's level and above it balance, the farm's two builds
-- on its days counted in, and the post-refresh slow builds are only ever the top half.
--
-- ---------------------------------------------------------------------------
-- **Reconciled with the other seeds** — the corpus is the shared universe's, not a parallel one
-- ---------------------------------------------------------------------------
--
--   * **The insights ledger's extra builds are these rows.** R__dev_seed_workspace_metrics.sql
--     counted helios-firmware builds beyond the farm's as `extra_builds` per day; each day here
--     has exactly that many builds and that many failures, and that file's days 30–86 gained two
--     builds each and day 87 one (#509), so the ninety days hold 1,284 and the page's 30-day
--     *412* is untouched. The rollup re-deriving any day now finds what the ledger says. The
--     day's `main` builds are its DORA deploys less the farm's.
--   * **It sorts after that file**, which is why it is named `workspace_metrics_analyzer`: the
--     ledger's history is computed from the farm *before* these rows exist. Sorting earlier
--     would count them twice.
--   * **The farm's prior week still averages 290 s.** The HIL sweeps' lengths are chosen by
--     their weekday's rank so the ninety-four builds of the seven days before today keep #249's
--     mean whatever day the seed runs on. Its *"without the day window"* near misses (45
--     finished, the 74% cache rate) and its *51 in all* are now asserted over the farm's own
--     jobs, `#435`–`#485`.
--   * **The waivers are 33–57 days old**, so #434's thirty-day interventions window is not moved;
--     the three intervention events they raise are the only ones older than it.
--   * **Not candidates.** The knowledge seed's env recipe v3, nine days ago, would rank on Jul 30
--     — but V081 has no evidence kind for a recipe, and a candidate cites evidence. The export
--     says so (tests/lib/analyzer-corpus.sql).
--
-- ---------------------------------------------------------------------------
-- **Seeded to scale** — the strip's four counts are the rows' (#510)
-- ---------------------------------------------------------------------------
--
-- BV.1's corpus assembly counts the page's manifest from the rows, so every count on the strip is
-- here at full size and the stored manifest is computed with BV.1's definitions:
--
--   * **1,284 builds** — the window's finished builds (succeeded, failed or retried).
--   * **62 HIL sessions** — those of them that ran on a pool tagged `hil`.
--   * **4.1M log lines** — V086's `build_jobs.log_lines` summed over them: the farm keeps tails,
--     but it counted every line as it landed, so the volume is a column, not four million rows.
--     Read under the schedule's 1.23M-line cap it is **sampled** at 0.3, as the manifest says.
--   * **312 loops** — the repository's runs started in the window: the other seeds' recent loops
--     and the older `standard-fix` loops below.
--
-- ---------------------------------------------------------------------------
-- **What is stored, and why**
-- ---------------------------------------------------------------------------
--
--   * **34% · 3.1× (21 cases) · 18% → 42%.** Loop stage outcomes, telemetry flakes per merge and
--     per-step build timings. The run plane holds the dashboard's runs and decision B6 keeps
--     builds unattributed to loops, so these three are stored as the workflow_outcome analyzer's
--     output with evidence that resolves (the standard-fix version, the four `can:` merges, the
--     LTO merge) — not derived.
--   * **The run before's corpus** (271 loops, 2.9M log lines), whose window reaches back past
--     the ninety days seeded here. The page's run is counted instead — see *Seeded to scale*.
--   * **The run before** (38 days ago) and its two findings, which proposed the two changes the
--     Predicted vs Measured card closes. Both were applied a week apart; their predictions and
--     outcomes are V085 rows, the verdicts V085's arithmetic, and the calibration factors are
--     `recalibrate_analyzer()`'s: −72 ÷ −110 makes the cache model's **0.6545**.
--
-- The provenance is **deterministic analyzers v1**, every analyzer `deterministic`, and
-- `llm_cost_cents` is null on both runs: no model ran, so no `$` is shown (decision A3).
-- tests/analyzer-invariants.sql holds every seeded run to that.
--
-- ---------------------------------------------------------------------------
--
-- The current suggestions compose their lines from the findings they cite, and two scale a raw
-- estimate by the calibrated factor — the ccache re-warm's −168 s × 0.6545 is the card's −1m 50s.
-- The draft batch's `est. total ~1.5 days` is the four estimates' `est_minutes` summed.
--
--   | Table                          | Ids              | Suffix                               |
--   |--------------------------------|------------------|--------------------------------------|
--   | `build_jobs` (1,270)           | `5eed0062…`      | the job number                       |
--   | `build_log_chunks`             | `5eed0063…`      | the job number                       |
--   | `analysis_schedules` (1)       | `5eed0064…`      | 1                                    |
--   | `analysis_runs` (2)            | `5eed0065…`      | 1 the run before, 2 the page's       |
--   | `analysis_findings`            | `5eed0066…`      | 1–2 the run before, 101–175 the page |
--   | `analysis_suggestions`         | `5eed0067…`      | 1–2 applied, 11–16 cards, 21–24 BA-n |
--   | `audit_events` (2)             | `5eed0068…`      | the suggestion applied               |
--   | `suggestion_measurements` (2)  | `5eed0069…`      | the suggestion measured              |
--   | `draft_batches` (1)            | `5eed006a…`      | 1                                    |
--   | `ticket_drafts` (4)            | `5eed006b…`      | the BA number                        |
--   | `issue_estimates` (4)          | `5eed006c…`      | the BA number, then the version      |
--   | `pr_waivers` (3)               | `5eed006d…`      | the loop's issue number              |
--   | `runs` (older loops)           | `5eed006e…`      | the loop's issue number less 3000    |
--
-- The same properties as every seed: every statement is behind `${ouro_dev_seed}`; every insert
-- ends `on conflict do nothing`, with a `not exists` guard where a BEFORE trigger would act first
-- (the log chunks' running total, the estimate version); findings and suggestions are written
-- only while their run is `running` and the run is completed last, so a second application
-- writes nothing; and every parent from another seed is found by natural key.
--
-- Filed as issue #509 (BU.4). Needs #506–#508 and the seeds above. Asserted in tests/seed.sql
-- and tests/seed.test.sh; tests/analyzer-invariants.sql probes the analysis rows and
-- tests/verify-analyzer-invariants.sh proves each probe goes red; tests/
-- verify-analyzer-rediscovery.sh runs the change-point analyzer over the corpus.

-- ---------------------------------------------------------------------------
-- The corpus — helios-firmware's builds on each of the eighty-nine days before today.
--
-- Four kinds of build, each a formula over its day's `plan` row:
--
--   * `zephyr build` (pool-a) — the firmware build, and the duration series. The day's
--     succeeded builds are spread around its level: as many below as above once the farm's own
--     builds that day are counted, the level itself when the total is odd, and a lowest
--     above-the-level build mirroring the highest below it when even — so the day's median is
--     exactly the level. On a deps-refresh day every build above the median but the mirror ran
--     inside the merge's six hours and is 168 s slower: cold cache, top half only. Failed ones
--     stop at a compile error in under two minutes.
--   * `native_sim` and `qemu_cortex_m3` (pool-a) — one pair per commit. A pair's native_sim run
--     fails alone (an OTA failure) or with its qemu twin (a defect both catch); qemu never fails
--     alone. Failing pairs are the day's last, so pair 1 is always green.
--   * `HIL test rig` (pool-b, shell) — one sweep, on a merge-queue ref, sharing pair 1's commit
--     when the day has one. On the last fourteen weekdays it runs 14:00–15:00ish UTC: ten minutes
--     on the five most recent, an hour on the nine before. Otherwise it is a 09:00 sweep of just
--     under twenty minutes. The seven days before today always hold the five recent weekdays and
--     two others, which is what keeps #249's prior-week mean where it was.
--
-- Times of day: a refresh day's merge build at 06:00 and its window builds every twenty minutes
-- after; one zephyr build per day of the last twenty queued at 14:20 on forge-01 — waiting seven
-- minutes on a weekday the queue was long, two and a half on the three it was not (ranks 3, 8
-- and 12), one on a weekend; everything else from 16:30, every fifteen minutes. All finish the
-- same UTC day. Main builds are the day's top zephyr builds, building the latest merge; a merge
-- day's top build is the merge's first. Runners follow the farm seed's fleet: forge-00 alone
-- before forge-01–03 enrolled, never after forge-00's last build; bigiron before anvil-mac.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_jobs
  (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
   label, title, executor, image, command, status,
   queued_at, offered_at, started_at, finished_at, exit_code, ccache_stats)
with scope as (
  select org."id" as organization_id, repo.id as repo_id,
         (now() at time zone 'UTC')::date as today,
         pool_a.id as pool_a, pool_b.id as pool_b
    from ouroboros.organization org
    join ouroboros.github_orgs  gh     on gh.organization_id = org."id" and gh.login = 'acme-robotics'
    join ouroboros.github_repos repo   on repo.org_id = gh.id and repo.name = 'helios-firmware'
    join ouroboros.runner_pools pool_a on pool_a.organization_id = org."id" and pool_a.name = 'pool-a'
    join ouroboros.runner_pools pool_b on pool_b.organization_id = org."id" and pool_b.name = 'pool-b'
   where org."slug" = 'acme-robotics'
),
-- One row per day: the day's components. Never a figure — see the header.
plan (d, zephyr, zephyr_failed, pairs, ota_failed, pair_failed, hil, hil_failed, main) as (
  values
    ( 1,  9, 0, 3, 0, 0, 1, 0, 6),
    ( 2,  5, 0, 0, 0, 0, 1, 0, 1),
    ( 3,  3, 0, 0, 0, 0, 1, 0, 1),
    ( 4, 10, 0, 3, 1, 1, 1, 1, 4),
    ( 5,  8, 0, 3, 0, 0, 1, 0, 5),
    ( 6, 12, 0, 3, 0, 0, 1, 0, 6),
    ( 7, 10, 0, 3, 1, 1, 1, 1, 4),
    ( 8,  4, 0, 1, 0, 0, 1, 0, 3),
    ( 9,  3, 0, 0, 0, 0, 1, 0, 1),
    (10,  9, 0, 3, 0, 0, 1, 0, 6),
    (11, 12, 0, 3, 1, 1, 1, 1, 5),
    (12, 10, 0, 3, 0, 0, 1, 0, 6),
    (13,  8, 0, 3, 1, 1, 1, 1, 4),
    (14,  9, 0, 3, 0, 0, 1, 0, 5),
    (15,  5, 0, 0, 0, 0, 1, 0, 2),
    (16,  2, 0, 0, 0, 0, 1, 0, 1),
    (17, 10, 0, 3, 0, 0, 1, 0, 5),
    (18,  9, 0, 3, 1, 1, 1, 1, 4),
    (19, 12, 0, 3, 0, 0, 1, 0, 6),
    (20, 10, 0, 3, 0, 0, 1, 0, 5),
    (21,  9, 0, 3, 2, 1, 0, 0, 3),
    (22,  4, 0, 0, 0, 0, 0, 0, 1),
    (23,  4, 0, 0, 0, 0, 0, 0, 1),
    (24,  9, 0, 3, 0, 0, 1, 0, 4),
    (25, 10, 0, 3, 1, 1, 1, 1, 3),
    (26,  9, 0, 3, 0, 0, 0, 0, 4),
    (27, 11, 0, 3, 1, 1, 1, 1, 3),
    (28,  9, 0, 3, 0, 0, 1, 0, 4),
    (29,  4, 0, 1, 0, 0, 0, 0, 1),
    (30, 12, 0, 4, 0, 0, 1, 0, 6),
    (31, 11, 0, 3, 0, 1, 1, 0, 4),
    (32,  4, 0, 2, 0, 1, 0, 0, 1),
    (33,  4, 1, 1, 1, 0, 0, 0, 1),
    (34, 13, 0, 3, 1, 0, 1, 1, 5),
    (35, 10, 0, 3, 1, 0, 1, 1, 4),
    (36, 12, 0, 4, 2, 0, 1, 0, 5),
    (37, 12, 0, 3, 0, 0, 1, 0, 5),
    (38,  5, 0, 2, 1, 0, 0, 0, 2),
    (39,  4, 1, 1, 1, 0, 0, 0, 1),
    (40, 11, 0, 3, 0, 0, 1, 0, 5),
    (41, 12, 0, 4, 2, 0, 1, 0, 5),
    (42, 12, 0, 3, 2, 0, 1, 0, 5),
    (43, 10, 0, 3, 0, 0, 1, 0, 5),
    (44, 11, 0, 3, 2, 0, 1, 0, 4),
    (45,  4, 0, 2, 0, 0, 0, 0, 2),
    (46,  5, 2, 0, 0, 0, 0, 0, 0),
    (47, 12, 0, 3, 2, 0, 1, 0, 5),
    (48, 11, 0, 3, 0, 0, 1, 0, 5),
    (49, 12, 0, 4, 2, 0, 1, 0, 5),
    (50, 12, 0, 3, 2, 0, 1, 0, 5),
    (51, 10, 0, 3, 0, 0, 1, 0, 4),
    (52,  4, 1, 1, 1, 0, 0, 0, 1),
    (53,  4, 0, 1, 0, 0, 0, 0, 1),
    (54, 11, 0, 3, 2, 0, 1, 0, 4),
    (55, 12, 0, 3, 2, 0, 1, 0, 4),
    (56, 10, 0, 3, 0, 0, 1, 0, 4),
    (57, 12, 0, 4, 2, 0, 1, 0, 5),
    (58, 11, 0, 3, 2, 0, 1, 0, 4),
    (59,  4, 0, 2, 2, 0, 0, 0, 1),
    (60,  5, 0, 1, 0, 0, 0, 0, 1),
    (61, 11, 0, 3, 2, 0, 1, 0, 4),
    (62, 13, 0, 3, 2, 0, 1, 0, 5),
    (63,  9, 0, 3, 2, 0, 1, 0, 4),
    (64, 12, 0, 3, 0, 0, 1, 0, 5),
    (65, 11, 0, 3, 1, 0, 1, 0, 4),
    (66,  4, 1, 1, 1, 0, 0, 0, 1),
    (67,  4, 0, 1, 0, 0, 0, 0, 1),
    (68, 10, 0, 3, 2, 0, 0, 0, 3),
    (69, 12, 0, 3, 0, 0, 1, 0, 5),
    (70, 13, 0, 3, 2, 0, 1, 0, 5),
    (71, 10, 0, 3, 2, 0, 1, 0, 4),
    (72, 12, 0, 3, 0, 0, 1, 0, 5),
    (73,  5, 2, 0, 0, 0, 0, 0, 0),
    (74,  5, 0, 1, 1, 0, 0, 0, 1),
    (75, 10, 0, 3, 2, 0, 1, 0, 4),
    (76, 10, 0, 3, 0, 0, 0, 0, 4),
    (77, 12, 0, 3, 2, 0, 1, 0, 4),
    (78, 13, 0, 3, 0, 0, 1, 0, 5),
    (79, 10, 0, 3, 2, 0, 1, 0, 4),
    (80,  4, 1, 1, 1, 0, 0, 0, 1),
    (81,  4, 0, 2, 0, 0, 0, 0, 2),
    (82, 12, 2, 3, 0, 0, 1, 0, 4),
    (83, 13, 0, 3, 0, 0, 1, 0, 5),
    (84, 10, 2, 3, 0, 0, 0, 0, 3),
    (85, 12, 2, 3, 0, 0, 1, 0, 4),
    (86,  4, 1, 1, 0, 0, 0, 0, 1),
    (87,  4, 2, 1, 0, 0, 0, 0, 1),
    (88,  9, 1, 3, 0, 0, 0, 0, 4),
    (89, 11, 2, 3, 0, 0, 1, 0, 5)
),
-- The merges: a commit first built on main, on that day, titled by its PR. Within three days of a
-- shift there is the anchor and the near misses the header lists, and nothing else, so the
-- ranking is the thing being tested. The fourteen dependency refreshes are the cache windows;
-- the `can:` merges and v2.3's LTO are what the stored correlations cite.
merges (d, title) as (
  values (89, 'Bring up helios_mainboard rev D'),
         (86, 'OTA: stream the image header before the payload'),
         (82, 'Zephyr 4.1 migration'),
         (79, 'docs: README typo'),
         (76, 'Motor PID: feed-forward term for step changes'),
         (72, 'BLE: bond storage in the settings subsystem'),
         (69, 'Telemetry: batch CBOR frames per second'),
         (65, 'Bootloader: measured boot hashes'),
         (60, 'v2.3: enable LTO for release images'),
         (57, 'can: bus-off recovery with backoff'),
         (53, 'Flash: wear-levelled settings partition'),
         (48, 'can: driver timeout tweak'),
         (47, 'ccache enabled'),
         (35, 'can: filter table for the telemetry IDs'),
         (20, 'can: retransmit on arbitration loss'),
         (9,  'twister suite growth'),
         (43, 'deps: refresh west manifest'), (40, 'deps: refresh west manifest'),
         (37, 'deps: refresh west manifest'), (34, 'deps: refresh west manifest'),
         (31, 'deps: refresh west manifest'), (28, 'deps: refresh west manifest'),
         (25, 'deps: refresh west manifest'), (22, 'deps: refresh west manifest'),
         (19, 'deps: refresh west manifest'), (16, 'deps: refresh west manifest'),
         (13, 'deps: refresh west manifest'), (5,  'deps: refresh west manifest'),
         (2,  'deps: refresh west manifest'), (1,  'deps: refresh west manifest')
),
-- What a PR build's title is about, by day and index.
topics (n, topic) as (
  values (0, 'OTA: resume an interrupted download'), (1, 'BLE: shorten the advertising interval'),
         (2, 'Motor: soft-start ramp for the drive axis'), (3, 'Telemetry: drop stale frames'),
         (4, 'CAN: tune the sample point'), (5, 'Flash: verify after erase'),
         (6, 'Power: log brown-out recoveries'), (7, 'Bootloader: tidy the slot banner'),
         (8, 'IMU: calibrate the gyro offset at boot'), (9, 'Shell: add a uptime command'),
         (10, 'Watchdog: feed from the idle hook'), (11, 'Sensors: oversample the thermistor')
),
-- Each day's level (with its small, segment-balanced wobble), its merge, the merge its main
-- builds build, and whether it is a weekday.
days as (
  select p.*, scope.today - p.d as day,
         (89 - p.d) % 5 as wobble,
         case when p.d >= 83 then 252 when p.d >= 48 then 342 when p.d >= 10 then 212 else 252 end
           + case when seg.last_d = p.d and (seg.first_d - seg.last_d + 1) % 3 = 2 then 0
                  else (array[0, 1, -1])[(seg.first_d - p.d) % 3 + 1]
                         * (array[4, 7, 10, 5, 9, 6, 11])[((89 - p.d) / 3) % 7 + 1] end as v,
         m.title is not null and m.title like 'deps:%' as refresh,
         m.title as merge_title,
         (select min(older.d) from merges older where older.d >= p.d) as head_d,
         extract(isodow from scope.today - p.d) < 6 as weekday
    from plan p
    cross join scope
    join (values (89, 83), (82, 48), (47, 10), (9, 1)) as seg (first_d, last_d)
      on p.d between seg.last_d and seg.first_d
    left join merges m on m.d = p.d
),
-- A weekday's rank among the last twenty days' — 1 is yesterday or the weekday before it.
ranked as (
  select days.*,
         case when weekday and d <= 20
              then count(*) filter (where weekday) over (order by d rows unbounded preceding) end
           as weekday_rank
    from days
),
-- The farm seed's own helios-firmware builds share their days with these (#249's prior week), so
-- each day's median is taken over both: its builds below and above the day's level.
farm as (
  select scope.today - (job.finished_at at time zone 'UTC')::date as d,
         count(*) filter (where extract(epoch from job.finished_at - job.started_at) < r.v) as below,
         count(*) filter (where extract(epoch from job.finished_at - job.started_at) > r.v) as above,
         max(extract(epoch from job.finished_at - job.started_at))
           filter (where extract(epoch from job.finished_at - job.started_at) < r.v) as lower_max
    from scope
    join ouroboros.build_jobs job on job.organization_id = scope.organization_id
                                 and job.github_repo_id = scope.repo_id
                                 and job.id::text like '5eed0028-%'
                                 and job.label = 'zephyr build' and job.status = 'succeeded'
    join ranked r on r.day = (job.finished_at at time zone 'UTC')::date
   group by 1
),
shape as (
  select r.*, coalesce(f.below, 0) as farm_below, coalesce(f.above, 0) as farm_above,
         f.lower_max as farm_lower_max,
         r.zephyr - r.zephyr_failed as zs,
         (r.zephyr - r.zephyr_failed + coalesce(f.below, 0) + coalesce(f.above, 0)) % 2 as centre
    from ranked r
    left join farm f on f.d = r.d
),
-- How many of the day's own builds sit below the level, and how many above.
halves as (
  select s.*,
         (s.zs - s.centre + s.farm_below - s.farm_above) / 2 as above,
         s.zs - s.centre - (s.zs - s.centre + s.farm_below - s.farm_above) / 2 as below
    from shape s
),
-- j orders a day's succeeded zephyr builds by duration; failed ones follow.
zephyr as (
  select h.d, 'zephyr'::text as kind, j, 'succeeded'::text as status,
         case when j <= h.below then h.v - 6 * (h.below - j + 1) - h.wobble
              when h.centre = 1 and j = h.below + 1 then h.v
              when h.centre = 0 and j = h.below + 1
                then 2 * h.v - greatest(case when h.below >= 1 then h.v - 6 - h.wobble end,
                                        h.farm_lower_max)
              else h.v + 6 * (j - h.below - h.centre) + h.wobble
         end
         + case when h.refresh and j > h.below + 1 then 168 else 0 end as secs,
         h.refresh and (j > h.below + h.centre or j = h.zs) as in_window,
         j > h.zs - h.main as on_main,
         j = h.zs and h.merge_title is not null as is_merge
    from halves h
    cross join lateral generate_series(1, h.zs) j
  union all
  select h.d, 'zephyr', h.zs + j, 'failed', 40 + 11 * j, false, false, false
    from halves h
    cross join lateral generate_series(1, h.zephyr_failed) j
),
pairs as (
  select h.d, kind, j,
         case when kind = 'native' and j > h.pairs - h.ota_failed - h.pair_failed then 'failed'
              when kind = 'qemu' and j > h.pairs - h.ota_failed - h.pair_failed
                                 and j <= h.pairs - h.ota_failed then 'failed'
              else 'succeeded' end as status,
         case when kind = 'native' then 150 + (13 * j) % 60 else 210 + (17 * j) % 80 end as secs,
         h.refresh as in_window, false as on_main, false as is_merge
    from halves h
    cross join lateral generate_series(1, h.pairs) j
    cross join (values ('native'), ('qemu')) as k (kind)
),
hil as (
  select h.d, 'hil'::text as kind, j,
         case when j <= h.hil_failed then 'failed' else 'succeeded' end as status,
         case when h.weekday_rank between 1 and 5  then 600
              when h.weekday_rank between 6 and 14 then 3600
              else 1195 end as secs,
         false as in_window, false as on_main, false as is_merge
    from halves h
    cross join lateral generate_series(1, h.hil) j
),
corpus as (
  select * from zephyr union all select * from pairs union all select * from hil
),
-- slot is a build's place in its part of the day: the refresh window, or the evening.
placed as (
  select c.*, h.day, h.weekday_rank, h.merge_title, h.head_d, h.pairs as day_pairs, h.hil as day_hil,
         c.kind = 'zephyr' and c.j = 1 and c.d <= 20 as queue_probe,
         row_number() over (partition by c.d, c.in_window
                            order by c.is_merge desc, c.kind, c.j) - 1 as slot
    from corpus c
    join halves h on h.d = c.d
),
timed as (
  select p.*,
         (p.day + case when p.kind = 'hil' and p.weekday_rank between 1 and 14 then time '13:59:40'
                       when p.kind = 'hil' then time '08:59:40'
                       when p.queue_probe and not p.in_window then time '14:20:00'
                       when p.in_window then time '06:00:00' + make_interval(mins => 20 * p.slot::int)
                       else time '16:30:00' + make_interval(mins => 15 * p.slot::int) end)
           at time zone 'UTC' as queued_at,
         case when p.kind = 'hil' then 20
              when p.queue_probe and p.weekday_rank in (3, 8, 12) then 150
              when p.queue_probe and p.weekday_rank <= 14 then 420
              when p.queue_probe then 60
              else 20 end as wait
    from placed p
)
select ('5eed0062-0000-4000-8000-' || lpad((10000 + row_number() over w)::text, 12, '0'))::uuid,
       scope.organization_id, 10000 + row_number() over w,
       case when t.kind = 'hil' then scope.pool_b else scope.pool_a end,
       runner.id, scope.repo_id,
       case when t.on_main then 'refs/heads/main'
            when t.kind = 'hil' or (t.kind in ('native', 'qemu') and t.j = 1 and t.day_hil > 0)
              then 'refs/heads/gh-readonly-queue/main/pr-' || (3030 + (89 - t.d) * 40 + 1)::text
                   || '-' || left(md5('helios-firmware/pair/' || t.d || '/1'), 7)
            when t.kind = 'zephyr' then 'refs/pull/' || (3000 + (89 - t.d) * 40 + t.j)::text || '/head'
            else 'refs/pull/' || (3030 + (89 - t.d) * 40 + t.j)::text || '/head' end,
       left(md5(sha.key) || md5(sha.key || '.'), 40),
       case t.kind when 'zephyr' then 'zephyr build' when 'native' then 'native_sim'
                   when 'qemu' then 'qemu_cortex_m3' else 'HIL test rig' end,
       case when t.is_merge then t.merge_title
            when t.on_main then 'Nightly build of main'
            when t.kind = 'hil' then 'HIL: sweep the merge-queue head on helios-rig-02'
            when t.kind = 'zephyr' then topic.topic
            else 'twister ' || case t.kind when 'native' then 'native_sim' else 'qemu_cortex_m3' end
                 || ': ' || topic.topic end,
       case when t.kind = 'hil' then 'shell' else 'container' end,
       case when t.kind = 'hil' then null
            when t.d >= 85 then 'ghcr.io/acme-robotics/zephyr-sdk:0.15'
            else 'ghcr.io/acme-robotics/zephyr-sdk:0.16' end,
       case t.kind when 'zephyr' then 'west build -b helios_mainboard app'
                                      || case when t.j % 7 = 3 then ' -- -DCONFIG_HELIOS_OTA_DEBUG_LOG=y'
                                              else '' end
                   when 'native' then 'west twister -p native_sim -T tests'
                   when 'qemu'   then 'west twister -p qemu_cortex_m3 -T tests'
                   else 'make hil-sweep RIG=helios-rig-02' end,
       t.status,
       t.queued_at,
       t.queued_at + make_interval(secs => t.wait - 10),
       t.queued_at + make_interval(secs => t.wait),
       t.queued_at + make_interval(secs => t.wait + t.secs),
       case when t.status = 'succeeded' then 0 else 1 end,
       case when t.kind = 'hil' or t.d > 47 or t.status <> 'succeeded' then null
            when t.in_window then jsonb_build_object('hits', 155, 'misses', 345, 'version', '4.9')
            else jsonb_build_object('hits', 390, 'misses', 110, 'version', '4.9') end
  from timed t
  cross join scope
  cross join lateral (select case when t.on_main then 'helios-firmware/merge/' || t.head_d
                                  when t.kind = 'zephyr' then 'helios-firmware/pr/' || t.d || '/' || t.j
                                  when t.kind = 'hil' and t.day_pairs > 0
                                    then 'helios-firmware/pair/' || t.d || '/1'
                                  when t.kind = 'hil' then 'helios-firmware/gate/' || t.d || '/' || t.j
                                  else 'helios-firmware/pair/' || t.d || '/' || t.j end as key) sha
  join topics topic on topic.n = (t.d * 7 + t.j) % 12
  join ouroboros.runners runner
    on runner.organization_id = scope.organization_id
   and runner.name = case when t.kind = 'hil' and t.d <= 20 then 'anvil-mac'
                          when t.kind = 'hil' then 'bigiron'
                          when t.queue_probe then 'forge-01'
                          when t.d >= 60 then 'forge-00'
                          when t.d < 6 and t.j % 4 = 3 then 'forge-03'
                          else (array['forge-01', 'forge-02', 'forge-03', 'forge-00'])[t.j % 4 + 1] end
 where ${ouro_dev_seed}
window w as (order by t.queued_at, t.kind, t.j)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The log tails the pattern analyzers read.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_log_chunks (id, job_id, seq, content, received_at, retain_until)
with jobs as (
  select job.*,
         exists (select 1 from ouroboros.build_jobs twin
                  where twin.organization_id = job.organization_id
                    and twin.commit_sha = job.commit_sha and twin.id <> job.id
                    and twin.label = 'qemu_cortex_m3' and twin.status = 'failed') as paired
    from ouroboros.build_jobs job
   where job.id::text like '5eed0062-%'
),
ota as (
  select job.id, job.number, job.finished_at,
         row_number() over (order by job.number desc) as rn
    from jobs job
   where job.label = 'native_sim' and job.status = 'failed' and not job.paired
),
cached as (
  select job.id, job.number, job.finished_at,
         row_number() over (order by job.number) as rn, count(*) over () as total
    from jobs job
   where job.ccache_stats is not null
),
unconfigured as (
  select job.id, job.number, job.finished_at, row_number() over (order by job.number) as rn
    from jobs job
   where job.label = 'zephyr build' and job.status = 'succeeded' and job.ccache_stats is null
),
cases (n, name, file) as (
  values (1, 'ota.resume.interrupted_download', 'resume'),
         (2, 'ota.resume.power_loss_mid_swap',  'resume'),
         (3, 'ota.rollback.checksum_mismatch',  'rollback'),
         (4, 'ota.rollback.confirm_timeout',    'rollback'),
         (5, 'ota.header.version_parse',        'header'),
         (6, 'ota.manifest.signature_ed25519',  'manifest'),
         (7, 'ota.slot.erase_before_write',     'slot'),
         (8, 'ota.slot.generation_counter',     'slot')
),
kconfig (n, option, source) as (
  values (1, 'CONFIG_HELIOS_LEGACY_UART_SHIM',  'drivers/serial/Kconfig.helios:12'),
         (2, 'CONFIG_HELIOS_BLE_MESH_PROXY',    'subsys/bluetooth/Kconfig.helios:40'),
         (3, 'CONFIG_HELIOS_CAN_FD_EXPERIMENTAL', 'drivers/can/Kconfig.helios:27'),
         (4, 'CONFIG_HELIOS_FLASH_WEAR_LOG',    'subsys/storage/Kconfig.helios:8')
),
tails (job_id, number, finished_at, content) as (
  -- An OTA failure in native_sim. The most recent of them are the fixture's timeout, one line
  -- that takes the suite's shared setup down and every case behind it; the rest fail on their
  -- own assertions, seven or eight cases at a time.
  select ota.id, ota.number, ota.finished_at,
         E'$ west twister -p native_sim -T tests\n'
         || case when ota.rn <= 31
                 then 'FAIL - ota.fixture.shared_setup: fixture ''ota_image_server'' setup timed out after 30.'
                      || (ota.number % 9 + 1) || E's\n'
                      || (select string_agg('FAIL - ' || c.name || ': fixture ''ota_image_server'' unavailable',
                                            E'\n' order by c.n) || E'\n'
                            from cases c where c.n <= 6)
                 else (select string_agg('FAIL - ' || c.name || ': assertion failed at tests/ota/src/'
                                         || c.file || '.c:' || (40 + 7 * c.n + ota.number % 13),
                                         E'\n' order by c.n) || E'\n'
                         from cases c where c.n <= case when ota.rn <= 34 then 8 else 7 end)
            end
    from ota
  union all
  -- The commits native_sim and qemu_cortex_m3 both failed: a real defect, caught twice.
  select job.id, job.number, job.finished_at,
         '$ ' || job.command || E'\nFAIL - drivers.can.loopback.tx_rx: expected frame 0x123, got none\n'
    from jobs job
   where job.paired or (job.label = 'qemu_cortex_m3' and job.status = 'failed')
  union all
  select job.id, job.number, job.finished_at,
         E'$ make hil-sweep RIG=helios-rig-02\nhelios-rig-02: power cycling the DUT\n'
         || E'FAIL - hil.ota.power_loss_mid_swap: DUT did not re-enumerate within 20 s\n'
    from jobs job
   where job.label = 'HIL test rig' and job.status = 'failed'
  union all
  select job.id, job.number, job.finished_at,
         '$ ' || job.command || E'\nsubsys/ota/slot_manager.c:'
         || (100 + job.number % 50) || E':9: error: implicit declaration of function ''slot_mark_pending''\n'
         || E'ninja: build stopped: subcommand failed.\n'
    from jobs job
   where job.label = 'zephyr build' and job.status = 'failed'
  union all
  -- ccache's manifest misses: the upstream bug its 4.11 release fixes, spread evenly over the
  -- builds that ran with a cache.
  select cached.id, cached.number, cached.finished_at,
         E'$ west build -b helios_mainboard app\n'
         || E'ccache: warning: manifest hash miss for zephyr/include/generated/autoconf.h (ccache#1412)\n'
    from cached
   where cached.rn * 118 / cached.total > (cached.rn - 1) * 118 / cached.total
  union all
  -- Kconfig drift: four of the dead options are still assigned by an overlay somewhere, and never
  -- take — which is what a drift warning says.
  select u.id, u.number, u.finished_at,
         E'$ west build -b helios_mainboard app\nwarning: ' || k.option || ' (defined at ' || k.source
         || E') was assigned the value ''y'' but got the value ''n''. Check these unsatisfied dependencies.\n'
    from unconfigured u
    join kconfig k on u.rn = 60 * k.n
)
select ('5eed0063-0000-4000-8000-' || lpad(t.number::text, 12, '0'))::uuid,
       t.job_id, 1, convert_to(t.content, 'UTF8'), t.finished_at,
       greatest(t.finished_at, now()) + interval '30 days'
  from tails t
 where ${ouro_dev_seed}
   and not exists (select 1 from ouroboros.build_log_chunks existing
                    where existing.job_id = t.job_id and existing.seq = 1)
 order by t.number
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The log volume — 4.1M lines over the window, counted on the jobs rather than kept (#510).
--
-- The farm keeps tails, not four million lines; V086's `build_jobs.log_lines` is the count the
-- farm took as every chunk landed, and it outlives the retention sweep. The tails above were
-- counted as they were inserted; the lines the farm logged before keeping only the tails are set
-- here. The window's finished helios-firmware builds sum to exactly the scale below: the farm
-- seed's builds keep the lines their own chunks counted, and the remainder is shared out over the
-- corpus's builds by kind — a twister run says more than a build, a HIL sweep less — floored,
-- with the last lines going one each to the earliest builds.
-- ---------------------------------------------------------------------------
update ouroboros.build_jobs job
   set log_lines = share.lines
  from (
    with scope as (
      select org."id" as organization_id, repo.id as repo_id,
             (now() at time zone 'UTC')::date as today
        from ouroboros.organization org
        join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
        join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
       where org."slug" = 'acme-robotics'
    ),
    in_window as (
      select job.id, job.number, job.label, job.log_lines,
             job.id::text like '5eed0062-%' as corpus
        from ouroboros.build_jobs job, scope
       where job.organization_id = scope.organization_id and job.github_repo_id = scope.repo_id
         and job.status in ('succeeded', 'failed', 'retried')
         and (job.finished_at at time zone 'UTC')::date between scope.today - 90 and scope.today - 1
    ),
    weighted as (
      select id, number,
             case label when 'native_sim' then 4 when 'qemu_cortex_m3' then 4
                        when 'HIL test rig' then 2 else 3 end as weight
        from in_window
       where corpus
    ),
    budget as (
      select 4100000 - (select coalesce(sum(log_lines), 0) from in_window where not corpus) as lines,
             (select sum(weight) from weighted) as weight
    ),
    floored as (
      select w.id, w.number, floor(b.lines * w.weight / b.weight)::bigint as lines
        from weighted w, budget b
    )
    select f.id,
           f.lines + case when row_number() over (order by f.number)
                               <= (select b.lines from budget b) - sum(f.lines) over ()
                          then 1 else 0 end as lines
      from floored f
  ) share
 where job.id = share.id
   and job.log_lines is distinct from share.lines
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The loops — helios-firmware's older loops, so the window holds the strip's 312 (#510).
--
-- The dashboard, knowledge and metrics seeds hold the loops of the last few weeks; the analyzer
-- counts every loop started in its ninety days. The rest are here, 31–89 days back so no
-- thirty-day page (the dashboard's weeks, #434's interventions, mockup 15's window) counts them:
-- spread evenly, oldest first, each a `standard-fix` loop that merged — or, one in eight, failed
-- at the build farm before opening a pull request. None stopped for a person, so no intervention
-- event is raised; none has a pull-request row or a build job, so no rollup family derived from
-- those planes moves. Issue numbers from #3001 and loop numbers from 1301 sit below and apart
-- from every other seed's.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            loop_seq, workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
with scope as (
  select org."id" as organization_id, repo.id as repo_id,
         (now() at time zone 'UTC')::date as today
    from ouroboros.organization org
    join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
   where org."slug" = 'acme-robotics'
),
others as (
  select count(*) as loops
    from ouroboros.runs run, scope
   where run.organization_id = scope.organization_id and run.github_repo_id = scope.repo_id
     and (run.started_at at time zone 'UTC')::date between scope.today - 90 and scope.today - 1
     and run.id::text not like '5eed006e-%'
),
plan as (
  select k, (312 - others.loops)::integer as total
    from others, generate_series(1, (312 - others.loops)::integer) as k
),
titles (n, title) as (
  values (0, 'OTA: retry the slot erase after a flash timeout'),
         (1, 'CAN: guard the RX ring against overrun'),
         (2, 'BLE: re-advertise after a dropped bond'),
         (3, 'Telemetry: clamp the CBOR frame length'),
         (4, 'Motor PID: saturate the integral term'),
         (5, 'Bootloader: check the image header magic first')
),
loops as (
  select plan.k,
         89 - ((plan.k - 1) * 59) / plan.total as days_back,
         plan.k % 8 = 0 as failed,
         titles.title
    from plan
    join titles on titles.n = plan.k % 6
)
select ('5eed006e-0000-4000-8000-' || lpad(l.k::text, 12, '0'))::uuid,
       scope.organization_id, scope.repo_id, 3000 + l.k, l.title,
       1300 + l.k, 'standard-fix',
       case when l.k % 3 = 0 then 'ollama/qwen3-coder' else 'claude-sonnet-5' end,
       case when l.failed then 'failed' else 'merged' end,
       case when l.failed then 'Build farm' else 'Merged' end,
       case when l.failed then 4 else 6 end, 6,
       ((scope.today - l.days_back) + time '08:00' + make_interval(mins => (l.k * 37) % 600))
         at time zone 'UTC',
       ((scope.today - l.days_back) + time '08:00' + make_interval(mins => (l.k * 37) % 600 + 12 + l.k % 20))
         at time zone 'UTC',
       case when l.failed then null else 3400 + l.k end,
       case when l.failed then null else 13 end,
       case when l.failed then null else 13 end
  from loops l, scope
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The build-duration series — V086's `build_duration` family, as its rollup derives it (#510).
--
-- The duration chart and the corpus read the daily median build duration per job label from the
-- Insights grain. Like `builds`, the family is derived from the farm plane rather than summarised:
-- each (repository, label, UTC day) with succeeded builds keeps every build's start-to-finish
-- milliseconds, ascending, in `meta.samples`, and its `value` is their median — the row
-- ouroboros-rest's extractor writes for the same day. Ninety days, the same span as every other
-- family here, and the family is marked filled through yesterday so the first tick does not
-- backfill over it.
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_daily
  (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, meta)
select job.organization_id, gh.login || '/' || repo.name, 'build_duration', false, job.label,
       (job.finished_at at time zone 'UTC')::date,
       percentile_cont(0.5) within group (
         order by round(extract(epoch from job.finished_at - job.started_at) * 1000)),
       jsonb_build_object('samples', jsonb_agg(
         round(extract(epoch from job.finished_at - job.started_at) * 1000)
         order by round(extract(epoch from job.finished_at - job.started_at) * 1000)))
  from ouroboros.build_jobs job
  join ouroboros.organization org  on org."id" = job.organization_id and org."slug" = 'acme-robotics'
  join ouroboros.github_repos repo on repo.id = job.github_repo_id
  join ouroboros.github_orgs  gh   on gh.id = repo.org_id
 where job.status = 'succeeded'
   and (job.finished_at at time zone 'UTC')::date
       between (now() at time zone 'UTC')::date - 89 and (now() at time zone 'UTC')::date
   and ${ouro_dev_seed}
 group by job.organization_id, gh.login, repo.name, job.label, (job.finished_at at time zone 'UTC')::date
on conflict do nothing;

insert into ouroboros.metric_rollup_state (organization_id, family, last_filled_day,
                                           last_run_status, last_run_at)
select org."id", 'build_duration', (now() at time zone 'UTC')::date - 1, 'succeeded', now()
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Three thermal waivers — on three helios-firmware loops 33–57 days back, each waiving a case the
-- rig cannot run because helios-rig-02 has no thermal chamber. #482's own waiver says the same
-- thing, but today, after the run: it is the test-results seed's, and the next run's to count.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_waivers (id, organization_id, run_id, author, reason, case_keys, created_at)
select ('5eed006d-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", run.id, person."id", seed.reason, '{}', run.started_at + interval '3 hours'
  from (values
         (290, 'ken@acme-robotics.dev',
          'helios-rig-02 has no thermal chamber — littlefs superblock recovery on a cold boot is unverified'),
         (292, 'jorge@acme-robotics.dev',
          'thermal coverage missing on helios-rig-02: BLE pairing at 70 °C cannot be run on the bench'),
         (294, 'maya@acme-robotics.dev',
          'no thermal chamber on helios-rig-02 — the MCUboot swap at −20 °C was not exercised')
       ) as seed (issue_number, author_email, reason)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs run         on run.organization_id = org."id"
                                 and run.issue_number = seed.issue_number
  join ouroboros."user" person    on person."email" = seed.author_email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The schedule — weekly on Monday at 06:00 UTC, and every fifty builds.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_schedules
  (id, organization_id, repo_ref, enabled, weekly_enabled, weekly_day, weekly_time,
   every_n_builds, build_counter, max_builds, max_log_lines, compute_ceiling_seconds, updated_by)
select '5eed0064-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics/helios-firmware',
       true, true, 1, time '06:00', 50,
       (select count(*) from ouroboros.build_jobs job
          join ouroboros.github_repos repo on repo.id = job.github_repo_id
         where job.organization_id = org."id" and repo.name = 'helios-firmware'
           and job.finished_at >= now() - interval '161 minutes'),
       2000, 1230000, 3600, ken."id"
  from ouroboros.organization org
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The run before — five weeks ago, when the two changes the card measures were proposed.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_runs
  (id, organization_id, repo_ref, trigger, schedule_id, status, corpus_manifest, analyzer_set,
   started_at)
with scope as (
  select org."id" as organization_id, repo.id as repo_id, schedule.id as schedule_id,
         schedule.max_builds, schedule.max_log_lines, schedule.compute_ceiling_seconds,
         (now() at time zone 'UTC')::date - 38 as run_day
    from ouroboros.organization org
    join ouroboros.github_orgs gh          on gh.organization_id = org."id" and gh.login = 'acme-robotics'
    join ouroboros.github_repos repo       on repo.org_id = gh.id and repo.name = 'helios-firmware'
    join ouroboros.analysis_schedules schedule
      on schedule.organization_id = org."id" and schedule.repo_ref = 'acme-robotics/helios-firmware'
   where org."slug" = 'acme-robotics'
)
select '5eed0065-0000-4000-8000-000000000001'::uuid, scope.organization_id,
       'acme-robotics/helios-firmware', 'weekly', scope.schedule_id, 'running',
       jsonb_build_object(
         'window',  jsonb_build_object('from', scope.run_day - 90, 'to', scope.run_day - 1, 'days', 90),
         'counts',  jsonb_build_object('builds', counted.builds, 'loops', 271,
                                       'log_lines', 2900000, 'hil_sessions', counted.hil),
         'sources', jsonb_build_object(
                      'builds',       jsonb_build_object('sampled', false, 'rate', 1, 'cap', null),
                      'loops',        jsonb_build_object('sampled', false, 'rate', 1, 'cap', null),
                      'log_lines',    jsonb_build_object('sampled', true, 'rate', 0.5,
                                                         'cap', 'max_log_lines'),
                      'hil_sessions', jsonb_build_object('sampled', false, 'rate', 1, 'cap', null)),
         -- The schedule's cap was higher five weeks ago: 0.5 of 2.9M lines is what it allowed.
         'budget',  jsonb_build_object('max_builds', scope.max_builds,
                                       'max_log_lines', 1450000,
                                       'compute_ceiling_seconds', scope.compute_ceiling_seconds)),
       jsonb_build_object('label', 'deterministic analyzers v1',
                          'analyzers', jsonb_build_array(
                            jsonb_build_object('id', 'cache_window', 'version', 1, 'kind', 'deterministic'),
                            jsonb_build_object('id', 'workflow_outcome', 'version', 1, 'kind', 'deterministic'))),
       (scope.run_day + time '06:00') at time zone 'UTC'
  from scope
  cross join lateral (
    select count(*) as builds, count(*) filter (where job.label = 'HIL test rig') as hil
      from ouroboros.build_jobs job
     where job.organization_id = scope.organization_id and job.github_repo_id = scope.repo_id
       and (job.finished_at at time zone 'UTC')::date between scope.run_day - 90 and scope.run_day - 1
  ) counted
 where ${ouro_dev_seed}
on conflict do nothing;

-- Its two findings: the twister suites running one after another, and a runner's first build
-- going cold. Both analyzers' own scoring is v1's, stated in the basis.
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date as day_to
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000001' and r.status = 'running'
),
corpus as (
  select job.* from run
    join ouroboros.build_jobs job on job.organization_id = run.organization_id
                                 and job.id::text like '5eed0062-%'
                                 and (job.finished_at at time zone 'UTC')::date
                                     between run.day_from and run.day_to
),
seed (n, analyzer, finding_type, subject_key, data, label, confidence, method, effect_size,
      stability) as (
  values
    (1, 'workflow_outcome', 'workflow_outcome', 'standard-fix/stage test/serial_suite_share',
     '{"workflow": "standard-fix", "scope": "stage test", "metric": "serial_suite_share",
       "value": 0.41, "unit": "share"}'::jsonb,
     'native_sim', 90, 'workflow_outcome v1: a stage''s share of loop wall-clock, over the window''s loops',
     0.41, 0.93),
    (2, 'cache_window', 'cache_window', 'runner cold start',
     '{"trigger": "runner cold start", "hit_rate_before": 0.78, "hit_rate_after": 0.12,
       "window_hours": 1, "occurrences": 9}'::jsonb,
     'zephyr build', 86, 'cache_window v1: the hit rate inside each trigger''s window against the rest',
     0.66, 0.89)
)
select ('5eed0066-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid, run.id,
       run.organization_id, run.repo_ref, seed.analyzer, 1, seed.finding_type, seed.subject_key,
       seed.data || jsonb_build_object('sample', sample.n),
       sample.refs, seed.confidence,
       jsonb_build_object('method', seed.method, 'sample_size', sample.n,
                          'effect_size', seed.effect_size, 'stability', seed.stability),
       run.started_at + make_interval(mins => 10 * seed.n)
  from run
  cross join seed
  cross join lateral (
    select count(*) as n,
           (select jsonb_agg(jsonb_build_object('kind', 'build', 'id', c.id::text) order by c.number)
              from (select c2.id, c2.number from corpus c2
                     where c2.label = seed.label and c2.status = 'succeeded'
                       and (seed.n = 1 or c2.ccache_stats is not null)
                     order by c2.number desc limit 3) c) as refs
      from corpus c
     where c.label = seed.label and c.status = 'succeeded'
       and (seed.n = 1 or c.ccache_stats is not null)
  ) sample
 where ${ouro_dev_seed}
on conflict do nothing;

-- What it suggested. Composed in the run, and stored as composed.
insert into ouroboros.analysis_suggestions
  (id, organization_id, repo_ref, kind, identity_key, last_run_id, title, evidence_line,
   confidence, impact, needs_spike, action_binding, created_at)
select ('5eed0067-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid, run.organization_id,
       run.repo_ref, 'build_process',
       ouroboros.analysis_suggestion_identity('build_process', array[finding.identity_key]),
       run.id, seed.title, seed.evidence_line, seed.confidence, seed.impact::jsonb, false,
       seed.action_binding::jsonb, run.started_at + interval '30 minutes'
  from (values
         (1, 1, 'Test-suite split',
          'twister suites run one after another: 41% of loop wall-clock sits in the test stage', 90,
          '{"estimate": -220, "unit": "seconds", "applies_to": "per loop",
            "basis": {"method": "extrapolated",
                      "description": "the test stage''s share of loop time, sharded four ways"}}',
          '{"plane": "test_gate", "change": {"shards": 4, "suites": "tests/**"}}'),
         (2, 2, 'ccache warm-up',
          'the first build after a runner starts hits the cache 12% of the time (9 runner starts)', 86,
          '{"estimate": -110, "unit": "seconds", "applies_to": "first build after a runner start",
            "basis": {"method": "measured", "sample_size": 9,
                      "description": "9 runner starts, cold against warm"}}',
          '{"plane": "job_hook", "change": {"on": "runner.start", "run": "west build -t ccache-warm"}}')
       ) as seed (n, finding_n, title, evidence_line, confidence, impact, action_binding)
  join ouroboros.analysis_runs run     on run.id = '5eed0065-0000-4000-8000-000000000001'
                                      and run.status = 'running'
  join ouroboros.analysis_findings finding
    on finding.id = ('5eed0066-0000-4000-8000-' || lpad(seed.finding_n::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.analysis_suggestion_findings (suggestion_id, finding_id, organization_id, repo_ref)
select suggestion.id, finding.id, suggestion.organization_id, suggestion.repo_ref
  from (values (1, 1), (2, 2)) as seed (suggestion_n, finding_n)
  join ouroboros.analysis_suggestions suggestion
    on suggestion.id = ('5eed0067-0000-4000-8000-' || lpad(seed.suggestion_n::text, 12, '0'))::uuid
  join ouroboros.analysis_findings finding
    on finding.id = ('5eed0066-0000-4000-8000-' || lpad(seed.finding_n::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.analysis_runs
   set status = 'complete', finished_at = started_at + interval '38 minutes', compute_seconds = 2280,
       confidence_note = 'high — 90d of stable telemetry',
       -- It ended composing, every analyzer of its set completed with the findings it wrote
       -- (#510's progress, frozen with the run).
       phase = 'composing',
       progress = jsonb_build_object('analyzers', (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a ->> 'id', 'version', (a ->> 'version')::integer, 'status', 'completed',
                  'findings', (select count(*) from ouroboros.analysis_findings finding
                                where finding.run_id = '5eed0065-0000-4000-8000-000000000001'
                                  and finding.analyzer = a ->> 'id'
                                  and finding.analyzer_version = (a ->> 'version')::integer))
                  order by ordinality), '[]'::jsonb)
           from jsonb_array_elements(analyzer_set -> 'analyzers') with ordinality as set_entry (a, ordinality)))
 where id = '5eed0065-0000-4000-8000-000000000001'
   and status = 'running'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Both were applied — Ken pressed Apply on each, a week apart — and measured for fourteen days.
-- ---------------------------------------------------------------------------
insert into ouroboros.audit_events
  (id, organization_id, actor_id, action, subject_type, subject_id, detail, occurred_at)
select ('5eed0068-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid, suggestion.organization_id,
       ken."id", 'analysis_suggestion.applied', 'analysis_suggestion', suggestion.id::text,
       jsonb_build_object('plane', suggestion.action_binding ->> 'plane',
                          'title', suggestion.title),
       ((now() at time zone 'UTC')::date - seed.days_ago + time '10:00') at time zone 'UTC'
  from (values (1, 37), (2, 30)) as seed (n, days_ago)
  join ouroboros.analysis_suggestions suggestion
    on suggestion.id = ('5eed0067-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.analysis_suggestions suggestion
   set status = 'applied', applied_event_id = event.id, resolved_by = event.actor_id,
       resolved_at = event.occurred_at
  from ouroboros.audit_events event
 where event.id = ('5eed0068-0000-4000-8000-' || right(suggestion.id::text, 12))::uuid
   and suggestion.id in ('5eed0067-0000-4000-8000-000000000001', '5eed0067-0000-4000-8000-000000000002')
   and suggestion.status = 'open'
   and ${ouro_dev_seed};

-- The predictions, frozen at apply — each against the fortnight before it.
insert into ouroboros.suggestion_measurements
  (id, suggestion_id, organization_id, repo_ref, applied_at, applied_by, target_metric, baseline,
   predicted)
select ('5eed0069-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid, suggestion.id,
       suggestion.organization_id, suggestion.repo_ref, suggestion.resolved_at,
       suggestion.resolved_by, seed.target_metric,
       jsonb_build_object('window', jsonb_build_object('from', applied.day - 14, 'to', applied.day - 1),
                          'value', seed.baseline),
       jsonb_build_object('delta', (suggestion.impact ->> 'estimate')::numeric, 'unit', 'seconds',
                          'basis', suggestion.impact -> 'basis',
                          'calibration', jsonb_build_object('analyzer', seed.analyzer,
                                                            'impact_class', 'duration_delta',
                                                            'factor', 1))
  from (values (1, 'cycle_time',     'workflow_outcome', 912),
               (2, 'stage_duration', 'cache_window',     380)
       ) as seed (n, target_metric, analyzer, baseline)
  join ouroboros.analysis_suggestions suggestion
    on suggestion.id = ('5eed0067-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid
   and suggestion.status = 'applied'
  cross join lateral (select (suggestion.resolved_at at time zone 'UTC')::date as day) applied
 where ${ouro_dev_seed}
on conflict do nothing;

-- …and what the fortnight after measured. The verdict is V085's arithmetic over these numbers.
update ouroboros.suggestion_measurements measurement
   set measured = jsonb_build_object('window', jsonb_build_object('from', measurement.applied_on,
                                                                 'to', measurement.window_ends_on),
                                     'value', seed.measured,
                                     'delta', seed.measured - (measurement.baseline ->> 'value')::numeric),
       verdict = ouroboros.suggestion_measurement_verdict(
                   (measurement.predicted ->> 'delta')::numeric,
                   seed.measured - (measurement.baseline ->> 'value')::numeric,
                   measurement.verdict_under_below, measurement.verdict_over_above, false),
       note = seed.note,
       closed_at = ((measurement.window_ends_on + 1) + time '03:00') at time zone 'UTC'
  from (values (1, 677, null),
               (2, 308, 'under-delivered — analyzer revised its cache model')
       ) as seed (n, measured, note)
 where measurement.id = ('5eed0069-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid
   and measurement.verdict = 'pending'
   and ${ouro_dev_seed};

-- The cache model's correction, and the test model's — #508's formula, through its own writer.
select count(cell.factor) as recalibrated
  from ouroboros.organization org
  cross join (values ('cache_window'), ('workflow_outcome')) as seed (analyzer)
  cross join lateral (select ouroboros.recalibrate_analyzer(org."id", 'acme-robotics/helios-firmware',
                                                            seed.analyzer, 'duration_delta') as factor) cell
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The run the page shows — two hours ago, forty-one minutes long, fired by the fifty-build counter.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_runs
  (id, organization_id, repo_ref, trigger, schedule_id, status, corpus_manifest, analyzer_set,
   started_at)
with scope as (
  select org."id" as organization_id, repo.id as repo_id, schedule.id as schedule_id,
         schedule.max_builds, schedule.max_log_lines, schedule.compute_ceiling_seconds,
         (now() at time zone 'UTC')::date as today
    from ouroboros.organization org
    join ouroboros.github_orgs gh          on gh.organization_id = org."id" and gh.login = 'acme-robotics'
    join ouroboros.github_repos repo       on repo.org_id = gh.id and repo.name = 'helios-firmware'
    join ouroboros.analysis_schedules schedule
      on schedule.organization_id = org."id" and schedule.repo_ref = 'acme-robotics/helios-firmware'
   where org."slug" = 'acme-robotics'
)
select '5eed0065-0000-4000-8000-000000000002'::uuid, scope.organization_id,
       'acme-robotics/helios-firmware', 'every_n_builds', scope.schedule_id, 'running',
       jsonb_build_object(
         'window',  jsonb_build_object('from', scope.today - 90, 'to', scope.today - 1, 'days', 90),
         'counts',  jsonb_build_object('builds', counted.builds, 'loops', looped.loops,
                                       'log_lines', counted.log_lines, 'hil_sessions', counted.hil),
         'sources', jsonb_build_object(
                      'builds',       jsonb_build_object('sampled', false, 'rate', 1, 'cap', null),
                      'loops',        jsonb_build_object('sampled', false, 'rate', 1, 'cap', null),
                      'log_lines',    jsonb_build_object('sampled', true, 'rate', 0.3,
                                                         'cap', 'max_log_lines'),
                      'hil_sessions', jsonb_build_object('sampled', false, 'rate', 1, 'cap', null)),
         'budget',  jsonb_build_object('max_builds', scope.max_builds,
                                       'max_log_lines', scope.max_log_lines,
                                       'compute_ceiling_seconds', scope.compute_ceiling_seconds)),
       jsonb_build_object('label', 'deterministic analyzers v1',
                          'analyzers', (select jsonb_agg(jsonb_build_object('id', a.id, 'version', 1,
                                                                            'kind', 'deterministic')
                                                         order by a.n)
                                          from (values (1, 'change_point'), (2, 'log_signature'),
                                                       (3, 'config_usage'), (4, 'cache_window'),
                                                       (5, 'queue_correlation'), (6, 'waiver_cite'),
                                                       (7, 'workflow_outcome')) as a (n, id))),
       now() - interval '161 minutes'
  from scope
  -- BV.1's (#510) manifest definitions, counted from the rows: finished builds, the lines they
  -- logged, the ones that ran on a pool tagged `hil`, and the loops started inside the window.
  cross join lateral (
    select count(*) as builds, coalesce(sum(job.log_lines), 0) as log_lines,
           count(*) filter (where pool.tags ? 'hil') as hil
      from ouroboros.build_jobs job
      join ouroboros.runner_pools pool on pool.id = job.pool_id
     where job.organization_id = scope.organization_id and job.github_repo_id = scope.repo_id
       and job.status in ('succeeded', 'failed', 'retried')
       and (job.finished_at at time zone 'UTC')::date between scope.today - 90 and scope.today - 1
  ) counted
  cross join lateral (
    select count(*) as loops
      from ouroboros.runs run
     where run.organization_id = scope.organization_id and run.github_repo_id = scope.repo_id
       and (run.started_at at time zone 'UTC')::date between scope.today - 90 and scope.today - 1
  ) looped
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- change_point — the chart's three chips, exactly as BV.2's analyzer emits them.
--
-- The breaks and their candidates below are what `ChangePointAnalyzer` v1 returns for the corpus
-- above: a breakpoint's day, delta, segment medians and confidence basis, and each candidate's
-- score as proximity × prior, best first. Nothing checks them here; the analyzer does —
-- tests/verify-analyzer-rediscovery.sh runs it over these rows and refuses the seed if any field
-- differs. Refs are found by natural key; the evidence ends with the last build before the break
-- and the first on it, as the analyzer cites them.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,to}')::date + 1 as today
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
series as (
  select job.id, (job.finished_at at time zone 'UTC')::date as day
    from run
    join ouroboros.github_repos repo on repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.github_orgs gh    on gh.id = repo.org_id and gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.build_jobs job    on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
   where job.label = 'zephyr build' and job.status = 'succeeded'
),
breaks (n, days_ago, delta, before_s, after_s, confidence, sample_size, effect_size, stability) as (
  values (101, 82,   90, 252.0, 342.0,  70, 370, 12.141, 1.0),
         (102, 47, -130, 342.0, 212.0, 100, 642, 17.537, 1.0),
         (103,  9,   40, 212.0, 252.0,  84, 403,  5.396, 1.0)
),
candidates (days_ago, rank, event_kind, offset_days, label, proximity, prior, score) as (
  values (82, 1, 'merge',          0, 'Zephyr 4.1 migration',          1.0,  0.7, 0.7),
         (82, 2, 'infra_event',   -2, 'pool-a image zephyr-sdk:0.16',  0.5,  0.6, 0.3),
         (82, 3, 'policy_version', -2, 'standard-fix v5',              0.5,  0.4, 0.2),
         (82, 4, 'merge',          3, 'docs: README typo',             0.25, 0.7, 0.175),
         (47, 1, 'merge',          0, 'ccache enabled',                1.0,  0.7, 0.7),
         (47, 2, 'merge',         -1, 'can: driver timeout tweak',     0.75, 0.7, 0.525),
         (47, 3, 'policy_version', -1, 'standard-fix v9',              0.75, 0.4, 0.3),
         (9,  1, 'merge',          0, 'twister suite growth',          1.0,  0.7, 0.7),
         (9,  2, 'merge',          2, 'Motor PID: clamp the integral term on saturation', 0.5, 0.7, 0.35),
         (9,  3, 'merge',          2, 'Tune the brown-out threshold for writes during flashing', 0.5, 0.7, 0.35),
         (9,  4, 'merge',          3, 'Publish OTA progress events on the telemetry channel', 0.25, 0.7, 0.175),
         (9,  5, 'merge',          3, 'Refactor the telemetry buffer allocation', 0.25, 0.7, 0.175)
),
refs as (
  select c.*,
         case c.event_kind
           when 'merge' then jsonb_build_object('kind', 'merge', 'id',
             (select job.commit_sha from run
                join ouroboros.build_jobs job on job.organization_id = run.organization_id
               where job.git_ref = 'refs/heads/main' and job.title = c.label
               order by job.queued_at limit 1))
           when 'policy_version' then jsonb_build_object('kind', 'workflow_version', 'id',
             (select v.id::text from run
                join ouroboros.workflows w          on w.organization_id = run.organization_id
                join ouroboros.workflow_versions v  on v.workflow_id = w.id
               where w.slug || ' v' || v.version = c.label))
           else jsonb_build_object('kind', 'runner_pool', 'id',
             (select pool.id::text from run
                join ouroboros.runner_pools pool on pool.organization_id = run.organization_id
               where pool.name = split_part(c.label, ' ', 1)))
         end as ref
    from candidates c
)
select ('5eed0066-0000-4000-8000-' || lpad(b.n::text, 12, '0'))::uuid, run.id, run.organization_id,
       run.repo_ref, 'change_point', 1, 'change_point',
       'build.duration_median@' || (run.today - b.days_ago),
       jsonb_build_object(
         'date', run.today - b.days_ago,
         'metric', 'build.duration_median',
         'delta_seconds', b.delta,
         'before_median_seconds', b.before_s,
         'after_median_seconds', b.after_s,
         'candidates', (select jsonb_agg(jsonb_build_object(
                                 'label', r.label, 'score', r.score, 'ref', r.ref,
                                 'event_kind', r.event_kind,
                                 'date', run.today - b.days_ago + r.offset_days,
                                 'days_from_breakpoint', r.offset_days,
                                 'proximity', r.proximity, 'prior', r.prior) order by r.rank)
                          from refs r where r.days_ago = b.days_ago)),
       (select jsonb_agg(ref order by ord)
          from (select r.ref, r.rank as ord from refs r where r.days_ago = b.days_ago
                union all
                select jsonb_build_object('kind', 'build', 'id', max(s.id::text collate "C")), 100
                  from series s where s.day = run.today - b.days_ago - 1
                union all
                select jsonb_build_object('kind', 'build', 'id', min(s.id::text collate "C")), 101
                  from series s where s.day = run.today - b.days_ago) evidence),
       b.confidence,
       jsonb_build_object('method', 'change_point v1: 100 * stability * (1 - e^(-effect/2)) * '
                                    || 'min(1, shorter segment days / (2 * min_segment_days))',
                          'sample_size', b.sample_size, 'effect_size', b.effect_size,
                          'stability', b.stability),
       run.started_at + interval '6 minutes'
  from run
  cross join breaks b
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- log_signature — two templates, counted over the corpus's log tails.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date as day_to
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
corpus as (
  select job.* from run
    join ouroboros.github_orgs gh    on gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.build_jobs job    on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
   where (job.finished_at at time zone 'UTC')::date between run.day_from and run.day_to
),
lines as (
  select job.id, job.number, line
    from corpus job
    join ouroboros.build_log_chunks chunk on chunk.job_id = job.id
    cross join lateral regexp_split_to_table(convert_from(chunk.content, 'UTF8'), E'\n') line
),
-- template: the line with its variable part masked; pattern: what matches it; population: the
-- lines its share is a share of (null = every build with a cache, for a cache line).
signatures (n, template, pattern, population, confidence, stability) as (
  values (111, 'FAIL - ota.fixture.shared_setup: fixture ''ota_image_server'' setup timed out after <*>s',
               '^FAIL - ota\.fixture\.shared_setup: fixture ''ota_image_server'' setup timed out after [0-9.]+s$',
               '^FAIL - ota\.', 90, 0.94),
         (112, 'ccache: warning: manifest hash miss for <*> (ccache#1412)',
               '^ccache: warning: manifest hash miss for \S+ \(ccache#1412\)$',
               null, 92, 0.97)
),
counted as (
  select s.*, hashed.hash,
         (select count(distinct l.id) from lines l where l.line ~ s.pattern) as builds,
         (select count(*) from lines l where l.line ~ s.pattern) as matched,
         case when s.population is null
              then (select count(*) from corpus c where c.ccache_stats is not null)
              else (select count(*) from lines l where l.line ~ s.population) end as population_n,
         (select jsonb_agg(jsonb_build_object('kind', 'build', 'id', hit.id::text) order by hit.number)
            from (select distinct l.id, l.number from lines l where l.line ~ s.pattern) hit) as refs,
         (select jsonb_agg(jsonb_build_object('kind', 'build', 'id', hit.id::text) order by hit.number)
            from (select distinct l.id, l.number from lines l where l.line ~ s.pattern
                   order by l.number limit 3) hit) as samples
    from signatures s
    cross join lateral (select left(encode(sha256(convert_to(s.template, 'UTF8')), 'hex'), 16) as hash) hashed
)
select ('5eed0066-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid, run.id, run.organization_id,
       run.repo_ref, 'log_signature', 1, 'log_signature', c.hash,
       jsonb_build_object('template', c.template, 'signature_hash', c.hash, 'count', c.builds,
                          'share', round(c.matched::numeric / nullif(c.population_n, 0), 3),
                          'sample_refs', c.samples),
       c.refs, c.confidence,
       jsonb_build_object('method', 'log_signature v1: lines clustered by masked template; share of '
                                    || 'the population the template is drawn from',
                          'sample_size', c.population_n,
                          'effect_size', round(c.matched::numeric / nullif(c.population_n, 0), 3),
                          'stability', c.stability),
       run.started_at + interval '12 minutes'
  from run
  cross join counted c
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- config_usage — the twelve options no build in the window set, and the drift four still cause.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date as day_to
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
corpus as (
  select job.* from run
    join ouroboros.github_orgs gh    on gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.build_jobs job    on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
   where (job.finished_at at time zone 'UTC')::date between run.day_from and run.day_to
),
logged as (
  select job.id, job.number, convert_from(chunk.content, 'UTF8') as text
    from corpus job
    join ouroboros.build_log_chunks chunk on chunk.job_id = job.id
),
options (n, option) as (
  values (121, 'CONFIG_HELIOS_LEGACY_UART_SHIM'),   (122, 'CONFIG_HELIOS_BLE_MESH_PROXY'),
         (123, 'CONFIG_HELIOS_OTA_DELTA_V1'),       (124, 'CONFIG_HELIOS_CAN_FD_EXPERIMENTAL'),
         (125, 'CONFIG_HELIOS_TELEMETRY_CBOR_V1'),  (126, 'CONFIG_HELIOS_MOTOR_SIM_STUB'),
         (127, 'CONFIG_HELIOS_DEBUG_SHELL_EXT'),    (128, 'CONFIG_HELIOS_FLASH_WEAR_LOG'),
         (129, 'CONFIG_HELIOS_LED_MATRIX'),         (130, 'CONFIG_HELIOS_BOOT_BANNER_ASCII'),
         (131, 'CONFIG_HELIOS_I2C_BITBANG'),        (132, 'CONFIG_HELIOS_POWER_TRACE_UART')
),
latest as (
  select jsonb_build_object('kind', 'build', 'id', c.id::text) as ref
    from corpus c where c.label = 'zephyr build' order by c.number desc limit 1
)
select ('5eed0066-0000-4000-8000-' || lpad(o.n::text, 12, '0'))::uuid, run.id, run.organization_id,
       run.repo_ref, 'config_usage', 1, 'config_usage', o.option,
       jsonb_build_object('option', o.option,
                          'occurrences', (select count(*) from corpus c
                                           where position(o.option || '=' in c.command) > 0),
                          'builds_considered', (select count(*) from corpus),
                          'drift_warnings', (select count(*) from logged l
                                              where position('warning: ' || o.option || ' (defined at'
                                                             in l.text) > 0)),
       (select jsonb_agg(ref order by ord) from (
          select jsonb_build_object('kind', 'build', 'id', l.id::text) as ref, l.number as ord
            from logged l
           where position('warning: ' || o.option || ' (defined at' in l.text) > 0
          union all
          select latest.ref, 2147483647 from latest) evidence),
       95,
       jsonb_build_object('method', 'config_usage v1: builds whose configuration set the option, '
                                    || 'over every build in the window',
                          'sample_size', (select count(*) from corpus), 'effect_size', 0,
                          'stability', 1.0),
       run.started_at + interval '15 minutes'
  from run
  cross join options o
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- cache_window — the cache going cold for six hours after every deps-refresh merge.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date as day_to
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
corpus as (
  select job.* from run
    join ouroboros.github_orgs gh    on gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.build_jobs job    on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
   where (job.finished_at at time zone 'UTC')::date between run.day_from and run.day_to
),
merges as (
  select distinct on (job.commit_sha) job.commit_sha, job.queued_at as at, job.title
    from corpus job
   where job.git_ref = 'refs/heads/main'
   order by job.commit_sha, job.queued_at
),
refreshes as (
  select m.* from merges m where m.title = 'deps: refresh west manifest'
),
cached as (
  select c.*, (c.ccache_stats ->> 'hits')::numeric as hits,
         (c.ccache_stats ->> 'hits')::numeric + (c.ccache_stats ->> 'misses')::numeric as objects,
         exists (select 1 from refreshes r
                  where c.queued_at >= r.at and c.queued_at < r.at + interval '6 hours') as after
    from corpus c
   where c.ccache_stats is not null
),
rates as (
  select round(sum(hits) filter (where not after) / sum(objects) filter (where not after), 2) as before,
         round(sum(hits) filter (where after) / sum(objects) filter (where after), 2) as after,
         round(count(*) filter (where after)::numeric / nullif(count(*), 0), 2) as share,
         count(*) as n
    from cached
)
select '5eed0066-0000-4000-8000-000000000141'::uuid, run.id, run.organization_id, run.repo_ref,
       'cache_window', 1, 'cache_window', 'deps-refresh merge',
       jsonb_build_object('trigger', 'deps-refresh merge', 'hit_rate_before', rates.before,
                          'hit_rate_after', rates.after, 'window_hours', 6,
                          'occurrences', (select count(*) from refreshes), 'share', rates.share),
       (select jsonb_agg(jsonb_build_object('kind', 'merge', 'id', r.commit_sha) order by r.at)
          from refreshes r),
       93,
       jsonb_build_object('method', 'cache_window v1: the hit rate inside each trigger''s window against the rest',
                          'sample_size', rates.n, 'effect_size', rates.before - rates.after,
                          'stability', 0.96),
       run.started_at + interval '18 minutes'
  from run, rates
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- queue_correlation — pool-a's afternoon queue, and pool-b idle beside it.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.started_at at time zone 'UTC')::date as run_day
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
-- The last fourteen weekdays before the run, each with its window as instants.
weekdays as (
  select day, (day + time '14:00') at time zone 'UTC' as opens,
         (day + time '16:00') at time zone 'UTC' as closes
    from (select run.run_day - n as day from run, generate_series(1, 30) n) days
   where extract(isodow from day) < 6
   order by day desc
   limit 14
),
pools as (
  select pool.id, pool.name from run
    join ouroboros.runner_pools pool on pool.organization_id = run.organization_id
),
waits as (
  select w.day, job.id, job.number, extract(epoch from job.started_at - job.queued_at) as wait,
         row_number() over (partition by w.day order by job.started_at - job.queued_at desc, job.number) as rn
    from weekdays w
    join ouroboros.build_jobs job on job.queued_at >= w.opens and job.queued_at < w.closes
    join pools on pools.id = job.pool_id and pools.name = 'pool-a'
   where job.started_at is not null
),
exceeded as (
  select * from waits where rn = 1 and wait > 300
),
busy as (
  select coalesce(sum(extract(epoch from least(job.finished_at, w.closes)
                                         - greatest(job.started_at, w.opens))), 0) as seconds
    from weekdays w
    join ouroboros.build_jobs job on job.started_at < w.closes and job.finished_at > w.opens
    join pools on pools.id = job.pool_id and pools.name = 'pool-b'
),
capacity as (
  select count(*) * 7200 * (select count(*) from weekdays) as seconds
    from run
    join ouroboros.runners r on r.organization_id = run.organization_id
    join pools on pools.id = r.pool_id and pools.name = 'pool-b'
   where r.status <> 'removed'
)
select '5eed0066-0000-4000-8000-000000000151'::uuid, run.id, run.organization_id, run.repo_ref,
       'queue_correlation', 1, 'queue_correlation', 'pool-a@14:00-16:00',
       jsonb_build_object('window', jsonb_build_object('from', '14:00', 'to', '16:00'),
                          'metric', 'queue_wait', 'threshold_seconds', 300,
                          'days_exceeded', (select count(*) from exceeded),
                          'days_observed', (select count(*) from weekdays),
                          'idle_share', round(1 - busy.seconds / nullif(capacity.seconds, 0), 2),
                          'pool', 'pool-a', 'idle_pool', 'pool-b'),
       (select jsonb_agg(ref order by ord) from (
          select jsonb_build_object('kind', 'runner_pool', 'id', p.id::text) as ref,
                 case p.name when 'pool-a' then 1 else 2 end as ord
            from pools p
          union all
          select jsonb_build_object('kind', 'runner', 'id', r.id::text), 3
            from run join ouroboros.runners r on r.organization_id = run.organization_id
                                             and r.name = 'forge-02'
          union all
          select jsonb_build_object('kind', 'build', 'id', e.id::text), 3 + e.number
            from exceeded e) evidence),
       84,
       jsonb_build_object('method', 'queue_correlation v1: weekdays whose longest pool-a wait in the '
                                    || 'window crossed the threshold, against the other pool''s idle share',
                          'sample_size', (select count(*) from waits), 'effect_size',
                          round((select count(*) from exceeded)::numeric / nullif((select count(*) from weekdays), 0), 3),
                          'stability', 0.79),
       run.started_at + interval '21 minutes'
  from run, busy, capacity
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- waiver_cite — three waivers in sixty days, all for the thermal chamber helios-rig-02 lacks.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.* from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
cited as (
  select waiver.id, waiver.created_at
    from run
    join ouroboros.pr_waivers waiver on waiver.organization_id = run.organization_id
    join ouroboros.runs loop         on loop.id = waiver.run_id
    join ouroboros.github_repos repo on repo.id = loop.github_repo_id
                                    and repo.name = split_part(run.repo_ref, '/', 2)
   where waiver.reason ilike '%thermal%'
     and waiver.created_at >= run.started_at - interval '60 days'
     and waiver.created_at < run.started_at
)
select '5eed0066-0000-4000-8000-000000000161'::uuid, run.id, run.organization_id, run.repo_ref,
       'waiver_cite', 1, 'waiver_cite', 'missing thermal coverage',
       jsonb_build_object('topic', 'missing thermal coverage', 'window_days', 60,
                          'waiver_count', (select count(*) from cited), 'rig', 'helios-rig-02'),
       (select jsonb_agg(jsonb_build_object('kind', 'waiver', 'id', c.id::text) order by c.created_at)
          from cited c),
       82,
       jsonb_build_object('method', 'waiver_cite v1: waivers in the window whose reasons cluster on one topic',
                          'sample_size', (select count(*) from cited), 'effect_size', 1.0,
                          'stability', 0.9),
       run.started_at + interval '24 minutes'
  from run
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- workflow_outcome — what each test stage catches that the others do not, and three stored
-- correlations the corpus planes do not hold at their scale (see the header).
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_findings
  (id, run_id, organization_id, repo_ref, analyzer, analyzer_version, finding_type, subject_key,
   data, evidence_refs, confidence, confidence_basis, created_at)
with run as (
  select r.*, (r.corpus_manifest #>> '{window,from}')::date as day_from,
         (r.corpus_manifest #>> '{window,to}')::date as day_to
    from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
corpus as (
  select job.* from run
    join ouroboros.github_orgs gh    on gh.organization_id = run.organization_id
                                    and gh.login = split_part(run.repo_ref, '/', 1)
    join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = split_part(run.repo_ref, '/', 2)
    join ouroboros.build_jobs job    on job.organization_id = run.organization_id
                                    and job.github_repo_id = repo.id
   where (job.finished_at at time zone 'UTC')::date between run.day_from and run.day_to
),
-- A stage's unique failure: it failed, and no other stage's build of the same commit did.
stages (n, label, stage) as (
  values (171, 'qemu_cortex_m3', 'qemu_cortex_m3'), (172, 'HIL test rig', 'HIL')
),
outcomes as (
  select s.n, s.stage,
         (select count(*) from corpus c where c.label = s.label) as sample,
         (select count(*) from corpus c
           where c.label = s.label and c.status = 'failed'
             and not exists (select 1 from corpus other
                              where other.commit_sha = c.commit_sha and other.id <> c.id
                                and other.status = 'failed')) as unique_failures,
         (select count(*) from corpus c
           where c.label = s.label and c.status = 'failed'
             and c.git_ref like 'refs/heads/gh-readonly-queue/%'
             and not exists (select 1 from corpus other
                              where other.commit_sha = c.commit_sha and other.id <> c.id
                                and other.status = 'failed')) as at_merge_gate,
         (select jsonb_agg(jsonb_build_object('kind', 'build', 'id', c.id::text) order by c.number)
            from corpus c where c.label = s.label and c.status = 'failed') as refs
    from stages s
),
merges as (
  select distinct on (job.commit_sha) job.commit_sha, job.queued_at as at, job.title
    from corpus job
   where job.git_ref = 'refs/heads/main'
   order by job.commit_sha, job.queued_at
),
stored (n, subject_key, data, refs, confidence, effect_size, stability) as (
  select 173, 'standard-fix/stage build→review/failed_builds_flagged_by_review',
         '{"workflow": "standard-fix", "scope": "stage build → review",
           "metric": "failed_builds_flagged_by_review", "value": 0.34, "unit": "share",
           "sample": 50}'::jsonb,
         (select jsonb_build_array(jsonb_build_object('kind', 'workflow_version', 'id', v.id::text))
            from run
            join ouroboros.workflows w         on w.organization_id = run.organization_id
                                              and w.slug = 'standard-fix'
            join ouroboros.workflow_versions v on v.workflow_id = w.id and v.version is not null
           order by v.version desc limit 1),
         89, 0.34, 0.88
  union all
  select 174, 'standard-fix/drivers-can/telemetry_flake_ratio_7d',
         '{"workflow": "standard-fix", "scope": "merges touching drivers/can",
           "metric": "telemetry_flake_ratio_7d", "value": 3.1, "unit": "ratio", "sample": 21}'::jsonb,
         (select jsonb_agg(jsonb_build_object('kind', 'merge', 'id', m.commit_sha) order by m.at)
            from merges m where m.title like 'can: %'),
         77, 3.1, 0.71
  union all
  select 175, 'zephyr build/step link/link_share',
         jsonb_build_object('workflow', 'zephyr build', 'scope', 'step link', 'metric', 'link_share',
                            'value', 0.42, 'unit', 'share', 'before', 0.18,
                            'sample', (select count(*) from corpus c, merges m
                                        where m.title like 'v2.3:%' and c.label = 'zephyr build'
                                          and c.queued_at >= m.at)),
         (select jsonb_agg(jsonb_build_object('kind', 'merge', 'id', m.commit_sha))
            from merges m where m.title like 'v2.3:%'),
         72, 0.24, 0.81
),
emitted (n, subject_key, data, refs, confidence, method, sample_size, effect_size, stability, minutes) as (
  select o.n, 'standard-fix/stage ' || o.stage || '/unique_failures',
         jsonb_build_object('workflow', 'standard-fix', 'scope', 'stage ' || o.stage,
                            'metric', 'unique_failures', 'value', o.unique_failures, 'unit', 'count',
                            'sample', o.sample, 'at_merge_gate', o.at_merge_gate),
         o.refs, case o.n when 171 then 91 else 90 end,
         'workflow_outcome v1: failures a stage caught that no other stage of the same commit did',
         o.sample, round(o.unique_failures::numeric / nullif(o.sample, 0), 3), 0.95, 27
    from outcomes o
  union all
  select s.n, s.subject_key, s.data, s.refs, s.confidence,
         'workflow_outcome v1: a stage''s outcome over the window''s loops',
         (s.data ->> 'sample')::bigint, s.effect_size, s.stability, 30
    from stored s
)
select ('5eed0066-0000-4000-8000-' || lpad(r.n::text, 12, '0'))::uuid, run.id, run.organization_id,
       run.repo_ref, 'workflow_outcome', 1, 'workflow_outcome', r.subject_key, r.data, r.refs,
       r.confidence,
       jsonb_build_object('method', r.method, 'sample_size', r.sample_size,
                          'effect_size', r.effect_size, 'stability', r.stability),
       run.started_at + make_interval(mins => r.minutes)
  from run, emitted r
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What it suggests — six cards and four ticket drafts, each line composed from the findings it
-- cites.
-- ---------------------------------------------------------------------------
insert into ouroboros.analysis_suggestions
  (id, organization_id, repo_ref, kind, identity_key, last_run_id, title, evidence_line,
   confidence, impact, needs_spike, action_binding, created_at)
with run as (
  select r.* from ouroboros.analysis_runs r
   where r.id = '5eed0065-0000-4000-8000-000000000002' and r.status = 'running'
),
f as (
  select right(finding.id::text, 3)::int as n, finding.data, finding.identity_key
    from run
    join ouroboros.analysis_findings finding on finding.run_id = run.id
),
factor as (
  select coalesce(max(c.factor) filter (where c.analyzer = 'cache_window'), 1) as cache_window,
         coalesce(max(c.factor) filter (where c.analyzer = 'workflow_outcome'), 1) as workflow_outcome
    from run
    left join ouroboros.analyzer_calibration c
      on c.organization_id = run.organization_id and c.repo_ref = run.repo_ref
     and c.impact_class = 'duration_delta'
),
composed (n, kind, findings, title, evidence_line, confidence, impact, needs_spike, binding) as (
  select 11, 'build_process', array[171, 172],
         'Split the test gate: native_sim every build, QEMU + HIL only before merge',
         format('qemu_cortex_m3 caught %s unique failures in %s builds; HIL caught %s%s',
                q.data ->> 'value', q.data ->> 'sample', h.data ->> 'value',
                case when h.data ->> 'at_merge_gate' = h.data ->> 'value'
                     then ' — all at merge gates' else '' end),
         91,
         jsonb_build_object('estimate', round(-206 * factor.workflow_outcome), 'unit', 'seconds',
                            'applies_to', 'per loop',
                            'basis', jsonb_build_object('method', 'extrapolated',
                              'description', 'the qemu_cortex_m3 and HIL stage time a PR build would '
                                             || 'stop paying, scaled by the workflow model''s calibration')),
         false,
         '{"plane": "test_gate", "change": {"pr_builds": ["native_sim"],
           "merge_gate": ["native_sim", "qemu_cortex_m3", "hil"]}}'::jsonb
    from f q, f h, factor where q.n = 171 and h.n = 172
  union all
  select 12, 'build_process', array[141],
         'Re-warm ccache right after deps-refresh merges',
         format('cache hit rate drops %s%%→%s%% for ~%sh after every deps-refresh merge (%s occurrences)',
                round((c.data ->> 'hit_rate_before')::numeric * 100),
                round((c.data ->> 'hit_rate_after')::numeric * 100),
                c.data ->> 'window_hours', c.data ->> 'occurrences'),
         88,
         jsonb_build_object('estimate', round(-168 * factor.cache_window), 'unit', 'seconds',
                            'applies_to', 'builds after a deps-refresh merge',
                            'share', (c.data ->> 'share')::numeric,
                            'basis', jsonb_build_object('method', 'measured',
                              'sample_size', (c.data ->> 'occurrences')::int,
                              'description', 'the slowdown inside each window, scaled by the cache '
                                             || 'model''s calibration')),
         false,
         '{"plane": "job_hook", "change": {"on": "merge", "title": "deps: refresh west manifest",
           "pool": "pool-a", "run": "west build -t ccache-warm"}}'::jsonb
    from f c, factor where c.n = 141
  union all
  select 13, 'build_process', array[151],
         'Move forge-02 to pool-a during 14:00–16:00 UTC',
         format('%s queue exceeds %s min in that window on %s of last %s weekdays; %s sits idle %s%% of it',
                q.data ->> 'pool', (q.data ->> 'threshold_seconds')::int / 60,
                q.data ->> 'days_exceeded', q.data ->> 'days_observed', q.data ->> 'idle_pool',
                round((q.data ->> 'idle_share')::numeric * 100)),
         84,
         '{"estimate": -240, "unit": "seconds", "applies_to": "queue p95",
           "basis": {"method": "extrapolated",
                     "description": "pool-a''s afternoon waits with a fourth runner taking the queue"}}'::jsonb,
         false,
         '{"plane": "farm_config", "change": {"runner": "forge-02", "pool": "pool-a",
           "days_of_week": [1, 2, 3, 4, 5], "starts_at": "14:00", "ends_at": "16:00"}}'::jsonb
    from f q where q.n = 151
  union all
  select 14, 'build_process', array[175],
         'Link zephyr.elf incrementally (partial link cache)',
         format('link step grew from %s%% to %s%% of build time since v2.3 (LTO enabled)',
                round((l.data ->> 'before')::numeric * 100), round((l.data ->> 'value')::numeric * 100)),
         72,
         '{"estimate": -55, "unit": "seconds", "applies_to": "per build",
           "basis": {"method": "extrapolated",
                     "description": "the link step''s growth since LTO, if a partial link cache won half back"}}'::jsonb,
         true,
         '{"plane": "planning", "change": {"spike": "partial link cache for zephyr.elf"}}'::jsonb
    from f l where l.n = 175
  union all
  select 15, 'workflow', array[173],
         'standard-fix: run self-review BEFORE the build stage',
         format('%s%% of failed builds in standard-fix loops contained defects the later self-review '
                || 'flagged anyway — reordering catches them pre-build',
                round((r.data ->> 'value')::numeric * 100)),
         89,
         '{"estimate": -125, "unit": "seconds", "applies_to": "per failed attempt",
           "basis": {"method": "extrapolated",
                     "description": "a failed build attempt''s wall-clock, for the share review would have caught first"}}'::jsonb,
         false,
         '{"plane": "workflow", "change": {"workflow": "standard-fix", "move": "self-review",
           "before": "build"}}'::jsonb
    from f r where r.n = 173
  union all
  select 16, 'workflow', array[174],
         'Loops touching drivers/can/: add a ''flake-retry under load profile'' test stage',
         format('merges touching drivers/can are %s× more likely to flake the telemetry suite within '
                || '7 days (%s cases)', c.data ->> 'value', c.data ->> 'sample'),
         77,
         '{"estimate": -1, "unit": "interventions", "applies_to": "per week",
           "basis": {"method": "extrapolated",
                     "description": "the telemetry flakes that reach a person each week, retried under load first"}}'::jsonb,
         false,
         '{"plane": "workflow", "change": {"workflow": "standard-fix", "when_paths": ["drivers/can/**"],
           "add_stage": "flake-retry under load profile"}}'::jsonb
    from f c where c.n = 174
  union all
  select 21, 'ticket_draft', array[111],
         'Refactor tests/ota fixtures — shared setup times out under load',
         format('%s%% of OTA suite failures share one fixture timeout signature (%s builds)',
                round((s.data ->> 'share')::numeric * 100, 1), s.data ->> 'count'),
         86, null::jsonb, false,
         '{"plane": "planning", "change": {"local_key": "BA-1"}}'::jsonb
    from f s where s.n = 111
  union all
  select 22, 'ticket_draft', array[112],
         'Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs',
         format('cache-miss signature matches ccache issue #1412 in %s builds', s.data ->> 'count'),
         90, null, false,
         '{"plane": "planning", "change": {"local_key": "BA-2"}}'::jsonb
    from f s where s.n = 112
  union all
  select 23, 'ticket_draft', array[161],
         'Add thermal chamber to rig ' || (w.data ->> 'rig'),
         format('%s verification waivers in %s days cite %s',
                w.data ->> 'waiver_count', w.data ->> 'window_days', w.data ->> 'topic'),
         82, null, false,
         '{"plane": "planning", "change": {"local_key": "BA-3"}}'::jsonb
    from f w where w.n = 161
  union all
  select 24, 'ticket_draft', array_agg(o.n order by o.n),
         format('Delete %s dead Kconfig options — never set in any build since %s',
                count(*), to_char((min(run.corpus_manifest #>> '{window,from}'))::date, 'FMMonth')),
         format('%s of %s builds toggled them; %s caused config-drift warnings',
                sum((o.data ->> 'occurrences')::int),
                to_char(max((o.data ->> 'builds_considered')::int), 'FM9,999'),
                count(*) filter (where (o.data ->> 'drift_warnings')::int > 0)),
         93, null, false,
         '{"plane": "planning", "change": {"local_key": "BA-4"}}'::jsonb
    from f o, run where o.n between 121 and 132
)
select ('5eed0067-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid, run.organization_id,
       run.repo_ref, c.kind,
       ouroboros.analysis_suggestion_identity(c.kind,
         array(select f.identity_key from f where f.n = any (c.findings))),
       run.id, c.title, c.evidence_line, c.confidence, c.impact, c.needs_spike, c.binding,
       run.started_at + interval '36 minutes'
  from run, composed c
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.analysis_suggestion_findings (suggestion_id, finding_id, organization_id, repo_ref)
select suggestion.id, finding.id, suggestion.organization_id, suggestion.repo_ref
  from (values (11, 171), (11, 172), (12, 141), (13, 151), (14, 175), (15, 173), (16, 174),
               (21, 111), (22, 112), (23, 161),
               (24, 121), (24, 122), (24, 123), (24, 124), (24, 125), (24, 126),
               (24, 127), (24, 128), (24, 129), (24, 130), (24, 131), (24, 132)
       ) as seed (suggestion_n, finding_n)
  join ouroboros.analysis_suggestions suggestion
    on suggestion.id = ('5eed0067-0000-4000-8000-' || lpad(seed.suggestion_n::text, 12, '0'))::uuid
  join ouroboros.analysis_findings finding
    on finding.id = ('5eed0066-0000-4000-8000-' || lpad(seed.finding_n::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.analysis_runs
   set status = 'complete', finished_at = started_at + interval '41 minutes', compute_seconds = 2460,
       confidence_note = 'high — 90d of stable telemetry',
       -- It ended composing, every analyzer of its set completed with the findings it wrote
       -- (#510's progress, frozen with the run).
       phase = 'composing',
       progress = jsonb_build_object('analyzers', (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a ->> 'id', 'version', (a ->> 'version')::integer, 'status', 'completed',
                  'findings', (select count(*) from ouroboros.analysis_findings finding
                                where finding.run_id = '5eed0065-0000-4000-8000-000000000002'
                                  and finding.analyzer = a ->> 'id'
                                  and finding.analyzer_version = (a ->> 'version')::integer))
                  order by ordinality), '[]'::jsonb)
           from jsonb_array_elements(analyzer_set -> 'analyzers') with ordinality as set_entry (a, ordinality)))
 where id = '5eed0065-0000-4000-8000-000000000002'
   and status = 'running'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- BA-1…BA-4 — the four ticket suggestions, drafted into one planning batch and sized by the
-- estimator.
-- ---------------------------------------------------------------------------
insert into ouroboros.draft_batches
  (id, organization_id, source_prompt, outline, planner, target_source_id, target_milestone,
   auto_size, queue_small, status, created_by, created_at)
select '5eed006a-0000-4000-8000-000000000001'::uuid, run.organization_id,
       'Build Analyzer: tickets drafted from the patterns in ' || run.repo_ref
         || '''s last ' || (run.corpus_manifest #>> '{window,days}') || ' days of builds',
       null, 'build-analyzer-v1', src.id, null, true, false, 'sized', null, run.finished_at
  from ouroboros.analysis_runs run
  join ouroboros.ticket_sources src on src.organization_id = run.organization_id
                                   and src.kind = 'github'
 where run.id = '5eed0065-0000-4000-8000-000000000002'
   and run.status = 'complete'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.ticket_drafts
  (id, batch_id, local_key, title, body, selected, suggested_workflow, push_state, provenance,
   created_at)
select ('5eed006b-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid, batch.id,
       'BA-' || seed.ordinal, suggestion.title, suggestion.evidence_line, true,
       seed.suggested_workflow, 'pending', 'planned', batch.created_at
  from (values (1, 'standard-fix'), (2, 'deps-refresh'), (3, 'feature-loop'), (4, 'standard-fix')
       ) as seed (ordinal, suggested_workflow)
  join ouroboros.draft_batches batch on batch.id = '5eed006a-0000-4000-8000-000000000001'
  join ouroboros.analysis_suggestions suggestion
    on suggestion.id = ('5eed0067-0000-4000-8000-' || lpad((20 + seed.ordinal)::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- One version each, through issue_estimates.draft_id (decision N3), heuristic-v0's honesty as the
-- planning seed applies it. The est. total is the sum of est_minutes: 660 + 120 + 1 020 + 360.
insert into ouroboros.issue_estimates
  (id, draft_id, version, effort, confidence, suggested_workflow, routed_model, breakdown,
   risk, risk_note, trace, created_at)
select ('5eed006c-0000-4000-8000-' || lpad(seed.ordinal::text, 10, '0') || '01')::uuid,
       draft.id, 1, seed.effort, seed.confidence, draft.suggested_workflow, seed.routed_model,
       jsonb_build_object('files', seed.files::jsonb, 'est_tokens', seed.est_tokens,
                          'cycle_min', seed.cycle_min, 'cycle_max', seed.cycle_max,
                          'est_minutes', seed.est_minutes),
       seed.risk, seed.risk_note,
       jsonb_build_object('estimator', 'heuristic-v0',
                          'sized_at', to_char((batch.created_at + make_interval(secs => seed.ordinal * 20))
                                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0, 'signals', '[]'::jsonb),
       batch.created_at + make_interval(secs => seed.ordinal * 20)
  from (values
         (1, 'm',  84, 'claude-sonnet-5',
          '["tests/ota/fixtures/image_server.c", "tests/ota/fixtures/conftest.py", "tests/ota/CMakeLists.txt"]',
          600000, 30, 50, 660, 'medium', 'Every OTA case shares the fixture; a slower setup moves the whole suite.'),
         (2, 'xs', 95, 'qwen3-coder:32b',
          '["west.yml", "docker/zephyr-sdk/Dockerfile"]',
          40000, 3, 6, 120, 'low', 'A version bump in the image; the cache rebuilds once.'),
         (3, 'l',  71, 'claude-fable-5',
          '["tests/hil/rig/helios-rig-02.yaml", "tests/hil/thermal/chamber.py", "docs/hil/thermal.md"]',
          500000, 50, 90, 1020, 'high', 'Needs hardware on the bench and a rig profile nothing reads yet.'),
         (4, 's',  90, 'claude-sonnet-5',
          '["drivers/serial/Kconfig.helios", "subsys/bluetooth/Kconfig.helios", "drivers/can/Kconfig.helios"]',
          200000, 10, 20, 360, 'low', 'Deleting options nothing sets; the drift warnings name the four overlays to clean.')
       ) as seed (ordinal, effort, confidence, routed_model, files, est_tokens, cycle_min, cycle_max,
                  est_minutes, risk, risk_note)
  join ouroboros.draft_batches batch on batch.id = '5eed006a-0000-4000-8000-000000000001'
  join ouroboros.ticket_drafts draft on draft.batch_id = batch.id
                                    and draft.local_key = 'BA-' || seed.ordinal
 where not exists (select 1 from ouroboros.issue_estimates prior
                    where prior.draft_id = draft.id and prior.version >= 1)
   and ${ouro_dev_seed}
on conflict do nothing;

-- The ticket suggestions are drafted — into that batch, which is what A5's linkage means.
update ouroboros.analysis_suggestions suggestion
   set status = 'drafted', draft_batch_id = batch.id, resolved_at = batch.created_at
  from ouroboros.draft_batches batch
 where batch.id = '5eed006a-0000-4000-8000-000000000001'
   and suggestion.kind = 'ticket_draft'
   and suggestion.last_run_id = '5eed0065-0000-4000-8000-000000000002'
   and suggestion.status = 'open'
   and ${ouro_dev_seed};
