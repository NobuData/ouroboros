-- R__dev_seed_onboarding.sql — mockup 13's mid-wizard moment, in a development database and
-- nowhere else.
--
-- The fifteenth development seed (#383, BA.4), and the first that needs a workspace of its own.
-- Every other seed is drawn in `acme-robotics`; this one creates `acme-onboarding` and puts
-- docs/mockups/13-onboarding.html's captured state in it: the rail at `✓ ✓ ● ○`, the *"We
-- already figured this out"* card with its six rows, `Quick fixes` selected with `Deep
-- refactor` locked, and `#488` as the safe first issue under the dry-run promise.
--
-- ---------------------------------------------------------------------------
-- Why a fourth workspace — decided on the issue.
-- ---------------------------------------------------------------------------
--
-- The issue names `acme-robotics / helios-firmware`, and that workspace cannot hold this moment.
-- Mockup 13 is a team's first week; mockups 02 and 03 are the same team weeks later, and one
-- database cannot be both for the same workspace:
--
--   * the lock must read **3 of 10** merged loops, and `acme-robotics` has fifty-one
--     (R__dev_seed_dashboard.sql) — `merged_loop_count()` is per workspace, so *Deep refactor*
--     computes as unlocked there;
--   * `#488` must not have reached the loop, and DASH-F.5 queues it at position 3 — so step 4
--     derives *done* there, step 3 *regressed*, and the rail reads `✓ ✓ ○ ✓`;
--   * dry-run must be on, and switching it on for `acme-robotics` would refuse the merges the
--     PR verification seed and its e2e leg arm.
--
-- Rewriting the dashboard seed to make room would break two mockups to decorate a third, and
-- seeding the rail directly is the one thing #380 forbids. So the moment gets a workspace in
-- which it is simply true. Ken owns it, which is what puts it in the list the dev stack's
-- sign-in offers — a fourth row beside mockup 01 Step 2's three.
--
-- ---------------------------------------------------------------------------
-- Nothing here is a step status. The rail derives.
-- ---------------------------------------------------------------------------
--
-- Decision O1 (V067, restated by V070): every step is computed on read from the subsystem that
-- owns it. So this file seeds **subsystem rows**, and the rail is what they add up to:
--
--   | step                         | what is seeded                                   | derives |
--   |------------------------------|--------------------------------------------------|---------|
--   | 1 Connect GitHub             | an `active` GitHub source naming the account and | ✓ done  |
--   |                              | listing the repository                           |         |
--   | 2 Pick a repo                | `helios-firmware`, enabled, under an enabled     | ✓ done  |
--   |                              | account — and a scan, so it reads *auto-detected*|         |
--   | 3 Choose a starting workflow | `selected_template = quick-fixes`, and **no**    | ● active|
--   |                              | workflow instantiated from it                    |         |
--   | 4 Run your first loop        | `picked_ticket_id → #488`, and **no** queue item | ○ todo  |
--   |                              | or run for it                                    |         |
--
-- `onboarding_state` is written with the five columns the wizard owns and nothing else;
-- tests/seed.test.sh pins that column list and tests/seed.sql recomputes the table above from
-- the rows. If the rail ever reads otherwise, that is a bug this seed found, not one it hid.
--
-- **The lock is counted, not flagged.** Three merged runs are seeded — in `helios-console`, the
-- workspace's other repository — so `merged_loop_count()` answers 3, `deep-refactor`'s shipped
-- `{"merged_loops_gte": 10}` (V068) evaluates to locked, and the tile can print `3 of 10`. They
-- are in the *other* repository on purpose: the wizard is per repository (V067), so a team that
-- has merged three loops on its console and is now onboarding its firmware is exactly the
-- re-entry the schema was built for, and `helios-firmware` itself has had no loop — which is
-- what *Run your first loop* means. The runs are read-model rows, as R__dev_seed_dashboard.sql's
-- are: this file seeds no workflow, route or provider behind them, because nothing on mockup 13
-- reads one and a workflow in this workspace would be one the rail could mistake for progress.
--
-- **The four tiles are not seeded here.** They ship with the product as V068's global rows and
-- are in every migrated database; this workspace has no override, so `workflow_templates_for()`
-- answers the shipped four.
--
-- ---------------------------------------------------------------------------
-- `#488` is the same GitHub issue, mirrored a second time.
-- ---------------------------------------------------------------------------
--
-- Both workspaces connect the GitHub account `acme-robotics` and enable `helios-firmware` —
-- `github_orgs` is unique per (workspace, login), so one account in two workspaces is ordinary.
-- Each then holds its own mirror of the same repository, which is why this file **copies
-- R__dev_seed_intake.sql's nine issues and the estimate in force on each by query** rather than
-- restating them: `#488` here has the title, labels, XS chip, `docs-loop` suggestion, empty file
-- list and 3–6 minute cycle it has there because it is read from there, and a correction to
-- the intake seed cannot leave this one behind. tests/seed.sql compares the two field for field.
--
-- All nine are copied, not `#488` alone, so that *"We picked a safe one"* is a pick: BB.4's
-- score (#387) ranks a real backlog and `#488` wins it on effort, workflow and paths, rather
-- than being the only candidate. None of them is queued here — that is the difference between
-- the two workspaces, and the point of this one.
--
-- The canonical ticket the wizard points at (`onboarding_state.picked_ticket_id` references
-- `tickets`, V030) is built from the mirrored row the same way. It is the only `tickets` row in
-- this workspace: R__dev_seed_sources.sql's argument for not seeding a second backlog holds, and
-- one ticket is what the pick needs.
--
-- ---------------------------------------------------------------------------
-- The detection rows are the detector's, not the mockup's — decided on the issue.
-- ---------------------------------------------------------------------------
--
-- The six rows are **what BB.1's rule packs (#384) store for this repository**: the output of
-- `runScan(CORE_PACKS)` over ouroboros-rest's Zephyr golden fixture
-- (`detection.fixture.ts`, pinned by `detection.golden.spec.ts` as *"mockup 13's card"*), value
-- lines, verdicts and evidence payloads as that code wrote them. Three lines therefore differ
-- from the static mockup, each for a reason the schema already records:
--
--   * **Devcontainer** reads `found .devcontainer.json → image ghcr.io/…`, not `env ready in 38s
--     (snapshotted)`. Decision O2: detection sees that the file exists and parses; nothing has
--     measured a boot, so no boot time is claimed and the row is `detected`, not `measured`.
--   * **Tests** reads `5 suites, 63 tests (detected)` — the pack's own honesty suffix.
--   * **Protected paths** reads `boot/, keys/ suggested`; the mockup's `· edit` is a link.
--
-- A seed that printed the mockup's lines would be replaced by these on the first real re-scan,
-- so the page would change under a reviewer. `38s` survives where it is data: the scan row's
-- `duration_ms` is 38000, which is the card's `scanned in 38s` tag.
--
-- The same restraint decides step 1's result line. No GitHub App is installed on anything
-- (`installed_at` stays null, R__dev_seed.sql's rule), so the rail derives `acme-robotics ·
-- token` where the mockup prints `GitHub App installed`.
--
-- ---------------------------------------------------------------------------
-- Dry-run is the policy row, and nobody's name is on it.
-- ---------------------------------------------------------------------------
--
-- `org_policies.dry_run = true` with `updated_by` null — the shape V075 gives the onboarding
-- default. That is what makes the page's subline and its three safety rows true of this
-- workspace, and it is seeded here rather than in `acme-robotics` for the reason above.
--
--   | Rows                           | Id prefix   | Suffix                                  |
--   |--------------------------------|-------------|-----------------------------------------|
--   | `organization` (1)             | `5eed0049…` | 1                                       |
--   | `member` (1)                   | `5eed004a…` | 1 Ken, owner                            |
--   | `github_orgs` (1)              | `5eed004b…` | 1 the account `acme-robotics`           |
--   | `github_repos` (2)             | `5eed004c…` | 1 helios-firmware, 2 helios-console     |
--   | `ticket_sources` (1)           | `5eed004d…` | 1                                       |
--   | `github_issues` (9)            | `5eed004e…` | the issue number                        |
--   | `issue_estimates` (8)          | `5eed004f…` | the issue number, then the version      |
--   | `tickets` (1)                  | `5eed0050…` | the issue number                        |
--   | `runs` (3)                     | `5eed0051…` | the issue number                        |
--   | `onboarding_state` (1)         | `5eed0052…` | 1                                       |
--   | `repo_detection_scans` (1)     | `5eed0053…` | 1                                       |
--   | `repo_detections` (6)          | `5eed0054…` | 1–6, in card order                      |
--   | `protected_path_policies` (2)  | `5eed0055…` | 1 boot, 2 keys                          |
--   | `org_policies` (1)             | —           | keyed by the workspace                  |
--
-- Every row carries a prefix of this file's own, so a count another seed's assertions make over
-- its prefix is not moved by anything here.
--
-- Three properties make it safe to apply to a development database on every `up`, and each of
-- them is asserted by a test:
--
--   1. **It cannot run in production.** Every statement ends with `${ouro_dev_seed}`, which is
--      `false` in flyway.toml and `true` only in flyway.seed.toml.
--   2. **It is idempotent.** Every id is a literal or built from an issue number, and every
--      insert ends `on conflict do nothing`. The estimates carry the `not exists` guard
--      R__dev_seed_intake.sql explains: `issue_estimates_version_monotonic` is a BEFORE trigger
--      and would raise on a second application before the conflict was resolved.
--   3. **It never fails on a database somebody has edited.** Every parent is found by natural
--      key — the workspace by slug, Ken by email, a repository by name — and the copied issues
--      are read from whatever R__dev_seed_intake.sql left. A parent that is gone makes the join
--      empty and the statement a no-op, never a foreign-key error.
--
-- **It must sort after `dev_seed` and `dev_seed_intake`**, the two it reads, and
-- `dev_seed_onboarding` does. tests/seed.test.sh asserts the whole order.
--
-- Filed as issue #383 (BA.4) under epic #376. Needs V067 (#380), V068 (#381), V070 (#385) and
-- V075 (#382). Read by BB.2's wizard API (#385), BB.3's tiles (#386), BB.4's picker (#387) and
-- the onboarding UI (#390–#395). Asserted in tests/seed.sql and tests/seed.test.sh.

-- ---------------------------------------------------------------------------
-- The workspace, and the person who can open it.
--
-- `metadata` is null, as on the two shared workspaces of R__dev_seed.sql: it is not a personal
-- workspace. `createdAt` has no default — the library always supplies it — so the seed does.
-- ---------------------------------------------------------------------------
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
select '5eed0049-0000-4000-8000-000000000001', 'Acme Onboarding', 'acme-onboarding', now(), null
 where ${ouro_dev_seed}
on conflict do nothing;

-- Ken, as owner: the person the dev stack signs in as, holding the role that may pick a
-- template and a ticket. One member — nothing on mockup 13 lists people.
insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
select '5eed004a-0000-4000-8000-000000000001', org."id", person."id", 'owner', now()
  from ouroboros.organization org
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Step 2's subsystem: the GitHub account and its two repositories, enabled.
--
-- The account is `acme-robotics` — the same GitHub account R__dev_seed.sql connects to the
-- `acme-robotics` workspace, mirrored here a second time. `installed_at` stays null: no GitHub
-- App is installed on anything, and the rail's `· token` is what that derives to.
--
-- `helios-firmware` is the repository being onboarded. `helios-console` is the one the three
-- merged loops below ran in.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_orgs (id, organization_id, login, enabled)
select '5eed004b-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics', true
  from ouroboros.organization org
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch)
select seed.id::uuid, gh.id, seed.name, true, 'main'
  from (values
         ('5eed004c-0000-4000-8000-000000000001', 'helios-firmware'),
         ('5eed004c-0000-4000-8000-000000000002', 'helios-console')
       ) as seed (id, name)
  join ouroboros.organization org on org."slug" = 'acme-onboarding'
  join ouroboros.github_orgs gh on gh.organization_id = org."id" and gh.login = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Step 1's subsystem: an active GitHub source that names the account and lists the repository.
--
-- R__dev_seed_sources.sql's row, for this workspace: the credential is a well-formed
-- `ouro.v1.1.<nonce>.<body>` envelope whose body decodes to
-- `dev-seed-value-not-a-real-credential-github`, so V030's envelope-only CHECK is exercised and
-- anything that tries to open it fails on a key rather than on a shape. No sync has run, so
-- `sync_cursor` and `synced_at` stay null.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_sources
    (id, organization_id, kind, display_name, config, credentials_encrypted, status)
select '5eed004d-0000-4000-8000-000000000001'::uuid, org."id", 'github', 'GitHub · acme-robotics',
       '{"login": "acme-robotics", "repos": ["helios-firmware", "helios-console"]}'::jsonb,
       'ouro.v1.1.c2VlZC1ub25jZS02.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWdpdGh1Yg',
       'active'
  from ouroboros.organization org
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The backlog: the same nine GitHub issues, mirrored into this workspace.
--
-- Read from R__dev_seed_intake.sql's rows (`5eed0018…`, the intake seed's own — never an issue
-- a developer's sync added) and written against this workspace's `helios-firmware`. Every
-- column the mirror holds is carried across unchanged, the URL included: it is the same issue
-- on github.com.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_issues
  (id, organization_id, github_repo_id, number, title, body, state, labels,
   author_login, gh_created_at, gh_updated_at, gh_url, synced_at, sizing_status)
select ('5eed004e-0000-4000-8000-' || lpad(source.number::text, 12, '0'))::uuid,
       org."id", repo.id, source.number, source.title, source.body, source.state, source.labels,
       source.author_login, source.gh_created_at, source.gh_updated_at, source.gh_url,
       source.synced_at, source.sizing_status
  from ouroboros.github_issues source
  join ouroboros.organization org  on org."slug" = 'acme-onboarding'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
 where source.id::text like '5eed0018-%'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The estimate in force on each — eight of them, `#483` being unsized there and so here.
--
-- Only the newest version of each issue is copied, at its own version number: `#487` arrives as
-- version 2, the estimate the backlog renders, without the superseded version 1 no screen reads.
-- `trace.sized_at` and `created_at` come across with the row, so *sized 29h ago* is the same
-- claim in both workspaces.
--
-- The `not exists` guard is R__dev_seed_intake.sql's, for its reason: without it a second
-- application raises inside `issue_estimates_version_monotonic` instead of writing nothing.
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select ('5eed004f-0000-4000-8000-' || lpad(source_issue.number::text, 10, '0')
                                   || lpad(source.version::text, 2, '0'))::uuid,
       issue.id, source.version, source.effort, source.confidence,
       source.suggested_workflow, source.routed_model,
       source.breakdown, source.risk, source.risk_note, source.trace, source.created_at
  from ouroboros.issue_estimates source
  join ouroboros.github_issues source_issue on source_issue.id = source.github_issue_id
  join ouroboros.github_issues issue
    on issue.id = ('5eed004e-0000-4000-8000-' || lpad(source_issue.number::text, 12, '0'))::uuid
 where source_issue.id::text like '5eed0018-%'
   and source.version = (select max(newest.version)
                           from ouroboros.issue_estimates newest
                          where newest.github_issue_id = source.github_issue_id)
   and not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.github_issue_id = issue.id
                      and prior.version >= source.version)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The canonical ticket for `#488` — what the wizard's pick references.
--
-- Built from the mirrored row above in the shape Q.3's GitHub mapper writes (and
-- R__dev_seed_ticket_planning.sql seeds): `external_id` the number, `external_key` `#488`,
-- `meta` `{"github": {"owner", "repo"}}`. That `meta` is what BB.2 reads to decide the ticket
-- is an issue of the wizard's repository — without it step 4 says the pick is somebody else's.
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
    (id, organization_id, source_id, external_id, external_key, external_url, title, body, state,
     labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select ('5eed0050-0000-4000-8000-' || lpad(issue.number::text, 12, '0'))::uuid,
       issue.organization_id, source.id, issue.number::text, '#' || issue.number::text,
       issue.gh_url, issue.title, issue.body, issue.state, issue.labels, issue.author_login,
       issue.gh_created_at, issue.gh_updated_at, issue.synced_at, issue.sizing_status,
       jsonb_build_object('github', jsonb_build_object('owner', gh.login, 'repo', repo.name))
  from ouroboros.github_issues issue
  join ouroboros.github_repos repo on repo.id = issue.github_repo_id
  join ouroboros.github_orgs gh on gh.id = repo.org_id
  join ouroboros.ticket_sources source
    on source.organization_id = issue.organization_id
   and source.kind = 'github'
   and source.display_name = 'GitHub · acme-robotics'
 where issue.id = '5eed004e-0000-4000-8000-000000000488'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Three merged loops — the count the *Deep refactor* lock is evaluated against.
--
-- In `helios-console`, none of them `#488` and none in `helios-firmware`, so they move
-- `merged_loop_count()` to 3 and leave steps 3 and 4 exactly where the table in the header puts
-- them. Small documentation chores, a few days apart, each merged with every check green:
-- `runs_merged_has_pr` wants the PR number and `runs_terminal_finished_at` the finish time, and
-- the cycle is the arithmetic of the two timestamps, as in R__dev_seed_dashboard.sql.
--
-- `loop_seq` is given rather than left to `runs_allocate_loop_seq`, so the three are `#1`–`#3`
-- on every machine.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            loop_seq, workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total)
select ('5eed0051-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       seed.loop_seq, 'docs-loop', 'ollama/qwen3-coder', 'merged',
       'Merged', 6, 6,
       now() - make_interval(days => seed.days_ago, mins => seed.cycle_minutes),
       now() - make_interval(days => seed.days_ago),
       seed.pr_number, 12, 12
  from (values
         (1, 12, 'Fix broken links in the operator console README',  13, 9, 6),
         (2, 15, 'Document the pairing-screen keyboard shortcuts',   16, 6, 8),
         (3, 17, 'Correct the units in the telemetry panel tooltips', 18, 3, 5)
       ) as seed (loop_seq, issue_number, issue_title, pr_number, days_ago, cycle_minutes)
  join ouroboros.organization org  on org."slug" = 'acme-onboarding'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-console'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The scan — `scan_seq 1`, thirty-eight seconds, nine probes.
--
-- `duration_ms` is the card's `scanned in 38s`. `pack_versions` and `probe_budget_used` are what
-- the six core packs report for this repository (see *The detection rows are the detector's*).
-- Twenty minutes ago: the wizard reached step 2, the scan ran, and the person is now on step 3.
-- ---------------------------------------------------------------------------
insert into ouroboros.repo_detection_scans
    (id, organization_id, repo_ref, scan_seq, scanned_at, duration_ms, pack_versions,
     probe_budget_used)
select '5eed0053-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics/helios-firmware', 1,
       now() - interval '20 minutes', 38000,
       '{"language": "1.0.0", "build": "1.0.0", "devcontainer": "1.0.0", "tests": "1.0.0",
         "protected_paths": "1.0.0", "conventions": "1.0.0"}'::jsonb,
       9
  from ouroboros.organization org
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Its six rows, in card order, each with the evidence it was concluded from.
--
-- `label` is `detected` on all six: a probe saw each of these, and nothing was measured. The
-- one `warn` is Conventions — no CONTRIBUTING.md — which is the row the card draws in the warn
-- hue. The scan is found by its natural key, so the foreign key is the join.
-- ---------------------------------------------------------------------------
insert into ouroboros.repo_detections
    (id, organization_id, repo_ref, scan_seq, row_key, verdict, value, evidence, label)
select ('5eed0054-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       scan.organization_id, scan.repo_ref, scan.scan_seq,
       seed.row_key, seed.verdict, seed.value, seed.evidence::jsonb, 'detected'
  from (values
         (1, 'language', 'ok', 'C 92% · Zephyr RTOS 4.1',
          '{"languages": {"C": 920000, "CMake": 50000, "Python": 30000},
            "top": {"language": "C", "percent": 92},
            "framework": {"name": "Zephyr RTOS 4.1", "from": "west.yml"},
            "pack": "language", "packVersion": "1.0.0",
            "probes": ["languages", "tree", "file:west.yml"],
            "confidence": "high"}'),
         (2, 'build', 'ok', 'west + twister (found west.yml)',
          '{"hit": "west.yml",
            "alsoFound": ["CMakeLists.txt"],
            "checked": ["west.yml", "Cargo.toml", "go.mod", "package.json", "pyproject.toml",
                        "build.gradle.kts", "build.gradle", "pom.xml", "BUILD.bazel", "WORKSPACE",
                        "MODULE.bazel", "CMakeLists.txt", "Makefile"],
            "pack": "build", "packVersion": "1.0.0",
            "probes": ["tree"],
            "confidence": "high"}'),
         (3, 'devcontainer', 'ok',
          'found .devcontainer.json → image ghcr.io/zephyrproject-rtos/ci:v0.27.4',
          '{"hit": ".devcontainer.json",
            "parsed": true,
            "environment": "image ghcr.io/zephyrproject-rtos/ci:v0.27.4",
            "features": [],
            "pack": "devcontainer", "packVersion": "1.0.0",
            "probes": ["tree", "file:.devcontainer.json"],
            "confidence": "high"}'),
         (4, 'tests', 'ok', '5 suites, 63 tests (detected)',
          '{"ecosystems": ["zephyr"],
            "suites": 5, "tests": 63,
            "filesRead": 5, "filesTotal": 5, "sampled": false,
            "pack": "tests", "packVersion": "1.0.0",
            "probes": ["tree",
                       "file:tests/app/helios/src/main.c",
                       "file:tests/drivers/i2c/src/main.c",
                       "file:tests/drivers/spi/src/main.c",
                       "file:tests/kernel/timer/src/main.c",
                       "file:tests/lib/ring_buffer/src/main.c"],
            "confidence": "medium"}'),
         (5, 'protected_paths', 'ok', 'boot/, keys/ suggested',
          '{"suggested": [{"glob": "boot/**", "why": "bootloader"},
                          {"glob": "keys/**", "why": "key and secret material"}],
            "pack": "protected_paths", "packVersion": "1.0.0",
            "probes": ["tree"],
            "confidence": "medium"}'),
         (6, 'conventions', 'warn',
          'No CONTRIBUTING.md — we''ll learn your conventions from merged PRs instead.',
          '{"contributing": null, "codeowners": null, "commitConvention": null,
            "pack": "conventions", "packVersion": "1.0.0",
            "probes": ["tree"],
            "confidence": "high"}')
       ) as seed (ordinal, row_key, verdict, value, evidence)
  join ouroboros.organization org on org."slug" = 'acme-onboarding'
  join ouroboros.repo_detection_scans scan
    on scan.organization_id = org."id"
   and scan.repo_ref = 'acme-robotics/helios-firmware'
   and scan.scan_seq = 1
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The two protected paths the scan suggested.
--
-- `source` is `suggested`: detection proposed them and no person has edited either, which is
-- what the card's `suggested · edit` says. AP.3's guardrail reads these rows as they are.
-- ---------------------------------------------------------------------------
insert into ouroboros.protected_path_policies (id, organization_id, repo_ref, path_glob, source)
select seed.id::uuid, org."id", 'acme-robotics/helios-firmware', seed.path_glob, 'suggested'
  from (values
         ('5eed0055-0000-4000-8000-000000000001', 'boot/**'),
         ('5eed0055-0000-4000-8000-000000000002', 'keys/**')
       ) as seed (id, path_glob)
  join ouroboros.organization org on org."slug" = 'acme-onboarding'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The wizard's own memory — the only row here the wizard owns.
--
-- The template picked and the ticket picked; `dismissed`, `completed_at` and `bypassed_at` are
-- left at their defaults — not dismissed, not completed, not bypassed. **No step is written**:
-- the table has no column to write one in (decision O1), and the rail in the header is what
-- BB.2 derives from the rows above.
--
-- The ticket is found through the workspace's GitHub source rather than by id, so a database
-- in which it is missing gets no row here rather than a wizard pointing at nothing.
-- ---------------------------------------------------------------------------
insert into ouroboros.onboarding_state
    (id, organization_id, repo_ref, selected_template, picked_ticket_id)
select '5eed0052-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics/helios-firmware',
       'quick-fixes', ticket.id
  from ouroboros.organization org
  join ouroboros.ticket_sources source
    on source.organization_id = org."id"
   and source.kind = 'github'
   and source.display_name = 'GitHub · acme-robotics'
  join ouroboros.tickets ticket on ticket.source_id = source.id and ticket.external_key = '#488'
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Dry-run, on.
--
-- The column is named even though `true` is its default, so the row says what it means.
-- `updated_by` is left null: the onboarding default, which no person chose (V075).
-- ---------------------------------------------------------------------------
insert into ouroboros.org_policies (organization_id, dry_run)
select org."id", true
  from ouroboros.organization org
 where org."slug" = 'acme-onboarding'
   and ${ouro_dev_seed}
on conflict do nothing;
