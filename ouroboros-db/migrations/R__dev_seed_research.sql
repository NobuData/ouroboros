-- R__dev_seed_research.sql — mockup 22's featured investigation, RS-127, with its citation ledger
-- and its brief, in a development database and nowhere else (#609, CK.2).
--
-- [`docs/mockups/22-research.html`](../../docs/mockups/22-research.html) features one finished
-- gap analysis — *RS-127 — Autonomous docking vs. the field*, `44 sources · deep dive`, `✓ brief
-- ready` — and beside its brief a sources card, `SOURCES — 44 CITED`, that lists five of them:
--
--   [07]  Skylink S4 docking module — teardown & sensor BOM       droneanalysts.example.com/s4-teardown
--   [12]  Skylink firmware 6.2 release notes — "gust-adaptive …"   skylink.example.com/releases/6.2
--   [19]  Churn interviews Q2 — 9 of 14 cite docking reliability    issue-index://support/churn-2026-q2
--   [31]  "MPC for precision landing in turbulent flow" — conf. …   arxiv.example.org/abs/2605.11423
--   [git] dock_ctrl.c blame — gains last tuned 14 months ago       helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c
--
-- This file writes exactly that, as rows V108 (#609) holds to its rules:
--
--   * **RS-127** in `acme-robotics` — the gap_analysis kind V106 gave the workspace, deep dive,
--     five tools, `brief_ready`, started by Ken. `seq` 127 is supplied; V106 keeps it and moves the
--     workspace's counter past it.
--   * **Its estimate and the reconciliation** (#622, CM.3) — `est. 40–60 sources · ~$6` as the
--     calibration-v1 estimate it was started under, and the V109 outcome row comparing it with
--     what it used. See the section after RS-127 for the arithmetic.
--   * **A dense ledger of 44.** Cite numbers are dense by rule, so `[07]`, `[12]`, `[19]` and `[31]`
--     can only exist with the numbers around them. The five featured sources are verbatim — titles
--     and locators as the card prints them (the card drops the `https://` scheme, and renders the
--     `git://` locator as `repo @ sha · path`); `[git]` is source 44 with the symbolic key `git`.
--     The other 39 are the rest of the investigation's reading (#613, CK.6): rival spec sheets and
--     reviews, papers and standards, field telemetry over the docking metrics, support tickets and
--     the docking controller's history — every kind the five tools produce but `competitor_diff`,
--     whose snapshot is the competitor registry's (R__dev_seed_workspace_research.sql) and is
--     written after this file. A database seeded before #613 keeps the placeholders it was given:
--     the ledger is written only into an investigation that has none, and a ledger is never edited.
--   * **The brief, version 1** — mockup 22's paragraph as structured spans, each claim span a
--     `finding` linked to the sources its markers name: `[07]`, `[12][31]`, `[git]`, `[19]`. The
--     closing estimate is a plain span: it states no claim, so it carries no marker.
--
-- **The counts are not written down.** `44 sources` is the number of rows, `[07]` is a stored
-- cite number, and a marker is a link — tests/seed.sql reads them back.
--
-- Every statement carries `${ouro_dev_seed}`, so it cannot run in production, and every insert
-- ends `on conflict do nothing`. The ledger and the brief are guarded beyond that: V108 checks a
-- cite number and a brief version *before* a conflict is looked for, so they are written only
-- into an investigation that has none, and a second application writes nothing.
--
-- Ids: `5eed0084` the investigation, `5eed0085` its sources, `5eed0086` the brief, `5eed0087`
-- the claims. The workspace and Ken are found by natural key.

-- ---------------------------------------------------------------------------
-- RS-127.
-- ---------------------------------------------------------------------------
insert into ouroboros.investigations (id, organization_id, kind_id, seq, question, depth,
                                      tools_enabled, status, estimate,
                                      estimate_calibration_version, actuals, provenance, origin,
                                      created_by, created_at)
select '5eed0084-0000-4000-8000-000000000127'::uuid, org."id", kind.id, 127,
       'Autonomous docking vs. Skylink / AeroMesh / Novum', 'deep_dive',
       '["web", "competitor", "code", "tickets", "telemetry"]', 'brief_ready',
       '{"sources": {"min": 40, "max": 60}, "cost_cents": {"min": 522, "max": 687}}', 1,
       '{"sources_used": 44, "spend_cents": 612, "duration_ms": 1860000}',
       '{"researcher": "loop-v1", "alias": "researcher-long-ctx", "resolution_ref": null}',
       'user', ken."id", greatest(date_trunc('quarter', now()), now() - interval '2 days')
  from ouroboros.organization org
  join ouroboros.investigation_kinds kind on kind.organization_id = org."id" and kind.slug = 'gap_analysis'
  join ouroboros."user" ken                on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RS-127's estimate, and its reconciliation against what it used (#622, CM.3).
--
-- The composer showed `est. 40–60 sources · ~$6` before RS-127 started, and V5 says that line is
-- computed: it is what CM.3's estimator, **calibration v1**, answers for this investigation's
-- inputs — deep dive × [web, competitor, code, tickets, telemetry] × `researcher-long-ctx` at the
-- catalog's 300¢ · 1500¢ per 1M tokens:
--
--   operations  = (3 + 2 + 2 + 2 + 1 per round) × 4 deep-dive rounds        = 40
--   sources     = 40 × 1.0 … 40 × 1.5                                         = 40–60
--   digest call = 20 000 in × 300¢/1M + 1 500 out × 1500¢/1M                  = 8.25¢
--   synthesis   = 4 passes × (120 000 in × 300¢/1M + 8 000 out × 1500¢/1M)    = 4 × 48¢ = 192¢
--   cost        = 40 × 8.25 + 192 … 60 × 8.25 + 192                           = 522–687¢
--
-- The midpoint, 604.5¢, is the `~$6`. These figures are stored because an estimate is a record of
-- what was said *before* the run — not recomputed, since the constants will move — and
-- ouroboros-rest's estimator tests assert that calibration v1 reproduces them exactly.
--
-- The insert above carries them for a database migrated from empty; this update gives them to an
-- RS-127 an earlier application of this file already wrote, and touches nothing else. Then the
-- reconciliation: actuals of 44 sources and 612¢ land inside both ranges, and the outcome row
-- records that. record_investigation_estimate_outcome() is idempotent, so a reapplication
-- re-derives the same row.
-- ---------------------------------------------------------------------------
update ouroboros.investigations inv
   set estimate = '{"sources": {"min": 40, "max": 60}, "cost_cents": {"min": 522, "max": 687}}',
       estimate_calibration_version = 1
 where inv.id = '5eed0084-0000-4000-8000-000000000127'::uuid
   and inv.estimate is null
   and ${ouro_dev_seed};

select count(outcome.investigation_id) as reconciled
  from ouroboros.investigations inv
  cross join lateral ouroboros.record_investigation_estimate_outcome(inv.organization_id, inv.id) outcome
 where inv.id = '5eed0084-0000-4000-8000-000000000127'::uuid
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The ledger: 44 sources, numbered 1…44 in order — the five featured ones verbatim ([07], [12],
-- [19], [31] and [git], which is 44), and the rest of RS-127's reading around them (#613).
-- ---------------------------------------------------------------------------
insert into ouroboros.source_records (id, investigation_id, tool_slug, kind, title, locator,
                                      retrieved_at, content_hash, excerpt, meta, cite_no, cite_key)
select ('5eed0085-0000-4000-8000-' || lpad(f.cite_no::text, 12, '0'))::uuid, inv.id,
       f.tool_slug, f.kind, f.title, f.locator,
       inv.created_at + make_interval(mins => f.cite_no),
       'sha256:' || encode(sha256(convert_to(f.excerpt, 'UTF8')), 'hex'),
       f.excerpt, f.meta, f.cite_no, f.cite_key
  from (values
    (1, 'web', 'web', 'Skylink S4 product page — "precision docking in winds up to 12 m/s"',
     'https://skylink.example.com/s4',
     'Precision docking rated to 12 m/s sustained wind, 15 m/s gusts.',
     '{"query": "skylink s4 docking wind rating"}'::jsonb, null::text),
    (2, 'web', 'web', 'Skylink S4 datasheet — navigation & docking',
     'https://skylink.example.com/s4/datasheet.pdf',
     'IMU: 6-axis, 1 kHz. Rangefinder: ToF, 40 m. Docking: visual-inertial approach, no beacon required.',
     '{"query": "skylink s4 datasheet"}'::jsonb, null),
    (3, 'web', 'web', 'AeroMesh Dock 2 launch post — "gust-tolerant landing"',
     'https://aeromesh.example.com/blog/dock-2',
     'Dock 2 adds a gust-tolerant final approach and a second landing attempt before abort.',
     '{"query": "aeromesh dock 2 gust landing"}'::jsonb, null),
    (4, 'web', 'web', 'AeroMesh Dock 2 field review — docking success by wind band',
     'https://dronereview.example.net/aeromesh-dock-2',
     'Docking success 96% below 6 m/s, 81% at 8–10 m/s; no beacon fallback observed.',
     '{"query": "aeromesh dock 2 review wind"}'::jsonb, null),
    (5, 'web', 'web', 'Novum Perch spec sheet',
     'https://novum.example.io/perch/specs',
     'Docking: BLE beacon guided; manual recovery on abort. Visual approach listed as beta.',
     '{"query": "novum perch specs docking"}'::jsonb, null),
    (6, 'web', 'web', 'Novum Perch 1.4 changelog — "visual approach (beta)"',
     'https://novum.example.io/perch/changelog#1.4',
     '1.4: visual approach (beta) behind a feature flag; beacon remains the default.',
     '{"query": "novum perch changelog visual approach"}'::jsonb, null),
    (7, 'web', 'web', 'Skylink S4 docking module — teardown & sensor BOM',
     'https://droneanalysts.example.com/s4-teardown',
     'The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder — the same sensor class as Helios.',
     '{"query": "skylink s4 docking teardown sensor bom"}'::jsonb, null),
    (8, 'web', 'web', 'Drone Analysts — Skylink S4 flight log analysis in crosswind',
     'https://droneanalysts.example.com/s4-crosswind',
     'Final-approach attitude corrections lead the gust by ~120 ms — consistent with feedforward.',
     '{"query": "skylink s4 crosswind flight log"}'::jsonb, null),
    (9, 'competitor', 'web', 'Skylink firmware 6.1 release notes',
     'https://skylink.example.com/releases/6.1',
     '6.1: abort now re-plans the approach vector and retries up to twice.',
     '{"watch": "skylink-releases"}'::jsonb, null),
    (10, 'competitor', 'web', 'Skylink A/B firmware & rollback support article',
     'https://support.skylink.example.com/ota-ab-rollback',
     'Updates install to the inactive slot; a failed boot rolls back automatically.',
     '{"watch": "skylink-support"}'::jsonb, null),
    (11, 'competitor', 'web', 'AeroMesh changelog — Dock 2 firmware 3.2',
     'https://aeromesh.example.com/changelog#3.2',
     '3.2: retry once from a widened approach cone after an aborted landing.',
     '{"watch": "aeromesh-changelog"}'::jsonb, null),
    (12, 'competitor', 'web', 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
     'https://skylink.example.com/releases/6.2',
     'Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.',
     '{"watch": "skylink-releases"}'::jsonb, null),
    (13, 'competitor', 'web', 'Novum investor update Q2 — docking roadmap',
     'https://novum.example.io/investors/2026-q2',
     'Visual-inertial docking targeted for general availability in H1 next year.',
     '{"watch": "novum-filings"}'::jsonb, null),
    (14, 'web', 'doc', '"Wind-disturbance rejection for multirotor landing" — survey',
     'https://arxiv.example.org/abs/2511.03117',
     'Feedforward from estimated wind outperforms gain-scheduled PID above 6 m/s.',
     '{"query": "multirotor landing wind disturbance rejection survey"}'::jsonb, null),
    (15, 'web', 'doc', '"Visual-inertial docking without fiducials" — workshop paper',
     'https://arxiv.example.org/abs/2603.08841',
     'Marker-free VIO docking reached 4 cm touchdown error in field trials.',
     '{"query": "visual inertial docking without fiducials"}'::jsonb, null),
    (16, 'web', 'doc', 'IEC 62443-4-2 — secure update requirements (summary)',
     'https://standards.example.org/iec-62443-4-2/cr-3-10',
     'CR 3.10: support for updates, including authenticated rollback to a known-good image.',
     '{"query": "iec 62443 secure update rollback"}'::jsonb, null),
    (17, 'web', 'doc', 'Bluetooth Core 5.3 — advertising extensions for low-power beacons',
     'https://bluetooth.example.org/core-5.3/advertising',
     'Periodic advertising lets a beacon stay discoverable at under 50 µA average.',
     '{"query": "ble periodic advertising low power beacon"}'::jsonb, null),
    (18, 'tickets', 'ticket', 'Support ticket cluster — "drone gives up after abort"',
     'issue-index://support/cluster-gives-up',
     '38 tickets in 90 days describe the drone hovering at loiter after one aborted docking.',
     '{"index": "support", "cluster": "gives-up", "tickets": 38}'::jsonb, null),
    (19, 'tickets', 'ticket', 'Churn interviews Q2 — 9 of 14 cite docking reliability',
     'issue-index://support/churn-2026-q2',
     '9 of 14 churned accounts named docking reliability; several said the drone "gives up" after one abort.',
     '{"index": "support", "cluster": "churn-2026-q2", "tickets": 14}'::jsonb, null),
    (20, 'tickets', 'ticket', 'Support ticket SUP-2214 — docking aborts on coastal sites',
     'issue-index://support/SUP-2214',
     'Three coastal sites report aborts in afternoon sea breeze; manual recovery each time.',
     '{"index": "support", "key": "SUP-2214"}'::jsonb, null),
    (21, 'tickets', 'ticket', 'Support ticket SUP-2307 — "competitor unit docks in the same wind"',
     'issue-index://support/SUP-2307',
     'Customer runs a Skylink S4 beside Helios; the S4 docks, Helios aborts.',
     '{"index": "support", "key": "SUP-2307"}'::jsonb, null),
    (22, 'tickets', 'ticket', 'Issue #341 — tune docking PID for wind (closed, wontfix)',
     'issue-index://github/helios-firmware/341',
     'Closed: retuning gains moved the failure from aborts to hard touchdowns.',
     '{"index": "github", "repo": "helios-firmware", "number": 341}'::jsonb, null),
    (23, 'tickets', 'ticket', 'Issue #402 — beacon fallback when GPS is degraded',
     'issue-index://github/helios-firmware/402',
     'Beacon-guided approach shipped in v1.9; used on 64% of dockings.',
     '{"index": "github", "repo": "helios-firmware", "number": 402}'::jsonb, null),
    (24, 'tickets', 'ticket', 'Issue #456 — OTA A/B partition layout',
     'issue-index://github/helios-firmware/456',
     'A/B layout merged behind a build flag; rollback path not yet wired to the bootloader.',
     '{"index": "github", "repo": "helios-firmware", "number": 456}'::jsonb, null),
    (25, 'telemetry', 'telemetry', 'Fleet docking success by wind band — 30 days',
     'telemetry://fleet.docking_success/30d',
     'Success 97% below 6 m/s, 74% at 6–8 m/s, 52% above 8 m/s (n = 4,812 dockings).',
     '{"metric": "fleet.docking_success", "window": "30d", "group_by": "wind_band"}'::jsonb, null),
    (26, 'telemetry', 'telemetry', 'Docking abort causes — 30 days',
     'telemetry://fleet.docking_aborts/30d',
     '71% of aborts trigger on lateral error > 0.4 m in the final 2 m.',
     '{"metric": "fleet.docking_aborts", "window": "30d", "group_by": "cause"}'::jsonb, null),
    (27, 'telemetry', 'telemetry', 'Final-approach lateral error vs. gust magnitude — 30 days',
     'telemetry://fleet.approach_lateral_error/30d',
     'Lateral error grows ~0.09 m per m/s of gust above 5 m/s.',
     '{"metric": "fleet.approach_lateral_error", "window": "30d"}'::jsonb, null),
    (28, 'telemetry', 'telemetry', 'Recovery after abort — operator intervention rate',
     'telemetry://fleet.abort_recovery/30d',
     'After an abort, 93% of flights wait at loiter for the operator; 7% retry.',
     '{"metric": "fleet.abort_recovery", "window": "30d"}'::jsonb, null),
    (29, 'telemetry', 'telemetry', 'HIL docking bench — gust profile replay, 8 m/s',
     'telemetry://hil.docking_gust_replay/7d',
     'Bench reproduces the field abort rate at 8 m/s within 4 points.',
     '{"metric": "hil.docking_gust_replay", "window": "7d"}'::jsonb, null),
    (30, 'telemetry', 'telemetry', 'IMU and rangefinder noise floor — fleet vs. datasheet',
     'telemetry://fleet.sensor_noise/30d',
     'IMU and rangefinder noise are within datasheet limits on 99% of units.',
     '{"metric": "fleet.sensor_noise", "window": "30d"}'::jsonb, null),
    (31, 'web', 'doc', '"MPC for precision landing in turbulent flow" — conf. paper',
     'https://arxiv.example.org/abs/2605.11423',
     'Wind-feedforward MPC reduced touchdown error in gusts relative to fixed-gain PID.',
     '{"query": "mpc precision landing turbulent flow"}'::jsonb, null),
    (32, 'web', 'doc', '"Real-time MPC on Cortex-M7" — application note',
     'https://mcu.example.com/an/realtime-mpc-cm7',
     'A 20-step MPC runs at 200 Hz in 1.6 ms on a 480 MHz Cortex-M7.',
     '{"query": "real-time mpc cortex-m7"}'::jsonb, null),
    (33, 'web', 'doc', '"Abort-and-retry policies for autonomous landing" — thesis chapter',
     'https://theses.example.edu/landing-retry/ch4',
     'Re-planned retries recover 80% of aborted landings without an operator.',
     '{"query": "abort retry policy autonomous landing"}'::jsonb, null),
    (34, 'code', 'code', 'dock_ctrl.c — approach state machine, abort branch',
     'git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L310-L342',
     'case DOCK_ABORT: set_mode(LOITER); notify_operator(); /* no retry */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/dock/dock_ctrl.c", "lines": [310, 342]}'::jsonb, null),
    (35, 'code', 'code', 'wind_est.c — wind estimate published but unused by docking',
     'git://helios-firmware@8c1b2e4/src/nav/wind_est.c#L88',
     'wind_est_publish(&est); /* consumed by nav only; dock_ctrl does not subscribe */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/nav/wind_est.c", "lines": [88, 88]}'::jsonb, null),
    (36, 'code', 'code', 'ota/slots.c — A/B slots without bootloader rollback',
     'git://helios-firmware@8c1b2e4/src/ota/slots.c#L41-L57',
     'slot_mark_pending(next); /* TODO(#456): bootloader confirm + rollback */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/ota/slots.c", "lines": [41, 57]}'::jsonb, null),
    (37, 'code', 'code', 'ble/beacon.c — recovery beacon advertising',
     'git://helios-firmware@8c1b2e4/src/ble/beacon.c#L22-L39',
     'beacon_start_periodic(BEACON_INTERVAL_MS); /* recovery beacon, shipped v1.9 */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/ble/beacon.c", "lines": [22, 39]}'::jsonb, null),
    (38, 'code', 'code', 'Docking controller commit history — last 18 months',
     'git://helios-firmware@8c1b2e4/src/dock',
     '11 commits; the last change to gains was 14 months ago; no feedforward term ever added.',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/dock", "log": true}'::jsonb, null),
    (39, 'code', 'code', 'Vision pipeline — no approach-phase consumer',
     'git://helios-firmware@8c1b2e4/src/vision/pipeline.c#L120',
     'pipeline_register(STAGE_OBSTACLES); /* approach-phase VIO not wired */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/vision/pipeline.c", "lines": [120, 120]}'::jsonb, null),
    (40, 'web', 'web', 'Skylink community forum — "S4 docked in a 14 m/s squall"',
     'https://community.skylink.example.com/t/s4-squall/8812',
     'User report: S4 docked on the second attempt in a 14 m/s squall.',
     '{"query": "skylink s4 docking squall"}'::jsonb, null),
    (41, 'web', 'web', 'AeroMesh support — "recovery beacon not supported"',
     'https://support.aeromesh.example.com/kb/beacon',
     'Dock 2 has no BLE recovery beacon; lost units are located through the app only.',
     '{"query": "aeromesh recovery beacon"}'::jsonb, null),
    (42, 'web', 'web', 'Novum Perch teardown — no BLE beacon hardware',
     'https://droneanalysts.example.com/perch-teardown',
     'No BLE radio on the Perch flight controller; docking guidance is optical only.',
     '{"query": "novum perch teardown ble"}'::jsonb, null),
    (43, 'tickets', 'ticket', 'Support ticket cluster — OTA bricked units',
     'issue-index://support/cluster-ota-bricked',
     '12 units bricked by interrupted updates in two quarters; each needed RMA.',
     '{"index": "support", "cluster": "ota-bricked", "tickets": 12}'::jsonb, null),
    (44, 'code', 'code', 'dock_ctrl.c blame — gains last tuned 14 months ago',
     'git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214',
     'dock_ctrl.c:214  static const float kp = 1.8f, ki = 0.05f, kd = 0.4f;  /* fixed gains */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/dock/dock_ctrl.c", "lines": [214, 214]}'::jsonb, 'git')
  ) as f (cite_no, tool_slug, kind, title, locator, excerpt, meta, cite_key)
  join ouroboros.investigations inv on inv.id = '5eed0084-0000-4000-8000-000000000127'::uuid
 where not exists (select 1 from ouroboros.source_records s where s.investigation_id = inv.id)
   and ${ouro_dev_seed}
 order by f.cite_no
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The brief, version 1: mockup 22's paragraph, one span per claim.
-- ---------------------------------------------------------------------------
insert into ouroboros.briefs (id, investigation_id, version, body, created_at)
select '5eed0086-0000-4000-8000-000000000001'::uuid, inv.id, 1,
       '{"paragraphs": [{"spans": [
          {"text": "The docking gap is not sensors: our IMU and rangefinder match Skylink''s published spec.", "claim": "sensors-match"},
          {"text": " It is control — Skylink runs a wind-feedforward MPC in the final 2 m", "claim": "control-mpc"},
          {"text": " while ours is PID with fixed gains (dock_ctrl.c:214, unchanged in 14 months).", "claim": "pid-fixed-gains"},
          {"text": " Their abort logic retries from a re-planned approach vector; ours returns to loiter and waits for the operator — the behavior customers describe as \"giving up.\"", "claim": "abort-gives-up"},
          {"text": " Estimated closure: one epic, 5 tickets, ~3 weeks of loop time on the HIL rig."}]}]}',
       inv.created_at + interval '31 minutes'
  from ouroboros.investigations inv
 where inv.id = '5eed0084-0000-4000-8000-000000000127'
   and not exists (select 1 from ouroboros.briefs b where b.investigation_id = inv.id)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The claims — four findings, each cited below before the transaction commits.
-- ---------------------------------------------------------------------------
insert into ouroboros.brief_claims (id, investigation_id, brief_id, span_ref, claim_type, text, created_at)
select c.id, brief.investigation_id, brief.id, c.span_ref, 'finding', c.text, brief.created_at
  from (values
    ('5eed0087-0000-4000-8000-000000000001'::uuid, 'sensors-match',
     'The docking gap is not sensors: our IMU and rangefinder match Skylink''s published spec.'),
    ('5eed0087-0000-4000-8000-000000000002'::uuid, 'control-mpc',
     'Skylink runs a wind-feedforward MPC in the final 2 m.'),
    ('5eed0087-0000-4000-8000-000000000003'::uuid, 'pid-fixed-gains',
     'Our approach controller is PID with fixed gains, unchanged in 14 months.'),
    ('5eed0087-0000-4000-8000-000000000004'::uuid, 'abort-gives-up',
     'Our abort returns to loiter and waits for the operator — what customers describe as "giving up."')
  ) as c (id, span_ref, text)
  join ouroboros.briefs brief on brief.id = '5eed0086-0000-4000-8000-000000000001'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The citations: [07] · [12][31] · [git] · [19].
-- ---------------------------------------------------------------------------
insert into ouroboros.brief_claim_sources (investigation_id, claim_id, source_id)
select claim.investigation_id, claim.id, source.id
  from (values ('sensors-match', 7), ('control-mpc', 12), ('control-mpc', 31),
               ('pid-fixed-gains', 44), ('abort-gives-up', 19)) as link (span_ref, cite_no)
  join ouroboros.brief_claims claim    on claim.brief_id = '5eed0086-0000-4000-8000-000000000001'
                                      and claim.span_ref = link.span_ref
  join ouroboros.source_records source on source.investigation_id = claim.investigation_id
                                      and source.cite_no = link.cite_no
 where ${ouro_dev_seed}
on conflict do nothing;
