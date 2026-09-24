-- R__dev_seed_test_results.sql — mockup 11's Test Results, as rows, in a development database
-- and nowhere else.
--
-- [`docs/mockups/11-test-results.html`](../../docs/mockups/11-test-results.html) is the results
-- page of run `#482`, *Fix flaky CAN-bus telemetry test* — the same run R__dev_seed_dashboard.sql
-- (#68) puts on the dashboard and R__dev_seed_run_console.sql (#302) draws mid-flight. This file
-- is that page: three build attempts, five suites, a failing HIL measurement, a flaky case already
-- `watching`, four artifacts and a coverage delta, readable from a fresh compose stack with no farm
-- job, rig or parser running.
--
-- Filed as issue #328 (AS.5), the last issue of epic AS of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md). It stands on V051 (#324), V053 (#325), V054 (#326),
-- V055 (#327) and V059, which #328 adds so coverage has a summary to compute from.
--
--     Build 1 (a3f19c2) ── 49/63 · 14 failed ✗    reordered frames 37
--     Build 2 (c81d4e7) ── 61/63 ·  2 failed      coverage 86.8%
--     Build 3 (f42b9a0) ── ● re-run of the failed set
--                          61 passed · 1 failed (HIL overshoot 2.4% vs limit 2.0%)
--                          1 flaky (telemetry, passed on retry 2/3 → watching)
--                          reordered frames 0 (was 37 in build 1) · coverage 87.4% (+0.6%)
--
-- ---------------------------------------------------------------------------
-- **Every figure the page prints is computed, and none is stored twice.**
-- ---------------------------------------------------------------------------
--
--   | Surface                                   | Reads                                          |
--   |-------------------------------------------|------------------------------------------------|
--   | Build 1 · 2 · 3 and their totals          | `test_runs`, totals recounted from `test_cases` |
--   | `▲ 12`                                    | Build 3's `passed` minus Build 1's             |
--   | suites card `24/24 … 1/2`                 | `test_suites`, recounted from `test_cases`      |
--   | `overshoot 2.4% vs limit 2.0%` · FAIL     | `hil_measurements`: the value is the worst trial, the verdict is `hil_verdict()` |
--   | `(was 37 in build 1)`                     | composed by V053's trigger from Build 1's row  |
--   | `quarantine watching`                     | `flake_score()` and `flake_state_next()` over `test_case_history` |
--   | `coverage 87.4% (+0.6%)`                  | V059's `test_run_coverage`, from line counts   |
--   | `retained 30d`                            | `retained_until - created_at`                  |
--
-- The totals are written by recount — two `update`s from V051's `test_*_counts_computed`, the
-- same thing `test_run_recount()` does — rather than typed beside the cases they count, so
-- `test_results_count_drift` is empty by construction. The measurement's value is the worst of
-- its own trials. The flake state is whatever V054's formula says about the occurrences written
-- here — tests/seed.sql recomputes it and tests/seed.test.sh refuses the word `watching` in this
-- file.
--
-- ---------------------------------------------------------------------------
-- **One `#482` universe — and the three places the pages disagree.**
-- ---------------------------------------------------------------------------
--
-- The run is #68's, found by issue number; the branch and `Loop #1847` are #302's. Nothing here
-- writes a second `#482`. Three things could not be made to agree, and each was decided on
-- #328 rather than guessed:
--
--   1. **The clocks.** #302 draws `#482` 12m 40s in, `Implementing 4/6`, its build stage still
--      pending; mockup 11 draws three builds between 13:52 and 14:38. Both cannot be true of one
--      run at one instant, and #302's page is not moved. So the three attempts are attached to
--      `#482` at offsets **inside the run** — Build 1 at 4m 41s (the mockup's own gap from the
--      loop's start), Build 2 at 5m 35s, Build 3 at 6m 28s — so that Build 3's `6m 12s` wall time
--      ends exactly at the instant #302 draws the run, and no attempt is in the future. The
--      mockup's wall-clock times are therefore not reproduced; the order, the shas and every
--      number are.
--   2. **The shas.** Mockup 11's `a3f19c2`, `c81d4e7`, `f42b9a0` are the attempts' own
--      `commit_sha` (V051 holds a sha, not a reference); #302's `a41c9e2` and `7f03b8d` stay the
--      console's commits. The two pages name different commits and none is shared.
--   3. **The farm.** Decision **B6** keeps loop attribution off dispatched jobs (AH.1, #249), and
--      the farm seed has no builds of `#482` to point at, so `build_job_id` is null on every
--      attempt. The rig is named where V053 keeps it — the HIL suite's platform,
--      `rig:helios-rig-02`, and `meta.bench`.
--
-- **`▲ 12 vs build 2`** is Build 3's 61 against Build 1's 49; the mockup's label names the wrong
-- build, and the number is the one that computes. **Build 2's `2 failed`** are the HIL overshoot
-- and the telemetry case, so the telemetry case's pass on retry 2/3 is Build 3's — the re-run of
-- the failed set — and Build 3 carries Build 2's 61 passing cases forward beside the two it
-- re-ran. **The HIL suite is `1/2`**, as the suites card says: the overshoot case and the CAN
-- frame-order case. The physical card's other two rows are not seeded.
--
-- ---------------------------------------------------------------------------
-- **The flaky case's history, and why `#479` is in it.**
-- ---------------------------------------------------------------------------
--
-- `case_key` hashes the repository (decision T2), so history accumulates across runs of
-- `helios-firmware` only. `#479` — the dashboard's other live run in that repository, and the
-- farm's live build — ran the telemetry suite before `#482` began its builds, and the case passed
-- on retry there (`["failed", "passed"]`). With `#482`'s three attempts — failed, failed, and
-- Build 3's `["failed", "failed", "passed"]` — flake score v1 over four occurrences, newest first
-- `F · · F`, is `(1 + 0.729) / (1 + 0.9 + 0.81 + 0.729) = 0.5028`: above `watch_at` (0.25) with
-- more than `min_observations` (3), so `watching`. `#479`'s attempt is `running`, which keeps it
-- out of V051's `run_check_reconciliation` — `#479` has no dashboard check counts to agree with.
-- `#482` does not either, and its latest complete attempt is Build 2: the reconciliation row for
-- `#482` reads `agrees = false`, the honest consequence of the two pages' clocks.
--
-- ---------------------------------------------------------------------------
-- **Ids, order, and the three properties every seed holds.**
-- ---------------------------------------------------------------------------
--
--   | Table                          | Ids          | Built from                                  |
--   |--------------------------------|--------------|---------------------------------------------|
--   | `test_runs` (4)                | `5eed0031…`  | issue · attempt                             |
--   | `test_suites` (16)             | `5eed0032…`  | issue · attempt · suite                     |
--   | `test_cases` (208)             | `5eed0033…`  | issue · attempt · suite · case              |
--   | `hil_measurements` (6)         | `5eed0034…`  | issue · attempt · case                      |
--   | `test_case_history` (208)      | `5eed0035…`  | the case's own number                       |
--   | `flake_scores` (1)             | `5eed0036…`  | the issue number                            |
--   | `failure_classifications` (1)  | `5eed0037…`  | the issue number                            |
--   | `test_artifacts` (5)           | `5eed0038…`  | issue · attempt · artifact                  |
--
-- `run_pr_intents` is keyed by its run and needs no id of its own.
--
-- The file sorts after `dev_seed_dashboard` (the runs) and `dev_seed` (the workspace, the
-- repository and Ken), which is all it joins to; `test_results` sorts it after
-- `dev_seed_sources` and before `dev_seed_ticket_planning`, and tests/seed.test.sh asserts the
-- whole order. Its own statements depend on each other in file order — suites on attempts, cases
-- on suites, totals on cases, measurements on earlier attempts' measurements, the score on the
-- history — which a single file gives for free.
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`.
-- 2. **It is idempotent.** Every insert ends `on conflict do nothing`, and neither `update` moves
--    a figure a second time — each rewrites totals from the recount, which is the same the second
--    time. No trigger here has a side effect a discarded row would leave behind: the derivations
--    on `test_cases`, `hil_measurements` and `test_case_history` only shape the row they fire for.
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural key — the
--    workspace by slug, a run by issue number, Ken by email — so a missing run writes nothing.
--
-- **Retention is relative to the run, not typed.** Every artifact is uploaded at an offset into
-- the run and kept `30 days` from its upload, so the card reads `retained 30d` and nothing has
-- expired whenever the seed is applied.

-- ---------------------------------------------------------------------------
-- The attempts — Build 1 · 2 · 3 of `#482`, and `#479`'s run of the telemetry suite.
--
-- Totals are written as zero and recounted below. Build 3 is `running` with its wall time split
-- — V051 allows the split on a running attempt, and the strip prints it — while Builds 1 and 2
-- carry none, because mockup 11 does not say what theirs were and a seed that invented them
-- would be the fabrication this file's header refuses. The sum `4m sim + 2m 12s physical` is
-- `test_runs_duration_split`'s to hold.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_runs (id, organization_id, run_id, attempt_seq, commit_sha, status,
                                 started_at, wall_ms, sim_ms, physical_ms)
select ('5eed0031-0000-4000-8000-' || lpad((seed.issue_number * 10 + seed.attempt)::text, 12, '0'))::uuid,
       org."id", run.id, seed.attempt, seed.commit_sha, seed.status,
       run.started_at + make_interval(secs => seed.secs_in),
       seed.sim_ms + seed.physical_ms, seed.sim_ms, seed.physical_ms
  from (values
         (479, 1, null,      'running',  1500, null::bigint, null::bigint),
         (482, 1, 'a3f19c2', 'complete',  281, null,         null),
         (482, 2, 'c81d4e7', 'complete',  335, null,         null),
         (482, 3, 'f42b9a0', 'running',   388, 240000,       132000)
       ) as seed (issue_number, attempt, commit_sha, status, secs_in, sim_ms, physical_ms)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs run         on run.organization_id = org."id"
                                 and run.issue_number = seed.issue_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The suites — mockup 11's five, on the platforms it prints, in every attempt of `#482`.
--
-- `#479`'s attempt ran the telemetry suite alone, which is all its occurrence of the flaky case
-- needs. The physical suite came from `ouro-hil-results.json` (`results_format = 'hil'`), so its
-- cases carry measurements, and its bench is `meta.bench` — V053's place for it.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_suites (id, organization_id, test_run_id, name, platform, kind,
                                   results_format, meta)
select ('5eed0032-0000-4000-8000-' || lpad((attempt.issue_number * 100 + attempt.attempt * 10
                                            + suite.ordinal)::text, 12, '0'))::uuid,
       test_run.organization_id, test_run.id, suite.name, suite.platform, suite.kind,
       suite.results_format, suite.meta::jsonb
  from (values
         (1, 'unit · drivers',        'native_sim',        'sim',      'junit', '{}'),
         (2, 'telemetry integration', 'qemu_cortex_m3',    'sim',      'junit', '{}'),
         (3, 'motor control',         'qemu_cortex_m3',    'sim',      'junit', '{}'),
         (4, 'OTA update',            'native_sim',        'sim',      'junit', '{}'),
         (5, 'PHYSICAL · HIL rig',    'rig:helios-rig-02', 'physical', 'hil',
          '{"bench": "CAN bus + motor + power-cycler"}')
       ) as suite (ordinal, name, platform, kind, results_format, meta)
  cross join (values (479, 1), (482, 1), (482, 2), (482, 3)) as attempt (issue_number, attempt)
  join ouroboros.test_runs test_run
    on test_run.id = ('5eed0031-0000-4000-8000-'
                      || lpad((attempt.issue_number * 10 + attempt.attempt)::text, 12, '0'))::uuid
 where (attempt.issue_number = 482 or suite.ordinal = 2)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The cases — sixty-three per attempt of `#482`, nineteen in `#479`'s.
--
-- One catalogue, written once, and the attempts that did not pass it listed beside it: a case
-- not listed passed first time. `case_key` is left to `test_cases_derive_case_key` (decision T2)
-- — the file never computes one, so it cannot disagree with the recipe, and the same case is the
-- same key in every attempt and in `#479` because the repository, suite, classname and name are.
--
-- Build 1's fourteen failures are the CAN-telemetry bug the loop is fixing: nine telemetry cases
-- (the flaky one among them), the driver's overrun flag, two motor cases that ride the same
-- queue, and both rig tests. Build 2's two are the overshoot and the telemetry case. Build 3
-- re-ran those two: the overshoot failed again and the telemetry case passed on retry 2 of 3.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_cases (id, organization_id, test_suite_id, name, classname, status,
                                  retries, retry_outcomes, duration_ms, failure)
select ('5eed0033-0000-4000-8000-' || lpad((attempt.issue_number * 100000 + attempt.attempt * 10000
                                            + catalogue.suite * 100 + catalogue.n)::text, 12, '0'))::uuid,
       test_suite.organization_id, test_suite.id, catalogue.name, catalogue.classname,
       coalesce(outcome.status, 'passed'), coalesce(outcome.retries, 0),
       coalesce(outcome.outcomes, '["passed"]')::jsonb,
       coalesce(catalogue.duration_ms, 40 + (catalogue.suite * 131 + catalogue.n * 53) % 900),
       outcome.failure::jsonb
  from (values
         -- unit · drivers — twenty-four
         (1,  1, 'drivers.gpio',  'set_get_roundtrip',            null::bigint),
         (1,  2, 'drivers.gpio',  'interrupt_edge_rising',        null),
         (1,  3, 'drivers.gpio',  'interrupt_edge_falling',       null),
         (1,  4, 'drivers.gpio',  'debounce_window',              null),
         (1,  5, 'drivers.spi',   'transfer_full_duplex',         null),
         (1,  6, 'drivers.spi',   'cs_hold_between_frames',       null),
         (1,  7, 'drivers.spi',   'dma_threshold',                null),
         (1,  8, 'drivers.i2c',   'bus_recovery_nine_clocks',     null),
         (1,  9, 'drivers.i2c',   'clock_stretch_timeout',        null),
         (1, 10, 'drivers.i2c',   'repeated_start',               null),
         (1, 11, 'drivers.uart',  'baud_115200_loopback',         null),
         (1, 12, 'drivers.uart',  'rx_ring_wraparound',           null),
         (1, 13, 'drivers.uart',  'break_detect',                 null),
         (1, 14, 'drivers.can',   'frame_encode_standard_id',     null),
         (1, 15, 'drivers.can',   'frame_encode_extended_id',     null),
         (1, 16, 'drivers.can',   'rx_fifo_overrun_flag',         null),
         (1, 17, 'drivers.can',   'bus_off_recovery',             null),
         (1, 18, 'drivers.can',   'filter_mask_match',            null),
         (1, 19, 'drivers.adc',   'oversample_average',           null),
         (1, 20, 'drivers.adc',   'dma_scan_order',               null),
         (1, 21, 'drivers.pwm',   'duty_cycle_resolution',        null),
         (1, 22, 'drivers.pwm',   'dead_time_insertion',          null),
         (1, 23, 'drivers.flash', 'page_erase_alignment',         null),
         (1, 24, 'drivers.flash', 'write_verify',                 null),
         -- telemetry integration — nineteen, the flaky case third
         (2,  1, 'telemetry', 'frame counter is monotonic',       null),
         (2,  2, 'telemetry', 'frames keep order under ISR load', null),
         (2,  3, 'telemetry', 'ring buffer drains under burst',   null),
         (2,  4, 'telemetry', 'batch flush on shutdown',          null),
         (2,  5, 'telemetry', 'timestamp is monotonic across wrap', null),
         (2,  6, 'telemetry', 'dropped frame counter increments', null),
         (2,  7, 'telemetry', 'backpressure pauses producer',     null),
         (2,  8, 'telemetry', 'crc mismatch drops frame',         null),
         (2,  9, 'telemetry', 'ring buffer survives overflow',    null),
         (2, 10, 'telemetry', 'mqtt publish after reconnect',     null),
         (2, 11, 'telemetry', 'qos1 redelivery is deduplicated',  null),
         (2, 12, 'telemetry', 'schema version in every frame',    null),
         (2, 13, 'telemetry', 'compression ratio above floor',    null),
         (2, 14, 'telemetry', 'telemetry thread yields to ISR',   null),
         (2, 15, 'telemetry', 'k_msgq depth never exceeds limit', null),
         (2, 16, 'telemetry', 'empty batch is not published',     null),
         (2, 17, 'telemetry', 'large frame is split',             null),
         (2, 18, 'telemetry', 'clock sync after brownout',        null),
         (2, 19, 'telemetry', 'heartbeat every 5 s',              null),
         -- motor control — twelve
         (3,  1, 'motor', 'pid step response settles',            null),
         (3,  2, 'motor', 'integral clamps on saturation',        null),
         (3,  3, 'motor', 'derivative filter rejects noise',      null),
         (3,  4, 'motor', 'velocity estimate at low rpm',         null),
         (3,  5, 'motor', 'e-stop latches outputs low',           null),
         (3,  6, 'motor', 'e-stop release ramps setpoint',        null),
         (3,  7, 'motor', 'current limit trips at 8 A',           null),
         (3,  8, 'motor', 'encoder wraparound',                   null),
         (3,  9, 'motor', 'direction change deadband',            null),
         (3, 10, 'motor', 'watchdog stops motor',                 null),
         (3, 11, 'motor', 'feedforward torque table',             null),
         (3, 12, 'motor', 'soft start profile',                   null),
         -- OTA update — six
         (4,  1, 'ota', 'image header validates',                 null),
         (4,  2, 'ota', 'slot swap is atomic',                    null),
         (4,  3, 'ota', 'rollback on bad checksum',               null),
         (4,  4, 'ota', 'resume after power loss',                null),
         (4,  5, 'ota', 'anti-rollback counter',                  null),
         (4,  6, 'ota', 'signature verification',                 null),
         -- PHYSICAL · HIL rig — two
         (5,  1, 'tests/hil/test_estop_release.py',  'overshoot_under_load',   44000),
         (5,  2, 'tests/hil/test_can_frame_order.py', 'frame_order_under_load', 62000)
       ) as catalogue (suite, n, classname, name, duration_ms)
  cross join (values (479, 1), (482, 1), (482, 2), (482, 3)) as attempt (issue_number, attempt)
  join ouroboros.test_suites test_suite
    on test_suite.id = ('5eed0032-0000-4000-8000-'
                        || lpad((attempt.issue_number * 100 + attempt.attempt * 10
                                 + catalogue.suite)::text, 12, '0'))::uuid
  left join (values
         (479, 1, 2,  3, 'flaky',  1, '["failed", "passed"]',
          '{"message": "ring buffer not drained within 50 ms (attempt 1)"}'),
         (482, 1, 1, 16, 'failed', 0, '["failed"]',
          '{"message": "expected the overrun flag after 65 frames, saw none", "path": "tests/drivers/can/test_rx.c"}'),
         (482, 1, 2,  1, 'failed', 0, '["failed"]',
          '{"message": "frame counter went backwards: 4101 after 4102"}'),
         (482, 1, 2,  2, 'failed', 0, '["failed"]',
          '{"message": "37 frames out of order under ISR load"}'),
         (482, 1, 2,  3, 'failed', 2, '["failed", "failed", "failed"]',
          '{"message": "ring buffer not drained within 50 ms (3 of 3 attempts)"}'),
         (482, 1, 2,  5, 'failed', 0, '["failed"]',
          '{"message": "timestamp decreased across the 32-bit wrap"}'),
         (482, 1, 2,  6, 'failed', 0, '["failed"]',
          '{"message": "dropped-frame counter stayed at 0 after a forced drop"}'),
         (482, 1, 2,  7, 'failed', 0, '["failed"]',
          '{"message": "producer kept writing past the high-water mark"}'),
         (482, 1, 2,  9, 'failed', 0, '["failed"]',
          '{"message": "k_fifo corrupted after overflow"}'),
         (482, 1, 2, 14, 'failed', 0, '["failed"]',
          '{"message": "telemetry thread held the CPU for 3.1 ms"}'),
         (482, 1, 2, 15, 'failed', 0, '["failed"]',
          '{"message": "queue depth reached 70, limit 64"}'),
         (482, 1, 3,  4, 'failed', 0, '["failed"]',
          '{"message": "velocity estimate lagged by one control tick"}'),
         (482, 1, 3,  6, 'failed', 0, '["failed"]',
          '{"message": "setpoint ramp started 0.4 ms late"}'),
         (482, 1, 5,  1, 'failed', 0, '["failed"]',
          '{"message": "AssertionError: max overshoot 2.4% > limit 2.0%", "path": "tests/hil/test_estop_release.py"}'),
         (482, 1, 5,  2, 'failed', 0, '["failed"]',
          '{"message": "AssertionError: 37 reordered frames > limit 0", "path": "tests/hil/test_can_frame_order.py"}'),
         (482, 2, 2,  3, 'failed', 2, '["failed", "failed", "failed"]',
          '{"message": "ring buffer not drained within 50 ms (3 of 3 attempts)"}'),
         (482, 2, 5,  1, 'failed', 0, '["failed"]',
          '{"message": "AssertionError: max overshoot 2.4% > limit 2.0%", "path": "tests/hil/test_estop_release.py"}'),
         (482, 3, 2,  3, 'flaky',  2, '["failed", "failed", "passed"]',
          '{"message": "ring buffer not drained within 50 ms (attempts 1 and 2)"}'),
         (482, 3, 5,  1, 'failed', 0, '["failed"]',
          '{"message": "AssertionError: max overshoot 2.4% > limit 2.0%", "path": "tests/hil/test_estop_release.py", "log_excerpt": "[rig] e-stop released @ 2.00 Nm · setpoint 1200 rpm\n[rig] trial 1: peak 1225.2 rpm → overshoot 2.1%\n[rig] trial 2: peak 1228.8 rpm → overshoot 2.4%\n[rig] trial 3: peak 1227.6 rpm → overshoot 2.3%\n[rig] settle time 84ms · velocity sample lag +0.4ms\nE AssertionError: max overshoot 2.4% > limit 2.0%"}')
       ) as outcome (issue_number, attempt, suite, n, status, retries, outcomes, failure)
    on outcome.issue_number = attempt.issue_number
   and outcome.attempt = attempt.attempt
   and outcome.suite = catalogue.suite
   and outcome.n = catalogue.n
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The totals — recounted from the cases, suites first, the way `test_run_recount()` does.
--
-- Two `update`s from V051's single definition of counting, rather than a call to the function,
-- because every statement in a seed is an insert or an update behind the guard (tests/seed.test.sh
-- counts them). Each is idempotent: a second pass writes the same figures, and `is distinct from`
-- keeps it from writing at all.
-- ---------------------------------------------------------------------------
update ouroboros.test_suites suite
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_suite_counts_computed computed
 where computed.test_suite_id = suite.id
   and suite.id::text like '5eed0032-%'
   and (suite.total, suite.passed, suite.failed, suite.flaky, suite.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

update ouroboros.test_runs test_run
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_run_counts_computed computed
 where computed.test_run_id = test_run.id
   and test_run.id::text like '5eed0031-%'
   and (test_run.total, test_run.passed, test_run.failed, test_run.flaky, test_run.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The rig's measurements — the overshoot and the frame order, in every build.
--
-- **The value is the worst trial and the verdict is computed.** `value` is the maximum of the
-- trials' own figure, and `verdict` is `hil_verdict(value, limit, kind)` — so `2.4% vs limit
-- 2.0% → fail` and `0 vs limit 0 → pass` follow from the trials rather than from a word typed
-- beside them. `context` is never written: V053's trigger composes `was 37 in build 1` on Builds
-- 2 and 3 from Build 1's row and leaves the overshoot's null, because its value never changed.
-- That composition reads earlier attempts, so the rows are inserted **in attempt order**.
-- ---------------------------------------------------------------------------
insert into ouroboros.hil_measurements (id, organization_id, test_case_id, procedure, trials,
                                        metric, value, unit, limit_value, limit_kind, verdict)
select ('5eed0034-0000-4000-8000-' || lpad((482000 + m.attempt * 10 + m.n)::text, 12, '0'))::uuid,
       test_case.organization_id, test_case.id, m.procedure, m.trials::jsonb, m.metric,
       worst.value, m.unit, m.limit_value, m.limit_kind,
       ouroboros.hil_verdict(worst.value, m.limit_value, m.limit_kind)
  from (values
         (1, 1, 'dyno bench releases e-stop under 2 Nm load, 3 trials', 'overshoot_pct', '%', 2.0, 'max',
          '[{"trial": 1, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1225.2, "overshoot_pct": 2.1},
            {"trial": 2, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1228.8, "overshoot_pct": 2.4},
            {"trial": 3, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1227.6, "overshoot_pct": 2.3}]'),
         (1, 2, 'traffic generator floods bus at 900 kbit/s for 60s', 'reordered_frames', 'count', 0, 'max',
          '[{"trial": 1, "bitrate_kbit": 900, "load_pct": 90, "duration_s": 60, "frames": 1000000, "reordered_frames": 37}]'),
         (2, 1, 'dyno bench releases e-stop under 2 Nm load, 3 trials', 'overshoot_pct', '%', 2.0, 'max',
          '[{"trial": 1, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1225.2, "overshoot_pct": 2.1},
            {"trial": 2, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1228.8, "overshoot_pct": 2.4},
            {"trial": 3, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1227.6, "overshoot_pct": 2.3}]'),
         (2, 2, 'traffic generator floods bus at 900 kbit/s for 60s', 'reordered_frames', 'count', 0, 'max',
          '[{"trial": 1, "bitrate_kbit": 900, "load_pct": 90, "duration_s": 60, "frames": 1000000, "reordered_frames": 0}]'),
         (3, 1, 'dyno bench releases e-stop under 2 Nm load, 3 trials', 'overshoot_pct', '%', 2.0, 'max',
          '[{"trial": 1, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1225.2, "overshoot_pct": 2.1},
            {"trial": 2, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1228.8, "overshoot_pct": 2.4},
            {"trial": 3, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1227.6, "overshoot_pct": 2.3}]'),
         (3, 2, 'traffic generator floods bus at 900 kbit/s for 60s', 'reordered_frames', 'count', 0, 'max',
          '[{"trial": 1, "bitrate_kbit": 900, "load_pct": 90, "duration_s": 60, "frames": 1000000, "reordered_frames": 0}]')
       ) as m (attempt, n, procedure, metric, unit, limit_value, limit_kind, trials)
  cross join lateral (
         select max((trial ->> m.metric)::numeric) as value
           from jsonb_array_elements(m.trials::jsonb) as trial
       ) as worst
  join ouroboros.test_cases test_case
    on test_case.id = ('5eed0033-0000-4000-8000-'
                       || lpad((48200000 + m.attempt * 10000 + 500 + m.n)::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
 order by m.attempt, m.n
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The occurrences — one per case per attempt, V054's parse-time hook written the way AT.3 will.
--
-- The case and nothing else: `test_case_history_derive` fills the key, the attempt, the
-- repository, the outcome and `observed_at` (the attempt's `started_at`) from the case, so an
-- occurrence cannot claim anything its case does not have.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_case_history (id, organization_id, test_case_id)
select ('5eed0035' || substr(test_case.id::text, 9))::uuid, test_case.organization_id, test_case.id
  from ouroboros.test_cases test_case
 where test_case.id::text like '5eed0033-%'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The flaky case's score — AS.3's formula over the occurrences above, and its state from it.
--
-- `flake_score()` and `flake_state_next()` are the scorer's own functions (AT.3 calls them), so
-- this row is what a scorer pass would write: the score, the window it covers, formula 1, and the
-- state the thresholds give from a new case's `healthy`. See this file's header for the number.
-- ---------------------------------------------------------------------------
insert into ouroboros.flake_scores (id, organization_id, github_repo_id, case_key, score,
                                    window_runs, formula_version, state)
select '5eed0036-0000-4000-8000-000000000482'::uuid,
       test_case.organization_id, run.github_repo_id, test_case.case_key,
       scored.score, scored.window_runs, formula.version,
       ouroboros.flake_state_next(formula.version, null, scored.score, scored.window_runs)
  from ouroboros.test_cases test_case
  join ouroboros.test_suites test_suite on test_suite.id = test_case.test_suite_id
  join ouroboros.test_runs test_run     on test_run.id = test_suite.test_run_id
  join ouroboros.runs run               on run.id = test_run.run_id
  join ouroboros.flake_score_formulas formula on formula.version = 1
  cross join lateral ouroboros.flake_score(test_case.organization_id, test_case.case_key,
                                           formula.version) as scored
 where test_case.id = '5eed0033-0000-4000-8000-000048230203'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The heuristic hint — the classification precursor on Build 3's overshoot.
--
-- Mark & Route's first word before anybody has judged the failure: a deterministic rule saw a
-- rig measurement past its limit and suggested a product bug. `actor = 'heuristic'`, so it names
-- its rule and carries **no percentage** (option 5-A — a rule with an invented confidence is worse
-- than no number); the card's `AI pick · 84%` is a model's later decision and is not seeded. No
-- note and no receipt: nothing has been routed yet.
-- ---------------------------------------------------------------------------
insert into ouroboros.failure_classifications (id, organization_id, test_case_id, class, actor,
                                               rule_id, created_at)
select '5eed0037-0000-4000-8000-000000000482'::uuid,
       test_case.organization_id, test_case.id, 'product_bug', 'heuristic',
       'hil.limit_exceeded', test_run.started_at + make_interval(secs => 360)
  from ouroboros.test_cases test_case
  join ouroboros.test_suites test_suite on test_suite.id = test_case.test_suite_id
  join ouroboros.test_runs test_run     on test_run.id = test_suite.test_run_id
 where test_case.id = '5eed0033-0000-4000-8000-000048230501'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The PR toggles — *Block PR #514 until green* and *Auto re-run physical suite after fix*, both on.
--
-- Stored intents (decision T8), inert until the PR plane consumes them; Ken set them.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_pr_intents (run_id, organization_id, block_until_green,
                                     auto_rerun_physical, updated_by)
select run.id, org."id", true, true, ken."id"
  from ouroboros.organization org
  join ouroboros.runs run    on run.organization_id = org."id" and run.issue_number = 482
  left join ouroboros."user" ken on ken.email = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The artifacts — Build 3's four, and Build 2's coverage report the delta is taken against.
--
-- Real sizes (`rig-capture-estop.csv` is 2.1 MB), a checksum of the file's name standing in for
-- its bytes, and the local driver. Each is uploaded at an offset into its attempt and kept 30 days
-- from then, so `retained 30d` holds and nothing has expired whenever the seed is applied. The
-- coverage reports carry V059's counts: 4 444 of 5 120 lines on Build 2 and 4 475 on Build 3,
-- which `test_run_coverage` turns into `86.8%` and `87.4% (+0.6%)`.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_artifacts (id, organization_id, test_run_id, name, kind, size_bytes,
                                      storage_ref, checksum, retained_until, created_at,
                                      lines_covered, lines_total)
select ('5eed0038-0000-4000-8000-' || lpad((4820 + a.attempt)::text || a.ordinal::text, 12, '0'))::uuid,
       test_run.organization_id, test_run.id, a.name, a.kind, a.size_bytes,
       jsonb_build_object('driver', 'local',
                          'key', test_run.organization_id || '/482/' || a.attempt || '/' || a.name),
       'sha256:' || encode(sha256(convert_to(test_run.organization_id || '/482/' || a.attempt
                                             || '/' || a.name, 'UTF8')), 'hex'),
       test_run.started_at + make_interval(secs => a.secs_in) + interval '30 days',
       test_run.started_at + make_interval(secs => a.secs_in),
       a.lines_covered, a.lines_total
  from (values
         (2, 1, 'coverage.info',         'coverage',   90112,   40, 4444, 5120),
         (3, 1, 'junit-build3.xml',      'junit',      48213,  300, null, null),
         (3, 2, 'rig-capture-estop.csv', 'capture',  2202010,  330, null, null),
         (3, 3, 'serial-console.log',    'log',       184320,  340, null, null),
         (3, 4, 'coverage.info',         'coverage',   91822,  350, 4475, 5120)
       ) as a (attempt, ordinal, name, kind, size_bytes, secs_in, lines_covered, lines_total)
  join ouroboros.test_runs test_run
    on test_run.id = ('5eed0031-0000-4000-8000-' || lpad((4820 + a.attempt)::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;
