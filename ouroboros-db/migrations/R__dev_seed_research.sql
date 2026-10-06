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
--     The other 39 are **placeholders and say so in their titles**: the full 44-source ledger is
--     CK.6's (#613), which replaces them.
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
       'user', ken."id", now() - interval '2 days'
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
-- The ledger: 44 sources, numbered 1…44 in order. The five featured ones verbatim; the rest
-- placeholders until #613.
-- ---------------------------------------------------------------------------
insert into ouroboros.source_records (id, investigation_id, tool_slug, kind, title, locator,
                                      retrieved_at, content_hash, excerpt, meta, cite_no, cite_key)
select ('5eed0085-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, inv.id,
       coalesce(f.tool_slug, 'web'), coalesce(f.kind, 'web'),
       coalesce(f.title, 'RS-127 ledger entry ' || lpad(n::text, 2, '0') || ' — placeholder until #613 seeds the full ledger'),
       coalesce(f.locator, 'https://research.example.com/rs-127/source-' || lpad(n::text, 2, '0')),
       now() - interval '2 days' - make_interval(mins => 44 - n),
       'sha256:' || encode(sha256(convert_to(coalesce(f.excerpt, 'Placeholder extract for RS-127 ledger entry ' || lpad(n::text, 2, '0') || '.'), 'UTF8')), 'hex'),
       coalesce(f.excerpt, 'Placeholder extract for RS-127 ledger entry ' || lpad(n::text, 2, '0') || '.'),
       coalesce(f.meta, '{"placeholder": true}'::jsonb), n, f.cite_key
  from generate_series(1, 44) as n
  left join (values
    (7, 'web', 'web', 'Skylink S4 docking module — teardown & sensor BOM',
     'https://droneanalysts.example.com/s4-teardown',
     'The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder — the same sensor class as Helios.',
     '{"query": "skylink s4 docking teardown sensor bom"}'::jsonb, null::text),
    (12, 'competitor', 'web', 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
     'https://skylink.example.com/releases/6.2',
     'Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.',
     '{"watch": "skylink-releases"}'::jsonb, null),
    (19, 'tickets', 'ticket', 'Churn interviews Q2 — 9 of 14 cite docking reliability',
     'issue-index://support/churn-2026-q2',
     '9 of 14 churned accounts named docking reliability; several said the drone "gives up" after one abort.',
     '{"index": "support", "cluster": "churn-2026-q2", "tickets": 14}'::jsonb, null),
    (31, 'web', 'doc', '"MPC for precision landing in turbulent flow" — conf. paper',
     'https://arxiv.example.org/abs/2605.11423',
     'Wind-feedforward MPC reduced touchdown error in gusts relative to fixed-gain PID.',
     '{"query": "mpc precision landing turbulent flow"}'::jsonb, null),
    (44, 'code', 'code', 'dock_ctrl.c blame — gains last tuned 14 months ago',
     'git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214',
     'dock_ctrl.c:214  static const float kp = 1.8f, ki = 0.05f, kd = 0.4f;  /* fixed gains */',
     '{"repo": "helios-firmware", "sha": "8c1b2e4", "path": "src/dock/dock_ctrl.c", "lines": [214, 214]}'::jsonb,
     'git')
  ) as f (cite_no, tool_slug, kind, title, locator, excerpt, meta, cite_key) on f.cite_no = n
  join ouroboros.investigations inv on inv.id = '5eed0084-0000-4000-8000-000000000127'
 where not exists (select 1 from ouroboros.source_records s where s.investigation_id = inv.id)
   and ${ouro_dev_seed}
 order by n
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
       now() - interval '2 days'
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
