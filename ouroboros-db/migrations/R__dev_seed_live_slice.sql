-- R__dev_seed_live_slice.sql — the thin vertical slice's workspace: one published `live-slice`
-- workflow, the routing that sends its two model stages to a recorded provider fixture, the
-- repository and issue the slice runs on, and the dry-run policy it runs under — in a
-- development database and nowhere else.
--
-- The twenty-sixth development seed (#1314, DI.5), and the second that needs a workspace of
-- its own. R__dev_seed_onboarding.sql (#383) created `acme-onboarding` because mockup 13's
-- first week could not be true of `acme-robotics`; this file creates `acme-live-slice` because
-- the slice cannot be true of it either, and for a reason that is a constraint rather than a
-- number: V016 makes a route **unique per task kind per workspace**, and `acme-robotics`
-- already routes `plan` and `implement` to mockup 06's chains. The slice needs both kinds to
-- resolve to an alias on the fixture provider, so it needs a workspace in which that is simply
-- the routing — and one whose rail, provider cards, registry and matrix are not the ones every
-- mockup, screenshot and e2e baseline is drawn from. Ken owns it, which puts it in the list
-- the dev stack's sign-in offers, a fifth row.
--
-- ---------------------------------------------------------------------------
-- What the slice is, and the four decisions this file takes (#1314).
-- ---------------------------------------------------------------------------
--
-- `live-slice@v1` is plan → implement → build → gate → open a pull request, in the workflow
-- language as it stands (`schemas/workflow-dsl/v1.json`):
--
--   1. **`implement` is an `llm` stage.** The language has no per-stage executor; the engine
--      runs every model stage under the executor registered at start, and the one registered
--      is the Claude Agent harness (DH.3, #1308), which hard-codes decision L5: file tools
--      only, no shell, no network tool, no MCP server, no repository-supplied settings or
--      hooks. The two permissions the language *does* declare are therefore both off —
--      `push_fixup: false` (no push tool) and `touch_ci: false` — which is exactly the set L5
--      allows, stated in the document rather than assumed.
--   2. **The gate is the build's exit status.** `checks all_passed ["build"]` is how the
--      language spells "exit 0"; the `loop` edge back to `implement` with `max_retries: 1` is
--      the one retry (the interpreter bounds the loop at the target stage's retries plus one).
--   3. **The terminal is `open_pr_automerge`, and the pull request opens as a draft.** The
--      language has no draft terminal; the draft is the workspace's policy: `org_policies
--      .dry_run` is on, live execution refuses to start for a repository whose policy is not
--      dry-run (DI.4, #1312, decision L7), and under dry-run the publisher (DI.3, #1311) opens a
--      draft and nothing arms a merge. The stage's description says so.
--   4. **The provider connection carries no credential.** A seed cannot seal one: an envelope
--      is bound to the tenant's key and to the row's own id (AD.1), and a literal here would be
--      a credential in a repository. So the row is `unknown`, enabled and keyless, which
--      routing keeps (an unchecked hop is kept, not dropped), and the e2e leg (DI.6, #1321) sets
--      the fixture's key through the same rotate route a person uses. `base_url` names the
--      compose service `provider-fixture` (tests/e2e/fixtures/provider-fixture), which replays a
--      recorded Anthropic Messages-format exchange for the issue below; on a dev stack without
--      that service the connection is simply unreachable, as mockup 07's addresses are.
--
-- The document is checked by ci/db's drift check (tests/lib/seeded-definitions.sql reads it
-- back), validated and round-tripped through the code DSL by ouroboros-rest's
-- `dsl.seed.spec.ts` and `code.seed.spec.ts`, and is what the public sample repository's
-- provisional `.ouroboros/live-slice.loop.ts` (#1320) is replaced by.
--
-- ---------------------------------------------------------------------------
-- The repository and the issue are the e2e stack's fixtures, mirrored.
-- ---------------------------------------------------------------------------
--
-- `acme-robotics/helios-greeter` is the third repository of the suite's git host
-- (tests/e2e/fixtures/git-stub) and the sixth of its sandbox tracker (tracker-stub): a
-- one-script greeter with a missing exclamation mark and a `tests/check.sh` that catches it.
-- Issue `#1` is that bug, written the way the recorded exchange was recorded against it, and
-- it is mirrored here as the GitHub account `acme-robotics` connects it: a `github_orgs` row,
-- the enabled repository, an active GitHub source, the cached issue with its XS estimate, and
-- the canonical ticket the queue will pin. The estimate's `suggested_workflow` is this file's
-- workflow, so the backlog's suggestion and the template agree.
--
-- ---------------------------------------------------------------------------
-- The wizard offers the slice as a tile of this workspace's own.
-- ---------------------------------------------------------------------------
--
-- `workflow_templates_for(org)` returns the shipped global rows plus an organization's own
-- (V068), so a fifth tile, `live-slice`, is a row with `organization_id` set — seeded here,
-- behind the guard, rather than a V-migration a production database would also receive. Its
-- definition is read from the version row this file publishes a statement earlier, so the
-- tile offers exactly the document the workspace runs and the two cannot drift.
--
-- ---------------------------------------------------------------------------
-- Ids, and the three properties every seed keeps.
-- ---------------------------------------------------------------------------
--
--   | Rows                           | Id prefix   | Suffix                                  |
--   |--------------------------------|-------------|-----------------------------------------|
--   | `organization` (1)             | `5eed009e…` | 1                                       |
--   | `member` (1)                   | `5eed009f…` | 1 Ken, owner                            |
--   | `github_orgs` (1)              | `5eed00a0…` | 1 the account `acme-robotics`           |
--   | `github_repos` (1)             | `5eed00a1…` | 1 helios-greeter                        |
--   | `ticket_sources` (1)           | `5eed00a2…` | 1                                       |
--   | `github_issues` (1)            | `5eed00a3…` | the issue number                        |
--   | `issue_estimates` (1)          | `5eed00a4…` | the issue number, then the version      |
--   | `tickets` (1)                  | `5eed00a5…` | the issue number                        |
--   | `provider_connections` (1)     | `5eed00a6…` | 1                                       |
--   | `model_aliases` (2)            | `5eed00a7…` | 1 slice-planner, 2 slice-coder          |
--   | `task_kinds` (2)               | `5eed00a8…` | the sort order: 1 plan, 2 implement     |
--   | `routes` (2)                   | `5eed00a9…` | the kind's sort order                   |
--   | `route_hops` (2)               | `5eed00aa…` | the kind's sort order                   |
--   | `workflows` (1)                | `5eed00ab…` | 1                                       |
--   | `workflow_versions` (1)        | `5eed00ac…` | the version                             |
--   | `workflow_templates` (1)       | `5eed00ad…` | the version                             |
--   | `org_policies` (1)             | —           | keyed by the workspace                  |
--
-- Every row carries a prefix of this file's own, so a count another seed's assertions make
-- over its prefix is not moved by anything here. `estimate` and `copilot-workflow` are not
-- task kinds of this file's: V144 and V142 give every new workspace both through a trigger on
-- `organization`, at sort orders of 1000 and above.
--
--   1. **It cannot run in production.** Every statement ends with `${ouro_dev_seed}`, which is
--      `false` in flyway.toml and `true` only in flyway.seed.toml.
--   2. **It is idempotent.** Every id is a literal, every insert ends `on conflict do nothing`,
--      and the one update carries `is distinct from`. Three inserts carry a `not exists` guard
--      as well, because `issue_estimates_version_monotonic`, `workflow_version_next` and
--      `workflow_templates_next_version` are BEFORE triggers that raise before PostgreSQL looks
--      at the conflicting key — R__dev_seed_intake.sql's and R__dev_seed_workflows.sql's trap.
--   3. **It never fails on a database somebody has edited.** Every parent is found by natural
--      key — the workspace by slug, Ken by email, the account by login, the repository by name,
--      the connection by kind and name, a route by tag — so a parent that is gone makes a join
--      empty and the statement a no-op, never a foreign-key error.
--
-- **It must sort after `dev_seed`**, the one seed it reads (Ken), and `dev_seed_live_slice`
-- does — between `dev_seed_intake` and `dev_seed_onboarding`. tests/seed.test.sh asserts the
-- whole order.
--
-- Filed as issue #1314 (DI.5) under epic #1295. Needs V141 (#1313) for the origin setting
-- below, V146 (#1312) for the admission it is queued under, and #991's git host. Read by the
-- live-slice acceptance leg (DI.6, #1321). Asserted in tests/seed.sql and tests/seed.test.sh.

-- ---------------------------------------------------------------------------
-- The workspace, and the person who can open it.
-- ---------------------------------------------------------------------------
-- Every row this file writes is seeded (DJ.1, #1313): `origin` lives on runs and what derives
-- from them, so the rows below carry none themselves — this transaction-local setting is what
-- the origin triggers read for every run the slice later produces from them.
select set_config('ouroboros.seed_origin', 'seeded', true) where ${ouro_dev_seed};

insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
select '5eed009e-0000-4000-8000-000000000001', 'Acme Live Slice', 'acme-live-slice', now(), null
 where ${ouro_dev_seed}
on conflict do nothing;

-- Ken, as owner: the person the dev stack signs in as, and the one with the approval capability
-- a live run is started by (decision L5).
insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
select '5eed009f-0000-4000-8000-000000000001', org."id", person."id", 'owner', now()
  from ouroboros.organization org
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The repository: the GitHub account `acme-robotics` and `helios-greeter`, enabled.
--
-- The same account every other workspace connects, mirrored a third time (`github_orgs` is
-- unique per workspace and login). `installed_at` stays null, R__dev_seed.sql's rule.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_orgs (id, organization_id, login, enabled)
select '5eed00a0-0000-4000-8000-000000000001'::uuid, org."id", 'acme-robotics', true
  from ouroboros.organization org
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch)
select '5eed00a1-0000-4000-8000-000000000001'::uuid, gh.id, 'helios-greeter', true, 'main'
  from ouroboros.organization org
  join ouroboros.github_orgs gh on gh.organization_id = org."id" and gh.login = 'acme-robotics'
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The source: an active GitHub source naming the account and listing the repository.
--
-- R__dev_seed_sources.sql's row, for this workspace: a well-formed `ouro.v1.1.<nonce>.<body>`
-- envelope whose body decodes to `dev-seed-value-not-a-real-credential-github`, so anything
-- that tries to open it fails on a key rather than on a shape. The e2e leg stores the sandbox
-- token over it, the way the build leg does for its workspace.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_sources
    (id, organization_id, kind, display_name, config, credentials_encrypted, status)
select '5eed00a2-0000-4000-8000-000000000001'::uuid, org."id", 'github', 'GitHub · acme-robotics',
       '{"login": "acme-robotics", "repos": ["helios-greeter"]}'::jsonb,
       'ouro.v1.1.c2VlZC1ub25jZS03.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWdpdGh1Yg',
       'active'
  from ouroboros.organization org
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The issue: `#1`, the fixture repository's one bug, as the recorded exchange was recorded
-- against it. Opened a day ago by Ken; sized, so the queue can pin it.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_issues
  (id, organization_id, github_repo_id, number, title, body, state, labels,
   author_login, gh_created_at, gh_updated_at, gh_url, synced_at, sizing_status)
select '5eed00a3-0000-4000-8000-000000000001'::uuid, org."id", repo.id, 1,
       'greet: the exclamation mark is missing',
       '`bin/greet World` prints `Hello, World` — the exclamation mark the README promises is missing.'
       || E'\n\n'
       || 'Expected: `Hello, World!` for `bin/greet World`, and `Hello, world!` when no name is given. `sh tests/check.sh` must pass.',
       'open', '["live-slice"]'::jsonb, 'ken-suenobu',
       now() - interval '1 day', now() - interval '1 day',
       'https://github.com/' || gh.login || '/' || repo.name || '/issues/1',
       now() - interval '40 seconds', 'sized'
  from ouroboros.organization org
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-greeter'
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The estimate in force: XS, one file, suggested for this file's workflow. In the intake seed's
-- shape, with its guard: `issue_estimates_version_monotonic` is a BEFORE trigger.
insert into ouroboros.issue_estimates
  (id, github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select '5eed00a4-0000-4000-8000-000000000101'::uuid, issue.id, 1, 'xs', 92, 'live-slice',
       'anthropic/claude-sonnet-4-5',
       jsonb_build_object('files',       '["bin/greet"]'::jsonb,
                          'est_tokens',  12000,
                          'cycle_min',   2,
                          'cycle_max',   4,
                          'est_minutes', 3),
       'low', 'One format string in a one-line script, with a test already asserting both outputs.',
       jsonb_build_object('estimator',   'heuristic-v0',
                          'sized_at',    to_char((now() - interval '20 hours') at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0,
                          'signals',     '[]'::jsonb),
       now() - interval '20 hours'
  from ouroboros.organization org
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-greeter'
  join ouroboros.github_issues issue on issue.github_repo_id = repo.id and issue.number = 1
 where org."slug" = 'acme-live-slice'
   and not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.github_issue_id = issue.id
                      and prior.version >= 1)
   and ${ouro_dev_seed}
on conflict do nothing;

-- The canonical ticket, in the shape Q.3's GitHub mapper writes (R__dev_seed_onboarding.sql's
-- statement, for this workspace): `meta.github` is what the queue reads to decide the ticket
-- is an issue of the repository it is queued for.
insert into ouroboros.tickets
    (id, organization_id, source_id, external_id, external_key, external_url, title, body, state,
     labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select '5eed00a5-0000-4000-8000-000000000001'::uuid,
       issue.organization_id, source.id, issue.number::text, '#' || issue.number::text,
       issue.gh_url, issue.title, issue.body, issue.state, issue.labels, issue.author_login,
       issue.gh_created_at, issue.gh_updated_at, issue.synced_at, issue.sizing_status,
       jsonb_build_object('github', jsonb_build_object('owner', gh.login, 'repo', repo.name))
  from ouroboros.organization org
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-greeter'
  join ouroboros.github_issues issue on issue.github_repo_id = repo.id and issue.number = 1
  join ouroboros.ticket_sources source
    on source.organization_id = org."id"
   and source.kind = 'github'
   and source.display_name = 'GitHub · acme-robotics'
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The provider: the recorded fixture, as an Anthropic connection with an address and no key.
--
-- `kind` is `anthropic` because the harness facade (DH.2, #1303) relays only Anthropic-format
-- hops, and the adapter honours a `base_url` the row carries (#1314) — there is still no
-- address field on the card, so only a seed can set one. `unknown`, never checked, no health:
-- the sweep has not run, and routing keeps an unchecked hop. See decision 4 in the header.
-- ---------------------------------------------------------------------------
insert into ouroboros.provider_connections
    (id, organization_id, kind, display_name, base_url, credentials_encrypted,
     status, last_checked_at, health, monthly_cap_cents, added_by, last_used_at,
     capability_note, enabled, created_at)
select '5eed00a6-0000-4000-8000-000000000001'::uuid, org."id", 'anthropic',
       'Anthropic · recorded fixture', 'http://provider-fixture:8080', null,
       'unknown', null, '{}'::jsonb, null, person."id", null,
       'provider-fixture · replays the recorded live-slice exchange', true,
       now() - interval '1 day'
  from ouroboros.organization org
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The routing: two aliases on the fixture, two task kinds, two routes of one hop each.
--
-- Two aliases, not one, because the plan stage and the implement stage both run as harness
-- sessions through the facade, and the fixture tells the two recorded sessions apart by the
-- model id the facade rewrites the request to. Both ids are in R__model_price_catalog.sql, so
-- the slice's usage rows price.
-- ---------------------------------------------------------------------------
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, params,
     enabled, restrictions, updated_by)
select ('5eed00a7-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", seed.alias, conn.id, seed.model_id, '{}'::jsonb, true, '{}'::jsonb, person."id"
  from (values
         (1, 'slice-planner', 'claude-sonnet-4-5'),
         (2, 'slice-coder',   'claude-sonnet-4-5-20250929')
       ) as seed (n, alias, model_id)
  join ouroboros.organization org on org."slug" = 'acme-live-slice'
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
  join ouroboros.provider_connections conn
    on conn.organization_id = org."id"
   and conn.kind = 'anthropic'
   and conn.display_name = 'Anthropic · recorded fixture'
 where ${ouro_dev_seed}
on conflict do nothing;

-- The two kinds the workflow's stages inherit. `estimate` and `copilot-workflow` are V144's and
-- V142's, given to the workspace by trigger at sort orders of 1000 and above.
insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order)
select ('5eed00a8-0000-4000-8000-' || lpad(seed.sort_order::text, 12, '0'))::uuid,
       org."id", seed.name, seed.description, seed.sort_order
  from (values
         (1, 'plan',      'One call: name the files the change touches'),
         (2, 'implement', 'A harness session with file tools writes the change')
       ) as seed (sort_order, name, description)
  join ouroboros.organization org on org."slug" = 'acme-live-slice'
 where ${ouro_dev_seed}
on conflict (id) do nothing;

insert into ouroboros.routes
    (id, organization_id, task_kind_id, tag, allow_local_fallback,
     floor_hop_index, max_cost_cents_per_run, updated_by)
select ('5eed00a9-0000-4000-8000-' || lpad(seed.sort_order::text, 12, '0'))::uuid,
       org."id", kind.id, seed.tag, true, null, null, person."id"
  from (values
         (1, 'plan',      'plan-primary'),
         (2, 'implement', 'implement-primary')
       ) as seed (sort_order, kind_name, tag)
  join ouroboros.organization org on org."slug" = 'acme-live-slice'
  join ouroboros.task_kinds kind
    on kind.organization_id = org."id" and kind.name = seed.kind_name
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.route_hops
    (id, organization_id, route_id, position, model_alias_id, note)
select ('5eed00aa-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", route.id, 1, alias.id, null
  from (values
         (1, 'plan-primary',      'slice-planner'),
         (2, 'implement-primary', 'slice-coder')
       ) as seed (n, tag, alias)
  join ouroboros.organization org on org."slug" = 'acme-live-slice'
  join ouroboros.routes route
    on route.organization_id = org."id" and route.tag = seed.tag
  join ouroboros.model_aliases alias
    on alias.organization_id = org."id" and alias.alias = seed.alias
 where ${ouro_dev_seed}
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The workflow: `live-slice`, published once, a day ago.
--
-- Three statements for R__dev_seed_workflows.sql's reason — the two tables point at each
-- other, so the entity lands with a null pointer, the version second, and the pointer moves
-- third. The document is written against schemas/workflow-dsl/v1.json; see the header for why
-- each stage is spelled the way it is.
-- ---------------------------------------------------------------------------
insert into ouroboros.workflows (id, organization_id, slug, name, status, created_at)
select '5eed00ab-0000-4000-8000-000000000001'::uuid, org."id", 'live-slice', 'live-slice',
       'active', now() - interval '1 day'
  from ouroboros.organization org
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.workflow_versions
    (id, workflow_id, version, definition, published_at, published_by, change_note,
     created_at, updated_at)
select '5eed00ac-0000-4000-8000-000000000001'::uuid, wf.id, 1,
       $live_slice_v1$
{
  "dsl_version": "1.0",
  "trigger": { "event": "ticket_queued", "conditions": { "effort_lte": "s" } },
  "nodes": [
    {
      "id": "issue-queued",
      "type": "trigger",
      "title": "Issue queued",
      "description": "Runs when a small issue of this repository reaches the queue.",
      "position": { "x": 24, "y": 40 },
      "config": {}
    },
    {
      "id": "plan",
      "type": "llm",
      "title": "Plan the change",
      "description": "One call: reads the issue and names the files the change touches.",
      "position": { "x": 306, "y": 40 },
      "config": {
        "mode": "prompt",
        "prompt_template": "Plan the change for this issue.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nName every file the change touches and the test that proves it.",
        "routing": { "inherit_task": "plan" },
        "limits": { "max_retries": 1, "token_budget": 50000 },
        "permissions": { "push_fixup": false, "touch_ci": false }
      }
    },
    {
      "id": "implement",
      "type": "llm",
      "title": "Implement",
      "description": "A harness session with file tools only writes the change onto the run's working tree.",
      "position": { "x": 588, "y": 40 },
      "config": {
        "mode": "prompt",
        "prompt_template": "Implement the plan.\n\nIssue: {{issue.title}}\nPlan:  {{plan}}\n\nChange only what the plan names. Every acceptance criterion needs a test.",
        "routing": { "inherit_task": "implement" },
        "limits": { "max_retries": 1, "token_budget": 400000 },
        "permissions": { "push_fixup": false, "touch_ci": false }
      }
    },
    {
      "id": "build",
      "type": "infra",
      "title": "Build and test",
      "description": "Runs the repository's check on a pool-a runner; its exit status is the verdict.",
      "position": { "x": 870, "y": 40 },
      "config": { "runner_pool": "pool-a", "command": "sh tests/check.sh" }
    },
    {
      "id": "gate",
      "type": "flow",
      "title": "Build green?",
      "description": "Opens the pull request when the build passed; a failure returns to implement once.",
      "position": { "x": 1152, "y": 40 },
      "config": {
        "kind": "gate",
        "predicate": { "kind": "checks", "op": "all_passed", "names": ["build"] }
      }
    },
    {
      "id": "open-pr",
      "type": "term",
      "title": "Open pull request",
      "description": "Opens the pull request for a person to review — a draft under the workspace's dry-run policy.",
      "position": { "x": 1152, "y": 230 },
      "config": {
        "action": "open_pr_automerge",
        "options": { "merge_method": "squash", "delete_branch": true }
      }
    }
  ],
  "edges": [
    { "from": "issue-queued", "to": "plan", "kind": "default" },
    { "from": "plan", "to": "implement", "kind": "default" },
    { "from": "implement", "to": "build", "kind": "default" },
    { "from": "build", "to": "gate", "kind": "default" },
    {
      "from": "gate",
      "to": "open-pr",
      "kind": "branch",
      "label": "pass →",
      "condition": { "kind": "checks", "op": "all_passed" }
    },
    {
      "from": "gate",
      "to": "implement",
      "kind": "loop",
      "label": "fail ↺",
      "condition": { "kind": "checks", "op": "any_failed" }
    }
  ]
}
       $live_slice_v1$::jsonb,
       now() - interval '1 day', person."id", 'First publish of the live slice.',
       now() - interval '1 day', now() - interval '1 day'
  from ouroboros.workflows wf
  join ouroboros.organization org on org."id" = wf.organization_id
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-live-slice'
   and wf.slug = 'live-slice'
   -- `workflow_version_next` is a BEFORE trigger and raises before the conflict is seen.
   and not exists (select 1
                     from ouroboros.workflow_versions prior
                    where prior.workflow_id = wf.id
                      and prior.version >= 1)
   and ${ouro_dev_seed}
on conflict do nothing;

-- The pointer — the only update in this file. `is distinct from` is what makes it idempotent:
-- a second pass matches no row and does not move `updated_at` through the touch trigger.
update ouroboros.workflows wf
   set current_version = 1
  from ouroboros.organization org
 where org."slug" = 'acme-live-slice'
   and wf.organization_id = org."id"
   and wf.slug = 'live-slice'
   and wf.current_version is distinct from 1
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The tile: `live-slice`, this workspace's own, offered after the four shipped ones.
--
-- Its definition is the published version's, read back rather than restated, so the wizard
-- offers exactly what the workspace runs. `workflow_templates_next_version` is a BEFORE
-- trigger, so the `not exists` guard is what keeps a second application a no-op.
-- ---------------------------------------------------------------------------
insert into ouroboros.workflow_templates
    (id, organization_id, slug, version, name, description, stage_dots, effort_range, caption,
     definition, tier, unlock_rule, sort_order)
select '5eed00ad-0000-4000-8000-000000000001'::uuid, org."id", 'live-slice', 1,
       'Live slice', 'Plan, implement, build on a runner, open a draft pull request.',
       '["plan", "implement", "build", "gate", "PR"]'::jsonb, array['xs', 's'],
       'the first live loop, end to end', v.definition, 'starter', null, 5
  from ouroboros.organization org
  join ouroboros.workflows wf on wf.organization_id = org."id" and wf.slug = 'live-slice'
  join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version = 1
 where org."slug" = 'acme-live-slice'
   and not exists (select 1
                     from ouroboros.workflow_templates prior
                    where prior.organization_id = org."id"
                      and prior.slug = 'live-slice')
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Dry-run, on — the policy a live run is admitted under (decision L7), with nobody's name on
-- it: the onboarding default (V075).
-- ---------------------------------------------------------------------------
insert into ouroboros.org_policies (organization_id, dry_run)
select org."id", true
  from ouroboros.organization org
 where org."slug" = 'acme-live-slice'
   and ${ouro_dev_seed}
on conflict do nothing;
