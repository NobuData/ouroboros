-- R__dev_seed_workspace_settings.sql — mockup 17's Settings page as rows, in a development
-- database and nowhere else.
--
-- This seed is the **administration state** of `acme-robotics`: who may do
-- what, what merges by itself, how long the record is kept, and where events go. Mockup 17 is a page about configuration, and every card on it is reviewed
-- against these rows — so they cover the rows that tend to break first: a bot in the members
-- table, an invitation still pending, an audit line with no person behind it, a delivery that
-- failed.
--
-- Filed as issue #484 (BQ.5). The schemas it fills are V091 (members, service accounts), V092
-- (policy versions), V022 (audit) and V094 (retention, webhooks, notification routes).
--
-- It **cannot run in production** (every statement ends `and ${ouro_dev_seed}`, which is `false`
-- in flyway.toml), it is **idempotent** (every id is a literal and every insert ends `on conflict
-- do nothing`; the one table whose BEFORE trigger fires ahead of a conflict carries a `not exists`
-- guard as well), and it **never fails on a database somebody has edited** (the workspace is
-- found by slug, each person by email, and every row of another seed by its natural key — PR #514's
-- second revision, the Anthropic connection, run #471, runner forge-03 — and when one is missing,
-- the statement that needs it inserts nothing). The long form is R__dev_seed.sql's header.
--
-- ---------------------------------------------------------------------------
-- The rows, by card.
-- ---------------------------------------------------------------------------
--
--   | Card              | Rows                                              | Id prefix   |
--   |-------------------|---------------------------------------------------|-------------|
--   | Autonomy policies | `org_policies` handle, `org_policy_versions` v1–v7 | keyed by org |
--   | Members & roles   | Maya's explicit capability                        | keyed by member |
--   |                   | `devops-bot` and its one live hash-only key       | `5eed0071…` / `5eed0072…` |
--   |                   | Priya's pending invitation                        | `5eed0073…` |
--   | Audit log         | today's five events                               | `5eed0074…` |
--   | Workspace         | `retention_policies` 30 / 30 / 30 / 400           | keyed by org |
--   | Integrations      | two webhook endpoints, one of them SIEM           | `5eed0076…` |
--   |                   | their delivery log, one attempt failed            | `5eed0077…` |
--   | Notifications     | three routes: digest, weekly insights, loop failures | keyed by org |
--
-- **It must sort after the seeds it names** (only the inbox seed, #460, sorts later), and is named `workspace_settings` for that. Every audit line names a row
-- another seed writes — the PR #514 revision (verification), the Anthropic connection
-- (providers), the forge-03 runner (farm), run #471 (dashboard) — and its times are read off
-- those rows. Sorting earlier would find nothing on a database migrated from empty.
--
-- ---------------------------------------------------------------------------
-- The audit card joins the shared universe, not a parallel one.
-- ---------------------------------------------------------------------------
--
-- Mockup 17's five lines are not decoration: each is an event some other plane already seeds the
-- subject of, so each row here points at that subject and takes its time from it:
--
--   | Mockup line                                  | Subject, and where its time comes from                |
--   |----------------------------------------------|-------------------------------------------------------|
--   | ouroboros-app[bot] pushed PR #514 rev 2      | `pr_revisions` rev 2 — its own `pushed_at`             |
--   | Ken rotated Anthropic API key                | the Anthropic `provider_connections` row — push − 19m  |
--   | Ken enabled auto-merge (policy v7)           | `org_policy_versions` v7 — its own `published_at`      |
--   | Maya approved waiver on PR #509              | run #471, whose PR is #509 — merge − 4m                |
--   | system: runner forge-03 marked offline       | the forge-03 `runners` row — last seen + 32 s sweep    |
--
-- The mockup's clock (14:31 … 12:04) cannot be copied: forge-03 was last seen two hours ago
-- (mockup 08's *offline · 2h*), and PR #514's second push was minutes ago (mockup 12). So the
-- lines read in the mockup's order apart from the waiver. It sits on run #471, which merged
-- 2h 15m ago (mockup 02), so it is the oldest line rather than the fourth: a waiver approved
-- after its PR merged would be the one false line on the card.
--
-- Three actor kinds, so the card's actor styling has all three: a person (`actor_id`), the bot
-- (`actor_service = 'ouroboros-app'`, the GitHub App the loop pushes through — there is no
-- service-account row for it, and V091 makes the column a name rather than a key for exactly
-- that reason), and the system (neither).
--
-- PR #509 is never mirrored into `pull_requests` (only run #471's `pr_number` names it), and the
-- inbox's decision resolutions (BM.2) are not built, so the line's subject is **the run**, with
-- `pr_number: 509` in the detail. There is deliberately no `pr_waivers` row behind it: V079 makes
-- every waiver an intervention, and one more on run #471 would move mockup 15's cause bars.
--
-- ---------------------------------------------------------------------------
-- The honesty variants are seeded by what is absent.
-- ---------------------------------------------------------------------------
--
-- The mockup draws `4 connected`: GitHub, Slack, Jira and Webhooks. This deployment has GitHub
-- and Jira (R__dev_seed_sources.sql) and the webhooks below, and **no Slack** — mockup 19 is not
-- built — so nothing here pretends otherwise: no Slack connection, no `needs_you_dm` route (a DM
-- needs Slack), no Okta footer (no SSO), and the PagerDuty route is registered but locked, its
-- reason derived by `notification_routes_effective`. `Webhooks · 2 active` and *Stream to SIEM ✓*
-- are counted and derived from the rows below, never stored.
--
-- ---------------------------------------------------------------------------
-- Nothing here is a credential.
-- ---------------------------------------------------------------------------
--
-- Every column that could hold one is held by a CHECK to a sealed `ouro.v1.1.<nonce>.<body>`
-- envelope or a hash, and the values below satisfy those shapes without being anything: each
-- envelope's body decodes to `dev-seed-value-not-a-real-…`, and the service key's digest is
-- `5eed` sixteen times, which is the SHA-256 of no known input — so no string a person could
-- type authenticates as `devops-bot`. No BetterAuth session is seeded either: a session row
-- carries a live bearer value, so Maya's and Jorge's *last active* stay empty until they sign in.
--
-- Filed as issue #484 (BQ.5). Needs #480 (V092), #485 (V091) and V094. Asserted in tests/seed.sql,
-- tests/seed.test.sh and tests/settings-invariants.sql.

-- ---------------------------------------------------------------------------
-- The policy handle. `dry_run` null: the seed answers nothing about dry-run (V092).
-- ---------------------------------------------------------------------------
insert into ouroboros.org_policies (organization_id, dry_run)
select org."id", null
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Seven published versions — the history popover's v6 → v7 diff is one rule: auto-merge on.
--
-- Each version is v1's document with the rules that changed since, merged over it. The guard is
-- the version trigger's: it raises before a conflict is looked for, so a second application must
-- not reach it at all.
-- ---------------------------------------------------------------------------
insert into ouroboros.org_policy_versions
    (organization_id, version, document, published_by, published_at, change_note)
select org."id", seed.version,
       '{"auto_merge":        {"enabled": false, "conditions": {"effort_lte": "s"}},
         "human_review":      {"enabled": true,  "conditions": {"any": [{"label": "refactor"}, {"effort_gte": "l"}]}},
         "protected_paths":   {"enabled": true,  "conditions": {"path_globs": ["boot/**"]}},
         "spend_guard":       {"enabled": true,  "conditions": {"per_run_cap_cents": 200, "monthly_cap_cents": 50000}},
         "dry_run_new_repos": {"enabled": true,  "conditions": {"first_n_loops": 10}}}'::jsonb
         || seed.changes::jsonb,
       person."id",
       coalesce(seed.published_at,
                (select rev.pushed_at - interval '43 minutes'
                   from ouroboros.pull_requests pr
                   join ouroboros.pr_revisions rev on rev.pr_id = pr.id and rev.revision_seq = 2
                  where pr.organization_id = org."id" and pr.external_number = 514),
                now() - interval '46 minutes'),
       seed.change_note
  from (values
         (1, 'ken@acme-robotics.dev', now() - interval '61 days', 'Initial policy',
          '{}'),
         (2, 'ken@acme-robotics.dev', now() - interval '47 days', 'Protect key material',
          '{"protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**"]}}}'),
         (3, 'maya@acme-robotics.dev', now() - interval '33 days', 'Protect CI workflows',
          '{"protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}}}'),
         (4, 'ken@acme-robotics.dev', now() - interval '21 days', 'Raise the per-run cap to $2.50',
          '{"protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}},
            "spend_guard":     {"enabled": true, "conditions": {"per_run_cap_cents": 250, "monthly_cap_cents": 50000}}}'),
         (5, 'maya@acme-robotics.dev', now() - interval '12 days', 'Monthly cap $600 per provider',
          '{"protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}},
            "spend_guard":     {"enabled": true, "conditions": {"per_run_cap_cents": 250, "monthly_cap_cents": 60000}}}'),
         (6, 'ken@acme-robotics.dev', now() - interval '5 days', 'Auto-merge scope: effort ≤ M, non-refactor',
          '{"auto_merge":      {"enabled": false, "conditions": {"all": [{"effort_lte": "m"}, {"not": {"label": "refactor"}}]}},
            "protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}},
            "spend_guard":     {"enabled": true, "conditions": {"per_run_cap_cents": 250, "monthly_cap_cents": 60000}}}'),
         (7, 'ken@acme-robotics.dev', null, 'Enable auto-merge',
          '{"auto_merge":      {"enabled": true, "conditions": {"all": [{"effort_lte": "m"}, {"not": {"label": "refactor"}}]}},
            "protected_paths": {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}},
            "spend_guard":     {"enabled": true, "conditions": {"per_run_cap_cents": 250, "monthly_cap_cents": 60000}}}')
       ) as seed (version, author_email, published_at, change_note, changes)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros."user" person      on person."email" = seed.author_email
 where not exists (select 1
                     from ouroboros.org_policy_versions prior
                    where prior.organization_id = org."id")
   and ${ouro_dev_seed}
 order by seed.version
on conflict do nothing;

-- The pointer — only on a handle nothing has published through, and only to the newest version.
update ouroboros.org_policies handle
   set current_version = (select max(version) from ouroboros.org_policy_versions v
                           where v.organization_id = handle.organization_id)
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and handle.organization_id = org."id"
   and handle.current_version is null
   and exists (select 1 from ouroboros.org_policy_versions v where v.organization_id = org."id")
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Members. Ken, Maya and Jorge are R__dev_seed.sql's: owner, admin (*Maintainer*) and member
-- (*Viewer*). Maya's approve ✓ is her role's default as well; it is written explicitly so the
-- card is drawn against a row and not only against the fallback.
-- ---------------------------------------------------------------------------
insert into ouroboros.member_capabilities (member_id, organization_id, can_approve_loops,
                                           updated_by, updated_at)
select m."id", org."id", true, ken."id", now() - interval '40 days'
  from ouroboros.organization org
  join ouroboros."user" maya on maya."email" = 'maya@acme-robotics.dev'
  join ouroboros.member m    on m."organizationId" = org."id" and m."userId" = maya."id"
  join ouroboros."user" ken  on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The service account — the members table's *Service* row.
insert into ouroboros.service_accounts (id, organization_id, name, scopes, created_by, created_at)
select '5eed0071-0000-4000-8000-000000000001'::uuid, org."id", 'devops-bot',
       '["api.read", "farm.submit"]'::jsonb, ken."id", now() - interval '30 days'
  from ouroboros.organization org
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- Its one live key: a digest with no known input and a sealed hint — never the key. Used 41
-- seconds before the seed ran, which is the row's *41s*.
insert into ouroboros.service_tokens (id, organization_id, service_account_id, token_hash,
                                      hint_sealed, created_by, created_at, last_used_at)
select '5eed0072-0000-4000-8000-000000000001'::uuid, account.organization_id, account.id,
       repeat('5eed', 16),
       'ouro.v1.1.c2V0dGluZ3Mtc2VlZC1ub25jZS0z.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1zZXJ2aWNlLWhpbnQ',
       account.created_by, account.created_at, now() - interval '41 seconds'
  from ouroboros.service_accounts account
 where account.id = '5eed0071-0000-4000-8000-000000000001'
   and ${ouro_dev_seed}
on conflict do nothing;

-- Priya, invited two hours before the seed ran, as a Maintainer — the dimmed row. Not accepted,
-- so no `"user"` exists for her; the plugin's own 48-hour expiry.
insert into ouroboros.invitation ("id", "organizationId", "email", "role", "status",
                                  "expiresAt", "createdAt", "inviterId")
select '5eed0073-0000-4000-8000-000000000001', org."id", 'priya@acme.dev', 'admin', 'pending',
       now() + interval '46 hours', now() - interval '2 hours', ken."id"
  from ouroboros.organization org
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Today's five audit lines. One statement; each subject and time is read off its own row.
-- ---------------------------------------------------------------------------
insert into ouroboros.audit_events
    (id, organization_id, actor_id, actor_service, action, subject_type, subject_id, ip, detail,
     occurred_at)
select ('5eed0074-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", person."id", seed.actor_service, seed.action, seed.subject_type,
       case seed.subject_type
         when 'pr_revision'         then rev.id::text
         when 'provider_connection' then conn.id::text
         when 'org_policy'          then org."id"
         when 'run'                 then waived.id::text
         when 'runner'              then runner.id::text
       end,
       seed.ip::inet, seed.detail::jsonb,
       case seed.subject_type
         when 'pr_revision'         then rev.pushed_at
         when 'provider_connection' then rev.pushed_at - interval '19 minutes'
         when 'org_policy'          then v7.published_at
         when 'run'                 then waived.finished_at - interval '4 minutes'
         when 'runner'              then runner.last_seen_at + interval '32 seconds'
       end
  from (values
         (1, null, 'ouroboros-app', 'pr_revision.pushed', 'pr_revision', null,
          '{"pr_number": 514, "revision": 2, "head_sha": "b7e41d0"}'),
         (2, 'ken@acme-robotics.dev', null, 'provider.rotated', 'provider_connection', '198.51.100.24',
          '{"kind": "anthropic", "outcome": "success"}'),
         (3, 'ken@acme-robotics.dev', null, 'policy.published', 'org_policy', '198.51.100.24',
          '{"version": 7, "previous_version": 6, "classification": "loosening", "changed_rules": "auto_merge", "loosening_rules": "auto_merge", "tightening_rules": "", "changes": "auto_merge:enabled", "change_note": "Enable auto-merge"}'),
         (4, 'maya@acme-robotics.dev', null, 'triage.waived', 'run', '198.51.100.61',
          '{"pr_number": 509}'),
         (5, null, null, 'runner.marked_offline', 'runner', null,
          '{"runner": "forge-03"}')
       ) as seed (n, actor_email, actor_service, action, subject_type, ip, detail)
  join ouroboros.organization org          on org."slug" = 'acme-robotics'
  join ouroboros.pull_requests pr          on pr.organization_id = org."id" and pr.external_number = 514
  join ouroboros.pr_revisions rev          on rev.pr_id = pr.id and rev.revision_seq = 2
  join ouroboros.org_policy_versions v7    on v7.organization_id = org."id" and v7.version = 7
  join ouroboros.runs waived               on waived.organization_id = org."id"
                                          and waived.issue_number = 471
                                          and waived.finished_at is not null
  join ouroboros.runners runner            on runner.organization_id = org."id"
                                          and runner.name = 'forge-03'
  join ouroboros.provider_connections conn on conn.organization_id = org."id"
                                          and conn.kind = 'anthropic'
  left join ouroboros."user" person        on person."email" = seed.actor_email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Retention — the workspace card's *30 days* and the audit card's *retained 400d*.
-- ---------------------------------------------------------------------------
insert into ouroboros.retention_policies (organization_id, data_class, days, updated_by, updated_at)
select org."id", seed.data_class, seed.days, ken."id", now() - interval '61 days'
  from (values ('transcripts', 30), ('build_logs', 30), ('artifacts', 30), ('audit', 400))
         as seed (data_class, days)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros."user" ken       on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Two webhook endpoints. The SIEM route takes `audit.*`; the release bot PRs and runs.
-- ---------------------------------------------------------------------------
insert into ouroboros.webhook_endpoints (id, organization_id, name, url, hmac_key_sealed,
                                         event_families, siem, active, created_by, created_at,
                                         updated_at)
select seed.id::uuid, org."id", seed.name, seed.url, seed.sealed, seed.families::jsonb,
       seed.siem, true, person."id", now() - seed.age, now() - seed.age
  from (values
         ('5eed0076-0000-4000-8000-000000000001', 'SIEM · Splunk HEC',
          'https://siem.acme-robotics.dev/services/collector/event',
          'ouro.v1.1.c2V0dGluZ3Mtc2VlZC1ub25jZS0x.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1obWFjLWtleS1zaWVt',
          '["audit.*"]', true, 'ken@acme-robotics.dev', interval '40 days'),
         ('5eed0076-0000-4000-8000-000000000002', 'Release notes bot',
          'https://hooks.acme-robotics.dev/ouroboros',
          'ouro.v1.1.c2V0dGluZ3Mtc2VlZC1ub25jZS0y.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1obWFjLWtleS1yZWxlYXNl',
          '["pr.*", "run.*"]', false, 'maya@acme-robotics.dev', interval '25 days')
       ) as seed (id, name, url, sealed, families, siem, author_email, age)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros."user" person    on person."email" = seed.author_email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The delivery log. Each of today's audit events reached the SIEM (so its ✓ derives from the
-- newest one), and the release bot's first try at PR #514 rev 2 got a 503 and was retried — under
-- the same idempotency key (V098's `delivery_key`, `X-Ouro-Delivery`), as every retry is.
-- ---------------------------------------------------------------------------
insert into ouroboros.webhook_deliveries (id, organization_id, endpoint_id, event_type, event_id,
                                          attempt, status, response_code, latency_ms,
                                          response_excerpt, attempted_at, delivery_key)
select ('5eed0077-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       endpoint.organization_id, endpoint.id, seed.event_type, event.id,
       seed.attempt, seed.status, seed.response_code, seed.latency_ms, seed.excerpt,
       event.occurred_at + seed.after,
       ('5eed0078-0000-4000-8000-' || lpad((seed.n - seed.attempt + 1)::text, 12, '0'))::uuid
  from (values
         ( 1, 1, 'audit.runner.marked_offline',  5, 1, 'succeeded', 200, 112, null,                   interval '2 seconds'),
         ( 2, 1, 'audit.triage.waived',          4, 1, 'succeeded', 200,  97, null,                   interval '2 seconds'),
         ( 3, 1, 'audit.policy.published',       3, 1, 'succeeded', 200, 104, null,                   interval '2 seconds'),
         ( 4, 1, 'audit.provider.rotated',       2, 1, 'succeeded', 200,  88, null,                   interval '2 seconds'),
         ( 5, 1, 'audit.pr_revision.pushed',     1, 1, 'succeeded', 200,  91, null,                   interval '2 seconds'),
         ( 6, 2, 'pr.revision_pushed',           1, 1, 'failed',    503, 412, 'upstream unavailable', interval '2 seconds'),
         ( 7, 2, 'pr.revision_pushed',           1, 2, 'succeeded', 200, 136, null,                   interval '32 seconds')
       ) as seed (n, endpoint_n, event_type, event_n, attempt, status, response_code, latency_ms,
                  excerpt, after)
  join ouroboros.webhook_endpoints endpoint
    on endpoint.id = ('5eed0076-0000-4000-8000-' || lpad(seed.endpoint_n::text, 12, '0'))::uuid
  join ouroboros.audit_events event
    on event.id = ('5eed0074-0000-4000-8000-' || lpad(seed.event_n::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification routes. No `needs_you_dm`: a DM needs Slack, and this deployment has none.
-- Loop failures are registered and off — PagerDuty does not exist yet, so the view locks it.
-- ---------------------------------------------------------------------------
insert into ouroboros.notification_routes (organization_id, kind, channel, config, enabled,
                                           updated_by, updated_at)
select org."id", seed.kind, seed.channel, seed.config::jsonb, seed.enabled, ken."id",
       now() - interval '20 days'
  from (values
         ('daily_digest',    'email',     '{"time": "09:00"}', true),
         ('weekly_insights', 'email',
          '{"weekday": "monday", "time": "09:00", "recipients": ["eng-leads@acme-robotics.dev"]}', true),
         ('loop_failures',   'pagerduty', '{}', false)
       ) as seed (kind, channel, config, enabled)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros."user" ken       on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;
