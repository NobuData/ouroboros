-- R__dev_seed_workspace_interventions.sql — mockup 15's *"Where loops still need humans"* card, as
-- rows, in a development database and nowhere else.
--
-- [`docs/mockups/15-insights.html`](../../docs/mockups/15-insights.html) draws twenty interventions
-- in thirty days — `Flaky env / rig 8`, `Ambiguous ticket 5`, `Policy gate (refactor) 4`,
-- `Model disagreement 2`, `Other 1` — and *"Fix the top row and interventions drop ~40%"*, which is
-- 8 / 20. Filed as issue #434 (BI.3). This file writes the **source records**; V079's hooks turn
-- them into `intervention_events` and its rules assign the causes. Not one cause is typed here
-- except the one a person re-categorized, which is what that path is for.
--
-- Five events already exist before this file runs, from records other seeds wrote:
--
--   | Event                                 | From                    | Cause by rule             |
--   |---------------------------------------|-------------------------|---------------------------|
--   | needs-human #311, #333, #465          | the dashboard seed      | other, until explained    |
--   | Ken's product_bug call on #482        | the test-results seed   | other                     |
--   | the #482 waiver (rig at 22 °C only)   | the test-results seed   | other                     |
--
-- and this file explains them and adds the rest:
--
--   | Cause              | Events | Source records written here                                   |
--   |--------------------|--------|---------------------------------------------------------------|
--   | infra_rig          | 8      | 7 human infra_rig classifications on HIL cases (#310 #315     |
--   |                    |        | #321 #328 #334 #338 #343) + the #482 waiver, re-categorized   |
--   |                    |        | by Ken — its reason is a rig limit, which no record states    |
--   | ambiguous_ticket   | 5      | 4 unclear_requirements classifications (#311 #317 #327 #339)  |
--   |                    |        | + #311's handoff, which the classification on it explains     |
--   | policy_gate        | 4      | review_required failures on #465 #323 #332 + #465's handoff   |
--   | model_disagreement | 2      | a blocking vote on #333 + #333's handoff it explains          |
--   | other              | 1      | Ken's product_bug call on #482 (nothing here)                 |
--
-- Every record hangs off an existing run, found by issue number, at an offset inside that run, so
-- every detection is relative to the run and therefore to the moment the seeds were applied — the
-- 30-day window is never empty. No run is added: the dashboard's counts are the dashboard seed's.
--
-- **The vote is an event without a record.** AZ.1's votes (#371) have no table yet, so the
-- blocking vote is written straight into `intervention_events` with source `vote_block`, the shape
-- `record_intervention_event()` gives #371's hook. Its cause is still the rules'.
--
-- **Order.** This file reads the dashboard seed's runs and the test-results seed's waiver, so it
-- must sort after both: `dev_seed_workspace_interventions` does, and `dev_seed_interventions`
-- would sort before `dev_seed_test_results` and re-categorize nothing on a database migrated from
-- empty.
--
-- Ids: `5eed0056…` test runs, `5eed0057…` suites, `5eed0058…` cases, `5eed0059…`
-- classifications, `5eed005a…` guardrail evaluations, `5eed005b…` the vote, `5eed005c…` its event
-- and `5eed005d…` the override — each ending in the run's issue number.

-- ---------------------------------------------------------------------------
-- The attempts — one per run whose failure somebody classified, four minutes into the loop.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_runs (id, organization_id, run_id, attempt_seq, status, started_at)
select ('5eed0056-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", run.id, 1, 'complete', run.started_at + interval '4 minutes'
  from (values (310), (311), (315), (317), (321), (327), (328), (334), (338), (339), (343))
         as seed (issue_number)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs run         on run.organization_id = org."id"
                                 and run.issue_number = seed.issue_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The suites — the HIL rig for the firmware loops, the scheduler's unit suite for atlas.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_suites (id, organization_id, test_run_id, name, platform, kind)
select ('5eed0057-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       test_run.organization_id, test_run.id,
       case when seed.rig then 'PHYSICAL · HIL rig' else 'unit · scheduler' end,
       case when seed.rig then 'rig:helios-rig-02' else 'native_sim' end,
       case when seed.rig then 'physical' else 'sim' end
  from (values (310, true), (311, false), (315, true), (317, false), (321, true), (327, false),
               (328, true), (334, true), (338, true), (339, false), (343, true))
         as seed (issue_number, rig)
  join ouroboros.test_runs test_run
    on test_run.id = ('5eed0056-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The failing cases — one per suite, failed outright.
-- ---------------------------------------------------------------------------
insert into ouroboros.test_cases (id, organization_id, test_suite_id, name, classname, status,
                                  retries, retry_outcomes, duration_ms, failure)
select ('5eed0058-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       test_suite.organization_id, test_suite.id, seed.name, seed.classname, 'failed',
       0, '["failed"]'::jsonb, seed.duration_ms, jsonb_build_object('message', seed.message)
  from (values
         (310, 'hil.i2c',       'bus recovers after cold boot',           41000,
          'power-cycler on helios-rig-02 did not release the board within 30 s'),
         (315, 'hil.ota',       'abort leaves the slot bootable',         52000,
          'CAN adapter on helios-rig-02 not enumerated after USB reset'),
         (321, 'hil.imu',       'fusion stays finite under vibration',    63000,
          'shaker table on helios-rig-02 offline: no trial data'),
         (328, 'hil.mqtt',      'reconnects after link drop',             38000,
          'rig switch dropped the uplink mid-trial'),
         (334, 'hil.watchdog',  'kicks before brown-out reset',           29000,
          'bench supply on helios-rig-02 sagged below 4.6 V'),
         (338, 'hil.motor',     'integral clamps on stall',               47000,
          'encoder cable on helios-rig-02 intermittent: 212 missed edges'),
         (343, 'hil.flash',     'sector erase spans the boundary',        35000,
          'flash probe on helios-rig-02 timed out (probe busy)'),
         (311, 'scheduler',     'dry run lists the jobs it would start',  120,
          'expected 3 jobs, got 0'),
         (317, 'scheduler',     'maintenance window defers queued jobs',  140,
          'job 41 started inside the window'),
         (327, 'scheduler',     'per-repo cap counts queued jobs',        95,
          'expected the 4th job to wait, it started'),
         (339, 'scheduler',     'queue depth is reported per repository', 110,
          'expected 3 series, got 1')
       ) as seed (issue_number, classname, name, duration_ms, message)
  join ouroboros.test_suites test_suite
    on test_suite.id = ('5eed0057-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The totals — recounted from the cases, as the test-results seed does.
-- ---------------------------------------------------------------------------
update ouroboros.test_suites suite
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_suite_counts_computed computed
 where computed.test_suite_id = suite.id
   and suite.id::text like '5eed0057-%'
   and (suite.total, suite.passed, suite.failed, suite.flaky, suite.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

update ouroboros.test_runs test_run
   set total = computed.total, passed = computed.passed, failed = computed.failed,
       flaky = computed.flaky, skipped = computed.skipped
  from ouroboros.test_run_counts_computed computed
 where computed.test_run_id = test_run.id
   and test_run.id::text like '5eed0056-%'
   and (test_run.total, test_run.passed, test_run.failed, test_run.flaky, test_run.skipped)
       is distinct from (computed.total, computed.passed, computed.failed, computed.flaky, computed.skipped)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The classifications — a person's call on each failure, three minutes after the attempt.
--
-- Seven `infra_rig` (the rig failed, not the code) and four `product_bug` with the
-- `unclear_requirements` subtype (the ticket did not say). Each is an intervention event of its
-- own; #311's also explains that loop's handoff.
-- ---------------------------------------------------------------------------
insert into ouroboros.failure_classifications (id, organization_id, test_case_id, class, subtype,
                                               note, actor, created_by, created_at)
select ('5eed0059-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       test_case.organization_id, test_case.id, seed.class, seed.subtype, seed.note,
       'human', person."id", test_run.started_at + interval '3 minutes'
  from (values
         (310, 'infra_rig',   null::text, 'ken@acme-robotics.dev',
          'Rig fault, not the change: the power-cycler is sticking again.'),
         (315, 'infra_rig',   null,       'maya@acme-robotics.dev',
          'CAN adapter dropped off the bus. Re-seated it; re-run.'),
         (321, 'infra_rig',   null,       'jorge@acme-robotics.dev',
          'Shaker table was down for calibration.'),
         (328, 'infra_rig',   null,       'ken@acme-robotics.dev',
          'Lab switch reboot, not the reconnect path.'),
         (334, 'infra_rig',   null,       'maya@acme-robotics.dev',
          'Bench supply sagging under load — swap it before trusting brown-out tests.'),
         (338, 'infra_rig',   null,       'jorge@acme-robotics.dev',
          'Encoder cable is intermittent on rig-02.'),
         (343, 'infra_rig',   null,       'ken@acme-robotics.dev',
          'Probe was held by another session.'),
         (311, 'product_bug', 'unclear_requirements', 'maya@acme-robotics.dev',
          'The ticket never says whether a dry run includes paused repositories.'),
         (317, 'product_bug', 'unclear_requirements', 'jorge@acme-robotics.dev',
          'Unclear whether a window should stop jobs that are already running.'),
         (327, 'product_bug', 'unclear_requirements', 'ken@acme-robotics.dev',
          'The ticket does not define whether queued jobs count toward the cap.'),
         (339, 'product_bug', 'unclear_requirements', 'maya@acme-robotics.dev',
          'Asks for queue-depth metrics without saying per repository or overall.')
       ) as seed (issue_number, class, subtype, email, note)
  join ouroboros.test_cases test_case
    on test_case.id = ('5eed0058-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid
  join ouroboros.test_runs test_run
    on test_run.id = ('5eed0056-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid
  join ouroboros."user" person on person.email = seed.email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The policy gates — the review-required check failing on three refactors, five minutes in.
--
-- #465 handed off on it; #323 and #332 were approved and merged.
-- ---------------------------------------------------------------------------
insert into ouroboros.guardrail_evaluations (id, run_id, "check", verdict, evaluated_at)
select ('5eed005a-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       run.id, 'review_required', 'fail', run.started_at + interval '5 minutes'
  from (values (323), (332), (465)) as seed (issue_number)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs run         on run.organization_id = org."id"
                                 and run.issue_number = seed.issue_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The blocking vote on #333, nine minutes in — the event #371's hook will write.
-- ---------------------------------------------------------------------------
insert into ouroboros.intervention_events (id, organization_id, run_id, source, source_ref,
                                           detected_at, signals, cause)
select '5eed005c-0000-4000-8000-000000000333'::uuid, org."id", run.id, 'vote_block',
       '5eed005b-0000-4000-8000-000000000333', run.started_at + interval '9 minutes',
       '{vote:blocking}', 'other'
  from ouroboros.organization org
  join ouroboros.runs run on run.organization_id = org."id" and run.issue_number = 333
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Ken's re-categorization of the #482 waiver — the override row, then the event.
--
-- The waiver's reason — *rig runs at 22°C only — thermal chamber not in bench* — is a rig limit,
-- but nothing the rules read says so, and the rules leave it in `other`. A person correcting that
-- is the path this is: the audit row first, then the event, in the same transaction (the event's
-- trigger refuses a human cause without it). Both are filtered on the rules' answer, so a second
-- pass finds the event already Ken's and writes neither.
-- ---------------------------------------------------------------------------
insert into ouroboros.intervention_overrides (id, organization_id, event_id, actor_id, from_cause,
                                              to_cause, reason)
select '5eed005d-0000-4000-8000-000000000482'::uuid, event.organization_id, event.id, ken."id",
       event.cause, 'infra_rig',
       'The waiver is for the bench, not the policy: the rig has no thermal chamber.'
  from ouroboros.intervention_events event
  join ouroboros."user" ken on ken.email = 'ken@acme-robotics.dev'
 where event.source = 'waiver'
   and event.source_ref = '5eed0039-0000-4000-8000-000000000482'
   and event.cause_origin = 'rule'
   and ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.intervention_events event
   set cause = override.to_cause, cause_origin = 'human', rule_id = null, rule_version = null
  from ouroboros.intervention_overrides override
 where override.id = '5eed005d-0000-4000-8000-000000000482'
   and event.id = override.event_id
   and event.cause_origin = 'rule'
   and ${ouro_dev_seed};
