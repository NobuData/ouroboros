-- R__dev_seed_sources.sql — the two ticket sources `acme-robotics` ingests from, in a
-- development database and nowhere else.
--
-- The seventh development seed, and it answers a question the other six could not ask.
-- R__dev_seed.sql (#23) is *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop
-- has done*, R__dev_seed_intake.sql (#103) is *what it has an opinion about next*,
-- R__dev_seed_providers.sql (#221) is *what it is allowed to call*,
-- R__dev_seed_routing.sql (#192) is *how it decides which one to call*,
-- R__dev_seed_audit.sql (#225) is *who touched the keys* — and this is **where the work
-- comes from**. All of it belongs to `acme-robotics`, the workspace every mockup is drawn
-- in, which is R__dev_seed_providers.sql's rule and for its reason.
--
-- V030 (#138) created `ticket_sources` and `tickets`. This file seeds the first of those two
-- and **deliberately not the second** — see the section below.
--
--   | Rows                   | Id prefix   | Suffix                          |
--   |------------------------|-------------|---------------------------------|
--   | `ticket_sources` (2)   | `5eed001a…` | 1 the GitHub source, 2 the Jira |
--
-- Three properties make it safe to apply to a development database on every `up`, and each
-- of them is asserted by a test:
--
--   1. **It cannot run in production.** Both statements end with `${ouro_dev_seed}`,
--      which is `false` in flyway.toml and `true` only in flyway.seed.toml — so under the
--      ordinary configuration each is `… where false` and writes nothing.
--   2. **It is idempotent.** Both ids are literals and the insert ends `on conflict do
--      nothing`, so a second application writes nothing. Unlike R__dev_seed_intake.sql, no
--      second `not exists` guard is needed: `ticket_sources` carries no BEFORE trigger that
--      could raise ahead of the conflict being resolved — only `touch_updated_at`, which
--      fires on update. The one `update` (see *The Jira source is connected* below) matches
--      only the row's earlier seeded shape, so a second application matches nothing.
--   3. **It never fails on a database somebody has edited.** The workspace is found by slug
--      rather than by repeating R__dev_seed.sql's id, which is what makes this converge
--      instead of failing on a foreign key.
--
-- ---------------------------------------------------------------------------
-- Why this seeds sources and not tickets.
-- ---------------------------------------------------------------------------
--
-- `tickets` has no writer yet — Q.2 (#139) is the sync loop and Q.3 (#140) the GitHub
-- provider that fills it — and R__dev_seed_intake.sql already seeds the same nine issues
-- into `github_issues`, which is what mockup 03's backlog reads today. Seeding both would
-- put one backlog in two places, and the copy nothing renders is the copy that drifts: the
-- day somebody fixes a title in one file, the two disagree and no test is looking at the
-- pair.
--
-- (#275, AK.4, later made a different call for mockup 09: R__dev_seed_ticket_planning.sql
-- seeds a canonical backlog of its own, numbered clear of the intake mirror's nine, because
-- the Planning page's health meters are computed over `tickets` and nothing else. That file's
-- header argues it; the argument above still holds for the nine intake issues, which are not
-- copied.)
--
-- The sources are a different kind of row and that is why they are here. They are
-- **configuration**, not a read-model — the same kind of thing R__dev_seed_providers.sql
-- seeds for mockup 07, where a connection's kind, name and sealed credential are all
-- configuration a person entered — so a development database that holds them is not
-- claiming any work was ingested. It is claiming two trackers were configured, which is
-- true of the workspace the mockups describe.
--
-- What they buy: Q.2's registry has two kinds to resolve, Q.4's settings surface has two
-- cards to render, and mockup 09's *Tracker Sync* card has two connected rows and a third
-- kind, `linear`, whose absence is what renders its **connect ↗**.
--
-- ---------------------------------------------------------------------------
-- The Jira source is the point of the file.
-- ---------------------------------------------------------------------------
--
-- One GitHub source would seed nothing a reader could not already assume. The second row is
-- a `jira` source with **no repository anywhere in it** — a base URL, a project key, and a
-- sealed credential — and it is what makes source-neutrality
-- visible in the development stack rather than only in V030's constraints.
--
-- **The Jira source is connected** (#275, AK.4). It was first seeded `paused` with no
-- credential, which was honest for Q.1: a source with no credential cannot be polled. Mockup
-- 09's *Tracker Sync* card draws Jira as connected (ok dot, *epics mirror milestones*), and
-- that card is rendered from this row's state, so the row now carries a sealed development
-- credential and is `active`. That asks nothing impossible of the sync loop: this build
-- registers no Jira provider, and Q.2's loop *skips* a kind it cannot resolve rather than
-- flipping the row to `error` (see `ticket-source.registry.ts`).
--
-- A database seeded before that change already holds the paused row, and `on conflict do
-- nothing` would leave it paused forever — so the insert is followed by one `update` that
-- moves the row **only while it is still exactly as the earlier seed left it**: this id,
-- `paused`, no credential. A row somebody has since configured by hand is not that row, and
-- is left alone.
--
-- ---------------------------------------------------------------------------
-- The credential is a real envelope, and it opens nothing.
-- ---------------------------------------------------------------------------
--
-- `credentials_encrypted` is envelope-only by CHECK (V030, following V015 and V027), so this
-- file cannot route around the rule with a plaintext value and does not try to. The GitHub
-- source carries a well-formed `ouro.v1.1.<nonce>.<body>` value whose base64url body decodes
-- to `dev-seed-value-not-a-real-credential-github` — R__dev_seed_providers.sql's idiom,
-- exactly — and the Jira source one decoding to `dev-seed-value-not-a-real-credential-jira`,
-- so the constraint is exercised by the seed rather than avoided by it, and anything that
-- tries to decrypt either value fails on a key rather than on a shape.
--
-- No sync has run against either source, so `sync_cursor` and `synced_at` are left null on
-- both. That is the same restraint R__dev_seed_intake.sql showed when it left
-- `github_repos.issues_synced_at` null: a stamp here would claim a poll that never happened,
-- and the freshness tag would be reading a lie.
--
-- Filed as issue #138 (Q.1); the Jira source connected by #275 (AK.4). Needs #23 (the
-- workspaces) and V030's schema. Read by Q.2 (#139), Q.3 (#140), Q.4 (#141) and AM.3 (#285).
-- Asserted in tests/seed.sql and tests/seed.test.sh.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_sources
    (id, organization_id, kind, display_name, config, credentials_encrypted, status)
select seed.id::uuid, org."id", seed.kind, seed.display_name, seed.config::jsonb,
       seed.credentials, seed.status
  from (values
         -- The workspace's GitHub org and the four repositories R__dev_seed.sql enables in
         -- it. The repository list lives in `config` rather than in a join table for
         -- decision P6's reason: it is one provider's idea of scope, and a `jira` row two
         -- lines down has nothing to put in such a table.
         ('5eed001a-0000-4000-8000-000000000001', 'github', 'GitHub · acme-robotics',
          '{"login": "acme-robotics",
            "repos": ["helios-firmware", "helios-console", "helios-telemetry",
                      "atlas-scheduler"]}',
          'ouro.v1.1.c2VlZC1ub25jZS00.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWdpdGh1Yg',
          'active'),
         -- No repository, no login, no issue numbers: a site and a project key. The row this
         -- whole file exists to put in a development database.
         ('5eed001a-0000-4000-8000-000000000002', 'jira', 'Jira · PROJ',
          '{"base_url": "https://acme-robotics.atlassian.net",
            "project_keys": ["PROJ"]}',
          'ouro.v1.1.c2VlZC1ub25jZS01.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWppcmE',
          'active')
       ) as seed (id, kind, display_name, config, credentials, status)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Connect a Jira source seeded before #275 — and only that one.
--
-- Matches the row by its seeded id *and* its earlier seeded shape, so it moves a database
-- that was seeded while the source was paused, does nothing on one seeded since, and does
-- nothing to a source somebody has configured by hand. The credential is the insert's.
-- ---------------------------------------------------------------------------
update ouroboros.ticket_sources
   set credentials_encrypted =
         'ouro.v1.1.c2VlZC1ub25jZS01.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWppcmE',
       status = 'active'
 where id = '5eed001a-0000-4000-8000-000000000002'
   and status = 'paused'
   and credentials_encrypted is null
   and ${ouro_dev_seed};
