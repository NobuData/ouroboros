-- R__dev_seed_workspace_triage_inbox.sql — mockup 16's Needs-You inbox, as rows, in a development
-- database and nowhere else.
--
-- [`docs/mockups/16-inbox.html`](../../docs/mockups/16-inbox.html) is the moment the inbox exists
-- for: three open decisions, five answered today — one of them by a policy — and a stat card that
-- is the week's arithmetic. This file is that moment, filed into the universe the other seeds
-- already draw, so every card's facts are read from the rows its refs name rather than typed again.
--
-- Filed as issue #460 (BM.4). It fills V093 (decision kinds and items), V095 (resolutions, run
-- blocks, snooze, the weekly metrics) and V097 (the six MVP declarations); V096's tokens and
-- exceptions are probed (tests/inbox-invariants.sql), not seeded — nothing has been clicked yet.
--
-- ---------------------------------------------------------------------------
-- **The mockup's numbers are not the seeded universe's — and the universe wins.**
-- ---------------------------------------------------------------------------
--
-- The issue says each card points at something another seed already holds. Five of those
-- somethings do not exist, and each was decided on #460 rather than guessed:
--
--   | Mockup 16                           | Seeded universe, and what the card reads              |
--   |-------------------------------------|--------------------------------------------------------|
--   | loop #1843 · PR #509 · issue #465   | issue #465 is loop **#1830** → **PR #504** (mockup 02); PR #509 is run #1836's and is never mirrored |
--   | 14/14 checks green                  | #1830 reads **13/14** on the dashboard, so PR #504 has 13 required gates green and `human_approval` pending: the card computes **13/13** |
--   | loop #1851 · issue #479             | issue #479 is loop **#1844**; this file gives it the guardrail stop |
--   | `policy(auto_accept_resize)`        | no policy store names it, so the outcome names the published org policy version it ran under |
--   | PR #514's thermal claim, 34m        | kept as drawn — though PR #514 is minutes old and its thermal criterion is already waived (Ken's `pr_waivers` row, #356) |
--
-- So the cards read `loop #1830 · PR #504 · issue #465 · refactor`, `loop #1844 · issue #479 ·
-- boot/rollback_flag.c` and `PR #514 · verification`. The third card's two mismatches are known and
-- left: a claim-waiver watcher (#461) that ran would close it as `policy(source_resolved)`.
--
-- ---------------------------------------------------------------------------
-- **What the other seeds lacked, and this file adds.**
-- ---------------------------------------------------------------------------
--
--   | Rows                                             | Why                                       | Id prefix  |
--   |--------------------------------------------------|-------------------------------------------|------------|
--   | canonical `tickets` #465, #479, #486, #490        | a ticket ref resolves against `tickets` only (V093); the four existed as run numbers and intake mirrors | `5eed0079…` |
--   | `run_files` — #1830's six, #1844's three          | PR #504's `+214 −180 across 6 files` and the 3-line protected diff are sums of these | `5eed007a…` |
--   | one `guardrail_evaluations` fail on #1844         | the stop **Allow once** clears            | `5eed007b…` |
--   | PR #504: `pull_requests`, one `pr_revisions`, 14 gate definitions and results, 3 criteria and their evidence | the verification page the merge card links to | `5eed007c…`–`5eed0081…` |
--   | 16 `decision_items`, 11 `decision_resolutions`, 8 `run_blocks`, 1 snooze event | the inbox | `5eed0082…`, `5eed0083…` |
--
-- Two other pages move, by #460's choice. #1844's failing evaluation makes V079 record a
-- `guardrail` intervention (cause `other`), so mockup 15 reads 8 / 5 / 4 / 2 / 2 and this file
-- brings the stored `human_interventions` rollup and its tooltip to match; and the four open
-- tickets make mockup 09's backlog `46 open · Sized 39/46`.
--
-- ---------------------------------------------------------------------------
-- **Ages are relative to the load; the week is arithmetic.**
-- ---------------------------------------------------------------------------
--
-- The three open cards are filed `now() − 8m / 21m / 34m`. Every resolution is anchored to the
-- load (or to the run it is about) and clamped: today's five never before today's 00:00 UTC, the
-- week's other six never before this Monday's — so `decision_metrics_weekly` (UTC ISO weeks)
-- always holds all eleven, whenever the stack is started. On a Monday the clamp puts the week's
-- rows on today, and *Resolved today* lists more than five; that is the price of the card being
-- right every day.
--
--   n   kind                       answer             latency  loop wait  channel  about
--   1   resize_review    #486 L→M  policy accept      12s      —          api      auto_accept_resize
--   2   split_approval   #490 → 6  Ken approve        41s      —          web
--   3   plan_sign_off    #1836     Maya sign off      400s     6m         github
--   4   resize_review    #479 M→L  Maya keep size     25s      —          slack
--   5   run_needs_human  #1839     Ken retry + note   55s      25s        push
--   6   protected_path   #1691     Ken deny           8s       10s        web      .github/workflows/docs.yml
--   7   resize_review    #465 S→M  Maya keep size     33s      —          email
--   8   run_needs_human  #1705     Ken retry + note   20s      25s        web
--   9   run_needs_human  #1693     Ken retry + note   95s      215s       web      stopped before it asked
--   10  split_approval   #486 → 4  Maya discard       70s      —          slack
--   11  plan_sign_off    #1704     Ken return + note  180s     170s       github
--
-- Sorted latencies 8 12 20 25 33 [41] 55 70 95 180 400: **11 decisions · median 41s · loops never
-- waited longer than 6m**, one of them a policy's. The head's *about 90 seconds* is the open
-- cards' per-kind medians this week — a kind with no answer this week takes the week's median:
-- merge_approval 41 + protected_path_allow_once 8 + claim_waiver 41 = **90 s**. No card figure is
-- stored — only each answer's own latency — and tests/inbox-invariants.sql recomputes the median,
-- the longest wait and the estimate from the rows.
--
-- Plus the state-coverage rows: Ken **snoozed** the proposed `k_msgq` fact (#409's) until tomorrow
-- 09:00 UTC — far enough that the pill stays at three on a stack started today — and a plan
-- sign-off on last week's loop #1666 **expired** unanswered. With them every status, severity,
-- resolver and channel V093/V095 admit is a seeded row; the one declared kind with none,
-- `spend_approval`, is dormant (#461) and asked by constraints.sql instead.
--
-- ---------------------------------------------------------------------------
-- **The three properties every seed holds.**
-- ---------------------------------------------------------------------------
--
-- It **cannot run in production** — every statement carries `${ouro_dev_seed}`. It is
-- **idempotent** — every id is a literal and every insert ends `on conflict do nothing`; the
-- resolutions, whose BEFORE triggers refuse an answered item before a conflict is looked for, and
-- the snooze, which is a function, carry `not exists` guards as well. And it **never fails on an
-- edited database** — the workspace by slug, people by email, every row of another seed by its
-- natural key (loop number, issue number, PR number, policy version), and a statement whose
-- parent is missing inserts nothing.
--
-- **It must sort after `dev_seed_workspace_settings`** (it reads the published policy versions)
-- and through it after every seed. `workspace_triage_inbox` does.
--
-- Filed as issue #460 (BM.4). Needs #457, #458, #459, #461 and the seeds above. Asserted in
-- tests/seed.sql and tests/seed.test.sh; tests/inbox-invariants.sql probes the rows, and
-- tests/verify-inbox-invariants.sh proves each probe goes red.

-- ---------------------------------------------------------------------------
-- The canonical tickets the refs name — the twins of the intake mirror and the dashboard runs.
--
-- #486 and #490 copy their intake mirror (R__dev_seed_intake.sql): title, labels, author, opened.
-- #465 and #479 exist only as run numbers, so their tickets are written from the run: #465 carries
-- the `refactor` label the org policy's human_review rule matches (V092, #484's v1–v7).
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select ('5eed0079-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", src.id, seed.number::text, '#' || seed.number,
       'https://github.com/' || (src.config ->> 'login') || '/' || seed.repo || '/issues/'
         || seed.number,
       coalesce(mirror.title, run.issue_title), null, 'open',
       coalesce(mirror.labels, seed.labels::jsonb),
       coalesce(mirror.author_login, seed.author),
       coalesce(mirror.gh_created_at, now() - seed.opened_ago),
       coalesce(mirror.gh_updated_at, now() - seed.opened_ago),
       now() - interval '40 seconds',
       coalesce(mirror.sizing_status, 'unsized'),
       jsonb_build_object('github', jsonb_build_object('owner', src.config ->> 'login',
                                                       'repo',  seed.repo))
  from (values
         (465, 'helios-telemetry', '["refactor", "telemetry"]', 'jorge-reyes', interval '3 days'),
         (479, 'helios-firmware',  '["ota", "bootloader"]',     'maya-chen',   interval '4 days'),
         (486, 'helios-firmware',  null,                         null,          null::interval),
         (490, 'helios-firmware',  null,                         null,          null::interval)
       ) as seed (number, repo, labels, author, opened_ago)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
  left join ouroboros.runs run      on run.organization_id = org."id"
                                   and run.issue_number = seed.number
  left join lateral (select g.title, g.labels, g.author_login, g.gh_created_at, g.gh_updated_at,
                            g.sizing_status
                       from ouroboros.github_issues g
                      where g.organization_id = org."id" and g.number = seed.number
                      order by g.id
                      limit 1) mirror on true
 where coalesce(mirror.title, run.issue_title) is not null
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The change-sets: #1830's refactor (PR #504's six files) and #1844's OTA rollback fix, whose third
-- file is the protected one. Cumulative against the run's base, as V047 counts them.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_files (id, run_id, path, additions, deletions, status)
select ('5eed007a-0000-4000-8000-' || lpad(changed.issue_number::text, 6, '0')
                                   || lpad(changed.ordinal::text, 6, '0'))::uuid,
       run.id, changed.path, changed.additions, changed.deletions, changed.status
  from (values
         (465, 1, 'drivers/telemetry/tlm_pool.c',     88, 71, 'modified'),
         (465, 2, 'drivers/telemetry/tlm_pool.h',     19, 23, 'modified'),
         (465, 3, 'drivers/telemetry/tlm_buf.c',      41, 52, 'modified'),
         (465, 4, 'subsys/telemetry/encoder.c',       22, 19, 'modified'),
         (465, 5, 'subsys/telemetry/Kconfig',          6, 15, 'modified'),
         (465, 6, 'tests/telemetry/test_tlm_pool.c',  38,  0, 'added'),
         (479, 1, 'subsys/ota/rollback.c',            27,  4, 'modified'),
         (479, 2, 'subsys/ota/checksum_verify.c',     12,  2, 'modified'),
         (479, 3, 'boot/rollback_flag.c',              2,  1, 'modified')
       ) as changed (issue_number, ordinal, path, additions, deletions, status)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = changed.issue_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The stop: #1844's change-set touches `boot/**`, which every published policy version protects.
-- Evaluated 21 minutes ago, seconds before its card was filed. `policy_ref` stays null: the run
-- carries no workflow version pin to copy (V048).
-- ---------------------------------------------------------------------------
insert into ouroboros.guardrail_evaluations (id, run_id, "check", verdict, evidence,
                                             change_set_seq, evaluated_at)
select '5eed007b-0000-4000-8000-000479000001'::uuid,
       run.id, 'allowed_paths', 'fail',
       jsonb_build_object('path', f.path, 'glob', 'boot/**', 'rule_id', 'protected-path',
                          'detail', 'protected by the workspace policy; needs a one-time allowance'),
       1, now() - interval '21 minutes 5 seconds'
  from ouroboros.organization org
  join ouroboros.runs run      on run.organization_id = org."id" and run.issue_number = 479
  join ouroboros.run_files f   on f.run_id = run.id and f.path = 'boot/rollback_flag.c'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- That stop is an intervention (V079 files it as `guardrail`, cause `other`), so the stored
-- `human_interventions` rollup for its day and repository is brought to what
-- `intervention_cause_daily` now counts: a new row when the insights seed (#436) wrote none for
-- that day and cause, and otherwise the row it wrote, one short. Mockup 15's card reads
-- 8 / 5 / 4 / 2 / 2 as a result (#460's choice).
insert into ouroboros.metric_daily (organization_id, repo_ref, metric_id, is_rate, dimension, day,
                                    value, numerator, denominator, meta)
select v.organization_id, gh.login || '/' || repo.name, 'human_interventions', false, v.cause,
       v.day, v.events, null, null, '{}'
  from ouroboros.intervention_events e
  join ouroboros.intervention_cause_daily v
    on v.organization_id = e.organization_id
   and v.day = (e.detected_at at time zone 'UTC')::date
   and v.cause = e.cause
  join ouroboros.runs run          on run.id = e.run_id and run.github_repo_id = v.github_repo_id
  join ouroboros.github_repos repo on repo.id = v.github_repo_id
  join ouroboros.github_orgs gh    on gh.id = repo.org_id
 where e.source = 'guardrail'
   and e.source_ref = run.id || '/allowed_paths'
   and run.issue_number = 479
   and e.organization_id = (select "id" from ouroboros.organization where "slug" = 'acme-robotics')
   and ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.metric_daily rollup
   set value = v.events
  from ouroboros.intervention_events e
  join ouroboros.runs run          on run.id = e.run_id
  join ouroboros.intervention_cause_daily v
    on v.organization_id = e.organization_id
   and v.day = (e.detected_at at time zone 'UTC')::date
   and v.cause = e.cause
   and v.github_repo_id = run.github_repo_id
  join ouroboros.github_repos repo on repo.id = v.github_repo_id
  join ouroboros.github_orgs gh    on gh.id = repo.org_id
 where rollup.metric_id = 'human_interventions'
   and rollup.organization_id = v.organization_id
   and rollup.repo_ref = gh.login || '/' || repo.name
   and rollup.dimension = v.cause
   and rollup.day = v.day
   and rollup.value is distinct from v.events
   and e.source = 'guardrail'
   and e.source_ref = run.id || '/allowed_paths'
   and run.issue_number = 479
   and e.organization_id = (select "id" from ouroboros.organization where "slug" = 'acme-robotics')
   and ${ouro_dev_seed};

-- And the throughput chart's tooltip for that day, which carries the day's interventions beside
-- its merges (#436's one-read tooltip), is brought to the new sum.
update ouroboros.metric_daily chart
   set meta = jsonb_set(chart.meta, '{interventions}', to_jsonb(total.events))
  from (select i.organization_id, i.repo_ref, i.day, sum(i.value) as events
          from ouroboros.metric_daily i
         where i.metric_id = 'human_interventions'
         group by i.organization_id, i.repo_ref, i.day) total
 where chart.metric_id = 'merged_prs'
   and chart.organization_id = total.organization_id
   and chart.repo_ref = total.repo_ref
   and chart.day = total.day
   and chart.meta ? 'interventions'
   and (chart.meta ->> 'interventions')::numeric is distinct from total.events
   and chart.organization_id = (select "id" from ouroboros.organization where "slug" = 'acme-robotics')
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- PR #504 — mirrored from GitHub, opened by loop #1830, closing the canonical #465.
--
-- `verifying`: its gates are judged and the human one is pending. Opened 30 minutes into the run;
-- its counts are written zero and set from the revision's snapshot, as R__dev_seed_verification.sql
-- does for PR #514, so `+214 −180 · 6 files` is a sum and never a literal.
-- ---------------------------------------------------------------------------
insert into ouroboros.pull_requests (id, organization_id, source_id, external_number,
                                     external_url, title, head_branch, base_branch, state,
                                     run_id, ticket_id, created_at)
select '5eed007c-0000-4000-8000-000000000504'::uuid,
       org."id", ticket.source_id, run.pr_number,
       'https://github.com/' || (ticket.meta #>> '{github,owner}') || '/'
         || (ticket.meta #>> '{github,repo}') || '/pull/' || run.pr_number,
       'telemetry: allocate frame buffers from a fixed pool',
       coalesce(run.branch_name, 'loop/465-telemetry-buffer-pool'), 'main', 'verifying',
       run.id, ticket.id, run.started_at + interval '30 minutes'
  from ouroboros.organization org
  join ouroboros.runs run       on run.organization_id = org."id" and run.issue_number = 465
  join ouroboros.tickets ticket on ticket.organization_id = org."id" and ticket.external_key = '#465'
 where org."slug" = 'acme-robotics'
   and run.pr_number is not null
   and ${ouro_dev_seed}
on conflict do nothing;

-- One revision, its files the run's change-set.
insert into ouroboros.pr_revisions (id, pr_id, revision_seq, head_sha, pushed_at, files)
select '5eed007d-0000-4000-8000-000000005041'::uuid,
       pr.id, 1, 'c4d81e7', pr.created_at,
       (select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'additions', f.additions,
                                                     'deletions', f.deletions) order by f.path),
                        '[]'::jsonb)
          from ouroboros.run_files f
         where f.run_id = pr.run_id)
  from ouroboros.pull_requests pr
 where pr.id = '5eed007c-0000-4000-8000-000000000504'
   and ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.pull_requests pr
   set additions = snapshot.additions,
       deletions = snapshot.deletions,
       changed_files = snapshot.changed_files
  from (select sum((f ->> 'additions')::integer)::integer as additions,
               sum((f ->> 'deletions')::integer)::integer as deletions,
               count(*)::integer                           as changed_files
          from ouroboros.pr_revisions rev
          cross join lateral jsonb_array_elements(rev.files) f
         where rev.id = '5eed007d-0000-4000-8000-000000005041') as snapshot
 where pr.id = '5eed007c-0000-4000-8000-000000000504'
   and (pr.additions, pr.deletions, pr.changed_files)
       is distinct from (snapshot.additions, snapshot.deletions, snapshot.changed_files)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Fourteen gates: thirteen required checks green, and the human approval the refactor label asks
-- for, pending. The dashboard's `13/14` (mockup 02) is this set; the merge card's `13/13` is the
-- required gates other than the human one — the merge_approval emitter's count (#461).
-- No second-model review: no provider exists until AZ.1, and this workflow does not ask for one.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_gate_definitions (id, pr_id, gate_key, source, required, sort_order,
                                           label, created_at)
select ('5eed007e-0000-4000-8000-' || lpad((5040 + gate.ordinal)::text, 12, '0'))::uuid,
       pr.id, gate.gate_key,
       case when gate.gate_key = 'human_approval' then 'org policy · human_review'
            else run.workflow_tag || ' workflow' end,
       true, gate.ordinal, gate.label, pr.created_at
  from (values
         ( 1, 'build',                  'Build'),
         ( 2, 'test_suite',             'Test suite'),
         ( 3, 'physical_hil',           'Physical HIL'),
         ( 4, 'diff_vs_plan',           'Diff-vs-plan conformance'),
         ( 5, 'secrets_license',        'Secrets & license scan'),
         ( 6, 'custom:clang-tidy',      'clang-tidy'),
         ( 7, 'custom:format',          'clang-format'),
         ( 8, 'custom:misra-c',         'MISRA C:2012 subset'),
         ( 9, 'custom:host-unit',       'Host unit tests'),
         (10, 'custom:size-budget',     'Flash & RAM budget'),
         (11, 'custom:stack-usage',     'Worst-case stack usage'),
         (12, 'custom:license-headers', 'License headers'),
         (13, 'custom:docs-build',      'Docs build'),
         (14, 'human_approval',         'Human approval')
       ) as gate (ordinal, gate_key, label)
  join ouroboros.pull_requests pr on pr.id = '5eed007c-0000-4000-8000-000000000504'
  join ouroboros.runs run         on run.id = pr.run_id
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.pr_gate_results (id, definition_id, revision_id, verdict, evidence,
                                       evaluated_at, provider_version)
select ('5eed007f-0000-4000-8000-' || lpad((50410 + gate.sort_order)::text, 12, '0'))::uuid,
       gate.id, rev.id,
       case when gate.gate_key = 'human_approval' then 'pending' else 'green' end,
       case when gate.gate_key = 'human_approval'
            then 'refactor label → human review (org policy)'
            else 'passed at ' || rev.head_sha end,
       rev.pushed_at + interval '6 minutes', 'dev-seed'
  from ouroboros.pr_gate_definitions gate
  join ouroboros.pr_revisions rev on rev.id = '5eed007d-0000-4000-8000-000000005041'
 where gate.pr_id = '5eed007c-0000-4000-8000-000000000504'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The matrix: three claims from the plan, each cited by an analysis note on the revision and then
-- verified — the order V057's pr_criteria_verified_has_evidence requires. `all ✓` is computed.
-- ---------------------------------------------------------------------------
insert into ouroboros.pr_criteria (id, pr_id, claim, source, status, sort_order, created_by,
                                   created_at)
select ('5eed0080-0000-4000-8000-' || lpad((5040 + claim.ordinal)::text, 12, '0'))::uuid,
       pr.id, claim.claim, 'plan', 'unverified', claim.ordinal, ken."id", pr.created_at
  from (values
         (1, 'Frame buffers come from a fixed pool, with no heap use on any path'),
         (2, 'Encoded frames are byte-identical before and after the refactor'),
         (3, 'Pool exhaustion is reported, never silent')
       ) as claim (ordinal, claim)
  join ouroboros.pull_requests pr on pr.id = '5eed007c-0000-4000-8000-000000000504'
  left join ouroboros."user" ken  on ken.email = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.pr_criteria_evidence (id, criterion_id, kind, revision_id, display_text)
select ('5eed0081-0000-4000-8000-' || lpad((50400 + cite.criterion * 10 + 1)::text, 12, '0'))::uuid,
       criterion.id, 'analysis_note', rev.id, cite.note
  from (values
         (1, 'tlm_pool.c: K_MEM_SLAB_DEFINE · no k_malloc reachable'),
         (2, 'encoder round-trip over 10 000 recorded frames · 0 diffs'),
         (3, 'test_tlm_pool: exhaustion returns -ENOMEM and counts the drop')
       ) as cite (criterion, note)
  join ouroboros.pr_criteria criterion
    on criterion.id = ('5eed0080-0000-4000-8000-' || lpad((5040 + cite.criterion)::text, 12, '0'))::uuid
  join ouroboros.pr_revisions rev on rev.id = '5eed007d-0000-4000-8000-000000005041'
 where ${ouro_dev_seed}
on conflict do nothing;

update ouroboros.pr_criteria criterion
   set status = 'verified'
 where criterion.pr_id = '5eed007c-0000-4000-8000-000000000504'
   and criterion.status = 'unverified'
   and exists (select 1 from ouroboros.pr_criteria_evidence e where e.criterion_id = criterion.id)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The three open cards — 8, 21 and 34 minutes old at load — each keyed as its plane's emitter keys
-- it (#461), so a live emitter refreshes these rows rather than filing twins.
--
-- **Merge approval** — every fact read from PR #504: the label the policy matched (ticket #465's
-- `refactor`), the required non-human gates and how many passed, the matrix, the diff stat.
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
select '5eed0082-0000-4000-8000-000000000001'::uuid,
       org."id", 'merge_approval', kind.version,
       jsonb_build_object(
         'pr_kind', 'refactor',
         'policy_label', 'refactor',
         'checks_passed', (select count(*) filter (where g.verdict in ('green', 'waived', 'not_required'))
                             from ouroboros.pr_gate_results_latest g
                            where g.revision_id = rev.id and g.required
                              and g.gate_key <> 'human_approval'),
         'checks_total',  (select count(*)
                             from ouroboros.pr_gate_results_latest g
                            where g.revision_id = rev.id and g.required
                              and g.gate_key <> 'human_approval'),
         'matrix_state',  case when bool_and(c.status in ('verified', 'waived')) then 'all ✓'
                               else 'incomplete' end,
         'added', pr.additions, 'removed', pr.deletions, 'files', pr.changed_files),
       jsonb_build_array(
         jsonb_build_object('type', 'run',    'id', run.id::text,    'label', 'loop #' || run.loop_seq),
         jsonb_build_object('type', 'pr',     'id', pr.id::text,     'label', 'PR #' || pr.external_number),
         jsonb_build_object('type', 'ticket', 'id', ticket.id::text, 'label', 'issue ' || ticket.external_key)),
       'pr.gates', 'pr:' || pr.id,
       now() - interval '8 minutes'
  from ouroboros.organization org
  join ouroboros.pull_requests pr        on pr.id = '5eed007c-0000-4000-8000-000000000504'
                                        and pr.organization_id = org."id"
  join ouroboros.runs run                on run.id = pr.run_id
  join ouroboros.tickets ticket          on ticket.id = pr.ticket_id
                                        and ticket.labels ? 'refactor'
  join ouroboros.pr_revisions rev        on rev.pr_id = pr.id
                                        and rev.revision_seq = (select max(r.revision_seq)
                                                                  from ouroboros.pr_revisions r
                                                                 where r.pr_id = pr.id)
  join ouroboros.pr_criteria c           on c.pr_id = pr.id
  join ouroboros.decision_kinds_current kind on kind.kind_id = 'merge_approval'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
 group by org."id", kind.version, pr.id, rev.id, run.id, ticket.id
on conflict do nothing;

-- **Allow once** — the path from the failing evaluation, the subject from the run, the diff stat
-- from the file's change-set row, the summary composed the way the guardrail emitter composes it.
insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
select '5eed0082-0000-4000-8000-000000000002'::uuid,
       org."id", 'protected_path_allow_once', kind.version,
       jsonb_build_object(
         'subject', run.issue_title,
         'edit_summary', case when f.deletions = 0 and f.additions = 1 then 'add one line'
                              when f.deletions = 0 then 'add ' || f.additions || ' lines'
                              when f.additions = 0 then 'remove ' || f.deletions || ' lines'
                              else 'change ' || (f.additions + f.deletions) || ' lines' end,
         'path', stop.evidence ->> 'path',
         'diff_lines', f.additions + f.deletions),
       jsonb_build_array(
         jsonb_build_object('type', 'run',    'id', run.id::text,    'label', 'loop #' || run.loop_seq),
         jsonb_build_object('type', 'ticket', 'id', ticket.id::text, 'label', 'issue ' || ticket.external_key),
         jsonb_build_object('type', 'path',   'id', f.path,          'label', f.path)),
       'guardrails', 'run:' || run.id || ':path:' || f.path,
       now() - interval '21 minutes'
  from ouroboros.organization org
  join ouroboros.runs run      on run.organization_id = org."id" and run.issue_number = 479
  join ouroboros.guardrail_evaluations stop
                               on stop.id = '5eed007b-0000-4000-8000-000479000001'
                              and stop.run_id = run.id and stop.verdict = 'fail'
  join ouroboros.run_files f   on f.run_id = run.id and f.path = stop.evidence ->> 'path'
  join ouroboros.tickets ticket on ticket.organization_id = org."id" and ticket.external_key = '#479'
  join ouroboros.decision_kinds_current kind on kind.kind_id = 'protected_path_allow_once'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- **Claim waiver** — PR #514's thermal criterion, by its text (#356). Keyed by the criterion, as
-- the claim-waiver emitter keys it; the mockup's one ref, PR #514, and the `verification` tag.
insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
select '5eed0082-0000-4000-8000-000000000003'::uuid,
       org."id", 'claim_waiver', kind.version,
       jsonb_build_object('claim', criterion.claim, 'missing_capability', 'thermal chamber'),
       jsonb_build_array(
         jsonb_build_object('type', 'pr', 'id', pr.id::text, 'label', 'PR #' || pr.external_number)),
       'pr.criteria', 'pr:' || pr.id || ':criterion:' || criterion.id,
       now() - interval '34 minutes'
  from ouroboros.organization org
  join ouroboros.pull_requests pr    on pr.organization_id = org."id" and pr.external_number = 514
  join ouroboros.pr_criteria criterion
                                     on criterion.pr_id = pr.id
                                    and criterion.claim = 'Flake must not reappear across temperature range'
  join ouroboros.decision_kinds_current kind on kind.kind_id = 'claim_waiver'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The week's eleven answered items — see the table in the header.
--
-- `answered` is when the answer lands: the load minus an offset, or the run plus one (so a loop's
-- question sits inside its run), clamped to today (n ≤ 5) or this Monday (the rest) in UTC. Each
-- item is filed `latency` before it. The latencies are repeated in the resolution insert below,
-- which recomputes the instant from the item; tests/inbox-invariants.sql holds the two to the oracle.
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
select ('5eed0082-0000-4000-8000-' || lpad((100 + seed.n)::text, 12, '0'))::uuid,
       org."id", seed.kind, kind.version,
       case seed.kind
         when 'resize_review'  then jsonb_build_object('ticket_key', ticket.external_key) || seed.facts
         when 'split_approval' then jsonb_build_object(
                                      'subject', ticket.title,
                                      'target', (ticket.meta #>> '{github,owner}') || '/'
                                                || (ticket.meta #>> '{github,repo}')) || seed.facts
         else jsonb_build_object('subject', run.issue_title) || seed.facts
       end,
       -- The run first (run_blocks below reads it there), then the ticket, then the path.
       case when run.id is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('type', 'run', 'id', run.id::text,
                                                      'label', 'loop #' || run.loop_seq)) end
         || case when ticket.id is null then '[]'::jsonb
                 else jsonb_build_array(jsonb_build_object('type', 'ticket', 'id', ticket.id::text,
                                                           'label', 'issue ' || ticket.external_key)) end
         || case when seed.facts ? 'path'
                 then jsonb_build_array(jsonb_build_object('type', 'path', 'id', seed.facts ->> 'path',
                                                           'label', seed.facts ->> 'path'))
                 else '[]'::jsonb end,
       seed.plane,
       case seed.plane
         when 'estimation' then 'ticket:' || ticket.id || ':estimate:' || (seed.n + 1)
         when 'planning'   then 'ticket:' || ticket.id || ':split:' || seed.n
         when 'workflows'  then 'run:' || run.id || ':stage:plan'
         when 'guardrails' then 'run:' || run.id || ':path:' || (seed.facts ->> 'path')
         else 'run:' || run.id
       end,
       greatest(case when seed.n <= 5
                     then date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
                     else date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' end,
                coalesce(run.started_at + seed.into_run, now() - seed.ago))
         - seed.latency
  from (values
         ( 1, 'resize_review',             'estimation', null::integer, 486, interval '4 hours',            null::interval,         interval '12 seconds',
           '{"from_effort": "L", "to_effort": "M", "confidence": 82}'::jsonb),
         ( 2, 'split_approval',            'planning',   null,          490, interval '3 hours 35 minutes', null,                   interval '41 seconds',
           '{"draft_count": 6}'),
         ( 3, 'plan_sign_off',             'workflows',  1836,          null, null,                         interval '14 minutes',  interval '400 seconds',
           '{"stage_label": "Plan review", "plan_files": 4}'),
         ( 4, 'resize_review',             'estimation', null,          479, interval '1 hour 10 minutes',  null,                   interval '25 seconds',
           '{"from_effort": "M", "to_effort": "L", "confidence": 64}'),
         ( 5, 'run_needs_human',           'runs',       1839,          null, null,                         interval '9 minutes',   interval '55 seconds',
           '{"stage_label": "Test", "reason": "attempt limit reached"}'),
         ( 6, 'protected_path_allow_once', 'guardrails', 1691,          null, null,                         interval '6 minutes',   interval '8 seconds',
           '{"edit_summary": "add 6 lines", "path": ".github/workflows/docs.yml", "diff_lines": 6}'),
         ( 7, 'resize_review',             'estimation', null,          465, interval '2 days 5 hours',     null,                   interval '33 seconds',
           '{"from_effort": "S", "to_effort": "M", "confidence": 58}'),
         ( 8, 'run_needs_human',           'runs',       1705,          null, null,                         interval '8 minutes',   interval '20 seconds',
           '{"stage_label": "Build", "reason": "toolchain cache miss"}'),
         ( 9, 'run_needs_human',           'runs',       1693,          null, null,                         interval '6 minutes',   interval '95 seconds',
           '{"stage_label": "Test", "reason": "attempt limit reached"}'),
         (10, 'split_approval',            'planning',   null,          486, interval '1 day 6 hours',      null,                   interval '70 seconds',
           '{"draft_count": 4}'),
         (11, 'plan_sign_off',             'workflows',  1704,          null, null,                         interval '5 minutes',   interval '180 seconds',
           '{"stage_label": "Plan review", "plan_files": 7}')
       ) as seed (n, kind, plane, loop_seq, ticket_number, ago, into_run, latency, facts)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.decision_kinds_current kind on kind.kind_id = seed.kind
  left join ouroboros.runs run    on run.organization_id = org."id" and run.loop_seq = seed.loop_seq
  left join ouroboros.tickets ticket
                                  on ticket.organization_id = org."id"
                                 and ticket.external_key = '#' || seed.ticket_number
 where (seed.loop_seq is null or run.id is not null)
   and (seed.ticket_number is null or ticket.id is not null)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The state-coverage pair. Ken's snooze is below, through decision_item_snooze, so it leaves the
-- event V095 audits; the expired sign-off is filed expired — its window lapsed with no answer.
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
select '5eed0082-0000-4000-8000-000000000201'::uuid,
       org."id", 'fact_review', kind.version,
       jsonb_build_object('reason', 'awaiting review', 'text', fact.text,
                          'provenance_line', fact.provenance ->> 'line'),
       '[]'::jsonb, 'facts', 'fact:' || fact.id || ':proposed',
       fact.created_at + interval '1 minute'
  from ouroboros.organization org
  join ouroboros.facts fact on fact.organization_id = org."id" and fact.status = 'proposed'
                           and fact.text = 'Team prefers `k_msgq` over `k_fifo` in ISR paths'
  join ouroboros.decision_kinds_current kind on kind.kind_id = 'fact_review'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.decision_items
  (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, status,
   created_at)
select '5eed0082-0000-4000-8000-000000000202'::uuid,
       org."id", 'plan_sign_off', kind.version,
       jsonb_build_object('subject', run.issue_title, 'stage_label', 'Plan review', 'plan_files', 3),
       jsonb_build_array(jsonb_build_object('type', 'run', 'id', run.id::text,
                                            'label', 'loop #' || run.loop_seq)),
       'workflows', 'run:' || run.id || ':stage:plan', 'expired',
       run.started_at + interval '3 minutes'
  from ouroboros.organization org
  join ouroboros.runs run on run.organization_id = org."id" and run.loop_seq = 1666
  join ouroboros.decision_kinds_current kind on kind.kind_id = 'plan_sign_off'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

select count(snooze.event_id) as snoozed
  from ouroboros.decision_items item
  join ouroboros."user" ken on ken.email = 'ken@acme-robotics.dev'
 cross join lateral ouroboros.decision_item_snooze(
         item.id,
         date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day 9 hours',
         ken."id", 'after the ISR review') as snooze(event_id)
 where item.id = '5eed0082-0000-4000-8000-000000000201'
   and item.status = 'open'
   and not exists (select 1 from ouroboros.decision_snooze_events e where e.item_id = item.id)
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The loops that sat waiting. Open: #1830 since it handed itself to a person, #1844 since its stop.
-- Answered: offsets from the item (`lead`, negative when the run stopped before its plane asked)
-- and from the answer (`tail`, negative when the run moved on before it), so each loop wait in the
-- header is `least(unblocked, answered) − blocked`.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_blocks (id, organization_id, decision_item_id, run_id, blocked_at,
                                  unblocked_at)
select '5eed0083-0000-4000-8000-000000000001'::uuid,
       item.organization_id, item.id, run.id, coalesce(run.finished_at, item.created_at), null::timestamptz
  from ouroboros.decision_items item
  join ouroboros.runs run on run.id = (item.refs -> 0 ->> 'id')::uuid
 where item.id = '5eed0082-0000-4000-8000-000000000001'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.run_blocks (id, organization_id, decision_item_id, run_id, blocked_at,
                                  unblocked_at)
select '5eed0083-0000-4000-8000-000000000002'::uuid,
       item.organization_id, item.id, stop.run_id, stop.evaluated_at + interval '1 second', null::timestamptz
  from ouroboros.decision_items item
  join ouroboros.guardrail_evaluations stop on stop.id = '5eed007b-0000-4000-8000-000479000001'
 where item.id = '5eed0082-0000-4000-8000-000000000002'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.run_blocks (id, organization_id, decision_item_id, run_id, blocked_at,
                                  unblocked_at)
select ('5eed0083-0000-4000-8000-' || lpad((100 + seed.n)::text, 12, '0'))::uuid,
       item.organization_id, item.id, (item.refs -> 0 ->> 'id')::uuid,
       item.created_at + seed.lead,
       item.created_at + seed.latency + seed.tail
  from (values
         ( 3, interval '400 seconds', interval '40 seconds',   interval '5 seconds'),
         ( 5, interval '55 seconds',  interval '5 seconds',    interval '-25 seconds'),
         ( 6, interval '8 seconds',   interval '-2 seconds',   interval '3 seconds'),
         ( 8, interval '20 seconds',  interval '-5 seconds',   interval '2 seconds'),
         ( 9, interval '95 seconds',  interval '-120 seconds', interval '4 seconds'),
         (11, interval '180 seconds', interval '10 seconds',   interval '20 seconds')
       ) as seed (n, latency, lead, tail)
  join ouroboros.decision_items item
    on item.id = ('5eed0082-0000-4000-8000-' || lpad((100 + seed.n)::text, 12, '0'))::uuid
 where item.refs -> 0 ->> 'type' = 'run'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The answers. V095 computes both spans; the policy's names the published policy version it ran
-- under (#460's choice: no policy store names auto_accept_resize). A not-exists guard, because an
-- answered item refuses a second answer before any conflict is looked for.
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_resolutions
  (item_id, organization_id, action_id, resolver, resolved_by_user, resolved_by_policy, channel,
   note, outcome, resolved_at)
select item.id, item.organization_id, seed.action_id, seed.resolver, person."id", seed.policy,
       seed.channel, seed.note,
       case when seed.policy is null then '{}'::jsonb
            else jsonb_build_object('org_policy_version',
                                    (select max(v.version) from ouroboros.org_policy_versions v
                                      where v.organization_id = item.organization_id)) end,
       item.created_at + seed.latency
  from (values
         ( 1, interval '12 seconds',  'accept_resize',   'policy', null,                     'auto_accept_resize', 'api',    null),
         ( 2, interval '41 seconds',  'approve_split',   'human',  'ken@acme-robotics.dev',  null,                 'web',    null),
         ( 3, interval '400 seconds', 'sign_off',        'human',  'maya@acme-robotics.dev', null,                 'github', null),
         ( 4, interval '25 seconds',  'keep_size',       'human',  'maya@acme-robotics.dev', null,                 'slack',  null),
         ( 5, interval '55 seconds',  'retry_with_note', 'human',  'ken@acme-robotics.dev',  null,                 'push',
           'Debounce the falling edge as well; the bench shows a second bounce.'),
         ( 6, interval '8 seconds',   'deny',            'human',  'ken@acme-robotics.dev',  null,                 'web',    null),
         ( 7, interval '33 seconds',  'keep_size',       'human',  'maya@acme-robotics.dev', null,                 'email',  null),
         ( 8, interval '20 seconds',  'retry_with_note', 'human',  'ken@acme-robotics.dev',  null,                 'web',
           'Retry on forge-02; forge-01''s toolchain cache is cold.'),
         ( 9, interval '95 seconds',  'retry_with_note', 'human',  'ken@acme-robotics.dev',  null,                 'web',
           'Cap the reconnect backoff at 30 s and retry.'),
         (10, interval '70 seconds',  'discard',         'human',  'maya@acme-robotics.dev', null,                 'slack',  null),
         (11, interval '180 seconds', 'return_to_loop',  'human',  'ken@acme-robotics.dev',  null,                 'github',
           'Emit queue depth per repository, not one global gauge.')
       ) as seed (n, latency, action_id, resolver, person_email, policy, channel, note)
  join ouroboros.decision_items item
    on item.id = ('5eed0082-0000-4000-8000-' || lpad((100 + seed.n)::text, 12, '0'))::uuid
  left join ouroboros."user" person on person.email = seed.person_email
 where item.status in ('open', 'snoozed')
   and (seed.person_email is null or person."id" is not null)
   and not exists (select 1 from ouroboros.decision_resolutions r where r.item_id = item.id)
   and ${ouro_dev_seed}
on conflict do nothing;
