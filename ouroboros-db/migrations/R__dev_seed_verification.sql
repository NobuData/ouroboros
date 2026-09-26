-- R__dev_seed_verification.sql — mockup 12's PR Verification, as rows, in a development database
-- and nowhere else.
--
-- [`docs/mockups/12-pr-verification.html`](../../docs/mockups/12-pr-verification.html) is PR
-- `#514`, *can: fix flaky telemetry frame order under ISR load* — the **outcome** of run `#482`,
-- the run R__dev_seed_dashboard.sql (#68) puts on the dashboard, R__dev_seed_run_console.sql (#302)
-- draws mid-flight and R__dev_seed_test_results.sql (#328) gives three builds. This file is that
-- page: two revisions, seven gates with a verdict snapshot per revision, five criteria, three
-- thread entries, a merge plan and the spend under the cap, readable from a fresh compose stack
-- with no provider sync, gate engine or merge executor running.
--
-- Filed as issue #356 (AW.5), the last issue of epic AW of the PR Verification roadmap
-- (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md). It stands on V052 (#352), V056 (#353), V057 (#354)
-- and V058 (#355), and on the AS tables V051, V053, V054 and V055 for the evidence it cites.
--
--     Revision 1 (3f9c2ae) ── blocked: HIL overshoot 2.4% > 2.0% · 2 gates red
--            │
--     Correction round · attempt 4 ── Build 4 re-runs the suite at b7e41d0
--            │
--     Revision 2 (b7e41d0) ── live · 5 of 7 green · model_review unavailable · human not_required
--            ┆
--     Auto-merge (squash) ── planned, unarmed
--
-- ---------------------------------------------------------------------------
-- **Every figure the page prints is computed, and none is stored twice.**
-- ---------------------------------------------------------------------------
--
--   | Surface                                   | Reads                                            |
--   |-------------------------------------------|--------------------------------------------------|
--   | `5 / 7 green`, `2 gates red`, merge-ready | `pr_gate_aggregate(revision)` over the latest verdicts |
--   | `+68 −15 · 3 files`, the files card       | rev 2's `files`, built from #302's `run_files`; the PR's counts are updated from it |
--   | each gate's mono line                     | composed below from the row its `evidence_ref` names |
--   | `63/63 after attempt 4`                   | Build 4's recounted totals and its `attempt_seq`  |
--   | `overshoot 1.7% ≤ 2.0%` / `2.4% > 2.0%`   | the worst trial, and `hil_verdict()` choosing the sign |
--   | `3 entries · 0 open`                      | `pr_thread_summary(pr)`                           |
--   | `Closes #482.`                            | `pr_merge_commit_message_template()` — the message is written null |
--   | `284k · $1.52`, `41k · $0.19`, `$2.50 cap`| `sum(token_usage)` for the run, the `verify` share of it, and the route's cap |
--
-- tests/seed.test.sh refuses those figures as literals in this file, and tests/seed.sql
-- recomputes each of them.
--
-- ---------------------------------------------------------------------------
-- **One `#482` universe — and what had to give.**
-- ---------------------------------------------------------------------------
--
-- The run is #68's, found by issue number; its branch is #302's; Build 1 · 2 · 3, the rig and the
-- 2.4% overshoot are #328's; the canonical ticket `#482` is #275's. Nothing here writes a second
-- `#482`. The PR is the *later* chapter of a run the other two pages draw *earlier*, and six things
-- could not be made to agree; each was decided on #356 rather than guessed:
--
--   1. **Build 4.** Revision 2's `63/63 after attempt 4` and its 1.7% overshoot are a fourth test
--      attempt on `#482`, sha `b7e41d0`. #328 ends Build 3 at the instant #302 draws the run, so
--      Build 4 is placed *inside* the run, overlapping Build 3's window, and becomes the Test
--      Results page's latest attempt. Mockup 11's Build 3 stays readable as attempt 3.
--   2. **Attempt 4 is a test attempt, not a stage attempt.** `run_stages` has `implement` attempts
--      1 and 2 (of 3), and neither PR sha is a `run_commits` row, so `pr_revisions.run_stage_id`
--      stays null — V052's sha match refuses anything else — and mockup 10's commits card is
--      untouched. The strip's *attempt 4* is Build 4's `attempt_seq`.
--   3. **Spend.** The loop total is `sum(token_usage)` for `#482`: #302's 212k / $1.14 plus the two
--      rows here, 41k / 19¢ tagged `task_kind = 'verify'` (the Verification line) and 31k / 19¢
--      untagged (the correction round). R__dev_seed_dashboard.sql's unattributed `claude-fable-5`
--      row gives up the same 72k / 38¢, so mockup 02's day total does not move. The console's
--      meter reads 284k / $1.52 as a consequence. `verify` is a kind no route has: mockup 06's
--      matrix reads stats only for the workspace's own task kinds, and a `review` tag would have
--      moved its exact `$0.22` average.
--   4. **The waiver.** #328 did not seed an AS.4 waiver, so this file writes it: Ken's thermal
--      waiver on `#482`, criterion-level (no case keys), the row the waived criterion points at.
--   5. **The Build gate's farm job.** The farm had no build of either PR sha, so this file adds
--      two finished `forge-01` builds (`#484` at `3f9c2ae`, `#485` at `b7e41d0`), each with the
--      memory map the gate line reads its `FLASH` figure from. mockup 08's *builds today* counts
--      them.
--   6. **Revision 1's policy gates.** `model_review` has no provider until AZ.1 and
--      `human_approval` is the policy's, so revision 1 reads what revision 2 does for those two —
--      `unavailable` and `not_required` — beside three greens and the two reds.
--
-- The mockup's wall-clock times (14:10, 14:31) are not reproduced; the order, the shas and every
-- number are. Every instant is an offset into the run, for #302's reason, and all of them fall
-- before 760 seconds, the instant #302 draws.
--
--     380 rev 1 pushed · #484 builds 385–509 · 540 waiver · 560 rev 1 gates · 570 second opinion
--     590 self-review · 600 rev 2 pushed · #485 builds 604–684 · Build 4 from 685
--     700 correction spend · 740 opinion resolved · 750 rev 2 gates, verification spend · 752 policy
--
-- ---------------------------------------------------------------------------
-- **Decision R4 — the watermark.**
-- ---------------------------------------------------------------------------
--
-- Both model-authored thread entries — `claude-fable-5`'s self-review and `cursor/composer-2`'s
-- second opinion — are written `simulated = true`, which V057's
-- `pr_thread_entries_model_simulated` requires until AZ.1 (#371) produces real ones. The policy
-- bot's entry is the policy's own text and carries no watermark.
--
-- ---------------------------------------------------------------------------
-- **Ids, order, and the three properties every seed holds.**
-- ---------------------------------------------------------------------------
--
--   | Table                        | Ids                    | Built from                        |
--   |------------------------------|------------------------|-----------------------------------|
--   | Build 4's attempt, suites, cases, measurements, occurrences | #328's `5eed0031…`–`5eed0035…` | #328's recipes, attempt 4 |
--   | `build_jobs` (2), `build_log_chunks` (2) | the farm's `5eed0028…`, `5eed0029…` | the job number   |
--   | `token_usage` (2)            | #302's `5eed002e…`     | the issue number, ordinals 5 and 6 |
--   | `pr_waivers` (1)             | `5eed0039…`            | the issue number                  |
--   | `pull_requests` (1)          | `5eed003a…`            | the PR number                     |
--   | `pr_revisions` (2)           | `5eed003b…`            | PR · revision                     |
--   | `pr_gate_definitions` (7)    | `5eed003c…`            | PR · gate ordinal                 |
--   | `pr_gate_results` (14)       | `5eed003d…`            | PR · revision · gate ordinal      |
--   | `pr_criteria` (5)            | `5eed003e…`            | PR · criterion ordinal            |
--   | `pr_criteria_evidence` (6)   | `5eed003f…`            | PR · criterion · evidence ordinal |
--   | `pr_thread_entries` (3)      | `5eed0040…`            | PR · entry ordinal                |
--   | `pr_merge_plans` (1)         | `5eed0041…`            | the PR number                     |
--
-- Build 4 reuses #328's prefixes and recipes because it is more of #328's rows — a fourth attempt
-- of the same run — and the farm rows reuse the farm seed's for the same reason.
--
-- The file sorts after `dev_seed_ticket_planning` (the canonical ticket `#482` and the GitHub
-- source) and `dev_seed_test_results` (Builds 1–3, which Build 4 copies and revision 1 cites), and
-- through them after every seed they stand on; `verification` puts it before `dev_seed_workflows`,
-- which it does not need. tests/seed.test.sh asserts the whole order.
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`.
-- 2. **It is idempotent.** Every insert ends `on conflict do nothing`, and every update is guarded
--    by `is distinct from` or a state it moves away from, so a second pass writes nothing. The log
--    chunks carry the farm seed's `not exists` guard, because their trigger moves the job's byte
--    count before a conflict is detected.
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural key — the
--    workspace by slug, the run by issue number, Ken by email, a runner, a pool and a repository by
--    name — or by the deterministic id an earlier seed computed, so a missing parent writes
--    nothing.

-- ---------------------------------------------------------------------------
-- Build 4 — the correction round's re-run of the whole suite at b7e41d0.
--
-- Complete, with no duration split: mockup 12 does not say what its wall time was, and Builds 1
-- and 2 carry none either. Totals are written as zero and recounted below.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_runs (id, organization_id, run_id, attempt_seq, commit_sha, status,
                                 started_at)
select '5eed0031-0000-4000-8000-000000004824'::uuid,
       org."id", run.id, 4, 'b7e41d0', 'complete',
       run.started_at + make_interval(secs => 685)
  from ouroboros.organization org
  join ouroboros.runs run on run.organization_id = org."id" and run.issue_number = 482
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The five suites, copied from Build 2's — the same names, platforms, kinds, formats and bench —
-- under #328's recipe: issue · attempt · suite ordinal, so Build 2's `…48221` is Build 4's `…48241`.
insert into ouroboros.test_suites (id, organization_id, test_run_id, name, platform, kind,
                                   results_format, meta)
select ('5eed0032-0000-4000-8000-'
        || lpad((right(suite.id::text, 12)::bigint + 20)::text, 12, '0'))::uuid,
       suite.organization_id, build4.id, suite.name, suite.platform, suite.kind,
       suite.results_format, suite.meta
  from ouroboros.test_suites suite
  join ouroboros.test_runs build4 on build4.id = '5eed0031-0000-4000-8000-000000004824'
 where suite.test_run_id = '5eed0031-0000-4000-8000-000000004822'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The sixty-three cases, every one passing first time — Build 2's catalogue under #328's recipe
-- (Build 2's `…482205xx` is Build 4's `…482405xx`). `case_key` is left to its trigger, so each
-- case is the same identity it was in Builds 1–3.
insert into ouroboros.test_cases (id, organization_id, test_suite_id, name, classname, status,
                                  retries, retry_outcomes, duration_ms)
select ('5eed0033-0000-4000-8000-'
        || lpad((right(test_case.id::text, 12)::bigint + 20000)::text, 12, '0'))::uuid,
       test_case.organization_id,
       ('5eed0032-0000-4000-8000-'
        || lpad((right(test_case.test_suite_id::text, 12)::bigint + 20)::text, 12, '0'))::uuid,
       test_case.name, test_case.classname, 'passed', 0, '["passed"]'::jsonb,
       test_case.duration_ms
  from ouroboros.test_cases test_case
  join ouroboros.test_suites suite on suite.id = test_case.test_suite_id
  join ouroboros.test_suites build4_suite
    on build4_suite.id = ('5eed0032-0000-4000-8000-'
                          || lpad((right(suite.id::text, 12)::bigint + 20)::text, 12, '0'))::uuid
 where suite.test_run_id = '5eed0031-0000-4000-8000-000000004822'
   and ${ouro_dev_seed}
on conflict do nothing;

-- Build 4's totals, recounted from its cases — #328's two updates, narrowed to Build 4's rows.
update ouroboros.test_suites suite
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_suite_counts_computed computed
 where computed.test_suite_id = suite.id
   and suite.test_run_id = '5eed0031-0000-4000-8000-000000004824'
   and (suite.total, suite.passed, suite.failed, suite.flaky, suite.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

update ouroboros.test_runs test_run
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_run_counts_computed computed
 where computed.test_run_id = test_run.id
   and test_run.id = '5eed0031-0000-4000-8000-000000004824'
   and (test_run.total, test_run.passed, test_run.failed, test_run.flaky, test_run.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Build 4's rig measurements — the overshoot came down, and the frame order held.
--
-- #328's statement for a fourth attempt: the value is the worst trial and the verdict is
-- `hil_verdict()`'s, so `1.7 vs limit 2.0 → pass` follows from the trials. V053's trigger composes
-- each comparative from the earlier attempts #328 wrote. In measurement order.
-- ---------------------------------------------------------------------------
insert into ouroboros.hil_measurements (id, organization_id, test_case_id, procedure, trials,
                                        metric, value, unit, limit_value, limit_kind, verdict)
select ('5eed0034-0000-4000-8000-' || lpad((482000 + 4 * 10 + m.n)::text, 12, '0'))::uuid,
       test_case.organization_id, test_case.id, m.procedure, m.trials::jsonb, m.metric,
       worst.value, m.unit, m.limit_value, m.limit_kind,
       ouroboros.hil_verdict(worst.value, m.limit_value, m.limit_kind)
  from (values
         (1, 'dyno bench releases e-stop under 2 Nm load, 3 trials', 'overshoot_pct', '%', 2.0, 'max',
          '[{"trial": 1, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1219.2, "overshoot_pct": 1.6},
            {"trial": 2, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1220.4, "overshoot_pct": 1.7},
            {"trial": 3, "torque_nm": 2.0, "setpoint_rpm": 1200, "peak_rpm": 1218.0, "overshoot_pct": 1.5}]'),
         (2, 'traffic generator floods bus at 900 kbit/s for 60s', 'reordered_frames', 'count', 0, 'max',
          '[{"trial": 1, "bitrate_kbit": 900, "load_pct": 90, "duration_s": 60, "frames": 1000000, "reordered_frames": 0}]')
       ) as m (n, procedure, metric, unit, limit_value, limit_kind, trials)
  cross join lateral (
         select max((trial ->> m.metric)::numeric) as value
           from jsonb_array_elements(m.trials::jsonb) as trial
       ) as worst
  join ouroboros.test_cases test_case
    on test_case.id = ('5eed0033-0000-4000-8000-'
                       || lpad((48240500 + m.n)::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
 order by m.n
on conflict do nothing;

-- Build 4's occurrences — V054's parse-time hook, #328's statement for the new cases.
insert into ouroboros.test_case_history (id, organization_id, test_case_id)
select ('5eed0035' || substr(test_case.id::text, 9))::uuid, test_case.organization_id, test_case.id
  from ouroboros.test_cases test_case
  join ouroboros.test_suites suite on suite.id = test_case.test_suite_id
 where suite.test_run_id = '5eed0031-0000-4000-8000-000000004824'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The telemetry case's score, re-scored over Build 4's pass — what the scorer would write after
-- it, so the stored figure is still the formula's. Its state moves by `flake_state_next()` from
-- the one it has; a second pass finds nothing to change.
update ouroboros.flake_scores score
   set score = computed.score,
       window_runs = computed.window_runs,
       state = ouroboros.flake_state_next(score.formula_version, score.state,
                                          computed.score, computed.window_runs),
       last_scored_at = build4.started_at + make_interval(secs => 65)
  from ouroboros.test_runs build4
  cross join lateral ouroboros.flake_score(build4.organization_id,
                                           (select case_key from ouroboros.test_cases
                                             where id = '5eed0033-0000-4000-8000-000048240203'),
                                           1) as computed
 where build4.id = '5eed0031-0000-4000-8000-000000004824'
   and score.id = '5eed0036-0000-4000-8000-000000000482'
   and (score.score, score.window_runs) is distinct from (computed.score, computed.window_runs)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The Build gate's farm jobs — `#484` built revision 1, `#485` revision 2, both on `forge-01`.
--
-- Finished, with all four instants and an exit code, on the PR's head branch at each revision's
-- sha (a full 40-hex sha whose first seven are the page's). Queued at each push, and 124 s and
-- 80 s long — together 204 s, which is what keeps mockup 08's *Avg build time* a whole number of
-- seconds (240) over the twenty-five builds today now holds. No ccache figures: the log line the
-- gate reads is the memory map, not the cache summary.
-- ---------------------------------------------------------------------------
insert into ouroboros.build_jobs
  (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
   label, title, executor, image, command, status,
   queued_at, offered_at, started_at, finished_at, exit_code)
select ('5eed0028-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", seed.number, pool.id, runner.id, repo.id,
       'refs/heads/loop/482-canbus-flake',
       seed.sha || substr(md5('ouroboros-pr-514-' || seed.sha), 1, 33),
       'zephyr build', 'can: fix flaky telemetry frame order under ISR load', 'container',
       'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app',
       'succeeded',
       run.started_at + make_interval(secs => seed.queued_in),
       run.started_at + make_interval(secs => seed.queued_in + 2),
       run.started_at + make_interval(secs => seed.queued_in + 4),
       run.started_at + make_interval(secs => seed.finished_in),
       0
  from (values
         (484, '3f9c2ae', 381, 509),
         (485, 'b7e41d0', 600, 684)
       ) as seed (number, sha, queued_in, finished_in)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.runs run          on run.organization_id = org."id" and run.issue_number = 482
  join ouroboros.runner_pools pool on pool.organization_id = org."id" and pool.name = 'pool-a'
  join ouroboros.runners runner    on runner.organization_id = org."id" and runner.name = 'forge-01'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
 where ${ouro_dev_seed}
on conflict do nothing;

-- Each job's memory map — the line the Build gate reads its `FLASH` figure from. The farm seed's
-- `not exists` guard and `order by`, for its reasons.
insert into ouroboros.build_log_chunks (id, job_id, seq, content)
select ('5eed0029-0000-4000-8000-' || lpad(job.number::text, 9, '0') || '001')::uuid,
       job.id, 1,
       convert_to(E'Memory region         Used Size  Region Size  %age Used\n'
                  || E'     FLASH:            912344 B         2 MB     43.50%\n'
                  || E'       RAM:            181208 B       512 KB     34.56%\n'
                  || E'[638/638] Linking zephyr.elf\n', 'UTF8')
  from ouroboros.organization org
  join ouroboros.build_jobs job on job.organization_id = org."id" and job.number in (484, 485)
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
   and not exists (select 1 from ouroboros.build_log_chunks existing
                    where existing.job_id = job.id and existing.seq = 1)
 order by job.number
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The AS.4 waiver — the thermal one the fifth criterion is waived against.
--
-- Criterion-level, so no case keys; Ken's; pending the PR plane's annotation (#359).
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_waivers (id, organization_id, run_id, author, reason, created_at)
select '5eed0039-0000-4000-8000-000000000482'::uuid,
       org."id", run.id, ken."id",
       'rig runs at 22°C only — thermal chamber not in bench',
       run.started_at + make_interval(secs => 540)
  from ouroboros.organization org
  join ouroboros.runs run    on run.organization_id = org."id" and run.issue_number = 482
  join ouroboros."user" ken  on ken.email = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- PR #514 — mirrored from GitHub, opened by loop #1847, closing the canonical #482.
--
-- `verifying`, which V052 admits on insert. Its counts are written as zero and set from
-- revision 2's files snapshot below, so the head's `+68 −15 · 3 files` is the snapshot's sum.
-- ---------------------------------------------------------------------------
insert into ouroboros.pull_requests (id, organization_id, source_id, external_number,
                                     external_url, title, head_branch, base_branch, state,
                                     run_id, ticket_id, created_at)
select '5eed003a-0000-4000-8000-000000000514'::uuid,
       org."id", ticket.source_id, 514,
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/pull/514',
       'can: fix flaky telemetry frame order under ISR load',
       run.branch_name, 'main', 'verifying',
       run.id, ticket.id,
       run.started_at + make_interval(secs => 380)
  from ouroboros.organization org
  join ouroboros.runs run           on run.organization_id = org."id" and run.issue_number = 482
  join ouroboros.tickets ticket     on ticket.organization_id = org."id"
                                   and ticket.external_key = '#482'
  join ouroboros.ticket_sources src on src.id = ticket.source_id
 where org."slug" = 'acme-robotics'
   and run.branch_name is not null
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The two revisions.
--
-- Revision 2's files are #302's change-set — the three `run_files` rows, as the snapshot's
-- `{path, additions, deletions}` — so the card and the console cannot disagree. Revision 1
-- predates the ISR fast-path edit, so it is the same rows without that file. The diff excerpt is
-- the card's `@@` sample, as the host would sync it. `run_stage_id` stays null (decision 2).
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_revisions (id, pr_id, revision_seq, head_sha, pushed_at, files,
                                    diff_excerpt)
select ('5eed003b-0000-4000-8000-' || lpad((514 * 10 + rev.seq)::text, 12, '0'))::uuid,
       pr.id, rev.seq, rev.sha,
       run.started_at + make_interval(secs => rev.pushed_in),
       (select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'additions', f.additions,
                                                     'deletions', f.deletions) order by f.path),
                        '[]'::jsonb)
          from ouroboros.run_files f
         where f.run_id = run.id
           and (rev.seq = 2 or f.path <> 'drivers/can/isr_fastpath.c')),
       rev.diff_excerpt
  from (values
         (1, '3f9c2ae', 380, null),
         (2, 'b7e41d0', 600,
          E'@@ drivers/can/telemetry_buf.c:41 @@ static void can_isr_rx(const struct device *dev)\n'
          || E'     struct tlm_frame *slot = tlm_slot_claim();\n'
          || E'-    slot->ts = k_cycle_get_32();\n'
          || E'-    k_fifo_put(&telemetry_fifo, slot);\n'
          || E'+    slot->ts = k_cycle_get_32();\n'
          || E'+    slot->seq = (uint16_t)atomic_inc(&tlm_seq); /* ISR-ordered */\n'
          || E'+    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);\n')
       ) as rev (seq, sha, pushed_in, diff_excerpt)
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
  join ouroboros.runs run         on run.id = pr.run_id
 where ${ouro_dev_seed}
 order by rev.seq
on conflict do nothing;

-- The head's counts — the sum of the latest revision's snapshot, as the sync would mirror them.
update ouroboros.pull_requests pr
   set additions = snapshot.additions,
       deletions = snapshot.deletions,
       changed_files = snapshot.changed_files
  from (select sum((f ->> 'additions')::integer)::integer as additions,
               sum((f ->> 'deletions')::integer)::integer as deletions,
               count(*)::integer                           as changed_files
          from ouroboros.pr_revisions rev
          cross join lateral jsonb_array_elements(rev.files) f
         where rev.pr_id = '5eed003a-0000-4000-8000-000000000514'
           and rev.revision_seq = (select max(revision_seq) from ouroboros.pr_revisions
                                    where pr_id = '5eed003a-0000-4000-8000-000000000514')
       ) as snapshot
 where pr.id = '5eed003a-0000-4000-8000-000000000514'
   and (pr.additions, pr.deletions, pr.changed_files)
       is distinct from (snapshot.additions, snapshot.deletions, snapshot.changed_files)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The gate set — the seven rows of the card, materialized from the `standard-fix@v14` pin.
--
-- `source` is the provenance V056 asks for; the version is the run's own pin, composed. All seven
-- are required — the human-approval gate too: the policy owns the question, and its answer for
-- this PR is the `not_required` verdict below.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_gate_definitions (id, pr_id, gate_key, source, required, sort_order,
                                           label, created_at)
select ('5eed003c-0000-4000-8000-' || lpad((514 * 10 + gate.ordinal)::text, 12, '0'))::uuid,
       pr.id, gate.gate_key,
       run.workflow_tag || '@v' || run.workflow_version_pin || ' pin',
       true, gate.ordinal, gate.label, pr.created_at
  from (values
         (1, 'build',           'Build'),
         (2, 'test_suite',      'Test suite'),
         (3, 'physical_hil',    'Physical HIL'),
         (4, 'diff_vs_plan',    'Diff-vs-plan conformance'),
         (5, 'secrets_license', 'Secrets & license scan'),
         (6, 'model_review',    'Second-model review'),
         (7, 'human_approval',  'Human approval')
       ) as gate (ordinal, gate_key, label)
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
  join ouroboros.runs run         on run.id = pr.run_id
 where run.workflow_tag is not null
   and run.workflow_version_pin is not null
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The verdict snapshots — one evaluation of every gate on each revision.
--
-- Each row's verdict and mono line are **composed from the row its `evidence_ref` names**, the
-- way the gate providers (#358) will compose them:
--
--   * build — the job's status and runner, and the `FLASH` percentage its memory map printed.
--   * test_suite — the attempt's recounted totals: green only with nothing failed.
--     Revision 1 is judged on Build 3, revision 2 on Build 4.
--   * physical_hil — the attempt's overshoot measurement: the verdict `hil_verdict()` gave it picks
--     green or red and `≤` or `>`, and the rig is the suite's platform.
--   * diff_vs_plan, secrets_license — #302's `allowed_paths` and `secrets` evaluations.
--   * model_review — `unavailable`: no provider exists until AZ.1, which is not `pending`.
--   * human_approval — `not_required`: the policy's answer, not an outcome.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_gate_results (id, definition_id, revision_id, verdict, evidence,
                                       evidence_ref, evaluated_at, provider_version)
select ('5eed003d-0000-4000-8000-'
        || lpad((514 * 100 + rev.revision_seq * 10 + gate.sort_order)::text, 12, '0'))::uuid,
       gate.id, rev.id, verdict.verdict, verdict.evidence, verdict.evidence_ref,
       run.started_at + make_interval(secs => case rev.revision_seq when 1 then 560 else 750 end),
       'dev-seed'
  from ouroboros.pr_revisions rev
  join ouroboros.pull_requests pr        on pr.id = rev.pr_id
  join ouroboros.runs run                on run.id = pr.run_id
  join ouroboros.pr_gate_definitions gate on gate.pr_id = pr.id
  -- The attempt a revision was judged on, and that attempt's overshoot measurement.
  join ouroboros.test_runs attempt
    on attempt.run_id = run.id and attempt.attempt_seq = case rev.revision_seq when 1 then 3 else 4 end
  join ouroboros.test_suites rig_suite
    on rig_suite.test_run_id = attempt.id and rig_suite.kind = 'physical'
  join ouroboros.test_cases overshoot_case
    on overshoot_case.test_suite_id = rig_suite.id and overshoot_case.name = 'overshoot_under_load'
  join ouroboros.hil_measurements overshoot on overshoot.test_case_id = overshoot_case.id
  -- The revision's farm build, by sha.
  join ouroboros.build_jobs job
    on job.organization_id = pr.organization_id and job.commit_sha like rev.head_sha || '%'
  join ouroboros.runners runner on runner.id = job.runner_id
  join ouroboros.build_log_chunks chunk on chunk.job_id = job.id and chunk.seq = 1
  -- #302's guardrail rows, by check.
  join ouroboros.guardrail_evaluations paths
    on paths.run_id = run.id and paths."check" = 'allowed_paths'
  join ouroboros.guardrail_evaluations scan
    on scan.run_id = run.id and scan."check" = 'secrets'
  cross join lateral (
    select case gate.gate_key
             when 'build' then
               case when job.status = 'succeeded' then 'green' else 'red' end
             when 'test_suite' then
               case when attempt.failed = 0 then 'green' else 'red' end
             when 'physical_hil' then
               case when overshoot.verdict = 'pass' then 'green' else 'red' end
             when 'diff_vs_plan' then
               case when paths.verdict = 'pass' then 'green' else 'red' end
             when 'secrets_license' then
               case when scan.verdict = 'pass' then 'green' else 'red' end
             when 'model_review' then 'unavailable'
             when 'human_approval' then 'not_required'
           end as verdict,
           case gate.gate_key
             when 'build' then
               format('%s · zephyr.elf · FLASH %s%%', runner.name,
                      trim_scale(substring(convert_from(chunk.content, 'UTF8')
                                           from 'FLASH:[^\n]*?([0-9]+\.[0-9]+)%')::numeric))
             when 'test_suite' then
               format('%s/%s after attempt %s', attempt.passed, attempt.total, attempt.attempt_seq)
             when 'physical_hil' then
               format('overshoot %s%% %s %s%% · rig %s', overshoot.value,
                      case when overshoot.verdict = 'pass' then '≤' else '>' end,
                      overshoot.limit_value, substring(rig_suite.platform from '^rig:(.*)$'))
             when 'diff_vs_plan' then 'all hunks map to planned files · 0 out-of-scope edits'
             when 'secrets_license' then 'clean'
             when 'model_review' then 'no second-model review provider until AZ.1'
             when 'human_approval' then 'not required by policy'
           end as evidence,
           case gate.gate_key
             when 'build'           then jsonb_build_object('kind', 'build_job', 'id', job.id::text)
             when 'test_suite'      then jsonb_build_object('kind', 'test_run', 'id', attempt.id::text)
             when 'physical_hil'    then jsonb_build_object('kind', 'hil_measurement', 'id', overshoot.id::text)
             when 'diff_vs_plan'    then jsonb_build_object('kind', 'guardrail_evaluation', 'id', paths.id::text)
             when 'secrets_license' then jsonb_build_object('kind', 'guardrail_evaluation', 'id', scan.id::text)
           end as evidence_ref
  ) as verdict
 where pr.id = '5eed003a-0000-4000-8000-000000000514'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The criteria — five claims of #482, from the ticket's plan.
--
-- Inserted `unverified`, their evidence cited, then marked `verified` — the order V057's
-- `pr_criteria_verified_has_evidence` requires. The fifth is `waived` from the start, against the
-- waiver above.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_criteria (id, pr_id, claim, source, status, waiver_ref, sort_order,
                                   created_by, created_at)
select ('5eed003e-0000-4000-8000-' || lpad((514 * 10 + claim.ordinal)::text, 12, '0'))::uuid,
       pr.id, claim.claim, 'plan',
       case when claim.waived then 'waived' else 'unverified' end,
       case when claim.waived then waiver.id end,
       claim.ordinal, ken."id", pr.created_at
  from (values
         (1, 'Telemetry frames must arrive in ISR order under load',  false),
         (2, 'No regression in e-stop response envelope',              false),
         (3, 'Fix must not mask real ordering bugs in tests',          false),
         (4, 'Zero heap allocation in ISR fast path',                  false),
         (5, 'Flake must not reappear across temperature range',       true)
       ) as claim (ordinal, claim, waived)
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
  join ouroboros.pr_waivers waiver on waiver.id = '5eed0039-0000-4000-8000-000000000482'
  left join ouroboros."user" ken   on ken.email = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The evidence — typed references, each resolved by V057 at write.
--
--   1. Build 4's rig frame-order case — `test_frame_order_under_load (10⁶ frames, 0 reordered)`,
--      composed from its measurement's trial — and the hunk `telemetry_buf.c:41–66` of revision 2.
--   2. Build 4's overshoot measurement, beside revision 1's (Build 3's) figure.
--   3. and 4. Analysis notes on revision 2: a reading of the code, whose text is the evidence.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_criteria_evidence (id, criterion_id, kind, test_case_id,
                                            hil_measurement_id, revision_id, hunk_path,
                                            hunk_line_start, hunk_line_end, display_text)
select ('5eed003f-0000-4000-8000-'
        || lpad((514 * 100 + cite.criterion * 10 + cite.ordinal)::text, 12, '0'))::uuid,
       criterion.id, cite.kind,
       case when cite.kind = 'test_case' then frame_case.id end,
       case when cite.kind = 'hil_measurement' then overshoot.id end,
       case when cite.kind in ('hunk', 'analysis_note') then rev2.id end,
       cite.hunk_path, cite.line_start, cite.line_end,
       case cite.kind
         when 'test_case' then
           format('test_%s (%s frames, %s reordered)', frame_case.name,
                  -- 1000000 renders as 10⁶, the way the matrix prints it.
                  '10' || translate(round(log((frame_order.trials -> 0 ->> 'frames')::numeric))::text,
                                    '0123456789', '⁰¹²³⁴⁵⁶⁷⁸⁹'),
                  frame_order.value)
         when 'hunk' then
           format('hunk %s:%s–%s', substring(cite.hunk_path from '[^/]+$'),
                  cite.line_start, cite.line_end)
         when 'hil_measurement' then
           format('HIL overshoot %s%% vs %s%% limit (was %s%% in rev 1)',
                  overshoot.value, overshoot.limit_value, rev1_overshoot.value)
         else cite.note
       end
  from (values
         (1, 1, 'test_case',       null::text,                    null::integer, null::integer, null::text),
         (1, 2, 'hunk',            'drivers/can/telemetry_buf.c', 41,            66,            null),
         (2, 1, 'hil_measurement', null,                          null,          null,          null),
         (3, 1, 'analysis_note',   null,                          null,          null,
          'test asserts on seq gaps, not sleep-based'),
         (4, 1, 'analysis_note',   null,                          null,          null,
          'static K_MSGQ_DEFINE · stack analysis clean')
       ) as cite (criterion, ordinal, kind, hunk_path, line_start, line_end, note)
  join ouroboros.pr_criteria criterion
    on criterion.id = ('5eed003e-0000-4000-8000-'
                       || lpad((514 * 10 + cite.criterion)::text, 12, '0'))::uuid
  join ouroboros.pr_revisions rev2 on rev2.pr_id = criterion.pr_id and rev2.revision_seq = 2
  -- Build 4's two rig cases and their measurements, and Build 3's overshoot.
  join ouroboros.test_cases frame_case
    on frame_case.id = '5eed0033-0000-4000-8000-000048240502'
  join ouroboros.hil_measurements frame_order on frame_order.test_case_id = frame_case.id
  join ouroboros.hil_measurements overshoot
    on overshoot.test_case_id = '5eed0033-0000-4000-8000-000048240501'
  join ouroboros.hil_measurements rev1_overshoot
    on rev1_overshoot.test_case_id = '5eed0033-0000-4000-8000-000048230501'
 where ${ouro_dev_seed}
on conflict do nothing;

-- The four cited claims, now verified. A second pass finds none unverified.
update ouroboros.pr_criteria criterion
   set status = 'verified'
 where criterion.pr_id = '5eed003a-0000-4000-8000-000000000514'
   and criterion.status = 'unverified'
   and exists (select 1 from ouroboros.pr_criteria_evidence e where e.criterion_id = criterion.id)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The review thread — three entries, and the arc on the second.
--
-- `claude-fable-5`'s self-review is resolved and was never blocking. `cursor/composer-2`'s second
-- opinion on revision 1 is written blocking and open, as it was said, and resolved by the update
-- below with the reply — so *was blocking → resolved* is V057's one-way lifecycle, not a row typed
-- in its final state. The policy bot's entry is about revision 2. Both model rows are
-- `simulated` (decision R4).
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_thread_entries (id, pr_id, revision_id, author_kind, author_name, tag,
                                         body, blocking, resolved, simulated, created_at)
select ('5eed0040-0000-4000-8000-' || lpad((514 * 10 + entry.ordinal)::text, 12, '0'))::uuid,
       pr.id, rev.id, entry.author_kind, entry.author_name, entry.tag, entry.body,
       entry.blocking, entry.resolved, entry.author_kind = 'model',
       run.started_at + make_interval(secs => entry.secs_in)
  from (values
         (1, 'model', 'claude-fable-5', 'self-review', null::integer, 590, false, true,
          'ISR path is allocation-free; verified priority ceiling unchanged. Sequence counter '
          || 'wraps at 65535 with gap-tolerant comparison in the drain loop.'),
         (2, 'model', 'cursor/composer-2', 'second opinion', 1, 570, true, false,
          'PID velocity sample now lags by one telemetry period — measurable overshoot risk on '
          || 'hard e-stop.'),
         (3, 'policy_bot', 'ouroboros policy bot', 'policy', 2, 752, false, false,
          'Auto-merge eligible: standard-fix policy — no human review required for effort ≤ M '
          || 'with all gates green.')
       ) as entry (ordinal, author_kind, author_name, tag, revision_seq, secs_in, blocking,
                   resolved, body)
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
  join ouroboros.runs run         on run.id = pr.run_id
  left join ouroboros.pr_revisions rev
    on rev.pr_id = pr.id and rev.revision_seq = entry.revision_seq
 where ${ouro_dev_seed}
on conflict do nothing;

-- The second opinion resolved, by the correction round.
update ouroboros.pr_thread_entries entry
   set resolved = true,
       resolution_body = 'Addressed in attempt 4 — sampling decoupled from telemetry drain.'
 where entry.id = '5eed0040-0000-4000-8000-000000005142'
   and not entry.resolved
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The merge plan — squash and delete the branch, close #482, comment the evidence, and leave the
-- roadmap alone. Unarmed: the page's button has not been pressed.
--
-- `commit_message` is written null, so V058 fills it from the template — the PR's title and
-- `Closes #482.` from the canonical ticket's own key.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_merge_plans (id, pr_id, strategy, delete_branch, commit_message,
                                      close_ticket, comment_evidence, back_annotate_epic,
                                      created_at)
select '5eed0041-0000-4000-8000-000000000514'::uuid, pr.id, run.merge_strategy, true, null,
       true, true, false, pr.created_at
  from ouroboros.pull_requests pr
  join ouroboros.runs run on run.id = pr.run_id
 where pr.id = '5eed003a-0000-4000-8000-000000000514'
   and run.merge_strategy is not null
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Spend — the loop's remaining 72k, and the Verification share of it.
--
-- Two rows on #302's ledger for `#482`, next to its four: the correction round's 31k / 19¢,
-- untagged like #302's, and the verification pass's 41k / 19¢, tagged `verify` — V020's
-- `task_kind` is the only tag `token_usage` has, and a name no route owns keeps the row out of
-- mockup 06's matrix (decision 3). R__dev_seed_dashboard.sql's
-- unattributed row gave up exactly this much (decision 3). `occurred_at` is clamped into the
-- current UTC day, for #302's reason.
--
--     #302's four rows        212 000   114¢
--     correction round         31 000    19¢
--     verification (verify)    41 000    19¢
--     ─────────────────────────────────────
--                             284 000   152¢      = 284k, $1.52 under the route's $2.50
-- ---------------------------------------------------------------------------
insert into ouroboros.token_usage (id, organization_id, run_id, provider, model,
                                   tokens_in, tokens_out, cost_cents, occurred_at, task_kind)
select ('5eed002e-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(spend.ordinal::text, 6, '0'))::uuid,
       org."id", run.id, 'anthropic', 'claude-fable-5',
       spend.tokens_total / 5 * 4, spend.tokens_total / 5, spend.cost_cents,
       greatest(run.started_at + make_interval(secs => spend.secs_in), utc_day.day_start),
       spend.task_kind
  from (values
         (5, 31000, 19.0000, 700, null::text),
         (6, 41000, 19.0000, 750, 'verify')
       ) as spend (ordinal, tokens_total, cost_cents, secs_in, task_kind)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
  cross join (select date_trunc('day', now() at time zone 'utc') at time zone 'utc')
          as utc_day (day_start)
 where ${ouro_dev_seed}
on conflict do nothing;
