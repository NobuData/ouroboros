-- R__dev_seed_workspace_research.sql — the rest of mockup 22's Research page, in a development
-- database and nowhere else (#613, CK.6).
--
-- R__dev_seed_research.sql (#609) seeds the featured investigation, RS-127, with its 44-source
-- ledger and its brief. This file seeds every other region of
-- [`docs/mockups/22-research.html`](../../docs/mockups/22-research.html) from rows, so the page
-- renders from seeds alone:
--
--   INVESTIGATIONS  4 active · 23 this quarter
--    RS-118  bug fix       altimeter spikes below −10 °C        18 sources   fix loop live
--    RS-121  regression    motor PID overshoot v2.0.4 → rc1      9 sources   queued
--    RS-124  roadmap       Q4 improvements from support tickets 312 sources  ✓ issues filed
--    RS-127  gap analysis  autonomous docking vs. the field      44 sources  ✓ brief ready
--
--   * **The investigations** — RS-118 (`bug_root_cause`, `brief_ready`, its brief's `fix_draft`
--     deliverable a Planning draft with a repro test, for issue #498), RS-121
--     (`regression_forensics`, `queued`, 9 sources, one of them the failing HIL overshoot
--     measurement R__dev_seed_test_results.sql records — the row's `evidence →`), RS-124
--     (`roadmap_improvements`, `issues_filed`, **312 compact ticket-kind ledger rows** clustered
--     into seven themes, its brief's deliverables the create-issues batch and the roadmap doc).
--   * **The quarter.** RS-101…RS-127 are dense. RS-105…RS-127 start inside the current quarter
--     and RS-101…RS-104 in the one before, every time computed from `now()` (DASH-F.5's pattern,
--     #68), so `23 this quarter` holds on a quarter's first day as on its last. **`4 active` is
--     computed as "not failed or cancelled"**: the nineteen other investigations of the quarter
--     were cancelled (superseded by a later question) or failed. CM.6 (#625) owns the definition;
--     if it settles on another, those nineteen statuses are the one place that moves.
--   * **The capability matrix** — RS-127's five capabilities × four subjects, every cell but the
--     honest `? unknown` citing RS-127's own ledger, each row's gap severity with its derivation.
--   * **RS-127's matrix input** (#621) — what the `gap_analysis@1` playbook produced beside the
--     brief: the same cells and citations, each row's *proposed* gap, the epic `Docking parity`
--     and its five ticket stubs. The matrix builder derives the seeded severities from it, and the
--     card's `Proposed from gaps` chips — `DOCK-1 wind-feedforward MPC`, `DOCK-2 re-planned
--     retry`, `+3 more`, `L` — are computed from it.
--   * **The competitor registry** — four rivals, their watches over release notes, changelogs and
--     filings (the tracker's `4 rivals watched · release notes, changelogs, filings` is the
--     `competitor_tracker_summary` view), and one archived snapshot pair whose second snapshot
--     carries a citable diff.
--   * **The regression watch** — baselines (`v2.0.4`; boot time's `v2.1.0-rc1`, as its row says)
--     and the three items walked through V115's lifecycle into their exact states: hover drift
--     `+14%` `fix_running` on #512, boot time `+230 ms` `fix_drafted` on #517, battery estimate
--     error `fixed_merged` as PR #641. Their bisects name farm jobs R__dev_seed_farm.sql wrote.
--   * **The pipeline document** — RS-124's ROADMAP.md, version 1 (two milestones, six items, MVP
--     flags, #742 checked, target dates), committed at `8c1b2e4`, with its two open suggestions:
--     Ken's and the AI's.
--   * **The issues it filed** — canonical tickets #742…#747, each estimated (effort, risk as the
--     `cx:` chip, cycle time), #742 closed; the create-issues batch whose drafts were pushed to
--     them.
--
-- **Nothing here is a total.** `312 sources`, `6 issues · 2 milestones`, `1/3 done`,
-- `4 rivals watched` and `4 active · 23 this quarter` are queries over these rows — tests/seed.sql
-- reads them back.
--
-- **What this seed cannot show without breaking another page.** Mockup 22's `fix loop live` (RS-118)
-- and `loop live` (#743) are live loops, and the workspace's three live loops are mockup 02's
-- (#482, #479, #476 — `3 loops live` in the top bar). This seed adds no run: RS-118's fix draft and
-- #743 are where a loop would attach.
--
-- The personal workspace `kensuenobu` gets nothing: its empty Research page is the guidance
-- fixture #633 verifies against.
--
-- Every statement carries `${ouro_dev_seed}`, and every insert ends `on conflict do nothing`.
-- Writes whose BEFORE INSERT triggers allocate or check a sequence — investigation numbers,
-- cite numbers, brief and doc versions, estimate versions — are written only where none exist
-- yet, so a second application writes nothing (see seed.test.sh). The watch items are opened
-- `detected` and moved by updates, each guarded by the state it moves from.
--
-- It must sort after `dev_seed_research` (RS-127), `dev_seed_sources` (the GitHub source),
-- `dev_seed_farm` (the bisect's jobs) and `dev_seed_test_results` (RS-121's evidence);
-- `dev_seed_workspace_research` does.
--
-- Ids: `5eed008e` tickets, `5eed008f` estimates, `5eed0090` draft batches and drafts, `5eed0091`
-- investigations, `5eed0092` their sources, `5eed0093` briefs and claims, `5eed0094`
-- competitors, watches and snapshots, `5eed0095` the matrix, `5eed0096` the regression watch,
-- `5eed0097` the roadmap doc, `5eed0098` PR #641, `5eed0099` the Support source and its 312
-- tickets, `5eed009a` the churn-interview import, `5eed009b` the pipeline's two skills (#624).

-- ---------------------------------------------------------------------------
-- Canonical tickets: the bug RS-118 investigated, the watch's fix tickets, and the six
-- create-issues filed for RS-124.
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select ('5eed008e-0000-4000-8000-' || lpad(t.number::text, 12, '0'))::uuid, org."id", src.id,
       t.number::text, '#' || t.number,
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/issues/' || t.number,
       t.title, t.body, t.state, t.labels::jsonb, 'kensuenobu',
       now() - make_interval(days => t.age_days), now() - make_interval(days => t.age_days) + interval '2 hours',
       now() - interval '40 seconds', t.sizing,
       jsonb_build_object('github', jsonb_build_object('owner', src.config ->> 'login',
                                                       'repo',  'helios-firmware'))
  from (values
    (498, 'Altimeter spikes below −10 °C',
     'Barometric altitude jumps by up to 9 m in the first minutes of cold flights. Reproduced in the climate chamber at −12 °C.',
     'open', '["bug", "sensors"]', 'unsized', 6),
    (512, 'Hover drift +14% in gusts since v2.0.4',
     'Opened by the regression watch: nightly HIL gust-hold drift is 14% above the v2.0.4 baseline. Bisected to a41f2c9.',
     'open', '["regression", "nav"]', 'unsized', 4),
    (517, 'Boot time +230 ms since v2.1.0-rc1',
     'Opened by the regression watch: cold-boot time is 230 ms above the v2.1.0-rc1 baseline. Bisected to 7c03d1e.',
     'open', '["regression", "boot"]', 'unsized', 3),
    (639, 'Battery estimate error regression since v2.0.4',
     'Opened by the regression watch: state-of-charge estimate error drifted after the v2.0.4 release.',
     'closed', '["regression", "power"]', 'unsized', 20),
    (742, 'Wind-feedforward MPC in final approach',
     'From RS-124 / RS-127: replace the fixed-gain approach PID with a wind-feedforward MPC over the last 2 m.',
     'closed', '["docking", "roadmap", "mvp"]', 'sized', 18),
    (743, 'Re-planned abort & retry vectors',
     'From RS-124: after an aborted docking, re-plan the approach vector and retry instead of returning to loiter.',
     'open', '["docking", "roadmap", "mvp"]', 'sized', 18),
    (744, 'Gust estimator from IMU residuals',
     'From RS-124: estimate gusts from IMU residuals so the approach controller can anticipate them.',
     'open', '["docking", "roadmap"]', 'sized', 18),
    (745, 'Battery health model v2',
     'From RS-124: a battery health model that accounts for cold-weather capacity loss.',
     'open', '["fleet", "roadmap"]', 'sized', 18),
    (746, 'Telemetry gap alerts',
     'From RS-124: alert when a unit''s telemetry has a gap longer than its reporting interval.',
     'open', '["fleet", "roadmap"]', 'sized', 18),
    (747, 'Operator recovery playbook docs',
     'From RS-124: document the operator''s recovery procedure for an aborted docking.',
     'open', '["fleet", "docs", "roadmap"]', 'sized', 18)
  ) as t (number, title, body, state, labels, sizing, age_days)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The estimator's answer for each filed issue — the rows' effort chip, `cx:` (the risk) and
-- `est n loop-days` (the cycle time, in minutes of loop time).
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, ticket_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select ('5eed008f-0000-4000-8000-' || lpad(e.number::text, 12, '0'))::uuid, ticket.id, 1,
       e.effort, e.confidence, e.workflow, 'claude-fable-5',
       jsonb_build_object('files',       e.files::jsonb,
                          'est_tokens',  e.est_tokens,
                          'cycle_min',   e.loop_minutes * 3 / 4,
                          'cycle_max',   e.loop_minutes * 5 / 4,
                          'est_minutes', e.loop_minutes),
       e.risk, e.risk_note,
       jsonb_build_object('estimator', 'heuristic-v0',
                          'sized_at',  to_char(ticket.source_created_at at time zone 'UTC',
                                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0, 'signals', '[]'::jsonb),
       ticket.source_created_at
  from (values
    (742, 'l',  70, 'feature-loop', '["src/dock/dock_ctrl.c", "src/dock/mpc.c", "src/nav/wind_est.c"]', 2400000, 4320, 'high',   'A new controller in the final approach; HIL gust replay gates it.'),
    (743, 'm',  75, 'feature-loop', '["src/dock/dock_ctrl.c", "src/dock/approach_plan.c"]',              1200000, 2160, 'medium', 'Touches the abort branch only; the planner already exists.'),
    (744, 'm',  72, 'feature-loop', '["src/nav/wind_est.c", "src/nav/imu_residuals.c"]',                   900000, 1440, 'medium', 'Estimator only; nothing consumes it until #742 does.'),
    (745, 'm',  60, 'feature-loop', '["src/power/battery_model.c", "src/power/calibration.c"]',            1600000, 2880, 'high',   'Model and calibration change together; see the open suggestion to split it.'),
    (746, 's',  85, 'standard-fix', '["src/telemetry/gap_detect.c"]',                                       300000,  720, 'low',    'A threshold and an alert over an existing stream.'),
    (747, 'xs', 90, 'docs-loop',    '["docs/operators/recovery.md"]',                                       120000,  360, 'low',    'Documentation only.')
  ) as e (number, effort, confidence, workflow, files, est_tokens, loop_minutes, risk, risk_note)
  join ouroboros.tickets ticket on ticket.id = ('5eed008e-0000-4000-8000-' || lpad(e.number::text, 12, '0'))::uuid
 where not exists (select 1 from ouroboros.issue_estimates x where x.ticket_id = ticket.id)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Planning drafts: RS-124's create-issues batch (pushed as #742…#747) and RS-118's fix draft.
-- ---------------------------------------------------------------------------
insert into ouroboros.draft_batches
  (id, organization_id, source_prompt, planner, target_source_id, status, created_by, created_at)
select b.id, org."id", b.prompt, 'create-roadmap-v1', src.id, b.status, ken."id",
       date_trunc('quarter', now()) + (now() - date_trunc('quarter', now())) * b.at
  from (values
    ('5eed0090-0000-4000-8000-000000000124'::uuid,
     'RS-124 brief → ROADMAP.md → create-issues: two milestones, six issues.', 'pushed', 0.55),
    ('5eed0090-0000-4000-8000-000000000118'::uuid,
     'RS-118 brief → fix ticket with a repro test for #498.', 'drafting', 0.80)
  ) as b (id, prompt, status, at)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
  join ouroboros."user" ken         on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.ticket_drafts
  (id, batch_id, local_key, title, body, suggested_workflow, push_state, pushed_ticket_id)
select ('5eed0090-0000-4000-8000-000000001' || d.number)::uuid,
       '5eed0090-0000-4000-8000-000000000124'::uuid, 'RM-' || (d.number - 741), d.title, null,
       d.workflow, 'pushed', ('5eed008e-0000-4000-8000-' || lpad(d.number::text, 12, '0'))::uuid
  from (values
    (742, 'Wind-feedforward MPC in final approach', 'feature-loop'),
    (743, 'Re-planned abort & retry vectors',       'feature-loop'),
    (744, 'Gust estimator from IMU residuals',      'feature-loop'),
    (745, 'Battery health model v2',                'feature-loop'),
    (746, 'Telemetry gap alerts',                   'standard-fix'),
    (747, 'Operator recovery playbook docs',        'docs-loop')
  ) as d (number, title, workflow)
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.ticket_drafts
  (id, batch_id, local_key, title, body, suggested_workflow, push_state, pushed_ticket_id)
select '5eed0090-0000-4000-8000-000000001498'::uuid, '5eed0090-0000-4000-8000-000000000118'::uuid,
       'FIX-1', 'Clamp self-heat compensation below −10 °C (#498)',
       'Root cause (RS-118): the self-heat compensation term over-corrects as the board cools. '
         || 'Clamp it below −10 °C and add a climate-chamber repro test at −12 °C.',
       'standard-fix', 'pending', null
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The investigations. RS-118, RS-121 and RS-124 are featured; RS-101…RS-126's others make the
-- quarter. Times are fractions of the current quarter so far, or days before it.
-- ---------------------------------------------------------------------------
insert into ouroboros.investigations (id, organization_id, kind_id, seq, question, depth,
                                      tools_enabled, status, actuals, provenance, origin,
                                      created_by, created_at)
select ('5eed0091-0000-4000-8000-' || lpad(i.seq::text, 12, '0'))::uuid, org."id", kind.id, i.seq,
       i.question, i.depth, i.tools::jsonb, i.status,
       case when i.status in ('brief_ready', 'issues_filed') then i.actuals::jsonb end,
       case when i.status in ('running', 'brief_ready', 'issues_filed')
            then '{"researcher": "loop-v1", "alias": "researcher-long-ctx", "resolution_ref": null}'::jsonb end,
       i.origin, case when i.origin = 'user' then ken."id" end,
       case when i.at >= 0
            then date_trunc('quarter', now()) + (now() - date_trunc('quarter', now())) * i.at
            else date_trunc('quarter', now()) + make_interval(days => (i.at * 100)::int) end
  from (values
    -- the featured three
    (118, 'bug_root_cause', 'Root cause: altimeter spikes below −10 °C', 'standard',
     '["code", "tickets", "telemetry"]', 'brief_ready',
     '{"sources_used": 18, "spend_cents": 214, "duration_ms": 1140000}', 'user', 0.70),
    (121, 'regression_forensics', 'Motor PID overshoot appeared between v2.0.4 → v2.1.0-rc1', 'standard',
     '["code", "telemetry", "tickets"]', 'queued', null, 'user', 0.92),
    (124, 'roadmap_improvements', 'Q4 product improvements from support tickets + churn interviews', 'deep_dive',
     '["tickets", "web", "competitor"]', 'issues_filed',
     '{"sources_used": 312, "spend_cents": 1880, "duration_ms": 3420000}', 'user', 0.45),
    -- the rest of the quarter: superseded or failed
    (105, 'gap_analysis', 'How does our OTA story compare with Skylink''s?', 'quick', '["web", "competitor"]', 'cancelled', null, 'user', 0.02),
    (106, 'bug_root_cause', 'Why does the console drop pairing after sleep?', 'standard', '["code", "tickets"]', 'failed', null, 'user', 0.05),
    (107, 'regression_forensics', 'CAN-bus reorders since v2.0.3?', 'quick', '["code", "telemetry"]', 'cancelled', null, 'regression_watch', 0.08),
    (108, 'roadmap_improvements', 'What do field techs ask for most?', 'standard', '["tickets"]', 'cancelled', null, 'user', 0.11),
    (109, 'bug_root_cause', 'GPS cold-start takes 90 s on some units', 'standard', '["code", "tickets", "telemetry"]', 'failed', null, 'user', 0.14),
    (110, 'gap_analysis', 'Beacon range vs. AeroMesh Dock 2', 'quick', '["web", "competitor"]', 'cancelled', null, 'user', 0.17),
    (111, 'regression_forensics', 'Flash wear increased after the logging change?', 'standard', '["code", "telemetry"]', 'cancelled', null, 'regression_watch', 0.20),
    (112, 'bug_root_cause', 'Compass heading wanders near the dock', 'standard', '["code", "telemetry"]', 'failed', null, 'user', 0.23),
    (113, 'roadmap_improvements', 'Improvements from the Q3 NPS verbatims', 'standard', '["tickets"]', 'cancelled', null, 'user', 0.26),
    (114, 'gap_analysis', 'Docking accuracy vs. the field (first pass)', 'standard', '["web", "competitor", "code"]', 'cancelled', null, 'user', 0.29),
    (115, 'bug_root_cause', 'Motor whine at 40% throttle', 'quick', '["tickets", "telemetry"]', 'failed', null, 'user', 0.32),
    (116, 'regression_forensics', 'Hover drift in calm air since v2.0.4?', 'quick', '["telemetry"]', 'cancelled', null, 'regression_watch', 0.35),
    (117, 'bug_root_cause', 'Telemetry gaps over LTE handover', 'standard', '["code", "tickets", "telemetry"]', 'cancelled', null, 'user', 0.38),
    (119, 'gap_analysis', 'Payload API vs. Novum', 'quick', '["web", "competitor"]', 'cancelled', null, 'user', 0.50),
    (120, 'roadmap_improvements', 'Q4 improvements from tickets (superseded by RS-124)', 'standard', '["tickets"]', 'cancelled', null, 'user', 0.52),
    (122, 'bug_root_cause', 'Battery percentage jumps after a cold start', 'standard', '["code", "telemetry"]', 'cancelled', null, 'user', 0.60),
    (123, 'regression_forensics', 'Boot time regression since v2.1.0-rc1?', 'quick', '["telemetry"]', 'cancelled', null, 'regression_watch', 0.65),
    (125, 'gap_analysis', 'Docking vs. Skylink only (superseded by RS-127)', 'standard', '["web", "competitor", "code"]', 'cancelled', null, 'user', 0.75),
    (126, 'bug_root_cause', 'Rangefinder reads 0 m in heavy rain', 'standard', '["code", "telemetry"]', 'failed', null, 'user', 0.85),
    -- the quarter before
    (101, 'roadmap_improvements', 'Q3 improvements from support tickets', 'deep_dive', '["tickets", "web"]', 'cancelled', null, 'user', -0.40),
    (102, 'bug_root_cause', 'Console crash on firmware rollback', 'standard', '["code", "tickets"]', 'failed', null, 'user', -0.30),
    (103, 'gap_analysis', 'Fleet management vs. the field', 'standard', '["web", "competitor"]', 'cancelled', null, 'user', -0.20),
    (104, 'regression_forensics', 'Hover drift since v2.0.3?', 'quick', '["telemetry"]', 'cancelled', null, 'regression_watch', -0.10)
  ) as i (seq, kind, question, depth, tools, status, actuals, origin, at)
  join ouroboros.organization org          on org."slug" = 'acme-robotics'
  join ouroboros.investigation_kinds kind  on kind.organization_id = org."id" and kind.slug = i.kind
  join ouroboros."user" ken                on ken."email" = 'ken@acme-robotics.dev'
 where not exists (select 1 from ouroboros.investigations x
                    where x.organization_id = org."id" and x.seq = i.seq)
   and ${ouro_dev_seed}
 order by i.seq
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-118's ledger: 18 sources.
-- ---------------------------------------------------------------------------
insert into ouroboros.source_records (id, investigation_id, tool_slug, kind, title, locator,
                                      retrieved_at, content_hash, excerpt, meta, cite_no)
select ('5eed0092-0000-4000-8000-000118' || lpad(f.n::text, 6, '0'))::uuid, inv.id, f.tool, f.kind,
       f.title, f.locator, inv.created_at + make_interval(mins => f.n),
       'sha256:' || encode(sha256(convert_to(f.excerpt, 'UTF8')), 'hex'), f.excerpt, f.meta::jsonb, f.n
  from (values
    (1,  'tickets',   'ticket',    'Issue #498 — altimeter spikes below −10 °C', 'issue-index://github/helios-firmware/498', 'Altitude jumps up to 9 m in the first minutes of cold flights.', '{"index": "github", "number": 498}'),
    (2,  'tickets',   'ticket',    'Support ticket SUP-1882 — winter survey flights climb on take-off', 'issue-index://support/SUP-1882', 'Units report a false climb during the first 3 minutes below −10 °C.', '{"index": "support", "key": "SUP-1882"}'),
    (3,  'telemetry', 'telemetry', 'Barometric altitude error vs. board temperature — 90 days', 'telemetry://fleet.baro_alt_error/90d', 'Error is flat above 0 °C and rises sharply below −10 °C.', '{"metric": "fleet.baro_alt_error", "window": "90d", "group_by": "board_temp"}'),
    (4,  'telemetry', 'telemetry', 'Board temperature during cold take-offs', 'telemetry://fleet.board_temp/90d', 'Board temperature falls 6–9 °C in the first 3 minutes after take-off.', '{"metric": "fleet.board_temp", "window": "90d"}'),
    (5,  'code',      'code',      'baro.c — self-heat compensation term', 'git://helios-firmware@8c1b2e4/src/sensors/baro.c#L132-L148', 'alt += k_selfheat * (t_board - t_ambient);  /* linear, unclamped */', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/sensors/baro.c", "lines": [132, 148]}'),
    (6,  'code',      'code',      'baro.c blame — compensation added in v1.6', 'git://helios-firmware@8c1b2e4/src/sensors/baro.c#L140', 'Added in v1.6 for summer heat soak; never characterised below 0 °C.', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/sensors/baro.c", "lines": [140, 140]}'),
    (7,  'telemetry', 'telemetry', 'Climate chamber run at −12 °C — altitude trace', 'telemetry://hil.climate_chamber_baro/2026-09-28..2026-09-29', 'Spike of 8.7 m at minute 2, matching the field reports.', '{"metric": "hil.climate_chamber_baro", "window": "2026-09-28..2026-09-29"}'),
    (8,  'code',      'code',      'sensor_fusion.c — baro weight in the altitude filter', 'git://helios-firmware@8c1b2e4/src/nav/sensor_fusion.c#L77', 'baro_weight = 0.6f;  /* dominates over accelerometer integration */', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/nav/sensor_fusion.c", "lines": [77, 77]}'),
    (9,  'tickets',   'ticket',    'Issue #287 — summer heat-soak altitude drift (closed)', 'issue-index://github/helios-firmware/287', 'Fixed in v1.6 by adding the self-heat compensation term.', '{"index": "github", "number": 287}'),
    (10, 'telemetry', 'telemetry', 'Altitude error by firmware version — cold flights', 'telemetry://fleet.baro_alt_error_cold/180d', 'Cold-flight spikes start with v1.6 and persist through v2.1.0-rc1.', '{"metric": "fleet.baro_alt_error_cold", "window": "180d", "group_by": "firmware"}'),
    (11, 'code',      'code',      'tests/unit/test_baro.c — no cold-temperature cases', 'git://helios-firmware@8c1b2e4/tests/unit/test_baro.c', 'All compensation tests run between 15 and 45 °C.', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "tests/unit/test_baro.c"}'),
    (12, 'tickets',   'ticket',    'Support ticket SUP-1903 — geofence breach on a cold morning', 'issue-index://support/SUP-1903', 'A false climb triggered the altitude geofence at −14 °C.', '{"index": "support", "key": "SUP-1903"}'),
    (13, 'telemetry', 'telemetry', 'Ambient temperature at take-off — fleet', 'telemetry://fleet.ambient_temp/90d', '11% of flights in the last 90 days took off below −10 °C.', '{"metric": "fleet.ambient_temp", "window": "90d"}'),
    (14, 'code',      'code',      'baro.c — ambient estimate from the airframe sensor', 'git://helios-firmware@8c1b2e4/src/sensors/baro.c#L98', 't_ambient = airframe_temp();  /* lags the board by minutes in the cold */', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/sensors/baro.c", "lines": [98, 98]}'),
    (15, 'tickets',   'ticket',    'Issue #451 — altitude hold oscillation in winter (duplicate of #498)', 'issue-index://github/helios-firmware/451', 'Closed as a duplicate of #498.', '{"index": "github", "number": 451}'),
    (16, 'telemetry', 'telemetry', 'Climate chamber run at −12 °C with the clamp — altitude trace', 'telemetry://hil.climate_chamber_baro_clamp/2026-09-30..2026-10-01', 'With the term clamped below −10 °C the spike is 0.4 m.', '{"metric": "hil.climate_chamber_baro_clamp", "window": "2026-09-30..2026-10-01"}'),
    (17, 'code',      'code',      'baro.c — proposed clamp', 'git://helios-firmware@8c1b2e4/src/sensors/baro.c#L144', 'if (t_ambient < -10.0f) delta = clampf(delta, -0.5f, 0.5f);', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/sensors/baro.c", "lines": [144, 144]}'),
    (18, 'tickets',   'ticket',    'Support macro — "cold-weather altitude advisory"', 'issue-index://support/macro-cold-altitude', 'Support has been advising customers to hover 3 minutes before missions in the cold.', '{"index": "support", "key": "macro-cold-altitude"}')
  ) as f (n, tool, kind, title, locator, excerpt, meta)
  join ouroboros.investigations inv on inv.id = '5eed0091-0000-4000-8000-000000000118'::uuid
 where not exists (select 1 from ouroboros.source_records s where s.investigation_id = inv.id)
   and ${ouro_dev_seed}
 order by f.n
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-121's ledger: 9 sources, the first the failing HIL overshoot measurement the test-results
-- seed records — the row's `evidence →`.
-- ---------------------------------------------------------------------------
insert into ouroboros.source_records (id, investigation_id, tool_slug, kind, title, locator,
                                      retrieved_at, content_hash, excerpt, meta, cite_no)
select ('5eed0092-0000-4000-8000-000121' || lpad(f.n::text, 6, '0'))::uuid, inv.id, f.tool, f.kind,
       f.title, f.locator, inv.created_at + make_interval(mins => f.n),
       'sha256:' || encode(sha256(convert_to(f.excerpt, 'UTF8')), 'hex'), f.excerpt,
       f.meta::jsonb || case when f.n = 1 then jsonb_build_object('test_run_id', evidence.test_run_id,
                                                                  'hil_measurement_id', evidence.id)
                             else '{}'::jsonb end,
       f.n
  from (values
    (1, 'telemetry', 'telemetry', 'HIL dyno bench — motor overshoot 2.4% vs limit 2.0%', 'telemetry://hil.motor_overshoot_pct/14d', 'E-stop release under 2 Nm load: overshoot 2.1%, 2.4%, 2.3% over three trials; limit 2.0%.', '{"metric": "hil.motor_overshoot_pct", "window": "14d"}'),
    (2, 'telemetry', 'telemetry', 'Motor overshoot by firmware version — HIL nightly', 'telemetry://hil.motor_overshoot_pct/90d', 'Overshoot is 1.6% at v2.0.4 and 2.3% from v2.1.0-rc1.', '{"metric": "hil.motor_overshoot_pct", "window": "90d", "group_by": "firmware"}'),
    (3, 'code', 'code', 'motor_pid.c — gain-scheduling table', 'git://helios-firmware@8c1b2e4/src/motor/motor_pid.c#L61-L84', 'kp_table[] retuned for the new ESCs between v2.0.4 and v2.1.0-rc1.', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/motor/motor_pid.c", "lines": [61, 84]}'),
    (4, 'code', 'code', 'v2.0.4..v2.1.0-rc1 — commits touching src/motor', 'git://helios-firmware@8c1b2e4/src/motor', '6 commits; one changes the gain schedule above 1000 rpm.', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/motor", "range": "v2.0.4..v2.1.0-rc1"}'),
    (5, 'tickets', 'ticket', 'Issue #471 — unit tests for motor PID edge cases', 'issue-index://github/helios-firmware/471', 'Merged; covers saturation but not load steps.', '{"index": "github", "number": 471}'),
    (6, 'tickets', 'ticket', 'Issue #474 — debounce e-stop interrupt handler', 'issue-index://github/helios-firmware/474', 'Merged as PR #512; changed the e-stop release timing the bench exercises.', '{"index": "github", "number": 474}'),
    (7, 'telemetry', 'telemetry', 'Fleet motor current spikes on e-stop release — 30 days', 'telemetry://fleet.motor_current_spike/30d', 'Current spikes on release rose 18% on units running v2.1.0-rc1.', '{"metric": "fleet.motor_current_spike", "window": "30d"}'),
    (8, 'code', 'code', 'esc_driver.c — new ESC response curve', 'git://helios-firmware@8c1b2e4/src/motor/esc_driver.c#L40', 'response_ms = 4;  /* was 6 on the previous ESC */', '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/motor/esc_driver.c", "lines": [40, 40]}'),
    (9, 'tickets', 'ticket', 'Support ticket SUP-2401 — motor whine after e-stop', 'issue-index://support/SUP-2401', 'Audible overshoot on release after updating to the release candidate.', '{"index": "support", "key": "SUP-2401"}')
  ) as f (n, tool, kind, title, locator, excerpt, meta)
  join ouroboros.investigations inv on inv.id = '5eed0091-0000-4000-8000-000000000121'::uuid
  cross join lateral (
    select m.id, suite.test_run_id
      from ouroboros.hil_measurements m
      join ouroboros.test_cases tc     on tc.id = m.test_case_id
      join ouroboros.test_suites suite on suite.id = tc.test_suite_id
     where m.organization_id = inv.organization_id and m.metric = 'overshoot_pct' and m.verdict = 'fail'
     order by m.value desc, m.id
     limit 1) evidence
 where not exists (select 1 from ouroboros.source_records s where s.investigation_id = inv.id)
   and ${ouro_dev_seed}
 order by f.n
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-124's ledger: 312 support tickets, compact, clustered into seven themes.
-- ---------------------------------------------------------------------------
insert into ouroboros.source_records (id, investigation_id, tool_slug, kind, title, locator,
                                      retrieved_at, content_hash, excerpt, meta, cite_no)
select ('5eed0092-0000-4000-8000-000124' || lpad(n::text, 6, '0'))::uuid, inv.id, 'tickets', 'ticket',
       'SUP-' || (3000 + n) || ' — ' || theme.subject,
       'issue-index://support/SUP-' || (3000 + n),
       inv.created_at + make_interval(secs => n * 10),
       'sha256:' || encode(sha256(convert_to('SUP-' || (3000 + n) || ': ' || theme.excerpt, 'UTF8')), 'hex'),
       theme.excerpt,
       jsonb_build_object('index', 'support', 'key', 'SUP-' || (3000 + n), 'theme', theme.key),
       n
  from generate_series(1, 312) as n
  join (values
    (0, 'docking',     'docking aborts in wind',              'Customer reports the unit aborting docking in moderate wind and waiting at loiter.'),
    (1, 'battery',     'battery estimate wrong in the cold',  'Remaining-flight estimate drops sharply on cold mornings.'),
    (2, 'telemetry',   'telemetry gaps during missions',      'Fleet dashboard shows gaps of several minutes mid-mission.'),
    (3, 'ota',         'update interrupted or failed',        'An interrupted update left the unit needing a manual recovery.'),
    (4, 'recovery',    'no clear recovery procedure',         'Operator did not know how to recover the unit after an abort.'),
    (5, 'gusts',       'unstable hover in gusts',             'Unit drifts noticeably in gusty conditions during inspection hovers.'),
    (6, 'pairing',     'console pairing drops',               'Console loses pairing after the unit sleeps.')
  ) as theme (slot, key, subject, excerpt) on theme.slot = n % 7
  join ouroboros.investigations inv on inv.id = '5eed0091-0000-4000-8000-000000000124'::uuid
 where not exists (select 1 from ouroboros.source_records s where s.investigation_id = inv.id)
   and ${ouro_dev_seed}
 order by n
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Briefs: RS-118's root cause (its deliverable the fix draft) and RS-124's themes (its
-- deliverables the create-issues batch and the roadmap doc).
-- ---------------------------------------------------------------------------
insert into ouroboros.briefs (id, investigation_id, version, body, deliverables, created_at)
select b.id, inv.id, 1, b.body::jsonb, b.deliverables::jsonb, inv.created_at + interval '20 minutes'
  from (values
    ('5eed0093-0000-4000-8000-000000000118'::uuid, '5eed0091-0000-4000-8000-000000000118'::uuid,
     '{"paragraphs": [{"spans": [
        {"text": "The spikes come from the barometer''s self-heat compensation: it assumes the board is warmer than the air, and below −10 °C it over-corrects for minutes after take-off.", "claim": "selfheat-overcorrects"},
        {"text": " Clamping the term below −10 °C removes the spike in the climate chamber.", "claim": "clamp-fixes"},
        {"text": " A fix ticket with a −12 °C repro test is drafted."}]}]}',
     '{"fix_draft": "5eed0090-0000-4000-8000-000000001498"}'),
    ('5eed0093-0000-4000-8000-000000000124'::uuid, '5eed0091-0000-4000-8000-000000000124'::uuid,
     '{"paragraphs": [{"spans": [
        {"text": "312 support tickets cluster into seven themes; docking in wind and recovery after an abort lead, and churn interviews rank them first.", "claim": "themes"},
        {"text": " Two milestones cover them: docking parity, then fleet reliability."}]}]}',
     '{"draft_batch": "5eed0090-0000-4000-8000-000000000124", "roadmap_doc": "5eed0097-0000-4000-8000-000000000124"}')
  ) as b (id, investigation_id, body, deliverables)
  join ouroboros.investigations inv on inv.id = b.investigation_id
 where not exists (select 1 from ouroboros.briefs x where x.investigation_id = inv.id)
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.brief_claims (id, investigation_id, brief_id, span_ref, claim_type, text, created_at)
select c.id, brief.investigation_id, brief.id, c.span_ref, 'finding', c.text, brief.created_at
  from (values
    ('5eed0093-0000-4000-8000-000000001181'::uuid, '5eed0093-0000-4000-8000-000000000118'::uuid, 'selfheat-overcorrects',
     'The self-heat compensation over-corrects below −10 °C for minutes after take-off.'),
    ('5eed0093-0000-4000-8000-000000001182'::uuid, '5eed0093-0000-4000-8000-000000000118'::uuid, 'clamp-fixes',
     'Clamping the compensation below −10 °C removes the spike in the climate chamber.'),
    ('5eed0093-0000-4000-8000-000000001241'::uuid, '5eed0093-0000-4000-8000-000000000124'::uuid, 'themes',
     'Support tickets cluster into seven themes, docking in wind and recovery after an abort leading.')
  ) as c (id, brief_id, span_ref, text)
  join ouroboros.briefs brief on brief.id = c.brief_id
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.brief_claim_sources (investigation_id, claim_id, source_id)
select claim.investigation_id, claim.id, source.id
  from (values ('5eed0093-0000-4000-8000-000000001181'::uuid, 3),
               ('5eed0093-0000-4000-8000-000000001181'::uuid, 5),
               ('5eed0093-0000-4000-8000-000000001181'::uuid, 7),
               ('5eed0093-0000-4000-8000-000000001182'::uuid, 16),
               ('5eed0093-0000-4000-8000-000000001241'::uuid, 1),
               ('5eed0093-0000-4000-8000-000000001241'::uuid, 5),
               ('5eed0093-0000-4000-8000-000000001241'::uuid, 7)) as link (claim_id, cite_no)
  join ouroboros.brief_claims claim    on claim.id = link.claim_id
  join ouroboros.source_records source on source.investigation_id = claim.investigation_id
                                      and source.cite_no = link.cite_no
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The competitor registry: four rivals and what is watched for each.
-- ---------------------------------------------------------------------------
insert into ouroboros.competitors (id, organization_id, name, meta, created_at)
select c.id, org."id", c.name, c.meta::jsonb, date_trunc('quarter', now()) - interval '60 days'
  from (values
    ('5eed0094-0000-4000-8000-000000000001'::uuid, 'Skylink',     '{"site": "https://skylink.example.com", "aliases": ["Skylink Robotics"]}'),
    ('5eed0094-0000-4000-8000-000000000002'::uuid, 'AeroMesh',    '{"site": "https://aeromesh.example.com"}'),
    ('5eed0094-0000-4000-8000-000000000003'::uuid, 'Novum',       '{"site": "https://novum.example.io", "notes": "Public company — investor updates are filings."}'),
    ('5eed0094-0000-4000-8000-000000000004'::uuid, 'Kestrel Aero', '{"site": "https://kestrel-aero.example.com"}')
  ) as c (id, name, meta)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.competitor_watches (id, competitor_id, source_kind, url, selector, cadence, enabled, created_at)
select w.id, w.competitor_id, w.kind, w.url, w.selector, w.cadence, true,
       date_trunc('quarter', now()) - interval '60 days'
  from (values
    ('5eed0094-0000-4000-8000-000000000011'::uuid, '5eed0094-0000-4000-8000-000000000001'::uuid, 'release_notes', 'https://skylink.example.com/releases', 'main .release-list', 'daily'),
    ('5eed0094-0000-4000-8000-000000000012'::uuid, '5eed0094-0000-4000-8000-000000000002'::uuid, 'changelog',     'https://aeromesh.example.com/changelog', null, 'daily'),
    ('5eed0094-0000-4000-8000-000000000013'::uuid, '5eed0094-0000-4000-8000-000000000003'::uuid, 'filings',       'https://novum.example.io/investors', null, 'weekly'),
    ('5eed0094-0000-4000-8000-000000000014'::uuid, '5eed0094-0000-4000-8000-000000000004'::uuid, 'release_notes', 'https://kestrel-aero.example.com/news', 'article.release', 'daily')
  ) as w (id, competitor_id, kind, url, selector, cadence)
  join ouroboros.competitors c on c.id = w.competitor_id
 where ${ouro_dev_seed}
on conflict do nothing;

-- The archived pair: Skylink's release notes before and after 6.2 — the second carries the diff.
insert into ouroboros.competitor_snapshots (id, watch_id, previous_id, content_hash, content_ref, diff, taken_at)
select '5eed0094-0000-4000-8000-000000000101'::uuid, '5eed0094-0000-4000-8000-000000000011'::uuid, null,
       'sha256:' || encode(sha256(convert_to('skylink releases: 6.1', 'UTF8')), 'hex'),
       'archive://competitor/skylink/releases/6.1.html', null, now() - interval '9 days'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.competitor_snapshots (id, watch_id, previous_id, content_hash, content_ref, diff, taken_at)
select '5eed0094-0000-4000-8000-000000000102'::uuid, '5eed0094-0000-4000-8000-000000000011'::uuid,
       '5eed0094-0000-4000-8000-000000000101'::uuid,
       'sha256:' || encode(sha256(convert_to('skylink releases: 6.1, 6.2', 'UTF8')), 'hex'),
       'archive://competitor/skylink/releases/6.2.html',
       '+ 6.2 — Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.' || chr(10)
         || '+ 6.2 — Abort telemetry is now uploaded to the fleet portal.',
       now() - interval '8 days'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-127's capability matrix: five capabilities × us and three rivals.
-- ---------------------------------------------------------------------------
insert into ouroboros.capability_matrices (id, investigation_id, title, us_label, rivals, created_at)
select '5eed0095-0000-4000-8000-000000000127'::uuid, inv.id, 'Autonomous docking vs. the field', 'Helios',
       array['5eed0094-0000-4000-8000-000000000001', '5eed0094-0000-4000-8000-000000000002',
             '5eed0094-0000-4000-8000-000000000003']::uuid[],
       inv.created_at + interval '30 minutes'
  from ouroboros.investigations inv
  join ouroboros.organization org on org."id" = inv.organization_id and org."slug" = 'acme-robotics'
 where inv.seq = 127
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.matrix_rows (id, matrix_id, capability, sort_order, gap_severity, severity_derivation)
select r.id, '5eed0095-0000-4000-8000-000000000127'::uuid, r.capability, r.sort_order, r.severity, r.derivation
  from (values
    ('5eed0095-0000-4000-8000-000000000001'::uuid, 'Docking in >8 m/s gusts', 0, 'high',
     'Skylink ships it; we are partial, and 48% of our dockings above 8 m/s fail [25]. Behind the best rival on a core flow → high.'),
    ('5eed0095-0000-4000-8000-000000000002'::uuid, 'Visual-inertial approach (no beacon)', 1, 'high',
     'Two rivals ship it and one has it in beta; we have none. Behind the field on the docking flow → high.'),
    ('5eed0095-0000-4000-8000-000000000003'::uuid, 'Abort & retry recovery logic', 2, 'med',
     'Skylink ships re-planned retries; we and AeroMesh are partial. Behind one rival; customers notice [18] → med.'),
    ('5eed0095-0000-4000-8000-000000000004'::uuid, 'OTA resilience (A/B + rollback)', 3, 'wip',
     'Skylink ships it; ours is in flight (#456) and no other rival has it → wip.'),
    ('5eed0095-0000-4000-8000-000000000005'::uuid, 'Recovery beacon over BLE', 4, 'lead',
     'We ship it; no rival is known to → lead. AeroMesh is unknown, not none.')
  ) as r (id, capability, sort_order, severity, derivation)
  join ouroboros.capability_matrices m on m.id = '5eed0095-0000-4000-8000-000000000127'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.matrix_cells (id, investigation_id, matrix_id, row_id, competitor_id, status, note)
select ('5eed0095-0000-4000-8000-0000000001' || c.row_no || c.col_no)::uuid, m.investigation_id, m.id,
       ('5eed0095-0000-4000-8000-00000000000' || c.row_no)::uuid,
       case c.col_no when 0 then null else ('5eed0094-0000-4000-8000-00000000000' || c.col_no)::uuid end,
       c.status, c.note
  from (values
    (1, 0, 'partial',  null), (1, 1, 'shipping', null), (1, 2, 'partial', null),  (1, 3, 'none', null),
    (2, 0, 'none',     null), (2, 1, 'shipping', null), (2, 2, 'shipping', null), (2, 3, 'partial', 'beta'),
    (3, 0, 'partial',  null), (3, 1, 'shipping', null), (3, 2, 'partial', null),  (3, 3, 'none', null),
    (4, 0, 'wip', 'in flight'), (4, 1, 'shipping', null), (4, 2, 'none', null),   (4, 3, 'none', null),
    (5, 0, 'shipping', null), (5, 1, 'none',     null), (5, 2, 'unknown', null),  (5, 3, 'none', null)
  ) as c (row_no, col_no, status, note)
  join ouroboros.capability_matrices m on m.id = '5eed0095-0000-4000-8000-000000000127'
 where ${ouro_dev_seed}
on conflict do nothing;

-- Every cell but the honest `? unknown` cites RS-127's own ledger.
insert into ouroboros.matrix_cell_sources (investigation_id, cell_id, source_id)
select cell.investigation_id, cell.id, source.id
  from (values
    (1, 0, 25), (1, 0, 26), (1, 1, 1), (1, 1, 8), (1, 1, 40), (1, 2, 3), (1, 2, 4), (1, 3, 5),
    (2, 0, 39), (2, 1, 2), (2, 2, 4), (2, 3, 6), (2, 3, 13),
    (3, 0, 34), (3, 0, 28), (3, 1, 9), (3, 2, 11), (3, 3, 5),
    (4, 0, 36), (4, 0, 24), (4, 1, 10), (4, 2, 11), (4, 3, 5),
    (5, 0, 37), (5, 0, 23), (5, 1, 2), (5, 3, 42)
  ) as link (row_no, col_no, cite_no)
  join ouroboros.matrix_cells cell     on cell.id = ('5eed0095-0000-4000-8000-0000000001' || link.row_no || link.col_no)::uuid
  join ouroboros.source_records source on source.investigation_id = cell.investigation_id
                                      and source.cite_no = link.cite_no
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-127's matrix input — the deliverable input the matrix above was built from (#621, CM.2).
--
-- Written from the matrix rows themselves, so the two cannot drift: the title and columns, every
-- cell with the status a playbook writes (`beta` for a partial labelled beta, `in_flight` for a
-- wip) and its sources, and each row's gap as the investigation *proposed* it — the severity rule
-- needs it to tell rows one and three apart, whose cells are the same. Beside the rows: the epic
-- and the five ticket stubs mockup 22's chip row previews (`EPIC · Docking parity`, `DOCK-1
-- wind-feedforward MPC`, `DOCK-2 re-planned retry`, `+3 more`, effort `L` — m m m l s is 16
-- points), each naming the capability row it closes and citing RS-127's own ledger.
-- ---------------------------------------------------------------------------
insert into ouroboros.investigation_deliverable_inputs (investigation_id, brief_id, deliverable,
                                                        payload, created_at)
select m.investigation_id, brief.id, 'matrix',
       jsonb_build_object(
         'title', m.title,
         'us', m.us_label,
         'rivals', (select jsonb_agg(c.name order by r.ord)
                      from unnest(m.rivals) with ordinality as r (id, ord)
                      join ouroboros.competitors c on c.id = r.id),
         'rows', (select jsonb_agg(jsonb_build_object(
                           'capability', mr.capability,
                           'gap', mr.gap_severity,
                           'cells', (select jsonb_agg(jsonb_build_object(
                                              'subject', coalesce(co.name, m.us_label),
                                              'status', case when cell.status = 'wip' then 'in_flight'
                                                             when cell.note = 'beta' then 'beta'
                                                             else cell.status end,
                                              'sources', coalesce(
                                                (select jsonb_agg(l.source_id order by src.cite_no)
                                                   from ouroboros.matrix_cell_sources l
                                                   join ouroboros.source_records src on src.id = l.source_id
                                                  where l.cell_id = cell.id), '[]'::jsonb))
                                            order by coalesce(array_position(m.rivals, cell.competitor_id), 0))
                                       from ouroboros.matrix_cells cell
                                       left join ouroboros.competitors co on co.id = cell.competitor_id
                                      where cell.row_id = mr.id))
                         order by mr.sort_order)
                    from ouroboros.matrix_rows mr where mr.matrix_id = m.id),
         'epic', 'Docking parity',
         'tickets', (select jsonb_agg(jsonb_build_object(
                              'key', t.key, 'title', t.title, 'effort', t.effort,
                              'capability', t.capability,
                              'sources', (select jsonb_agg(src.id order by src.cite_no)
                                            from ouroboros.source_records src
                                           where src.investigation_id = m.investigation_id
                                             and src.cite_no = any (t.cites)))
                            order by t.n)
                       from (values
                         (1, 'DOCK-1', 'wind-feedforward MPC',               'm', 'Docking in >8 m/s gusts',              array[12, 31]),
                         (2, 'DOCK-2', 're-planned retry',                   'm', 'Abort & retry recovery logic',         array[9, 19]),
                         (3, 'DOCK-3', 'gust estimator from IMU residuals',  'm', 'Docking in >8 m/s gusts',              array[25]),
                         (4, 'DOCK-4', 'visual-inertial approach prototype', 'l', 'Visual-inertial approach (no beacon)', array[2]),
                         (5, 'DOCK-5', 'HIL gust-profile regression suite',  's', 'Docking in >8 m/s gusts',              array[26])
                       ) as t (n, key, title, effort, capability, cites))),
       brief.created_at
  from ouroboros.capability_matrices m
  join ouroboros.briefs brief on brief.investigation_id = m.investigation_id and brief.version = 1
 where m.id = '5eed0095-0000-4000-8000-000000000127'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The regression watch: release baselines over HIL case metrics, and the card's three items.
-- ---------------------------------------------------------------------------
insert into ouroboros.regression_baselines (id, organization_id, repo_ref, release_tag, metric_source,
                                            metric_key, metric_class, "window", captured_via, captured_at)
select b.id, org."id", 'acme-robotics/helios-firmware', b.release_tag, 'case_metric',
       ouroboros.test_case_key(repo.id, 'hil', b.classname, b.case_name) || ':' || b.metric,
       b.metric_class,
       jsonb_build_object('n', b.n, 'median', b.median, 'spread', b.spread, 'spread_kind', 'iqr',
                          'unit', b.unit,
                          'from', to_char((now() - make_interval(days => b.days_ago + 7)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'to',   to_char((now() - make_interval(days => b.days_ago)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       'release', now() - make_interval(days => b.days_ago)
  from (values
    ('5eed0096-0000-4000-8000-000000000001'::uuid, 'v2.0.4',     'nav.hover',          'gust_hold_8ms',        'hover_drift_cm',   'accuracy', 48, 31.0,  4.2, 'cm', 70),
    ('5eed0096-0000-4000-8000-000000000002'::uuid, 'v2.1.0-rc1', 'boot.cold_start',    'cold_boot_to_ready',   'boot_time_ms',     'timing',   30, 4120,  35,  'ms', 30),
    ('5eed0096-0000-4000-8000-000000000003'::uuid, 'v2.0.4',     'power.battery_soc',  'soc_estimate_vs_coulomb', 'soc_error_pct', 'accuracy', 60, 2.1,   0.4, '%',  70)
  ) as b (id, release_tag, classname, case_name, metric, metric_class, n, median, spread, unit, days_ago)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs gh    on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.regression_watch_items (id, organization_id, baseline_id, current, drift_value,
                                              drift_unit, severity, detected_at)
select i.id, b.organization_id, b.id,
       b."window" || jsonb_build_object('n', i.n, 'median', i.median, 'spread', i.spread,
                                        'from', to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                        'to',   to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       i.drift_value, i.drift_unit, i.severity, now() - make_interval(days => i.days_ago)
  from (values
    ('5eed0096-0000-4000-8000-000000000101'::uuid, '5eed0096-0000-4000-8000-000000000001'::uuid, 14,   35.3, 4.6, 14,   '%',  'err', 6),
    ('5eed0096-0000-4000-8000-000000000102'::uuid, '5eed0096-0000-4000-8000-000000000002'::uuid, 14,   4350, 38,  230,  'ms', 'warn', 4),
    ('5eed0096-0000-4000-8000-000000000103'::uuid, '5eed0096-0000-4000-8000-000000000003'::uuid, 14,   4.9,  0.5, 2.8,  '%',  'err', 25)
  ) as i (id, baseline_id, n, median, spread, drift_value, drift_unit, severity, days_ago)
  join ouroboros.regression_baselines b on b.id = i.baseline_id
 where ${ouro_dev_seed}
on conflict do nothing;

-- Each item through the lifecycle, one guarded step at a time.
update ouroboros.regression_watch_items set status = 'bisecting'
 where id in ('5eed0096-0000-4000-8000-000000000101', '5eed0096-0000-4000-8000-000000000102',
              '5eed0096-0000-4000-8000-000000000103')
   and status = 'detected'
   and ${ouro_dev_seed};

update ouroboros.regression_watch_items item
   set status = 'bisected',
       bisect_result = jsonb_build_object(
         'culprit_sha', s.sha,
         'farm_job_ids', (select jsonb_agg(j.id order by j.number)
                            from (select bj.id, bj.number from ouroboros.build_jobs bj
                                   where bj.organization_id = item.organization_id
                                   order by bj.number limit s.steps) j),
         'steps', s.steps,
         'confidence_basis', jsonb_build_object('method', 'git_bisect_hil_replay',
                                                'inputs', jsonb_build_object('replays_per_step', 3,
                                                                             'range', s.range)))
  from (values
    ('5eed0096-0000-4000-8000-000000000101'::uuid, 'a41f2c9' || '5d0b7e31c8a64f20e9d1b37c55a8f06e2', 5, 'v2.0.4..HEAD'),
    ('5eed0096-0000-4000-8000-000000000102'::uuid, '7c03d1e' || '4a92f6b08e31d57c2a9b40f61e7d38c05', 4, 'v2.1.0-rc1..HEAD'),
    ('5eed0096-0000-4000-8000-000000000103'::uuid, 'e19b6a4' || '07c3d85f2b6e1a94c0d7f38b25e61a9c4', 5, 'v2.0.4..v2.1.0-rc1')
  ) as s (id, sha, steps, range)
 where item.id = s.id
   and item.status = 'bisecting'
   and ${ouro_dev_seed};

update ouroboros.regression_watch_items item
   set status = 'fix_drafted',
       fix_ticket_ref = jsonb_build_object('kind', 'ticket', 'id', t.id, 'key', t.external_key)
  from (values ('5eed0096-0000-4000-8000-000000000101'::uuid, '5eed008e-0000-4000-8000-000000000512'::uuid),
               ('5eed0096-0000-4000-8000-000000000102'::uuid, '5eed008e-0000-4000-8000-000000000517'::uuid),
               ('5eed0096-0000-4000-8000-000000000103'::uuid, '5eed008e-0000-4000-8000-000000000639'::uuid)) as f (item_id, ticket_id)
  join ouroboros.tickets t on t.id = f.ticket_id
 where item.id = f.item_id
   and item.status = 'bisected'
   and ${ouro_dev_seed};

update ouroboros.regression_watch_items set status = 'fix_running'
 where id in ('5eed0096-0000-4000-8000-000000000101', '5eed0096-0000-4000-8000-000000000103')
   and status = 'fix_drafted'
   and ${ouro_dev_seed};

-- PR #641, merged — the battery fix.
insert into ouroboros.pull_requests (id, organization_id, source_id, external_number, external_url, title,
                                     head_branch, base_branch, ticket_id, state, merged_at,
                                     additions, deletions, changed_files, created_at)
select '5eed0098-0000-4000-8000-000000000641'::uuid, org."id", src.id, 641,
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/pull/641',
       'power: restore coulomb-count weighting in the SoC estimator (#639)', 'loop/639', 'main',
       '5eed008e-0000-4000-8000-000000000639'::uuid, 'merged', now() - interval '10 days', 38, 12, 3,
       now() - interval '12 days'
  from ouroboros.organization org
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.regression_watch_items
   set status = 'fixed_merged', severity = 'ok',
       pr_ref = '{"pull_request_id": "5eed0098-0000-4000-8000-000000000641", "key": "#641"}'
 where id = '5eed0096-0000-4000-8000-000000000103'
   and status = 'fix_running'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- RS-124's ROADMAP.md: version 1, committed, and its two open suggestions.
-- ---------------------------------------------------------------------------
insert into ouroboros.roadmap_docs (id, organization_id, investigation_id, title, target_source_id,
                                    batch_id, created_at)
select '5eed0097-0000-4000-8000-000000000124'::uuid, inv.organization_id, inv.id,
       'Helios — Q' || extract(quarter from now()) || ' Improvement Roadmap',
       -- The repository ROADMAP.md lives in and the tracker #742…#747 were filed to, and the
       -- batch create-issues composed (#624) — so a re-run finds its drafts.
       batch.target_source_id, batch.id, inv.created_at + interval '1 hour'
  from ouroboros.investigations inv
  join ouroboros.draft_batches batch on batch.id = '5eed0090-0000-4000-8000-000000000124'
                                    and batch.organization_id = inv.organization_id
 where inv.id = '5eed0091-0000-4000-8000-000000000124'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.roadmap_doc_versions (id, doc_id, version, structure, markdown, generated_by,
                                            repo_projection, created_at)
with items (n, ms, ms_name, target_days, key, title, mvp, effort, checked) as (values
  (742, 'm1', 'Docking parity',    14, 'dock-mpc',       'Wind-feedforward MPC in final approach', true,  'l',  true),
  (743, 'm1', 'Docking parity',    14, 'dock-retry',     'Re-planned abort & retry vectors',       true,  'm',  false),
  (744, 'm1', 'Docking parity',    14, 'dock-gust',      'Gust estimator from IMU residuals',      false, 'm',  false),
  (745, 'm2', 'Fleet reliability', 50, 'fleet-battery',  'Battery health model v2',                false, 'm',  false),
  (746, 'm2', 'Fleet reliability', 50, 'fleet-gaps',     'Telemetry gap alerts',                   false, 's',  false),
  (747, 'm2', 'Fleet reliability', 50, 'fleet-playbook', 'Operator recovery playbook docs',        false, 'xs', false))
select '5eed0097-0000-4000-8000-000000001001'::uuid, doc.id, 1,
       jsonb_build_object('milestones', (
         select jsonb_agg(jsonb_build_object('key', ms.key, 'name', ms.name,
                                             'target_date', to_char(ms.target, 'YYYY-MM-DD'),
                                             'items', ms.items) order by ms.key)
           from (select it.ms as key, max(it.ms_name) as name,
                        date_trunc('quarter', now()) + make_interval(days => max(it.target_days)) as target,
                        jsonb_agg(jsonb_build_object(
                          'key', it.key, 'title', it.title,
                          'draft_id', '5eed0090-0000-4000-8000-000000001' || it.n,
                          'ticket_id', '5eed008e-0000-4000-8000-000000000' || it.n,
                          'ticket_key', '#' || it.n,
                          'mvp', it.mvp, 'effort', it.effort, 'checked', it.checked) order by it.n) as items
                   from items it group by it.ms) ms)),
       '# ' || doc.title || chr(10) || chr(10)
         || (select string_agg(section, chr(10) order by ms)
               from (select it.ms,
                            '## ' || upper(it.ms) || ' · ' || max(it.ms_name) || ' — target '
                              || to_char(date_trunc('quarter', now()) + make_interval(days => max(it.target_days)), 'Mon FMDD')
                              || chr(10)
                              || string_agg('- [' || case when it.checked then 'x' else ' ' end || '] #' || it.n
                                              || ' ' || it.title
                                              || case when it.mvp then ' `MVP`' else '' end
                                              || ' `' || upper(it.effort) || '`',
                                            chr(10) order by it.n)
                              || chr(10) as section
                       from items it group by it.ms) sections),
       'create-roadmap@rs-124',
       '{"state": "committed", "path": "docs/ROADMAP.md", "pr_ref": null, "committed_sha": "8c1b2e4", "observed_sha": null}',
       doc.created_at
  from ouroboros.roadmap_docs doc
 where doc.id = '5eed0097-0000-4000-8000-000000000124'
   and not exists (select 1 from ouroboros.roadmap_doc_versions v where v.doc_id = doc.id)
   and ${ouro_dev_seed}
on conflict do nothing;

-- The batch create-issues composed carries what the pipeline writes on each draft (#624, V125):
-- which roadmap item it is, the item's milestone and due date, and `mvp` as a label — written
-- after the document, which is where the items are read from, and only where nothing is set.
update ouroboros.ticket_drafts d
   set research_provenance = jsonb_build_object(
         'investigation_id', doc.investigation_id, 'origin', 'roadmap',
         'capability', null, 'severity', null, 'item_key', item ->> 'key',
         'effort', item -> 'effort', 'sources', '[]'::jsonb),
       milestone_name = ms ->> 'name',
       milestone_due  = (ms ->> 'target_date')::date,
       labels         = case when (item ->> 'mvp')::boolean then '["mvp"]'::jsonb else '[]'::jsonb end
  from ouroboros.roadmap_docs doc
  join ouroboros.roadmap_doc_versions v on v.doc_id = doc.id and v.version = 1
  cross join lateral jsonb_array_elements(v.structure -> 'milestones') ms
  cross join lateral jsonb_array_elements(ms -> 'items') item
 where doc.id = '5eed0097-0000-4000-8000-000000000124'
   and d.id = (item ->> 'draft_id')::uuid
   and d.research_provenance is null
   and ${ouro_dev_seed};

insert into ouroboros.doc_suggestions (id, doc_id, author_kind, author_user_id, author_agent, text, hint, created_at)
select s.id, doc.id, s.kind, case when s.kind = 'user' then ken."id" end, s.agent, s.text, s.hint::jsonb,
       doc.created_at + s.after
  from (values
    ('5eed0097-0000-4000-8000-000000002001'::uuid, 'user', null,
     'Pull #744 into the M1 MVP set — churn interviews rank gust handling above battery accuracy.',
     '{"item": "dock-gust", "change": "mvp", "to": true}', interval '2 days'),
    ('5eed0097-0000-4000-8000-000000002002'::uuid, 'ai', 'create-roadmap',
     'Split #745 — complexity is high for a single loop; model + calibration land better as two issues.',
     '{"item": "fleet-battery", "change": "split", "into": ["Battery health model v2", "Battery model calibration"]}', interval '3 days')
  ) as s (id, kind, agent, text, hint, after)
  join ouroboros.roadmap_docs doc on doc.id = '5eed0097-0000-4000-8000-000000000124'
  join ouroboros."user" ken       on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The history index's corpus (#618, CL.5): the support desk RS-124 read, as canonical tickets,
-- and the churn interviews mockup 22 cites as [19].
--
-- The 312 tickets are the ones RS-124's ledger cites (`issue-index://support/SUP-3001`…), in a
-- second, `custom`-kind source named `Support` — so the index's locator for each is the ledger's,
-- and `aggregate` over the source's labels reproduces the seven themes. The source is `paused`:
-- nothing syncs it; its tickets are `closed`, opened inside the last 90 days and touched inside
-- the last 30, so no open-ticket or stale-ticket count on another page moves.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_sources (id, organization_id, kind, display_name, config, status)
select '5eed0099-0000-4000-8000-000000000001'::uuid, org."id", 'custom', 'Support', '{}'::jsonb,
       'paused'
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select ('5eed0099-0000-4000-8000-0001' || lpad(n::text, 8, '0'))::uuid,
       src.organization_id, src.id, 'SUP-' || (3000 + n), 'SUP-' || (3000 + n),
       'https://support.acme-robotics.dev/tickets/SUP-' || (3000 + n),
       initcap(left(theme.subject, 1)) || substr(theme.subject, 2), theme.excerpt,
       'closed', jsonb_build_array(theme.key, 'support'), 'field-support',
       now() - make_interval(days => 30 + (n % 55)),
       now() - make_interval(days => 1 + (n % 25)),
       now() - interval '1 day',
       'unsized', '{}'::jsonb
  from generate_series(1, 312) as n
  join (values
    (0, 'docking',     'docking aborts in wind',              'Customer reports the unit aborting docking in moderate wind and waiting at loiter.'),
    (1, 'battery',     'battery estimate wrong in the cold',  'Remaining-flight estimate drops sharply on cold mornings.'),
    (2, 'telemetry',   'telemetry gaps during missions',      'Fleet dashboard shows gaps of several minutes mid-mission.'),
    (3, 'ota',         'update interrupted or failed',        'An interrupted update left the unit needing a manual recovery.'),
    (4, 'recovery',    'no clear recovery procedure',         'Operator did not know how to recover the unit after an abort.'),
    (5, 'gusts',       'unstable hover in gusts',             'Unit drifts noticeably in gusty conditions during inspection hovers.'),
    (6, 'pairing',     'console pairing drops',               'Console loses pairing after the unit sleeps.')
  ) as theme (slot, key, subject, excerpt) on theme.slot = n % 7
  join ouroboros.ticket_sources src on src.id = '5eed0099-0000-4000-8000-000000000001'::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- Mockup 22's [19]: fourteen exit interviews, nine of which name docking reliability.
insert into ouroboros.document_imports (id, organization_id, collection, name, title, description,
                                        format, content_hash, imported_by, created_at)
select '5eed009a-0000-4000-8000-000000000001'::uuid, org."id", 'support', 'churn-2026-q2',
       'Support churn interviews Q2',
       'Exit interviews with the 14 accounts that churned in Q2 2026. 9 of 14 cite docking reliability; several said the drone "gives up" after one abort.',
       'csv',
       'sha256:' || encode(sha256(convert_to('dev-seed:support/churn-2026-q2', 'UTF8')), 'hex'),
       ken."id", now() - interval '20 days'
  from ouroboros.organization org
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.document_import_items (id, import_id, organization_id, position, item_key,
                                             title, body, labels, occurred_at, meta)
select ('5eed009a-0000-4000-8000-0001' || lpad(doc.n::text, 8, '0'))::uuid,
       imp.id, imp.organization_id, doc.n, 'acct-' || lpad(doc.n::text, 2, '0'),
       'Churn interview — ' || doc.account, doc.body, doc.labels::jsonb,
       doc.held::timestamptz,
       jsonb_build_object('account', doc.account, 'seats', doc.seats)
  from (values
    (1,  'Northwind Survey',    '12', '2026-04-08', '["docking"]',
     'Docking reliability was the reason. In anything above a light breeze the drone aborts the approach and gives up — it sits at loiter until someone flies it in by hand.'),
    (2,  'Harbor Inspection',   '30', '2026-04-14', '["docking", "recovery"]',
     'Coastal sites are windy every afternoon. The drone gives up after one docking abort, and nobody on site knew the recovery procedure.'),
    (3,  'Cascade Timber',      '6',  '2026-04-21', '["battery"]',
     'Battery estimates were wrong on cold mornings; two missions ended early and we lost trust in the remaining-flight number.'),
    (4,  'Meridian Rail',       '18', '2026-04-29', '["docking"]',
     'Docking aborts in gusts along the embankments. A competitor retries the approach; ours does not.'),
    (5,  'Polar Logistics',     '9',  '2026-05-04', '["docking", "battery"]',
     'Docking reliability first, cold-weather battery second. An aborted docking in the cold usually meant a dead unit by the time we reached it.'),
    (6,  'Vantage Agritech',    '22', '2026-05-11', '["telemetry"]',
     'Telemetry gaps of several minutes made the fleet dashboard useless for our compliance reports.'),
    (7,  'Ridgeline Utilities', '40', '2026-05-15', '["docking", "gusts"]',
     'Docking reliability on ridge sites. The approach is unstable in gusts and the drone gives up rather than re-plan.'),
    (8,  'Bluewater Ports',     '15', '2026-05-20', '["docking"]',
     'We need unattended docking. One abort and it waits at loiter until the battery forces a landing.'),
    (9,  'Summit Mapping',      '4',  '2026-05-27', '["pricing"]',
     'Budget. The product worked for us; the seat price did not survive our renewal review.'),
    (10, 'Ironbridge Works',    '11', '2026-06-02', '["docking", "recovery"]',
     'Docking reliability, and no clear recovery procedure after an abort — operators improvised every time.'),
    (11, 'Tidewater Energy',    '27', '2026-06-09', '["docking"]',
     'Offshore wind is constant. Docking aborts were daily and the unit never retried on its own.'),
    (12, 'Greenfield Co-op',    '5',  '2026-06-12', '["ota"]',
     'An interrupted update left two units needing manual recovery in the middle of harvest.'),
    (13, 'Kestrel Security',    '14', '2026-06-18', '["docking", "pairing"]',
     'Docking reliability at night patrol sites, and the console lost pairing whenever a unit slept.'),
    (14, 'Lakeshore Transit',   '8',  '2026-06-24', '["pairing"]',
     'Console pairing dropped several times a week; we moved to a vendor with a wired dock.')
  ) as doc (n, account, seats, held, labels, body)
  join ouroboros.document_imports imp on imp.id = '5eed009a-0000-4000-8000-000000000001'::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The pipeline's two skills — the card's `skill · create-roadmap` → `skill · create-issues`
-- chips (#624, CM.5).
--
-- Registry skills like any other (V069), `origin = generated`: the text below is what
-- ouroboros-rest writes for a workspace that has neither (`pipeline.skills.ts`, whose spec
-- compares the two), published by nobody. A workspace changes what the pipeline runs by
-- publishing its own version. `on_trigger` with the slug as the only trigger, so neither is
-- injected into an ordinary run.
-- ---------------------------------------------------------------------------
insert into ouroboros.skills (id, organization_id, slug, name, description, scope,
                              enabled, required, draft, origin, created_at)
select ('5eed009b-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.slug, seed.slug, seed.description, 'org', true, false, false, 'generated',
       now() - interval '30 days'
  from (values
         (1, 'create-roadmap', 'Turn a research brief into ROADMAP.md: dated milestones of buildable items'),
         (2, 'create-issues', 'Write the issue for each roadmap item; the estimator sizes it when filed')
       ) as seed (ordinal, slug, description)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.skill_versions (id, skill_id, version, body, frontmatter, published_at,
                                      published_by, change_note, created_at, updated_at)
select ('5eed009b-0000-4000-8000-' || lpad((1000 + seed.ordinal)::text, 12, '0'))::uuid,
       skill.id, 1, seed.body,
       jsonb_build_object('name', skill.slug, 'description', skill.description, 'scope', 'org',
                          'load', 'on_trigger', 'triggers', jsonb_build_array(skill.slug)),
       skill.created_at + interval '1 day', null, 'Shipped procedure',
       skill.created_at + interval '1 day', skill.created_at + interval '1 day'
  from (values
         (1, $skill$# create-roadmap

Turn a research brief into a roadmap: dated milestones, each a short list of items a loop can build.

## Inputs

- `brief` — the brief, exported as Markdown with its numbered sources.
- `outline` — the investigation's own roadmap input (themes and proposed milestones), when it produced one.
- `previous` — the roadmap this run replaces, when there is one.
- `suggestions` — changes people or the product asked for, oldest first.
- `today` — the date of the run.

## Procedure

1. Read the brief's findings and group them into themes. Leave open questions out: an item needs a finding behind it.
2. Order the themes by how strongly the sources support them, then by what the earlier ones unblock.
3. Cut milestones: each one is an outcome a customer would notice, two to five items, with a target date after `today`. Earlier milestones carry the MVP set.
4. Write each item as one buildable change — a title a ticket could carry. Mark it `mvp` when the milestone's outcome fails without it. Guess an effort (`xs` to `xl`) only when the brief gives grounds for one.
5. When `previous` is present, start from it: keep what the brief still supports, and keep the key of every milestone and item that survives.
6. Apply every entry of `suggestions`, in order. A suggestion that contradicts the brief still wins — a person asked for it.

## Rules

- Never invent a customer, a number or a date the brief does not support.
- A title names the change, not the problem: "Gust estimator from IMU residuals", not "Docking is unreliable".
- At most 50 milestones and 500 items.
$skill$),
         (2, $skill$# create-issues

Write the issue for each roadmap item, so that a loop — or a person — can pick it up without reading the brief.

## Inputs

- `roadmap` — the title and the milestones the items belong to.
- `items` — the items to describe: `key`, `title`, `milestone`, `mvp`, `effort`.
- `brief` — the brief the roadmap was generated from, with its numbered sources.

## Procedure

For every item, write a description with these sections:

1. **Problem** — what a customer or operator meets today, citing the brief's findings by source number.
2. **Scope** — what changes, and what is deliberately left out.
3. **Acceptance criteria** — a checklist a reviewer can verify.
4. **Dependencies** — other items of this roadmap it needs, by title.

## Rules

- One description per item, and none for anything else.
- Do not write an estimate, a date, an effort or a complexity: the estimator sizes every issue when it is filed.
- Do not restate the title as the first line.
$skill$)
       ) as seed (ordinal, body)
  join ouroboros.skills skill on skill.id = ('5eed009b-0000-4000-8000-'
                                             || lpad(seed.ordinal::text, 12, '0'))::uuid
 where not exists (select 1 from ouroboros.skill_versions prior where prior.skill_id = skill.id)
   and ${ouro_dev_seed}
 order by seed.ordinal
on conflict do nothing;

update ouroboros.skills skill
   set current_version = 1
 where skill.id in ('5eed009b-0000-4000-8000-000000000001', '5eed009b-0000-4000-8000-000000000002')
   and skill.current_version is null
   and exists (select 1 from ouroboros.skill_versions v where v.skill_id = skill.id and v.version = 1)
   and ${ouro_dev_seed};
